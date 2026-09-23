import { basisCtorId, basisCtorJsName, basisTypes } from "../basis.ts";
import {
  BASIS_OPERATORS,
  BASIS_UNARY_OPERATORS,
  type BasisOperatorDescriptor,
} from "../basis_manifest.ts";

export function emitRuntimePrelude(): string[] {
  return [
    '"use strict";',
    // The tag marks Js.Array, not tuples. Tagging every tuple forced V8 to
    // allocate a properties backing store alongside each one, which measured as
    // ~9% of parse time; Js.Array values are far rarer and only cross the FFI
    // boundary. A missing-symbol load is nearly free because V8 caches the
    // negative lookup on the array's map, so the check stays cheap.
    "const __wm_js_array_tag = Symbol('wm.jsArray');",
    "const __wm_word8_vector_data = Symbol('wm.Word8Vector.data');",
    "const __wm_word8_vector_slice_data = Symbol('wm.Word8VectorSlice.data');",
    "const __wm_is_tuple = (value) => globalThis.Array.isArray(value) && value[__wm_js_array_tag] !== true;",
    `const __wm_js_array_mark = (value) => {
  if (globalThis.Array.isArray(value) && value[__wm_js_array_tag] !== true) {
    // Defined rather than assigned so the mark is non-enumerable and stays
    // invisible to structural comparison of arrays handed back to JavaScript.
    // A foreign array may be frozen or sealed; an unmarked one is only ever
    // mistaken for a tuple, so failing to mark is not worth throwing over.
    try {
      globalThis.Object.defineProperty(value, __wm_js_array_tag, { value: true });
    } catch {
      // ignore
    }
  }
  return value;
};`,
    `const __wm_js_global = (path) => path.split(".").reduce((value, key) => value?.[key], globalThis);`,
    `const __wm_js_should_bind = (value) =>
  typeof value === "function" && !/^class\\s/.test(Function.prototype.toString.call(value));`,
    `const __wm_js_member = (path) => {
  const parts = path.split(".");
  const key = parts.pop();
  const owner = parts.length === 0 ? globalThis : __wm_js_global(parts.join("."));
  const value = owner?.[key];
  return __wm_js_should_bind(value) ? value.bind(owner) : __wm_js_array_mark(value);
};`,
    `const __wm_js_member_obj = (owner, key) => {
  const value = owner?.[key];
  return globalThis.Array.isArray(value) ? __wm_js_array_mark(value) : value;
};`,
    `const __wm_js_receiver_member = (path) => {
  // The path is fixed when the binding is created, so resolve it once here
  // instead of slicing and reducing on every call.
  const key = path[path.length - 1];
  if (path.length === 1) {
    return (receiver, ...args) => {
      const value = receiver?.[key];
      if (typeof value === "function") return value.apply(receiver, args);
      return globalThis.Array.isArray(value) ? __wm_js_array_mark(value) : value;
    };
  }
  const ownerPath = path.slice(0, -1);
  return (receiver, ...args) => {
    let owner = receiver;
    for (let index = 0; index < ownerPath.length; index++) owner = owner?.[ownerPath[index]];
    const value = owner?.[key];
    if (typeof value === "function") return value.apply(owner, args);
    return globalThis.Array.isArray(value) ? __wm_js_array_mark(value) : value;
  };
};`,
    `const __wm_js_construct = (path) => (...args) => new (__wm_js_global(path))(...args);`,
    `const __wm_js_call = (fn, arg) => __wm_is_tuple(arg) ? fn(...arg) : fn(arg);`,
    `const __wm_js_option_wrap = (value) => value == null ? __wm_basis_None : __wm_basis_Some(value);`,
    `const __wm_js_option_unwrap = (value) => value?.ctor === -1 ? null : value?.ctor === -2 ? value.args[0] : value;`,
    `const __wm_c_text_encoder = new globalThis.TextEncoder();
const __wm_c_string_to_cstr = (value) => {
  const bytes = __wm_c_text_encoder.encode(String(value) + "\\0");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  __wm_c_cstr_cache[__wm_c_cstr_index] = buffer;
  __wm_c_cstr_index = (__wm_c_cstr_index + 1) % 256;
  return globalThis.Deno.UnsafePointer.of(buffer);
};
const __wm_c_cstr_cache = new globalThis.Array(256);
let __wm_c_cstr_index = 0;
const __wm_c_codecs = {};
const __wm_c_keepalive = [];
const __wm_c_byte_type_url = "file:///home/ellie/git/byte_type_C/mod.ts";
let __wm_c_byte_type_promise;
const __wm_c_bt_async = () => {
  __wm_c_byte_type_promise ??= import(__wm_c_byte_type_url);
  return __wm_c_byte_type_promise;
};
const __wm_c_setup_codec = async (descriptor) => {
  const bt = await __wm_c_bt_async();
  const fields = {};
  for (const field of descriptor.fields) fields[field.name] = bt[field.codec];
  const codec = bt.createSizedStruct(fields);
  __wm_c_codecs[descriptor.name] = {
    codec,
    size: descriptor.size,
    fieldNames: descriptor.fields.map((field) => field.name),
  };
};
const __wm_c_struct_new = (name, args) => {
  const entry = __wm_c_codecs[name];
  if (args.length === 1 && globalThis.Array.isArray(args[0]) && entry.fieldNames.length > 1) {
    args = args[0];
  }
  const value = {};
  entry.fieldNames.forEach((field, index) => { value[field] = args[index]; });
  const buffer = new ArrayBuffer(entry.size);
  entry.codec.write(value, new DataView(buffer));
  __wm_c_keepalive.push(buffer);
  return globalThis.Deno.UnsafePointer.of(buffer);
};
const __wm_c_struct_get = (name, pointer, field) => {
  const entry = __wm_c_codecs[name];
  const view = new globalThis.Deno.UnsafePointerView(pointer);
  const dataView = new DataView(view.getArrayBuffer(entry.size));
  return entry.codec.read(dataView)[field];
};
const __wm_c_call = (symbol, args, converters, resultConverter) => {
  if (args.length === 1 && globalThis.Array.isArray(args[0]) && converters.length > 1) {
    args = args[0];
  }
  const converted = args.map((arg, index) => {
    const converter = converters[index];
    switch (converter) {
      case "string-to-cstr": return __wm_c_string_to_cstr(arg);
      case "option-string-to-cstr": {
        const unwrapped = __wm_js_option_unwrap(arg);
        return unwrapped === null ? null : __wm_c_string_to_cstr(unwrapped);
      }
      case "option-unwrap": return __wm_js_option_unwrap(arg);
      case "number-to-bigint": return globalThis.BigInt(globalThis.Math.trunc(arg));
      default: {
        if (typeof converter === "object" && converter.kind === "struct-by-value") {
          return __wm_c_struct_to_buffer(converter.name, arg);
        }
        return arg;
      }
    }
  });
  const result = symbol(...converted);
  switch (resultConverter) {
    case "cstr-to-string": {
      return result == null
        ? __wm_basis_None
        : __wm_basis_Some(new globalThis.Deno.UnsafePointerView(result).getCString());
    }
    case "option-wrap": return __wm_js_option_wrap(result);
    default: {
      if (typeof resultConverter === "object" && resultConverter.kind === "struct-read") {
        return __wm_c_codecs[resultConverter.name].codec.read(new DataView(result));
      }
      return result;
    }
  }
};
const __wm_c_struct_to_buffer = (name, value) => {
  const entry = __wm_c_codecs[name];
  const buffer = new ArrayBuffer(entry.size);
  entry.codec.write(value, new DataView(buffer));
  __wm_c_keepalive.push(buffer);
  return buffer;
};`,
    `const __wm_js_to_workman = (value, converter) => {
  if (converter === "option") return __wm_js_option_wrap(value);
  if (typeof converter === "object" && converter.kind === "tuple") {
    if (!globalThis.Array.isArray(value)) throw new TypeError("expected JavaScript tuple array");
    return converter.items.map((item, index) => __wm_js_to_workman(value[index], item));
  }
  if (typeof converter === "object" && converter.kind === "array") {
    if (!globalThis.Array.isArray(value)) throw new TypeError("expected JavaScript array");
    return __wm_js_array_mark(value.map((item) => __wm_js_to_workman(item, converter.item)));
  }
  if (typeof converter === "object" && converter.kind === "fn") {
    return (...args) => __wm_js_to_workman(
      value(...args.map((arg, index) => __wm_js_to_js(arg, converter.params[index] ?? "id"))),
      converter.result,
    );
  }
  // The "id" converter hands back a raw JavaScript value; an array arriving
  // this way has to be marked or it would read as a tuple. Guarded inline
  // because this runs on every FFI return, and almost none are arrays.
  return globalThis.Array.isArray(value) ? __wm_js_array_mark(value) : value;
};`,
    `const __wm_js_to_js = (value, converter) => {
  if (converter === "option") return __wm_js_option_unwrap(value);
  if (typeof converter === "object" && converter.kind === "tuple") {
    if (!__wm_is_tuple(value)) throw new TypeError("expected Workman tuple");
    return converter.items.map((item, index) => __wm_js_to_js(value[index], item));
  }
  if (typeof converter === "object" && converter.kind === "array") {
    if (!globalThis.Array.isArray(value)) throw new TypeError("expected Workman Js.Array");
    return value.map((item) => __wm_js_to_js(item, converter.item));
  }
  if (typeof converter === "object" && converter.kind === "fn") {
    return (...args) => {
      const converted = args.map((arg, index) => __wm_js_to_workman(arg, converter.params[index] ?? "id"));
      const expected = converter.params.length;
      const limited = converted.slice(0, expected);
      const workmanArg = limited.length === 0 ? undefined : limited.length === 1 ? limited[0] : limited;
      return __wm_js_to_js(
        value(workmanArg),
        converter.result,
      );
    };
  }
  return value;
};`,
    `const __wm_js_apply = (fn, arg, converters, resultConverter, fallible) => {
  // Convert in place; the extra map allocated a second array on every call.
  const arity = converters.length;
  let args;
  if (arity === 0) {
    args = [];
  } else if (arity === 1) {
    args = [__wm_js_to_js(arg, converters[0] ?? "id")];
  } else {
    args = __wm_is_tuple(arg) ? Array.from(arg) : [arg];
    for (let index = 0; index < args.length; index++) {
      args[index] = __wm_js_to_js(args[index], converters[index] ?? "id");
    }
  }
  if (fallible === "task") {
    return __wm_js_task_from_thunk(() => fn(...args), resultConverter);
  }
  if (fallible === "result") {
    try {
      return __wm_basis_Ok(__wm_js_to_workman(fn(...args), resultConverter));
    } catch (error) {
      return __wm_basis_Err(__wm_js_error(error));
    }
  }
  return __wm_js_to_workman(fn(...args), resultConverter);
};`,
    `const __wm_js_task_from_thunk = (thunk, resultConverter) => {
  try {
    return Promise.resolve(thunk()).then(
      (value) => __wm_basis_Ok(__wm_js_to_workman(value, resultConverter)),
      (error) => __wm_basis_Err(__wm_js_error(error)),
    );
  } catch (error) {
    return Promise.resolve(__wm_basis_Err(__wm_js_error(error)));
  }
};`,
    `const __wm_eq = (a, b) => {
  if (a === b) return true;
  const aBytes = a?.[__wm_word8_vector_data];
  const bBytes = b?.[__wm_word8_vector_data];
  if (aBytes !== undefined || bBytes !== undefined) {
    return aBytes !== undefined && bBytes !== undefined && aBytes.length === bBytes.length &&
      aBytes.every((item, index) => item === bBytes[index]);
  }
  if (a?.[__wm_word8_vector_slice_data] !== undefined || b?.[__wm_word8_vector_slice_data] !== undefined) {
    return false;
  }
  if (globalThis.Array.isArray(a) || globalThis.Array.isArray(b)) {
    return globalThis.Array.isArray(a) && globalThis.Array.isArray(b) && a.length === b.length &&
      a.every((item, index) => __wm_eq(item, b[index]));
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if ("ctor" in a || "ctor" in b) {
    return a.ctor === b.ctor && __wm_eq(a.args, b.args);
  }
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((key, index) =>
    key === bk[index] && __wm_eq(a[key], b[key])
  );
};`,
    `const __wm_show = (value, seen = new WeakSet(), quoteStrings = false) => {
  if (value === undefined) return "void";
  if (value === null) return "null";
  if (typeof value === "string") return quoteStrings ? JSON.stringify(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function") return "<function>";
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "<cycle>";
  seen.add(value);
  let shown;
  if (value[__wm_word8_vector_data] !== undefined) {
    shown = "Word8Vector[" + globalThis.Array.from(value[__wm_word8_vector_data]).join(", ") + "]";
  } else if (value[__wm_word8_vector_slice_data] !== undefined) {
    const slice = value[__wm_word8_vector_slice_data];
    shown = "Word8VectorSlice[" + globalThis.Array.from(
      __wm_word8_vector_bytes(slice.vector).subarray(slice.offset, slice.offset + slice.length),
    ).join(", ") + "]";
  } else if (__wm_is_tuple(value)) {
    shown = "(" + value.map((item) => __wm_show(item, seen, quoteStrings)).join(", ") + ")";
  } else if ("ctor" in value) {
    shown = value.args.length === 0
      ? value.name
      : value.name + "(" + value.args.map((item) => {
        if (__wm_is_tuple(item)) return item.map((part) => __wm_show(part, seen, quoteStrings)).join(", ");
        return __wm_show(item, seen, quoteStrings);
      }).join(", ") + ")";
  } else if (globalThis.Array.isArray(value)) {
    shown = "[" + value.map((item) => __wm_show(item, seen, quoteStrings)).join(", ") + "]";
  } else {
    shown = "{ " + Object.keys(value).sort().map((key) => key + " = " + __wm_show(value[key], seen, quoteStrings)).join(", ") + " }";
  }
  seen.delete(value);
  return shown;
};`,
    "const print = (value) => console.log(__wm_show(value));",
    "const __wm_repl_show = (value) => __wm_show(value, new WeakSet(), true);",
    `const __wm_text_of = (value) => {
  try {
    return __wm_show(value);
  } catch (_error) {
    return "?";
  }
};`,
    "const __wm_fail = (name, message) => { const e = new Error(message); e.name = name; throw e; };",
    ...emitBasisConstructors(),
    `const __wm_js_error = (error) => {
  try {
    if (error instanceof Error) return __wm_basis_Js_Error(String(error.message));
    if (typeof error === "string") return __wm_basis_Js_Error(error);
    if (error && typeof error === "object" && "message" in error) {
      return __wm_basis_Js_Error(String(error.message));
    }
  } catch (_error) {
    return __wm_basis_Js_Unknown;
  }
  return __wm_basis_Js_Unknown;
};`,
    `const Json = {
  assert: (value) => value == null
    ? __wm_basis_Err(__wm_js_error(new Error("Json.assert failed")))
    : __wm_basis_Ok(value),
};`,
    `const Dict = {
  empty: () => ({}),
  get: ([dict, key]) => __wm_js_option_wrap(Object.hasOwn(dict, key) ? dict[key] : undefined),
  set: ([dict, key, value]) => { dict[key] = value; },
};`,
    `const Table = {
  empty: () => new globalThis.Map(),
  get: ([table, key]) => __wm_js_option_wrap(table.get(key)),
  set: ([table, key, value]) => { table.set(key, value); },
  getAt: ([table, key]) => __wm_js_option_wrap(table.get(key)),
  setAt: ([table, key, value]) => { table.set(key, value); },
};`,
    `const __wm_array_to_list = (items) => {
  let list = __wm_basis_Nil;
  for (let index = items.length - 1; index >= 0; index--) {
    list = __wm_basis_Cons([items[index], list]);
  }
  return list;
};`,
    `const __wm_list_to_array = (list) => {
  const items = [];
  let cursor = list;
  while (cursor?.ctor === ${basisCtorId("Cons")}) {
    const [head, tail] = cursor.args[0];
    items.push(head);
    cursor = tail;
  }
  return __wm_js_array_mark(items);
};`,
    `const __wm_word_length = (value, label = "length") => {
  if (!globalThis.Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    return __wm_fail("Size", label + " must be an integer between 0 and 4294967295");
  }
  return value;
};
const __wm_nonnegative_safe_integer = (value, label) => {
  if (!globalThis.Number.isSafeInteger(value) || value < 0) {
    return __wm_fail("Domain", label + " must be a non-negative safe integer");
  }
  return value;
};
const __wm_word_shift = (value) => {
  if (!globalThis.Number.isSafeInteger(value) || value < 0) {
    return __wm_fail("Domain", "shift count must be a non-negative integer");
  }
  return value;
};
const __wm_word_from_number = (value, normalize, name) => {
  if (!globalThis.Number.isSafeInteger(value)) {
    return __wm_fail("Domain", name + ".fromNumber expects a safe integer");
  }
  return normalize(value);
};
const __wm_small_word = (bits) => {
  const normalize = bits === 32 ? (value) => value >>> 0 : (value) => value & ((1 << bits) - 1);
  const mask = bits === 32 ? 0xffffffff : (1 << bits) - 1;
  const signBit = bits === 32 ? 0x80000000 : 1 << (bits - 1);
  const arithmetic = (value, count) => {
    count = __wm_word_shift(count);
    if (count >= bits) return (value & signBit) === 0 ? 0 : normalize(mask);
    const signed = bits === 32 ? value | 0 : (value << (32 - bits)) >> (32 - bits);
    return normalize(signed >> count);
  };
  return {
    wordSize: bits,
    fromNumber: (value) => __wm_word_from_number(value, normalize, "Word" + bits),
    toNumber: (value) => value,
    andb: ([left, right]) => normalize(left & right),
    orb: ([left, right]) => normalize(left | right),
    xorb: ([left, right]) => normalize(left ^ right),
    notb: (value) => normalize(~value),
    shiftLeft: ([value, count]) => {
      count = __wm_word_shift(count);
      return count >= bits ? 0 : normalize(value << count);
    },
    shiftRight: ([value, count]) => {
      count = __wm_word_shift(count);
      return count >= bits ? 0 : normalize(value >>> count);
    },
    shiftRightArithmetic: ([value, count]) => arithmetic(value, count),
    add: ([left, right]) => normalize(left + right),
    sub: ([left, right]) => normalize(left - right),
    mul: ([left, right]) => normalize(bits === 32 ? globalThis.Math.imul(left, right) : left * right),
    div: ([left, right]) => right === 0
      ? __wm_fail("Div", "word division by zero")
      : normalize(globalThis.Math.floor(left / right)),
    mod: ([left, right]) => right === 0
      ? __wm_fail("Div", "word remainder by zero")
      : normalize(left % right),
  };
};
const Word8 = __wm_small_word(8);
const Word16 = __wm_small_word(16);
const Word32 = __wm_small_word(32);
const __wm_word64_mask = (1n << 64n) - 1n;
const __wm_word64_normalize = (value) => globalThis.BigInt.asUintN(64, value);
const __wm_word64_from_number = (value) => {
  if (!globalThis.Number.isSafeInteger(value)) {
    return __wm_fail("Domain", "Word64.fromNumber expects a safe integer");
  }
  return __wm_word64_normalize(globalThis.BigInt(value));
};
const Word64 = {
  wordSize: 64,
  fromNumber: __wm_word64_from_number,
  toNumber: (value) => value > globalThis.BigInt(globalThis.Number.MAX_SAFE_INTEGER)
    ? __wm_fail("Overflow", "Word64 value is not exactly representable as Number")
    : globalThis.Number(value),
  andb: ([left, right]) => left & right,
  orb: ([left, right]) => left | right,
  xorb: ([left, right]) => left ^ right,
  notb: (value) => __wm_word64_normalize(~value),
  shiftLeft: ([value, count]) => {
    count = __wm_word_shift(count);
    return count >= 64 ? 0n : __wm_word64_normalize(value << globalThis.BigInt(count));
  },
  shiftRight: ([value, count]) => {
    count = __wm_word_shift(count);
    return count >= 64 ? 0n : value >> globalThis.BigInt(count);
  },
  shiftRightArithmetic: ([value, count]) => {
    count = __wm_word_shift(count);
    const signed = globalThis.BigInt.asIntN(64, value);
    return count >= 64
      ? (signed < 0n ? __wm_word64_mask : 0n)
      : __wm_word64_normalize(signed >> globalThis.BigInt(count));
  },
  add: ([left, right]) => __wm_word64_normalize(left + right),
  sub: ([left, right]) => __wm_word64_normalize(left - right),
  mul: ([left, right]) => __wm_word64_normalize(left * right),
  div: ([left, right]) => right === 0n
    ? __wm_fail("Div", "word division by zero")
    : left / right,
  mod: ([left, right]) => right === 0n
    ? __wm_fail("Div", "word remainder by zero")
    : left % right,
};
const __wm_float = (normalize) => ({
  fromNumber: (value) => normalize(value),
  toNumber: (value) => value,
  add: ([left, right]) => normalize(left + right),
  sub: ([left, right]) => normalize(left - right),
  mul: ([left, right]) => normalize(left * right),
  div: ([left, right]) => normalize(left / right),
  neg: (value) => normalize(-value),
});
const Float32 = __wm_float((value) => globalThis.Math.fround(value));
const Float64 = __wm_float((value) => value);
const __wm_word8_vector_wrap = (bytes) => globalThis.Object.freeze({
  [__wm_word8_vector_data]: bytes,
});
const __wm_word8_vector_bytes = (vector) => {
  const bytes = vector?.[__wm_word8_vector_data];
  if (!(bytes instanceof globalThis.Uint8Array)) {
    return __wm_fail("TypeError", "expected Word8Vector.vector");
  }
  return bytes;
};
const __wm_word8_vector_index = (bytes, index) => {
  if (!globalThis.Number.isSafeInteger(index) || index < 0 || index >= bytes.length) {
    return __wm_fail("Subscript", "Word8Vector index out of bounds");
  }
  return index;
};
const __wm_word8_vector_empty = __wm_word8_vector_wrap(new globalThis.Uint8Array(0));
const Word8Vector = {
  empty: __wm_word8_vector_empty,
  fromList: (list) => __wm_word8_vector_wrap(
    globalThis.Uint8Array.from(__wm_list_to_array(list)),
  ),
  length: (vector) => __wm_word8_vector_bytes(vector).length,
  sub: ([vector, index]) => {
    const bytes = __wm_word8_vector_bytes(vector);
    return bytes[__wm_word8_vector_index(bytes, index)];
  },
  get: ([vector, index]) => {
    const bytes = __wm_word8_vector_bytes(vector);
    return globalThis.Number.isSafeInteger(index) && index >= 0 && index < bytes.length
      ? __wm_basis_Some(bytes[index])
      : __wm_basis_None;
  },
  update: ([vector, index, value]) => {
    const bytes = __wm_word8_vector_bytes(vector).slice();
    bytes[__wm_word8_vector_index(bytes, index)] = value;
    return __wm_word8_vector_wrap(bytes);
  },
  concat: (list) => {
    const vectors = __wm_list_to_array(list);
    let length = 0;
    for (const vector of vectors) length += __wm_word8_vector_bytes(vector).length;
    const output = new globalThis.Uint8Array(__wm_word_length(length));
    let offset = 0;
    for (const vector of vectors) {
      const bytes = __wm_word8_vector_bytes(vector);
      output.set(bytes, offset);
      offset += bytes.length;
    }
    return output.length === 0 ? __wm_word8_vector_empty : __wm_word8_vector_wrap(output);
  },
  tabulate: ([length, generate]) => {
    const output = new globalThis.Uint8Array(__wm_word_length(length));
    for (let index = 0; index < output.length; index++) output[index] = generate(index);
    return output.length === 0 ? __wm_word8_vector_empty : __wm_word8_vector_wrap(output);
  },
  mapi: ([vector, map]) => {
    const bytes = __wm_word8_vector_bytes(vector);
    const output = new globalThis.Uint8Array(bytes.length);
    for (let index = 0; index < bytes.length; index++) output[index] = map([index, bytes[index]]);
    return output.length === 0 ? __wm_word8_vector_empty : __wm_word8_vector_wrap(output);
  },
  unfoldN: ([length, initial, step]) => {
    const output = new globalThis.Uint8Array(__wm_word_length(length));
    let state = initial;
    for (let index = 0; index < output.length; index++) {
      const next = step(state);
      output[index] = next[0];
      state = next[1];
    }
    return [output.length === 0 ? __wm_word8_vector_empty : __wm_word8_vector_wrap(output), state];
  },
  toList: (vector) => __wm_array_to_list(__wm_word8_vector_bytes(vector)),
};
const __wm_word8_vector_slice_wrap = (vector, offset, length) => globalThis.Object.freeze({
  [__wm_word8_vector_slice_data]: globalThis.Object.freeze({ vector, offset, length }),
});
const __wm_word8_vector_slice_parts = (slice) => {
  const parts = slice?.[__wm_word8_vector_slice_data];
  if (parts === undefined) return __wm_fail("TypeError", "expected Word8VectorSlice.slice");
  return parts;
};
const __wm_word8_vector_slice_range = (available, start, lengthOption) => {
  if (!globalThis.Number.isSafeInteger(start) || start < 0 || start > available) {
    return __wm_fail("Subscript", "Word8VectorSlice start out of bounds");
  }
  const unwrapped = __wm_js_option_unwrap(lengthOption);
  const length = unwrapped === null ? available - start : unwrapped;
  if (!globalThis.Number.isSafeInteger(length) || length < 0 || length > available - start) {
    return __wm_fail("Subscript", "Word8VectorSlice length out of bounds");
  }
  return [start, length];
};
const Word8VectorSlice = {
  full: (vector) => __wm_word8_vector_slice_wrap(
    vector,
    0,
    __wm_word8_vector_bytes(vector).length,
  ),
  slice: ([vector, start, lengthOption]) => {
    const bytes = __wm_word8_vector_bytes(vector);
    const [relative, length] = __wm_word8_vector_slice_range(bytes.length, start, lengthOption);
    return __wm_word8_vector_slice_wrap(vector, relative, length);
  },
  subslice: ([slice, start, lengthOption]) => {
    const parts = __wm_word8_vector_slice_parts(slice);
    const [relative, length] = __wm_word8_vector_slice_range(
      parts.length,
      start,
      lengthOption,
    );
    return __wm_word8_vector_slice_wrap(parts.vector, parts.offset + relative, length);
  },
  base: (slice) => {
    const parts = __wm_word8_vector_slice_parts(slice);
    return [parts.vector, parts.offset, parts.length];
  },
  length: (slice) => __wm_word8_vector_slice_parts(slice).length,
  isEmpty: (slice) => __wm_word8_vector_slice_parts(slice).length === 0,
  sub: ([slice, index]) => {
    const parts = __wm_word8_vector_slice_parts(slice);
    const relative = __wm_word8_vector_index({ length: parts.length }, index);
    return __wm_word8_vector_bytes(parts.vector)[parts.offset + relative];
  },
  get: ([slice, index]) => {
    const parts = __wm_word8_vector_slice_parts(slice);
    return globalThis.Number.isSafeInteger(index) && index >= 0 && index < parts.length
      ? __wm_basis_Some(__wm_word8_vector_bytes(parts.vector)[parts.offset + index])
      : __wm_basis_None;
  },
  vector: (slice) => {
    const parts = __wm_word8_vector_slice_parts(slice);
    const bytes = __wm_word8_vector_bytes(parts.vector);
    if (parts.offset === 0 && parts.length === bytes.length) return parts.vector;
    if (parts.length === 0) return __wm_word8_vector_empty;
    return __wm_word8_vector_wrap(bytes.slice(parts.offset, parts.offset + parts.length));
  },
  concat: (list) => {
    const slices = __wm_list_to_array(list);
    let length = 0;
    for (const slice of slices) length += __wm_word8_vector_slice_parts(slice).length;
    const output = new globalThis.Uint8Array(__wm_word_length(length));
    let offset = 0;
    for (const slice of slices) {
      const parts = __wm_word8_vector_slice_parts(slice);
      const bytes = __wm_word8_vector_bytes(parts.vector);
      output.set(bytes.subarray(parts.offset, parts.offset + parts.length), offset);
      offset += parts.length;
    }
    return output.length === 0 ? __wm_word8_vector_empty : __wm_word8_vector_wrap(output);
  },
};
const __wm_bytes_task = async (operation) => {
  try {
    return __wm_basis_Ok(await operation());
  } catch (error) {
    return __wm_basis_Err(__wm_js_error(error));
  }
};
const Bytes = {
  readFile: (path) => __wm_bytes_task(async () => {
    const bytes = await globalThis.Deno.readFile(path);
    return bytes.length === 0 ? __wm_word8_vector_empty : __wm_word8_vector_wrap(bytes);
  }),
  readSlice: ([path, offset, length]) => __wm_bytes_task(async () => {
    __wm_nonnegative_safe_integer(offset, "offset");
    __wm_word_length(length);
    const file = await globalThis.Deno.open(path, { read: true });
    try {
      await file.seek(offset, globalThis.Deno.SeekMode.Start);
      const bytes = new globalThis.Uint8Array(length);
      let filled = 0;
      while (filled < length) {
        const count = await file.read(bytes.subarray(filled));
        if (count === null) {
          return __wm_fail(
            "UnexpectedEof",
            "short binary slice at " + offset + ": " + filled + "/" + length,
          );
        }
        filled += count;
      }
      return bytes.length === 0 ? __wm_word8_vector_empty : __wm_word8_vector_wrap(bytes);
    } finally {
      file.close();
    }
  }),
  writeFile: ([path, vector]) => __wm_bytes_task(async () => {
    await globalThis.Deno.writeFile(path, __wm_word8_vector_bytes(vector));
    return undefined;
  }),
};
const __wm_pack_word_location = (input, index, width, sliceExpected) => {
  if (!globalThis.Number.isSafeInteger(index) || index < 0) {
    return __wm_fail("Subscript", "PackWord element index out of bounds");
  }
  let vector;
  let baseOffset;
  let available;
  if (sliceExpected) {
    const parts = __wm_word8_vector_slice_parts(input);
    vector = parts.vector;
    baseOffset = parts.offset;
    available = parts.length;
  } else {
    vector = input;
    baseOffset = 0;
    available = __wm_word8_vector_bytes(vector).length;
  }
  const relative = index * width;
  if (!globalThis.Number.isSafeInteger(relative) || relative + width > available) {
    return __wm_fail("Subscript", "PackWord element index out of bounds");
  }
  return [__wm_word8_vector_bytes(vector), baseOffset + relative];
};
const __wm_pack_word = (bits, isBigEndian) => {
  const width = bits / 8;
  const littleEndian = !isBigEndian;
  const read = (input, index, sliceExpected) => {
    const [bytes, offset] = __wm_pack_word_location(input, index, width, sliceExpected);
    const view = new globalThis.DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bits === 16) return view.getUint16(offset, littleEndian);
    if (bits === 32) return view.getUint32(offset, littleEndian);
    return view.getBigUint64(offset, littleEndian);
  };
  return {
    bytesPerElem: width,
    isBigEndian,
    subVec: ([vector, index]) => read(vector, index, false),
    subSlice: ([slice, index]) => read(slice, index, true),
    pack: (value) => {
      const bytes = new globalThis.Uint8Array(width);
      const view = new globalThis.DataView(bytes.buffer);
      if (bits === 16) view.setUint16(0, value, littleEndian);
      else if (bits === 32) view.setUint32(0, value, littleEndian);
      else view.setBigUint64(0, value, littleEndian);
      return __wm_word8_vector_wrap(bytes);
    },
  };
};
const PackWord16Little = __wm_pack_word(16, false);
const PackWord16Big = __wm_pack_word(16, true);
const PackWord32Little = __wm_pack_word(32, false);
const PackWord32Big = __wm_pack_word(32, true);
const PackWord64Little = __wm_pack_word(64, false);
const PackWord64Big = __wm_pack_word(64, true);
const __wm_pack_real = (bits, isBigEndian) => {
  const width = bits / 8;
  const littleEndian = !isBigEndian;
  const read = (input, index, sliceExpected) => {
    const [bytes, offset] = __wm_pack_word_location(input, index, width, sliceExpected);
    const view = new globalThis.DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return bits === 32
      ? view.getFloat32(offset, littleEndian)
      : view.getFloat64(offset, littleEndian);
  };
  return {
    bytesPerElem: width,
    isBigEndian,
    subVec: ([vector, index]) => read(vector, index, false),
    subSlice: ([slice, index]) => read(slice, index, true),
    pack: (value) => {
      const bytes = new globalThis.Uint8Array(width);
      const view = new globalThis.DataView(bytes.buffer);
      if (bits === 32) view.setFloat32(0, value, littleEndian);
      else view.setFloat64(0, value, littleEndian);
      return __wm_word8_vector_wrap(bytes);
    },
  };
};
const PackReal32Little = __wm_pack_real(32, false);
const PackReal32Big = __wm_pack_real(32, true);
const PackReal64Little = __wm_pack_real(64, false);
const PackReal64Big = __wm_pack_real(64, true);
const Byte = {
  bytesToString: (vector) => {
    const bytes = __wm_word8_vector_bytes(vector);
    const chunks = [];
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      chunks.push(globalThis.String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
    }
    return chunks.join("");
  },
  stringToBytes: (value) => {
    const bytes = new globalThis.Uint8Array(value.length);
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code > 255) {
        return __wm_fail("Domain", "Byte.stringToBytes requires characters in the byte range");
      }
      bytes[index] = code;
    }
    return bytes.length === 0 ? __wm_word8_vector_empty : __wm_word8_vector_wrap(bytes);
  },
};
`,
    `const Js = {
  Array: {
    toList: __wm_array_to_list,
    fromList: __wm_list_to_array,
  },
};`,
    `const Text = {
  of: __wm_text_of,
};`,
    `const __wm_debug_error_message = (error) => {
  if (typeof error === "string") return error;
  if (error instanceof globalThis.Error) return String(error.message);
  if (error?.ctor === ${basisCtorId("Js.Error")}) return String(error.args[0]);
  if (error?.ctor === ${basisCtorId("Js.Unknown")}) return "unknown JavaScript error";
  if (error === null) return "null";
  return __wm_show(error, new WeakSet(), true);
};`,
    `const Debug = {
  errorMessage: __wm_debug_error_message,
};`,
    `const __wm_basis_Option = {
  None: __wm_basis_None,
  Some: __wm_basis_Some,
};`,
    `const __wm_basis_List = {
  Nil: __wm_basis_Nil,
  Cons: __wm_basis_Cons,
};`,
    `const __wm_basis_Result = {
  Ok: __wm_basis_Ok,
  Err: __wm_basis_Err,
};`,
    `const __wm_error_message = (error) => {
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error);
};`,
    `const __wm_basis_Task = {
  new: (register) => new Promise((complete) => {
    const registered = register(complete);
    if (registered.ctor !== ${basisCtorId("Ok")}) complete(registered);
  }),
  fromResult: (result) => Promise.resolve(result),
  succeed: (value) => Promise.resolve(__wm_basis_Ok(value)),
  fail: (error) => Promise.resolve(__wm_basis_Err(error)),
  map: ([task, fn]) => Promise.resolve(task).then((result) =>
    result.ctor === ${basisCtorId("Ok")} ? __wm_basis_Ok(fn(result.args[0])) : result
  ),
  map2: ([leftTask, rightTask, fn]) => Promise.all([
    Promise.resolve(leftTask),
    Promise.resolve(rightTask),
  ]).then((results) => {
    const left = results[0];
    const right = results[1];
    if (left.ctor !== ${basisCtorId("Ok")}) return left;
    if (right.ctor !== ${basisCtorId("Ok")}) return right;
    return __wm_basis_Ok(fn([left.args[0], right.args[0]]));
  }),
  race: ([leftTask, rightTask]) => Promise.race([
    Promise.resolve(leftTask),
    Promise.resolve(rightTask),
  ]),
  andThen: ([task, fn]) => Promise.resolve(task).then((result) =>
    result.ctor === ${basisCtorId("Ok")} ? fn(result.args[0]) : result
  ),
  mapErr: ([task, fn]) => Promise.resolve(task).then((result) =>
    result.ctor === ${basisCtorId("Err")} ? __wm_basis_Err(fn(result.args[0])) : result
  ),
  recover: ([task, fn]) => Promise.resolve(task).then((result) =>
    result.ctor === ${basisCtorId("Err")} ? __wm_basis_Ok(fn(result.args[0])) : result
  ),
  orElse: ([task, fn]) => Promise.resolve(task).then((result) =>
    result.ctor === ${basisCtorId("Err")} ? fn(result.args[0]) : result
  ),
  all: (tasks) => Promise.all(tasks).then((results) => {
    const values = [];
    for (const result of results) {
      if (result.ctor !== ${basisCtorId("Ok")}) return result;
      values.push(result.args[0]);
    }
    return __wm_basis_Ok(values);
  }),
};`,
    ...emitBasisOperators(),
  ];
}

/**
 * Implementations of the fixed operator catalog, keyed by the manifest's spelling.
 *
 * `B303`/`G9`: the dynamic artifact is built from the same description as the static
 * one. The runtime *name* of each operator comes from `BASIS_OPERATORS`, so a manifest
 * change cannot leave the static basis advertising a runtime value nothing defines.
 * Only the JavaScript body lives here.
 */
const OPERATOR_BODIES: Readonly<Record<string, string>> = Object.freeze({
  "++": "([a, b]) => a + b",
  "+": "([a, b]) => a + b",
  "-": "(x) => __wm_is_tuple(x) ? x[0] - x[1] : -x",
  "*": "([a, b]) => a * b",
  "/": "([a, b]) => a / b",
  "%": "([a, b]) => a % b",
  "==": "([a, b]) => __wm_eq(a, b)",
  "!=": "([a, b]) => !__wm_eq(a, b)",
  "<": "([a, b]) => a < b",
  "<=": "([a, b]) => a <= b",
  ">": "([a, b]) => a > b",
  ">=": "([a, b]) => a >= b",
  "&&": "([a, b]) => a && b",
  "||": "([a, b]) => a || b",
});

/**
 * Unary operator implementations, keyed by spelling like the binary bodies above.
 *
 * Unary minus has no entry: it shares the binary `-` descriptor, whose implementation
 * already distinguishes the tuple and scalar cases.
 */
const UNARY_OPERATOR_BODIES: Readonly<Record<string, string>> = Object.freeze({
  "!": "(x) => !x",
});

const DIRECT_OPERATOR_BODIES: Readonly<Record<string, string>> = Object.freeze({
  "&&": "(a, b) => a && b",
  "||": "(a, b) => a || b",
});

function emitBasisOperators(): string[] {
  return [
    ...definitionsFor(BASIS_OPERATORS, OPERATOR_BODIES, "BASIS_OPERATORS"),
    ...definitionsFor(BASIS_UNARY_OPERATORS, UNARY_OPERATOR_BODIES, "BASIS_UNARY_OPERATORS"),
    // Direct eager entry points let statically known boolean applications avoid
    // their argument tuple without adopting JavaScript's short-circuit semantics.
    ...directDefinitionsFor(BASIS_OPERATORS),
  ];
}

function directDefinitionsFor(operators: readonly BasisOperatorDescriptor[]): string[] {
  return operators.flatMap((operator) => {
    if (!operator.directRuntimeName) return [];
    const body = DIRECT_OPERATOR_BODIES[operator.spelling];
    if (!body) {
      throw new Error(
        `basis operator ${operator.spelling} has no direct runtime implementation`,
      );
    }
    return [`const ${operator.directRuntimeName} = ${body};`];
  });
}

function definitionsFor(
  operators: readonly BasisOperatorDescriptor[],
  bodies: Readonly<Record<string, string>>,
  catalog: string,
): string[] {
  return operators.map((operator) => {
    const body = bodies[operator.spelling];
    if (!body) {
      throw new Error(
        `basis operator ${operator.spelling} has no runtime implementation; ` +
          `every ${catalog} entry needs one so static and dynamic profiles correspond`,
      );
    }
    return `const ${operator.runtimeName} = ${body};`;
  });
}

function emitBasisConstructors(): string[] {
  return basisTypes.flatMap((type) =>
    type.ctors.map((ctor) =>
      ctor.args.length
        ? `const ${basisCtorJsName(ctor.id)} = (__payload) => ({ ctor: ${
          JSON.stringify(ctor.id)
        }, name: ${JSON.stringify(ctor.name)}, args: [__payload] });`
        : `const ${basisCtorJsName(ctor.id)} = Object.freeze({ ctor: ${
          JSON.stringify(ctor.id)
        }, name: ${JSON.stringify(ctor.name)}, args: [] });`
    )
  );
}
