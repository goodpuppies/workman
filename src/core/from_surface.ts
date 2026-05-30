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
  RecordExprField,
  RecordFieldDecl,
  RecordPatternField,
} from "../ast.ts";
import type {
  CoreBinding,
  CoreCtorDecl,
  CoreDecl,
  CoreExpr,
  CoreJsonObjectField,
  CoreMatchArm,
  CoreModule,
  CorePattern,
  CoreRecordExprField,
  CoreRecordFieldDecl,
  CoreRecordPatternField,
} from "./ast.ts";

export function coreFromSurface(module: Module): CoreModule {
  return {
    kind: "CoreModule",
    decls: module.decls.map(coreDeclFromSurface),
    node: module.node,
  };
}

function coreDeclFromSurface(decl: Decl): CoreDecl {
  switch (decl.kind) {
    case "ImportDecl":
      return { kind: "CoreImport", path: decl.path, node: decl.node };
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
        bindings: decl.bindings.map(coreBindingFromSurface),
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

function coreBindingFromSurface(binding: Binding): CoreBinding {
  return {
    pattern: corePatternFromSurface(binding.pattern),
    annotation: binding.annotation,
    value: coreExprFromSurface(binding.value),
    node: binding.node,
  };
}

function coreCtorDeclFromSurface(decl: CtorDecl): CoreCtorDecl {
  return { name: decl.name, payload: coreCtorPayload(decl.args, decl.node), node: decl.node };
}

function coreRecordFieldDeclFromSurface(decl: RecordFieldDecl): CoreRecordFieldDecl {
  return { name: decl.name, type: decl.type, node: decl.node };
}

function coreExprFromSurface(expr: Expr): CoreExpr {
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
      return { kind: "CoreTuple", items: expr.items.map(coreExprFromSurface), node: expr.node };
    case "Record":
      return {
        kind: "CoreRecord",
        fields: expr.fields.map(coreRecordExprFieldFromSurface),
        node: expr.node,
      };
    case "JsonObject":
      return {
        kind: "CoreJsonObject",
        fields: expr.fields.map(coreJsonObjectFieldFromSurface),
        node: expr.node,
      };
    case "JsonArray":
      return {
        kind: "CoreJsonArray",
        items: expr.items.map(coreExprFromSurface),
        node: expr.node,
      };
    case "Lambda":
      return {
        kind: "CoreFn",
        arms: [{
          pattern: coreLambdaParam(expr.params),
          body: coreExprFromSurface(expr.body),
          node: expr.node,
        }],
        node: expr.node,
      };
    case "Call":
      return {
        kind: "CoreApp",
        callee: coreExprFromSurface(expr.callee),
        arg: coreCallArg(expr.args, expr.node),
        node: expr.node,
      };
    case "If":
      return {
        kind: "CoreIf",
        cond: coreExprFromSurface(expr.cond),
        thenExpr: coreExprFromSurface(expr.thenExpr),
        elseExpr: coreExprFromSurface(expr.elseExpr),
        node: expr.node,
      };
    case "Match":
      return {
        kind: "CoreMatch",
        value: coreExprFromSurface(expr.value),
        arms: expr.arms.map(coreMatchArmFromSurface),
        node: expr.node,
      };
    case "Panic":
      return {
        kind: "CorePanic",
        message: coreExprFromSurface(expr.message),
        node: expr.node,
      };
    case "Block":
      if (expr.items.length === 0) return coreExprFromSurface(expr.result);
      return {
        kind: "CoreBlock",
        items: expr.items.map((item) =>
          isDecl(item) ? coreDeclFromSurface(item) : coreExprFromSurface(item)
        ),
        result: coreExprFromSurface(expr.result),
        node: expr.node,
      };
    case "Binary":
      return {
        kind: "CoreApp",
        callee: { kind: "CoreVar", name: expr.op, node: expr.node },
        arg: {
          kind: "CoreTuple",
          items: [coreExprFromSurface(expr.left), coreExprFromSurface(expr.right)],
          node: expr.node,
        },
        node: expr.node,
      };
    case "Unary":
      return {
        kind: "CoreApp",
        callee: { kind: "CoreVar", name: expr.op, node: expr.node },
        arg: coreExprFromSurface(expr.value),
        node: expr.node,
      };
    case "Pipe":
      return desugarPipe(expr);
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

function coreCallArg(args: Expr[], node: Expr["node"]): CoreExpr {
  if (args.length === 0) return { kind: "CoreVoid", node };
  if (args.length === 1) return coreExprFromSurface(args[0]);
  return { kind: "CoreTuple", items: args.map(coreExprFromSurface), node };
}

function coreRecordExprFieldFromSurface(field: RecordExprField): CoreRecordExprField {
  return { name: field.name, value: coreExprFromSurface(field.value), node: field.node };
}

function coreJsonObjectFieldFromSurface(field: JsonObjectField): CoreJsonObjectField {
  return { key: field.key, value: coreExprFromSurface(field.value), node: field.node };
}

function coreMatchArmFromSurface(arm: MatchArm): CoreMatchArm {
  return {
    pattern: corePatternFromSurface(arm.pattern),
    body: coreExprFromSurface(arm.body),
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
    value.kind === "JsImportDecl" || value.kind === "TypeDecl" || value.kind === "RecordDecl";
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

function desugarPipe(pipe: Located<{ kind: "Pipe"; left: Expr; right: Expr }>): CoreExpr {
  const left = coreExprFromSurface(pipe.left);
  const right = pipe.right;
  
  if (right.kind === "Call") {
    // e.g., 10 :> add(5) -> add(10, 5)
    const callee = coreExprFromSurface(right.callee);
    const args = [pipe.left, ...right.args];
    return {
      kind: "CoreApp",
      callee,
      arg: coreCallArg(args, pipe.node),
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
      callee: coreExprFromSurface(right),
      arg: left,
      node: pipe.node,
    };
  }
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
