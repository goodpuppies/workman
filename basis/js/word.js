// Primitives of `basis/word8.wm`, `word16.wm`, `word32.wm` and `word64.wm`.
//
// Words of up to 32 bits are JavaScript numbers holding the unsigned value. 64-bit words are
// bigints. Exports are flat and prefixed with the width, because a library file is imported by
// name and can't be imported as a namespace with manual types.

const fail = (name, message) => {
  const error = new Error(message);
  error.name = name;
  throw error;
};

const shiftCount = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    return fail("Domain", "shift count must be a non-negative integer");
  }
  return value;
};

const smallWord = (bits) => {
  const normalize = bits === 32 ? (value) => value >>> 0 : (value) => value & ((1 << bits) - 1);
  const mask = bits === 32 ? 0xffffffff : (1 << bits) - 1;
  const signBit = bits === 32 ? 0x80000000 : 1 << (bits - 1);
  return {
    fromNumber: (value) =>
      Number.isSafeInteger(value)
        ? normalize(value)
        : fail("Domain", "Word" + bits + ".fromNumber expects a safe integer"),
    andb: (left, right) => normalize(left & right),
    orb: (left, right) => normalize(left | right),
    xorb: (left, right) => normalize(left ^ right),
    notb: (value) => normalize(~value),
    shiftLeft: (value, count) => {
      count = shiftCount(count);
      return count >= bits ? 0 : normalize(value << count);
    },
    shiftRight: (value, count) => {
      count = shiftCount(count);
      return count >= bits ? 0 : normalize(value >>> count);
    },
    shiftRightArithmetic: (value, count) => {
      count = shiftCount(count);
      if (count >= bits) return (value & signBit) === 0 ? 0 : normalize(mask);
      const signed = bits === 32 ? value | 0 : (value << (32 - bits)) >> (32 - bits);
      return normalize(signed >> count);
    },
    add: (left, right) => normalize(left + right),
    sub: (left, right) => normalize(left - right),
    mul: (left, right) => normalize(bits === 32 ? Math.imul(left, right) : left * right),
    div: (left, right) =>
      right === 0 ? fail("Div", "word division by zero") : normalize(Math.floor(left / right)),
    mod: (left, right) =>
      right === 0 ? fail("Div", "word remainder by zero") : normalize(left % right),
  };
};

export const {
  fromNumber: word8FromNumber,
  andb: word8Andb,
  orb: word8Orb,
  xorb: word8Xorb,
  notb: word8Notb,
  shiftLeft: word8ShiftLeft,
  shiftRight: word8ShiftRight,
  shiftRightArithmetic: word8ShiftRightArithmetic,
  add: word8Add,
  sub: word8Sub,
  mul: word8Mul,
  div: word8Div,
  mod: word8Mod,
} = smallWord(8);

export const {
  fromNumber: word16FromNumber,
  andb: word16Andb,
  orb: word16Orb,
  xorb: word16Xorb,
  notb: word16Notb,
  shiftLeft: word16ShiftLeft,
  shiftRight: word16ShiftRight,
  shiftRightArithmetic: word16ShiftRightArithmetic,
  add: word16Add,
  sub: word16Sub,
  mul: word16Mul,
  div: word16Div,
  mod: word16Mod,
} = smallWord(16);

export const {
  fromNumber: word32FromNumber,
  andb: word32Andb,
  orb: word32Orb,
  xorb: word32Xorb,
  notb: word32Notb,
  shiftLeft: word32ShiftLeft,
  shiftRight: word32ShiftRight,
  shiftRightArithmetic: word32ShiftRightArithmetic,
  add: word32Add,
  sub: word32Sub,
  mul: word32Mul,
  div: word32Div,
  mod: word32Mod,
} = smallWord(32);

/** Identity for words held as numbers: `Word8.toNumber` and friends. */
export const smallWordToNumber = (value) => value;

const mask64 = (1n << 64n) - 1n;
const normalize64 = (value) => BigInt.asUintN(64, value);

export const word64FromNumber = (value) =>
  Number.isSafeInteger(value)
    ? normalize64(BigInt(value))
    : fail("Domain", "Word64.fromNumber expects a safe integer");

export const word64ToNumber = (value) =>
  value > BigInt(Number.MAX_SAFE_INTEGER)
    ? fail("Overflow", "Word64 value is not exactly representable as Number")
    : Number(value);

export const word64Andb = (left, right) => left & right;
export const word64Orb = (left, right) => left | right;
export const word64Xorb = (left, right) => left ^ right;
export const word64Notb = (value) => normalize64(~value);

export const word64ShiftLeft = (value, count) => {
  count = shiftCount(count);
  return count >= 64 ? 0n : normalize64(value << BigInt(count));
};

export const word64ShiftRight = (value, count) => {
  count = shiftCount(count);
  return count >= 64 ? 0n : value >> BigInt(count);
};

export const word64ShiftRightArithmetic = (value, count) => {
  count = shiftCount(count);
  const signed = BigInt.asIntN(64, value);
  return count >= 64 ? (signed < 0n ? mask64 : 0n) : normalize64(signed >> BigInt(count));
};

export const word64Add = (left, right) => normalize64(left + right);
export const word64Sub = (left, right) => normalize64(left - right);
export const word64Mul = (left, right) => normalize64(left * right);
export const word64Div = (left, right) =>
  right === 0n ? fail("Div", "word division by zero") : left / right;
export const word64Mod = (left, right) =>
  right === 0n ? fail("Div", "word remainder by zero") : left % right;
