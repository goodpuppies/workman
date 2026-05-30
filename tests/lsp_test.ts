import { assertEquals } from "@std/assert";
import { DocumentStore } from "../src/lsp/documents.ts";
import { decodeMessages, encodeMessage, type RpcMessage } from "../src/lsp/rpc.ts";
import { fileUriToPath, pathToFileUri } from "../src/lsp/uri.ts";
import { validateUri, type ValidationResult } from "../src/lsp/validation.ts";

Deno.test("document store exposes source overrides for open files", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/main.wm`;
  await Deno.writeTextFile(path, "let x = 0;");
  const uri = pathToFileUri(path);
  const docs = new DocumentStore();

  docs.open(uri, "let x = 1;", 1);
  assertEquals(docs.sourceOverrides().get(fileUriToPath(uri)), "let x = 1;");

  docs.change(uri, "let x = 2;", 2);
  assertEquals(docs.sourceOverrides().get(fileUriToPath(uri)), "let x = 2;");

  docs.close(uri);
  assertEquals(docs.sourceOverrides().size, 0);
});

Deno.test("lsp validation returns diagnostics for unsaved files and clears them", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(main, "let x = 1;");
  const uri = pathToFileUri(main);
  const docs = new DocumentStore();

  docs.open(uri, "let x: String = 1;", 1);
  const broken = await validateUri(uri, docs.sourceOverrides());
  const brokenDiagnostics = await diagnosticsForPath(broken, main);
  assertEquals(brokenDiagnostics?.map((d) => d.code), ["type.mismatch"]);
  assertEquals(brokenDiagnostics?.[0].range.start, { line: 0, character: 16 });
  assertEquals(brokenDiagnostics?.[0].range.end, { line: 0, character: 17 });

  docs.change(uri, 'let x: String = "ok";', 2);
  const fixed = await validateUri(uri, docs.sourceOverrides());
  assertEquals(await diagnosticsForPath(fixed, main), []);
});

Deno.test("lsp validation uses unsaved imported modules", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(lib, "export let value = 1;");
  await Deno.writeTextFile(main, 'from "./lib.wm" import * as Lib; let x: String = Lib.value;');
  const mainUri = pathToFileUri(main);
  const docs = new DocumentStore();

  docs.open(pathToFileUri(lib), 'export let value = "ok";', 1);
  const results = await validateUri(mainUri, docs.sourceOverrides());
  assertEquals(await diagnosticsForPath(results, main), []);
});

Deno.test("lsp validation reports imported module errors on the imported file", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(lib, "export let value = 1 + true;");
  await Deno.writeTextFile(main, 'from "./lib.wm" import * as Lib; let x = Lib.value;');

  const results = await validateUri(pathToFileUri(main), new Map());
  assertEquals(await diagnosticsForPath(results, main), []);
  const libDiagnostics = await diagnosticsForPath(results, lib);
  assertEquals(libDiagnostics?.map((diagnostic) => diagnostic.code), ["type.mismatch"]);
  assertEquals(libDiagnostics?.[0].range.start, { line: 0, character: 19 });
});

Deno.test("lsp validation localizes recursive binding return mismatches", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
type Int_list = Empty | Cons<Number, Int_list>;

let rec sumList = (list, val) => {
  match(list) => {
    Empty => {val},
    Cons(i, rest) => {sumList(rest, val+i)}
  }
};
`;
  await Deno.writeTextFile(main, source);

  const diagnostics = await diagnosticsForPath(
    await validateUri(pathToFileUri(main), new Map()),
    main,
  );
  assertEquals(diagnostics?.map((diagnostic) => diagnostic.code), ["type.mismatch"]);
  assertEquals(
    diagnostics?.[0].message,
    'type mismatch "Number" vs "(Int_list) => Number"',
  );
  assertEquals(diagnostics?.[0].range.start, { line: 6, character: 22 });
  assertEquals(diagnostics?.[0].range.end, { line: 6, character: 42 });
  assertEquals(
    diagnostics?.[0].relatedInformation?.[0].message,
    "body: (Int_list) => Number",
  );
  assertEquals(diagnostics?.[0].relatedInformation?.[0].location.range.start, {
    line: 4,
    character: 2,
  });
  assertEquals(
    diagnostics?.[0].relatedInformation?.[1].message,
    "rec: occurrences share one monomorphic type",
  );
  assertEquals(diagnostics?.[0].relatedInformation?.[1].location.range.start, {
    line: 3,
    character: 8,
  });
  assertEquals(diagnostics?.[0].relatedInformation?.[2].message, "operator +: Number");
  assertEquals(diagnostics?.[0].relatedInformation?.[2].location.range.start, {
    line: 6,
    character: 36,
  });
});

Deno.test("lsp validation relates call argument provenance through published bindings", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
type Int_list = Empty | Cons<Number, Int_list>;

let rec sumList = (list) => {
  let rec inner = (list, acc) => {
    match(list) {
      Empty => {acc},
      Cons(i, rest) => {inner(rest, acc+i)}
    }
  };
  inner(list)
};

let bad = sumList(Cons(1, Empty));
`;
  await Deno.writeTextFile(main, source);

  const diagnostics = await diagnosticsForPath(
    await validateUri(pathToFileUri(main), new Map()),
    main,
  );
  assertEquals(diagnostics?.map((diagnostic) => diagnostic.code), ["type.mismatch"]);
  assertEquals(
    diagnostics?.[0].message,
    'type mismatch expected "(Int_list, Number)", got "Int_list"',
  );
  assertEquals(diagnostics?.[0].range.start, {
    line: 10,
    character: 2,
  });
});

Deno.test("lsp validation localizes recursive mismatches at first tuple-shape divergence", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
type List<T> = Nil | Cons<T, List<T>>;

let rec foldLeft = (fn, num, list) => {
  let rec inner = (fn, acc, list) => {
    match(list) {
      [] => {acc},
      [head, ..tail] => {
        inner(fn, fn(acc, head), tail)
      }
    }
  };
  inner(fn, num, list)
};

let rec sumList = (list) => {
  foldLeft((a,b)=> {a+b}, list)
};
`;
  await Deno.writeTextFile(main, source);

  const diagnostics = await diagnosticsForPath(
    await validateUri(pathToFileUri(main), new Map()),
    main,
  );
  assertEquals(diagnostics?.map((diagnostic) => diagnostic.code), ["type.mismatch"]);
  assertEquals(diagnostics?.[0].range.start, {
    line: 16,
    character: 2,
  });
  assertEquals(
    diagnostics?.[0].relatedInformation?.find((item) => item.message.startsWith("callee foldLeft"))
      ?.location.range.start,
    {
      line: 16,
      character: 2,
    },
  );
});

Deno.test("lsp validation localizes missing recursive tuple args at inner callsite", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
type List<T> = Nil | Cons<T, List<T>>;

let rec foldLeft = (fn, list) => {
  let rec inner = (fn, acc, list) => {
    match(list) {
      [] => {acc},
      [head, ..tail] => {
        inner(fn, fn(acc, head), tail)
      }
    }
  };
  inner(fn)
};

let rec sumList = (list) => {
  foldLeft((a,b)=> {a+b}, list)
};
`;
  await Deno.writeTextFile(main, source);

  const diagnostics = await diagnosticsForPath(
    await validateUri(pathToFileUri(main), new Map()),
    main,
  );
  assertEquals(diagnostics?.map((diagnostic) => diagnostic.code), ["type.mismatch"]);
  assertEquals(diagnostics?.[0].range.start, {
    line: 12,
    character: 2,
  });
  assertEquals(diagnostics?.[0].range.end, {
    line: 12,
    character: 11,
  });
  assertEquals(
    diagnostics?.[0].relatedInformation?.find((item) => item.message.startsWith("callee foldLeft"))
      ?.location.range.start,
    {
      line: 16,
      character: 2,
    },
  );
});

Deno.test("lsp validation explains call argument expected and callee types", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
from js.global("Math") import { floor };

let bad = floor(1, 2);
`;
  await Deno.writeTextFile(main, source);

  const diagnostics = await diagnosticsForPath(
    await validateUri(pathToFileUri(main), new Map()),
    main,
  );
  assertEquals(diagnostics?.map((diagnostic) => diagnostic.code), ["type.mismatch"]);
  assertEquals(
    diagnostics?.[0].message,
    'type mismatch expected "Number", got "(Number, Number)"',
  );
  assertEquals(diagnostics?.[0].range.start, { line: 3, character: 10 });
  assertEquals(diagnostics?.[0].range.end, { line: 3, character: 21 });
  assertEquals(
    diagnostics?.[0].relatedInformation?.[0].message,
    "callee floor: (Number) => Number",
  );
  assertEquals(diagnostics?.[0].relatedInformation?.[0].location.range.start, {
    line: 3,
    character: 10,
  });
  assertEquals(diagnostics?.[0].relatedInformation?.[0].location.range.end, {
    line: 3,
    character: 15,
  });
});

Deno.test("lsp validation reports unknown named imports on the import specifier", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  const source = 'from "./lib.wm" import { missing }; let x = 1;';
  await Deno.writeTextFile(lib, "export let present = 1;");
  await Deno.writeTextFile(main, source);

  const diagnostics = await diagnosticsForPath(
    await validateUri(pathToFileUri(main), new Map()),
    main,
  );
  assertEquals(diagnostics?.map((diagnostic) => diagnostic.code), ["module.unknown-import"]);
  assertEquals(diagnostics?.[0].range, charRange(source, "missing"));
});

Deno.test("lsp validation reports duplicate named imports on the duplicate specifier", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  const source = 'from "./lib.wm" import { present, present as present }; let x = present;';
  await Deno.writeTextFile(lib, "export let present = 1;");
  await Deno.writeTextFile(main, source);

  const diagnostics = await diagnosticsForPath(
    await validateUri(pathToFileUri(main), new Map()),
    main,
  );
  assertEquals(diagnostics?.map((diagnostic) => diagnostic.code), ["module.duplicate-import"]);
  assertEquals(diagnostics?.[0].range, charRange(source, "present as present"));
});

Deno.test("lsp validation reports unresolved import paths on the path literal", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = 'from "./missing.wm" import * as Missing; let x = 1;';
  await Deno.writeTextFile(main, source);

  const diagnostics = await diagnosticsForPath(
    await validateUri(pathToFileUri(main), new Map()),
    main,
  );
  assertEquals(diagnostics?.map((diagnostic) => diagnostic.code), ["module.resolve-import"]);
  assertEquals(diagnostics?.[0].range, charRange(source, '"./missing.wm"'));
});

Deno.test("lsp validation reports import cycles on the closing import path", async () => {
  const dir = await Deno.makeTempDir();
  const a = `${dir}/a.wm`;
  const b = `${dir}/b.wm`;
  const source = 'from "./a.wm" import * as A; let y = 2;';
  await Deno.writeTextFile(a, 'from "./b.wm" import * as B; let x = 1;');
  await Deno.writeTextFile(b, source);

  const diagnostics = await diagnosticsForPath(await validateUri(pathToFileUri(a), new Map()), b);
  assertEquals(diagnostics?.map((diagnostic) => diagnostic.code), ["module.import-cycle"]);
  assertEquals(diagnostics?.[0].range, charRange(source, '"./a.wm"'));
});

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
    JSON.stringify(publishes.map((message) => message.params), null, 2),
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
      await delay(300);
      await Deno.writeTextFile(lib, 'export let value = "ok";');
      await delay(100);
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
  assertEquals(hover.contents.value, "```wm\nSome: (Number) => Option<Number>\n```");
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

async function diagnosticsForPath(results: ValidationResult[], path: string) {
  const realPath = await Deno.realPath(path);
  return results.find((result) => fileUriToPath(result.uri) === realPath)?.diagnostics;
}

function charRange(source: string, text: string) {
  const start = source.indexOf(text);
  if (start < 0) throw new Error(`missing test text ${text}`);
  return {
    start: { line: 0, character: start },
    end: { line: 0, character: start + text.length },
  };
}

async function runLsp(steps: (RpcMessage | (() => Promise<void>))[]): Promise<RpcMessage[]> {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-env", "src/lsp/server.ts"],
    cwd: new URL("../", import.meta.url).pathname,
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
