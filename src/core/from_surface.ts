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
};

export function coreFromSurface(module: Module, analysis?: InferResult): CoreModule {
  const context = analysis ? { types: analysis.types, typeEnv: analysis.typeEnv } : undefined;
  return {
    kind: "CoreModule",
    decls: module.decls.map((decl) => coreDeclFromSurface(decl, context)),
    node: module.node,
  };
}

function coreDeclFromSurface(decl: Decl, context?: CoreLoweringContext): CoreDecl {
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
    case "LetDecl":
      return {
        kind: "CoreLet",
        exported: decl.exported,
        recursive: decl.recursive,
        bindings: decl.bindings.map((binding) => coreBindingFromSurface(binding, context)),
        node: decl.node,
      };
    case "TypeDecl":
      return {
        kind: "CoreType",
        exported: decl.exported,
        name: decl.name,
        params: decl.params,
        ctors: decl.ctors.map(coreCtorDeclFromSurface),
        alias: decl.alias,
        node: decl.node,
      };
    case "RecordDecl":
      return {
        kind: "CoreRecord",
        exported: decl.exported,
        name: decl.name,
        params: decl.params,
        fields: decl.fields.map(coreRecordFieldDeclFromSurface),
        node: decl.node,
      };
  }
}

function coreBindingFromSurface(binding: Binding, context?: CoreLoweringContext): CoreBinding {
  return {
    pattern: corePatternFromSurface(binding.pattern),
    annotation: binding.annotation,
    value: coreExprFromSurface(binding.value, context),
    node: binding.node,
  };
}

function coreCtorDeclFromSurface(decl: CtorDecl): CoreCtorDecl {
  return { name: decl.name, payload: coreCtorPayload(decl.args, decl.node), node: decl.node };
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
    case "Var":
      return desugarDottedVar(expr.name, expr.node);
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
      return {
        kind: "CoreFn",
        arms: [{
          pattern: coreLambdaParam(expr.params),
          body: coreExprFromSurface(expr.body, context),
          node: expr.node,
        }],
        node: expr.node,
      };
    case "Call":
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
      return {
        kind: "CoreBlock",
        items: expr.items.map((item) =>
          isDecl(item) ? coreDeclFromSurface(item, context) : coreExprFromSurface(item, context)
        ),
        result: coreExprFromSurface(expr.result, context),
        node: expr.node,
      };
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

function coreLambdaParam(params: Param[]): CorePattern {
  if (params.length === 0) return { kind: "CorePVoid" };
  if (params.length === 1) return corePatternFromSurface(params[0].pattern);
  return {
    kind: "CorePTuple",
    items: params.map((param) => corePatternFromSurface(param.pattern)),
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
    pattern: corePatternFromSurface(arm.pattern),
    body: coreExprFromSurface(arm.body, context),
    node: arm.node,
  };
}

function corePatternFromSurface(pattern: Pattern): CorePattern {
  switch (pattern.kind) {
    case "PWildcard":
      return { kind: "CorePWildcard", node: pattern.node };
    case "PVar":
      return { kind: "CorePVar", name: pattern.name, node: pattern.node };
    case "PInt":
      return { kind: "CorePInt", value: pattern.value, node: pattern.node };
    case "PString":
      return { kind: "CorePString", value: pattern.value, node: pattern.node };
    case "PBool":
      return { kind: "CorePBool", value: pattern.value, node: pattern.node };
    case "PVoid":
      return { kind: "CorePVoid", node: pattern.node };
    case "PPinned":
      return { kind: "CorePPinned", name: pattern.name, node: pattern.node };
    case "PTuple":
      return {
        kind: "CorePTuple",
        items: pattern.items.map(corePatternFromSurface),
        node: pattern.node,
      };
    case "PRecord":
      return {
        kind: "CorePRecord",
        fields: pattern.fields.map(coreRecordPatternFieldFromSurface),
        node: pattern.node,
      };
    case "PCtor":
      return {
        kind: "CorePCtor",
        name: pattern.name,
        payload: coreCtorPatternPayload(pattern.args, pattern.node),
        node: pattern.node,
      };
  }
}

function coreRecordPatternFieldFromSurface(field: RecordPatternField): CoreRecordPatternField {
  return { name: field.name, pattern: corePatternFromSurface(field.pattern), node: field.node };
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

function coreCtorPatternPayload(args: Pattern[], node: Pattern["node"]): CorePattern | undefined {
  if (args.length === 0) return undefined;
  if (args.length === 1) return corePatternFromSurface(args[0]);
  return { kind: "CorePTuple", items: args.map(corePatternFromSurface), node };
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
      callee: { kind: "CoreVar", name: right.name, node: right.node },
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
        binaryOperatorFn(expr.op, expr.node),
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
        unaryOperatorFn(expr.op, expr.node),
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

function binaryOperatorFn(op: string, node: Expr["node"]): CoreExpr {
  const left = "__wm_left";
  const right = "__wm_right";
  return {
    kind: "CoreFn",
    arms: [{
      pattern: {
        kind: "CorePTuple",
        items: [
          { kind: "CorePVar", name: left, node },
          { kind: "CorePVar", name: right, node },
        ],
        node,
      },
      body: {
        kind: "CoreApp",
        callee: { kind: "CoreVar", name: op, node },
        arg: {
          kind: "CoreTuple",
          items: [
            { kind: "CoreVar", name: left, node },
            { kind: "CoreVar", name: right, node },
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

function unaryOperatorFn(op: string, node: Expr["node"]): CoreExpr {
  const value = "__wm_value";
  return {
    kind: "CoreFn",
    arms: [{
      pattern: { kind: "CorePVar", name: value, node },
      body: {
        kind: "CoreApp",
        callee: { kind: "CoreVar", name: op, node },
        arg: { kind: "CoreVar", name: value, node },
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

function desugarDottedVar(name: string, node: Expr["node"]): CoreExpr {
  const parts = name.split(".");
  if (parts.length === 1) {
    return { kind: "CoreVar", name, node };
  }
  // Desugar r.bottomRight.x into (((r).bottomRight).x)
  let result: CoreExpr = { kind: "CoreVar", name: parts[0], node };
  for (let i = 1; i < parts.length; i++) {
    result = { kind: "CoreRecordAccess", record: result, field: parts[i], node };
  }
  return result;
}
