import { assertEquals } from "@std/assert";
import { analyzeVirtual } from "../src/compiler.ts";
import type { Pattern } from "../src/ast.ts";
import { prune } from "../src/types.ts";

Deno.test("resolved pattern facts preserve all Workman grammar contexts and semantic IDs", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([
      [
        "/test/types.wm",
        `record Pair = { first: Number, second: Bool };
         type Choice = None | Some<Pair>;`,
      ],
      [
        "/test/main.wm",
        `from "./types.wm" import { Pair, Choice, None, Some };
         let pinned = 1;
         let pair = .{ first = 2, second = true };
         let .{ first = fromLet, second = _ } = pair;
         let project = (.{ first = fromParam, second = _ }) => { fromParam };
         let choice = Some(pair);
         let result = match(choice) {
           Some(.{ first = Var(found), second = true }) => { found },
           None => { pinned },
         };
         let pinnedResult = match(1) {
           pinned => { 1 },
           _ => { 0 },
         };`,
      ],
    ]),
  );
  const facts = analysis.patternFacts;
  const mainResult = analysis.results.get("/test/main.wm")!;
  const mainBindings = analysis.bindings.get("/test/main.wm")!;

  assertEquals(facts.patterns.map((fact) => fact.id), range(facts.patterns.length));
  assertEquals(facts.params.map((fact) => fact.declaredIndex), [0]);
  assertEquals(facts.matchArms.map((fact) => fact.declaredIndex), [0, 1, 0, 1]);
  assertEquals(facts.lets.length, 7);
  assertEquals(facts.patterns.length, mainResult.facts.patternTypes.size);

  const fromLet = namedPattern(facts.patterns, "fromLet");
  const fromParam = namedPattern(facts.patterns, "fromParam");
  const found = namedPattern(facts.patterns, "found");
  const pinned = facts.patterns.find((fact) => fact.kind === "pinned")!;
  assertEquals([fromLet.context, fromParam.context, found.context, pinned.context], [
    "let",
    "parameter",
    "match",
    "match",
  ]);
  assertEquals(fromLet.bindingId, mainBindings.binders.get(fromLet.pattern));
  assertEquals(fromParam.bindingId, mainBindings.binders.get(fromParam.pattern));
  assertEquals(found.bindingId, mainBindings.binders.get(found.pattern));
  assertEquals(pinned.pinnedBindingId, mainBindings.exports.get("pinned"));

  const recordId = analysis.nominalFacts.records.find((record) => record.name === "Pair")!.id;
  const recordPatterns = facts.patterns.filter((fact) => fact.kind === "record");
  assertEquals(recordPatterns.map((fact) => [fact.recordId, fact.fieldIndices]), [
    [recordId, [0, 1]],
    [recordId, [0, 1]],
    [recordId, [0, 1]],
  ]);

  const constructors = facts.patterns.filter((fact) => fact.kind === "constructor");
  const constructorIds = new Map(
    analysis.nominalFacts.constructors.map((constructor) => [constructor.name, constructor.id]),
  );
  assertEquals(
    constructors.map((fact) => [
      (fact.pattern as Extract<Pattern, { kind: "PCtor" }>).name,
      fact.constructorId,
    ]),
    [["Some", constructorIds.get("Some")], ["None", constructorIds.get("None")]],
  );
  const some = constructors[0];
  assertEquals(prune(some.type).tag, "named");
  assertEquals(prune(mainResult.facts.patterns.get(some.pattern)!.instantiated!).tag, "fn");
});

Deno.test("host patterns over compiler standard-library records retain field evidence", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([[
      "/test/main.wm",
      `let get = (.{ fn }: Monad.Carrier<
        Number, Number, Number, Number,
        Number, Number, Number, Number,
        Number, Number, Number, Number,
        Number, Number, Number, Number
      >) => { fn };`,
    ]]),
  );
  const record = analysis.patternFacts.patterns.find((fact) => fact.kind === "record")!;

  assertEquals(record.context, "parameter");
  assertEquals(record.fieldIndices, [0]);
  assertEquals(record.recordId, undefined);
  assertEquals(typeof record.recordInferenceTypeId, "number");
});

Deno.test("recursive binding placeholders provide authoritative pattern types", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([[
      "/test/main.wm",
      `let rec count = (n) => {
         if (n == 0) { 0 } else { count(n - 1) }
       };`,
    ]]),
  );
  const binding = namedPattern(analysis.patternFacts.patterns, "count");

  assertEquals(binding.context, "let");
  assertEquals(prune(binding.type).tag, "fn");
});

function namedPattern(
  facts: import("../src/pattern_facts.ts").ResolvedPatternFact[],
  name: string,
) {
  return facts.find((fact) => fact.pattern.kind === "PVar" && fact.pattern.name === name)!;
}

function range(length: number): number[] {
  return Array.from({ length }, (_, index) => index);
}
