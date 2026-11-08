import {
  absorbLinks,
  chainEnd,
  held,
  isTainted,
  joinTypeTaints,
  keepHeld,
  openCallbacks,
  openDeps,
  openPosition,
  rebind,
  taintedType,
} from "./taint.ts";
import { diagnosticError } from "./diagnostic_model.ts";
import {
  exactInteger,
  INTEGER_LITERAL_TYPES,
  type NumericType,
  numericType,
  OPERATOR_NUMERIC_TYPES,
} from "./numeric.ts";
import type { AstNode } from "./source.ts";
import type { CtorDecl, Expr, TypeExpr } from "./ast.ts";
import { isQualified, pathOf } from "./ast.ts";
import type { CompilerSemanticId } from "./compiler_semantics.ts";
import type { ValueId } from "./ids.ts";
import { type DiffPath, TypeMismatchError } from "./type_diff.ts";
import { resolveLongType, type StaticEnv, type StrEnv } from "./infer/environment.ts";

export type Ty =
  & {
    /** The `!` bit. */
    tainted?: boolean;
    /** Open positions this one takes its `!` from. Only variables and views ever hold links. */
    deps?: Ty[];
    /** A link refers to this variable, so instantiation must keep it as a position. */
    linked?: boolean;
  }
  & (
    | {
      tag: "var";
      id: number;
      name?: string;
      instance?: Ty;
      jsConstraint?: (t: Ty) => void;
      gpuConstraint?: (t: Ty) => void;
      equalityConstraint?: (t: Ty) => void;
      /** Finite admissible types and literal range obligations; never generalized. */
      numeric?: NumericConstraint;
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
    | { tag: "view"; value: Ty }
    | { tag: "prim"; name: string }
    | { tag: "fn"; params: Ty[]; result: Ty }
    | {
      tag: "tuple";
      items: Ty[];
    }
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
    }
  );

export type Constraint = { kind: "Eq"; left: Ty; right: Ty };
export type IdentifierStatus = "value" | "constructor" | "record-constructor";
export type Scheme = {
  closed?: boolean;
  vars: number[];
  /** Linked variables freshened per use although HM does not quantify them. */
  cells?: Set<number>;
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
  /** Type arguments a reference must write; the rest have a default in the foreign declaration. */
  requiredArity?: number;
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
const sharedTypeRegistries = new WeakSet<Map<number, TypeInfo>>();

export function registerTypeInfo(typeEnv: TypeEnv, info: TypeInfo): void {
  let registry = typeRegistries.get(typeEnv);
  if (registry?.get(info.id) === info) return;
  if (!registry) {
    registry = new Map([...typeEnv.values()].map((existing) => [existing.id, existing]));
    typeRegistries.set(typeEnv, registry);
  } else if (sharedTypeRegistries.has(registry)) {
    registry = new Map(registry);
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
  if (registry) {
    // Most lexical scopes only read nominal metadata. Detach on the first registration
    // in either environment, preserving the isolation of the previous eager copy.
    sharedTypeRegistries.add(registry);
    typeRegistries.set(cloned, registry);
  }
  return cloned;
}

export const prim = (name: string): Ty => ({ tag: "prim", name, tainted: undefined });
export const fresh = (name?: string): Ty => ({
  tag: "var",
  id: nextVar++,
  name,
  instance: undefined,
  tainted: undefined,
  deps: undefined,
  linked: undefined,
});

export type NumericConstraint = Readonly<{
  candidates: readonly NumericType[];
  literals: readonly { text: string; node?: Expr["node"] }[];
}>;

/** Numeric variables belong to one synchronous module-inference scope. */
let pendingNumeric: Extract<Ty, { tag: "var" }>[] = [];

export function withNumericScope<T>(action: () => T): T {
  const previous = pendingNumeric;
  pendingNumeric = [];
  try {
    return action();
  } finally {
    pendingNumeric = previous;
  }
}

export const operatorNumericConstraint = (): NumericConstraint => ({
  candidates: OPERATOR_NUMERIC_TYPES,
  literals: [],
});

/** Operators retain their implemented Number/I32 domain in the first literal slice. */
export function freshNumeric(name?: string): Ty {
  const t = fresh(name) as Extract<Ty, { tag: "var" }>;
  markNumeric(t, operatorNumericConstraint());
  return t;
}

export function freshIntegerLiteral(
  literal: { value: number; exact?: string; node?: Expr["node"] },
  negated = false,
): Ty {
  const text = literal.exact ?? String(literal.value);
  const signed = negated ? (text.startsWith("-") ? text.slice(1) : "-" + text) : text;
  const t = fresh() as Extract<Ty, { tag: "var" }>;
  markNumeric(t, {
    candidates: INTEGER_LITERAL_TYPES,
    literals: [{ text: signed, node: literal.node }],
  });
  return t;
}

function markNumeric(t: Extract<Ty, { tag: "var" }>, constraint: NumericConstraint): void {
  if (t.numeric === constraint) return;
  if (t.numeric) {
    const candidates = t.numeric.candidates.filter((candidate) =>
      constraint.candidates.includes(candidate)
    );
    if (!candidates.length) throw new Error("incompatible numeric overload constraints");
    t.numeric = { candidates, literals: [...t.numeric.literals, ...constraint.literals] };
  } else {
    t.numeric = constraint;
    pendingNumeric.push(t);
  }
}

function checkNumeric(constraint: NumericConstraint, type: Ty): boolean {
  const selected = numericType(type);
  if (!selected || !constraint.candidates.includes(selected)) return false;
  if (selected.bits !== undefined) {
    const width = BigInt(selected.bits);
    const min = selected.signed ? -(1n << (width - 1n)) : 0n;
    const max = selected.signed ? (1n << (width - 1n)) - 1n : (1n << width) - 1n;
    for (const literal of constraint.literals) {
      const value = exactInteger(literal.text);
      if (value < min || value > max) {
        throw diagnosticError(
          new Error(
            `integer literal ${literal.text} is out of range for ${selected.name} (${min} through ${max})`,
          ),
          literal.node,
        );
      }
    }
  }
  return true;
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
export const fn = (params: Ty[], result: Ty): Ty => ({
  tag: "fn",
  params,
  result,
  tainted: undefined,
});
export const tuple = (items: Ty[]): Ty => ({ tag: "tuple", items, tainted: undefined });
export const structural = (fields: RecordFieldInfo[]): Ty => ({
  tag: "struct",
  fields,
  tainted: undefined,
});
export const named = (info: TypeInfo, args: Ty[] = []): Ty => ({
  tag: "named",
  tainted: undefined,
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

export const NumberTy = Object.freeze(prim("Number"));
export const I32Ty = Object.freeze(prim("I32"));
export const BoolTy = Object.freeze(prim("Bool"));
export const CharTy = Object.freeze(prim("Char"));
export const StringTy = Object.freeze(prim("String"));
export const VoidTy = Object.freeze(prim("Void"));

function callArg(items: Ty[]): Ty {
  if (items.length === 0) return VoidTy;
  if (items.length === 1) return items[0];
  return tuple(items);
}

/** A result variable already holding its first branch, as `match` gets from its first arm. */
export function holdResult(type: Ty): Ty {
  if (type.tag === "var" || type.tag === "view" || type.tag === "ffi") return type;
  const result = fresh() as Extract<Ty, { tag: "var" }>;
  result.instance = type;
  return result;
}

export function prune(t: Ty): Exclude<Ty, { tag: "view" }> {
  let hops = 0;
  const start = t;
  while (true) {
    if (t.tag === "view") t = t.value;
    else if ((t.tag === "var" || t.tag === "ffi") && t.instance) {
      t = t.instance;
      hops++;
    } else break;
  }
  // Compression keeps the last variable: a join replaces what that one variable holds, and every
  // variable unified with it must see the replacement. Two hops is already as short as that gets.
  if (hops > 2) compress(start);
  return t;
}

function compress(t: Ty): void {
  while ((t.tag === "var" || t.tag === "ffi") && t.instance) {
    const following: Ty = t.instance;
    if ((following.tag !== "var" && following.tag !== "ffi") || held(following)) return;
    const after = following.instance;
    if (!after || (after.tag !== "var" && after.tag !== "ffi")) return;
    t.instance = after;
    t = after;
  }
}

export function occurs(id: number, t: Ty): boolean {
  t = prune(t);
  if (t.tag === "var") return t.id === id;
  if (t.tag === "ffi") {
    // The receiver and arguments of an unresolved member access are call-site provenance,
    // not part of the eventual member result type, so a variable may legitimately be both
    // the receiver of a placeholder and unified with its result (e.g. Result.getOr
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

/** Bind to the last variable on the way to the resolved type, so unified variables stay shared. */
function bindingTarget(original: Ty, resolved: Ty): Ty {
  if (resolved.tag === "var" || resolved.tag === "ffi") {
    for (let c = original; c !== resolved;) {
      if (c.tag === "view" || held(c)) return original;
      c = (c as Extract<Ty, { tag: "var" }>).instance!;
    }
    return resolved;
  }
  for (let c = original; c !== resolved;) {
    if (c.tag === "view") return original;
    const following: Ty = (c as Extract<Ty, { tag: "var" }>).instance!;
    if (following === resolved) return c;
    if (held(c)) return original;
    c = following;
  }
  return resolved;
}

export function unify(
  a: Ty,
  b: Ty,
  onBind?: UnifyBind,
  path: DiffPath = [],
  onDeferFfi?: DeferFfiConstraint,
): Ty | undefined {
  const marks = joinTypeTaints(a, b);
  const originalA = a;
  const originalB = b;
  a = prune(a);
  b = prune(b);
  if (a === b) {
    if (originalA !== originalB && (a.tag === "var" || a.tag === "ffi")) {
      absorbLinks(a, originalA, originalB);
    }
    return;
  }
  // A non-numeric type meeting a numeric variable fails exactly as it would against Number,
  // which keeps existing diagnostics; check before binding so the variable stays intact.
  if (
    a.tag === "var" && a.numeric && b.tag !== "var" && b.tag !== "ffi" &&
    !checkNumeric(a.numeric, b)
  ) {
    unifyAgainstNumber(NumberTy, b, originalA, originalB, onBind, path, onDeferFfi);
  }
  if (
    b.tag === "var" && b.numeric && a.tag !== "var" && a.tag !== "ffi" &&
    !checkNumeric(b.numeric, a)
  ) {
    unifyAgainstNumber(a, NumberTy, originalA, originalB, onBind, path, onDeferFfi);
  }
  if (a.tag === "var") {
    if (occurs(a.id, b)) throw new Error(`recursive type ${show(a)} ~ ${show(b)}`);
    if (a.numeric && b.tag === "var") markNumeric(b, a.numeric);
    a.instance = bindingTarget(originalB, b);
    if (a.linked && b.tag === "var") b.linked = true;
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
    if (b.tag !== "var") {
      for (const field of a.projectionFields ?? []) field.resolve(b, field);
    }
    onBind?.(a, b, path, "right");
    return;
  }
  if (b.tag === "var") {
    if (occurs(b.id, a)) throw new Error(`recursive type ${show(b)} ~ ${show(a)}`);
    b.instance = bindingTarget(originalA, a);
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
  // Two equal shapes may still differ in `!`. Their join replaces whatever holds them.
  const outerDiffers = marks === 1 || marks === 2;
  let joined: Ty | undefined;
  if (a.tag === "prim" && b.tag === "prim" && a.name === b.name) {
    if (outerDiffers) joined = taintedType(marks === 1 ? a : b);
  } else if (a.tag === "fn" && b.tag === "fn" && a.params.length === b.params.length) {
    let params: Ty[] | undefined;
    for (let i = 0; i < a.params.length; i++) {
      const inner = unify(a.params[i], b.params[i], onBind, [
        ...path,
        { kind: "fn-param", index: i },
      ], onDeferFfi);
      if (inner) (params ??= [...a.params])[i] = keepHeld(a.params[i], b.params[i], inner);
    }
    const inner = unify(a.result, b.result, onBind, [...path, { kind: "fn-result" }], onDeferFfi);
    if (params || inner || outerDiffers) {
      joined = {
        ...a,
        params: params ?? a.params,
        result: inner ? keepHeld(a.result, b.result, inner) : a.result,
      };
      if (marks) joined.tainted = true;
    }
  } else if (a.tag === "tuple" && b.tag === "tuple" && a.items.length === b.items.length) {
    let items: Ty[] | undefined;
    for (let i = 0; i < a.items.length; i++) {
      const inner = unify(a.items[i], b.items[i], onBind, [
        ...path,
        { kind: "tuple-item", index: i },
      ], onDeferFfi);
      if (inner) (items ??= [...a.items])[i] = keepHeld(a.items[i], b.items[i], inner);
    }
    if (items || outerDiffers) {
      joined = { ...a, items: items ?? a.items };
      if (marks) joined.tainted = true;
    }
  } else if (a.tag === "struct" && b.tag === "struct") {
    unifyStructuralRecords(a, b, onBind, path, onDeferFfi);
    return;
  } else if (
    a.tag === "named" && b.tag === "named" && a.id === b.id && a.args.length === b.args.length
  ) {
    let args: Ty[] | undefined;
    for (let i = 0; i < a.args.length; i++) {
      const inner = unify(a.args[i], b.args[i], onBind, [
        ...path,
        {
          kind: "named-arg",
          index: i,
          label: a.argLabels?.[i] ?? b.argLabels?.[i],
          typeName: a.name,
        },
      ], onDeferFfi);
      if (inner) (args ??= [...a.args])[i] = keepHeld(a.args[i], b.args[i], inner);
    }
    if (args || outerDiffers) {
      joined = { ...a, args: args ?? a.args };
      if (marks) joined.tainted = true;
    }
  } else throw typeMismatchError(a, b, path, originalA, originalB);
  if (joined) {
    rebind(originalA, joined);
    rebind(originalB, joined);
  }
  return joined;
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
  while (originalLeft.tag === "view") {
    originalLeft = originalLeft.value;
  }
  while (originalRight.tag === "view") {
    originalRight = originalRight.value;
  }
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
  joinTypeTaints(placeholder, target);
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

export function ftv(t: Ty, out = new Set<number>(), cells: Set<number> = out): Set<number> {
  if (t.tag === "var" || t.tag === "view") {
    const resolved = prune(t);
    // prune leaves only held variables on the chain, so this walk is at most a hop or two.
    for (let c: Ty = t; c !== resolved;) {
      if (c.tag === "var" && c.linked) cells.add(c.id);
      c = c.tag === "view" ? c.value : (c as Extract<Ty, { tag: "var" }>).instance!;
    }
    t = resolved;
  }
  if (t.tag === "var") {
    if (out.has(t.id)) return out;
    out.add(t.id);
    t.projectionFields?.forEach((field) => ftv(field.type, out, cells));
  } else if (t.tag === "ffi") {
    if (t.receiver) ftv(t.receiver, out, cells);
    t.args.forEach((arg) => ftv(arg, out, cells));
  } else if (t.tag === "fn") {
    t.params.forEach((p) => ftv(p, out, cells));
    ftv(t.result, out, cells);
  } else if (t.tag === "tuple") t.items.forEach((x) => ftv(x, out, cells));
  else if (t.tag === "struct") t.fields.forEach((field) => ftv(field.type, out, cells));
  else if (t.tag === "named") t.args.forEach((x) => ftv(x, out, cells));
  return out;
}

export function ftvEnv(env: Env): Set<number> {
  const out = new Set<number>();
  for (const s of env.values()) {
    if (s.closed) continue;
    let open = false;
    for (const id of ftv(s.type)) {
      if (!s.vars.includes(id) && !s.cells?.has(id)) {
        out.add(id);
        open = true;
      }
    }
    // A type with no free variables can never gain one, so it never needs walking again.
    if (!open) s.closed = true;
  }
  return out;
}

export function generalize(env: Env, type: Ty): Scheme {
  const envVars = ftvEnv(env);
  const boundary = jsConstrainedVarIds(type);
  const numeric = numericVarIds(type);
  const found = new Set<number>();
  const held = new Set<number>();
  const vars = [...ftv(type, found, held)].filter((id) =>
    !envVars.has(id) && !boundary.has(id) && !numeric.has(id)
  );
  linkedCells(type, held);
  // A numeric variable stays monomorphic until defaulted, but its `!` still belongs to each use.
  for (const id of numeric) if (!envVars.has(id)) held.add(id);
  let cells: Set<number> | undefined;
  for (const id of held) if (!envVars.has(id)) (cells ??= new Set()).add(id);
  return { vars, cells, type, constraints: [] };
}

/**
 * Bound variables a type's `!` links reach. `ftv` follows the shape only, and a cell left out of a
 * scheme is shared by every instance, so a caller's `!` would never reach what it holds.
 */
function linkedCells(type: Ty, cells: Set<number>, seen = new Set<Ty>()): void {
  if (type.tag === "prim" || seen.has(type)) return;
  seen.add(type);
  const visit = (item: Ty) => linkedCells(item, cells, seen);
  if (type.tag === "view" || type.tag === "var" || type.tag === "ffi") {
    type.deps?.forEach(visit);
    if (type.tag === "view") visit(type.value);
    else if (type.instance) {
      if (type.tag === "var" && type.linked) cells.add(type.id);
      visit(type.instance);
    }
  } else if (type.tag === "fn") {
    type.params.forEach(visit);
    visit(type.result);
  } else if (type.tag === "tuple") type.items.forEach(visit);
  else if (type.tag === "named") type.args.forEach(visit);
  else if (type.tag === "struct") type.fields.forEach((field) => visit(field.type));
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
  const variables = new Map(scheme.vars.map((id) => [id, fresh()]));
  return copyType(scheme.type, variables, {
    preserveRows: scheme.preserveStructuralRows === true && scheme.vars.length === 0,
    cells: scheme.cells,
  });
}

export function substituteTypeVars(template: Ty, subst: Map<number, Ty>): Ty {
  return freshenTypeVars(template, subst, new Map());
}

/** Clone value types and their symbolic summaries with ordinary variable substitution. */
export function freshenTypeVars(
  template: Ty,
  subst: Map<number, Ty>,
  freshen: Map<number, Ty>,
): Ty {
  return copyType(template, freshen, { subst, freshen: true });
}

function copyType(
  template: Ty,
  variables: Map<number, Ty>,
  options: {
    preserveRows?: boolean;
    subst?: Map<number, Ty>;
    freshen?: boolean;
    cells?: Set<number>;
  },
): Ty {
  let openLinks: Map<Ty, Ty[] | undefined> | undefined;
  let linkedCopies: Map<Ty, Ty> | undefined;
  const copiedProjections = new Set<number>();
  const go = (input: Ty): Ty => {
    // Ordered by frequency. A concrete node's copy only differs from HM's by keeping its `!`.
    if (input.tag === "prim") return input;
    if (input.tag === "named") return { ...input, args: input.args.map(go) };
    if (input.tag === "fn") {
      const result = fn(input.params.map(go), go(input.result));
      if (input.tainted) result.tainted = true;
      return result;
    }
    if (input.tag === "tuple") return { ...input, items: input.items.map(go) };
    if (input.tag === "var") {
      if (input.instance) {
        const following: Ty = input.instance;
        if (!input.linked && !input.tainted && !input.deps && following.tag !== "view") {
          return go(following);
        }
        return goHeld(input as Extract<Ty, { tag: "var" }>);
      }
      return goFree(input);
    }
    if (input.tag === "view") {
      if (!input.tainted && !input.deps) return go(input.value);
      return occurrence(input, input.value);
    }
    if (input.tag === "struct") {
      if (options.preserveRows) return input;
      return {
        ...input,
        fields: input.fields.map((field) => ({ ...field, type: go(field.type) })),
      };
    }
    // Unresolved foreign member.
    if (input.instance && !options.freshen) return go(input.instance);
    if (!options.freshen) return input;
    return {
      ...input,
      receiver: input.receiver ? go(input.receiver) : undefined,
      args: input.args.map(go),
      instance: input.instance ? go(input.instance) : undefined,
    };
  };
  const goHeld = (input: Extract<Ty, { tag: "var" }>): Ty => {
    const end = chainEnd(input) as Extract<Ty, { tag: "var" }>;
    if (!end.instance) return go(end);
    if (end.tainted || end.deps) return occurrence(end, end.instance);
    if (!end.linked) return go(end.instance);
    let target = variables.get(end.id);
    if (!target && (options.freshen || options.cells?.has(end.id))) {
      target = fresh(end.name);
      variables.set(end.id, target);
    }
    if (!target) return end;
    if (target.tag === "var" && !target.instance && !target.linked) {
      openPosition(target, target);
      target.instance = go(end.instance);
    }
    return target;
  };
  const goFree = (input: Extract<Ty, { tag: "var" }>): Ty => {
    const bound = options.subst?.get(input.id);
    if (bound) return bound;
    let target = variables.get(input.id);
    if (!target && options.freshen) {
      target = fresh(input.name);
      variables.set(input.id, target);
    }
    if (!target) {
      // An undefaulted numeric callback result stays one type, with its own `!` at each use.
      if (!input.linked || !input.numeric || !options.cells?.has(input.id)) return input;
      target = openPosition(fresh(input.name), input);
      variables.set(input.id, target);
      return target;
    }
    if (input.jsConstraint) addJsConstraint(target, input.jsConstraint);
    if (input.gpuConstraint) addGpuConstraint(target, input.gpuConstraint);
    if (input.equalityConstraint) addEqualityConstraint(target, input.equalityConstraint);
    if (input.numeric && target.tag === "var") markNumeric(target, input.numeric);
    if (!copiedProjections.has(input.id)) {
      copiedProjections.add(input.id);
      for (const field of input.projectionFields ?? []) {
        addProjectionField(target, { ...field, type: go(field.type) });
      }
    }
    if (input.tainted) target.tainted = true;
    if (input.linked) target.linked = true;
    if (input.deps && !target.deps) {
      const deps = openDeps(input.deps);
      if (deps) {
        // Set first: a recursive result's links can lead back to this variable.
        target.deps = [];
        target.deps = deps.map(go);
      } else target.tainted = true;
    }
    return target;
  };
  /** A position with links. Links that resolved clean disappear here instead of being copied. */
  const occurrence = (input: Ty, value: Ty): Ty => {
    if (input.tainted) return taintedType(go(value));
    // Nothing changes a link during a copy, and one position can occur many times in a type.
    let deps = (openLinks ??= new Map()).get(input);
    if (deps === undefined && !openLinks.has(input)) {
      deps = openDeps(input.deps ?? []);
      openLinks.set(input, deps);
    }
    if (!deps) return taintedType(go(value));
    if (!deps.length) return go(value);
    const known = (linkedCopies ??= new Map()).get(input);
    if (known) return known;
    const result: Ty = { tag: "view", value, deps: [], tainted: undefined, linked: undefined };
    linkedCopies.set(input, result);
    result.value = go(value);
    result.deps = deps.map(go);
    return result;
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

export function namedRecordFields(
  type: Extract<Ty, { tag: "named" }>,
): RecordFieldInfo[] | undefined {
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
    /** This type is a parameter's: a function here is a callback, whose result a caller decides. */
    parameter?: boolean;
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
    // Reflected C typedefs commonly start with lowercase letters (sqlite3, size_t).
    // Explicit scoped type parameters above still take precedence over imported names.
    const foreign = typeEnv.get(expr.name);
    if (foreign?.foreign && foreign.arity === 0) {
      return resolved(typeFromAst({ ...expr, kind: "TName", args: [] }, typeEnv, vars, options));
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
    const flipped = { ...options, parameter: !options.parameter };
    const params = [callArg(expr.params.map((x) => typeFromAst(x, typeEnv, vars, flipped)))];
    const result = typeFromAst(expr.result, typeEnv, vars, options);
    return resolved(fn(
      params,
      options.parameter && result.tag !== "var" ? openPosition(fresh(), result) : result,
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
  // HM has no subtyping to apply a TS default such as `Buffer<ArrayBufferLike>` to a
  // `Buffer<ArrayBuffer>`, so an omitted argument is inferred, where free variables are allowed.
  const omittable = allowFreeVars && expr.args.length >= (info.requiredArity ?? info.arity);
  if (expr.args.length > info.arity || (expr.args.length < info.arity && !omittable)) {
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
    const expanded = instantiateAlias(info.alias, info.aliasParams ?? [], args);
    openCallbacks(expanded, options.parameter === true, fresh);
    return resolved(expanded);
  }
  if (
    expr.args.length === 0 &&
    ["Number", "I32", "Bool", "Char", "String", "Void"].includes(expr.name)
  ) {
    return resolved(prim(expr.name));
  }
  const args = expr.args.map((x) => typeFromAst(x, typeEnv, vars, options));
  while (args.length < info.arity) args.push(fresh());
  return resolved(named(info, args));
}

export function show(t: Ty): string {
  const names = new Map<number, string>();
  let n = 0;
  let numeric = 0;
  const receivers: Extract<Ty, { tag: "var" }>[] = [];
  const seenReceivers = new Set<number>();
  // Unresolved numeric candidates get their own names so the constraint stays visible.
  const numericName = () => numeric++ === 0 ? "'num" : `'num${numeric}`;
  const nameOf = (id: number, isNumeric?: boolean) =>
    names.get(id) ??
      (names.set(id, isNumeric ? numericName() : `'${String.fromCharCode(97 + n++)}`),
        names.get(id)!);
  const functionDomain = (params: Ty[]): string => {
    if (params.length === 0) return "Void";
    if (params.length > 1) return `(${params.map(domain).join(", ")})`;
    const param = prune(params[0]);
    const rendered = domain(params[0]);
    return param.tag === "fn" ? `(${rendered})` : rendered;
  };
  const domain = (x: Ty): string => {
    const type = prune(x);
    if (type.tag === "tuple") return `(${type.items.map(domain).join(", ")})`;
    if (type.tag === "named" && type.args.length) {
      return `${type.name}<${type.args.map(domain).join(", ")}>`;
    }
    if (type.tag === "struct") {
      return `{ ${type.fields.map((field) => `${field.name}: ${domain(field.type)}`).join(", ")} }`;
    }
    return shape(x);
  };
  const go = (x: Ty): string => {
    const rendered = shape(x);
    return isTainted(x) ? prune(x).tag === "fn" ? `(${rendered})!` : `${rendered}!` : rendered;
  };
  const shape = (x: Ty): string => {
    x = prune(x);
    if (x.tag === "var") {
      if (x.projectionFields?.length && !seenReceivers.has(x.id)) {
        seenReceivers.add(x.id);
        receivers.push(x);
      }
      return x.name ?? nameOf(x.id, !!x.numeric);
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
