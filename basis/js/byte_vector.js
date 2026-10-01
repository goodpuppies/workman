// Primitives of the byte structures in `basis/`: `Word8Vector`, `Word8VectorSlice`, the
// `PackWord*` and `PackReal*` structures, and `Byte`.
//
// A vector is a frozen object holding a `Uint8Array` under a registered symbol, and a slice a
// frozen object holding `{ vector, offset, length }` under another. The compiler's runtime equality
// and printing recognize the same symbols, which is the whole representation contract between this
// file and the compiler. Library files are inlined as `data:` modules and can't import each other,
// so everything that touches the representation lives in this one file.

const vectorData = Symbol.for("wm.Word8Vector.data");
const sliceData = Symbol.for("wm.Word8VectorSlice.data");

const fail = (name, message) => {
  const error = new Error(message);
  error.name = name;
  throw error;
};

const checkedLength = (length) => {
  if (!Number.isSafeInteger(length) || length < 0 || length > 0xffffffff) {
    return fail("Size", "length must be an integer between 0 and 4294967295");
  }
  return length;
};

// Word8Vector

const wrap = (bytes) => Object.freeze({ [vectorData]: bytes });

const bytesOf = (vector) => {
  const bytes = vector?.[vectorData];
  if (!(bytes instanceof Uint8Array)) return fail("TypeError", "expected Word8Vector.Vector");
  return bytes;
};

const checkedIndex = (length, index, structure) => {
  if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
    return fail("Subscript", structure + " index out of bounds");
  }
  return index;
};

export const empty = wrap(new Uint8Array(0));

const vectorOf = (bytes) => bytes.length === 0 ? empty : wrap(bytes);

export const fromArray = (items) => vectorOf(Uint8Array.from(items));

export const toArray = (vector) => Array.from(bytesOf(vector));

export const length = (vector) => bytesOf(vector).length;

export const sub = (vector, index) => {
  const bytes = bytesOf(vector);
  return bytes[checkedIndex(bytes.length, index, "Word8Vector")];
};

export const update = (vector, index, value) => {
  const bytes = bytesOf(vector).slice();
  bytes[checkedIndex(bytes.length, index, "Word8Vector")] = value;
  return wrap(bytes);
};

export const concatArray = (vectors) => {
  const parts = vectors.map(bytesOf);
  const output = new Uint8Array(checkedLength(parts.reduce((sum, part) => sum + part.length, 0)));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return vectorOf(output);
};

export const tabulate = (length, generate) => {
  const output = new Uint8Array(checkedLength(length));
  for (let index = 0; index < output.length; index++) output[index] = generate(index);
  return vectorOf(output);
};

export const unfoldN = (length, initial, step) => {
  const output = new Uint8Array(checkedLength(length));
  let state = initial;
  for (let index = 0; index < output.length; index++) {
    const [item, next] = step(state);
    output[index] = item;
    state = next;
  }
  return [vectorOf(output), state];
};

// Word8VectorSlice

const sliceOf = (vector, offset, length) =>
  Object.freeze({ [sliceData]: Object.freeze({ vector, offset, length }) });

const partsOf = (slice) => {
  const parts = slice?.[sliceData];
  if (parts === undefined) return fail("TypeError", "expected Word8VectorSlice.Slice");
  return parts;
};

const checkedRange = (available, start, length) => {
  if (!Number.isSafeInteger(start) || start < 0 || start > available) {
    return fail("Subscript", "Word8VectorSlice start out of bounds");
  }
  if (!Number.isSafeInteger(length) || length < 0 || length > available - start) {
    return fail("Subscript", "Word8VectorSlice length out of bounds");
  }
};

const sliceBytes = (parts) =>
  bytesOf(parts.vector).subarray(parts.offset, parts.offset + parts.length);

export const sliceFull = (vector) => sliceOf(vector, 0, bytesOf(vector).length);

// The range checks test `start` before `length`, so a caller asking for "the rest" can pass
// `available - start` and still get the start error for an out-of-range start.

export const sliceVector = (vector, start, length) => {
  checkedRange(bytesOf(vector).length, start, length);
  return sliceOf(vector, start, length);
};

export const sliceSubslice = (slice, start, length) => {
  const parts = partsOf(slice);
  checkedRange(parts.length, start, length);
  return sliceOf(parts.vector, parts.offset + start, length);
};

export const sliceBase = (slice) => {
  const parts = partsOf(slice);
  return [parts.vector, parts.offset, parts.length];
};

export const sliceLength = (slice) => partsOf(slice).length;

export const sliceSub = (slice, index) => {
  const parts = partsOf(slice);
  return bytesOf(parts.vector)[parts.offset + checkedIndex(parts.length, index, "Word8Vector")];
};

export const sliceToVector = (slice) => {
  const parts = partsOf(slice);
  const bytes = bytesOf(parts.vector);
  if (parts.offset === 0 && parts.length === bytes.length) return parts.vector;
  return vectorOf(bytes.slice(parts.offset, parts.offset + parts.length));
};

export const sliceConcatArray = (slices) => {
  const parts = slices.map((slice) => sliceBytes(partsOf(slice)));
  const output = new Uint8Array(checkedLength(parts.reduce((sum, part) => sum + part.length, 0)));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return vectorOf(output);
};

// PackWord*, PackReal*
//
// `width` is the element size in bytes. Words of up to 32 bits are numbers and 64-bit words are
// bigints, matching `basis/js/word.js`.

const packLocation = (bytes, index, width) => {
  if (!Number.isSafeInteger(index) || index < 0) {
    return fail("Subscript", "PackWord element index out of bounds");
  }
  const offset = index * width;
  if (!Number.isSafeInteger(offset) || offset + width > bytes.length) {
    return fail("Subscript", "PackWord element index out of bounds");
  }
  return new DataView(bytes.buffer, bytes.byteOffset + offset, width);
};

const read = (view, kind, bigEndian) => {
  const little = !bigEndian;
  switch (kind) {
    case "word16":
      return view.getUint16(0, little);
    case "word32":
      return view.getUint32(0, little);
    case "word64":
      return view.getBigUint64(0, little);
    case "real32":
      return view.getFloat32(0, little);
    default:
      return view.getFloat64(0, little);
  }
};

const widths = { word16: 2, word32: 4, word64: 8, real32: 4, real64: 8 };

export const packSubVec = (kind, bigEndian, vector, index) =>
  read(packLocation(bytesOf(vector), index, widths[kind]), kind, bigEndian);

export const packSubSlice = (kind, bigEndian, slice, index) =>
  read(packLocation(sliceBytes(partsOf(slice)), index, widths[kind]), kind, bigEndian);

export const pack = (kind, bigEndian, value) => {
  const bytes = new Uint8Array(widths[kind]);
  const view = new DataView(bytes.buffer);
  const little = !bigEndian;
  switch (kind) {
    case "word16":
      view.setUint16(0, value, little);
      break;
    case "word32":
      view.setUint32(0, value, little);
      break;
    case "word64":
      view.setBigUint64(0, value, little);
      break;
    case "real32":
      view.setFloat32(0, value, little);
      break;
    default:
      view.setFloat64(0, value, little);
  }
  return wrap(bytes);
};

// Byte

export const bytesToString = (vector) => {
  const bytes = bytesOf(vector);
  const chunks = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return chunks.join("");
};

export const stringToBytes = (value) => {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code > 255) {
      return fail("Domain", "Byte.stringToBytes requires characters in the byte range");
    }
    bytes[index] = code;
  }
  return vectorOf(bytes);
};
