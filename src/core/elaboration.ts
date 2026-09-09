import type { Module } from "../ast.ts";
import type { BindingFacts } from "../binding_facts.ts";
import type { CompilerSemanticId } from "../compiler_semantics.ts";
import type { GpuOperatorId } from "../gpu_operators.ts";
import type { InferResult } from "../infer.ts";
import type { GpuOperationObligation, GpuResourceCallFact } from "../infer/type_facts.ts";
import type { CompilerIdAllocator } from "../ids.ts";
import type { NominalFacts } from "../nominal_facts.ts";
import type { NodeId } from "../source.ts";
import type { Ty } from "../types.ts";
import type { CoreModule } from "./ast.ts";
import { sharedCoreFromSurface } from "./from_surface.ts";

export type SharedCoreExpressionFact = Readonly<{
  type: Ty;
  semanticId?: CompilerSemanticId;
  operatorId?: GpuOperatorId;
  gpuBuiltin?: string;
  gpuOperation?: GpuOperationObligation;
  gpuResourceCall?: GpuResourceCallFact;
}>;

export type SharedCorePatternFact = Readonly<{
  type: Ty;
}>;

/** Semantic facts addressed by the source ids retained on Core nodes. */
export type SharedCoreFacts = Readonly<{
  expressions: ReadonlyMap<NodeId, SharedCoreExpressionFact>;
  patterns: ReadonlyMap<NodeId, SharedCorePatternFact>;
}>;

/** The common, typed input from which individual backend lowerings fork. */
export type SharedCoreModule = Readonly<{
  module: CoreModule;
  facts: SharedCoreFacts;
}>;

export function elaborateSharedCore(
  module: Module,
  analysis: InferResult,
  bindings?: BindingFacts,
  ids?: CompilerIdAllocator,
  nominalFacts?: NominalFacts,
  sourceContext: { path: string; source: string } = { path: "<source>", source: "" },
): SharedCoreModule {
  return {
    module: sharedCoreFromSurface(
      module,
      analysis,
      bindings,
      ids,
      nominalFacts,
      sourceContext,
    ),
    facts: sharedCoreFacts(analysis),
  };
}

function sharedCoreFacts(analysis: InferResult): SharedCoreFacts {
  const expressions = new Map<NodeId, SharedCoreExpressionFact>();
  for (const [expression, type] of analysis.types) {
    const id = expression.node?.id;
    if (id === undefined) continue;
    const inferred = analysis.facts.expressions.get(expression);
    expressions.set(id, {
      type,
      ...(inferred?.origin?.semanticId ? { semanticId: inferred.origin.semanticId } : {}),
      ...optionalExpressionFact(
        "operatorId",
        expression.kind === "Binary" || expression.kind === "Unary"
          ? analysis.facts.operators.get(expression)
          : undefined,
      ),
      ...optionalExpressionFact(
        "gpuBuiltin",
        analysis.facts.gpuBuiltins.get(expression),
      ),
      ...optionalExpressionFact("gpuOperation", analysis.facts.gpuOperations.get(expression)),
      ...optionalExpressionFact(
        "gpuResourceCall",
        expression.kind === "Call" ? analysis.facts.gpuResourceCalls.get(expression) : undefined,
      ),
    });
  }

  const patterns = new Map<NodeId, SharedCorePatternFact>();
  for (const [pattern, type] of analysis.facts.patternTypes) {
    if (pattern.node?.id !== undefined) patterns.set(pattern.node.id, { type });
  }
  return { expressions, patterns };
}

function optionalExpressionFact<K extends keyof SharedCoreExpressionFact>(
  key: K,
  value: SharedCoreExpressionFact[K] | undefined,
): Pick<SharedCoreExpressionFact, K> | Record<never, never> {
  return value === undefined ? {} : { [key]: value } as Pick<SharedCoreExpressionFact, K>;
}
