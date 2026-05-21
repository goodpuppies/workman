import type { CtorDecl, TypeExpr } from "./ast.ts";

export type Ty =
  | { tag: "var"; id: number; name?: string; instance?: Ty }
  | { tag: "prim"; name: string }
  | { tag: "fn"; params: Ty[]; result: Ty }
  | { tag: "tuple"; items: Ty[] }
  | { tag: "named"; id: number; name: string; args: Ty[] };

export type Scheme = { vars: number[]; type: Ty };
export type Env = Map<string, Scheme>;
export type TypeEnv = Map<string, TypeInfo>;
export type TypeInfo = { id: number; name: string; arity: number };
export type TypeDeclInfo = { type: TypeInfo; name: string; params: string[]; ctors: CtorDecl[] };

let nextVar = 0;
let nextType = 0;

export const prim = (name: string): Ty => ({ tag: "prim", name });
export const fresh = (name?: string): Ty => ({ tag: "var", id: nextVar++, name });
export const fn = (params: Ty[], result: Ty): Ty => ({ tag: "fn", params, result });
export const tuple = (items: Ty[]): Ty => ({ tag: "tuple", items });
export const named = (info: TypeInfo, args: Ty[] = []): Ty => ({
  tag: "named",
  id: info.id,
  name: info.name,
  args,
});
export const freshTypeInfo = (name: string, arity: number): TypeInfo => ({
  id: nextType++,
  name,
  arity,
});

export const NumberTy = prim("Number");
export const BoolTy = prim("Bool");
export const StringTy = prim("String");
export const VoidTy = prim("Void");

export function prune(t: Ty): Ty {
  if (t.tag === "var" && t.instance) {
    t.instance = prune(t.instance);
    return t.instance;
  }
  return t;
}

export function occurs(id: number, t: Ty): boolean {
  t = prune(t);
  if (t.tag === "var") return t.id === id;
  if (t.tag === "fn") return t.params.some((p) => occurs(id, p)) || occurs(id, t.result);
  if (t.tag === "tuple") return t.items.some((x) => occurs(id, x));
  if (t.tag === "named") return t.args.some((x) => occurs(id, x));
  return false;
}

export function unify(a: Ty, b: Ty): void {
  a = prune(a);
  b = prune(b);
  if (a === b) return;
  if (a.tag === "var") {
    if (occurs(a.id, b)) throw new Error(`recursive type ${show(a)} ~ ${show(b)}`);
    a.instance = b;
    return;
  }
  if (b.tag === "var") return unify(b, a);
  if (a.tag !== b.tag) throw new Error(`type mismatch ${show(a)} vs ${show(b)}`);
  if (a.tag === "prim" && b.tag === "prim" && a.name === b.name) return;
  if (a.tag === "fn" && b.tag === "fn" && a.params.length === b.params.length) {
    a.params.forEach((p, i) => unify(p, b.params[i]));
    return unify(a.result, b.result);
  }
  if (a.tag === "tuple" && b.tag === "tuple" && a.items.length === b.items.length) {
    a.items.forEach((x, i) => unify(x, b.items[i]));
    return;
  }
  if (a.tag === "named" && b.tag === "named" && a.id === b.id && a.args.length === b.args.length) {
    a.args.forEach((x, i) => unify(x, b.args[i]));
    return;
  }
  throw new Error(`type mismatch ${show(a)} vs ${show(b)}`);
}

export function ftv(t: Ty, out = new Set<number>()): Set<number> {
  t = prune(t);
  if (t.tag === "var") out.add(t.id);
  else if (t.tag === "fn") {
    t.params.forEach((p) => ftv(p, out));
    ftv(t.result, out);
  } else if (t.tag === "tuple") t.items.forEach((x) => ftv(x, out));
  else if (t.tag === "named") t.args.forEach((x) => ftv(x, out));
  return out;
}

export function ftvEnv(env: Env): Set<number> {
  const out = new Set<number>();
  for (const s of env.values()) {
    const local = ftv(s.type);
    for (const id of local) if (!s.vars.includes(id)) out.add(id);
  }
  return out;
}

export function generalize(env: Env, type: Ty): Scheme {
  const envVars = ftvEnv(env);
  const vars = [...ftv(type)].filter((id) => !envVars.has(id));
  return { vars, type };
}

export function instantiate(scheme: Scheme): Ty {
  const map = new Map<number, Ty>();
  for (const id of scheme.vars) map.set(id, fresh());
  const go = (t: Ty): Ty => {
    t = prune(t);
    if (t.tag === "var") return map.get(t.id) ?? t;
    if (t.tag === "fn") return fn(t.params.map(go), go(t.result));
    if (t.tag === "tuple") return tuple(t.items.map(go));
    if (t.tag === "named") return { ...t, args: t.args.map(go) };
    return t;
  };
  return go(scheme.type);
}

export function typeFromAst(
  expr: TypeExpr,
  typeEnv: TypeEnv,
  vars = new Map<string, Ty>(),
): Ty {
  if (expr.kind === "TVar") return vars.get(expr.name) ?? fresh(expr.name);
  if (expr.kind === "TTuple") return tuple(expr.items.map((x) => typeFromAst(x, typeEnv, vars)));
  if (expr.kind === "TFn") {
    return fn(
      expr.params.map((x) => typeFromAst(x, typeEnv, vars)),
      typeFromAst(expr.result, typeEnv, vars),
    );
  }
  if (expr.args.length === 0 && vars.has(expr.name)) return vars.get(expr.name)!;
  const info = typeEnv.get(expr.name);
  if (!info) throw new Error(`unknown type ${expr.name}`);
  if (info.arity !== expr.args.length) {
    throw new Error(`${expr.name} expects ${info.arity} type arguments`);
  }
  if (expr.args.length === 0 && ["Number", "Bool", "String", "Void"].includes(expr.name)) {
    return prim(expr.name);
  }
  return named(info, expr.args.map((x) => typeFromAst(x, typeEnv, vars)));
}

export function show(t: Ty): string {
  const names = new Map<number, string>();
  let n = 0;
  const nameOf = (id: number) =>
    names.get(id) ?? (names.set(id, `'${String.fromCharCode(97 + n++)}`), names.get(id)!);
  const go = (x: Ty): string => {
    x = prune(x);
    if (x.tag === "var") return x.name ?? nameOf(x.id);
    if (x.tag === "prim") return x.name;
    if (x.tag === "tuple") return `(${x.items.map(go).join(", ")})`;
    if (x.tag === "fn") return `(${x.params.map(go).join(", ")}) => ${go(x.result)}`;
    return x.args.length ? `${x.name}<${x.args.map(go).join(", ")}>` : x.name;
  };
  return go(t);
}

export function baseEnv(): Env {
  const env: Env = new Map();
  const binaryNum = fn([NumberTy, NumberTy], NumberTy);
  for (const op of ["+", "-", "*", "/", "%"]) env.set(op, { vars: [], type: binaryNum });
  for (const op of ["<", "<=", ">", ">="]) {
    env.set(op, { vars: [], type: fn([NumberTy, NumberTy], BoolTy) });
  }
  for (const op of ["==", "!="]) {
    const a = fresh() as Extract<Ty, { tag: "var" }>;
    env.set(op, { vars: [a.id], type: fn([a, a], BoolTy) });
  }
  env.set("&&", { vars: [], type: fn([BoolTy, BoolTy], BoolTy) });
  env.set("||", { vars: [], type: fn([BoolTy, BoolTy], BoolTy) });
  const printable = fresh() as Extract<Ty, { tag: "var" }>;
  env.set("print", { vars: [printable.id], type: fn([printable], VoidTy) });
  return env;
}

export function baseTypeEnv(): TypeEnv {
  return new Map(
    ["Number", "Bool", "String", "Void"].map((name) => [name, freshTypeInfo(name, 0)]),
  );
}
