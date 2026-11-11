import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { snapshotEnvironment } from "./project.ts";
import { decodeMessages, encodeMessage, type RpcMessage } from "../lsp/rpc.ts";

export const syncDocumentsMethod = "workman/syncDocuments";

/** Bridge dependent-file pull diagnostics to editors that do not request diagnostic refreshes. */
export class ConsumerDiagnostics {
  private consumers = new Map<string, number>();
  private pending = new Map<string, { uri: string; version: number; revision: number }>();
  private pendingUris = new Set<string>();
  private dirty = new Set<string>();
  private revision = 0;
  private sequence = 0;
  private stopped = false;

  track(message: RpcMessage): void {
    if (message.method === "shutdown" || message.method === "exit") {
      this.stopped = true;
      this.dirty.clear();
      return;
    }
    if (!/^textDocument\/did(?:Open|Change|Close)$/.test(message.method ?? "")) return;
    const document = (message.params as { textDocument?: { uri?: string; version?: number } })
      ?.textDocument;
    if (!document?.uri || !/\.[cm]?[jt]sx?$/.test(document.uri)) return;
    this.revision++;
    if (message.method === "textDocument/didClose") {
      this.consumers.delete(document.uri);
      this.dirty.delete(document.uri);
    } else if (typeof document.version === "number") {
      this.consumers.set(document.uri, document.version);
    }
    this.markDirty();
  }

  invalidate(): void {
    this.revision++;
    this.markDirty();
  }

  private markDirty(): void {
    if (!this.stopped) { for (const uri of this.consumers.keys()) this.dirty.add(uri); }
  }

  requests(): RpcMessage[] {
    const requests: RpcMessage[] = [];
    if (this.stopped) return requests;
    for (const uri of this.dirty) {
      if (this.pendingUris.has(uri)) continue;
      const version = this.consumers.get(uri);
      this.dirty.delete(uri);
      if (version === undefined) continue;
      const id = `workman/consumer-diagnostics/${++this.sequence}`;
      this.pending.set(id, { uri, version, revision: this.revision });
      this.pendingUris.add(uri);
      requests.push({
        jsonrpc: "2.0",
        id,
        method: "textDocument/diagnostic",
        params: { textDocument: { uri } },
      });
    }
    return requests;
  }

  /** undefined means this is not our response; an empty array still consumes our response. */
  response(message: RpcMessage): RpcMessage[] | undefined {
    if (message.method || typeof message.id !== "string") return;
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);
    this.pendingUris.delete(request.uri);
    if (this.stopped || !this.consumers.has(request.uri)) return [];
    if (request.revision !== this.revision || request.version !== this.consumers.get(request.uri)) {
      this.dirty.add(request.uri);
      return [];
    }
    const result = message.result as { kind?: string; items?: unknown[] } | undefined;
    if (message.error || result?.kind !== "full" || !Array.isArray(result.items)) return [];
    return [{
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri: request.uri, version: request.version, diagnostics: result.items },
    }];
  }
}

/** Fresh merges push and pull caches, so expose only the push model that this adapter owns. */
export function pushOnlyInitialize(message: RpcMessage): RpcMessage {
  const result = message.result as { capabilities?: Record<string, unknown> } | undefined;
  if (!result?.capabilities) return message;
  const { diagnosticProvider: _diagnosticProvider, ...capabilities } = result.capabilities;
  return { ...message, result: { ...result, capabilities } };
}

/** Editor adapter: mirror WM buffers into the same native TS session as their TS consumers. */
export class WorkmanDocumentSync {
  private documents = new Map<string, { text: string; version: number }>();

  snapshot(): [string, string][] {
    return [...this.documents].map(([uri, document]) => [fileURLToPath(uri), document.text]);
  }

  update(input: unknown): RpcMessage[] {
    const params = input as { documents?: unknown } | undefined;
    if (!Array.isArray(params?.documents)) throw new Error("Expected a documents array");
    const next = new Map<string, string>();
    // Validate the entire snapshot before changing state or sending any notifications.
    for (const document of params.documents) {
      if (!document || typeof document.uri !== "string" || typeof document.text !== "string") {
        throw new Error("Each document requires a file URI and text");
      }
      const path = fileURLToPath(document.uri);
      if (!path.endsWith(".wm") || next.has(document.uri)) {
        throw new Error("Expected distinct .wm file URIs");
      }
      next.set(document.uri, document.text);
    }
    const notifications: RpcMessage[] = [];
    for (const uri of this.documents.keys()) {
      if (!next.has(uri)) {
        notifications.push({
          jsonrpc: "2.0",
          method: "textDocument/didClose",
          params: { textDocument: { uri } },
        });
        this.documents.delete(uri);
      }
    }
    for (const [uri, text] of next) {
      const previous = this.documents.get(uri);
      if (previous?.text === text) continue;
      const version = (previous?.version ?? 0) + 1;
      notifications.push(
        previous
          ? {
            jsonrpc: "2.0",
            method: "textDocument/didChange",
            params: { textDocument: { uri, version }, contentChanges: [{ text }] },
          }
          : {
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: { textDocument: { uri, languageId: "wm", version, text } },
          },
      );
      this.documents.set(uri, { text, version });
    }
    return notifications;
  }
}

/** Native TS tooling with WM buffer synchronization and a single, push-only diagnostic model. */
export async function runTypeScriptLsp(tsc: string): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "workman-ts-session-" });
  const snapshotPath = join(directory, "buffers.json");
  await Deno.writeTextFile(snapshotPath, "[]");
  const child = spawn(tsc, ["--lsp", "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, [snapshotEnvironment]: snapshotPath },
  });
  child.stderr.pipe(process.stderr, { end: false });
  // Serialize complete frames from both sources. Piping raw native chunks would allow a
  // custom response to split a partially received native frame and corrupt the connection.
  let output = Promise.resolve();
  const send = (message: RpcMessage) => {
    output = output.then(() => write(process.stdout, message));
    return output;
  };
  let input = Promise.resolve();
  const toNative = (messages: RpcMessage[]) => {
    input = input.then(async () => {
      for (const message of messages) await write(child.stdin, message);
    });
    return input;
  };
  const diagnostics = new ConsumerDiagnostics();
  let initializeId: RpcMessage["id"];
  const nativeOutput = (async () => {
    for await (const message of readMessages(child.stdout)) {
      if (!message.method && message.id === initializeId) {
        await send(pushOnlyInitialize(message));
        continue;
      }
      if (message.method === "workspace/diagnostic/refresh" && message.id !== undefined) {
        diagnostics.invalidate();
        await toNative([
          { jsonrpc: "2.0", id: message.id, result: null },
          ...diagnostics.requests(),
        ]);
        continue;
      }
      if (
        message.method === "client/registerCapability" ||
        message.method === "client/unregisterCapability"
      ) {
        const params = message.params as Record<string, { method: string }[]> | undefined;
        const key = message.method === "client/registerCapability"
          ? "registrations"
          : "unregisterations";
        const registrations = params?.[key];
        if (Array.isArray(registrations)) {
          const filtered = registrations.filter((registration) =>
            registration.method !== "textDocument/diagnostic" &&
            registration.method !== "workspace/diagnostic"
          );
          if (filtered.length !== registrations.length) {
            if (filtered.length) await send({ ...message, params: { ...params, [key]: filtered } });
            else if (message.id !== undefined) {
              await toNative([{ jsonrpc: "2.0", id: message.id, result: null }]);
            }
            continue;
          }
        }
      }
      const publications = diagnostics.response(message);
      if (publications === undefined) await send(message);
      else {
        if (message.error) {
          console.error(
            "Workman TypeScript diagnostic pull failed:",
            JSON.stringify(message.error),
          );
        }
        for (const publication of publications) await send(publication);
        await toNative(diagnostics.requests());
      }
    }
  })();
  const status = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  const sync = new WorkmanDocumentSync();
  let initialized = false;
  try {
    for await (const message of readMessages(process.stdin)) {
      if (message.method === syncDocumentsMethod) {
        if (message.id === undefined) continue;
        try {
          if (!initialized) throw new Error("TypeScript has not initialized yet");
          const notifications = sync.update(message.params);
          if (notifications.length) {
            // Publish the complete snapshot before TS can invoke any transform. Atomic rename
            // prevents a mapper from observing half-written JSON while another request runs.
            await Deno.writeTextFile(`${snapshotPath}.next`, JSON.stringify(sync.snapshot()));
            await Deno.rename(`${snapshotPath}.next`, snapshotPath);
            diagnostics.invalidate();
            notifications.push({
              jsonrpc: "2.0",
              method: "workspace/didChangeWatchedFiles",
              params: { changes: [{ uri: pathToFileURL(snapshotPath).href, type: 2 }] },
            });
          }
          await toNative(notifications);
          await toNative(diagnostics.requests());
          await send({ jsonrpc: "2.0", id: message.id, result: null });
        } catch (error) {
          await send({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: initialized ? -32602 : -32002, message: String(error) },
          });
        }
      } else {
        if (message.method === "initialize") initializeId = message.id;
        diagnostics.track(message);
        await toNative([message]);
        await toNative(diagnostics.requests());
        if (message.method === "initialized") initialized = true;
        if (message.method === "exit") {
          child.stdin.end();
          process.exitCode = await status;
          await nativeOutput;
          // An LSP client keeps stdin open until the server exits. Do not wait for the stdin
          // async iterator's cleanup/EOF after handling the protocol's explicit exit message.
          await Deno.remove(directory, { recursive: true });
          process.exit(process.exitCode);
        }
      }
    }
    child.stdin.end();
    process.exitCode = await status;
    await nativeOutput;
  } finally {
    if (child.exitCode === null) child.kill();
    await Deno.remove(directory, { recursive: true }).catch(() => {});
  }
}

async function* readMessages(
  stream: AsyncIterable<Uint8Array | string>,
): AsyncGenerator<RpcMessage> {
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
  for await (const chunk of stream) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    const next = new Uint8Array(buffer.length + bytes.length);
    next.set(buffer);
    next.set(bytes, buffer.length);
    const decoded = decodeMessages(next);
    buffer = decoded.rest;
    if (decoded.errors.length) throw new Error("Invalid JSON-RPC frame");
    yield* decoded.messages;
  }
}

async function write(stream: NodeJS.WritableStream, message: RpcMessage): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(
      encodeMessage(message),
      (error?: Error | null) => error ? reject(error) : resolve(),
    );
  });
}

if (import.meta.main) {
  const [flag, tsc] = Deno.args;
  if (flag !== "--tsc" || !tsc || Deno.args.length !== 2) {
    throw new Error("Usage: typescript_lsp.ts --tsc /absolute/path/to/tsc");
  }
  await runTypeScriptLsp(tsc);
}
