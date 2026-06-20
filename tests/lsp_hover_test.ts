import { assertEquals, assertStringIncludes } from "@std/assert";
import { hoverAt } from "../src/lsp/hover.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";

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

Deno.test("lsp hover returns local let binding pattern types", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
let outer = {
  let x = 1;
  x
};
`;
  await Deno.writeTextFile(main, source);

  const hover = await hoverAt(pathToFileUri(main), positionOf(source, "x ="), new Map());

  assertEquals(hover?.contents.value, "```wm\nx: Number\n```");
});

Deno.test("lsp hover returns instantiated and general types for polymorphic uses", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
let id = (x) => { x };
let value = id(1);
`;
  await Deno.writeTextFile(main, source);

  const hover = await hoverAt(pathToFileUri(main), positionOf(source, "id(1"), new Map());

  assertEquals(
    hover?.contents.value,
    "```wm\nid\ntype: (Number) => Number\ngeneral: ('a) => 'a\n```",
  );
});

Deno.test("lsp hover returns null on pipe operator tokens", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
let toNumber = (value) => { 1 };
let keep = (value) => { value };
let speed = "12" :> toNumber :> keep;
`;
  await Deno.writeTextFile(main, source);

  const hover = await hoverAt(pathToFileUri(main), positionOf(source, ":> toNumber"), new Map());

  assertEquals(hover, null);
});

Deno.test("lsp hover returns pipe-specialized callee types", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
let toNumber = (value) => { 1 };
let speed = "12" :> toNumber;
`;
  await Deno.writeTextFile(main, source);

  const hover = await hoverAt(pathToFileUri(main), positionOf(source, "toNumber;"), new Map());

  assertEquals(
    hover?.contents.value,
    "```wm\ntoNumber\ntype: (String) => Number\ngeneral: ('a) => Number\n```",
  );
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
  const expected = "```wm\nhandler: (('a, 'b)) => 'c\n```";
  const definition = await hoverAt(uri, positionOf(source, "handler ="), new Map());
  const use = await hoverAt(uri, positionOf(source, "handler);"), new Map());

  assertEquals(definition?.contents.value, expected);
  assertEquals(use?.contents.value, expected);
});

Deno.test("lsp hover shows generated deep FFI receiver calls as functions", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
from js.global("Deno") import { dlopen: _deep_ };

let lib = dlopen("SDL2", JSON{
  SDL_PollEvent: JSON{ parameters: JSON["pointer"], result: "i32" }
});
let use = match(lib) {
  Ok(sdl) => { sdl.symbols.SDL_PollEvent(Panic("ptr")) },
  Err(e) => { Err(e) }
};
`;
  await Deno.writeTextFile(main, source);

  const hover = await hoverAt(
    pathToFileUri(main),
    positionOf(source, "SDL_PollEvent(Panic"),
    new Map(),
  );

  const value = hover?.contents.value ?? "";
  assertStringIncludes(value, "SDL_PollEvent:");
  assertStringIncludes(value, "SDL_PollEvent: ((Option<Js.Object>)) => Result<Number, Js.Error>");
  assertEquals(value.includes("__Deep"), false);
});

Deno.test("lsp hover hides generated deep FFI types in helper signatures", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
from js.global("Deno") import { dlopen: _deep_ };

let lib = dlopen("SDL2", JSON{
  SDL_CreateWindow: JSON{ parameters: JSON["buffer", "i32"], result: "pointer" }
});

let createSurface = (sdl, title) => {
  sdl.symbols.SDL_CreateWindow(title, 1)
};
`;
  await Deno.writeTextFile(main, source);

  const hover = await hoverAt(
    pathToFileUri(main),
    positionOf(source, "createSurface ="),
    new Map(),
  );

  const value = hover?.contents.value ?? "";
  assertStringIncludes(value, "createSurface:");
  assertStringIncludes(value, "createSurface: ((Js.Object, Option<Js.ArrayLike>))");
  assertEquals(value.includes("__Deep"), false);
});

function positionOf(source: string, text: string) {
  const offset = source.indexOf(text);
  if (offset < 0) throw new Error(`missing test text ${text}`);
  const prefix = source.slice(0, offset);
  const lines = prefix.split("\n");
  return { line: lines.length - 1, character: lines.at(-1)!.length };
}
