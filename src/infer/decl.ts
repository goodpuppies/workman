import type { Decl } from "../ast.ts";
import { warningDiagnostic } from "../diagnostics.ts";
import {
  type Env,
  fn,
  fresh,
  freshTypeInfo,
  generalize,
  named,
  prune,
  registerTypeInfo,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
  typeFromAst,
  type TypeVarScope,
} from "../types.ts";
import { hasUnguardedRecursiveRef, referencesTypeName, rejectDuplicates } from "./decl_helpers.ts";
import { deriveInferContext, type InferContext } from "./context.ts";
import { bindLongType, bindType, bindValue, staticEnv, type StrEnv } from "./environment.ts";
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
import { constrainAt } from "./provenance.ts";
import { callArg } from "./shared.ts";
import {
  originForScheme,
  recordBindingFact,
  recordPatternFact,
  recordPatternType,
  recordTypeDeclarationFact,
  recordTypeExpressionFact,
  recordTypeReferenceFact,
  recordTypeVariableDeclarationFact,
  recordTypeVariableFact,
  type TypeFacts,
} from "./type_facts.ts";

export function inferDecl(
  decl: Decl,
  context: InferContext,
  exports: Env,
  typeExports: TypeEnv,
  exportableTypeIds: Set<number>,
) {
  const { env, strEnv, typeEnv, adts, facts } = context;
  if (decl.kind === "ImportDecl") return;
  if (decl.kind === "JsImportDecl") {
    addJsImport(env, typeEnv, strEnv, decl, facts);
    return;
  }
  if (decl.kind === "ForeignTypeDecl") {
    addForeignType(decl, strEnv, typeEnv, typeExports, exportableTypeIds, facts);
    return;
  }
  if (decl.kind === "RecordDecl") {
    inferRecordDecl(
      decl,
      env,
      exports,
      typeEnv,
      strEnv,
      typeExports,
      exportableTypeIds,
      facts,
    );
    return;
  }
  if (decl.kind === "TypeDecl") {
    inferTypeDecl(
      decl,
      env,
      exports,
      typeEnv,
      strEnv,
      typeExports,
      adts,
      exportableTypeIds,
      facts,
    );
    return;
  }
  inferLetDecl(decl, context, exports, exportableTypeIds);
}

function addForeignType(
  decl: Extract<Decl, { kind: "ForeignTypeDecl" }>,
  strEnv: StrEnv,
  typeEnv: TypeEnv,
  typeExports: TypeEnv,
  exportableTypeIds: Set<number>,
  facts: TypeFacts,
) {
  const key = decl.foreignKey ?? `name:${decl.name}`;
  const info = foreignTypeInfo(canonicalForeignTypeName(decl.name, key), key);
  registerTypeInfo(typeEnv, info);
  if (decl.name.includes(".")) bindLongType(strEnv, decl.name, info);
  else bindType(staticEnv(strEnv, typeEnv), decl.name, info);
  typeExports.set(decl.name, info);
  exportableTypeIds.add(info.id);
  recordTypeDeclarationFact(facts, decl, info);
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
  exports: Env,
  typeEnv: TypeEnv,
  strEnv: import("./environment.ts").StrEnv,
  typeExports: TypeEnv,
  exportableTypeIds: Set<number>,
  facts: import("./type_facts.ts").TypeFacts,
) {
  rejectDuplicates(decl.params, "type parameter");
  rejectDuplicates(decl.fields.map((field) => field.name), "record field");
  const info = freshTypeInfo(decl.name, decl.params.length);
  recordTypeDeclarationFact(facts, decl, info);
  registerTypeInfo(typeEnv, info);
  bindType(staticEnv(strEnv, typeEnv, env), decl.name, info);
  if (decl.exported) typeExports.set(decl.name, info);
  const vars = new Map(decl.params.map((p) => [p, fresh(p)] as const));
  decl.params.forEach((name, parameterIndex) =>
    recordTypeVariableDeclarationFact(
      facts,
      decl,
      parameterIndex,
      name,
      vars.get(name)!,
    )
  );
  info.recordFields = decl.fields.map((field) => ({
    name: field.name,
    type: typeFromAst(field.type, typeEnv, vars, {
      allowFreeVars: false,
      strEnv,
      onResolveName: (expression, resolved, qualifier) =>
        recordTypeReferenceFact(facts, expression, resolved, qualifier),
      onResolveType: (expression, type) => recordTypeExpressionFact(facts, expression, type),
      onResolveVariable: (expression, type) =>
        recordTypeVariableFact(facts, expression, type, decl.node),
    }),
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
  const result = named(info, decl.params.map((param) => vars.get(param)!));
  const constructorType = fn([callArg(info.recordFields.map((field) => field.type))], result);
  const constructor = {
    ...generalize(env, constructorType),
    status: "record-constructor" as const,
    node: decl.node,
  };
  bindValue(staticEnv(strEnv, typeEnv, env), decl.name, constructor);
  recordBindingFact(facts, decl.name, {
    subject: "binding",
    instantiated: constructor.type,
    general: constructor,
    origin: originForScheme(decl.name, constructor),
  });
  if (decl.exported) {
    exports.set(decl.name, constructor);
  }
}

function inferTypeDecl(
  decl: Extract<Decl, { kind: "TypeDecl" }>,
  env: Env,
  exports: Env,
  typeEnv: TypeEnv,
  strEnv: import("./environment.ts").StrEnv,
  typeExports: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  exportableTypeIds: Set<number>,
  facts: import("./type_facts.ts").TypeFacts,
) {
  rejectDuplicates(decl.params, "type parameter");
  const info = freshTypeInfo(decl.name, decl.params.length);
  recordTypeDeclarationFact(facts, decl, info);
  registerTypeInfo(typeEnv, info);
  bindType(staticEnv(strEnv, typeEnv, env), decl.name, info);
  if (decl.exported) typeExports.set(decl.name, info);
  if (decl.alias) {
    inferAliasDecl(decl, info, typeEnv, strEnv, exportableTypeIds, facts);
    return;
  }
  rejectDuplicates(decl.ctors.map((c) => c.name), "constructor");
  const vars = new Map(decl.params.map((p) => [p, fresh(p)] as const));
  decl.params.forEach((name, parameterIndex) =>
    recordTypeVariableDeclarationFact(
      facts,
      decl,
      parameterIndex,
      name,
      vars.get(name)!,
    )
  );
  const result = named(info, decl.params.map((p) => vars.get(p)!));
  const paramTypeIds = decl.params.map((p) => {
    const v = prune(vars.get(p)!);
    if (v.tag !== "var") throw new Error("invalid datatype type parameter");
    return v.id;
  });
  if (decl.exported) exportableTypeIds.add(info.id);
  const ctorTypes: Ty[][] = [];
  for (const c of decl.ctors) {
    const args = c.args.map((x) =>
      typeFromAst(x, typeEnv, vars, {
        allowFreeVars: false,
        strEnv,
        onResolveName: (expression, resolved, qualifier) =>
          recordTypeReferenceFact(facts, expression, resolved, qualifier),
        onResolveType: (expression, type) => recordTypeExpressionFact(facts, expression, type),
        onResolveVariable: (expression, type) =>
          recordTypeVariableFact(facts, expression, type, decl.node),
      })
    );
    ctorTypes.push(args);
    if (decl.exported) {
      args.forEach((arg) =>
        assertExportableType(arg, exportableTypeIds, `exported type ${decl.name}`)
      );
    }
    const t = args.length === 0 ? result : fn([callArg(args)], result);
    const scheme = {
      ...generalize(env, t),
      status: "constructor" as const,
      constructorDecl: c,
    };
    bindValue(staticEnv(strEnv, typeEnv, env), c.name, scheme);
    recordBindingFact(facts, c.name, {
      subject: "constructor",
      instantiated: scheme.type,
      general: scheme,
    });
    if (decl.exported) exports.set(c.name, scheme);
  }
  adts.set(info.id, { ...decl, type: info, paramTypeIds, ctorTypes });
}

function inferAliasDecl(
  decl: Extract<Decl, { kind: "TypeDecl" }>,
  info: TypeDeclInfo["type"],
  typeEnv: TypeEnv,
  strEnv: import("./environment.ts").StrEnv,
  exportableTypeIds: Set<number>,
  facts: import("./type_facts.ts").TypeFacts,
) {
  if (!decl.alias) return;
  if (referencesTypeName(decl.alias, decl.name, new Set(decl.params))) {
    throw new Error(`cyclic type alias ${decl.name}`);
  }
  const vars = new Map(decl.params.map((p) => [p, fresh(p)] as const));
  decl.params.forEach((name, parameterIndex) =>
    recordTypeVariableDeclarationFact(
      facts,
      decl,
      parameterIndex,
      name,
      vars.get(name)!,
    )
  );
  info.alias = typeFromAst(decl.alias, typeEnv, vars, {
    allowFreeVars: false,
    strEnv,
    onResolveName: (expression, resolved, qualifier) =>
      recordTypeReferenceFact(facts, expression, resolved, qualifier),
    onResolveType: (expression, type) => recordTypeExpressionFact(facts, expression, type),
    onResolveVariable: (expression, type) =>
      recordTypeVariableFact(facts, expression, type, decl.node),
  });
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
  context: InferContext,
  exports: Env,
  exportableTypeIds: Set<number>,
) {
  const binders = decl.bindings.flatMap((b) => patternBinders(b.pattern));
  rejectDuplicates(binders, "binding");
  const annotationVars: TypeVarScope = new Map();
  if (!decl.recursive) {
    inferNonRecursiveLet(decl, context, exports, exportableTypeIds, annotationVars);
    return;
  }
  inferRecursiveLet(decl, context, exports, exportableTypeIds, annotationVars);
}

function inferNonRecursiveLet(
  decl: Extract<Decl, { kind: "LetDecl" }>,
  context: InferContext,
  exports: Env,
  exportableTypeIds: Set<number>,
  annotationVars: TypeVarScope,
) {
  const { env, facts, warnings, diagnostics, provenance } = context;
  const base = new Map(env);
  const inferred = decl.bindings.map((b) =>
    inferBinding(
      b,
      deriveInferContext(context, { env: base }),
      annotationVars,
      decl.node,
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
      bindValue(staticEnv(context.strEnv, context.typeEnv, env), name, scheme);
      recordBindingFact(facts, name, {
        subject: "binding",
        instantiated: scheme.type,
        general: scheme,
        origin: originForScheme(name, scheme),
      });
      if (decl.bindings[i].pattern.kind === "PVar") {
        recordPatternFact(facts, decl.bindings[i].pattern, {
          subject: "pattern",
          instantiated: type,
          general: scheme,
          origin: originForScheme(name, scheme),
        });
      }
      if (decl.exported) {
        assertExportableType(scheme.type, exportableTypeIds, `exported value ${name}`);
        exports.set(name, scheme);
      }
    }
  });
}

function inferRecursiveLet(
  decl: Extract<Decl, { kind: "LetDecl" }>,
  context: InferContext,
  exports: Env,
  exportableTypeIds: Set<number>,
  annotationVars: TypeVarScope,
) {
  const { env, strEnv, typeEnv, types, facts, provenance } = context;
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
  decl.bindings.forEach((b, i) => {
    recordPatternType(facts, b.pattern, placeholders[i]);
    bindValue(staticEnv(strEnv, typeEnv, env), (b.pattern as { name: string }).name, {
      vars: [],
      type: placeholders[i],
      status: "value",
    });
  });
  decl.bindings.forEach((b, i) => {
    const name = (b.pattern as { name: string }).name;
    constrainBinding(
      name,
      placeholders[i],
      inferExpr(b.value, context),
      b.value,
      b.pattern.node,
      types,
      provenance,
    );
    if (b.annotation) {
      constrainAt(
        placeholders[i],
        typeFromAst(b.annotation, typeEnv, annotationVars, {
          strEnv,
          onResolveName: (expression, resolved, qualifier) =>
            recordTypeReferenceFact(facts, expression, resolved, qualifier),
          onResolveType: (expression, type) => recordTypeExpressionFact(facts, expression, type),
          onResolveVariable: (expression, type) =>
            recordTypeVariableFact(facts, expression, type, decl.node),
        }),
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
    bindValue(staticEnv(strEnv, typeEnv, env), name, scheme);
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
