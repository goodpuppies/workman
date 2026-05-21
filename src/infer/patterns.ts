import type { Pattern } from "../ast.ts";
import {
  BoolTy,
  type Env,
  fresh,
  instantiate,
  NumberTy,
  StringTy,
  tuple,
  type Ty,
  type TypeDeclInfo,
  VoidTy,
} from "../types.ts";
import { constrain, expandCallArg } from "./shared.ts";

export function showPattern(pattern: Pattern): string {
  switch (pattern.kind) {
    case "PWildcard":
      return "_";
    case "PVar":
      return pattern.name;
    case "PInt":
      return String(pattern.value);
    case "PString":
      return JSON.stringify(pattern.value);
    case "PBool":
      return pattern.value ? "true" : "false";
    case "PVoid":
      return "void";
    case "PPinned":
      return pattern.name;
    case "PTuple":
      return `(${pattern.items.map(showPattern).join(", ")})`;
    case "PCtor":
      return pattern.args.length
        ? `${pattern.name}(${pattern.args.map(showPattern).join(", ")})`
        : pattern.name;
  }
}

export function inferPattern(
  p: Pattern,
  expected: Ty,
  env: Env,
  adts: Map<number, TypeDeclInfo>,
  binders = new Set<string>(),
): Ty {
  switch (p.kind) {
    case "PWildcard":
      return expected;
    case "PVar":
      if (binders.has(p.name)) throw new Error(`duplicate pattern binder ${p.name}`);
      binders.add(p.name);
      env.set(p.name, { vars: [], type: expected });
      return expected;
    case "PPinned": {
      const scheme = env.get(p.name);
      if (!scheme) throw new Error(`unknown pinned pattern ${p.name}`);
      constrain(expected, instantiate(scheme));
      return expected;
    }
    case "PInt":
      constrain(expected, NumberTy);
      return expected;
    case "PString":
      constrain(expected, StringTy);
      return expected;
    case "PBool":
      constrain(expected, BoolTy);
      return expected;
    case "PVoid":
      constrain(expected, VoidTy);
      return expected;
    case "PTuple": {
      const items = p.items.map(() => fresh());
      constrain(expected, tuple(items));
      p.items.forEach((x, i) => inferPattern(x, items[i], env, adts, binders));
      return expected;
    }
    case "PCtor": {
      const scheme = env.get(p.name);
      if (!scheme) throw new Error(`unknown constructor ${p.name}`);
      const ctor = instantiate(scheme);
      if (ctor.tag === "fn") {
        const args = ctor.params.length === 1 ? expandCallArg(ctor.params[0]) : ctor.params;
        if (args.length !== p.args.length) {
          throw new Error(`${p.name} expects ${args.length} patterns`);
        }
        constrain(expected, ctor.result);
        p.args.forEach((x, i) => inferPattern(x, args[i], env, adts, binders));
      } else {
        if (p.args.length !== 0) throw new Error(`${p.name} does not carry values`);
        constrain(expected, ctor);
      }
      return expected;
    }
  }
}

export function inferBindingPattern(
  pattern: Pattern,
  expected: Ty,
  env: Env,
  out: Map<string, Ty>,
  binders = new Set<string>(),
) {
  switch (pattern.kind) {
    case "PVar":
      if (binders.has(pattern.name)) throw new Error(`duplicate pattern binder ${pattern.name}`);
      binders.add(pattern.name);
      out.set(pattern.name, expected);
      return;
    case "PWildcard":
      return;
    case "PInt":
      constrain(expected, NumberTy);
      return;
    case "PString":
      constrain(expected, StringTy);
      return;
    case "PBool":
      constrain(expected, BoolTy);
      return;
    case "PVoid":
      constrain(expected, VoidTy);
      return;
    case "PTuple": {
      const items = pattern.items.map(() => fresh());
      constrain(expected, tuple(items));
      pattern.items.forEach((item, i) => inferBindingPattern(item, items[i], env, out, binders));
      return;
    }
    case "PCtor": {
      const scheme = env.get(pattern.name);
      if (!scheme) throw new Error(`unknown constructor ${pattern.name}`);
      const ctor = instantiate(scheme);
      if (ctor.tag === "fn") {
        const args = ctor.params.length === 1 ? expandCallArg(ctor.params[0]) : ctor.params;
        if (args.length !== pattern.args.length) {
          throw new Error(`${pattern.name} expects ${args.length} patterns`);
        }
        constrain(expected, ctor.result);
        pattern.args.forEach((item, i) => inferBindingPattern(item, args[i], env, out, binders));
      } else {
        if (pattern.args.length !== 0) throw new Error(`${pattern.name} does not carry values`);
        constrain(expected, ctor);
      }
      return;
    }
    default:
      throw new Error("unsupported let pattern");
  }
}

export function patternBinders(pattern: Pattern): string[] {
  switch (pattern.kind) {
    case "PVar":
      return [pattern.name];
    case "PTuple":
      return pattern.items.flatMap(patternBinders);
    case "PCtor":
      return pattern.args.flatMap(patternBinders);
    default:
      return [];
  }
}
