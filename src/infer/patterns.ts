import type { Pattern } from "../ast.ts";
import {
  BoolTy,
  type Env,
  fresh,
  instantiate,
  instantiateRecordFields,
  named,
  NumberTy,
  prune,
  StringTy,
  tuple,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
  type TypeInfo,
  VoidTy,
} from "../types.ts";
import { constrainAt } from "./provenance.ts";
import { expandCallArg } from "./shared.ts";
import {
  originForScheme,
  recordPatternFact,
  recordPatternType,
  type TypeFacts,
} from "./type_facts.ts";

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
    case "PRecord":
      return `.{ ${
        pattern.fields.map((f) => `${f.name} = ${showPattern(f.pattern)}`).join(", ")
      } }`;
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
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  binders = new Set<string>(),
  facts?: TypeFacts,
): Ty {
  if (facts) recordPatternType(facts, p, expected);
  switch (p.kind) {
    case "PWildcard":
      return expected;
    case "PVar":
      if (binders.has(p.name)) throw new Error(`duplicate pattern binder ${p.name}`);
      binders.add(p.name);
      env.set(p.name, {
        vars: [],
        type: expected,
        status: "value",
        preserveStructuralRows: true,
      });
      if (facts) {
        recordPatternFact(facts, p, {
          subject: "pattern",
          instantiated: expected,
          origin: { name: p.name, source: "local" },
        });
      }
      return expected;
    case "PPinned": {
      const scheme = env.get(p.name);
      if (!scheme) throw new Error(`unknown pinned pattern ${p.name}`);
      const pinned = instantiate(scheme);
      constrainPattern(expected, pinned, p, "InferPattern.Pinned", "pinned pattern matches value");
      if (facts) {
        recordPatternFact(facts, p, {
          subject: "pattern",
          instantiated: pinned,
          general: scheme,
          origin: originForScheme(p.name, scheme),
        });
      }
      return expected;
    }
    case "PInt":
      constrainPattern(expected, NumberTy, p, "InferPattern.Int", "integer pattern matches Number");
      return expected;
    case "PString":
      constrainPattern(
        expected,
        StringTy,
        p,
        "InferPattern.String",
        "string pattern matches String",
      );
      return expected;
    case "PBool":
      constrainPattern(expected, BoolTy, p, "InferPattern.Bool", "boolean pattern matches Bool");
      return expected;
    case "PVoid":
      constrainPattern(expected, VoidTy, p, "InferPattern.Void", "void pattern matches Void");
      return expected;
    case "PTuple": {
      const items = p.items.map(() => fresh());
      constrainPattern(
        expected,
        tuple(items),
        p,
        "InferPattern.Tuple",
        "tuple pattern matches tuple",
      );
      p.items.forEach((x, i) => inferPattern(x, items[i], env, typeEnv, adts, binders, facts));
      return expected;
    }
    case "PRecord": {
      rejectDuplicateFields(p.fields.map((field) => field.name));
      const record = recordPatternTarget(expected, p.fields.map((field) => field.name), typeEnv);
      constrainPattern(
        expected,
        record.type,
        p,
        "InferPattern.Record",
        "record pattern matches record type",
      );
      const fields = instantiateRecordFields(record.info, record.type.args);
      for (const field of p.fields) {
        const expectedField = fields.find((item) => item.name === field.name);
        if (!expectedField) throw new Error(`${record.info.name} has no field ${field.name}`);
        inferPattern(field.pattern, expectedField.type, env, typeEnv, adts, binders, facts);
      }
      return expected;
    }
    case "PCtor": {
      const scheme = env.get(p.name);
      if (!scheme) throw new Error(`unknown constructor ${p.name}`);
      if (scheme.status !== "constructor") throw new Error(`${p.name} is not a constructor`);
      const ctor = instantiate(scheme);
      if (facts) {
        recordPatternFact(facts, p, {
          subject: "constructor",
          instantiated: ctor,
          general: scheme,
          origin: originForScheme(p.name, scheme),
        });
      }
      if (ctor.tag === "fn") {
        const args = ctor.params.length === 1 ? expandCallArg(ctor.params[0]) : ctor.params;
        if (args.length !== p.args.length) {
          throw new Error(`${p.name} expects ${args.length} patterns`);
        }
        constrainPattern(
          expected,
          ctor.result,
          p,
          "InferPattern.ConstructorResult",
          "constructor pattern result matches scrutinee",
        );
        p.args.forEach((x, i) => inferPattern(x, args[i], env, typeEnv, adts, binders, facts));
      } else {
        if (p.args.length !== 0) throw new Error(`${p.name} does not carry values`);
        constrainPattern(
          expected,
          ctor,
          p,
          "InferPattern.NullaryConstructor",
          "nullary constructor pattern matches scrutinee",
        );
      }
      return expected;
    }
  }
}

export function inferBindingPattern(
  pattern: Pattern,
  expected: Ty,
  env: Env,
  typeEnv: TypeEnv,
  out: Map<string, Ty>,
  binders = new Set<string>(),
  facts?: TypeFacts,
) {
  if (facts) recordPatternType(facts, pattern, expected);
  switch (pattern.kind) {
    case "PVar":
      if (binders.has(pattern.name)) throw new Error(`duplicate pattern binder ${pattern.name}`);
      binders.add(pattern.name);
      out.set(pattern.name, expected);
      if (facts) {
        recordPatternFact(facts, pattern, {
          subject: "pattern",
          instantiated: expected,
          origin: { name: pattern.name, source: "local" },
        });
      }
      return;
    case "PWildcard":
      return;
    case "PInt":
      constrainPattern(
        expected,
        NumberTy,
        pattern,
        "InferBindingPattern.Int",
        "integer let pattern matches Number",
      );
      return;
    case "PString":
      constrainPattern(
        expected,
        StringTy,
        pattern,
        "InferBindingPattern.String",
        "string let pattern matches String",
      );
      return;
    case "PBool":
      constrainPattern(
        expected,
        BoolTy,
        pattern,
        "InferBindingPattern.Bool",
        "boolean let pattern matches Bool",
      );
      return;
    case "PVoid":
      constrainPattern(
        expected,
        VoidTy,
        pattern,
        "InferBindingPattern.Void",
        "void let pattern matches Void",
      );
      return;
    case "PTuple": {
      const items = pattern.items.map(() => fresh());
      constrainPattern(
        expected,
        tuple(items),
        pattern,
        "InferBindingPattern.Tuple",
        "tuple let pattern matches tuple",
      );
      pattern.items.forEach((item, i) =>
        inferBindingPattern(item, items[i], env, typeEnv, out, binders, facts)
      );
      return;
    }
    case "PRecord": {
      rejectDuplicateFields(pattern.fields.map((field) => field.name));
      const record = recordPatternTarget(
        expected,
        pattern.fields.map((field) => field.name),
        typeEnv,
      );
      constrainPattern(
        expected,
        record.type,
        pattern,
        "InferBindingPattern.Record",
        "record let pattern matches record type",
      );
      const fields = instantiateRecordFields(record.info, record.type.args);
      for (const field of pattern.fields) {
        const expectedField = fields.find((item) => item.name === field.name);
        if (!expectedField) throw new Error(`${record.info.name} has no field ${field.name}`);
        inferBindingPattern(field.pattern, expectedField.type, env, typeEnv, out, binders, facts);
      }
      return;
    }
    case "PCtor": {
      const scheme = env.get(pattern.name);
      if (!scheme) throw new Error(`unknown constructor ${pattern.name}`);
      if (scheme.status !== "constructor") {
        throw new Error(`${pattern.name} is not a constructor`);
      }
      const ctor = instantiate(scheme);
      if (facts) {
        recordPatternFact(facts, pattern, {
          subject: "constructor",
          instantiated: ctor,
          general: scheme,
          origin: originForScheme(pattern.name, scheme),
        });
      }
      if (ctor.tag === "fn") {
        const args = ctor.params.length === 1 ? expandCallArg(ctor.params[0]) : ctor.params;
        if (args.length !== pattern.args.length) {
          throw new Error(`${pattern.name} expects ${args.length} patterns`);
        }
        constrainPattern(
          expected,
          ctor.result,
          pattern,
          "InferBindingPattern.ConstructorResult",
          "constructor let pattern result matches value",
        );
        pattern.args.forEach((item, i) =>
          inferBindingPattern(item, args[i], env, typeEnv, out, binders, facts)
        );
      } else {
        if (pattern.args.length !== 0) throw new Error(`${pattern.name} does not carry values`);
        constrainPattern(
          expected,
          ctor,
          pattern,
          "InferBindingPattern.NullaryConstructor",
          "nullary constructor let pattern matches value",
        );
      }
      return;
    }
    default:
      throw new Error("unsupported let pattern");
  }
}

function constrainPattern(
  left: Ty,
  right: Ty,
  pattern: Pattern,
  rule: string,
  role: string,
) {
  constrainAt(left, right, pattern, undefined, [], undefined, {
    message: showPattern(pattern),
    node: pattern.node,
    span: pattern.node?.span,
  }, {
    premise: {
      rule,
      role,
      subject: showPattern(pattern),
      leftRole: "expected",
      rightRole: "pattern",
    },
  });
}

export function patternBinders(pattern: Pattern): string[] {
  switch (pattern.kind) {
    case "PVar":
      return [pattern.name];
    case "PTuple":
      return pattern.items.flatMap(patternBinders);
    case "PRecord":
      return pattern.fields.flatMap((field) => patternBinders(field.pattern));
    case "PCtor":
      return pattern.args.flatMap(patternBinders);
    default:
      return [];
  }
}

function recordPatternTarget(
  expected: Ty,
  names: string[],
  typeEnv: TypeEnv,
): { info: TypeInfo; type: Extract<Ty, { tag: "named" }> } {
  const target = prune(expected);
  if (target.tag === "named") {
    const info = [...typeEnv.values()].find((candidate) => candidate.id === target.id);
    if (!info?.recordFields) throw new Error(`${target.name} is not a record type`);
    return { info, type: target };
  }
  if (target.tag === "var") {
    const candidates = findRecordTypes(typeEnv, names);
    if (candidates.length === 0) throw new Error("no matching record type");
    if (candidates.length > 1) throw new Error("ambiguous record pattern");
    const info = candidates[0];
    const record = named(info, Array.from({ length: info.arity }, () => fresh())) as Extract<
      Ty,
      { tag: "named" }
    >;
    return { info, type: record };
  }
  throw new Error("record pattern requires a record type");
}

function findRecordTypes(typeEnv: TypeEnv, names: string[]): TypeInfo[] {
  return [...typeEnv.values()].filter((info) => {
    if (!info.recordFields) return false;
    const fields = info.recordFields.map((field) => field.name);
    return names.every((name) => fields.includes(name));
  });
}

function rejectDuplicateFields(names: string[]) {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`duplicate record field ${name}`);
    seen.add(name);
  }
}
