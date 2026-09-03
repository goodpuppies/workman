// Uses the real Deno.PointerValue the way binding-generator CString aliases
// do (for example raylib's CStringLike): nullability hides inside the
// pointer member, so the outer union never shows a direct null. Workman must
// still read this as a nullable string.
export type CStringPointer = Deno.PointerValue<number>;
export type CStringLike = string | CStringPointer;

// Same shape with only local declarations, in case Deno globals do not
// resolve for fixture files.
export interface LocalPointerObject<T> {
  readonly __pointerBrand: T;
}
export type LocalCStringPointer = number | LocalPointerObject<number> | null;
export type LocalCStringLike = string | LocalCStringPointer;

let lastVs: unknown = "unset";

export function loadShader(vsCode: CStringLike, fsCode: CStringLike): boolean {
  lastVs = vsCode;
  return typeof fsCode === "string" ? fsCode.length > 0 : true;
}

export function loadLocalShader(vsCode: LocalCStringLike, fsCode: LocalCStringLike): boolean {
  lastVs = vsCode;
  return typeof fsCode === "string" ? fsCode.length > 0 : true;
}

export function wasNull(): boolean {
  return lastVs === null;
}

export function wasUndefined(): boolean {
  return lastVs === undefined;
}
