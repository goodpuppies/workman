// TypeScript/JavaScript helpers for values crossing the Workman library boundary.
//
// Option values are opaque WM values. Nullary basis constructors are shared through
// globalThis, so a None built here is the same object every compiled WM library matches.

const NONE_ID = -1;
const SOME_ID = -2;

/** The shared None, as the WM runtime prelude registers it. Keep in sync with emit_prelude.ts. */
export const None = (globalThis[Symbol.for(`workman.basis.ctor.${NONE_ID}`)] ??= Object.freeze({
  ctor: NONE_ID,
  name: "None",
}));

export function Some(value) {
  return { ctor: SOME_ID, name: "Some", a0: value };
}

function checked(option) {
  if (option === None || option?.ctor === SOME_ID) return option;
  throw new TypeError("Expected a Workman Option");
}

export function isSome(option) {
  return checked(option) !== None;
}

export function isNone(option) {
  return checked(option) === None;
}

export function getOr(option, fallback) {
  return checked(option) === None ? fallback : option.a0;
}

export function match(option, cases) {
  return checked(option) === None ? cases.none() : cases.some(option.a0);
}

export function fromNullable(value) {
  return value == null ? None : Some(value);
}

export function toNullable(option) {
  return checked(option) === None ? undefined : option.a0;
}

export function Ok(value) {
  return { ok: true, value };
}

export function Err(error) {
  return { ok: false, error };
}
