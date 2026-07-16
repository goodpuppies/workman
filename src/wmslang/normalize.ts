import type { BindingFacts } from "../binding_facts.ts";
import { discoverGpuRegions } from "../directives.ts";
import type { Decl, Expr, Module, Pattern } from "../ast.ts";
import type { InferResult } from "../infer.ts";
import type { BindingId } from "../ids.ts";
import type { ModuleGraph } from "../module_graph.ts";
import type { SourceSpan } from "../source.ts";
import { prune, type Ty } from "../types.ts";
import {
  GPU_ELABORATION_SCHEMA_VERSION,
  type GpuBindingDto,
  type GpuElaborationInput,
  type GpuExprDto,
  type GpuFunctionDto,
  type GpuSpanDto,
  type GpuTypeDto,
} from "./dto.ts";

type ModuleInput = {
  path: string;
  module: Module;
  result: InferResult;
  bindings: BindingFacts;
};

/**
 * Bootstrap-only schema-v1 fixture path. It preserves implicit marker roots so
 * the existing Workman H0 solver can be tested independently of the frozen
 * visual entry signature. Product analysis uses normalizeGpuSliceProgram.
 */
export function normalizeGpuProgramH0(
  graph: ModuleGraph,
  results: Map<string, InferResult>,
  bindings: Map<string, BindingFacts>,
): GpuElaborationInput {
  return normalizeGpuModules(graph.order.map((path) => ({
    path,
    module: graph.nodes.get(path)!.module,
    result: required(results, path, "inference result"),
    bindings: required(bindings, path, "binding facts"),
  })));
}

export function normalizeGpuModule(
  module: Module,
  result: InferResult,
  bindings: BindingFacts,
  path = "<source>",
): GpuElaborationInput {
  // Explicit H0 fixture entry: schema-v1 solver tests predate Gpu.fragment and
  // intentionally treat every marker as a root. This is not a product entry.
  return normalizeGpuModules([{ path, module, result, bindings }]);
}

function normalizeGpuModules(
  modules: ModuleInput[],
): GpuElaborationInput {
  const state = new NormalizationState();
  let nextRegion = 0;
  for (const input of modules) {
    for (const region of discoverGpuRegions(input.module)) {
      state.addRoot(input, region.lambda, region.binding, nextRegion++);
    }
  }
  for (const input of modules) {
    for (const binding of topLevelLambdaBindings(input.module)) {
      state.addCandidate(input, binding.value, binding);
    }
  }
  for (const input of modules) {
    for (const binding of topLevelValueBindings(input.module)) {
      state.addDefinition(input, binding);
    }
  }
  return state.finish();
}

class NormalizationState {
  readonly roots: GpuElaborationInput["roots"] = [];
  readonly functions: GpuFunctionDto[] = [];
  readonly bindings: GpuBindingDto[] = [];
  readonly types: GpuTypeDto[] = [];
  readonly expressions: GpuExprDto[] = [];
  readonly spans: GpuSpanDto[] = [];

  #typesByKey = new Map<string, number>();
  #bindingTypeIds = new Map<number, number>();
  #spansByKey = new Map<string, number>();
  #bindingIndexes = new Map<number, number>();
  #functionsByLambda = new Set<Expr>();

  addRoot(
    input: ModuleInput,
    lambda: Extract<Expr, { kind: "Lambda" }>,
    directBinding: import("../ast.ts").Binding | undefined,
    regionId: number,
  ): void {
    this.addFunction(input, lambda, directBinding, regionId, "gpu-only");
  }

  addCandidate(
    input: ModuleInput,
    lambda: Extract<Expr, { kind: "Lambda" }>,
    directBinding: import("../ast.ts").Binding,
  ): void {
    this.addFunction(input, lambda, directBinding, -1, "candidate");
  }

  addFunction(
    input: ModuleInput,
    lambda: Extract<Expr, { kind: "Lambda" }>,
    directBinding: import("../ast.ts").Binding | undefined,
    regionId: number,
    capability: GpuFunctionDto["capability"],
  ): void {
    if (this.#functionsByLambda.has(lambda)) return;
    this.#functionsByLambda.add(lambda);
    const functionId = this.functions.length;
    const bindingId = directBinding
      ? firstPatternBindingId(directBinding.pattern, input.bindings) ?? -1
      : -1;
    const lambdaType = input.result.types.get(lambda);
    const functionType = lambdaType ? prune(lambdaType) : undefined;
    const params = lambda.params.map((param, index) => {
      const id = firstPatternBindingId(param.pattern, input.bindings) ?? -1;
      const name = firstPatternName(param.pattern) ?? `_param${index}`;
      const type = functionType?.tag === "fn" ? functionType.params[index] : undefined;
      const typeId = this.bindingType(id, type);
      this.binding(id, name, typeId, "parameter");
      return { bindingId: id, name, typeId };
    });
    const resultType = functionType?.tag === "fn"
      ? functionType.result
      : input.result.types.get(lambda.body);
    const resultTypeId = this.type(
      resultType,
      "",
      `function-result:${bindingId >= 0 ? bindingId : functionId}`,
    );
    if (directBinding && bindingId >= 0) {
      const functionTypeId = this.internType(`function-binding:${bindingId}`, () => ({
        ...baseType("function"),
        params: params.map((param) => param.typeId),
        result: resultTypeId,
      }));
      this.#bindingTypeIds.set(bindingId, functionTypeId);
      this.binding(
        bindingId,
        directBindingName(directBinding) ?? `gpu${regionId}`,
        functionTypeId,
        "module",
      );
    }
    const bodyExprId = this.expr(lambda.body, input, resultTypeId);
    const name = directBinding
      ? directBindingName(directBinding) ?? `gpu${regionId}`
      : `gpu${regionId}`;
    this.functions.push({
      id: functionId,
      regionId,
      bindingId,
      name,
      params,
      resultTypeId,
      bodyExprId,
      spanId: this.span(input.path, lambda),
      capability,
    });
    if (regionId >= 0) this.roots.push({ regionId, functionId, bindingId });
  }

  addDefinition(input: ModuleInput, binding: import("../ast.ts").Binding): void {
    const bindingId = firstPatternBindingId(binding.pattern, input.bindings) ?? -1;
    if (bindingId < 0) return;
    const bindingTypeId = this.bindingType(
      bindingId,
      input.result.types.get(binding.value),
      numericHint(binding.value),
    );
    const definitionExprId = this.expr(binding.value, input, bindingTypeId);
    this.binding(
      bindingId,
      directBindingName(binding) ?? "_module",
      bindingTypeId,
      "module",
      definitionExprId,
      this.span(input.path, binding),
    );
  }

  finish(): GpuElaborationInput {
    return {
      schemaVersion: GPU_ELABORATION_SCHEMA_VERSION,
      roots: this.roots,
      functions: this.functions,
      bindings: this.bindings,
      types: this.types,
      expressions: this.expressions,
      spans: this.spans,
    };
  }

  expr(expr: Expr, input: ModuleInput, forcedTypeId?: number): number {
    const id = this.expressions.length;
    // Reserve the ID before descending so recursive table ordering is stable and parent-first.
    this.expressions.push(undefined as unknown as GpuExprDto);
    const children = this.exprChildren(expr, input);
    const bindingId = expr.kind === "Var" ? input.bindings.references.get(expr) ?? -1 : -1;
    const typeId = forcedTypeId ??
      (expr.kind === "Var" && bindingId >= 0
        ? this.bindingType(bindingId, input.result.types.get(expr))
        : expr.kind === "Block" && children.length > 0
        ? this.expressions[children[children.length - 1]].typeId
        : this.type(
          input.result.types.get(expr),
          numericHint(expr),
          `expression:${id}`,
          expr.kind === "Tuple"
            ? children.map((child) => this.expressions[child].typeId)
            : undefined,
        ));
    if (forcedTypeId !== undefined) this.refineTypeHint(typeId, numericHint(expr));
    if (expr.kind === "Var" && bindingId >= 0) {
      this.binding(
        bindingId,
        expr.name,
        typeId,
        input.bindings.local.has(bindingId as BindingId) ? "local" : "imported",
      );
    }
    this.expressions[id] = {
      id,
      kind: exprKind(expr),
      typeId,
      spanId: this.span(input.path, expr),
      bindingId,
      name: expr.kind === "Var" ? expr.name : "",
      operator: expr.kind === "Binary" || expr.kind === "Unary" ? expr.op : "",
      numberValue: expr.kind === "Int" || expr.kind === "Float" ? expr.value : 0,
      boolValue: expr.kind === "Bool" ? expr.value : false,
      children,
      capability: exprCapability(expr, input, bindingId),
    };
    return id;
  }

  exprChildren(expr: Expr, input: ModuleInput): number[] {
    switch (expr.kind) {
      case "Tuple":
      case "JsonArray":
        return expr.items.map((item) => this.expr(item, input));
      case "Record":
        return expr.fields.map((field) => this.expr(field.value, input));
      case "JsonObject":
        return expr.fields.map((field) => this.expr(field.value, input));
      case "FfiGet":
        return [this.expr(expr.receiver, input)];
      case "FfiCall":
        return [this.expr(expr.receiver, input), ...expr.args.map((arg) => this.expr(arg, input))];
      case "FfiBindingCall":
        return expr.args.map((arg) => this.expr(arg, input));
      case "Lambda":
        return [this.expr(expr.body, input)];
      case "Call":
        return [this.expr(expr.callee, input), ...expr.args.map((arg) => this.expr(arg, input))];
      case "If":
        return [
          this.expr(expr.cond, input),
          this.expr(expr.thenExpr, input),
          this.expr(expr.elseExpr, input),
        ];
      case "Match":
        return [
          this.expr(expr.value, input),
          ...expr.arms.map((arm) => this.expr(arm.body, input)),
        ];
      case "Panic":
        return [this.expr(expr.message, input)];
      case "Block":
        return [
          ...expr.items.flatMap((item) =>
            isDecl(item) ? this.declExpressions(item, input) : [this.expr(item, input)]
          ),
          this.expr(expr.result, input),
        ];
      case "Binary":
      case "Pipe":
        return [this.expr(expr.left, input), this.expr(expr.right, input)];
      case "Unary":
        return [this.expr(expr.value, input)];
      default:
        return [];
    }
  }

  declExpressions(decl: Decl, input: ModuleInput): number[] {
    if (decl.kind !== "LetDecl") return [];
    return decl.bindings.map((binding) => {
      const bindingId = firstPatternBindingId(binding.pattern, input.bindings) ?? -1;
      const typeId = this.bindingType(
        bindingId,
        input.result.types.get(binding.value),
        numericHint(binding.value),
      );
      const valueId = this.expr(binding.value, input, typeId);
      const id = this.expressions.length;
      this.binding(
        bindingId,
        directBindingName(binding) ?? "_local",
        typeId,
        "local",
        valueId,
        this.span(input.path, binding),
      );
      this.expressions.push({
        id,
        kind: "let",
        typeId,
        spanId: this.span(input.path, binding),
        bindingId,
        name: directBindingName(binding) ?? "",
        operator: "",
        numberValue: 0,
        boolValue: false,
        children: [valueId],
        capability: binding.pattern.kind === "PVar" ? "gpu" : "unsupported",
      });
      return id;
    });
  }

  binding(
    id: number,
    name: string,
    typeId: number,
    scope: GpuBindingDto["scope"],
    definitionExprId = -1,
    spanId = -1,
  ): void {
    if (id < 0) return;
    const existingIndex = this.#bindingIndexes.get(id);
    if (existingIndex === undefined) {
      this.#bindingIndexes.set(id, this.bindings.length);
      this.bindings.push({ id, name, typeId, definitionExprId, spanId, scope });
      return;
    }
    const existing = this.bindings[existingIndex];
    const hasDefinition = definitionExprId >= 0;
    const hasCanonicalDeclaration = scope === "module";
    this.bindings[existingIndex] = {
      id,
      name: hasDefinition || hasCanonicalDeclaration ? name : existing.name,
      typeId: hasDefinition || hasCanonicalDeclaration ? typeId : existing.typeId,
      definitionExprId: hasDefinition ? definitionExprId : existing.definitionExprId,
      spanId: hasDefinition ? spanId : existing.spanId,
      scope: scope === "module" ? "module" : existing.scope,
    };
  }

  bindingType(
    bindingId: number,
    type: Ty | undefined,
    hint: GpuTypeDto["representation"] = "",
  ): number {
    const existing = this.#bindingTypeIds.get(bindingId);
    if (existing !== undefined) {
      this.refineTypeHint(existing, hint);
      return existing;
    }
    const typeId = this.type(type, hint, `binding:${bindingId}`);
    if (bindingId >= 0) this.#bindingTypeIds.set(bindingId, typeId);
    return typeId;
  }

  refineTypeHint(typeId: number, hint: GpuTypeDto["representation"]): void {
    if (hint !== "i32" && hint !== "f32") return;
    const current = this.types[typeId];
    if (current && current.representation === "abstract") {
      this.types[typeId] = { ...current, representation: hint };
    }
  }

  type(
    type: Ty | undefined,
    hint: GpuTypeDto["representation"] = "",
    identity = "shared",
    tupleItems?: number[],
  ): number {
    if (!type) return this.internType("unknown", () => baseType("unknown"));
    const target = prune(type);
    if (target.tag === "prim") {
      if (target.name === "Number") {
        const representation = hint || "abstract";
        return this.internType(`number:${identity}`, () => ({
          ...baseType("number"),
          representation,
        }));
      }
      const kind = target.name === "Bool"
        ? "bool"
        : target.name === "Void"
        ? "void"
        : target.name === "String"
        ? "string"
        : "named";
      return this.internType(
        `prim:${target.name}`,
        () => ({ ...baseType(kind), name: target.name }),
      );
    }
    if (target.tag === "tuple") {
      const itemIds = tupleItems ??
        target.items.map((item, index) => this.type(item, "", `${identity}:item:${index}`));
      const vector = target.items.length >= 2 && target.items.length <= 4 &&
        target.items.every((item) => {
          const resolved = prune(item);
          return resolved.tag === "prim" && resolved.name === "Number";
        });
      const kind = vector ? "vector" : "tuple";
      return this.internType(`${kind}:${identity}:${itemIds.join(",")}`, () => ({
        ...baseType(kind),
        representation: vector ? "abstract" : "",
        width: vector ? itemIds.length : 0,
        items: itemIds,
      }));
    }
    if (target.tag === "fn") {
      const params = target.params.map((param, index) =>
        this.type(param, "", `${identity}:param:${index}`)
      );
      const result = this.type(target.result, "", `${identity}:result`);
      return this.internType(`fn:${identity}:${params.join(",")}=>${result}`, () => ({
        ...baseType("function"),
        params,
        result,
      }));
    }
    if (target.tag === "named" || target.tag === "struct") {
      const name = target.tag === "named" ? target.name : "structural";
      const items = target.tag === "named"
        ? target.args.map((arg, index) => this.type(arg, "", `${identity}:arg:${index}`))
        : [];
      return this.internType(`named:${identity}:${name}:${items.join(",")}`, () => ({
        ...baseType("named"),
        name,
        items,
      }));
    }
    return this.internType(`unknown:${target.tag}`, () => baseType("unknown"));
  }

  internType(key: string, create: () => Omit<GpuTypeDto, "id">): number {
    const existing = this.#typesByKey.get(key);
    if (existing !== undefined) return existing;
    const id = this.types.length;
    this.#typesByKey.set(key, id);
    this.types.push({ id, ...create() });
    return id;
  }

  span(path: string, value: { node?: { span: SourceSpan } }): number {
    const source = value.node?.span;
    if (!source) return -1;
    const key = `${path}:${source.start}:${source.end}`;
    const existing = this.#spansByKey.get(key);
    if (existing !== undefined) return existing;
    const id = this.spans.length;
    this.#spansByKey.set(key, id);
    this.spans.push({ id, path, ...source });
    return id;
  }
}

function topLevelLambdaBindings(
  module: Module,
): {
  value: Extract<Expr, { kind: "Lambda" }>;
  pattern: Pattern;
  node?: import("../source.ts").AstNode;
}[] {
  return module.decls.flatMap((decl) =>
    decl.kind === "LetDecl"
      ? decl.bindings.flatMap((binding) =>
        binding.value.kind === "Lambda" ? [{ ...binding, value: binding.value }] : []
      )
      : []
  );
}

function topLevelValueBindings(module: Module): import("../ast.ts").Binding[] {
  return module.decls.flatMap((decl) =>
    decl.kind === "LetDecl"
      ? decl.bindings.filter((binding) =>
        binding.pattern.kind === "PVar" && binding.value.kind !== "Lambda"
      )
      : []
  );
}

function baseType(kind: GpuTypeDto["kind"]): Omit<GpuTypeDto, "id"> {
  return { kind, name: "", representation: "", width: 0, items: [], params: [], result: -1 };
}

function numericHint(expr: Expr): GpuTypeDto["representation"] {
  if (expr.kind === "Int") return "i32";
  if (expr.kind === "Float") return "f32";
  return "";
}

function exprKind(expr: Expr): string {
  return expr.kind === "Int" || expr.kind === "Float" ? "number" : expr.kind.toLowerCase();
}

function exprCapability(
  expr: Expr,
  input: ModuleInput,
  bindingId: number,
): GpuExprDto["capability"] {
  if (expr.kind === "FfiGet" || expr.kind === "FfiCall" || expr.kind === "FfiBindingCall") {
    return "host-ffi";
  }
  if (expr.kind === "Var" && bindingId < 0 && input.result.env.get(expr.name)?.jsImport) {
    return "host-ffi";
  }
  if (
    expr.kind === "Call" && expr.callee.kind === "Var" &&
    input.result.env.get(expr.callee.name)?.jsImport
  ) return "host-ffi";
  if (
    expr.kind === "String" || expr.kind === "JsonObject" || expr.kind === "JsonArray" ||
    expr.kind === "Panic" || expr.kind === "Match" || expr.kind === "Record" ||
    expr.kind === "Pipe" || expr.kind === "Lambda"
  ) return "unsupported";
  return "gpu";
}

function firstPatternBindingId(pattern: Pattern, facts: BindingFacts): BindingId | undefined {
  if (pattern.kind === "PVar") return facts.binders.get(pattern);
  if (pattern.kind === "PTuple") {
    for (const item of pattern.items) {
      const id = firstPatternBindingId(item, facts);
      if (id !== undefined) return id;
    }
  }
  if (pattern.kind === "PRecord") {
    for (const field of pattern.fields) {
      const id = firstPatternBindingId(field.pattern, facts);
      if (id !== undefined) return id;
    }
  }
  if (pattern.kind === "PCtor") {
    for (const arg of pattern.args) {
      const id = firstPatternBindingId(arg, facts);
      if (id !== undefined) return id;
    }
  }
  return undefined;
}

function firstPatternName(pattern: Pattern): string | undefined {
  if (pattern.kind === "PVar") return pattern.name;
  if (pattern.kind === "PTuple") return pattern.items.map(firstPatternName).find(Boolean);
  if (pattern.kind === "PRecord") {
    return pattern.fields.map((field) => firstPatternName(field.pattern)).find(Boolean);
  }
  if (pattern.kind === "PCtor") return pattern.args.map(firstPatternName).find(Boolean);
  return undefined;
}

function directBindingName(binding: import("../ast.ts").Binding): string | undefined {
  return binding.pattern.kind === "PVar" ? binding.pattern.name : undefined;
}

function isDecl(value: Decl | Expr): value is Decl {
  return value.kind.endsWith("Decl");
}

function required<T>(map: Map<string, T>, path: string, label: string): T {
  const value = map.get(path);
  if (!value) throw new Error(`missing ${label} for ${path}`);
  return value;
}
