import { assertEquals, assertNotStrictEquals, assertStrictEquals } from "@std/assert";
import { analyzeRecoveredVirtual, analyzeVirtual } from "../src/compiler.ts";
import { inferModulePartial, type InferResult } from "../src/infer.ts";
import {
  dependentInterfaceClosure,
  semanticDefinitionsAt,
  semanticGpuBuiltinCompletionsAt,
  semanticOccurrenceAt,
  semanticOccurrencesAt,
  semanticOccurrencesForTarget,
  semanticRenameAt,
  semanticScopeAt,
  semanticTypedNodeAt,
  semanticTypedNodesAt,
} from "../src/module_interface.ts";
import { moduleId } from "../src/module_id.ts";
import type { ModuleMap } from "../src/module_id.ts";
import { loadModuleGraph, type ModuleGraph } from "../src/module_graph.ts";
import { parse } from "../src/parser.ts";
import { buildPartialProjectSnapshot } from "../src/program_analysis.ts";
import { topLevelPhraseRanges } from "../src/top_level_phrases.ts";

Deno.test("[module update A601-A606] strict analysis produces one owned interface per module", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([
      ["/test/lib.wm", "let value = 1;"],
      [
        "/test/main.wm",
        'from "./lib.wm" import * as Lib; let values = (Lib.value, 2, 3, 4, 5);',
      ],
    ]),
  );
  const project = analysis.projectSnapshot;
  const libId = moduleId("/test/lib.wm");
  const mainId = moduleId("/test/main.wm");
  const lib = project.interfaces.get(libId)!;
  const main = project.interfaces.get(mainId)!;

  assertStrictEquals(project.head, mainId);
  assertStrictEquals(analysis.interfaces, project.interfaces);
  assertStrictEquals(lib.projectSnapshotId, project.id);
  assertStrictEquals(main.projectSnapshotId, project.id);
  assertStrictEquals(lib.generation, project.generation);
  assertStrictEquals(main.generation, project.generation);
  assertEquals(main.dependencies.map((edge) => edge.target), [libId]);
  assertEquals(lib.reverseDependencies, [mainId]);
  assertEquals(main.diagnostics.map((diagnostic) => diagnostic.code), ["style.wide-tuple"]);
  assertEquals(main.completeness, {
    syntax: "complete",
    imports: "complete",
    elaboration: "complete",
    occurrences: "complete",
    scopes: "partial",
    ffi: "not-applicable",
    gpu: "not-applicable",
    recoveryBoundaries: [],
  });
  assertEquals(
    main.occurrences.map((occurrence) => [
      occurrence.name,
      occurrence.role,
      occurrence.target.kind,
      occurrence.span.start,
      occurrence.span.end,
    ]),
    [
      ["./lib.wm", "import-path", "module", 6, 14],
      ["Lib", "import-alias", "structure", 28, 31],
      ["values", "declaration", "value", 37, 43],
      ["Lib", "qualifier", "structure", 47, 50],
      ["value", "reference", "value", 51, 56],
    ],
  );
  const importOccurrence = semanticOccurrenceAt(main, 10)!;
  assertEquals(importOccurrence.role, "import-path");
  assertEquals(importOccurrence.target, { kind: "module", id: libId });
  const valueReference = semanticOccurrenceAt(main, 53)!;
  assertEquals(valueReference.name, "value");
  assertEquals(valueReference.target.kind, "value");
  assertEquals(
    semanticOccurrencesForTarget(project, valueReference.target).map((item) => [
      item.moduleId,
      item.occurrence.name,
      item.occurrence.role,
    ]),
    [
      [libId, "value", "declaration"],
      [mainId, "value", "reference"],
    ],
  );
});

Deno.test("[module update A608] semantic scopes use compiler identities and declaration order", async () => {
  const source = "let outer = 1; let f = (param) => { param }; let after = outer;";
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const main = analysis.interfaces.get(moduleId("/test/main.wm"))!;
  const outerDeclaration = main.occurrences.find((item) =>
    item.name === "outer" && item.role === "declaration" && item.target.kind === "value"
  )!;
  const parameterDeclaration = main.occurrences.find((item) =>
    item.name === "param" && item.role === "declaration" && item.target.kind === "value"
  )!;

  assertEquals(semanticScopeAt(main, source.indexOf("1")).values.has("outer"), false);
  assertStrictEquals(
    semanticScopeAt(main, source.lastIndexOf("outer")).values.get("outer")?.id,
    outerDeclaration.target.id,
  );
  assertStrictEquals(
    semanticScopeAt(main, source.lastIndexOf("param")).values.get("param")?.id,
    parameterDeclaration.target.id,
  );
  assertEquals(
    semanticScopeAt(main, source.lastIndexOf("outer")).values.has("param"),
    false,
  );
  assertEquals(semanticScopeAt(main, 0).values.get("print")?.kind, "value");
  assertEquals(String(semanticScopeAt(main, 0).structures.get("Option")), "basis-structure:Option");
  assertEquals(semanticScopeAt(main, 0).types.has("Number"), true);
});

Deno.test("[module update A608] annotation type variables retain declaration-group regions", async () => {
  const source = "let x: t = 1 and y: t = 2; let z: t = 3;";
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const main = analysis.interfaces.get(moduleId("/test/main.wm"))!;
  const occurrences = main.occurrences.filter((item) => item.target.kind === "type-variable");
  const [first, second, third] = occurrences;

  assertEquals(occurrences.map((item) => [item.name, item.role]), [
    ["t", "reference"],
    ["t", "reference"],
    ["t", "reference"],
  ]);
  assertStrictEquals(first.target.id, second.target.id);
  assertNotStrictEquals(first.target.id, third.target.id);
  assertEquals(main.typeVariables.length, 2);
  assertEquals(main.typeVariables[0].binder, undefined);
  const firstAnnotation = source.indexOf("t =");
  const secondAnnotation = source.indexOf("t =", firstAnnotation + 1);
  assertEquals(main.typeVariables[0].occurrences.map((span) => span.start), [
    firstAnnotation,
    secondAnnotation,
  ]);
  assertStrictEquals(
    semanticScopeAt(main, source.indexOf("1")).typeVariables.get("t"),
    first.target.id,
  );
  assertStrictEquals(
    semanticScopeAt(main, source.lastIndexOf("3")).typeVariables.get("t"),
    third.target.id,
  );
  assertEquals(
    semanticDefinitionsAt(
      analysis.projectSnapshot,
      moduleId("/test/main.wm"),
      first.span.start,
    ),
    [],
  );
});

Deno.test("[module update A608] lambda and explicit type-variable binders are source mapped", async () => {
  const source = "let keep = (x: t, y: t): t => { x }; " +
    "record Box<T> = { value: T }; type Choice<T> = | Pick<T>;";
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const mainId = moduleId("/test/main.wm");
  const main = analysis.interfaces.get(mainId)!;
  const typeVariableOccurrences = main.occurrences.filter((item) =>
    item.target.kind === "type-variable"
  );
  const lambda = typeVariableOccurrences.filter((item) => item.name === "t");
  const explicitBinders = typeVariableOccurrences.filter((item) =>
    item.name === "T" && item.role === "declaration"
  );
  const explicitReferences = typeVariableOccurrences.filter((item) =>
    item.name === "T" && item.role === "reference"
  );

  assertEquals(lambda.length, 3);
  assertEquals(new Set(lambda.map((item) => item.target.id)).size, 1);
  assertStrictEquals(
    semanticScopeAt(main, source.indexOf("{ x }")).typeVariables.get("t"),
    lambda[0].target.id,
  );
  assertEquals(semanticScopeAt(main, source.indexOf("keep")).typeVariables.has("t"), false);

  assertEquals(explicitBinders.map((item) => item.span.start), [
    source.indexOf("T"),
    source.indexOf("T", source.indexOf("type Choice")),
  ]);
  assertEquals(explicitReferences.length, 2);
  assertStrictEquals(explicitBinders[0].target.id, explicitReferences[0].target.id);
  assertStrictEquals(explicitBinders[1].target.id, explicitReferences[1].target.id);
  assertNotStrictEquals(explicitBinders[0].target.id, explicitBinders[1].target.id);
  assertEquals(
    semanticDefinitionsAt(
      analysis.projectSnapshot,
      mainId,
      explicitReferences[0].span.start,
    ).map((definition) => definition.span.start),
    [explicitBinders[0].span.start],
  );
});

Deno.test("[module update A608] semantic scopes preserve simultaneous imported type and constructor identities", async () => {
  const source = 'from "./lib.wm" import { Choice as pick }; let value: pick = pick;';
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([
      ["/test/lib.wm", "type Choice = | Choice;"],
      ["/test/main.wm", source],
    ]),
  );
  const main = analysis.interfaces.get(moduleId("/test/main.wm"))!;
  const imported = main.imports[0].targets[0];
  const scope = semanticScopeAt(main, source.lastIndexOf("pick"));

  assertStrictEquals(scope.types.get("pick"), imported.type);
  assertEquals(scope.values.get("pick")?.kind, "constructor");
  assertStrictEquals(scope.values.get("pick")?.id, imported.constructor);
  assertEquals(semanticScopeAt(main, source.indexOf("./lib.wm")).types.has("pick"), false);
});

Deno.test("[module update A607] the same paths in separate analyses have separate project ownership", async () => {
  const source = new Map([
    ["/test/lib.wm", "let value = 1;"],
    ["/test/main.wm", 'from "./lib.wm" import { value }; let main = () => { print(value) };'],
  ]);
  const first = await analyzeVirtual("/test/main.wm", source);
  const second = await analyzeVirtual("/test/main.wm", source);
  const mainId = moduleId("/test/main.wm");

  assertNotStrictEquals(first.projectSnapshot.id, second.projectSnapshot.id);
  assertNotStrictEquals(first.projectSnapshot.generation, second.projectSnapshot.generation);
  assertStrictEquals(
    first.interfaces.get(mainId)?.projectSnapshotId,
    first.projectSnapshot.id,
  );
  assertStrictEquals(
    second.interfaces.get(mainId)?.projectSnapshotId,
    second.projectSnapshot.id,
  );
});

Deno.test("[module update A608] occurrence records preserve type, constructor, and value identities", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([[
      "/test/main.wm",
      "type Maybe<T> = | None | Some<T>; " +
      "let value = Some(1); " +
      "let read = match(value) { Some(Var(x)) => { x }, None => { 0 } };",
    ]]),
  );
  const occurrences = analysis.interfaces.get(moduleId("/test/main.wm"))!.occurrences;
  const some = occurrences.filter((item) =>
    item.name === "Some" && item.target.kind === "constructor"
  );
  const value = occurrences.filter((item) => item.name === "value" && item.target.kind === "value");
  const x = occurrences.filter((item) => item.name === "x" && item.target.kind === "value");

  assertEquals(some.map((item) => item.role), ["declaration", "reference", "reference"]);
  assertStrictEquals(some[0].target.id, some[1].target.id);
  assertStrictEquals(some[0].target.id, some[2].target.id);
  assertEquals(value.map((item) => item.role), ["declaration", "reference"]);
  assertStrictEquals(value[0].target.id, value[1].target.id);
  assertEquals(x.map((item) => item.role), ["declaration", "reference"]);
  assertStrictEquals(x[0].target.id, x[1].target.id);
  assertEquals(
    occurrences.filter((item) => item.target.kind === "type").map((item) => [
      item.name,
      item.role,
    ]),
    [["Maybe", "declaration"]],
  );
});

Deno.test("[module update A608] type uses come from elaborator-resolved type identities", async () => {
  const source =
    'from "./lib.wm" import * as Lib; type Local = Lib.Box; let wrap: Local = Lib.Box(1);';
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([
      ["/test/lib.wm", "type Box = | Box<Number>;"],
      ["/test/main.wm", source],
    ]),
  );
  const project = analysis.projectSnapshot;
  const main = project.interfaces.get(moduleId("/test/main.wm"))!;
  const lib = project.interfaces.get(moduleId("/test/lib.wm"))!;
  const local = main.occurrences.find((item) =>
    item.name === "Local" && item.role === "declaration" && item.target.kind === "type"
  )!;
  const localUse = main.occurrences.find((item) =>
    item.name === "Local" && item.role === "reference" && item.target.kind === "type"
  )!;
  const boxDeclaration = lib.occurrences.find((item) =>
    item.name === "Box" && item.role === "declaration" && item.target.kind === "type"
  )!;
  const boxTypeUse = main.occurrences.find((item) =>
    item.span.start === source.indexOf("Lib.Box") + "Lib.".length &&
    item.target.kind === "type"
  )!;
  const structureAlias = main.occurrences.find((item) =>
    item.name === "Lib" && item.role === "import-alias" && item.target.kind === "structure"
  )!;
  const typeQualifier = semanticOccurrenceAt(main, source.indexOf("Lib.Box") + 1)!;

  assertStrictEquals(local.target.id, localUse.target.id);
  assertStrictEquals(boxDeclaration.target.id, boxTypeUse.target.id);
  assertEquals(boxTypeUse.name, "Box");
  assertEquals(boxTypeUse.role, "reference");
  assertEquals(typeQualifier.role, "qualifier");
  assertEquals(typeQualifier.target.kind, "structure");
  assertStrictEquals(typeQualifier.target.id, structureAlias.target.id);
  assertEquals(
    semanticDefinitionsAt(
      project,
      moduleId("/test/main.wm"),
      source.indexOf("Lib.Box") + 1,
    ).map((definition) => [definition.moduleId, definition.path]),
    [[moduleId("/test/lib.wm"), "/test/lib.wm"]],
  );
});

Deno.test("[module update A604/A608] qualified type uses preserve repeated alias identities", async () => {
  const source = 'from "./lib.wm" import * as A; from "./lib.wm" import * as B; ' +
    "type Pair = (A.Box, B.Box);";
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([
      ["/test/lib.wm", "record Box = { value: Number };"],
      ["/test/main.wm", source],
    ]),
  );
  const main = analysis.interfaces.get(moduleId("/test/main.wm"))!;
  const aliases = main.occurrences.filter((item) =>
    item.role === "import-alias" && item.target.kind === "structure"
  );
  const firstUse = semanticOccurrenceAt(main, source.indexOf("A.Box"))!;
  const secondUse = semanticOccurrenceAt(main, source.indexOf("B.Box"))!;

  assertEquals(aliases.map((item) => item.name), ["A", "B"]);
  assertEquals(firstUse.target.kind, "structure");
  assertEquals(secondUse.target.kind, "structure");
  assertStrictEquals(firstUse.target.id, aliases[0].target.id);
  assertStrictEquals(secondUse.target.id, aliases[1].target.id);
  assertNotStrictEquals(firstUse.target.id, secondUse.target.id);
});

Deno.test("[module update A604] qualified constructor patterns retain structure identity", async () => {
  const source = 'from "./lib.wm" import * as Lib; let value = Lib.Box; ' +
    "let read = match(value) { Lib.Box => { 1 } };";
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([
      ["/test/lib.wm", "type Choice = | Box;"],
      ["/test/main.wm", source],
    ]),
  );
  const main = analysis.interfaces.get(moduleId("/test/main.wm"))!;
  const structures = main.occurrences.filter((item) =>
    item.name === "Lib" && item.target.kind === "structure"
  );

  assertEquals(structures.map((item) => item.role), [
    "import-alias",
    "qualifier",
    "qualifier",
  ]);
  assertStrictEquals(structures[0].target.id, structures[1].target.id);
  assertStrictEquals(structures[0].target.id, structures[2].target.id);
});

Deno.test("[module update A603/A608] named import source and alias retain every namespace target", async () => {
  const mainSource =
    'from "./lib.wm" import { Box as localBox }; let value: localBox = localBox(1);';
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([
      ["/test/lib.wm", "type Box = | Box<Number>;"],
      ["/test/main.wm", mainSource],
    ]),
  );
  const main = analysis.interfaces.get(moduleId("/test/main.wm"))!;
  const importOffset = mainSource.indexOf("Box");
  const imported = semanticOccurrencesAt(main, importOffset);

  assertEquals(
    imported.map((item) => [item.name, item.role, item.target.kind]),
    [
      ["Box", "import-source", "type"],
      ["Box", "import-source", "constructor"],
    ],
  );
  const aliasOffset = mainSource.indexOf("localBox");
  assertEquals(
    semanticOccurrencesAt(main, aliasOffset).map((item) => [
      item.name,
      item.role,
      item.target.kind,
    ]),
    [
      ["localBox", "import-alias", "type"],
      ["localBox", "import-alias", "constructor"],
    ],
  );
  const constructor = imported.find((item) => item.target.kind === "constructor")!;
  const constructorAlias = semanticOccurrencesAt(main, aliasOffset).find((item) =>
    item.target.kind === "constructor"
  )!;
  assertEquals(main.semanticTypes[constructor.inferredType!.id].rendered, "(Number) => Box");
  assertEquals(constructor.inferredType?.generalized, true);
  assertStrictEquals(constructor.inferredType?.id, constructorAlias.inferredType?.id);
  assertEquals(
    semanticOccurrencesForTarget(analysis.projectSnapshot, constructor.target).map((item) => [
      item.moduleId,
      item.occurrence.role,
    ]),
    [
      [moduleId("/test/lib.wm"), "declaration"],
      [moduleId("/test/main.wm"), "import-source"],
      [moduleId("/test/main.wm"), "import-alias"],
      [moduleId("/test/main.wm"), "reference"],
    ],
  );
});

Deno.test("[module update A608] named value imports retain declaration and use-site types", async () => {
  const source = 'from "./lib.wm" import { identity as apply }; let number = apply(1);';
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([
      ["/test/lib.wm", "let identity = (value) => { value };"],
      ["/test/main.wm", source],
    ]),
  );
  const main = analysis.interfaces.get(moduleId("/test/main.wm"))!;
  const sourceOccurrence = semanticOccurrenceAt(main, source.indexOf("identity"))!;
  const aliasOccurrence = semanticOccurrenceAt(main, source.indexOf("apply"))!;
  const useOccurrence = semanticOccurrenceAt(main, source.lastIndexOf("apply"))!;

  assertEquals(
    [sourceOccurrence, aliasOccurrence, useOccurrence].map((occurrence) => ({
      role: occurrence.role,
      type: main.semanticTypes[occurrence.inferredType!.id].rendered,
      generalized: occurrence.inferredType?.generalized,
      variables: occurrence.inferredType?.quantifiedVariables,
    })),
    [
      {
        role: "import-source",
        type: "('a) => 'a",
        generalized: true,
        variables: 1,
      },
      {
        role: "import-alias",
        type: "('a) => 'a",
        generalized: true,
        variables: 1,
      },
      {
        role: "reference",
        type: "(Number) => Number",
        generalized: false,
        variables: 0,
      },
    ],
  );
});

Deno.test("[module update A608] nominal record field identities cross module boundaries", async () => {
  const mainSource = 'from "./point.wm" import * as Geometry; ' +
    "let point: Geometry.Point = .{ x = 1, y = 2 }; " +
    "let read = (value: Geometry.Point) => { " +
    "let .{ x = saved, y = _ } = value; value.x + saved };";
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([
      ["/test/point.wm", "record Point = { x: Number, y: Number };"],
      ["/test/main.wm", mainSource],
    ]),
  );
  const pointId = moduleId("/test/point.wm");
  const mainId = moduleId("/test/main.wm");
  const point = analysis.interfaces.get(pointId)!;
  const main = analysis.interfaces.get(mainId)!;
  const declaredX = point.occurrences.find((item) =>
    item.name === "x" && item.role === "declaration" && item.target.kind === "field"
  )!;
  const referencedX = main.occurrences.filter((item) =>
    item.name === "x" && item.role === "reference" && item.target.kind === "field"
  );

  assertEquals(referencedX.length, 3);
  referencedX.forEach((occurrence) =>
    assertStrictEquals(occurrence.target.id, declaredX.target.id)
  );
  assertEquals(
    referencedX.map((occurrence) => mainSource.slice(occurrence.span.start, occurrence.span.end)),
    ["x", "x", "x"],
  );
  assertEquals(
    semanticOccurrencesForTarget(analysis.projectSnapshot, declaredX.target).map((item) => [
      item.moduleId,
      item.occurrence.role,
    ]),
    [
      [pointId, "declaration"],
      [mainId, "reference"],
      [mainId, "reference"],
      [mainId, "reference"],
    ],
  );
});

Deno.test("[module update A608] ambiguous projections select the first nominal field with a warning", async () => {
  const source = "record Point = { x: Number }; " +
    "record Offset = { x: Number }; " +
    "let getX = (value) => { value.x };";
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const main = analysis.interfaces.get(moduleId("/test/main.wm"))!;
  const projectionOffset = source.indexOf("value.x") + "value.".length;
  const projected = semanticOccurrencesAt(main, projectionOffset).filter((item) =>
    item.target.kind === "field"
  );
  const declarations = main.occurrences.filter((item) =>
    item.name === "x" && item.role === "declaration" && item.target.kind === "field"
  );

  assertEquals(projected.length, 1);
  assertStrictEquals(projected[0].target.id, declarations[0].target.id);
  assertStrictEquals(semanticOccurrenceAt(main, projectionOffset), projected[0]);
  assertEquals(main.diagnostics.map((diagnostic) => diagnostic.code), [
    "record.ambiguous-projection",
  ]);
  assertEquals(
    semanticRenameAt(analysis.projectSnapshot, moduleId("/test/main.wm"), projectionOffset),
    undefined,
  );
});

Deno.test("[module update A608] occurrences reference immutable semantic type snapshots", async () => {
  const source = "let identity = (value) => { value }; let number = identity(1);";
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const main = analysis.interfaces.get(moduleId("/test/main.wm"))!;
  const identities = main.occurrences.filter((item) =>
    item.name === "identity" && item.target.kind === "value"
  );
  const declarationType = main.semanticTypes[identities[0].inferredType!.id];
  const referenceType = main.semanticTypes[identities[1].inferredType!.id];

  assertEquals(identities.map((item) => item.role), ["declaration", "reference"]);
  assertEquals(identities[0].inferredType, {
    id: declarationType.id,
    generalized: true,
    quantifiedVariables: 1,
  });
  assertEquals(declarationType.rendered, "('a) => 'a");
  assertEquals(declarationType.shape.kind, "function");
  assertEquals(identities[1].inferredType, {
    id: referenceType.id,
    generalized: false,
    quantifiedVariables: 0,
  });
  assertEquals(referenceType.rendered, "(Number) => Number");
  assertEquals(Object.isFrozen(main.semanticTypes), true);
  assertEquals(Object.isFrozen(declarationType.shape), true);
});

Deno.test("[module update A608] typed-node queries cover expressions, patterns, and annotations", async () => {
  const source = 'let id = (x: t): t => { x }; let pair: (Number, String) = (1, "s"); ' +
    "let used = id(1);";
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const main = analysis.interfaces.get(moduleId("/test/main.wm"))!;
  const id = semanticTypedNodeAt(main, source.indexOf("id"))!;
  const annotation = semanticTypedNodesAt(main, source.indexOf("Number"));
  const number = semanticTypedNodeAt(main, source.indexOf("1"))!;
  const string = semanticTypedNodeAt(main, source.indexOf('"s"'))!;
  const idUse = semanticTypedNodeAt(main, source.lastIndexOf("id"))!;

  assertEquals(
    {
      kind: id.kind,
      rendered: main.semanticTypes[id.type.id].rendered,
      generalized: id.type.generalized,
      quantifiedVariables: id.type.quantifiedVariables,
    },
    {
      kind: "pattern",
      rendered: "(t) => t",
      generalized: true,
      quantifiedVariables: 1,
    },
  );
  assertEquals(
    annotation.map((node) => [
      node.kind,
      source.slice(node.span.start, node.span.end),
      main.semanticTypes[node.type.id].rendered,
    ]),
    [
      ["type-expression", "Number", "Number"],
      ["type-expression", "(Number, String)", "(Number, String)"],
    ],
  );
  assertEquals(main.semanticTypes[number.type.id].rendered, "Number");
  assertEquals(main.semanticTypes[string.type.id].rendered, "String");
  assertEquals(id.label, "id");
  assertEquals(idUse.label, "id");
  assertEquals(main.semanticTypes[idUse.type.id].rendered, "(Number) => Number");
  assertEquals(main.semanticTypes[idUse.generalType!.id].rendered, "(t) => t");
  assertEquals(Object.isFrozen(main.typedNodes), true);
  assertEquals(Object.isFrozen(number), true);
});

Deno.test("[module update A608] typed annotations retain shadowed nominal identities", async () => {
  const source = "type Choice = | First; let before: Choice = First; " +
    "type Choice = | Second; let after: Choice = Second;";
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const main = analysis.interfaces.get(moduleId("/test/main.wm"))!;
  const firstOffset = source.indexOf("Choice", source.indexOf("before"));
  const secondOffset = source.indexOf("Choice", source.indexOf("after"));
  const first = semanticTypedNodeAt(main, firstOffset)!;
  const second = semanticTypedNodeAt(main, secondOffset)!;
  const firstShape = main.semanticTypes[first.type.id].shape;
  const secondShape = main.semanticTypes[second.type.id].shape;

  assertEquals(first.kind, "type-expression");
  assertEquals(second.kind, "type-expression");
  assertEquals(firstShape.kind, "named");
  assertEquals(secondShape.kind, "named");
  if (firstShape.kind !== "named" || secondShape.kind !== "named") {
    throw new Error("expected nominal semantic types");
  }
  assertNotStrictEquals(firstShape.typeNameId, secondShape.typeNameId);
});

Deno.test("[module update G21] carrier operations expose immutable compiler semantic types", async () => {
  const source = "let sum = Ok(2) + 3; let both = Ok(4) * Ok(5);";
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const main = analysis.interfaces.get(moduleId("/test/main.wm"))!;

  assertEquals(main.carrierOperations.length, 2);
  assertEquals(
    main.carrierOperations.map((operation) => ({
      source: source.slice(operation.span.start, operation.span.end),
      carrier: operation.carrier,
      operands: operation.operands,
      error: main.semanticTypes[operation.errorType].rendered,
      payload: main.semanticTypes[operation.payloadResultType].rendered,
    })),
    [
      {
        source: "Ok(2) + 3",
        carrier: "Result",
        operands: ["wrapped", "pure"],
        error: "'a",
        payload: "Number",
      },
      {
        source: "Ok(4) * Ok(5)",
        carrier: "Result",
        operands: ["wrapped", "wrapped"],
        error: "'b",
        payload: "Number",
      },
    ],
  );
  assertEquals(Object.isFrozen(main.carrierOperations), true);
  assertEquals(Object.isFrozen(main.carrierOperations[0]), true);
});

Deno.test("[module update G21] GPU operations and fragment selections cross the interface", async () => {
  const source = "let shade = (coord) => { @gpu; let wave = sin(coord); " +
    "Gpu.color((wave.x, wave.y, 0.0, 1.0)) }; " +
    "let fragment = Gpu.fragment(shade);";
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const main = analysis.interfaces.get(moduleId("/test/main.wm"))!;

  assertEquals(main.completeness.gpu, "complete");
  assertEquals(
    main.gpuFacts.operations.map((operation) => ({
      identity: operation.identity,
      source: source.slice(operation.span.start, operation.span.end),
      args: operation.args.map((id) => main.semanticTypes[id].rendered),
      result: main.semanticTypes[operation.result].rendered,
    })),
    [
      { identity: "sin", source: "sin(coord)", args: ["'a"], result: "'a" },
      { identity: "gpu.projection.x", source: "wave.x", args: ["'a"], result: "Number" },
      { identity: "gpu.projection.y", source: "wave.y", args: ["'a"], result: "Number" },
    ],
  );
  assertEquals(main.gpuFacts.builtins.map((builtin) => builtin.name), ["sin"]);
  assertEquals(
    main.gpuFacts.resources.map((resource) => main.semanticTypes[resource.receiverType].rendered),
    [],
  );
  assertEquals(
    main.gpuFacts.roots.map((root) => ({
      source: source.slice(root.span.start, root.span.end),
      selectorIds: root.selectorIds.map(Number),
      bound: root.bindingId !== undefined,
    })),
    [{
      source: "(coord) => { @gpu; let wave = sin(coord); Gpu.color((wave.x, wave.y, 0.0, 1.0)) }",
      selectorIds: [0],
      bound: true,
    }],
  );
  assertEquals(
    main.gpuFacts.selectors.map((selector) => ({
      source: source.slice(selector.span.start, selector.span.end),
      argument: source.slice(selector.argument.start, selector.argument.end),
      rootId: Number(selector.rootId),
    })),
    [{
      source: "Gpu.fragment(shade)",
      argument: "shade",
      rootId: 0,
    }],
  );
  assertEquals(main.gpuFacts.slices.length, 1);
  assertEquals(Number(main.gpuFacts.slices[0].rootId), 0);
  assertEquals(main.gpuFacts.slices[0].selectorIds.map(Number), [0]);
  assertEquals(main.gpuFacts.slices[0].input.sourcePath, "/test/main.wm");
  assertEquals(main.gpuFacts.slices[0].input.functions.length > 0, true);
  assertEquals(Object.isFrozen(main.gpuFacts), true);
  assertEquals(Object.isFrozen(main.gpuFacts.operations[0].rows), true);
  assertEquals(Object.isFrozen(main.gpuFacts.slices), true);
  assertEquals(Object.isFrozen(main.gpuFacts.slices[0].input), true);
  assertEquals(Object.isFrozen(main.gpuFacts.slices[0].input.functions), true);
  assertNotStrictEquals(main.gpuFacts.slices[0].input, analysis.gpuSlices[0].input);
});

Deno.test("[module update B318/A608] basis and compiled-standard values have stable identities", async () => {
  const source = "let output = print; let transform = Option.map;";
  const first = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const second = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const occurrences = first.interfaces.get(moduleId("/test/main.wm"))!.occurrences;
  const repeated = second.interfaces.get(moduleId("/test/main.wm"))!.occurrences;
  const print = occurrences.find((item) => item.name === "print" && item.target.kind === "value")!;
  const map = occurrences.find((item) => item.name === "map" && item.target.kind === "value")!;
  const option = occurrences.find((item) =>
    item.name === "Option" && item.target.kind === "structure"
  )!;

  assertEquals(String(print.target.id), "basis-value:print");
  assertEquals(String(map.target.id), "standard-value:std/option.wm:map");
  assertEquals(String(option.target.id), "basis-structure:Option");
  assertEquals(
    repeated.find((item) => item.name === "print" && item.target.kind === "value")?.target.id,
    print.target.id,
  );
  assertEquals(
    repeated.find((item) => item.name === "map" && item.target.kind === "value")?.target.id,
    map.target.id,
  );
  assertEquals(print.inferredType?.generalized, false);
  assertEquals(map.inferredType?.generalized, false);
});

Deno.test("[module update A605-A606] conservative invalidation follows reverse interfaces", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([
      ["/test/base.wm", "let value = 1;"],
      ["/test/mid.wm", 'from "./base.wm" import { value }; let middle = value;'],
      ["/test/main.wm", 'from "./mid.wm" import { middle }; let main = () => { print(middle) };'],
    ]),
  );
  const base = moduleId("/test/base.wm");
  const mid = moduleId("/test/mid.wm");
  const main = moduleId("/test/main.wm");

  assertEquals(
    dependentInterfaceClosure(analysis.interfaces, [base]),
    new Set([base, mid, main]),
  );
  assertEquals(
    dependentInterfaceClosure(analysis.interfaces, [mid]),
    new Set([mid, main]),
  );
});

Deno.test("[module update A610] partial interfaces expose only the certified declaration prefix", async () => {
  const mainSource = 'from "./first.wm" import { first }; let good = first; ' +
    "let bad: String = 1; " +
    'from "./later.wm" import { later }; let unreachable = later;';
  const graph = await loadModuleGraph("/test/main.wm", {
    virtualFs: new Map([
      ["/test/first.wm", "let first = 1;"],
      ["/test/later.wm", "let later = 2;"],
      ["/test/main.wm", mainSource],
    ]),
  });
  const results = inferGraphPartial(graph);
  const mainResult = results.get(moduleId("/test/main.wm"))!;
  const mainModule = graph.nodes.get(moduleId("/test/main.wm"))!.module;
  const failed = mainModule.decls[2];

  assertEquals(mainResult.elaboration.complete, false);
  assertEquals(mainResult.elaboration.declarationPrefix, 2);
  assertEquals(mainResult.elaboration.failure, "declaration");
  assertEquals(mainResult.elaboration.recoveryBoundaries, [{
    start: failed.node!.span.start,
    end: failed.node!.span.end,
  }]);

  const snapshot = buildPartialProjectSnapshot(graph, results);
  const main = snapshot.interfaces.get(moduleId("/test/main.wm"))!;
  assertEquals(snapshot.interfaces.has(moduleId("/test/first.wm")), true);
  assertEquals(snapshot.interfaces.has(moduleId("/test/later.wm")), false);
  assertEquals(main.dependencies.map((edge) => edge.target), [moduleId("/test/first.wm")]);
  assertEquals(main.imports.length, 1);
  assertEquals(main.completeness.elaboration, "partial");
  assertEquals(main.completeness.imports, "complete");
  assertEquals(main.completeness.ffi, "partial");
  assertEquals(main.completeness.gpu, "partial");
  assertEquals(main.completeness.recoveryBoundaries, mainResult.elaboration.recoveryBoundaries);
  assertEquals(main.diagnostics.some((diagnostic) => diagnostic.severity === "error"), true);
  assertEquals(main.occurrences.some((occurrence) => occurrence.name === "good"), true);
  assertEquals(main.occurrences.some((occurrence) => occurrence.name === "bad"), false);
  assertEquals(main.occurrences.some((occurrence) => occurrence.name === "later"), false);
  const scopeAfterFailure = semanticScopeAt(main, mainSource.lastIndexOf("later"));
  assertEquals(scopeAfterFailure.values.has("good"), true);
  assertEquals(scopeAfterFailure.values.has("bad"), false);
  assertEquals(scopeAfterFailure.values.has("later"), false);
});

Deno.test("[module update A610] a failed nominal declaration contributes no semantic facts", async () => {
  const source = "type Good = | Good; type Broken = | Broken<Missing>; let unreachable = Good;";
  const graph = await loadModuleGraph("/test/main.wm", {
    virtualFs: new Map([["/test/main.wm", source]]),
  });
  const results = inferGraphPartial(graph);
  const result = results.get(moduleId("/test/main.wm"))!;
  const snapshot = buildPartialProjectSnapshot(graph, results);
  const main = snapshot.interfaces.get(moduleId("/test/main.wm"))!;

  assertEquals(result.elaboration.declarationPrefix, 1);
  assertEquals(result.typeEnv.has("Good"), true);
  assertEquals(result.typeEnv.has("Broken"), false);
  assertEquals(
    main.occurrences.filter((occurrence) => occurrence.target.kind === "type").map((item) =>
      item.name
    ),
    ["Good"],
  );
  assertEquals(main.occurrences.some((occurrence) => occurrence.name === "unreachable"), false);
});

Deno.test("[module update A610] failed declarations contribute no type-variable regions", async () => {
  const source = "let good: t = 1; let bad: String = 1; let unreachable: u = 2;";
  const graph = await loadModuleGraph("/test/main.wm", {
    virtualFs: new Map([["/test/main.wm", source]]),
  });
  const results = inferGraphPartial(graph);
  const snapshot = buildPartialProjectSnapshot(graph, results);
  const main = snapshot.interfaces.get(moduleId("/test/main.wm"))!;

  assertEquals(main.typeVariables.map((variable) => variable.name), ["t"]);
  assertEquals(
    main.occurrences
      .filter((occurrence) => occurrence.target.kind === "type-variable")
      .map((occurrence) => occurrence.name),
    ["t"],
  );
  assertEquals(
    semanticScopeAt(main, source.lastIndexOf("u")).typeVariables.has("u"),
    false,
  );
  const goodValue = semanticTypedNodeAt(main, source.indexOf("1"))!;
  assertEquals(main.semanticTypes[goodValue.type.id].rendered, "Number");
  assertEquals(semanticTypedNodeAt(main, source.indexOf("String")), undefined);
  assertEquals(semanticTypedNodeAt(main, source.lastIndexOf("u")), undefined);
});

Deno.test("[module update A610] uncertified JS imports contribute no FFI facts", async () => {
  const source = "let good = 1; let bad: String = 1; " +
    'from js.global("Math") import unsafe { max: (Number, Number) => Number };';
  const graph = await loadModuleGraph("/test/main.wm", {
    virtualFs: new Map([["/test/main.wm", source]]),
  });
  const results = inferGraphPartial(graph);
  const snapshot = buildPartialProjectSnapshot(graph, results);
  const main = snapshot.interfaces.get(moduleId("/test/main.wm"))!;

  assertEquals(main.completeness.ffi, "partial");
  assertEquals(main.ffiFacts.imports, []);
  assertEquals(main.occurrences.some((occurrence) => occurrence.name === "max"), false);
});

Deno.test("[module update A610] an uncertified import reports partial import completeness", async () => {
  const graph = await loadModuleGraph("/test/main.wm", {
    virtualFs: new Map([
      ["/test/lib.wm", "let value = 1;"],
      ["/test/main.wm", 'from "./lib.wm" import { value }; let read = value;'],
    ]),
  });
  const libId = moduleId("/test/lib.wm");
  const mainId = moduleId("/test/main.wm");
  const results: ModuleMap<InferResult> = new Map();
  results.set(libId, inferModulePartial(graph.nodes.get(libId)!.module));
  results.set(mainId, inferModulePartial(graph.nodes.get(mainId)!.module, new Map()));

  const result = results.get(mainId)!;
  const snapshot = buildPartialProjectSnapshot(graph, results);
  const main = snapshot.interfaces.get(mainId)!;
  assertEquals(result.elaboration.failure, "import");
  assertEquals(result.elaboration.declarationPrefix, 0);
  assertEquals(main.completeness.imports, "partial");
  assertEquals(main.dependencies, []);
  assertEquals(main.imports, []);
  assertEquals(snapshot.interfaces.has(libId), false);
});

Deno.test("[module update A611] recovered syntax retains later independent phrase semantics", async () => {
  const source = "let first = 1; let broken = ; let after = first + 2;";
  const snapshot = await analyzeRecoveredVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const main = snapshot.interfaces.get(moduleId("/test/main.wm"))!;
  const brokenRange = topLevelPhraseRanges(source)[1];

  assertEquals(main.completeness.syntax, "recovered");
  assertEquals(main.completeness.elaboration, "complete");
  assertEquals(main.completeness.recoveryBoundaries, [brokenRange]);
  assertEquals(main.diagnostics.map((diagnostic) => diagnostic.code), [
    "parse.recovered-phrase",
  ]);
  assertEquals(
    main.occurrences.filter((item) => item.role === "declaration").map((item) => item.name),
    ["first", "after"],
  );
  const afterScope = semanticScopeAt(main, source.lastIndexOf("first"));
  assertEquals(afterScope.values.has("first"), true);
  assertEquals(afterScope.values.has("broken"), false);
});

Deno.test("[module update A608/G21b] recovered interfaces own incomplete GPU completion scopes", async () => {
  const source = `
    let failed = missing;
    let shade = (coord) => {
      @gpu;
      let sin = (value) => { value };
      let hidden = si;
      let visible = smo;
      (coord.x, coord.y, 0.0, 1.0)
    };
  `;
  const snapshot = await analyzeRecoveredVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const main = snapshot.interfaces.get(moduleId("/test/main.wm"))!;
  const hiddenOffset = source.indexOf("let hidden = si") + "let hidden = si".length;
  const visibleOffset = source.indexOf("let visible = smo") + "let visible = smo".length;

  assertEquals(main.occurrences.some((item) => item.name === "shade"), false);
  assertEquals(
    semanticGpuBuiltinCompletionsAt(main, hiddenOffset, "si").some(({ name }) => name === "sin"),
    false,
  );
  assertEquals(
    semanticGpuBuiltinCompletionsAt(main, visibleOffset, "smo").map(({ name }) => name),
    ["smoothstep"],
  );
  assertEquals(Object.isFrozen(main.completionFacts), true);
  assertEquals(Object.isFrozen(main.completionFacts.gpuRegions), true);
  assertEquals(Object.isFrozen(main.completionFacts.scopes.checkpoints), true);
});

Deno.test("[module update A611] failed semantic phrases do not block independent later phrases", async () => {
  const source = 'let first = 1; let bad = first + "two"; let after = first + 2;';
  const snapshot = await analyzeRecoveredVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const main = snapshot.interfaces.get(moduleId("/test/main.wm"))!;
  const badRange = declarationTextRange(source, "let bad");

  assertEquals(main.completeness.syntax, "complete");
  assertEquals(main.completeness.elaboration, "partial");
  assertEquals(main.completeness.recoveryBoundaries, [badRange]);
  assertEquals(
    main.occurrences.filter((item) => item.role === "declaration").map((item) => item.name),
    ["first", "after"],
  );
  assertEquals(main.publicEnvironment.valEnv.has("bad"), false);
  assertEquals(main.publicEnvironment.valEnv.has("after"), true);
  assertEquals(semanticTypedNodeAt(main, source.indexOf('"two"')), undefined);
  const recoveredValue = semanticTypedNodeAt(main, source.lastIndexOf("2"))!;
  assertEquals(main.semanticTypes[recoveredValue.type.id].rendered, "Number");
});

Deno.test("[module update A611] dependent and unresolved-import phrases recover independently", async () => {
  const source = 'let first = 1; let bad = first + "two"; let dependent = bad + 1; ' +
    'from "./missing.wm" import { value }; let after = first + 2;';
  const snapshot = await analyzeRecoveredVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const main = snapshot.interfaces.get(moduleId("/test/main.wm"))!;
  const badRange = declarationTextRange(source, "let bad");
  const dependentRange = declarationTextRange(source, "let dependent");
  const importRange = declarationTextRange(source, "from");

  assertEquals(main.completeness.syntax, "complete");
  assertEquals(main.completeness.imports, "partial");
  assertEquals(main.completeness.elaboration, "partial");
  assertEquals(main.completeness.recoveryBoundaries, [
    importRange,
    badRange,
    dependentRange,
  ]);
  assertEquals(main.dependencies, []);
  assertEquals(
    main.occurrences.filter((item) => item.role === "declaration").map((item) => item.name),
    ["first", "after"],
  );
  assertEquals(
    main.diagnostics.filter((item) => item.severity === "error").length,
    3,
  );
});

Deno.test("[module update A611] a recovered phrase before an import retains the later dependency", async () => {
  const source = 'let broken = ; from "./lib.wm" import { value }; let after = value;';
  const snapshot = await analyzeRecoveredVirtual(
    "/test/main.wm",
    new Map([
      ["/test/lib.wm", "let value = 1;"],
      ["/test/main.wm", source],
    ]),
  );
  const libId = moduleId("/test/lib.wm");
  const main = snapshot.interfaces.get(moduleId("/test/main.wm"))!;

  assertEquals(snapshot.interfaces.has(libId), true);
  assertEquals(main.dependencies.map((edge) => edge.target), [libId]);
  assertEquals(main.completeness.syntax, "recovered");
  assertEquals(main.publicEnvironment.valEnv.has("after"), true);
  assertEquals(
    main.occurrences.filter((item) => item.role === "declaration").map((item) => item.name),
    ["after"],
  );
});

Deno.test("[module update A602] interfaces retain the exact initial-basis analysis input", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([
      ["/test/kernel.wm", "-- @no-prelude\nlet value = 1;"],
      [
        "/test/main.wm",
        'from "./kernel.wm" import { value }; let main = () => { print(value) };',
      ],
    ]),
  );
  const kernelId = moduleId("/test/kernel.wm");
  const mainId = moduleId("/test/main.wm");
  const kernelResult = analysis.results.get(kernelId)!;
  const mainResult = analysis.results.get(mainId)!;
  const kernel = analysis.interfaces.get(kernelId)!;
  const main = analysis.interfaces.get(mainId)!;

  assertEquals(kernel.basis.profile, "kernel");
  assertEquals(main.basis.profile, "default");
  assertStrictEquals(kernel.basis.generation, kernelResult.basis.generation);
  assertStrictEquals(main.basis.generation, mainResult.basis.generation);
  assertStrictEquals(
    analysis.projectSnapshot.basisGenerations.get("kernel"),
    kernelResult.basis.generation,
  );
  assertStrictEquals(
    analysis.projectSnapshot.basisGenerations.get("default"),
    mainResult.basis.generation,
  );
  assertNotStrictEquals(kernel.basis.generation, main.basis.generation);
});

Deno.test("[module update A601/A608] public origins and definitions carry compiler source mappings", async () => {
  const libSource = "let value = 1; let apply = (privateArg) => { privateArg };";
  const mainSource = 'from "./lib.wm" import { value as item }; let read = item;';
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([
      ["/test/lib.wm", libSource],
      ["/test/main.wm", mainSource],
    ]),
  );
  const libId = moduleId("/test/lib.wm");
  const mainId = moduleId("/test/main.wm");
  const lib = analysis.interfaces.get(libId)!;
  const main = analysis.interfaces.get(mainId)!;
  const valueOrigin = lib.origins.get("value")![0];
  const privateArg = lib.occurrences.find((item) =>
    item.name === "privateArg" && item.role === "declaration"
  )!;

  assertEquals(valueOrigin.visibility, "public");
  assertEquals(libSource.slice(valueOrigin.span.start, valueOrigin.span.end), "value");
  assertEquals(privateArg.declaration?.visibility, "private");
  assertStrictEquals(privateArg.declaration?.moduleId, libId);
  const definitions = semanticDefinitionsAt(
    analysis.projectSnapshot,
    mainId,
    mainSource.lastIndexOf("item"),
  );
  assertEquals(definitions.length, 1);
  assertEquals(definitions[0].path, "/test/lib.wm");
  assertEquals(
    libSource.slice(definitions[0].span.start, definitions[0].span.end),
    "value",
  );
  assertEquals(main.sourceSpan.end, mainSource.length);
});

Deno.test("[module update A608] JS imports use compiler binding identities in scopes and mappings", async () => {
  const source = 'from js.global("Math") import { max as jsmax: (Number, Number) => Number }; ' +
    "let read = jsmax(1, 2);";
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const id = moduleId("/test/main.wm");
  const main = analysis.interfaces.get(id)!;
  const imported = main.occurrences.find((item) =>
    item.name === "jsmax" && item.role === "import-alias"
  )!;
  const reference = main.occurrences.find((item) =>
    item.name === "jsmax" && item.role === "reference"
  )!;

  assertEquals(imported.target.kind, "value");
  assertStrictEquals(imported.target.id, reference.target.id);
  assertEquals(imported.declaration?.visibility, "private");
  assertStrictEquals(
    semanticScopeAt(main, source.lastIndexOf("jsmax")).values.get("jsmax")?.id,
    imported.target.id,
  );
  assertEquals(
    semanticDefinitionsAt(analysis.projectSnapshot, id, source.lastIndexOf("jsmax"))[0]
      .occurrence,
    imported,
  );
  assertEquals(main.completeness.ffi, "complete");
  assertEquals(
    main.ffiFacts.imports.map((item) => ({
      target: item.target,
      unsafe: item.unsafe,
      typeOnly: item.typeOnly,
      source: source.slice(item.span.start, item.span.end),
      bindings: item.bindings.map((binding) => ({
        sourceName: binding.sourceName,
        localName: binding.localName,
        fallible: binding.fallible,
        type: main.semanticTypes[binding.type!.id].rendered,
      })),
    })),
    [{
      target: { kind: "global", path: "Math" },
      unsafe: false,
      typeOnly: false,
      source: 'from js.global("Math") import { max as jsmax: (Number, Number) => Number }',
      bindings: [{
        sourceName: "max",
        localName: "jsmax",
        fallible: true,
        type: "((Number, Number)) => Result<Number, Js.Error>",
      }],
    }],
  );
  assertStrictEquals(main.ffiFacts.imports[0].bindings[0].id, imported.target.id);
  assertEquals(
    main.ffiFacts.imports[0].bindings.some((binding) => binding.localName.startsWith("__ffi_")),
    false,
  );
  assertEquals(
    main.ffiFacts.calls.map((call) => ({
      label: call.label,
      source: source.slice(call.span.start, call.span.end),
      receiverElided: call.receiverElided,
    })),
    [{
      label: "jsmax",
      source: "jsmax",
      receiverElided: true,
    }],
  );
  assertEquals(Object.isFrozen(main.ffiFacts.calls), true);
  assertEquals(Object.isFrozen(main.ffiFacts.calls[0]), true);
});

Deno.test("[module update A608] inferred JS namespace members retain authored FFI names", async () => {
  const source =
    'from js.global("console") import * as console; let main = () => { console.log("x") };';
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const main = analysis.interfaces.get(moduleId("/test/main.wm"))!;
  const imported = main.ffiFacts.imports[0];
  const member = imported.bindings.find((binding) => binding.localName === "console.log")!;
  const reference = main.occurrences.find((occurrence) =>
    occurrence.name === "log" && occurrence.role === "reference"
  )!;

  assertEquals(main.ffiFacts.imports.length, 1);
  assertEquals(imported.target, { kind: "global", path: "console" });
  assertEquals(
    imported.bindings.map((binding) => [
      binding.sourceName,
      binding.localName,
    ]),
    [
      ["console", "console"],
      ["log", "console.log"],
    ],
  );
  assertEquals(member.fallible, true);
  assertEquals(main.semanticTypes[member.type!.id].rendered.includes("Js.Error"), true);
  assertStrictEquals(member.id, reference.target.id);
  assertEquals(
    imported.bindings.some((binding) => binding.localName.startsWith("__ffi_")),
    false,
  );
});

Deno.test("[module update A608] lowered JS structures retain authored qualifier identities", async () => {
  const source = 'from js.global("console") import unsafe { log: (Number) => Void } as console; ' +
    "let main = () => { console.log(1) };";
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const id = moduleId("/test/main.wm");
  const main = analysis.interfaces.get(id)!;
  const structure = main.occurrences.find((item) =>
    item.name === "console" && item.role === "import-alias" &&
    item.target.kind === "structure"
  )!;
  const qualifier = main.occurrences.find((item) =>
    item.name === "console" && item.role === "qualifier"
  )!;
  const declaration = main.occurrences.find((item) =>
    item.name === "log" && item.role === "declaration"
  )!;
  const reference = main.occurrences.find((item) =>
    item.name === "log" && item.role === "reference"
  )!;

  assertStrictEquals(qualifier.target.id, structure.target.id);
  assertStrictEquals(reference.target.id, declaration.target.id);
  assertStrictEquals(
    semanticScopeAt(main, source.lastIndexOf("console")).structures.get("console"),
    structure.target.id,
  );
  assertEquals(
    semanticDefinitionsAt(analysis.projectSnapshot, id, source.lastIndexOf("log"))[0]
      .occurrence,
    declaration,
  );
  assertEquals(main.occurrences.some((item) => item.name.startsWith("__ffi_")), false);
  assertEquals(main.ffiFacts.imports[0].unsafe, true);
  assertEquals(main.ffiFacts.imports[0].target, { kind: "global", path: "console" });
  assertStrictEquals(main.ffiFacts.imports[0].structureAlias?.id, structure.target.id);
  assertStrictEquals(main.ffiFacts.imports[0].bindings[0].id, declaration.target.id);
});

Deno.test("[module update A608] reflected foreign types receive nominal scope and origin identities", async () => {
  const source = "from js.global import type { Request as Thing }; " +
    "let identity = (value: Thing) => { value };";
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const main = analysis.interfaces.get(moduleId("/test/main.wm"))!;
  const declaration = main.occurrences.find((item) =>
    item.name === "Thing" && item.role === "declaration" && item.target.kind === "type"
  )!;
  const useOffset = source.lastIndexOf("Thing");

  assertEquals(declaration.declaration?.visibility, "public");
  assertStrictEquals(semanticScopeAt(main, useOffset).types.get("Thing"), declaration.target.id);
  const origin = main.origins.get("Thing")?.[0];
  assertEquals(origin?.kind, "type");
  if (origin?.kind === "type") {
    assertStrictEquals(origin.typeNameId, declaration.target.id);
  }
  assertEquals(main.completeness.ffi, "complete");
  assertEquals(main.ffiFacts.imports, []);
  assertEquals(
    main.ffiFacts.foreignTypes.map((type) => ({
      name: type.name,
      key: type.foreignKey,
      source: source.slice(type.span.start, type.span.end),
    })),
    [{
      name: "Thing",
      key: "global-type:Request",
      source: "Thing",
    }],
  );
  assertStrictEquals(main.ffiFacts.foreignTypes[0].id, declaration.target.id);
});

function inferGraphPartial(graph: ModuleGraph): ModuleMap<InferResult> {
  const results = new Map();
  for (const id of graph.order) {
    const node = graph.nodes.get(id)!;
    const imports = new Map(
      node.imports.map((edge) => [edge.specifier, results.get(edge.target)!]),
    );
    results.set(id, inferModulePartial(node.module, imports));
  }
  return results;
}

function declarationTextRange(source: string, startText: string): { start: number; end: number } {
  const start = source.indexOf(startText);
  return { start, end: source.indexOf(";", start) };
}

/**
 * `A608` occurrence-completeness audit: in a strict, fully elaborated analysis, every
 * authored named node — values, constructors, pinned patterns, type uses, and pattern
 * binders at any nesting depth — has a semantic occurrence inside its source span.
 *
 * Nodes fabricated by list desugaring (`Cons`/`Nil` at bracket spans) are excluded by
 * checking the authored source text: an occurrence for a spelling that does not appear
 * at its span would itself be wrong. This audit is the evidence for reporting
 * `occurrences: "complete"` on strict analyses.
 */
Deno.test("[module update A608] strict occurrences cover every authored named node", async () => {
  const lib = [
    "record Point<T> = { x: T, y: T };",
    "type Shape = | Dot<Point<Number>> | Empty;",
    "let origin = Point(0, 0);",
    "let describe = (shape: Shape) => { match(shape) { Dot(Var(p)) => { p.x }, Empty => { 0 } } };",
  ].join(" ");
  const main = [
    'from "./lib.wm" import * as Lib;',
    'from "./lib.wm" import { describe as label, Shape };',
    'from "./lib.wm" import *;',
    "let selected = Lib.origin;",
    "let dot: Lib.Shape = Lib.Dot(selected);",
    "let value = label(dot);",
    "let sum = selected.x + Lib.origin.y;",
    "let matched = match(dot) { Lib.Dot(Var(inner)) => { inner.x }, _ => { 0 } };",
    "let listy = match([1, 2]) { [Var(h), ..Var(t)] => { h + describe(Dot(origin)) }, [] => { 0 } };",
    "let block = { let local = origin; describe(Dot(local)) };",
  ].join(" ");
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/lib.wm", lib], ["/test/main.wm", main]]),
  );

  for (const [path, source] of [["/test/lib.wm", lib], ["/test/main.wm", main]] as const) {
    const moduleInterface = analysis.projectSnapshot.interfaces.get(moduleId(path))!;
    assertEquals(moduleInterface.completeness.occurrences, "complete", path);

    const missing: string[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      const kind = node.kind as string | undefined;
      const named = kind === "Var" || kind === "PCtor" || kind === "PPinned" ||
        kind === "TName" || kind === "PVar";
      const span = (node.node as { span?: { start: number; end: number } } | undefined)?.span;
      if (named && span && typeof node.name === "string") {
        const baseName = node.name.split(".").at(-1)!;
        const authored = source.slice(span.start, span.end).includes(baseName);
        const covered = moduleInterface.occurrences.some((item) =>
          item.span.start >= span.start && item.span.end <= span.end &&
          (item.name === node.name || item.name === baseName)
        );
        if (authored && !covered) {
          missing.push(`${kind} ${node.name} @${span.start}-${span.end}`);
        }
      }
      for (const key of Object.keys(node)) {
        if (key !== "node") visit(node[key]);
      }
    };
    visit(await parse(source));
    assertEquals(missing, [], path);
  }
});
