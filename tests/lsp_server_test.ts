import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";
import { DocumentStore } from "../src/lsp/documents.ts";
import { decodeMessages, encodeMessage, type RpcMessage } from "../src/lsp/rpc.ts";
import { fileUriToPath, pathToFileUri } from "../src/lsp/uri.ts";
import { validateUri, type ValidationResult } from "../src/lsp/validation.ts";

Deno.test("lsp server publishes diagnostics for didOpen", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri,
          languageId: "wm",
          version: 1,
          text: "let x: String = 1;",
        },
      },
    },
    { jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  assertEquals(messages.find((message) => message.id === 1)?.result, {
    capabilities: {
      textDocumentSync: { openClose: true, change: 1, save: true },
      hoverProvider: true,
    },
    serverInfo: { name: "wm-mini-lsp", version: "0.0.1" },
  });
  const published = messages.find((message) =>
    message.method === "textDocument/publishDiagnostics"
  );
  const params = published?.params as { diagnostics: { code: string }[] } | undefined;
  assertEquals(params?.diagnostics.map((diagnostic) => diagnostic.code), ["type.mismatch"]);
});

Deno.test("lsp server publishes closed imported file diagnostics", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(lib, "export let value = 1 + true;");
  await Deno.writeTextFile(main, 'from "./lib.wm" import * as Lib; let x = Lib.value;');
  const uri = pathToFileUri(main);
  const libUri = pathToFileUri(lib);
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri,
          languageId: "wm",
          version: 1,
          text: await Deno.readTextFile(main),
        },
      },
    },
    { jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const publishes = messages.filter((message) =>
    message.method === "textDocument/publishDiagnostics"
  );
  const mainPublish = publishes.find((message) => (message.params as { uri: string }).uri === uri);
  const libPublish = publishes.find((message) =>
    (message.params as { uri: string }).uri === libUri
  );
  assertEquals((mainPublish?.params as { diagnostics: unknown[] }).diagnostics, []);
  assertEquals(
    (libPublish?.params as { diagnostics: { code: string }[] }).diagnostics.map((d) => d.code),
    ["type.mismatch"],
  );
});

Deno.test("lsp server clears diagnostics after didChange", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: { uri, languageId: "wm", version: 1, text: "let x: String = 1;" },
      },
    },
    {
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: 'let x: String = "ok";' }],
      },
    },
    { jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const publishes = messages.filter((message) =>
    message.method === "textDocument/publishDiagnostics"
  );
  const mainPublishes = publishes.filter((message) =>
    (message.params as { uri: string }).uri === uri
  );
  assertEquals(
    mainPublishes.length,
    2,
    JSON.stringify(mainPublishes.map((message) => message.params), null, 2),
  );
  const first = mainPublishes[0].params as { diagnostics: { code: string }[] };
  const second = mainPublishes[1].params as { diagnostics: { code: string }[] };
  assertEquals(first.diagnostics.map((diagnostic) => diagnostic.code), ["type.mismatch"]);
  assertEquals(second.diagnostics, []);
});

Deno.test("lsp server revalidates open files after imported file changes", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(lib, "export let value = 1;");
  await Deno.writeTextFile(main, 'from "./lib.wm" import * as Lib; let x: String = Lib.value;');
  const uri = pathToFileUri(main);
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri,
          languageId: "wm",
          version: 1,
          text: await Deno.readTextFile(main),
        },
      },
    },
    async () => {
      await delay(700);
      await Deno.writeTextFile(lib, 'export let value = "ok";');
      await delay(200);
    },
    {
      jsonrpc: "2.0",
      method: "workspace/didChangeWatchedFiles",
      params: { changes: [{ uri: pathToFileUri(lib), type: 2 }] },
    },
    async () => {
      await delay(100);
    },
    { jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const publishes = messages.filter((message) =>
    message.method === "textDocument/publishDiagnostics"
  );
  const mainPublishes = publishes.filter((message) =>
    (message.params as { uri: string }).uri === uri
  );
  assertEquals(
    mainPublishes.length,
    2,
    JSON.stringify(publishes.map((message) => message.params), null, 2),
  );
  const first = mainPublishes[0].params as { diagnostics: { code: string }[] };
  const second = mainPublishes[1].params as { diagnostics: { code: string }[] };
  assertEquals(first.diagnostics.map((diagnostic) => diagnostic.code), ["type.mismatch"]);
  assertEquals(second.diagnostics, []);
});

Deno.test("lsp server revalidates unopened dependents after dependency edits", async () => {
  const dir = await Deno.makeTempDir();
  const http = `${dir}/http.wm`;
  const server = `${dir}/server.wm`;
  await Deno.writeTextFile(http, "export let dispatch = (req, info) => { req + info };");
  await Deno.writeTextFile(
    server,
    'from "./http.wm" import * as Http; let handler = Http.dispatch(1, 2);',
  );
  const httpUri = pathToFileUri(http);
  const serverUri = pathToFileUri(server);

  const messages = await runLsp([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        rootUri: pathToFileUri(dir),
        workspaceFolders: [{ uri: pathToFileUri(dir), name: "test" }],
      },
    },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: httpUri,
          languageId: "wm",
          version: 1,
          text: await Deno.readTextFile(http),
        },
      },
    },
    {
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: { uri: httpUri, version: 2 },
        contentChanges: [{ text: "export let dispatch = (req) => { req + 1 };" }],
      },
    },
    async () => {
      await delay(150);
    },
    { jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const publishes = messages.filter((message) =>
    message.method === "textDocument/publishDiagnostics"
  );
  const serverPublishes = publishes.filter((message) =>
    (message.params as { uri: string }).uri === serverUri
  );
  const last = serverPublishes.at(-1)?.params as
    | { diagnostics: { code: string }[] }
    | undefined;
  assertEquals(last?.diagnostics.map((diagnostic) => diagnostic.code), ["type.mismatch"]);
});

Deno.test("lsp server skips unchanged diagnostic publishes", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: { uri, languageId: "wm", version: 1, text: "let x: String = 1;" },
      },
    },
    {
      jsonrpc: "2.0",
      method: "textDocument/didSave",
      params: { textDocument: { uri } },
    },
    { jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const publishes = messages.filter((message) =>
    message.method === "textDocument/publishDiagnostics"
  );
  assertEquals(publishes.length, 1);
});

Deno.test("lsp server returns hover types", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: { uri, languageId: "wm", version: 1, text: "let id = (x) => { x };" },
      },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/hover",
      params: { textDocument: { uri }, position: { line: 0, character: 5 } },
    },
    { jsonrpc: "2.0", id: 3, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const hover = messages.find((message) => message.id === 2)?.result as {
    contents: { value: string };
  };
  assertEquals(hover.contents.value, "```wm\nid: ('a) => 'a\n```");
});

Deno.test("lsp server returns constructor hover types", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const text = "type Option<T> = None | Some<T>; let x = Some(1);";
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId: "wm", version: 1, text } },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/hover",
      params: { textDocument: { uri }, position: { line: 0, character: text.lastIndexOf("Some") } },
    },
    { jsonrpc: "2.0", id: 3, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const hover = messages.find((message) => message.id === 2)?.result as {
    contents: { value: string };
  };
  assertEquals(
    hover.contents.value,
    "```wm\nSome\ntype: (Number) => Option<Number>\ngeneral: (T) => Option<T>\n```",
  );
});

Deno.test("lsp server returns null for hover misses", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId: "wm", version: 1, text: "let x = 1;" } },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/hover",
      params: { textDocument: { uri }, position: { line: 0, character: 3 } },
    },
    { jsonrpc: "2.0", id: 3, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  assertEquals(messages.find((message) => message.id === 2)?.result, null);
});

async function runLsp(steps: (RpcMessage | (() => Promise<void>))[]): Promise<RpcMessage[]> {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-env", "--allow-run", "src/lsp/server.ts"],
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  for (const step of steps) {
    if (typeof step === "function") await step();
    else await writer.write(encodeMessage(step));
  }
  await writer.close();
  const output = await child.output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  return decodeMessages(output.stdout).messages;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
