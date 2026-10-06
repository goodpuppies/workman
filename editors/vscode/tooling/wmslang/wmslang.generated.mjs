"use strict";
const __wm_js_array_tag = Symbol('wm.jsArray');
const __wm_word8_vector_data = Symbol.for('wm.Word8Vector.data');
const __wm_word8_vector_slice_data = Symbol.for('wm.Word8VectorSlice.data');
const __wm_vector_data = Symbol.for('wm.Vector.data');
const __wm_vector_slice_data = Symbol.for('wm.VectorSlice.data');
const __wm_is_tuple = (value) => globalThis.Array.isArray(value) && value[__wm_js_array_tag] !== true;
const __wm_js_array_mark = (value) => {
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
};
const __wm_js_global = (path) => path.split(".").reduce((value, key) => value?.[key], globalThis);
const __wm_js_should_bind = (value) =>
  typeof value === "function" && !/^class\s/.test(Function.prototype.toString.call(value));
const __wm_js_member = (path) => {
  const parts = path.split(".");
  const key = parts.pop();
  const owner = parts.length === 0 ? globalThis : __wm_js_global(parts.join("."));
  const value = owner?.[key];
  return __wm_js_should_bind(value) ? value.bind(owner) : __wm_js_array_mark(value);
};
const __wm_js_member_obj = (owner, key) => {
  const value = owner?.[key];
  return globalThis.Array.isArray(value) ? __wm_js_array_mark(value) : value;
};
const __wm_js_receiver_member = (path) => {
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
};
const __wm_js_construct = (path) => (...args) => new (__wm_js_global(path))(...args);
const __wm_js_call = (fn, arg) => __wm_is_tuple(arg) ? fn(...arg) : fn(arg);
const __wm_js_option_wrap = (value) => value == null ? __wm_basis_None : __wm_basis_Some(value);
const __wm_js_option_unwrap = (value) => value?.ctor === -1 ? null : value?.ctor === -2 ? value.args[0] : value;
const __wm_c_text_encoder = new globalThis.TextEncoder();
const __wm_c_string_to_cstr = (value) => {
  const bytes = __wm_c_text_encoder.encode(String(value) + "\0");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  __wm_c_cstr_cache[__wm_c_cstr_index] = buffer;
  __wm_c_cstr_index = (__wm_c_cstr_index + 1) % 256;
  return globalThis.Deno.UnsafePointer.of(buffer);
};
const __wm_c_cstr_cache = new globalThis.Array(256);
let __wm_c_cstr_index = 0;
const __wm_c_codecs = {};
const __wm_c_keepalive = [];
const __wm_c_setup_codec = async (descriptor, bt) => {
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
};
const __wm_js_to_workman = (value, converter) => {
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
};
const __wm_js_to_js = (value, converter) => {
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
};
const __wm_js_apply = (fn, arg, converters, resultConverter, fallible) => {
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
};
const __wm_js_task_from_thunk = (thunk, resultConverter) => {
  try {
    return Promise.resolve(thunk()).then(
      (value) => __wm_basis_Ok(__wm_js_to_workman(value, resultConverter)),
      (error) => __wm_basis_Err(__wm_js_error(error)),
    );
  } catch (error) {
    return Promise.resolve(__wm_basis_Err(__wm_js_error(error)));
  }
};
const __wm_eq = (a, b) => {
  if (a === b) return true;
  const aBytes = a?.[__wm_word8_vector_data];
  const bBytes = b?.[__wm_word8_vector_data];
  if (aBytes !== undefined || bBytes !== undefined) {
    return aBytes !== undefined && bBytes !== undefined && aBytes.length === bBytes.length &&
      aBytes.every((item, index) => item === bBytes[index]);
  }
  const aItems = a?.[__wm_vector_data];
  const bItems = b?.[__wm_vector_data];
  if (aItems !== undefined || bItems !== undefined) {
    return aItems !== undefined && bItems !== undefined && aItems.length === bItems.length &&
      aItems.every((item, index) => __wm_eq(item, bItems[index]));
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
};
const __wm_show = (value, seen = new WeakSet(), quoteStrings = false) => {
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
  } else if (value[__wm_vector_data] !== undefined) {
    shown = "Vector[" + value[__wm_vector_data]
      .map((item) => __wm_show(item, seen, quoteStrings)).join(", ") + "]";
  } else if (value[__wm_vector_slice_data] !== undefined) {
    const slice = value[__wm_vector_slice_data];
    shown = "VectorSlice[" + slice.vector[__wm_vector_data]
      .slice(slice.offset, slice.offset + slice.length)
      .map((item) => __wm_show(item, seen, quoteStrings)).join(", ") + "]";
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
};
const print = (value) => console.log(__wm_show(value));
const __wm_repl_show = (value) => __wm_show(value, new WeakSet(), true);
const __wm_text_of = (value) => {
  try {
    return __wm_show(value);
  } catch (_error) {
    return "?";
  }
};
const __wm_fail = (name, message) => { const e = new Error(message); e.name = name; throw e; };
const __wm_basis_None = Object.freeze({ ctor: -1, name: "None", args: [] });
const __wm_basis_Some = (__payload) => ({ ctor: -2, name: "Some", args: [__payload] });
const __wm_basis_Ok = (__payload) => ({ ctor: -3, name: "Ok", args: [__payload] });
const __wm_basis_Err = (__payload) => ({ ctor: -4, name: "Err", args: [__payload] });
const __wm_basis_Nil = Object.freeze({ ctor: -5, name: "Nil", args: [] });
const __wm_basis_Cons = (__payload) => ({ ctor: -6, name: "Cons", args: [__payload] });
const __wm_basis_Js_Error = (__payload) => ({ ctor: -7, name: "Js.Error", args: [__payload] });
const __wm_basis_Js_Unknown = Object.freeze({ ctor: -8, name: "Js.Unknown", args: [] });
const __wm_basis_Gpu_ShaderTarget_WGSL = Object.freeze({ ctor: -9, name: "Gpu.ShaderTarget.WGSL", args: [] });
const __wm_basis_Gpu_ShaderTarget_GLSL = Object.freeze({ ctor: -10, name: "Gpu.ShaderTarget.GLSL", args: [] });
const __wm_basis_Gpu_ShaderTarget_HLSL = Object.freeze({ ctor: -11, name: "Gpu.ShaderTarget.HLSL", args: [] });
const __wm_basis_Gpu_ShaderTarget_METAL = Object.freeze({ ctor: -12, name: "Gpu.ShaderTarget.METAL", args: [] });
const __wm_js_error = (error) => {
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
};
const Json = {
  assert: (value) => value == null
    ? __wm_basis_Err(__wm_js_error(new Error("Json.assert failed")))
    : __wm_basis_Ok(value),
};
const __wm_array_to_list = (items) => {
  let list = __wm_basis_Nil;
  for (let index = items.length - 1; index >= 0; index--) {
    list = __wm_basis_Cons([items[index], list]);
  }
  return list;
};
const __wm_list_to_array = (list) => {
  const items = [];
  let cursor = list;
  while (cursor?.ctor === -6) {
    const [head, tail] = cursor.args[0];
    items.push(head);
    cursor = tail;
  }
  return __wm_js_array_mark(items);
};
const __wm_word8_vector_bytes = (vector) => {
  const bytes = vector?.[__wm_word8_vector_data];
  if (!(bytes instanceof globalThis.Uint8Array)) {
    return __wm_fail("TypeError", "expected Word8Vector.Vector");
  }
  return bytes;
};
const Js = {
  Array: {
    toList: __wm_array_to_list,
    fromList: __wm_list_to_array,
  },
};
const Text = {
  of: __wm_text_of,
};
const __wm_basis_Option = {
  None: __wm_basis_None,
  Some: __wm_basis_Some,
};
const __wm_basis_List = {
  Nil: __wm_basis_Nil,
  Cons: __wm_basis_Cons,
};
const __wm_basis_Result = {
  Ok: __wm_basis_Ok,
  Err: __wm_basis_Err,
};
const __wm_error_message = (error) => {
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error);
};
const __wm_op_add = ([a, b]) => a + b;
const __wm_op_sub = (x) => __wm_is_tuple(x) ? x[0] - x[1] : -x;
const __wm_op_mul = ([a, b]) => a * b;
const __wm_op_div = ([a, b]) => a / b;
const __wm_op_mod = ([a, b]) => a % b;
const __wm_op_concat = ([a, b]) => a + b;
const __wm_op_lt = ([a, b]) => a < b;
const __wm_op_lte = ([a, b]) => a <= b;
const __wm_op_gt = ([a, b]) => a > b;
const __wm_op_gte = ([a, b]) => a >= b;
const __wm_op_eq = ([a, b]) => __wm_eq(a, b);
const __wm_op_ne = ([a, b]) => !__wm_eq(a, b);
const __wm_op_and = ([a, b]) => a && b;
const __wm_op_or = ([a, b]) => a || b;
const __wm_op_not = (x) => !x;
const __wm_op_and_d2 = (a, b) => a && b;
const __wm_op_or_d2 = (a, b) => a || b;
const __wm_module_instances = new globalThis.Map();
const __wm_define_module = (key, dependencies, initialize, publish) => {
  if (__wm_module_instances.has(key)) throw new globalThis.Error("duplicate Workman module instance");
  __wm_module_instances.set(key, {
    state: "uninitialized", dependencies, initialize, publish, value: undefined, error: undefined
  });
};
const __wm_request_module = async (key) => {
  const instance = __wm_module_instances.get(key);
  if (!instance) throw new globalThis.Error("unknown Workman module instance");
  if (instance.state === "completed") return instance.value;
  if (instance.state === "failed") throw instance.error;
  if (instance.state === "initializing") {
    throw new globalThis.Error("cyclic Workman module initialization");
  }
  instance.state = "initializing";
  try {
    for (const dependency of instance.dependencies) {
      await __wm_request_module(dependency);
    }
    const value = await instance.initialize();
    instance.value = value;
    instance.publish(value);
    instance.state = "completed";
    return value;
  } catch (error) {
    instance.error = error;
    instance.state = "failed";
    throw error;
  }
};
let __wm_module_0;
__wm_define_module(
  "__wm_module_0",
  [],
  async () => {
const GpuSpanDto_0 = (__record_args) => ({ id: __record_args[0], path: __record_args[1], line: __record_args[2], col: __record_args[3], start: __record_args[4], end: __record_args[5] });
const GpuTypeDto_1 = (__record_args) => ({ id: __record_args[0], kind: __record_args[1], name: __record_args[2], representation: __record_args[3], width: __record_args[4], items: __record_args[5], params: __record_args[6], result: __record_args[7] });
const GpuBindingDto_2 = (__record_args) => ({ id: __record_args[0], name: __record_args[1], typeId: __record_args[2], definitionExprId: __record_args[3], spanId: __record_args[4], scope: __record_args[5] });
const GpuParamDto_3 = (__record_args) => ({ bindingId: __record_args[0], name: __record_args[1], typeId: __record_args[2] });
const GpuExprDto_4 = (__record_args) => ({ id: __record_args[0], kind: __record_args[1], typeId: __record_args[2], spanId: __record_args[3], bindingId: __record_args[4], name: __record_args[5], operator: __record_args[6], numberValue: __record_args[7], boolValue: __record_args[8], children: __record_args[9], capability: __record_args[10] });
const GpuRootDto_5 = (__record_args) => ({ regionId: __record_args[0], functionId: __record_args[1], bindingId: __record_args[2] });
const GpuFunctionDto_6 = (__record_args) => ({ id: __record_args[0], regionId: __record_args[1], bindingId: __record_args[2], name: __record_args[3], params: __record_args[4], resultTypeId: __record_args[5], bodyExprId: __record_args[6], spanId: __record_args[7], capability: __record_args[8] });
const GpuElaborationInputDto_7 = (__record_args) => ({ schemaVersion: __record_args[0], roots: __record_args[1], functions: __record_args[2], bindings: __record_args[3], types: __record_args[4], expressions: __record_args[5], spans: __record_args[6] });
const TypedGpuExprDto_8 = (__record_args) => ({ id: __record_args[0], kind: __record_args[1], typeId: __record_args[2], spanId: __record_args[3], bindingId: __record_args[4], name: __record_args[5], operator: __record_args[6], numberValue: __record_args[7], boolValue: __record_args[8], children: __record_args[9], capability: __record_args[10] });
const TypedGpuFunctionDto_9 = (__record_args) => ({ id: __record_args[0], regionId: __record_args[1], bindingId: __record_args[2], name: __record_args[3], params: __record_args[4], resultTypeId: __record_args[5], bodyExprId: __record_args[6], spanId: __record_args[7], capability: __record_args[8] });
const GpuCaptureDto_10 = (__record_args) => ({ regionId: __record_args[0], bindingId: __record_args[1], typeId: __record_args[2], spanId: __record_args[3], category: __record_args[4] });
const GpuRepresentationFactDto_11 = (__record_args) => ({ typeId: __record_args[0], representation: __record_args[1] });
const GpuSpecializationDto_12 = (__record_args) => ({ id: __record_args[0], functionId: __record_args[1], bindingId: __record_args[2], name: __record_args[3], paramTypeIds: __record_args[4], resultTypeId: __record_args[5], paramRepresentations: __record_args[6], resultRepresentation: __record_args[7], typeFacts: __record_args[8] });
const GpuRootSpecializationDto_13 = (__record_args) => ({ regionId: __record_args[0], specializationId: __record_args[1] });
const GpuSpecializedCallDto_14 = (__record_args) => ({ callerSpecializationId: __record_args[0], expressionId: __record_args[1], targetSpecializationId: __record_args[2] });
const GpuIrParamDto_15 = (__record_args) => ({ bindingId: __record_args[0], name: __record_args[1], typeId: __record_args[2], representation: __record_args[3] });
const GpuIrExprDto_16 = (__record_args) => ({ id: __record_args[0], specializationId: __record_args[1], sourceExprId: __record_args[2], kind: __record_args[3], typeId: __record_args[4], representation: __record_args[5], spanId: __record_args[6], bindingId: __record_args[7], name: __record_args[8], operator: __record_args[9], numberValue: __record_args[10], boolValue: __record_args[11], children: __record_args[12], capability: __record_args[13], valueKind: __record_args[14], callTargetSpecializationId: __record_args[15] });
const GpuIrFunctionDto_17 = (__record_args) => ({ specializationId: __record_args[0], functionId: __record_args[1], bindingId: __record_args[2], name: __record_args[3], params: __record_args[4], resultTypeId: __record_args[5], resultRepresentation: __record_args[6], bodyExprId: __record_args[7], spanId: __record_args[8] });
const GpuDiagnosticDto_18 = (__record_args) => ({ code: __record_args[0], message: __record_args[1], spanId: __record_args[2] });
const GpuCompilationOutputDto_19 = (__record_args) => ({ schemaVersion: __record_args[0], functions: __record_args[1], captures: __record_args[2], specializations: __record_args[3], rootSpecializations: __record_args[4], calls: __record_args[5], irFunctions: __record_args[6], irExpressions: __record_args[7], types: __record_args[8], expressions: __record_args[9], diagnostics: __record_args[10] });
const GpuSliceSpanDto_20 = (__record_args) => ({ id: __record_args[0], path: __record_args[1], line: __record_args[2], col: __record_args[3], start: __record_args[4], end: __record_args[5] });
const GpuSliceTypeDto_21 = (__record_args) => ({ id: __record_args[0], kind: __record_args[1], typeNameId: __record_args[2], items: __record_args[3], params: __record_args[4], result: __record_args[5] });
const GpuSliceShaderTypeDto_22 = (__record_args) => ({ id: __record_args[0], kind: __record_args[1], typeNameId: __record_args[2], items: __record_args[3], params: __record_args[4], result: __record_args[5] });
const GpuSliceTypeEvidenceDto_23 = (__record_args) => ({ typeId: __record_args[0], semanticKind: __record_args[1], shaderKind: __record_args[2], reason: __record_args[3] });
const GpuSliceAdtDto_24 = (__record_args) => ({ typeNameId: __record_args[0], name: __record_args[1], constructorIds: __record_args[2], spanId: __record_args[3] });
const GpuSliceConstructorDto_25 = (__record_args) => ({ id: __record_args[0], typeNameId: __record_args[1], name: __record_args[2], tag: __record_args[3], payloadTypeId: __record_args[4], spanId: __record_args[5] });
const GpuSlicePatternDto_26 = (__record_args) => ({ id: __record_args[0], context: __record_args[1], kind: __record_args[2], typeId: __record_args[3], ownerFunctionId: __record_args[4], bindingId: __record_args[5], constructorId: __record_args[6], children: __record_args[7], spanId: __record_args[8] });
const GpuSliceParamDto_27 = (__record_args) => ({ id: __record_args[0], patternId: __record_args[1], typeId: __record_args[2], declaredIndex: __record_args[3], spanId: __record_args[4] });
const GpuSliceLetDto_28 = (__record_args) => ({ id: __record_args[0], patternId: __record_args[1], valueExprId: __record_args[2], declaredIndex: __record_args[3], spanId: __record_args[4] });
const GpuSliceMatchArmDto_29 = (__record_args) => ({ id: __record_args[0], patternId: __record_args[1], bodyExprId: __record_args[2], declaredIndex: __record_args[3], spanId: __record_args[4] });
const GpuSliceBlockItemDto_30 = (__record_args) => ({ id: __record_args[0], blockExprId: __record_args[1], declaredIndex: __record_args[2], kind: __record_args[3], expressionId: __record_args[4], letId: __record_args[5], spanId: __record_args[6] });
const GpuSliceBlockDto_31 = (__record_args) => ({ expressionId: __record_args[0], itemIds: __record_args[1], resultExprId: __record_args[2] });
const GpuSliceMatchDto_32 = (__record_args) => ({ expressionId: __record_args[0], valueExprId: __record_args[1], armIds: __record_args[2] });
const GpuSliceExprDto_33 = (__record_args) => ({ id: __record_args[0], kind: __record_args[1], typeId: __record_args[2], spanId: __record_args[3], ownerFunctionId: __record_args[4], bindingId: __record_args[5], functionId: __record_args[6], constructorId: __record_args[7], semanticId: __record_args[8], operatorId: __record_args[9], builtinName: __record_args[10], resourceOperation: __record_args[11], numberValue: __record_args[12], numberKind: __record_args[13], boolValue: __record_args[14], index: __record_args[15], children: __record_args[16] });
const GpuSliceBuiltinCatalogIdentityDto_34 = (__record_args) => ({ schemaVersion: __record_args[0], slangVersion: __record_args[1], sourceSha256: __record_args[2] });
const GpuSliceBuiltinOverloadDto_35 = (__record_args) => ({ id: __record_args[0], name: __record_args[1], params: __record_args[2], result: __record_args[3], sourceSignature: __record_args[4] });
const GpuSliceBuiltinCatalogDto_36 = (__record_args) => ({ identity: __record_args[0], overloads: __record_args[1] });
const GpuSliceFunctionDto_37 = (__record_args) => ({ id: __record_args[0], bindingId: __record_args[1], sourceBindingId: __record_args[2], name: __record_args[3], typeId: __record_args[4], paramIds: __record_args[5], resultTypeId: __record_args[6], bodyExprId: __record_args[7], recursionGroupId: __record_args[8], spanId: __record_args[9] });
const GpuSliceOccurrenceTypeDto_38 = (__record_args) => ({ kind: __record_args[0], sourceId: __record_args[1], typeId: __record_args[2], shaderTypeId: __record_args[3], spanId: __record_args[4], representationEvidence: __record_args[5], representation: __record_args[6] });
const GpuSliceBuiltinSelectionDto_39 = (__record_args) => ({ expressionId: __record_args[0], overloadId: __record_args[1] });
const GpuSliceTypeElaborationOutputDto_40 = (__record_args) => ({ schemaVersion: __record_args[0], shaderTypes: __record_args[1], typeEvidence: __record_args[2], occurrences: __record_args[3], builtinSelections: __record_args[4] });
const GpuSliceRootDto_41 = (__record_args) => ({ functionId: __record_args[0], selectorSpanId: __record_args[1], environmentId: __record_args[2] });
const GpuSliceEnvironmentFieldDto_42 = (__record_args) => ({ id: __record_args[0], environmentId: __record_args[1], name: __record_args[2], declaredIndex: __record_args[3], kind: __record_args[4], binding: __record_args[5], typeId: __record_args[6], spanId: __record_args[7] });
const GpuSliceEnvironmentDto_43 = (__record_args) => ({ id: __record_args[0], recordId: __record_args[1], typeNameId: __record_args[2], name: __record_args[3], bindingId: __record_args[4], fieldIds: __record_args[5], spanId: __record_args[6] });
const GpuSliceRecursionGroupDto_44 = (__record_args) => ({ id: __record_args[0], memberFunctionIds: __record_args[1], spanId: __record_args[2] });
const GpuSliceRecursiveReferenceDto_45 = (__record_args) => ({ expressionId: __record_args[0], groupId: __record_args[1], targetFunctionId: __record_args[2], relation: __record_args[3], invocation: __record_args[4], spanId: __record_args[5] });
const GpuSliceElaborationInputDto_46 = (__record_args) => ({ schemaVersion: __record_args[0], sourcePath: __record_args[1], builtinCatalog: __record_args[2], root: __record_args[3], environments: __record_args[4], environmentFields: __record_args[5], functions: __record_args[6], types: __record_args[7], adts: __record_args[8], constructors: __record_args[9], patterns: __record_args[10], params: __record_args[11], lets: __record_args[12], matchArms: __record_args[13], blockItems: __record_args[14], blocks: __record_args[15], matches: __record_args[16], expressions: __record_args[17], recursionGroups: __record_args[18], recursiveReferences: __record_args[19], spans: __record_args[20] });
const GpuSliceDiagnosticRelatedDto_47 = (__record_args) => ({ spanId: __record_args[0], label: __record_args[1] });
const GpuSliceDiagnosticDto_48 = (__record_args) => ({ code: __record_args[0], message: __record_args[1], spanId: __record_args[2], related: __record_args[3] });
const GpuSliceIrExprDto_49 = (__record_args) => ({ id: __record_args[0], functionId: __record_args[1], sourceExprId: __record_args[2], kind: __record_args[3], typeId: __record_args[4], spanId: __record_args[5], bindingId: __record_args[6], patternId: __record_args[7], targetFunctionId: __record_args[8], constructorId: __record_args[9], semanticId: __record_args[10], operatorId: __record_args[11], builtinName: __record_args[12], builtinOverloadId: __record_args[13], resourceOperation: __record_args[14], numberValue: __record_args[15], numberKind: __record_args[16], boolValue: __record_args[17], index: __record_args[18], children: __record_args[19], armIds: __record_args[20] });
const GpuSliceIrMatchArmDto_50 = (__record_args) => ({ id: __record_args[0], sourceArmId: __record_args[1], patternId: __record_args[2], bodyExprId: __record_args[3], spanId: __record_args[4] });
const GpuSliceIrFunctionDto_51 = (__record_args) => ({ functionId: __record_args[0], bindingId: __record_args[1], name: __record_args[2], paramIds: __record_args[3], resultTypeId: __record_args[4], bodyExprId: __record_args[5], recursionGroupId: __record_args[6], spanId: __record_args[7] });
const GpuSliceAdtLayoutDto_52 = (__record_args) => ({ id: __record_args[0], typeId: __record_args[1], typeNameId: __record_args[2], fieldIds: __record_args[3], spanId: __record_args[4] });
const GpuSliceAdtFieldDto_53 = (__record_args) => ({ id: __record_args[0], layoutId: __record_args[1], constructorId: __record_args[2], tag: __record_args[3], typeId: __record_args[4], spanId: __record_args[5] });
const GpuSliceLoweringSeedDto_54 = (__record_args) => ({ adtLayouts: __record_args[0], adtFields: __record_args[1] });
const GpuSliceLoweredLocalDto_55 = (__record_args) => ({ id: __record_args[0], functionId: __record_args[1], kind: __record_args[2], typeId: __record_args[3], bindingId: __record_args[4], mutable: __record_args[5], spanId: __record_args[6] });
const GpuSliceLoweredAtomDto_56 = (__record_args) => ({ id: __record_args[0], functionId: __record_args[1], kind: __record_args[2], typeId: __record_args[3], sourceExprId: __record_args[4], spanId: __record_args[5], localId: __record_args[6], numberValue: __record_args[7], numberKind: __record_args[8], boolValue: __record_args[9] });
const GpuSliceLoweredOperationDto_57 = (__record_args) => ({ id: __record_args[0], functionId: __record_args[1], kind: __record_args[2], typeId: __record_args[3], sourceExprId: __record_args[4], spanId: __record_args[5], targetFunctionId: __record_args[6], constructorId: __record_args[7], layoutId: __record_args[8], fieldId: __record_args[9], operatorId: __record_args[10], semanticId: __record_args[11], builtinName: __record_args[12], builtinOverloadId: __record_args[13], resourceOperation: __record_args[14], index: __record_args[15], args: __record_args[16] });
const GpuSliceLoweredStatementDto_58 = (__record_args) => ({ id: __record_args[0], functionId: __record_args[1], kind: __record_args[2], sourceExprId: __record_args[3], spanId: __record_args[4], localId: __record_args[5], operationId: __record_args[6], atomId: __record_args[7], conditionAtomId: __record_args[8], thenBlockId: __record_args[9], elseBlockId: __record_args[10], scrutineeAtomId: __record_args[11], layoutId: __record_args[12], caseIds: __record_args[13], bodyBlockId: __record_args[14], targetLocalIds: __record_args[15], valueAtomIds: __record_args[16], reason: __record_args[17] });
const GpuSliceLoweredBlockDto_59 = (__record_args) => ({ id: __record_args[0], functionId: __record_args[1], statementIds: __record_args[2] });
const GpuSliceLoweredCaseDto_60 = (__record_args) => ({ id: __record_args[0], functionId: __record_args[1], constructorId: __record_args[2], tag: __record_args[3], blockId: __record_args[4], spanId: __record_args[5] });
const GpuSliceLoweredFunctionDto_61 = (__record_args) => ({ functionId: __record_args[0], physicalParamLocalIds: __record_args[1], loopParamLocalIds: __record_args[2], bodyBlockId: __record_args[3], recursive: __record_args[4], spanId: __record_args[5] });
const GpuSliceLoweredProgramDto_62 = (__record_args) => ({ functions: __record_args[0], locals: __record_args[1], atoms: __record_args[2], operations: __record_args[3], statements: __record_args[4], blocks: __record_args[5], cases: __record_args[6] });
const GpuSliceCompilationOutputDto_63 = (__record_args) => ({ schemaVersion: __record_args[0], program: __record_args[1], shaderTypes: __record_args[2], typeEvidence: __record_args[3], occurrences: __record_args[4], builtinSelections: __record_args[5], irFunctions: __record_args[6], irExpressions: __record_args[7], irMatchArms: __record_args[8], adtLayouts: __record_args[9], adtFields: __record_args[10], loweredFunctions: __record_args[11], loweredLocals: __record_args[12], loweredAtoms: __record_args[13], loweredOperations: __record_args[14], loweredStatements: __record_args[15], loweredBlocks: __record_args[16], loweredCases: __record_args[17], slangModule: __record_args[18], callableName: __record_args[19], slangSource: __record_args[20], diagnostics: __record_args[21] });
return { "GpuSpanDto": GpuSpanDto_0, "GpuTypeDto": GpuTypeDto_1, "GpuBindingDto": GpuBindingDto_2, "GpuParamDto": GpuParamDto_3, "GpuExprDto": GpuExprDto_4, "GpuRootDto": GpuRootDto_5, "GpuFunctionDto": GpuFunctionDto_6, "GpuElaborationInputDto": GpuElaborationInputDto_7, "TypedGpuExprDto": TypedGpuExprDto_8, "TypedGpuFunctionDto": TypedGpuFunctionDto_9, "GpuCaptureDto": GpuCaptureDto_10, "GpuRepresentationFactDto": GpuRepresentationFactDto_11, "GpuSpecializationDto": GpuSpecializationDto_12, "GpuRootSpecializationDto": GpuRootSpecializationDto_13, "GpuSpecializedCallDto": GpuSpecializedCallDto_14, "GpuIrParamDto": GpuIrParamDto_15, "GpuIrExprDto": GpuIrExprDto_16, "GpuIrFunctionDto": GpuIrFunctionDto_17, "GpuDiagnosticDto": GpuDiagnosticDto_18, "GpuCompilationOutputDto": GpuCompilationOutputDto_19, "GpuSliceSpanDto": GpuSliceSpanDto_20, "GpuSliceTypeDto": GpuSliceTypeDto_21, "GpuSliceShaderTypeDto": GpuSliceShaderTypeDto_22, "GpuSliceTypeEvidenceDto": GpuSliceTypeEvidenceDto_23, "GpuSliceAdtDto": GpuSliceAdtDto_24, "GpuSliceConstructorDto": GpuSliceConstructorDto_25, "GpuSlicePatternDto": GpuSlicePatternDto_26, "GpuSliceParamDto": GpuSliceParamDto_27, "GpuSliceLetDto": GpuSliceLetDto_28, "GpuSliceMatchArmDto": GpuSliceMatchArmDto_29, "GpuSliceBlockItemDto": GpuSliceBlockItemDto_30, "GpuSliceBlockDto": GpuSliceBlockDto_31, "GpuSliceMatchDto": GpuSliceMatchDto_32, "GpuSliceExprDto": GpuSliceExprDto_33, "GpuSliceBuiltinCatalogIdentityDto": GpuSliceBuiltinCatalogIdentityDto_34, "GpuSliceBuiltinOverloadDto": GpuSliceBuiltinOverloadDto_35, "GpuSliceBuiltinCatalogDto": GpuSliceBuiltinCatalogDto_36, "GpuSliceFunctionDto": GpuSliceFunctionDto_37, "GpuSliceOccurrenceTypeDto": GpuSliceOccurrenceTypeDto_38, "GpuSliceBuiltinSelectionDto": GpuSliceBuiltinSelectionDto_39, "GpuSliceTypeElaborationOutputDto": GpuSliceTypeElaborationOutputDto_40, "GpuSliceRootDto": GpuSliceRootDto_41, "GpuSliceEnvironmentFieldDto": GpuSliceEnvironmentFieldDto_42, "GpuSliceEnvironmentDto": GpuSliceEnvironmentDto_43, "GpuSliceRecursionGroupDto": GpuSliceRecursionGroupDto_44, "GpuSliceRecursiveReferenceDto": GpuSliceRecursiveReferenceDto_45, "GpuSliceElaborationInputDto": GpuSliceElaborationInputDto_46, "GpuSliceDiagnosticRelatedDto": GpuSliceDiagnosticRelatedDto_47, "GpuSliceDiagnosticDto": GpuSliceDiagnosticDto_48, "GpuSliceIrExprDto": GpuSliceIrExprDto_49, "GpuSliceIrMatchArmDto": GpuSliceIrMatchArmDto_50, "GpuSliceIrFunctionDto": GpuSliceIrFunctionDto_51, "GpuSliceAdtLayoutDto": GpuSliceAdtLayoutDto_52, "GpuSliceAdtFieldDto": GpuSliceAdtFieldDto_53, "GpuSliceLoweringSeedDto": GpuSliceLoweringSeedDto_54, "GpuSliceLoweredLocalDto": GpuSliceLoweredLocalDto_55, "GpuSliceLoweredAtomDto": GpuSliceLoweredAtomDto_56, "GpuSliceLoweredOperationDto": GpuSliceLoweredOperationDto_57, "GpuSliceLoweredStatementDto": GpuSliceLoweredStatementDto_58, "GpuSliceLoweredBlockDto": GpuSliceLoweredBlockDto_59, "GpuSliceLoweredCaseDto": GpuSliceLoweredCaseDto_60, "GpuSliceLoweredFunctionDto": GpuSliceLoweredFunctionDto_61, "GpuSliceLoweredProgramDto": GpuSliceLoweredProgramDto_62, "GpuSliceCompilationOutputDto": GpuSliceCompilationOutputDto_63 };
  },
  (value) => { __wm_module_0 = value; },
);
let __wm_module_1;
__wm_define_module(
  "__wm_module_1",
  ["__wm_module_0"],
  async () => {
const GpuSliceAdtDto_24 = __wm_module_0["GpuSliceAdtDto"];
const GpuSliceAdtFieldDto_53 = __wm_module_0["GpuSliceAdtFieldDto"];
const GpuSliceAdtLayoutDto_52 = __wm_module_0["GpuSliceAdtLayoutDto"];
const GpuSliceConstructorDto_25 = __wm_module_0["GpuSliceConstructorDto"];
const GpuSliceElaborationInputDto_46 = __wm_module_0["GpuSliceElaborationInputDto"];
const GpuSliceLoweringSeedDto_54 = __wm_module_0["GpuSliceLoweringSeedDto"];
const GpuSliceTypeDto_21 = __wm_module_0["GpuSliceTypeDto"];
const numberEqual_66__wm_d2 = (left_64, right_65) => {
return __wm_op_and_d2(__wm_op_not((left_64 < right_65)), __wm_op_not((left_64 > right_65)));
};
const numberEqual_66 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numberEqual_66__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const reverseInto_67__wm_d2 = (items_68, reversed_69) => {
__wm_tail_0: while (true) {
{
const __wm_scalar_0_0 = items_68;
const __wm_scalar_0_1 = reversed_69;
if (__wm_scalar_0_0 === __wm_basis_Nil) {
const reversed_70 = __wm_scalar_0_1;
return reversed_70;
} else if (__wm_scalar_0_0?.ctor === -6 && __wm_scalar_0_0.args.length === 1 && __wm_is_tuple(__wm_scalar_0_0.args[0]) && __wm_scalar_0_0.args[0].length === 2) {
const head_71 = __wm_scalar_0_0.args[0][0];
const rest_72 = __wm_scalar_0_0.args[0][1];
const reversed_73 = __wm_scalar_0_1;
{
const __wm_tail_arg_0_0 = rest_72;
const __wm_tail_arg_0_1 = __wm_basis_Cons([head_71, reversed_73]);
items_68 = __wm_tail_arg_0_0;
reversed_69 = __wm_tail_arg_0_1;
continue __wm_tail_0;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reverseInto_67 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reverseInto_67__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findAdtType_74__wm_d2 = (types_75, typeNameId_76) => {
__wm_tail_1: while (true) {
{
const __wm_scalar_1_0 = types_75;
const __wm_scalar_1_1 = typeNameId_76;
if (__wm_scalar_1_0 === __wm_basis_Nil) {
const typeNameId_77 = __wm_scalar_1_1;
return __wm_fail("Panic", "missing schema-v2 ADT type");
} else if (__wm_scalar_1_0?.ctor === -6 && __wm_scalar_1_0.args.length === 1 && __wm_is_tuple(__wm_scalar_1_0.args[0]) && __wm_scalar_1_0.args[0].length === 2) {
const gpuType_78 = __wm_scalar_1_0.args[0][0];
const rest_79 = __wm_scalar_1_0.args[0][1];
const typeNameId_80 = __wm_scalar_1_1;
if (__wm_op_and_d2(__wm_eq(gpuType_78.kind, "adt"), numberEqual_66__wm_d2(gpuType_78.typeNameId, typeNameId_80))) {
return gpuType_78;
} else {
{
const __wm_tail_arg_1_0 = rest_79;
const __wm_tail_arg_1_1 = typeNameId_80;
types_75 = __wm_tail_arg_1_0;
typeNameId_76 = __wm_tail_arg_1_1;
continue __wm_tail_1;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findAdtType_74 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findAdtType_74__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findConstructor_81__wm_d2 = (constructors_82, id_83) => {
__wm_tail_2: while (true) {
{
const __wm_scalar_2_0 = constructors_82;
const __wm_scalar_2_1 = id_83;
if (__wm_scalar_2_0 === __wm_basis_Nil) {
const id_84 = __wm_scalar_2_1;
return __wm_fail("Panic", "missing schema-v2 constructor");
} else if (__wm_scalar_2_0?.ctor === -6 && __wm_scalar_2_0.args.length === 1 && __wm_is_tuple(__wm_scalar_2_0.args[0]) && __wm_scalar_2_0.args[0].length === 2) {
const constructor_85 = __wm_scalar_2_0.args[0][0];
const rest_86 = __wm_scalar_2_0.args[0][1];
const id_87 = __wm_scalar_2_1;
{
const exact_88 = constructor_85;
if (numberEqual_66__wm_d2(exact_88.id, id_87)) {
return exact_88;
} else {
{
const __wm_tail_arg_2_0 = rest_86;
const __wm_tail_arg_2_1 = id_87;
constructors_82 = __wm_tail_arg_2_0;
id_83 = __wm_tail_arg_2_1;
continue __wm_tail_2;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findConstructor_81 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findConstructor_81__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const fieldsForConstructors_89__wm_d6 = (constructorIds_90, constructors_91, layoutId_92, nextFieldId_93, reversedIds_94, reversedFields_95) => {
__wm_tail_3: while (true) {
{
const __wm_scalar_3_0 = constructorIds_90;
const __wm_scalar_3_1 = constructors_91;
const __wm_scalar_3_2 = layoutId_92;
const __wm_scalar_3_3 = nextFieldId_93;
const __wm_scalar_3_4 = reversedIds_94;
const __wm_scalar_3_5 = reversedFields_95;
if (__wm_scalar_3_0 === __wm_basis_Nil) {
const constructors_96 = __wm_scalar_3_1;
const layoutId_97 = __wm_scalar_3_2;
const nextFieldId_98 = __wm_scalar_3_3;
const reversedIds_99 = __wm_scalar_3_4;
const reversedFields_100 = __wm_scalar_3_5;
return [reverseInto_67__wm_d2(reversedIds_99, __wm_basis_Nil), nextFieldId_98, reverseInto_67__wm_d2(reversedFields_100, __wm_basis_Nil)];
} else if (__wm_scalar_3_0?.ctor === -6 && __wm_scalar_3_0.args.length === 1 && __wm_is_tuple(__wm_scalar_3_0.args[0]) && __wm_scalar_3_0.args[0].length === 2) {
const constructorId_101 = __wm_scalar_3_0.args[0][0];
const rest_102 = __wm_scalar_3_0.args[0][1];
const constructors_103 = __wm_scalar_3_1;
const layoutId_104 = __wm_scalar_3_2;
const nextFieldId_105 = __wm_scalar_3_3;
const reversedIds_106 = __wm_scalar_3_4;
const reversedFields_107 = __wm_scalar_3_5;
{
const constructor_108 = findConstructor_81__wm_d2(constructors_103, constructorId_101);
if ((constructor_108.payloadTypeId < 0)) {
{
const __wm_tail_arg_3_0 = rest_102;
const __wm_tail_arg_3_1 = constructors_103;
const __wm_tail_arg_3_2 = layoutId_104;
const __wm_tail_arg_3_3 = nextFieldId_105;
const __wm_tail_arg_3_4 = reversedIds_106;
const __wm_tail_arg_3_5 = reversedFields_107;
constructorIds_90 = __wm_tail_arg_3_0;
constructors_91 = __wm_tail_arg_3_1;
layoutId_92 = __wm_tail_arg_3_2;
nextFieldId_93 = __wm_tail_arg_3_3;
reversedIds_94 = __wm_tail_arg_3_4;
reversedFields_95 = __wm_tail_arg_3_5;
continue __wm_tail_3;
}
} else {
{
const field_109 = { id: nextFieldId_105, layoutId: layoutId_104, constructorId: constructor_108.id, tag: constructor_108.tag, typeId: constructor_108.payloadTypeId, spanId: constructor_108.spanId };
{
const __wm_tail_arg_4_0 = rest_102;
const __wm_tail_arg_4_1 = constructors_103;
const __wm_tail_arg_4_2 = layoutId_104;
const __wm_tail_arg_4_3 = (nextFieldId_105 + 1);
const __wm_tail_arg_4_4 = __wm_basis_Cons([field_109.id, reversedIds_106]);
const __wm_tail_arg_4_5 = __wm_basis_Cons([field_109, reversedFields_107]);
constructorIds_90 = __wm_tail_arg_4_0;
constructors_91 = __wm_tail_arg_4_1;
layoutId_92 = __wm_tail_arg_4_2;
nextFieldId_93 = __wm_tail_arg_4_3;
reversedIds_94 = __wm_tail_arg_4_4;
reversedFields_95 = __wm_tail_arg_4_5;
continue __wm_tail_3;
}
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const fieldsForConstructors_89 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return fieldsForConstructors_89__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const buildLayouts_110__wm_d7 = (adts_111, types_112, constructors_113, nextLayoutId_114, nextFieldId_115, reversedLayouts_116, reversedFields_117) => {
__wm_tail_4: while (true) {
{
const __wm_scalar_4_0 = adts_111;
const __wm_scalar_4_1 = types_112;
const __wm_scalar_4_2 = constructors_113;
const __wm_scalar_4_3 = nextLayoutId_114;
const __wm_scalar_4_4 = nextFieldId_115;
const __wm_scalar_4_5 = reversedLayouts_116;
const __wm_scalar_4_6 = reversedFields_117;
if (__wm_scalar_4_0 === __wm_basis_Nil) {
const types_118 = __wm_scalar_4_1;
const constructors_119 = __wm_scalar_4_2;
const nextLayoutId_120 = __wm_scalar_4_3;
const nextFieldId_121 = __wm_scalar_4_4;
const reversedLayouts_122 = __wm_scalar_4_5;
const reversedFields_123 = __wm_scalar_4_6;
return [reverseInto_67__wm_d2(reversedLayouts_122, __wm_basis_Nil), reverseInto_67__wm_d2(reversedFields_123, __wm_basis_Nil)];
} else if (__wm_scalar_4_0?.ctor === -6 && __wm_scalar_4_0.args.length === 1 && __wm_is_tuple(__wm_scalar_4_0.args[0]) && __wm_scalar_4_0.args[0].length === 2) {
const adt_124 = __wm_scalar_4_0.args[0][0];
const rest_125 = __wm_scalar_4_0.args[0][1];
const types_126 = __wm_scalar_4_1;
const constructors_127 = __wm_scalar_4_2;
const nextLayoutId_128 = __wm_scalar_4_3;
const nextFieldId_129 = __wm_scalar_4_4;
const reversedLayouts_130 = __wm_scalar_4_5;
const reversedFields_131 = __wm_scalar_4_6;
{
const gpuType_132 = findAdtType_74__wm_d2(types_126, adt_124.typeNameId);
const __wm_bind_0 = fieldsForConstructors_89__wm_d6(Js.Array.toList(adt_124.constructorIds), constructors_127, nextLayoutId_128, nextFieldId_129, __wm_basis_Nil, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_0) && __wm_bind_0.length === 3)) __wm_fail("Bind", "pattern match failure in let binding");
const fieldIds_133 = __wm_bind_0[0];
const afterFieldId_134 = __wm_bind_0[1];
const fields_135 = __wm_bind_0[2];
const layout_136 = { id: nextLayoutId_128, typeId: gpuType_132.id, typeNameId: adt_124.typeNameId, fieldIds: Js.Array.fromList(fieldIds_133), spanId: adt_124.spanId };
{
const __wm_tail_arg_5_0 = rest_125;
const __wm_tail_arg_5_1 = types_126;
const __wm_tail_arg_5_2 = constructors_127;
const __wm_tail_arg_5_3 = (nextLayoutId_128 + 1);
const __wm_tail_arg_5_4 = afterFieldId_134;
const __wm_tail_arg_5_5 = __wm_basis_Cons([layout_136, reversedLayouts_130]);
const __wm_tail_arg_5_6 = reverseInto_67__wm_d2(fields_135, reversedFields_131);
adts_111 = __wm_tail_arg_5_0;
types_112 = __wm_tail_arg_5_1;
constructors_113 = __wm_tail_arg_5_2;
nextLayoutId_114 = __wm_tail_arg_5_3;
nextFieldId_115 = __wm_tail_arg_5_4;
reversedLayouts_116 = __wm_tail_arg_5_5;
reversedFields_117 = __wm_tail_arg_5_6;
continue __wm_tail_4;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildLayouts_110 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return buildLayouts_110__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const buildSliceLayouts_141 = (__arg) => {
if (true) {
const input_137 = __arg;
const __wm_bind_1 = buildLayouts_110__wm_d7(Js.Array.toList(input_137.adts), Js.Array.toList(input_137.types), Js.Array.toList(input_137.constructors), 0, 0, __wm_basis_Nil, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_1) && __wm_bind_1.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const layouts_138 = __wm_bind_1[0];
const fields_139 = __wm_bind_1[1];
const seed_140 = { adtLayouts: Js.Array.fromList(layouts_138), adtFields: Js.Array.fromList(fields_139) };
return seed_140;
}
__wm_fail("Match", "pattern match failure in function");
};
return { "numberEqual": numberEqual_66, "numberEqual__wm_d2": numberEqual_66__wm_d2, "reverseInto": reverseInto_67, "reverseInto__wm_d2": reverseInto_67__wm_d2, "findAdtType": findAdtType_74, "findAdtType__wm_d2": findAdtType_74__wm_d2, "findConstructor": findConstructor_81, "findConstructor__wm_d2": findConstructor_81__wm_d2, "fieldsForConstructors": fieldsForConstructors_89, "fieldsForConstructors__wm_d6": fieldsForConstructors_89__wm_d6, "buildLayouts": buildLayouts_110, "buildLayouts__wm_d7": buildLayouts_110__wm_d7, "buildSliceLayouts": buildSliceLayouts_141 };
  },
  (value) => { __wm_module_1 = value; },
);
let __wm_module_2;
__wm_define_module(
  "__wm_module_2",
  ["__wm_module_0"],
  async () => {
const GpuSliceAdtFieldDto_53 = __wm_module_0["GpuSliceAdtFieldDto"];
const GpuSliceAdtLayoutDto_52 = __wm_module_0["GpuSliceAdtLayoutDto"];
const GpuSliceConstructorDto_25 = __wm_module_0["GpuSliceConstructorDto"];
const GpuSliceIrExprDto_49 = __wm_module_0["GpuSliceIrExprDto"];
const GpuSliceIrFunctionDto_51 = __wm_module_0["GpuSliceIrFunctionDto"];
const GpuSliceIrMatchArmDto_50 = __wm_module_0["GpuSliceIrMatchArmDto"];
const GpuSliceLoweredAtomDto_56 = __wm_module_0["GpuSliceLoweredAtomDto"];
const GpuSliceLoweredBlockDto_59 = __wm_module_0["GpuSliceLoweredBlockDto"];
const GpuSliceLoweredCaseDto_60 = __wm_module_0["GpuSliceLoweredCaseDto"];
const GpuSliceLoweredFunctionDto_61 = __wm_module_0["GpuSliceLoweredFunctionDto"];
const GpuSliceLoweredLocalDto_55 = __wm_module_0["GpuSliceLoweredLocalDto"];
const GpuSliceLoweredOperationDto_57 = __wm_module_0["GpuSliceLoweredOperationDto"];
const GpuSliceLoweredProgramDto_62 = __wm_module_0["GpuSliceLoweredProgramDto"];
const GpuSliceLoweredStatementDto_58 = __wm_module_0["GpuSliceLoweredStatementDto"];
const GpuSliceParamDto_27 = __wm_module_0["GpuSliceParamDto"];
const GpuSlicePatternDto_26 = __wm_module_0["GpuSlicePatternDto"];
const SliceLowerContext_142 = (__record_args) => ({ functions: __record_args[0], expressions: __record_args[1], matchArms: __record_args[2], params: __record_args[3], patterns: __record_args[4], constructors: __record_args[5], layouts: __record_args[6], fields: __record_args[7] });
const SliceLowerState_143 = (__record_args) => ({ nextLocalId: __record_args[0], nextAtomId: __record_args[1], nextOperationId: __record_args[2], nextStatementId: __record_args[3], nextBlockId: __record_args[4], nextCaseId: __record_args[5], functions: __record_args[6], locals: __record_args[7], atoms: __record_args[8], operations: __record_args[9], statements: __record_args[10], blocks: __record_args[11], cases: __record_args[12] });
const numberEqual_146__wm_d2 = (left_144, right_145) => {
return __wm_op_and_d2(__wm_op_not((left_144 < right_145)), __wm_op_not((left_144 > right_145)));
};
const numberEqual_146 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numberEqual_146__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const reverseInto_147__wm_d2 = (items_148, reversed_149) => {
__wm_tail_5: while (true) {
{
const __wm_scalar_5_0 = items_148;
const __wm_scalar_5_1 = reversed_149;
if (__wm_scalar_5_0 === __wm_basis_Nil) {
const reversed_150 = __wm_scalar_5_1;
return reversed_150;
} else if (__wm_scalar_5_0?.ctor === -6 && __wm_scalar_5_0.args.length === 1 && __wm_is_tuple(__wm_scalar_5_0.args[0]) && __wm_scalar_5_0.args[0].length === 2) {
const head_151 = __wm_scalar_5_0.args[0][0];
const rest_152 = __wm_scalar_5_0.args[0][1];
const reversed_153 = __wm_scalar_5_1;
{
const __wm_tail_arg_6_0 = rest_152;
const __wm_tail_arg_6_1 = __wm_basis_Cons([head_151, reversed_153]);
items_148 = __wm_tail_arg_6_0;
reversed_149 = __wm_tail_arg_6_1;
continue __wm_tail_5;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reverseInto_147 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reverseInto_147__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const append_154__wm_d2 = (left_155, right_156) => {
const __wm_scalar_6_0 = left_155;
const __wm_scalar_6_1 = right_156;
if (__wm_scalar_6_0 === __wm_basis_Nil) {
const right_157 = __wm_scalar_6_1;
return right_157;
} else if (__wm_scalar_6_0?.ctor === -6 && __wm_scalar_6_0.args.length === 1 && __wm_is_tuple(__wm_scalar_6_0.args[0]) && __wm_scalar_6_0.args[0].length === 2) {
const head_158 = __wm_scalar_6_0.args[0][0];
const rest_159 = __wm_scalar_6_0.args[0][1];
const right_160 = __wm_scalar_6_1;
return __wm_basis_Cons([head_158, append_154__wm_d2(rest_159, right_160)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const append_154 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return append_154__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const initialLowerState_162 = (__arg) => {
if (__arg === undefined) {

const state_161 = { nextLocalId: 0, nextAtomId: 0, nextOperationId: 0, nextStatementId: 0, nextBlockId: 0, nextCaseId: 0, functions: __wm_basis_Nil, locals: __wm_basis_Nil, atoms: __wm_basis_Nil, operations: __wm_basis_Nil, statements: __wm_basis_Nil, blocks: __wm_basis_Nil, cases: __wm_basis_Nil };
return state_161;
}
__wm_fail("Match", "pattern match failure in function");
};
const findIrFunction_163__wm_d2 = (items_164, id_165) => {
__wm_tail_6: while (true) {
{
const __wm_scalar_7_0 = items_164;
const __wm_scalar_7_1 = id_165;
if (__wm_scalar_7_0 === __wm_basis_Nil) {
const id_166 = __wm_scalar_7_1;
return __wm_fail("Panic", "missing schema-v2 IR function");
} else if (__wm_scalar_7_0?.ctor === -6 && __wm_scalar_7_0.args.length === 1 && __wm_is_tuple(__wm_scalar_7_0.args[0]) && __wm_scalar_7_0.args[0].length === 2) {
const item_167 = __wm_scalar_7_0.args[0][0];
const rest_168 = __wm_scalar_7_0.args[0][1];
const id_169 = __wm_scalar_7_1;
{
const exact_170 = item_167;
if (numberEqual_146__wm_d2(exact_170.functionId, id_169)) {
return exact_170;
} else {
{
const __wm_tail_arg_7_0 = rest_168;
const __wm_tail_arg_7_1 = id_169;
items_164 = __wm_tail_arg_7_0;
id_165 = __wm_tail_arg_7_1;
continue __wm_tail_6;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findIrFunction_163 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findIrFunction_163__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findIrExpression_171__wm_d2 = (items_172, id_173) => {
__wm_tail_7: while (true) {
{
const __wm_scalar_8_0 = items_172;
const __wm_scalar_8_1 = id_173;
if (__wm_scalar_8_0 === __wm_basis_Nil) {
const id_174 = __wm_scalar_8_1;
return __wm_fail("Panic", "missing schema-v2 IR expression");
} else if (__wm_scalar_8_0?.ctor === -6 && __wm_scalar_8_0.args.length === 1 && __wm_is_tuple(__wm_scalar_8_0.args[0]) && __wm_scalar_8_0.args[0].length === 2) {
const item_175 = __wm_scalar_8_0.args[0][0];
const rest_176 = __wm_scalar_8_0.args[0][1];
const id_177 = __wm_scalar_8_1;
{
const exact_178 = item_175;
if (numberEqual_146__wm_d2(exact_178.id, id_177)) {
return exact_178;
} else {
{
const __wm_tail_arg_8_0 = rest_176;
const __wm_tail_arg_8_1 = id_177;
items_172 = __wm_tail_arg_8_0;
id_173 = __wm_tail_arg_8_1;
continue __wm_tail_7;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findIrExpression_171 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findIrExpression_171__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findIrMatchArm_179__wm_d2 = (items_180, id_181) => {
__wm_tail_8: while (true) {
{
const __wm_scalar_9_0 = items_180;
const __wm_scalar_9_1 = id_181;
if (__wm_scalar_9_0 === __wm_basis_Nil) {
const id_182 = __wm_scalar_9_1;
return __wm_fail("Panic", "missing schema-v2 IR match arm");
} else if (__wm_scalar_9_0?.ctor === -6 && __wm_scalar_9_0.args.length === 1 && __wm_is_tuple(__wm_scalar_9_0.args[0]) && __wm_scalar_9_0.args[0].length === 2) {
const item_183 = __wm_scalar_9_0.args[0][0];
const rest_184 = __wm_scalar_9_0.args[0][1];
const id_185 = __wm_scalar_9_1;
{
const exact_186 = item_183;
if (numberEqual_146__wm_d2(exact_186.id, id_185)) {
return exact_186;
} else {
{
const __wm_tail_arg_9_0 = rest_184;
const __wm_tail_arg_9_1 = id_185;
items_180 = __wm_tail_arg_9_0;
id_181 = __wm_tail_arg_9_1;
continue __wm_tail_8;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findIrMatchArm_179 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findIrMatchArm_179__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLoweredAtom_187__wm_d2 = (items_188, id_189) => {
__wm_tail_9: while (true) {
{
const __wm_scalar_10_0 = items_188;
const __wm_scalar_10_1 = id_189;
if (__wm_scalar_10_0 === __wm_basis_Nil) {
const id_190 = __wm_scalar_10_1;
return __wm_fail("Panic", "missing lowered atom");
} else if (__wm_scalar_10_0?.ctor === -6 && __wm_scalar_10_0.args.length === 1 && __wm_is_tuple(__wm_scalar_10_0.args[0]) && __wm_scalar_10_0.args[0].length === 2) {
const item_191 = __wm_scalar_10_0.args[0][0];
const rest_192 = __wm_scalar_10_0.args[0][1];
const id_193 = __wm_scalar_10_1;
{
const exact_194 = item_191;
if (numberEqual_146__wm_d2(exact_194.id, id_193)) {
return exact_194;
} else {
{
const __wm_tail_arg_10_0 = rest_192;
const __wm_tail_arg_10_1 = id_193;
items_188 = __wm_tail_arg_10_0;
id_189 = __wm_tail_arg_10_1;
continue __wm_tail_9;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLoweredAtom_187 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLoweredAtom_187__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findParam_195__wm_d2 = (items_196, id_197) => {
__wm_tail_10: while (true) {
{
const __wm_scalar_11_0 = items_196;
const __wm_scalar_11_1 = id_197;
if (__wm_scalar_11_0 === __wm_basis_Nil) {
const id_198 = __wm_scalar_11_1;
return __wm_fail("Panic", "missing schema-v2 parameter");
} else if (__wm_scalar_11_0?.ctor === -6 && __wm_scalar_11_0.args.length === 1 && __wm_is_tuple(__wm_scalar_11_0.args[0]) && __wm_scalar_11_0.args[0].length === 2) {
const item_199 = __wm_scalar_11_0.args[0][0];
const rest_200 = __wm_scalar_11_0.args[0][1];
const id_201 = __wm_scalar_11_1;
{
const exact_202 = item_199;
if (numberEqual_146__wm_d2(exact_202.id, id_201)) {
return exact_202;
} else {
{
const __wm_tail_arg_11_0 = rest_200;
const __wm_tail_arg_11_1 = id_201;
items_196 = __wm_tail_arg_11_0;
id_197 = __wm_tail_arg_11_1;
continue __wm_tail_10;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findParam_195 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findParam_195__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findPattern_203__wm_d2 = (items_204, id_205) => {
__wm_tail_11: while (true) {
{
const __wm_scalar_12_0 = items_204;
const __wm_scalar_12_1 = id_205;
if (__wm_scalar_12_0 === __wm_basis_Nil) {
const id_206 = __wm_scalar_12_1;
return __wm_fail("Panic", "missing schema-v2 pattern");
} else if (__wm_scalar_12_0?.ctor === -6 && __wm_scalar_12_0.args.length === 1 && __wm_is_tuple(__wm_scalar_12_0.args[0]) && __wm_scalar_12_0.args[0].length === 2) {
const item_207 = __wm_scalar_12_0.args[0][0];
const rest_208 = __wm_scalar_12_0.args[0][1];
const id_209 = __wm_scalar_12_1;
{
const exact_210 = item_207;
if (numberEqual_146__wm_d2(exact_210.id, id_209)) {
return exact_210;
} else {
{
const __wm_tail_arg_12_0 = rest_208;
const __wm_tail_arg_12_1 = id_209;
items_204 = __wm_tail_arg_12_0;
id_205 = __wm_tail_arg_12_1;
continue __wm_tail_11;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findPattern_203 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findPattern_203__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findConstructor_211__wm_d2 = (items_212, id_213) => {
__wm_tail_12: while (true) {
{
const __wm_scalar_13_0 = items_212;
const __wm_scalar_13_1 = id_213;
if (__wm_scalar_13_0 === __wm_basis_Nil) {
const id_214 = __wm_scalar_13_1;
return __wm_fail("Panic", "missing schema-v2 constructor");
} else if (__wm_scalar_13_0?.ctor === -6 && __wm_scalar_13_0.args.length === 1 && __wm_is_tuple(__wm_scalar_13_0.args[0]) && __wm_scalar_13_0.args[0].length === 2) {
const item_215 = __wm_scalar_13_0.args[0][0];
const rest_216 = __wm_scalar_13_0.args[0][1];
const id_217 = __wm_scalar_13_1;
{
const exact_218 = item_215;
if (numberEqual_146__wm_d2(exact_218.id, id_217)) {
return exact_218;
} else {
{
const __wm_tail_arg_13_0 = rest_216;
const __wm_tail_arg_13_1 = id_217;
items_212 = __wm_tail_arg_13_0;
id_213 = __wm_tail_arg_13_1;
continue __wm_tail_12;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findConstructor_211 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findConstructor_211__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLayoutForType_219__wm_d2 = (items_220, typeId_221) => {
__wm_tail_13: while (true) {
{
const __wm_scalar_14_0 = items_220;
const __wm_scalar_14_1 = typeId_221;
if (__wm_scalar_14_0 === __wm_basis_Nil) {
const typeId_222 = __wm_scalar_14_1;
return __wm_fail("Panic", "missing schema-v2 ADT layout");
} else if (__wm_scalar_14_0?.ctor === -6 && __wm_scalar_14_0.args.length === 1 && __wm_is_tuple(__wm_scalar_14_0.args[0]) && __wm_scalar_14_0.args[0].length === 2) {
const item_223 = __wm_scalar_14_0.args[0][0];
const rest_224 = __wm_scalar_14_0.args[0][1];
const typeId_225 = __wm_scalar_14_1;
{
const exact_226 = item_223;
if (numberEqual_146__wm_d2(exact_226.typeId, typeId_225)) {
return exact_226;
} else {
{
const __wm_tail_arg_14_0 = rest_224;
const __wm_tail_arg_14_1 = typeId_225;
items_220 = __wm_tail_arg_14_0;
typeId_221 = __wm_tail_arg_14_1;
continue __wm_tail_13;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLayoutForType_219 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLayoutForType_219__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLayoutForConstructor_227__wm_d3 = (layouts_230, fields_231, constructorId_232) => {
__wm_tail_14: while (true) {
{
const __wm_scalar_15_0 = layouts_230;
const __wm_scalar_15_1 = fields_231;
const __wm_scalar_15_2 = constructorId_232;
if (__wm_scalar_15_0 === __wm_basis_Nil) {
const fields_233 = __wm_scalar_15_1;
const constructorId_234 = __wm_scalar_15_2;
return __wm_fail("Panic", "missing constructor ADT layout");
} else if (__wm_scalar_15_0?.ctor === -6 && __wm_scalar_15_0.args.length === 1 && __wm_is_tuple(__wm_scalar_15_0.args[0]) && __wm_scalar_15_0.args[0].length === 2) {
const layout_235 = __wm_scalar_15_0.args[0][0];
const rest_236 = __wm_scalar_15_0.args[0][1];
const fields_237 = __wm_scalar_15_1;
const constructorId_238 = __wm_scalar_15_2;
{
const exact_239 = layout_235;
if (layoutContainsConstructor_228__wm_d3(Js.Array.toList(exact_239.fieldIds), fields_237, constructorId_238)) {
return exact_239;
} else {
{
const __wm_tail_arg_15_0 = rest_236;
const __wm_tail_arg_15_1 = fields_237;
const __wm_tail_arg_15_2 = constructorId_238;
layouts_230 = __wm_tail_arg_15_0;
fields_231 = __wm_tail_arg_15_1;
constructorId_232 = __wm_tail_arg_15_2;
continue __wm_tail_14;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLayoutForConstructor_227 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findLayoutForConstructor_227__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const layoutContainsConstructor_228__wm_d3 = (fieldIds_240, fields_241, constructorId_242) => {
__wm_tail_15: while (true) {
{
const __wm_scalar_16_0 = fieldIds_240;
const __wm_scalar_16_1 = fields_241;
const __wm_scalar_16_2 = constructorId_242;
if (__wm_scalar_16_0 === __wm_basis_Nil) {
const fields_243 = __wm_scalar_16_1;
const constructorId_244 = __wm_scalar_16_2;
return false;
} else if (__wm_scalar_16_0?.ctor === -6 && __wm_scalar_16_0.args.length === 1 && __wm_is_tuple(__wm_scalar_16_0.args[0]) && __wm_scalar_16_0.args[0].length === 2) {
const fieldId_245 = __wm_scalar_16_0.args[0][0];
const rest_246 = __wm_scalar_16_0.args[0][1];
const fields_247 = __wm_scalar_16_1;
const constructorId_248 = __wm_scalar_16_2;
{
const field_249 = findField_229__wm_d2(fields_247, fieldId_245);
if (numberEqual_146__wm_d2(field_249.constructorId, constructorId_248)) {
return true;
} else {
{
const __wm_tail_arg_16_0 = rest_246;
const __wm_tail_arg_16_1 = fields_247;
const __wm_tail_arg_16_2 = constructorId_248;
fieldIds_240 = __wm_tail_arg_16_0;
fields_241 = __wm_tail_arg_16_1;
constructorId_242 = __wm_tail_arg_16_2;
continue __wm_tail_15;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const layoutContainsConstructor_228 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return layoutContainsConstructor_228__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const findField_229__wm_d2 = (items_250, id_251) => {
__wm_tail_16: while (true) {
{
const __wm_scalar_17_0 = items_250;
const __wm_scalar_17_1 = id_251;
if (__wm_scalar_17_0 === __wm_basis_Nil) {
const id_252 = __wm_scalar_17_1;
return __wm_fail("Panic", "missing schema-v2 ADT field");
} else if (__wm_scalar_17_0?.ctor === -6 && __wm_scalar_17_0.args.length === 1 && __wm_is_tuple(__wm_scalar_17_0.args[0]) && __wm_scalar_17_0.args[0].length === 2) {
const item_253 = __wm_scalar_17_0.args[0][0];
const rest_254 = __wm_scalar_17_0.args[0][1];
const id_255 = __wm_scalar_17_1;
{
const exact_256 = item_253;
if (numberEqual_146__wm_d2(exact_256.id, id_255)) {
return exact_256;
} else {
{
const __wm_tail_arg_17_0 = rest_254;
const __wm_tail_arg_17_1 = id_255;
items_250 = __wm_tail_arg_17_0;
id_251 = __wm_tail_arg_17_1;
continue __wm_tail_16;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findField_229 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findField_229__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findFieldForConstructor_257__wm_d2 = (items_258, constructorId_259) => {
__wm_tail_17: while (true) {
{
const __wm_scalar_18_0 = items_258;
const __wm_scalar_18_1 = constructorId_259;
if (__wm_scalar_18_0 === __wm_basis_Nil) {
const constructorId_260 = __wm_scalar_18_1;
return __wm_fail("Panic", "missing constructor payload field");
} else if (__wm_scalar_18_0?.ctor === -6 && __wm_scalar_18_0.args.length === 1 && __wm_is_tuple(__wm_scalar_18_0.args[0]) && __wm_scalar_18_0.args[0].length === 2) {
const item_261 = __wm_scalar_18_0.args[0][0];
const rest_262 = __wm_scalar_18_0.args[0][1];
const constructorId_263 = __wm_scalar_18_1;
{
const exact_264 = item_261;
if (numberEqual_146__wm_d2(exact_264.constructorId, constructorId_263)) {
return exact_264;
} else {
{
const __wm_tail_arg_18_0 = rest_262;
const __wm_tail_arg_18_1 = constructorId_263;
items_258 = __wm_tail_arg_18_0;
constructorId_259 = __wm_tail_arg_18_1;
continue __wm_tail_17;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findFieldForConstructor_257 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findFieldForConstructor_257__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const pushLocal_268__wm_d2 = (local_265, state_266) => {
const next_267 = { ...state_266, nextLocalId: (state_266.nextLocalId + 1), locals: __wm_basis_Cons([local_265, state_266.locals]) };
return [local_265.id, next_267];
};
const pushLocal_268 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return pushLocal_268__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const freshLocal_277__wm_d7 = (functionId_269, kind_270, typeId_271, bindingId_272, mutable_273, spanId_274, state_275) => {
const local_276 = { id: state_275.nextLocalId, functionId: functionId_269, kind: kind_270, typeId: typeId_271, bindingId: bindingId_272, mutable: mutable_273, spanId: spanId_274 };
return pushLocal_268__wm_d2(local_276, state_275);
};
const freshLocal_277 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return freshLocal_277__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const pushAtom_281__wm_d2 = (atom_278, state_279) => {
const next_280 = { ...state_279, nextAtomId: (state_279.nextAtomId + 1), atoms: __wm_basis_Cons([atom_278, state_279.atoms]) };
return [atom_278.id, next_280];
};
const pushAtom_281 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return pushAtom_281__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const localAtom_289__wm_d6 = (functionId_282, typeId_283, sourceExprId_284, spanId_285, localId_286, state_287) => {
const atom_288 = { id: state_287.nextAtomId, functionId: functionId_282, kind: "local", typeId: typeId_283, sourceExprId: sourceExprId_284, spanId: spanId_285, localId: localId_286, numberValue: 0, numberKind: "", boolValue: false };
return pushAtom_281__wm_d2(atom_288, state_287);
};
const localAtom_289 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return localAtom_289__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const literalAtom_293__wm_d2 = (expression_290, state_291) => {
const atom_292 = { id: state_291.nextAtomId, functionId: expression_290.functionId, kind: expression_290.kind, typeId: expression_290.typeId, sourceExprId: expression_290.sourceExprId, spanId: expression_290.spanId, localId: __wm_op_sub(1), numberValue: expression_290.numberValue, numberKind: expression_290.numberKind, boolValue: expression_290.boolValue };
return pushAtom_281__wm_d2(atom_292, state_291);
};
const literalAtom_293 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return literalAtom_293__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const pushOperation_297__wm_d2 = (operation_294, state_295) => {
const next_296 = { ...state_295, nextOperationId: (state_295.nextOperationId + 1), operations: __wm_basis_Cons([operation_294, state_295.operations]) };
return [operation_294.id, next_296];
};
const pushOperation_297 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return pushOperation_297__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const baseOperation_302__wm_d3 = (expression_298, kind_299, state_300) => {
const operation_301 = { id: state_300.nextOperationId, functionId: expression_298.functionId, kind: kind_299, typeId: expression_298.typeId, sourceExprId: expression_298.sourceExprId, spanId: expression_298.spanId, targetFunctionId: expression_298.targetFunctionId, constructorId: expression_298.constructorId, layoutId: __wm_op_sub(1), fieldId: __wm_op_sub(1), operatorId: expression_298.operatorId, semanticId: expression_298.semanticId, builtinName: expression_298.builtinName, builtinOverloadId: expression_298.builtinOverloadId, resourceOperation: expression_298.resourceOperation, index: expression_298.index, args: Js.Array.fromList(__wm_basis_Nil) };
return operation_301;
};
const baseOperation_302 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return baseOperation_302__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const pushStatement_306__wm_d2 = (statement_303, state_304) => {
const next_305 = { ...state_304, nextStatementId: (state_304.nextStatementId + 1), statements: __wm_basis_Cons([statement_303, state_304.statements]) };
return [statement_303.id, next_305];
};
const pushStatement_306 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return pushStatement_306__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const baseStatement_313__wm_d5 = (functionId_307, kind_308, sourceExprId_309, spanId_310, state_311) => {
const statement_312 = { id: state_311.nextStatementId, functionId: functionId_307, kind: kind_308, sourceExprId: sourceExprId_309, spanId: spanId_310, localId: __wm_op_sub(1), operationId: __wm_op_sub(1), atomId: __wm_op_sub(1), conditionAtomId: __wm_op_sub(1), thenBlockId: __wm_op_sub(1), elseBlockId: __wm_op_sub(1), scrutineeAtomId: __wm_op_sub(1), layoutId: __wm_op_sub(1), caseIds: Js.Array.fromList(__wm_basis_Nil), bodyBlockId: __wm_op_sub(1), targetLocalIds: Js.Array.fromList(__wm_basis_Nil), valueAtomIds: Js.Array.fromList(__wm_basis_Nil), reason: "" };
return statement_312;
};
const baseStatement_313 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return baseStatement_313__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const pushBlock_319__wm_d3 = (functionId_314, statementIds_315, state_316) => {
const block_317 = { id: state_316.nextBlockId, functionId: functionId_314, statementIds: Js.Array.fromList(statementIds_315) };
const next_318 = { ...state_316, nextBlockId: (state_316.nextBlockId + 1), blocks: __wm_basis_Cons([block_317, state_316.blocks]) };
return [block_317.id, next_318];
};
const pushBlock_319 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return pushBlock_319__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const pushCase_323__wm_d2 = (gpuCase_320, state_321) => {
const next_322 = { ...state_321, nextCaseId: (state_321.nextCaseId + 1), cases: __wm_basis_Cons([gpuCase_320, state_321.cases]) };
return [gpuCase_320.id, next_322];
};
const pushCase_323 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return pushCase_323__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const pushFunction_327__wm_d2 = (fn_324, state_325) => {
const next_326 = { ...state_325, functions: __wm_basis_Cons([fn_324, state_325.functions]) };
return next_326;
};
const pushFunction_327 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return pushFunction_327__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const finishLoweredProgram_330 = (__arg) => {
if (true) {
const state_328 = __arg;
const output_329 = { functions: Js.Array.fromList(reverseInto_147__wm_d2(state_328.functions, __wm_basis_Nil)), locals: Js.Array.fromList(reverseInto_147__wm_d2(state_328.locals, __wm_basis_Nil)), atoms: Js.Array.fromList(reverseInto_147__wm_d2(state_328.atoms, __wm_basis_Nil)), operations: Js.Array.fromList(reverseInto_147__wm_d2(state_328.operations, __wm_basis_Nil)), statements: Js.Array.fromList(reverseInto_147__wm_d2(state_328.statements, __wm_basis_Nil)), blocks: Js.Array.fromList(reverseInto_147__wm_d2(state_328.blocks, __wm_basis_Nil)), cases: Js.Array.fromList(reverseInto_147__wm_d2(state_328.cases, __wm_basis_Nil)) };
return output_329;
}
__wm_fail("Match", "pattern match failure in function");
};
return { "SliceLowerContext": SliceLowerContext_142, "SliceLowerState": SliceLowerState_143, "numberEqual": numberEqual_146, "numberEqual__wm_d2": numberEqual_146__wm_d2, "reverseInto": reverseInto_147, "reverseInto__wm_d2": reverseInto_147__wm_d2, "append": append_154, "append__wm_d2": append_154__wm_d2, "initialLowerState": initialLowerState_162, "findIrFunction": findIrFunction_163, "findIrFunction__wm_d2": findIrFunction_163__wm_d2, "findIrExpression": findIrExpression_171, "findIrExpression__wm_d2": findIrExpression_171__wm_d2, "findIrMatchArm": findIrMatchArm_179, "findIrMatchArm__wm_d2": findIrMatchArm_179__wm_d2, "findLoweredAtom": findLoweredAtom_187, "findLoweredAtom__wm_d2": findLoweredAtom_187__wm_d2, "findParam": findParam_195, "findParam__wm_d2": findParam_195__wm_d2, "findPattern": findPattern_203, "findPattern__wm_d2": findPattern_203__wm_d2, "findConstructor": findConstructor_211, "findConstructor__wm_d2": findConstructor_211__wm_d2, "findLayoutForType": findLayoutForType_219, "findLayoutForType__wm_d2": findLayoutForType_219__wm_d2, "findLayoutForConstructor": findLayoutForConstructor_227, "findLayoutForConstructor__wm_d3": findLayoutForConstructor_227__wm_d3, "layoutContainsConstructor": layoutContainsConstructor_228, "layoutContainsConstructor__wm_d3": layoutContainsConstructor_228__wm_d3, "findField": findField_229, "findField__wm_d2": findField_229__wm_d2, "findFieldForConstructor": findFieldForConstructor_257, "findFieldForConstructor__wm_d2": findFieldForConstructor_257__wm_d2, "pushLocal": pushLocal_268, "pushLocal__wm_d2": pushLocal_268__wm_d2, "freshLocal": freshLocal_277, "freshLocal__wm_d7": freshLocal_277__wm_d7, "pushAtom": pushAtom_281, "pushAtom__wm_d2": pushAtom_281__wm_d2, "localAtom": localAtom_289, "localAtom__wm_d6": localAtom_289__wm_d6, "literalAtom": literalAtom_293, "literalAtom__wm_d2": literalAtom_293__wm_d2, "pushOperation": pushOperation_297, "pushOperation__wm_d2": pushOperation_297__wm_d2, "baseOperation": baseOperation_302, "baseOperation__wm_d3": baseOperation_302__wm_d3, "pushStatement": pushStatement_306, "pushStatement__wm_d2": pushStatement_306__wm_d2, "baseStatement": baseStatement_313, "baseStatement__wm_d5": baseStatement_313__wm_d5, "pushBlock": pushBlock_319, "pushBlock__wm_d3": pushBlock_319__wm_d3, "pushCase": pushCase_323, "pushCase__wm_d2": pushCase_323__wm_d2, "pushFunction": pushFunction_327, "pushFunction__wm_d2": pushFunction_327__wm_d2, "finishLoweredProgram": finishLoweredProgram_330 };
  },
  (value) => { __wm_module_2 = value; },
);
let __wm_module_3;
__wm_define_module(
  "__wm_module_3",
  ["__wm_module_0", "__wm_module_2"],
  async () => {
const GpuSliceAdtFieldDto_53 = __wm_module_0["GpuSliceAdtFieldDto"];
const GpuSliceAdtLayoutDto_52 = __wm_module_0["GpuSliceAdtLayoutDto"];
const GpuSliceCompilationOutputDto_63 = __wm_module_0["GpuSliceCompilationOutputDto"];
const GpuSliceConstructorDto_25 = __wm_module_0["GpuSliceConstructorDto"];
const GpuSliceIrExprDto_49 = __wm_module_0["GpuSliceIrExprDto"];
const GpuSliceIrFunctionDto_51 = __wm_module_0["GpuSliceIrFunctionDto"];
const GpuSliceIrMatchArmDto_50 = __wm_module_0["GpuSliceIrMatchArmDto"];
const GpuSliceLoweredAtomDto_56 = __wm_module_0["GpuSliceLoweredAtomDto"];
const GpuSliceLoweredCaseDto_60 = __wm_module_0["GpuSliceLoweredCaseDto"];
const GpuSliceLoweredFunctionDto_61 = __wm_module_0["GpuSliceLoweredFunctionDto"];
const GpuSliceLoweredLocalDto_55 = __wm_module_0["GpuSliceLoweredLocalDto"];
const GpuSliceLoweredOperationDto_57 = __wm_module_0["GpuSliceLoweredOperationDto"];
const GpuSliceLoweredProgramDto_62 = __wm_module_0["GpuSliceLoweredProgramDto"];
const GpuSliceLoweredStatementDto_58 = __wm_module_0["GpuSliceLoweredStatementDto"];
const GpuSliceParamDto_27 = __wm_module_0["GpuSliceParamDto"];
const GpuSlicePatternDto_26 = __wm_module_0["GpuSlicePatternDto"];
const SliceLowerContext_142 = __wm_module_2["SliceLowerContext"];
const SliceLowerState_143 = __wm_module_2["SliceLowerState"];
const append_154 = __wm_module_2["append"];
const append_154__wm_d2 = __wm_module_2["append__wm_d2"];
const baseOperation_302 = __wm_module_2["baseOperation"];
const baseOperation_302__wm_d3 = __wm_module_2["baseOperation__wm_d3"];
const baseStatement_313 = __wm_module_2["baseStatement"];
const baseStatement_313__wm_d5 = __wm_module_2["baseStatement__wm_d5"];
const findConstructor_211 = __wm_module_2["findConstructor"];
const findConstructor_211__wm_d2 = __wm_module_2["findConstructor__wm_d2"];
const findFieldForConstructor_257 = __wm_module_2["findFieldForConstructor"];
const findFieldForConstructor_257__wm_d2 = __wm_module_2["findFieldForConstructor__wm_d2"];
const findIrFunction_163 = __wm_module_2["findIrFunction"];
const findIrFunction_163__wm_d2 = __wm_module_2["findIrFunction__wm_d2"];
const findIrExpression_171 = __wm_module_2["findIrExpression"];
const findIrExpression_171__wm_d2 = __wm_module_2["findIrExpression__wm_d2"];
const findIrMatchArm_179 = __wm_module_2["findIrMatchArm"];
const findIrMatchArm_179__wm_d2 = __wm_module_2["findIrMatchArm__wm_d2"];
const findLoweredAtom_187 = __wm_module_2["findLoweredAtom"];
const findLoweredAtom_187__wm_d2 = __wm_module_2["findLoweredAtom__wm_d2"];
const findLayoutForType_219 = __wm_module_2["findLayoutForType"];
const findLayoutForType_219__wm_d2 = __wm_module_2["findLayoutForType__wm_d2"];
const findParam_195 = __wm_module_2["findParam"];
const findParam_195__wm_d2 = __wm_module_2["findParam__wm_d2"];
const findPattern_203 = __wm_module_2["findPattern"];
const findPattern_203__wm_d2 = __wm_module_2["findPattern__wm_d2"];
const finishLoweredProgram_330 = __wm_module_2["finishLoweredProgram"];
const freshLocal_277 = __wm_module_2["freshLocal"];
const freshLocal_277__wm_d7 = __wm_module_2["freshLocal__wm_d7"];
const initialLowerState_162 = __wm_module_2["initialLowerState"];
const literalAtom_293 = __wm_module_2["literalAtom"];
const literalAtom_293__wm_d2 = __wm_module_2["literalAtom__wm_d2"];
const localAtom_289 = __wm_module_2["localAtom"];
const localAtom_289__wm_d6 = __wm_module_2["localAtom__wm_d6"];
const numberEqual_146 = __wm_module_2["numberEqual"];
const numberEqual_146__wm_d2 = __wm_module_2["numberEqual__wm_d2"];
const pushAtom_281 = __wm_module_2["pushAtom"];
const pushAtom_281__wm_d2 = __wm_module_2["pushAtom__wm_d2"];
const pushBlock_319 = __wm_module_2["pushBlock"];
const pushBlock_319__wm_d3 = __wm_module_2["pushBlock__wm_d3"];
const pushCase_323 = __wm_module_2["pushCase"];
const pushCase_323__wm_d2 = __wm_module_2["pushCase__wm_d2"];
const pushFunction_327 = __wm_module_2["pushFunction"];
const pushFunction_327__wm_d2 = __wm_module_2["pushFunction__wm_d2"];
const pushOperation_297 = __wm_module_2["pushOperation"];
const pushOperation_297__wm_d2 = __wm_module_2["pushOperation__wm_d2"];
const pushStatement_306 = __wm_module_2["pushStatement"];
const pushStatement_306__wm_d2 = __wm_module_2["pushStatement__wm_d2"];
const reverseInto_147 = __wm_module_2["reverseInto"];
const reverseInto_147__wm_d2 = __wm_module_2["reverseInto__wm_d2"];
const LowerScope_331 = (__record_args) => ({ bindings: __record_args[0], loopParamLocalIds: __record_args[1] });
const LowerValueResult_332 = (__record_args) => ({ statementIds: __record_args[0], atomId: __record_args[1], state: __record_args[2] });
const LowerTailResult_333 = (__record_args) => ({ statementIds: __record_args[0], state: __record_args[1] });
const LowerChildrenResult_334 = (__record_args) => ({ statementIds: __record_args[0], atomIds: __record_args[1], state: __record_args[2] });
const LowerBindResult_335 = (__record_args) => ({ statementIds: __record_args[0], scope: __record_args[1], state: __record_args[2] });
const LowerParamResult_336 = (__record_args) => ({ physicalLocalIds: __record_args[0], activeLocalIds: __record_args[1], initialStatementIds: __record_args[2], iterationStatementIds: __record_args[3], scope: __record_args[4], state: __record_args[5] });
const LowerCasesResult_337 = (__record_args) => ({ caseIds: __record_args[0], state: __record_args[1] });
const emptyScope_339 = (__arg) => {
if (__arg === undefined) {

const scope_338 = { bindings: Map.empty(Map.numberCompare), loopParamLocalIds: __wm_basis_Nil };
return scope_338;
}
__wm_fail("Match", "pattern match failure in function");
};
const lowerLetValue_340__wm_d5 = (lower_345, expression_346, scope_347, context_348, state_349) => {
const __wm_return_value_0 = Js.Array.toList(expression_346.children);
if (__wm_return_value_0?.ctor === -6 && __wm_return_value_0.args.length === 1 && __wm_is_tuple(__wm_return_value_0.args[0]) && __wm_return_value_0.args[0].length === 2 && __wm_return_value_0.args[0][1]?.ctor === -6 && __wm_return_value_0.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_0.args[0][1].args[0]) && __wm_return_value_0.args[0][1].args[0].length === 2 && __wm_return_value_0.args[0][1].args[0][1] === __wm_basis_Nil) {
const valueExpressionId_350 = __wm_return_value_0.args[0][0];
const bodyExpressionId_351 = __wm_return_value_0.args[0][1].args[0][0];
const value_352 = lower_345([valueExpressionId_350, scope_347, context_348, state_349]);
const bound_353 = bindPattern_342__wm_d6(expression_346.patternId, value_352.atomId, expression_346, scope_347, context_348, value_352.state);
const body_354 = lower_345([bodyExpressionId_351, bound_353.scope, context_348, bound_353.state]);
const result_355 = { statementIds: append_154__wm_d2(value_352.statementIds, append_154__wm_d2(bound_353.statementIds, body_354.statementIds)), atomId: body_354.atomId, state: body_354.state };
return result_355;
} else if (true) {

return __wm_fail("Panic", "functional let does not have value and body children");
}
__wm_fail("Match", "non-exhaustive match");
};
const lowerLetValue_340 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return lowerLetValue_340__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerSequenceValue_341__wm_d5 = (lower_356, expression_357, scope_358, context_359, state_360) => {
const __wm_return_value_1 = Js.Array.toList(expression_357.children);
if (__wm_return_value_1?.ctor === -6 && __wm_return_value_1.args.length === 1 && __wm_is_tuple(__wm_return_value_1.args[0]) && __wm_return_value_1.args[0].length === 2 && __wm_return_value_1.args[0][1]?.ctor === -6 && __wm_return_value_1.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_1.args[0][1].args[0]) && __wm_return_value_1.args[0][1].args[0].length === 2 && __wm_return_value_1.args[0][1].args[0][1] === __wm_basis_Nil) {
const discardedExpressionId_361 = __wm_return_value_1.args[0][0];
const bodyExpressionId_362 = __wm_return_value_1.args[0][1].args[0][0];
const discarded_363 = lower_356([discardedExpressionId_361, scope_358, context_359, state_360]);
const body_364 = lower_356([bodyExpressionId_362, scope_358, context_359, discarded_363.state]);
const result_365 = { statementIds: append_154__wm_d2(discarded_363.statementIds, body_364.statementIds), atomId: body_364.atomId, state: body_364.state };
return result_365;
} else if (true) {

return __wm_fail("Panic", "functional sequence does not have discarded and body children");
}
__wm_fail("Match", "non-exhaustive match");
};
const lowerSequenceValue_341 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return lowerSequenceValue_341__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const bindPattern_342__wm_d6 = (patternId_366, atomId_367, owner_368, scope_369, context_370, state_371) => {
const pattern_372 = findPattern_203__wm_d2(context_370.patterns, patternId_366);
if (__wm_eq(pattern_372.kind, "wildcard")) {
const result_373 = { statementIds: __wm_basis_Nil, scope: scope_369, state: state_371 };
return result_373;
} else {
if (__wm_eq(pattern_372.kind, "binding")) {
return bindPatternValue_343__wm_d7(pattern_372, atomId_367, owner_368, "copy", __wm_op_sub(1), scope_369, state_371);
} else {
if (__wm_eq(pattern_372.kind, "tuple")) {
return bindTupleChildren_344__wm_d8(Js.Array.toList(pattern_372.children), atomId_367, owner_368, scope_369, context_370, state_371, 0, __wm_basis_Nil);
} else {
return __wm_fail("Panic", "constructor pattern reached irrefutable binding lowering");
}
}
}
};
const bindPattern_342 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return bindPattern_342__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const bindPatternValue_343__wm_d7 = (pattern_374, atomId_375, owner_376, operationKind_377, index_378, scope_379, state_380) => {
const operation_381 = { ...baseOperation_302__wm_d3(owner_376, operationKind_377, state_380), typeId: pattern_374.typeId, index: index_378, args: Js.Array.fromList(__wm_basis_Cons([atomId_375, __wm_basis_Nil])) };
const __wm_bind_2 = pushOperation_297__wm_d2(operation_381, state_380);
if (!(__wm_is_tuple(__wm_bind_2) && __wm_bind_2.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_382 = __wm_bind_2[0];
const afterOperation_383 = __wm_bind_2[1];
const __wm_bind_3 = freshLocal_277__wm_d7(owner_376.functionId, "binding", pattern_374.typeId, pattern_374.bindingId, false, pattern_374.spanId, afterOperation_383);
if (!(__wm_is_tuple(__wm_bind_3) && __wm_bind_3.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_384 = __wm_bind_3[0];
const afterLocal_385 = __wm_bind_3[1];
const statement_386 = { ...baseStatement_313__wm_d5(owner_376.functionId, "let", owner_376.sourceExprId, pattern_374.spanId, afterLocal_385), localId: localId_384, operationId: operationId_382, reason: "binding" };
const __wm_bind_4 = pushStatement_306__wm_d2(statement_386, afterLocal_385);
if (!(__wm_is_tuple(__wm_bind_4) && __wm_bind_4.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_387 = __wm_bind_4[0];
const afterStatement_388 = __wm_bind_4[1];
const nextScope_389 = { ...scope_379, bindings: Map.set([scope_379.bindings, pattern_374.bindingId, localId_384]) };
const result_390 = { statementIds: __wm_basis_Cons([statementId_387, __wm_basis_Nil]), scope: nextScope_389, state: afterStatement_388 };
return result_390;
};
const bindPatternValue_343 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return bindPatternValue_343__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const bindTupleChildren_344__wm_d8 = (childPatternIds_391, atomId_392, owner_393, scope_394, context_395, state_396, index_397, reversedStatements_398) => {
__wm_tail_18: while (true) {
{
const __wm_scalar_19_0 = childPatternIds_391;
const __wm_scalar_19_1 = atomId_392;
const __wm_scalar_19_2 = owner_393;
const __wm_scalar_19_3 = scope_394;
const __wm_scalar_19_4 = context_395;
const __wm_scalar_19_5 = state_396;
const __wm_scalar_19_6 = index_397;
const __wm_scalar_19_7 = reversedStatements_398;
if (__wm_scalar_19_0 === __wm_basis_Nil) {
const atomId_399 = __wm_scalar_19_1;
const owner_400 = __wm_scalar_19_2;
const scope_401 = __wm_scalar_19_3;
const context_402 = __wm_scalar_19_4;
const state_403 = __wm_scalar_19_5;
const index_404 = __wm_scalar_19_6;
const reversedStatements_405 = __wm_scalar_19_7;
{
const result_406 = { statementIds: reverseInto_147__wm_d2(reversedStatements_405, __wm_basis_Nil), scope: scope_401, state: state_403 };
return result_406;
}
} else if (__wm_scalar_19_0?.ctor === -6 && __wm_scalar_19_0.args.length === 1 && __wm_is_tuple(__wm_scalar_19_0.args[0]) && __wm_scalar_19_0.args[0].length === 2) {
const childPatternId_407 = __wm_scalar_19_0.args[0][0];
const rest_408 = __wm_scalar_19_0.args[0][1];
const atomId_409 = __wm_scalar_19_1;
const owner_410 = __wm_scalar_19_2;
const scope_411 = __wm_scalar_19_3;
const context_412 = __wm_scalar_19_4;
const state_413 = __wm_scalar_19_5;
const index_414 = __wm_scalar_19_6;
const reversedStatements_415 = __wm_scalar_19_7;
{
const pattern_416 = findPattern_203__wm_d2(context_412.patterns, childPatternId_407);
if (__wm_eq(pattern_416.kind, "wildcard")) {
{
const __wm_tail_arg_19_0 = rest_408;
const __wm_tail_arg_19_1 = atomId_409;
const __wm_tail_arg_19_2 = owner_410;
const __wm_tail_arg_19_3 = scope_411;
const __wm_tail_arg_19_4 = context_412;
const __wm_tail_arg_19_5 = state_413;
const __wm_tail_arg_19_6 = (index_414 + 1);
const __wm_tail_arg_19_7 = reversedStatements_415;
childPatternIds_391 = __wm_tail_arg_19_0;
atomId_392 = __wm_tail_arg_19_1;
owner_393 = __wm_tail_arg_19_2;
scope_394 = __wm_tail_arg_19_3;
context_395 = __wm_tail_arg_19_4;
state_396 = __wm_tail_arg_19_5;
index_397 = __wm_tail_arg_19_6;
reversedStatements_398 = __wm_tail_arg_19_7;
continue __wm_tail_18;
}
} else {
{
const bound_417 = bindPatternValue_343__wm_d7(pattern_416, atomId_409, owner_410, "project", index_414, scope_411, state_413);
{
const __wm_tail_arg_20_0 = rest_408;
const __wm_tail_arg_20_1 = atomId_409;
const __wm_tail_arg_20_2 = owner_410;
const __wm_tail_arg_20_3 = bound_417.scope;
const __wm_tail_arg_20_4 = context_412;
const __wm_tail_arg_20_5 = bound_417.state;
const __wm_tail_arg_20_6 = (index_414 + 1);
const __wm_tail_arg_20_7 = reverseInto_147__wm_d2(bound_417.statementIds, reversedStatements_415);
childPatternIds_391 = __wm_tail_arg_20_0;
atomId_392 = __wm_tail_arg_20_1;
owner_393 = __wm_tail_arg_20_2;
scope_394 = __wm_tail_arg_20_3;
context_395 = __wm_tail_arg_20_4;
state_396 = __wm_tail_arg_20_5;
index_397 = __wm_tail_arg_20_6;
reversedStatements_398 = __wm_tail_arg_20_7;
continue __wm_tail_18;
}
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const bindTupleChildren_344 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 8) return bindTupleChildren_344__wm_d8(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7]);
__wm_fail("Match", "pattern match failure in function");
};
const assignJoin_423__wm_d4 = (expression_418, localId_419, atomId_420, state_421) => {
const statement_422 = { ...baseStatement_313__wm_d5(expression_418.functionId, "assign", expression_418.sourceExprId, expression_418.spanId, state_421), localId: localId_419, atomId: atomId_420, reason: "join" };
return pushStatement_306__wm_d2(statement_422, state_421);
};
const assignJoin_423 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return assignJoin_423__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerIfValue_451__wm_d5 = (lower_424, expression_425, scope_426, context_427, state_428) => {
const __wm_return_value_2 = Js.Array.toList(expression_425.children);
if (__wm_return_value_2?.ctor === -6 && __wm_return_value_2.args.length === 1 && __wm_is_tuple(__wm_return_value_2.args[0]) && __wm_return_value_2.args[0].length === 2 && __wm_return_value_2.args[0][1]?.ctor === -6 && __wm_return_value_2.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_2.args[0][1].args[0]) && __wm_return_value_2.args[0][1].args[0].length === 2 && __wm_return_value_2.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_2.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_2.args[0][1].args[0][1].args[0]) && __wm_return_value_2.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_2.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const conditionExpressionId_429 = __wm_return_value_2.args[0][0];
const thenExpressionId_430 = __wm_return_value_2.args[0][1].args[0][0];
const elseExpressionId_431 = __wm_return_value_2.args[0][1].args[0][1].args[0][0];
const condition_432 = lower_424([conditionExpressionId_429, scope_426, context_427, state_428]);
const __wm_bind_5 = freshLocal_277__wm_d7(expression_425.functionId, "join", expression_425.typeId, __wm_op_sub(1), true, expression_425.spanId, condition_432.state);
if (!(__wm_is_tuple(__wm_bind_5) && __wm_bind_5.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const joinLocalId_433 = __wm_bind_5[0];
const afterJoin_434 = __wm_bind_5[1];
const thenValue_435 = lower_424([thenExpressionId_430, scope_426, context_427, afterJoin_434]);
const __wm_bind_6 = assignJoin_423__wm_d4(expression_425, joinLocalId_433, thenValue_435.atomId, thenValue_435.state);
if (!(__wm_is_tuple(__wm_bind_6) && __wm_bind_6.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const thenAssignId_436 = __wm_bind_6[0];
const afterThenAssign_437 = __wm_bind_6[1];
const __wm_bind_7 = pushBlock_319__wm_d3(expression_425.functionId, append_154__wm_d2(thenValue_435.statementIds, __wm_basis_Cons([thenAssignId_436, __wm_basis_Nil])), afterThenAssign_437);
if (!(__wm_is_tuple(__wm_bind_7) && __wm_bind_7.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const thenBlockId_438 = __wm_bind_7[0];
const afterThenBlock_439 = __wm_bind_7[1];
const elseValue_440 = lower_424([elseExpressionId_431, scope_426, context_427, afterThenBlock_439]);
const __wm_bind_8 = assignJoin_423__wm_d4(expression_425, joinLocalId_433, elseValue_440.atomId, elseValue_440.state);
if (!(__wm_is_tuple(__wm_bind_8) && __wm_bind_8.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const elseAssignId_441 = __wm_bind_8[0];
const afterElseAssign_442 = __wm_bind_8[1];
const __wm_bind_9 = pushBlock_319__wm_d3(expression_425.functionId, append_154__wm_d2(elseValue_440.statementIds, __wm_basis_Cons([elseAssignId_441, __wm_basis_Nil])), afterElseAssign_442);
if (!(__wm_is_tuple(__wm_bind_9) && __wm_bind_9.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const elseBlockId_443 = __wm_bind_9[0];
const afterElseBlock_444 = __wm_bind_9[1];
const statement_445 = { ...baseStatement_313__wm_d5(expression_425.functionId, "if", expression_425.sourceExprId, expression_425.spanId, afterElseBlock_444), localId: joinLocalId_433, conditionAtomId: condition_432.atomId, thenBlockId: thenBlockId_438, elseBlockId: elseBlockId_443, reason: "join" };
const __wm_bind_10 = pushStatement_306__wm_d2(statement_445, afterElseBlock_444);
if (!(__wm_is_tuple(__wm_bind_10) && __wm_bind_10.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_446 = __wm_bind_10[0];
const afterIf_447 = __wm_bind_10[1];
const __wm_bind_11 = localAtom_289__wm_d6(expression_425.functionId, expression_425.typeId, expression_425.sourceExprId, expression_425.spanId, joinLocalId_433, afterIf_447);
if (!(__wm_is_tuple(__wm_bind_11) && __wm_bind_11.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_448 = __wm_bind_11[0];
const afterAtom_449 = __wm_bind_11[1];
const result_450 = { statementIds: append_154__wm_d2(condition_432.statementIds, __wm_basis_Cons([statementId_446, __wm_basis_Nil])), atomId: atomId_448, state: afterAtom_449 };
return result_450;
} else if (true) {

return __wm_fail("Panic", "functional if does not have three children");
}
__wm_fail("Match", "non-exhaustive match");
};
const lowerIfValue_451 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return lowerIfValue_451__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerMatchValue_452__wm_d5 = (lower_456, expression_457, scope_458, context_459, state_460) => {
const __wm_return_value_3 = Js.Array.toList(expression_457.children);
if (__wm_return_value_3?.ctor === -6 && __wm_return_value_3.args.length === 1 && __wm_is_tuple(__wm_return_value_3.args[0]) && __wm_return_value_3.args[0].length === 2 && __wm_return_value_3.args[0][1] === __wm_basis_Nil) {
const scrutineeExpressionId_461 = __wm_return_value_3.args[0][0];
const scrutinee_462 = lower_456([scrutineeExpressionId_461, scope_458, context_459, state_460]);
const scrutineeExpression_463 = findIrExpression_171__wm_d2(context_459.expressions, scrutineeExpressionId_461);
const layout_464 = findLayoutForType_219__wm_d2(context_459.layouts, scrutineeExpression_463.typeId);
const __wm_bind_12 = freshLocal_277__wm_d7(expression_457.functionId, "join", expression_457.typeId, __wm_op_sub(1), true, expression_457.spanId, scrutinee_462.state);
if (!(__wm_is_tuple(__wm_bind_12) && __wm_bind_12.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const joinLocalId_465 = __wm_bind_12[0];
const afterJoin_466 = __wm_bind_12[1];
const cases_467 = lowerMatchValueCases_453__wm_d9(lower_456, Js.Array.toList(expression_457.armIds), expression_457, scrutinee_462.atomId, joinLocalId_465, scope_458, context_459, afterJoin_466, __wm_basis_Nil);
const statement_468 = { ...baseStatement_313__wm_d5(expression_457.functionId, "switch", expression_457.sourceExprId, expression_457.spanId, cases_467.state), localId: joinLocalId_465, scrutineeAtomId: scrutinee_462.atomId, layoutId: layout_464.id, caseIds: Js.Array.fromList(cases_467.caseIds), reason: "join" };
const __wm_bind_13 = pushStatement_306__wm_d2(statement_468, cases_467.state);
if (!(__wm_is_tuple(__wm_bind_13) && __wm_bind_13.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_469 = __wm_bind_13[0];
const afterSwitch_470 = __wm_bind_13[1];
const __wm_bind_14 = localAtom_289__wm_d6(expression_457.functionId, expression_457.typeId, expression_457.sourceExprId, expression_457.spanId, joinLocalId_465, afterSwitch_470);
if (!(__wm_is_tuple(__wm_bind_14) && __wm_bind_14.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_471 = __wm_bind_14[0];
const afterAtom_472 = __wm_bind_14[1];
const result_473 = { statementIds: append_154__wm_d2(scrutinee_462.statementIds, __wm_basis_Cons([statementId_469, __wm_basis_Nil])), atomId: atomId_471, state: afterAtom_472 };
return result_473;
} else if (true) {

return __wm_fail("Panic", "functional match does not have one scrutinee child");
}
__wm_fail("Match", "non-exhaustive match");
};
const lowerMatchValue_452 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return lowerMatchValue_452__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerMatchValueCases_453__wm_d9 = (lower_474, armIds_475, expression_476, scrutineeAtomId_477, joinLocalId_478, scope_479, context_480, state_481, reversedCases_482) => {
__wm_tail_19: while (true) {
{
const __wm_scalar_20_0 = lower_474;
const __wm_scalar_20_1 = armIds_475;
const __wm_scalar_20_2 = expression_476;
const __wm_scalar_20_3 = scrutineeAtomId_477;
const __wm_scalar_20_4 = joinLocalId_478;
const __wm_scalar_20_5 = scope_479;
const __wm_scalar_20_6 = context_480;
const __wm_scalar_20_7 = state_481;
const __wm_scalar_20_8 = reversedCases_482;
if (__wm_scalar_20_1 === __wm_basis_Nil) {
const lower_483 = __wm_scalar_20_0;
const expression_484 = __wm_scalar_20_2;
const scrutineeAtomId_485 = __wm_scalar_20_3;
const joinLocalId_486 = __wm_scalar_20_4;
const scope_487 = __wm_scalar_20_5;
const context_488 = __wm_scalar_20_6;
const state_489 = __wm_scalar_20_7;
const reversedCases_490 = __wm_scalar_20_8;
{
const result_491 = { caseIds: reverseInto_147__wm_d2(reversedCases_490, __wm_basis_Nil), state: state_489 };
return result_491;
}
} else if (__wm_scalar_20_1?.ctor === -6 && __wm_scalar_20_1.args.length === 1 && __wm_is_tuple(__wm_scalar_20_1.args[0]) && __wm_scalar_20_1.args[0].length === 2) {
const lower_492 = __wm_scalar_20_0;
const armId_493 = __wm_scalar_20_1.args[0][0];
const rest_494 = __wm_scalar_20_1.args[0][1];
const expression_495 = __wm_scalar_20_2;
const scrutineeAtomId_496 = __wm_scalar_20_3;
const joinLocalId_497 = __wm_scalar_20_4;
const scope_498 = __wm_scalar_20_5;
const context_499 = __wm_scalar_20_6;
const state_500 = __wm_scalar_20_7;
const reversedCases_501 = __wm_scalar_20_8;
{
const arm_502 = findIrMatchArm_179__wm_d2(context_499.matchArms, armId_493);
const pattern_503 = findPattern_203__wm_d2(context_499.patterns, arm_502.patternId);
const constructor_504 = findConstructor_211__wm_d2(context_499.constructors, pattern_503.constructorId);
const bound_505 = bindMatchPayload_454__wm_d6(pattern_503, scrutineeAtomId_496, expression_495, scope_498, context_499, state_500);
const body_506 = lower_492([arm_502.bodyExprId, bound_505.scope, context_499, bound_505.state]);
const __wm_bind_15 = assignJoin_423__wm_d4(expression_495, joinLocalId_497, body_506.atomId, body_506.state);
if (!(__wm_is_tuple(__wm_bind_15) && __wm_bind_15.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const assignId_507 = __wm_bind_15[0];
const afterAssign_508 = __wm_bind_15[1];
const __wm_bind_16 = pushBlock_319__wm_d3(expression_495.functionId, append_154__wm_d2(bound_505.statementIds, append_154__wm_d2(body_506.statementIds, __wm_basis_Cons([assignId_507, __wm_basis_Nil]))), afterAssign_508);
if (!(__wm_is_tuple(__wm_bind_16) && __wm_bind_16.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const blockId_509 = __wm_bind_16[0];
const afterBlock_510 = __wm_bind_16[1];
const gpuCase_511 = { id: afterBlock_510.nextCaseId, functionId: expression_495.functionId, constructorId: constructor_504.id, tag: constructor_504.tag, blockId: blockId_509, spanId: arm_502.spanId };
const __wm_bind_17 = pushCase_323__wm_d2(gpuCase_511, afterBlock_510);
if (!(__wm_is_tuple(__wm_bind_17) && __wm_bind_17.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const caseId_512 = __wm_bind_17[0];
const afterCase_513 = __wm_bind_17[1];
{
const __wm_tail_arg_21_0 = lower_492;
const __wm_tail_arg_21_1 = rest_494;
const __wm_tail_arg_21_2 = expression_495;
const __wm_tail_arg_21_3 = scrutineeAtomId_496;
const __wm_tail_arg_21_4 = joinLocalId_497;
const __wm_tail_arg_21_5 = scope_498;
const __wm_tail_arg_21_6 = context_499;
const __wm_tail_arg_21_7 = afterCase_513;
const __wm_tail_arg_21_8 = __wm_basis_Cons([caseId_512, reversedCases_501]);
lower_474 = __wm_tail_arg_21_0;
armIds_475 = __wm_tail_arg_21_1;
expression_476 = __wm_tail_arg_21_2;
scrutineeAtomId_477 = __wm_tail_arg_21_3;
joinLocalId_478 = __wm_tail_arg_21_4;
scope_479 = __wm_tail_arg_21_5;
context_480 = __wm_tail_arg_21_6;
state_481 = __wm_tail_arg_21_7;
reversedCases_482 = __wm_tail_arg_21_8;
continue __wm_tail_19;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const lowerMatchValueCases_453 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return lowerMatchValueCases_453__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const bindMatchPayload_454__wm_d6 = (pattern_514, scrutineeAtomId_515, owner_516, scope_517, context_518, state_519) => {
const __wm_return_value_4 = Js.Array.toList(pattern_514.children);
if (__wm_return_value_4 === __wm_basis_Nil) {

const result_520 = { statementIds: __wm_basis_Nil, scope: scope_517, state: state_519 };
return result_520;
} else if (__wm_return_value_4?.ctor === -6 && __wm_return_value_4.args.length === 1 && __wm_is_tuple(__wm_return_value_4.args[0]) && __wm_return_value_4.args[0].length === 2 && __wm_return_value_4.args[0][1] === __wm_basis_Nil) {
const childPatternId_521 = __wm_return_value_4.args[0][0];
const child_522 = findPattern_203__wm_d2(context_518.patterns, childPatternId_521);
if (__wm_eq(child_522.kind, "wildcard")) {
const result_523 = { statementIds: __wm_basis_Nil, scope: scope_517, state: state_519 };
return result_523;
} else {
const field_524 = findFieldForConstructor_257__wm_d2(context_518.fields, pattern_514.constructorId);
const operation_525 = { ...baseOperation_302__wm_d3(owner_516, "payload", state_519), typeId: child_522.typeId, constructorId: pattern_514.constructorId, layoutId: field_524.layoutId, fieldId: field_524.id, args: Js.Array.fromList(__wm_basis_Cons([scrutineeAtomId_515, __wm_basis_Nil])) };
const __wm_bind_18 = pushOperation_297__wm_d2(operation_525, state_519);
if (!(__wm_is_tuple(__wm_bind_18) && __wm_bind_18.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_526 = __wm_bind_18[0];
const afterOperation_527 = __wm_bind_18[1];
const __wm_bind_19 = freshLocal_277__wm_d7(owner_516.functionId, "binding", child_522.typeId, child_522.bindingId, false, child_522.spanId, afterOperation_527);
if (!(__wm_is_tuple(__wm_bind_19) && __wm_bind_19.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_528 = __wm_bind_19[0];
const afterLocal_529 = __wm_bind_19[1];
const statement_530 = { ...baseStatement_313__wm_d5(owner_516.functionId, "let", owner_516.sourceExprId, child_522.spanId, afterLocal_529), localId: localId_528, operationId: operationId_526, reason: "binding" };
const __wm_bind_20 = pushStatement_306__wm_d2(statement_530, afterLocal_529);
if (!(__wm_is_tuple(__wm_bind_20) && __wm_bind_20.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_531 = __wm_bind_20[0];
const afterStatement_532 = __wm_bind_20[1];
const nextScope_533 = { ...scope_517, bindings: Map.set([scope_517.bindings, child_522.bindingId, localId_528]) };
const result_534 = { statementIds: __wm_basis_Cons([statementId_531, __wm_basis_Nil]), scope: nextScope_533, state: afterStatement_532 };
return result_534;
}
} else if (__wm_return_value_4?.ctor === -6 && __wm_return_value_4.args.length === 1 && __wm_is_tuple(__wm_return_value_4.args[0]) && __wm_return_value_4.args[0].length === 2) {
const firstChildPatternId_535 = __wm_return_value_4.args[0][0];
const restChildPatternIds_536 = __wm_return_value_4.args[0][1];
return bindMatchPayloadLanes_455__wm_d9(__wm_basis_Cons([firstChildPatternId_535, restChildPatternIds_536]), pattern_514, scrutineeAtomId_515, owner_516, scope_517, context_518, state_519, 0, __wm_basis_Nil);
}
__wm_fail("Match", "non-exhaustive match");
};
const bindMatchPayload_454 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return bindMatchPayload_454__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const bindMatchPayloadLanes_455__wm_d9 = (childPatternIds_537, pattern_538, scrutineeAtomId_539, owner_540, scope_541, context_542, state_543, index_544, reversedStatements_545) => {
__wm_tail_20: while (true) {
{
const __wm_scalar_21_0 = childPatternIds_537;
const __wm_scalar_21_1 = pattern_538;
const __wm_scalar_21_2 = scrutineeAtomId_539;
const __wm_scalar_21_3 = owner_540;
const __wm_scalar_21_4 = scope_541;
const __wm_scalar_21_5 = context_542;
const __wm_scalar_21_6 = state_543;
const __wm_scalar_21_7 = index_544;
const __wm_scalar_21_8 = reversedStatements_545;
if (__wm_scalar_21_0 === __wm_basis_Nil) {
const _pattern_546 = __wm_scalar_21_1;
const _scrutineeAtomId_547 = __wm_scalar_21_2;
const _owner_548 = __wm_scalar_21_3;
const scope_549 = __wm_scalar_21_4;
const _context_550 = __wm_scalar_21_5;
const state_551 = __wm_scalar_21_6;
const _index_552 = __wm_scalar_21_7;
const reversedStatements_553 = __wm_scalar_21_8;
{
const result_554 = { statementIds: reverseInto_147__wm_d2(reversedStatements_553, __wm_basis_Nil), scope: scope_549, state: state_551 };
return result_554;
}
} else if (__wm_scalar_21_0?.ctor === -6 && __wm_scalar_21_0.args.length === 1 && __wm_is_tuple(__wm_scalar_21_0.args[0]) && __wm_scalar_21_0.args[0].length === 2) {
const childPatternId_555 = __wm_scalar_21_0.args[0][0];
const rest_556 = __wm_scalar_21_0.args[0][1];
const pattern_557 = __wm_scalar_21_1;
const scrutineeAtomId_558 = __wm_scalar_21_2;
const owner_559 = __wm_scalar_21_3;
const scope_560 = __wm_scalar_21_4;
const context_561 = __wm_scalar_21_5;
const state_562 = __wm_scalar_21_6;
const index_563 = __wm_scalar_21_7;
const reversedStatements_564 = __wm_scalar_21_8;
{
const child_565 = findPattern_203__wm_d2(context_561.patterns, childPatternId_555);
if (__wm_eq(child_565.kind, "wildcard")) {
{
const __wm_tail_arg_22_0 = rest_556;
const __wm_tail_arg_22_1 = pattern_557;
const __wm_tail_arg_22_2 = scrutineeAtomId_558;
const __wm_tail_arg_22_3 = owner_559;
const __wm_tail_arg_22_4 = scope_560;
const __wm_tail_arg_22_5 = context_561;
const __wm_tail_arg_22_6 = state_562;
const __wm_tail_arg_22_7 = (index_563 + 1);
const __wm_tail_arg_22_8 = reversedStatements_564;
childPatternIds_537 = __wm_tail_arg_22_0;
pattern_538 = __wm_tail_arg_22_1;
scrutineeAtomId_539 = __wm_tail_arg_22_2;
owner_540 = __wm_tail_arg_22_3;
scope_541 = __wm_tail_arg_22_4;
context_542 = __wm_tail_arg_22_5;
state_543 = __wm_tail_arg_22_6;
index_544 = __wm_tail_arg_22_7;
reversedStatements_545 = __wm_tail_arg_22_8;
continue __wm_tail_20;
}
} else {
{
const field_566 = findFieldForConstructor_257__wm_d2(context_561.fields, pattern_557.constructorId);
const operation_567 = { ...baseOperation_302__wm_d3(owner_559, "payload", state_562), typeId: child_565.typeId, constructorId: pattern_557.constructorId, layoutId: field_566.layoutId, fieldId: field_566.id, index: index_563, args: Js.Array.fromList(__wm_basis_Cons([scrutineeAtomId_558, __wm_basis_Nil])) };
const __wm_bind_21 = pushOperation_297__wm_d2(operation_567, state_562);
if (!(__wm_is_tuple(__wm_bind_21) && __wm_bind_21.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_568 = __wm_bind_21[0];
const afterOperation_569 = __wm_bind_21[1];
const __wm_bind_22 = freshLocal_277__wm_d7(owner_559.functionId, "binding", child_565.typeId, child_565.bindingId, false, child_565.spanId, afterOperation_569);
if (!(__wm_is_tuple(__wm_bind_22) && __wm_bind_22.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_570 = __wm_bind_22[0];
const afterLocal_571 = __wm_bind_22[1];
const statement_572 = { ...baseStatement_313__wm_d5(owner_559.functionId, "let", owner_559.sourceExprId, child_565.spanId, afterLocal_571), localId: localId_570, operationId: operationId_568, reason: "binding" };
const __wm_bind_23 = pushStatement_306__wm_d2(statement_572, afterLocal_571);
if (!(__wm_is_tuple(__wm_bind_23) && __wm_bind_23.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_573 = __wm_bind_23[0];
const afterStatement_574 = __wm_bind_23[1];
const nextScope_575 = { ...scope_560, bindings: Map.set([scope_560.bindings, child_565.bindingId, localId_570]) };
{
const __wm_tail_arg_23_0 = rest_556;
const __wm_tail_arg_23_1 = pattern_557;
const __wm_tail_arg_23_2 = scrutineeAtomId_558;
const __wm_tail_arg_23_3 = owner_559;
const __wm_tail_arg_23_4 = nextScope_575;
const __wm_tail_arg_23_5 = context_561;
const __wm_tail_arg_23_6 = afterStatement_574;
const __wm_tail_arg_23_7 = (index_563 + 1);
const __wm_tail_arg_23_8 = __wm_basis_Cons([statementId_573, reversedStatements_564]);
childPatternIds_537 = __wm_tail_arg_23_0;
pattern_538 = __wm_tail_arg_23_1;
scrutineeAtomId_539 = __wm_tail_arg_23_2;
owner_540 = __wm_tail_arg_23_3;
scope_541 = __wm_tail_arg_23_4;
context_542 = __wm_tail_arg_23_5;
state_543 = __wm_tail_arg_23_6;
index_544 = __wm_tail_arg_23_7;
reversedStatements_545 = __wm_tail_arg_23_8;
continue __wm_tail_20;
}
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const bindMatchPayloadLanes_455 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return bindMatchPayloadLanes_455__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const operationKind_577 = (__arg) => {
if (true) {
const expression_576 = __arg;
if (__wm_eq(expression_576.kind, "constructor")) {
return "construct";
} else {
return expression_576.kind;
}
}
__wm_fail("Match", "pattern match failure in function");
};
const bindOperation_596__wm_d7 = (expression_578, kind_579, args_580, localKind_581, reason_582, layoutId_583, state_584) => {
const operation_585 = { ...baseOperation_302__wm_d3(expression_578, kind_579, state_584), layoutId: layoutId_583, args: Js.Array.fromList(args_580) };
const __wm_bind_24 = pushOperation_297__wm_d2(operation_585, state_584);
if (!(__wm_is_tuple(__wm_bind_24) && __wm_bind_24.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_586 = __wm_bind_24[0];
const afterOperation_587 = __wm_bind_24[1];
const __wm_bind_25 = freshLocal_277__wm_d7(expression_578.functionId, localKind_581, expression_578.typeId, __wm_op_sub(1), false, expression_578.spanId, afterOperation_587);
if (!(__wm_is_tuple(__wm_bind_25) && __wm_bind_25.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_588 = __wm_bind_25[0];
const afterLocal_589 = __wm_bind_25[1];
const statement_590 = { ...baseStatement_313__wm_d5(expression_578.functionId, "let", expression_578.sourceExprId, expression_578.spanId, afterLocal_589), localId: localId_588, operationId: operationId_586, reason: reason_582 };
const __wm_bind_26 = pushStatement_306__wm_d2(statement_590, afterLocal_589);
if (!(__wm_is_tuple(__wm_bind_26) && __wm_bind_26.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_591 = __wm_bind_26[0];
const afterStatement_592 = __wm_bind_26[1];
const __wm_bind_27 = localAtom_289__wm_d6(expression_578.functionId, expression_578.typeId, expression_578.sourceExprId, expression_578.spanId, localId_588, afterStatement_592);
if (!(__wm_is_tuple(__wm_bind_27) && __wm_bind_27.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_593 = __wm_bind_27[0];
const afterAtom_594 = __wm_bind_27[1];
const result_595 = { statementIds: __wm_basis_Cons([statementId_591, __wm_basis_Nil]), atomId: atomId_593, state: afterAtom_594 };
return result_595;
};
const bindOperation_596 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return bindOperation_596__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const bindSourceOperation_602__wm_d4 = (expression_597, args_598, context_599, state_600) => {
if (__wm_eq(expression_597.kind, "constructor")) {
const layout_601 = findLayoutForType_219__wm_d2(context_599.layouts, expression_597.typeId);
return bindOperation_596__wm_d7(expression_597, "construct", args_598, "temporary", "temporary", layout_601.id, state_600);
} else {
return bindOperation_596__wm_d7(expression_597, operationKind_577(expression_597), args_598, "temporary", "temporary", __wm_op_sub(1), state_600);
}
};
const bindSourceOperation_602 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return bindSourceOperation_602__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerValue_603__wm_d4 = (expressionId_605, scope_606, context_607, state_608) => {
const expression_609 = findIrExpression_171__wm_d2(context_607.expressions, expressionId_605);
if (__wm_op_or_d2(__wm_op_or_d2(__wm_eq(expression_609.kind, "number"), __wm_eq(expression_609.kind, "bool")), __wm_eq(expression_609.kind, "void"))) {
const __wm_bind_28 = literalAtom_293__wm_d2(expression_609, state_608);
if (!(__wm_is_tuple(__wm_bind_28) && __wm_bind_28.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_610 = __wm_bind_28[0];
const next_611 = __wm_bind_28[1];
const result_612 = { statementIds: __wm_basis_Nil, atomId: atomId_610, state: next_611 };
return result_612;
} else {
if (__wm_eq(expression_609.kind, "local")) {
const __wm_return_value_5 = Map.get([scope_606.bindings, expression_609.bindingId]);
if (__wm_return_value_5?.ctor === -2 && __wm_return_value_5.args.length === 1) {
const localId_613 = __wm_return_value_5.args[0];
const __wm_bind_29 = localAtom_289__wm_d6(expression_609.functionId, expression_609.typeId, expression_609.sourceExprId, expression_609.spanId, localId_613, state_608);
if (!(__wm_is_tuple(__wm_bind_29) && __wm_bind_29.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_614 = __wm_bind_29[0];
const next_615 = __wm_bind_29[1];
const result_616 = { statementIds: __wm_basis_Nil, atomId: atomId_614, state: next_615 };
return result_616;
} else if (__wm_return_value_5 === __wm_basis_None) {

return __wm_fail("Panic", "lowered local has no lexical binding");
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_eq(expression_609.kind, "let")) {
return lowerLetValue_340__wm_d5(lowerValue_603, expression_609, scope_606, context_607, state_608);
} else {
if (__wm_eq(expression_609.kind, "sequence")) {
return lowerSequenceValue_341__wm_d5(lowerValue_603, expression_609, scope_606, context_607, state_608);
} else {
if (__wm_eq(expression_609.kind, "if")) {
return lowerIfValue_451__wm_d5(lowerValue_603, expression_609, scope_606, context_607, state_608);
} else {
if (__wm_eq(expression_609.kind, "match")) {
return lowerMatchValue_452__wm_d5(lowerValue_603, expression_609, scope_606, context_607, state_608);
} else {
if (__wm_eq(expression_609.kind, "tail-call")) {
return __wm_fail("Panic", "tail-call reached a value context");
} else {
const children_617 = lowerChildren_604__wm_d6(Js.Array.toList(expression_609.children), scope_606, context_607, state_608, __wm_basis_Nil, __wm_basis_Nil);
const value_618 = bindSourceOperation_602__wm_d4(expression_609, children_617.atomIds, context_607, children_617.state);
const result_619 = { statementIds: append_154__wm_d2(children_617.statementIds, value_618.statementIds), atomId: value_618.atomId, state: value_618.state };
return result_619;
}
}
}
}
}
}
}
};
const lowerValue_603 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return lowerValue_603__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerChildren_604__wm_d6 = (expressionIds_620, scope_621, context_622, state_623, reversedStatements_624, reversedAtoms_625) => {
__wm_tail_21: while (true) {
{
const __wm_scalar_22_0 = expressionIds_620;
const __wm_scalar_22_1 = scope_621;
const __wm_scalar_22_2 = context_622;
const __wm_scalar_22_3 = state_623;
const __wm_scalar_22_4 = reversedStatements_624;
const __wm_scalar_22_5 = reversedAtoms_625;
if (__wm_scalar_22_0 === __wm_basis_Nil) {
const scope_626 = __wm_scalar_22_1;
const context_627 = __wm_scalar_22_2;
const state_628 = __wm_scalar_22_3;
const reversedStatements_629 = __wm_scalar_22_4;
const reversedAtoms_630 = __wm_scalar_22_5;
{
const result_631 = { statementIds: reverseInto_147__wm_d2(reversedStatements_629, __wm_basis_Nil), atomIds: reverseInto_147__wm_d2(reversedAtoms_630, __wm_basis_Nil), state: state_628 };
return result_631;
}
} else if (__wm_scalar_22_0?.ctor === -6 && __wm_scalar_22_0.args.length === 1 && __wm_is_tuple(__wm_scalar_22_0.args[0]) && __wm_scalar_22_0.args[0].length === 2) {
const expressionId_632 = __wm_scalar_22_0.args[0][0];
const rest_633 = __wm_scalar_22_0.args[0][1];
const scope_634 = __wm_scalar_22_1;
const context_635 = __wm_scalar_22_2;
const state_636 = __wm_scalar_22_3;
const reversedStatements_637 = __wm_scalar_22_4;
const reversedAtoms_638 = __wm_scalar_22_5;
{
const value_639 = lowerValue_603__wm_d4(expressionId_632, scope_634, context_635, state_636);
{
const __wm_tail_arg_24_0 = rest_633;
const __wm_tail_arg_24_1 = scope_634;
const __wm_tail_arg_24_2 = context_635;
const __wm_tail_arg_24_3 = value_639.state;
const __wm_tail_arg_24_4 = reverseInto_147__wm_d2(value_639.statementIds, reversedStatements_637);
const __wm_tail_arg_24_5 = __wm_basis_Cons([value_639.atomId, reversedAtoms_638]);
expressionIds_620 = __wm_tail_arg_24_0;
scope_621 = __wm_tail_arg_24_1;
context_622 = __wm_tail_arg_24_2;
state_623 = __wm_tail_arg_24_3;
reversedStatements_624 = __wm_tail_arg_24_4;
reversedAtoms_625 = __wm_tail_arg_24_5;
continue __wm_tail_21;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const lowerChildren_604 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return lowerChildren_604__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const returnStatement_644__wm_d3 = (expression_640, atomId_641, state_642) => {
const statement_643 = { ...baseStatement_313__wm_d5(expression_640.functionId, "return", expression_640.sourceExprId, expression_640.spanId, state_642), atomId: atomId_641 };
return pushStatement_306__wm_d2(statement_643, state_642);
};
const returnStatement_644 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return returnStatement_644__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerTail_645__wm_d4 = (expressionId_651, scope_652, context_653, state_654) => {
const expression_655 = findIrExpression_171__wm_d2(context_653.expressions, expressionId_651);
if (__wm_eq(expression_655.kind, "tail-call")) {
const tail_656 = lowerTailCall_649__wm_d4(expression_655, scope_652, context_653, state_654);
return tail_656;
} else {
if (__wm_eq(expression_655.kind, "let")) {
const __wm_return_value_6 = Js.Array.toList(expression_655.children);
if (__wm_return_value_6?.ctor === -6 && __wm_return_value_6.args.length === 1 && __wm_is_tuple(__wm_return_value_6.args[0]) && __wm_return_value_6.args[0].length === 2 && __wm_return_value_6.args[0][1]?.ctor === -6 && __wm_return_value_6.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_6.args[0][1].args[0]) && __wm_return_value_6.args[0][1].args[0].length === 2 && __wm_return_value_6.args[0][1].args[0][1] === __wm_basis_Nil) {
const valueExpressionId_657 = __wm_return_value_6.args[0][0];
const bodyExpressionId_658 = __wm_return_value_6.args[0][1].args[0][0];
const value_659 = lowerValue_603__wm_d4(valueExpressionId_657, scope_652, context_653, state_654);
const bound_660 = bindPattern_342__wm_d6(expression_655.patternId, value_659.atomId, expression_655, scope_652, context_653, value_659.state);
const body_661 = lowerTail_645__wm_d4(bodyExpressionId_658, bound_660.scope, context_653, bound_660.state);
const result_662 = { statementIds: append_154__wm_d2(value_659.statementIds, append_154__wm_d2(bound_660.statementIds, body_661.statementIds)), state: body_661.state };
return result_662;
} else if (true) {

return __wm_fail("Panic", "tail-position let does not have value and body children");
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_eq(expression_655.kind, "sequence")) {
const __wm_return_value_7 = Js.Array.toList(expression_655.children);
if (__wm_return_value_7?.ctor === -6 && __wm_return_value_7.args.length === 1 && __wm_is_tuple(__wm_return_value_7.args[0]) && __wm_return_value_7.args[0].length === 2 && __wm_return_value_7.args[0][1]?.ctor === -6 && __wm_return_value_7.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_7.args[0][1].args[0]) && __wm_return_value_7.args[0][1].args[0].length === 2 && __wm_return_value_7.args[0][1].args[0][1] === __wm_basis_Nil) {
const discardedExpressionId_663 = __wm_return_value_7.args[0][0];
const bodyExpressionId_664 = __wm_return_value_7.args[0][1].args[0][0];
const discarded_665 = lowerValue_603__wm_d4(discardedExpressionId_663, scope_652, context_653, state_654);
const body_666 = lowerTail_645__wm_d4(bodyExpressionId_664, scope_652, context_653, discarded_665.state);
const result_667 = { statementIds: append_154__wm_d2(discarded_665.statementIds, body_666.statementIds), state: body_666.state };
return result_667;
} else if (true) {

return __wm_fail("Panic", "tail-position sequence does not have two children");
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_eq(expression_655.kind, "if")) {
const tail_668 = lowerTailIf_646__wm_d4(expression_655, scope_652, context_653, state_654);
return tail_668;
} else {
if (__wm_eq(expression_655.kind, "match")) {
const tail_669 = lowerTailMatch_647__wm_d4(expression_655, scope_652, context_653, state_654);
return tail_669;
} else {
const value_670 = lowerValue_603__wm_d4(expressionId_651, scope_652, context_653, state_654);
const __wm_bind_30 = returnStatement_644__wm_d3(expression_655, value_670.atomId, value_670.state);
if (!(__wm_is_tuple(__wm_bind_30) && __wm_bind_30.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const returnId_671 = __wm_bind_30[0];
const afterReturn_672 = __wm_bind_30[1];
const result_673 = { statementIds: append_154__wm_d2(value_670.statementIds, __wm_basis_Cons([returnId_671, __wm_basis_Nil])), state: afterReturn_672 };
return result_673;
}
}
}
}
}
};
const lowerTail_645 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return lowerTail_645__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerTailIf_646__wm_d4 = (expression_674, scope_675, context_676, state_677) => {
const __wm_return_value_8 = Js.Array.toList(expression_674.children);
if (__wm_return_value_8?.ctor === -6 && __wm_return_value_8.args.length === 1 && __wm_is_tuple(__wm_return_value_8.args[0]) && __wm_return_value_8.args[0].length === 2 && __wm_return_value_8.args[0][1]?.ctor === -6 && __wm_return_value_8.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_8.args[0][1].args[0]) && __wm_return_value_8.args[0][1].args[0].length === 2 && __wm_return_value_8.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_8.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_8.args[0][1].args[0][1].args[0]) && __wm_return_value_8.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_8.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const conditionExpressionId_678 = __wm_return_value_8.args[0][0];
const thenExpressionId_679 = __wm_return_value_8.args[0][1].args[0][0];
const elseExpressionId_680 = __wm_return_value_8.args[0][1].args[0][1].args[0][0];
const condition_681 = lowerValue_603__wm_d4(conditionExpressionId_678, scope_675, context_676, state_677);
const thenTail_682 = lowerTail_645__wm_d4(thenExpressionId_679, scope_675, context_676, condition_681.state);
const __wm_bind_31 = pushBlock_319__wm_d3(expression_674.functionId, thenTail_682.statementIds, thenTail_682.state);
if (!(__wm_is_tuple(__wm_bind_31) && __wm_bind_31.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const thenBlockId_683 = __wm_bind_31[0];
const afterThen_684 = __wm_bind_31[1];
const elseTail_685 = lowerTail_645__wm_d4(elseExpressionId_680, scope_675, context_676, afterThen_684);
const __wm_bind_32 = pushBlock_319__wm_d3(expression_674.functionId, elseTail_685.statementIds, elseTail_685.state);
if (!(__wm_is_tuple(__wm_bind_32) && __wm_bind_32.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const elseBlockId_686 = __wm_bind_32[0];
const afterElse_687 = __wm_bind_32[1];
const statement_688 = { ...baseStatement_313__wm_d5(expression_674.functionId, "if", expression_674.sourceExprId, expression_674.spanId, afterElse_687), conditionAtomId: condition_681.atomId, thenBlockId: thenBlockId_683, elseBlockId: elseBlockId_686 };
const __wm_bind_33 = pushStatement_306__wm_d2(statement_688, afterElse_687);
if (!(__wm_is_tuple(__wm_bind_33) && __wm_bind_33.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_689 = __wm_bind_33[0];
const afterIf_690 = __wm_bind_33[1];
const result_691 = { statementIds: append_154__wm_d2(condition_681.statementIds, __wm_basis_Cons([statementId_689, __wm_basis_Nil])), state: afterIf_690 };
return result_691;
} else if (true) {

return __wm_fail("Panic", "tail-position if does not have three children");
}
__wm_fail("Match", "non-exhaustive match");
};
const lowerTailIf_646 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return lowerTailIf_646__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerTailMatch_647__wm_d4 = (expression_692, scope_693, context_694, state_695) => {
const __wm_return_value_9 = Js.Array.toList(expression_692.children);
if (__wm_return_value_9?.ctor === -6 && __wm_return_value_9.args.length === 1 && __wm_is_tuple(__wm_return_value_9.args[0]) && __wm_return_value_9.args[0].length === 2 && __wm_return_value_9.args[0][1] === __wm_basis_Nil) {
const scrutineeExpressionId_696 = __wm_return_value_9.args[0][0];
const scrutinee_697 = lowerValue_603__wm_d4(scrutineeExpressionId_696, scope_693, context_694, state_695);
const scrutineeExpression_698 = findIrExpression_171__wm_d2(context_694.expressions, scrutineeExpressionId_696);
const layout_699 = findLayoutForType_219__wm_d2(context_694.layouts, scrutineeExpression_698.typeId);
const cases_700 = lowerTailMatchCases_648__wm_d7(Js.Array.toList(expression_692.armIds), expression_692, scrutinee_697.atomId, scope_693, context_694, scrutinee_697.state, __wm_basis_Nil);
const statement_701 = { ...baseStatement_313__wm_d5(expression_692.functionId, "switch", expression_692.sourceExprId, expression_692.spanId, cases_700.state), scrutineeAtomId: scrutinee_697.atomId, layoutId: layout_699.id, caseIds: Js.Array.fromList(cases_700.caseIds) };
const __wm_bind_34 = pushStatement_306__wm_d2(statement_701, cases_700.state);
if (!(__wm_is_tuple(__wm_bind_34) && __wm_bind_34.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_702 = __wm_bind_34[0];
const afterSwitch_703 = __wm_bind_34[1];
const result_704 = { statementIds: append_154__wm_d2(scrutinee_697.statementIds, __wm_basis_Cons([statementId_702, __wm_basis_Nil])), state: afterSwitch_703 };
return result_704;
} else if (true) {

return __wm_fail("Panic", "tail-position match does not have one scrutinee");
}
__wm_fail("Match", "non-exhaustive match");
};
const lowerTailMatch_647 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return lowerTailMatch_647__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerTailMatchCases_648__wm_d7 = (armIds_705, expression_706, scrutineeAtomId_707, scope_708, context_709, state_710, reversedCases_711) => {
__wm_tail_22: while (true) {
{
const __wm_scalar_23_0 = armIds_705;
const __wm_scalar_23_1 = expression_706;
const __wm_scalar_23_2 = scrutineeAtomId_707;
const __wm_scalar_23_3 = scope_708;
const __wm_scalar_23_4 = context_709;
const __wm_scalar_23_5 = state_710;
const __wm_scalar_23_6 = reversedCases_711;
if (__wm_scalar_23_0 === __wm_basis_Nil) {
const expression_712 = __wm_scalar_23_1;
const scrutineeAtomId_713 = __wm_scalar_23_2;
const scope_714 = __wm_scalar_23_3;
const context_715 = __wm_scalar_23_4;
const state_716 = __wm_scalar_23_5;
const reversedCases_717 = __wm_scalar_23_6;
{
const result_718 = { caseIds: reverseInto_147__wm_d2(reversedCases_717, __wm_basis_Nil), state: state_716 };
return result_718;
}
} else if (__wm_scalar_23_0?.ctor === -6 && __wm_scalar_23_0.args.length === 1 && __wm_is_tuple(__wm_scalar_23_0.args[0]) && __wm_scalar_23_0.args[0].length === 2) {
const armId_719 = __wm_scalar_23_0.args[0][0];
const rest_720 = __wm_scalar_23_0.args[0][1];
const expression_721 = __wm_scalar_23_1;
const scrutineeAtomId_722 = __wm_scalar_23_2;
const scope_723 = __wm_scalar_23_3;
const context_724 = __wm_scalar_23_4;
const state_725 = __wm_scalar_23_5;
const reversedCases_726 = __wm_scalar_23_6;
{
const arm_727 = findIrMatchArm_179__wm_d2(context_724.matchArms, armId_719);
const pattern_728 = findPattern_203__wm_d2(context_724.patterns, arm_727.patternId);
const constructor_729 = findConstructor_211__wm_d2(context_724.constructors, pattern_728.constructorId);
const bound_730 = bindMatchPayload_454__wm_d6(pattern_728, scrutineeAtomId_722, expression_721, scope_723, context_724, state_725);
const body_731 = lowerTail_645__wm_d4(arm_727.bodyExprId, bound_730.scope, context_724, bound_730.state);
const __wm_bind_35 = pushBlock_319__wm_d3(expression_721.functionId, append_154__wm_d2(bound_730.statementIds, body_731.statementIds), body_731.state);
if (!(__wm_is_tuple(__wm_bind_35) && __wm_bind_35.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const blockId_732 = __wm_bind_35[0];
const afterBlock_733 = __wm_bind_35[1];
const gpuCase_734 = { id: afterBlock_733.nextCaseId, functionId: expression_721.functionId, constructorId: constructor_729.id, tag: constructor_729.tag, blockId: blockId_732, spanId: arm_727.spanId };
const __wm_bind_36 = pushCase_323__wm_d2(gpuCase_734, afterBlock_733);
if (!(__wm_is_tuple(__wm_bind_36) && __wm_bind_36.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const caseId_735 = __wm_bind_36[0];
const afterCase_736 = __wm_bind_36[1];
{
const __wm_tail_arg_25_0 = rest_720;
const __wm_tail_arg_25_1 = expression_721;
const __wm_tail_arg_25_2 = scrutineeAtomId_722;
const __wm_tail_arg_25_3 = scope_723;
const __wm_tail_arg_25_4 = context_724;
const __wm_tail_arg_25_5 = afterCase_736;
const __wm_tail_arg_25_6 = __wm_basis_Cons([caseId_735, reversedCases_726]);
armIds_705 = __wm_tail_arg_25_0;
expression_706 = __wm_tail_arg_25_1;
scrutineeAtomId_707 = __wm_tail_arg_25_2;
scope_708 = __wm_tail_arg_25_3;
context_709 = __wm_tail_arg_25_4;
state_710 = __wm_tail_arg_25_5;
reversedCases_711 = __wm_tail_arg_25_6;
continue __wm_tail_22;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const lowerTailMatchCases_648 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return lowerTailMatchCases_648__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerTailCall_649__wm_d4 = (expression_737, scope_738, context_739, state_740) => {
const children_741 = lowerChildren_604__wm_d6(Js.Array.toList(expression_737.children), scope_738, context_739, state_740, __wm_basis_Nil, __wm_basis_Nil);
const nextValues_742 = materializeTailNext_650__wm_d5(children_741.atomIds, expression_737, children_741.state, __wm_basis_Nil, __wm_basis_Nil);
const statement_743 = { ...baseStatement_313__wm_d5(expression_737.functionId, "continue", expression_737.sourceExprId, expression_737.spanId, nextValues_742.state), targetLocalIds: Js.Array.fromList(scope_738.loopParamLocalIds), valueAtomIds: Js.Array.fromList(nextValues_742.atomIds) };
const __wm_bind_37 = pushStatement_306__wm_d2(statement_743, nextValues_742.state);
if (!(__wm_is_tuple(__wm_bind_37) && __wm_bind_37.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_744 = __wm_bind_37[0];
const afterContinue_745 = __wm_bind_37[1];
const result_746 = { statementIds: append_154__wm_d2(children_741.statementIds, append_154__wm_d2(nextValues_742.statementIds, __wm_basis_Cons([statementId_744, __wm_basis_Nil]))), state: afterContinue_745 };
return result_746;
};
const lowerTailCall_649 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return lowerTailCall_649__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const materializeTailNext_650__wm_d5 = (atomIds_747, expression_748, state_749, reversedStatements_750, reversedAtoms_751) => {
__wm_tail_23: while (true) {
{
const __wm_scalar_24_0 = atomIds_747;
const __wm_scalar_24_1 = expression_748;
const __wm_scalar_24_2 = state_749;
const __wm_scalar_24_3 = reversedStatements_750;
const __wm_scalar_24_4 = reversedAtoms_751;
if (__wm_scalar_24_0 === __wm_basis_Nil) {
const expression_752 = __wm_scalar_24_1;
const state_753 = __wm_scalar_24_2;
const reversedStatements_754 = __wm_scalar_24_3;
const reversedAtoms_755 = __wm_scalar_24_4;
{
const result_756 = { statementIds: reverseInto_147__wm_d2(reversedStatements_754, __wm_basis_Nil), atomIds: reverseInto_147__wm_d2(reversedAtoms_755, __wm_basis_Nil), state: state_753 };
return result_756;
}
} else if (__wm_scalar_24_0?.ctor === -6 && __wm_scalar_24_0.args.length === 1 && __wm_is_tuple(__wm_scalar_24_0.args[0]) && __wm_scalar_24_0.args[0].length === 2) {
const atomId_757 = __wm_scalar_24_0.args[0][0];
const rest_758 = __wm_scalar_24_0.args[0][1];
const expression_759 = __wm_scalar_24_1;
const state_760 = __wm_scalar_24_2;
const reversedStatements_761 = __wm_scalar_24_3;
const reversedAtoms_762 = __wm_scalar_24_4;
{
const atom_763 = findLoweredAtom_187__wm_d2(state_760.atoms, atomId_757);
const operation_764 = { ...baseOperation_302__wm_d3(expression_759, "copy", state_760), typeId: atom_763.typeId, targetFunctionId: __wm_op_sub(1), args: Js.Array.fromList(__wm_basis_Cons([atomId_757, __wm_basis_Nil])) };
const __wm_bind_38 = pushOperation_297__wm_d2(operation_764, state_760);
if (!(__wm_is_tuple(__wm_bind_38) && __wm_bind_38.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_765 = __wm_bind_38[0];
const afterOperation_766 = __wm_bind_38[1];
const __wm_bind_39 = freshLocal_277__wm_d7(expression_759.functionId, "tail-next", atom_763.typeId, __wm_op_sub(1), false, expression_759.spanId, afterOperation_766);
if (!(__wm_is_tuple(__wm_bind_39) && __wm_bind_39.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_767 = __wm_bind_39[0];
const afterLocal_768 = __wm_bind_39[1];
const statement_769 = { ...baseStatement_313__wm_d5(expression_759.functionId, "let", expression_759.sourceExprId, expression_759.spanId, afterLocal_768), localId: localId_767, operationId: operationId_765, reason: "tail-next" };
const __wm_bind_40 = pushStatement_306__wm_d2(statement_769, afterLocal_768);
if (!(__wm_is_tuple(__wm_bind_40) && __wm_bind_40.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_770 = __wm_bind_40[0];
const afterStatement_771 = __wm_bind_40[1];
const __wm_bind_41 = localAtom_289__wm_d6(expression_759.functionId, atom_763.typeId, expression_759.sourceExprId, expression_759.spanId, localId_767, afterStatement_771);
if (!(__wm_is_tuple(__wm_bind_41) && __wm_bind_41.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextAtomId_772 = __wm_bind_41[0];
const afterAtom_773 = __wm_bind_41[1];
{
const __wm_tail_arg_26_0 = rest_758;
const __wm_tail_arg_26_1 = expression_759;
const __wm_tail_arg_26_2 = afterAtom_773;
const __wm_tail_arg_26_3 = __wm_basis_Cons([statementId_770, reversedStatements_761]);
const __wm_tail_arg_26_4 = __wm_basis_Cons([nextAtomId_772, reversedAtoms_762]);
atomIds_747 = __wm_tail_arg_26_0;
expression_748 = __wm_tail_arg_26_1;
state_749 = __wm_tail_arg_26_2;
reversedStatements_750 = __wm_tail_arg_26_3;
reversedAtoms_751 = __wm_tail_arg_26_4;
continue __wm_tail_23;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const materializeTailNext_650 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return materializeTailNext_650__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const setupParameters_774__wm_d7 = (paramIds_775, functionId_776, context_777, scope_778, state_779, reversedPhysicalIds_780, reversedStatements_781) => {
__wm_tail_24: while (true) {
{
const __wm_scalar_25_0 = paramIds_775;
const __wm_scalar_25_1 = functionId_776;
const __wm_scalar_25_2 = context_777;
const __wm_scalar_25_3 = scope_778;
const __wm_scalar_25_4 = state_779;
const __wm_scalar_25_5 = reversedPhysicalIds_780;
const __wm_scalar_25_6 = reversedStatements_781;
if (__wm_scalar_25_0 === __wm_basis_Nil) {
const functionId_782 = __wm_scalar_25_1;
const context_783 = __wm_scalar_25_2;
const scope_784 = __wm_scalar_25_3;
const state_785 = __wm_scalar_25_4;
const reversedPhysicalIds_786 = __wm_scalar_25_5;
const reversedStatements_787 = __wm_scalar_25_6;
{
const result_788 = { physicalLocalIds: reverseInto_147__wm_d2(reversedPhysicalIds_786, __wm_basis_Nil), activeLocalIds: reverseInto_147__wm_d2(reversedPhysicalIds_786, __wm_basis_Nil), initialStatementIds: reverseInto_147__wm_d2(reversedStatements_787, __wm_basis_Nil), iterationStatementIds: __wm_basis_Nil, scope: scope_784, state: state_785 };
return result_788;
}
} else if (__wm_scalar_25_0?.ctor === -6 && __wm_scalar_25_0.args.length === 1 && __wm_is_tuple(__wm_scalar_25_0.args[0]) && __wm_scalar_25_0.args[0].length === 2) {
const paramId_789 = __wm_scalar_25_0.args[0][0];
const rest_790 = __wm_scalar_25_0.args[0][1];
const functionId_791 = __wm_scalar_25_1;
const context_792 = __wm_scalar_25_2;
const scope_793 = __wm_scalar_25_3;
const state_794 = __wm_scalar_25_4;
const reversedPhysicalIds_795 = __wm_scalar_25_5;
const reversedStatements_796 = __wm_scalar_25_6;
{
const param_797 = findParam_195__wm_d2(context_792.params, paramId_789);
const pattern_798 = findPattern_203__wm_d2(context_792.patterns, param_797.patternId);
const bindingId_799 = (__wm_eq(pattern_798.kind, "binding") ? pattern_798.bindingId : __wm_op_sub(1));
const __wm_bind_42 = freshLocal_277__wm_d7(functionId_791, "parameter", param_797.typeId, bindingId_799, false, param_797.spanId, state_794);
if (!(__wm_is_tuple(__wm_bind_42) && __wm_bind_42.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_800 = __wm_bind_42[0];
const afterLocal_801 = __wm_bind_42[1];
const __wm_bind_43 = localAtom_289__wm_d6(functionId_791, param_797.typeId, __wm_op_sub(1), param_797.spanId, localId_800, afterLocal_801);
if (!(__wm_is_tuple(__wm_bind_43) && __wm_bind_43.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_802 = __wm_bind_43[0];
const afterAtom_803 = __wm_bind_43[1];
if (__wm_eq(pattern_798.kind, "binding")) {
{
const nextScope_804 = { ...scope_793, bindings: Map.set([scope_793.bindings, pattern_798.bindingId, localId_800]) };
{
const __wm_tail_arg_27_0 = rest_790;
const __wm_tail_arg_27_1 = functionId_791;
const __wm_tail_arg_27_2 = context_792;
const __wm_tail_arg_27_3 = nextScope_804;
const __wm_tail_arg_27_4 = afterAtom_803;
const __wm_tail_arg_27_5 = __wm_basis_Cons([localId_800, reversedPhysicalIds_795]);
const __wm_tail_arg_27_6 = reversedStatements_796;
paramIds_775 = __wm_tail_arg_27_0;
functionId_776 = __wm_tail_arg_27_1;
context_777 = __wm_tail_arg_27_2;
scope_778 = __wm_tail_arg_27_3;
state_779 = __wm_tail_arg_27_4;
reversedPhysicalIds_780 = __wm_tail_arg_27_5;
reversedStatements_781 = __wm_tail_arg_27_6;
continue __wm_tail_24;
}
}
} else {
{
const fn_805 = findIrFunction_163__wm_d2(context_792.functions, functionId_791);
const owner_806 = findIrExpression_171__wm_d2(context_792.expressions, fn_805.bodyExprId);
const bound_807 = bindPattern_342__wm_d6(pattern_798.id, atomId_802, owner_806, scope_793, context_792, afterAtom_803);
{
const __wm_tail_arg_28_0 = rest_790;
const __wm_tail_arg_28_1 = functionId_791;
const __wm_tail_arg_28_2 = context_792;
const __wm_tail_arg_28_3 = bound_807.scope;
const __wm_tail_arg_28_4 = bound_807.state;
const __wm_tail_arg_28_5 = __wm_basis_Cons([localId_800, reversedPhysicalIds_795]);
const __wm_tail_arg_28_6 = reverseInto_147__wm_d2(bound_807.statementIds, reversedStatements_796);
paramIds_775 = __wm_tail_arg_28_0;
functionId_776 = __wm_tail_arg_28_1;
context_777 = __wm_tail_arg_28_2;
scope_778 = __wm_tail_arg_28_3;
state_779 = __wm_tail_arg_28_4;
reversedPhysicalIds_780 = __wm_tail_arg_28_5;
reversedStatements_781 = __wm_tail_arg_28_6;
continue __wm_tail_24;
}
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const setupParameters_774 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return setupParameters_774__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerNonrecursiveFunction_819__wm_d3 = (fn_808, context_809, state_810) => {
const params_811 = setupParameters_774__wm_d7(Js.Array.toList(fn_808.paramIds), fn_808.functionId, context_809, emptyScope_339(undefined), state_810, __wm_basis_Nil, __wm_basis_Nil);
const body_812 = lowerValue_603__wm_d4(fn_808.bodyExprId, params_811.scope, context_809, params_811.state);
const bodyExpression_813 = findIrExpression_171__wm_d2(context_809.expressions, fn_808.bodyExprId);
const __wm_bind_44 = returnStatement_644__wm_d3(bodyExpression_813, body_812.atomId, body_812.state);
if (!(__wm_is_tuple(__wm_bind_44) && __wm_bind_44.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const returnId_814 = __wm_bind_44[0];
const afterReturn_815 = __wm_bind_44[1];
const __wm_bind_45 = pushBlock_319__wm_d3(fn_808.functionId, append_154__wm_d2(params_811.initialStatementIds, append_154__wm_d2(body_812.statementIds, __wm_basis_Cons([returnId_814, __wm_basis_Nil]))), afterReturn_815);
if (!(__wm_is_tuple(__wm_bind_45) && __wm_bind_45.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const blockId_816 = __wm_bind_45[0];
const afterBlock_817 = __wm_bind_45[1];
const lowered_818 = { functionId: fn_808.functionId, physicalParamLocalIds: Js.Array.fromList(params_811.physicalLocalIds), loopParamLocalIds: Js.Array.fromList(__wm_basis_Nil), bodyBlockId: blockId_816, recursive: false, spanId: fn_808.spanId };
return pushFunction_327__wm_d2(lowered_818, afterBlock_817);
};
const lowerNonrecursiveFunction_819 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return lowerNonrecursiveFunction_819__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setupRecursiveParameters_820__wm_d9 = (paramIds_821, fn_822, context_823, scope_824, state_825, reversedPhysicalIds_826, reversedLoopIds_827, reversedInitialStatements_828, reversedIterationStatements_829) => {
__wm_tail_25: while (true) {
{
const __wm_scalar_26_0 = paramIds_821;
const __wm_scalar_26_1 = fn_822;
const __wm_scalar_26_2 = context_823;
const __wm_scalar_26_3 = scope_824;
const __wm_scalar_26_4 = state_825;
const __wm_scalar_26_5 = reversedPhysicalIds_826;
const __wm_scalar_26_6 = reversedLoopIds_827;
const __wm_scalar_26_7 = reversedInitialStatements_828;
const __wm_scalar_26_8 = reversedIterationStatements_829;
if (__wm_scalar_26_0 === __wm_basis_Nil) {
const fn_830 = __wm_scalar_26_1;
const context_831 = __wm_scalar_26_2;
const scope_832 = __wm_scalar_26_3;
const state_833 = __wm_scalar_26_4;
const reversedPhysicalIds_834 = __wm_scalar_26_5;
const reversedLoopIds_835 = __wm_scalar_26_6;
const reversedInitialStatements_836 = __wm_scalar_26_7;
const reversedIterationStatements_837 = __wm_scalar_26_8;
{
const loopIds_838 = reverseInto_147__wm_d2(reversedLoopIds_835, __wm_basis_Nil);
const nextScope_839 = { ...scope_832, loopParamLocalIds: loopIds_838 };
const result_840 = { physicalLocalIds: reverseInto_147__wm_d2(reversedPhysicalIds_834, __wm_basis_Nil), activeLocalIds: loopIds_838, initialStatementIds: reverseInto_147__wm_d2(reversedInitialStatements_836, __wm_basis_Nil), iterationStatementIds: reverseInto_147__wm_d2(reversedIterationStatements_837, __wm_basis_Nil), scope: nextScope_839, state: state_833 };
return result_840;
}
} else if (__wm_scalar_26_0?.ctor === -6 && __wm_scalar_26_0.args.length === 1 && __wm_is_tuple(__wm_scalar_26_0.args[0]) && __wm_scalar_26_0.args[0].length === 2) {
const paramId_841 = __wm_scalar_26_0.args[0][0];
const rest_842 = __wm_scalar_26_0.args[0][1];
const fn_843 = __wm_scalar_26_1;
const context_844 = __wm_scalar_26_2;
const scope_845 = __wm_scalar_26_3;
const state_846 = __wm_scalar_26_4;
const reversedPhysicalIds_847 = __wm_scalar_26_5;
const reversedLoopIds_848 = __wm_scalar_26_6;
const reversedInitialStatements_849 = __wm_scalar_26_7;
const reversedIterationStatements_850 = __wm_scalar_26_8;
{
const param_851 = findParam_195__wm_d2(context_844.params, paramId_841);
const pattern_852 = findPattern_203__wm_d2(context_844.patterns, param_851.patternId);
const bindingId_853 = (__wm_eq(pattern_852.kind, "binding") ? pattern_852.bindingId : __wm_op_sub(1));
const owner_854 = findIrExpression_171__wm_d2(context_844.expressions, fn_843.bodyExprId);
const __wm_bind_46 = freshLocal_277__wm_d7(fn_843.functionId, "parameter", param_851.typeId, bindingId_853, false, param_851.spanId, state_846);
if (!(__wm_is_tuple(__wm_bind_46) && __wm_bind_46.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const physicalId_855 = __wm_bind_46[0];
const afterPhysical_856 = __wm_bind_46[1];
const __wm_bind_47 = localAtom_289__wm_d6(fn_843.functionId, param_851.typeId, __wm_op_sub(1), param_851.spanId, physicalId_855, afterPhysical_856);
if (!(__wm_is_tuple(__wm_bind_47) && __wm_bind_47.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const physicalAtomId_857 = __wm_bind_47[0];
const afterPhysicalAtom_858 = __wm_bind_47[1];
const operation_859 = { ...baseOperation_302__wm_d3(owner_854, "copy", afterPhysicalAtom_858), typeId: param_851.typeId, args: Js.Array.fromList(__wm_basis_Cons([physicalAtomId_857, __wm_basis_Nil])) };
const __wm_bind_48 = pushOperation_297__wm_d2(operation_859, afterPhysicalAtom_858);
if (!(__wm_is_tuple(__wm_bind_48) && __wm_bind_48.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_860 = __wm_bind_48[0];
const afterOperation_861 = __wm_bind_48[1];
const __wm_bind_49 = freshLocal_277__wm_d7(fn_843.functionId, "loop-parameter", param_851.typeId, bindingId_853, true, param_851.spanId, afterOperation_861);
if (!(__wm_is_tuple(__wm_bind_49) && __wm_bind_49.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const loopId_862 = __wm_bind_49[0];
const afterLoopLocal_863 = __wm_bind_49[1];
const initial_864 = { ...baseStatement_313__wm_d5(fn_843.functionId, "let", owner_854.sourceExprId, param_851.spanId, afterLoopLocal_863), localId: loopId_862, operationId: operationId_860, reason: "loop-initial" };
const __wm_bind_50 = pushStatement_306__wm_d2(initial_864, afterLoopLocal_863);
if (!(__wm_is_tuple(__wm_bind_50) && __wm_bind_50.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const initialId_865 = __wm_bind_50[0];
const afterInitial_866 = __wm_bind_50[1];
const __wm_bind_51 = localAtom_289__wm_d6(fn_843.functionId, param_851.typeId, owner_854.sourceExprId, param_851.spanId, loopId_862, afterInitial_866);
if (!(__wm_is_tuple(__wm_bind_51) && __wm_bind_51.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const loopAtomId_867 = __wm_bind_51[0];
const afterLoopAtom_868 = __wm_bind_51[1];
if (__wm_eq(pattern_852.kind, "binding")) {
{
const nextScope_869 = { ...scope_845, bindings: Map.set([scope_845.bindings, pattern_852.bindingId, loopId_862]) };
{
const __wm_tail_arg_29_0 = rest_842;
const __wm_tail_arg_29_1 = fn_843;
const __wm_tail_arg_29_2 = context_844;
const __wm_tail_arg_29_3 = nextScope_869;
const __wm_tail_arg_29_4 = afterLoopAtom_868;
const __wm_tail_arg_29_5 = __wm_basis_Cons([physicalId_855, reversedPhysicalIds_847]);
const __wm_tail_arg_29_6 = __wm_basis_Cons([loopId_862, reversedLoopIds_848]);
const __wm_tail_arg_29_7 = __wm_basis_Cons([initialId_865, reversedInitialStatements_849]);
const __wm_tail_arg_29_8 = reversedIterationStatements_850;
paramIds_821 = __wm_tail_arg_29_0;
fn_822 = __wm_tail_arg_29_1;
context_823 = __wm_tail_arg_29_2;
scope_824 = __wm_tail_arg_29_3;
state_825 = __wm_tail_arg_29_4;
reversedPhysicalIds_826 = __wm_tail_arg_29_5;
reversedLoopIds_827 = __wm_tail_arg_29_6;
reversedInitialStatements_828 = __wm_tail_arg_29_7;
reversedIterationStatements_829 = __wm_tail_arg_29_8;
continue __wm_tail_25;
}
}
} else {
{
const bound_870 = bindPattern_342__wm_d6(pattern_852.id, loopAtomId_867, owner_854, scope_845, context_844, afterLoopAtom_868);
{
const __wm_tail_arg_30_0 = rest_842;
const __wm_tail_arg_30_1 = fn_843;
const __wm_tail_arg_30_2 = context_844;
const __wm_tail_arg_30_3 = bound_870.scope;
const __wm_tail_arg_30_4 = bound_870.state;
const __wm_tail_arg_30_5 = __wm_basis_Cons([physicalId_855, reversedPhysicalIds_847]);
const __wm_tail_arg_30_6 = __wm_basis_Cons([loopId_862, reversedLoopIds_848]);
const __wm_tail_arg_30_7 = __wm_basis_Cons([initialId_865, reversedInitialStatements_849]);
const __wm_tail_arg_30_8 = reverseInto_147__wm_d2(bound_870.statementIds, reversedIterationStatements_850);
paramIds_821 = __wm_tail_arg_30_0;
fn_822 = __wm_tail_arg_30_1;
context_823 = __wm_tail_arg_30_2;
scope_824 = __wm_tail_arg_30_3;
state_825 = __wm_tail_arg_30_4;
reversedPhysicalIds_826 = __wm_tail_arg_30_5;
reversedLoopIds_827 = __wm_tail_arg_30_6;
reversedInitialStatements_828 = __wm_tail_arg_30_7;
reversedIterationStatements_829 = __wm_tail_arg_30_8;
continue __wm_tail_25;
}
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const setupRecursiveParameters_820 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return setupRecursiveParameters_820__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerRecursiveFunction_885__wm_d3 = (fn_871, context_872, state_873) => {
const params_874 = setupRecursiveParameters_820__wm_d9(Js.Array.toList(fn_871.paramIds), fn_871, context_872, emptyScope_339(undefined), state_873, __wm_basis_Nil, __wm_basis_Nil, __wm_basis_Nil, __wm_basis_Nil);
const tail_875 = lowerTail_645__wm_d4(fn_871.bodyExprId, params_874.scope, context_872, params_874.state);
const __wm_bind_52 = pushBlock_319__wm_d3(fn_871.functionId, append_154__wm_d2(params_874.iterationStatementIds, tail_875.statementIds), tail_875.state);
if (!(__wm_is_tuple(__wm_bind_52) && __wm_bind_52.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const loopBodyId_876 = __wm_bind_52[0];
const afterLoopBody_877 = __wm_bind_52[1];
const bodyExpression_878 = findIrExpression_171__wm_d2(context_872.expressions, fn_871.bodyExprId);
const loopStatement_879 = { ...baseStatement_313__wm_d5(fn_871.functionId, "loop", bodyExpression_878.sourceExprId, bodyExpression_878.spanId, afterLoopBody_877), bodyBlockId: loopBodyId_876 };
const __wm_bind_53 = pushStatement_306__wm_d2(loopStatement_879, afterLoopBody_877);
if (!(__wm_is_tuple(__wm_bind_53) && __wm_bind_53.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const loopStatementId_880 = __wm_bind_53[0];
const afterLoop_881 = __wm_bind_53[1];
const __wm_bind_54 = pushBlock_319__wm_d3(fn_871.functionId, append_154__wm_d2(params_874.initialStatementIds, __wm_basis_Cons([loopStatementId_880, __wm_basis_Nil])), afterLoop_881);
if (!(__wm_is_tuple(__wm_bind_54) && __wm_bind_54.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const outerBlockId_882 = __wm_bind_54[0];
const afterOuter_883 = __wm_bind_54[1];
const lowered_884 = { functionId: fn_871.functionId, physicalParamLocalIds: Js.Array.fromList(params_874.physicalLocalIds), loopParamLocalIds: Js.Array.fromList(params_874.activeLocalIds), bodyBlockId: outerBlockId_882, recursive: true, spanId: fn_871.spanId };
return pushFunction_327__wm_d2(lowered_884, afterOuter_883);
};
const lowerRecursiveFunction_885 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return lowerRecursiveFunction_885__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerFunctions_886__wm_d3 = (functions_887, context_888, state_889) => {
__wm_tail_26: while (true) {
{
const __wm_scalar_27_0 = functions_887;
const __wm_scalar_27_1 = context_888;
const __wm_scalar_27_2 = state_889;
if (__wm_scalar_27_0 === __wm_basis_Nil) {
const context_890 = __wm_scalar_27_1;
const state_891 = __wm_scalar_27_2;
return state_891;
} else if (__wm_scalar_27_0?.ctor === -6 && __wm_scalar_27_0.args.length === 1 && __wm_is_tuple(__wm_scalar_27_0.args[0]) && __wm_scalar_27_0.args[0].length === 2) {
const fn_892 = __wm_scalar_27_0.args[0][0];
const rest_893 = __wm_scalar_27_0.args[0][1];
const context_894 = __wm_scalar_27_1;
const state_895 = __wm_scalar_27_2;
if ((fn_892.recursionGroupId < 0)) {
{
const __wm_tail_arg_31_0 = rest_893;
const __wm_tail_arg_31_1 = context_894;
const __wm_tail_arg_31_2 = lowerNonrecursiveFunction_819__wm_d3(fn_892, context_894, state_895);
functions_887 = __wm_tail_arg_31_0;
context_888 = __wm_tail_arg_31_1;
state_889 = __wm_tail_arg_31_2;
continue __wm_tail_26;
}
} else {
{
const __wm_tail_arg_32_0 = rest_893;
const __wm_tail_arg_32_1 = context_894;
const __wm_tail_arg_32_2 = lowerRecursiveFunction_885__wm_d3(fn_892, context_894, state_895);
functions_887 = __wm_tail_arg_32_0;
context_888 = __wm_tail_arg_32_1;
state_889 = __wm_tail_arg_32_2;
continue __wm_tail_26;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const lowerFunctions_886 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return lowerFunctions_886__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerSliceProgram_906__wm_d8 = (functions_896, expressions_897, matchArms_898, params_899, patterns_900, constructors_901, layouts_902, fields_903) => {
const context_904 = { functions: Js.Array.toList(functions_896), expressions: Js.Array.toList(expressions_897), matchArms: Js.Array.toList(matchArms_898), params: Js.Array.toList(params_899), patterns: Js.Array.toList(patterns_900), constructors: Js.Array.toList(constructors_901), layouts: Js.Array.toList(layouts_902), fields: Js.Array.toList(fields_903) };
const state_905 = lowerFunctions_886__wm_d3(context_904.functions, context_904, initialLowerState_162(undefined));
return finishLoweredProgram_330(state_905);
};
const lowerSliceProgram_906 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 8) return lowerSliceProgram_906__wm_d8(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7]);
__wm_fail("Match", "pattern match failure in function");
};
return { "LowerScope": LowerScope_331, "LowerValueResult": LowerValueResult_332, "LowerTailResult": LowerTailResult_333, "LowerChildrenResult": LowerChildrenResult_334, "LowerBindResult": LowerBindResult_335, "LowerParamResult": LowerParamResult_336, "LowerCasesResult": LowerCasesResult_337, "emptyScope": emptyScope_339, "lowerLetValue": lowerLetValue_340, "lowerLetValue__wm_d5": lowerLetValue_340__wm_d5, "lowerSequenceValue": lowerSequenceValue_341, "lowerSequenceValue__wm_d5": lowerSequenceValue_341__wm_d5, "bindPattern": bindPattern_342, "bindPattern__wm_d6": bindPattern_342__wm_d6, "bindPatternValue": bindPatternValue_343, "bindPatternValue__wm_d7": bindPatternValue_343__wm_d7, "bindTupleChildren": bindTupleChildren_344, "bindTupleChildren__wm_d8": bindTupleChildren_344__wm_d8, "assignJoin": assignJoin_423, "assignJoin__wm_d4": assignJoin_423__wm_d4, "lowerIfValue": lowerIfValue_451, "lowerIfValue__wm_d5": lowerIfValue_451__wm_d5, "lowerMatchValue": lowerMatchValue_452, "lowerMatchValue__wm_d5": lowerMatchValue_452__wm_d5, "lowerMatchValueCases": lowerMatchValueCases_453, "lowerMatchValueCases__wm_d9": lowerMatchValueCases_453__wm_d9, "bindMatchPayload": bindMatchPayload_454, "bindMatchPayload__wm_d6": bindMatchPayload_454__wm_d6, "bindMatchPayloadLanes": bindMatchPayloadLanes_455, "bindMatchPayloadLanes__wm_d9": bindMatchPayloadLanes_455__wm_d9, "operationKind": operationKind_577, "bindOperation": bindOperation_596, "bindOperation__wm_d7": bindOperation_596__wm_d7, "bindSourceOperation": bindSourceOperation_602, "bindSourceOperation__wm_d4": bindSourceOperation_602__wm_d4, "lowerValue": lowerValue_603, "lowerValue__wm_d4": lowerValue_603__wm_d4, "lowerChildren": lowerChildren_604, "lowerChildren__wm_d6": lowerChildren_604__wm_d6, "returnStatement": returnStatement_644, "returnStatement__wm_d3": returnStatement_644__wm_d3, "lowerTail": lowerTail_645, "lowerTail__wm_d4": lowerTail_645__wm_d4, "lowerTailIf": lowerTailIf_646, "lowerTailIf__wm_d4": lowerTailIf_646__wm_d4, "lowerTailMatch": lowerTailMatch_647, "lowerTailMatch__wm_d4": lowerTailMatch_647__wm_d4, "lowerTailMatchCases": lowerTailMatchCases_648, "lowerTailMatchCases__wm_d7": lowerTailMatchCases_648__wm_d7, "lowerTailCall": lowerTailCall_649, "lowerTailCall__wm_d4": lowerTailCall_649__wm_d4, "materializeTailNext": materializeTailNext_650, "materializeTailNext__wm_d5": materializeTailNext_650__wm_d5, "setupParameters": setupParameters_774, "setupParameters__wm_d7": setupParameters_774__wm_d7, "lowerNonrecursiveFunction": lowerNonrecursiveFunction_819, "lowerNonrecursiveFunction__wm_d3": lowerNonrecursiveFunction_819__wm_d3, "setupRecursiveParameters": setupRecursiveParameters_820, "setupRecursiveParameters__wm_d9": setupRecursiveParameters_820__wm_d9, "lowerRecursiveFunction": lowerRecursiveFunction_885, "lowerRecursiveFunction__wm_d3": lowerRecursiveFunction_885__wm_d3, "lowerFunctions": lowerFunctions_886, "lowerFunctions__wm_d3": lowerFunctions_886__wm_d3, "lowerSliceProgram": lowerSliceProgram_906, "lowerSliceProgram__wm_d8": lowerSliceProgram_906__wm_d8 };
  },
  (value) => { __wm_module_3 = value; },
);
let __wm_module_4;
__wm_define_module(
  "__wm_module_4",
  ["__wm_module_0", "__wm_module_2"],
  async () => {
const GpuSliceAdtDto_24 = __wm_module_0["GpuSliceAdtDto"];
const GpuSliceAdtFieldDto_53 = __wm_module_0["GpuSliceAdtFieldDto"];
const GpuSliceAdtLayoutDto_52 = __wm_module_0["GpuSliceAdtLayoutDto"];
const GpuSliceConstructorDto_25 = __wm_module_0["GpuSliceConstructorDto"];
const GpuSliceElaborationInputDto_46 = __wm_module_0["GpuSliceElaborationInputDto"];
const GpuSliceEnvironmentFieldDto_42 = __wm_module_0["GpuSliceEnvironmentFieldDto"];
const GpuSliceFunctionDto_37 = __wm_module_0["GpuSliceFunctionDto"];
const GpuSliceLoweredAtomDto_56 = __wm_module_0["GpuSliceLoweredAtomDto"];
const GpuSliceLoweredBlockDto_59 = __wm_module_0["GpuSliceLoweredBlockDto"];
const GpuSliceLoweredCaseDto_60 = __wm_module_0["GpuSliceLoweredCaseDto"];
const GpuSliceLoweredFunctionDto_61 = __wm_module_0["GpuSliceLoweredFunctionDto"];
const GpuSliceLoweredLocalDto_55 = __wm_module_0["GpuSliceLoweredLocalDto"];
const GpuSliceLoweredOperationDto_57 = __wm_module_0["GpuSliceLoweredOperationDto"];
const GpuSliceLoweredStatementDto_58 = __wm_module_0["GpuSliceLoweredStatementDto"];
const GpuSliceRootDto_41 = __wm_module_0["GpuSliceRootDto"];
const GpuSliceTypeDto_21 = __wm_module_0["GpuSliceTypeDto"];
const numberEqual_146 = __wm_module_2["numberEqual"];
const numberEqual_146__wm_d2 = __wm_module_2["numberEqual__wm_d2"];
const SliceEmitContext_907 = (__record_args) => ({ input: __record_args[0], environmentFields: __record_args[1], types: __record_args[2], constructors: __record_args[3], layouts: __record_args[4], fields: __record_args[5], functions: __record_args[6], locals: __record_args[7], atoms: __record_args[8], operations: __record_args[9], statements: __record_args[10], blocks: __record_args[11], cases: __record_args[12], recursiveFunctionId: __record_args[13], portable: __record_args[14] });
const text_909 = (__arg) => {
if (true) {
const value_908 = __arg;
return Text.of(value_908);
}
__wm_fail("Match", "pattern match failure in function");
};
const localName_911 = (__arg) => {
if (true) {
const id_910 = __arg;
return ("wm_l_" + text_909(id_910));
}
__wm_fail("Match", "pattern match failure in function");
};
const functionName_913 = (__arg) => {
if (true) {
const id_912 = __arg;
return ("wm_f_" + text_909(id_912));
}
__wm_fail("Match", "pattern match failure in function");
};
const tupleName_915 = (__arg) => {
if (true) {
const id_914 = __arg;
return ("wm_tuple_" + text_909(id_914));
}
__wm_fail("Match", "pattern match failure in function");
};
const tupleFactoryName_917 = (__arg) => {
if (true) {
const id_916 = __arg;
return ("wm_make_tuple_" + text_909(id_916));
}
__wm_fail("Match", "pattern match failure in function");
};
const tupleFieldName_919 = (__arg) => {
if (true) {
const index_918 = __arg;
return ("wm_i_" + text_909(index_918));
}
__wm_fail("Match", "pattern match failure in function");
};
const layoutName_921 = (__arg) => {
if (true) {
const id_920 = __arg;
return ("wm_adt_" + text_909(id_920));
}
__wm_fail("Match", "pattern match failure in function");
};
const constructorName_923 = (__arg) => {
if (true) {
const id_922 = __arg;
return ("wm_make_ctor_" + text_909(id_922));
}
__wm_fail("Match", "pattern match failure in function");
};
const payloadFieldName_925 = (__arg) => {
if (true) {
const id_924 = __arg;
return ("wm_p_" + text_909(id_924));
}
__wm_fail("Match", "pattern match failure in function");
};
const uniformFieldName_927 = (__arg) => {
if (true) {
const index_926 = __arg;
return ("wm_u_" + text_909(index_926));
}
__wm_fail("Match", "pattern match failure in function");
};
const resourceFieldName_929 = (__arg) => {
if (true) {
const binding_928 = __arg;
return ("wm_r_" + text_909(binding_928));
}
__wm_fail("Match", "pattern match failure in function");
};
const recursiveResultName_931 = (__arg) => {
if (true) {
const id_930 = __arg;
return ("wm_result_" + text_909(id_930));
}
__wm_fail("Match", "pattern match failure in function");
};
const recursiveDoneName_933 = (__arg) => {
if (true) {
const id_932 = __arg;
return ("wm_done_" + text_909(id_932));
}
__wm_fail("Match", "pattern match failure in function");
};
const listLength_934__wm_d2 = (items_935, count_936) => {
__wm_tail_27: while (true) {
{
const __wm_scalar_28_0 = items_935;
const __wm_scalar_28_1 = count_936;
if (__wm_scalar_28_0 === __wm_basis_Nil) {
const count_937 = __wm_scalar_28_1;
return count_937;
} else if (__wm_scalar_28_0?.ctor === -6 && __wm_scalar_28_0.args.length === 1 && __wm_is_tuple(__wm_scalar_28_0.args[0]) && __wm_scalar_28_0.args[0].length === 2) {
const _item_938 = __wm_scalar_28_0.args[0][0];
const rest_939 = __wm_scalar_28_0.args[0][1];
const count_940 = __wm_scalar_28_1;
{
const __wm_tail_arg_33_0 = rest_939;
const __wm_tail_arg_33_1 = (count_940 + 1);
items_935 = __wm_tail_arg_33_0;
count_936 = __wm_tail_arg_33_1;
continue __wm_tail_27;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const listLength_934 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return listLength_934__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const vectorLaneName_942 = (__arg) => {
if (true) {
const index_941 = __arg;
if (numberEqual_146__wm_d2(index_941, 0)) {
return "x";
} else {
if (numberEqual_146__wm_d2(index_941, 1)) {
return "y";
} else {
if (numberEqual_146__wm_d2(index_941, 2)) {
return "z";
} else {
return "w";
}
}
}
}
__wm_fail("Match", "pattern match failure in function");
};
const findType_943__wm_d2 = (items_944, id_945) => {
__wm_tail_28: while (true) {
{
const __wm_scalar_29_0 = items_944;
const __wm_scalar_29_1 = id_945;
if (__wm_scalar_29_0 === __wm_basis_Nil) {
const id_946 = __wm_scalar_29_1;
return __wm_fail("Panic", "missing Slang-emission type");
} else if (__wm_scalar_29_0?.ctor === -6 && __wm_scalar_29_0.args.length === 1 && __wm_is_tuple(__wm_scalar_29_0.args[0]) && __wm_scalar_29_0.args[0].length === 2) {
const item_947 = __wm_scalar_29_0.args[0][0];
const rest_948 = __wm_scalar_29_0.args[0][1];
const id_949 = __wm_scalar_29_1;
{
const exact_950 = item_947;
if (numberEqual_146__wm_d2(exact_950.id, id_949)) {
return exact_950;
} else {
{
const __wm_tail_arg_34_0 = rest_948;
const __wm_tail_arg_34_1 = id_949;
items_944 = __wm_tail_arg_34_0;
id_945 = __wm_tail_arg_34_1;
continue __wm_tail_28;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findType_943 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findType_943__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const vectorName_955__wm_d2 = (gpuType_951, context_952) => {
const scalar_954 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2) {
const typeId_953 = __v.args[0][0];
return findType_943__wm_d2(context_952.types, typeId_953);
} else if (__v === __wm_basis_Nil) {

return __wm_fail("Panic", "shader vector has no component type");
}
__wm_fail("Match", "non-exhaustive match");
})(Js.Array.toList(gpuType_951.items));
return ((__wm_eq(scalar_954.kind, "i32") ? "int" : "float") + text_909(listLength_934__wm_d2(Js.Array.toList(gpuType_951.items), 0)));
};
const vectorName_955 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return vectorName_955__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findEnvironmentField_956__wm_d3 = (items_957, environmentId_958, index_959) => {
__wm_tail_29: while (true) {
{
const __wm_scalar_30_0 = items_957;
const __wm_scalar_30_1 = environmentId_958;
const __wm_scalar_30_2 = index_959;
if (__wm_scalar_30_0 === __wm_basis_Nil) {
const _environmentId_960 = __wm_scalar_30_1;
const _index_961 = __wm_scalar_30_2;
return __wm_fail("Panic", "missing Slang-emission environment field");
} else if (__wm_scalar_30_0?.ctor === -6 && __wm_scalar_30_0.args.length === 1 && __wm_is_tuple(__wm_scalar_30_0.args[0]) && __wm_scalar_30_0.args[0].length === 2) {
const item_962 = __wm_scalar_30_0.args[0][0];
const rest_963 = __wm_scalar_30_0.args[0][1];
const environmentId_964 = __wm_scalar_30_1;
const index_965 = __wm_scalar_30_2;
{
const exact_966 = item_962;
if (__wm_op_and_d2(numberEqual_146__wm_d2(exact_966.environmentId, environmentId_964), numberEqual_146__wm_d2(exact_966.declaredIndex, index_965))) {
return exact_966;
} else {
{
const __wm_tail_arg_35_0 = rest_963;
const __wm_tail_arg_35_1 = environmentId_964;
const __wm_tail_arg_35_2 = index_965;
items_957 = __wm_tail_arg_35_0;
environmentId_958 = __wm_tail_arg_35_1;
index_959 = __wm_tail_arg_35_2;
continue __wm_tail_29;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findEnvironmentField_956 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findEnvironmentField_956__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const findLayout_967__wm_d2 = (items_968, id_969) => {
__wm_tail_30: while (true) {
{
const __wm_scalar_31_0 = items_968;
const __wm_scalar_31_1 = id_969;
if (__wm_scalar_31_0 === __wm_basis_Nil) {
const id_970 = __wm_scalar_31_1;
return __wm_fail("Panic", "missing Slang-emission ADT layout");
} else if (__wm_scalar_31_0?.ctor === -6 && __wm_scalar_31_0.args.length === 1 && __wm_is_tuple(__wm_scalar_31_0.args[0]) && __wm_scalar_31_0.args[0].length === 2) {
const item_971 = __wm_scalar_31_0.args[0][0];
const rest_972 = __wm_scalar_31_0.args[0][1];
const id_973 = __wm_scalar_31_1;
{
const exact_974 = item_971;
if (numberEqual_146__wm_d2(exact_974.id, id_973)) {
return exact_974;
} else {
{
const __wm_tail_arg_36_0 = rest_972;
const __wm_tail_arg_36_1 = id_973;
items_968 = __wm_tail_arg_36_0;
id_969 = __wm_tail_arg_36_1;
continue __wm_tail_30;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLayout_967 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLayout_967__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLayoutByType_975__wm_d2 = (items_976, typeId_977) => {
__wm_tail_31: while (true) {
{
const __wm_scalar_32_0 = items_976;
const __wm_scalar_32_1 = typeId_977;
if (__wm_scalar_32_0 === __wm_basis_Nil) {
const typeId_978 = __wm_scalar_32_1;
return __wm_fail("Panic", "missing Slang-emission ADT type layout");
} else if (__wm_scalar_32_0?.ctor === -6 && __wm_scalar_32_0.args.length === 1 && __wm_is_tuple(__wm_scalar_32_0.args[0]) && __wm_scalar_32_0.args[0].length === 2) {
const item_979 = __wm_scalar_32_0.args[0][0];
const rest_980 = __wm_scalar_32_0.args[0][1];
const typeId_981 = __wm_scalar_32_1;
{
const exact_982 = item_979;
if (numberEqual_146__wm_d2(exact_982.typeId, typeId_981)) {
return exact_982;
} else {
{
const __wm_tail_arg_37_0 = rest_980;
const __wm_tail_arg_37_1 = typeId_981;
items_976 = __wm_tail_arg_37_0;
typeId_977 = __wm_tail_arg_37_1;
continue __wm_tail_31;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLayoutByType_975 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLayoutByType_975__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findField_983__wm_d2 = (items_984, id_985) => {
__wm_tail_32: while (true) {
{
const __wm_scalar_33_0 = items_984;
const __wm_scalar_33_1 = id_985;
if (__wm_scalar_33_0 === __wm_basis_Nil) {
const id_986 = __wm_scalar_33_1;
return __wm_fail("Panic", "missing Slang-emission ADT field");
} else if (__wm_scalar_33_0?.ctor === -6 && __wm_scalar_33_0.args.length === 1 && __wm_is_tuple(__wm_scalar_33_0.args[0]) && __wm_scalar_33_0.args[0].length === 2) {
const item_987 = __wm_scalar_33_0.args[0][0];
const rest_988 = __wm_scalar_33_0.args[0][1];
const id_989 = __wm_scalar_33_1;
{
const exact_990 = item_987;
if (numberEqual_146__wm_d2(exact_990.id, id_989)) {
return exact_990;
} else {
{
const __wm_tail_arg_38_0 = rest_988;
const __wm_tail_arg_38_1 = id_989;
items_984 = __wm_tail_arg_38_0;
id_985 = __wm_tail_arg_38_1;
continue __wm_tail_32;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findField_983 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findField_983__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findConstructor_991__wm_d2 = (items_992, id_993) => {
__wm_tail_33: while (true) {
{
const __wm_scalar_34_0 = items_992;
const __wm_scalar_34_1 = id_993;
if (__wm_scalar_34_0 === __wm_basis_Nil) {
const id_994 = __wm_scalar_34_1;
return __wm_fail("Panic", "missing Slang-emission constructor");
} else if (__wm_scalar_34_0?.ctor === -6 && __wm_scalar_34_0.args.length === 1 && __wm_is_tuple(__wm_scalar_34_0.args[0]) && __wm_scalar_34_0.args[0].length === 2) {
const item_995 = __wm_scalar_34_0.args[0][0];
const rest_996 = __wm_scalar_34_0.args[0][1];
const id_997 = __wm_scalar_34_1;
{
const exact_998 = item_995;
if (numberEqual_146__wm_d2(exact_998.id, id_997)) {
return exact_998;
} else {
{
const __wm_tail_arg_39_0 = rest_996;
const __wm_tail_arg_39_1 = id_997;
items_992 = __wm_tail_arg_39_0;
id_993 = __wm_tail_arg_39_1;
continue __wm_tail_33;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findConstructor_991 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findConstructor_991__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLocal_999__wm_d2 = (items_1000, id_1001) => {
__wm_tail_34: while (true) {
{
const __wm_scalar_35_0 = items_1000;
const __wm_scalar_35_1 = id_1001;
if (__wm_scalar_35_0 === __wm_basis_Nil) {
const id_1002 = __wm_scalar_35_1;
return __wm_fail("Panic", "missing Slang-emission local");
} else if (__wm_scalar_35_0?.ctor === -6 && __wm_scalar_35_0.args.length === 1 && __wm_is_tuple(__wm_scalar_35_0.args[0]) && __wm_scalar_35_0.args[0].length === 2) {
const item_1003 = __wm_scalar_35_0.args[0][0];
const rest_1004 = __wm_scalar_35_0.args[0][1];
const id_1005 = __wm_scalar_35_1;
{
const exact_1006 = item_1003;
if (numberEqual_146__wm_d2(exact_1006.id, id_1005)) {
return exact_1006;
} else {
{
const __wm_tail_arg_40_0 = rest_1004;
const __wm_tail_arg_40_1 = id_1005;
items_1000 = __wm_tail_arg_40_0;
id_1001 = __wm_tail_arg_40_1;
continue __wm_tail_34;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLocal_999 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLocal_999__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findAtom_1007__wm_d2 = (items_1008, id_1009) => {
__wm_tail_35: while (true) {
{
const __wm_scalar_36_0 = items_1008;
const __wm_scalar_36_1 = id_1009;
if (__wm_scalar_36_0 === __wm_basis_Nil) {
const id_1010 = __wm_scalar_36_1;
return __wm_fail("Panic", "missing Slang-emission atom");
} else if (__wm_scalar_36_0?.ctor === -6 && __wm_scalar_36_0.args.length === 1 && __wm_is_tuple(__wm_scalar_36_0.args[0]) && __wm_scalar_36_0.args[0].length === 2) {
const item_1011 = __wm_scalar_36_0.args[0][0];
const rest_1012 = __wm_scalar_36_0.args[0][1];
const id_1013 = __wm_scalar_36_1;
{
const exact_1014 = item_1011;
if (numberEqual_146__wm_d2(exact_1014.id, id_1013)) {
return exact_1014;
} else {
{
const __wm_tail_arg_41_0 = rest_1012;
const __wm_tail_arg_41_1 = id_1013;
items_1008 = __wm_tail_arg_41_0;
id_1009 = __wm_tail_arg_41_1;
continue __wm_tail_35;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findAtom_1007 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findAtom_1007__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findOperation_1015__wm_d2 = (items_1016, id_1017) => {
__wm_tail_36: while (true) {
{
const __wm_scalar_37_0 = items_1016;
const __wm_scalar_37_1 = id_1017;
if (__wm_scalar_37_0 === __wm_basis_Nil) {
const id_1018 = __wm_scalar_37_1;
return __wm_fail("Panic", "missing Slang-emission operation");
} else if (__wm_scalar_37_0?.ctor === -6 && __wm_scalar_37_0.args.length === 1 && __wm_is_tuple(__wm_scalar_37_0.args[0]) && __wm_scalar_37_0.args[0].length === 2) {
const item_1019 = __wm_scalar_37_0.args[0][0];
const rest_1020 = __wm_scalar_37_0.args[0][1];
const id_1021 = __wm_scalar_37_1;
{
const exact_1022 = item_1019;
if (numberEqual_146__wm_d2(exact_1022.id, id_1021)) {
return exact_1022;
} else {
{
const __wm_tail_arg_42_0 = rest_1020;
const __wm_tail_arg_42_1 = id_1021;
items_1016 = __wm_tail_arg_42_0;
id_1017 = __wm_tail_arg_42_1;
continue __wm_tail_36;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findOperation_1015 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findOperation_1015__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findStatement_1023__wm_d2 = (items_1024, id_1025) => {
__wm_tail_37: while (true) {
{
const __wm_scalar_38_0 = items_1024;
const __wm_scalar_38_1 = id_1025;
if (__wm_scalar_38_0 === __wm_basis_Nil) {
const id_1026 = __wm_scalar_38_1;
return __wm_fail("Panic", "missing Slang-emission statement");
} else if (__wm_scalar_38_0?.ctor === -6 && __wm_scalar_38_0.args.length === 1 && __wm_is_tuple(__wm_scalar_38_0.args[0]) && __wm_scalar_38_0.args[0].length === 2) {
const item_1027 = __wm_scalar_38_0.args[0][0];
const rest_1028 = __wm_scalar_38_0.args[0][1];
const id_1029 = __wm_scalar_38_1;
{
const exact_1030 = item_1027;
if (numberEqual_146__wm_d2(exact_1030.id, id_1029)) {
return exact_1030;
} else {
{
const __wm_tail_arg_43_0 = rest_1028;
const __wm_tail_arg_43_1 = id_1029;
items_1024 = __wm_tail_arg_43_0;
id_1025 = __wm_tail_arg_43_1;
continue __wm_tail_37;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findStatement_1023 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findStatement_1023__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findBlock_1031__wm_d2 = (items_1032, id_1033) => {
__wm_tail_38: while (true) {
{
const __wm_scalar_39_0 = items_1032;
const __wm_scalar_39_1 = id_1033;
if (__wm_scalar_39_0 === __wm_basis_Nil) {
const id_1034 = __wm_scalar_39_1;
return __wm_fail("Panic", "missing Slang-emission block");
} else if (__wm_scalar_39_0?.ctor === -6 && __wm_scalar_39_0.args.length === 1 && __wm_is_tuple(__wm_scalar_39_0.args[0]) && __wm_scalar_39_0.args[0].length === 2) {
const item_1035 = __wm_scalar_39_0.args[0][0];
const rest_1036 = __wm_scalar_39_0.args[0][1];
const id_1037 = __wm_scalar_39_1;
{
const exact_1038 = item_1035;
if (numberEqual_146__wm_d2(exact_1038.id, id_1037)) {
return exact_1038;
} else {
{
const __wm_tail_arg_44_0 = rest_1036;
const __wm_tail_arg_44_1 = id_1037;
items_1032 = __wm_tail_arg_44_0;
id_1033 = __wm_tail_arg_44_1;
continue __wm_tail_38;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findBlock_1031 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findBlock_1031__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findCase_1039__wm_d2 = (items_1040, id_1041) => {
__wm_tail_39: while (true) {
{
const __wm_scalar_40_0 = items_1040;
const __wm_scalar_40_1 = id_1041;
if (__wm_scalar_40_0 === __wm_basis_Nil) {
const id_1042 = __wm_scalar_40_1;
return __wm_fail("Panic", "missing Slang-emission case");
} else if (__wm_scalar_40_0?.ctor === -6 && __wm_scalar_40_0.args.length === 1 && __wm_is_tuple(__wm_scalar_40_0.args[0]) && __wm_scalar_40_0.args[0].length === 2) {
const item_1043 = __wm_scalar_40_0.args[0][0];
const rest_1044 = __wm_scalar_40_0.args[0][1];
const id_1045 = __wm_scalar_40_1;
{
const exact_1046 = item_1043;
if (numberEqual_146__wm_d2(exact_1046.id, id_1045)) {
return exact_1046;
} else {
{
const __wm_tail_arg_45_0 = rest_1044;
const __wm_tail_arg_45_1 = id_1045;
items_1040 = __wm_tail_arg_45_0;
id_1041 = __wm_tail_arg_45_1;
continue __wm_tail_39;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findCase_1039 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findCase_1039__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findFunction_1047__wm_d2 = (items_1048, id_1049) => {
__wm_tail_40: while (true) {
{
const __wm_scalar_41_0 = items_1048;
const __wm_scalar_41_1 = id_1049;
if (__wm_scalar_41_0 === __wm_basis_Nil) {
const id_1050 = __wm_scalar_41_1;
return __wm_fail("Panic", "missing Slang-emission function");
} else if (__wm_scalar_41_0?.ctor === -6 && __wm_scalar_41_0.args.length === 1 && __wm_is_tuple(__wm_scalar_41_0.args[0]) && __wm_scalar_41_0.args[0].length === 2) {
const item_1051 = __wm_scalar_41_0.args[0][0];
const rest_1052 = __wm_scalar_41_0.args[0][1];
const id_1053 = __wm_scalar_41_1;
{
const exact_1054 = item_1051;
if (numberEqual_146__wm_d2(exact_1054.functionId, id_1053)) {
return exact_1054;
} else {
{
const __wm_tail_arg_46_0 = rest_1052;
const __wm_tail_arg_46_1 = id_1053;
items_1048 = __wm_tail_arg_46_0;
id_1049 = __wm_tail_arg_46_1;
continue __wm_tail_40;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findFunction_1047 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findFunction_1047__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findAdtForEmit_1055__wm_d2 = (items_1056, typeNameId_1057) => {
__wm_tail_41: while (true) {
{
const __wm_scalar_42_0 = items_1056;
const __wm_scalar_42_1 = typeNameId_1057;
if (__wm_scalar_42_0 === __wm_basis_Nil) {
const typeNameId_1058 = __wm_scalar_42_1;
return __wm_fail("Panic", "missing Slang-emission ADT");
} else if (__wm_scalar_42_0?.ctor === -6 && __wm_scalar_42_0.args.length === 1 && __wm_is_tuple(__wm_scalar_42_0.args[0]) && __wm_scalar_42_0.args[0].length === 2) {
const item_1059 = __wm_scalar_42_0.args[0][0];
const rest_1060 = __wm_scalar_42_0.args[0][1];
const typeNameId_1061 = __wm_scalar_42_1;
{
const exact_1062 = item_1059;
if (numberEqual_146__wm_d2(exact_1062.typeNameId, typeNameId_1061)) {
return exact_1062;
} else {
{
const __wm_tail_arg_47_0 = rest_1060;
const __wm_tail_arg_47_1 = typeNameId_1061;
items_1056 = __wm_tail_arg_47_0;
typeNameId_1057 = __wm_tail_arg_47_1;
continue __wm_tail_41;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findAdtForEmit_1055 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findAdtForEmit_1055__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findSourceFunction_1063__wm_d2 = (items_1064, functionId_1065) => {
__wm_tail_42: while (true) {
{
const __wm_scalar_43_0 = items_1064;
const __wm_scalar_43_1 = functionId_1065;
if (__wm_scalar_43_0 === __wm_basis_Nil) {
const functionId_1066 = __wm_scalar_43_1;
return __wm_fail("Panic", "missing Slang-emission source function");
} else if (__wm_scalar_43_0?.ctor === -6 && __wm_scalar_43_0.args.length === 1 && __wm_is_tuple(__wm_scalar_43_0.args[0]) && __wm_scalar_43_0.args[0].length === 2) {
const item_1067 = __wm_scalar_43_0.args[0][0];
const rest_1068 = __wm_scalar_43_0.args[0][1];
const functionId_1069 = __wm_scalar_43_1;
{
const exact_1070 = item_1067;
if (numberEqual_146__wm_d2(exact_1070.id, functionId_1069)) {
return exact_1070;
} else {
{
const __wm_tail_arg_48_0 = rest_1068;
const __wm_tail_arg_48_1 = functionId_1069;
items_1064 = __wm_tail_arg_48_0;
functionId_1065 = __wm_tail_arg_48_1;
continue __wm_tail_42;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findSourceFunction_1063 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findSourceFunction_1063__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const typeName_1075__wm_d2 = (typeId_1071, context_1072) => {
const gpuType_1073 = findType_943__wm_d2(context_1072.types, typeId_1071);
if (__wm_eq(gpuType_1073.kind, "f32")) {
return "float";
} else {
if (__wm_eq(gpuType_1073.kind, "i32")) {
return "int";
} else {
if (__wm_eq(gpuType_1073.kind, "bool")) {
return "bool";
} else {
if (__wm_eq(gpuType_1073.kind, "void")) {
return "void";
} else {
if (__wm_eq(gpuType_1073.kind, "vector")) {
return vectorName_955__wm_d2(gpuType_1073, context_1072);
} else {
if (__wm_eq(gpuType_1073.kind, "tuple")) {
return tupleName_915(typeId_1071);
} else {
if (__wm_eq(gpuType_1073.kind, "adt")) {
const layout_1074 = findLayoutByType_975__wm_d2(context_1072.layouts, typeId_1071);
return layoutName_921(layout_1074.id);
} else {
if (__wm_eq(gpuType_1073.kind, "sampled-texture-2d")) {
return "Texture2D<float4>";
} else {
if (__wm_eq(gpuType_1073.kind, "sampler")) {
return "SamplerState";
} else {
return __wm_fail("Panic", "function type reached Slang value emission");
}
}
}
}
}
}
}
}
}
};
const typeName_1075 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return typeName_1075__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitEnvironmentFields_1076__wm_d3 = (items_1077, context_1078, output_1079) => {
__wm_tail_43: while (true) {
{
const __wm_scalar_44_0 = items_1077;
const __wm_scalar_44_1 = context_1078;
const __wm_scalar_44_2 = output_1079;
if (__wm_scalar_44_0 === __wm_basis_Nil) {
const _context_1080 = __wm_scalar_44_1;
const output_1081 = __wm_scalar_44_2;
return output_1081;
} else if (__wm_scalar_44_0?.ctor === -6 && __wm_scalar_44_0.args.length === 1 && __wm_is_tuple(__wm_scalar_44_0.args[0]) && __wm_scalar_44_0.args[0].length === 2) {
const field_1082 = __wm_scalar_44_0.args[0][0];
const rest_1083 = __wm_scalar_44_0.args[0][1];
const context_1084 = __wm_scalar_44_1;
const output_1085 = __wm_scalar_44_2;
{
const exactField_1086 = field_1082;
const exactContext_1087 = context_1084;
{
const __wm_tail_arg_49_0 = rest_1083;
const __wm_tail_arg_49_1 = exactContext_1087;
const __wm_tail_arg_49_2 = (__wm_eq(exactField_1086.kind, "uniform") ? (() => {
const gpuType_1088 = findType_943__wm_d2(exactContext_1087.types, exactField_1086.typeId);
const fieldType_1089 = (__wm_eq(gpuType_1088.kind, "bool") ? "int" : typeName_1075__wm_d2(exactField_1086.typeId, exactContext_1087));
return (((((output_1085 + "  ") + fieldType_1089) + " ") + uniformFieldName_927(exactField_1086.declaredIndex)) + ";\n");
})() : output_1085);
items_1077 = __wm_tail_arg_49_0;
context_1078 = __wm_tail_arg_49_1;
output_1079 = __wm_tail_arg_49_2;
continue __wm_tail_43;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitEnvironmentFields_1076 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitEnvironmentFields_1076__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
let hasUniformField_1090 = (__arg) => {
__wm_tail_44: while (true) {
if (true) {
const items_1091 = __arg;
{
const __wm_tail_value_50 = items_1091;
if (__wm_tail_value_50 === __wm_basis_Nil) {

return false;
} else if (__wm_tail_value_50?.ctor === -6 && __wm_tail_value_50.args.length === 1 && __wm_is_tuple(__wm_tail_value_50.args[0]) && __wm_tail_value_50.args[0].length === 2) {
const field_1092 = __wm_tail_value_50.args[0][0];
const rest_1093 = __wm_tail_value_50.args[0][1];
{
const exact_1094 = field_1092;
if (__wm_eq(exact_1094.kind, "uniform")) {
return true;
} else {
__arg = rest_1093;
continue __wm_tail_44;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "pattern match failure in function");
}
};
const emitResourceDeclarations_1095__wm_d3 = (items_1096, context_1097, output_1098) => {
__wm_tail_45: while (true) {
{
const __wm_scalar_45_0 = items_1096;
const __wm_scalar_45_1 = context_1097;
const __wm_scalar_45_2 = output_1098;
if (__wm_scalar_45_0 === __wm_basis_Nil) {
const _context_1099 = __wm_scalar_45_1;
const output_1100 = __wm_scalar_45_2;
return output_1100;
} else if (__wm_scalar_45_0?.ctor === -6 && __wm_scalar_45_0.args.length === 1 && __wm_is_tuple(__wm_scalar_45_0.args[0]) && __wm_scalar_45_0.args[0].length === 2) {
const field_1101 = __wm_scalar_45_0.args[0][0];
const rest_1102 = __wm_scalar_45_0.args[0][1];
const context_1103 = __wm_scalar_45_1;
const output_1104 = __wm_scalar_45_2;
{
const exactField_1105 = field_1101;
const exactContext_1106 = context_1103;
const next_1107 = (__wm_eq(exactField_1105.kind, "uniform") ? output_1104 : (((((((output_1104 + "[[vk::binding(") + text_909(exactField_1105.binding)) + ", 0)]]\n") + typeName_1075__wm_d2(exactField_1105.typeId, exactContext_1106)) + " ") + resourceFieldName_929(exactField_1105.binding)) + ";\n\n"));
{
const __wm_tail_arg_51_0 = rest_1102;
const __wm_tail_arg_51_1 = exactContext_1106;
const __wm_tail_arg_51_2 = next_1107;
items_1096 = __wm_tail_arg_51_0;
context_1097 = __wm_tail_arg_51_1;
output_1098 = __wm_tail_arg_51_2;
continue __wm_tail_45;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitResourceDeclarations_1095 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitResourceDeclarations_1095__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitEnvironmentDeclaration_1111 = (__arg) => {
if (true) {
const context_1108 = __arg;
if (__wm_op_or_d2(context_1108.portable, numberEqual_146__wm_d2(context_1108.input.root.environmentId, __wm_op_sub(1)))) {
return "";
} else {
const fields_1109 = context_1108.environmentFields;
const uniformDeclaration_1110 = (hasUniformField_1090(fields_1109) ? (((("struct wm_environment {\n" + emitEnvironmentFields_1076__wm_d3(fields_1109, context_1108, "")) + "};\n") + "[[vk::binding(0, 0)]]\n") + "ConstantBuffer<wm_environment> wm_uniforms;\n\n") : "");
return (uniformDeclaration_1110 + emitResourceDeclarations_1095__wm_d3(fields_1109, context_1108, ""));
}
}
__wm_fail("Match", "pattern match failure in function");
};
const emitPortableEnvironmentAccessors_1112__wm_d3 = (items_1113, context_1114, output_1115) => {
__wm_tail_46: while (true) {
{
const __wm_scalar_46_0 = items_1113;
const __wm_scalar_46_1 = context_1114;
const __wm_scalar_46_2 = output_1115;
if (__wm_scalar_46_0 === __wm_basis_Nil) {
const _context_1116 = __wm_scalar_46_1;
const output_1117 = __wm_scalar_46_2;
return output_1117;
} else if (__wm_scalar_46_0?.ctor === -6 && __wm_scalar_46_0.args.length === 1 && __wm_is_tuple(__wm_scalar_46_0.args[0]) && __wm_scalar_46_0.args[0].length === 2) {
const field_1118 = __wm_scalar_46_0.args[0][0];
const rest_1119 = __wm_scalar_46_0.args[0][1];
const context_1120 = __wm_scalar_46_1;
const output_1121 = __wm_scalar_46_2;
{
const exactField_1122 = field_1118;
const exactContext_1123 = context_1120;
const belongsToRoot_1124 = numberEqual_146__wm_d2(exactField_1122.environmentId, exactContext_1123.input.root.environmentId);
const next_1126 = (__wm_op_not(belongsToRoot_1124) ? output_1121 : (() => {
const name_1125 = (__wm_eq(exactField_1122.kind, "uniform") ? ("WM_UNIFORM_" + text_909(exactField_1122.declaredIndex)) : ("WM_RESOURCE_" + text_909(exactField_1122.binding)));
return (((((((((output_1121 + "#ifndef ") + name_1125) + "\n") + "__extern_cpp ") + typeName_1075__wm_d2(exactField_1122.typeId, exactContext_1123)) + " ") + name_1125) + "();\n") + "#endif\n");
})());
{
const __wm_tail_arg_52_0 = rest_1119;
const __wm_tail_arg_52_1 = exactContext_1123;
const __wm_tail_arg_52_2 = next_1126;
items_1113 = __wm_tail_arg_52_0;
context_1114 = __wm_tail_arg_52_1;
output_1115 = __wm_tail_arg_52_2;
continue __wm_tail_46;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitPortableEnvironmentAccessors_1112 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitPortableEnvironmentAccessors_1112__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const joinText_1127__wm_d3 = (items_1128, separator_1129, output_1130) => {
__wm_tail_47: while (true) {
{
const __wm_scalar_47_0 = items_1128;
const __wm_scalar_47_1 = separator_1129;
const __wm_scalar_47_2 = output_1130;
if (__wm_scalar_47_0 === __wm_basis_Nil) {
const separator_1131 = __wm_scalar_47_1;
const output_1132 = __wm_scalar_47_2;
return output_1132;
} else if (__wm_scalar_47_0?.ctor === -6 && __wm_scalar_47_0.args.length === 1 && __wm_is_tuple(__wm_scalar_47_0.args[0]) && __wm_scalar_47_0.args[0].length === 2) {
const item_1133 = __wm_scalar_47_0.args[0][0];
const rest_1134 = __wm_scalar_47_0.args[0][1];
const separator_1135 = __wm_scalar_47_1;
const output_1136 = __wm_scalar_47_2;
{
const next_1137 = (__wm_eq(output_1136, "") ? item_1133 : ((output_1136 + separator_1135) + item_1133));
{
const __wm_tail_arg_53_0 = rest_1134;
const __wm_tail_arg_53_1 = separator_1135;
const __wm_tail_arg_53_2 = next_1137;
items_1128 = __wm_tail_arg_53_0;
separator_1129 = __wm_tail_arg_53_1;
output_1130 = __wm_tail_arg_53_2;
continue __wm_tail_47;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const joinText_1127 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return joinText_1127__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleFields_1138__wm_d4 = (typeIds_1139, index_1140, context_1141, output_1142) => {
__wm_tail_48: while (true) {
{
const __wm_scalar_48_0 = typeIds_1139;
const __wm_scalar_48_1 = index_1140;
const __wm_scalar_48_2 = context_1141;
const __wm_scalar_48_3 = output_1142;
if (__wm_scalar_48_0 === __wm_basis_Nil) {
const index_1143 = __wm_scalar_48_1;
const context_1144 = __wm_scalar_48_2;
const output_1145 = __wm_scalar_48_3;
return output_1145;
} else if (__wm_scalar_48_0?.ctor === -6 && __wm_scalar_48_0.args.length === 1 && __wm_is_tuple(__wm_scalar_48_0.args[0]) && __wm_scalar_48_0.args[0].length === 2) {
const typeId_1146 = __wm_scalar_48_0.args[0][0];
const rest_1147 = __wm_scalar_48_0.args[0][1];
const index_1148 = __wm_scalar_48_1;
const context_1149 = __wm_scalar_48_2;
const output_1150 = __wm_scalar_48_3;
{
const __wm_tail_arg_54_0 = rest_1147;
const __wm_tail_arg_54_1 = (index_1148 + 1);
const __wm_tail_arg_54_2 = context_1149;
const __wm_tail_arg_54_3 = (((((output_1150 + "  ") + typeName_1075__wm_d2(typeId_1146, context_1149)) + " ") + tupleFieldName_919(index_1148)) + ";\n");
typeIds_1139 = __wm_tail_arg_54_0;
index_1140 = __wm_tail_arg_54_1;
context_1141 = __wm_tail_arg_54_2;
output_1142 = __wm_tail_arg_54_3;
continue __wm_tail_48;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitTupleFields_1138 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitTupleFields_1138__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleParams_1151__wm_d4 = (typeIds_1152, index_1153, context_1154, output_1155) => {
__wm_tail_49: while (true) {
{
const __wm_scalar_49_0 = typeIds_1152;
const __wm_scalar_49_1 = index_1153;
const __wm_scalar_49_2 = context_1154;
const __wm_scalar_49_3 = output_1155;
if (__wm_scalar_49_0 === __wm_basis_Nil) {
const index_1156 = __wm_scalar_49_1;
const context_1157 = __wm_scalar_49_2;
const output_1158 = __wm_scalar_49_3;
return output_1158;
} else if (__wm_scalar_49_0?.ctor === -6 && __wm_scalar_49_0.args.length === 1 && __wm_is_tuple(__wm_scalar_49_0.args[0]) && __wm_scalar_49_0.args[0].length === 2) {
const typeId_1159 = __wm_scalar_49_0.args[0][0];
const rest_1160 = __wm_scalar_49_0.args[0][1];
const index_1161 = __wm_scalar_49_1;
const context_1162 = __wm_scalar_49_2;
const output_1163 = __wm_scalar_49_3;
{
const parameter_1164 = ((typeName_1075__wm_d2(typeId_1159, context_1162) + " ") + tupleFieldName_919(index_1161));
const next_1165 = (__wm_eq(output_1163, "") ? parameter_1164 : ((output_1163 + ", ") + parameter_1164));
{
const __wm_tail_arg_55_0 = rest_1160;
const __wm_tail_arg_55_1 = (index_1161 + 1);
const __wm_tail_arg_55_2 = context_1162;
const __wm_tail_arg_55_3 = next_1165;
typeIds_1152 = __wm_tail_arg_55_0;
index_1153 = __wm_tail_arg_55_1;
context_1154 = __wm_tail_arg_55_2;
output_1155 = __wm_tail_arg_55_3;
continue __wm_tail_49;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitTupleParams_1151 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitTupleParams_1151__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleAssignments_1166__wm_d3 = (typeIds_1167, index_1168, output_1169) => {
__wm_tail_50: while (true) {
{
const __wm_scalar_50_0 = typeIds_1167;
const __wm_scalar_50_1 = index_1168;
const __wm_scalar_50_2 = output_1169;
if (__wm_scalar_50_0 === __wm_basis_Nil) {
const index_1170 = __wm_scalar_50_1;
const output_1171 = __wm_scalar_50_2;
return output_1171;
} else if (__wm_scalar_50_0?.ctor === -6 && __wm_scalar_50_0.args.length === 1 && __wm_is_tuple(__wm_scalar_50_0.args[0]) && __wm_scalar_50_0.args[0].length === 2) {
const _typeId_1172 = __wm_scalar_50_0.args[0][0];
const rest_1173 = __wm_scalar_50_0.args[0][1];
const index_1174 = __wm_scalar_50_1;
const output_1175 = __wm_scalar_50_2;
{
const field_1176 = tupleFieldName_919(index_1174);
{
const __wm_tail_arg_56_0 = rest_1173;
const __wm_tail_arg_56_1 = (index_1174 + 1);
const __wm_tail_arg_56_2 = (((((output_1175 + "  value.") + field_1176) + " = ") + field_1176) + ";\n");
typeIds_1167 = __wm_tail_arg_56_0;
index_1168 = __wm_tail_arg_56_1;
output_1169 = __wm_tail_arg_56_2;
continue __wm_tail_50;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitTupleAssignments_1166 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitTupleAssignments_1166__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleDeclaration_1180__wm_d2 = (gpuType_1177, context_1178) => {
const items_1179 = Js.Array.toList(gpuType_1177.items);
return ((((((((((((((("struct " + tupleName_915(gpuType_1177.id)) + " {\n") + emitTupleFields_1138__wm_d4(items_1179, 0, context_1178, "")) + "};\n\n") + tupleName_915(gpuType_1177.id)) + " ") + tupleFactoryName_917(gpuType_1177.id)) + "(") + emitTupleParams_1151__wm_d4(items_1179, 0, context_1178, "")) + ") {\n") + "  ") + tupleName_915(gpuType_1177.id)) + " value;\n") + emitTupleAssignments_1166__wm_d3(items_1179, 0, "")) + "  return value;\n}\n\n");
};
const emitTupleDeclaration_1180 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitTupleDeclaration_1180__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleDeclarations_1181__wm_d3 = (types_1182, context_1183, output_1184) => {
__wm_tail_51: while (true) {
{
const __wm_scalar_51_0 = types_1182;
const __wm_scalar_51_1 = context_1183;
const __wm_scalar_51_2 = output_1184;
if (__wm_scalar_51_0 === __wm_basis_Nil) {
const context_1185 = __wm_scalar_51_1;
const output_1186 = __wm_scalar_51_2;
return output_1186;
} else if (__wm_scalar_51_0?.ctor === -6 && __wm_scalar_51_0.args.length === 1 && __wm_is_tuple(__wm_scalar_51_0.args[0]) && __wm_scalar_51_0.args[0].length === 2) {
const gpuType_1187 = __wm_scalar_51_0.args[0][0];
const rest_1188 = __wm_scalar_51_0.args[0][1];
const context_1189 = __wm_scalar_51_1;
const output_1190 = __wm_scalar_51_2;
{
const exactType_1191 = gpuType_1187;
const exactContext_1192 = context_1189;
const next_1193 = (__wm_eq(exactType_1191.kind, "tuple") ? (output_1190 + emitTupleDeclaration_1180__wm_d2(exactType_1191, exactContext_1192)) : output_1190);
{
const __wm_tail_arg_57_0 = rest_1188;
const __wm_tail_arg_57_1 = exactContext_1192;
const __wm_tail_arg_57_2 = next_1193;
types_1182 = __wm_tail_arg_57_0;
context_1183 = __wm_tail_arg_57_1;
output_1184 = __wm_tail_arg_57_2;
continue __wm_tail_51;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitTupleDeclarations_1181 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitTupleDeclarations_1181__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const zeroArgs_1194__wm_d4 = (items_1196, context_1197, index_1198, output_1199) => {
__wm_tail_52: while (true) {
{
const __wm_scalar_52_0 = items_1196;
const __wm_scalar_52_1 = context_1197;
const __wm_scalar_52_2 = index_1198;
const __wm_scalar_52_3 = output_1199;
if (__wm_scalar_52_0 === __wm_basis_Nil) {
const _context_1200 = __wm_scalar_52_1;
const _index_1201 = __wm_scalar_52_2;
const output_1202 = __wm_scalar_52_3;
return output_1202;
} else if (__wm_scalar_52_0?.ctor === -6 && __wm_scalar_52_0.args.length === 1 && __wm_is_tuple(__wm_scalar_52_0.args[0]) && __wm_scalar_52_0.args[0].length === 2) {
const typeId_1203 = __wm_scalar_52_0.args[0][0];
const rest_1204 = __wm_scalar_52_0.args[0][1];
const context_1205 = __wm_scalar_52_1;
const index_1206 = __wm_scalar_52_2;
const output_1207 = __wm_scalar_52_3;
{
const next_1208 = (numberEqual_146__wm_d2(index_1206, 0) ? zeroValue_1195__wm_d2(typeId_1203, context_1205) : ((output_1207 + ", ") + zeroValue_1195__wm_d2(typeId_1203, context_1205)));
{
const __wm_tail_arg_58_0 = rest_1204;
const __wm_tail_arg_58_1 = context_1205;
const __wm_tail_arg_58_2 = (index_1206 + 1);
const __wm_tail_arg_58_3 = next_1208;
items_1196 = __wm_tail_arg_58_0;
context_1197 = __wm_tail_arg_58_1;
index_1198 = __wm_tail_arg_58_2;
output_1199 = __wm_tail_arg_58_3;
continue __wm_tail_52;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const zeroArgs_1194 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return zeroArgs_1194__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const zeroValue_1195__wm_d2 = (typeId_1209, context_1210) => {
const gpuType_1211 = findType_943__wm_d2(context_1210.types, typeId_1209);
if (__wm_eq(gpuType_1211.kind, "f32")) {
return "float(0)";
} else {
if (__wm_eq(gpuType_1211.kind, "i32")) {
return "int(0)";
} else {
if (__wm_eq(gpuType_1211.kind, "bool")) {
return "false";
} else {
if (__wm_eq(gpuType_1211.kind, "vector")) {
return (vectorName_955__wm_d2(gpuType_1211, context_1210) + "(0)");
} else {
if (__wm_eq(gpuType_1211.kind, "tuple")) {
return (((tupleFactoryName_917(typeId_1209) + "(") + zeroArgs_1194__wm_d4(Js.Array.toList(gpuType_1211.items), context_1210, 0, "")) + ")");
} else {
return __wm_fail("Panic", "nested ADT payloads are outside the wmslang slice");
}
}
}
}
}
};
const zeroValue_1195 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return zeroValue_1195__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitLayoutFields_1212__wm_d3 = (fieldIds_1213, context_1214, output_1215) => {
__wm_tail_53: while (true) {
{
const __wm_scalar_53_0 = fieldIds_1213;
const __wm_scalar_53_1 = context_1214;
const __wm_scalar_53_2 = output_1215;
if (__wm_scalar_53_0 === __wm_basis_Nil) {
const context_1216 = __wm_scalar_53_1;
const output_1217 = __wm_scalar_53_2;
return output_1217;
} else if (__wm_scalar_53_0?.ctor === -6 && __wm_scalar_53_0.args.length === 1 && __wm_is_tuple(__wm_scalar_53_0.args[0]) && __wm_scalar_53_0.args[0].length === 2) {
const fieldId_1218 = __wm_scalar_53_0.args[0][0];
const rest_1219 = __wm_scalar_53_0.args[0][1];
const context_1220 = __wm_scalar_53_1;
const output_1221 = __wm_scalar_53_2;
{
const exactContext_1222 = context_1220;
const field_1223 = findField_983__wm_d2(exactContext_1222.fields, fieldId_1218);
{
const __wm_tail_arg_59_0 = rest_1219;
const __wm_tail_arg_59_1 = exactContext_1222;
const __wm_tail_arg_59_2 = (((((output_1221 + "  ") + typeName_1075__wm_d2(field_1223.typeId, exactContext_1222)) + " ") + payloadFieldName_925(field_1223.id)) + ";\n");
fieldIds_1213 = __wm_tail_arg_59_0;
context_1214 = __wm_tail_arg_59_1;
output_1215 = __wm_tail_arg_59_2;
continue __wm_tail_53;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitLayoutFields_1212 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitLayoutFields_1212__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const fieldsForEmit_1224__wm_d2 = (fieldIds_1225, context_1226) => {
const __wm_scalar_54_0 = fieldIds_1225;
const __wm_scalar_54_1 = context_1226;
if (__wm_scalar_54_0 === __wm_basis_Nil) {
const _context_1227 = __wm_scalar_54_1;
return __wm_basis_Nil;
} else if (__wm_scalar_54_0?.ctor === -6 && __wm_scalar_54_0.args.length === 1 && __wm_is_tuple(__wm_scalar_54_0.args[0]) && __wm_scalar_54_0.args[0].length === 2) {
const fieldId_1228 = __wm_scalar_54_0.args[0][0];
const rest_1229 = __wm_scalar_54_0.args[0][1];
const context_1230 = __wm_scalar_54_1;
const exactContext_1231 = context_1230;
return __wm_basis_Cons([findField_983__wm_d2(exactContext_1231.fields, fieldId_1228), fieldsForEmit_1224__wm_d2(rest_1229, exactContext_1231)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const fieldsForEmit_1224 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return fieldsForEmit_1224__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitConstructorFieldAssignments_1232__wm_d5 = (fields_1233, constructorId_1234, payloadName_1235, context_1236, output_1237) => {
__wm_tail_54: while (true) {
{
const __wm_scalar_55_0 = fields_1233;
const __wm_scalar_55_1 = constructorId_1234;
const __wm_scalar_55_2 = payloadName_1235;
const __wm_scalar_55_3 = context_1236;
const __wm_scalar_55_4 = output_1237;
if (__wm_scalar_55_0 === __wm_basis_Nil) {
const _constructorId_1238 = __wm_scalar_55_1;
const _payloadName_1239 = __wm_scalar_55_2;
const _context_1240 = __wm_scalar_55_3;
const output_1241 = __wm_scalar_55_4;
return output_1241;
} else if (__wm_scalar_55_0?.ctor === -6 && __wm_scalar_55_0.args.length === 1 && __wm_is_tuple(__wm_scalar_55_0.args[0]) && __wm_scalar_55_0.args[0].length === 2) {
const field_1242 = __wm_scalar_55_0.args[0][0];
const rest_1243 = __wm_scalar_55_0.args[0][1];
const constructorId_1244 = __wm_scalar_55_1;
const payloadName_1245 = __wm_scalar_55_2;
const context_1246 = __wm_scalar_55_3;
const output_1247 = __wm_scalar_55_4;
{
const exactField_1248 = field_1242;
const exactContext_1249 = context_1246;
const value_1250 = (numberEqual_146__wm_d2(exactField_1248.constructorId, constructorId_1244) ? payloadName_1245 : zeroValue_1195__wm_d2(exactField_1248.typeId, exactContext_1249));
{
const __wm_tail_arg_60_0 = rest_1243;
const __wm_tail_arg_60_1 = constructorId_1244;
const __wm_tail_arg_60_2 = payloadName_1245;
const __wm_tail_arg_60_3 = exactContext_1249;
const __wm_tail_arg_60_4 = (((((output_1247 + "  value.") + payloadFieldName_925(exactField_1248.id)) + " = ") + value_1250) + ";\n");
fields_1233 = __wm_tail_arg_60_0;
constructorId_1234 = __wm_tail_arg_60_1;
payloadName_1235 = __wm_tail_arg_60_2;
context_1236 = __wm_tail_arg_60_3;
output_1237 = __wm_tail_arg_60_4;
continue __wm_tail_54;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitConstructorFieldAssignments_1232 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return emitConstructorFieldAssignments_1232__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const emitConstructorDeclaration_1256__wm_d3 = (constructor_1251, layout_1252, context_1253) => {
const parameter_1254 = (numberEqual_146__wm_d2(constructor_1251.payloadTypeId, __wm_op_sub(1)) ? "" : (typeName_1075__wm_d2(constructor_1251.payloadTypeId, context_1253) + " payload"));
const payloadName_1255 = (numberEqual_146__wm_d2(constructor_1251.payloadTypeId, __wm_op_sub(1)) ? "float(0)" : "payload");
return (((((((((((((layoutName_921(layout_1252.id) + " ") + constructorName_923(constructor_1251.id)) + "(") + parameter_1254) + ") {\n") + "  ") + layoutName_921(layout_1252.id)) + " value;\n") + "  value.tag = ") + text_909(constructor_1251.tag)) + ";\n") + emitConstructorFieldAssignments_1232__wm_d5(fieldsForEmit_1224__wm_d2(Js.Array.toList(layout_1252.fieldIds), context_1253), constructor_1251.id, payloadName_1255, context_1253, "")) + "  return value;\n}\n\n");
};
const emitConstructorDeclaration_1256 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitConstructorDeclaration_1256__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitLayoutConstructors_1257__wm_d4 = (constructorIds_1258, layout_1259, context_1260, output_1261) => {
__wm_tail_55: while (true) {
{
const __wm_scalar_56_0 = constructorIds_1258;
const __wm_scalar_56_1 = layout_1259;
const __wm_scalar_56_2 = context_1260;
const __wm_scalar_56_3 = output_1261;
if (__wm_scalar_56_0 === __wm_basis_Nil) {
const layout_1262 = __wm_scalar_56_1;
const context_1263 = __wm_scalar_56_2;
const output_1264 = __wm_scalar_56_3;
return output_1264;
} else if (__wm_scalar_56_0?.ctor === -6 && __wm_scalar_56_0.args.length === 1 && __wm_is_tuple(__wm_scalar_56_0.args[0]) && __wm_scalar_56_0.args[0].length === 2) {
const constructorId_1265 = __wm_scalar_56_0.args[0][0];
const rest_1266 = __wm_scalar_56_0.args[0][1];
const layout_1267 = __wm_scalar_56_1;
const context_1268 = __wm_scalar_56_2;
const output_1269 = __wm_scalar_56_3;
{
const exactLayout_1270 = layout_1267;
const exactContext_1271 = context_1268;
const constructor_1272 = findConstructor_991__wm_d2(exactContext_1271.constructors, constructorId_1265);
{
const __wm_tail_arg_61_0 = rest_1266;
const __wm_tail_arg_61_1 = exactLayout_1270;
const __wm_tail_arg_61_2 = exactContext_1271;
const __wm_tail_arg_61_3 = (output_1269 + emitConstructorDeclaration_1256__wm_d3(constructor_1272, exactLayout_1270, exactContext_1271));
constructorIds_1258 = __wm_tail_arg_61_0;
layout_1259 = __wm_tail_arg_61_1;
context_1260 = __wm_tail_arg_61_2;
output_1261 = __wm_tail_arg_61_3;
continue __wm_tail_55;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitLayoutConstructors_1257 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitLayoutConstructors_1257__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitLayoutDeclaration_1276__wm_d2 = (layout_1273, context_1274) => {
const adt_1275 = findAdtForEmit_1055__wm_d2(Js.Array.toList(context_1274.input.adts), layout_1273.typeNameId);
return ((((("struct " + layoutName_921(layout_1273.id)) + " {\n  int tag;\n") + emitLayoutFields_1212__wm_d3(Js.Array.toList(layout_1273.fieldIds), context_1274, "")) + "};\n\n") + emitLayoutConstructors_1257__wm_d4(Js.Array.toList(adt_1275.constructorIds), layout_1273, context_1274, ""));
};
const emitLayoutDeclaration_1276 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitLayoutDeclaration_1276__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitLayoutDeclarations_1277__wm_d3 = (layouts_1278, context_1279, output_1280) => {
__wm_tail_56: while (true) {
{
const __wm_scalar_57_0 = layouts_1278;
const __wm_scalar_57_1 = context_1279;
const __wm_scalar_57_2 = output_1280;
if (__wm_scalar_57_0 === __wm_basis_Nil) {
const context_1281 = __wm_scalar_57_1;
const output_1282 = __wm_scalar_57_2;
return output_1282;
} else if (__wm_scalar_57_0?.ctor === -6 && __wm_scalar_57_0.args.length === 1 && __wm_is_tuple(__wm_scalar_57_0.args[0]) && __wm_scalar_57_0.args[0].length === 2) {
const layout_1283 = __wm_scalar_57_0.args[0][0];
const rest_1284 = __wm_scalar_57_0.args[0][1];
const context_1285 = __wm_scalar_57_1;
const output_1286 = __wm_scalar_57_2;
{
const exactLayout_1287 = layout_1283;
const exactContext_1288 = context_1285;
{
const __wm_tail_arg_62_0 = rest_1284;
const __wm_tail_arg_62_1 = exactContext_1288;
const __wm_tail_arg_62_2 = (output_1286 + emitLayoutDeclaration_1276__wm_d2(exactLayout_1287, exactContext_1288));
layouts_1278 = __wm_tail_arg_62_0;
context_1279 = __wm_tail_arg_62_1;
output_1280 = __wm_tail_arg_62_2;
continue __wm_tail_56;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitLayoutDeclarations_1277 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitLayoutDeclarations_1277__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitAtom_1293__wm_d2 = (atomId_1289, context_1290) => {
const atom_1291 = findAtom_1007__wm_d2(context_1290.atoms, atomId_1289);
const __wm_return_value_10 = atom_1291.kind;
if (__wm_return_value_10 === "local") {

return localName_911(atom_1291.localId);
} else if (__wm_return_value_10 === "number") {

const gpuType_1292 = findType_943__wm_d2(context_1290.types, atom_1291.typeId);
return (((__wm_eq(gpuType_1292.kind, "i32") ? "int(" : "float(") + text_909(atom_1291.numberValue)) + ")");
} else if (__wm_return_value_10 === "bool") {

if (atom_1291.boolValue) {
return "true";
} else {
return "false";
}
} else if (true) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const emitAtom_1293 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitAtom_1293__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitArgs_1294__wm_d3 = (atomIds_1295, context_1296, output_1297) => {
__wm_tail_57: while (true) {
{
const __wm_scalar_58_0 = atomIds_1295;
const __wm_scalar_58_1 = context_1296;
const __wm_scalar_58_2 = output_1297;
if (__wm_scalar_58_0 === __wm_basis_Nil) {
const context_1298 = __wm_scalar_58_1;
const output_1299 = __wm_scalar_58_2;
return output_1299;
} else if (__wm_scalar_58_0?.ctor === -6 && __wm_scalar_58_0.args.length === 1 && __wm_is_tuple(__wm_scalar_58_0.args[0]) && __wm_scalar_58_0.args[0].length === 2) {
const atomId_1300 = __wm_scalar_58_0.args[0][0];
const rest_1301 = __wm_scalar_58_0.args[0][1];
const context_1302 = __wm_scalar_58_1;
const output_1303 = __wm_scalar_58_2;
{
const argument_1304 = emitAtom_1293__wm_d2(atomId_1300, context_1302);
const next_1305 = (__wm_eq(output_1303, "") ? argument_1304 : ((output_1303 + ", ") + argument_1304));
{
const __wm_tail_arg_63_0 = rest_1301;
const __wm_tail_arg_63_1 = context_1302;
const __wm_tail_arg_63_2 = next_1305;
atomIds_1295 = __wm_tail_arg_63_0;
context_1296 = __wm_tail_arg_63_1;
output_1297 = __wm_tail_arg_63_2;
continue __wm_tail_57;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitArgs_1294 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitArgs_1294__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const operatorText_1307 = (__arg) => {
if (true) {
const operatorId_1306 = __arg;
const __wm_return_value_11 = operatorId_1306;
if (__wm_return_value_11 === "gpu.operator.negate") {

return "-";
} else if (__wm_return_value_11 === "gpu.operator.not") {

return "!";
} else if (__wm_return_value_11 === "gpu.operator.add") {

return "+";
} else if (__wm_return_value_11 === "gpu.operator.subtract") {

return "-";
} else if (__wm_return_value_11 === "gpu.operator.multiply") {

return "*";
} else if (__wm_return_value_11 === "gpu.operator.divide") {

return "/";
} else if (__wm_return_value_11 === "gpu.operator.remainder") {

return "%";
} else if (__wm_return_value_11 === "gpu.operator.less-than") {

return "<";
} else if (__wm_return_value_11 === "gpu.operator.less-than-or-equal") {

return "<=";
} else if (__wm_return_value_11 === "gpu.operator.greater-than") {

return ">";
} else if (__wm_return_value_11 === "gpu.operator.greater-than-or-equal") {

return ">=";
} else if (__wm_return_value_11 === "gpu.operator.equal") {

return "==";
} else if (__wm_return_value_11 === "gpu.operator.not-equal") {

return "!=";
} else if (__wm_return_value_11 === "gpu.operator.and") {

return "&&";
} else if (__wm_return_value_11 === "gpu.operator.or") {

return "||";
} else if (true) {

return __wm_fail("Panic", "unsupported Slang-emission operator");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const emitResourceCall_1316__wm_d3 = (operation_1308, args_1309, context_1310) => {
const __wm_return_value_12 = operation_1308.resourceOperation;
if (__wm_return_value_12 === "sample") {

const __wm_return_value_13 = args_1309;
if (__wm_return_value_13?.ctor === -6 && __wm_return_value_13.args.length === 1 && __wm_is_tuple(__wm_return_value_13.args[0]) && __wm_return_value_13.args[0].length === 2 && __wm_return_value_13.args[0][1]?.ctor === -6 && __wm_return_value_13.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_13.args[0][1].args[0]) && __wm_return_value_13.args[0][1].args[0].length === 2 && __wm_return_value_13.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_13.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_13.args[0][1].args[0][1].args[0]) && __wm_return_value_13.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_13.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const texture_1311 = __wm_return_value_13.args[0][0];
const sampler_1312 = __wm_return_value_13.args[0][1].args[0][0];
const coordinate_1313 = __wm_return_value_13.args[0][1].args[0][1].args[0][0];
return (((((emitAtom_1293__wm_d2(texture_1311, context_1310) + ".Sample(") + emitAtom_1293__wm_d2(sampler_1312, context_1310)) + ", ") + emitAtom_1293__wm_d2(coordinate_1313, context_1310)) + ")");
} else if (true) {

return __wm_fail("Panic", "texture Sample reached Slang emission with invalid arity");
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_12 === "load") {

const __wm_return_value_14 = args_1309;
if (__wm_return_value_14?.ctor === -6 && __wm_return_value_14.args.length === 1 && __wm_is_tuple(__wm_return_value_14.args[0]) && __wm_return_value_14.args[0].length === 2 && __wm_return_value_14.args[0][1]?.ctor === -6 && __wm_return_value_14.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_14.args[0][1].args[0]) && __wm_return_value_14.args[0][1].args[0].length === 2 && __wm_return_value_14.args[0][1].args[0][1] === __wm_basis_Nil) {
const texture_1314 = __wm_return_value_14.args[0][0];
const coordinate_1315 = __wm_return_value_14.args[0][1].args[0][0];
return (((emitAtom_1293__wm_d2(texture_1314, context_1310) + ".Load(") + emitAtom_1293__wm_d2(coordinate_1315, context_1310)) + ")");
} else if (true) {

return __wm_fail("Panic", "texture Load reached Slang emission with invalid arity");
}
__wm_fail("Match", "non-exhaustive match");
} else if (true) {

return __wm_fail("Panic", "resource call reached Slang emission without an operation");
}
__wm_fail("Match", "non-exhaustive match");
};
const emitResourceCall_1316 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitResourceCall_1316__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitPayload_1323__wm_d3 = (operation_1317, args_1318, context_1319) => {
const base_1320 = ((emitArgs_1294__wm_d3(args_1318, context_1319, "") + ".") + payloadFieldName_925(operation_1317.fieldId));
if ((operation_1317.index < 0)) {
return base_1320;
} else {
const field_1321 = findField_983__wm_d2(context_1319.fields, operation_1317.fieldId);
const fieldType_1322 = findType_943__wm_d2(context_1319.types, field_1321.typeId);
return (base_1320 + (__wm_eq(fieldType_1322.kind, "vector") ? ("." + vectorLaneName_942(operation_1317.index)) : ("." + tupleFieldName_919(operation_1317.index))));
}
};
const emitPayload_1323 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitPayload_1323__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitProjection_1330__wm_d3 = (operation_1324, args_1325, context_1326) => {
const __wm_return_value_15 = args_1325;
if (__wm_return_value_15?.ctor === -6 && __wm_return_value_15.args.length === 1 && __wm_is_tuple(__wm_return_value_15.args[0]) && __wm_return_value_15.args[0].length === 2 && __wm_return_value_15.args[0][1] === __wm_basis_Nil) {
const atomId_1327 = __wm_return_value_15.args[0][0];
const atom_1328 = findAtom_1007__wm_d2(context_1326.atoms, atomId_1327);
const sourceType_1329 = findType_943__wm_d2(context_1326.types, atom_1328.typeId);
if (__wm_eq(sourceType_1329.kind, "vector")) {
return ((emitAtom_1293__wm_d2(atomId_1327, context_1326) + ".") + vectorLaneName_942(operation_1324.index));
} else {
return ((emitAtom_1293__wm_d2(atomId_1327, context_1326) + ".") + tupleFieldName_919(operation_1324.index));
}
} else if (true) {

return __wm_fail("Panic", "projection reached Slang emission with invalid arity");
}
__wm_fail("Match", "non-exhaustive match");
};
const emitProjection_1330 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitProjection_1330__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitOperatorOperation_1340__wm_d3 = (operation_1331, args_1332, context_1333) => {
const signedMinimum_1336 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2 && __v.args[0][1] === __wm_basis_Nil) {
const atomId_1334 = __v.args[0][0];
const atom_1335 = findAtom_1007__wm_d2(context_1333.atoms, atomId_1334);
return __wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(__wm_eq(operation_1331.operatorId, "gpu.operator.negate"), __wm_eq(atom_1335.kind, "number")), __wm_eq(atom_1335.numberKind, "i32")), numberEqual_146__wm_d2(atom_1335.numberValue, 2147483648));
} else if (true) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
})(args_1332);
if (signedMinimum_1336) {
return "int(-2147483648)";
} else {
const __wm_return_value_16 = args_1332;
if (__wm_return_value_16?.ctor === -6 && __wm_return_value_16.args.length === 1 && __wm_is_tuple(__wm_return_value_16.args[0]) && __wm_return_value_16.args[0].length === 2 && __wm_return_value_16.args[0][1] === __wm_basis_Nil) {
const left_1337 = __wm_return_value_16.args[0][0];
return ((("(" + operatorText_1307(operation_1331.operatorId)) + emitAtom_1293__wm_d2(left_1337, context_1333)) + ")");
} else if (__wm_return_value_16?.ctor === -6 && __wm_return_value_16.args.length === 1 && __wm_is_tuple(__wm_return_value_16.args[0]) && __wm_return_value_16.args[0].length === 2 && __wm_return_value_16.args[0][1]?.ctor === -6 && __wm_return_value_16.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_16.args[0][1].args[0]) && __wm_return_value_16.args[0][1].args[0].length === 2 && __wm_return_value_16.args[0][1].args[0][1] === __wm_basis_Nil) {
const left_1338 = __wm_return_value_16.args[0][0];
const right_1339 = __wm_return_value_16.args[0][1].args[0][0];
return (((((("(" + emitAtom_1293__wm_d2(left_1338, context_1333)) + " ") + operatorText_1307(operation_1331.operatorId)) + " ") + emitAtom_1293__wm_d2(right_1339, context_1333)) + ")");
} else if (true) {

return __wm_fail("Panic", "operator reached Slang emission with invalid arity");
}
__wm_fail("Match", "non-exhaustive match");
}
};
const emitOperatorOperation_1340 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitOperatorOperation_1340__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitOperation_1350__wm_d2 = (operation_1341, context_1342) => {
const args_1343 = Js.Array.toList(operation_1341.args);
const __wm_return_value_17 = operation_1341.kind;
if (__wm_return_value_17 === "uniform") {

const field_1344 = findEnvironmentField_956__wm_d3(context_1342.environmentFields, context_1342.input.root.environmentId, operation_1341.index);
const access_1345 = (context_1342.portable ? (("WM_UNIFORM_" + text_909(field_1344.declaredIndex)) + "()") : ("wm_uniforms." + uniformFieldName_927(field_1344.declaredIndex)));
const gpuType_1346 = findType_943__wm_d2(context_1342.types, field_1344.typeId);
if (__wm_op_and_d2(__wm_eq(gpuType_1346.kind, "bool"), __wm_op_not(context_1342.portable))) {
return (("(" + access_1345) + " != 0)");
} else {
return access_1345;
}
} else if (__wm_return_value_17 === "resource") {

const field_1347 = findEnvironmentField_956__wm_d3(context_1342.environmentFields, context_1342.input.root.environmentId, operation_1341.index);
if (context_1342.portable) {
return (("WM_RESOURCE_" + text_909(field_1347.binding)) + "()");
} else {
return resourceFieldName_929(field_1347.binding);
}
} else if (__wm_return_value_17 === "resource-call") {

return emitResourceCall_1316__wm_d3(operation_1341, args_1343, context_1342);
} else if (__wm_return_value_17 === "copy") {

return emitArgs_1294__wm_d3(args_1343, context_1342, "");
} else if (__wm_return_value_17 === "tuple") {

const resultType_1348 = findType_943__wm_d2(context_1342.types, operation_1341.typeId);
const constructor_1349 = (__wm_eq(resultType_1348.kind, "vector") ? vectorName_955__wm_d2(resultType_1348, context_1342) : tupleFactoryName_917(operation_1341.typeId));
return (((constructor_1349 + "(") + emitArgs_1294__wm_d3(args_1343, context_1342, "")) + ")");
} else if (__wm_return_value_17 === "project") {

return emitProjection_1330__wm_d3(operation_1341, args_1343, context_1342);
} else if (__wm_return_value_17 === "call") {

return (((functionName_913(operation_1341.targetFunctionId) + "(") + emitArgs_1294__wm_d3(args_1343, context_1342, "")) + ")");
} else if (__wm_return_value_17 === "convert") {

return (((typeName_1075__wm_d2(operation_1341.typeId, context_1342) + "(") + emitArgs_1294__wm_d3(args_1343, context_1342, "")) + ")");
} else if (__wm_return_value_17 === "builtin") {

return (((operation_1341.builtinName + "(") + emitArgs_1294__wm_d3(args_1343, context_1342, "")) + ")");
} else if (__wm_return_value_17 === "construct") {

return (((constructorName_923(operation_1341.constructorId) + "(") + emitArgs_1294__wm_d3(args_1343, context_1342, "")) + ")");
} else if (__wm_return_value_17 === "payload") {

return emitPayload_1323__wm_d3(operation_1341, args_1343, context_1342);
} else if (__wm_return_value_17 === "binary") {

return emitOperatorOperation_1340__wm_d3(operation_1341, args_1343, context_1342);
} else if (__wm_return_value_17 === "unary") {

return emitOperatorOperation_1340__wm_d3(operation_1341, args_1343, context_1342);
} else if (true) {

return __wm_fail("Panic", "unsupported Slang-emission operation");
}
__wm_fail("Match", "non-exhaustive match");
};
const emitOperation_1350 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitOperation_1350__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitBlockStatements_1351__wm_d4 = (statementIds_1356, indent_1357, context_1358, output_1359) => {
__wm_tail_58: while (true) {
{
const __wm_scalar_59_0 = statementIds_1356;
const __wm_scalar_59_1 = indent_1357;
const __wm_scalar_59_2 = context_1358;
const __wm_scalar_59_3 = output_1359;
if (__wm_scalar_59_0 === __wm_basis_Nil) {
const indent_1360 = __wm_scalar_59_1;
const context_1361 = __wm_scalar_59_2;
const output_1362 = __wm_scalar_59_3;
return output_1362;
} else if (__wm_scalar_59_0?.ctor === -6 && __wm_scalar_59_0.args.length === 1 && __wm_is_tuple(__wm_scalar_59_0.args[0]) && __wm_scalar_59_0.args[0].length === 2) {
const statementId_1363 = __wm_scalar_59_0.args[0][0];
const rest_1364 = __wm_scalar_59_0.args[0][1];
const indent_1365 = __wm_scalar_59_1;
const context_1366 = __wm_scalar_59_2;
const output_1367 = __wm_scalar_59_3;
{
const statement_1368 = findStatement_1023__wm_d2(context_1366.statements, statementId_1363);
{
const __wm_tail_arg_64_0 = rest_1364;
const __wm_tail_arg_64_1 = indent_1365;
const __wm_tail_arg_64_2 = context_1366;
const __wm_tail_arg_64_3 = (output_1367 + emitStatement_1355__wm_d3(statement_1368, indent_1365, context_1366));
statementIds_1356 = __wm_tail_arg_64_0;
indent_1357 = __wm_tail_arg_64_1;
context_1358 = __wm_tail_arg_64_2;
output_1359 = __wm_tail_arg_64_3;
continue __wm_tail_58;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitBlockStatements_1351 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitBlockStatements_1351__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitBlock_1352__wm_d3 = (blockId_1369, indent_1370, context_1371) => {
const block_1372 = findBlock_1031__wm_d2(context_1371.blocks, blockId_1369);
return emitBlockStatements_1351__wm_d4(Js.Array.toList(block_1372.statementIds), indent_1370, context_1371, "");
};
const emitBlock_1352 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitBlock_1352__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitCases_1353__wm_d4 = (caseIds_1373, indent_1374, context_1375, output_1376) => {
__wm_tail_59: while (true) {
{
const __wm_scalar_60_0 = caseIds_1373;
const __wm_scalar_60_1 = indent_1374;
const __wm_scalar_60_2 = context_1375;
const __wm_scalar_60_3 = output_1376;
if (__wm_scalar_60_0 === __wm_basis_Nil) {
const indent_1377 = __wm_scalar_60_1;
const context_1378 = __wm_scalar_60_2;
const output_1379 = __wm_scalar_60_3;
return output_1379;
} else if (__wm_scalar_60_0?.ctor === -6 && __wm_scalar_60_0.args.length === 1 && __wm_is_tuple(__wm_scalar_60_0.args[0]) && __wm_scalar_60_0.args[0].length === 2) {
const caseId_1380 = __wm_scalar_60_0.args[0][0];
const rest_1381 = __wm_scalar_60_0.args[0][1];
const indent_1382 = __wm_scalar_60_1;
const context_1383 = __wm_scalar_60_2;
const output_1384 = __wm_scalar_60_3;
{
const gpuCase_1385 = findCase_1039__wm_d2(context_1383.cases, caseId_1380);
const item_1386 = ((((((((indent_1382 + "case ") + text_909(gpuCase_1385.tag)) + ": {\n") + emitBlock_1352__wm_d3(gpuCase_1385.blockId, (indent_1382 + "  "), context_1383)) + indent_1382) + "  break;\n") + indent_1382) + "}\n");
{
const __wm_tail_arg_65_0 = rest_1381;
const __wm_tail_arg_65_1 = indent_1382;
const __wm_tail_arg_65_2 = context_1383;
const __wm_tail_arg_65_3 = (output_1384 + item_1386);
caseIds_1373 = __wm_tail_arg_65_0;
indent_1374 = __wm_tail_arg_65_1;
context_1375 = __wm_tail_arg_65_2;
output_1376 = __wm_tail_arg_65_3;
continue __wm_tail_59;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitCases_1353 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitCases_1353__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitParallelAssignments_1354__wm_d5 = (targetIds_1387, valueIds_1388, indent_1389, context_1390, output_1391) => {
__wm_tail_60: while (true) {
{
const __wm_tail_value_66 = [targetIds_1387, valueIds_1388, indent_1389, context_1390, output_1391];
if (__wm_tail_value_66[0] === __wm_basis_Nil && __wm_tail_value_66[1] === __wm_basis_Nil) {
const indent_1392 = __wm_tail_value_66[2];
const context_1393 = __wm_tail_value_66[3];
const output_1394 = __wm_tail_value_66[4];
return output_1394;
} else if (__wm_tail_value_66[0]?.ctor === -6 && __wm_tail_value_66[0].args.length === 1 && __wm_is_tuple(__wm_tail_value_66[0].args[0]) && __wm_tail_value_66[0].args[0].length === 2 && __wm_tail_value_66[1]?.ctor === -6 && __wm_tail_value_66[1].args.length === 1 && __wm_is_tuple(__wm_tail_value_66[1].args[0]) && __wm_tail_value_66[1].args[0].length === 2) {
const targetId_1395 = __wm_tail_value_66[0].args[0][0];
const targetRest_1396 = __wm_tail_value_66[0].args[0][1];
const valueId_1397 = __wm_tail_value_66[1].args[0][0];
const valueRest_1398 = __wm_tail_value_66[1].args[0][1];
const indent_1399 = __wm_tail_value_66[2];
const context_1400 = __wm_tail_value_66[3];
const output_1401 = __wm_tail_value_66[4];
{
const __wm_tail_arg_67_0 = targetRest_1396;
const __wm_tail_arg_67_1 = valueRest_1398;
const __wm_tail_arg_67_2 = indent_1399;
const __wm_tail_arg_67_3 = context_1400;
const __wm_tail_arg_67_4 = (((((output_1401 + indent_1399) + localName_911(targetId_1395)) + " = ") + emitAtom_1293__wm_d2(valueId_1397, context_1400)) + ";\n");
targetIds_1387 = __wm_tail_arg_67_0;
valueIds_1388 = __wm_tail_arg_67_1;
indent_1389 = __wm_tail_arg_67_2;
context_1390 = __wm_tail_arg_67_3;
output_1391 = __wm_tail_arg_67_4;
continue __wm_tail_60;
}
} else if (true) {

return __wm_fail("Panic", "parallel tail update arity changed after validation");
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitParallelAssignments_1354 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return emitParallelAssignments_1354__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const emitStatement_1355__wm_d3 = (statement_1402, indent_1403, context_1404) => {
if (__wm_eq(statement_1402.kind, "let")) {
const local_1405 = findLocal_999__wm_d2(context_1404.locals, statement_1402.localId);
const operation_1406 = findOperation_1015__wm_d2(context_1404.operations, statement_1402.operationId);
return ((((((indent_1403 + typeName_1075__wm_d2(local_1405.typeId, context_1404)) + " ") + localName_911(local_1405.id)) + " = ") + emitOperation_1350__wm_d2(operation_1406, context_1404)) + ";\n");
} else {
if (__wm_eq(statement_1402.kind, "assign")) {
return ((((indent_1403 + localName_911(statement_1402.localId)) + " = ") + emitAtom_1293__wm_d2(statement_1402.atomId, context_1404)) + ";\n");
} else {
if (__wm_eq(statement_1402.kind, "if")) {
const join_1408 = (numberEqual_146__wm_d2(statement_1402.localId, __wm_op_sub(1)) ? "" : (() => {
const local_1407 = findLocal_999__wm_d2(context_1404.locals, statement_1402.localId);
return ((((indent_1403 + typeName_1075__wm_d2(local_1407.typeId, context_1404)) + " ") + localName_911(local_1407.id)) + ";\n");
})());
return ((((((((((join_1408 + indent_1403) + "if (") + emitAtom_1293__wm_d2(statement_1402.conditionAtomId, context_1404)) + ") {\n") + emitBlock_1352__wm_d3(statement_1402.thenBlockId, (indent_1403 + "  "), context_1404)) + indent_1403) + "} else {\n") + emitBlock_1352__wm_d3(statement_1402.elseBlockId, (indent_1403 + "  "), context_1404)) + indent_1403) + "}\n");
} else {
if (__wm_eq(statement_1402.kind, "switch")) {
const join_1410 = (numberEqual_146__wm_d2(statement_1402.localId, __wm_op_sub(1)) ? "" : (() => {
const local_1409 = findLocal_999__wm_d2(context_1404.locals, statement_1402.localId);
return ((((indent_1403 + typeName_1075__wm_d2(local_1409.typeId, context_1404)) + " ") + localName_911(local_1409.id)) + ";\n");
})());
return (((((((join_1410 + indent_1403) + "switch (") + emitAtom_1293__wm_d2(statement_1402.scrutineeAtomId, context_1404)) + ".tag) {\n") + emitCases_1353__wm_d4(Js.Array.toList(statement_1402.caseIds), (indent_1403 + "  "), context_1404, "")) + indent_1403) + "}\n");
} else {
if (__wm_eq(statement_1402.kind, "loop")) {
return ((((((indent_1403 + "while (!") + recursiveDoneName_933(statement_1402.functionId)) + ") {\n") + emitBlock_1352__wm_d3(statement_1402.bodyBlockId, (indent_1403 + "  "), context_1404)) + indent_1403) + "}\n");
} else {
if (__wm_eq(statement_1402.kind, "continue")) {
return ((emitParallelAssignments_1354__wm_d5(Js.Array.toList(statement_1402.targetLocalIds), Js.Array.toList(statement_1402.valueAtomIds), indent_1403, context_1404, "") + indent_1403) + "continue;\n");
} else {
const atom_1411 = findAtom_1007__wm_d2(context_1404.atoms, statement_1402.atomId);
if (__wm_eq(atom_1411.kind, "void")) {
if (numberEqual_146__wm_d2(context_1404.recursiveFunctionId, statement_1402.functionId)) {
return ((indent_1403 + recursiveDoneName_933(statement_1402.functionId)) + " = true;\n");
} else {
return (indent_1403 + "return;\n");
}
} else {
if (numberEqual_146__wm_d2(context_1404.recursiveFunctionId, statement_1402.functionId)) {
return (((((((indent_1403 + recursiveResultName_931(statement_1402.functionId)) + " = ") + emitAtom_1293__wm_d2(statement_1402.atomId, context_1404)) + ";\n") + indent_1403) + recursiveDoneName_933(statement_1402.functionId)) + " = true;\n");
} else {
return (((indent_1403 + "return ") + emitAtom_1293__wm_d2(statement_1402.atomId, context_1404)) + ";\n");
}
}
}
}
}
}
}
}
};
const emitStatement_1355 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitStatement_1355__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitFunctionParams_1412__wm_d3 = (localIds_1413, context_1414, output_1415) => {
__wm_tail_61: while (true) {
{
const __wm_scalar_61_0 = localIds_1413;
const __wm_scalar_61_1 = context_1414;
const __wm_scalar_61_2 = output_1415;
if (__wm_scalar_61_0 === __wm_basis_Nil) {
const context_1416 = __wm_scalar_61_1;
const output_1417 = __wm_scalar_61_2;
return output_1417;
} else if (__wm_scalar_61_0?.ctor === -6 && __wm_scalar_61_0.args.length === 1 && __wm_is_tuple(__wm_scalar_61_0.args[0]) && __wm_scalar_61_0.args[0].length === 2) {
const localId_1418 = __wm_scalar_61_0.args[0][0];
const rest_1419 = __wm_scalar_61_0.args[0][1];
const context_1420 = __wm_scalar_61_1;
const output_1421 = __wm_scalar_61_2;
{
const local_1422 = findLocal_999__wm_d2(context_1420.locals, localId_1418);
const parameter_1423 = ((typeName_1075__wm_d2(local_1422.typeId, context_1420) + " ") + localName_911(local_1422.id));
const next_1424 = (__wm_eq(output_1421, "") ? parameter_1423 : ((output_1421 + ", ") + parameter_1423));
{
const __wm_tail_arg_68_0 = rest_1419;
const __wm_tail_arg_68_1 = context_1420;
const __wm_tail_arg_68_2 = next_1424;
localIds_1413 = __wm_tail_arg_68_0;
context_1414 = __wm_tail_arg_68_1;
output_1415 = __wm_tail_arg_68_2;
continue __wm_tail_61;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitFunctionParams_1412 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitFunctionParams_1412__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitFunction_1434__wm_d2 = (fn_1425, context_1426) => {
const source_1427 = findSourceFunction_1063__wm_d2(Js.Array.toList(context_1426.input.functions), fn_1425.functionId);
const functionContext_1428 = { ...context_1426, recursiveFunctionId: (fn_1425.recursive ? fn_1425.functionId : __wm_op_sub(1)), portable: context_1426.portable };
const resultType_1429 = findType_943__wm_d2(context_1426.types, source_1427.resultTypeId);
const recursivePrefix_1431 = (fn_1425.recursive ? (() => {
const result_1430 = (__wm_eq(resultType_1429.kind, "void") ? "" : (((("  " + typeName_1075__wm_d2(source_1427.resultTypeId, context_1426)) + " ") + recursiveResultName_931(fn_1425.functionId)) + ";\n"));
return (((result_1430 + "  bool ") + recursiveDoneName_933(fn_1425.functionId)) + " = false;\n");
})() : "");
const recursiveSuffix_1432 = (fn_1425.recursive ? (__wm_eq(resultType_1429.kind, "void") ? "  return;\n" : (("  return " + recursiveResultName_931(fn_1425.functionId)) + ";\n")) : "");
const linkage_1433 = (__wm_op_and_d2(context_1426.portable, numberEqual_146__wm_d2(fn_1425.functionId, context_1426.input.root.functionId)) ? "export __extern_cpp " : "");
return ((((((((((linkage_1433 + typeName_1075__wm_d2(source_1427.resultTypeId, context_1426)) + " ") + functionName_913(fn_1425.functionId)) + "(") + emitFunctionParams_1412__wm_d3(Js.Array.toList(fn_1425.physicalParamLocalIds), context_1426, "")) + ") {\n") + recursivePrefix_1431) + emitBlock_1352__wm_d3(fn_1425.bodyBlockId, "  ", functionContext_1428)) + recursiveSuffix_1432) + "}\n\n");
};
const emitFunction_1434 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitFunction_1434__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitFunctions_1435__wm_d3 = (functions_1436, context_1437, output_1438) => {
__wm_tail_62: while (true) {
{
const __wm_scalar_62_0 = functions_1436;
const __wm_scalar_62_1 = context_1437;
const __wm_scalar_62_2 = output_1438;
if (__wm_scalar_62_0 === __wm_basis_Nil) {
const context_1439 = __wm_scalar_62_1;
const output_1440 = __wm_scalar_62_2;
return output_1440;
} else if (__wm_scalar_62_0?.ctor === -6 && __wm_scalar_62_0.args.length === 1 && __wm_is_tuple(__wm_scalar_62_0.args[0]) && __wm_scalar_62_0.args[0].length === 2) {
const fn_1441 = __wm_scalar_62_0.args[0][0];
const rest_1442 = __wm_scalar_62_0.args[0][1];
const context_1443 = __wm_scalar_62_1;
const output_1444 = __wm_scalar_62_2;
{
const __wm_tail_arg_69_0 = rest_1442;
const __wm_tail_arg_69_1 = context_1443;
const __wm_tail_arg_69_2 = (output_1444 + emitFunction_1434__wm_d2(fn_1441, context_1443));
functions_1436 = __wm_tail_arg_69_0;
context_1437 = __wm_tail_arg_69_1;
output_1438 = __wm_tail_arg_69_2;
continue __wm_tail_62;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitFunctions_1435 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitFunctions_1435__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitWrappers_1451 = (__arg) => {
if (true) {
const context_1445 = __arg;
const input_1446 = context_1445.input;
const rootRow_1447 = input_1446.root;
const root_1448 = findFunction_1047__wm_d2(context_1445.functions, rootRow_1447.functionId);
const __wm_return_value_18 = Js.Array.toList(root_1448.physicalParamLocalIds);
if (__wm_return_value_18?.ctor === -6 && __wm_return_value_18.args.length === 1 && __wm_is_tuple(__wm_return_value_18.args[0]) && __wm_return_value_18.args[0].length === 2 && __wm_return_value_18.args[0][1] === __wm_basis_Nil) {
const coordLocalId_1449 = __wm_return_value_18.args[0][0];
const coordLocal_1450 = findLocal_999__wm_d2(context_1445.locals, coordLocalId_1449);
return (((((((((((("[shader(\"vertex\")]\n" + "float4 wm_vertex(uint vertexID : SV_VertexID) : SV_Position {\n") + "  float2 uv = float2((vertexID << 1) & 2, vertexID & 2);\n") + "  return float4(uv * 2.0 - 1.0, 0.0, 1.0);\n") + "}\n\n") + "[shader(\"fragment\")]\n") + "float4 wm_fragment(float4 position : SV_Position) : SV_Target {\n") + "  return ") + functionName_913(root_1448.functionId)) + "(") + typeName_1075__wm_d2(coordLocal_1450.typeId, context_1445)) + "(position.x, position.y));\n") + "}\n");
} else if (true) {

return __wm_fail("Panic", "v1 fragment root does not have one physical coordinate parameter");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const emitSliceSlangModule_1463__wm_d10 = (input_1452, layouts_1453, fields_1454, functions_1455, locals_1456, atoms_1457, operations_1458, statements_1459, blocks_1460, cases_1461) => {
const context_1462 = { input: input_1452, environmentFields: Js.Array.toList(input_1452.environmentFields), types: Js.Array.toList(input_1452.types), constructors: Js.Array.toList(input_1452.constructors), layouts: Js.Array.toList(layouts_1453), fields: Js.Array.toList(fields_1454), functions: Js.Array.toList(functions_1455), locals: Js.Array.toList(locals_1456), atoms: Js.Array.toList(atoms_1457), operations: Js.Array.toList(operations_1458), statements: Js.Array.toList(statements_1459), blocks: Js.Array.toList(blocks_1460), cases: Js.Array.toList(cases_1461), recursiveFunctionId: __wm_op_sub(1), portable: true };
return ((((("// Generated by wmslang visual v2.\n\n" + emitPortableEnvironmentAccessors_1112__wm_d3(context_1462.environmentFields, context_1462, "")) + emitTupleDeclarations_1181__wm_d3(context_1462.types, context_1462, "")) + emitLayoutDeclarations_1277__wm_d3(context_1462.layouts, context_1462, "")) + emitEnvironmentDeclaration_1111(context_1462)) + emitFunctions_1435__wm_d3(context_1462.functions, context_1462, ""));
};
const emitSliceSlangModule_1463 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return emitSliceSlangModule_1463__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
const emitSliceCallableName_1465 = (__arg) => {
if (true) {
const input_1464 = __arg;
return functionName_913(input_1464.root.functionId);
}
__wm_fail("Match", "pattern match failure in function");
};
const emitSliceSlang_1477__wm_d10 = (input_1466, layouts_1467, fields_1468, functions_1469, locals_1470, atoms_1471, operations_1472, statements_1473, blocks_1474, cases_1475) => {
const context_1476 = { input: input_1466, environmentFields: Js.Array.toList(input_1466.environmentFields), types: Js.Array.toList(input_1466.types), constructors: Js.Array.toList(input_1466.constructors), layouts: Js.Array.toList(layouts_1467), fields: Js.Array.toList(fields_1468), functions: Js.Array.toList(functions_1469), locals: Js.Array.toList(locals_1470), atoms: Js.Array.toList(atoms_1471), operations: Js.Array.toList(operations_1472), statements: Js.Array.toList(statements_1473), blocks: Js.Array.toList(blocks_1474), cases: Js.Array.toList(cases_1475), recursiveFunctionId: __wm_op_sub(1), portable: false };
return ((((("// Generated by wmslang visual v2.\n\n" + emitTupleDeclarations_1181__wm_d3(context_1476.types, context_1476, "")) + emitLayoutDeclarations_1277__wm_d3(context_1476.layouts, context_1476, "")) + emitEnvironmentDeclaration_1111(context_1476)) + emitFunctions_1435__wm_d3(context_1476.functions, context_1476, "")) + emitWrappers_1451(context_1476));
};
const emitSliceSlang_1477 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return emitSliceSlang_1477__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
return { "SliceEmitContext": SliceEmitContext_907, "text": text_909, "localName": localName_911, "functionName": functionName_913, "tupleName": tupleName_915, "tupleFactoryName": tupleFactoryName_917, "tupleFieldName": tupleFieldName_919, "layoutName": layoutName_921, "constructorName": constructorName_923, "payloadFieldName": payloadFieldName_925, "uniformFieldName": uniformFieldName_927, "resourceFieldName": resourceFieldName_929, "recursiveResultName": recursiveResultName_931, "recursiveDoneName": recursiveDoneName_933, "listLength": listLength_934, "listLength__wm_d2": listLength_934__wm_d2, "vectorLaneName": vectorLaneName_942, "findType": findType_943, "findType__wm_d2": findType_943__wm_d2, "vectorName": vectorName_955, "vectorName__wm_d2": vectorName_955__wm_d2, "findEnvironmentField": findEnvironmentField_956, "findEnvironmentField__wm_d3": findEnvironmentField_956__wm_d3, "findLayout": findLayout_967, "findLayout__wm_d2": findLayout_967__wm_d2, "findLayoutByType": findLayoutByType_975, "findLayoutByType__wm_d2": findLayoutByType_975__wm_d2, "findField": findField_983, "findField__wm_d2": findField_983__wm_d2, "findConstructor": findConstructor_991, "findConstructor__wm_d2": findConstructor_991__wm_d2, "findLocal": findLocal_999, "findLocal__wm_d2": findLocal_999__wm_d2, "findAtom": findAtom_1007, "findAtom__wm_d2": findAtom_1007__wm_d2, "findOperation": findOperation_1015, "findOperation__wm_d2": findOperation_1015__wm_d2, "findStatement": findStatement_1023, "findStatement__wm_d2": findStatement_1023__wm_d2, "findBlock": findBlock_1031, "findBlock__wm_d2": findBlock_1031__wm_d2, "findCase": findCase_1039, "findCase__wm_d2": findCase_1039__wm_d2, "findFunction": findFunction_1047, "findFunction__wm_d2": findFunction_1047__wm_d2, "findAdtForEmit": findAdtForEmit_1055, "findAdtForEmit__wm_d2": findAdtForEmit_1055__wm_d2, "findSourceFunction": findSourceFunction_1063, "findSourceFunction__wm_d2": findSourceFunction_1063__wm_d2, "typeName": typeName_1075, "typeName__wm_d2": typeName_1075__wm_d2, "emitEnvironmentFields": emitEnvironmentFields_1076, "emitEnvironmentFields__wm_d3": emitEnvironmentFields_1076__wm_d3, "hasUniformField": hasUniformField_1090, "emitResourceDeclarations": emitResourceDeclarations_1095, "emitResourceDeclarations__wm_d3": emitResourceDeclarations_1095__wm_d3, "emitEnvironmentDeclaration": emitEnvironmentDeclaration_1111, "emitPortableEnvironmentAccessors": emitPortableEnvironmentAccessors_1112, "emitPortableEnvironmentAccessors__wm_d3": emitPortableEnvironmentAccessors_1112__wm_d3, "joinText": joinText_1127, "joinText__wm_d3": joinText_1127__wm_d3, "emitTupleFields": emitTupleFields_1138, "emitTupleFields__wm_d4": emitTupleFields_1138__wm_d4, "emitTupleParams": emitTupleParams_1151, "emitTupleParams__wm_d4": emitTupleParams_1151__wm_d4, "emitTupleAssignments": emitTupleAssignments_1166, "emitTupleAssignments__wm_d3": emitTupleAssignments_1166__wm_d3, "emitTupleDeclaration": emitTupleDeclaration_1180, "emitTupleDeclaration__wm_d2": emitTupleDeclaration_1180__wm_d2, "emitTupleDeclarations": emitTupleDeclarations_1181, "emitTupleDeclarations__wm_d3": emitTupleDeclarations_1181__wm_d3, "zeroArgs": zeroArgs_1194, "zeroArgs__wm_d4": zeroArgs_1194__wm_d4, "zeroValue": zeroValue_1195, "zeroValue__wm_d2": zeroValue_1195__wm_d2, "emitLayoutFields": emitLayoutFields_1212, "emitLayoutFields__wm_d3": emitLayoutFields_1212__wm_d3, "fieldsForEmit": fieldsForEmit_1224, "fieldsForEmit__wm_d2": fieldsForEmit_1224__wm_d2, "emitConstructorFieldAssignments": emitConstructorFieldAssignments_1232, "emitConstructorFieldAssignments__wm_d5": emitConstructorFieldAssignments_1232__wm_d5, "emitConstructorDeclaration": emitConstructorDeclaration_1256, "emitConstructorDeclaration__wm_d3": emitConstructorDeclaration_1256__wm_d3, "emitLayoutConstructors": emitLayoutConstructors_1257, "emitLayoutConstructors__wm_d4": emitLayoutConstructors_1257__wm_d4, "emitLayoutDeclaration": emitLayoutDeclaration_1276, "emitLayoutDeclaration__wm_d2": emitLayoutDeclaration_1276__wm_d2, "emitLayoutDeclarations": emitLayoutDeclarations_1277, "emitLayoutDeclarations__wm_d3": emitLayoutDeclarations_1277__wm_d3, "emitAtom": emitAtom_1293, "emitAtom__wm_d2": emitAtom_1293__wm_d2, "emitArgs": emitArgs_1294, "emitArgs__wm_d3": emitArgs_1294__wm_d3, "operatorText": operatorText_1307, "emitResourceCall": emitResourceCall_1316, "emitResourceCall__wm_d3": emitResourceCall_1316__wm_d3, "emitPayload": emitPayload_1323, "emitPayload__wm_d3": emitPayload_1323__wm_d3, "emitProjection": emitProjection_1330, "emitProjection__wm_d3": emitProjection_1330__wm_d3, "emitOperatorOperation": emitOperatorOperation_1340, "emitOperatorOperation__wm_d3": emitOperatorOperation_1340__wm_d3, "emitOperation": emitOperation_1350, "emitOperation__wm_d2": emitOperation_1350__wm_d2, "emitBlockStatements": emitBlockStatements_1351, "emitBlockStatements__wm_d4": emitBlockStatements_1351__wm_d4, "emitBlock": emitBlock_1352, "emitBlock__wm_d3": emitBlock_1352__wm_d3, "emitCases": emitCases_1353, "emitCases__wm_d4": emitCases_1353__wm_d4, "emitParallelAssignments": emitParallelAssignments_1354, "emitParallelAssignments__wm_d5": emitParallelAssignments_1354__wm_d5, "emitStatement": emitStatement_1355, "emitStatement__wm_d3": emitStatement_1355__wm_d3, "emitFunctionParams": emitFunctionParams_1412, "emitFunctionParams__wm_d3": emitFunctionParams_1412__wm_d3, "emitFunction": emitFunction_1434, "emitFunction__wm_d2": emitFunction_1434__wm_d2, "emitFunctions": emitFunctions_1435, "emitFunctions__wm_d3": emitFunctions_1435__wm_d3, "emitWrappers": emitWrappers_1451, "emitSliceSlangModule": emitSliceSlangModule_1463, "emitSliceSlangModule__wm_d10": emitSliceSlangModule_1463__wm_d10, "emitSliceCallableName": emitSliceCallableName_1465, "emitSliceSlang": emitSliceSlang_1477, "emitSliceSlang__wm_d10": emitSliceSlang_1477__wm_d10 };
  },
  (value) => { __wm_module_4 = value; },
);
let __wm_module_5;
__wm_define_module(
  "__wm_module_5",
  ["__wm_module_0"],
  async () => {
const GpuSliceBlockDto_31 = __wm_module_0["GpuSliceBlockDto"];
const GpuSliceElaborationInputDto_46 = __wm_module_0["GpuSliceElaborationInputDto"];
const GpuSliceEnvironmentFieldDto_42 = __wm_module_0["GpuSliceEnvironmentFieldDto"];
const GpuSliceExprDto_33 = __wm_module_0["GpuSliceExprDto"];
const GpuSliceFunctionDto_37 = __wm_module_0["GpuSliceFunctionDto"];
const GpuSliceLetDto_28 = __wm_module_0["GpuSliceLetDto"];
const GpuSliceParamDto_27 = __wm_module_0["GpuSliceParamDto"];
const GpuSlicePatternDto_26 = __wm_module_0["GpuSlicePatternDto"];
const GpuSliceRootDto_41 = __wm_module_0["GpuSliceRootDto"];
const GpuSliceTypeDto_21 = __wm_module_0["GpuSliceTypeDto"];
const NumericContext_1478 = (__record_args) => ({ expressionOffset: __record_args[0], fieldOffset: __record_args[1], types: __record_args[2], expressions: __record_args[3], patterns: __record_args[4], params: __record_args[5], lets: __record_args[6], blocks: __record_args[7], functions: __record_args[8], environmentFields: __record_args[9], exprNodes: __record_args[10], patternNodes: __record_args[11], patternByBinding: __record_args[12], lanes: __record_args[13] });
const NumericEvidence_1479 = (__record_args) => ({ representation: __record_args[0], spanId: __record_args[1] });
const numberEqual_1482__wm_d2 = (left_1480, right_1481) => {
return __wm_op_and_d2(__wm_op_not((left_1480 < right_1481)), __wm_op_not((left_1480 > right_1481)));
};
const numberEqual_1482 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numberEqual_1482__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const listLength_1483__wm_d2 = (items_1484, length_1485) => {
__wm_tail_63: while (true) {
{
const __wm_scalar_63_0 = items_1484;
const __wm_scalar_63_1 = length_1485;
if (__wm_scalar_63_0 === __wm_basis_Nil) {
const length_1486 = __wm_scalar_63_1;
return length_1486;
} else if (__wm_scalar_63_0?.ctor === -6 && __wm_scalar_63_0.args.length === 1 && __wm_is_tuple(__wm_scalar_63_0.args[0]) && __wm_scalar_63_0.args[0].length === 2) {
const rest_1487 = __wm_scalar_63_0.args[0][1];
const length_1488 = __wm_scalar_63_1;
{
const __wm_tail_arg_70_0 = rest_1487;
const __wm_tail_arg_70_1 = (length_1488 + 1);
items_1484 = __wm_tail_arg_70_0;
length_1485 = __wm_tail_arg_70_1;
continue __wm_tail_63;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const listLength_1483 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return listLength_1483__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findType_1489__wm_d2 = (items_1490, id_1491) => {
__wm_tail_64: while (true) {
{
const __wm_scalar_64_0 = items_1490;
const __wm_scalar_64_1 = id_1491;
if (__wm_scalar_64_0 === __wm_basis_Nil) {
const id_1492 = __wm_scalar_64_1;
return __wm_fail("Panic", "missing numeric semantic type");
} else if (__wm_scalar_64_0?.ctor === -6 && __wm_scalar_64_0.args.length === 1 && __wm_is_tuple(__wm_scalar_64_0.args[0]) && __wm_scalar_64_0.args[0].length === 2) {
const item_1493 = __wm_scalar_64_0.args[0][0];
const rest_1494 = __wm_scalar_64_0.args[0][1];
const id_1495 = __wm_scalar_64_1;
{
const exact_1496 = item_1493;
if (numberEqual_1482__wm_d2(exact_1496.id, id_1495)) {
return exact_1496;
} else {
{
const __wm_tail_arg_71_0 = rest_1494;
const __wm_tail_arg_71_1 = id_1495;
items_1490 = __wm_tail_arg_71_0;
id_1491 = __wm_tail_arg_71_1;
continue __wm_tail_64;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findType_1489 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findType_1489__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const allNumberTypes_1497__wm_d2 = (typeIds_1498, types_1499) => {
const __wm_scalar_65_0 = typeIds_1498;
const __wm_scalar_65_1 = types_1499;
if (__wm_scalar_65_0 === __wm_basis_Nil) {
const types_1500 = __wm_scalar_65_1;
return true;
} else if (__wm_scalar_65_0?.ctor === -6 && __wm_scalar_65_0.args.length === 1 && __wm_is_tuple(__wm_scalar_65_0.args[0]) && __wm_scalar_65_0.args[0].length === 2) {
const typeId_1501 = __wm_scalar_65_0.args[0][0];
const rest_1502 = __wm_scalar_65_0.args[0][1];
const types_1503 = __wm_scalar_65_1;
const gpuType_1504 = findType_1489__wm_d2(types_1503, typeId_1501);
return __wm_op_and_d2(__wm_eq(gpuType_1504.kind, "number"), allNumberTypes_1497__wm_d2(rest_1502, types_1503));
}
__wm_fail("Match", "non-exhaustive match");
};
const allNumberTypes_1497 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return allNumberTypes_1497__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const numericType_1510__wm_d2 = (typeId_1505, context_1506) => {
const gpuType_1507 = findType_1489__wm_d2(context_1506.types, typeId_1505);
if (__wm_eq(gpuType_1507.kind, "number")) {
return true;
} else {
if (__wm_eq(gpuType_1507.kind, "tuple")) {
const items_1508 = Js.Array.toList(gpuType_1507.items);
const width_1509 = listLength_1483__wm_d2(items_1508, 0);
return __wm_op_and_d2(__wm_op_and_d2((width_1509 >= 2), (width_1509 <= 4)), allNumberTypes_1497__wm_d2(items_1508, context_1506.types));
} else {
return false;
}
}
};
const numericType_1510 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numericType_1510__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const computeExpressionNode_1513__wm_d2 = (expression_1511, context_1512) => {
if (numericType_1510__wm_d2(expression_1511.typeId, context_1512)) {
return expression_1511.id;
} else {
return __wm_op_sub(1);
}
};
const computeExpressionNode_1513 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return computeExpressionNode_1513__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const expressionNode_1517__wm_d2 = (expression_1514, context_1515) => {
const __wm_return_value_19 = Map.get([context_1515.exprNodes, expression_1514.id]);
if (__wm_return_value_19?.ctor === -2 && __wm_return_value_19.args.length === 1) {
const node_1516 = __wm_return_value_19.args[0];
return node_1516;
} else if (__wm_return_value_19 === __wm_basis_None) {

return computeExpressionNode_1513__wm_d2(expression_1514, context_1515);
}
__wm_fail("Match", "non-exhaustive match");
};
const expressionNode_1517 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return expressionNode_1517__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const computePatternNode_1520__wm_d2 = (pattern_1518, context_1519) => {
if (numericType_1510__wm_d2(pattern_1518.typeId, context_1519)) {
return (context_1519.expressionOffset + pattern_1518.id);
} else {
return __wm_op_sub(1);
}
};
const computePatternNode_1520 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return computePatternNode_1520__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const patternNode_1524__wm_d2 = (pattern_1521, context_1522) => {
const __wm_return_value_20 = Map.get([context_1522.patternNodes, pattern_1521.id]);
if (__wm_return_value_20?.ctor === -2 && __wm_return_value_20.args.length === 1) {
const node_1523 = __wm_return_value_20.args[0];
return node_1523;
} else if (__wm_return_value_20 === __wm_basis_None) {

return computePatternNode_1520__wm_d2(pattern_1521, context_1522);
}
__wm_fail("Match", "non-exhaustive match");
};
const patternNode_1524 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return patternNode_1524__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const boundPatternNode_1529__wm_d3 = (context_1525, bindingId_1526, ownerFunctionId_1527) => {
const __wm_return_value_21 = Map.get([context_1525.patternByBinding, ((bindingId_1526 * 1000000) + ownerFunctionId_1527)]);
if (__wm_return_value_21?.ctor === -2 && __wm_return_value_21.args.length === 1) {
const node_1528 = __wm_return_value_21.args[0];
return node_1528;
} else if (__wm_return_value_21 === __wm_basis_None) {

return __wm_op_sub(1);
}
__wm_fail("Match", "non-exhaustive match");
};
const boundPatternNode_1529 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return boundPatternNode_1529__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lookupLanes_1533__wm_d2 = (context_1530, expressionId_1531) => {
const __wm_return_value_22 = Map.get([context_1530.lanes, expressionId_1531]);
if (__wm_return_value_22?.ctor === -2 && __wm_return_value_22.args.length === 1) {
const lanes_1532 = __wm_return_value_22.args[0];
return lanes_1532;
} else if (__wm_return_value_22 === __wm_basis_None) {

return __wm_basis_Nil;
}
__wm_fail("Match", "non-exhaustive match");
};
const lookupLanes_1533 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return lookupLanes_1533__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const fieldNode_1536__wm_d2 = (field_1534, context_1535) => {
if (numericType_1510__wm_d2(field_1534.typeId, context_1535)) {
return (context_1535.fieldOffset + field_1534.id);
} else {
return __wm_op_sub(1);
}
};
const fieldNode_1536 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return fieldNode_1536__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const evidence_1539__wm_d2 = (representations_1537, node_1538) => {
if ((node_1538 < 0)) {
return __wm_basis_None;
} else {
return Map.get([representations_1537, node_1538]);
}
};
const evidence_1539 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return evidence_1539__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const representation_1543__wm_d2 = (representations_1540, node_1541) => {
const __wm_return_value_23 = evidence_1539__wm_d2(representations_1540, node_1541);
if (__wm_return_value_23?.ctor === -2 && __wm_return_value_23.args.length === 1) {
const value_1542 = __wm_return_value_23.args[0];
return value_1542.representation;
} else if (__wm_return_value_23 === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const representation_1543 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return representation_1543__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const numericConflict_1546__wm_d2 = (left_1544, right_1545) => {
return __wm_fail("Panic", ((((((("WM_GPU_NUMERIC_CONFLICT|" + Text.of(left_1544.spanId)) + "|") + Text.of(right_1545.spanId)) + "|") + left_1544.representation) + "|") + right_1545.representation));
};
const numericConflict_1546 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numericConflict_1546__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const setEvidence_1551__wm_d3 = (representations_1547, node_1548, value_1549) => {
if (__wm_op_or_d2((node_1548 < 0), __wm_eq(value_1549.representation, ""))) {
return [representations_1547, false];
} else {
const __wm_return_value_24 = evidence_1539__wm_d2(representations_1547, node_1548);
if (__wm_return_value_24 === __wm_basis_None) {

return [Map.set([representations_1547, node_1548, value_1549]), true];
} else if (__wm_return_value_24?.ctor === -2 && __wm_return_value_24.args.length === 1) {
const previous_1550 = __wm_return_value_24.args[0];
if (__wm_eq(previous_1550.representation, value_1549.representation)) {
return [representations_1547, false];
} else {
return numericConflict_1546__wm_d2(previous_1550, value_1549);
}
}
__wm_fail("Match", "non-exhaustive match");
}
};
const setEvidence_1551 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return setEvidence_1551__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setRepresentation_1557__wm_d4 = (representations_1552, node_1553, value_1554, spanId_1555) => {
const item_1556 = { representation: value_1554, spanId: spanId_1555 };
return setEvidence_1551__wm_d3(representations_1552, node_1553, item_1556);
};
const setRepresentation_1557 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setRepresentation_1557__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const combinedEvidence_1558__wm_d3 = (nodes_1559, representations_1560, combined_1561) => {
__wm_tail_65: while (true) {
{
const __wm_scalar_66_0 = nodes_1559;
const __wm_scalar_66_1 = representations_1560;
const __wm_scalar_66_2 = combined_1561;
if (__wm_scalar_66_0 === __wm_basis_Nil) {
const representations_1562 = __wm_scalar_66_1;
const combined_1563 = __wm_scalar_66_2;
return combined_1563;
} else if (__wm_scalar_66_0?.ctor === -6 && __wm_scalar_66_0.args.length === 1 && __wm_is_tuple(__wm_scalar_66_0.args[0]) && __wm_scalar_66_0.args[0].length === 2) {
const node_1564 = __wm_scalar_66_0.args[0][0];
const rest_1565 = __wm_scalar_66_0.args[0][1];
const representations_1566 = __wm_scalar_66_1;
const combined_1567 = __wm_scalar_66_2;
{
const __wm_tail_value_72 = evidence_1539__wm_d2(representations_1566, node_1564);
if (__wm_tail_value_72 === __wm_basis_None) {

{
const __wm_tail_arg_73_0 = rest_1565;
const __wm_tail_arg_73_1 = representations_1566;
const __wm_tail_arg_73_2 = combined_1567;
nodes_1559 = __wm_tail_arg_73_0;
representations_1560 = __wm_tail_arg_73_1;
combined_1561 = __wm_tail_arg_73_2;
continue __wm_tail_65;
}
} else if (__wm_tail_value_72?.ctor === -2 && __wm_tail_value_72.args.length === 1) {
const value_1568 = __wm_tail_value_72.args[0];
{
const __wm_tail_value_74 = combined_1567;
if (__wm_tail_value_74 === __wm_basis_None) {

{
const __wm_tail_arg_75_0 = rest_1565;
const __wm_tail_arg_75_1 = representations_1566;
const __wm_tail_arg_75_2 = __wm_basis_Some(value_1568);
nodes_1559 = __wm_tail_arg_75_0;
representations_1560 = __wm_tail_arg_75_1;
combined_1561 = __wm_tail_arg_75_2;
continue __wm_tail_65;
}
} else if (__wm_tail_value_74?.ctor === -2 && __wm_tail_value_74.args.length === 1) {
const previous_1569 = __wm_tail_value_74.args[0];
if (__wm_eq(previous_1569.representation, value_1568.representation)) {
{
const __wm_tail_arg_76_0 = rest_1565;
const __wm_tail_arg_76_1 = representations_1566;
const __wm_tail_arg_76_2 = combined_1567;
nodes_1559 = __wm_tail_arg_76_0;
representations_1560 = __wm_tail_arg_76_1;
combined_1561 = __wm_tail_arg_76_2;
continue __wm_tail_65;
}
} else {
return numericConflict_1546__wm_d2(previous_1569, value_1568);
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const combinedEvidence_1558 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return combinedEvidence_1558__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setGroup_1570__wm_d4 = (nodes_1571, value_1572, representations_1573, changed_1574) => {
__wm_tail_66: while (true) {
{
const __wm_scalar_67_0 = nodes_1571;
const __wm_scalar_67_1 = value_1572;
const __wm_scalar_67_2 = representations_1573;
const __wm_scalar_67_3 = changed_1574;
if (__wm_scalar_67_0 === __wm_basis_Nil) {
const value_1575 = __wm_scalar_67_1;
const representations_1576 = __wm_scalar_67_2;
const changed_1577 = __wm_scalar_67_3;
return [representations_1576, changed_1577];
} else if (__wm_scalar_67_0?.ctor === -6 && __wm_scalar_67_0.args.length === 1 && __wm_is_tuple(__wm_scalar_67_0.args[0]) && __wm_scalar_67_0.args[0].length === 2) {
const node_1578 = __wm_scalar_67_0.args[0][0];
const rest_1579 = __wm_scalar_67_0.args[0][1];
const value_1580 = __wm_scalar_67_1;
const representations_1581 = __wm_scalar_67_2;
const changed_1582 = __wm_scalar_67_3;
{
const __wm_bind_55 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const item_1583 = __v.args[0];
return setEvidence_1551__wm_d3(representations_1581, node_1578, item_1583);
} else if (__v === __wm_basis_None) {

return [representations_1581, false];
}
__wm_fail("Match", "non-exhaustive match");
})(value_1580);
if (!(__wm_is_tuple(__wm_bind_55) && __wm_bind_55.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1584 = __wm_bind_55[0];
const itemChanged_1585 = __wm_bind_55[1];
{
const __wm_tail_arg_77_0 = rest_1579;
const __wm_tail_arg_77_1 = value_1580;
const __wm_tail_arg_77_2 = next_1584;
const __wm_tail_arg_77_3 = __wm_op_or_d2(changed_1582, itemChanged_1585);
nodes_1571 = __wm_tail_arg_77_0;
value_1572 = __wm_tail_arg_77_1;
representations_1573 = __wm_tail_arg_77_2;
changed_1574 = __wm_tail_arg_77_3;
continue __wm_tail_66;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const setGroup_1570 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setGroup_1570__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeGroup_1589__wm_d2 = (nodes_1586, representations_1587) => {
const value_1588 = combinedEvidence_1558__wm_d3(nodes_1586, representations_1587, __wm_basis_None);
return setGroup_1570__wm_d4(nodes_1586, value_1588, representations_1587, false);
};
const mergeGroup_1589 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return mergeGroup_1589__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findPatternByBinding_1590__wm_d3 = (patterns_1591, bindingId_1592, ownerFunctionId_1593) => {
__wm_tail_67: while (true) {
{
const __wm_scalar_68_0 = patterns_1591;
const __wm_scalar_68_1 = bindingId_1592;
const __wm_scalar_68_2 = ownerFunctionId_1593;
if (__wm_scalar_68_0 === __wm_basis_Nil) {
const bindingId_1594 = __wm_scalar_68_1;
const ownerFunctionId_1595 = __wm_scalar_68_2;
return __wm_basis_None;
} else if (__wm_scalar_68_0?.ctor === -6 && __wm_scalar_68_0.args.length === 1 && __wm_is_tuple(__wm_scalar_68_0.args[0]) && __wm_scalar_68_0.args[0].length === 2) {
const pattern_1596 = __wm_scalar_68_0.args[0][0];
const rest_1597 = __wm_scalar_68_0.args[0][1];
const bindingId_1598 = __wm_scalar_68_1;
const ownerFunctionId_1599 = __wm_scalar_68_2;
{
const exact_1600 = pattern_1596;
if (__wm_op_and_d2(numberEqual_1482__wm_d2(exact_1600.bindingId, bindingId_1598), numberEqual_1482__wm_d2(exact_1600.ownerFunctionId, ownerFunctionId_1599))) {
return __wm_basis_Some(exact_1600);
} else {
{
const __wm_tail_arg_78_0 = rest_1597;
const __wm_tail_arg_78_1 = bindingId_1598;
const __wm_tail_arg_78_2 = ownerFunctionId_1599;
patterns_1591 = __wm_tail_arg_78_0;
bindingId_1592 = __wm_tail_arg_78_1;
ownerFunctionId_1593 = __wm_tail_arg_78_2;
continue __wm_tail_67;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findPatternByBinding_1590 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findPatternByBinding_1590__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const findParam_1601__wm_d2 = (params_1602, id_1603) => {
__wm_tail_68: while (true) {
{
const __wm_scalar_69_0 = params_1602;
const __wm_scalar_69_1 = id_1603;
if (__wm_scalar_69_0 === __wm_basis_Nil) {
const id_1604 = __wm_scalar_69_1;
return __wm_fail("Panic", "missing numeric function parameter");
} else if (__wm_scalar_69_0?.ctor === -6 && __wm_scalar_69_0.args.length === 1 && __wm_is_tuple(__wm_scalar_69_0.args[0]) && __wm_scalar_69_0.args[0].length === 2) {
const param_1605 = __wm_scalar_69_0.args[0][0];
const rest_1606 = __wm_scalar_69_0.args[0][1];
const id_1607 = __wm_scalar_69_1;
{
const exact_1608 = param_1605;
if (numberEqual_1482__wm_d2(exact_1608.id, id_1607)) {
return exact_1608;
} else {
{
const __wm_tail_arg_79_0 = rest_1606;
const __wm_tail_arg_79_1 = id_1607;
params_1602 = __wm_tail_arg_79_0;
id_1603 = __wm_tail_arg_79_1;
continue __wm_tail_68;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findParam_1601 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findParam_1601__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findPattern_1609__wm_d2 = (patterns_1610, id_1611) => {
__wm_tail_69: while (true) {
{
const __wm_scalar_70_0 = patterns_1610;
const __wm_scalar_70_1 = id_1611;
if (__wm_scalar_70_0 === __wm_basis_Nil) {
const id_1612 = __wm_scalar_70_1;
return __wm_fail("Panic", "missing numeric pattern");
} else if (__wm_scalar_70_0?.ctor === -6 && __wm_scalar_70_0.args.length === 1 && __wm_is_tuple(__wm_scalar_70_0.args[0]) && __wm_scalar_70_0.args[0].length === 2) {
const pattern_1613 = __wm_scalar_70_0.args[0][0];
const rest_1614 = __wm_scalar_70_0.args[0][1];
const id_1615 = __wm_scalar_70_1;
{
const exact_1616 = pattern_1613;
if (numberEqual_1482__wm_d2(exact_1616.id, id_1615)) {
return exact_1616;
} else {
{
const __wm_tail_arg_80_0 = rest_1614;
const __wm_tail_arg_80_1 = id_1615;
patterns_1610 = __wm_tail_arg_80_0;
id_1611 = __wm_tail_arg_80_1;
continue __wm_tail_69;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findPattern_1609 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findPattern_1609__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findFunction_1617__wm_d2 = (functions_1618, id_1619) => {
__wm_tail_70: while (true) {
{
const __wm_scalar_71_0 = functions_1618;
const __wm_scalar_71_1 = id_1619;
if (__wm_scalar_71_0 === __wm_basis_Nil) {
const id_1620 = __wm_scalar_71_1;
return __wm_fail("Panic", "missing numeric function");
} else if (__wm_scalar_71_0?.ctor === -6 && __wm_scalar_71_0.args.length === 1 && __wm_is_tuple(__wm_scalar_71_0.args[0]) && __wm_scalar_71_0.args[0].length === 2) {
const fn_1621 = __wm_scalar_71_0.args[0][0];
const rest_1622 = __wm_scalar_71_0.args[0][1];
const id_1623 = __wm_scalar_71_1;
{
const exact_1624 = fn_1621;
if (numberEqual_1482__wm_d2(exact_1624.id, id_1623)) {
return exact_1624;
} else {
{
const __wm_tail_arg_81_0 = rest_1622;
const __wm_tail_arg_81_1 = id_1623;
functions_1618 = __wm_tail_arg_81_0;
id_1619 = __wm_tail_arg_81_1;
continue __wm_tail_70;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findFunction_1617 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findFunction_1617__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findExpression_1625__wm_d2 = (expressions_1626, id_1627) => {
__wm_tail_71: while (true) {
{
const __wm_scalar_72_0 = expressions_1626;
const __wm_scalar_72_1 = id_1627;
if (__wm_scalar_72_0 === __wm_basis_Nil) {
const id_1628 = __wm_scalar_72_1;
return __wm_fail("Panic", "missing numeric expression");
} else if (__wm_scalar_72_0?.ctor === -6 && __wm_scalar_72_0.args.length === 1 && __wm_is_tuple(__wm_scalar_72_0.args[0]) && __wm_scalar_72_0.args[0].length === 2) {
const expression_1629 = __wm_scalar_72_0.args[0][0];
const rest_1630 = __wm_scalar_72_0.args[0][1];
const id_1631 = __wm_scalar_72_1;
{
const exact_1632 = expression_1629;
if (numberEqual_1482__wm_d2(exact_1632.id, id_1631)) {
return exact_1632;
} else {
{
const __wm_tail_arg_82_0 = rest_1630;
const __wm_tail_arg_82_1 = id_1631;
expressions_1626 = __wm_tail_arg_82_0;
id_1627 = __wm_tail_arg_82_1;
continue __wm_tail_71;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findExpression_1625 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findExpression_1625__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findBlock_1633__wm_d2 = (blocks_1634, expressionId_1635) => {
__wm_tail_72: while (true) {
{
const __wm_scalar_73_0 = blocks_1634;
const __wm_scalar_73_1 = expressionId_1635;
if (__wm_scalar_73_0 === __wm_basis_Nil) {
const expressionId_1636 = __wm_scalar_73_1;
return __wm_fail("Panic", "missing numeric block");
} else if (__wm_scalar_73_0?.ctor === -6 && __wm_scalar_73_0.args.length === 1 && __wm_is_tuple(__wm_scalar_73_0.args[0]) && __wm_scalar_73_0.args[0].length === 2) {
const block_1637 = __wm_scalar_73_0.args[0][0];
const rest_1638 = __wm_scalar_73_0.args[0][1];
const expressionId_1639 = __wm_scalar_73_1;
{
const exact_1640 = block_1637;
if (numberEqual_1482__wm_d2(exact_1640.expressionId, expressionId_1639)) {
return exact_1640;
} else {
{
const __wm_tail_arg_83_0 = rest_1638;
const __wm_tail_arg_83_1 = expressionId_1639;
blocks_1634 = __wm_tail_arg_83_0;
expressionId_1635 = __wm_tail_arg_83_1;
continue __wm_tail_72;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findBlock_1633 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findBlock_1633__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findEnvironmentField_1641__wm_d2 = (fields_1642, declaredIndex_1643) => {
__wm_tail_73: while (true) {
{
const __wm_scalar_74_0 = fields_1642;
const __wm_scalar_74_1 = declaredIndex_1643;
if (__wm_scalar_74_0 === __wm_basis_Nil) {
const declaredIndex_1644 = __wm_scalar_74_1;
return __wm_fail("Panic", "missing numeric environment field");
} else if (__wm_scalar_74_0?.ctor === -6 && __wm_scalar_74_0.args.length === 1 && __wm_is_tuple(__wm_scalar_74_0.args[0]) && __wm_scalar_74_0.args[0].length === 2) {
const field_1645 = __wm_scalar_74_0.args[0][0];
const rest_1646 = __wm_scalar_74_0.args[0][1];
const declaredIndex_1647 = __wm_scalar_74_1;
{
const exact_1648 = field_1645;
if (numberEqual_1482__wm_d2(exact_1648.declaredIndex, declaredIndex_1647)) {
return exact_1648;
} else {
{
const __wm_tail_arg_84_0 = rest_1646;
const __wm_tail_arg_84_1 = declaredIndex_1647;
fields_1642 = __wm_tail_arg_84_0;
declaredIndex_1643 = __wm_tail_arg_84_1;
continue __wm_tail_73;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findEnvironmentField_1641 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findEnvironmentField_1641__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const laneContains_1649__wm_d2 = (ids_1650, id_1651) => {
__wm_tail_74: while (true) {
{
const __wm_scalar_75_0 = ids_1650;
const __wm_scalar_75_1 = id_1651;
if (__wm_scalar_75_0 === __wm_basis_Nil) {
const _id_1652 = __wm_scalar_75_1;
return false;
} else if (__wm_scalar_75_0?.ctor === -6 && __wm_scalar_75_0.args.length === 1 && __wm_is_tuple(__wm_scalar_75_0.args[0]) && __wm_scalar_75_0.args[0].length === 2) {
const head_1653 = __wm_scalar_75_0.args[0][0];
const rest_1654 = __wm_scalar_75_0.args[0][1];
const id_1655 = __wm_scalar_75_1;
if (numberEqual_1482__wm_d2(head_1653, id_1655)) {
return true;
} else {
{
const __wm_tail_arg_85_0 = rest_1654;
const __wm_tail_arg_85_1 = id_1655;
ids_1650 = __wm_tail_arg_85_0;
id_1651 = __wm_tail_arg_85_1;
continue __wm_tail_74;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const laneContains_1649 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return laneContains_1649__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const childLaneNodes_1656__wm_d2 = (ids_1657, exprNodes_1658) => {
const __wm_scalar_76_0 = ids_1657;
const __wm_scalar_76_1 = exprNodes_1658;
if (__wm_scalar_76_0 === __wm_basis_Nil) {
const _exprNodes_1659 = __wm_scalar_76_1;
return __wm_basis_Nil;
} else if (__wm_scalar_76_0?.ctor === -6 && __wm_scalar_76_0.args.length === 1 && __wm_is_tuple(__wm_scalar_76_0.args[0]) && __wm_scalar_76_0.args[0].length === 2) {
const id_1660 = __wm_scalar_76_0.args[0][0];
const rest_1661 = __wm_scalar_76_0.args[0][1];
const exprNodes_1662 = __wm_scalar_76_1;
const node_1664 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const n_1663 = __v.args[0];
return n_1663;
} else if (__v === __wm_basis_None) {

return __wm_op_sub(1);
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([exprNodes_1662, id_1660]));
return __wm_basis_Cons([node_1664, childLaneNodes_1656__wm_d2(rest_1661, exprNodes_1662)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const childLaneNodes_1656 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return childLaneNodes_1656__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const lookupMemoLanes_1668__wm_d2 = (memo_1665, expressionId_1666) => {
const __wm_return_value_25 = Map.get([memo_1665, expressionId_1666]);
if (__wm_return_value_25?.ctor === -2 && __wm_return_value_25.args.length === 1) {
const lanes_1667 = __wm_return_value_25.args[0];
return lanes_1667;
} else if (__wm_return_value_25 === __wm_basis_None) {

return __wm_basis_Nil;
}
__wm_fail("Match", "non-exhaustive match");
};
const lookupMemoLanes_1668 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return lookupMemoLanes_1668__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const patternLaneNodes_1669__wm_d2 = (ids_1670, context_1671) => {
const __wm_scalar_77_0 = ids_1670;
const __wm_scalar_77_1 = context_1671;
if (__wm_scalar_77_0 === __wm_basis_Nil) {
const _context_1672 = __wm_scalar_77_1;
return __wm_basis_Nil;
} else if (__wm_scalar_77_0?.ctor === -6 && __wm_scalar_77_0.args.length === 1 && __wm_is_tuple(__wm_scalar_77_0.args[0]) && __wm_scalar_77_0.args[0].length === 2) {
const id_1673 = __wm_scalar_77_0.args[0][0];
const rest_1674 = __wm_scalar_77_0.args[0][1];
const context_1675 = __wm_scalar_77_1;
const exactContext_1676 = context_1675;
const child_1677 = findPattern_1609__wm_d2(exactContext_1676.patterns, id_1673);
return __wm_basis_Cons([patternNode_1524__wm_d2(child_1677, exactContext_1676), patternLaneNodes_1669__wm_d2(rest_1674, exactContext_1676)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const patternLaneNodes_1669 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return patternLaneNodes_1669__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeLanePairs_1678__wm_d4 = (left_1679, right_1680, representations_1681, changed_1682) => {
__wm_tail_75: while (true) {
{
const __wm_scalar_78_0 = left_1679;
const __wm_scalar_78_1 = right_1680;
const __wm_scalar_78_2 = representations_1681;
const __wm_scalar_78_3 = changed_1682;
if (__wm_scalar_78_0 === __wm_basis_Nil && __wm_scalar_78_1 === __wm_basis_Nil) {
const representations_1683 = __wm_scalar_78_2;
const changed_1684 = __wm_scalar_78_3;
return [representations_1683, changed_1684];
} else if (__wm_scalar_78_0?.ctor === -6 && __wm_scalar_78_0.args.length === 1 && __wm_is_tuple(__wm_scalar_78_0.args[0]) && __wm_scalar_78_0.args[0].length === 2 && __wm_scalar_78_1?.ctor === -6 && __wm_scalar_78_1.args.length === 1 && __wm_is_tuple(__wm_scalar_78_1.args[0]) && __wm_scalar_78_1.args[0].length === 2) {
const a_1685 = __wm_scalar_78_0.args[0][0];
const restA_1686 = __wm_scalar_78_0.args[0][1];
const b_1687 = __wm_scalar_78_1.args[0][0];
const restB_1688 = __wm_scalar_78_1.args[0][1];
const representations_1689 = __wm_scalar_78_2;
const changed_1690 = __wm_scalar_78_3;
{
const __wm_bind_56 = mergeGroup_1589__wm_d2(__wm_basis_Cons([a_1685, __wm_basis_Cons([b_1687, __wm_basis_Nil])]), representations_1689);
if (!(__wm_is_tuple(__wm_bind_56) && __wm_bind_56.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1691 = __wm_bind_56[0];
const pairChanged_1692 = __wm_bind_56[1];
{
const __wm_tail_arg_86_0 = restA_1686;
const __wm_tail_arg_86_1 = restB_1688;
const __wm_tail_arg_86_2 = next_1691;
const __wm_tail_arg_86_3 = __wm_op_or_d2(changed_1690, pairChanged_1692);
left_1679 = __wm_tail_arg_86_0;
right_1680 = __wm_tail_arg_86_1;
representations_1681 = __wm_tail_arg_86_2;
changed_1682 = __wm_tail_arg_86_3;
continue __wm_tail_75;
}
}
} else if (true) {
const representations_1693 = __wm_scalar_78_2;
const changed_1694 = __wm_scalar_78_3;
return [representations_1693, changed_1694];
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const mergeLanePairs_1678 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return mergeLanePairs_1678__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const findLetForPattern_1695__wm_d2 = (lets_1696, patternId_1697) => {
__wm_tail_76: while (true) {
{
const __wm_scalar_79_0 = lets_1696;
const __wm_scalar_79_1 = patternId_1697;
if (__wm_scalar_79_0 === __wm_basis_Nil) {
const _patternId_1698 = __wm_scalar_79_1;
return __wm_basis_None;
} else if (__wm_scalar_79_0?.ctor === -6 && __wm_scalar_79_0.args.length === 1 && __wm_is_tuple(__wm_scalar_79_0.args[0]) && __wm_scalar_79_0.args[0].length === 2) {
const binding_1699 = __wm_scalar_79_0.args[0][0];
const rest_1700 = __wm_scalar_79_0.args[0][1];
const patternId_1701 = __wm_scalar_79_1;
{
const exact_1702 = binding_1699;
if (numberEqual_1482__wm_d2(exact_1702.patternId, patternId_1701)) {
return __wm_basis_Some(exact_1702);
} else {
{
const __wm_tail_arg_87_0 = rest_1700;
const __wm_tail_arg_87_1 = patternId_1701;
lets_1696 = __wm_tail_arg_87_0;
patternId_1697 = __wm_tail_arg_87_1;
continue __wm_tail_76;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLetForPattern_1695 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLetForPattern_1695__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const laneForMemo_1703__wm_d6 = (expressionId_1705, context_1706, exprNodes_1707, memo_1708, visited_1709, depth_1710) => {
const __wm_return_value_26 = Map.get([memo_1708, expressionId_1705]);
if (__wm_return_value_26?.ctor === -2 && __wm_return_value_26.args.length === 1) {
const _lanes_1711 = __wm_return_value_26.args[0];
return memo_1708;
} else if (__wm_return_value_26 === __wm_basis_None) {

if (numberEqual_1482__wm_d2(depth_1710, 0)) {
return Map.set([memo_1708, expressionId_1705, __wm_basis_Nil]);
} else {
if (laneContains_1649__wm_d2(visited_1709, expressionId_1705)) {
return Map.set([memo_1708, expressionId_1705, __wm_basis_Nil]);
} else {
return laneForUncached_1704__wm_d6(expressionId_1705, context_1706, exprNodes_1707, memo_1708, __wm_basis_Cons([expressionId_1705, visited_1709]), (depth_1710 - 1));
}
}
}
__wm_fail("Match", "non-exhaustive match");
};
const laneForMemo_1703 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return laneForMemo_1703__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const laneForUncached_1704__wm_d6 = (expressionId_1712, context_1713, exprNodes_1714, memo_1715, visited_1716, depth_1717) => {
const expression_1718 = findExpression_1625__wm_d2(context_1713.expressions, expressionId_1712);
if (__wm_eq(expression_1718.kind, "tuple")) {
return Map.set([memo_1715, expressionId_1712, childLaneNodes_1656__wm_d2(Js.Array.toList(expression_1718.children), exprNodes_1714)]);
} else {
if (__wm_eq(expression_1718.kind, "if")) {
const __wm_return_value_27 = Js.Array.toList(expression_1718.children);
if (__wm_return_value_27?.ctor === -6 && __wm_return_value_27.args.length === 1 && __wm_is_tuple(__wm_return_value_27.args[0]) && __wm_return_value_27.args[0].length === 2 && __wm_return_value_27.args[0][1]?.ctor === -6 && __wm_return_value_27.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_27.args[0][1].args[0]) && __wm_return_value_27.args[0][1].args[0].length === 2 && __wm_return_value_27.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_27.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_27.args[0][1].args[0][1].args[0]) && __wm_return_value_27.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_27.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const _cond_1719 = __wm_return_value_27.args[0][0];
const thenId_1720 = __wm_return_value_27.args[0][1].args[0][0];
const elseId_1721 = __wm_return_value_27.args[0][1].args[0][1].args[0][0];
const afterThen_1722 = laneForMemo_1703__wm_d6(thenId_1720, context_1713, exprNodes_1714, memo_1715, visited_1716, depth_1717);
const afterElse_1723 = laneForMemo_1703__wm_d6(elseId_1721, context_1713, exprNodes_1714, afterThen_1722, visited_1716, depth_1717);
return Map.set([afterElse_1723, expressionId_1712, lookupMemoLanes_1668__wm_d2(afterElse_1723, thenId_1720)]);
} else if (true) {

return Map.set([memo_1715, expressionId_1712, __wm_basis_Nil]);
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_eq(expression_1718.kind, "block")) {
const block_1724 = findBlock_1633__wm_d2(context_1713.blocks, expression_1718.id);
const afterResult_1725 = laneForMemo_1703__wm_d6(block_1724.resultExprId, context_1713, exprNodes_1714, memo_1715, visited_1716, depth_1717);
return Map.set([afterResult_1725, expressionId_1712, lookupMemoLanes_1668__wm_d2(afterResult_1725, block_1724.resultExprId)]);
} else {
if (__wm_eq(expression_1718.kind, "call")) {
const target_1726 = findFunction_1617__wm_d2(context_1713.functions, expression_1718.functionId);
const body_1727 = findExpression_1625__wm_d2(context_1713.expressions, target_1726.bodyExprId);
const afterBody_1728 = laneForMemo_1703__wm_d6(body_1727.id, context_1713, exprNodes_1714, memo_1715, visited_1716, depth_1717);
return Map.set([afterBody_1728, expressionId_1712, lookupMemoLanes_1668__wm_d2(afterBody_1728, body_1727.id)]);
} else {
if (__wm_eq(expression_1718.kind, "var")) {
const __wm_return_value_28 = findPatternByBinding_1590__wm_d3(context_1713.patterns, expression_1718.bindingId, expression_1718.ownerFunctionId);
if (__wm_return_value_28?.ctor === -2 && __wm_return_value_28.args.length === 1) {
const pattern_1729 = __wm_return_value_28.args[0];
const __wm_return_value_29 = findLetForPattern_1695__wm_d2(context_1713.lets, pattern_1729.id);
if (__wm_return_value_29?.ctor === -2 && __wm_return_value_29.args.length === 1) {
const binding_1730 = __wm_return_value_29.args[0];
const afterValue_1731 = laneForMemo_1703__wm_d6(binding_1730.valueExprId, context_1713, exprNodes_1714, memo_1715, visited_1716, depth_1717);
return Map.set([afterValue_1731, expressionId_1712, lookupMemoLanes_1668__wm_d2(afterValue_1731, binding_1730.valueExprId)]);
} else if (__wm_return_value_29 === __wm_basis_None) {

return Map.set([memo_1715, expressionId_1712, __wm_basis_Nil]);
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_28 === __wm_basis_None) {

return Map.set([memo_1715, expressionId_1712, __wm_basis_Nil]);
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_eq(expression_1718.kind, "copy")) {
const __wm_return_value_30 = Js.Array.toList(expression_1718.children);
if (__wm_return_value_30?.ctor === -6 && __wm_return_value_30.args.length === 1 && __wm_is_tuple(__wm_return_value_30.args[0]) && __wm_return_value_30.args[0].length === 2 && __wm_return_value_30.args[0][1] === __wm_basis_Nil) {
const childId_1732 = __wm_return_value_30.args[0][0];
const afterChild_1733 = laneForMemo_1703__wm_d6(childId_1732, context_1713, exprNodes_1714, memo_1715, visited_1716, depth_1717);
return Map.set([afterChild_1733, expressionId_1712, lookupMemoLanes_1668__wm_d2(afterChild_1733, childId_1732)]);
} else if (true) {

return Map.set([memo_1715, expressionId_1712, __wm_basis_Nil]);
}
__wm_fail("Match", "non-exhaustive match");
} else {
return Map.set([memo_1715, expressionId_1712, __wm_basis_Nil]);
}
}
}
}
}
}
};
const laneForUncached_1704 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return laneForUncached_1704__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const foldExprNodes_1734__wm_d3 = (items_1735, context_1736, nodes_1737) => {
__wm_tail_77: while (true) {
{
const __wm_scalar_80_0 = items_1735;
const __wm_scalar_80_1 = context_1736;
const __wm_scalar_80_2 = nodes_1737;
if (__wm_scalar_80_0 === __wm_basis_Nil) {
const _context_1738 = __wm_scalar_80_1;
const nodes_1739 = __wm_scalar_80_2;
return nodes_1739;
} else if (__wm_scalar_80_0?.ctor === -6 && __wm_scalar_80_0.args.length === 1 && __wm_is_tuple(__wm_scalar_80_0.args[0]) && __wm_scalar_80_0.args[0].length === 2) {
const expression_1740 = __wm_scalar_80_0.args[0][0];
const rest_1741 = __wm_scalar_80_0.args[0][1];
const context_1742 = __wm_scalar_80_1;
const nodes_1743 = __wm_scalar_80_2;
{
const exactExpression_1744 = expression_1740;
const exactContext_1745 = context_1742;
{
const __wm_tail_arg_88_0 = rest_1741;
const __wm_tail_arg_88_1 = exactContext_1745;
const __wm_tail_arg_88_2 = Map.set([nodes_1743, exactExpression_1744.id, computeExpressionNode_1513__wm_d2(exactExpression_1744, exactContext_1745)]);
items_1735 = __wm_tail_arg_88_0;
context_1736 = __wm_tail_arg_88_1;
nodes_1737 = __wm_tail_arg_88_2;
continue __wm_tail_77;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const foldExprNodes_1734 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldExprNodes_1734__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const foldPatternNodes_1746__wm_d3 = (items_1747, context_1748, nodes_1749) => {
__wm_tail_78: while (true) {
{
const __wm_scalar_81_0 = items_1747;
const __wm_scalar_81_1 = context_1748;
const __wm_scalar_81_2 = nodes_1749;
if (__wm_scalar_81_0 === __wm_basis_Nil) {
const _context_1750 = __wm_scalar_81_1;
const nodes_1751 = __wm_scalar_81_2;
return nodes_1751;
} else if (__wm_scalar_81_0?.ctor === -6 && __wm_scalar_81_0.args.length === 1 && __wm_is_tuple(__wm_scalar_81_0.args[0]) && __wm_scalar_81_0.args[0].length === 2) {
const pattern_1752 = __wm_scalar_81_0.args[0][0];
const rest_1753 = __wm_scalar_81_0.args[0][1];
const context_1754 = __wm_scalar_81_1;
const nodes_1755 = __wm_scalar_81_2;
{
const exactPattern_1756 = pattern_1752;
const exactContext_1757 = context_1754;
{
const __wm_tail_arg_89_0 = rest_1753;
const __wm_tail_arg_89_1 = exactContext_1757;
const __wm_tail_arg_89_2 = Map.set([nodes_1755, exactPattern_1756.id, computePatternNode_1520__wm_d2(exactPattern_1756, exactContext_1757)]);
items_1747 = __wm_tail_arg_89_0;
context_1748 = __wm_tail_arg_89_1;
nodes_1749 = __wm_tail_arg_89_2;
continue __wm_tail_78;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const foldPatternNodes_1746 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldPatternNodes_1746__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const foldPatternBindings_1758__wm_d3 = (items_1759, context_1760, bound_1761) => {
__wm_tail_79: while (true) {
{
const __wm_scalar_82_0 = items_1759;
const __wm_scalar_82_1 = context_1760;
const __wm_scalar_82_2 = bound_1761;
if (__wm_scalar_82_0 === __wm_basis_Nil) {
const _context_1762 = __wm_scalar_82_1;
const bound_1763 = __wm_scalar_82_2;
return bound_1763;
} else if (__wm_scalar_82_0?.ctor === -6 && __wm_scalar_82_0.args.length === 1 && __wm_is_tuple(__wm_scalar_82_0.args[0]) && __wm_scalar_82_0.args[0].length === 2) {
const pattern_1764 = __wm_scalar_82_0.args[0][0];
const rest_1765 = __wm_scalar_82_0.args[0][1];
const context_1766 = __wm_scalar_82_1;
const bound_1767 = __wm_scalar_82_2;
{
const exactPattern_1768 = pattern_1764;
const exactContext_1769 = context_1766;
if ((exactPattern_1768.bindingId < 0)) {
{
const __wm_tail_arg_90_0 = rest_1765;
const __wm_tail_arg_90_1 = exactContext_1769;
const __wm_tail_arg_90_2 = bound_1767;
items_1759 = __wm_tail_arg_90_0;
context_1760 = __wm_tail_arg_90_1;
bound_1761 = __wm_tail_arg_90_2;
continue __wm_tail_79;
}
} else {
{
const key_1770 = ((exactPattern_1768.bindingId * 1000000) + exactPattern_1768.ownerFunctionId);
{
const __wm_tail_value_91 = Map.get([bound_1767, key_1770]);
if (__wm_tail_value_91?.ctor === -2 && __wm_tail_value_91.args.length === 1) {
const _node_1771 = __wm_tail_value_91.args[0];
{
const __wm_tail_arg_92_0 = rest_1765;
const __wm_tail_arg_92_1 = exactContext_1769;
const __wm_tail_arg_92_2 = bound_1767;
items_1759 = __wm_tail_arg_92_0;
context_1760 = __wm_tail_arg_92_1;
bound_1761 = __wm_tail_arg_92_2;
continue __wm_tail_79;
}
} else if (__wm_tail_value_91 === __wm_basis_None) {

{
const __wm_tail_arg_93_0 = rest_1765;
const __wm_tail_arg_93_1 = exactContext_1769;
const __wm_tail_arg_93_2 = Map.set([bound_1767, key_1770, computePatternNode_1520__wm_d2(exactPattern_1768, exactContext_1769)]);
items_1759 = __wm_tail_arg_93_0;
context_1760 = __wm_tail_arg_93_1;
bound_1761 = __wm_tail_arg_93_2;
continue __wm_tail_79;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const foldPatternBindings_1758 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldPatternBindings_1758__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const buildAllLanes_1772__wm_d4 = (items_1773, context_1774, exprNodes_1775, memo_1776) => {
__wm_tail_80: while (true) {
{
const __wm_scalar_83_0 = items_1773;
const __wm_scalar_83_1 = context_1774;
const __wm_scalar_83_2 = exprNodes_1775;
const __wm_scalar_83_3 = memo_1776;
if (__wm_scalar_83_0 === __wm_basis_Nil) {
const _context_1777 = __wm_scalar_83_1;
const _exprNodes_1778 = __wm_scalar_83_2;
const memo_1779 = __wm_scalar_83_3;
return memo_1779;
} else if (__wm_scalar_83_0?.ctor === -6 && __wm_scalar_83_0.args.length === 1 && __wm_is_tuple(__wm_scalar_83_0.args[0]) && __wm_scalar_83_0.args[0].length === 2) {
const expression_1780 = __wm_scalar_83_0.args[0][0];
const rest_1781 = __wm_scalar_83_0.args[0][1];
const context_1782 = __wm_scalar_83_1;
const exprNodes_1783 = __wm_scalar_83_2;
const memo_1784 = __wm_scalar_83_3;
{
const exactExpression_1785 = expression_1780;
const exactContext_1786 = context_1782;
{
const __wm_tail_arg_94_0 = rest_1781;
const __wm_tail_arg_94_1 = exactContext_1786;
const __wm_tail_arg_94_2 = exprNodes_1783;
const __wm_tail_arg_94_3 = laneForMemo_1703__wm_d6(exactExpression_1785.id, exactContext_1786, exprNodes_1783, memo_1784, __wm_basis_Nil, 256);
items_1773 = __wm_tail_arg_94_0;
context_1774 = __wm_tail_arg_94_1;
exprNodes_1775 = __wm_tail_arg_94_2;
memo_1776 = __wm_tail_arg_94_3;
continue __wm_tail_80;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildAllLanes_1772 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return buildAllLanes_1772__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const buildNumericCaches_1792 = (__arg) => {
if (true) {
const context_1787 = __arg;
const exprNodes_1788 = foldExprNodes_1734__wm_d3(context_1787.expressions, context_1787, Map.empty(Map.numberCompare));
const patternNodes_1789 = foldPatternNodes_1746__wm_d3(context_1787.patterns, context_1787, Map.empty(Map.numberCompare));
const patternByBinding_1790 = foldPatternBindings_1758__wm_d3(context_1787.patterns, context_1787, Map.empty(Map.numberCompare));
const lanes_1791 = buildAllLanes_1772__wm_d4(context_1787.expressions, context_1787, exprNodes_1788, Map.empty(Map.numberCompare));
return { ...context_1787, exprNodes: exprNodes_1788, patternNodes: patternNodes_1789, patternByBinding: patternByBinding_1790, lanes: lanes_1791 };
}
__wm_fail("Match", "pattern match failure in function");
};
const numericChildNodes_1793__wm_d3 = (children_1794, context_1795, nodes_1796) => {
__wm_tail_81: while (true) {
{
const __wm_scalar_84_0 = children_1794;
const __wm_scalar_84_1 = context_1795;
const __wm_scalar_84_2 = nodes_1796;
if (__wm_scalar_84_0 === __wm_basis_Nil) {
const context_1797 = __wm_scalar_84_1;
const nodes_1798 = __wm_scalar_84_2;
return nodes_1798;
} else if (__wm_scalar_84_0?.ctor === -6 && __wm_scalar_84_0.args.length === 1 && __wm_is_tuple(__wm_scalar_84_0.args[0]) && __wm_scalar_84_0.args[0].length === 2) {
const childId_1799 = __wm_scalar_84_0.args[0][0];
const rest_1800 = __wm_scalar_84_0.args[0][1];
const context_1801 = __wm_scalar_84_1;
const nodes_1802 = __wm_scalar_84_2;
{
const exactContext_1803 = context_1801;
const child_1804 = findExpression_1625__wm_d2(exactContext_1803.expressions, childId_1799);
const node_1805 = expressionNode_1517__wm_d2(child_1804, exactContext_1803);
{
const __wm_tail_arg_95_0 = rest_1800;
const __wm_tail_arg_95_1 = exactContext_1803;
const __wm_tail_arg_95_2 = ((node_1805 < 0) ? nodes_1802 : __wm_basis_Cons([node_1805, nodes_1802]));
children_1794 = __wm_tail_arg_95_0;
context_1795 = __wm_tail_arg_95_1;
nodes_1796 = __wm_tail_arg_95_2;
continue __wm_tail_81;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const numericChildNodes_1793 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return numericChildNodes_1793__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const ownAndChildren_1810__wm_d2 = (expression_1806, context_1807) => {
const own_1808 = expressionNode_1517__wm_d2(expression_1806, context_1807);
const children_1809 = numericChildNodes_1793__wm_d3(Js.Array.toList(expression_1806.children), context_1807, __wm_basis_Nil);
if ((own_1808 < 0)) {
return children_1809;
} else {
return __wm_basis_Cons([own_1808, children_1809]);
}
};
const ownAndChildren_1810 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return ownAndChildren_1810__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeArguments_1811__wm_d5 = (argumentIds_1812, paramIds_1813, context_1814, representations_1815, changed_1816) => {
__wm_tail_82: while (true) {
{
const __wm_scalar_85_0 = argumentIds_1812;
const __wm_scalar_85_1 = paramIds_1813;
const __wm_scalar_85_2 = context_1814;
const __wm_scalar_85_3 = representations_1815;
const __wm_scalar_85_4 = changed_1816;
if (__wm_scalar_85_0 === __wm_basis_Nil) {
const context_1817 = __wm_scalar_85_2;
const representations_1818 = __wm_scalar_85_3;
const changed_1819 = __wm_scalar_85_4;
return [representations_1818, changed_1819];
} else if (__wm_scalar_85_1 === __wm_basis_Nil) {
const context_1820 = __wm_scalar_85_2;
const representations_1821 = __wm_scalar_85_3;
const changed_1822 = __wm_scalar_85_4;
return [representations_1821, changed_1822];
} else if (__wm_scalar_85_0?.ctor === -6 && __wm_scalar_85_0.args.length === 1 && __wm_is_tuple(__wm_scalar_85_0.args[0]) && __wm_scalar_85_0.args[0].length === 2 && __wm_scalar_85_1?.ctor === -6 && __wm_scalar_85_1.args.length === 1 && __wm_is_tuple(__wm_scalar_85_1.args[0]) && __wm_scalar_85_1.args[0].length === 2) {
const argumentId_1823 = __wm_scalar_85_0.args[0][0];
const argumentRest_1824 = __wm_scalar_85_0.args[0][1];
const paramId_1825 = __wm_scalar_85_1.args[0][0];
const paramRest_1826 = __wm_scalar_85_1.args[0][1];
const context_1827 = __wm_scalar_85_2;
const representations_1828 = __wm_scalar_85_3;
const changed_1829 = __wm_scalar_85_4;
{
const exactContext_1830 = context_1827;
const argument_1831 = findExpression_1625__wm_d2(exactContext_1830.expressions, argumentId_1823);
const param_1832 = findParam_1601__wm_d2(exactContext_1830.params, paramId_1825);
const pattern_1833 = findPattern_1609__wm_d2(exactContext_1830.patterns, param_1832.patternId);
const __wm_bind_57 = (__wm_eq(pattern_1833.kind, "tuple") ? (() => {
const __wm_bind_58 = mergeGroup_1589__wm_d2(__wm_basis_Cons([expressionNode_1517__wm_d2(argument_1831, exactContext_1830), __wm_basis_Cons([patternNode_1524__wm_d2(pattern_1833, exactContext_1830), __wm_basis_Nil])]), representations_1828);
if (!(__wm_is_tuple(__wm_bind_58) && __wm_bind_58.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withSingle_1834 = __wm_bind_58[0];
const singleChanged_1835 = __wm_bind_58[1];
const __wm_bind_59 = mergeLanePairs_1678__wm_d4(patternLaneNodes_1669__wm_d2(Js.Array.toList(pattern_1833.children), exactContext_1830), lookupLanes_1533__wm_d2(exactContext_1830, argument_1831.id), withSingle_1834, false);
if (!(__wm_is_tuple(__wm_bind_59) && __wm_bind_59.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const merged_1836 = __wm_bind_59[0];
const lanesChanged_1837 = __wm_bind_59[1];
return [merged_1836, __wm_op_or_d2(singleChanged_1835, lanesChanged_1837)];
})() : mergeGroup_1589__wm_d2(__wm_basis_Cons([expressionNode_1517__wm_d2(argument_1831, exactContext_1830), __wm_basis_Cons([patternNode_1524__wm_d2(pattern_1833, exactContext_1830), __wm_basis_Nil])]), representations_1828));
if (!(__wm_is_tuple(__wm_bind_57) && __wm_bind_57.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1838 = __wm_bind_57[0];
const pairChanged_1839 = __wm_bind_57[1];
{
const __wm_tail_arg_96_0 = argumentRest_1824;
const __wm_tail_arg_96_1 = paramRest_1826;
const __wm_tail_arg_96_2 = exactContext_1830;
const __wm_tail_arg_96_3 = next_1838;
const __wm_tail_arg_96_4 = __wm_op_or_d2(changed_1829, pairChanged_1839);
argumentIds_1812 = __wm_tail_arg_96_0;
paramIds_1813 = __wm_tail_arg_96_1;
context_1814 = __wm_tail_arg_96_2;
representations_1815 = __wm_tail_arg_96_3;
changed_1816 = __wm_tail_arg_96_4;
continue __wm_tail_82;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const mergeArguments_1811 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return mergeArguments_1811__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const applyExpression_1858__wm_d3 = (expression_1840, context_1841, representations_1842) => {
if (__wm_eq(expression_1840.kind, "var")) {
return mergeGroup_1589__wm_d2(__wm_basis_Cons([expressionNode_1517__wm_d2(expression_1840, context_1841), __wm_basis_Cons([boundPatternNode_1529__wm_d3(context_1841, expression_1840.bindingId, expression_1840.ownerFunctionId), __wm_basis_Nil])]), representations_1842);
} else {
if (__wm_eq(expression_1840.kind, "uniform")) {
const field_1843 = findEnvironmentField_1641__wm_d2(context_1841.environmentFields, expression_1840.index);
return mergeGroup_1589__wm_d2(__wm_basis_Cons([expressionNode_1517__wm_d2(expression_1840, context_1841), __wm_basis_Cons([fieldNode_1536__wm_d2(field_1843, context_1841), __wm_basis_Nil])]), representations_1842);
} else {
if (__wm_eq(expression_1840.kind, "tuple")) {
if (numberEqual_1482__wm_d2(expressionNode_1517__wm_d2(expression_1840, context_1841), __wm_op_sub(1))) {
return [representations_1842, false];
} else {
return mergeGroup_1589__wm_d2(ownAndChildren_1810__wm_d2(expression_1840, context_1841), representations_1842);
}
} else {
if (__wm_op_or_d2(__wm_op_or_d2(__wm_op_or_d2(__wm_op_or_d2(__wm_eq(expression_1840.kind, "project"), __wm_eq(expression_1840.kind, "copy")), __wm_eq(expression_1840.kind, "binary")), __wm_eq(expression_1840.kind, "unary")), __wm_eq(expression_1840.kind, "builtin"))) {
return mergeGroup_1589__wm_d2(ownAndChildren_1810__wm_d2(expression_1840, context_1841), representations_1842);
} else {
if (__wm_eq(expression_1840.kind, "if")) {
const __wm_bind_60 = mergeGroup_1589__wm_d2(ownAndChildren_1810__wm_d2(expression_1840, context_1841), representations_1842);
if (!(__wm_is_tuple(__wm_bind_60) && __wm_bind_60.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withOwn_1844 = __wm_bind_60[0];
const ownChanged_1845 = __wm_bind_60[1];
const own_1846 = expressionNode_1517__wm_d2(expression_1840, context_1841);
if (numberEqual_1482__wm_d2(own_1846, __wm_op_sub(1))) {
const __wm_return_value_31 = Js.Array.toList(expression_1840.children);
if (__wm_return_value_31?.ctor === -6 && __wm_return_value_31.args.length === 1 && __wm_is_tuple(__wm_return_value_31.args[0]) && __wm_return_value_31.args[0].length === 2 && __wm_return_value_31.args[0][1]?.ctor === -6 && __wm_return_value_31.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_31.args[0][1].args[0]) && __wm_return_value_31.args[0][1].args[0].length === 2 && __wm_return_value_31.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_31.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_31.args[0][1].args[0][1].args[0]) && __wm_return_value_31.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_31.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const _cond_1847 = __wm_return_value_31.args[0][0];
const thenId_1848 = __wm_return_value_31.args[0][1].args[0][0];
const elseId_1849 = __wm_return_value_31.args[0][1].args[0][1].args[0][0];
const __wm_bind_61 = mergeLanePairs_1678__wm_d4(lookupLanes_1533__wm_d2(context_1841, thenId_1848), lookupLanes_1533__wm_d2(context_1841, elseId_1849), withOwn_1844, false);
if (!(__wm_is_tuple(__wm_bind_61) && __wm_bind_61.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const merged_1850 = __wm_bind_61[0];
const pairChanged_1851 = __wm_bind_61[1];
return [merged_1850, __wm_op_or_d2(ownChanged_1845, pairChanged_1851)];
} else if (true) {

return [withOwn_1844, ownChanged_1845];
}
__wm_fail("Match", "non-exhaustive match");
} else {
return [withOwn_1844, ownChanged_1845];
}
} else {
if (__wm_eq(expression_1840.kind, "block")) {
const block_1852 = findBlock_1633__wm_d2(context_1841.blocks, expression_1840.id);
const result_1853 = findExpression_1625__wm_d2(context_1841.expressions, block_1852.resultExprId);
return mergeGroup_1589__wm_d2(__wm_basis_Cons([expressionNode_1517__wm_d2(expression_1840, context_1841), __wm_basis_Cons([expressionNode_1517__wm_d2(result_1853, context_1841), __wm_basis_Nil])]), representations_1842);
} else {
if (__wm_eq(expression_1840.kind, "call")) {
const target_1854 = findFunction_1617__wm_d2(context_1841.functions, expression_1840.functionId);
const body_1855 = findExpression_1625__wm_d2(context_1841.expressions, target_1854.bodyExprId);
const __wm_bind_62 = mergeGroup_1589__wm_d2(__wm_basis_Cons([expressionNode_1517__wm_d2(expression_1840, context_1841), __wm_basis_Cons([expressionNode_1517__wm_d2(body_1855, context_1841), __wm_basis_Nil])]), representations_1842);
if (!(__wm_is_tuple(__wm_bind_62) && __wm_bind_62.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withResult_1856 = __wm_bind_62[0];
const resultChanged_1857 = __wm_bind_62[1];
return mergeArguments_1811__wm_d5(Js.Array.toList(expression_1840.children), Js.Array.toList(target_1854.paramIds), context_1841, withResult_1856, resultChanged_1857);
} else {
return [representations_1842, false];
}
}
}
}
}
}
}
};
const applyExpression_1858 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return applyExpression_1858__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const expressionSweep_1859__wm_d4 = (expressions_1860, context_1861, representations_1862, changed_1863) => {
__wm_tail_83: while (true) {
{
const __wm_scalar_86_0 = expressions_1860;
const __wm_scalar_86_1 = context_1861;
const __wm_scalar_86_2 = representations_1862;
const __wm_scalar_86_3 = changed_1863;
if (__wm_scalar_86_0 === __wm_basis_Nil) {
const context_1864 = __wm_scalar_86_1;
const representations_1865 = __wm_scalar_86_2;
const changed_1866 = __wm_scalar_86_3;
return [representations_1865, changed_1866];
} else if (__wm_scalar_86_0?.ctor === -6 && __wm_scalar_86_0.args.length === 1 && __wm_is_tuple(__wm_scalar_86_0.args[0]) && __wm_scalar_86_0.args[0].length === 2) {
const expression_1867 = __wm_scalar_86_0.args[0][0];
const rest_1868 = __wm_scalar_86_0.args[0][1];
const context_1869 = __wm_scalar_86_1;
const representations_1870 = __wm_scalar_86_2;
const changed_1871 = __wm_scalar_86_3;
{
const exactExpression_1872 = expression_1867;
const exactContext_1873 = context_1869;
const __wm_bind_63 = applyExpression_1858__wm_d3(exactExpression_1872, exactContext_1873, representations_1870);
if (!(__wm_is_tuple(__wm_bind_63) && __wm_bind_63.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1874 = __wm_bind_63[0];
const itemChanged_1875 = __wm_bind_63[1];
{
const __wm_tail_arg_97_0 = rest_1868;
const __wm_tail_arg_97_1 = exactContext_1873;
const __wm_tail_arg_97_2 = next_1874;
const __wm_tail_arg_97_3 = __wm_op_or_d2(changed_1871, itemChanged_1875);
expressions_1860 = __wm_tail_arg_97_0;
context_1861 = __wm_tail_arg_97_1;
representations_1862 = __wm_tail_arg_97_2;
changed_1863 = __wm_tail_arg_97_3;
continue __wm_tail_83;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const expressionSweep_1859 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return expressionSweep_1859__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const patternSweep_1876__wm_d4 = (patterns_1878, context_1879, representations_1880, changed_1881) => {
__wm_tail_84: while (true) {
{
const __wm_scalar_87_0 = patterns_1878;
const __wm_scalar_87_1 = context_1879;
const __wm_scalar_87_2 = representations_1880;
const __wm_scalar_87_3 = changed_1881;
if (__wm_scalar_87_0 === __wm_basis_Nil) {
const context_1882 = __wm_scalar_87_1;
const representations_1883 = __wm_scalar_87_2;
const changed_1884 = __wm_scalar_87_3;
return [representations_1883, changed_1884];
} else if (__wm_scalar_87_0?.ctor === -6 && __wm_scalar_87_0.args.length === 1 && __wm_is_tuple(__wm_scalar_87_0.args[0]) && __wm_scalar_87_0.args[0].length === 2) {
const pattern_1885 = __wm_scalar_87_0.args[0][0];
const rest_1886 = __wm_scalar_87_0.args[0][1];
const context_1887 = __wm_scalar_87_1;
const representations_1888 = __wm_scalar_87_2;
const changed_1889 = __wm_scalar_87_3;
{
const exactPattern_1890 = pattern_1885;
const exactContext_1891 = context_1887;
const childNodes_1892 = mapPatternNodes_1877__wm_d3(Js.Array.toList(exactPattern_1890.children), exactContext_1891, __wm_basis_Nil);
const own_1893 = patternNode_1524__wm_d2(exactPattern_1890, exactContext_1891);
const nodes_1894 = (numberEqual_1482__wm_d2(own_1893, __wm_op_sub(1)) ? __wm_basis_Nil : __wm_basis_Cons([own_1893, childNodes_1892]));
const __wm_bind_64 = (__wm_eq(exactPattern_1890.kind, "tuple") ? mergeGroup_1589__wm_d2(nodes_1894, representations_1888) : [representations_1888, false]);
if (!(__wm_is_tuple(__wm_bind_64) && __wm_bind_64.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1895 = __wm_bind_64[0];
const itemChanged_1896 = __wm_bind_64[1];
{
const __wm_tail_arg_98_0 = rest_1886;
const __wm_tail_arg_98_1 = exactContext_1891;
const __wm_tail_arg_98_2 = next_1895;
const __wm_tail_arg_98_3 = __wm_op_or_d2(changed_1889, itemChanged_1896);
patterns_1878 = __wm_tail_arg_98_0;
context_1879 = __wm_tail_arg_98_1;
representations_1880 = __wm_tail_arg_98_2;
changed_1881 = __wm_tail_arg_98_3;
continue __wm_tail_84;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const patternSweep_1876 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return patternSweep_1876__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const mapPatternNodes_1877__wm_d3 = (ids_1897, context_1898, nodes_1899) => {
__wm_tail_85: while (true) {
{
const __wm_scalar_88_0 = ids_1897;
const __wm_scalar_88_1 = context_1898;
const __wm_scalar_88_2 = nodes_1899;
if (__wm_scalar_88_0 === __wm_basis_Nil) {
const context_1900 = __wm_scalar_88_1;
const nodes_1901 = __wm_scalar_88_2;
return nodes_1901;
} else if (__wm_scalar_88_0?.ctor === -6 && __wm_scalar_88_0.args.length === 1 && __wm_is_tuple(__wm_scalar_88_0.args[0]) && __wm_scalar_88_0.args[0].length === 2) {
const id_1902 = __wm_scalar_88_0.args[0][0];
const rest_1903 = __wm_scalar_88_0.args[0][1];
const context_1904 = __wm_scalar_88_1;
const nodes_1905 = __wm_scalar_88_2;
{
const exactContext_1906 = context_1904;
const pattern_1907 = findPattern_1609__wm_d2(exactContext_1906.patterns, id_1902);
const node_1908 = patternNode_1524__wm_d2(pattern_1907, exactContext_1906);
{
const __wm_tail_arg_99_0 = rest_1903;
const __wm_tail_arg_99_1 = exactContext_1906;
const __wm_tail_arg_99_2 = ((node_1908 < 0) ? nodes_1905 : __wm_basis_Cons([node_1908, nodes_1905]));
ids_1897 = __wm_tail_arg_99_0;
context_1898 = __wm_tail_arg_99_1;
nodes_1899 = __wm_tail_arg_99_2;
continue __wm_tail_85;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const mapPatternNodes_1877 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return mapPatternNodes_1877__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const letSweep_1909__wm_d4 = (lets_1910, context_1911, representations_1912, changed_1913) => {
__wm_tail_86: while (true) {
{
const __wm_scalar_89_0 = lets_1910;
const __wm_scalar_89_1 = context_1911;
const __wm_scalar_89_2 = representations_1912;
const __wm_scalar_89_3 = changed_1913;
if (__wm_scalar_89_0 === __wm_basis_Nil) {
const context_1914 = __wm_scalar_89_1;
const representations_1915 = __wm_scalar_89_2;
const changed_1916 = __wm_scalar_89_3;
return [representations_1915, changed_1916];
} else if (__wm_scalar_89_0?.ctor === -6 && __wm_scalar_89_0.args.length === 1 && __wm_is_tuple(__wm_scalar_89_0.args[0]) && __wm_scalar_89_0.args[0].length === 2) {
const binding_1917 = __wm_scalar_89_0.args[0][0];
const rest_1918 = __wm_scalar_89_0.args[0][1];
const context_1919 = __wm_scalar_89_1;
const representations_1920 = __wm_scalar_89_2;
const changed_1921 = __wm_scalar_89_3;
{
const exactBinding_1922 = binding_1917;
const exactContext_1923 = context_1919;
const pattern_1924 = findPattern_1609__wm_d2(exactContext_1923.patterns, exactBinding_1922.patternId);
const value_1925 = findExpression_1625__wm_d2(exactContext_1923.expressions, exactBinding_1922.valueExprId);
const __wm_bind_65 = (__wm_eq(pattern_1924.kind, "tuple") ? (() => {
const __wm_bind_66 = mergeGroup_1589__wm_d2(__wm_basis_Cons([patternNode_1524__wm_d2(pattern_1924, exactContext_1923), __wm_basis_Cons([expressionNode_1517__wm_d2(value_1925, exactContext_1923), __wm_basis_Nil])]), representations_1920);
if (!(__wm_is_tuple(__wm_bind_66) && __wm_bind_66.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withSingle_1926 = __wm_bind_66[0];
const singleChanged_1927 = __wm_bind_66[1];
const __wm_bind_67 = mergeLanePairs_1678__wm_d4(patternLaneNodes_1669__wm_d2(Js.Array.toList(pattern_1924.children), exactContext_1923), lookupLanes_1533__wm_d2(exactContext_1923, value_1925.id), withSingle_1926, false);
if (!(__wm_is_tuple(__wm_bind_67) && __wm_bind_67.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const merged_1928 = __wm_bind_67[0];
const lanesChanged_1929 = __wm_bind_67[1];
return [merged_1928, __wm_op_or_d2(singleChanged_1927, lanesChanged_1929)];
})() : mergeGroup_1589__wm_d2(__wm_basis_Cons([patternNode_1524__wm_d2(pattern_1924, exactContext_1923), __wm_basis_Cons([expressionNode_1517__wm_d2(value_1925, exactContext_1923), __wm_basis_Nil])]), representations_1920));
if (!(__wm_is_tuple(__wm_bind_65) && __wm_bind_65.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1930 = __wm_bind_65[0];
const itemChanged_1931 = __wm_bind_65[1];
{
const __wm_tail_arg_100_0 = rest_1918;
const __wm_tail_arg_100_1 = exactContext_1923;
const __wm_tail_arg_100_2 = next_1930;
const __wm_tail_arg_100_3 = __wm_op_or_d2(changed_1921, itemChanged_1931);
lets_1910 = __wm_tail_arg_100_0;
context_1911 = __wm_tail_arg_100_1;
representations_1912 = __wm_tail_arg_100_2;
changed_1913 = __wm_tail_arg_100_3;
continue __wm_tail_86;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const letSweep_1909 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return letSweep_1909__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const seedExpressions_1932__wm_d3 = (expressions_1933, context_1934, representations_1935) => {
__wm_tail_87: while (true) {
{
const __wm_scalar_90_0 = expressions_1933;
const __wm_scalar_90_1 = context_1934;
const __wm_scalar_90_2 = representations_1935;
if (__wm_scalar_90_0 === __wm_basis_Nil) {
const context_1936 = __wm_scalar_90_1;
const representations_1937 = __wm_scalar_90_2;
return representations_1937;
} else if (__wm_scalar_90_0?.ctor === -6 && __wm_scalar_90_0.args.length === 1 && __wm_is_tuple(__wm_scalar_90_0.args[0]) && __wm_scalar_90_0.args[0].length === 2) {
const expression_1938 = __wm_scalar_90_0.args[0][0];
const rest_1939 = __wm_scalar_90_0.args[0][1];
const context_1940 = __wm_scalar_90_1;
const representations_1941 = __wm_scalar_90_2;
{
const exactExpression_1942 = expression_1938;
const exactContext_1943 = context_1940;
const explicit_1944 = (__wm_eq(exactExpression_1942.semanticId, "gpu.i32") ? "i32" : (__wm_eq(exactExpression_1942.semanticId, "gpu.f32") ? "f32" : exactExpression_1942.numberKind));
const __wm_bind_68 = setRepresentation_1557__wm_d4(representations_1941, expressionNode_1517__wm_d2(exactExpression_1942, exactContext_1943), explicit_1944, exactExpression_1942.spanId);
if (!(__wm_is_tuple(__wm_bind_68) && __wm_bind_68.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1945 = __wm_bind_68[0];
const _changed_1946 = __wm_bind_68[1];
const withResourceResult_1949 = (__wm_eq(exactExpression_1942.kind, "resource-call") ? (() => {
const __wm_bind_69 = setRepresentation_1557__wm_d4(next_1945, expressionNode_1517__wm_d2(exactExpression_1942, exactContext_1943), "f32", exactExpression_1942.spanId);
if (!(__wm_is_tuple(__wm_bind_69) && __wm_bind_69.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const updated_1947 = __wm_bind_69[0];
const _resourceChanged_1948 = __wm_bind_69[1];
return updated_1947;
})() : next_1945);
const withResourceCoordinate_1960 = (__wm_eq(exactExpression_1942.kind, "resource-call") ? (() => {
const coordinateId_1955 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2 && __v.args[0][1]?.ctor === -6 && __v.args[0][1].args.length === 1 && __wm_is_tuple(__v.args[0][1].args[0]) && __v.args[0][1].args[0].length === 2 && __v.args[0][1].args[0][1]?.ctor === -6 && __v.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__v.args[0][1].args[0][1].args[0]) && __v.args[0][1].args[0][1].args[0].length === 2 && __v.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const _texture_1950 = __v.args[0][0];
const _sampler_1951 = __v.args[0][1].args[0][0];
const id_1952 = __v.args[0][1].args[0][1].args[0][0];
return id_1952;
} else if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2 && __v.args[0][1]?.ctor === -6 && __v.args[0][1].args.length === 1 && __wm_is_tuple(__v.args[0][1].args[0]) && __v.args[0][1].args[0].length === 2 && __v.args[0][1].args[0][1] === __wm_basis_Nil) {
const _texture_1953 = __v.args[0][0];
const id_1954 = __v.args[0][1].args[0][0];
return id_1954;
} else if (true) {

return __wm_fail("Panic", "GPU resource call has invalid coordinate arity");
}
__wm_fail("Match", "non-exhaustive match");
})(Js.Array.toList(exactExpression_1942.children));
const coordinate_1956 = findExpression_1625__wm_d2(exactContext_1943.expressions, coordinateId_1955);
const coordinateRepresentation_1957 = (__wm_eq(exactExpression_1942.resourceOperation, "load") ? "i32" : "f32");
const __wm_bind_70 = setRepresentation_1557__wm_d4(withResourceResult_1949, expressionNode_1517__wm_d2(coordinate_1956, exactContext_1943), coordinateRepresentation_1957, coordinate_1956.spanId);
if (!(__wm_is_tuple(__wm_bind_70) && __wm_bind_70.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const updated_1958 = __wm_bind_70[0];
const _coordinateChanged_1959 = __wm_bind_70[1];
return updated_1958;
})() : withResourceResult_1949);
{
const __wm_tail_arg_101_0 = rest_1939;
const __wm_tail_arg_101_1 = exactContext_1943;
const __wm_tail_arg_101_2 = withResourceCoordinate_1960;
expressions_1933 = __wm_tail_arg_101_0;
context_1934 = __wm_tail_arg_101_1;
representations_1935 = __wm_tail_arg_101_2;
continue __wm_tail_87;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const seedExpressions_1932 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return seedExpressions_1932__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const seedFragmentAbi_1974__wm_d3 = (input_1961, context_1962, representations_1963) => {
const root_1964 = findFunction_1617__wm_d2(context_1962.functions, input_1961.root.functionId);
const firstParamId_1966 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2) {
const id_1965 = __v.args[0][0];
return id_1965;
} else if (__v === __wm_basis_Nil) {

return __wm_fail("Panic", "fragment root has no coordinate parameter");
}
__wm_fail("Match", "non-exhaustive match");
})(Js.Array.toList(root_1964.paramIds));
const param_1967 = findParam_1601__wm_d2(context_1962.params, firstParamId_1966);
const pattern_1968 = findPattern_1609__wm_d2(context_1962.patterns, param_1967.patternId);
const body_1969 = findExpression_1625__wm_d2(context_1962.expressions, root_1964.bodyExprId);
const __wm_bind_71 = setRepresentation_1557__wm_d4(representations_1963, patternNode_1524__wm_d2(pattern_1968, context_1962), "f32", pattern_1968.spanId);
if (!(__wm_is_tuple(__wm_bind_71) && __wm_bind_71.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withCoord_1970 = __wm_bind_71[0];
const _coordChanged_1971 = __wm_bind_71[1];
const __wm_bind_72 = setRepresentation_1557__wm_d4(withCoord_1970, expressionNode_1517__wm_d2(body_1969, context_1962), "f32", body_1969.spanId);
if (!(__wm_is_tuple(__wm_bind_72) && __wm_bind_72.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withResult_1972 = __wm_bind_72[0];
const _resultChanged_1973 = __wm_bind_72[1];
return withResult_1972;
};
const seedFragmentAbi_1974 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return seedFragmentAbi_1974__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const solveFixedPoint_1975__wm_d2 = (context_1976, representations_1977) => {
__wm_tail_88: while (true) {
{
const __wm_bind_73 = expressionSweep_1859__wm_d4(context_1976.expressions, context_1976, representations_1977, false);
if (!(__wm_is_tuple(__wm_bind_73) && __wm_bind_73.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterExpressions_1978 = __wm_bind_73[0];
const expressionChanged_1979 = __wm_bind_73[1];
const __wm_bind_74 = patternSweep_1876__wm_d4(context_1976.patterns, context_1976, afterExpressions_1978, false);
if (!(__wm_is_tuple(__wm_bind_74) && __wm_bind_74.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterPatterns_1980 = __wm_bind_74[0];
const patternChanged_1981 = __wm_bind_74[1];
const __wm_bind_75 = letSweep_1909__wm_d4(context_1976.lets, context_1976, afterPatterns_1980, false);
if (!(__wm_is_tuple(__wm_bind_75) && __wm_bind_75.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterLets_1982 = __wm_bind_75[0];
const letChanged_1983 = __wm_bind_75[1];
if (__wm_op_or_d2(__wm_op_or_d2(expressionChanged_1979, patternChanged_1981), letChanged_1983)) {
{
const __wm_tail_arg_102_0 = context_1976;
const __wm_tail_arg_102_1 = afterLets_1982;
context_1976 = __wm_tail_arg_102_0;
representations_1977 = __wm_tail_arg_102_1;
continue __wm_tail_88;
}
} else {
return afterLets_1982;
}
}
}
};
const solveFixedPoint_1975 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return solveFixedPoint_1975__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const ensureExpressionsResolved_1984__wm_d3 = (expressions_1985, context_1986, representations_1987) => {
__wm_tail_89: while (true) {
{
const __wm_scalar_91_0 = expressions_1985;
const __wm_scalar_91_1 = context_1986;
const __wm_scalar_91_2 = representations_1987;
if (__wm_scalar_91_0 === __wm_basis_Nil) {
const context_1988 = __wm_scalar_91_1;
const representations_1989 = __wm_scalar_91_2;
return undefined;
} else if (__wm_scalar_91_0?.ctor === -6 && __wm_scalar_91_0.args.length === 1 && __wm_is_tuple(__wm_scalar_91_0.args[0]) && __wm_scalar_91_0.args[0].length === 2) {
const expression_1990 = __wm_scalar_91_0.args[0][0];
const rest_1991 = __wm_scalar_91_0.args[0][1];
const context_1992 = __wm_scalar_91_1;
const representations_1993 = __wm_scalar_91_2;
{
const node_1994 = expressionNode_1517__wm_d2(expression_1990, context_1992);
if (__wm_op_and_d2((node_1994 >= 0), __wm_eq(representation_1543__wm_d2(representations_1993, node_1994), ""))) {
return __wm_fail("Panic", ((("WM_GPU_NUMERIC_UNRESOLVED|" + Text.of(expression_1990.spanId)) + "|expression ") + Text.of(expression_1990.id)));
} else {
{
const __wm_tail_arg_103_0 = rest_1991;
const __wm_tail_arg_103_1 = context_1992;
const __wm_tail_arg_103_2 = representations_1993;
expressions_1985 = __wm_tail_arg_103_0;
context_1986 = __wm_tail_arg_103_1;
representations_1987 = __wm_tail_arg_103_2;
continue __wm_tail_89;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const ensureExpressionsResolved_1984 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return ensureExpressionsResolved_1984__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const ensurePatternsResolved_1995__wm_d3 = (patterns_1996, context_1997, representations_1998) => {
__wm_tail_90: while (true) {
{
const __wm_scalar_92_0 = patterns_1996;
const __wm_scalar_92_1 = context_1997;
const __wm_scalar_92_2 = representations_1998;
if (__wm_scalar_92_0 === __wm_basis_Nil) {
const context_1999 = __wm_scalar_92_1;
const representations_2000 = __wm_scalar_92_2;
return undefined;
} else if (__wm_scalar_92_0?.ctor === -6 && __wm_scalar_92_0.args.length === 1 && __wm_is_tuple(__wm_scalar_92_0.args[0]) && __wm_scalar_92_0.args[0].length === 2) {
const pattern_2001 = __wm_scalar_92_0.args[0][0];
const rest_2002 = __wm_scalar_92_0.args[0][1];
const context_2003 = __wm_scalar_92_1;
const representations_2004 = __wm_scalar_92_2;
{
const node_2005 = patternNode_1524__wm_d2(pattern_2001, context_2003);
if (__wm_op_and_d2((node_2005 >= 0), __wm_eq(representation_1543__wm_d2(representations_2004, node_2005), ""))) {
return __wm_fail("Panic", ((("WM_GPU_NUMERIC_UNRESOLVED|" + Text.of(pattern_2001.spanId)) + "|pattern ") + Text.of(pattern_2001.id)));
} else {
{
const __wm_tail_arg_104_0 = rest_2002;
const __wm_tail_arg_104_1 = context_2003;
const __wm_tail_arg_104_2 = representations_2004;
patterns_1996 = __wm_tail_arg_104_0;
context_1997 = __wm_tail_arg_104_1;
representations_1998 = __wm_tail_arg_104_2;
continue __wm_tail_90;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const ensurePatternsResolved_1995 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return ensurePatternsResolved_1995__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const ensureFieldsResolved_2006__wm_d3 = (fields_2007, context_2008, representations_2009) => {
__wm_tail_91: while (true) {
{
const __wm_scalar_93_0 = fields_2007;
const __wm_scalar_93_1 = context_2008;
const __wm_scalar_93_2 = representations_2009;
if (__wm_scalar_93_0 === __wm_basis_Nil) {
const context_2010 = __wm_scalar_93_1;
const representations_2011 = __wm_scalar_93_2;
return undefined;
} else if (__wm_scalar_93_0?.ctor === -6 && __wm_scalar_93_0.args.length === 1 && __wm_is_tuple(__wm_scalar_93_0.args[0]) && __wm_scalar_93_0.args[0].length === 2) {
const field_2012 = __wm_scalar_93_0.args[0][0];
const rest_2013 = __wm_scalar_93_0.args[0][1];
const context_2014 = __wm_scalar_93_1;
const representations_2015 = __wm_scalar_93_2;
{
const node_2016 = fieldNode_1536__wm_d2(field_2012, context_2014);
if (__wm_op_and_d2((node_2016 >= 0), __wm_eq(representation_1543__wm_d2(representations_2015, node_2016), ""))) {
return __wm_fail("Panic", ((("WM_GPU_NUMERIC_UNRESOLVED|" + Text.of(field_2012.spanId)) + "|environment field ") + field_2012.name));
} else {
{
const __wm_tail_arg_105_0 = rest_2013;
const __wm_tail_arg_105_1 = context_2014;
const __wm_tail_arg_105_2 = representations_2015;
fields_2007 = __wm_tail_arg_105_0;
context_2008 = __wm_tail_arg_105_1;
representations_2009 = __wm_tail_arg_105_2;
continue __wm_tail_91;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const ensureFieldsResolved_2006 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return ensureFieldsResolved_2006__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const solveSliceNumericRepresentations_2025 = (__arg) => {
if (true) {
const input_2017 = __arg;
const expressions_2018 = Js.Array.toList(input_2017.expressions);
const patterns_2019 = Js.Array.toList(input_2017.patterns);
const expressionOffset_2020 = listLength_1483__wm_d2(expressions_2018, 0);
const context_2021 = { expressionOffset: expressionOffset_2020, fieldOffset: (expressionOffset_2020 + listLength_1483__wm_d2(patterns_2019, 0)), types: Js.Array.toList(input_2017.types), expressions: expressions_2018, patterns: patterns_2019, params: Js.Array.toList(input_2017.params), lets: Js.Array.toList(input_2017.lets), blocks: Js.Array.toList(input_2017.blocks), functions: Js.Array.toList(input_2017.functions), environmentFields: Js.Array.toList(input_2017.environmentFields), exprNodes: Map.empty(Map.numberCompare), patternNodes: Map.empty(Map.numberCompare), patternByBinding: Map.empty(Map.numberCompare), lanes: Map.empty(Map.numberCompare) };
const cached_2022 = buildNumericCaches_1792(context_2021);
const seeded_2023 = seedExpressions_1932__wm_d3(expressions_2018, cached_2022, Map.empty(Map.numberCompare));
const solved_2024 = solveFixedPoint_1975__wm_d2(cached_2022, seedFragmentAbi_1974__wm_d3(input_2017, cached_2022, seeded_2023));
ensureExpressionsResolved_1984__wm_d3(expressions_2018, cached_2022, solved_2024);
ensurePatternsResolved_1995__wm_d3(patterns_2019, cached_2022, solved_2024);
ensureFieldsResolved_2006__wm_d3(cached_2022.environmentFields, cached_2022, solved_2024);
return solved_2024;
}
__wm_fail("Match", "pattern match failure in function");
};
const expressionRepresentation_2028__wm_d2 = (representations_2026, expressionId_2027) => {
return representation_1543__wm_d2(representations_2026, expressionId_2027);
};
const expressionRepresentation_2028 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return expressionRepresentation_2028__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const patternRepresentation_2032__wm_d3 = (representations_2029, expressionCount_2030, patternId_2031) => {
return representation_1543__wm_d2(representations_2029, (expressionCount_2030 + patternId_2031));
};
const patternRepresentation_2032 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return patternRepresentation_2032__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
return { "NumericContext": NumericContext_1478, "NumericEvidence": NumericEvidence_1479, "numberEqual": numberEqual_1482, "numberEqual__wm_d2": numberEqual_1482__wm_d2, "listLength": listLength_1483, "listLength__wm_d2": listLength_1483__wm_d2, "findType": findType_1489, "findType__wm_d2": findType_1489__wm_d2, "allNumberTypes": allNumberTypes_1497, "allNumberTypes__wm_d2": allNumberTypes_1497__wm_d2, "numericType": numericType_1510, "numericType__wm_d2": numericType_1510__wm_d2, "computeExpressionNode": computeExpressionNode_1513, "computeExpressionNode__wm_d2": computeExpressionNode_1513__wm_d2, "expressionNode": expressionNode_1517, "expressionNode__wm_d2": expressionNode_1517__wm_d2, "computePatternNode": computePatternNode_1520, "computePatternNode__wm_d2": computePatternNode_1520__wm_d2, "patternNode": patternNode_1524, "patternNode__wm_d2": patternNode_1524__wm_d2, "boundPatternNode": boundPatternNode_1529, "boundPatternNode__wm_d3": boundPatternNode_1529__wm_d3, "lookupLanes": lookupLanes_1533, "lookupLanes__wm_d2": lookupLanes_1533__wm_d2, "fieldNode": fieldNode_1536, "fieldNode__wm_d2": fieldNode_1536__wm_d2, "evidence": evidence_1539, "evidence__wm_d2": evidence_1539__wm_d2, "representation": representation_1543, "representation__wm_d2": representation_1543__wm_d2, "numericConflict": numericConflict_1546, "numericConflict__wm_d2": numericConflict_1546__wm_d2, "setEvidence": setEvidence_1551, "setEvidence__wm_d3": setEvidence_1551__wm_d3, "setRepresentation": setRepresentation_1557, "setRepresentation__wm_d4": setRepresentation_1557__wm_d4, "combinedEvidence": combinedEvidence_1558, "combinedEvidence__wm_d3": combinedEvidence_1558__wm_d3, "setGroup": setGroup_1570, "setGroup__wm_d4": setGroup_1570__wm_d4, "mergeGroup": mergeGroup_1589, "mergeGroup__wm_d2": mergeGroup_1589__wm_d2, "findPatternByBinding": findPatternByBinding_1590, "findPatternByBinding__wm_d3": findPatternByBinding_1590__wm_d3, "findParam": findParam_1601, "findParam__wm_d2": findParam_1601__wm_d2, "findPattern": findPattern_1609, "findPattern__wm_d2": findPattern_1609__wm_d2, "findFunction": findFunction_1617, "findFunction__wm_d2": findFunction_1617__wm_d2, "findExpression": findExpression_1625, "findExpression__wm_d2": findExpression_1625__wm_d2, "findBlock": findBlock_1633, "findBlock__wm_d2": findBlock_1633__wm_d2, "findEnvironmentField": findEnvironmentField_1641, "findEnvironmentField__wm_d2": findEnvironmentField_1641__wm_d2, "laneContains": laneContains_1649, "laneContains__wm_d2": laneContains_1649__wm_d2, "childLaneNodes": childLaneNodes_1656, "childLaneNodes__wm_d2": childLaneNodes_1656__wm_d2, "lookupMemoLanes": lookupMemoLanes_1668, "lookupMemoLanes__wm_d2": lookupMemoLanes_1668__wm_d2, "patternLaneNodes": patternLaneNodes_1669, "patternLaneNodes__wm_d2": patternLaneNodes_1669__wm_d2, "mergeLanePairs": mergeLanePairs_1678, "mergeLanePairs__wm_d4": mergeLanePairs_1678__wm_d4, "findLetForPattern": findLetForPattern_1695, "findLetForPattern__wm_d2": findLetForPattern_1695__wm_d2, "laneForMemo": laneForMemo_1703, "laneForMemo__wm_d6": laneForMemo_1703__wm_d6, "laneForUncached": laneForUncached_1704, "laneForUncached__wm_d6": laneForUncached_1704__wm_d6, "foldExprNodes": foldExprNodes_1734, "foldExprNodes__wm_d3": foldExprNodes_1734__wm_d3, "foldPatternNodes": foldPatternNodes_1746, "foldPatternNodes__wm_d3": foldPatternNodes_1746__wm_d3, "foldPatternBindings": foldPatternBindings_1758, "foldPatternBindings__wm_d3": foldPatternBindings_1758__wm_d3, "buildAllLanes": buildAllLanes_1772, "buildAllLanes__wm_d4": buildAllLanes_1772__wm_d4, "buildNumericCaches": buildNumericCaches_1792, "numericChildNodes": numericChildNodes_1793, "numericChildNodes__wm_d3": numericChildNodes_1793__wm_d3, "ownAndChildren": ownAndChildren_1810, "ownAndChildren__wm_d2": ownAndChildren_1810__wm_d2, "mergeArguments": mergeArguments_1811, "mergeArguments__wm_d5": mergeArguments_1811__wm_d5, "applyExpression": applyExpression_1858, "applyExpression__wm_d3": applyExpression_1858__wm_d3, "expressionSweep": expressionSweep_1859, "expressionSweep__wm_d4": expressionSweep_1859__wm_d4, "patternSweep": patternSweep_1876, "patternSweep__wm_d4": patternSweep_1876__wm_d4, "mapPatternNodes": mapPatternNodes_1877, "mapPatternNodes__wm_d3": mapPatternNodes_1877__wm_d3, "letSweep": letSweep_1909, "letSweep__wm_d4": letSweep_1909__wm_d4, "seedExpressions": seedExpressions_1932, "seedExpressions__wm_d3": seedExpressions_1932__wm_d3, "seedFragmentAbi": seedFragmentAbi_1974, "seedFragmentAbi__wm_d3": seedFragmentAbi_1974__wm_d3, "solveFixedPoint": solveFixedPoint_1975, "solveFixedPoint__wm_d2": solveFixedPoint_1975__wm_d2, "ensureExpressionsResolved": ensureExpressionsResolved_1984, "ensureExpressionsResolved__wm_d3": ensureExpressionsResolved_1984__wm_d3, "ensurePatternsResolved": ensurePatternsResolved_1995, "ensurePatternsResolved__wm_d3": ensurePatternsResolved_1995__wm_d3, "ensureFieldsResolved": ensureFieldsResolved_2006, "ensureFieldsResolved__wm_d3": ensureFieldsResolved_2006__wm_d3, "solveSliceNumericRepresentations": solveSliceNumericRepresentations_2025, "expressionRepresentation": expressionRepresentation_2028, "expressionRepresentation__wm_d2": expressionRepresentation_2028__wm_d2, "patternRepresentation": patternRepresentation_2032, "patternRepresentation__wm_d3": patternRepresentation_2032__wm_d3 };
  },
  (value) => { __wm_module_5 = value; },
);
let __wm_module_6;
__wm_define_module(
  "__wm_module_6",
  ["__wm_module_0", "__wm_module_1", "__wm_module_3", "__wm_module_4", "__wm_module_5"],
  async () => {
const GpuSliceAdtDto_24 = __wm_module_0["GpuSliceAdtDto"];
const GpuSliceBlockDto_31 = __wm_module_0["GpuSliceBlockDto"];
const GpuSliceBlockItemDto_30 = __wm_module_0["GpuSliceBlockItemDto"];
const GpuSliceBuiltinOverloadDto_35 = __wm_module_0["GpuSliceBuiltinOverloadDto"];
const GpuSliceBuiltinCatalogDto_36 = __wm_module_0["GpuSliceBuiltinCatalogDto"];
const GpuSliceBuiltinSelectionDto_39 = __wm_module_0["GpuSliceBuiltinSelectionDto"];
const GpuSliceCompilationOutputDto_63 = __wm_module_0["GpuSliceCompilationOutputDto"];
const GpuSliceDiagnosticDto_48 = __wm_module_0["GpuSliceDiagnosticDto"];
const GpuSliceDiagnosticRelatedDto_47 = __wm_module_0["GpuSliceDiagnosticRelatedDto"];
const GpuSliceElaborationInputDto_46 = __wm_module_0["GpuSliceElaborationInputDto"];
const GpuSliceEnvironmentFieldDto_42 = __wm_module_0["GpuSliceEnvironmentFieldDto"];
const GpuSliceExprDto_33 = __wm_module_0["GpuSliceExprDto"];
const GpuSliceFunctionDto_37 = __wm_module_0["GpuSliceFunctionDto"];
const GpuSliceIrExprDto_49 = __wm_module_0["GpuSliceIrExprDto"];
const GpuSliceIrFunctionDto_51 = __wm_module_0["GpuSliceIrFunctionDto"];
const GpuSliceIrMatchArmDto_50 = __wm_module_0["GpuSliceIrMatchArmDto"];
const GpuSliceLetDto_28 = __wm_module_0["GpuSliceLetDto"];
const GpuSliceLoweringSeedDto_54 = __wm_module_0["GpuSliceLoweringSeedDto"];
const GpuSliceLoweredProgramDto_62 = __wm_module_0["GpuSliceLoweredProgramDto"];
const GpuSliceMatchArmDto_29 = __wm_module_0["GpuSliceMatchArmDto"];
const GpuSliceMatchDto_32 = __wm_module_0["GpuSliceMatchDto"];
const GpuSlicePatternDto_26 = __wm_module_0["GpuSlicePatternDto"];
const GpuSliceTypeDto_21 = __wm_module_0["GpuSliceTypeDto"];
const GpuSliceTypeEvidenceDto_23 = __wm_module_0["GpuSliceTypeEvidenceDto"];
const GpuSliceOccurrenceTypeDto_38 = __wm_module_0["GpuSliceOccurrenceTypeDto"];
const GpuSliceParamDto_27 = __wm_module_0["GpuSliceParamDto"];
const GpuSliceTypeElaborationOutputDto_40 = __wm_module_0["GpuSliceTypeElaborationOutputDto"];
const buildSliceLayouts_141 = __wm_module_1["buildSliceLayouts"];
const lowerSliceProgram_906 = __wm_module_3["lowerSliceProgram"];
const lowerSliceProgram_906__wm_d8 = __wm_module_3["lowerSliceProgram__wm_d8"];
const emitSliceCallableName_1465 = __wm_module_4["emitSliceCallableName"];
const emitSliceSlang_1477 = __wm_module_4["emitSliceSlang"];
const emitSliceSlang_1477__wm_d10 = __wm_module_4["emitSliceSlang__wm_d10"];
const emitSliceSlangModule_1463 = __wm_module_4["emitSliceSlangModule"];
const emitSliceSlangModule_1463__wm_d10 = __wm_module_4["emitSliceSlangModule__wm_d10"];
const NumericEvidence_1479 = __wm_module_5["NumericEvidence"];
const expressionRepresentation_2028 = __wm_module_5["expressionRepresentation"];
const expressionRepresentation_2028__wm_d2 = __wm_module_5["expressionRepresentation__wm_d2"];
const patternRepresentation_2032 = __wm_module_5["patternRepresentation"];
const patternRepresentation_2032__wm_d3 = __wm_module_5["patternRepresentation__wm_d3"];
const solveSliceNumericRepresentations_2025 = __wm_module_5["solveSliceNumericRepresentations"];
const SliceContext_2033 = (__record_args) => ({ expressions: __record_args[0], blocks: __record_args[1], blockItems: __record_args[2], lets: __record_args[3], matches: __record_args[4], matchArms: __record_args[5], patterns: __record_args[6], types: __record_args[7], adts: __record_args[8], functions: __record_args[9], builtinOverloads: __record_args[10], occurrences: __record_args[11] });
const SliceIrState_2034 = (__record_args) => ({ nextExpressionId: __record_args[0], nextArmId: __record_args[1], functions: __record_args[2], expressions: __record_args[3], matchArms: __record_args[4], diagnostics: __record_args[5] });
const BuiltBlockItem_2035 = (__record_args) => ({ itemId: __record_args[0], valueExprId: __record_args[1] });
const reverseInto_2036__wm_d2 = (items_2037, reversed_2038) => {
__wm_tail_92: while (true) {
{
const __wm_scalar_94_0 = items_2037;
const __wm_scalar_94_1 = reversed_2038;
if (__wm_scalar_94_0 === __wm_basis_Nil) {
const reversed_2039 = __wm_scalar_94_1;
return reversed_2039;
} else if (__wm_scalar_94_0?.ctor === -6 && __wm_scalar_94_0.args.length === 1 && __wm_is_tuple(__wm_scalar_94_0.args[0]) && __wm_scalar_94_0.args[0].length === 2) {
const head_2040 = __wm_scalar_94_0.args[0][0];
const rest_2041 = __wm_scalar_94_0.args[0][1];
const reversed_2042 = __wm_scalar_94_1;
{
const __wm_tail_arg_106_0 = rest_2041;
const __wm_tail_arg_106_1 = __wm_basis_Cons([head_2040, reversed_2042]);
items_2037 = __wm_tail_arg_106_0;
reversed_2038 = __wm_tail_arg_106_1;
continue __wm_tail_92;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reverseInto_2036 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reverseInto_2036__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const append_2043__wm_d2 = (left_2044, right_2045) => {
const __wm_scalar_95_0 = left_2044;
const __wm_scalar_95_1 = right_2045;
if (__wm_scalar_95_0 === __wm_basis_Nil) {
const right_2046 = __wm_scalar_95_1;
return right_2046;
} else if (__wm_scalar_95_0?.ctor === -6 && __wm_scalar_95_0.args.length === 1 && __wm_is_tuple(__wm_scalar_95_0.args[0]) && __wm_scalar_95_0.args[0].length === 2) {
const head_2047 = __wm_scalar_95_0.args[0][0];
const rest_2048 = __wm_scalar_95_0.args[0][1];
const right_2049 = __wm_scalar_95_1;
return __wm_basis_Cons([head_2047, append_2043__wm_d2(rest_2048, right_2049)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const append_2043 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return append_2043__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const listLength_2050__wm_d2 = (items_2051, length_2052) => {
__wm_tail_93: while (true) {
{
const __wm_scalar_96_0 = items_2051;
const __wm_scalar_96_1 = length_2052;
if (__wm_scalar_96_0 === __wm_basis_Nil) {
const length_2053 = __wm_scalar_96_1;
return length_2053;
} else if (__wm_scalar_96_0?.ctor === -6 && __wm_scalar_96_0.args.length === 1 && __wm_is_tuple(__wm_scalar_96_0.args[0]) && __wm_scalar_96_0.args[0].length === 2) {
const rest_2054 = __wm_scalar_96_0.args[0][1];
const length_2055 = __wm_scalar_96_1;
{
const __wm_tail_arg_107_0 = rest_2054;
const __wm_tail_arg_107_1 = (length_2055 + 1);
items_2051 = __wm_tail_arg_107_0;
length_2052 = __wm_tail_arg_107_1;
continue __wm_tail_93;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const listLength_2050 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return listLength_2050__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const numberEqual_2058__wm_d2 = (left_2056, right_2057) => {
return __wm_op_and_d2(__wm_op_not((left_2056 < right_2057)), __wm_op_not((left_2056 > right_2057)));
};
const numberEqual_2058 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numberEqual_2058__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const contains_2059__wm_d2 = (items_2060, expected_2061) => {
__wm_tail_94: while (true) {
{
const __wm_tail_value_108 = items_2060;
if (__wm_tail_value_108 === __wm_basis_Nil) {

return false;
} else if (__wm_tail_value_108?.ctor === -6 && __wm_tail_value_108.args.length === 1 && __wm_is_tuple(__wm_tail_value_108.args[0]) && __wm_tail_value_108.args[0].length === 2) {
const head_2062 = __wm_tail_value_108.args[0][0];
const rest_2063 = __wm_tail_value_108.args[0][1];
if (numberEqual_2058__wm_d2(head_2062, expected_2061)) {
return true;
} else {
{
const __wm_tail_arg_109_0 = rest_2063;
const __wm_tail_arg_109_1 = expected_2061;
items_2060 = __wm_tail_arg_109_0;
expected_2061 = __wm_tail_arg_109_1;
continue __wm_tail_94;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const contains_2059 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return contains_2059__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const unique_2064__wm_d2 = (items_2065, seen_2066) => {
__wm_tail_95: while (true) {
{
const __wm_tail_value_110 = items_2065;
if (__wm_tail_value_110 === __wm_basis_Nil) {

return true;
} else if (__wm_tail_value_110?.ctor === -6 && __wm_tail_value_110.args.length === 1 && __wm_is_tuple(__wm_tail_value_110.args[0]) && __wm_tail_value_110.args[0].length === 2) {
const head_2067 = __wm_tail_value_110.args[0][0];
const rest_2068 = __wm_tail_value_110.args[0][1];
if (contains_2059__wm_d2(seen_2066, head_2067)) {
return false;
} else {
{
const __wm_tail_arg_111_0 = rest_2068;
const __wm_tail_arg_111_1 = __wm_basis_Cons([head_2067, seen_2066]);
items_2065 = __wm_tail_arg_111_0;
seen_2066 = __wm_tail_arg_111_1;
continue __wm_tail_95;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const unique_2064 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return unique_2064__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findExpression_2069__wm_d2 = (items_2070, id_2071) => {
__wm_tail_96: while (true) {
{
const __wm_scalar_97_0 = items_2070;
const __wm_scalar_97_1 = id_2071;
if (__wm_scalar_97_0 === __wm_basis_Nil) {
const id_2072 = __wm_scalar_97_1;
return __wm_fail("Panic", "missing schema-v2 expression");
} else if (__wm_scalar_97_0?.ctor === -6 && __wm_scalar_97_0.args.length === 1 && __wm_is_tuple(__wm_scalar_97_0.args[0]) && __wm_scalar_97_0.args[0].length === 2) {
const item_2073 = __wm_scalar_97_0.args[0][0];
const rest_2074 = __wm_scalar_97_0.args[0][1];
const id_2075 = __wm_scalar_97_1;
{
const exact_2076 = item_2073;
if (numberEqual_2058__wm_d2(exact_2076.id, id_2075)) {
return exact_2076;
} else {
{
const __wm_tail_arg_112_0 = rest_2074;
const __wm_tail_arg_112_1 = id_2075;
items_2070 = __wm_tail_arg_112_0;
id_2071 = __wm_tail_arg_112_1;
continue __wm_tail_96;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findExpression_2069 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findExpression_2069__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findBlock_2077__wm_d2 = (items_2078, expressionId_2079) => {
__wm_tail_97: while (true) {
{
const __wm_scalar_98_0 = items_2078;
const __wm_scalar_98_1 = expressionId_2079;
if (__wm_scalar_98_0 === __wm_basis_Nil) {
const expressionId_2080 = __wm_scalar_98_1;
return __wm_fail("Panic", "missing schema-v2 block");
} else if (__wm_scalar_98_0?.ctor === -6 && __wm_scalar_98_0.args.length === 1 && __wm_is_tuple(__wm_scalar_98_0.args[0]) && __wm_scalar_98_0.args[0].length === 2) {
const item_2081 = __wm_scalar_98_0.args[0][0];
const rest_2082 = __wm_scalar_98_0.args[0][1];
const expressionId_2083 = __wm_scalar_98_1;
{
const exact_2084 = item_2081;
if (numberEqual_2058__wm_d2(exact_2084.expressionId, expressionId_2083)) {
return exact_2084;
} else {
{
const __wm_tail_arg_113_0 = rest_2082;
const __wm_tail_arg_113_1 = expressionId_2083;
items_2078 = __wm_tail_arg_113_0;
expressionId_2079 = __wm_tail_arg_113_1;
continue __wm_tail_97;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findBlock_2077 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findBlock_2077__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findBlockItem_2085__wm_d2 = (items_2086, id_2087) => {
__wm_tail_98: while (true) {
{
const __wm_scalar_99_0 = items_2086;
const __wm_scalar_99_1 = id_2087;
if (__wm_scalar_99_0 === __wm_basis_Nil) {
const id_2088 = __wm_scalar_99_1;
return __wm_fail("Panic", "missing schema-v2 block item");
} else if (__wm_scalar_99_0?.ctor === -6 && __wm_scalar_99_0.args.length === 1 && __wm_is_tuple(__wm_scalar_99_0.args[0]) && __wm_scalar_99_0.args[0].length === 2) {
const item_2089 = __wm_scalar_99_0.args[0][0];
const rest_2090 = __wm_scalar_99_0.args[0][1];
const id_2091 = __wm_scalar_99_1;
{
const exact_2092 = item_2089;
if (numberEqual_2058__wm_d2(exact_2092.id, id_2091)) {
return exact_2092;
} else {
{
const __wm_tail_arg_114_0 = rest_2090;
const __wm_tail_arg_114_1 = id_2091;
items_2086 = __wm_tail_arg_114_0;
id_2087 = __wm_tail_arg_114_1;
continue __wm_tail_98;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findBlockItem_2085 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findBlockItem_2085__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLet_2093__wm_d2 = (items_2094, id_2095) => {
__wm_tail_99: while (true) {
{
const __wm_scalar_100_0 = items_2094;
const __wm_scalar_100_1 = id_2095;
if (__wm_scalar_100_0 === __wm_basis_Nil) {
const id_2096 = __wm_scalar_100_1;
return __wm_fail("Panic", "missing schema-v2 let");
} else if (__wm_scalar_100_0?.ctor === -6 && __wm_scalar_100_0.args.length === 1 && __wm_is_tuple(__wm_scalar_100_0.args[0]) && __wm_scalar_100_0.args[0].length === 2) {
const item_2097 = __wm_scalar_100_0.args[0][0];
const rest_2098 = __wm_scalar_100_0.args[0][1];
const id_2099 = __wm_scalar_100_1;
{
const exact_2100 = item_2097;
if (numberEqual_2058__wm_d2(exact_2100.id, id_2099)) {
return exact_2100;
} else {
{
const __wm_tail_arg_115_0 = rest_2098;
const __wm_tail_arg_115_1 = id_2099;
items_2094 = __wm_tail_arg_115_0;
id_2095 = __wm_tail_arg_115_1;
continue __wm_tail_99;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLet_2093 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLet_2093__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findMatch_2101__wm_d2 = (items_2102, expressionId_2103) => {
__wm_tail_100: while (true) {
{
const __wm_scalar_101_0 = items_2102;
const __wm_scalar_101_1 = expressionId_2103;
if (__wm_scalar_101_0 === __wm_basis_Nil) {
const expressionId_2104 = __wm_scalar_101_1;
return __wm_fail("Panic", "missing schema-v2 match");
} else if (__wm_scalar_101_0?.ctor === -6 && __wm_scalar_101_0.args.length === 1 && __wm_is_tuple(__wm_scalar_101_0.args[0]) && __wm_scalar_101_0.args[0].length === 2) {
const item_2105 = __wm_scalar_101_0.args[0][0];
const rest_2106 = __wm_scalar_101_0.args[0][1];
const expressionId_2107 = __wm_scalar_101_1;
{
const exact_2108 = item_2105;
if (numberEqual_2058__wm_d2(exact_2108.expressionId, expressionId_2107)) {
return exact_2108;
} else {
{
const __wm_tail_arg_116_0 = rest_2106;
const __wm_tail_arg_116_1 = expressionId_2107;
items_2102 = __wm_tail_arg_116_0;
expressionId_2103 = __wm_tail_arg_116_1;
continue __wm_tail_100;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findMatch_2101 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findMatch_2101__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findMatchArm_2109__wm_d2 = (items_2110, id_2111) => {
__wm_tail_101: while (true) {
{
const __wm_scalar_102_0 = items_2110;
const __wm_scalar_102_1 = id_2111;
if (__wm_scalar_102_0 === __wm_basis_Nil) {
const id_2112 = __wm_scalar_102_1;
return __wm_fail("Panic", "missing schema-v2 match arm");
} else if (__wm_scalar_102_0?.ctor === -6 && __wm_scalar_102_0.args.length === 1 && __wm_is_tuple(__wm_scalar_102_0.args[0]) && __wm_scalar_102_0.args[0].length === 2) {
const item_2113 = __wm_scalar_102_0.args[0][0];
const rest_2114 = __wm_scalar_102_0.args[0][1];
const id_2115 = __wm_scalar_102_1;
{
const exact_2116 = item_2113;
if (numberEqual_2058__wm_d2(exact_2116.id, id_2115)) {
return exact_2116;
} else {
{
const __wm_tail_arg_117_0 = rest_2114;
const __wm_tail_arg_117_1 = id_2115;
items_2110 = __wm_tail_arg_117_0;
id_2111 = __wm_tail_arg_117_1;
continue __wm_tail_101;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findMatchArm_2109 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findMatchArm_2109__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findPattern_2117__wm_d2 = (items_2118, id_2119) => {
__wm_tail_102: while (true) {
{
const __wm_scalar_103_0 = items_2118;
const __wm_scalar_103_1 = id_2119;
if (__wm_scalar_103_0 === __wm_basis_Nil) {
const id_2120 = __wm_scalar_103_1;
return __wm_fail("Panic", "missing schema-v2 pattern");
} else if (__wm_scalar_103_0?.ctor === -6 && __wm_scalar_103_0.args.length === 1 && __wm_is_tuple(__wm_scalar_103_0.args[0]) && __wm_scalar_103_0.args[0].length === 2) {
const item_2121 = __wm_scalar_103_0.args[0][0];
const rest_2122 = __wm_scalar_103_0.args[0][1];
const id_2123 = __wm_scalar_103_1;
{
const exact_2124 = item_2121;
if (numberEqual_2058__wm_d2(exact_2124.id, id_2123)) {
return exact_2124;
} else {
{
const __wm_tail_arg_118_0 = rest_2122;
const __wm_tail_arg_118_1 = id_2123;
items_2118 = __wm_tail_arg_118_0;
id_2119 = __wm_tail_arg_118_1;
continue __wm_tail_102;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findPattern_2117 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findPattern_2117__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findType_2125__wm_d2 = (items_2126, id_2127) => {
__wm_tail_103: while (true) {
{
const __wm_scalar_104_0 = items_2126;
const __wm_scalar_104_1 = id_2127;
if (__wm_scalar_104_0 === __wm_basis_Nil) {
const id_2128 = __wm_scalar_104_1;
return __wm_fail("Panic", "missing schema-v2 type");
} else if (__wm_scalar_104_0?.ctor === -6 && __wm_scalar_104_0.args.length === 1 && __wm_is_tuple(__wm_scalar_104_0.args[0]) && __wm_scalar_104_0.args[0].length === 2) {
const item_2129 = __wm_scalar_104_0.args[0][0];
const rest_2130 = __wm_scalar_104_0.args[0][1];
const id_2131 = __wm_scalar_104_1;
{
const exact_2132 = item_2129;
if (numberEqual_2058__wm_d2(exact_2132.id, id_2131)) {
return exact_2132;
} else {
{
const __wm_tail_arg_119_0 = rest_2130;
const __wm_tail_arg_119_1 = id_2131;
items_2126 = __wm_tail_arg_119_0;
id_2127 = __wm_tail_arg_119_1;
continue __wm_tail_103;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findType_2125 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findType_2125__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findExpressionOccurrence_2133__wm_d2 = (items_2134, sourceId_2135) => {
__wm_tail_104: while (true) {
{
const __wm_scalar_105_0 = items_2134;
const __wm_scalar_105_1 = sourceId_2135;
if (__wm_scalar_105_0 === __wm_basis_Nil) {
const sourceId_2136 = __wm_scalar_105_1;
return __wm_fail("Panic", "missing schema-v2 expression type occurrence");
} else if (__wm_scalar_105_0?.ctor === -6 && __wm_scalar_105_0.args.length === 1 && __wm_is_tuple(__wm_scalar_105_0.args[0]) && __wm_scalar_105_0.args[0].length === 2) {
const item_2137 = __wm_scalar_105_0.args[0][0];
const rest_2138 = __wm_scalar_105_0.args[0][1];
const sourceId_2139 = __wm_scalar_105_1;
{
const exact_2140 = item_2137;
if (__wm_op_and_d2(__wm_eq(exact_2140.kind, "expression"), numberEqual_2058__wm_d2(exact_2140.sourceId, sourceId_2139))) {
return exact_2140;
} else {
{
const __wm_tail_arg_120_0 = rest_2138;
const __wm_tail_arg_120_1 = sourceId_2139;
items_2134 = __wm_tail_arg_120_0;
sourceId_2135 = __wm_tail_arg_120_1;
continue __wm_tail_104;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findExpressionOccurrence_2133 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findExpressionOccurrence_2133__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const shaderBuiltinTypeName_2150__wm_d2 = (source_2141, context_2142) => {
const occurrence_2143 = findExpressionOccurrence_2133__wm_d2(context_2142.occurrences, source_2141.id);
const typeId_2144 = occurrence_2143.shaderTypeId;
const gpuType_2145 = findType_2125__wm_d2(context_2142.types, typeId_2144);
if (__wm_eq(gpuType_2145.kind, "f32")) {
return "f32";
} else {
if (__wm_eq(gpuType_2145.kind, "i32")) {
return "i32";
} else {
if (__wm_eq(gpuType_2145.kind, "vector")) {
const items_2146 = Js.Array.toList(gpuType_2145.items);
const component_2148 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2) {
const first_2147 = __v.args[0][0];
return findType_2125__wm_d2(context_2142.types, first_2147);
} else if (__v === __wm_basis_Nil) {

return __wm_fail("Panic", "GPU builtin vector type is empty");
}
__wm_fail("Match", "non-exhaustive match");
})(items_2146);
const prefix_2149 = (__wm_eq(component_2148.kind, "i32") ? "i32x" : "f32x");
return (prefix_2149 + Text.of(listLength_2050__wm_d2(items_2146, 0)));
} else {
return "";
}
}
}
};
const shaderBuiltinTypeName_2150 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return shaderBuiltinTypeName_2150__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const builtinParamsMatch_2151__wm_d3 = (expected_2152, sourceIds_2153, context_2154) => {
const __wm_scalar_106_0 = expected_2152;
const __wm_scalar_106_1 = sourceIds_2153;
const __wm_scalar_106_2 = context_2154;
if (__wm_scalar_106_0 === __wm_basis_Nil && __wm_scalar_106_1 === __wm_basis_Nil) {
const context_2155 = __wm_scalar_106_2;
return true;
} else if (__wm_scalar_106_0?.ctor === -6 && __wm_scalar_106_0.args.length === 1 && __wm_is_tuple(__wm_scalar_106_0.args[0]) && __wm_scalar_106_0.args[0].length === 2 && __wm_scalar_106_1?.ctor === -6 && __wm_scalar_106_1.args.length === 1 && __wm_is_tuple(__wm_scalar_106_1.args[0]) && __wm_scalar_106_1.args[0].length === 2) {
const expectedType_2156 = __wm_scalar_106_0.args[0][0];
const expectedRest_2157 = __wm_scalar_106_0.args[0][1];
const sourceId_2158 = __wm_scalar_106_1.args[0][0];
const sourceRest_2159 = __wm_scalar_106_1.args[0][1];
const context_2160 = __wm_scalar_106_2;
const exactContext_2161 = context_2160;
const source_2162 = findExpression_2069__wm_d2(exactContext_2161.expressions, sourceId_2158);
return __wm_op_and_d2(__wm_eq(expectedType_2156, shaderBuiltinTypeName_2150__wm_d2(source_2162, exactContext_2161)), builtinParamsMatch_2151__wm_d3(expectedRest_2157, sourceRest_2159, exactContext_2161));
} else if (true) {
const context_2163 = __wm_scalar_106_2;
return false;
}
__wm_fail("Match", "non-exhaustive match");
};
const builtinParamsMatch_2151 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return builtinParamsMatch_2151__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const selectBuiltinOverload_2164__wm_d3 = (overloads_2165, source_2166, context_2167) => {
__wm_tail_105: while (true) {
{
const __wm_scalar_107_0 = overloads_2165;
const __wm_scalar_107_1 = source_2166;
const __wm_scalar_107_2 = context_2167;
if (__wm_scalar_107_0 === __wm_basis_Nil) {
const source_2168 = __wm_scalar_107_1;
const context_2169 = __wm_scalar_107_2;
return __wm_fail("Panic", "no exact pinned Slang builtin overload survived Workman GPU elaboration");
} else if (__wm_scalar_107_0?.ctor === -6 && __wm_scalar_107_0.args.length === 1 && __wm_is_tuple(__wm_scalar_107_0.args[0]) && __wm_scalar_107_0.args[0].length === 2) {
const overload_2170 = __wm_scalar_107_0.args[0][0];
const rest_2171 = __wm_scalar_107_0.args[0][1];
const source_2172 = __wm_scalar_107_1;
const context_2173 = __wm_scalar_107_2;
{
const exactOverload_2174 = overload_2170;
const exactSource_2175 = source_2172;
const exactContext_2176 = context_2173;
if (__wm_op_and_d2(__wm_op_and_d2(__wm_eq(exactOverload_2174.name, exactSource_2175.builtinName), __wm_eq(exactOverload_2174.result, shaderBuiltinTypeName_2150__wm_d2(exactSource_2175, exactContext_2176))), builtinParamsMatch_2151__wm_d3(Js.Array.toList(exactOverload_2174.params), Js.Array.toList(exactSource_2175.children), exactContext_2176))) {
return exactOverload_2174.id;
} else {
{
const __wm_tail_arg_121_0 = rest_2171;
const __wm_tail_arg_121_1 = exactSource_2175;
const __wm_tail_arg_121_2 = exactContext_2176;
overloads_2165 = __wm_tail_arg_121_0;
source_2166 = __wm_tail_arg_121_1;
context_2167 = __wm_tail_arg_121_2;
continue __wm_tail_105;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const selectBuiltinOverload_2164 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return selectBuiltinOverload_2164__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const collectBuiltinSelections_2177__wm_d3 = (expressions_2178, context_2179, selections_2180) => {
__wm_tail_106: while (true) {
{
const __wm_scalar_108_0 = expressions_2178;
const __wm_scalar_108_1 = context_2179;
const __wm_scalar_108_2 = selections_2180;
if (__wm_scalar_108_0 === __wm_basis_Nil) {
const context_2181 = __wm_scalar_108_1;
const selections_2182 = __wm_scalar_108_2;
return reverseInto_2036__wm_d2(selections_2182, __wm_basis_Nil);
} else if (__wm_scalar_108_0?.ctor === -6 && __wm_scalar_108_0.args.length === 1 && __wm_is_tuple(__wm_scalar_108_0.args[0]) && __wm_scalar_108_0.args[0].length === 2) {
const expression_2183 = __wm_scalar_108_0.args[0][0];
const rest_2184 = __wm_scalar_108_0.args[0][1];
const context_2185 = __wm_scalar_108_1;
const selections_2186 = __wm_scalar_108_2;
{
const exactExpression_2187 = expression_2183;
const exactContext_2188 = context_2185;
if (__wm_eq(exactExpression_2187.kind, "builtin")) {
{
const selection_2189 = { expressionId: exactExpression_2187.id, overloadId: selectBuiltinOverload_2164__wm_d3(exactContext_2188.builtinOverloads, exactExpression_2187, exactContext_2188) };
{
const __wm_tail_arg_122_0 = rest_2184;
const __wm_tail_arg_122_1 = exactContext_2188;
const __wm_tail_arg_122_2 = __wm_basis_Cons([selection_2189, selections_2186]);
expressions_2178 = __wm_tail_arg_122_0;
context_2179 = __wm_tail_arg_122_1;
selections_2180 = __wm_tail_arg_122_2;
continue __wm_tail_106;
}
}
} else {
{
const __wm_tail_arg_123_0 = rest_2184;
const __wm_tail_arg_123_1 = exactContext_2188;
const __wm_tail_arg_123_2 = selections_2186;
expressions_2178 = __wm_tail_arg_123_0;
context_2179 = __wm_tail_arg_123_1;
selections_2180 = __wm_tail_arg_123_2;
continue __wm_tail_106;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const collectBuiltinSelections_2177 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return collectBuiltinSelections_2177__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const allSemanticNumbers_2190__wm_d2 = (typeIds_2191, types_2192) => {
const __wm_scalar_109_0 = typeIds_2191;
const __wm_scalar_109_1 = types_2192;
if (__wm_scalar_109_0 === __wm_basis_Nil) {
const types_2193 = __wm_scalar_109_1;
return true;
} else if (__wm_scalar_109_0?.ctor === -6 && __wm_scalar_109_0.args.length === 1 && __wm_is_tuple(__wm_scalar_109_0.args[0]) && __wm_scalar_109_0.args[0].length === 2) {
const typeId_2194 = __wm_scalar_109_0.args[0][0];
const rest_2195 = __wm_scalar_109_0.args[0][1];
const types_2196 = __wm_scalar_109_1;
const gpuType_2197 = findType_2125__wm_d2(types_2196, typeId_2194);
return __wm_op_and_d2(__wm_eq(gpuType_2197.kind, "number"), allSemanticNumbers_2190__wm_d2(rest_2195, types_2196));
}
__wm_fail("Match", "non-exhaustive match");
};
const allSemanticNumbers_2190 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return allSemanticNumbers_2190__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const shaderTypeKind_2202__wm_d2 = (source_2198, types_2199) => {
if (__wm_eq(source_2198.kind, "number")) {
return "f32";
} else {
if (__wm_eq(source_2198.kind, "tuple")) {
const items_2200 = Js.Array.toList(source_2198.items);
const width_2201 = listLength_2050__wm_d2(items_2200, 0);
if (__wm_op_and_d2(__wm_op_and_d2((width_2201 >= 2), (width_2201 <= 4)), allSemanticNumbers_2190__wm_d2(items_2200, types_2199))) {
return "vector";
} else {
return "tuple";
}
} else {
return source_2198.kind;
}
}
};
const shaderTypeKind_2202 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return shaderTypeKind_2202__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const shaderTypeReason_2205__wm_d2 = (semanticKind_2203, shaderKind_2204) => {
if (__wm_eq(semanticKind_2203, "number")) {
return "shader-number-f32";
} else {
if (__wm_eq(semanticKind_2203, "tuple")) {
if (__wm_eq(shaderKind_2204, "vector")) {
return "homogeneous-numeric-tuple-default";
} else {
return "semantic-product";
}
} else {
return "semantic-shape";
}
}
};
const shaderTypeReason_2205 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return shaderTypeReason_2205__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const offsetTypeIds_2206__wm_d3 = (typeIds_2207, offset_2208, output_2209) => {
__wm_tail_107: while (true) {
{
const __wm_scalar_110_0 = typeIds_2207;
const __wm_scalar_110_1 = offset_2208;
const __wm_scalar_110_2 = output_2209;
if (__wm_scalar_110_0 === __wm_basis_Nil) {
const offset_2210 = __wm_scalar_110_1;
const output_2211 = __wm_scalar_110_2;
return reverseInto_2036__wm_d2(output_2211, __wm_basis_Nil);
} else if (__wm_scalar_110_0?.ctor === -6 && __wm_scalar_110_0.args.length === 1 && __wm_is_tuple(__wm_scalar_110_0.args[0]) && __wm_scalar_110_0.args[0].length === 2) {
const typeId_2212 = __wm_scalar_110_0.args[0][0];
const rest_2213 = __wm_scalar_110_0.args[0][1];
const offset_2214 = __wm_scalar_110_1;
const output_2215 = __wm_scalar_110_2;
{
const __wm_tail_arg_124_0 = rest_2213;
const __wm_tail_arg_124_1 = offset_2214;
const __wm_tail_arg_124_2 = __wm_basis_Cons([(offset_2214 + typeId_2212), output_2215]);
typeIds_2207 = __wm_tail_arg_124_0;
offset_2208 = __wm_tail_arg_124_1;
output_2209 = __wm_tail_arg_124_2;
continue __wm_tail_107;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const offsetTypeIds_2206 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return offsetTypeIds_2206__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const addI32ShaderTypes_2216__wm_d4 = (sourceTypes_2217, allTypes_2218, offset_2219, output_2220) => {
__wm_tail_108: while (true) {
{
const __wm_scalar_111_0 = sourceTypes_2217;
const __wm_scalar_111_1 = allTypes_2218;
const __wm_scalar_111_2 = offset_2219;
const __wm_scalar_111_3 = output_2220;
if (__wm_scalar_111_0 === __wm_basis_Nil) {
const allTypes_2221 = __wm_scalar_111_1;
const offset_2222 = __wm_scalar_111_2;
const output_2223 = __wm_scalar_111_3;
return reverseInto_2036__wm_d2(output_2223, __wm_basis_Nil);
} else if (__wm_scalar_111_0?.ctor === -6 && __wm_scalar_111_0.args.length === 1 && __wm_is_tuple(__wm_scalar_111_0.args[0]) && __wm_scalar_111_0.args[0].length === 2) {
const source_2224 = __wm_scalar_111_0.args[0][0];
const rest_2225 = __wm_scalar_111_0.args[0][1];
const allTypes_2226 = __wm_scalar_111_1;
const offset_2227 = __wm_scalar_111_2;
const output_2228 = __wm_scalar_111_3;
{
const items_2229 = Js.Array.toList(source_2224.items);
const width_2230 = listLength_2050__wm_d2(items_2229, 0);
const numericVector_2231 = __wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(__wm_eq(source_2224.kind, "tuple"), (width_2230 >= 2)), (width_2230 <= 4)), allSemanticNumbers_2190__wm_d2(items_2229, allTypes_2226));
if (__wm_op_or_d2(__wm_eq(source_2224.kind, "number"), numericVector_2231)) {
{
const clone_2232 = { ...source_2224, id: (offset_2227 + source_2224.id), kind: (__wm_eq(source_2224.kind, "number") ? "i32" : "vector"), items: (numericVector_2231 ? Js.Array.fromList(offsetTypeIds_2206__wm_d3(items_2229, offset_2227, __wm_basis_Nil)) : source_2224.items) };
{
const __wm_tail_arg_125_0 = rest_2225;
const __wm_tail_arg_125_1 = allTypes_2226;
const __wm_tail_arg_125_2 = offset_2227;
const __wm_tail_arg_125_3 = __wm_basis_Cons([clone_2232, output_2228]);
sourceTypes_2217 = __wm_tail_arg_125_0;
allTypes_2218 = __wm_tail_arg_125_1;
offset_2219 = __wm_tail_arg_125_2;
output_2220 = __wm_tail_arg_125_3;
continue __wm_tail_108;
}
}
} else {
{
const __wm_tail_arg_126_0 = rest_2225;
const __wm_tail_arg_126_1 = allTypes_2226;
const __wm_tail_arg_126_2 = offset_2227;
const __wm_tail_arg_126_3 = output_2228;
sourceTypes_2217 = __wm_tail_arg_126_0;
allTypes_2218 = __wm_tail_arg_126_1;
offset_2219 = __wm_tail_arg_126_2;
output_2220 = __wm_tail_arg_126_3;
continue __wm_tail_108;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addI32ShaderTypes_2216 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return addI32ShaderTypes_2216__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const concreteShaderTypeId_2240__wm_d4 = (semanticTypeId_2233, representation_2234, offset_2235, types_2236) => {
if (__wm_eq(representation_2234, "i32")) {
const source_2237 = findType_2125__wm_d2(types_2236, semanticTypeId_2233);
const items_2238 = Js.Array.toList(source_2237.items);
const width_2239 = listLength_2050__wm_d2(items_2238, 0);
if (__wm_op_or_d2(__wm_eq(source_2237.kind, "number"), __wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(__wm_eq(source_2237.kind, "tuple"), (width_2239 >= 2)), (width_2239 <= 4)), allSemanticNumbers_2190__wm_d2(items_2238, types_2236)))) {
return (offset_2235 + semanticTypeId_2233);
} else {
return semanticTypeId_2233;
}
} else {
return semanticTypeId_2233;
}
};
const concreteShaderTypeId_2240 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return concreteShaderTypeId_2240__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const elaborateSliceTypes_2241__wm_d4 = (sourceTypes_2242, allTypes_2243, shaderTypes_2244, evidence_2245) => {
__wm_tail_109: while (true) {
{
const __wm_scalar_112_0 = sourceTypes_2242;
const __wm_scalar_112_1 = allTypes_2243;
const __wm_scalar_112_2 = shaderTypes_2244;
const __wm_scalar_112_3 = evidence_2245;
if (__wm_scalar_112_0 === __wm_basis_Nil) {
const allTypes_2246 = __wm_scalar_112_1;
const shaderTypes_2247 = __wm_scalar_112_2;
const evidence_2248 = __wm_scalar_112_3;
return [reverseInto_2036__wm_d2(shaderTypes_2247, __wm_basis_Nil), reverseInto_2036__wm_d2(evidence_2248, __wm_basis_Nil)];
} else if (__wm_scalar_112_0?.ctor === -6 && __wm_scalar_112_0.args.length === 1 && __wm_is_tuple(__wm_scalar_112_0.args[0]) && __wm_scalar_112_0.args[0].length === 2) {
const source_2249 = __wm_scalar_112_0.args[0][0];
const rest_2250 = __wm_scalar_112_0.args[0][1];
const allTypes_2251 = __wm_scalar_112_1;
const shaderTypes_2252 = __wm_scalar_112_2;
const evidence_2253 = __wm_scalar_112_3;
{
const exactSource_2254 = source_2249;
const shaderKind_2255 = shaderTypeKind_2202__wm_d2(exactSource_2254, allTypes_2251);
const shaderType_2256 = { ...exactSource_2254, kind: shaderKind_2255 };
const typeEvidence_2257 = { typeId: exactSource_2254.id, semanticKind: exactSource_2254.kind, shaderKind: shaderKind_2255, reason: shaderTypeReason_2205__wm_d2(exactSource_2254.kind, shaderKind_2255) };
{
const __wm_tail_arg_127_0 = rest_2250;
const __wm_tail_arg_127_1 = allTypes_2251;
const __wm_tail_arg_127_2 = __wm_basis_Cons([shaderType_2256, shaderTypes_2252]);
const __wm_tail_arg_127_3 = __wm_basis_Cons([typeEvidence_2257, evidence_2253]);
sourceTypes_2242 = __wm_tail_arg_127_0;
allTypes_2243 = __wm_tail_arg_127_1;
shaderTypes_2244 = __wm_tail_arg_127_2;
evidence_2245 = __wm_tail_arg_127_3;
continue __wm_tail_109;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const elaborateSliceTypes_2241 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return elaborateSliceTypes_2241__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const addExpressionOccurrences_2258__wm_d5 = (expressions_2259, representations_2260, typeOffset_2261, types_2262, occurrences_2263) => {
__wm_tail_110: while (true) {
{
const __wm_scalar_113_0 = expressions_2259;
const __wm_scalar_113_1 = representations_2260;
const __wm_scalar_113_2 = typeOffset_2261;
const __wm_scalar_113_3 = types_2262;
const __wm_scalar_113_4 = occurrences_2263;
if (__wm_scalar_113_0 === __wm_basis_Nil) {
const representations_2264 = __wm_scalar_113_1;
const typeOffset_2265 = __wm_scalar_113_2;
const types_2266 = __wm_scalar_113_3;
const occurrences_2267 = __wm_scalar_113_4;
return occurrences_2267;
} else if (__wm_scalar_113_0?.ctor === -6 && __wm_scalar_113_0.args.length === 1 && __wm_is_tuple(__wm_scalar_113_0.args[0]) && __wm_scalar_113_0.args[0].length === 2) {
const expression_2268 = __wm_scalar_113_0.args[0][0];
const rest_2269 = __wm_scalar_113_0.args[0][1];
const representations_2270 = __wm_scalar_113_1;
const typeOffset_2271 = __wm_scalar_113_2;
const types_2272 = __wm_scalar_113_3;
const occurrences_2273 = __wm_scalar_113_4;
{
const exactExpression_2274 = expression_2268;
const concreteRepresentation_2275 = expressionRepresentation_2028__wm_d2(representations_2270, exactExpression_2274.id);
const occurrence_2276 = { kind: "expression", sourceId: exactExpression_2274.id, typeId: exactExpression_2274.typeId, shaderTypeId: concreteShaderTypeId_2240__wm_d4(exactExpression_2274.typeId, concreteRepresentation_2275, typeOffset_2271, types_2272), spanId: exactExpression_2274.spanId, representationEvidence: exactExpression_2274.numberKind, representation: concreteRepresentation_2275 };
{
const __wm_tail_arg_128_0 = rest_2269;
const __wm_tail_arg_128_1 = representations_2270;
const __wm_tail_arg_128_2 = typeOffset_2271;
const __wm_tail_arg_128_3 = types_2272;
const __wm_tail_arg_128_4 = __wm_basis_Cons([occurrence_2276, occurrences_2273]);
expressions_2259 = __wm_tail_arg_128_0;
representations_2260 = __wm_tail_arg_128_1;
typeOffset_2261 = __wm_tail_arg_128_2;
types_2262 = __wm_tail_arg_128_3;
occurrences_2263 = __wm_tail_arg_128_4;
continue __wm_tail_110;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addExpressionOccurrences_2258 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return addExpressionOccurrences_2258__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const addPatternOccurrences_2277__wm_d6 = (patterns_2278, expressionCount_2279, representations_2280, typeOffset_2281, types_2282, occurrences_2283) => {
__wm_tail_111: while (true) {
{
const __wm_scalar_114_0 = patterns_2278;
const __wm_scalar_114_1 = expressionCount_2279;
const __wm_scalar_114_2 = representations_2280;
const __wm_scalar_114_3 = typeOffset_2281;
const __wm_scalar_114_4 = types_2282;
const __wm_scalar_114_5 = occurrences_2283;
if (__wm_scalar_114_0 === __wm_basis_Nil) {
const expressionCount_2284 = __wm_scalar_114_1;
const representations_2285 = __wm_scalar_114_2;
const typeOffset_2286 = __wm_scalar_114_3;
const types_2287 = __wm_scalar_114_4;
const occurrences_2288 = __wm_scalar_114_5;
return occurrences_2288;
} else if (__wm_scalar_114_0?.ctor === -6 && __wm_scalar_114_0.args.length === 1 && __wm_is_tuple(__wm_scalar_114_0.args[0]) && __wm_scalar_114_0.args[0].length === 2) {
const pattern_2289 = __wm_scalar_114_0.args[0][0];
const rest_2290 = __wm_scalar_114_0.args[0][1];
const expressionCount_2291 = __wm_scalar_114_1;
const representations_2292 = __wm_scalar_114_2;
const typeOffset_2293 = __wm_scalar_114_3;
const types_2294 = __wm_scalar_114_4;
const occurrences_2295 = __wm_scalar_114_5;
{
const exactPattern_2296 = pattern_2289;
const concreteRepresentation_2297 = patternRepresentation_2032__wm_d3(representations_2292, expressionCount_2291, exactPattern_2296.id);
const occurrence_2298 = { kind: "pattern", sourceId: exactPattern_2296.id, typeId: exactPattern_2296.typeId, shaderTypeId: concreteShaderTypeId_2240__wm_d4(exactPattern_2296.typeId, concreteRepresentation_2297, typeOffset_2293, types_2294), spanId: exactPattern_2296.spanId, representationEvidence: "", representation: concreteRepresentation_2297 };
{
const __wm_tail_arg_129_0 = rest_2290;
const __wm_tail_arg_129_1 = expressionCount_2291;
const __wm_tail_arg_129_2 = representations_2292;
const __wm_tail_arg_129_3 = typeOffset_2293;
const __wm_tail_arg_129_4 = types_2294;
const __wm_tail_arg_129_5 = __wm_basis_Cons([occurrence_2298, occurrences_2295]);
patterns_2278 = __wm_tail_arg_129_0;
expressionCount_2279 = __wm_tail_arg_129_1;
representations_2280 = __wm_tail_arg_129_2;
typeOffset_2281 = __wm_tail_arg_129_3;
types_2282 = __wm_tail_arg_129_4;
occurrences_2283 = __wm_tail_arg_129_5;
continue __wm_tail_111;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addPatternOccurrences_2277 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return addPatternOccurrences_2277__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const addFunctionOccurrences_2299__wm_d2 = (functions_2300, occurrences_2301) => {
__wm_tail_112: while (true) {
{
const __wm_scalar_115_0 = functions_2300;
const __wm_scalar_115_1 = occurrences_2301;
if (__wm_scalar_115_0 === __wm_basis_Nil) {
const occurrences_2302 = __wm_scalar_115_1;
return occurrences_2302;
} else if (__wm_scalar_115_0?.ctor === -6 && __wm_scalar_115_0.args.length === 1 && __wm_is_tuple(__wm_scalar_115_0.args[0]) && __wm_scalar_115_0.args[0].length === 2) {
const fn_2303 = __wm_scalar_115_0.args[0][0];
const rest_2304 = __wm_scalar_115_0.args[0][1];
const occurrences_2305 = __wm_scalar_115_1;
{
const exactFunction_2306 = fn_2303;
const occurrence_2307 = { kind: "function", sourceId: exactFunction_2306.id, typeId: exactFunction_2306.typeId, shaderTypeId: exactFunction_2306.typeId, spanId: exactFunction_2306.spanId, representationEvidence: "", representation: "" };
{
const __wm_tail_arg_130_0 = rest_2304;
const __wm_tail_arg_130_1 = __wm_basis_Cons([occurrence_2307, occurrences_2305]);
functions_2300 = __wm_tail_arg_130_0;
occurrences_2301 = __wm_tail_arg_130_1;
continue __wm_tail_112;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addFunctionOccurrences_2299 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addFunctionOccurrences_2299__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const elaborateSliceProgramTypes_2322 = (__arg) => {
if (true) {
const input_2308 = __arg;
const semanticTypes_2309 = Js.Array.toList(input_2308.types);
const __wm_bind_76 = elaborateSliceTypes_2241__wm_d4(semanticTypes_2309, semanticTypes_2309, __wm_basis_Nil, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_76) && __wm_bind_76.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const shaderTypeItems_2310 = __wm_bind_76[0];
const typeEvidenceItems_2311 = __wm_bind_76[1];
const typeOffset_2312 = listLength_2050__wm_d2(semanticTypes_2309, 0);
const allShaderTypeItems_2313 = append_2043__wm_d2(shaderTypeItems_2310, addI32ShaderTypes_2216__wm_d4(semanticTypes_2309, semanticTypes_2309, typeOffset_2312, __wm_basis_Nil));
const expressionItems_2314 = Js.Array.toList(input_2308.expressions);
const numericRepresentations_2315 = solveSliceNumericRepresentations_2025(input_2308);
const withExpressions_2316 = addExpressionOccurrences_2258__wm_d5(expressionItems_2314, numericRepresentations_2315, typeOffset_2312, semanticTypes_2309, __wm_basis_Nil);
const withPatterns_2317 = addPatternOccurrences_2277__wm_d6(Js.Array.toList(input_2308.patterns), listLength_2050__wm_d2(expressionItems_2314, 0), numericRepresentations_2315, typeOffset_2312, semanticTypes_2309, withExpressions_2316);
const occurrenceItems_2318 = reverseInto_2036__wm_d2(addFunctionOccurrences_2299__wm_d2(Js.Array.toList(input_2308.functions), withPatterns_2317), __wm_basis_Nil);
const builtinCatalog_2319 = input_2308.builtinCatalog;
const typeContext_2320 = { expressions: Js.Array.toList(input_2308.expressions), blocks: Js.Array.toList(input_2308.blocks), blockItems: Js.Array.toList(input_2308.blockItems), lets: Js.Array.toList(input_2308.lets), matches: Js.Array.toList(input_2308.matches), matchArms: Js.Array.toList(input_2308.matchArms), patterns: Js.Array.toList(input_2308.patterns), types: allShaderTypeItems_2313, adts: Js.Array.toList(input_2308.adts), functions: Js.Array.toList(input_2308.functions), builtinOverloads: Js.Array.toList(builtinCatalog_2319.overloads), occurrences: occurrenceItems_2318 };
const output_2321 = { schemaVersion: 5, shaderTypes: Js.Array.fromList(allShaderTypeItems_2313), typeEvidence: Js.Array.fromList(typeEvidenceItems_2311), occurrences: Js.Array.fromList(occurrenceItems_2318), builtinSelections: Js.Array.fromList(collectBuiltinSelections_2177__wm_d3(Js.Array.toList(input_2308.expressions), typeContext_2320, __wm_basis_Nil)) };
return output_2321;
}
__wm_fail("Match", "pattern match failure in function");
};
const findAdt_2323__wm_d2 = (items_2324, typeNameId_2325) => {
__wm_tail_113: while (true) {
{
const __wm_scalar_116_0 = items_2324;
const __wm_scalar_116_1 = typeNameId_2325;
if (__wm_scalar_116_0 === __wm_basis_Nil) {
const typeNameId_2326 = __wm_scalar_116_1;
return __wm_fail("Panic", "missing schema-v2 ADT");
} else if (__wm_scalar_116_0?.ctor === -6 && __wm_scalar_116_0.args.length === 1 && __wm_is_tuple(__wm_scalar_116_0.args[0]) && __wm_scalar_116_0.args[0].length === 2) {
const item_2327 = __wm_scalar_116_0.args[0][0];
const rest_2328 = __wm_scalar_116_0.args[0][1];
const typeNameId_2329 = __wm_scalar_116_1;
{
const exact_2330 = item_2327;
if (numberEqual_2058__wm_d2(exact_2330.typeNameId, typeNameId_2329)) {
return exact_2330;
} else {
{
const __wm_tail_arg_131_0 = rest_2328;
const __wm_tail_arg_131_1 = typeNameId_2329;
items_2324 = __wm_tail_arg_131_0;
typeNameId_2325 = __wm_tail_arg_131_1;
continue __wm_tail_113;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findAdt_2323 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findAdt_2323__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findFunction_2331__wm_d2 = (items_2332, id_2333) => {
__wm_tail_114: while (true) {
{
const __wm_scalar_117_0 = items_2332;
const __wm_scalar_117_1 = id_2333;
if (__wm_scalar_117_0 === __wm_basis_Nil) {
const id_2334 = __wm_scalar_117_1;
return __wm_fail("Panic", "missing schema-v2 function");
} else if (__wm_scalar_117_0?.ctor === -6 && __wm_scalar_117_0.args.length === 1 && __wm_is_tuple(__wm_scalar_117_0.args[0]) && __wm_scalar_117_0.args[0].length === 2) {
const item_2335 = __wm_scalar_117_0.args[0][0];
const rest_2336 = __wm_scalar_117_0.args[0][1];
const id_2337 = __wm_scalar_117_1;
{
const exact_2338 = item_2335;
if (numberEqual_2058__wm_d2(exact_2338.id, id_2337)) {
return exact_2338;
} else {
{
const __wm_tail_arg_132_0 = rest_2336;
const __wm_tail_arg_132_1 = id_2337;
items_2332 = __wm_tail_arg_132_0;
id_2333 = __wm_tail_arg_132_1;
continue __wm_tail_114;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findFunction_2331 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findFunction_2331__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const initialState_2340 = (__arg) => {
if (__arg === undefined) {

const state_2339 = { nextExpressionId: 0, nextArmId: 0, functions: __wm_basis_Nil, expressions: __wm_basis_Nil, matchArms: __wm_basis_Nil, diagnostics: __wm_basis_Nil };
return state_2339;
}
__wm_fail("Match", "pattern match failure in function");
};
const baseIrExpression_2346__wm_d4 = (state_2341, source_2342, functionId_2343, kind_2344) => {
const expression_2345 = { id: state_2341.nextExpressionId, functionId: functionId_2343, sourceExprId: source_2342.id, kind: kind_2344, typeId: source_2342.typeId, spanId: source_2342.spanId, bindingId: (__wm_eq(source_2342.kind, "var") ? source_2342.bindingId : __wm_op_sub(1)), patternId: __wm_op_sub(1), targetFunctionId: (__wm_eq(source_2342.kind, "call") ? source_2342.functionId : __wm_op_sub(1)), constructorId: (__wm_eq(source_2342.kind, "constructor") ? source_2342.constructorId : __wm_op_sub(1)), semanticId: source_2342.semanticId, operatorId: source_2342.operatorId, builtinName: source_2342.builtinName, builtinOverloadId: __wm_op_sub(1), resourceOperation: source_2342.resourceOperation, numberValue: source_2342.numberValue, numberKind: source_2342.numberKind, boolValue: source_2342.boolValue, index: source_2342.index, children: Js.Array.fromList(__wm_basis_Nil), armIds: Js.Array.fromList(__wm_basis_Nil) };
return expression_2345;
};
const baseIrExpression_2346 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return baseIrExpression_2346__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const addExpression_2350__wm_d2 = (expression_2347, state_2348) => {
const next_2349 = { ...state_2348, nextExpressionId: (state_2348.nextExpressionId + 1), expressions: __wm_basis_Cons([expression_2347, state_2348.expressions]) };
return [expression_2347.id, next_2349];
};
const addExpression_2350 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addExpression_2350__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const addDiagnostic_2354__wm_d2 = (diagnostic_2351, state_2352) => {
const next_2353 = { ...state_2352, diagnostics: __wm_basis_Cons([diagnostic_2351, state_2352.diagnostics]) };
return next_2353;
};
const addDiagnostic_2354 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addDiagnostic_2354__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const nonTailDiagnostic_2359__wm_d2 = (source_2355, fn_2356) => {
const declaration_2357 = { spanId: fn_2356.spanId, label: "recursive function declared here" };
const diagnostic_2358 = { code: "gpu.recursion.non-tail", message: "direct self-recursion is allowed only in function, if, match, or block-result tail position", spanId: source_2355.spanId, related: Js.Array.fromList(__wm_basis_Cons([declaration_2357, __wm_basis_Nil])) };
return diagnostic_2358;
};
const nonTailDiagnostic_2359 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return nonTailDiagnostic_2359__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const nonExhaustiveDiagnostic_2362 = (__arg) => {
if (true) {
const source_2360 = __arg;
const diagnostic_2361 = { code: "gpu.pattern.non-exhaustive", message: "v1 GPU matches require exactly one arm for every constructor", spanId: source_2360.spanId, related: Js.Array.fromList(__wm_basis_Nil) };
return diagnostic_2361;
}
__wm_fail("Match", "pattern match failure in function");
};
const constructorPatterns_2363__wm_d4 = (armIds_2364, context_2365, constructors_2366, valid_2367) => {
__wm_tail_115: while (true) {
{
const __wm_scalar_118_0 = armIds_2364;
const __wm_scalar_118_1 = context_2365;
const __wm_scalar_118_2 = constructors_2366;
const __wm_scalar_118_3 = valid_2367;
if (__wm_scalar_118_0 === __wm_basis_Nil) {
const context_2368 = __wm_scalar_118_1;
const constructors_2369 = __wm_scalar_118_2;
const valid_2370 = __wm_scalar_118_3;
return [constructors_2369, valid_2370];
} else if (__wm_scalar_118_0?.ctor === -6 && __wm_scalar_118_0.args.length === 1 && __wm_is_tuple(__wm_scalar_118_0.args[0]) && __wm_scalar_118_0.args[0].length === 2) {
const armId_2371 = __wm_scalar_118_0.args[0][0];
const rest_2372 = __wm_scalar_118_0.args[0][1];
const context_2373 = __wm_scalar_118_1;
const constructors_2374 = __wm_scalar_118_2;
const valid_2375 = __wm_scalar_118_3;
{
const exactContext_2376 = context_2373;
const arm_2377 = findMatchArm_2109__wm_d2(exactContext_2376.matchArms, armId_2371);
const pattern_2378 = findPattern_2117__wm_d2(exactContext_2376.patterns, arm_2377.patternId);
if (__wm_eq(pattern_2378.kind, "constructor")) {
{
const __wm_tail_arg_133_0 = rest_2372;
const __wm_tail_arg_133_1 = exactContext_2376;
const __wm_tail_arg_133_2 = __wm_basis_Cons([pattern_2378.constructorId, constructors_2374]);
const __wm_tail_arg_133_3 = valid_2375;
armIds_2364 = __wm_tail_arg_133_0;
context_2365 = __wm_tail_arg_133_1;
constructors_2366 = __wm_tail_arg_133_2;
valid_2367 = __wm_tail_arg_133_3;
continue __wm_tail_115;
}
} else {
{
const __wm_tail_arg_134_0 = rest_2372;
const __wm_tail_arg_134_1 = exactContext_2376;
const __wm_tail_arg_134_2 = constructors_2374;
const __wm_tail_arg_134_3 = false;
armIds_2364 = __wm_tail_arg_134_0;
context_2365 = __wm_tail_arg_134_1;
constructors_2366 = __wm_tail_arg_134_2;
valid_2367 = __wm_tail_arg_134_3;
continue __wm_tail_115;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const constructorPatterns_2363 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return constructorPatterns_2363__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const matchIsExhaustive_2379__wm_d3 = (source_2381, row_2382, context_2383) => {
const value_2384 = findExpression_2069__wm_d2(context_2383.expressions, row_2382.valueExprId);
const valueType_2385 = findType_2125__wm_d2(context_2383.types, value_2384.typeId);
if (__wm_eq(valueType_2385.kind, "adt")) {
const adt_2386 = findAdt_2323__wm_d2(context_2383.adts, valueType_2385.typeNameId);
const __wm_bind_77 = constructorPatterns_2363__wm_d4(Js.Array.toList(row_2382.armIds), context_2383, __wm_basis_Nil, true);
if (!(__wm_is_tuple(__wm_bind_77) && __wm_bind_77.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const constructors_2387 = __wm_bind_77[0];
const valid_2388 = __wm_bind_77[1];
return __wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(valid_2388, unique_2064__wm_d2(constructors_2387, __wm_basis_Nil)), numberEqual_2058__wm_d2(listLength_2050__wm_d2(constructors_2387, 0), listLength_2050__wm_d2(Js.Array.toList(adt_2386.constructorIds), 0))), constructorSetContains_2380__wm_d2(Js.Array.toList(adt_2386.constructorIds), constructors_2387));
} else {
return false;
}
};
const matchIsExhaustive_2379 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return matchIsExhaustive_2379__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const constructorSetContains_2380__wm_d2 = (expected_2389, actual_2390) => {
const __wm_scalar_119_0 = expected_2389;
const __wm_scalar_119_1 = actual_2390;
if (__wm_scalar_119_0 === __wm_basis_Nil) {
const actual_2391 = __wm_scalar_119_1;
return true;
} else if (__wm_scalar_119_0?.ctor === -6 && __wm_scalar_119_0.args.length === 1 && __wm_is_tuple(__wm_scalar_119_0.args[0]) && __wm_scalar_119_0.args[0].length === 2) {
const head_2392 = __wm_scalar_119_0.args[0][0];
const rest_2393 = __wm_scalar_119_0.args[0][1];
const actual_2394 = __wm_scalar_119_1;
return __wm_op_and_d2(contains_2059__wm_d2(actual_2394, head_2392), constructorSetContains_2380__wm_d2(rest_2393, actual_2394));
}
__wm_fail("Match", "non-exhaustive match");
};
const constructorSetContains_2380 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return constructorSetContains_2380__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const buildExpression_2395__wm_d5 = (sourceId_2403, functionId_2404, tailPosition_2405, context_2406, state_2407) => {
const source_2408 = findExpression_2069__wm_d2(context_2406.expressions, sourceId_2403);
if (__wm_eq(source_2408.kind, "block")) {
return buildBlock_2400__wm_d5(source_2408, functionId_2404, tailPosition_2405, context_2406, state_2407);
} else {
if (__wm_eq(source_2408.kind, "if")) {
return buildIf_2397__wm_d5(source_2408, functionId_2404, tailPosition_2405, context_2406, state_2407);
} else {
if (__wm_eq(source_2408.kind, "match")) {
return buildMatch_2398__wm_d5(source_2408, functionId_2404, tailPosition_2405, context_2406, state_2407);
} else {
const selfCall_2409 = __wm_op_and_d2(__wm_eq(source_2408.kind, "call"), numberEqual_2058__wm_d2(source_2408.functionId, functionId_2404));
const kind_2410 = (__wm_op_and_d2(selfCall_2409, tailPosition_2405) ? "tail-call" : (__wm_eq(source_2408.kind, "var") ? "local" : source_2408.kind));
const diagnosed_2411 = (__wm_op_and_d2(selfCall_2409, __wm_op_not(tailPosition_2405)) ? addDiagnostic_2354__wm_d2(nonTailDiagnostic_2359__wm_d2(source_2408, findFunction_2331__wm_d2(context_2406.functions, functionId_2404)), state_2407) : state_2407);
const __wm_bind_78 = buildChildren_2396__wm_d5(Js.Array.toList(source_2408.children), functionId_2404, context_2406, diagnosed_2411, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_78) && __wm_bind_78.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const children_2412 = __wm_bind_78[0];
const withChildren_2413 = __wm_bind_78[1];
const expression_2414 = { ...baseIrExpression_2346__wm_d4(withChildren_2413, source_2408, functionId_2404, kind_2410), builtinOverloadId: (__wm_eq(source_2408.kind, "builtin") ? selectBuiltinOverload_2164__wm_d3(context_2406.builtinOverloads, source_2408, context_2406) : __wm_op_sub(1)), children: Js.Array.fromList(children_2412) };
return addExpression_2350__wm_d2(expression_2414, withChildren_2413);
}
}
}
};
const buildExpression_2395 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildExpression_2395__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildChildren_2396__wm_d5 = (sourceIds_2415, functionId_2416, context_2417, state_2418, reversed_2419) => {
__wm_tail_116: while (true) {
{
const __wm_scalar_120_0 = sourceIds_2415;
const __wm_scalar_120_1 = functionId_2416;
const __wm_scalar_120_2 = context_2417;
const __wm_scalar_120_3 = state_2418;
const __wm_scalar_120_4 = reversed_2419;
if (__wm_scalar_120_0 === __wm_basis_Nil) {
const functionId_2420 = __wm_scalar_120_1;
const context_2421 = __wm_scalar_120_2;
const state_2422 = __wm_scalar_120_3;
const reversed_2423 = __wm_scalar_120_4;
return [reverseInto_2036__wm_d2(reversed_2423, __wm_basis_Nil), state_2422];
} else if (__wm_scalar_120_0?.ctor === -6 && __wm_scalar_120_0.args.length === 1 && __wm_is_tuple(__wm_scalar_120_0.args[0]) && __wm_scalar_120_0.args[0].length === 2) {
const sourceId_2424 = __wm_scalar_120_0.args[0][0];
const rest_2425 = __wm_scalar_120_0.args[0][1];
const functionId_2426 = __wm_scalar_120_1;
const context_2427 = __wm_scalar_120_2;
const state_2428 = __wm_scalar_120_3;
const reversed_2429 = __wm_scalar_120_4;
{
const __wm_bind_79 = buildExpression_2395__wm_d5(sourceId_2424, functionId_2426, false, context_2427, state_2428);
if (!(__wm_is_tuple(__wm_bind_79) && __wm_bind_79.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const childId_2430 = __wm_bind_79[0];
const afterChild_2431 = __wm_bind_79[1];
{
const __wm_tail_arg_135_0 = rest_2425;
const __wm_tail_arg_135_1 = functionId_2426;
const __wm_tail_arg_135_2 = context_2427;
const __wm_tail_arg_135_3 = afterChild_2431;
const __wm_tail_arg_135_4 = __wm_basis_Cons([childId_2430, reversed_2429]);
sourceIds_2415 = __wm_tail_arg_135_0;
functionId_2416 = __wm_tail_arg_135_1;
context_2417 = __wm_tail_arg_135_2;
state_2418 = __wm_tail_arg_135_3;
reversed_2419 = __wm_tail_arg_135_4;
continue __wm_tail_116;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildChildren_2396 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildChildren_2396__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildIf_2397__wm_d5 = (source_2432, functionId_2433, tailPosition_2434, context_2435, state_2436) => {
const __wm_return_value_32 = Js.Array.toList(source_2432.children);
if (__wm_return_value_32?.ctor === -6 && __wm_return_value_32.args.length === 1 && __wm_is_tuple(__wm_return_value_32.args[0]) && __wm_return_value_32.args[0].length === 2 && __wm_return_value_32.args[0][1]?.ctor === -6 && __wm_return_value_32.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_32.args[0][1].args[0]) && __wm_return_value_32.args[0][1].args[0].length === 2 && __wm_return_value_32.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_32.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_32.args[0][1].args[0][1].args[0]) && __wm_return_value_32.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_32.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const conditionId_2437 = __wm_return_value_32.args[0][0];
const thenId_2438 = __wm_return_value_32.args[0][1].args[0][0];
const elseId_2439 = __wm_return_value_32.args[0][1].args[0][1].args[0][0];
const __wm_bind_80 = buildExpression_2395__wm_d5(conditionId_2437, functionId_2433, false, context_2435, state_2436);
if (!(__wm_is_tuple(__wm_bind_80) && __wm_bind_80.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const conditionIr_2440 = __wm_bind_80[0];
const afterCondition_2441 = __wm_bind_80[1];
const __wm_bind_81 = buildExpression_2395__wm_d5(thenId_2438, functionId_2433, tailPosition_2434, context_2435, afterCondition_2441);
if (!(__wm_is_tuple(__wm_bind_81) && __wm_bind_81.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const thenIr_2442 = __wm_bind_81[0];
const afterThen_2443 = __wm_bind_81[1];
const __wm_bind_82 = buildExpression_2395__wm_d5(elseId_2439, functionId_2433, tailPosition_2434, context_2435, afterThen_2443);
if (!(__wm_is_tuple(__wm_bind_82) && __wm_bind_82.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const elseIr_2444 = __wm_bind_82[0];
const afterElse_2445 = __wm_bind_82[1];
const expression_2446 = { ...baseIrExpression_2346__wm_d4(afterElse_2445, source_2432, functionId_2433, "if"), children: Js.Array.fromList(__wm_basis_Cons([conditionIr_2440, __wm_basis_Cons([thenIr_2442, __wm_basis_Cons([elseIr_2444, __wm_basis_Nil])])])) };
return addExpression_2350__wm_d2(expression_2446, afterElse_2445);
} else if (true) {

return __wm_fail("Panic", "schema-v2 if does not have three children");
}
__wm_fail("Match", "non-exhaustive match");
};
const buildIf_2397 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildIf_2397__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildMatch_2398__wm_d5 = (source_2447, functionId_2448, tailPosition_2449, context_2450, state_2451) => {
const row_2452 = findMatch_2101__wm_d2(context_2450.matches, source_2447.id);
const diagnosed_2453 = (matchIsExhaustive_2379__wm_d3(source_2447, row_2452, context_2450) ? state_2451 : addDiagnostic_2354__wm_d2(nonExhaustiveDiagnostic_2362(source_2447), state_2451));
const __wm_bind_83 = buildExpression_2395__wm_d5(row_2452.valueExprId, functionId_2448, false, context_2450, diagnosed_2453);
if (!(__wm_is_tuple(__wm_bind_83) && __wm_bind_83.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const valueIr_2454 = __wm_bind_83[0];
const afterValue_2455 = __wm_bind_83[1];
const __wm_bind_84 = buildMatchArms_2399__wm_d6(Js.Array.toList(row_2452.armIds), functionId_2448, tailPosition_2449, context_2450, afterValue_2455, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_84) && __wm_bind_84.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const armIds_2456 = __wm_bind_84[0];
const afterArms_2457 = __wm_bind_84[1];
const expression_2458 = { ...baseIrExpression_2346__wm_d4(afterArms_2457, source_2447, functionId_2448, "match"), children: Js.Array.fromList(__wm_basis_Cons([valueIr_2454, __wm_basis_Nil])), armIds: Js.Array.fromList(armIds_2456) };
return addExpression_2350__wm_d2(expression_2458, afterArms_2457);
};
const buildMatch_2398 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildMatch_2398__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildMatchArms_2399__wm_d6 = (sourceArmIds_2459, functionId_2460, tailPosition_2461, context_2462, state_2463, reversed_2464) => {
__wm_tail_117: while (true) {
{
const __wm_scalar_121_0 = sourceArmIds_2459;
const __wm_scalar_121_1 = functionId_2460;
const __wm_scalar_121_2 = tailPosition_2461;
const __wm_scalar_121_3 = context_2462;
const __wm_scalar_121_4 = state_2463;
const __wm_scalar_121_5 = reversed_2464;
if (__wm_scalar_121_0 === __wm_basis_Nil) {
const functionId_2465 = __wm_scalar_121_1;
const tailPosition_2466 = __wm_scalar_121_2;
const context_2467 = __wm_scalar_121_3;
const state_2468 = __wm_scalar_121_4;
const reversed_2469 = __wm_scalar_121_5;
return [reverseInto_2036__wm_d2(reversed_2469, __wm_basis_Nil), state_2468];
} else if (__wm_scalar_121_0?.ctor === -6 && __wm_scalar_121_0.args.length === 1 && __wm_is_tuple(__wm_scalar_121_0.args[0]) && __wm_scalar_121_0.args[0].length === 2) {
const sourceArmId_2470 = __wm_scalar_121_0.args[0][0];
const rest_2471 = __wm_scalar_121_0.args[0][1];
const functionId_2472 = __wm_scalar_121_1;
const tailPosition_2473 = __wm_scalar_121_2;
const context_2474 = __wm_scalar_121_3;
const state_2475 = __wm_scalar_121_4;
const reversed_2476 = __wm_scalar_121_5;
{
const exactContext_2477 = context_2474;
const sourceArm_2478 = findMatchArm_2109__wm_d2(exactContext_2477.matchArms, sourceArmId_2470);
const __wm_bind_85 = buildExpression_2395__wm_d5(sourceArm_2478.bodyExprId, functionId_2472, tailPosition_2473, exactContext_2477, state_2475);
if (!(__wm_is_tuple(__wm_bind_85) && __wm_bind_85.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const bodyIr_2479 = __wm_bind_85[0];
const afterBody_2480 = __wm_bind_85[1];
const arm_2481 = { id: afterBody_2480.nextArmId, sourceArmId: sourceArm_2478.id, patternId: sourceArm_2478.patternId, bodyExprId: bodyIr_2479, spanId: sourceArm_2478.spanId };
const afterArm_2482 = { ...afterBody_2480, nextArmId: (afterBody_2480.nextArmId + 1), matchArms: __wm_basis_Cons([arm_2481, afterBody_2480.matchArms]) };
{
const __wm_tail_arg_136_0 = rest_2471;
const __wm_tail_arg_136_1 = functionId_2472;
const __wm_tail_arg_136_2 = tailPosition_2473;
const __wm_tail_arg_136_3 = exactContext_2477;
const __wm_tail_arg_136_4 = afterArm_2482;
const __wm_tail_arg_136_5 = __wm_basis_Cons([arm_2481.id, reversed_2476]);
sourceArmIds_2459 = __wm_tail_arg_136_0;
functionId_2460 = __wm_tail_arg_136_1;
tailPosition_2461 = __wm_tail_arg_136_2;
context_2462 = __wm_tail_arg_136_3;
state_2463 = __wm_tail_arg_136_4;
reversed_2464 = __wm_tail_arg_136_5;
continue __wm_tail_117;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildMatchArms_2399 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return buildMatchArms_2399__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const buildBlock_2400__wm_d5 = (source_2483, functionId_2484, tailPosition_2485, context_2486, state_2487) => {
const row_2488 = findBlock_2077__wm_d2(context_2486.blocks, source_2483.id);
const __wm_bind_86 = buildBlockValues_2401__wm_d5(Js.Array.toList(row_2488.itemIds), functionId_2484, context_2486, state_2487, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_86) && __wm_bind_86.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const builtItems_2489 = __wm_bind_86[0];
const afterItems_2490 = __wm_bind_86[1];
const __wm_bind_87 = buildExpression_2395__wm_d5(row_2488.resultExprId, functionId_2484, tailPosition_2485, context_2486, afterItems_2490);
if (!(__wm_is_tuple(__wm_bind_87) && __wm_bind_87.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const resultIr_2491 = __wm_bind_87[0];
const afterResult_2492 = __wm_bind_87[1];
return buildBlockWrappers_2402__wm_d6(reverseInto_2036__wm_d2(builtItems_2489, __wm_basis_Nil), source_2483, functionId_2484, resultIr_2491, context_2486, afterResult_2492);
};
const buildBlock_2400 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildBlock_2400__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildBlockValues_2401__wm_d5 = (itemIds_2493, functionId_2494, context_2495, state_2496, reversed_2497) => {
__wm_tail_118: while (true) {
{
const __wm_scalar_122_0 = itemIds_2493;
const __wm_scalar_122_1 = functionId_2494;
const __wm_scalar_122_2 = context_2495;
const __wm_scalar_122_3 = state_2496;
const __wm_scalar_122_4 = reversed_2497;
if (__wm_scalar_122_0 === __wm_basis_Nil) {
const functionId_2498 = __wm_scalar_122_1;
const context_2499 = __wm_scalar_122_2;
const state_2500 = __wm_scalar_122_3;
const reversed_2501 = __wm_scalar_122_4;
return [reverseInto_2036__wm_d2(reversed_2501, __wm_basis_Nil), state_2500];
} else if (__wm_scalar_122_0?.ctor === -6 && __wm_scalar_122_0.args.length === 1 && __wm_is_tuple(__wm_scalar_122_0.args[0]) && __wm_scalar_122_0.args[0].length === 2) {
const itemId_2502 = __wm_scalar_122_0.args[0][0];
const rest_2503 = __wm_scalar_122_0.args[0][1];
const functionId_2504 = __wm_scalar_122_1;
const context_2505 = __wm_scalar_122_2;
const state_2506 = __wm_scalar_122_3;
const reversed_2507 = __wm_scalar_122_4;
{
const exactContext_2508 = context_2505;
const item_2509 = findBlockItem_2085__wm_d2(exactContext_2508.blockItems, itemId_2502);
if (__wm_eq(item_2509.kind, "let")) {
{
const letRow_2510 = findLet_2093__wm_d2(exactContext_2508.lets, item_2509.letId);
const __wm_bind_88 = buildExpression_2395__wm_d5(letRow_2510.valueExprId, functionId_2504, false, exactContext_2508, state_2506);
if (!(__wm_is_tuple(__wm_bind_88) && __wm_bind_88.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const valueIr_2511 = __wm_bind_88[0];
const afterValue_2512 = __wm_bind_88[1];
const built_2513 = { itemId: item_2509.id, valueExprId: valueIr_2511 };
{
const __wm_tail_arg_137_0 = rest_2503;
const __wm_tail_arg_137_1 = functionId_2504;
const __wm_tail_arg_137_2 = exactContext_2508;
const __wm_tail_arg_137_3 = afterValue_2512;
const __wm_tail_arg_137_4 = __wm_basis_Cons([built_2513, reversed_2507]);
itemIds_2493 = __wm_tail_arg_137_0;
functionId_2494 = __wm_tail_arg_137_1;
context_2495 = __wm_tail_arg_137_2;
state_2496 = __wm_tail_arg_137_3;
reversed_2497 = __wm_tail_arg_137_4;
continue __wm_tail_118;
}
}
} else {
{
const __wm_bind_89 = buildExpression_2395__wm_d5(item_2509.expressionId, functionId_2504, false, exactContext_2508, state_2506);
if (!(__wm_is_tuple(__wm_bind_89) && __wm_bind_89.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const valueIr_2514 = __wm_bind_89[0];
const afterValue_2515 = __wm_bind_89[1];
const built_2516 = { itemId: item_2509.id, valueExprId: valueIr_2514 };
{
const __wm_tail_arg_138_0 = rest_2503;
const __wm_tail_arg_138_1 = functionId_2504;
const __wm_tail_arg_138_2 = exactContext_2508;
const __wm_tail_arg_138_3 = afterValue_2515;
const __wm_tail_arg_138_4 = __wm_basis_Cons([built_2516, reversed_2507]);
itemIds_2493 = __wm_tail_arg_138_0;
functionId_2494 = __wm_tail_arg_138_1;
context_2495 = __wm_tail_arg_138_2;
state_2496 = __wm_tail_arg_138_3;
reversed_2497 = __wm_tail_arg_138_4;
continue __wm_tail_118;
}
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildBlockValues_2401 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildBlockValues_2401__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildBlockWrappers_2402__wm_d6 = (builtItems_2517, source_2518, functionId_2519, bodyIr_2520, context_2521, state_2522) => {
__wm_tail_119: while (true) {
{
const __wm_scalar_123_0 = builtItems_2517;
const __wm_scalar_123_1 = source_2518;
const __wm_scalar_123_2 = functionId_2519;
const __wm_scalar_123_3 = bodyIr_2520;
const __wm_scalar_123_4 = context_2521;
const __wm_scalar_123_5 = state_2522;
if (__wm_scalar_123_0 === __wm_basis_Nil) {
const source_2523 = __wm_scalar_123_1;
const functionId_2524 = __wm_scalar_123_2;
const bodyIr_2525 = __wm_scalar_123_3;
const context_2526 = __wm_scalar_123_4;
const state_2527 = __wm_scalar_123_5;
return [bodyIr_2525, state_2527];
} else if (__wm_scalar_123_0?.ctor === -6 && __wm_scalar_123_0.args.length === 1 && __wm_is_tuple(__wm_scalar_123_0.args[0]) && __wm_scalar_123_0.args[0].length === 2) {
const built_2528 = __wm_scalar_123_0.args[0][0];
const rest_2529 = __wm_scalar_123_0.args[0][1];
const source_2530 = __wm_scalar_123_1;
const functionId_2531 = __wm_scalar_123_2;
const bodyIr_2532 = __wm_scalar_123_3;
const context_2533 = __wm_scalar_123_4;
const state_2534 = __wm_scalar_123_5;
{
const exactBuilt_2535 = built_2528;
const exactSource_2536 = source_2530;
const exactContext_2537 = context_2533;
const item_2538 = findBlockItem_2085__wm_d2(exactContext_2537.blockItems, exactBuilt_2535.itemId);
if (__wm_eq(item_2538.kind, "let")) {
{
const letRow_2539 = findLet_2093__wm_d2(exactContext_2537.lets, item_2538.letId);
const expression_2540 = { ...baseIrExpression_2346__wm_d4(state_2534, exactSource_2536, functionId_2531, "let"), spanId: item_2538.spanId, bindingId: __wm_op_sub(1), patternId: letRow_2539.patternId, targetFunctionId: __wm_op_sub(1), children: Js.Array.fromList(__wm_basis_Cons([exactBuilt_2535.valueExprId, __wm_basis_Cons([bodyIr_2532, __wm_basis_Nil])])) };
const __wm_bind_90 = addExpression_2350__wm_d2(expression_2540, state_2534);
if (!(__wm_is_tuple(__wm_bind_90) && __wm_bind_90.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const letIr_2541 = __wm_bind_90[0];
const afterLet_2542 = __wm_bind_90[1];
{
const __wm_tail_arg_139_0 = rest_2529;
const __wm_tail_arg_139_1 = exactSource_2536;
const __wm_tail_arg_139_2 = functionId_2531;
const __wm_tail_arg_139_3 = letIr_2541;
const __wm_tail_arg_139_4 = exactContext_2537;
const __wm_tail_arg_139_5 = afterLet_2542;
builtItems_2517 = __wm_tail_arg_139_0;
source_2518 = __wm_tail_arg_139_1;
functionId_2519 = __wm_tail_arg_139_2;
bodyIr_2520 = __wm_tail_arg_139_3;
context_2521 = __wm_tail_arg_139_4;
state_2522 = __wm_tail_arg_139_5;
continue __wm_tail_119;
}
}
} else {
{
const expression_2543 = { ...baseIrExpression_2346__wm_d4(state_2534, exactSource_2536, functionId_2531, "sequence"), spanId: item_2538.spanId, bindingId: __wm_op_sub(1), targetFunctionId: __wm_op_sub(1), children: Js.Array.fromList(__wm_basis_Cons([exactBuilt_2535.valueExprId, __wm_basis_Cons([bodyIr_2532, __wm_basis_Nil])])) };
const __wm_bind_91 = addExpression_2350__wm_d2(expression_2543, state_2534);
if (!(__wm_is_tuple(__wm_bind_91) && __wm_bind_91.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const sequenceIr_2544 = __wm_bind_91[0];
const afterSequence_2545 = __wm_bind_91[1];
{
const __wm_tail_arg_140_0 = rest_2529;
const __wm_tail_arg_140_1 = exactSource_2536;
const __wm_tail_arg_140_2 = functionId_2531;
const __wm_tail_arg_140_3 = sequenceIr_2544;
const __wm_tail_arg_140_4 = exactContext_2537;
const __wm_tail_arg_140_5 = afterSequence_2545;
builtItems_2517 = __wm_tail_arg_140_0;
source_2518 = __wm_tail_arg_140_1;
functionId_2519 = __wm_tail_arg_140_2;
bodyIr_2520 = __wm_tail_arg_140_3;
context_2521 = __wm_tail_arg_140_4;
state_2522 = __wm_tail_arg_140_5;
continue __wm_tail_119;
}
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildBlockWrappers_2402 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return buildBlockWrappers_2402__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const buildFunctions_2546__wm_d3 = (functions_2547, context_2548, state_2549) => {
__wm_tail_120: while (true) {
{
const __wm_scalar_124_0 = functions_2547;
const __wm_scalar_124_1 = context_2548;
const __wm_scalar_124_2 = state_2549;
if (__wm_scalar_124_0 === __wm_basis_Nil) {
const context_2550 = __wm_scalar_124_1;
const state_2551 = __wm_scalar_124_2;
return state_2551;
} else if (__wm_scalar_124_0?.ctor === -6 && __wm_scalar_124_0.args.length === 1 && __wm_is_tuple(__wm_scalar_124_0.args[0]) && __wm_scalar_124_0.args[0].length === 2) {
const fn_2552 = __wm_scalar_124_0.args[0][0];
const rest_2553 = __wm_scalar_124_0.args[0][1];
const context_2554 = __wm_scalar_124_1;
const state_2555 = __wm_scalar_124_2;
{
const exactFunction_2556 = fn_2552;
const exactContext_2557 = context_2554;
const __wm_bind_92 = buildExpression_2395__wm_d5(exactFunction_2556.bodyExprId, exactFunction_2556.id, true, exactContext_2557, state_2555);
if (!(__wm_is_tuple(__wm_bind_92) && __wm_bind_92.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const bodyIr_2558 = __wm_bind_92[0];
const afterBody_2559 = __wm_bind_92[1];
const irFunction_2560 = { functionId: exactFunction_2556.id, bindingId: exactFunction_2556.bindingId, name: exactFunction_2556.name, paramIds: exactFunction_2556.paramIds, resultTypeId: exactFunction_2556.resultTypeId, bodyExprId: bodyIr_2558, recursionGroupId: exactFunction_2556.recursionGroupId, spanId: exactFunction_2556.spanId };
const afterFunction_2561 = { ...afterBody_2559, functions: __wm_basis_Cons([irFunction_2560, afterBody_2559.functions]) };
{
const __wm_tail_arg_141_0 = rest_2553;
const __wm_tail_arg_141_1 = exactContext_2557;
const __wm_tail_arg_141_2 = afterFunction_2561;
functions_2547 = __wm_tail_arg_141_0;
context_2548 = __wm_tail_arg_141_1;
state_2549 = __wm_tail_arg_141_2;
continue __wm_tail_120;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildFunctions_2546 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return buildFunctions_2546__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const findOccurrence_2562__wm_d3 = (items_2563, kind_2564, sourceId_2565) => {
__wm_tail_121: while (true) {
{
const __wm_scalar_125_0 = items_2563;
const __wm_scalar_125_1 = kind_2564;
const __wm_scalar_125_2 = sourceId_2565;
if (__wm_scalar_125_0 === __wm_basis_Nil) {
const kind_2566 = __wm_scalar_125_1;
const sourceId_2567 = __wm_scalar_125_2;
return __wm_fail("Panic", "missing concrete GPU occurrence type");
} else if (__wm_scalar_125_0?.ctor === -6 && __wm_scalar_125_0.args.length === 1 && __wm_is_tuple(__wm_scalar_125_0.args[0]) && __wm_scalar_125_0.args[0].length === 2) {
const item_2568 = __wm_scalar_125_0.args[0][0];
const rest_2569 = __wm_scalar_125_0.args[0][1];
const kind_2570 = __wm_scalar_125_1;
const sourceId_2571 = __wm_scalar_125_2;
{
const exact_2572 = item_2568;
if (__wm_op_and_d2(__wm_eq(exact_2572.kind, kind_2570), numberEqual_2058__wm_d2(exact_2572.sourceId, sourceId_2571))) {
return exact_2572;
} else {
{
const __wm_tail_arg_142_0 = rest_2569;
const __wm_tail_arg_142_1 = kind_2570;
const __wm_tail_arg_142_2 = sourceId_2571;
items_2563 = __wm_tail_arg_142_0;
kind_2564 = __wm_tail_arg_142_1;
sourceId_2565 = __wm_tail_arg_142_2;
continue __wm_tail_121;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findOccurrence_2562 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findOccurrence_2562__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizeExpressions_2573__wm_d3 = (expressions_2574, occurrences_2575, output_2576) => {
__wm_tail_122: while (true) {
{
const __wm_scalar_126_0 = expressions_2574;
const __wm_scalar_126_1 = occurrences_2575;
const __wm_scalar_126_2 = output_2576;
if (__wm_scalar_126_0 === __wm_basis_Nil) {
const occurrences_2577 = __wm_scalar_126_1;
const output_2578 = __wm_scalar_126_2;
return reverseInto_2036__wm_d2(output_2578, __wm_basis_Nil);
} else if (__wm_scalar_126_0?.ctor === -6 && __wm_scalar_126_0.args.length === 1 && __wm_is_tuple(__wm_scalar_126_0.args[0]) && __wm_scalar_126_0.args[0].length === 2) {
const expression_2579 = __wm_scalar_126_0.args[0][0];
const rest_2580 = __wm_scalar_126_0.args[0][1];
const occurrences_2581 = __wm_scalar_126_1;
const output_2582 = __wm_scalar_126_2;
{
const exactExpression_2583 = expression_2579;
const occurrence_2584 = findOccurrence_2562__wm_d3(occurrences_2581, "expression", exactExpression_2583.id);
const concrete_2585 = { ...exactExpression_2583, typeId: occurrence_2584.shaderTypeId };
{
const __wm_tail_arg_143_0 = rest_2580;
const __wm_tail_arg_143_1 = occurrences_2581;
const __wm_tail_arg_143_2 = __wm_basis_Cons([concrete_2585, output_2582]);
expressions_2574 = __wm_tail_arg_143_0;
occurrences_2575 = __wm_tail_arg_143_1;
output_2576 = __wm_tail_arg_143_2;
continue __wm_tail_122;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizeExpressions_2573 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concretizeExpressions_2573__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizePatterns_2586__wm_d3 = (patterns_2587, occurrences_2588, output_2589) => {
__wm_tail_123: while (true) {
{
const __wm_scalar_127_0 = patterns_2587;
const __wm_scalar_127_1 = occurrences_2588;
const __wm_scalar_127_2 = output_2589;
if (__wm_scalar_127_0 === __wm_basis_Nil) {
const occurrences_2590 = __wm_scalar_127_1;
const output_2591 = __wm_scalar_127_2;
return reverseInto_2036__wm_d2(output_2591, __wm_basis_Nil);
} else if (__wm_scalar_127_0?.ctor === -6 && __wm_scalar_127_0.args.length === 1 && __wm_is_tuple(__wm_scalar_127_0.args[0]) && __wm_scalar_127_0.args[0].length === 2) {
const pattern_2592 = __wm_scalar_127_0.args[0][0];
const rest_2593 = __wm_scalar_127_0.args[0][1];
const occurrences_2594 = __wm_scalar_127_1;
const output_2595 = __wm_scalar_127_2;
{
const exactPattern_2596 = pattern_2592;
const occurrence_2597 = findOccurrence_2562__wm_d3(occurrences_2594, "pattern", exactPattern_2596.id);
const concrete_2598 = { ...exactPattern_2596, typeId: occurrence_2597.shaderTypeId };
{
const __wm_tail_arg_144_0 = rest_2593;
const __wm_tail_arg_144_1 = occurrences_2594;
const __wm_tail_arg_144_2 = __wm_basis_Cons([concrete_2598, output_2595]);
patterns_2587 = __wm_tail_arg_144_0;
occurrences_2588 = __wm_tail_arg_144_1;
output_2589 = __wm_tail_arg_144_2;
continue __wm_tail_123;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizePatterns_2586 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concretizePatterns_2586__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizeParams_2599__wm_d3 = (params_2600, patterns_2601, output_2602) => {
__wm_tail_124: while (true) {
{
const __wm_scalar_128_0 = params_2600;
const __wm_scalar_128_1 = patterns_2601;
const __wm_scalar_128_2 = output_2602;
if (__wm_scalar_128_0 === __wm_basis_Nil) {
const patterns_2603 = __wm_scalar_128_1;
const output_2604 = __wm_scalar_128_2;
return reverseInto_2036__wm_d2(output_2604, __wm_basis_Nil);
} else if (__wm_scalar_128_0?.ctor === -6 && __wm_scalar_128_0.args.length === 1 && __wm_is_tuple(__wm_scalar_128_0.args[0]) && __wm_scalar_128_0.args[0].length === 2) {
const param_2605 = __wm_scalar_128_0.args[0][0];
const rest_2606 = __wm_scalar_128_0.args[0][1];
const patterns_2607 = __wm_scalar_128_1;
const output_2608 = __wm_scalar_128_2;
{
const exactParam_2609 = param_2605;
const pattern_2610 = findPattern_2117__wm_d2(patterns_2607, exactParam_2609.patternId);
const concrete_2611 = { ...exactParam_2609, typeId: pattern_2610.typeId };
{
const __wm_tail_arg_145_0 = rest_2606;
const __wm_tail_arg_145_1 = patterns_2607;
const __wm_tail_arg_145_2 = __wm_basis_Cons([concrete_2611, output_2608]);
params_2600 = __wm_tail_arg_145_0;
patterns_2601 = __wm_tail_arg_145_1;
output_2602 = __wm_tail_arg_145_2;
continue __wm_tail_124;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizeParams_2599 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concretizeParams_2599__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizeFunctions_2612__wm_d3 = (functions_2613, expressions_2614, output_2615) => {
__wm_tail_125: while (true) {
{
const __wm_scalar_129_0 = functions_2613;
const __wm_scalar_129_1 = expressions_2614;
const __wm_scalar_129_2 = output_2615;
if (__wm_scalar_129_0 === __wm_basis_Nil) {
const expressions_2616 = __wm_scalar_129_1;
const output_2617 = __wm_scalar_129_2;
return reverseInto_2036__wm_d2(output_2617, __wm_basis_Nil);
} else if (__wm_scalar_129_0?.ctor === -6 && __wm_scalar_129_0.args.length === 1 && __wm_is_tuple(__wm_scalar_129_0.args[0]) && __wm_scalar_129_0.args[0].length === 2) {
const fn_2618 = __wm_scalar_129_0.args[0][0];
const rest_2619 = __wm_scalar_129_0.args[0][1];
const expressions_2620 = __wm_scalar_129_1;
const output_2621 = __wm_scalar_129_2;
{
const exactFunction_2622 = fn_2618;
const body_2623 = findExpression_2069__wm_d2(expressions_2620, exactFunction_2622.bodyExprId);
const concrete_2624 = { ...exactFunction_2622, resultTypeId: body_2623.typeId };
{
const __wm_tail_arg_146_0 = rest_2619;
const __wm_tail_arg_146_1 = expressions_2620;
const __wm_tail_arg_146_2 = __wm_basis_Cons([concrete_2624, output_2621]);
functions_2613 = __wm_tail_arg_146_0;
expressions_2614 = __wm_tail_arg_146_1;
output_2615 = __wm_tail_arg_146_2;
continue __wm_tail_125;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizeFunctions_2612 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concretizeFunctions_2612__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const uniformShaderTypeId_2625__wm_d4 = (expressions_2626, occurrences_2627, index_2628, fallback_2629) => {
__wm_tail_126: while (true) {
{
const __wm_scalar_130_0 = expressions_2626;
const __wm_scalar_130_1 = occurrences_2627;
const __wm_scalar_130_2 = index_2628;
const __wm_scalar_130_3 = fallback_2629;
if (__wm_scalar_130_0 === __wm_basis_Nil) {
const occurrences_2630 = __wm_scalar_130_1;
const index_2631 = __wm_scalar_130_2;
const fallback_2632 = __wm_scalar_130_3;
return fallback_2632;
} else if (__wm_scalar_130_0?.ctor === -6 && __wm_scalar_130_0.args.length === 1 && __wm_is_tuple(__wm_scalar_130_0.args[0]) && __wm_scalar_130_0.args[0].length === 2) {
const expression_2633 = __wm_scalar_130_0.args[0][0];
const rest_2634 = __wm_scalar_130_0.args[0][1];
const occurrences_2635 = __wm_scalar_130_1;
const index_2636 = __wm_scalar_130_2;
const fallback_2637 = __wm_scalar_130_3;
{
const exactExpression_2638 = expression_2633;
if (__wm_op_and_d2(__wm_eq(exactExpression_2638.kind, "uniform"), numberEqual_2058__wm_d2(exactExpression_2638.index, index_2636))) {
{
const occurrence_2639 = findOccurrence_2562__wm_d3(occurrences_2635, "expression", exactExpression_2638.id);
return occurrence_2639.shaderTypeId;
}
} else {
{
const __wm_tail_arg_147_0 = rest_2634;
const __wm_tail_arg_147_1 = occurrences_2635;
const __wm_tail_arg_147_2 = index_2636;
const __wm_tail_arg_147_3 = fallback_2637;
expressions_2626 = __wm_tail_arg_147_0;
occurrences_2627 = __wm_tail_arg_147_1;
index_2628 = __wm_tail_arg_147_2;
fallback_2629 = __wm_tail_arg_147_3;
continue __wm_tail_126;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const uniformShaderTypeId_2625 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return uniformShaderTypeId_2625__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizeEnvironmentFields_2640__wm_d4 = (fields_2641, expressions_2642, occurrences_2643, output_2644) => {
__wm_tail_127: while (true) {
{
const __wm_scalar_131_0 = fields_2641;
const __wm_scalar_131_1 = expressions_2642;
const __wm_scalar_131_2 = occurrences_2643;
const __wm_scalar_131_3 = output_2644;
if (__wm_scalar_131_0 === __wm_basis_Nil) {
const expressions_2645 = __wm_scalar_131_1;
const occurrences_2646 = __wm_scalar_131_2;
const output_2647 = __wm_scalar_131_3;
return reverseInto_2036__wm_d2(output_2647, __wm_basis_Nil);
} else if (__wm_scalar_131_0?.ctor === -6 && __wm_scalar_131_0.args.length === 1 && __wm_is_tuple(__wm_scalar_131_0.args[0]) && __wm_scalar_131_0.args[0].length === 2) {
const field_2648 = __wm_scalar_131_0.args[0][0];
const rest_2649 = __wm_scalar_131_0.args[0][1];
const expressions_2650 = __wm_scalar_131_1;
const occurrences_2651 = __wm_scalar_131_2;
const output_2652 = __wm_scalar_131_3;
{
const exactField_2653 = field_2648;
const concrete_2654 = { ...exactField_2653, typeId: uniformShaderTypeId_2625__wm_d4(expressions_2650, occurrences_2651, exactField_2653.declaredIndex, exactField_2653.typeId) };
{
const __wm_tail_arg_148_0 = rest_2649;
const __wm_tail_arg_148_1 = expressions_2650;
const __wm_tail_arg_148_2 = occurrences_2651;
const __wm_tail_arg_148_3 = __wm_basis_Cons([concrete_2654, output_2652]);
fields_2641 = __wm_tail_arg_148_0;
expressions_2642 = __wm_tail_arg_148_1;
occurrences_2643 = __wm_tail_arg_148_2;
output_2644 = __wm_tail_arg_148_3;
continue __wm_tail_127;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizeEnvironmentFields_2640 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return concretizeEnvironmentFields_2640__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const compileSliceProgram_2675 = (__arg) => {
if (true) {
const input_2655 = __arg;
const elaboration_2656 = elaborateSliceProgramTypes_2322(input_2655);
const shaderTypes_2657 = elaboration_2656.shaderTypes;
const occurrences_2658 = Js.Array.toList(elaboration_2656.occurrences);
const sourceExpressions_2659 = Js.Array.toList(input_2655.expressions);
const concreteExpressions_2660 = concretizeExpressions_2573__wm_d3(sourceExpressions_2659, occurrences_2658, __wm_basis_Nil);
const concretePatterns_2661 = concretizePatterns_2586__wm_d3(Js.Array.toList(input_2655.patterns), occurrences_2658, __wm_basis_Nil);
const elaboratedInput_2662 = { ...input_2655, types: shaderTypes_2657, environmentFields: Js.Array.fromList(concretizeEnvironmentFields_2640__wm_d4(Js.Array.toList(input_2655.environmentFields), sourceExpressions_2659, occurrences_2658, __wm_basis_Nil)), functions: Js.Array.fromList(concretizeFunctions_2612__wm_d3(Js.Array.toList(input_2655.functions), concreteExpressions_2660, __wm_basis_Nil)), patterns: Js.Array.fromList(concretePatterns_2661), params: Js.Array.fromList(concretizeParams_2599__wm_d3(Js.Array.toList(input_2655.params), concretePatterns_2661, __wm_basis_Nil)), expressions: Js.Array.fromList(concreteExpressions_2660) };
const builtinCatalog_2663 = elaboratedInput_2662.builtinCatalog;
const context_2664 = { expressions: Js.Array.toList(elaboratedInput_2662.expressions), blocks: Js.Array.toList(elaboratedInput_2662.blocks), blockItems: Js.Array.toList(elaboratedInput_2662.blockItems), lets: Js.Array.toList(elaboratedInput_2662.lets), matches: Js.Array.toList(elaboratedInput_2662.matches), matchArms: Js.Array.toList(elaboratedInput_2662.matchArms), patterns: Js.Array.toList(elaboratedInput_2662.patterns), types: Js.Array.toList(elaboratedInput_2662.types), adts: Js.Array.toList(elaboratedInput_2662.adts), functions: Js.Array.toList(elaboratedInput_2662.functions), builtinOverloads: Js.Array.toList(builtinCatalog_2663.overloads), occurrences: occurrences_2658 };
const state_2665 = buildFunctions_2546__wm_d3(Js.Array.toList(elaboratedInput_2662.functions), context_2664, initialState_2340(undefined));
const layouts_2666 = buildSliceLayouts_141(elaboratedInput_2662);
const irFunctions_2667 = Js.Array.fromList(reverseInto_2036__wm_d2(state_2665.functions, __wm_basis_Nil));
const irExpressions_2668 = Js.Array.fromList(reverseInto_2036__wm_d2(state_2665.expressions, __wm_basis_Nil));
const irMatchArms_2669 = Js.Array.fromList(reverseInto_2036__wm_d2(state_2665.matchArms, __wm_basis_Nil));
const lowered_2670 = lowerSliceProgram_906__wm_d8(irFunctions_2667, irExpressions_2668, irMatchArms_2669, elaboratedInput_2662.params, elaboratedInput_2662.patterns, elaboratedInput_2662.constructors, layouts_2666.adtLayouts, layouts_2666.adtFields);
const slangModule_2671 = ((__v) => {
if (__v === __wm_basis_Nil) {

return emitSliceSlangModule_1463__wm_d10(elaboratedInput_2662, layouts_2666.adtLayouts, layouts_2666.adtFields, lowered_2670.functions, lowered_2670.locals, lowered_2670.atoms, lowered_2670.operations, lowered_2670.statements, lowered_2670.blocks, lowered_2670.cases);
} else if (true) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
})(state_2665.diagnostics);
const callableName_2672 = ((__v) => {
if (__v === __wm_basis_Nil) {

return emitSliceCallableName_1465(elaboratedInput_2662);
} else if (true) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
})(state_2665.diagnostics);
const slangSource_2673 = ((__v) => {
if (__v === __wm_basis_Nil) {

return emitSliceSlang_1477__wm_d10(elaboratedInput_2662, layouts_2666.adtLayouts, layouts_2666.adtFields, lowered_2670.functions, lowered_2670.locals, lowered_2670.atoms, lowered_2670.operations, lowered_2670.statements, lowered_2670.blocks, lowered_2670.cases);
} else if (true) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
})(state_2665.diagnostics);
const output_2674 = { schemaVersion: 5, program: input_2655, shaderTypes: shaderTypes_2657, typeEvidence: elaboration_2656.typeEvidence, occurrences: elaboration_2656.occurrences, builtinSelections: elaboration_2656.builtinSelections, irFunctions: irFunctions_2667, irExpressions: irExpressions_2668, irMatchArms: irMatchArms_2669, adtLayouts: layouts_2666.adtLayouts, adtFields: layouts_2666.adtFields, loweredFunctions: lowered_2670.functions, loweredLocals: lowered_2670.locals, loweredAtoms: lowered_2670.atoms, loweredOperations: lowered_2670.operations, loweredStatements: lowered_2670.statements, loweredBlocks: lowered_2670.blocks, loweredCases: lowered_2670.cases, slangModule: slangModule_2671, callableName: callableName_2672, slangSource: slangSource_2673, diagnostics: Js.Array.fromList(reverseInto_2036__wm_d2(state_2665.diagnostics, __wm_basis_Nil)) };
return output_2674;
}
__wm_fail("Match", "pattern match failure in function");
};
return { "SliceContext": SliceContext_2033, "SliceIrState": SliceIrState_2034, "BuiltBlockItem": BuiltBlockItem_2035, "reverseInto": reverseInto_2036, "reverseInto__wm_d2": reverseInto_2036__wm_d2, "append": append_2043, "append__wm_d2": append_2043__wm_d2, "listLength": listLength_2050, "listLength__wm_d2": listLength_2050__wm_d2, "numberEqual": numberEqual_2058, "numberEqual__wm_d2": numberEqual_2058__wm_d2, "contains": contains_2059, "contains__wm_d2": contains_2059__wm_d2, "unique": unique_2064, "unique__wm_d2": unique_2064__wm_d2, "findExpression": findExpression_2069, "findExpression__wm_d2": findExpression_2069__wm_d2, "findBlock": findBlock_2077, "findBlock__wm_d2": findBlock_2077__wm_d2, "findBlockItem": findBlockItem_2085, "findBlockItem__wm_d2": findBlockItem_2085__wm_d2, "findLet": findLet_2093, "findLet__wm_d2": findLet_2093__wm_d2, "findMatch": findMatch_2101, "findMatch__wm_d2": findMatch_2101__wm_d2, "findMatchArm": findMatchArm_2109, "findMatchArm__wm_d2": findMatchArm_2109__wm_d2, "findPattern": findPattern_2117, "findPattern__wm_d2": findPattern_2117__wm_d2, "findType": findType_2125, "findType__wm_d2": findType_2125__wm_d2, "findExpressionOccurrence": findExpressionOccurrence_2133, "findExpressionOccurrence__wm_d2": findExpressionOccurrence_2133__wm_d2, "shaderBuiltinTypeName": shaderBuiltinTypeName_2150, "shaderBuiltinTypeName__wm_d2": shaderBuiltinTypeName_2150__wm_d2, "builtinParamsMatch": builtinParamsMatch_2151, "builtinParamsMatch__wm_d3": builtinParamsMatch_2151__wm_d3, "selectBuiltinOverload": selectBuiltinOverload_2164, "selectBuiltinOverload__wm_d3": selectBuiltinOverload_2164__wm_d3, "collectBuiltinSelections": collectBuiltinSelections_2177, "collectBuiltinSelections__wm_d3": collectBuiltinSelections_2177__wm_d3, "allSemanticNumbers": allSemanticNumbers_2190, "allSemanticNumbers__wm_d2": allSemanticNumbers_2190__wm_d2, "shaderTypeKind": shaderTypeKind_2202, "shaderTypeKind__wm_d2": shaderTypeKind_2202__wm_d2, "shaderTypeReason": shaderTypeReason_2205, "shaderTypeReason__wm_d2": shaderTypeReason_2205__wm_d2, "offsetTypeIds": offsetTypeIds_2206, "offsetTypeIds__wm_d3": offsetTypeIds_2206__wm_d3, "addI32ShaderTypes": addI32ShaderTypes_2216, "addI32ShaderTypes__wm_d4": addI32ShaderTypes_2216__wm_d4, "concreteShaderTypeId": concreteShaderTypeId_2240, "concreteShaderTypeId__wm_d4": concreteShaderTypeId_2240__wm_d4, "elaborateSliceTypes": elaborateSliceTypes_2241, "elaborateSliceTypes__wm_d4": elaborateSliceTypes_2241__wm_d4, "addExpressionOccurrences": addExpressionOccurrences_2258, "addExpressionOccurrences__wm_d5": addExpressionOccurrences_2258__wm_d5, "addPatternOccurrences": addPatternOccurrences_2277, "addPatternOccurrences__wm_d6": addPatternOccurrences_2277__wm_d6, "addFunctionOccurrences": addFunctionOccurrences_2299, "addFunctionOccurrences__wm_d2": addFunctionOccurrences_2299__wm_d2, "elaborateSliceProgramTypes": elaborateSliceProgramTypes_2322, "findAdt": findAdt_2323, "findAdt__wm_d2": findAdt_2323__wm_d2, "findFunction": findFunction_2331, "findFunction__wm_d2": findFunction_2331__wm_d2, "initialState": initialState_2340, "baseIrExpression": baseIrExpression_2346, "baseIrExpression__wm_d4": baseIrExpression_2346__wm_d4, "addExpression": addExpression_2350, "addExpression__wm_d2": addExpression_2350__wm_d2, "addDiagnostic": addDiagnostic_2354, "addDiagnostic__wm_d2": addDiagnostic_2354__wm_d2, "nonTailDiagnostic": nonTailDiagnostic_2359, "nonTailDiagnostic__wm_d2": nonTailDiagnostic_2359__wm_d2, "nonExhaustiveDiagnostic": nonExhaustiveDiagnostic_2362, "constructorPatterns": constructorPatterns_2363, "constructorPatterns__wm_d4": constructorPatterns_2363__wm_d4, "matchIsExhaustive": matchIsExhaustive_2379, "matchIsExhaustive__wm_d3": matchIsExhaustive_2379__wm_d3, "constructorSetContains": constructorSetContains_2380, "constructorSetContains__wm_d2": constructorSetContains_2380__wm_d2, "buildExpression": buildExpression_2395, "buildExpression__wm_d5": buildExpression_2395__wm_d5, "buildChildren": buildChildren_2396, "buildChildren__wm_d5": buildChildren_2396__wm_d5, "buildIf": buildIf_2397, "buildIf__wm_d5": buildIf_2397__wm_d5, "buildMatch": buildMatch_2398, "buildMatch__wm_d5": buildMatch_2398__wm_d5, "buildMatchArms": buildMatchArms_2399, "buildMatchArms__wm_d6": buildMatchArms_2399__wm_d6, "buildBlock": buildBlock_2400, "buildBlock__wm_d5": buildBlock_2400__wm_d5, "buildBlockValues": buildBlockValues_2401, "buildBlockValues__wm_d5": buildBlockValues_2401__wm_d5, "buildBlockWrappers": buildBlockWrappers_2402, "buildBlockWrappers__wm_d6": buildBlockWrappers_2402__wm_d6, "buildFunctions": buildFunctions_2546, "buildFunctions__wm_d3": buildFunctions_2546__wm_d3, "findOccurrence": findOccurrence_2562, "findOccurrence__wm_d3": findOccurrence_2562__wm_d3, "concretizeExpressions": concretizeExpressions_2573, "concretizeExpressions__wm_d3": concretizeExpressions_2573__wm_d3, "concretizePatterns": concretizePatterns_2586, "concretizePatterns__wm_d3": concretizePatterns_2586__wm_d3, "concretizeParams": concretizeParams_2599, "concretizeParams__wm_d3": concretizeParams_2599__wm_d3, "concretizeFunctions": concretizeFunctions_2612, "concretizeFunctions__wm_d3": concretizeFunctions_2612__wm_d3, "uniformShaderTypeId": uniformShaderTypeId_2625, "uniformShaderTypeId__wm_d4": uniformShaderTypeId_2625__wm_d4, "concretizeEnvironmentFields": concretizeEnvironmentFields_2640, "concretizeEnvironmentFields__wm_d4": concretizeEnvironmentFields_2640__wm_d4, "compileSliceProgram": compileSliceProgram_2675 };
  },
  (value) => { __wm_module_6 = value; },
);
let __wm_module_7;
__wm_define_module(
  "__wm_module_7",
  ["__wm_module_0", "__wm_module_6"],
  async () => {
const GpuBindingDto_2 = __wm_module_0["GpuBindingDto"];
const GpuExprDto_4 = __wm_module_0["GpuExprDto"];
const GpuFunctionDto_6 = __wm_module_0["GpuFunctionDto"];
const GpuParamDto_3 = __wm_module_0["GpuParamDto"];
const GpuRootDto_5 = __wm_module_0["GpuRootDto"];
const GpuTypeDto_1 = __wm_module_0["GpuTypeDto"];
const GpuElaborationInputDto_7 = __wm_module_0["GpuElaborationInputDto"];
const TypedGpuExprDto_8 = __wm_module_0["TypedGpuExprDto"];
const TypedGpuFunctionDto_9 = __wm_module_0["TypedGpuFunctionDto"];
const GpuCaptureDto_10 = __wm_module_0["GpuCaptureDto"];
const GpuRepresentationFactDto_11 = __wm_module_0["GpuRepresentationFactDto"];
const GpuSpecializationDto_12 = __wm_module_0["GpuSpecializationDto"];
const GpuRootSpecializationDto_13 = __wm_module_0["GpuRootSpecializationDto"];
const GpuSpecializedCallDto_14 = __wm_module_0["GpuSpecializedCallDto"];
const GpuIrParamDto_15 = __wm_module_0["GpuIrParamDto"];
const GpuIrExprDto_16 = __wm_module_0["GpuIrExprDto"];
const GpuIrFunctionDto_17 = __wm_module_0["GpuIrFunctionDto"];
const GpuDiagnosticDto_18 = __wm_module_0["GpuDiagnosticDto"];
const GpuCompilationOutputDto_19 = __wm_module_0["GpuCompilationOutputDto"];
const GpuSliceElaborationInputDto_46 = __wm_module_0["GpuSliceElaborationInputDto"];
const GpuSliceCompilationOutputDto_63 = __wm_module_0["GpuSliceCompilationOutputDto"];
const GpuSliceTypeElaborationOutputDto_40 = __wm_module_0["GpuSliceTypeElaborationOutputDto"];
const compileSliceProgram_2675 = __wm_module_6["compileSliceProgram"];
const elaborateSliceProgramTypes_2322 = __wm_module_6["elaborateSliceProgramTypes"];
const SpecializationRegistryEntry_2676 = (__record_args) => ({ specializationId: __record_args[0], paramRepresentations: __record_args[1], resultRepresentation: __record_args[2] });
const SpecializationBuildState_2677 = (__record_args) => ({ nextId: __record_args[0], registry: __record_args[1], specializations: __record_args[2], rootSpecializations: __record_args[3], calls: __record_args[4], diagnostics: __record_args[5] });
const IrBuildState_2678 = (__record_args) => ({ nextExpressionId: __record_args[0], functions: __record_args[1], expressions: __record_args[2] });
const typedExpression_2681 = (__arg) => {
if (true) {
const expression_2679 = __arg;
const output_2680 = { id: expression_2679.id, kind: expression_2679.kind, typeId: expression_2679.typeId, spanId: expression_2679.spanId, bindingId: expression_2679.bindingId, name: expression_2679.name, operator: expression_2679.operator, numberValue: expression_2679.numberValue, boolValue: expression_2679.boolValue, children: expression_2679.children, capability: expression_2679.capability };
return output_2680;
}
__wm_fail("Match", "pattern match failure in function");
};
const typedFunction_2686__wm_d2 = (reachable_2682, fn_2683) => {
const capability_2684 = (__wm_eq(fn_2683.capability, "gpu-only") ? "gpu-only" : (Map.has([reachable_2682, fn_2683.id]) ? "gpu-eligible" : "cpu-only"));
const output_2685 = { id: fn_2683.id, regionId: fn_2683.regionId, bindingId: fn_2683.bindingId, name: fn_2683.name, params: fn_2683.params, resultTypeId: fn_2683.resultTypeId, bodyExprId: fn_2683.bodyExprId, spanId: fn_2683.spanId, capability: capability_2684 };
return output_2685;
};
const typedFunction_2686 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return typedFunction_2686__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emptyOutput_2688 = (__arg) => {
if (__arg === undefined) {

const output_2687 = { schemaVersion: 1, functions: Js.Array.fromList(__wm_basis_Nil), captures: Js.Array.fromList(__wm_basis_Nil), specializations: Js.Array.fromList(__wm_basis_Nil), rootSpecializations: Js.Array.fromList(__wm_basis_Nil), calls: Js.Array.fromList(__wm_basis_Nil), irFunctions: Js.Array.fromList(__wm_basis_Nil), irExpressions: Js.Array.fromList(__wm_basis_Nil), types: Js.Array.fromList(__wm_basis_Nil), expressions: Js.Array.fromList(__wm_basis_Nil), diagnostics: Js.Array.fromList(__wm_basis_Nil) };
return output_2687;
}
__wm_fail("Match", "pattern match failure in function");
};
const incompatibleSchema_2692 = (__arg) => {
if (true) {
const version_2689 = __arg;
const diagnostic_2690 = { code: "gpu.schema-version", message: "unsupported GPU elaboration schema version", spanId: __wm_op_sub(1) };
const output_2691 = { schemaVersion: 1, functions: Js.Array.fromList(__wm_basis_Nil), captures: Js.Array.fromList(__wm_basis_Nil), specializations: Js.Array.fromList(__wm_basis_Nil), rootSpecializations: Js.Array.fromList(__wm_basis_Nil), calls: Js.Array.fromList(__wm_basis_Nil), irFunctions: Js.Array.fromList(__wm_basis_Nil), irExpressions: Js.Array.fromList(__wm_basis_Nil), types: Js.Array.fromList(__wm_basis_Nil), expressions: Js.Array.fromList(__wm_basis_Nil), diagnostics: Js.Array.fromList(__wm_basis_Cons([diagnostic_2690, __wm_basis_Nil])) };
return output_2691;
}
__wm_fail("Match", "pattern match failure in function");
};
const prependAll_2693__wm_d2 = (items_2694, tail_2695) => {
const __wm_scalar_132_0 = items_2694;
const __wm_scalar_132_1 = tail_2695;
if (__wm_scalar_132_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_132_1, tail_2695)) {

return tail_2695;
} else if (__wm_scalar_132_0?.ctor === -6 && __wm_scalar_132_0.args.length === 1 && __wm_is_tuple(__wm_scalar_132_0.args[0]) && __wm_scalar_132_0.args[0].length === 2 && __wm_eq(__wm_scalar_132_1, tail_2695)) {
const head_2696 = __wm_scalar_132_0.args[0][0];
const rest_2697 = __wm_scalar_132_0.args[0][1];
return __wm_basis_Cons([head_2696, prependAll_2693__wm_d2(rest_2697, tail_2695)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const prependAll_2693 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return prependAll_2693__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const reverseInto_2698__wm_d2 = (items_2699, reversed_2700) => {
__wm_tail_128: while (true) {
{
const __wm_scalar_133_0 = items_2699;
const __wm_scalar_133_1 = reversed_2700;
if (__wm_scalar_133_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_133_1, reversed_2700)) {

return reversed_2700;
} else if (__wm_scalar_133_0?.ctor === -6 && __wm_scalar_133_0.args.length === 1 && __wm_is_tuple(__wm_scalar_133_0.args[0]) && __wm_scalar_133_0.args[0].length === 2 && __wm_eq(__wm_scalar_133_1, reversed_2700)) {
const head_2701 = __wm_scalar_133_0.args[0][0];
const rest_2702 = __wm_scalar_133_0.args[0][1];
{
const __wm_tail_arg_149_0 = rest_2702;
const __wm_tail_arg_149_1 = __wm_basis_Cons([head_2701, reversed_2700]);
items_2699 = __wm_tail_arg_149_0;
reversed_2700 = __wm_tail_arg_149_1;
continue __wm_tail_128;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reverseInto_2698 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reverseInto_2698__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const capabilityDiagnostic_2706 = (__arg) => {
if (true) {
const expression_2703 = __arg;
if (__wm_eq(expression_2703.capability, "host-ffi")) {
const diagnostic_2704 = { code: "gpu.host-ffi", message: "host FFI expression cannot execute in a GPU region", spanId: expression_2703.spanId };
return __wm_basis_Some(diagnostic_2704);
} else {
if (__wm_eq(expression_2703.capability, "unsupported")) {
const diagnostic_2705 = { code: "gpu.unsupported-expression", message: "expression is not supported by the current GPU language subset", spanId: expression_2703.spanId };
return __wm_basis_Some(diagnostic_2705);
} else {
return __wm_basis_None;
}
}
}
__wm_fail("Match", "pattern match failure in function");
};
const reachableBodyIds_2707__wm_d3 = (functions_2708, reachable_2709, bodyIds_2710) => {
__wm_tail_129: while (true) {
{
const __wm_scalar_134_0 = functions_2708;
const __wm_scalar_134_1 = reachable_2709;
const __wm_scalar_134_2 = bodyIds_2710;
if (__wm_scalar_134_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_134_1, reachable_2709) && __wm_eq(__wm_scalar_134_2, bodyIds_2710)) {

return bodyIds_2710;
} else if (__wm_scalar_134_0?.ctor === -6 && __wm_scalar_134_0.args.length === 1 && __wm_is_tuple(__wm_scalar_134_0.args[0]) && __wm_scalar_134_0.args[0].length === 2 && __wm_eq(__wm_scalar_134_1, reachable_2709) && __wm_eq(__wm_scalar_134_2, bodyIds_2710)) {
const fn_2711 = __wm_scalar_134_0.args[0][0];
const rest_2712 = __wm_scalar_134_0.args[0][1];
{
const exact_2713 = fn_2711;
if (Map.has([reachable_2709, exact_2713.id])) {
{
const __wm_tail_arg_150_0 = rest_2712;
const __wm_tail_arg_150_1 = reachable_2709;
const __wm_tail_arg_150_2 = __wm_basis_Cons([exact_2713.bodyExprId, bodyIds_2710]);
functions_2708 = __wm_tail_arg_150_0;
reachable_2709 = __wm_tail_arg_150_1;
bodyIds_2710 = __wm_tail_arg_150_2;
continue __wm_tail_129;
}
} else {
{
const __wm_tail_arg_151_0 = rest_2712;
const __wm_tail_arg_151_1 = reachable_2709;
const __wm_tail_arg_151_2 = bodyIds_2710;
functions_2708 = __wm_tail_arg_151_0;
reachable_2709 = __wm_tail_arg_151_1;
bodyIds_2710 = __wm_tail_arg_151_2;
continue __wm_tail_129;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reachableBodyIds_2707 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return reachableBodyIds_2707__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const reachableCapabilityDiagnostics_2714__wm_d4 = (pending_2715, expressionRegistry_2716, visited_2717, diagnostics_2718) => {
__wm_tail_130: while (true) {
{
const __wm_scalar_135_0 = pending_2715;
const __wm_scalar_135_1 = expressionRegistry_2716;
const __wm_scalar_135_2 = visited_2717;
const __wm_scalar_135_3 = diagnostics_2718;
if (__wm_scalar_135_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_135_1, expressionRegistry_2716) && __wm_eq(__wm_scalar_135_2, visited_2717) && __wm_eq(__wm_scalar_135_3, diagnostics_2718)) {

return diagnostics_2718;
} else if (__wm_scalar_135_0?.ctor === -6 && __wm_scalar_135_0.args.length === 1 && __wm_is_tuple(__wm_scalar_135_0.args[0]) && __wm_scalar_135_0.args[0].length === 2 && __wm_eq(__wm_scalar_135_1, expressionRegistry_2716) && __wm_eq(__wm_scalar_135_2, visited_2717) && __wm_eq(__wm_scalar_135_3, diagnostics_2718)) {
const expressionId_2719 = __wm_scalar_135_0.args[0][0];
const rest_2720 = __wm_scalar_135_0.args[0][1];
if (Map.has([visited_2717, expressionId_2719])) {
{
const __wm_tail_arg_152_0 = rest_2720;
const __wm_tail_arg_152_1 = expressionRegistry_2716;
const __wm_tail_arg_152_2 = visited_2717;
const __wm_tail_arg_152_3 = diagnostics_2718;
pending_2715 = __wm_tail_arg_152_0;
expressionRegistry_2716 = __wm_tail_arg_152_1;
visited_2717 = __wm_tail_arg_152_2;
diagnostics_2718 = __wm_tail_arg_152_3;
continue __wm_tail_130;
}
} else {
{
const nextVisited_2721 = Map.set([visited_2717, expressionId_2719, true]);
{
const __wm_tail_value_153 = Map.get([expressionRegistry_2716, expressionId_2719]);
if (__wm_tail_value_153 === __wm_basis_None) {

{
const __wm_tail_arg_154_0 = rest_2720;
const __wm_tail_arg_154_1 = expressionRegistry_2716;
const __wm_tail_arg_154_2 = nextVisited_2721;
const __wm_tail_arg_154_3 = diagnostics_2718;
pending_2715 = __wm_tail_arg_154_0;
expressionRegistry_2716 = __wm_tail_arg_154_1;
visited_2717 = __wm_tail_arg_154_2;
diagnostics_2718 = __wm_tail_arg_154_3;
continue __wm_tail_130;
}
} else if (__wm_tail_value_153?.ctor === -2 && __wm_tail_value_153.args.length === 1) {
const expression_2722 = __wm_tail_value_153.args[0];
{
const nextDiagnostics_2724 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const diagnostic_2723 = __v.args[0];
return __wm_basis_Cons([diagnostic_2723, diagnostics_2718]);
} else if (__v === __wm_basis_None) {

return diagnostics_2718;
}
__wm_fail("Match", "non-exhaustive match");
})(capabilityDiagnostic_2706(expression_2722));
{
const __wm_tail_arg_155_0 = prependAll_2693__wm_d2(Js.Array.toList(expression_2722.children), rest_2720);
const __wm_tail_arg_155_1 = expressionRegistry_2716;
const __wm_tail_arg_155_2 = nextVisited_2721;
const __wm_tail_arg_155_3 = nextDiagnostics_2724;
pending_2715 = __wm_tail_arg_155_0;
expressionRegistry_2716 = __wm_tail_arg_155_1;
visited_2717 = __wm_tail_arg_155_2;
diagnostics_2718 = __wm_tail_arg_155_3;
continue __wm_tail_130;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reachableCapabilityDiagnostics_2714 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return reachableCapabilityDiagnostics_2714__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const duplicateFunctionDiagnostic_2727 = (__arg) => {
if (true) {
const fn_2725 = __arg;
const diagnostic_2726 = { code: "gpu.duplicate-function-id", message: "duplicate function ID in GPU elaboration input", spanId: fn_2725.spanId };
return diagnostic_2726;
}
__wm_fail("Match", "pattern match failure in function");
};
const registerFunctions_2728__wm_d3 = (functions_2729, registry_2730, diagnostics_2731) => {
__wm_tail_131: while (true) {
{
const __wm_scalar_136_0 = functions_2729;
const __wm_scalar_136_1 = registry_2730;
const __wm_scalar_136_2 = diagnostics_2731;
if (__wm_scalar_136_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_136_1, registry_2730) && __wm_eq(__wm_scalar_136_2, diagnostics_2731)) {

return [registry_2730, diagnostics_2731];
} else if (__wm_scalar_136_0?.ctor === -6 && __wm_scalar_136_0.args.length === 1 && __wm_is_tuple(__wm_scalar_136_0.args[0]) && __wm_scalar_136_0.args[0].length === 2 && __wm_eq(__wm_scalar_136_1, registry_2730) && __wm_eq(__wm_scalar_136_2, diagnostics_2731)) {
const fn_2732 = __wm_scalar_136_0.args[0][0];
const rest_2733 = __wm_scalar_136_0.args[0][1];
{
const exact_2734 = fn_2732;
if (Map.has([registry_2730, exact_2734.id])) {
{
const __wm_tail_arg_156_0 = rest_2733;
const __wm_tail_arg_156_1 = registry_2730;
const __wm_tail_arg_156_2 = __wm_basis_Cons([duplicateFunctionDiagnostic_2727(exact_2734), diagnostics_2731]);
functions_2729 = __wm_tail_arg_156_0;
registry_2730 = __wm_tail_arg_156_1;
diagnostics_2731 = __wm_tail_arg_156_2;
continue __wm_tail_131;
}
} else {
{
const __wm_tail_arg_157_0 = rest_2733;
const __wm_tail_arg_157_1 = Map.set([registry_2730, exact_2734.id, exact_2734]);
const __wm_tail_arg_157_2 = diagnostics_2731;
functions_2729 = __wm_tail_arg_157_0;
registry_2730 = __wm_tail_arg_157_1;
diagnostics_2731 = __wm_tail_arg_157_2;
continue __wm_tail_131;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const registerFunctions_2728 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return registerFunctions_2728__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const indexFunctionBindings_2735__wm_d2 = (functions_2736, registry_2737) => {
__wm_tail_132: while (true) {
{
const __wm_scalar_137_0 = functions_2736;
const __wm_scalar_137_1 = registry_2737;
if (__wm_scalar_137_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_137_1, registry_2737)) {

return registry_2737;
} else if (__wm_scalar_137_0?.ctor === -6 && __wm_scalar_137_0.args.length === 1 && __wm_is_tuple(__wm_scalar_137_0.args[0]) && __wm_scalar_137_0.args[0].length === 2 && __wm_eq(__wm_scalar_137_1, registry_2737)) {
const fn_2738 = __wm_scalar_137_0.args[0][0];
const rest_2739 = __wm_scalar_137_0.args[0][1];
{
const exact_2740 = fn_2738;
if ((exact_2740.bindingId < 0)) {
{
const __wm_tail_arg_158_0 = rest_2739;
const __wm_tail_arg_158_1 = registry_2737;
functions_2736 = __wm_tail_arg_158_0;
registry_2737 = __wm_tail_arg_158_1;
continue __wm_tail_132;
}
} else {
{
const __wm_tail_arg_159_0 = rest_2739;
const __wm_tail_arg_159_1 = Map.set([registry_2737, exact_2740.bindingId, exact_2740.id]);
functions_2736 = __wm_tail_arg_159_0;
registry_2737 = __wm_tail_arg_159_1;
continue __wm_tail_132;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexFunctionBindings_2735 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexFunctionBindings_2735__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const callDependency_2747__wm_d3 = (expression_2741, expressionRegistry_2742, bindingFunctions_2743) => {
if (__wm_eq(expression_2741.kind, "call")) {
const __wm_return_value_33 = Js.Array.toList(expression_2741.children);
if (__wm_return_value_33?.ctor === -6 && __wm_return_value_33.args.length === 1 && __wm_is_tuple(__wm_return_value_33.args[0]) && __wm_return_value_33.args[0].length === 2) {
const calleeId_2744 = __wm_return_value_33.args[0][0];
const _rest_2745 = __wm_return_value_33.args[0][1];
const __wm_return_value_34 = Map.get([expressionRegistry_2742, calleeId_2744]);
if (__wm_return_value_34?.ctor === -2 && __wm_return_value_34.args.length === 1) {
const callee_2746 = __wm_return_value_34.args[0];
return Map.get([bindingFunctions_2743, callee_2746.bindingId]);
} else if (__wm_return_value_34 === __wm_basis_None) {

return __wm_basis_None;
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_33 === __wm_basis_Nil) {

return __wm_basis_None;
}
__wm_fail("Match", "non-exhaustive match");
} else {
return __wm_basis_None;
}
};
const callDependency_2747 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return callDependency_2747__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const collectFunctionDependencies_2748__wm_d5 = (pending_2749, expressionRegistry_2750, bindingFunctions_2751, visited_2752, dependencies_2753) => {
__wm_tail_133: while (true) {
{
const __wm_scalar_138_0 = pending_2749;
const __wm_scalar_138_1 = expressionRegistry_2750;
const __wm_scalar_138_2 = bindingFunctions_2751;
const __wm_scalar_138_3 = visited_2752;
const __wm_scalar_138_4 = dependencies_2753;
if (__wm_scalar_138_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_138_1, expressionRegistry_2750) && __wm_eq(__wm_scalar_138_2, bindingFunctions_2751) && __wm_eq(__wm_scalar_138_3, visited_2752) && __wm_eq(__wm_scalar_138_4, dependencies_2753)) {

return dependencies_2753;
} else if (__wm_scalar_138_0?.ctor === -6 && __wm_scalar_138_0.args.length === 1 && __wm_is_tuple(__wm_scalar_138_0.args[0]) && __wm_scalar_138_0.args[0].length === 2 && __wm_eq(__wm_scalar_138_1, expressionRegistry_2750) && __wm_eq(__wm_scalar_138_2, bindingFunctions_2751) && __wm_eq(__wm_scalar_138_3, visited_2752) && __wm_eq(__wm_scalar_138_4, dependencies_2753)) {
const expressionId_2754 = __wm_scalar_138_0.args[0][0];
const rest_2755 = __wm_scalar_138_0.args[0][1];
if (Map.has([visited_2752, expressionId_2754])) {
{
const __wm_tail_arg_160_0 = rest_2755;
const __wm_tail_arg_160_1 = expressionRegistry_2750;
const __wm_tail_arg_160_2 = bindingFunctions_2751;
const __wm_tail_arg_160_3 = visited_2752;
const __wm_tail_arg_160_4 = dependencies_2753;
pending_2749 = __wm_tail_arg_160_0;
expressionRegistry_2750 = __wm_tail_arg_160_1;
bindingFunctions_2751 = __wm_tail_arg_160_2;
visited_2752 = __wm_tail_arg_160_3;
dependencies_2753 = __wm_tail_arg_160_4;
continue __wm_tail_133;
}
} else {
{
const nextVisited_2756 = Map.set([visited_2752, expressionId_2754, true]);
{
const __wm_tail_value_161 = Map.get([expressionRegistry_2750, expressionId_2754]);
if (__wm_tail_value_161 === __wm_basis_None) {

{
const __wm_tail_arg_162_0 = rest_2755;
const __wm_tail_arg_162_1 = expressionRegistry_2750;
const __wm_tail_arg_162_2 = bindingFunctions_2751;
const __wm_tail_arg_162_3 = nextVisited_2756;
const __wm_tail_arg_162_4 = dependencies_2753;
pending_2749 = __wm_tail_arg_162_0;
expressionRegistry_2750 = __wm_tail_arg_162_1;
bindingFunctions_2751 = __wm_tail_arg_162_2;
visited_2752 = __wm_tail_arg_162_3;
dependencies_2753 = __wm_tail_arg_162_4;
continue __wm_tail_133;
}
} else if (__wm_tail_value_161?.ctor === -2 && __wm_tail_value_161.args.length === 1) {
const expression_2757 = __wm_tail_value_161.args[0];
{
const nextDependencies_2759 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const functionId_2758 = __v.args[0];
return Map.set([dependencies_2753, functionId_2758, true]);
} else if (__v === __wm_basis_None) {

return dependencies_2753;
}
__wm_fail("Match", "non-exhaustive match");
})(callDependency_2747__wm_d3(expression_2757, expressionRegistry_2750, bindingFunctions_2751));
{
const __wm_tail_arg_163_0 = prependAll_2693__wm_d2(Js.Array.toList(expression_2757.children), rest_2755);
const __wm_tail_arg_163_1 = expressionRegistry_2750;
const __wm_tail_arg_163_2 = bindingFunctions_2751;
const __wm_tail_arg_163_3 = nextVisited_2756;
const __wm_tail_arg_163_4 = nextDependencies_2759;
pending_2749 = __wm_tail_arg_163_0;
expressionRegistry_2750 = __wm_tail_arg_163_1;
bindingFunctions_2751 = __wm_tail_arg_163_2;
visited_2752 = __wm_tail_arg_163_3;
dependencies_2753 = __wm_tail_arg_163_4;
continue __wm_tail_133;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const collectFunctionDependencies_2748 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return collectFunctionDependencies_2748__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const enqueueDependencies_2760__wm_d2 = (entries_2761, pending_2762) => {
__wm_tail_134: while (true) {
{
const __wm_scalar_139_0 = entries_2761;
const __wm_scalar_139_1 = pending_2762;
if (__wm_scalar_139_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_139_1, pending_2762)) {

return pending_2762;
} else if (__wm_scalar_139_0?.ctor === -6 && __wm_scalar_139_0.args.length === 1 && __wm_is_tuple(__wm_scalar_139_0.args[0]) && __wm_scalar_139_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_139_0.args[0][0]) && __wm_scalar_139_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_139_1, pending_2762)) {
const functionId_2763 = __wm_scalar_139_0.args[0][0][0];
const _reachable_2764 = __wm_scalar_139_0.args[0][0][1];
const rest_2765 = __wm_scalar_139_0.args[0][1];
{
const __wm_tail_arg_164_0 = rest_2765;
const __wm_tail_arg_164_1 = __wm_basis_Cons([functionId_2763, pending_2762]);
entries_2761 = __wm_tail_arg_164_0;
pending_2762 = __wm_tail_arg_164_1;
continue __wm_tail_134;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const enqueueDependencies_2760 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return enqueueDependencies_2760__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const rootFunctionIds_2766__wm_d2 = (roots_2767, functionIds_2768) => {
__wm_tail_135: while (true) {
{
const __wm_scalar_140_0 = roots_2767;
const __wm_scalar_140_1 = functionIds_2768;
if (__wm_scalar_140_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_140_1, functionIds_2768)) {

return functionIds_2768;
} else if (__wm_scalar_140_0?.ctor === -6 && __wm_scalar_140_0.args.length === 1 && __wm_is_tuple(__wm_scalar_140_0.args[0]) && __wm_scalar_140_0.args[0].length === 2 && __wm_eq(__wm_scalar_140_1, functionIds_2768)) {
const root_2769 = __wm_scalar_140_0.args[0][0];
const rest_2770 = __wm_scalar_140_0.args[0][1];
{
const __wm_tail_arg_165_0 = rest_2770;
const __wm_tail_arg_165_1 = __wm_basis_Cons([root_2769.functionId, functionIds_2768]);
roots_2767 = __wm_tail_arg_165_0;
functionIds_2768 = __wm_tail_arg_165_1;
continue __wm_tail_135;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const rootFunctionIds_2766 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return rootFunctionIds_2766__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const solveReachableFunctions_2771__wm_d5 = (pending_2772, functionRegistry_2773, expressionRegistry_2774, bindingFunctions_2775, reachable_2776) => {
__wm_tail_136: while (true) {
{
const __wm_scalar_141_0 = pending_2772;
const __wm_scalar_141_1 = functionRegistry_2773;
const __wm_scalar_141_2 = expressionRegistry_2774;
const __wm_scalar_141_3 = bindingFunctions_2775;
const __wm_scalar_141_4 = reachable_2776;
if (__wm_scalar_141_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_141_1, functionRegistry_2773) && __wm_eq(__wm_scalar_141_2, expressionRegistry_2774) && __wm_eq(__wm_scalar_141_3, bindingFunctions_2775) && __wm_eq(__wm_scalar_141_4, reachable_2776)) {

return reachable_2776;
} else if (__wm_scalar_141_0?.ctor === -6 && __wm_scalar_141_0.args.length === 1 && __wm_is_tuple(__wm_scalar_141_0.args[0]) && __wm_scalar_141_0.args[0].length === 2 && __wm_eq(__wm_scalar_141_1, functionRegistry_2773) && __wm_eq(__wm_scalar_141_2, expressionRegistry_2774) && __wm_eq(__wm_scalar_141_3, bindingFunctions_2775) && __wm_eq(__wm_scalar_141_4, reachable_2776)) {
const functionId_2777 = __wm_scalar_141_0.args[0][0];
const rest_2778 = __wm_scalar_141_0.args[0][1];
if (Map.has([reachable_2776, functionId_2777])) {
{
const __wm_tail_arg_166_0 = rest_2778;
const __wm_tail_arg_166_1 = functionRegistry_2773;
const __wm_tail_arg_166_2 = expressionRegistry_2774;
const __wm_tail_arg_166_3 = bindingFunctions_2775;
const __wm_tail_arg_166_4 = reachable_2776;
pending_2772 = __wm_tail_arg_166_0;
functionRegistry_2773 = __wm_tail_arg_166_1;
expressionRegistry_2774 = __wm_tail_arg_166_2;
bindingFunctions_2775 = __wm_tail_arg_166_3;
reachable_2776 = __wm_tail_arg_166_4;
continue __wm_tail_136;
}
} else {
{
const nextReachable_2779 = Map.set([reachable_2776, functionId_2777, true]);
{
const __wm_tail_value_167 = Map.get([functionRegistry_2773, functionId_2777]);
if (__wm_tail_value_167 === __wm_basis_None) {

{
const __wm_tail_arg_168_0 = rest_2778;
const __wm_tail_arg_168_1 = functionRegistry_2773;
const __wm_tail_arg_168_2 = expressionRegistry_2774;
const __wm_tail_arg_168_3 = bindingFunctions_2775;
const __wm_tail_arg_168_4 = nextReachable_2779;
pending_2772 = __wm_tail_arg_168_0;
functionRegistry_2773 = __wm_tail_arg_168_1;
expressionRegistry_2774 = __wm_tail_arg_168_2;
bindingFunctions_2775 = __wm_tail_arg_168_3;
reachable_2776 = __wm_tail_arg_168_4;
continue __wm_tail_136;
}
} else if (__wm_tail_value_167?.ctor === -2 && __wm_tail_value_167.args.length === 1) {
const fn_2780 = __wm_tail_value_167.args[0];
{
const dependencies_2781 = collectFunctionDependencies_2748__wm_d5(__wm_basis_Cons([fn_2780.bodyExprId, __wm_basis_Nil]), expressionRegistry_2774, bindingFunctions_2775, Map.empty(Map.numberCompare), Map.empty(Map.numberCompare));
{
const __wm_tail_arg_169_0 = enqueueDependencies_2760__wm_d2(Map.toList(dependencies_2781), rest_2778);
const __wm_tail_arg_169_1 = functionRegistry_2773;
const __wm_tail_arg_169_2 = expressionRegistry_2774;
const __wm_tail_arg_169_3 = bindingFunctions_2775;
const __wm_tail_arg_169_4 = nextReachable_2779;
pending_2772 = __wm_tail_arg_169_0;
functionRegistry_2773 = __wm_tail_arg_169_1;
expressionRegistry_2774 = __wm_tail_arg_169_2;
bindingFunctions_2775 = __wm_tail_arg_169_3;
reachable_2776 = __wm_tail_arg_169_4;
continue __wm_tail_136;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const solveReachableFunctions_2771 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return solveReachableFunctions_2771__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const indexBindings_2782__wm_d2 = (bindings_2783, registry_2784) => {
__wm_tail_137: while (true) {
{
const __wm_scalar_142_0 = bindings_2783;
const __wm_scalar_142_1 = registry_2784;
if (__wm_scalar_142_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_142_1, registry_2784)) {

return registry_2784;
} else if (__wm_scalar_142_0?.ctor === -6 && __wm_scalar_142_0.args.length === 1 && __wm_is_tuple(__wm_scalar_142_0.args[0]) && __wm_scalar_142_0.args[0].length === 2 && __wm_eq(__wm_scalar_142_1, registry_2784)) {
const binding_2785 = __wm_scalar_142_0.args[0][0];
const rest_2786 = __wm_scalar_142_0.args[0][1];
{
const exact_2787 = binding_2785;
{
const __wm_tail_arg_170_0 = rest_2786;
const __wm_tail_arg_170_1 = Map.set([registry_2784, exact_2787.id, exact_2787]);
bindings_2783 = __wm_tail_arg_170_0;
registry_2784 = __wm_tail_arg_170_1;
continue __wm_tail_137;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexBindings_2782 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexBindings_2782__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const bindParams_2788__wm_d2 = (params_2789, bound_2790) => {
__wm_tail_138: while (true) {
{
const __wm_scalar_143_0 = params_2789;
const __wm_scalar_143_1 = bound_2790;
if (__wm_scalar_143_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_143_1, bound_2790)) {

return bound_2790;
} else if (__wm_scalar_143_0?.ctor === -6 && __wm_scalar_143_0.args.length === 1 && __wm_is_tuple(__wm_scalar_143_0.args[0]) && __wm_scalar_143_0.args[0].length === 2 && __wm_eq(__wm_scalar_143_1, bound_2790)) {
const param_2791 = __wm_scalar_143_0.args[0][0];
const rest_2792 = __wm_scalar_143_0.args[0][1];
{
const exact_2793 = param_2791;
{
const __wm_tail_arg_171_0 = rest_2792;
const __wm_tail_arg_171_1 = Map.set([bound_2790, exact_2793.bindingId, true]);
params_2789 = __wm_tail_arg_171_0;
bound_2790 = __wm_tail_arg_171_1;
continue __wm_tail_138;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const bindParams_2788 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return bindParams_2788__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collectLocalBindings_2794__wm_d4 = (pending_2795, expressionRegistry_2796, visited_2797, bound_2798) => {
__wm_tail_139: while (true) {
{
const __wm_scalar_144_0 = pending_2795;
const __wm_scalar_144_1 = expressionRegistry_2796;
const __wm_scalar_144_2 = visited_2797;
const __wm_scalar_144_3 = bound_2798;
if (__wm_scalar_144_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_144_1, expressionRegistry_2796) && __wm_eq(__wm_scalar_144_2, visited_2797) && __wm_eq(__wm_scalar_144_3, bound_2798)) {

return bound_2798;
} else if (__wm_scalar_144_0?.ctor === -6 && __wm_scalar_144_0.args.length === 1 && __wm_is_tuple(__wm_scalar_144_0.args[0]) && __wm_scalar_144_0.args[0].length === 2 && __wm_eq(__wm_scalar_144_1, expressionRegistry_2796) && __wm_eq(__wm_scalar_144_2, visited_2797) && __wm_eq(__wm_scalar_144_3, bound_2798)) {
const expressionId_2799 = __wm_scalar_144_0.args[0][0];
const rest_2800 = __wm_scalar_144_0.args[0][1];
if (Map.has([visited_2797, expressionId_2799])) {
{
const __wm_tail_arg_172_0 = rest_2800;
const __wm_tail_arg_172_1 = expressionRegistry_2796;
const __wm_tail_arg_172_2 = visited_2797;
const __wm_tail_arg_172_3 = bound_2798;
pending_2795 = __wm_tail_arg_172_0;
expressionRegistry_2796 = __wm_tail_arg_172_1;
visited_2797 = __wm_tail_arg_172_2;
bound_2798 = __wm_tail_arg_172_3;
continue __wm_tail_139;
}
} else {
{
const nextVisited_2801 = Map.set([visited_2797, expressionId_2799, true]);
{
const __wm_tail_value_173 = Map.get([expressionRegistry_2796, expressionId_2799]);
if (__wm_tail_value_173 === __wm_basis_None) {

{
const __wm_tail_arg_174_0 = rest_2800;
const __wm_tail_arg_174_1 = expressionRegistry_2796;
const __wm_tail_arg_174_2 = nextVisited_2801;
const __wm_tail_arg_174_3 = bound_2798;
pending_2795 = __wm_tail_arg_174_0;
expressionRegistry_2796 = __wm_tail_arg_174_1;
visited_2797 = __wm_tail_arg_174_2;
bound_2798 = __wm_tail_arg_174_3;
continue __wm_tail_139;
}
} else if (__wm_tail_value_173?.ctor === -2 && __wm_tail_value_173.args.length === 1) {
const expression_2802 = __wm_tail_value_173.args[0];
{
const exact_2803 = expression_2802;
const nextBound_2804 = (__wm_op_and_d2(__wm_eq(exact_2803.kind, "let"), (exact_2803.bindingId >= 0)) ? Map.set([bound_2798, exact_2803.bindingId, true]) : bound_2798);
{
const __wm_tail_arg_175_0 = prependAll_2693__wm_d2(Js.Array.toList(exact_2803.children), rest_2800);
const __wm_tail_arg_175_1 = expressionRegistry_2796;
const __wm_tail_arg_175_2 = nextVisited_2801;
const __wm_tail_arg_175_3 = nextBound_2804;
pending_2795 = __wm_tail_arg_175_0;
expressionRegistry_2796 = __wm_tail_arg_175_1;
visited_2797 = __wm_tail_arg_175_2;
bound_2798 = __wm_tail_arg_175_3;
continue __wm_tail_139;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const collectLocalBindings_2794 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return collectLocalBindings_2794__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const constantExpression_2805__wm_d5 = (expressionId_2807, expressionRegistry_2808, bindingRegistry_2809, visitedExpressions_2810, visitedBindings_2811) => {
__wm_tail_140: while (true) {
if (Map.has([visitedExpressions_2810, expressionId_2807])) {
return false;
} else {
{
const __wm_tail_value_176 = Map.get([expressionRegistry_2808, expressionId_2807]);
if (__wm_tail_value_176 === __wm_basis_None) {

return false;
} else if (__wm_tail_value_176?.ctor === -2 && __wm_tail_value_176.args.length === 1) {
const expression_2812 = __wm_tail_value_176.args[0];
{
const nextExpressions_2813 = Map.set([visitedExpressions_2810, expressionId_2807, true]);
if (__wm_op_or_d2(__wm_eq(expression_2812.kind, "number"), __wm_eq(expression_2812.kind, "bool"))) {
return true;
} else {
if (__wm_op_or_d2(__wm_op_or_d2(__wm_eq(expression_2812.kind, "tuple"), __wm_eq(expression_2812.kind, "binary")), __wm_eq(expression_2812.kind, "unary"))) {
return constantExpressions_2806__wm_d5(Js.Array.toList(expression_2812.children), expressionRegistry_2808, bindingRegistry_2809, nextExpressions_2813, visitedBindings_2811);
} else {
if (__wm_op_and_d2(__wm_eq(expression_2812.kind, "var"), (expression_2812.bindingId >= 0))) {
if (Map.has([visitedBindings_2811, expression_2812.bindingId])) {
return false;
} else {
{
const __wm_tail_value_177 = Map.get([bindingRegistry_2809, expression_2812.bindingId]);
if (__wm_tail_value_177?.ctor === -2 && __wm_tail_value_177.args.length === 1) {
const binding_2814 = __wm_tail_value_177.args[0];
if ((binding_2814.definitionExprId >= 0)) {
{
const __wm_tail_arg_178_0 = binding_2814.definitionExprId;
const __wm_tail_arg_178_1 = expressionRegistry_2808;
const __wm_tail_arg_178_2 = bindingRegistry_2809;
const __wm_tail_arg_178_3 = nextExpressions_2813;
const __wm_tail_arg_178_4 = Map.set([visitedBindings_2811, expression_2812.bindingId, true]);
expressionId_2807 = __wm_tail_arg_178_0;
expressionRegistry_2808 = __wm_tail_arg_178_1;
bindingRegistry_2809 = __wm_tail_arg_178_2;
visitedExpressions_2810 = __wm_tail_arg_178_3;
visitedBindings_2811 = __wm_tail_arg_178_4;
continue __wm_tail_140;
}
} else {
return false;
}
} else if (__wm_tail_value_177 === __wm_basis_None) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
}
}
} else {
return false;
}
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
}
};
const constantExpression_2805 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return constantExpression_2805__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const constantExpressions_2806__wm_d5 = (pending_2815, expressionRegistry_2816, bindingRegistry_2817, visitedExpressions_2818, visitedBindings_2819) => {
const __wm_scalar_145_0 = pending_2815;
const __wm_scalar_145_1 = expressionRegistry_2816;
const __wm_scalar_145_2 = bindingRegistry_2817;
const __wm_scalar_145_3 = visitedExpressions_2818;
const __wm_scalar_145_4 = visitedBindings_2819;
if (__wm_scalar_145_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_145_1, expressionRegistry_2816) && __wm_eq(__wm_scalar_145_2, bindingRegistry_2817) && __wm_eq(__wm_scalar_145_3, visitedExpressions_2818) && __wm_eq(__wm_scalar_145_4, visitedBindings_2819)) {

return true;
} else if (__wm_scalar_145_0?.ctor === -6 && __wm_scalar_145_0.args.length === 1 && __wm_is_tuple(__wm_scalar_145_0.args[0]) && __wm_scalar_145_0.args[0].length === 2 && __wm_eq(__wm_scalar_145_1, expressionRegistry_2816) && __wm_eq(__wm_scalar_145_2, bindingRegistry_2817) && __wm_eq(__wm_scalar_145_3, visitedExpressions_2818) && __wm_eq(__wm_scalar_145_4, visitedBindings_2819)) {
const expressionId_2820 = __wm_scalar_145_0.args[0][0];
const rest_2821 = __wm_scalar_145_0.args[0][1];
return __wm_op_and_d2(constantExpression_2805__wm_d5(expressionId_2820, expressionRegistry_2816, bindingRegistry_2817, visitedExpressions_2818, visitedBindings_2819), constantExpressions_2806__wm_d5(rest_2821, expressionRegistry_2816, bindingRegistry_2817, visitedExpressions_2818, visitedBindings_2819));
}
__wm_fail("Match", "non-exhaustive match");
};
const constantExpressions_2806 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return constantExpressions_2806__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const reifiableCaptureType_2826__wm_d2 = (typeRegistry_2822, typeId_2823) => {
const __wm_return_value_35 = Map.get([typeRegistry_2822, typeId_2823]);
if (__wm_return_value_35?.ctor === -2 && __wm_return_value_35.args.length === 1) {
const gpuType_2824 = __wm_return_value_35.args[0];
const exact_2825 = gpuType_2824;
return __wm_op_or_d2(__wm_op_or_d2(__wm_eq(exact_2825.kind, "number"), __wm_eq(exact_2825.kind, "bool")), __wm_eq(exact_2825.kind, "vector"));
} else if (__wm_return_value_35 === __wm_basis_None) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
};
const reifiableCaptureType_2826 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reifiableCaptureType_2826__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const captureCategory_2837__wm_d7 = (bindingId_2827, typeId_2828, reachable_2829, bindingFunctions_2830, bindingRegistry_2831, expressionRegistry_2832, typeRegistry_2833) => {
const __wm_return_value_36 = Map.get([bindingFunctions_2830, bindingId_2827]);
if (__wm_return_value_36?.ctor === -2 && __wm_return_value_36.args.length === 1) {
const functionId_2834 = __wm_return_value_36.args[0];
if (Map.has([reachable_2829, functionId_2834])) {
return "function";
} else {
return "illegal";
}
} else if (__wm_return_value_36 === __wm_basis_None) {

if (reifiableCaptureType_2826__wm_d2(typeRegistry_2833, typeId_2828)) {
const __wm_return_value_37 = Map.get([bindingRegistry_2831, bindingId_2827]);
if (__wm_return_value_37?.ctor === -2 && __wm_return_value_37.args.length === 1) {
const binding_2835 = __wm_return_value_37.args[0];
const exactBinding_2836 = binding_2835;
if (__wm_op_and_d2((exactBinding_2836.definitionExprId >= 0), constantExpression_2805__wm_d5(exactBinding_2836.definitionExprId, expressionRegistry_2832, bindingRegistry_2831, Map.empty(Map.numberCompare), Map.empty(Map.numberCompare)))) {
return "constant";
} else {
return "uniform";
}
} else if (__wm_return_value_37 === __wm_basis_None) {

return "illegal";
}
__wm_fail("Match", "non-exhaustive match");
} else {
return "illegal";
}
}
__wm_fail("Match", "non-exhaustive match");
};
const captureCategory_2837 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return captureCategory_2837__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const collectFunctionCaptures_2838__wm_d10 = (pending_2839, regionId_2840, reachable_2841, bound_2842, expressionRegistry_2843, bindingFunctions_2844, bindingRegistry_2845, typeRegistry_2846, visited_2847, captures_2848) => {
__wm_tail_141: while (true) {
{
const __wm_scalar_146_0 = pending_2839;
const __wm_scalar_146_1 = regionId_2840;
const __wm_scalar_146_2 = reachable_2841;
const __wm_scalar_146_3 = bound_2842;
const __wm_scalar_146_4 = expressionRegistry_2843;
const __wm_scalar_146_5 = bindingFunctions_2844;
const __wm_scalar_146_6 = bindingRegistry_2845;
const __wm_scalar_146_7 = typeRegistry_2846;
const __wm_scalar_146_8 = visited_2847;
const __wm_scalar_146_9 = captures_2848;
if (__wm_scalar_146_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_146_1, regionId_2840) && __wm_eq(__wm_scalar_146_2, reachable_2841) && __wm_eq(__wm_scalar_146_3, bound_2842) && __wm_eq(__wm_scalar_146_4, expressionRegistry_2843) && __wm_eq(__wm_scalar_146_5, bindingFunctions_2844) && __wm_eq(__wm_scalar_146_6, bindingRegistry_2845) && __wm_eq(__wm_scalar_146_7, typeRegistry_2846) && __wm_eq(__wm_scalar_146_8, visited_2847) && __wm_eq(__wm_scalar_146_9, captures_2848)) {

return captures_2848;
} else if (__wm_scalar_146_0?.ctor === -6 && __wm_scalar_146_0.args.length === 1 && __wm_is_tuple(__wm_scalar_146_0.args[0]) && __wm_scalar_146_0.args[0].length === 2 && __wm_eq(__wm_scalar_146_1, regionId_2840) && __wm_eq(__wm_scalar_146_2, reachable_2841) && __wm_eq(__wm_scalar_146_3, bound_2842) && __wm_eq(__wm_scalar_146_4, expressionRegistry_2843) && __wm_eq(__wm_scalar_146_5, bindingFunctions_2844) && __wm_eq(__wm_scalar_146_6, bindingRegistry_2845) && __wm_eq(__wm_scalar_146_7, typeRegistry_2846) && __wm_eq(__wm_scalar_146_8, visited_2847) && __wm_eq(__wm_scalar_146_9, captures_2848)) {
const expressionId_2849 = __wm_scalar_146_0.args[0][0];
const rest_2850 = __wm_scalar_146_0.args[0][1];
if (Map.has([visited_2847, expressionId_2849])) {
{
const __wm_tail_arg_179_0 = rest_2850;
const __wm_tail_arg_179_1 = regionId_2840;
const __wm_tail_arg_179_2 = reachable_2841;
const __wm_tail_arg_179_3 = bound_2842;
const __wm_tail_arg_179_4 = expressionRegistry_2843;
const __wm_tail_arg_179_5 = bindingFunctions_2844;
const __wm_tail_arg_179_6 = bindingRegistry_2845;
const __wm_tail_arg_179_7 = typeRegistry_2846;
const __wm_tail_arg_179_8 = visited_2847;
const __wm_tail_arg_179_9 = captures_2848;
pending_2839 = __wm_tail_arg_179_0;
regionId_2840 = __wm_tail_arg_179_1;
reachable_2841 = __wm_tail_arg_179_2;
bound_2842 = __wm_tail_arg_179_3;
expressionRegistry_2843 = __wm_tail_arg_179_4;
bindingFunctions_2844 = __wm_tail_arg_179_5;
bindingRegistry_2845 = __wm_tail_arg_179_6;
typeRegistry_2846 = __wm_tail_arg_179_7;
visited_2847 = __wm_tail_arg_179_8;
captures_2848 = __wm_tail_arg_179_9;
continue __wm_tail_141;
}
} else {
{
const nextVisited_2851 = Map.set([visited_2847, expressionId_2849, true]);
{
const __wm_tail_value_180 = Map.get([expressionRegistry_2843, expressionId_2849]);
if (__wm_tail_value_180 === __wm_basis_None) {

{
const __wm_tail_arg_181_0 = rest_2850;
const __wm_tail_arg_181_1 = regionId_2840;
const __wm_tail_arg_181_2 = reachable_2841;
const __wm_tail_arg_181_3 = bound_2842;
const __wm_tail_arg_181_4 = expressionRegistry_2843;
const __wm_tail_arg_181_5 = bindingFunctions_2844;
const __wm_tail_arg_181_6 = bindingRegistry_2845;
const __wm_tail_arg_181_7 = typeRegistry_2846;
const __wm_tail_arg_181_8 = nextVisited_2851;
const __wm_tail_arg_181_9 = captures_2848;
pending_2839 = __wm_tail_arg_181_0;
regionId_2840 = __wm_tail_arg_181_1;
reachable_2841 = __wm_tail_arg_181_2;
bound_2842 = __wm_tail_arg_181_3;
expressionRegistry_2843 = __wm_tail_arg_181_4;
bindingFunctions_2844 = __wm_tail_arg_181_5;
bindingRegistry_2845 = __wm_tail_arg_181_6;
typeRegistry_2846 = __wm_tail_arg_181_7;
visited_2847 = __wm_tail_arg_181_8;
captures_2848 = __wm_tail_arg_181_9;
continue __wm_tail_141;
}
} else if (__wm_tail_value_180?.ctor === -2 && __wm_tail_value_180.args.length === 1) {
const expression_2852 = __wm_tail_value_180.args[0];
{
const exactExpression_2853 = expression_2852;
const captureTypeId_2856 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const binding_2854 = __v.args[0];
const exactBinding_2855 = binding_2854;
return exactBinding_2855.typeId;
} else if (__v === __wm_basis_None) {

return exactExpression_2853.typeId;
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([bindingRegistry_2845, exactExpression_2853.bindingId]));
const nextCaptures_2858 = (__wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(__wm_eq(exactExpression_2853.kind, "var"), (exactExpression_2853.bindingId >= 0)), __wm_op_not(Map.has([bound_2842, exactExpression_2853.bindingId]))), __wm_op_not(Map.has([captures_2848, exactExpression_2853.bindingId]))) ? (() => {
const capture_2857 = { regionId: regionId_2840, bindingId: exactExpression_2853.bindingId, typeId: captureTypeId_2856, spanId: exactExpression_2853.spanId, category: captureCategory_2837__wm_d7(exactExpression_2853.bindingId, captureTypeId_2856, reachable_2841, bindingFunctions_2844, bindingRegistry_2845, expressionRegistry_2843, typeRegistry_2846) };
return Map.set([captures_2848, exactExpression_2853.bindingId, capture_2857]);
})() : captures_2848);
{
const __wm_tail_arg_182_0 = prependAll_2693__wm_d2(Js.Array.toList(exactExpression_2853.children), rest_2850);
const __wm_tail_arg_182_1 = regionId_2840;
const __wm_tail_arg_182_2 = reachable_2841;
const __wm_tail_arg_182_3 = bound_2842;
const __wm_tail_arg_182_4 = expressionRegistry_2843;
const __wm_tail_arg_182_5 = bindingFunctions_2844;
const __wm_tail_arg_182_6 = bindingRegistry_2845;
const __wm_tail_arg_182_7 = typeRegistry_2846;
const __wm_tail_arg_182_8 = nextVisited_2851;
const __wm_tail_arg_182_9 = nextCaptures_2858;
pending_2839 = __wm_tail_arg_182_0;
regionId_2840 = __wm_tail_arg_182_1;
reachable_2841 = __wm_tail_arg_182_2;
bound_2842 = __wm_tail_arg_182_3;
expressionRegistry_2843 = __wm_tail_arg_182_4;
bindingFunctions_2844 = __wm_tail_arg_182_5;
bindingRegistry_2845 = __wm_tail_arg_182_6;
typeRegistry_2846 = __wm_tail_arg_182_7;
visited_2847 = __wm_tail_arg_182_8;
captures_2848 = __wm_tail_arg_182_9;
continue __wm_tail_141;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const collectFunctionCaptures_2838 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return collectFunctionCaptures_2838__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
const collectReachableCaptures_2859__wm_d9 = (functionEntries_2860, regionId_2861, reachable_2862, functionRegistry_2863, expressionRegistry_2864, bindingFunctions_2865, bindingRegistry_2866, typeRegistry_2867, captures_2868) => {
__wm_tail_142: while (true) {
{
const __wm_scalar_147_0 = functionEntries_2860;
const __wm_scalar_147_1 = regionId_2861;
const __wm_scalar_147_2 = reachable_2862;
const __wm_scalar_147_3 = functionRegistry_2863;
const __wm_scalar_147_4 = expressionRegistry_2864;
const __wm_scalar_147_5 = bindingFunctions_2865;
const __wm_scalar_147_6 = bindingRegistry_2866;
const __wm_scalar_147_7 = typeRegistry_2867;
const __wm_scalar_147_8 = captures_2868;
if (__wm_scalar_147_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_147_1, regionId_2861) && __wm_eq(__wm_scalar_147_2, reachable_2862) && __wm_eq(__wm_scalar_147_3, functionRegistry_2863) && __wm_eq(__wm_scalar_147_4, expressionRegistry_2864) && __wm_eq(__wm_scalar_147_5, bindingFunctions_2865) && __wm_eq(__wm_scalar_147_6, bindingRegistry_2866) && __wm_eq(__wm_scalar_147_7, typeRegistry_2867) && __wm_eq(__wm_scalar_147_8, captures_2868)) {

return captures_2868;
} else if (__wm_scalar_147_0?.ctor === -6 && __wm_scalar_147_0.args.length === 1 && __wm_is_tuple(__wm_scalar_147_0.args[0]) && __wm_scalar_147_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_147_0.args[0][0]) && __wm_scalar_147_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_147_1, regionId_2861) && __wm_eq(__wm_scalar_147_2, reachable_2862) && __wm_eq(__wm_scalar_147_3, functionRegistry_2863) && __wm_eq(__wm_scalar_147_4, expressionRegistry_2864) && __wm_eq(__wm_scalar_147_5, bindingFunctions_2865) && __wm_eq(__wm_scalar_147_6, bindingRegistry_2866) && __wm_eq(__wm_scalar_147_7, typeRegistry_2867) && __wm_eq(__wm_scalar_147_8, captures_2868)) {
const functionId_2869 = __wm_scalar_147_0.args[0][0][0];
const _present_2870 = __wm_scalar_147_0.args[0][0][1];
const rest_2871 = __wm_scalar_147_0.args[0][1];
{
const __wm_tail_value_183 = Map.get([functionRegistry_2863, functionId_2869]);
if (__wm_tail_value_183 === __wm_basis_None) {

{
const __wm_tail_arg_184_0 = rest_2871;
const __wm_tail_arg_184_1 = regionId_2861;
const __wm_tail_arg_184_2 = reachable_2862;
const __wm_tail_arg_184_3 = functionRegistry_2863;
const __wm_tail_arg_184_4 = expressionRegistry_2864;
const __wm_tail_arg_184_5 = bindingFunctions_2865;
const __wm_tail_arg_184_6 = bindingRegistry_2866;
const __wm_tail_arg_184_7 = typeRegistry_2867;
const __wm_tail_arg_184_8 = captures_2868;
functionEntries_2860 = __wm_tail_arg_184_0;
regionId_2861 = __wm_tail_arg_184_1;
reachable_2862 = __wm_tail_arg_184_2;
functionRegistry_2863 = __wm_tail_arg_184_3;
expressionRegistry_2864 = __wm_tail_arg_184_4;
bindingFunctions_2865 = __wm_tail_arg_184_5;
bindingRegistry_2866 = __wm_tail_arg_184_6;
typeRegistry_2867 = __wm_tail_arg_184_7;
captures_2868 = __wm_tail_arg_184_8;
continue __wm_tail_142;
}
} else if (__wm_tail_value_183?.ctor === -2 && __wm_tail_value_183.args.length === 1) {
const fn_2872 = __wm_tail_value_183.args[0];
{
const paramBound_2873 = bindParams_2788__wm_d2(Js.Array.toList(fn_2872.params), Map.empty(Map.numberCompare));
const bound_2874 = collectLocalBindings_2794__wm_d4(__wm_basis_Cons([fn_2872.bodyExprId, __wm_basis_Nil]), expressionRegistry_2864, Map.empty(Map.numberCompare), paramBound_2873);
const nextCaptures_2875 = collectFunctionCaptures_2838__wm_d10(__wm_basis_Cons([fn_2872.bodyExprId, __wm_basis_Nil]), regionId_2861, reachable_2862, bound_2874, expressionRegistry_2864, bindingFunctions_2865, bindingRegistry_2866, typeRegistry_2867, Map.empty(Map.numberCompare), captures_2868);
{
const __wm_tail_arg_185_0 = rest_2871;
const __wm_tail_arg_185_1 = regionId_2861;
const __wm_tail_arg_185_2 = reachable_2862;
const __wm_tail_arg_185_3 = functionRegistry_2863;
const __wm_tail_arg_185_4 = expressionRegistry_2864;
const __wm_tail_arg_185_5 = bindingFunctions_2865;
const __wm_tail_arg_185_6 = bindingRegistry_2866;
const __wm_tail_arg_185_7 = typeRegistry_2867;
const __wm_tail_arg_185_8 = nextCaptures_2875;
functionEntries_2860 = __wm_tail_arg_185_0;
regionId_2861 = __wm_tail_arg_185_1;
reachable_2862 = __wm_tail_arg_185_2;
functionRegistry_2863 = __wm_tail_arg_185_3;
expressionRegistry_2864 = __wm_tail_arg_185_4;
bindingFunctions_2865 = __wm_tail_arg_185_5;
bindingRegistry_2866 = __wm_tail_arg_185_6;
typeRegistry_2867 = __wm_tail_arg_185_7;
captures_2868 = __wm_tail_arg_185_8;
continue __wm_tail_142;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const collectReachableCaptures_2859 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return collectReachableCaptures_2859__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const captureValues_2876__wm_d2 = (entries_2877, captures_2878) => {
__wm_tail_143: while (true) {
{
const __wm_scalar_148_0 = entries_2877;
const __wm_scalar_148_1 = captures_2878;
if (__wm_scalar_148_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_148_1, captures_2878)) {

return captures_2878;
} else if (__wm_scalar_148_0?.ctor === -6 && __wm_scalar_148_0.args.length === 1 && __wm_is_tuple(__wm_scalar_148_0.args[0]) && __wm_scalar_148_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_148_0.args[0][0]) && __wm_scalar_148_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_148_1, captures_2878)) {
const _bindingId_2879 = __wm_scalar_148_0.args[0][0][0];
const capture_2880 = __wm_scalar_148_0.args[0][0][1];
const rest_2881 = __wm_scalar_148_0.args[0][1];
{
const __wm_tail_arg_186_0 = rest_2881;
const __wm_tail_arg_186_1 = __wm_basis_Cons([capture_2880, captures_2878]);
entries_2877 = __wm_tail_arg_186_0;
captures_2878 = __wm_tail_arg_186_1;
continue __wm_tail_143;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const captureValues_2876 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return captureValues_2876__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const rootCaptures_2882__wm_d7 = (roots_2883, functionRegistry_2884, expressionRegistry_2885, bindingFunctions_2886, bindingRegistry_2887, typeRegistry_2888, captures_2889) => {
__wm_tail_144: while (true) {
{
const __wm_scalar_149_0 = roots_2883;
const __wm_scalar_149_1 = functionRegistry_2884;
const __wm_scalar_149_2 = expressionRegistry_2885;
const __wm_scalar_149_3 = bindingFunctions_2886;
const __wm_scalar_149_4 = bindingRegistry_2887;
const __wm_scalar_149_5 = typeRegistry_2888;
const __wm_scalar_149_6 = captures_2889;
if (__wm_scalar_149_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_149_1, functionRegistry_2884) && __wm_eq(__wm_scalar_149_2, expressionRegistry_2885) && __wm_eq(__wm_scalar_149_3, bindingFunctions_2886) && __wm_eq(__wm_scalar_149_4, bindingRegistry_2887) && __wm_eq(__wm_scalar_149_5, typeRegistry_2888) && __wm_eq(__wm_scalar_149_6, captures_2889)) {

return captures_2889;
} else if (__wm_scalar_149_0?.ctor === -6 && __wm_scalar_149_0.args.length === 1 && __wm_is_tuple(__wm_scalar_149_0.args[0]) && __wm_scalar_149_0.args[0].length === 2 && __wm_eq(__wm_scalar_149_1, functionRegistry_2884) && __wm_eq(__wm_scalar_149_2, expressionRegistry_2885) && __wm_eq(__wm_scalar_149_3, bindingFunctions_2886) && __wm_eq(__wm_scalar_149_4, bindingRegistry_2887) && __wm_eq(__wm_scalar_149_5, typeRegistry_2888) && __wm_eq(__wm_scalar_149_6, captures_2889)) {
const root_2890 = __wm_scalar_149_0.args[0][0];
const rest_2891 = __wm_scalar_149_0.args[0][1];
{
const gpuRoot_2892 = root_2890;
const reachable_2893 = solveReachableFunctions_2771__wm_d5(__wm_basis_Cons([gpuRoot_2892.functionId, __wm_basis_Nil]), functionRegistry_2884, expressionRegistry_2885, bindingFunctions_2886, Map.empty(Map.numberCompare));
const rootCaptureRegistry_2894 = collectReachableCaptures_2859__wm_d9(Map.toList(reachable_2893), gpuRoot_2892.regionId, reachable_2893, functionRegistry_2884, expressionRegistry_2885, bindingFunctions_2886, bindingRegistry_2887, typeRegistry_2888, Map.empty(Map.numberCompare));
{
const __wm_tail_arg_187_0 = rest_2891;
const __wm_tail_arg_187_1 = functionRegistry_2884;
const __wm_tail_arg_187_2 = expressionRegistry_2885;
const __wm_tail_arg_187_3 = bindingFunctions_2886;
const __wm_tail_arg_187_4 = bindingRegistry_2887;
const __wm_tail_arg_187_5 = typeRegistry_2888;
const __wm_tail_arg_187_6 = prependAll_2693__wm_d2(captureValues_2876__wm_d2(Map.toList(rootCaptureRegistry_2894), __wm_basis_Nil), captures_2889);
roots_2883 = __wm_tail_arg_187_0;
functionRegistry_2884 = __wm_tail_arg_187_1;
expressionRegistry_2885 = __wm_tail_arg_187_2;
bindingFunctions_2886 = __wm_tail_arg_187_3;
bindingRegistry_2887 = __wm_tail_arg_187_4;
typeRegistry_2888 = __wm_tail_arg_187_5;
captures_2889 = __wm_tail_arg_187_6;
continue __wm_tail_144;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const rootCaptures_2882 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return rootCaptures_2882__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const illegalCaptureDiagnostic_2897 = (__arg) => {
if (true) {
const capture_2895 = __arg;
const diagnostic_2896 = { code: "gpu.illegal-capture", message: "captured value is not available to the GPU as a constant, uniform, resource, or function", spanId: capture_2895.spanId };
return diagnostic_2896;
}
__wm_fail("Match", "pattern match failure in function");
};
const captureDiagnostics_2898__wm_d2 = (captures_2899, diagnostics_2900) => {
__wm_tail_145: while (true) {
{
const __wm_scalar_150_0 = captures_2899;
const __wm_scalar_150_1 = diagnostics_2900;
if (__wm_scalar_150_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_150_1, diagnostics_2900)) {

return diagnostics_2900;
} else if (__wm_scalar_150_0?.ctor === -6 && __wm_scalar_150_0.args.length === 1 && __wm_is_tuple(__wm_scalar_150_0.args[0]) && __wm_scalar_150_0.args[0].length === 2 && __wm_eq(__wm_scalar_150_1, diagnostics_2900)) {
const capture_2901 = __wm_scalar_150_0.args[0][0];
const rest_2902 = __wm_scalar_150_0.args[0][1];
{
const exact_2903 = capture_2901;
if (__wm_eq(exact_2903.category, "illegal")) {
{
const __wm_tail_arg_188_0 = rest_2902;
const __wm_tail_arg_188_1 = __wm_basis_Cons([illegalCaptureDiagnostic_2897(exact_2903), diagnostics_2900]);
captures_2899 = __wm_tail_arg_188_0;
diagnostics_2900 = __wm_tail_arg_188_1;
continue __wm_tail_145;
}
} else {
{
const __wm_tail_arg_189_0 = rest_2902;
const __wm_tail_arg_189_1 = diagnostics_2900;
captures_2899 = __wm_tail_arg_189_0;
diagnostics_2900 = __wm_tail_arg_189_1;
continue __wm_tail_145;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const captureDiagnostics_2898 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return captureDiagnostics_2898__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const indexExpressions_2904__wm_d2 = (expressions_2905, registry_2906) => {
__wm_tail_146: while (true) {
{
const __wm_scalar_151_0 = expressions_2905;
const __wm_scalar_151_1 = registry_2906;
if (__wm_scalar_151_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_151_1, registry_2906)) {

return registry_2906;
} else if (__wm_scalar_151_0?.ctor === -6 && __wm_scalar_151_0.args.length === 1 && __wm_is_tuple(__wm_scalar_151_0.args[0]) && __wm_scalar_151_0.args[0].length === 2 && __wm_eq(__wm_scalar_151_1, registry_2906)) {
const expression_2907 = __wm_scalar_151_0.args[0][0];
const rest_2908 = __wm_scalar_151_0.args[0][1];
{
const exact_2909 = expression_2907;
{
const __wm_tail_arg_190_0 = rest_2908;
const __wm_tail_arg_190_1 = Map.set([registry_2906, exact_2909.id, exact_2909]);
expressions_2905 = __wm_tail_arg_190_0;
registry_2906 = __wm_tail_arg_190_1;
continue __wm_tail_146;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexExpressions_2904 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexExpressions_2904__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const indexTypes_2910__wm_d2 = (types_2911, registry_2912) => {
__wm_tail_147: while (true) {
{
const __wm_scalar_152_0 = types_2911;
const __wm_scalar_152_1 = registry_2912;
if (__wm_scalar_152_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_152_1, registry_2912)) {

return registry_2912;
} else if (__wm_scalar_152_0?.ctor === -6 && __wm_scalar_152_0.args.length === 1 && __wm_is_tuple(__wm_scalar_152_0.args[0]) && __wm_scalar_152_0.args[0].length === 2 && __wm_eq(__wm_scalar_152_1, registry_2912)) {
const gpuType_2913 = __wm_scalar_152_0.args[0][0];
const rest_2914 = __wm_scalar_152_0.args[0][1];
{
const exact_2915 = gpuType_2913;
{
const __wm_tail_arg_191_0 = rest_2914;
const __wm_tail_arg_191_1 = Map.set([registry_2912, exact_2915.id, exact_2915]);
types_2911 = __wm_tail_arg_191_0;
registry_2912 = __wm_tail_arg_191_1;
continue __wm_tail_147;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexTypes_2910 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexTypes_2910__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const representationOf_2919__wm_d2 = (registry_2916, typeId_2917) => {
const __wm_return_value_38 = Map.get([registry_2916, typeId_2917]);
if (__wm_return_value_38?.ctor === -2 && __wm_return_value_38.args.length === 1) {
const representation_2918 = __wm_return_value_38.args[0];
return representation_2918;
} else if (__wm_return_value_38 === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const representationOf_2919 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return representationOf_2919__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const joinRepresentation_2922__wm_d2 = (left_2920, right_2921) => {
if (__wm_op_or_d2(__wm_eq(left_2920, "f32"), __wm_eq(right_2921, "f32"))) {
return "f32";
} else {
if (__wm_op_or_d2(__wm_eq(left_2920, "i32"), __wm_eq(right_2921, "i32"))) {
return "i32";
} else {
return "";
}
}
};
const joinRepresentation_2922 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return joinRepresentation_2922__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const combinedRepresentation_2923__wm_d3 = (typeIds_2924, registry_2925, combined_2926) => {
__wm_tail_148: while (true) {
{
const __wm_scalar_153_0 = typeIds_2924;
const __wm_scalar_153_1 = registry_2925;
const __wm_scalar_153_2 = combined_2926;
if (__wm_scalar_153_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_153_1, registry_2925) && __wm_eq(__wm_scalar_153_2, combined_2926)) {

return combined_2926;
} else if (__wm_scalar_153_0?.ctor === -6 && __wm_scalar_153_0.args.length === 1 && __wm_is_tuple(__wm_scalar_153_0.args[0]) && __wm_scalar_153_0.args[0].length === 2 && __wm_eq(__wm_scalar_153_1, registry_2925) && __wm_eq(__wm_scalar_153_2, combined_2926)) {
const typeId_2927 = __wm_scalar_153_0.args[0][0];
const rest_2928 = __wm_scalar_153_0.args[0][1];
{
const __wm_tail_arg_192_0 = rest_2928;
const __wm_tail_arg_192_1 = registry_2925;
const __wm_tail_arg_192_2 = joinRepresentation_2922__wm_d2(combined_2926, representationOf_2919__wm_d2(registry_2925, typeId_2927));
typeIds_2924 = __wm_tail_arg_192_0;
registry_2925 = __wm_tail_arg_192_1;
combined_2926 = __wm_tail_arg_192_2;
continue __wm_tail_148;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const combinedRepresentation_2923 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return combinedRepresentation_2923__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setRepresentation_2934__wm_d3 = (registry_2929, typeId_2930, representation_2931) => {
const previous_2932 = representationOf_2919__wm_d2(registry_2929, typeId_2930);
const next_2933 = joinRepresentation_2922__wm_d2(previous_2932, representation_2931);
if (__wm_op_or_d2(__wm_eq(next_2933, ""), __wm_eq(next_2933, previous_2932))) {
return [registry_2929, false];
} else {
return [Map.set([registry_2929, typeId_2930, next_2933]), true];
}
};
const setRepresentation_2934 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return setRepresentation_2934__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setRepresentations_2935__wm_d4 = (typeIds_2936, representation_2937, registry_2938, changed_2939) => {
__wm_tail_149: while (true) {
{
const __wm_scalar_154_0 = typeIds_2936;
const __wm_scalar_154_1 = representation_2937;
const __wm_scalar_154_2 = registry_2938;
const __wm_scalar_154_3 = changed_2939;
if (__wm_scalar_154_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_154_1, representation_2937) && __wm_eq(__wm_scalar_154_2, registry_2938) && __wm_eq(__wm_scalar_154_3, changed_2939)) {

return [registry_2938, changed_2939];
} else if (__wm_scalar_154_0?.ctor === -6 && __wm_scalar_154_0.args.length === 1 && __wm_is_tuple(__wm_scalar_154_0.args[0]) && __wm_scalar_154_0.args[0].length === 2 && __wm_eq(__wm_scalar_154_1, representation_2937) && __wm_eq(__wm_scalar_154_2, registry_2938) && __wm_eq(__wm_scalar_154_3, changed_2939)) {
const typeId_2940 = __wm_scalar_154_0.args[0][0];
const rest_2941 = __wm_scalar_154_0.args[0][1];
{
const __wm_bind_93 = setRepresentation_2934__wm_d3(registry_2938, typeId_2940, representation_2937);
if (!(__wm_is_tuple(__wm_bind_93) && __wm_bind_93.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_2942 = __wm_bind_93[0];
const itemChanged_2943 = __wm_bind_93[1];
{
const __wm_tail_arg_193_0 = rest_2941;
const __wm_tail_arg_193_1 = representation_2937;
const __wm_tail_arg_193_2 = nextRegistry_2942;
const __wm_tail_arg_193_3 = __wm_op_or_d2(changed_2939, itemChanged_2943);
typeIds_2936 = __wm_tail_arg_193_0;
representation_2937 = __wm_tail_arg_193_1;
registry_2938 = __wm_tail_arg_193_2;
changed_2939 = __wm_tail_arg_193_3;
continue __wm_tail_149;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const setRepresentations_2935 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setRepresentations_2935__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const seedRepresentations_2944__wm_d2 = (types_2945, registry_2946) => {
__wm_tail_150: while (true) {
{
const __wm_scalar_155_0 = types_2945;
const __wm_scalar_155_1 = registry_2946;
if (__wm_scalar_155_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_155_1, registry_2946)) {

return registry_2946;
} else if (__wm_scalar_155_0?.ctor === -6 && __wm_scalar_155_0.args.length === 1 && __wm_is_tuple(__wm_scalar_155_0.args[0]) && __wm_scalar_155_0.args[0].length === 2 && __wm_eq(__wm_scalar_155_1, registry_2946)) {
const gpuType_2947 = __wm_scalar_155_0.args[0][0];
const rest_2948 = __wm_scalar_155_0.args[0][1];
{
const exact_2949 = gpuType_2947;
if (__wm_op_or_d2(__wm_eq(exact_2949.representation, "f32"), __wm_eq(exact_2949.representation, "i32"))) {
{
const __wm_tail_arg_194_0 = rest_2948;
const __wm_tail_arg_194_1 = Map.set([registry_2946, exact_2949.id, exact_2949.representation]);
types_2945 = __wm_tail_arg_194_0;
registry_2946 = __wm_tail_arg_194_1;
continue __wm_tail_150;
}
} else {
{
const __wm_tail_arg_195_0 = rest_2948;
const __wm_tail_arg_195_1 = registry_2946;
types_2945 = __wm_tail_arg_195_0;
registry_2946 = __wm_tail_arg_195_1;
continue __wm_tail_150;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const seedRepresentations_2944 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return seedRepresentations_2944__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const childTypeIds_2950__wm_d3 = (childIds_2951, expressionRegistry_2952, typeIds_2953) => {
__wm_tail_151: while (true) {
{
const __wm_scalar_156_0 = childIds_2951;
const __wm_scalar_156_1 = expressionRegistry_2952;
const __wm_scalar_156_2 = typeIds_2953;
if (__wm_scalar_156_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_156_1, expressionRegistry_2952) && __wm_eq(__wm_scalar_156_2, typeIds_2953)) {

return typeIds_2953;
} else if (__wm_scalar_156_0?.ctor === -6 && __wm_scalar_156_0.args.length === 1 && __wm_is_tuple(__wm_scalar_156_0.args[0]) && __wm_scalar_156_0.args[0].length === 2 && __wm_eq(__wm_scalar_156_1, expressionRegistry_2952) && __wm_eq(__wm_scalar_156_2, typeIds_2953)) {
const childId_2954 = __wm_scalar_156_0.args[0][0];
const rest_2955 = __wm_scalar_156_0.args[0][1];
{
const __wm_tail_value_196 = Map.get([expressionRegistry_2952, childId_2954]);
if (__wm_tail_value_196?.ctor === -2 && __wm_tail_value_196.args.length === 1) {
const child_2956 = __wm_tail_value_196.args[0];
{
const exact_2957 = child_2956;
{
const __wm_tail_arg_197_0 = rest_2955;
const __wm_tail_arg_197_1 = expressionRegistry_2952;
const __wm_tail_arg_197_2 = __wm_basis_Cons([exact_2957.typeId, typeIds_2953]);
childIds_2951 = __wm_tail_arg_197_0;
expressionRegistry_2952 = __wm_tail_arg_197_1;
typeIds_2953 = __wm_tail_arg_197_2;
continue __wm_tail_151;
}
}
} else if (__wm_tail_value_196 === __wm_basis_None) {

{
const __wm_tail_arg_198_0 = rest_2955;
const __wm_tail_arg_198_1 = expressionRegistry_2952;
const __wm_tail_arg_198_2 = typeIds_2953;
childIds_2951 = __wm_tail_arg_198_0;
expressionRegistry_2952 = __wm_tail_arg_198_1;
typeIds_2953 = __wm_tail_arg_198_2;
continue __wm_tail_151;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const childTypeIds_2950 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return childTypeIds_2950__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const numericTypeIds_2958__wm_d3 = (typeIds_2959, typeRegistry_2960, numericIds_2961) => {
__wm_tail_152: while (true) {
{
const __wm_scalar_157_0 = typeIds_2959;
const __wm_scalar_157_1 = typeRegistry_2960;
const __wm_scalar_157_2 = numericIds_2961;
if (__wm_scalar_157_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_157_1, typeRegistry_2960) && __wm_eq(__wm_scalar_157_2, numericIds_2961)) {

return numericIds_2961;
} else if (__wm_scalar_157_0?.ctor === -6 && __wm_scalar_157_0.args.length === 1 && __wm_is_tuple(__wm_scalar_157_0.args[0]) && __wm_scalar_157_0.args[0].length === 2 && __wm_eq(__wm_scalar_157_1, typeRegistry_2960) && __wm_eq(__wm_scalar_157_2, numericIds_2961)) {
const typeId_2962 = __wm_scalar_157_0.args[0][0];
const rest_2963 = __wm_scalar_157_0.args[0][1];
{
const __wm_tail_value_199 = Map.get([typeRegistry_2960, typeId_2962]);
if (__wm_tail_value_199?.ctor === -2 && __wm_tail_value_199.args.length === 1) {
const gpuType_2964 = __wm_tail_value_199.args[0];
{
const exact_2965 = gpuType_2964;
if (__wm_eq(exact_2965.kind, "vector")) {
{
const __wm_tail_arg_200_0 = rest_2963;
const __wm_tail_arg_200_1 = typeRegistry_2960;
const __wm_tail_arg_200_2 = __wm_basis_Cons([typeId_2962, numericTypeIds_2958__wm_d3(Js.Array.toList(exact_2965.items), typeRegistry_2960, numericIds_2961)]);
typeIds_2959 = __wm_tail_arg_200_0;
typeRegistry_2960 = __wm_tail_arg_200_1;
numericIds_2961 = __wm_tail_arg_200_2;
continue __wm_tail_152;
}
} else {
if (__wm_eq(exact_2965.kind, "number")) {
{
const __wm_tail_arg_201_0 = rest_2963;
const __wm_tail_arg_201_1 = typeRegistry_2960;
const __wm_tail_arg_201_2 = __wm_basis_Cons([typeId_2962, numericIds_2961]);
typeIds_2959 = __wm_tail_arg_201_0;
typeRegistry_2960 = __wm_tail_arg_201_1;
numericIds_2961 = __wm_tail_arg_201_2;
continue __wm_tail_152;
}
} else {
{
const __wm_tail_arg_202_0 = rest_2963;
const __wm_tail_arg_202_1 = typeRegistry_2960;
const __wm_tail_arg_202_2 = numericIds_2961;
typeIds_2959 = __wm_tail_arg_202_0;
typeRegistry_2960 = __wm_tail_arg_202_1;
numericIds_2961 = __wm_tail_arg_202_2;
continue __wm_tail_152;
}
}
}
}
} else if (__wm_tail_value_199 === __wm_basis_None) {

{
const __wm_tail_arg_203_0 = rest_2963;
const __wm_tail_arg_203_1 = typeRegistry_2960;
const __wm_tail_arg_203_2 = numericIds_2961;
typeIds_2959 = __wm_tail_arg_203_0;
typeRegistry_2960 = __wm_tail_arg_203_1;
numericIds_2961 = __wm_tail_arg_203_2;
continue __wm_tail_152;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const numericTypeIds_2958 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return numericTypeIds_2958__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lastChildTypeId_2966__wm_d3 = (childIds_2967, expressionRegistry_2968, lastTypeId_2969) => {
__wm_tail_153: while (true) {
{
const __wm_scalar_158_0 = childIds_2967;
const __wm_scalar_158_1 = expressionRegistry_2968;
const __wm_scalar_158_2 = lastTypeId_2969;
if (__wm_scalar_158_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_158_1, expressionRegistry_2968) && __wm_eq(__wm_scalar_158_2, lastTypeId_2969)) {

return lastTypeId_2969;
} else if (__wm_scalar_158_0?.ctor === -6 && __wm_scalar_158_0.args.length === 1 && __wm_is_tuple(__wm_scalar_158_0.args[0]) && __wm_scalar_158_0.args[0].length === 2 && __wm_eq(__wm_scalar_158_1, expressionRegistry_2968) && __wm_eq(__wm_scalar_158_2, lastTypeId_2969)) {
const childId_2970 = __wm_scalar_158_0.args[0][0];
const rest_2971 = __wm_scalar_158_0.args[0][1];
{
const nextTypeId_2974 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const child_2972 = __v.args[0];
const exact_2973 = child_2972;
return exact_2973.typeId;
} else if (__v === __wm_basis_None) {

return lastTypeId_2969;
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([expressionRegistry_2968, childId_2970]));
{
const __wm_tail_arg_204_0 = rest_2971;
const __wm_tail_arg_204_1 = expressionRegistry_2968;
const __wm_tail_arg_204_2 = nextTypeId_2974;
childIds_2967 = __wm_tail_arg_204_0;
expressionRegistry_2968 = __wm_tail_arg_204_1;
lastTypeId_2969 = __wm_tail_arg_204_2;
continue __wm_tail_153;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const lastChildTypeId_2966 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return lastChildTypeId_2966__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const constraintTypeIds_2980__wm_d3 = (expression_2975, expressionRegistry_2976, typeRegistry_2977) => {
if (__wm_eq(expression_2975.kind, "binary")) {
return numericTypeIds_2958__wm_d3(__wm_basis_Cons([expression_2975.typeId, childTypeIds_2950__wm_d3(Js.Array.toList(expression_2975.children), expressionRegistry_2976, __wm_basis_Nil)]), typeRegistry_2977, __wm_basis_Nil);
} else {
if (__wm_eq(expression_2975.kind, "tuple")) {
const __wm_return_value_39 = Map.get([typeRegistry_2977, expression_2975.typeId]);
if (__wm_return_value_39?.ctor === -2 && __wm_return_value_39.args.length === 1) {
const gpuType_2978 = __wm_return_value_39.args[0];
const exact_2979 = gpuType_2978;
if (__wm_eq(exact_2979.kind, "vector")) {
return numericTypeIds_2958__wm_d3(__wm_basis_Cons([expression_2975.typeId, childTypeIds_2950__wm_d3(Js.Array.toList(expression_2975.children), expressionRegistry_2976, __wm_basis_Nil)]), typeRegistry_2977, __wm_basis_Nil);
} else {
return __wm_basis_Nil;
}
} else if (__wm_return_value_39 === __wm_basis_None) {

return __wm_basis_Nil;
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_op_or_d2(__wm_eq(expression_2975.kind, "if"), __wm_eq(expression_2975.kind, "unary"))) {
return numericTypeIds_2958__wm_d3(__wm_basis_Cons([expression_2975.typeId, childTypeIds_2950__wm_d3(Js.Array.toList(expression_2975.children), expressionRegistry_2976, __wm_basis_Nil)]), typeRegistry_2977, __wm_basis_Nil);
} else {
if (__wm_op_or_d2(__wm_eq(expression_2975.kind, "block"), __wm_eq(expression_2975.kind, "let"))) {
return numericTypeIds_2958__wm_d3(__wm_basis_Cons([expression_2975.typeId, __wm_basis_Cons([lastChildTypeId_2966__wm_d3(Js.Array.toList(expression_2975.children), expressionRegistry_2976, expression_2975.typeId), __wm_basis_Nil])]), typeRegistry_2977, __wm_basis_Nil);
} else {
return __wm_basis_Nil;
}
}
}
}
};
const constraintTypeIds_2980 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return constraintTypeIds_2980__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const applyNumericGroup_2984__wm_d2 = (typeIds_2981, registry_2982) => {
const representation_2983 = combinedRepresentation_2923__wm_d3(typeIds_2981, registry_2982, "");
return setRepresentations_2935__wm_d4(typeIds_2981, representation_2983, registry_2982, false);
};
const applyNumericGroup_2984 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return applyNumericGroup_2984__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const applyArgumentConstraints_2985__wm_d6 = (argumentIds_2986, params_2987, expressionRegistry_2988, typeRegistry_2989, registry_2990, changed_2991) => {
__wm_tail_154: while (true) {
{
const __wm_scalar_159_0 = argumentIds_2986;
const __wm_scalar_159_1 = params_2987;
const __wm_scalar_159_2 = expressionRegistry_2988;
const __wm_scalar_159_3 = typeRegistry_2989;
const __wm_scalar_159_4 = registry_2990;
const __wm_scalar_159_5 = changed_2991;
if (__wm_scalar_159_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_159_1, params_2987) && __wm_eq(__wm_scalar_159_2, expressionRegistry_2988) && __wm_eq(__wm_scalar_159_3, typeRegistry_2989) && __wm_eq(__wm_scalar_159_4, registry_2990) && __wm_eq(__wm_scalar_159_5, changed_2991)) {

return [registry_2990, changed_2991];
} else if (__wm_eq(__wm_scalar_159_0, argumentIds_2986) && __wm_scalar_159_1 === __wm_basis_Nil && __wm_eq(__wm_scalar_159_2, expressionRegistry_2988) && __wm_eq(__wm_scalar_159_3, typeRegistry_2989) && __wm_eq(__wm_scalar_159_4, registry_2990) && __wm_eq(__wm_scalar_159_5, changed_2991)) {

return [registry_2990, changed_2991];
} else if (__wm_scalar_159_0?.ctor === -6 && __wm_scalar_159_0.args.length === 1 && __wm_is_tuple(__wm_scalar_159_0.args[0]) && __wm_scalar_159_0.args[0].length === 2 && __wm_scalar_159_1?.ctor === -6 && __wm_scalar_159_1.args.length === 1 && __wm_is_tuple(__wm_scalar_159_1.args[0]) && __wm_scalar_159_1.args[0].length === 2 && __wm_eq(__wm_scalar_159_2, expressionRegistry_2988) && __wm_eq(__wm_scalar_159_3, typeRegistry_2989) && __wm_eq(__wm_scalar_159_4, registry_2990) && __wm_eq(__wm_scalar_159_5, changed_2991)) {
const argumentId_2992 = __wm_scalar_159_0.args[0][0];
const restArguments_2993 = __wm_scalar_159_0.args[0][1];
const param_2994 = __wm_scalar_159_1.args[0][0];
const restParams_2995 = __wm_scalar_159_1.args[0][1];
{
const exactParam_2996 = param_2994;
{
const __wm_tail_value_205 = Map.get([expressionRegistry_2988, argumentId_2992]);
if (__wm_tail_value_205?.ctor === -2 && __wm_tail_value_205.args.length === 1) {
const argument_2997 = __wm_tail_value_205.args[0];
{
const exactArgument_2998 = argument_2997;
const typeIds_2999 = numericTypeIds_2958__wm_d3(__wm_basis_Cons([exactArgument_2998.typeId, __wm_basis_Cons([exactParam_2996.typeId, __wm_basis_Nil])]), typeRegistry_2989, __wm_basis_Nil);
const __wm_bind_94 = applyNumericGroup_2984__wm_d2(typeIds_2999, registry_2990);
if (!(__wm_is_tuple(__wm_bind_94) && __wm_bind_94.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_3000 = __wm_bind_94[0];
const pairChanged_3001 = __wm_bind_94[1];
{
const __wm_tail_arg_206_0 = restArguments_2993;
const __wm_tail_arg_206_1 = restParams_2995;
const __wm_tail_arg_206_2 = expressionRegistry_2988;
const __wm_tail_arg_206_3 = typeRegistry_2989;
const __wm_tail_arg_206_4 = nextRegistry_3000;
const __wm_tail_arg_206_5 = __wm_op_or_d2(changed_2991, pairChanged_3001);
argumentIds_2986 = __wm_tail_arg_206_0;
params_2987 = __wm_tail_arg_206_1;
expressionRegistry_2988 = __wm_tail_arg_206_2;
typeRegistry_2989 = __wm_tail_arg_206_3;
registry_2990 = __wm_tail_arg_206_4;
changed_2991 = __wm_tail_arg_206_5;
continue __wm_tail_154;
}
}
} else if (__wm_tail_value_205 === __wm_basis_None) {

{
const __wm_tail_arg_207_0 = restArguments_2993;
const __wm_tail_arg_207_1 = restParams_2995;
const __wm_tail_arg_207_2 = expressionRegistry_2988;
const __wm_tail_arg_207_3 = typeRegistry_2989;
const __wm_tail_arg_207_4 = registry_2990;
const __wm_tail_arg_207_5 = changed_2991;
argumentIds_2986 = __wm_tail_arg_207_0;
params_2987 = __wm_tail_arg_207_1;
expressionRegistry_2988 = __wm_tail_arg_207_2;
typeRegistry_2989 = __wm_tail_arg_207_3;
registry_2990 = __wm_tail_arg_207_4;
changed_2991 = __wm_tail_arg_207_5;
continue __wm_tail_154;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const applyArgumentConstraints_2985 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return applyArgumentConstraints_2985__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const applyCallConstraint_3018__wm_d6 = (expression_3002, expressionRegistry_3003, typeRegistry_3004, functionRegistry_3005, bindingFunctions_3006, registry_3007) => {
const __wm_return_value_40 = Js.Array.toList(expression_3002.children);
if (__wm_return_value_40?.ctor === -6 && __wm_return_value_40.args.length === 1 && __wm_is_tuple(__wm_return_value_40.args[0]) && __wm_return_value_40.args[0].length === 2) {
const calleeId_3008 = __wm_return_value_40.args[0][0];
const argumentIds_3009 = __wm_return_value_40.args[0][1];
const __wm_return_value_41 = Map.get([expressionRegistry_3003, calleeId_3008]);
if (__wm_return_value_41?.ctor === -2 && __wm_return_value_41.args.length === 1) {
const callee_3010 = __wm_return_value_41.args[0];
const exactCallee_3011 = callee_3010;
const __wm_return_value_42 = Map.get([bindingFunctions_3006, exactCallee_3011.bindingId]);
if (__wm_return_value_42?.ctor === -2 && __wm_return_value_42.args.length === 1) {
const functionId_3012 = __wm_return_value_42.args[0];
const __wm_return_value_43 = Map.get([functionRegistry_3005, functionId_3012]);
if (__wm_return_value_43?.ctor === -2 && __wm_return_value_43.args.length === 1) {
const fn_3013 = __wm_return_value_43.args[0];
const exactFunction_3014 = fn_3013;
const resultIds_3015 = numericTypeIds_2958__wm_d3(__wm_basis_Cons([expression_3002.typeId, __wm_basis_Cons([exactFunction_3014.resultTypeId, __wm_basis_Nil])]), typeRegistry_3004, __wm_basis_Nil);
const __wm_bind_95 = applyNumericGroup_2984__wm_d2(resultIds_3015, registry_3007);
if (!(__wm_is_tuple(__wm_bind_95) && __wm_bind_95.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const resultRegistry_3016 = __wm_bind_95[0];
const resultChanged_3017 = __wm_bind_95[1];
return applyArgumentConstraints_2985__wm_d6(argumentIds_3009, Js.Array.toList(exactFunction_3014.params), expressionRegistry_3003, typeRegistry_3004, resultRegistry_3016, resultChanged_3017);
} else if (__wm_return_value_43 === __wm_basis_None) {

return [registry_3007, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_42 === __wm_basis_None) {

return [registry_3007, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_41 === __wm_basis_None) {

return [registry_3007, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_40 === __wm_basis_Nil) {

return [registry_3007, false];
}
__wm_fail("Match", "non-exhaustive match");
};
const applyCallConstraint_3018 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return applyCallConstraint_3018__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const applyNumericConstraint_3026__wm_d6 = (expression_3019, expressionRegistry_3020, typeRegistry_3021, functionRegistry_3022, bindingFunctions_3023, registry_3024) => {
if (__wm_eq(expression_3019.kind, "call")) {
return applyCallConstraint_3018__wm_d6(expression_3019, expressionRegistry_3020, typeRegistry_3021, functionRegistry_3022, bindingFunctions_3023, registry_3024);
} else {
const typeIds_3025 = constraintTypeIds_2980__wm_d3(expression_3019, expressionRegistry_3020, typeRegistry_3021);
return applyNumericGroup_2984__wm_d2(typeIds_3025, registry_3024);
}
};
const applyNumericConstraint_3026 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return applyNumericConstraint_3026__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const numericSweep_3027__wm_d7 = (expressions_3028, expressionRegistry_3029, typeRegistry_3030, functionRegistry_3031, bindingFunctions_3032, registry_3033, changed_3034) => {
__wm_tail_155: while (true) {
{
const __wm_scalar_160_0 = expressions_3028;
const __wm_scalar_160_1 = expressionRegistry_3029;
const __wm_scalar_160_2 = typeRegistry_3030;
const __wm_scalar_160_3 = functionRegistry_3031;
const __wm_scalar_160_4 = bindingFunctions_3032;
const __wm_scalar_160_5 = registry_3033;
const __wm_scalar_160_6 = changed_3034;
if (__wm_scalar_160_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_160_1, expressionRegistry_3029) && __wm_eq(__wm_scalar_160_2, typeRegistry_3030) && __wm_eq(__wm_scalar_160_3, functionRegistry_3031) && __wm_eq(__wm_scalar_160_4, bindingFunctions_3032) && __wm_eq(__wm_scalar_160_5, registry_3033) && __wm_eq(__wm_scalar_160_6, changed_3034)) {

return [registry_3033, changed_3034];
} else if (__wm_scalar_160_0?.ctor === -6 && __wm_scalar_160_0.args.length === 1 && __wm_is_tuple(__wm_scalar_160_0.args[0]) && __wm_scalar_160_0.args[0].length === 2 && __wm_eq(__wm_scalar_160_1, expressionRegistry_3029) && __wm_eq(__wm_scalar_160_2, typeRegistry_3030) && __wm_eq(__wm_scalar_160_3, functionRegistry_3031) && __wm_eq(__wm_scalar_160_4, bindingFunctions_3032) && __wm_eq(__wm_scalar_160_5, registry_3033) && __wm_eq(__wm_scalar_160_6, changed_3034)) {
const expression_3035 = __wm_scalar_160_0.args[0][0];
const rest_3036 = __wm_scalar_160_0.args[0][1];
{
const exactExpression_3037 = expression_3035;
const __wm_bind_96 = applyNumericConstraint_3026__wm_d6(exactExpression_3037, expressionRegistry_3029, typeRegistry_3030, functionRegistry_3031, bindingFunctions_3032, registry_3033);
if (!(__wm_is_tuple(__wm_bind_96) && __wm_bind_96.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_3038 = __wm_bind_96[0];
const expressionChanged_3039 = __wm_bind_96[1];
{
const __wm_tail_arg_208_0 = rest_3036;
const __wm_tail_arg_208_1 = expressionRegistry_3029;
const __wm_tail_arg_208_2 = typeRegistry_3030;
const __wm_tail_arg_208_3 = functionRegistry_3031;
const __wm_tail_arg_208_4 = bindingFunctions_3032;
const __wm_tail_arg_208_5 = nextRegistry_3038;
const __wm_tail_arg_208_6 = __wm_op_or_d2(changed_3034, expressionChanged_3039);
expressions_3028 = __wm_tail_arg_208_0;
expressionRegistry_3029 = __wm_tail_arg_208_1;
typeRegistry_3030 = __wm_tail_arg_208_2;
functionRegistry_3031 = __wm_tail_arg_208_3;
bindingFunctions_3032 = __wm_tail_arg_208_4;
registry_3033 = __wm_tail_arg_208_5;
changed_3034 = __wm_tail_arg_208_6;
continue __wm_tail_155;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const numericSweep_3027 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return numericSweep_3027__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const solveNumericRepresentations_3040__wm_d6 = (expressions_3041, expressionRegistry_3042, typeRegistry_3043, functionRegistry_3044, bindingFunctions_3045, registry_3046) => {
__wm_tail_156: while (true) {
{
const __wm_bind_97 = numericSweep_3027__wm_d7(expressions_3041, expressionRegistry_3042, typeRegistry_3043, functionRegistry_3044, bindingFunctions_3045, registry_3046, false);
if (!(__wm_is_tuple(__wm_bind_97) && __wm_bind_97.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_3047 = __wm_bind_97[0];
const changed_3048 = __wm_bind_97[1];
if (changed_3048) {
{
const __wm_tail_arg_209_0 = expressions_3041;
const __wm_tail_arg_209_1 = expressionRegistry_3042;
const __wm_tail_arg_209_2 = typeRegistry_3043;
const __wm_tail_arg_209_3 = functionRegistry_3044;
const __wm_tail_arg_209_4 = bindingFunctions_3045;
const __wm_tail_arg_209_5 = nextRegistry_3047;
expressions_3041 = __wm_tail_arg_209_0;
expressionRegistry_3042 = __wm_tail_arg_209_1;
typeRegistry_3043 = __wm_tail_arg_209_2;
functionRegistry_3044 = __wm_tail_arg_209_3;
bindingFunctions_3045 = __wm_tail_arg_209_4;
registry_3046 = __wm_tail_arg_209_5;
continue __wm_tail_156;
}
} else {
return nextRegistry_3047;
}
}
}
};
const solveNumericRepresentations_3040 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return solveNumericRepresentations_3040__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const collectExpressionItems_3049__wm_d4 = (pending_3050, expressionRegistry_3051, visited_3052, expressions_3053) => {
__wm_tail_157: while (true) {
{
const __wm_scalar_161_0 = pending_3050;
const __wm_scalar_161_1 = expressionRegistry_3051;
const __wm_scalar_161_2 = visited_3052;
const __wm_scalar_161_3 = expressions_3053;
if (__wm_scalar_161_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_161_1, expressionRegistry_3051) && __wm_eq(__wm_scalar_161_2, visited_3052) && __wm_eq(__wm_scalar_161_3, expressions_3053)) {

return expressions_3053;
} else if (__wm_scalar_161_0?.ctor === -6 && __wm_scalar_161_0.args.length === 1 && __wm_is_tuple(__wm_scalar_161_0.args[0]) && __wm_scalar_161_0.args[0].length === 2 && __wm_eq(__wm_scalar_161_1, expressionRegistry_3051) && __wm_eq(__wm_scalar_161_2, visited_3052) && __wm_eq(__wm_scalar_161_3, expressions_3053)) {
const expressionId_3054 = __wm_scalar_161_0.args[0][0];
const rest_3055 = __wm_scalar_161_0.args[0][1];
if (Map.has([visited_3052, expressionId_3054])) {
{
const __wm_tail_arg_210_0 = rest_3055;
const __wm_tail_arg_210_1 = expressionRegistry_3051;
const __wm_tail_arg_210_2 = visited_3052;
const __wm_tail_arg_210_3 = expressions_3053;
pending_3050 = __wm_tail_arg_210_0;
expressionRegistry_3051 = __wm_tail_arg_210_1;
visited_3052 = __wm_tail_arg_210_2;
expressions_3053 = __wm_tail_arg_210_3;
continue __wm_tail_157;
}
} else {
{
const nextVisited_3056 = Map.set([visited_3052, expressionId_3054, true]);
{
const __wm_tail_value_211 = Map.get([expressionRegistry_3051, expressionId_3054]);
if (__wm_tail_value_211?.ctor === -2 && __wm_tail_value_211.args.length === 1) {
const expression_3057 = __wm_tail_value_211.args[0];
{
const exact_3058 = expression_3057;
{
const __wm_tail_arg_212_0 = prependAll_2693__wm_d2(Js.Array.toList(exact_3058.children), rest_3055);
const __wm_tail_arg_212_1 = expressionRegistry_3051;
const __wm_tail_arg_212_2 = nextVisited_3056;
const __wm_tail_arg_212_3 = __wm_basis_Cons([exact_3058, expressions_3053]);
pending_3050 = __wm_tail_arg_212_0;
expressionRegistry_3051 = __wm_tail_arg_212_1;
visited_3052 = __wm_tail_arg_212_2;
expressions_3053 = __wm_tail_arg_212_3;
continue __wm_tail_157;
}
}
} else if (__wm_tail_value_211 === __wm_basis_None) {

{
const __wm_tail_arg_213_0 = rest_3055;
const __wm_tail_arg_213_1 = expressionRegistry_3051;
const __wm_tail_arg_213_2 = nextVisited_3056;
const __wm_tail_arg_213_3 = expressions_3053;
pending_3050 = __wm_tail_arg_213_0;
expressionRegistry_3051 = __wm_tail_arg_213_1;
visited_3052 = __wm_tail_arg_213_2;
expressions_3053 = __wm_tail_arg_213_3;
continue __wm_tail_157;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const collectExpressionItems_3049 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return collectExpressionItems_3049__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const concreteRepresentation_3065__wm_d3 = (typeRegistry_3059, representations_3060, typeId_3061) => {
const __wm_return_value_44 = Map.get([typeRegistry_3059, typeId_3061]);
if (__wm_return_value_44?.ctor === -2 && __wm_return_value_44.args.length === 1) {
const gpuType_3062 = __wm_return_value_44.args[0];
const exact_3063 = gpuType_3062;
if (__wm_op_or_d2(__wm_eq(exact_3063.kind, "number"), __wm_eq(exact_3063.kind, "vector"))) {
const representation_3064 = representationOf_2919__wm_d2(representations_3060, typeId_3061);
if (__wm_eq(representation_3064, "")) {
return "i32";
} else {
return representation_3064;
}
} else {
return "";
}
} else if (__wm_return_value_44 === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const concreteRepresentation_3065 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concreteRepresentation_3065__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setTypeRepresentation_3071__wm_d4 = (typeId_3066, representation_3067, typeRegistry_3068, registry_3069) => {
const typeIds_3070 = numericTypeIds_2958__wm_d3(__wm_basis_Cons([typeId_3066, __wm_basis_Nil]), typeRegistry_3068, __wm_basis_Nil);
return setRepresentations_2935__wm_d4(typeIds_3070, representation_3067, registry_3069, false);
};
const setTypeRepresentation_3071 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setTypeRepresentation_3071__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const seedParamRepresentations_3072__wm_d4 = (params_3073, representations_3074, typeRegistry_3075, registry_3076) => {
__wm_tail_158: while (true) {
{
const __wm_scalar_162_0 = params_3073;
const __wm_scalar_162_1 = representations_3074;
const __wm_scalar_162_2 = typeRegistry_3075;
const __wm_scalar_162_3 = registry_3076;
if (__wm_scalar_162_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_162_1, representations_3074) && __wm_eq(__wm_scalar_162_2, typeRegistry_3075) && __wm_eq(__wm_scalar_162_3, registry_3076)) {

return registry_3076;
} else if (__wm_eq(__wm_scalar_162_0, params_3073) && __wm_scalar_162_1 === __wm_basis_Nil && __wm_eq(__wm_scalar_162_2, typeRegistry_3075) && __wm_eq(__wm_scalar_162_3, registry_3076)) {

return registry_3076;
} else if (__wm_scalar_162_0?.ctor === -6 && __wm_scalar_162_0.args.length === 1 && __wm_is_tuple(__wm_scalar_162_0.args[0]) && __wm_scalar_162_0.args[0].length === 2 && __wm_scalar_162_1?.ctor === -6 && __wm_scalar_162_1.args.length === 1 && __wm_is_tuple(__wm_scalar_162_1.args[0]) && __wm_scalar_162_1.args[0].length === 2 && __wm_eq(__wm_scalar_162_2, typeRegistry_3075) && __wm_eq(__wm_scalar_162_3, registry_3076)) {
const param_3077 = __wm_scalar_162_0.args[0][0];
const restParams_3078 = __wm_scalar_162_0.args[0][1];
const representation_3079 = __wm_scalar_162_1.args[0][0];
const restRepresentations_3080 = __wm_scalar_162_1.args[0][1];
{
const exact_3081 = param_3077;
const __wm_bind_98 = setTypeRepresentation_3071__wm_d4(exact_3081.typeId, representation_3079, typeRegistry_3075, registry_3076);
if (!(__wm_is_tuple(__wm_bind_98) && __wm_bind_98.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_3082 = __wm_bind_98[0];
const _changed_3083 = __wm_bind_98[1];
{
const __wm_tail_arg_214_0 = restParams_3078;
const __wm_tail_arg_214_1 = restRepresentations_3080;
const __wm_tail_arg_214_2 = typeRegistry_3075;
const __wm_tail_arg_214_3 = nextRegistry_3082;
params_3073 = __wm_tail_arg_214_0;
representations_3074 = __wm_tail_arg_214_1;
typeRegistry_3075 = __wm_tail_arg_214_2;
registry_3076 = __wm_tail_arg_214_3;
continue __wm_tail_158;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const seedParamRepresentations_3072 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return seedParamRepresentations_3072__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const functionParamRepresentations_3084__wm_d4 = (params_3085, typeRegistry_3086, representations_3087, output_3088) => {
__wm_tail_159: while (true) {
{
const __wm_scalar_163_0 = params_3085;
const __wm_scalar_163_1 = typeRegistry_3086;
const __wm_scalar_163_2 = representations_3087;
const __wm_scalar_163_3 = output_3088;
if (__wm_scalar_163_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_163_1, typeRegistry_3086) && __wm_eq(__wm_scalar_163_2, representations_3087) && __wm_eq(__wm_scalar_163_3, output_3088)) {

return reverseInto_2698__wm_d2(output_3088, __wm_basis_Nil);
} else if (__wm_scalar_163_0?.ctor === -6 && __wm_scalar_163_0.args.length === 1 && __wm_is_tuple(__wm_scalar_163_0.args[0]) && __wm_scalar_163_0.args[0].length === 2 && __wm_eq(__wm_scalar_163_1, typeRegistry_3086) && __wm_eq(__wm_scalar_163_2, representations_3087) && __wm_eq(__wm_scalar_163_3, output_3088)) {
const param_3089 = __wm_scalar_163_0.args[0][0];
const rest_3090 = __wm_scalar_163_0.args[0][1];
{
const exact_3091 = param_3089;
{
const __wm_tail_arg_215_0 = rest_3090;
const __wm_tail_arg_215_1 = typeRegistry_3086;
const __wm_tail_arg_215_2 = representations_3087;
const __wm_tail_arg_215_3 = __wm_basis_Cons([concreteRepresentation_3065__wm_d3(typeRegistry_3086, representations_3087, exact_3091.typeId), output_3088]);
params_3085 = __wm_tail_arg_215_0;
typeRegistry_3086 = __wm_tail_arg_215_1;
representations_3087 = __wm_tail_arg_215_2;
output_3088 = __wm_tail_arg_215_3;
continue __wm_tail_159;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const functionParamRepresentations_3084 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return functionParamRepresentations_3084__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const callArgumentRepresentations_3092__wm_d5 = (argumentIds_3093, expressionRegistry_3094, typeRegistry_3095, representations_3096, output_3097) => {
__wm_tail_160: while (true) {
{
const __wm_scalar_164_0 = argumentIds_3093;
const __wm_scalar_164_1 = expressionRegistry_3094;
const __wm_scalar_164_2 = typeRegistry_3095;
const __wm_scalar_164_3 = representations_3096;
const __wm_scalar_164_4 = output_3097;
if (__wm_scalar_164_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_164_1, expressionRegistry_3094) && __wm_eq(__wm_scalar_164_2, typeRegistry_3095) && __wm_eq(__wm_scalar_164_3, representations_3096) && __wm_eq(__wm_scalar_164_4, output_3097)) {

return reverseInto_2698__wm_d2(output_3097, __wm_basis_Nil);
} else if (__wm_scalar_164_0?.ctor === -6 && __wm_scalar_164_0.args.length === 1 && __wm_is_tuple(__wm_scalar_164_0.args[0]) && __wm_scalar_164_0.args[0].length === 2 && __wm_eq(__wm_scalar_164_1, expressionRegistry_3094) && __wm_eq(__wm_scalar_164_2, typeRegistry_3095) && __wm_eq(__wm_scalar_164_3, representations_3096) && __wm_eq(__wm_scalar_164_4, output_3097)) {
const argumentId_3098 = __wm_scalar_164_0.args[0][0];
const rest_3099 = __wm_scalar_164_0.args[0][1];
{
const representation_3102 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const argument_3100 = __v.args[0];
const exact_3101 = argument_3100;
return concreteRepresentation_3065__wm_d3(typeRegistry_3095, representations_3096, exact_3101.typeId);
} else if (__v === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([expressionRegistry_3094, argumentId_3098]));
{
const __wm_tail_arg_216_0 = rest_3099;
const __wm_tail_arg_216_1 = expressionRegistry_3094;
const __wm_tail_arg_216_2 = typeRegistry_3095;
const __wm_tail_arg_216_3 = representations_3096;
const __wm_tail_arg_216_4 = __wm_basis_Cons([representation_3102, output_3097]);
argumentIds_3093 = __wm_tail_arg_216_0;
expressionRegistry_3094 = __wm_tail_arg_216_1;
typeRegistry_3095 = __wm_tail_arg_216_2;
representations_3096 = __wm_tail_arg_216_3;
output_3097 = __wm_tail_arg_216_4;
continue __wm_tail_160;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const callArgumentRepresentations_3092 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return callArgumentRepresentations_3092__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeArgumentRepresentations_3103__wm_d6 = (argumentIds_3104, representations_3105, expressionRegistry_3106, typeRegistry_3107, registry_3108, changed_3109) => {
__wm_tail_161: while (true) {
{
const __wm_scalar_165_0 = argumentIds_3104;
const __wm_scalar_165_1 = representations_3105;
const __wm_scalar_165_2 = expressionRegistry_3106;
const __wm_scalar_165_3 = typeRegistry_3107;
const __wm_scalar_165_4 = registry_3108;
const __wm_scalar_165_5 = changed_3109;
if (__wm_scalar_165_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_165_1, representations_3105) && __wm_eq(__wm_scalar_165_2, expressionRegistry_3106) && __wm_eq(__wm_scalar_165_3, typeRegistry_3107) && __wm_eq(__wm_scalar_165_4, registry_3108) && __wm_eq(__wm_scalar_165_5, changed_3109)) {

return [registry_3108, changed_3109];
} else if (__wm_eq(__wm_scalar_165_0, argumentIds_3104) && __wm_scalar_165_1 === __wm_basis_Nil && __wm_eq(__wm_scalar_165_2, expressionRegistry_3106) && __wm_eq(__wm_scalar_165_3, typeRegistry_3107) && __wm_eq(__wm_scalar_165_4, registry_3108) && __wm_eq(__wm_scalar_165_5, changed_3109)) {

return [registry_3108, changed_3109];
} else if (__wm_scalar_165_0?.ctor === -6 && __wm_scalar_165_0.args.length === 1 && __wm_is_tuple(__wm_scalar_165_0.args[0]) && __wm_scalar_165_0.args[0].length === 2 && __wm_scalar_165_1?.ctor === -6 && __wm_scalar_165_1.args.length === 1 && __wm_is_tuple(__wm_scalar_165_1.args[0]) && __wm_scalar_165_1.args[0].length === 2 && __wm_eq(__wm_scalar_165_2, expressionRegistry_3106) && __wm_eq(__wm_scalar_165_3, typeRegistry_3107) && __wm_eq(__wm_scalar_165_4, registry_3108) && __wm_eq(__wm_scalar_165_5, changed_3109)) {
const argumentId_3110 = __wm_scalar_165_0.args[0][0];
const restArguments_3111 = __wm_scalar_165_0.args[0][1];
const representation_3112 = __wm_scalar_165_1.args[0][0];
const restRepresentations_3113 = __wm_scalar_165_1.args[0][1];
{
const __wm_tail_value_217 = Map.get([expressionRegistry_3106, argumentId_3110]);
if (__wm_tail_value_217?.ctor === -2 && __wm_tail_value_217.args.length === 1) {
const argument_3114 = __wm_tail_value_217.args[0];
{
const exact_3115 = argument_3114;
const __wm_bind_99 = setTypeRepresentation_3071__wm_d4(exact_3115.typeId, representation_3112, typeRegistry_3107, registry_3108);
if (!(__wm_is_tuple(__wm_bind_99) && __wm_bind_99.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_3116 = __wm_bind_99[0];
const itemChanged_3117 = __wm_bind_99[1];
{
const __wm_tail_arg_218_0 = restArguments_3111;
const __wm_tail_arg_218_1 = restRepresentations_3113;
const __wm_tail_arg_218_2 = expressionRegistry_3106;
const __wm_tail_arg_218_3 = typeRegistry_3107;
const __wm_tail_arg_218_4 = nextRegistry_3116;
const __wm_tail_arg_218_5 = __wm_op_or_d2(changed_3109, itemChanged_3117);
argumentIds_3104 = __wm_tail_arg_218_0;
representations_3105 = __wm_tail_arg_218_1;
expressionRegistry_3106 = __wm_tail_arg_218_2;
typeRegistry_3107 = __wm_tail_arg_218_3;
registry_3108 = __wm_tail_arg_218_4;
changed_3109 = __wm_tail_arg_218_5;
continue __wm_tail_161;
}
}
} else if (__wm_tail_value_217 === __wm_basis_None) {

{
const __wm_tail_arg_219_0 = restArguments_3111;
const __wm_tail_arg_219_1 = restRepresentations_3113;
const __wm_tail_arg_219_2 = expressionRegistry_3106;
const __wm_tail_arg_219_3 = typeRegistry_3107;
const __wm_tail_arg_219_4 = registry_3108;
const __wm_tail_arg_219_5 = changed_3109;
argumentIds_3104 = __wm_tail_arg_219_0;
representations_3105 = __wm_tail_arg_219_1;
expressionRegistry_3106 = __wm_tail_arg_219_2;
typeRegistry_3107 = __wm_tail_arg_219_3;
registry_3108 = __wm_tail_arg_219_4;
changed_3109 = __wm_tail_arg_219_5;
continue __wm_tail_161;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const mergeArgumentRepresentations_3103 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return mergeArgumentRepresentations_3103__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const solveFunctionInstance_3118__wm_d9 = (fn_3121, paramRepresentations_3122, resultRepresentation_3123, active_3124, functionRegistry_3125, expressionRegistry_3126, bindingFunctions_3127, typeRegistry_3128, typeItems_3129) => {
const seeded_3130 = seedRepresentations_2944__wm_d2(typeItems_3129, Map.empty(Map.numberCompare));
const withParams_3131 = seedParamRepresentations_3072__wm_d4(Js.Array.toList(fn_3121.params), paramRepresentations_3122, typeRegistry_3128, seeded_3130);
const __wm_bind_100 = setTypeRepresentation_3071__wm_d4(fn_3121.resultTypeId, resultRepresentation_3123, typeRegistry_3128, withParams_3131);
if (!(__wm_is_tuple(__wm_bind_100) && __wm_bind_100.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const initial_3132 = __wm_bind_100[0];
const _resultChanged_3133 = __wm_bind_100[1];
const expressions_3134 = collectExpressionItems_3049__wm_d4(__wm_basis_Cons([fn_3121.bodyExprId, __wm_basis_Nil]), expressionRegistry_3126, Map.empty(Map.numberCompare), __wm_basis_Nil);
return solveInstanceFixedPoint_3119__wm_d9(fn_3121, expressions_3134, Map.set([active_3124, fn_3121.id, true]), functionRegistry_3125, expressionRegistry_3126, bindingFunctions_3127, typeRegistry_3128, typeItems_3129, initial_3132);
};
const solveFunctionInstance_3118 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return solveFunctionInstance_3118__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const solveInstanceFixedPoint_3119__wm_d9 = (fn_3135, expressions_3136, active_3137, functionRegistry_3138, expressionRegistry_3139, bindingFunctions_3140, typeRegistry_3141, typeItems_3142, registry_3143) => {
__wm_tail_162: while (true) {
{
const __wm_bind_101 = instanceSweep_3120__wm_d10(expressions_3136, fn_3135, active_3137, functionRegistry_3138, expressionRegistry_3139, bindingFunctions_3140, typeRegistry_3141, typeItems_3142, registry_3143, false);
if (!(__wm_is_tuple(__wm_bind_101) && __wm_bind_101.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_3144 = __wm_bind_101[0];
const changed_3145 = __wm_bind_101[1];
if (changed_3145) {
{
const __wm_tail_arg_220_0 = fn_3135;
const __wm_tail_arg_220_1 = expressions_3136;
const __wm_tail_arg_220_2 = active_3137;
const __wm_tail_arg_220_3 = functionRegistry_3138;
const __wm_tail_arg_220_4 = expressionRegistry_3139;
const __wm_tail_arg_220_5 = bindingFunctions_3140;
const __wm_tail_arg_220_6 = typeRegistry_3141;
const __wm_tail_arg_220_7 = typeItems_3142;
const __wm_tail_arg_220_8 = nextRegistry_3144;
fn_3135 = __wm_tail_arg_220_0;
expressions_3136 = __wm_tail_arg_220_1;
active_3137 = __wm_tail_arg_220_2;
functionRegistry_3138 = __wm_tail_arg_220_3;
expressionRegistry_3139 = __wm_tail_arg_220_4;
bindingFunctions_3140 = __wm_tail_arg_220_5;
typeRegistry_3141 = __wm_tail_arg_220_6;
typeItems_3142 = __wm_tail_arg_220_7;
registry_3143 = __wm_tail_arg_220_8;
continue __wm_tail_162;
}
} else {
return nextRegistry_3144;
}
}
}
};
const solveInstanceFixedPoint_3119 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return solveInstanceFixedPoint_3119__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const instanceSweep_3120__wm_d10 = (expressions_3146, fn_3147, active_3148, functionRegistry_3149, expressionRegistry_3150, bindingFunctions_3151, typeRegistry_3152, typeItems_3153, registry_3154, changed_3155) => {
__wm_tail_163: while (true) {
{
const __wm_scalar_166_0 = expressions_3146;
const __wm_scalar_166_1 = fn_3147;
const __wm_scalar_166_2 = active_3148;
const __wm_scalar_166_3 = functionRegistry_3149;
const __wm_scalar_166_4 = expressionRegistry_3150;
const __wm_scalar_166_5 = bindingFunctions_3151;
const __wm_scalar_166_6 = typeRegistry_3152;
const __wm_scalar_166_7 = typeItems_3153;
const __wm_scalar_166_8 = registry_3154;
const __wm_scalar_166_9 = changed_3155;
if (__wm_scalar_166_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_166_1, fn_3147) && __wm_eq(__wm_scalar_166_2, active_3148) && __wm_eq(__wm_scalar_166_3, functionRegistry_3149) && __wm_eq(__wm_scalar_166_4, expressionRegistry_3150) && __wm_eq(__wm_scalar_166_5, bindingFunctions_3151) && __wm_eq(__wm_scalar_166_6, typeRegistry_3152) && __wm_eq(__wm_scalar_166_7, typeItems_3153) && __wm_eq(__wm_scalar_166_8, registry_3154) && __wm_eq(__wm_scalar_166_9, changed_3155)) {

return [registry_3154, changed_3155];
} else if (__wm_scalar_166_0?.ctor === -6 && __wm_scalar_166_0.args.length === 1 && __wm_is_tuple(__wm_scalar_166_0.args[0]) && __wm_scalar_166_0.args[0].length === 2 && __wm_eq(__wm_scalar_166_1, fn_3147) && __wm_eq(__wm_scalar_166_2, active_3148) && __wm_eq(__wm_scalar_166_3, functionRegistry_3149) && __wm_eq(__wm_scalar_166_4, expressionRegistry_3150) && __wm_eq(__wm_scalar_166_5, bindingFunctions_3151) && __wm_eq(__wm_scalar_166_6, typeRegistry_3152) && __wm_eq(__wm_scalar_166_7, typeItems_3153) && __wm_eq(__wm_scalar_166_8, registry_3154) && __wm_eq(__wm_scalar_166_9, changed_3155)) {
const expression_3156 = __wm_scalar_166_0.args[0][0];
const rest_3157 = __wm_scalar_166_0.args[0][1];
{
const currentFn_3158 = fn_3147;
const __wm_bind_102 = (__wm_eq(expression_3156.kind, "call") ? ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2) {
const calleeId_3159 = __v.args[0][0];
const argumentIds_3160 = __v.args[0][1];
const __wm_return_value_45 = Map.get([expressionRegistry_3150, calleeId_3159]);
if (__wm_return_value_45?.ctor === -2 && __wm_return_value_45.args.length === 1) {
const callee_3161 = __wm_return_value_45.args[0];
const __wm_return_value_46 = Map.get([bindingFunctions_3151, callee_3161.bindingId]);
if (__wm_return_value_46?.ctor === -2 && __wm_return_value_46.args.length === 1) {
const functionId_3162 = __wm_return_value_46.args[0];
const __wm_return_value_47 = Map.get([functionRegistry_3149, functionId_3162]);
if (__wm_return_value_47?.ctor === -2 && __wm_return_value_47.args.length === 1) {
const rawCalleeFn_3163 = __wm_return_value_47.args[0];
const calleeFn_3164 = rawCalleeFn_3163;
if (__wm_eq(calleeFn_3164.id, currentFn_3158.id)) {
return applyCallConstraint_3018__wm_d6(expression_3156, expressionRegistry_3150, typeRegistry_3152, functionRegistry_3149, bindingFunctions_3151, registry_3154);
} else {
if (Map.has([active_3148, calleeFn_3164.id])) {
return [registry_3154, false];
} else {
const argumentRepresentations_3165 = callArgumentRepresentations_3092__wm_d5(argumentIds_3160, expressionRegistry_3150, typeRegistry_3152, registry_3154, __wm_basis_Nil);
const callResultRepresentation_3166 = concreteRepresentation_3065__wm_d3(typeRegistry_3152, registry_3154, expression_3156.typeId);
const calleeRepresentations_3167 = solveFunctionInstance_3118__wm_d9(calleeFn_3164, argumentRepresentations_3165, callResultRepresentation_3166, active_3148, functionRegistry_3149, expressionRegistry_3150, bindingFunctions_3151, typeRegistry_3152, typeItems_3153);
const resolvedParams_3168 = functionParamRepresentations_3084__wm_d4(Js.Array.toList(calleeFn_3164.params), typeRegistry_3152, calleeRepresentations_3167, __wm_basis_Nil);
const resolvedResult_3169 = concreteRepresentation_3065__wm_d3(typeRegistry_3152, calleeRepresentations_3167, calleeFn_3164.resultTypeId);
const __wm_bind_103 = mergeArgumentRepresentations_3103__wm_d6(argumentIds_3160, resolvedParams_3168, expressionRegistry_3150, typeRegistry_3152, registry_3154, false);
if (!(__wm_is_tuple(__wm_bind_103) && __wm_bind_103.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withArguments_3170 = __wm_bind_103[0];
const argumentsChanged_3171 = __wm_bind_103[1];
const __wm_bind_104 = setTypeRepresentation_3071__wm_d4(expression_3156.typeId, resolvedResult_3169, typeRegistry_3152, withArguments_3170);
if (!(__wm_is_tuple(__wm_bind_104) && __wm_bind_104.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withResult_3172 = __wm_bind_104[0];
const resultChanged_3173 = __wm_bind_104[1];
return [withResult_3172, __wm_op_or_d2(argumentsChanged_3171, resultChanged_3173)];
}
}
} else if (__wm_return_value_47 === __wm_basis_None) {

return [registry_3154, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_46 === __wm_basis_None) {

return [registry_3154, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_45 === __wm_basis_None) {

return [registry_3154, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__v === __wm_basis_Nil) {

return [registry_3154, false];
}
__wm_fail("Match", "non-exhaustive match");
})(Js.Array.toList(expression_3156.children)) : (() => {
const typeIds_3174 = constraintTypeIds_2980__wm_d3(expression_3156, expressionRegistry_3150, typeRegistry_3152);
return applyNumericGroup_2984__wm_d2(typeIds_3174, registry_3154);
})());
if (!(__wm_is_tuple(__wm_bind_102) && __wm_bind_102.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_3175 = __wm_bind_102[0];
const expressionChanged_3176 = __wm_bind_102[1];
{
const __wm_tail_arg_221_0 = rest_3157;
const __wm_tail_arg_221_1 = fn_3147;
const __wm_tail_arg_221_2 = active_3148;
const __wm_tail_arg_221_3 = functionRegistry_3149;
const __wm_tail_arg_221_4 = expressionRegistry_3150;
const __wm_tail_arg_221_5 = bindingFunctions_3151;
const __wm_tail_arg_221_6 = typeRegistry_3152;
const __wm_tail_arg_221_7 = typeItems_3153;
const __wm_tail_arg_221_8 = nextRegistry_3175;
const __wm_tail_arg_221_9 = __wm_op_or_d2(changed_3155, expressionChanged_3176);
expressions_3146 = __wm_tail_arg_221_0;
fn_3147 = __wm_tail_arg_221_1;
active_3148 = __wm_tail_arg_221_2;
functionRegistry_3149 = __wm_tail_arg_221_3;
expressionRegistry_3150 = __wm_tail_arg_221_4;
bindingFunctions_3151 = __wm_tail_arg_221_5;
typeRegistry_3152 = __wm_tail_arg_221_6;
typeItems_3153 = __wm_tail_arg_221_7;
registry_3154 = __wm_tail_arg_221_8;
changed_3155 = __wm_tail_arg_221_9;
continue __wm_tail_163;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const instanceSweep_3120 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return instanceSweep_3120__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
const representationsEqual_3177__wm_d2 = (left_3178, right_3179) => {
const __wm_scalar_167_0 = left_3178;
const __wm_scalar_167_1 = right_3179;
if (__wm_scalar_167_0 === __wm_basis_Nil && __wm_scalar_167_1 === __wm_basis_Nil) {

return true;
} else if (__wm_scalar_167_0?.ctor === -6 && __wm_scalar_167_0.args.length === 1 && __wm_is_tuple(__wm_scalar_167_0.args[0]) && __wm_scalar_167_0.args[0].length === 2 && __wm_scalar_167_1?.ctor === -6 && __wm_scalar_167_1.args.length === 1 && __wm_is_tuple(__wm_scalar_167_1.args[0]) && __wm_scalar_167_1.args[0].length === 2) {
const leftHead_3180 = __wm_scalar_167_0.args[0][0];
const leftRest_3181 = __wm_scalar_167_0.args[0][1];
const rightHead_3182 = __wm_scalar_167_1.args[0][0];
const rightRest_3183 = __wm_scalar_167_1.args[0][1];
const same_3184 = __wm_op_or_d2(__wm_op_or_d2(__wm_op_and_d2(__wm_eq(leftHead_3180, ""), __wm_eq(rightHead_3182, "")), __wm_op_and_d2(__wm_eq(leftHead_3180, "i32"), __wm_eq(rightHead_3182, "i32"))), __wm_op_and_d2(__wm_eq(leftHead_3180, "f32"), __wm_eq(rightHead_3182, "f32")));
return __wm_op_and_d2(same_3184, representationsEqual_3177__wm_d2(leftRest_3181, rightRest_3183));
} else if (true) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
};
const representationsEqual_3177 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return representationsEqual_3177__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findSpecialization_3185__wm_d3 = (entries_3186, paramRepresentations_3187, resultRepresentation_3188) => {
__wm_tail_164: while (true) {
{
const __wm_tail_value_222 = entries_3186;
if (__wm_tail_value_222 === __wm_basis_Nil) {

return __wm_basis_None;
} else if (__wm_tail_value_222?.ctor === -6 && __wm_tail_value_222.args.length === 1 && __wm_is_tuple(__wm_tail_value_222.args[0]) && __wm_tail_value_222.args[0].length === 2) {
const entry_3189 = __wm_tail_value_222.args[0][0];
const rest_3190 = __wm_tail_value_222.args[0][1];
{
const exact_3191 = entry_3189;
const sameResult_3192 = __wm_op_or_d2(__wm_op_or_d2(__wm_op_and_d2(__wm_eq(exact_3191.resultRepresentation, ""), __wm_eq(resultRepresentation_3188, "")), __wm_op_and_d2(__wm_eq(exact_3191.resultRepresentation, "i32"), __wm_eq(resultRepresentation_3188, "i32"))), __wm_op_and_d2(__wm_eq(exact_3191.resultRepresentation, "f32"), __wm_eq(resultRepresentation_3188, "f32")));
if (__wm_op_and_d2(sameResult_3192, representationsEqual_3177__wm_d2(Js.Array.toList(exact_3191.paramRepresentations), paramRepresentations_3187))) {
return __wm_basis_Some(exact_3191.specializationId);
} else {
{
const __wm_tail_arg_223_0 = rest_3190;
const __wm_tail_arg_223_1 = paramRepresentations_3187;
const __wm_tail_arg_223_2 = resultRepresentation_3188;
entries_3186 = __wm_tail_arg_223_0;
paramRepresentations_3187 = __wm_tail_arg_223_1;
resultRepresentation_3188 = __wm_tail_arg_223_2;
continue __wm_tail_164;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findSpecialization_3185 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findSpecialization_3185__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const representationSuffix_3193__wm_d2 = (representations_3194, suffix_3195) => {
__wm_tail_165: while (true) {
{
const __wm_scalar_168_0 = representations_3194;
const __wm_scalar_168_1 = suffix_3195;
if (__wm_scalar_168_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_168_1, suffix_3195)) {

return suffix_3195;
} else if (__wm_scalar_168_0?.ctor === -6 && __wm_scalar_168_0.args.length === 1 && __wm_is_tuple(__wm_scalar_168_0.args[0]) && __wm_scalar_168_0.args[0].length === 2 && __wm_eq(__wm_scalar_168_1, suffix_3195)) {
const representation_3196 = __wm_scalar_168_0.args[0][0];
const rest_3197 = __wm_scalar_168_0.args[0][1];
{
const separator_3198 = (__wm_eq(suffix_3195, "") ? "" : "_");
{
const __wm_tail_arg_224_0 = rest_3197;
const __wm_tail_arg_224_1 = ((suffix_3195 + separator_3198) + representation_3196);
representations_3194 = __wm_tail_arg_224_0;
suffix_3195 = __wm_tail_arg_224_1;
continue __wm_tail_165;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const representationSuffix_3193 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return representationSuffix_3193__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const specializationName_3202__wm_d3 = (fn_3199, paramRepresentations_3200, resultRepresentation_3201) => {
return ((((fn_3199.name + "__gpu_") + representationSuffix_3193__wm_d2(paramRepresentations_3200, "")) + "_to_") + resultRepresentation_3201);
};
const specializationName_3202 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return specializationName_3202__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const addTypeIds_3203__wm_d2 = (typeIds_3204, typeSet_3205) => {
__wm_tail_166: while (true) {
{
const __wm_scalar_169_0 = typeIds_3204;
const __wm_scalar_169_1 = typeSet_3205;
if (__wm_scalar_169_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_169_1, typeSet_3205)) {

return typeSet_3205;
} else if (__wm_scalar_169_0?.ctor === -6 && __wm_scalar_169_0.args.length === 1 && __wm_is_tuple(__wm_scalar_169_0.args[0]) && __wm_scalar_169_0.args[0].length === 2 && __wm_eq(__wm_scalar_169_1, typeSet_3205)) {
const typeId_3206 = __wm_scalar_169_0.args[0][0];
const rest_3207 = __wm_scalar_169_0.args[0][1];
{
const __wm_tail_arg_225_0 = rest_3207;
const __wm_tail_arg_225_1 = Map.set([typeSet_3205, typeId_3206, true]);
typeIds_3204 = __wm_tail_arg_225_0;
typeSet_3205 = __wm_tail_arg_225_1;
continue __wm_tail_166;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addTypeIds_3203 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addTypeIds_3203__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collectInstanceTypeIds_3208__wm_d3 = (expressions_3209, typeRegistry_3210, typeSet_3211) => {
__wm_tail_167: while (true) {
{
const __wm_scalar_170_0 = expressions_3209;
const __wm_scalar_170_1 = typeRegistry_3210;
const __wm_scalar_170_2 = typeSet_3211;
if (__wm_scalar_170_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_170_1, typeRegistry_3210) && __wm_eq(__wm_scalar_170_2, typeSet_3211)) {

return typeSet_3211;
} else if (__wm_scalar_170_0?.ctor === -6 && __wm_scalar_170_0.args.length === 1 && __wm_is_tuple(__wm_scalar_170_0.args[0]) && __wm_scalar_170_0.args[0].length === 2 && __wm_eq(__wm_scalar_170_1, typeRegistry_3210) && __wm_eq(__wm_scalar_170_2, typeSet_3211)) {
const expression_3212 = __wm_scalar_170_0.args[0][0];
const rest_3213 = __wm_scalar_170_0.args[0][1];
{
const exact_3214 = expression_3212;
{
const __wm_tail_arg_226_0 = rest_3213;
const __wm_tail_arg_226_1 = typeRegistry_3210;
const __wm_tail_arg_226_2 = addTypeIds_3203__wm_d2(numericTypeIds_2958__wm_d3(__wm_basis_Cons([exact_3214.typeId, __wm_basis_Nil]), typeRegistry_3210, __wm_basis_Nil), typeSet_3211);
expressions_3209 = __wm_tail_arg_226_0;
typeRegistry_3210 = __wm_tail_arg_226_1;
typeSet_3211 = __wm_tail_arg_226_2;
continue __wm_tail_167;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const collectInstanceTypeIds_3208 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return collectInstanceTypeIds_3208__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const addParamTypeIds_3215__wm_d3 = (params_3216, typeRegistry_3217, typeSet_3218) => {
__wm_tail_168: while (true) {
{
const __wm_scalar_171_0 = params_3216;
const __wm_scalar_171_1 = typeRegistry_3217;
const __wm_scalar_171_2 = typeSet_3218;
if (__wm_scalar_171_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_171_1, typeRegistry_3217) && __wm_eq(__wm_scalar_171_2, typeSet_3218)) {

return typeSet_3218;
} else if (__wm_scalar_171_0?.ctor === -6 && __wm_scalar_171_0.args.length === 1 && __wm_is_tuple(__wm_scalar_171_0.args[0]) && __wm_scalar_171_0.args[0].length === 2 && __wm_eq(__wm_scalar_171_1, typeRegistry_3217) && __wm_eq(__wm_scalar_171_2, typeSet_3218)) {
const param_3219 = __wm_scalar_171_0.args[0][0];
const rest_3220 = __wm_scalar_171_0.args[0][1];
{
const exact_3221 = param_3219;
{
const __wm_tail_arg_227_0 = rest_3220;
const __wm_tail_arg_227_1 = typeRegistry_3217;
const __wm_tail_arg_227_2 = addTypeIds_3203__wm_d2(numericTypeIds_2958__wm_d3(__wm_basis_Cons([exact_3221.typeId, __wm_basis_Nil]), typeRegistry_3217, __wm_basis_Nil), typeSet_3218);
params_3216 = __wm_tail_arg_227_0;
typeRegistry_3217 = __wm_tail_arg_227_1;
typeSet_3218 = __wm_tail_arg_227_2;
continue __wm_tail_168;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addParamTypeIds_3215 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return addParamTypeIds_3215__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const representationFacts_3222__wm_d4 = (typeEntries_3223, typeRegistry_3224, representations_3225, facts_3226) => {
__wm_tail_169: while (true) {
{
const __wm_scalar_172_0 = typeEntries_3223;
const __wm_scalar_172_1 = typeRegistry_3224;
const __wm_scalar_172_2 = representations_3225;
const __wm_scalar_172_3 = facts_3226;
if (__wm_scalar_172_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_172_1, typeRegistry_3224) && __wm_eq(__wm_scalar_172_2, representations_3225) && __wm_eq(__wm_scalar_172_3, facts_3226)) {

return reverseInto_2698__wm_d2(facts_3226, __wm_basis_Nil);
} else if (__wm_scalar_172_0?.ctor === -6 && __wm_scalar_172_0.args.length === 1 && __wm_is_tuple(__wm_scalar_172_0.args[0]) && __wm_scalar_172_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_172_0.args[0][0]) && __wm_scalar_172_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_172_1, typeRegistry_3224) && __wm_eq(__wm_scalar_172_2, representations_3225) && __wm_eq(__wm_scalar_172_3, facts_3226)) {
const typeId_3227 = __wm_scalar_172_0.args[0][0][0];
const _present_3228 = __wm_scalar_172_0.args[0][0][1];
const rest_3229 = __wm_scalar_172_0.args[0][1];
{
const fact_3230 = { typeId: typeId_3227, representation: concreteRepresentation_3065__wm_d3(typeRegistry_3224, representations_3225, typeId_3227) };
{
const __wm_tail_arg_228_0 = rest_3229;
const __wm_tail_arg_228_1 = typeRegistry_3224;
const __wm_tail_arg_228_2 = representations_3225;
const __wm_tail_arg_228_3 = __wm_basis_Cons([fact_3230, facts_3226]);
typeEntries_3223 = __wm_tail_arg_228_0;
typeRegistry_3224 = __wm_tail_arg_228_1;
representations_3225 = __wm_tail_arg_228_2;
facts_3226 = __wm_tail_arg_228_3;
continue __wm_tail_169;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const representationFacts_3222 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return representationFacts_3222__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const specializationTypeFacts_3238__wm_d4 = (fn_3231, expressions_3232, typeRegistry_3233, representations_3234) => {
const withExpressions_3235 = collectInstanceTypeIds_3208__wm_d3(expressions_3232, typeRegistry_3233, Map.empty(Map.numberCompare));
const withParams_3236 = addParamTypeIds_3215__wm_d3(Js.Array.toList(fn_3231.params), typeRegistry_3233, withExpressions_3235);
const allTypes_3237 = addTypeIds_3203__wm_d2(numericTypeIds_2958__wm_d3(__wm_basis_Cons([fn_3231.resultTypeId, __wm_basis_Nil]), typeRegistry_3233, __wm_basis_Nil), withParams_3236);
return representationFacts_3222__wm_d4(Map.toList(allTypes_3237), typeRegistry_3233, representations_3234, __wm_basis_Nil);
};
const specializationTypeFacts_3238 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return specializationTypeFacts_3238__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const initialSpecializationState_3239 = (__arg) => {
if (__arg === undefined) {

return { nextId: 0, registry: Map.empty(Map.numberCompare), specializations: __wm_basis_Nil, rootSpecializations: __wm_basis_Nil, calls: __wm_basis_Nil, diagnostics: __wm_basis_Nil };
}
__wm_fail("Match", "pattern match failure in function");
};
const withSpecializedCall_3242__wm_d2 = (state_3240, call_3241) => {
return { nextId: state_3240.nextId, registry: state_3240.registry, specializations: state_3240.specializations, rootSpecializations: state_3240.rootSpecializations, calls: __wm_basis_Cons([call_3241, state_3240.calls]), diagnostics: state_3240.diagnostics };
};
const withSpecializedCall_3242 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return withSpecializedCall_3242__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const withSpecializationDiagnostic_3245__wm_d2 = (state_3243, diagnostic_3244) => {
return { nextId: state_3243.nextId, registry: state_3243.registry, specializations: state_3243.specializations, rootSpecializations: state_3243.rootSpecializations, calls: state_3243.calls, diagnostics: __wm_basis_Cons([diagnostic_3244, state_3243.diagnostics]) };
};
const withSpecializationDiagnostic_3245 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return withSpecializationDiagnostic_3245__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const mutualRecursionDiagnostic_3248 = (__arg) => {
if (true) {
const expression_3246 = __arg;
const diagnostic_3247 = { code: "gpu.mutual-recursion", message: "mutually recursive GPU functions are not supported by the current specialization pass", spanId: expression_3246.spanId };
return diagnostic_3247;
}
__wm_fail("Match", "pattern match failure in function");
};
const materializeSpecialization_3249__wm_d10 = (fn_3251, requestedParams_3252, requestedResult_3253, active_3254, state_3255, functionRegistry_3256, expressionRegistry_3257, bindingFunctions_3258, typeRegistry_3259, typeItems_3260) => {
const representations_3261 = solveFunctionInstance_3118__wm_d9(fn_3251, requestedParams_3252, requestedResult_3253, Map.empty(Map.numberCompare), functionRegistry_3256, expressionRegistry_3257, bindingFunctions_3258, typeRegistry_3259, typeItems_3260);
const paramRepresentations_3262 = functionParamRepresentations_3084__wm_d4(Js.Array.toList(fn_3251.params), typeRegistry_3259, representations_3261, __wm_basis_Nil);
const resultRepresentation_3263 = concreteRepresentation_3065__wm_d3(typeRegistry_3259, representations_3261, fn_3251.resultTypeId);
const existingEntries_3265 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const entries_3264 = __v.args[0];
return entries_3264;
} else if (__v === __wm_basis_None) {

return __wm_basis_Nil;
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([state_3255.registry, fn_3251.id]));
const __wm_return_value_48 = findSpecialization_3185__wm_d3(existingEntries_3265, paramRepresentations_3262, resultRepresentation_3263);
if (__wm_return_value_48?.ctor === -2 && __wm_return_value_48.args.length === 1) {
const specializationId_3266 = __wm_return_value_48.args[0];
return [state_3255, specializationId_3266];
} else if (__wm_return_value_48 === __wm_basis_None) {

const specializationId_3267 = state_3255.nextId;
const expressions_3268 = collectExpressionItems_3049__wm_d4(__wm_basis_Cons([fn_3251.bodyExprId, __wm_basis_Nil]), expressionRegistry_3257, Map.empty(Map.numberCompare), __wm_basis_Nil);
const specialization_3270 = { id: specializationId_3267, functionId: fn_3251.id, bindingId: fn_3251.bindingId, name: specializationName_3202__wm_d3(fn_3251, paramRepresentations_3262, resultRepresentation_3263), paramTypeIds: Js.Array.fromList(List.map([Js.Array.toList(fn_3251.params), (__arg) => {
if (true) {
const param_3269 = __arg;
return param_3269.typeId;
}
__wm_fail("Match", "pattern match failure in function");
}])), resultTypeId: fn_3251.resultTypeId, paramRepresentations: Js.Array.fromList(paramRepresentations_3262), resultRepresentation: resultRepresentation_3263, typeFacts: Js.Array.fromList(specializationTypeFacts_3238__wm_d4(fn_3251, expressions_3268, typeRegistry_3259, representations_3261)) };
const entry_3271 = { specializationId: specializationId_3267, paramRepresentations: Js.Array.fromList(paramRepresentations_3262), resultRepresentation: resultRepresentation_3263 };
const registered_3272 = { nextId: (specializationId_3267 + 1), registry: Map.set([state_3255.registry, fn_3251.id, __wm_basis_Cons([entry_3271, existingEntries_3265])]), specializations: __wm_basis_Cons([specialization_3270, state_3255.specializations]), rootSpecializations: state_3255.rootSpecializations, calls: state_3255.calls, diagnostics: state_3255.diagnostics };
return materializeSpecializedCalls_3250__wm_d11(expressions_3268, fn_3251, specializationId_3267, representations_3261, Map.set([active_3254, fn_3251.id, specializationId_3267]), registered_3272, functionRegistry_3256, expressionRegistry_3257, bindingFunctions_3258, typeRegistry_3259, typeItems_3260);
}
__wm_fail("Match", "non-exhaustive match");
};
const materializeSpecialization_3249 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return materializeSpecialization_3249__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
const materializeSpecializedCalls_3250__wm_d11 = (expressions_3273, fn_3274, callerSpecializationId_3275, representations_3276, active_3277, state_3278, functionRegistry_3279, expressionRegistry_3280, bindingFunctions_3281, typeRegistry_3282, typeItems_3283) => {
__wm_tail_170: while (true) {
{
const __wm_scalar_173_0 = expressions_3273;
const __wm_scalar_173_1 = fn_3274;
const __wm_scalar_173_2 = callerSpecializationId_3275;
const __wm_scalar_173_3 = representations_3276;
const __wm_scalar_173_4 = active_3277;
const __wm_scalar_173_5 = state_3278;
const __wm_scalar_173_6 = functionRegistry_3279;
const __wm_scalar_173_7 = expressionRegistry_3280;
const __wm_scalar_173_8 = bindingFunctions_3281;
const __wm_scalar_173_9 = typeRegistry_3282;
const __wm_scalar_173_10 = typeItems_3283;
if (__wm_scalar_173_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_173_1, fn_3274) && __wm_eq(__wm_scalar_173_2, callerSpecializationId_3275) && __wm_eq(__wm_scalar_173_3, representations_3276) && __wm_eq(__wm_scalar_173_4, active_3277) && __wm_eq(__wm_scalar_173_5, state_3278) && __wm_eq(__wm_scalar_173_6, functionRegistry_3279) && __wm_eq(__wm_scalar_173_7, expressionRegistry_3280) && __wm_eq(__wm_scalar_173_8, bindingFunctions_3281) && __wm_eq(__wm_scalar_173_9, typeRegistry_3282) && __wm_eq(__wm_scalar_173_10, typeItems_3283)) {

return [state_3278, callerSpecializationId_3275];
} else if (__wm_scalar_173_0?.ctor === -6 && __wm_scalar_173_0.args.length === 1 && __wm_is_tuple(__wm_scalar_173_0.args[0]) && __wm_scalar_173_0.args[0].length === 2 && __wm_eq(__wm_scalar_173_1, fn_3274) && __wm_eq(__wm_scalar_173_2, callerSpecializationId_3275) && __wm_eq(__wm_scalar_173_3, representations_3276) && __wm_eq(__wm_scalar_173_4, active_3277) && __wm_eq(__wm_scalar_173_5, state_3278) && __wm_eq(__wm_scalar_173_6, functionRegistry_3279) && __wm_eq(__wm_scalar_173_7, expressionRegistry_3280) && __wm_eq(__wm_scalar_173_8, bindingFunctions_3281) && __wm_eq(__wm_scalar_173_9, typeRegistry_3282) && __wm_eq(__wm_scalar_173_10, typeItems_3283)) {
const expression_3284 = __wm_scalar_173_0.args[0][0];
const rest_3285 = __wm_scalar_173_0.args[0][1];
{
const exactExpression_3286 = expression_3284;
const exactFunction_3287 = fn_3274;
if (__wm_eq(exactExpression_3286.kind, "call")) {
{
const __wm_tail_value_229 = Js.Array.toList(exactExpression_3286.children);
if (__wm_tail_value_229?.ctor === -6 && __wm_tail_value_229.args.length === 1 && __wm_is_tuple(__wm_tail_value_229.args[0]) && __wm_tail_value_229.args[0].length === 2) {
const calleeId_3288 = __wm_tail_value_229.args[0][0];
const argumentIds_3289 = __wm_tail_value_229.args[0][1];
{
const __wm_tail_value_230 = Map.get([expressionRegistry_3280, calleeId_3288]);
if (__wm_tail_value_230?.ctor === -2 && __wm_tail_value_230.args.length === 1) {
const callee_3290 = __wm_tail_value_230.args[0];
{
const exactCallee_3291 = callee_3290;
{
const __wm_tail_value_231 = Map.get([bindingFunctions_3281, exactCallee_3291.bindingId]);
if (__wm_tail_value_231?.ctor === -2 && __wm_tail_value_231.args.length === 1) {
const functionId_3292 = __wm_tail_value_231.args[0];
{
const __wm_tail_value_232 = Map.get([functionRegistry_3279, functionId_3292]);
if (__wm_tail_value_232?.ctor === -2 && __wm_tail_value_232.args.length === 1) {
const rawCalleeFn_3293 = __wm_tail_value_232.args[0];
{
const calleeFn_3294 = rawCalleeFn_3293;
const activeTarget_3295 = Map.get([active_3277, calleeFn_3294.id]);
const argumentRepresentations_3296 = callArgumentRepresentations_3092__wm_d5(argumentIds_3289, expressionRegistry_3280, typeRegistry_3282, representations_3276, __wm_basis_Nil);
const callResultRepresentation_3297 = concreteRepresentation_3065__wm_d3(typeRegistry_3282, representations_3276, exactExpression_3286.typeId);
const __wm_bind_105 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const targetId_3298 = __v.args[0];
const nextState_3299 = (__wm_eq(calleeFn_3294.id, exactFunction_3287.id) ? state_3278 : withSpecializationDiagnostic_3245__wm_d2(state_3278, mutualRecursionDiagnostic_3248(exactExpression_3286)));
return [nextState_3299, targetId_3298];
} else if (__v === __wm_basis_None) {

return materializeSpecialization_3249__wm_d10(calleeFn_3294, argumentRepresentations_3296, callResultRepresentation_3297, active_3277, state_3278, functionRegistry_3279, expressionRegistry_3280, bindingFunctions_3281, typeRegistry_3282, typeItems_3283);
}
__wm_fail("Match", "non-exhaustive match");
})(activeTarget_3295);
if (!(__wm_is_tuple(__wm_bind_105) && __wm_bind_105.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterTarget_3300 = __wm_bind_105[0];
const targetSpecializationId_3301 = __wm_bind_105[1];
const call_3302 = { callerSpecializationId: callerSpecializationId_3275, expressionId: exactExpression_3286.id, targetSpecializationId: targetSpecializationId_3301 };
{
const __wm_tail_arg_233_0 = rest_3285;
const __wm_tail_arg_233_1 = exactFunction_3287;
const __wm_tail_arg_233_2 = callerSpecializationId_3275;
const __wm_tail_arg_233_3 = representations_3276;
const __wm_tail_arg_233_4 = active_3277;
const __wm_tail_arg_233_5 = withSpecializedCall_3242__wm_d2(afterTarget_3300, call_3302);
const __wm_tail_arg_233_6 = functionRegistry_3279;
const __wm_tail_arg_233_7 = expressionRegistry_3280;
const __wm_tail_arg_233_8 = bindingFunctions_3281;
const __wm_tail_arg_233_9 = typeRegistry_3282;
const __wm_tail_arg_233_10 = typeItems_3283;
expressions_3273 = __wm_tail_arg_233_0;
fn_3274 = __wm_tail_arg_233_1;
callerSpecializationId_3275 = __wm_tail_arg_233_2;
representations_3276 = __wm_tail_arg_233_3;
active_3277 = __wm_tail_arg_233_4;
state_3278 = __wm_tail_arg_233_5;
functionRegistry_3279 = __wm_tail_arg_233_6;
expressionRegistry_3280 = __wm_tail_arg_233_7;
bindingFunctions_3281 = __wm_tail_arg_233_8;
typeRegistry_3282 = __wm_tail_arg_233_9;
typeItems_3283 = __wm_tail_arg_233_10;
continue __wm_tail_170;
}
}
} else if (__wm_tail_value_232 === __wm_basis_None) {

{
const __wm_tail_arg_234_0 = rest_3285;
const __wm_tail_arg_234_1 = exactFunction_3287;
const __wm_tail_arg_234_2 = callerSpecializationId_3275;
const __wm_tail_arg_234_3 = representations_3276;
const __wm_tail_arg_234_4 = active_3277;
const __wm_tail_arg_234_5 = state_3278;
const __wm_tail_arg_234_6 = functionRegistry_3279;
const __wm_tail_arg_234_7 = expressionRegistry_3280;
const __wm_tail_arg_234_8 = bindingFunctions_3281;
const __wm_tail_arg_234_9 = typeRegistry_3282;
const __wm_tail_arg_234_10 = typeItems_3283;
expressions_3273 = __wm_tail_arg_234_0;
fn_3274 = __wm_tail_arg_234_1;
callerSpecializationId_3275 = __wm_tail_arg_234_2;
representations_3276 = __wm_tail_arg_234_3;
active_3277 = __wm_tail_arg_234_4;
state_3278 = __wm_tail_arg_234_5;
functionRegistry_3279 = __wm_tail_arg_234_6;
expressionRegistry_3280 = __wm_tail_arg_234_7;
bindingFunctions_3281 = __wm_tail_arg_234_8;
typeRegistry_3282 = __wm_tail_arg_234_9;
typeItems_3283 = __wm_tail_arg_234_10;
continue __wm_tail_170;
}
}
__wm_fail("Match", "non-exhaustive match");
}
} else if (__wm_tail_value_231 === __wm_basis_None) {

{
const __wm_tail_arg_235_0 = rest_3285;
const __wm_tail_arg_235_1 = exactFunction_3287;
const __wm_tail_arg_235_2 = callerSpecializationId_3275;
const __wm_tail_arg_235_3 = representations_3276;
const __wm_tail_arg_235_4 = active_3277;
const __wm_tail_arg_235_5 = state_3278;
const __wm_tail_arg_235_6 = functionRegistry_3279;
const __wm_tail_arg_235_7 = expressionRegistry_3280;
const __wm_tail_arg_235_8 = bindingFunctions_3281;
const __wm_tail_arg_235_9 = typeRegistry_3282;
const __wm_tail_arg_235_10 = typeItems_3283;
expressions_3273 = __wm_tail_arg_235_0;
fn_3274 = __wm_tail_arg_235_1;
callerSpecializationId_3275 = __wm_tail_arg_235_2;
representations_3276 = __wm_tail_arg_235_3;
active_3277 = __wm_tail_arg_235_4;
state_3278 = __wm_tail_arg_235_5;
functionRegistry_3279 = __wm_tail_arg_235_6;
expressionRegistry_3280 = __wm_tail_arg_235_7;
bindingFunctions_3281 = __wm_tail_arg_235_8;
typeRegistry_3282 = __wm_tail_arg_235_9;
typeItems_3283 = __wm_tail_arg_235_10;
continue __wm_tail_170;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
} else if (__wm_tail_value_230 === __wm_basis_None) {

{
const __wm_tail_arg_236_0 = rest_3285;
const __wm_tail_arg_236_1 = exactFunction_3287;
const __wm_tail_arg_236_2 = callerSpecializationId_3275;
const __wm_tail_arg_236_3 = representations_3276;
const __wm_tail_arg_236_4 = active_3277;
const __wm_tail_arg_236_5 = state_3278;
const __wm_tail_arg_236_6 = functionRegistry_3279;
const __wm_tail_arg_236_7 = expressionRegistry_3280;
const __wm_tail_arg_236_8 = bindingFunctions_3281;
const __wm_tail_arg_236_9 = typeRegistry_3282;
const __wm_tail_arg_236_10 = typeItems_3283;
expressions_3273 = __wm_tail_arg_236_0;
fn_3274 = __wm_tail_arg_236_1;
callerSpecializationId_3275 = __wm_tail_arg_236_2;
representations_3276 = __wm_tail_arg_236_3;
active_3277 = __wm_tail_arg_236_4;
state_3278 = __wm_tail_arg_236_5;
functionRegistry_3279 = __wm_tail_arg_236_6;
expressionRegistry_3280 = __wm_tail_arg_236_7;
bindingFunctions_3281 = __wm_tail_arg_236_8;
typeRegistry_3282 = __wm_tail_arg_236_9;
typeItems_3283 = __wm_tail_arg_236_10;
continue __wm_tail_170;
}
}
__wm_fail("Match", "non-exhaustive match");
}
} else if (__wm_tail_value_229 === __wm_basis_Nil) {

{
const __wm_tail_arg_237_0 = rest_3285;
const __wm_tail_arg_237_1 = exactFunction_3287;
const __wm_tail_arg_237_2 = callerSpecializationId_3275;
const __wm_tail_arg_237_3 = representations_3276;
const __wm_tail_arg_237_4 = active_3277;
const __wm_tail_arg_237_5 = state_3278;
const __wm_tail_arg_237_6 = functionRegistry_3279;
const __wm_tail_arg_237_7 = expressionRegistry_3280;
const __wm_tail_arg_237_8 = bindingFunctions_3281;
const __wm_tail_arg_237_9 = typeRegistry_3282;
const __wm_tail_arg_237_10 = typeItems_3283;
expressions_3273 = __wm_tail_arg_237_0;
fn_3274 = __wm_tail_arg_237_1;
callerSpecializationId_3275 = __wm_tail_arg_237_2;
representations_3276 = __wm_tail_arg_237_3;
active_3277 = __wm_tail_arg_237_4;
state_3278 = __wm_tail_arg_237_5;
functionRegistry_3279 = __wm_tail_arg_237_6;
expressionRegistry_3280 = __wm_tail_arg_237_7;
bindingFunctions_3281 = __wm_tail_arg_237_8;
typeRegistry_3282 = __wm_tail_arg_237_9;
typeItems_3283 = __wm_tail_arg_237_10;
continue __wm_tail_170;
}
}
__wm_fail("Match", "non-exhaustive match");
}
} else {
{
const __wm_tail_arg_238_0 = rest_3285;
const __wm_tail_arg_238_1 = exactFunction_3287;
const __wm_tail_arg_238_2 = callerSpecializationId_3275;
const __wm_tail_arg_238_3 = representations_3276;
const __wm_tail_arg_238_4 = active_3277;
const __wm_tail_arg_238_5 = state_3278;
const __wm_tail_arg_238_6 = functionRegistry_3279;
const __wm_tail_arg_238_7 = expressionRegistry_3280;
const __wm_tail_arg_238_8 = bindingFunctions_3281;
const __wm_tail_arg_238_9 = typeRegistry_3282;
const __wm_tail_arg_238_10 = typeItems_3283;
expressions_3273 = __wm_tail_arg_238_0;
fn_3274 = __wm_tail_arg_238_1;
callerSpecializationId_3275 = __wm_tail_arg_238_2;
representations_3276 = __wm_tail_arg_238_3;
active_3277 = __wm_tail_arg_238_4;
state_3278 = __wm_tail_arg_238_5;
functionRegistry_3279 = __wm_tail_arg_238_6;
expressionRegistry_3280 = __wm_tail_arg_238_7;
bindingFunctions_3281 = __wm_tail_arg_238_8;
typeRegistry_3282 = __wm_tail_arg_238_9;
typeItems_3283 = __wm_tail_arg_238_10;
continue __wm_tail_170;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const materializeSpecializedCalls_3250 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 11) return materializeSpecializedCalls_3250__wm_d11(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9], __arg[10]);
__wm_fail("Match", "pattern match failure in function");
};
const materializeRootSpecializations_3303__wm_d7 = (roots_3304, state_3305, functionRegistry_3306, expressionRegistry_3307, bindingFunctions_3308, typeRegistry_3309, typeItems_3310) => {
__wm_tail_171: while (true) {
{
const __wm_scalar_174_0 = roots_3304;
const __wm_scalar_174_1 = state_3305;
const __wm_scalar_174_2 = functionRegistry_3306;
const __wm_scalar_174_3 = expressionRegistry_3307;
const __wm_scalar_174_4 = bindingFunctions_3308;
const __wm_scalar_174_5 = typeRegistry_3309;
const __wm_scalar_174_6 = typeItems_3310;
if (__wm_scalar_174_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_174_1, state_3305) && __wm_eq(__wm_scalar_174_2, functionRegistry_3306) && __wm_eq(__wm_scalar_174_3, expressionRegistry_3307) && __wm_eq(__wm_scalar_174_4, bindingFunctions_3308) && __wm_eq(__wm_scalar_174_5, typeRegistry_3309) && __wm_eq(__wm_scalar_174_6, typeItems_3310)) {

return state_3305;
} else if (__wm_scalar_174_0?.ctor === -6 && __wm_scalar_174_0.args.length === 1 && __wm_is_tuple(__wm_scalar_174_0.args[0]) && __wm_scalar_174_0.args[0].length === 2 && __wm_eq(__wm_scalar_174_1, state_3305) && __wm_eq(__wm_scalar_174_2, functionRegistry_3306) && __wm_eq(__wm_scalar_174_3, expressionRegistry_3307) && __wm_eq(__wm_scalar_174_4, bindingFunctions_3308) && __wm_eq(__wm_scalar_174_5, typeRegistry_3309) && __wm_eq(__wm_scalar_174_6, typeItems_3310)) {
const root_3311 = __wm_scalar_174_0.args[0][0];
const rest_3312 = __wm_scalar_174_0.args[0][1];
{
const gpuRoot_3313 = root_3311;
{
const __wm_tail_value_239 = Map.get([functionRegistry_3306, gpuRoot_3313.functionId]);
if (__wm_tail_value_239?.ctor === -2 && __wm_tail_value_239.args.length === 1) {
const rawFn_3314 = __wm_tail_value_239.args[0];
{
const fn_3315 = rawFn_3314;
const __wm_bind_106 = materializeSpecialization_3249__wm_d10(fn_3315, __wm_basis_Nil, "", Map.empty(Map.numberCompare), state_3305, functionRegistry_3306, expressionRegistry_3307, bindingFunctions_3308, typeRegistry_3309, typeItems_3310);
if (!(__wm_is_tuple(__wm_bind_106) && __wm_bind_106.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterSpecialization_3316 = __wm_bind_106[0];
const specializationId_3317 = __wm_bind_106[1];
const rootSpecialization_3318 = { regionId: gpuRoot_3313.regionId, specializationId: specializationId_3317 };
const withRoot_3319 = { nextId: afterSpecialization_3316.nextId, registry: afterSpecialization_3316.registry, specializations: afterSpecialization_3316.specializations, rootSpecializations: __wm_basis_Cons([rootSpecialization_3318, afterSpecialization_3316.rootSpecializations]), calls: afterSpecialization_3316.calls, diagnostics: afterSpecialization_3316.diagnostics };
{
const __wm_tail_arg_240_0 = rest_3312;
const __wm_tail_arg_240_1 = withRoot_3319;
const __wm_tail_arg_240_2 = functionRegistry_3306;
const __wm_tail_arg_240_3 = expressionRegistry_3307;
const __wm_tail_arg_240_4 = bindingFunctions_3308;
const __wm_tail_arg_240_5 = typeRegistry_3309;
const __wm_tail_arg_240_6 = typeItems_3310;
roots_3304 = __wm_tail_arg_240_0;
state_3305 = __wm_tail_arg_240_1;
functionRegistry_3306 = __wm_tail_arg_240_2;
expressionRegistry_3307 = __wm_tail_arg_240_3;
bindingFunctions_3308 = __wm_tail_arg_240_4;
typeRegistry_3309 = __wm_tail_arg_240_5;
typeItems_3310 = __wm_tail_arg_240_6;
continue __wm_tail_171;
}
}
} else if (__wm_tail_value_239 === __wm_basis_None) {

{
const __wm_tail_arg_241_0 = rest_3312;
const __wm_tail_arg_241_1 = state_3305;
const __wm_tail_arg_241_2 = functionRegistry_3306;
const __wm_tail_arg_241_3 = expressionRegistry_3307;
const __wm_tail_arg_241_4 = bindingFunctions_3308;
const __wm_tail_arg_241_5 = typeRegistry_3309;
const __wm_tail_arg_241_6 = typeItems_3310;
roots_3304 = __wm_tail_arg_241_0;
state_3305 = __wm_tail_arg_241_1;
functionRegistry_3306 = __wm_tail_arg_241_2;
expressionRegistry_3307 = __wm_tail_arg_241_3;
bindingFunctions_3308 = __wm_tail_arg_241_4;
typeRegistry_3309 = __wm_tail_arg_241_5;
typeItems_3310 = __wm_tail_arg_241_6;
continue __wm_tail_171;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const materializeRootSpecializations_3303 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return materializeRootSpecializations_3303__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const initialIrBuildState_3320 = (__arg) => {
if (__arg === undefined) {

return { nextExpressionId: 0, functions: Map.empty(Map.numberCompare), expressions: Map.empty(Map.numberCompare) };
}
__wm_fail("Match", "pattern match failure in function");
};
const indexRepresentationFacts_3321__wm_d2 = (facts_3322, registry_3323) => {
__wm_tail_172: while (true) {
{
const __wm_scalar_175_0 = facts_3322;
const __wm_scalar_175_1 = registry_3323;
if (__wm_scalar_175_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_175_1, registry_3323)) {

return registry_3323;
} else if (__wm_scalar_175_0?.ctor === -6 && __wm_scalar_175_0.args.length === 1 && __wm_is_tuple(__wm_scalar_175_0.args[0]) && __wm_scalar_175_0.args[0].length === 2 && __wm_eq(__wm_scalar_175_1, registry_3323)) {
const fact_3324 = __wm_scalar_175_0.args[0][0];
const rest_3325 = __wm_scalar_175_0.args[0][1];
{
const exact_3326 = fact_3324;
{
const __wm_tail_arg_242_0 = rest_3325;
const __wm_tail_arg_242_1 = Map.set([registry_3323, exact_3326.typeId, exact_3326.representation]);
facts_3322 = __wm_tail_arg_242_0;
registry_3323 = __wm_tail_arg_242_1;
continue __wm_tail_172;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexRepresentationFacts_3321 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexRepresentationFacts_3321__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const irRepresentation_3330__wm_d2 = (facts_3327, typeId_3328) => {
const __wm_return_value_49 = Map.get([facts_3327, typeId_3328]);
if (__wm_return_value_49?.ctor === -2 && __wm_return_value_49.args.length === 1) {
const representation_3329 = __wm_return_value_49.args[0];
return representation_3329;
} else if (__wm_return_value_49 === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const irRepresentation_3330 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return irRepresentation_3330__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const specializedCallTarget_3331__wm_d3 = (calls_3332, specializationId_3333, expressionId_3334) => {
__wm_tail_173: while (true) {
{
const __wm_scalar_176_0 = calls_3332;
const __wm_scalar_176_1 = specializationId_3333;
const __wm_scalar_176_2 = expressionId_3334;
if (__wm_scalar_176_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_176_1, specializationId_3333) && __wm_eq(__wm_scalar_176_2, expressionId_3334)) {

return __wm_op_sub(1);
} else if (__wm_scalar_176_0?.ctor === -6 && __wm_scalar_176_0.args.length === 1 && __wm_is_tuple(__wm_scalar_176_0.args[0]) && __wm_scalar_176_0.args[0].length === 2 && __wm_eq(__wm_scalar_176_1, specializationId_3333) && __wm_eq(__wm_scalar_176_2, expressionId_3334)) {
const rawCall_3335 = __wm_scalar_176_0.args[0][0];
const rest_3336 = __wm_scalar_176_0.args[0][1];
{
const call_3337 = rawCall_3335;
if (__wm_op_and_d2(__wm_eq(call_3337.callerSpecializationId, specializationId_3333), __wm_eq(call_3337.expressionId, expressionId_3334))) {
return call_3337.targetSpecializationId;
} else {
{
const __wm_tail_arg_243_0 = rest_3336;
const __wm_tail_arg_243_1 = specializationId_3333;
const __wm_tail_arg_243_2 = expressionId_3334;
calls_3332 = __wm_tail_arg_243_0;
specializationId_3333 = __wm_tail_arg_243_1;
expressionId_3334 = __wm_tail_arg_243_2;
continue __wm_tail_173;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const specializedCallTarget_3331 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return specializedCallTarget_3331__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const irValueKind_3341__wm_d3 = (expression_3338, bound_3339, bindingFunctions_3340) => {
if (__wm_op_or_d2(__wm_op_or_d2(__wm_op_or_d2(__wm_eq(expression_3338.kind, "number"), __wm_eq(expression_3338.kind, "bool")), __wm_eq(expression_3338.kind, "string")), __wm_eq(expression_3338.kind, "void"))) {
return "literal";
} else {
if (__wm_eq(expression_3338.kind, "var")) {
if ((expression_3338.bindingId < 0)) {
return "unresolved";
} else {
if (Map.has([bound_3339, expression_3338.bindingId])) {
return "local";
} else {
if (Map.has([bindingFunctions_3340, expression_3338.bindingId])) {
return "function";
} else {
return "capture";
}
}
}
} else {
return "none";
}
}
};
const irValueKind_3341 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return irValueKind_3341__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const reifyIrExpression_3342__wm_d8 = (sourceExpressionId_3344, specializationId_3345, facts_3346, bound_3347, calls_3348, expressionRegistry_3349, bindingFunctions_3350, state_3351) => {
const __wm_return_value_50 = Map.get([expressionRegistry_3349, sourceExpressionId_3344]);
if (__wm_return_value_50 === __wm_basis_None) {

return [state_3351, __wm_op_sub(1)];
} else if (__wm_return_value_50?.ctor === -2 && __wm_return_value_50.args.length === 1) {
const rawExpression_3352 = __wm_return_value_50.args[0];
const expression_3353 = rawExpression_3352;
const irExpressionId_3354 = state_3351.nextExpressionId;
const reserved_3355 = { nextExpressionId: (irExpressionId_3354 + 1), functions: state_3351.functions, expressions: state_3351.expressions };
const __wm_bind_107 = reifyIrChildren_3343__wm_d9(Js.Array.toList(expression_3353.children), specializationId_3345, facts_3346, bound_3347, calls_3348, expressionRegistry_3349, bindingFunctions_3350, reserved_3355, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_107) && __wm_bind_107.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withChildren_3356 = __wm_bind_107[0];
const childIds_3357 = __wm_bind_107[1];
const irExpression_3358 = { id: irExpressionId_3354, specializationId: specializationId_3345, sourceExprId: expression_3353.id, kind: expression_3353.kind, typeId: expression_3353.typeId, representation: irRepresentation_3330__wm_d2(facts_3346, expression_3353.typeId), spanId: expression_3353.spanId, bindingId: expression_3353.bindingId, name: expression_3353.name, operator: expression_3353.operator, numberValue: expression_3353.numberValue, boolValue: expression_3353.boolValue, children: Js.Array.fromList(childIds_3357), capability: expression_3353.capability, valueKind: irValueKind_3341__wm_d3(expression_3353, bound_3347, bindingFunctions_3350), callTargetSpecializationId: specializedCallTarget_3331__wm_d3(calls_3348, specializationId_3345, expression_3353.id) };
const completed_3359 = { nextExpressionId: withChildren_3356.nextExpressionId, functions: withChildren_3356.functions, expressions: Map.set([withChildren_3356.expressions, irExpressionId_3354, irExpression_3358]) };
return [completed_3359, irExpressionId_3354];
}
__wm_fail("Match", "non-exhaustive match");
};
const reifyIrExpression_3342 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 8) return reifyIrExpression_3342__wm_d8(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7]);
__wm_fail("Match", "pattern match failure in function");
};
const reifyIrChildren_3343__wm_d9 = (sourceChildIds_3360, specializationId_3361, facts_3362, bound_3363, calls_3364, expressionRegistry_3365, bindingFunctions_3366, state_3367, childIds_3368) => {
__wm_tail_174: while (true) {
{
const __wm_scalar_177_0 = sourceChildIds_3360;
const __wm_scalar_177_1 = specializationId_3361;
const __wm_scalar_177_2 = facts_3362;
const __wm_scalar_177_3 = bound_3363;
const __wm_scalar_177_4 = calls_3364;
const __wm_scalar_177_5 = expressionRegistry_3365;
const __wm_scalar_177_6 = bindingFunctions_3366;
const __wm_scalar_177_7 = state_3367;
const __wm_scalar_177_8 = childIds_3368;
if (__wm_scalar_177_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_177_1, specializationId_3361) && __wm_eq(__wm_scalar_177_2, facts_3362) && __wm_eq(__wm_scalar_177_3, bound_3363) && __wm_eq(__wm_scalar_177_4, calls_3364) && __wm_eq(__wm_scalar_177_5, expressionRegistry_3365) && __wm_eq(__wm_scalar_177_6, bindingFunctions_3366) && __wm_eq(__wm_scalar_177_7, state_3367) && __wm_eq(__wm_scalar_177_8, childIds_3368)) {

return [state_3367, reverseInto_2698__wm_d2(childIds_3368, __wm_basis_Nil)];
} else if (__wm_scalar_177_0?.ctor === -6 && __wm_scalar_177_0.args.length === 1 && __wm_is_tuple(__wm_scalar_177_0.args[0]) && __wm_scalar_177_0.args[0].length === 2 && __wm_eq(__wm_scalar_177_1, specializationId_3361) && __wm_eq(__wm_scalar_177_2, facts_3362) && __wm_eq(__wm_scalar_177_3, bound_3363) && __wm_eq(__wm_scalar_177_4, calls_3364) && __wm_eq(__wm_scalar_177_5, expressionRegistry_3365) && __wm_eq(__wm_scalar_177_6, bindingFunctions_3366) && __wm_eq(__wm_scalar_177_7, state_3367) && __wm_eq(__wm_scalar_177_8, childIds_3368)) {
const sourceChildId_3369 = __wm_scalar_177_0.args[0][0];
const rest_3370 = __wm_scalar_177_0.args[0][1];
{
const __wm_bind_108 = reifyIrExpression_3342__wm_d8(sourceChildId_3369, specializationId_3361, facts_3362, bound_3363, calls_3364, expressionRegistry_3365, bindingFunctions_3366, state_3367);
if (!(__wm_is_tuple(__wm_bind_108) && __wm_bind_108.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextState_3371 = __wm_bind_108[0];
const childId_3372 = __wm_bind_108[1];
{
const __wm_tail_arg_244_0 = rest_3370;
const __wm_tail_arg_244_1 = specializationId_3361;
const __wm_tail_arg_244_2 = facts_3362;
const __wm_tail_arg_244_3 = bound_3363;
const __wm_tail_arg_244_4 = calls_3364;
const __wm_tail_arg_244_5 = expressionRegistry_3365;
const __wm_tail_arg_244_6 = bindingFunctions_3366;
const __wm_tail_arg_244_7 = nextState_3371;
const __wm_tail_arg_244_8 = __wm_basis_Cons([childId_3372, childIds_3368]);
sourceChildIds_3360 = __wm_tail_arg_244_0;
specializationId_3361 = __wm_tail_arg_244_1;
facts_3362 = __wm_tail_arg_244_2;
bound_3363 = __wm_tail_arg_244_3;
calls_3364 = __wm_tail_arg_244_4;
expressionRegistry_3365 = __wm_tail_arg_244_5;
bindingFunctions_3366 = __wm_tail_arg_244_6;
state_3367 = __wm_tail_arg_244_7;
childIds_3368 = __wm_tail_arg_244_8;
continue __wm_tail_174;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reifyIrChildren_3343 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return reifyIrChildren_3343__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const reifyIrParams_3373__wm_d3 = (params_3374, facts_3375, output_3376) => {
__wm_tail_175: while (true) {
{
const __wm_scalar_178_0 = params_3374;
const __wm_scalar_178_1 = facts_3375;
const __wm_scalar_178_2 = output_3376;
if (__wm_scalar_178_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_178_1, facts_3375) && __wm_eq(__wm_scalar_178_2, output_3376)) {

return reverseInto_2698__wm_d2(output_3376, __wm_basis_Nil);
} else if (__wm_scalar_178_0?.ctor === -6 && __wm_scalar_178_0.args.length === 1 && __wm_is_tuple(__wm_scalar_178_0.args[0]) && __wm_scalar_178_0.args[0].length === 2 && __wm_eq(__wm_scalar_178_1, facts_3375) && __wm_eq(__wm_scalar_178_2, output_3376)) {
const rawParam_3377 = __wm_scalar_178_0.args[0][0];
const rest_3378 = __wm_scalar_178_0.args[0][1];
{
const param_3379 = rawParam_3377;
const irParam_3380 = { bindingId: param_3379.bindingId, name: param_3379.name, typeId: param_3379.typeId, representation: irRepresentation_3330__wm_d2(facts_3375, param_3379.typeId) };
{
const __wm_tail_arg_245_0 = rest_3378;
const __wm_tail_arg_245_1 = facts_3375;
const __wm_tail_arg_245_2 = __wm_basis_Cons([irParam_3380, output_3376]);
params_3374 = __wm_tail_arg_245_0;
facts_3375 = __wm_tail_arg_245_1;
output_3376 = __wm_tail_arg_245_2;
continue __wm_tail_175;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reifyIrParams_3373 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return reifyIrParams_3373__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const reifyIrSpecializations_3381__wm_d6 = (specializations_3382, calls_3383, functionRegistry_3384, expressionRegistry_3385, bindingFunctions_3386, state_3387) => {
__wm_tail_176: while (true) {
{
const __wm_scalar_179_0 = specializations_3382;
const __wm_scalar_179_1 = calls_3383;
const __wm_scalar_179_2 = functionRegistry_3384;
const __wm_scalar_179_3 = expressionRegistry_3385;
const __wm_scalar_179_4 = bindingFunctions_3386;
const __wm_scalar_179_5 = state_3387;
if (__wm_scalar_179_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_179_1, calls_3383) && __wm_eq(__wm_scalar_179_2, functionRegistry_3384) && __wm_eq(__wm_scalar_179_3, expressionRegistry_3385) && __wm_eq(__wm_scalar_179_4, bindingFunctions_3386) && __wm_eq(__wm_scalar_179_5, state_3387)) {

return state_3387;
} else if (__wm_scalar_179_0?.ctor === -6 && __wm_scalar_179_0.args.length === 1 && __wm_is_tuple(__wm_scalar_179_0.args[0]) && __wm_scalar_179_0.args[0].length === 2 && __wm_eq(__wm_scalar_179_1, calls_3383) && __wm_eq(__wm_scalar_179_2, functionRegistry_3384) && __wm_eq(__wm_scalar_179_3, expressionRegistry_3385) && __wm_eq(__wm_scalar_179_4, bindingFunctions_3386) && __wm_eq(__wm_scalar_179_5, state_3387)) {
const rawSpecialization_3388 = __wm_scalar_179_0.args[0][0];
const rest_3389 = __wm_scalar_179_0.args[0][1];
{
const specialization_3390 = rawSpecialization_3388;
{
const __wm_tail_value_246 = Map.get([functionRegistry_3384, specialization_3390.functionId]);
if (__wm_tail_value_246?.ctor === -2 && __wm_tail_value_246.args.length === 1) {
const rawFn_3391 = __wm_tail_value_246.args[0];
{
const fn_3392 = rawFn_3391;
const facts_3393 = indexRepresentationFacts_3321__wm_d2(Js.Array.toList(specialization_3390.typeFacts), Map.empty(Map.numberCompare));
const paramBound_3394 = bindParams_2788__wm_d2(Js.Array.toList(fn_3392.params), Map.empty(Map.numberCompare));
const bound_3395 = collectLocalBindings_2794__wm_d4(__wm_basis_Cons([fn_3392.bodyExprId, __wm_basis_Nil]), expressionRegistry_3385, Map.empty(Map.numberCompare), paramBound_3394);
const __wm_bind_109 = reifyIrExpression_3342__wm_d8(fn_3392.bodyExprId, specialization_3390.id, facts_3393, bound_3395, calls_3383, expressionRegistry_3385, bindingFunctions_3386, state_3387);
if (!(__wm_is_tuple(__wm_bind_109) && __wm_bind_109.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withBody_3396 = __wm_bind_109[0];
const bodyExprId_3397 = __wm_bind_109[1];
const irFunction_3398 = { specializationId: specialization_3390.id, functionId: fn_3392.id, bindingId: fn_3392.bindingId, name: specialization_3390.name, params: Js.Array.fromList(reifyIrParams_3373__wm_d3(Js.Array.toList(fn_3392.params), facts_3393, __wm_basis_Nil)), resultTypeId: fn_3392.resultTypeId, resultRepresentation: specialization_3390.resultRepresentation, bodyExprId: bodyExprId_3397, spanId: fn_3392.spanId };
const completed_3399 = { nextExpressionId: withBody_3396.nextExpressionId, functions: Map.set([withBody_3396.functions, specialization_3390.id, irFunction_3398]), expressions: withBody_3396.expressions };
{
const __wm_tail_arg_247_0 = rest_3389;
const __wm_tail_arg_247_1 = calls_3383;
const __wm_tail_arg_247_2 = functionRegistry_3384;
const __wm_tail_arg_247_3 = expressionRegistry_3385;
const __wm_tail_arg_247_4 = bindingFunctions_3386;
const __wm_tail_arg_247_5 = completed_3399;
specializations_3382 = __wm_tail_arg_247_0;
calls_3383 = __wm_tail_arg_247_1;
functionRegistry_3384 = __wm_tail_arg_247_2;
expressionRegistry_3385 = __wm_tail_arg_247_3;
bindingFunctions_3386 = __wm_tail_arg_247_4;
state_3387 = __wm_tail_arg_247_5;
continue __wm_tail_176;
}
}
} else if (__wm_tail_value_246 === __wm_basis_None) {

{
const __wm_tail_arg_248_0 = rest_3389;
const __wm_tail_arg_248_1 = calls_3383;
const __wm_tail_arg_248_2 = functionRegistry_3384;
const __wm_tail_arg_248_3 = expressionRegistry_3385;
const __wm_tail_arg_248_4 = bindingFunctions_3386;
const __wm_tail_arg_248_5 = state_3387;
specializations_3382 = __wm_tail_arg_248_0;
calls_3383 = __wm_tail_arg_248_1;
functionRegistry_3384 = __wm_tail_arg_248_2;
expressionRegistry_3385 = __wm_tail_arg_248_3;
bindingFunctions_3386 = __wm_tail_arg_248_4;
state_3387 = __wm_tail_arg_248_5;
continue __wm_tail_176;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reifyIrSpecializations_3381 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return reifyIrSpecializations_3381__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const irFunctionValues_3400__wm_d2 = (entries_3401, values_3402) => {
__wm_tail_177: while (true) {
{
const __wm_scalar_180_0 = entries_3401;
const __wm_scalar_180_1 = values_3402;
if (__wm_scalar_180_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_180_1, values_3402)) {

return reverseInto_2698__wm_d2(values_3402, __wm_basis_Nil);
} else if (__wm_scalar_180_0?.ctor === -6 && __wm_scalar_180_0.args.length === 1 && __wm_is_tuple(__wm_scalar_180_0.args[0]) && __wm_scalar_180_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_180_0.args[0][0]) && __wm_scalar_180_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_180_1, values_3402)) {
const _id_3403 = __wm_scalar_180_0.args[0][0][0];
const fn_3404 = __wm_scalar_180_0.args[0][0][1];
const rest_3405 = __wm_scalar_180_0.args[0][1];
{
const __wm_tail_arg_249_0 = rest_3405;
const __wm_tail_arg_249_1 = __wm_basis_Cons([fn_3404, values_3402]);
entries_3401 = __wm_tail_arg_249_0;
values_3402 = __wm_tail_arg_249_1;
continue __wm_tail_177;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const irFunctionValues_3400 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return irFunctionValues_3400__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const irExpressionValues_3406__wm_d2 = (entries_3407, values_3408) => {
__wm_tail_178: while (true) {
{
const __wm_scalar_181_0 = entries_3407;
const __wm_scalar_181_1 = values_3408;
if (__wm_scalar_181_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_181_1, values_3408)) {

return reverseInto_2698__wm_d2(values_3408, __wm_basis_Nil);
} else if (__wm_scalar_181_0?.ctor === -6 && __wm_scalar_181_0.args.length === 1 && __wm_is_tuple(__wm_scalar_181_0.args[0]) && __wm_scalar_181_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_181_0.args[0][0]) && __wm_scalar_181_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_181_1, values_3408)) {
const _id_3409 = __wm_scalar_181_0.args[0][0][0];
const expression_3410 = __wm_scalar_181_0.args[0][0][1];
const rest_3411 = __wm_scalar_181_0.args[0][1];
{
const __wm_tail_arg_250_0 = rest_3411;
const __wm_tail_arg_250_1 = __wm_basis_Cons([expression_3410, values_3408]);
entries_3407 = __wm_tail_arg_250_0;
values_3408 = __wm_tail_arg_250_1;
continue __wm_tail_178;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const irExpressionValues_3406 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return irExpressionValues_3406__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeConsensusRepresentation_3414__wm_d2 = (previous_3412, next_3413) => {
if (__wm_eq(previous_3412, "")) {
return next_3413;
} else {
if (__wm_eq(previous_3412, next_3413)) {
return previous_3412;
} else {
return "conflict";
}
}
};
const mergeConsensusRepresentation_3414 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return mergeConsensusRepresentation_3414__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const addConsensusFacts_3415__wm_d2 = (facts_3416, consensus_3417) => {
__wm_tail_179: while (true) {
{
const __wm_scalar_182_0 = facts_3416;
const __wm_scalar_182_1 = consensus_3417;
if (__wm_scalar_182_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_182_1, consensus_3417)) {

return consensus_3417;
} else if (__wm_scalar_182_0?.ctor === -6 && __wm_scalar_182_0.args.length === 1 && __wm_is_tuple(__wm_scalar_182_0.args[0]) && __wm_scalar_182_0.args[0].length === 2 && __wm_eq(__wm_scalar_182_1, consensus_3417)) {
const fact_3418 = __wm_scalar_182_0.args[0][0];
const rest_3419 = __wm_scalar_182_0.args[0][1];
{
const exact_3420 = fact_3418;
const previous_3421 = representationOf_2919__wm_d2(consensus_3417, exact_3420.typeId);
{
const __wm_tail_arg_251_0 = rest_3419;
const __wm_tail_arg_251_1 = Map.set([consensus_3417, exact_3420.typeId, mergeConsensusRepresentation_3414__wm_d2(previous_3421, exact_3420.representation)]);
facts_3416 = __wm_tail_arg_251_0;
consensus_3417 = __wm_tail_arg_251_1;
continue __wm_tail_179;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addConsensusFacts_3415 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addConsensusFacts_3415__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const specializationConsensus_3422__wm_d2 = (specializations_3423, consensus_3424) => {
__wm_tail_180: while (true) {
{
const __wm_scalar_183_0 = specializations_3423;
const __wm_scalar_183_1 = consensus_3424;
if (__wm_scalar_183_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_183_1, consensus_3424)) {

return consensus_3424;
} else if (__wm_scalar_183_0?.ctor === -6 && __wm_scalar_183_0.args.length === 1 && __wm_is_tuple(__wm_scalar_183_0.args[0]) && __wm_scalar_183_0.args[0].length === 2 && __wm_eq(__wm_scalar_183_1, consensus_3424)) {
const specialization_3425 = __wm_scalar_183_0.args[0][0];
const rest_3426 = __wm_scalar_183_0.args[0][1];
{
const exact_3427 = specialization_3425;
{
const __wm_tail_arg_252_0 = rest_3426;
const __wm_tail_arg_252_1 = addConsensusFacts_3415__wm_d2(Js.Array.toList(exact_3427.typeFacts), consensus_3424);
specializations_3423 = __wm_tail_arg_252_0;
consensus_3424 = __wm_tail_arg_252_1;
continue __wm_tail_180;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const specializationConsensus_3422 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return specializationConsensus_3422__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const refinedType_3433__wm_d2 = (consensus_3428, gpuType_3429) => {
const inferred_3430 = representationOf_2919__wm_d2(consensus_3428, gpuType_3429.id);
const representation_3431 = (__wm_eq(gpuType_3429.representation, "abstract") ? (__wm_op_or_d2(__wm_eq(inferred_3430, "i32"), __wm_eq(inferred_3430, "f32")) ? inferred_3430 : "abstract") : gpuType_3429.representation);
const output_3432 = { id: gpuType_3429.id, kind: gpuType_3429.kind, name: gpuType_3429.name, representation: representation_3431, width: gpuType_3429.width, items: gpuType_3429.items, params: gpuType_3429.params, result: gpuType_3429.result };
return output_3432;
};
const refinedType_3433 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return refinedType_3433__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const compileGpu_3457 = (__arg) => {
if (true) {
const input_3434 = __arg;
if (!__wm_eq(input_3434.schemaVersion, 1)) {
return incompatibleSchema_2692(input_3434.schemaVersion);
} else {
const functionItems_3435 = Js.Array.toList(input_3434.functions);
const bindingItems_3436 = Js.Array.toList(input_3434.bindings);
const expressionItems_3437 = Js.Array.toList(input_3434.expressions);
const typeItems_3438 = Js.Array.toList(input_3434.types);
const __wm_bind_110 = registerFunctions_2728__wm_d3(functionItems_3435, Map.empty(Map.numberCompare), __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_110) && __wm_bind_110.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const functionRegistry_3439 = __wm_bind_110[0];
const duplicateDiagnostics_3440 = __wm_bind_110[1];
const expressionRegistry_3441 = indexExpressions_2904__wm_d2(expressionItems_3437, Map.empty(Map.numberCompare));
const bindingFunctions_3442 = indexFunctionBindings_2735__wm_d2(functionItems_3435, Map.empty(Map.numberCompare));
const bindingRegistry_3443 = indexBindings_2782__wm_d2(bindingItems_3436, Map.empty(Map.numberCompare));
const typeRegistry_3444 = indexTypes_2910__wm_d2(typeItems_3438, Map.empty(Map.numberCompare));
const reachable_3445 = solveReachableFunctions_2771__wm_d5(rootFunctionIds_2766__wm_d2(Js.Array.toList(input_3434.roots), __wm_basis_Nil), functionRegistry_3439, expressionRegistry_3441, bindingFunctions_3442, Map.empty(Map.numberCompare));
const captureItems_3446 = reverseInto_2698__wm_d2(rootCaptures_2882__wm_d7(Js.Array.toList(input_3434.roots), functionRegistry_3439, expressionRegistry_3441, bindingFunctions_3442, bindingRegistry_3443, typeRegistry_3444, __wm_basis_Nil), __wm_basis_Nil);
const specializationState_3447 = materializeRootSpecializations_3303__wm_d7(Js.Array.toList(input_3434.roots), initialSpecializationState_3239(undefined), functionRegistry_3439, expressionRegistry_3441, bindingFunctions_3442, typeRegistry_3444, typeItems_3438);
const irState_3448 = reifyIrSpecializations_3381__wm_d6(specializationState_3447.specializations, specializationState_3447.calls, functionRegistry_3439, expressionRegistry_3441, bindingFunctions_3442, initialIrBuildState_3320(undefined));
const diagnostics_3449 = prependAll_2693__wm_d2(reverseInto_2698__wm_d2(specializationState_3447.diagnostics, __wm_basis_Nil), prependAll_2693__wm_d2(captureDiagnostics_2898__wm_d2(captureItems_3446, __wm_basis_Nil), prependAll_2693__wm_d2(reachableCapabilityDiagnostics_2714__wm_d4(reachableBodyIds_2707__wm_d3(functionItems_3435, reachable_3445, __wm_basis_Nil), expressionRegistry_3441, Map.empty(Map.numberCompare), __wm_basis_Nil), duplicateDiagnostics_3440)));
const consensus_3450 = specializationConsensus_3422__wm_d2(specializationState_3447.specializations, Map.empty(Map.numberCompare));
const types_3452 = Js.Array.fromList(List.map([typeItems_3438, (__arg) => {
if (true) {
const gpuType_3451 = __arg;
return refinedType_3433__wm_d2(consensus_3450, gpuType_3451);
}
__wm_fail("Match", "pattern match failure in function");
}]));
const expressions_3453 = Js.Array.fromList(List.map([Js.Array.toList(input_3434.expressions), typedExpression_2681]));
const functions_3455 = Js.Array.fromList(List.map([Js.Array.toList(input_3434.functions), (__arg) => {
if (true) {
const fn_3454 = __arg;
return typedFunction_2686__wm_d2(reachable_3445, fn_3454);
}
__wm_fail("Match", "pattern match failure in function");
}]));
const output_3456 = { schemaVersion: 1, functions: functions_3455, captures: Js.Array.fromList(captureItems_3446), specializations: Js.Array.fromList(reverseInto_2698__wm_d2(specializationState_3447.specializations, __wm_basis_Nil)), rootSpecializations: Js.Array.fromList(reverseInto_2698__wm_d2(specializationState_3447.rootSpecializations, __wm_basis_Nil)), calls: Js.Array.fromList(reverseInto_2698__wm_d2(specializationState_3447.calls, __wm_basis_Nil)), irFunctions: Js.Array.fromList(irFunctionValues_3400__wm_d2(Map.toList(irState_3448.functions), __wm_basis_Nil)), irExpressions: Js.Array.fromList(irExpressionValues_3406__wm_d2(Map.toList(irState_3448.expressions), __wm_basis_Nil)), types: types_3452, expressions: expressions_3453, diagnostics: Js.Array.fromList(diagnostics_3449) };
return output_3456;
}
}
__wm_fail("Match", "pattern match failure in function");
};
const compileGpuSlice_3460 = (__arg) => {
if (true) {
const input_3458 = __arg;
const output_3459 = compileSliceProgram_2675(input_3458);
return output_3459;
}
__wm_fail("Match", "pattern match failure in function");
};
const elaborateGpuSliceTypes_3463 = (__arg) => {
if (true) {
const input_3461 = __arg;
const output_3462 = elaborateSliceProgramTypes_2322(input_3461);
return output_3462;
}
__wm_fail("Match", "pattern match failure in function");
};
return { "SpecializationRegistryEntry": SpecializationRegistryEntry_2676, "SpecializationBuildState": SpecializationBuildState_2677, "IrBuildState": IrBuildState_2678, "typedExpression": typedExpression_2681, "typedFunction": typedFunction_2686, "typedFunction__wm_d2": typedFunction_2686__wm_d2, "emptyOutput": emptyOutput_2688, "incompatibleSchema": incompatibleSchema_2692, "prependAll": prependAll_2693, "prependAll__wm_d2": prependAll_2693__wm_d2, "reverseInto": reverseInto_2698, "reverseInto__wm_d2": reverseInto_2698__wm_d2, "capabilityDiagnostic": capabilityDiagnostic_2706, "reachableBodyIds": reachableBodyIds_2707, "reachableBodyIds__wm_d3": reachableBodyIds_2707__wm_d3, "reachableCapabilityDiagnostics": reachableCapabilityDiagnostics_2714, "reachableCapabilityDiagnostics__wm_d4": reachableCapabilityDiagnostics_2714__wm_d4, "duplicateFunctionDiagnostic": duplicateFunctionDiagnostic_2727, "registerFunctions": registerFunctions_2728, "registerFunctions__wm_d3": registerFunctions_2728__wm_d3, "indexFunctionBindings": indexFunctionBindings_2735, "indexFunctionBindings__wm_d2": indexFunctionBindings_2735__wm_d2, "callDependency": callDependency_2747, "callDependency__wm_d3": callDependency_2747__wm_d3, "collectFunctionDependencies": collectFunctionDependencies_2748, "collectFunctionDependencies__wm_d5": collectFunctionDependencies_2748__wm_d5, "enqueueDependencies": enqueueDependencies_2760, "enqueueDependencies__wm_d2": enqueueDependencies_2760__wm_d2, "rootFunctionIds": rootFunctionIds_2766, "rootFunctionIds__wm_d2": rootFunctionIds_2766__wm_d2, "solveReachableFunctions": solveReachableFunctions_2771, "solveReachableFunctions__wm_d5": solveReachableFunctions_2771__wm_d5, "indexBindings": indexBindings_2782, "indexBindings__wm_d2": indexBindings_2782__wm_d2, "bindParams": bindParams_2788, "bindParams__wm_d2": bindParams_2788__wm_d2, "collectLocalBindings": collectLocalBindings_2794, "collectLocalBindings__wm_d4": collectLocalBindings_2794__wm_d4, "constantExpression": constantExpression_2805, "constantExpression__wm_d5": constantExpression_2805__wm_d5, "constantExpressions": constantExpressions_2806, "constantExpressions__wm_d5": constantExpressions_2806__wm_d5, "reifiableCaptureType": reifiableCaptureType_2826, "reifiableCaptureType__wm_d2": reifiableCaptureType_2826__wm_d2, "captureCategory": captureCategory_2837, "captureCategory__wm_d7": captureCategory_2837__wm_d7, "collectFunctionCaptures": collectFunctionCaptures_2838, "collectFunctionCaptures__wm_d10": collectFunctionCaptures_2838__wm_d10, "collectReachableCaptures": collectReachableCaptures_2859, "collectReachableCaptures__wm_d9": collectReachableCaptures_2859__wm_d9, "captureValues": captureValues_2876, "captureValues__wm_d2": captureValues_2876__wm_d2, "rootCaptures": rootCaptures_2882, "rootCaptures__wm_d7": rootCaptures_2882__wm_d7, "illegalCaptureDiagnostic": illegalCaptureDiagnostic_2897, "captureDiagnostics": captureDiagnostics_2898, "captureDiagnostics__wm_d2": captureDiagnostics_2898__wm_d2, "indexExpressions": indexExpressions_2904, "indexExpressions__wm_d2": indexExpressions_2904__wm_d2, "indexTypes": indexTypes_2910, "indexTypes__wm_d2": indexTypes_2910__wm_d2, "representationOf": representationOf_2919, "representationOf__wm_d2": representationOf_2919__wm_d2, "joinRepresentation": joinRepresentation_2922, "joinRepresentation__wm_d2": joinRepresentation_2922__wm_d2, "combinedRepresentation": combinedRepresentation_2923, "combinedRepresentation__wm_d3": combinedRepresentation_2923__wm_d3, "setRepresentation": setRepresentation_2934, "setRepresentation__wm_d3": setRepresentation_2934__wm_d3, "setRepresentations": setRepresentations_2935, "setRepresentations__wm_d4": setRepresentations_2935__wm_d4, "seedRepresentations": seedRepresentations_2944, "seedRepresentations__wm_d2": seedRepresentations_2944__wm_d2, "childTypeIds": childTypeIds_2950, "childTypeIds__wm_d3": childTypeIds_2950__wm_d3, "numericTypeIds": numericTypeIds_2958, "numericTypeIds__wm_d3": numericTypeIds_2958__wm_d3, "lastChildTypeId": lastChildTypeId_2966, "lastChildTypeId__wm_d3": lastChildTypeId_2966__wm_d3, "constraintTypeIds": constraintTypeIds_2980, "constraintTypeIds__wm_d3": constraintTypeIds_2980__wm_d3, "applyNumericGroup": applyNumericGroup_2984, "applyNumericGroup__wm_d2": applyNumericGroup_2984__wm_d2, "applyArgumentConstraints": applyArgumentConstraints_2985, "applyArgumentConstraints__wm_d6": applyArgumentConstraints_2985__wm_d6, "applyCallConstraint": applyCallConstraint_3018, "applyCallConstraint__wm_d6": applyCallConstraint_3018__wm_d6, "applyNumericConstraint": applyNumericConstraint_3026, "applyNumericConstraint__wm_d6": applyNumericConstraint_3026__wm_d6, "numericSweep": numericSweep_3027, "numericSweep__wm_d7": numericSweep_3027__wm_d7, "solveNumericRepresentations": solveNumericRepresentations_3040, "solveNumericRepresentations__wm_d6": solveNumericRepresentations_3040__wm_d6, "collectExpressionItems": collectExpressionItems_3049, "collectExpressionItems__wm_d4": collectExpressionItems_3049__wm_d4, "concreteRepresentation": concreteRepresentation_3065, "concreteRepresentation__wm_d3": concreteRepresentation_3065__wm_d3, "setTypeRepresentation": setTypeRepresentation_3071, "setTypeRepresentation__wm_d4": setTypeRepresentation_3071__wm_d4, "seedParamRepresentations": seedParamRepresentations_3072, "seedParamRepresentations__wm_d4": seedParamRepresentations_3072__wm_d4, "functionParamRepresentations": functionParamRepresentations_3084, "functionParamRepresentations__wm_d4": functionParamRepresentations_3084__wm_d4, "callArgumentRepresentations": callArgumentRepresentations_3092, "callArgumentRepresentations__wm_d5": callArgumentRepresentations_3092__wm_d5, "mergeArgumentRepresentations": mergeArgumentRepresentations_3103, "mergeArgumentRepresentations__wm_d6": mergeArgumentRepresentations_3103__wm_d6, "solveFunctionInstance": solveFunctionInstance_3118, "solveFunctionInstance__wm_d9": solveFunctionInstance_3118__wm_d9, "solveInstanceFixedPoint": solveInstanceFixedPoint_3119, "solveInstanceFixedPoint__wm_d9": solveInstanceFixedPoint_3119__wm_d9, "instanceSweep": instanceSweep_3120, "instanceSweep__wm_d10": instanceSweep_3120__wm_d10, "representationsEqual": representationsEqual_3177, "representationsEqual__wm_d2": representationsEqual_3177__wm_d2, "findSpecialization": findSpecialization_3185, "findSpecialization__wm_d3": findSpecialization_3185__wm_d3, "representationSuffix": representationSuffix_3193, "representationSuffix__wm_d2": representationSuffix_3193__wm_d2, "specializationName": specializationName_3202, "specializationName__wm_d3": specializationName_3202__wm_d3, "addTypeIds": addTypeIds_3203, "addTypeIds__wm_d2": addTypeIds_3203__wm_d2, "collectInstanceTypeIds": collectInstanceTypeIds_3208, "collectInstanceTypeIds__wm_d3": collectInstanceTypeIds_3208__wm_d3, "addParamTypeIds": addParamTypeIds_3215, "addParamTypeIds__wm_d3": addParamTypeIds_3215__wm_d3, "representationFacts": representationFacts_3222, "representationFacts__wm_d4": representationFacts_3222__wm_d4, "specializationTypeFacts": specializationTypeFacts_3238, "specializationTypeFacts__wm_d4": specializationTypeFacts_3238__wm_d4, "initialSpecializationState": initialSpecializationState_3239, "withSpecializedCall": withSpecializedCall_3242, "withSpecializedCall__wm_d2": withSpecializedCall_3242__wm_d2, "withSpecializationDiagnostic": withSpecializationDiagnostic_3245, "withSpecializationDiagnostic__wm_d2": withSpecializationDiagnostic_3245__wm_d2, "mutualRecursionDiagnostic": mutualRecursionDiagnostic_3248, "materializeSpecialization": materializeSpecialization_3249, "materializeSpecialization__wm_d10": materializeSpecialization_3249__wm_d10, "materializeSpecializedCalls": materializeSpecializedCalls_3250, "materializeSpecializedCalls__wm_d11": materializeSpecializedCalls_3250__wm_d11, "materializeRootSpecializations": materializeRootSpecializations_3303, "materializeRootSpecializations__wm_d7": materializeRootSpecializations_3303__wm_d7, "initialIrBuildState": initialIrBuildState_3320, "indexRepresentationFacts": indexRepresentationFacts_3321, "indexRepresentationFacts__wm_d2": indexRepresentationFacts_3321__wm_d2, "irRepresentation": irRepresentation_3330, "irRepresentation__wm_d2": irRepresentation_3330__wm_d2, "specializedCallTarget": specializedCallTarget_3331, "specializedCallTarget__wm_d3": specializedCallTarget_3331__wm_d3, "irValueKind": irValueKind_3341, "irValueKind__wm_d3": irValueKind_3341__wm_d3, "reifyIrExpression": reifyIrExpression_3342, "reifyIrExpression__wm_d8": reifyIrExpression_3342__wm_d8, "reifyIrChildren": reifyIrChildren_3343, "reifyIrChildren__wm_d9": reifyIrChildren_3343__wm_d9, "reifyIrParams": reifyIrParams_3373, "reifyIrParams__wm_d3": reifyIrParams_3373__wm_d3, "reifyIrSpecializations": reifyIrSpecializations_3381, "reifyIrSpecializations__wm_d6": reifyIrSpecializations_3381__wm_d6, "irFunctionValues": irFunctionValues_3400, "irFunctionValues__wm_d2": irFunctionValues_3400__wm_d2, "irExpressionValues": irExpressionValues_3406, "irExpressionValues__wm_d2": irExpressionValues_3406__wm_d2, "mergeConsensusRepresentation": mergeConsensusRepresentation_3414, "mergeConsensusRepresentation__wm_d2": mergeConsensusRepresentation_3414__wm_d2, "addConsensusFacts": addConsensusFacts_3415, "addConsensusFacts__wm_d2": addConsensusFacts_3415__wm_d2, "specializationConsensus": specializationConsensus_3422, "specializationConsensus__wm_d2": specializationConsensus_3422__wm_d2, "refinedType": refinedType_3433, "refinedType__wm_d2": refinedType_3433__wm_d2, "compileGpu": compileGpu_3457, "compileGpuSlice": compileGpuSlice_3460, "elaborateGpuSliceTypes": elaborateGpuSliceTypes_3463 };
  },
  (value) => { __wm_module_7 = value; },
);
let __wm_std_Basis;
__wm_define_module(
  "__wm_std_Basis",
  [],
  async () => {
const Empty_ctor_0 = Object.freeze({ ctor: 0, name: "Empty", args: [] });
const Subscript_ctor_1 = Object.freeze({ ctor: 1, name: "Subscript", args: [] });
const Chr_ctor_2 = Object.freeze({ ctor: 2, name: "Chr", args: [] });
const Domain_ctor_3 = Object.freeze({ ctor: 3, name: "Domain", args: [] });
const Option_ctor_4 = Object.freeze({ ctor: 4, name: "Option", args: [] });
const UnequalLengths_ctor_5 = Object.freeze({ ctor: 5, name: "UnequalLengths", args: [] });
const Unordered_ctor_6 = Object.freeze({ ctor: 6, name: "Unordered", args: [] });
const Fail_ctor_7 = (__payload) => ({ ctor: 7, name: "Fail", args: [__payload] });
return { "Empty": Empty_ctor_0, "Subscript": Subscript_ctor_1, "Chr": Chr_ctor_2, "Domain": Domain_ctor_3, "Option": Option_ctor_4, "UnequalLengths": UnequalLengths_ctor_5, "Unordered": Unordered_ctor_6, "Fail": Fail_ctor_7 };
  },
  (value) => { __wm_std_Basis = value; },
);
let __wm_std_General;
__wm_define_module(
  "__wm_std_General",
  [],
  async () => {
const Less_ctor_8 = Object.freeze({ ctor: 8, name: "Less", args: [] });
const Equal_ctor_9 = Object.freeze({ ctor: 9, name: "Equal", args: [] });
const Greater_ctor_10 = Object.freeze({ ctor: 10, name: "Greater", args: [] });
const o_3499__wm_d2 = (f_3496, g_3497) => {
return (__arg) => {
if (true) {
const value_3498 = __arg;
return f_3496(g_3497(value_3498));
}
__wm_fail("Match", "pattern match failure in function");
};
};
const o_3499 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return o_3499__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const before_3501__wm_d2 = (value_3500, __wm_unused_1) => {
return value_3500;
};
const before_3501 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return before_3501__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const ignore_3502 = (__arg) => {
if (true) {

return undefined;
}
__wm_fail("Match", "pattern match failure in function");
};
return { "Less": Less_ctor_8, "Equal": Equal_ctor_9, "Greater": Greater_ctor_10, "o": o_3499, "o__wm_d2": o_3499__wm_d2, "before": before_3501, "before__wm_d2": before_3501__wm_d2, "ignore": ignore_3502 };
  },
  (value) => { __wm_std_General = value; },
);
let __wm_std_List;
__wm_define_module(
  "__wm_std_List",
  ["__wm_std_Basis", "__wm_std_General"],
  async () => {
const Basis_31 = __wm_std_Basis;
const Less_ctor_8 = __wm_std_General["Less"];
const Equal_ctor_9 = __wm_std_General["Equal"];
const Greater_ctor_10 = __wm_std_General["Greater"];
const map_4539__wm_d2 = (items_4540, f_4541) => {
const __wm_scalar_184_0 = items_4540;
const __wm_scalar_184_1 = f_4541;
if (__wm_scalar_184_0 === __wm_basis_Nil) {

return __wm_basis_Nil;
} else if (__wm_scalar_184_0?.ctor === -6 && __wm_scalar_184_0.args.length === 1 && __wm_is_tuple(__wm_scalar_184_0.args[0]) && __wm_scalar_184_0.args[0].length === 2 && __wm_eq(__wm_scalar_184_1, f_4541)) {
const head_4542 = __wm_scalar_184_0.args[0][0];
const rest_4543 = __wm_scalar_184_0.args[0][1];
return __wm_basis_Cons([f_4541(head_4542), map_4539__wm_d2(rest_4543, f_4541)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const map_4539 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return map_4539__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const length_4549 = (__arg) => {
if (true) {
const items_4544 = __arg;
const loop_4545__wm_d2 = (remaining_4546, count_4547) => {
__wm_tail_181: while (true) {
{
const __wm_scalar_185_0 = remaining_4546;
const __wm_scalar_185_1 = count_4547;
if (__wm_scalar_185_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_185_1, count_4547)) {

return count_4547;
} else if (__wm_scalar_185_0?.ctor === -6 && __wm_scalar_185_0.args.length === 1 && __wm_is_tuple(__wm_scalar_185_0.args[0]) && __wm_scalar_185_0.args[0].length === 2 && __wm_eq(__wm_scalar_185_1, count_4547)) {
const rest_4548 = __wm_scalar_185_0.args[0][1];
{
const __wm_tail_arg_253_0 = rest_4548;
const __wm_tail_arg_253_1 = (count_4547 + 1);
remaining_4546 = __wm_tail_arg_253_0;
count_4547 = __wm_tail_arg_253_1;
continue __wm_tail_181;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const loop_4545 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return loop_4545__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return loop_4545__wm_d2(items_4544, 0);
}
__wm_fail("Match", "pattern match failure in function");
};
const append_4550__wm_d2 = (left_4551, right_4552) => {
const __wm_scalar_186_0 = left_4551;
const __wm_scalar_186_1 = right_4552;
if (__wm_scalar_186_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_186_1, right_4552)) {

return right_4552;
} else if (__wm_scalar_186_0?.ctor === -6 && __wm_scalar_186_0.args.length === 1 && __wm_is_tuple(__wm_scalar_186_0.args[0]) && __wm_scalar_186_0.args[0].length === 2 && __wm_eq(__wm_scalar_186_1, right_4552)) {
const head_4553 = __wm_scalar_186_0.args[0][0];
const rest_4554 = __wm_scalar_186_0.args[0][1];
return __wm_basis_Cons([head_4553, append_4550__wm_d2(rest_4554, right_4552)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const append_4550 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return append_4550__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const filter_4555__wm_d2 = (items_4556, predicate_4557) => {
__wm_tail_182: while (true) {
{
const __wm_scalar_187_0 = items_4556;
const __wm_scalar_187_1 = predicate_4557;
if (__wm_scalar_187_0 === __wm_basis_Nil) {

return __wm_basis_Nil;
} else if (__wm_scalar_187_0?.ctor === -6 && __wm_scalar_187_0.args.length === 1 && __wm_is_tuple(__wm_scalar_187_0.args[0]) && __wm_scalar_187_0.args[0].length === 2 && __wm_eq(__wm_scalar_187_1, predicate_4557)) {
const head_4558 = __wm_scalar_187_0.args[0][0];
const rest_4559 = __wm_scalar_187_0.args[0][1];
if (predicate_4557(head_4558)) {
return __wm_basis_Cons([head_4558, filter_4555__wm_d2(rest_4559, predicate_4557)]);
} else {
{
const __wm_tail_arg_254_0 = rest_4559;
const __wm_tail_arg_254_1 = predicate_4557;
items_4556 = __wm_tail_arg_254_0;
predicate_4557 = __wm_tail_arg_254_1;
continue __wm_tail_182;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const filter_4555 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return filter_4555__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const take_4560__wm_d2 = (items_4561, count_4562) => {
const __wm_scalar_188_0 = items_4561;
const __wm_scalar_188_1 = count_4562;
if (__wm_scalar_188_0 === __wm_basis_Nil) {

return __wm_basis_Nil;
} else if (__wm_scalar_188_1 === 0) {

return __wm_basis_Nil;
} else if (__wm_scalar_188_0?.ctor === -6 && __wm_scalar_188_0.args.length === 1 && __wm_is_tuple(__wm_scalar_188_0.args[0]) && __wm_scalar_188_0.args[0].length === 2 && __wm_eq(__wm_scalar_188_1, count_4562)) {
const head_4563 = __wm_scalar_188_0.args[0][0];
const rest_4564 = __wm_scalar_188_0.args[0][1];
return __wm_basis_Cons([head_4563, take_4560__wm_d2(rest_4564, (count_4562 - 1))]);
}
__wm_fail("Match", "non-exhaustive match");
};
const take_4560 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return take_4560__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const drop_4565__wm_d2 = (items_4566, count_4567) => {
__wm_tail_183: while (true) {
{
const __wm_scalar_189_0 = items_4566;
const __wm_scalar_189_1 = count_4567;
if (__wm_eq(__wm_scalar_189_0, items_4566) && __wm_scalar_189_1 === 0) {

return items_4566;
} else if (__wm_scalar_189_0 === __wm_basis_Nil) {

return __wm_basis_Nil;
} else if (__wm_scalar_189_0?.ctor === -6 && __wm_scalar_189_0.args.length === 1 && __wm_is_tuple(__wm_scalar_189_0.args[0]) && __wm_scalar_189_0.args[0].length === 2 && __wm_eq(__wm_scalar_189_1, count_4567)) {
const rest_4568 = __wm_scalar_189_0.args[0][1];
{
const __wm_tail_arg_255_0 = rest_4568;
const __wm_tail_arg_255_1 = (count_4567 - 1);
items_4566 = __wm_tail_arg_255_0;
count_4567 = __wm_tail_arg_255_1;
continue __wm_tail_183;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const drop_4565 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return drop_4565__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const at_4569__wm_d2 = (items_4570, index_4571) => {
__wm_tail_184: while (true) {
{
const __wm_scalar_190_0 = items_4570;
const __wm_scalar_190_1 = index_4571;
if (__wm_scalar_190_0 === __wm_basis_Nil) {

return __wm_basis_None;
} else if (__wm_scalar_190_0?.ctor === -6 && __wm_scalar_190_0.args.length === 1 && __wm_is_tuple(__wm_scalar_190_0.args[0]) && __wm_scalar_190_0.args[0].length === 2 && __wm_scalar_190_1 === 0) {
const head_4572 = __wm_scalar_190_0.args[0][0];
return __wm_basis_Some(head_4572);
} else if (__wm_scalar_190_0?.ctor === -6 && __wm_scalar_190_0.args.length === 1 && __wm_is_tuple(__wm_scalar_190_0.args[0]) && __wm_scalar_190_0.args[0].length === 2 && __wm_eq(__wm_scalar_190_1, index_4571)) {
const rest_4573 = __wm_scalar_190_0.args[0][1];
{
const __wm_tail_arg_256_0 = rest_4573;
const __wm_tail_arg_256_1 = (index_4571 - 1);
items_4570 = __wm_tail_arg_256_0;
index_4571 = __wm_tail_arg_256_1;
continue __wm_tail_184;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const at_4569 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return at_4569__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const foldLeft_4574__wm_d3 = (items_4575, initial_4576, f_4577) => {
__wm_tail_185: while (true) {
{
const __wm_scalar_191_0 = items_4575;
const __wm_scalar_191_1 = initial_4576;
const __wm_scalar_191_2 = f_4577;
if (__wm_scalar_191_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_191_1, initial_4576)) {

return initial_4576;
} else if (__wm_scalar_191_0?.ctor === -6 && __wm_scalar_191_0.args.length === 1 && __wm_is_tuple(__wm_scalar_191_0.args[0]) && __wm_scalar_191_0.args[0].length === 2 && __wm_eq(__wm_scalar_191_1, initial_4576) && __wm_eq(__wm_scalar_191_2, f_4577)) {
const head_4578 = __wm_scalar_191_0.args[0][0];
const rest_4579 = __wm_scalar_191_0.args[0][1];
{
const __wm_tail_arg_257_0 = rest_4579;
const __wm_tail_arg_257_1 = f_4577([initial_4576, head_4578]);
const __wm_tail_arg_257_2 = f_4577;
items_4575 = __wm_tail_arg_257_0;
initial_4576 = __wm_tail_arg_257_1;
f_4577 = __wm_tail_arg_257_2;
continue __wm_tail_185;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const foldLeft_4574 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldLeft_4574__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const foldRight_4580__wm_d3 = (items_4581, initial_4582, f_4583) => {
const __wm_scalar_192_0 = items_4581;
const __wm_scalar_192_1 = initial_4582;
const __wm_scalar_192_2 = f_4583;
if (__wm_scalar_192_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_192_1, initial_4582)) {

return initial_4582;
} else if (__wm_scalar_192_0?.ctor === -6 && __wm_scalar_192_0.args.length === 1 && __wm_is_tuple(__wm_scalar_192_0.args[0]) && __wm_scalar_192_0.args[0].length === 2 && __wm_eq(__wm_scalar_192_1, initial_4582) && __wm_eq(__wm_scalar_192_2, f_4583)) {
const head_4584 = __wm_scalar_192_0.args[0][0];
const rest_4585 = __wm_scalar_192_0.args[0][1];
return f_4583([head_4584, foldRight_4580__wm_d3(rest_4585, initial_4582, f_4583)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const foldRight_4580 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldRight_4580__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const reverse_4589 = (__arg) => {
if (true) {
const items_4586 = __arg;
return foldLeft_4574__wm_d3(items_4586, __wm_basis_Nil, (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) {
const reversed_4587 = __arg[0];
const item_4588 = __arg[1];
return __wm_basis_Cons([item_4588, reversed_4587]);
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
const any_4590__wm_d2 = (items_4591, predicate_4592) => {
__wm_tail_186: while (true) {
{
const __wm_scalar_193_0 = items_4591;
const __wm_scalar_193_1 = predicate_4592;
if (__wm_scalar_193_0 === __wm_basis_Nil) {

return false;
} else if (__wm_scalar_193_0?.ctor === -6 && __wm_scalar_193_0.args.length === 1 && __wm_is_tuple(__wm_scalar_193_0.args[0]) && __wm_scalar_193_0.args[0].length === 2 && __wm_eq(__wm_scalar_193_1, predicate_4592)) {
const head_4593 = __wm_scalar_193_0.args[0][0];
const rest_4594 = __wm_scalar_193_0.args[0][1];
if (predicate_4592(head_4593)) {
return true;
} else {
{
const __wm_tail_arg_258_0 = rest_4594;
const __wm_tail_arg_258_1 = predicate_4592;
items_4591 = __wm_tail_arg_258_0;
predicate_4592 = __wm_tail_arg_258_1;
continue __wm_tail_186;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const any_4590 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return any_4590__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const all_4595__wm_d2 = (items_4596, predicate_4597) => {
__wm_tail_187: while (true) {
{
const __wm_scalar_194_0 = items_4596;
const __wm_scalar_194_1 = predicate_4597;
if (__wm_scalar_194_0 === __wm_basis_Nil) {

return true;
} else if (__wm_scalar_194_0?.ctor === -6 && __wm_scalar_194_0.args.length === 1 && __wm_is_tuple(__wm_scalar_194_0.args[0]) && __wm_scalar_194_0.args[0].length === 2 && __wm_eq(__wm_scalar_194_1, predicate_4597)) {
const head_4598 = __wm_scalar_194_0.args[0][0];
const rest_4599 = __wm_scalar_194_0.args[0][1];
if (predicate_4597(head_4598)) {
{
const __wm_tail_arg_259_0 = rest_4599;
const __wm_tail_arg_259_1 = predicate_4597;
items_4596 = __wm_tail_arg_259_0;
predicate_4597 = __wm_tail_arg_259_1;
continue __wm_tail_187;
}
} else {
return false;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const all_4595 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return all_4595__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collectWith_4603__wm_d3 = (empty_4600, combine_4601, items_4602) => {
return foldRight_4580__wm_d3(items_4602, empty_4600, combine_4601);
};
const collectWith_4603 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return collectWith_4603__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
let joinRaw_4604 = (__arg) => {
if (true) {
const items_4605 = __arg;
const __wm_return_value_51 = items_4605;
if (__wm_return_value_51 === __wm_basis_Nil) {

return "";
} else if (__wm_return_value_51?.ctor === -6 && __wm_return_value_51.args.length === 1 && __wm_is_tuple(__wm_return_value_51.args[0]) && __wm_return_value_51.args[0].length === 2 && __wm_return_value_51.args[0][1] === __wm_basis_Nil) {
const head_4606 = __wm_return_value_51.args[0][0];
return (("" + Text.of(head_4606)) + "");
} else if (__wm_return_value_51?.ctor === -6 && __wm_return_value_51.args.length === 1 && __wm_is_tuple(__wm_return_value_51.args[0]) && __wm_return_value_51.args[0].length === 2) {
const head_4607 = __wm_return_value_51.args[0][0];
const rest_4608 = __wm_return_value_51.args[0][1];
return (((("" + Text.of(head_4607)) + "") + ", ") + joinRaw_4604(rest_4608));
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const toString_4610 = (__arg) => {
if (true) {
const items_4609 = __arg;
return (("[" + joinRaw_4604(items_4609)) + "]");
}
__wm_fail("Match", "pattern match failure in function");
};
const toStringRender_4613__wm_d2 = (items_4611, render_4612) => {
return toString_4610(map_4539__wm_d2(items_4611, render_4612));
};
const toStringRender_4613 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return toStringRender_4613__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const null_4615 = (__arg) => {
if (true) {
const items_4614 = __arg;
const __wm_return_value_52 = items_4614;
if (__wm_return_value_52 === __wm_basis_Nil) {

return true;
} else if (true) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const hd_4618 = (__arg) => {
if (true) {
const items_4616 = __arg;
const __wm_return_value_53 = items_4616;
if (__wm_return_value_53?.ctor === -6 && __wm_return_value_53.args.length === 1 && __wm_is_tuple(__wm_return_value_53.args[0]) && __wm_return_value_53.args[0].length === 2) {
const head_4617 = __wm_return_value_53.args[0][0];
return __wm_basis_Ok(head_4617);
} else if (__wm_return_value_53 === __wm_basis_Nil) {

return __wm_basis_Err(Basis_31.Empty);
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const tl_4621 = (__arg) => {
if (true) {
const items_4619 = __arg;
const __wm_return_value_54 = items_4619;
if (__wm_return_value_54?.ctor === -6 && __wm_return_value_54.args.length === 1 && __wm_is_tuple(__wm_return_value_54.args[0]) && __wm_return_value_54.args[0].length === 2) {
const rest_4620 = __wm_return_value_54.args[0][1];
return __wm_basis_Ok(rest_4620);
} else if (__wm_return_value_54 === __wm_basis_Nil) {

return __wm_basis_Err(Basis_31.Empty);
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
let last_4622 = (__arg) => {
__wm_tail_188: while (true) {
if (true) {
const items_4623 = __arg;
{
const __wm_tail_value_260 = items_4623;
if (__wm_tail_value_260 === __wm_basis_Nil) {

return __wm_basis_Err(Basis_31.Empty);
} else if (__wm_tail_value_260?.ctor === -6 && __wm_tail_value_260.args.length === 1 && __wm_is_tuple(__wm_tail_value_260.args[0]) && __wm_tail_value_260.args[0].length === 2 && __wm_tail_value_260.args[0][1] === __wm_basis_Nil) {
const item_4624 = __wm_tail_value_260.args[0][0];
return __wm_basis_Ok(item_4624);
} else if (__wm_tail_value_260?.ctor === -6 && __wm_tail_value_260.args.length === 1 && __wm_is_tuple(__wm_tail_value_260.args[0]) && __wm_tail_value_260.args[0].length === 2) {
const rest_4625 = __wm_tail_value_260.args[0][1];
__arg = rest_4625;
continue __wm_tail_188;
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "pattern match failure in function");
}
};
const getItem_4629 = (__arg) => {
if (true) {
const items_4626 = __arg;
const __wm_return_value_55 = items_4626;
if (__wm_return_value_55?.ctor === -6 && __wm_return_value_55.args.length === 1 && __wm_is_tuple(__wm_return_value_55.args[0]) && __wm_return_value_55.args[0].length === 2) {
const head_4627 = __wm_return_value_55.args[0][0];
const rest_4628 = __wm_return_value_55.args[0][1];
return __wm_basis_Some([head_4627, rest_4628]);
} else if (__wm_return_value_55 === __wm_basis_Nil) {

return __wm_basis_None;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const revAppend_4630__wm_d2 = (left_4631, right_4632) => {
__wm_tail_189: while (true) {
{
const __wm_scalar_195_0 = left_4631;
const __wm_scalar_195_1 = right_4632;
if (__wm_scalar_195_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_195_1, right_4632)) {

return right_4632;
} else if (__wm_scalar_195_0?.ctor === -6 && __wm_scalar_195_0.args.length === 1 && __wm_is_tuple(__wm_scalar_195_0.args[0]) && __wm_scalar_195_0.args[0].length === 2 && __wm_eq(__wm_scalar_195_1, right_4632)) {
const head_4633 = __wm_scalar_195_0.args[0][0];
const rest_4634 = __wm_scalar_195_0.args[0][1];
{
const __wm_tail_arg_261_0 = rest_4634;
const __wm_tail_arg_261_1 = __wm_basis_Cons([head_4633, right_4632]);
left_4631 = __wm_tail_arg_261_0;
right_4632 = __wm_tail_arg_261_1;
continue __wm_tail_189;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const revAppend_4630 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return revAppend_4630__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const concat_4638 = (__arg) => {
if (true) {
const lists_4635 = __arg;
return foldRight_4580__wm_d3(lists_4635, __wm_basis_Nil, (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) {
const items_4636 = __arg[0];
const joined_4637 = __arg[1];
return append_4550__wm_d2(items_4636, joined_4637);
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
const app_4639__wm_d2 = (items_4640, f_4641) => {
__wm_tail_190: while (true) {
{
const __wm_scalar_196_0 = items_4640;
const __wm_scalar_196_1 = f_4641;
if (__wm_scalar_196_0 === __wm_basis_Nil) {

return undefined;
} else if (__wm_scalar_196_0?.ctor === -6 && __wm_scalar_196_0.args.length === 1 && __wm_is_tuple(__wm_scalar_196_0.args[0]) && __wm_scalar_196_0.args[0].length === 2 && __wm_eq(__wm_scalar_196_1, f_4641)) {
const head_4642 = __wm_scalar_196_0.args[0][0];
const rest_4643 = __wm_scalar_196_0.args[0][1];
{
f_4641(head_4642);
{
const __wm_tail_arg_262_0 = rest_4643;
const __wm_tail_arg_262_1 = f_4641;
items_4640 = __wm_tail_arg_262_0;
f_4641 = __wm_tail_arg_262_1;
continue __wm_tail_190;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const app_4639 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return app_4639__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const mapPartial_4652__wm_d2 = (items_4644, f_4645) => {
const loop_4646__wm_d2 = (remaining_4647, kept_4648) => {
__wm_tail_191: while (true) {
{
const __wm_scalar_197_0 = remaining_4647;
const __wm_scalar_197_1 = kept_4648;
if (__wm_scalar_197_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_197_1, kept_4648)) {

return reverse_4589(kept_4648);
} else if (__wm_scalar_197_0?.ctor === -6 && __wm_scalar_197_0.args.length === 1 && __wm_is_tuple(__wm_scalar_197_0.args[0]) && __wm_scalar_197_0.args[0].length === 2 && __wm_eq(__wm_scalar_197_1, kept_4648)) {
const head_4649 = __wm_scalar_197_0.args[0][0];
const rest_4650 = __wm_scalar_197_0.args[0][1];
{
const __wm_tail_value_263 = f_4645(head_4649);
if (__wm_tail_value_263?.ctor === -2 && __wm_tail_value_263.args.length === 1) {
const value_4651 = __wm_tail_value_263.args[0];
{
const __wm_tail_arg_264_0 = rest_4650;
const __wm_tail_arg_264_1 = __wm_basis_Cons([value_4651, kept_4648]);
remaining_4647 = __wm_tail_arg_264_0;
kept_4648 = __wm_tail_arg_264_1;
continue __wm_tail_191;
}
} else if (__wm_tail_value_263 === __wm_basis_None) {

{
const __wm_tail_arg_265_0 = rest_4650;
const __wm_tail_arg_265_1 = kept_4648;
remaining_4647 = __wm_tail_arg_265_0;
kept_4648 = __wm_tail_arg_265_1;
continue __wm_tail_191;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const loop_4646 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return loop_4646__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return loop_4646__wm_d2(items_4644, __wm_basis_Nil);
};
const mapPartial_4652 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return mapPartial_4652__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const find_4653__wm_d2 = (items_4654, predicate_4655) => {
__wm_tail_192: while (true) {
{
const __wm_scalar_198_0 = items_4654;
const __wm_scalar_198_1 = predicate_4655;
if (__wm_scalar_198_0 === __wm_basis_Nil) {

return __wm_basis_None;
} else if (__wm_scalar_198_0?.ctor === -6 && __wm_scalar_198_0.args.length === 1 && __wm_is_tuple(__wm_scalar_198_0.args[0]) && __wm_scalar_198_0.args[0].length === 2 && __wm_eq(__wm_scalar_198_1, predicate_4655)) {
const head_4656 = __wm_scalar_198_0.args[0][0];
const rest_4657 = __wm_scalar_198_0.args[0][1];
if (predicate_4655(head_4656)) {
return __wm_basis_Some(head_4656);
} else {
{
const __wm_tail_arg_266_0 = rest_4657;
const __wm_tail_arg_266_1 = predicate_4655;
items_4654 = __wm_tail_arg_266_0;
predicate_4655 = __wm_tail_arg_266_1;
continue __wm_tail_192;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const find_4653 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return find_4653__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const partition_4666__wm_d2 = (items_4658, predicate_4659) => {
const loop_4660__wm_d3 = (remaining_4661, accepted_4662, rejected_4663) => {
__wm_tail_193: while (true) {
{
const __wm_scalar_199_0 = remaining_4661;
const __wm_scalar_199_1 = accepted_4662;
const __wm_scalar_199_2 = rejected_4663;
if (__wm_scalar_199_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_199_1, accepted_4662) && __wm_eq(__wm_scalar_199_2, rejected_4663)) {

return [reverse_4589(accepted_4662), reverse_4589(rejected_4663)];
} else if (__wm_scalar_199_0?.ctor === -6 && __wm_scalar_199_0.args.length === 1 && __wm_is_tuple(__wm_scalar_199_0.args[0]) && __wm_scalar_199_0.args[0].length === 2 && __wm_eq(__wm_scalar_199_1, accepted_4662) && __wm_eq(__wm_scalar_199_2, rejected_4663)) {
const head_4664 = __wm_scalar_199_0.args[0][0];
const rest_4665 = __wm_scalar_199_0.args[0][1];
if (predicate_4659(head_4664)) {
{
const __wm_tail_arg_267_0 = rest_4665;
const __wm_tail_arg_267_1 = __wm_basis_Cons([head_4664, accepted_4662]);
const __wm_tail_arg_267_2 = rejected_4663;
remaining_4661 = __wm_tail_arg_267_0;
accepted_4662 = __wm_tail_arg_267_1;
rejected_4663 = __wm_tail_arg_267_2;
continue __wm_tail_193;
}
} else {
{
const __wm_tail_arg_268_0 = rest_4665;
const __wm_tail_arg_268_1 = accepted_4662;
const __wm_tail_arg_268_2 = __wm_basis_Cons([head_4664, rejected_4663]);
remaining_4661 = __wm_tail_arg_268_0;
accepted_4662 = __wm_tail_arg_268_1;
rejected_4663 = __wm_tail_arg_268_2;
continue __wm_tail_193;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const loop_4660 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return loop_4660__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
return loop_4660__wm_d3(items_4658, __wm_basis_Nil, __wm_basis_Nil);
};
const partition_4666 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return partition_4666__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const tabulate_4672__wm_d2 = (count_4667, f_4668) => {
if (__wm_op_or_d2((count_4667 < 0), !__wm_eq((count_4667 % 1), 0))) {
return __wm_fail("Panic", "Size: List.tabulate count must be a non-negative integer");
} else {
const loop_4669__wm_d2 = (index_4670, built_4671) => {
__wm_tail_194: while (true) {
{
const __wm_scalar_200_0 = index_4670;
const __wm_scalar_200_1 = built_4671;
if (__wm_eq(__wm_scalar_200_0, index_4670) && __wm_eq(__wm_scalar_200_1, built_4671)) {

if ((index_4670 < 0)) {
return built_4671;
} else {
{
const __wm_tail_arg_269_0 = (index_4670 - 1);
const __wm_tail_arg_269_1 = __wm_basis_Cons([f_4668(index_4670), built_4671]);
index_4670 = __wm_tail_arg_269_0;
built_4671 = __wm_tail_arg_269_1;
continue __wm_tail_194;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const loop_4669 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return loop_4669__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return loop_4669__wm_d2((count_4667 - 1), __wm_basis_Nil);
}
};
const tabulate_4672 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return tabulate_4672__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collate_4673__wm_d3 = (left_4674, right_4675, compare_4676) => {
__wm_tail_195: while (true) {
{
const __wm_scalar_201_0 = left_4674;
const __wm_scalar_201_1 = right_4675;
const __wm_scalar_201_2 = compare_4676;
if (__wm_scalar_201_0 === __wm_basis_Nil && __wm_scalar_201_1 === __wm_basis_Nil) {

return Equal_ctor_9;
} else if (__wm_scalar_201_0 === __wm_basis_Nil) {

return Less_ctor_8;
} else if (__wm_scalar_201_1 === __wm_basis_Nil) {

return Greater_ctor_10;
} else if (__wm_scalar_201_0?.ctor === -6 && __wm_scalar_201_0.args.length === 1 && __wm_is_tuple(__wm_scalar_201_0.args[0]) && __wm_scalar_201_0.args[0].length === 2 && __wm_scalar_201_1?.ctor === -6 && __wm_scalar_201_1.args.length === 1 && __wm_is_tuple(__wm_scalar_201_1.args[0]) && __wm_scalar_201_1.args[0].length === 2 && __wm_eq(__wm_scalar_201_2, compare_4676)) {
const a_4677 = __wm_scalar_201_0.args[0][0];
const restA_4678 = __wm_scalar_201_0.args[0][1];
const b_4679 = __wm_scalar_201_1.args[0][0];
const restB_4680 = __wm_scalar_201_1.args[0][1];
{
const __wm_tail_value_270 = compare_4676([a_4677, b_4679]);
if (__wm_tail_value_270 === Equal_ctor_9) {

{
const __wm_tail_arg_271_0 = restA_4678;
const __wm_tail_arg_271_1 = restB_4680;
const __wm_tail_arg_271_2 = compare_4676;
left_4674 = __wm_tail_arg_271_0;
right_4675 = __wm_tail_arg_271_1;
compare_4676 = __wm_tail_arg_271_2;
continue __wm_tail_195;
}
} else if (__wm_tail_value_270 === Less_ctor_8) {

return Less_ctor_8;
} else if (__wm_tail_value_270 === Greater_ctor_10) {

return Greater_ctor_10;
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const collate_4673 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return collate_4673__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
return { "map": map_4539, "map__wm_d2": map_4539__wm_d2, "length": length_4549, "append": append_4550, "append__wm_d2": append_4550__wm_d2, "filter": filter_4555, "filter__wm_d2": filter_4555__wm_d2, "take": take_4560, "take__wm_d2": take_4560__wm_d2, "drop": drop_4565, "drop__wm_d2": drop_4565__wm_d2, "at": at_4569, "at__wm_d2": at_4569__wm_d2, "foldLeft": foldLeft_4574, "foldLeft__wm_d3": foldLeft_4574__wm_d3, "foldRight": foldRight_4580, "foldRight__wm_d3": foldRight_4580__wm_d3, "reverse": reverse_4589, "any": any_4590, "any__wm_d2": any_4590__wm_d2, "all": all_4595, "all__wm_d2": all_4595__wm_d2, "collectWith": collectWith_4603, "collectWith__wm_d3": collectWith_4603__wm_d3, "joinRaw": joinRaw_4604, "toString": toString_4610, "toStringRender": toStringRender_4613, "toStringRender__wm_d2": toStringRender_4613__wm_d2, "null": null_4615, "hd": hd_4618, "tl": tl_4621, "last": last_4622, "getItem": getItem_4629, "revAppend": revAppend_4630, "revAppend__wm_d2": revAppend_4630__wm_d2, "concat": concat_4638, "app": app_4639, "app__wm_d2": app_4639__wm_d2, "mapPartial": mapPartial_4652, "mapPartial__wm_d2": mapPartial_4652__wm_d2, "find": find_4653, "find__wm_d2": find_4653__wm_d2, "partition": partition_4666, "partition__wm_d2": partition_4666__wm_d2, "tabulate": tabulate_4672, "tabulate__wm_d2": tabulate_4672__wm_d2, "collate": collate_4673, "collate__wm_d3": collate_4673__wm_d3 };
  },
  (value) => { __wm_std_List = value; },
);
let __wm_std_Map;
__wm_define_module(
  "__wm_std_Map",
  ["__wm_std_General"],
  async () => {
const Less_ctor_8 = __wm_std_General["Less"];
const Equal_ctor_9 = __wm_std_General["Equal"];
const Greater_ctor_10 = __wm_std_General["Greater"];
const MapEmpty_ctor_13 = Object.freeze({ ctor: 13, name: "MapEmpty", args: [] });
const MapNode_ctor_14 = (__payload) => ({ ctor: 14, name: "MapNode", args: [__payload] });
const MapValue_ctor_15 = (__payload) => ({ ctor: 15, name: "MapValue", args: [__payload] });
const numberCompare_4683__wm_d2 = (left_4681, right_4682) => {
if ((left_4681 < right_4682)) {
return Less_ctor_8;
} else {
if ((left_4681 > right_4682)) {
return Greater_ctor_10;
} else {
return Equal_ctor_9;
}
}
};
const numberCompare_4683 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numberCompare_4683__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const height_4690 = (__arg) => {
if (true) {
const tree_4684 = __arg;
const __wm_return_value_56 = tree_4684;
if (__wm_return_value_56 === MapEmpty_ctor_13) {

return 0;
} else if (__wm_return_value_56?.ctor === 14 && __wm_return_value_56.args.length === 1 && __wm_is_tuple(__wm_return_value_56.args[0]) && __wm_return_value_56.args[0].length === 5) {
const nodeHeight_4685 = __wm_return_value_56.args[0][0];
const _key_4686 = __wm_return_value_56.args[0][1];
const _value_4687 = __wm_return_value_56.args[0][2];
const _left_4688 = __wm_return_value_56.args[0][3];
const _right_4689 = __wm_return_value_56.args[0][4];
return nodeHeight_4685;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const max_4693__wm_d2 = (left_4691, right_4692) => {
if ((left_4691 > right_4692)) {
return left_4691;
} else {
return right_4692;
}
};
const max_4693 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return max_4693__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const node_4698__wm_d4 = (key_4694, value_4695, left_4696, right_4697) => {
return MapNode_ctor_14([(1 + max_4693__wm_d2(height_4690(left_4696), height_4690(right_4697))), key_4694, value_4695, left_4696, right_4697]);
};
const node_4698 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return node_4698__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const rotateLeft_4709 = (__arg) => {
if (true) {
const tree_4699 = __arg;
const __wm_return_value_57 = tree_4699;
if (__wm_return_value_57?.ctor === 14 && __wm_return_value_57.args.length === 1 && __wm_is_tuple(__wm_return_value_57.args[0]) && __wm_return_value_57.args[0].length === 5 && __wm_return_value_57.args[0][4]?.ctor === 14 && __wm_return_value_57.args[0][4].args.length === 1 && __wm_is_tuple(__wm_return_value_57.args[0][4].args[0]) && __wm_return_value_57.args[0][4].args[0].length === 5) {
const _height_4700 = __wm_return_value_57.args[0][0];
const key_4701 = __wm_return_value_57.args[0][1];
const value_4702 = __wm_return_value_57.args[0][2];
const left_4703 = __wm_return_value_57.args[0][3];
const _rightHeight_4704 = __wm_return_value_57.args[0][4].args[0][0];
const rightKey_4705 = __wm_return_value_57.args[0][4].args[0][1];
const rightValue_4706 = __wm_return_value_57.args[0][4].args[0][2];
const rightLeft_4707 = __wm_return_value_57.args[0][4].args[0][3];
const rightRight_4708 = __wm_return_value_57.args[0][4].args[0][4];
return node_4698__wm_d4(rightKey_4705, rightValue_4706, node_4698__wm_d4(key_4701, value_4702, left_4703, rightLeft_4707), rightRight_4708);
} else if (true) {

return tree_4699;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const rotateRight_4720 = (__arg) => {
if (true) {
const tree_4710 = __arg;
const __wm_return_value_58 = tree_4710;
if (__wm_return_value_58?.ctor === 14 && __wm_return_value_58.args.length === 1 && __wm_is_tuple(__wm_return_value_58.args[0]) && __wm_return_value_58.args[0].length === 5 && __wm_return_value_58.args[0][3]?.ctor === 14 && __wm_return_value_58.args[0][3].args.length === 1 && __wm_is_tuple(__wm_return_value_58.args[0][3].args[0]) && __wm_return_value_58.args[0][3].args[0].length === 5) {
const _height_4711 = __wm_return_value_58.args[0][0];
const key_4712 = __wm_return_value_58.args[0][1];
const value_4713 = __wm_return_value_58.args[0][2];
const _leftHeight_4714 = __wm_return_value_58.args[0][3].args[0][0];
const leftKey_4715 = __wm_return_value_58.args[0][3].args[0][1];
const leftValue_4716 = __wm_return_value_58.args[0][3].args[0][2];
const leftLeft_4717 = __wm_return_value_58.args[0][3].args[0][3];
const leftRight_4718 = __wm_return_value_58.args[0][3].args[0][4];
const right_4719 = __wm_return_value_58.args[0][4];
return node_4698__wm_d4(leftKey_4715, leftValue_4716, leftLeft_4717, node_4698__wm_d4(key_4712, value_4713, leftRight_4718, right_4719));
} else if (true) {

return tree_4710;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const balance_4738 = (__arg) => {
if (true) {
const tree_4721 = __arg;
const __wm_return_value_59 = tree_4721;
if (__wm_return_value_59 === MapEmpty_ctor_13) {

return MapEmpty_ctor_13;
} else if (__wm_return_value_59?.ctor === 14 && __wm_return_value_59.args.length === 1 && __wm_is_tuple(__wm_return_value_59.args[0]) && __wm_return_value_59.args[0].length === 5) {
const _height_4722 = __wm_return_value_59.args[0][0];
const key_4723 = __wm_return_value_59.args[0][1];
const value_4724 = __wm_return_value_59.args[0][2];
const left_4725 = __wm_return_value_59.args[0][3];
const right_4726 = __wm_return_value_59.args[0][4];
const difference_4727 = (height_4690(left_4725) - height_4690(right_4726));
if ((difference_4727 > 1)) {
const __wm_return_value_60 = left_4725;
if (__wm_return_value_60?.ctor === 14 && __wm_return_value_60.args.length === 1 && __wm_is_tuple(__wm_return_value_60.args[0]) && __wm_return_value_60.args[0].length === 5) {
const _leftHeight_4728 = __wm_return_value_60.args[0][0];
const _leftKey_4729 = __wm_return_value_60.args[0][1];
const _leftValue_4730 = __wm_return_value_60.args[0][2];
const leftLeft_4731 = __wm_return_value_60.args[0][3];
const leftRight_4732 = __wm_return_value_60.args[0][4];
if ((height_4690(leftLeft_4731) < height_4690(leftRight_4732))) {
return rotateRight_4720(node_4698__wm_d4(key_4723, value_4724, rotateLeft_4709(left_4725), right_4726));
} else {
return rotateRight_4720(node_4698__wm_d4(key_4723, value_4724, left_4725, right_4726));
}
} else if (__wm_return_value_60 === MapEmpty_ctor_13) {

return node_4698__wm_d4(key_4723, value_4724, left_4725, right_4726);
}
__wm_fail("Match", "non-exhaustive match");
} else {
if ((difference_4727 < __wm_op_sub(1))) {
const __wm_return_value_61 = right_4726;
if (__wm_return_value_61?.ctor === 14 && __wm_return_value_61.args.length === 1 && __wm_is_tuple(__wm_return_value_61.args[0]) && __wm_return_value_61.args[0].length === 5) {
const _rightHeight_4733 = __wm_return_value_61.args[0][0];
const _rightKey_4734 = __wm_return_value_61.args[0][1];
const _rightValue_4735 = __wm_return_value_61.args[0][2];
const rightLeft_4736 = __wm_return_value_61.args[0][3];
const rightRight_4737 = __wm_return_value_61.args[0][4];
if ((height_4690(rightRight_4737) < height_4690(rightLeft_4736))) {
return rotateLeft_4709(node_4698__wm_d4(key_4723, value_4724, left_4725, rotateRight_4720(right_4726)));
} else {
return rotateLeft_4709(node_4698__wm_d4(key_4723, value_4724, left_4725, right_4726));
}
} else if (__wm_return_value_61 === MapEmpty_ctor_13) {

return node_4698__wm_d4(key_4723, value_4724, left_4725, right_4726);
}
__wm_fail("Match", "non-exhaustive match");
} else {
return node_4698__wm_d4(key_4723, value_4724, left_4725, right_4726);
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const empty_4740 = (__arg) => {
if (true) {
const compare_4739 = __arg;
return MapValue_ctor_15([compare_4739, MapEmpty_ctor_13]);
}
__wm_fail("Match", "pattern match failure in function");
};
const getTree_4741__wm_d3 = (tree_4742, key_4743, compare_4744) => {
__wm_tail_196: while (true) {
{
const __wm_scalar_202_0 = tree_4742;
const __wm_scalar_202_1 = key_4743;
const __wm_scalar_202_2 = compare_4744;
if (__wm_scalar_202_0 === MapEmpty_ctor_13) {

return __wm_basis_None;
} else if (__wm_scalar_202_0?.ctor === 14 && __wm_scalar_202_0.args.length === 1 && __wm_is_tuple(__wm_scalar_202_0.args[0]) && __wm_scalar_202_0.args[0].length === 5 && __wm_eq(__wm_scalar_202_1, key_4743) && __wm_eq(__wm_scalar_202_2, compare_4744)) {
const _height_4745 = __wm_scalar_202_0.args[0][0];
const nodeKey_4746 = __wm_scalar_202_0.args[0][1];
const value_4747 = __wm_scalar_202_0.args[0][2];
const left_4748 = __wm_scalar_202_0.args[0][3];
const right_4749 = __wm_scalar_202_0.args[0][4];
{
const __wm_tail_value_272 = compare_4744([key_4743, nodeKey_4746]);
if (__wm_tail_value_272 === Less_ctor_8) {

{
const __wm_tail_arg_273_0 = left_4748;
const __wm_tail_arg_273_1 = key_4743;
const __wm_tail_arg_273_2 = compare_4744;
tree_4742 = __wm_tail_arg_273_0;
key_4743 = __wm_tail_arg_273_1;
compare_4744 = __wm_tail_arg_273_2;
continue __wm_tail_196;
}
} else if (__wm_tail_value_272 === Equal_ctor_9) {

return __wm_basis_Some(value_4747);
} else if (__wm_tail_value_272 === Greater_ctor_10) {

{
const __wm_tail_arg_274_0 = right_4749;
const __wm_tail_arg_274_1 = key_4743;
const __wm_tail_arg_274_2 = compare_4744;
tree_4742 = __wm_tail_arg_274_0;
key_4743 = __wm_tail_arg_274_1;
compare_4744 = __wm_tail_arg_274_2;
continue __wm_tail_196;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const getTree_4741 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return getTree_4741__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const get_4754__wm_d2 = (map_4750, key_4751) => {
const __wm_scalar_203_0 = map_4750;
const __wm_scalar_203_1 = key_4751;
if (__wm_scalar_203_0?.ctor === 15 && __wm_scalar_203_0.args.length === 1 && __wm_is_tuple(__wm_scalar_203_0.args[0]) && __wm_scalar_203_0.args[0].length === 2 && __wm_eq(__wm_scalar_203_1, key_4751)) {
const compare_4752 = __wm_scalar_203_0.args[0][0];
const tree_4753 = __wm_scalar_203_0.args[0][1];
return getTree_4741__wm_d3(tree_4753, key_4751, compare_4752);
}
__wm_fail("Match", "non-exhaustive match");
};
const get_4754 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return get_4754__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const has_4757__wm_d2 = (map_4755, key_4756) => {
const __wm_return_value_62 = get_4754__wm_d2(map_4755, key_4756);
if (__wm_return_value_62?.ctor === -2 && __wm_return_value_62.args.length === 1) {

return true;
} else if (__wm_return_value_62 === __wm_basis_None) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
};
const has_4757 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return has_4757__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const setTree_4758__wm_d4 = (tree_4759, key_4760, value_4761, compare_4762) => {
const __wm_scalar_204_0 = tree_4759;
const __wm_scalar_204_1 = key_4760;
const __wm_scalar_204_2 = value_4761;
const __wm_scalar_204_3 = compare_4762;
if (__wm_scalar_204_0 === MapEmpty_ctor_13 && __wm_eq(__wm_scalar_204_1, key_4760) && __wm_eq(__wm_scalar_204_2, value_4761)) {

return node_4698__wm_d4(key_4760, value_4761, MapEmpty_ctor_13, MapEmpty_ctor_13);
} else if (__wm_scalar_204_0?.ctor === 14 && __wm_scalar_204_0.args.length === 1 && __wm_is_tuple(__wm_scalar_204_0.args[0]) && __wm_scalar_204_0.args[0].length === 5 && __wm_eq(__wm_scalar_204_1, key_4760) && __wm_eq(__wm_scalar_204_2, value_4761) && __wm_eq(__wm_scalar_204_3, compare_4762)) {
const _height_4763 = __wm_scalar_204_0.args[0][0];
const nodeKey_4764 = __wm_scalar_204_0.args[0][1];
const nodeValue_4765 = __wm_scalar_204_0.args[0][2];
const left_4766 = __wm_scalar_204_0.args[0][3];
const right_4767 = __wm_scalar_204_0.args[0][4];
const __wm_return_value_63 = compare_4762([key_4760, nodeKey_4764]);
if (__wm_return_value_63 === Less_ctor_8) {

return balance_4738(node_4698__wm_d4(nodeKey_4764, nodeValue_4765, setTree_4758__wm_d4(left_4766, key_4760, value_4761, compare_4762), right_4767));
} else if (__wm_return_value_63 === Equal_ctor_9) {

return node_4698__wm_d4(nodeKey_4764, value_4761, left_4766, right_4767);
} else if (__wm_return_value_63 === Greater_ctor_10) {

return balance_4738(node_4698__wm_d4(nodeKey_4764, nodeValue_4765, left_4766, setTree_4758__wm_d4(right_4767, key_4760, value_4761, compare_4762)));
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
};
const setTree_4758 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setTree_4758__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const set_4773__wm_d3 = (map_4768, key_4769, value_4770) => {
const __wm_scalar_205_0 = map_4768;
const __wm_scalar_205_1 = key_4769;
const __wm_scalar_205_2 = value_4770;
if (__wm_scalar_205_0?.ctor === 15 && __wm_scalar_205_0.args.length === 1 && __wm_is_tuple(__wm_scalar_205_0.args[0]) && __wm_scalar_205_0.args[0].length === 2 && __wm_eq(__wm_scalar_205_1, key_4769) && __wm_eq(__wm_scalar_205_2, value_4770)) {
const compare_4771 = __wm_scalar_205_0.args[0][0];
const tree_4772 = __wm_scalar_205_0.args[0][1];
return MapValue_ctor_15([compare_4771, setTree_4758__wm_d4(tree_4772, key_4769, value_4770, compare_4771)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const set_4773 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return set_4773__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const singleton_4777__wm_d3 = (compare_4774, key_4775, value_4776) => {
return set_4773__wm_d3(empty_4740(compare_4774), key_4775, value_4776);
};
const singleton_4777 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return singleton_4777__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
let removeSmallest_4778 = (__arg) => {
if (true) {
const tree_4779 = __arg;
const __wm_return_value_64 = tree_4779;
if (__wm_return_value_64?.ctor === 14 && __wm_return_value_64.args.length === 1 && __wm_is_tuple(__wm_return_value_64.args[0]) && __wm_return_value_64.args[0].length === 5 && __wm_return_value_64.args[0][3] === MapEmpty_ctor_13) {
const _height_4780 = __wm_return_value_64.args[0][0];
const key_4781 = __wm_return_value_64.args[0][1];
const value_4782 = __wm_return_value_64.args[0][2];
const right_4783 = __wm_return_value_64.args[0][4];
return [key_4781, value_4782, right_4783];
} else if (__wm_return_value_64?.ctor === 14 && __wm_return_value_64.args.length === 1 && __wm_is_tuple(__wm_return_value_64.args[0]) && __wm_return_value_64.args[0].length === 5) {
const _height_4784 = __wm_return_value_64.args[0][0];
const key_4785 = __wm_return_value_64.args[0][1];
const value_4786 = __wm_return_value_64.args[0][2];
const left_4787 = __wm_return_value_64.args[0][3];
const right_4788 = __wm_return_value_64.args[0][4];
const __wm_bind_111 = removeSmallest_4778(left_4787);
if (!(__wm_is_tuple(__wm_bind_111) && __wm_bind_111.length === 3)) __wm_fail("Bind", "pattern match failure in let binding");
const smallestKey_4789 = __wm_bind_111[0];
const smallestValue_4790 = __wm_bind_111[1];
const remainingLeft_4791 = __wm_bind_111[2];
return [smallestKey_4789, smallestValue_4790, balance_4738(node_4698__wm_d4(key_4785, value_4786, remainingLeft_4791, right_4788))];
} else if (__wm_return_value_64 === MapEmpty_ctor_13) {

return __wm_fail("Panic", "Map.removeSmallest called with an empty tree");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const removeTree_4792__wm_d3 = (tree_4793, key_4794, compare_4795) => {
const __wm_scalar_206_0 = tree_4793;
const __wm_scalar_206_1 = key_4794;
const __wm_scalar_206_2 = compare_4795;
if (__wm_scalar_206_0 === MapEmpty_ctor_13) {

return MapEmpty_ctor_13;
} else if (__wm_scalar_206_0?.ctor === 14 && __wm_scalar_206_0.args.length === 1 && __wm_is_tuple(__wm_scalar_206_0.args[0]) && __wm_scalar_206_0.args[0].length === 5 && __wm_eq(__wm_scalar_206_1, key_4794) && __wm_eq(__wm_scalar_206_2, compare_4795)) {
const _height_4796 = __wm_scalar_206_0.args[0][0];
const nodeKey_4797 = __wm_scalar_206_0.args[0][1];
const value_4798 = __wm_scalar_206_0.args[0][2];
const left_4799 = __wm_scalar_206_0.args[0][3];
const right_4800 = __wm_scalar_206_0.args[0][4];
const __wm_return_value_65 = compare_4795([key_4794, nodeKey_4797]);
if (__wm_return_value_65 === Less_ctor_8) {

return balance_4738(node_4698__wm_d4(nodeKey_4797, value_4798, removeTree_4792__wm_d3(left_4799, key_4794, compare_4795), right_4800));
} else if (__wm_return_value_65 === Greater_ctor_10) {

return balance_4738(node_4698__wm_d4(nodeKey_4797, value_4798, left_4799, removeTree_4792__wm_d3(right_4800, key_4794, compare_4795)));
} else if (__wm_return_value_65 === Equal_ctor_9) {

const __wm_scalar_207_0 = left_4799;
const __wm_scalar_207_1 = right_4800;
if (__wm_scalar_207_0 === MapEmpty_ctor_13) {

return right_4800;
} else if (__wm_scalar_207_1 === MapEmpty_ctor_13) {

return left_4799;
} else if (__wm_eq(__wm_scalar_207_1, right_4800)) {

const __wm_bind_112 = removeSmallest_4778(right_4800);
if (!(__wm_is_tuple(__wm_bind_112) && __wm_bind_112.length === 3)) __wm_fail("Bind", "pattern match failure in let binding");
const nextKey_4801 = __wm_bind_112[0];
const nextValue_4802 = __wm_bind_112[1];
const remainingRight_4803 = __wm_bind_112[2];
return balance_4738(node_4698__wm_d4(nextKey_4801, nextValue_4802, left_4799, remainingRight_4803));
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
};
const removeTree_4792 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return removeTree_4792__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const remove_4808__wm_d2 = (map_4804, key_4805) => {
const __wm_scalar_208_0 = map_4804;
const __wm_scalar_208_1 = key_4805;
if (__wm_scalar_208_0?.ctor === 15 && __wm_scalar_208_0.args.length === 1 && __wm_is_tuple(__wm_scalar_208_0.args[0]) && __wm_scalar_208_0.args[0].length === 2 && __wm_eq(__wm_scalar_208_1, key_4805)) {
const compare_4806 = __wm_scalar_208_0.args[0][0];
const tree_4807 = __wm_scalar_208_0.args[0][1];
return MapValue_ctor_15([compare_4806, removeTree_4792__wm_d3(tree_4807, key_4805, compare_4806)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const remove_4808 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return remove_4808__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const update_4813__wm_d3 = (map_4809, key_4810, transform_4811) => {
const __wm_return_value_66 = transform_4811(get_4754__wm_d2(map_4809, key_4810));
if (__wm_return_value_66?.ctor === -2 && __wm_return_value_66.args.length === 1) {
const value_4812 = __wm_return_value_66.args[0];
return set_4773__wm_d3(map_4809, key_4810, value_4812);
} else if (__wm_return_value_66 === __wm_basis_None) {

return remove_4808__wm_d2(map_4809, key_4810);
}
__wm_fail("Match", "non-exhaustive match");
};
const update_4813 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return update_4813__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const foldTree_4814__wm_d3 = (tree_4815, initial_4816, combine_4817) => {
__wm_tail_197: while (true) {
{
const __wm_scalar_209_0 = tree_4815;
const __wm_scalar_209_1 = initial_4816;
const __wm_scalar_209_2 = combine_4817;
if (__wm_scalar_209_0 === MapEmpty_ctor_13 && __wm_eq(__wm_scalar_209_1, initial_4816)) {

return initial_4816;
} else if (__wm_scalar_209_0?.ctor === 14 && __wm_scalar_209_0.args.length === 1 && __wm_is_tuple(__wm_scalar_209_0.args[0]) && __wm_scalar_209_0.args[0].length === 5 && __wm_eq(__wm_scalar_209_1, initial_4816) && __wm_eq(__wm_scalar_209_2, combine_4817)) {
const _height_4818 = __wm_scalar_209_0.args[0][0];
const key_4819 = __wm_scalar_209_0.args[0][1];
const value_4820 = __wm_scalar_209_0.args[0][2];
const left_4821 = __wm_scalar_209_0.args[0][3];
const right_4822 = __wm_scalar_209_0.args[0][4];
{
const afterLeft_4823 = foldTree_4814__wm_d3(left_4821, initial_4816, combine_4817);
{
const __wm_tail_arg_275_0 = right_4822;
const __wm_tail_arg_275_1 = combine_4817([afterLeft_4823, key_4819, value_4820]);
const __wm_tail_arg_275_2 = combine_4817;
tree_4815 = __wm_tail_arg_275_0;
initial_4816 = __wm_tail_arg_275_1;
combine_4817 = __wm_tail_arg_275_2;
continue __wm_tail_197;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const foldTree_4814 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldTree_4814__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const fold_4829__wm_d3 = (map_4824, initial_4825, combine_4826) => {
const __wm_scalar_210_0 = map_4824;
const __wm_scalar_210_1 = initial_4825;
const __wm_scalar_210_2 = combine_4826;
if (__wm_scalar_210_0?.ctor === 15 && __wm_scalar_210_0.args.length === 1 && __wm_is_tuple(__wm_scalar_210_0.args[0]) && __wm_scalar_210_0.args[0].length === 2 && __wm_eq(__wm_scalar_210_1, initial_4825) && __wm_eq(__wm_scalar_210_2, combine_4826)) {
const _compare_4827 = __wm_scalar_210_0.args[0][0];
const tree_4828 = __wm_scalar_210_0.args[0][1];
return foldTree_4814__wm_d3(tree_4828, initial_4825, combine_4826);
}
__wm_fail("Match", "non-exhaustive match");
};
const fold_4829 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return fold_4829__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const toListTree_4830__wm_d2 = (tree_4831, tail_4832) => {
__wm_tail_198: while (true) {
{
const __wm_scalar_211_0 = tree_4831;
const __wm_scalar_211_1 = tail_4832;
if (__wm_scalar_211_0 === MapEmpty_ctor_13 && __wm_eq(__wm_scalar_211_1, tail_4832)) {

return tail_4832;
} else if (__wm_scalar_211_0?.ctor === 14 && __wm_scalar_211_0.args.length === 1 && __wm_is_tuple(__wm_scalar_211_0.args[0]) && __wm_scalar_211_0.args[0].length === 5 && __wm_eq(__wm_scalar_211_1, tail_4832)) {
const _height_4833 = __wm_scalar_211_0.args[0][0];
const key_4834 = __wm_scalar_211_0.args[0][1];
const value_4835 = __wm_scalar_211_0.args[0][2];
const left_4836 = __wm_scalar_211_0.args[0][3];
const right_4837 = __wm_scalar_211_0.args[0][4];
{
const __wm_tail_arg_276_0 = left_4836;
const __wm_tail_arg_276_1 = __wm_basis_Cons([[key_4834, value_4835], toListTree_4830__wm_d2(right_4837, tail_4832)]);
tree_4831 = __wm_tail_arg_276_0;
tail_4832 = __wm_tail_arg_276_1;
continue __wm_tail_198;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const toListTree_4830 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return toListTree_4830__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const toList_4841 = (__arg) => {
if (true) {
const map_4838 = __arg;
const __wm_return_value_67 = map_4838;
if (__wm_return_value_67?.ctor === 15 && __wm_return_value_67.args.length === 1 && __wm_is_tuple(__wm_return_value_67.args[0]) && __wm_return_value_67.args[0].length === 2) {
const _compare_4839 = __wm_return_value_67.args[0][0];
const tree_4840 = __wm_return_value_67.args[0][1];
return toListTree_4830__wm_d2(tree_4840, __wm_basis_Nil);
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const debugHeight_4845 = (__arg) => {
if (true) {
const map_4842 = __arg;
const __wm_return_value_68 = map_4842;
if (__wm_return_value_68?.ctor === 15 && __wm_return_value_68.args.length === 1 && __wm_is_tuple(__wm_return_value_68.args[0]) && __wm_return_value_68.args[0].length === 2) {
const _compare_4843 = __wm_return_value_68.args[0][0];
const tree_4844 = __wm_return_value_68.args[0][1];
return height_4690(tree_4844);
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const fromListItems_4846__wm_d2 = (map_4847, items_4848) => {
__wm_tail_199: while (true) {
{
const __wm_scalar_212_0 = map_4847;
const __wm_scalar_212_1 = items_4848;
if (__wm_eq(__wm_scalar_212_0, map_4847) && __wm_scalar_212_1 === __wm_basis_Nil) {

return map_4847;
} else if (__wm_eq(__wm_scalar_212_0, map_4847) && __wm_scalar_212_1?.ctor === -6 && __wm_scalar_212_1.args.length === 1 && __wm_is_tuple(__wm_scalar_212_1.args[0]) && __wm_scalar_212_1.args[0].length === 2 && __wm_is_tuple(__wm_scalar_212_1.args[0][0]) && __wm_scalar_212_1.args[0][0].length === 2) {
const key_4849 = __wm_scalar_212_1.args[0][0][0];
const value_4850 = __wm_scalar_212_1.args[0][0][1];
const rest_4851 = __wm_scalar_212_1.args[0][1];
{
const __wm_tail_arg_277_0 = set_4773__wm_d3(map_4847, key_4849, value_4850);
const __wm_tail_arg_277_1 = rest_4851;
map_4847 = __wm_tail_arg_277_0;
items_4848 = __wm_tail_arg_277_1;
continue __wm_tail_199;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const fromListItems_4846 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return fromListItems_4846__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const fromList_4854__wm_d2 = (compare_4852, items_4853) => {
return fromListItems_4846__wm_d2(empty_4740(compare_4852), items_4853);
};
const fromList_4854 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return fromList_4854__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return { "MapEmpty": MapEmpty_ctor_13, "MapNode": MapNode_ctor_14, "MapValue": MapValue_ctor_15, "numberCompare": numberCompare_4683, "numberCompare__wm_d2": numberCompare_4683__wm_d2, "height": height_4690, "max": max_4693, "max__wm_d2": max_4693__wm_d2, "node": node_4698, "node__wm_d4": node_4698__wm_d4, "rotateLeft": rotateLeft_4709, "rotateRight": rotateRight_4720, "balance": balance_4738, "empty": empty_4740, "getTree": getTree_4741, "getTree__wm_d3": getTree_4741__wm_d3, "get": get_4754, "get__wm_d2": get_4754__wm_d2, "has": has_4757, "has__wm_d2": has_4757__wm_d2, "setTree": setTree_4758, "setTree__wm_d4": setTree_4758__wm_d4, "set": set_4773, "set__wm_d3": set_4773__wm_d3, "singleton": singleton_4777, "singleton__wm_d3": singleton_4777__wm_d3, "removeSmallest": removeSmallest_4778, "removeTree": removeTree_4792, "removeTree__wm_d3": removeTree_4792__wm_d3, "remove": remove_4808, "remove__wm_d2": remove_4808__wm_d2, "update": update_4813, "update__wm_d3": update_4813__wm_d3, "foldTree": foldTree_4814, "foldTree__wm_d3": foldTree_4814__wm_d3, "fold": fold_4829, "fold__wm_d3": fold_4829__wm_d3, "toListTree": toListTree_4830, "toListTree__wm_d2": toListTree_4830__wm_d2, "toList": toList_4841, "debugHeight": debugHeight_4845, "fromListItems": fromListItems_4846, "fromListItems__wm_d2": fromListItems_4846__wm_d2, "fromList": fromList_4854, "fromList__wm_d2": fromList_4854__wm_d2 };
  },
  (value) => { __wm_std_Map = value; },
);
await __wm_request_module("__wm_std_Basis");
await __wm_request_module("__wm_std_General");
await __wm_request_module("__wm_std_List");
await __wm_request_module("__wm_std_Map");
const Basis = __wm_std_Basis;
const General = __wm_std_General;
const List = { "Nil": __wm_basis_List["Nil"], "Cons": __wm_basis_List["Cons"], "map": __wm_std_List["map"], "length": __wm_std_List["length"], "append": __wm_std_List["append"], "filter": __wm_std_List["filter"], "take": __wm_std_List["take"], "drop": __wm_std_List["drop"], "at": __wm_std_List["at"], "foldLeft": __wm_std_List["foldLeft"], "foldRight": __wm_std_List["foldRight"], "reverse": __wm_std_List["reverse"], "any": __wm_std_List["any"], "all": __wm_std_List["all"], "collectWith": __wm_std_List["collectWith"], "joinRaw": __wm_std_List["joinRaw"], "toString": __wm_std_List["toString"], "toStringRender": __wm_std_List["toStringRender"], "null": __wm_std_List["null"], "hd": __wm_std_List["hd"], "tl": __wm_std_List["tl"], "last": __wm_std_List["last"], "getItem": __wm_std_List["getItem"], "revAppend": __wm_std_List["revAppend"], "concat": __wm_std_List["concat"], "app": __wm_std_List["app"], "mapPartial": __wm_std_List["mapPartial"], "find": __wm_std_List["find"], "partition": __wm_std_List["partition"], "tabulate": __wm_std_List["tabulate"], "collate": __wm_std_List["collate"] };
const Map = __wm_std_Map;
await __wm_request_module("__wm_module_7");
const __wm_library_export_0 = __wm_module_7["SpecializationRegistryEntry"];
const __wm_library_export_1 = __wm_module_7["SpecializationBuildState"];
const __wm_library_export_2 = __wm_module_7["IrBuildState"];
const __wm_library_export_3 = __wm_module_7["typedExpression"];
const __wm_library_export_4 = __wm_module_7["typedFunction"];
const __wm_library_export_5 = __wm_module_7["emptyOutput"];
const __wm_library_export_6 = __wm_module_7["incompatibleSchema"];
const __wm_library_export_7 = __wm_module_7["prependAll"];
const __wm_library_export_8 = __wm_module_7["reverseInto"];
const __wm_library_export_9 = __wm_module_7["capabilityDiagnostic"];
const __wm_library_export_10 = __wm_module_7["reachableBodyIds"];
const __wm_library_export_11 = __wm_module_7["reachableCapabilityDiagnostics"];
const __wm_library_export_12 = __wm_module_7["duplicateFunctionDiagnostic"];
const __wm_library_export_13 = __wm_module_7["registerFunctions"];
const __wm_library_export_14 = __wm_module_7["indexFunctionBindings"];
const __wm_library_export_15 = __wm_module_7["callDependency"];
const __wm_library_export_16 = __wm_module_7["collectFunctionDependencies"];
const __wm_library_export_17 = __wm_module_7["enqueueDependencies"];
const __wm_library_export_18 = __wm_module_7["rootFunctionIds"];
const __wm_library_export_19 = __wm_module_7["solveReachableFunctions"];
const __wm_library_export_20 = __wm_module_7["indexBindings"];
const __wm_library_export_21 = __wm_module_7["bindParams"];
const __wm_library_export_22 = __wm_module_7["collectLocalBindings"];
const __wm_library_export_23 = __wm_module_7["constantExpression"];
const __wm_library_export_24 = __wm_module_7["constantExpressions"];
const __wm_library_export_25 = __wm_module_7["reifiableCaptureType"];
const __wm_library_export_26 = __wm_module_7["captureCategory"];
const __wm_library_export_27 = __wm_module_7["collectFunctionCaptures"];
const __wm_library_export_28 = __wm_module_7["collectReachableCaptures"];
const __wm_library_export_29 = __wm_module_7["captureValues"];
const __wm_library_export_30 = __wm_module_7["rootCaptures"];
const __wm_library_export_31 = __wm_module_7["illegalCaptureDiagnostic"];
const __wm_library_export_32 = __wm_module_7["captureDiagnostics"];
const __wm_library_export_33 = __wm_module_7["indexExpressions"];
const __wm_library_export_34 = __wm_module_7["indexTypes"];
const __wm_library_export_35 = __wm_module_7["representationOf"];
const __wm_library_export_36 = __wm_module_7["joinRepresentation"];
const __wm_library_export_37 = __wm_module_7["combinedRepresentation"];
const __wm_library_export_38 = __wm_module_7["setRepresentation"];
const __wm_library_export_39 = __wm_module_7["setRepresentations"];
const __wm_library_export_40 = __wm_module_7["seedRepresentations"];
const __wm_library_export_41 = __wm_module_7["childTypeIds"];
const __wm_library_export_42 = __wm_module_7["numericTypeIds"];
const __wm_library_export_43 = __wm_module_7["lastChildTypeId"];
const __wm_library_export_44 = __wm_module_7["constraintTypeIds"];
const __wm_library_export_45 = __wm_module_7["applyNumericGroup"];
const __wm_library_export_46 = __wm_module_7["applyArgumentConstraints"];
const __wm_library_export_47 = __wm_module_7["applyCallConstraint"];
const __wm_library_export_48 = __wm_module_7["applyNumericConstraint"];
const __wm_library_export_49 = __wm_module_7["numericSweep"];
const __wm_library_export_50 = __wm_module_7["solveNumericRepresentations"];
const __wm_library_export_51 = __wm_module_7["collectExpressionItems"];
const __wm_library_export_52 = __wm_module_7["concreteRepresentation"];
const __wm_library_export_53 = __wm_module_7["setTypeRepresentation"];
const __wm_library_export_54 = __wm_module_7["seedParamRepresentations"];
const __wm_library_export_55 = __wm_module_7["functionParamRepresentations"];
const __wm_library_export_56 = __wm_module_7["callArgumentRepresentations"];
const __wm_library_export_57 = __wm_module_7["mergeArgumentRepresentations"];
const __wm_library_export_58 = __wm_module_7["solveFunctionInstance"];
const __wm_library_export_59 = __wm_module_7["solveInstanceFixedPoint"];
const __wm_library_export_60 = __wm_module_7["instanceSweep"];
const __wm_library_export_61 = __wm_module_7["representationsEqual"];
const __wm_library_export_62 = __wm_module_7["findSpecialization"];
const __wm_library_export_63 = __wm_module_7["representationSuffix"];
const __wm_library_export_64 = __wm_module_7["specializationName"];
const __wm_library_export_65 = __wm_module_7["addTypeIds"];
const __wm_library_export_66 = __wm_module_7["collectInstanceTypeIds"];
const __wm_library_export_67 = __wm_module_7["addParamTypeIds"];
const __wm_library_export_68 = __wm_module_7["representationFacts"];
const __wm_library_export_69 = __wm_module_7["specializationTypeFacts"];
const __wm_library_export_70 = __wm_module_7["initialSpecializationState"];
const __wm_library_export_71 = __wm_module_7["withSpecializedCall"];
const __wm_library_export_72 = __wm_module_7["withSpecializationDiagnostic"];
const __wm_library_export_73 = __wm_module_7["mutualRecursionDiagnostic"];
const __wm_library_export_74 = __wm_module_7["materializeSpecialization"];
const __wm_library_export_75 = __wm_module_7["materializeSpecializedCalls"];
const __wm_library_export_76 = __wm_module_7["materializeRootSpecializations"];
const __wm_library_export_77 = __wm_module_7["initialIrBuildState"];
const __wm_library_export_78 = __wm_module_7["indexRepresentationFacts"];
const __wm_library_export_79 = __wm_module_7["irRepresentation"];
const __wm_library_export_80 = __wm_module_7["specializedCallTarget"];
const __wm_library_export_81 = __wm_module_7["irValueKind"];
const __wm_library_export_82 = __wm_module_7["reifyIrExpression"];
const __wm_library_export_83 = __wm_module_7["reifyIrChildren"];
const __wm_library_export_84 = __wm_module_7["reifyIrParams"];
const __wm_library_export_85 = __wm_module_7["reifyIrSpecializations"];
const __wm_library_export_86 = __wm_module_7["irFunctionValues"];
const __wm_library_export_87 = __wm_module_7["irExpressionValues"];
const __wm_library_export_88 = __wm_module_7["mergeConsensusRepresentation"];
const __wm_library_export_89 = __wm_module_7["addConsensusFacts"];
const __wm_library_export_90 = __wm_module_7["specializationConsensus"];
const __wm_library_export_91 = __wm_module_7["refinedType"];
const __wm_library_export_92 = __wm_module_7["compileGpu"];
const __wm_library_export_93 = __wm_module_7["compileGpuSlice"];
const __wm_library_export_94 = __wm_module_7["elaborateGpuSliceTypes"];
export {
  __wm_library_export_0 as SpecializationRegistryEntry,
  __wm_library_export_1 as SpecializationBuildState,
  __wm_library_export_2 as IrBuildState,
  __wm_library_export_3 as typedExpression,
  __wm_library_export_4 as typedFunction,
  __wm_library_export_5 as emptyOutput,
  __wm_library_export_6 as incompatibleSchema,
  __wm_library_export_7 as prependAll,
  __wm_library_export_8 as reverseInto,
  __wm_library_export_9 as capabilityDiagnostic,
  __wm_library_export_10 as reachableBodyIds,
  __wm_library_export_11 as reachableCapabilityDiagnostics,
  __wm_library_export_12 as duplicateFunctionDiagnostic,
  __wm_library_export_13 as registerFunctions,
  __wm_library_export_14 as indexFunctionBindings,
  __wm_library_export_15 as callDependency,
  __wm_library_export_16 as collectFunctionDependencies,
  __wm_library_export_17 as enqueueDependencies,
  __wm_library_export_18 as rootFunctionIds,
  __wm_library_export_19 as solveReachableFunctions,
  __wm_library_export_20 as indexBindings,
  __wm_library_export_21 as bindParams,
  __wm_library_export_22 as collectLocalBindings,
  __wm_library_export_23 as constantExpression,
  __wm_library_export_24 as constantExpressions,
  __wm_library_export_25 as reifiableCaptureType,
  __wm_library_export_26 as captureCategory,
  __wm_library_export_27 as collectFunctionCaptures,
  __wm_library_export_28 as collectReachableCaptures,
  __wm_library_export_29 as captureValues,
  __wm_library_export_30 as rootCaptures,
  __wm_library_export_31 as illegalCaptureDiagnostic,
  __wm_library_export_32 as captureDiagnostics,
  __wm_library_export_33 as indexExpressions,
  __wm_library_export_34 as indexTypes,
  __wm_library_export_35 as representationOf,
  __wm_library_export_36 as joinRepresentation,
  __wm_library_export_37 as combinedRepresentation,
  __wm_library_export_38 as setRepresentation,
  __wm_library_export_39 as setRepresentations,
  __wm_library_export_40 as seedRepresentations,
  __wm_library_export_41 as childTypeIds,
  __wm_library_export_42 as numericTypeIds,
  __wm_library_export_43 as lastChildTypeId,
  __wm_library_export_44 as constraintTypeIds,
  __wm_library_export_45 as applyNumericGroup,
  __wm_library_export_46 as applyArgumentConstraints,
  __wm_library_export_47 as applyCallConstraint,
  __wm_library_export_48 as applyNumericConstraint,
  __wm_library_export_49 as numericSweep,
  __wm_library_export_50 as solveNumericRepresentations,
  __wm_library_export_51 as collectExpressionItems,
  __wm_library_export_52 as concreteRepresentation,
  __wm_library_export_53 as setTypeRepresentation,
  __wm_library_export_54 as seedParamRepresentations,
  __wm_library_export_55 as functionParamRepresentations,
  __wm_library_export_56 as callArgumentRepresentations,
  __wm_library_export_57 as mergeArgumentRepresentations,
  __wm_library_export_58 as solveFunctionInstance,
  __wm_library_export_59 as solveInstanceFixedPoint,
  __wm_library_export_60 as instanceSweep,
  __wm_library_export_61 as representationsEqual,
  __wm_library_export_62 as findSpecialization,
  __wm_library_export_63 as representationSuffix,
  __wm_library_export_64 as specializationName,
  __wm_library_export_65 as addTypeIds,
  __wm_library_export_66 as collectInstanceTypeIds,
  __wm_library_export_67 as addParamTypeIds,
  __wm_library_export_68 as representationFacts,
  __wm_library_export_69 as specializationTypeFacts,
  __wm_library_export_70 as initialSpecializationState,
  __wm_library_export_71 as withSpecializedCall,
  __wm_library_export_72 as withSpecializationDiagnostic,
  __wm_library_export_73 as mutualRecursionDiagnostic,
  __wm_library_export_74 as materializeSpecialization,
  __wm_library_export_75 as materializeSpecializedCalls,
  __wm_library_export_76 as materializeRootSpecializations,
  __wm_library_export_77 as initialIrBuildState,
  __wm_library_export_78 as indexRepresentationFacts,
  __wm_library_export_79 as irRepresentation,
  __wm_library_export_80 as specializedCallTarget,
  __wm_library_export_81 as irValueKind,
  __wm_library_export_82 as reifyIrExpression,
  __wm_library_export_83 as reifyIrChildren,
  __wm_library_export_84 as reifyIrParams,
  __wm_library_export_85 as reifyIrSpecializations,
  __wm_library_export_86 as irFunctionValues,
  __wm_library_export_87 as irExpressionValues,
  __wm_library_export_88 as mergeConsensusRepresentation,
  __wm_library_export_89 as addConsensusFacts,
  __wm_library_export_90 as specializationConsensus,
  __wm_library_export_91 as refinedType,
  __wm_library_export_92 as compileGpu,
  __wm_library_export_93 as compileGpuSlice,
  __wm_library_export_94 as elaborateGpuSliceTypes
};