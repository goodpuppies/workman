import type { Expr } from "../ast.ts";
import type { FrontendDiagnostic, FrontendRelatedDiagnostic } from "../diagnostics.ts";
import {
  addJsConstraint,
  type Env,
  fn,
  fresh,
  instantiateRecordFields,
  JsBoundaryError,
  named,
  prune,
  quoteType,
  show,
  tuple,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
} from "../types.ts";
import type { Ty as TyNode } from "../types.ts";
import { constrainAt, type TypeProvenance } from "./provenance.ts";
import { callArg } from "./shared.ts";
import { inferExpr } from "./expr.ts";

export function inferCall(
  expr: Extract<Expr, { kind: "Call" }>,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
  provenance: TypeProvenance,
): Ty {
  const result = fresh();
  const isPrintCall = expr.callee.kind === "Var" && expr.callee.name === "print";
  const callee = inferExpr(
    expr.callee,
    env,
    typeEnv,
    adts,
    types,
    warnings,
    diagnostics,
    provenance,
  );
  const calleeProvenance = expr.callee.kind === "Var"
    ? (env.get(expr.callee.name)?.provenance ?? [])
    : [];
  const arg = callArg(
    expr.args.map((a) =>
      inferExpr(a, env, typeEnv, adts, types, warnings, diagnostics, provenance)
    ),
  );
  const calleeFn = prune(callee);
  if (calleeFn.tag === "fn" && calleeFn.params.length === 1) {
    const argExpr = expr.args.length === 1 ? expr.args[0] : expr;
    const calleeRelated = callCalleeRelated(expr.callee, calleeFn);
    const callDepth = maxCallDepth([...calleeRelated, ...calleeProvenance]) + 1;
    const isJsImport = expr.callee.kind === "Var" && env.get(expr.callee.name)?.jsImport;
    const expectedArg = calleeFn.params[0];
    let jsBoundaryVar = false;
    const actualArg = isJsImport
      ? jsImportActualArg(calleeFn.params[0], arg, typeEnv, () => {
        jsBoundaryVar = true;
      })
      : arg;
    if (jsBoundaryVar) {
      // The broad Js.Value signature is instantiated per call site: record the callee at this
      // call with the caller's own argument type so tooling shows the specialized signature.
      types.set(expr.callee, fn([arg], calleeFn.result));
    }
    constrainAt(
      expectedArg,
      actualArg,
      argExpr,
      () => `type mismatch expected ${quoteType(calleeFn.params[0])}, got ${quoteType(arg)}`,
      [...calleeRelated, ...calleeProvenance],
      provenance,
      {
        message: "call argument",
        node: expr.node,
        span: expr.node?.span,
        primary: true,
        expectedCallTupleShape: callArity(calleeFn.params[0]),
        actualCallTupleShape: callArity(arg),
        callDepth,
      },
    );
    if (isPrintCall) assertPrintable(arg);
    if (isJsImport) assertJsCompatible(arg, typeEnv);
    constrainAt(result, calleeFn.result, expr);
  } else {
    const callDepth =
      maxCallDepth([...callCalleeRelated(expr.callee, callee), ...calleeProvenance]) + 1;
    constrainAt(
      callee,
      fn([arg], result),
      expr,
      () => `type mismatch expected ${quoteType(fn([arg], result))}, got ${quoteType(callee)}`,
      [...callCalleeRelated(expr.callee, callee), ...calleeProvenance],
      provenance,
      {
        message: "call argument",
        node: expr.node,
        span: expr.node?.span,
        primary: true,
        expectedCallTupleShape: 1,
        actualCallTupleShape: 1,
        callDepth,
      },
    );
  }
  return result;
}

export function ffiGetResultTy(typeEnv: TypeEnv, value: Ty): Ty {
  const result = typeEnv.get("Result");
  const jsError = typeEnv.get("Js.Error");
  if (!result || !jsError) throw new Error("unknown FFI result basis type");
  return named(result, [value, named(jsError)]);
}

function jsImportActualArg(
  expected: Ty,
  actual: Ty,
  typeEnv: TypeEnv,
  onJsBoundaryVar?: () => void,
  intoJs = true,
): Ty {
  const expectedType = prune(expected);
  const actualType = prune(actual);
  if (isJsArrayType(expectedType, typeEnv) && isJsArrayType(actualType, typeEnv)) {
    return actualType;
  }
  if (
    isJsArrayType(expectedType, typeEnv) &&
    (isJsValueType(actualType, typeEnv) || isJsObjectLikeType(actualType, typeEnv))
  ) {
    return expectedType;
  }
  if (isJsObjectType(expectedType, typeEnv) && isJsObjectLikeType(actualType, typeEnv)) {
    const jsObject = typeEnv.get("Js.Object");
    if (!jsObject) throw new Error("unknown type Js.Object");
    return named(jsObject);
  }
  if (isJsObjectType(expectedType, typeEnv) && isJsValueType(actualType, typeEnv)) {
    const jsObject = typeEnv.get("Js.Object");
    if (!jsObject) throw new Error("unknown type Js.Object");
    return named(jsObject);
  }
  if (isForeignObjectType(expectedType, typeEnv) && isJsObjectType(actualType, typeEnv)) {
    return expectedType;
  }
  if (
    isJsValueType(expectedType, typeEnv) &&
    (isJsObjectLikeType(actualType, typeEnv) || isJsPrimitiveType(actualType) ||
      actualType.tag === "fn")
  ) {
    const jsValue = typeEnv.get("Js.Value");
    if (!jsValue) throw new Error("unknown type Js.Value");
    return named(jsValue);
  }
  if (intoJs && isJsValueType(expectedType, typeEnv) && actualType.tag === "var") {
    // Js.Value is an opaque foreign unknown, not a type the program's values should unify
    // with. A Workman value flowing into a Js.Value parameter keeps its variable monomorphic
    // and pending: ordinary call-site constraints must instantiate it with one concrete
    // JS-representable shape, checked when that happens. Positions where JS supplies the
    // value (callback parameters) are genuinely opaque and unify with Js.Value as usual.
    addJsConstraint(actualType, (bound) => {
      try {
        assertJsCompatible(bound, typeEnv);
      } catch (error) {
        throw new JsBoundaryError(error instanceof Error ? error.message : String(error));
      }
    });
    onJsBoundaryVar?.();
    return expectedType;
  }
  if (expectedType.tag === "fn" && actualType.tag === "fn") {
    return fn(
      actualType.params.map((param, i) =>
        jsImportActualArg(expectedType.params[i] ?? param, param, typeEnv, onJsBoundaryVar, !intoJs)
      ),
      jsImportActualArg(expectedType.result, actualType.result, typeEnv, onJsBoundaryVar, intoJs),
    );
  }
  if (expectedType.tag === "tuple" && actualType.tag === "tuple") {
    return tuple(
      actualType.items.map((item, i) =>
        jsImportActualArg(expectedType.items[i] ?? item, item, typeEnv, onJsBoundaryVar, intoJs)
      ),
    );
  }
  if (
    expectedType.tag === "named" && actualType.tag === "named" && expectedType.id === actualType.id
  ) {
    return {
      ...actualType,
      args: actualType.args.map((item, i) =>
        jsImportActualArg(expectedType.args[i] ?? item, item, typeEnv, onJsBoundaryVar, intoJs)
      ),
    };
  }
  return actualType;
}

function isForeignObjectType(type: Ty, typeEnv: TypeEnv): boolean {
  const t = prune(type);
  return t.tag === "named" && Boolean(t.foreign || typeEnv.get(t.name)?.foreign);
}

function isJsObjectLikeType(type: Ty, typeEnv: TypeEnv): boolean {
  const t = prune(type);
  return isJsObjectType(t, typeEnv) || isJsArrayType(t, typeEnv) || isJsDictType(t, typeEnv) ||
    isJsPromiseType(t, typeEnv) || isTaskType(t, typeEnv) || isForeignObjectType(t, typeEnv) ||
    isRecordType(t, typeEnv);
}

function isJsObjectType(type: Ty, typeEnv: TypeEnv): boolean {
  const t = prune(type);
  return t.tag === "named" && t.id === typeEnv.get("Js.Object")?.id;
}

function isJsValueType(type: Ty, typeEnv: TypeEnv): boolean {
  const t = prune(type);
  return t.tag === "named" && t.id === typeEnv.get("Js.Value")?.id;
}

function isJsArrayType(type: Ty, typeEnv: TypeEnv): boolean {
  const t = prune(type);
  return t.tag === "named" && t.id === typeEnv.get("Js.Array")?.id;
}

function isJsDictType(type: Ty, typeEnv: TypeEnv): boolean {
  const t = prune(type);
  return t.tag === "named" && t.id === typeEnv.get("Js.Dict")?.id;
}

function isJsPromiseType(type: Ty, typeEnv: TypeEnv): boolean {
  const t = prune(type);
  return t.tag === "named" && t.id === typeEnv.get("Js.Promise")?.id;
}

function isTaskType(type: Ty, typeEnv: TypeEnv): boolean {
  const t = prune(type);
  return t.tag === "named" && t.id === typeEnv.get("Task")?.id;
}

function isRecordType(type: Ty, typeEnv: TypeEnv): boolean {
  const t = prune(type);
  return t.tag === "named" && Boolean(typeEnv.get(t.name)?.recordFields);
}

function isJsPrimitiveType(type: Ty): boolean {
  const t = prune(type);
  return t.tag === "prim" &&
    (t.name === "String" || t.name === "Number" || t.name === "Bool" || t.name === "Void");
}

function assertPrintable(type: Ty) {
  if (containsNamedType(type, "Js.Error")) {
    throw new Error(`print requires an already-handled value, got ${quoteType(type)}`);
  }
}

function assertJsCompatible(type: Ty, typeEnv: TypeEnv) {
  const t = prune(type);
  switch (t.tag) {
    case "prim":
    case "var":
      return;
    case "fn":
      t.params.forEach((param) => assertJsCompatible(param, typeEnv));
      assertJsCompatible(t.result, typeEnv);
      return;
    case "tuple":
      t.items.forEach((item) => assertJsCompatible(item, typeEnv));
      return;
    case "named":
      if (t.name === "Js.Value" || t.name === "Js.Object" || t.name === "Js.Error") return;
      if (t.name === "Js.Array" && t.args.length === 1) {
        assertJsCompatible(t.args[0], typeEnv);
        return;
      }
      if (t.name === "Js.Dict" && t.args.length === 1) {
        assertJsCompatible(t.args[0], typeEnv);
        return;
      }
      if (t.name === "Js.Promise" && t.args.length === 1) {
        assertJsCompatible(t.args[0], typeEnv);
        return;
      }
      if (t.name === "Task" && t.args.length === 2) {
        assertJsCompatible(t.args[0], typeEnv);
        assertJsCompatible(t.args[1], typeEnv);
        return;
      }
      const record = typeEnv.get(t.name);
      if (record?.recordFields) {
        for (const field of instantiateRecordFields(record, t.args)) {
          assertJsCompatible(field.type, typeEnv);
        }
        return;
      }
      if (t.foreign || typeEnv.get(t.name)?.foreign) return;
      if (t.name === "Option" && t.args.length === 1) {
        assertJsCompatible(t.args[0], typeEnv);
        return;
      }
      throw new Error(`cannot pass ${quoteType(t)} to JS FFI call`);
  }
}

function containsNamedType(type: Ty, name: string): boolean {
  const target = prune(type);
  if (target.tag === "named") {
    return target.name === name || target.args.some((arg) => containsNamedType(arg, name));
  }
  if (target.tag === "fn") {
    return target.params.some((param) => containsNamedType(param, name)) ||
      containsNamedType(target.result, name);
  }
  if (target.tag === "tuple") return target.items.some((item) => containsNamedType(item, name));
  return false;
}

export function callArity(type: TyNode): number {
  const t = prune(type);
  if (t.tag === "prim" && t.name === "Void") return 0;
  if (t.tag === "tuple") return t.items.length;
  return 1;
}

export function maxCallDepth(related: FrontendRelatedDiagnostic[]): number {
  return related.reduce((max, item) => Math.max(max, item.callDepth ?? 0), 0);
}

export function callCalleeRelated(callee: Expr, type: Ty): FrontendRelatedDiagnostic[] {
  if (!callee.node) return [];
  return [{
    message: callee.kind === "Var"
      ? `callee ${callee.name}: ${show(type)}`
      : `callee: ${show(type)}`,
    node: callee.node,
    span: callee.node.span,
  }];
}
