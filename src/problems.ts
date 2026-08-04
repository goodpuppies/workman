import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runProblems } from "./generated/problems_tui.js";
import { decodeMessages, encodeMessage, type RpcMessage } from "./lsp/rpc.ts";
import { pathToFileUri } from "./lsp/uri.ts";

type Problem = {
  path: string;
  line: number;
  column: number;
  severity: number;
  code: string;
  message: string;
};

export async function problemsCommand(args: string[]): Promise<number> {
  if (args.length !== 1) {
    console.error("usage: wm problems <entrypoint.wm>");
    return 2;
  }
  const input = await Deno.realPath(resolve(args[0]));
  const session = await startProblemsSession(input);
  const dataPath = await Deno.makeTempFile({ prefix: "wm-problems-", suffix: ".json" });
  const watcher = new AbortController();
  try {
    const problems = await session.refresh();
    await writeSnapshot(dataPath, 0, problems);
    const watchTask = watchProject(input, dataPath, watcher.signal, session);
    try {
      await runProblems(dataPath);
      return 0;
    } finally {
      watcher.abort();
      await watchTask;
    }
  } finally {
    await session.close();
    await Deno.remove(dataPath).catch(() => undefined);
  }
}

export interface ProblemsSession {
  refresh(): Promise<Problem[]>;
  close(): Promise<void>;
}

export async function watchProject(
  input: string,
  dataPath: string,
  signal: AbortSignal,
  providedSession?: ProblemsSession,
): Promise<void> {
  let revision = 0;
  const ownsSession = providedSession === undefined;
  const watcher = Deno.watchFs(dirname(input), { recursive: true });
  const events = watcher[Symbol.asyncIterator]();
  let nextEvent = events.next();
  const abort = () => watcher.close();
  signal.addEventListener("abort", abort, { once: true });
  let session = providedSession;
  try {
    session ??= await startProblemsSession(input);
    while (!signal.aborted) {
      const next = await nextEvent;
      if (next.done) break;
      nextEvent = events.next();
      const event = next.value;
      if (!event.paths.some((path) => path.endsWith(".wm"))) continue;
      // Drain and coalesce the create/write/rename burst produced by one save.
      while (true) {
        const settled = await Promise.race([
          nextEvent.then((result) => ({ result })),
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 100)),
        ]);
        if (settled === undefined) break;
        if (settled.result.done) return;
        nextEvent = events.next();
      }
      if (signal.aborted) break;
      try {
        const problems = await session.refresh();
        await writeSnapshot(dataPath, ++revision, problems);
      } catch (error) {
        if (!signal.aborted) console.error(`problems refresh failed: ${showError(error)}`);
      }
    }
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  } finally {
    signal.removeEventListener("abort", abort);
    if (!signal.aborted) watcher.close();
    if (ownsSession) await session?.close();
  }
}

async function writeSnapshot(
  dataPath: string,
  revision: number,
  problems: Problem[],
): Promise<void> {
  await Deno.writeTextFile(dataPath, JSON.stringify({ revision, problems }));
}

function showError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function collectProblems(input: string): Promise<Problem[]> {
  const session = await startProblemsSession(input);
  try {
    return await session.refresh();
  } finally {
    await session.close();
  }
}

export async function startProblemsSession(input: string): Promise<ProblemsSession> {
  const root = dirname(input);
  const rootUri = pathToFileURL(root).href;
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", new URL("./lsp/node_entry.ts", import.meta.url).href],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  const publications = new Map<string, unknown[]>();
  const waiting = new Map<number, (message: RpcMessage) => void>();
  let requestId = 0;
  let version = 0;
  let opened = false;
  let closed = false;
  const stderr = drain(child.stderr);
  const reader = (async () => {
    let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
    for await (const chunk of child.stdout) {
      buffer = concat(buffer, chunk);
      const decoded = decodeMessages(buffer);
      buffer = decoded.rest;
      for (const message of decoded.messages) {
        if (message.method === "textDocument/publishDiagnostics") {
          const params = message.params as { uri?: unknown; diagnostics?: unknown } | undefined;
          if (typeof params?.uri === "string" && Array.isArray(params.diagnostics)) {
            publications.set(params.uri, params.diagnostics);
          }
        }
        if (typeof message.id === "number") waiting.get(message.id)?.(message);
      }
    }
  })();
  const send = (message: RpcMessage) => writer.write(encodeMessage(message));
  const request = async (method: string, params: unknown) => {
    const id = ++requestId;
    const response = new Promise<RpcMessage>((resolve) => waiting.set(id, resolve));
    await send({ jsonrpc: "2.0", id, method, params });
    const result = await response;
    waiting.delete(id);
    if (result.error) throw new Error(`LSP ${method} failed: ${JSON.stringify(result.error)}`);
  };
  try {
    await request("initialize", {
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: "problems" }],
      capabilities: {},
    });
    await send({ jsonrpc: "2.0", method: "initialized", params: {} });
  } catch (error) {
    await writer.close().catch(() => undefined);
    try {
      child.kill("SIGTERM");
    } catch {
      // Process may already have exited after an initialization failure.
    }
    await Promise.all([child.status, reader, stderr]);
    throw error;
  }
  return {
    async refresh(): Promise<Problem[]> {
      if (closed) throw new Error("problems LSP session is closed");
      const text = await Deno.readTextFile(input);
      publications.clear();
      version++;
      if (!opened) {
        opened = true;
        await send({
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: {
            textDocument: {
              uri: pathToFileUri(input),
              languageId: "workman",
              version,
              text,
            },
          },
        });
      } else {
        await send({
          jsonrpc: "2.0",
          method: "textDocument/didChange",
          params: {
            textDocument: { uri: pathToFileUri(input), version },
            contentChanges: [{ text }],
          },
        });
      }
      // A request drains validation scheduled by all preceding notifications.
      await request("workspace/symbol", { query: "" });
      return flatten(publications, root);
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      try {
        await request("shutdown", null);
        await send({ jsonrpc: "2.0", method: "exit", params: null });
      } finally {
        await writer.close().catch(() => undefined);
        await child.status;
        await Promise.all([reader, stderr]);
      }
    },
  };
}

function flatten(publications: Map<string, unknown[]>, root: string): Problem[] {
  return [...publications].flatMap(([uri, values]) =>
    values.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const item = value as Record<string, unknown>;
      const range = item.range as { start?: { line?: unknown; character?: unknown } } | undefined;
      if (
        typeof item.message !== "string" || typeof range?.start?.line !== "number" ||
        typeof range.start.character !== "number"
      ) return [];
      const absolute = new URL(uri).pathname;
      const display = relative(root, absolute);
      return [{
        path: display.startsWith("..") ? absolute : display,
        line: range.start.line + 1,
        column: range.start.character + 1,
        severity: typeof item.severity === "number" ? item.severity : 1,
        code: item.code === undefined ? "" : String(item.code),
        message: item.message,
      }];
    })
  ).sort((a, b) => a.severity - b.severity || a.path.localeCompare(b.path) || a.line - b.line);
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  for await (const _ of stream) { /* discard LSP logs */ }
}

function concat(left: Uint8Array<ArrayBufferLike>, right: Uint8Array): Uint8Array<ArrayBufferLike> {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}
