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
      positionEncoding: "utf-16",
      textDocumentSync: { openClose: true, change: 1, save: true },
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
          tokenTypes: [
            "namespace",
            "type",
            "typeParameter",
            "parameter",
            "variable",
            "property",
            "enumMember",
            "function",
          ],
          tokenModifiers: ["declaration", "readonly", "defaultLibrary"],
        },
        full: true,
      },
      inlayHintProvider: true,
    },
    serverInfo: { name: "workman-lsp", version: "0.0.1" },
  });
  const published = messages.find((message) =>
    message.method === "textDocument/publishDiagnostics"
  );
  const params = published?.params as
    | { diagnostics: { code: string }[]; version?: number }
    | undefined;
  assertEquals(params?.version, 1);
  assertEquals(params?.diagnostics.map((diagnostic) => diagnostic.code), ["type.mismatch"]);
});

Deno.test("lsp server enforces lifecycle and returns standard JSON-RPC errors", async () => {
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "workspace/symbol", params: { query: "" } },
    { jsonrpc: "2.0", id: 2, method: "initialize", params: {} },
    { jsonrpc: "2.0", method: "initialized", params: {} },
    { jsonrpc: "2.0", id: 3, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 4, method: "workman/unknown", params: {} },
    { jsonrpc: "2.0", id: 7 },
    { jsonrpc: "2.0", id: 5, method: "shutdown", params: null },
    { jsonrpc: "2.0", id: 6, method: "workspace/symbol", params: { query: "" } },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  assertEquals(messages.find(({ id }) => id === 1)?.error, {
    code: -32002,
    message: "server not initialized",
  });
  assertEquals(messages.find(({ id }) => id === 3)?.error, {
    code: -32600,
    message: "initialize may only be requested once",
  });
  assertEquals(messages.find(({ id }) => id === 4)?.error, {
    code: -32601,
    message: "method not found: workman/unknown",
  });
  assertEquals(messages.find(({ id }) => id === 7)?.error, {
    code: -32600,
    message: "invalid request",
  });
  assertEquals(messages.find(({ id }) => id === 5)?.result, null);
  assertEquals(messages.find(({ id }) => id === 6)?.error, {
    code: -32600,
    message: "server has shut down",
  });
});

Deno.test("lsp server cancels requests and rejects results from older document state", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    [
      { jsonrpc: "2.0", id: 2, method: "workspace/symbol", params: { query: "" } },
      { jsonrpc: "2.0", method: "$/cancelRequest", params: { id: 2 } },
    ],
    [
      { jsonrpc: "2.0", id: 3, method: "workspace/symbol", params: { query: "" } },
      {
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri,
            languageId: "wm",
            version: 1,
            text: "let main = () => { 0 };",
          },
        },
      },
    ],
    { jsonrpc: "2.0", id: 4, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  assertEquals(messages.find(({ id }) => id === 2)?.error, {
    code: -32800,
    message: "request cancelled",
  });
  assertEquals(messages.find(({ id }) => id === 3)?.error, {
    code: -32801,
    message: "document state changed during request",
  });
});

Deno.test("all independent inlay providers can be disabled", async () => {
  const messages = await runLsp(
    [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          initializationOptions: {
            structuralInlayHints: false,
            typeInlayHints: false,
            parameterInlayHints: false,
          },
        },
      },
      { jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
      { jsonrpc: "2.0", method: "exit", params: null },
    ],
  );

  const capabilities = (messages.find((message) => message.id === 1)?.result as {
    capabilities: { inlayHintProvider?: boolean };
  }).capabilities;
  assertEquals(capabilities.inlayHintProvider, undefined);
});

Deno.test("parameter-name inlays can remain enabled without type inlays", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const source = "let add = (left, right) => { left + right }; let result = add(1, 2);";
  const messages = await runLsp([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        initializationOptions: {
          typeInlayHints: false,
          parameterInlayHints: true,
        },
      },
    },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId: "wm", version: 1, text: source } },
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
  ]);

  const capabilities = (messages.find((message) => message.id === 1)?.result as {
    capabilities: { inlayHintProvider?: boolean };
  }).capabilities;
  assertEquals(capabilities.inlayHintProvider, true);
  const hints = messages.find((message) => message.id === 2)?.result as {
    label: string;
    kind: number;
  }[];
  assertEquals(hints.map(({ label, kind }) => [label, kind]), [
    ["left:", 2],
    ["right:", 2],
  ]);
});

Deno.test("lsp server clears diagnostics for a deleted watched file", async () => {
  const dir = await Deno.makeTempDir();
  const deletedUri = pathToFileUri(`${dir}/moved.wm`);
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "workspace/didChangeWatchedFiles",
      params: { changes: [{ uri: deletedUri, type: 3 }] },
    },
    { jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const publishes = messages.filter((message) =>
    message.method === "textDocument/publishDiagnostics" &&
    (message.params as { uri: string }).uri === deletedUri
  );
  assertEquals(publishes.length, 1);
  assertEquals((publishes[0].params as { diagnostics: unknown[] }).diagnostics, []);
});

Deno.test("lsp server returns definitions for Ctrl+Click", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const source = "let identity = (x) => { x }; let result = identity(1);";
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId: "wm", version: 1, text: source } },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/definition",
      params: { textDocument: { uri }, position: { line: 0, character: 44 } },
    },
    { jsonrpc: "2.0", id: 3, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  assertEquals(messages.find((message) => message.id === 2)?.result, {
    uri,
    range: { start: { line: 0, character: 4 }, end: { line: 0, character: 12 } },
  });
});

Deno.test("lsp server returns type definitions and document highlights", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const source = "record Point = { x: Number }; let point = Point(1); let use = point;";
  const position = { line: 0, character: source.lastIndexOf("point") + 1 };
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId: "wm", version: 1, text: source } },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/typeDefinition",
      params: { textDocument: { uri }, position },
    },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "textDocument/documentHighlight",
      params: { textDocument: { uri }, position },
    },
    { jsonrpc: "2.0", id: 4, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  assertEquals(messages.find((message) => message.id === 2)?.result, [{
    uri,
    range: {
      start: { line: 0, character: source.indexOf("Point") },
      end: { line: 0, character: source.indexOf("Point") + 5 },
    },
  }]);
  const highlights = messages.find((message) => message.id === 3)?.result as unknown[];
  assertEquals(highlights.length, 2);
});

Deno.test("lsp server returns ordinary compiler-owned completion items", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const source = "let outer = 1; let result = ou";
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId: "wm", version: 1, text: source } },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/completion",
      params: {
        textDocument: { uri },
        position: { line: 0, character: source.length },
      },
    },
    { jsonrpc: "2.0", id: 3, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const items = messages.find((message) => message.id === 2)?.result as {
    label: string;
    kind: number;
  }[];
  assertEquals(items.map(({ label, kind }) => ({ label, kind })), [{
    label: "outer",
    kind: 6,
  }]);
});

Deno.test("lsp server returns standard signature help", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const source =
    'let format = (count: Number, label: String) => { label }; let result = format(1, "x");';
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId: "wm", version: 1, text: source } },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/signatureHelp",
      params: {
        textDocument: { uri },
        position: { line: 0, character: source.indexOf('"x"') },
      },
    },
    { jsonrpc: "2.0", id: 3, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  assertEquals(messages.find((message) => message.id === 2)?.result, {
    signatures: [{
      label: "format(count: Number, label: String) -> String",
      parameters: [
        { label: "count: Number" },
        { label: "label: String" },
      ],
    }],
    activeSignature: 0,
    activeParameter: 1,
  });
});

Deno.test("lsp server returns standard full semantic tokens", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const source = "let identity = (value) => { value }; let result = identity(1);";
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId: "wm", version: 1, text: source } },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/semanticTokens/full",
      params: { textDocument: { uri } },
    },
    { jsonrpc: "2.0", id: 3, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const result = messages.find((message) => message.id === 2)?.result as {
    data: number[];
  };
  assertEquals(result.data.slice(0, 5), [0, 4, "identity".length, 7, 1]);
  assertEquals(result.data.length, 25);
});

Deno.test("lsp server returns symbols from active projects only", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const lib = `${dir}/lib.wm`;
  const unrelated = `${dir}/unrelated.wm`;
  await Deno.writeTextFile(
    main,
    'from "./lib.wm" import { helper }; let main = () => { helper };',
  );
  await Deno.writeTextFile(lib, "let helper = 1;");
  await Deno.writeTextFile(unrelated, "let unrelated = 2;");
  const uri = pathToFileUri(main);
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
          uri,
          languageId: "wm",
          version: 1,
          text: await Deno.readTextFile(main),
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "workspace/symbol",
      params: { query: "" },
    },
    { jsonrpc: "2.0", id: 3, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const symbols = messages.find((message) => message.id === 2)?.result as {
    name: string;
    kind: number;
  }[];
  assertEquals(symbols.some(({ name, kind }) => name === "main" && kind === 12), true);
  assertEquals(symbols.some(({ name }) => name === "helper"), true);
  assertEquals(symbols.some(({ name }) => name === "unrelated"), false);
});

Deno.test("lsp server returns ordinary inferred-type inlays", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const source = "let increment = (value) => { value + 1 };";
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId: "wm", version: 1, text: source } },
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
  ]);

  const hints = messages.find((message) => message.id === 2)?.result as {
    label: string;
    kind: number;
    position: { line: number; character: number };
    tooltip: { kind: string; value: string };
    paddingLeft: boolean;
    paddingRight: boolean;
    data: { kind: string; category: string };
  }[];
  assertEquals(hints, [
    {
      position: { line: 0, character: "let increment".length },
      label: ": Number -> Number",
      kind: 1,
      tooltip: { kind: "markdown", value: "```workman\nNumber -> Number\n```" },
      paddingLeft: false,
      paddingRight: true,
      data: { kind: "workman.inferred-type", category: "binding" },
    },
    {
      position: { line: 0, character: "let increment = (value".length },
      label: ": Number",
      kind: 1,
      tooltip: { kind: "markdown", value: "```workman\nNumber\n```" },
      paddingLeft: false,
      paddingRight: true,
      data: { kind: "workman.inferred-type", category: "parameter" },
    },
  ]);
});

Deno.test("lsp server prepares and returns standard workspace rename edits", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const uri = pathToFileUri(main);
  const source = "let value = 1; let result = value;";
  const position = { line: 0, character: source.lastIndexOf("value") + 1 };
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId: "wm", version: 1, text: source } },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/prepareRename",
      params: { textDocument: { uri }, position },
    },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "textDocument/rename",
      params: { textDocument: { uri }, position, newName: "answer" },
    },
    { jsonrpc: "2.0", id: 4, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  assertEquals(messages.find((message) => message.id === 2)?.result, {
    range: {
      start: { line: 0, character: source.lastIndexOf("value") },
      end: { line: 0, character: source.lastIndexOf("value") + 5 },
    },
    placeholder: "value",
  });
  const edit = messages.find((message) => message.id === 3)?.result as {
    changes: Record<string, unknown[]>;
  };
  assertEquals(edit.changes[uri].length, 2);
});

Deno.test("lsp server publishes closed imported file diagnostics", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(lib, "let value = 1 + true;");
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
  const first = mainPublishes[0].params as { diagnostics: { code: string }[]; version?: number };
  const second = mainPublishes[1].params as { diagnostics: { code: string }[]; version?: number };
  assertEquals(first.version, 1);
  assertEquals(first.diagnostics.map((diagnostic) => diagnostic.code), ["type.mismatch"]);
  assertEquals(second.version, 2);
  assertEquals(second.diagnostics, []);
});

Deno.test("lsp server clears project diagnostics after didClose", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(lib, "let value = 1 + true;");
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
    {
      jsonrpc: "2.0",
      method: "textDocument/didClose",
      params: { textDocument: { uri } },
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
  const libPublishes = publishes.filter((message) =>
    (message.params as { uri: string }).uri === libUri
  );
  assertEquals(
    libPublishes.map((message) =>
      (message.params as { diagnostics: { code: string }[] }).diagnostics.map((d) => d.code)
    ),
    [["type.mismatch"], []],
  );
  assertEquals(
    (mainPublishes.at(-1)!.params as { diagnostics: unknown[] }).diagnostics,
    [],
  );
});

Deno.test("lsp server keeps project diagnostics while another project document is open", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(lib, "let value = 1 + true;");
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
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: libUri,
          languageId: "wm",
          version: 1,
          text: await Deno.readTextFile(lib),
        },
      },
    },
    {
      jsonrpc: "2.0",
      method: "textDocument/didClose",
      params: { textDocument: { uri } },
    },
    { jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const libPublishes = messages.filter((message) =>
    message.method === "textDocument/publishDiagnostics" &&
    (message.params as { uri: string }).uri === libUri
  );
  assertEquals(
    (libPublishes.at(-1)!.params as { diagnostics: { code: string }[] }).diagnostics.map(
      (d) => d.code,
    ),
    ["type.mismatch"],
  );
});

Deno.test("lsp server only clears diagnostics for the closed project graph", async () => {
  const dir = await Deno.makeTempDir();
  const aLib = `${dir}/a_lib.wm`;
  const aMain = `${dir}/a_main.wm`;
  const bMain = `${dir}/b_main.wm`;
  await Deno.writeTextFile(aLib, "let value = 1 + true;");
  await Deno.writeTextFile(aMain, 'from "./a_lib.wm" import * as Lib; let x = Lib.value;');
  await Deno.writeTextFile(bMain, "let y: String = 1;");
  const aMainUri = pathToFileUri(aMain);
  const aLibUri = pathToFileUri(aLib);
  const bMainUri = pathToFileUri(bMain);
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: aMainUri,
          languageId: "wm",
          version: 1,
          text: await Deno.readTextFile(aMain),
        },
      },
    },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: bMainUri,
          languageId: "wm",
          version: 1,
          text: await Deno.readTextFile(bMain),
        },
      },
    },
    {
      jsonrpc: "2.0",
      method: "textDocument/didClose",
      params: { textDocument: { uri: aMainUri } },
    },
    { jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const publishes = messages.filter((message) =>
    message.method === "textDocument/publishDiagnostics"
  );
  const aLibPublishes = publishes.filter((message) =>
    (message.params as { uri: string }).uri === aLibUri
  );
  const bMainPublishes = publishes.filter((message) =>
    (message.params as { uri: string }).uri === bMainUri
  );
  assertEquals(
    (aLibPublishes.at(-1)!.params as { diagnostics: unknown[] }).diagnostics,
    [],
  );
  assertEquals(
    (bMainPublishes.at(-1)!.params as { diagnostics: { code: string }[] }).diagnostics.map(
      (d) => d.code,
    ),
    ["type.mismatch"],
  );
});

Deno.test("lsp server clears diagnostics for files no longer in validation results", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(lib, "let value = 1 + true;");
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
    {
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: "let x = 1;" }],
      },
    },
    { jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const publishes = messages.filter((message) =>
    message.method === "textDocument/publishDiagnostics"
  );
  const libPublishes = publishes.filter((message) =>
    (message.params as { uri: string }).uri === libUri
  );
  assertEquals(
    libPublishes.map((message) =>
      (message.params as { diagnostics: { code: string }[] }).diagnostics.map((d) => d.code)
    ),
    [["type.mismatch"], []],
  );
});

Deno.test("lsp server clears an imported document diagnostic on the next edit", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(lib, "let value = 1;");
  await Deno.writeTextFile(
    main,
    'from "./lib.wm" import { value }; let main = () => { value };',
  );
  const libUri = pathToFileUri(lib);
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
          uri: libUri,
          languageId: "wm",
          version: 1,
          text: await Deno.readTextFile(lib),
        },
      },
    },
    {
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: { uri: libUri, version: 2 },
        contentChanges: [{ text: "let value = 1 + true;" }],
      },
    },
    {
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: { uri: libUri, version: 3 },
        contentChanges: [{ text: "let value = 1;" }],
      },
    },
    { jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const publishes = messages.filter((message) =>
    message.method === "textDocument/publishDiagnostics" &&
    (message.params as { uri: string }).uri === libUri
  );
  assertEquals(
    publishes.map((message) => ({
      codes: (message.params as { diagnostics: { code: string }[] }).diagnostics.map((d) => d.code),
      version: (message.params as { version?: number }).version,
    })),
    [
      { codes: [], version: 1 },
      { codes: ["type.mismatch"], version: 2 },
      { codes: [], version: 3 },
    ],
  );
});

Deno.test("lsp server revalidates open files after imported file changes", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(lib, "let value = 1;");
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
      // Let the initial didOpen validation finish before changing the dependency. Cold Windows
      // process startup can exceed the old 700 ms allowance under the full test suite.
      await delay(1500);
      await Deno.writeTextFile(lib, 'let value = "ok";');
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
  assertEquals(mainPublishes.length >= 2, true);
  const first = mainPublishes[0].params as { diagnostics: { code: string }[] };
  const last = mainPublishes.at(-1)?.params as { diagnostics: { code: string }[] };
  assertEquals(first.diagnostics.map((diagnostic) => diagnostic.code), ["type.mismatch"]);
  assertEquals(last.diagnostics, []);
});

Deno.test("lsp server revalidates the active unopened project head after dependency edits", async () => {
  const dir = await Deno.makeTempDir();
  const http = `${dir}/http.wm`;
  const server = `${dir}/server.wm`;
  await Deno.writeTextFile(http, "let dispatch = (req, info) => { req + info };");
  await Deno.writeTextFile(
    server,
    'from "./http.wm" import * as Http; let handler = Http.dispatch(1, 2); ' +
      "let main = () => { handler };",
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
        contentChanges: [{ text: "let dispatch = (req) => { req + 1 };" }],
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

Deno.test("lsp server republishes unchanged diagnostics on explicit refresh", async () => {
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
  assertEquals(publishes.length, 2);
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
  assertEquals(hover.contents.value, "```wm\nid: 'a -> 'a\n```");
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
    "```wm\nSome\ntype: Number -> Option<Number>\ngeneral: T -> Option<T>\n```",
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

async function runLsp(
  steps: (RpcMessage | readonly RpcMessage[] | (() => Promise<void>))[],
  env: Record<string, string> = {},
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
  for (const step of steps) {
    if (typeof step === "function") await step();
    else if (isMessageBatch(step)) await writer.write(encodeMessageBatch(step));
    else await writer.write(encodeMessage(step));
  }
  await writer.close();
  const output = await child.output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  return decodeMessages(output.stdout).messages;
}

function isMessageBatch(
  step: RpcMessage | readonly RpcMessage[],
): step is readonly RpcMessage[] {
  return Array.isArray(step);
}

function encodeMessageBatch(messages: readonly RpcMessage[]): Uint8Array {
  const encoded = messages.map(encodeMessage);
  const length = encoded.reduce((sum, message) => sum + message.length, 0);
  const batch = new Uint8Array(length);
  let offset = 0;
  for (const message of encoded) {
    batch.set(message, offset);
    offset += message.length;
  }
  return batch;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test("workman/projectStatus reports the selected head and active projects", async () => {
  const dir = await Deno.makeTempDir();
  const libPath = `${dir}/lib.wm`;
  const mainPath = `${dir}/main.wm`;
  await Deno.writeTextFile(libPath, "let value = 1;");
  await Deno.writeTextFile(
    mainPath,
    'from "./lib.wm" import * as Lib; let main = () => { print(Lib.value) };',
  );
  const mainUri = pathToFileUri(mainPath);
  const libUri = pathToFileUri(libPath);
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: mainUri,
          languageId: "wm",
          version: 1,
          text: await Deno.readTextFile(mainPath),
        },
      },
    },
    // The library file is inside the already-active headed project, so opening it
    // must reuse that context rather than searching for another head (D32).
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: libUri,
          languageId: "wm",
          version: 1,
          text: await Deno.readTextFile(libPath),
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "workman/projectStatus",
      params: { textDocument: { uri: mainUri } },
    },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "workman/projectStatus",
      params: { textDocument: { uri: libUri } },
    },
    { jsonrpc: "2.0", id: 4, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const forMain = messages.find((message) => message.id === 2)?.result as {
    selected: { kind: string; headPath: string; moduleCount: number; recovered: boolean };
    activeHeads: { kind: string; headPath: string; containsDocument: boolean }[];
  };
  assertEquals(forMain.selected.kind, "headed");
  assertEquals(fileUriToPath(pathToFileUri(forMain.selected.headPath)), mainPath);
  assertEquals(forMain.selected.moduleCount, 2);
  assertEquals(forMain.selected.recovered, false);

  const forLib = messages.find((message) => message.id === 3)?.result as typeof forMain;
  assertEquals(forLib.selected.kind, "headed");
  assertEquals(fileUriToPath(pathToFileUri(forLib.selected.headPath)), mainPath);
  assertEquals(
    forLib.activeHeads.some((head) =>
      fileUriToPath(pathToFileUri(head.headPath)) === mainPath && head.containsDocument
    ),
    true,
  );
});

Deno.test("workman/projectStatus reports a detached context for a headless file", async () => {
  const dir = await Deno.makeTempDir();
  const lonePath = `${dir}/lone.wm`;
  await Deno.writeTextFile(lonePath, "let value = 1;");
  const loneUri = pathToFileUri(lonePath);
  const messages = await runLsp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: loneUri,
          languageId: "wm",
          version: 1,
          text: "let value = 1;",
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "workman/projectStatus",
      params: { textDocument: { uri: loneUri } },
    },
    { jsonrpc: "2.0", id: 3, method: "shutdown", params: null },
    { jsonrpc: "2.0", method: "exit", params: null },
  ]);

  const status = messages.find((message) => message.id === 2)?.result as {
    selected: { kind: string; headPath: string; moduleCount: number };
  };
  assertEquals(status.selected.kind, "detached");
  assertEquals(fileUriToPath(pathToFileUri(status.selected.headPath)), lonePath);
  assertEquals(status.selected.moduleCount, 1);
});
