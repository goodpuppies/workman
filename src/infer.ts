import type { Binding, Decl, Expr, ImportClause, Module, Param, Pattern } from "./ast.ts";
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
  TypeVarScope,
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
    if (decl.kind === "ImportDecl") {
      const imported = imports.get(decl.path);
      if (!imported) throw new Error(`unknown import ${decl.path}`);
      addImport(env, typeEnv, decl.clause, imported);
      addAdts(adts, imported.adts);
      continue;
    }
    inferDecl(decl, env, exports, typeEnv, typeExports, adts, types);
  }
  return { env, exports, typeEnv, typeExports, types, adts };
}

function isDecl(value: Decl | Expr): value is Decl {
  return value.kind === "ImportDecl" || value.kind === "LetDecl" || value.kind === "TypeDecl";
}

function addImport(env: Env, typeEnv: TypeEnv, clause: ImportClause, imported: InferResult) {
  if (clause.kind === "Namespace") {
    addQualifiedImport(env, clause.alias, imported.exports);
    addQualifiedTypes(typeEnv, clause.alias, imported.typeExports);
    return;
  }
  const values = new Set<string>();
  const types = new Set<string>();
  for (const spec of clause.specs) {
    const local = spec.alias ?? spec.name;
    const value = imported.exports.get(spec.name);
    const type = imported.typeExports.get(spec.name);
    if (!value && !type) throw new Error(`unknown import ${spec.name}`);
    if (value) {
      if (values.has(local) || env.has(local)) throw new Error(`duplicate value import ${local}`);
      values.add(local);
      env.set(local, value);
    }
    if (type) {
      if (types.has(local) || typeEnv.has(local)) throw new Error(`duplicate type import ${local}`);
      types.add(local);
      typeEnv.set(local, type);
    }
  }
}

function addQualifiedImport(env: Env, alias: string, imported: Env) {
  for (const [name, scheme] of imported) {
    const local = `${alias}.${name}`;
    if (env.has(local)) throw new Error(`duplicate value import ${local}`);
    env.set(local, scheme);
  }
}

function addQualifiedTypes(typeEnv: TypeEnv, alias: string, imported: TypeEnv) {
  for (const [name, info] of imported) {
    const local = `${alias}.${name}`;
    if (typeEnv.has(local)) throw new Error(`duplicate type import ${local}`);
    typeEnv.set(local, info);
  }
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
    if (typeEnv.has(decl.name)) throw new Error(`duplicate type declaration ${decl.name}`);
    rejectDuplicates(decl.params, "type parameter");
    rejectDuplicates(decl.ctors.map((c) => c.name), "constructor");
    const info = freshTypeInfo(decl.name, decl.params.length);
    adts.set(info.id, { ...decl, type: info });
    typeEnv.set(decl.name, info);
    if (decl.exported) typeExports.set(decl.name, info);
    const vars = new Map(decl.params.map((p) => [p, fresh(p)] as const));
    const result = named(info, decl.params.map((p) => vars.get(p)!));
    for (const c of decl.ctors) {
      const args = c.args.map((x) => typeFromAst(x, typeEnv, vars));
      const t = args.length === 0 ? result : fn(args, result);
      const scheme = generalize(env, t);
      env.set(c.name, scheme);
      if (decl.exported) exports.set(c.name, scheme);
    }
    return;
  }
  rejectDuplicates(decl.bindings.flatMap((b) => patternBinders(b.pattern)), "binding");
  if (!decl.recursive) {
    const base = new Map(env);
    const inferred = decl.bindings.map((b) => inferBinding(b, base, typeEnv, adts, types));
    for (const bound of inferred) {
      for (const [name, type] of bound) {
        const scheme = generalize(base, type);
        env.set(name, scheme);
        if (decl.exported) exports.set(name, scheme);
      }
    }
    return;
  }
  const base = new Map(env);
  for (const b of decl.bindings) {
    if (b.pattern.kind !== "PVar") throw new Error("recursive bindings must bind one name");
    if (b.value.kind !== "Lambda") throw new Error("recursive bindings must be functions");
  }
  const placeholders = decl.bindings.map(() => fresh());
  decl.bindings.forEach((b, i) =>
    env.set((b.pattern as { name: string }).name, { vars: [], type: placeholders[i] })
  );
  decl.bindings.forEach((b, i) => {
    unify(placeholders[i], inferExpr(b.value, env, typeEnv, adts, types));
    if (b.annotation) unify(placeholders[i], typeFromAst(b.annotation, typeEnv));
  });
  decl.bindings.forEach((b, i) => {
    const scheme = generalize(base, placeholders[i]);
    const name = (b.pattern as { name: string }).name;
    env.set(name, scheme);
    if (decl.exported) exports.set(name, scheme);
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
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
): Map<string, Ty> {
  const t = inferExpr(b.value, env, typeEnv, adts, types);
  if (b.annotation) unify(t, typeFromAst(b.annotation, typeEnv));
  const bound = new Map<string, Ty>();
  inferBindingPattern(b.pattern, t, env, bound);
  return bound;
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
      const annotationVars: TypeVarScope = new Map();
      const binders = new Set<string>();
      const params = expr.params.map((p) =>
        inferParam(p, local, typeEnv, adts, annotationVars, binders)
      );
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
      checkExhaustive(expr.arms.map((arm) => arm.pattern), valueType, typeEnv, adts);
      break;
    }
    case "Block": {
      const local = new Map(env);
      const localTypes = new Map(typeEnv);
      const outerTypeIds = new Set([...typeEnv.values()].map((info) => info.id));
      expr.statements.forEach((s) =>
        isDecl(s)
          ? inferDecl(s, local, new Map(), localTypes, new Map(), adts, types)
          : inferExpr(s, local, localTypes, adts, types)
      );
      t = inferExpr(expr.result, local, localTypes, adts, types);
      if (mentionsLocalType(t, outerTypeIds)) throw new Error("local type escapes scope");
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

function checkExhaustive(
  patterns: Pattern[],
  valueType: Ty,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
) {
  if (isVectorExhaustive(patterns.map((pattern) => [pattern]), [valueType], typeEnv, adts)) return;
  const scrutinee = prune(valueType);
  if (scrutinee.tag === "named") {
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
  throw new Error("non-exhaustive match");
}

function baseName(name: string): string {
  return name.split(".").at(-1)!;
}

function isIrrefutable(pattern: Pattern): boolean {
  if (pattern.kind === "PWildcard" || pattern.kind === "PVar") return true;
  if (pattern.kind === "PTuple") return pattern.items.every(isIrrefutable);
  return false;
}

function isVectorExhaustive(
  rows: Pattern[][],
  types: Ty[],
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
): boolean {
  if (types.length === 0) return rows.length > 0;
  const [headType, ...tailTypes] = types;
  const head = prune(headType);
  if (rows.some((row) => isIrrefutable(row[0]))) {
    const tails = rows.filter((row) => isIrrefutable(row[0])).map((row) => row.slice(1));
    return isVectorExhaustive(tails, tailTypes, typeEnv, adts);
  }

  if (head.tag === "prim" && head.name === "Bool") {
    const trueRows = rows.filter((row) => row[0].kind === "PBool" && row[0].value).map((row) => row.slice(1));
    const falseRows = rows.filter((row) => row[0].kind === "PBool" && !row[0].value).map((row) => row.slice(1));
    return isVectorExhaustive(trueRows, tailTypes, typeEnv, adts) &&
      isVectorExhaustive(falseRows, tailTypes, typeEnv, adts);
  }

  if (head.tag === "prim" && head.name === "Void") {
    const voidRows = rows.filter((row) => row[0].kind === "PVoid").map((row) => row.slice(1));
    return isVectorExhaustive(voidRows, tailTypes, typeEnv, adts);
  }

  if (head.tag === "tuple") {
    const tupleRows = rows
      .filter((row): row is [Extract<Pattern, { kind: "PTuple" }>, ...Pattern[]] => row[0].kind === "PTuple")
      .filter((row) => row[0].items.length === head.items.length)
      .map((row) => [...row[0].items, ...row.slice(1)]);
    if (tupleRows.length === 0) return false;
    return isVectorExhaustive(tupleRows, [...head.items, ...tailTypes], typeEnv, adts);
  }

  if (head.tag === "named") {
    const info = adts.get(head.id);
    if (!info) return false;
    for (const ctor of info.ctors) {
      const ctorRows = rows
        .filter((row): row is [Extract<Pattern, { kind: "PCtor" }>, ...Pattern[]] => row[0].kind === "PCtor")
        .filter((row) => baseName(row[0].name) === ctor.name)
        .map((row) => [...row[0].args, ...row.slice(1)]);
      if (ctorRows.length === 0) return false;
      const ctorTypes = constructorArgTypes(info, ctor, head, typeEnv);
      if (!isVectorExhaustive(ctorRows, [...ctorTypes, ...tailTypes], typeEnv, adts)) return false;
    }
    return true;
  }

  return false;
}

function constructorArgTypes(
  info: TypeDeclInfo,
  ctor: TypeDeclInfo["ctors"][number],
  target: Extract<Ty, { tag: "named" }>,
  typeEnv: TypeEnv,
): Ty[] {
  const vars = new Map(info.params.map((name, i) => [name, target.args[i]] as const));
  return ctor.args.map((arg) => typeFromAst(arg, typeEnv, vars));
}

function mentionsLocalType(t: Ty, allowed: Set<number>): boolean {
  t = prune(t);
  if (t.tag === "fn") {
    return t.params.some((p) => mentionsLocalType(p, allowed)) ||
      mentionsLocalType(t.result, allowed);
  }
  if (t.tag === "tuple") return t.items.some((x) => mentionsLocalType(x, allowed));
  if (t.tag === "named") {
    return !allowed.has(t.id) || t.args.some((x) => mentionsLocalType(x, allowed));
  }
  return false;
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
      unify(expected, NumberTy);
      return;
    case "PString":
      unify(expected, StringTy);
      return;
    case "PBool":
      unify(expected, BoolTy);
      return;
    case "PVoid":
      unify(expected, VoidTy);
      return;
    case "PTuple": {
      const items = pattern.items.map(() => fresh());
      unify(expected, tuple(items));
      pattern.items.forEach((item, i) => inferBindingPattern(item, items[i], env, out, binders));
      return;
    }
    case "PCtor": {
      const scheme = env.get(pattern.name);
      if (!scheme) throw new Error(`unknown constructor ${pattern.name}`);
      const ctor = instantiate(scheme);
      if (ctor.tag === "fn") {
        if (ctor.params.length !== pattern.args.length) {
          throw new Error(`${pattern.name} expects ${ctor.params.length} patterns`);
        }
        unify(expected, ctor.result);
        pattern.args.forEach((item, i) => inferBindingPattern(item, ctor.params[i], env, out, binders));
      } else {
        if (pattern.args.length !== 0) throw new Error(`${pattern.name} does not carry values`);
        unify(expected, ctor);
      }
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

function inferParam(
  param: Param,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  vars: TypeVarScope,
  binders: Set<string>,
): Ty {
  const expected = param.annotation ? typeFromAst(param.annotation, typeEnv, vars) : fresh();
  return inferPattern(param.pattern, expected, env, adts, binders);
}

export function describeEnv(env: Env): string {
  return [...env.entries()].map(([name, scheme]) => `${name}: ${show(scheme.type)}`).join("\n");
}
