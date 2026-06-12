import { assertEquals } from "@std/assert";
import { DocumentStore } from "../src/lsp/documents.ts";
import { hoverAt } from "../src/lsp/hover.ts";
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
    "callee floor: (Number) => Result<Number, Js.Error>",
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

Deno.test("lsp hover returns partial types when delayed FFI resolution fails", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
let try = (result) => {
  match(result) {
    Ok(value) => { value },
    Err(_) => { Panic("ffi") },
  }
};

let hexByte = (byte, index, array) => {
  let text = byte :> .unknownJs(16) :> try;
  text :> .padStart(2, "0") :> try
};
`;
  await Deno.writeTextFile(main, source);

  const hover = await hoverAt(pathToFileUri(main), { line: 9, character: 13 }, new Map());

  assertEquals(hover?.contents.value, "```wm\nbyte: 'a\n```");
});

Deno.test("lsp hover agrees for FFI-constrained handler definition and use", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
from js.global import type { Request };
from js.global("Deno") import unsafe {
  serve: (Js.Value, (Request, Js.Value) => Js.Promise<Js.Value>) => Js.Value
};
from js.global("Promise") import unsafe { resolve as promiseResolve };

let try = (result) => {
  match(result) {
    Ok(value) => { value },
    Err(_) => { Panic("ffi") },
  }
};

let handler = (req, info) => {
  let textPromise = req :> .text() :> try;
  textPromise :> .then((text) => {
    promiseResolve(text)
  }) :> try
};

let server = serve(JSON{}, handler);
`;
  await Deno.writeTextFile(main, source);

  const uri = pathToFileUri(main);
  const expected = "```wm\nhandler: ((Request, Js.Value)) => Js.Promise<Js.Value>\n```";
  const definition = await hoverAt(uri, positionOf(source, "handler ="), new Map());
  const use = await hoverAt(uri, positionOf(source, "handler);"), new Map());

  assertEquals(definition?.contents.value, expected);
  assertEquals(use?.contents.value, expected);
});

async function diagnosticsForPath(results: ValidationResult[], path: string) {
  const realPath = await Deno.realPath(path);
  return results.find((result) => fileUriToPath(result.uri) === realPath)?.diagnostics;
}

function positionOf(source: string, text: string) {
  const offset = source.indexOf(text);
  if (offset < 0) throw new Error(`missing test text ${text}`);
  const prefix = source.slice(0, offset);
  const lines = prefix.split("\n");
  return { line: lines.length - 1, character: lines.at(-1)!.length };
}

function charRange(source: string, text: string) {
  const start = source.indexOf(text);
  if (start < 0) throw new Error(`missing test text ${text}`);
  return {
    start: { line: 0, character: start },
    end: { line: 0, character: start + text.length },
  };
}
