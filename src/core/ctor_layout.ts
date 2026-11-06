import type { TypeExpr } from "../ast.ts";

/**
 * Runtime layout of a datatype value: one object per value, `{ ctor, name, a0, a1, ... }`.
 *
 * A constructor whose declared payload is a tuple (`Cons of 'a * 'a list`) stores the tuple's
 * items directly in `a0..a(n-1)`, so building or matching it allocates no payload array.
 * Any other payload is stored whole in `a0`; a nullary constructor has no fields. The count
 * follows from the declaration alone, so every module that sees the declaration agrees on it,
 * and code that does not know the count rebuilds the payload with `__wm_ctor_payload`.
 */
export function ctorFieldCount(payload: TypeExpr | undefined): number {
  if (!payload) return 0;
  return payload.kind === "TTuple" && payload.items.length >= 2 ? payload.items.length : 1;
}

/** Field count of a basis constructor, whose payload is listed as its items. */
export function basisCtorFieldCount(args: readonly TypeExpr[]): number {
  return args.length;
}

export function ctorField(index: number): string {
  return `a${index}`;
}

/** An object literal for a value of this constructor, from JS expressions for its fields. */
export function emitCtorValue(ctorId: number | string, name: string, fields: readonly string[]): string {
  const parts = [`ctor: ${JSON.stringify(ctorId)}`, `name: ${JSON.stringify(name)}`];
  fields.forEach((field, index) => parts.push(`${ctorField(index)}: ${field}`));
  return `{ ${parts.join(", ")} }`;
}

/** The constructor as a first-class JS value: a function of its payload, or a frozen singleton. */
export function emitCtorBinding(
  jsName: string,
  ctorId: number | string,
  name: string,
  fieldCount: number,
): string {
  if (fieldCount === 0) return `const ${jsName} = Object.freeze(${emitCtorValue(ctorId, name, [])});`;
  const fields = fieldCount === 1
    ? ["__payload"]
    : Array.from({ length: fieldCount }, (_, index) => `__payload[${index}]`);
  return `const ${jsName} = (__payload) => (${emitCtorValue(ctorId, name, fields)});`;
}

/** JS for the payload as one value, rebuilding a spread tuple. */
export function emitCtorPayload(value: string, fieldCount: number | undefined): string {
  if (fieldCount === undefined) return `__wm_ctor_payload(${value})`;
  if (fieldCount === 1) return `${value}.${ctorField(0)}`;
  return `[${
    Array.from({ length: fieldCount }, (_, index) => `${value}.${ctorField(index)}`).join(", ")
  }]`;
}
