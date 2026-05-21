import type { Binding, Decl, Expr, Module, Pattern } from "./ast.ts";
import {
  baseEnv,
  baseTypeEnv,
  BoolTy,
  Env,
  fn,
  fresh,
  freshTypeInfo,
  generalize,
  instantiate,
  named,
  NumberTy,
  prune,
  Scheme,
  show,
  StringTy,
  tuple,
  Ty,
  TypeDeclInfo,
  TypeEnv,
  typeFromAst,
  unify,
  VoidTy,
} from "./types.ts";

export type InferResult = {
  env: Env;
  exports: Env;
  typeEnv: TypeEnv;
  typeExports: TypeEnv;
  types: Map<Expr, Ty>;
  adts: Map<number, TypeDeclInfo>;
};

export function inferModule(module: Module, imports = new Map<string, InferResult>()): InferResult {
  const env = baseEnv();
  const exports: Env = new Map();
  const typeEnv = baseTypeEnv();
  const typeExports: TypeEnv = new Map();
  const adts = new Map<number, TypeDeclInfo>();
  const types = new Map<Expr, Ty>();
  for (const decl of module.decls) {
    if (decl.kind !== "ImportDecl") continue;
    const imported = imports.get(decl.alias);
    if (!imported) throw new Error(`unknown import ${decl.alias}`);
    addQualifiedImport(env, decl.alias, imported.exports);
    addQualifiedTypes(typeEnv, decl.alias, imported.typeExports);
    addAdts(adts, imported.adts);
  }
  for (const decl of module.decls) inferDecl(decl, env, exports, typeEnv, typeExports, adts, types);
  return { env, exports, typeEnv, typeExports, types, adts };
}

function isDecl(value: Decl | Expr): value is Decl {
  return value.kind === "ImportDecl" || value.kind === "LetDecl" || value.kind === "TypeDecl";
}

function addQualifiedImport(env: Env, alias: string, imported: Env) {
  for (const [name, scheme] of imported) env.set(`${alias}.${name}`, scheme);
}

function addQualifiedTypes(typeEnv: TypeEnv, alias: string, imported: TypeEnv) {
  for (const [name, info] of imported) typeEnv.set(`${alias}.${name}`, info);
}

function addAdts(adts: Map<number, TypeDeclInfo>, imported: Map<number, TypeDeclInfo>) {
  for (const [id, info] of imported) adts.set(id, info);
}

function inferDecl(
  decl: Decl,
  env: Env,
  exports: Env,
  typeEnv: TypeEnv,
  typeExports: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
) {
  if (decl.kind === "ImportDecl") return;
  if (decl.kind === "TypeDecl") {
    rejectDuplicates(decl.params, "type parameter");
    rejectDuplicates(decl.ctors.map((c) => c.name), "constructor");
    const info = freshTypeInfo(decl.name, decl.params.length);
    adts.set(info.id, { ...decl, type: info });
    typeEnv.set(decl.name, info);
    typeExports.set(decl.name, info);
    const vars = new Map(decl.params.map((p) => [p, fresh(p)] as const));
    const result = named(info, decl.params.map((p) => vars.get(p)!));
    for (const c of decl.ctors) {
      const args = c.args.map((x) => typeFromAst(x, typeEnv, vars));
      const t = args.length === 0 ? result : fn(args, result);
      const scheme = generalize(env, t);
      env.set(c.name, scheme);
      exports.set(c.name, scheme);
    }
    return;
  }
  rejectDuplicates(decl.bindings.flatMap((b) => patternBinders(b.pattern)), "binding");
  if (!decl.recursive) {
    for (const b of decl.bindings) inferBinding(b, env, exports, typeEnv, adts, types);
    return;
  }
  const base = new Map(env);
  for (const b of decl.bindings) {
    if (b.pattern.kind !== "PVar") throw new Error("recursive bindings must bind one name");
  }
  const placeholders = decl.bindings.map(() => fresh());
  decl.bindings.forEach((b, i) =>
    env.set((b.pattern as { name: string }).name, { vars: [], type: placeholders[i] })
  );
  decl.bindings.forEach((b, i) =>
    unify(placeholders[i], inferExpr(b.value, env, typeEnv, adts, types))
  );
  decl.bindings.forEach((b, i) => {
    const scheme = generalize(base, placeholders[i]);
    const name = (b.pattern as { name: string }).name;
    env.set(name, scheme);
    exports.set(name, scheme);
  });
}

function rejectDuplicates(names: string[], kind: string) {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`duplicate ${kind} ${name}`);
    seen.add(name);
  }
}

function inferBinding(
  b: Binding,
  env: Env,
  exports: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
) {
  const t = inferExpr(b.value, env, typeEnv, adts, types);
  if (b.annotation) unify(t, typeFromAst(b.annotation, typeEnv));
  const bound = new Map<string, Ty>();
  inferBindingPattern(b.pattern, t, bound);
  for (const [name, type] of bound) {
    const scheme = generalize(env, type);
    env.set(name, scheme);
    exports.set(name, scheme);
  }
}

function inferExpr(
  expr: Expr,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
): Ty {
  let t: Ty;
  switch (expr.kind) {
    case "Int":
    case "Float":
      t = NumberTy;
      break;
    case "String":
      t = StringTy;
      break;
    case "Bool":
      t = BoolTy;
      break;
    case "Void":
      t = VoidTy;
      break;
    case "Var": {
      const scheme = env.get(expr.name);
      if (!scheme) throw new Error(`unknown name ${expr.name}`);
      t = instantiate(scheme);
      break;
    }
    case "Tuple":
      t = tuple(expr.items.map((x) => inferExpr(x, env, typeEnv, adts, types)));
      break;
    case "Lambda": {
      const local = new Map(env);
      const params = expr.params.map((p) => inferPattern(p, fresh(), local, adts));
      t = fn(params, inferExpr(expr.body, local, typeEnv, adts, types));
      break;
    }
    case "Call": {
      const result = fresh();
      unify(
        inferExpr(expr.callee, env, typeEnv, adts, types),
        fn(expr.args.map((a) => inferExpr(a, env, typeEnv, adts, types)), result),
      );
      t = result;
      break;
    }
    case "If":
      unify(inferExpr(expr.cond, env, typeEnv, adts, types), BoolTy);
      t = inferExpr(expr.thenExpr, env, typeEnv, adts, types);
      unify(t, inferExpr(expr.elseExpr, env, typeEnv, adts, types));
      break;
    case "Match": {
      const valueType = inferExpr(expr.value, env, typeEnv, adts, types);
      t = fresh();
      for (const arm of expr.arms) {
        const local = new Map(env);
        inferPattern(arm.pattern, valueType, local, adts);
        unify(t, inferExpr(arm.body, local, typeEnv, adts, types));
      }
      checkExhaustive(expr.arms.map((arm) => arm.pattern), valueType, adts);
      break;
    }
    case "Block": {
      const local = new Map(env);
      expr.statements.forEach((s) =>
        isDecl(s)
          ? inferDecl(s, local, new Map(), typeEnv, new Map(), adts, types)
          : inferExpr(s, local, typeEnv, adts, types)
      );
      t = inferExpr(expr.result, local, typeEnv, adts, types);
      break;
    }
    case "Binary": {
      const result = fresh();
      const op: Scheme | undefined = env.get(expr.op);
      if (!op) throw new Error(`unknown operator ${expr.op}`);
      unify(
        instantiate(op),
        fn(
          [
            inferExpr(expr.left, env, typeEnv, adts, types),
            inferExpr(expr.right, env, typeEnv, adts, types),
          ],
          result,
        ),
      );
      t = result;
      break;
    }
    case "Unary":
      if (expr.op === "-") {
        unify(inferExpr(expr.value, env, typeEnv, adts, types), NumberTy);
        t = NumberTy;
      } else {
        unify(inferExpr(expr.value, env, typeEnv, adts, types), BoolTy);
        t = BoolTy;
      }
      break;
  }
  types.set(expr, t);
  return t;
}

function checkExhaustive(patterns: Pattern[], valueType: Ty, adts: Map<number, TypeDeclInfo>) {
  if (patterns.some((p) => p.kind === "PWildcard")) return;
  const scrutinee = prune(valueType);
  if (scrutinee.tag !== "named") {
    throw new Error("non-exhaustive match: non-sum matches require _");
  }
  const info = adts.get(scrutinee.id);
  if (!info) throw new Error("non-exhaustive match: unknown sum type");
  const covered = new Set(
    patterns
      .filter((p): p is Extract<Pattern, { kind: "PCtor" }> => p.kind === "PCtor")
      .map((p) => baseName(p.name)),
  );
  const missing = info.ctors.map((c) => c.name).filter((name) => !covered.has(name));
  if (missing.length) throw new Error(`non-exhaustive match: missing ${missing.join(", ")}`);
}

function baseName(name: string): string {
  return name.split(".").at(-1)!;
}

function inferPattern(
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
      unify(expected, instantiate(scheme));
      return expected;
    }
    case "PInt":
      unify(expected, NumberTy);
      return expected;
    case "PString":
      unify(expected, StringTy);
      return expected;
    case "PBool":
      unify(expected, BoolTy);
      return expected;
    case "PVoid":
      unify(expected, VoidTy);
      return expected;
    case "PTuple": {
      const items = p.items.map(() => fresh());
      unify(expected, tuple(items));
      p.items.forEach((x, i) => inferPattern(x, items[i], env, adts, binders));
      return expected;
    }
    case "PCtor": {
      const scheme = env.get(p.name);
      if (!scheme) throw new Error(`unknown constructor ${p.name}`);
      const ctor = instantiate(scheme);
      if (ctor.tag === "fn") {
        if (ctor.params.length !== p.args.length) {
          throw new Error(`${p.name} expects ${ctor.params.length} patterns`);
        }
        unify(expected, ctor.result);
        p.args.forEach((x, i) => inferPattern(x, ctor.params[i], env, adts, binders));
      } else {
        if (p.args.length !== 0) throw new Error(`${p.name} does not carry values`);
        unify(expected, ctor);
      }
      return expected;
    }
  }
}

function inferBindingPattern(
  pattern: Pattern,
  expected: Ty,
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
    case "PTuple": {
      const items = pattern.items.map(() => fresh());
      unify(expected, tuple(items));
      pattern.items.forEach((item, i) => inferBindingPattern(item, items[i], out, binders));
      return;
    }
    default:
      throw new Error("unsupported let pattern");
  }
}

function patternBinders(pattern: Pattern): string[] {
  switch (pattern.kind) {
    case "PVar":
      return [pattern.name];
    case "PTuple":
      return pattern.items.flatMap(patternBinders);
    default:
      return [];
  }
}

export function describeEnv(env: Env): string {
  return [...env.entries()].map(([name, scheme]) => `${name}: ${show(scheme.type)}`).join("\n");
}
