import { assertEquals, assertThrows } from "@std/assert";
import { createSizedStruct, f64, u8 } from "byte_type";
import { validateCodecDescriptor } from "../src/ffi/c/byte_type.ts";
import { byteTypeRuntimeUrl } from "../src/generated/byte_type_runtime.ts";
import { compile } from "../src/compiler.ts";

Deno.test("vendored C codecs preserve aligned struct layouts and reject mismatches", () => {
  const descriptor = {
    name: "Aligned",
    size: 16,
    align: 8,
    fields: [{ name: "tag", offset: 0, codec: "u8" }, { name: "value", offset: 8, codec: "f64" }],
  };
  validateCodecDescriptor(descriptor);
  assertThrows(() => validateCodecDescriptor({ ...descriptor, size: 9 }), Error, "extracted size");
  assertThrows(
    () =>
      validateCodecDescriptor({
        ...descriptor,
        fields: [{ name: "value", offset: 1, codec: "f64" }],
      }),
    Error,
    "extracted offset",
  );
  const codec = createSizedStruct({ tag: u8, value: f64 });
  const view = new DataView(new ArrayBuffer(codec.byteSize));
  codec.write({ tag: 7, value: 1.5 }, view);
  assertEquals(codec.read(view), { tag: 7, value: 1.5 });
});

Deno.test("bundled byte_type runs from an unrelated directory with no file or network access", async () => {
  const directory = await Deno.makeTempDir({ prefix: "wm-codec-runtime-" });
  try {
    const source = `
      import { createSizedStruct, u8, f64 } from ${JSON.stringify(byteTypeRuntimeUrl)};
      const codec = createSizedStruct({ tag: u8, value: f64 });
      const view = new DataView(new ArrayBuffer(codec.byteSize));
      codec.write({ tag: 7, value: 1.5 }, view);
      const decoded = codec.read(view);
      if (codec.byteSize !== 16 || codec.getFieldOffsets().value !== 8 ||
          decoded.tag !== 7 || decoded.value !== 1.5) throw new Error("codec mismatch");
    `;
    const path = `${directory}/standalone.mjs`;
    await Deno.writeTextFile(path, source);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--no-config", "--no-prompt", path],
      cwd: directory,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("ordinary programs do not embed the byte_type runtime", async () => {
  const js = await compile("-- @no-prelude\nlet answer = 42;");
  assertEquals(js.includes(byteTypeRuntimeUrl), false);
  assertEquals(js.includes("byte_type_C"), false);
});
