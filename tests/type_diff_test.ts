import { assertStringIncludes } from "@std/assert";
import {
  baseTypeEnv,
  fn,
  named,
  StringTy,
  tuple,
  typeMismatchMessage,
  VoidTy,
} from "../src/types.ts";

Deno.test("type mismatch messages point at the nested differing type", () => {
  const typeEnv = baseTypeEnv();
  const task = typeEnv.get("Task")!;
  const jsArray = typeEnv.get("Js.Array")!;
  const jsError = typeEnv.get("Js.Error")!;
  const strings = named(jsArray, [StringTy]);
  const expected = fn([
    tuple([
      named(task, [strings, StringTy]),
      fn([strings], named(task, [VoidTy, named(jsError)])),
    ]),
  ], StringTy);
  const actual = fn([
    tuple([
      named(task, [strings, StringTy]),
      fn([strings], named(task, [VoidTy, StringTy])),
    ]),
  ], named(task, [VoidTy, StringTy]));

  const message = typeMismatchMessage(expected, actual);

  assertStringIncludes(message, "at parameter 1 -> tuple item 2 -> result -> Task error:");
  assertStringIncludes(message, "expected: Js.Error");
  assertStringIncludes(message, "got:      String");
  assertStringIncludes(message, "full expected:");
});
