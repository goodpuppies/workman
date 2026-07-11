import type { ImportClause } from "../ast.ts";
import { basisCtorNamesForType } from "../basis.ts";
import { diagnosticError } from "../diagnostics.ts";
import type { Env, Scheme, TypeDeclInfo, TypeEnv } from "../types.ts";
import type { InferResult } from "../infer.ts";

export function addImport(
  env: Env,
  typeEnv: TypeEnv,
  clause: ImportClause,
  imported: InferResult,
  options: { standardLibrary?: boolean } = {},
) {
  if (clause.kind === "Namespace") {
    addQualifiedImport(env, clause.alias, imported.exportedStructure.values, clause, options);
    addQualifiedTypes(typeEnv, clause.alias, imported.exportedStructure.types, clause);
    return;
  }
  if (clause.kind === "All") {
    addAllImports(
      env,
      typeEnv,
      imported.exportedStructure.values,
      imported.exportedStructure.types,
      clause,
      options,
    );
    return;
  }
  const values = new Set<string>();
  const types = new Set<string>();
  for (const spec of clause.specs) {
    const local = spec.alias ?? spec.name;
    const value = imported.exportedStructure.values.get(spec.name);
    const type = imported.exportedStructure.types.get(spec.name);
    if (!value && !type) {
      throw diagnosticError(new Error(`unknown import ${spec.name}`), spec.node);
    }
    if (value) {
      if (values.has(local) || isUserValue(env, local)) {
        throw diagnosticError(new Error(`duplicate value import ${local}`), spec.node);
      }
      values.add(local);
      env.set(local, importedScheme(value, options));
    }
    if (type) {
      if (types.has(local) || isUserType(typeEnv, local)) {
        throw diagnosticError(new Error(`duplicate type import ${local}`), spec.node);
      }
      types.add(local);
      if (typeEnv.get(local)?.basis) removeBasisConstructors(env, local);
      typeEnv.set(local, type);
    }
  }
}

export function addAdts(adts: Map<number, TypeDeclInfo>, imported: Map<number, TypeDeclInfo>) {
  for (const [id, info] of imported) adts.set(id, info);
}

function addQualifiedImport(
  env: Env,
  alias: string,
  imported: Env,
  clause: ImportClause,
  options: { standardLibrary?: boolean },
) {
  for (const [name, scheme] of imported) {
    const local = `${alias}.${name}`;
    if (isUserValue(env, local)) {
      throw diagnosticError(new Error(`duplicate value import ${local}`), clause.node);
    }
    env.set(local, importedScheme(scheme, options));
  }
}

function addQualifiedTypes(
  typeEnv: TypeEnv,
  alias: string,
  imported: TypeEnv,
  clause: ImportClause,
) {
  for (const [name, info] of imported) {
    const local = `${alias}.${name}`;
    if (isUserType(typeEnv, local)) {
      throw diagnosticError(new Error(`duplicate type import ${local}`), clause.node);
    }
    typeEnv.set(local, info);
  }
}

function addAllImports(
  env: Env,
  typeEnv: TypeEnv,
  values: Env,
  types: TypeEnv,
  clause: ImportClause,
  options: { standardLibrary?: boolean },
) {
  for (const name of values.keys()) {
    if (isUserValue(env, name)) {
      throw diagnosticError(new Error(`duplicate value import ${name}`), clause.node);
    }
  }
  for (const name of types.keys()) {
    if (isUserType(typeEnv, name)) {
      throw diagnosticError(new Error(`duplicate type import ${name}`), clause.node);
    }
  }
  for (const [name, scheme] of values) env.set(name, importedScheme(scheme, options));
  for (const [name, info] of types) {
    if (typeEnv.get(name)?.basis) removeBasisConstructors(env, name);
    typeEnv.set(name, info);
  }
}

function isUserValue(env: Env, name: string): boolean {
  const existing = env.get(name);
  return !!existing && !existing.basis;
}

function importedScheme(scheme: Scheme, options: { standardLibrary?: boolean } = {}): Scheme {
  if (scheme.imported && (!options.standardLibrary || scheme.standardLibrary)) return scheme;
  return {
    ...scheme,
    imported: true,
    standardLibrary: options.standardLibrary || scheme.standardLibrary,
  };
}

function isUserType(typeEnv: TypeEnv, name: string): boolean {
  const existing = typeEnv.get(name);
  return !!existing && !existing.basis;
}

function removeBasisConstructors(env: Env, typeName: string) {
  for (const name of basisCtorNamesForType(typeName)) {
    if (env.get(name)?.basis) env.delete(name);
  }
}
