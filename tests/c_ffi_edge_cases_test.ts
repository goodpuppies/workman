import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { compileVirtual } from "../src/compiler.ts";
import { fileURLToPath } from "node:url";
import * as Memory from "../host/c/js/pointer.js";

async function run(files: Map<string, string>, inspect?: (js: string) => void): Promise<string> {
  const dir = await Deno.makeTempDir();
  try {
    const js = await compileVirtual("/test/main.wm", files);
    inspect?.(js);
    await Deno.writeTextFile(`${dir}/main.mjs`, js);
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "--no-config", `${dir}/main.mjs`],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    return new TextDecoder().decode(output.stdout).replaceAll("\r\n", "\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("pointer UTF-8 byte counts agree with encoding without requiring native allocation", () => {
  const encoder = new TextEncoder();
  for (const text of ["", "ascii", "λ雪😀", "a\0b", "\ud800", "\udc00", "x\ud800y"]) {
    assertEquals(Memory.byteLength(text), encoder.encode(text).length);
  }
});

Deno.test({
  name: "C 64-bit calls pass BigInts directly through reflected and authored bindings",
  ignore: Deno.build.os !== "linux",
  async fn() {
    const output = await run(
      new Map([[
        "/test/main.wm",
        `
      from c.header("stdlib.h") import unsafe { llabs, strtoull };
      from c.header("stdlib.h") import unsafe * as Libc;
      from c.lib("c") import unsafe { llabs as authoredAbs: Int64.Int -> Int64.Int };
      from c.lib("c") import unsafe {
        strtoull as parse: (Option<Ptr<I32>>, Option<Ptr<I32>>, I32) -> Word64.Word
      };
      from "host/c/pointer.wm" import * as Pointer;
      let main = () => {
        print(Int64.toString(llabs(-9223372036854775807)));
        print(Libc.llabs(-1) == (1: Int64.Int));
        print(authoredAbs(Int64.fromNumber(-7)) == (7: Int64.Int));
        print(strtoull(Some(Pointer.fromString("18446744073709551615")), None, 10));
        print(parse(Some(Pointer.cast(Pointer.fromString("1"))), None, 10) == (1: Word64.Word));
      };
      `,
      ]]),
      (js) => {
        // Bindings must not use the generic conversion dispatcher, even for
        // mixed pointer/scalar signatures with 64-bit results.
        for (const line of js.split("\n")) {
          if (/^const .* = .*__wm_c_call\(/.test(line)) {
            throw new Error(`unexpected generic C wrapper: ${line}`);
          }
        }
        assertEquals(js.includes('"number-to-bigint"'), false);
        assertEquals(js.includes("globalThis.BigInt(result)"), false);
      },
    );
    assertEquals(output, "9223372036854775807\ntrue\ntrue\n18446744073709551615\ntrue\n");

    await assertRejects(() =>
      compileVirtual(
        "/test/main.wm",
        new Map([[
          "/test/main.wm",
          `from c.lib("c") import unsafe { llabs: Int64.Int -> Int64.Int };
       let main = () => { let value: Number = 7; print(llabs(value)); };`,
        ]]),
      ), Error);
  },
});

Deno.test("C aggregate literals initialize nested structs and unions in zero-filled native storage", async () => {
  const header = JSON.stringify(
    fileURLToPath(new URL("./fixtures/c_ffi_edges.h", import.meta.url)),
  );
  const output = await run(
    new Map([[
      "/test/main.wm",
      `
    from c.header(${header}) import type { EdgeNested, EdgeChoice, EdgeWide };
    from "host/c/pointer.wm" import * as Pointer;
    let main = () => {
      let nested: CStorage<EdgeNested> = EdgeNested{
        prefix = Word8.fromNumber(9),
        inner = { port = Word16.fromNumber(4660), choice = { word = Word32.fromNumber(67305985) } }
      };
      print(nested.size == sizeOfEdgeNested);
      print(getEdgeNested_prefix(nested.pointer));
      print(getEdgeNested_tail(nested.pointer));
      print(Pointer.getU8(nested.pointer, 1));
      print(Pointer.getU8(nested.pointer, offsetOfEdgeNested_inner));
      print(Pointer.getU32(nested.pointer, offsetOfEdgeNested_inner + 4));
      let choice = EdgeChoice{ word = Word32.fromNumber(42) };
      let copied = EdgeNested{ inner = { choice = choice } };
      print(Pointer.getU32(copied.pointer, offsetOfEdgeNested_inner + 4));
      let named = EdgeNested{ inner = { choice = EdgeChoice{ word = Word32.fromNumber(7) } } };
      print(Pointer.getU32(named.pointer, offsetOfEdgeNested_inner + 4));
      let empty = EdgeNested{};
      print(getEdgeNested_prefix(empty.pointer));
      let wide = EdgeWide{ signed_value = Int64.fromString("-9223372036854775807") };
      print(getEdgeWide_value(wide.pointer));
      print(Int64.toString(getEdgeWide_signed_value(wide.pointer)));
      {
        record EdgeNested = { x: Number };
        let ordinary = EdgeNested{ x = 99 };
        print(ordinary.x);
      };
    };
  `,
    ]]),
  );
  assertEquals(output, "true\n9\n0\n0\n52\n67305985\n42\n7\n0\n0\n-9223372036854775807\n99\n");
});

Deno.test("C aggregate literals reject unknown, duplicate and invalid union fields", async () => {
  const header = JSON.stringify(
    fileURLToPath(new URL("./fixtures/c_ffi_edges.h", import.meta.url)),
  );
  for (
    const [literal, message] of [
      ["EdgeNested{ missing = 1 }", "unknown field 'missing'"],
      ["EdgeNested{ prefix = 1, prefix = 2 }", "duplicate field 'prefix'"],
      ["EdgeChoice{}", "requires exactly one selected member"],
      ["EdgeChoice{ word = 1, bytes = 2 }", "requires exactly one selected member"],
      ["EdgeNested{ inner = { choice = {} } }", "requires exactly one selected member"],
      ["EdgeNested{ prefix = true }", ""],
    ]
  ) {
    await assertRejects(
      () =>
        compileVirtual(
          "/test/main.wm",
          new Map([[
            "/test/main.wm",
            `
      from c.header(${header}) import type { EdgeNested, EdgeChoice };
      let main = () => { let value = ${literal}; print(value); };
    `,
          ]]),
        ),
      Error,
      message,
    );
  }
});

Deno.test("C integer constants and struct codecs preserve fixed-width word and signed types", async () => {
  const header = JSON.stringify(
    fileURLToPath(new URL("./fixtures/c_ffi_edges.h", import.meta.url)),
  );
  const output = await run(
    new Map([[
      "/test/main.wm",
      `
    from c.header(${header}) import unsafe { EDGE_U8, EDGE_U16, EDGE_U32 };
    from c.header(${header}) import type { EdgeIntegers };
    let main = () => {
      let storage = EdgeIntegers{
        u8 = EDGE_U8, u16 = EDGE_U16, u32 = EDGE_U32,
        i8 = -128, i16 = -32768, i32 = I32.minimum
      };
      print(Word8.toNumber(getEdgeIntegers_u8(storage.pointer)));
      print(Word16.toNumber(getEdgeIntegers_u16(storage.pointer)));
      print(Word32.toNumber(getEdgeIntegers_u32(storage.pointer)));
      print(I32.toNumber(getEdgeIntegers_i8(storage.pointer)));
      print(I32.toNumber(getEdgeIntegers_i16(storage.pointer)));
      print(I32.toNumber(getEdgeIntegers_i32(storage.pointer)));
      setEdgeIntegers_u16(storage.pointer, Word16.fromNumber(8080));
      print(Word16.toNumber(getEdgeIntegers_u16(storage.pointer)));
    };
  `,
    ]]),
  );
  assertEquals(output, "255\n65535\n4294967295\n-128\n-32768\n-2147483648\n8080\n");
});

Deno.test({
  name: "Winsock byte-order functions accept and return matching fixed-width words",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const output = await run(
      new Map([[
        "/test/main.wm",
        `
      from c.header("winsock2.h", lib: "ws2_32") import unsafe {
        htons: Word16.Word -> Word16.Word, ntohs, htonl, ntohl
      };
      let main = () => {
        print(Word16.toNumber(ntohs(htons(Word16.fromNumber(65535)))));
        print(Word32.toNumber(ntohl(htonl(Word32.fromNumber(4294967295)))));
      };
    `,
      ]]),
    );
    assertEquals(output, "65535\n4294967295\n");
    for (const argument of ["8080", "Word32.fromNumber(8080)"]) {
      await assertRejects(() =>
        compileVirtual(
          "/test/main.wm",
          new Map([[
            "/test/main.wm",
            `
        from c.header("winsock2.h", lib: "ws2_32") import unsafe { htons };
        let main = () => { print(htons(${argument})); };
      `,
          ]]),
        ), Error);
    }
  },
});

Deno.test("C header wildcard imports expose referenced values and types without loading unused symbols", async () => {
  const header = JSON.stringify(
    fileURLToPath(new URL("./fixtures/c_ffi_edges.h", import.meta.url)),
  );
  const output = await run(
    new Map([[
      "/test/main.wm",
      `
    from c.header("stdio.h") import unsafe *;
    from c.header(${header}) import unsafe *;
    from "host/c/pointer.wm" import * as Pointer;
    let main = () => {
      let value = EdgeNested{ prefix = Word8.fromNumber(9) };
      print(value.size);
      print(Pointer.getU8(value.pointer, 0));
      print(EXACT_UNSIGNED);
      puts(Some(Pointer.fromString("wildcard")));
    };
  `,
    ]]),
  );
  assertEquals(output, "24\n9\n18446744073709551615\nwildcard\n");
});

Deno.test("explicit imports take precedence over C header wildcards", async () => {
  const output = await run(
    new Map([[
      "/test/main.wm",
      `
    from c.header("stdio.h") import unsafe { puts };
    from c.header("stdio.h") import unsafe *;
    from "host/c/pointer.wm" import * as Pointer;
    let main = () => { puts(Some(Pointer.fromString("explicit"))); };
  `,
    ]]),
  );
  assertEquals(output, "explicit\n");
});

Deno.test("unqualified FFI wildcard imports require unsafe C header reflection", async () => {
  await assertRejects(
    () =>
      compileVirtual(
        "/test/main.wm",
        new Map([[
          "/test/main.wm",
          `
    from c.header("stdio.h") import *;
    let main = () => { void };
  `,
        ]]),
      ),
    Error,
    "add unsafe",
  );
  await assertRejects(
    () =>
      compileVirtual(
        "/test/main.wm",
        new Map([[
          "/test/main.wm",
          `
    from js.global("Math") import unsafe *;
    let main = () => { void };
  `,
        ]]),
      ),
    Error,
    "require c.header",
  );
});

Deno.test({
  name: "Winsock namespace wildcards expose qualified calls and aggregate construction",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const output = await run(
      new Map([[
        "/test/main.wm",
        `
      from c.header("winsock2.h", lib: "ws2_32") import unsafe * as Winsock;
      let main = () => {
        let data = Winsock.WSAData{};
        print(Winsock.WSAStartup(Word16.fromNumber(514), Some(data.pointer)));
        let address = Winsock.sockaddr_in{ sin_family = Winsock.AF_INET };
        print(address.size);
        Winsock.WSACleanup();
      };
    `,
      ]]),
    );
    assertEquals(output, "0\n16\n");
  },
});

Deno.test("C storage records preserve their fields and pointee type across modules", async () => {
  const header = JSON.stringify(
    fileURLToPath(new URL("./fixtures/c_ffi_edges.h", import.meta.url)),
  );
  const output = await run(
    new Map([
      [
        "/test/storage.wm",
        `
      from c.header(${header}) import type { EdgeChoice };
      let create = () => { EdgeChoice{ word = Word32.fromNumber(42) } };
      let identity = (storage: CStorage<EdgeChoice>) => { storage };
    `,
      ],
      [
        "/test/main.wm",
        `
      from "./storage.wm" import { create, identity };
      from "host/c/pointer.wm" import * as Pointer;
      let main = () => {
        let storage = identity(create());
        let .{ pointer, size } = storage;
        print(size);
        print(Pointer.getU32(pointer, 0));
      };
    `,
      ],
    ]),
  );
  assertEquals(output, "4\n42\n");
  await assertRejects(() =>
    compileVirtual(
      "/test/main.wm",
      new Map([[
        "/test/main.wm",
        `
    from c.header(${header}) import type { EdgeNested, EdgeChoice };
    let main = () => {
      let wrong: CStorage<EdgeChoice> = EdgeNested{};
      print(wrong.size);
    };
  `,
      ]]),
    ), Error);
});

Deno.test("C aggregate literals accept qualified lowercase type names", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const header = `${dir}/lower.h`;
    await Deno.writeTextFile(header, "typedef struct lower { int x; int y; } lower;");
    const output = await run(
      new Map([[
        "/test/main.wm",
        `
      from c.header(${JSON.stringify(header)}) import unsafe * as Native;
      from "host/c/pointer.wm" import * as Pointer;
      let main = () => {
        let value = Native.lower{ x = 17 };
        print(Pointer.getI32(value.pointer, 0));
        print(Pointer.getI32(value.pointer, 4));
        print(value.size);
      };
    `,
      ]]),
    );
    assertEquals(output, "17\n0\n8\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("C constants retain exact signed/unsigned 64-bit values and tagged structs expose layouts", async () => {
  const header = fileURLToPath(new URL("./fixtures/c_ffi_edges.h", import.meta.url));
  const output = await run(
    new Map([[
      "/test/main.wm",
      `
    from c.header(${
        JSON.stringify(header)
      }) import unsafe { EXACT_UNSIGNED, EXACT_SIGNED, EXACT_RECORD };
    from c.header(${JSON.stringify(header)}) import type { EdgeData };
    let main = () => {
      print(EXACT_UNSIGNED);
      print(Int64.toString(EXACT_SIGNED));
      print(sizeOfEdgeData);
      print(offsetOfEdgeData_count);
      print(EXACT_RECORD.value);
      print(Int64.toString(EXACT_RECORD.signed_value));
      let wide = newEdgeWide(EXACT_UNSIGNED, EXACT_SIGNED);
      print(Int64.toString(getEdgeWide_signed_value(wide)));
    };
  `,
    ]]),
  );
  assertEquals(
    output,
    "18446744073709551615\n-9223372036854775807\n24\n20\n18446744073709551615\n-9223372036854775807\n-9223372036854775807\n",
  );
});

Deno.test("mutable C strings use shared pointers across Workman modules", async () => {
  const output = await run(
    new Map([
      [
        "/test/buffer.wm",
        `from c.header("stdlib.h") import unsafe { malloc }; let create = () => { malloc(Word64.fromNumber(32)) };`,
      ],
      [
        "/test/main.wm",
        `
      from "./buffer.wm" import { create };
      from "host/c/pointer.wm" import * as Pointer;
      from "host/c/resource.wm" import { withCleanup };
      from c.header("stdlib.h") import unsafe { free };
      from c.header("string.h") import unsafe { strcpy, strstr };
      from c.header(${
          JSON.stringify(fileURLToPath(new URL("./fixtures/c_ffi_edges.h", import.meta.url)))
        }) import type { EdgeData };
      let main = () => {
        let raw = match(create()) { Some(pointer) => { pointer }, None => { Panic("malloc failed") } };
        withCleanup(() => {
        let buffer = Pointer.cast(raw);
        let returned = strcpy(Some(buffer), Some(Pointer.fromString("hello")));
        match(returned) {
          Some(pointer) => { print(Pointer.readUtf8(pointer, 5)); },
          None => { Panic("strcpy returned null"); },
        };
        Pointer.writeUtf8(buffer, 0, "A\\u0000B");
        print(Pointer.getU8(buffer, 1));
        match(strstr(Some(buffer), Some(Pointer.fromString("missing")))) {
          None => { print("null"); },
          Some(_) => { Panic("expected a null C pointer result"); },
        };
        free(None);
        let data = Pointer.cast(raw);
        setEdgeData_count(data, 123);
        print(getEdgeData_count(data));
        }, () => { free(Some(raw)); });
      };
    `,
      ],
    ]),
  );
  assertEquals(output, "hello\n0\nnull\n123\n");
});

Deno.test({
  name: "C signed and unsigned 64-bit function arguments and results round-trip through UCRT",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const output = await run(
      new Map([[
        "/test/main.wm",
        `
      from c.header("stdlib.h") import unsafe { _abs64, _strtoui64 };
      from "host/c/pointer.wm" import * as Pointer;
      let main = () => {
        print(Int64.toString(_abs64(Int64.fromString("-9223372036854775807"))));
        print(_strtoui64(Some(Pointer.fromString("18446744073709551615")), None, 10));
      };
    `,
      ]]),
    );
    assertEquals(output, "9223372036854775807\n18446744073709551615\n");
  },
});

Deno.test("reflected annotations cannot change the C ABI", async () => {
  const error = await assertRejects(
    () =>
      compileVirtual(
        "/test/main.wm",
        new Map([[
          "/test/main.wm",
          `
    from c.header("stdio.h") import unsafe { puts: Number -> Number };
    let main = () => { puts(42); };
  `,
        ]]),
      ),
    Error,
    "annotation must match the reflected signature",
  );
  assertStringIncludes(error.message, "puts");
});

Deno.test("raw pointer adapters write native allocations and cleanup after exceptions", () => {
  const library = Deno.dlopen(
    Deno.build.os === "windows"
      ? "ucrtbase.dll"
      : Deno.build.os === "darwin"
      ? "/usr/lib/libSystem.B.dylib"
      : "libc.so.6",
    {
      calloc: { parameters: ["usize", "usize"], result: "pointer" },
      free: { parameters: ["pointer"], result: "void" },
    },
  );
  const pointer = library.symbols.calloc(1n, 8n)!;
  try {
    const tail = Memory.offset(pointer, 4);
    Memory.setI32(tail, 0, 1234);
    assertEquals(Memory.getI32(pointer, 4), 1234);
    let cleaned = false;
    try {
      Memory.withCleanup(() => {
        throw new Error("body failed");
      }, () => {
        cleaned = true;
      });
    } catch { /* Expected. */ }
    assertEquals(cleaned, true);
    assertEquals(Memory.equals(pointer, Memory.cast(pointer)), true);
  } finally {
    library.symbols.free(pointer);
    library.close();
  }
});

Deno.test("C ABI parameters and aggregate fields select ordinary integer literals", async () => {
  const header = JSON.stringify(
    fileURLToPath(new URL("./fixtures/c_ffi_edges.h", import.meta.url)),
  );
  const output = await run(
    new Map([[
      "/test/main.wm",
      `
    from c.header("stdlib.h") import unsafe { calloc, free };
    from c.header(${header}) import type { EdgeNested, EdgeWide };
    let main = () => {
      let Some(memory) = calloc(1, 1024);
      free(Some(memory));
      let nested = EdgeNested{ prefix = 255, inner = { port = 8080, choice = { word = 4294967295 } } };
      print(getEdgeNested_prefix(nested.pointer));
      let wide = EdgeWide{ signed_value = -9223372036854775808 };
      print(Int64.toString(getEdgeWide_signed_value(wide.pointer)));
    };
  `,
    ]]),
  );
  assertEquals(output, "255\n-9223372036854775808\n");
});

Deno.test("lowercase opaque C typedefs work in closed annotations without capturing explicit type parameters", async () => {
  const header = JSON.stringify(
    fileURLToPath(new URL("./fixtures/c_ffi_edges.h", import.meta.url)),
  );
  const output = await run(
    new Map([[
      "/test/main.wm",
      `
    from c.header(${header}) import type { edge_handle };
    from c.header("stdlib.h") import unsafe { calloc, free };
    from "host/c/pointer.wm" import * as Pointer;
    record HandleBox = { pointer: Ptr<edge_handle> };
    record Generic<edge_handle> = { value: edge_handle };
    let main = () => {
      let Some(memory) = calloc(1, 8);
      let handle: Ptr<edge_handle> = Pointer.cast(memory);
      let boxed = HandleBox{ pointer = handle };
      let generic: Generic<Number> = Generic{ value = 7 };
      print(Pointer.equals(boxed.pointer, memory));
      print(generic.value);
      free(Some(Pointer.cast(boxed.pointer)));
    };
  `,
    ]]),
  );
  assertEquals(output, "true\n7\n");
});

Deno.test("native pointer slots expose null and C out parameters with exact byte distances", async () => {
  const output = await run(
    new Map([[
      "/test/main.wm",
      `
    from c.header("stdlib.h") import unsafe { calloc, free, strtol };
    from "host/c/pointer.wm" import * as Pointer;
    let main = () => {
      let Some(slot) = calloc(1, 8);
      print(match(Pointer.getPointer(slot, 0)) { None => { "null" }, Some(_) => { "unexpected" } });
      let text = Pointer.fromString("123tail");
      strtol(Some(text), Some(Pointer.cast(slot)), 10);
      let Some(tail) = Pointer.getPointer(slot, 0);
      print(Pointer.toString(tail));
      print(Pointer.distance(text, tail));
      print(Pointer.distance(tail, text));
      free(Some(slot));
    };
  `,
    ]]),
  );
  assertEquals(output, "null\ntail\n3\n-3\n");
});

Deno.test("fromBytes gives C the address of a JS typed array", async () => {
  const output = await run(
    new Map([[
      "/test/main.wm",
      `
    from js.global import { Uint8Array };
    from c.header("string.h") import unsafe { memset };
    from "host/c/pointer.wm" import * as Pointer;
    let main = () => {
      let Ok(bytes) = Uint8Array.new(4);
      memset(Some(Pointer.fromBytes(bytes)), 7, 3);
      print(Pointer.getU8(Pointer.fromBytes(bytes), 2));
      print(Pointer.getU8(Pointer.fromBytes(bytes), 3));
    };
  `,
    ]]),
  );
  assertEquals(output, "7\n0\n");
});

Deno.test({
  name: "manual C unit signatures call nullary functions and expose libc errno without a C shim",
  ignore: Deno.build.os !== "linux",
  async fn() {
    const output = await run(
      new Map([[
        "/test/main.wm",
        `
      from c.lib("c") import unsafe {
        getpid: Void -> I32,
        __errno_location as location: Void -> Option<Ptr<I32>>,
      };
      from "host/c/pointer.wm" import * as Pointer;
      let main = () => {
        print(getpid() > 0);
        let Some(pointer) = location();
        let previous = Pointer.getI32(pointer, 0);
        Pointer.setI32(pointer, 0, 123);
        let Some(again) = location();
        print(Pointer.getI32(again, 0));
        Pointer.setI32(again, 0, previous);
      };
    `,
      ]]),
    );
    assertEquals(output, "true\n123\n");
  },
});

Deno.test("unary native scalar imports remain callable as higher-order WM functions", async () => {
  const output = await run(
    new Map([[
      "/test/main.wm",
      `
    from c.lib("c") import unsafe {
      abs as manualAbs: I32 -> I32,
      strcmp: (Ptr<I32>, Ptr<I32>) -> I32
    };
    from "host/c/pointer.wm" import * as Pointer;
    from c.header("stdlib.h", lib: "c") import unsafe * as Lib;
    let apply = (function: I32 -> I32, value: I32) => { function(value) };
    let main = () => {
      print(apply(manualAbs, -17));
      print(apply(Lib.abs, -23));
      let compare = (function: (Ptr<I32>, Ptr<I32>) -> I32) => {
        function(Pointer.fromString("alpha"), Pointer.fromString("alpha"))
      };
      print(compare(strcmp));
      print(strcmp(Pointer.fromString("alpha"), Pointer.fromString("beta")) < 0);
    };
  `,
    ]]),
  );
  assertEquals(output, "17\n23\n0\ntrue\n");
});

Deno.test("authored C string results decode according to their declared optionality", async () => {
  const output = await run(
    new Map([[
      "/test/main.wm",
      `
    from c.lib("c") import unsafe {
      strchr: (String, I32) -> String,
      strrchr: (String, I32) -> Option<String>
    };
    let main = () => {
      print(strchr("alpha", 112) ++ "!");
      print(strchr("λ雪abc", 97));
      match(strrchr("hello", 108)) {
        Some(text) => { print(text ++ "!"); }, None => { Panic("missing suffix") }
      };
      match(strrchr("hello", 120)) {
        Some(_) => { Panic("unexpected suffix") }, None => { print("absent"); }
      };
    };
  `,
    ]]),
  );
  assertEquals(output, "pha!\nabc\nlo!\nabsent\n");
});

Deno.test("table deletion is available through the WM host module", async () => {
  const output = await run(
    new Map([[
      "/test/main.wm",
      `
    from js.host("table") import * as Table;
    let main = () => {
      let table = Table.empty();
      Table.setAt(table, 3, "three");
      Table.set(table, "label", "value");
      Table.removeAt(table, 3);
      print(match(Table.getAt(table, 3)) { None => { "removed" }, Some(_) => { "present" } });
      print(match(Table.get(table, "label")) { Some(value) => { value }, None => { "missing" } });
      Table.remove(table, "label");
      print(match(Table.get(table, "label")) { None => { "removed" }, Some(_) => { "present" } });
    };
  `,
    ]]),
  );
  assertEquals(output, "removed\nvalue\nremoved\n");
});

Deno.test("primitive receiver calls and reflected globals need no application JavaScript helpers", async () => {
  const output = await run(
    new Map([[
      "/test/main.wm",
      `
    from js.global("JSON") import { stringify };
    from js.global("Number") import { isSafeInteger };
    let unwrap = match { Ok(value) => { value }, Err(_) => { Panic("host failure") } };
    let main = () => {
      print("  hello  " :> .trim :> unwrap);
      print("  hello  " :> .trim() :> unwrap);
      print("hello" :> .indexOf("l", 0) :> unwrap);
      print("hello" :> .length :> unwrap);
      print("a-b_" :> .replaceAll("-", "+") :> unwrap);
      print(stringify("line\\n") :> unwrap);
      print(isSafeInteger(42) :> unwrap);
    };
  `,
    ]]),
  );
  assertEquals(output, 'hello\nhello\n2\n5\na+b_\n"line\\n"\ntrue\n');
});
