import type { Decl, Expr, Module, Pattern, TypeExpr } from "../ast.ts";
import { type FrontendDiagnostic, warningDiagnostic } from "../diagnostics.ts";
import type { AstNode } from "../source.ts";

const MAX_POSITIONAL_TUPLE_SIZE = 4;

export function warnWideTuples(
  module: Module,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
): void {
  for (const decl of module.decls) {
    visitDecl(decl, warnings, diagnostics);
  }
}

function visitDecl(
  decl: Decl,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
): void {
  switch (decl.kind) {
    case "LetDecl":
      for (const binding of decl.bindings) {
        visitPattern(binding.pattern, warnings, diagnostics);
        if (binding.annotation) {
          visitType(binding.annotation, warnings, diagnostics);
        }
        visitExpr(binding.value, warnings, diagnostics);
      }
      return;
    case "RecordDecl":
      for (const field of decl.fields) {
        visitType(field.type, warnings, diagnostics);
      }
      return;
    case "TypeDecl":
      if (decl.alias) {
        visitType(decl.alias, warnings, diagnostics);
      }
      for (const ctor of decl.ctors) {
        for (const arg of ctor.args) {
          visitType(arg, warnings, diagnostics);
        }
      }
      return;
    case "JsImportDecl":
      if (decl.clause.kind === "Named") {
        for (const spec of decl.clause.specs) {
          if (spec.type) {
            visitType(spec.type, warnings, diagnostics);
          }
        }
      }
      return;
    case "ImportDecl":
    case "ForeignTypeDecl":
      return;
  }
}

function visitExpr(
  expr: Expr,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
): void {
  switch (expr.kind) {
    case "Tuple":
      if (expr.items.length > MAX_POSITIONAL_TUPLE_SIZE) {
        const carrierTuple = expr.items.every((item) =>
          item.kind === "Var" && item.name.startsWith("__wm_lift_")
        );
        reportWideTuple(
          expr.items.length,
          carrierTuple ? "carrier pipe" : "tuple expression",
          carrierTuple
            ? "Map the collected values into a named record immediately after the carrier pipe."
            : "Use a named record when the positions have distinct meanings.",
          expr.node,
          warnings,
          diagnostics,
        );
      }
      expr.items.forEach((item) => visitExpr(item, warnings, diagnostics));
      return;
    case "Record":
      expr.fields.forEach((field) => visitExpr(field.value, warnings, diagnostics));
      return;
    case "JsonObject":
      expr.fields.forEach((field) => visitExpr(field.value, warnings, diagnostics));
      return;
    case "JsonArray":
      expr.items.forEach((item) => visitExpr(item, warnings, diagnostics));
      return;
    case "FfiGet":
      visitExpr(expr.receiver, warnings, diagnostics);
      return;
    case "FfiCall":
      visitExpr(expr.receiver, warnings, diagnostics);
      expr.args.forEach((arg) => visitExpr(arg, warnings, diagnostics));
      return;
    case "FfiBindingCall":
      expr.args.forEach((arg) => visitExpr(arg, warnings, diagnostics));
      return;
    case "Lambda":
      for (const param of expr.params) {
        visitPattern(param.pattern, warnings, diagnostics);
        if (param.annotation) {
          visitType(param.annotation, warnings, diagnostics);
        }
      }
      visitExpr(expr.body, warnings, diagnostics);
      return;
    case "Call":
      visitExpr(expr.callee, warnings, diagnostics);
      expr.args.forEach((arg) => visitExpr(arg, warnings, diagnostics));
      return;
    case "If":
      visitExpr(expr.cond, warnings, diagnostics);
      visitExpr(expr.thenExpr, warnings, diagnostics);
      visitExpr(expr.elseExpr, warnings, diagnostics);
      return;
    case "Match": {
      visitExpr(expr.value, warnings, diagnostics);
      const valueIsWideTuple = expr.value.kind === "Tuple" &&
        expr.value.items.length > MAX_POSITIONAL_TUPLE_SIZE;
      for (const arm of expr.arms) {
        if (!(valueIsWideTuple && arm.pattern.kind === "PTuple")) {
          visitPattern(arm.pattern, warnings, diagnostics);
        }
        visitExpr(arm.body, warnings, diagnostics);
      }
      return;
    }
    case "Panic":
      visitExpr(expr.message, warnings, diagnostics);
      return;
    case "Block":
      for (const item of expr.items) {
        if (item.kind.endsWith("Decl")) {
          visitDecl(item as Decl, warnings, diagnostics);
        } else {
          visitExpr(item as Expr, warnings, diagnostics);
        }
      }
      visitExpr(expr.result, warnings, diagnostics);
      return;
    case "Binary":
    case "Pipe":
      visitExpr(expr.left, warnings, diagnostics);
      visitExpr(expr.right, warnings, diagnostics);
      return;
    case "Unary":
      visitExpr(expr.value, warnings, diagnostics);
      return;
    case "Int":
    case "Float":
    case "String":
    case "Bool":
    case "Void":
    case "Var":
      return;
  }
}

function visitPattern(
  pattern: Pattern,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
): void {
  switch (pattern.kind) {
    case "PTuple":
      if (pattern.items.length > MAX_POSITIONAL_TUPLE_SIZE) {
        reportWideTuple(
          pattern.items.length,
          "tuple pattern",
          "Bind or convert the value to a named record before destructuring its fields.",
          pattern.node,
          warnings,
          diagnostics,
        );
      }
      pattern.items.forEach((item) => visitPattern(item, warnings, diagnostics));
      return;
    case "PRecord":
      pattern.fields.forEach((field) => visitPattern(field.pattern, warnings, diagnostics));
      return;
    case "PCtor":
      pattern.args.forEach((arg) => visitPattern(arg, warnings, diagnostics));
      return;
    case "PWildcard":
    case "PVar":
    case "PInt":
    case "PString":
    case "PBool":
    case "PVoid":
    case "PPinned":
      return;
  }
}

function visitType(
  type: TypeExpr,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
): void {
  switch (type.kind) {
    case "TTuple":
      if (type.items.length > MAX_POSITIONAL_TUPLE_SIZE) {
        reportWideTuple(
          type.items.length,
          "tuple type",
          "Use a named record when the positions have distinct meanings.",
          type.node,
          warnings,
          diagnostics,
        );
      }
      type.items.forEach((item) => visitType(item, warnings, diagnostics));
      return;
    case "TFn":
      type.params.forEach((param) => visitType(param, warnings, diagnostics));
      visitType(type.result, warnings, diagnostics);
      return;
    case "TName":
      type.args.forEach((arg) => visitType(arg, warnings, diagnostics));
      return;
    case "TVar":
      return;
  }
}

function reportWideTuple(
  size: number,
  subject: string,
  advice: string,
  node: AstNode | undefined,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
): void {
  const message =
    `${subject} has ${size} elements; positional tuples should have at most ${MAX_POSITIONAL_TUPLE_SIZE}. ${advice}`;
  warnings.push(message);
  diagnostics.push(warningDiagnostic(message, node, "style.wide-tuple"));
}
