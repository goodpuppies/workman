import type { Expr, ImportClause, Module } from "./ast.ts";
import { diagnosticError, type FrontendDiagnostic } from "./diagnostics.ts";
import { inferDecl } from "./infer/decl.ts";
import { hostTypingDialect, type InferContext } from "./infer/context.ts";
import { addAdts, addImport } from "./infer/imports.ts";
import { addExportableTypes, exportedAdts } from "./infer/module_exports.ts";
import { snapshotEnv, type TypeSnapshot } from "./infer/snapshots.ts";
import { createTypeFacts, type TypeFacts } from "./infer/type_facts.ts";
import type { TypeProvenance } from "./infer/provenance.ts";
import { warnWideTuples } from "./infer/wide_tuples.ts";
import {
  snapshotStaticEnv,
  type StaticEnv,
  staticEnv,
} from "./infer/environment.ts";
import {
  basisProfile,
  initialBasis,
  type InitialBasis,
} from "./initial_basis.ts";
import type { SourceSpan } from "./source.ts";
import {
  containsUnsolvedJsBoundary,
  type Env,
  knownTypeIds,
  prune,
  type Scheme,
  show,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
} from "./types.ts";

export type StructureEnv = StaticEnv & { adts: Map<number, TypeDeclInfo> };

export type InferResult = {
  basis: InitialBasis;
  structure: StructureEnv;
  exportedStructure: StructureEnv;
  initialStructure: StaticEnv;
  env: Env;
  exports: Env;
  typeEnv: TypeEnv;
  typeExports: TypeEnv;
  types: Map<Expr, Ty>;
  facts: TypeFacts;
  adts: Map<number, TypeDeclInfo>;
  warnings: string[];
  diagnostics: FrontendDiagnostic[];
  elaboration: InferElaboration;
  steps: InferStep[];
};

export type InferElaboration = Readonly<{
  complete: boolean;
  declarationPrefix: number;
  failure?: "import" | "declaration" | "final";
  recoveryBoundaries: readonly Readonly<Pick<SourceSpan, "start" | "end">>[];
}>;

export { describeEnv, type TypeSnapshot } from "./infer/snapshots.ts";
export type InferStep = { declIndex: number; env: Map<string, TypeSnapshot> };

export type InferModuleOptions = {
  initialImports?: InitialImport[];
  initialBasis?: InitialBasis;
};

export type InitialImport = {
  clause: ImportClause;
  result: InferResult;
  standard?: boolean;
};

export type RecoveredInferResult = Readonly<{
  module: Module;
  result: InferResult;
}>;

export function inferModule(
  module: Module,
  imports = new Map<string, InferResult>(),
  options: InferModuleOptions = {},
): InferResult {
  return inferModuleCore(module, imports, false, options, true).result;
}

export function inferModulePartial(
  module: Module,
  imports = new Map<string, InferResult>(),
  options: InferModuleOptions = {},
): InferResult {
  return inferModuleCore(module, imports, true, options, false).result;
}

export function inferModuleWithSteps(
  module: Module,
  imports = new Map<string, InferResult>(),
  options: InferModuleOptions = {},
): { result: InferResult; steps: InferStep[] } {
  return inferModuleCore(module, imports, false, options, true);
}

/**
 * Continue after independently recoverable top-level failures.
 *
 * Each retry starts from the initial basis and re-elaborates only declarations that have already
 * been certified. This is the static counterpart of SML's transactional top-level phrase rule.
 */
export function inferModuleRecovered(
  module: Module,
  imports = new Map<string, InferResult>(),
  options: InferModuleOptions = {},
): RecoveredInferResult {
  let decls = [...module.decls];
  const diagnostics: FrontendDiagnostic[] = [];
  const recoveryBoundaries: { start: number; end: number }[] = [];
  let firstFailure: "import" | "declaration" | undefined;

  while (true) {
    const candidate: Module = { ...module, decls };
    const result = inferModulePartial(candidate, imports, options);
    const failure = result.elaboration.failure;
    if (failure !== "import" && failure !== "declaration") {
      if (diagnostics.length > 0) {
        result.diagnostics = [...diagnostics, ...result.diagnostics];
        result.elaboration = Object.freeze({
          complete: false,
          declarationPrefix: decls.length,
          failure: firstFailure,
          recoveryBoundaries: Object.freeze([
            ...recoveryBoundaries,
            ...result.elaboration.recoveryBoundaries,
          ]),
        });
      }
      return Object.freeze({ module: candidate, result });
    }

    const failedIndex = result.elaboration.declarationPrefix;
    const failed = decls[failedIndex];
    if (!failed) return Object.freeze({ module: candidate, result });
    const diagnostic = result.diagnostics.findLast((item) => item.severity === "error");
    if (diagnostic) diagnostics.push(diagnostic);
    if (failed.node) {
      recoveryBoundaries.push({
        start: failed.node.span.start,
        end: failed.node.span.end,
      });
    }
    firstFailure ??= failure;
    decls = decls.filter((_, index) => index !== failedIndex);
  }
}

function inferModuleCore(
  module: Module,
  imports: Map<string, InferResult>,
  recover: boolean,
  options: InferModuleOptions,
  captureSteps: boolean,
): { result: InferResult; steps: InferStep[] } {
  const includePrelude = module.prelude !== "none";
  const basisArtifact = options.initialBasis ?? initialBasis(basisProfile(includePrelude));
  if (basisArtifact.profile.name !== basisProfile(includePrelude).name) {
    throw new Error(
      `initial basis profile ${basisArtifact.profile.name} does not match module profile ${
        basisProfile(includePrelude).name
      }`,
    );
  }
  const basis = basisArtifact.instantiate();
  const { strEnv, tyEnv: typeEnv, valEnv: env } = basis.environment;
  const exports: Env = new Map();
  const typeExports: TypeEnv = new Map();
  const adts = basis.adts;
  const exportableTypeIds = knownTypeIds(typeEnv);
  const types = new Map<Expr, Ty>();
  const facts = createTypeFacts();
  const warnings: string[] = [];
  const diagnostics: FrontendDiagnostic[] = [];
  const steps: InferStep[] = [];
  const provenance: TypeProvenance = new Map();
  const context: InferContext = {
    env,
    strEnv,
    operators: basis.operators,
    typeEnv,
    adts,
    types,
    facts,
    warnings,
    diagnostics,
    provenance,
    dialect: hostTypingDialect,
  };
  warnWideTuples(module, warnings, diagnostics);

  for (const initialImport of includePrelude ? options.initialImports ?? [] : []) {
    addImport(env, typeEnv, initialImport.clause, initialImport.result, {
      standardLibrary: initialImport.standard,
      strEnv,
    });
    addAdts(adts, initialImport.result.exportedStructure.adts);
    addExportableTypes(exportableTypeIds, initialImport.result.exportedStructure.tyEnv);
  }
  const initialStructure = snapshotStaticEnv(staticEnv(strEnv, typeEnv, env));

  for (const [declIndex, decl] of module.decls.entries()) {
    if (decl.kind === "ImportDecl") {
      try {
        const imported = imports.get(decl.path);
        if (!imported) throw new Error(`unknown import ${decl.path}`);
        const importedStructure = addImport(env, typeEnv, decl.clause, imported, {
          strEnv,
        });
        if (importedStructure) facts.structureImports.set(decl, importedStructure);
        addAdts(adts, imported.exportedStructure.adts);
        addExportableTypes(exportableTypeIds, imported.exportedStructure.tyEnv);
      } catch (error) {
        const diagnostic = diagnosticError(error, decl.node);
        if (!recover) throw diagnostic;
        return partialPrefixResult(
          module,
          imports,
          options,
          captureSteps,
          declIndex,
          "import",
          diagnostic.diagnostic,
          decl.node?.span,
        );
      }
      continue;
    }

    try {
      inferDecl(
        decl,
        context,
        exports,
        typeExports,
        exportableTypeIds,
      );
    } catch (error) {
      const diagnostic = diagnosticError(error, decl.node);
      if (!recover) throw diagnostic;
      return partialPrefixResult(
        module,
        imports,
        options,
        captureSteps,
        declIndex,
        "declaration",
        diagnostic.diagnostic,
        decl.node?.span,
      );
    }
    if (captureSteps) steps.push({ declIndex, env: snapshotEnv(env) });
  }

  try {
    assertNoTopLevelUnresolvedFfi(env);
    assertNoConsumedUnresolvedFfi(facts);
    assertNoTopLevelUnsolvedJsBoundary(env);
  } catch (error) {
    const diagnostic = diagnosticError(error, module.node);
    if (!recover) throw diagnostic;
    diagnostics.push(diagnostic.diagnostic);
  }
  const complete = diagnostics.every((diagnostic) => diagnostic.severity !== "error");
  const recoveryBoundaries = complete || !module.node
    ? []
    : [{ start: module.node.span.start, end: module.node.span.end }];
  const structure: StructureEnv = { ...staticEnv(strEnv, typeEnv, env), adts };
  // Executable form of the normative nested-`local` translation: imports modify only the working
  // environment, while each body declaration modifies both working and public environments.
  // Thus imported/basis bindings are in scope but cannot enter the returned environment.
  const publicEnvironment = staticEnv(new Map(), typeExports, exports);
  const exportedStructure: StructureEnv = {
    ...publicEnvironment,
    adts: exportedAdts(adts, typeExports),
  };
  return {
    result: {
      basis: basisArtifact,
      structure,
      exportedStructure,
      initialStructure,
      env,
      exports,
      typeEnv,
      typeExports,
      types,
      facts,
      adts,
      warnings,
      diagnostics,
      elaboration: Object.freeze({
        complete,
        declarationPrefix: module.decls.length,
        failure: complete ? undefined : "final",
        recoveryBoundaries: Object.freeze(recoveryBoundaries),
      }),
      steps,
    },
    steps,
  };
}

function partialPrefixResult(
  module: Module,
  imports: Map<string, InferResult>,
  options: InferModuleOptions,
  captureSteps: boolean,
  declarationPrefix: number,
  failure: "import" | "declaration",
  diagnostic: FrontendDiagnostic,
  boundary: SourceSpan | undefined,
): { result: InferResult; steps: InferStep[] } {
  // Inference types are mutable. Re-elaborating the accepted prefix is the conservative
  // transaction boundary: constraints or facts produced while attempting the failed declaration
  // cannot leak into the interface for preceding declarations.
  const prefix: Module = {
    ...module,
    decls: module.decls.slice(0, declarationPrefix),
  };
  const clean = inferModuleCore(prefix, imports, true, options, captureSteps);
  clean.result.diagnostics = [...clean.result.diagnostics, diagnostic];
  const recoveryBoundaries = [
    ...clean.result.elaboration.recoveryBoundaries,
    ...(boundary ? [{ start: boundary.start, end: boundary.end }] : []),
  ];
  clean.result.elaboration = Object.freeze({
    complete: false,
    declarationPrefix,
    failure,
    recoveryBoundaries: Object.freeze(recoveryBoundaries),
  });
  return clean;
}

function assertNoConsumedUnresolvedFfi(facts: TypeFacts) {
  const consumed = [...facts.ffi.values()].find((fact) =>
    fact.status === "unresolved" && fact.consumed
  );
  if (!consumed?.consumed) return;
  throw diagnosticError(
    new Error(
      `${consumed.consumed.message}: ?ffi#${consumed.id}:${consumed.path.join(".")}`,
    ),
    consumed.expr?.node,
  );
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
