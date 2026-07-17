import type {
  Binding,
  Decl,
  Expr,
  MatchArm,
  Module,
  Param,
  Pattern,
  RecordExprItem,
  RecordPatternField,
} from "../ast.ts";
import { analyzeFile, elaborateGpuSlicesForLanguageService } from "../compiler.ts";
import type { CompilerFrontendOptions } from "../compiler_frontend.ts";
import {
  contextualizeDelayedCallbacks,
  resolveDelayedFfiElaboration,
} from "../ffi/delayed/delayed.ts";
import { prepareFfiElaboration } from "../ffi/elab.ts";
import { inferModulePartial, type InferResult } from "../infer.ts";
import { expandCallArg } from "../infer/shared.ts";
import { loadModuleGraph } from "../module_graph.ts";
import { type AstNode, lineColToOffset, lineStarts } from "../source.ts";
import { standardInferOptions } from "../standard_library.ts";
import { instantiate, instantiateRecordFields, prune, type Scheme, type Ty } from "../types.ts";
import type { TypeFact } from "../infer/type_facts.ts";
import type { ProgramAnalysis } from "../program_analysis.ts";
import type {
  GpuSliceOccurrenceTypeDto,
  GpuSliceShaderTypeDto,
  GpuSliceTypeElaborationOutput,
} from "../wmslang/v2_dto.ts";
import { showHoverType, withoutReceiverParam } from "./hover_type_display.ts";
import { fileUriToPath } from "./uri.ts";

export type LspHover = {
  contents: { kind: "markdown"; value: string };
};

export async function hoverAt(
  uri: string,
  position: { line: number; character: number },
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
): Promise<LspHover | null> {
  const entryPath = fileUriToPath(uri);
  const analysis = await analyzeForHover(entryPath, sourceOverrides, options);
  if (!analysis) return null;
  const node = analysis.graph.nodes.get(analysis.graph.entry);
  const result = analysis.results.get(analysis.graph.entry);
  if (!node || !result) return null;
  const gpu = await gpuHoverContext(analysis);

  const offset = lineColToOffset(position.line + 1, position.character, lineStarts(node.source));
  for (const target of targetsAt(node.module, node.source, offset)) {
    if (
      (!gpu || gpu.kind === "unresolved") &&
      (analysis.partial || gpu?.kind === "unresolved") && targetInsideGpu(target, node.module)
    ) {
      return unresolvedGpuHover(target);
    }
    const hover = hoverForTarget(
      target,
      result,
      gpu?.kind === "resolved" ? gpu.context : undefined,
    );
    if (hover) return hover;
  }
  return null;
}

function hoverForTarget(
  target: Target,
  result: InferResult,
  gpu: GpuHoverContext | undefined,
): LspHover | null {
  const contextualGpu = gpu ? gpuHoverForTarget(target, gpu) : null;
  if (contextualGpu) return contextualGpu;
  if (target.kind === "expr") {
    if (
      target.value.kind === "Call" && target.value.callee.kind === "Var" &&
      isGeneratedFfiName(target.value.callee.name)
    ) {
      return generatedFfiHover(
        displayVarName(target.value.callee.name),
        result.env.get(target.value.callee.name),
      );
    }
    const fact = result.facts.expressions.get(target.value);
    if (fact) return factHover(labelExpr(target.value), fact);
    const type = result.types.get(target.value);
    if (type) return hoverCode(`${labelExpr(target.value)}: ${showHoverType(type)}`);
    if (target.value.kind === "Var") {
      return schemeHover(target.value.name, result.env.get(target.value.name));
    }
  }

  if (target.kind === "pattern" && target.value.kind === "PVar") {
    const fact = result.facts.patterns.get(target.value);
    if (fact) return factHover(target.value.name, fact);
    const expected = target.expectedExpr ? result.types.get(target.expectedExpr) : undefined;
    const localType = expected && target.expectedPattern
      ? patternBinderType(target.expectedPattern, target.value, expected, result)
      : undefined;
    if (localType) return hoverCode(`${target.value.name}: ${showHoverType(localType)}`);
    return schemeHover(target.value.name, result.env.get(target.value.name));
  }

  if (
    target.kind === "decl" &&
    (target.value.kind === "TypeDecl" || target.value.kind === "ForeignTypeDecl")
  ) {
    return hoverCode(`type ${target.value.name}`);
  }

  return null;
}

async function analyzeForHover(
  entryPath: string,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
): Promise<HoverAnalysis | null> {
  try {
    return { ...await analyzeFile(entryPath, { ...options, sourceOverrides }), partial: false };
  } catch {
    return await analyzePartialForHover(entryPath, sourceOverrides, options);
  }
}

async function analyzePartialForHover(
  entryPath: string,
  sourceOverrides: Map<string, string>,
  options: CompilerFrontendOptions = {},
): Promise<HoverAnalysis | null> {
  try {
    const graph = await loadModuleGraph(entryPath, { ...options, sourceOverrides });
    const inferOptions = await standardInferOptions();
    const ffi = new Map<string, ReturnType<typeof prepareFfiElaboration>>();
    for (const node of graph.nodes.values()) {
      const prepared = prepareFfiElaboration(node.module, { filePath: node.path });
      ffi.set(node.path, prepared);
      node.module = prepared.module;
      ensurePartialHoverForeignTypes(node.module, node.source);
    }
    const inferAll = () => {
      const out = new Map<string, InferResult>();
      for (const path of graph.order) {
        const node = graph.nodes.get(path)!;
        const imports = new Map<string, InferResult>();
        for (const edge of node.imports) {
          const imported = out.get(edge.path);
          if (imported) imports.set(edge.specifier, imported);
        }
        out.set(path, inferModulePartial(node.module, imports, inferOptions));
      }
      return out;
    };
    let results = inferAll();
    // Best effort: run the later FFI phases for their placeholder-solving side effects so
    // hover shows resolved member types, but keep the pre-rewrite modules and the latest
    // successful inference results when a phase fails.
    try {
      for (const path of graph.order) {
        const contextual = contextualizeDelayedCallbacks(ffi.get(path)!, results.get(path)!);
        ffi.set(path, contextual);
        graph.nodes.get(path)!.module = contextual.module;
      }
      results = inferAll();
      const foreignTypeRefs = new Map(
        [...ffi.values()].flatMap((item) =>
          [...item.foreignTypeRefs.values()].map((ref) => [ref.key, ref] as const)
        ),
      );
      for (const path of graph.order) {
        resolveDelayedFfiElaboration(ffi.get(path)!, results.get(path)!, { foreignTypeRefs });
      }
    } catch {
      // Keep the latest successful results; solved placeholders still show through.
    }
    return { graph, results, partial: true };
  } catch {
    return null;
  }
}

type HoverAnalysis =
  & Pick<Awaited<ReturnType<typeof analyzeFile>>, "graph" | "results">
  & Partial<Pick<ProgramAnalysis, "bindings" | "gpuInput" | "gpuSlices">>
  & { partial: boolean };

type GpuHoverSliceContext = {
  analysis: ProgramAnalysis;
  input: ProgramAnalysis["gpuInput"];
  elaboration: GpuSliceTypeElaborationOutput;
};

type GpuHoverContext = {
  slices: GpuHoverSliceContext[];
};

type GpuHoverState =
  | { kind: "resolved"; context: GpuHoverContext }
  | { kind: "unresolved" };

async function gpuHoverContext(
  analysis: HoverAnalysis,
): Promise<GpuHoverState | undefined> {
  if (
    !analysis.gpuInput || !analysis.gpuSlices || !analysis.bindings ||
    analysis.gpuSlices.length === 0
  ) {
    return undefined;
  }
  const complete = analysis as unknown as ProgramAnalysis;
  try {
    return {
      kind: "resolved",
      context: {
        slices: (await elaborateGpuSlicesForLanguageService(complete)).map((slice) => ({
          analysis: complete,
          ...slice,
        })),
      },
    };
  } catch {
    return { kind: "unresolved" };
  }
}

function targetInsideGpu(target: Target, module: Module): boolean {
  return collectModule(module).some((candidate) =>
    candidate.kind === "expr" && candidate.value.kind === "Lambda" &&
    candidate.value.directives.some((directive) => directive.name === "gpu") &&
    candidate.node.span.start <= target.node.span.start &&
    target.node.span.end <= candidate.node.span.end
  );
}

function unresolvedGpuHover(target: Target): LspHover | null {
  if (target.kind === "expr") return hoverCode(`${labelExpr(target.value)}: unresolved GPU type`);
  if (target.kind === "pattern" && target.value.kind === "PVar") {
    return hoverCode(`${target.value.name}: unresolved GPU type`);
  }
  return null;
}

function gpuHoverForTarget(target: Target, context: GpuHoverContext): LspHover | null {
  for (const slice of context.slices) {
    const hover = gpuHoverForTargetInSlice(target, slice);
    if (hover) return hover;
  }
  return null;
}

function gpuHoverForTargetInSlice(
  target: Target,
  context: GpuHoverSliceContext,
): LspHover | null {
  const { analysis, elaboration } = context;
  const input = context.input;
  const span = target.node.span;
  let occurrences: GpuSliceOccurrenceTypeDto[] = [];

  if (target.kind === "expr" && target.value.kind === "Var") {
    const builtinHover = gpuBuiltinHover(target.value, context);
    if (builtinHover) return builtinHover;
    const bindingId = analysis.bindings.get(analysis.graph.entry)?.references.get(target.value);
    const functionIds = new Set(
      input.functions.filter((candidate) => candidate.sourceBindingId === bindingId).map((fn) =>
        fn.id
      ),
    );
    occurrences = elaboration.occurrences.filter((candidate) =>
      candidate.kind === "function" && functionIds.has(candidate.sourceId)
    );
  } else if (target.kind === "pattern" && target.value.kind === "PVar") {
    const bindingId = analysis.bindings.get(analysis.graph.entry)?.binders.get(target.value);
    const functionIds = new Set(
      input.functions.filter((candidate) => candidate.sourceBindingId === bindingId).map((fn) =>
        fn.id
      ),
    );
    occurrences = elaboration.occurrences.filter((candidate) =>
      candidate.kind === "function" && functionIds.has(candidate.sourceId)
    );
  }

  if (occurrences.length === 0 && target.kind === "expr") {
    const expectedKind = normalizedExpressionKind(target.value);
    const matching = matchingOccurrences("expression", span, context);
    const exact = matching.filter((candidate) => {
      const source = input.expressions.find((expression) => expression.id === candidate.sourceId);
      return source?.kind === expectedKind;
    });
    occurrences = exact.length ? exact : matching;
  }
  if (occurrences.length === 0 && target.kind === "pattern") {
    occurrences = matchingOccurrences("pattern", span, context);
  }
  if (occurrences.length === 0) return null;

  const types = uniqueGpuTypes(occurrences, context);
  if (types.length === 0) return null;
  const label = target.kind === "expr"
    ? labelExpr(target.value)
    : target.kind === "pattern" && target.value.kind === "PVar"
    ? target.value.name
    : "GPU expression";
  if (types.length === 1) return hoverCode(`${label}: ${types[0]}`);
  return hoverCode(
    `${label}\nGPU specializations:\n${types.map((type) => `- ${type}`).join("\n")}`,
  );
}

function gpuBuiltinHover(
  target: Extract<Expr, { kind: "Var" }>,
  context: GpuHoverSliceContext,
): LspHover | null {
  const module = context.analysis.graph.nodes.get(context.analysis.graph.entry)?.module;
  if (!module) return null;
  const call = collectModule(module).find((candidate) =>
    candidate.kind === "expr" && candidate.value.kind === "Call" &&
    candidate.value.callee === target
  );
  if (!call || call.kind !== "expr") return null;
  const callSpan = call.node.span;
  const sources = context.input.expressions.filter((expression) => {
    if (expression.kind !== "builtin") return false;
    const span = context.input.spans.find((candidate) => candidate.id === expression.spanId);
    return span?.start === callSpan.start && span.end === callSpan.end;
  });
  const signatures = sources.flatMap((source) => {
    const selection = context.elaboration.builtinSelections.find((candidate) =>
      candidate.expressionId === source.id
    );
    const overload = context.input.builtinCatalog.overloads.find((candidate) =>
      candidate.id === selection?.overloadId
    );
    return overload ? [`(${overload.params.join(", ")}) => ${overload.result}`] : [];
  });
  const unique = [...new Set(signatures)].sort();
  if (unique.length === 0) return null;
  if (unique.length === 1) return hoverCode(`${target.name}: ${unique[0]}`);
  return hoverCode(
    `${target.name}\nGPU specializations:\n${unique.map((item) => `- ${item}`).join("\n")}`,
  );
}

function matchingOccurrences(
  kind: GpuSliceOccurrenceTypeDto["kind"],
  span: AstNode["span"],
  context: GpuHoverSliceContext,
): GpuSliceOccurrenceTypeDto[] {
  const spanIds = new Set(
    context.input.spans.filter((candidate) =>
      candidate.start === span.start && candidate.end === span.end
    ).map((candidate) => candidate.id),
  );
  return context.elaboration.occurrences.filter((candidate) =>
    candidate.kind === kind && spanIds.has(candidate.spanId)
  );
}

function uniqueGpuTypes(
  occurrences: GpuSliceOccurrenceTypeDto[],
  context: GpuHoverSliceContext,
): string[] {
  const types = occurrences.flatMap((occurrence) => {
    const type = context.elaboration.shaderTypes.find((candidate) =>
      candidate.id === occurrence.shaderTypeId
    );
    return type ? [showGpuType(type, context)] : [];
  });
  return [...new Set(types)].sort();
}

function normalizedExpressionKind(expr: Expr): string {
  if (expr.kind === "Int" || expr.kind === "Float") return "number";
  if (expr.kind === "Bool") return "bool";
  if (expr.kind === "Void") return "void";
  if (expr.kind === "Var" && expr.name.includes(".")) return "project";
  return expr.kind.toLowerCase();
}

function showGpuType(type: GpuSliceShaderTypeDto, context: GpuHoverSliceContext): string {
  const byId = new Map(
    context.elaboration.shaderTypes.map((candidate) => [candidate.id, candidate]),
  );
  const go = (current: GpuSliceShaderTypeDto): string => {
    if (
      current.kind === "f32" || current.kind === "i32" || current.kind === "bool" ||
      current.kind === "void"
    ) {
      return current.kind;
    }
    if (current.kind === "vector") {
      const scalar = byId.get(current.items[0]);
      return `${scalar?.kind === "i32" ? "i32" : "f32"}x${current.items.length}`;
    }
    if (current.kind === "sampled-texture-2d") return "Gpu.SampledTexture2D";
    if (current.kind === "sampler") return "Gpu.Sampler";
    if (current.kind === "tuple") {
      return `(${current.items.map((id) => go(byId.get(id)!)).join(", ")})`;
    }
    if (current.kind === "function") {
      return `(${current.params.map((id) => go(byId.get(id)!)).join(", ")}) => ${
        go(byId.get(current.result)!)
      }`;
    }
    return context.input.adts.find((adt) => adt.typeNameId === current.typeNameId)
      ?.name ??
      `adt#${current.typeNameId}`;
  };
  return go(type);
}

function schemeHover(name: string, scheme: Scheme | undefined): LspHover | null {
  return scheme ? hoverCode(`${name}: ${showHoverType(instantiate(scheme))}`) : null;
}

function generatedFfiHover(name: string, scheme: Scheme | undefined): LspHover | null {
  if (!scheme) return null;
  return hoverCode(`${name}: ${showHoverType(withoutReceiverParam(instantiate(scheme)))}`);
}

function factHover(name: string, fact: TypeFact): LspHover | null {
  const instantiated = fact.instantiated;
  const general = fact.general?.type;
  if (!instantiated && !general) return null;
  if (!instantiated) return hoverCode(`${name}: ${showHoverType(general!)}`);
  const instantiatedText = showHoverType(instantiated);
  const generalText = general ? showHoverType(general) : undefined;
  if (!generalText || instantiatedText === generalText) {
    return hoverCode(`${name}: ${instantiatedText}`);
  }
  return hoverCode(`${name}\ntype: ${instantiatedText}\ngeneral: ${generalText}`);
}

function hoverCode(value: string): LspHover {
  return { contents: { kind: "markdown", value: `\`\`\`wm\n${value}\n\`\`\`` } };
}

type Target =
  | { kind: "decl"; value: Decl; node: AstNode }
  | { kind: "expr"; value: Expr; node: AstNode }
  | {
    kind: "pattern";
    value: Pattern;
    node: AstNode;
    expectedExpr?: Expr;
    expectedPattern?: Pattern;
  };

function targetsAt(module: Module, source: string, offset: number): Target[] {
  return collectModule(module)
    .filter((target) => contains(target.node, offset))
    .filter((target) => !isPipeOperatorTarget(target, source, offset))
    .sort(bySize);
}

function contains(node: AstNode, offset: number): boolean {
  return node.span.start <= offset && offset < Math.max(node.span.start + 1, node.span.end);
}

function bySize(left: Target, right: Target): number {
  return width(left.node) - width(right.node);
}

function width(node: AstNode): number {
  return node.span.end - node.span.start;
}

function collectModule(module: Module): Target[] {
  return module.decls.flatMap(collectDecl);
}

function collectDecl(decl: Decl): Target[] {
  const own = target("decl", decl);
  switch (decl.kind) {
    case "LetDecl":
      return [...own, ...decl.bindings.flatMap(collectBinding)];
    case "TypeDecl":
    case "ForeignTypeDecl":
    case "RecordDecl":
    case "ImportDecl":
    case "JsImportDecl":
      return own;
  }
}

function collectBinding(binding: Binding): Target[] {
  return [
    ...collectPattern(binding.pattern, binding.value, binding.pattern),
    ...collectExpr(binding.value),
  ];
}

function collectExpr(expr: Expr): Target[] {
  const own = target("expr", expr);
  switch (expr.kind) {
    case "Tuple":
      return [...own, ...expr.items.flatMap(collectExpr)];
    case "Record":
      return [...own, ...expr.fields.flatMap(collectRecordExprField)];
    case "JsonObject":
      return [...own, ...expr.fields.flatMap(collectJsonObjectField)];
    case "JsonArray":
      return [...own, ...expr.items.flatMap(collectExpr)];
    case "FfiGet":
      return [...own, ...collectExpr(expr.receiver)];
    case "FfiCall":
      return [...own, ...collectExpr(expr.receiver), ...expr.args.flatMap(collectExpr)];
    case "FfiBindingCall":
      return [...own, ...expr.args.flatMap(collectExpr)];
    case "Lambda":
      return [...own, ...expr.params.flatMap(collectParam), ...collectExpr(expr.body)];
    case "Call":
      return [...own, ...collectExpr(expr.callee), ...expr.args.flatMap(collectExpr)];
    case "If":
      return [
        ...own,
        ...collectExpr(expr.cond),
        ...collectExpr(expr.thenExpr),
        ...collectExpr(expr.elseExpr),
      ];
    case "Match":
      return [...own, ...collectExpr(expr.value), ...expr.arms.flatMap(collectArm)];
    case "Panic":
      return [...own, ...collectExpr(expr.message)];
    case "Block":
      return [
        ...own,
        ...expr.items.flatMap((item) => isDecl(item) ? collectDecl(item) : collectExpr(item)),
        ...collectExpr(expr.result),
      ];
    case "Binary":
      return [...own, ...collectExpr(expr.left), ...collectExpr(expr.right)];
    case "Unary":
      return [...own, ...collectExpr(expr.value)];
    case "Pipe":
      return [...own, ...collectExpr(expr.left), ...collectExpr(expr.right)];
    case "Int":
    case "Float":
    case "String":
    case "Bool":
    case "Void":
    case "Var":
      return own;
  }
}

function collectRecordExprField(field: RecordExprItem): Target[] {
  return collectExpr(field.value);
}

function collectJsonObjectField(field: { value: Expr }): Target[] {
  return collectExpr(field.value);
}

function collectParam(param: Param): Target[] {
  return collectPattern(param.pattern);
}

function collectArm(arm: MatchArm): Target[] {
  return [...collectPattern(arm.pattern), ...collectExpr(arm.body)];
}

function collectPattern(
  pattern: Pattern,
  expectedExpr?: Expr,
  expectedPattern?: Pattern,
): Target[] {
  const own = target("pattern", pattern, expectedExpr, expectedPattern);
  switch (pattern.kind) {
    case "PTuple":
      return [
        ...own,
        ...pattern.items.flatMap((item) => collectPattern(item, expectedExpr, expectedPattern)),
      ];
    case "PRecord":
      return [
        ...own,
        ...pattern.fields.flatMap((field) =>
          collectRecordPatternField(field, expectedExpr, expectedPattern)
        ),
      ];
    case "PCtor":
      return [
        ...own,
        ...pattern.args.flatMap((arg) => collectPattern(arg, expectedExpr, expectedPattern)),
      ];
    case "PWildcard":
    case "PVar":
    case "PInt":
    case "PString":
    case "PBool":
    case "PVoid":
    case "PPinned":
      return own;
  }
}

function collectRecordPatternField(
  field: RecordPatternField,
  expectedExpr?: Expr,
  expectedPattern?: Pattern,
): Target[] {
  return collectPattern(field.pattern, expectedExpr, expectedPattern);
}

function target(kind: "decl", value: Decl): Target[];
function target(kind: "expr", value: Expr): Target[];
function target(
  kind: "pattern",
  value: Pattern,
  expectedExpr?: Expr,
  expectedPattern?: Pattern,
): Target[];
function target(
  kind: Target["kind"],
  value: Decl | Expr | Pattern,
  expectedExpr?: Expr,
  expectedPattern?: Pattern,
): Target[] {
  if (!value.node) return [];
  if (kind === "pattern") {
    return [{ kind, value, node: value.node, expectedExpr, expectedPattern } as Target];
  }
  return [{ kind, value, node: value.node } as Target];
}

function isDecl(item: Decl | Expr): item is Decl {
  return item.kind === "ImportDecl" || item.kind === "LetDecl" ||
    item.kind === "JsImportDecl" || item.kind === "RecordDecl" || item.kind === "TypeDecl" ||
    item.kind === "ForeignTypeDecl";
}

function labelExpr(expr: Expr): string {
  return expr.kind === "Var" ? displayVarName(expr.name) : expr.kind;
}

function displayVarName(name: string): string {
  return isGeneratedFfiName(name) ? displayGeneratedFfiName(name) : name;
}

function displayGeneratedFfiName(name: string): string {
  const tokens = name.replace(/^__ffi_/, "").replace(/_\d+$/, "").split("_").filter(Boolean);
  for (let size = Math.floor(tokens.length / 2); size > 0; size--) {
    const left = tokens.slice(tokens.length - size * 2, tokens.length - size);
    const right = tokens.slice(tokens.length - size);
    if (left.join("\0") === right.join("\0")) return right.join("_");
  }
  return tokens.at(-1) ?? name;
}

function isGeneratedFfiName(name: string): boolean {
  return name.startsWith("__ffi_");
}

function ensurePartialHoverForeignTypes(module: Module, source: string) {
  if (!source.includes("Js.Promise")) return;
  if (
    module.decls.some((decl) =>
      (decl.kind === "ForeignTypeDecl" || decl.kind === "TypeDecl") && decl.name === "Js.Promise"
    )
  ) {
    return;
  }
  module.decls.unshift({
    kind: "TypeDecl",
    exported: false,
    name: "Js.Promise",
    params: ["T"],
    ctors: [],
  });
}

function patternBinderType(
  pattern: Pattern,
  target: Extract<Pattern, { kind: "PVar" }>,
  expected: Ty,
  result: InferResult,
): Ty | undefined {
  if (pattern === target) return expected;
  switch (pattern.kind) {
    case "PTuple": {
      const tupleType = prune(expected);
      if (tupleType.tag !== "tuple") return undefined;
      for (const [index, item] of pattern.items.entries()) {
        const found = patternBinderType(item, target, tupleType.items[index], result);
        if (found) return found;
      }
      return undefined;
    }
    case "PRecord": {
      const recordType = prune(expected);
      if (recordType.tag !== "named") return undefined;
      const info = [...result.typeEnv.values()].find((candidate) => candidate.id === recordType.id);
      if (!info?.recordFields) return undefined;
      const fields = instantiateRecordFields(info, recordType.args);
      for (const field of pattern.fields) {
        const fieldType = fields.find((item) => item.name === field.name)?.type;
        if (!fieldType) continue;
        const found = patternBinderType(field.pattern, target, fieldType, result);
        if (found) return found;
      }
      return undefined;
    }
    case "PCtor": {
      const scheme = result.env.get(pattern.name);
      if (!scheme || scheme.status !== "constructor") return undefined;
      const ctor = prune(instantiate(scheme));
      const args = ctor.tag === "fn"
        ? (ctor.params.length === 1 ? expandCallArg(ctor.params[0]) : ctor.params)
        : [];
      for (const [index, arg] of pattern.args.entries()) {
        const found = patternBinderType(arg, target, args[index], result);
        if (found) return found;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function isPipeOperatorTarget(target: Target, source: string, offset: number): boolean {
  if (target.kind !== "expr") return false;
  if (
    target.value.kind !== "Pipe" && target.value.kind !== "FfiGet" &&
    target.value.kind !== "FfiCall" && target.value.kind !== "FfiBindingCall"
  ) {
    return false;
  }
  return pipeOperatorAt(source, target.node, offset);
}

function pipeOperatorAt(source: string, node: AstNode, offset: number): boolean {
  let index = source.indexOf(":>", node.span.start);
  while (index >= 0 && index < node.span.end) {
    if (index <= offset && offset <= index + 2) return true;
    index = source.indexOf(":>", index + 2);
  }
  return false;
}
