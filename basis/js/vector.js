// Primitives of `basis/vector.wm` and `basis/vector_slice.wm`.
//
// A vector is a frozen object holding a frozen JavaScript array under a registered symbol, and a
// slice a frozen object holding `{ vector, offset, length }` under another. The compiler's runtime
// equality and printing recognize the same symbols. Index checks and `Result`s are written in
// Workman; the unchecked accessors here are only called with valid indices.

const vectorData = Symbol.for("wm.Vector.data");
const sliceData = Symbol.for("wm.VectorSlice.data");

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

const wrap = (items) => Object.freeze({ [vectorData]: Object.freeze(items) });

const itemsOf = (vector) => vector[vectorData];

export const fromArray = (items) => wrap(Array.from(items));

export const toArray = (vector) => Array.from(itemsOf(vector));

export const length = (vector) => itemsOf(vector).length;

export const uncheckedSub = (vector, index) => itemsOf(vector)[index];

export const uncheckedUpdate = (vector, index, value) => {
  const items = Array.from(itemsOf(vector));
  items[index] = value;
  return wrap(items);
};

export const tabulate = (length, generate) => {
  const items = new Array(checkedLength(length));
  for (let index = 0; index < items.length; index++) items[index] = generate(index);
  return wrap(items);
};

export const concatArray = (vectors) => {
  const items = vectors.flatMap((vector) => itemsOf(vector));
  checkedLength(items.length);
  return wrap(items);
};

export const uncheckedSlice = (vector, offset, length) =>
  Object.freeze({ [sliceData]: Object.freeze({ vector, offset, length }) });

export const sliceBase = (slice) => {
  const parts = slice[sliceData];
  return [parts.vector, parts.offset, parts.length];
};

export const sliceToVector = (slice) => {
  const { vector, offset, length } = slice[sliceData];
  const items = itemsOf(vector);
  if (offset === 0 && length === items.length) return vector;
  return wrap(items.slice(offset, offset + length));
};

export const sliceConcatArray = (slices) => {
  const items = slices.flatMap((slice) => {
    const { vector, offset, length } = slice[sliceData];
    return itemsOf(vector).slice(offset, offset + length);
  });
  checkedLength(items.length);
  return wrap(items);
};
