import { assertEquals } from "@std/assert";
import type { StructuralParseResult } from "../src/frontend_v2_loader.ts";
import { structuralInlayHints } from "../src/lsp/structural_inlays.ts";

Deno.test("structural inlays preserve virtual artifact order and recovery visibility", () => {
  const source = "let thing = ";
  const result = structuralResult(source, [
    artifact(1, source.length, "?", "recoveryOnly", 0),
    artifact(2, source.length, ";", "autoFix", 1),
  ]);
  result.marks = [
    mark(1, "parse.let.missing-expression", "an expression", "recoveryOnly", 0),
    mark(2, "parse.let.missing-semicolon", "a semicolon", "autoFix", 1),
  ];

  const hints = structuralInlayHints(source, result, fullRange(source));

  assertEquals(hints.map((hint) => hint.label), ["?", ";"]);
  assertEquals(hints.map((hint) => hint.position), [
    { line: 0, character: source.length },
    { line: 0, character: source.length },
  ]);
  assertEquals(hints.map((hint) => hint.data.repairClass), ["recoveryOnly", "autoFix"]);
  assertEquals(hints[0].data.code, "parse.let.missing-expression");
});

Deno.test("structural inlays honor the requested range and omit whitespace artifacts", () => {
  const source = "let x = 1\nlet y = 2";
  const secondLine = source.indexOf("\n") + 1;
  const result = structuralResult(source, [
    artifact(1, source.indexOf("\n"), ";", "autoFix", 0),
    artifact(2, secondLine + "let y = 2".length, ";", "autoFix", 1),
    artifact(3, secondLine + 3, "  ", "optionalCanonical", 2),
  ]);

  const hints = structuralInlayHints(source, result, {
    start: { line: 1, character: 0 },
    end: { line: 1, character: 9 },
  });

  assertEquals(hints.map((hint) => hint.label), [";"]);
  assertEquals(hints[0].position, { line: 1, character: 9 });
});

Deno.test("structural inlays use UTF-16 character positions", () => {
  const source = "let 🚀 =";
  const result = structuralResult(source, [
    artifact(1, source.length, "?", "recoveryOnly", 0),
  ]);

  const hints = structuralInlayHints(source, result, fullRange(source));

  assertEquals(hints[0].position, { line: 0, character: 8 });
});

function structuralResult(
  source: string,
  artifacts: StructuralParseResult["artifacts"],
): StructuralParseResult {
  return {
    schemaVersion: 1,
    sourceLength: source.length,
    progressSteps: 0,
    concreteText: source,
    virtualText: source,
    items: [],
    marks: [],
    artifacts,
    pieces: [],
  };
}

function artifact(
  recoveryId: number,
  anchor: number,
  text: string,
  repairClass: StructuralParseResult["artifacts"][number]["repairClass"],
  order: number,
): StructuralParseResult["artifacts"][number] {
  return { recoveryId, anchor, text, reason: "virtual syntax", repairClass, pairId: -1, order };
}

function mark(
  id: number,
  code: string,
  expectation: string,
  repairClass: StructuralParseResult["marks"][number]["repairClass"],
  order: number,
): StructuralParseResult["marks"][number] {
  return {
    id,
    code,
    phase: "parsing",
    anchor: 0,
    rule: code,
    rulePath: code,
    subject: 0,
    expectation,
    observation: "missing",
    recovery: "virtual syntax",
    fallbackNode: 0,
    fallbackCategory: "syntax",
    severity: "warning",
    repairClass,
    hasRepair: repairClass === "autoFix",
    repairText: "",
    pairId: -1,
    order,
    dependsOn: [],
  };
}

function fullRange(source: string) {
  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: source.length },
  };
}
