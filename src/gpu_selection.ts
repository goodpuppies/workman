import type { Binding, Decl, Expr, Module, Param } from "./ast.ts";
import type { BindingFacts } from "./binding_facts.ts";
import { collectResolvedBindingSites, type ResolvedBindingSite } from "./binding_sites.ts";
import { GPU_SEMANTIC_IDS } from "./compiler_semantics.ts";
import { isGpuLambda } from "./directives.ts";
import type { InferResult } from "./infer.ts";
import type { BindingId, GpuRootId, GpuSelectorId } from "./ids.ts";

type LambdaExpr = Extract<Expr, { kind: "Lambda" }>;
type CallExpr = Extract<Expr, { kind: "Call" }>;

export type GpuSelectionModule = {
  path: string;
  module: Module;
  result: InferResult;
  bindings: BindingFacts;
};

export type GpuFragmentSelectorFact = {
  id: GpuSelectorId;
  rootId: GpuRootId;
  path: string;
  call: CallExpr;
  argument: Expr;
  environmentArgument?: Expr;
};

export type GpuShaderFactoryFact = {
  path: string;
  lambda: LambdaExpr;
  binding: Binding;
  bindingId: BindingId;
  parameter: Param;
};

export type GpuFragmentRootFact = {
  id: GpuRootId;
  path: string;
  lambda: LambdaExpr;
  binding?: Binding;
  bindingId?: BindingId;
  factory?: GpuShaderFactoryFact;
  selectors: GpuFragmentSelectorFact[];
};

export type GpuFragmentSelectionFacts = {
  roots: GpuFragmentRootFact[];
  selectors: GpuFragmentSelectorFact[];
  selectedCalls: ReadonlySet<CallExpr>;
  selectedLambdas: ReadonlySet<LambdaExpr>;
};

export class GpuFragmentSelectionError extends Error {
  constructor(
    readonly code:
      | "gpu.fragment.unresolved-root"
      | "gpu.fragment.not-marked"
      | "gpu.fragment.invalid-factory",
    readonly path: string,
    readonly expression: Expr,
    message: string,
  ) {
    super(message);
    this.name = "GpuFragmentSelectionError";
  }
}

/**
 * Resolves compiler-basis Gpu.fragment calls to authored lambda identities.
 *
 * The callee is recognized from inference's closed semantic ID. The argument is
 * resolved only through inline lambdas, PVar definitions, and finite Var alias
 * chains keyed by BindingId; source spelling and inferred function shape are not
 * accepted as identity evidence.
 */
export function resolveGpuFragmentSelections(
  modules: GpuSelectionModule[],
): GpuFragmentSelectionFacts {
  const sites = collectResolvedBindingSites(modules);
  const definitions = definitionSites(sites);
  const roots: GpuFragmentRootFact[] = [];
  const selectors: GpuFragmentSelectorFact[] = [];
  const rootsByLambda = new Map<LambdaExpr, GpuFragmentRootFact>();

  for (const input of modules) {
    visitModuleExpressions(input.module, (expr) => {
      if (!isFragmentCall(expr, input.result)) return;
      const argument = expr.args[0];
      if (!argument) {
        throw unresolved(input.path, expr, "Gpu.fragment requires one function value");
      }
      const factoryApplication = resolveShaderFactoryApplication(
        argument,
        input.bindings,
        definitions,
        input.path,
      );
      const resolved = factoryApplication?.inner ??
        resolveLambda(argument, input.bindings, definitions, new Set());
      if (!resolved) {
        throw unresolved(
          input.path,
          argument,
          "Gpu.fragment argument does not statically resolve to one lambda",
        );
      }
      if (!isGpuLambda(resolved.lambda)) {
        throw new GpuFragmentSelectionError(
          "gpu.fragment.not-marked",
          resolved.site?.path ?? input.path,
          resolved.lambda,
          "Gpu.fragment resolved function is not marked @gpu",
        );
      }

      let root = rootsByLambda.get(resolved.lambda);
      if (!root) {
        const bindingId = resolved.site && resolved.site.binding.pattern.kind === "PVar"
          ? resolved.site.bindings.binders.get(resolved.site.binding.pattern)
          : undefined;
        root = {
          id: roots.length as GpuRootId,
          path: resolved.site?.path ?? input.path,
          lambda: resolved.lambda,
          binding: resolved.site?.binding,
          bindingId,
          factory: factoryApplication?.factory,
          selectors: [],
        };
        roots.push(root);
        rootsByLambda.set(resolved.lambda, root);
      }
      const selector: GpuFragmentSelectorFact = {
        id: selectors.length as GpuSelectorId,
        rootId: root.id,
        path: input.path,
        call: expr,
        argument,
        environmentArgument: factoryApplication?.argument,
      };
      selectors.push(selector);
      root.selectors.push(selector);
    });
  }

  return {
    roots,
    selectors,
    selectedCalls: new Set(selectors.map((item) => item.call)),
    selectedLambdas: new Set(roots.map((item) => item.lambda)),
  };
}

function resolveShaderFactoryApplication(
  expression: Expr,
  references: BindingFacts,
  definitions: Map<BindingId, ResolvedBindingSite>,
  currentPath: string,
): {
  inner: { lambda: LambdaExpr; site?: ResolvedBindingSite };
  factory: GpuShaderFactoryFact;
  argument: Expr;
} | undefined {
  if (expression.kind !== "Call") return undefined;
  const resolved = resolveLambda(expression.callee, references, definitions, new Set());
  if (!resolved?.site) return undefined;
  const outer = resolved.lambda;
  const inner = exactReturnedLambda(outer.body);
  if (!inner) return undefined;
  const bindingId = resolved.site.binding.pattern.kind === "PVar"
    ? resolved.site.bindings.binders.get(resolved.site.binding.pattern)
    : undefined;
  if (
    bindingId === undefined || outer.directives.length !== 0 || outer.params.length !== 1 ||
    expression.args.length !== 1
  ) {
    throw new GpuFragmentSelectionError(
      "gpu.fragment.invalid-factory",
      resolved.site.path ?? currentPath,
      expression,
      "a shader factory requires one host parameter and must return exactly one @gpu lambda",
    );
  }
  return {
    inner: { lambda: inner, site: undefined },
    factory: {
      path: resolved.site.path ?? currentPath,
      lambda: outer,
      binding: resolved.site.binding,
      bindingId,
      parameter: outer.params[0],
    },
    argument: expression.args[0],
  };
}

function exactReturnedLambda(expression: Expr): LambdaExpr | undefined {
  if (expression.kind === "Lambda") return expression;
  if (
    expression.kind === "Block" && expression.items.length === 0 &&
    expression.result.kind === "Lambda"
  ) return expression.result;
  return undefined;
}

function definitionSites(sites: ResolvedBindingSite[]): Map<BindingId, ResolvedBindingSite> {
  const definitions = new Map<BindingId, ResolvedBindingSite>();
  for (const site of sites) {
    if (site.binding.pattern.kind !== "PVar") continue;
    const id = site.bindings.binders.get(site.binding.pattern);
    if (id !== undefined) definitions.set(id, site);
  }
  return definitions;
}

function resolveLambda(
  expression: Expr,
  references: BindingFacts,
  definitions: Map<BindingId, ResolvedBindingSite>,
  seen: Set<BindingId>,
): { lambda: LambdaExpr; site?: ResolvedBindingSite } | undefined {
  if (expression.kind === "Lambda") return { lambda: expression };
  if (expression.kind !== "Var") return undefined;
  const id = references.references.get(expression);
  if (id === undefined || seen.has(id)) return undefined;
  const site = definitions.get(id);
  if (!site) return undefined;
  seen.add(id);
  if (site.binding.value.kind === "Lambda") {
    return { lambda: site.binding.value, site };
  }
  if (site.recursive || site.binding.value.kind !== "Var") return undefined;
  const resolved = resolveLambda(site.binding.value, site.bindings, definitions, seen);
  return resolved;
}

function isFragmentCall(expression: Expr, result: InferResult): expression is CallExpr {
  return expression.kind === "Call" &&
    result.facts.expressions.get(expression.callee)?.origin?.semanticId ===
      GPU_SEMANTIC_IDS.fragment;
}

function unresolved(
  path: string,
  expression: Expr,
  message: string,
): GpuFragmentSelectionError {
  return new GpuFragmentSelectionError(
    "gpu.fragment.unresolved-root",
    path,
    expression,
    message,
  );
}

function visitModuleExpressions(module: Module, visit: (expression: Expr) => void): void {
  for (const decl of module.decls) visitDeclExpressions(decl, visit);
}

function visitDeclExpressions(decl: Decl, visit: (expression: Expr) => void): void {
  if (decl.kind !== "LetDecl") return;
  for (const binding of decl.bindings) visitExpr(binding.value, visit);
}

function visitExpr(expression: Expr, visit: (expression: Expr) => void): void {
  visit(expression);
  switch (expression.kind) {
    case "Tuple":
    case "JsonArray":
      expression.items.forEach((item) => visitExpr(item, visit));
      return;
    case "Record":
    case "JsonObject":
      expression.fields.forEach((field) => visitExpr(field.value, visit));
      return;
    case "FfiGet":
      visitExpr(expression.receiver, visit);
      return;
    case "FfiCall":
      visitExpr(expression.receiver, visit);
      expression.args.forEach((argument) => visitExpr(argument, visit));
      return;
    case "FfiBindingCall":
      expression.args.forEach((argument) => visitExpr(argument, visit));
      return;
    case "Lambda":
      visitExpr(expression.body, visit);
      return;
    case "Call":
      visitExpr(expression.callee, visit);
      expression.args.forEach((argument) => visitExpr(argument, visit));
      return;
    case "If":
      visitExpr(expression.cond, visit);
      visitExpr(expression.thenExpr, visit);
      visitExpr(expression.elseExpr, visit);
      return;
    case "Match":
      visitExpr(expression.value, visit);
      expression.arms.forEach((arm) => visitExpr(arm.body, visit));
      return;
    case "Panic":
      visitExpr(expression.message, visit);
      return;
    case "Block":
      expression.items.forEach((item) => {
        if (isDecl(item)) visitDeclExpressions(item, visit);
        else visitExpr(item, visit);
      });
      visitExpr(expression.result, visit);
      return;
    case "Binary":
    case "Pipe":
      visitExpr(expression.left, visit);
      visitExpr(expression.right, visit);
      return;
    case "Unary":
      visitExpr(expression.value, visit);
      return;
    default:
      return;
  }
}

function isDecl(value: Decl | Expr): value is Decl {
  return value.kind.endsWith("Decl");
}
