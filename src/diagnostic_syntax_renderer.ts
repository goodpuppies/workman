import type { Predicate, Repair, SupportEntry, Violation } from "./diagnostic_writer.ts";

export function renderPredicate(predicate: Predicate): string {
  switch (predicate.kind) {
    case "equal":
      return `${predicate.left} == ${predicate.right} (${predicate.domain})`;
    case "present":
      return `present(${predicate.subject}, ${predicate.syntaxCategory})`;
    case "token-is":
      return `token-is(${predicate.subject}, ${predicate.tokenKind})`;
    case "well-formed":
      return `well-formed(${predicate.subject}, ${predicate.syntaxCategory})`;
    case "delimited":
      return `delimited(${predicate.subject}, ${predicate.openKind}, ${predicate.closeKind})`;
    case "separated":
      return `separated(${predicate.subject}, ${predicate.separatorKind})`;
  }
}

export function renderRepair(repair: Repair): string {
  const edits = repair.edits.map((edit) =>
    `${edit.span.start}..${edit.span.end} -> ${JSON.stringify(edit.text)}`
  ).join(", ");
  return `${repair.id} ${repair.applicability}: ${repair.description}; ${edits}; makes ${repair.makesTrue}`;
}

export function renderViolation(violation: Violation): string {
  switch (violation.kind) {
    case "unsatisfied":
      return violation.message;
    case "missing":
      return `missing syntax at ${violation.observedBoundary}`;
    case "unexpected":
      return `unexpected ${violation.observedToken}; expected ${violation.expected.join(" or ")}`;
    case "malformed":
      return `malformed syntax at ${violation.observedRange.start}..${violation.observedRange.end}`;
    case "unclosed":
      return `unclosed ${violation.openToken} at ${violation.observedBoundary}`;
    case "contradicted":
      return "type mismatch";
  }
}

export function renderRecoveryEntry(
  entry: Extract<SupportEntry, { kind: "recovery" }>,
): string {
  const insertion = entry.insertedText ? `, virtual=${JSON.stringify(entry.insertedText)}` : "";
  return `${entry.id} recovery: ${entry.action}; fallback=${entry.fallbackCategory}#${entry.fallbackNode}; class=${entry.repairClass}${insertion}`;
}
