import type { Ty } from "./types.ts";

export type DiffPathSegment =
  | { kind: "fn-param"; index: number }
  | { kind: "fn-result" }
  | { kind: "tuple-item"; index: number }
  | { kind: "record-field"; name: string }
  | { kind: "named-arg"; index: number; label?: string; typeName: string };

export type DiffPath = DiffPathSegment[];

export class TypeMismatchError extends Error {
  path: DiffPath;
  left: Ty;
  right: Ty;
  boundVariableId?: number;
  attemptedSide?: "left" | "right";

  constructor(
    left: Ty,
    right: Ty,
    path: DiffPath,
    boundVariableId?: number,
    attemptedSide?: "left" | "right",
  ) {
    super("type mismatch");
    this.name = "TypeMismatchError";
    this.left = left;
    this.right = right;
    this.path = path;
    this.boundVariableId = boundVariableId;
    this.attemptedSide = attemptedSide;
  }
}

export function formatPathSegment(segment: DiffPathSegment): string {
  switch (segment.kind) {
    case "fn-param":
      return `parameter ${segment.index + 1}`;
    case "fn-result":
      return "result";
    case "tuple-item":
      return `tuple item ${segment.index + 1}`;
    case "record-field":
      return `record field ${segment.name}`;
    case "named-arg":
      return segment.label
        ? `${segment.typeName} ${segment.label}`
        : `${segment.typeName} argument ${segment.index + 1}`;
  }
}
