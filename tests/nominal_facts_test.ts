import { assert, assertEquals } from "@std/assert";
import { analyzeVirtual, compile, compileVirtual, coreVirtual } from "../src/compiler.ts";
import { basisTypeNameId } from "../src/compiler_semantics.ts";
import type { CoreModule } from "../src/core/ast.ts";

Deno.test("program analysis assigns shared type, record, constructor, and basis identities", async () => {
  const analysis = await coreVirtual(
    "/test/main.wm",
    new Map([[
      "/test/main.wm",
      `
      type Choice<T> = EmptyChoice | Choice<T>;
      record Point = { x: Number, y: Number };
      let value = Choice(1);
    `,
    ]]),
  );
  const facts = analysis.nominalFacts;

  assertEquals(facts.types.map((fact) => [fact.name, fact.id, fact.kind]), [
    ["Choice", 0, "adt"],
    ["Point", 1, "record"],
  ]);
  assertEquals(facts.records.map((fact) => [fact.name, fact.id, fact.typeNameId]), [
    ["Point", 0, 1],
  ]);
  assertEquals(facts.constructors.map((fact) => [fact.name, fact.id, fact.tag]), [
    ["EmptyChoice", 0, 0],
    ["Choice", 1, 1],
  ]);

  const result = analysis.results.get("/test/main.wm")!;
  assertEquals(
    facts.inferenceTypeIds.get(result.typeEnv.get("Option")!.id),
    basisTypeNameId("Option"),
  );
  assertEquals(
    facts.inferenceTypeIds.get(result.typeEnv.get("Gpu.Color")!.id),
    basisTypeNameId("Gpu.Color"),
  );

  const core = analysis.core.modules.get("/test/main.wm")!.module;
  const choice = core.decls.find((decl) => decl.kind === "CoreType" && decl.name === "Choice");
  const point = core.decls.find((decl) => decl.kind === "CoreRecord" && decl.name === "Point");
  assert(choice?.kind === "CoreType" && point?.kind === "CoreRecord");
  assertEquals(choice.typeNameId, facts.types[0].id);
  assertEquals(choice.ctors.map((ctor) => ctor.id), facts.constructors.map((ctor) => ctor.id));
  assertEquals(point.typeNameId, facts.types[1].id);
  assertEquals(point.recordId, facts.records[0].id);
});

Deno.test("qualified same-spelled constructors keep distinct inference-owned identities", async () => {
  const virtualFs = new Map([
    ["/test/a.wm", "type A = | Box;"],
    ["/test/b.wm", "type B = | Box;"],
    [
      "/test/main.wm",
      `from "./a.wm" import * as A;
       from "./b.wm" import * as B;
       let a = A.Box;
       let b = B.Box;
       let readA = match(a) { A.Box => { 1 } };
       let readB = match(b) { B.Box => { 2 } };
       let main = () => { print(readA + readB) };`,
    ],
  ]);
  const analysis = await coreVirtual("/test/main.wm", virtualFs);
  const boxes = analysis.nominalFacts.constructors.filter((fact) => fact.name === "Box");
  assertEquals(boxes.map((fact) => [fact.modulePath, fact.id]), [
    ["/test/a.wm", 0],
    ["/test/b.wm", 1],
  ]);

  const references = [...analysis.nominalFacts.constructorReferences.entries()]
    .flatMap(([node, id]) =>
      (node.kind === "Var" || node.kind === "PCtor") && node.name.endsWith("Box")
        ? [[node.kind, node.name, id]]
        : []
    );
  assertEquals(references, [
    ["Var", "A.Box", 0],
    ["Var", "B.Box", 1],
    ["PCtor", "A.Box", 0],
    ["PCtor", "B.Box", 1],
  ]);

  const coreIds = constructorIds(analysis.core.modules.get("/test/main.wm")!.module);
  assertEquals(coreIds, [0, 1, 0, 1]);

  const output: string[] = [];
  const executable = await compileVirtual("/test/main.wm", virtualFs);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction("console", executable)({
    log: (value: unknown) => output.push(String(value)),
  });
  assertEquals(output, ["3"]);
});

Deno.test("constructor facts follow inference when a local value shadows an imported alias", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([
      ["/test/lib.wm", "type Wrapped = | Box;"],
      [
        "/test/main.wm",
        `from "./lib.wm" import { Box as box };
         let constructed = box;
         let box = 1;
         let scalar = box;`,
      ],
    ]),
  );
  const main = analysis.results.get("/test/main.wm")!;
  const refs = [...main.facts.expressions.entries()].filter(([expr]) =>
    expr.kind === "Var" && expr.name === "box"
  );
  assertEquals(refs.map(([, fact]) => fact.subject), ["constructor", "expr"]);
  assertEquals(
    refs.map(([expr]) => analysis.nominalFacts.constructorReferences.get(expr)),
    [analysis.nominalFacts.constructors[0].id, undefined],
  );
});

Deno.test("block-local nominal declarations receive non-exported shared identities", async () => {
  const source = `
    let run = () => {
      type Local = | LocalValue;
      let ignored = LocalValue;
      0
    };
  `;
  const analysis = await coreVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const localType = analysis.nominalFacts.types.find((fact) => fact.name === "Local")!;
  const localCtor = analysis.nominalFacts.constructors.find((fact) => fact.name === "LocalValue")!;
  assertEquals(localType.exported, false);
  assertEquals(localCtor.exported, false);
  assertEquals(localCtor.typeNameId, localType.id);
  assertEquals(
    constructorIds(analysis.core.modules.get("/test/main.wm")!.module),
    [localCtor.id],
  );

  const executable = await compile(`
    let main = () => {
      type Local = | LocalValue;
      let value = LocalValue;
      print(match(value) { LocalValue => { 7 } })
    };
  `);
  const output: string[] = [];
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction("console", executable)({
    log: (value: unknown) => output.push(String(value)),
  });
  assertEquals(output, ["7"]);
});

function constructorIds(value: CoreModule): number[] {
  const ids: number[] = [];
  visit(value, (record) => {
    if (
      (record.kind === "CoreVar" || record.kind === "CorePCtor") &&
      typeof record.ctorId === "number"
    ) {
      ids.push(record.ctorId);
    }
  });
  return ids;
}

function visit(value: unknown, action: (record: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  action(record);
  for (const [key, child] of Object.entries(record)) {
    if (key === "node") continue;
    if (Array.isArray(child)) child.forEach((item) => visit(item, action));
    else visit(child, action);
  }
}
