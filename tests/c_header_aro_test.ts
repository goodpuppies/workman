import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { CHeaderExtractError, extractCHeader } from "../src/ffi/c/extract.ts";
import { compileLibraryVirtual } from "../src/compiler.ts";

const extractorPath = process.env.WM_C_HEADER_EXTRACTOR;
const fixture = fileURLToPath(new URL("./fixtures/c_reflection.h", import.meta.url));

function nativeTest(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn });
}

nativeTest(
  "Aro reflects layouts, opaque types, enum constants, arrays and compound macros",
  async () => {
    const cacheDir = await Deno.makeTempDir();
    try {
      const result = await extractCHeader({
        header: fixture,
        symbols: [],
        extractorPath,
        cacheDir,
      });
      const aligned = result.types.find((t) => t.name === "Aligned");
      assertEquals(aligned?.kind, "struct");
      if (aligned?.kind !== "struct") throw new Error("missing Aligned struct");
      assertEquals([aligned.size, aligned.align], [32, 8]);
      assertEquals(aligned.fields.map((f) => f.offset), [0, 8, 16]);
      assertEquals(aligned.fields[2].type.length, 3);
      const opaque = result.types.find((t) => t.name === "Opaque");
      assertEquals(opaque?.kind === "struct" && opaque.opaque, true);
      const consume = result.fns.find((f) => f.name === "consume");
      assertEquals(consume?.params[0].const, true);
      const values = new Map(result.values.map((v) => [v.name, v.value]));
      assertEquals(values.get("MODE_ZERO"), 0);
      assertEquals(values.get("MODE_SEVEN"), 7);
      assertEquals(values.get("MODE_EIGHT"), 8);
      assertEquals(values.get("ANSWER"), 42);
      assertEquals(values.get("SCALE"), 1.5);
      assertEquals(values.get("COLOUR"), { tag: 9, value: 2.5, samples: [1, 2, 3] });
    } finally {
      await Deno.remove(cacheDir, { recursive: true });
    }
  },
);

nativeTest("Aro invalidates reflection when a transitive include changes", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const header = `${dir}/main.h`;
    const dependency = `${dir}/dep.h`;
    await Deno.writeTextFile(header, '#include "dep.h"\n');
    await Deno.writeTextFile(dependency, "#define VALUE 1\n");
    const options = { header, symbols: ["VALUE"], extractorPath, cacheDir: `${dir}/cache` };
    assertEquals((await extractCHeader(options)).values[0].value, 1);
    await Deno.writeTextFile(dependency, "#define VALUE 20\n");
    assertEquals((await extractCHeader(options)).values[0].value, 20);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

nativeTest("Aro preserves compiler C codec emission", async () => {
  const header = fileURLToPath(new URL("../examples/c_ffi/fixtures/vec3.h", import.meta.url));
  const js = await compileLibraryVirtual(
    "/test/main.wm",
    new Map([[
      "/test/main.wm",
      `from c.header(${JSON.stringify(header)}) import type { Vector3 };
     let main = () => { let v = newVector3(1, 2, 3); print(getVector3_x(v)) };`,
    ]]),
  );
  assertStringIncludes(js, '"name":"Vector3"');
  assertStringIncludes(js, "__wm_c_setup_codec");
});

nativeTest("Aro reports invalid C headers", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const header = `${dir}/broken.h`;
    await Deno.writeTextFile(header, "typedef struct Broken { int ; nope } Broken;");
    await assertRejects(
      () => extractCHeader({ header, symbols: [], extractorPath, cacheDir: dir }),
      CHeaderExtractError,
      "Aro C header reflection failed",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

nativeTest("Aro rejects unions and bitfields instead of emitting unsafe layouts", async () => {
  const dir = await Deno.makeTempDir();
  try {
    for (
      const [source, diagnostic] of [
        ["typedef union Value { int i; float f; } Value;", "UnionTypesNotSupported"],
        ["typedef struct Bits { unsigned int flag:1; } Bits;", "BitFieldsNotSupported"],
      ]
    ) {
      const header = `${dir}/unsupported.h`;
      await Deno.writeTextFile(header, source);
      await assertRejects(
        () => extractCHeader({ header, symbols: [], extractorPath, cacheDir: dir }),
        CHeaderExtractError,
        diagnostic,
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

nativeTest("Aro resolves bare system headers without compiling a Zig program", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const result = await extractCHeader({
      header: "stdio.h",
      symbols: ["puts"],
      extractorPath,
      cacheDir: dir,
    });
    assertEquals(result.fns[0].name, "puts");
    assertEquals(result.fns[0].params[0].kind, "pointer");
    assertEquals(result.fns[0].params[0].const, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
