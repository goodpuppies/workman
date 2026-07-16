import type { Binding, Decl, Directive, Expr, Module } from "./ast.ts";

export type GpuRegionId = number;

export type GpuRegionFact = {
  id: GpuRegionId;
  lambda: Extract<Expr, { kind: "Lambda" }>;
  binding?: Binding;
};

export function isGpuLambda(expr: Expr): expr is Extract<Expr, { kind: "Lambda" }> {
  return expr.kind === "Lambda" && expr.directives.some((directive) => directive.name === "gpu");
}

export function gpuDirective(
  expr: Extract<Expr, { kind: "Lambda" }>,
): Directive | undefined {
  return expr.directives.find((directive) => directive.name === "gpu");
}

export function discoverGpuRegions(module: Module): GpuRegionFact[] {
  const regions: GpuRegionFact[] = [];
  for (const decl of module.decls) visitDecl(decl, regions);
  return regions;
}

function visitDecl(decl: Decl, regions: GpuRegionFact[]): void {
  if (decl.kind !== "LetDecl") return;
  for (const binding of decl.bindings) visitExpr(binding.value, regions, binding);
}

function visitExpr(expr: Expr, regions: GpuRegionFact[], directBinding?: Binding): void {
  if (expr.kind === "Lambda") {
    if (isGpuLambda(expr)) {
      regions.push({
        id: regions.length,
        lambda: expr,
        ...(directBinding ? { binding: directBinding } : {}),
      });
    }
    visitExpr(expr.body, regions);
    return;
  }
  switch (expr.kind) {
    case "Tuple":
    case "JsonArray":
      expr.items.forEach((item) => visitExpr(item, regions));
      return;
    case "Record":
    case "JsonObject":
      expr.fields.forEach((field) => visitExpr(field.value, regions));
      return;
    case "FfiGet":
      visitExpr(expr.receiver, regions);
      return;
    case "FfiCall":
      visitExpr(expr.receiver, regions);
      expr.args.forEach((arg) => visitExpr(arg, regions));
      return;
    case "FfiBindingCall":
      expr.args.forEach((arg) => visitExpr(arg, regions));
      return;
    case "Call":
      visitExpr(expr.callee, regions);
      expr.args.forEach((arg) => visitExpr(arg, regions));
      return;
    case "If":
      visitExpr(expr.cond, regions);
      visitExpr(expr.thenExpr, regions);
      visitExpr(expr.elseExpr, regions);
      return;
    case "Match":
      visitExpr(expr.value, regions);
      expr.arms.forEach((arm) => visitExpr(arm.body, regions));
      return;
    case "Panic":
      visitExpr(expr.message, regions);
      return;
    case "Block":
      expr.items.forEach((item) => {
        if (item.kind.endsWith("Decl")) visitDecl(item as Decl, regions);
        else visitExpr(item as Expr, regions);
      });
      visitExpr(expr.result, regions);
      return;
    case "Binary":
    case "Pipe":
      visitExpr(expr.left, regions);
      visitExpr(expr.right, regions);
      return;
    case "Unary":
      visitExpr(expr.value, regions);
      return;
    default:
      return;
  }
}
