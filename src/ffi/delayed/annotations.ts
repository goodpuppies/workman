import type { Decl, Expr } from "../../ast.ts";
import { diagnosticError } from "../../diagnostics.ts";
import { hostFfiDescendsInto } from "../../region_traversal.ts";
import { type FfiBinding, type FfiVariant, isDecl } from "../shared.ts";

export function rejectAnnotatedDynamicCallbacks(
  decls: Decl[],
  bindings: Map<string, FfiBinding>,
) {
  const annotatedLambdas = annotatedLambdaBindings(decls);
  const variants = new Map<string, { variant: FfiVariant; surfaceName: string }>();
  for (const binding of bindings.values()) {
    for (const variant of binding.variants) {
      variants.set(variant.internalName, { variant, surfaceName: binding.surfaceName });
    }
    if (binding.variants.length === 1) {
      variants.set(binding.surfaceName, {
        variant: binding.variants[0],
        surfaceName: binding.surfaceName,
      });
    }
  }
  const visit = (expr: Expr) => {
    switch (expr.kind) {
      case "FfiCall":
        expr.args.forEach((arg) => rejectAnnotatedCallbackArg(arg, annotatedLambdas));
        visit(expr.receiver);
        expr.args.forEach(visit);
        return;
      case "Call": {
        const found = expr.callee.kind === "Var" ? variants.get(expr.callee.name) : undefined;
        if (found?.variant.target.kind === "JsReceiver" && expr.callee.kind === "Var") {
          const dynamic = found.surfaceName.startsWith("__dynamic.");
          if (dynamic) {
            expr.args.forEach((arg) => rejectAnnotatedCallbackArg(arg, annotatedLambdas));
          }
        }
        visit(expr.callee);
        expr.args.forEach(visit);
        return;
      }
      case "Tuple":
      case "JsonArray":
        expr.items.forEach(visit);
        return;
      case "Record":
      case "JsonObject":
        expr.fields.forEach((field) => visit(field.value));
        return;
      case "Lambda":
        if (!hostFfiDescendsInto(expr)) return;
        visit(expr.body);
        return;
      case "If":
        visit(expr.cond);
        visit(expr.thenExpr);
        visit(expr.elseExpr);
        return;
      case "Match":
        visit(expr.value);
        expr.arms.forEach((arm) => visit(arm.body));
        return;
      case "Panic":
        visit(expr.message);
        return;
      case "Block":
        for (const item of expr.items) {
          if (isDecl(item)) visitDecl(item);
          else visit(item);
        }
        visit(expr.result);
        return;
      case "Binary":
        visit(expr.left);
        visit(expr.right);
        return;
      case "Unary":
        visit(expr.value);
        return;
      case "Pipe":
        visit(expr.left);
        visit(expr.right);
        return;
    }
  };
  const visitDecl = (decl: Decl) => {
    if (decl.kind !== "LetDecl") return;
    for (const binding of decl.bindings) visit(binding.value);
  };
  decls.forEach(visitDecl);
}

function annotatedLambdaBindings(decls: Decl[]): Map<string, Expr> {
  const result = new Map<string, Expr>();
  const visitDecl = (decl: Decl) => {
    if (decl.kind !== "LetDecl") return;
    for (const binding of decl.bindings) {
      if (
        binding.pattern.kind === "PVar" && binding.value.kind === "Lambda" &&
        binding.value.params.some((param) => param.annotation)
      ) {
        result.set(binding.pattern.name, binding.value);
      }
      visitExpr(binding.value);
    }
  };
  const visitExpr = (expr: Expr) => {
    if (expr.kind === "Block") {
      expr.items.forEach((item) => {
        if (isDecl(item)) visitDecl(item);
      });
    }
  };
  decls.forEach(visitDecl);
  return result;
}

function rejectAnnotatedCallbackArg(arg: Expr, annotatedLambdas: Map<string, Expr>) {
  if (
    arg.kind === "Lambda" &&
    arg.params.some((param) => param.annotation)
  ) {
    throw diagnosticError(
      new Error(
        "JS callback parameter annotations cannot cast dynamic callback arguments; use reflection or an explicit assertion inside the callback",
      ),
      arg.node,
    );
  }
  if (arg.kind === "Var" && annotatedLambdas.has(arg.name)) {
    throw diagnosticError(
      new Error(
        "JS callback parameter annotations cannot cast dynamic callback arguments; use reflection or an explicit assertion inside the callback",
      ),
      arg.node ?? annotatedLambdas.get(arg.name)?.node,
    );
  }
}
