import { assertEquals } from "@std/assert";
import { mapTypeDesc } from "../src/ffi/c/mapping.ts";

Deno.test("C integer mapping uses reflected width and signedness rather than typedef spelling", () => {
  for (const bits of [8, 16, 32, 64]) {
    for (const position of ["param", "return", "field", "value"] as const) {
      const unsigned = mapTypeDesc(
        { kind: "int", name: "c_ushort", bits, signed: false },
        new Map(),
        position,
      );
      assertEquals(unsigned.type, { kind: "TName", name: `Word${bits}.Word`, args: [] });
      const signed = mapTypeDesc(
        { kind: "int", name: "c_long", bits, signed: true },
        new Map(),
        position,
      );
      assertEquals(signed.type, {
        kind: "TName",
        name: bits <= 32 ? "I32" : "Int64.Int",
        args: [],
      });
    }
  }
  assertEquals(
    mapTypeDesc({ kind: "int", bits: 24, signed: false }, new Map()).unsupported,
    "C integer width 24 is not supported",
  );
  assertEquals(
    mapTypeDesc({ kind: "int", bits: 128, signed: false }, new Map()).unsupported,
    "C integer width 128 exceeds 64 bits",
  );
  assertEquals(
    mapTypeDesc({
      kind: "pointer",
      child: {
        kind: "int",
        bits: 16,
        signed: false,
      },
    }, new Map()).type,
    {
      kind: "TName",
      name: "Option",
      args: [{
        kind: "TName",
        name: "Ptr",
        args: [{ kind: "TName", name: "Word16.Word", args: [] }],
      }],
    },
  );
});
