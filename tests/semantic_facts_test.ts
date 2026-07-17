import { assertEquals } from "@std/assert";
import { analyzeVirtual } from "../src/compiler.ts";
import { GPU_OPERATOR_IDS } from "../src/gpu_operators.ts";

Deno.test("recursion facts preserve authored groups and resolved invocation kinds", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([[
      "/test/main.wm",
      `let rec even = (n) => {
         if (n == 0) { true } else { odd(n - 1) }
       } and odd = (n) => {
         if (n == 0) { false } else { even(n - 1) }
       };
       let rec countdown = (n) => {
         if (n == 0) { 0 } else { countdown(n - 1) }
       };
       let rec pipeLoop = (n) => {
         if (n == 0) { 0 } else { n - 1 :> pipeLoop }
       };
       let rec shadowed = (n) => {
         let shadowed = (x) => { x };
         shadowed(n)
       };
       let callCountdown = () => { countdown(3) };
       let rec asValue = () => {
         let alias = asValue;
         alias()
       };
       let host = () => {
         let rec inner = (n) => {
           if (n == 0) { 0 } else { inner(n - 1) }
         };
         inner(2)
       };`,
    ]]),
  );
  const facts = analysis.recursionFacts;

  assertEquals(facts.groups.map((group) => group.id), range(facts.groups.length));
  assertEquals(
    facts.groups.map((group) =>
      group.members.map((member) =>
        member.binding.pattern.kind === "PVar" ? member.binding.pattern.name : "?"
      )
    ),
    [["even", "odd"], ["countdown"], ["pipeLoop"], ["shadowed"], ["asValue"], ["inner"]],
  );
  assertEquals(facts.references.map((reference) => reference.id), range(facts.references.length));
  assertEquals(countBy(facts.references.map((reference) => reference.relation)), {
    mutual: 2,
    self: 4,
    external: 2,
  });
  assertEquals(countBy(facts.references.map((reference) => reference.invocation)), {
    call: 6,
    pipe: 1,
    value: 1,
  });
  const shadowed = facts.groups.find((group) =>
    group.members[0].binding.pattern.kind === "PVar" &&
    group.members[0].binding.pattern.name === "shadowed"
  )!;
  assertEquals(
    facts.references.some((reference) => reference.groupId === shadowed.id),
    false,
  );
});

Deno.test("inference records only the frozen visual-v1 operator catalog", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([[
      "/test/main.wm",
      `let add = 1 + 2;
       let subtract = 2 - 1;
       let multiply = 2 * 3;
       let divide = 4 / 2;
       let remainder = 5 % 2;
       let less = 1 < 2;
       let lessEqual = 1 <= 2;
       let greater = 2 > 1;
       let greaterEqual = 2 >= 1;
       let equal = 1 == 1;
       let notEqual = true != false;
       let both = true && false;
       let either = true || false;
       let negate = -1;
       let not = !false;
       let append = "a" ++ "b";`,
    ]]),
  );
  const result = analysis.results.get("/test/main.wm")!;

  assertEquals([...result.facts.operators.values()], [
    GPU_OPERATOR_IDS.add,
    GPU_OPERATOR_IDS.subtract,
    GPU_OPERATOR_IDS.multiply,
    GPU_OPERATOR_IDS.divide,
    GPU_OPERATOR_IDS.remainder,
    GPU_OPERATOR_IDS.lessThan,
    GPU_OPERATOR_IDS.lessThanOrEqual,
    GPU_OPERATOR_IDS.greaterThan,
    GPU_OPERATOR_IDS.greaterThanOrEqual,
    GPU_OPERATOR_IDS.equal,
    GPU_OPERATOR_IDS.notEqual,
    GPU_OPERATOR_IDS.and,
    GPU_OPERATOR_IDS.or,
    GPU_OPERATOR_IDS.negate,
    GPU_OPERATOR_IDS.not,
  ]);
  const allOperatorTokens = [...result.types.keys()]
    .filter((expression) => expression.kind === "Unary" || expression.kind === "Binary")
    .map((expression) => expression.op);
  assertEquals(allOperatorTokens.includes("%"), true);
  assertEquals(allOperatorTokens.includes("++"), true);
  assertEquals(result.facts.operators.size, 15);
});

function range(length: number): number[] {
  return Array.from({ length }, (_, index) => index);
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}
