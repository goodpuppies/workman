import { assertEquals, assertStringIncludes } from "@std/assert";
import { analyzeVirtual, elaborateGpuTypesForLanguageService } from "../src/compiler.ts";
import { hoverAt } from "../src/lsp/hover.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";
import { validateUri } from "../src/lsp/validation.ts";

Deno.test({
  name: "GPU hover type elaboration does not require filesystem writes",
  permissions: { read: true, write: false, env: true, net: false, run: true, ffi: false },
  async fn() {
    const source = `
      let shade = (coord) => {
        @gpu;
        let projected = coord.y;
        (projected, 0.0, 0.0, 1.0)
      };
      let fragment = Gpu.fragment(shade);
    `;
    const analysis = await analyzeVirtual(
      "/test/main.wm",
      new Map([["/test/main.wm", source]]),
    );
    const elaboration = await elaborateGpuTypesForLanguageService(analysis);

    assertEquals((elaboration?.occurrences.length ?? 0) > 0, true);
    assertEquals(elaboration?.shaderTypes.some((type) => type.kind === "vector"), true);

    const example = new URL(
      "../examples/wmslang_window/src/main.wm",
      import.meta.url,
    ).pathname;
    const exampleSource = await Deno.readTextFile(example);
    const uri = pathToFileUri(example);
    const hover = await hoverAt(
      uri,
      positionOf(exampleSource, "uniforms.resolution.y"),
      new Map(),
    );
    const diagnostics = (await validateUri(uri, new Map())).flatMap((result) => result.diagnostics);

    if (!hover) {
      throw new Error(`missing read-only window hover: ${JSON.stringify(diagnostics)}`);
    }
    assertEquals(hover.contents.value, "```wm\nuniforms.resolution.y: f32\n```");
    assertEquals(
      diagnostics.some((diagnostic) => diagnostic.code === "gpu.type.unresolved"),
      false,
    );
  },
});

Deno.test("GPU numeric conflicts publish both representation evidence paths", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
let shade = (_coord) => {
  @gpu;
  let invalid = 1 + 1.0;
  invalid;
  (0.0, 0.0, 0.0, 1.0)
};
let fragment = Gpu.fragment(shade);
`;
  await Deno.writeTextFile(main, source);
  const diagnostics = (await validateUri(pathToFileUri(main), new Map())).flatMap((result) =>
    result.diagnostics
  );
  const conflict = diagnostics.find((diagnostic) => diagnostic.code === "gpu.numeric.conflict");
  assertEquals(conflict?.severity, 1);
  assertStringIncludes(conflict?.message ?? "", "conflicting GPU numeric representations");
  assertEquals(conflict?.relatedInformation?.length, 1);
  assertStringIncludes(
    conflict?.relatedInformation?.[0].message ?? "",
    "representation originates here",
  );
  assertEquals(
    JSON.stringify(conflict?.range) ===
      JSON.stringify(conflict?.relatedInformation?.[0].location.range),
    false,
  );
});

Deno.test("GPU diagnostics retain the owning fragment root in a multi-root program", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
let valid = (_coord) => { @gpu; (0.0, 0.0, 0.0, 1.0) };
let invalid = (_coord) => {
  @gpu;
  let mixed = 1 + 1.0;
  mixed;
  (0.0, 0.0, 0.0, 1.0)
};
let first = Gpu.fragment(valid);
let second = Gpu.fragment(invalid);
`;
  await Deno.writeTextFile(main, source);
  const diagnostics = (await validateUri(pathToFileUri(main), new Map())).flatMap((result) =>
    result.diagnostics
  );
  const conflict = diagnostics.find((diagnostic) => diagnostic.code === "gpu.numeric.conflict");
  assertEquals(conflict?.range.start.line, positionOf(source, "1 + 1.0").line);
  assertEquals(conflict?.severity, 1);
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

Deno.test("lsp hover presents Workman-elaborated shader occurrence types", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
let shade = (coord) => {
  @gpu;
  let helper = (value) => { value };
  let local = coord * 2.0;
  let projected = local.y;
  let passed = helper(projected);
  (passed, 0.0, 0.0, 1.0)
};
let fragment = Gpu.fragment(shade);
let host = (1.0, 2.0);
`;
  await Deno.writeTextFile(main, source);
  const uri = pathToFileUri(main);

  const shade = await hoverAt(uri, positionOf(source, "shade ="), new Map());
  const coord = await hoverAt(uri, positionOf(source, "coord *"), new Map());
  const helper = await hoverAt(uri, positionOf(source, "helper ="), new Map());
  const projected = await hoverAt(uri, positionOf(source, "local.y"), new Map());
  const host = await hoverAt(uri, positionOf(source, "host ="), new Map());

  assertEquals(shade?.contents.value, "```wm\nshade: (f32x2) => f32x4\n```");
  assertEquals(coord?.contents.value, "```wm\ncoord: f32x2\n```");
  assertEquals(helper?.contents.value, "```wm\nhelper: (f32) => f32\n```");
  assertEquals(projected?.contents.value, "```wm\nlocal.y: f32\n```");
  assertEquals(host?.contents.value, "```wm\nhost: (Number, Number)\n```");
});

Deno.test("lsp hover presents curried environment fields in their GPU representation", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
record Uniforms = { resolution: (Number, Number), time: Number };
let shade = (uniforms: Uniforms) => {
  (coord) => {
    @gpu;
    let uv = (coord * 2.0 - uniforms.resolution) / uniforms.resolution.y;
    (uv.x + uniforms.time, uv.y, 0.0, 1.0)
  }
};
let current: Uniforms = .{ resolution = (960.0, 640.0), time = 0.5 };
let fragment = Gpu.fragment(shade(current));
`;
  await Deno.writeTextFile(main, source);
  const uri = pathToFileUri(main);

  const resolution = await hoverAt(
    uri,
    positionOf(source, "uniforms.resolution"),
    new Map(),
  );
  const time = await hoverAt(uri, positionOf(source, "uniforms.time"), new Map());
  const lane = await hoverAt(uri, positionOf(source, "uniforms.resolution.y"), new Map());

  assertEquals(resolution?.contents.value, "```wm\nuniforms.resolution: f32x2\n```");
  assertEquals(time?.contents.value, "```wm\nuniforms.time: f32\n```");
  assertEquals(lane?.contents.value, "```wm\nuniforms.resolution.y: f32\n```");
});

Deno.test("lsp hover presents occurrence-local i32 types without changing host Number", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
let shade = (_coord) => {
  @gpu;
  let count = (7 + 3) % 4;
  let lanes = (1, 2) + (3, 4);
  count;
  lanes;
  (0.0, 0.0, 0.0, 1.0)
};
let fragment = Gpu.fragment(shade);
let host = 7;
`;
  await Deno.writeTextFile(main, source);
  const uri = pathToFileUri(main);

  const count = await hoverAt(uri, positionOf(source, "count ="), new Map());
  const lanes = await hoverAt(uri, positionOf(source, "lanes ="), new Map());
  const literal = await hoverAt(uri, positionOf(source, "7 +"), new Map());
  const host = await hoverAt(uri, positionOf(source, "host ="), new Map());

  assertEquals(count?.contents.value, "```wm\ncount: i32\n```");
  assertEquals(lanes?.contents.value, "```wm\nlanes: i32x2\n```");
  assertEquals(literal?.contents.value, "```wm\nInt: i32\n```");
  assertEquals(host?.contents.value, "```wm\nhost: Number\n```");
});

Deno.test("lsp hover elaborates every selected fragment root and resource type", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
record Inputs = { previous: Gpu.SampledTexture2D, sampler: Gpu.Sampler };
let integerShade = (_coord) => {
  @gpu;
  let count = 2 + 3;
  count;
  (0.0, 0.0, 0.0, 1.0)
};
let textureShade = (inputs: Inputs) => {
  (coord) => {
    @gpu;
    let color = inputs.previous.Sample(inputs.sampler, coord / (8.0, 8.0));
    color
  }
};
let texture: Gpu.SampledTexture2D = Panic("host");
let sampler: Gpu.Sampler = Panic("host");
let current: Inputs = .{ previous = texture, sampler = sampler };
let first = Gpu.fragment(integerShade);
let second = Gpu.fragment(textureShade(current));
`;
  await Deno.writeTextFile(main, source);
  const uri = pathToFileUri(main);

  const count = await hoverAt(uri, positionOf(source, "count ="), new Map());
  const texture = await hoverAt(
    uri,
    positionOf(source, "inputs.previous.Sample"),
    new Map(),
  );
  const color = await hoverAt(uri, positionOf(source, "color ="), new Map());

  assertEquals(count?.contents.value, "```wm\ncount: i32\n```");
  assertEquals(
    texture?.contents.value,
    "```wm\ninputs.previous.Sample: Gpu.SampledTexture2D\n```",
  );
  assertEquals(color?.contents.value, "```wm\ncolor: f32x4\n```");
});

Deno.test("lsp hover does not disguise failed GPU elaboration as a CPU type", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const source = `
let outside = (value) => { value };
let shade = (coord) => {
  @gpu;
  let (x, _y) = coord;
  (outside(x), 0.0, 0.0, 1.0)
};
let fragment = Gpu.fragment(shade);
`;
  await Deno.writeTextFile(main, source);

  const hover = await hoverAt(
    pathToFileUri(main),
    positionOf(source, "x), 0.0"),
    new Map(),
  );

  assertEquals(hover?.contents.value, "```wm\nx: unresolved GPU type\n```");
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
