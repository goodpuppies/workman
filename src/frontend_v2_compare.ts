import type { Expr, ImportClause, ImportSpec, Module, Pattern, TypeExpr } from "./ast.ts";
import { type FrontendV2 } from "./frontend_v2_loader.ts";
import { semanticProjectionToModule } from "./frontend_v2_semantic.ts";
import { parse, type Surface } from "./parser.ts";

export type NormalizedFrontendModule = {
  decls: NormalizedFrontendDecl[];
};

export type NormalizedFrontendDecl = {
  kind: "LetDecl";
  exported: boolean;
  recursive: boolean;
  bindings: NormalizedFrontendBinding[];
} | {
  kind: "ImportDecl";
  path: string;
  clause: NormalizedFrontendImportClause;
};

export type NormalizedFrontendImportClause =
  | { kind: "All" }
  | { kind: "Namespace"; alias: string }
  | { kind: "Named"; specs: NormalizedFrontendImportSpec[] };

export type NormalizedFrontendImportSpec = {
  name: string;
  alias?: string;
};

export type NormalizedFrontendBinding = {
  pattern: NormalizedFrontendPattern;
  annotation?: NormalizedFrontendTypeExpr;
  value: NormalizedFrontendExpr;
};

export type NormalizedFrontendPattern =
  | { kind: "PVar"; name: string }
  | { kind: "PWildcard" }
  | { kind: "PCtor"; name: string; args: [] }
  | { kind: "PInt"; value: number }
  | { kind: "PString"; value: string }
  | { kind: "PBool"; value: boolean }
  | { kind: "PVoid" };

export type NormalizedFrontendExpr =
  | { kind: "Var"; name: string }
  | { kind: "Int"; value: number }
  | { kind: "Float"; value: number }
  | { kind: "String"; value: string }
  | { kind: "Bool"; value: boolean }
  | { kind: "Void" }
  | { kind: "Tuple"; items: NormalizedFrontendExpr[] }
  | { kind: "Lambda"; params: NormalizedFrontendParam[]; body: NormalizedFrontendExpr }
  | { kind: "Block"; items: []; result: NormalizedFrontendExpr }
  | {
    kind: "Call";
    callee: NormalizedFrontendExpr;
    args: NormalizedFrontendExpr[];
  };

export type NormalizedFrontendParam = {
  pattern: NormalizedFrontendPattern;
  annotation?: NormalizedFrontendTypeExpr;
};

export type NormalizedFrontendTypeExpr =
  | { kind: "TName"; name: string; args: NormalizedFrontendTypeExpr[] }
  | { kind: "TVar"; name: string }
  | { kind: "TTuple"; items: NormalizedFrontendTypeExpr[] }
  | {
    kind: "TFn";
    params: NormalizedFrontendTypeExpr[];
    result: NormalizedFrontendTypeExpr;
  };

export type FrontendSemanticComparison = {
  equivalent: boolean;
  v1: NormalizedFrontendModule;
  v2: NormalizedFrontendModule;
  diagnostics: string[];
};

export async function compareSupportedFrontendSemantics(
  source: string,
  frontend: Pick<FrontendV2, "projectSemantic" | "parseStructural">,
  options: { surface?: Surface } = {},
): Promise<FrontendSemanticComparison> {
  const v1 = normalizeSupportedModule(await parse(source, options.surface));
  const projected = semanticProjectionToModule(frontend.projectSemantic(source), {
    source,
    structural: frontend.parseStructural(source),
  });
  const v2 = normalizeSupportedModule(projected.module);
  const diagnostics = projected.diagnostics.map((diagnostic) => diagnostic.message);
  if (JSON.stringify(v1) !== JSON.stringify(v2)) {
    diagnostics.push("normalized frontend semantic modules differ");
  }

  return { equivalent: diagnostics.length === 0, v1, v2, diagnostics };
}

function normalizeSupportedModule(module: Module): NormalizedFrontendModule {
  return { decls: module.decls.map(normalizeSupportedDecl) };
}

function normalizeSupportedDecl(decl: Module["decls"][number]): NormalizedFrontendDecl {
  if (decl.kind === "ImportDecl") {
    return {
      kind: "ImportDecl",
      path: decl.path,
      clause: normalizeSupportedImportClause(decl.clause),
    };
  }
  if (decl.kind === "LetDecl") {
    return {
      kind: "LetDecl",
      exported: decl.exported,
      recursive: decl.recursive,
      bindings: decl.bindings.map((binding) => ({
        pattern: normalizeSupportedPattern(binding.pattern),
        ...(binding.annotation ? { annotation: normalizeSupportedType(binding.annotation) } : {}),
        value: normalizeSupportedExpr(binding.value),
      })),
    };
  }
  throw new Error(`unsupported declaration ${decl.kind}`);
}

function normalizeSupportedImportClause(clause: ImportClause): NormalizedFrontendImportClause {
  if (clause.kind === "All") return { kind: "All" };
  if (clause.kind === "Namespace") return { kind: "Namespace", alias: clause.alias };
  return { kind: "Named", specs: clause.specs.map(normalizeSupportedImportSpec) };
}

function normalizeSupportedImportSpec(spec: ImportSpec): NormalizedFrontendImportSpec {
  return {
    name: spec.name,
    ...(spec.alias ? { alias: spec.alias } : {}),
  };
}

function normalizeSupportedPattern(pattern: Pattern): NormalizedFrontendPattern {
  if (pattern.kind === "PVar") return { kind: "PVar", name: pattern.name };
  if (pattern.kind === "PWildcard") return { kind: "PWildcard" };
  if (pattern.kind === "PCtor" && pattern.args.length === 0) {
    return { kind: "PCtor", name: pattern.name, args: [] };
  }
  if (pattern.kind === "PInt") return { kind: "PInt", value: pattern.value };
  if (pattern.kind === "PString") return { kind: "PString", value: pattern.value };
  if (pattern.kind === "PBool") return { kind: "PBool", value: pattern.value };
  if (pattern.kind === "PVoid") return { kind: "PVoid" };
  throw new Error(`unsupported pattern ${pattern.kind}`);
}

function normalizeSupportedType(type: TypeExpr): NormalizedFrontendTypeExpr {
  if (type.kind === "TName") {
    return { kind: "TName", name: type.name, args: type.args.map(normalizeSupportedType) };
  }
  if (type.kind === "TVar") return { kind: "TVar", name: type.name };
  if (type.kind === "TTuple") {
    return { kind: "TTuple", items: type.items.map(normalizeSupportedType) };
  }
  if (type.kind === "TFn") {
    return {
      kind: "TFn",
      params: type.params.map(normalizeSupportedType),
      result: normalizeSupportedType(type.result),
    };
  }
  throw new Error("unsupported type annotation");
}

function normalizeSupportedExpr(expr: Expr): NormalizedFrontendExpr {
  switch (expr.kind) {
    case "Var":
      return { kind: "Var", name: expr.name };
    case "Int":
      return { kind: "Int", value: expr.value };
    case "Float":
      return { kind: "Float", value: expr.value };
    case "String":
      return { kind: "String", value: expr.value };
    case "Bool":
      return { kind: "Bool", value: expr.value };
    case "Void":
      return { kind: "Void" };
    case "Tuple":
      return { kind: "Tuple", items: expr.items.map(normalizeSupportedExpr) };
    case "Lambda":
      return {
        kind: "Lambda",
        params: expr.params.map((param) => ({
          pattern: normalizeSupportedPattern(param.pattern),
          ...(param.annotation ? { annotation: normalizeSupportedType(param.annotation) } : {}),
        })),
        body: normalizeSupportedExpr(expr.body),
      };
    case "Block":
      if (expr.items.length > 0) throw new Error("unsupported non-empty block");
      return { kind: "Block", items: [], result: normalizeSupportedExpr(expr.result) };
    case "Call":
      return {
        kind: "Call",
        callee: normalizeSupportedExpr(expr.callee),
        args: expr.args.map(normalizeSupportedExpr),
      };
    default:
      throw new Error(`unsupported expression ${expr.kind}`);
  }
}
