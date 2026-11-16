// Primitives of `std/real32.wm`. A `Real32.Real` is a number rounded to single
// precision after every operation.

export const float32Round = (value) => Math.fround(value);
export const float32Add = (left, right) => Math.fround(left + right);
export const float32Sub = (left, right) => Math.fround(left - right);
export const float32Mul = (left, right) => Math.fround(left * right);
export const float32Div = (left, right) => Math.fround(left / right);
export const float32Neg = (value) => Math.fround(-value);

