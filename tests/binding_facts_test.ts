import { assert, assertEquals } from "@std/assert";
import { resolveModuleBindingFacts } from "../src/binding_facts.ts";
import { coreVirtual } from "../src/compiler.ts";
import { coreFromSurface } from "../src/core/from_surface.ts";
import { CompilerIdAllocator } from "../src/ids.ts";
import { inferModule } from "../src/infer.ts";
import { parse } from "../src/parser.ts";

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
  const lib = result.core.modules.get("/test/lib.wm")!;
  const main = result.core.modules.get("/test/main.wm")!;
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
