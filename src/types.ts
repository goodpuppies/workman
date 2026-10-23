import type { AstNode } from "./source.ts";
import type { CtorDecl, Expr, TypeExpr } from "./ast.ts";
import { isQualified, pathOf } from "./ast.ts";
import type { CompilerSemanticId } from "./compiler_semantics.ts";
import type { ValueId } from "./ids.ts";
import { type DiffPath, TypeMismatchError } from "./type_diff.ts";
import { resolveLongType, type StaticEnv, type StrEnv } from "./infer/environment.ts";

export type Ty =
  | {
    tag: "var";
    id: number;
    name?: string;
    instance?: Ty;
    jsConstraint?: (t: Ty) => void;
    gpuConstraint?: (t: Ty) => void;
    equalityConstraint?: (t: Ty) => void;
    /** An overloaded numeric literal or operator: binds only to `Number` or `I32`. */
    numeric?: true;
    /** All field/result obligations on this unresolved nominal receiver. */
    projectionFields?: ProjectionFieldInfo[];
  }
  | {
    tag: "ffi";
    id: number;
    kind: "get" | "call";
    receiver?: Ty;
    path: string[];
    args: Ty[];
    binding?: string;
    node?: Expr["node"];
    instance?: Ty;
    constraints?: Ty[];
  }
  | { tag: "prim"; name: string }
  | { tag: "fn"; params: Ty[]; result: Ty }
  | { tag: "tuple"; items: Ty[] }
  | { tag: "struct"; fields: RecordFieldInfo[] }
  | {
    tag: "named";
    id: number;
    name: string;
    args: Ty[];
    argLabels?: string[];
    foreign?: boolean;
    foreignKey?: string;
    recordFields?: RecordFieldInfo[];
    recordParams?: number[];
    /** Canonical metadata remains available for caller-owned and recursive nominal records. */
    definition?: TypeInfo;
  };

export type Constraint = { kind: "Eq"; left: Ty; right: Ty };
export type IdentifierStatus = "value" | "constructor" | "record-constructor";
export type Scheme = {
  vars: number[];
  type: Ty;
  constraints?: Constraint[];
  status?: IdentifierStatus;
  basis?: boolean;
  provenance?: TypeProvenanceNote[];
  jsImport?: boolean;
  /** A JS import whose type is its manual declaration (`isDeclaredUnsafeImportSpec`). */
  declaredJsImport?: boolean;
  imported?: boolean;
  standardLibrary?: boolean;
  semanticId?: CompilerSemanticId;
  valueId?: ValueId;
  constructorDecl?: CtorDecl;
  node?: AstNode;
  preserveStructuralRows?: boolean;
};
export type TypeProvenanceNote = {
  message: string;
  node?: AstNode;
  span?: AstNode["span"];
};
export type Env = Map<string, Scheme>;
export type TypeEnv = Map<string, TypeInfo>;
export type RecordFieldInfo = { name: string; type: Ty };
/** A nominal field relation, freshened together with its receiver at each instantiation. */
export type ProjectionFieldInfo = RecordFieldInfo & {
  resolve: (receiver: Ty, requirement: ProjectionFieldInfo) => void;
  document?: { filePath: string; source: string };
};
/**
 * Registration that lets a nominal type carry primitive operators.
 *
 * A module registers its declared type as a carrier by exporting `carrier`
 * together with top-level `succeed`, `map`, and `map2`. `succeed`'s result type
 * names the carrier and its parameter locates the payload, so a generic carrier
 * (`Result<a, e>`) reports the payload's argument index while a monomorphic one
 * (`Vec2` over `Number`) reports the fixed payload type instead.
 */
export type CarrierInfo = {
  /** Declaring module, or undefined for the basis carrier reached as a bare value. */
  modulePath?: string;
  payloadIndex?: number;
  payloadType?: Ty;
};
export type TypeInfo = {
  id: number;
  name: string;
  arity: number;
  carrier?: CarrierInfo;
  basis?: boolean;
  basisConstructors?: string[];
  foreign?: boolean;
  foreignKey?: string;
  alias?: Ty;
  aliasParams?: number[];
  recordFields?: RecordFieldInfo[];
  recordParams?: number[];
  argLabels?: string[];
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
const typeRegistries = new WeakMap<TypeEnv, Map<number, TypeInfo>>();

export function registerTypeInfo(typeEnv: TypeEnv, info: TypeInfo): void {
  let registry = typeRegistries.get(typeEnv);
  if (!registry) {
    registry = new Map([...typeEnv.values()].map((existing) => [existing.id, existing]));
    typeRegistries.set(typeEnv, registry);
  }
  registry.set(info.id, info);
}

export function typeInfoById(typeEnv: TypeEnv, id: number): TypeInfo | undefined {
  return typeRegistries.get(typeEnv)?.get(id) ??
    [...typeEnv.values()].find((info) => info.id === id);
}

/** Resolve compiler metadata by its canonical name without implying source-level visibility. */
export function typeInfoByName(typeEnv: TypeEnv, name: string): TypeInfo | undefined {
  return typeEnv.get(name) ??
    [...(typeRegistries.get(typeEnv)?.values() ?? [])].find((info) => info.name === name);
}

export function knownTypeIds(typeEnv: TypeEnv): Set<number> {
  return new Set([
    ...[...typeEnv.values()].map((info) => info.id),
    ...(typeRegistries.get(typeEnv)?.keys() ?? []),
  ]);
}

/** Every type known in this environment, including structurally qualified types. */
export function knownTypeInfos(typeEnv: TypeEnv): TypeInfo[] {
  const infos = new Map<number, TypeInfo>();
  for (const info of typeEnv.values()) infos.set(info.id, info);
  for (const info of typeRegistries.get(typeEnv)?.values() ?? []) infos.set(info.id, info);
  return [...infos.values()];
}

export function cloneTypeEnv(typeEnv: TypeEnv): TypeEnv {
  const cloned = new Map(typeEnv);
  const registry = typeRegistries.get(typeEnv);
  if (registry) typeRegistries.set(cloned, new Map(registry));
  return cloned;
}

export const prim = (name: string): Ty => ({ tag: "prim", name });
export const fresh = (name?: string): Ty => ({ tag: "var", id: nextVar++, name });

/** Numeric variables not yet decided, in creation order; see `defaultNumericVars`. */
let pendingNumeric: Extract<Ty, { tag: "var" }>[] = [];

export const I32_MIN = -2147483648;
export const I32_MAX = 2147483647;

/** Integer literals inside the I32 range may become either numeric type. */
export function isI32Literal(value: number): boolean {
  return Number.isInteger(value) && value >= I32_MIN && value <= I32_MAX;
}

/** A variable that becomes `Number` or `I32`, defaulting to `Number`. */
export function freshNumeric(name?: string): Ty {
  const t = fresh(name) as Extract<Ty, { tag: "var" }>;
  markNumeric(t);
  return t;
}

function markNumeric(t: Extract<Ty, { tag: "var" }>): void {
  if (t.numeric) return;
  t.numeric = true;
  pendingNumeric.push(t);
}

// Keeps the bound-variable evidence of the original operands, so a mismatch is attributed
// to the commitment that introduced the numeric variable.
function unifyAgainstNumber(
  a: Ty,
  b: Ty,
  originalA: Ty,
  originalB: Ty,
  onBind: UnifyBind | undefined,
  path: DiffPath,
  onDeferFfi: DeferFfiConstraint | undefined,
) {
  try {
    unify(a, b, onBind, path, onDeferFfi);
  } catch (error) {
    if (!(error instanceof TypeMismatchError) || error.path !== path) throw error;
    throw typeMismatchError(error.left, error.right, path, originalA, originalB);
  }
}

function isNumericPrim(t: Ty): boolean {
  return t.tag === "prim" && (t.name === "Number" || t.name === "I32");
}

/**
 * Resolve overloaded numeric literals and operators that context left undecided, as SML does
 * at each top-level declaration. Existing WM code therefore keeps its `Number` meaning.
 */
export function defaultNumericVars(): void {
  const pending = pendingNumeric;
  pendingNumeric = [];
  for (const t of pending) {
    const target = prune(t);
    if (target.tag === "var" && target.numeric) unify(target, NumberTy);
  }
}
export const freshFfi = (
  kind: "get" | "call",
  receiver: Ty | undefined,
  path: string[],
  args: Ty[] = [],
  node?: Expr["node"],
  binding?: string,
): Ty => ({
  tag: "ffi",
  id: nextFfi++,
  kind,
  receiver,
  path,
  args,
  node,
  binding,
});
export const fn = (params: Ty[], result: Ty): Ty => ({ tag: "fn", params, result });
export const tuple = (items: Ty[]): Ty => ({ tag: "tuple", items });
export const structural = (fields: RecordFieldInfo[]): Ty => ({ tag: "struct", fields });
export const named = (info: TypeInfo, args: Ty[] = []): Ty => ({
  tag: "named",
  id: info.id,
  name: info.name,
  args,
  argLabels: info.argLabels,
  foreign: info.foreign,
  foreignKey: info.foreignKey,
  recordFields: info.recordFields,
  recordParams: info.recordParams,
  definition: info,
});
export const freshTypeInfo = (name: string, arity: number): TypeInfo => ({
  id: nextType++,
  name,
  arity,
});

export const NumberTy = prim("Number");
export const I32Ty = prim("I32");
export const BoolTy = prim("Bool");
export const CharTy = prim("Char");
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
  if (t.tag === "struct") return t.fields.some((field) => occurs(id, field.type));
  if (t.tag === "named") return t.args.some((x) => occurs(id, x));
  return false;
}

export type UnifyBind = (
  variable: Extract<Ty, { tag: "var" }>,
  target: Ty,
  path: DiffPath,
  targetSide: "left" | "right",
) => void;

export type DeferFfiConstraint = (
  placeholder: Extract<Ty, { tag: "ffi" }>,
  target: Ty,
  path: DiffPath,
  targetSide: "left" | "right",
) => void;

export function unify(
  a: Ty,
  b: Ty,
  onBind?: UnifyBind,
  path: DiffPath = [],
  onDeferFfi?: DeferFfiConstraint,
): void {
  const originalA = a;
  const originalB = b;
  a = prune(a);
  b = prune(b);
  if (a === b) return;
  // A non-numeric type meeting a numeric variable fails exactly as it would against Number,
  // which keeps existing diagnostics; check before binding so the variable stays intact.
  if (a.tag === "var" && a.numeric && b.tag !== "var" && b.tag !== "ffi" && !isNumericPrim(b)) {
    unifyAgainstNumber(NumberTy, b, originalA, originalB, onBind, path, onDeferFfi);
  }
  if (b.tag === "var" && b.numeric && a.tag !== "var" && a.tag !== "ffi" && !isNumericPrim(a)) {
    unifyAgainstNumber(a, NumberTy, originalA, originalB, onBind, path, onDeferFfi);
  }
  if (a.tag === "var") {
    if (occurs(a.id, b)) throw new Error(`recursive type ${show(a)} ~ ${show(b)}`);
    a.instance = b;
    if (b.tag === "var" && a.projectionFields) {
      const existing = b.projectionFields ?? [];
      b.projectionFields = [...existing, ...a.projectionFields];
      for (const field of a.projectionFields) {
        const previous = existing.find((item) => item.name === field.name);
        if (previous) {
          unify(previous.type, field.type, onBind, [
            ...path,
            { kind: "record-field", name: field.name },
          ], onDeferFfi);
        }
      }
    }
    if (a.jsConstraint) {
      if (b.tag === "var") addJsConstraint(b, a.jsConstraint);
      else a.jsConstraint(b);
    }
    if (a.gpuConstraint) {
      if (b.tag === "var") addGpuConstraint(b, a.gpuConstraint);
      else a.gpuConstraint(b);
    }
    if (a.equalityConstraint) {
      if (b.tag === "var") addEqualityConstraint(b, a.equalityConstraint);
      else a.equalityConstraint(b);
    }
    if (a.numeric && b.tag === "var") markNumeric(b);
    if (b.tag !== "var") {
      for (const field of a.projectionFields ?? []) field.resolve(b, field);
    }
    onBind?.(a, b, path, "right");
    return;
  }
  if (b.tag === "var") {
    if (occurs(b.id, a)) throw new Error(`recursive type ${show(b)} ~ ${show(a)}`);
    b.instance = a;
    if (b.jsConstraint) {
      b.jsConstraint(a);
    }
    if (b.gpuConstraint) {
      b.gpuConstraint(a);
    }
    if (b.equalityConstraint) {
      b.equalityConstraint(a);
    }
    for (const field of b.projectionFields ?? []) field.resolve(a, field);
    onBind?.(b, a, path, "left");
    return;
  }
  if (a.tag === "ffi") {
    rememberFfiConstraint(a, b);
    onDeferFfi?.(a, b, path, "right");
    return;
  }
  if (b.tag === "ffi") {
    rememberFfiConstraint(b, a);
    onDeferFfi?.(b, a, path, "left");
    return;
  }
  if (a.tag === "named" && b.tag === "struct") {
    unifyNamedWithStructural(a, b, onBind, path, onDeferFfi);
    return;
  }
  if (a.tag === "struct" && b.tag === "named") {
    unifyNamedWithStructural(b, a, onBind, path, onDeferFfi);
    return;
  }
  if (a.tag !== b.tag) throw typeMismatchError(a, b, path, originalA, originalB);
  if (a.tag === "prim" && b.tag === "prim" && a.name === b.name) return;
  if (a.tag === "fn" && b.tag === "fn" && a.params.length === b.params.length) {
    a.params.forEach((p, i) =>
      unify(p, b.params[i], onBind, [
        ...path,
        { kind: "fn-param", index: i },
      ], onDeferFfi)
    );
    return unify(a.result, b.result, onBind, [...path, { kind: "fn-result" }], onDeferFfi);
  }
  if (a.tag === "tuple" && b.tag === "tuple" && a.items.length === b.items.length) {
    a.items.forEach((x, i) =>
      unify(x, b.items[i], onBind, [...path, { kind: "tuple-item", index: i }], onDeferFfi)
    );
    return;
  }
  if (a.tag === "struct" && b.tag === "struct") {
    unifyStructuralRecords(a, b, onBind, path, onDeferFfi);
    return;
  }
  if (a.tag === "named" && b.tag === "named" && a.id === b.id && a.args.length === b.args.length) {
    a.args.forEach((x, i) =>
      unify(x, b.args[i], onBind, [
        ...path,
        {
          kind: "named-arg",
          index: i,
          label: a.argLabels?.[i] ?? b.argLabels?.[i],
          typeName: a.name,
        },
      ], onDeferFfi)
    );
    return;
  }
  throw typeMismatchError(a, b, path, originalA, originalB);
}

function unifyStructuralRecords(
  left: Extract<Ty, { tag: "struct" }>,
  right: Extract<Ty, { tag: "struct" }>,
  onBind: UnifyBind | undefined,
  path: DiffPath,
  onDeferFfi?: DeferFfiConstraint,
): void {
  for (const field of right.fields) {
    const existing = left.fields.find((item) => item.name === field.name);
    if (!existing) {
      left.fields.push(field);
      continue;
    }
    unify(existing.type, field.type, onBind, [
      ...path,
      { kind: "record-field", name: field.name },
    ], onDeferFfi);
  }
}

function unifyNamedWithStructural(
  namedType: Extract<Ty, { tag: "named" }>,
  structuralType: Extract<Ty, { tag: "struct" }>,
  onBind: UnifyBind | undefined,
  path: DiffPath,
  onDeferFfi?: DeferFfiConstraint,
): void {
  const fields = namedRecordFields(namedType);
  if (!fields) throw typeMismatchError(namedType, structuralType, path, namedType, structuralType);
  for (const required of structuralType.fields) {
    const found = fields.find((field) => field.name === required.name);
    if (!found) throw typeMismatchError(namedType, structuralType, path, namedType, structuralType);
    unify(found.type, required.type, onBind, [
      ...path,
      { kind: "record-field", name: required.name },
    ], onDeferFfi);
  }
}

function typeMismatchError(
  left: Ty,
  right: Ty,
  path: DiffPath,
  originalLeft: Ty,
  originalRight: Ty,
): TypeMismatchError {
  if (originalLeft.tag === "var" && originalLeft.instance) {
    return new TypeMismatchError(left, right, path, originalLeft.id, "right");
  }
  if (originalRight.tag === "var" && originalRight.instance) {
    return new TypeMismatchError(left, right, path, originalRight.id, "left");
  }
  return new TypeMismatchError(left, right, path);
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

export function addGpuConstraint(target: Ty, check: (t: Ty) => void): void {
  const t = prune(target);
  if (t.tag !== "var") {
    check(t);
    return;
  }
  const previous = t.gpuConstraint;
  t.gpuConstraint = previous
    ? (bound) => {
      previous(bound);
      check(bound);
    }
    : check;
}

export function addEqualityConstraint(target: Ty, check: (t: Ty) => void): void {
  const t = prune(target);
  if (t.tag !== "var") {
    check(t);
    return;
  }
  const previous = t.equalityConstraint;
  t.equalityConstraint = previous
    ? (bound) => {
      previous(bound);
      check(bound);
    }
    : check;
}

export function addProjectionField(receiver: Ty, field: ProjectionFieldInfo): void {
  const target = prune(receiver);
  if (target.tag !== "var") {
    field.resolve(target, field);
    return;
  }
  const previous = target.projectionFields?.find((item) => item.name === field.name);
  if (previous) unify(previous.type, field.type);
  (target.projectionFields ??= []).push(field);
  const resolved = prune(target);
  if (resolved.tag !== "var") field.resolve(resolved, field);
}

export function solveFfi(
  ffi: Ty,
  target: Ty,
  checkConstraint: (actual: Ty, required: Ty) => void = unify,
): void {
  const placeholder = prune(ffi);
  if (placeholder.tag !== "ffi") {
    throw new Error(`expected unresolved JS FFI type, got ${show(placeholder)}`);
  }
  for (const constraint of placeholder.constraints ?? []) {
    if (isBroadJsBoundaryConstraint(constraint)) continue;
    checkConstraint(target, constraint);
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

export function quoteType(type: Ty): string {
  return `"${show(type)}"`;
}

export function eq(left: Ty, right: Ty): Constraint {
  return { kind: "Eq", left, right };
}

export function solveConstraints(
  constraints: Constraint[],
  onBind?: UnifyBind,
  onDeferFfi?: DeferFfiConstraint,
): void {
  for (const c of constraints) {
    if (c.kind === "Eq") unify(c.left, c.right, onBind, [], onDeferFfi);
  }
  constraints.length = 0;
}

export function ftv(t: Ty, out = new Set<number>()): Set<number> {
  t = prune(t);
  if (t.tag === "var") {
    if (out.has(t.id)) return out;
    out.add(t.id);
    t.projectionFields?.forEach((field) => ftv(field.type, out));
  } else if (t.tag === "ffi") {
    if (t.receiver) ftv(t.receiver, out);
    t.args.forEach((arg) => ftv(arg, out));
  } else if (t.tag === "fn") {
    t.params.forEach((p) => ftv(p, out));
    ftv(t.result, out);
  } else if (t.tag === "tuple") t.items.forEach((x) => ftv(x, out));
  else if (t.tag === "struct") t.fields.forEach((field) => ftv(field.type, out));
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
  const boundary = jsConstrainedVarIds(type);
  const numeric = numericVarIds(type);
  const vars = [...ftv(type)].filter((id) =>
    !envVars.has(id) && !boundary.has(id) && !numeric.has(id)
  );
  return { vars, type, constraints: [] };
}

/** Numeric variables stay monomorphic until context or defaulting decides them. */
function numericVarIds(type: Ty, acc = new Set<number>(), seen = new Set<Ty>()): Set<number> {
  const t = prune(type);
  if (seen.has(t)) return acc;
  seen.add(t);
  if (t.tag === "var") {
    if (t.numeric) acc.add(t.id);
  } else if (t.tag === "fn") {
    for (const param of t.params) numericVarIds(param, acc, seen);
    numericVarIds(t.result, acc, seen);
  } else if (t.tag === "tuple") {
    for (const item of t.items) numericVarIds(item, acc, seen);
  } else if (t.tag === "struct") {
    for (const field of t.fields) numericVarIds(field.type, acc, seen);
  } else if (t.tag === "named") {
    for (const arg of t.args) numericVarIds(arg, acc, seen);
  }
  return acc;
}

function jsConstrainedVarIds(
  type: Ty,
  acc = new Set<number>(),
  seen = new Set<Ty>(),
): Set<number> {
  const t = prune(type);
  if (t.tag === "var") {
    if (seen.has(t)) return acc;
    seen.add(t);
    if (t.jsConstraint) acc.add(t.id);
    t.projectionFields?.forEach((field) => jsConstrainedVarIds(field.type, acc, seen));
    return acc;
  }
  if (t.tag === "fn") {
    for (const param of t.params) jsConstrainedVarIds(param, acc, seen);
    jsConstrainedVarIds(t.result, acc, seen);
  } else if (t.tag === "tuple") {
    for (const item of t.items) jsConstrainedVarIds(item, acc, seen);
  } else if (t.tag === "struct") {
    for (const field of t.fields) jsConstrainedVarIds(field.type, acc, seen);
  } else if (t.tag === "named") {
    for (const arg of t.args) jsConstrainedVarIds(arg, acc, seen);
  }
  return acc;
}

export function hasProjectionFields(type: Ty, seen = new Set<Ty>()): boolean {
  const t = prune(type);
  if (seen.has(t)) return false;
  seen.add(t);
  if (t.tag === "var") return !!t.projectionFields?.length;
  if (t.tag === "fn") {
    return [...t.params, t.result].some((item) => hasProjectionFields(item, seen));
  }
  if (t.tag === "tuple") return t.items.some((item) => hasProjectionFields(item, seen));
  if (t.tag === "named") return t.args.some((item) => hasProjectionFields(item, seen));
  if (t.tag === "struct") return t.fields.some((field) => hasProjectionFields(field.type, seen));
  return false;
}

export function containsUnsolvedJsBoundary(type: Ty): boolean {
  return jsConstrainedVarIds(type).size > 0;
}

export function instantiate(scheme: Scheme): Ty {
  const map = new Map<number, Ty>();
  for (const id of scheme.vars) map.set(id, fresh());
  const copiedProjections = new Set<number>();
  const go = (t: Ty): Ty => {
    t = prune(t);
    if (t.tag === "var") {
      const mapped = map.get(t.id);
      if (!mapped) return t;
      if (t.jsConstraint) addJsConstraint(mapped, t.jsConstraint);
      if (t.gpuConstraint) addGpuConstraint(mapped, t.gpuConstraint);
      if (t.equalityConstraint) addEqualityConstraint(mapped, t.equalityConstraint);
      if (t.numeric && mapped.tag === "var") markNumeric(mapped);
      if (!copiedProjections.has(t.id)) {
        copiedProjections.add(t.id);
        for (const field of t.projectionFields ?? []) {
          addProjectionField(mapped, { ...field, type: go(field.type) });
        }
      }
      return mapped;
    }
    if (t.tag === "ffi") {
      return t;
    }
    if (t.tag === "fn") return fn(t.params.map(go), go(t.result));
    if (t.tag === "tuple") return tuple(t.items.map(go));
    if (t.tag === "struct") {
      // Structural requirements are open, mutable rows during inference.
      // Repeated uses of one monomorphic receiver must accumulate fields on
      // the same row; polymorphic occurrences still need independent rows.
      if (scheme.preserveStructuralRows && scheme.vars.length === 0) return t;
      return structural(t.fields.map((field) => ({ ...field, type: go(field.type) })));
    }
    if (t.tag === "named") return { ...t, args: t.args.map(go) };
    return t;
  };
  return go(scheme.type);
}

export function substituteTypeVars(template: Ty, subst: Map<number, Ty>): Ty {
  const freshen = new Map<number, Ty>();
  return freshenTypeVars(template, subst, freshen);
}

/** Clone a type graph while sharing one freshening map across every owned occurrence. */
export function freshenTypeVars(
  template: Ty,
  subst: Map<number, Ty>,
  freshen: Map<number, Ty>,
): Ty {
  const go = (t: Ty): Ty => {
    t = prune(t);
    if (t.tag === "var") {
      const bound = subst.get(t.id);
      if (bound) return bound;
      const existing = freshen.get(t.id);
      if (existing) return existing;
      const created = fresh(t.name);
      freshen.set(t.id, created);
      if (t.jsConstraint) addJsConstraint(created, t.jsConstraint);
      if (t.gpuConstraint) addGpuConstraint(created, t.gpuConstraint);
      if (t.equalityConstraint) addEqualityConstraint(created, t.equalityConstraint);
      if (t.numeric) markNumeric(created as Extract<Ty, { tag: "var" }>);
      for (const field of t.projectionFields ?? []) {
        addProjectionField(created, { ...field, type: go(field.type) });
      }
      return created;
    }
    if (t.tag === "ffi") {
      return {
        ...t,
        receiver: t.receiver ? go(t.receiver) : undefined,
        args: t.args.map(go),
        instance: t.instance ? go(t.instance) : undefined,
      };
    }
    if (t.tag === "fn") return fn(t.params.map(go), go(t.result));
    if (t.tag === "tuple") return tuple(t.items.map(go));
    if (t.tag === "struct") {
      return structural(t.fields.map((field) => ({ ...field, type: go(field.type) })));
    }
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

function namedRecordFields(type: Extract<Ty, { tag: "named" }>): RecordFieldInfo[] | undefined {
  if (!type.recordFields) return undefined;
  const subst = new Map<number, Ty>();
  (type.recordParams ?? []).forEach((id, i) => subst.set(id, type.args[i]));
  return type.recordFields.map((field) => ({
    name: field.name,
    type: substituteTypeVars(field.type, subst),
  }));
}

export function typeFromAst(
  expr: TypeExpr,
  typeEnv: TypeEnv,
  vars: TypeVarScope = new Map(),
  options: {
    allowFreeVars?: boolean;
    strEnv?: StrEnv;
    onResolveName?: (
      expression: Extract<TypeExpr, { kind: "TName" }>,
      info: TypeInfo,
      qualifier?: Readonly<{ name: string; environment: StaticEnv }>,
    ) => void;
    onResolveVariable?: (expression: TypeExpr, type: Ty) => void;
    onResolveType?: (expression: TypeExpr, type: Ty) => void;
  } = {},
): Ty {
  const allowFreeVars = options.allowFreeVars ?? true;
  const resolved = (type: Ty): Ty => {
    options.onResolveType?.(expr, type);
    return type;
  };
  const instantiateAlias = (template: Ty, params: number[], args: Ty[]): Ty => {
    const subst = new Map<number, Ty>();
    params.forEach((id, i) => subst.set(id, args[i]));
    return substituteTypeVars(template, subst);
  };

  if (expr.kind === "TVar") {
    const existing = vars.get(expr.name);
    if (existing) {
      options.onResolveVariable?.(expr, existing);
      return resolved(existing);
    }
    if (!allowFreeVars) throw new Error(`unbound type variable ${expr.name}`);
    const created = fresh(expr.name);
    vars.set(expr.name, created);
    options.onResolveVariable?.(expr, created);
    return resolved(created);
  }
  if (expr.kind === "TTuple") {
    return resolved(tuple(expr.items.map((x) => typeFromAst(x, typeEnv, vars, options))));
  }
  if (expr.kind === "TFn") {
    return resolved(fn(
      [callArg(expr.params.map((x) => typeFromAst(x, typeEnv, vars, options)))],
      typeFromAst(expr.result, typeEnv, vars, options),
    ));
  }
  if (expr.args.length === 0 && vars.has(expr.name)) {
    const variable = vars.get(expr.name)!;
    options.onResolveVariable?.(expr, variable);
    return resolved(variable);
  }
  const path = pathOf(expr);
  const qualified = isQualified(path) && options.strEnv
    ? resolveLongType(options.strEnv, path)
    : undefined;
  const info = qualified?.info ?? typeEnv.get(expr.name);
  if (!info) throw new Error(`unknown type ${expr.name}`);
  if (info.arity !== expr.args.length) {
    throw new Error(`${expr.name} expects ${info.arity} type arguments`);
  }
  options.onResolveName?.(
    expr,
    info,
    qualified
      ? Object.freeze({
        name: path.qualifiers[0],
        environment: qualified.root,
      })
      : undefined,
  );
  if (info.alias) {
    const args = expr.args.map((x) => typeFromAst(x, typeEnv, vars, options));
    return resolved(instantiateAlias(info.alias, info.aliasParams ?? [], args));
  }
  if (
    expr.args.length === 0 &&
    ["Number", "I32", "Bool", "Char", "String", "Void"].includes(expr.name)
  ) {
    return resolved(prim(expr.name));
  }
  return resolved(named(info, expr.args.map((x) => typeFromAst(x, typeEnv, vars, options))));
}

export function show(t: Ty): string {
  const names = new Map<number, string>();
  let n = 0;
  let numeric = 0;
  const receivers: Extract<Ty, { tag: "var" }>[] = [];
  const seenReceivers = new Set<number>();
  // Numeric variables (Number or I32) get their own names so the constraint stays visible.
  const numericName = () => numeric++ === 0 ? "'num" : `'num${numeric}`;
  const nameOf = (id: number, isNumeric?: boolean) =>
    names.get(id) ??
      (names.set(id, isNumeric ? numericName() : `'${String.fromCharCode(97 + n++)}`),
        names.get(id)!);
  const functionDomain = (params: Ty[]): string => {
    if (params.length === 0) return "Void";
    if (params.length > 1) return `(${params.map(go).join(", ")})`;
    const param = prune(params[0]);
    const rendered = go(param);
    return param.tag === "fn" ? `(${rendered})` : rendered;
  };
  const go = (x: Ty): string => {
    x = prune(x);
    if (x.tag === "var") {
      if (x.projectionFields?.length && !seenReceivers.has(x.id)) {
        seenReceivers.add(x.id);
        receivers.push(x);
      }
      return x.name ?? nameOf(x.id, x.numeric);
    }
    if (x.tag === "ffi") return `?ffi#${x.id}:${x.binding ?? x.path.join(".")}`;
    if (x.tag === "prim") return x.name;
    if (x.tag === "tuple") return `(${x.items.map(go).join(", ")})`;
    if (x.tag === "fn") return `${functionDomain(x.params)} -> ${go(x.result)}`;
    if (x.tag === "struct") {
      return `{ ${x.fields.map((field) => `${field.name}: ${go(field.type)}`).join(", ")} }`;
    }
    return x.args.length ? `${x.name}<${x.args.map(go).join(", ")}>` : x.name;
  };
  const rendered = go(t);
  const requirements: string[] = [];
  for (const receiver of receivers) {
    const fields = new Set<string>();
    for (const field of receiver.projectionFields ?? []) {
      if (fields.has(field.name)) continue;
      fields.add(field.name);
      requirements.push(`${go(receiver)}.${field.name}: ${go(field.type)}`);
    }
  }
  return requirements.length ? `${rendered} where ${requirements.join(", ")}` : rendered;
}

export { baseAdts, baseEnv, baseTypeEnv } from "./types_basis.ts";
