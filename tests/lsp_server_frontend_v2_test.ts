import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";
import { decodeMessages, encodeMessage, type RpcMessage } from "../src/lsp/rpc.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";

Deno.test("lsp server launches with generated frontend validation", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const messages = await runLsp(
    [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          initializationOptions: {
            typeInlayHints: false,
            parameterInlayHints: false,
            structuralInlayHints: true,
          },
        },
      },
      {
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri,
            languageId: "wm",
            version: 1,
            text: "let x = 1\nlet ok = true;",
          },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "textDocument/inlayHint",
        params: {
          textDocument: { uri },
          range: {
            start: { line: 0, character: 0 },
            end: { line: 1, character: 14 },
          },
        },
      },
      { jsonrpc: "2.0", id: 3, method: "shutdown", params: null },
      { jsonrpc: "2.0", method: "exit", params: null },
    ],
    {},
  );

  const published = messages.find((message) =>
    message.method === "textDocument/publishDiagnostics"
  );
  const params = published?.params as
    | { diagnostics: { code: string; severity: number }[]; version?: number }
    | undefined;
  assertEquals(params?.version, 1);
  assertEquals(
    params?.diagnostics.map((
      diagnostic,
    ) => [diagnostic.code, diagnostic.severity]),
    [
      ["parse.let.missing-semicolon", 2],
    ],
  );
  assertEquals(
    (messages.find((message) => message.id === 1)?.result as {
      capabilities: { inlayHintProvider?: boolean };
    }).capabilities.inlayHintProvider,
    true,
  );
  const hints = messages.find((message) => message.id === 2)?.result as {
    label: string;
    position: { line: number; character: number };
  }[];
  assertEquals(hints.map((hint) => [hint.label, hint.position]), [
    [";", { line: 0, character: 9 }],
  ]);
});

Deno.test("lsp server publishes multiple generated structural diagnostics", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const messages = await runLsp(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      {
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri,
            languageId: "wm",
            version: 1,
            text: 'let x = 1\nlet ok = true\nlet label = "ready";',
          },
        },
      },
      { jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
      { jsonrpc: "2.0", method: "exit", params: null },
    ],
    {
      WORKMAN_FRONTEND_V2_MODULE: frontendV2ModuleUrl.href,
    },
  );

  const published = messages.find((message) =>
    message.method === "textDocument/publishDiagnostics"
  );
  const params = published?.params as
    | { diagnostics: { code: string; severity: number }[]; version?: number }
    | undefined;
  assertEquals(params?.version, 1);
  assertEquals(
    params?.diagnostics.map((
      diagnostic,
    ) => [diagnostic.code, diagnostic.severity]),
    [
      ["parse.let.missing-semicolon", 2],
      ["parse.let.missing-semicolon", 2],
    ],
  );
});

Deno.test("lsp server reports generated rejection without legacy hole inlays", async () => {
  const frontendV2ModuleUrl = await buildFrontendV2();
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const source = "let =";
  const messages = await runLsp(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      {
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: { uri, languageId: "wm", version: 1, text: source },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "textDocument/inlayHint",
        params: {
          textDocument: { uri },
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: source.length },
          },
        },
      },
      { jsonrpc: "2.0", id: 3, method: "shutdown", params: null },
      { jsonrpc: "2.0", method: "exit", params: null },
    ],
    {
      WORKMAN_FRONTEND_V2_MODULE: frontendV2ModuleUrl.href,
    },
  );

  const published = messages.find((message) =>
    message.method === "textDocument/publishDiagnostics"
  );
  const params = published?.params as
    | {
      diagnostics: {
        code: string;
        message: string;
        range: { start: { line: number; character: number } };
      }[];
    }
    | undefined;
  assertEquals(
    params?.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      start: diagnostic.range.start,
    })),
    [{
      code: "parse.syntax-error",
      message: "Expected a binding pattern while parsing LetPattern.",
      start: { line: 0, character: 4 },
    }],
  );
  assertEquals(messages.find((message) => message.id === 2)?.result, []);
});

async function runLsp(
  steps: RpcMessage[],
  env: Record<string, string>,
): Promise<RpcMessage[]> {
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-run",
      "src/lsp/server.ts",
    ],
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  for (const step of steps) await writer.write(encodeMessage(step));
  await writer.close();
  const output = await child.output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  return decodeMessages(output.stdout).messages;
}

async function buildFrontendV2(): Promise<URL> {
  return new URL("../src/generated/frontend_v2_parser.js", import.meta.url);
}
