import type { Decl, Expr, Module, Pattern } from "./ast.ts";
import type { BindingFacts } from "./binding_facts.ts";
import {
  type FrontendDiagnostic,
  FrontendDiagnosticBundleError,
  genericDiagnostic,
  warningDiagnostic,
} from "./diagnostics.ts";
import type { BindingId } from "./ids.ts";

type Lambda = Extract<Expr, { kind: "Lambda" }>;

export type LexicalCapture = Readonly<{
  id: BindingId;
  name: string;
  reference: Extract<Expr, { kind: "Var" }>;
}>;

export type ClosureCaptureAnalysis = Readonly<{
  captures: Map<Lambda, readonly LexicalCapture[]>;
  diagnostics: FrontendDiagnostic[];
}>;

export function assertCaptureContracts(facts: Iterable<BindingFacts>): void {
  const diagnostics = [...facts].flatMap((fact) => fact.captureDiagnostics);
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length === 0) return;
  throw new FrontendDiagnosticBundleError(
    new Error("explicit closure capture contract failed"),
    diagnostics,
  );
}

type FreeBindings = Map<BindingId, Extract<Expr, { kind: "Var" }>>;

/**
 * Compute source-level lexical captures after name resolution and validate authored contracts.
 * Workman-owned module values participate in the generated module environment. Imported and basis
 * values, whose binding identities are owned elsewhere, remain dependencies rather than payloads.
 */
export function analyzeClosureCaptures(
  module: Module,
  facts: BindingFacts,
): ClosureCaptureAnalysis {
  const captures = new Map<Lambda, readonly LexicalCapture[]>();

  const freeExpr = (expr: Expr): FreeBindings => {
    switch (expr.kind) {
      case "Var": {
        const id = facts.references.get(expr);
        return id === undefined ? new Map() : new Map([[id, expr]]);
      }
      case "Tuple":
      case "JsonArray":
        return unionAll(expr.items.map(freeExpr));
      case "Record":
        return unionAll(expr.fields.map((field) => freeExpr(field.value)));
      case "JsonObject":
        return unionAll(expr.fields.map((field) => freeExpr(field.value)));
      case "FfiGet":
        return freeExpr(expr.receiver);
      case "FfiCall":
        return unionAll([freeExpr(expr.receiver), ...expr.args.map(freeExpr)]);
      case "FfiBindingCall":
        return unionAll(expr.args.map(freeExpr));
      case "Lambda": {
        const free = freeExpr(expr.body);
        for (const param of expr.params) {
          mergeFree(free, freePatternReferences(param.pattern, facts));
          removePatternBinders(free, param.pattern, facts);
        }
        const lexical = [...free]
          .filter(([id]) => isWorkmanCaptureBinding(id, facts))
          .map(([id, reference]) => ({ id, name: reference.name, reference }))
          .sort((left, right) =>
            (left.reference.node?.span.start ?? 0) - (right.reference.node?.span.start ?? 0)
          );
        captures.set(expr, Object.freeze(lexical));
        return free;
      }
      case "Call":
        return unionAll([freeExpr(expr.callee), ...expr.args.map(freeExpr)]);
      case "If":
        return unionAll([freeExpr(expr.cond), freeExpr(expr.thenExpr), freeExpr(expr.elseExpr)]);
      case "Match": {
        const free = freeExpr(expr.value);
        for (const arm of expr.arms) {
          const armFree = freeExpr(arm.body);
          mergeFree(armFree, freePatternReferences(arm.pattern, facts));
          removePatternBinders(armFree, arm.pattern, facts);
          mergeFree(free, armFree);
        }
        return free;
      }
      case "Panic":
        return freeExpr(expr.message);
      case "Block":
        return freeBlock(expr, freeExpr, facts, captures);
      case "Ascribed":
        return freeExpr(expr.value);
      case "Binary":
        return unionAll([freeExpr(expr.left), freeExpr(expr.right)]);
      case "Unary":
        return freeExpr(expr.value);
      case "Pipe":
        return unionAll([freeExpr(expr.left), freeExpr(expr.right)]);
      default:
        return new Map();
    }
  };

  for (const decl of module.decls) visitDeclValues(decl, freeExpr, facts, captures);

  const diagnostics = validateCaptureContracts(captures, facts);
  return { captures, diagnostics };
}

function freeBlock(
  block: Extract<Expr, { kind: "Block" }>,
  freeExpr: (expr: Expr) => FreeBindings,
  facts: BindingFacts,
  captures: Map<Lambda, readonly LexicalCapture[]>,
): FreeBindings {
  const free = freeExpr(block.result);
  for (let index = block.items.length - 1; index >= 0; index -= 1) {
    const item = block.items[index];
    if (!isDecl(item)) {
      mergeFree(free, freeExpr(item));
      continue;
    }
    if (item.kind === "LetDecl") {
      const values = unionAll(item.bindings.map((binding) => freeExpr(binding.value)));
      item.bindings.forEach((binding) =>
        mergeFree(values, freePatternReferences(binding.pattern, facts))
      );
      for (const binding of item.bindings) removePatternBinders(free, binding.pattern, facts);
      if (item.recursive) {
        const recursiveIds = new Set<BindingId>();
        for (const binding of item.bindings) removePatternBinders(values, binding.pattern, facts);
        for (const binding of item.bindings) {
          collectPatternBinderIds(binding.pattern, facts, recursiveIds);
        }
        for (const binding of item.bindings) {
          if (binding.value.kind !== "Lambda") continue;
          const direct = captures.get(binding.value);
          if (direct) {
            captures.set(
              binding.value,
              direct.filter((capture) => !recursiveIds.has(capture.id)),
            );
          }
        }
      }
      mergeFree(free, values);
    } else if (item.kind === "RecordDecl") {
      const id = facts.recordConstructors.get(item);
      if (id !== undefined) free.delete(id);
    }
  }
  return free;
}

function freePatternReferences(pattern: Pattern, facts: BindingFacts): FreeBindings {
  const free: FreeBindings = new Map();
  const id = facts.references.get(pattern);
  if (id !== undefined && pattern.kind === "PPinned") {
    // A pinned pattern reads an enclosing value at match time.
    free.set(id, {
      kind: "Var",
      name: pattern.name,
      node: pattern.node,
    });
  }
  switch (pattern.kind) {
    case "PTuple":
      pattern.items.forEach((item) => mergeFree(free, freePatternReferences(item, facts)));
      break;
    case "PCtor":
      pattern.args.forEach((item) => mergeFree(free, freePatternReferences(item, facts)));
      break;
    case "PAscribed":
      mergeFree(free, freePatternReferences(pattern.pattern, facts));
      break;
    case "PRecord":
      pattern.fields.forEach((field) =>
        mergeFree(free, freePatternReferences(field.pattern, facts))
      );
      break;
  }
  return free;
}

function collectPatternBinderIds(
  pattern: Pattern,
  facts: BindingFacts,
  output: Set<BindingId>,
): void {
  const id = facts.binders.get(pattern);
  if (id !== undefined) output.add(id);
  switch (pattern.kind) {
    case "PTuple":
      pattern.items.forEach((item) => collectPatternBinderIds(item, facts, output));
      break;
    case "PCtor":
      pattern.args.forEach((item) => collectPatternBinderIds(item, facts, output));
      break;
    case "PAscribed":
      collectPatternBinderIds(pattern.pattern, facts, output);
      break;
    case "PRecord":
      pattern.fields.forEach((field) => collectPatternBinderIds(field.pattern, facts, output));
      break;
  }
}

function visitDeclValues(
  decl: Decl,
  freeExpr: (expr: Expr) => FreeBindings,
  facts: BindingFacts,
  captures: Map<Lambda, readonly LexicalCapture[]>,
): void {
  if (decl.kind !== "LetDecl") return;
  for (const binding of decl.bindings) freeExpr(binding.value);
  if (!decl.recursive) return;
  const recursiveIds = new Set<BindingId>();
  for (const binding of decl.bindings) {
    collectPatternBinderIds(binding.pattern, facts, recursiveIds);
  }
  for (const binding of decl.bindings) {
    if (binding.value.kind !== "Lambda") continue;
    const direct = captures.get(binding.value);
    if (direct) {
      captures.set(
        binding.value,
        direct.filter((capture) => !recursiveIds.has(capture.id)),
      );
    }
  }
}

function removePatternBinders(
  free: FreeBindings,
  pattern: Pattern,
  facts: BindingFacts,
): void {
  const id = facts.binders.get(pattern);
  if (id !== undefined) free.delete(id);
  switch (pattern.kind) {
    case "PTuple":
      pattern.items.forEach((item) => removePatternBinders(free, item, facts));
      return;
    case "PCtor":
      pattern.args.forEach((item) => removePatternBinders(free, item, facts));
      return;
    case "PAscribed":
      removePatternBinders(free, pattern.pattern, facts);
      return;
    case "PRecord":
      pattern.fields.forEach((field) => removePatternBinders(free, field.pattern, facts));
      return;
  }
}

function validateCaptureContracts(
  captures: Map<Lambda, readonly LexicalCapture[]>,
  facts: BindingFacts,
): FrontendDiagnostic[] {
  const diagnostics: FrontendDiagnostic[] = [];
  for (const [lambda, actual] of captures) {
    const clause = lambda.captureClause;
    if (!clause) continue;
    const scope = lambda.node ? facts.scopeNodes.get(lambda.node) : undefined;
    const listed = new Map<BindingId, string>();
    const seenNames = new Set<string>();
    for (const [index, name] of clause.names.entries()) {
      const entry = clause.entries?.[index];
      const diagnosticNode = entry?.node ?? clause.node;
      if (seenNames.has(name)) {
        diagnostics.push(genericDiagnostic(
          "error",
          "capture.duplicate",
          `capture \`${name}\` is listed more than once`,
          diagnosticNode,
        ));
        continue;
      }
      seenNames.add(name);
      const id = scope?.values.get(name);
      if (id === undefined) {
        diagnostics.push(genericDiagnostic(
          "error",
          "capture.unknown",
          `capture \`${name}\` does not resolve in the enclosing scope`,
          diagnosticNode,
        ));
        continue;
      }
      if (entry) facts.captureReferences.set(entry, id);
      if (!isWorkmanCaptureBinding(id, facts)) {
        diagnostics.push(genericDiagnostic(
          "error",
          "capture.nonlocal",
          `\`${name}\` is an imported or basis dependency, not a Workman-owned closure capture`,
          diagnosticNode,
        ));
        continue;
      }
      listed.set(id, name);
    }

    const actualIds = new Set(actual.map((capture) => capture.id));
    for (const capture of actual) {
      if (listed.has(capture.id)) continue;
      diagnostics.push(genericDiagnostic(
        "error",
        "capture.unlisted",
        `closure captures \`${capture.name}\`, but it is absent from the explicit capture list`,
        capture.reference.node,
      ));
    }
    for (const [id, name] of listed) {
      if (actualIds.has(id)) continue;
      diagnostics.push(warningDiagnostic(
        `capture \`${name}\` is listed but unused`,
        clause.entries?.find((entry) => entry.name === name)?.node ?? clause.node,
        "capture.unused",
      ));
    }
  }
  return diagnostics;
}

function isWorkmanCaptureBinding(id: BindingId, facts: BindingFacts): boolean {
  return facts.local.has(id) &&
    !facts.jsImportSourceBindings.has(id) &&
    ![...facts.jsImportBinders.values()].includes(id);
}

function unionAll(items: FreeBindings[]): FreeBindings {
  const result: FreeBindings = new Map();
  items.forEach((item) => mergeFree(result, item));
  return result;
}

function mergeFree(target: FreeBindings, source: FreeBindings): void {
  for (const [id, reference] of source) {
    const current = target.get(id);
    if (
      current === undefined ||
      (reference.node?.span.start ?? 0) < (current.node?.span.start ?? 0)
    ) target.set(id, reference);
  }
}

function isDecl(value: Decl | Expr): value is Decl {
  return value.kind.endsWith("Decl");
}
