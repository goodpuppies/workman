import { assertEquals, assertStrictEquals } from "@std/assert";
import { cloneTypeEnv, registerTypeInfo, type TypeEnv, typeInfoById } from "../src/types.ts";
import { dedupeOrigins } from "../src/infer/provenance.ts";

Deno.test("cloned nominal registries isolate writes in parent, child, and sibling", () => {
  const parent: TypeEnv = new Map();
  const original = { id: 900001, name: "Original", arity: 0 };
  registerTypeInfo(parent, original);
  const child = cloneTypeEnv(parent);
  const sibling = cloneTypeEnv(parent);
  const grandchild = cloneTypeEnv(child);
  const replacement = { ...original, name: "Replacement" };
  registerTypeInfo(parent, replacement);
  const added = { id: 900002, name: "ChildOnly", arity: 0 };
  registerTypeInfo(child, added);
  assertStrictEquals(typeInfoById(parent, original.id), replacement);
  for (const env of [child, sibling, grandchild]) {
    assertStrictEquals(typeInfoById(env, original.id), original);
  }
  assertStrictEquals(typeInfoById(child, added.id), added);
  for (const env of [parent, sibling, grandchild]) {
    assertEquals(typeInfoById(env, added.id), undefined);
  }
  const clone = cloneTypeEnv(parent);
  parent.set("Visible", original);
  assertEquals(clone.has("Visible"), false);
});

Deno.test("origin deduplication preserves first occurrence and independent output arrays", () => {
  const first = { message: "first" };
  const singleton = [first];
  const output = dedupeOrigins(singleton);
  output.pop();
  assertEquals(singleton.length, 1);
  const second = { message: "second" };
  const result = dedupeOrigins([first, { ...first }, second, first]);
  assertEquals(result, [first, second]);
  assertStrictEquals(result[0], first);
  assertEquals(dedupeOrigins([]), []);
});
