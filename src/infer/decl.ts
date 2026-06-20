import type { Decl, Expr } from "../ast.ts";
import { basisCtorNamesForType } from "../basis.ts";
import { diagnosticError, type FrontendDiagnostic, warningDiagnostic } from "../diagnostics.ts";
import {
  type Env,
  fn,
  fresh,
  freshTypeInfo,
  generalize,
  named,
  prune,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
  typeFromAst,
  type TypeVarScope,
} from "../types.ts";
import { hasUnguardedRecursiveRef, referencesTypeName, rejectDuplicates } from "./decl_helpers.ts";
import {
  constrainBinding,
  generalizeBinding,
  inferBinding,
  withSchemeProvenance,
} from "./decl_binding.ts";
import { inferExpr } from "./expr.ts";
import { addJsImport } from "./js_imports.ts";
import { assertExportableRecord, assertExportableType } from "./module_exports.ts";
import { patternBinders, showPattern } from "./patterns.ts";
import { constrainAt, provenanceFor, type TypeProvenance } from "./provenance.ts";
import { callArg } from "./shared.ts";
import {
  originForScheme,
  recordBindingFact,
  recordPatternFact,
  type TypeFacts,
} from "./type_facts.ts";

export function inferDecl(
  decl: Decl,
  env: Env,
  exports: Env,
  typeEnv: TypeEnv,
  typeExports: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  facts: TypeFacts,
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
  if (decl.kind === "ForeignTypeDecl") {
    addForeignType(decl, typeEnv, typeExports, exportableTypeIds);
    return;
  }
  if (decl.kind === "RecordDecl") {
    inferRecordDecl(decl, env, typeEnv, typeExports, exportableTypeIds);
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
    facts,
    warnings,
    diagnostics,
    exportableTypeIds,
    provenance,
  );
}

function addForeignType(
  decl: Extract<Decl, { kind: "ForeignTypeDecl" }>,
  typeEnv: TypeEnv,
  typeExports: TypeEnv,
  exportableTypeIds: Set<number>,
) {
  const existing = typeEnv.get(decl.name);
  if (existing && !existing.basis) throw new Error(`duplicate type declaration ${decl.name}`);
  if (existing?.basis) throw new Error(`cannot shadow basis type ${decl.name} with foreign type`);
  const key = decl.foreignKey ?? `name:${decl.name}`;
  const info = foreignTypeInfo(canonicalForeignTypeName(decl.name, key), key);
  typeEnv.set(decl.name, info);
  typeExports.set(decl.name, info);
  exportableTypeIds.add(info.id);
}

const foreignTypes = new Map<string, ReturnType<typeof freshTypeInfo>>();

function foreignTypeInfo(name: string, key: string) {
  const existing = foreignTypes.get(key);
  if (existing) return existing;
  const created = { ...freshTypeInfo(name, 0), foreign: true, foreignKey: key };
  foreignTypes.set(key, created);
  return created;
}

function canonicalForeignTypeName(name: string, key: string): string {
  if (key.startsWith("global-type:")) {
    return key.slice("global-type:".length).split(".").at(-1) ?? name;
  }
  if (key.startsWith("module-type:")) {
    return key.slice("module-type:".length).split(".").at(-1) ?? name;
  }
  return name;
}

function inferRecordDecl(
  decl: Extract<Decl, { kind: "RecordDecl" }>,
  env: Env,
  typeEnv: TypeEnv,
  typeExports: TypeEnv,
  exportableTypeIds: Set<number>,
) {
  const existing = typeEnv.get(decl.name);
  if (existing && !existing.basis) throw new Error(`duplicate type declaration ${decl.name}`);
  if (existing?.basis) removeBasisConstructors(env, decl.name);
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
  const existing = typeEnv.get(decl.name);
  if (existing && !existing.basis) throw new Error(`duplicate type declaration ${decl.name}`);
  if (existing?.basis) removeBasisConstructors(env, decl.name);
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

function removeBasisConstructors(env: Env, typeName: string) {
  for (const name of basisCtorNamesForType(typeName)) {
    if (env.get(name)?.basis) env.delete(name);
  }
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
  facts: TypeFacts,
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
      facts,
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
    facts,
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
  facts: TypeFacts,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
  exportableTypeIds: Set<number>,
  annotationVars: TypeVarScope,
  provenance: TypeProvenance,
) {
  const base = new Map(env);
  const inferred = decl.bindings.map((b) =>
    inferBinding(
      b,
      base,
      typeEnv,
      adts,
      types,
      facts,
      warnings,
      diagnostics,
      annotationVars,
      provenance,
    )
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
      scheme.node = decl.bindings[i].node;
      env.set(name, scheme);
      recordBindingFact(facts, name, {
        subject: "binding",
        instantiated: scheme.type,
        general: scheme,
        origin: originForScheme(name, scheme),
      });
      recordPatternFact(facts, decl.bindings[i].pattern, {
        subject: "pattern",
        instantiated: type,
        general: scheme,
        origin: originForScheme(name, scheme),
      });
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
  facts: TypeFacts,
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
      inferExpr(
        b.value,
        env,
        typeEnv,
        adts,
        types,
        facts,
        warnings,
        diagnostics,
        provenance,
      ),
      b.value,
      b.pattern.node,
      types,
      provenance,
    );
    if (b.annotation) {
      constrainAt(
        placeholders[i],
        typeFromAst(b.annotation, typeEnv, annotationVars),
        b.value,
        undefined,
        [],
        provenance,
        {
          message: "recursive annotation",
          node: b.node,
          span: b.node?.span,
        },
        {
          premise: {
            rule: "InferAnnotation.ExpressionMatchesAnnotation",
            role: "recursive binding matches annotation",
            subject: name,
            leftRole: "binding",
            rightRole: "annotation",
          },
        },
      );
    }
  });
  decl.bindings.forEach((b, i) => {
    const scheme = withSchemeProvenance(
      generalizeBinding(base, placeholders[i], b.value),
      placeholders[i],
      provenance,
    );
    scheme.node = b.node;
    const name = (b.pattern as { name: string }).name;
    env.set(name, scheme);
    recordBindingFact(facts, name, {
      subject: "binding",
      instantiated: scheme.type,
      general: scheme,
      origin: originForScheme(name, scheme),
    });
    recordPatternFact(facts, b.pattern, {
      subject: "pattern",
      instantiated: placeholders[i],
      general: scheme,
      origin: originForScheme(name, scheme),
    });
    if (decl.exported) {
      assertExportableType(scheme.type, exportableTypeIds, `exported value ${name}`);
      exports.set(name, scheme);
    }
  });
}
