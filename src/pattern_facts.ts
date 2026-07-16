import type { Binding, Decl, Expr, MatchArm, Module, Param, Pattern } from "./ast.ts";
import type { BindingFacts } from "./binding_facts.ts";
import type { InferResult } from "./infer.ts";
import type {
  BindingId,
  CompilerIdAllocator,
  CtorId,
  LetId,
  MatchArmId,
  ParamId,
  PatternId,
  RecordId,
} from "./ids.ts";
import type { ModuleGraph } from "./module_graph.ts";
import type { NominalFacts } from "./nominal_facts.ts";
import { prune, type Ty, type TypeInfo } from "./types.ts";

export type PatternContext = "match" | "let" | "parameter";

export type ResolvedPatternKind =
  | "wildcard"
  | "binding"
  | "i32"
  | "string"
  | "bool"
  | "void"
  | "pinned"
  | "tuple"
  | "record"
  | "constructor";

export type ResolvedPatternFact = {
  id: PatternId;
  path: string;
  pattern: Pattern;
  context: PatternContext;
  kind: ResolvedPatternKind;
  type: Ty;
  children: PatternId[];
  bindingId?: BindingId;
  pinnedBindingId?: BindingId;
  constructorId?: CtorId;
  recordId?: RecordId;
  recordInferenceTypeId?: number;
  fieldIndices?: number[];
  literal?: number | string | boolean;
};

export type ResolvedParamFact = {
  id: ParamId;
  path: string;
  lambda: Extract<Expr, { kind: "Lambda" }>;
  param: Param;
  patternId: PatternId;
  type: Ty;
  declaredIndex: number;
};

export type ResolvedLetFact = {
  id: LetId;
  path: string;
  declaration: Extract<Decl, { kind: "LetDecl" }>;
  binding: Binding;
  patternId: PatternId;
  value: Expr;
  recursive: boolean;
  declaredIndex: number;
};

export type ResolvedMatchArmFact = {
  id: MatchArmId;
  path: string;
  match: Extract<Expr, { kind: "Match" }>;
  arm: MatchArm;
  patternId: PatternId;
  body: Expr;
  declaredIndex: number;
};

export type ResolvedPatternFacts = {
  patterns: ResolvedPatternFact[];
  params: ResolvedParamFact[];
  lets: ResolvedLetFact[];
  matchArms: ResolvedMatchArmFact[];
  byPattern: ReadonlyMap<Pattern, ResolvedPatternFact>;
  byParam: ReadonlyMap<Param, ResolvedParamFact>;
  byBinding: ReadonlyMap<Binding, ResolvedLetFact>;
  byMatchArm: ReadonlyMap<MatchArm, ResolvedMatchArmFact>;
};

type PatternModuleInput = {
  path: string;
  module: Module;
  result: InferResult;
  bindings: BindingFacts;
};

export function resolveProgramPatternFacts(
  graph: ModuleGraph,
  results: Map<string, InferResult>,
  bindings: Map<string, BindingFacts>,
  nominalFacts: NominalFacts,
  ids: CompilerIdAllocator,
): ResolvedPatternFacts {
  return resolvePatternFacts(
    graph.order.map((path) => ({
      path,
      module: graph.nodes.get(path)!.module,
      result: required(results, path, "inference result"),
      bindings: required(bindings, path, "binding facts"),
    })),
    nominalFacts,
    ids,
  );
}

function resolvePatternFacts(
  inputs: PatternModuleInput[],
  nominalFacts: NominalFacts,
  ids: CompilerIdAllocator,
): ResolvedPatternFacts {
  const state = new PatternFactState(nominalFacts, ids);
  for (const input of inputs) state.visitModule(input);
  return state.finish();
}

class PatternFactState {
  readonly patterns: ResolvedPatternFact[] = [];
  readonly params: ResolvedParamFact[] = [];
  readonly lets: ResolvedLetFact[] = [];
  readonly matchArms: ResolvedMatchArmFact[] = [];
  readonly byPattern = new Map<Pattern, ResolvedPatternFact>();
  readonly byParam = new Map<Param, ResolvedParamFact>();
  readonly byBinding = new Map<Binding, ResolvedLetFact>();
  readonly byMatchArm = new Map<MatchArm, ResolvedMatchArmFact>();

  constructor(
    readonly nominalFacts: NominalFacts,
    readonly ids: CompilerIdAllocator,
  ) {}

  finish(): ResolvedPatternFacts {
    return {
      patterns: this.patterns,
      params: this.params,
      lets: this.lets,
      matchArms: this.matchArms,
      byPattern: this.byPattern,
      byParam: this.byParam,
      byBinding: this.byBinding,
      byMatchArm: this.byMatchArm,
    };
  }

  visitModule(input: PatternModuleInput): void {
    input.module.decls.forEach((declaration) => this.visitDecl(declaration, input));
  }

  visitDecl(declaration: Decl, input: PatternModuleInput): void {
    if (declaration.kind !== "LetDecl") return;
    declaration.bindings.forEach((binding, declaredIndex) => {
      const pattern = this.addPattern(binding.pattern, "let", input);
      const fact: ResolvedLetFact = {
        id: this.ids.let(),
        path: input.path,
        declaration,
        binding,
        patternId: pattern.id,
        value: binding.value,
        recursive: declaration.recursive,
        declaredIndex,
      };
      this.lets.push(fact);
      this.byBinding.set(binding, fact);
      this.visitExpr(binding.value, input);
    });
  }

  visitExpr(expression: Expr, input: PatternModuleInput): void {
    switch (expression.kind) {
      case "Tuple":
      case "JsonArray":
        expression.items.forEach((item) => this.visitExpr(item, input));
        return;
      case "Record":
      case "JsonObject":
        expression.fields.forEach((field) => this.visitExpr(field.value, input));
        return;
      case "FfiGet":
        this.visitExpr(expression.receiver, input);
        return;
      case "FfiCall":
        this.visitExpr(expression.receiver, input);
        expression.args.forEach((argument) => this.visitExpr(argument, input));
        return;
      case "FfiBindingCall":
        expression.args.forEach((argument) => this.visitExpr(argument, input));
        return;
      case "Lambda":
        expression.params.forEach((param, declaredIndex) => {
          const pattern = this.addPattern(param.pattern, "parameter", input);
          const fact: ResolvedParamFact = {
            id: this.ids.param(),
            path: input.path,
            lambda: expression,
            param,
            patternId: pattern.id,
            type: pattern.type,
            declaredIndex,
          };
          this.params.push(fact);
          this.byParam.set(param, fact);
        });
        this.visitExpr(expression.body, input);
        return;
      case "Call":
        this.visitExpr(expression.callee, input);
        expression.args.forEach((argument) => this.visitExpr(argument, input));
        return;
      case "If":
        this.visitExpr(expression.cond, input);
        this.visitExpr(expression.thenExpr, input);
        this.visitExpr(expression.elseExpr, input);
        return;
      case "Match":
        this.visitExpr(expression.value, input);
        expression.arms.forEach((arm, declaredIndex) => {
          const pattern = this.addPattern(arm.pattern, "match", input);
          const fact: ResolvedMatchArmFact = {
            id: this.ids.matchArm(),
            path: input.path,
            match: expression,
            arm,
            patternId: pattern.id,
            body: arm.body,
            declaredIndex,
          };
          this.matchArms.push(fact);
          this.byMatchArm.set(arm, fact);
          this.visitExpr(arm.body, input);
        });
        return;
      case "Panic":
        this.visitExpr(expression.message, input);
        return;
      case "Block":
        expression.items.forEach((item) =>
          isDecl(item) ? this.visitDecl(item, input) : this.visitExpr(item, input)
        );
        this.visitExpr(expression.result, input);
        return;
      case "Binary":
      case "Pipe":
        this.visitExpr(expression.left, input);
        this.visitExpr(expression.right, input);
        return;
      case "Unary":
        this.visitExpr(expression.value, input);
        return;
      default:
        return;
    }
  }

  addPattern(
    pattern: Pattern,
    context: PatternContext,
    input: PatternModuleInput,
  ): ResolvedPatternFact {
    const existing = this.byPattern.get(pattern);
    if (existing) {
      if (existing.context !== context) {
        throw new Error(`pattern identity appears in both ${existing.context} and ${context}`);
      }
      return existing;
    }
    const type = input.result.facts.patternTypes.get(pattern);
    if (!type) throw invariant(input.path, pattern, "missing inferred pattern type");
    const id = this.ids.pattern();
    const index = this.patterns.length;
    this.patterns.push(undefined as unknown as ResolvedPatternFact);
    const base = {
      id,
      path: input.path,
      pattern,
      context,
      type,
    };
    let fact: ResolvedPatternFact;
    switch (pattern.kind) {
      case "PWildcard":
        fact = { ...base, kind: "wildcard", children: [] };
        break;
      case "PVar": {
        const bindingId = input.bindings.binders.get(pattern);
        if (bindingId === undefined) throw invariant(input.path, pattern, "missing binding ID");
        fact = { ...base, kind: "binding", bindingId, children: [] };
        break;
      }
      case "PInt":
        fact = { ...base, kind: "i32", literal: pattern.value, children: [] };
        break;
      case "PString":
        fact = { ...base, kind: "string", literal: pattern.value, children: [] };
        break;
      case "PBool":
        fact = { ...base, kind: "bool", literal: pattern.value, children: [] };
        break;
      case "PVoid":
        fact = { ...base, kind: "void", children: [] };
        break;
      case "PPinned": {
        const pinnedBindingId = input.bindings.references.get(pattern);
        if (pinnedBindingId === undefined) {
          throw invariant(input.path, pattern, "missing pinned binding ID");
        }
        fact = { ...base, kind: "pinned", pinnedBindingId, children: [] };
        break;
      }
      case "PTuple":
        fact = {
          ...base,
          kind: "tuple",
          children: pattern.items.map((child) => this.addPattern(child, context, input).id),
        };
        break;
      case "PRecord": {
        const record = this.recordFor(type, input, pattern);
        fact = {
          ...base,
          kind: "record",
          recordId: record.recordId,
          recordInferenceTypeId: record.info.id,
          fieldIndices: pattern.fields.map((field) => {
            const declaredIndex = record.info.recordFields!.findIndex((item) =>
              item.name === field.name
            );
            if (declaredIndex < 0) {
              throw invariant(input.path, pattern, `unknown resolved record field ${field.name}`);
            }
            return declaredIndex;
          }),
          children: pattern.fields.map((field) =>
            this.addPattern(field.pattern, context, input).id
          ),
        };
        break;
      }
      case "PCtor": {
        const constructorId = this.nominalFacts.constructorReferences.get(pattern);
        if (constructorId === undefined) {
          throw invariant(input.path, pattern, "missing constructor ID");
        }
        fact = {
          ...base,
          kind: "constructor",
          constructorId,
          children: pattern.args.map((child) => this.addPattern(child, context, input).id),
        };
        break;
      }
    }
    this.patterns[index] = fact;
    this.byPattern.set(pattern, fact);
    return fact;
  }

  recordFor(
    type: Ty,
    input: PatternModuleInput,
    pattern: Pattern,
  ): { info: TypeInfo; recordId?: RecordId } {
    const target = prune(type);
    if (target.tag !== "named") {
      throw invariant(input.path, pattern, "record pattern type is not named");
    }
    const info = [...input.result.typeEnv.values()].find((candidate) => candidate.id === target.id);
    if (!info?.recordFields) {
      throw invariant(input.path, pattern, "missing record field metadata");
    }
    const recordId = this.nominalFacts.recordTypeIds.get(target.id);
    return { info, recordId };
  }
}

function invariant(path: string, pattern: Pattern, message: string): Error {
  return new Error(`${path}: ${message} for ${pattern.kind}`);
}

function isDecl(value: Decl | Expr): value is Decl {
  return value.kind.endsWith("Decl");
}

function required<T>(map: Map<string, T>, path: string, kind: string): T {
  const value = map.get(path);
  if (!value) throw new Error(`missing ${kind} for ${path}`);
  return value;
}
