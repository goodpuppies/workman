import type { Expr } from "../ast.ts";
import { FrontendDiagnosticError } from "../diagnostic_model.ts";
import { createDiagnosticWriter, premiseContext, sourceAnchor } from "../diagnostic_writer.ts";
import { show, type Ty } from "../types.ts";
import type { TypeSource } from "./provenance.ts";

/** A failed projection records the receiver's actual type and the expression that produced it. */
export function recordProjectionError(
  expression: Expr,
  field: string,
  receiver: Ty,
  message: string,
  source?: TypeSource,
): FrontendDiagnosticError {
  const writer = createDiagnosticWriter();
  const context = premiseContext(
    "InferRecord.ProjectField",
    "receiver type provides the requested record field",
    `.${field}`,
    expression.node,
    { frame: writer.nextId("f"), premise: writer.nextId("p") },
  );
  context.premise.predicate = {
    kind: "present",
    subject: field,
    syntaxCategory: "record field",
  };
  const requested = writer.nextId("cl");
  writer.add({
    kind: "claim",
    id: requested,
    claim: { kind: "fact", subject: "requested field", text: `.${field}` },
    origin: context.origin,
  });
  const origin = source?.origin;
  const document = source?.document;
  const anchor = sourceAnchor(origin?.node);
  if (anchor.kind === "source") {
    if (origin?.span) anchor.span = origin.span;
    // Application spans may include their postfix suffix; the receiver ends before the dot.
    if (
      !origin?.filePath && !document && expression.node &&
      anchor.span.start < expression.node.span.start &&
      anchor.span.end >= expression.node.span.start
    ) {
      anchor.span = { ...anchor.span, end: expression.node.span.start - 1 };
    }
    anchor.filePath = origin?.filePath ?? document?.filePath;
  }
  if (document) writer.addSource(document.filePath, document.source);
  if (origin?.filePath && origin.source) writer.addSource(origin.filePath, origin.source);
  const receiverType = writer.snapshotType(receiver);
  const actual = writer.nextId("cl");
  writer.add({
    kind: "claim",
    id: actual,
    claim: {
      kind: "has-type",
      subject: origin?.message ?? "field receiver",
      type: receiverType,
    },
    origin: origin ? anchor : context.origin,
  });
  writer.addEdge({ from: actual, to: requested, role: "receiver" });
  const support = writer.buildSupport([requested, actual]);
  // Shape snapshots omit effect markers. Keep the full inferred receiver type in its origin.
  const snapshot = support.types.find((type) => type.id === receiverType)!;
  snapshot.rendered = show(receiver);
  return new FrontendDiagnosticError({
    id: writer.nextId("d"),
    code: "record.invalid-projection",
    severity: "error",
    primary: context.origin,
    failure: {
      frame: context.frame,
      premise: context.premise,
      violation: { kind: "unsatisfied", message },
    },
    support,
    repairs: [],
    dependsOn: [],
  });
}
