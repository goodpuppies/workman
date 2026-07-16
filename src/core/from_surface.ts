import type {
  Binding,
  CtorDecl,
  Decl,
  Expr,
  JsonObjectField,
  Located,
  MatchArm,
  Module,
  Param,
  Pattern,
  RecordExprItem,
  RecordFieldDecl,
  RecordPatternField,
} from "../ast.ts";
import type { InferResult } from "../infer.ts";
import { type BindingFacts, resolveModuleBindingFacts } from "../binding_facts.ts";
import { gpuOnlyBindingIds } from "../gpu_host_boundary.ts";
import { resolveGpuFragmentSelections } from "../gpu_selection.ts";
import { type CompilerSemanticId, GPU_SEMANTIC_IDS } from "../compiler_semantics.ts";
import { type NominalFacts, resolveModuleNominalFacts } from "../nominal_facts.ts";
import { type BindingId, CompilerIdAllocator, type TypeNameId } from "../ids.ts";
import type { MaterializedGpuArtifacts } from "../gpu_artifact.ts";
import { prune, type Ty, type TypeEnv } from "../types.ts";
import type {
  CoreBinding,
  CoreCtorDecl,
  CoreDecl,
  CoreExpr,
  CoreJsonObjectField,
  CoreMatchArm,
  CoreModule,
  CorePattern,
  CoreRecordExprItem,
  CoreRecordFieldDecl,
  CoreRecordPatternField,
} from "./ast.ts";

type CoreLoweringContext = {
  types: Map<Expr, Ty>;
  typeEnv: TypeEnv;
  bindings?: BindingFacts;
  ids?: CompilerIdAllocator;
  gpuOnlyBindings: ReadonlySet<BindingId>;
  gpuOnlyTypeNames: ReadonlySet<TypeNameId>;
  selectedFragmentCalls: ReadonlySet<Extract<Expr, { kind: "Call" }>>;
  materializedGpuArtifacts: MaterializedGpuArtifacts;
  gpuSemanticIds: ReadonlyMap<Expr, CompilerSemanticId>;
  nominalFacts?: NominalFacts;
};

export type CoreGpuHostBoundary = {
  gpuOnlyBindings: ReadonlySet<BindingId>;
  gpuOnlyTypeNames?: ReadonlySet<TypeNameId>;
  selectedFragmentCalls?: ReadonlySet<Extract<Expr, { kind: "Call" }>>;
  materializedGpuArtifacts?: MaterializedGpuArtifacts;
  nominalFacts?: NominalFacts;
};

export function coreFromSurface(
  module: Module,
  analysis?: InferResult,
  bindings?: BindingFacts,
  ids?: CompilerIdAllocator,
  gpuBoundary?: CoreGpuHostBoundary,
): CoreModule {
  let resolvedBindings = bindings;
  let resolvedIds = ids;
  let resolvedBoundary = gpuBoundary;
  if (!resolvedBoundary && moduleContainsGpuLambda(module)) {
    resolvedIds ??= new CompilerIdAllocator();
    resolvedBindings ??= resolveModuleBindingFacts(module, resolvedIds);
    resolvedBoundary = {
      gpuOnlyBindings: gpuOnlyBindingIds([{ module, bindings: resolvedBindings }]),
      selectedFragmentCalls: analysis
        ? resolveGpuFragmentSelections([{
          path: "<source>",
          module,
          result: analysis,
          bindings: resolvedBindings,
        }]).selectedCalls
        : undefined,
    };
  }
  let resolvedNominalFacts = resolvedBoundary?.nominalFacts;
  if (!resolvedNominalFacts && analysis) {
    resolvedIds ??= new CompilerIdAllocator();
    resolvedNominalFacts = resolveModuleNominalFacts(module, analysis, resolvedIds);
  }
  const context = analysis || resolvedBindings || resolvedBoundary || resolvedNominalFacts
    ? {
      types: analysis?.types ?? new Map<Expr, Ty>(),
      typeEnv: analysis?.typeEnv ?? new Map(),
      bindings: resolvedBindings,
      ids: resolvedIds,
      gpuOnlyBindings: resolvedBoundary?.gpuOnlyBindings ?? new Set<BindingId>(),
      gpuOnlyTypeNames: resolvedBoundary?.gpuOnlyTypeNames ?? new Set<TypeNameId>(),
      selectedFragmentCalls: resolvedBoundary?.selectedFragmentCalls ??
        new Set<Extract<Expr, { kind: "Call" }>>(),
      materializedGpuArtifacts: resolvedBoundary?.materializedGpuArtifacts ?? new Map(),
      gpuSemanticIds: new Map(
        [...(analysis?.facts.expressions ?? [])].flatMap(([expr, fact]) =>
          fact.origin?.semanticId ? [[expr, fact.origin.semanticId] as const] : []
        ),
      ),
      nominalFacts: resolvedNominalFacts,
    }
    : undefined;
  return {
    kind: "CoreModule",
    decls: module.decls.flatMap((decl) => {
      const lowered = coreDeclFromSurface(decl, context);
      return lowered ? [lowered] : [];
    }),
    node: module.node,
  };
}

function coreDeclFromSurface(
  decl: Decl,
  context?: CoreLoweringContext,
): CoreDecl | undefined {
  switch (decl.kind) {
    case "ImportDecl":
      return { kind: "CoreImport", path: decl.path, node: decl.node };
    case "ForeignTypeDecl":
      return {
        kind: "CoreType",
        exported: false,
        name: decl.name,
        params: [],
        ctors: [],
        node: decl.node,
      };
    case "JsImportDecl":
      return {
        kind: "CoreJsImport",
        clause: decl.clause,
        target: decl.target,
        node: decl.node,
      };
    case "LetDecl": {
      const bindings = decl.bindings
        .filter((binding) => !isGpuOnlyBinding(binding, context))
        .map((binding) => coreBindingFromSurface(binding, context));
      if (bindings.length === 0) return undefined;
      return {
        kind: "CoreLet",
        exported: decl.exported,
        recursive: decl.recursive,
        bindings,
        node: decl.node,
      };
    }
    case "TypeDecl":
      if (
        context?.gpuOnlyTypeNames.has(
          context.nominalFacts?.typeDeclarations.get(decl) as TypeNameId,
        )
      ) return undefined;
      return {
        kind: "CoreType",
        exported: decl.exported,
        name: decl.name,
        typeNameId: context?.nominalFacts?.typeDeclarations.get(decl),
        params: decl.params,
        ctors: decl.ctors.map((ctor) => coreCtorDeclFromSurface(ctor, context)),
        alias: decl.alias,
        node: decl.node,
      };
    case "RecordDecl":
      return {
        kind: "CoreRecord",
        exported: decl.exported,
        name: decl.name,
        typeNameId: context?.nominalFacts?.typeDeclarations.get(decl),
        recordId: context?.nominalFacts?.recordDeclarations.get(decl),
        params: decl.params,
        fields: decl.fields.map(coreRecordFieldDeclFromSurface),
        node: decl.node,
      };
  }
}

function coreBindingFromSurface(binding: Binding, context?: CoreLoweringContext): CoreBinding {
  return {
    pattern: corePatternFromSurface(binding.pattern, context),
    annotation: binding.annotation,
    value: coreExprFromSurface(binding.value, context),
    node: binding.node,
  };
}

function coreCtorDeclFromSurface(
  decl: CtorDecl,
  context?: CoreLoweringContext,
): CoreCtorDecl {
  return {
    id: context?.nominalFacts?.constructorDeclarations.get(decl),
    name: decl.name,
    payload: coreCtorPayload(decl.args, decl.node),
    node: decl.node,
  };
}

function coreRecordFieldDeclFromSurface(decl: RecordFieldDecl): CoreRecordFieldDecl {
  return { name: decl.name, type: decl.type, node: decl.node };
}

function coreExprFromSurface(expr: Expr, context?: CoreLoweringContext): CoreExpr {
  switch (expr.kind) {
    case "Int":
      return { kind: "CoreInt", value: expr.value, node: expr.node };
    case "Float":
      return { kind: "CoreFloat", value: expr.value, node: expr.node };
    case "String":
      return { kind: "CoreString", value: expr.value, node: expr.node };
    case "Bool":
      return { kind: "CoreBool", value: expr.value, node: expr.node };
    case "Void":
      return { kind: "CoreVoid", node: expr.node };
    case "Var": {
      const semanticId = context?.gpuSemanticIds.get(expr);
      if (semanticId) {
        if (
          semanticId === GPU_SEMANTIC_IDS.wgsl ||
          semanticId === GPU_SEMANTIC_IDS.vertexEntryPoint ||
          semanticId === GPU_SEMANTIC_IDS.fragmentEntryPoint
        ) return { kind: "CoreVar", name: expr.name, node: expr.node };
        throw new Error(
          `compiler-owned GPU operation ${semanticId} reached host Core lowering before materialization`,
        );
      }
      const ctorId = context?.nominalFacts?.constructorReferences.get(expr);
      if (ctorId !== undefined) {
        return { kind: "CoreVar", name: expr.name, ctorId, node: expr.node };
      }
      const id = context?.bindings?.references.get(expr);
      if (id !== undefined && context?.gpuOnlyBindings.has(id)) {
        throw new Error(
          "GPU-only function reference reached host Core lowering before artifact materialization",
        );
      }
      return desugarDottedVar(
        expr.name,
        expr.node,
        id !== undefined && context?.bindings?.local.has(id) ? id : undefined,
      );
    }
    case "Tuple":
      return {
        kind: "CoreTuple",
        items: expr.items.map((item) => coreExprFromSurface(item, context)),
        node: expr.node,
      };
    case "Record":
      return {
        kind: "CoreRecord",
        fields: expr.fields.map((field) => coreRecordExprItemFromSurface(field, context)),
        node: expr.node,
      };
    case "JsonObject":
      return {
        kind: "CoreJsonObject",
        fields: expr.fields.map((field) => coreJsonObjectFieldFromSurface(field, context)),
        node: expr.node,
      };
    case "JsonArray":
      return {
        kind: "CoreJsonArray",
        items: expr.items.map((item) => coreExprFromSurface(item, context)),
        node: expr.node,
      };
    case "FfiGet":
      throw new Error("unresolved FFI projection reached Core elaboration");
    case "FfiCall":
      throw new Error("unresolved FFI call reached Core elaboration");
    case "FfiBindingCall":
      throw new Error("unresolved FFI binding call reached Core elaboration");
    case "Lambda":
      if (expr.directives.some((directive) => directive.name === "gpu")) {
        throw new Error(
          "GPU-only lambda reached host Core lowering before artifact materialization",
        );
      }
      return {
        kind: "CoreFn",
        arms: [{
          pattern: coreLambdaParam(expr.params, context),
          body: coreExprFromSurface(expr.body, context),
          node: expr.node,
        }],
        node: expr.node,
      };
    case "Call":
      if (context?.selectedFragmentCalls.has(expr)) {
        const artifact = context.materializedGpuArtifacts.get(expr);
        if (artifact) {
          return { kind: "CoreShaderRef", artifactId: artifact.id, node: expr.node };
        }
        throw new Error(
          "selected GPU fragment reached host Core lowering before artifact materialization",
        );
      }
      return {
        kind: "CoreApp",
        callee: coreExprFromSurface(expr.callee, context),
        arg: coreCallArg(expr.args, expr.node, context),
        node: expr.node,
      };
    case "If":
      return {
        kind: "CoreIf",
        cond: coreExprFromSurface(expr.cond, context),
        thenExpr: coreExprFromSurface(expr.thenExpr, context),
        elseExpr: coreExprFromSurface(expr.elseExpr, context),
        node: expr.node,
      };
    case "Match":
      return {
        kind: "CoreMatch",
        value: coreExprFromSurface(expr.value, context),
        arms: expr.arms.map((arm) => coreMatchArmFromSurface(arm, context)),
        node: expr.node,
      };
    case "Panic":
      return {
        kind: "CorePanic",
        message: coreExprFromSurface(expr.message, context),
        node: expr.node,
      };
    case "Block":
      if (expr.items.length === 0) return coreExprFromSurface(expr.result, context);
      {
        const items: (CoreDecl | CoreExpr)[] = [];
        for (const item of expr.items) {
          if (!isDecl(item)) {
            items.push(coreExprFromSurface(item, context));
            continue;
          }
          const lowered = coreDeclFromSurface(item, context);
          if (lowered) items.push(lowered);
        }
        if (items.length === 0) return coreExprFromSurface(expr.result, context);
        return {
          kind: "CoreBlock",
          items,
          result: coreExprFromSurface(expr.result, context),
          node: expr.node,
        };
      }
    case "Binary":
      if (
        context && isResultCarrier(context.types.get(expr.left), context.typeEnv) ||
        context && isResultCarrier(context.types.get(expr.right), context.typeEnv)
      ) {
        return resultLiftedBinary(expr, context);
      }
      return {
        kind: "CoreApp",
        callee: { kind: "CoreVar", name: expr.op, node: expr.node },
        arg: {
          kind: "CoreTuple",
          items: [
            coreExprFromSurface(expr.left, context),
            coreExprFromSurface(expr.right, context),
          ],
          node: expr.node,
        },
        node: expr.node,
      };
    case "Unary":
      if (context && isResultCarrier(context.types.get(expr.value), context.typeEnv)) {
        return resultLiftedUnary(expr, context);
      }
      return {
        kind: "CoreApp",
        callee: { kind: "CoreVar", name: expr.op, node: expr.node },
        arg: coreExprFromSurface(expr.value, context),
        node: expr.node,
      };
    case "Pipe":
      return desugarPipe(expr, context);
  }
}

function coreLambdaParam(params: Param[], context?: CoreLoweringContext): CorePattern {
  if (params.length === 0) return { kind: "CorePVoid" };
  if (params.length === 1) return corePatternFromSurface(params[0].pattern, context);
  return {
    kind: "CorePTuple",
    items: params.map((param) => corePatternFromSurface(param.pattern, context)),
  };
}

function coreCallArg(args: Expr[], node: Expr["node"], context?: CoreLoweringContext): CoreExpr {
  if (args.length === 0) return { kind: "CoreVoid", node };
  if (args.length === 1) return coreExprFromSurface(args[0], context);
  return { kind: "CoreTuple", items: args.map((arg) => coreExprFromSurface(arg, context)), node };
}

function coreRecordExprItemFromSurface(
  field: RecordExprItem,
  context?: CoreLoweringContext,
): CoreRecordExprItem {
  if (field.kind === "Spread") {
    return {
      kind: "CoreRecordSpread",
      value: coreExprFromSurface(field.value, context),
      node: field.node,
    };
  }
  return {
    kind: "CoreRecordField",
    name: field.name,
    value: coreExprFromSurface(field.value, context),
    node: field.node,
  };
}

function coreJsonObjectFieldFromSurface(
  field: JsonObjectField,
  context?: CoreLoweringContext,
): CoreJsonObjectField {
  return { key: field.key, value: coreExprFromSurface(field.value, context), node: field.node };
}

function coreMatchArmFromSurface(arm: MatchArm, context?: CoreLoweringContext): CoreMatchArm {
  return {
    pattern: corePatternFromSurface(arm.pattern, context),
    body: coreExprFromSurface(arm.body, context),
    node: arm.node,
  };
}

function corePatternFromSurface(
  pattern: Pattern,
  context?: CoreLoweringContext,
): CorePattern {
  switch (pattern.kind) {
    case "PWildcard":
      return { kind: "CorePWildcard", node: pattern.node };
    case "PVar":
      return {
        kind: "CorePVar",
        name: pattern.name,
        bindingId: context?.bindings?.binders.get(pattern),
        node: pattern.node,
      };
    case "PInt":
      return { kind: "CorePInt", value: pattern.value, node: pattern.node };
    case "PString":
      return { kind: "CorePString", value: pattern.value, node: pattern.node };
    case "PBool":
      return { kind: "CorePBool", value: pattern.value, node: pattern.node };
    case "PVoid":
      return { kind: "CorePVoid", node: pattern.node };
    case "PPinned": {
      const id = context?.bindings?.references.get(pattern);
      if (id !== undefined && context?.gpuOnlyBindings.has(id)) {
        throw new Error(
          "GPU-only function reference reached host Core lowering before artifact materialization",
        );
      }
      return {
        kind: "CorePPinned",
        name: pattern.name,
        bindingId: id !== undefined && context?.bindings?.local.has(id) ? id : undefined,
        node: pattern.node,
      };
    }
    case "PTuple":
      return {
        kind: "CorePTuple",
        items: pattern.items.map((item) => corePatternFromSurface(item, context)),
        node: pattern.node,
      };
    case "PRecord":
      return {
        kind: "CorePRecord",
        fields: pattern.fields.map((field) => coreRecordPatternFieldFromSurface(field, context)),
        node: pattern.node,
      };
    case "PCtor":
      return {
        kind: "CorePCtor",
        name: pattern.name,
        ctorId: context?.nominalFacts?.constructorReferences.get(pattern),
        payload: coreCtorPatternPayload(pattern.args, pattern.node, context),
        node: pattern.node,
      };
  }
}

function isGpuOnlyBinding(binding: Binding, context?: CoreLoweringContext): boolean {
  if (binding.pattern.kind !== "PVar") return false;
  const id = context?.bindings?.binders.get(binding.pattern);
  return id !== undefined && context?.gpuOnlyBindings.has(id) === true;
}

function moduleContainsGpuLambda(module: Module): boolean {
  return module.decls.some(declContainsGpuLambda);
}

function declContainsGpuLambda(decl: Decl): boolean {
  return decl.kind === "LetDecl" &&
    decl.bindings.some((binding) => exprContainsGpuLambda(binding.value));
}

function exprContainsGpuLambda(expr: Expr): boolean {
  if (expr.kind === "Lambda") {
    return expr.directives.some((directive) => directive.name === "gpu") ||
      exprContainsGpuLambda(expr.body);
  }
  switch (expr.kind) {
    case "Tuple":
    case "JsonArray":
      return expr.items.some(exprContainsGpuLambda);
    case "Record":
    case "JsonObject":
      return expr.fields.some((field) => exprContainsGpuLambda(field.value));
    case "FfiGet":
      return exprContainsGpuLambda(expr.receiver);
    case "FfiCall":
      return exprContainsGpuLambda(expr.receiver) || expr.args.some(exprContainsGpuLambda);
    case "FfiBindingCall":
      return expr.args.some(exprContainsGpuLambda);
    case "Call":
      return exprContainsGpuLambda(expr.callee) || expr.args.some(exprContainsGpuLambda);
    case "If":
      return exprContainsGpuLambda(expr.cond) || exprContainsGpuLambda(expr.thenExpr) ||
        exprContainsGpuLambda(expr.elseExpr);
    case "Match":
      return exprContainsGpuLambda(expr.value) ||
        expr.arms.some((arm) => exprContainsGpuLambda(arm.body));
    case "Panic":
      return exprContainsGpuLambda(expr.message);
    case "Block":
      return expr.items.some((item) =>
        isDecl(item) ? declContainsGpuLambda(item) : exprContainsGpuLambda(item)
      ) || exprContainsGpuLambda(expr.result);
    case "Binary":
    case "Pipe":
      return exprContainsGpuLambda(expr.left) || exprContainsGpuLambda(expr.right);
    case "Unary":
      return exprContainsGpuLambda(expr.value);
    default:
      return false;
  }
}

function coreRecordPatternFieldFromSurface(
  field: RecordPatternField,
  context?: CoreLoweringContext,
): CoreRecordPatternField {
  return {
    name: field.name,
    pattern: corePatternFromSurface(field.pattern, context),
    node: field.node,
  };
}

function isDecl(value: Decl | Expr): value is Decl {
  return value.kind === "ImportDecl" || value.kind === "LetDecl" ||
    value.kind === "JsImportDecl" || value.kind === "TypeDecl" || value.kind === "RecordDecl" ||
    value.kind === "ForeignTypeDecl";
}

function coreCtorPayload(args: CtorDecl["args"], node: CtorDecl["node"]) {
  if (args.length === 0) return undefined;
  if (args.length === 1) return args[0];
  return { kind: "TTuple" as const, items: args, node };
}

function coreCtorPatternPayload(
  args: Pattern[],
  node: Pattern["node"],
  context?: CoreLoweringContext,
): CorePattern | undefined {
  if (args.length === 0) return undefined;
  if (args.length === 1) return corePatternFromSurface(args[0], context);
  return {
    kind: "CorePTuple",
    items: args.map((arg) => corePatternFromSurface(arg, context)),
    node,
  };
}

function desugarPipe(
  pipe: Located<{ kind: "Pipe"; left: Expr; right: Expr }>,
  context?: CoreLoweringContext,
): CoreExpr {
  const left = coreExprFromSurface(pipe.left, context);
  const right = pipe.right;

  if (right.kind === "Call") {
    // e.g., 10 :> add(5) -> add(10, 5)
    const callee = coreExprFromSurface(right.callee, context);
    const args = [pipe.left, ...right.args];
    return {
      kind: "CoreApp",
      callee,
      arg: coreCallArg(args, pipe.node, context),
      node: pipe.node,
    };
  } else if (right.kind === "Var") {
    // e.g., 42 :> double -> double(42)
    return {
      kind: "CoreApp",
      callee: coreExprFromSurface(right, context),
      arg: left,
      node: pipe.node,
    };
  } else {
    // For other cases, treat right as a function and call it with left
    return {
      kind: "CoreApp",
      callee: coreExprFromSurface(right, context),
      arg: left,
      node: pipe.node,
    };
  }
}

function resultLiftedBinary(
  expr: Extract<Expr, { kind: "Binary" }>,
  context: CoreLoweringContext,
): CoreExpr {
  return {
    kind: "CoreApp",
    callee: desugarDottedVar("Result.map2", expr.node),
    arg: {
      kind: "CoreTuple",
      items: [
        resultCarrierExpr(expr.left, context),
        resultCarrierExpr(expr.right, context),
        binaryOperatorFn(expr.op, expr.node, context),
      ],
      node: expr.node,
    },
    node: expr.node,
  };
}

function resultLiftedUnary(
  expr: Extract<Expr, { kind: "Unary" }>,
  context: CoreLoweringContext,
): CoreExpr {
  return {
    kind: "CoreApp",
    callee: desugarDottedVar("Result.map", expr.node),
    arg: {
      kind: "CoreTuple",
      items: [
        coreExprFromSurface(expr.value, context),
        unaryOperatorFn(expr.op, expr.node, context),
      ],
      node: expr.node,
    },
    node: expr.node,
  };
}

function resultCarrierExpr(expr: Expr, context: CoreLoweringContext): CoreExpr {
  const value = coreExprFromSurface(expr, context);
  if (isResultCarrier(context.types.get(expr), context.typeEnv)) return value;
  return {
    kind: "CoreApp",
    callee: { kind: "CoreVar", name: "Ok", node: expr.node },
    arg: value,
    node: expr.node,
  };
}

function binaryOperatorFn(
  op: string,
  node: Expr["node"],
  context: CoreLoweringContext,
): CoreExpr {
  const left = "__wm_left";
  const right = "__wm_right";
  const leftId = context.ids?.binding();
  const rightId = context.ids?.binding();
  return {
    kind: "CoreFn",
    arms: [{
      pattern: {
        kind: "CorePTuple",
        items: [
          { kind: "CorePVar", name: left, bindingId: leftId, node },
          { kind: "CorePVar", name: right, bindingId: rightId, node },
        ],
        node,
      },
      body: {
        kind: "CoreApp",
        callee: { kind: "CoreVar", name: op, node },
        arg: {
          kind: "CoreTuple",
          items: [
            { kind: "CoreVar", name: left, bindingId: leftId, node },
            { kind: "CoreVar", name: right, bindingId: rightId, node },
          ],
          node,
        },
        node,
      },
      node,
    }],
    node,
  };
}

function unaryOperatorFn(
  op: string,
  node: Expr["node"],
  context: CoreLoweringContext,
): CoreExpr {
  const value = "__wm_value";
  const valueId = context.ids?.binding();
  return {
    kind: "CoreFn",
    arms: [{
      pattern: { kind: "CorePVar", name: value, bindingId: valueId, node },
      body: {
        kind: "CoreApp",
        callee: { kind: "CoreVar", name: op, node },
        arg: { kind: "CoreVar", name: value, bindingId: valueId, node },
        node,
      },
      node,
    }],
    node,
  };
}

function isResultCarrier(type: Ty | undefined, typeEnv: TypeEnv): boolean {
  if (!type) return false;
  const resolved = prune(type);
  const result = typeEnv.get("Result");
  return !!result && resolved.tag === "named" && resolved.id === result.id;
}

function desugarDottedVar(
  name: string,
  node: Expr["node"],
  bindingId?: import("../ids.ts").BindingId,
): CoreExpr {
  const parts = name.split(".");
  if (parts.length === 1) {
    return { kind: "CoreVar", name, bindingId, node };
  }
  // Desugar r.bottomRight.x into (((r).bottomRight).x)
  let result: CoreExpr = { kind: "CoreVar", name: parts[0], bindingId, node };
  for (let i = 1; i < parts.length; i++) {
    result = { kind: "CoreRecordAccess", record: result, field: parts[i], node };
  }
  return result;
}
