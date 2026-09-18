"use strict";
const __wm_js_array_tag = Symbol('wm.jsArray');
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
  if (typeof value === "function") return "<function>";
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "<cycle>";
  seen.add(value);
  let shown;
  if (__wm_is_tuple(value)) {
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
const Dict = {
  empty: () => ({}),
  get: ([dict, key]) => __wm_js_option_wrap(Object.hasOwn(dict, key) ? dict[key] : undefined),
  set: ([dict, key, value]) => { dict[key] = value; },
};
const Table = {
  empty: () => new globalThis.Map(),
  get: ([table, key]) => __wm_js_option_wrap(table.get(key)),
  set: ([table, key, value]) => { table.set(key, value); },
  getAt: ([table, key]) => __wm_js_option_wrap(table.get(key)),
  setAt: ([table, key, value]) => { table.set(key, value); },
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
const Js = {
  Array: {
    toList: __wm_array_to_list,
    fromList: __wm_list_to_array,
  },
};
const Text = {
  of: __wm_text_of,
};
const __wm_debug_error_message = (error) => {
  if (typeof error === "string") return error;
  if (error instanceof globalThis.Error) return String(error.message);
  if (error?.ctor === -7) return String(error.args[0]);
  if (error?.ctor === -8) return "unknown JavaScript error";
  if (error === null) return "null";
  return __wm_show(error, new WeakSet(), true);
};
const Debug = {
  errorMessage: __wm_debug_error_message,
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
const __wm_basis_Task = {
  new: (register) => new Promise((complete) => {
    const registered = register(complete);
    if (registered.ctor !== -3) complete(registered);
  }),
  fromResult: (result) => Promise.resolve(result),
  succeed: (value) => Promise.resolve(__wm_basis_Ok(value)),
  fail: (error) => Promise.resolve(__wm_basis_Err(error)),
  map: ([task, fn]) => Promise.resolve(task).then((result) =>
    result.ctor === -3 ? __wm_basis_Ok(fn(result.args[0])) : result
  ),
  map2: ([leftTask, rightTask, fn]) => Promise.all([
    Promise.resolve(leftTask),
    Promise.resolve(rightTask),
  ]).then((results) => {
    const left = results[0];
    const right = results[1];
    if (left.ctor !== -3) return left;
    if (right.ctor !== -3) return right;
    return __wm_basis_Ok(fn([left.args[0], right.args[0]]));
  }),
  race: ([leftTask, rightTask]) => Promise.race([
    Promise.resolve(leftTask),
    Promise.resolve(rightTask),
  ]),
  andThen: ([task, fn]) => Promise.resolve(task).then((result) =>
    result.ctor === -3 ? fn(result.args[0]) : result
  ),
  mapErr: ([task, fn]) => Promise.resolve(task).then((result) =>
    result.ctor === -4 ? __wm_basis_Err(fn(result.args[0])) : result
  ),
  recover: ([task, fn]) => Promise.resolve(task).then((result) =>
    result.ctor === -4 ? __wm_basis_Ok(fn(result.args[0])) : result
  ),
  orElse: ([task, fn]) => Promise.resolve(task).then((result) =>
    result.ctor === -4 ? fn(result.args[0]) : result
  ),
  all: (tasks) => Promise.all(tasks).then((results) => {
    const values = [];
    for (const result of results) {
      if (result.ctor !== -3) return result;
      values.push(result.args[0]);
    }
    return __wm_basis_Ok(values);
  }),
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
const __wm_deep_freeze_shader_artifact = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) __wm_deep_freeze_shader_artifact(child);
    Object.freeze(value);
  }
  return value;
};
const __wm_gpu_slang = (artifact) => artifact.slang;
const __wm_gpu_glsl = (artifact) => { if (typeof artifact.glslModule !== "string") throw new Error("reusable GLSL was not materialized for this fragment"); return artifact.glslModule; };
const __wm_gpu_callable_name = (artifact) => artifact.callableName;
const __wm_gpu_wgsl = (artifact) => artifact.wgsl;
const __wm_gpu_shader_source = (args) => { const [artifact, target] = args; const required = (value, label) => { if (typeof value !== "string") throw new Error("shader source for " + label + " was not materialized for this fragment"); return value; }; if (target === __wm_basis_Gpu_ShaderTarget_WGSL) return artifact.wgsl; if (target === __wm_basis_Gpu_ShaderTarget_GLSL) return required(artifact.glsl, "GLSL"); if (target === __wm_basis_Gpu_ShaderTarget_HLSL) return required(artifact.hlsl, "HLSL"); if (target === __wm_basis_Gpu_ShaderTarget_METAL) return required(artifact.metal, "Metal"); throw new Error("unknown shader target"); };
const __wm_gpu_vertex_entry_point = (artifact) => artifact.vertexEntry;
const __wm_gpu_fragment_entry_point = (artifact) => artifact.fragmentEntry;
const __wm_shader_artifact_identities = new WeakMap();
const __wm_gpu_artifact_identity = (artifact) => {
  const identity = __wm_shader_artifact_identities.get(artifact);
  if (!identity) throw new Error("value is not a compiler-produced shader artifact");
  return identity;
};
const __wm_gpu_uniform_binding = (artifact) => artifact.uniformLayout?.binding ?? -1;
const __wm_gpu_uniform_byte_length = (artifact) => artifact.uniformLayout?.byteLength ?? 0;
const __wm_gpu_uniform_bytes = (artifact) => artifact.uniformBytes ?? __wm_js_array_mark([]);
const __wm_gpu_binding_count = (artifact) => (artifact.uniformLayout ? 1 : 0) + (artifact.resourceLayout?.bindings.length ?? 0);
const __wm_gpu_texture_brand = Symbol("wm.gpu.texture2d");
const __wm_gpu_sampled_brand = Symbol("wm.gpu.sampled-texture2d");
const __wm_gpu_target_brand = Symbol("wm.gpu.render-target2d");
const __wm_gpu_sampler_brand = Symbol("wm.gpu.sampler");
const __wm_gpu_destroyed_textures = new WeakSet();
const __wm_gpu_result = (thunk) => {
  try { return __wm_basis_Ok(thunk()); }
  catch (error) { return __wm_basis_Err(__wm_js_error(error)); }
};
const __wm_gpu_require = (value, brand, label) => {
  if (!value || typeof value !== "object" || value[brand] !== true) {
    throw new Error("value is not a compiler-produced " + label);
  }
  return value;
};
const __wm_gpu_require_live_texture = (value) => {
  const texture = __wm_gpu_require(value, __wm_gpu_texture_brand, "Gpu.Texture2D");
  if (__wm_gpu_destroyed_textures.has(texture)) throw new Error("Gpu.Texture2D is destroyed");
  return texture;
};
const __wm_gpu_texture_2d = (args) => __wm_gpu_result(() => {
  const [device, width, height] = args;
  if (!device || typeof device.createTexture !== "function" || !device.queue) {
    throw new Error("Gpu.texture2D requires a GPUDevice-like value");
  }
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("Gpu.texture2D dimensions must be positive integers");
  }
  const usage = globalThis.GPUTextureUsage;
  if (!usage) throw new Error("Gpu.texture2D requires WebGPU texture usage constants");
  const raw = device.createTexture({
    size: { width, height, depthOrArrayLayers: 1 },
    dimension: "2d",
    format: "rgba16float",
    mipLevelCount: 1,
    sampleCount: 1,
    usage: usage.TEXTURE_BINDING | usage.RENDER_ATTACHMENT | usage.COPY_DST,
  });
  const texture = Object.freeze({
    [__wm_gpu_texture_brand]: true,
    device,
    raw,
    width,
    height,
    format: "rgba16float",
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({ colorAttachments: [{
    view: raw.createView(),
    loadOp: "clear",
    storeOp: "store",
    clearValue: { r: 0, g: 0, b: 0, a: 0 },
  }] });
  pass.end();
  device.queue.submit([encoder.finish()]);
  return texture;
});
const __wm_gpu_sampled_texture_2d = (value) => __wm_gpu_result(() => {
  const texture = __wm_gpu_require_live_texture(value);
  const view = texture.raw.createView({
    format: "rgba16float", dimension: "2d", aspect: "all",
    baseMipLevel: 0, mipLevelCount: 1,
    baseArrayLayer: 0, arrayLayerCount: 1,
  });
  return Object.freeze({
    [__wm_gpu_sampled_brand]: true,
    kind: "sampled-texture-2d",
    device: texture.device,
    texture,
    view,
  });
});
const __wm_gpu_render_target_2d = (value) => __wm_gpu_result(() => {
  const texture = __wm_gpu_require_live_texture(value);
  const view = texture.raw.createView({
    format: "rgba16float", dimension: "2d", aspect: "all",
    baseMipLevel: 0, mipLevelCount: 1,
    baseArrayLayer: 0, arrayLayerCount: 1,
  });
  return Object.freeze({
    [__wm_gpu_target_brand]: true,
    device: texture.device,
    texture,
    view,
  });
});
const __wm_gpu_sampler = (device, filter) => __wm_gpu_result(() => {
  if (!device || typeof device.createSampler !== "function") {
    throw new Error("Gpu sampler creation requires a GPUDevice-like value");
  }
  const raw = device.createSampler({
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    addressModeW: "clamp-to-edge",
    magFilter: filter,
    minFilter: filter,
    mipmapFilter: filter,
  });
  return Object.freeze({ [__wm_gpu_sampler_brand]: true, kind: "sampler", device, raw, filter });
});
const __wm_gpu_nearest_sampler = (device) => __wm_gpu_sampler(device, "nearest");
const __wm_gpu_linear_sampler = (device) => __wm_gpu_sampler(device, "linear");
const __wm_gpu_destroy_texture_2d = (value) => __wm_gpu_result(() => {
  const texture = __wm_gpu_require(value, __wm_gpu_texture_brand, "Gpu.Texture2D");
  if (!__wm_gpu_destroyed_textures.has(texture)) {
    texture.raw.destroy();
    __wm_gpu_destroyed_textures.add(texture);
  }
  return undefined;
});
const __wm_gpu_bound_resource = (field, value) => {
  const brand = field.kind === "sampled-texture-2d" ? __wm_gpu_sampled_brand : __wm_gpu_sampler_brand;
  const label = field.kind === "sampled-texture-2d" ? "Gpu.SampledTexture2D" : "Gpu.Sampler";
  const resource = __wm_gpu_require(value, brand, label);
  if (resource.kind !== field.kind) throw new Error("shader resource field " + field.name + " has the wrong kind");
  if (resource.texture && __wm_gpu_destroyed_textures.has(resource.texture)) {
    throw new Error("shader resource field " + field.name + " uses a destroyed texture");
  }
  return Object.freeze({ field, resource });
};
const __wm_gpu_bind_group_entries = (args) => __wm_gpu_result(() => {
  const [artifact, device, uniformOption] = args;
  __wm_gpu_artifact_identity(artifact);
  const uniformBuffer = __wm_js_option_unwrap(uniformOption);
  const entries = [];
  if (artifact.uniformLayout) {
    if (!uniformBuffer) throw new Error("shader requires a uniform buffer");
    entries.push({ binding: artifact.uniformLayout.binding, resource: { buffer: uniformBuffer } });
  } else if (uniformBuffer != null) {
    throw new Error("shader without uniforms received a uniform buffer");
  }
  const expected = artifact.resourceLayout?.bindings ?? [];
  const bound = artifact.resourceBindings ?? [];
  if (expected.length !== bound.length) throw new Error("bound fragment has incomplete GPU resources");
  for (let index = 0; index < expected.length; index += 1) {
    const item = bound[index];
    if (item.field.binding !== expected[index].binding || item.resource.device !== device) {
      throw new Error("shader resource belongs to a different device or layout");
    }
    if (item.resource.texture && __wm_gpu_destroyed_textures.has(item.resource.texture)) {
      throw new Error("shader resource uses a destroyed texture");
    }
    entries.push({
      binding: item.field.binding,
      resource: item.field.kind === "sampler" ? item.resource.raw : item.resource.view,
    });
  }
  return entries;
});
const __wm_gpu_render_target_view = (value) => __wm_gpu_result(() => {
  const target = __wm_gpu_require(value, __wm_gpu_target_brand, "Gpu.RenderTarget2D");
  __wm_gpu_require_live_texture(target.texture);
  return target.view;
});
const __wm_gpu_validate_render_target = (args) => __wm_gpu_result(() => {
  const [artifact, value, device] = args;
  __wm_gpu_artifact_identity(artifact);
  const target = __wm_gpu_require(value, __wm_gpu_target_brand, "Gpu.RenderTarget2D");
  __wm_gpu_require_live_texture(target.texture);
  if (target.device !== device) throw new Error("render target belongs to a different device");
  for (const item of artifact.resourceBindings ?? []) {
    if (item.resource.texture === target.texture) {
      throw new Error("fragment cannot sample the texture used as its render target");
    }
  }
  return undefined;
});
const __wm_bind_shader_artifact = (artifact, environment) => {
  const layout = artifact.uniformLayout;
  const resourceLayout = artifact.resourceLayout;
  if (!layout && !resourceLayout) throw new Error("static shader artifact cannot bind an environment");
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    throw new Error("shader environment must be a nominal record value");
  }
  const buffer = layout ? new ArrayBuffer(layout.byteLength) : undefined;
  const view = buffer ? new DataView(buffer) : undefined;
  for (const field of layout?.fields ?? []) {
    const value = environment[field.name];
    const boolean = field.representation === "bool32";
    const width = field.representation.includes("x") ? Number(field.representation.at(-1)) : 1;
    const values = width === 1 ? [value] : value;
    const valueType = boolean ? "boolean" : "number";
    if (!Array.isArray(values) || values.length !== width || values.some((item) => typeof item !== valueType)) {
      throw new Error("shader environment field " + field.name + " does not match " + field.representation);
    }
    for (let lane = 0; lane < width; lane += 1) {
      if (boolean) {
        view.setInt32(field.offset + lane * 4, values[lane] ? 1 : 0, true);
      } else if (field.representation.startsWith("i32")) {
        const laneValue = values[lane];
        if (!Number.isInteger(laneValue) || laneValue < -2147483648 || laneValue > 2147483647) {
          throw new Error("shader environment field " + field.name + " is outside signed i32 range");
        }
        view.setInt32(field.offset + lane * 4, laneValue, true);
      } else {
        view.setFloat32(field.offset + lane * 4, values[lane], true);
      }
    }
  }
  const uniformBytes = buffer ? Object.freeze(__wm_js_array_mark(Array.from(new Uint8Array(buffer)))) : undefined;
  const resourceBindings = Object.freeze((resourceLayout?.bindings ?? []).map((field) =>
    __wm_gpu_bound_resource(field, environment[field.name])
  ));
  const bound = Object.freeze({
    ...artifact,
    ...(uniformBytes ? { uniformBytes } : {}),
    ...(resourceLayout ? { resourceBindings } : {}),
  });
  __wm_shader_artifact_identities.set(bound, __wm_gpu_artifact_identity(artifact));
  return bound;
};
const __wm_shader_artifacts = __wm_deep_freeze_shader_artifact({  });
for (const [identity, artifact] of Object.entries(__wm_shader_artifacts)) {
  __wm_shader_artifact_identities.set(artifact, identity);
}
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
let __wm_std_List;
__wm_define_module(
  "__wm_std_List",
  [],
  async () => {
const map_3469__wm_d2 = (items_3470, f_3471) => {
const __wm_scalar_0_0 = items_3470;
const __wm_scalar_0_1 = f_3471;
if (__wm_scalar_0_0 === __wm_basis_Nil) {

return __wm_basis_Nil;
} else if (__wm_scalar_0_0?.ctor === -6 && __wm_scalar_0_0.args.length === 1 && __wm_is_tuple(__wm_scalar_0_0.args[0]) && __wm_scalar_0_0.args[0].length === 2 && __wm_eq(__wm_scalar_0_1, f_3471)) {
const head_3472 = __wm_scalar_0_0.args[0][0];
const rest_3473 = __wm_scalar_0_0.args[0][1];
return __wm_basis_Cons([f_3471(head_3472), map_3469__wm_d2(rest_3473, f_3471)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const map_3469 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return map_3469__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const length_3480 = (__arg) => {
if (true) {
const items_3474 = __arg;
const loop_3475__wm_d2 = (remaining_3476, count_3477) => {
__wm_tail_0: while (true) {
{
const __wm_scalar_1_0 = remaining_3476;
const __wm_scalar_1_1 = count_3477;
if (__wm_scalar_1_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_1_1, count_3477)) {

return count_3477;
} else if (__wm_scalar_1_0?.ctor === -6 && __wm_scalar_1_0.args.length === 1 && __wm_is_tuple(__wm_scalar_1_0.args[0]) && __wm_scalar_1_0.args[0].length === 2 && __wm_eq(__wm_scalar_1_1, count_3477)) {
const __3478 = __wm_scalar_1_0.args[0][0];
const rest_3479 = __wm_scalar_1_0.args[0][1];
{
const __wm_tail_arg_0_0 = rest_3479;
const __wm_tail_arg_0_1 = (count_3477 + 1);
remaining_3476 = __wm_tail_arg_0_0;
count_3477 = __wm_tail_arg_0_1;
continue __wm_tail_0;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const loop_3475 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return loop_3475__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return loop_3475__wm_d2(items_3474, 0);
}
__wm_fail("Match", "pattern match failure in function");
};
const append_3481__wm_d2 = (left_3482, right_3483) => {
const __wm_scalar_2_0 = left_3482;
const __wm_scalar_2_1 = right_3483;
if (__wm_scalar_2_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_2_1, right_3483)) {

return right_3483;
} else if (__wm_scalar_2_0?.ctor === -6 && __wm_scalar_2_0.args.length === 1 && __wm_is_tuple(__wm_scalar_2_0.args[0]) && __wm_scalar_2_0.args[0].length === 2 && __wm_eq(__wm_scalar_2_1, right_3483)) {
const head_3484 = __wm_scalar_2_0.args[0][0];
const rest_3485 = __wm_scalar_2_0.args[0][1];
return __wm_basis_Cons([head_3484, append_3481__wm_d2(rest_3485, right_3483)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const append_3481 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return append_3481__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const filter_3486__wm_d2 = (items_3487, predicate_3488) => {
__wm_tail_1: while (true) {
{
const __wm_scalar_3_0 = items_3487;
const __wm_scalar_3_1 = predicate_3488;
if (__wm_scalar_3_0 === __wm_basis_Nil) {

return __wm_basis_Nil;
} else if (__wm_scalar_3_0?.ctor === -6 && __wm_scalar_3_0.args.length === 1 && __wm_is_tuple(__wm_scalar_3_0.args[0]) && __wm_scalar_3_0.args[0].length === 2 && __wm_eq(__wm_scalar_3_1, predicate_3488)) {
const head_3489 = __wm_scalar_3_0.args[0][0];
const rest_3490 = __wm_scalar_3_0.args[0][1];
if (predicate_3488(head_3489)) {
return __wm_basis_Cons([head_3489, filter_3486__wm_d2(rest_3490, predicate_3488)]);
} else {
{
const __wm_tail_arg_1_0 = rest_3490;
const __wm_tail_arg_1_1 = predicate_3488;
items_3487 = __wm_tail_arg_1_0;
predicate_3488 = __wm_tail_arg_1_1;
continue __wm_tail_1;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const filter_3486 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return filter_3486__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const take_3491__wm_d2 = (items_3492, count_3493) => {
const __wm_scalar_4_0 = items_3492;
const __wm_scalar_4_1 = count_3493;
if (__wm_scalar_4_0 === __wm_basis_Nil) {

return __wm_basis_Nil;
} else if (__wm_scalar_4_1 === 0) {

return __wm_basis_Nil;
} else if (__wm_scalar_4_0?.ctor === -6 && __wm_scalar_4_0.args.length === 1 && __wm_is_tuple(__wm_scalar_4_0.args[0]) && __wm_scalar_4_0.args[0].length === 2 && __wm_eq(__wm_scalar_4_1, count_3493)) {
const head_3494 = __wm_scalar_4_0.args[0][0];
const rest_3495 = __wm_scalar_4_0.args[0][1];
return __wm_basis_Cons([head_3494, take_3491__wm_d2(rest_3495, (count_3493 - 1))]);
}
__wm_fail("Match", "non-exhaustive match");
};
const take_3491 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return take_3491__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const drop_3496__wm_d2 = (items_3497, count_3498) => {
__wm_tail_2: while (true) {
{
const __wm_scalar_5_0 = items_3497;
const __wm_scalar_5_1 = count_3498;
if (__wm_eq(__wm_scalar_5_0, items_3497) && __wm_scalar_5_1 === 0) {

return items_3497;
} else if (__wm_scalar_5_0 === __wm_basis_Nil) {

return __wm_basis_Nil;
} else if (__wm_scalar_5_0?.ctor === -6 && __wm_scalar_5_0.args.length === 1 && __wm_is_tuple(__wm_scalar_5_0.args[0]) && __wm_scalar_5_0.args[0].length === 2 && __wm_eq(__wm_scalar_5_1, count_3498)) {
const __3499 = __wm_scalar_5_0.args[0][0];
const rest_3500 = __wm_scalar_5_0.args[0][1];
{
const __wm_tail_arg_2_0 = rest_3500;
const __wm_tail_arg_2_1 = (count_3498 - 1);
items_3497 = __wm_tail_arg_2_0;
count_3498 = __wm_tail_arg_2_1;
continue __wm_tail_2;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const drop_3496 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return drop_3496__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const at_3501__wm_d2 = (items_3502, index_3503) => {
__wm_tail_3: while (true) {
{
const __wm_scalar_6_0 = items_3502;
const __wm_scalar_6_1 = index_3503;
if (__wm_scalar_6_0 === __wm_basis_Nil) {

return __wm_basis_None;
} else if (__wm_scalar_6_0?.ctor === -6 && __wm_scalar_6_0.args.length === 1 && __wm_is_tuple(__wm_scalar_6_0.args[0]) && __wm_scalar_6_0.args[0].length === 2 && __wm_scalar_6_1 === 0) {
const head_3504 = __wm_scalar_6_0.args[0][0];
const __3505 = __wm_scalar_6_0.args[0][1];
return __wm_basis_Some(head_3504);
} else if (__wm_scalar_6_0?.ctor === -6 && __wm_scalar_6_0.args.length === 1 && __wm_is_tuple(__wm_scalar_6_0.args[0]) && __wm_scalar_6_0.args[0].length === 2 && __wm_eq(__wm_scalar_6_1, index_3503)) {
const __3506 = __wm_scalar_6_0.args[0][0];
const rest_3507 = __wm_scalar_6_0.args[0][1];
{
const __wm_tail_arg_3_0 = rest_3507;
const __wm_tail_arg_3_1 = (index_3503 - 1);
items_3502 = __wm_tail_arg_3_0;
index_3503 = __wm_tail_arg_3_1;
continue __wm_tail_3;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const at_3501 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return at_3501__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const foldLeft_3508__wm_d3 = (items_3509, initial_3510, f_3511) => {
__wm_tail_4: while (true) {
{
const __wm_scalar_7_0 = items_3509;
const __wm_scalar_7_1 = initial_3510;
const __wm_scalar_7_2 = f_3511;
if (__wm_scalar_7_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_7_1, initial_3510)) {

return initial_3510;
} else if (__wm_scalar_7_0?.ctor === -6 && __wm_scalar_7_0.args.length === 1 && __wm_is_tuple(__wm_scalar_7_0.args[0]) && __wm_scalar_7_0.args[0].length === 2 && __wm_eq(__wm_scalar_7_1, initial_3510) && __wm_eq(__wm_scalar_7_2, f_3511)) {
const head_3512 = __wm_scalar_7_0.args[0][0];
const rest_3513 = __wm_scalar_7_0.args[0][1];
{
const __wm_tail_arg_4_0 = rest_3513;
const __wm_tail_arg_4_1 = f_3511([initial_3510, head_3512]);
const __wm_tail_arg_4_2 = f_3511;
items_3509 = __wm_tail_arg_4_0;
initial_3510 = __wm_tail_arg_4_1;
f_3511 = __wm_tail_arg_4_2;
continue __wm_tail_4;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const foldLeft_3508 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldLeft_3508__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const foldRight_3514__wm_d3 = (items_3515, initial_3516, f_3517) => {
const __wm_scalar_8_0 = items_3515;
const __wm_scalar_8_1 = initial_3516;
const __wm_scalar_8_2 = f_3517;
if (__wm_scalar_8_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_8_1, initial_3516)) {

return initial_3516;
} else if (__wm_scalar_8_0?.ctor === -6 && __wm_scalar_8_0.args.length === 1 && __wm_is_tuple(__wm_scalar_8_0.args[0]) && __wm_scalar_8_0.args[0].length === 2 && __wm_eq(__wm_scalar_8_1, initial_3516) && __wm_eq(__wm_scalar_8_2, f_3517)) {
const head_3518 = __wm_scalar_8_0.args[0][0];
const rest_3519 = __wm_scalar_8_0.args[0][1];
return f_3517([head_3518, foldRight_3514__wm_d3(rest_3519, initial_3516, f_3517)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const foldRight_3514 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldRight_3514__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const reverse_3523 = (__arg) => {
if (true) {
const items_3520 = __arg;
return foldLeft_3508__wm_d3(items_3520, __wm_basis_Nil, (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) {
const reversed_3521 = __arg[0];
const item_3522 = __arg[1];
return __wm_basis_Cons([item_3522, reversed_3521]);
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
const any_3524__wm_d2 = (items_3525, predicate_3526) => {
__wm_tail_5: while (true) {
{
const __wm_scalar_9_0 = items_3525;
const __wm_scalar_9_1 = predicate_3526;
if (__wm_scalar_9_0 === __wm_basis_Nil) {

return false;
} else if (__wm_scalar_9_0?.ctor === -6 && __wm_scalar_9_0.args.length === 1 && __wm_is_tuple(__wm_scalar_9_0.args[0]) && __wm_scalar_9_0.args[0].length === 2 && __wm_eq(__wm_scalar_9_1, predicate_3526)) {
const head_3527 = __wm_scalar_9_0.args[0][0];
const rest_3528 = __wm_scalar_9_0.args[0][1];
if (predicate_3526(head_3527)) {
return true;
} else {
{
const __wm_tail_arg_5_0 = rest_3528;
const __wm_tail_arg_5_1 = predicate_3526;
items_3525 = __wm_tail_arg_5_0;
predicate_3526 = __wm_tail_arg_5_1;
continue __wm_tail_5;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const any_3524 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return any_3524__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const all_3529__wm_d2 = (items_3530, predicate_3531) => {
__wm_tail_6: while (true) {
{
const __wm_scalar_10_0 = items_3530;
const __wm_scalar_10_1 = predicate_3531;
if (__wm_scalar_10_0 === __wm_basis_Nil) {

return true;
} else if (__wm_scalar_10_0?.ctor === -6 && __wm_scalar_10_0.args.length === 1 && __wm_is_tuple(__wm_scalar_10_0.args[0]) && __wm_scalar_10_0.args[0].length === 2 && __wm_eq(__wm_scalar_10_1, predicate_3531)) {
const head_3532 = __wm_scalar_10_0.args[0][0];
const rest_3533 = __wm_scalar_10_0.args[0][1];
if (predicate_3531(head_3532)) {
{
const __wm_tail_arg_6_0 = rest_3533;
const __wm_tail_arg_6_1 = predicate_3531;
items_3530 = __wm_tail_arg_6_0;
predicate_3531 = __wm_tail_arg_6_1;
continue __wm_tail_6;
}
} else {
return false;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const all_3529 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return all_3529__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collectWith_3537__wm_d3 = (empty_3534, combine_3535, items_3536) => {
return foldRight_3514__wm_d3(items_3536, empty_3534, combine_3535);
};
const collectWith_3537 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return collectWith_3537__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
let joinRaw_3538 = (__arg) => {
if (true) {
const items_3539 = __arg;
const __wm_return_value_0 = items_3539;
if (__wm_return_value_0 === __wm_basis_Nil) {

return "";
} else if (__wm_return_value_0?.ctor === -6 && __wm_return_value_0.args.length === 1 && __wm_is_tuple(__wm_return_value_0.args[0]) && __wm_return_value_0.args[0].length === 2 && __wm_return_value_0.args[0][1] === __wm_basis_Nil) {
const head_3540 = __wm_return_value_0.args[0][0];
return (("" + Text.of(head_3540)) + "");
} else if (__wm_return_value_0?.ctor === -6 && __wm_return_value_0.args.length === 1 && __wm_is_tuple(__wm_return_value_0.args[0]) && __wm_return_value_0.args[0].length === 2) {
const head_3541 = __wm_return_value_0.args[0][0];
const rest_3542 = __wm_return_value_0.args[0][1];
return (((("" + Text.of(head_3541)) + "") + ", ") + joinRaw_3538(rest_3542));
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const toString_3544 = (__arg) => {
if (true) {
const items_3543 = __arg;
return (("[" + joinRaw_3538(items_3543)) + "]");
}
__wm_fail("Match", "pattern match failure in function");
};
const toStringRender_3547__wm_d2 = (items_3545, render_3546) => {
return toString_3544(map_3469__wm_d2(items_3545, render_3546));
};
const toStringRender_3547 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return toStringRender_3547__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return { "map": map_3469, "map__wm_d2": map_3469__wm_d2, "length": length_3480, "append": append_3481, "append__wm_d2": append_3481__wm_d2, "filter": filter_3486, "filter__wm_d2": filter_3486__wm_d2, "take": take_3491, "take__wm_d2": take_3491__wm_d2, "drop": drop_3496, "drop__wm_d2": drop_3496__wm_d2, "at": at_3501, "at__wm_d2": at_3501__wm_d2, "foldLeft": foldLeft_3508, "foldLeft__wm_d3": foldLeft_3508__wm_d3, "foldRight": foldRight_3514, "foldRight__wm_d3": foldRight_3514__wm_d3, "reverse": reverse_3523, "any": any_3524, "any__wm_d2": any_3524__wm_d2, "all": all_3529, "all__wm_d2": all_3529__wm_d2, "collectWith": collectWith_3537, "collectWith__wm_d3": collectWith_3537__wm_d3, "joinRaw": joinRaw_3538, "toString": toString_3544, "toStringRender": toStringRender_3547, "toStringRender__wm_d2": toStringRender_3547__wm_d2 };
  },
  (value) => { __wm_std_List = value; },
);
let __wm_std_Map;
__wm_define_module(
  "__wm_std_Map",
  [],
  async () => {
const Less_ctor_0 = Object.freeze({ ctor: 0, name: "Less", args: [] });
const Equal_ctor_1 = Object.freeze({ ctor: 1, name: "Equal", args: [] });
const Greater_ctor_2 = Object.freeze({ ctor: 2, name: "Greater", args: [] });
const MapEmpty_ctor_3 = Object.freeze({ ctor: 3, name: "MapEmpty", args: [] });
const MapNode_ctor_4 = (__payload) => ({ ctor: 4, name: "MapNode", args: [__payload] });
const MapValue_ctor_5 = (__payload) => ({ ctor: 5, name: "MapValue", args: [__payload] });
const numberCompare_3550__wm_d2 = (left_3548, right_3549) => {
if ((left_3548 < right_3549)) {
return Less_ctor_0;
} else {
if ((left_3548 > right_3549)) {
return Greater_ctor_2;
} else {
return Equal_ctor_1;
}
}
};
const numberCompare_3550 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numberCompare_3550__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const height_3557 = (__arg) => {
if (true) {
const tree_3551 = __arg;
const __wm_return_value_1 = tree_3551;
if (__wm_return_value_1 === MapEmpty_ctor_3) {

return 0;
} else if (__wm_return_value_1?.ctor === 4 && __wm_return_value_1.args.length === 1 && __wm_is_tuple(__wm_return_value_1.args[0]) && __wm_return_value_1.args[0].length === 5) {
const nodeHeight_3552 = __wm_return_value_1.args[0][0];
const _key_3553 = __wm_return_value_1.args[0][1];
const _value_3554 = __wm_return_value_1.args[0][2];
const _left_3555 = __wm_return_value_1.args[0][3];
const _right_3556 = __wm_return_value_1.args[0][4];
return nodeHeight_3552;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const max_3560__wm_d2 = (left_3558, right_3559) => {
if ((left_3558 > right_3559)) {
return left_3558;
} else {
return right_3559;
}
};
const max_3560 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return max_3560__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const node_3565__wm_d4 = (key_3561, value_3562, left_3563, right_3564) => {
return MapNode_ctor_4([(1 + max_3560__wm_d2(height_3557(left_3563), height_3557(right_3564))), key_3561, value_3562, left_3563, right_3564]);
};
const node_3565 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return node_3565__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const rotateLeft_3576 = (__arg) => {
if (true) {
const tree_3566 = __arg;
const __wm_return_value_2 = tree_3566;
if (__wm_return_value_2?.ctor === 4 && __wm_return_value_2.args.length === 1 && __wm_is_tuple(__wm_return_value_2.args[0]) && __wm_return_value_2.args[0].length === 5 && __wm_return_value_2.args[0][4]?.ctor === 4 && __wm_return_value_2.args[0][4].args.length === 1 && __wm_is_tuple(__wm_return_value_2.args[0][4].args[0]) && __wm_return_value_2.args[0][4].args[0].length === 5) {
const _height_3567 = __wm_return_value_2.args[0][0];
const key_3568 = __wm_return_value_2.args[0][1];
const value_3569 = __wm_return_value_2.args[0][2];
const left_3570 = __wm_return_value_2.args[0][3];
const _rightHeight_3571 = __wm_return_value_2.args[0][4].args[0][0];
const rightKey_3572 = __wm_return_value_2.args[0][4].args[0][1];
const rightValue_3573 = __wm_return_value_2.args[0][4].args[0][2];
const rightLeft_3574 = __wm_return_value_2.args[0][4].args[0][3];
const rightRight_3575 = __wm_return_value_2.args[0][4].args[0][4];
return node_3565__wm_d4(rightKey_3572, rightValue_3573, node_3565__wm_d4(key_3568, value_3569, left_3570, rightLeft_3574), rightRight_3575);
} else if (true) {

return tree_3566;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const rotateRight_3587 = (__arg) => {
if (true) {
const tree_3577 = __arg;
const __wm_return_value_3 = tree_3577;
if (__wm_return_value_3?.ctor === 4 && __wm_return_value_3.args.length === 1 && __wm_is_tuple(__wm_return_value_3.args[0]) && __wm_return_value_3.args[0].length === 5 && __wm_return_value_3.args[0][3]?.ctor === 4 && __wm_return_value_3.args[0][3].args.length === 1 && __wm_is_tuple(__wm_return_value_3.args[0][3].args[0]) && __wm_return_value_3.args[0][3].args[0].length === 5) {
const _height_3578 = __wm_return_value_3.args[0][0];
const key_3579 = __wm_return_value_3.args[0][1];
const value_3580 = __wm_return_value_3.args[0][2];
const _leftHeight_3581 = __wm_return_value_3.args[0][3].args[0][0];
const leftKey_3582 = __wm_return_value_3.args[0][3].args[0][1];
const leftValue_3583 = __wm_return_value_3.args[0][3].args[0][2];
const leftLeft_3584 = __wm_return_value_3.args[0][3].args[0][3];
const leftRight_3585 = __wm_return_value_3.args[0][3].args[0][4];
const right_3586 = __wm_return_value_3.args[0][4];
return node_3565__wm_d4(leftKey_3582, leftValue_3583, leftLeft_3584, node_3565__wm_d4(key_3579, value_3580, leftRight_3585, right_3586));
} else if (true) {

return tree_3577;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const balance_3605 = (__arg) => {
if (true) {
const tree_3588 = __arg;
const __wm_return_value_4 = tree_3588;
if (__wm_return_value_4 === MapEmpty_ctor_3) {

return MapEmpty_ctor_3;
} else if (__wm_return_value_4?.ctor === 4 && __wm_return_value_4.args.length === 1 && __wm_is_tuple(__wm_return_value_4.args[0]) && __wm_return_value_4.args[0].length === 5) {
const _height_3589 = __wm_return_value_4.args[0][0];
const key_3590 = __wm_return_value_4.args[0][1];
const value_3591 = __wm_return_value_4.args[0][2];
const left_3592 = __wm_return_value_4.args[0][3];
const right_3593 = __wm_return_value_4.args[0][4];
const difference_3594 = (height_3557(left_3592) - height_3557(right_3593));
if ((difference_3594 > 1)) {
const __wm_return_value_5 = left_3592;
if (__wm_return_value_5?.ctor === 4 && __wm_return_value_5.args.length === 1 && __wm_is_tuple(__wm_return_value_5.args[0]) && __wm_return_value_5.args[0].length === 5) {
const _leftHeight_3595 = __wm_return_value_5.args[0][0];
const _leftKey_3596 = __wm_return_value_5.args[0][1];
const _leftValue_3597 = __wm_return_value_5.args[0][2];
const leftLeft_3598 = __wm_return_value_5.args[0][3];
const leftRight_3599 = __wm_return_value_5.args[0][4];
if ((height_3557(leftLeft_3598) < height_3557(leftRight_3599))) {
return rotateRight_3587(node_3565__wm_d4(key_3590, value_3591, rotateLeft_3576(left_3592), right_3593));
} else {
return rotateRight_3587(node_3565__wm_d4(key_3590, value_3591, left_3592, right_3593));
}
} else if (__wm_return_value_5 === MapEmpty_ctor_3) {

return node_3565__wm_d4(key_3590, value_3591, left_3592, right_3593);
}
__wm_fail("Match", "non-exhaustive match");
} else {
if ((difference_3594 < __wm_op_sub(1))) {
const __wm_return_value_6 = right_3593;
if (__wm_return_value_6?.ctor === 4 && __wm_return_value_6.args.length === 1 && __wm_is_tuple(__wm_return_value_6.args[0]) && __wm_return_value_6.args[0].length === 5) {
const _rightHeight_3600 = __wm_return_value_6.args[0][0];
const _rightKey_3601 = __wm_return_value_6.args[0][1];
const _rightValue_3602 = __wm_return_value_6.args[0][2];
const rightLeft_3603 = __wm_return_value_6.args[0][3];
const rightRight_3604 = __wm_return_value_6.args[0][4];
if ((height_3557(rightRight_3604) < height_3557(rightLeft_3603))) {
return rotateLeft_3576(node_3565__wm_d4(key_3590, value_3591, left_3592, rotateRight_3587(right_3593)));
} else {
return rotateLeft_3576(node_3565__wm_d4(key_3590, value_3591, left_3592, right_3593));
}
} else if (__wm_return_value_6 === MapEmpty_ctor_3) {

return node_3565__wm_d4(key_3590, value_3591, left_3592, right_3593);
}
__wm_fail("Match", "non-exhaustive match");
} else {
return node_3565__wm_d4(key_3590, value_3591, left_3592, right_3593);
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const empty_3607 = (__arg) => {
if (true) {
const compare_3606 = __arg;
return MapValue_ctor_5([compare_3606, MapEmpty_ctor_3]);
}
__wm_fail("Match", "pattern match failure in function");
};
const getTree_3608__wm_d3 = (tree_3609, key_3610, compare_3611) => {
__wm_tail_7: while (true) {
{
const __wm_scalar_11_0 = tree_3609;
const __wm_scalar_11_1 = key_3610;
const __wm_scalar_11_2 = compare_3611;
if (__wm_scalar_11_0 === MapEmpty_ctor_3) {

return __wm_basis_None;
} else if (__wm_scalar_11_0?.ctor === 4 && __wm_scalar_11_0.args.length === 1 && __wm_is_tuple(__wm_scalar_11_0.args[0]) && __wm_scalar_11_0.args[0].length === 5 && __wm_eq(__wm_scalar_11_1, key_3610) && __wm_eq(__wm_scalar_11_2, compare_3611)) {
const _height_3612 = __wm_scalar_11_0.args[0][0];
const nodeKey_3613 = __wm_scalar_11_0.args[0][1];
const value_3614 = __wm_scalar_11_0.args[0][2];
const left_3615 = __wm_scalar_11_0.args[0][3];
const right_3616 = __wm_scalar_11_0.args[0][4];
{
const __wm_tail_value_7 = compare_3611([key_3610, nodeKey_3613]);
if (__wm_tail_value_7 === Less_ctor_0) {

{
const __wm_tail_arg_8_0 = left_3615;
const __wm_tail_arg_8_1 = key_3610;
const __wm_tail_arg_8_2 = compare_3611;
tree_3609 = __wm_tail_arg_8_0;
key_3610 = __wm_tail_arg_8_1;
compare_3611 = __wm_tail_arg_8_2;
continue __wm_tail_7;
}
} else if (__wm_tail_value_7 === Equal_ctor_1) {

return __wm_basis_Some(value_3614);
} else if (__wm_tail_value_7 === Greater_ctor_2) {

{
const __wm_tail_arg_9_0 = right_3616;
const __wm_tail_arg_9_1 = key_3610;
const __wm_tail_arg_9_2 = compare_3611;
tree_3609 = __wm_tail_arg_9_0;
key_3610 = __wm_tail_arg_9_1;
compare_3611 = __wm_tail_arg_9_2;
continue __wm_tail_7;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const getTree_3608 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return getTree_3608__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const get_3621__wm_d2 = (map_3617, key_3618) => {
const __wm_scalar_12_0 = map_3617;
const __wm_scalar_12_1 = key_3618;
if (__wm_scalar_12_0?.ctor === 5 && __wm_scalar_12_0.args.length === 1 && __wm_is_tuple(__wm_scalar_12_0.args[0]) && __wm_scalar_12_0.args[0].length === 2 && __wm_eq(__wm_scalar_12_1, key_3618)) {
const compare_3619 = __wm_scalar_12_0.args[0][0];
const tree_3620 = __wm_scalar_12_0.args[0][1];
return getTree_3608__wm_d3(tree_3620, key_3618, compare_3619);
}
__wm_fail("Match", "non-exhaustive match");
};
const get_3621 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return get_3621__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const has_3625__wm_d2 = (map_3622, key_3623) => {
const __wm_return_value_7 = get_3621__wm_d2(map_3622, key_3623);
if (__wm_return_value_7?.ctor === -2 && __wm_return_value_7.args.length === 1) {
const __3624 = __wm_return_value_7.args[0];
return true;
} else if (__wm_return_value_7 === __wm_basis_None) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
};
const has_3625 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return has_3625__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const setTree_3626__wm_d4 = (tree_3627, key_3628, value_3629, compare_3630) => {
const __wm_scalar_13_0 = tree_3627;
const __wm_scalar_13_1 = key_3628;
const __wm_scalar_13_2 = value_3629;
const __wm_scalar_13_3 = compare_3630;
if (__wm_scalar_13_0 === MapEmpty_ctor_3 && __wm_eq(__wm_scalar_13_1, key_3628) && __wm_eq(__wm_scalar_13_2, value_3629)) {

return node_3565__wm_d4(key_3628, value_3629, MapEmpty_ctor_3, MapEmpty_ctor_3);
} else if (__wm_scalar_13_0?.ctor === 4 && __wm_scalar_13_0.args.length === 1 && __wm_is_tuple(__wm_scalar_13_0.args[0]) && __wm_scalar_13_0.args[0].length === 5 && __wm_eq(__wm_scalar_13_1, key_3628) && __wm_eq(__wm_scalar_13_2, value_3629) && __wm_eq(__wm_scalar_13_3, compare_3630)) {
const _height_3631 = __wm_scalar_13_0.args[0][0];
const nodeKey_3632 = __wm_scalar_13_0.args[0][1];
const nodeValue_3633 = __wm_scalar_13_0.args[0][2];
const left_3634 = __wm_scalar_13_0.args[0][3];
const right_3635 = __wm_scalar_13_0.args[0][4];
const __wm_return_value_8 = compare_3630([key_3628, nodeKey_3632]);
if (__wm_return_value_8 === Less_ctor_0) {

return balance_3605(node_3565__wm_d4(nodeKey_3632, nodeValue_3633, setTree_3626__wm_d4(left_3634, key_3628, value_3629, compare_3630), right_3635));
} else if (__wm_return_value_8 === Equal_ctor_1) {

return node_3565__wm_d4(nodeKey_3632, value_3629, left_3634, right_3635);
} else if (__wm_return_value_8 === Greater_ctor_2) {

return balance_3605(node_3565__wm_d4(nodeKey_3632, nodeValue_3633, left_3634, setTree_3626__wm_d4(right_3635, key_3628, value_3629, compare_3630)));
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
};
const setTree_3626 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setTree_3626__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const set_3641__wm_d3 = (map_3636, key_3637, value_3638) => {
const __wm_scalar_14_0 = map_3636;
const __wm_scalar_14_1 = key_3637;
const __wm_scalar_14_2 = value_3638;
if (__wm_scalar_14_0?.ctor === 5 && __wm_scalar_14_0.args.length === 1 && __wm_is_tuple(__wm_scalar_14_0.args[0]) && __wm_scalar_14_0.args[0].length === 2 && __wm_eq(__wm_scalar_14_1, key_3637) && __wm_eq(__wm_scalar_14_2, value_3638)) {
const compare_3639 = __wm_scalar_14_0.args[0][0];
const tree_3640 = __wm_scalar_14_0.args[0][1];
return MapValue_ctor_5([compare_3639, setTree_3626__wm_d4(tree_3640, key_3637, value_3638, compare_3639)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const set_3641 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return set_3641__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const singleton_3645__wm_d3 = (compare_3642, key_3643, value_3644) => {
return set_3641__wm_d3(empty_3607(compare_3642), key_3643, value_3644);
};
const singleton_3645 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return singleton_3645__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
let removeSmallest_3646 = (__arg) => {
if (true) {
const tree_3647 = __arg;
const __wm_return_value_9 = tree_3647;
if (__wm_return_value_9?.ctor === 4 && __wm_return_value_9.args.length === 1 && __wm_is_tuple(__wm_return_value_9.args[0]) && __wm_return_value_9.args[0].length === 5 && __wm_return_value_9.args[0][3] === MapEmpty_ctor_3) {
const _height_3648 = __wm_return_value_9.args[0][0];
const key_3649 = __wm_return_value_9.args[0][1];
const value_3650 = __wm_return_value_9.args[0][2];
const right_3651 = __wm_return_value_9.args[0][4];
return [key_3649, value_3650, right_3651];
} else if (__wm_return_value_9?.ctor === 4 && __wm_return_value_9.args.length === 1 && __wm_is_tuple(__wm_return_value_9.args[0]) && __wm_return_value_9.args[0].length === 5) {
const _height_3652 = __wm_return_value_9.args[0][0];
const key_3653 = __wm_return_value_9.args[0][1];
const value_3654 = __wm_return_value_9.args[0][2];
const left_3655 = __wm_return_value_9.args[0][3];
const right_3656 = __wm_return_value_9.args[0][4];
const __wm_bind_0 = removeSmallest_3646(left_3655);
if (!(__wm_is_tuple(__wm_bind_0) && __wm_bind_0.length === 3)) __wm_fail("Bind", "pattern match failure in let binding");
const smallestKey_3657 = __wm_bind_0[0];
const smallestValue_3658 = __wm_bind_0[1];
const remainingLeft_3659 = __wm_bind_0[2];
return [smallestKey_3657, smallestValue_3658, balance_3605(node_3565__wm_d4(key_3653, value_3654, remainingLeft_3659, right_3656))];
} else if (__wm_return_value_9 === MapEmpty_ctor_3) {

return __wm_fail("Panic", "Map.removeSmallest called with an empty tree");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const removeTree_3660__wm_d3 = (tree_3661, key_3662, compare_3663) => {
const __wm_scalar_15_0 = tree_3661;
const __wm_scalar_15_1 = key_3662;
const __wm_scalar_15_2 = compare_3663;
if (__wm_scalar_15_0 === MapEmpty_ctor_3) {

return MapEmpty_ctor_3;
} else if (__wm_scalar_15_0?.ctor === 4 && __wm_scalar_15_0.args.length === 1 && __wm_is_tuple(__wm_scalar_15_0.args[0]) && __wm_scalar_15_0.args[0].length === 5 && __wm_eq(__wm_scalar_15_1, key_3662) && __wm_eq(__wm_scalar_15_2, compare_3663)) {
const _height_3664 = __wm_scalar_15_0.args[0][0];
const nodeKey_3665 = __wm_scalar_15_0.args[0][1];
const value_3666 = __wm_scalar_15_0.args[0][2];
const left_3667 = __wm_scalar_15_0.args[0][3];
const right_3668 = __wm_scalar_15_0.args[0][4];
const __wm_return_value_10 = compare_3663([key_3662, nodeKey_3665]);
if (__wm_return_value_10 === Less_ctor_0) {

return balance_3605(node_3565__wm_d4(nodeKey_3665, value_3666, removeTree_3660__wm_d3(left_3667, key_3662, compare_3663), right_3668));
} else if (__wm_return_value_10 === Greater_ctor_2) {

return balance_3605(node_3565__wm_d4(nodeKey_3665, value_3666, left_3667, removeTree_3660__wm_d3(right_3668, key_3662, compare_3663)));
} else if (__wm_return_value_10 === Equal_ctor_1) {

const __wm_scalar_16_0 = left_3667;
const __wm_scalar_16_1 = right_3668;
if (__wm_scalar_16_0 === MapEmpty_ctor_3) {

return right_3668;
} else if (__wm_scalar_16_1 === MapEmpty_ctor_3) {

return left_3667;
} else if (__wm_eq(__wm_scalar_16_1, right_3668)) {

const __wm_bind_1 = removeSmallest_3646(right_3668);
if (!(__wm_is_tuple(__wm_bind_1) && __wm_bind_1.length === 3)) __wm_fail("Bind", "pattern match failure in let binding");
const nextKey_3669 = __wm_bind_1[0];
const nextValue_3670 = __wm_bind_1[1];
const remainingRight_3671 = __wm_bind_1[2];
return balance_3605(node_3565__wm_d4(nextKey_3669, nextValue_3670, left_3667, remainingRight_3671));
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
};
const removeTree_3660 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return removeTree_3660__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const remove_3676__wm_d2 = (map_3672, key_3673) => {
const __wm_scalar_17_0 = map_3672;
const __wm_scalar_17_1 = key_3673;
if (__wm_scalar_17_0?.ctor === 5 && __wm_scalar_17_0.args.length === 1 && __wm_is_tuple(__wm_scalar_17_0.args[0]) && __wm_scalar_17_0.args[0].length === 2 && __wm_eq(__wm_scalar_17_1, key_3673)) {
const compare_3674 = __wm_scalar_17_0.args[0][0];
const tree_3675 = __wm_scalar_17_0.args[0][1];
return MapValue_ctor_5([compare_3674, removeTree_3660__wm_d3(tree_3675, key_3673, compare_3674)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const remove_3676 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return remove_3676__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const update_3681__wm_d3 = (map_3677, key_3678, transform_3679) => {
const __wm_return_value_11 = transform_3679(get_3621__wm_d2(map_3677, key_3678));
if (__wm_return_value_11?.ctor === -2 && __wm_return_value_11.args.length === 1) {
const value_3680 = __wm_return_value_11.args[0];
return set_3641__wm_d3(map_3677, key_3678, value_3680);
} else if (__wm_return_value_11 === __wm_basis_None) {

return remove_3676__wm_d2(map_3677, key_3678);
}
__wm_fail("Match", "non-exhaustive match");
};
const update_3681 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return update_3681__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const foldTree_3682__wm_d3 = (tree_3683, initial_3684, combine_3685) => {
__wm_tail_8: while (true) {
{
const __wm_scalar_18_0 = tree_3683;
const __wm_scalar_18_1 = initial_3684;
const __wm_scalar_18_2 = combine_3685;
if (__wm_scalar_18_0 === MapEmpty_ctor_3 && __wm_eq(__wm_scalar_18_1, initial_3684)) {

return initial_3684;
} else if (__wm_scalar_18_0?.ctor === 4 && __wm_scalar_18_0.args.length === 1 && __wm_is_tuple(__wm_scalar_18_0.args[0]) && __wm_scalar_18_0.args[0].length === 5 && __wm_eq(__wm_scalar_18_1, initial_3684) && __wm_eq(__wm_scalar_18_2, combine_3685)) {
const _height_3686 = __wm_scalar_18_0.args[0][0];
const key_3687 = __wm_scalar_18_0.args[0][1];
const value_3688 = __wm_scalar_18_0.args[0][2];
const left_3689 = __wm_scalar_18_0.args[0][3];
const right_3690 = __wm_scalar_18_0.args[0][4];
{
const afterLeft_3691 = foldTree_3682__wm_d3(left_3689, initial_3684, combine_3685);
{
const __wm_tail_arg_10_0 = right_3690;
const __wm_tail_arg_10_1 = combine_3685([afterLeft_3691, key_3687, value_3688]);
const __wm_tail_arg_10_2 = combine_3685;
tree_3683 = __wm_tail_arg_10_0;
initial_3684 = __wm_tail_arg_10_1;
combine_3685 = __wm_tail_arg_10_2;
continue __wm_tail_8;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const foldTree_3682 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldTree_3682__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const fold_3697__wm_d3 = (map_3692, initial_3693, combine_3694) => {
const __wm_scalar_19_0 = map_3692;
const __wm_scalar_19_1 = initial_3693;
const __wm_scalar_19_2 = combine_3694;
if (__wm_scalar_19_0?.ctor === 5 && __wm_scalar_19_0.args.length === 1 && __wm_is_tuple(__wm_scalar_19_0.args[0]) && __wm_scalar_19_0.args[0].length === 2 && __wm_eq(__wm_scalar_19_1, initial_3693) && __wm_eq(__wm_scalar_19_2, combine_3694)) {
const _compare_3695 = __wm_scalar_19_0.args[0][0];
const tree_3696 = __wm_scalar_19_0.args[0][1];
return foldTree_3682__wm_d3(tree_3696, initial_3693, combine_3694);
}
__wm_fail("Match", "non-exhaustive match");
};
const fold_3697 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return fold_3697__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const toListTree_3698__wm_d2 = (tree_3699, tail_3700) => {
__wm_tail_9: while (true) {
{
const __wm_scalar_20_0 = tree_3699;
const __wm_scalar_20_1 = tail_3700;
if (__wm_scalar_20_0 === MapEmpty_ctor_3 && __wm_eq(__wm_scalar_20_1, tail_3700)) {

return tail_3700;
} else if (__wm_scalar_20_0?.ctor === 4 && __wm_scalar_20_0.args.length === 1 && __wm_is_tuple(__wm_scalar_20_0.args[0]) && __wm_scalar_20_0.args[0].length === 5 && __wm_eq(__wm_scalar_20_1, tail_3700)) {
const _height_3701 = __wm_scalar_20_0.args[0][0];
const key_3702 = __wm_scalar_20_0.args[0][1];
const value_3703 = __wm_scalar_20_0.args[0][2];
const left_3704 = __wm_scalar_20_0.args[0][3];
const right_3705 = __wm_scalar_20_0.args[0][4];
{
const __wm_tail_arg_11_0 = left_3704;
const __wm_tail_arg_11_1 = __wm_basis_Cons([[key_3702, value_3703], toListTree_3698__wm_d2(right_3705, tail_3700)]);
tree_3699 = __wm_tail_arg_11_0;
tail_3700 = __wm_tail_arg_11_1;
continue __wm_tail_9;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const toListTree_3698 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return toListTree_3698__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const toList_3709 = (__arg) => {
if (true) {
const map_3706 = __arg;
const __wm_return_value_12 = map_3706;
if (__wm_return_value_12?.ctor === 5 && __wm_return_value_12.args.length === 1 && __wm_is_tuple(__wm_return_value_12.args[0]) && __wm_return_value_12.args[0].length === 2) {
const _compare_3707 = __wm_return_value_12.args[0][0];
const tree_3708 = __wm_return_value_12.args[0][1];
return toListTree_3698__wm_d2(tree_3708, __wm_basis_Nil);
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const debugHeight_3713 = (__arg) => {
if (true) {
const map_3710 = __arg;
const __wm_return_value_13 = map_3710;
if (__wm_return_value_13?.ctor === 5 && __wm_return_value_13.args.length === 1 && __wm_is_tuple(__wm_return_value_13.args[0]) && __wm_return_value_13.args[0].length === 2) {
const _compare_3711 = __wm_return_value_13.args[0][0];
const tree_3712 = __wm_return_value_13.args[0][1];
return height_3557(tree_3712);
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const fromListItems_3714__wm_d2 = (map_3715, items_3716) => {
__wm_tail_10: while (true) {
{
const __wm_scalar_21_0 = map_3715;
const __wm_scalar_21_1 = items_3716;
if (__wm_eq(__wm_scalar_21_0, map_3715) && __wm_scalar_21_1 === __wm_basis_Nil) {

return map_3715;
} else if (__wm_eq(__wm_scalar_21_0, map_3715) && __wm_scalar_21_1?.ctor === -6 && __wm_scalar_21_1.args.length === 1 && __wm_is_tuple(__wm_scalar_21_1.args[0]) && __wm_scalar_21_1.args[0].length === 2 && __wm_is_tuple(__wm_scalar_21_1.args[0][0]) && __wm_scalar_21_1.args[0][0].length === 2) {
const key_3717 = __wm_scalar_21_1.args[0][0][0];
const value_3718 = __wm_scalar_21_1.args[0][0][1];
const rest_3719 = __wm_scalar_21_1.args[0][1];
{
const __wm_tail_arg_12_0 = set_3641__wm_d3(map_3715, key_3717, value_3718);
const __wm_tail_arg_12_1 = rest_3719;
map_3715 = __wm_tail_arg_12_0;
items_3716 = __wm_tail_arg_12_1;
continue __wm_tail_10;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const fromListItems_3714 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return fromListItems_3714__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const fromList_3722__wm_d2 = (compare_3720, items_3721) => {
return fromListItems_3714__wm_d2(empty_3607(compare_3720), items_3721);
};
const fromList_3722 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return fromList_3722__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return { "Less": Less_ctor_0, "Equal": Equal_ctor_1, "Greater": Greater_ctor_2, "MapEmpty": MapEmpty_ctor_3, "MapNode": MapNode_ctor_4, "MapValue": MapValue_ctor_5, "numberCompare": numberCompare_3550, "numberCompare__wm_d2": numberCompare_3550__wm_d2, "height": height_3557, "max": max_3560, "max__wm_d2": max_3560__wm_d2, "node": node_3565, "node__wm_d4": node_3565__wm_d4, "rotateLeft": rotateLeft_3576, "rotateRight": rotateRight_3587, "balance": balance_3605, "empty": empty_3607, "getTree": getTree_3608, "getTree__wm_d3": getTree_3608__wm_d3, "get": get_3621, "get__wm_d2": get_3621__wm_d2, "has": has_3625, "has__wm_d2": has_3625__wm_d2, "setTree": setTree_3626, "setTree__wm_d4": setTree_3626__wm_d4, "set": set_3641, "set__wm_d3": set_3641__wm_d3, "singleton": singleton_3645, "singleton__wm_d3": singleton_3645__wm_d3, "removeSmallest": removeSmallest_3646, "removeTree": removeTree_3660, "removeTree__wm_d3": removeTree_3660__wm_d3, "remove": remove_3676, "remove__wm_d2": remove_3676__wm_d2, "update": update_3681, "update__wm_d3": update_3681__wm_d3, "foldTree": foldTree_3682, "foldTree__wm_d3": foldTree_3682__wm_d3, "fold": fold_3697, "fold__wm_d3": fold_3697__wm_d3, "toListTree": toListTree_3698, "toListTree__wm_d2": toListTree_3698__wm_d2, "toList": toList_3709, "debugHeight": debugHeight_3713, "fromListItems": fromListItems_3714, "fromListItems__wm_d2": fromListItems_3714__wm_d2, "fromList": fromList_3722, "fromList__wm_d2": fromList_3722__wm_d2 };
  },
  (value) => { __wm_std_Map = value; },
);
let __wm_std_Option;
__wm_define_module(
  "__wm_std_Option",
  [],
  async () => {
const map_3726__wm_d2 = (option_3723, f_3724) => {
const __wm_scalar_22_0 = option_3723;
const __wm_scalar_22_1 = f_3724;
if (__wm_scalar_22_0?.ctor === -2 && __wm_scalar_22_0.args.length === 1 && __wm_eq(__wm_scalar_22_1, f_3724)) {
const value_3725 = __wm_scalar_22_0.args[0];
return __wm_basis_Some(f_3724(value_3725));
} else if (__wm_scalar_22_0 === __wm_basis_None) {

return __wm_basis_None;
}
__wm_fail("Match", "non-exhaustive match");
};
const map_3726 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return map_3726__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const andThen_3730__wm_d2 = (option_3727, f_3728) => {
const __wm_scalar_23_0 = option_3727;
const __wm_scalar_23_1 = f_3728;
if (__wm_scalar_23_0?.ctor === -2 && __wm_scalar_23_0.args.length === 1 && __wm_eq(__wm_scalar_23_1, f_3728)) {
const value_3729 = __wm_scalar_23_0.args[0];
return f_3728(value_3729);
} else if (__wm_scalar_23_0 === __wm_basis_None) {

return __wm_basis_None;
}
__wm_fail("Match", "non-exhaustive match");
};
const andThen_3730 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return andThen_3730__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const withDefault_3734__wm_d2 = (option_3731, fallback_3732) => {
const __wm_scalar_24_0 = option_3731;
const __wm_scalar_24_1 = fallback_3732;
if (__wm_scalar_24_0?.ctor === -2 && __wm_scalar_24_0.args.length === 1) {
const value_3733 = __wm_scalar_24_0.args[0];
return value_3733;
} else if (__wm_scalar_24_0 === __wm_basis_None && __wm_eq(__wm_scalar_24_1, fallback_3732)) {

return fallback_3732;
}
__wm_fail("Match", "non-exhaustive match");
};
const withDefault_3734 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return withDefault_3734__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const map2_3740__wm_d3 = (a_3735, b_3736, f_3737) => {
const __wm_scalar_25_0 = a_3735;
const __wm_scalar_25_1 = b_3736;
const __wm_scalar_25_2 = f_3737;
if (__wm_scalar_25_0?.ctor === -2 && __wm_scalar_25_0.args.length === 1 && __wm_scalar_25_1?.ctor === -2 && __wm_scalar_25_1.args.length === 1 && __wm_eq(__wm_scalar_25_2, f_3737)) {
const left_3738 = __wm_scalar_25_0.args[0];
const right_3739 = __wm_scalar_25_1.args[0];
return __wm_basis_Some(f_3737([left_3738, right_3739]));
} else if (__wm_scalar_25_0 === __wm_basis_None) {

return __wm_basis_None;
} else if (__wm_scalar_25_1 === __wm_basis_None) {

return __wm_basis_None;
}
__wm_fail("Match", "non-exhaustive match");
};
const map2_3740 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return map2_3740__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const traverse_3741__wm_d2 = (items_3742, f_3743) => {
const __wm_scalar_26_0 = items_3742;
const __wm_scalar_26_1 = f_3743;
if (__wm_scalar_26_0 === __wm_basis_Nil) {

return __wm_basis_Some(__wm_basis_Nil);
} else if (__wm_scalar_26_0?.ctor === -6 && __wm_scalar_26_0.args.length === 1 && __wm_is_tuple(__wm_scalar_26_0.args[0]) && __wm_scalar_26_0.args[0].length === 2 && __wm_eq(__wm_scalar_26_1, f_3743)) {
const item_3744 = __wm_scalar_26_0.args[0][0];
const rest_3745 = __wm_scalar_26_0.args[0][1];
const __wm_return_value_14 = f_3743(item_3744);
if (__wm_return_value_14 === __wm_basis_None) {

return __wm_basis_None;
} else if (__wm_return_value_14?.ctor === -2 && __wm_return_value_14.args.length === 1) {
const value_3746 = __wm_return_value_14.args[0];
const __wm_return_value_15 = traverse_3741__wm_d2(rest_3745, f_3743);
if (__wm_return_value_15 === __wm_basis_None) {

return __wm_basis_None;
} else if (__wm_return_value_15?.ctor === -2 && __wm_return_value_15.args.length === 1) {
const values_3747 = __wm_return_value_15.args[0];
return __wm_basis_Some(__wm_basis_Cons([value_3746, values_3747]));
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
};
const traverse_3741 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return traverse_3741__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collectList_3750 = (__arg) => {
if (true) {
const items_3748 = __arg;
return traverse_3741__wm_d2(items_3748, (__arg) => {
if (true) {
const item_3749 = __arg;
return item_3749;
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
return { "map": map_3726, "map__wm_d2": map_3726__wm_d2, "andThen": andThen_3730, "andThen__wm_d2": andThen_3730__wm_d2, "withDefault": withDefault_3734, "withDefault__wm_d2": withDefault_3734__wm_d2, "map2": map2_3740, "map2__wm_d3": map2_3740__wm_d3, "traverse": traverse_3741, "traverse__wm_d2": traverse_3741__wm_d2, "collectList": collectList_3750 };
  },
  (value) => { __wm_std_Option = value; },
);
let __wm_std_Monad;
__wm_define_module(
  "__wm_std_Monad",
  [],
  async () => {
const Carrier_3751 = (__record_args) => ({ fn: __record_args[0], fnError: __record_args[1], succeed: __record_args[2], map: __record_args[3], map2: __record_args[4], andThen: __record_args[5], mapErr: __record_args[6] });
const Applicative_3752 = (__record_args) => ({ succeed: __record_args[0], map: __record_args[1], map2: __record_args[2] });
const via_3755 = (__arg) => {
if (true) {
const domain_3753 = __arg;
return (__arg) => {
if (true) {
const f_3754 = __arg;
return domain_3753.fn(f_3754);
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const viaError_3759 = (__arg) => {
if (true) {
const domain_3756 = __arg;
return (__arg) => {
if (true) {
const inject_3757 = __arg;
return (__arg) => {
if (true) {
const f_3758 = __arg;
return domain_3756.fnError(inject_3757)(f_3758);
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const map_3763 = (__arg) => {
if (true) {
const domain_3760 = __arg;
return (__arg) => {
if (true) {
const transform_3761 = __arg;
return (__arg) => {
if (true) {
const wrapped_3762 = __arg;
return domain_3760.map([wrapped_3762, transform_3761]);
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const mapErr_3767 = (__arg) => {
if (true) {
const domain_3764 = __arg;
return (__arg) => {
if (true) {
const transform_3765 = __arg;
return (__arg) => {
if (true) {
const wrapped_3766 = __arg;
return domain_3764.mapErr([wrapped_3766, transform_3765]);
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
return { "Carrier": Carrier_3751, "Applicative": Applicative_3752, "via": via_3755, "viaError": viaError_3759, "map": map_3763, "mapErr": mapErr_3767 };
  },
  (value) => { __wm_std_Monad = value; },
);
let __wm_std_Result;
__wm_define_module(
  "__wm_std_Result",
  ["__wm_std_Monad"],
  async () => {
const Carrier_3751 = __wm_std_Monad["Carrier"];
const succeed_3769 = (__arg) => {
if (true) {
const value_3768 = __arg;
return __wm_basis_Ok(value_3768);
}
__wm_fail("Match", "pattern match failure in function");
};
const map_3774__wm_d2 = (result_3770, f_3771) => {
const __wm_scalar_27_0 = result_3770;
const __wm_scalar_27_1 = f_3771;
if (__wm_scalar_27_0?.ctor === -3 && __wm_scalar_27_0.args.length === 1 && __wm_eq(__wm_scalar_27_1, f_3771)) {
const value_3772 = __wm_scalar_27_0.args[0];
return __wm_basis_Ok(f_3771(value_3772));
} else if (__wm_scalar_27_0?.ctor === -4 && __wm_scalar_27_0.args.length === 1) {
const error_3773 = __wm_scalar_27_0.args[0];
return __wm_basis_Err(error_3773);
}
__wm_fail("Match", "non-exhaustive match");
};
const map_3774 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return map_3774__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const andThen_3779__wm_d2 = (result_3775, f_3776) => {
const __wm_scalar_28_0 = result_3775;
const __wm_scalar_28_1 = f_3776;
if (__wm_scalar_28_0?.ctor === -3 && __wm_scalar_28_0.args.length === 1 && __wm_eq(__wm_scalar_28_1, f_3776)) {
const value_3777 = __wm_scalar_28_0.args[0];
return f_3776(value_3777);
} else if (__wm_scalar_28_0?.ctor === -4 && __wm_scalar_28_0.args.length === 1) {
const error_3778 = __wm_scalar_28_0.args[0];
return __wm_basis_Err(error_3778);
}
__wm_fail("Match", "non-exhaustive match");
};
const andThen_3779 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return andThen_3779__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const toBool_3783 = (__arg) => {
if (true) {
const r_3780 = __arg;
const __wm_return_value_16 = r_3780;
if (__wm_return_value_16?.ctor === -3 && __wm_return_value_16.args.length === 1) {
const v_3781 = __wm_return_value_16.args[0];
const __wm_return_value_17 = v_3781;
if (__wm_return_value_17 === true) {

return true;
} else if (__wm_return_value_17 === false) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_16?.ctor === -4 && __wm_return_value_16.args.length === 1) {
const __3782 = __wm_return_value_16.args[0];
return false;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const fn_3786 = (__arg) => {
if (true) {
const f_3784 = __arg;
return (__arg) => {
if (true) {
const result_3785 = __arg;
return andThen_3779__wm_d2(result_3785, f_3784);
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const mapErr_3791__wm_d2 = (result_3787, f_3788) => {
const __wm_scalar_29_0 = result_3787;
const __wm_scalar_29_1 = f_3788;
if (__wm_scalar_29_0?.ctor === -3 && __wm_scalar_29_0.args.length === 1) {
const value_3789 = __wm_scalar_29_0.args[0];
return __wm_basis_Ok(value_3789);
} else if (__wm_scalar_29_0?.ctor === -4 && __wm_scalar_29_0.args.length === 1 && __wm_eq(__wm_scalar_29_1, f_3788)) {
const error_3790 = __wm_scalar_29_0.args[0];
return __wm_basis_Err(f_3788(error_3790));
}
__wm_fail("Match", "non-exhaustive match");
};
const mapErr_3791 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return mapErr_3791__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const fnError_3795 = (__arg) => {
if (true) {
const inject_3792 = __arg;
return (__arg) => {
if (true) {
const f_3793 = __arg;
return fn_3786((__arg) => {
if (true) {
const value_3794 = __arg;
return mapErr_3791__wm_d2(f_3793(value_3794), inject_3792);
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const map2_3803__wm_d3 = (a_3796, b_3797, f_3798) => {
const __wm_scalar_30_0 = a_3796;
const __wm_scalar_30_1 = b_3797;
const __wm_scalar_30_2 = f_3798;
if (__wm_scalar_30_0?.ctor === -3 && __wm_scalar_30_0.args.length === 1 && __wm_scalar_30_1?.ctor === -3 && __wm_scalar_30_1.args.length === 1 && __wm_eq(__wm_scalar_30_2, f_3798)) {
const left_3799 = __wm_scalar_30_0.args[0];
const right_3800 = __wm_scalar_30_1.args[0];
return __wm_basis_Ok(f_3798([left_3799, right_3800]));
} else if (__wm_scalar_30_0?.ctor === -4 && __wm_scalar_30_0.args.length === 1) {
const error_3801 = __wm_scalar_30_0.args[0];
return __wm_basis_Err(error_3801);
} else if (__wm_scalar_30_1?.ctor === -4 && __wm_scalar_30_1.args.length === 1) {
const error_3802 = __wm_scalar_30_1.args[0];
return __wm_basis_Err(error_3802);
}
__wm_fail("Match", "non-exhaustive match");
};
const map2_3803 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return map2_3803__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const carrier_3804 = { fn: fn_3786, fnError: fnError_3795, succeed: succeed_3769, map: map_3774, mapErr: mapErr_3791, map2: map2_3803, andThen: andThen_3779 };
const withDefault_3809__wm_d2 = (result_3805, fallback_3806) => {
const __wm_scalar_31_0 = result_3805;
const __wm_scalar_31_1 = fallback_3806;
if (__wm_scalar_31_0?.ctor === -3 && __wm_scalar_31_0.args.length === 1) {
const value_3807 = __wm_scalar_31_0.args[0];
return value_3807;
} else if (__wm_scalar_31_0?.ctor === -4 && __wm_scalar_31_0.args.length === 1 && __wm_eq(__wm_scalar_31_1, fallback_3806)) {
const __3808 = __wm_scalar_31_0.args[0];
return fallback_3806;
}
__wm_fail("Match", "non-exhaustive match");
};
const withDefault_3809 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return withDefault_3809__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const debug_3813 = (__arg) => {
if (true) {
const result_3810 = __arg;
const __wm_return_value_18 = result_3810;
if (__wm_return_value_18?.ctor === -3 && __wm_return_value_18.args.length === 1) {
const value_3811 = __wm_return_value_18.args[0];
return value_3811;
} else if (__wm_return_value_18?.ctor === -4 && __wm_return_value_18.args.length === 1) {
const error_3812 = __wm_return_value_18.args[0];
print(Debug.errorMessage(error_3812));
return __wm_fail("TypedHole", "error[type.typed-hole std/result.wm:71:4]: typed hole; expected type: 'a\n71|     ?\n        ^");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const map3_3824__wm_d4 = (a_3814, b_3815, c_3816, f_3817) => {
const __wm_scalar_32_0 = a_3814;
const __wm_scalar_32_1 = b_3815;
const __wm_scalar_32_2 = c_3816;
const __wm_scalar_32_3 = f_3817;
if (__wm_scalar_32_0?.ctor === -3 && __wm_scalar_32_0.args.length === 1 && __wm_scalar_32_1?.ctor === -3 && __wm_scalar_32_1.args.length === 1 && __wm_scalar_32_2?.ctor === -3 && __wm_scalar_32_2.args.length === 1 && __wm_eq(__wm_scalar_32_3, f_3817)) {
const av_3818 = __wm_scalar_32_0.args[0];
const bv_3819 = __wm_scalar_32_1.args[0];
const cv_3820 = __wm_scalar_32_2.args[0];
return __wm_basis_Ok(f_3817([av_3818, bv_3819, cv_3820]));
} else if (__wm_scalar_32_0?.ctor === -4 && __wm_scalar_32_0.args.length === 1) {
const error_3821 = __wm_scalar_32_0.args[0];
return __wm_basis_Err(error_3821);
} else if (__wm_scalar_32_1?.ctor === -4 && __wm_scalar_32_1.args.length === 1) {
const error_3822 = __wm_scalar_32_1.args[0];
return __wm_basis_Err(error_3822);
} else if (__wm_scalar_32_2?.ctor === -4 && __wm_scalar_32_2.args.length === 1) {
const error_3823 = __wm_scalar_32_2.args[0];
return __wm_basis_Err(error_3823);
}
__wm_fail("Match", "non-exhaustive match");
};
const map3_3824 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return map3_3824__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const map4_3838__wm_d5 = (a_3825, b_3826, c_3827, d_3828, f_3829) => {
const __wm_scalar_33_0 = a_3825;
const __wm_scalar_33_1 = b_3826;
const __wm_scalar_33_2 = c_3827;
const __wm_scalar_33_3 = d_3828;
const __wm_scalar_33_4 = f_3829;
if (__wm_scalar_33_0?.ctor === -3 && __wm_scalar_33_0.args.length === 1 && __wm_scalar_33_1?.ctor === -3 && __wm_scalar_33_1.args.length === 1 && __wm_scalar_33_2?.ctor === -3 && __wm_scalar_33_2.args.length === 1 && __wm_scalar_33_3?.ctor === -3 && __wm_scalar_33_3.args.length === 1 && __wm_eq(__wm_scalar_33_4, f_3829)) {
const av_3830 = __wm_scalar_33_0.args[0];
const bv_3831 = __wm_scalar_33_1.args[0];
const cv_3832 = __wm_scalar_33_2.args[0];
const dv_3833 = __wm_scalar_33_3.args[0];
return __wm_basis_Ok(f_3829([av_3830, bv_3831, cv_3832, dv_3833]));
} else if (__wm_scalar_33_0?.ctor === -4 && __wm_scalar_33_0.args.length === 1) {
const error_3834 = __wm_scalar_33_0.args[0];
return __wm_basis_Err(error_3834);
} else if (__wm_scalar_33_1?.ctor === -4 && __wm_scalar_33_1.args.length === 1) {
const error_3835 = __wm_scalar_33_1.args[0];
return __wm_basis_Err(error_3835);
} else if (__wm_scalar_33_2?.ctor === -4 && __wm_scalar_33_2.args.length === 1) {
const error_3836 = __wm_scalar_33_2.args[0];
return __wm_basis_Err(error_3836);
} else if (__wm_scalar_33_3?.ctor === -4 && __wm_scalar_33_3.args.length === 1) {
const error_3837 = __wm_scalar_33_3.args[0];
return __wm_basis_Err(error_3837);
}
__wm_fail("Match", "non-exhaustive match");
};
const map4_3838 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return map4_3838__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const reverseAcc_3839__wm_d2 = (items_3840, acc_3841) => {
__wm_tail_11: while (true) {
{
const __wm_scalar_34_0 = items_3840;
const __wm_scalar_34_1 = acc_3841;
if (__wm_scalar_34_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_34_1, acc_3841)) {

return acc_3841;
} else if (__wm_scalar_34_0?.ctor === -6 && __wm_scalar_34_0.args.length === 1 && __wm_is_tuple(__wm_scalar_34_0.args[0]) && __wm_scalar_34_0.args[0].length === 2 && __wm_eq(__wm_scalar_34_1, acc_3841)) {
const head_3842 = __wm_scalar_34_0.args[0][0];
const rest_3843 = __wm_scalar_34_0.args[0][1];
{
const __wm_tail_arg_13_0 = rest_3843;
const __wm_tail_arg_13_1 = __wm_basis_Cons([head_3842, acc_3841]);
items_3840 = __wm_tail_arg_13_0;
acc_3841 = __wm_tail_arg_13_1;
continue __wm_tail_11;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reverseAcc_3839 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reverseAcc_3839__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const reverse_3845 = (__arg) => {
if (true) {
const items_3844 = __arg;
return reverseAcc_3839__wm_d2(items_3844, __wm_basis_Nil);
}
__wm_fail("Match", "pattern match failure in function");
};
const traverseAcc_3846__wm_d3 = (items_3847, f_3848, acc_3849) => {
__wm_tail_12: while (true) {
{
const __wm_scalar_35_0 = items_3847;
const __wm_scalar_35_1 = f_3848;
const __wm_scalar_35_2 = acc_3849;
if (__wm_scalar_35_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_35_2, acc_3849)) {

return __wm_basis_Ok(reverse_3845(acc_3849));
} else if (__wm_scalar_35_0?.ctor === -6 && __wm_scalar_35_0.args.length === 1 && __wm_is_tuple(__wm_scalar_35_0.args[0]) && __wm_scalar_35_0.args[0].length === 2 && __wm_eq(__wm_scalar_35_1, f_3848) && __wm_eq(__wm_scalar_35_2, acc_3849)) {
const item_3850 = __wm_scalar_35_0.args[0][0];
const rest_3851 = __wm_scalar_35_0.args[0][1];
{
const __wm_tail_value_14 = f_3848(item_3850);
if (__wm_tail_value_14?.ctor === -4 && __wm_tail_value_14.args.length === 1) {
const error_3852 = __wm_tail_value_14.args[0];
return __wm_basis_Err(error_3852);
} else if (__wm_tail_value_14?.ctor === -3 && __wm_tail_value_14.args.length === 1) {
const value_3853 = __wm_tail_value_14.args[0];
{
const __wm_tail_arg_15_0 = rest_3851;
const __wm_tail_arg_15_1 = f_3848;
const __wm_tail_arg_15_2 = __wm_basis_Cons([value_3853, acc_3849]);
items_3847 = __wm_tail_arg_15_0;
f_3848 = __wm_tail_arg_15_1;
acc_3849 = __wm_tail_arg_15_2;
continue __wm_tail_12;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const traverseAcc_3846 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return traverseAcc_3846__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const traverse_3856__wm_d2 = (items_3854, f_3855) => {
return traverseAcc_3846__wm_d3(items_3854, f_3855, __wm_basis_Nil);
};
const traverse_3856 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return traverse_3856__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const all_3859 = (__arg) => {
if (true) {
const items_3857 = __arg;
return map_3774__wm_d2(traverse_3856__wm_d2(Js.Array.toList(items_3857), (__arg) => {
if (true) {
const item_3858 = __arg;
return item_3858;
}
__wm_fail("Match", "pattern match failure in function");
}), Js.Array.fromList);
}
__wm_fail("Match", "pattern match failure in function");
};
const collectList_3862 = (__arg) => {
if (true) {
const items_3860 = __arg;
return traverse_3856__wm_d2(items_3860, (__arg) => {
if (true) {
const item_3861 = __arg;
return item_3861;
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
return { "succeed": succeed_3769, "map": map_3774, "map__wm_d2": map_3774__wm_d2, "andThen": andThen_3779, "andThen__wm_d2": andThen_3779__wm_d2, "toBool": toBool_3783, "fn": fn_3786, "mapErr": mapErr_3791, "mapErr__wm_d2": mapErr_3791__wm_d2, "fnError": fnError_3795, "map2": map2_3803, "map2__wm_d3": map2_3803__wm_d3, "carrier": carrier_3804, "withDefault": withDefault_3809, "withDefault__wm_d2": withDefault_3809__wm_d2, "debug": debug_3813, "map3": map3_3824, "map3__wm_d4": map3_3824__wm_d4, "map4": map4_3838, "map4__wm_d5": map4_3838__wm_d5, "reverseAcc": reverseAcc_3839, "reverseAcc__wm_d2": reverseAcc_3839__wm_d2, "reverse": reverse_3845, "traverseAcc": traverseAcc_3846, "traverseAcc__wm_d3": traverseAcc_3846__wm_d3, "traverse": traverse_3856, "traverse__wm_d2": traverse_3856__wm_d2, "all": all_3859, "collectList": collectList_3862 };
  },
  (value) => { __wm_std_Result = value; },
);
let __wm_std_Task;
__wm_define_module(
  "__wm_std_Task",
  ["__wm_std_Monad"],
  async () => {
const Carrier_3751 = __wm_std_Monad["Carrier"];
const fn_3865 = (__arg) => {
if (true) {
const f_3863 = __arg;
return (__arg) => {
if (true) {
const task_3864 = __arg;
return Task.andThen([task_3864, f_3863]);
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const fnError_3869 = (__arg) => {
if (true) {
const inject_3866 = __arg;
return (__arg) => {
if (true) {
const f_3867 = __arg;
return fn_3865((__arg) => {
if (true) {
const value_3868 = __arg;
return Task.mapErr([f_3867(value_3868), inject_3866]);
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const carrier_3880 = { fn: fn_3865, fnError: fnError_3869, succeed: (__arg) => {
if (true) {
const value_3870 = __arg;
return Task.succeed(value_3870);
}
__wm_fail("Match", "pattern match failure in function");
}, map: (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) {
const task_3871 = __arg[0];
const f_3872 = __arg[1];
return Task.map([task_3871, f_3872]);
}
__wm_fail("Match", "pattern match failure in function");
}, mapErr: (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) {
const task_3873 = __arg[0];
const f_3874 = __arg[1];
return Task.mapErr([task_3873, f_3874]);
}
__wm_fail("Match", "pattern match failure in function");
}, map2: (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) {
const left_3875 = __arg[0];
const right_3876 = __arg[1];
const combine_3877 = __arg[2];
return Task.map2([left_3875, right_3876, combine_3877]);
}
__wm_fail("Match", "pattern match failure in function");
}, andThen: (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) {
const task_3878 = __arg[0];
const f_3879 = __arg[1];
return Task.andThen([task_3878, f_3879]);
}
__wm_fail("Match", "pattern match failure in function");
} };
const fromCallback_3885__wm_d2 = (handle_3881, register_3882) => {
return Task.new((__arg) => {
if (true) {
const finish_3883 = __arg;
return register_3882((__arg) => {
if (true) {
const event_3884 = __arg;
return finish_3883(handle_3881(event_3884));
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
});
};
const fromCallback_3885 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return fromCallback_3885__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collectList_3887 = (__arg) => {
if (true) {
const tasks_3886 = __arg;
return Task.map([Task.all(Js.Array.fromList(tasks_3886)), Js.Array.toList]);
}
__wm_fail("Match", "pattern match failure in function");
};
const traverse_3888__wm_d2 = (items_3889, f_3890) => {
const __wm_scalar_36_0 = items_3889;
const __wm_scalar_36_1 = f_3890;
if (__wm_scalar_36_0 === __wm_basis_Nil) {

return Task.succeed(__wm_basis_Nil);
} else if (__wm_scalar_36_0?.ctor === -6 && __wm_scalar_36_0.args.length === 1 && __wm_is_tuple(__wm_scalar_36_0.args[0]) && __wm_scalar_36_0.args[0].length === 2 && __wm_eq(__wm_scalar_36_1, f_3890)) {
const item_3891 = __wm_scalar_36_0.args[0][0];
const rest_3892 = __wm_scalar_36_0.args[0][1];
return Task.andThen([f_3890(item_3891), (__arg) => {
if (true) {
const value_3893 = __arg;
return Task.map([traverse_3888__wm_d2(rest_3892, f_3890), (__arg) => {
if (true) {
const values_3894 = __arg;
return __wm_basis_Cons([value_3893, values_3894]);
}
__wm_fail("Match", "pattern match failure in function");
}]);
}
__wm_fail("Match", "pattern match failure in function");
}]);
}
__wm_fail("Match", "non-exhaustive match");
};
const traverse_3888 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return traverse_3888__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return { "fn": fn_3865, "fnError": fnError_3869, "carrier": carrier_3880, "fromCallback": fromCallback_3885, "fromCallback__wm_d2": fromCallback_3885__wm_d2, "collectList": collectList_3887, "traverse": traverse_3888, "traverse__wm_d2": traverse_3888__wm_d2 };
  },
  (value) => { __wm_std_Task = value; },
);
let __wm_std_Traverse;
__wm_define_module(
  "__wm_std_Traverse",
  ["__wm_std_Monad"],
  async () => {
const Carrier_3751 = __wm_std_Monad["Carrier"];
const with_3905 = (__arg) => {
if (__arg !== null && typeof __arg === "object") {
const succeed_3895 = __arg.succeed;
const map_3896 = __arg.map;
const andThen_3897 = __arg.andThen;
const traverse_3898__wm_d2 = (items_3899, transform_3900) => {
const __wm_scalar_37_0 = items_3899;
const __wm_scalar_37_1 = transform_3900;
if (__wm_scalar_37_0 === __wm_basis_Nil) {

return succeed_3895(__wm_basis_Nil);
} else if (__wm_scalar_37_0?.ctor === -6 && __wm_scalar_37_0.args.length === 1 && __wm_is_tuple(__wm_scalar_37_0.args[0]) && __wm_scalar_37_0.args[0].length === 2 && __wm_eq(__wm_scalar_37_1, transform_3900)) {
const item_3901 = __wm_scalar_37_0.args[0][0];
const rest_3902 = __wm_scalar_37_0.args[0][1];
return andThen_3897([transform_3900(item_3901), (__arg) => {
if (true) {
const value_3903 = __arg;
return map_3896([traverse_3898__wm_d2(rest_3902, transform_3900), (__arg) => {
if (true) {
const values_3904 = __arg;
return __wm_basis_Cons([value_3903, values_3904]);
}
__wm_fail("Match", "pattern match failure in function");
}]);
}
__wm_fail("Match", "pattern match failure in function");
}]);
}
__wm_fail("Match", "non-exhaustive match");
};
const traverse_3898 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return traverse_3898__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return traverse_3898;
}
__wm_fail("Match", "pattern match failure in function");
};
return { "with": with_3905 };
  },
  (value) => { __wm_std_Traverse = value; },
);
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
__wm_tail_13: while (true) {
{
const __wm_scalar_38_0 = items_68;
const __wm_scalar_38_1 = reversed_69;
if (__wm_scalar_38_0 === __wm_basis_Nil) {
const reversed_70 = __wm_scalar_38_1;
return reversed_70;
} else if (__wm_scalar_38_0?.ctor === -6 && __wm_scalar_38_0.args.length === 1 && __wm_is_tuple(__wm_scalar_38_0.args[0]) && __wm_scalar_38_0.args[0].length === 2) {
const head_71 = __wm_scalar_38_0.args[0][0];
const rest_72 = __wm_scalar_38_0.args[0][1];
const reversed_73 = __wm_scalar_38_1;
{
const __wm_tail_arg_16_0 = rest_72;
const __wm_tail_arg_16_1 = __wm_basis_Cons([head_71, reversed_73]);
items_68 = __wm_tail_arg_16_0;
reversed_69 = __wm_tail_arg_16_1;
continue __wm_tail_13;
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
__wm_tail_14: while (true) {
{
const __wm_scalar_39_0 = types_75;
const __wm_scalar_39_1 = typeNameId_76;
if (__wm_scalar_39_0 === __wm_basis_Nil) {
const typeNameId_77 = __wm_scalar_39_1;
return __wm_fail("Panic", "missing schema-v2 ADT type");
} else if (__wm_scalar_39_0?.ctor === -6 && __wm_scalar_39_0.args.length === 1 && __wm_is_tuple(__wm_scalar_39_0.args[0]) && __wm_scalar_39_0.args[0].length === 2) {
const gpuType_78 = __wm_scalar_39_0.args[0][0];
const rest_79 = __wm_scalar_39_0.args[0][1];
const typeNameId_80 = __wm_scalar_39_1;
if (__wm_op_and_d2(__wm_eq(gpuType_78.kind, "adt"), numberEqual_66__wm_d2(gpuType_78.typeNameId, typeNameId_80))) {
return gpuType_78;
} else {
{
const __wm_tail_arg_17_0 = rest_79;
const __wm_tail_arg_17_1 = typeNameId_80;
types_75 = __wm_tail_arg_17_0;
typeNameId_76 = __wm_tail_arg_17_1;
continue __wm_tail_14;
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
__wm_tail_15: while (true) {
{
const __wm_scalar_40_0 = constructors_82;
const __wm_scalar_40_1 = id_83;
if (__wm_scalar_40_0 === __wm_basis_Nil) {
const id_84 = __wm_scalar_40_1;
return __wm_fail("Panic", "missing schema-v2 constructor");
} else if (__wm_scalar_40_0?.ctor === -6 && __wm_scalar_40_0.args.length === 1 && __wm_is_tuple(__wm_scalar_40_0.args[0]) && __wm_scalar_40_0.args[0].length === 2) {
const constructor_85 = __wm_scalar_40_0.args[0][0];
const rest_86 = __wm_scalar_40_0.args[0][1];
const id_87 = __wm_scalar_40_1;
{
const exact_88 = constructor_85;
if (numberEqual_66__wm_d2(exact_88.id, id_87)) {
return exact_88;
} else {
{
const __wm_tail_arg_18_0 = rest_86;
const __wm_tail_arg_18_1 = id_87;
constructors_82 = __wm_tail_arg_18_0;
id_83 = __wm_tail_arg_18_1;
continue __wm_tail_15;
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
__wm_tail_16: while (true) {
{
const __wm_scalar_41_0 = constructorIds_90;
const __wm_scalar_41_1 = constructors_91;
const __wm_scalar_41_2 = layoutId_92;
const __wm_scalar_41_3 = nextFieldId_93;
const __wm_scalar_41_4 = reversedIds_94;
const __wm_scalar_41_5 = reversedFields_95;
if (__wm_scalar_41_0 === __wm_basis_Nil) {
const constructors_96 = __wm_scalar_41_1;
const layoutId_97 = __wm_scalar_41_2;
const nextFieldId_98 = __wm_scalar_41_3;
const reversedIds_99 = __wm_scalar_41_4;
const reversedFields_100 = __wm_scalar_41_5;
return [reverseInto_67__wm_d2(reversedIds_99, __wm_basis_Nil), nextFieldId_98, reverseInto_67__wm_d2(reversedFields_100, __wm_basis_Nil)];
} else if (__wm_scalar_41_0?.ctor === -6 && __wm_scalar_41_0.args.length === 1 && __wm_is_tuple(__wm_scalar_41_0.args[0]) && __wm_scalar_41_0.args[0].length === 2) {
const constructorId_101 = __wm_scalar_41_0.args[0][0];
const rest_102 = __wm_scalar_41_0.args[0][1];
const constructors_103 = __wm_scalar_41_1;
const layoutId_104 = __wm_scalar_41_2;
const nextFieldId_105 = __wm_scalar_41_3;
const reversedIds_106 = __wm_scalar_41_4;
const reversedFields_107 = __wm_scalar_41_5;
{
const constructor_108 = findConstructor_81__wm_d2(constructors_103, constructorId_101);
if ((constructor_108.payloadTypeId < 0)) {
{
const __wm_tail_arg_19_0 = rest_102;
const __wm_tail_arg_19_1 = constructors_103;
const __wm_tail_arg_19_2 = layoutId_104;
const __wm_tail_arg_19_3 = nextFieldId_105;
const __wm_tail_arg_19_4 = reversedIds_106;
const __wm_tail_arg_19_5 = reversedFields_107;
constructorIds_90 = __wm_tail_arg_19_0;
constructors_91 = __wm_tail_arg_19_1;
layoutId_92 = __wm_tail_arg_19_2;
nextFieldId_93 = __wm_tail_arg_19_3;
reversedIds_94 = __wm_tail_arg_19_4;
reversedFields_95 = __wm_tail_arg_19_5;
continue __wm_tail_16;
}
} else {
{
const field_109 = { id: nextFieldId_105, layoutId: layoutId_104, constructorId: constructor_108.id, tag: constructor_108.tag, typeId: constructor_108.payloadTypeId, spanId: constructor_108.spanId };
{
const __wm_tail_arg_20_0 = rest_102;
const __wm_tail_arg_20_1 = constructors_103;
const __wm_tail_arg_20_2 = layoutId_104;
const __wm_tail_arg_20_3 = (nextFieldId_105 + 1);
const __wm_tail_arg_20_4 = __wm_basis_Cons([field_109.id, reversedIds_106]);
const __wm_tail_arg_20_5 = __wm_basis_Cons([field_109, reversedFields_107]);
constructorIds_90 = __wm_tail_arg_20_0;
constructors_91 = __wm_tail_arg_20_1;
layoutId_92 = __wm_tail_arg_20_2;
nextFieldId_93 = __wm_tail_arg_20_3;
reversedIds_94 = __wm_tail_arg_20_4;
reversedFields_95 = __wm_tail_arg_20_5;
continue __wm_tail_16;
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
__wm_tail_17: while (true) {
{
const __wm_scalar_42_0 = adts_111;
const __wm_scalar_42_1 = types_112;
const __wm_scalar_42_2 = constructors_113;
const __wm_scalar_42_3 = nextLayoutId_114;
const __wm_scalar_42_4 = nextFieldId_115;
const __wm_scalar_42_5 = reversedLayouts_116;
const __wm_scalar_42_6 = reversedFields_117;
if (__wm_scalar_42_0 === __wm_basis_Nil) {
const types_118 = __wm_scalar_42_1;
const constructors_119 = __wm_scalar_42_2;
const nextLayoutId_120 = __wm_scalar_42_3;
const nextFieldId_121 = __wm_scalar_42_4;
const reversedLayouts_122 = __wm_scalar_42_5;
const reversedFields_123 = __wm_scalar_42_6;
return [reverseInto_67__wm_d2(reversedLayouts_122, __wm_basis_Nil), reverseInto_67__wm_d2(reversedFields_123, __wm_basis_Nil)];
} else if (__wm_scalar_42_0?.ctor === -6 && __wm_scalar_42_0.args.length === 1 && __wm_is_tuple(__wm_scalar_42_0.args[0]) && __wm_scalar_42_0.args[0].length === 2) {
const adt_124 = __wm_scalar_42_0.args[0][0];
const rest_125 = __wm_scalar_42_0.args[0][1];
const types_126 = __wm_scalar_42_1;
const constructors_127 = __wm_scalar_42_2;
const nextLayoutId_128 = __wm_scalar_42_3;
const nextFieldId_129 = __wm_scalar_42_4;
const reversedLayouts_130 = __wm_scalar_42_5;
const reversedFields_131 = __wm_scalar_42_6;
{
const gpuType_132 = findAdtType_74__wm_d2(types_126, adt_124.typeNameId);
const __wm_bind_2 = fieldsForConstructors_89__wm_d6(Js.Array.toList(adt_124.constructorIds), constructors_127, nextLayoutId_128, nextFieldId_129, __wm_basis_Nil, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_2) && __wm_bind_2.length === 3)) __wm_fail("Bind", "pattern match failure in let binding");
const fieldIds_133 = __wm_bind_2[0];
const afterFieldId_134 = __wm_bind_2[1];
const fields_135 = __wm_bind_2[2];
const layout_136 = { id: nextLayoutId_128, typeId: gpuType_132.id, typeNameId: adt_124.typeNameId, fieldIds: Js.Array.fromList(fieldIds_133), spanId: adt_124.spanId };
{
const __wm_tail_arg_21_0 = rest_125;
const __wm_tail_arg_21_1 = types_126;
const __wm_tail_arg_21_2 = constructors_127;
const __wm_tail_arg_21_3 = (nextLayoutId_128 + 1);
const __wm_tail_arg_21_4 = afterFieldId_134;
const __wm_tail_arg_21_5 = __wm_basis_Cons([layout_136, reversedLayouts_130]);
const __wm_tail_arg_21_6 = reverseInto_67__wm_d2(fields_135, reversedFields_131);
adts_111 = __wm_tail_arg_21_0;
types_112 = __wm_tail_arg_21_1;
constructors_113 = __wm_tail_arg_21_2;
nextLayoutId_114 = __wm_tail_arg_21_3;
nextFieldId_115 = __wm_tail_arg_21_4;
reversedLayouts_116 = __wm_tail_arg_21_5;
reversedFields_117 = __wm_tail_arg_21_6;
continue __wm_tail_17;
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
const __wm_bind_3 = buildLayouts_110__wm_d7(Js.Array.toList(input_137.adts), Js.Array.toList(input_137.types), Js.Array.toList(input_137.constructors), 0, 0, __wm_basis_Nil, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_3) && __wm_bind_3.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const layouts_138 = __wm_bind_3[0];
const fields_139 = __wm_bind_3[1];
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
__wm_tail_18: while (true) {
{
const __wm_scalar_43_0 = items_148;
const __wm_scalar_43_1 = reversed_149;
if (__wm_scalar_43_0 === __wm_basis_Nil) {
const reversed_150 = __wm_scalar_43_1;
return reversed_150;
} else if (__wm_scalar_43_0?.ctor === -6 && __wm_scalar_43_0.args.length === 1 && __wm_is_tuple(__wm_scalar_43_0.args[0]) && __wm_scalar_43_0.args[0].length === 2) {
const head_151 = __wm_scalar_43_0.args[0][0];
const rest_152 = __wm_scalar_43_0.args[0][1];
const reversed_153 = __wm_scalar_43_1;
{
const __wm_tail_arg_22_0 = rest_152;
const __wm_tail_arg_22_1 = __wm_basis_Cons([head_151, reversed_153]);
items_148 = __wm_tail_arg_22_0;
reversed_149 = __wm_tail_arg_22_1;
continue __wm_tail_18;
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
const __wm_scalar_44_0 = left_155;
const __wm_scalar_44_1 = right_156;
if (__wm_scalar_44_0 === __wm_basis_Nil) {
const right_157 = __wm_scalar_44_1;
return right_157;
} else if (__wm_scalar_44_0?.ctor === -6 && __wm_scalar_44_0.args.length === 1 && __wm_is_tuple(__wm_scalar_44_0.args[0]) && __wm_scalar_44_0.args[0].length === 2) {
const head_158 = __wm_scalar_44_0.args[0][0];
const rest_159 = __wm_scalar_44_0.args[0][1];
const right_160 = __wm_scalar_44_1;
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
__wm_tail_19: while (true) {
{
const __wm_scalar_45_0 = items_164;
const __wm_scalar_45_1 = id_165;
if (__wm_scalar_45_0 === __wm_basis_Nil) {
const id_166 = __wm_scalar_45_1;
return __wm_fail("Panic", "missing schema-v2 IR function");
} else if (__wm_scalar_45_0?.ctor === -6 && __wm_scalar_45_0.args.length === 1 && __wm_is_tuple(__wm_scalar_45_0.args[0]) && __wm_scalar_45_0.args[0].length === 2) {
const item_167 = __wm_scalar_45_0.args[0][0];
const rest_168 = __wm_scalar_45_0.args[0][1];
const id_169 = __wm_scalar_45_1;
{
const exact_170 = item_167;
if (numberEqual_146__wm_d2(exact_170.functionId, id_169)) {
return exact_170;
} else {
{
const __wm_tail_arg_23_0 = rest_168;
const __wm_tail_arg_23_1 = id_169;
items_164 = __wm_tail_arg_23_0;
id_165 = __wm_tail_arg_23_1;
continue __wm_tail_19;
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
__wm_tail_20: while (true) {
{
const __wm_scalar_46_0 = items_172;
const __wm_scalar_46_1 = id_173;
if (__wm_scalar_46_0 === __wm_basis_Nil) {
const id_174 = __wm_scalar_46_1;
return __wm_fail("Panic", "missing schema-v2 IR expression");
} else if (__wm_scalar_46_0?.ctor === -6 && __wm_scalar_46_0.args.length === 1 && __wm_is_tuple(__wm_scalar_46_0.args[0]) && __wm_scalar_46_0.args[0].length === 2) {
const item_175 = __wm_scalar_46_0.args[0][0];
const rest_176 = __wm_scalar_46_0.args[0][1];
const id_177 = __wm_scalar_46_1;
{
const exact_178 = item_175;
if (numberEqual_146__wm_d2(exact_178.id, id_177)) {
return exact_178;
} else {
{
const __wm_tail_arg_24_0 = rest_176;
const __wm_tail_arg_24_1 = id_177;
items_172 = __wm_tail_arg_24_0;
id_173 = __wm_tail_arg_24_1;
continue __wm_tail_20;
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
__wm_tail_21: while (true) {
{
const __wm_scalar_47_0 = items_180;
const __wm_scalar_47_1 = id_181;
if (__wm_scalar_47_0 === __wm_basis_Nil) {
const id_182 = __wm_scalar_47_1;
return __wm_fail("Panic", "missing schema-v2 IR match arm");
} else if (__wm_scalar_47_0?.ctor === -6 && __wm_scalar_47_0.args.length === 1 && __wm_is_tuple(__wm_scalar_47_0.args[0]) && __wm_scalar_47_0.args[0].length === 2) {
const item_183 = __wm_scalar_47_0.args[0][0];
const rest_184 = __wm_scalar_47_0.args[0][1];
const id_185 = __wm_scalar_47_1;
{
const exact_186 = item_183;
if (numberEqual_146__wm_d2(exact_186.id, id_185)) {
return exact_186;
} else {
{
const __wm_tail_arg_25_0 = rest_184;
const __wm_tail_arg_25_1 = id_185;
items_180 = __wm_tail_arg_25_0;
id_181 = __wm_tail_arg_25_1;
continue __wm_tail_21;
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
__wm_tail_22: while (true) {
{
const __wm_scalar_48_0 = items_188;
const __wm_scalar_48_1 = id_189;
if (__wm_scalar_48_0 === __wm_basis_Nil) {
const id_190 = __wm_scalar_48_1;
return __wm_fail("Panic", "missing lowered atom");
} else if (__wm_scalar_48_0?.ctor === -6 && __wm_scalar_48_0.args.length === 1 && __wm_is_tuple(__wm_scalar_48_0.args[0]) && __wm_scalar_48_0.args[0].length === 2) {
const item_191 = __wm_scalar_48_0.args[0][0];
const rest_192 = __wm_scalar_48_0.args[0][1];
const id_193 = __wm_scalar_48_1;
{
const exact_194 = item_191;
if (numberEqual_146__wm_d2(exact_194.id, id_193)) {
return exact_194;
} else {
{
const __wm_tail_arg_26_0 = rest_192;
const __wm_tail_arg_26_1 = id_193;
items_188 = __wm_tail_arg_26_0;
id_189 = __wm_tail_arg_26_1;
continue __wm_tail_22;
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
__wm_tail_23: while (true) {
{
const __wm_scalar_49_0 = items_196;
const __wm_scalar_49_1 = id_197;
if (__wm_scalar_49_0 === __wm_basis_Nil) {
const id_198 = __wm_scalar_49_1;
return __wm_fail("Panic", "missing schema-v2 parameter");
} else if (__wm_scalar_49_0?.ctor === -6 && __wm_scalar_49_0.args.length === 1 && __wm_is_tuple(__wm_scalar_49_0.args[0]) && __wm_scalar_49_0.args[0].length === 2) {
const item_199 = __wm_scalar_49_0.args[0][0];
const rest_200 = __wm_scalar_49_0.args[0][1];
const id_201 = __wm_scalar_49_1;
{
const exact_202 = item_199;
if (numberEqual_146__wm_d2(exact_202.id, id_201)) {
return exact_202;
} else {
{
const __wm_tail_arg_27_0 = rest_200;
const __wm_tail_arg_27_1 = id_201;
items_196 = __wm_tail_arg_27_0;
id_197 = __wm_tail_arg_27_1;
continue __wm_tail_23;
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
__wm_tail_24: while (true) {
{
const __wm_scalar_50_0 = items_204;
const __wm_scalar_50_1 = id_205;
if (__wm_scalar_50_0 === __wm_basis_Nil) {
const id_206 = __wm_scalar_50_1;
return __wm_fail("Panic", "missing schema-v2 pattern");
} else if (__wm_scalar_50_0?.ctor === -6 && __wm_scalar_50_0.args.length === 1 && __wm_is_tuple(__wm_scalar_50_0.args[0]) && __wm_scalar_50_0.args[0].length === 2) {
const item_207 = __wm_scalar_50_0.args[0][0];
const rest_208 = __wm_scalar_50_0.args[0][1];
const id_209 = __wm_scalar_50_1;
{
const exact_210 = item_207;
if (numberEqual_146__wm_d2(exact_210.id, id_209)) {
return exact_210;
} else {
{
const __wm_tail_arg_28_0 = rest_208;
const __wm_tail_arg_28_1 = id_209;
items_204 = __wm_tail_arg_28_0;
id_205 = __wm_tail_arg_28_1;
continue __wm_tail_24;
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
__wm_tail_25: while (true) {
{
const __wm_scalar_51_0 = items_212;
const __wm_scalar_51_1 = id_213;
if (__wm_scalar_51_0 === __wm_basis_Nil) {
const id_214 = __wm_scalar_51_1;
return __wm_fail("Panic", "missing schema-v2 constructor");
} else if (__wm_scalar_51_0?.ctor === -6 && __wm_scalar_51_0.args.length === 1 && __wm_is_tuple(__wm_scalar_51_0.args[0]) && __wm_scalar_51_0.args[0].length === 2) {
const item_215 = __wm_scalar_51_0.args[0][0];
const rest_216 = __wm_scalar_51_0.args[0][1];
const id_217 = __wm_scalar_51_1;
{
const exact_218 = item_215;
if (numberEqual_146__wm_d2(exact_218.id, id_217)) {
return exact_218;
} else {
{
const __wm_tail_arg_29_0 = rest_216;
const __wm_tail_arg_29_1 = id_217;
items_212 = __wm_tail_arg_29_0;
id_213 = __wm_tail_arg_29_1;
continue __wm_tail_25;
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
__wm_tail_26: while (true) {
{
const __wm_scalar_52_0 = items_220;
const __wm_scalar_52_1 = typeId_221;
if (__wm_scalar_52_0 === __wm_basis_Nil) {
const typeId_222 = __wm_scalar_52_1;
return __wm_fail("Panic", "missing schema-v2 ADT layout");
} else if (__wm_scalar_52_0?.ctor === -6 && __wm_scalar_52_0.args.length === 1 && __wm_is_tuple(__wm_scalar_52_0.args[0]) && __wm_scalar_52_0.args[0].length === 2) {
const item_223 = __wm_scalar_52_0.args[0][0];
const rest_224 = __wm_scalar_52_0.args[0][1];
const typeId_225 = __wm_scalar_52_1;
{
const exact_226 = item_223;
if (numberEqual_146__wm_d2(exact_226.typeId, typeId_225)) {
return exact_226;
} else {
{
const __wm_tail_arg_30_0 = rest_224;
const __wm_tail_arg_30_1 = typeId_225;
items_220 = __wm_tail_arg_30_0;
typeId_221 = __wm_tail_arg_30_1;
continue __wm_tail_26;
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
__wm_tail_27: while (true) {
{
const __wm_scalar_53_0 = layouts_230;
const __wm_scalar_53_1 = fields_231;
const __wm_scalar_53_2 = constructorId_232;
if (__wm_scalar_53_0 === __wm_basis_Nil) {
const fields_233 = __wm_scalar_53_1;
const constructorId_234 = __wm_scalar_53_2;
return __wm_fail("Panic", "missing constructor ADT layout");
} else if (__wm_scalar_53_0?.ctor === -6 && __wm_scalar_53_0.args.length === 1 && __wm_is_tuple(__wm_scalar_53_0.args[0]) && __wm_scalar_53_0.args[0].length === 2) {
const layout_235 = __wm_scalar_53_0.args[0][0];
const rest_236 = __wm_scalar_53_0.args[0][1];
const fields_237 = __wm_scalar_53_1;
const constructorId_238 = __wm_scalar_53_2;
{
const exact_239 = layout_235;
if (layoutContainsConstructor_228__wm_d3(Js.Array.toList(exact_239.fieldIds), fields_237, constructorId_238)) {
return exact_239;
} else {
{
const __wm_tail_arg_31_0 = rest_236;
const __wm_tail_arg_31_1 = fields_237;
const __wm_tail_arg_31_2 = constructorId_238;
layouts_230 = __wm_tail_arg_31_0;
fields_231 = __wm_tail_arg_31_1;
constructorId_232 = __wm_tail_arg_31_2;
continue __wm_tail_27;
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
__wm_tail_28: while (true) {
{
const __wm_scalar_54_0 = fieldIds_240;
const __wm_scalar_54_1 = fields_241;
const __wm_scalar_54_2 = constructorId_242;
if (__wm_scalar_54_0 === __wm_basis_Nil) {
const fields_243 = __wm_scalar_54_1;
const constructorId_244 = __wm_scalar_54_2;
return false;
} else if (__wm_scalar_54_0?.ctor === -6 && __wm_scalar_54_0.args.length === 1 && __wm_is_tuple(__wm_scalar_54_0.args[0]) && __wm_scalar_54_0.args[0].length === 2) {
const fieldId_245 = __wm_scalar_54_0.args[0][0];
const rest_246 = __wm_scalar_54_0.args[0][1];
const fields_247 = __wm_scalar_54_1;
const constructorId_248 = __wm_scalar_54_2;
{
const field_249 = findField_229__wm_d2(fields_247, fieldId_245);
if (numberEqual_146__wm_d2(field_249.constructorId, constructorId_248)) {
return true;
} else {
{
const __wm_tail_arg_32_0 = rest_246;
const __wm_tail_arg_32_1 = fields_247;
const __wm_tail_arg_32_2 = constructorId_248;
fieldIds_240 = __wm_tail_arg_32_0;
fields_241 = __wm_tail_arg_32_1;
constructorId_242 = __wm_tail_arg_32_2;
continue __wm_tail_28;
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
__wm_tail_29: while (true) {
{
const __wm_scalar_55_0 = items_250;
const __wm_scalar_55_1 = id_251;
if (__wm_scalar_55_0 === __wm_basis_Nil) {
const id_252 = __wm_scalar_55_1;
return __wm_fail("Panic", "missing schema-v2 ADT field");
} else if (__wm_scalar_55_0?.ctor === -6 && __wm_scalar_55_0.args.length === 1 && __wm_is_tuple(__wm_scalar_55_0.args[0]) && __wm_scalar_55_0.args[0].length === 2) {
const item_253 = __wm_scalar_55_0.args[0][0];
const rest_254 = __wm_scalar_55_0.args[0][1];
const id_255 = __wm_scalar_55_1;
{
const exact_256 = item_253;
if (numberEqual_146__wm_d2(exact_256.id, id_255)) {
return exact_256;
} else {
{
const __wm_tail_arg_33_0 = rest_254;
const __wm_tail_arg_33_1 = id_255;
items_250 = __wm_tail_arg_33_0;
id_251 = __wm_tail_arg_33_1;
continue __wm_tail_29;
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
__wm_tail_30: while (true) {
{
const __wm_scalar_56_0 = items_258;
const __wm_scalar_56_1 = constructorId_259;
if (__wm_scalar_56_0 === __wm_basis_Nil) {
const constructorId_260 = __wm_scalar_56_1;
return __wm_fail("Panic", "missing constructor payload field");
} else if (__wm_scalar_56_0?.ctor === -6 && __wm_scalar_56_0.args.length === 1 && __wm_is_tuple(__wm_scalar_56_0.args[0]) && __wm_scalar_56_0.args[0].length === 2) {
const item_261 = __wm_scalar_56_0.args[0][0];
const rest_262 = __wm_scalar_56_0.args[0][1];
const constructorId_263 = __wm_scalar_56_1;
{
const exact_264 = item_261;
if (numberEqual_146__wm_d2(exact_264.constructorId, constructorId_263)) {
return exact_264;
} else {
{
const __wm_tail_arg_34_0 = rest_262;
const __wm_tail_arg_34_1 = constructorId_263;
items_258 = __wm_tail_arg_34_0;
constructorId_259 = __wm_tail_arg_34_1;
continue __wm_tail_30;
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
const __wm_return_value_19 = Js.Array.toList(expression_346.children);
if (__wm_return_value_19?.ctor === -6 && __wm_return_value_19.args.length === 1 && __wm_is_tuple(__wm_return_value_19.args[0]) && __wm_return_value_19.args[0].length === 2 && __wm_return_value_19.args[0][1]?.ctor === -6 && __wm_return_value_19.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_19.args[0][1].args[0]) && __wm_return_value_19.args[0][1].args[0].length === 2 && __wm_return_value_19.args[0][1].args[0][1] === __wm_basis_Nil) {
const valueExpressionId_350 = __wm_return_value_19.args[0][0];
const bodyExpressionId_351 = __wm_return_value_19.args[0][1].args[0][0];
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
const __wm_return_value_20 = Js.Array.toList(expression_357.children);
if (__wm_return_value_20?.ctor === -6 && __wm_return_value_20.args.length === 1 && __wm_is_tuple(__wm_return_value_20.args[0]) && __wm_return_value_20.args[0].length === 2 && __wm_return_value_20.args[0][1]?.ctor === -6 && __wm_return_value_20.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_20.args[0][1].args[0]) && __wm_return_value_20.args[0][1].args[0].length === 2 && __wm_return_value_20.args[0][1].args[0][1] === __wm_basis_Nil) {
const discardedExpressionId_361 = __wm_return_value_20.args[0][0];
const bodyExpressionId_362 = __wm_return_value_20.args[0][1].args[0][0];
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
const __wm_bind_4 = pushOperation_297__wm_d2(operation_381, state_380);
if (!(__wm_is_tuple(__wm_bind_4) && __wm_bind_4.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_382 = __wm_bind_4[0];
const afterOperation_383 = __wm_bind_4[1];
const __wm_bind_5 = freshLocal_277__wm_d7(owner_376.functionId, "binding", pattern_374.typeId, pattern_374.bindingId, false, pattern_374.spanId, afterOperation_383);
if (!(__wm_is_tuple(__wm_bind_5) && __wm_bind_5.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_384 = __wm_bind_5[0];
const afterLocal_385 = __wm_bind_5[1];
const statement_386 = { ...baseStatement_313__wm_d5(owner_376.functionId, "let", owner_376.sourceExprId, pattern_374.spanId, afterLocal_385), localId: localId_384, operationId: operationId_382, reason: "binding" };
const __wm_bind_6 = pushStatement_306__wm_d2(statement_386, afterLocal_385);
if (!(__wm_is_tuple(__wm_bind_6) && __wm_bind_6.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_387 = __wm_bind_6[0];
const afterStatement_388 = __wm_bind_6[1];
const nextScope_389 = { ...scope_379, bindings: Map.set([scope_379.bindings, pattern_374.bindingId, localId_384]) };
const result_390 = { statementIds: __wm_basis_Cons([statementId_387, __wm_basis_Nil]), scope: nextScope_389, state: afterStatement_388 };
return result_390;
};
const bindPatternValue_343 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return bindPatternValue_343__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const bindTupleChildren_344__wm_d8 = (childPatternIds_391, atomId_392, owner_393, scope_394, context_395, state_396, index_397, reversedStatements_398) => {
__wm_tail_31: while (true) {
{
const __wm_scalar_57_0 = childPatternIds_391;
const __wm_scalar_57_1 = atomId_392;
const __wm_scalar_57_2 = owner_393;
const __wm_scalar_57_3 = scope_394;
const __wm_scalar_57_4 = context_395;
const __wm_scalar_57_5 = state_396;
const __wm_scalar_57_6 = index_397;
const __wm_scalar_57_7 = reversedStatements_398;
if (__wm_scalar_57_0 === __wm_basis_Nil) {
const atomId_399 = __wm_scalar_57_1;
const owner_400 = __wm_scalar_57_2;
const scope_401 = __wm_scalar_57_3;
const context_402 = __wm_scalar_57_4;
const state_403 = __wm_scalar_57_5;
const index_404 = __wm_scalar_57_6;
const reversedStatements_405 = __wm_scalar_57_7;
{
const result_406 = { statementIds: reverseInto_147__wm_d2(reversedStatements_405, __wm_basis_Nil), scope: scope_401, state: state_403 };
return result_406;
}
} else if (__wm_scalar_57_0?.ctor === -6 && __wm_scalar_57_0.args.length === 1 && __wm_is_tuple(__wm_scalar_57_0.args[0]) && __wm_scalar_57_0.args[0].length === 2) {
const childPatternId_407 = __wm_scalar_57_0.args[0][0];
const rest_408 = __wm_scalar_57_0.args[0][1];
const atomId_409 = __wm_scalar_57_1;
const owner_410 = __wm_scalar_57_2;
const scope_411 = __wm_scalar_57_3;
const context_412 = __wm_scalar_57_4;
const state_413 = __wm_scalar_57_5;
const index_414 = __wm_scalar_57_6;
const reversedStatements_415 = __wm_scalar_57_7;
{
const pattern_416 = findPattern_203__wm_d2(context_412.patterns, childPatternId_407);
if (__wm_eq(pattern_416.kind, "wildcard")) {
{
const __wm_tail_arg_35_0 = rest_408;
const __wm_tail_arg_35_1 = atomId_409;
const __wm_tail_arg_35_2 = owner_410;
const __wm_tail_arg_35_3 = scope_411;
const __wm_tail_arg_35_4 = context_412;
const __wm_tail_arg_35_5 = state_413;
const __wm_tail_arg_35_6 = (index_414 + 1);
const __wm_tail_arg_35_7 = reversedStatements_415;
childPatternIds_391 = __wm_tail_arg_35_0;
atomId_392 = __wm_tail_arg_35_1;
owner_393 = __wm_tail_arg_35_2;
scope_394 = __wm_tail_arg_35_3;
context_395 = __wm_tail_arg_35_4;
state_396 = __wm_tail_arg_35_5;
index_397 = __wm_tail_arg_35_6;
reversedStatements_398 = __wm_tail_arg_35_7;
continue __wm_tail_31;
}
} else {
{
const bound_417 = bindPatternValue_343__wm_d7(pattern_416, atomId_409, owner_410, "project", index_414, scope_411, state_413);
{
const __wm_tail_arg_36_0 = rest_408;
const __wm_tail_arg_36_1 = atomId_409;
const __wm_tail_arg_36_2 = owner_410;
const __wm_tail_arg_36_3 = bound_417.scope;
const __wm_tail_arg_36_4 = context_412;
const __wm_tail_arg_36_5 = bound_417.state;
const __wm_tail_arg_36_6 = (index_414 + 1);
const __wm_tail_arg_36_7 = reverseInto_147__wm_d2(bound_417.statementIds, reversedStatements_415);
childPatternIds_391 = __wm_tail_arg_36_0;
atomId_392 = __wm_tail_arg_36_1;
owner_393 = __wm_tail_arg_36_2;
scope_394 = __wm_tail_arg_36_3;
context_395 = __wm_tail_arg_36_4;
state_396 = __wm_tail_arg_36_5;
index_397 = __wm_tail_arg_36_6;
reversedStatements_398 = __wm_tail_arg_36_7;
continue __wm_tail_31;
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
const __wm_return_value_21 = Js.Array.toList(expression_425.children);
if (__wm_return_value_21?.ctor === -6 && __wm_return_value_21.args.length === 1 && __wm_is_tuple(__wm_return_value_21.args[0]) && __wm_return_value_21.args[0].length === 2 && __wm_return_value_21.args[0][1]?.ctor === -6 && __wm_return_value_21.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_21.args[0][1].args[0]) && __wm_return_value_21.args[0][1].args[0].length === 2 && __wm_return_value_21.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_21.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_21.args[0][1].args[0][1].args[0]) && __wm_return_value_21.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_21.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const conditionExpressionId_429 = __wm_return_value_21.args[0][0];
const thenExpressionId_430 = __wm_return_value_21.args[0][1].args[0][0];
const elseExpressionId_431 = __wm_return_value_21.args[0][1].args[0][1].args[0][0];
const condition_432 = lower_424([conditionExpressionId_429, scope_426, context_427, state_428]);
const __wm_bind_7 = freshLocal_277__wm_d7(expression_425.functionId, "join", expression_425.typeId, __wm_op_sub(1), true, expression_425.spanId, condition_432.state);
if (!(__wm_is_tuple(__wm_bind_7) && __wm_bind_7.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const joinLocalId_433 = __wm_bind_7[0];
const afterJoin_434 = __wm_bind_7[1];
const thenValue_435 = lower_424([thenExpressionId_430, scope_426, context_427, afterJoin_434]);
const __wm_bind_8 = assignJoin_423__wm_d4(expression_425, joinLocalId_433, thenValue_435.atomId, thenValue_435.state);
if (!(__wm_is_tuple(__wm_bind_8) && __wm_bind_8.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const thenAssignId_436 = __wm_bind_8[0];
const afterThenAssign_437 = __wm_bind_8[1];
const __wm_bind_9 = pushBlock_319__wm_d3(expression_425.functionId, append_154__wm_d2(thenValue_435.statementIds, __wm_basis_Cons([thenAssignId_436, __wm_basis_Nil])), afterThenAssign_437);
if (!(__wm_is_tuple(__wm_bind_9) && __wm_bind_9.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const thenBlockId_438 = __wm_bind_9[0];
const afterThenBlock_439 = __wm_bind_9[1];
const elseValue_440 = lower_424([elseExpressionId_431, scope_426, context_427, afterThenBlock_439]);
const __wm_bind_10 = assignJoin_423__wm_d4(expression_425, joinLocalId_433, elseValue_440.atomId, elseValue_440.state);
if (!(__wm_is_tuple(__wm_bind_10) && __wm_bind_10.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const elseAssignId_441 = __wm_bind_10[0];
const afterElseAssign_442 = __wm_bind_10[1];
const __wm_bind_11 = pushBlock_319__wm_d3(expression_425.functionId, append_154__wm_d2(elseValue_440.statementIds, __wm_basis_Cons([elseAssignId_441, __wm_basis_Nil])), afterElseAssign_442);
if (!(__wm_is_tuple(__wm_bind_11) && __wm_bind_11.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const elseBlockId_443 = __wm_bind_11[0];
const afterElseBlock_444 = __wm_bind_11[1];
const statement_445 = { ...baseStatement_313__wm_d5(expression_425.functionId, "if", expression_425.sourceExprId, expression_425.spanId, afterElseBlock_444), localId: joinLocalId_433, conditionAtomId: condition_432.atomId, thenBlockId: thenBlockId_438, elseBlockId: elseBlockId_443, reason: "join" };
const __wm_bind_12 = pushStatement_306__wm_d2(statement_445, afterElseBlock_444);
if (!(__wm_is_tuple(__wm_bind_12) && __wm_bind_12.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_446 = __wm_bind_12[0];
const afterIf_447 = __wm_bind_12[1];
const __wm_bind_13 = localAtom_289__wm_d6(expression_425.functionId, expression_425.typeId, expression_425.sourceExprId, expression_425.spanId, joinLocalId_433, afterIf_447);
if (!(__wm_is_tuple(__wm_bind_13) && __wm_bind_13.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_448 = __wm_bind_13[0];
const afterAtom_449 = __wm_bind_13[1];
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
const __wm_return_value_22 = Js.Array.toList(expression_457.children);
if (__wm_return_value_22?.ctor === -6 && __wm_return_value_22.args.length === 1 && __wm_is_tuple(__wm_return_value_22.args[0]) && __wm_return_value_22.args[0].length === 2 && __wm_return_value_22.args[0][1] === __wm_basis_Nil) {
const scrutineeExpressionId_461 = __wm_return_value_22.args[0][0];
const scrutinee_462 = lower_456([scrutineeExpressionId_461, scope_458, context_459, state_460]);
const scrutineeExpression_463 = findIrExpression_171__wm_d2(context_459.expressions, scrutineeExpressionId_461);
const layout_464 = findLayoutForType_219__wm_d2(context_459.layouts, scrutineeExpression_463.typeId);
const __wm_bind_14 = freshLocal_277__wm_d7(expression_457.functionId, "join", expression_457.typeId, __wm_op_sub(1), true, expression_457.spanId, scrutinee_462.state);
if (!(__wm_is_tuple(__wm_bind_14) && __wm_bind_14.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const joinLocalId_465 = __wm_bind_14[0];
const afterJoin_466 = __wm_bind_14[1];
const cases_467 = lowerMatchValueCases_453__wm_d9(lower_456, Js.Array.toList(expression_457.armIds), expression_457, scrutinee_462.atomId, joinLocalId_465, scope_458, context_459, afterJoin_466, __wm_basis_Nil);
const statement_468 = { ...baseStatement_313__wm_d5(expression_457.functionId, "switch", expression_457.sourceExprId, expression_457.spanId, cases_467.state), localId: joinLocalId_465, scrutineeAtomId: scrutinee_462.atomId, layoutId: layout_464.id, caseIds: Js.Array.fromList(cases_467.caseIds), reason: "join" };
const __wm_bind_15 = pushStatement_306__wm_d2(statement_468, cases_467.state);
if (!(__wm_is_tuple(__wm_bind_15) && __wm_bind_15.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_469 = __wm_bind_15[0];
const afterSwitch_470 = __wm_bind_15[1];
const __wm_bind_16 = localAtom_289__wm_d6(expression_457.functionId, expression_457.typeId, expression_457.sourceExprId, expression_457.spanId, joinLocalId_465, afterSwitch_470);
if (!(__wm_is_tuple(__wm_bind_16) && __wm_bind_16.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_471 = __wm_bind_16[0];
const afterAtom_472 = __wm_bind_16[1];
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
__wm_tail_32: while (true) {
{
const __wm_scalar_58_0 = lower_474;
const __wm_scalar_58_1 = armIds_475;
const __wm_scalar_58_2 = expression_476;
const __wm_scalar_58_3 = scrutineeAtomId_477;
const __wm_scalar_58_4 = joinLocalId_478;
const __wm_scalar_58_5 = scope_479;
const __wm_scalar_58_6 = context_480;
const __wm_scalar_58_7 = state_481;
const __wm_scalar_58_8 = reversedCases_482;
if (__wm_scalar_58_1 === __wm_basis_Nil) {
const lower_483 = __wm_scalar_58_0;
const expression_484 = __wm_scalar_58_2;
const scrutineeAtomId_485 = __wm_scalar_58_3;
const joinLocalId_486 = __wm_scalar_58_4;
const scope_487 = __wm_scalar_58_5;
const context_488 = __wm_scalar_58_6;
const state_489 = __wm_scalar_58_7;
const reversedCases_490 = __wm_scalar_58_8;
{
const result_491 = { caseIds: reverseInto_147__wm_d2(reversedCases_490, __wm_basis_Nil), state: state_489 };
return result_491;
}
} else if (__wm_scalar_58_1?.ctor === -6 && __wm_scalar_58_1.args.length === 1 && __wm_is_tuple(__wm_scalar_58_1.args[0]) && __wm_scalar_58_1.args[0].length === 2) {
const lower_492 = __wm_scalar_58_0;
const armId_493 = __wm_scalar_58_1.args[0][0];
const rest_494 = __wm_scalar_58_1.args[0][1];
const expression_495 = __wm_scalar_58_2;
const scrutineeAtomId_496 = __wm_scalar_58_3;
const joinLocalId_497 = __wm_scalar_58_4;
const scope_498 = __wm_scalar_58_5;
const context_499 = __wm_scalar_58_6;
const state_500 = __wm_scalar_58_7;
const reversedCases_501 = __wm_scalar_58_8;
{
const arm_502 = findIrMatchArm_179__wm_d2(context_499.matchArms, armId_493);
const pattern_503 = findPattern_203__wm_d2(context_499.patterns, arm_502.patternId);
const constructor_504 = findConstructor_211__wm_d2(context_499.constructors, pattern_503.constructorId);
const bound_505 = bindMatchPayload_454__wm_d6(pattern_503, scrutineeAtomId_496, expression_495, scope_498, context_499, state_500);
const body_506 = lower_492([arm_502.bodyExprId, bound_505.scope, context_499, bound_505.state]);
const __wm_bind_17 = assignJoin_423__wm_d4(expression_495, joinLocalId_497, body_506.atomId, body_506.state);
if (!(__wm_is_tuple(__wm_bind_17) && __wm_bind_17.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const assignId_507 = __wm_bind_17[0];
const afterAssign_508 = __wm_bind_17[1];
const __wm_bind_18 = pushBlock_319__wm_d3(expression_495.functionId, append_154__wm_d2(bound_505.statementIds, append_154__wm_d2(body_506.statementIds, __wm_basis_Cons([assignId_507, __wm_basis_Nil]))), afterAssign_508);
if (!(__wm_is_tuple(__wm_bind_18) && __wm_bind_18.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const blockId_509 = __wm_bind_18[0];
const afterBlock_510 = __wm_bind_18[1];
const gpuCase_511 = { id: afterBlock_510.nextCaseId, functionId: expression_495.functionId, constructorId: constructor_504.id, tag: constructor_504.tag, blockId: blockId_509, spanId: arm_502.spanId };
const __wm_bind_19 = pushCase_323__wm_d2(gpuCase_511, afterBlock_510);
if (!(__wm_is_tuple(__wm_bind_19) && __wm_bind_19.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const caseId_512 = __wm_bind_19[0];
const afterCase_513 = __wm_bind_19[1];
{
const __wm_tail_arg_37_0 = lower_492;
const __wm_tail_arg_37_1 = rest_494;
const __wm_tail_arg_37_2 = expression_495;
const __wm_tail_arg_37_3 = scrutineeAtomId_496;
const __wm_tail_arg_37_4 = joinLocalId_497;
const __wm_tail_arg_37_5 = scope_498;
const __wm_tail_arg_37_6 = context_499;
const __wm_tail_arg_37_7 = afterCase_513;
const __wm_tail_arg_37_8 = __wm_basis_Cons([caseId_512, reversedCases_501]);
lower_474 = __wm_tail_arg_37_0;
armIds_475 = __wm_tail_arg_37_1;
expression_476 = __wm_tail_arg_37_2;
scrutineeAtomId_477 = __wm_tail_arg_37_3;
joinLocalId_478 = __wm_tail_arg_37_4;
scope_479 = __wm_tail_arg_37_5;
context_480 = __wm_tail_arg_37_6;
state_481 = __wm_tail_arg_37_7;
reversedCases_482 = __wm_tail_arg_37_8;
continue __wm_tail_32;
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
const __wm_return_value_23 = Js.Array.toList(pattern_514.children);
if (__wm_return_value_23 === __wm_basis_Nil) {

const result_520 = { statementIds: __wm_basis_Nil, scope: scope_517, state: state_519 };
return result_520;
} else if (__wm_return_value_23?.ctor === -6 && __wm_return_value_23.args.length === 1 && __wm_is_tuple(__wm_return_value_23.args[0]) && __wm_return_value_23.args[0].length === 2 && __wm_return_value_23.args[0][1] === __wm_basis_Nil) {
const childPatternId_521 = __wm_return_value_23.args[0][0];
const child_522 = findPattern_203__wm_d2(context_518.patterns, childPatternId_521);
if (__wm_eq(child_522.kind, "wildcard")) {
const result_523 = { statementIds: __wm_basis_Nil, scope: scope_517, state: state_519 };
return result_523;
} else {
const field_524 = findFieldForConstructor_257__wm_d2(context_518.fields, pattern_514.constructorId);
const operation_525 = { ...baseOperation_302__wm_d3(owner_516, "payload", state_519), typeId: child_522.typeId, constructorId: pattern_514.constructorId, layoutId: field_524.layoutId, fieldId: field_524.id, args: Js.Array.fromList(__wm_basis_Cons([scrutineeAtomId_515, __wm_basis_Nil])) };
const __wm_bind_20 = pushOperation_297__wm_d2(operation_525, state_519);
if (!(__wm_is_tuple(__wm_bind_20) && __wm_bind_20.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_526 = __wm_bind_20[0];
const afterOperation_527 = __wm_bind_20[1];
const __wm_bind_21 = freshLocal_277__wm_d7(owner_516.functionId, "binding", child_522.typeId, child_522.bindingId, false, child_522.spanId, afterOperation_527);
if (!(__wm_is_tuple(__wm_bind_21) && __wm_bind_21.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_528 = __wm_bind_21[0];
const afterLocal_529 = __wm_bind_21[1];
const statement_530 = { ...baseStatement_313__wm_d5(owner_516.functionId, "let", owner_516.sourceExprId, child_522.spanId, afterLocal_529), localId: localId_528, operationId: operationId_526, reason: "binding" };
const __wm_bind_22 = pushStatement_306__wm_d2(statement_530, afterLocal_529);
if (!(__wm_is_tuple(__wm_bind_22) && __wm_bind_22.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_531 = __wm_bind_22[0];
const afterStatement_532 = __wm_bind_22[1];
const nextScope_533 = { ...scope_517, bindings: Map.set([scope_517.bindings, child_522.bindingId, localId_528]) };
const result_534 = { statementIds: __wm_basis_Cons([statementId_531, __wm_basis_Nil]), scope: nextScope_533, state: afterStatement_532 };
return result_534;
}
} else if (__wm_return_value_23?.ctor === -6 && __wm_return_value_23.args.length === 1 && __wm_is_tuple(__wm_return_value_23.args[0]) && __wm_return_value_23.args[0].length === 2) {
const firstChildPatternId_535 = __wm_return_value_23.args[0][0];
const restChildPatternIds_536 = __wm_return_value_23.args[0][1];
return bindMatchPayloadLanes_455__wm_d9(__wm_basis_Cons([firstChildPatternId_535, restChildPatternIds_536]), pattern_514, scrutineeAtomId_515, owner_516, scope_517, context_518, state_519, 0, __wm_basis_Nil);
}
__wm_fail("Match", "non-exhaustive match");
};
const bindMatchPayload_454 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return bindMatchPayload_454__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const bindMatchPayloadLanes_455__wm_d9 = (childPatternIds_537, pattern_538, scrutineeAtomId_539, owner_540, scope_541, context_542, state_543, index_544, reversedStatements_545) => {
__wm_tail_33: while (true) {
{
const __wm_scalar_59_0 = childPatternIds_537;
const __wm_scalar_59_1 = pattern_538;
const __wm_scalar_59_2 = scrutineeAtomId_539;
const __wm_scalar_59_3 = owner_540;
const __wm_scalar_59_4 = scope_541;
const __wm_scalar_59_5 = context_542;
const __wm_scalar_59_6 = state_543;
const __wm_scalar_59_7 = index_544;
const __wm_scalar_59_8 = reversedStatements_545;
if (__wm_scalar_59_0 === __wm_basis_Nil) {
const _pattern_546 = __wm_scalar_59_1;
const _scrutineeAtomId_547 = __wm_scalar_59_2;
const _owner_548 = __wm_scalar_59_3;
const scope_549 = __wm_scalar_59_4;
const _context_550 = __wm_scalar_59_5;
const state_551 = __wm_scalar_59_6;
const _index_552 = __wm_scalar_59_7;
const reversedStatements_553 = __wm_scalar_59_8;
{
const result_554 = { statementIds: reverseInto_147__wm_d2(reversedStatements_553, __wm_basis_Nil), scope: scope_549, state: state_551 };
return result_554;
}
} else if (__wm_scalar_59_0?.ctor === -6 && __wm_scalar_59_0.args.length === 1 && __wm_is_tuple(__wm_scalar_59_0.args[0]) && __wm_scalar_59_0.args[0].length === 2) {
const childPatternId_555 = __wm_scalar_59_0.args[0][0];
const rest_556 = __wm_scalar_59_0.args[0][1];
const pattern_557 = __wm_scalar_59_1;
const scrutineeAtomId_558 = __wm_scalar_59_2;
const owner_559 = __wm_scalar_59_3;
const scope_560 = __wm_scalar_59_4;
const context_561 = __wm_scalar_59_5;
const state_562 = __wm_scalar_59_6;
const index_563 = __wm_scalar_59_7;
const reversedStatements_564 = __wm_scalar_59_8;
{
const child_565 = findPattern_203__wm_d2(context_561.patterns, childPatternId_555);
if (__wm_eq(child_565.kind, "wildcard")) {
{
const __wm_tail_arg_38_0 = rest_556;
const __wm_tail_arg_38_1 = pattern_557;
const __wm_tail_arg_38_2 = scrutineeAtomId_558;
const __wm_tail_arg_38_3 = owner_559;
const __wm_tail_arg_38_4 = scope_560;
const __wm_tail_arg_38_5 = context_561;
const __wm_tail_arg_38_6 = state_562;
const __wm_tail_arg_38_7 = (index_563 + 1);
const __wm_tail_arg_38_8 = reversedStatements_564;
childPatternIds_537 = __wm_tail_arg_38_0;
pattern_538 = __wm_tail_arg_38_1;
scrutineeAtomId_539 = __wm_tail_arg_38_2;
owner_540 = __wm_tail_arg_38_3;
scope_541 = __wm_tail_arg_38_4;
context_542 = __wm_tail_arg_38_5;
state_543 = __wm_tail_arg_38_6;
index_544 = __wm_tail_arg_38_7;
reversedStatements_545 = __wm_tail_arg_38_8;
continue __wm_tail_33;
}
} else {
{
const field_566 = findFieldForConstructor_257__wm_d2(context_561.fields, pattern_557.constructorId);
const operation_567 = { ...baseOperation_302__wm_d3(owner_559, "payload", state_562), typeId: child_565.typeId, constructorId: pattern_557.constructorId, layoutId: field_566.layoutId, fieldId: field_566.id, index: index_563, args: Js.Array.fromList(__wm_basis_Cons([scrutineeAtomId_558, __wm_basis_Nil])) };
const __wm_bind_23 = pushOperation_297__wm_d2(operation_567, state_562);
if (!(__wm_is_tuple(__wm_bind_23) && __wm_bind_23.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_568 = __wm_bind_23[0];
const afterOperation_569 = __wm_bind_23[1];
const __wm_bind_24 = freshLocal_277__wm_d7(owner_559.functionId, "binding", child_565.typeId, child_565.bindingId, false, child_565.spanId, afterOperation_569);
if (!(__wm_is_tuple(__wm_bind_24) && __wm_bind_24.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_570 = __wm_bind_24[0];
const afterLocal_571 = __wm_bind_24[1];
const statement_572 = { ...baseStatement_313__wm_d5(owner_559.functionId, "let", owner_559.sourceExprId, child_565.spanId, afterLocal_571), localId: localId_570, operationId: operationId_568, reason: "binding" };
const __wm_bind_25 = pushStatement_306__wm_d2(statement_572, afterLocal_571);
if (!(__wm_is_tuple(__wm_bind_25) && __wm_bind_25.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_573 = __wm_bind_25[0];
const afterStatement_574 = __wm_bind_25[1];
const nextScope_575 = { ...scope_560, bindings: Map.set([scope_560.bindings, child_565.bindingId, localId_570]) };
{
const __wm_tail_arg_39_0 = rest_556;
const __wm_tail_arg_39_1 = pattern_557;
const __wm_tail_arg_39_2 = scrutineeAtomId_558;
const __wm_tail_arg_39_3 = owner_559;
const __wm_tail_arg_39_4 = nextScope_575;
const __wm_tail_arg_39_5 = context_561;
const __wm_tail_arg_39_6 = afterStatement_574;
const __wm_tail_arg_39_7 = (index_563 + 1);
const __wm_tail_arg_39_8 = __wm_basis_Cons([statementId_573, reversedStatements_564]);
childPatternIds_537 = __wm_tail_arg_39_0;
pattern_538 = __wm_tail_arg_39_1;
scrutineeAtomId_539 = __wm_tail_arg_39_2;
owner_540 = __wm_tail_arg_39_3;
scope_541 = __wm_tail_arg_39_4;
context_542 = __wm_tail_arg_39_5;
state_543 = __wm_tail_arg_39_6;
index_544 = __wm_tail_arg_39_7;
reversedStatements_545 = __wm_tail_arg_39_8;
continue __wm_tail_33;
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
const __wm_bind_26 = pushOperation_297__wm_d2(operation_585, state_584);
if (!(__wm_is_tuple(__wm_bind_26) && __wm_bind_26.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_586 = __wm_bind_26[0];
const afterOperation_587 = __wm_bind_26[1];
const __wm_bind_27 = freshLocal_277__wm_d7(expression_578.functionId, localKind_581, expression_578.typeId, __wm_op_sub(1), false, expression_578.spanId, afterOperation_587);
if (!(__wm_is_tuple(__wm_bind_27) && __wm_bind_27.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_588 = __wm_bind_27[0];
const afterLocal_589 = __wm_bind_27[1];
const statement_590 = { ...baseStatement_313__wm_d5(expression_578.functionId, "let", expression_578.sourceExprId, expression_578.spanId, afterLocal_589), localId: localId_588, operationId: operationId_586, reason: reason_582 };
const __wm_bind_28 = pushStatement_306__wm_d2(statement_590, afterLocal_589);
if (!(__wm_is_tuple(__wm_bind_28) && __wm_bind_28.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_591 = __wm_bind_28[0];
const afterStatement_592 = __wm_bind_28[1];
const __wm_bind_29 = localAtom_289__wm_d6(expression_578.functionId, expression_578.typeId, expression_578.sourceExprId, expression_578.spanId, localId_588, afterStatement_592);
if (!(__wm_is_tuple(__wm_bind_29) && __wm_bind_29.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_593 = __wm_bind_29[0];
const afterAtom_594 = __wm_bind_29[1];
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
const __wm_bind_30 = literalAtom_293__wm_d2(expression_609, state_608);
if (!(__wm_is_tuple(__wm_bind_30) && __wm_bind_30.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_610 = __wm_bind_30[0];
const next_611 = __wm_bind_30[1];
const result_612 = { statementIds: __wm_basis_Nil, atomId: atomId_610, state: next_611 };
return result_612;
} else {
if (__wm_eq(expression_609.kind, "local")) {
const __wm_return_value_24 = Map.get([scope_606.bindings, expression_609.bindingId]);
if (__wm_return_value_24?.ctor === -2 && __wm_return_value_24.args.length === 1) {
const localId_613 = __wm_return_value_24.args[0];
const __wm_bind_31 = localAtom_289__wm_d6(expression_609.functionId, expression_609.typeId, expression_609.sourceExprId, expression_609.spanId, localId_613, state_608);
if (!(__wm_is_tuple(__wm_bind_31) && __wm_bind_31.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_614 = __wm_bind_31[0];
const next_615 = __wm_bind_31[1];
const result_616 = { statementIds: __wm_basis_Nil, atomId: atomId_614, state: next_615 };
return result_616;
} else if (__wm_return_value_24 === __wm_basis_None) {

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
__wm_tail_34: while (true) {
{
const __wm_scalar_60_0 = expressionIds_620;
const __wm_scalar_60_1 = scope_621;
const __wm_scalar_60_2 = context_622;
const __wm_scalar_60_3 = state_623;
const __wm_scalar_60_4 = reversedStatements_624;
const __wm_scalar_60_5 = reversedAtoms_625;
if (__wm_scalar_60_0 === __wm_basis_Nil) {
const scope_626 = __wm_scalar_60_1;
const context_627 = __wm_scalar_60_2;
const state_628 = __wm_scalar_60_3;
const reversedStatements_629 = __wm_scalar_60_4;
const reversedAtoms_630 = __wm_scalar_60_5;
{
const result_631 = { statementIds: reverseInto_147__wm_d2(reversedStatements_629, __wm_basis_Nil), atomIds: reverseInto_147__wm_d2(reversedAtoms_630, __wm_basis_Nil), state: state_628 };
return result_631;
}
} else if (__wm_scalar_60_0?.ctor === -6 && __wm_scalar_60_0.args.length === 1 && __wm_is_tuple(__wm_scalar_60_0.args[0]) && __wm_scalar_60_0.args[0].length === 2) {
const expressionId_632 = __wm_scalar_60_0.args[0][0];
const rest_633 = __wm_scalar_60_0.args[0][1];
const scope_634 = __wm_scalar_60_1;
const context_635 = __wm_scalar_60_2;
const state_636 = __wm_scalar_60_3;
const reversedStatements_637 = __wm_scalar_60_4;
const reversedAtoms_638 = __wm_scalar_60_5;
{
const value_639 = lowerValue_603__wm_d4(expressionId_632, scope_634, context_635, state_636);
{
const __wm_tail_arg_40_0 = rest_633;
const __wm_tail_arg_40_1 = scope_634;
const __wm_tail_arg_40_2 = context_635;
const __wm_tail_arg_40_3 = value_639.state;
const __wm_tail_arg_40_4 = reverseInto_147__wm_d2(value_639.statementIds, reversedStatements_637);
const __wm_tail_arg_40_5 = __wm_basis_Cons([value_639.atomId, reversedAtoms_638]);
expressionIds_620 = __wm_tail_arg_40_0;
scope_621 = __wm_tail_arg_40_1;
context_622 = __wm_tail_arg_40_2;
state_623 = __wm_tail_arg_40_3;
reversedStatements_624 = __wm_tail_arg_40_4;
reversedAtoms_625 = __wm_tail_arg_40_5;
continue __wm_tail_34;
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
const __wm_return_value_25 = Js.Array.toList(expression_655.children);
if (__wm_return_value_25?.ctor === -6 && __wm_return_value_25.args.length === 1 && __wm_is_tuple(__wm_return_value_25.args[0]) && __wm_return_value_25.args[0].length === 2 && __wm_return_value_25.args[0][1]?.ctor === -6 && __wm_return_value_25.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_25.args[0][1].args[0]) && __wm_return_value_25.args[0][1].args[0].length === 2 && __wm_return_value_25.args[0][1].args[0][1] === __wm_basis_Nil) {
const valueExpressionId_657 = __wm_return_value_25.args[0][0];
const bodyExpressionId_658 = __wm_return_value_25.args[0][1].args[0][0];
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
const __wm_return_value_26 = Js.Array.toList(expression_655.children);
if (__wm_return_value_26?.ctor === -6 && __wm_return_value_26.args.length === 1 && __wm_is_tuple(__wm_return_value_26.args[0]) && __wm_return_value_26.args[0].length === 2 && __wm_return_value_26.args[0][1]?.ctor === -6 && __wm_return_value_26.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_26.args[0][1].args[0]) && __wm_return_value_26.args[0][1].args[0].length === 2 && __wm_return_value_26.args[0][1].args[0][1] === __wm_basis_Nil) {
const discardedExpressionId_663 = __wm_return_value_26.args[0][0];
const bodyExpressionId_664 = __wm_return_value_26.args[0][1].args[0][0];
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
const __wm_bind_32 = returnStatement_644__wm_d3(expression_655, value_670.atomId, value_670.state);
if (!(__wm_is_tuple(__wm_bind_32) && __wm_bind_32.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const returnId_671 = __wm_bind_32[0];
const afterReturn_672 = __wm_bind_32[1];
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
const __wm_return_value_27 = Js.Array.toList(expression_674.children);
if (__wm_return_value_27?.ctor === -6 && __wm_return_value_27.args.length === 1 && __wm_is_tuple(__wm_return_value_27.args[0]) && __wm_return_value_27.args[0].length === 2 && __wm_return_value_27.args[0][1]?.ctor === -6 && __wm_return_value_27.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_27.args[0][1].args[0]) && __wm_return_value_27.args[0][1].args[0].length === 2 && __wm_return_value_27.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_27.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_27.args[0][1].args[0][1].args[0]) && __wm_return_value_27.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_27.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const conditionExpressionId_678 = __wm_return_value_27.args[0][0];
const thenExpressionId_679 = __wm_return_value_27.args[0][1].args[0][0];
const elseExpressionId_680 = __wm_return_value_27.args[0][1].args[0][1].args[0][0];
const condition_681 = lowerValue_603__wm_d4(conditionExpressionId_678, scope_675, context_676, state_677);
const thenTail_682 = lowerTail_645__wm_d4(thenExpressionId_679, scope_675, context_676, condition_681.state);
const __wm_bind_33 = pushBlock_319__wm_d3(expression_674.functionId, thenTail_682.statementIds, thenTail_682.state);
if (!(__wm_is_tuple(__wm_bind_33) && __wm_bind_33.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const thenBlockId_683 = __wm_bind_33[0];
const afterThen_684 = __wm_bind_33[1];
const elseTail_685 = lowerTail_645__wm_d4(elseExpressionId_680, scope_675, context_676, afterThen_684);
const __wm_bind_34 = pushBlock_319__wm_d3(expression_674.functionId, elseTail_685.statementIds, elseTail_685.state);
if (!(__wm_is_tuple(__wm_bind_34) && __wm_bind_34.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const elseBlockId_686 = __wm_bind_34[0];
const afterElse_687 = __wm_bind_34[1];
const statement_688 = { ...baseStatement_313__wm_d5(expression_674.functionId, "if", expression_674.sourceExprId, expression_674.spanId, afterElse_687), conditionAtomId: condition_681.atomId, thenBlockId: thenBlockId_683, elseBlockId: elseBlockId_686 };
const __wm_bind_35 = pushStatement_306__wm_d2(statement_688, afterElse_687);
if (!(__wm_is_tuple(__wm_bind_35) && __wm_bind_35.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_689 = __wm_bind_35[0];
const afterIf_690 = __wm_bind_35[1];
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
const __wm_return_value_28 = Js.Array.toList(expression_692.children);
if (__wm_return_value_28?.ctor === -6 && __wm_return_value_28.args.length === 1 && __wm_is_tuple(__wm_return_value_28.args[0]) && __wm_return_value_28.args[0].length === 2 && __wm_return_value_28.args[0][1] === __wm_basis_Nil) {
const scrutineeExpressionId_696 = __wm_return_value_28.args[0][0];
const scrutinee_697 = lowerValue_603__wm_d4(scrutineeExpressionId_696, scope_693, context_694, state_695);
const scrutineeExpression_698 = findIrExpression_171__wm_d2(context_694.expressions, scrutineeExpressionId_696);
const layout_699 = findLayoutForType_219__wm_d2(context_694.layouts, scrutineeExpression_698.typeId);
const cases_700 = lowerTailMatchCases_648__wm_d7(Js.Array.toList(expression_692.armIds), expression_692, scrutinee_697.atomId, scope_693, context_694, scrutinee_697.state, __wm_basis_Nil);
const statement_701 = { ...baseStatement_313__wm_d5(expression_692.functionId, "switch", expression_692.sourceExprId, expression_692.spanId, cases_700.state), scrutineeAtomId: scrutinee_697.atomId, layoutId: layout_699.id, caseIds: Js.Array.fromList(cases_700.caseIds) };
const __wm_bind_36 = pushStatement_306__wm_d2(statement_701, cases_700.state);
if (!(__wm_is_tuple(__wm_bind_36) && __wm_bind_36.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_702 = __wm_bind_36[0];
const afterSwitch_703 = __wm_bind_36[1];
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
__wm_tail_35: while (true) {
{
const __wm_scalar_61_0 = armIds_705;
const __wm_scalar_61_1 = expression_706;
const __wm_scalar_61_2 = scrutineeAtomId_707;
const __wm_scalar_61_3 = scope_708;
const __wm_scalar_61_4 = context_709;
const __wm_scalar_61_5 = state_710;
const __wm_scalar_61_6 = reversedCases_711;
if (__wm_scalar_61_0 === __wm_basis_Nil) {
const expression_712 = __wm_scalar_61_1;
const scrutineeAtomId_713 = __wm_scalar_61_2;
const scope_714 = __wm_scalar_61_3;
const context_715 = __wm_scalar_61_4;
const state_716 = __wm_scalar_61_5;
const reversedCases_717 = __wm_scalar_61_6;
{
const result_718 = { caseIds: reverseInto_147__wm_d2(reversedCases_717, __wm_basis_Nil), state: state_716 };
return result_718;
}
} else if (__wm_scalar_61_0?.ctor === -6 && __wm_scalar_61_0.args.length === 1 && __wm_is_tuple(__wm_scalar_61_0.args[0]) && __wm_scalar_61_0.args[0].length === 2) {
const armId_719 = __wm_scalar_61_0.args[0][0];
const rest_720 = __wm_scalar_61_0.args[0][1];
const expression_721 = __wm_scalar_61_1;
const scrutineeAtomId_722 = __wm_scalar_61_2;
const scope_723 = __wm_scalar_61_3;
const context_724 = __wm_scalar_61_4;
const state_725 = __wm_scalar_61_5;
const reversedCases_726 = __wm_scalar_61_6;
{
const arm_727 = findIrMatchArm_179__wm_d2(context_724.matchArms, armId_719);
const pattern_728 = findPattern_203__wm_d2(context_724.patterns, arm_727.patternId);
const constructor_729 = findConstructor_211__wm_d2(context_724.constructors, pattern_728.constructorId);
const bound_730 = bindMatchPayload_454__wm_d6(pattern_728, scrutineeAtomId_722, expression_721, scope_723, context_724, state_725);
const body_731 = lowerTail_645__wm_d4(arm_727.bodyExprId, bound_730.scope, context_724, bound_730.state);
const __wm_bind_37 = pushBlock_319__wm_d3(expression_721.functionId, append_154__wm_d2(bound_730.statementIds, body_731.statementIds), body_731.state);
if (!(__wm_is_tuple(__wm_bind_37) && __wm_bind_37.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const blockId_732 = __wm_bind_37[0];
const afterBlock_733 = __wm_bind_37[1];
const gpuCase_734 = { id: afterBlock_733.nextCaseId, functionId: expression_721.functionId, constructorId: constructor_729.id, tag: constructor_729.tag, blockId: blockId_732, spanId: arm_727.spanId };
const __wm_bind_38 = pushCase_323__wm_d2(gpuCase_734, afterBlock_733);
if (!(__wm_is_tuple(__wm_bind_38) && __wm_bind_38.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const caseId_735 = __wm_bind_38[0];
const afterCase_736 = __wm_bind_38[1];
{
const __wm_tail_arg_41_0 = rest_720;
const __wm_tail_arg_41_1 = expression_721;
const __wm_tail_arg_41_2 = scrutineeAtomId_722;
const __wm_tail_arg_41_3 = scope_723;
const __wm_tail_arg_41_4 = context_724;
const __wm_tail_arg_41_5 = afterCase_736;
const __wm_tail_arg_41_6 = __wm_basis_Cons([caseId_735, reversedCases_726]);
armIds_705 = __wm_tail_arg_41_0;
expression_706 = __wm_tail_arg_41_1;
scrutineeAtomId_707 = __wm_tail_arg_41_2;
scope_708 = __wm_tail_arg_41_3;
context_709 = __wm_tail_arg_41_4;
state_710 = __wm_tail_arg_41_5;
reversedCases_711 = __wm_tail_arg_41_6;
continue __wm_tail_35;
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
const __wm_bind_39 = pushStatement_306__wm_d2(statement_743, nextValues_742.state);
if (!(__wm_is_tuple(__wm_bind_39) && __wm_bind_39.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_744 = __wm_bind_39[0];
const afterContinue_745 = __wm_bind_39[1];
const result_746 = { statementIds: append_154__wm_d2(children_741.statementIds, append_154__wm_d2(nextValues_742.statementIds, __wm_basis_Cons([statementId_744, __wm_basis_Nil]))), state: afterContinue_745 };
return result_746;
};
const lowerTailCall_649 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return lowerTailCall_649__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const materializeTailNext_650__wm_d5 = (atomIds_747, expression_748, state_749, reversedStatements_750, reversedAtoms_751) => {
__wm_tail_36: while (true) {
{
const __wm_scalar_62_0 = atomIds_747;
const __wm_scalar_62_1 = expression_748;
const __wm_scalar_62_2 = state_749;
const __wm_scalar_62_3 = reversedStatements_750;
const __wm_scalar_62_4 = reversedAtoms_751;
if (__wm_scalar_62_0 === __wm_basis_Nil) {
const expression_752 = __wm_scalar_62_1;
const state_753 = __wm_scalar_62_2;
const reversedStatements_754 = __wm_scalar_62_3;
const reversedAtoms_755 = __wm_scalar_62_4;
{
const result_756 = { statementIds: reverseInto_147__wm_d2(reversedStatements_754, __wm_basis_Nil), atomIds: reverseInto_147__wm_d2(reversedAtoms_755, __wm_basis_Nil), state: state_753 };
return result_756;
}
} else if (__wm_scalar_62_0?.ctor === -6 && __wm_scalar_62_0.args.length === 1 && __wm_is_tuple(__wm_scalar_62_0.args[0]) && __wm_scalar_62_0.args[0].length === 2) {
const atomId_757 = __wm_scalar_62_0.args[0][0];
const rest_758 = __wm_scalar_62_0.args[0][1];
const expression_759 = __wm_scalar_62_1;
const state_760 = __wm_scalar_62_2;
const reversedStatements_761 = __wm_scalar_62_3;
const reversedAtoms_762 = __wm_scalar_62_4;
{
const atom_763 = findLoweredAtom_187__wm_d2(state_760.atoms, atomId_757);
const operation_764 = { ...baseOperation_302__wm_d3(expression_759, "copy", state_760), typeId: atom_763.typeId, targetFunctionId: __wm_op_sub(1), args: Js.Array.fromList(__wm_basis_Cons([atomId_757, __wm_basis_Nil])) };
const __wm_bind_40 = pushOperation_297__wm_d2(operation_764, state_760);
if (!(__wm_is_tuple(__wm_bind_40) && __wm_bind_40.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_765 = __wm_bind_40[0];
const afterOperation_766 = __wm_bind_40[1];
const __wm_bind_41 = freshLocal_277__wm_d7(expression_759.functionId, "tail-next", atom_763.typeId, __wm_op_sub(1), false, expression_759.spanId, afterOperation_766);
if (!(__wm_is_tuple(__wm_bind_41) && __wm_bind_41.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_767 = __wm_bind_41[0];
const afterLocal_768 = __wm_bind_41[1];
const statement_769 = { ...baseStatement_313__wm_d5(expression_759.functionId, "let", expression_759.sourceExprId, expression_759.spanId, afterLocal_768), localId: localId_767, operationId: operationId_765, reason: "tail-next" };
const __wm_bind_42 = pushStatement_306__wm_d2(statement_769, afterLocal_768);
if (!(__wm_is_tuple(__wm_bind_42) && __wm_bind_42.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_770 = __wm_bind_42[0];
const afterStatement_771 = __wm_bind_42[1];
const __wm_bind_43 = localAtom_289__wm_d6(expression_759.functionId, atom_763.typeId, expression_759.sourceExprId, expression_759.spanId, localId_767, afterStatement_771);
if (!(__wm_is_tuple(__wm_bind_43) && __wm_bind_43.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextAtomId_772 = __wm_bind_43[0];
const afterAtom_773 = __wm_bind_43[1];
{
const __wm_tail_arg_42_0 = rest_758;
const __wm_tail_arg_42_1 = expression_759;
const __wm_tail_arg_42_2 = afterAtom_773;
const __wm_tail_arg_42_3 = __wm_basis_Cons([statementId_770, reversedStatements_761]);
const __wm_tail_arg_42_4 = __wm_basis_Cons([nextAtomId_772, reversedAtoms_762]);
atomIds_747 = __wm_tail_arg_42_0;
expression_748 = __wm_tail_arg_42_1;
state_749 = __wm_tail_arg_42_2;
reversedStatements_750 = __wm_tail_arg_42_3;
reversedAtoms_751 = __wm_tail_arg_42_4;
continue __wm_tail_36;
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
__wm_tail_37: while (true) {
{
const __wm_scalar_63_0 = paramIds_775;
const __wm_scalar_63_1 = functionId_776;
const __wm_scalar_63_2 = context_777;
const __wm_scalar_63_3 = scope_778;
const __wm_scalar_63_4 = state_779;
const __wm_scalar_63_5 = reversedPhysicalIds_780;
const __wm_scalar_63_6 = reversedStatements_781;
if (__wm_scalar_63_0 === __wm_basis_Nil) {
const functionId_782 = __wm_scalar_63_1;
const context_783 = __wm_scalar_63_2;
const scope_784 = __wm_scalar_63_3;
const state_785 = __wm_scalar_63_4;
const reversedPhysicalIds_786 = __wm_scalar_63_5;
const reversedStatements_787 = __wm_scalar_63_6;
{
const result_788 = { physicalLocalIds: reverseInto_147__wm_d2(reversedPhysicalIds_786, __wm_basis_Nil), activeLocalIds: reverseInto_147__wm_d2(reversedPhysicalIds_786, __wm_basis_Nil), initialStatementIds: reverseInto_147__wm_d2(reversedStatements_787, __wm_basis_Nil), iterationStatementIds: __wm_basis_Nil, scope: scope_784, state: state_785 };
return result_788;
}
} else if (__wm_scalar_63_0?.ctor === -6 && __wm_scalar_63_0.args.length === 1 && __wm_is_tuple(__wm_scalar_63_0.args[0]) && __wm_scalar_63_0.args[0].length === 2) {
const paramId_789 = __wm_scalar_63_0.args[0][0];
const rest_790 = __wm_scalar_63_0.args[0][1];
const functionId_791 = __wm_scalar_63_1;
const context_792 = __wm_scalar_63_2;
const scope_793 = __wm_scalar_63_3;
const state_794 = __wm_scalar_63_4;
const reversedPhysicalIds_795 = __wm_scalar_63_5;
const reversedStatements_796 = __wm_scalar_63_6;
{
const param_797 = findParam_195__wm_d2(context_792.params, paramId_789);
const pattern_798 = findPattern_203__wm_d2(context_792.patterns, param_797.patternId);
const bindingId_799 = (__wm_eq(pattern_798.kind, "binding") ? pattern_798.bindingId : __wm_op_sub(1));
const __wm_bind_44 = freshLocal_277__wm_d7(functionId_791, "parameter", param_797.typeId, bindingId_799, false, param_797.spanId, state_794);
if (!(__wm_is_tuple(__wm_bind_44) && __wm_bind_44.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_800 = __wm_bind_44[0];
const afterLocal_801 = __wm_bind_44[1];
const __wm_bind_45 = localAtom_289__wm_d6(functionId_791, param_797.typeId, __wm_op_sub(1), param_797.spanId, localId_800, afterLocal_801);
if (!(__wm_is_tuple(__wm_bind_45) && __wm_bind_45.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_802 = __wm_bind_45[0];
const afterAtom_803 = __wm_bind_45[1];
if (__wm_eq(pattern_798.kind, "binding")) {
{
const nextScope_804 = { ...scope_793, bindings: Map.set([scope_793.bindings, pattern_798.bindingId, localId_800]) };
{
const __wm_tail_arg_43_0 = rest_790;
const __wm_tail_arg_43_1 = functionId_791;
const __wm_tail_arg_43_2 = context_792;
const __wm_tail_arg_43_3 = nextScope_804;
const __wm_tail_arg_43_4 = afterAtom_803;
const __wm_tail_arg_43_5 = __wm_basis_Cons([localId_800, reversedPhysicalIds_795]);
const __wm_tail_arg_43_6 = reversedStatements_796;
paramIds_775 = __wm_tail_arg_43_0;
functionId_776 = __wm_tail_arg_43_1;
context_777 = __wm_tail_arg_43_2;
scope_778 = __wm_tail_arg_43_3;
state_779 = __wm_tail_arg_43_4;
reversedPhysicalIds_780 = __wm_tail_arg_43_5;
reversedStatements_781 = __wm_tail_arg_43_6;
continue __wm_tail_37;
}
}
} else {
{
const fn_805 = findIrFunction_163__wm_d2(context_792.functions, functionId_791);
const owner_806 = findIrExpression_171__wm_d2(context_792.expressions, fn_805.bodyExprId);
const bound_807 = bindPattern_342__wm_d6(pattern_798.id, atomId_802, owner_806, scope_793, context_792, afterAtom_803);
{
const __wm_tail_arg_44_0 = rest_790;
const __wm_tail_arg_44_1 = functionId_791;
const __wm_tail_arg_44_2 = context_792;
const __wm_tail_arg_44_3 = bound_807.scope;
const __wm_tail_arg_44_4 = bound_807.state;
const __wm_tail_arg_44_5 = __wm_basis_Cons([localId_800, reversedPhysicalIds_795]);
const __wm_tail_arg_44_6 = reverseInto_147__wm_d2(bound_807.statementIds, reversedStatements_796);
paramIds_775 = __wm_tail_arg_44_0;
functionId_776 = __wm_tail_arg_44_1;
context_777 = __wm_tail_arg_44_2;
scope_778 = __wm_tail_arg_44_3;
state_779 = __wm_tail_arg_44_4;
reversedPhysicalIds_780 = __wm_tail_arg_44_5;
reversedStatements_781 = __wm_tail_arg_44_6;
continue __wm_tail_37;
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
const __wm_bind_46 = returnStatement_644__wm_d3(bodyExpression_813, body_812.atomId, body_812.state);
if (!(__wm_is_tuple(__wm_bind_46) && __wm_bind_46.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const returnId_814 = __wm_bind_46[0];
const afterReturn_815 = __wm_bind_46[1];
const __wm_bind_47 = pushBlock_319__wm_d3(fn_808.functionId, append_154__wm_d2(params_811.initialStatementIds, append_154__wm_d2(body_812.statementIds, __wm_basis_Cons([returnId_814, __wm_basis_Nil]))), afterReturn_815);
if (!(__wm_is_tuple(__wm_bind_47) && __wm_bind_47.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const blockId_816 = __wm_bind_47[0];
const afterBlock_817 = __wm_bind_47[1];
const lowered_818 = { functionId: fn_808.functionId, physicalParamLocalIds: Js.Array.fromList(params_811.physicalLocalIds), loopParamLocalIds: Js.Array.fromList(__wm_basis_Nil), bodyBlockId: blockId_816, recursive: false, spanId: fn_808.spanId };
return pushFunction_327__wm_d2(lowered_818, afterBlock_817);
};
const lowerNonrecursiveFunction_819 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return lowerNonrecursiveFunction_819__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setupRecursiveParameters_820__wm_d9 = (paramIds_821, fn_822, context_823, scope_824, state_825, reversedPhysicalIds_826, reversedLoopIds_827, reversedInitialStatements_828, reversedIterationStatements_829) => {
__wm_tail_38: while (true) {
{
const __wm_scalar_64_0 = paramIds_821;
const __wm_scalar_64_1 = fn_822;
const __wm_scalar_64_2 = context_823;
const __wm_scalar_64_3 = scope_824;
const __wm_scalar_64_4 = state_825;
const __wm_scalar_64_5 = reversedPhysicalIds_826;
const __wm_scalar_64_6 = reversedLoopIds_827;
const __wm_scalar_64_7 = reversedInitialStatements_828;
const __wm_scalar_64_8 = reversedIterationStatements_829;
if (__wm_scalar_64_0 === __wm_basis_Nil) {
const fn_830 = __wm_scalar_64_1;
const context_831 = __wm_scalar_64_2;
const scope_832 = __wm_scalar_64_3;
const state_833 = __wm_scalar_64_4;
const reversedPhysicalIds_834 = __wm_scalar_64_5;
const reversedLoopIds_835 = __wm_scalar_64_6;
const reversedInitialStatements_836 = __wm_scalar_64_7;
const reversedIterationStatements_837 = __wm_scalar_64_8;
{
const loopIds_838 = reverseInto_147__wm_d2(reversedLoopIds_835, __wm_basis_Nil);
const nextScope_839 = { ...scope_832, loopParamLocalIds: loopIds_838 };
const result_840 = { physicalLocalIds: reverseInto_147__wm_d2(reversedPhysicalIds_834, __wm_basis_Nil), activeLocalIds: loopIds_838, initialStatementIds: reverseInto_147__wm_d2(reversedInitialStatements_836, __wm_basis_Nil), iterationStatementIds: reverseInto_147__wm_d2(reversedIterationStatements_837, __wm_basis_Nil), scope: nextScope_839, state: state_833 };
return result_840;
}
} else if (__wm_scalar_64_0?.ctor === -6 && __wm_scalar_64_0.args.length === 1 && __wm_is_tuple(__wm_scalar_64_0.args[0]) && __wm_scalar_64_0.args[0].length === 2) {
const paramId_841 = __wm_scalar_64_0.args[0][0];
const rest_842 = __wm_scalar_64_0.args[0][1];
const fn_843 = __wm_scalar_64_1;
const context_844 = __wm_scalar_64_2;
const scope_845 = __wm_scalar_64_3;
const state_846 = __wm_scalar_64_4;
const reversedPhysicalIds_847 = __wm_scalar_64_5;
const reversedLoopIds_848 = __wm_scalar_64_6;
const reversedInitialStatements_849 = __wm_scalar_64_7;
const reversedIterationStatements_850 = __wm_scalar_64_8;
{
const param_851 = findParam_195__wm_d2(context_844.params, paramId_841);
const pattern_852 = findPattern_203__wm_d2(context_844.patterns, param_851.patternId);
const bindingId_853 = (__wm_eq(pattern_852.kind, "binding") ? pattern_852.bindingId : __wm_op_sub(1));
const owner_854 = findIrExpression_171__wm_d2(context_844.expressions, fn_843.bodyExprId);
const __wm_bind_48 = freshLocal_277__wm_d7(fn_843.functionId, "parameter", param_851.typeId, bindingId_853, false, param_851.spanId, state_846);
if (!(__wm_is_tuple(__wm_bind_48) && __wm_bind_48.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const physicalId_855 = __wm_bind_48[0];
const afterPhysical_856 = __wm_bind_48[1];
const __wm_bind_49 = localAtom_289__wm_d6(fn_843.functionId, param_851.typeId, __wm_op_sub(1), param_851.spanId, physicalId_855, afterPhysical_856);
if (!(__wm_is_tuple(__wm_bind_49) && __wm_bind_49.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const physicalAtomId_857 = __wm_bind_49[0];
const afterPhysicalAtom_858 = __wm_bind_49[1];
const operation_859 = { ...baseOperation_302__wm_d3(owner_854, "copy", afterPhysicalAtom_858), typeId: param_851.typeId, args: Js.Array.fromList(__wm_basis_Cons([physicalAtomId_857, __wm_basis_Nil])) };
const __wm_bind_50 = pushOperation_297__wm_d2(operation_859, afterPhysicalAtom_858);
if (!(__wm_is_tuple(__wm_bind_50) && __wm_bind_50.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_860 = __wm_bind_50[0];
const afterOperation_861 = __wm_bind_50[1];
const __wm_bind_51 = freshLocal_277__wm_d7(fn_843.functionId, "loop-parameter", param_851.typeId, bindingId_853, true, param_851.spanId, afterOperation_861);
if (!(__wm_is_tuple(__wm_bind_51) && __wm_bind_51.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const loopId_862 = __wm_bind_51[0];
const afterLoopLocal_863 = __wm_bind_51[1];
const initial_864 = { ...baseStatement_313__wm_d5(fn_843.functionId, "let", owner_854.sourceExprId, param_851.spanId, afterLoopLocal_863), localId: loopId_862, operationId: operationId_860, reason: "loop-initial" };
const __wm_bind_52 = pushStatement_306__wm_d2(initial_864, afterLoopLocal_863);
if (!(__wm_is_tuple(__wm_bind_52) && __wm_bind_52.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const initialId_865 = __wm_bind_52[0];
const afterInitial_866 = __wm_bind_52[1];
const __wm_bind_53 = localAtom_289__wm_d6(fn_843.functionId, param_851.typeId, owner_854.sourceExprId, param_851.spanId, loopId_862, afterInitial_866);
if (!(__wm_is_tuple(__wm_bind_53) && __wm_bind_53.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const loopAtomId_867 = __wm_bind_53[0];
const afterLoopAtom_868 = __wm_bind_53[1];
if (__wm_eq(pattern_852.kind, "binding")) {
{
const nextScope_869 = { ...scope_845, bindings: Map.set([scope_845.bindings, pattern_852.bindingId, loopId_862]) };
{
const __wm_tail_arg_45_0 = rest_842;
const __wm_tail_arg_45_1 = fn_843;
const __wm_tail_arg_45_2 = context_844;
const __wm_tail_arg_45_3 = nextScope_869;
const __wm_tail_arg_45_4 = afterLoopAtom_868;
const __wm_tail_arg_45_5 = __wm_basis_Cons([physicalId_855, reversedPhysicalIds_847]);
const __wm_tail_arg_45_6 = __wm_basis_Cons([loopId_862, reversedLoopIds_848]);
const __wm_tail_arg_45_7 = __wm_basis_Cons([initialId_865, reversedInitialStatements_849]);
const __wm_tail_arg_45_8 = reversedIterationStatements_850;
paramIds_821 = __wm_tail_arg_45_0;
fn_822 = __wm_tail_arg_45_1;
context_823 = __wm_tail_arg_45_2;
scope_824 = __wm_tail_arg_45_3;
state_825 = __wm_tail_arg_45_4;
reversedPhysicalIds_826 = __wm_tail_arg_45_5;
reversedLoopIds_827 = __wm_tail_arg_45_6;
reversedInitialStatements_828 = __wm_tail_arg_45_7;
reversedIterationStatements_829 = __wm_tail_arg_45_8;
continue __wm_tail_38;
}
}
} else {
{
const bound_870 = bindPattern_342__wm_d6(pattern_852.id, loopAtomId_867, owner_854, scope_845, context_844, afterLoopAtom_868);
{
const __wm_tail_arg_46_0 = rest_842;
const __wm_tail_arg_46_1 = fn_843;
const __wm_tail_arg_46_2 = context_844;
const __wm_tail_arg_46_3 = bound_870.scope;
const __wm_tail_arg_46_4 = bound_870.state;
const __wm_tail_arg_46_5 = __wm_basis_Cons([physicalId_855, reversedPhysicalIds_847]);
const __wm_tail_arg_46_6 = __wm_basis_Cons([loopId_862, reversedLoopIds_848]);
const __wm_tail_arg_46_7 = __wm_basis_Cons([initialId_865, reversedInitialStatements_849]);
const __wm_tail_arg_46_8 = reverseInto_147__wm_d2(bound_870.statementIds, reversedIterationStatements_850);
paramIds_821 = __wm_tail_arg_46_0;
fn_822 = __wm_tail_arg_46_1;
context_823 = __wm_tail_arg_46_2;
scope_824 = __wm_tail_arg_46_3;
state_825 = __wm_tail_arg_46_4;
reversedPhysicalIds_826 = __wm_tail_arg_46_5;
reversedLoopIds_827 = __wm_tail_arg_46_6;
reversedInitialStatements_828 = __wm_tail_arg_46_7;
reversedIterationStatements_829 = __wm_tail_arg_46_8;
continue __wm_tail_38;
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
const __wm_bind_54 = pushBlock_319__wm_d3(fn_871.functionId, append_154__wm_d2(params_874.iterationStatementIds, tail_875.statementIds), tail_875.state);
if (!(__wm_is_tuple(__wm_bind_54) && __wm_bind_54.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const loopBodyId_876 = __wm_bind_54[0];
const afterLoopBody_877 = __wm_bind_54[1];
const bodyExpression_878 = findIrExpression_171__wm_d2(context_872.expressions, fn_871.bodyExprId);
const loopStatement_879 = { ...baseStatement_313__wm_d5(fn_871.functionId, "loop", bodyExpression_878.sourceExprId, bodyExpression_878.spanId, afterLoopBody_877), bodyBlockId: loopBodyId_876 };
const __wm_bind_55 = pushStatement_306__wm_d2(loopStatement_879, afterLoopBody_877);
if (!(__wm_is_tuple(__wm_bind_55) && __wm_bind_55.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const loopStatementId_880 = __wm_bind_55[0];
const afterLoop_881 = __wm_bind_55[1];
const __wm_bind_56 = pushBlock_319__wm_d3(fn_871.functionId, append_154__wm_d2(params_874.initialStatementIds, __wm_basis_Cons([loopStatementId_880, __wm_basis_Nil])), afterLoop_881);
if (!(__wm_is_tuple(__wm_bind_56) && __wm_bind_56.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const outerBlockId_882 = __wm_bind_56[0];
const afterOuter_883 = __wm_bind_56[1];
const lowered_884 = { functionId: fn_871.functionId, physicalParamLocalIds: Js.Array.fromList(params_874.physicalLocalIds), loopParamLocalIds: Js.Array.fromList(params_874.activeLocalIds), bodyBlockId: outerBlockId_882, recursive: true, spanId: fn_871.spanId };
return pushFunction_327__wm_d2(lowered_884, afterOuter_883);
};
const lowerRecursiveFunction_885 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return lowerRecursiveFunction_885__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerFunctions_886__wm_d3 = (functions_887, context_888, state_889) => {
__wm_tail_39: while (true) {
{
const __wm_scalar_65_0 = functions_887;
const __wm_scalar_65_1 = context_888;
const __wm_scalar_65_2 = state_889;
if (__wm_scalar_65_0 === __wm_basis_Nil) {
const context_890 = __wm_scalar_65_1;
const state_891 = __wm_scalar_65_2;
return state_891;
} else if (__wm_scalar_65_0?.ctor === -6 && __wm_scalar_65_0.args.length === 1 && __wm_is_tuple(__wm_scalar_65_0.args[0]) && __wm_scalar_65_0.args[0].length === 2) {
const fn_892 = __wm_scalar_65_0.args[0][0];
const rest_893 = __wm_scalar_65_0.args[0][1];
const context_894 = __wm_scalar_65_1;
const state_895 = __wm_scalar_65_2;
if ((fn_892.recursionGroupId < 0)) {
{
const __wm_tail_arg_47_0 = rest_893;
const __wm_tail_arg_47_1 = context_894;
const __wm_tail_arg_47_2 = lowerNonrecursiveFunction_819__wm_d3(fn_892, context_894, state_895);
functions_887 = __wm_tail_arg_47_0;
context_888 = __wm_tail_arg_47_1;
state_889 = __wm_tail_arg_47_2;
continue __wm_tail_39;
}
} else {
{
const __wm_tail_arg_48_0 = rest_893;
const __wm_tail_arg_48_1 = context_894;
const __wm_tail_arg_48_2 = lowerRecursiveFunction_885__wm_d3(fn_892, context_894, state_895);
functions_887 = __wm_tail_arg_48_0;
context_888 = __wm_tail_arg_48_1;
state_889 = __wm_tail_arg_48_2;
continue __wm_tail_39;
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
__wm_tail_40: while (true) {
{
const __wm_scalar_66_0 = items_935;
const __wm_scalar_66_1 = count_936;
if (__wm_scalar_66_0 === __wm_basis_Nil) {
const count_937 = __wm_scalar_66_1;
return count_937;
} else if (__wm_scalar_66_0?.ctor === -6 && __wm_scalar_66_0.args.length === 1 && __wm_is_tuple(__wm_scalar_66_0.args[0]) && __wm_scalar_66_0.args[0].length === 2) {
const _item_938 = __wm_scalar_66_0.args[0][0];
const rest_939 = __wm_scalar_66_0.args[0][1];
const count_940 = __wm_scalar_66_1;
{
const __wm_tail_arg_49_0 = rest_939;
const __wm_tail_arg_49_1 = (count_940 + 1);
items_935 = __wm_tail_arg_49_0;
count_936 = __wm_tail_arg_49_1;
continue __wm_tail_40;
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
__wm_tail_41: while (true) {
{
const __wm_scalar_67_0 = items_944;
const __wm_scalar_67_1 = id_945;
if (__wm_scalar_67_0 === __wm_basis_Nil) {
const id_946 = __wm_scalar_67_1;
return __wm_fail("Panic", "missing Slang-emission type");
} else if (__wm_scalar_67_0?.ctor === -6 && __wm_scalar_67_0.args.length === 1 && __wm_is_tuple(__wm_scalar_67_0.args[0]) && __wm_scalar_67_0.args[0].length === 2) {
const item_947 = __wm_scalar_67_0.args[0][0];
const rest_948 = __wm_scalar_67_0.args[0][1];
const id_949 = __wm_scalar_67_1;
{
const exact_950 = item_947;
if (numberEqual_146__wm_d2(exact_950.id, id_949)) {
return exact_950;
} else {
{
const __wm_tail_arg_50_0 = rest_948;
const __wm_tail_arg_50_1 = id_949;
items_944 = __wm_tail_arg_50_0;
id_945 = __wm_tail_arg_50_1;
continue __wm_tail_41;
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
const vectorName_956__wm_d2 = (gpuType_951, context_952) => {
const scalar_955 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2) {
const typeId_953 = __v.args[0][0];
const __954 = __v.args[0][1];
return findType_943__wm_d2(context_952.types, typeId_953);
} else if (__v === __wm_basis_Nil) {

return __wm_fail("Panic", "shader vector has no component type");
}
__wm_fail("Match", "non-exhaustive match");
})(Js.Array.toList(gpuType_951.items));
return ((__wm_eq(scalar_955.kind, "i32") ? "int" : "float") + text_909(listLength_934__wm_d2(Js.Array.toList(gpuType_951.items), 0)));
};
const vectorName_956 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return vectorName_956__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findEnvironmentField_957__wm_d3 = (items_958, environmentId_959, index_960) => {
__wm_tail_42: while (true) {
{
const __wm_scalar_68_0 = items_958;
const __wm_scalar_68_1 = environmentId_959;
const __wm_scalar_68_2 = index_960;
if (__wm_scalar_68_0 === __wm_basis_Nil) {
const _environmentId_961 = __wm_scalar_68_1;
const _index_962 = __wm_scalar_68_2;
return __wm_fail("Panic", "missing Slang-emission environment field");
} else if (__wm_scalar_68_0?.ctor === -6 && __wm_scalar_68_0.args.length === 1 && __wm_is_tuple(__wm_scalar_68_0.args[0]) && __wm_scalar_68_0.args[0].length === 2) {
const item_963 = __wm_scalar_68_0.args[0][0];
const rest_964 = __wm_scalar_68_0.args[0][1];
const environmentId_965 = __wm_scalar_68_1;
const index_966 = __wm_scalar_68_2;
{
const exact_967 = item_963;
if (__wm_op_and_d2(numberEqual_146__wm_d2(exact_967.environmentId, environmentId_965), numberEqual_146__wm_d2(exact_967.declaredIndex, index_966))) {
return exact_967;
} else {
{
const __wm_tail_arg_51_0 = rest_964;
const __wm_tail_arg_51_1 = environmentId_965;
const __wm_tail_arg_51_2 = index_966;
items_958 = __wm_tail_arg_51_0;
environmentId_959 = __wm_tail_arg_51_1;
index_960 = __wm_tail_arg_51_2;
continue __wm_tail_42;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findEnvironmentField_957 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findEnvironmentField_957__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const findLayout_968__wm_d2 = (items_969, id_970) => {
__wm_tail_43: while (true) {
{
const __wm_scalar_69_0 = items_969;
const __wm_scalar_69_1 = id_970;
if (__wm_scalar_69_0 === __wm_basis_Nil) {
const id_971 = __wm_scalar_69_1;
return __wm_fail("Panic", "missing Slang-emission ADT layout");
} else if (__wm_scalar_69_0?.ctor === -6 && __wm_scalar_69_0.args.length === 1 && __wm_is_tuple(__wm_scalar_69_0.args[0]) && __wm_scalar_69_0.args[0].length === 2) {
const item_972 = __wm_scalar_69_0.args[0][0];
const rest_973 = __wm_scalar_69_0.args[0][1];
const id_974 = __wm_scalar_69_1;
{
const exact_975 = item_972;
if (numberEqual_146__wm_d2(exact_975.id, id_974)) {
return exact_975;
} else {
{
const __wm_tail_arg_52_0 = rest_973;
const __wm_tail_arg_52_1 = id_974;
items_969 = __wm_tail_arg_52_0;
id_970 = __wm_tail_arg_52_1;
continue __wm_tail_43;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLayout_968 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLayout_968__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLayoutByType_976__wm_d2 = (items_977, typeId_978) => {
__wm_tail_44: while (true) {
{
const __wm_scalar_70_0 = items_977;
const __wm_scalar_70_1 = typeId_978;
if (__wm_scalar_70_0 === __wm_basis_Nil) {
const typeId_979 = __wm_scalar_70_1;
return __wm_fail("Panic", "missing Slang-emission ADT type layout");
} else if (__wm_scalar_70_0?.ctor === -6 && __wm_scalar_70_0.args.length === 1 && __wm_is_tuple(__wm_scalar_70_0.args[0]) && __wm_scalar_70_0.args[0].length === 2) {
const item_980 = __wm_scalar_70_0.args[0][0];
const rest_981 = __wm_scalar_70_0.args[0][1];
const typeId_982 = __wm_scalar_70_1;
{
const exact_983 = item_980;
if (numberEqual_146__wm_d2(exact_983.typeId, typeId_982)) {
return exact_983;
} else {
{
const __wm_tail_arg_53_0 = rest_981;
const __wm_tail_arg_53_1 = typeId_982;
items_977 = __wm_tail_arg_53_0;
typeId_978 = __wm_tail_arg_53_1;
continue __wm_tail_44;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLayoutByType_976 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLayoutByType_976__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findField_984__wm_d2 = (items_985, id_986) => {
__wm_tail_45: while (true) {
{
const __wm_scalar_71_0 = items_985;
const __wm_scalar_71_1 = id_986;
if (__wm_scalar_71_0 === __wm_basis_Nil) {
const id_987 = __wm_scalar_71_1;
return __wm_fail("Panic", "missing Slang-emission ADT field");
} else if (__wm_scalar_71_0?.ctor === -6 && __wm_scalar_71_0.args.length === 1 && __wm_is_tuple(__wm_scalar_71_0.args[0]) && __wm_scalar_71_0.args[0].length === 2) {
const item_988 = __wm_scalar_71_0.args[0][0];
const rest_989 = __wm_scalar_71_0.args[0][1];
const id_990 = __wm_scalar_71_1;
{
const exact_991 = item_988;
if (numberEqual_146__wm_d2(exact_991.id, id_990)) {
return exact_991;
} else {
{
const __wm_tail_arg_54_0 = rest_989;
const __wm_tail_arg_54_1 = id_990;
items_985 = __wm_tail_arg_54_0;
id_986 = __wm_tail_arg_54_1;
continue __wm_tail_45;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findField_984 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findField_984__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findConstructor_992__wm_d2 = (items_993, id_994) => {
__wm_tail_46: while (true) {
{
const __wm_scalar_72_0 = items_993;
const __wm_scalar_72_1 = id_994;
if (__wm_scalar_72_0 === __wm_basis_Nil) {
const id_995 = __wm_scalar_72_1;
return __wm_fail("Panic", "missing Slang-emission constructor");
} else if (__wm_scalar_72_0?.ctor === -6 && __wm_scalar_72_0.args.length === 1 && __wm_is_tuple(__wm_scalar_72_0.args[0]) && __wm_scalar_72_0.args[0].length === 2) {
const item_996 = __wm_scalar_72_0.args[0][0];
const rest_997 = __wm_scalar_72_0.args[0][1];
const id_998 = __wm_scalar_72_1;
{
const exact_999 = item_996;
if (numberEqual_146__wm_d2(exact_999.id, id_998)) {
return exact_999;
} else {
{
const __wm_tail_arg_55_0 = rest_997;
const __wm_tail_arg_55_1 = id_998;
items_993 = __wm_tail_arg_55_0;
id_994 = __wm_tail_arg_55_1;
continue __wm_tail_46;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findConstructor_992 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findConstructor_992__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLocal_1000__wm_d2 = (items_1001, id_1002) => {
__wm_tail_47: while (true) {
{
const __wm_scalar_73_0 = items_1001;
const __wm_scalar_73_1 = id_1002;
if (__wm_scalar_73_0 === __wm_basis_Nil) {
const id_1003 = __wm_scalar_73_1;
return __wm_fail("Panic", "missing Slang-emission local");
} else if (__wm_scalar_73_0?.ctor === -6 && __wm_scalar_73_0.args.length === 1 && __wm_is_tuple(__wm_scalar_73_0.args[0]) && __wm_scalar_73_0.args[0].length === 2) {
const item_1004 = __wm_scalar_73_0.args[0][0];
const rest_1005 = __wm_scalar_73_0.args[0][1];
const id_1006 = __wm_scalar_73_1;
{
const exact_1007 = item_1004;
if (numberEqual_146__wm_d2(exact_1007.id, id_1006)) {
return exact_1007;
} else {
{
const __wm_tail_arg_56_0 = rest_1005;
const __wm_tail_arg_56_1 = id_1006;
items_1001 = __wm_tail_arg_56_0;
id_1002 = __wm_tail_arg_56_1;
continue __wm_tail_47;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLocal_1000 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLocal_1000__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findAtom_1008__wm_d2 = (items_1009, id_1010) => {
__wm_tail_48: while (true) {
{
const __wm_scalar_74_0 = items_1009;
const __wm_scalar_74_1 = id_1010;
if (__wm_scalar_74_0 === __wm_basis_Nil) {
const id_1011 = __wm_scalar_74_1;
return __wm_fail("Panic", "missing Slang-emission atom");
} else if (__wm_scalar_74_0?.ctor === -6 && __wm_scalar_74_0.args.length === 1 && __wm_is_tuple(__wm_scalar_74_0.args[0]) && __wm_scalar_74_0.args[0].length === 2) {
const item_1012 = __wm_scalar_74_0.args[0][0];
const rest_1013 = __wm_scalar_74_0.args[0][1];
const id_1014 = __wm_scalar_74_1;
{
const exact_1015 = item_1012;
if (numberEqual_146__wm_d2(exact_1015.id, id_1014)) {
return exact_1015;
} else {
{
const __wm_tail_arg_57_0 = rest_1013;
const __wm_tail_arg_57_1 = id_1014;
items_1009 = __wm_tail_arg_57_0;
id_1010 = __wm_tail_arg_57_1;
continue __wm_tail_48;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findAtom_1008 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findAtom_1008__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findOperation_1016__wm_d2 = (items_1017, id_1018) => {
__wm_tail_49: while (true) {
{
const __wm_scalar_75_0 = items_1017;
const __wm_scalar_75_1 = id_1018;
if (__wm_scalar_75_0 === __wm_basis_Nil) {
const id_1019 = __wm_scalar_75_1;
return __wm_fail("Panic", "missing Slang-emission operation");
} else if (__wm_scalar_75_0?.ctor === -6 && __wm_scalar_75_0.args.length === 1 && __wm_is_tuple(__wm_scalar_75_0.args[0]) && __wm_scalar_75_0.args[0].length === 2) {
const item_1020 = __wm_scalar_75_0.args[0][0];
const rest_1021 = __wm_scalar_75_0.args[0][1];
const id_1022 = __wm_scalar_75_1;
{
const exact_1023 = item_1020;
if (numberEqual_146__wm_d2(exact_1023.id, id_1022)) {
return exact_1023;
} else {
{
const __wm_tail_arg_58_0 = rest_1021;
const __wm_tail_arg_58_1 = id_1022;
items_1017 = __wm_tail_arg_58_0;
id_1018 = __wm_tail_arg_58_1;
continue __wm_tail_49;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findOperation_1016 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findOperation_1016__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findStatement_1024__wm_d2 = (items_1025, id_1026) => {
__wm_tail_50: while (true) {
{
const __wm_scalar_76_0 = items_1025;
const __wm_scalar_76_1 = id_1026;
if (__wm_scalar_76_0 === __wm_basis_Nil) {
const id_1027 = __wm_scalar_76_1;
return __wm_fail("Panic", "missing Slang-emission statement");
} else if (__wm_scalar_76_0?.ctor === -6 && __wm_scalar_76_0.args.length === 1 && __wm_is_tuple(__wm_scalar_76_0.args[0]) && __wm_scalar_76_0.args[0].length === 2) {
const item_1028 = __wm_scalar_76_0.args[0][0];
const rest_1029 = __wm_scalar_76_0.args[0][1];
const id_1030 = __wm_scalar_76_1;
{
const exact_1031 = item_1028;
if (numberEqual_146__wm_d2(exact_1031.id, id_1030)) {
return exact_1031;
} else {
{
const __wm_tail_arg_59_0 = rest_1029;
const __wm_tail_arg_59_1 = id_1030;
items_1025 = __wm_tail_arg_59_0;
id_1026 = __wm_tail_arg_59_1;
continue __wm_tail_50;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findStatement_1024 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findStatement_1024__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findBlock_1032__wm_d2 = (items_1033, id_1034) => {
__wm_tail_51: while (true) {
{
const __wm_scalar_77_0 = items_1033;
const __wm_scalar_77_1 = id_1034;
if (__wm_scalar_77_0 === __wm_basis_Nil) {
const id_1035 = __wm_scalar_77_1;
return __wm_fail("Panic", "missing Slang-emission block");
} else if (__wm_scalar_77_0?.ctor === -6 && __wm_scalar_77_0.args.length === 1 && __wm_is_tuple(__wm_scalar_77_0.args[0]) && __wm_scalar_77_0.args[0].length === 2) {
const item_1036 = __wm_scalar_77_0.args[0][0];
const rest_1037 = __wm_scalar_77_0.args[0][1];
const id_1038 = __wm_scalar_77_1;
{
const exact_1039 = item_1036;
if (numberEqual_146__wm_d2(exact_1039.id, id_1038)) {
return exact_1039;
} else {
{
const __wm_tail_arg_60_0 = rest_1037;
const __wm_tail_arg_60_1 = id_1038;
items_1033 = __wm_tail_arg_60_0;
id_1034 = __wm_tail_arg_60_1;
continue __wm_tail_51;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findBlock_1032 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findBlock_1032__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findCase_1040__wm_d2 = (items_1041, id_1042) => {
__wm_tail_52: while (true) {
{
const __wm_scalar_78_0 = items_1041;
const __wm_scalar_78_1 = id_1042;
if (__wm_scalar_78_0 === __wm_basis_Nil) {
const id_1043 = __wm_scalar_78_1;
return __wm_fail("Panic", "missing Slang-emission case");
} else if (__wm_scalar_78_0?.ctor === -6 && __wm_scalar_78_0.args.length === 1 && __wm_is_tuple(__wm_scalar_78_0.args[0]) && __wm_scalar_78_0.args[0].length === 2) {
const item_1044 = __wm_scalar_78_0.args[0][0];
const rest_1045 = __wm_scalar_78_0.args[0][1];
const id_1046 = __wm_scalar_78_1;
{
const exact_1047 = item_1044;
if (numberEqual_146__wm_d2(exact_1047.id, id_1046)) {
return exact_1047;
} else {
{
const __wm_tail_arg_61_0 = rest_1045;
const __wm_tail_arg_61_1 = id_1046;
items_1041 = __wm_tail_arg_61_0;
id_1042 = __wm_tail_arg_61_1;
continue __wm_tail_52;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findCase_1040 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findCase_1040__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findFunction_1048__wm_d2 = (items_1049, id_1050) => {
__wm_tail_53: while (true) {
{
const __wm_scalar_79_0 = items_1049;
const __wm_scalar_79_1 = id_1050;
if (__wm_scalar_79_0 === __wm_basis_Nil) {
const id_1051 = __wm_scalar_79_1;
return __wm_fail("Panic", "missing Slang-emission function");
} else if (__wm_scalar_79_0?.ctor === -6 && __wm_scalar_79_0.args.length === 1 && __wm_is_tuple(__wm_scalar_79_0.args[0]) && __wm_scalar_79_0.args[0].length === 2) {
const item_1052 = __wm_scalar_79_0.args[0][0];
const rest_1053 = __wm_scalar_79_0.args[0][1];
const id_1054 = __wm_scalar_79_1;
{
const exact_1055 = item_1052;
if (numberEqual_146__wm_d2(exact_1055.functionId, id_1054)) {
return exact_1055;
} else {
{
const __wm_tail_arg_62_0 = rest_1053;
const __wm_tail_arg_62_1 = id_1054;
items_1049 = __wm_tail_arg_62_0;
id_1050 = __wm_tail_arg_62_1;
continue __wm_tail_53;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findFunction_1048 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findFunction_1048__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findAdtForEmit_1056__wm_d2 = (items_1057, typeNameId_1058) => {
__wm_tail_54: while (true) {
{
const __wm_scalar_80_0 = items_1057;
const __wm_scalar_80_1 = typeNameId_1058;
if (__wm_scalar_80_0 === __wm_basis_Nil) {
const typeNameId_1059 = __wm_scalar_80_1;
return __wm_fail("Panic", "missing Slang-emission ADT");
} else if (__wm_scalar_80_0?.ctor === -6 && __wm_scalar_80_0.args.length === 1 && __wm_is_tuple(__wm_scalar_80_0.args[0]) && __wm_scalar_80_0.args[0].length === 2) {
const item_1060 = __wm_scalar_80_0.args[0][0];
const rest_1061 = __wm_scalar_80_0.args[0][1];
const typeNameId_1062 = __wm_scalar_80_1;
{
const exact_1063 = item_1060;
if (numberEqual_146__wm_d2(exact_1063.typeNameId, typeNameId_1062)) {
return exact_1063;
} else {
{
const __wm_tail_arg_63_0 = rest_1061;
const __wm_tail_arg_63_1 = typeNameId_1062;
items_1057 = __wm_tail_arg_63_0;
typeNameId_1058 = __wm_tail_arg_63_1;
continue __wm_tail_54;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findAdtForEmit_1056 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findAdtForEmit_1056__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findSourceFunction_1064__wm_d2 = (items_1065, functionId_1066) => {
__wm_tail_55: while (true) {
{
const __wm_scalar_81_0 = items_1065;
const __wm_scalar_81_1 = functionId_1066;
if (__wm_scalar_81_0 === __wm_basis_Nil) {
const functionId_1067 = __wm_scalar_81_1;
return __wm_fail("Panic", "missing Slang-emission source function");
} else if (__wm_scalar_81_0?.ctor === -6 && __wm_scalar_81_0.args.length === 1 && __wm_is_tuple(__wm_scalar_81_0.args[0]) && __wm_scalar_81_0.args[0].length === 2) {
const item_1068 = __wm_scalar_81_0.args[0][0];
const rest_1069 = __wm_scalar_81_0.args[0][1];
const functionId_1070 = __wm_scalar_81_1;
{
const exact_1071 = item_1068;
if (numberEqual_146__wm_d2(exact_1071.id, functionId_1070)) {
return exact_1071;
} else {
{
const __wm_tail_arg_64_0 = rest_1069;
const __wm_tail_arg_64_1 = functionId_1070;
items_1065 = __wm_tail_arg_64_0;
functionId_1066 = __wm_tail_arg_64_1;
continue __wm_tail_55;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findSourceFunction_1064 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findSourceFunction_1064__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const typeName_1076__wm_d2 = (typeId_1072, context_1073) => {
const gpuType_1074 = findType_943__wm_d2(context_1073.types, typeId_1072);
if (__wm_eq(gpuType_1074.kind, "f32")) {
return "float";
} else {
if (__wm_eq(gpuType_1074.kind, "i32")) {
return "int";
} else {
if (__wm_eq(gpuType_1074.kind, "bool")) {
return "bool";
} else {
if (__wm_eq(gpuType_1074.kind, "void")) {
return "void";
} else {
if (__wm_eq(gpuType_1074.kind, "vector")) {
return vectorName_956__wm_d2(gpuType_1074, context_1073);
} else {
if (__wm_eq(gpuType_1074.kind, "tuple")) {
return tupleName_915(typeId_1072);
} else {
if (__wm_eq(gpuType_1074.kind, "adt")) {
const layout_1075 = findLayoutByType_976__wm_d2(context_1073.layouts, typeId_1072);
return layoutName_921(layout_1075.id);
} else {
if (__wm_eq(gpuType_1074.kind, "sampled-texture-2d")) {
return "Texture2D<float4>";
} else {
if (__wm_eq(gpuType_1074.kind, "sampler")) {
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
const typeName_1076 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return typeName_1076__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitEnvironmentFields_1077__wm_d3 = (items_1078, context_1079, output_1080) => {
__wm_tail_56: while (true) {
{
const __wm_scalar_82_0 = items_1078;
const __wm_scalar_82_1 = context_1079;
const __wm_scalar_82_2 = output_1080;
if (__wm_scalar_82_0 === __wm_basis_Nil) {
const _context_1081 = __wm_scalar_82_1;
const output_1082 = __wm_scalar_82_2;
return output_1082;
} else if (__wm_scalar_82_0?.ctor === -6 && __wm_scalar_82_0.args.length === 1 && __wm_is_tuple(__wm_scalar_82_0.args[0]) && __wm_scalar_82_0.args[0].length === 2) {
const field_1083 = __wm_scalar_82_0.args[0][0];
const rest_1084 = __wm_scalar_82_0.args[0][1];
const context_1085 = __wm_scalar_82_1;
const output_1086 = __wm_scalar_82_2;
{
const exactField_1087 = field_1083;
const exactContext_1088 = context_1085;
{
const __wm_tail_arg_65_0 = rest_1084;
const __wm_tail_arg_65_1 = exactContext_1088;
const __wm_tail_arg_65_2 = (__wm_eq(exactField_1087.kind, "uniform") ? (() => {
const gpuType_1089 = findType_943__wm_d2(exactContext_1088.types, exactField_1087.typeId);
const fieldType_1090 = (__wm_eq(gpuType_1089.kind, "bool") ? "int" : typeName_1076__wm_d2(exactField_1087.typeId, exactContext_1088));
return (((((output_1086 + "  ") + fieldType_1090) + " ") + uniformFieldName_927(exactField_1087.declaredIndex)) + ";\n");
})() : output_1086);
items_1078 = __wm_tail_arg_65_0;
context_1079 = __wm_tail_arg_65_1;
output_1080 = __wm_tail_arg_65_2;
continue __wm_tail_56;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitEnvironmentFields_1077 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitEnvironmentFields_1077__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
let hasUniformField_1091 = (__arg) => {
__wm_tail_57: while (true) {
if (true) {
const items_1092 = __arg;
{
const __wm_tail_value_66 = items_1092;
if (__wm_tail_value_66 === __wm_basis_Nil) {

return false;
} else if (__wm_tail_value_66?.ctor === -6 && __wm_tail_value_66.args.length === 1 && __wm_is_tuple(__wm_tail_value_66.args[0]) && __wm_tail_value_66.args[0].length === 2) {
const field_1093 = __wm_tail_value_66.args[0][0];
const rest_1094 = __wm_tail_value_66.args[0][1];
{
const exact_1095 = field_1093;
if (__wm_eq(exact_1095.kind, "uniform")) {
return true;
} else {
__arg = rest_1094;
continue __wm_tail_57;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "pattern match failure in function");
}
};
const emitResourceDeclarations_1096__wm_d3 = (items_1097, context_1098, output_1099) => {
__wm_tail_58: while (true) {
{
const __wm_scalar_83_0 = items_1097;
const __wm_scalar_83_1 = context_1098;
const __wm_scalar_83_2 = output_1099;
if (__wm_scalar_83_0 === __wm_basis_Nil) {
const _context_1100 = __wm_scalar_83_1;
const output_1101 = __wm_scalar_83_2;
return output_1101;
} else if (__wm_scalar_83_0?.ctor === -6 && __wm_scalar_83_0.args.length === 1 && __wm_is_tuple(__wm_scalar_83_0.args[0]) && __wm_scalar_83_0.args[0].length === 2) {
const field_1102 = __wm_scalar_83_0.args[0][0];
const rest_1103 = __wm_scalar_83_0.args[0][1];
const context_1104 = __wm_scalar_83_1;
const output_1105 = __wm_scalar_83_2;
{
const exactField_1106 = field_1102;
const exactContext_1107 = context_1104;
const next_1108 = (__wm_eq(exactField_1106.kind, "uniform") ? output_1105 : (((((((output_1105 + "[[vk::binding(") + text_909(exactField_1106.binding)) + ", 0)]]\n") + typeName_1076__wm_d2(exactField_1106.typeId, exactContext_1107)) + " ") + resourceFieldName_929(exactField_1106.binding)) + ";\n\n"));
{
const __wm_tail_arg_67_0 = rest_1103;
const __wm_tail_arg_67_1 = exactContext_1107;
const __wm_tail_arg_67_2 = next_1108;
items_1097 = __wm_tail_arg_67_0;
context_1098 = __wm_tail_arg_67_1;
output_1099 = __wm_tail_arg_67_2;
continue __wm_tail_58;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitResourceDeclarations_1096 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitResourceDeclarations_1096__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitEnvironmentDeclaration_1112 = (__arg) => {
if (true) {
const context_1109 = __arg;
if (__wm_op_or_d2(context_1109.portable, numberEqual_146__wm_d2(context_1109.input.root.environmentId, __wm_op_sub(1)))) {
return "";
} else {
const fields_1110 = context_1109.environmentFields;
const uniformDeclaration_1111 = (hasUniformField_1091(fields_1110) ? (((("struct wm_environment {\n" + emitEnvironmentFields_1077__wm_d3(fields_1110, context_1109, "")) + "};\n") + "[[vk::binding(0, 0)]]\n") + "ConstantBuffer<wm_environment> wm_uniforms;\n\n") : "");
return (uniformDeclaration_1111 + emitResourceDeclarations_1096__wm_d3(fields_1110, context_1109, ""));
}
}
__wm_fail("Match", "pattern match failure in function");
};
const emitPortableEnvironmentAccessors_1113__wm_d3 = (items_1114, context_1115, output_1116) => {
__wm_tail_59: while (true) {
{
const __wm_scalar_84_0 = items_1114;
const __wm_scalar_84_1 = context_1115;
const __wm_scalar_84_2 = output_1116;
if (__wm_scalar_84_0 === __wm_basis_Nil) {
const _context_1117 = __wm_scalar_84_1;
const output_1118 = __wm_scalar_84_2;
return output_1118;
} else if (__wm_scalar_84_0?.ctor === -6 && __wm_scalar_84_0.args.length === 1 && __wm_is_tuple(__wm_scalar_84_0.args[0]) && __wm_scalar_84_0.args[0].length === 2) {
const field_1119 = __wm_scalar_84_0.args[0][0];
const rest_1120 = __wm_scalar_84_0.args[0][1];
const context_1121 = __wm_scalar_84_1;
const output_1122 = __wm_scalar_84_2;
{
const exactField_1123 = field_1119;
const exactContext_1124 = context_1121;
const belongsToRoot_1125 = numberEqual_146__wm_d2(exactField_1123.environmentId, exactContext_1124.input.root.environmentId);
const next_1127 = (__wm_op_not(belongsToRoot_1125) ? output_1122 : (() => {
const name_1126 = (__wm_eq(exactField_1123.kind, "uniform") ? ("WM_UNIFORM_" + text_909(exactField_1123.declaredIndex)) : ("WM_RESOURCE_" + text_909(exactField_1123.binding)));
return (((((((((output_1122 + "#ifndef ") + name_1126) + "\n") + "__extern_cpp ") + typeName_1076__wm_d2(exactField_1123.typeId, exactContext_1124)) + " ") + name_1126) + "();\n") + "#endif\n");
})());
{
const __wm_tail_arg_68_0 = rest_1120;
const __wm_tail_arg_68_1 = exactContext_1124;
const __wm_tail_arg_68_2 = next_1127;
items_1114 = __wm_tail_arg_68_0;
context_1115 = __wm_tail_arg_68_1;
output_1116 = __wm_tail_arg_68_2;
continue __wm_tail_59;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitPortableEnvironmentAccessors_1113 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitPortableEnvironmentAccessors_1113__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const joinText_1128__wm_d3 = (items_1129, separator_1130, output_1131) => {
__wm_tail_60: while (true) {
{
const __wm_scalar_85_0 = items_1129;
const __wm_scalar_85_1 = separator_1130;
const __wm_scalar_85_2 = output_1131;
if (__wm_scalar_85_0 === __wm_basis_Nil) {
const separator_1132 = __wm_scalar_85_1;
const output_1133 = __wm_scalar_85_2;
return output_1133;
} else if (__wm_scalar_85_0?.ctor === -6 && __wm_scalar_85_0.args.length === 1 && __wm_is_tuple(__wm_scalar_85_0.args[0]) && __wm_scalar_85_0.args[0].length === 2) {
const item_1134 = __wm_scalar_85_0.args[0][0];
const rest_1135 = __wm_scalar_85_0.args[0][1];
const separator_1136 = __wm_scalar_85_1;
const output_1137 = __wm_scalar_85_2;
{
const next_1138 = (__wm_eq(output_1137, "") ? item_1134 : ((output_1137 + separator_1136) + item_1134));
{
const __wm_tail_arg_69_0 = rest_1135;
const __wm_tail_arg_69_1 = separator_1136;
const __wm_tail_arg_69_2 = next_1138;
items_1129 = __wm_tail_arg_69_0;
separator_1130 = __wm_tail_arg_69_1;
output_1131 = __wm_tail_arg_69_2;
continue __wm_tail_60;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const joinText_1128 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return joinText_1128__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleFields_1139__wm_d4 = (typeIds_1140, index_1141, context_1142, output_1143) => {
__wm_tail_61: while (true) {
{
const __wm_scalar_86_0 = typeIds_1140;
const __wm_scalar_86_1 = index_1141;
const __wm_scalar_86_2 = context_1142;
const __wm_scalar_86_3 = output_1143;
if (__wm_scalar_86_0 === __wm_basis_Nil) {
const index_1144 = __wm_scalar_86_1;
const context_1145 = __wm_scalar_86_2;
const output_1146 = __wm_scalar_86_3;
return output_1146;
} else if (__wm_scalar_86_0?.ctor === -6 && __wm_scalar_86_0.args.length === 1 && __wm_is_tuple(__wm_scalar_86_0.args[0]) && __wm_scalar_86_0.args[0].length === 2) {
const typeId_1147 = __wm_scalar_86_0.args[0][0];
const rest_1148 = __wm_scalar_86_0.args[0][1];
const index_1149 = __wm_scalar_86_1;
const context_1150 = __wm_scalar_86_2;
const output_1151 = __wm_scalar_86_3;
{
const __wm_tail_arg_70_0 = rest_1148;
const __wm_tail_arg_70_1 = (index_1149 + 1);
const __wm_tail_arg_70_2 = context_1150;
const __wm_tail_arg_70_3 = (((((output_1151 + "  ") + typeName_1076__wm_d2(typeId_1147, context_1150)) + " ") + tupleFieldName_919(index_1149)) + ";\n");
typeIds_1140 = __wm_tail_arg_70_0;
index_1141 = __wm_tail_arg_70_1;
context_1142 = __wm_tail_arg_70_2;
output_1143 = __wm_tail_arg_70_3;
continue __wm_tail_61;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitTupleFields_1139 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitTupleFields_1139__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleParams_1152__wm_d4 = (typeIds_1153, index_1154, context_1155, output_1156) => {
__wm_tail_62: while (true) {
{
const __wm_scalar_87_0 = typeIds_1153;
const __wm_scalar_87_1 = index_1154;
const __wm_scalar_87_2 = context_1155;
const __wm_scalar_87_3 = output_1156;
if (__wm_scalar_87_0 === __wm_basis_Nil) {
const index_1157 = __wm_scalar_87_1;
const context_1158 = __wm_scalar_87_2;
const output_1159 = __wm_scalar_87_3;
return output_1159;
} else if (__wm_scalar_87_0?.ctor === -6 && __wm_scalar_87_0.args.length === 1 && __wm_is_tuple(__wm_scalar_87_0.args[0]) && __wm_scalar_87_0.args[0].length === 2) {
const typeId_1160 = __wm_scalar_87_0.args[0][0];
const rest_1161 = __wm_scalar_87_0.args[0][1];
const index_1162 = __wm_scalar_87_1;
const context_1163 = __wm_scalar_87_2;
const output_1164 = __wm_scalar_87_3;
{
const parameter_1165 = ((typeName_1076__wm_d2(typeId_1160, context_1163) + " ") + tupleFieldName_919(index_1162));
const next_1166 = (__wm_eq(output_1164, "") ? parameter_1165 : ((output_1164 + ", ") + parameter_1165));
{
const __wm_tail_arg_71_0 = rest_1161;
const __wm_tail_arg_71_1 = (index_1162 + 1);
const __wm_tail_arg_71_2 = context_1163;
const __wm_tail_arg_71_3 = next_1166;
typeIds_1153 = __wm_tail_arg_71_0;
index_1154 = __wm_tail_arg_71_1;
context_1155 = __wm_tail_arg_71_2;
output_1156 = __wm_tail_arg_71_3;
continue __wm_tail_62;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitTupleParams_1152 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitTupleParams_1152__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleAssignments_1167__wm_d3 = (typeIds_1168, index_1169, output_1170) => {
__wm_tail_63: while (true) {
{
const __wm_scalar_88_0 = typeIds_1168;
const __wm_scalar_88_1 = index_1169;
const __wm_scalar_88_2 = output_1170;
if (__wm_scalar_88_0 === __wm_basis_Nil) {
const index_1171 = __wm_scalar_88_1;
const output_1172 = __wm_scalar_88_2;
return output_1172;
} else if (__wm_scalar_88_0?.ctor === -6 && __wm_scalar_88_0.args.length === 1 && __wm_is_tuple(__wm_scalar_88_0.args[0]) && __wm_scalar_88_0.args[0].length === 2) {
const _typeId_1173 = __wm_scalar_88_0.args[0][0];
const rest_1174 = __wm_scalar_88_0.args[0][1];
const index_1175 = __wm_scalar_88_1;
const output_1176 = __wm_scalar_88_2;
{
const field_1177 = tupleFieldName_919(index_1175);
{
const __wm_tail_arg_72_0 = rest_1174;
const __wm_tail_arg_72_1 = (index_1175 + 1);
const __wm_tail_arg_72_2 = (((((output_1176 + "  value.") + field_1177) + " = ") + field_1177) + ";\n");
typeIds_1168 = __wm_tail_arg_72_0;
index_1169 = __wm_tail_arg_72_1;
output_1170 = __wm_tail_arg_72_2;
continue __wm_tail_63;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitTupleAssignments_1167 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitTupleAssignments_1167__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleDeclaration_1181__wm_d2 = (gpuType_1178, context_1179) => {
const items_1180 = Js.Array.toList(gpuType_1178.items);
return ((((((((((((((("struct " + tupleName_915(gpuType_1178.id)) + " {\n") + emitTupleFields_1139__wm_d4(items_1180, 0, context_1179, "")) + "};\n\n") + tupleName_915(gpuType_1178.id)) + " ") + tupleFactoryName_917(gpuType_1178.id)) + "(") + emitTupleParams_1152__wm_d4(items_1180, 0, context_1179, "")) + ") {\n") + "  ") + tupleName_915(gpuType_1178.id)) + " value;\n") + emitTupleAssignments_1167__wm_d3(items_1180, 0, "")) + "  return value;\n}\n\n");
};
const emitTupleDeclaration_1181 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitTupleDeclaration_1181__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleDeclarations_1182__wm_d3 = (types_1183, context_1184, output_1185) => {
__wm_tail_64: while (true) {
{
const __wm_scalar_89_0 = types_1183;
const __wm_scalar_89_1 = context_1184;
const __wm_scalar_89_2 = output_1185;
if (__wm_scalar_89_0 === __wm_basis_Nil) {
const context_1186 = __wm_scalar_89_1;
const output_1187 = __wm_scalar_89_2;
return output_1187;
} else if (__wm_scalar_89_0?.ctor === -6 && __wm_scalar_89_0.args.length === 1 && __wm_is_tuple(__wm_scalar_89_0.args[0]) && __wm_scalar_89_0.args[0].length === 2) {
const gpuType_1188 = __wm_scalar_89_0.args[0][0];
const rest_1189 = __wm_scalar_89_0.args[0][1];
const context_1190 = __wm_scalar_89_1;
const output_1191 = __wm_scalar_89_2;
{
const exactType_1192 = gpuType_1188;
const exactContext_1193 = context_1190;
const next_1194 = (__wm_eq(exactType_1192.kind, "tuple") ? (output_1191 + emitTupleDeclaration_1181__wm_d2(exactType_1192, exactContext_1193)) : output_1191);
{
const __wm_tail_arg_73_0 = rest_1189;
const __wm_tail_arg_73_1 = exactContext_1193;
const __wm_tail_arg_73_2 = next_1194;
types_1183 = __wm_tail_arg_73_0;
context_1184 = __wm_tail_arg_73_1;
output_1185 = __wm_tail_arg_73_2;
continue __wm_tail_64;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitTupleDeclarations_1182 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitTupleDeclarations_1182__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const zeroArgs_1195__wm_d4 = (items_1197, context_1198, index_1199, output_1200) => {
__wm_tail_65: while (true) {
{
const __wm_scalar_90_0 = items_1197;
const __wm_scalar_90_1 = context_1198;
const __wm_scalar_90_2 = index_1199;
const __wm_scalar_90_3 = output_1200;
if (__wm_scalar_90_0 === __wm_basis_Nil) {
const _context_1201 = __wm_scalar_90_1;
const _index_1202 = __wm_scalar_90_2;
const output_1203 = __wm_scalar_90_3;
return output_1203;
} else if (__wm_scalar_90_0?.ctor === -6 && __wm_scalar_90_0.args.length === 1 && __wm_is_tuple(__wm_scalar_90_0.args[0]) && __wm_scalar_90_0.args[0].length === 2) {
const typeId_1204 = __wm_scalar_90_0.args[0][0];
const rest_1205 = __wm_scalar_90_0.args[0][1];
const context_1206 = __wm_scalar_90_1;
const index_1207 = __wm_scalar_90_2;
const output_1208 = __wm_scalar_90_3;
{
const next_1209 = (numberEqual_146__wm_d2(index_1207, 0) ? zeroValue_1196__wm_d2(typeId_1204, context_1206) : ((output_1208 + ", ") + zeroValue_1196__wm_d2(typeId_1204, context_1206)));
{
const __wm_tail_arg_74_0 = rest_1205;
const __wm_tail_arg_74_1 = context_1206;
const __wm_tail_arg_74_2 = (index_1207 + 1);
const __wm_tail_arg_74_3 = next_1209;
items_1197 = __wm_tail_arg_74_0;
context_1198 = __wm_tail_arg_74_1;
index_1199 = __wm_tail_arg_74_2;
output_1200 = __wm_tail_arg_74_3;
continue __wm_tail_65;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const zeroArgs_1195 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return zeroArgs_1195__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const zeroValue_1196__wm_d2 = (typeId_1210, context_1211) => {
const gpuType_1212 = findType_943__wm_d2(context_1211.types, typeId_1210);
if (__wm_eq(gpuType_1212.kind, "f32")) {
return "float(0)";
} else {
if (__wm_eq(gpuType_1212.kind, "i32")) {
return "int(0)";
} else {
if (__wm_eq(gpuType_1212.kind, "bool")) {
return "false";
} else {
if (__wm_eq(gpuType_1212.kind, "vector")) {
return (vectorName_956__wm_d2(gpuType_1212, context_1211) + "(0)");
} else {
if (__wm_eq(gpuType_1212.kind, "tuple")) {
return (((tupleFactoryName_917(typeId_1210) + "(") + zeroArgs_1195__wm_d4(Js.Array.toList(gpuType_1212.items), context_1211, 0, "")) + ")");
} else {
return __wm_fail("Panic", "nested ADT payloads are outside the wmslang slice");
}
}
}
}
}
};
const zeroValue_1196 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return zeroValue_1196__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitLayoutFields_1213__wm_d3 = (fieldIds_1214, context_1215, output_1216) => {
__wm_tail_66: while (true) {
{
const __wm_scalar_91_0 = fieldIds_1214;
const __wm_scalar_91_1 = context_1215;
const __wm_scalar_91_2 = output_1216;
if (__wm_scalar_91_0 === __wm_basis_Nil) {
const context_1217 = __wm_scalar_91_1;
const output_1218 = __wm_scalar_91_2;
return output_1218;
} else if (__wm_scalar_91_0?.ctor === -6 && __wm_scalar_91_0.args.length === 1 && __wm_is_tuple(__wm_scalar_91_0.args[0]) && __wm_scalar_91_0.args[0].length === 2) {
const fieldId_1219 = __wm_scalar_91_0.args[0][0];
const rest_1220 = __wm_scalar_91_0.args[0][1];
const context_1221 = __wm_scalar_91_1;
const output_1222 = __wm_scalar_91_2;
{
const exactContext_1223 = context_1221;
const field_1224 = findField_984__wm_d2(exactContext_1223.fields, fieldId_1219);
{
const __wm_tail_arg_75_0 = rest_1220;
const __wm_tail_arg_75_1 = exactContext_1223;
const __wm_tail_arg_75_2 = (((((output_1222 + "  ") + typeName_1076__wm_d2(field_1224.typeId, exactContext_1223)) + " ") + payloadFieldName_925(field_1224.id)) + ";\n");
fieldIds_1214 = __wm_tail_arg_75_0;
context_1215 = __wm_tail_arg_75_1;
output_1216 = __wm_tail_arg_75_2;
continue __wm_tail_66;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitLayoutFields_1213 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitLayoutFields_1213__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const fieldsForEmit_1225__wm_d2 = (fieldIds_1226, context_1227) => {
const __wm_scalar_92_0 = fieldIds_1226;
const __wm_scalar_92_1 = context_1227;
if (__wm_scalar_92_0 === __wm_basis_Nil) {
const _context_1228 = __wm_scalar_92_1;
return __wm_basis_Nil;
} else if (__wm_scalar_92_0?.ctor === -6 && __wm_scalar_92_0.args.length === 1 && __wm_is_tuple(__wm_scalar_92_0.args[0]) && __wm_scalar_92_0.args[0].length === 2) {
const fieldId_1229 = __wm_scalar_92_0.args[0][0];
const rest_1230 = __wm_scalar_92_0.args[0][1];
const context_1231 = __wm_scalar_92_1;
const exactContext_1232 = context_1231;
return __wm_basis_Cons([findField_984__wm_d2(exactContext_1232.fields, fieldId_1229), fieldsForEmit_1225__wm_d2(rest_1230, exactContext_1232)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const fieldsForEmit_1225 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return fieldsForEmit_1225__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitConstructorFieldAssignments_1233__wm_d5 = (fields_1234, constructorId_1235, payloadName_1236, context_1237, output_1238) => {
__wm_tail_67: while (true) {
{
const __wm_scalar_93_0 = fields_1234;
const __wm_scalar_93_1 = constructorId_1235;
const __wm_scalar_93_2 = payloadName_1236;
const __wm_scalar_93_3 = context_1237;
const __wm_scalar_93_4 = output_1238;
if (__wm_scalar_93_0 === __wm_basis_Nil) {
const _constructorId_1239 = __wm_scalar_93_1;
const _payloadName_1240 = __wm_scalar_93_2;
const _context_1241 = __wm_scalar_93_3;
const output_1242 = __wm_scalar_93_4;
return output_1242;
} else if (__wm_scalar_93_0?.ctor === -6 && __wm_scalar_93_0.args.length === 1 && __wm_is_tuple(__wm_scalar_93_0.args[0]) && __wm_scalar_93_0.args[0].length === 2) {
const field_1243 = __wm_scalar_93_0.args[0][0];
const rest_1244 = __wm_scalar_93_0.args[0][1];
const constructorId_1245 = __wm_scalar_93_1;
const payloadName_1246 = __wm_scalar_93_2;
const context_1247 = __wm_scalar_93_3;
const output_1248 = __wm_scalar_93_4;
{
const exactField_1249 = field_1243;
const exactContext_1250 = context_1247;
const value_1251 = (numberEqual_146__wm_d2(exactField_1249.constructorId, constructorId_1245) ? payloadName_1246 : zeroValue_1196__wm_d2(exactField_1249.typeId, exactContext_1250));
{
const __wm_tail_arg_76_0 = rest_1244;
const __wm_tail_arg_76_1 = constructorId_1245;
const __wm_tail_arg_76_2 = payloadName_1246;
const __wm_tail_arg_76_3 = exactContext_1250;
const __wm_tail_arg_76_4 = (((((output_1248 + "  value.") + payloadFieldName_925(exactField_1249.id)) + " = ") + value_1251) + ";\n");
fields_1234 = __wm_tail_arg_76_0;
constructorId_1235 = __wm_tail_arg_76_1;
payloadName_1236 = __wm_tail_arg_76_2;
context_1237 = __wm_tail_arg_76_3;
output_1238 = __wm_tail_arg_76_4;
continue __wm_tail_67;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitConstructorFieldAssignments_1233 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return emitConstructorFieldAssignments_1233__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const emitConstructorDeclaration_1257__wm_d3 = (constructor_1252, layout_1253, context_1254) => {
const parameter_1255 = (numberEqual_146__wm_d2(constructor_1252.payloadTypeId, __wm_op_sub(1)) ? "" : (typeName_1076__wm_d2(constructor_1252.payloadTypeId, context_1254) + " payload"));
const payloadName_1256 = (numberEqual_146__wm_d2(constructor_1252.payloadTypeId, __wm_op_sub(1)) ? "float(0)" : "payload");
return (((((((((((((layoutName_921(layout_1253.id) + " ") + constructorName_923(constructor_1252.id)) + "(") + parameter_1255) + ") {\n") + "  ") + layoutName_921(layout_1253.id)) + " value;\n") + "  value.tag = ") + text_909(constructor_1252.tag)) + ";\n") + emitConstructorFieldAssignments_1233__wm_d5(fieldsForEmit_1225__wm_d2(Js.Array.toList(layout_1253.fieldIds), context_1254), constructor_1252.id, payloadName_1256, context_1254, "")) + "  return value;\n}\n\n");
};
const emitConstructorDeclaration_1257 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitConstructorDeclaration_1257__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitLayoutConstructors_1258__wm_d4 = (constructorIds_1259, layout_1260, context_1261, output_1262) => {
__wm_tail_68: while (true) {
{
const __wm_scalar_94_0 = constructorIds_1259;
const __wm_scalar_94_1 = layout_1260;
const __wm_scalar_94_2 = context_1261;
const __wm_scalar_94_3 = output_1262;
if (__wm_scalar_94_0 === __wm_basis_Nil) {
const layout_1263 = __wm_scalar_94_1;
const context_1264 = __wm_scalar_94_2;
const output_1265 = __wm_scalar_94_3;
return output_1265;
} else if (__wm_scalar_94_0?.ctor === -6 && __wm_scalar_94_0.args.length === 1 && __wm_is_tuple(__wm_scalar_94_0.args[0]) && __wm_scalar_94_0.args[0].length === 2) {
const constructorId_1266 = __wm_scalar_94_0.args[0][0];
const rest_1267 = __wm_scalar_94_0.args[0][1];
const layout_1268 = __wm_scalar_94_1;
const context_1269 = __wm_scalar_94_2;
const output_1270 = __wm_scalar_94_3;
{
const exactLayout_1271 = layout_1268;
const exactContext_1272 = context_1269;
const constructor_1273 = findConstructor_992__wm_d2(exactContext_1272.constructors, constructorId_1266);
{
const __wm_tail_arg_77_0 = rest_1267;
const __wm_tail_arg_77_1 = exactLayout_1271;
const __wm_tail_arg_77_2 = exactContext_1272;
const __wm_tail_arg_77_3 = (output_1270 + emitConstructorDeclaration_1257__wm_d3(constructor_1273, exactLayout_1271, exactContext_1272));
constructorIds_1259 = __wm_tail_arg_77_0;
layout_1260 = __wm_tail_arg_77_1;
context_1261 = __wm_tail_arg_77_2;
output_1262 = __wm_tail_arg_77_3;
continue __wm_tail_68;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitLayoutConstructors_1258 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitLayoutConstructors_1258__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitLayoutDeclaration_1277__wm_d2 = (layout_1274, context_1275) => {
const adt_1276 = findAdtForEmit_1056__wm_d2(Js.Array.toList(context_1275.input.adts), layout_1274.typeNameId);
return ((((("struct " + layoutName_921(layout_1274.id)) + " {\n  int tag;\n") + emitLayoutFields_1213__wm_d3(Js.Array.toList(layout_1274.fieldIds), context_1275, "")) + "};\n\n") + emitLayoutConstructors_1258__wm_d4(Js.Array.toList(adt_1276.constructorIds), layout_1274, context_1275, ""));
};
const emitLayoutDeclaration_1277 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitLayoutDeclaration_1277__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitLayoutDeclarations_1278__wm_d3 = (layouts_1279, context_1280, output_1281) => {
__wm_tail_69: while (true) {
{
const __wm_scalar_95_0 = layouts_1279;
const __wm_scalar_95_1 = context_1280;
const __wm_scalar_95_2 = output_1281;
if (__wm_scalar_95_0 === __wm_basis_Nil) {
const context_1282 = __wm_scalar_95_1;
const output_1283 = __wm_scalar_95_2;
return output_1283;
} else if (__wm_scalar_95_0?.ctor === -6 && __wm_scalar_95_0.args.length === 1 && __wm_is_tuple(__wm_scalar_95_0.args[0]) && __wm_scalar_95_0.args[0].length === 2) {
const layout_1284 = __wm_scalar_95_0.args[0][0];
const rest_1285 = __wm_scalar_95_0.args[0][1];
const context_1286 = __wm_scalar_95_1;
const output_1287 = __wm_scalar_95_2;
{
const exactLayout_1288 = layout_1284;
const exactContext_1289 = context_1286;
{
const __wm_tail_arg_78_0 = rest_1285;
const __wm_tail_arg_78_1 = exactContext_1289;
const __wm_tail_arg_78_2 = (output_1287 + emitLayoutDeclaration_1277__wm_d2(exactLayout_1288, exactContext_1289));
layouts_1279 = __wm_tail_arg_78_0;
context_1280 = __wm_tail_arg_78_1;
output_1281 = __wm_tail_arg_78_2;
continue __wm_tail_69;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitLayoutDeclarations_1278 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitLayoutDeclarations_1278__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitAtom_1294__wm_d2 = (atomId_1290, context_1291) => {
const atom_1292 = findAtom_1008__wm_d2(context_1291.atoms, atomId_1290);
const __wm_return_value_29 = atom_1292.kind;
if (__wm_return_value_29 === "local") {

return localName_911(atom_1292.localId);
} else if (__wm_return_value_29 === "number") {

const gpuType_1293 = findType_943__wm_d2(context_1291.types, atom_1292.typeId);
return (((__wm_eq(gpuType_1293.kind, "i32") ? "int(" : "float(") + text_909(atom_1292.numberValue)) + ")");
} else if (__wm_return_value_29 === "bool") {

if (atom_1292.boolValue) {
return "true";
} else {
return "false";
}
} else if (true) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const emitAtom_1294 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitAtom_1294__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitArgs_1295__wm_d3 = (atomIds_1296, context_1297, output_1298) => {
__wm_tail_70: while (true) {
{
const __wm_scalar_96_0 = atomIds_1296;
const __wm_scalar_96_1 = context_1297;
const __wm_scalar_96_2 = output_1298;
if (__wm_scalar_96_0 === __wm_basis_Nil) {
const context_1299 = __wm_scalar_96_1;
const output_1300 = __wm_scalar_96_2;
return output_1300;
} else if (__wm_scalar_96_0?.ctor === -6 && __wm_scalar_96_0.args.length === 1 && __wm_is_tuple(__wm_scalar_96_0.args[0]) && __wm_scalar_96_0.args[0].length === 2) {
const atomId_1301 = __wm_scalar_96_0.args[0][0];
const rest_1302 = __wm_scalar_96_0.args[0][1];
const context_1303 = __wm_scalar_96_1;
const output_1304 = __wm_scalar_96_2;
{
const argument_1305 = emitAtom_1294__wm_d2(atomId_1301, context_1303);
const next_1306 = (__wm_eq(output_1304, "") ? argument_1305 : ((output_1304 + ", ") + argument_1305));
{
const __wm_tail_arg_79_0 = rest_1302;
const __wm_tail_arg_79_1 = context_1303;
const __wm_tail_arg_79_2 = next_1306;
atomIds_1296 = __wm_tail_arg_79_0;
context_1297 = __wm_tail_arg_79_1;
output_1298 = __wm_tail_arg_79_2;
continue __wm_tail_70;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitArgs_1295 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitArgs_1295__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const operatorText_1308 = (__arg) => {
if (true) {
const operatorId_1307 = __arg;
const __wm_return_value_30 = operatorId_1307;
if (__wm_return_value_30 === "gpu.operator.negate") {

return "-";
} else if (__wm_return_value_30 === "gpu.operator.not") {

return "!";
} else if (__wm_return_value_30 === "gpu.operator.add") {

return "+";
} else if (__wm_return_value_30 === "gpu.operator.subtract") {

return "-";
} else if (__wm_return_value_30 === "gpu.operator.multiply") {

return "*";
} else if (__wm_return_value_30 === "gpu.operator.divide") {

return "/";
} else if (__wm_return_value_30 === "gpu.operator.remainder") {

return "%";
} else if (__wm_return_value_30 === "gpu.operator.less-than") {

return "<";
} else if (__wm_return_value_30 === "gpu.operator.less-than-or-equal") {

return "<=";
} else if (__wm_return_value_30 === "gpu.operator.greater-than") {

return ">";
} else if (__wm_return_value_30 === "gpu.operator.greater-than-or-equal") {

return ">=";
} else if (__wm_return_value_30 === "gpu.operator.equal") {

return "==";
} else if (__wm_return_value_30 === "gpu.operator.not-equal") {

return "!=";
} else if (__wm_return_value_30 === "gpu.operator.and") {

return "&&";
} else if (__wm_return_value_30 === "gpu.operator.or") {

return "||";
} else if (true) {

return __wm_fail("Panic", "unsupported Slang-emission operator");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const emitResourceCall_1317__wm_d3 = (operation_1309, args_1310, context_1311) => {
const __wm_return_value_31 = operation_1309.resourceOperation;
if (__wm_return_value_31 === "sample") {

const __wm_return_value_32 = args_1310;
if (__wm_return_value_32?.ctor === -6 && __wm_return_value_32.args.length === 1 && __wm_is_tuple(__wm_return_value_32.args[0]) && __wm_return_value_32.args[0].length === 2 && __wm_return_value_32.args[0][1]?.ctor === -6 && __wm_return_value_32.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_32.args[0][1].args[0]) && __wm_return_value_32.args[0][1].args[0].length === 2 && __wm_return_value_32.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_32.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_32.args[0][1].args[0][1].args[0]) && __wm_return_value_32.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_32.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const texture_1312 = __wm_return_value_32.args[0][0];
const sampler_1313 = __wm_return_value_32.args[0][1].args[0][0];
const coordinate_1314 = __wm_return_value_32.args[0][1].args[0][1].args[0][0];
return (((((emitAtom_1294__wm_d2(texture_1312, context_1311) + ".Sample(") + emitAtom_1294__wm_d2(sampler_1313, context_1311)) + ", ") + emitAtom_1294__wm_d2(coordinate_1314, context_1311)) + ")");
} else if (true) {

return __wm_fail("Panic", "texture Sample reached Slang emission with invalid arity");
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_31 === "load") {

const __wm_return_value_33 = args_1310;
if (__wm_return_value_33?.ctor === -6 && __wm_return_value_33.args.length === 1 && __wm_is_tuple(__wm_return_value_33.args[0]) && __wm_return_value_33.args[0].length === 2 && __wm_return_value_33.args[0][1]?.ctor === -6 && __wm_return_value_33.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_33.args[0][1].args[0]) && __wm_return_value_33.args[0][1].args[0].length === 2 && __wm_return_value_33.args[0][1].args[0][1] === __wm_basis_Nil) {
const texture_1315 = __wm_return_value_33.args[0][0];
const coordinate_1316 = __wm_return_value_33.args[0][1].args[0][0];
return (((emitAtom_1294__wm_d2(texture_1315, context_1311) + ".Load(") + emitAtom_1294__wm_d2(coordinate_1316, context_1311)) + ")");
} else if (true) {

return __wm_fail("Panic", "texture Load reached Slang emission with invalid arity");
}
__wm_fail("Match", "non-exhaustive match");
} else if (true) {

return __wm_fail("Panic", "resource call reached Slang emission without an operation");
}
__wm_fail("Match", "non-exhaustive match");
};
const emitResourceCall_1317 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitResourceCall_1317__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitPayload_1324__wm_d3 = (operation_1318, args_1319, context_1320) => {
const base_1321 = ((emitArgs_1295__wm_d3(args_1319, context_1320, "") + ".") + payloadFieldName_925(operation_1318.fieldId));
if ((operation_1318.index < 0)) {
return base_1321;
} else {
const field_1322 = findField_984__wm_d2(context_1320.fields, operation_1318.fieldId);
const fieldType_1323 = findType_943__wm_d2(context_1320.types, field_1322.typeId);
return (base_1321 + (__wm_eq(fieldType_1323.kind, "vector") ? ("." + vectorLaneName_942(operation_1318.index)) : ("." + tupleFieldName_919(operation_1318.index))));
}
};
const emitPayload_1324 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitPayload_1324__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitProjection_1331__wm_d3 = (operation_1325, args_1326, context_1327) => {
const __wm_return_value_34 = args_1326;
if (__wm_return_value_34?.ctor === -6 && __wm_return_value_34.args.length === 1 && __wm_is_tuple(__wm_return_value_34.args[0]) && __wm_return_value_34.args[0].length === 2 && __wm_return_value_34.args[0][1] === __wm_basis_Nil) {
const atomId_1328 = __wm_return_value_34.args[0][0];
const atom_1329 = findAtom_1008__wm_d2(context_1327.atoms, atomId_1328);
const sourceType_1330 = findType_943__wm_d2(context_1327.types, atom_1329.typeId);
if (__wm_eq(sourceType_1330.kind, "vector")) {
return ((emitAtom_1294__wm_d2(atomId_1328, context_1327) + ".") + vectorLaneName_942(operation_1325.index));
} else {
return ((emitAtom_1294__wm_d2(atomId_1328, context_1327) + ".") + tupleFieldName_919(operation_1325.index));
}
} else if (true) {

return __wm_fail("Panic", "projection reached Slang emission with invalid arity");
}
__wm_fail("Match", "non-exhaustive match");
};
const emitProjection_1331 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitProjection_1331__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitOperatorOperation_1341__wm_d3 = (operation_1332, args_1333, context_1334) => {
const signedMinimum_1337 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2 && __v.args[0][1] === __wm_basis_Nil) {
const atomId_1335 = __v.args[0][0];
const atom_1336 = findAtom_1008__wm_d2(context_1334.atoms, atomId_1335);
return __wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(__wm_eq(operation_1332.operatorId, "gpu.operator.negate"), __wm_eq(atom_1336.kind, "number")), __wm_eq(atom_1336.numberKind, "i32")), numberEqual_146__wm_d2(atom_1336.numberValue, 2147483648));
} else if (true) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
})(args_1333);
if (signedMinimum_1337) {
return "int(-2147483648)";
} else {
const __wm_return_value_35 = args_1333;
if (__wm_return_value_35?.ctor === -6 && __wm_return_value_35.args.length === 1 && __wm_is_tuple(__wm_return_value_35.args[0]) && __wm_return_value_35.args[0].length === 2 && __wm_return_value_35.args[0][1] === __wm_basis_Nil) {
const left_1338 = __wm_return_value_35.args[0][0];
return ((("(" + operatorText_1308(operation_1332.operatorId)) + emitAtom_1294__wm_d2(left_1338, context_1334)) + ")");
} else if (__wm_return_value_35?.ctor === -6 && __wm_return_value_35.args.length === 1 && __wm_is_tuple(__wm_return_value_35.args[0]) && __wm_return_value_35.args[0].length === 2 && __wm_return_value_35.args[0][1]?.ctor === -6 && __wm_return_value_35.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_35.args[0][1].args[0]) && __wm_return_value_35.args[0][1].args[0].length === 2 && __wm_return_value_35.args[0][1].args[0][1] === __wm_basis_Nil) {
const left_1339 = __wm_return_value_35.args[0][0];
const right_1340 = __wm_return_value_35.args[0][1].args[0][0];
return (((((("(" + emitAtom_1294__wm_d2(left_1339, context_1334)) + " ") + operatorText_1308(operation_1332.operatorId)) + " ") + emitAtom_1294__wm_d2(right_1340, context_1334)) + ")");
} else if (true) {

return __wm_fail("Panic", "operator reached Slang emission with invalid arity");
}
__wm_fail("Match", "non-exhaustive match");
}
};
const emitOperatorOperation_1341 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitOperatorOperation_1341__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitOperation_1351__wm_d2 = (operation_1342, context_1343) => {
const args_1344 = Js.Array.toList(operation_1342.args);
const __wm_return_value_36 = operation_1342.kind;
if (__wm_return_value_36 === "uniform") {

const field_1345 = findEnvironmentField_957__wm_d3(context_1343.environmentFields, context_1343.input.root.environmentId, operation_1342.index);
const access_1346 = (context_1343.portable ? (("WM_UNIFORM_" + text_909(field_1345.declaredIndex)) + "()") : ("wm_uniforms." + uniformFieldName_927(field_1345.declaredIndex)));
const gpuType_1347 = findType_943__wm_d2(context_1343.types, field_1345.typeId);
if (__wm_op_and_d2(__wm_eq(gpuType_1347.kind, "bool"), __wm_op_not(context_1343.portable))) {
return (("(" + access_1346) + " != 0)");
} else {
return access_1346;
}
} else if (__wm_return_value_36 === "resource") {

const field_1348 = findEnvironmentField_957__wm_d3(context_1343.environmentFields, context_1343.input.root.environmentId, operation_1342.index);
if (context_1343.portable) {
return (("WM_RESOURCE_" + text_909(field_1348.binding)) + "()");
} else {
return resourceFieldName_929(field_1348.binding);
}
} else if (__wm_return_value_36 === "resource-call") {

return emitResourceCall_1317__wm_d3(operation_1342, args_1344, context_1343);
} else if (__wm_return_value_36 === "copy") {

return emitArgs_1295__wm_d3(args_1344, context_1343, "");
} else if (__wm_return_value_36 === "tuple") {

const resultType_1349 = findType_943__wm_d2(context_1343.types, operation_1342.typeId);
const constructor_1350 = (__wm_eq(resultType_1349.kind, "vector") ? vectorName_956__wm_d2(resultType_1349, context_1343) : tupleFactoryName_917(operation_1342.typeId));
return (((constructor_1350 + "(") + emitArgs_1295__wm_d3(args_1344, context_1343, "")) + ")");
} else if (__wm_return_value_36 === "project") {

return emitProjection_1331__wm_d3(operation_1342, args_1344, context_1343);
} else if (__wm_return_value_36 === "call") {

return (((functionName_913(operation_1342.targetFunctionId) + "(") + emitArgs_1295__wm_d3(args_1344, context_1343, "")) + ")");
} else if (__wm_return_value_36 === "convert") {

return (((typeName_1076__wm_d2(operation_1342.typeId, context_1343) + "(") + emitArgs_1295__wm_d3(args_1344, context_1343, "")) + ")");
} else if (__wm_return_value_36 === "builtin") {

return (((operation_1342.builtinName + "(") + emitArgs_1295__wm_d3(args_1344, context_1343, "")) + ")");
} else if (__wm_return_value_36 === "construct") {

return (((constructorName_923(operation_1342.constructorId) + "(") + emitArgs_1295__wm_d3(args_1344, context_1343, "")) + ")");
} else if (__wm_return_value_36 === "payload") {

return emitPayload_1324__wm_d3(operation_1342, args_1344, context_1343);
} else if (__wm_return_value_36 === "binary") {

return emitOperatorOperation_1341__wm_d3(operation_1342, args_1344, context_1343);
} else if (__wm_return_value_36 === "unary") {

return emitOperatorOperation_1341__wm_d3(operation_1342, args_1344, context_1343);
} else if (true) {

return __wm_fail("Panic", "unsupported Slang-emission operation");
}
__wm_fail("Match", "non-exhaustive match");
};
const emitOperation_1351 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitOperation_1351__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitBlockStatements_1352__wm_d4 = (statementIds_1357, indent_1358, context_1359, output_1360) => {
__wm_tail_71: while (true) {
{
const __wm_scalar_97_0 = statementIds_1357;
const __wm_scalar_97_1 = indent_1358;
const __wm_scalar_97_2 = context_1359;
const __wm_scalar_97_3 = output_1360;
if (__wm_scalar_97_0 === __wm_basis_Nil) {
const indent_1361 = __wm_scalar_97_1;
const context_1362 = __wm_scalar_97_2;
const output_1363 = __wm_scalar_97_3;
return output_1363;
} else if (__wm_scalar_97_0?.ctor === -6 && __wm_scalar_97_0.args.length === 1 && __wm_is_tuple(__wm_scalar_97_0.args[0]) && __wm_scalar_97_0.args[0].length === 2) {
const statementId_1364 = __wm_scalar_97_0.args[0][0];
const rest_1365 = __wm_scalar_97_0.args[0][1];
const indent_1366 = __wm_scalar_97_1;
const context_1367 = __wm_scalar_97_2;
const output_1368 = __wm_scalar_97_3;
{
const statement_1369 = findStatement_1024__wm_d2(context_1367.statements, statementId_1364);
{
const __wm_tail_arg_80_0 = rest_1365;
const __wm_tail_arg_80_1 = indent_1366;
const __wm_tail_arg_80_2 = context_1367;
const __wm_tail_arg_80_3 = (output_1368 + emitStatement_1356__wm_d3(statement_1369, indent_1366, context_1367));
statementIds_1357 = __wm_tail_arg_80_0;
indent_1358 = __wm_tail_arg_80_1;
context_1359 = __wm_tail_arg_80_2;
output_1360 = __wm_tail_arg_80_3;
continue __wm_tail_71;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitBlockStatements_1352 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitBlockStatements_1352__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitBlock_1353__wm_d3 = (blockId_1370, indent_1371, context_1372) => {
const block_1373 = findBlock_1032__wm_d2(context_1372.blocks, blockId_1370);
return emitBlockStatements_1352__wm_d4(Js.Array.toList(block_1373.statementIds), indent_1371, context_1372, "");
};
const emitBlock_1353 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitBlock_1353__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitCases_1354__wm_d4 = (caseIds_1374, indent_1375, context_1376, output_1377) => {
__wm_tail_72: while (true) {
{
const __wm_scalar_98_0 = caseIds_1374;
const __wm_scalar_98_1 = indent_1375;
const __wm_scalar_98_2 = context_1376;
const __wm_scalar_98_3 = output_1377;
if (__wm_scalar_98_0 === __wm_basis_Nil) {
const indent_1378 = __wm_scalar_98_1;
const context_1379 = __wm_scalar_98_2;
const output_1380 = __wm_scalar_98_3;
return output_1380;
} else if (__wm_scalar_98_0?.ctor === -6 && __wm_scalar_98_0.args.length === 1 && __wm_is_tuple(__wm_scalar_98_0.args[0]) && __wm_scalar_98_0.args[0].length === 2) {
const caseId_1381 = __wm_scalar_98_0.args[0][0];
const rest_1382 = __wm_scalar_98_0.args[0][1];
const indent_1383 = __wm_scalar_98_1;
const context_1384 = __wm_scalar_98_2;
const output_1385 = __wm_scalar_98_3;
{
const gpuCase_1386 = findCase_1040__wm_d2(context_1384.cases, caseId_1381);
const item_1387 = ((((((((indent_1383 + "case ") + text_909(gpuCase_1386.tag)) + ": {\n") + emitBlock_1353__wm_d3(gpuCase_1386.blockId, (indent_1383 + "  "), context_1384)) + indent_1383) + "  break;\n") + indent_1383) + "}\n");
{
const __wm_tail_arg_81_0 = rest_1382;
const __wm_tail_arg_81_1 = indent_1383;
const __wm_tail_arg_81_2 = context_1384;
const __wm_tail_arg_81_3 = (output_1385 + item_1387);
caseIds_1374 = __wm_tail_arg_81_0;
indent_1375 = __wm_tail_arg_81_1;
context_1376 = __wm_tail_arg_81_2;
output_1377 = __wm_tail_arg_81_3;
continue __wm_tail_72;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitCases_1354 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitCases_1354__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitParallelAssignments_1355__wm_d5 = (targetIds_1388, valueIds_1389, indent_1390, context_1391, output_1392) => {
__wm_tail_73: while (true) {
{
const __wm_tail_value_82 = [targetIds_1388, valueIds_1389, indent_1390, context_1391, output_1392];
if (__wm_tail_value_82[0] === __wm_basis_Nil && __wm_tail_value_82[1] === __wm_basis_Nil) {
const indent_1393 = __wm_tail_value_82[2];
const context_1394 = __wm_tail_value_82[3];
const output_1395 = __wm_tail_value_82[4];
return output_1395;
} else if (__wm_tail_value_82[0]?.ctor === -6 && __wm_tail_value_82[0].args.length === 1 && __wm_is_tuple(__wm_tail_value_82[0].args[0]) && __wm_tail_value_82[0].args[0].length === 2 && __wm_tail_value_82[1]?.ctor === -6 && __wm_tail_value_82[1].args.length === 1 && __wm_is_tuple(__wm_tail_value_82[1].args[0]) && __wm_tail_value_82[1].args[0].length === 2) {
const targetId_1396 = __wm_tail_value_82[0].args[0][0];
const targetRest_1397 = __wm_tail_value_82[0].args[0][1];
const valueId_1398 = __wm_tail_value_82[1].args[0][0];
const valueRest_1399 = __wm_tail_value_82[1].args[0][1];
const indent_1400 = __wm_tail_value_82[2];
const context_1401 = __wm_tail_value_82[3];
const output_1402 = __wm_tail_value_82[4];
{
const __wm_tail_arg_83_0 = targetRest_1397;
const __wm_tail_arg_83_1 = valueRest_1399;
const __wm_tail_arg_83_2 = indent_1400;
const __wm_tail_arg_83_3 = context_1401;
const __wm_tail_arg_83_4 = (((((output_1402 + indent_1400) + localName_911(targetId_1396)) + " = ") + emitAtom_1294__wm_d2(valueId_1398, context_1401)) + ";\n");
targetIds_1388 = __wm_tail_arg_83_0;
valueIds_1389 = __wm_tail_arg_83_1;
indent_1390 = __wm_tail_arg_83_2;
context_1391 = __wm_tail_arg_83_3;
output_1392 = __wm_tail_arg_83_4;
continue __wm_tail_73;
}
} else if (true) {

return __wm_fail("Panic", "parallel tail update arity changed after validation");
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitParallelAssignments_1355 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return emitParallelAssignments_1355__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const emitStatement_1356__wm_d3 = (statement_1403, indent_1404, context_1405) => {
if (__wm_eq(statement_1403.kind, "let")) {
const local_1406 = findLocal_1000__wm_d2(context_1405.locals, statement_1403.localId);
const operation_1407 = findOperation_1016__wm_d2(context_1405.operations, statement_1403.operationId);
return ((((((indent_1404 + typeName_1076__wm_d2(local_1406.typeId, context_1405)) + " ") + localName_911(local_1406.id)) + " = ") + emitOperation_1351__wm_d2(operation_1407, context_1405)) + ";\n");
} else {
if (__wm_eq(statement_1403.kind, "assign")) {
return ((((indent_1404 + localName_911(statement_1403.localId)) + " = ") + emitAtom_1294__wm_d2(statement_1403.atomId, context_1405)) + ";\n");
} else {
if (__wm_eq(statement_1403.kind, "if")) {
const join_1409 = (numberEqual_146__wm_d2(statement_1403.localId, __wm_op_sub(1)) ? "" : (() => {
const local_1408 = findLocal_1000__wm_d2(context_1405.locals, statement_1403.localId);
return ((((indent_1404 + typeName_1076__wm_d2(local_1408.typeId, context_1405)) + " ") + localName_911(local_1408.id)) + ";\n");
})());
return ((((((((((join_1409 + indent_1404) + "if (") + emitAtom_1294__wm_d2(statement_1403.conditionAtomId, context_1405)) + ") {\n") + emitBlock_1353__wm_d3(statement_1403.thenBlockId, (indent_1404 + "  "), context_1405)) + indent_1404) + "} else {\n") + emitBlock_1353__wm_d3(statement_1403.elseBlockId, (indent_1404 + "  "), context_1405)) + indent_1404) + "}\n");
} else {
if (__wm_eq(statement_1403.kind, "switch")) {
const join_1411 = (numberEqual_146__wm_d2(statement_1403.localId, __wm_op_sub(1)) ? "" : (() => {
const local_1410 = findLocal_1000__wm_d2(context_1405.locals, statement_1403.localId);
return ((((indent_1404 + typeName_1076__wm_d2(local_1410.typeId, context_1405)) + " ") + localName_911(local_1410.id)) + ";\n");
})());
return (((((((join_1411 + indent_1404) + "switch (") + emitAtom_1294__wm_d2(statement_1403.scrutineeAtomId, context_1405)) + ".tag) {\n") + emitCases_1354__wm_d4(Js.Array.toList(statement_1403.caseIds), (indent_1404 + "  "), context_1405, "")) + indent_1404) + "}\n");
} else {
if (__wm_eq(statement_1403.kind, "loop")) {
return ((((((indent_1404 + "while (!") + recursiveDoneName_933(statement_1403.functionId)) + ") {\n") + emitBlock_1353__wm_d3(statement_1403.bodyBlockId, (indent_1404 + "  "), context_1405)) + indent_1404) + "}\n");
} else {
if (__wm_eq(statement_1403.kind, "continue")) {
return ((emitParallelAssignments_1355__wm_d5(Js.Array.toList(statement_1403.targetLocalIds), Js.Array.toList(statement_1403.valueAtomIds), indent_1404, context_1405, "") + indent_1404) + "continue;\n");
} else {
const atom_1412 = findAtom_1008__wm_d2(context_1405.atoms, statement_1403.atomId);
if (__wm_eq(atom_1412.kind, "void")) {
if (numberEqual_146__wm_d2(context_1405.recursiveFunctionId, statement_1403.functionId)) {
return ((indent_1404 + recursiveDoneName_933(statement_1403.functionId)) + " = true;\n");
} else {
return (indent_1404 + "return;\n");
}
} else {
if (numberEqual_146__wm_d2(context_1405.recursiveFunctionId, statement_1403.functionId)) {
return (((((((indent_1404 + recursiveResultName_931(statement_1403.functionId)) + " = ") + emitAtom_1294__wm_d2(statement_1403.atomId, context_1405)) + ";\n") + indent_1404) + recursiveDoneName_933(statement_1403.functionId)) + " = true;\n");
} else {
return (((indent_1404 + "return ") + emitAtom_1294__wm_d2(statement_1403.atomId, context_1405)) + ";\n");
}
}
}
}
}
}
}
}
};
const emitStatement_1356 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitStatement_1356__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitFunctionParams_1413__wm_d3 = (localIds_1414, context_1415, output_1416) => {
__wm_tail_74: while (true) {
{
const __wm_scalar_99_0 = localIds_1414;
const __wm_scalar_99_1 = context_1415;
const __wm_scalar_99_2 = output_1416;
if (__wm_scalar_99_0 === __wm_basis_Nil) {
const context_1417 = __wm_scalar_99_1;
const output_1418 = __wm_scalar_99_2;
return output_1418;
} else if (__wm_scalar_99_0?.ctor === -6 && __wm_scalar_99_0.args.length === 1 && __wm_is_tuple(__wm_scalar_99_0.args[0]) && __wm_scalar_99_0.args[0].length === 2) {
const localId_1419 = __wm_scalar_99_0.args[0][0];
const rest_1420 = __wm_scalar_99_0.args[0][1];
const context_1421 = __wm_scalar_99_1;
const output_1422 = __wm_scalar_99_2;
{
const local_1423 = findLocal_1000__wm_d2(context_1421.locals, localId_1419);
const parameter_1424 = ((typeName_1076__wm_d2(local_1423.typeId, context_1421) + " ") + localName_911(local_1423.id));
const next_1425 = (__wm_eq(output_1422, "") ? parameter_1424 : ((output_1422 + ", ") + parameter_1424));
{
const __wm_tail_arg_84_0 = rest_1420;
const __wm_tail_arg_84_1 = context_1421;
const __wm_tail_arg_84_2 = next_1425;
localIds_1414 = __wm_tail_arg_84_0;
context_1415 = __wm_tail_arg_84_1;
output_1416 = __wm_tail_arg_84_2;
continue __wm_tail_74;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitFunctionParams_1413 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitFunctionParams_1413__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitFunction_1435__wm_d2 = (fn_1426, context_1427) => {
const source_1428 = findSourceFunction_1064__wm_d2(Js.Array.toList(context_1427.input.functions), fn_1426.functionId);
const functionContext_1429 = { ...context_1427, recursiveFunctionId: (fn_1426.recursive ? fn_1426.functionId : __wm_op_sub(1)), portable: context_1427.portable };
const resultType_1430 = findType_943__wm_d2(context_1427.types, source_1428.resultTypeId);
const recursivePrefix_1432 = (fn_1426.recursive ? (() => {
const result_1431 = (__wm_eq(resultType_1430.kind, "void") ? "" : (((("  " + typeName_1076__wm_d2(source_1428.resultTypeId, context_1427)) + " ") + recursiveResultName_931(fn_1426.functionId)) + ";\n"));
return (((result_1431 + "  bool ") + recursiveDoneName_933(fn_1426.functionId)) + " = false;\n");
})() : "");
const recursiveSuffix_1433 = (fn_1426.recursive ? (__wm_eq(resultType_1430.kind, "void") ? "  return;\n" : (("  return " + recursiveResultName_931(fn_1426.functionId)) + ";\n")) : "");
const linkage_1434 = (__wm_op_and_d2(context_1427.portable, numberEqual_146__wm_d2(fn_1426.functionId, context_1427.input.root.functionId)) ? "export __extern_cpp " : "");
return ((((((((((linkage_1434 + typeName_1076__wm_d2(source_1428.resultTypeId, context_1427)) + " ") + functionName_913(fn_1426.functionId)) + "(") + emitFunctionParams_1413__wm_d3(Js.Array.toList(fn_1426.physicalParamLocalIds), context_1427, "")) + ") {\n") + recursivePrefix_1432) + emitBlock_1353__wm_d3(fn_1426.bodyBlockId, "  ", functionContext_1429)) + recursiveSuffix_1433) + "}\n\n");
};
const emitFunction_1435 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitFunction_1435__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitFunctions_1436__wm_d3 = (functions_1437, context_1438, output_1439) => {
__wm_tail_75: while (true) {
{
const __wm_scalar_100_0 = functions_1437;
const __wm_scalar_100_1 = context_1438;
const __wm_scalar_100_2 = output_1439;
if (__wm_scalar_100_0 === __wm_basis_Nil) {
const context_1440 = __wm_scalar_100_1;
const output_1441 = __wm_scalar_100_2;
return output_1441;
} else if (__wm_scalar_100_0?.ctor === -6 && __wm_scalar_100_0.args.length === 1 && __wm_is_tuple(__wm_scalar_100_0.args[0]) && __wm_scalar_100_0.args[0].length === 2) {
const fn_1442 = __wm_scalar_100_0.args[0][0];
const rest_1443 = __wm_scalar_100_0.args[0][1];
const context_1444 = __wm_scalar_100_1;
const output_1445 = __wm_scalar_100_2;
{
const __wm_tail_arg_85_0 = rest_1443;
const __wm_tail_arg_85_1 = context_1444;
const __wm_tail_arg_85_2 = (output_1445 + emitFunction_1435__wm_d2(fn_1442, context_1444));
functions_1437 = __wm_tail_arg_85_0;
context_1438 = __wm_tail_arg_85_1;
output_1439 = __wm_tail_arg_85_2;
continue __wm_tail_75;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitFunctions_1436 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitFunctions_1436__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitWrappers_1452 = (__arg) => {
if (true) {
const context_1446 = __arg;
const input_1447 = context_1446.input;
const rootRow_1448 = input_1447.root;
const root_1449 = findFunction_1048__wm_d2(context_1446.functions, rootRow_1448.functionId);
const __wm_return_value_37 = Js.Array.toList(root_1449.physicalParamLocalIds);
if (__wm_return_value_37?.ctor === -6 && __wm_return_value_37.args.length === 1 && __wm_is_tuple(__wm_return_value_37.args[0]) && __wm_return_value_37.args[0].length === 2 && __wm_return_value_37.args[0][1] === __wm_basis_Nil) {
const coordLocalId_1450 = __wm_return_value_37.args[0][0];
const coordLocal_1451 = findLocal_1000__wm_d2(context_1446.locals, coordLocalId_1450);
return (((((((((((("[shader(\"vertex\")]\n" + "float4 wm_vertex(uint vertexID : SV_VertexID) : SV_Position {\n") + "  float2 uv = float2((vertexID << 1) & 2, vertexID & 2);\n") + "  return float4(uv * 2.0 - 1.0, 0.0, 1.0);\n") + "}\n\n") + "[shader(\"fragment\")]\n") + "float4 wm_fragment(float4 position : SV_Position) : SV_Target {\n") + "  return ") + functionName_913(root_1449.functionId)) + "(") + typeName_1076__wm_d2(coordLocal_1451.typeId, context_1446)) + "(position.x, position.y));\n") + "}\n");
} else if (true) {

return __wm_fail("Panic", "v1 fragment root does not have one physical coordinate parameter");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const emitSliceSlangModule_1464__wm_d10 = (input_1453, layouts_1454, fields_1455, functions_1456, locals_1457, atoms_1458, operations_1459, statements_1460, blocks_1461, cases_1462) => {
const context_1463 = { input: input_1453, environmentFields: Js.Array.toList(input_1453.environmentFields), types: Js.Array.toList(input_1453.types), constructors: Js.Array.toList(input_1453.constructors), layouts: Js.Array.toList(layouts_1454), fields: Js.Array.toList(fields_1455), functions: Js.Array.toList(functions_1456), locals: Js.Array.toList(locals_1457), atoms: Js.Array.toList(atoms_1458), operations: Js.Array.toList(operations_1459), statements: Js.Array.toList(statements_1460), blocks: Js.Array.toList(blocks_1461), cases: Js.Array.toList(cases_1462), recursiveFunctionId: __wm_op_sub(1), portable: true };
return ((((("// Generated by wmslang visual v2.\n\n" + emitPortableEnvironmentAccessors_1113__wm_d3(context_1463.environmentFields, context_1463, "")) + emitTupleDeclarations_1182__wm_d3(context_1463.types, context_1463, "")) + emitLayoutDeclarations_1278__wm_d3(context_1463.layouts, context_1463, "")) + emitEnvironmentDeclaration_1112(context_1463)) + emitFunctions_1436__wm_d3(context_1463.functions, context_1463, ""));
};
const emitSliceSlangModule_1464 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return emitSliceSlangModule_1464__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
const emitSliceCallableName_1466 = (__arg) => {
if (true) {
const input_1465 = __arg;
return functionName_913(input_1465.root.functionId);
}
__wm_fail("Match", "pattern match failure in function");
};
const emitSliceSlang_1478__wm_d10 = (input_1467, layouts_1468, fields_1469, functions_1470, locals_1471, atoms_1472, operations_1473, statements_1474, blocks_1475, cases_1476) => {
const context_1477 = { input: input_1467, environmentFields: Js.Array.toList(input_1467.environmentFields), types: Js.Array.toList(input_1467.types), constructors: Js.Array.toList(input_1467.constructors), layouts: Js.Array.toList(layouts_1468), fields: Js.Array.toList(fields_1469), functions: Js.Array.toList(functions_1470), locals: Js.Array.toList(locals_1471), atoms: Js.Array.toList(atoms_1472), operations: Js.Array.toList(operations_1473), statements: Js.Array.toList(statements_1474), blocks: Js.Array.toList(blocks_1475), cases: Js.Array.toList(cases_1476), recursiveFunctionId: __wm_op_sub(1), portable: false };
return ((((("// Generated by wmslang visual v2.\n\n" + emitTupleDeclarations_1182__wm_d3(context_1477.types, context_1477, "")) + emitLayoutDeclarations_1278__wm_d3(context_1477.layouts, context_1477, "")) + emitEnvironmentDeclaration_1112(context_1477)) + emitFunctions_1436__wm_d3(context_1477.functions, context_1477, "")) + emitWrappers_1452(context_1477));
};
const emitSliceSlang_1478 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return emitSliceSlang_1478__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
return { "SliceEmitContext": SliceEmitContext_907, "text": text_909, "localName": localName_911, "functionName": functionName_913, "tupleName": tupleName_915, "tupleFactoryName": tupleFactoryName_917, "tupleFieldName": tupleFieldName_919, "layoutName": layoutName_921, "constructorName": constructorName_923, "payloadFieldName": payloadFieldName_925, "uniformFieldName": uniformFieldName_927, "resourceFieldName": resourceFieldName_929, "recursiveResultName": recursiveResultName_931, "recursiveDoneName": recursiveDoneName_933, "listLength": listLength_934, "listLength__wm_d2": listLength_934__wm_d2, "vectorLaneName": vectorLaneName_942, "findType": findType_943, "findType__wm_d2": findType_943__wm_d2, "vectorName": vectorName_956, "vectorName__wm_d2": vectorName_956__wm_d2, "findEnvironmentField": findEnvironmentField_957, "findEnvironmentField__wm_d3": findEnvironmentField_957__wm_d3, "findLayout": findLayout_968, "findLayout__wm_d2": findLayout_968__wm_d2, "findLayoutByType": findLayoutByType_976, "findLayoutByType__wm_d2": findLayoutByType_976__wm_d2, "findField": findField_984, "findField__wm_d2": findField_984__wm_d2, "findConstructor": findConstructor_992, "findConstructor__wm_d2": findConstructor_992__wm_d2, "findLocal": findLocal_1000, "findLocal__wm_d2": findLocal_1000__wm_d2, "findAtom": findAtom_1008, "findAtom__wm_d2": findAtom_1008__wm_d2, "findOperation": findOperation_1016, "findOperation__wm_d2": findOperation_1016__wm_d2, "findStatement": findStatement_1024, "findStatement__wm_d2": findStatement_1024__wm_d2, "findBlock": findBlock_1032, "findBlock__wm_d2": findBlock_1032__wm_d2, "findCase": findCase_1040, "findCase__wm_d2": findCase_1040__wm_d2, "findFunction": findFunction_1048, "findFunction__wm_d2": findFunction_1048__wm_d2, "findAdtForEmit": findAdtForEmit_1056, "findAdtForEmit__wm_d2": findAdtForEmit_1056__wm_d2, "findSourceFunction": findSourceFunction_1064, "findSourceFunction__wm_d2": findSourceFunction_1064__wm_d2, "typeName": typeName_1076, "typeName__wm_d2": typeName_1076__wm_d2, "emitEnvironmentFields": emitEnvironmentFields_1077, "emitEnvironmentFields__wm_d3": emitEnvironmentFields_1077__wm_d3, "hasUniformField": hasUniformField_1091, "emitResourceDeclarations": emitResourceDeclarations_1096, "emitResourceDeclarations__wm_d3": emitResourceDeclarations_1096__wm_d3, "emitEnvironmentDeclaration": emitEnvironmentDeclaration_1112, "emitPortableEnvironmentAccessors": emitPortableEnvironmentAccessors_1113, "emitPortableEnvironmentAccessors__wm_d3": emitPortableEnvironmentAccessors_1113__wm_d3, "joinText": joinText_1128, "joinText__wm_d3": joinText_1128__wm_d3, "emitTupleFields": emitTupleFields_1139, "emitTupleFields__wm_d4": emitTupleFields_1139__wm_d4, "emitTupleParams": emitTupleParams_1152, "emitTupleParams__wm_d4": emitTupleParams_1152__wm_d4, "emitTupleAssignments": emitTupleAssignments_1167, "emitTupleAssignments__wm_d3": emitTupleAssignments_1167__wm_d3, "emitTupleDeclaration": emitTupleDeclaration_1181, "emitTupleDeclaration__wm_d2": emitTupleDeclaration_1181__wm_d2, "emitTupleDeclarations": emitTupleDeclarations_1182, "emitTupleDeclarations__wm_d3": emitTupleDeclarations_1182__wm_d3, "zeroArgs": zeroArgs_1195, "zeroArgs__wm_d4": zeroArgs_1195__wm_d4, "zeroValue": zeroValue_1196, "zeroValue__wm_d2": zeroValue_1196__wm_d2, "emitLayoutFields": emitLayoutFields_1213, "emitLayoutFields__wm_d3": emitLayoutFields_1213__wm_d3, "fieldsForEmit": fieldsForEmit_1225, "fieldsForEmit__wm_d2": fieldsForEmit_1225__wm_d2, "emitConstructorFieldAssignments": emitConstructorFieldAssignments_1233, "emitConstructorFieldAssignments__wm_d5": emitConstructorFieldAssignments_1233__wm_d5, "emitConstructorDeclaration": emitConstructorDeclaration_1257, "emitConstructorDeclaration__wm_d3": emitConstructorDeclaration_1257__wm_d3, "emitLayoutConstructors": emitLayoutConstructors_1258, "emitLayoutConstructors__wm_d4": emitLayoutConstructors_1258__wm_d4, "emitLayoutDeclaration": emitLayoutDeclaration_1277, "emitLayoutDeclaration__wm_d2": emitLayoutDeclaration_1277__wm_d2, "emitLayoutDeclarations": emitLayoutDeclarations_1278, "emitLayoutDeclarations__wm_d3": emitLayoutDeclarations_1278__wm_d3, "emitAtom": emitAtom_1294, "emitAtom__wm_d2": emitAtom_1294__wm_d2, "emitArgs": emitArgs_1295, "emitArgs__wm_d3": emitArgs_1295__wm_d3, "operatorText": operatorText_1308, "emitResourceCall": emitResourceCall_1317, "emitResourceCall__wm_d3": emitResourceCall_1317__wm_d3, "emitPayload": emitPayload_1324, "emitPayload__wm_d3": emitPayload_1324__wm_d3, "emitProjection": emitProjection_1331, "emitProjection__wm_d3": emitProjection_1331__wm_d3, "emitOperatorOperation": emitOperatorOperation_1341, "emitOperatorOperation__wm_d3": emitOperatorOperation_1341__wm_d3, "emitOperation": emitOperation_1351, "emitOperation__wm_d2": emitOperation_1351__wm_d2, "emitBlockStatements": emitBlockStatements_1352, "emitBlockStatements__wm_d4": emitBlockStatements_1352__wm_d4, "emitBlock": emitBlock_1353, "emitBlock__wm_d3": emitBlock_1353__wm_d3, "emitCases": emitCases_1354, "emitCases__wm_d4": emitCases_1354__wm_d4, "emitParallelAssignments": emitParallelAssignments_1355, "emitParallelAssignments__wm_d5": emitParallelAssignments_1355__wm_d5, "emitStatement": emitStatement_1356, "emitStatement__wm_d3": emitStatement_1356__wm_d3, "emitFunctionParams": emitFunctionParams_1413, "emitFunctionParams__wm_d3": emitFunctionParams_1413__wm_d3, "emitFunction": emitFunction_1435, "emitFunction__wm_d2": emitFunction_1435__wm_d2, "emitFunctions": emitFunctions_1436, "emitFunctions__wm_d3": emitFunctions_1436__wm_d3, "emitWrappers": emitWrappers_1452, "emitSliceSlangModule": emitSliceSlangModule_1464, "emitSliceSlangModule__wm_d10": emitSliceSlangModule_1464__wm_d10, "emitSliceCallableName": emitSliceCallableName_1466, "emitSliceSlang": emitSliceSlang_1478, "emitSliceSlang__wm_d10": emitSliceSlang_1478__wm_d10 };
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
const NumericContext_1479 = (__record_args) => ({ expressionOffset: __record_args[0], fieldOffset: __record_args[1], types: __record_args[2], expressions: __record_args[3], patterns: __record_args[4], params: __record_args[5], lets: __record_args[6], blocks: __record_args[7], functions: __record_args[8], environmentFields: __record_args[9], exprNodes: __record_args[10], patternNodes: __record_args[11], patternByBinding: __record_args[12], lanes: __record_args[13] });
const NumericEvidence_1480 = (__record_args) => ({ representation: __record_args[0], spanId: __record_args[1] });
const numberEqual_1483__wm_d2 = (left_1481, right_1482) => {
return __wm_op_and_d2(__wm_op_not((left_1481 < right_1482)), __wm_op_not((left_1481 > right_1482)));
};
const numberEqual_1483 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numberEqual_1483__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const listLength_1484__wm_d2 = (items_1485, length_1486) => {
__wm_tail_76: while (true) {
{
const __wm_scalar_101_0 = items_1485;
const __wm_scalar_101_1 = length_1486;
if (__wm_scalar_101_0 === __wm_basis_Nil) {
const length_1487 = __wm_scalar_101_1;
return length_1487;
} else if (__wm_scalar_101_0?.ctor === -6 && __wm_scalar_101_0.args.length === 1 && __wm_is_tuple(__wm_scalar_101_0.args[0]) && __wm_scalar_101_0.args[0].length === 2) {
const __1488 = __wm_scalar_101_0.args[0][0];
const rest_1489 = __wm_scalar_101_0.args[0][1];
const length_1490 = __wm_scalar_101_1;
{
const __wm_tail_arg_86_0 = rest_1489;
const __wm_tail_arg_86_1 = (length_1490 + 1);
items_1485 = __wm_tail_arg_86_0;
length_1486 = __wm_tail_arg_86_1;
continue __wm_tail_76;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const listLength_1484 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return listLength_1484__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findType_1491__wm_d2 = (items_1492, id_1493) => {
__wm_tail_77: while (true) {
{
const __wm_scalar_102_0 = items_1492;
const __wm_scalar_102_1 = id_1493;
if (__wm_scalar_102_0 === __wm_basis_Nil) {
const id_1494 = __wm_scalar_102_1;
return __wm_fail("Panic", "missing numeric semantic type");
} else if (__wm_scalar_102_0?.ctor === -6 && __wm_scalar_102_0.args.length === 1 && __wm_is_tuple(__wm_scalar_102_0.args[0]) && __wm_scalar_102_0.args[0].length === 2) {
const item_1495 = __wm_scalar_102_0.args[0][0];
const rest_1496 = __wm_scalar_102_0.args[0][1];
const id_1497 = __wm_scalar_102_1;
{
const exact_1498 = item_1495;
if (numberEqual_1483__wm_d2(exact_1498.id, id_1497)) {
return exact_1498;
} else {
{
const __wm_tail_arg_87_0 = rest_1496;
const __wm_tail_arg_87_1 = id_1497;
items_1492 = __wm_tail_arg_87_0;
id_1493 = __wm_tail_arg_87_1;
continue __wm_tail_77;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findType_1491 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findType_1491__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const allNumberTypes_1499__wm_d2 = (typeIds_1500, types_1501) => {
const __wm_scalar_103_0 = typeIds_1500;
const __wm_scalar_103_1 = types_1501;
if (__wm_scalar_103_0 === __wm_basis_Nil) {
const types_1502 = __wm_scalar_103_1;
return true;
} else if (__wm_scalar_103_0?.ctor === -6 && __wm_scalar_103_0.args.length === 1 && __wm_is_tuple(__wm_scalar_103_0.args[0]) && __wm_scalar_103_0.args[0].length === 2) {
const typeId_1503 = __wm_scalar_103_0.args[0][0];
const rest_1504 = __wm_scalar_103_0.args[0][1];
const types_1505 = __wm_scalar_103_1;
const gpuType_1506 = findType_1491__wm_d2(types_1505, typeId_1503);
return __wm_op_and_d2(__wm_eq(gpuType_1506.kind, "number"), allNumberTypes_1499__wm_d2(rest_1504, types_1505));
}
__wm_fail("Match", "non-exhaustive match");
};
const allNumberTypes_1499 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return allNumberTypes_1499__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const numericType_1512__wm_d2 = (typeId_1507, context_1508) => {
const gpuType_1509 = findType_1491__wm_d2(context_1508.types, typeId_1507);
if (__wm_eq(gpuType_1509.kind, "number")) {
return true;
} else {
if (__wm_eq(gpuType_1509.kind, "tuple")) {
const items_1510 = Js.Array.toList(gpuType_1509.items);
const width_1511 = listLength_1484__wm_d2(items_1510, 0);
return __wm_op_and_d2(__wm_op_and_d2((width_1511 >= 2), (width_1511 <= 4)), allNumberTypes_1499__wm_d2(items_1510, context_1508.types));
} else {
return false;
}
}
};
const numericType_1512 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numericType_1512__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const computeExpressionNode_1515__wm_d2 = (expression_1513, context_1514) => {
if (numericType_1512__wm_d2(expression_1513.typeId, context_1514)) {
return expression_1513.id;
} else {
return __wm_op_sub(1);
}
};
const computeExpressionNode_1515 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return computeExpressionNode_1515__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const expressionNode_1519__wm_d2 = (expression_1516, context_1517) => {
const __wm_return_value_38 = Map.get([context_1517.exprNodes, expression_1516.id]);
if (__wm_return_value_38?.ctor === -2 && __wm_return_value_38.args.length === 1) {
const node_1518 = __wm_return_value_38.args[0];
return node_1518;
} else if (__wm_return_value_38 === __wm_basis_None) {

return computeExpressionNode_1515__wm_d2(expression_1516, context_1517);
}
__wm_fail("Match", "non-exhaustive match");
};
const expressionNode_1519 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return expressionNode_1519__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const computePatternNode_1522__wm_d2 = (pattern_1520, context_1521) => {
if (numericType_1512__wm_d2(pattern_1520.typeId, context_1521)) {
return (context_1521.expressionOffset + pattern_1520.id);
} else {
return __wm_op_sub(1);
}
};
const computePatternNode_1522 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return computePatternNode_1522__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const patternNode_1526__wm_d2 = (pattern_1523, context_1524) => {
const __wm_return_value_39 = Map.get([context_1524.patternNodes, pattern_1523.id]);
if (__wm_return_value_39?.ctor === -2 && __wm_return_value_39.args.length === 1) {
const node_1525 = __wm_return_value_39.args[0];
return node_1525;
} else if (__wm_return_value_39 === __wm_basis_None) {

return computePatternNode_1522__wm_d2(pattern_1523, context_1524);
}
__wm_fail("Match", "non-exhaustive match");
};
const patternNode_1526 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return patternNode_1526__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const boundPatternNode_1531__wm_d3 = (context_1527, bindingId_1528, ownerFunctionId_1529) => {
const __wm_return_value_40 = Map.get([context_1527.patternByBinding, ((bindingId_1528 * 1000000) + ownerFunctionId_1529)]);
if (__wm_return_value_40?.ctor === -2 && __wm_return_value_40.args.length === 1) {
const node_1530 = __wm_return_value_40.args[0];
return node_1530;
} else if (__wm_return_value_40 === __wm_basis_None) {

return __wm_op_sub(1);
}
__wm_fail("Match", "non-exhaustive match");
};
const boundPatternNode_1531 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return boundPatternNode_1531__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lookupLanes_1535__wm_d2 = (context_1532, expressionId_1533) => {
const __wm_return_value_41 = Map.get([context_1532.lanes, expressionId_1533]);
if (__wm_return_value_41?.ctor === -2 && __wm_return_value_41.args.length === 1) {
const lanes_1534 = __wm_return_value_41.args[0];
return lanes_1534;
} else if (__wm_return_value_41 === __wm_basis_None) {

return __wm_basis_Nil;
}
__wm_fail("Match", "non-exhaustive match");
};
const lookupLanes_1535 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return lookupLanes_1535__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const fieldNode_1538__wm_d2 = (field_1536, context_1537) => {
if (numericType_1512__wm_d2(field_1536.typeId, context_1537)) {
return (context_1537.fieldOffset + field_1536.id);
} else {
return __wm_op_sub(1);
}
};
const fieldNode_1538 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return fieldNode_1538__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const evidence_1541__wm_d2 = (representations_1539, node_1540) => {
if ((node_1540 < 0)) {
return __wm_basis_None;
} else {
return Map.get([representations_1539, node_1540]);
}
};
const evidence_1541 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return evidence_1541__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const representation_1545__wm_d2 = (representations_1542, node_1543) => {
const __wm_return_value_42 = evidence_1541__wm_d2(representations_1542, node_1543);
if (__wm_return_value_42?.ctor === -2 && __wm_return_value_42.args.length === 1) {
const value_1544 = __wm_return_value_42.args[0];
return value_1544.representation;
} else if (__wm_return_value_42 === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const representation_1545 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return representation_1545__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const numericConflict_1548__wm_d2 = (left_1546, right_1547) => {
return __wm_fail("Panic", ((((((("WM_GPU_NUMERIC_CONFLICT|" + Text.of(left_1546.spanId)) + "|") + Text.of(right_1547.spanId)) + "|") + left_1546.representation) + "|") + right_1547.representation));
};
const numericConflict_1548 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numericConflict_1548__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const setEvidence_1553__wm_d3 = (representations_1549, node_1550, value_1551) => {
if (__wm_op_or_d2((node_1550 < 0), __wm_eq(value_1551.representation, ""))) {
return [representations_1549, false];
} else {
const __wm_return_value_43 = evidence_1541__wm_d2(representations_1549, node_1550);
if (__wm_return_value_43 === __wm_basis_None) {

return [Map.set([representations_1549, node_1550, value_1551]), true];
} else if (__wm_return_value_43?.ctor === -2 && __wm_return_value_43.args.length === 1) {
const previous_1552 = __wm_return_value_43.args[0];
if (__wm_eq(previous_1552.representation, value_1551.representation)) {
return [representations_1549, false];
} else {
return numericConflict_1548__wm_d2(previous_1552, value_1551);
}
}
__wm_fail("Match", "non-exhaustive match");
}
};
const setEvidence_1553 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return setEvidence_1553__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setRepresentation_1559__wm_d4 = (representations_1554, node_1555, value_1556, spanId_1557) => {
const item_1558 = { representation: value_1556, spanId: spanId_1557 };
return setEvidence_1553__wm_d3(representations_1554, node_1555, item_1558);
};
const setRepresentation_1559 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setRepresentation_1559__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const combinedEvidence_1560__wm_d3 = (nodes_1561, representations_1562, combined_1563) => {
__wm_tail_78: while (true) {
{
const __wm_scalar_104_0 = nodes_1561;
const __wm_scalar_104_1 = representations_1562;
const __wm_scalar_104_2 = combined_1563;
if (__wm_scalar_104_0 === __wm_basis_Nil) {
const representations_1564 = __wm_scalar_104_1;
const combined_1565 = __wm_scalar_104_2;
return combined_1565;
} else if (__wm_scalar_104_0?.ctor === -6 && __wm_scalar_104_0.args.length === 1 && __wm_is_tuple(__wm_scalar_104_0.args[0]) && __wm_scalar_104_0.args[0].length === 2) {
const node_1566 = __wm_scalar_104_0.args[0][0];
const rest_1567 = __wm_scalar_104_0.args[0][1];
const representations_1568 = __wm_scalar_104_1;
const combined_1569 = __wm_scalar_104_2;
{
const __wm_tail_value_88 = evidence_1541__wm_d2(representations_1568, node_1566);
if (__wm_tail_value_88 === __wm_basis_None) {

{
const __wm_tail_arg_89_0 = rest_1567;
const __wm_tail_arg_89_1 = representations_1568;
const __wm_tail_arg_89_2 = combined_1569;
nodes_1561 = __wm_tail_arg_89_0;
representations_1562 = __wm_tail_arg_89_1;
combined_1563 = __wm_tail_arg_89_2;
continue __wm_tail_78;
}
} else if (__wm_tail_value_88?.ctor === -2 && __wm_tail_value_88.args.length === 1) {
const value_1570 = __wm_tail_value_88.args[0];
{
const __wm_tail_value_90 = combined_1569;
if (__wm_tail_value_90 === __wm_basis_None) {

{
const __wm_tail_arg_91_0 = rest_1567;
const __wm_tail_arg_91_1 = representations_1568;
const __wm_tail_arg_91_2 = __wm_basis_Some(value_1570);
nodes_1561 = __wm_tail_arg_91_0;
representations_1562 = __wm_tail_arg_91_1;
combined_1563 = __wm_tail_arg_91_2;
continue __wm_tail_78;
}
} else if (__wm_tail_value_90?.ctor === -2 && __wm_tail_value_90.args.length === 1) {
const previous_1571 = __wm_tail_value_90.args[0];
if (__wm_eq(previous_1571.representation, value_1570.representation)) {
{
const __wm_tail_arg_92_0 = rest_1567;
const __wm_tail_arg_92_1 = representations_1568;
const __wm_tail_arg_92_2 = combined_1569;
nodes_1561 = __wm_tail_arg_92_0;
representations_1562 = __wm_tail_arg_92_1;
combined_1563 = __wm_tail_arg_92_2;
continue __wm_tail_78;
}
} else {
return numericConflict_1548__wm_d2(previous_1571, value_1570);
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
const combinedEvidence_1560 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return combinedEvidence_1560__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setGroup_1572__wm_d4 = (nodes_1573, value_1574, representations_1575, changed_1576) => {
__wm_tail_79: while (true) {
{
const __wm_scalar_105_0 = nodes_1573;
const __wm_scalar_105_1 = value_1574;
const __wm_scalar_105_2 = representations_1575;
const __wm_scalar_105_3 = changed_1576;
if (__wm_scalar_105_0 === __wm_basis_Nil) {
const value_1577 = __wm_scalar_105_1;
const representations_1578 = __wm_scalar_105_2;
const changed_1579 = __wm_scalar_105_3;
return [representations_1578, changed_1579];
} else if (__wm_scalar_105_0?.ctor === -6 && __wm_scalar_105_0.args.length === 1 && __wm_is_tuple(__wm_scalar_105_0.args[0]) && __wm_scalar_105_0.args[0].length === 2) {
const node_1580 = __wm_scalar_105_0.args[0][0];
const rest_1581 = __wm_scalar_105_0.args[0][1];
const value_1582 = __wm_scalar_105_1;
const representations_1583 = __wm_scalar_105_2;
const changed_1584 = __wm_scalar_105_3;
{
const __wm_bind_57 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const item_1585 = __v.args[0];
return setEvidence_1553__wm_d3(representations_1583, node_1580, item_1585);
} else if (__v === __wm_basis_None) {

return [representations_1583, false];
}
__wm_fail("Match", "non-exhaustive match");
})(value_1582);
if (!(__wm_is_tuple(__wm_bind_57) && __wm_bind_57.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1586 = __wm_bind_57[0];
const itemChanged_1587 = __wm_bind_57[1];
{
const __wm_tail_arg_93_0 = rest_1581;
const __wm_tail_arg_93_1 = value_1582;
const __wm_tail_arg_93_2 = next_1586;
const __wm_tail_arg_93_3 = __wm_op_or_d2(changed_1584, itemChanged_1587);
nodes_1573 = __wm_tail_arg_93_0;
value_1574 = __wm_tail_arg_93_1;
representations_1575 = __wm_tail_arg_93_2;
changed_1576 = __wm_tail_arg_93_3;
continue __wm_tail_79;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const setGroup_1572 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setGroup_1572__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeGroup_1591__wm_d2 = (nodes_1588, representations_1589) => {
const value_1590 = combinedEvidence_1560__wm_d3(nodes_1588, representations_1589, __wm_basis_None);
return setGroup_1572__wm_d4(nodes_1588, value_1590, representations_1589, false);
};
const mergeGroup_1591 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return mergeGroup_1591__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findPatternByBinding_1592__wm_d3 = (patterns_1593, bindingId_1594, ownerFunctionId_1595) => {
__wm_tail_80: while (true) {
{
const __wm_scalar_106_0 = patterns_1593;
const __wm_scalar_106_1 = bindingId_1594;
const __wm_scalar_106_2 = ownerFunctionId_1595;
if (__wm_scalar_106_0 === __wm_basis_Nil) {
const bindingId_1596 = __wm_scalar_106_1;
const ownerFunctionId_1597 = __wm_scalar_106_2;
return __wm_basis_None;
} else if (__wm_scalar_106_0?.ctor === -6 && __wm_scalar_106_0.args.length === 1 && __wm_is_tuple(__wm_scalar_106_0.args[0]) && __wm_scalar_106_0.args[0].length === 2) {
const pattern_1598 = __wm_scalar_106_0.args[0][0];
const rest_1599 = __wm_scalar_106_0.args[0][1];
const bindingId_1600 = __wm_scalar_106_1;
const ownerFunctionId_1601 = __wm_scalar_106_2;
{
const exact_1602 = pattern_1598;
if (__wm_op_and_d2(numberEqual_1483__wm_d2(exact_1602.bindingId, bindingId_1600), numberEqual_1483__wm_d2(exact_1602.ownerFunctionId, ownerFunctionId_1601))) {
return __wm_basis_Some(exact_1602);
} else {
{
const __wm_tail_arg_94_0 = rest_1599;
const __wm_tail_arg_94_1 = bindingId_1600;
const __wm_tail_arg_94_2 = ownerFunctionId_1601;
patterns_1593 = __wm_tail_arg_94_0;
bindingId_1594 = __wm_tail_arg_94_1;
ownerFunctionId_1595 = __wm_tail_arg_94_2;
continue __wm_tail_80;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findPatternByBinding_1592 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findPatternByBinding_1592__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const findParam_1603__wm_d2 = (params_1604, id_1605) => {
__wm_tail_81: while (true) {
{
const __wm_scalar_107_0 = params_1604;
const __wm_scalar_107_1 = id_1605;
if (__wm_scalar_107_0 === __wm_basis_Nil) {
const id_1606 = __wm_scalar_107_1;
return __wm_fail("Panic", "missing numeric function parameter");
} else if (__wm_scalar_107_0?.ctor === -6 && __wm_scalar_107_0.args.length === 1 && __wm_is_tuple(__wm_scalar_107_0.args[0]) && __wm_scalar_107_0.args[0].length === 2) {
const param_1607 = __wm_scalar_107_0.args[0][0];
const rest_1608 = __wm_scalar_107_0.args[0][1];
const id_1609 = __wm_scalar_107_1;
{
const exact_1610 = param_1607;
if (numberEqual_1483__wm_d2(exact_1610.id, id_1609)) {
return exact_1610;
} else {
{
const __wm_tail_arg_95_0 = rest_1608;
const __wm_tail_arg_95_1 = id_1609;
params_1604 = __wm_tail_arg_95_0;
id_1605 = __wm_tail_arg_95_1;
continue __wm_tail_81;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findParam_1603 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findParam_1603__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findPattern_1611__wm_d2 = (patterns_1612, id_1613) => {
__wm_tail_82: while (true) {
{
const __wm_scalar_108_0 = patterns_1612;
const __wm_scalar_108_1 = id_1613;
if (__wm_scalar_108_0 === __wm_basis_Nil) {
const id_1614 = __wm_scalar_108_1;
return __wm_fail("Panic", "missing numeric pattern");
} else if (__wm_scalar_108_0?.ctor === -6 && __wm_scalar_108_0.args.length === 1 && __wm_is_tuple(__wm_scalar_108_0.args[0]) && __wm_scalar_108_0.args[0].length === 2) {
const pattern_1615 = __wm_scalar_108_0.args[0][0];
const rest_1616 = __wm_scalar_108_0.args[0][1];
const id_1617 = __wm_scalar_108_1;
{
const exact_1618 = pattern_1615;
if (numberEqual_1483__wm_d2(exact_1618.id, id_1617)) {
return exact_1618;
} else {
{
const __wm_tail_arg_96_0 = rest_1616;
const __wm_tail_arg_96_1 = id_1617;
patterns_1612 = __wm_tail_arg_96_0;
id_1613 = __wm_tail_arg_96_1;
continue __wm_tail_82;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findPattern_1611 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findPattern_1611__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findFunction_1619__wm_d2 = (functions_1620, id_1621) => {
__wm_tail_83: while (true) {
{
const __wm_scalar_109_0 = functions_1620;
const __wm_scalar_109_1 = id_1621;
if (__wm_scalar_109_0 === __wm_basis_Nil) {
const id_1622 = __wm_scalar_109_1;
return __wm_fail("Panic", "missing numeric function");
} else if (__wm_scalar_109_0?.ctor === -6 && __wm_scalar_109_0.args.length === 1 && __wm_is_tuple(__wm_scalar_109_0.args[0]) && __wm_scalar_109_0.args[0].length === 2) {
const fn_1623 = __wm_scalar_109_0.args[0][0];
const rest_1624 = __wm_scalar_109_0.args[0][1];
const id_1625 = __wm_scalar_109_1;
{
const exact_1626 = fn_1623;
if (numberEqual_1483__wm_d2(exact_1626.id, id_1625)) {
return exact_1626;
} else {
{
const __wm_tail_arg_97_0 = rest_1624;
const __wm_tail_arg_97_1 = id_1625;
functions_1620 = __wm_tail_arg_97_0;
id_1621 = __wm_tail_arg_97_1;
continue __wm_tail_83;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findFunction_1619 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findFunction_1619__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findExpression_1627__wm_d2 = (expressions_1628, id_1629) => {
__wm_tail_84: while (true) {
{
const __wm_scalar_110_0 = expressions_1628;
const __wm_scalar_110_1 = id_1629;
if (__wm_scalar_110_0 === __wm_basis_Nil) {
const id_1630 = __wm_scalar_110_1;
return __wm_fail("Panic", "missing numeric expression");
} else if (__wm_scalar_110_0?.ctor === -6 && __wm_scalar_110_0.args.length === 1 && __wm_is_tuple(__wm_scalar_110_0.args[0]) && __wm_scalar_110_0.args[0].length === 2) {
const expression_1631 = __wm_scalar_110_0.args[0][0];
const rest_1632 = __wm_scalar_110_0.args[0][1];
const id_1633 = __wm_scalar_110_1;
{
const exact_1634 = expression_1631;
if (numberEqual_1483__wm_d2(exact_1634.id, id_1633)) {
return exact_1634;
} else {
{
const __wm_tail_arg_98_0 = rest_1632;
const __wm_tail_arg_98_1 = id_1633;
expressions_1628 = __wm_tail_arg_98_0;
id_1629 = __wm_tail_arg_98_1;
continue __wm_tail_84;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findExpression_1627 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findExpression_1627__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findBlock_1635__wm_d2 = (blocks_1636, expressionId_1637) => {
__wm_tail_85: while (true) {
{
const __wm_scalar_111_0 = blocks_1636;
const __wm_scalar_111_1 = expressionId_1637;
if (__wm_scalar_111_0 === __wm_basis_Nil) {
const expressionId_1638 = __wm_scalar_111_1;
return __wm_fail("Panic", "missing numeric block");
} else if (__wm_scalar_111_0?.ctor === -6 && __wm_scalar_111_0.args.length === 1 && __wm_is_tuple(__wm_scalar_111_0.args[0]) && __wm_scalar_111_0.args[0].length === 2) {
const block_1639 = __wm_scalar_111_0.args[0][0];
const rest_1640 = __wm_scalar_111_0.args[0][1];
const expressionId_1641 = __wm_scalar_111_1;
{
const exact_1642 = block_1639;
if (numberEqual_1483__wm_d2(exact_1642.expressionId, expressionId_1641)) {
return exact_1642;
} else {
{
const __wm_tail_arg_99_0 = rest_1640;
const __wm_tail_arg_99_1 = expressionId_1641;
blocks_1636 = __wm_tail_arg_99_0;
expressionId_1637 = __wm_tail_arg_99_1;
continue __wm_tail_85;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findBlock_1635 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findBlock_1635__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findEnvironmentField_1643__wm_d2 = (fields_1644, declaredIndex_1645) => {
__wm_tail_86: while (true) {
{
const __wm_scalar_112_0 = fields_1644;
const __wm_scalar_112_1 = declaredIndex_1645;
if (__wm_scalar_112_0 === __wm_basis_Nil) {
const declaredIndex_1646 = __wm_scalar_112_1;
return __wm_fail("Panic", "missing numeric environment field");
} else if (__wm_scalar_112_0?.ctor === -6 && __wm_scalar_112_0.args.length === 1 && __wm_is_tuple(__wm_scalar_112_0.args[0]) && __wm_scalar_112_0.args[0].length === 2) {
const field_1647 = __wm_scalar_112_0.args[0][0];
const rest_1648 = __wm_scalar_112_0.args[0][1];
const declaredIndex_1649 = __wm_scalar_112_1;
{
const exact_1650 = field_1647;
if (numberEqual_1483__wm_d2(exact_1650.declaredIndex, declaredIndex_1649)) {
return exact_1650;
} else {
{
const __wm_tail_arg_100_0 = rest_1648;
const __wm_tail_arg_100_1 = declaredIndex_1649;
fields_1644 = __wm_tail_arg_100_0;
declaredIndex_1645 = __wm_tail_arg_100_1;
continue __wm_tail_86;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findEnvironmentField_1643 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findEnvironmentField_1643__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const laneContains_1651__wm_d2 = (ids_1652, id_1653) => {
__wm_tail_87: while (true) {
{
const __wm_scalar_113_0 = ids_1652;
const __wm_scalar_113_1 = id_1653;
if (__wm_scalar_113_0 === __wm_basis_Nil) {
const _id_1654 = __wm_scalar_113_1;
return false;
} else if (__wm_scalar_113_0?.ctor === -6 && __wm_scalar_113_0.args.length === 1 && __wm_is_tuple(__wm_scalar_113_0.args[0]) && __wm_scalar_113_0.args[0].length === 2) {
const head_1655 = __wm_scalar_113_0.args[0][0];
const rest_1656 = __wm_scalar_113_0.args[0][1];
const id_1657 = __wm_scalar_113_1;
if (numberEqual_1483__wm_d2(head_1655, id_1657)) {
return true;
} else {
{
const __wm_tail_arg_101_0 = rest_1656;
const __wm_tail_arg_101_1 = id_1657;
ids_1652 = __wm_tail_arg_101_0;
id_1653 = __wm_tail_arg_101_1;
continue __wm_tail_87;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const laneContains_1651 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return laneContains_1651__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const childLaneNodes_1658__wm_d2 = (ids_1659, exprNodes_1660) => {
const __wm_scalar_114_0 = ids_1659;
const __wm_scalar_114_1 = exprNodes_1660;
if (__wm_scalar_114_0 === __wm_basis_Nil) {
const _exprNodes_1661 = __wm_scalar_114_1;
return __wm_basis_Nil;
} else if (__wm_scalar_114_0?.ctor === -6 && __wm_scalar_114_0.args.length === 1 && __wm_is_tuple(__wm_scalar_114_0.args[0]) && __wm_scalar_114_0.args[0].length === 2) {
const id_1662 = __wm_scalar_114_0.args[0][0];
const rest_1663 = __wm_scalar_114_0.args[0][1];
const exprNodes_1664 = __wm_scalar_114_1;
const node_1666 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const n_1665 = __v.args[0];
return n_1665;
} else if (__v === __wm_basis_None) {

return __wm_op_sub(1);
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([exprNodes_1664, id_1662]));
return __wm_basis_Cons([node_1666, childLaneNodes_1658__wm_d2(rest_1663, exprNodes_1664)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const childLaneNodes_1658 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return childLaneNodes_1658__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const lookupMemoLanes_1670__wm_d2 = (memo_1667, expressionId_1668) => {
const __wm_return_value_44 = Map.get([memo_1667, expressionId_1668]);
if (__wm_return_value_44?.ctor === -2 && __wm_return_value_44.args.length === 1) {
const lanes_1669 = __wm_return_value_44.args[0];
return lanes_1669;
} else if (__wm_return_value_44 === __wm_basis_None) {

return __wm_basis_Nil;
}
__wm_fail("Match", "non-exhaustive match");
};
const lookupMemoLanes_1670 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return lookupMemoLanes_1670__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const patternLaneNodes_1671__wm_d2 = (ids_1672, context_1673) => {
const __wm_scalar_115_0 = ids_1672;
const __wm_scalar_115_1 = context_1673;
if (__wm_scalar_115_0 === __wm_basis_Nil) {
const _context_1674 = __wm_scalar_115_1;
return __wm_basis_Nil;
} else if (__wm_scalar_115_0?.ctor === -6 && __wm_scalar_115_0.args.length === 1 && __wm_is_tuple(__wm_scalar_115_0.args[0]) && __wm_scalar_115_0.args[0].length === 2) {
const id_1675 = __wm_scalar_115_0.args[0][0];
const rest_1676 = __wm_scalar_115_0.args[0][1];
const context_1677 = __wm_scalar_115_1;
const exactContext_1678 = context_1677;
const child_1679 = findPattern_1611__wm_d2(exactContext_1678.patterns, id_1675);
return __wm_basis_Cons([patternNode_1526__wm_d2(child_1679, exactContext_1678), patternLaneNodes_1671__wm_d2(rest_1676, exactContext_1678)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const patternLaneNodes_1671 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return patternLaneNodes_1671__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeLanePairs_1680__wm_d4 = (left_1681, right_1682, representations_1683, changed_1684) => {
__wm_tail_88: while (true) {
{
const __wm_scalar_116_0 = left_1681;
const __wm_scalar_116_1 = right_1682;
const __wm_scalar_116_2 = representations_1683;
const __wm_scalar_116_3 = changed_1684;
if (__wm_scalar_116_0 === __wm_basis_Nil && __wm_scalar_116_1 === __wm_basis_Nil) {
const representations_1685 = __wm_scalar_116_2;
const changed_1686 = __wm_scalar_116_3;
return [representations_1685, changed_1686];
} else if (__wm_scalar_116_0?.ctor === -6 && __wm_scalar_116_0.args.length === 1 && __wm_is_tuple(__wm_scalar_116_0.args[0]) && __wm_scalar_116_0.args[0].length === 2 && __wm_scalar_116_1?.ctor === -6 && __wm_scalar_116_1.args.length === 1 && __wm_is_tuple(__wm_scalar_116_1.args[0]) && __wm_scalar_116_1.args[0].length === 2) {
const a_1687 = __wm_scalar_116_0.args[0][0];
const restA_1688 = __wm_scalar_116_0.args[0][1];
const b_1689 = __wm_scalar_116_1.args[0][0];
const restB_1690 = __wm_scalar_116_1.args[0][1];
const representations_1691 = __wm_scalar_116_2;
const changed_1692 = __wm_scalar_116_3;
{
const __wm_bind_58 = mergeGroup_1591__wm_d2(__wm_basis_Cons([a_1687, __wm_basis_Cons([b_1689, __wm_basis_Nil])]), representations_1691);
if (!(__wm_is_tuple(__wm_bind_58) && __wm_bind_58.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1693 = __wm_bind_58[0];
const pairChanged_1694 = __wm_bind_58[1];
{
const __wm_tail_arg_102_0 = restA_1688;
const __wm_tail_arg_102_1 = restB_1690;
const __wm_tail_arg_102_2 = next_1693;
const __wm_tail_arg_102_3 = __wm_op_or_d2(changed_1692, pairChanged_1694);
left_1681 = __wm_tail_arg_102_0;
right_1682 = __wm_tail_arg_102_1;
representations_1683 = __wm_tail_arg_102_2;
changed_1684 = __wm_tail_arg_102_3;
continue __wm_tail_88;
}
}
} else if (true) {
const representations_1695 = __wm_scalar_116_2;
const changed_1696 = __wm_scalar_116_3;
return [representations_1695, changed_1696];
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const mergeLanePairs_1680 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return mergeLanePairs_1680__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const findLetForPattern_1697__wm_d2 = (lets_1698, patternId_1699) => {
__wm_tail_89: while (true) {
{
const __wm_scalar_117_0 = lets_1698;
const __wm_scalar_117_1 = patternId_1699;
if (__wm_scalar_117_0 === __wm_basis_Nil) {
const _patternId_1700 = __wm_scalar_117_1;
return __wm_basis_None;
} else if (__wm_scalar_117_0?.ctor === -6 && __wm_scalar_117_0.args.length === 1 && __wm_is_tuple(__wm_scalar_117_0.args[0]) && __wm_scalar_117_0.args[0].length === 2) {
const binding_1701 = __wm_scalar_117_0.args[0][0];
const rest_1702 = __wm_scalar_117_0.args[0][1];
const patternId_1703 = __wm_scalar_117_1;
{
const exact_1704 = binding_1701;
if (numberEqual_1483__wm_d2(exact_1704.patternId, patternId_1703)) {
return __wm_basis_Some(exact_1704);
} else {
{
const __wm_tail_arg_103_0 = rest_1702;
const __wm_tail_arg_103_1 = patternId_1703;
lets_1698 = __wm_tail_arg_103_0;
patternId_1699 = __wm_tail_arg_103_1;
continue __wm_tail_89;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLetForPattern_1697 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLetForPattern_1697__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const laneForMemo_1705__wm_d6 = (expressionId_1707, context_1708, exprNodes_1709, memo_1710, visited_1711, depth_1712) => {
const __wm_return_value_45 = Map.get([memo_1710, expressionId_1707]);
if (__wm_return_value_45?.ctor === -2 && __wm_return_value_45.args.length === 1) {
const _lanes_1713 = __wm_return_value_45.args[0];
return memo_1710;
} else if (__wm_return_value_45 === __wm_basis_None) {

if (numberEqual_1483__wm_d2(depth_1712, 0)) {
return Map.set([memo_1710, expressionId_1707, __wm_basis_Nil]);
} else {
if (laneContains_1651__wm_d2(visited_1711, expressionId_1707)) {
return Map.set([memo_1710, expressionId_1707, __wm_basis_Nil]);
} else {
return laneForUncached_1706__wm_d6(expressionId_1707, context_1708, exprNodes_1709, memo_1710, __wm_basis_Cons([expressionId_1707, visited_1711]), (depth_1712 - 1));
}
}
}
__wm_fail("Match", "non-exhaustive match");
};
const laneForMemo_1705 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return laneForMemo_1705__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const laneForUncached_1706__wm_d6 = (expressionId_1714, context_1715, exprNodes_1716, memo_1717, visited_1718, depth_1719) => {
const expression_1720 = findExpression_1627__wm_d2(context_1715.expressions, expressionId_1714);
if (__wm_eq(expression_1720.kind, "tuple")) {
return Map.set([memo_1717, expressionId_1714, childLaneNodes_1658__wm_d2(Js.Array.toList(expression_1720.children), exprNodes_1716)]);
} else {
if (__wm_eq(expression_1720.kind, "if")) {
const __wm_return_value_46 = Js.Array.toList(expression_1720.children);
if (__wm_return_value_46?.ctor === -6 && __wm_return_value_46.args.length === 1 && __wm_is_tuple(__wm_return_value_46.args[0]) && __wm_return_value_46.args[0].length === 2 && __wm_return_value_46.args[0][1]?.ctor === -6 && __wm_return_value_46.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_46.args[0][1].args[0]) && __wm_return_value_46.args[0][1].args[0].length === 2 && __wm_return_value_46.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_46.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_46.args[0][1].args[0][1].args[0]) && __wm_return_value_46.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_46.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const _cond_1721 = __wm_return_value_46.args[0][0];
const thenId_1722 = __wm_return_value_46.args[0][1].args[0][0];
const elseId_1723 = __wm_return_value_46.args[0][1].args[0][1].args[0][0];
const afterThen_1724 = laneForMemo_1705__wm_d6(thenId_1722, context_1715, exprNodes_1716, memo_1717, visited_1718, depth_1719);
const afterElse_1725 = laneForMemo_1705__wm_d6(elseId_1723, context_1715, exprNodes_1716, afterThen_1724, visited_1718, depth_1719);
return Map.set([afterElse_1725, expressionId_1714, lookupMemoLanes_1670__wm_d2(afterElse_1725, thenId_1722)]);
} else if (true) {

return Map.set([memo_1717, expressionId_1714, __wm_basis_Nil]);
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_eq(expression_1720.kind, "block")) {
const block_1726 = findBlock_1635__wm_d2(context_1715.blocks, expression_1720.id);
const afterResult_1727 = laneForMemo_1705__wm_d6(block_1726.resultExprId, context_1715, exprNodes_1716, memo_1717, visited_1718, depth_1719);
return Map.set([afterResult_1727, expressionId_1714, lookupMemoLanes_1670__wm_d2(afterResult_1727, block_1726.resultExprId)]);
} else {
if (__wm_eq(expression_1720.kind, "call")) {
const target_1728 = findFunction_1619__wm_d2(context_1715.functions, expression_1720.functionId);
const body_1729 = findExpression_1627__wm_d2(context_1715.expressions, target_1728.bodyExprId);
const afterBody_1730 = laneForMemo_1705__wm_d6(body_1729.id, context_1715, exprNodes_1716, memo_1717, visited_1718, depth_1719);
return Map.set([afterBody_1730, expressionId_1714, lookupMemoLanes_1670__wm_d2(afterBody_1730, body_1729.id)]);
} else {
if (__wm_eq(expression_1720.kind, "var")) {
const __wm_return_value_47 = findPatternByBinding_1592__wm_d3(context_1715.patterns, expression_1720.bindingId, expression_1720.ownerFunctionId);
if (__wm_return_value_47?.ctor === -2 && __wm_return_value_47.args.length === 1) {
const pattern_1731 = __wm_return_value_47.args[0];
const __wm_return_value_48 = findLetForPattern_1697__wm_d2(context_1715.lets, pattern_1731.id);
if (__wm_return_value_48?.ctor === -2 && __wm_return_value_48.args.length === 1) {
const binding_1732 = __wm_return_value_48.args[0];
const afterValue_1733 = laneForMemo_1705__wm_d6(binding_1732.valueExprId, context_1715, exprNodes_1716, memo_1717, visited_1718, depth_1719);
return Map.set([afterValue_1733, expressionId_1714, lookupMemoLanes_1670__wm_d2(afterValue_1733, binding_1732.valueExprId)]);
} else if (__wm_return_value_48 === __wm_basis_None) {

return Map.set([memo_1717, expressionId_1714, __wm_basis_Nil]);
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_47 === __wm_basis_None) {

return Map.set([memo_1717, expressionId_1714, __wm_basis_Nil]);
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_eq(expression_1720.kind, "copy")) {
const __wm_return_value_49 = Js.Array.toList(expression_1720.children);
if (__wm_return_value_49?.ctor === -6 && __wm_return_value_49.args.length === 1 && __wm_is_tuple(__wm_return_value_49.args[0]) && __wm_return_value_49.args[0].length === 2 && __wm_return_value_49.args[0][1] === __wm_basis_Nil) {
const childId_1734 = __wm_return_value_49.args[0][0];
const afterChild_1735 = laneForMemo_1705__wm_d6(childId_1734, context_1715, exprNodes_1716, memo_1717, visited_1718, depth_1719);
return Map.set([afterChild_1735, expressionId_1714, lookupMemoLanes_1670__wm_d2(afterChild_1735, childId_1734)]);
} else if (true) {

return Map.set([memo_1717, expressionId_1714, __wm_basis_Nil]);
}
__wm_fail("Match", "non-exhaustive match");
} else {
return Map.set([memo_1717, expressionId_1714, __wm_basis_Nil]);
}
}
}
}
}
}
};
const laneForUncached_1706 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return laneForUncached_1706__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const foldExprNodes_1736__wm_d3 = (items_1737, context_1738, nodes_1739) => {
__wm_tail_90: while (true) {
{
const __wm_scalar_118_0 = items_1737;
const __wm_scalar_118_1 = context_1738;
const __wm_scalar_118_2 = nodes_1739;
if (__wm_scalar_118_0 === __wm_basis_Nil) {
const _context_1740 = __wm_scalar_118_1;
const nodes_1741 = __wm_scalar_118_2;
return nodes_1741;
} else if (__wm_scalar_118_0?.ctor === -6 && __wm_scalar_118_0.args.length === 1 && __wm_is_tuple(__wm_scalar_118_0.args[0]) && __wm_scalar_118_0.args[0].length === 2) {
const expression_1742 = __wm_scalar_118_0.args[0][0];
const rest_1743 = __wm_scalar_118_0.args[0][1];
const context_1744 = __wm_scalar_118_1;
const nodes_1745 = __wm_scalar_118_2;
{
const exactExpression_1746 = expression_1742;
const exactContext_1747 = context_1744;
{
const __wm_tail_arg_104_0 = rest_1743;
const __wm_tail_arg_104_1 = exactContext_1747;
const __wm_tail_arg_104_2 = Map.set([nodes_1745, exactExpression_1746.id, computeExpressionNode_1515__wm_d2(exactExpression_1746, exactContext_1747)]);
items_1737 = __wm_tail_arg_104_0;
context_1738 = __wm_tail_arg_104_1;
nodes_1739 = __wm_tail_arg_104_2;
continue __wm_tail_90;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const foldExprNodes_1736 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldExprNodes_1736__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const foldPatternNodes_1748__wm_d3 = (items_1749, context_1750, nodes_1751) => {
__wm_tail_91: while (true) {
{
const __wm_scalar_119_0 = items_1749;
const __wm_scalar_119_1 = context_1750;
const __wm_scalar_119_2 = nodes_1751;
if (__wm_scalar_119_0 === __wm_basis_Nil) {
const _context_1752 = __wm_scalar_119_1;
const nodes_1753 = __wm_scalar_119_2;
return nodes_1753;
} else if (__wm_scalar_119_0?.ctor === -6 && __wm_scalar_119_0.args.length === 1 && __wm_is_tuple(__wm_scalar_119_0.args[0]) && __wm_scalar_119_0.args[0].length === 2) {
const pattern_1754 = __wm_scalar_119_0.args[0][0];
const rest_1755 = __wm_scalar_119_0.args[0][1];
const context_1756 = __wm_scalar_119_1;
const nodes_1757 = __wm_scalar_119_2;
{
const exactPattern_1758 = pattern_1754;
const exactContext_1759 = context_1756;
{
const __wm_tail_arg_105_0 = rest_1755;
const __wm_tail_arg_105_1 = exactContext_1759;
const __wm_tail_arg_105_2 = Map.set([nodes_1757, exactPattern_1758.id, computePatternNode_1522__wm_d2(exactPattern_1758, exactContext_1759)]);
items_1749 = __wm_tail_arg_105_0;
context_1750 = __wm_tail_arg_105_1;
nodes_1751 = __wm_tail_arg_105_2;
continue __wm_tail_91;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const foldPatternNodes_1748 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldPatternNodes_1748__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const foldPatternBindings_1760__wm_d3 = (items_1761, context_1762, bound_1763) => {
__wm_tail_92: while (true) {
{
const __wm_scalar_120_0 = items_1761;
const __wm_scalar_120_1 = context_1762;
const __wm_scalar_120_2 = bound_1763;
if (__wm_scalar_120_0 === __wm_basis_Nil) {
const _context_1764 = __wm_scalar_120_1;
const bound_1765 = __wm_scalar_120_2;
return bound_1765;
} else if (__wm_scalar_120_0?.ctor === -6 && __wm_scalar_120_0.args.length === 1 && __wm_is_tuple(__wm_scalar_120_0.args[0]) && __wm_scalar_120_0.args[0].length === 2) {
const pattern_1766 = __wm_scalar_120_0.args[0][0];
const rest_1767 = __wm_scalar_120_0.args[0][1];
const context_1768 = __wm_scalar_120_1;
const bound_1769 = __wm_scalar_120_2;
{
const exactPattern_1770 = pattern_1766;
const exactContext_1771 = context_1768;
if ((exactPattern_1770.bindingId < 0)) {
{
const __wm_tail_arg_106_0 = rest_1767;
const __wm_tail_arg_106_1 = exactContext_1771;
const __wm_tail_arg_106_2 = bound_1769;
items_1761 = __wm_tail_arg_106_0;
context_1762 = __wm_tail_arg_106_1;
bound_1763 = __wm_tail_arg_106_2;
continue __wm_tail_92;
}
} else {
{
const key_1772 = ((exactPattern_1770.bindingId * 1000000) + exactPattern_1770.ownerFunctionId);
{
const __wm_tail_value_107 = Map.get([bound_1769, key_1772]);
if (__wm_tail_value_107?.ctor === -2 && __wm_tail_value_107.args.length === 1) {
const _node_1773 = __wm_tail_value_107.args[0];
{
const __wm_tail_arg_108_0 = rest_1767;
const __wm_tail_arg_108_1 = exactContext_1771;
const __wm_tail_arg_108_2 = bound_1769;
items_1761 = __wm_tail_arg_108_0;
context_1762 = __wm_tail_arg_108_1;
bound_1763 = __wm_tail_arg_108_2;
continue __wm_tail_92;
}
} else if (__wm_tail_value_107 === __wm_basis_None) {

{
const __wm_tail_arg_109_0 = rest_1767;
const __wm_tail_arg_109_1 = exactContext_1771;
const __wm_tail_arg_109_2 = Map.set([bound_1769, key_1772, computePatternNode_1522__wm_d2(exactPattern_1770, exactContext_1771)]);
items_1761 = __wm_tail_arg_109_0;
context_1762 = __wm_tail_arg_109_1;
bound_1763 = __wm_tail_arg_109_2;
continue __wm_tail_92;
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
const foldPatternBindings_1760 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldPatternBindings_1760__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const buildAllLanes_1774__wm_d4 = (items_1775, context_1776, exprNodes_1777, memo_1778) => {
__wm_tail_93: while (true) {
{
const __wm_scalar_121_0 = items_1775;
const __wm_scalar_121_1 = context_1776;
const __wm_scalar_121_2 = exprNodes_1777;
const __wm_scalar_121_3 = memo_1778;
if (__wm_scalar_121_0 === __wm_basis_Nil) {
const _context_1779 = __wm_scalar_121_1;
const _exprNodes_1780 = __wm_scalar_121_2;
const memo_1781 = __wm_scalar_121_3;
return memo_1781;
} else if (__wm_scalar_121_0?.ctor === -6 && __wm_scalar_121_0.args.length === 1 && __wm_is_tuple(__wm_scalar_121_0.args[0]) && __wm_scalar_121_0.args[0].length === 2) {
const expression_1782 = __wm_scalar_121_0.args[0][0];
const rest_1783 = __wm_scalar_121_0.args[0][1];
const context_1784 = __wm_scalar_121_1;
const exprNodes_1785 = __wm_scalar_121_2;
const memo_1786 = __wm_scalar_121_3;
{
const exactExpression_1787 = expression_1782;
const exactContext_1788 = context_1784;
{
const __wm_tail_arg_110_0 = rest_1783;
const __wm_tail_arg_110_1 = exactContext_1788;
const __wm_tail_arg_110_2 = exprNodes_1785;
const __wm_tail_arg_110_3 = laneForMemo_1705__wm_d6(exactExpression_1787.id, exactContext_1788, exprNodes_1785, memo_1786, __wm_basis_Nil, 256);
items_1775 = __wm_tail_arg_110_0;
context_1776 = __wm_tail_arg_110_1;
exprNodes_1777 = __wm_tail_arg_110_2;
memo_1778 = __wm_tail_arg_110_3;
continue __wm_tail_93;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildAllLanes_1774 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return buildAllLanes_1774__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const buildNumericCaches_1794 = (__arg) => {
if (true) {
const context_1789 = __arg;
const exprNodes_1790 = foldExprNodes_1736__wm_d3(context_1789.expressions, context_1789, Map.empty(Map.numberCompare));
const patternNodes_1791 = foldPatternNodes_1748__wm_d3(context_1789.patterns, context_1789, Map.empty(Map.numberCompare));
const patternByBinding_1792 = foldPatternBindings_1760__wm_d3(context_1789.patterns, context_1789, Map.empty(Map.numberCompare));
const lanes_1793 = buildAllLanes_1774__wm_d4(context_1789.expressions, context_1789, exprNodes_1790, Map.empty(Map.numberCompare));
return { ...context_1789, exprNodes: exprNodes_1790, patternNodes: patternNodes_1791, patternByBinding: patternByBinding_1792, lanes: lanes_1793 };
}
__wm_fail("Match", "pattern match failure in function");
};
const numericChildNodes_1795__wm_d3 = (children_1796, context_1797, nodes_1798) => {
__wm_tail_94: while (true) {
{
const __wm_scalar_122_0 = children_1796;
const __wm_scalar_122_1 = context_1797;
const __wm_scalar_122_2 = nodes_1798;
if (__wm_scalar_122_0 === __wm_basis_Nil) {
const context_1799 = __wm_scalar_122_1;
const nodes_1800 = __wm_scalar_122_2;
return nodes_1800;
} else if (__wm_scalar_122_0?.ctor === -6 && __wm_scalar_122_0.args.length === 1 && __wm_is_tuple(__wm_scalar_122_0.args[0]) && __wm_scalar_122_0.args[0].length === 2) {
const childId_1801 = __wm_scalar_122_0.args[0][0];
const rest_1802 = __wm_scalar_122_0.args[0][1];
const context_1803 = __wm_scalar_122_1;
const nodes_1804 = __wm_scalar_122_2;
{
const exactContext_1805 = context_1803;
const child_1806 = findExpression_1627__wm_d2(exactContext_1805.expressions, childId_1801);
const node_1807 = expressionNode_1519__wm_d2(child_1806, exactContext_1805);
{
const __wm_tail_arg_111_0 = rest_1802;
const __wm_tail_arg_111_1 = exactContext_1805;
const __wm_tail_arg_111_2 = ((node_1807 < 0) ? nodes_1804 : __wm_basis_Cons([node_1807, nodes_1804]));
children_1796 = __wm_tail_arg_111_0;
context_1797 = __wm_tail_arg_111_1;
nodes_1798 = __wm_tail_arg_111_2;
continue __wm_tail_94;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const numericChildNodes_1795 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return numericChildNodes_1795__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const ownAndChildren_1812__wm_d2 = (expression_1808, context_1809) => {
const own_1810 = expressionNode_1519__wm_d2(expression_1808, context_1809);
const children_1811 = numericChildNodes_1795__wm_d3(Js.Array.toList(expression_1808.children), context_1809, __wm_basis_Nil);
if ((own_1810 < 0)) {
return children_1811;
} else {
return __wm_basis_Cons([own_1810, children_1811]);
}
};
const ownAndChildren_1812 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return ownAndChildren_1812__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeArguments_1813__wm_d5 = (argumentIds_1814, paramIds_1815, context_1816, representations_1817, changed_1818) => {
__wm_tail_95: while (true) {
{
const __wm_scalar_123_0 = argumentIds_1814;
const __wm_scalar_123_1 = paramIds_1815;
const __wm_scalar_123_2 = context_1816;
const __wm_scalar_123_3 = representations_1817;
const __wm_scalar_123_4 = changed_1818;
if (__wm_scalar_123_0 === __wm_basis_Nil) {
const context_1819 = __wm_scalar_123_2;
const representations_1820 = __wm_scalar_123_3;
const changed_1821 = __wm_scalar_123_4;
return [representations_1820, changed_1821];
} else if (__wm_scalar_123_1 === __wm_basis_Nil) {
const context_1822 = __wm_scalar_123_2;
const representations_1823 = __wm_scalar_123_3;
const changed_1824 = __wm_scalar_123_4;
return [representations_1823, changed_1824];
} else if (__wm_scalar_123_0?.ctor === -6 && __wm_scalar_123_0.args.length === 1 && __wm_is_tuple(__wm_scalar_123_0.args[0]) && __wm_scalar_123_0.args[0].length === 2 && __wm_scalar_123_1?.ctor === -6 && __wm_scalar_123_1.args.length === 1 && __wm_is_tuple(__wm_scalar_123_1.args[0]) && __wm_scalar_123_1.args[0].length === 2) {
const argumentId_1825 = __wm_scalar_123_0.args[0][0];
const argumentRest_1826 = __wm_scalar_123_0.args[0][1];
const paramId_1827 = __wm_scalar_123_1.args[0][0];
const paramRest_1828 = __wm_scalar_123_1.args[0][1];
const context_1829 = __wm_scalar_123_2;
const representations_1830 = __wm_scalar_123_3;
const changed_1831 = __wm_scalar_123_4;
{
const exactContext_1832 = context_1829;
const argument_1833 = findExpression_1627__wm_d2(exactContext_1832.expressions, argumentId_1825);
const param_1834 = findParam_1603__wm_d2(exactContext_1832.params, paramId_1827);
const pattern_1835 = findPattern_1611__wm_d2(exactContext_1832.patterns, param_1834.patternId);
const __wm_bind_59 = (__wm_eq(pattern_1835.kind, "tuple") ? (() => {
const __wm_bind_60 = mergeGroup_1591__wm_d2(__wm_basis_Cons([expressionNode_1519__wm_d2(argument_1833, exactContext_1832), __wm_basis_Cons([patternNode_1526__wm_d2(pattern_1835, exactContext_1832), __wm_basis_Nil])]), representations_1830);
if (!(__wm_is_tuple(__wm_bind_60) && __wm_bind_60.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withSingle_1836 = __wm_bind_60[0];
const singleChanged_1837 = __wm_bind_60[1];
const __wm_bind_61 = mergeLanePairs_1680__wm_d4(patternLaneNodes_1671__wm_d2(Js.Array.toList(pattern_1835.children), exactContext_1832), lookupLanes_1535__wm_d2(exactContext_1832, argument_1833.id), withSingle_1836, false);
if (!(__wm_is_tuple(__wm_bind_61) && __wm_bind_61.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const merged_1838 = __wm_bind_61[0];
const lanesChanged_1839 = __wm_bind_61[1];
return [merged_1838, __wm_op_or_d2(singleChanged_1837, lanesChanged_1839)];
})() : mergeGroup_1591__wm_d2(__wm_basis_Cons([expressionNode_1519__wm_d2(argument_1833, exactContext_1832), __wm_basis_Cons([patternNode_1526__wm_d2(pattern_1835, exactContext_1832), __wm_basis_Nil])]), representations_1830));
if (!(__wm_is_tuple(__wm_bind_59) && __wm_bind_59.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1840 = __wm_bind_59[0];
const pairChanged_1841 = __wm_bind_59[1];
{
const __wm_tail_arg_112_0 = argumentRest_1826;
const __wm_tail_arg_112_1 = paramRest_1828;
const __wm_tail_arg_112_2 = exactContext_1832;
const __wm_tail_arg_112_3 = next_1840;
const __wm_tail_arg_112_4 = __wm_op_or_d2(changed_1831, pairChanged_1841);
argumentIds_1814 = __wm_tail_arg_112_0;
paramIds_1815 = __wm_tail_arg_112_1;
context_1816 = __wm_tail_arg_112_2;
representations_1817 = __wm_tail_arg_112_3;
changed_1818 = __wm_tail_arg_112_4;
continue __wm_tail_95;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const mergeArguments_1813 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return mergeArguments_1813__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const applyExpression_1860__wm_d3 = (expression_1842, context_1843, representations_1844) => {
if (__wm_eq(expression_1842.kind, "var")) {
return mergeGroup_1591__wm_d2(__wm_basis_Cons([expressionNode_1519__wm_d2(expression_1842, context_1843), __wm_basis_Cons([boundPatternNode_1531__wm_d3(context_1843, expression_1842.bindingId, expression_1842.ownerFunctionId), __wm_basis_Nil])]), representations_1844);
} else {
if (__wm_eq(expression_1842.kind, "uniform")) {
const field_1845 = findEnvironmentField_1643__wm_d2(context_1843.environmentFields, expression_1842.index);
return mergeGroup_1591__wm_d2(__wm_basis_Cons([expressionNode_1519__wm_d2(expression_1842, context_1843), __wm_basis_Cons([fieldNode_1538__wm_d2(field_1845, context_1843), __wm_basis_Nil])]), representations_1844);
} else {
if (__wm_eq(expression_1842.kind, "tuple")) {
if (numberEqual_1483__wm_d2(expressionNode_1519__wm_d2(expression_1842, context_1843), __wm_op_sub(1))) {
return [representations_1844, false];
} else {
return mergeGroup_1591__wm_d2(ownAndChildren_1812__wm_d2(expression_1842, context_1843), representations_1844);
}
} else {
if (__wm_op_or_d2(__wm_op_or_d2(__wm_op_or_d2(__wm_op_or_d2(__wm_eq(expression_1842.kind, "project"), __wm_eq(expression_1842.kind, "copy")), __wm_eq(expression_1842.kind, "binary")), __wm_eq(expression_1842.kind, "unary")), __wm_eq(expression_1842.kind, "builtin"))) {
return mergeGroup_1591__wm_d2(ownAndChildren_1812__wm_d2(expression_1842, context_1843), representations_1844);
} else {
if (__wm_eq(expression_1842.kind, "if")) {
const __wm_bind_62 = mergeGroup_1591__wm_d2(ownAndChildren_1812__wm_d2(expression_1842, context_1843), representations_1844);
if (!(__wm_is_tuple(__wm_bind_62) && __wm_bind_62.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withOwn_1846 = __wm_bind_62[0];
const ownChanged_1847 = __wm_bind_62[1];
const own_1848 = expressionNode_1519__wm_d2(expression_1842, context_1843);
if (numberEqual_1483__wm_d2(own_1848, __wm_op_sub(1))) {
const __wm_return_value_50 = Js.Array.toList(expression_1842.children);
if (__wm_return_value_50?.ctor === -6 && __wm_return_value_50.args.length === 1 && __wm_is_tuple(__wm_return_value_50.args[0]) && __wm_return_value_50.args[0].length === 2 && __wm_return_value_50.args[0][1]?.ctor === -6 && __wm_return_value_50.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_50.args[0][1].args[0]) && __wm_return_value_50.args[0][1].args[0].length === 2 && __wm_return_value_50.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_50.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_50.args[0][1].args[0][1].args[0]) && __wm_return_value_50.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_50.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const _cond_1849 = __wm_return_value_50.args[0][0];
const thenId_1850 = __wm_return_value_50.args[0][1].args[0][0];
const elseId_1851 = __wm_return_value_50.args[0][1].args[0][1].args[0][0];
const __wm_bind_63 = mergeLanePairs_1680__wm_d4(lookupLanes_1535__wm_d2(context_1843, thenId_1850), lookupLanes_1535__wm_d2(context_1843, elseId_1851), withOwn_1846, false);
if (!(__wm_is_tuple(__wm_bind_63) && __wm_bind_63.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const merged_1852 = __wm_bind_63[0];
const pairChanged_1853 = __wm_bind_63[1];
return [merged_1852, __wm_op_or_d2(ownChanged_1847, pairChanged_1853)];
} else if (true) {

return [withOwn_1846, ownChanged_1847];
}
__wm_fail("Match", "non-exhaustive match");
} else {
return [withOwn_1846, ownChanged_1847];
}
} else {
if (__wm_eq(expression_1842.kind, "block")) {
const block_1854 = findBlock_1635__wm_d2(context_1843.blocks, expression_1842.id);
const result_1855 = findExpression_1627__wm_d2(context_1843.expressions, block_1854.resultExprId);
return mergeGroup_1591__wm_d2(__wm_basis_Cons([expressionNode_1519__wm_d2(expression_1842, context_1843), __wm_basis_Cons([expressionNode_1519__wm_d2(result_1855, context_1843), __wm_basis_Nil])]), representations_1844);
} else {
if (__wm_eq(expression_1842.kind, "call")) {
const target_1856 = findFunction_1619__wm_d2(context_1843.functions, expression_1842.functionId);
const body_1857 = findExpression_1627__wm_d2(context_1843.expressions, target_1856.bodyExprId);
const __wm_bind_64 = mergeGroup_1591__wm_d2(__wm_basis_Cons([expressionNode_1519__wm_d2(expression_1842, context_1843), __wm_basis_Cons([expressionNode_1519__wm_d2(body_1857, context_1843), __wm_basis_Nil])]), representations_1844);
if (!(__wm_is_tuple(__wm_bind_64) && __wm_bind_64.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withResult_1858 = __wm_bind_64[0];
const resultChanged_1859 = __wm_bind_64[1];
return mergeArguments_1813__wm_d5(Js.Array.toList(expression_1842.children), Js.Array.toList(target_1856.paramIds), context_1843, withResult_1858, resultChanged_1859);
} else {
return [representations_1844, false];
}
}
}
}
}
}
}
};
const applyExpression_1860 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return applyExpression_1860__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const expressionSweep_1861__wm_d4 = (expressions_1862, context_1863, representations_1864, changed_1865) => {
__wm_tail_96: while (true) {
{
const __wm_scalar_124_0 = expressions_1862;
const __wm_scalar_124_1 = context_1863;
const __wm_scalar_124_2 = representations_1864;
const __wm_scalar_124_3 = changed_1865;
if (__wm_scalar_124_0 === __wm_basis_Nil) {
const context_1866 = __wm_scalar_124_1;
const representations_1867 = __wm_scalar_124_2;
const changed_1868 = __wm_scalar_124_3;
return [representations_1867, changed_1868];
} else if (__wm_scalar_124_0?.ctor === -6 && __wm_scalar_124_0.args.length === 1 && __wm_is_tuple(__wm_scalar_124_0.args[0]) && __wm_scalar_124_0.args[0].length === 2) {
const expression_1869 = __wm_scalar_124_0.args[0][0];
const rest_1870 = __wm_scalar_124_0.args[0][1];
const context_1871 = __wm_scalar_124_1;
const representations_1872 = __wm_scalar_124_2;
const changed_1873 = __wm_scalar_124_3;
{
const exactExpression_1874 = expression_1869;
const exactContext_1875 = context_1871;
const __wm_bind_65 = applyExpression_1860__wm_d3(exactExpression_1874, exactContext_1875, representations_1872);
if (!(__wm_is_tuple(__wm_bind_65) && __wm_bind_65.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1876 = __wm_bind_65[0];
const itemChanged_1877 = __wm_bind_65[1];
{
const __wm_tail_arg_113_0 = rest_1870;
const __wm_tail_arg_113_1 = exactContext_1875;
const __wm_tail_arg_113_2 = next_1876;
const __wm_tail_arg_113_3 = __wm_op_or_d2(changed_1873, itemChanged_1877);
expressions_1862 = __wm_tail_arg_113_0;
context_1863 = __wm_tail_arg_113_1;
representations_1864 = __wm_tail_arg_113_2;
changed_1865 = __wm_tail_arg_113_3;
continue __wm_tail_96;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const expressionSweep_1861 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return expressionSweep_1861__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const patternSweep_1878__wm_d4 = (patterns_1880, context_1881, representations_1882, changed_1883) => {
__wm_tail_97: while (true) {
{
const __wm_scalar_125_0 = patterns_1880;
const __wm_scalar_125_1 = context_1881;
const __wm_scalar_125_2 = representations_1882;
const __wm_scalar_125_3 = changed_1883;
if (__wm_scalar_125_0 === __wm_basis_Nil) {
const context_1884 = __wm_scalar_125_1;
const representations_1885 = __wm_scalar_125_2;
const changed_1886 = __wm_scalar_125_3;
return [representations_1885, changed_1886];
} else if (__wm_scalar_125_0?.ctor === -6 && __wm_scalar_125_0.args.length === 1 && __wm_is_tuple(__wm_scalar_125_0.args[0]) && __wm_scalar_125_0.args[0].length === 2) {
const pattern_1887 = __wm_scalar_125_0.args[0][0];
const rest_1888 = __wm_scalar_125_0.args[0][1];
const context_1889 = __wm_scalar_125_1;
const representations_1890 = __wm_scalar_125_2;
const changed_1891 = __wm_scalar_125_3;
{
const exactPattern_1892 = pattern_1887;
const exactContext_1893 = context_1889;
const childNodes_1894 = mapPatternNodes_1879__wm_d3(Js.Array.toList(exactPattern_1892.children), exactContext_1893, __wm_basis_Nil);
const own_1895 = patternNode_1526__wm_d2(exactPattern_1892, exactContext_1893);
const nodes_1896 = (numberEqual_1483__wm_d2(own_1895, __wm_op_sub(1)) ? __wm_basis_Nil : __wm_basis_Cons([own_1895, childNodes_1894]));
const __wm_bind_66 = (__wm_eq(exactPattern_1892.kind, "tuple") ? mergeGroup_1591__wm_d2(nodes_1896, representations_1890) : [representations_1890, false]);
if (!(__wm_is_tuple(__wm_bind_66) && __wm_bind_66.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1897 = __wm_bind_66[0];
const itemChanged_1898 = __wm_bind_66[1];
{
const __wm_tail_arg_114_0 = rest_1888;
const __wm_tail_arg_114_1 = exactContext_1893;
const __wm_tail_arg_114_2 = next_1897;
const __wm_tail_arg_114_3 = __wm_op_or_d2(changed_1891, itemChanged_1898);
patterns_1880 = __wm_tail_arg_114_0;
context_1881 = __wm_tail_arg_114_1;
representations_1882 = __wm_tail_arg_114_2;
changed_1883 = __wm_tail_arg_114_3;
continue __wm_tail_97;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const patternSweep_1878 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return patternSweep_1878__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const mapPatternNodes_1879__wm_d3 = (ids_1899, context_1900, nodes_1901) => {
__wm_tail_98: while (true) {
{
const __wm_scalar_126_0 = ids_1899;
const __wm_scalar_126_1 = context_1900;
const __wm_scalar_126_2 = nodes_1901;
if (__wm_scalar_126_0 === __wm_basis_Nil) {
const context_1902 = __wm_scalar_126_1;
const nodes_1903 = __wm_scalar_126_2;
return nodes_1903;
} else if (__wm_scalar_126_0?.ctor === -6 && __wm_scalar_126_0.args.length === 1 && __wm_is_tuple(__wm_scalar_126_0.args[0]) && __wm_scalar_126_0.args[0].length === 2) {
const id_1904 = __wm_scalar_126_0.args[0][0];
const rest_1905 = __wm_scalar_126_0.args[0][1];
const context_1906 = __wm_scalar_126_1;
const nodes_1907 = __wm_scalar_126_2;
{
const exactContext_1908 = context_1906;
const pattern_1909 = findPattern_1611__wm_d2(exactContext_1908.patterns, id_1904);
const node_1910 = patternNode_1526__wm_d2(pattern_1909, exactContext_1908);
{
const __wm_tail_arg_115_0 = rest_1905;
const __wm_tail_arg_115_1 = exactContext_1908;
const __wm_tail_arg_115_2 = ((node_1910 < 0) ? nodes_1907 : __wm_basis_Cons([node_1910, nodes_1907]));
ids_1899 = __wm_tail_arg_115_0;
context_1900 = __wm_tail_arg_115_1;
nodes_1901 = __wm_tail_arg_115_2;
continue __wm_tail_98;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const mapPatternNodes_1879 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return mapPatternNodes_1879__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const letSweep_1911__wm_d4 = (lets_1912, context_1913, representations_1914, changed_1915) => {
__wm_tail_99: while (true) {
{
const __wm_scalar_127_0 = lets_1912;
const __wm_scalar_127_1 = context_1913;
const __wm_scalar_127_2 = representations_1914;
const __wm_scalar_127_3 = changed_1915;
if (__wm_scalar_127_0 === __wm_basis_Nil) {
const context_1916 = __wm_scalar_127_1;
const representations_1917 = __wm_scalar_127_2;
const changed_1918 = __wm_scalar_127_3;
return [representations_1917, changed_1918];
} else if (__wm_scalar_127_0?.ctor === -6 && __wm_scalar_127_0.args.length === 1 && __wm_is_tuple(__wm_scalar_127_0.args[0]) && __wm_scalar_127_0.args[0].length === 2) {
const binding_1919 = __wm_scalar_127_0.args[0][0];
const rest_1920 = __wm_scalar_127_0.args[0][1];
const context_1921 = __wm_scalar_127_1;
const representations_1922 = __wm_scalar_127_2;
const changed_1923 = __wm_scalar_127_3;
{
const exactBinding_1924 = binding_1919;
const exactContext_1925 = context_1921;
const pattern_1926 = findPattern_1611__wm_d2(exactContext_1925.patterns, exactBinding_1924.patternId);
const value_1927 = findExpression_1627__wm_d2(exactContext_1925.expressions, exactBinding_1924.valueExprId);
const __wm_bind_67 = (__wm_eq(pattern_1926.kind, "tuple") ? (() => {
const __wm_bind_68 = mergeGroup_1591__wm_d2(__wm_basis_Cons([patternNode_1526__wm_d2(pattern_1926, exactContext_1925), __wm_basis_Cons([expressionNode_1519__wm_d2(value_1927, exactContext_1925), __wm_basis_Nil])]), representations_1922);
if (!(__wm_is_tuple(__wm_bind_68) && __wm_bind_68.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withSingle_1928 = __wm_bind_68[0];
const singleChanged_1929 = __wm_bind_68[1];
const __wm_bind_69 = mergeLanePairs_1680__wm_d4(patternLaneNodes_1671__wm_d2(Js.Array.toList(pattern_1926.children), exactContext_1925), lookupLanes_1535__wm_d2(exactContext_1925, value_1927.id), withSingle_1928, false);
if (!(__wm_is_tuple(__wm_bind_69) && __wm_bind_69.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const merged_1930 = __wm_bind_69[0];
const lanesChanged_1931 = __wm_bind_69[1];
return [merged_1930, __wm_op_or_d2(singleChanged_1929, lanesChanged_1931)];
})() : mergeGroup_1591__wm_d2(__wm_basis_Cons([patternNode_1526__wm_d2(pattern_1926, exactContext_1925), __wm_basis_Cons([expressionNode_1519__wm_d2(value_1927, exactContext_1925), __wm_basis_Nil])]), representations_1922));
if (!(__wm_is_tuple(__wm_bind_67) && __wm_bind_67.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1932 = __wm_bind_67[0];
const itemChanged_1933 = __wm_bind_67[1];
{
const __wm_tail_arg_116_0 = rest_1920;
const __wm_tail_arg_116_1 = exactContext_1925;
const __wm_tail_arg_116_2 = next_1932;
const __wm_tail_arg_116_3 = __wm_op_or_d2(changed_1923, itemChanged_1933);
lets_1912 = __wm_tail_arg_116_0;
context_1913 = __wm_tail_arg_116_1;
representations_1914 = __wm_tail_arg_116_2;
changed_1915 = __wm_tail_arg_116_3;
continue __wm_tail_99;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const letSweep_1911 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return letSweep_1911__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const seedExpressions_1934__wm_d3 = (expressions_1935, context_1936, representations_1937) => {
__wm_tail_100: while (true) {
{
const __wm_scalar_128_0 = expressions_1935;
const __wm_scalar_128_1 = context_1936;
const __wm_scalar_128_2 = representations_1937;
if (__wm_scalar_128_0 === __wm_basis_Nil) {
const context_1938 = __wm_scalar_128_1;
const representations_1939 = __wm_scalar_128_2;
return representations_1939;
} else if (__wm_scalar_128_0?.ctor === -6 && __wm_scalar_128_0.args.length === 1 && __wm_is_tuple(__wm_scalar_128_0.args[0]) && __wm_scalar_128_0.args[0].length === 2) {
const expression_1940 = __wm_scalar_128_0.args[0][0];
const rest_1941 = __wm_scalar_128_0.args[0][1];
const context_1942 = __wm_scalar_128_1;
const representations_1943 = __wm_scalar_128_2;
{
const exactExpression_1944 = expression_1940;
const exactContext_1945 = context_1942;
const explicit_1946 = (__wm_eq(exactExpression_1944.semanticId, "gpu.i32") ? "i32" : (__wm_eq(exactExpression_1944.semanticId, "gpu.f32") ? "f32" : exactExpression_1944.numberKind));
const __wm_bind_70 = setRepresentation_1559__wm_d4(representations_1943, expressionNode_1519__wm_d2(exactExpression_1944, exactContext_1945), explicit_1946, exactExpression_1944.spanId);
if (!(__wm_is_tuple(__wm_bind_70) && __wm_bind_70.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1947 = __wm_bind_70[0];
const _changed_1948 = __wm_bind_70[1];
const withResourceResult_1951 = (__wm_eq(exactExpression_1944.kind, "resource-call") ? (() => {
const __wm_bind_71 = setRepresentation_1559__wm_d4(next_1947, expressionNode_1519__wm_d2(exactExpression_1944, exactContext_1945), "f32", exactExpression_1944.spanId);
if (!(__wm_is_tuple(__wm_bind_71) && __wm_bind_71.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const updated_1949 = __wm_bind_71[0];
const _resourceChanged_1950 = __wm_bind_71[1];
return updated_1949;
})() : next_1947);
const withResourceCoordinate_1962 = (__wm_eq(exactExpression_1944.kind, "resource-call") ? (() => {
const coordinateId_1957 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2 && __v.args[0][1]?.ctor === -6 && __v.args[0][1].args.length === 1 && __wm_is_tuple(__v.args[0][1].args[0]) && __v.args[0][1].args[0].length === 2 && __v.args[0][1].args[0][1]?.ctor === -6 && __v.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__v.args[0][1].args[0][1].args[0]) && __v.args[0][1].args[0][1].args[0].length === 2 && __v.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const _texture_1952 = __v.args[0][0];
const _sampler_1953 = __v.args[0][1].args[0][0];
const id_1954 = __v.args[0][1].args[0][1].args[0][0];
return id_1954;
} else if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2 && __v.args[0][1]?.ctor === -6 && __v.args[0][1].args.length === 1 && __wm_is_tuple(__v.args[0][1].args[0]) && __v.args[0][1].args[0].length === 2 && __v.args[0][1].args[0][1] === __wm_basis_Nil) {
const _texture_1955 = __v.args[0][0];
const id_1956 = __v.args[0][1].args[0][0];
return id_1956;
} else if (true) {

return __wm_fail("Panic", "GPU resource call has invalid coordinate arity");
}
__wm_fail("Match", "non-exhaustive match");
})(Js.Array.toList(exactExpression_1944.children));
const coordinate_1958 = findExpression_1627__wm_d2(exactContext_1945.expressions, coordinateId_1957);
const coordinateRepresentation_1959 = (__wm_eq(exactExpression_1944.resourceOperation, "load") ? "i32" : "f32");
const __wm_bind_72 = setRepresentation_1559__wm_d4(withResourceResult_1951, expressionNode_1519__wm_d2(coordinate_1958, exactContext_1945), coordinateRepresentation_1959, coordinate_1958.spanId);
if (!(__wm_is_tuple(__wm_bind_72) && __wm_bind_72.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const updated_1960 = __wm_bind_72[0];
const _coordinateChanged_1961 = __wm_bind_72[1];
return updated_1960;
})() : withResourceResult_1951);
{
const __wm_tail_arg_117_0 = rest_1941;
const __wm_tail_arg_117_1 = exactContext_1945;
const __wm_tail_arg_117_2 = withResourceCoordinate_1962;
expressions_1935 = __wm_tail_arg_117_0;
context_1936 = __wm_tail_arg_117_1;
representations_1937 = __wm_tail_arg_117_2;
continue __wm_tail_100;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const seedExpressions_1934 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return seedExpressions_1934__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const seedFragmentAbi_1977__wm_d3 = (input_1963, context_1964, representations_1965) => {
const root_1966 = findFunction_1619__wm_d2(context_1964.functions, input_1963.root.functionId);
const firstParamId_1969 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2) {
const id_1967 = __v.args[0][0];
const __1968 = __v.args[0][1];
return id_1967;
} else if (__v === __wm_basis_Nil) {

return __wm_fail("Panic", "fragment root has no coordinate parameter");
}
__wm_fail("Match", "non-exhaustive match");
})(Js.Array.toList(root_1966.paramIds));
const param_1970 = findParam_1603__wm_d2(context_1964.params, firstParamId_1969);
const pattern_1971 = findPattern_1611__wm_d2(context_1964.patterns, param_1970.patternId);
const body_1972 = findExpression_1627__wm_d2(context_1964.expressions, root_1966.bodyExprId);
const __wm_bind_73 = setRepresentation_1559__wm_d4(representations_1965, patternNode_1526__wm_d2(pattern_1971, context_1964), "f32", pattern_1971.spanId);
if (!(__wm_is_tuple(__wm_bind_73) && __wm_bind_73.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withCoord_1973 = __wm_bind_73[0];
const _coordChanged_1974 = __wm_bind_73[1];
const __wm_bind_74 = setRepresentation_1559__wm_d4(withCoord_1973, expressionNode_1519__wm_d2(body_1972, context_1964), "f32", body_1972.spanId);
if (!(__wm_is_tuple(__wm_bind_74) && __wm_bind_74.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withResult_1975 = __wm_bind_74[0];
const _resultChanged_1976 = __wm_bind_74[1];
return withResult_1975;
};
const seedFragmentAbi_1977 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return seedFragmentAbi_1977__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const solveFixedPoint_1978__wm_d2 = (context_1979, representations_1980) => {
__wm_tail_101: while (true) {
{
const __wm_bind_75 = expressionSweep_1861__wm_d4(context_1979.expressions, context_1979, representations_1980, false);
if (!(__wm_is_tuple(__wm_bind_75) && __wm_bind_75.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterExpressions_1981 = __wm_bind_75[0];
const expressionChanged_1982 = __wm_bind_75[1];
const __wm_bind_76 = patternSweep_1878__wm_d4(context_1979.patterns, context_1979, afterExpressions_1981, false);
if (!(__wm_is_tuple(__wm_bind_76) && __wm_bind_76.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterPatterns_1983 = __wm_bind_76[0];
const patternChanged_1984 = __wm_bind_76[1];
const __wm_bind_77 = letSweep_1911__wm_d4(context_1979.lets, context_1979, afterPatterns_1983, false);
if (!(__wm_is_tuple(__wm_bind_77) && __wm_bind_77.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterLets_1985 = __wm_bind_77[0];
const letChanged_1986 = __wm_bind_77[1];
if (__wm_op_or_d2(__wm_op_or_d2(expressionChanged_1982, patternChanged_1984), letChanged_1986)) {
{
const __wm_tail_arg_118_0 = context_1979;
const __wm_tail_arg_118_1 = afterLets_1985;
context_1979 = __wm_tail_arg_118_0;
representations_1980 = __wm_tail_arg_118_1;
continue __wm_tail_101;
}
} else {
return afterLets_1985;
}
}
}
};
const solveFixedPoint_1978 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return solveFixedPoint_1978__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const ensureExpressionsResolved_1987__wm_d3 = (expressions_1988, context_1989, representations_1990) => {
__wm_tail_102: while (true) {
{
const __wm_scalar_129_0 = expressions_1988;
const __wm_scalar_129_1 = context_1989;
const __wm_scalar_129_2 = representations_1990;
if (__wm_scalar_129_0 === __wm_basis_Nil) {
const context_1991 = __wm_scalar_129_1;
const representations_1992 = __wm_scalar_129_2;
return undefined;
} else if (__wm_scalar_129_0?.ctor === -6 && __wm_scalar_129_0.args.length === 1 && __wm_is_tuple(__wm_scalar_129_0.args[0]) && __wm_scalar_129_0.args[0].length === 2) {
const expression_1993 = __wm_scalar_129_0.args[0][0];
const rest_1994 = __wm_scalar_129_0.args[0][1];
const context_1995 = __wm_scalar_129_1;
const representations_1996 = __wm_scalar_129_2;
{
const node_1997 = expressionNode_1519__wm_d2(expression_1993, context_1995);
if (__wm_op_and_d2((node_1997 >= 0), __wm_eq(representation_1545__wm_d2(representations_1996, node_1997), ""))) {
return __wm_fail("Panic", ((("WM_GPU_NUMERIC_UNRESOLVED|" + Text.of(expression_1993.spanId)) + "|expression ") + Text.of(expression_1993.id)));
} else {
{
const __wm_tail_arg_119_0 = rest_1994;
const __wm_tail_arg_119_1 = context_1995;
const __wm_tail_arg_119_2 = representations_1996;
expressions_1988 = __wm_tail_arg_119_0;
context_1989 = __wm_tail_arg_119_1;
representations_1990 = __wm_tail_arg_119_2;
continue __wm_tail_102;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const ensureExpressionsResolved_1987 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return ensureExpressionsResolved_1987__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const ensurePatternsResolved_1998__wm_d3 = (patterns_1999, context_2000, representations_2001) => {
__wm_tail_103: while (true) {
{
const __wm_scalar_130_0 = patterns_1999;
const __wm_scalar_130_1 = context_2000;
const __wm_scalar_130_2 = representations_2001;
if (__wm_scalar_130_0 === __wm_basis_Nil) {
const context_2002 = __wm_scalar_130_1;
const representations_2003 = __wm_scalar_130_2;
return undefined;
} else if (__wm_scalar_130_0?.ctor === -6 && __wm_scalar_130_0.args.length === 1 && __wm_is_tuple(__wm_scalar_130_0.args[0]) && __wm_scalar_130_0.args[0].length === 2) {
const pattern_2004 = __wm_scalar_130_0.args[0][0];
const rest_2005 = __wm_scalar_130_0.args[0][1];
const context_2006 = __wm_scalar_130_1;
const representations_2007 = __wm_scalar_130_2;
{
const node_2008 = patternNode_1526__wm_d2(pattern_2004, context_2006);
if (__wm_op_and_d2((node_2008 >= 0), __wm_eq(representation_1545__wm_d2(representations_2007, node_2008), ""))) {
return __wm_fail("Panic", ((("WM_GPU_NUMERIC_UNRESOLVED|" + Text.of(pattern_2004.spanId)) + "|pattern ") + Text.of(pattern_2004.id)));
} else {
{
const __wm_tail_arg_120_0 = rest_2005;
const __wm_tail_arg_120_1 = context_2006;
const __wm_tail_arg_120_2 = representations_2007;
patterns_1999 = __wm_tail_arg_120_0;
context_2000 = __wm_tail_arg_120_1;
representations_2001 = __wm_tail_arg_120_2;
continue __wm_tail_103;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const ensurePatternsResolved_1998 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return ensurePatternsResolved_1998__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const ensureFieldsResolved_2009__wm_d3 = (fields_2010, context_2011, representations_2012) => {
__wm_tail_104: while (true) {
{
const __wm_scalar_131_0 = fields_2010;
const __wm_scalar_131_1 = context_2011;
const __wm_scalar_131_2 = representations_2012;
if (__wm_scalar_131_0 === __wm_basis_Nil) {
const context_2013 = __wm_scalar_131_1;
const representations_2014 = __wm_scalar_131_2;
return undefined;
} else if (__wm_scalar_131_0?.ctor === -6 && __wm_scalar_131_0.args.length === 1 && __wm_is_tuple(__wm_scalar_131_0.args[0]) && __wm_scalar_131_0.args[0].length === 2) {
const field_2015 = __wm_scalar_131_0.args[0][0];
const rest_2016 = __wm_scalar_131_0.args[0][1];
const context_2017 = __wm_scalar_131_1;
const representations_2018 = __wm_scalar_131_2;
{
const node_2019 = fieldNode_1538__wm_d2(field_2015, context_2017);
if (__wm_op_and_d2((node_2019 >= 0), __wm_eq(representation_1545__wm_d2(representations_2018, node_2019), ""))) {
return __wm_fail("Panic", ((("WM_GPU_NUMERIC_UNRESOLVED|" + Text.of(field_2015.spanId)) + "|environment field ") + field_2015.name));
} else {
{
const __wm_tail_arg_121_0 = rest_2016;
const __wm_tail_arg_121_1 = context_2017;
const __wm_tail_arg_121_2 = representations_2018;
fields_2010 = __wm_tail_arg_121_0;
context_2011 = __wm_tail_arg_121_1;
representations_2012 = __wm_tail_arg_121_2;
continue __wm_tail_104;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const ensureFieldsResolved_2009 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return ensureFieldsResolved_2009__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const solveSliceNumericRepresentations_2028 = (__arg) => {
if (true) {
const input_2020 = __arg;
const expressions_2021 = Js.Array.toList(input_2020.expressions);
const patterns_2022 = Js.Array.toList(input_2020.patterns);
const expressionOffset_2023 = listLength_1484__wm_d2(expressions_2021, 0);
const context_2024 = { expressionOffset: expressionOffset_2023, fieldOffset: (expressionOffset_2023 + listLength_1484__wm_d2(patterns_2022, 0)), types: Js.Array.toList(input_2020.types), expressions: expressions_2021, patterns: patterns_2022, params: Js.Array.toList(input_2020.params), lets: Js.Array.toList(input_2020.lets), blocks: Js.Array.toList(input_2020.blocks), functions: Js.Array.toList(input_2020.functions), environmentFields: Js.Array.toList(input_2020.environmentFields), exprNodes: Map.empty(Map.numberCompare), patternNodes: Map.empty(Map.numberCompare), patternByBinding: Map.empty(Map.numberCompare), lanes: Map.empty(Map.numberCompare) };
const cached_2025 = buildNumericCaches_1794(context_2024);
const seeded_2026 = seedExpressions_1934__wm_d3(expressions_2021, cached_2025, Map.empty(Map.numberCompare));
const solved_2027 = solveFixedPoint_1978__wm_d2(cached_2025, seedFragmentAbi_1977__wm_d3(input_2020, cached_2025, seeded_2026));
ensureExpressionsResolved_1987__wm_d3(expressions_2021, cached_2025, solved_2027);
ensurePatternsResolved_1998__wm_d3(patterns_2022, cached_2025, solved_2027);
ensureFieldsResolved_2009__wm_d3(cached_2025.environmentFields, cached_2025, solved_2027);
return solved_2027;
}
__wm_fail("Match", "pattern match failure in function");
};
const expressionRepresentation_2031__wm_d2 = (representations_2029, expressionId_2030) => {
return representation_1545__wm_d2(representations_2029, expressionId_2030);
};
const expressionRepresentation_2031 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return expressionRepresentation_2031__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const patternRepresentation_2035__wm_d3 = (representations_2032, expressionCount_2033, patternId_2034) => {
return representation_1545__wm_d2(representations_2032, (expressionCount_2033 + patternId_2034));
};
const patternRepresentation_2035 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return patternRepresentation_2035__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
return { "NumericContext": NumericContext_1479, "NumericEvidence": NumericEvidence_1480, "numberEqual": numberEqual_1483, "numberEqual__wm_d2": numberEqual_1483__wm_d2, "listLength": listLength_1484, "listLength__wm_d2": listLength_1484__wm_d2, "findType": findType_1491, "findType__wm_d2": findType_1491__wm_d2, "allNumberTypes": allNumberTypes_1499, "allNumberTypes__wm_d2": allNumberTypes_1499__wm_d2, "numericType": numericType_1512, "numericType__wm_d2": numericType_1512__wm_d2, "computeExpressionNode": computeExpressionNode_1515, "computeExpressionNode__wm_d2": computeExpressionNode_1515__wm_d2, "expressionNode": expressionNode_1519, "expressionNode__wm_d2": expressionNode_1519__wm_d2, "computePatternNode": computePatternNode_1522, "computePatternNode__wm_d2": computePatternNode_1522__wm_d2, "patternNode": patternNode_1526, "patternNode__wm_d2": patternNode_1526__wm_d2, "boundPatternNode": boundPatternNode_1531, "boundPatternNode__wm_d3": boundPatternNode_1531__wm_d3, "lookupLanes": lookupLanes_1535, "lookupLanes__wm_d2": lookupLanes_1535__wm_d2, "fieldNode": fieldNode_1538, "fieldNode__wm_d2": fieldNode_1538__wm_d2, "evidence": evidence_1541, "evidence__wm_d2": evidence_1541__wm_d2, "representation": representation_1545, "representation__wm_d2": representation_1545__wm_d2, "numericConflict": numericConflict_1548, "numericConflict__wm_d2": numericConflict_1548__wm_d2, "setEvidence": setEvidence_1553, "setEvidence__wm_d3": setEvidence_1553__wm_d3, "setRepresentation": setRepresentation_1559, "setRepresentation__wm_d4": setRepresentation_1559__wm_d4, "combinedEvidence": combinedEvidence_1560, "combinedEvidence__wm_d3": combinedEvidence_1560__wm_d3, "setGroup": setGroup_1572, "setGroup__wm_d4": setGroup_1572__wm_d4, "mergeGroup": mergeGroup_1591, "mergeGroup__wm_d2": mergeGroup_1591__wm_d2, "findPatternByBinding": findPatternByBinding_1592, "findPatternByBinding__wm_d3": findPatternByBinding_1592__wm_d3, "findParam": findParam_1603, "findParam__wm_d2": findParam_1603__wm_d2, "findPattern": findPattern_1611, "findPattern__wm_d2": findPattern_1611__wm_d2, "findFunction": findFunction_1619, "findFunction__wm_d2": findFunction_1619__wm_d2, "findExpression": findExpression_1627, "findExpression__wm_d2": findExpression_1627__wm_d2, "findBlock": findBlock_1635, "findBlock__wm_d2": findBlock_1635__wm_d2, "findEnvironmentField": findEnvironmentField_1643, "findEnvironmentField__wm_d2": findEnvironmentField_1643__wm_d2, "laneContains": laneContains_1651, "laneContains__wm_d2": laneContains_1651__wm_d2, "childLaneNodes": childLaneNodes_1658, "childLaneNodes__wm_d2": childLaneNodes_1658__wm_d2, "lookupMemoLanes": lookupMemoLanes_1670, "lookupMemoLanes__wm_d2": lookupMemoLanes_1670__wm_d2, "patternLaneNodes": patternLaneNodes_1671, "patternLaneNodes__wm_d2": patternLaneNodes_1671__wm_d2, "mergeLanePairs": mergeLanePairs_1680, "mergeLanePairs__wm_d4": mergeLanePairs_1680__wm_d4, "findLetForPattern": findLetForPattern_1697, "findLetForPattern__wm_d2": findLetForPattern_1697__wm_d2, "laneForMemo": laneForMemo_1705, "laneForMemo__wm_d6": laneForMemo_1705__wm_d6, "laneForUncached": laneForUncached_1706, "laneForUncached__wm_d6": laneForUncached_1706__wm_d6, "foldExprNodes": foldExprNodes_1736, "foldExprNodes__wm_d3": foldExprNodes_1736__wm_d3, "foldPatternNodes": foldPatternNodes_1748, "foldPatternNodes__wm_d3": foldPatternNodes_1748__wm_d3, "foldPatternBindings": foldPatternBindings_1760, "foldPatternBindings__wm_d3": foldPatternBindings_1760__wm_d3, "buildAllLanes": buildAllLanes_1774, "buildAllLanes__wm_d4": buildAllLanes_1774__wm_d4, "buildNumericCaches": buildNumericCaches_1794, "numericChildNodes": numericChildNodes_1795, "numericChildNodes__wm_d3": numericChildNodes_1795__wm_d3, "ownAndChildren": ownAndChildren_1812, "ownAndChildren__wm_d2": ownAndChildren_1812__wm_d2, "mergeArguments": mergeArguments_1813, "mergeArguments__wm_d5": mergeArguments_1813__wm_d5, "applyExpression": applyExpression_1860, "applyExpression__wm_d3": applyExpression_1860__wm_d3, "expressionSweep": expressionSweep_1861, "expressionSweep__wm_d4": expressionSweep_1861__wm_d4, "patternSweep": patternSweep_1878, "patternSweep__wm_d4": patternSweep_1878__wm_d4, "mapPatternNodes": mapPatternNodes_1879, "mapPatternNodes__wm_d3": mapPatternNodes_1879__wm_d3, "letSweep": letSweep_1911, "letSweep__wm_d4": letSweep_1911__wm_d4, "seedExpressions": seedExpressions_1934, "seedExpressions__wm_d3": seedExpressions_1934__wm_d3, "seedFragmentAbi": seedFragmentAbi_1977, "seedFragmentAbi__wm_d3": seedFragmentAbi_1977__wm_d3, "solveFixedPoint": solveFixedPoint_1978, "solveFixedPoint__wm_d2": solveFixedPoint_1978__wm_d2, "ensureExpressionsResolved": ensureExpressionsResolved_1987, "ensureExpressionsResolved__wm_d3": ensureExpressionsResolved_1987__wm_d3, "ensurePatternsResolved": ensurePatternsResolved_1998, "ensurePatternsResolved__wm_d3": ensurePatternsResolved_1998__wm_d3, "ensureFieldsResolved": ensureFieldsResolved_2009, "ensureFieldsResolved__wm_d3": ensureFieldsResolved_2009__wm_d3, "solveSliceNumericRepresentations": solveSliceNumericRepresentations_2028, "expressionRepresentation": expressionRepresentation_2031, "expressionRepresentation__wm_d2": expressionRepresentation_2031__wm_d2, "patternRepresentation": patternRepresentation_2035, "patternRepresentation__wm_d3": patternRepresentation_2035__wm_d3 };
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
const emitSliceCallableName_1466 = __wm_module_4["emitSliceCallableName"];
const emitSliceSlang_1478 = __wm_module_4["emitSliceSlang"];
const emitSliceSlang_1478__wm_d10 = __wm_module_4["emitSliceSlang__wm_d10"];
const emitSliceSlangModule_1464 = __wm_module_4["emitSliceSlangModule"];
const emitSliceSlangModule_1464__wm_d10 = __wm_module_4["emitSliceSlangModule__wm_d10"];
const NumericEvidence_1480 = __wm_module_5["NumericEvidence"];
const expressionRepresentation_2031 = __wm_module_5["expressionRepresentation"];
const expressionRepresentation_2031__wm_d2 = __wm_module_5["expressionRepresentation__wm_d2"];
const patternRepresentation_2035 = __wm_module_5["patternRepresentation"];
const patternRepresentation_2035__wm_d3 = __wm_module_5["patternRepresentation__wm_d3"];
const solveSliceNumericRepresentations_2028 = __wm_module_5["solveSliceNumericRepresentations"];
const SliceContext_2036 = (__record_args) => ({ expressions: __record_args[0], blocks: __record_args[1], blockItems: __record_args[2], lets: __record_args[3], matches: __record_args[4], matchArms: __record_args[5], patterns: __record_args[6], types: __record_args[7], adts: __record_args[8], functions: __record_args[9], builtinOverloads: __record_args[10], occurrences: __record_args[11] });
const SliceIrState_2037 = (__record_args) => ({ nextExpressionId: __record_args[0], nextArmId: __record_args[1], functions: __record_args[2], expressions: __record_args[3], matchArms: __record_args[4], diagnostics: __record_args[5] });
const BuiltBlockItem_2038 = (__record_args) => ({ itemId: __record_args[0], valueExprId: __record_args[1] });
const reverseInto_2039__wm_d2 = (items_2040, reversed_2041) => {
__wm_tail_105: while (true) {
{
const __wm_scalar_132_0 = items_2040;
const __wm_scalar_132_1 = reversed_2041;
if (__wm_scalar_132_0 === __wm_basis_Nil) {
const reversed_2042 = __wm_scalar_132_1;
return reversed_2042;
} else if (__wm_scalar_132_0?.ctor === -6 && __wm_scalar_132_0.args.length === 1 && __wm_is_tuple(__wm_scalar_132_0.args[0]) && __wm_scalar_132_0.args[0].length === 2) {
const head_2043 = __wm_scalar_132_0.args[0][0];
const rest_2044 = __wm_scalar_132_0.args[0][1];
const reversed_2045 = __wm_scalar_132_1;
{
const __wm_tail_arg_122_0 = rest_2044;
const __wm_tail_arg_122_1 = __wm_basis_Cons([head_2043, reversed_2045]);
items_2040 = __wm_tail_arg_122_0;
reversed_2041 = __wm_tail_arg_122_1;
continue __wm_tail_105;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reverseInto_2039 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reverseInto_2039__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const append_2046__wm_d2 = (left_2047, right_2048) => {
const __wm_scalar_133_0 = left_2047;
const __wm_scalar_133_1 = right_2048;
if (__wm_scalar_133_0 === __wm_basis_Nil) {
const right_2049 = __wm_scalar_133_1;
return right_2049;
} else if (__wm_scalar_133_0?.ctor === -6 && __wm_scalar_133_0.args.length === 1 && __wm_is_tuple(__wm_scalar_133_0.args[0]) && __wm_scalar_133_0.args[0].length === 2) {
const head_2050 = __wm_scalar_133_0.args[0][0];
const rest_2051 = __wm_scalar_133_0.args[0][1];
const right_2052 = __wm_scalar_133_1;
return __wm_basis_Cons([head_2050, append_2046__wm_d2(rest_2051, right_2052)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const append_2046 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return append_2046__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const listLength_2053__wm_d2 = (items_2054, length_2055) => {
__wm_tail_106: while (true) {
{
const __wm_scalar_134_0 = items_2054;
const __wm_scalar_134_1 = length_2055;
if (__wm_scalar_134_0 === __wm_basis_Nil) {
const length_2056 = __wm_scalar_134_1;
return length_2056;
} else if (__wm_scalar_134_0?.ctor === -6 && __wm_scalar_134_0.args.length === 1 && __wm_is_tuple(__wm_scalar_134_0.args[0]) && __wm_scalar_134_0.args[0].length === 2) {
const __2057 = __wm_scalar_134_0.args[0][0];
const rest_2058 = __wm_scalar_134_0.args[0][1];
const length_2059 = __wm_scalar_134_1;
{
const __wm_tail_arg_123_0 = rest_2058;
const __wm_tail_arg_123_1 = (length_2059 + 1);
items_2054 = __wm_tail_arg_123_0;
length_2055 = __wm_tail_arg_123_1;
continue __wm_tail_106;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const listLength_2053 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return listLength_2053__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const numberEqual_2062__wm_d2 = (left_2060, right_2061) => {
return __wm_op_and_d2(__wm_op_not((left_2060 < right_2061)), __wm_op_not((left_2060 > right_2061)));
};
const numberEqual_2062 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numberEqual_2062__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const contains_2063__wm_d2 = (items_2064, expected_2065) => {
__wm_tail_107: while (true) {
{
const __wm_tail_value_124 = items_2064;
if (__wm_tail_value_124 === __wm_basis_Nil) {

return false;
} else if (__wm_tail_value_124?.ctor === -6 && __wm_tail_value_124.args.length === 1 && __wm_is_tuple(__wm_tail_value_124.args[0]) && __wm_tail_value_124.args[0].length === 2) {
const head_2066 = __wm_tail_value_124.args[0][0];
const rest_2067 = __wm_tail_value_124.args[0][1];
if (numberEqual_2062__wm_d2(head_2066, expected_2065)) {
return true;
} else {
{
const __wm_tail_arg_125_0 = rest_2067;
const __wm_tail_arg_125_1 = expected_2065;
items_2064 = __wm_tail_arg_125_0;
expected_2065 = __wm_tail_arg_125_1;
continue __wm_tail_107;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const contains_2063 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return contains_2063__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const unique_2068__wm_d2 = (items_2069, seen_2070) => {
__wm_tail_108: while (true) {
{
const __wm_tail_value_126 = items_2069;
if (__wm_tail_value_126 === __wm_basis_Nil) {

return true;
} else if (__wm_tail_value_126?.ctor === -6 && __wm_tail_value_126.args.length === 1 && __wm_is_tuple(__wm_tail_value_126.args[0]) && __wm_tail_value_126.args[0].length === 2) {
const head_2071 = __wm_tail_value_126.args[0][0];
const rest_2072 = __wm_tail_value_126.args[0][1];
if (contains_2063__wm_d2(seen_2070, head_2071)) {
return false;
} else {
{
const __wm_tail_arg_127_0 = rest_2072;
const __wm_tail_arg_127_1 = __wm_basis_Cons([head_2071, seen_2070]);
items_2069 = __wm_tail_arg_127_0;
seen_2070 = __wm_tail_arg_127_1;
continue __wm_tail_108;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const unique_2068 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return unique_2068__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findExpression_2073__wm_d2 = (items_2074, id_2075) => {
__wm_tail_109: while (true) {
{
const __wm_scalar_135_0 = items_2074;
const __wm_scalar_135_1 = id_2075;
if (__wm_scalar_135_0 === __wm_basis_Nil) {
const id_2076 = __wm_scalar_135_1;
return __wm_fail("Panic", "missing schema-v2 expression");
} else if (__wm_scalar_135_0?.ctor === -6 && __wm_scalar_135_0.args.length === 1 && __wm_is_tuple(__wm_scalar_135_0.args[0]) && __wm_scalar_135_0.args[0].length === 2) {
const item_2077 = __wm_scalar_135_0.args[0][0];
const rest_2078 = __wm_scalar_135_0.args[0][1];
const id_2079 = __wm_scalar_135_1;
{
const exact_2080 = item_2077;
if (numberEqual_2062__wm_d2(exact_2080.id, id_2079)) {
return exact_2080;
} else {
{
const __wm_tail_arg_128_0 = rest_2078;
const __wm_tail_arg_128_1 = id_2079;
items_2074 = __wm_tail_arg_128_0;
id_2075 = __wm_tail_arg_128_1;
continue __wm_tail_109;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findExpression_2073 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findExpression_2073__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findBlock_2081__wm_d2 = (items_2082, expressionId_2083) => {
__wm_tail_110: while (true) {
{
const __wm_scalar_136_0 = items_2082;
const __wm_scalar_136_1 = expressionId_2083;
if (__wm_scalar_136_0 === __wm_basis_Nil) {
const expressionId_2084 = __wm_scalar_136_1;
return __wm_fail("Panic", "missing schema-v2 block");
} else if (__wm_scalar_136_0?.ctor === -6 && __wm_scalar_136_0.args.length === 1 && __wm_is_tuple(__wm_scalar_136_0.args[0]) && __wm_scalar_136_0.args[0].length === 2) {
const item_2085 = __wm_scalar_136_0.args[0][0];
const rest_2086 = __wm_scalar_136_0.args[0][1];
const expressionId_2087 = __wm_scalar_136_1;
{
const exact_2088 = item_2085;
if (numberEqual_2062__wm_d2(exact_2088.expressionId, expressionId_2087)) {
return exact_2088;
} else {
{
const __wm_tail_arg_129_0 = rest_2086;
const __wm_tail_arg_129_1 = expressionId_2087;
items_2082 = __wm_tail_arg_129_0;
expressionId_2083 = __wm_tail_arg_129_1;
continue __wm_tail_110;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findBlock_2081 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findBlock_2081__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findBlockItem_2089__wm_d2 = (items_2090, id_2091) => {
__wm_tail_111: while (true) {
{
const __wm_scalar_137_0 = items_2090;
const __wm_scalar_137_1 = id_2091;
if (__wm_scalar_137_0 === __wm_basis_Nil) {
const id_2092 = __wm_scalar_137_1;
return __wm_fail("Panic", "missing schema-v2 block item");
} else if (__wm_scalar_137_0?.ctor === -6 && __wm_scalar_137_0.args.length === 1 && __wm_is_tuple(__wm_scalar_137_0.args[0]) && __wm_scalar_137_0.args[0].length === 2) {
const item_2093 = __wm_scalar_137_0.args[0][0];
const rest_2094 = __wm_scalar_137_0.args[0][1];
const id_2095 = __wm_scalar_137_1;
{
const exact_2096 = item_2093;
if (numberEqual_2062__wm_d2(exact_2096.id, id_2095)) {
return exact_2096;
} else {
{
const __wm_tail_arg_130_0 = rest_2094;
const __wm_tail_arg_130_1 = id_2095;
items_2090 = __wm_tail_arg_130_0;
id_2091 = __wm_tail_arg_130_1;
continue __wm_tail_111;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findBlockItem_2089 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findBlockItem_2089__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLet_2097__wm_d2 = (items_2098, id_2099) => {
__wm_tail_112: while (true) {
{
const __wm_scalar_138_0 = items_2098;
const __wm_scalar_138_1 = id_2099;
if (__wm_scalar_138_0 === __wm_basis_Nil) {
const id_2100 = __wm_scalar_138_1;
return __wm_fail("Panic", "missing schema-v2 let");
} else if (__wm_scalar_138_0?.ctor === -6 && __wm_scalar_138_0.args.length === 1 && __wm_is_tuple(__wm_scalar_138_0.args[0]) && __wm_scalar_138_0.args[0].length === 2) {
const item_2101 = __wm_scalar_138_0.args[0][0];
const rest_2102 = __wm_scalar_138_0.args[0][1];
const id_2103 = __wm_scalar_138_1;
{
const exact_2104 = item_2101;
if (numberEqual_2062__wm_d2(exact_2104.id, id_2103)) {
return exact_2104;
} else {
{
const __wm_tail_arg_131_0 = rest_2102;
const __wm_tail_arg_131_1 = id_2103;
items_2098 = __wm_tail_arg_131_0;
id_2099 = __wm_tail_arg_131_1;
continue __wm_tail_112;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLet_2097 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLet_2097__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findMatch_2105__wm_d2 = (items_2106, expressionId_2107) => {
__wm_tail_113: while (true) {
{
const __wm_scalar_139_0 = items_2106;
const __wm_scalar_139_1 = expressionId_2107;
if (__wm_scalar_139_0 === __wm_basis_Nil) {
const expressionId_2108 = __wm_scalar_139_1;
return __wm_fail("Panic", "missing schema-v2 match");
} else if (__wm_scalar_139_0?.ctor === -6 && __wm_scalar_139_0.args.length === 1 && __wm_is_tuple(__wm_scalar_139_0.args[0]) && __wm_scalar_139_0.args[0].length === 2) {
const item_2109 = __wm_scalar_139_0.args[0][0];
const rest_2110 = __wm_scalar_139_0.args[0][1];
const expressionId_2111 = __wm_scalar_139_1;
{
const exact_2112 = item_2109;
if (numberEqual_2062__wm_d2(exact_2112.expressionId, expressionId_2111)) {
return exact_2112;
} else {
{
const __wm_tail_arg_132_0 = rest_2110;
const __wm_tail_arg_132_1 = expressionId_2111;
items_2106 = __wm_tail_arg_132_0;
expressionId_2107 = __wm_tail_arg_132_1;
continue __wm_tail_113;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findMatch_2105 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findMatch_2105__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findMatchArm_2113__wm_d2 = (items_2114, id_2115) => {
__wm_tail_114: while (true) {
{
const __wm_scalar_140_0 = items_2114;
const __wm_scalar_140_1 = id_2115;
if (__wm_scalar_140_0 === __wm_basis_Nil) {
const id_2116 = __wm_scalar_140_1;
return __wm_fail("Panic", "missing schema-v2 match arm");
} else if (__wm_scalar_140_0?.ctor === -6 && __wm_scalar_140_0.args.length === 1 && __wm_is_tuple(__wm_scalar_140_0.args[0]) && __wm_scalar_140_0.args[0].length === 2) {
const item_2117 = __wm_scalar_140_0.args[0][0];
const rest_2118 = __wm_scalar_140_0.args[0][1];
const id_2119 = __wm_scalar_140_1;
{
const exact_2120 = item_2117;
if (numberEqual_2062__wm_d2(exact_2120.id, id_2119)) {
return exact_2120;
} else {
{
const __wm_tail_arg_133_0 = rest_2118;
const __wm_tail_arg_133_1 = id_2119;
items_2114 = __wm_tail_arg_133_0;
id_2115 = __wm_tail_arg_133_1;
continue __wm_tail_114;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findMatchArm_2113 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findMatchArm_2113__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findPattern_2121__wm_d2 = (items_2122, id_2123) => {
__wm_tail_115: while (true) {
{
const __wm_scalar_141_0 = items_2122;
const __wm_scalar_141_1 = id_2123;
if (__wm_scalar_141_0 === __wm_basis_Nil) {
const id_2124 = __wm_scalar_141_1;
return __wm_fail("Panic", "missing schema-v2 pattern");
} else if (__wm_scalar_141_0?.ctor === -6 && __wm_scalar_141_0.args.length === 1 && __wm_is_tuple(__wm_scalar_141_0.args[0]) && __wm_scalar_141_0.args[0].length === 2) {
const item_2125 = __wm_scalar_141_0.args[0][0];
const rest_2126 = __wm_scalar_141_0.args[0][1];
const id_2127 = __wm_scalar_141_1;
{
const exact_2128 = item_2125;
if (numberEqual_2062__wm_d2(exact_2128.id, id_2127)) {
return exact_2128;
} else {
{
const __wm_tail_arg_134_0 = rest_2126;
const __wm_tail_arg_134_1 = id_2127;
items_2122 = __wm_tail_arg_134_0;
id_2123 = __wm_tail_arg_134_1;
continue __wm_tail_115;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findPattern_2121 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findPattern_2121__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findType_2129__wm_d2 = (items_2130, id_2131) => {
__wm_tail_116: while (true) {
{
const __wm_scalar_142_0 = items_2130;
const __wm_scalar_142_1 = id_2131;
if (__wm_scalar_142_0 === __wm_basis_Nil) {
const id_2132 = __wm_scalar_142_1;
return __wm_fail("Panic", "missing schema-v2 type");
} else if (__wm_scalar_142_0?.ctor === -6 && __wm_scalar_142_0.args.length === 1 && __wm_is_tuple(__wm_scalar_142_0.args[0]) && __wm_scalar_142_0.args[0].length === 2) {
const item_2133 = __wm_scalar_142_0.args[0][0];
const rest_2134 = __wm_scalar_142_0.args[0][1];
const id_2135 = __wm_scalar_142_1;
{
const exact_2136 = item_2133;
if (numberEqual_2062__wm_d2(exact_2136.id, id_2135)) {
return exact_2136;
} else {
{
const __wm_tail_arg_135_0 = rest_2134;
const __wm_tail_arg_135_1 = id_2135;
items_2130 = __wm_tail_arg_135_0;
id_2131 = __wm_tail_arg_135_1;
continue __wm_tail_116;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findType_2129 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findType_2129__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findExpressionOccurrence_2137__wm_d2 = (items_2138, sourceId_2139) => {
__wm_tail_117: while (true) {
{
const __wm_scalar_143_0 = items_2138;
const __wm_scalar_143_1 = sourceId_2139;
if (__wm_scalar_143_0 === __wm_basis_Nil) {
const sourceId_2140 = __wm_scalar_143_1;
return __wm_fail("Panic", "missing schema-v2 expression type occurrence");
} else if (__wm_scalar_143_0?.ctor === -6 && __wm_scalar_143_0.args.length === 1 && __wm_is_tuple(__wm_scalar_143_0.args[0]) && __wm_scalar_143_0.args[0].length === 2) {
const item_2141 = __wm_scalar_143_0.args[0][0];
const rest_2142 = __wm_scalar_143_0.args[0][1];
const sourceId_2143 = __wm_scalar_143_1;
{
const exact_2144 = item_2141;
if (__wm_op_and_d2(__wm_eq(exact_2144.kind, "expression"), numberEqual_2062__wm_d2(exact_2144.sourceId, sourceId_2143))) {
return exact_2144;
} else {
{
const __wm_tail_arg_136_0 = rest_2142;
const __wm_tail_arg_136_1 = sourceId_2143;
items_2138 = __wm_tail_arg_136_0;
sourceId_2139 = __wm_tail_arg_136_1;
continue __wm_tail_117;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findExpressionOccurrence_2137 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findExpressionOccurrence_2137__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const shaderBuiltinTypeName_2155__wm_d2 = (source_2145, context_2146) => {
const occurrence_2147 = findExpressionOccurrence_2137__wm_d2(context_2146.occurrences, source_2145.id);
const typeId_2148 = occurrence_2147.shaderTypeId;
const gpuType_2149 = findType_2129__wm_d2(context_2146.types, typeId_2148);
if (__wm_eq(gpuType_2149.kind, "f32")) {
return "f32";
} else {
if (__wm_eq(gpuType_2149.kind, "i32")) {
return "i32";
} else {
if (__wm_eq(gpuType_2149.kind, "vector")) {
const items_2150 = Js.Array.toList(gpuType_2149.items);
const component_2153 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2) {
const first_2151 = __v.args[0][0];
const __2152 = __v.args[0][1];
return findType_2129__wm_d2(context_2146.types, first_2151);
} else if (__v === __wm_basis_Nil) {

return __wm_fail("Panic", "GPU builtin vector type is empty");
}
__wm_fail("Match", "non-exhaustive match");
})(items_2150);
const prefix_2154 = (__wm_eq(component_2153.kind, "i32") ? "i32x" : "f32x");
return (prefix_2154 + Text.of(listLength_2053__wm_d2(items_2150, 0)));
} else {
return "";
}
}
}
};
const shaderBuiltinTypeName_2155 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return shaderBuiltinTypeName_2155__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const builtinParamsMatch_2156__wm_d3 = (expected_2157, sourceIds_2158, context_2159) => {
const __wm_scalar_144_0 = expected_2157;
const __wm_scalar_144_1 = sourceIds_2158;
const __wm_scalar_144_2 = context_2159;
if (__wm_scalar_144_0 === __wm_basis_Nil && __wm_scalar_144_1 === __wm_basis_Nil) {
const context_2160 = __wm_scalar_144_2;
return true;
} else if (__wm_scalar_144_0?.ctor === -6 && __wm_scalar_144_0.args.length === 1 && __wm_is_tuple(__wm_scalar_144_0.args[0]) && __wm_scalar_144_0.args[0].length === 2 && __wm_scalar_144_1?.ctor === -6 && __wm_scalar_144_1.args.length === 1 && __wm_is_tuple(__wm_scalar_144_1.args[0]) && __wm_scalar_144_1.args[0].length === 2) {
const expectedType_2161 = __wm_scalar_144_0.args[0][0];
const expectedRest_2162 = __wm_scalar_144_0.args[0][1];
const sourceId_2163 = __wm_scalar_144_1.args[0][0];
const sourceRest_2164 = __wm_scalar_144_1.args[0][1];
const context_2165 = __wm_scalar_144_2;
const exactContext_2166 = context_2165;
const source_2167 = findExpression_2073__wm_d2(exactContext_2166.expressions, sourceId_2163);
return __wm_op_and_d2(__wm_eq(expectedType_2161, shaderBuiltinTypeName_2155__wm_d2(source_2167, exactContext_2166)), builtinParamsMatch_2156__wm_d3(expectedRest_2162, sourceRest_2164, exactContext_2166));
} else if (true) {
const context_2168 = __wm_scalar_144_2;
return false;
}
__wm_fail("Match", "non-exhaustive match");
};
const builtinParamsMatch_2156 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return builtinParamsMatch_2156__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const selectBuiltinOverload_2169__wm_d3 = (overloads_2170, source_2171, context_2172) => {
__wm_tail_118: while (true) {
{
const __wm_scalar_145_0 = overloads_2170;
const __wm_scalar_145_1 = source_2171;
const __wm_scalar_145_2 = context_2172;
if (__wm_scalar_145_0 === __wm_basis_Nil) {
const source_2173 = __wm_scalar_145_1;
const context_2174 = __wm_scalar_145_2;
return __wm_fail("Panic", "no exact pinned Slang builtin overload survived Workman GPU elaboration");
} else if (__wm_scalar_145_0?.ctor === -6 && __wm_scalar_145_0.args.length === 1 && __wm_is_tuple(__wm_scalar_145_0.args[0]) && __wm_scalar_145_0.args[0].length === 2) {
const overload_2175 = __wm_scalar_145_0.args[0][0];
const rest_2176 = __wm_scalar_145_0.args[0][1];
const source_2177 = __wm_scalar_145_1;
const context_2178 = __wm_scalar_145_2;
{
const exactOverload_2179 = overload_2175;
const exactSource_2180 = source_2177;
const exactContext_2181 = context_2178;
if (__wm_op_and_d2(__wm_op_and_d2(__wm_eq(exactOverload_2179.name, exactSource_2180.builtinName), __wm_eq(exactOverload_2179.result, shaderBuiltinTypeName_2155__wm_d2(exactSource_2180, exactContext_2181))), builtinParamsMatch_2156__wm_d3(Js.Array.toList(exactOverload_2179.params), Js.Array.toList(exactSource_2180.children), exactContext_2181))) {
return exactOverload_2179.id;
} else {
{
const __wm_tail_arg_137_0 = rest_2176;
const __wm_tail_arg_137_1 = exactSource_2180;
const __wm_tail_arg_137_2 = exactContext_2181;
overloads_2170 = __wm_tail_arg_137_0;
source_2171 = __wm_tail_arg_137_1;
context_2172 = __wm_tail_arg_137_2;
continue __wm_tail_118;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const selectBuiltinOverload_2169 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return selectBuiltinOverload_2169__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const collectBuiltinSelections_2182__wm_d3 = (expressions_2183, context_2184, selections_2185) => {
__wm_tail_119: while (true) {
{
const __wm_scalar_146_0 = expressions_2183;
const __wm_scalar_146_1 = context_2184;
const __wm_scalar_146_2 = selections_2185;
if (__wm_scalar_146_0 === __wm_basis_Nil) {
const context_2186 = __wm_scalar_146_1;
const selections_2187 = __wm_scalar_146_2;
return reverseInto_2039__wm_d2(selections_2187, __wm_basis_Nil);
} else if (__wm_scalar_146_0?.ctor === -6 && __wm_scalar_146_0.args.length === 1 && __wm_is_tuple(__wm_scalar_146_0.args[0]) && __wm_scalar_146_0.args[0].length === 2) {
const expression_2188 = __wm_scalar_146_0.args[0][0];
const rest_2189 = __wm_scalar_146_0.args[0][1];
const context_2190 = __wm_scalar_146_1;
const selections_2191 = __wm_scalar_146_2;
{
const exactExpression_2192 = expression_2188;
const exactContext_2193 = context_2190;
if (__wm_eq(exactExpression_2192.kind, "builtin")) {
{
const selection_2194 = { expressionId: exactExpression_2192.id, overloadId: selectBuiltinOverload_2169__wm_d3(exactContext_2193.builtinOverloads, exactExpression_2192, exactContext_2193) };
{
const __wm_tail_arg_138_0 = rest_2189;
const __wm_tail_arg_138_1 = exactContext_2193;
const __wm_tail_arg_138_2 = __wm_basis_Cons([selection_2194, selections_2191]);
expressions_2183 = __wm_tail_arg_138_0;
context_2184 = __wm_tail_arg_138_1;
selections_2185 = __wm_tail_arg_138_2;
continue __wm_tail_119;
}
}
} else {
{
const __wm_tail_arg_139_0 = rest_2189;
const __wm_tail_arg_139_1 = exactContext_2193;
const __wm_tail_arg_139_2 = selections_2191;
expressions_2183 = __wm_tail_arg_139_0;
context_2184 = __wm_tail_arg_139_1;
selections_2185 = __wm_tail_arg_139_2;
continue __wm_tail_119;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const collectBuiltinSelections_2182 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return collectBuiltinSelections_2182__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const allSemanticNumbers_2195__wm_d2 = (typeIds_2196, types_2197) => {
const __wm_scalar_147_0 = typeIds_2196;
const __wm_scalar_147_1 = types_2197;
if (__wm_scalar_147_0 === __wm_basis_Nil) {
const types_2198 = __wm_scalar_147_1;
return true;
} else if (__wm_scalar_147_0?.ctor === -6 && __wm_scalar_147_0.args.length === 1 && __wm_is_tuple(__wm_scalar_147_0.args[0]) && __wm_scalar_147_0.args[0].length === 2) {
const typeId_2199 = __wm_scalar_147_0.args[0][0];
const rest_2200 = __wm_scalar_147_0.args[0][1];
const types_2201 = __wm_scalar_147_1;
const gpuType_2202 = findType_2129__wm_d2(types_2201, typeId_2199);
return __wm_op_and_d2(__wm_eq(gpuType_2202.kind, "number"), allSemanticNumbers_2195__wm_d2(rest_2200, types_2201));
}
__wm_fail("Match", "non-exhaustive match");
};
const allSemanticNumbers_2195 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return allSemanticNumbers_2195__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const shaderTypeKind_2207__wm_d2 = (source_2203, types_2204) => {
if (__wm_eq(source_2203.kind, "number")) {
return "f32";
} else {
if (__wm_eq(source_2203.kind, "tuple")) {
const items_2205 = Js.Array.toList(source_2203.items);
const width_2206 = listLength_2053__wm_d2(items_2205, 0);
if (__wm_op_and_d2(__wm_op_and_d2((width_2206 >= 2), (width_2206 <= 4)), allSemanticNumbers_2195__wm_d2(items_2205, types_2204))) {
return "vector";
} else {
return "tuple";
}
} else {
return source_2203.kind;
}
}
};
const shaderTypeKind_2207 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return shaderTypeKind_2207__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const shaderTypeReason_2210__wm_d2 = (semanticKind_2208, shaderKind_2209) => {
if (__wm_eq(semanticKind_2208, "number")) {
return "shader-number-f32";
} else {
if (__wm_eq(semanticKind_2208, "tuple")) {
if (__wm_eq(shaderKind_2209, "vector")) {
return "homogeneous-numeric-tuple-default";
} else {
return "semantic-product";
}
} else {
return "semantic-shape";
}
}
};
const shaderTypeReason_2210 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return shaderTypeReason_2210__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const offsetTypeIds_2211__wm_d3 = (typeIds_2212, offset_2213, output_2214) => {
__wm_tail_120: while (true) {
{
const __wm_scalar_148_0 = typeIds_2212;
const __wm_scalar_148_1 = offset_2213;
const __wm_scalar_148_2 = output_2214;
if (__wm_scalar_148_0 === __wm_basis_Nil) {
const offset_2215 = __wm_scalar_148_1;
const output_2216 = __wm_scalar_148_2;
return reverseInto_2039__wm_d2(output_2216, __wm_basis_Nil);
} else if (__wm_scalar_148_0?.ctor === -6 && __wm_scalar_148_0.args.length === 1 && __wm_is_tuple(__wm_scalar_148_0.args[0]) && __wm_scalar_148_0.args[0].length === 2) {
const typeId_2217 = __wm_scalar_148_0.args[0][0];
const rest_2218 = __wm_scalar_148_0.args[0][1];
const offset_2219 = __wm_scalar_148_1;
const output_2220 = __wm_scalar_148_2;
{
const __wm_tail_arg_140_0 = rest_2218;
const __wm_tail_arg_140_1 = offset_2219;
const __wm_tail_arg_140_2 = __wm_basis_Cons([(offset_2219 + typeId_2217), output_2220]);
typeIds_2212 = __wm_tail_arg_140_0;
offset_2213 = __wm_tail_arg_140_1;
output_2214 = __wm_tail_arg_140_2;
continue __wm_tail_120;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const offsetTypeIds_2211 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return offsetTypeIds_2211__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const addI32ShaderTypes_2221__wm_d4 = (sourceTypes_2222, allTypes_2223, offset_2224, output_2225) => {
__wm_tail_121: while (true) {
{
const __wm_scalar_149_0 = sourceTypes_2222;
const __wm_scalar_149_1 = allTypes_2223;
const __wm_scalar_149_2 = offset_2224;
const __wm_scalar_149_3 = output_2225;
if (__wm_scalar_149_0 === __wm_basis_Nil) {
const allTypes_2226 = __wm_scalar_149_1;
const offset_2227 = __wm_scalar_149_2;
const output_2228 = __wm_scalar_149_3;
return reverseInto_2039__wm_d2(output_2228, __wm_basis_Nil);
} else if (__wm_scalar_149_0?.ctor === -6 && __wm_scalar_149_0.args.length === 1 && __wm_is_tuple(__wm_scalar_149_0.args[0]) && __wm_scalar_149_0.args[0].length === 2) {
const source_2229 = __wm_scalar_149_0.args[0][0];
const rest_2230 = __wm_scalar_149_0.args[0][1];
const allTypes_2231 = __wm_scalar_149_1;
const offset_2232 = __wm_scalar_149_2;
const output_2233 = __wm_scalar_149_3;
{
const items_2234 = Js.Array.toList(source_2229.items);
const width_2235 = listLength_2053__wm_d2(items_2234, 0);
const numericVector_2236 = __wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(__wm_eq(source_2229.kind, "tuple"), (width_2235 >= 2)), (width_2235 <= 4)), allSemanticNumbers_2195__wm_d2(items_2234, allTypes_2231));
if (__wm_op_or_d2(__wm_eq(source_2229.kind, "number"), numericVector_2236)) {
{
const clone_2237 = { ...source_2229, id: (offset_2232 + source_2229.id), kind: (__wm_eq(source_2229.kind, "number") ? "i32" : "vector"), items: (numericVector_2236 ? Js.Array.fromList(offsetTypeIds_2211__wm_d3(items_2234, offset_2232, __wm_basis_Nil)) : source_2229.items) };
{
const __wm_tail_arg_141_0 = rest_2230;
const __wm_tail_arg_141_1 = allTypes_2231;
const __wm_tail_arg_141_2 = offset_2232;
const __wm_tail_arg_141_3 = __wm_basis_Cons([clone_2237, output_2233]);
sourceTypes_2222 = __wm_tail_arg_141_0;
allTypes_2223 = __wm_tail_arg_141_1;
offset_2224 = __wm_tail_arg_141_2;
output_2225 = __wm_tail_arg_141_3;
continue __wm_tail_121;
}
}
} else {
{
const __wm_tail_arg_142_0 = rest_2230;
const __wm_tail_arg_142_1 = allTypes_2231;
const __wm_tail_arg_142_2 = offset_2232;
const __wm_tail_arg_142_3 = output_2233;
sourceTypes_2222 = __wm_tail_arg_142_0;
allTypes_2223 = __wm_tail_arg_142_1;
offset_2224 = __wm_tail_arg_142_2;
output_2225 = __wm_tail_arg_142_3;
continue __wm_tail_121;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addI32ShaderTypes_2221 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return addI32ShaderTypes_2221__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const concreteShaderTypeId_2245__wm_d4 = (semanticTypeId_2238, representation_2239, offset_2240, types_2241) => {
if (__wm_eq(representation_2239, "i32")) {
const source_2242 = findType_2129__wm_d2(types_2241, semanticTypeId_2238);
const items_2243 = Js.Array.toList(source_2242.items);
const width_2244 = listLength_2053__wm_d2(items_2243, 0);
if (__wm_op_or_d2(__wm_eq(source_2242.kind, "number"), __wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(__wm_eq(source_2242.kind, "tuple"), (width_2244 >= 2)), (width_2244 <= 4)), allSemanticNumbers_2195__wm_d2(items_2243, types_2241)))) {
return (offset_2240 + semanticTypeId_2238);
} else {
return semanticTypeId_2238;
}
} else {
return semanticTypeId_2238;
}
};
const concreteShaderTypeId_2245 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return concreteShaderTypeId_2245__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const elaborateSliceTypes_2246__wm_d4 = (sourceTypes_2247, allTypes_2248, shaderTypes_2249, evidence_2250) => {
__wm_tail_122: while (true) {
{
const __wm_scalar_150_0 = sourceTypes_2247;
const __wm_scalar_150_1 = allTypes_2248;
const __wm_scalar_150_2 = shaderTypes_2249;
const __wm_scalar_150_3 = evidence_2250;
if (__wm_scalar_150_0 === __wm_basis_Nil) {
const allTypes_2251 = __wm_scalar_150_1;
const shaderTypes_2252 = __wm_scalar_150_2;
const evidence_2253 = __wm_scalar_150_3;
return [reverseInto_2039__wm_d2(shaderTypes_2252, __wm_basis_Nil), reverseInto_2039__wm_d2(evidence_2253, __wm_basis_Nil)];
} else if (__wm_scalar_150_0?.ctor === -6 && __wm_scalar_150_0.args.length === 1 && __wm_is_tuple(__wm_scalar_150_0.args[0]) && __wm_scalar_150_0.args[0].length === 2) {
const source_2254 = __wm_scalar_150_0.args[0][0];
const rest_2255 = __wm_scalar_150_0.args[0][1];
const allTypes_2256 = __wm_scalar_150_1;
const shaderTypes_2257 = __wm_scalar_150_2;
const evidence_2258 = __wm_scalar_150_3;
{
const exactSource_2259 = source_2254;
const shaderKind_2260 = shaderTypeKind_2207__wm_d2(exactSource_2259, allTypes_2256);
const shaderType_2261 = { ...exactSource_2259, kind: shaderKind_2260 };
const typeEvidence_2262 = { typeId: exactSource_2259.id, semanticKind: exactSource_2259.kind, shaderKind: shaderKind_2260, reason: shaderTypeReason_2210__wm_d2(exactSource_2259.kind, shaderKind_2260) };
{
const __wm_tail_arg_143_0 = rest_2255;
const __wm_tail_arg_143_1 = allTypes_2256;
const __wm_tail_arg_143_2 = __wm_basis_Cons([shaderType_2261, shaderTypes_2257]);
const __wm_tail_arg_143_3 = __wm_basis_Cons([typeEvidence_2262, evidence_2258]);
sourceTypes_2247 = __wm_tail_arg_143_0;
allTypes_2248 = __wm_tail_arg_143_1;
shaderTypes_2249 = __wm_tail_arg_143_2;
evidence_2250 = __wm_tail_arg_143_3;
continue __wm_tail_122;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const elaborateSliceTypes_2246 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return elaborateSliceTypes_2246__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const addExpressionOccurrences_2263__wm_d5 = (expressions_2264, representations_2265, typeOffset_2266, types_2267, occurrences_2268) => {
__wm_tail_123: while (true) {
{
const __wm_scalar_151_0 = expressions_2264;
const __wm_scalar_151_1 = representations_2265;
const __wm_scalar_151_2 = typeOffset_2266;
const __wm_scalar_151_3 = types_2267;
const __wm_scalar_151_4 = occurrences_2268;
if (__wm_scalar_151_0 === __wm_basis_Nil) {
const representations_2269 = __wm_scalar_151_1;
const typeOffset_2270 = __wm_scalar_151_2;
const types_2271 = __wm_scalar_151_3;
const occurrences_2272 = __wm_scalar_151_4;
return occurrences_2272;
} else if (__wm_scalar_151_0?.ctor === -6 && __wm_scalar_151_0.args.length === 1 && __wm_is_tuple(__wm_scalar_151_0.args[0]) && __wm_scalar_151_0.args[0].length === 2) {
const expression_2273 = __wm_scalar_151_0.args[0][0];
const rest_2274 = __wm_scalar_151_0.args[0][1];
const representations_2275 = __wm_scalar_151_1;
const typeOffset_2276 = __wm_scalar_151_2;
const types_2277 = __wm_scalar_151_3;
const occurrences_2278 = __wm_scalar_151_4;
{
const exactExpression_2279 = expression_2273;
const concreteRepresentation_2280 = expressionRepresentation_2031__wm_d2(representations_2275, exactExpression_2279.id);
const occurrence_2281 = { kind: "expression", sourceId: exactExpression_2279.id, typeId: exactExpression_2279.typeId, shaderTypeId: concreteShaderTypeId_2245__wm_d4(exactExpression_2279.typeId, concreteRepresentation_2280, typeOffset_2276, types_2277), spanId: exactExpression_2279.spanId, representationEvidence: exactExpression_2279.numberKind, representation: concreteRepresentation_2280 };
{
const __wm_tail_arg_144_0 = rest_2274;
const __wm_tail_arg_144_1 = representations_2275;
const __wm_tail_arg_144_2 = typeOffset_2276;
const __wm_tail_arg_144_3 = types_2277;
const __wm_tail_arg_144_4 = __wm_basis_Cons([occurrence_2281, occurrences_2278]);
expressions_2264 = __wm_tail_arg_144_0;
representations_2265 = __wm_tail_arg_144_1;
typeOffset_2266 = __wm_tail_arg_144_2;
types_2267 = __wm_tail_arg_144_3;
occurrences_2268 = __wm_tail_arg_144_4;
continue __wm_tail_123;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addExpressionOccurrences_2263 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return addExpressionOccurrences_2263__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const addPatternOccurrences_2282__wm_d6 = (patterns_2283, expressionCount_2284, representations_2285, typeOffset_2286, types_2287, occurrences_2288) => {
__wm_tail_124: while (true) {
{
const __wm_scalar_152_0 = patterns_2283;
const __wm_scalar_152_1 = expressionCount_2284;
const __wm_scalar_152_2 = representations_2285;
const __wm_scalar_152_3 = typeOffset_2286;
const __wm_scalar_152_4 = types_2287;
const __wm_scalar_152_5 = occurrences_2288;
if (__wm_scalar_152_0 === __wm_basis_Nil) {
const expressionCount_2289 = __wm_scalar_152_1;
const representations_2290 = __wm_scalar_152_2;
const typeOffset_2291 = __wm_scalar_152_3;
const types_2292 = __wm_scalar_152_4;
const occurrences_2293 = __wm_scalar_152_5;
return occurrences_2293;
} else if (__wm_scalar_152_0?.ctor === -6 && __wm_scalar_152_0.args.length === 1 && __wm_is_tuple(__wm_scalar_152_0.args[0]) && __wm_scalar_152_0.args[0].length === 2) {
const pattern_2294 = __wm_scalar_152_0.args[0][0];
const rest_2295 = __wm_scalar_152_0.args[0][1];
const expressionCount_2296 = __wm_scalar_152_1;
const representations_2297 = __wm_scalar_152_2;
const typeOffset_2298 = __wm_scalar_152_3;
const types_2299 = __wm_scalar_152_4;
const occurrences_2300 = __wm_scalar_152_5;
{
const exactPattern_2301 = pattern_2294;
const concreteRepresentation_2302 = patternRepresentation_2035__wm_d3(representations_2297, expressionCount_2296, exactPattern_2301.id);
const occurrence_2303 = { kind: "pattern", sourceId: exactPattern_2301.id, typeId: exactPattern_2301.typeId, shaderTypeId: concreteShaderTypeId_2245__wm_d4(exactPattern_2301.typeId, concreteRepresentation_2302, typeOffset_2298, types_2299), spanId: exactPattern_2301.spanId, representationEvidence: "", representation: concreteRepresentation_2302 };
{
const __wm_tail_arg_145_0 = rest_2295;
const __wm_tail_arg_145_1 = expressionCount_2296;
const __wm_tail_arg_145_2 = representations_2297;
const __wm_tail_arg_145_3 = typeOffset_2298;
const __wm_tail_arg_145_4 = types_2299;
const __wm_tail_arg_145_5 = __wm_basis_Cons([occurrence_2303, occurrences_2300]);
patterns_2283 = __wm_tail_arg_145_0;
expressionCount_2284 = __wm_tail_arg_145_1;
representations_2285 = __wm_tail_arg_145_2;
typeOffset_2286 = __wm_tail_arg_145_3;
types_2287 = __wm_tail_arg_145_4;
occurrences_2288 = __wm_tail_arg_145_5;
continue __wm_tail_124;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addPatternOccurrences_2282 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return addPatternOccurrences_2282__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const addFunctionOccurrences_2304__wm_d2 = (functions_2305, occurrences_2306) => {
__wm_tail_125: while (true) {
{
const __wm_scalar_153_0 = functions_2305;
const __wm_scalar_153_1 = occurrences_2306;
if (__wm_scalar_153_0 === __wm_basis_Nil) {
const occurrences_2307 = __wm_scalar_153_1;
return occurrences_2307;
} else if (__wm_scalar_153_0?.ctor === -6 && __wm_scalar_153_0.args.length === 1 && __wm_is_tuple(__wm_scalar_153_0.args[0]) && __wm_scalar_153_0.args[0].length === 2) {
const fn_2308 = __wm_scalar_153_0.args[0][0];
const rest_2309 = __wm_scalar_153_0.args[0][1];
const occurrences_2310 = __wm_scalar_153_1;
{
const exactFunction_2311 = fn_2308;
const occurrence_2312 = { kind: "function", sourceId: exactFunction_2311.id, typeId: exactFunction_2311.typeId, shaderTypeId: exactFunction_2311.typeId, spanId: exactFunction_2311.spanId, representationEvidence: "", representation: "" };
{
const __wm_tail_arg_146_0 = rest_2309;
const __wm_tail_arg_146_1 = __wm_basis_Cons([occurrence_2312, occurrences_2310]);
functions_2305 = __wm_tail_arg_146_0;
occurrences_2306 = __wm_tail_arg_146_1;
continue __wm_tail_125;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addFunctionOccurrences_2304 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addFunctionOccurrences_2304__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const elaborateSliceProgramTypes_2327 = (__arg) => {
if (true) {
const input_2313 = __arg;
const semanticTypes_2314 = Js.Array.toList(input_2313.types);
const __wm_bind_78 = elaborateSliceTypes_2246__wm_d4(semanticTypes_2314, semanticTypes_2314, __wm_basis_Nil, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_78) && __wm_bind_78.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const shaderTypeItems_2315 = __wm_bind_78[0];
const typeEvidenceItems_2316 = __wm_bind_78[1];
const typeOffset_2317 = listLength_2053__wm_d2(semanticTypes_2314, 0);
const allShaderTypeItems_2318 = append_2046__wm_d2(shaderTypeItems_2315, addI32ShaderTypes_2221__wm_d4(semanticTypes_2314, semanticTypes_2314, typeOffset_2317, __wm_basis_Nil));
const expressionItems_2319 = Js.Array.toList(input_2313.expressions);
const numericRepresentations_2320 = solveSliceNumericRepresentations_2028(input_2313);
const withExpressions_2321 = addExpressionOccurrences_2263__wm_d5(expressionItems_2319, numericRepresentations_2320, typeOffset_2317, semanticTypes_2314, __wm_basis_Nil);
const withPatterns_2322 = addPatternOccurrences_2282__wm_d6(Js.Array.toList(input_2313.patterns), listLength_2053__wm_d2(expressionItems_2319, 0), numericRepresentations_2320, typeOffset_2317, semanticTypes_2314, withExpressions_2321);
const occurrenceItems_2323 = reverseInto_2039__wm_d2(addFunctionOccurrences_2304__wm_d2(Js.Array.toList(input_2313.functions), withPatterns_2322), __wm_basis_Nil);
const builtinCatalog_2324 = input_2313.builtinCatalog;
const typeContext_2325 = { expressions: Js.Array.toList(input_2313.expressions), blocks: Js.Array.toList(input_2313.blocks), blockItems: Js.Array.toList(input_2313.blockItems), lets: Js.Array.toList(input_2313.lets), matches: Js.Array.toList(input_2313.matches), matchArms: Js.Array.toList(input_2313.matchArms), patterns: Js.Array.toList(input_2313.patterns), types: allShaderTypeItems_2318, adts: Js.Array.toList(input_2313.adts), functions: Js.Array.toList(input_2313.functions), builtinOverloads: Js.Array.toList(builtinCatalog_2324.overloads), occurrences: occurrenceItems_2323 };
const output_2326 = { schemaVersion: 5, shaderTypes: Js.Array.fromList(allShaderTypeItems_2318), typeEvidence: Js.Array.fromList(typeEvidenceItems_2316), occurrences: Js.Array.fromList(occurrenceItems_2323), builtinSelections: Js.Array.fromList(collectBuiltinSelections_2182__wm_d3(Js.Array.toList(input_2313.expressions), typeContext_2325, __wm_basis_Nil)) };
return output_2326;
}
__wm_fail("Match", "pattern match failure in function");
};
const findAdt_2328__wm_d2 = (items_2329, typeNameId_2330) => {
__wm_tail_126: while (true) {
{
const __wm_scalar_154_0 = items_2329;
const __wm_scalar_154_1 = typeNameId_2330;
if (__wm_scalar_154_0 === __wm_basis_Nil) {
const typeNameId_2331 = __wm_scalar_154_1;
return __wm_fail("Panic", "missing schema-v2 ADT");
} else if (__wm_scalar_154_0?.ctor === -6 && __wm_scalar_154_0.args.length === 1 && __wm_is_tuple(__wm_scalar_154_0.args[0]) && __wm_scalar_154_0.args[0].length === 2) {
const item_2332 = __wm_scalar_154_0.args[0][0];
const rest_2333 = __wm_scalar_154_0.args[0][1];
const typeNameId_2334 = __wm_scalar_154_1;
{
const exact_2335 = item_2332;
if (numberEqual_2062__wm_d2(exact_2335.typeNameId, typeNameId_2334)) {
return exact_2335;
} else {
{
const __wm_tail_arg_147_0 = rest_2333;
const __wm_tail_arg_147_1 = typeNameId_2334;
items_2329 = __wm_tail_arg_147_0;
typeNameId_2330 = __wm_tail_arg_147_1;
continue __wm_tail_126;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findAdt_2328 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findAdt_2328__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findFunction_2336__wm_d2 = (items_2337, id_2338) => {
__wm_tail_127: while (true) {
{
const __wm_scalar_155_0 = items_2337;
const __wm_scalar_155_1 = id_2338;
if (__wm_scalar_155_0 === __wm_basis_Nil) {
const id_2339 = __wm_scalar_155_1;
return __wm_fail("Panic", "missing schema-v2 function");
} else if (__wm_scalar_155_0?.ctor === -6 && __wm_scalar_155_0.args.length === 1 && __wm_is_tuple(__wm_scalar_155_0.args[0]) && __wm_scalar_155_0.args[0].length === 2) {
const item_2340 = __wm_scalar_155_0.args[0][0];
const rest_2341 = __wm_scalar_155_0.args[0][1];
const id_2342 = __wm_scalar_155_1;
{
const exact_2343 = item_2340;
if (numberEqual_2062__wm_d2(exact_2343.id, id_2342)) {
return exact_2343;
} else {
{
const __wm_tail_arg_148_0 = rest_2341;
const __wm_tail_arg_148_1 = id_2342;
items_2337 = __wm_tail_arg_148_0;
id_2338 = __wm_tail_arg_148_1;
continue __wm_tail_127;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findFunction_2336 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findFunction_2336__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const initialState_2345 = (__arg) => {
if (__arg === undefined) {

const state_2344 = { nextExpressionId: 0, nextArmId: 0, functions: __wm_basis_Nil, expressions: __wm_basis_Nil, matchArms: __wm_basis_Nil, diagnostics: __wm_basis_Nil };
return state_2344;
}
__wm_fail("Match", "pattern match failure in function");
};
const baseIrExpression_2351__wm_d4 = (state_2346, source_2347, functionId_2348, kind_2349) => {
const expression_2350 = { id: state_2346.nextExpressionId, functionId: functionId_2348, sourceExprId: source_2347.id, kind: kind_2349, typeId: source_2347.typeId, spanId: source_2347.spanId, bindingId: (__wm_eq(source_2347.kind, "var") ? source_2347.bindingId : __wm_op_sub(1)), patternId: __wm_op_sub(1), targetFunctionId: (__wm_eq(source_2347.kind, "call") ? source_2347.functionId : __wm_op_sub(1)), constructorId: (__wm_eq(source_2347.kind, "constructor") ? source_2347.constructorId : __wm_op_sub(1)), semanticId: source_2347.semanticId, operatorId: source_2347.operatorId, builtinName: source_2347.builtinName, builtinOverloadId: __wm_op_sub(1), resourceOperation: source_2347.resourceOperation, numberValue: source_2347.numberValue, numberKind: source_2347.numberKind, boolValue: source_2347.boolValue, index: source_2347.index, children: Js.Array.fromList(__wm_basis_Nil), armIds: Js.Array.fromList(__wm_basis_Nil) };
return expression_2350;
};
const baseIrExpression_2351 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return baseIrExpression_2351__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const addExpression_2355__wm_d2 = (expression_2352, state_2353) => {
const next_2354 = { ...state_2353, nextExpressionId: (state_2353.nextExpressionId + 1), expressions: __wm_basis_Cons([expression_2352, state_2353.expressions]) };
return [expression_2352.id, next_2354];
};
const addExpression_2355 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addExpression_2355__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const addDiagnostic_2359__wm_d2 = (diagnostic_2356, state_2357) => {
const next_2358 = { ...state_2357, diagnostics: __wm_basis_Cons([diagnostic_2356, state_2357.diagnostics]) };
return next_2358;
};
const addDiagnostic_2359 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addDiagnostic_2359__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const nonTailDiagnostic_2364__wm_d2 = (source_2360, fn_2361) => {
const declaration_2362 = { spanId: fn_2361.spanId, label: "recursive function declared here" };
const diagnostic_2363 = { code: "gpu.recursion.non-tail", message: "direct self-recursion is allowed only in function, if, match, or block-result tail position", spanId: source_2360.spanId, related: Js.Array.fromList(__wm_basis_Cons([declaration_2362, __wm_basis_Nil])) };
return diagnostic_2363;
};
const nonTailDiagnostic_2364 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return nonTailDiagnostic_2364__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const nonExhaustiveDiagnostic_2367 = (__arg) => {
if (true) {
const source_2365 = __arg;
const diagnostic_2366 = { code: "gpu.pattern.non-exhaustive", message: "v1 GPU matches require exactly one arm for every constructor", spanId: source_2365.spanId, related: Js.Array.fromList(__wm_basis_Nil) };
return diagnostic_2366;
}
__wm_fail("Match", "pattern match failure in function");
};
const constructorPatterns_2368__wm_d4 = (armIds_2369, context_2370, constructors_2371, valid_2372) => {
__wm_tail_128: while (true) {
{
const __wm_scalar_156_0 = armIds_2369;
const __wm_scalar_156_1 = context_2370;
const __wm_scalar_156_2 = constructors_2371;
const __wm_scalar_156_3 = valid_2372;
if (__wm_scalar_156_0 === __wm_basis_Nil) {
const context_2373 = __wm_scalar_156_1;
const constructors_2374 = __wm_scalar_156_2;
const valid_2375 = __wm_scalar_156_3;
return [constructors_2374, valid_2375];
} else if (__wm_scalar_156_0?.ctor === -6 && __wm_scalar_156_0.args.length === 1 && __wm_is_tuple(__wm_scalar_156_0.args[0]) && __wm_scalar_156_0.args[0].length === 2) {
const armId_2376 = __wm_scalar_156_0.args[0][0];
const rest_2377 = __wm_scalar_156_0.args[0][1];
const context_2378 = __wm_scalar_156_1;
const constructors_2379 = __wm_scalar_156_2;
const valid_2380 = __wm_scalar_156_3;
{
const exactContext_2381 = context_2378;
const arm_2382 = findMatchArm_2113__wm_d2(exactContext_2381.matchArms, armId_2376);
const pattern_2383 = findPattern_2121__wm_d2(exactContext_2381.patterns, arm_2382.patternId);
if (__wm_eq(pattern_2383.kind, "constructor")) {
{
const __wm_tail_arg_149_0 = rest_2377;
const __wm_tail_arg_149_1 = exactContext_2381;
const __wm_tail_arg_149_2 = __wm_basis_Cons([pattern_2383.constructorId, constructors_2379]);
const __wm_tail_arg_149_3 = valid_2380;
armIds_2369 = __wm_tail_arg_149_0;
context_2370 = __wm_tail_arg_149_1;
constructors_2371 = __wm_tail_arg_149_2;
valid_2372 = __wm_tail_arg_149_3;
continue __wm_tail_128;
}
} else {
{
const __wm_tail_arg_150_0 = rest_2377;
const __wm_tail_arg_150_1 = exactContext_2381;
const __wm_tail_arg_150_2 = constructors_2379;
const __wm_tail_arg_150_3 = false;
armIds_2369 = __wm_tail_arg_150_0;
context_2370 = __wm_tail_arg_150_1;
constructors_2371 = __wm_tail_arg_150_2;
valid_2372 = __wm_tail_arg_150_3;
continue __wm_tail_128;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const constructorPatterns_2368 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return constructorPatterns_2368__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const matchIsExhaustive_2384__wm_d3 = (source_2386, row_2387, context_2388) => {
const value_2389 = findExpression_2073__wm_d2(context_2388.expressions, row_2387.valueExprId);
const valueType_2390 = findType_2129__wm_d2(context_2388.types, value_2389.typeId);
if (__wm_eq(valueType_2390.kind, "adt")) {
const adt_2391 = findAdt_2328__wm_d2(context_2388.adts, valueType_2390.typeNameId);
const __wm_bind_79 = constructorPatterns_2368__wm_d4(Js.Array.toList(row_2387.armIds), context_2388, __wm_basis_Nil, true);
if (!(__wm_is_tuple(__wm_bind_79) && __wm_bind_79.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const constructors_2392 = __wm_bind_79[0];
const valid_2393 = __wm_bind_79[1];
return __wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(valid_2393, unique_2068__wm_d2(constructors_2392, __wm_basis_Nil)), numberEqual_2062__wm_d2(listLength_2053__wm_d2(constructors_2392, 0), listLength_2053__wm_d2(Js.Array.toList(adt_2391.constructorIds), 0))), constructorSetContains_2385__wm_d2(Js.Array.toList(adt_2391.constructorIds), constructors_2392));
} else {
return false;
}
};
const matchIsExhaustive_2384 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return matchIsExhaustive_2384__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const constructorSetContains_2385__wm_d2 = (expected_2394, actual_2395) => {
const __wm_scalar_157_0 = expected_2394;
const __wm_scalar_157_1 = actual_2395;
if (__wm_scalar_157_0 === __wm_basis_Nil) {
const actual_2396 = __wm_scalar_157_1;
return true;
} else if (__wm_scalar_157_0?.ctor === -6 && __wm_scalar_157_0.args.length === 1 && __wm_is_tuple(__wm_scalar_157_0.args[0]) && __wm_scalar_157_0.args[0].length === 2) {
const head_2397 = __wm_scalar_157_0.args[0][0];
const rest_2398 = __wm_scalar_157_0.args[0][1];
const actual_2399 = __wm_scalar_157_1;
return __wm_op_and_d2(contains_2063__wm_d2(actual_2399, head_2397), constructorSetContains_2385__wm_d2(rest_2398, actual_2399));
}
__wm_fail("Match", "non-exhaustive match");
};
const constructorSetContains_2385 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return constructorSetContains_2385__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const buildExpression_2400__wm_d5 = (sourceId_2408, functionId_2409, tailPosition_2410, context_2411, state_2412) => {
const source_2413 = findExpression_2073__wm_d2(context_2411.expressions, sourceId_2408);
if (__wm_eq(source_2413.kind, "block")) {
return buildBlock_2405__wm_d5(source_2413, functionId_2409, tailPosition_2410, context_2411, state_2412);
} else {
if (__wm_eq(source_2413.kind, "if")) {
return buildIf_2402__wm_d5(source_2413, functionId_2409, tailPosition_2410, context_2411, state_2412);
} else {
if (__wm_eq(source_2413.kind, "match")) {
return buildMatch_2403__wm_d5(source_2413, functionId_2409, tailPosition_2410, context_2411, state_2412);
} else {
const selfCall_2414 = __wm_op_and_d2(__wm_eq(source_2413.kind, "call"), numberEqual_2062__wm_d2(source_2413.functionId, functionId_2409));
const kind_2415 = (__wm_op_and_d2(selfCall_2414, tailPosition_2410) ? "tail-call" : (__wm_eq(source_2413.kind, "var") ? "local" : source_2413.kind));
const diagnosed_2416 = (__wm_op_and_d2(selfCall_2414, __wm_op_not(tailPosition_2410)) ? addDiagnostic_2359__wm_d2(nonTailDiagnostic_2364__wm_d2(source_2413, findFunction_2336__wm_d2(context_2411.functions, functionId_2409)), state_2412) : state_2412);
const __wm_bind_80 = buildChildren_2401__wm_d5(Js.Array.toList(source_2413.children), functionId_2409, context_2411, diagnosed_2416, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_80) && __wm_bind_80.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const children_2417 = __wm_bind_80[0];
const withChildren_2418 = __wm_bind_80[1];
const expression_2419 = { ...baseIrExpression_2351__wm_d4(withChildren_2418, source_2413, functionId_2409, kind_2415), builtinOverloadId: (__wm_eq(source_2413.kind, "builtin") ? selectBuiltinOverload_2169__wm_d3(context_2411.builtinOverloads, source_2413, context_2411) : __wm_op_sub(1)), children: Js.Array.fromList(children_2417) };
return addExpression_2355__wm_d2(expression_2419, withChildren_2418);
}
}
}
};
const buildExpression_2400 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildExpression_2400__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildChildren_2401__wm_d5 = (sourceIds_2420, functionId_2421, context_2422, state_2423, reversed_2424) => {
__wm_tail_129: while (true) {
{
const __wm_scalar_158_0 = sourceIds_2420;
const __wm_scalar_158_1 = functionId_2421;
const __wm_scalar_158_2 = context_2422;
const __wm_scalar_158_3 = state_2423;
const __wm_scalar_158_4 = reversed_2424;
if (__wm_scalar_158_0 === __wm_basis_Nil) {
const functionId_2425 = __wm_scalar_158_1;
const context_2426 = __wm_scalar_158_2;
const state_2427 = __wm_scalar_158_3;
const reversed_2428 = __wm_scalar_158_4;
return [reverseInto_2039__wm_d2(reversed_2428, __wm_basis_Nil), state_2427];
} else if (__wm_scalar_158_0?.ctor === -6 && __wm_scalar_158_0.args.length === 1 && __wm_is_tuple(__wm_scalar_158_0.args[0]) && __wm_scalar_158_0.args[0].length === 2) {
const sourceId_2429 = __wm_scalar_158_0.args[0][0];
const rest_2430 = __wm_scalar_158_0.args[0][1];
const functionId_2431 = __wm_scalar_158_1;
const context_2432 = __wm_scalar_158_2;
const state_2433 = __wm_scalar_158_3;
const reversed_2434 = __wm_scalar_158_4;
{
const __wm_bind_81 = buildExpression_2400__wm_d5(sourceId_2429, functionId_2431, false, context_2432, state_2433);
if (!(__wm_is_tuple(__wm_bind_81) && __wm_bind_81.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const childId_2435 = __wm_bind_81[0];
const afterChild_2436 = __wm_bind_81[1];
{
const __wm_tail_arg_151_0 = rest_2430;
const __wm_tail_arg_151_1 = functionId_2431;
const __wm_tail_arg_151_2 = context_2432;
const __wm_tail_arg_151_3 = afterChild_2436;
const __wm_tail_arg_151_4 = __wm_basis_Cons([childId_2435, reversed_2434]);
sourceIds_2420 = __wm_tail_arg_151_0;
functionId_2421 = __wm_tail_arg_151_1;
context_2422 = __wm_tail_arg_151_2;
state_2423 = __wm_tail_arg_151_3;
reversed_2424 = __wm_tail_arg_151_4;
continue __wm_tail_129;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildChildren_2401 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildChildren_2401__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildIf_2402__wm_d5 = (source_2437, functionId_2438, tailPosition_2439, context_2440, state_2441) => {
const __wm_return_value_51 = Js.Array.toList(source_2437.children);
if (__wm_return_value_51?.ctor === -6 && __wm_return_value_51.args.length === 1 && __wm_is_tuple(__wm_return_value_51.args[0]) && __wm_return_value_51.args[0].length === 2 && __wm_return_value_51.args[0][1]?.ctor === -6 && __wm_return_value_51.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_51.args[0][1].args[0]) && __wm_return_value_51.args[0][1].args[0].length === 2 && __wm_return_value_51.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_51.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_51.args[0][1].args[0][1].args[0]) && __wm_return_value_51.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_51.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const conditionId_2442 = __wm_return_value_51.args[0][0];
const thenId_2443 = __wm_return_value_51.args[0][1].args[0][0];
const elseId_2444 = __wm_return_value_51.args[0][1].args[0][1].args[0][0];
const __wm_bind_82 = buildExpression_2400__wm_d5(conditionId_2442, functionId_2438, false, context_2440, state_2441);
if (!(__wm_is_tuple(__wm_bind_82) && __wm_bind_82.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const conditionIr_2445 = __wm_bind_82[0];
const afterCondition_2446 = __wm_bind_82[1];
const __wm_bind_83 = buildExpression_2400__wm_d5(thenId_2443, functionId_2438, tailPosition_2439, context_2440, afterCondition_2446);
if (!(__wm_is_tuple(__wm_bind_83) && __wm_bind_83.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const thenIr_2447 = __wm_bind_83[0];
const afterThen_2448 = __wm_bind_83[1];
const __wm_bind_84 = buildExpression_2400__wm_d5(elseId_2444, functionId_2438, tailPosition_2439, context_2440, afterThen_2448);
if (!(__wm_is_tuple(__wm_bind_84) && __wm_bind_84.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const elseIr_2449 = __wm_bind_84[0];
const afterElse_2450 = __wm_bind_84[1];
const expression_2451 = { ...baseIrExpression_2351__wm_d4(afterElse_2450, source_2437, functionId_2438, "if"), children: Js.Array.fromList(__wm_basis_Cons([conditionIr_2445, __wm_basis_Cons([thenIr_2447, __wm_basis_Cons([elseIr_2449, __wm_basis_Nil])])])) };
return addExpression_2355__wm_d2(expression_2451, afterElse_2450);
} else if (true) {

return __wm_fail("Panic", "schema-v2 if does not have three children");
}
__wm_fail("Match", "non-exhaustive match");
};
const buildIf_2402 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildIf_2402__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildMatch_2403__wm_d5 = (source_2452, functionId_2453, tailPosition_2454, context_2455, state_2456) => {
const row_2457 = findMatch_2105__wm_d2(context_2455.matches, source_2452.id);
const diagnosed_2458 = (matchIsExhaustive_2384__wm_d3(source_2452, row_2457, context_2455) ? state_2456 : addDiagnostic_2359__wm_d2(nonExhaustiveDiagnostic_2367(source_2452), state_2456));
const __wm_bind_85 = buildExpression_2400__wm_d5(row_2457.valueExprId, functionId_2453, false, context_2455, diagnosed_2458);
if (!(__wm_is_tuple(__wm_bind_85) && __wm_bind_85.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const valueIr_2459 = __wm_bind_85[0];
const afterValue_2460 = __wm_bind_85[1];
const __wm_bind_86 = buildMatchArms_2404__wm_d6(Js.Array.toList(row_2457.armIds), functionId_2453, tailPosition_2454, context_2455, afterValue_2460, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_86) && __wm_bind_86.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const armIds_2461 = __wm_bind_86[0];
const afterArms_2462 = __wm_bind_86[1];
const expression_2463 = { ...baseIrExpression_2351__wm_d4(afterArms_2462, source_2452, functionId_2453, "match"), children: Js.Array.fromList(__wm_basis_Cons([valueIr_2459, __wm_basis_Nil])), armIds: Js.Array.fromList(armIds_2461) };
return addExpression_2355__wm_d2(expression_2463, afterArms_2462);
};
const buildMatch_2403 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildMatch_2403__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildMatchArms_2404__wm_d6 = (sourceArmIds_2464, functionId_2465, tailPosition_2466, context_2467, state_2468, reversed_2469) => {
__wm_tail_130: while (true) {
{
const __wm_scalar_159_0 = sourceArmIds_2464;
const __wm_scalar_159_1 = functionId_2465;
const __wm_scalar_159_2 = tailPosition_2466;
const __wm_scalar_159_3 = context_2467;
const __wm_scalar_159_4 = state_2468;
const __wm_scalar_159_5 = reversed_2469;
if (__wm_scalar_159_0 === __wm_basis_Nil) {
const functionId_2470 = __wm_scalar_159_1;
const tailPosition_2471 = __wm_scalar_159_2;
const context_2472 = __wm_scalar_159_3;
const state_2473 = __wm_scalar_159_4;
const reversed_2474 = __wm_scalar_159_5;
return [reverseInto_2039__wm_d2(reversed_2474, __wm_basis_Nil), state_2473];
} else if (__wm_scalar_159_0?.ctor === -6 && __wm_scalar_159_0.args.length === 1 && __wm_is_tuple(__wm_scalar_159_0.args[0]) && __wm_scalar_159_0.args[0].length === 2) {
const sourceArmId_2475 = __wm_scalar_159_0.args[0][0];
const rest_2476 = __wm_scalar_159_0.args[0][1];
const functionId_2477 = __wm_scalar_159_1;
const tailPosition_2478 = __wm_scalar_159_2;
const context_2479 = __wm_scalar_159_3;
const state_2480 = __wm_scalar_159_4;
const reversed_2481 = __wm_scalar_159_5;
{
const exactContext_2482 = context_2479;
const sourceArm_2483 = findMatchArm_2113__wm_d2(exactContext_2482.matchArms, sourceArmId_2475);
const __wm_bind_87 = buildExpression_2400__wm_d5(sourceArm_2483.bodyExprId, functionId_2477, tailPosition_2478, exactContext_2482, state_2480);
if (!(__wm_is_tuple(__wm_bind_87) && __wm_bind_87.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const bodyIr_2484 = __wm_bind_87[0];
const afterBody_2485 = __wm_bind_87[1];
const arm_2486 = { id: afterBody_2485.nextArmId, sourceArmId: sourceArm_2483.id, patternId: sourceArm_2483.patternId, bodyExprId: bodyIr_2484, spanId: sourceArm_2483.spanId };
const afterArm_2487 = { ...afterBody_2485, nextArmId: (afterBody_2485.nextArmId + 1), matchArms: __wm_basis_Cons([arm_2486, afterBody_2485.matchArms]) };
{
const __wm_tail_arg_152_0 = rest_2476;
const __wm_tail_arg_152_1 = functionId_2477;
const __wm_tail_arg_152_2 = tailPosition_2478;
const __wm_tail_arg_152_3 = exactContext_2482;
const __wm_tail_arg_152_4 = afterArm_2487;
const __wm_tail_arg_152_5 = __wm_basis_Cons([arm_2486.id, reversed_2481]);
sourceArmIds_2464 = __wm_tail_arg_152_0;
functionId_2465 = __wm_tail_arg_152_1;
tailPosition_2466 = __wm_tail_arg_152_2;
context_2467 = __wm_tail_arg_152_3;
state_2468 = __wm_tail_arg_152_4;
reversed_2469 = __wm_tail_arg_152_5;
continue __wm_tail_130;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildMatchArms_2404 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return buildMatchArms_2404__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const buildBlock_2405__wm_d5 = (source_2488, functionId_2489, tailPosition_2490, context_2491, state_2492) => {
const row_2493 = findBlock_2081__wm_d2(context_2491.blocks, source_2488.id);
const __wm_bind_88 = buildBlockValues_2406__wm_d5(Js.Array.toList(row_2493.itemIds), functionId_2489, context_2491, state_2492, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_88) && __wm_bind_88.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const builtItems_2494 = __wm_bind_88[0];
const afterItems_2495 = __wm_bind_88[1];
const __wm_bind_89 = buildExpression_2400__wm_d5(row_2493.resultExprId, functionId_2489, tailPosition_2490, context_2491, afterItems_2495);
if (!(__wm_is_tuple(__wm_bind_89) && __wm_bind_89.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const resultIr_2496 = __wm_bind_89[0];
const afterResult_2497 = __wm_bind_89[1];
return buildBlockWrappers_2407__wm_d6(reverseInto_2039__wm_d2(builtItems_2494, __wm_basis_Nil), source_2488, functionId_2489, resultIr_2496, context_2491, afterResult_2497);
};
const buildBlock_2405 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildBlock_2405__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildBlockValues_2406__wm_d5 = (itemIds_2498, functionId_2499, context_2500, state_2501, reversed_2502) => {
__wm_tail_131: while (true) {
{
const __wm_scalar_160_0 = itemIds_2498;
const __wm_scalar_160_1 = functionId_2499;
const __wm_scalar_160_2 = context_2500;
const __wm_scalar_160_3 = state_2501;
const __wm_scalar_160_4 = reversed_2502;
if (__wm_scalar_160_0 === __wm_basis_Nil) {
const functionId_2503 = __wm_scalar_160_1;
const context_2504 = __wm_scalar_160_2;
const state_2505 = __wm_scalar_160_3;
const reversed_2506 = __wm_scalar_160_4;
return [reverseInto_2039__wm_d2(reversed_2506, __wm_basis_Nil), state_2505];
} else if (__wm_scalar_160_0?.ctor === -6 && __wm_scalar_160_0.args.length === 1 && __wm_is_tuple(__wm_scalar_160_0.args[0]) && __wm_scalar_160_0.args[0].length === 2) {
const itemId_2507 = __wm_scalar_160_0.args[0][0];
const rest_2508 = __wm_scalar_160_0.args[0][1];
const functionId_2509 = __wm_scalar_160_1;
const context_2510 = __wm_scalar_160_2;
const state_2511 = __wm_scalar_160_3;
const reversed_2512 = __wm_scalar_160_4;
{
const exactContext_2513 = context_2510;
const item_2514 = findBlockItem_2089__wm_d2(exactContext_2513.blockItems, itemId_2507);
if (__wm_eq(item_2514.kind, "let")) {
{
const letRow_2515 = findLet_2097__wm_d2(exactContext_2513.lets, item_2514.letId);
const __wm_bind_90 = buildExpression_2400__wm_d5(letRow_2515.valueExprId, functionId_2509, false, exactContext_2513, state_2511);
if (!(__wm_is_tuple(__wm_bind_90) && __wm_bind_90.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const valueIr_2516 = __wm_bind_90[0];
const afterValue_2517 = __wm_bind_90[1];
const built_2518 = { itemId: item_2514.id, valueExprId: valueIr_2516 };
{
const __wm_tail_arg_153_0 = rest_2508;
const __wm_tail_arg_153_1 = functionId_2509;
const __wm_tail_arg_153_2 = exactContext_2513;
const __wm_tail_arg_153_3 = afterValue_2517;
const __wm_tail_arg_153_4 = __wm_basis_Cons([built_2518, reversed_2512]);
itemIds_2498 = __wm_tail_arg_153_0;
functionId_2499 = __wm_tail_arg_153_1;
context_2500 = __wm_tail_arg_153_2;
state_2501 = __wm_tail_arg_153_3;
reversed_2502 = __wm_tail_arg_153_4;
continue __wm_tail_131;
}
}
} else {
{
const __wm_bind_91 = buildExpression_2400__wm_d5(item_2514.expressionId, functionId_2509, false, exactContext_2513, state_2511);
if (!(__wm_is_tuple(__wm_bind_91) && __wm_bind_91.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const valueIr_2519 = __wm_bind_91[0];
const afterValue_2520 = __wm_bind_91[1];
const built_2521 = { itemId: item_2514.id, valueExprId: valueIr_2519 };
{
const __wm_tail_arg_154_0 = rest_2508;
const __wm_tail_arg_154_1 = functionId_2509;
const __wm_tail_arg_154_2 = exactContext_2513;
const __wm_tail_arg_154_3 = afterValue_2520;
const __wm_tail_arg_154_4 = __wm_basis_Cons([built_2521, reversed_2512]);
itemIds_2498 = __wm_tail_arg_154_0;
functionId_2499 = __wm_tail_arg_154_1;
context_2500 = __wm_tail_arg_154_2;
state_2501 = __wm_tail_arg_154_3;
reversed_2502 = __wm_tail_arg_154_4;
continue __wm_tail_131;
}
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildBlockValues_2406 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildBlockValues_2406__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildBlockWrappers_2407__wm_d6 = (builtItems_2522, source_2523, functionId_2524, bodyIr_2525, context_2526, state_2527) => {
__wm_tail_132: while (true) {
{
const __wm_scalar_161_0 = builtItems_2522;
const __wm_scalar_161_1 = source_2523;
const __wm_scalar_161_2 = functionId_2524;
const __wm_scalar_161_3 = bodyIr_2525;
const __wm_scalar_161_4 = context_2526;
const __wm_scalar_161_5 = state_2527;
if (__wm_scalar_161_0 === __wm_basis_Nil) {
const source_2528 = __wm_scalar_161_1;
const functionId_2529 = __wm_scalar_161_2;
const bodyIr_2530 = __wm_scalar_161_3;
const context_2531 = __wm_scalar_161_4;
const state_2532 = __wm_scalar_161_5;
return [bodyIr_2530, state_2532];
} else if (__wm_scalar_161_0?.ctor === -6 && __wm_scalar_161_0.args.length === 1 && __wm_is_tuple(__wm_scalar_161_0.args[0]) && __wm_scalar_161_0.args[0].length === 2) {
const built_2533 = __wm_scalar_161_0.args[0][0];
const rest_2534 = __wm_scalar_161_0.args[0][1];
const source_2535 = __wm_scalar_161_1;
const functionId_2536 = __wm_scalar_161_2;
const bodyIr_2537 = __wm_scalar_161_3;
const context_2538 = __wm_scalar_161_4;
const state_2539 = __wm_scalar_161_5;
{
const exactBuilt_2540 = built_2533;
const exactSource_2541 = source_2535;
const exactContext_2542 = context_2538;
const item_2543 = findBlockItem_2089__wm_d2(exactContext_2542.blockItems, exactBuilt_2540.itemId);
if (__wm_eq(item_2543.kind, "let")) {
{
const letRow_2544 = findLet_2097__wm_d2(exactContext_2542.lets, item_2543.letId);
const expression_2545 = { ...baseIrExpression_2351__wm_d4(state_2539, exactSource_2541, functionId_2536, "let"), spanId: item_2543.spanId, bindingId: __wm_op_sub(1), patternId: letRow_2544.patternId, targetFunctionId: __wm_op_sub(1), children: Js.Array.fromList(__wm_basis_Cons([exactBuilt_2540.valueExprId, __wm_basis_Cons([bodyIr_2537, __wm_basis_Nil])])) };
const __wm_bind_92 = addExpression_2355__wm_d2(expression_2545, state_2539);
if (!(__wm_is_tuple(__wm_bind_92) && __wm_bind_92.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const letIr_2546 = __wm_bind_92[0];
const afterLet_2547 = __wm_bind_92[1];
{
const __wm_tail_arg_155_0 = rest_2534;
const __wm_tail_arg_155_1 = exactSource_2541;
const __wm_tail_arg_155_2 = functionId_2536;
const __wm_tail_arg_155_3 = letIr_2546;
const __wm_tail_arg_155_4 = exactContext_2542;
const __wm_tail_arg_155_5 = afterLet_2547;
builtItems_2522 = __wm_tail_arg_155_0;
source_2523 = __wm_tail_arg_155_1;
functionId_2524 = __wm_tail_arg_155_2;
bodyIr_2525 = __wm_tail_arg_155_3;
context_2526 = __wm_tail_arg_155_4;
state_2527 = __wm_tail_arg_155_5;
continue __wm_tail_132;
}
}
} else {
{
const expression_2548 = { ...baseIrExpression_2351__wm_d4(state_2539, exactSource_2541, functionId_2536, "sequence"), spanId: item_2543.spanId, bindingId: __wm_op_sub(1), targetFunctionId: __wm_op_sub(1), children: Js.Array.fromList(__wm_basis_Cons([exactBuilt_2540.valueExprId, __wm_basis_Cons([bodyIr_2537, __wm_basis_Nil])])) };
const __wm_bind_93 = addExpression_2355__wm_d2(expression_2548, state_2539);
if (!(__wm_is_tuple(__wm_bind_93) && __wm_bind_93.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const sequenceIr_2549 = __wm_bind_93[0];
const afterSequence_2550 = __wm_bind_93[1];
{
const __wm_tail_arg_156_0 = rest_2534;
const __wm_tail_arg_156_1 = exactSource_2541;
const __wm_tail_arg_156_2 = functionId_2536;
const __wm_tail_arg_156_3 = sequenceIr_2549;
const __wm_tail_arg_156_4 = exactContext_2542;
const __wm_tail_arg_156_5 = afterSequence_2550;
builtItems_2522 = __wm_tail_arg_156_0;
source_2523 = __wm_tail_arg_156_1;
functionId_2524 = __wm_tail_arg_156_2;
bodyIr_2525 = __wm_tail_arg_156_3;
context_2526 = __wm_tail_arg_156_4;
state_2527 = __wm_tail_arg_156_5;
continue __wm_tail_132;
}
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildBlockWrappers_2407 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return buildBlockWrappers_2407__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const buildFunctions_2551__wm_d3 = (functions_2552, context_2553, state_2554) => {
__wm_tail_133: while (true) {
{
const __wm_scalar_162_0 = functions_2552;
const __wm_scalar_162_1 = context_2553;
const __wm_scalar_162_2 = state_2554;
if (__wm_scalar_162_0 === __wm_basis_Nil) {
const context_2555 = __wm_scalar_162_1;
const state_2556 = __wm_scalar_162_2;
return state_2556;
} else if (__wm_scalar_162_0?.ctor === -6 && __wm_scalar_162_0.args.length === 1 && __wm_is_tuple(__wm_scalar_162_0.args[0]) && __wm_scalar_162_0.args[0].length === 2) {
const fn_2557 = __wm_scalar_162_0.args[0][0];
const rest_2558 = __wm_scalar_162_0.args[0][1];
const context_2559 = __wm_scalar_162_1;
const state_2560 = __wm_scalar_162_2;
{
const exactFunction_2561 = fn_2557;
const exactContext_2562 = context_2559;
const __wm_bind_94 = buildExpression_2400__wm_d5(exactFunction_2561.bodyExprId, exactFunction_2561.id, true, exactContext_2562, state_2560);
if (!(__wm_is_tuple(__wm_bind_94) && __wm_bind_94.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const bodyIr_2563 = __wm_bind_94[0];
const afterBody_2564 = __wm_bind_94[1];
const irFunction_2565 = { functionId: exactFunction_2561.id, bindingId: exactFunction_2561.bindingId, name: exactFunction_2561.name, paramIds: exactFunction_2561.paramIds, resultTypeId: exactFunction_2561.resultTypeId, bodyExprId: bodyIr_2563, recursionGroupId: exactFunction_2561.recursionGroupId, spanId: exactFunction_2561.spanId };
const afterFunction_2566 = { ...afterBody_2564, functions: __wm_basis_Cons([irFunction_2565, afterBody_2564.functions]) };
{
const __wm_tail_arg_157_0 = rest_2558;
const __wm_tail_arg_157_1 = exactContext_2562;
const __wm_tail_arg_157_2 = afterFunction_2566;
functions_2552 = __wm_tail_arg_157_0;
context_2553 = __wm_tail_arg_157_1;
state_2554 = __wm_tail_arg_157_2;
continue __wm_tail_133;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildFunctions_2551 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return buildFunctions_2551__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const findOccurrence_2567__wm_d3 = (items_2568, kind_2569, sourceId_2570) => {
__wm_tail_134: while (true) {
{
const __wm_scalar_163_0 = items_2568;
const __wm_scalar_163_1 = kind_2569;
const __wm_scalar_163_2 = sourceId_2570;
if (__wm_scalar_163_0 === __wm_basis_Nil) {
const kind_2571 = __wm_scalar_163_1;
const sourceId_2572 = __wm_scalar_163_2;
return __wm_fail("Panic", "missing concrete GPU occurrence type");
} else if (__wm_scalar_163_0?.ctor === -6 && __wm_scalar_163_0.args.length === 1 && __wm_is_tuple(__wm_scalar_163_0.args[0]) && __wm_scalar_163_0.args[0].length === 2) {
const item_2573 = __wm_scalar_163_0.args[0][0];
const rest_2574 = __wm_scalar_163_0.args[0][1];
const kind_2575 = __wm_scalar_163_1;
const sourceId_2576 = __wm_scalar_163_2;
{
const exact_2577 = item_2573;
if (__wm_op_and_d2(__wm_eq(exact_2577.kind, kind_2575), numberEqual_2062__wm_d2(exact_2577.sourceId, sourceId_2576))) {
return exact_2577;
} else {
{
const __wm_tail_arg_158_0 = rest_2574;
const __wm_tail_arg_158_1 = kind_2575;
const __wm_tail_arg_158_2 = sourceId_2576;
items_2568 = __wm_tail_arg_158_0;
kind_2569 = __wm_tail_arg_158_1;
sourceId_2570 = __wm_tail_arg_158_2;
continue __wm_tail_134;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findOccurrence_2567 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findOccurrence_2567__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizeExpressions_2578__wm_d3 = (expressions_2579, occurrences_2580, output_2581) => {
__wm_tail_135: while (true) {
{
const __wm_scalar_164_0 = expressions_2579;
const __wm_scalar_164_1 = occurrences_2580;
const __wm_scalar_164_2 = output_2581;
if (__wm_scalar_164_0 === __wm_basis_Nil) {
const occurrences_2582 = __wm_scalar_164_1;
const output_2583 = __wm_scalar_164_2;
return reverseInto_2039__wm_d2(output_2583, __wm_basis_Nil);
} else if (__wm_scalar_164_0?.ctor === -6 && __wm_scalar_164_0.args.length === 1 && __wm_is_tuple(__wm_scalar_164_0.args[0]) && __wm_scalar_164_0.args[0].length === 2) {
const expression_2584 = __wm_scalar_164_0.args[0][0];
const rest_2585 = __wm_scalar_164_0.args[0][1];
const occurrences_2586 = __wm_scalar_164_1;
const output_2587 = __wm_scalar_164_2;
{
const exactExpression_2588 = expression_2584;
const occurrence_2589 = findOccurrence_2567__wm_d3(occurrences_2586, "expression", exactExpression_2588.id);
const concrete_2590 = { ...exactExpression_2588, typeId: occurrence_2589.shaderTypeId };
{
const __wm_tail_arg_159_0 = rest_2585;
const __wm_tail_arg_159_1 = occurrences_2586;
const __wm_tail_arg_159_2 = __wm_basis_Cons([concrete_2590, output_2587]);
expressions_2579 = __wm_tail_arg_159_0;
occurrences_2580 = __wm_tail_arg_159_1;
output_2581 = __wm_tail_arg_159_2;
continue __wm_tail_135;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizeExpressions_2578 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concretizeExpressions_2578__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizePatterns_2591__wm_d3 = (patterns_2592, occurrences_2593, output_2594) => {
__wm_tail_136: while (true) {
{
const __wm_scalar_165_0 = patterns_2592;
const __wm_scalar_165_1 = occurrences_2593;
const __wm_scalar_165_2 = output_2594;
if (__wm_scalar_165_0 === __wm_basis_Nil) {
const occurrences_2595 = __wm_scalar_165_1;
const output_2596 = __wm_scalar_165_2;
return reverseInto_2039__wm_d2(output_2596, __wm_basis_Nil);
} else if (__wm_scalar_165_0?.ctor === -6 && __wm_scalar_165_0.args.length === 1 && __wm_is_tuple(__wm_scalar_165_0.args[0]) && __wm_scalar_165_0.args[0].length === 2) {
const pattern_2597 = __wm_scalar_165_0.args[0][0];
const rest_2598 = __wm_scalar_165_0.args[0][1];
const occurrences_2599 = __wm_scalar_165_1;
const output_2600 = __wm_scalar_165_2;
{
const exactPattern_2601 = pattern_2597;
const occurrence_2602 = findOccurrence_2567__wm_d3(occurrences_2599, "pattern", exactPattern_2601.id);
const concrete_2603 = { ...exactPattern_2601, typeId: occurrence_2602.shaderTypeId };
{
const __wm_tail_arg_160_0 = rest_2598;
const __wm_tail_arg_160_1 = occurrences_2599;
const __wm_tail_arg_160_2 = __wm_basis_Cons([concrete_2603, output_2600]);
patterns_2592 = __wm_tail_arg_160_0;
occurrences_2593 = __wm_tail_arg_160_1;
output_2594 = __wm_tail_arg_160_2;
continue __wm_tail_136;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizePatterns_2591 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concretizePatterns_2591__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizeParams_2604__wm_d3 = (params_2605, patterns_2606, output_2607) => {
__wm_tail_137: while (true) {
{
const __wm_scalar_166_0 = params_2605;
const __wm_scalar_166_1 = patterns_2606;
const __wm_scalar_166_2 = output_2607;
if (__wm_scalar_166_0 === __wm_basis_Nil) {
const patterns_2608 = __wm_scalar_166_1;
const output_2609 = __wm_scalar_166_2;
return reverseInto_2039__wm_d2(output_2609, __wm_basis_Nil);
} else if (__wm_scalar_166_0?.ctor === -6 && __wm_scalar_166_0.args.length === 1 && __wm_is_tuple(__wm_scalar_166_0.args[0]) && __wm_scalar_166_0.args[0].length === 2) {
const param_2610 = __wm_scalar_166_0.args[0][0];
const rest_2611 = __wm_scalar_166_0.args[0][1];
const patterns_2612 = __wm_scalar_166_1;
const output_2613 = __wm_scalar_166_2;
{
const exactParam_2614 = param_2610;
const pattern_2615 = findPattern_2121__wm_d2(patterns_2612, exactParam_2614.patternId);
const concrete_2616 = { ...exactParam_2614, typeId: pattern_2615.typeId };
{
const __wm_tail_arg_161_0 = rest_2611;
const __wm_tail_arg_161_1 = patterns_2612;
const __wm_tail_arg_161_2 = __wm_basis_Cons([concrete_2616, output_2613]);
params_2605 = __wm_tail_arg_161_0;
patterns_2606 = __wm_tail_arg_161_1;
output_2607 = __wm_tail_arg_161_2;
continue __wm_tail_137;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizeParams_2604 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concretizeParams_2604__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizeFunctions_2617__wm_d3 = (functions_2618, expressions_2619, output_2620) => {
__wm_tail_138: while (true) {
{
const __wm_scalar_167_0 = functions_2618;
const __wm_scalar_167_1 = expressions_2619;
const __wm_scalar_167_2 = output_2620;
if (__wm_scalar_167_0 === __wm_basis_Nil) {
const expressions_2621 = __wm_scalar_167_1;
const output_2622 = __wm_scalar_167_2;
return reverseInto_2039__wm_d2(output_2622, __wm_basis_Nil);
} else if (__wm_scalar_167_0?.ctor === -6 && __wm_scalar_167_0.args.length === 1 && __wm_is_tuple(__wm_scalar_167_0.args[0]) && __wm_scalar_167_0.args[0].length === 2) {
const fn_2623 = __wm_scalar_167_0.args[0][0];
const rest_2624 = __wm_scalar_167_0.args[0][1];
const expressions_2625 = __wm_scalar_167_1;
const output_2626 = __wm_scalar_167_2;
{
const exactFunction_2627 = fn_2623;
const body_2628 = findExpression_2073__wm_d2(expressions_2625, exactFunction_2627.bodyExprId);
const concrete_2629 = { ...exactFunction_2627, resultTypeId: body_2628.typeId };
{
const __wm_tail_arg_162_0 = rest_2624;
const __wm_tail_arg_162_1 = expressions_2625;
const __wm_tail_arg_162_2 = __wm_basis_Cons([concrete_2629, output_2626]);
functions_2618 = __wm_tail_arg_162_0;
expressions_2619 = __wm_tail_arg_162_1;
output_2620 = __wm_tail_arg_162_2;
continue __wm_tail_138;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizeFunctions_2617 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concretizeFunctions_2617__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const uniformShaderTypeId_2630__wm_d4 = (expressions_2631, occurrences_2632, index_2633, fallback_2634) => {
__wm_tail_139: while (true) {
{
const __wm_scalar_168_0 = expressions_2631;
const __wm_scalar_168_1 = occurrences_2632;
const __wm_scalar_168_2 = index_2633;
const __wm_scalar_168_3 = fallback_2634;
if (__wm_scalar_168_0 === __wm_basis_Nil) {
const occurrences_2635 = __wm_scalar_168_1;
const index_2636 = __wm_scalar_168_2;
const fallback_2637 = __wm_scalar_168_3;
return fallback_2637;
} else if (__wm_scalar_168_0?.ctor === -6 && __wm_scalar_168_0.args.length === 1 && __wm_is_tuple(__wm_scalar_168_0.args[0]) && __wm_scalar_168_0.args[0].length === 2) {
const expression_2638 = __wm_scalar_168_0.args[0][0];
const rest_2639 = __wm_scalar_168_0.args[0][1];
const occurrences_2640 = __wm_scalar_168_1;
const index_2641 = __wm_scalar_168_2;
const fallback_2642 = __wm_scalar_168_3;
{
const exactExpression_2643 = expression_2638;
if (__wm_op_and_d2(__wm_eq(exactExpression_2643.kind, "uniform"), numberEqual_2062__wm_d2(exactExpression_2643.index, index_2641))) {
{
const occurrence_2644 = findOccurrence_2567__wm_d3(occurrences_2640, "expression", exactExpression_2643.id);
return occurrence_2644.shaderTypeId;
}
} else {
{
const __wm_tail_arg_163_0 = rest_2639;
const __wm_tail_arg_163_1 = occurrences_2640;
const __wm_tail_arg_163_2 = index_2641;
const __wm_tail_arg_163_3 = fallback_2642;
expressions_2631 = __wm_tail_arg_163_0;
occurrences_2632 = __wm_tail_arg_163_1;
index_2633 = __wm_tail_arg_163_2;
fallback_2634 = __wm_tail_arg_163_3;
continue __wm_tail_139;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const uniformShaderTypeId_2630 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return uniformShaderTypeId_2630__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizeEnvironmentFields_2645__wm_d4 = (fields_2646, expressions_2647, occurrences_2648, output_2649) => {
__wm_tail_140: while (true) {
{
const __wm_scalar_169_0 = fields_2646;
const __wm_scalar_169_1 = expressions_2647;
const __wm_scalar_169_2 = occurrences_2648;
const __wm_scalar_169_3 = output_2649;
if (__wm_scalar_169_0 === __wm_basis_Nil) {
const expressions_2650 = __wm_scalar_169_1;
const occurrences_2651 = __wm_scalar_169_2;
const output_2652 = __wm_scalar_169_3;
return reverseInto_2039__wm_d2(output_2652, __wm_basis_Nil);
} else if (__wm_scalar_169_0?.ctor === -6 && __wm_scalar_169_0.args.length === 1 && __wm_is_tuple(__wm_scalar_169_0.args[0]) && __wm_scalar_169_0.args[0].length === 2) {
const field_2653 = __wm_scalar_169_0.args[0][0];
const rest_2654 = __wm_scalar_169_0.args[0][1];
const expressions_2655 = __wm_scalar_169_1;
const occurrences_2656 = __wm_scalar_169_2;
const output_2657 = __wm_scalar_169_3;
{
const exactField_2658 = field_2653;
const concrete_2659 = { ...exactField_2658, typeId: uniformShaderTypeId_2630__wm_d4(expressions_2655, occurrences_2656, exactField_2658.declaredIndex, exactField_2658.typeId) };
{
const __wm_tail_arg_164_0 = rest_2654;
const __wm_tail_arg_164_1 = expressions_2655;
const __wm_tail_arg_164_2 = occurrences_2656;
const __wm_tail_arg_164_3 = __wm_basis_Cons([concrete_2659, output_2657]);
fields_2646 = __wm_tail_arg_164_0;
expressions_2647 = __wm_tail_arg_164_1;
occurrences_2648 = __wm_tail_arg_164_2;
output_2649 = __wm_tail_arg_164_3;
continue __wm_tail_140;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizeEnvironmentFields_2645 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return concretizeEnvironmentFields_2645__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const compileSliceProgram_2680 = (__arg) => {
if (true) {
const input_2660 = __arg;
const elaboration_2661 = elaborateSliceProgramTypes_2327(input_2660);
const shaderTypes_2662 = elaboration_2661.shaderTypes;
const occurrences_2663 = Js.Array.toList(elaboration_2661.occurrences);
const sourceExpressions_2664 = Js.Array.toList(input_2660.expressions);
const concreteExpressions_2665 = concretizeExpressions_2578__wm_d3(sourceExpressions_2664, occurrences_2663, __wm_basis_Nil);
const concretePatterns_2666 = concretizePatterns_2591__wm_d3(Js.Array.toList(input_2660.patterns), occurrences_2663, __wm_basis_Nil);
const elaboratedInput_2667 = { ...input_2660, types: shaderTypes_2662, environmentFields: Js.Array.fromList(concretizeEnvironmentFields_2645__wm_d4(Js.Array.toList(input_2660.environmentFields), sourceExpressions_2664, occurrences_2663, __wm_basis_Nil)), functions: Js.Array.fromList(concretizeFunctions_2617__wm_d3(Js.Array.toList(input_2660.functions), concreteExpressions_2665, __wm_basis_Nil)), patterns: Js.Array.fromList(concretePatterns_2666), params: Js.Array.fromList(concretizeParams_2604__wm_d3(Js.Array.toList(input_2660.params), concretePatterns_2666, __wm_basis_Nil)), expressions: Js.Array.fromList(concreteExpressions_2665) };
const builtinCatalog_2668 = elaboratedInput_2667.builtinCatalog;
const context_2669 = { expressions: Js.Array.toList(elaboratedInput_2667.expressions), blocks: Js.Array.toList(elaboratedInput_2667.blocks), blockItems: Js.Array.toList(elaboratedInput_2667.blockItems), lets: Js.Array.toList(elaboratedInput_2667.lets), matches: Js.Array.toList(elaboratedInput_2667.matches), matchArms: Js.Array.toList(elaboratedInput_2667.matchArms), patterns: Js.Array.toList(elaboratedInput_2667.patterns), types: Js.Array.toList(elaboratedInput_2667.types), adts: Js.Array.toList(elaboratedInput_2667.adts), functions: Js.Array.toList(elaboratedInput_2667.functions), builtinOverloads: Js.Array.toList(builtinCatalog_2668.overloads), occurrences: occurrences_2663 };
const state_2670 = buildFunctions_2551__wm_d3(Js.Array.toList(elaboratedInput_2667.functions), context_2669, initialState_2345(undefined));
const layouts_2671 = buildSliceLayouts_141(elaboratedInput_2667);
const irFunctions_2672 = Js.Array.fromList(reverseInto_2039__wm_d2(state_2670.functions, __wm_basis_Nil));
const irExpressions_2673 = Js.Array.fromList(reverseInto_2039__wm_d2(state_2670.expressions, __wm_basis_Nil));
const irMatchArms_2674 = Js.Array.fromList(reverseInto_2039__wm_d2(state_2670.matchArms, __wm_basis_Nil));
const lowered_2675 = lowerSliceProgram_906__wm_d8(irFunctions_2672, irExpressions_2673, irMatchArms_2674, elaboratedInput_2667.params, elaboratedInput_2667.patterns, elaboratedInput_2667.constructors, layouts_2671.adtLayouts, layouts_2671.adtFields);
const slangModule_2676 = ((__v) => {
if (__v === __wm_basis_Nil) {

return emitSliceSlangModule_1464__wm_d10(elaboratedInput_2667, layouts_2671.adtLayouts, layouts_2671.adtFields, lowered_2675.functions, lowered_2675.locals, lowered_2675.atoms, lowered_2675.operations, lowered_2675.statements, lowered_2675.blocks, lowered_2675.cases);
} else if (true) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
})(state_2670.diagnostics);
const callableName_2677 = ((__v) => {
if (__v === __wm_basis_Nil) {

return emitSliceCallableName_1466(elaboratedInput_2667);
} else if (true) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
})(state_2670.diagnostics);
const slangSource_2678 = ((__v) => {
if (__v === __wm_basis_Nil) {

return emitSliceSlang_1478__wm_d10(elaboratedInput_2667, layouts_2671.adtLayouts, layouts_2671.adtFields, lowered_2675.functions, lowered_2675.locals, lowered_2675.atoms, lowered_2675.operations, lowered_2675.statements, lowered_2675.blocks, lowered_2675.cases);
} else if (true) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
})(state_2670.diagnostics);
const output_2679 = { schemaVersion: 5, program: input_2660, shaderTypes: shaderTypes_2662, typeEvidence: elaboration_2661.typeEvidence, occurrences: elaboration_2661.occurrences, builtinSelections: elaboration_2661.builtinSelections, irFunctions: irFunctions_2672, irExpressions: irExpressions_2673, irMatchArms: irMatchArms_2674, adtLayouts: layouts_2671.adtLayouts, adtFields: layouts_2671.adtFields, loweredFunctions: lowered_2675.functions, loweredLocals: lowered_2675.locals, loweredAtoms: lowered_2675.atoms, loweredOperations: lowered_2675.operations, loweredStatements: lowered_2675.statements, loweredBlocks: lowered_2675.blocks, loweredCases: lowered_2675.cases, slangModule: slangModule_2676, callableName: callableName_2677, slangSource: slangSource_2678, diagnostics: Js.Array.fromList(reverseInto_2039__wm_d2(state_2670.diagnostics, __wm_basis_Nil)) };
return output_2679;
}
__wm_fail("Match", "pattern match failure in function");
};
return { "SliceContext": SliceContext_2036, "SliceIrState": SliceIrState_2037, "BuiltBlockItem": BuiltBlockItem_2038, "reverseInto": reverseInto_2039, "reverseInto__wm_d2": reverseInto_2039__wm_d2, "append": append_2046, "append__wm_d2": append_2046__wm_d2, "listLength": listLength_2053, "listLength__wm_d2": listLength_2053__wm_d2, "numberEqual": numberEqual_2062, "numberEqual__wm_d2": numberEqual_2062__wm_d2, "contains": contains_2063, "contains__wm_d2": contains_2063__wm_d2, "unique": unique_2068, "unique__wm_d2": unique_2068__wm_d2, "findExpression": findExpression_2073, "findExpression__wm_d2": findExpression_2073__wm_d2, "findBlock": findBlock_2081, "findBlock__wm_d2": findBlock_2081__wm_d2, "findBlockItem": findBlockItem_2089, "findBlockItem__wm_d2": findBlockItem_2089__wm_d2, "findLet": findLet_2097, "findLet__wm_d2": findLet_2097__wm_d2, "findMatch": findMatch_2105, "findMatch__wm_d2": findMatch_2105__wm_d2, "findMatchArm": findMatchArm_2113, "findMatchArm__wm_d2": findMatchArm_2113__wm_d2, "findPattern": findPattern_2121, "findPattern__wm_d2": findPattern_2121__wm_d2, "findType": findType_2129, "findType__wm_d2": findType_2129__wm_d2, "findExpressionOccurrence": findExpressionOccurrence_2137, "findExpressionOccurrence__wm_d2": findExpressionOccurrence_2137__wm_d2, "shaderBuiltinTypeName": shaderBuiltinTypeName_2155, "shaderBuiltinTypeName__wm_d2": shaderBuiltinTypeName_2155__wm_d2, "builtinParamsMatch": builtinParamsMatch_2156, "builtinParamsMatch__wm_d3": builtinParamsMatch_2156__wm_d3, "selectBuiltinOverload": selectBuiltinOverload_2169, "selectBuiltinOverload__wm_d3": selectBuiltinOverload_2169__wm_d3, "collectBuiltinSelections": collectBuiltinSelections_2182, "collectBuiltinSelections__wm_d3": collectBuiltinSelections_2182__wm_d3, "allSemanticNumbers": allSemanticNumbers_2195, "allSemanticNumbers__wm_d2": allSemanticNumbers_2195__wm_d2, "shaderTypeKind": shaderTypeKind_2207, "shaderTypeKind__wm_d2": shaderTypeKind_2207__wm_d2, "shaderTypeReason": shaderTypeReason_2210, "shaderTypeReason__wm_d2": shaderTypeReason_2210__wm_d2, "offsetTypeIds": offsetTypeIds_2211, "offsetTypeIds__wm_d3": offsetTypeIds_2211__wm_d3, "addI32ShaderTypes": addI32ShaderTypes_2221, "addI32ShaderTypes__wm_d4": addI32ShaderTypes_2221__wm_d4, "concreteShaderTypeId": concreteShaderTypeId_2245, "concreteShaderTypeId__wm_d4": concreteShaderTypeId_2245__wm_d4, "elaborateSliceTypes": elaborateSliceTypes_2246, "elaborateSliceTypes__wm_d4": elaborateSliceTypes_2246__wm_d4, "addExpressionOccurrences": addExpressionOccurrences_2263, "addExpressionOccurrences__wm_d5": addExpressionOccurrences_2263__wm_d5, "addPatternOccurrences": addPatternOccurrences_2282, "addPatternOccurrences__wm_d6": addPatternOccurrences_2282__wm_d6, "addFunctionOccurrences": addFunctionOccurrences_2304, "addFunctionOccurrences__wm_d2": addFunctionOccurrences_2304__wm_d2, "elaborateSliceProgramTypes": elaborateSliceProgramTypes_2327, "findAdt": findAdt_2328, "findAdt__wm_d2": findAdt_2328__wm_d2, "findFunction": findFunction_2336, "findFunction__wm_d2": findFunction_2336__wm_d2, "initialState": initialState_2345, "baseIrExpression": baseIrExpression_2351, "baseIrExpression__wm_d4": baseIrExpression_2351__wm_d4, "addExpression": addExpression_2355, "addExpression__wm_d2": addExpression_2355__wm_d2, "addDiagnostic": addDiagnostic_2359, "addDiagnostic__wm_d2": addDiagnostic_2359__wm_d2, "nonTailDiagnostic": nonTailDiagnostic_2364, "nonTailDiagnostic__wm_d2": nonTailDiagnostic_2364__wm_d2, "nonExhaustiveDiagnostic": nonExhaustiveDiagnostic_2367, "constructorPatterns": constructorPatterns_2368, "constructorPatterns__wm_d4": constructorPatterns_2368__wm_d4, "matchIsExhaustive": matchIsExhaustive_2384, "matchIsExhaustive__wm_d3": matchIsExhaustive_2384__wm_d3, "constructorSetContains": constructorSetContains_2385, "constructorSetContains__wm_d2": constructorSetContains_2385__wm_d2, "buildExpression": buildExpression_2400, "buildExpression__wm_d5": buildExpression_2400__wm_d5, "buildChildren": buildChildren_2401, "buildChildren__wm_d5": buildChildren_2401__wm_d5, "buildIf": buildIf_2402, "buildIf__wm_d5": buildIf_2402__wm_d5, "buildMatch": buildMatch_2403, "buildMatch__wm_d5": buildMatch_2403__wm_d5, "buildMatchArms": buildMatchArms_2404, "buildMatchArms__wm_d6": buildMatchArms_2404__wm_d6, "buildBlock": buildBlock_2405, "buildBlock__wm_d5": buildBlock_2405__wm_d5, "buildBlockValues": buildBlockValues_2406, "buildBlockValues__wm_d5": buildBlockValues_2406__wm_d5, "buildBlockWrappers": buildBlockWrappers_2407, "buildBlockWrappers__wm_d6": buildBlockWrappers_2407__wm_d6, "buildFunctions": buildFunctions_2551, "buildFunctions__wm_d3": buildFunctions_2551__wm_d3, "findOccurrence": findOccurrence_2567, "findOccurrence__wm_d3": findOccurrence_2567__wm_d3, "concretizeExpressions": concretizeExpressions_2578, "concretizeExpressions__wm_d3": concretizeExpressions_2578__wm_d3, "concretizePatterns": concretizePatterns_2591, "concretizePatterns__wm_d3": concretizePatterns_2591__wm_d3, "concretizeParams": concretizeParams_2604, "concretizeParams__wm_d3": concretizeParams_2604__wm_d3, "concretizeFunctions": concretizeFunctions_2617, "concretizeFunctions__wm_d3": concretizeFunctions_2617__wm_d3, "uniformShaderTypeId": uniformShaderTypeId_2630, "uniformShaderTypeId__wm_d4": uniformShaderTypeId_2630__wm_d4, "concretizeEnvironmentFields": concretizeEnvironmentFields_2645, "concretizeEnvironmentFields__wm_d4": concretizeEnvironmentFields_2645__wm_d4, "compileSliceProgram": compileSliceProgram_2680 };
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
const compileSliceProgram_2680 = __wm_module_6["compileSliceProgram"];
const elaborateSliceProgramTypes_2327 = __wm_module_6["elaborateSliceProgramTypes"];
const SpecializationRegistryEntry_2681 = (__record_args) => ({ specializationId: __record_args[0], paramRepresentations: __record_args[1], resultRepresentation: __record_args[2] });
const SpecializationBuildState_2682 = (__record_args) => ({ nextId: __record_args[0], registry: __record_args[1], specializations: __record_args[2], rootSpecializations: __record_args[3], calls: __record_args[4], diagnostics: __record_args[5] });
const IrBuildState_2683 = (__record_args) => ({ nextExpressionId: __record_args[0], functions: __record_args[1], expressions: __record_args[2] });
const typedExpression_2686 = (__arg) => {
if (true) {
const expression_2684 = __arg;
const output_2685 = { id: expression_2684.id, kind: expression_2684.kind, typeId: expression_2684.typeId, spanId: expression_2684.spanId, bindingId: expression_2684.bindingId, name: expression_2684.name, operator: expression_2684.operator, numberValue: expression_2684.numberValue, boolValue: expression_2684.boolValue, children: expression_2684.children, capability: expression_2684.capability };
return output_2685;
}
__wm_fail("Match", "pattern match failure in function");
};
const typedFunction_2691__wm_d2 = (reachable_2687, fn_2688) => {
const capability_2689 = (__wm_eq(fn_2688.capability, "gpu-only") ? "gpu-only" : (Map.has([reachable_2687, fn_2688.id]) ? "gpu-eligible" : "cpu-only"));
const output_2690 = { id: fn_2688.id, regionId: fn_2688.regionId, bindingId: fn_2688.bindingId, name: fn_2688.name, params: fn_2688.params, resultTypeId: fn_2688.resultTypeId, bodyExprId: fn_2688.bodyExprId, spanId: fn_2688.spanId, capability: capability_2689 };
return output_2690;
};
const typedFunction_2691 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return typedFunction_2691__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emptyOutput_2693 = (__arg) => {
if (__arg === undefined) {

const output_2692 = { schemaVersion: 1, functions: Js.Array.fromList(__wm_basis_Nil), captures: Js.Array.fromList(__wm_basis_Nil), specializations: Js.Array.fromList(__wm_basis_Nil), rootSpecializations: Js.Array.fromList(__wm_basis_Nil), calls: Js.Array.fromList(__wm_basis_Nil), irFunctions: Js.Array.fromList(__wm_basis_Nil), irExpressions: Js.Array.fromList(__wm_basis_Nil), types: Js.Array.fromList(__wm_basis_Nil), expressions: Js.Array.fromList(__wm_basis_Nil), diagnostics: Js.Array.fromList(__wm_basis_Nil) };
return output_2692;
}
__wm_fail("Match", "pattern match failure in function");
};
const incompatibleSchema_2697 = (__arg) => {
if (true) {
const version_2694 = __arg;
const diagnostic_2695 = { code: "gpu.schema-version", message: "unsupported GPU elaboration schema version", spanId: __wm_op_sub(1) };
const output_2696 = { schemaVersion: 1, functions: Js.Array.fromList(__wm_basis_Nil), captures: Js.Array.fromList(__wm_basis_Nil), specializations: Js.Array.fromList(__wm_basis_Nil), rootSpecializations: Js.Array.fromList(__wm_basis_Nil), calls: Js.Array.fromList(__wm_basis_Nil), irFunctions: Js.Array.fromList(__wm_basis_Nil), irExpressions: Js.Array.fromList(__wm_basis_Nil), types: Js.Array.fromList(__wm_basis_Nil), expressions: Js.Array.fromList(__wm_basis_Nil), diagnostics: Js.Array.fromList(__wm_basis_Cons([diagnostic_2695, __wm_basis_Nil])) };
return output_2696;
}
__wm_fail("Match", "pattern match failure in function");
};
const prependAll_2698__wm_d2 = (items_2699, tail_2700) => {
const __wm_scalar_170_0 = items_2699;
const __wm_scalar_170_1 = tail_2700;
if (__wm_scalar_170_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_170_1, tail_2700)) {

return tail_2700;
} else if (__wm_scalar_170_0?.ctor === -6 && __wm_scalar_170_0.args.length === 1 && __wm_is_tuple(__wm_scalar_170_0.args[0]) && __wm_scalar_170_0.args[0].length === 2 && __wm_eq(__wm_scalar_170_1, tail_2700)) {
const head_2701 = __wm_scalar_170_0.args[0][0];
const rest_2702 = __wm_scalar_170_0.args[0][1];
return __wm_basis_Cons([head_2701, prependAll_2698__wm_d2(rest_2702, tail_2700)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const prependAll_2698 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return prependAll_2698__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const reverseInto_2703__wm_d2 = (items_2704, reversed_2705) => {
__wm_tail_141: while (true) {
{
const __wm_scalar_171_0 = items_2704;
const __wm_scalar_171_1 = reversed_2705;
if (__wm_scalar_171_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_171_1, reversed_2705)) {

return reversed_2705;
} else if (__wm_scalar_171_0?.ctor === -6 && __wm_scalar_171_0.args.length === 1 && __wm_is_tuple(__wm_scalar_171_0.args[0]) && __wm_scalar_171_0.args[0].length === 2 && __wm_eq(__wm_scalar_171_1, reversed_2705)) {
const head_2706 = __wm_scalar_171_0.args[0][0];
const rest_2707 = __wm_scalar_171_0.args[0][1];
{
const __wm_tail_arg_165_0 = rest_2707;
const __wm_tail_arg_165_1 = __wm_basis_Cons([head_2706, reversed_2705]);
items_2704 = __wm_tail_arg_165_0;
reversed_2705 = __wm_tail_arg_165_1;
continue __wm_tail_141;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reverseInto_2703 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reverseInto_2703__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const capabilityDiagnostic_2711 = (__arg) => {
if (true) {
const expression_2708 = __arg;
if (__wm_eq(expression_2708.capability, "host-ffi")) {
const diagnostic_2709 = { code: "gpu.host-ffi", message: "host FFI expression cannot execute in a GPU region", spanId: expression_2708.spanId };
return __wm_basis_Some(diagnostic_2709);
} else {
if (__wm_eq(expression_2708.capability, "unsupported")) {
const diagnostic_2710 = { code: "gpu.unsupported-expression", message: "expression is not supported by the current GPU language subset", spanId: expression_2708.spanId };
return __wm_basis_Some(diagnostic_2710);
} else {
return __wm_basis_None;
}
}
}
__wm_fail("Match", "pattern match failure in function");
};
const reachableBodyIds_2712__wm_d3 = (functions_2713, reachable_2714, bodyIds_2715) => {
__wm_tail_142: while (true) {
{
const __wm_scalar_172_0 = functions_2713;
const __wm_scalar_172_1 = reachable_2714;
const __wm_scalar_172_2 = bodyIds_2715;
if (__wm_scalar_172_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_172_1, reachable_2714) && __wm_eq(__wm_scalar_172_2, bodyIds_2715)) {

return bodyIds_2715;
} else if (__wm_scalar_172_0?.ctor === -6 && __wm_scalar_172_0.args.length === 1 && __wm_is_tuple(__wm_scalar_172_0.args[0]) && __wm_scalar_172_0.args[0].length === 2 && __wm_eq(__wm_scalar_172_1, reachable_2714) && __wm_eq(__wm_scalar_172_2, bodyIds_2715)) {
const fn_2716 = __wm_scalar_172_0.args[0][0];
const rest_2717 = __wm_scalar_172_0.args[0][1];
{
const exact_2718 = fn_2716;
if (Map.has([reachable_2714, exact_2718.id])) {
{
const __wm_tail_arg_166_0 = rest_2717;
const __wm_tail_arg_166_1 = reachable_2714;
const __wm_tail_arg_166_2 = __wm_basis_Cons([exact_2718.bodyExprId, bodyIds_2715]);
functions_2713 = __wm_tail_arg_166_0;
reachable_2714 = __wm_tail_arg_166_1;
bodyIds_2715 = __wm_tail_arg_166_2;
continue __wm_tail_142;
}
} else {
{
const __wm_tail_arg_167_0 = rest_2717;
const __wm_tail_arg_167_1 = reachable_2714;
const __wm_tail_arg_167_2 = bodyIds_2715;
functions_2713 = __wm_tail_arg_167_0;
reachable_2714 = __wm_tail_arg_167_1;
bodyIds_2715 = __wm_tail_arg_167_2;
continue __wm_tail_142;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reachableBodyIds_2712 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return reachableBodyIds_2712__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const reachableCapabilityDiagnostics_2719__wm_d4 = (pending_2720, expressionRegistry_2721, visited_2722, diagnostics_2723) => {
__wm_tail_143: while (true) {
{
const __wm_scalar_173_0 = pending_2720;
const __wm_scalar_173_1 = expressionRegistry_2721;
const __wm_scalar_173_2 = visited_2722;
const __wm_scalar_173_3 = diagnostics_2723;
if (__wm_scalar_173_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_173_1, expressionRegistry_2721) && __wm_eq(__wm_scalar_173_2, visited_2722) && __wm_eq(__wm_scalar_173_3, diagnostics_2723)) {

return diagnostics_2723;
} else if (__wm_scalar_173_0?.ctor === -6 && __wm_scalar_173_0.args.length === 1 && __wm_is_tuple(__wm_scalar_173_0.args[0]) && __wm_scalar_173_0.args[0].length === 2 && __wm_eq(__wm_scalar_173_1, expressionRegistry_2721) && __wm_eq(__wm_scalar_173_2, visited_2722) && __wm_eq(__wm_scalar_173_3, diagnostics_2723)) {
const expressionId_2724 = __wm_scalar_173_0.args[0][0];
const rest_2725 = __wm_scalar_173_0.args[0][1];
if (Map.has([visited_2722, expressionId_2724])) {
{
const __wm_tail_arg_168_0 = rest_2725;
const __wm_tail_arg_168_1 = expressionRegistry_2721;
const __wm_tail_arg_168_2 = visited_2722;
const __wm_tail_arg_168_3 = diagnostics_2723;
pending_2720 = __wm_tail_arg_168_0;
expressionRegistry_2721 = __wm_tail_arg_168_1;
visited_2722 = __wm_tail_arg_168_2;
diagnostics_2723 = __wm_tail_arg_168_3;
continue __wm_tail_143;
}
} else {
{
const nextVisited_2726 = Map.set([visited_2722, expressionId_2724, true]);
{
const __wm_tail_value_169 = Map.get([expressionRegistry_2721, expressionId_2724]);
if (__wm_tail_value_169 === __wm_basis_None) {

{
const __wm_tail_arg_170_0 = rest_2725;
const __wm_tail_arg_170_1 = expressionRegistry_2721;
const __wm_tail_arg_170_2 = nextVisited_2726;
const __wm_tail_arg_170_3 = diagnostics_2723;
pending_2720 = __wm_tail_arg_170_0;
expressionRegistry_2721 = __wm_tail_arg_170_1;
visited_2722 = __wm_tail_arg_170_2;
diagnostics_2723 = __wm_tail_arg_170_3;
continue __wm_tail_143;
}
} else if (__wm_tail_value_169?.ctor === -2 && __wm_tail_value_169.args.length === 1) {
const expression_2727 = __wm_tail_value_169.args[0];
{
const nextDiagnostics_2729 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const diagnostic_2728 = __v.args[0];
return __wm_basis_Cons([diagnostic_2728, diagnostics_2723]);
} else if (__v === __wm_basis_None) {

return diagnostics_2723;
}
__wm_fail("Match", "non-exhaustive match");
})(capabilityDiagnostic_2711(expression_2727));
{
const __wm_tail_arg_171_0 = prependAll_2698__wm_d2(Js.Array.toList(expression_2727.children), rest_2725);
const __wm_tail_arg_171_1 = expressionRegistry_2721;
const __wm_tail_arg_171_2 = nextVisited_2726;
const __wm_tail_arg_171_3 = nextDiagnostics_2729;
pending_2720 = __wm_tail_arg_171_0;
expressionRegistry_2721 = __wm_tail_arg_171_1;
visited_2722 = __wm_tail_arg_171_2;
diagnostics_2723 = __wm_tail_arg_171_3;
continue __wm_tail_143;
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
const reachableCapabilityDiagnostics_2719 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return reachableCapabilityDiagnostics_2719__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const duplicateFunctionDiagnostic_2732 = (__arg) => {
if (true) {
const fn_2730 = __arg;
const diagnostic_2731 = { code: "gpu.duplicate-function-id", message: "duplicate function ID in GPU elaboration input", spanId: fn_2730.spanId };
return diagnostic_2731;
}
__wm_fail("Match", "pattern match failure in function");
};
const registerFunctions_2733__wm_d3 = (functions_2734, registry_2735, diagnostics_2736) => {
__wm_tail_144: while (true) {
{
const __wm_scalar_174_0 = functions_2734;
const __wm_scalar_174_1 = registry_2735;
const __wm_scalar_174_2 = diagnostics_2736;
if (__wm_scalar_174_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_174_1, registry_2735) && __wm_eq(__wm_scalar_174_2, diagnostics_2736)) {

return [registry_2735, diagnostics_2736];
} else if (__wm_scalar_174_0?.ctor === -6 && __wm_scalar_174_0.args.length === 1 && __wm_is_tuple(__wm_scalar_174_0.args[0]) && __wm_scalar_174_0.args[0].length === 2 && __wm_eq(__wm_scalar_174_1, registry_2735) && __wm_eq(__wm_scalar_174_2, diagnostics_2736)) {
const fn_2737 = __wm_scalar_174_0.args[0][0];
const rest_2738 = __wm_scalar_174_0.args[0][1];
{
const exact_2739 = fn_2737;
if (Map.has([registry_2735, exact_2739.id])) {
{
const __wm_tail_arg_172_0 = rest_2738;
const __wm_tail_arg_172_1 = registry_2735;
const __wm_tail_arg_172_2 = __wm_basis_Cons([duplicateFunctionDiagnostic_2732(exact_2739), diagnostics_2736]);
functions_2734 = __wm_tail_arg_172_0;
registry_2735 = __wm_tail_arg_172_1;
diagnostics_2736 = __wm_tail_arg_172_2;
continue __wm_tail_144;
}
} else {
{
const __wm_tail_arg_173_0 = rest_2738;
const __wm_tail_arg_173_1 = Map.set([registry_2735, exact_2739.id, exact_2739]);
const __wm_tail_arg_173_2 = diagnostics_2736;
functions_2734 = __wm_tail_arg_173_0;
registry_2735 = __wm_tail_arg_173_1;
diagnostics_2736 = __wm_tail_arg_173_2;
continue __wm_tail_144;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const registerFunctions_2733 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return registerFunctions_2733__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const indexFunctionBindings_2740__wm_d2 = (functions_2741, registry_2742) => {
__wm_tail_145: while (true) {
{
const __wm_scalar_175_0 = functions_2741;
const __wm_scalar_175_1 = registry_2742;
if (__wm_scalar_175_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_175_1, registry_2742)) {

return registry_2742;
} else if (__wm_scalar_175_0?.ctor === -6 && __wm_scalar_175_0.args.length === 1 && __wm_is_tuple(__wm_scalar_175_0.args[0]) && __wm_scalar_175_0.args[0].length === 2 && __wm_eq(__wm_scalar_175_1, registry_2742)) {
const fn_2743 = __wm_scalar_175_0.args[0][0];
const rest_2744 = __wm_scalar_175_0.args[0][1];
{
const exact_2745 = fn_2743;
if ((exact_2745.bindingId < 0)) {
{
const __wm_tail_arg_174_0 = rest_2744;
const __wm_tail_arg_174_1 = registry_2742;
functions_2741 = __wm_tail_arg_174_0;
registry_2742 = __wm_tail_arg_174_1;
continue __wm_tail_145;
}
} else {
{
const __wm_tail_arg_175_0 = rest_2744;
const __wm_tail_arg_175_1 = Map.set([registry_2742, exact_2745.bindingId, exact_2745.id]);
functions_2741 = __wm_tail_arg_175_0;
registry_2742 = __wm_tail_arg_175_1;
continue __wm_tail_145;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexFunctionBindings_2740 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexFunctionBindings_2740__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const callDependency_2752__wm_d3 = (expression_2746, expressionRegistry_2747, bindingFunctions_2748) => {
if (__wm_eq(expression_2746.kind, "call")) {
const __wm_return_value_52 = Js.Array.toList(expression_2746.children);
if (__wm_return_value_52?.ctor === -6 && __wm_return_value_52.args.length === 1 && __wm_is_tuple(__wm_return_value_52.args[0]) && __wm_return_value_52.args[0].length === 2) {
const calleeId_2749 = __wm_return_value_52.args[0][0];
const _rest_2750 = __wm_return_value_52.args[0][1];
const __wm_return_value_53 = Map.get([expressionRegistry_2747, calleeId_2749]);
if (__wm_return_value_53?.ctor === -2 && __wm_return_value_53.args.length === 1) {
const callee_2751 = __wm_return_value_53.args[0];
return Map.get([bindingFunctions_2748, callee_2751.bindingId]);
} else if (__wm_return_value_53 === __wm_basis_None) {

return __wm_basis_None;
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_52 === __wm_basis_Nil) {

return __wm_basis_None;
}
__wm_fail("Match", "non-exhaustive match");
} else {
return __wm_basis_None;
}
};
const callDependency_2752 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return callDependency_2752__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const collectFunctionDependencies_2753__wm_d5 = (pending_2754, expressionRegistry_2755, bindingFunctions_2756, visited_2757, dependencies_2758) => {
__wm_tail_146: while (true) {
{
const __wm_scalar_176_0 = pending_2754;
const __wm_scalar_176_1 = expressionRegistry_2755;
const __wm_scalar_176_2 = bindingFunctions_2756;
const __wm_scalar_176_3 = visited_2757;
const __wm_scalar_176_4 = dependencies_2758;
if (__wm_scalar_176_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_176_1, expressionRegistry_2755) && __wm_eq(__wm_scalar_176_2, bindingFunctions_2756) && __wm_eq(__wm_scalar_176_3, visited_2757) && __wm_eq(__wm_scalar_176_4, dependencies_2758)) {

return dependencies_2758;
} else if (__wm_scalar_176_0?.ctor === -6 && __wm_scalar_176_0.args.length === 1 && __wm_is_tuple(__wm_scalar_176_0.args[0]) && __wm_scalar_176_0.args[0].length === 2 && __wm_eq(__wm_scalar_176_1, expressionRegistry_2755) && __wm_eq(__wm_scalar_176_2, bindingFunctions_2756) && __wm_eq(__wm_scalar_176_3, visited_2757) && __wm_eq(__wm_scalar_176_4, dependencies_2758)) {
const expressionId_2759 = __wm_scalar_176_0.args[0][0];
const rest_2760 = __wm_scalar_176_0.args[0][1];
if (Map.has([visited_2757, expressionId_2759])) {
{
const __wm_tail_arg_176_0 = rest_2760;
const __wm_tail_arg_176_1 = expressionRegistry_2755;
const __wm_tail_arg_176_2 = bindingFunctions_2756;
const __wm_tail_arg_176_3 = visited_2757;
const __wm_tail_arg_176_4 = dependencies_2758;
pending_2754 = __wm_tail_arg_176_0;
expressionRegistry_2755 = __wm_tail_arg_176_1;
bindingFunctions_2756 = __wm_tail_arg_176_2;
visited_2757 = __wm_tail_arg_176_3;
dependencies_2758 = __wm_tail_arg_176_4;
continue __wm_tail_146;
}
} else {
{
const nextVisited_2761 = Map.set([visited_2757, expressionId_2759, true]);
{
const __wm_tail_value_177 = Map.get([expressionRegistry_2755, expressionId_2759]);
if (__wm_tail_value_177 === __wm_basis_None) {

{
const __wm_tail_arg_178_0 = rest_2760;
const __wm_tail_arg_178_1 = expressionRegistry_2755;
const __wm_tail_arg_178_2 = bindingFunctions_2756;
const __wm_tail_arg_178_3 = nextVisited_2761;
const __wm_tail_arg_178_4 = dependencies_2758;
pending_2754 = __wm_tail_arg_178_0;
expressionRegistry_2755 = __wm_tail_arg_178_1;
bindingFunctions_2756 = __wm_tail_arg_178_2;
visited_2757 = __wm_tail_arg_178_3;
dependencies_2758 = __wm_tail_arg_178_4;
continue __wm_tail_146;
}
} else if (__wm_tail_value_177?.ctor === -2 && __wm_tail_value_177.args.length === 1) {
const expression_2762 = __wm_tail_value_177.args[0];
{
const nextDependencies_2764 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const functionId_2763 = __v.args[0];
return Map.set([dependencies_2758, functionId_2763, true]);
} else if (__v === __wm_basis_None) {

return dependencies_2758;
}
__wm_fail("Match", "non-exhaustive match");
})(callDependency_2752__wm_d3(expression_2762, expressionRegistry_2755, bindingFunctions_2756));
{
const __wm_tail_arg_179_0 = prependAll_2698__wm_d2(Js.Array.toList(expression_2762.children), rest_2760);
const __wm_tail_arg_179_1 = expressionRegistry_2755;
const __wm_tail_arg_179_2 = bindingFunctions_2756;
const __wm_tail_arg_179_3 = nextVisited_2761;
const __wm_tail_arg_179_4 = nextDependencies_2764;
pending_2754 = __wm_tail_arg_179_0;
expressionRegistry_2755 = __wm_tail_arg_179_1;
bindingFunctions_2756 = __wm_tail_arg_179_2;
visited_2757 = __wm_tail_arg_179_3;
dependencies_2758 = __wm_tail_arg_179_4;
continue __wm_tail_146;
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
const collectFunctionDependencies_2753 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return collectFunctionDependencies_2753__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const enqueueDependencies_2765__wm_d2 = (entries_2766, pending_2767) => {
__wm_tail_147: while (true) {
{
const __wm_scalar_177_0 = entries_2766;
const __wm_scalar_177_1 = pending_2767;
if (__wm_scalar_177_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_177_1, pending_2767)) {

return pending_2767;
} else if (__wm_scalar_177_0?.ctor === -6 && __wm_scalar_177_0.args.length === 1 && __wm_is_tuple(__wm_scalar_177_0.args[0]) && __wm_scalar_177_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_177_0.args[0][0]) && __wm_scalar_177_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_177_1, pending_2767)) {
const functionId_2768 = __wm_scalar_177_0.args[0][0][0];
const _reachable_2769 = __wm_scalar_177_0.args[0][0][1];
const rest_2770 = __wm_scalar_177_0.args[0][1];
{
const __wm_tail_arg_180_0 = rest_2770;
const __wm_tail_arg_180_1 = __wm_basis_Cons([functionId_2768, pending_2767]);
entries_2766 = __wm_tail_arg_180_0;
pending_2767 = __wm_tail_arg_180_1;
continue __wm_tail_147;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const enqueueDependencies_2765 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return enqueueDependencies_2765__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const rootFunctionIds_2771__wm_d2 = (roots_2772, functionIds_2773) => {
__wm_tail_148: while (true) {
{
const __wm_scalar_178_0 = roots_2772;
const __wm_scalar_178_1 = functionIds_2773;
if (__wm_scalar_178_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_178_1, functionIds_2773)) {

return functionIds_2773;
} else if (__wm_scalar_178_0?.ctor === -6 && __wm_scalar_178_0.args.length === 1 && __wm_is_tuple(__wm_scalar_178_0.args[0]) && __wm_scalar_178_0.args[0].length === 2 && __wm_eq(__wm_scalar_178_1, functionIds_2773)) {
const root_2774 = __wm_scalar_178_0.args[0][0];
const rest_2775 = __wm_scalar_178_0.args[0][1];
{
const __wm_tail_arg_181_0 = rest_2775;
const __wm_tail_arg_181_1 = __wm_basis_Cons([root_2774.functionId, functionIds_2773]);
roots_2772 = __wm_tail_arg_181_0;
functionIds_2773 = __wm_tail_arg_181_1;
continue __wm_tail_148;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const rootFunctionIds_2771 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return rootFunctionIds_2771__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const solveReachableFunctions_2776__wm_d5 = (pending_2777, functionRegistry_2778, expressionRegistry_2779, bindingFunctions_2780, reachable_2781) => {
__wm_tail_149: while (true) {
{
const __wm_scalar_179_0 = pending_2777;
const __wm_scalar_179_1 = functionRegistry_2778;
const __wm_scalar_179_2 = expressionRegistry_2779;
const __wm_scalar_179_3 = bindingFunctions_2780;
const __wm_scalar_179_4 = reachable_2781;
if (__wm_scalar_179_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_179_1, functionRegistry_2778) && __wm_eq(__wm_scalar_179_2, expressionRegistry_2779) && __wm_eq(__wm_scalar_179_3, bindingFunctions_2780) && __wm_eq(__wm_scalar_179_4, reachable_2781)) {

return reachable_2781;
} else if (__wm_scalar_179_0?.ctor === -6 && __wm_scalar_179_0.args.length === 1 && __wm_is_tuple(__wm_scalar_179_0.args[0]) && __wm_scalar_179_0.args[0].length === 2 && __wm_eq(__wm_scalar_179_1, functionRegistry_2778) && __wm_eq(__wm_scalar_179_2, expressionRegistry_2779) && __wm_eq(__wm_scalar_179_3, bindingFunctions_2780) && __wm_eq(__wm_scalar_179_4, reachable_2781)) {
const functionId_2782 = __wm_scalar_179_0.args[0][0];
const rest_2783 = __wm_scalar_179_0.args[0][1];
if (Map.has([reachable_2781, functionId_2782])) {
{
const __wm_tail_arg_182_0 = rest_2783;
const __wm_tail_arg_182_1 = functionRegistry_2778;
const __wm_tail_arg_182_2 = expressionRegistry_2779;
const __wm_tail_arg_182_3 = bindingFunctions_2780;
const __wm_tail_arg_182_4 = reachable_2781;
pending_2777 = __wm_tail_arg_182_0;
functionRegistry_2778 = __wm_tail_arg_182_1;
expressionRegistry_2779 = __wm_tail_arg_182_2;
bindingFunctions_2780 = __wm_tail_arg_182_3;
reachable_2781 = __wm_tail_arg_182_4;
continue __wm_tail_149;
}
} else {
{
const nextReachable_2784 = Map.set([reachable_2781, functionId_2782, true]);
{
const __wm_tail_value_183 = Map.get([functionRegistry_2778, functionId_2782]);
if (__wm_tail_value_183 === __wm_basis_None) {

{
const __wm_tail_arg_184_0 = rest_2783;
const __wm_tail_arg_184_1 = functionRegistry_2778;
const __wm_tail_arg_184_2 = expressionRegistry_2779;
const __wm_tail_arg_184_3 = bindingFunctions_2780;
const __wm_tail_arg_184_4 = nextReachable_2784;
pending_2777 = __wm_tail_arg_184_0;
functionRegistry_2778 = __wm_tail_arg_184_1;
expressionRegistry_2779 = __wm_tail_arg_184_2;
bindingFunctions_2780 = __wm_tail_arg_184_3;
reachable_2781 = __wm_tail_arg_184_4;
continue __wm_tail_149;
}
} else if (__wm_tail_value_183?.ctor === -2 && __wm_tail_value_183.args.length === 1) {
const fn_2785 = __wm_tail_value_183.args[0];
{
const dependencies_2786 = collectFunctionDependencies_2753__wm_d5(__wm_basis_Cons([fn_2785.bodyExprId, __wm_basis_Nil]), expressionRegistry_2779, bindingFunctions_2780, Map.empty(Map.numberCompare), Map.empty(Map.numberCompare));
{
const __wm_tail_arg_185_0 = enqueueDependencies_2765__wm_d2(Map.toList(dependencies_2786), rest_2783);
const __wm_tail_arg_185_1 = functionRegistry_2778;
const __wm_tail_arg_185_2 = expressionRegistry_2779;
const __wm_tail_arg_185_3 = bindingFunctions_2780;
const __wm_tail_arg_185_4 = nextReachable_2784;
pending_2777 = __wm_tail_arg_185_0;
functionRegistry_2778 = __wm_tail_arg_185_1;
expressionRegistry_2779 = __wm_tail_arg_185_2;
bindingFunctions_2780 = __wm_tail_arg_185_3;
reachable_2781 = __wm_tail_arg_185_4;
continue __wm_tail_149;
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
const solveReachableFunctions_2776 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return solveReachableFunctions_2776__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const indexBindings_2787__wm_d2 = (bindings_2788, registry_2789) => {
__wm_tail_150: while (true) {
{
const __wm_scalar_180_0 = bindings_2788;
const __wm_scalar_180_1 = registry_2789;
if (__wm_scalar_180_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_180_1, registry_2789)) {

return registry_2789;
} else if (__wm_scalar_180_0?.ctor === -6 && __wm_scalar_180_0.args.length === 1 && __wm_is_tuple(__wm_scalar_180_0.args[0]) && __wm_scalar_180_0.args[0].length === 2 && __wm_eq(__wm_scalar_180_1, registry_2789)) {
const binding_2790 = __wm_scalar_180_0.args[0][0];
const rest_2791 = __wm_scalar_180_0.args[0][1];
{
const exact_2792 = binding_2790;
{
const __wm_tail_arg_186_0 = rest_2791;
const __wm_tail_arg_186_1 = Map.set([registry_2789, exact_2792.id, exact_2792]);
bindings_2788 = __wm_tail_arg_186_0;
registry_2789 = __wm_tail_arg_186_1;
continue __wm_tail_150;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexBindings_2787 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexBindings_2787__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const bindParams_2793__wm_d2 = (params_2794, bound_2795) => {
__wm_tail_151: while (true) {
{
const __wm_scalar_181_0 = params_2794;
const __wm_scalar_181_1 = bound_2795;
if (__wm_scalar_181_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_181_1, bound_2795)) {

return bound_2795;
} else if (__wm_scalar_181_0?.ctor === -6 && __wm_scalar_181_0.args.length === 1 && __wm_is_tuple(__wm_scalar_181_0.args[0]) && __wm_scalar_181_0.args[0].length === 2 && __wm_eq(__wm_scalar_181_1, bound_2795)) {
const param_2796 = __wm_scalar_181_0.args[0][0];
const rest_2797 = __wm_scalar_181_0.args[0][1];
{
const exact_2798 = param_2796;
{
const __wm_tail_arg_187_0 = rest_2797;
const __wm_tail_arg_187_1 = Map.set([bound_2795, exact_2798.bindingId, true]);
params_2794 = __wm_tail_arg_187_0;
bound_2795 = __wm_tail_arg_187_1;
continue __wm_tail_151;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const bindParams_2793 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return bindParams_2793__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collectLocalBindings_2799__wm_d4 = (pending_2800, expressionRegistry_2801, visited_2802, bound_2803) => {
__wm_tail_152: while (true) {
{
const __wm_scalar_182_0 = pending_2800;
const __wm_scalar_182_1 = expressionRegistry_2801;
const __wm_scalar_182_2 = visited_2802;
const __wm_scalar_182_3 = bound_2803;
if (__wm_scalar_182_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_182_1, expressionRegistry_2801) && __wm_eq(__wm_scalar_182_2, visited_2802) && __wm_eq(__wm_scalar_182_3, bound_2803)) {

return bound_2803;
} else if (__wm_scalar_182_0?.ctor === -6 && __wm_scalar_182_0.args.length === 1 && __wm_is_tuple(__wm_scalar_182_0.args[0]) && __wm_scalar_182_0.args[0].length === 2 && __wm_eq(__wm_scalar_182_1, expressionRegistry_2801) && __wm_eq(__wm_scalar_182_2, visited_2802) && __wm_eq(__wm_scalar_182_3, bound_2803)) {
const expressionId_2804 = __wm_scalar_182_0.args[0][0];
const rest_2805 = __wm_scalar_182_0.args[0][1];
if (Map.has([visited_2802, expressionId_2804])) {
{
const __wm_tail_arg_188_0 = rest_2805;
const __wm_tail_arg_188_1 = expressionRegistry_2801;
const __wm_tail_arg_188_2 = visited_2802;
const __wm_tail_arg_188_3 = bound_2803;
pending_2800 = __wm_tail_arg_188_0;
expressionRegistry_2801 = __wm_tail_arg_188_1;
visited_2802 = __wm_tail_arg_188_2;
bound_2803 = __wm_tail_arg_188_3;
continue __wm_tail_152;
}
} else {
{
const nextVisited_2806 = Map.set([visited_2802, expressionId_2804, true]);
{
const __wm_tail_value_189 = Map.get([expressionRegistry_2801, expressionId_2804]);
if (__wm_tail_value_189 === __wm_basis_None) {

{
const __wm_tail_arg_190_0 = rest_2805;
const __wm_tail_arg_190_1 = expressionRegistry_2801;
const __wm_tail_arg_190_2 = nextVisited_2806;
const __wm_tail_arg_190_3 = bound_2803;
pending_2800 = __wm_tail_arg_190_0;
expressionRegistry_2801 = __wm_tail_arg_190_1;
visited_2802 = __wm_tail_arg_190_2;
bound_2803 = __wm_tail_arg_190_3;
continue __wm_tail_152;
}
} else if (__wm_tail_value_189?.ctor === -2 && __wm_tail_value_189.args.length === 1) {
const expression_2807 = __wm_tail_value_189.args[0];
{
const exact_2808 = expression_2807;
const nextBound_2809 = (__wm_op_and_d2(__wm_eq(exact_2808.kind, "let"), (exact_2808.bindingId >= 0)) ? Map.set([bound_2803, exact_2808.bindingId, true]) : bound_2803);
{
const __wm_tail_arg_191_0 = prependAll_2698__wm_d2(Js.Array.toList(exact_2808.children), rest_2805);
const __wm_tail_arg_191_1 = expressionRegistry_2801;
const __wm_tail_arg_191_2 = nextVisited_2806;
const __wm_tail_arg_191_3 = nextBound_2809;
pending_2800 = __wm_tail_arg_191_0;
expressionRegistry_2801 = __wm_tail_arg_191_1;
visited_2802 = __wm_tail_arg_191_2;
bound_2803 = __wm_tail_arg_191_3;
continue __wm_tail_152;
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
const collectLocalBindings_2799 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return collectLocalBindings_2799__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const constantExpression_2810__wm_d5 = (expressionId_2812, expressionRegistry_2813, bindingRegistry_2814, visitedExpressions_2815, visitedBindings_2816) => {
__wm_tail_153: while (true) {
if (Map.has([visitedExpressions_2815, expressionId_2812])) {
return false;
} else {
{
const __wm_tail_value_192 = Map.get([expressionRegistry_2813, expressionId_2812]);
if (__wm_tail_value_192 === __wm_basis_None) {

return false;
} else if (__wm_tail_value_192?.ctor === -2 && __wm_tail_value_192.args.length === 1) {
const expression_2817 = __wm_tail_value_192.args[0];
{
const nextExpressions_2818 = Map.set([visitedExpressions_2815, expressionId_2812, true]);
if (__wm_op_or_d2(__wm_eq(expression_2817.kind, "number"), __wm_eq(expression_2817.kind, "bool"))) {
return true;
} else {
if (__wm_op_or_d2(__wm_op_or_d2(__wm_eq(expression_2817.kind, "tuple"), __wm_eq(expression_2817.kind, "binary")), __wm_eq(expression_2817.kind, "unary"))) {
return constantExpressions_2811__wm_d5(Js.Array.toList(expression_2817.children), expressionRegistry_2813, bindingRegistry_2814, nextExpressions_2818, visitedBindings_2816);
} else {
if (__wm_op_and_d2(__wm_eq(expression_2817.kind, "var"), (expression_2817.bindingId >= 0))) {
if (Map.has([visitedBindings_2816, expression_2817.bindingId])) {
return false;
} else {
{
const __wm_tail_value_193 = Map.get([bindingRegistry_2814, expression_2817.bindingId]);
if (__wm_tail_value_193?.ctor === -2 && __wm_tail_value_193.args.length === 1) {
const binding_2819 = __wm_tail_value_193.args[0];
if ((binding_2819.definitionExprId >= 0)) {
{
const __wm_tail_arg_194_0 = binding_2819.definitionExprId;
const __wm_tail_arg_194_1 = expressionRegistry_2813;
const __wm_tail_arg_194_2 = bindingRegistry_2814;
const __wm_tail_arg_194_3 = nextExpressions_2818;
const __wm_tail_arg_194_4 = Map.set([visitedBindings_2816, expression_2817.bindingId, true]);
expressionId_2812 = __wm_tail_arg_194_0;
expressionRegistry_2813 = __wm_tail_arg_194_1;
bindingRegistry_2814 = __wm_tail_arg_194_2;
visitedExpressions_2815 = __wm_tail_arg_194_3;
visitedBindings_2816 = __wm_tail_arg_194_4;
continue __wm_tail_153;
}
} else {
return false;
}
} else if (__wm_tail_value_193 === __wm_basis_None) {

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
const constantExpression_2810 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return constantExpression_2810__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const constantExpressions_2811__wm_d5 = (pending_2820, expressionRegistry_2821, bindingRegistry_2822, visitedExpressions_2823, visitedBindings_2824) => {
const __wm_scalar_183_0 = pending_2820;
const __wm_scalar_183_1 = expressionRegistry_2821;
const __wm_scalar_183_2 = bindingRegistry_2822;
const __wm_scalar_183_3 = visitedExpressions_2823;
const __wm_scalar_183_4 = visitedBindings_2824;
if (__wm_scalar_183_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_183_1, expressionRegistry_2821) && __wm_eq(__wm_scalar_183_2, bindingRegistry_2822) && __wm_eq(__wm_scalar_183_3, visitedExpressions_2823) && __wm_eq(__wm_scalar_183_4, visitedBindings_2824)) {

return true;
} else if (__wm_scalar_183_0?.ctor === -6 && __wm_scalar_183_0.args.length === 1 && __wm_is_tuple(__wm_scalar_183_0.args[0]) && __wm_scalar_183_0.args[0].length === 2 && __wm_eq(__wm_scalar_183_1, expressionRegistry_2821) && __wm_eq(__wm_scalar_183_2, bindingRegistry_2822) && __wm_eq(__wm_scalar_183_3, visitedExpressions_2823) && __wm_eq(__wm_scalar_183_4, visitedBindings_2824)) {
const expressionId_2825 = __wm_scalar_183_0.args[0][0];
const rest_2826 = __wm_scalar_183_0.args[0][1];
return __wm_op_and_d2(constantExpression_2810__wm_d5(expressionId_2825, expressionRegistry_2821, bindingRegistry_2822, visitedExpressions_2823, visitedBindings_2824), constantExpressions_2811__wm_d5(rest_2826, expressionRegistry_2821, bindingRegistry_2822, visitedExpressions_2823, visitedBindings_2824));
}
__wm_fail("Match", "non-exhaustive match");
};
const constantExpressions_2811 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return constantExpressions_2811__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const reifiableCaptureType_2831__wm_d2 = (typeRegistry_2827, typeId_2828) => {
const __wm_return_value_54 = Map.get([typeRegistry_2827, typeId_2828]);
if (__wm_return_value_54?.ctor === -2 && __wm_return_value_54.args.length === 1) {
const gpuType_2829 = __wm_return_value_54.args[0];
const exact_2830 = gpuType_2829;
return __wm_op_or_d2(__wm_op_or_d2(__wm_eq(exact_2830.kind, "number"), __wm_eq(exact_2830.kind, "bool")), __wm_eq(exact_2830.kind, "vector"));
} else if (__wm_return_value_54 === __wm_basis_None) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
};
const reifiableCaptureType_2831 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reifiableCaptureType_2831__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const captureCategory_2842__wm_d7 = (bindingId_2832, typeId_2833, reachable_2834, bindingFunctions_2835, bindingRegistry_2836, expressionRegistry_2837, typeRegistry_2838) => {
const __wm_return_value_55 = Map.get([bindingFunctions_2835, bindingId_2832]);
if (__wm_return_value_55?.ctor === -2 && __wm_return_value_55.args.length === 1) {
const functionId_2839 = __wm_return_value_55.args[0];
if (Map.has([reachable_2834, functionId_2839])) {
return "function";
} else {
return "illegal";
}
} else if (__wm_return_value_55 === __wm_basis_None) {

if (reifiableCaptureType_2831__wm_d2(typeRegistry_2838, typeId_2833)) {
const __wm_return_value_56 = Map.get([bindingRegistry_2836, bindingId_2832]);
if (__wm_return_value_56?.ctor === -2 && __wm_return_value_56.args.length === 1) {
const binding_2840 = __wm_return_value_56.args[0];
const exactBinding_2841 = binding_2840;
if (__wm_op_and_d2((exactBinding_2841.definitionExprId >= 0), constantExpression_2810__wm_d5(exactBinding_2841.definitionExprId, expressionRegistry_2837, bindingRegistry_2836, Map.empty(Map.numberCompare), Map.empty(Map.numberCompare)))) {
return "constant";
} else {
return "uniform";
}
} else if (__wm_return_value_56 === __wm_basis_None) {

return "illegal";
}
__wm_fail("Match", "non-exhaustive match");
} else {
return "illegal";
}
}
__wm_fail("Match", "non-exhaustive match");
};
const captureCategory_2842 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return captureCategory_2842__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const collectFunctionCaptures_2843__wm_d10 = (pending_2844, regionId_2845, reachable_2846, bound_2847, expressionRegistry_2848, bindingFunctions_2849, bindingRegistry_2850, typeRegistry_2851, visited_2852, captures_2853) => {
__wm_tail_154: while (true) {
{
const __wm_scalar_184_0 = pending_2844;
const __wm_scalar_184_1 = regionId_2845;
const __wm_scalar_184_2 = reachable_2846;
const __wm_scalar_184_3 = bound_2847;
const __wm_scalar_184_4 = expressionRegistry_2848;
const __wm_scalar_184_5 = bindingFunctions_2849;
const __wm_scalar_184_6 = bindingRegistry_2850;
const __wm_scalar_184_7 = typeRegistry_2851;
const __wm_scalar_184_8 = visited_2852;
const __wm_scalar_184_9 = captures_2853;
if (__wm_scalar_184_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_184_1, regionId_2845) && __wm_eq(__wm_scalar_184_2, reachable_2846) && __wm_eq(__wm_scalar_184_3, bound_2847) && __wm_eq(__wm_scalar_184_4, expressionRegistry_2848) && __wm_eq(__wm_scalar_184_5, bindingFunctions_2849) && __wm_eq(__wm_scalar_184_6, bindingRegistry_2850) && __wm_eq(__wm_scalar_184_7, typeRegistry_2851) && __wm_eq(__wm_scalar_184_8, visited_2852) && __wm_eq(__wm_scalar_184_9, captures_2853)) {

return captures_2853;
} else if (__wm_scalar_184_0?.ctor === -6 && __wm_scalar_184_0.args.length === 1 && __wm_is_tuple(__wm_scalar_184_0.args[0]) && __wm_scalar_184_0.args[0].length === 2 && __wm_eq(__wm_scalar_184_1, regionId_2845) && __wm_eq(__wm_scalar_184_2, reachable_2846) && __wm_eq(__wm_scalar_184_3, bound_2847) && __wm_eq(__wm_scalar_184_4, expressionRegistry_2848) && __wm_eq(__wm_scalar_184_5, bindingFunctions_2849) && __wm_eq(__wm_scalar_184_6, bindingRegistry_2850) && __wm_eq(__wm_scalar_184_7, typeRegistry_2851) && __wm_eq(__wm_scalar_184_8, visited_2852) && __wm_eq(__wm_scalar_184_9, captures_2853)) {
const expressionId_2854 = __wm_scalar_184_0.args[0][0];
const rest_2855 = __wm_scalar_184_0.args[0][1];
if (Map.has([visited_2852, expressionId_2854])) {
{
const __wm_tail_arg_195_0 = rest_2855;
const __wm_tail_arg_195_1 = regionId_2845;
const __wm_tail_arg_195_2 = reachable_2846;
const __wm_tail_arg_195_3 = bound_2847;
const __wm_tail_arg_195_4 = expressionRegistry_2848;
const __wm_tail_arg_195_5 = bindingFunctions_2849;
const __wm_tail_arg_195_6 = bindingRegistry_2850;
const __wm_tail_arg_195_7 = typeRegistry_2851;
const __wm_tail_arg_195_8 = visited_2852;
const __wm_tail_arg_195_9 = captures_2853;
pending_2844 = __wm_tail_arg_195_0;
regionId_2845 = __wm_tail_arg_195_1;
reachable_2846 = __wm_tail_arg_195_2;
bound_2847 = __wm_tail_arg_195_3;
expressionRegistry_2848 = __wm_tail_arg_195_4;
bindingFunctions_2849 = __wm_tail_arg_195_5;
bindingRegistry_2850 = __wm_tail_arg_195_6;
typeRegistry_2851 = __wm_tail_arg_195_7;
visited_2852 = __wm_tail_arg_195_8;
captures_2853 = __wm_tail_arg_195_9;
continue __wm_tail_154;
}
} else {
{
const nextVisited_2856 = Map.set([visited_2852, expressionId_2854, true]);
{
const __wm_tail_value_196 = Map.get([expressionRegistry_2848, expressionId_2854]);
if (__wm_tail_value_196 === __wm_basis_None) {

{
const __wm_tail_arg_197_0 = rest_2855;
const __wm_tail_arg_197_1 = regionId_2845;
const __wm_tail_arg_197_2 = reachable_2846;
const __wm_tail_arg_197_3 = bound_2847;
const __wm_tail_arg_197_4 = expressionRegistry_2848;
const __wm_tail_arg_197_5 = bindingFunctions_2849;
const __wm_tail_arg_197_6 = bindingRegistry_2850;
const __wm_tail_arg_197_7 = typeRegistry_2851;
const __wm_tail_arg_197_8 = nextVisited_2856;
const __wm_tail_arg_197_9 = captures_2853;
pending_2844 = __wm_tail_arg_197_0;
regionId_2845 = __wm_tail_arg_197_1;
reachable_2846 = __wm_tail_arg_197_2;
bound_2847 = __wm_tail_arg_197_3;
expressionRegistry_2848 = __wm_tail_arg_197_4;
bindingFunctions_2849 = __wm_tail_arg_197_5;
bindingRegistry_2850 = __wm_tail_arg_197_6;
typeRegistry_2851 = __wm_tail_arg_197_7;
visited_2852 = __wm_tail_arg_197_8;
captures_2853 = __wm_tail_arg_197_9;
continue __wm_tail_154;
}
} else if (__wm_tail_value_196?.ctor === -2 && __wm_tail_value_196.args.length === 1) {
const expression_2857 = __wm_tail_value_196.args[0];
{
const exactExpression_2858 = expression_2857;
const captureTypeId_2861 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const binding_2859 = __v.args[0];
const exactBinding_2860 = binding_2859;
return exactBinding_2860.typeId;
} else if (__v === __wm_basis_None) {

return exactExpression_2858.typeId;
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([bindingRegistry_2850, exactExpression_2858.bindingId]));
const nextCaptures_2863 = (__wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(__wm_eq(exactExpression_2858.kind, "var"), (exactExpression_2858.bindingId >= 0)), __wm_op_not(Map.has([bound_2847, exactExpression_2858.bindingId]))), __wm_op_not(Map.has([captures_2853, exactExpression_2858.bindingId]))) ? (() => {
const capture_2862 = { regionId: regionId_2845, bindingId: exactExpression_2858.bindingId, typeId: captureTypeId_2861, spanId: exactExpression_2858.spanId, category: captureCategory_2842__wm_d7(exactExpression_2858.bindingId, captureTypeId_2861, reachable_2846, bindingFunctions_2849, bindingRegistry_2850, expressionRegistry_2848, typeRegistry_2851) };
return Map.set([captures_2853, exactExpression_2858.bindingId, capture_2862]);
})() : captures_2853);
{
const __wm_tail_arg_198_0 = prependAll_2698__wm_d2(Js.Array.toList(exactExpression_2858.children), rest_2855);
const __wm_tail_arg_198_1 = regionId_2845;
const __wm_tail_arg_198_2 = reachable_2846;
const __wm_tail_arg_198_3 = bound_2847;
const __wm_tail_arg_198_4 = expressionRegistry_2848;
const __wm_tail_arg_198_5 = bindingFunctions_2849;
const __wm_tail_arg_198_6 = bindingRegistry_2850;
const __wm_tail_arg_198_7 = typeRegistry_2851;
const __wm_tail_arg_198_8 = nextVisited_2856;
const __wm_tail_arg_198_9 = nextCaptures_2863;
pending_2844 = __wm_tail_arg_198_0;
regionId_2845 = __wm_tail_arg_198_1;
reachable_2846 = __wm_tail_arg_198_2;
bound_2847 = __wm_tail_arg_198_3;
expressionRegistry_2848 = __wm_tail_arg_198_4;
bindingFunctions_2849 = __wm_tail_arg_198_5;
bindingRegistry_2850 = __wm_tail_arg_198_6;
typeRegistry_2851 = __wm_tail_arg_198_7;
visited_2852 = __wm_tail_arg_198_8;
captures_2853 = __wm_tail_arg_198_9;
continue __wm_tail_154;
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
const collectFunctionCaptures_2843 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return collectFunctionCaptures_2843__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
const collectReachableCaptures_2864__wm_d9 = (functionEntries_2865, regionId_2866, reachable_2867, functionRegistry_2868, expressionRegistry_2869, bindingFunctions_2870, bindingRegistry_2871, typeRegistry_2872, captures_2873) => {
__wm_tail_155: while (true) {
{
const __wm_scalar_185_0 = functionEntries_2865;
const __wm_scalar_185_1 = regionId_2866;
const __wm_scalar_185_2 = reachable_2867;
const __wm_scalar_185_3 = functionRegistry_2868;
const __wm_scalar_185_4 = expressionRegistry_2869;
const __wm_scalar_185_5 = bindingFunctions_2870;
const __wm_scalar_185_6 = bindingRegistry_2871;
const __wm_scalar_185_7 = typeRegistry_2872;
const __wm_scalar_185_8 = captures_2873;
if (__wm_scalar_185_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_185_1, regionId_2866) && __wm_eq(__wm_scalar_185_2, reachable_2867) && __wm_eq(__wm_scalar_185_3, functionRegistry_2868) && __wm_eq(__wm_scalar_185_4, expressionRegistry_2869) && __wm_eq(__wm_scalar_185_5, bindingFunctions_2870) && __wm_eq(__wm_scalar_185_6, bindingRegistry_2871) && __wm_eq(__wm_scalar_185_7, typeRegistry_2872) && __wm_eq(__wm_scalar_185_8, captures_2873)) {

return captures_2873;
} else if (__wm_scalar_185_0?.ctor === -6 && __wm_scalar_185_0.args.length === 1 && __wm_is_tuple(__wm_scalar_185_0.args[0]) && __wm_scalar_185_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_185_0.args[0][0]) && __wm_scalar_185_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_185_1, regionId_2866) && __wm_eq(__wm_scalar_185_2, reachable_2867) && __wm_eq(__wm_scalar_185_3, functionRegistry_2868) && __wm_eq(__wm_scalar_185_4, expressionRegistry_2869) && __wm_eq(__wm_scalar_185_5, bindingFunctions_2870) && __wm_eq(__wm_scalar_185_6, bindingRegistry_2871) && __wm_eq(__wm_scalar_185_7, typeRegistry_2872) && __wm_eq(__wm_scalar_185_8, captures_2873)) {
const functionId_2874 = __wm_scalar_185_0.args[0][0][0];
const _present_2875 = __wm_scalar_185_0.args[0][0][1];
const rest_2876 = __wm_scalar_185_0.args[0][1];
{
const __wm_tail_value_199 = Map.get([functionRegistry_2868, functionId_2874]);
if (__wm_tail_value_199 === __wm_basis_None) {

{
const __wm_tail_arg_200_0 = rest_2876;
const __wm_tail_arg_200_1 = regionId_2866;
const __wm_tail_arg_200_2 = reachable_2867;
const __wm_tail_arg_200_3 = functionRegistry_2868;
const __wm_tail_arg_200_4 = expressionRegistry_2869;
const __wm_tail_arg_200_5 = bindingFunctions_2870;
const __wm_tail_arg_200_6 = bindingRegistry_2871;
const __wm_tail_arg_200_7 = typeRegistry_2872;
const __wm_tail_arg_200_8 = captures_2873;
functionEntries_2865 = __wm_tail_arg_200_0;
regionId_2866 = __wm_tail_arg_200_1;
reachable_2867 = __wm_tail_arg_200_2;
functionRegistry_2868 = __wm_tail_arg_200_3;
expressionRegistry_2869 = __wm_tail_arg_200_4;
bindingFunctions_2870 = __wm_tail_arg_200_5;
bindingRegistry_2871 = __wm_tail_arg_200_6;
typeRegistry_2872 = __wm_tail_arg_200_7;
captures_2873 = __wm_tail_arg_200_8;
continue __wm_tail_155;
}
} else if (__wm_tail_value_199?.ctor === -2 && __wm_tail_value_199.args.length === 1) {
const fn_2877 = __wm_tail_value_199.args[0];
{
const paramBound_2878 = bindParams_2793__wm_d2(Js.Array.toList(fn_2877.params), Map.empty(Map.numberCompare));
const bound_2879 = collectLocalBindings_2799__wm_d4(__wm_basis_Cons([fn_2877.bodyExprId, __wm_basis_Nil]), expressionRegistry_2869, Map.empty(Map.numberCompare), paramBound_2878);
const nextCaptures_2880 = collectFunctionCaptures_2843__wm_d10(__wm_basis_Cons([fn_2877.bodyExprId, __wm_basis_Nil]), regionId_2866, reachable_2867, bound_2879, expressionRegistry_2869, bindingFunctions_2870, bindingRegistry_2871, typeRegistry_2872, Map.empty(Map.numberCompare), captures_2873);
{
const __wm_tail_arg_201_0 = rest_2876;
const __wm_tail_arg_201_1 = regionId_2866;
const __wm_tail_arg_201_2 = reachable_2867;
const __wm_tail_arg_201_3 = functionRegistry_2868;
const __wm_tail_arg_201_4 = expressionRegistry_2869;
const __wm_tail_arg_201_5 = bindingFunctions_2870;
const __wm_tail_arg_201_6 = bindingRegistry_2871;
const __wm_tail_arg_201_7 = typeRegistry_2872;
const __wm_tail_arg_201_8 = nextCaptures_2880;
functionEntries_2865 = __wm_tail_arg_201_0;
regionId_2866 = __wm_tail_arg_201_1;
reachable_2867 = __wm_tail_arg_201_2;
functionRegistry_2868 = __wm_tail_arg_201_3;
expressionRegistry_2869 = __wm_tail_arg_201_4;
bindingFunctions_2870 = __wm_tail_arg_201_5;
bindingRegistry_2871 = __wm_tail_arg_201_6;
typeRegistry_2872 = __wm_tail_arg_201_7;
captures_2873 = __wm_tail_arg_201_8;
continue __wm_tail_155;
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
const collectReachableCaptures_2864 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return collectReachableCaptures_2864__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const captureValues_2881__wm_d2 = (entries_2882, captures_2883) => {
__wm_tail_156: while (true) {
{
const __wm_scalar_186_0 = entries_2882;
const __wm_scalar_186_1 = captures_2883;
if (__wm_scalar_186_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_186_1, captures_2883)) {

return captures_2883;
} else if (__wm_scalar_186_0?.ctor === -6 && __wm_scalar_186_0.args.length === 1 && __wm_is_tuple(__wm_scalar_186_0.args[0]) && __wm_scalar_186_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_186_0.args[0][0]) && __wm_scalar_186_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_186_1, captures_2883)) {
const _bindingId_2884 = __wm_scalar_186_0.args[0][0][0];
const capture_2885 = __wm_scalar_186_0.args[0][0][1];
const rest_2886 = __wm_scalar_186_0.args[0][1];
{
const __wm_tail_arg_202_0 = rest_2886;
const __wm_tail_arg_202_1 = __wm_basis_Cons([capture_2885, captures_2883]);
entries_2882 = __wm_tail_arg_202_0;
captures_2883 = __wm_tail_arg_202_1;
continue __wm_tail_156;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const captureValues_2881 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return captureValues_2881__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const rootCaptures_2887__wm_d7 = (roots_2888, functionRegistry_2889, expressionRegistry_2890, bindingFunctions_2891, bindingRegistry_2892, typeRegistry_2893, captures_2894) => {
__wm_tail_157: while (true) {
{
const __wm_scalar_187_0 = roots_2888;
const __wm_scalar_187_1 = functionRegistry_2889;
const __wm_scalar_187_2 = expressionRegistry_2890;
const __wm_scalar_187_3 = bindingFunctions_2891;
const __wm_scalar_187_4 = bindingRegistry_2892;
const __wm_scalar_187_5 = typeRegistry_2893;
const __wm_scalar_187_6 = captures_2894;
if (__wm_scalar_187_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_187_1, functionRegistry_2889) && __wm_eq(__wm_scalar_187_2, expressionRegistry_2890) && __wm_eq(__wm_scalar_187_3, bindingFunctions_2891) && __wm_eq(__wm_scalar_187_4, bindingRegistry_2892) && __wm_eq(__wm_scalar_187_5, typeRegistry_2893) && __wm_eq(__wm_scalar_187_6, captures_2894)) {

return captures_2894;
} else if (__wm_scalar_187_0?.ctor === -6 && __wm_scalar_187_0.args.length === 1 && __wm_is_tuple(__wm_scalar_187_0.args[0]) && __wm_scalar_187_0.args[0].length === 2 && __wm_eq(__wm_scalar_187_1, functionRegistry_2889) && __wm_eq(__wm_scalar_187_2, expressionRegistry_2890) && __wm_eq(__wm_scalar_187_3, bindingFunctions_2891) && __wm_eq(__wm_scalar_187_4, bindingRegistry_2892) && __wm_eq(__wm_scalar_187_5, typeRegistry_2893) && __wm_eq(__wm_scalar_187_6, captures_2894)) {
const root_2895 = __wm_scalar_187_0.args[0][0];
const rest_2896 = __wm_scalar_187_0.args[0][1];
{
const gpuRoot_2897 = root_2895;
const reachable_2898 = solveReachableFunctions_2776__wm_d5(__wm_basis_Cons([gpuRoot_2897.functionId, __wm_basis_Nil]), functionRegistry_2889, expressionRegistry_2890, bindingFunctions_2891, Map.empty(Map.numberCompare));
const rootCaptureRegistry_2899 = collectReachableCaptures_2864__wm_d9(Map.toList(reachable_2898), gpuRoot_2897.regionId, reachable_2898, functionRegistry_2889, expressionRegistry_2890, bindingFunctions_2891, bindingRegistry_2892, typeRegistry_2893, Map.empty(Map.numberCompare));
{
const __wm_tail_arg_203_0 = rest_2896;
const __wm_tail_arg_203_1 = functionRegistry_2889;
const __wm_tail_arg_203_2 = expressionRegistry_2890;
const __wm_tail_arg_203_3 = bindingFunctions_2891;
const __wm_tail_arg_203_4 = bindingRegistry_2892;
const __wm_tail_arg_203_5 = typeRegistry_2893;
const __wm_tail_arg_203_6 = prependAll_2698__wm_d2(captureValues_2881__wm_d2(Map.toList(rootCaptureRegistry_2899), __wm_basis_Nil), captures_2894);
roots_2888 = __wm_tail_arg_203_0;
functionRegistry_2889 = __wm_tail_arg_203_1;
expressionRegistry_2890 = __wm_tail_arg_203_2;
bindingFunctions_2891 = __wm_tail_arg_203_3;
bindingRegistry_2892 = __wm_tail_arg_203_4;
typeRegistry_2893 = __wm_tail_arg_203_5;
captures_2894 = __wm_tail_arg_203_6;
continue __wm_tail_157;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const rootCaptures_2887 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return rootCaptures_2887__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const illegalCaptureDiagnostic_2902 = (__arg) => {
if (true) {
const capture_2900 = __arg;
const diagnostic_2901 = { code: "gpu.illegal-capture", message: "captured value is not available to the GPU as a constant, uniform, resource, or function", spanId: capture_2900.spanId };
return diagnostic_2901;
}
__wm_fail("Match", "pattern match failure in function");
};
const captureDiagnostics_2903__wm_d2 = (captures_2904, diagnostics_2905) => {
__wm_tail_158: while (true) {
{
const __wm_scalar_188_0 = captures_2904;
const __wm_scalar_188_1 = diagnostics_2905;
if (__wm_scalar_188_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_188_1, diagnostics_2905)) {

return diagnostics_2905;
} else if (__wm_scalar_188_0?.ctor === -6 && __wm_scalar_188_0.args.length === 1 && __wm_is_tuple(__wm_scalar_188_0.args[0]) && __wm_scalar_188_0.args[0].length === 2 && __wm_eq(__wm_scalar_188_1, diagnostics_2905)) {
const capture_2906 = __wm_scalar_188_0.args[0][0];
const rest_2907 = __wm_scalar_188_0.args[0][1];
{
const exact_2908 = capture_2906;
if (__wm_eq(exact_2908.category, "illegal")) {
{
const __wm_tail_arg_204_0 = rest_2907;
const __wm_tail_arg_204_1 = __wm_basis_Cons([illegalCaptureDiagnostic_2902(exact_2908), diagnostics_2905]);
captures_2904 = __wm_tail_arg_204_0;
diagnostics_2905 = __wm_tail_arg_204_1;
continue __wm_tail_158;
}
} else {
{
const __wm_tail_arg_205_0 = rest_2907;
const __wm_tail_arg_205_1 = diagnostics_2905;
captures_2904 = __wm_tail_arg_205_0;
diagnostics_2905 = __wm_tail_arg_205_1;
continue __wm_tail_158;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const captureDiagnostics_2903 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return captureDiagnostics_2903__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const indexExpressions_2909__wm_d2 = (expressions_2910, registry_2911) => {
__wm_tail_159: while (true) {
{
const __wm_scalar_189_0 = expressions_2910;
const __wm_scalar_189_1 = registry_2911;
if (__wm_scalar_189_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_189_1, registry_2911)) {

return registry_2911;
} else if (__wm_scalar_189_0?.ctor === -6 && __wm_scalar_189_0.args.length === 1 && __wm_is_tuple(__wm_scalar_189_0.args[0]) && __wm_scalar_189_0.args[0].length === 2 && __wm_eq(__wm_scalar_189_1, registry_2911)) {
const expression_2912 = __wm_scalar_189_0.args[0][0];
const rest_2913 = __wm_scalar_189_0.args[0][1];
{
const exact_2914 = expression_2912;
{
const __wm_tail_arg_206_0 = rest_2913;
const __wm_tail_arg_206_1 = Map.set([registry_2911, exact_2914.id, exact_2914]);
expressions_2910 = __wm_tail_arg_206_0;
registry_2911 = __wm_tail_arg_206_1;
continue __wm_tail_159;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexExpressions_2909 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexExpressions_2909__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const indexTypes_2915__wm_d2 = (types_2916, registry_2917) => {
__wm_tail_160: while (true) {
{
const __wm_scalar_190_0 = types_2916;
const __wm_scalar_190_1 = registry_2917;
if (__wm_scalar_190_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_190_1, registry_2917)) {

return registry_2917;
} else if (__wm_scalar_190_0?.ctor === -6 && __wm_scalar_190_0.args.length === 1 && __wm_is_tuple(__wm_scalar_190_0.args[0]) && __wm_scalar_190_0.args[0].length === 2 && __wm_eq(__wm_scalar_190_1, registry_2917)) {
const gpuType_2918 = __wm_scalar_190_0.args[0][0];
const rest_2919 = __wm_scalar_190_0.args[0][1];
{
const exact_2920 = gpuType_2918;
{
const __wm_tail_arg_207_0 = rest_2919;
const __wm_tail_arg_207_1 = Map.set([registry_2917, exact_2920.id, exact_2920]);
types_2916 = __wm_tail_arg_207_0;
registry_2917 = __wm_tail_arg_207_1;
continue __wm_tail_160;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexTypes_2915 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexTypes_2915__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const representationOf_2924__wm_d2 = (registry_2921, typeId_2922) => {
const __wm_return_value_57 = Map.get([registry_2921, typeId_2922]);
if (__wm_return_value_57?.ctor === -2 && __wm_return_value_57.args.length === 1) {
const representation_2923 = __wm_return_value_57.args[0];
return representation_2923;
} else if (__wm_return_value_57 === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const representationOf_2924 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return representationOf_2924__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const joinRepresentation_2927__wm_d2 = (left_2925, right_2926) => {
if (__wm_op_or_d2(__wm_eq(left_2925, "f32"), __wm_eq(right_2926, "f32"))) {
return "f32";
} else {
if (__wm_op_or_d2(__wm_eq(left_2925, "i32"), __wm_eq(right_2926, "i32"))) {
return "i32";
} else {
return "";
}
}
};
const joinRepresentation_2927 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return joinRepresentation_2927__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const combinedRepresentation_2928__wm_d3 = (typeIds_2929, registry_2930, combined_2931) => {
__wm_tail_161: while (true) {
{
const __wm_scalar_191_0 = typeIds_2929;
const __wm_scalar_191_1 = registry_2930;
const __wm_scalar_191_2 = combined_2931;
if (__wm_scalar_191_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_191_1, registry_2930) && __wm_eq(__wm_scalar_191_2, combined_2931)) {

return combined_2931;
} else if (__wm_scalar_191_0?.ctor === -6 && __wm_scalar_191_0.args.length === 1 && __wm_is_tuple(__wm_scalar_191_0.args[0]) && __wm_scalar_191_0.args[0].length === 2 && __wm_eq(__wm_scalar_191_1, registry_2930) && __wm_eq(__wm_scalar_191_2, combined_2931)) {
const typeId_2932 = __wm_scalar_191_0.args[0][0];
const rest_2933 = __wm_scalar_191_0.args[0][1];
{
const __wm_tail_arg_208_0 = rest_2933;
const __wm_tail_arg_208_1 = registry_2930;
const __wm_tail_arg_208_2 = joinRepresentation_2927__wm_d2(combined_2931, representationOf_2924__wm_d2(registry_2930, typeId_2932));
typeIds_2929 = __wm_tail_arg_208_0;
registry_2930 = __wm_tail_arg_208_1;
combined_2931 = __wm_tail_arg_208_2;
continue __wm_tail_161;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const combinedRepresentation_2928 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return combinedRepresentation_2928__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setRepresentation_2939__wm_d3 = (registry_2934, typeId_2935, representation_2936) => {
const previous_2937 = representationOf_2924__wm_d2(registry_2934, typeId_2935);
const next_2938 = joinRepresentation_2927__wm_d2(previous_2937, representation_2936);
if (__wm_op_or_d2(__wm_eq(next_2938, ""), __wm_eq(next_2938, previous_2937))) {
return [registry_2934, false];
} else {
return [Map.set([registry_2934, typeId_2935, next_2938]), true];
}
};
const setRepresentation_2939 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return setRepresentation_2939__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setRepresentations_2940__wm_d4 = (typeIds_2941, representation_2942, registry_2943, changed_2944) => {
__wm_tail_162: while (true) {
{
const __wm_scalar_192_0 = typeIds_2941;
const __wm_scalar_192_1 = representation_2942;
const __wm_scalar_192_2 = registry_2943;
const __wm_scalar_192_3 = changed_2944;
if (__wm_scalar_192_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_192_1, representation_2942) && __wm_eq(__wm_scalar_192_2, registry_2943) && __wm_eq(__wm_scalar_192_3, changed_2944)) {

return [registry_2943, changed_2944];
} else if (__wm_scalar_192_0?.ctor === -6 && __wm_scalar_192_0.args.length === 1 && __wm_is_tuple(__wm_scalar_192_0.args[0]) && __wm_scalar_192_0.args[0].length === 2 && __wm_eq(__wm_scalar_192_1, representation_2942) && __wm_eq(__wm_scalar_192_2, registry_2943) && __wm_eq(__wm_scalar_192_3, changed_2944)) {
const typeId_2945 = __wm_scalar_192_0.args[0][0];
const rest_2946 = __wm_scalar_192_0.args[0][1];
{
const __wm_bind_95 = setRepresentation_2939__wm_d3(registry_2943, typeId_2945, representation_2942);
if (!(__wm_is_tuple(__wm_bind_95) && __wm_bind_95.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_2947 = __wm_bind_95[0];
const itemChanged_2948 = __wm_bind_95[1];
{
const __wm_tail_arg_209_0 = rest_2946;
const __wm_tail_arg_209_1 = representation_2942;
const __wm_tail_arg_209_2 = nextRegistry_2947;
const __wm_tail_arg_209_3 = __wm_op_or_d2(changed_2944, itemChanged_2948);
typeIds_2941 = __wm_tail_arg_209_0;
representation_2942 = __wm_tail_arg_209_1;
registry_2943 = __wm_tail_arg_209_2;
changed_2944 = __wm_tail_arg_209_3;
continue __wm_tail_162;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const setRepresentations_2940 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setRepresentations_2940__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const seedRepresentations_2949__wm_d2 = (types_2950, registry_2951) => {
__wm_tail_163: while (true) {
{
const __wm_scalar_193_0 = types_2950;
const __wm_scalar_193_1 = registry_2951;
if (__wm_scalar_193_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_193_1, registry_2951)) {

return registry_2951;
} else if (__wm_scalar_193_0?.ctor === -6 && __wm_scalar_193_0.args.length === 1 && __wm_is_tuple(__wm_scalar_193_0.args[0]) && __wm_scalar_193_0.args[0].length === 2 && __wm_eq(__wm_scalar_193_1, registry_2951)) {
const gpuType_2952 = __wm_scalar_193_0.args[0][0];
const rest_2953 = __wm_scalar_193_0.args[0][1];
{
const exact_2954 = gpuType_2952;
if (__wm_op_or_d2(__wm_eq(exact_2954.representation, "f32"), __wm_eq(exact_2954.representation, "i32"))) {
{
const __wm_tail_arg_210_0 = rest_2953;
const __wm_tail_arg_210_1 = Map.set([registry_2951, exact_2954.id, exact_2954.representation]);
types_2950 = __wm_tail_arg_210_0;
registry_2951 = __wm_tail_arg_210_1;
continue __wm_tail_163;
}
} else {
{
const __wm_tail_arg_211_0 = rest_2953;
const __wm_tail_arg_211_1 = registry_2951;
types_2950 = __wm_tail_arg_211_0;
registry_2951 = __wm_tail_arg_211_1;
continue __wm_tail_163;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const seedRepresentations_2949 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return seedRepresentations_2949__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const childTypeIds_2955__wm_d3 = (childIds_2956, expressionRegistry_2957, typeIds_2958) => {
__wm_tail_164: while (true) {
{
const __wm_scalar_194_0 = childIds_2956;
const __wm_scalar_194_1 = expressionRegistry_2957;
const __wm_scalar_194_2 = typeIds_2958;
if (__wm_scalar_194_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_194_1, expressionRegistry_2957) && __wm_eq(__wm_scalar_194_2, typeIds_2958)) {

return typeIds_2958;
} else if (__wm_scalar_194_0?.ctor === -6 && __wm_scalar_194_0.args.length === 1 && __wm_is_tuple(__wm_scalar_194_0.args[0]) && __wm_scalar_194_0.args[0].length === 2 && __wm_eq(__wm_scalar_194_1, expressionRegistry_2957) && __wm_eq(__wm_scalar_194_2, typeIds_2958)) {
const childId_2959 = __wm_scalar_194_0.args[0][0];
const rest_2960 = __wm_scalar_194_0.args[0][1];
{
const __wm_tail_value_212 = Map.get([expressionRegistry_2957, childId_2959]);
if (__wm_tail_value_212?.ctor === -2 && __wm_tail_value_212.args.length === 1) {
const child_2961 = __wm_tail_value_212.args[0];
{
const exact_2962 = child_2961;
{
const __wm_tail_arg_213_0 = rest_2960;
const __wm_tail_arg_213_1 = expressionRegistry_2957;
const __wm_tail_arg_213_2 = __wm_basis_Cons([exact_2962.typeId, typeIds_2958]);
childIds_2956 = __wm_tail_arg_213_0;
expressionRegistry_2957 = __wm_tail_arg_213_1;
typeIds_2958 = __wm_tail_arg_213_2;
continue __wm_tail_164;
}
}
} else if (__wm_tail_value_212 === __wm_basis_None) {

{
const __wm_tail_arg_214_0 = rest_2960;
const __wm_tail_arg_214_1 = expressionRegistry_2957;
const __wm_tail_arg_214_2 = typeIds_2958;
childIds_2956 = __wm_tail_arg_214_0;
expressionRegistry_2957 = __wm_tail_arg_214_1;
typeIds_2958 = __wm_tail_arg_214_2;
continue __wm_tail_164;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const childTypeIds_2955 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return childTypeIds_2955__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const numericTypeIds_2963__wm_d3 = (typeIds_2964, typeRegistry_2965, numericIds_2966) => {
__wm_tail_165: while (true) {
{
const __wm_scalar_195_0 = typeIds_2964;
const __wm_scalar_195_1 = typeRegistry_2965;
const __wm_scalar_195_2 = numericIds_2966;
if (__wm_scalar_195_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_195_1, typeRegistry_2965) && __wm_eq(__wm_scalar_195_2, numericIds_2966)) {

return numericIds_2966;
} else if (__wm_scalar_195_0?.ctor === -6 && __wm_scalar_195_0.args.length === 1 && __wm_is_tuple(__wm_scalar_195_0.args[0]) && __wm_scalar_195_0.args[0].length === 2 && __wm_eq(__wm_scalar_195_1, typeRegistry_2965) && __wm_eq(__wm_scalar_195_2, numericIds_2966)) {
const typeId_2967 = __wm_scalar_195_0.args[0][0];
const rest_2968 = __wm_scalar_195_0.args[0][1];
{
const __wm_tail_value_215 = Map.get([typeRegistry_2965, typeId_2967]);
if (__wm_tail_value_215?.ctor === -2 && __wm_tail_value_215.args.length === 1) {
const gpuType_2969 = __wm_tail_value_215.args[0];
{
const exact_2970 = gpuType_2969;
if (__wm_eq(exact_2970.kind, "vector")) {
{
const __wm_tail_arg_216_0 = rest_2968;
const __wm_tail_arg_216_1 = typeRegistry_2965;
const __wm_tail_arg_216_2 = __wm_basis_Cons([typeId_2967, numericTypeIds_2963__wm_d3(Js.Array.toList(exact_2970.items), typeRegistry_2965, numericIds_2966)]);
typeIds_2964 = __wm_tail_arg_216_0;
typeRegistry_2965 = __wm_tail_arg_216_1;
numericIds_2966 = __wm_tail_arg_216_2;
continue __wm_tail_165;
}
} else {
if (__wm_eq(exact_2970.kind, "number")) {
{
const __wm_tail_arg_217_0 = rest_2968;
const __wm_tail_arg_217_1 = typeRegistry_2965;
const __wm_tail_arg_217_2 = __wm_basis_Cons([typeId_2967, numericIds_2966]);
typeIds_2964 = __wm_tail_arg_217_0;
typeRegistry_2965 = __wm_tail_arg_217_1;
numericIds_2966 = __wm_tail_arg_217_2;
continue __wm_tail_165;
}
} else {
{
const __wm_tail_arg_218_0 = rest_2968;
const __wm_tail_arg_218_1 = typeRegistry_2965;
const __wm_tail_arg_218_2 = numericIds_2966;
typeIds_2964 = __wm_tail_arg_218_0;
typeRegistry_2965 = __wm_tail_arg_218_1;
numericIds_2966 = __wm_tail_arg_218_2;
continue __wm_tail_165;
}
}
}
}
} else if (__wm_tail_value_215 === __wm_basis_None) {

{
const __wm_tail_arg_219_0 = rest_2968;
const __wm_tail_arg_219_1 = typeRegistry_2965;
const __wm_tail_arg_219_2 = numericIds_2966;
typeIds_2964 = __wm_tail_arg_219_0;
typeRegistry_2965 = __wm_tail_arg_219_1;
numericIds_2966 = __wm_tail_arg_219_2;
continue __wm_tail_165;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const numericTypeIds_2963 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return numericTypeIds_2963__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lastChildTypeId_2971__wm_d3 = (childIds_2972, expressionRegistry_2973, lastTypeId_2974) => {
__wm_tail_166: while (true) {
{
const __wm_scalar_196_0 = childIds_2972;
const __wm_scalar_196_1 = expressionRegistry_2973;
const __wm_scalar_196_2 = lastTypeId_2974;
if (__wm_scalar_196_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_196_1, expressionRegistry_2973) && __wm_eq(__wm_scalar_196_2, lastTypeId_2974)) {

return lastTypeId_2974;
} else if (__wm_scalar_196_0?.ctor === -6 && __wm_scalar_196_0.args.length === 1 && __wm_is_tuple(__wm_scalar_196_0.args[0]) && __wm_scalar_196_0.args[0].length === 2 && __wm_eq(__wm_scalar_196_1, expressionRegistry_2973) && __wm_eq(__wm_scalar_196_2, lastTypeId_2974)) {
const childId_2975 = __wm_scalar_196_0.args[0][0];
const rest_2976 = __wm_scalar_196_0.args[0][1];
{
const nextTypeId_2979 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const child_2977 = __v.args[0];
const exact_2978 = child_2977;
return exact_2978.typeId;
} else if (__v === __wm_basis_None) {

return lastTypeId_2974;
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([expressionRegistry_2973, childId_2975]));
{
const __wm_tail_arg_220_0 = rest_2976;
const __wm_tail_arg_220_1 = expressionRegistry_2973;
const __wm_tail_arg_220_2 = nextTypeId_2979;
childIds_2972 = __wm_tail_arg_220_0;
expressionRegistry_2973 = __wm_tail_arg_220_1;
lastTypeId_2974 = __wm_tail_arg_220_2;
continue __wm_tail_166;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const lastChildTypeId_2971 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return lastChildTypeId_2971__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const constraintTypeIds_2985__wm_d3 = (expression_2980, expressionRegistry_2981, typeRegistry_2982) => {
if (__wm_eq(expression_2980.kind, "binary")) {
return numericTypeIds_2963__wm_d3(__wm_basis_Cons([expression_2980.typeId, childTypeIds_2955__wm_d3(Js.Array.toList(expression_2980.children), expressionRegistry_2981, __wm_basis_Nil)]), typeRegistry_2982, __wm_basis_Nil);
} else {
if (__wm_eq(expression_2980.kind, "tuple")) {
const __wm_return_value_58 = Map.get([typeRegistry_2982, expression_2980.typeId]);
if (__wm_return_value_58?.ctor === -2 && __wm_return_value_58.args.length === 1) {
const gpuType_2983 = __wm_return_value_58.args[0];
const exact_2984 = gpuType_2983;
if (__wm_eq(exact_2984.kind, "vector")) {
return numericTypeIds_2963__wm_d3(__wm_basis_Cons([expression_2980.typeId, childTypeIds_2955__wm_d3(Js.Array.toList(expression_2980.children), expressionRegistry_2981, __wm_basis_Nil)]), typeRegistry_2982, __wm_basis_Nil);
} else {
return __wm_basis_Nil;
}
} else if (__wm_return_value_58 === __wm_basis_None) {

return __wm_basis_Nil;
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_op_or_d2(__wm_eq(expression_2980.kind, "if"), __wm_eq(expression_2980.kind, "unary"))) {
return numericTypeIds_2963__wm_d3(__wm_basis_Cons([expression_2980.typeId, childTypeIds_2955__wm_d3(Js.Array.toList(expression_2980.children), expressionRegistry_2981, __wm_basis_Nil)]), typeRegistry_2982, __wm_basis_Nil);
} else {
if (__wm_op_or_d2(__wm_eq(expression_2980.kind, "block"), __wm_eq(expression_2980.kind, "let"))) {
return numericTypeIds_2963__wm_d3(__wm_basis_Cons([expression_2980.typeId, __wm_basis_Cons([lastChildTypeId_2971__wm_d3(Js.Array.toList(expression_2980.children), expressionRegistry_2981, expression_2980.typeId), __wm_basis_Nil])]), typeRegistry_2982, __wm_basis_Nil);
} else {
return __wm_basis_Nil;
}
}
}
}
};
const constraintTypeIds_2985 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return constraintTypeIds_2985__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const applyNumericGroup_2989__wm_d2 = (typeIds_2986, registry_2987) => {
const representation_2988 = combinedRepresentation_2928__wm_d3(typeIds_2986, registry_2987, "");
return setRepresentations_2940__wm_d4(typeIds_2986, representation_2988, registry_2987, false);
};
const applyNumericGroup_2989 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return applyNumericGroup_2989__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const applyArgumentConstraints_2990__wm_d6 = (argumentIds_2991, params_2992, expressionRegistry_2993, typeRegistry_2994, registry_2995, changed_2996) => {
__wm_tail_167: while (true) {
{
const __wm_scalar_197_0 = argumentIds_2991;
const __wm_scalar_197_1 = params_2992;
const __wm_scalar_197_2 = expressionRegistry_2993;
const __wm_scalar_197_3 = typeRegistry_2994;
const __wm_scalar_197_4 = registry_2995;
const __wm_scalar_197_5 = changed_2996;
if (__wm_scalar_197_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_197_1, params_2992) && __wm_eq(__wm_scalar_197_2, expressionRegistry_2993) && __wm_eq(__wm_scalar_197_3, typeRegistry_2994) && __wm_eq(__wm_scalar_197_4, registry_2995) && __wm_eq(__wm_scalar_197_5, changed_2996)) {

return [registry_2995, changed_2996];
} else if (__wm_eq(__wm_scalar_197_0, argumentIds_2991) && __wm_scalar_197_1 === __wm_basis_Nil && __wm_eq(__wm_scalar_197_2, expressionRegistry_2993) && __wm_eq(__wm_scalar_197_3, typeRegistry_2994) && __wm_eq(__wm_scalar_197_4, registry_2995) && __wm_eq(__wm_scalar_197_5, changed_2996)) {

return [registry_2995, changed_2996];
} else if (__wm_scalar_197_0?.ctor === -6 && __wm_scalar_197_0.args.length === 1 && __wm_is_tuple(__wm_scalar_197_0.args[0]) && __wm_scalar_197_0.args[0].length === 2 && __wm_scalar_197_1?.ctor === -6 && __wm_scalar_197_1.args.length === 1 && __wm_is_tuple(__wm_scalar_197_1.args[0]) && __wm_scalar_197_1.args[0].length === 2 && __wm_eq(__wm_scalar_197_2, expressionRegistry_2993) && __wm_eq(__wm_scalar_197_3, typeRegistry_2994) && __wm_eq(__wm_scalar_197_4, registry_2995) && __wm_eq(__wm_scalar_197_5, changed_2996)) {
const argumentId_2997 = __wm_scalar_197_0.args[0][0];
const restArguments_2998 = __wm_scalar_197_0.args[0][1];
const param_2999 = __wm_scalar_197_1.args[0][0];
const restParams_3000 = __wm_scalar_197_1.args[0][1];
{
const exactParam_3001 = param_2999;
{
const __wm_tail_value_221 = Map.get([expressionRegistry_2993, argumentId_2997]);
if (__wm_tail_value_221?.ctor === -2 && __wm_tail_value_221.args.length === 1) {
const argument_3002 = __wm_tail_value_221.args[0];
{
const exactArgument_3003 = argument_3002;
const typeIds_3004 = numericTypeIds_2963__wm_d3(__wm_basis_Cons([exactArgument_3003.typeId, __wm_basis_Cons([exactParam_3001.typeId, __wm_basis_Nil])]), typeRegistry_2994, __wm_basis_Nil);
const __wm_bind_96 = applyNumericGroup_2989__wm_d2(typeIds_3004, registry_2995);
if (!(__wm_is_tuple(__wm_bind_96) && __wm_bind_96.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_3005 = __wm_bind_96[0];
const pairChanged_3006 = __wm_bind_96[1];
{
const __wm_tail_arg_222_0 = restArguments_2998;
const __wm_tail_arg_222_1 = restParams_3000;
const __wm_tail_arg_222_2 = expressionRegistry_2993;
const __wm_tail_arg_222_3 = typeRegistry_2994;
const __wm_tail_arg_222_4 = nextRegistry_3005;
const __wm_tail_arg_222_5 = __wm_op_or_d2(changed_2996, pairChanged_3006);
argumentIds_2991 = __wm_tail_arg_222_0;
params_2992 = __wm_tail_arg_222_1;
expressionRegistry_2993 = __wm_tail_arg_222_2;
typeRegistry_2994 = __wm_tail_arg_222_3;
registry_2995 = __wm_tail_arg_222_4;
changed_2996 = __wm_tail_arg_222_5;
continue __wm_tail_167;
}
}
} else if (__wm_tail_value_221 === __wm_basis_None) {

{
const __wm_tail_arg_223_0 = restArguments_2998;
const __wm_tail_arg_223_1 = restParams_3000;
const __wm_tail_arg_223_2 = expressionRegistry_2993;
const __wm_tail_arg_223_3 = typeRegistry_2994;
const __wm_tail_arg_223_4 = registry_2995;
const __wm_tail_arg_223_5 = changed_2996;
argumentIds_2991 = __wm_tail_arg_223_0;
params_2992 = __wm_tail_arg_223_1;
expressionRegistry_2993 = __wm_tail_arg_223_2;
typeRegistry_2994 = __wm_tail_arg_223_3;
registry_2995 = __wm_tail_arg_223_4;
changed_2996 = __wm_tail_arg_223_5;
continue __wm_tail_167;
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
const applyArgumentConstraints_2990 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return applyArgumentConstraints_2990__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const applyCallConstraint_3023__wm_d6 = (expression_3007, expressionRegistry_3008, typeRegistry_3009, functionRegistry_3010, bindingFunctions_3011, registry_3012) => {
const __wm_return_value_59 = Js.Array.toList(expression_3007.children);
if (__wm_return_value_59?.ctor === -6 && __wm_return_value_59.args.length === 1 && __wm_is_tuple(__wm_return_value_59.args[0]) && __wm_return_value_59.args[0].length === 2) {
const calleeId_3013 = __wm_return_value_59.args[0][0];
const argumentIds_3014 = __wm_return_value_59.args[0][1];
const __wm_return_value_60 = Map.get([expressionRegistry_3008, calleeId_3013]);
if (__wm_return_value_60?.ctor === -2 && __wm_return_value_60.args.length === 1) {
const callee_3015 = __wm_return_value_60.args[0];
const exactCallee_3016 = callee_3015;
const __wm_return_value_61 = Map.get([bindingFunctions_3011, exactCallee_3016.bindingId]);
if (__wm_return_value_61?.ctor === -2 && __wm_return_value_61.args.length === 1) {
const functionId_3017 = __wm_return_value_61.args[0];
const __wm_return_value_62 = Map.get([functionRegistry_3010, functionId_3017]);
if (__wm_return_value_62?.ctor === -2 && __wm_return_value_62.args.length === 1) {
const fn_3018 = __wm_return_value_62.args[0];
const exactFunction_3019 = fn_3018;
const resultIds_3020 = numericTypeIds_2963__wm_d3(__wm_basis_Cons([expression_3007.typeId, __wm_basis_Cons([exactFunction_3019.resultTypeId, __wm_basis_Nil])]), typeRegistry_3009, __wm_basis_Nil);
const __wm_bind_97 = applyNumericGroup_2989__wm_d2(resultIds_3020, registry_3012);
if (!(__wm_is_tuple(__wm_bind_97) && __wm_bind_97.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const resultRegistry_3021 = __wm_bind_97[0];
const resultChanged_3022 = __wm_bind_97[1];
return applyArgumentConstraints_2990__wm_d6(argumentIds_3014, Js.Array.toList(exactFunction_3019.params), expressionRegistry_3008, typeRegistry_3009, resultRegistry_3021, resultChanged_3022);
} else if (__wm_return_value_62 === __wm_basis_None) {

return [registry_3012, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_61 === __wm_basis_None) {

return [registry_3012, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_60 === __wm_basis_None) {

return [registry_3012, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_59 === __wm_basis_Nil) {

return [registry_3012, false];
}
__wm_fail("Match", "non-exhaustive match");
};
const applyCallConstraint_3023 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return applyCallConstraint_3023__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const applyNumericConstraint_3031__wm_d6 = (expression_3024, expressionRegistry_3025, typeRegistry_3026, functionRegistry_3027, bindingFunctions_3028, registry_3029) => {
if (__wm_eq(expression_3024.kind, "call")) {
return applyCallConstraint_3023__wm_d6(expression_3024, expressionRegistry_3025, typeRegistry_3026, functionRegistry_3027, bindingFunctions_3028, registry_3029);
} else {
const typeIds_3030 = constraintTypeIds_2985__wm_d3(expression_3024, expressionRegistry_3025, typeRegistry_3026);
return applyNumericGroup_2989__wm_d2(typeIds_3030, registry_3029);
}
};
const applyNumericConstraint_3031 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return applyNumericConstraint_3031__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const numericSweep_3032__wm_d7 = (expressions_3033, expressionRegistry_3034, typeRegistry_3035, functionRegistry_3036, bindingFunctions_3037, registry_3038, changed_3039) => {
__wm_tail_168: while (true) {
{
const __wm_scalar_198_0 = expressions_3033;
const __wm_scalar_198_1 = expressionRegistry_3034;
const __wm_scalar_198_2 = typeRegistry_3035;
const __wm_scalar_198_3 = functionRegistry_3036;
const __wm_scalar_198_4 = bindingFunctions_3037;
const __wm_scalar_198_5 = registry_3038;
const __wm_scalar_198_6 = changed_3039;
if (__wm_scalar_198_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_198_1, expressionRegistry_3034) && __wm_eq(__wm_scalar_198_2, typeRegistry_3035) && __wm_eq(__wm_scalar_198_3, functionRegistry_3036) && __wm_eq(__wm_scalar_198_4, bindingFunctions_3037) && __wm_eq(__wm_scalar_198_5, registry_3038) && __wm_eq(__wm_scalar_198_6, changed_3039)) {

return [registry_3038, changed_3039];
} else if (__wm_scalar_198_0?.ctor === -6 && __wm_scalar_198_0.args.length === 1 && __wm_is_tuple(__wm_scalar_198_0.args[0]) && __wm_scalar_198_0.args[0].length === 2 && __wm_eq(__wm_scalar_198_1, expressionRegistry_3034) && __wm_eq(__wm_scalar_198_2, typeRegistry_3035) && __wm_eq(__wm_scalar_198_3, functionRegistry_3036) && __wm_eq(__wm_scalar_198_4, bindingFunctions_3037) && __wm_eq(__wm_scalar_198_5, registry_3038) && __wm_eq(__wm_scalar_198_6, changed_3039)) {
const expression_3040 = __wm_scalar_198_0.args[0][0];
const rest_3041 = __wm_scalar_198_0.args[0][1];
{
const exactExpression_3042 = expression_3040;
const __wm_bind_98 = applyNumericConstraint_3031__wm_d6(exactExpression_3042, expressionRegistry_3034, typeRegistry_3035, functionRegistry_3036, bindingFunctions_3037, registry_3038);
if (!(__wm_is_tuple(__wm_bind_98) && __wm_bind_98.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_3043 = __wm_bind_98[0];
const expressionChanged_3044 = __wm_bind_98[1];
{
const __wm_tail_arg_224_0 = rest_3041;
const __wm_tail_arg_224_1 = expressionRegistry_3034;
const __wm_tail_arg_224_2 = typeRegistry_3035;
const __wm_tail_arg_224_3 = functionRegistry_3036;
const __wm_tail_arg_224_4 = bindingFunctions_3037;
const __wm_tail_arg_224_5 = nextRegistry_3043;
const __wm_tail_arg_224_6 = __wm_op_or_d2(changed_3039, expressionChanged_3044);
expressions_3033 = __wm_tail_arg_224_0;
expressionRegistry_3034 = __wm_tail_arg_224_1;
typeRegistry_3035 = __wm_tail_arg_224_2;
functionRegistry_3036 = __wm_tail_arg_224_3;
bindingFunctions_3037 = __wm_tail_arg_224_4;
registry_3038 = __wm_tail_arg_224_5;
changed_3039 = __wm_tail_arg_224_6;
continue __wm_tail_168;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const numericSweep_3032 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return numericSweep_3032__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const solveNumericRepresentations_3045__wm_d6 = (expressions_3046, expressionRegistry_3047, typeRegistry_3048, functionRegistry_3049, bindingFunctions_3050, registry_3051) => {
__wm_tail_169: while (true) {
{
const __wm_bind_99 = numericSweep_3032__wm_d7(expressions_3046, expressionRegistry_3047, typeRegistry_3048, functionRegistry_3049, bindingFunctions_3050, registry_3051, false);
if (!(__wm_is_tuple(__wm_bind_99) && __wm_bind_99.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_3052 = __wm_bind_99[0];
const changed_3053 = __wm_bind_99[1];
if (changed_3053) {
{
const __wm_tail_arg_225_0 = expressions_3046;
const __wm_tail_arg_225_1 = expressionRegistry_3047;
const __wm_tail_arg_225_2 = typeRegistry_3048;
const __wm_tail_arg_225_3 = functionRegistry_3049;
const __wm_tail_arg_225_4 = bindingFunctions_3050;
const __wm_tail_arg_225_5 = nextRegistry_3052;
expressions_3046 = __wm_tail_arg_225_0;
expressionRegistry_3047 = __wm_tail_arg_225_1;
typeRegistry_3048 = __wm_tail_arg_225_2;
functionRegistry_3049 = __wm_tail_arg_225_3;
bindingFunctions_3050 = __wm_tail_arg_225_4;
registry_3051 = __wm_tail_arg_225_5;
continue __wm_tail_169;
}
} else {
return nextRegistry_3052;
}
}
}
};
const solveNumericRepresentations_3045 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return solveNumericRepresentations_3045__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const collectExpressionItems_3054__wm_d4 = (pending_3055, expressionRegistry_3056, visited_3057, expressions_3058) => {
__wm_tail_170: while (true) {
{
const __wm_scalar_199_0 = pending_3055;
const __wm_scalar_199_1 = expressionRegistry_3056;
const __wm_scalar_199_2 = visited_3057;
const __wm_scalar_199_3 = expressions_3058;
if (__wm_scalar_199_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_199_1, expressionRegistry_3056) && __wm_eq(__wm_scalar_199_2, visited_3057) && __wm_eq(__wm_scalar_199_3, expressions_3058)) {

return expressions_3058;
} else if (__wm_scalar_199_0?.ctor === -6 && __wm_scalar_199_0.args.length === 1 && __wm_is_tuple(__wm_scalar_199_0.args[0]) && __wm_scalar_199_0.args[0].length === 2 && __wm_eq(__wm_scalar_199_1, expressionRegistry_3056) && __wm_eq(__wm_scalar_199_2, visited_3057) && __wm_eq(__wm_scalar_199_3, expressions_3058)) {
const expressionId_3059 = __wm_scalar_199_0.args[0][0];
const rest_3060 = __wm_scalar_199_0.args[0][1];
if (Map.has([visited_3057, expressionId_3059])) {
{
const __wm_tail_arg_226_0 = rest_3060;
const __wm_tail_arg_226_1 = expressionRegistry_3056;
const __wm_tail_arg_226_2 = visited_3057;
const __wm_tail_arg_226_3 = expressions_3058;
pending_3055 = __wm_tail_arg_226_0;
expressionRegistry_3056 = __wm_tail_arg_226_1;
visited_3057 = __wm_tail_arg_226_2;
expressions_3058 = __wm_tail_arg_226_3;
continue __wm_tail_170;
}
} else {
{
const nextVisited_3061 = Map.set([visited_3057, expressionId_3059, true]);
{
const __wm_tail_value_227 = Map.get([expressionRegistry_3056, expressionId_3059]);
if (__wm_tail_value_227?.ctor === -2 && __wm_tail_value_227.args.length === 1) {
const expression_3062 = __wm_tail_value_227.args[0];
{
const exact_3063 = expression_3062;
{
const __wm_tail_arg_228_0 = prependAll_2698__wm_d2(Js.Array.toList(exact_3063.children), rest_3060);
const __wm_tail_arg_228_1 = expressionRegistry_3056;
const __wm_tail_arg_228_2 = nextVisited_3061;
const __wm_tail_arg_228_3 = __wm_basis_Cons([exact_3063, expressions_3058]);
pending_3055 = __wm_tail_arg_228_0;
expressionRegistry_3056 = __wm_tail_arg_228_1;
visited_3057 = __wm_tail_arg_228_2;
expressions_3058 = __wm_tail_arg_228_3;
continue __wm_tail_170;
}
}
} else if (__wm_tail_value_227 === __wm_basis_None) {

{
const __wm_tail_arg_229_0 = rest_3060;
const __wm_tail_arg_229_1 = expressionRegistry_3056;
const __wm_tail_arg_229_2 = nextVisited_3061;
const __wm_tail_arg_229_3 = expressions_3058;
pending_3055 = __wm_tail_arg_229_0;
expressionRegistry_3056 = __wm_tail_arg_229_1;
visited_3057 = __wm_tail_arg_229_2;
expressions_3058 = __wm_tail_arg_229_3;
continue __wm_tail_170;
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
const collectExpressionItems_3054 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return collectExpressionItems_3054__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const concreteRepresentation_3070__wm_d3 = (typeRegistry_3064, representations_3065, typeId_3066) => {
const __wm_return_value_63 = Map.get([typeRegistry_3064, typeId_3066]);
if (__wm_return_value_63?.ctor === -2 && __wm_return_value_63.args.length === 1) {
const gpuType_3067 = __wm_return_value_63.args[0];
const exact_3068 = gpuType_3067;
if (__wm_op_or_d2(__wm_eq(exact_3068.kind, "number"), __wm_eq(exact_3068.kind, "vector"))) {
const representation_3069 = representationOf_2924__wm_d2(representations_3065, typeId_3066);
if (__wm_eq(representation_3069, "")) {
return "i32";
} else {
return representation_3069;
}
} else {
return "";
}
} else if (__wm_return_value_63 === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const concreteRepresentation_3070 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concreteRepresentation_3070__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setTypeRepresentation_3076__wm_d4 = (typeId_3071, representation_3072, typeRegistry_3073, registry_3074) => {
const typeIds_3075 = numericTypeIds_2963__wm_d3(__wm_basis_Cons([typeId_3071, __wm_basis_Nil]), typeRegistry_3073, __wm_basis_Nil);
return setRepresentations_2940__wm_d4(typeIds_3075, representation_3072, registry_3074, false);
};
const setTypeRepresentation_3076 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setTypeRepresentation_3076__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const seedParamRepresentations_3077__wm_d4 = (params_3078, representations_3079, typeRegistry_3080, registry_3081) => {
__wm_tail_171: while (true) {
{
const __wm_scalar_200_0 = params_3078;
const __wm_scalar_200_1 = representations_3079;
const __wm_scalar_200_2 = typeRegistry_3080;
const __wm_scalar_200_3 = registry_3081;
if (__wm_scalar_200_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_200_1, representations_3079) && __wm_eq(__wm_scalar_200_2, typeRegistry_3080) && __wm_eq(__wm_scalar_200_3, registry_3081)) {

return registry_3081;
} else if (__wm_eq(__wm_scalar_200_0, params_3078) && __wm_scalar_200_1 === __wm_basis_Nil && __wm_eq(__wm_scalar_200_2, typeRegistry_3080) && __wm_eq(__wm_scalar_200_3, registry_3081)) {

return registry_3081;
} else if (__wm_scalar_200_0?.ctor === -6 && __wm_scalar_200_0.args.length === 1 && __wm_is_tuple(__wm_scalar_200_0.args[0]) && __wm_scalar_200_0.args[0].length === 2 && __wm_scalar_200_1?.ctor === -6 && __wm_scalar_200_1.args.length === 1 && __wm_is_tuple(__wm_scalar_200_1.args[0]) && __wm_scalar_200_1.args[0].length === 2 && __wm_eq(__wm_scalar_200_2, typeRegistry_3080) && __wm_eq(__wm_scalar_200_3, registry_3081)) {
const param_3082 = __wm_scalar_200_0.args[0][0];
const restParams_3083 = __wm_scalar_200_0.args[0][1];
const representation_3084 = __wm_scalar_200_1.args[0][0];
const restRepresentations_3085 = __wm_scalar_200_1.args[0][1];
{
const exact_3086 = param_3082;
const __wm_bind_100 = setTypeRepresentation_3076__wm_d4(exact_3086.typeId, representation_3084, typeRegistry_3080, registry_3081);
if (!(__wm_is_tuple(__wm_bind_100) && __wm_bind_100.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_3087 = __wm_bind_100[0];
const _changed_3088 = __wm_bind_100[1];
{
const __wm_tail_arg_230_0 = restParams_3083;
const __wm_tail_arg_230_1 = restRepresentations_3085;
const __wm_tail_arg_230_2 = typeRegistry_3080;
const __wm_tail_arg_230_3 = nextRegistry_3087;
params_3078 = __wm_tail_arg_230_0;
representations_3079 = __wm_tail_arg_230_1;
typeRegistry_3080 = __wm_tail_arg_230_2;
registry_3081 = __wm_tail_arg_230_3;
continue __wm_tail_171;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const seedParamRepresentations_3077 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return seedParamRepresentations_3077__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const functionParamRepresentations_3089__wm_d4 = (params_3090, typeRegistry_3091, representations_3092, output_3093) => {
__wm_tail_172: while (true) {
{
const __wm_scalar_201_0 = params_3090;
const __wm_scalar_201_1 = typeRegistry_3091;
const __wm_scalar_201_2 = representations_3092;
const __wm_scalar_201_3 = output_3093;
if (__wm_scalar_201_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_201_1, typeRegistry_3091) && __wm_eq(__wm_scalar_201_2, representations_3092) && __wm_eq(__wm_scalar_201_3, output_3093)) {

return reverseInto_2703__wm_d2(output_3093, __wm_basis_Nil);
} else if (__wm_scalar_201_0?.ctor === -6 && __wm_scalar_201_0.args.length === 1 && __wm_is_tuple(__wm_scalar_201_0.args[0]) && __wm_scalar_201_0.args[0].length === 2 && __wm_eq(__wm_scalar_201_1, typeRegistry_3091) && __wm_eq(__wm_scalar_201_2, representations_3092) && __wm_eq(__wm_scalar_201_3, output_3093)) {
const param_3094 = __wm_scalar_201_0.args[0][0];
const rest_3095 = __wm_scalar_201_0.args[0][1];
{
const exact_3096 = param_3094;
{
const __wm_tail_arg_231_0 = rest_3095;
const __wm_tail_arg_231_1 = typeRegistry_3091;
const __wm_tail_arg_231_2 = representations_3092;
const __wm_tail_arg_231_3 = __wm_basis_Cons([concreteRepresentation_3070__wm_d3(typeRegistry_3091, representations_3092, exact_3096.typeId), output_3093]);
params_3090 = __wm_tail_arg_231_0;
typeRegistry_3091 = __wm_tail_arg_231_1;
representations_3092 = __wm_tail_arg_231_2;
output_3093 = __wm_tail_arg_231_3;
continue __wm_tail_172;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const functionParamRepresentations_3089 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return functionParamRepresentations_3089__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const callArgumentRepresentations_3097__wm_d5 = (argumentIds_3098, expressionRegistry_3099, typeRegistry_3100, representations_3101, output_3102) => {
__wm_tail_173: while (true) {
{
const __wm_scalar_202_0 = argumentIds_3098;
const __wm_scalar_202_1 = expressionRegistry_3099;
const __wm_scalar_202_2 = typeRegistry_3100;
const __wm_scalar_202_3 = representations_3101;
const __wm_scalar_202_4 = output_3102;
if (__wm_scalar_202_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_202_1, expressionRegistry_3099) && __wm_eq(__wm_scalar_202_2, typeRegistry_3100) && __wm_eq(__wm_scalar_202_3, representations_3101) && __wm_eq(__wm_scalar_202_4, output_3102)) {

return reverseInto_2703__wm_d2(output_3102, __wm_basis_Nil);
} else if (__wm_scalar_202_0?.ctor === -6 && __wm_scalar_202_0.args.length === 1 && __wm_is_tuple(__wm_scalar_202_0.args[0]) && __wm_scalar_202_0.args[0].length === 2 && __wm_eq(__wm_scalar_202_1, expressionRegistry_3099) && __wm_eq(__wm_scalar_202_2, typeRegistry_3100) && __wm_eq(__wm_scalar_202_3, representations_3101) && __wm_eq(__wm_scalar_202_4, output_3102)) {
const argumentId_3103 = __wm_scalar_202_0.args[0][0];
const rest_3104 = __wm_scalar_202_0.args[0][1];
{
const representation_3107 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const argument_3105 = __v.args[0];
const exact_3106 = argument_3105;
return concreteRepresentation_3070__wm_d3(typeRegistry_3100, representations_3101, exact_3106.typeId);
} else if (__v === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([expressionRegistry_3099, argumentId_3103]));
{
const __wm_tail_arg_232_0 = rest_3104;
const __wm_tail_arg_232_1 = expressionRegistry_3099;
const __wm_tail_arg_232_2 = typeRegistry_3100;
const __wm_tail_arg_232_3 = representations_3101;
const __wm_tail_arg_232_4 = __wm_basis_Cons([representation_3107, output_3102]);
argumentIds_3098 = __wm_tail_arg_232_0;
expressionRegistry_3099 = __wm_tail_arg_232_1;
typeRegistry_3100 = __wm_tail_arg_232_2;
representations_3101 = __wm_tail_arg_232_3;
output_3102 = __wm_tail_arg_232_4;
continue __wm_tail_173;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const callArgumentRepresentations_3097 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return callArgumentRepresentations_3097__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeArgumentRepresentations_3108__wm_d6 = (argumentIds_3109, representations_3110, expressionRegistry_3111, typeRegistry_3112, registry_3113, changed_3114) => {
__wm_tail_174: while (true) {
{
const __wm_scalar_203_0 = argumentIds_3109;
const __wm_scalar_203_1 = representations_3110;
const __wm_scalar_203_2 = expressionRegistry_3111;
const __wm_scalar_203_3 = typeRegistry_3112;
const __wm_scalar_203_4 = registry_3113;
const __wm_scalar_203_5 = changed_3114;
if (__wm_scalar_203_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_203_1, representations_3110) && __wm_eq(__wm_scalar_203_2, expressionRegistry_3111) && __wm_eq(__wm_scalar_203_3, typeRegistry_3112) && __wm_eq(__wm_scalar_203_4, registry_3113) && __wm_eq(__wm_scalar_203_5, changed_3114)) {

return [registry_3113, changed_3114];
} else if (__wm_eq(__wm_scalar_203_0, argumentIds_3109) && __wm_scalar_203_1 === __wm_basis_Nil && __wm_eq(__wm_scalar_203_2, expressionRegistry_3111) && __wm_eq(__wm_scalar_203_3, typeRegistry_3112) && __wm_eq(__wm_scalar_203_4, registry_3113) && __wm_eq(__wm_scalar_203_5, changed_3114)) {

return [registry_3113, changed_3114];
} else if (__wm_scalar_203_0?.ctor === -6 && __wm_scalar_203_0.args.length === 1 && __wm_is_tuple(__wm_scalar_203_0.args[0]) && __wm_scalar_203_0.args[0].length === 2 && __wm_scalar_203_1?.ctor === -6 && __wm_scalar_203_1.args.length === 1 && __wm_is_tuple(__wm_scalar_203_1.args[0]) && __wm_scalar_203_1.args[0].length === 2 && __wm_eq(__wm_scalar_203_2, expressionRegistry_3111) && __wm_eq(__wm_scalar_203_3, typeRegistry_3112) && __wm_eq(__wm_scalar_203_4, registry_3113) && __wm_eq(__wm_scalar_203_5, changed_3114)) {
const argumentId_3115 = __wm_scalar_203_0.args[0][0];
const restArguments_3116 = __wm_scalar_203_0.args[0][1];
const representation_3117 = __wm_scalar_203_1.args[0][0];
const restRepresentations_3118 = __wm_scalar_203_1.args[0][1];
{
const __wm_tail_value_233 = Map.get([expressionRegistry_3111, argumentId_3115]);
if (__wm_tail_value_233?.ctor === -2 && __wm_tail_value_233.args.length === 1) {
const argument_3119 = __wm_tail_value_233.args[0];
{
const exact_3120 = argument_3119;
const __wm_bind_101 = setTypeRepresentation_3076__wm_d4(exact_3120.typeId, representation_3117, typeRegistry_3112, registry_3113);
if (!(__wm_is_tuple(__wm_bind_101) && __wm_bind_101.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_3121 = __wm_bind_101[0];
const itemChanged_3122 = __wm_bind_101[1];
{
const __wm_tail_arg_234_0 = restArguments_3116;
const __wm_tail_arg_234_1 = restRepresentations_3118;
const __wm_tail_arg_234_2 = expressionRegistry_3111;
const __wm_tail_arg_234_3 = typeRegistry_3112;
const __wm_tail_arg_234_4 = nextRegistry_3121;
const __wm_tail_arg_234_5 = __wm_op_or_d2(changed_3114, itemChanged_3122);
argumentIds_3109 = __wm_tail_arg_234_0;
representations_3110 = __wm_tail_arg_234_1;
expressionRegistry_3111 = __wm_tail_arg_234_2;
typeRegistry_3112 = __wm_tail_arg_234_3;
registry_3113 = __wm_tail_arg_234_4;
changed_3114 = __wm_tail_arg_234_5;
continue __wm_tail_174;
}
}
} else if (__wm_tail_value_233 === __wm_basis_None) {

{
const __wm_tail_arg_235_0 = restArguments_3116;
const __wm_tail_arg_235_1 = restRepresentations_3118;
const __wm_tail_arg_235_2 = expressionRegistry_3111;
const __wm_tail_arg_235_3 = typeRegistry_3112;
const __wm_tail_arg_235_4 = registry_3113;
const __wm_tail_arg_235_5 = changed_3114;
argumentIds_3109 = __wm_tail_arg_235_0;
representations_3110 = __wm_tail_arg_235_1;
expressionRegistry_3111 = __wm_tail_arg_235_2;
typeRegistry_3112 = __wm_tail_arg_235_3;
registry_3113 = __wm_tail_arg_235_4;
changed_3114 = __wm_tail_arg_235_5;
continue __wm_tail_174;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const mergeArgumentRepresentations_3108 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return mergeArgumentRepresentations_3108__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const solveFunctionInstance_3123__wm_d9 = (fn_3126, paramRepresentations_3127, resultRepresentation_3128, active_3129, functionRegistry_3130, expressionRegistry_3131, bindingFunctions_3132, typeRegistry_3133, typeItems_3134) => {
const seeded_3135 = seedRepresentations_2949__wm_d2(typeItems_3134, Map.empty(Map.numberCompare));
const withParams_3136 = seedParamRepresentations_3077__wm_d4(Js.Array.toList(fn_3126.params), paramRepresentations_3127, typeRegistry_3133, seeded_3135);
const __wm_bind_102 = setTypeRepresentation_3076__wm_d4(fn_3126.resultTypeId, resultRepresentation_3128, typeRegistry_3133, withParams_3136);
if (!(__wm_is_tuple(__wm_bind_102) && __wm_bind_102.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const initial_3137 = __wm_bind_102[0];
const _resultChanged_3138 = __wm_bind_102[1];
const expressions_3139 = collectExpressionItems_3054__wm_d4(__wm_basis_Cons([fn_3126.bodyExprId, __wm_basis_Nil]), expressionRegistry_3131, Map.empty(Map.numberCompare), __wm_basis_Nil);
return solveInstanceFixedPoint_3124__wm_d9(fn_3126, expressions_3139, Map.set([active_3129, fn_3126.id, true]), functionRegistry_3130, expressionRegistry_3131, bindingFunctions_3132, typeRegistry_3133, typeItems_3134, initial_3137);
};
const solveFunctionInstance_3123 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return solveFunctionInstance_3123__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const solveInstanceFixedPoint_3124__wm_d9 = (fn_3140, expressions_3141, active_3142, functionRegistry_3143, expressionRegistry_3144, bindingFunctions_3145, typeRegistry_3146, typeItems_3147, registry_3148) => {
__wm_tail_175: while (true) {
{
const __wm_bind_103 = instanceSweep_3125__wm_d10(expressions_3141, fn_3140, active_3142, functionRegistry_3143, expressionRegistry_3144, bindingFunctions_3145, typeRegistry_3146, typeItems_3147, registry_3148, false);
if (!(__wm_is_tuple(__wm_bind_103) && __wm_bind_103.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_3149 = __wm_bind_103[0];
const changed_3150 = __wm_bind_103[1];
if (changed_3150) {
{
const __wm_tail_arg_236_0 = fn_3140;
const __wm_tail_arg_236_1 = expressions_3141;
const __wm_tail_arg_236_2 = active_3142;
const __wm_tail_arg_236_3 = functionRegistry_3143;
const __wm_tail_arg_236_4 = expressionRegistry_3144;
const __wm_tail_arg_236_5 = bindingFunctions_3145;
const __wm_tail_arg_236_6 = typeRegistry_3146;
const __wm_tail_arg_236_7 = typeItems_3147;
const __wm_tail_arg_236_8 = nextRegistry_3149;
fn_3140 = __wm_tail_arg_236_0;
expressions_3141 = __wm_tail_arg_236_1;
active_3142 = __wm_tail_arg_236_2;
functionRegistry_3143 = __wm_tail_arg_236_3;
expressionRegistry_3144 = __wm_tail_arg_236_4;
bindingFunctions_3145 = __wm_tail_arg_236_5;
typeRegistry_3146 = __wm_tail_arg_236_6;
typeItems_3147 = __wm_tail_arg_236_7;
registry_3148 = __wm_tail_arg_236_8;
continue __wm_tail_175;
}
} else {
return nextRegistry_3149;
}
}
}
};
const solveInstanceFixedPoint_3124 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return solveInstanceFixedPoint_3124__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const instanceSweep_3125__wm_d10 = (expressions_3151, fn_3152, active_3153, functionRegistry_3154, expressionRegistry_3155, bindingFunctions_3156, typeRegistry_3157, typeItems_3158, registry_3159, changed_3160) => {
__wm_tail_176: while (true) {
{
const __wm_scalar_204_0 = expressions_3151;
const __wm_scalar_204_1 = fn_3152;
const __wm_scalar_204_2 = active_3153;
const __wm_scalar_204_3 = functionRegistry_3154;
const __wm_scalar_204_4 = expressionRegistry_3155;
const __wm_scalar_204_5 = bindingFunctions_3156;
const __wm_scalar_204_6 = typeRegistry_3157;
const __wm_scalar_204_7 = typeItems_3158;
const __wm_scalar_204_8 = registry_3159;
const __wm_scalar_204_9 = changed_3160;
if (__wm_scalar_204_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_204_1, fn_3152) && __wm_eq(__wm_scalar_204_2, active_3153) && __wm_eq(__wm_scalar_204_3, functionRegistry_3154) && __wm_eq(__wm_scalar_204_4, expressionRegistry_3155) && __wm_eq(__wm_scalar_204_5, bindingFunctions_3156) && __wm_eq(__wm_scalar_204_6, typeRegistry_3157) && __wm_eq(__wm_scalar_204_7, typeItems_3158) && __wm_eq(__wm_scalar_204_8, registry_3159) && __wm_eq(__wm_scalar_204_9, changed_3160)) {

return [registry_3159, changed_3160];
} else if (__wm_scalar_204_0?.ctor === -6 && __wm_scalar_204_0.args.length === 1 && __wm_is_tuple(__wm_scalar_204_0.args[0]) && __wm_scalar_204_0.args[0].length === 2 && __wm_eq(__wm_scalar_204_1, fn_3152) && __wm_eq(__wm_scalar_204_2, active_3153) && __wm_eq(__wm_scalar_204_3, functionRegistry_3154) && __wm_eq(__wm_scalar_204_4, expressionRegistry_3155) && __wm_eq(__wm_scalar_204_5, bindingFunctions_3156) && __wm_eq(__wm_scalar_204_6, typeRegistry_3157) && __wm_eq(__wm_scalar_204_7, typeItems_3158) && __wm_eq(__wm_scalar_204_8, registry_3159) && __wm_eq(__wm_scalar_204_9, changed_3160)) {
const expression_3161 = __wm_scalar_204_0.args[0][0];
const rest_3162 = __wm_scalar_204_0.args[0][1];
{
const currentFn_3163 = fn_3152;
const __wm_bind_104 = (__wm_eq(expression_3161.kind, "call") ? ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2) {
const calleeId_3164 = __v.args[0][0];
const argumentIds_3165 = __v.args[0][1];
const __wm_return_value_64 = Map.get([expressionRegistry_3155, calleeId_3164]);
if (__wm_return_value_64?.ctor === -2 && __wm_return_value_64.args.length === 1) {
const callee_3166 = __wm_return_value_64.args[0];
const __wm_return_value_65 = Map.get([bindingFunctions_3156, callee_3166.bindingId]);
if (__wm_return_value_65?.ctor === -2 && __wm_return_value_65.args.length === 1) {
const functionId_3167 = __wm_return_value_65.args[0];
const __wm_return_value_66 = Map.get([functionRegistry_3154, functionId_3167]);
if (__wm_return_value_66?.ctor === -2 && __wm_return_value_66.args.length === 1) {
const rawCalleeFn_3168 = __wm_return_value_66.args[0];
const calleeFn_3169 = rawCalleeFn_3168;
if (__wm_eq(calleeFn_3169.id, currentFn_3163.id)) {
return applyCallConstraint_3023__wm_d6(expression_3161, expressionRegistry_3155, typeRegistry_3157, functionRegistry_3154, bindingFunctions_3156, registry_3159);
} else {
if (Map.has([active_3153, calleeFn_3169.id])) {
return [registry_3159, false];
} else {
const argumentRepresentations_3170 = callArgumentRepresentations_3097__wm_d5(argumentIds_3165, expressionRegistry_3155, typeRegistry_3157, registry_3159, __wm_basis_Nil);
const callResultRepresentation_3171 = concreteRepresentation_3070__wm_d3(typeRegistry_3157, registry_3159, expression_3161.typeId);
const calleeRepresentations_3172 = solveFunctionInstance_3123__wm_d9(calleeFn_3169, argumentRepresentations_3170, callResultRepresentation_3171, active_3153, functionRegistry_3154, expressionRegistry_3155, bindingFunctions_3156, typeRegistry_3157, typeItems_3158);
const resolvedParams_3173 = functionParamRepresentations_3089__wm_d4(Js.Array.toList(calleeFn_3169.params), typeRegistry_3157, calleeRepresentations_3172, __wm_basis_Nil);
const resolvedResult_3174 = concreteRepresentation_3070__wm_d3(typeRegistry_3157, calleeRepresentations_3172, calleeFn_3169.resultTypeId);
const __wm_bind_105 = mergeArgumentRepresentations_3108__wm_d6(argumentIds_3165, resolvedParams_3173, expressionRegistry_3155, typeRegistry_3157, registry_3159, false);
if (!(__wm_is_tuple(__wm_bind_105) && __wm_bind_105.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withArguments_3175 = __wm_bind_105[0];
const argumentsChanged_3176 = __wm_bind_105[1];
const __wm_bind_106 = setTypeRepresentation_3076__wm_d4(expression_3161.typeId, resolvedResult_3174, typeRegistry_3157, withArguments_3175);
if (!(__wm_is_tuple(__wm_bind_106) && __wm_bind_106.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withResult_3177 = __wm_bind_106[0];
const resultChanged_3178 = __wm_bind_106[1];
return [withResult_3177, __wm_op_or_d2(argumentsChanged_3176, resultChanged_3178)];
}
}
} else if (__wm_return_value_66 === __wm_basis_None) {

return [registry_3159, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_65 === __wm_basis_None) {

return [registry_3159, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_64 === __wm_basis_None) {

return [registry_3159, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__v === __wm_basis_Nil) {

return [registry_3159, false];
}
__wm_fail("Match", "non-exhaustive match");
})(Js.Array.toList(expression_3161.children)) : (() => {
const typeIds_3179 = constraintTypeIds_2985__wm_d3(expression_3161, expressionRegistry_3155, typeRegistry_3157);
return applyNumericGroup_2989__wm_d2(typeIds_3179, registry_3159);
})());
if (!(__wm_is_tuple(__wm_bind_104) && __wm_bind_104.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_3180 = __wm_bind_104[0];
const expressionChanged_3181 = __wm_bind_104[1];
{
const __wm_tail_arg_237_0 = rest_3162;
const __wm_tail_arg_237_1 = fn_3152;
const __wm_tail_arg_237_2 = active_3153;
const __wm_tail_arg_237_3 = functionRegistry_3154;
const __wm_tail_arg_237_4 = expressionRegistry_3155;
const __wm_tail_arg_237_5 = bindingFunctions_3156;
const __wm_tail_arg_237_6 = typeRegistry_3157;
const __wm_tail_arg_237_7 = typeItems_3158;
const __wm_tail_arg_237_8 = nextRegistry_3180;
const __wm_tail_arg_237_9 = __wm_op_or_d2(changed_3160, expressionChanged_3181);
expressions_3151 = __wm_tail_arg_237_0;
fn_3152 = __wm_tail_arg_237_1;
active_3153 = __wm_tail_arg_237_2;
functionRegistry_3154 = __wm_tail_arg_237_3;
expressionRegistry_3155 = __wm_tail_arg_237_4;
bindingFunctions_3156 = __wm_tail_arg_237_5;
typeRegistry_3157 = __wm_tail_arg_237_6;
typeItems_3158 = __wm_tail_arg_237_7;
registry_3159 = __wm_tail_arg_237_8;
changed_3160 = __wm_tail_arg_237_9;
continue __wm_tail_176;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const instanceSweep_3125 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return instanceSweep_3125__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
const representationsEqual_3182__wm_d2 = (left_3183, right_3184) => {
const __wm_scalar_205_0 = left_3183;
const __wm_scalar_205_1 = right_3184;
if (__wm_scalar_205_0 === __wm_basis_Nil && __wm_scalar_205_1 === __wm_basis_Nil) {

return true;
} else if (__wm_scalar_205_0?.ctor === -6 && __wm_scalar_205_0.args.length === 1 && __wm_is_tuple(__wm_scalar_205_0.args[0]) && __wm_scalar_205_0.args[0].length === 2 && __wm_scalar_205_1?.ctor === -6 && __wm_scalar_205_1.args.length === 1 && __wm_is_tuple(__wm_scalar_205_1.args[0]) && __wm_scalar_205_1.args[0].length === 2) {
const leftHead_3185 = __wm_scalar_205_0.args[0][0];
const leftRest_3186 = __wm_scalar_205_0.args[0][1];
const rightHead_3187 = __wm_scalar_205_1.args[0][0];
const rightRest_3188 = __wm_scalar_205_1.args[0][1];
const same_3189 = __wm_op_or_d2(__wm_op_or_d2(__wm_op_and_d2(__wm_eq(leftHead_3185, ""), __wm_eq(rightHead_3187, "")), __wm_op_and_d2(__wm_eq(leftHead_3185, "i32"), __wm_eq(rightHead_3187, "i32"))), __wm_op_and_d2(__wm_eq(leftHead_3185, "f32"), __wm_eq(rightHead_3187, "f32")));
return __wm_op_and_d2(same_3189, representationsEqual_3182__wm_d2(leftRest_3186, rightRest_3188));
} else if (true) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
};
const representationsEqual_3182 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return representationsEqual_3182__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findSpecialization_3190__wm_d3 = (entries_3191, paramRepresentations_3192, resultRepresentation_3193) => {
__wm_tail_177: while (true) {
{
const __wm_tail_value_238 = entries_3191;
if (__wm_tail_value_238 === __wm_basis_Nil) {

return __wm_basis_None;
} else if (__wm_tail_value_238?.ctor === -6 && __wm_tail_value_238.args.length === 1 && __wm_is_tuple(__wm_tail_value_238.args[0]) && __wm_tail_value_238.args[0].length === 2) {
const entry_3194 = __wm_tail_value_238.args[0][0];
const rest_3195 = __wm_tail_value_238.args[0][1];
{
const exact_3196 = entry_3194;
const sameResult_3197 = __wm_op_or_d2(__wm_op_or_d2(__wm_op_and_d2(__wm_eq(exact_3196.resultRepresentation, ""), __wm_eq(resultRepresentation_3193, "")), __wm_op_and_d2(__wm_eq(exact_3196.resultRepresentation, "i32"), __wm_eq(resultRepresentation_3193, "i32"))), __wm_op_and_d2(__wm_eq(exact_3196.resultRepresentation, "f32"), __wm_eq(resultRepresentation_3193, "f32")));
if (__wm_op_and_d2(sameResult_3197, representationsEqual_3182__wm_d2(Js.Array.toList(exact_3196.paramRepresentations), paramRepresentations_3192))) {
return __wm_basis_Some(exact_3196.specializationId);
} else {
{
const __wm_tail_arg_239_0 = rest_3195;
const __wm_tail_arg_239_1 = paramRepresentations_3192;
const __wm_tail_arg_239_2 = resultRepresentation_3193;
entries_3191 = __wm_tail_arg_239_0;
paramRepresentations_3192 = __wm_tail_arg_239_1;
resultRepresentation_3193 = __wm_tail_arg_239_2;
continue __wm_tail_177;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findSpecialization_3190 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findSpecialization_3190__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const representationSuffix_3198__wm_d2 = (representations_3199, suffix_3200) => {
__wm_tail_178: while (true) {
{
const __wm_scalar_206_0 = representations_3199;
const __wm_scalar_206_1 = suffix_3200;
if (__wm_scalar_206_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_206_1, suffix_3200)) {

return suffix_3200;
} else if (__wm_scalar_206_0?.ctor === -6 && __wm_scalar_206_0.args.length === 1 && __wm_is_tuple(__wm_scalar_206_0.args[0]) && __wm_scalar_206_0.args[0].length === 2 && __wm_eq(__wm_scalar_206_1, suffix_3200)) {
const representation_3201 = __wm_scalar_206_0.args[0][0];
const rest_3202 = __wm_scalar_206_0.args[0][1];
{
const separator_3203 = (__wm_eq(suffix_3200, "") ? "" : "_");
{
const __wm_tail_arg_240_0 = rest_3202;
const __wm_tail_arg_240_1 = ((suffix_3200 + separator_3203) + representation_3201);
representations_3199 = __wm_tail_arg_240_0;
suffix_3200 = __wm_tail_arg_240_1;
continue __wm_tail_178;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const representationSuffix_3198 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return representationSuffix_3198__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const specializationName_3207__wm_d3 = (fn_3204, paramRepresentations_3205, resultRepresentation_3206) => {
return ((((fn_3204.name + "__gpu_") + representationSuffix_3198__wm_d2(paramRepresentations_3205, "")) + "_to_") + resultRepresentation_3206);
};
const specializationName_3207 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return specializationName_3207__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const addTypeIds_3208__wm_d2 = (typeIds_3209, typeSet_3210) => {
__wm_tail_179: while (true) {
{
const __wm_scalar_207_0 = typeIds_3209;
const __wm_scalar_207_1 = typeSet_3210;
if (__wm_scalar_207_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_207_1, typeSet_3210)) {

return typeSet_3210;
} else if (__wm_scalar_207_0?.ctor === -6 && __wm_scalar_207_0.args.length === 1 && __wm_is_tuple(__wm_scalar_207_0.args[0]) && __wm_scalar_207_0.args[0].length === 2 && __wm_eq(__wm_scalar_207_1, typeSet_3210)) {
const typeId_3211 = __wm_scalar_207_0.args[0][0];
const rest_3212 = __wm_scalar_207_0.args[0][1];
{
const __wm_tail_arg_241_0 = rest_3212;
const __wm_tail_arg_241_1 = Map.set([typeSet_3210, typeId_3211, true]);
typeIds_3209 = __wm_tail_arg_241_0;
typeSet_3210 = __wm_tail_arg_241_1;
continue __wm_tail_179;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addTypeIds_3208 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addTypeIds_3208__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collectInstanceTypeIds_3213__wm_d3 = (expressions_3214, typeRegistry_3215, typeSet_3216) => {
__wm_tail_180: while (true) {
{
const __wm_scalar_208_0 = expressions_3214;
const __wm_scalar_208_1 = typeRegistry_3215;
const __wm_scalar_208_2 = typeSet_3216;
if (__wm_scalar_208_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_208_1, typeRegistry_3215) && __wm_eq(__wm_scalar_208_2, typeSet_3216)) {

return typeSet_3216;
} else if (__wm_scalar_208_0?.ctor === -6 && __wm_scalar_208_0.args.length === 1 && __wm_is_tuple(__wm_scalar_208_0.args[0]) && __wm_scalar_208_0.args[0].length === 2 && __wm_eq(__wm_scalar_208_1, typeRegistry_3215) && __wm_eq(__wm_scalar_208_2, typeSet_3216)) {
const expression_3217 = __wm_scalar_208_0.args[0][0];
const rest_3218 = __wm_scalar_208_0.args[0][1];
{
const exact_3219 = expression_3217;
{
const __wm_tail_arg_242_0 = rest_3218;
const __wm_tail_arg_242_1 = typeRegistry_3215;
const __wm_tail_arg_242_2 = addTypeIds_3208__wm_d2(numericTypeIds_2963__wm_d3(__wm_basis_Cons([exact_3219.typeId, __wm_basis_Nil]), typeRegistry_3215, __wm_basis_Nil), typeSet_3216);
expressions_3214 = __wm_tail_arg_242_0;
typeRegistry_3215 = __wm_tail_arg_242_1;
typeSet_3216 = __wm_tail_arg_242_2;
continue __wm_tail_180;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const collectInstanceTypeIds_3213 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return collectInstanceTypeIds_3213__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const addParamTypeIds_3220__wm_d3 = (params_3221, typeRegistry_3222, typeSet_3223) => {
__wm_tail_181: while (true) {
{
const __wm_scalar_209_0 = params_3221;
const __wm_scalar_209_1 = typeRegistry_3222;
const __wm_scalar_209_2 = typeSet_3223;
if (__wm_scalar_209_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_209_1, typeRegistry_3222) && __wm_eq(__wm_scalar_209_2, typeSet_3223)) {

return typeSet_3223;
} else if (__wm_scalar_209_0?.ctor === -6 && __wm_scalar_209_0.args.length === 1 && __wm_is_tuple(__wm_scalar_209_0.args[0]) && __wm_scalar_209_0.args[0].length === 2 && __wm_eq(__wm_scalar_209_1, typeRegistry_3222) && __wm_eq(__wm_scalar_209_2, typeSet_3223)) {
const param_3224 = __wm_scalar_209_0.args[0][0];
const rest_3225 = __wm_scalar_209_0.args[0][1];
{
const exact_3226 = param_3224;
{
const __wm_tail_arg_243_0 = rest_3225;
const __wm_tail_arg_243_1 = typeRegistry_3222;
const __wm_tail_arg_243_2 = addTypeIds_3208__wm_d2(numericTypeIds_2963__wm_d3(__wm_basis_Cons([exact_3226.typeId, __wm_basis_Nil]), typeRegistry_3222, __wm_basis_Nil), typeSet_3223);
params_3221 = __wm_tail_arg_243_0;
typeRegistry_3222 = __wm_tail_arg_243_1;
typeSet_3223 = __wm_tail_arg_243_2;
continue __wm_tail_181;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addParamTypeIds_3220 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return addParamTypeIds_3220__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const representationFacts_3227__wm_d4 = (typeEntries_3228, typeRegistry_3229, representations_3230, facts_3231) => {
__wm_tail_182: while (true) {
{
const __wm_scalar_210_0 = typeEntries_3228;
const __wm_scalar_210_1 = typeRegistry_3229;
const __wm_scalar_210_2 = representations_3230;
const __wm_scalar_210_3 = facts_3231;
if (__wm_scalar_210_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_210_1, typeRegistry_3229) && __wm_eq(__wm_scalar_210_2, representations_3230) && __wm_eq(__wm_scalar_210_3, facts_3231)) {

return reverseInto_2703__wm_d2(facts_3231, __wm_basis_Nil);
} else if (__wm_scalar_210_0?.ctor === -6 && __wm_scalar_210_0.args.length === 1 && __wm_is_tuple(__wm_scalar_210_0.args[0]) && __wm_scalar_210_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_210_0.args[0][0]) && __wm_scalar_210_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_210_1, typeRegistry_3229) && __wm_eq(__wm_scalar_210_2, representations_3230) && __wm_eq(__wm_scalar_210_3, facts_3231)) {
const typeId_3232 = __wm_scalar_210_0.args[0][0][0];
const _present_3233 = __wm_scalar_210_0.args[0][0][1];
const rest_3234 = __wm_scalar_210_0.args[0][1];
{
const fact_3235 = { typeId: typeId_3232, representation: concreteRepresentation_3070__wm_d3(typeRegistry_3229, representations_3230, typeId_3232) };
{
const __wm_tail_arg_244_0 = rest_3234;
const __wm_tail_arg_244_1 = typeRegistry_3229;
const __wm_tail_arg_244_2 = representations_3230;
const __wm_tail_arg_244_3 = __wm_basis_Cons([fact_3235, facts_3231]);
typeEntries_3228 = __wm_tail_arg_244_0;
typeRegistry_3229 = __wm_tail_arg_244_1;
representations_3230 = __wm_tail_arg_244_2;
facts_3231 = __wm_tail_arg_244_3;
continue __wm_tail_182;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const representationFacts_3227 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return representationFacts_3227__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const specializationTypeFacts_3243__wm_d4 = (fn_3236, expressions_3237, typeRegistry_3238, representations_3239) => {
const withExpressions_3240 = collectInstanceTypeIds_3213__wm_d3(expressions_3237, typeRegistry_3238, Map.empty(Map.numberCompare));
const withParams_3241 = addParamTypeIds_3220__wm_d3(Js.Array.toList(fn_3236.params), typeRegistry_3238, withExpressions_3240);
const allTypes_3242 = addTypeIds_3208__wm_d2(numericTypeIds_2963__wm_d3(__wm_basis_Cons([fn_3236.resultTypeId, __wm_basis_Nil]), typeRegistry_3238, __wm_basis_Nil), withParams_3241);
return representationFacts_3227__wm_d4(Map.toList(allTypes_3242), typeRegistry_3238, representations_3239, __wm_basis_Nil);
};
const specializationTypeFacts_3243 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return specializationTypeFacts_3243__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const initialSpecializationState_3244 = (__arg) => {
if (__arg === undefined) {

return { nextId: 0, registry: Map.empty(Map.numberCompare), specializations: __wm_basis_Nil, rootSpecializations: __wm_basis_Nil, calls: __wm_basis_Nil, diagnostics: __wm_basis_Nil };
}
__wm_fail("Match", "pattern match failure in function");
};
const withSpecializedCall_3247__wm_d2 = (state_3245, call_3246) => {
return { nextId: state_3245.nextId, registry: state_3245.registry, specializations: state_3245.specializations, rootSpecializations: state_3245.rootSpecializations, calls: __wm_basis_Cons([call_3246, state_3245.calls]), diagnostics: state_3245.diagnostics };
};
const withSpecializedCall_3247 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return withSpecializedCall_3247__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const withSpecializationDiagnostic_3250__wm_d2 = (state_3248, diagnostic_3249) => {
return { nextId: state_3248.nextId, registry: state_3248.registry, specializations: state_3248.specializations, rootSpecializations: state_3248.rootSpecializations, calls: state_3248.calls, diagnostics: __wm_basis_Cons([diagnostic_3249, state_3248.diagnostics]) };
};
const withSpecializationDiagnostic_3250 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return withSpecializationDiagnostic_3250__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const mutualRecursionDiagnostic_3253 = (__arg) => {
if (true) {
const expression_3251 = __arg;
const diagnostic_3252 = { code: "gpu.mutual-recursion", message: "mutually recursive GPU functions are not supported by the current specialization pass", spanId: expression_3251.spanId };
return diagnostic_3252;
}
__wm_fail("Match", "pattern match failure in function");
};
const materializeSpecialization_3254__wm_d10 = (fn_3256, requestedParams_3257, requestedResult_3258, active_3259, state_3260, functionRegistry_3261, expressionRegistry_3262, bindingFunctions_3263, typeRegistry_3264, typeItems_3265) => {
const representations_3266 = solveFunctionInstance_3123__wm_d9(fn_3256, requestedParams_3257, requestedResult_3258, Map.empty(Map.numberCompare), functionRegistry_3261, expressionRegistry_3262, bindingFunctions_3263, typeRegistry_3264, typeItems_3265);
const paramRepresentations_3267 = functionParamRepresentations_3089__wm_d4(Js.Array.toList(fn_3256.params), typeRegistry_3264, representations_3266, __wm_basis_Nil);
const resultRepresentation_3268 = concreteRepresentation_3070__wm_d3(typeRegistry_3264, representations_3266, fn_3256.resultTypeId);
const existingEntries_3270 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const entries_3269 = __v.args[0];
return entries_3269;
} else if (__v === __wm_basis_None) {

return __wm_basis_Nil;
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([state_3260.registry, fn_3256.id]));
const __wm_return_value_67 = findSpecialization_3190__wm_d3(existingEntries_3270, paramRepresentations_3267, resultRepresentation_3268);
if (__wm_return_value_67?.ctor === -2 && __wm_return_value_67.args.length === 1) {
const specializationId_3271 = __wm_return_value_67.args[0];
return [state_3260, specializationId_3271];
} else if (__wm_return_value_67 === __wm_basis_None) {

const specializationId_3272 = state_3260.nextId;
const expressions_3273 = collectExpressionItems_3054__wm_d4(__wm_basis_Cons([fn_3256.bodyExprId, __wm_basis_Nil]), expressionRegistry_3262, Map.empty(Map.numberCompare), __wm_basis_Nil);
const specialization_3275 = { id: specializationId_3272, functionId: fn_3256.id, bindingId: fn_3256.bindingId, name: specializationName_3207__wm_d3(fn_3256, paramRepresentations_3267, resultRepresentation_3268), paramTypeIds: Js.Array.fromList(List.map([Js.Array.toList(fn_3256.params), (__arg) => {
if (true) {
const param_3274 = __arg;
return param_3274.typeId;
}
__wm_fail("Match", "pattern match failure in function");
}])), resultTypeId: fn_3256.resultTypeId, paramRepresentations: Js.Array.fromList(paramRepresentations_3267), resultRepresentation: resultRepresentation_3268, typeFacts: Js.Array.fromList(specializationTypeFacts_3243__wm_d4(fn_3256, expressions_3273, typeRegistry_3264, representations_3266)) };
const entry_3276 = { specializationId: specializationId_3272, paramRepresentations: Js.Array.fromList(paramRepresentations_3267), resultRepresentation: resultRepresentation_3268 };
const registered_3277 = { nextId: (specializationId_3272 + 1), registry: Map.set([state_3260.registry, fn_3256.id, __wm_basis_Cons([entry_3276, existingEntries_3270])]), specializations: __wm_basis_Cons([specialization_3275, state_3260.specializations]), rootSpecializations: state_3260.rootSpecializations, calls: state_3260.calls, diagnostics: state_3260.diagnostics };
return materializeSpecializedCalls_3255__wm_d11(expressions_3273, fn_3256, specializationId_3272, representations_3266, Map.set([active_3259, fn_3256.id, specializationId_3272]), registered_3277, functionRegistry_3261, expressionRegistry_3262, bindingFunctions_3263, typeRegistry_3264, typeItems_3265);
}
__wm_fail("Match", "non-exhaustive match");
};
const materializeSpecialization_3254 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return materializeSpecialization_3254__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
const materializeSpecializedCalls_3255__wm_d11 = (expressions_3278, fn_3279, callerSpecializationId_3280, representations_3281, active_3282, state_3283, functionRegistry_3284, expressionRegistry_3285, bindingFunctions_3286, typeRegistry_3287, typeItems_3288) => {
__wm_tail_183: while (true) {
{
const __wm_scalar_211_0 = expressions_3278;
const __wm_scalar_211_1 = fn_3279;
const __wm_scalar_211_2 = callerSpecializationId_3280;
const __wm_scalar_211_3 = representations_3281;
const __wm_scalar_211_4 = active_3282;
const __wm_scalar_211_5 = state_3283;
const __wm_scalar_211_6 = functionRegistry_3284;
const __wm_scalar_211_7 = expressionRegistry_3285;
const __wm_scalar_211_8 = bindingFunctions_3286;
const __wm_scalar_211_9 = typeRegistry_3287;
const __wm_scalar_211_10 = typeItems_3288;
if (__wm_scalar_211_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_211_1, fn_3279) && __wm_eq(__wm_scalar_211_2, callerSpecializationId_3280) && __wm_eq(__wm_scalar_211_3, representations_3281) && __wm_eq(__wm_scalar_211_4, active_3282) && __wm_eq(__wm_scalar_211_5, state_3283) && __wm_eq(__wm_scalar_211_6, functionRegistry_3284) && __wm_eq(__wm_scalar_211_7, expressionRegistry_3285) && __wm_eq(__wm_scalar_211_8, bindingFunctions_3286) && __wm_eq(__wm_scalar_211_9, typeRegistry_3287) && __wm_eq(__wm_scalar_211_10, typeItems_3288)) {

return [state_3283, callerSpecializationId_3280];
} else if (__wm_scalar_211_0?.ctor === -6 && __wm_scalar_211_0.args.length === 1 && __wm_is_tuple(__wm_scalar_211_0.args[0]) && __wm_scalar_211_0.args[0].length === 2 && __wm_eq(__wm_scalar_211_1, fn_3279) && __wm_eq(__wm_scalar_211_2, callerSpecializationId_3280) && __wm_eq(__wm_scalar_211_3, representations_3281) && __wm_eq(__wm_scalar_211_4, active_3282) && __wm_eq(__wm_scalar_211_5, state_3283) && __wm_eq(__wm_scalar_211_6, functionRegistry_3284) && __wm_eq(__wm_scalar_211_7, expressionRegistry_3285) && __wm_eq(__wm_scalar_211_8, bindingFunctions_3286) && __wm_eq(__wm_scalar_211_9, typeRegistry_3287) && __wm_eq(__wm_scalar_211_10, typeItems_3288)) {
const expression_3289 = __wm_scalar_211_0.args[0][0];
const rest_3290 = __wm_scalar_211_0.args[0][1];
{
const exactExpression_3291 = expression_3289;
const exactFunction_3292 = fn_3279;
if (__wm_eq(exactExpression_3291.kind, "call")) {
{
const __wm_tail_value_245 = Js.Array.toList(exactExpression_3291.children);
if (__wm_tail_value_245?.ctor === -6 && __wm_tail_value_245.args.length === 1 && __wm_is_tuple(__wm_tail_value_245.args[0]) && __wm_tail_value_245.args[0].length === 2) {
const calleeId_3293 = __wm_tail_value_245.args[0][0];
const argumentIds_3294 = __wm_tail_value_245.args[0][1];
{
const __wm_tail_value_246 = Map.get([expressionRegistry_3285, calleeId_3293]);
if (__wm_tail_value_246?.ctor === -2 && __wm_tail_value_246.args.length === 1) {
const callee_3295 = __wm_tail_value_246.args[0];
{
const exactCallee_3296 = callee_3295;
{
const __wm_tail_value_247 = Map.get([bindingFunctions_3286, exactCallee_3296.bindingId]);
if (__wm_tail_value_247?.ctor === -2 && __wm_tail_value_247.args.length === 1) {
const functionId_3297 = __wm_tail_value_247.args[0];
{
const __wm_tail_value_248 = Map.get([functionRegistry_3284, functionId_3297]);
if (__wm_tail_value_248?.ctor === -2 && __wm_tail_value_248.args.length === 1) {
const rawCalleeFn_3298 = __wm_tail_value_248.args[0];
{
const calleeFn_3299 = rawCalleeFn_3298;
const activeTarget_3300 = Map.get([active_3282, calleeFn_3299.id]);
const argumentRepresentations_3301 = callArgumentRepresentations_3097__wm_d5(argumentIds_3294, expressionRegistry_3285, typeRegistry_3287, representations_3281, __wm_basis_Nil);
const callResultRepresentation_3302 = concreteRepresentation_3070__wm_d3(typeRegistry_3287, representations_3281, exactExpression_3291.typeId);
const __wm_bind_107 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const targetId_3303 = __v.args[0];
const nextState_3304 = (__wm_eq(calleeFn_3299.id, exactFunction_3292.id) ? state_3283 : withSpecializationDiagnostic_3250__wm_d2(state_3283, mutualRecursionDiagnostic_3253(exactExpression_3291)));
return [nextState_3304, targetId_3303];
} else if (__v === __wm_basis_None) {

return materializeSpecialization_3254__wm_d10(calleeFn_3299, argumentRepresentations_3301, callResultRepresentation_3302, active_3282, state_3283, functionRegistry_3284, expressionRegistry_3285, bindingFunctions_3286, typeRegistry_3287, typeItems_3288);
}
__wm_fail("Match", "non-exhaustive match");
})(activeTarget_3300);
if (!(__wm_is_tuple(__wm_bind_107) && __wm_bind_107.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterTarget_3305 = __wm_bind_107[0];
const targetSpecializationId_3306 = __wm_bind_107[1];
const call_3307 = { callerSpecializationId: callerSpecializationId_3280, expressionId: exactExpression_3291.id, targetSpecializationId: targetSpecializationId_3306 };
{
const __wm_tail_arg_249_0 = rest_3290;
const __wm_tail_arg_249_1 = exactFunction_3292;
const __wm_tail_arg_249_2 = callerSpecializationId_3280;
const __wm_tail_arg_249_3 = representations_3281;
const __wm_tail_arg_249_4 = active_3282;
const __wm_tail_arg_249_5 = withSpecializedCall_3247__wm_d2(afterTarget_3305, call_3307);
const __wm_tail_arg_249_6 = functionRegistry_3284;
const __wm_tail_arg_249_7 = expressionRegistry_3285;
const __wm_tail_arg_249_8 = bindingFunctions_3286;
const __wm_tail_arg_249_9 = typeRegistry_3287;
const __wm_tail_arg_249_10 = typeItems_3288;
expressions_3278 = __wm_tail_arg_249_0;
fn_3279 = __wm_tail_arg_249_1;
callerSpecializationId_3280 = __wm_tail_arg_249_2;
representations_3281 = __wm_tail_arg_249_3;
active_3282 = __wm_tail_arg_249_4;
state_3283 = __wm_tail_arg_249_5;
functionRegistry_3284 = __wm_tail_arg_249_6;
expressionRegistry_3285 = __wm_tail_arg_249_7;
bindingFunctions_3286 = __wm_tail_arg_249_8;
typeRegistry_3287 = __wm_tail_arg_249_9;
typeItems_3288 = __wm_tail_arg_249_10;
continue __wm_tail_183;
}
}
} else if (__wm_tail_value_248 === __wm_basis_None) {

{
const __wm_tail_arg_250_0 = rest_3290;
const __wm_tail_arg_250_1 = exactFunction_3292;
const __wm_tail_arg_250_2 = callerSpecializationId_3280;
const __wm_tail_arg_250_3 = representations_3281;
const __wm_tail_arg_250_4 = active_3282;
const __wm_tail_arg_250_5 = state_3283;
const __wm_tail_arg_250_6 = functionRegistry_3284;
const __wm_tail_arg_250_7 = expressionRegistry_3285;
const __wm_tail_arg_250_8 = bindingFunctions_3286;
const __wm_tail_arg_250_9 = typeRegistry_3287;
const __wm_tail_arg_250_10 = typeItems_3288;
expressions_3278 = __wm_tail_arg_250_0;
fn_3279 = __wm_tail_arg_250_1;
callerSpecializationId_3280 = __wm_tail_arg_250_2;
representations_3281 = __wm_tail_arg_250_3;
active_3282 = __wm_tail_arg_250_4;
state_3283 = __wm_tail_arg_250_5;
functionRegistry_3284 = __wm_tail_arg_250_6;
expressionRegistry_3285 = __wm_tail_arg_250_7;
bindingFunctions_3286 = __wm_tail_arg_250_8;
typeRegistry_3287 = __wm_tail_arg_250_9;
typeItems_3288 = __wm_tail_arg_250_10;
continue __wm_tail_183;
}
}
__wm_fail("Match", "non-exhaustive match");
}
} else if (__wm_tail_value_247 === __wm_basis_None) {

{
const __wm_tail_arg_251_0 = rest_3290;
const __wm_tail_arg_251_1 = exactFunction_3292;
const __wm_tail_arg_251_2 = callerSpecializationId_3280;
const __wm_tail_arg_251_3 = representations_3281;
const __wm_tail_arg_251_4 = active_3282;
const __wm_tail_arg_251_5 = state_3283;
const __wm_tail_arg_251_6 = functionRegistry_3284;
const __wm_tail_arg_251_7 = expressionRegistry_3285;
const __wm_tail_arg_251_8 = bindingFunctions_3286;
const __wm_tail_arg_251_9 = typeRegistry_3287;
const __wm_tail_arg_251_10 = typeItems_3288;
expressions_3278 = __wm_tail_arg_251_0;
fn_3279 = __wm_tail_arg_251_1;
callerSpecializationId_3280 = __wm_tail_arg_251_2;
representations_3281 = __wm_tail_arg_251_3;
active_3282 = __wm_tail_arg_251_4;
state_3283 = __wm_tail_arg_251_5;
functionRegistry_3284 = __wm_tail_arg_251_6;
expressionRegistry_3285 = __wm_tail_arg_251_7;
bindingFunctions_3286 = __wm_tail_arg_251_8;
typeRegistry_3287 = __wm_tail_arg_251_9;
typeItems_3288 = __wm_tail_arg_251_10;
continue __wm_tail_183;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
} else if (__wm_tail_value_246 === __wm_basis_None) {

{
const __wm_tail_arg_252_0 = rest_3290;
const __wm_tail_arg_252_1 = exactFunction_3292;
const __wm_tail_arg_252_2 = callerSpecializationId_3280;
const __wm_tail_arg_252_3 = representations_3281;
const __wm_tail_arg_252_4 = active_3282;
const __wm_tail_arg_252_5 = state_3283;
const __wm_tail_arg_252_6 = functionRegistry_3284;
const __wm_tail_arg_252_7 = expressionRegistry_3285;
const __wm_tail_arg_252_8 = bindingFunctions_3286;
const __wm_tail_arg_252_9 = typeRegistry_3287;
const __wm_tail_arg_252_10 = typeItems_3288;
expressions_3278 = __wm_tail_arg_252_0;
fn_3279 = __wm_tail_arg_252_1;
callerSpecializationId_3280 = __wm_tail_arg_252_2;
representations_3281 = __wm_tail_arg_252_3;
active_3282 = __wm_tail_arg_252_4;
state_3283 = __wm_tail_arg_252_5;
functionRegistry_3284 = __wm_tail_arg_252_6;
expressionRegistry_3285 = __wm_tail_arg_252_7;
bindingFunctions_3286 = __wm_tail_arg_252_8;
typeRegistry_3287 = __wm_tail_arg_252_9;
typeItems_3288 = __wm_tail_arg_252_10;
continue __wm_tail_183;
}
}
__wm_fail("Match", "non-exhaustive match");
}
} else if (__wm_tail_value_245 === __wm_basis_Nil) {

{
const __wm_tail_arg_253_0 = rest_3290;
const __wm_tail_arg_253_1 = exactFunction_3292;
const __wm_tail_arg_253_2 = callerSpecializationId_3280;
const __wm_tail_arg_253_3 = representations_3281;
const __wm_tail_arg_253_4 = active_3282;
const __wm_tail_arg_253_5 = state_3283;
const __wm_tail_arg_253_6 = functionRegistry_3284;
const __wm_tail_arg_253_7 = expressionRegistry_3285;
const __wm_tail_arg_253_8 = bindingFunctions_3286;
const __wm_tail_arg_253_9 = typeRegistry_3287;
const __wm_tail_arg_253_10 = typeItems_3288;
expressions_3278 = __wm_tail_arg_253_0;
fn_3279 = __wm_tail_arg_253_1;
callerSpecializationId_3280 = __wm_tail_arg_253_2;
representations_3281 = __wm_tail_arg_253_3;
active_3282 = __wm_tail_arg_253_4;
state_3283 = __wm_tail_arg_253_5;
functionRegistry_3284 = __wm_tail_arg_253_6;
expressionRegistry_3285 = __wm_tail_arg_253_7;
bindingFunctions_3286 = __wm_tail_arg_253_8;
typeRegistry_3287 = __wm_tail_arg_253_9;
typeItems_3288 = __wm_tail_arg_253_10;
continue __wm_tail_183;
}
}
__wm_fail("Match", "non-exhaustive match");
}
} else {
{
const __wm_tail_arg_254_0 = rest_3290;
const __wm_tail_arg_254_1 = exactFunction_3292;
const __wm_tail_arg_254_2 = callerSpecializationId_3280;
const __wm_tail_arg_254_3 = representations_3281;
const __wm_tail_arg_254_4 = active_3282;
const __wm_tail_arg_254_5 = state_3283;
const __wm_tail_arg_254_6 = functionRegistry_3284;
const __wm_tail_arg_254_7 = expressionRegistry_3285;
const __wm_tail_arg_254_8 = bindingFunctions_3286;
const __wm_tail_arg_254_9 = typeRegistry_3287;
const __wm_tail_arg_254_10 = typeItems_3288;
expressions_3278 = __wm_tail_arg_254_0;
fn_3279 = __wm_tail_arg_254_1;
callerSpecializationId_3280 = __wm_tail_arg_254_2;
representations_3281 = __wm_tail_arg_254_3;
active_3282 = __wm_tail_arg_254_4;
state_3283 = __wm_tail_arg_254_5;
functionRegistry_3284 = __wm_tail_arg_254_6;
expressionRegistry_3285 = __wm_tail_arg_254_7;
bindingFunctions_3286 = __wm_tail_arg_254_8;
typeRegistry_3287 = __wm_tail_arg_254_9;
typeItems_3288 = __wm_tail_arg_254_10;
continue __wm_tail_183;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const materializeSpecializedCalls_3255 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 11) return materializeSpecializedCalls_3255__wm_d11(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9], __arg[10]);
__wm_fail("Match", "pattern match failure in function");
};
const materializeRootSpecializations_3308__wm_d7 = (roots_3309, state_3310, functionRegistry_3311, expressionRegistry_3312, bindingFunctions_3313, typeRegistry_3314, typeItems_3315) => {
__wm_tail_184: while (true) {
{
const __wm_scalar_212_0 = roots_3309;
const __wm_scalar_212_1 = state_3310;
const __wm_scalar_212_2 = functionRegistry_3311;
const __wm_scalar_212_3 = expressionRegistry_3312;
const __wm_scalar_212_4 = bindingFunctions_3313;
const __wm_scalar_212_5 = typeRegistry_3314;
const __wm_scalar_212_6 = typeItems_3315;
if (__wm_scalar_212_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_212_1, state_3310) && __wm_eq(__wm_scalar_212_2, functionRegistry_3311) && __wm_eq(__wm_scalar_212_3, expressionRegistry_3312) && __wm_eq(__wm_scalar_212_4, bindingFunctions_3313) && __wm_eq(__wm_scalar_212_5, typeRegistry_3314) && __wm_eq(__wm_scalar_212_6, typeItems_3315)) {

return state_3310;
} else if (__wm_scalar_212_0?.ctor === -6 && __wm_scalar_212_0.args.length === 1 && __wm_is_tuple(__wm_scalar_212_0.args[0]) && __wm_scalar_212_0.args[0].length === 2 && __wm_eq(__wm_scalar_212_1, state_3310) && __wm_eq(__wm_scalar_212_2, functionRegistry_3311) && __wm_eq(__wm_scalar_212_3, expressionRegistry_3312) && __wm_eq(__wm_scalar_212_4, bindingFunctions_3313) && __wm_eq(__wm_scalar_212_5, typeRegistry_3314) && __wm_eq(__wm_scalar_212_6, typeItems_3315)) {
const root_3316 = __wm_scalar_212_0.args[0][0];
const rest_3317 = __wm_scalar_212_0.args[0][1];
{
const gpuRoot_3318 = root_3316;
{
const __wm_tail_value_255 = Map.get([functionRegistry_3311, gpuRoot_3318.functionId]);
if (__wm_tail_value_255?.ctor === -2 && __wm_tail_value_255.args.length === 1) {
const rawFn_3319 = __wm_tail_value_255.args[0];
{
const fn_3320 = rawFn_3319;
const __wm_bind_108 = materializeSpecialization_3254__wm_d10(fn_3320, __wm_basis_Nil, "", Map.empty(Map.numberCompare), state_3310, functionRegistry_3311, expressionRegistry_3312, bindingFunctions_3313, typeRegistry_3314, typeItems_3315);
if (!(__wm_is_tuple(__wm_bind_108) && __wm_bind_108.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterSpecialization_3321 = __wm_bind_108[0];
const specializationId_3322 = __wm_bind_108[1];
const rootSpecialization_3323 = { regionId: gpuRoot_3318.regionId, specializationId: specializationId_3322 };
const withRoot_3324 = { nextId: afterSpecialization_3321.nextId, registry: afterSpecialization_3321.registry, specializations: afterSpecialization_3321.specializations, rootSpecializations: __wm_basis_Cons([rootSpecialization_3323, afterSpecialization_3321.rootSpecializations]), calls: afterSpecialization_3321.calls, diagnostics: afterSpecialization_3321.diagnostics };
{
const __wm_tail_arg_256_0 = rest_3317;
const __wm_tail_arg_256_1 = withRoot_3324;
const __wm_tail_arg_256_2 = functionRegistry_3311;
const __wm_tail_arg_256_3 = expressionRegistry_3312;
const __wm_tail_arg_256_4 = bindingFunctions_3313;
const __wm_tail_arg_256_5 = typeRegistry_3314;
const __wm_tail_arg_256_6 = typeItems_3315;
roots_3309 = __wm_tail_arg_256_0;
state_3310 = __wm_tail_arg_256_1;
functionRegistry_3311 = __wm_tail_arg_256_2;
expressionRegistry_3312 = __wm_tail_arg_256_3;
bindingFunctions_3313 = __wm_tail_arg_256_4;
typeRegistry_3314 = __wm_tail_arg_256_5;
typeItems_3315 = __wm_tail_arg_256_6;
continue __wm_tail_184;
}
}
} else if (__wm_tail_value_255 === __wm_basis_None) {

{
const __wm_tail_arg_257_0 = rest_3317;
const __wm_tail_arg_257_1 = state_3310;
const __wm_tail_arg_257_2 = functionRegistry_3311;
const __wm_tail_arg_257_3 = expressionRegistry_3312;
const __wm_tail_arg_257_4 = bindingFunctions_3313;
const __wm_tail_arg_257_5 = typeRegistry_3314;
const __wm_tail_arg_257_6 = typeItems_3315;
roots_3309 = __wm_tail_arg_257_0;
state_3310 = __wm_tail_arg_257_1;
functionRegistry_3311 = __wm_tail_arg_257_2;
expressionRegistry_3312 = __wm_tail_arg_257_3;
bindingFunctions_3313 = __wm_tail_arg_257_4;
typeRegistry_3314 = __wm_tail_arg_257_5;
typeItems_3315 = __wm_tail_arg_257_6;
continue __wm_tail_184;
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
const materializeRootSpecializations_3308 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return materializeRootSpecializations_3308__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const initialIrBuildState_3325 = (__arg) => {
if (__arg === undefined) {

return { nextExpressionId: 0, functions: Map.empty(Map.numberCompare), expressions: Map.empty(Map.numberCompare) };
}
__wm_fail("Match", "pattern match failure in function");
};
const indexRepresentationFacts_3326__wm_d2 = (facts_3327, registry_3328) => {
__wm_tail_185: while (true) {
{
const __wm_scalar_213_0 = facts_3327;
const __wm_scalar_213_1 = registry_3328;
if (__wm_scalar_213_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_213_1, registry_3328)) {

return registry_3328;
} else if (__wm_scalar_213_0?.ctor === -6 && __wm_scalar_213_0.args.length === 1 && __wm_is_tuple(__wm_scalar_213_0.args[0]) && __wm_scalar_213_0.args[0].length === 2 && __wm_eq(__wm_scalar_213_1, registry_3328)) {
const fact_3329 = __wm_scalar_213_0.args[0][0];
const rest_3330 = __wm_scalar_213_0.args[0][1];
{
const exact_3331 = fact_3329;
{
const __wm_tail_arg_258_0 = rest_3330;
const __wm_tail_arg_258_1 = Map.set([registry_3328, exact_3331.typeId, exact_3331.representation]);
facts_3327 = __wm_tail_arg_258_0;
registry_3328 = __wm_tail_arg_258_1;
continue __wm_tail_185;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexRepresentationFacts_3326 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexRepresentationFacts_3326__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const irRepresentation_3335__wm_d2 = (facts_3332, typeId_3333) => {
const __wm_return_value_68 = Map.get([facts_3332, typeId_3333]);
if (__wm_return_value_68?.ctor === -2 && __wm_return_value_68.args.length === 1) {
const representation_3334 = __wm_return_value_68.args[0];
return representation_3334;
} else if (__wm_return_value_68 === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const irRepresentation_3335 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return irRepresentation_3335__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const specializedCallTarget_3336__wm_d3 = (calls_3337, specializationId_3338, expressionId_3339) => {
__wm_tail_186: while (true) {
{
const __wm_scalar_214_0 = calls_3337;
const __wm_scalar_214_1 = specializationId_3338;
const __wm_scalar_214_2 = expressionId_3339;
if (__wm_scalar_214_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_214_1, specializationId_3338) && __wm_eq(__wm_scalar_214_2, expressionId_3339)) {

return __wm_op_sub(1);
} else if (__wm_scalar_214_0?.ctor === -6 && __wm_scalar_214_0.args.length === 1 && __wm_is_tuple(__wm_scalar_214_0.args[0]) && __wm_scalar_214_0.args[0].length === 2 && __wm_eq(__wm_scalar_214_1, specializationId_3338) && __wm_eq(__wm_scalar_214_2, expressionId_3339)) {
const rawCall_3340 = __wm_scalar_214_0.args[0][0];
const rest_3341 = __wm_scalar_214_0.args[0][1];
{
const call_3342 = rawCall_3340;
if (__wm_op_and_d2(__wm_eq(call_3342.callerSpecializationId, specializationId_3338), __wm_eq(call_3342.expressionId, expressionId_3339))) {
return call_3342.targetSpecializationId;
} else {
{
const __wm_tail_arg_259_0 = rest_3341;
const __wm_tail_arg_259_1 = specializationId_3338;
const __wm_tail_arg_259_2 = expressionId_3339;
calls_3337 = __wm_tail_arg_259_0;
specializationId_3338 = __wm_tail_arg_259_1;
expressionId_3339 = __wm_tail_arg_259_2;
continue __wm_tail_186;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const specializedCallTarget_3336 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return specializedCallTarget_3336__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const irValueKind_3346__wm_d3 = (expression_3343, bound_3344, bindingFunctions_3345) => {
if (__wm_op_or_d2(__wm_op_or_d2(__wm_op_or_d2(__wm_eq(expression_3343.kind, "number"), __wm_eq(expression_3343.kind, "bool")), __wm_eq(expression_3343.kind, "string")), __wm_eq(expression_3343.kind, "void"))) {
return "literal";
} else {
if (__wm_eq(expression_3343.kind, "var")) {
if ((expression_3343.bindingId < 0)) {
return "unresolved";
} else {
if (Map.has([bound_3344, expression_3343.bindingId])) {
return "local";
} else {
if (Map.has([bindingFunctions_3345, expression_3343.bindingId])) {
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
const irValueKind_3346 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return irValueKind_3346__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const reifyIrExpression_3347__wm_d8 = (sourceExpressionId_3349, specializationId_3350, facts_3351, bound_3352, calls_3353, expressionRegistry_3354, bindingFunctions_3355, state_3356) => {
const __wm_return_value_69 = Map.get([expressionRegistry_3354, sourceExpressionId_3349]);
if (__wm_return_value_69 === __wm_basis_None) {

return [state_3356, __wm_op_sub(1)];
} else if (__wm_return_value_69?.ctor === -2 && __wm_return_value_69.args.length === 1) {
const rawExpression_3357 = __wm_return_value_69.args[0];
const expression_3358 = rawExpression_3357;
const irExpressionId_3359 = state_3356.nextExpressionId;
const reserved_3360 = { nextExpressionId: (irExpressionId_3359 + 1), functions: state_3356.functions, expressions: state_3356.expressions };
const __wm_bind_109 = reifyIrChildren_3348__wm_d9(Js.Array.toList(expression_3358.children), specializationId_3350, facts_3351, bound_3352, calls_3353, expressionRegistry_3354, bindingFunctions_3355, reserved_3360, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_109) && __wm_bind_109.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withChildren_3361 = __wm_bind_109[0];
const childIds_3362 = __wm_bind_109[1];
const irExpression_3363 = { id: irExpressionId_3359, specializationId: specializationId_3350, sourceExprId: expression_3358.id, kind: expression_3358.kind, typeId: expression_3358.typeId, representation: irRepresentation_3335__wm_d2(facts_3351, expression_3358.typeId), spanId: expression_3358.spanId, bindingId: expression_3358.bindingId, name: expression_3358.name, operator: expression_3358.operator, numberValue: expression_3358.numberValue, boolValue: expression_3358.boolValue, children: Js.Array.fromList(childIds_3362), capability: expression_3358.capability, valueKind: irValueKind_3346__wm_d3(expression_3358, bound_3352, bindingFunctions_3355), callTargetSpecializationId: specializedCallTarget_3336__wm_d3(calls_3353, specializationId_3350, expression_3358.id) };
const completed_3364 = { nextExpressionId: withChildren_3361.nextExpressionId, functions: withChildren_3361.functions, expressions: Map.set([withChildren_3361.expressions, irExpressionId_3359, irExpression_3363]) };
return [completed_3364, irExpressionId_3359];
}
__wm_fail("Match", "non-exhaustive match");
};
const reifyIrExpression_3347 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 8) return reifyIrExpression_3347__wm_d8(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7]);
__wm_fail("Match", "pattern match failure in function");
};
const reifyIrChildren_3348__wm_d9 = (sourceChildIds_3365, specializationId_3366, facts_3367, bound_3368, calls_3369, expressionRegistry_3370, bindingFunctions_3371, state_3372, childIds_3373) => {
__wm_tail_187: while (true) {
{
const __wm_scalar_215_0 = sourceChildIds_3365;
const __wm_scalar_215_1 = specializationId_3366;
const __wm_scalar_215_2 = facts_3367;
const __wm_scalar_215_3 = bound_3368;
const __wm_scalar_215_4 = calls_3369;
const __wm_scalar_215_5 = expressionRegistry_3370;
const __wm_scalar_215_6 = bindingFunctions_3371;
const __wm_scalar_215_7 = state_3372;
const __wm_scalar_215_8 = childIds_3373;
if (__wm_scalar_215_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_215_1, specializationId_3366) && __wm_eq(__wm_scalar_215_2, facts_3367) && __wm_eq(__wm_scalar_215_3, bound_3368) && __wm_eq(__wm_scalar_215_4, calls_3369) && __wm_eq(__wm_scalar_215_5, expressionRegistry_3370) && __wm_eq(__wm_scalar_215_6, bindingFunctions_3371) && __wm_eq(__wm_scalar_215_7, state_3372) && __wm_eq(__wm_scalar_215_8, childIds_3373)) {

return [state_3372, reverseInto_2703__wm_d2(childIds_3373, __wm_basis_Nil)];
} else if (__wm_scalar_215_0?.ctor === -6 && __wm_scalar_215_0.args.length === 1 && __wm_is_tuple(__wm_scalar_215_0.args[0]) && __wm_scalar_215_0.args[0].length === 2 && __wm_eq(__wm_scalar_215_1, specializationId_3366) && __wm_eq(__wm_scalar_215_2, facts_3367) && __wm_eq(__wm_scalar_215_3, bound_3368) && __wm_eq(__wm_scalar_215_4, calls_3369) && __wm_eq(__wm_scalar_215_5, expressionRegistry_3370) && __wm_eq(__wm_scalar_215_6, bindingFunctions_3371) && __wm_eq(__wm_scalar_215_7, state_3372) && __wm_eq(__wm_scalar_215_8, childIds_3373)) {
const sourceChildId_3374 = __wm_scalar_215_0.args[0][0];
const rest_3375 = __wm_scalar_215_0.args[0][1];
{
const __wm_bind_110 = reifyIrExpression_3347__wm_d8(sourceChildId_3374, specializationId_3366, facts_3367, bound_3368, calls_3369, expressionRegistry_3370, bindingFunctions_3371, state_3372);
if (!(__wm_is_tuple(__wm_bind_110) && __wm_bind_110.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextState_3376 = __wm_bind_110[0];
const childId_3377 = __wm_bind_110[1];
{
const __wm_tail_arg_260_0 = rest_3375;
const __wm_tail_arg_260_1 = specializationId_3366;
const __wm_tail_arg_260_2 = facts_3367;
const __wm_tail_arg_260_3 = bound_3368;
const __wm_tail_arg_260_4 = calls_3369;
const __wm_tail_arg_260_5 = expressionRegistry_3370;
const __wm_tail_arg_260_6 = bindingFunctions_3371;
const __wm_tail_arg_260_7 = nextState_3376;
const __wm_tail_arg_260_8 = __wm_basis_Cons([childId_3377, childIds_3373]);
sourceChildIds_3365 = __wm_tail_arg_260_0;
specializationId_3366 = __wm_tail_arg_260_1;
facts_3367 = __wm_tail_arg_260_2;
bound_3368 = __wm_tail_arg_260_3;
calls_3369 = __wm_tail_arg_260_4;
expressionRegistry_3370 = __wm_tail_arg_260_5;
bindingFunctions_3371 = __wm_tail_arg_260_6;
state_3372 = __wm_tail_arg_260_7;
childIds_3373 = __wm_tail_arg_260_8;
continue __wm_tail_187;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reifyIrChildren_3348 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return reifyIrChildren_3348__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const reifyIrParams_3378__wm_d3 = (params_3379, facts_3380, output_3381) => {
__wm_tail_188: while (true) {
{
const __wm_scalar_216_0 = params_3379;
const __wm_scalar_216_1 = facts_3380;
const __wm_scalar_216_2 = output_3381;
if (__wm_scalar_216_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_216_1, facts_3380) && __wm_eq(__wm_scalar_216_2, output_3381)) {

return reverseInto_2703__wm_d2(output_3381, __wm_basis_Nil);
} else if (__wm_scalar_216_0?.ctor === -6 && __wm_scalar_216_0.args.length === 1 && __wm_is_tuple(__wm_scalar_216_0.args[0]) && __wm_scalar_216_0.args[0].length === 2 && __wm_eq(__wm_scalar_216_1, facts_3380) && __wm_eq(__wm_scalar_216_2, output_3381)) {
const rawParam_3382 = __wm_scalar_216_0.args[0][0];
const rest_3383 = __wm_scalar_216_0.args[0][1];
{
const param_3384 = rawParam_3382;
const irParam_3385 = { bindingId: param_3384.bindingId, name: param_3384.name, typeId: param_3384.typeId, representation: irRepresentation_3335__wm_d2(facts_3380, param_3384.typeId) };
{
const __wm_tail_arg_261_0 = rest_3383;
const __wm_tail_arg_261_1 = facts_3380;
const __wm_tail_arg_261_2 = __wm_basis_Cons([irParam_3385, output_3381]);
params_3379 = __wm_tail_arg_261_0;
facts_3380 = __wm_tail_arg_261_1;
output_3381 = __wm_tail_arg_261_2;
continue __wm_tail_188;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reifyIrParams_3378 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return reifyIrParams_3378__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const reifyIrSpecializations_3386__wm_d6 = (specializations_3387, calls_3388, functionRegistry_3389, expressionRegistry_3390, bindingFunctions_3391, state_3392) => {
__wm_tail_189: while (true) {
{
const __wm_scalar_217_0 = specializations_3387;
const __wm_scalar_217_1 = calls_3388;
const __wm_scalar_217_2 = functionRegistry_3389;
const __wm_scalar_217_3 = expressionRegistry_3390;
const __wm_scalar_217_4 = bindingFunctions_3391;
const __wm_scalar_217_5 = state_3392;
if (__wm_scalar_217_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_217_1, calls_3388) && __wm_eq(__wm_scalar_217_2, functionRegistry_3389) && __wm_eq(__wm_scalar_217_3, expressionRegistry_3390) && __wm_eq(__wm_scalar_217_4, bindingFunctions_3391) && __wm_eq(__wm_scalar_217_5, state_3392)) {

return state_3392;
} else if (__wm_scalar_217_0?.ctor === -6 && __wm_scalar_217_0.args.length === 1 && __wm_is_tuple(__wm_scalar_217_0.args[0]) && __wm_scalar_217_0.args[0].length === 2 && __wm_eq(__wm_scalar_217_1, calls_3388) && __wm_eq(__wm_scalar_217_2, functionRegistry_3389) && __wm_eq(__wm_scalar_217_3, expressionRegistry_3390) && __wm_eq(__wm_scalar_217_4, bindingFunctions_3391) && __wm_eq(__wm_scalar_217_5, state_3392)) {
const rawSpecialization_3393 = __wm_scalar_217_0.args[0][0];
const rest_3394 = __wm_scalar_217_0.args[0][1];
{
const specialization_3395 = rawSpecialization_3393;
{
const __wm_tail_value_262 = Map.get([functionRegistry_3389, specialization_3395.functionId]);
if (__wm_tail_value_262?.ctor === -2 && __wm_tail_value_262.args.length === 1) {
const rawFn_3396 = __wm_tail_value_262.args[0];
{
const fn_3397 = rawFn_3396;
const facts_3398 = indexRepresentationFacts_3326__wm_d2(Js.Array.toList(specialization_3395.typeFacts), Map.empty(Map.numberCompare));
const paramBound_3399 = bindParams_2793__wm_d2(Js.Array.toList(fn_3397.params), Map.empty(Map.numberCompare));
const bound_3400 = collectLocalBindings_2799__wm_d4(__wm_basis_Cons([fn_3397.bodyExprId, __wm_basis_Nil]), expressionRegistry_3390, Map.empty(Map.numberCompare), paramBound_3399);
const __wm_bind_111 = reifyIrExpression_3347__wm_d8(fn_3397.bodyExprId, specialization_3395.id, facts_3398, bound_3400, calls_3388, expressionRegistry_3390, bindingFunctions_3391, state_3392);
if (!(__wm_is_tuple(__wm_bind_111) && __wm_bind_111.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withBody_3401 = __wm_bind_111[0];
const bodyExprId_3402 = __wm_bind_111[1];
const irFunction_3403 = { specializationId: specialization_3395.id, functionId: fn_3397.id, bindingId: fn_3397.bindingId, name: specialization_3395.name, params: Js.Array.fromList(reifyIrParams_3378__wm_d3(Js.Array.toList(fn_3397.params), facts_3398, __wm_basis_Nil)), resultTypeId: fn_3397.resultTypeId, resultRepresentation: specialization_3395.resultRepresentation, bodyExprId: bodyExprId_3402, spanId: fn_3397.spanId };
const completed_3404 = { nextExpressionId: withBody_3401.nextExpressionId, functions: Map.set([withBody_3401.functions, specialization_3395.id, irFunction_3403]), expressions: withBody_3401.expressions };
{
const __wm_tail_arg_263_0 = rest_3394;
const __wm_tail_arg_263_1 = calls_3388;
const __wm_tail_arg_263_2 = functionRegistry_3389;
const __wm_tail_arg_263_3 = expressionRegistry_3390;
const __wm_tail_arg_263_4 = bindingFunctions_3391;
const __wm_tail_arg_263_5 = completed_3404;
specializations_3387 = __wm_tail_arg_263_0;
calls_3388 = __wm_tail_arg_263_1;
functionRegistry_3389 = __wm_tail_arg_263_2;
expressionRegistry_3390 = __wm_tail_arg_263_3;
bindingFunctions_3391 = __wm_tail_arg_263_4;
state_3392 = __wm_tail_arg_263_5;
continue __wm_tail_189;
}
}
} else if (__wm_tail_value_262 === __wm_basis_None) {

{
const __wm_tail_arg_264_0 = rest_3394;
const __wm_tail_arg_264_1 = calls_3388;
const __wm_tail_arg_264_2 = functionRegistry_3389;
const __wm_tail_arg_264_3 = expressionRegistry_3390;
const __wm_tail_arg_264_4 = bindingFunctions_3391;
const __wm_tail_arg_264_5 = state_3392;
specializations_3387 = __wm_tail_arg_264_0;
calls_3388 = __wm_tail_arg_264_1;
functionRegistry_3389 = __wm_tail_arg_264_2;
expressionRegistry_3390 = __wm_tail_arg_264_3;
bindingFunctions_3391 = __wm_tail_arg_264_4;
state_3392 = __wm_tail_arg_264_5;
continue __wm_tail_189;
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
const reifyIrSpecializations_3386 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return reifyIrSpecializations_3386__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const irFunctionValues_3405__wm_d2 = (entries_3406, values_3407) => {
__wm_tail_190: while (true) {
{
const __wm_scalar_218_0 = entries_3406;
const __wm_scalar_218_1 = values_3407;
if (__wm_scalar_218_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_218_1, values_3407)) {

return reverseInto_2703__wm_d2(values_3407, __wm_basis_Nil);
} else if (__wm_scalar_218_0?.ctor === -6 && __wm_scalar_218_0.args.length === 1 && __wm_is_tuple(__wm_scalar_218_0.args[0]) && __wm_scalar_218_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_218_0.args[0][0]) && __wm_scalar_218_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_218_1, values_3407)) {
const _id_3408 = __wm_scalar_218_0.args[0][0][0];
const fn_3409 = __wm_scalar_218_0.args[0][0][1];
const rest_3410 = __wm_scalar_218_0.args[0][1];
{
const __wm_tail_arg_265_0 = rest_3410;
const __wm_tail_arg_265_1 = __wm_basis_Cons([fn_3409, values_3407]);
entries_3406 = __wm_tail_arg_265_0;
values_3407 = __wm_tail_arg_265_1;
continue __wm_tail_190;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const irFunctionValues_3405 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return irFunctionValues_3405__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const irExpressionValues_3411__wm_d2 = (entries_3412, values_3413) => {
__wm_tail_191: while (true) {
{
const __wm_scalar_219_0 = entries_3412;
const __wm_scalar_219_1 = values_3413;
if (__wm_scalar_219_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_219_1, values_3413)) {

return reverseInto_2703__wm_d2(values_3413, __wm_basis_Nil);
} else if (__wm_scalar_219_0?.ctor === -6 && __wm_scalar_219_0.args.length === 1 && __wm_is_tuple(__wm_scalar_219_0.args[0]) && __wm_scalar_219_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_219_0.args[0][0]) && __wm_scalar_219_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_219_1, values_3413)) {
const _id_3414 = __wm_scalar_219_0.args[0][0][0];
const expression_3415 = __wm_scalar_219_0.args[0][0][1];
const rest_3416 = __wm_scalar_219_0.args[0][1];
{
const __wm_tail_arg_266_0 = rest_3416;
const __wm_tail_arg_266_1 = __wm_basis_Cons([expression_3415, values_3413]);
entries_3412 = __wm_tail_arg_266_0;
values_3413 = __wm_tail_arg_266_1;
continue __wm_tail_191;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const irExpressionValues_3411 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return irExpressionValues_3411__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeConsensusRepresentation_3419__wm_d2 = (previous_3417, next_3418) => {
if (__wm_eq(previous_3417, "")) {
return next_3418;
} else {
if (__wm_eq(previous_3417, next_3418)) {
return previous_3417;
} else {
return "conflict";
}
}
};
const mergeConsensusRepresentation_3419 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return mergeConsensusRepresentation_3419__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const addConsensusFacts_3420__wm_d2 = (facts_3421, consensus_3422) => {
__wm_tail_192: while (true) {
{
const __wm_scalar_220_0 = facts_3421;
const __wm_scalar_220_1 = consensus_3422;
if (__wm_scalar_220_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_220_1, consensus_3422)) {

return consensus_3422;
} else if (__wm_scalar_220_0?.ctor === -6 && __wm_scalar_220_0.args.length === 1 && __wm_is_tuple(__wm_scalar_220_0.args[0]) && __wm_scalar_220_0.args[0].length === 2 && __wm_eq(__wm_scalar_220_1, consensus_3422)) {
const fact_3423 = __wm_scalar_220_0.args[0][0];
const rest_3424 = __wm_scalar_220_0.args[0][1];
{
const exact_3425 = fact_3423;
const previous_3426 = representationOf_2924__wm_d2(consensus_3422, exact_3425.typeId);
{
const __wm_tail_arg_267_0 = rest_3424;
const __wm_tail_arg_267_1 = Map.set([consensus_3422, exact_3425.typeId, mergeConsensusRepresentation_3419__wm_d2(previous_3426, exact_3425.representation)]);
facts_3421 = __wm_tail_arg_267_0;
consensus_3422 = __wm_tail_arg_267_1;
continue __wm_tail_192;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addConsensusFacts_3420 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addConsensusFacts_3420__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const specializationConsensus_3427__wm_d2 = (specializations_3428, consensus_3429) => {
__wm_tail_193: while (true) {
{
const __wm_scalar_221_0 = specializations_3428;
const __wm_scalar_221_1 = consensus_3429;
if (__wm_scalar_221_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_221_1, consensus_3429)) {

return consensus_3429;
} else if (__wm_scalar_221_0?.ctor === -6 && __wm_scalar_221_0.args.length === 1 && __wm_is_tuple(__wm_scalar_221_0.args[0]) && __wm_scalar_221_0.args[0].length === 2 && __wm_eq(__wm_scalar_221_1, consensus_3429)) {
const specialization_3430 = __wm_scalar_221_0.args[0][0];
const rest_3431 = __wm_scalar_221_0.args[0][1];
{
const exact_3432 = specialization_3430;
{
const __wm_tail_arg_268_0 = rest_3431;
const __wm_tail_arg_268_1 = addConsensusFacts_3420__wm_d2(Js.Array.toList(exact_3432.typeFacts), consensus_3429);
specializations_3428 = __wm_tail_arg_268_0;
consensus_3429 = __wm_tail_arg_268_1;
continue __wm_tail_193;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const specializationConsensus_3427 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return specializationConsensus_3427__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const refinedType_3438__wm_d2 = (consensus_3433, gpuType_3434) => {
const inferred_3435 = representationOf_2924__wm_d2(consensus_3433, gpuType_3434.id);
const representation_3436 = (__wm_eq(gpuType_3434.representation, "abstract") ? (__wm_op_or_d2(__wm_eq(inferred_3435, "i32"), __wm_eq(inferred_3435, "f32")) ? inferred_3435 : "abstract") : gpuType_3434.representation);
const output_3437 = { id: gpuType_3434.id, kind: gpuType_3434.kind, name: gpuType_3434.name, representation: representation_3436, width: gpuType_3434.width, items: gpuType_3434.items, params: gpuType_3434.params, result: gpuType_3434.result };
return output_3437;
};
const refinedType_3438 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return refinedType_3438__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const compileGpu_3462 = (__arg) => {
if (true) {
const input_3439 = __arg;
if (!__wm_eq(input_3439.schemaVersion, 1)) {
return incompatibleSchema_2697(input_3439.schemaVersion);
} else {
const functionItems_3440 = Js.Array.toList(input_3439.functions);
const bindingItems_3441 = Js.Array.toList(input_3439.bindings);
const expressionItems_3442 = Js.Array.toList(input_3439.expressions);
const typeItems_3443 = Js.Array.toList(input_3439.types);
const __wm_bind_112 = registerFunctions_2733__wm_d3(functionItems_3440, Map.empty(Map.numberCompare), __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_112) && __wm_bind_112.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const functionRegistry_3444 = __wm_bind_112[0];
const duplicateDiagnostics_3445 = __wm_bind_112[1];
const expressionRegistry_3446 = indexExpressions_2909__wm_d2(expressionItems_3442, Map.empty(Map.numberCompare));
const bindingFunctions_3447 = indexFunctionBindings_2740__wm_d2(functionItems_3440, Map.empty(Map.numberCompare));
const bindingRegistry_3448 = indexBindings_2787__wm_d2(bindingItems_3441, Map.empty(Map.numberCompare));
const typeRegistry_3449 = indexTypes_2915__wm_d2(typeItems_3443, Map.empty(Map.numberCompare));
const reachable_3450 = solveReachableFunctions_2776__wm_d5(rootFunctionIds_2771__wm_d2(Js.Array.toList(input_3439.roots), __wm_basis_Nil), functionRegistry_3444, expressionRegistry_3446, bindingFunctions_3447, Map.empty(Map.numberCompare));
const captureItems_3451 = reverseInto_2703__wm_d2(rootCaptures_2887__wm_d7(Js.Array.toList(input_3439.roots), functionRegistry_3444, expressionRegistry_3446, bindingFunctions_3447, bindingRegistry_3448, typeRegistry_3449, __wm_basis_Nil), __wm_basis_Nil);
const specializationState_3452 = materializeRootSpecializations_3308__wm_d7(Js.Array.toList(input_3439.roots), initialSpecializationState_3244(undefined), functionRegistry_3444, expressionRegistry_3446, bindingFunctions_3447, typeRegistry_3449, typeItems_3443);
const irState_3453 = reifyIrSpecializations_3386__wm_d6(specializationState_3452.specializations, specializationState_3452.calls, functionRegistry_3444, expressionRegistry_3446, bindingFunctions_3447, initialIrBuildState_3325(undefined));
const diagnostics_3454 = prependAll_2698__wm_d2(reverseInto_2703__wm_d2(specializationState_3452.diagnostics, __wm_basis_Nil), prependAll_2698__wm_d2(captureDiagnostics_2903__wm_d2(captureItems_3451, __wm_basis_Nil), prependAll_2698__wm_d2(reachableCapabilityDiagnostics_2719__wm_d4(reachableBodyIds_2712__wm_d3(functionItems_3440, reachable_3450, __wm_basis_Nil), expressionRegistry_3446, Map.empty(Map.numberCompare), __wm_basis_Nil), duplicateDiagnostics_3445)));
const consensus_3455 = specializationConsensus_3427__wm_d2(specializationState_3452.specializations, Map.empty(Map.numberCompare));
const types_3457 = Js.Array.fromList(List.map([typeItems_3443, (__arg) => {
if (true) {
const gpuType_3456 = __arg;
return refinedType_3438__wm_d2(consensus_3455, gpuType_3456);
}
__wm_fail("Match", "pattern match failure in function");
}]));
const expressions_3458 = Js.Array.fromList(List.map([Js.Array.toList(input_3439.expressions), typedExpression_2686]));
const functions_3460 = Js.Array.fromList(List.map([Js.Array.toList(input_3439.functions), (__arg) => {
if (true) {
const fn_3459 = __arg;
return typedFunction_2691__wm_d2(reachable_3450, fn_3459);
}
__wm_fail("Match", "pattern match failure in function");
}]));
const output_3461 = { schemaVersion: 1, functions: functions_3460, captures: Js.Array.fromList(captureItems_3451), specializations: Js.Array.fromList(reverseInto_2703__wm_d2(specializationState_3452.specializations, __wm_basis_Nil)), rootSpecializations: Js.Array.fromList(reverseInto_2703__wm_d2(specializationState_3452.rootSpecializations, __wm_basis_Nil)), calls: Js.Array.fromList(reverseInto_2703__wm_d2(specializationState_3452.calls, __wm_basis_Nil)), irFunctions: Js.Array.fromList(irFunctionValues_3405__wm_d2(Map.toList(irState_3453.functions), __wm_basis_Nil)), irExpressions: Js.Array.fromList(irExpressionValues_3411__wm_d2(Map.toList(irState_3453.expressions), __wm_basis_Nil)), types: types_3457, expressions: expressions_3458, diagnostics: Js.Array.fromList(diagnostics_3454) };
return output_3461;
}
}
__wm_fail("Match", "pattern match failure in function");
};
const compileGpuSlice_3465 = (__arg) => {
if (true) {
const input_3463 = __arg;
const output_3464 = compileSliceProgram_2680(input_3463);
return output_3464;
}
__wm_fail("Match", "pattern match failure in function");
};
const elaborateGpuSliceTypes_3468 = (__arg) => {
if (true) {
const input_3466 = __arg;
const output_3467 = elaborateSliceProgramTypes_2327(input_3466);
return output_3467;
}
__wm_fail("Match", "pattern match failure in function");
};
return { "SpecializationRegistryEntry": SpecializationRegistryEntry_2681, "SpecializationBuildState": SpecializationBuildState_2682, "IrBuildState": IrBuildState_2683, "typedExpression": typedExpression_2686, "typedFunction": typedFunction_2691, "typedFunction__wm_d2": typedFunction_2691__wm_d2, "emptyOutput": emptyOutput_2693, "incompatibleSchema": incompatibleSchema_2697, "prependAll": prependAll_2698, "prependAll__wm_d2": prependAll_2698__wm_d2, "reverseInto": reverseInto_2703, "reverseInto__wm_d2": reverseInto_2703__wm_d2, "capabilityDiagnostic": capabilityDiagnostic_2711, "reachableBodyIds": reachableBodyIds_2712, "reachableBodyIds__wm_d3": reachableBodyIds_2712__wm_d3, "reachableCapabilityDiagnostics": reachableCapabilityDiagnostics_2719, "reachableCapabilityDiagnostics__wm_d4": reachableCapabilityDiagnostics_2719__wm_d4, "duplicateFunctionDiagnostic": duplicateFunctionDiagnostic_2732, "registerFunctions": registerFunctions_2733, "registerFunctions__wm_d3": registerFunctions_2733__wm_d3, "indexFunctionBindings": indexFunctionBindings_2740, "indexFunctionBindings__wm_d2": indexFunctionBindings_2740__wm_d2, "callDependency": callDependency_2752, "callDependency__wm_d3": callDependency_2752__wm_d3, "collectFunctionDependencies": collectFunctionDependencies_2753, "collectFunctionDependencies__wm_d5": collectFunctionDependencies_2753__wm_d5, "enqueueDependencies": enqueueDependencies_2765, "enqueueDependencies__wm_d2": enqueueDependencies_2765__wm_d2, "rootFunctionIds": rootFunctionIds_2771, "rootFunctionIds__wm_d2": rootFunctionIds_2771__wm_d2, "solveReachableFunctions": solveReachableFunctions_2776, "solveReachableFunctions__wm_d5": solveReachableFunctions_2776__wm_d5, "indexBindings": indexBindings_2787, "indexBindings__wm_d2": indexBindings_2787__wm_d2, "bindParams": bindParams_2793, "bindParams__wm_d2": bindParams_2793__wm_d2, "collectLocalBindings": collectLocalBindings_2799, "collectLocalBindings__wm_d4": collectLocalBindings_2799__wm_d4, "constantExpression": constantExpression_2810, "constantExpression__wm_d5": constantExpression_2810__wm_d5, "constantExpressions": constantExpressions_2811, "constantExpressions__wm_d5": constantExpressions_2811__wm_d5, "reifiableCaptureType": reifiableCaptureType_2831, "reifiableCaptureType__wm_d2": reifiableCaptureType_2831__wm_d2, "captureCategory": captureCategory_2842, "captureCategory__wm_d7": captureCategory_2842__wm_d7, "collectFunctionCaptures": collectFunctionCaptures_2843, "collectFunctionCaptures__wm_d10": collectFunctionCaptures_2843__wm_d10, "collectReachableCaptures": collectReachableCaptures_2864, "collectReachableCaptures__wm_d9": collectReachableCaptures_2864__wm_d9, "captureValues": captureValues_2881, "captureValues__wm_d2": captureValues_2881__wm_d2, "rootCaptures": rootCaptures_2887, "rootCaptures__wm_d7": rootCaptures_2887__wm_d7, "illegalCaptureDiagnostic": illegalCaptureDiagnostic_2902, "captureDiagnostics": captureDiagnostics_2903, "captureDiagnostics__wm_d2": captureDiagnostics_2903__wm_d2, "indexExpressions": indexExpressions_2909, "indexExpressions__wm_d2": indexExpressions_2909__wm_d2, "indexTypes": indexTypes_2915, "indexTypes__wm_d2": indexTypes_2915__wm_d2, "representationOf": representationOf_2924, "representationOf__wm_d2": representationOf_2924__wm_d2, "joinRepresentation": joinRepresentation_2927, "joinRepresentation__wm_d2": joinRepresentation_2927__wm_d2, "combinedRepresentation": combinedRepresentation_2928, "combinedRepresentation__wm_d3": combinedRepresentation_2928__wm_d3, "setRepresentation": setRepresentation_2939, "setRepresentation__wm_d3": setRepresentation_2939__wm_d3, "setRepresentations": setRepresentations_2940, "setRepresentations__wm_d4": setRepresentations_2940__wm_d4, "seedRepresentations": seedRepresentations_2949, "seedRepresentations__wm_d2": seedRepresentations_2949__wm_d2, "childTypeIds": childTypeIds_2955, "childTypeIds__wm_d3": childTypeIds_2955__wm_d3, "numericTypeIds": numericTypeIds_2963, "numericTypeIds__wm_d3": numericTypeIds_2963__wm_d3, "lastChildTypeId": lastChildTypeId_2971, "lastChildTypeId__wm_d3": lastChildTypeId_2971__wm_d3, "constraintTypeIds": constraintTypeIds_2985, "constraintTypeIds__wm_d3": constraintTypeIds_2985__wm_d3, "applyNumericGroup": applyNumericGroup_2989, "applyNumericGroup__wm_d2": applyNumericGroup_2989__wm_d2, "applyArgumentConstraints": applyArgumentConstraints_2990, "applyArgumentConstraints__wm_d6": applyArgumentConstraints_2990__wm_d6, "applyCallConstraint": applyCallConstraint_3023, "applyCallConstraint__wm_d6": applyCallConstraint_3023__wm_d6, "applyNumericConstraint": applyNumericConstraint_3031, "applyNumericConstraint__wm_d6": applyNumericConstraint_3031__wm_d6, "numericSweep": numericSweep_3032, "numericSweep__wm_d7": numericSweep_3032__wm_d7, "solveNumericRepresentations": solveNumericRepresentations_3045, "solveNumericRepresentations__wm_d6": solveNumericRepresentations_3045__wm_d6, "collectExpressionItems": collectExpressionItems_3054, "collectExpressionItems__wm_d4": collectExpressionItems_3054__wm_d4, "concreteRepresentation": concreteRepresentation_3070, "concreteRepresentation__wm_d3": concreteRepresentation_3070__wm_d3, "setTypeRepresentation": setTypeRepresentation_3076, "setTypeRepresentation__wm_d4": setTypeRepresentation_3076__wm_d4, "seedParamRepresentations": seedParamRepresentations_3077, "seedParamRepresentations__wm_d4": seedParamRepresentations_3077__wm_d4, "functionParamRepresentations": functionParamRepresentations_3089, "functionParamRepresentations__wm_d4": functionParamRepresentations_3089__wm_d4, "callArgumentRepresentations": callArgumentRepresentations_3097, "callArgumentRepresentations__wm_d5": callArgumentRepresentations_3097__wm_d5, "mergeArgumentRepresentations": mergeArgumentRepresentations_3108, "mergeArgumentRepresentations__wm_d6": mergeArgumentRepresentations_3108__wm_d6, "solveFunctionInstance": solveFunctionInstance_3123, "solveFunctionInstance__wm_d9": solveFunctionInstance_3123__wm_d9, "solveInstanceFixedPoint": solveInstanceFixedPoint_3124, "solveInstanceFixedPoint__wm_d9": solveInstanceFixedPoint_3124__wm_d9, "instanceSweep": instanceSweep_3125, "instanceSweep__wm_d10": instanceSweep_3125__wm_d10, "representationsEqual": representationsEqual_3182, "representationsEqual__wm_d2": representationsEqual_3182__wm_d2, "findSpecialization": findSpecialization_3190, "findSpecialization__wm_d3": findSpecialization_3190__wm_d3, "representationSuffix": representationSuffix_3198, "representationSuffix__wm_d2": representationSuffix_3198__wm_d2, "specializationName": specializationName_3207, "specializationName__wm_d3": specializationName_3207__wm_d3, "addTypeIds": addTypeIds_3208, "addTypeIds__wm_d2": addTypeIds_3208__wm_d2, "collectInstanceTypeIds": collectInstanceTypeIds_3213, "collectInstanceTypeIds__wm_d3": collectInstanceTypeIds_3213__wm_d3, "addParamTypeIds": addParamTypeIds_3220, "addParamTypeIds__wm_d3": addParamTypeIds_3220__wm_d3, "representationFacts": representationFacts_3227, "representationFacts__wm_d4": representationFacts_3227__wm_d4, "specializationTypeFacts": specializationTypeFacts_3243, "specializationTypeFacts__wm_d4": specializationTypeFacts_3243__wm_d4, "initialSpecializationState": initialSpecializationState_3244, "withSpecializedCall": withSpecializedCall_3247, "withSpecializedCall__wm_d2": withSpecializedCall_3247__wm_d2, "withSpecializationDiagnostic": withSpecializationDiagnostic_3250, "withSpecializationDiagnostic__wm_d2": withSpecializationDiagnostic_3250__wm_d2, "mutualRecursionDiagnostic": mutualRecursionDiagnostic_3253, "materializeSpecialization": materializeSpecialization_3254, "materializeSpecialization__wm_d10": materializeSpecialization_3254__wm_d10, "materializeSpecializedCalls": materializeSpecializedCalls_3255, "materializeSpecializedCalls__wm_d11": materializeSpecializedCalls_3255__wm_d11, "materializeRootSpecializations": materializeRootSpecializations_3308, "materializeRootSpecializations__wm_d7": materializeRootSpecializations_3308__wm_d7, "initialIrBuildState": initialIrBuildState_3325, "indexRepresentationFacts": indexRepresentationFacts_3326, "indexRepresentationFacts__wm_d2": indexRepresentationFacts_3326__wm_d2, "irRepresentation": irRepresentation_3335, "irRepresentation__wm_d2": irRepresentation_3335__wm_d2, "specializedCallTarget": specializedCallTarget_3336, "specializedCallTarget__wm_d3": specializedCallTarget_3336__wm_d3, "irValueKind": irValueKind_3346, "irValueKind__wm_d3": irValueKind_3346__wm_d3, "reifyIrExpression": reifyIrExpression_3347, "reifyIrExpression__wm_d8": reifyIrExpression_3347__wm_d8, "reifyIrChildren": reifyIrChildren_3348, "reifyIrChildren__wm_d9": reifyIrChildren_3348__wm_d9, "reifyIrParams": reifyIrParams_3378, "reifyIrParams__wm_d3": reifyIrParams_3378__wm_d3, "reifyIrSpecializations": reifyIrSpecializations_3386, "reifyIrSpecializations__wm_d6": reifyIrSpecializations_3386__wm_d6, "irFunctionValues": irFunctionValues_3405, "irFunctionValues__wm_d2": irFunctionValues_3405__wm_d2, "irExpressionValues": irExpressionValues_3411, "irExpressionValues__wm_d2": irExpressionValues_3411__wm_d2, "mergeConsensusRepresentation": mergeConsensusRepresentation_3419, "mergeConsensusRepresentation__wm_d2": mergeConsensusRepresentation_3419__wm_d2, "addConsensusFacts": addConsensusFacts_3420, "addConsensusFacts__wm_d2": addConsensusFacts_3420__wm_d2, "specializationConsensus": specializationConsensus_3427, "specializationConsensus__wm_d2": specializationConsensus_3427__wm_d2, "refinedType": refinedType_3438, "refinedType__wm_d2": refinedType_3438__wm_d2, "compileGpu": compileGpu_3462, "compileGpuSlice": compileGpuSlice_3465, "elaborateGpuSliceTypes": elaborateGpuSliceTypes_3468 };
  },
  (value) => { __wm_module_7 = value; },
);
await __wm_request_module("__wm_std_List");
await __wm_request_module("__wm_std_Map");
await __wm_request_module("__wm_std_Option");
await __wm_request_module("__wm_std_Monad");
await __wm_request_module("__wm_std_Result");
await __wm_request_module("__wm_std_Task");
await __wm_request_module("__wm_std_Traverse");
const List = { "Nil": __wm_basis_List["Nil"], "Cons": __wm_basis_List["Cons"], "map": __wm_std_List["map"], "length": __wm_std_List["length"], "append": __wm_std_List["append"], "filter": __wm_std_List["filter"], "take": __wm_std_List["take"], "drop": __wm_std_List["drop"], "at": __wm_std_List["at"], "foldLeft": __wm_std_List["foldLeft"], "foldRight": __wm_std_List["foldRight"], "reverse": __wm_std_List["reverse"], "any": __wm_std_List["any"], "all": __wm_std_List["all"], "collectWith": __wm_std_List["collectWith"], "joinRaw": __wm_std_List["joinRaw"], "toString": __wm_std_List["toString"], "toStringRender": __wm_std_List["toStringRender"] };
const Map = __wm_std_Map;
const Option = { "None": __wm_basis_Option["None"], "Some": __wm_basis_Option["Some"], "map": __wm_std_Option["map"], "andThen": __wm_std_Option["andThen"], "withDefault": __wm_std_Option["withDefault"], "map2": __wm_std_Option["map2"], "traverse": __wm_std_Option["traverse"], "collectList": __wm_std_Option["collectList"] };
const Monad = __wm_std_Monad;
const Result = { "Ok": __wm_basis_Result["Ok"], "Err": __wm_basis_Result["Err"], "succeed": __wm_std_Result["succeed"], "map": __wm_std_Result["map"], "andThen": __wm_std_Result["andThen"], "toBool": __wm_std_Result["toBool"], "fn": __wm_std_Result["fn"], "mapErr": __wm_std_Result["mapErr"], "fnError": __wm_std_Result["fnError"], "map2": __wm_std_Result["map2"], "carrier": __wm_std_Result["carrier"], "withDefault": __wm_std_Result["withDefault"], "debug": __wm_std_Result["debug"], "map3": __wm_std_Result["map3"], "map4": __wm_std_Result["map4"], "reverseAcc": __wm_std_Result["reverseAcc"], "reverse": __wm_std_Result["reverse"], "traverseAcc": __wm_std_Result["traverseAcc"], "traverse": __wm_std_Result["traverse"], "all": __wm_std_Result["all"], "collectList": __wm_std_Result["collectList"] };
const Task = { "fromResult": __wm_basis_Task["fromResult"], "succeed": __wm_basis_Task["succeed"], "fail": __wm_basis_Task["fail"], "map": __wm_basis_Task["map"], "map2": __wm_basis_Task["map2"], "race": __wm_basis_Task["race"], "andThen": __wm_basis_Task["andThen"], "mapErr": __wm_basis_Task["mapErr"], "recover": __wm_basis_Task["recover"], "orElse": __wm_basis_Task["orElse"], "all": __wm_basis_Task["all"], "new": __wm_basis_Task["new"], "fn": __wm_std_Task["fn"], "fnError": __wm_std_Task["fnError"], "carrier": __wm_std_Task["carrier"], "fromCallback": __wm_std_Task["fromCallback"], "collectList": __wm_std_Task["collectList"], "traverse": __wm_std_Task["traverse"] };
const Traverse = __wm_std_Traverse;
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