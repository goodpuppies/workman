import type { Expr, Module } from "./ast.ts";
import { diagnosticError, type FrontendDiagnostic } from "./diagnostics.ts";
import { inferDecl } from "./infer/decl.ts";
import { addAdts, addImport } from "./infer/imports.ts";
import { addExportableTypes, exportedAdts } from "./infer/module_exports.ts";
import { snapshotEnv, type TypeSnapshot } from "./infer/snapshots.ts";
import { createTypeFacts, type TypeFacts } from "./infer/type_facts.ts";
import type { TypeProvenance } from "./infer/provenance.ts";
import {
  baseAdts,
  baseEnv,
  baseTypeEnv,
  containsUnsolvedJsBoundary,
  type Env,
  prune,
  type Scheme,
  show,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
} from "./types.ts";

export type StructureEnv = { values: Env; types: TypeEnv; adts: Map<number, TypeDeclInfo> };

export type InferResult = {
  structure: StructureEnv;
  exportedStructure: StructureEnv;
  env: Env;
  exports: Env;
  typeEnv: TypeEnv;
  typeExports: TypeEnv;
  types: Map<Expr, Ty>;
  facts: TypeFacts;
  adts: Map<number, TypeDeclInfo>;
  warnings: string[];
  diagnostics: FrontendDiagnostic[];
};

export { describeEnv, type TypeSnapshot } from "./infer/snapshots.ts";
export type InferStep = { declIndex: number; env: Map<string, TypeSnapshot> };

export type InferModuleOptions = {
  initialImports?: InitialImport[];
};

export type InitialImport = {
  alias: string;
  result: InferResult;
};

export function inferModule(
  module: Module,
  imports = new Map<string, InferResult>(),
  options: InferModuleOptions = {},
): InferResult {
  return inferModuleWithSteps(module, imports, options).result;
}

export function inferModulePartial(
  module: Module,
  imports = new Map<string, InferResult>(),
  options: InferModuleOptions = {},
): InferResult {
  return inferModuleCore(module, imports, true, options).result;
}

export function inferModuleWithSteps(
  module: Module,
  imports = new Map<string, InferResult>(),
  options: InferModuleOptions = {},
): { result: InferResult; steps: InferStep[] } {
  return inferModuleCore(module, imports, false, options);
}

function inferModuleCore(
  module: Module,
  imports: Map<string, InferResult>,
  recover: boolean,
  options: InferModuleOptions,
): { result: InferResult; steps: InferStep[] } {
  const typeEnv = baseTypeEnv();
  const env = baseEnv(typeEnv);
  const exports: Env = new Map();
  const typeExports: TypeEnv = new Map();
  const adts = baseAdts(typeEnv);
  const exportableTypeIds = new Set([...typeEnv.values()].map((info) => info.id));
  const types = new Map<Expr, Ty>();
  const facts = createTypeFacts();
  const warnings: string[] = [];
  const diagnostics: FrontendDiagnostic[] = [];
  const steps: InferStep[] = [];
  const provenance: TypeProvenance = new Map();

  for (const initialImport of options.initialImports ?? []) {
    addImport(env, typeEnv, {
      kind: "Namespace",
      alias: initialImport.alias,
    }, initialImport.result);
    addAdts(adts, initialImport.result.exportedStructure.adts);
    addExportableTypes(exportableTypeIds, initialImport.result.exportedStructure.types);
  }

  for (const [declIndex, decl] of module.decls.entries()) {
    if (decl.kind === "ImportDecl") {
      try {
        const imported = imports.get(decl.path);
        if (!imported) throw new Error(`unknown import ${decl.path}`);
        addImport(env, typeEnv, decl.clause, imported);
        addAdts(adts, imported.exportedStructure.adts);
        addExportableTypes(exportableTypeIds, imported.exportedStructure.types);
      } catch (error) {
        const diagnostic = diagnosticError(error, decl.node);
        if (!recover) throw diagnostic;
        diagnostics.push(diagnostic.diagnostic);
        break;
      }
      continue;
    }

    try {
      inferDecl(
        decl,
        env,
        exports,
        typeEnv,
        typeExports,
        adts,
        types,
        facts,
        warnings,
        diagnostics,
        exportableTypeIds,
        provenance,
      );
    } catch (error) {
      const diagnostic = diagnosticError(error, decl.node);
      if (!recover) throw diagnostic;
      diagnostics.push(diagnostic.diagnostic);
      break;
    }
    steps.push({ declIndex, env: snapshotEnv(env) });
  }

  try {
    assertNoTopLevelUnresolvedFfi(env);
    assertNoTopLevelUnsolvedJsBoundary(env);
  } catch (error) {
    const diagnostic = diagnosticError(error, module.node);
    if (!recover) throw diagnostic;
    diagnostics.push(diagnostic.diagnostic);
  }
  const structure: StructureEnv = { values: env, types: typeEnv, adts };
  const exportedStructure: StructureEnv = {
    values: exports,
    types: typeExports,
    adts: exportedAdts(adts, typeExports),
  };
  return {
    result: {
      structure,
      exportedStructure,
      env,
      exports,
      typeEnv,
      typeExports,
      types,
      facts,
      adts,
      warnings,
      diagnostics,
    },
    steps,
  };
}

function assertNoTopLevelUnresolvedFfi(env: Env) {
  const leaking = [...env.entries()].filter(([, scheme]) => containsUnresolvedFfi(scheme.type));
  if (leaking.length === 0) return;
  const [name, scheme] = leaking[0];
  const remaining = leaking.length > 1
    ? `; ${leaking.length - 1} more binding(s) also have unresolved JS FFI obligations`
    : "";
  throw diagnosticError(
    new Error(
      `unresolved JS FFI obligation in ${name}: ${
        showSchemeType(scheme)
      }; this JS member access must be resolved by FFI reflection before it can escape a top-level binding${remaining}`,
    ),
    scheme.node,
  );
}

function assertNoTopLevelUnsolvedJsBoundary(env: Env) {
  const leaking = [...env.entries()].filter(([, scheme]) =>
    !scheme.basis && containsUnsolvedJsBoundary(scheme.type)
  );
  if (leaking.length === 0) return;
  const [name, scheme] = leaking[0];
  const remaining = leaking.length > 1
    ? `; ${leaking.length - 1} more binding(s) also have unsolved JS boundary types`
    : "";
  throw diagnosticError(
    new Error(
      `unsolved JS boundary type in ${name}: ${
        showSchemeType(scheme)
      }; a broad Js.Value JS parameter leaves this type undetermined and no call site determines it; annotate it with the concrete JS shape${remaining}`,
    ),
    scheme.node,
  );
}

function containsUnresolvedFfi(type: Ty): boolean {
  const target = prune(type);
  if (target.tag === "ffi") return true;
  if (target.tag === "fn") {
    return target.params.some(containsUnresolvedFfi) || containsUnresolvedFfi(target.result);
  }
  if (target.tag === "tuple") return target.items.some(containsUnresolvedFfi);
  if (target.tag === "struct") {
    return target.fields.some((field) => containsUnresolvedFfi(field.type));
  }
  if (target.tag === "named") return target.args.some(containsUnresolvedFfi);
  return false;
}

function showSchemeType(scheme: Scheme): string {
  return show(scheme.type);
}
