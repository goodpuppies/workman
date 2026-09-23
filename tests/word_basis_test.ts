import { assertEquals, assertRejects } from "@std/assert";
import { checkSource, compile } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("exact word and Word8Vector basis members have nominal types", async () => {
  const result = await checkSource(`
    let byte = Word8.fromNumber(260);
    let wide = Word64.fromNumber(42);
    let bytes = Word8Vector.fromList([byte, Word8.fromNumber(7)]);
    let maybeByte = Word8Vector.get(bytes, 1);
    let generated = Word8Vector.tabulate(3, (index) => {
      Word8.fromNumber(index * 2)
    });
    let (unfolded, finalState) = Word8Vector.unfoldN(
      3,
      byte,
      (state) => { (state, Word8.add(state, Word8.fromNumber(1))) },
    );
  `);

  expectBinding(result.env, "byte", { type: "Word8.word", vars: 0 });
  expectBinding(result.env, "wide", { type: "Word64.word", vars: 0 });
  expectBinding(result.env, "bytes", { type: "Word8Vector.vector", vars: 0 });
  expectBinding(result.env, "maybeByte", { type: "Option<Word8.word>", vars: 0 });
  expectBinding(result.env, "generated", { type: "Word8Vector.vector", vars: 0 });
  expectBinding(result.env, "unfolded", { type: "Word8Vector.vector", vars: 0 });
  expectBinding(result.env, "finalState", { type: "Word8.word", vars: 0 });
});

Deno.test("word arithmetic is modular and shifts respect the declared width", async () => {
  const output = await run(`
    let main = () => {
      print(Word8.toNumber(Word8.add(Word8.fromNumber(250), Word8.fromNumber(10))));
      print(Word8.toNumber(Word8.shiftRightArithmetic(Word8.fromNumber(128), 7)));
      print(Word32.toNumber(Word32.mul(Word32.fromNumber(-1), Word32.fromNumber(2))));
      print(Word64.toNumber(Word64.shiftRight(Word64.fromNumber(-1), 60)))
    };
  `);

  assertEquals(output, ["4", "255", "4294967294", "15"]);
});

Deno.test("Word8Vector bulk construction is immutable and state-threaded", async () => {
  const output = await run(`
    let main = () => {
      let original = Word8Vector.fromList([
        Word8.fromNumber(1),
        Word8.fromNumber(2),
        Word8.fromNumber(3),
      ]);
      let changed = Word8Vector.update(original, 1, Word8.fromNumber(9));
      let mapped = Word8Vector.mapi(original, (index, byte) => {
        Word8.add(byte, Word8.fromNumber(index))
      });
      let (generated, finalState) = Word8Vector.unfoldN(
        4,
        Word8.fromNumber(5),
        (state) => { (state, Word8.add(state, Word8.fromNumber(2))) },
      );
      print(original);
      print(changed);
      print(mapped);
      print(generated);
      print(Word8.toNumber(finalState));
      print(original == Word8Vector.fromList([
        Word8.fromNumber(1),
        Word8.fromNumber(2),
        Word8.fromNumber(3),
      ]));
      print(Word8Vector.get(original, 99))
    };
  `);

  assertEquals(output, [
    "Word8Vector[1, 2, 3]",
    "Word8Vector[1, 9, 3]",
    "Word8Vector[1, 3, 5]",
    "Word8Vector[5, 7, 9, 11]",
    "13",
    "true",
    "None",
  ]);
});

Deno.test("Word8VectorSlice creates bounded zero-copy views and freezes explicitly", async () => {
  const result = await checkSource(`
    let bytes = Word8Vector.tabulate(6, (index) => { Word8.fromNumber(index + 10) });
    let middle = Word8VectorSlice.slice(bytes, 1, Some(4));
    let tail = Word8VectorSlice.subslice(middle, 2, None);
    let frozen = Word8VectorSlice.vector(tail);
    let (base, offset, length) = Word8VectorSlice.base(tail);
  `);
  expectBinding(result.env, "middle", { type: "Word8VectorSlice.slice", vars: 0 });
  expectBinding(result.env, "tail", { type: "Word8VectorSlice.slice", vars: 0 });
  expectBinding(result.env, "frozen", { type: "Word8Vector.vector", vars: 0 });
  expectBinding(result.env, "base", { type: "Word8Vector.vector", vars: 0 });
  expectBinding(result.env, "offset", { type: "Number", vars: 0 });
  expectBinding(result.env, "length", { type: "Number", vars: 0 });

  const output = await run(`
    let main = () => {
      let bytes = Word8Vector.tabulate(6, (index) => { Word8.fromNumber(index + 10) });
      let middle = Word8VectorSlice.slice(bytes, 1, Some(4));
      let tail = Word8VectorSlice.subslice(middle, 2, None);
      let (base, offset, length) = Word8VectorSlice.base(tail);
      print(middle);
      print(tail);
      print(Word8VectorSlice.vector(tail));
      print(base == bytes);
      print(offset);
      print(length);
      print(Word8VectorSlice.get(tail, 2));
      print(Word8VectorSlice.concat([tail, Word8VectorSlice.slice(bytes, 0, Some(1))]))
    };
  `);
  assertEquals(output, [
    "Word8VectorSlice[11, 12, 13, 14]",
    "Word8VectorSlice[13, 14]",
    "Word8Vector[13, 14]",
    "true",
    "3",
    "2",
    "None",
    "Word8Vector[13, 14, 10]",
  ]);
});

Deno.test("Word8VectorSlice is abstract and does not admit source equality", async () => {
  await assertRejects(
    () =>
      checkSource(`
        let bytes = Word8Vector.empty;
        let view = Word8VectorSlice.full(bytes);
        let same = view == view;
      `),
    Error,
    "does not admit equality",
  );
});

Deno.test("PackWord modules decode vectors and slices in both byte orders", async () => {
  const result = await checkSource(`
    let bytes = Word8Vector.fromList([
      Word8.fromNumber(1), Word8.fromNumber(2), Word8.fromNumber(3), Word8.fromNumber(4),
      Word8.fromNumber(5), Word8.fromNumber(6), Word8.fromNumber(7), Word8.fromNumber(8),
    ]);
    let little16 = PackWord16Little.subVec(bytes, 0);
    let big32 = PackWord32Big.subVec(bytes, 0);
    let slice = Word8VectorSlice.slice(bytes, 2, Some(4));
    let little32 = PackWord32Little.subSlice(slice, 0);
    let wide = PackWord64Big.subVec(bytes, 0);
  `);
  expectBinding(result.env, "little16", { type: "Word16.word", vars: 0 });
  expectBinding(result.env, "big32", { type: "Word32.word", vars: 0 });
  expectBinding(result.env, "little32", { type: "Word32.word", vars: 0 });
  expectBinding(result.env, "wide", { type: "Word64.word", vars: 0 });

  const output = await run(`
    let main = () => {
      let bytes = Word8Vector.fromList([
        Word8.fromNumber(1), Word8.fromNumber(2), Word8.fromNumber(3), Word8.fromNumber(4),
        Word8.fromNumber(5), Word8.fromNumber(6), Word8.fromNumber(7), Word8.fromNumber(8),
      ]);
      let slice = Word8VectorSlice.slice(bytes, 2, Some(4));
      print(Word16.toNumber(PackWord16Little.subVec(bytes, 0)));
      print(Word32.toNumber(PackWord32Big.subVec(bytes, 0)));
      print(Word32.toNumber(PackWord32Little.subSlice(slice, 0)));
      print(PackWord64Big.subVec(bytes, 0));
      print(PackWord32Little.pack(Word32.fromNumber(305419896)))
    };
  `);
  assertEquals(output, [
    "513",
    "16909060",
    "100992003",
    "72623859790382856",
    "Word8Vector[120, 86, 52, 18]",
  ]);
});

Deno.test("Bytes reads immutable whole files and ranges and writes vectors", async () => {
  const directory = await Deno.makeTempDir();
  const input = `${directory}/input.bin`;
  const outputPath = `${directory}/output.bin`;
  await Deno.writeFile(input, new Uint8Array([9, 8, 7, 6, 5]));
  try {
    const lines = await run(`
      let main = () => {
        Bytes.readFile(${JSON.stringify(input)})
          :> Task.andThen((whole) => {
            print(whole);
            Bytes.readSlice(${JSON.stringify(input)}, 1, 3)
          })
          :> Task.andThen((part) => {
            print(part);
            Bytes.writeFile(${JSON.stringify(outputPath)}, part)
          })
      };
    `);
    assertEquals(lines, ["Word8Vector[9, 8, 7, 6, 5]", "Word8Vector[8, 7, 6]"]);
    assertEquals([...await Deno.readFile(outputPath)], [8, 7, 6]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Binary provides checked byte-offset reads and immutable cursor advancement", async () => {
  const result = await checkSource(`
    let bytes = Word8Vector.fromList([
      Word8.fromNumber(1), Word8.fromNumber(2), Word8.fromNumber(3), Word8.fromNumber(4),
    ]);
    let slice = Word8VectorSlice.full(bytes);
    let direct = Binary.u32be(slice, 0);
    let cursor = Binary.cursor(slice);
    let stepped = Binary.readU16le(cursor);
    let invalid = Binary.u32le(slice, 2);
  `);
  expectBinding(result.env, "direct", { type: "Result<Word32.word, Error>", vars: 0 });
  expectBinding(result.env, "cursor", {
    type: "Cursor<Word8VectorSlice.slice>",
    vars: 0,
  });
  expectBinding(result.env, "stepped", {
    type: "Result<(Word16.word, Cursor<Word8VectorSlice.slice>), Error>",
    vars: 0,
  });
  expectBinding(result.env, "invalid", { type: "Result<Word32.word, Error>", vars: 0 });

  const output = await run(`
    let main = () => {
      let bytes = Word8Vector.fromList([
        Word8.fromNumber(1), Word8.fromNumber(2), Word8.fromNumber(3), Word8.fromNumber(4),
      ]);
      let slice = Word8VectorSlice.full(bytes);
      print(Binary.u32be(slice, 0));
      print(Binary.readU16le(Binary.cursor(slice)));
      print(Binary.u32le(slice, 2))
    };
  `);
  assertEquals(output, [
    "Ok(16909060)",
    "Ok(513, { bytes = Word8VectorSlice[1, 2, 3, 4], offset = 2 })",
    "Err(Bounds(2, 4, 4))",
  ]);
});

Deno.test("PackReal preserves explicit float precision while Binary exposes numeric reads", async () => {
  const result = await checkSource(`
    let real = Float32.fromNumber(1.5);
    let encoded = PackReal32Little.pack(real);
    let decoded = PackReal32Little.subVec(encoded, 0);
    let number = Float32.toNumber(decoded);
    let binary = Binary.f32le(Word8VectorSlice.full(encoded), 0);
  `);
  expectBinding(result.env, "real", { type: "Float32.real", vars: 0 });
  expectBinding(result.env, "encoded", { type: "Word8Vector.vector", vars: 0 });
  expectBinding(result.env, "decoded", { type: "Float32.real", vars: 0 });
  expectBinding(result.env, "number", { type: "Number", vars: 0 });
  expectBinding(result.env, "binary", { type: "Result<Number, Error>", vars: 0 });

  const output = await run(`
    let main = () => {
      let little = PackReal32Little.pack(Float32.fromNumber(1.5));
      let big = PackReal64Big.pack(Float64.fromNumber(-2.25));
      print(little);
      print(big);
      print(Binary.f32le(Word8VectorSlice.full(little), 0));
      print(Binary.f64be(Word8VectorSlice.full(big), 0))
    };
  `);
  assertEquals(output, [
    "Word8Vector[0, 0, 192, 63]",
    "Word8Vector[192, 2, 0, 0, 0, 0, 0, 0]",
    "Ok(1.5)",
    "Ok(-2.25)",
  ]);
});

Deno.test("Byte conversion and Binary.asciiZ replace the host string shim", async () => {
  const result = await checkSource(`
    let encoded = Byte.stringToBytes("colossus");
    let decoded = Byte.bytesToString(encoded);
    let terminated = Word8Vector.concat([
      encoded,
      Word8Vector.fromList([Word8.fromNumber(0), Word8.fromNumber(99)]),
    ]);
    let parsed = Binary.asciiZ(Word8VectorSlice.full(terminated), 0);
  `);
  expectBinding(result.env, "encoded", { type: "Word8Vector.vector", vars: 0 });
  expectBinding(result.env, "decoded", { type: "String", vars: 0 });
  expectBinding(result.env, "parsed", { type: "Result<String, Error>", vars: 0 });

  const output = await run(`
    let main = () => {
      let bytes = Word8Vector.concat([
        Byte.stringToBytes("xxwander"),
        Word8Vector.fromList([Word8.fromNumber(0), Word8.fromNumber(7)]),
      ]);
      let slice = Word8VectorSlice.full(bytes);
      print(Binary.asciiZ(slice, 2));
      print(Binary.asciiZ(Word8VectorSlice.slice(bytes, 0, Some(5)), 2))
    };
  `);
  assertEquals(output, ["Ok(wander)", "Err(UnterminatedAscii(2))"]);
});

async function run(source: string): Promise<string[]> {
  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    const javaScript = await compile(source);
    await import(`data:text/javascript;base64,${btoa(javaScript)}#${crypto.randomUUID()}`);
  } finally {
    console.log = original;
  }
  return output;
}
