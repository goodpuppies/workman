import type { Decl, Expr, Pattern } from "../ast.ts";
import type { CompilerSemanticId } from "../compiler_semantics.ts";
import type { GpuOperatorId, OperatorExpr } from "../gpu_operators.ts";
import { prune, type Scheme, type Ty, type TypeInfo } from "../types.ts";

export type TypeFacts = {
  expressions: Map<Expr, TypeFact>;
  patterns: Map<Pattern, TypeFact>;
  patternTypes: Map<Pattern, Ty>;
  operators: Map<OperatorExpr, GpuOperatorId>;
  bindings: Map<string, TypeFact[]>;
  typeDeclarations: Map<Extract<Decl, { kind: "TypeDecl" | "RecordDecl" }>, TypeInfo>;
  ffi: Map<number, FfiFact>;
};

export type TypeFact = {
  instantiated?: Ty;
  general?: Scheme;
  subject: TypeFactSubject;
  origin?: TypeFactOrigin;
  notes?: TypeFactNote[];
};

export type TypeFactSubject =
  | "expr"
  | "pattern"
  | "binding"
  | "constructor"
  | "ffi-obligation"
  | "ffi-reflected"
  | "synthetic";

export type TypeFactOrigin = {
  name?: string;
  source: "local" | "import" | "basis" | "js-import" | "reflected-ffi" | "synthetic";
  semanticId?: CompilerSemanticId;
};

export type TypeFactNote = {
  kind: "info" | "warning";
  message: string;
};

export type FfiFact = {
  id: number;
  kind: "get" | "call";
  path: string[];
  receiver?: Ty;
  args: Ty[];
  binding?: string;
  expr?: Expr;
  placeholder?: Extract<Ty, { tag: "ffi" }>;
  status: "unresolved" | "resolved";
  instantiated?: Ty;
  origin?: TypeFactOrigin;
  consumed?: FfiConsumedUse;
};

export type FfiConsumedUse = {
  kind: "match" | "binding" | "operator" | "pipe" | "call";
  message: string;
};

export function createTypeFacts(): TypeFacts {
  return {
    expressions: new Map(),
    patterns: new Map(),
    patternTypes: new Map(),
    operators: new Map(),
    bindings: new Map(),
    typeDeclarations: new Map(),
    ffi: new Map(),
  };
}

export function recordOperatorFact(
  facts: TypeFacts,
  expression: OperatorExpr,
  operatorId: GpuOperatorId,
) {
  facts.operators.set(expression, operatorId);
}

export function recordPatternType(facts: TypeFacts, pattern: Pattern, type: Ty) {
  facts.patternTypes.set(pattern, type);
}

export function recordTypeDeclarationFact(
  facts: TypeFacts,
  declaration: Extract<Decl, { kind: "TypeDecl" | "RecordDecl" }>,
  info: TypeInfo,
) {
  facts.typeDeclarations.set(declaration, info);
}

export function recordExprFact(
  facts: TypeFacts,
  expr: Expr,
  fact: Partial<TypeFact> & Pick<TypeFact, "subject">,
) {
  facts.expressions.set(expr, mergeFact(facts.expressions.get(expr), fact));
}

export function recordPatternFact(
  facts: TypeFacts,
  pattern: Pattern,
  fact: Partial<TypeFact> & Pick<TypeFact, "subject">,
) {
  facts.patterns.set(pattern, mergeFact(facts.patterns.get(pattern), fact));
}

export function recordBindingFact(
  facts: TypeFacts,
  name: string,
  fact: Partial<TypeFact> & Pick<TypeFact, "subject">,
) {
  const existing = facts.bindings.get(name) ?? [];
  facts.bindings.set(name, [...existing, mergeFact(undefined, fact)]);
}

export function recordFfiFact(facts: TypeFacts, fact: FfiFact) {
  facts.ffi.set(fact.id, fact);
}

export function resolveFfiFact(
  facts: TypeFacts,
  id: number,
  instantiated: Ty,
  origin: TypeFactOrigin = { source: "reflected-ffi" },
) {
  const existing = facts.ffi.get(id);
  if (!existing) return;
  facts.ffi.set(id, {
    ...existing,
    status: "resolved",
    instantiated,
    origin,
  });
}

export function recordConsumedFfiUse(
  facts: TypeFacts,
  type: Ty,
  consumed: FfiConsumedUse,
) {
  for (const id of unresolvedFfiIds(type)) {
    const existing = facts.ffi.get(id);
    if (!existing || existing.status === "resolved") continue;
    facts.ffi.set(id, { ...existing, consumed });
  }
}

export function originForScheme(name: string, scheme: Scheme): TypeFactOrigin {
  return {
    name,
    semanticId: scheme.semanticId,
    source: scheme.jsImport
      ? "js-import"
      : scheme.basis
      ? "basis"
      : scheme.imported
      ? "import"
      : "local",
  };
}

function mergeFact(
  existing: TypeFact | undefined,
  next: Partial<TypeFact> & Pick<TypeFact, "subject">,
): TypeFact {
  return {
    subject: next.subject ?? existing?.subject ?? "expr",
    instantiated: next.instantiated ?? existing?.instantiated,
    general: next.general ?? existing?.general,
    origin: next.origin ?? existing?.origin,
    notes: [...(existing?.notes ?? []), ...(next.notes ?? [])],
  };
}

function unresolvedFfiIds(type: Ty, out = new Set<number>()): Set<number> {
  const target = prune(type);
  if (target.tag === "ffi") {
    if (!target.instance) out.add(target.id);
    return out;
  }
  if (target.tag === "fn") {
    target.params.forEach((param) => unresolvedFfiIds(param, out));
    unresolvedFfiIds(target.result, out);
  } else if (target.tag === "tuple") {
    target.items.forEach((item) => unresolvedFfiIds(item, out));
  } else if (target.tag === "struct") {
    target.fields.forEach((field) => unresolvedFfiIds(field.type, out));
  } else if (target.tag === "named") {
    target.args.forEach((arg) => unresolvedFfiIds(arg, out));
  }
  return out;
}
