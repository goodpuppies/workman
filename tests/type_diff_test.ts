import { assertEquals } from "@std/assert";
import { formatPathSegment } from "../src/type_diff.ts";

Deno.test("type mismatch paths render readable segments", () => {
  assertEquals(formatPathSegment({ kind: "fn-param", index: 0 }), "parameter 1");
  assertEquals(formatPathSegment({ kind: "fn-result" }), "result");
  assertEquals(formatPathSegment({ kind: "tuple-item", index: 1 }), "tuple item 2");
  assertEquals(
    formatPathSegment({ kind: "named-arg", index: 1, label: "error", typeName: "Task" }),
    "Task error",
  );
});
