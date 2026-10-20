import type { Decl, Expr } from "../ast.ts";
import { FrontendDiagnosticError } from "../diagnostic_model.ts";
import { createDiagnosticWriter, premiseContext, sourceAnchor } from "../diagnostic_writer.ts";
import type { TypeInfo } from "../types.ts";

type RecordDeclaration = {
  declaration: Extract<Decl, { kind: "RecordDecl" }>;
  document?: { filePath: string; source: string };
};

const declarations = new WeakMap<TypeInfo, RecordDeclaration>();

export function rememberRecordDeclaration(
  info: TypeInfo,
  declaration: Extract<Decl, { kind: "RecordDecl" }>,
): void {
  declarations.set(info, { declaration });
}

export function rememberRecordDeclarationDocument(
  info: TypeInfo,
  filePath: string,
  source: string,
): void {
  const entry = declarations.get(info);
  if (entry) entry.document ??= { filePath, source };
}

/** Diagnose a field-set failure without selecting or instantiating a nominal type. */
export function recordFieldSetError(
  expr: Extract<Expr, { kind: "Record" }>,
  provided: string[],
  candidates: TypeInfo[],
  allowMissing = false,
): FrontendDiagnosticError {
  const differences = candidates.map((info) => {
    const required = info.recordFields!.map((field) => field.name);
    return {
      info,
      required,
      missing: allowMissing ? [] : required.filter((name) => !provided.includes(name)),
      unexpected: provided.filter((name) => !required.includes(name)),
    };
  });
  const only = differences.length === 1 ? differences[0] : undefined;
  const describe = (label: string, names: string[]) => `${label} ${names.join(", ")}`;
  const issues = only
    ? [
      ...(only.missing.length ? [describe("missing fields:", only.missing)] : []),
      ...(only.unexpected.length ? [describe("unknown fields:", only.unexpected)] : []),
    ]
    : [];
  const code = only
    ? only.unexpected.length
      ? only.missing.length ? "record.field-set-mismatch" : "record.unknown-fields"
      : "record.missing-fields"
    : candidates.length
    ? "record.ambiguous-incomplete"
    : "record.no-matching-type";
  const message = only
    ? `record literal for ${only.info.name} has ${issues.join("; ")}`
    : candidates.length
    ? "incomplete record literal; multiple record types contain its fields"
    : `no record type matches these fields: ${provided.join(", ") || "(none)"}`;
  const writer = createDiagnosticWriter();
  const context = premiseContext(
    "InferRecord.FieldSet",
    "record literal supplies exactly the fields of its nominal type",
    only?.info.name ?? "record literal",
    expr.node,
    { frame: writer.nextId("f"), premise: writer.nextId("p") },
  );
  context.premise.predicate = {
    kind: "well-formed",
    subject: "record literal fields",
    syntaxCategory: "nominal record",
  };
  const roots: string[] = [];
  const providedId = writer.nextId("cl");
  writer.add({
    kind: "claim",
    id: providedId,
    claim: { kind: "fact", subject: "provided fields", text: provided.join(", ") || "(none)" },
    origin: context.origin,
  });
  roots.push(providedId);
  for (const { info, required, missing, unexpected } of differences) {
    const entry = declarations.get(info);
    const document = entry?.document;
    if (document) writer.addSource(document.filePath, document.source);
    const anchor = sourceAnchor(entry?.declaration.node);
    if (anchor.kind === "source" && document) anchor.filePath = document.filePath;
    const candidateId = writer.nextId("cl");
    writer.add({
      kind: "claim",
      id: candidateId,
      claim: {
        kind: "fact",
        subject: `fields of ${info.name}`,
        text: required.join(", ") || "(none)",
      },
      origin: anchor,
    });
    writer.addEdge({ from: candidateId, to: providedId, role: "required-fields" });
    roots.push(candidateId);
    for (const name of missing) {
      const field = entry?.declaration.fields.find((field) => field.name === name);
      const origin = sourceAnchor(field?.node ?? entry?.declaration.node);
      if (origin.kind === "source" && document) origin.filePath = document.filePath;
      const fieldId = writer.nextId("cl");
      writer.add({
        kind: "claim",
        id: fieldId,
        claim: {
          kind: "fact",
          subject: "required field",
          text: `${info.name} requires field ${name}`,
        },
        origin,
      });
      writer.addEdge({ from: fieldId, to: candidateId, role: "requires" });
    }
    for (const name of unexpected) {
      const field = expr.fields.find((field) => field.kind === "Field" && field.name === name);
      const fieldId = writer.nextId("cl");
      writer.add({
        kind: "claim",
        id: fieldId,
        claim: {
          kind: "fact",
          subject: "unknown field",
          text: `${info.name} has no field ${name}`,
        },
        origin: sourceAnchor(field?.node ?? expr.node),
      });
      writer.addEdge({ from: fieldId, to: providedId, role: "unexpected" });
    }
  }
  return new FrontendDiagnosticError({
    id: writer.nextId("d"),
    code,
    severity: "error",
    primary: context.origin,
    failure: {
      frame: context.frame,
      premise: context.premise,
      violation: { kind: "unsatisfied", message },
    },
    support: writer.buildSupport(roots),
    repairs: [],
    dependsOn: [],
  });
}
