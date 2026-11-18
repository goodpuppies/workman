import { assertEquals, assertStringIncludes } from "@std/assert";
import { genericDiagnostic } from "../src/diagnostic_model.ts";
import { createDiagnosticWriter } from "../src/diagnostic_writer.ts";
import { focusedSignature } from "../src/diagnostics/signature_display.ts";
import { fn, prim, tuple } from "../src/types.ts";

Deno.test("long signatures retain the conflicting slot and its surrounding arrows", () => {
  const writer = createDiagnosticWriter();
  const longTuple = tuple(Array.from({ length: 12 }, () => prim("Real64.Real")));
  const signature = writer.snapshotType(fn([longTuple], fn([prim("String")], longTuple)));
  const diagnostic = genericDiagnostic("error", "test", "signature display");
  diagnostic.support = writer.buildSupport([]);

  assertEquals(
    focusedSignature(diagnostic, signature, [
      { kind: "fn-result" },
      { kind: "fn-param", index: 0 },
    ], 24),
    ".. -> String -> ..",
  );
  assertEquals(
    focusedSignature(diagnostic, signature, [
      { kind: "fn-param", index: 0 },
      { kind: "tuple-item", index: 7 },
    ], 24),
    "(.., Real64.Real, ..) -> ..",
  );
  const full = focusedSignature(diagnostic, signature, [{ kind: "fn-result" }], Infinity);
  assertStringIncludes(full, "String ->");
  assertEquals(full.includes(".."), false);
});
