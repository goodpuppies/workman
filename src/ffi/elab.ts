import type { Decl, Module, TypeExpr } from "../ast.ts";
import type { JsTypeRef } from "./reflect/types.ts";
import { jsGlobalTypeRef } from "./reflect/types.ts";
import { setActiveJsReflectionBasePath } from "./reflect/host.ts";
import { collectFfiDecl, generatedJsImports, generatedTypeAliases } from "./imports.ts";
import { type ObjectAccess, rememberLetObjectAccess } from "./receiver/receiver.ts";
import { rewriteDeclCalls } from "./receiver/rewrite_decl.ts";
import { rewriteExprCalls, setActiveRecordFields } from "./receiver/rewrite_expr.ts";
import {
  type FfiBinding,
  type FfiElaboration,
  generatedImportInsertionIndex,
  generatedReceiverJsImports,
} from "./shared.ts";

export type FfiElaborationOptions = {
  filePath?: string;
};

export function prepareFfiElaboration(
  module: Module,
  options: FfiElaborationOptions = {},
): FfiElaboration {
  const previousRecordFields = setActiveRecordFields(recordFieldNames(module));
  const previousReflectionBasePath = setActiveJsReflectionBasePath(options.filePath);
  try {
    return prepareFfiElaborationInner(module);
  } finally {
    setActiveJsReflectionBasePath(previousReflectionBasePath);
    setActiveRecordFields(previousRecordFields);
  }
}

function prepareFfiElaborationInner(module: Module): FfiElaboration {
  const bindings = new Map<string, FfiBinding>();
  const importedRefs = new Map<string, JsTypeRef>();
  const importedTypeRefs = new Map<string, JsTypeRef>();
  const localTypes = localTypeNames(module);
  for (const decl of module.decls) {
    if (decl.kind !== "JsImportDecl" || !decl.typeOnly) continue;
    collectFfiDecl(bindings, importedRefs, importedTypeRefs, decl);
  }
  for (const decl of module.decls) {
    if (decl.kind !== "JsImportDecl" || decl.typeOnly) continue;
    collectFfiDecl(bindings, importedRefs, importedTypeRefs, decl);
  }
  collectReflectedForeignTypeRefs(bindings, importedTypeRefs, localTypes);
  const selected = new Set<string>();
  const refs = new Map(importedRefs);
  const objectAccess = new Map<string, ObjectAccess>();
  const rewrittenDecls: Decl[] = [];
  for (const decl of module.decls) {
    if (decl.kind === "JsImportDecl") {
      if (!decl.typeOnly) rewrittenDecls.push(decl);
      continue;
    }
    const rewritten = rewriteDeclCalls(
      decl,
      bindings,
      selected,
      refs,
      objectAccess,
      importedTypeRefs,
      rewriteExprCalls,
    );
    rememberLetObjectAccess(rewritten, bindings, objectAccess, importedTypeRefs);
    rewrittenDecls.push(rewritten);
  }
  collectReflectedForeignTypeRefs(bindings, importedTypeRefs, localTypes);
  const receiverImports = generatedReceiverJsImports(bindings, selected);
  const baseDecls = [
    ...generatedTypeAliases(importedTypeRefs),
    ...rewrittenDecls.flatMap((decl) =>
      decl.kind === "JsImportDecl" ? generatedJsImports(decl, bindings, selected) : [decl]
    ),
  ];
  const insertionIndex = generatedImportInsertionIndex(baseDecls);
  const decls = [
    ...baseDecls.slice(0, insertionIndex),
    ...receiverImports,
    ...baseDecls.slice(insertionIndex),
  ];
  return {
    module: { ...module, decls },
    bindings,
    foreignTypeRefs: importedTypeRefs,
    selected,
    sourceJsImports: module.decls.filter((decl) =>
      decl.kind === "JsImportDecl" && !decl.typeOnly
    ) as Extract<Decl, { kind: "JsImportDecl" }>[],
    deepRecords: new Map(),
  };
}

function recordFieldNames(module: Module): Set<string> {
  const fields = new Set<string>();
  for (const decl of module.decls) {
    if (decl.kind !== "RecordDecl") continue;
    for (const field of decl.fields) fields.add(field.name);
  }
  return fields;
}

function collectReflectedForeignTypeRefs(
  bindings: Map<string, FfiBinding>,
  foreignTypeRefs: Map<string, JsTypeRef>,
  localTypes: Set<string>,
) {
  for (const binding of bindings.values()) {
    for (const variant of binding.variants) {
      collectForeignTypeNames(variant.type, foreignTypeRefs, localTypes);
      if (variant.receiverType) {
        collectForeignTypeNames(variant.receiverType, foreignTypeRefs, localTypes);
      }
      if (variant.resultRef?.type) {
        collectForeignTypeNames(variant.resultRef.type, foreignTypeRefs, localTypes);
      }
      for (const callback of variant.callbackParamRefs ?? []) {
        for (const ref of callback.params) {
          if (ref.type) collectForeignTypeNames(ref.type, foreignTypeRefs, localTypes, ref);
        }
      }
    }
  }
}

function collectForeignTypeNames(
  type: TypeExpr,
  foreignTypeRefs: Map<string, JsTypeRef>,
  localTypes: Set<string>,
  ref?: JsTypeRef,
) {
  switch (type.kind) {
    case "TName":
      if (type.args.length === 0 && isReflectedForeignTypeName(type.name, localTypes)) {
        const typeRef = ref ?? jsGlobalTypeRef(type.name);
        if (!foreignTypeRefs.has(type.name)) foreignTypeRefs.set(type.name, typeRef);
        foreignTypeRefs.set(typeRef.key, typeRef);
      }
      for (const arg of type.args) collectForeignTypeNames(arg, foreignTypeRefs, localTypes);
      break;
    case "TTuple":
      for (const item of type.items) collectForeignTypeNames(item, foreignTypeRefs, localTypes);
      break;
    case "TFn":
      for (const param of type.params) collectForeignTypeNames(param, foreignTypeRefs, localTypes);
      collectForeignTypeNames(type.result, foreignTypeRefs, localTypes);
      break;
    case "TVar":
      break;
  }
}

function isReflectedForeignTypeName(name: string, localTypes: Set<string>): boolean {
  if (name.includes(".")) return false;
  if (localTypes.has(name)) return false;
  return !builtInTypeNames.has(name) && !name.startsWith("Js.");
}

const builtInTypeNames = new Set([
  "Bool",
  "Number",
  "Option",
  "Result",
  "String",
  "Void",
]);

function localTypeNames(module: Module): Set<string> {
  const names = new Set<string>();
  for (const decl of module.decls) {
    switch (decl.kind) {
      case "ForeignTypeDecl":
      case "RecordDecl":
      case "TypeDecl":
        names.add(decl.name);
        break;
      case "JsImportDecl":
        if (!decl.typeOnly || decl.clause.kind !== "Named") break;
        for (const spec of decl.clause.specs) {
          names.add(spec.alias ?? spec.name);
        }
        break;
      default:
        break;
    }
  }
  return names;
}
