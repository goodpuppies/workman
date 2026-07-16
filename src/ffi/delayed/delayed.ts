import type { Decl, Expr, TypeExpr } from "../../ast.ts";
import { hostFfiDescendsInto } from "../../region_traversal.ts";
export { contextualizeDelayedCallbacks } from "./delayed_callbacks.ts";
import { resolveDelayedDecl } from "./delayed_resolve.ts";
import { diagnosticError } from "../../diagnostics.ts";
import type { InferResult } from "../../infer.ts";
import { prune, show, type Ty } from "../../types.ts";
import { rejectAnnotatedDynamicCallbacks } from "./annotations.ts";
import { generatedJsImports } from "../imports.ts";
import { generatedForeignDeclsForRefs, generatedImportInsertionIndex } from "./bindings.ts";
import {
  materializeReceiverCall,
  materializeReceiverProperty,
  solveBindingCallType,
  solveReflectedFfiValue,
} from "./materialize.ts";
import { setActiveFfiSolve, setActiveRecordFields } from "../receiver/rewrite_expr.ts";
import {
  expressionRefForReceiver,
  foreignReceiver,
  foreignTypeRefLookup,
  inferredType,
  isJsObjectTy,
  jsArrayMember,
  jsArrayReceiver,
  jsPromiseMember,
  jsPromiseReceiver,
  jsPromiseReceiverTypeExpr,
  knownTyToTypeExpr,
  promiseCallbackResultType,
  receiverTypeForRef,
  typeExprKey,
  withCallbackParamRefs,
} from "./receiver_models.ts";
import type { ResolveOptions } from "./types.ts";
import {
  callArgHint,
  callHintKey,
  dynamicReceiverArgType,
  type FfiElaboration,
  fn,
  generatedReceiverJsImports,
  isDecl,
  name,
} from "../shared.ts";
import {
  type JsCallArgHint,
  jsRefCallMember,
  jsRefMember,
  jsRefTypeExpr,
  jsTypeExprValueRef,
  type JsTypeRef,
} from "../reflect/types.ts";
import { typeExprKey as reflectTypeExprKey } from "../reflect/ts_type_expr.ts";

export function resolveDelayedFfiElaboration(
  ffi: FfiElaboration,
  result: InferResult,
  options: ResolveOptions = {},
): FfiElaboration {
  const previousRecordFields = setActiveRecordFields(recordFieldNames(ffi.module.decls));
  const previousFfiSolve = setActiveFfiSolve((original, internalName) => {
    const variant = [...ffi.bindings.values()]
      .flatMap((binding) => binding.variants)
      .find((item) => item.internalName === internalName);
    if (variant) solveReflectedFfiValue(original, variant, result);
  });
  try {
    return resolveDelayedFfiElaborationInner(ffi, result, options);
  } finally {
    setActiveRecordFields(previousRecordFields);
    setActiveFfiSolve(previousFfiSolve);
  }
}

function resolveDelayedFfiElaborationInner(
  ffi: FfiElaboration,
  result: InferResult,
  options: ResolveOptions,
): FfiElaboration {
  solveDelayedBindingTypes(ffi.module.decls, ffi, result);
  const selected = new Set<string>();
  const valueRefs = new Map<string, JsTypeRef>();
  const decls: Decl[] = [];
  for (const decl of ffi.module.decls) {
    const resolved = resolveDelayedDecl(decl, ffi, result, selected, options, valueRefs);
    decls.push(resolved);
  }
  const module = {
    ...ffi.module,
    decls,
  };
  const referencedGenerated = generatedValueRefs(module.decls);
  const importsToGenerate = new Set([...selected, ...referencedGenerated]);
  rejectAnnotatedDynamicCallbacks(module.decls, ffi.bindings);
  const rewrittenDecls = module.decls.flatMap((decl) => {
    const generated = decl.kind === "JsImportDecl"
      ? generatedJsImports(decl, ffi.bindings, importsToGenerate)
      : [decl];
    return generated.flatMap((item) =>
      filterUnreferencedGeneratedImport(item, referencedGenerated)
    );
  });
  const recoveredImports = missingGeneratedImports(
    rewrittenDecls,
    (ffi.sourceJsImports ?? []).flatMap((decl) =>
      generatedJsImports(decl, ffi.bindings, importsToGenerate, { selectedOnly: true })
    ),
  );
  const rewrittenModule = {
    ...module,
    decls: rewrittenDecls,
  };
  const foreignDeclsFromRefs = generatedForeignDeclsForRefs(
    rewrittenModule.decls,
    ffi.foreignTypeRefs,
  );
  const existingRecordNames = new Set<string>();
  for (const decl of rewrittenModule.decls) {
    if (decl.kind === "RecordDecl") existingRecordNames.add(decl.name);
  }
  const deepRecordDecls = [...(ffi.deepRecords?.values() ?? [])]
    .filter((decl) => !existingRecordNames.has(decl.name));
  const deepRecordNames = new Set(deepRecordDecls.map((decl) => decl.name));
  const foreignDecls = foreignDeclsFromRefs.filter((decl) =>
    !(decl.kind === "ForeignTypeDecl" && deepRecordNames.has(decl.name))
  );
  const receiverImports = missingGeneratedImports(
    [...rewrittenDecls, ...recoveredImports],
    generatedReceiverJsImports(ffi.bindings, importsToGenerate),
  );
  const imports = [
    ...recoveredImports,
    ...receiverImports,
  ];
  const prefixLength = generatedImportInsertionIndex(rewrittenModule.decls);
  const leadingGeneratedDecls = [...foreignDecls, ...deepRecordDecls];
  const finalDecls = imports.length || foreignDecls.length || deepRecordDecls.length
    ? [
      ...leadingGeneratedDecls,
      ...rewrittenModule.decls.slice(0, prefixLength),
      ...imports,
      ...rewrittenModule.decls.slice(prefixLength),
    ]
    : rewrittenModule.decls;
  return {
    ...ffi,
    module: { ...rewrittenModule, decls: dedupeGeneratedImports(finalDecls) },
    selected: new Set([...ffi.selected, ...selected]),
  };
}

function dedupeGeneratedImports(decls: Decl[]): Decl[] {
  const seen = new Set<string>();
  const seenDeepRecords = new Set<string>();
  return decls.flatMap((decl) => {
    if (decl.kind === "RecordDecl" && isGeneratedDeepRecordName(decl.name)) {
      if (seenDeepRecords.has(decl.name)) return [];
      seenDeepRecords.add(decl.name);
      return [decl];
    }
    if (decl.kind !== "JsImportDecl" || decl.clause.kind !== "Named") return [decl];
    const specs = decl.clause.specs.filter((spec) => {
      const name = spec.alias ?? spec.name;
      if (!isGeneratedFfiName(name)) return true;
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
    return specs.length ? [{ ...decl, clause: { ...decl.clause, specs } }] : [];
  });
}

function filterUnreferencedGeneratedImport(decl: Decl, referenced: Set<string>): Decl[] {
  if (decl.kind !== "JsImportDecl" || decl.clause.kind !== "Named") return [decl];
  const specs = decl.clause.specs.filter((spec) => {
    const name = spec.alias ?? spec.name;
    return !isGeneratedFfiName(name) || referenced.has(name);
  });
  return specs.length ? [{ ...decl, clause: { ...decl.clause, specs } }] : [];
}

function missingGeneratedImports(decls: Decl[], generated: Decl[]): Decl[] {
  const existing = generatedImportNames(decls);
  return generated.flatMap((decl) => filterGeneratedImport(decl, existing));
}

function filterGeneratedImport(decl: Decl, existing: Set<string>): Decl[] {
  if (decl.kind !== "JsImportDecl" || decl.clause.kind !== "Named") return [decl];
  const specs = decl.clause.specs.filter((spec) => {
    const name = spec.alias ?? spec.name;
    if (existing.has(name)) return false;
    existing.add(name);
    return true;
  });
  return specs.length ? [{ ...decl, clause: { ...decl.clause, specs } }] : [];
}

function generatedImportNames(decls: Decl[]): Set<string> {
  const names = new Set<string>();
  for (const decl of decls) {
    if (decl.kind !== "JsImportDecl" || decl.clause.kind !== "Named") continue;
    for (const spec of decl.clause.specs) {
      const name = spec.alias ?? spec.name;
      if (isGeneratedFfiName(name)) names.add(name);
    }
  }
  return names;
}

function generatedValueRefs(decls: Decl[]): Set<string> {
  const refs = new Set<string>();
  for (const decl of decls) collectGeneratedValueRefsInDecl(decl, refs);
  return refs;
}

function collectGeneratedValueRefsInDecl(decl: Decl, refs: Set<string>): void {
  switch (decl.kind) {
    case "LetDecl":
      decl.bindings.forEach((binding) => collectGeneratedValueRefsInExpr(binding.value, refs));
      return;
    case "ImportDecl":
    case "JsImportDecl":
    case "ForeignTypeDecl":
    case "RecordDecl":
    case "TypeDecl":
      return;
  }
}

function collectGeneratedValueRefsInExpr(expr: Expr, refs: Set<string>): void {
  switch (expr.kind) {
    case "Var":
      if (isGeneratedFfiName(expr.name)) refs.add(expr.name);
      return;
    case "FfiGet":
      collectGeneratedValueRefsInExpr(expr.receiver, refs);
      return;
    case "FfiCall":
      collectGeneratedValueRefsInExpr(expr.receiver, refs);
      expr.args.forEach((arg) => collectGeneratedValueRefsInExpr(arg, refs));
      return;
    case "FfiBindingCall":
      expr.args.forEach((arg) => collectGeneratedValueRefsInExpr(arg, refs));
      return;
    case "Call":
      collectGeneratedValueRefsInExpr(expr.callee, refs);
      expr.args.forEach((arg) => collectGeneratedValueRefsInExpr(arg, refs));
      return;
    case "Tuple":
    case "JsonArray":
      expr.items.forEach((item) => collectGeneratedValueRefsInExpr(item, refs));
      return;
    case "Record":
      expr.fields.forEach((field) => collectGeneratedValueRefsInExpr(field.value, refs));
      return;
    case "JsonObject":
      expr.fields.forEach((field) => collectGeneratedValueRefsInExpr(field.value, refs));
      return;
    case "Lambda":
      if (!hostFfiDescendsInto(expr)) return;
      collectGeneratedValueRefsInExpr(expr.body, refs);
      return;
    case "If":
      collectGeneratedValueRefsInExpr(expr.cond, refs);
      collectGeneratedValueRefsInExpr(expr.thenExpr, refs);
      collectGeneratedValueRefsInExpr(expr.elseExpr, refs);
      return;
    case "Match":
      collectGeneratedValueRefsInExpr(expr.value, refs);
      expr.arms.forEach((arm) => collectGeneratedValueRefsInExpr(arm.body, refs));
      return;
    case "Panic":
      collectGeneratedValueRefsInExpr(expr.message, refs);
      return;
    case "Block":
      for (const item of expr.items) {
        if (isDecl(item)) collectGeneratedValueRefsInDecl(item, refs);
        else collectGeneratedValueRefsInExpr(item, refs);
      }
      collectGeneratedValueRefsInExpr(expr.result, refs);
      return;
    case "Binary":
      collectGeneratedValueRefsInExpr(expr.left, refs);
      collectGeneratedValueRefsInExpr(expr.right, refs);
      return;
    case "Unary":
      collectGeneratedValueRefsInExpr(expr.value, refs);
      return;
    case "Pipe":
      collectGeneratedValueRefsInExpr(expr.left, refs);
      collectGeneratedValueRefsInExpr(expr.right, refs);
      return;
    case "Int":
    case "Float":
    case "String":
    case "Bool":
    case "Void":
      return;
  }
}

function isGeneratedFfiName(name: string): boolean {
  return name.startsWith("__ffi_");
}

function isGeneratedDeepRecordName(name: string): boolean {
  return name.startsWith("__Deep_");
}

function solveDelayedBindingTypes(
  decls: Decl[],
  ffi: FfiElaboration,
  result: InferResult,
): void {
  for (const decl of decls) solveDelayedBindingTypesInDecl(decl, ffi, result);
}

function solveDelayedBindingTypesInDecl(
  decl: Decl,
  ffi: FfiElaboration,
  result: InferResult,
): void {
  if (decl.kind !== "LetDecl") return;
  for (const binding of decl.bindings) solveDelayedBindingTypesInExpr(binding.value, ffi, result);
}

function solveDelayedBindingTypesInExpr(
  expr: Expr,
  ffi: FfiElaboration,
  result: InferResult,
): void {
  switch (expr.kind) {
    case "FfiBindingCall":
      expr.args.forEach((arg) => solveDelayedBindingTypesInExpr(arg, ffi, result));
      solveBindingCallType(expr, expr.args, ffi, result);
      return;
    case "FfiGet":
      solveDelayedBindingTypesInExpr(expr.receiver, ffi, result);
      return;
    case "FfiCall":
      solveDelayedBindingTypesInExpr(expr.receiver, ffi, result);
      expr.args.forEach((arg) => solveDelayedBindingTypesInExpr(arg, ffi, result));
      return;
    case "Call":
      solveDelayedBindingTypesInExpr(expr.callee, ffi, result);
      expr.args.forEach((arg) => solveDelayedBindingTypesInExpr(arg, ffi, result));
      return;
    case "Tuple":
    case "JsonArray":
      expr.items.forEach((item) => solveDelayedBindingTypesInExpr(item, ffi, result));
      return;
    case "Record":
    case "JsonObject":
      expr.fields.forEach((field) => solveDelayedBindingTypesInExpr(field.value, ffi, result));
      return;
    case "Lambda":
      if (!hostFfiDescendsInto(expr)) return;
      solveDelayedBindingTypesInExpr(expr.body, ffi, result);
      return;
    case "If":
      solveDelayedBindingTypesInExpr(expr.cond, ffi, result);
      solveDelayedBindingTypesInExpr(expr.thenExpr, ffi, result);
      solveDelayedBindingTypesInExpr(expr.elseExpr, ffi, result);
      return;
    case "Match":
      solveDelayedBindingTypesInExpr(expr.value, ffi, result);
      expr.arms.forEach((arm) => solveDelayedBindingTypesInExpr(arm.body, ffi, result));
      return;
    case "Panic":
      solveDelayedBindingTypesInExpr(expr.message, ffi, result);
      return;
    case "Block":
      for (const item of expr.items) {
        if (isDecl(item)) solveDelayedBindingTypesInDecl(item, ffi, result);
        else solveDelayedBindingTypesInExpr(item, ffi, result);
      }
      solveDelayedBindingTypesInExpr(expr.result, ffi, result);
      return;
    case "Binary":
      solveDelayedBindingTypesInExpr(expr.left, ffi, result);
      solveDelayedBindingTypesInExpr(expr.right, ffi, result);
      return;
    case "Unary":
      solveDelayedBindingTypesInExpr(expr.value, ffi, result);
      return;
    case "Pipe":
      solveDelayedBindingTypesInExpr(expr.left, ffi, result);
      solveDelayedBindingTypesInExpr(expr.right, ffi, result);
      return;
    case "Int":
    case "Float":
    case "String":
    case "Bool":
    case "Void":
    case "Var":
      return;
  }
}

function recordFieldNames(decls: Decl[]): Set<string> {
  const fields = new Set<string>();
  for (const decl of decls) {
    if (decl.kind !== "RecordDecl") continue;
    for (const field of decl.fields) fields.add(field.name);
  }
  return fields;
}
