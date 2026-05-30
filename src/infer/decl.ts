import type { Binding, Decl, Expr } from "../ast.ts";
import { diagnosticError, type FrontendDiagnostic, warningDiagnostic } from "../diagnostics.ts";
import {
  type Env,
  fn,
  fresh,
  freshTypeInfo,
  generalize,
  named,
  prune,
  quoteType,
  type Scheme,
  show,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
  typeFromAst,
  type TypeVarScope,
} from "../types.ts";
import { resultExpr } from "./ast_utils.ts";
import { hasUnguardedRecursiveRef, referencesTypeName, rejectDuplicates } from "./decl_helpers.ts";
import { inferExpr } from "./expr.ts";
import { isVectorExhaustive } from "./exhaustiveness.ts";
import { addJsImport } from "./js_imports.ts";
import { assertExportableRecord, assertExportableType } from "./module_exports.ts";
import { inferBindingPattern, patternBinders, showPattern } from "./patterns.ts";
import {
  constrainAt,
  expressionTypeEvidence,
  provenanceFor,
  provenanceForType,
  recursiveResultEvidence,
  type TypeProvenance,
} from "./provenance.ts";
import { inferRecordExpr } from "./records.ts";
import { callArg } from "./shared.ts";

export function inferDecl(
  decl: Decl,
  env: Env,
  exports: Env,
  typeEnv: TypeEnv,
  typeExports: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
  exportableTypeIds: Set<number>,
  provenance: TypeProvenance,
) {
  if (decl.kind === "ImportDecl") return;
  if (decl.kind === "JsImportDecl") {
    addJsImport(env, typeEnv, decl);
    return;
  }
  if (decl.kind === "RecordDecl") {
    inferRecordDecl(decl, typeEnv, typeExports, exportableTypeIds);
    return;
  }
  if (decl.kind === "TypeDecl") {
    inferTypeDecl(decl, env, exports, typeEnv, typeExports, adts, exportableTypeIds);
    return;
  }
  inferLetDecl(
    decl,
    env,
    exports,
    typeEnv,
    adts,
    types,
    warnings,
    diagnostics,
    exportableTypeIds,
    provenance,
  );
}

function inferRecordDecl(
  decl: Extract<Decl, { kind: "RecordDecl" }>,
  typeEnv: TypeEnv,
  typeExports: TypeEnv,
  exportableTypeIds: Set<number>,
) {
  if (typeEnv.has(decl.name)) throw new Error(`duplicate type declaration ${decl.name}`);
  rejectDuplicates(decl.params, "type parameter");
  rejectDuplicates(decl.fields.map((field) => field.name), "record field");
  const info = freshTypeInfo(decl.name, decl.params.length);
  typeEnv.set(decl.name, info);
  if (decl.exported) typeExports.set(decl.name, info);
  const vars = new Map(decl.params.map((p) => [p, fresh(p)] as const));
  info.recordFields = decl.fields.map((field) => ({
    name: field.name,
    type: typeFromAst(field.type, typeEnv, vars, { allowFreeVars: false }),
  }));
  info.recordParams = decl.params.map((p) => {
    const v = prune(vars.get(p)!);
    if (v.tag !== "var") throw new Error("invalid record type parameter");
    return v.id;
  });
  if (decl.exported) {
    exportableTypeIds.add(info.id);
    assertExportableRecord(info, exportableTypeIds);
  }
}

function inferTypeDecl(
  decl: Extract<Decl, { kind: "TypeDecl" }>,
  env: Env,
  exports: Env,
  typeEnv: TypeEnv,
  typeExports: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  exportableTypeIds: Set<number>,
) {
  if (typeEnv.has(decl.name)) throw new Error(`duplicate type declaration ${decl.name}`);
  rejectDuplicates(decl.params, "type parameter");
  const info = freshTypeInfo(decl.name, decl.params.length);
  typeEnv.set(decl.name, info);
  if (decl.exported) typeExports.set(decl.name, info);
  if (decl.alias) {
    inferAliasDecl(decl, info, typeEnv, exportableTypeIds);
    return;
  }
  rejectDuplicates(decl.ctors.map((c) => c.name), "constructor");
  const vars = new Map(decl.params.map((p) => [p, fresh(p)] as const));
  const result = named(info, decl.params.map((p) => vars.get(p)!));
  const paramTypeIds = decl.params.map((p) => {
    const v = prune(vars.get(p)!);
    if (v.tag !== "var") throw new Error("invalid datatype type parameter");
    return v.id;
  });
  if (decl.exported) exportableTypeIds.add(info.id);
  const ctorTypes: Ty[][] = [];
  for (const c of decl.ctors) {
    const args = c.args.map((x) => typeFromAst(x, typeEnv, vars, { allowFreeVars: false }));
    ctorTypes.push(args);
    if (decl.exported) {
      args.forEach((arg) =>
        assertExportableType(arg, exportableTypeIds, `exported type ${decl.name}`)
      );
    }
    const t = args.length === 0 ? result : fn([callArg(args)], result);
    const scheme = { ...generalize(env, t), status: "constructor" as const };
    env.set(c.name, scheme);
    if (decl.exported) exports.set(c.name, scheme);
  }
  adts.set(info.id, { ...decl, type: info, paramTypeIds, ctorTypes });
}

function inferAliasDecl(
  decl: Extract<Decl, { kind: "TypeDecl" }>,
  info: TypeDeclInfo["type"],
  typeEnv: TypeEnv,
  exportableTypeIds: Set<number>,
) {
  if (!decl.alias) return;
  if (referencesTypeName(decl.alias, decl.name, new Set(decl.params))) {
    throw new Error(`cyclic type alias ${decl.name}`);
  }
  const vars = new Map(decl.params.map((p) => [p, fresh(p)] as const));
  info.alias = typeFromAst(decl.alias, typeEnv, vars, { allowFreeVars: false });
  info.aliasParams = decl.params.map((p) => {
    const v = prune(vars.get(p)!);
    if (v.tag !== "var") throw new Error("invalid type alias parameter");
    return v.id;
  });
  if (decl.exported) {
    exportableTypeIds.add(info.id);
    assertExportableType(info.alias, exportableTypeIds, `exported type ${decl.name}`);
  }
}

function inferLetDecl(
  decl: Extract<Decl, { kind: "LetDecl" }>,
  env: Env,
  exports: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
  exportableTypeIds: Set<number>,
  provenance: TypeProvenance,
) {
  rejectDuplicates(decl.bindings.flatMap((b) => patternBinders(b.pattern)), "binding");
  const annotationVars: TypeVarScope = new Map();
  if (!decl.recursive) {
    inferNonRecursiveLet(
      decl,
      env,
      exports,
      typeEnv,
      adts,
      types,
      warnings,
      diagnostics,
      exportableTypeIds,
      annotationVars,
      provenance,
    );
    return;
  }
  inferRecursiveLet(
    decl,
    env,
    exports,
    typeEnv,
    adts,
    types,
    warnings,
    diagnostics,
    exportableTypeIds,
    annotationVars,
    provenance,
  );
}

function inferNonRecursiveLet(
  decl: Extract<Decl, { kind: "LetDecl" }>,
  env: Env,
  exports: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
  exportableTypeIds: Set<number>,
  annotationVars: TypeVarScope,
  provenance: TypeProvenance,
) {
  const base = new Map(env);
  const inferred = decl.bindings.map((b) =>
    inferBinding(b, base, typeEnv, adts, types, warnings, diagnostics, annotationVars, provenance)
  );
  inferred.forEach((result, i) => {
    if (result.refutable) {
      const message = `refutable let pattern may fail at runtime: ${
        showPattern(decl.bindings[i].pattern)
      }`;
      warnings.push(message);
      diagnostics.push(
        warningDiagnostic(message, decl.bindings[i].pattern.node, "pattern.refutable-let"),
      );
    }
    for (const [name, type] of result.bound) {
      const scheme = withSchemeProvenance(
        generalizeBinding(base, type, decl.bindings[i].value),
        type,
        provenance,
      );
      env.set(name, scheme);
      if (decl.exported) {
        assertExportableType(scheme.type, exportableTypeIds, `exported value ${name}`);
        exports.set(name, scheme);
      }
    }
  });
}

function inferRecursiveLet(
  decl: Extract<Decl, { kind: "LetDecl" }>,
  env: Env,
  exports: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
  exportableTypeIds: Set<number>,
  annotationVars: TypeVarScope,
  provenance: TypeProvenance,
) {
  const base = new Map(env);
  for (const b of decl.bindings) {
    if (b.pattern.kind !== "PVar") throw new Error("recursive bindings must bind one name");
  }
  const recursiveNames = new Set(decl.bindings.map((b) => (b.pattern as { name: string }).name));
  for (const b of decl.bindings) {
    if (hasUnguardedRecursiveRef(b.value, recursiveNames)) {
      throw new Error("recursive references must be guarded by a function");
    }
  }
  const placeholders = decl.bindings.map(() => fresh());
  decl.bindings.forEach((b, i) =>
    env.set((b.pattern as { name: string }).name, {
      vars: [],
      type: placeholders[i],
      status: "value",
    })
  );
  decl.bindings.forEach((b, i) => {
    const name = (b.pattern as { name: string }).name;
    constrainBinding(
      name,
      placeholders[i],
      inferExpr(b.value, env, typeEnv, adts, types, warnings, diagnostics, provenance),
      b.value,
      b.pattern.node,
      types,
      provenance,
    );
    if (b.annotation) {
      constrainAt(placeholders[i], typeFromAst(b.annotation, typeEnv, annotationVars), b.value);
    }
  });
  decl.bindings.forEach((b, i) => {
    const scheme = withSchemeProvenance(
      { ...generalize(base, placeholders[i]), status: "value" as const },
      placeholders[i],
      provenance,
    );
    const name = (b.pattern as { name: string }).name;
    env.set(name, scheme);
    if (decl.exported) {
      assertExportableType(scheme.type, exportableTypeIds, `exported value ${name}`);
      exports.set(name, scheme);
    }
  });
}

function generalizeBinding(env: Env, type: Ty, value: Expr): Scheme {
  return isNonExpansive(value, env)
    ? { ...generalize(env, type), status: "value" }
    : { vars: [], type, constraints: [], status: "value" };
}

function isNonExpansive(expr: Expr, env: Env): boolean {
  switch (expr.kind) {
    case "Int":
    case "Float":
    case "String":
    case "Bool":
    case "Void":
    case "Var":
    case "Lambda":
      return true;
    case "Tuple":
      return expr.items.every((item) => isNonExpansive(item, env));
    case "Record":
      return expr.fields.every((field) => isNonExpansive(field.value, env));
    case "JsonObject":
    case "JsonArray":
      return false;
    case "Call":
      return isConstructorExpr(expr.callee, env) &&
        expr.args.every((arg) => isNonExpansive(arg, env));
    default:
      return false;
  }
}

function isConstructorExpr(expr: Expr, env: Env): boolean {
  return expr.kind === "Var" && env.get(expr.name)?.status === "constructor";
}

function withSchemeProvenance(scheme: Scheme, type: Ty, provenance: TypeProvenance): Scheme {
  const notes = provenanceForType(type, provenance);
  return notes.length ? { ...scheme, provenance: notes } : scheme;
}

function inferBinding(
  b: Binding,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
  annotationVars: TypeVarScope,
  provenance: TypeProvenance,
): { bound: Map<string, Ty>; refutable: boolean } {
  try {
    const annotated = b.annotation ? typeFromAst(b.annotation, typeEnv, annotationVars) : undefined;
    const t = annotated && b.value.kind === "Record"
      ? inferRecordExpr(
        b.value,
        typeEnv,
        (value) => inferExpr(value, env, typeEnv, adts, types, warnings, diagnostics, provenance),
        annotated,
      )
      : inferExpr(b.value, env, typeEnv, adts, types, warnings, diagnostics, provenance);
    if (annotated) constrainAt(t, annotated, resultExpr(b.value));
    const bound = new Map<string, Ty>();
    inferBindingPattern(b.pattern, t, env, typeEnv, bound);
    const refutable = !isVectorExhaustive([[b.pattern]], [t], typeEnv, adts);
    return { bound, refutable };
  } catch (error) {
    throw diagnosticError(error, b.node);
  }
}

function constrainBinding(
  name: string,
  expected: Ty,
  actual: Ty,
  value: Expr,
  bindingNode: Binding["pattern"]["node"],
  types: Map<Expr, Ty>,
  provenance: TypeProvenance,
) {
  const expectedFn = prune(expected);
  const actualFn = prune(actual);
  if (value.kind === "Lambda" && expectedFn.tag === "fn" && actualFn.tag === "fn") {
    if (expectedFn.params.length === actualFn.params.length) {
      actualFn.params.forEach((param, i) =>
        constrainAt(
          expectedFn.params[i],
          param,
          value.params[i],
          () => `type mismatch ${quoteType(expectedFn.params[i])} vs ${quoteType(param)}`,
        )
      );
      const evidence = recursiveResultEvidence(name, value, expectedFn.result, types);
      const bodyResult = resultExpr(value.body);
      constrainAt(
        expectedFn.result,
        actualFn.result,
        evidence[0]?.expr ?? bodyResult,
        () => `type mismatch ${quoteType(expectedFn.result)} vs ${quoteType(actualFn.result)}`,
        evidence.length > 0
          ? [
            {
              message: `body: ${show(actualFn.result)}`,
              node: bodyResult.node,
              span: bodyResult.node?.span,
            },
            {
              message: "rec: occurrences share one monomorphic type",
              node: bindingNode,
              span: bindingNode?.span,
            },
            ...expressionTypeEvidence(value, expectedFn.result, types),
            ...provenanceFor(evidence[0].expr, types, provenance),
            ...evidence.slice(1).map((item) => item.related),
          ]
          : [],
      );
      return;
    }
  }
  constrainAt(expected, actual, resultExpr(value));
}
