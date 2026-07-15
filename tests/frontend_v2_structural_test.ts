import { assertEquals } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import {
  type FrontendV2,
  type LexRoundTripResult,
  loadFrontendV2,
} from "../src/frontend_v2_loader.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;
const frontend = await loadFrontendV2(await buildFrontend());

Deno.test("frontend-v2 recovers missing let slots through canonical marks", () => {
  const missingExpression = frontend.parseStructural("let thing =");
  const missingPattern = frontend.parseStructural("let =");

  assertEquals(missingExpression.virtualText, "let thing =?;");
  assertEquals(
    missingExpression.artifacts.map((artifact) => artifact.text),
    ["?", ";"],
  );
  assertEquals(
    missingExpression.marks.map((mark) => [mark.code, mark.severity, mark.hasRepair]),
    [
      ["parse.let.missing-expression", "error", false],
      ["parse.let.missing-semicolon", "warning", true],
    ],
  );
  assertEquals(
    missingExpression.items[0].expressionRecoveryId,
    missingExpression.marks[0].id,
  );

  assertEquals(missingPattern.virtualText, "let _=?;");
  assertEquals(
    missingPattern.artifacts.map((artifact) => artifact.text),
    ["_", "?", ";"],
  );
  assertEquals(missingPattern.items[0].patternRecoveryId, missingPattern.marks[0].id);
  assertStructuralRecoveryIntegrity(missingExpression);
  assertStructuralRecoveryIntegrity(missingPattern);
});

Deno.test("frontend-v2 distinguishes authored expression holes from inferred holes", () => {
  const authored = frontend.parseStructural("let value = ?;");
  const inferred = frontend.parseStructural("let value =;");

  assertEquals(authored.virtualText, "let value = ?;");
  assertEquals(authored.items[0].expressionKind, "authored-hole");
  assertEquals(authored.items[0].expressionRecoveryId, -1);
  assertEquals(authored.marks, []);

  assertEquals(inferred.virtualText, "let value =?;");
  assertEquals(inferred.items[0].expressionKind, "hole");
  assertEquals(inferred.items[0].expressionRecoveryId, inferred.marks[0].id);
  assertEquals(
    inferred.marks.map((mark) => mark.code),
    ["parse.let.missing-expression"],
  );
  assertStructuralRecoveryIntegrity(authored);
  assertStructuralRecoveryIntegrity(inferred);
});

Deno.test("frontend-v2 SurfaceProgram owns literal, long-name, and missing-terminator state", () => {
  const source = "let printer = Lib.printer\nlet answer = 42;";
  const result = frontend.parseStructural(source);

  assertEquals(result.items[0].expressionSurfaceKind, "name");
  assertEquals(result.items[0].expressionNameParts, ["Lib", "printer"]);
  assertEquals(result.items[0].terminatorRecoveryId, result.marks[0].id);
  assertEquals(result.items[1].expressionSurfaceKind, "literal");
  assertEquals(result.items[1].expressionNameParts, []);
  assertEquals(result.items[1].terminatorRecoveryId, -1);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 missing semicolon preserves later declarations and maps repairs", () => {
  const source = "let a = one\nlet b = two;";
  const result = frontend.parseStructural(source);

  assertEquals(result.concreteText, source);
  assertEquals(result.virtualText, "let a = one;\nlet b = two;");
  assertEquals(result.items.map((item) => item.kind), ["let", "let"]);
  assertEquals(result.marks.map((mark) => mark.code), ["parse.let.missing-semicolon"]);
  assertEquals(result.artifacts[0].anchor, 11);
  assertEquals(
    result.pieces.map((piece) => [
      piece.kind,
      piece.concreteStart,
      piece.concreteEnd,
      piece.virtualStart,
      piece.virtualEnd,
    ]),
    [
      ["concrete", 0, 11, 0, 11],
      ["virtual", 11, 11, 11, 12],
      ["concrete", 11, 24, 12, 25],
    ],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 preserves complete and incomplete annotated let bindings", () => {
  const complete = frontend.parseStructural("let value: Number = one;");
  const missingExpression = frontend.parseStructural("let value: Number =");

  assertEquals(complete.concreteText, "let value: Number = one;");
  assertEquals(complete.virtualText, "let value: Number = one;");
  assertEquals(complete.items.map((item) => item.kind), ["let"]);
  assertEquals(complete.marks, []);

  assertEquals(missingExpression.virtualText, "let value: Number =?;");
  assertEquals(
    missingExpression.marks.map((mark) => mark.code),
    ["parse.let.missing-expression", "parse.let.missing-semicolon"],
  );
  assertEquals(missingExpression.items[0].expressionRecoveryId, missingExpression.marks[0].id);
  assertStructuralRecoveryIntegrity(complete);
  assertStructuralRecoveryIntegrity(missingExpression);
});

Deno.test("frontend-v2 keeps shallow complex let patterns together", () => {
  const tuple = frontend.parseStructural("let (a, b): Pair = value;");
  const constructor = frontend.parseStructural("let Some(x) = value\nlet next = done;");

  assertEquals(tuple.virtualText, "let (a, b): Pair = value;");
  assertEquals(tuple.items.map((item) => item.kind), ["let"]);
  assertEquals(tuple.items[0].patternKind, "name");
  assertEquals(tuple.items[0].patternRecoveryId, -1);
  assertEquals(tuple.marks, []);

  assertEquals(
    constructor.virtualText,
    "let Some(x) = value;\nlet next = done;",
  );
  assertEquals(constructor.items.map((item) => item.kind), ["let", "let"]);
  assertEquals(constructor.items[0].patternKind, "name");
  assertEquals(
    constructor.marks.map((mark) => mark.code),
    ["parse.let.missing-semicolon"],
  );
  assertStructuralRecoveryIntegrity(tuple);
  assertStructuralRecoveryIntegrity(constructor);
});

Deno.test("frontend-v2 keeps shallow recursive let groups together", () => {
  const complete = frontend.parseStructural("let rec a = one and b = two;");
  const missingSemicolon = frontend.parseStructural(
    "let rec a = one and b = two\nlet c = three;",
  );
  const beforeType = frontend.parseStructural(
    "let rec a = one and b = two\ntype Next = Done;",
  );

  assertEquals(complete.concreteText, "let rec a = one and b = two;");
  assertEquals(complete.virtualText, complete.concreteText);
  assertEquals(complete.items.map((item) => item.kind), ["let"]);
  assertEquals(complete.marks, []);

  assertEquals(
    missingSemicolon.virtualText,
    "let rec a = one and b = two;\nlet c = three;",
  );
  assertEquals(missingSemicolon.items.map((item) => item.kind), ["let", "let"]);
  assertEquals(
    missingSemicolon.marks.map((mark) => mark.code),
    ["parse.let.missing-semicolon"],
  );
  assertEquals(
    beforeType.virtualText,
    "let rec a = one and b = two;\ntype Next = Done;",
  );
  assertEquals(beforeType.items.map((item) => item.kind), ["let", "type"]);
  assertEquals(
    beforeType.marks.map((mark) => mark.code),
    ["parse.let.missing-semicolon"],
  );
  assertStructuralRecoveryIntegrity(complete);
  assertStructuralRecoveryIntegrity(missingSemicolon);
  assertStructuralRecoveryIntegrity(beforeType);
});

Deno.test("frontend-v2 keeps shallow multi-token let expressions together", () => {
  const complete = frontend.parseStructural(
    "let value = make(thing).field ++ other[0];",
  );
  const missingSemicolon = frontend.parseStructural(
    "let value = make(thing).field ++ other[0]\nlet next = done;",
  );

  assertEquals(complete.virtualText, complete.concreteText);
  assertEquals(complete.items.map((item) => item.kind), ["let"]);
  assertEquals(complete.marks, []);

  assertEquals(
    missingSemicolon.virtualText,
    "let value = make(thing).field ++ other[0];\nlet next = done;",
  );
  assertEquals(missingSemicolon.items.map((item) => item.kind), ["let", "let"]);
  assertEquals(
    missingSemicolon.marks.map((mark) => mark.code),
    ["parse.let.missing-semicolon"],
  );
  assertStructuralRecoveryIntegrity(complete);
  assertStructuralRecoveryIntegrity(missingSemicolon);
});

Deno.test("frontend-v2 exposes optional, auto-fix, and recovery-only mark classes", () => {
  const optional = frontend.parseStructural("let main = => print(thing);");
  const autoFix = frontend.parseStructural("let value = one");
  const recoveryOnly = frontend.parseStructural("let value =;");

  assertEquals(optional.marks[0].repairClass, "optionalCanonical");
  assertEquals(optional.marks[0].severity, "hint");
  assertEquals(autoFix.marks[0].repairClass, "autoFix");
  assertEquals(autoFix.marks[0].hasRepair, true);
  assertEquals(recoveryOnly.marks[0].repairClass, "recoveryOnly");
  assertEquals(recoveryOnly.marks[0].severity, "error");
});

Deno.test("frontend-v2 recognizes import forms and recovers their terminators", () => {
  const source =
    'from "./dep.wm" import { Thing }\nfrom js.global("console") import unsafe { log }\nlet value = Thing;';
  const result = frontend.parseStructural(source);

  assertEquals(result.concreteText, source);
  assertEquals(
    result.virtualText,
    'from "./dep.wm" import { Thing };\nfrom js.global("console") import unsafe { log };\nlet value = Thing;',
  );
  assertEquals(result.items.map((item) => item.kind), ["import", "import", "let"]);
  assertEquals(result.marks.map((mark) => mark.code), [
    "parse.import.missing-semicolon",
    "parse.import.missing-semicolon",
  ]);
  assertEquals(
    result.artifacts.map((artifact) => [artifact.anchor, artifact.text]),
    [[32, ";"], [80, ";"]],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 recognizes type and record declarations", () => {
  const complete = frontend.parseStructural(
    "type Maybe<a> = Nothing | Some(a);\nrecord Point = { x: Number, y: Number };",
  );
  const missingSemicolons = frontend.parseStructural(
    "type Maybe<a> = Nothing | Some(a)\nrecord Point = { x: Number, y: Number }\nlet origin = Point;",
  );

  assertEquals(complete.virtualText, complete.concreteText);
  assertEquals(complete.items.map((item) => item.kind), ["type", "record"]);
  assertEquals(complete.marks, []);

  assertEquals(
    missingSemicolons.virtualText,
    "type Maybe<a> = Nothing | Some(a);\nrecord Point = { x: Number, y: Number };\nlet origin = Point;",
  );
  assertEquals(missingSemicolons.items.map((item) => item.kind), ["type", "record", "let"]);
  assertEquals(
    missingSemicolons.marks.map((mark) => mark.code),
    ["parse.type.missing-semicolon", "parse.record.missing-semicolon"],
  );
  assertEquals(
    missingSemicolons.artifacts.map((artifact) => artifact.text),
    [";", ";"],
  );
  assertStructuralRecoveryIntegrity(complete);
  assertStructuralRecoveryIntegrity(missingSemicolons);
});

Deno.test("frontend-v2 parser progress is bounded on damaged repeated constructs", () => {
  const fixtures = [
    "let let let let",
    "let rec a = one and and and\nrecord Bad = { x: } type T = A",
    "type A = | | | record R = { , , , } from import import",
    "let value = match(input) => { Some(x) => x\nNone => y",
    "let value = match(input) => { A => { one } B =>",
    "let main = (((value))) =>",
    "let fetch = lift Task (((url))) =>",
    "let choose = if (((ready))) else",
    "let value = make([one",
    "let [Some(value = source",
    "type Value<T = List<Result<T",
    "record Point = { x: List<Number",
    "from import { Thing",
    "from js.global import * as",
    "////\n@\n@\n@\nlet =\nfrom js.global import {",
  ];

  for (const source of fixtures) {
    const lexed = frontend.lexRoundTrip(source);
    const structural = frontend.parseStructural(source);
    assertEquals(structural.concreteText, source);
    assertProgressWithinSignificantTokens(lexed, structural, source);
    assertStructuralRecoveryIntegrity(structural);
  }
});

function assertProgressWithinSignificantTokens(
  lexed: LexRoundTripResult,
  structural: ReturnType<FrontendV2["parseStructural"]>,
  source: string,
): void {
  const significantTokens =
    lexed.tokens.filter((token) =>
      token.kind !== "whitespace" && token.kind !== "comment" && token.kind !== "eof"
    ).length;
  assertEquals(
    structural.progressSteps <= significantTokens,
    true,
    `progress ${structural.progressSteps} exceeded ${significantTokens} significant tokens in ${
      JSON.stringify(source)
    }`,
  );
}

function assertStructuralRecoveryIntegrity(
  result: ReturnType<FrontendV2["parseStructural"]>,
): void {
  const markIds = result.marks.map((mark) => mark.id);
  assertEquals(new Set(markIds).size, markIds.length);
  assertEquals(
    result.artifacts.every((artifact) => markIds.includes(artifact.recoveryId)),
    true,
  );
  for (const item of result.items) {
    for (
      const recoveryId of [
        item.recoveryId,
        item.patternRecoveryId,
        item.expressionRecoveryId,
        item.terminatorRecoveryId,
      ]
    ) {
      if (recoveryId >= 0) {
        assertEquals(markIds.filter((id) => id === recoveryId).length, 1);
      }
    }
  }
  let cursor = 0;
  let rebuilt = "";
  for (const artifact of result.artifacts) {
    rebuilt += result.concreteText.slice(cursor, artifact.anchor) + artifact.text;
    cursor = artifact.anchor;
  }
  rebuilt += result.concreteText.slice(cursor);
  assertEquals(rebuilt, result.virtualText);
  for (let index = 1; index < result.artifacts.length; index += 1) {
    const previous = result.artifacts[index - 1];
    const current = result.artifacts[index];
    if (previous.anchor === current.anchor) {
      assertEquals(previous.order < current.order, true);
    } else {
      assertEquals(previous.anchor <= current.anchor, true);
    }
  }
}

async function buildFrontend(): Promise<URL> {
  const output = (await Deno.makeTempDir()) + "/frontend-v2.mjs";
  await Deno.writeTextFile(output, await compileLibraryFile(frontendSource));
  return new URL("file://" + output);
}
