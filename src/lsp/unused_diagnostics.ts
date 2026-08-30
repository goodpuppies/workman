import type {
  ImportTarget,
  ModuleInterface,
  ModuleSemanticOccurrence,
  SemanticOccurrenceTarget,
} from "../module_interface.ts";
import { standardValueId } from "../compiler_semantics.ts";
import { spanRange } from "./range.ts";
import type { LspDiagnostic } from "./validation.ts";

type UnusedCandidate = Readonly<{
  name: string;
  span: ModuleSemanticOccurrence["span"];
  targets: readonly SemanticOccurrenceTarget[];
  code:
    | "lint.unused-binding"
    | "lint.unused-parameter"
    | "lint.unused-type-variable"
    | "lint.unused-import";
  message: string;
  matchName: boolean;
}>;

/** Derive conservative unused-name warnings from one complete semantic interface. */
export function unusedDiagnostics(
  moduleInterface: ModuleInterface,
  source: string,
): LspDiagnostic[] {
  if (moduleInterface.completeness.occurrences !== "complete") return [];

  const imports = importCandidates(moduleInterface);
  const importSpans = new Set(imports.map((candidate) => spanKey(candidate.span)));
  const candidates = [
    ...localCandidates(moduleInterface).filter((candidate) =>
      !importSpans.has(spanKey(candidate.span))
    ),
    ...imports,
  ];
  return candidates
    .filter((candidate) => !candidate.name.startsWith("_"))
    .filter((candidate) => !hasUse(moduleInterface.occurrences, candidate))
    .sort((left, right) => left.span.start - right.span.start || left.span.end - right.span.end)
    .map((candidate) => ({
      range: spanRange(source, candidate.span),
      severity: 2,
      code: candidate.code,
      source: "wm-mini",
      message: candidate.message,
      tags: [1],
    }));
}

/** Warn whenever the standard Result.debug escape hatch is referenced. */
export function resultDebugDiagnostics(
  moduleInterface: ModuleInterface,
  source: string,
): LspDiagnostic[] {
  const target = standardValueId("std/result.wm", "debug");
  return moduleInterface.occurrences
    .filter((occurrence) =>
      occurrence.role === "reference" && occurrence.target.kind === "value" &&
      occurrence.target.id === target
    )
    .map((occurrence) => ({
      range: spanRange(source, occurrence.span),
      severity: 2,
      code: "lint.result-debug",
      source: "wm-mini",
      message: "Result.debug aborts on Err; handle the Result explicitly when possible.",
    }));
}

function localCandidates(moduleInterface: ModuleInterface): UnusedCandidate[] {
  return moduleInterface.occurrences.flatMap((occurrence) => {
    if (
      isPublicApiOccurrence(moduleInterface, occurrence) ||
      isImplicitRecordConstructor(moduleInterface, occurrence) ||
      (occurrence.role !== "declaration" && occurrence.role !== "import-alias")
    ) return [];
    const parameter = moduleInterface.semanticTokens.some((token) =>
      token.kind === "parameter" && sameSpan(token.span, occurrence.span)
    );
    const code = occurrence.target.kind === "type-variable"
      ? "lint.unused-type-variable" as const
      : parameter
      ? "lint.unused-parameter" as const
      : "lint.unused-binding" as const;
    const noun = code === "lint.unused-parameter"
      ? "Parameter"
      : code === "lint.unused-type-variable"
      ? "Type variable"
      : "Binding";
    return [{
      name: occurrence.name,
      span: occurrence.span,
      targets: [occurrence.target],
      code,
      message: `${noun} \`${occurrence.name}\` is never used.`,
      matchName: false,
    }];
  });
}

function isImplicitRecordConstructor(
  moduleInterface: ModuleInterface,
  occurrence: ModuleSemanticOccurrence,
): boolean {
  return occurrence.role === "declaration" && occurrence.target.kind === "value" &&
    moduleInterface.occurrences.some((candidate) =>
      candidate.role === "declaration" &&
      candidate.target.kind === "type" &&
      candidate.name === occurrence.name &&
      sameSpan(candidate.span, occurrence.span)
    );
}

function isPublicApiOccurrence(
  moduleInterface: ModuleInterface,
  occurrence: ModuleSemanticOccurrence,
): boolean {
  if (occurrence.declaration?.visibility !== "public") return false;
  if (occurrence.target.kind === "field") return true;
  return moduleInterface.declarations.some((declaration) =>
    sameTarget(declaration.target, occurrence.target) ||
    declaration.constructors?.some((constructor) =>
        occurrence.target.kind === "constructor" && occurrence.target.id === constructor.id
      ) === true ||
    (declaration.name === occurrence.name && sameSpan(declaration.selectionSpan, occurrence.span))
  );
}

function importCandidates(moduleInterface: ModuleInterface): UnusedCandidate[] {
  return moduleInterface.imports.flatMap((imported) => {
    if (imported.clause.kind === "Namespace" && imported.structureAlias) {
      const occurrence = moduleInterface.occurrences.find((candidate) =>
        candidate.role === "import-alias" &&
        candidate.target.kind === "structure" &&
        candidate.target.id === imported.structureAlias!.id
      );
      return occurrence
        ? [importCandidate(occurrence.name, occurrence.span, [occurrence.target])]
        : [];
    }
    if (imported.clause.kind !== "Named") return [];
    return imported.targets.flatMap((target) => {
      const identities = importTargetIdentities(target);
      const role = target.localName === target.sourceName ? "import-source" : "import-alias";
      const occurrence = moduleInterface.occurrences.find((candidate) =>
        candidate.role === role &&
        candidate.name === (role === "import-source" ? target.sourceName : target.localName) &&
        inside(candidate.span, imported.declaration.node?.span) &&
        identities.some((identity) => sameTarget(identity, candidate.target))
      );
      return occurrence ? [importCandidate(target.localName, occurrence.span, identities)] : [];
    });
  });
}

function importCandidate(
  name: string,
  span: ModuleSemanticOccurrence["span"],
  targets: readonly SemanticOccurrenceTarget[],
): UnusedCandidate {
  return {
    name,
    span,
    targets,
    code: "lint.unused-import",
    message: `Import \`${name}\` is never used.`,
    matchName: true,
  };
}

function importTargetIdentities(target: ImportTarget): SemanticOccurrenceTarget[] {
  const identities: SemanticOccurrenceTarget[] = [];
  if (target.value !== undefined) identities.push({ kind: "value", id: target.value });
  if (target.type !== undefined) identities.push({ kind: "type", id: target.type });
  if (target.constructor !== undefined) {
    identities.push({ kind: "constructor", id: target.constructor });
  }
  return identities;
}

function hasUse(
  occurrences: readonly ModuleSemanticOccurrence[],
  candidate: UnusedCandidate,
): boolean {
  return occurrences.some((occurrence) =>
    (occurrence.role === "reference" || occurrence.role === "qualifier") &&
    (!candidate.matchName || occurrence.name === candidate.name) &&
    candidate.targets.some((target) => sameTarget(target, occurrence.target))
  );
}

function sameTarget(left: SemanticOccurrenceTarget, right: SemanticOccurrenceTarget): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function sameSpan(
  left: ModuleSemanticOccurrence["span"],
  right: ModuleSemanticOccurrence["span"],
): boolean {
  return left.start === right.start && left.end === right.end;
}

function spanKey(span: ModuleSemanticOccurrence["span"]): string {
  return `${span.start}:${span.end}`;
}

function inside(
  inner: ModuleSemanticOccurrence["span"],
  outer: ModuleSemanticOccurrence["span"] | undefined,
): boolean {
  return outer !== undefined && outer.start <= inner.start && inner.end <= outer.end;
}
