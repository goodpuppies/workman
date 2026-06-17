import type { AstNode, SourceSpan } from "./source.ts";
import { prune, type Ty } from "./types.ts";
import type { DiffPath } from "./type_diff.ts";

export type EvidenceId = string;
export type DiagnosticId = EvidenceId;
export type RuleFrameId = EvidenceId;
export type PremiseId = EvidenceId;
export type ConstraintId = EvidenceId;
export type ClaimId = EvidenceId;
export type TypeSnapshotId = EvidenceId;

export type SourceAnchor =
  | { kind: "source"; span: SourceSpan }
  | { kind: "generated"; label: string };

export type RuleFrame = {
  id: RuleFrameId;
  rule: string;
  subject: string;
  anchor: SourceAnchor;
  path: string[];
};

export type Premise = {
  id: PremiseId;
  role: string;
  predicate: Predicate;
  origin: SourceAnchor;
};

export type Predicate = { kind: "equal"; left: string; right: string; domain: "type" };

export type Claim =
  | {
    kind: "has-type";
    subject: string;
    type: TypeSnapshotId;
  }
  | {
    kind: "fact";
    subject: string;
    text: string;
  };

export type Violation =
  | {
    kind: "contradicted";
    observed: { left: TypeSnapshotId; right: TypeSnapshotId };
    conflictPath: DiffPath;
    context?: string;
    origins?: { expected?: string; got?: string };
  }
  | {
    kind: "unsatisfied";
    message: string;
    related: string[];
  };

export type Failure = {
  frame: RuleFrame;
  premise: Premise;
  violation: Violation;
};

export type TypeSnapshot = {
  id: TypeSnapshotId;
  rendered: string;
  shape: TypeSnapshotShape;
};

export type TypeSnapshotShape =
  | { kind: "named-var"; id: number; name: string }
  | { kind: "anonymous-var"; id: number }
  | { kind: "ffi"; id: number; path: string }
  | { kind: "primitive"; name: string }
  | { kind: "function"; params: TypeSnapshotId[]; result: TypeSnapshotId }
  | { kind: "tuple"; items: TypeSnapshotId[] }
  | { kind: "named"; typeId: number; name: string; args: TypeSnapshotId[] };

export type SupportEntry =
  | {
    kind: "claim";
    id: ClaimId;
    claim: Claim;
    origin: SourceAnchor;
  }
  | {
    kind: "constraint";
    id: ConstraintId;
    frame: RuleFrameId;
    premise: PremiseId;
    left: TypeSnapshotId;
    right: TypeSnapshotId;
    roles: ConstraintRole[];
    origin: SourceAnchor;
  }
  | {
    kind: "substitution";
    id: EvidenceId;
    variable: TypeSnapshotId;
    target: TypeSnapshotId;
    constraint: ConstraintId;
    path: DiffPath;
  }
  | {
    kind: "collision";
    id: EvidenceId;
    constraint: ConstraintId;
    left: TypeSnapshotId;
    right: TypeSnapshotId;
    path: DiffPath;
  }
  | {
    kind: "note";
    id: EvidenceId;
    message: string;
    origin: SourceAnchor;
  };

export type SupportGraph = {
  entries: SupportEntry[];
  edges: { from: EvidenceId; to: EvidenceId; role: string }[];
  roots: EvidenceId[];
  types: TypeSnapshot[];
};

export type AuditableDiagnostic = {
  id: DiagnosticId;
  code: string;
  severity: "error" | "warning";
  primary: SourceAnchor;
  failure: Failure;
  support: SupportGraph;
  repairs: [];
  dependsOn: DiagnosticId[];
};

export type PremiseContext = {
  frame: RuleFrame;
  premise: Premise;
  roles: ConstraintRole[];
  origin: SourceAnchor;
};

export type ConstraintRole = {
  term: string;
  role: string;
  snapshot: TypeSnapshotId;
  claim?: ClaimId;
};

export type DiagnosticWriter = {
  nextId(prefix?: string): EvidenceId;
  snapshotType(type: Ty): TypeSnapshotId;
  add(entry: SupportEntry): void;
  addEdge(edge: { from: EvidenceId; to: EvidenceId; role: string }): void;
  buildSupport(roots: EvidenceId[]): SupportGraph;
};

export function createDiagnosticWriter(): DiagnosticWriter {
  let next = 0;
  const entries: SupportEntry[] = [];
  const edges: { from: EvidenceId; to: EvidenceId; role: string }[] = [];
  const types: TypeSnapshot[] = [];

  const writer: DiagnosticWriter = {
    nextId(prefix = "e") {
      next += 1;
      return `${prefix}${next}`;
    },
    snapshotType(type: Ty) {
      const id = writer.nextId("t");
      const shape = snapshotShape(type, writer);
      types.push({ id, rendered: renderShape(shape, types), shape });
      return id;
    },
    add(entry) {
      entries.push(entry);
    },
    addEdge(edge) {
      edges.push(edge);
    },
    buildSupport(roots) {
      return {
        entries: [...entries],
        edges: [...edges],
        roots,
        types: [...types],
      };
    },
  };

  return writer;
}

export function premiseContext(
  rule: string,
  role: string,
  subject: string,
  node?: AstNode,
  ids: { frame: RuleFrameId; premise: PremiseId } = { frame: "frame", premise: "premise" },
  roles: ConstraintRole[] = [],
): PremiseContext {
  const anchor = sourceAnchor(node);
  return {
    frame: {
      id: ids.frame,
      rule,
      subject,
      anchor,
      path: rule.split("."),
    },
    premise: {
      id: ids.premise,
      role,
      predicate: { kind: "equal", left: "left", right: "right", domain: "type" },
      origin: anchor,
    },
    roles,
    origin: anchor,
  };
}

export function sourceAnchor(node?: AstNode): SourceAnchor {
  return node?.span ? { kind: "source", span: node.span } : { kind: "generated", label: "unknown" };
}

function snapshotShape(type: Ty, writer: DiagnosticWriter): TypeSnapshotShape {
  const resolved = prune(type);
  switch (resolved.tag) {
    case "var":
      return resolved.name
        ? { kind: "named-var", id: resolved.id, name: resolved.name }
        : { kind: "anonymous-var", id: resolved.id };
    case "ffi":
      return { kind: "ffi", id: resolved.id, path: resolved.path.join(".") };
    case "prim":
      return { kind: "primitive", name: resolved.name };
    case "fn":
      return {
        kind: "function",
        params: resolved.params.map((param) => writer.snapshotType(param)),
        result: writer.snapshotType(resolved.result),
      };
    case "tuple":
      return { kind: "tuple", items: resolved.items.map((item) => writer.snapshotType(item)) };
    case "named":
      return {
        kind: "named",
        typeId: resolved.id,
        name: resolved.name,
        args: resolved.args.map((arg) => writer.snapshotType(arg)),
      };
  }
}

function renderShape(shape: TypeSnapshotShape, snapshots: TypeSnapshot[]): string {
  const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot.rendered]));
  const render = (id: TypeSnapshotId) => byId.get(id) ?? id;
  switch (shape.kind) {
    case "named-var":
      return shape.name;
    case "anonymous-var":
      return `'${shape.id}`;
    case "ffi":
      return `?ffi#${shape.id}:${shape.path}`;
    case "primitive":
      return shape.name;
    case "function":
      return `(${shape.params.map(render).join(", ")}) => ${render(shape.result)}`;
    case "tuple":
      return `(${shape.items.map(render).join(", ")})`;
    case "named":
      return shape.args.length ? `${shape.name}<${shape.args.map(render).join(", ")}>` : shape.name;
  }
}
