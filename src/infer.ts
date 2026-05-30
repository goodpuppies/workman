import type { Expr, Module } from "./ast.ts";
import { diagnosticError, type FrontendDiagnostic } from "./diagnostics.ts";
import { inferDecl } from "./infer/decl.ts";
import { addAdts, addImport } from "./infer/imports.ts";
import { addExportableTypes, exportedAdts } from "./infer/module_exports.ts";
import { snapshotEnv, type TypeSnapshot } from "./infer/snapshots.ts";
import type { TypeProvenance } from "./infer/provenance.ts";
import {
  baseEnv,
  baseTypeEnv,
  type Env,
  ftv,
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
  adts: Map<number, TypeDeclInfo>;
  warnings: string[];
  diagnostics: FrontendDiagnostic[];
};

export { describeEnv, type TypeSnapshot } from "./infer/snapshots.ts";
export type InferStep = { declIndex: number; env: Map<string, TypeSnapshot> };

export function inferModule(module: Module, imports = new Map<string, InferResult>()): InferResult {
  return inferModuleWithSteps(module, imports).result;
}

export function inferModuleWithSteps(
  module: Module,
  imports = new Map<string, InferResult>(),
): { result: InferResult; steps: InferStep[] } {
  const env = baseEnv();
  const exports: Env = new Map();
  const typeEnv = baseTypeEnv();
  const typeExports: TypeEnv = new Map();
  const adts = new Map<number, TypeDeclInfo>();
  const exportableTypeIds = new Set([...typeEnv.values()].map((info) => info.id));
  const types = new Map<Expr, Ty>();
  const warnings: string[] = [];
  const diagnostics: FrontendDiagnostic[] = [];
  const steps: InferStep[] = [];
  const provenance: TypeProvenance = new Map();

  for (const [declIndex, decl] of module.decls.entries()) {
    if (decl.kind === "ImportDecl") {
      try {
        const imported = imports.get(decl.path);
        if (!imported) throw new Error(`unknown import ${decl.path}`);
        addImport(env, typeEnv, decl.clause, imported);
        addAdts(adts, imported.exportedStructure.adts);
        addExportableTypes(exportableTypeIds, imported.exportedStructure.types);
      } catch (error) {
        throw diagnosticError(error, decl.node);
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
        warnings,
        diagnostics,
        exportableTypeIds,
        provenance,
      );
    } catch (error) {
      throw diagnosticError(error, decl.node);
    }
    steps.push({ declIndex, env: snapshotEnv(env) });
  }

  assertNoTopLevelFreeTypeVars(env);
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
      adts,
      warnings,
      diagnostics,
    },
    steps,
  };
}

function assertNoTopLevelFreeTypeVars(env: Env) {
  const leaking = [...env.entries()]
    .filter(([, scheme]) => [...ftv(scheme.type)].some((id) => !scheme.vars.includes(id)))
    .map(([name, scheme]) => `${name}: ${showSchemeType(scheme)}`);
  if (leaking.length === 0) return;
  throw new Error(
    `top-level free type variable in ${
      leaking.join(", ")
    }; add an annotation or use it at a concrete type`,
  );
}

function showSchemeType(scheme: Scheme): string {
  return show(scheme.type);
}
