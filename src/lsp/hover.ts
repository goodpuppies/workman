import { elaborateProjectGpuSemantics } from "../compiler.ts";
import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import {
  type DeepReadonly,
  type ModuleInterface,
  type ProjectSnapshot,
  type SemanticGpuElaboratedSlice,
  semanticOccurrencesAt,
  type SemanticOccurrenceType,
  type SemanticTypedNode,
  semanticTypedNodeAt,
} from "../module_interface.ts";
import { lineColToOffset, lineStarts, type SourceSpan } from "../source.ts";
import type { GpuSliceOccurrenceTypeDto, GpuSliceShaderTypeDto } from "../wmslang/v2_dto.ts";
import { semanticDocumentContext } from "./semantic_context.ts";
import type { SemanticService } from "./semantic_service.ts";
import { renderSemanticType } from "./hover_type_display.ts";

export type LspHover = {
  contents: { kind: "markdown"; value: string };
};

export async function hoverAt(
  uri: string,
  position: { line: number; character: number },
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
  service?: SemanticService,
): Promise<LspHover | null> {
  const context = await semanticDocumentContext(uri, sourceOverrides, options, service);
  if (!context) return null;
  const { project, moduleInterface, source } = context;
  const offset = lineColToOffset(position.line + 1, position.character, lineStarts(source));
  if (pipeOperatorAt(source, offset)) return null;

  const gpu = await gpuHoverContext(project, moduleInterface);
  if (gpu?.kind === "resolved") {
    const hover = gpuHoverAt(offset, moduleInterface, gpu.slices);
    if (hover) return hover;
  } else if (
    gpu?.kind === "unresolved" &&
    moduleInterface.gpuFacts.roots.some((root) => contains(root.span, offset))
  ) {
    return unresolvedGpuHover(offset, moduleInterface);
  }
  return semanticHoverAt(offset, moduleInterface);
}

function semanticHoverAt(
  offset: number,
  moduleInterface: ModuleInterface,
): LspHover | null {
  const ffiCall = moduleInterface.ffiFacts.calls
    .filter((call) => contains(call.span, offset))
    .sort((left, right) => spanWidth(left.span) - spanWidth(right.span))[0];
  if (ffiCall) {
    return semanticTypeHover(
      ffiCall.label,
      ffiCall.type,
      undefined,
      moduleInterface,
      ffiCall.receiverElided,
    );
  }
  const typed = semanticTypedNodeAt(moduleInterface, offset);
  if (typed) return typedNodeHover(typed, moduleInterface);

  for (const occurrence of semanticOccurrencesAt(moduleInterface, offset)) {
    if (occurrence.inferredType) {
      return semanticTypeHover(
        occurrence.name,
        occurrence.inferredType,
        undefined,
        moduleInterface,
      );
    }
    if (occurrence.target.kind === "type") return hoverCode(`type ${occurrence.name}`);
  }
  return null;
}

function typedNodeHover(
  node: SemanticTypedNode,
  moduleInterface: ModuleInterface,
): LspHover {
  return semanticTypeHover(
    node.label,
    node.type,
    node.generalType,
    moduleInterface,
    node.presentation === "generated-ffi-receiver",
  );
}

function semanticTypeHover(
  label: string,
  type: SemanticOccurrenceType,
  generalType: SemanticOccurrenceType | undefined,
  moduleInterface: ModuleInterface,
  dropReceiver = false,
): LspHover {
  const instantiated = renderSemanticType(moduleInterface, type.id, dropReceiver);
  const general = generalType
    ? renderSemanticType(moduleInterface, generalType.id, dropReceiver)
    : undefined;
  return general && general !== instantiated
    ? hoverCode(`${label}\ntype: ${instantiated}\ngeneral: ${general}`)
    : hoverCode(`${label}: ${instantiated}`);
}

type GpuHoverSliceContext =
  & SemanticGpuElaboratedSlice
  & Readonly<{ moduleInterface: ModuleInterface }>;

type GpuHoverState =
  | Readonly<{ kind: "resolved"; slices: readonly GpuHoverSliceContext[] }>
  | Readonly<{ kind: "unresolved" }>;

async function gpuHoverContext(
  project: ProjectSnapshot,
  moduleInterface: ModuleInterface,
): Promise<GpuHoverState | undefined> {
  const hasRoots = [...project.interfaces.values()].some((item) => item.gpuFacts.roots.length > 0);
  const hasSlices = [...project.interfaces.values()].some((item) =>
    item.gpuFacts.slices.length > 0
  );
  if (!hasSlices) return hasRoots ? Object.freeze({ kind: "unresolved" }) : undefined;
  try {
    const elaboration = await elaborateProjectGpuSemantics(project);
    return Object.freeze({
      kind: "resolved",
      slices: Object.freeze(
        [...elaboration.modules.values()].flatMap((slices) =>
          slices.map((slice) => Object.freeze({ ...slice, moduleInterface }))
        ),
      ),
    });
  } catch {
    return Object.freeze({ kind: "unresolved" });
  }
}

function gpuHoverAt(
  offset: number,
  moduleInterface: ModuleInterface,
  slices: readonly GpuHoverSliceContext[],
): LspHover | null {
  const resource = moduleInterface.gpuFacts.resources
    .filter((candidate) =>
      contains(candidate.span, offset) &&
      offset < candidate.span.start + candidate.receiverName.length
    )
    .sort((left, right) => spanWidth(left.span) - spanWidth(right.span))[0];
  if (resource) {
    const label = `${resource.receiverName}.${resource.operation === "sample" ? "Sample" : "Load"}`;
    return hoverCode(
      `${label}: ${renderSemanticType(moduleInterface, resource.receiverType)}`,
    );
  }
  const builtin = gpuBuiltinHover(offset, moduleInterface, slices);
  if (builtin) return builtin;

  const typed = semanticTypedNodeAt(moduleInterface, offset);
  const occurrence = semanticOccurrencesAt(moduleInterface, offset)
    .find((item) => item.target.kind === "value");
  const bindingId = occurrence?.target.kind === "value" &&
      typeof occurrence.target.id === "number"
    ? occurrence.target.id
    : undefined;
  const label = typed?.label ?? occurrence?.name ?? "GPU expression";
  const types: string[] = [];

  for (const context of slices) {
    let specialized: readonly DeepReadonly<GpuSliceOccurrenceTypeDto>[] = [];
    if (bindingId !== undefined) {
      const functionIds = new Set(
        context.input.functions
          .filter((candidate) => candidate.sourceBindingId === bindingId)
          .map((candidate) => candidate.id),
      );
      specialized = context.elaboration.occurrences.filter((candidate) =>
        candidate.kind === "function" && functionIds.has(candidate.sourceId)
      );
    }
    if (specialized.length === 0 && typed?.kind !== "type-expression") {
      specialized = matchingGpuOccurrences(typed?.kind, typed?.span, context);
      const expectedKind = typed && normalizedExpressionKind(typed);
      if (expectedKind) {
        const exact = specialized.filter((candidate) =>
          candidate.kind === "expression" &&
          context.input.expressions.find((expression) => expression.id === candidate.sourceId)
              ?.kind === expectedKind
        );
        if (exact.length > 0) specialized = exact;
      }
    }
    types.push(...specialized.flatMap((item) => {
      const type = context.elaboration.shaderTypes.find((candidate) =>
        candidate.id === item.shaderTypeId
      );
      return type ? [showGpuType(type, context)] : [];
    }));
  }
  const unique = [...new Set(types)].sort();
  if (unique.length === 0) return null;
  return unique.length === 1 ? hoverCode(`${label}: ${unique[0]}`) : hoverCode(
    `${label}\nGPU specializations:\n${unique.map((type) => `- ${type}`).join("\n")}`,
  );
}

function normalizedExpressionKind(node: SemanticTypedNode): string | undefined {
  if (node.kind !== "expression") return undefined;
  if (node.label === "Int" || node.label === "Float") return "number";
  if (node.label === "Bool") return "bool";
  if (node.label === "Void") return "void";
  if (node.label.includes(".")) return "project";
  const structural = new Set([
    "Tuple",
    "Call",
    "If",
    "Match",
    "Block",
    "Binary",
    "Unary",
  ]);
  return structural.has(node.label) ? node.label.toLowerCase() : undefined;
}

function gpuBuiltinHover(
  offset: number,
  moduleInterface: ModuleInterface,
  slices: readonly GpuHoverSliceContext[],
): LspHover | null {
  const fact = moduleInterface.gpuFacts.builtins.find((candidate) =>
    candidate.span.start <= offset &&
    offset < Math.min(candidate.span.end, candidate.span.start + candidate.name.length)
  );
  if (!fact) return null;
  const signatures: string[] = [];
  for (const context of slices) {
    const sources = context.input.expressions.filter((expression) => {
      if (expression.kind !== "builtin" || expression.builtinName !== fact.name) return false;
      const span = context.input.spans.find((candidate) => candidate.id === expression.spanId);
      return span?.path === moduleInterface.path &&
        sameSpan(span, fact.span);
    });
    for (const source of sources) {
      const selection = context.elaboration.builtinSelections.find((candidate) =>
        candidate.expressionId === source.id
      );
      const overload = context.input.builtinCatalog.overloads.find((candidate) =>
        candidate.id === selection?.overloadId
      );
      if (overload) {
        const domain = overload.params.length === 0
          ? "Void"
          : overload.params.length === 1
          ? overload.params[0]
          : `(${overload.params.join(", ")})`;
        signatures.push(`${domain} -> ${overload.result}`);
      }
    }
  }
  const unique = [...new Set(signatures)].sort();
  if (unique.length === 0) return null;
  return unique.length === 1 ? hoverCode(`${fact.name}: ${unique[0]}`) : hoverCode(
    `${fact.name}\nGPU specializations:\n${unique.map((item) => `- ${item}`).join("\n")}`,
  );
}

function matchingGpuOccurrences(
  kind: SemanticTypedNode["kind"] | undefined,
  span: SourceSpan | undefined,
  context: GpuHoverSliceContext,
): readonly DeepReadonly<GpuSliceOccurrenceTypeDto>[] {
  if (!kind || !span || kind === "type-expression") return [];
  const spanIds = new Set(
    context.input.spans
      .filter((candidate) =>
        candidate.path === context.moduleInterface.path && sameSpan(candidate, span)
      )
      .map((candidate) => candidate.id),
  );
  return context.elaboration.occurrences.filter((candidate) =>
    candidate.kind === kind && spanIds.has(candidate.spanId)
  );
}

function showGpuType(
  type: DeepReadonly<GpuSliceShaderTypeDto>,
  context: GpuHoverSliceContext,
): string {
  const byId = new Map(
    context.elaboration.shaderTypes.map((candidate) => [candidate.id, candidate]),
  );
  const show = (current: DeepReadonly<GpuSliceShaderTypeDto>): string => {
    if (
      current.kind === "f32" || current.kind === "i32" || current.kind === "bool" ||
      current.kind === "void"
    ) return current.kind;
    if (current.kind === "vector") {
      const scalar = byId.get(current.items[0]);
      return `${scalar?.kind === "i32" ? "i32" : "f32"}x${current.items.length}`;
    }
    if (current.kind === "sampled-texture-2d") return "Gpu.SampledTexture2D";
    if (current.kind === "sampler") return "Gpu.Sampler";
    if (current.kind === "tuple") {
      return `(${current.items.map((id) => show(byId.get(id)!)).join(", ")})`;
    }
    if (current.kind === "function") {
      const params = current.params.map((id) => byId.get(id)!);
      const rendered = params.map(show);
      const domain = params.length === 0
        ? "Void"
        : params.length === 1
        ? params[0].kind === "function" ? `(${rendered[0]})` : rendered[0]
        : `(${rendered.join(", ")})`;
      return `${domain} -> ${show(byId.get(current.result)!)}`;
    }
    return context.input.adts.find((adt) => adt.typeNameId === current.typeNameId)?.name ??
      `adt#${current.typeNameId}`;
  };
  return show(type);
}

function unresolvedGpuHover(
  offset: number,
  moduleInterface: ModuleInterface,
): LspHover {
  const typed = semanticTypedNodeAt(moduleInterface, offset);
  const occurrence = semanticOccurrencesAt(moduleInterface, offset)[0];
  return hoverCode(
    `${typed?.label ?? occurrence?.name ?? "GPU expression"}: unresolved GPU type`,
  );
}

function sameSpan(
  left: Readonly<{ start: number; end: number }>,
  right: Readonly<{ start: number; end: number }>,
): boolean {
  return left.start === right.start && left.end === right.end;
}

function contains(span: SourceSpan, offset: number): boolean {
  return span.start <= offset && offset < Math.max(span.start + 1, span.end);
}

function spanWidth(span: SourceSpan): number {
  return span.end - span.start;
}

function pipeOperatorAt(source: string, offset: number): boolean {
  return source.slice(offset, offset + 2) === ":>" ||
    source.slice(Math.max(0, offset - 1), offset + 1) === ":>";
}

function hoverCode(value: string): LspHover {
  return { contents: { kind: "markdown", value: `\`\`\`wm\n${value}\n\`\`\`` } };
}
