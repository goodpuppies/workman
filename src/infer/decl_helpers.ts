import type { Decl, Expr, Pattern, TypeExpr } from "../ast.ts";
import { type FrontendDiagnostic, warningDiagnostic } from "../diagnostics.ts";
import type { Ty, TypeDeclInfo, TypeEnv } from "../types.ts";
import { isVectorExhaustive } from "./exhaustiveness.ts";
import { showPattern } from "./patterns.ts";

export function referencesTypeName(expr: TypeExpr, name: string, vars: Set<string>): boolean {
  if (expr.kind === "TName") {
    return (!vars.has(expr.name) && expr.name === name) ||
      expr.args.some((arg) => referencesTypeName(arg, name, vars));
  }
  if (expr.kind === "TTuple") {
    return expr.items.some((item) => referencesTypeName(item, name, vars));
  }
  if (expr.kind === "TFn") {
    return expr.params.some((param) => referencesTypeName(param, name, vars)) ||
      referencesTypeName(expr.result, name, vars);
  }
  return false;
}

export function rejectDuplicates(names: string[], kind: string) {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`duplicate ${kind} ${name}`);
    seen.add(name);
  }
}

export function hasUnguardedRecursiveRef(
  expr: Expr,
  names: Set<string>,
  guarded = false,
): boolean {
  switch (expr.kind) {
    case "Var":
      return !guarded && names.has(expr.name.split(".")[0]);
    case "Tuple":
      return expr.items.some((item) => hasUnguardedRecursiveRef(item, names, guarded));
    case "Record":
      return expr.fields.some((field) => hasUnguardedRecursiveRef(field.value, names, guarded));
    case "JsonObject":
      return expr.fields.some((field) => hasUnguardedRecursiveRef(field.value, names, guarded));
    case "JsonArray":
      return expr.items.some((item) => hasUnguardedRecursiveRef(item, names, guarded));
    case "FfiGet":
      return hasUnguardedRecursiveRef(expr.receiver, names, guarded);
    case "FfiCall":
      return hasUnguardedRecursiveRef(expr.receiver, names, guarded) ||
        expr.args.some((arg) => hasUnguardedRecursiveRef(arg, names, guarded));
    case "FfiBindingCall":
      return expr.args.some((arg) => hasUnguardedRecursiveRef(arg, names, guarded));
    case "Lambda":
      return hasUnguardedRecursiveRef(expr.body, names, true);
    case "Call":
      return hasUnguardedRecursiveRef(expr.callee, names, guarded) ||
        expr.args.some((arg) => hasUnguardedRecursiveRef(arg, names, guarded));
    case "If":
      return hasUnguardedRecursiveRef(expr.cond, names, guarded) ||
        hasUnguardedRecursiveRef(expr.thenExpr, names, guarded) ||
        hasUnguardedRecursiveRef(expr.elseExpr, names, guarded);
    case "Match":
      return hasUnguardedRecursiveRef(expr.value, names, guarded) ||
        expr.arms.some((arm) => hasUnguardedRecursiveRef(arm.body, names, guarded));
    case "Panic":
      return hasUnguardedRecursiveRef(expr.message, names, guarded);
    case "Block":
      return hasUnguardedRecursiveBlockRef(expr, names, guarded);
    case "Binary":
      return hasUnguardedRecursiveRef(expr.left, names, guarded) ||
        hasUnguardedRecursiveRef(expr.right, names, guarded);
    case "Unary":
      return hasUnguardedRecursiveRef(expr.value, names, guarded);
    default:
      return false;
  }
}

export function warnRedundantMatchArms(
  patterns: Pattern[],
  valueType: Ty,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  warnings: string[],
  diagnostics: FrontendDiagnostic[] = [],
) {
  for (let i = 1; i < patterns.length; i++) {
    const previous = patterns.slice(0, i).map((pattern) => [pattern]);
    if (isVectorExhaustive(previous, [valueType], typeEnv, adts)) {
      const message = `redundant match arm: ${showPattern(patterns[i])}`;
      warnings.push(message);
      diagnostics.push(warningDiagnostic(message, patterns[i].node, "pattern.redundant-arm"));
    }
  }
}

function hasUnguardedRecursiveBlockRef(
  expr: Extract<Expr, { kind: "Block" }>,
  names: Set<string>,
  guarded: boolean,
): boolean {
  let active = new Set(names);
  for (const item of expr.items) {
    if (isExpr(item)) {
      if (hasUnguardedRecursiveRef(item, active, guarded)) return true;
      continue;
    }
    if (item.kind === "LetDecl") {
      for (const binding of item.bindings) {
        if (hasUnguardedRecursiveRef(binding.value, active, guarded)) return true;
      }
      active = withoutBoundPatternNames(
        active,
        item.bindings.flatMap((binding) => patternBindingNames(binding.pattern)),
      );
    }
  }
  return hasUnguardedRecursiveRef(expr.result, active, guarded);
}

function withoutBoundPatternNames(names: Set<string>, bound: string[]): Set<string> {
  const next = new Set(names);
  bound.forEach((name) => next.delete(name));
  return next;
}

function patternBindingNames(pattern: Pattern): string[] {
  switch (pattern.kind) {
    case "PVar":
      return [pattern.name];
    case "PTuple":
      return pattern.items.flatMap(patternBindingNames);
    case "PRecord":
      return pattern.fields.flatMap((field) => patternBindingNames(field.pattern));
    case "PCtor":
      return pattern.args.flatMap(patternBindingNames);
    default:
      return [];
  }
}

function isExpr(value: Expr | Decl): value is Expr {
  return value.kind !== "ImportDecl" && value.kind !== "LetDecl" && value.kind !== "TypeDecl" &&
    value.kind !== "RecordDecl" && value.kind !== "JsImportDecl" &&
    value.kind !== "ForeignTypeDecl";
}
