import type { Binding, Decl, Expr, Module } from "./ast.ts";
import type { BindingFacts } from "./binding_facts.ts";
import type {
  BindingId,
  CompilerIdAllocator,
  RecursionGroupId,
  RecursiveReferenceId,
} from "./ids.ts";
import type { ModuleGraph } from "./module_graph.ts";

export type RecursionMemberFact = {
  groupId: RecursionGroupId;
  path: string;
  binding: Binding;
  bindingId: BindingId;
  declaredIndex: number;
};

export type RecursionGroupFact = {
  id: RecursionGroupId;
  path: string;
  declaration: Extract<Decl, { kind: "LetDecl" }>;
  members: RecursionMemberFact[];
};

export type RecursiveReferenceFact = {
  id: RecursiveReferenceId;
  path: string;
  groupId: RecursionGroupId;
  targetBindingId: BindingId;
  callerBindingId?: BindingId;
  relation: "self" | "mutual" | "external";
  invocation: "call" | "pipe" | "value";
  expression: Extract<Expr, { kind: "Var" | "Call" | "Pipe" }>;
  reference: Extract<Expr, { kind: "Var" }>;
};

export type RecursionFacts = {
  groups: RecursionGroupFact[];
  references: RecursiveReferenceFact[];
  byDeclaration: ReadonlyMap<Extract<Decl, { kind: "LetDecl" }>, RecursionGroupFact>;
  byBinding: ReadonlyMap<Binding, RecursionMemberFact>;
  byBindingId: ReadonlyMap<BindingId, RecursionMemberFact>;
  byExpression: ReadonlyMap<Expr, RecursiveReferenceFact>;
};

type RecursionModuleInput = {
  path: string;
  module: Module;
  bindings: BindingFacts;
};

export function resolveProgramRecursionFacts(
  graph: ModuleGraph,
  bindings: Map<string, BindingFacts>,
  ids: CompilerIdAllocator,
): RecursionFacts {
  const inputs = graph.order.map((path) => ({
    path,
    module: graph.nodes.get(path)!.module,
    bindings: required(bindings, path),
  }));
  const state = new RecursionFactState(ids);
  inputs.forEach((input) => state.discoverModule(input));
  inputs.forEach((input) => state.visitModule(input));
  return state.finish();
}

class RecursionFactState {
  readonly groups: RecursionGroupFact[] = [];
  readonly references: RecursiveReferenceFact[] = [];
  readonly byDeclaration = new Map<Extract<Decl, { kind: "LetDecl" }>, RecursionGroupFact>();
  readonly byBinding = new Map<Binding, RecursionMemberFact>();
  readonly byBindingId = new Map<BindingId, RecursionMemberFact>();
  readonly byExpression = new Map<Expr, RecursiveReferenceFact>();

  constructor(readonly ids: CompilerIdAllocator) {}

  finish(): RecursionFacts {
    return {
      groups: this.groups,
      references: this.references,
      byDeclaration: this.byDeclaration,
      byBinding: this.byBinding,
      byBindingId: this.byBindingId,
      byExpression: this.byExpression,
    };
  }

  discoverModule(input: RecursionModuleInput): void {
    input.module.decls.forEach((declaration) => this.discoverDecl(declaration, input));
  }

  discoverDecl(declaration: Decl, input: RecursionModuleInput): void {
    if (declaration.kind !== "LetDecl") return;
    if (declaration.recursive) {
      const id = this.ids.recursionGroup();
      const members = declaration.bindings.map((binding, declaredIndex) => {
        if (binding.pattern.kind !== "PVar") {
          throw new Error(`${input.path}: recursive binding does not bind one name`);
        }
        const bindingId = input.bindings.binders.get(binding.pattern);
        if (bindingId === undefined) {
          throw new Error(`${input.path}: recursive binding is missing its BindingId`);
        }
        const member: RecursionMemberFact = {
          groupId: id,
          path: input.path,
          binding,
          bindingId,
          declaredIndex,
        };
        this.byBinding.set(binding, member);
        this.byBindingId.set(bindingId, member);
        return member;
      });
      const group: RecursionGroupFact = { id, path: input.path, declaration, members };
      this.groups.push(group);
      this.byDeclaration.set(declaration, group);
    }
    declaration.bindings.forEach((binding) => this.discoverExpr(binding.value, input));
  }

  discoverExpr(expression: Expr, input: RecursionModuleInput): void {
    visitExprDeclarations(expression, (declaration) => this.discoverDecl(declaration, input));
  }

  visitModule(input: RecursionModuleInput): void {
    input.module.decls.forEach((declaration) => this.visitDecl(declaration, input, undefined));
  }

  visitDecl(
    declaration: Decl,
    input: RecursionModuleInput,
    enclosingBindingId: BindingId | undefined,
  ): void {
    if (declaration.kind !== "LetDecl") return;
    declaration.bindings.forEach((binding) => {
      const bindingId = binding.pattern.kind === "PVar"
        ? input.bindings.binders.get(binding.pattern)
        : undefined;
      const callerBindingId = declaration.recursive || binding.value.kind === "Lambda" ||
          enclosingBindingId === undefined
        ? bindingId
        : enclosingBindingId;
      this.walkExpr(
        binding.value,
        input,
        callerBindingId,
        (nested) => this.visitDecl(nested, input, callerBindingId),
      );
    });
  }

  walkExpr(
    expression: Expr,
    input: RecursionModuleInput,
    callerBindingId: BindingId | undefined,
    visitNestedDeclaration: (declaration: Decl) => void,
  ): void {
    switch (expression.kind) {
      case "Var":
        this.addReference(expression, expression, "value", input, callerBindingId);
        return;
      case "Tuple":
      case "JsonArray":
        expression.items.forEach((item) =>
          this.walkExpr(item, input, callerBindingId, visitNestedDeclaration)
        );
        return;
      case "Record":
      case "JsonObject":
        expression.fields.forEach((field) =>
          this.walkExpr(field.value, input, callerBindingId, visitNestedDeclaration)
        );
        return;
      case "FfiGet":
        this.walkExpr(expression.receiver, input, callerBindingId, visitNestedDeclaration);
        return;
      case "FfiCall":
        this.walkExpr(expression.receiver, input, callerBindingId, visitNestedDeclaration);
        expression.args.forEach((argument) =>
          this.walkExpr(argument, input, callerBindingId, visitNestedDeclaration)
        );
        return;
      case "FfiBindingCall":
        expression.args.forEach((argument) =>
          this.walkExpr(argument, input, callerBindingId, visitNestedDeclaration)
        );
        return;
      case "Lambda":
        this.walkExpr(expression.body, input, callerBindingId, visitNestedDeclaration);
        return;
      case "Call":
        if (expression.callee.kind === "Var") {
          this.addReference(expression, expression.callee, "call", input, callerBindingId);
        } else {
          this.walkExpr(expression.callee, input, callerBindingId, visitNestedDeclaration);
        }
        expression.args.forEach((argument) =>
          this.walkExpr(argument, input, callerBindingId, visitNestedDeclaration)
        );
        return;
      case "If":
        this.walkExpr(expression.cond, input, callerBindingId, visitNestedDeclaration);
        this.walkExpr(expression.thenExpr, input, callerBindingId, visitNestedDeclaration);
        this.walkExpr(expression.elseExpr, input, callerBindingId, visitNestedDeclaration);
        return;
      case "Match":
        this.walkExpr(expression.value, input, callerBindingId, visitNestedDeclaration);
        expression.arms.forEach((arm) =>
          this.walkExpr(arm.body, input, callerBindingId, visitNestedDeclaration)
        );
        return;
      case "Panic":
        this.walkExpr(expression.message, input, callerBindingId, visitNestedDeclaration);
        return;
      case "Block":
        expression.items.forEach((item) =>
          isDecl(item)
            ? visitNestedDeclaration(item)
            : this.walkExpr(item, input, callerBindingId, visitNestedDeclaration)
        );
        this.walkExpr(expression.result, input, callerBindingId, visitNestedDeclaration);
        return;
      case "Binary":
        this.walkExpr(expression.left, input, callerBindingId, visitNestedDeclaration);
        this.walkExpr(expression.right, input, callerBindingId, visitNestedDeclaration);
        return;
      case "Unary":
        this.walkExpr(expression.value, input, callerBindingId, visitNestedDeclaration);
        return;
      case "Pipe": {
        this.walkExpr(expression.left, input, callerBindingId, visitNestedDeclaration);
        const callee = pipeCallee(expression.right);
        if (callee) {
          this.addReference(expression, callee, "pipe", input, callerBindingId);
          if (expression.right.kind === "Call") {
            expression.right.args.forEach((argument) =>
              this.walkExpr(argument, input, callerBindingId, visitNestedDeclaration)
            );
          }
        } else {
          this.walkExpr(expression.right, input, callerBindingId, visitNestedDeclaration);
        }
        return;
      }
      default:
        return;
    }
  }

  addReference(
    expression: Extract<Expr, { kind: "Var" | "Call" | "Pipe" }>,
    reference: Extract<Expr, { kind: "Var" }>,
    invocation: RecursiveReferenceFact["invocation"],
    input: RecursionModuleInput,
    callerBindingId: BindingId | undefined,
  ): void {
    const targetBindingId = input.bindings.references.get(reference);
    if (targetBindingId === undefined) return;
    const target = this.byBindingId.get(targetBindingId);
    if (!target) return;
    const caller = callerBindingId === undefined
      ? undefined
      : this.byBindingId.get(callerBindingId);
    const relation = callerBindingId === targetBindingId
      ? "self"
      : caller?.groupId === target.groupId
      ? "mutual"
      : "external";
    const fact: RecursiveReferenceFact = {
      id: this.ids.recursiveReference(),
      path: input.path,
      groupId: target.groupId,
      targetBindingId,
      callerBindingId,
      relation,
      invocation,
      expression,
      reference,
    };
    this.references.push(fact);
    this.byExpression.set(expression, fact);
  }
}

function pipeCallee(expression: Expr): Extract<Expr, { kind: "Var" }> | undefined {
  if (expression.kind === "Var") return expression;
  return expression.kind === "Call" && expression.callee.kind === "Var"
    ? expression.callee
    : undefined;
}

function isDecl(value: Decl | Expr): value is Decl {
  return value.kind.endsWith("Decl");
}

function visitExprDeclarations(expression: Expr, visit: (declaration: Decl) => void): void {
  switch (expression.kind) {
    case "Tuple":
    case "JsonArray":
      expression.items.forEach((item) => visitExprDeclarations(item, visit));
      return;
    case "Record":
    case "JsonObject":
      expression.fields.forEach((field) => visitExprDeclarations(field.value, visit));
      return;
    case "FfiGet":
      visitExprDeclarations(expression.receiver, visit);
      return;
    case "FfiCall":
      visitExprDeclarations(expression.receiver, visit);
      expression.args.forEach((argument) => visitExprDeclarations(argument, visit));
      return;
    case "FfiBindingCall":
      expression.args.forEach((argument) => visitExprDeclarations(argument, visit));
      return;
    case "Lambda":
      visitExprDeclarations(expression.body, visit);
      return;
    case "Call":
      visitExprDeclarations(expression.callee, visit);
      expression.args.forEach((argument) => visitExprDeclarations(argument, visit));
      return;
    case "If":
      visitExprDeclarations(expression.cond, visit);
      visitExprDeclarations(expression.thenExpr, visit);
      visitExprDeclarations(expression.elseExpr, visit);
      return;
    case "Match":
      visitExprDeclarations(expression.value, visit);
      expression.arms.forEach((arm) => visitExprDeclarations(arm.body, visit));
      return;
    case "Panic":
      visitExprDeclarations(expression.message, visit);
      return;
    case "Block":
      expression.items.forEach((item) =>
        isDecl(item) ? visit(item) : visitExprDeclarations(item, visit)
      );
      visitExprDeclarations(expression.result, visit);
      return;
    case "Binary":
    case "Pipe":
      visitExprDeclarations(expression.left, visit);
      visitExprDeclarations(expression.right, visit);
      return;
    case "Unary":
      visitExprDeclarations(expression.value, visit);
      return;
    default:
      return;
  }
}

function required<T>(map: Map<string, T>, path: string): T {
  const value = map.get(path);
  if (!value) throw new Error(`missing binding facts for ${path}`);
  return value;
}
