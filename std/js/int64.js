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
