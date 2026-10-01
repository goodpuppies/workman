// Primitives of `basis/real.wm` that need the bits of a double: the sign of zero and NaN, the
// exponent, and the neighbouring representable value.

const view = new DataView(new ArrayBuffer(8));

/** True when the sign bit is set, including for -0 and negative NaN. */
export const signBit = (value) => {
  view.setFloat64(0, value);
  return (view.getUint8(0) & 0x80) !== 0;
};

/** `value` with the sign of `sign`, even when `sign` is NaN. */
export const copySign = (value, sign) => {
  view.setFloat64(0, sign);
  const negative = (view.getUint8(0) & 0x80) !== 0;
  view.setFloat64(0, value);
  const high = view.getUint8(0);
  view.setUint8(0, negative ? high | 0x80 : high & 0x7f);
  return view.getFloat64(0);
};

/** `[man, exp]` with `value = man * 2^exp` and `0.5 <= |man| < 1`, as C's `frexp`. */
export const toManExp = (value) => {
  if (value === 0 || !Number.isFinite(value)) return [value, 0];
  let exponent = Math.max(-1023, Math.floor(Math.log2(Math.abs(value))) + 1);
  let mantissa = value * 2 ** -exponent;
  // Correct the estimate, and scale subnormals, until the mantissa is in range.
  while (Math.abs(mantissa) < 0.5) {
    mantissa *= 2;
    exponent -= 1;
  }
  while (Math.abs(mantissa) >= 1) {
    mantissa /= 2;
    exponent += 1;
  }
  return [mantissa, exponent];
};

/** `man * 2^exp`, as C's `ldexp`, scaling in steps so intermediate powers don't overflow. */
export const fromManExp = (mantissa, exponent) => {
  let result = mantissa;
  let remaining = exponent;
  while (remaining > 1000) {
    result *= 2 ** 1000;
    remaining -= 1000;
  }
  while (remaining < -1000) {
    result *= 2 ** -1000;
    remaining += 1000;
  }
  return result * 2 ** remaining;
};

export const nextAfter = (value, target) => {
  if (Number.isNaN(value) || Number.isNaN(target)) return NaN;
  if (value === target) return value;
  if (!Number.isFinite(value)) return value;
  if (value === 0) return target > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const away = (target > value) === (value > 0);
  view.setBigUint64(0, away ? bits + 1n : bits - 1n);
  return view.getFloat64(0);
};

export const isNormal = (value) =>
  Number.isFinite(value) && Math.abs(value) >= 2.2250738585072014e-308;

/** Round to the nearest integer, ties to even. */
export const roundHalfEven = (value) => {
  if (!Number.isFinite(value)) return value;
  const floor = Math.floor(value);
  const difference = value - floor;
  if (difference < 0.5) return floor;
  if (difference > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
};
