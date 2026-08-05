import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runProblems } from "./generated/problems_tui.js";
import type { ProjectStatusResult } from "./lsp/project_status.ts";
import { decodeMessages, encodeMessage, type RpcMessage } from "./lsp/rpc.ts";
import { pathToFileUri } from "./lsp/uri.ts";
import { type Head, type Problem, publish } from "./problems_client.ts";

/**
 * One analysis result: the diagnostics, plus which project head produced them.
 * `Head` mirrors the status bar the VS Code extension builds from
 * `workman/projectStatus`, so head selection is observable without an editor.
 */
type Snapshot = {
  problems: Problem[];
  head: Head;
};

export async function problemsCommand(args: string[]): Promise<number> {
  if (args.length > 1) {
    console.error("usage: wm problems [entrypoint.wm]");
    return 2;
  }
  const requested = args.length === 1 ? args[0] : await defaultEntrypoint(Deno.cwd());
  if (requested === undefined) return 2;
  if (!Deno.stdin.isTerminal()) {
    console.error("wm problems needs a terminal; run it directly in a shell");
    return 2;
  }
  const input = await Deno.realPath(resolve(requested));
  const session = await startProblemsSession(input);
  const watcher = new AbortController();
  // The TUI drives itself from terminal callbacks and ends the run by exiting the
  // process, so `runProblems` resolves once it is wired up rather than when the
  // user quits. The watcher and the LSP session have to outlive that resolution,
  // which leaves process exit as the only point where tearing them down is
  // correct.
  const release = () => {
    watcher.abort();
    session.dispose();
  };
  globalThis.addEventListener("unload", release);
  try {
    publishSnapshot(await session.refresh());
    const watching = watchProject(input, watcher.signal, session);
    await runProblems();
    // Outlives the TUI only if it quits; a watcher failure surfaces here instead
    // of silently leaving the display frozen.
    await watching;
    return 0;
  } catch (error) {
    release();
    throw error;
  }
}

export interface ProblemsSession {
  refresh(): Promise<Snapshot>;
  close(): Promise<void>;
  /** Synchronous teardown for exit handlers, where awaiting a shutdown is not possible. */
  dispose(): void;
}

/**
 * `wm problems` with no argument picks the obvious entrypoint: `main.wm` when it
 * exists, otherwise the sole `.wm` file in the directory. Anything else is
 * ambiguous, so the user names the file instead of us guessing.
 */
export async function defaultEntrypoint(directory: string): Promise<string | undefined> {
  const main = join(directory, "main.wm");
  if (await isFile(main)) return main;
  const candidates: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isDirectory || !entry.name.endsWith(".wm")) continue;
    candidates.push(join(directory, entry.name));
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    console.error("no .wm file found here; run: wm problems <entrypoint.wm>");
    return undefined;
  }
  candidates.sort();
  console.error(
    `no main.wm and ${candidates.length} .wm files here ` +
      `(${candidates.map((path) => basename(path)).join(", ")}); ` +
      "run: wm problems <entrypoint.wm>",
  );
  return undefined;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

export async function watchProject(
  input: string,
  signal: AbortSignal,
  providedSession?: ProblemsSession,
): Promise<void> {
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
        publishSnapshot(await session.refresh());
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

function publishSnapshot(snapshot: Snapshot): void {
  publish(snapshot.problems, snapshot.head);
}

function showError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function collectProblems(input: string): Promise<Problem[]> {
  return (await collectSnapshot(input)).problems;
}

export async function collectSnapshot(input: string): Promise<Snapshot> {
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
    return result.result;
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
    async refresh(): Promise<Snapshot> {
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
      const status = await request("workman/projectStatus", {
        textDocument: { uri: pathToFileUri(input) },
      }) as ProjectStatusResult | undefined;
      return { problems: flatten(publications, root), head: describeHead(status, input, root) };
    },
    dispose(): void {
      if (closed) return;
      closed = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // Process already exited.
      }
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

function describeHead(
  status: ProjectStatusResult | undefined,
  input: string,
  root: string,
): Head {
  const selected = status?.selected;
  if (!selected) {
    return { kind: "detached", path: displayPath(input, root), moduleCount: 0, recovered: false };
  }
  return {
    kind: selected.kind,
    path: displayPath(selected.headPath, root),
    moduleCount: selected.moduleCount,
    recovered: selected.recovered,
  };
}

function displayPath(path: string, root: string): string {
  const display = relative(root, path);
  return display === "" || display.startsWith("..") ? path : display;
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
      return [{
        path: displayPath(absolute, root),
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
