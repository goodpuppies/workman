import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  hashGrammarIr,
  inventoryGrammar,
  parseWorkmanGrammar,
} from "../scripts/frontend_v2_grammar_ir.ts";
import { decodeSurfaceProgram } from "../src/frontend_v2_surface_loader.ts";
import {
  FRONTEND_V2_GENERATOR_CONTRACT_VERSION,
  validateGeneratorContract,
} from "../tooling/frontend-v2/generator/contract.ts";
import { classifyGrammarActions } from "../tooling/frontend-v2/generator/action_ir.ts";
import { emitCompiledProbe } from "../tooling/frontend-v2/generator/compiled_probe_emitter.ts";
import { inventoryInitializer } from "../tooling/frontend-v2/generator/initializer_inventory.ts";
import { frontendV2RecoveryAnnotations } from "../tooling/frontend-v2/generator/recovery_annotations.ts";
import {
  formatterFixtures,
  negativeRecognizerSmokeFixtures,
  recognizerSmokeFixtures,
} from "../tooling/frontend-v2/generator/fixtures.ts";
import { recognizeGrammar } from "../tooling/frontend-v2/generator/recognizer.ts";
import { frontendV2SemanticGolden, repositoryWmPath } from "./frontend_v2_semantic_golden.ts";

const surfaceParser = await import("../src/generated/frontend_v2_parser.js") as {
  parseSurfaceProgram(source: string): unknown;
};

const grammarPath = new URL("../src/grammar.peggy", import.meta.url);
const grammarSource = await Deno.readTextFile(grammarPath);
const grammar = parseWorkmanGrammar(grammarSource, "src/grammar.peggy");

Deno.test("frontend-v2 grammar IR normalizes every current Peggy construct", () => {
  const inventory = inventoryGrammar(grammar);
  assertEquals(inventory.ruleCount, 134);
  assertEquals(inventory.unresolvedRuleReferences, []);
  assertEquals(inventory.actionClassifications, {
    mechanical: 0,
    named: 0,
    unclassified: 238,
  });
  assertEquals(inventory.expressionKinds, {
    action: 237,
    any: 4,
    choice: 53,
    class: 18,
    group: 10,
    labeled: 319,
    literal: 318,
    oneOrMore: 6,
    optional: 77,
    ruleRef: 681,
    semanticAnd: 1,
    sequence: 209,
    simpleNot: 24,
    text: 5,
    zeroOrMore: 49,
  });
});

Deno.test("frontend-v2 grammar IR and action identities are deterministic", () => {
  const second = parseWorkmanGrammar(grammarSource, "src/grammar.peggy");
  assertEquals(second, grammar);
  assertEquals(new Set(grammar.actions.map((action) => action.id)).size, grammar.actions.length);
});

Deno.test("frontend-v2 grammar IR has a reproducible structural golden", async () => {
  assertEquals(
    await hashGrammarIr(grammar),
    "7df5f1c7d683dc56d521679b882f50d1d68dec40fc7f5dc2c15fd44bab264994",
  );
});

Deno.test("frontend-v2 classifies every Peggy action without evaluating JavaScript", () => {
  const actions = classifyGrammarActions(grammar.actions);
  assertEquals(actions.filter((action) => action.kind === "mechanical").length, 225);
  assertEquals(
    actions.filter((action) => action.kind === "named").map((action) => action.actionId),
    [
      "Start:root.expression.elements.0",
      "TypeDeclBody:root",
      "MatchFn:root",
      "Or:root",
      "And:root",
      "Equality:root",
      "Compare:root",
      "Add:root",
      "Mul:root",
      "Pipe:root",
      "Postfix:root",
      "BlockSeqBody:root",
      "ParenSeqBody:root",
    ],
  );
});

Deno.test("frontend-v2 inventories every initializer helper as a named WM boundary", () => {
  const initializer = inventoryInitializer(grammar);
  assertEquals(initializer.state, [
    { jsName: "nextNodeId", wmName: "nextNodeId", initialValue: 0 },
    { jsName: "nextLiftId", wmName: "nextLiftId", initialValue: 0 },
    { jsName: "nextAnonymousMatchId", wmName: "nextAnonymousMatchId", initialValue: 0 },
  ]);
  assertEquals(initializer.helpers.map((helper) => helper.jsName), [
    "span",
    "node",
    "at",
    "atSpan",
    "isDecl",
    "implicitVoid",
    "spanFromStartToLoc",
    "longId",
    "spelling",
    "longNode",
    "mod",
    "topExpression",
    "asCtor",
    "nilExpr",
    "consExpr",
    "listExpr",
    "nilPattern",
    "consPattern",
    "listPattern",
    "recordField",
    "recordSpread",
    "recordPatternField",
    "jsonField",
    "varExpr",
    "callExpr",
    "callExprAtSpan",
    "tupleExpr",
    "matchExpr",
    "anonymousMatchFn",
    "liftedParam",
    "liftedLambda",
    "ascribedExpr",
    "ascribedPattern",
    "maybeAscribedPattern",
    "taskTupleLift",
    "carrierTupleLift",
  ]);
});

Deno.test("frontend-v2 generator contract enforces the exception cap and known rules", () => {
  const actions = classifyGrammarActions(grammar.actions);
  const initializer = inventoryInitializer(grammar);
  const base = {
    version: FRONTEND_V2_GENERATOR_CONTRACT_VERSION,
    grammar,
    initializer,
    actions,
    recoveries: frontendV2RecoveryAnnotations,
  } as const;
  validateGeneratorContract({ ...base, exceptions: [] });
  assertEquals(frontendV2RecoveryAnnotations.length, 28);
  assertEquals(
    frontendV2RecoveryAnnotations.map(({ rule, token }) => `${rule}:${token}`),
    [
      "TopPhrase:;",
      "SemiToken:;",
      "ImportClause:{",
      "ImportClause:}",
      "JsImportClauseBody:{",
      "JsImportClauseBody:}",
      "RecordDecl:{",
      "RecordDecl:}",
      "MatchExpr:{",
      "MatchExpr:}",
      "MatchFn:{",
      "MatchFn:}",
      "AnonymousMatchFn:{",
      "AnonymousMatchFn:}",
      "LambdaBlock:{",
      "LambdaBlock:}",
      "JsonExpr:{",
      "JsonExpr:}",
      "RecordExpr:{",
      "RecordExpr:}",
      "Block:{",
      "Block:}",
      "RecordPattern:{",
      "RecordPattern:}",
      "RecordLetPattern:{",
      "RecordLetPattern:}",
      "RecordParamPattern:{",
      "RecordParamPattern:}",
    ],
  );
  assertThrows(
    () => validateGeneratorContract({ ...base, actions: actions.slice(1), exceptions: [] }),
    Error,
    "unclassified",
  );
  assertThrows(
    () =>
      validateGeneratorContract({
        ...base,
        exceptions: Array.from({ length: 9 }, (_, index) => ({
          peggyRule: "Start",
          kind: "grammar" as const,
          wmFunction: `exception${index}`,
          reason: "fixture-only cap check",
          fixture: `cap-${index}`,
        })),
      }),
    Error,
    "generator exception cap exceeded",
  );
  assertThrows(
    () =>
      validateGeneratorContract({
        ...base,
        exceptions: [{
          peggyRule: "MissingRule",
          kind: "grammar",
          wmFunction: "missingRule",
          reason: "unknown rule check",
          fixture: "unknown-rule",
        }],
      }),
    Error,
    "unknown rule",
  );
  assertThrows(
    () =>
      validateGeneratorContract({
        ...base,
        exceptions: [],
        recoveries: [
          ...frontendV2RecoveryAnnotations,
          frontendV2RecoveryAnnotations[0],
        ],
      }),
    Error,
    "annotated twice",
  );
  assertThrows(
    () =>
      validateGeneratorContract({
        ...base,
        exceptions: [],
        recoveries: [{
          rule: "TopPhrase",
          after: "fixture",
          token: "{",
          synchronizeAt: ["end of input"],
        }],
      }),
    Error,
    "no required literal",
  );
});

Deno.test("frontend-v2 compiled recovery is driven by declared annotations", () => {
  const withoutRecoveries = [...emitCompiledProbe(grammar, "fixture", []).values()].join("\n");
  assertEquals(withoutRecoveries.includes('"TopPhrase:semicolon"'), false);
  assertEquals(withoutRecoveries.includes('"RecordExpr:open-brace"'), false);

  const withRecoveries = [
    ...emitCompiledProbe(grammar, "fixture", frontendV2RecoveryAnnotations).values(),
  ].join("\n");
  assertStringIncludes(withRecoveries, '"TopPhrase:semicolon"');
  assertStringIncludes(withRecoveries, '"RecordExpr:open-brace"');
  assertStringIncludes(withRecoveries, '"RecordExpr:close-brace"');
});

Deno.test("frontend-v2 compiled rule dispatch uses constant-time lookup tables", () => {
  const dispatch = emitCompiledProbe(
    grammar,
    "fixture",
    frontendV2RecoveryAnnotations,
  ).get("compiled_probe_dispatch.wm")!;

  assertStringIncludes(dispatch, "let strictCompiledRules = {");
  assertStringIncludes(dispatch, "let recoveringCompiledRules = {");
  assertEquals(dispatch.includes("match((name, recover))"), false);
  assertEquals(dispatch.match(/Table\.set\(rules,/g)?.length, grammar.rules.length * 2);
});

Deno.test("frontend-v2 generated recognizer accepts every positive smoke fixture", () => {
  for (const fixture of recognizerSmokeFixtures) {
    assertEquals(
      decodeSurfaceProgram(surfaceParser.parseSurfaceProgram(fixture.source)) !== undefined,
      true,
      fixture.name,
    );
  }
});

Deno.test("frontend-v2 normalized IR matches generated recognition smoke cases", () => {
  for (const fixture of recognizerSmokeFixtures) {
    assertEquals(recognizeGrammar(grammar, fixture.source), true, fixture.name);
    assertEquals(
      decodeSurfaceProgram(surfaceParser.parseSurfaceProgram(fixture.source)) !== undefined,
      true,
      fixture.name,
    );
  }
  for (const fixture of negativeRecognizerSmokeFixtures) {
    assertEquals(recognizeGrammar(grammar, fixture.source), false, fixture.name);
    const recovered = decodeSurfaceProgram(surfaceParser.parseSurfaceProgram(fixture.source));
    if (recovered) {
      assertEquals(recovered.marks.length > 0, true, fixture.name);
      assertEquals(
        recovered.marks.every((mark) => [";", "{", "}"].includes(mark.expectedText)),
        true,
        fixture.name,
      );
    }
  }
});

Deno.test("frontend-v2 normalized IR matches the repository semantic golden corpus", async () => {
  const roots = [
    new URL("../std", import.meta.url),
    new URL("../examples", import.meta.url),
    new URL("../tooling", import.meta.url),
  ];
  const checked: string[] = [];
  for (const root of roots) {
    for await (const path of wmFiles(root)) {
      const source = await Deno.readTextFile(path);
      const relative = repositoryWmPath(path);
      const expected = frontendV2SemanticGolden.files[relative];
      if (expected === undefined) throw new Error(`missing semantic golden for ${relative}`);
      const accepted = expected !== null;
      assertEquals(recognizeGrammar(grammar, source), accepted, relative);
      assertEquals(
        decodeSurfaceProgram(surfaceParser.parseSurfaceProgram(source)) !== undefined,
        accepted,
        relative,
      );
      checked.push(relative);
    }
  }
  assertEquals(checked.sort(), Object.keys(frontendV2SemanticGolden.files).sort());
});

Deno.test("frontend-v2 Phase 0 formatter fixtures declare stable mode outputs", () => {
  assertEquals(formatterFixtures.length >= 4, true);
  for (const fixture of formatterFixtures) {
    assertEquals(fixture.real.endsWith("\n"), true, fixture.name);
    assertEquals(fixture.realFix.endsWith("\n"), true, fixture.name);
  }
});

async function* wmFiles(root: URL): AsyncGenerator<string> {
  const directory = new URL(root.href.endsWith("/") ? root.href : root.href + "/");
  for await (const entry of Deno.readDir(root)) {
    const entryUrl = new URL(entry.name + (entry.isDirectory ? "/" : ""), directory);
    if (entry.isDirectory) {
      yield* wmFiles(entryUrl);
    } else if (entry.isFile && entry.name.endsWith(".wm")) {
      yield entryUrl.pathname;
    }
  }
}
