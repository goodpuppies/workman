type UnknownRecord = Record<string, unknown>;

/** A WM datatype value: `{ ctor, name, a0, a1, ... }`, see `core/ctor_layout.ts`. */
export type WmVariant = Readonly<{
  name: string;
  a0?: unknown;
  a1?: unknown;
  [field: `a${number}`]: unknown;
}>;

export type FrontendV2SurfaceProgram = Readonly<{
  root: WmVariant;
  marks: readonly FrontendV2SurfaceRecoveryMark[];
}>;

export type FrontendV2SurfaceRecoveryMark = Readonly<{
  id: number;
  anchor: number;
  expectedText: string;
  rule: string;
  repairClass: "autoFix" | "recoveryOnly";
}>;

export type FrontendV2SurfaceParseFailure = Readonly<{
  offset: number;
  expected: string;
  rule: string;
}>;

export type FrontendV2Surface = Readonly<{
  parseSurfaceProgram(source: string): FrontendV2SurfaceProgram | undefined;
  parseSurfaceFailure(source: string): FrontendV2SurfaceParseFailure | undefined;
}>;

/**
 * Load the generated parser's native Surface AST boundary.
 *
 * This intentionally consumes constructor names rather than generated constructor
 * numbers. Names are stable grammar-facing data; numbers are an implementation
 * detail of the Workman JavaScript emitter.
 */
export async function loadFrontendV2Surface(
  moduleUrl: URL | string,
): Promise<FrontendV2Surface> {
  const specifier = moduleUrl instanceof URL ? moduleUrl.href : moduleUrl;
  const imported: UnknownRecord = await import(specifier);
  if (typeof imported.parseSurfaceProgram !== "function") {
    throw new Error("frontend-v2 module does not export parseSurfaceProgram");
  }
  if (typeof imported.parseSurfaceFailure !== "function") {
    throw new Error("frontend-v2 module does not export parseSurfaceFailure");
  }
  const parse = imported.parseSurfaceProgram as (source: string) => unknown;
  const parseFailure = imported.parseSurfaceFailure as (source: string) => unknown;
  return {
    parseSurfaceProgram(source: string): FrontendV2SurfaceProgram | undefined {
      return decodeSurfaceProgram(parse(source));
    },
    parseSurfaceFailure(source: string): FrontendV2SurfaceParseFailure | undefined {
      return decodeSurfaceFailure(parseFailure(source));
    },
  };
}

export function decodeSurfaceProgram(value: unknown): FrontendV2SurfaceProgram | undefined {
  return validateSurfaceProgramOption(value);
}

export function decodeSurfaceFailure(value: unknown): FrontendV2SurfaceParseFailure | undefined {
  const unwrapped = option(value);
  if (unwrapped === undefined) return undefined;
  const failure = record(unwrapped, "CompiledParseFailure");
  if (
    typeof failure.offset !== "number" ||
    typeof failure.expected !== "string" ||
    typeof failure.rule !== "string"
  ) {
    throw new Error("frontend-v2 CompiledParseFailure has an invalid shape");
  }
  return Object.freeze({
    offset: failure.offset,
    expected: failure.expected,
    rule: failure.rule,
  });
}

export function variant(value: unknown, expected?: string): WmVariant {
  if (
    !isRecord(value) ||
    typeof value.name !== "string"
  ) {
    throw new Error(`frontend-v2 expected${expected ? ` ${expected}` : ""} constructor`);
  }
  if (expected && value.name !== expected) {
    throw new Error(`frontend-v2 expected ${expected}, got ${value.name}`);
  }
  return value as WmVariant;
}

/** Whether the constructor value carries a payload. */
export function hasPayload(constructor: WmVariant): boolean {
  return "a0" in constructor;
}

/** The constructor's payload as one value; a spread tuple payload comes back as an array. */
export function payload(constructor: WmVariant): unknown {
  if (!("a1" in constructor)) return constructor.a0;
  const items: unknown[] = [];
  for (let index = 0; `a${index}` in constructor; index++) items.push(constructor[`a${index}`]);
  return items;
}

export function fields(value: unknown, expected?: string): readonly unknown[] {
  const constructor = variant(value, expected);
  const items = payload(constructor);
  if (!hasPayload(constructor) || !Array.isArray(items)) {
    throw new Error(`frontend-v2 ${constructor.name} has an invalid product payload`);
  }
  return items;
}

export function option(value: unknown): unknown | undefined {
  const constructor = variant(value);
  if (constructor.name === "None" && !hasPayload(constructor)) return undefined;
  if (constructor.name === "Some" && hasPayload(constructor)) return payload(constructor);
  throw new Error(`frontend-v2 expected Option, got ${constructor.name}`);
}

export function list(value: unknown): readonly unknown[] {
  const output: unknown[] = [];
  let current = value;
  while (true) {
    const constructor = variant(current);
    if (constructor.name === "Nil" && !hasPayload(constructor)) return output;
    if (constructor.name !== "Cons") {
      throw new Error(`frontend-v2 expected List, got ${constructor.name}`);
    }
    output.push(constructor.a0);
    current = constructor.a1;
  }
}

export function record(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) throw new Error(`frontend-v2 expected ${label} record`);
  return value;
}

function validateSurfaceProgramOption(value: unknown): FrontendV2SurfaceProgram | undefined {
  const unwrapped = option(value);
  if (unwrapped === undefined) return undefined;
  const program = record(unwrapped, "SurfaceProgram");
  const root = variant(program.root, "ProgramNode");
  const marks = list(program.marks).map((mark): FrontendV2SurfaceRecoveryMark => {
    const recovery = record(mark, "RecoveryMark");
    if (
      typeof recovery.id !== "number" ||
      typeof recovery.anchor !== "number" ||
      typeof recovery.expectedText !== "string" ||
      typeof recovery.rule !== "string"
    ) {
      throw new Error("frontend-v2 RecoveryMark has an invalid shape");
    }
    const repairClass = variant(recovery.repairClass).name;
    if (repairClass !== "AutoFix" && repairClass !== "RecoveryOnly") {
      throw new Error("frontend-v2 RecoveryMark has an invalid repair class");
    }
    return Object.freeze({
      id: recovery.id,
      anchor: recovery.anchor,
      expectedText: recovery.expectedText,
      rule: recovery.rule,
      repairClass: repairClass === "AutoFix" ? "autoFix" : "recoveryOnly",
    });
  });
  return Object.freeze({ root, marks: Object.freeze(marks) });
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
