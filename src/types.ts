import type { AstNode } from "./source.ts";
import type { CtorDecl, Expr, TypeExpr } from "./ast.ts";

export type Ty =
  | { tag: "var"; id: number; name?: string; instance?: Ty; jsConstraint?: (t: Ty) => void }
  | {
    tag: "ffi";
    id: number;
    kind: "get" | "call";
    receiver: Ty;
    path: string[];
    args: Ty[];
    node?: Expr["node"];
    instance?: Ty;
    constraints?: Ty[];
  }
  | { tag: "prim"; name: string }
  | { tag: "fn"; params: Ty[]; result: Ty }
  | { tag: "tuple"; items: Ty[] }
  | {
    tag: "named";
    id: number;
    name: string;
    args: Ty[];
    foreign?: boolean;
    foreignKey?: string;
  };

export type Constraint = { kind: "Eq"; left: Ty; right: Ty };
export type IdentifierStatus = "value" | "constructor";
export type Scheme = {
  vars: number[];
  type: Ty;
  constraints?: Constraint[];
  status?: IdentifierStatus;
  basis?: boolean;
  provenance?: TypeProvenanceNote[];
  jsImport?: boolean;
  imported?: boolean;
  node?: AstNode;
};
export type TypeProvenanceNote = {
  message: string;
  node?: AstNode;
  span?: AstNode["span"];
};
export type Env = Map<string, Scheme>;
export type TypeEnv = Map<string, TypeInfo>;
export type RecordFieldInfo = { name: string; type: Ty };
export type TypeInfo = {
  id: number;
  name: string;
  arity: number;
  basis?: boolean;
  basisConstructors?: string[];
  foreign?: boolean;
  foreignKey?: string;
  alias?: Ty;
  aliasParams?: number[];
  recordFields?: RecordFieldInfo[];
  recordParams?: number[];
};
export type TypeDeclInfo = {
  type: TypeInfo;
  name: string;
  params: string[];
  paramTypeIds?: number[];
  ctors: CtorDecl[];
  ctorTypes?: Ty[][];
};
export type TypeVarScope = Map<string, Ty>;

let nextVar = 0;
let nextFfi = 0;
let nextType = 0;

export const prim = (name: string): Ty => ({ tag: "prim", name });
export const fresh = (name?: string): Ty => ({ tag: "var", id: nextVar++, name });
export const freshFfi = (
  kind: "get" | "call",
  receiver: Ty,
  path: string[],
  args: Ty[] = [],
  node?: Expr["node"],
): Ty => ({
  tag: "ffi",
  id: nextFfi++,
  kind,
  receiver,
  path,
  args,
  node,
});
export const fn = (params: Ty[], result: Ty): Ty => ({ tag: "fn", params, result });
export const tuple = (items: Ty[]): Ty => ({ tag: "tuple", items });
export const named = (info: TypeInfo, args: Ty[] = []): Ty => ({
  tag: "named",
  id: info.id,
  name: info.name,
  args,
  foreign: info.foreign,
  foreignKey: info.foreignKey,
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

function callArg(items: Ty[]): Ty {
  if (items.length === 0) return VoidTy;
  if (items.length === 1) return items[0];
  return tuple(items);
}

export function prune(t: Ty): Ty {
  if (t.tag === "var" && t.instance) {
    t.instance = prune(t.instance);
    return t.instance;
  }
  if (t.tag === "ffi" && t.instance) {
    t.instance = prune(t.instance);
    return t.instance;
  }
  return t;
}

export function occurs(id: number, t: Ty): boolean {
  t = prune(t);
  if (t.tag === "var") return t.id === id;
  if (t.tag === "ffi") {
    // The receiver and arguments of an unresolved member access are call-site provenance,
    // not part of the eventual member result type, so a variable may legitimately be both
    // the receiver of a placeholder and unified with its result (e.g. Result.withDefault
    // over a string method whose default is the receiver itself).
    return t.instance ? occurs(id, t.instance) : false;
  }
  if (t.tag === "fn") return t.params.some((p) => occurs(id, p)) || occurs(id, t.result);
  if (t.tag === "tuple") return t.items.some((x) => occurs(id, x));
  if (t.tag === "named") return t.args.some((x) => occurs(id, x));
  return false;
}

export type UnifyBind = (variable: Extract<Ty, { tag: "var" }>, target: Ty) => void;

export function unify(a: Ty, b: Ty, onBind?: UnifyBind): void {
  a = prune(a);
  b = prune(b);
  if (a === b) return;
  if (a.tag === "var") {
    if (occurs(a.id, b)) throw new Error(`recursive type ${show(a)} ~ ${show(b)}`);
    a.instance = b;
    if (a.jsConstraint) {
      if (b.tag === "var") addJsConstraint(b, a.jsConstraint);
      else a.jsConstraint(b);
    }
    onBind?.(a, b);
    return;
  }
  if (b.tag === "var") return unify(b, a, onBind);
  if (a.tag === "ffi") {
    rememberFfiConstraint(a, b);
    return;
  }
  if (b.tag === "ffi") {
    rememberFfiConstraint(b, a);
    return;
  }
  if (a.tag !== b.tag) throw new Error(typeMismatchMessage(a, b));
  if (a.tag === "prim" && b.tag === "prim" && a.name === b.name) return;
  if (a.tag === "fn" && b.tag === "fn" && a.params.length === b.params.length) {
    a.params.forEach((p, i) => unify(p, b.params[i], onBind));
    return unify(a.result, b.result, onBind);
  }
  if (a.tag === "tuple" && b.tag === "tuple" && a.items.length === b.items.length) {
    a.items.forEach((x, i) => unify(x, b.items[i], onBind));
    return;
  }
  if (a.tag === "named" && b.tag === "named" && a.id === b.id && a.args.length === b.args.length) {
    a.args.forEach((x, i) => unify(x, b.args[i], onBind));
    return;
  }
  throw new Error(typeMismatchMessage(a, b));
}

// A JS boundary violation carries its own explanation; diagnostic wrappers should not
// replace it with a generic type-mismatch message.
export class JsBoundaryError extends Error {}

export function addJsConstraint(target: Ty, check: (t: Ty) => void): void {
  const t = prune(target);
  if (t.tag !== "var") {
    check(t);
    return;
  }
  const previous = t.jsConstraint;
  t.jsConstraint = previous
    ? (bound) => {
      previous(bound);
      check(bound);
    }
    : check;
}

export function solveFfi(ffi: Ty, target: Ty): void {
  const placeholder = prune(ffi);
  if (placeholder.tag !== "ffi") {
    throw new Error(`expected unresolved JS FFI type, got ${show(placeholder)}`);
  }
  for (const constraint of placeholder.constraints ?? []) {
    if (isBroadJsBoundaryConstraint(constraint)) continue;
    unify(target, constraint);
  }
  placeholder.instance = target;
}

function rememberFfiConstraint(ffi: Extract<Ty, { tag: "ffi" }>, target: Ty): void {
  if (isBroadJsBoundaryConstraint(target)) return;
  ffi.constraints ??= [];
  ffi.constraints.push(target);
}

function isBroadJsBoundaryConstraint(type: Ty): boolean {
  const target = prune(type);
  if (isBroadJsBoundaryType(target)) return true;
  if (target.tag !== "named" || target.name !== "Result" || target.args.length !== 2) {
    return false;
  }
  return isBroadJsBoundaryType(target.args[0]);
}

function isBroadJsBoundaryType(type: Ty): boolean {
  const target = prune(type);
  return target.tag === "named" && (target.name === "Js.Object" || target.name === "Js.Value");
}

export function typeMismatchMessage(left: Ty, right: Ty): string {
  return `type mismatch ${quoteType(left)} vs ${quoteType(right)}`;
}

export function quoteType(type: Ty): string {
  return `"${show(type)}"`;
}

export function eq(left: Ty, right: Ty): Constraint {
  return { kind: "Eq", left, right };
}

export function solveConstraints(constraints: Constraint[], onBind?: UnifyBind): void {
  for (const c of constraints) {
    if (c.kind === "Eq") unify(c.left, c.right, onBind);
  }
  constraints.length = 0;
}

export function ftv(t: Ty, out = new Set<number>()): Set<number> {
  t = prune(t);
  if (t.tag === "var") out.add(t.id);
  else if (t.tag === "ffi") {
    ftv(t.receiver, out);
    t.args.forEach((arg) => ftv(arg, out));
  } else if (t.tag === "fn") {
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
  // Variables constrained by a broad Js.Value JS boundary stay monomorphic: the program's
  // ordinary call sites must determine one concrete JS shape for them.
  const boundary = jsConstrainedVarIds(type);
  const vars = [...ftv(type)].filter((id) => !envVars.has(id) && !boundary.has(id));
  return { vars, type, constraints: [] };
}

function jsConstrainedVarIds(type: Ty, acc = new Set<number>()): Set<number> {
  const t = prune(type);
  if (t.tag === "var") {
    if (t.jsConstraint) acc.add(t.id);
    return acc;
  }
  if (t.tag === "fn") {
    for (const param of t.params) jsConstrainedVarIds(param, acc);
    jsConstrainedVarIds(t.result, acc);
  } else if (t.tag === "tuple") {
    for (const item of t.items) jsConstrainedVarIds(item, acc);
  } else if (t.tag === "named") {
    for (const arg of t.args) jsConstrainedVarIds(arg, acc);
  }
  return acc;
}

export function containsUnsolvedJsBoundary(type: Ty): boolean {
  return jsConstrainedVarIds(type).size > 0;
}

export function instantiate(scheme: Scheme): Ty {
  const map = new Map<number, Ty>();
  for (const id of scheme.vars) map.set(id, fresh());
  const go = (t: Ty): Ty => {
    t = prune(t);
    if (t.tag === "var") {
      const mapped = map.get(t.id);
      if (!mapped) return t;
      if (t.jsConstraint) addJsConstraint(mapped, t.jsConstraint);
      return mapped;
    }
    if (t.tag === "ffi") {
      return t;
    }
    if (t.tag === "fn") return fn(t.params.map(go), go(t.result));
    if (t.tag === "tuple") return tuple(t.items.map(go));
    if (t.tag === "named") return { ...t, args: t.args.map(go) };
    return t;
  };
  return go(scheme.type);
}

export function substituteTypeVars(template: Ty, subst: Map<number, Ty>): Ty {
  const freshen = new Map<number, Ty>();
  const go = (t: Ty): Ty => {
    t = prune(t);
    if (t.tag === "var") {
      const bound = subst.get(t.id);
      if (bound) return bound;
      const existing = freshen.get(t.id);
      if (existing) return existing;
      const created = fresh(t.name);
      freshen.set(t.id, created);
      return created;
    }
    if (t.tag === "ffi") {
      return {
        ...t,
        receiver: go(t.receiver),
        args: t.args.map(go),
        instance: t.instance ? go(t.instance) : undefined,
      };
    }
    if (t.tag === "fn") return fn(t.params.map(go), go(t.result));
    if (t.tag === "tuple") return tuple(t.items.map(go));
    if (t.tag === "named") return { ...t, args: t.args.map(go) };
    return t;
  };
  return go(template);
}

export function instantiateRecordFields(info: TypeInfo, args: Ty[]): RecordFieldInfo[] {
  if (!info.recordFields) throw new Error(`${info.name} is not a record type`);
  const subst = new Map<number, Ty>();
  (info.recordParams ?? []).forEach((id, i) => subst.set(id, args[i]));
  return info.recordFields.map((field) => ({
    name: field.name,
    type: substituteTypeVars(field.type, subst),
  }));
}

export function typeFromAst(
  expr: TypeExpr,
  typeEnv: TypeEnv,
  vars: TypeVarScope = new Map(),
  options: { allowFreeVars?: boolean } = {},
): Ty {
  const allowFreeVars = options.allowFreeVars ?? true;
  const instantiateAlias = (template: Ty, params: number[], args: Ty[]): Ty => {
    const subst = new Map<number, Ty>();
    params.forEach((id, i) => subst.set(id, args[i]));
    return substituteTypeVars(template, subst);
  };

  if (expr.kind === "TVar") {
    const existing = vars.get(expr.name);
    if (existing) return existing;
    if (!allowFreeVars) throw new Error(`unbound type variable ${expr.name}`);
    const created = fresh(expr.name);
    vars.set(expr.name, created);
    return created;
  }
  if (expr.kind === "TTuple") {
    return tuple(expr.items.map((x) => typeFromAst(x, typeEnv, vars, options)));
  }
  if (expr.kind === "TFn") {
    return fn(
      [callArg(expr.params.map((x) => typeFromAst(x, typeEnv, vars, options)))],
      typeFromAst(expr.result, typeEnv, vars, options),
    );
  }
  if (expr.args.length === 0 && vars.has(expr.name)) return vars.get(expr.name)!;
  const info = typeEnv.get(expr.name);
  if (!info) throw new Error(`unknown type ${expr.name}`);
  if (info.arity !== expr.args.length) {
    throw new Error(`${expr.name} expects ${info.arity} type arguments`);
  }
  if (info.alias) {
    const args = expr.args.map((x) => typeFromAst(x, typeEnv, vars, options));
    return instantiateAlias(info.alias, info.aliasParams ?? [], args);
  }
  if (expr.args.length === 0 && ["Number", "Bool", "String", "Void"].includes(expr.name)) {
    return prim(expr.name);
  }
  return named(info, expr.args.map((x) => typeFromAst(x, typeEnv, vars, options)));
}

export function show(t: Ty): string {
  const names = new Map<number, string>();
  let n = 0;
  const nameOf = (id: number) =>
    names.get(id) ?? (names.set(id, `'${String.fromCharCode(97 + n++)}`), names.get(id)!);
  const go = (x: Ty): string => {
    x = prune(x);
    if (x.tag === "var") return x.name ?? nameOf(x.id);
    if (x.tag === "ffi") return `?ffi#${x.id}:${x.path.join(".")}`;
    if (x.tag === "prim") return x.name;
    if (x.tag === "tuple") return `(${x.items.map(go).join(", ")})`;
    if (x.tag === "fn") return `(${x.params.map(go).join(", ")}) => ${go(x.result)}`;
    return x.args.length ? `${x.name}<${x.args.map(go).join(", ")}>` : x.name;
  };
  return go(t);
}

export { baseAdts, baseEnv, baseTypeEnv } from "./types_basis.ts";
