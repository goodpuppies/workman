// Thin Deno adapters over raw addresses. Native allocations are freed by C's
// matching free function, never by this module. Bounds remain the caller's job.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
// Deno retains the source of UnsafePointer.of, but not an offset's base pointer.
const bases = new WeakMap();
export const cast = (pointer) => pointer;
export const equals = (left, right) => Deno.UnsafePointer.equals(left, right);
export const offset = (pointer, bytes) => {
  const result = Deno.UnsafePointer.offset(pointer, bytes);
  if (result !== null && result !== pointer) bases.set(result, pointer);
  return result;
};
export const fromString = (text) => Deno.UnsafePointer.of(encoder.encode(text + "\0"));
export const toString = (pointer) => new Deno.UnsafePointerView(pointer).getCString();
export const byteLength = (text) => encoder.encode(text).length;
const view = (pointer, start, size) =>
  new DataView(new Deno.UnsafePointerView(pointer).getArrayBuffer(size, start));
export const readUtf8 = (pointer, length) =>
  decoder.decode(new Uint8Array(view(pointer, 0, length).buffer));
export const writeUtf8 = (pointer, start, text) => {
  const bytes = encoder.encode(text);
  new Uint8Array(view(pointer, start, bytes.length).buffer).set(bytes);
  return bytes.length;
};
export const getU8 = (pointer, start) => new Deno.UnsafePointerView(pointer).getUint8(start);
export const setU8 = (pointer, start, value) => view(pointer, start, 1).setUint8(0, value);
export const getU32 = (pointer, start) => new Deno.UnsafePointerView(pointer).getUint32(start);
export const getI32 = (pointer, start) => new Deno.UnsafePointerView(pointer).getInt32(start);
export const setU32 = (pointer, start, value) =>
  view(pointer, start, 4).setUint32(0, value, littleEndian);
export const setI32 = (pointer, start, value) =>
  view(pointer, start, 4).setInt32(0, value, littleEndian);
export const withCleanup = (body, cleanup) => {
  try {
    return body();
  } finally {
    cleanup();
  }
};
