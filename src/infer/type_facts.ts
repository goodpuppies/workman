import type { Expr, Pattern } from "../ast.ts";
import type { Scheme, Ty } from "../types.ts";

export type TypeFacts = {
  expressions: Map<Expr, TypeFact>;
  patterns: Map<Pattern, TypeFact>;
  bindings: Map<string, TypeFact[]>;
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
};

export type TypeFactNote = {
  kind: "info" | "warning";
  message: string;
};

export type FfiFact = {
  id: number;
  kind: "get" | "call";
  path: string[];
  receiver: Ty;
  args: Ty[];
  expr?: Expr;
  placeholder?: Extract<Ty, { tag: "ffi" }>;
  status: "unresolved" | "resolved";
  instantiated?: Ty;
  origin?: TypeFactOrigin;
};

export function createTypeFacts(): TypeFacts {
  return {
    expressions: new Map(),
    patterns: new Map(),
    bindings: new Map(),
    ffi: new Map(),
  };
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

export function originForScheme(name: string, scheme: Scheme): TypeFactOrigin {
  return {
    name,
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
