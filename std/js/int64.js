const checked = (value) => {
  if (value < -(1n << 63n) || value >= (1n << 63n)) {
    throw new RangeError("signed 64-bit integer out of range");
  }
  return value;
};
export const fromNumber = (value) => {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("Int64.fromNumber requires an exact integer");
  }
  return checked(BigInt(value));
};
export const toNumber = (value) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Int64 value is not exactly representable as Number");
  }
  return result;
};
export const fromString = (value) => checked(BigInt(value));
export const toString = (value) => value.toString();
const fail = (name, message) => {
  const error = new Error(message);
  error.name = name;
  throw error;
};
// SML's `div` and `mod` floor: the remainder takes the divisor's sign.
export const div = (left, right) => {
  if (right === 0n) return fail("Div", "Int64 division by zero");
  const quotient = left / right;
  return checked((left % right !== 0n) && ((left < 0n) !== (right < 0n)) ? quotient - 1n : quotient);
};
export const mod = (left, right) => {
  if (right === 0n) return fail("Div", "Int64 remainder by zero");
  const remainder = left % right;
  return (remainder !== 0n) && ((remainder < 0n) !== (right < 0n)) ? remainder + right : remainder;
};
