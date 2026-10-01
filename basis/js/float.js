// Primitives of `basis/float32.wm` and `float64.wm`. A `Float32.Real` is a number rounded to single
// precision after every operation; a `Float64.Real` is a plain number.

export const float32Round = (value) => Math.fround(value);
export const float32Add = (left, right) => Math.fround(left + right);
export const float32Sub = (left, right) => Math.fround(left - right);
export const float32Mul = (left, right) => Math.fround(left * right);
export const float32Div = (left, right) => Math.fround(left / right);
export const float32Neg = (value) => Math.fround(-value);

export const float64Identity = (value) => value;
export const float64Add = (left, right) => left + right;
export const float64Sub = (left, right) => left - right;
export const float64Mul = (left, right) => left * right;
export const float64Div = (left, right) => left / right;
export const float64Neg = (value) => -value;
