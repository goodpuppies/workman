import { assertEquals, assertStrictEquals } from "@std/assert";
import { BASIS_OPERATORS, BASIS_TYPES } from "../src/basis_manifest.ts";
import { basisCtorId } from "../src/basis.ts";
import { BASIS_TYPE_NAME_IDS, GPU_SEMANTIC_IDS } from "../src/compiler_semantics.ts";
import { checkSource, compile } from "../src/compiler.ts";
import { lookupLongValue } from "../src/infer/environment.ts";
import type { StaticEnv } from "../src/infer/environment.ts";
import { BASIS_PROFILES, initialBasis } from "../src/initial_basis.ts";
import { loadStandardModules } from "../src/standard_library.ts";
import { expectBinding } from "./type_helpers.ts";

const primitiveTypes = [
  "Number",
  "Bool",
  "String",
  "Void",
];

const jsTypes = [
  "Js.Value",
  "Js.Object",
  "Js.Array",
  "Js.ArrayLike",
  "Js.Dict",
];

const gpuTypes = [
  "Gpu.Color",
  "Gpu.Fragment",
  "Gpu.Uniform",
  "Gpu.Texture2D",
  "Gpu.SampledTexture2D",
  "Gpu.RenderTarget2D",
  "Gpu.Sampler",
];

const fixedOperators = [
  "+",
  "-",
  "*",
  "/",
  "%",
  "++",
  "<",
  "<=",
  ">",
  ">=",
  "==",
  "!=",
  "&&",
  "||",
];

Deno.test("[module update T130] current no-prelude static interface is explicit", () => {
  const basis = initialBasis(BASIS_PROFILES.kernel).instantiate();
  const { tyEnv: typeEnv, valEnv: env } = basis.environment;

  assertEquals([...typeEnv.keys()], primitiveTypes);
  assertEquals(
    [...basis.environment.strEnv.get("Js")!.tyEnv.keys()],
    jsTypes.map((name) => name.slice("Js.".length)),
  );
  assertEquals(
    [...basis.environment.strEnv.get("Gpu")!.tyEnv.keys()],
    gpuTypes.map((name) => name.slice("Gpu.".length)),
  );
  assertEquals([...env.keys()], ["print"]);
  assertEquals([...basis.operators.keys()], fixedOperators);
});

Deno.test("[module update T130/T132] current default low-level basis type interface is explicit", () => {
  const typeEnv = initialBasis(BASIS_PROFILES.default).instantiate().environment.tyEnv;
  assertEquals([...typeEnv].map(([name, info]) => [name, info.arity]), [
    ...primitiveTypes.map((name) => [name, 0]),
    ["Option", 1],
    ["Result", 2],
    ["List", 1],
    ["Task", 2],
  ]);
});

Deno.test("[module update T130/T133] current default constructors and low-level members are explicit", () => {
  const basis = initialBasis(BASIS_PROFILES.default).instantiate();
  const { valEnv: env } = basis.environment;

  assertEquals(
    [...env]
      .filter(([, scheme]) => scheme.status === "constructor")
      .map(([name]) => name),
    ["None", "Some", "Ok", "Err", "Nil", "Cons"],
  );
  assertEquals(
    [...env]
      .filter(([, scheme]) => scheme.status !== "constructor")
      .map(([name]) => name),
    ["print"],
  );
  assertEquals(
    [...basis.environment.strEnv.get("Result")!.valEnv.keys()],
    ["Ok", "Err", "textOf"],
  );
  assertEquals(
    [...basis.environment.strEnv.get("Task")!.valEnv.keys()],
    [
      "fromResult",
      "succeed",
      "fail",
      "map",
      "map2",
      "race",
      "andThen",
      "mapErr",
      "recover",
      "all",
    ],
  );
  assertEquals(
    [...basis.environment.strEnv.get("Js")!.strEnv.get("Array")!.valEnv.keys()],
    ["toList", "fromList"],
  );
  assertEquals([...basis.environment.strEnv.get("Dict")!.valEnv.keys()], [
    "empty",
    "get",
    "set",
  ]);
  assertEquals([...basis.operators.keys()], fixedOperators);
});

Deno.test("[module update B301] initial basis instances cannot mutate the cached definition", () => {
  const artifact = initialBasis(BASIS_PROFILES.default);
  const first = artifact.instantiate();
  first.environment.valEnv.clear();
  first.environment.strEnv.get("Gpu")?.valEnv.clear();
  first.operators.clear();

  const second = artifact.instantiate();

  assertEquals(second.environment.valEnv.has("print"), true);
  assertEquals(second.environment.strEnv.get("Gpu")?.valEnv.has("fragment"), true);
  assertEquals(second.operators.has("+"), true);
});

Deno.test("[module update B309] pervasive bindings come from the explicit profile table", () => {
  assertEquals(
    initialBasis(BASIS_PROFILES.kernel).pervasiveBindings.map((binding) => binding.target),
    ["print"],
  );
  assertEquals(
    initialBasis(BASIS_PROFILES.default).pervasiveBindings.map((binding) => binding.target),
    ["print", "None", "Some", "Ok", "Err", "Nil", "Cons"],
  );
});

Deno.test("[module update B302/B314/B318/T132] basis facts own type and intrinsic identity", () => {
  const facts = initialBasis(BASIS_PROFILES.default).facts;

  assertEquals(
    facts.types.map((type) => [type.name, type.typeNameId]),
    BASIS_TYPES.map((type) => [type.name, BASIS_TYPE_NAME_IDS[type.name]]),
  );
  assertEquals(
    new Set(facts.types.map((type) => type.typeNameId)).size,
    facts.types.length,
  );
  assertEquals(
    facts.intrinsics.map((intrinsic) => intrinsic.semanticId).sort(),
    Object.values(GPU_SEMANTIC_IDS).sort(),
  );
});

Deno.test("[module update B302/B318/T133] constructor facts agree with ValEnv status", () => {
  const artifact = initialBasis(BASIS_PROFILES.default);
  const basis = artifact.instantiate();

  for (const constructor of artifact.facts.constructors) {
    assertEquals(constructor.status, "constructor");
    assertEquals(constructor.id, basisCtorId(constructor.name));
    const pervasive = artifact.pervasiveBindings.find((binding) =>
      binding.source === `${constructor.typeName}.${constructor.name}`
    );
    if (!pervasive) continue;
    assertEquals(basis.environment.valEnv.get(pervasive.target)?.status, "constructor");
  }
});

Deno.test("[module update B309/T134] pervasive constructors project the structure member", () => {
  const artifact = initialBasis(BASIS_PROFILES.default);
  const basis = artifact.instantiate();

  for (const binding of artifact.pervasiveBindings.filter((item) => item.source.includes("."))) {
    const member = lookupLongValue(basis.environment.strEnv, binding.source);
    const pervasive = basis.environment.valEnv.get(binding.target);
    if (!member || !pervasive) throw new Error(`missing pervasive projection ${binding.target}`);
    assertStrictEquals(pervasive, member);
  }
});

Deno.test("[module update B304] fixed operators type expressions without ValEnv bindings", async () => {
  const result = await checkSource("let value = 1 + 2;");

  expectBinding(result.env, "value", { type: "Number", vars: 0 });
  assertEquals(result.env.has("+"), false);
});

Deno.test("[module update B302/T135] fixed operator static and runtime catalogs agree", async () => {
  assertEquals(
    initialBasis(BASIS_PROFILES.default).facts.operators.map((operator) => operator.spelling),
    BASIS_OPERATORS.map((operator) => operator.spelling),
  );
  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    const compiled = await compile('let main = () => { print((1 + 2) * 3 == 9) };');
    await import(`data:text/javascript;base64,${btoa(compiled)}#${crypto.randomUUID()}`);
  } finally {
    console.log = original;
  }
  assertEquals(output, ["true"]);
});

Deno.test("[module update T131/G9] every initial static value has an implementation fact", async () => {
  const artifact = initialBasis(BASIS_PROFILES.default);
  const basis = artifact.instantiate();
  const implemented = new Set([
    ...artifact.facts.values.map((value) => value.exportName),
    ...artifact.facts.intrinsics.map((intrinsic) => intrinsic.exportName),
    ...artifact.facts.constructors.map((constructor) =>
      constructor.name.includes(".")
        ? constructor.name
        : `${constructor.typeName}.${constructor.name}`
    ),
    ...artifact.pervasiveBindings.map((binding) => binding.target),
  ]);
  assertEquals(
    collectStaticValues(basis.environment).filter((name) => !implemented.has(name)),
    [],
  );

  const runtimeReferences = [
    ...artifact.facts.values.map((value) => value.exportName),
    ...artifact.facts.intrinsics.flatMap((intrinsic) =>
      intrinsic.runtimeName ? [intrinsic.exportName] : []
    ),
    ...artifact.facts.constructors.map((constructor) =>
      constructor.name.includes(".")
        ? constructor.name
        : `${constructor.typeName}.${constructor.name}`
    ),
  ];
  const compiled = await compile(`let runtimeFacts = (${runtimeReferences.join(", ")});`);
  await import(`data:text/javascript;base64,${btoa(compiled)}#${crypto.randomUUID()}`);
});

Deno.test("[module update T136/B305] pervasive print is an ordinarily shadowable value", async () => {
  const result = await checkSource(`
    let print = (value) => { value + 1 };
    let answer = print(41);
  `);

  expectBinding(result.env, "answer", { type: "Number", vars: 0 });
});

function collectStaticValues(environment: StaticEnv, prefix = ""): string[] {
  return [
    ...[...environment.valEnv.keys()].map((name) => `${prefix}${name}`),
    ...[...environment.strEnv].flatMap(([name, nested]) =>
      collectStaticValues(nested, `${prefix}${name}.`)
    ),
  ];
}

Deno.test("[module update T137/B317] standard-basis construction is deterministic and effect-free", async () => {
  const source = 'let main = () => { print("user") };';
  const first = await compile(source);
  const second = await compile(source);
  assertEquals(second, first);

  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    await import(`data:text/javascript;base64,${btoa(first)}#${crypto.randomUUID()}`);
  } finally {
    console.log = original;
  }
  assertEquals(output, ["user"]);
});

Deno.test("[module update T130] current compiled standard structure interfaces are explicit", async () => {
  const modules = await loadStandardModules();
  assertEquals(
    modules.map((module) => ({
      alias: module.alias,
      values: [...module.result.exportedStructure.valEnv.keys()],
      types: [...module.result.exportedStructure.tyEnv.keys()],
    })),
    [
      {
        alias: "List",
        values: [
          "Nil",
          "Cons",
          "map",
          "length",
          "append",
          "filter",
          "take",
          "drop",
          "at",
          "foldLeft",
          "foldRight",
          "reverse",
          "any",
          "all",
          "collectWith",
        ],
        types: [],
      },
      {
        alias: "Map",
        values: [
          "Less",
          "Equal",
          "Greater",
          "MapEmpty",
          "MapNode",
          "MapValue",
          "numberCompare",
          "height",
          "max",
          "node",
          "rotateLeft",
          "rotateRight",
          "balance",
          "empty",
          "getTree",
          "get",
          "has",
          "setTree",
          "set",
          "singleton",
          "removeSmallest",
          "removeTree",
          "remove",
          "update",
          "foldTree",
          "fold",
          "toListTree",
          "toList",
          "debugHeight",
          "fromListItems",
          "fromList",
        ],
        types: ["Ordering", "MapTree", "Map"],
      },
      {
        alias: "Option",
        values: [
          "None",
          "Some",
          "map",
          "andThen",
          "withDefault",
          "map2",
          "traverse",
          "collectList",
        ],
        types: [],
      },
      {
        alias: "Monad",
        values: ["Carrier", "lift", "liftError"],
        types: ["Carrier"],
      },
      {
        alias: "Result",
        values: [
          "Ok",
          "Err",
          "textOf",
          "succeed",
          "map",
          "andThen",
          "toBool",
          "fn",
          "mapErr",
          "fnError",
          "map2",
          "carrier",
          "withDefault",
          "map3",
          "map4",
          "traverse",
          "all",
          "collectList",
        ],
        types: [],
      },
      {
        alias: "Task",
        values: [
          "fromResult",
          "succeed",
          "fail",
          "map",
          "map2",
          "race",
          "andThen",
          "mapErr",
          "recover",
          "all",
          "fn",
          "fnError",
          "carrier",
          "collectList",
          "traverse",
        ],
        types: [],
      },
      { alias: "Traverse", values: ["with"], types: [] },
    ],
  );
});
