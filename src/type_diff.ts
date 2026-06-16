import type { Ty } from "./types.ts";

export type DiffPathSegment =
  | { kind: "fn-param"; index: number }
  | { kind: "fn-result" }
  | { kind: "tuple-item"; index: number }
  | { kind: "named-arg"; index: number; label?: string; typeName: string };

export type DiffPath = DiffPathSegment[];

type TypeDiff = {
  path: DiffPath;
  expected: Ty;
  actual: Ty;
  reason?: string;
};

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
    super(typeMismatchMessage(left, right));
    this.name = "TypeMismatchError";
    this.left = left;
    this.right = right;
    this.path = path;
    this.boundVariableId = boundVariableId;
    this.attemptedSide = attemptedSide;
  }
}

export function typeMismatchMessage(left: Ty, right: Ty): string {
  const names = new Map<number, string>();
  const diff = firstTypeDiff(left, right);
  const expected = quoteTypeWithNames(left, names);
  const actual = quoteTypeWithNames(right, names);
  if (!diff) return `type mismatch expected ${expected}, got ${actual}`;
  return [
    "type mismatch",
    `  at ${formatPath(diff.path)}:`,
    formatDiffSide("expected", showWithNames(diff.expected, names)),
    formatDiffSide("got", showWithNames(diff.actual, names)),
    diff.reason ? `    note:     ${diff.reason}` : undefined,
    `  full expected: ${expected}`,
    `  full got:      ${actual}`,
  ].filter((line): line is string => !!line).join("\n");
}

function formatDiffSide(label: "expected" | "got", type: string) {
  const padding = label === "got" ? "      " : " ";
  return `    ${label}:${padding}${type}`;
}

function firstTypeDiff(expected: Ty, actual: Ty, path: DiffPath = []): TypeDiff | undefined {
  const left = pruneLocal(expected);
  const right = pruneLocal(actual);
  if (left === right) return undefined;
  if (left.tag !== right.tag) {
    return { path, expected: left, actual: right, reason: "different type forms" };
  }
  switch (left.tag) {
    case "prim": {
      if (right.tag !== "prim") return { path, expected: left, actual: right };
      return left.name === right.name ? undefined : { path, expected: left, actual: right };
    }
    case "var": {
      if (right.tag !== "var") return { path, expected: left, actual: right };
      return left.id === right.id ? undefined : { path, expected: left, actual: right };
    }
    case "ffi": {
      if (right.tag !== "ffi") return { path, expected: left, actual: right };
      return left.id === right.id ? undefined : { path, expected: left, actual: right };
    }
    case "fn": {
      if (right.tag !== "fn") return { path, expected: left, actual: right };
      if (left.params.length !== right.params.length) {
        return { path, expected: left, actual: right, reason: "different parameter counts" };
      }
      for (const [index, param] of left.params.entries()) {
        const diff = firstTypeDiff(param, right.params[index], [
          ...path,
          { kind: "fn-param", index },
        ]);
        if (diff) return diff;
      }
      return firstTypeDiff(left.result, right.result, [...path, { kind: "fn-result" }]);
    }
    case "tuple": {
      if (right.tag !== "tuple") return { path, expected: left, actual: right };
      if (left.items.length !== right.items.length) {
        return { path, expected: left, actual: right, reason: "different tuple sizes" };
      }
      for (const [index, item] of left.items.entries()) {
        const diff = firstTypeDiff(item, right.items[index], [
          ...path,
          { kind: "tuple-item", index },
        ]);
        if (diff) return diff;
      }
      return undefined;
    }
    case "named": {
      if (right.tag !== "named") return { path, expected: left, actual: right };
      if (left.id !== right.id || left.name !== right.name) {
        return { path, expected: left, actual: right };
      }
      if (left.args.length !== right.args.length) {
        return { path, expected: left, actual: right, reason: "different type argument counts" };
      }
      for (const [index, arg] of left.args.entries()) {
        const label = left.argLabels?.[index] ?? right.argLabels?.[index];
        const diff = firstTypeDiff(arg, right.args[index], [
          ...path,
          { kind: "named-arg", index, label, typeName: left.name },
        ]);
        if (diff) return diff;
      }
      return undefined;
    }
  }
}

function pruneLocal(type: Ty): Ty {
  if ((type.tag === "var" || type.tag === "ffi") && type.instance) {
    return pruneLocal(type.instance);
  }
  return type;
}

function formatPath(path: DiffPath): string {
  return path.length ? path.map(formatPathSegment).join(" -> ") : "type";
}

export function formatPathSegment(segment: DiffPathSegment): string {
  switch (segment.kind) {
    case "fn-param":
      return `parameter ${segment.index + 1}`;
    case "fn-result":
      return "result";
    case "tuple-item":
      return `tuple item ${segment.index + 1}`;
    case "named-arg":
      return segment.label
        ? `${segment.typeName} ${segment.label}`
        : `${segment.typeName} argument ${segment.index + 1}`;
  }
}

function quoteTypeWithNames(type: Ty, names: Map<number, string>): string {
  return `"${showWithNames(type, names)}"`;
}

function showWithNames(type: Ty, names: Map<number, string>): string {
  let nextName = names.size;
  const nameOf = (id: number) => {
    const existing = names.get(id);
    if (existing) return existing;
    const created = `'${String.fromCharCode(97 + nextName++)}`;
    names.set(id, created);
    return created;
  };
  const go = (input: Ty): string => {
    const item = pruneLocal(input);
    if (item.tag === "var") return item.name ?? nameOf(item.id);
    if (item.tag === "ffi") return `?ffi#${item.id}:${item.path.join(".")}`;
    if (item.tag === "prim") return item.name;
    if (item.tag === "tuple") return `(${item.items.map(go).join(", ")})`;
    if (item.tag === "fn") return `(${item.params.map(go).join(", ")}) => ${go(item.result)}`;
    return item.args.length ? `${item.name}<${item.args.map(go).join(", ")}>` : item.name;
  };
  return go(type);
}
