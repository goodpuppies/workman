import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  bindStructure,
  bindType,
  bindValue,
  modifyStaticEnv,
  projectStaticEnv,
  staticEnv,
} from "../src/infer/environment.ts";
import { BoolTy, freshTypeInfo, NumberTy, type Scheme, type TypeInfo } from "../src/types.ts";

Deno.test("SML static environment modification is right-biased per namespace", () => {
  const leftValue: Scheme = { vars: [], type: NumberTy };
  const rightValue: Scheme = { vars: [], type: BoolTy };
  const leftType: TypeInfo = { id: 1, name: "shared", arity: 0 };
  const rightType: TypeInfo = { id: 2, name: "shared", arity: 0 };
  const leftStructure = staticEnv();
  const rightStructure = staticEnv();
  const left = staticEnv(
    new Map([["shared", leftStructure]]),
    new Map([["shared", leftType]]),
    new Map([["shared", leftValue]]),
  );
  const right = staticEnv(
    new Map([["shared", rightStructure]]),
    new Map([["shared", rightType]]),
    new Map([["shared", rightValue]]),
  );

  modifyStaticEnv(left, right);

  assertStrictEquals(left.strEnv.get("shared"), rightStructure);
  assertStrictEquals(left.tyEnv.get("shared"), rightType);
  assertStrictEquals(left.valEnv.get("shared"), rightValue);
  assertEquals([...left.strEnv.keys()], ["shared"]);
  assertEquals([...left.tyEnv.keys()], ["shared"]);
  assertEquals([...left.valEnv.keys()], ["shared"]);
});

Deno.test("StrEnv recursively contains complete static environments", () => {
  const member: Scheme = { vars: [], type: NumberTy };
  const nested = staticEnv(new Map(), new Map(), new Map([["member", member]]));
  const root = staticEnv(new Map([["Nested", nested]]));

  assertStrictEquals(root.strEnv.get("Nested")?.valEnv.get("member"), member);
});

Deno.test("[module update T116] named projection preserves namespaces and renames keys only", () => {
  const scheme: Scheme = { vars: [], type: NumberTy, status: "constructor" };
  const type = freshTypeInfo("Thing", 0);
  const structure = staticEnv(new Map(), new Map(), new Map([["member", scheme]]));
  const source = staticEnv(
    new Map([["Thing", structure]]),
    new Map([["Thing", type]]),
    new Map([["Thing", scheme]]),
  );

  const projected = projectStaticEnv(source, "Thing", "Local")!;

  assertStrictEquals(projected.strEnv.get("Local"), structure);
  assertStrictEquals(projected.tyEnv.get("Local"), type);
  assertStrictEquals(projected.valEnv.get("Local"), scheme);
  assertEquals(projected.strEnv.has("Thing"), false);
  assertEquals(projected.tyEnv.has("Thing"), false);
  assertEquals(projected.valEnv.has("Thing"), false);
});

Deno.test("[module update G8] basis and local binders use SML environment modification", () => {
  const environment = staticEnv();
  const first: Scheme = { vars: [], type: NumberTy };
  const second: Scheme = { vars: [], type: BoolTy };
  const type = freshTypeInfo("Item", 0);
  const structure = staticEnv();

  bindValue(environment, "same", first);
  bindValue(environment, "same", second);
  bindType(environment, "same", type);
  bindStructure(environment, "same", structure);

  assertStrictEquals(environment.valEnv.get("same"), second);
  assertStrictEquals(environment.tyEnv.get("same"), type);
  assertStrictEquals(environment.strEnv.get("same"), structure);
});
