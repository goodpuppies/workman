import type { Binding, Decl, Expr, ImportClause, Module, Param } from "./ast.ts";
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
  VoidTy,
} from "./types.ts";
import { checkExhaustive, isVectorExhaustive, mentionsLocalType } from "./infer/exhaustiveness.ts";
import {
  inferBindingPattern,
  inferPattern,
  patternBinders,
  showPattern,
} from "./infer/patterns.ts";
import { callArg, constrain } from "./infer/shared.ts";

export type InferResult = {
  env: Env;
  exports: Env;
  typeEnv: TypeEnv;
  typeExports: TypeEnv;
  types: Map<Expr, Ty>;
  adts: Map<number, TypeDeclInfo>;
  warnings: string[];
};

export type TypeSnapshot = { type: string; vars: number };
export type InferStep = { declIndex: number; env: Map<string, TypeSnapshot> };

export function inferModule(module: Module, imports = new Map<string, InferResult>()): InferResult {
  return inferModuleWithSteps(module, imports).result;
}

export function inferModuleWithSteps(
  module: Module,
  imports = new Map<string, InferResult>(),
): { result: InferResult; steps: InferStep[] } {
  const env = baseEnv();
  const exports: Env = new Map();
  const typeEnv = baseTypeEnv();
  const typeExports: TypeEnv = new Map();
  const adts = new Map<number, TypeDeclInfo>();
  const types = new Map<Expr, Ty>();
  const warnings: string[] = [];
  const steps: InferStep[] = [];
  for (const [declIndex, decl] of module.decls.entries()) {
    if (decl.kind === "ImportDecl") {
      const imported = imports.get(decl.path);
      if (!imported) throw new Error(`unknown import ${decl.path}`);
      addImport(env, typeEnv, decl.clause, imported);
      addAdts(adts, imported.adts);
      continue;
    }
    inferDecl(decl, env, exports, typeEnv, typeExports, adts, types, warnings);
    steps.push({ declIndex, env: snapshotEnv(env) });
  }
  return { result: { env, exports, typeEnv, typeExports, types, adts, warnings }, steps };
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
  warnings: string[],
) {
  if (decl.kind === "ImportDecl") return;
  if (decl.kind === "TypeDecl") {
    if (typeEnv.has(decl.name)) throw new Error(`duplicate type declaration ${decl.name}`);
    rejectDuplicates(decl.params, "type parameter");
    const info = freshTypeInfo(decl.name, decl.params.length);
    typeEnv.set(decl.name, info);
    if (decl.exported) typeExports.set(decl.name, info);
    if (decl.alias) {
      const vars = new Map(decl.params.map((p) => [p, fresh(p)] as const));
      info.alias = typeFromAst(decl.alias, typeEnv, vars);
      info.aliasParams = decl.params.map((p) => {
        const v = prune(vars.get(p)!);
        if (v.tag !== "var") throw new Error("invalid type alias parameter");
        return v.id;
      });
      return;
    }
    rejectDuplicates(decl.ctors.map((c) => c.name), "constructor");
    adts.set(info.id, { ...decl, type: info });
    const vars = new Map(decl.params.map((p) => [p, fresh(p)] as const));
    const result = named(info, decl.params.map((p) => vars.get(p)!));
    for (const c of decl.ctors) {
      const args = c.args.map((x) => typeFromAst(x, typeEnv, vars));
      const t = args.length === 0 ? result : fn([callArg(args)], result);
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
    inferred.forEach((result, i) => {
      if (result.refutable) {
        warnings.push(
          `refutable let pattern may fail at runtime: ${showPattern(decl.bindings[i].pattern)}`,
        );
      }
      for (const [name, type] of result.bound) {
        const scheme = generalize(base, type);
        env.set(name, scheme);
        if (decl.exported) exports.set(name, scheme);
      }
    });
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
  decl.bindings.forEach((b, i) => {
    constrain(placeholders[i], inferExpr(b.value, env, typeEnv, adts, types));
    if (b.annotation) constrain(placeholders[i], typeFromAst(b.annotation, typeEnv));
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
): { bound: Map<string, Ty>; refutable: boolean } {
  const t = inferExpr(b.value, env, typeEnv, adts, types);
  if (b.annotation) constrain(t, typeFromAst(b.annotation, typeEnv));
  const bound = new Map<string, Ty>();
  inferBindingPattern(b.pattern, t, env, bound);
  const refutable = !isVectorExhaustive([[b.pattern]], [t], typeEnv, adts);
  return { bound, refutable };
}

function inferExpr(
  expr: Expr,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  warnings: string[] = [],
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
      t = tuple(expr.items.map((x) => inferExpr(x, env, typeEnv, adts, types, warnings)));
      break;
    case "Lambda": {
      const local = new Map(env);
      const annotationVars: TypeVarScope = new Map();
      const binders = new Set<string>();
      const params = expr.params.map((p) =>
        inferParam(p, local, typeEnv, adts, annotationVars, binders)
      );
      t = fn([callArg(params)], inferExpr(expr.body, local, typeEnv, adts, types, warnings));
      break;
    }
    case "Call": {
      const result = fresh();
      const arg = callArg(expr.args.map((a) => inferExpr(a, env, typeEnv, adts, types, warnings)));
      constrain(
        inferExpr(expr.callee, env, typeEnv, adts, types, warnings),
        fn([arg], result),
      );
      t = result;
      break;
    }
    case "If":
      constrain(inferExpr(expr.cond, env, typeEnv, adts, types, warnings), BoolTy);
      t = inferExpr(expr.thenExpr, env, typeEnv, adts, types, warnings);
      constrain(t, inferExpr(expr.elseExpr, env, typeEnv, adts, types, warnings));
      break;
    case "Match": {
      const valueType = inferExpr(expr.value, env, typeEnv, adts, types, warnings);
      t = fresh();
      for (const arm of expr.arms) {
        const local = new Map(env);
        inferPattern(arm.pattern, valueType, local, adts);
        constrain(t, inferExpr(arm.body, local, typeEnv, adts, types, warnings));
      }
      checkExhaustive(expr.arms.map((arm) => arm.pattern), valueType, typeEnv, adts);
      break;
    }
    case "Block": {
      const local = new Map(env);
      const localTypes = new Map(typeEnv);
      const outerTypeIds = new Set([...typeEnv.values()].map((info) => info.id));
      expr.items.forEach((s) =>
        isDecl(s)
          ? inferDecl(s, local, new Map(), localTypes, new Map(), adts, types, warnings)
          : inferExpr(s, local, localTypes, adts, types, warnings)
      );
      t = inferExpr(expr.result, local, localTypes, adts, types, warnings);
      if (mentionsLocalType(t, outerTypeIds)) throw new Error("local type escapes scope");
      break;
    }
    case "Binary": {
      const result = fresh();
      const op: Scheme | undefined = env.get(expr.op);
      if (!op) throw new Error(`unknown operator ${expr.op}`);
      constrain(
        instantiate(op),
        fn(
          [tuple([
            inferExpr(expr.left, env, typeEnv, adts, types, warnings),
            inferExpr(expr.right, env, typeEnv, adts, types, warnings),
          ])],
          result,
        ),
      );
      t = result;
      break;
    }
    case "Unary":
      if (expr.op === "-") {
        constrain(inferExpr(expr.value, env, typeEnv, adts, types, warnings), NumberTy);
        t = NumberTy;
      } else {
        constrain(inferExpr(expr.value, env, typeEnv, adts, types, warnings), BoolTy);
        t = BoolTy;
      }
      break;
  }
  types.set(expr, t);
  return t;
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

function snapshotEnv(env: Env): Map<string, TypeSnapshot> {
  return new Map(
    [...env.entries()].map(([name, scheme]) => [
      name,
      { type: show(scheme.type), vars: scheme.vars.length },
    ]),
  );
}
