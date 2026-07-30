import { assertEquals, assertThrows } from "@std/assert";
import {
  hashGrammarIr,
  inventoryGrammar,
  parseWorkmanGrammar,
} from "../scripts/frontend_v2_grammar_ir.ts";
import {
  FRONTEND_V2_GENERATOR_CONTRACT_VERSION,
  validateGeneratorContract,
} from "../tooling/frontend-v2/generator/contract.ts";
import { classifyGrammarActions } from "../tooling/frontend-v2/generator/action_ir.ts";
import { inventoryInitializer } from "../tooling/frontend-v2/generator/initializer_inventory.ts";
import {
  formatterFixtures,
  negativeRecognizerSmokeFixtures,
  recognizerSmokeFixtures,
} from "../tooling/frontend-v2/generator/fixtures.ts";
import { recognizeGrammar } from "../tooling/frontend-v2/generator/recognizer.ts";
import { parse } from "../src/parser.ts";

const grammarPath = new URL("../src/grammar.peggy", import.meta.url);
const grammarSource = await Deno.readTextFile(grammarPath);
const grammar = parseWorkmanGrammar(grammarSource, "src/grammar.peggy");

Deno.test("frontend-v2 grammar IR normalizes every current Peggy construct", () => {
  const inventory = inventoryGrammar(grammar);
  assertEquals(inventory.ruleCount, 123);
  assertEquals(inventory.unresolvedRuleReferences, []);
  assertEquals(inventory.actionClassifications, {
    mechanical: 0,
    named: 0,
    unclassified: 223,
  });
  assertEquals(inventory.expressionKinds, {
    action: 222,
    any: 3,
    choice: 49,
    class: 17,
    group: 9,
    labeled: 299,
    literal: 290,
    oneOrMore: 5,
    optional: 72,
    ruleRef: 635,
    semanticAnd: 1,
    sequence: 192,
    simpleNot: 18,
    text: 5,
    zeroOrMore: 47,
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
    "d9bb191c8e9dad43f39e59918e426b2ec8671dd5efddc346b24f9ee72a271b76",
  );
});

Deno.test("frontend-v2 classifies every Peggy action without evaluating JavaScript", () => {
  const actions = classifyGrammarActions(grammar.actions);
  assertEquals(actions.filter((action) => action.kind === "mechanical").length, 210);
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
    "liftedParam",
    "liftedLambda",
    "ascribedExpr",
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
    recoveries: [],
  } as const;
  validateGeneratorContract({ ...base, exceptions: [] });
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
});

Deno.test("frontend-v2 recognizer smoke fixtures are accepted by the Peggy frontend", async () => {
  for (const fixture of recognizerSmokeFixtures) {
    await parse(fixture.source);
  }
});

Deno.test("frontend-v2 normalized IR matches Peggy recognition smoke cases", async () => {
  for (const fixture of recognizerSmokeFixtures) {
    await parse(fixture.source);
    assertEquals(recognizeGrammar(grammar, fixture.source), true, fixture.name);
  }
  for (const fixture of negativeRecognizerSmokeFixtures) {
    let peggyAccepted = true;
    try {
      await parse(fixture.source);
    } catch {
      peggyAccepted = false;
    }
    assertEquals(peggyAccepted, false, fixture.name);
    assertEquals(recognizeGrammar(grammar, fixture.source), false, fixture.name);
  }
});

Deno.test("frontend-v2 normalized IR matches Peggy on the repository WM corpus", async () => {
  const roots = [
    new URL("../std", import.meta.url),
    new URL("../examples", import.meta.url),
    new URL("../tooling", import.meta.url),
  ];
  let checked = 0;
  for (const root of roots) {
    for await (const path of wmFiles(root)) {
      const source = await Deno.readTextFile(path);
      let peggyAccepted = true;
      try {
        await parse(source);
      } catch {
        peggyAccepted = false;
      }
      assertEquals(recognizeGrammar(grammar, source), peggyAccepted, path);
      checked += 1;
    }
  }
  assertEquals(checked >= 80, true);
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
