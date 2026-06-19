import type { Decl, Expr, TypeExpr } from "../../ast.ts";
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
  rejectAnnotatedDynamicCallbacks(module.decls, ffi.bindings);
  const rewrittenModule = {
    ...module,
    decls: module.decls.flatMap((decl) =>
      decl.kind === "JsImportDecl" ? generatedJsImports(decl, ffi.bindings, selected) : [decl]
    ),
  };
  const foreignDeclsFromRefs = generatedForeignDeclsForRefs(rewrittenModule.decls, ffi.foreignTypeRefs);
  const foreignDecls = foreignDeclsFromRefs;
  const existingRecordNames = new Set<string>();
  for (const decl of rewrittenModule.decls) {
    if (decl.kind === "RecordDecl") existingRecordNames.add(decl.name);
  }
  const deepRecordDecls = [...(ffi.deepRecords?.values() ?? [])]
    .filter((decl) => !existingRecordNames.has(decl.name));
  const imports = generatedReceiverJsImports(ffi.bindings, selected);
  const prefixLength = generatedImportInsertionIndex(rewrittenModule.decls);
  const leadingGeneratedDecls = [...foreignDecls, ...deepRecordDecls];
  return {
    ...ffi,
    module: imports.length || foreignDecls.length || deepRecordDecls.length
      ? {
        ...rewrittenModule,
        decls: [
          ...leadingGeneratedDecls,
          ...rewrittenModule.decls.slice(0, prefixLength),
          ...imports,
          ...rewrittenModule.decls.slice(prefixLength),
        ],
      }
      : rewrittenModule,
    selected: new Set([...ffi.selected, ...selected]),
  };
}

function recordFieldNames(decls: Decl[]): Set<string> {
  const fields = new Set<string>();
  for (const decl of decls) {
    if (decl.kind !== "RecordDecl") continue;
    for (const field of decl.fields) fields.add(field.name);
  }
  return fields;
}
