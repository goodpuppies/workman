import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";
import { compileLibraryFile } from "../src/compiler.ts";
import { decodeMessages, encodeMessage, type RpcMessage } from "../src/lsp/rpc.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;

Deno.test("lsp server can launch validation in frontend v2 mode", async () => {
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
            text: "let x = 1\nlet ok = true;",
          },
        },
      },
      { jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
      { jsonrpc: "2.0", method: "exit", params: null },
    ],
    {
      WORKMAN_FRONTEND: "v2",
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
  assertEquals(params?.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.severity]), [
    ["parse.let.missing-semicolon", 2],
  ]);
});

Deno.test("lsp server publishes multiple frontend v2 structural diagnostics", async () => {
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
      WORKMAN_FRONTEND: "v2",
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
  assertEquals(params?.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.severity]), [
    ["parse.let.missing-semicolon", 2],
    ["parse.let.missing-semicolon", 2],
  ]);
});

async function runLsp(
  steps: RpcMessage[],
  env: Record<string, string>,
): Promise<RpcMessage[]> {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-env", "--allow-run", "src/lsp/server.ts"],
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
  const output = (await Deno.makeTempDir()) + "/frontend-v2.mjs";
  await Deno.writeTextFile(output, await compileLibraryFile(frontendSource));
  return new URL("file://" + output);
}
