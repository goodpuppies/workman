import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { compileVirtual } from "../src/compiler.ts";
import { fileURLToPath } from "node:url";
import * as Memory from "../host/c/js/pointer.js";

async function run(files: Map<string, string>): Promise<string> {
  const dir = await Deno.makeTempDir();
  try {
    const js = await compileVirtual("/test/main.wm", files);
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
