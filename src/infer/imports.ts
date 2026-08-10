import type { ImportClause } from "../ast.ts";
import { diagnosticError } from "../diagnostics.ts";
import {
  type Env,
  registerTypeInfo,
  type Scheme,
  type TypeDeclInfo,
  type TypeEnv,
} from "../types.ts";
import type { InferResult } from "../infer.ts";
import { inheritSchemeSource, rememberSchemeSourceDocument } from "./provenance.ts";
import {
  bindStructure,
  modifyStaticEnv,
  projectStaticEnv,
  type StaticEnv,
  staticEnv,
  type StrEnv,
} from "./environment.ts";

export function addImport(
  env: Env,
  typeEnv: TypeEnv,
  clause: ImportClause,
  imported: InferResult,
  options: {
    standardLibrary?: boolean;
    strEnv?: StrEnv;
  } = {},
): StaticEnv | undefined {
  registerStaticTypes(typeEnv, imported.exportedStructure);
  if (clause.kind === "Namespace") {
    const importedEnvironment = importedStaticEnv(imported.exportedStructure, options);
    bindStructure(
      staticEnv(options.strEnv ?? new Map(), typeEnv, env),
      clause.alias,
      importedEnvironment,
    );
    return importedEnvironment;
  }
  if (clause.kind === "All") {
    modifyStaticEnv(
      staticEnv(options.strEnv ?? new Map(), typeEnv, env),
      importedStaticEnv(imported.exportedStructure, options),
    );
    return undefined;
  }
  const values = new Set<string>();
  const types = new Set<string>();
  const structures = new Set<string>();
  const target = staticEnv(options.strEnv ?? new Map(), typeEnv, env);
  for (const spec of clause.specs) {
    const local = spec.alias ?? spec.name;
    const projected = projectStaticEnv(imported.exportedStructure, spec.name, local);
    if (!projected) {
      throw diagnosticError(new Error(`unknown import ${spec.name}`), spec.node);
    }
    if (projected.valEnv.size > 0) {
      if (values.has(local)) {
        throw diagnosticError(new Error(`duplicate value import ${local}`), spec.node);
      }
      values.add(local);
    }
    if (projected.tyEnv.size > 0) {
      if (types.has(local)) {
        throw diagnosticError(new Error(`duplicate type import ${local}`), spec.node);
      }
      types.add(local);
    }
    if (projected.strEnv.size > 0) {
      if (structures.has(local)) {
        throw diagnosticError(new Error(`duplicate structure import ${local}`), spec.node);
      }
      structures.add(local);
    }
    modifyStaticEnv(target, importedStaticEnv(projected, options));
  }
  return undefined;
}

function registerStaticTypes(typeEnv: TypeEnv, environment: StaticEnv): void {
  for (const info of environment.tyEnv.values()) registerTypeInfo(typeEnv, info);
  for (const nested of environment.strEnv.values()) registerStaticTypes(typeEnv, nested);
}

function importedStaticEnv(
  environment: StaticEnv,
  options: { standardLibrary?: boolean },
): StaticEnv {
  return staticEnv(
    new Map(
      [...environment.strEnv].map(([name, nested]) => [
        name,
        importedStaticEnv(nested, options),
      ]),
    ),
    new Map(environment.tyEnv),
    new Map(
      [...environment.valEnv].map(([name, scheme]) => [
        name,
        importedScheme(scheme, options),
      ]),
    ),
  );
}

export function addAdts(adts: Map<number, TypeDeclInfo>, imported: Map<number, TypeDeclInfo>) {
  for (const [id, info] of imported) adts.set(id, info);
}

/** Attach the owning source unit before this public environment crosses an import boundary. */
export function rememberExportedSourceDocument(
  result: InferResult,
  filePath: string,
  source: string,
): void {
  const visit = (environment: StaticEnv) => {
    for (const scheme of environment.valEnv.values()) {
      rememberSchemeSourceDocument(scheme, filePath, source);
    }
    for (const nested of environment.strEnv.values()) visit(nested);
  };
  visit(result.exportedStructure);
}

function importedScheme(scheme: Scheme, options: { standardLibrary?: boolean } = {}): Scheme {
  if (scheme.imported && (!options.standardLibrary || scheme.standardLibrary)) return scheme;
  const imported = {
    ...scheme,
    imported: true,
    standardLibrary: options.standardLibrary || scheme.standardLibrary,
  };
  inheritSchemeSource(scheme, imported);
  return imported;
}
