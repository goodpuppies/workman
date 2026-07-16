import type { Binding, CtorDecl, Decl, Expr, Pattern } from "../ast.ts";
import type { BindingFacts } from "../binding_facts.ts";
import { GPU_SEMANTIC_IDS } from "../compiler_semantics.ts";
import type { GpuFragmentSelectionFacts } from "../gpu_selection.ts";
import type { InferResult } from "../infer.ts";
import type { CtorId } from "../ids.ts";
import type { ModuleGraph, ModuleNode } from "../module_graph.ts";
import type { NominalConstructorFact, NominalFacts, NominalTypeFact } from "../nominal_facts.ts";
import type { ResolvedPatternFact, ResolvedPatternFacts } from "../pattern_facts.ts";
import type { RecursionFacts } from "../recursion_facts.ts";
import type { SourceSpan } from "../source.ts";
import { prune, type Ty } from "../types.ts";
import {
  GPU_SLICE_SCHEMA_VERSION,
  type GpuSliceAdtDto,
  type GpuSliceBlockItemDto,
  type GpuSliceConstructorDto,
  type GpuSliceElaborationInput,
  type GpuSliceExprDto,
  type GpuSliceFunctionDto,
  type GpuSlicePatternDto,
  type GpuSliceSpanDto,
  type GpuSliceTypeDto,
} from "./v2_dto.ts";

type LambdaExpr = Extract<Expr, { kind: "Lambda" }>;
type CallExpr = Extract<Expr, { kind: "Call" }>;

export type GpuSliceAnalysis = {
  graph: ModuleGraph;
  results: Map<string, InferResult>;
  bindings: Map<string, BindingFacts>;
  nominalFacts: NominalFacts;
  patternFacts: ResolvedPatternFacts;
  recursionFacts: RecursionFacts;
  fragmentSelections: GpuFragmentSelectionFacts;
};

export class GpuSliceNormalizationError extends Error {
  constructor(
    readonly code:
      | "gpu.fragment.count"
      | "gpu.fragment.cross-module"
      | "gpu.function.unsupported"
      | "gpu.capture.illegal"
      | "gpu.type.unsupported"
      | "gpu.adt.unsupported"
      | "gpu.pattern.unsupported"
      | "gpu.expression.unsupported"
      | "gpu.recursion.mutual",
    readonly path: string,
    readonly subject: Expr | Pattern | Decl | Binding | CtorDecl | undefined,
    message: string,
  ) {
    super(message);
    this.name = "GpuSliceNormalizationError";
  }
}

export function normalizeGpuSliceProgram(analysis: GpuSliceAnalysis): GpuSliceElaborationInput {
  const selections = analysis.fragmentSelections;
  if (selections.selectors.length === 0) return emptyInput(analysis.graph.entry);
  if (selections.selectors.length !== 1 || selections.roots.length !== 1) {
    throw new GpuSliceNormalizationError(
      "gpu.fragment.count",
      analysis.graph.entry,
      selections.selectors[1]?.call,
      "wmslang v1 accepts exactly one Gpu.fragment selection per program",
    );
  }
  return new SliceNormalizer(analysis).normalize();
}

function emptyInput(sourcePath: string): GpuSliceElaborationInput {
  return {
    schemaVersion: GPU_SLICE_SCHEMA_VERSION,
    sourcePath,
    root: { functionId: -1, selectorSpanId: -1 },
    functions: [],
    types: [],
    adts: [],
    constructors: [],
    patterns: [],
    params: [],
    lets: [],
    matchArms: [],
    blockItems: [],
    blocks: [],
    matches: [],
    expressions: [],
    recursionGroups: [],
    recursiveReferences: [],
    spans: [],
  };
}

type FunctionSite = {
  id: number;
  bindingId: number;
  name: string;
  lambda: LambdaExpr;
  binding?: Binding;
};

class SliceNormalizer {
  readonly root: GpuFragmentSelectionFacts["roots"][number];
  readonly selector: GpuFragmentSelectionFacts["selectors"][number];
  readonly path: string;
  readonly node: ModuleNode;
  readonly result: InferResult;
  readonly bindings: BindingFacts;

  readonly functions: GpuSliceFunctionDto[] = [];
  readonly types: GpuSliceTypeDto[] = [];
  readonly adts: GpuSliceAdtDto[] = [];
  readonly constructors: GpuSliceConstructorDto[] = [];
  readonly patterns: GpuSlicePatternDto[] = [];
  readonly params: GpuSliceElaborationInput["params"] = [];
  readonly lets: GpuSliceElaborationInput["lets"] = [];
  readonly matchArms: GpuSliceElaborationInput["matchArms"] = [];
  readonly blockItems: GpuSliceBlockItemDto[] = [];
  readonly blocks: GpuSliceElaborationInput["blocks"] = [];
  readonly matches: GpuSliceElaborationInput["matches"] = [];
  readonly expressions: GpuSliceExprDto[] = [];
  readonly recursionGroups: GpuSliceElaborationInput["recursionGroups"] = [];
  readonly recursiveReferences: GpuSliceElaborationInput["recursiveReferences"] = [];
  readonly spans: GpuSliceSpanDto[] = [];

  readonly #functionSites: FunctionSite[] = [];
  readonly #functionByBinding = new Map<number, FunctionSite>();
  readonly #topLevelLambdas = new Map<number, { binding: Binding; lambda: LambdaExpr }>();
  readonly #allowedValueBindings = new Set<number>();
  readonly #typesByKey = new Map<string, number>();
  readonly #patternsById = new Map<number, GpuSlicePatternDto>();
  readonly #adtsById = new Map<number, GpuSliceAdtDto>();
  readonly #constructorsById = new Map<number, GpuSliceConstructorDto>();
  readonly #spansByKey = new Map<string, number>();

  constructor(readonly analysis: GpuSliceAnalysis) {
    this.root = analysis.fragmentSelections.roots[0];
    this.selector = analysis.fragmentSelections.selectors[0];
    this.path = this.root.path;
    this.node = required(analysis.graph.nodes, this.path, "selected root module");
    this.result = required(analysis.results, this.path, "selected root inference result");
    this.bindings = required(analysis.bindings, this.path, "selected root binding facts");
    if (this.selector.path !== this.path) {
      throw new GpuSliceNormalizationError(
        "gpu.fragment.cross-module",
        this.selector.path,
        this.selector.call,
        "wmslang v1 requires the fragment selection and selected root in one module",
      );
    }
  }

  normalize(): GpuSliceElaborationInput {
    this.indexTopLevelLambdas();
    this.discoverFunctions();
    this.collectAllowedBindings();
    this.#functionSites.forEach((site) => this.addFunction(site));
    this.addRecursionGroups();
    return {
      schemaVersion: GPU_SLICE_SCHEMA_VERSION,
      sourcePath: this.path,
      root: {
        functionId: 0,
        selectorSpanId: this.span(this.selector.call),
      },
      functions: this.functions,
      types: this.types,
      adts: this.adts,
      constructors: this.constructors,
      patterns: this.patterns,
      params: this.params,
      lets: this.lets,
      matchArms: this.matchArms,
      blockItems: this.blockItems,
      blocks: this.blocks,
      matches: this.matches,
      expressions: this.expressions,
      recursionGroups: this.recursionGroups,
      recursiveReferences: this.recursiveReferences,
      spans: this.spans,
    };
  }

  indexTopLevelLambdas(): void {
    for (const declaration of this.node.module.decls) {
      if (declaration.kind !== "LetDecl") continue;
      for (const binding of declaration.bindings) {
        if (binding.pattern.kind !== "PVar" || binding.value.kind !== "Lambda") continue;
        const id = this.bindings.binders.get(binding.pattern);
        if (id !== undefined) this.#topLevelLambdas.set(id, { binding, lambda: binding.value });
      }
    }
  }

  discoverFunctions(): void {
    const rootBindingId = this.root.bindingId ?? -1;
    this.registerFunction({
      id: 0,
      bindingId: rootBindingId,
      name: this.root.binding?.pattern.kind === "PVar"
        ? this.root.binding.pattern.name
        : "fragment",
      lambda: this.root.lambda,
      binding: this.root.binding,
    });
    for (let index = 0; index < this.#functionSites.length; index++) {
      this.walk(this.#functionSites[index].lambda.body, (expression) => {
        if (expression.kind !== "Call" || expression.callee.kind !== "Var") return;
        if (this.semanticId(expression.callee) || this.constructorId(expression.callee) !== -1) {
          return;
        }
        const bindingId = this.bindings.references.get(expression.callee);
        if (bindingId === undefined || this.#functionByBinding.has(bindingId)) return;
        const helper = this.#topLevelLambdas.get(bindingId);
        if (!helper) return;
        this.registerFunction({
          id: this.#functionSites.length,
          bindingId,
          name: helper.binding.pattern.kind === "PVar" ? helper.binding.pattern.name : "helper",
          lambda: helper.lambda,
          binding: helper.binding,
        });
      });
    }
  }

  registerFunction(site: FunctionSite): void {
    this.#functionSites.push(site);
    if (site.bindingId >= 0) this.#functionByBinding.set(site.bindingId, site);
  }

  collectAllowedBindings(): void {
    for (const site of this.#functionSites) {
      site.lambda.params.forEach((param) => this.collectPatternBindings(param.pattern));
      this.walk(site.lambda.body, (_expression, declaration) => {
        if (declaration?.kind === "LetDecl") {
          declaration.bindings.forEach((binding) => this.collectPatternBindings(binding.pattern));
        }
      }, (pattern) => this.collectPatternBindings(pattern));
    }
  }

  collectPatternBindings(pattern: Pattern): void {
    const fact = this.analysis.patternFacts.byPattern.get(pattern);
    if (!fact) return;
    if (fact.bindingId !== undefined) this.#allowedValueBindings.add(fact.bindingId);
    fact.children.forEach((id) => {
      const child = this.analysis.patternFacts.patterns.find((item) => item.id === id);
      if (child) this.collectPatternBindings(child.pattern);
    });
  }

  addFunction(site: FunctionSite): void {
    const lambdaType = this.result.types.get(site.lambda);
    const resolved = lambdaType ? prune(lambdaType) : undefined;
    if (!resolved || resolved.tag !== "fn") {
      throw this.error("gpu.type.unsupported", site.lambda, "GPU function has no resolved type");
    }
    const paramIds = site.lambda.params.map((param, index) => {
      const fact = requiredObject(
        this.analysis.patternFacts.byParam.get(param),
        "missing resolved parameter fact",
      );
      const typeId = site.id === 0 && index === 0
        ? this.rootCoordinateType()
        : this.type(fact.type);
      const patternId = this.addPattern(fact.patternId, "parameter", typeId);
      this.params.push({
        id: fact.id,
        patternId,
        typeId,
        declaredIndex: index,
        spanId: this.span(param),
      });
      return fact.id as number;
    });
    const resultTypeId = this.type(resolved.result);
    const bodyExprId = this.expr(site.lambda.body);
    const recursion = site.binding
      ? this.analysis.recursionFacts.byBinding.get(site.binding)
      : undefined;
    this.functions.push({
      id: site.id,
      bindingId: site.bindingId,
      name: site.name,
      paramIds,
      resultTypeId,
      bodyExprId,
      recursionGroupId: recursion?.groupId ?? -1,
      spanId: this.span(site.lambda),
    });
  }

  addRecursionGroups(): void {
    const functionIds = new Map(
      this.#functionSites.filter((site) => site.bindingId >= 0).map((
        site,
      ) => [site.bindingId, site.id]),
    );
    for (const group of this.analysis.recursionFacts.groups) {
      const members = group.members.flatMap((member) => {
        const id = functionIds.get(member.bindingId);
        return id === undefined ? [] : [id];
      });
      if (members.length === 0) continue;
      if (group.members.length !== 1 || members.length !== 1) {
        throw new GpuSliceNormalizationError(
          "gpu.recursion.mutual",
          group.path,
          group.declaration,
          "wmslang v1 accepts only a single-member recursive group",
        );
      }
      this.recursionGroups.push({
        id: group.id,
        memberFunctionIds: members,
        spanId: this.span(group.declaration),
      });
    }
  }

  expr(expression: Expr): number {
    const id = this.expressions.length;
    this.expressions.push(undefined as unknown as GpuSliceExprDto);
    let row: Omit<GpuSliceExprDto, "id" | "typeId" | "spanId">;
    switch (expression.kind) {
      case "Int":
      case "Float":
        row = baseExpr("number", { numberValue: expression.value });
        break;
      case "Bool":
        row = baseExpr("bool", { boolValue: expression.value });
        break;
      case "Void": {
        // A trailing semicolon's expression already appears as its block item.
        // implicitStatement is provenance, not a second executable occurrence.
        row = baseExpr("void");
        break;
      }
      case "Var":
        row = this.varExpr(expression);
        break;
      case "Tuple":
        row = baseExpr("tuple", { children: expression.items.map((item) => this.expr(item)) });
        break;
      case "Call":
        row = this.callExpr(expression, id);
        break;
      case "If":
        row = baseExpr("if", {
          children: [
            this.expr(expression.cond),
            this.expr(expression.thenExpr),
            this.expr(expression.elseExpr),
          ],
        });
        break;
      case "Match": {
        const valueExprId = this.expr(expression.value);
        const armIds = expression.arms.map((arm, index) => {
          const fact = requiredObject(
            this.analysis.patternFacts.byMatchArm.get(arm),
            "missing resolved match-arm fact",
          );
          const patternId = this.addPattern(fact.patternId, "match");
          const bodyExprId = this.expr(arm.body);
          this.matchArms.push({
            id: fact.id,
            patternId,
            bodyExprId,
            declaredIndex: index,
            spanId: this.span(arm),
          });
          return fact.id as number;
        });
        this.matches.push({ expressionId: id, valueExprId, armIds });
        row = baseExpr("match", {
          children: [
            valueExprId,
            ...armIds.map((armId) =>
              requiredObject(
                this.matchArms.find((arm) => arm.id === armId),
                "missing normalized match arm",
              ).bodyExprId
            ),
          ],
        });
        break;
      }
      case "Block":
        row = this.blockExpr(expression, id);
        break;
      case "Binary":
      case "Unary": {
        const operatorId = this.result.facts.operators.get(expression);
        if (!operatorId) {
          throw this.error(
            "gpu.expression.unsupported",
            expression,
            `operator ${expression.op} is outside the v1 catalog`,
          );
        }
        row = baseExpr(expression.kind === "Binary" ? "binary" : "unary", {
          operatorId,
          children: expression.kind === "Binary"
            ? [this.expr(expression.left), this.expr(expression.right)]
            : [this.expr(expression.value)],
        });
        break;
      }
      default:
        throw this.error(
          "gpu.expression.unsupported",
          expression,
          `${expression.kind} is outside the wmslang v1 expression slice`,
        );
    }
    const type = this.result.types.get(expression);
    if (!type) {
      throw this.error("gpu.type.unsupported", expression, "missing inferred expression type");
    }
    this.expressions[id] = {
      id,
      typeId: this.type(type),
      spanId: this.span(expression),
      ...row,
    };
    return id;
  }

  varExpr(
    expression: Extract<Expr, { kind: "Var" }>,
  ): Omit<GpuSliceExprDto, "id" | "typeId" | "spanId"> {
    const projection = this.vectorProjectionExpr(expression);
    if (projection) return projection;
    const constructorId = this.constructorId(expression);
    if (constructorId >= 0) {
      const constructor = this.addConstructor(constructorId as CtorId);
      if (constructor.payloadTypeId >= 0) {
        throw this.error(
          "gpu.expression.unsupported",
          expression,
          "a payload constructor must be called directly",
        );
      }
      return baseExpr("constructor", { constructorId });
    }
    const bindingId = this.bindings.references.get(expression);
    if (bindingId === undefined) {
      throw this.error(
        "gpu.capture.illegal",
        expression,
        `unresolved GPU value ${expression.name}`,
      );
    }
    if (this.#functionByBinding.has(bindingId)) {
      throw this.error(
        "gpu.function.unsupported",
        expression,
        "wmslang v1 functions may appear only as direct callees",
      );
    }
    if (!this.#allowedValueBindings.has(bindingId)) {
      throw this.error(
        "gpu.capture.illegal",
        expression,
        `wmslang v1 does not capture ${expression.name}`,
      );
    }
    if (expression.name.includes(".")) {
      throw this.error(
        "gpu.expression.unsupported",
        expression,
        `GPU dotted value ${expression.name} is not a supported vector projection`,
      );
    }
    return baseExpr("var", { bindingId });
  }

  vectorProjectionExpr(
    expression: Extract<Expr, { kind: "Var" }>,
  ): Omit<GpuSliceExprDto, "id" | "typeId" | "spanId"> | undefined {
    const parts = expression.name.split(".");
    if (parts.length !== 2) return undefined;
    const index = ({ x: 0, y: 1, z: 2, w: 3 } as const)[
      parts[1] as "x" | "y" | "z" | "w"
    ];
    if (index === undefined) return undefined;
    const bindingId = this.bindings.references.get(expression);
    if (bindingId === undefined || !this.#allowedValueBindings.has(bindingId)) return undefined;
    const binding = this.analysis.patternFacts.patterns.find((fact) =>
      fact.bindingId === bindingId
    );
    if (!binding) return undefined;
    const receiver = prune(binding.type);
    if (
      receiver.tag !== "tuple" || receiver.items.length < 2 || receiver.items.length > 4 ||
      index >= receiver.items.length ||
      receiver.items.some((item) => {
        const type = prune(item);
        return type.tag !== "prim" || type.name !== "Number";
      })
    ) return undefined;
    const childId = this.expressions.length;
    this.expressions.push({
      id: childId,
      typeId: this.type(binding.type),
      spanId: this.span(expression),
      ...baseExpr("var", { bindingId }),
    });
    return baseExpr("project", { index, children: [childId] });
  }

  callExpr(
    expression: CallExpr,
    expressionId: number,
  ): Omit<GpuSliceExprDto, "id" | "typeId" | "spanId"> {
    const semanticId = this.semanticId(expression.callee);
    if (semanticId) {
      if (semanticId !== GPU_SEMANTIC_IDS.color) {
        throw this.error(
          "gpu.expression.unsupported",
          expression,
          `${semanticId} is not callable inside the static v1 shader slice`,
        );
      }
      return baseExpr("copy", {
        children: expression.args.map((argument) => this.expr(argument)),
      });
    }
    const constructorId = this.constructorId(expression.callee);
    if (constructorId >= 0) {
      const constructor = this.addConstructor(constructorId as CtorId);
      const children = expression.args.map((argument) => this.expr(argument));
      if ((constructor.payloadTypeId < 0 ? 0 : 1) !== children.length) {
        throw this.error(
          "gpu.adt.unsupported",
          expression,
          "v1 constructors are nullary or carry one Number payload",
        );
      }
      return baseExpr("constructor", { constructorId, children });
    }
    if (expression.callee.kind !== "Var") {
      throw this.error(
        "gpu.function.unsupported",
        expression.callee,
        "wmslang v1 calls require one resolved direct callee",
      );
    }
    const bindingId = this.bindings.references.get(expression.callee);
    const target = bindingId === undefined ? undefined : this.#functionByBinding.get(bindingId);
    if (!target) {
      throw this.error(
        bindingId === undefined ? "gpu.function.unsupported" : "gpu.fragment.cross-module",
        expression.callee,
        "wmslang v1 calls only same-module selected helpers",
      );
    }
    const recursion = this.analysis.recursionFacts.byExpression.get(expression);
    if (recursion) {
      this.recursiveReferences.push({
        expressionId,
        groupId: recursion.groupId,
        targetFunctionId: target.id,
        relation: recursion.relation,
        invocation: recursion.invocation,
        spanId: this.span(expression),
      });
    }
    return baseExpr("call", {
      bindingId,
      functionId: target.id,
      children: expression.args.map((argument) => this.expr(argument)),
    });
  }

  blockExpr(
    expression: Extract<Expr, { kind: "Block" }>,
    expressionId: number,
  ): Omit<GpuSliceExprDto, "id" | "typeId" | "spanId"> {
    const itemIds = expression.items.map((item, declaredIndex) => {
      const itemId = this.blockItems.length;
      if (!isDecl(item)) {
        const childId = this.expr(item);
        this.blockItems.push({
          id: itemId,
          blockExprId: expressionId,
          declaredIndex,
          kind: "expression",
          expressionId: childId,
          letId: -1,
          spanId: this.span(item),
        });
        return itemId;
      }
      if (item.kind !== "LetDecl" || item.recursive || item.bindings.length !== 1) {
        throw this.error(
          "gpu.expression.unsupported",
          item,
          "v1 blocks accept one non-recursive immutable binding per let declaration",
        );
      }
      const binding = item.bindings[0];
      const fact = requiredObject(
        this.analysis.patternFacts.byBinding.get(binding),
        "missing resolved let fact",
      );
      const patternId = this.addPattern(fact.patternId, "let");
      const valueExprId = this.expr(binding.value);
      this.lets.push({
        id: fact.id,
        patternId,
        valueExprId,
        declaredIndex: fact.declaredIndex,
        spanId: this.span(binding),
      });
      this.blockItems.push({
        id: itemId,
        blockExprId: expressionId,
        declaredIndex,
        kind: "let",
        expressionId: -1,
        letId: fact.id,
        spanId: this.span(item),
      });
      return itemId;
    });
    const resultExprId = this.expr(expression.result);
    this.blocks.push({ expressionId, itemIds, resultExprId });
    const children = itemIds.map((itemId) => {
      const item = this.blockItems[itemId];
      if (item.kind === "expression") return item.expressionId;
      return requiredObject(this.lets.find((letRow) => letRow.id === item.letId), "missing let row")
        .valueExprId;
    });
    return baseExpr("block", { children: [...children, resultExprId] });
  }

  addPattern(
    patternId: number,
    expectedContext: GpuSlicePatternDto["context"],
    forcedTypeId?: number,
  ): number {
    const existing = this.#patternsById.get(patternId);
    if (existing) return existing.id;
    const fact = requiredObject(
      this.analysis.patternFacts.patterns.find((item) => item.id === patternId),
      `missing resolved pattern ${patternId}`,
    );
    const kind = this.validatePattern(fact, expectedContext);
    const row: GpuSlicePatternDto = {
      id: fact.id,
      context: expectedContext,
      kind,
      typeId: forcedTypeId ?? this.type(fact.type),
      bindingId: fact.bindingId ?? -1,
      constructorId: fact.constructorId ?? -1,
      children: fact.children.map((child) => this.addPattern(child, expectedContext)),
      spanId: this.span(fact.pattern),
    };
    if (fact.constructorId !== undefined) this.addConstructor(fact.constructorId);
    this.#patternsById.set(row.id, row);
    this.patterns.push(row);
    return row.id;
  }

  validatePattern(
    fact: ResolvedPatternFact,
    expectedContext: GpuSlicePatternDto["context"],
  ): GpuSlicePatternDto["kind"] {
    if (fact.context !== expectedContext) {
      throw this.patternError(fact, "pattern context does not match its normalized owner");
    }
    if (fact.kind === "wildcard" || fact.kind === "binding") return fact.kind;
    if (fact.kind === "tuple" && expectedContext !== "match") {
      const children = fact.children.map((id) =>
        requiredObject(
          this.analysis.patternFacts.patterns.find((item) => item.id === id),
          `missing tuple pattern child ${id}`,
        )
      );
      if (children.every((child) => child.kind === "wildcard" || child.kind === "binding")) {
        return "tuple";
      }
    }
    if (fact.kind === "constructor" && expectedContext === "match") {
      const children = fact.children.map((id) =>
        requiredObject(
          this.analysis.patternFacts.patterns.find((item) => item.id === id),
          `missing constructor pattern child ${id}`,
        )
      );
      if (
        children.length <= 1 &&
        children.every((child) => child.kind === "wildcard" || child.kind === "binding")
      ) return "constructor";
    }
    throw this.patternError(fact, `${fact.kind} is outside the restricted v1 pattern slice`);
  }

  patternError(fact: ResolvedPatternFact, message: string): GpuSliceNormalizationError {
    return new GpuSliceNormalizationError(
      "gpu.pattern.unsupported",
      this.path,
      fact.pattern,
      message,
    );
  }

  type(type: Ty): number {
    const target = prune(type);
    if (target.tag === "var") {
      return this.internType("f32", () => baseType("f32"));
    }
    if (target.tag === "prim") {
      if (target.name === "Number") return this.internType("f32", () => baseType("f32"));
      if (target.name === "Bool") return this.internType("bool", () => baseType("bool"));
      if (target.name === "Void") return this.internType("void", () => baseType("void"));
      throw this.typeError(`primitive ${target.name} is outside the v1 shader slice`);
    }
    if (target.tag === "tuple") {
      const items = target.items.map((item) => this.type(item));
      if (
        items.length >= 2 && items.length <= 4 &&
        items.every((item) => this.types[item]?.kind === "f32")
      ) {
        return this.internType(`vector:${items.length}`, () => ({
          ...baseType("vector"),
          items,
        }));
      }
      return this.internType(`tuple:${items.join(",")}`, () => ({ ...baseType("tuple"), items }));
    }
    if (target.tag === "fn") {
      const params = target.params.map((param) => this.type(param));
      const result = this.type(target.result);
      return this.internType(`fn:${params.join(",")}=>${result}`, () => ({
        ...baseType("function"),
        params,
        result,
      }));
    }
    if (target.tag === "named") {
      const typeNameId = this.analysis.nominalFacts.inferenceTypeIds.get(target.id);
      if (typeNameId === undefined) {
        throw this.typeError(`missing nominal identity for ${target.name}`);
      }
      const nominal = this.analysis.nominalFacts.types.find((item) => item.id === typeNameId);
      if (!nominal || nominal.kind !== "adt") {
        throw this.typeError(`named type ${target.name} is outside the v1 ADT slice`);
      }
      this.addAdt(nominal);
      return this.internType(`adt:${typeNameId}`, () => ({
        ...baseType("adt"),
        typeNameId,
      }));
    }
    throw this.typeError(`${target.tag} is outside the v1 shader type slice`);
  }

  rootCoordinateType(): number {
    const f32 = this.internType("f32", () => baseType("f32"));
    return this.internType("vector:2", () => ({
      ...baseType("vector"),
      items: [f32, f32],
    }));
  }

  addAdt(fact: NominalTypeFact): GpuSliceAdtDto {
    const existing = this.#adtsById.get(fact.id);
    if (existing) return existing;
    if (fact.modulePath !== this.path || fact.declaration.kind !== "TypeDecl") {
      throw this.adtError(fact.declaration, "v1 ADTs must be declared beside the selected root");
    }
    if (fact.declaration.params.length !== 0 || fact.declaration.alias) {
      throw this.adtError(fact.declaration, "v1 accepts one non-generic variant ADT");
    }
    if (this.adts.length !== 0) {
      throw this.adtError(fact.declaration, "v1 accepts only one reachable ADT declaration");
    }
    const constructors = this.analysis.nominalFacts.constructors.filter((item) =>
      item.typeNameId === fact.id
    );
    const row: GpuSliceAdtDto = {
      typeNameId: fact.id,
      name: fact.name,
      constructorIds: constructors.map((item) => item.id),
      spanId: this.span(fact.declaration),
    };
    this.#adtsById.set(row.typeNameId, row);
    this.adts.push(row);
    constructors.forEach((constructor) => this.addConstructorFact(constructor));
    return row;
  }

  addConstructor(id: CtorId): GpuSliceConstructorDto {
    const existing = this.#constructorsById.get(id);
    if (existing) return existing;
    const fact = requiredObject(
      this.analysis.nominalFacts.constructors.find((item) => item.id === id),
      `missing constructor fact ${id}`,
    );
    const nominal = requiredObject(
      this.analysis.nominalFacts.types.find((item) => item.id === fact.typeNameId),
      `missing ADT fact ${fact.typeNameId}`,
    );
    this.addAdt(nominal);
    return requiredObject(this.#constructorsById.get(id), `missing normalized constructor ${id}`);
  }

  addConstructorFact(fact: NominalConstructorFact): GpuSliceConstructorDto {
    const existing = this.#constructorsById.get(fact.id);
    if (existing) return existing;
    let payloadTypeId = -1;
    if (fact.declaration.args.length > 1) {
      throw this.adtError(fact.declaration, "v1 constructors carry at most one Number payload");
    }
    if (fact.declaration.args.length === 1) {
      const payload = fact.declaration.args[0];
      if (payload.kind !== "TName" || payload.name !== "Number" || payload.args.length !== 0) {
        throw this.adtError(fact.declaration, "v1 constructor payloads must be Number");
      }
      payloadTypeId = this.internType("f32", () => baseType("f32"));
    }
    const row: GpuSliceConstructorDto = {
      id: fact.id,
      typeNameId: fact.typeNameId,
      name: fact.name,
      tag: fact.tag,
      payloadTypeId,
      spanId: this.span(fact.declaration),
    };
    this.#constructorsById.set(row.id, row);
    this.constructors.push(row);
    return row;
  }

  internType(key: string, create: () => Omit<GpuSliceTypeDto, "id">): number {
    const existing = this.#typesByKey.get(key);
    if (existing !== undefined) return existing;
    const id = this.types.length;
    this.#typesByKey.set(key, id);
    this.types.push({ id, ...create() });
    return id;
  }

  constructorId(expression: Expr): number {
    return this.analysis.nominalFacts.constructorReferences.get(expression) ?? -1;
  }

  semanticId(expression: Expr): ReturnType<SliceNormalizer["semanticIdValue"]> {
    return this.semanticIdValue(expression);
  }

  semanticIdValue(expression: Expr) {
    return this.result.facts.expressions.get(expression)?.origin?.semanticId;
  }

  span(value: { node?: { span: SourceSpan } }): number {
    const source = value.node?.span;
    if (!source) return -1;
    const key = `${source.start}:${source.end}`;
    const existing = this.#spansByKey.get(key);
    if (existing !== undefined) return existing;
    const id = this.spans.length;
    this.#spansByKey.set(key, id);
    this.spans.push({ id, path: this.path, ...source });
    return id;
  }

  walk(
    expression: Expr,
    visitExpression: (expression: Expr, declaration?: Decl) => void,
    visitPattern: (pattern: Pattern) => void = () => {},
  ): void {
    visitExpression(expression);
    switch (expression.kind) {
      case "Tuple":
      case "JsonArray":
        expression.items.forEach((item) => this.walk(item, visitExpression, visitPattern));
        return;
      case "Record":
      case "JsonObject":
        expression.fields.forEach((field) => this.walk(field.value, visitExpression, visitPattern));
        return;
      case "FfiGet":
        this.walk(expression.receiver, visitExpression, visitPattern);
        return;
      case "FfiCall":
        this.walk(expression.receiver, visitExpression, visitPattern);
        expression.args.forEach((arg) => this.walk(arg, visitExpression, visitPattern));
        return;
      case "FfiBindingCall":
        expression.args.forEach((arg) => this.walk(arg, visitExpression, visitPattern));
        return;
      case "Lambda":
        expression.params.forEach((param) => visitPattern(param.pattern));
        this.walk(expression.body, visitExpression, visitPattern);
        return;
      case "Call":
        this.walk(expression.callee, visitExpression, visitPattern);
        expression.args.forEach((arg) => this.walk(arg, visitExpression, visitPattern));
        return;
      case "If":
        [expression.cond, expression.thenExpr, expression.elseExpr].forEach((item) =>
          this.walk(item, visitExpression, visitPattern)
        );
        return;
      case "Match":
        this.walk(expression.value, visitExpression, visitPattern);
        expression.arms.forEach((arm) => {
          visitPattern(arm.pattern);
          this.walk(arm.body, visitExpression, visitPattern);
        });
        return;
      case "Panic":
        this.walk(expression.message, visitExpression, visitPattern);
        return;
      case "Block":
        expression.items.forEach((item) => {
          if (isDecl(item)) {
            visitExpression(expression, item);
            if (item.kind === "LetDecl") {
              item.bindings.forEach((binding) => {
                visitPattern(binding.pattern);
                this.walk(binding.value, visitExpression, visitPattern);
              });
            }
          } else this.walk(item, visitExpression, visitPattern);
        });
        this.walk(expression.result, visitExpression, visitPattern);
        return;
      case "Binary":
      case "Pipe":
        this.walk(expression.left, visitExpression, visitPattern);
        this.walk(expression.right, visitExpression, visitPattern);
        return;
      case "Unary":
        this.walk(expression.value, visitExpression, visitPattern);
        return;
      default:
        return;
    }
  }

  error(
    code: GpuSliceNormalizationError["code"],
    subject: Expr | Decl,
    message: string,
  ): GpuSliceNormalizationError {
    return new GpuSliceNormalizationError(code, this.path, subject, message);
  }

  typeError(message: string): GpuSliceNormalizationError {
    return new GpuSliceNormalizationError("gpu.type.unsupported", this.path, undefined, message);
  }

  adtError(
    subject: Decl | CtorDecl,
    message: string,
  ): GpuSliceNormalizationError {
    return new GpuSliceNormalizationError("gpu.adt.unsupported", this.path, subject, message);
  }
}

function baseType(kind: GpuSliceTypeDto["kind"]): Omit<GpuSliceTypeDto, "id"> {
  return { kind, typeNameId: -1, items: [], params: [], result: -1 };
}

function baseExpr(
  kind: GpuSliceExprDto["kind"],
  overrides: Partial<Omit<GpuSliceExprDto, "id" | "kind" | "typeId" | "spanId">> = {},
): Omit<GpuSliceExprDto, "id" | "typeId" | "spanId"> {
  return {
    kind,
    bindingId: -1,
    functionId: -1,
    constructorId: -1,
    semanticId: "",
    operatorId: "",
    numberValue: 0,
    boolValue: false,
    index: -1,
    children: [],
    ...overrides,
  };
}

function isDecl(value: Decl | Expr): value is Decl {
  return value.kind.endsWith("Decl");
}

function required<K, V>(map: Map<K, V>, key: K, label: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

function requiredObject<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
