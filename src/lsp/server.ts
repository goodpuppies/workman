import { pathToFileURL } from "node:url";
import { once } from "node:events";
import process from "node:process";
import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import { loadFrontendV2 } from "../frontend_v2_loader.ts";
import { runtime } from "../io.ts";
import { DocumentStore } from "./documents.ts";
import { completionAt } from "./completion.ts";
import { documentSymbols } from "./document_symbols.ts";
import { FrontendV2ParseCache } from "./frontend_v2_parse_cache.ts";
import { hoverAt } from "./hover.ts";
import { type InitializeParams, ProjectIndex } from "./project_index.ts";
import { projectStatusForUri } from "./project_status.ts";
import { prepareRenameAt, renameAt } from "./rename.ts";
import { decodeMessages, encodeMessage, type RpcMessage } from "./rpc.ts";
import {
  semanticTokenModifiers,
  semanticTokensFull,
  semanticTokenTypes,
} from "./semantic_tokens.ts";
import { SemanticService } from "./semantic_service.ts";
import { signatureHelpAt } from "./signature_help.ts";
import { definitionAt, documentHighlightsAt, referencesAt, typeDefinitionAt } from "./symbols.ts";
import { structuralInlayHints } from "./structural_inlays.ts";
import { semanticInlayHints } from "./type_inlays.ts";
import { fileUriToPath } from "./uri.ts";
import { validateUri } from "./validation.ts";
import { workspaceSymbols } from "./workspace_symbols.ts";

const documents = new DocumentStore();
const projectIndex = new ProjectIndex();
let frontendOptions = frontendOptionsFromEnv();
const semanticService = new SemanticService(projectIndex.discovery, {
  sourceOverrides: () => documents.sourceOverrides(),
  frontendOptions: () => frontendOptions,
});
let structuralInlaysEnabled = process.env.WORKMAN_STRUCTURAL_INLAYS !== "false";
let typeInlaysEnabled = process.env.WORKMAN_TYPE_INLAYS !== "false";
let parameterInlaysEnabled = process.env.WORKMAN_PARAMETER_INLAYS !== "false";
const frontendV2ParseCache = new FrontendV2ParseCache();
const lastPublishedUrisByEntry = new Map<string, Set<string>>();
let isShutdown = false;
let hasInitialized = false;
let writeChain: Promise<void> = Promise.resolve();
let workspaceRevision = 0;
const requestStates = new Map<string, {
  revision: number;
  cancelled: boolean;
  responded: boolean;
}>();

if (import.meta.main) await runServer();

export async function runServer() {
  log("server start");
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
  const pending = new Set<Promise<void>>();
  for await (const chunk of process.stdin) {
    buffer = concat(buffer, typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
    const decoded = decodeMessages(buffer);
    buffer = decoded.rest;
    for (const error of decoded.errors) {
      await writeRpcError(error.id, error.code, error.message);
    }
    for (const message of decoded.messages) {
      if (isConcurrentRequest(message)) {
        beginRequest(message);
        const task = processMessage(message).finally(() => {
          finishRequest(message);
          pending.delete(task);
        });
        pending.add(task);
      } else {
        if (message.method === "shutdown" || message.method === "exit") {
          await Promise.allSettled([...pending]);
        }
        await processMessage(message);
      }
    }
  }
  await Promise.allSettled([...pending]);
  log("server stop");
}

async function processMessage(message: RpcMessage): Promise<void> {
  const started = Date.now();
  log("recv", summarize(message));
  try {
    await handleMessage(message);
    log("done", summarize(message), `${Date.now() - started}ms`);
  } catch (error) {
    log("error", summarize(message), showError(error));
    await respondError(message.id, -32603, showError(error));
  }
}

function isConcurrentRequest(message: RpcMessage): boolean {
  return message.id !== undefined &&
    message.method !== undefined &&
    message.method !== "initialize" &&
    message.method !== "shutdown";
}

function beginRequest(message: RpcMessage): void {
  requestStates.set(requestKey(message.id), {
    revision: workspaceRevision,
    cancelled: false,
    responded: false,
  });
}

function finishRequest(message: RpcMessage): void {
  requestStates.delete(requestKey(message.id));
}

function requestKey(id: RpcMessage["id"]): string {
  return `${typeof id}:${String(id)}`;
}

async function handleMessage(message: RpcMessage) {
  if (message.method === "exit") process.exit(isShutdown ? 0 : 1);
  if (message.method === "initialize") {
    if (hasInitialized || isShutdown) {
      await respondError(message.id, -32600, "initialize may only be requested once");
      return;
    }
    const params = message.params as WorkmanInitializeParams | undefined;
    applyInitializationOptions(params?.initializationOptions);
    projectIndex.rememberWorkspaceRoots(params);
    const indexStarted = Date.now();
    const indexedFiles = await projectIndex.initialize(
      documents.sourceOverrides(),
      frontendOptions,
    );
    log("initialize index done", `${Date.now() - indexStarted}ms`, `files=${indexedFiles}`);
    await respond(message.id, {
      capabilities: {
        positionEncoding: "utf-16",
        textDocumentSync: {
          openClose: true,
          change: 1,
          save: true,
        },
        hoverProvider: true,
        definitionProvider: true,
        typeDefinitionProvider: true,
        referencesProvider: true,
        documentHighlightProvider: true,
        renameProvider: { prepareProvider: true },
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        completionProvider: { triggerCharacters: ["."] },
        signatureHelpProvider: {
          triggerCharacters: ["(", ",", " "],
          retriggerCharacters: [","],
        },
        semanticTokensProvider: {
          legend: {
            tokenTypes: semanticTokenTypes,
            tokenModifiers: semanticTokenModifiers,
          },
          full: true,
        },
        ...(typeInlaysEnabled || parameterInlaysEnabled ||
            (frontendOptions.frontend === "v2" && structuralInlaysEnabled)
          ? { inlayHintProvider: true }
          : {}),
      },
      serverInfo: { name: "workman-lsp", version: "0.0.1" },
    });
    hasInitialized = true;
    return;
  }
  if (!hasInitialized) {
    await respondError(message.id, -32002, "server not initialized");
    return;
  }
  if (isShutdown) {
    await respondError(message.id, -32600, "server has shut down");
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "$/cancelRequest") {
    const id = (message.params as { id?: RpcMessage["id"] } | undefined)?.id;
    const state = requestStates.get(requestKey(id));
    if (state && !state.responded) state.cancelled = true;
    return;
  }
  if (message.method === "shutdown") {
    isShutdown = true;
    await respond(message.id, null);
    return;
  }
  if (message.method === "textDocument/didOpen") {
    workspaceRevision++;
    const params = message.params as DidOpenParams;
    documents.open(params.textDocument.uri, params.textDocument.text, params.textDocument.version);
    await publishAffectedValidation(params.textDocument.uri);
    return;
  }
  if (message.method === "textDocument/didChange") {
    workspaceRevision++;
    const params = message.params as DidChangeParams;
    const text = params.contentChanges.at(-1)?.text;
    if (text === undefined) return;
    documents.change(params.textDocument.uri, text, params.textDocument.version);
    await publishAffectedValidation(params.textDocument.uri);
    return;
  }
  if (message.method === "textDocument/didSave") {
    const params = message.params as DidSaveParams;
    await publishAffectedValidation(params.textDocument.uri);
    return;
  }
  if (message.method === "textDocument/hover") {
    const params = message.params as HoverParams;
    const hover = await hoverAt(
      params.textDocument.uri,
      params.position,
      documents.sourceOverrides(),
      frontendOptions,
      semanticService,
    );
    log(
      "hover result",
      `id=${String(message.id ?? "-")}`,
      hover ? "has-contents" : "null",
    );
    await respond(
      message.id,
      hover,
    );
    return;
  }
  if (message.method === "textDocument/completion") {
    const params = message.params as TextDocumentPositionParams;
    await respond(
      message.id,
      await completionAt(
        params.textDocument.uri,
        params.position,
        documents.sourceOverrides(),
        frontendOptions,
        semanticService,
      ),
    );
    return;
  }
  if (message.method === "textDocument/definition") {
    const params = message.params as TextDocumentPositionParams;
    await respond(
      message.id,
      await definitionAt(
        params.textDocument.uri,
        params.position,
        documents.sourceOverrides(),
        frontendOptions,
        semanticService,
      ),
    );
    return;
  }
  if (message.method === "textDocument/typeDefinition") {
    const params = message.params as TextDocumentPositionParams;
    await respond(
      message.id,
      await typeDefinitionAt(
        params.textDocument.uri,
        params.position,
        documents.sourceOverrides(),
        frontendOptions,
        semanticService,
      ),
    );
    return;
  }
  if (message.method === "textDocument/references") {
    const params = message.params as ReferenceParams;
    await respond(
      message.id,
      await referencesAt(
        params.textDocument.uri,
        params.position,
        params.context?.includeDeclaration ?? true,
        documents.sourceOverrides(),
        frontendOptions,
        semanticService,
      ),
    );
    return;
  }
  if (message.method === "textDocument/documentHighlight") {
    const params = message.params as TextDocumentPositionParams;
    await respond(
      message.id,
      await documentHighlightsAt(
        params.textDocument.uri,
        params.position,
        documents.sourceOverrides(),
        frontendOptions,
        semanticService,
      ),
    );
    return;
  }
  if (message.method === "textDocument/prepareRename") {
    const params = message.params as TextDocumentPositionParams;
    await respond(
      message.id,
      await prepareRenameAt(
        params.textDocument.uri,
        params.position,
        documents.sourceOverrides(),
        frontendOptions,
        semanticService,
      ),
    );
    return;
  }
  if (message.method === "textDocument/rename") {
    const params = message.params as RenameParams;
    await respond(
      message.id,
      await renameAt(
        params.textDocument.uri,
        params.position,
        params.newName,
        documents.sourceOverrides(),
        frontendOptions,
        semanticService,
      ),
    );
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    const params = message.params as { textDocument: { uri: string } };
    await respond(
      message.id,
      await documentSymbols(
        params.textDocument.uri,
        documents.sourceOverrides(),
        frontendOptions,
        semanticService,
      ),
    );
    return;
  }
  if (message.method === "workspace/symbol") {
    const params = message.params as { query?: string };
    await respond(
      message.id,
      await workspaceSymbols(
        params.query ?? "",
        semanticService,
        documents.sourceOverrides(),
      ),
    );
    return;
  }
  if (message.method === "textDocument/signatureHelp") {
    const params = message.params as TextDocumentPositionParams;
    await respond(
      message.id,
      await signatureHelpAt(
        params.textDocument.uri,
        params.position,
        documents.sourceOverrides(),
        frontendOptions,
        semanticService,
      ),
    );
    return;
  }
  if (message.method === "textDocument/semanticTokens/full") {
    const params = message.params as { textDocument: { uri: string } };
    await respond(
      message.id,
      await semanticTokensFull(
        params.textDocument.uri,
        documents.sourceOverrides(),
        frontendOptions,
        semanticService,
      ),
    );
    return;
  }
  if (message.method === "textDocument/inlayHint") {
    const params = message.params as InlayHintParams;
    await respond(message.id, await inlayHints(params));
    return;
  }
  if (message.method === "textDocument/didClose") {
    workspaceRevision++;
    const params = message.params as DidCloseParams;
    await semanticService.closeDocument(params.textDocument.uri);
    documents.close(params.textDocument.uri);
    frontendV2ParseCache.delete(params.textDocument.uri);
    await semanticService.invalidateUris([params.textDocument.uri]);
    const affectedUris = await projectIndex.affectedUrisForWatchedFiles(
      [params.textDocument.uri],
      documents.sourceOverrides(),
      frontendOptions,
    );
    projectIndex.forgetOpenFile(params.textDocument.uri);
    await refreshSemanticDocumentContexts();
    if (affectedUris.length === 0) affectedUris.push(params.textDocument.uri);
    for (const uri of affectedUris) await publishValidation(uri);
    return;
  }
  if (message.method === "workspace/didChangeWatchedFiles") {
    workspaceRevision++;
    const params = message.params as DidChangeWatchedFilesParams;
    await publishWatchedFileValidation(params.changes);
    return;
  }
  if (message.method === "workman/projectStatus") {
    const params = message.params as { textDocument: { uri: string } };
    await respond(
      message.id,
      await projectStatusForUri(semanticService, params.textDocument.uri),
    );
    return;
  }
  if (message.method !== undefined) {
    await respondError(message.id, -32601, `method not found: ${message.method}`);
  }
}

async function inlayHints(params: InlayHintParams) {
  const uri = params.textDocument.uri;
  const ordinary = typeInlaysEnabled || parameterInlaysEnabled
    ? await semanticInlayHints(
      uri,
      params.range,
      documents.sourceOverrides(),
      frontendOptions,
      {
        typeHints: typeInlaysEnabled,
        parameterHints: parameterInlaysEnabled,
      },
      semanticService,
    )
    : [];
  if (frontendOptions.frontend !== "v2" || !structuralInlaysEnabled) return ordinary;
  const source = documents.get(uri)?.text ?? await runtime.readTextFile(fileUriToPath(uri));
  const frontend = await loadFrontendV2(frontendV2ModuleUrl(frontendOptions));
  const result = frontendV2ParseCache.structural(
    uri,
    source,
    documents.version(uri),
    frontend,
  );
  return [...ordinary, ...structuralInlayHints(source, result, params.range)].sort((left, right) =>
    left.position.line - right.position.line ||
    left.position.character - right.position.character
  );
}

async function publishValidation(uri: string) {
  const started = Date.now();
  const validationKey = projectIndex.fallbackUri(uri);
  log("validate start", uri);
  const results = await validateUri(uri, documents.sourceOverrides(), frontendOptions, {
    frontendV2ParseCache,
    documentVersion: (diagnosticUri) => documents.version(diagnosticUri),
    semanticService,
  });
  const currentUris = new Set(results.map((result) => result.uri));
  await Promise.all(
    results.map((result) => publishDiagnostics(result.uri, result.diagnostics)),
  );
  for (const staleUri of lastPublishedUrisByEntry.get(validationKey) ?? []) {
    if (!currentUris.has(staleUri)) await publishDiagnostics(staleUri, []);
  }
  lastPublishedUrisByEntry.set(validationKey, currentUris);
  log("validate done", uri, `${Date.now() - started}ms`, `results=${results.length}`);
}

async function publishAffectedValidation(uri: string) {
  const started = Date.now();
  await semanticService.invalidateUris([uri]);
  const uris = await projectIndex.affectedUrisForChange(
    uri,
    documents.sourceOverrides(),
    frontendOptions,
  );
  await refreshSemanticDocumentContexts();
  if (uris.length === 0) uris.push(projectIndex.fallbackUri(uri));
  log("affected validate start", uri, `files=${uris.length}`);
  for (const affectedUri of uris) await publishValidation(affectedUri);
  log("affected validate done", uri, `${Date.now() - started}ms`, `files=${uris.length}`);
}

async function publishWatchedFileValidation(changes: DidChangeWatchedFilesParams["changes"]) {
  const started = Date.now();
  const uris = changes.map((change) => change.uri);
  await semanticService.invalidateUris(uris);
  const deletedUris = new Set(
    changes.filter((change) => change.type === 3 && !documents.get(change.uri)).map((change) =>
      projectIndex.fallbackUri(change.uri)
    ),
  );
  const affectedUris = await projectIndex.affectedUrisForWatchedFiles(
    uris,
    documents.sourceOverrides(),
    frontendOptions,
  );
  await refreshSemanticDocumentContexts();
  log("watched validate start", `changed=${uris.length}`, `files=${affectedUris.length}`);
  for (const uri of deletedUris) {
    frontendV2ParseCache.delete(uri);
    lastPublishedUrisByEntry.delete(uri);
    await publishDiagnostics(uri, []);
  }
  for (const uri of affectedUris) {
    if (!deletedUris.has(uri)) await publishValidation(uri);
  }
  log("watched validate done", `${Date.now() - started}ms`, `files=${affectedUris.length}`);
}

async function refreshSemanticDocumentContexts(): Promise<void> {
  for (const uri of documents.uris()) await semanticService.documentContext(uri);
}

async function publishDiagnostics(uri: string, diagnostics: unknown[]) {
  const version = documents.version(uri);
  log(
    "publish diagnostics",
    uri,
    `count=${diagnostics.length}`,
    version === undefined ? "version=-" : `version=${version}`,
  );
  await notify("textDocument/publishDiagnostics", { uri, diagnostics, version });
}

async function respond(id: RpcMessage["id"], result: unknown) {
  if (id === undefined) return;
  const claim = claimRequestResponse(id);
  if (claim.kind === "skip") return;
  if (claim.kind === "error") {
    await writeRpcError(id, claim.code, claim.message);
    return;
  }
  log("send result", `id=${String(id)}`);
  await write({ jsonrpc: "2.0", id, result });
}

async function respondError(id: RpcMessage["id"], code: number, message: string) {
  if (id === undefined) return;
  const claim = claimRequestResponse(id);
  if (claim.kind === "skip") return;
  if (claim.kind === "error") {
    await writeRpcError(id, claim.code, claim.message);
    return;
  }
  await writeRpcError(id, code, message);
}

function claimRequestResponse(id: RpcMessage["id"]):
  | Readonly<{ kind: "normal" }>
  | Readonly<{ kind: "skip" }>
  | Readonly<{ kind: "error"; code: number; message: string }> {
  const state = requestStates.get(requestKey(id));
  if (!state) return { kind: "normal" };
  if (state.responded) return { kind: "skip" };
  state.responded = true;
  if (state.cancelled) {
    return { kind: "error", code: -32800, message: "request cancelled" };
  }
  if (state.revision !== workspaceRevision) {
    return { kind: "error", code: -32801, message: "document state changed during request" };
  }
  return { kind: "normal" };
}

async function writeRpcError(id: RpcMessage["id"], code: number, message: string) {
  log("send error", `id=${String(id)}`, `code=${code}`, message);
  await write({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

async function notify(method: string, params: unknown) {
  log("send notify", method);
  await write({ jsonrpc: "2.0", method, params });
}

async function write(message: RpcMessage) {
  const payload = encodeMessage(message);
  const pending = writeChain.then(async () => {
    await writeAll(payload);
  });
  writeChain = pending.catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
  });
  await pending;
}

async function writeAll(payload: Uint8Array<ArrayBufferLike>) {
  if (!process.stdout.write(payload)) await once(process.stdout, "drain");
}

function concat(
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
  const out = new Uint8Array(left.length + right.length);
  out.set(left);
  out.set(right, left.length);
  return out;
}

function log(...parts: string[]) {
  console.error(`[wm-lsp] ${parts.join(" ")}`);
}

function summarize(message: RpcMessage): string {
  const id = message.id === undefined ? "-" : String(message.id);
  const method = message.method ?? "<result/error>";
  return `id=${id} method=${method}`;
}

function showError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function frontendOptionsFromEnv(): CompilerFrontendOptions {
  const mode = process.env.WORKMAN_FRONTEND ?? process.env.WM_MINI_FRONTEND;
  const frontend = mode === "v2" || mode === "compare" || mode === "v1" ? mode : undefined;
  const modulePath = (
    process.env.WORKMAN_FRONTEND_V2_MODULE ??
      process.env.WM_MINI_FRONTEND_V2_MODULE
  )?.trim();
  return {
    ...(frontend ? { frontend } : {}),
    ...(modulePath ? { frontendV2ModuleUrl: pathToFileUrl(modulePath) } : {}),
  };
}

function applyInitializationOptions(options: WorkmanInitializationOptions | undefined): void {
  if (!options) return;
  frontendOptions = {
    ...frontendOptions,
    ...(options.frontend ? { frontend: options.frontend } : {}),
    ...(options.frontendV2Module
      ? { frontendV2ModuleUrl: pathToFileUrl(options.frontendV2Module) }
      : {}),
  };
  if (options.structuralInlayHints !== undefined) {
    structuralInlaysEnabled = options.structuralInlayHints;
  }
  if (options.typeInlayHints !== undefined) typeInlaysEnabled = options.typeInlayHints;
  if (options.parameterInlayHints !== undefined) {
    parameterInlaysEnabled = options.parameterInlayHints;
  }
}

export function frontendV2ModuleUrl(options: CompilerFrontendOptions): string | URL {
  return options.frontendV2ModuleUrl ??
    new URL("../../tooling/frontend-v2/frontend-v2.generated.mjs", import.meta.url);
}

function pathToFileUrl(path: string): URL | string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return path;
  return pathToFileURL(path.startsWith("/") ? path : `${process.cwd()}/${path}`);
}

type WorkmanInitializationOptions = {
  frontend?: "v1" | "v2" | "compare";
  frontendV2Module?: string;
  structuralInlayHints?: boolean;
  typeInlayHints?: boolean;
  parameterInlayHints?: boolean;
};

type WorkmanInitializeParams = InitializeParams & {
  initializationOptions?: WorkmanInitializationOptions;
};

type DidOpenParams = {
  textDocument: { uri: string; version?: number; text: string };
};

type DidChangeParams = {
  textDocument: { uri: string; version?: number };
  contentChanges: { text: string }[];
};

type DidCloseParams = {
  textDocument: { uri: string };
};

type DidSaveParams = {
  textDocument: { uri: string };
};

type HoverParams = {
  textDocument: { uri: string };
  position: { line: number; character: number };
};

type TextDocumentPositionParams = HoverParams;

type ReferenceParams = TextDocumentPositionParams & {
  context?: { includeDeclaration?: boolean };
};

type RenameParams = TextDocumentPositionParams & {
  newName: string;
};

type InlayHintParams = {
  textDocument: { uri: string };
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

type DidChangeWatchedFilesParams = {
  changes: { uri: string; type?: number }[];
};
