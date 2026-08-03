import { assert, assertEquals } from "@std/assert";
import {
  bindingScopeAt,
  resolveModuleBindingFacts,
  resolveProgramBindingFacts,
} from "../src/binding_facts.ts";
import { coreVirtual } from "../src/compiler.ts";
import { coreFromSurface } from "../src/core/from_surface.ts";
import { CompilerIdAllocator } from "../src/ids.ts";
import { inferModule } from "../src/infer.ts";
import { moduleId } from "../src/module_id.ts";
import { loadModuleGraph } from "../src/module_graph.ts";
import { parseCompilerModule as parse } from "../src/compiler_frontend.ts";

Deno.test("surface binding facts and Core share lexical identities", async () => {
  const module = await parse(`
    let x = 1;
    let rec loop = (n) => { loop(n) };
    let shadow = (x) => { x };
    let pick = (pair) => {
      match(pair) => {
        (x, Var(y)) => { y },
        _ => { 0 },
      }
    };
  `);
  const facts = resolveModuleBindingFacts(module, new CompilerIdAllocator());
  const core = coreFromSurface(module, inferModule(module), facts);

  const binders = [...facts.binders.entries()];
  const outerX = binders.find(([pattern]) => pattern.kind === "PVar" && pattern.name === "x")?.[1];
  const shadowX = binders.filter(([pattern]) => pattern.kind === "PVar" && pattern.name === "x")[1]
    ?.[1];
  const loop = binders.find(([pattern]) => pattern.kind === "PVar" && pattern.name === "loop")?.[1];
  assert(outerX !== undefined && shadowX !== undefined && loop !== undefined);
  assert(outerX !== shadowX);

  const loopRefs = [...facts.references.entries()].filter(([node]) =>
    node.kind === "Var" && node.name === "loop"
  );
  assertEquals(loopRefs.map(([, id]) => id), [loop]);
  const pinnedX = [...facts.references.entries()].find(([node]) =>
    node.kind === "PPinned" && node.name === "x"
  );
  assertEquals(pinnedX?.[1], outerX);
  const shadowRef = [...facts.references.entries()].find(([node]) =>
    node.kind === "Var" && node.name === "x"
  );
  assertEquals(shadowRef?.[1], shadowX);

  const coreIds = collectCoreBindingIds(core);
  assertEquals(new Set(coreIds), facts.local);
});

Deno.test("module binding facts resolve namespace imports to exporter identities", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let value = 1;"],
    [
      "/test/main.wm",
      'from "./lib.wm" import * as Lib; from "./lib.wm" import { value as item }; let read = (Lib.value, item);',
    ],
  ]);
  const result = await coreVirtual("/test/main.wm", virtualFs);
  const lib = result.core.modules.get(moduleId("/test/lib.wm"))!;
  const main = result.core.modules.get(moduleId("/test/main.wm"))!;
  const exported = lib.bindings.exports.get("value");
  const imported = [...main.bindings.references.entries()].find(([node]) =>
    node.kind === "Var" && node.name === "Lib.value"
  )?.[1];
  const named = [...main.bindings.references.entries()].find(([node]) =>
    node.kind === "Var" && node.name === "item"
  )?.[1];

  assert(exported !== undefined);
  assertEquals(imported, exported);
  assertEquals(named, exported);
  assertEquals(main.bindings.local.has(imported!), false);
});

Deno.test("module binding facts consume imports at declaration position", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let value = 1;"],
    [
      "/test/main.wm",
      'let before = value; from "./lib.wm" import { value }; let after = value;',
    ],
  ]);
  const graph = await loadModuleGraph("/test/main.wm", { virtualFs });
  const facts = resolveProgramBindingFacts(graph, new CompilerIdAllocator());
  const libFacts = facts.get(moduleId("/test/lib.wm"))!;
  const mainFacts = facts.get(moduleId("/test/main.wm"))!;
  const main = graph.nodes.get(moduleId("/test/main.wm"))!.module;
  const references = main.decls.flatMap((decl) =>
    decl.kind === "LetDecl"
      ? decl.bindings.map((binding) => binding.value).filter((expr) => expr.kind === "Var")
      : []
  );
  const before = references.find((expr) => expr.kind === "Var" && expr.name === "value");
  const after = references.findLast((expr) => expr.kind === "Var" && expr.name === "value");

  assert(before && after && before !== after);
  assertEquals(mainFacts.references.has(before), false);
  assertEquals(mainFacts.references.get(after), libFacts.exports.get("value"));
});

Deno.test("[module update A608] binding scopes preserve block and lambda declaration order", async () => {
  const source =
    "let outer = 1; let f = (param) => { let local = param; local }; let after = outer;";
  const module = await parse(source);
  const facts = resolveModuleBindingFacts(module, new CompilerIdAllocator());
  const binders = [...facts.binders.entries()];
  const id = (name: string) =>
    binders.find(([pattern]) => pattern.kind === "PVar" && pattern.name === name)?.[1];
  const outer = id("outer");
  const param = id("param");
  const local = id("local");
  assert(outer !== undefined && param !== undefined && local !== undefined);

  assertEquals(bindingScopeAt(facts, source.indexOf("1"))?.values.has("outer"), false);
  assertEquals(bindingScopeAt(facts, source.indexOf("param;"))?.values.get("param"), param);
  assertEquals(bindingScopeAt(facts, source.indexOf("param;"))?.values.has("local"), false);
  assertEquals(bindingScopeAt(facts, source.indexOf("local };"))?.values.get("local"), local);
  const after = bindingScopeAt(facts, source.lastIndexOf("outer"))!;
  assertEquals(after.values.get("outer"), outer);
  assertEquals(after.values.has("param"), false);
  assertEquals(after.values.has("local"), false);
});

Deno.test("[module update A608] binding scopes preserve independent type and constructor components", async () => {
  const source =
    "type Choice = | Choice; let before = Choice; type Choice = | Other; let after = Choice;";
  const module = await parse(source);
  const facts = resolveModuleBindingFacts(module, new CompilerIdAllocator());
  const firstType = module.decls[0];
  const secondType = module.decls[2];
  assert(firstType.kind === "TypeDecl" && secondType.kind === "TypeDecl");

  const before = bindingScopeAt(facts, source.indexOf("Choice", source.indexOf("before")))!;
  const after = bindingScopeAt(facts, source.lastIndexOf("Choice"))!;
  assertEquals(before.types.get("Choice"), firstType);
  assertEquals(before.constructors.get("Choice"), firstType.ctors[0]);
  assertEquals(after.types.get("Choice"), secondType);
  assertEquals(after.constructors.get("Choice"), firstType.ctors[0]);
  assertEquals(after.constructors.get("Other"), secondType.ctors[0]);
});

Deno.test("[module update M210] structure aliases and qualified references carry compiler identities", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "let value = 1;"],
    ["/test/b.wm", "let value = 2;"],
    [
      "/test/main.wm",
      'from "./a.wm" import * as Lib; let first = Lib.value; ' +
      'from "./b.wm" import * as Lib; let second = Lib.value;',
    ],
  ]);
  const result = await coreVirtual("/test/main.wm", virtualFs);
  const graphModule = result.graph.nodes.get(moduleId("/test/main.wm"))!.module;
  const artifact = result.core.modules.get(moduleId("/test/main.wm"))!;
  const imports = graphModule.decls.filter((decl) => decl.kind === "ImportDecl");
  const references = [...artifact.bindings.structureReferences.entries()]
    .filter(([expr]) => expr.kind === "Var" && expr.name === "Lib.value");
  const firstId = artifact.bindings.structureBinders.get(imports[0]);
  const secondId = artifact.bindings.structureBinders.get(imports[1]);

  assert(firstId !== undefined && secondId !== undefined && firstId !== secondId);
  assertEquals(references.map(([, id]) => id), [firstId, secondId]);
  const coreImports = artifact.module.decls.filter((decl) => decl.kind === "CoreImport");
  assertEquals(coreImports.map((decl) => decl.structureId), [firstId, secondId]);
  assertEquals(coreImports.map((decl) => decl.target), [
    moduleId("/test/a.wm"),
    moduleId("/test/b.wm"),
  ]);
});

function collectCoreBindingIds(value: unknown, ids: number[] = []): number[] {
  if (!value || typeof value !== "object") return ids;
  const record = value as Record<string, unknown>;
  if (
    (record.kind === "CoreVar" || record.kind === "CorePVar" ||
      record.kind === "CorePPinned") && typeof record.bindingId === "number"
  ) {
    ids.push(record.bindingId);
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "node") continue;
    if (Array.isArray(child)) child.forEach((item) => collectCoreBindingIds(item, ids));
    else collectCoreBindingIds(child, ids);
  }
  return ids;
}
