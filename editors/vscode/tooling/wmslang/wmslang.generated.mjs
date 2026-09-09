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
const map_3319__wm_d2 = (items_3320, f_3321) => {
const __wm_scalar_0_0 = items_3320;
const __wm_scalar_0_1 = f_3321;
if (__wm_scalar_0_0 === __wm_basis_Nil) {

return __wm_basis_Nil;
} else if (__wm_scalar_0_0?.ctor === -6 && __wm_scalar_0_0.args.length === 1 && __wm_is_tuple(__wm_scalar_0_0.args[0]) && __wm_scalar_0_0.args[0].length === 2 && __wm_eq(__wm_scalar_0_1, f_3321)) {
const head_3322 = __wm_scalar_0_0.args[0][0];
const rest_3323 = __wm_scalar_0_0.args[0][1];
return __wm_basis_Cons([f_3321(head_3322), map_3319__wm_d2(rest_3323, f_3321)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const map_3319 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return map_3319__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const length_3330 = (__arg) => {
if (true) {
const items_3324 = __arg;
const loop_3325__wm_d2 = (remaining_3326, count_3327) => {
__wm_tail_0: while (true) {
{
const __wm_scalar_1_0 = remaining_3326;
const __wm_scalar_1_1 = count_3327;
if (__wm_scalar_1_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_1_1, count_3327)) {

return count_3327;
} else if (__wm_scalar_1_0?.ctor === -6 && __wm_scalar_1_0.args.length === 1 && __wm_is_tuple(__wm_scalar_1_0.args[0]) && __wm_scalar_1_0.args[0].length === 2 && __wm_eq(__wm_scalar_1_1, count_3327)) {
const __3328 = __wm_scalar_1_0.args[0][0];
const rest_3329 = __wm_scalar_1_0.args[0][1];
{
const __wm_tail_arg_0_0 = rest_3329;
const __wm_tail_arg_0_1 = (count_3327 + 1);
remaining_3326 = __wm_tail_arg_0_0;
count_3327 = __wm_tail_arg_0_1;
continue __wm_tail_0;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const loop_3325 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return loop_3325__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return loop_3325__wm_d2(items_3324, 0);
}
__wm_fail("Match", "pattern match failure in function");
};
const append_3331__wm_d2 = (left_3332, right_3333) => {
const __wm_scalar_2_0 = left_3332;
const __wm_scalar_2_1 = right_3333;
if (__wm_scalar_2_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_2_1, right_3333)) {

return right_3333;
} else if (__wm_scalar_2_0?.ctor === -6 && __wm_scalar_2_0.args.length === 1 && __wm_is_tuple(__wm_scalar_2_0.args[0]) && __wm_scalar_2_0.args[0].length === 2 && __wm_eq(__wm_scalar_2_1, right_3333)) {
const head_3334 = __wm_scalar_2_0.args[0][0];
const rest_3335 = __wm_scalar_2_0.args[0][1];
return __wm_basis_Cons([head_3334, append_3331__wm_d2(rest_3335, right_3333)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const append_3331 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return append_3331__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const filter_3336__wm_d2 = (items_3337, predicate_3338) => {
__wm_tail_1: while (true) {
{
const __wm_scalar_3_0 = items_3337;
const __wm_scalar_3_1 = predicate_3338;
if (__wm_scalar_3_0 === __wm_basis_Nil) {

return __wm_basis_Nil;
} else if (__wm_scalar_3_0?.ctor === -6 && __wm_scalar_3_0.args.length === 1 && __wm_is_tuple(__wm_scalar_3_0.args[0]) && __wm_scalar_3_0.args[0].length === 2 && __wm_eq(__wm_scalar_3_1, predicate_3338)) {
const head_3339 = __wm_scalar_3_0.args[0][0];
const rest_3340 = __wm_scalar_3_0.args[0][1];
if (predicate_3338(head_3339)) {
return __wm_basis_Cons([head_3339, filter_3336__wm_d2(rest_3340, predicate_3338)]);
} else {
{
const __wm_tail_arg_1_0 = rest_3340;
const __wm_tail_arg_1_1 = predicate_3338;
items_3337 = __wm_tail_arg_1_0;
predicate_3338 = __wm_tail_arg_1_1;
continue __wm_tail_1;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const filter_3336 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return filter_3336__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const take_3341__wm_d2 = (items_3342, count_3343) => {
const __wm_scalar_4_0 = items_3342;
const __wm_scalar_4_1 = count_3343;
if (__wm_scalar_4_0 === __wm_basis_Nil) {

return __wm_basis_Nil;
} else if (__wm_scalar_4_1 === 0) {

return __wm_basis_Nil;
} else if (__wm_scalar_4_0?.ctor === -6 && __wm_scalar_4_0.args.length === 1 && __wm_is_tuple(__wm_scalar_4_0.args[0]) && __wm_scalar_4_0.args[0].length === 2 && __wm_eq(__wm_scalar_4_1, count_3343)) {
const head_3344 = __wm_scalar_4_0.args[0][0];
const rest_3345 = __wm_scalar_4_0.args[0][1];
return __wm_basis_Cons([head_3344, take_3341__wm_d2(rest_3345, (count_3343 - 1))]);
}
__wm_fail("Match", "non-exhaustive match");
};
const take_3341 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return take_3341__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const drop_3346__wm_d2 = (items_3347, count_3348) => {
__wm_tail_2: while (true) {
{
const __wm_scalar_5_0 = items_3347;
const __wm_scalar_5_1 = count_3348;
if (__wm_eq(__wm_scalar_5_0, items_3347) && __wm_scalar_5_1 === 0) {

return items_3347;
} else if (__wm_scalar_5_0 === __wm_basis_Nil) {

return __wm_basis_Nil;
} else if (__wm_scalar_5_0?.ctor === -6 && __wm_scalar_5_0.args.length === 1 && __wm_is_tuple(__wm_scalar_5_0.args[0]) && __wm_scalar_5_0.args[0].length === 2 && __wm_eq(__wm_scalar_5_1, count_3348)) {
const __3349 = __wm_scalar_5_0.args[0][0];
const rest_3350 = __wm_scalar_5_0.args[0][1];
{
const __wm_tail_arg_2_0 = rest_3350;
const __wm_tail_arg_2_1 = (count_3348 - 1);
items_3347 = __wm_tail_arg_2_0;
count_3348 = __wm_tail_arg_2_1;
continue __wm_tail_2;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const drop_3346 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return drop_3346__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const at_3351__wm_d2 = (items_3352, index_3353) => {
__wm_tail_3: while (true) {
{
const __wm_scalar_6_0 = items_3352;
const __wm_scalar_6_1 = index_3353;
if (__wm_scalar_6_0 === __wm_basis_Nil) {

return __wm_basis_None;
} else if (__wm_scalar_6_0?.ctor === -6 && __wm_scalar_6_0.args.length === 1 && __wm_is_tuple(__wm_scalar_6_0.args[0]) && __wm_scalar_6_0.args[0].length === 2 && __wm_scalar_6_1 === 0) {
const head_3354 = __wm_scalar_6_0.args[0][0];
const __3355 = __wm_scalar_6_0.args[0][1];
return __wm_basis_Some(head_3354);
} else if (__wm_scalar_6_0?.ctor === -6 && __wm_scalar_6_0.args.length === 1 && __wm_is_tuple(__wm_scalar_6_0.args[0]) && __wm_scalar_6_0.args[0].length === 2 && __wm_eq(__wm_scalar_6_1, index_3353)) {
const __3356 = __wm_scalar_6_0.args[0][0];
const rest_3357 = __wm_scalar_6_0.args[0][1];
{
const __wm_tail_arg_3_0 = rest_3357;
const __wm_tail_arg_3_1 = (index_3353 - 1);
items_3352 = __wm_tail_arg_3_0;
index_3353 = __wm_tail_arg_3_1;
continue __wm_tail_3;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const at_3351 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return at_3351__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const foldLeft_3358__wm_d3 = (items_3359, initial_3360, f_3361) => {
__wm_tail_4: while (true) {
{
const __wm_scalar_7_0 = items_3359;
const __wm_scalar_7_1 = initial_3360;
const __wm_scalar_7_2 = f_3361;
if (__wm_scalar_7_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_7_1, initial_3360)) {

return initial_3360;
} else if (__wm_scalar_7_0?.ctor === -6 && __wm_scalar_7_0.args.length === 1 && __wm_is_tuple(__wm_scalar_7_0.args[0]) && __wm_scalar_7_0.args[0].length === 2 && __wm_eq(__wm_scalar_7_1, initial_3360) && __wm_eq(__wm_scalar_7_2, f_3361)) {
const head_3362 = __wm_scalar_7_0.args[0][0];
const rest_3363 = __wm_scalar_7_0.args[0][1];
{
const __wm_tail_arg_4_0 = rest_3363;
const __wm_tail_arg_4_1 = f_3361([initial_3360, head_3362]);
const __wm_tail_arg_4_2 = f_3361;
items_3359 = __wm_tail_arg_4_0;
initial_3360 = __wm_tail_arg_4_1;
f_3361 = __wm_tail_arg_4_2;
continue __wm_tail_4;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const foldLeft_3358 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldLeft_3358__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const foldRight_3364__wm_d3 = (items_3365, initial_3366, f_3367) => {
const __wm_scalar_8_0 = items_3365;
const __wm_scalar_8_1 = initial_3366;
const __wm_scalar_8_2 = f_3367;
if (__wm_scalar_8_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_8_1, initial_3366)) {

return initial_3366;
} else if (__wm_scalar_8_0?.ctor === -6 && __wm_scalar_8_0.args.length === 1 && __wm_is_tuple(__wm_scalar_8_0.args[0]) && __wm_scalar_8_0.args[0].length === 2 && __wm_eq(__wm_scalar_8_1, initial_3366) && __wm_eq(__wm_scalar_8_2, f_3367)) {
const head_3368 = __wm_scalar_8_0.args[0][0];
const rest_3369 = __wm_scalar_8_0.args[0][1];
return f_3367([head_3368, foldRight_3364__wm_d3(rest_3369, initial_3366, f_3367)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const foldRight_3364 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldRight_3364__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const reverse_3373 = (__arg) => {
if (true) {
const items_3370 = __arg;
return foldLeft_3358__wm_d3(items_3370, __wm_basis_Nil, (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) {
const reversed_3371 = __arg[0];
const item_3372 = __arg[1];
return __wm_basis_Cons([item_3372, reversed_3371]);
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
const any_3374__wm_d2 = (items_3375, predicate_3376) => {
__wm_tail_5: while (true) {
{
const __wm_scalar_9_0 = items_3375;
const __wm_scalar_9_1 = predicate_3376;
if (__wm_scalar_9_0 === __wm_basis_Nil) {

return false;
} else if (__wm_scalar_9_0?.ctor === -6 && __wm_scalar_9_0.args.length === 1 && __wm_is_tuple(__wm_scalar_9_0.args[0]) && __wm_scalar_9_0.args[0].length === 2 && __wm_eq(__wm_scalar_9_1, predicate_3376)) {
const head_3377 = __wm_scalar_9_0.args[0][0];
const rest_3378 = __wm_scalar_9_0.args[0][1];
if (predicate_3376(head_3377)) {
return true;
} else {
{
const __wm_tail_arg_5_0 = rest_3378;
const __wm_tail_arg_5_1 = predicate_3376;
items_3375 = __wm_tail_arg_5_0;
predicate_3376 = __wm_tail_arg_5_1;
continue __wm_tail_5;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const any_3374 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return any_3374__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const all_3379__wm_d2 = (items_3380, predicate_3381) => {
__wm_tail_6: while (true) {
{
const __wm_scalar_10_0 = items_3380;
const __wm_scalar_10_1 = predicate_3381;
if (__wm_scalar_10_0 === __wm_basis_Nil) {

return true;
} else if (__wm_scalar_10_0?.ctor === -6 && __wm_scalar_10_0.args.length === 1 && __wm_is_tuple(__wm_scalar_10_0.args[0]) && __wm_scalar_10_0.args[0].length === 2 && __wm_eq(__wm_scalar_10_1, predicate_3381)) {
const head_3382 = __wm_scalar_10_0.args[0][0];
const rest_3383 = __wm_scalar_10_0.args[0][1];
if (predicate_3381(head_3382)) {
{
const __wm_tail_arg_6_0 = rest_3383;
const __wm_tail_arg_6_1 = predicate_3381;
items_3380 = __wm_tail_arg_6_0;
predicate_3381 = __wm_tail_arg_6_1;
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
const all_3379 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return all_3379__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collectWith_3387__wm_d3 = (empty_3384, combine_3385, items_3386) => {
return foldRight_3364__wm_d3(items_3386, empty_3384, combine_3385);
};
const collectWith_3387 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return collectWith_3387__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
let joinRaw_3388 = (__arg) => {
if (true) {
const items_3389 = __arg;
const __wm_return_value_0 = items_3389;
if (__wm_return_value_0 === __wm_basis_Nil) {

return "";
} else if (__wm_return_value_0?.ctor === -6 && __wm_return_value_0.args.length === 1 && __wm_is_tuple(__wm_return_value_0.args[0]) && __wm_return_value_0.args[0].length === 2 && __wm_return_value_0.args[0][1] === __wm_basis_Nil) {
const head_3390 = __wm_return_value_0.args[0][0];
return (("" + Text.of(head_3390)) + "");
} else if (__wm_return_value_0?.ctor === -6 && __wm_return_value_0.args.length === 1 && __wm_is_tuple(__wm_return_value_0.args[0]) && __wm_return_value_0.args[0].length === 2) {
const head_3391 = __wm_return_value_0.args[0][0];
const rest_3392 = __wm_return_value_0.args[0][1];
return (((("" + Text.of(head_3391)) + "") + ", ") + joinRaw_3388(rest_3392));
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const toString_3394 = (__arg) => {
if (true) {
const items_3393 = __arg;
return (("[" + joinRaw_3388(items_3393)) + "]");
}
__wm_fail("Match", "pattern match failure in function");
};
const toStringRender_3397__wm_d2 = (items_3395, render_3396) => {
return toString_3394(map_3319__wm_d2(items_3395, render_3396));
};
const toStringRender_3397 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return toStringRender_3397__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return { "map": map_3319, "map__wm_d2": map_3319__wm_d2, "length": length_3330, "append": append_3331, "append__wm_d2": append_3331__wm_d2, "filter": filter_3336, "filter__wm_d2": filter_3336__wm_d2, "take": take_3341, "take__wm_d2": take_3341__wm_d2, "drop": drop_3346, "drop__wm_d2": drop_3346__wm_d2, "at": at_3351, "at__wm_d2": at_3351__wm_d2, "foldLeft": foldLeft_3358, "foldLeft__wm_d3": foldLeft_3358__wm_d3, "foldRight": foldRight_3364, "foldRight__wm_d3": foldRight_3364__wm_d3, "reverse": reverse_3373, "any": any_3374, "any__wm_d2": any_3374__wm_d2, "all": all_3379, "all__wm_d2": all_3379__wm_d2, "collectWith": collectWith_3387, "collectWith__wm_d3": collectWith_3387__wm_d3, "joinRaw": joinRaw_3388, "toString": toString_3394, "toStringRender": toStringRender_3397, "toStringRender__wm_d2": toStringRender_3397__wm_d2 };
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
const numberCompare_3400__wm_d2 = (left_3398, right_3399) => {
if ((left_3398 < right_3399)) {
return Less_ctor_0;
} else {
if ((left_3398 > right_3399)) {
return Greater_ctor_2;
} else {
return Equal_ctor_1;
}
}
};
const numberCompare_3400 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numberCompare_3400__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const height_3407 = (__arg) => {
if (true) {
const tree_3401 = __arg;
const __wm_return_value_1 = tree_3401;
if (__wm_return_value_1 === MapEmpty_ctor_3) {

return 0;
} else if (__wm_return_value_1?.ctor === 4 && __wm_return_value_1.args.length === 1 && __wm_is_tuple(__wm_return_value_1.args[0]) && __wm_return_value_1.args[0].length === 5) {
const nodeHeight_3402 = __wm_return_value_1.args[0][0];
const _key_3403 = __wm_return_value_1.args[0][1];
const _value_3404 = __wm_return_value_1.args[0][2];
const _left_3405 = __wm_return_value_1.args[0][3];
const _right_3406 = __wm_return_value_1.args[0][4];
return nodeHeight_3402;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const max_3410__wm_d2 = (left_3408, right_3409) => {
if ((left_3408 > right_3409)) {
return left_3408;
} else {
return right_3409;
}
};
const max_3410 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return max_3410__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const node_3415__wm_d4 = (key_3411, value_3412, left_3413, right_3414) => {
return MapNode_ctor_4([(1 + max_3410__wm_d2(height_3407(left_3413), height_3407(right_3414))), key_3411, value_3412, left_3413, right_3414]);
};
const node_3415 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return node_3415__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const rotateLeft_3426 = (__arg) => {
if (true) {
const tree_3416 = __arg;
const __wm_return_value_2 = tree_3416;
if (__wm_return_value_2?.ctor === 4 && __wm_return_value_2.args.length === 1 && __wm_is_tuple(__wm_return_value_2.args[0]) && __wm_return_value_2.args[0].length === 5 && __wm_return_value_2.args[0][4]?.ctor === 4 && __wm_return_value_2.args[0][4].args.length === 1 && __wm_is_tuple(__wm_return_value_2.args[0][4].args[0]) && __wm_return_value_2.args[0][4].args[0].length === 5) {
const _height_3417 = __wm_return_value_2.args[0][0];
const key_3418 = __wm_return_value_2.args[0][1];
const value_3419 = __wm_return_value_2.args[0][2];
const left_3420 = __wm_return_value_2.args[0][3];
const _rightHeight_3421 = __wm_return_value_2.args[0][4].args[0][0];
const rightKey_3422 = __wm_return_value_2.args[0][4].args[0][1];
const rightValue_3423 = __wm_return_value_2.args[0][4].args[0][2];
const rightLeft_3424 = __wm_return_value_2.args[0][4].args[0][3];
const rightRight_3425 = __wm_return_value_2.args[0][4].args[0][4];
return node_3415__wm_d4(rightKey_3422, rightValue_3423, node_3415__wm_d4(key_3418, value_3419, left_3420, rightLeft_3424), rightRight_3425);
} else if (true) {

return tree_3416;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const rotateRight_3437 = (__arg) => {
if (true) {
const tree_3427 = __arg;
const __wm_return_value_3 = tree_3427;
if (__wm_return_value_3?.ctor === 4 && __wm_return_value_3.args.length === 1 && __wm_is_tuple(__wm_return_value_3.args[0]) && __wm_return_value_3.args[0].length === 5 && __wm_return_value_3.args[0][3]?.ctor === 4 && __wm_return_value_3.args[0][3].args.length === 1 && __wm_is_tuple(__wm_return_value_3.args[0][3].args[0]) && __wm_return_value_3.args[0][3].args[0].length === 5) {
const _height_3428 = __wm_return_value_3.args[0][0];
const key_3429 = __wm_return_value_3.args[0][1];
const value_3430 = __wm_return_value_3.args[0][2];
const _leftHeight_3431 = __wm_return_value_3.args[0][3].args[0][0];
const leftKey_3432 = __wm_return_value_3.args[0][3].args[0][1];
const leftValue_3433 = __wm_return_value_3.args[0][3].args[0][2];
const leftLeft_3434 = __wm_return_value_3.args[0][3].args[0][3];
const leftRight_3435 = __wm_return_value_3.args[0][3].args[0][4];
const right_3436 = __wm_return_value_3.args[0][4];
return node_3415__wm_d4(leftKey_3432, leftValue_3433, leftLeft_3434, node_3415__wm_d4(key_3429, value_3430, leftRight_3435, right_3436));
} else if (true) {

return tree_3427;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const balance_3455 = (__arg) => {
if (true) {
const tree_3438 = __arg;
const __wm_return_value_4 = tree_3438;
if (__wm_return_value_4 === MapEmpty_ctor_3) {

return MapEmpty_ctor_3;
} else if (__wm_return_value_4?.ctor === 4 && __wm_return_value_4.args.length === 1 && __wm_is_tuple(__wm_return_value_4.args[0]) && __wm_return_value_4.args[0].length === 5) {
const _height_3439 = __wm_return_value_4.args[0][0];
const key_3440 = __wm_return_value_4.args[0][1];
const value_3441 = __wm_return_value_4.args[0][2];
const left_3442 = __wm_return_value_4.args[0][3];
const right_3443 = __wm_return_value_4.args[0][4];
const difference_3444 = (height_3407(left_3442) - height_3407(right_3443));
if ((difference_3444 > 1)) {
const __wm_return_value_5 = left_3442;
if (__wm_return_value_5?.ctor === 4 && __wm_return_value_5.args.length === 1 && __wm_is_tuple(__wm_return_value_5.args[0]) && __wm_return_value_5.args[0].length === 5) {
const _leftHeight_3445 = __wm_return_value_5.args[0][0];
const _leftKey_3446 = __wm_return_value_5.args[0][1];
const _leftValue_3447 = __wm_return_value_5.args[0][2];
const leftLeft_3448 = __wm_return_value_5.args[0][3];
const leftRight_3449 = __wm_return_value_5.args[0][4];
if ((height_3407(leftLeft_3448) < height_3407(leftRight_3449))) {
return rotateRight_3437(node_3415__wm_d4(key_3440, value_3441, rotateLeft_3426(left_3442), right_3443));
} else {
return rotateRight_3437(node_3415__wm_d4(key_3440, value_3441, left_3442, right_3443));
}
} else if (__wm_return_value_5 === MapEmpty_ctor_3) {

return node_3415__wm_d4(key_3440, value_3441, left_3442, right_3443);
}
__wm_fail("Match", "non-exhaustive match");
} else {
if ((difference_3444 < __wm_op_sub(1))) {
const __wm_return_value_6 = right_3443;
if (__wm_return_value_6?.ctor === 4 && __wm_return_value_6.args.length === 1 && __wm_is_tuple(__wm_return_value_6.args[0]) && __wm_return_value_6.args[0].length === 5) {
const _rightHeight_3450 = __wm_return_value_6.args[0][0];
const _rightKey_3451 = __wm_return_value_6.args[0][1];
const _rightValue_3452 = __wm_return_value_6.args[0][2];
const rightLeft_3453 = __wm_return_value_6.args[0][3];
const rightRight_3454 = __wm_return_value_6.args[0][4];
if ((height_3407(rightRight_3454) < height_3407(rightLeft_3453))) {
return rotateLeft_3426(node_3415__wm_d4(key_3440, value_3441, left_3442, rotateRight_3437(right_3443)));
} else {
return rotateLeft_3426(node_3415__wm_d4(key_3440, value_3441, left_3442, right_3443));
}
} else if (__wm_return_value_6 === MapEmpty_ctor_3) {

return node_3415__wm_d4(key_3440, value_3441, left_3442, right_3443);
}
__wm_fail("Match", "non-exhaustive match");
} else {
return node_3415__wm_d4(key_3440, value_3441, left_3442, right_3443);
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const empty_3457 = (__arg) => {
if (true) {
const compare_3456 = __arg;
return MapValue_ctor_5([compare_3456, MapEmpty_ctor_3]);
}
__wm_fail("Match", "pattern match failure in function");
};
const getTree_3458__wm_d3 = (tree_3459, key_3460, compare_3461) => {
__wm_tail_7: while (true) {
{
const __wm_scalar_11_0 = tree_3459;
const __wm_scalar_11_1 = key_3460;
const __wm_scalar_11_2 = compare_3461;
if (__wm_scalar_11_0 === MapEmpty_ctor_3) {

return __wm_basis_None;
} else if (__wm_scalar_11_0?.ctor === 4 && __wm_scalar_11_0.args.length === 1 && __wm_is_tuple(__wm_scalar_11_0.args[0]) && __wm_scalar_11_0.args[0].length === 5 && __wm_eq(__wm_scalar_11_1, key_3460) && __wm_eq(__wm_scalar_11_2, compare_3461)) {
const _height_3462 = __wm_scalar_11_0.args[0][0];
const nodeKey_3463 = __wm_scalar_11_0.args[0][1];
const value_3464 = __wm_scalar_11_0.args[0][2];
const left_3465 = __wm_scalar_11_0.args[0][3];
const right_3466 = __wm_scalar_11_0.args[0][4];
{
const __wm_tail_value_7 = compare_3461([key_3460, nodeKey_3463]);
if (__wm_tail_value_7 === Less_ctor_0) {

{
const __wm_tail_arg_8_0 = left_3465;
const __wm_tail_arg_8_1 = key_3460;
const __wm_tail_arg_8_2 = compare_3461;
tree_3459 = __wm_tail_arg_8_0;
key_3460 = __wm_tail_arg_8_1;
compare_3461 = __wm_tail_arg_8_2;
continue __wm_tail_7;
}
} else if (__wm_tail_value_7 === Equal_ctor_1) {

return __wm_basis_Some(value_3464);
} else if (__wm_tail_value_7 === Greater_ctor_2) {

{
const __wm_tail_arg_9_0 = right_3466;
const __wm_tail_arg_9_1 = key_3460;
const __wm_tail_arg_9_2 = compare_3461;
tree_3459 = __wm_tail_arg_9_0;
key_3460 = __wm_tail_arg_9_1;
compare_3461 = __wm_tail_arg_9_2;
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
const getTree_3458 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return getTree_3458__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const get_3471__wm_d2 = (map_3467, key_3468) => {
const __wm_scalar_12_0 = map_3467;
const __wm_scalar_12_1 = key_3468;
if (__wm_scalar_12_0?.ctor === 5 && __wm_scalar_12_0.args.length === 1 && __wm_is_tuple(__wm_scalar_12_0.args[0]) && __wm_scalar_12_0.args[0].length === 2 && __wm_eq(__wm_scalar_12_1, key_3468)) {
const compare_3469 = __wm_scalar_12_0.args[0][0];
const tree_3470 = __wm_scalar_12_0.args[0][1];
return getTree_3458__wm_d3(tree_3470, key_3468, compare_3469);
}
__wm_fail("Match", "non-exhaustive match");
};
const get_3471 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return get_3471__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const has_3475__wm_d2 = (map_3472, key_3473) => {
const __wm_return_value_7 = get_3471__wm_d2(map_3472, key_3473);
if (__wm_return_value_7?.ctor === -2 && __wm_return_value_7.args.length === 1) {
const __3474 = __wm_return_value_7.args[0];
return true;
} else if (__wm_return_value_7 === __wm_basis_None) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
};
const has_3475 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return has_3475__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const setTree_3476__wm_d4 = (tree_3477, key_3478, value_3479, compare_3480) => {
const __wm_scalar_13_0 = tree_3477;
const __wm_scalar_13_1 = key_3478;
const __wm_scalar_13_2 = value_3479;
const __wm_scalar_13_3 = compare_3480;
if (__wm_scalar_13_0 === MapEmpty_ctor_3 && __wm_eq(__wm_scalar_13_1, key_3478) && __wm_eq(__wm_scalar_13_2, value_3479)) {

return node_3415__wm_d4(key_3478, value_3479, MapEmpty_ctor_3, MapEmpty_ctor_3);
} else if (__wm_scalar_13_0?.ctor === 4 && __wm_scalar_13_0.args.length === 1 && __wm_is_tuple(__wm_scalar_13_0.args[0]) && __wm_scalar_13_0.args[0].length === 5 && __wm_eq(__wm_scalar_13_1, key_3478) && __wm_eq(__wm_scalar_13_2, value_3479) && __wm_eq(__wm_scalar_13_3, compare_3480)) {
const _height_3481 = __wm_scalar_13_0.args[0][0];
const nodeKey_3482 = __wm_scalar_13_0.args[0][1];
const nodeValue_3483 = __wm_scalar_13_0.args[0][2];
const left_3484 = __wm_scalar_13_0.args[0][3];
const right_3485 = __wm_scalar_13_0.args[0][4];
const __wm_return_value_8 = compare_3480([key_3478, nodeKey_3482]);
if (__wm_return_value_8 === Less_ctor_0) {

return balance_3455(node_3415__wm_d4(nodeKey_3482, nodeValue_3483, setTree_3476__wm_d4(left_3484, key_3478, value_3479, compare_3480), right_3485));
} else if (__wm_return_value_8 === Equal_ctor_1) {

return node_3415__wm_d4(nodeKey_3482, value_3479, left_3484, right_3485);
} else if (__wm_return_value_8 === Greater_ctor_2) {

return balance_3455(node_3415__wm_d4(nodeKey_3482, nodeValue_3483, left_3484, setTree_3476__wm_d4(right_3485, key_3478, value_3479, compare_3480)));
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
};
const setTree_3476 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setTree_3476__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const set_3491__wm_d3 = (map_3486, key_3487, value_3488) => {
const __wm_scalar_14_0 = map_3486;
const __wm_scalar_14_1 = key_3487;
const __wm_scalar_14_2 = value_3488;
if (__wm_scalar_14_0?.ctor === 5 && __wm_scalar_14_0.args.length === 1 && __wm_is_tuple(__wm_scalar_14_0.args[0]) && __wm_scalar_14_0.args[0].length === 2 && __wm_eq(__wm_scalar_14_1, key_3487) && __wm_eq(__wm_scalar_14_2, value_3488)) {
const compare_3489 = __wm_scalar_14_0.args[0][0];
const tree_3490 = __wm_scalar_14_0.args[0][1];
return MapValue_ctor_5([compare_3489, setTree_3476__wm_d4(tree_3490, key_3487, value_3488, compare_3489)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const set_3491 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return set_3491__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const singleton_3495__wm_d3 = (compare_3492, key_3493, value_3494) => {
return set_3491__wm_d3(empty_3457(compare_3492), key_3493, value_3494);
};
const singleton_3495 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return singleton_3495__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
let removeSmallest_3496 = (__arg) => {
if (true) {
const tree_3497 = __arg;
const __wm_return_value_9 = tree_3497;
if (__wm_return_value_9?.ctor === 4 && __wm_return_value_9.args.length === 1 && __wm_is_tuple(__wm_return_value_9.args[0]) && __wm_return_value_9.args[0].length === 5 && __wm_return_value_9.args[0][3] === MapEmpty_ctor_3) {
const _height_3498 = __wm_return_value_9.args[0][0];
const key_3499 = __wm_return_value_9.args[0][1];
const value_3500 = __wm_return_value_9.args[0][2];
const right_3501 = __wm_return_value_9.args[0][4];
return [key_3499, value_3500, right_3501];
} else if (__wm_return_value_9?.ctor === 4 && __wm_return_value_9.args.length === 1 && __wm_is_tuple(__wm_return_value_9.args[0]) && __wm_return_value_9.args[0].length === 5) {
const _height_3502 = __wm_return_value_9.args[0][0];
const key_3503 = __wm_return_value_9.args[0][1];
const value_3504 = __wm_return_value_9.args[0][2];
const left_3505 = __wm_return_value_9.args[0][3];
const right_3506 = __wm_return_value_9.args[0][4];
const __wm_bind_0 = removeSmallest_3496(left_3505);
if (!(__wm_is_tuple(__wm_bind_0) && __wm_bind_0.length === 3)) __wm_fail("Bind", "pattern match failure in let binding");
const smallestKey_3507 = __wm_bind_0[0];
const smallestValue_3508 = __wm_bind_0[1];
const remainingLeft_3509 = __wm_bind_0[2];
return [smallestKey_3507, smallestValue_3508, balance_3455(node_3415__wm_d4(key_3503, value_3504, remainingLeft_3509, right_3506))];
} else if (__wm_return_value_9 === MapEmpty_ctor_3) {

return __wm_fail("Panic", "Map.removeSmallest called with an empty tree");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const removeTree_3510__wm_d3 = (tree_3511, key_3512, compare_3513) => {
const __wm_scalar_15_0 = tree_3511;
const __wm_scalar_15_1 = key_3512;
const __wm_scalar_15_2 = compare_3513;
if (__wm_scalar_15_0 === MapEmpty_ctor_3) {

return MapEmpty_ctor_3;
} else if (__wm_scalar_15_0?.ctor === 4 && __wm_scalar_15_0.args.length === 1 && __wm_is_tuple(__wm_scalar_15_0.args[0]) && __wm_scalar_15_0.args[0].length === 5 && __wm_eq(__wm_scalar_15_1, key_3512) && __wm_eq(__wm_scalar_15_2, compare_3513)) {
const _height_3514 = __wm_scalar_15_0.args[0][0];
const nodeKey_3515 = __wm_scalar_15_0.args[0][1];
const value_3516 = __wm_scalar_15_0.args[0][2];
const left_3517 = __wm_scalar_15_0.args[0][3];
const right_3518 = __wm_scalar_15_0.args[0][4];
const __wm_return_value_10 = compare_3513([key_3512, nodeKey_3515]);
if (__wm_return_value_10 === Less_ctor_0) {

return balance_3455(node_3415__wm_d4(nodeKey_3515, value_3516, removeTree_3510__wm_d3(left_3517, key_3512, compare_3513), right_3518));
} else if (__wm_return_value_10 === Greater_ctor_2) {

return balance_3455(node_3415__wm_d4(nodeKey_3515, value_3516, left_3517, removeTree_3510__wm_d3(right_3518, key_3512, compare_3513)));
} else if (__wm_return_value_10 === Equal_ctor_1) {

const __wm_scalar_16_0 = left_3517;
const __wm_scalar_16_1 = right_3518;
if (__wm_scalar_16_0 === MapEmpty_ctor_3) {

return right_3518;
} else if (__wm_scalar_16_1 === MapEmpty_ctor_3) {

return left_3517;
} else if (__wm_eq(__wm_scalar_16_1, right_3518)) {

const __wm_bind_1 = removeSmallest_3496(right_3518);
if (!(__wm_is_tuple(__wm_bind_1) && __wm_bind_1.length === 3)) __wm_fail("Bind", "pattern match failure in let binding");
const nextKey_3519 = __wm_bind_1[0];
const nextValue_3520 = __wm_bind_1[1];
const remainingRight_3521 = __wm_bind_1[2];
return balance_3455(node_3415__wm_d4(nextKey_3519, nextValue_3520, left_3517, remainingRight_3521));
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
};
const removeTree_3510 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return removeTree_3510__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const remove_3526__wm_d2 = (map_3522, key_3523) => {
const __wm_scalar_17_0 = map_3522;
const __wm_scalar_17_1 = key_3523;
if (__wm_scalar_17_0?.ctor === 5 && __wm_scalar_17_0.args.length === 1 && __wm_is_tuple(__wm_scalar_17_0.args[0]) && __wm_scalar_17_0.args[0].length === 2 && __wm_eq(__wm_scalar_17_1, key_3523)) {
const compare_3524 = __wm_scalar_17_0.args[0][0];
const tree_3525 = __wm_scalar_17_0.args[0][1];
return MapValue_ctor_5([compare_3524, removeTree_3510__wm_d3(tree_3525, key_3523, compare_3524)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const remove_3526 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return remove_3526__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const update_3531__wm_d3 = (map_3527, key_3528, transform_3529) => {
const __wm_return_value_11 = transform_3529(get_3471__wm_d2(map_3527, key_3528));
if (__wm_return_value_11?.ctor === -2 && __wm_return_value_11.args.length === 1) {
const value_3530 = __wm_return_value_11.args[0];
return set_3491__wm_d3(map_3527, key_3528, value_3530);
} else if (__wm_return_value_11 === __wm_basis_None) {

return remove_3526__wm_d2(map_3527, key_3528);
}
__wm_fail("Match", "non-exhaustive match");
};
const update_3531 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return update_3531__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const foldTree_3532__wm_d3 = (tree_3533, initial_3534, combine_3535) => {
__wm_tail_8: while (true) {
{
const __wm_scalar_18_0 = tree_3533;
const __wm_scalar_18_1 = initial_3534;
const __wm_scalar_18_2 = combine_3535;
if (__wm_scalar_18_0 === MapEmpty_ctor_3 && __wm_eq(__wm_scalar_18_1, initial_3534)) {

return initial_3534;
} else if (__wm_scalar_18_0?.ctor === 4 && __wm_scalar_18_0.args.length === 1 && __wm_is_tuple(__wm_scalar_18_0.args[0]) && __wm_scalar_18_0.args[0].length === 5 && __wm_eq(__wm_scalar_18_1, initial_3534) && __wm_eq(__wm_scalar_18_2, combine_3535)) {
const _height_3536 = __wm_scalar_18_0.args[0][0];
const key_3537 = __wm_scalar_18_0.args[0][1];
const value_3538 = __wm_scalar_18_0.args[0][2];
const left_3539 = __wm_scalar_18_0.args[0][3];
const right_3540 = __wm_scalar_18_0.args[0][4];
{
const afterLeft_3541 = foldTree_3532__wm_d3(left_3539, initial_3534, combine_3535);
{
const __wm_tail_arg_10_0 = right_3540;
const __wm_tail_arg_10_1 = combine_3535([afterLeft_3541, key_3537, value_3538]);
const __wm_tail_arg_10_2 = combine_3535;
tree_3533 = __wm_tail_arg_10_0;
initial_3534 = __wm_tail_arg_10_1;
combine_3535 = __wm_tail_arg_10_2;
continue __wm_tail_8;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const foldTree_3532 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldTree_3532__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const fold_3547__wm_d3 = (map_3542, initial_3543, combine_3544) => {
const __wm_scalar_19_0 = map_3542;
const __wm_scalar_19_1 = initial_3543;
const __wm_scalar_19_2 = combine_3544;
if (__wm_scalar_19_0?.ctor === 5 && __wm_scalar_19_0.args.length === 1 && __wm_is_tuple(__wm_scalar_19_0.args[0]) && __wm_scalar_19_0.args[0].length === 2 && __wm_eq(__wm_scalar_19_1, initial_3543) && __wm_eq(__wm_scalar_19_2, combine_3544)) {
const _compare_3545 = __wm_scalar_19_0.args[0][0];
const tree_3546 = __wm_scalar_19_0.args[0][1];
return foldTree_3532__wm_d3(tree_3546, initial_3543, combine_3544);
}
__wm_fail("Match", "non-exhaustive match");
};
const fold_3547 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return fold_3547__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const toListTree_3548__wm_d2 = (tree_3549, tail_3550) => {
__wm_tail_9: while (true) {
{
const __wm_scalar_20_0 = tree_3549;
const __wm_scalar_20_1 = tail_3550;
if (__wm_scalar_20_0 === MapEmpty_ctor_3 && __wm_eq(__wm_scalar_20_1, tail_3550)) {

return tail_3550;
} else if (__wm_scalar_20_0?.ctor === 4 && __wm_scalar_20_0.args.length === 1 && __wm_is_tuple(__wm_scalar_20_0.args[0]) && __wm_scalar_20_0.args[0].length === 5 && __wm_eq(__wm_scalar_20_1, tail_3550)) {
const _height_3551 = __wm_scalar_20_0.args[0][0];
const key_3552 = __wm_scalar_20_0.args[0][1];
const value_3553 = __wm_scalar_20_0.args[0][2];
const left_3554 = __wm_scalar_20_0.args[0][3];
const right_3555 = __wm_scalar_20_0.args[0][4];
{
const __wm_tail_arg_11_0 = left_3554;
const __wm_tail_arg_11_1 = __wm_basis_Cons([[key_3552, value_3553], toListTree_3548__wm_d2(right_3555, tail_3550)]);
tree_3549 = __wm_tail_arg_11_0;
tail_3550 = __wm_tail_arg_11_1;
continue __wm_tail_9;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const toListTree_3548 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return toListTree_3548__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const toList_3559 = (__arg) => {
if (true) {
const map_3556 = __arg;
const __wm_return_value_12 = map_3556;
if (__wm_return_value_12?.ctor === 5 && __wm_return_value_12.args.length === 1 && __wm_is_tuple(__wm_return_value_12.args[0]) && __wm_return_value_12.args[0].length === 2) {
const _compare_3557 = __wm_return_value_12.args[0][0];
const tree_3558 = __wm_return_value_12.args[0][1];
return toListTree_3548__wm_d2(tree_3558, __wm_basis_Nil);
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const debugHeight_3563 = (__arg) => {
if (true) {
const map_3560 = __arg;
const __wm_return_value_13 = map_3560;
if (__wm_return_value_13?.ctor === 5 && __wm_return_value_13.args.length === 1 && __wm_is_tuple(__wm_return_value_13.args[0]) && __wm_return_value_13.args[0].length === 2) {
const _compare_3561 = __wm_return_value_13.args[0][0];
const tree_3562 = __wm_return_value_13.args[0][1];
return height_3407(tree_3562);
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const fromListItems_3564__wm_d2 = (map_3565, items_3566) => {
__wm_tail_10: while (true) {
{
const __wm_scalar_21_0 = map_3565;
const __wm_scalar_21_1 = items_3566;
if (__wm_eq(__wm_scalar_21_0, map_3565) && __wm_scalar_21_1 === __wm_basis_Nil) {

return map_3565;
} else if (__wm_eq(__wm_scalar_21_0, map_3565) && __wm_scalar_21_1?.ctor === -6 && __wm_scalar_21_1.args.length === 1 && __wm_is_tuple(__wm_scalar_21_1.args[0]) && __wm_scalar_21_1.args[0].length === 2 && __wm_is_tuple(__wm_scalar_21_1.args[0][0]) && __wm_scalar_21_1.args[0][0].length === 2) {
const key_3567 = __wm_scalar_21_1.args[0][0][0];
const value_3568 = __wm_scalar_21_1.args[0][0][1];
const rest_3569 = __wm_scalar_21_1.args[0][1];
{
const __wm_tail_arg_12_0 = set_3491__wm_d3(map_3565, key_3567, value_3568);
const __wm_tail_arg_12_1 = rest_3569;
map_3565 = __wm_tail_arg_12_0;
items_3566 = __wm_tail_arg_12_1;
continue __wm_tail_10;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const fromListItems_3564 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return fromListItems_3564__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const fromList_3572__wm_d2 = (compare_3570, items_3571) => {
return fromListItems_3564__wm_d2(empty_3457(compare_3570), items_3571);
};
const fromList_3572 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return fromList_3572__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return { "Less": Less_ctor_0, "Equal": Equal_ctor_1, "Greater": Greater_ctor_2, "MapEmpty": MapEmpty_ctor_3, "MapNode": MapNode_ctor_4, "MapValue": MapValue_ctor_5, "numberCompare": numberCompare_3400, "numberCompare__wm_d2": numberCompare_3400__wm_d2, "height": height_3407, "max": max_3410, "max__wm_d2": max_3410__wm_d2, "node": node_3415, "node__wm_d4": node_3415__wm_d4, "rotateLeft": rotateLeft_3426, "rotateRight": rotateRight_3437, "balance": balance_3455, "empty": empty_3457, "getTree": getTree_3458, "getTree__wm_d3": getTree_3458__wm_d3, "get": get_3471, "get__wm_d2": get_3471__wm_d2, "has": has_3475, "has__wm_d2": has_3475__wm_d2, "setTree": setTree_3476, "setTree__wm_d4": setTree_3476__wm_d4, "set": set_3491, "set__wm_d3": set_3491__wm_d3, "singleton": singleton_3495, "singleton__wm_d3": singleton_3495__wm_d3, "removeSmallest": removeSmallest_3496, "removeTree": removeTree_3510, "removeTree__wm_d3": removeTree_3510__wm_d3, "remove": remove_3526, "remove__wm_d2": remove_3526__wm_d2, "update": update_3531, "update__wm_d3": update_3531__wm_d3, "foldTree": foldTree_3532, "foldTree__wm_d3": foldTree_3532__wm_d3, "fold": fold_3547, "fold__wm_d3": fold_3547__wm_d3, "toListTree": toListTree_3548, "toListTree__wm_d2": toListTree_3548__wm_d2, "toList": toList_3559, "debugHeight": debugHeight_3563, "fromListItems": fromListItems_3564, "fromListItems__wm_d2": fromListItems_3564__wm_d2, "fromList": fromList_3572, "fromList__wm_d2": fromList_3572__wm_d2 };
  },
  (value) => { __wm_std_Map = value; },
);
let __wm_std_Option;
__wm_define_module(
  "__wm_std_Option",
  [],
  async () => {
const map_3576__wm_d2 = (option_3573, f_3574) => {
const __wm_scalar_22_0 = option_3573;
const __wm_scalar_22_1 = f_3574;
if (__wm_scalar_22_0?.ctor === -2 && __wm_scalar_22_0.args.length === 1 && __wm_eq(__wm_scalar_22_1, f_3574)) {
const value_3575 = __wm_scalar_22_0.args[0];
return __wm_basis_Some(f_3574(value_3575));
} else if (__wm_scalar_22_0 === __wm_basis_None) {

return __wm_basis_None;
}
__wm_fail("Match", "non-exhaustive match");
};
const map_3576 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return map_3576__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const andThen_3580__wm_d2 = (option_3577, f_3578) => {
const __wm_scalar_23_0 = option_3577;
const __wm_scalar_23_1 = f_3578;
if (__wm_scalar_23_0?.ctor === -2 && __wm_scalar_23_0.args.length === 1 && __wm_eq(__wm_scalar_23_1, f_3578)) {
const value_3579 = __wm_scalar_23_0.args[0];
return f_3578(value_3579);
} else if (__wm_scalar_23_0 === __wm_basis_None) {

return __wm_basis_None;
}
__wm_fail("Match", "non-exhaustive match");
};
const andThen_3580 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return andThen_3580__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const withDefault_3584__wm_d2 = (option_3581, fallback_3582) => {
const __wm_scalar_24_0 = option_3581;
const __wm_scalar_24_1 = fallback_3582;
if (__wm_scalar_24_0?.ctor === -2 && __wm_scalar_24_0.args.length === 1) {
const value_3583 = __wm_scalar_24_0.args[0];
return value_3583;
} else if (__wm_scalar_24_0 === __wm_basis_None && __wm_eq(__wm_scalar_24_1, fallback_3582)) {

return fallback_3582;
}
__wm_fail("Match", "non-exhaustive match");
};
const withDefault_3584 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return withDefault_3584__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const map2_3590__wm_d3 = (a_3585, b_3586, f_3587) => {
const __wm_scalar_25_0 = a_3585;
const __wm_scalar_25_1 = b_3586;
const __wm_scalar_25_2 = f_3587;
if (__wm_scalar_25_0?.ctor === -2 && __wm_scalar_25_0.args.length === 1 && __wm_scalar_25_1?.ctor === -2 && __wm_scalar_25_1.args.length === 1 && __wm_eq(__wm_scalar_25_2, f_3587)) {
const left_3588 = __wm_scalar_25_0.args[0];
const right_3589 = __wm_scalar_25_1.args[0];
return __wm_basis_Some(f_3587([left_3588, right_3589]));
} else if (__wm_scalar_25_0 === __wm_basis_None) {

return __wm_basis_None;
} else if (__wm_scalar_25_1 === __wm_basis_None) {

return __wm_basis_None;
}
__wm_fail("Match", "non-exhaustive match");
};
const map2_3590 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return map2_3590__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const traverse_3591__wm_d2 = (items_3592, f_3593) => {
const __wm_scalar_26_0 = items_3592;
const __wm_scalar_26_1 = f_3593;
if (__wm_scalar_26_0 === __wm_basis_Nil) {

return __wm_basis_Some(__wm_basis_Nil);
} else if (__wm_scalar_26_0?.ctor === -6 && __wm_scalar_26_0.args.length === 1 && __wm_is_tuple(__wm_scalar_26_0.args[0]) && __wm_scalar_26_0.args[0].length === 2 && __wm_eq(__wm_scalar_26_1, f_3593)) {
const item_3594 = __wm_scalar_26_0.args[0][0];
const rest_3595 = __wm_scalar_26_0.args[0][1];
const __wm_return_value_14 = f_3593(item_3594);
if (__wm_return_value_14 === __wm_basis_None) {

return __wm_basis_None;
} else if (__wm_return_value_14?.ctor === -2 && __wm_return_value_14.args.length === 1) {
const value_3596 = __wm_return_value_14.args[0];
const __wm_return_value_15 = traverse_3591__wm_d2(rest_3595, f_3593);
if (__wm_return_value_15 === __wm_basis_None) {

return __wm_basis_None;
} else if (__wm_return_value_15?.ctor === -2 && __wm_return_value_15.args.length === 1) {
const values_3597 = __wm_return_value_15.args[0];
return __wm_basis_Some(__wm_basis_Cons([value_3596, values_3597]));
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
};
const traverse_3591 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return traverse_3591__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collectList_3600 = (__arg) => {
if (true) {
const items_3598 = __arg;
return traverse_3591__wm_d2(items_3598, (__arg) => {
if (true) {
const item_3599 = __arg;
return item_3599;
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
return { "map": map_3576, "map__wm_d2": map_3576__wm_d2, "andThen": andThen_3580, "andThen__wm_d2": andThen_3580__wm_d2, "withDefault": withDefault_3584, "withDefault__wm_d2": withDefault_3584__wm_d2, "map2": map2_3590, "map2__wm_d3": map2_3590__wm_d3, "traverse": traverse_3591, "traverse__wm_d2": traverse_3591__wm_d2, "collectList": collectList_3600 };
  },
  (value) => { __wm_std_Option = value; },
);
let __wm_std_Monad;
__wm_define_module(
  "__wm_std_Monad",
  [],
  async () => {
const Carrier_3601 = (__record_args) => ({ fn: __record_args[0], fnError: __record_args[1], succeed: __record_args[2], map: __record_args[3], map2: __record_args[4], andThen: __record_args[5] });
const Applicative_3602 = (__record_args) => ({ succeed: __record_args[0], map: __record_args[1], map2: __record_args[2] });
const via_3605 = (__arg) => {
if (true) {
const domain_3603 = __arg;
return (__arg) => {
if (true) {
const f_3604 = __arg;
return domain_3603.fn(f_3604);
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const viaError_3609 = (__arg) => {
if (true) {
const domain_3606 = __arg;
return (__arg) => {
if (true) {
const inject_3607 = __arg;
return (__arg) => {
if (true) {
const f_3608 = __arg;
return domain_3606.fnError(inject_3607)(f_3608);
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
return { "Carrier": Carrier_3601, "Applicative": Applicative_3602, "via": via_3605, "viaError": viaError_3609 };
  },
  (value) => { __wm_std_Monad = value; },
);
let __wm_std_Result;
__wm_define_module(
  "__wm_std_Result",
  ["__wm_std_Monad"],
  async () => {
const Carrier_3601 = __wm_std_Monad["Carrier"];
const succeed_3611 = (__arg) => {
if (true) {
const value_3610 = __arg;
return __wm_basis_Ok(value_3610);
}
__wm_fail("Match", "pattern match failure in function");
};
const map_3616__wm_d2 = (result_3612, f_3613) => {
const __wm_scalar_27_0 = result_3612;
const __wm_scalar_27_1 = f_3613;
if (__wm_scalar_27_0?.ctor === -3 && __wm_scalar_27_0.args.length === 1 && __wm_eq(__wm_scalar_27_1, f_3613)) {
const value_3614 = __wm_scalar_27_0.args[0];
return __wm_basis_Ok(f_3613(value_3614));
} else if (__wm_scalar_27_0?.ctor === -4 && __wm_scalar_27_0.args.length === 1) {
const error_3615 = __wm_scalar_27_0.args[0];
return __wm_basis_Err(error_3615);
}
__wm_fail("Match", "non-exhaustive match");
};
const map_3616 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return map_3616__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const andThen_3621__wm_d2 = (result_3617, f_3618) => {
const __wm_scalar_28_0 = result_3617;
const __wm_scalar_28_1 = f_3618;
if (__wm_scalar_28_0?.ctor === -3 && __wm_scalar_28_0.args.length === 1 && __wm_eq(__wm_scalar_28_1, f_3618)) {
const value_3619 = __wm_scalar_28_0.args[0];
return f_3618(value_3619);
} else if (__wm_scalar_28_0?.ctor === -4 && __wm_scalar_28_0.args.length === 1) {
const error_3620 = __wm_scalar_28_0.args[0];
return __wm_basis_Err(error_3620);
}
__wm_fail("Match", "non-exhaustive match");
};
const andThen_3621 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return andThen_3621__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const toBool_3625 = (__arg) => {
if (true) {
const r_3622 = __arg;
const __wm_return_value_16 = r_3622;
if (__wm_return_value_16?.ctor === -3 && __wm_return_value_16.args.length === 1) {
const v_3623 = __wm_return_value_16.args[0];
const __wm_return_value_17 = v_3623;
if (__wm_return_value_17 === true) {

return true;
} else if (__wm_return_value_17 === false) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_16?.ctor === -4 && __wm_return_value_16.args.length === 1) {
const __3624 = __wm_return_value_16.args[0];
return false;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const fn_3628 = (__arg) => {
if (true) {
const f_3626 = __arg;
return (__arg) => {
if (true) {
const result_3627 = __arg;
return andThen_3621__wm_d2(result_3627, f_3626);
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const mapErr_3633__wm_d2 = (result_3629, f_3630) => {
const __wm_scalar_29_0 = result_3629;
const __wm_scalar_29_1 = f_3630;
if (__wm_scalar_29_0?.ctor === -3 && __wm_scalar_29_0.args.length === 1) {
const value_3631 = __wm_scalar_29_0.args[0];
return __wm_basis_Ok(value_3631);
} else if (__wm_scalar_29_0?.ctor === -4 && __wm_scalar_29_0.args.length === 1 && __wm_eq(__wm_scalar_29_1, f_3630)) {
const error_3632 = __wm_scalar_29_0.args[0];
return __wm_basis_Err(f_3630(error_3632));
}
__wm_fail("Match", "non-exhaustive match");
};
const mapErr_3633 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return mapErr_3633__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const fnError_3637 = (__arg) => {
if (true) {
const inject_3634 = __arg;
return (__arg) => {
if (true) {
const f_3635 = __arg;
return fn_3628((__arg) => {
if (true) {
const value_3636 = __arg;
return mapErr_3633__wm_d2(f_3635(value_3636), inject_3634);
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const map2_3645__wm_d3 = (a_3638, b_3639, f_3640) => {
const __wm_scalar_30_0 = a_3638;
const __wm_scalar_30_1 = b_3639;
const __wm_scalar_30_2 = f_3640;
if (__wm_scalar_30_0?.ctor === -3 && __wm_scalar_30_0.args.length === 1 && __wm_scalar_30_1?.ctor === -3 && __wm_scalar_30_1.args.length === 1 && __wm_eq(__wm_scalar_30_2, f_3640)) {
const left_3641 = __wm_scalar_30_0.args[0];
const right_3642 = __wm_scalar_30_1.args[0];
return __wm_basis_Ok(f_3640([left_3641, right_3642]));
} else if (__wm_scalar_30_0?.ctor === -4 && __wm_scalar_30_0.args.length === 1) {
const error_3643 = __wm_scalar_30_0.args[0];
return __wm_basis_Err(error_3643);
} else if (__wm_scalar_30_1?.ctor === -4 && __wm_scalar_30_1.args.length === 1) {
const error_3644 = __wm_scalar_30_1.args[0];
return __wm_basis_Err(error_3644);
}
__wm_fail("Match", "non-exhaustive match");
};
const map2_3645 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return map2_3645__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const carrier_3646 = { fn: fn_3628, fnError: fnError_3637, succeed: succeed_3611, map: map_3616, map2: map2_3645, andThen: andThen_3621 };
const withDefault_3651__wm_d2 = (result_3647, fallback_3648) => {
const __wm_scalar_31_0 = result_3647;
const __wm_scalar_31_1 = fallback_3648;
if (__wm_scalar_31_0?.ctor === -3 && __wm_scalar_31_0.args.length === 1) {
const value_3649 = __wm_scalar_31_0.args[0];
return value_3649;
} else if (__wm_scalar_31_0?.ctor === -4 && __wm_scalar_31_0.args.length === 1 && __wm_eq(__wm_scalar_31_1, fallback_3648)) {
const __3650 = __wm_scalar_31_0.args[0];
return fallback_3648;
}
__wm_fail("Match", "non-exhaustive match");
};
const withDefault_3651 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return withDefault_3651__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const debug_3655 = (__arg) => {
if (true) {
const result_3652 = __arg;
const __wm_return_value_18 = result_3652;
if (__wm_return_value_18?.ctor === -3 && __wm_return_value_18.args.length === 1) {
const value_3653 = __wm_return_value_18.args[0];
return value_3653;
} else if (__wm_return_value_18?.ctor === -4 && __wm_return_value_18.args.length === 1) {
const error_3654 = __wm_return_value_18.args[0];
print(Debug.errorMessage(error_3654));
return __wm_fail("TypedHole", "error[type.typed-hole std/result.wm:70:4]: typed hole; expected type: 'a\n70|     ?\n        ^");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const map3_3666__wm_d4 = (a_3656, b_3657, c_3658, f_3659) => {
const __wm_scalar_32_0 = a_3656;
const __wm_scalar_32_1 = b_3657;
const __wm_scalar_32_2 = c_3658;
const __wm_scalar_32_3 = f_3659;
if (__wm_scalar_32_0?.ctor === -3 && __wm_scalar_32_0.args.length === 1 && __wm_scalar_32_1?.ctor === -3 && __wm_scalar_32_1.args.length === 1 && __wm_scalar_32_2?.ctor === -3 && __wm_scalar_32_2.args.length === 1 && __wm_eq(__wm_scalar_32_3, f_3659)) {
const av_3660 = __wm_scalar_32_0.args[0];
const bv_3661 = __wm_scalar_32_1.args[0];
const cv_3662 = __wm_scalar_32_2.args[0];
return __wm_basis_Ok(f_3659([av_3660, bv_3661, cv_3662]));
} else if (__wm_scalar_32_0?.ctor === -4 && __wm_scalar_32_0.args.length === 1) {
const error_3663 = __wm_scalar_32_0.args[0];
return __wm_basis_Err(error_3663);
} else if (__wm_scalar_32_1?.ctor === -4 && __wm_scalar_32_1.args.length === 1) {
const error_3664 = __wm_scalar_32_1.args[0];
return __wm_basis_Err(error_3664);
} else if (__wm_scalar_32_2?.ctor === -4 && __wm_scalar_32_2.args.length === 1) {
const error_3665 = __wm_scalar_32_2.args[0];
return __wm_basis_Err(error_3665);
}
__wm_fail("Match", "non-exhaustive match");
};
const map3_3666 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return map3_3666__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const map4_3680__wm_d5 = (a_3667, b_3668, c_3669, d_3670, f_3671) => {
const __wm_scalar_33_0 = a_3667;
const __wm_scalar_33_1 = b_3668;
const __wm_scalar_33_2 = c_3669;
const __wm_scalar_33_3 = d_3670;
const __wm_scalar_33_4 = f_3671;
if (__wm_scalar_33_0?.ctor === -3 && __wm_scalar_33_0.args.length === 1 && __wm_scalar_33_1?.ctor === -3 && __wm_scalar_33_1.args.length === 1 && __wm_scalar_33_2?.ctor === -3 && __wm_scalar_33_2.args.length === 1 && __wm_scalar_33_3?.ctor === -3 && __wm_scalar_33_3.args.length === 1 && __wm_eq(__wm_scalar_33_4, f_3671)) {
const av_3672 = __wm_scalar_33_0.args[0];
const bv_3673 = __wm_scalar_33_1.args[0];
const cv_3674 = __wm_scalar_33_2.args[0];
const dv_3675 = __wm_scalar_33_3.args[0];
return __wm_basis_Ok(f_3671([av_3672, bv_3673, cv_3674, dv_3675]));
} else if (__wm_scalar_33_0?.ctor === -4 && __wm_scalar_33_0.args.length === 1) {
const error_3676 = __wm_scalar_33_0.args[0];
return __wm_basis_Err(error_3676);
} else if (__wm_scalar_33_1?.ctor === -4 && __wm_scalar_33_1.args.length === 1) {
const error_3677 = __wm_scalar_33_1.args[0];
return __wm_basis_Err(error_3677);
} else if (__wm_scalar_33_2?.ctor === -4 && __wm_scalar_33_2.args.length === 1) {
const error_3678 = __wm_scalar_33_2.args[0];
return __wm_basis_Err(error_3678);
} else if (__wm_scalar_33_3?.ctor === -4 && __wm_scalar_33_3.args.length === 1) {
const error_3679 = __wm_scalar_33_3.args[0];
return __wm_basis_Err(error_3679);
}
__wm_fail("Match", "non-exhaustive match");
};
const map4_3680 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return map4_3680__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const reverseAcc_3681__wm_d2 = (items_3682, acc_3683) => {
__wm_tail_11: while (true) {
{
const __wm_scalar_34_0 = items_3682;
const __wm_scalar_34_1 = acc_3683;
if (__wm_scalar_34_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_34_1, acc_3683)) {

return acc_3683;
} else if (__wm_scalar_34_0?.ctor === -6 && __wm_scalar_34_0.args.length === 1 && __wm_is_tuple(__wm_scalar_34_0.args[0]) && __wm_scalar_34_0.args[0].length === 2 && __wm_eq(__wm_scalar_34_1, acc_3683)) {
const head_3684 = __wm_scalar_34_0.args[0][0];
const rest_3685 = __wm_scalar_34_0.args[0][1];
{
const __wm_tail_arg_13_0 = rest_3685;
const __wm_tail_arg_13_1 = __wm_basis_Cons([head_3684, acc_3683]);
items_3682 = __wm_tail_arg_13_0;
acc_3683 = __wm_tail_arg_13_1;
continue __wm_tail_11;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reverseAcc_3681 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reverseAcc_3681__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const reverse_3687 = (__arg) => {
if (true) {
const items_3686 = __arg;
return reverseAcc_3681__wm_d2(items_3686, __wm_basis_Nil);
}
__wm_fail("Match", "pattern match failure in function");
};
const traverseAcc_3688__wm_d3 = (items_3689, f_3690, acc_3691) => {
__wm_tail_12: while (true) {
{
const __wm_scalar_35_0 = items_3689;
const __wm_scalar_35_1 = f_3690;
const __wm_scalar_35_2 = acc_3691;
if (__wm_scalar_35_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_35_2, acc_3691)) {

return __wm_basis_Ok(reverse_3687(acc_3691));
} else if (__wm_scalar_35_0?.ctor === -6 && __wm_scalar_35_0.args.length === 1 && __wm_is_tuple(__wm_scalar_35_0.args[0]) && __wm_scalar_35_0.args[0].length === 2 && __wm_eq(__wm_scalar_35_1, f_3690) && __wm_eq(__wm_scalar_35_2, acc_3691)) {
const item_3692 = __wm_scalar_35_0.args[0][0];
const rest_3693 = __wm_scalar_35_0.args[0][1];
{
const __wm_tail_value_14 = f_3690(item_3692);
if (__wm_tail_value_14?.ctor === -4 && __wm_tail_value_14.args.length === 1) {
const error_3694 = __wm_tail_value_14.args[0];
return __wm_basis_Err(error_3694);
} else if (__wm_tail_value_14?.ctor === -3 && __wm_tail_value_14.args.length === 1) {
const value_3695 = __wm_tail_value_14.args[0];
{
const __wm_tail_arg_15_0 = rest_3693;
const __wm_tail_arg_15_1 = f_3690;
const __wm_tail_arg_15_2 = __wm_basis_Cons([value_3695, acc_3691]);
items_3689 = __wm_tail_arg_15_0;
f_3690 = __wm_tail_arg_15_1;
acc_3691 = __wm_tail_arg_15_2;
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
const traverseAcc_3688 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return traverseAcc_3688__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const traverse_3698__wm_d2 = (items_3696, f_3697) => {
return traverseAcc_3688__wm_d3(items_3696, f_3697, __wm_basis_Nil);
};
const traverse_3698 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return traverse_3698__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const all_3701 = (__arg) => {
if (true) {
const items_3699 = __arg;
return map_3616__wm_d2(traverse_3698__wm_d2(Js.Array.toList(items_3699), (__arg) => {
if (true) {
const item_3700 = __arg;
return item_3700;
}
__wm_fail("Match", "pattern match failure in function");
}), Js.Array.fromList);
}
__wm_fail("Match", "pattern match failure in function");
};
const collectList_3704 = (__arg) => {
if (true) {
const items_3702 = __arg;
return traverse_3698__wm_d2(items_3702, (__arg) => {
if (true) {
const item_3703 = __arg;
return item_3703;
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
return { "succeed": succeed_3611, "map": map_3616, "map__wm_d2": map_3616__wm_d2, "andThen": andThen_3621, "andThen__wm_d2": andThen_3621__wm_d2, "toBool": toBool_3625, "fn": fn_3628, "mapErr": mapErr_3633, "mapErr__wm_d2": mapErr_3633__wm_d2, "fnError": fnError_3637, "map2": map2_3645, "map2__wm_d3": map2_3645__wm_d3, "carrier": carrier_3646, "withDefault": withDefault_3651, "withDefault__wm_d2": withDefault_3651__wm_d2, "debug": debug_3655, "map3": map3_3666, "map3__wm_d4": map3_3666__wm_d4, "map4": map4_3680, "map4__wm_d5": map4_3680__wm_d5, "reverseAcc": reverseAcc_3681, "reverseAcc__wm_d2": reverseAcc_3681__wm_d2, "reverse": reverse_3687, "traverseAcc": traverseAcc_3688, "traverseAcc__wm_d3": traverseAcc_3688__wm_d3, "traverse": traverse_3698, "traverse__wm_d2": traverse_3698__wm_d2, "all": all_3701, "collectList": collectList_3704 };
  },
  (value) => { __wm_std_Result = value; },
);
let __wm_std_Task;
__wm_define_module(
  "__wm_std_Task",
  ["__wm_std_Monad"],
  async () => {
const Carrier_3601 = __wm_std_Monad["Carrier"];
const fn_3707 = (__arg) => {
if (true) {
const f_3705 = __arg;
return (__arg) => {
if (true) {
const task_3706 = __arg;
return Task.andThen([task_3706, f_3705]);
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const fnError_3711 = (__arg) => {
if (true) {
const inject_3708 = __arg;
return (__arg) => {
if (true) {
const f_3709 = __arg;
return fn_3707((__arg) => {
if (true) {
const value_3710 = __arg;
return Task.mapErr([f_3709(value_3710), inject_3708]);
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const carrier_3720 = { fn: fn_3707, fnError: fnError_3711, succeed: (__arg) => {
if (true) {
const value_3712 = __arg;
return Task.succeed(value_3712);
}
__wm_fail("Match", "pattern match failure in function");
}, map: (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) {
const task_3713 = __arg[0];
const f_3714 = __arg[1];
return Task.map([task_3713, f_3714]);
}
__wm_fail("Match", "pattern match failure in function");
}, map2: (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) {
const left_3715 = __arg[0];
const right_3716 = __arg[1];
const combine_3717 = __arg[2];
return Task.map2([left_3715, right_3716, combine_3717]);
}
__wm_fail("Match", "pattern match failure in function");
}, andThen: (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) {
const task_3718 = __arg[0];
const f_3719 = __arg[1];
return Task.andThen([task_3718, f_3719]);
}
__wm_fail("Match", "pattern match failure in function");
} };
const collectList_3722 = (__arg) => {
if (true) {
const tasks_3721 = __arg;
return Task.map([Task.all(Js.Array.fromList(tasks_3721)), Js.Array.toList]);
}
__wm_fail("Match", "pattern match failure in function");
};
const traverse_3723__wm_d2 = (items_3724, f_3725) => {
const __wm_scalar_36_0 = items_3724;
const __wm_scalar_36_1 = f_3725;
if (__wm_scalar_36_0 === __wm_basis_Nil) {

return Task.succeed(__wm_basis_Nil);
} else if (__wm_scalar_36_0?.ctor === -6 && __wm_scalar_36_0.args.length === 1 && __wm_is_tuple(__wm_scalar_36_0.args[0]) && __wm_scalar_36_0.args[0].length === 2 && __wm_eq(__wm_scalar_36_1, f_3725)) {
const item_3726 = __wm_scalar_36_0.args[0][0];
const rest_3727 = __wm_scalar_36_0.args[0][1];
return Task.andThen([f_3725(item_3726), (__arg) => {
if (true) {
const value_3728 = __arg;
return Task.map([traverse_3723__wm_d2(rest_3727, f_3725), (__arg) => {
if (true) {
const values_3729 = __arg;
return __wm_basis_Cons([value_3728, values_3729]);
}
__wm_fail("Match", "pattern match failure in function");
}]);
}
__wm_fail("Match", "pattern match failure in function");
}]);
}
__wm_fail("Match", "non-exhaustive match");
};
const traverse_3723 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return traverse_3723__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return { "fn": fn_3707, "fnError": fnError_3711, "carrier": carrier_3720, "collectList": collectList_3722, "traverse": traverse_3723, "traverse__wm_d2": traverse_3723__wm_d2 };
  },
  (value) => { __wm_std_Task = value; },
);
let __wm_std_Traverse;
__wm_define_module(
  "__wm_std_Traverse",
  ["__wm_std_Monad"],
  async () => {
const Carrier_3601 = __wm_std_Monad["Carrier"];
const with_3740 = (__arg) => {
if (__arg !== null && typeof __arg === "object") {
const succeed_3730 = __arg.succeed;
const map_3731 = __arg.map;
const andThen_3732 = __arg.andThen;
const traverse_3733__wm_d2 = (items_3734, transform_3735) => {
const __wm_scalar_37_0 = items_3734;
const __wm_scalar_37_1 = transform_3735;
if (__wm_scalar_37_0 === __wm_basis_Nil) {

return succeed_3730(__wm_basis_Nil);
} else if (__wm_scalar_37_0?.ctor === -6 && __wm_scalar_37_0.args.length === 1 && __wm_is_tuple(__wm_scalar_37_0.args[0]) && __wm_scalar_37_0.args[0].length === 2 && __wm_eq(__wm_scalar_37_1, transform_3735)) {
const item_3736 = __wm_scalar_37_0.args[0][0];
const rest_3737 = __wm_scalar_37_0.args[0][1];
return andThen_3732([transform_3735(item_3736), (__arg) => {
if (true) {
const value_3738 = __arg;
return map_3731([traverse_3733__wm_d2(rest_3737, transform_3735), (__arg) => {
if (true) {
const values_3739 = __arg;
return __wm_basis_Cons([value_3738, values_3739]);
}
__wm_fail("Match", "pattern match failure in function");
}]);
}
__wm_fail("Match", "pattern match failure in function");
}]);
}
__wm_fail("Match", "non-exhaustive match");
};
const traverse_3733 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return traverse_3733__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return traverse_3733;
}
__wm_fail("Match", "pattern match failure in function");
};
return { "with": with_3740 };
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
if (numberEqual_66__wm_d2(constructor_85.id, id_87)) {
return constructor_85;
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
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findConstructor_81 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findConstructor_81__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const fieldsForConstructors_88__wm_d6 = (constructorIds_89, constructors_90, layoutId_91, nextFieldId_92, reversedIds_93, reversedFields_94) => {
__wm_tail_16: while (true) {
{
const __wm_scalar_41_0 = constructorIds_89;
const __wm_scalar_41_1 = constructors_90;
const __wm_scalar_41_2 = layoutId_91;
const __wm_scalar_41_3 = nextFieldId_92;
const __wm_scalar_41_4 = reversedIds_93;
const __wm_scalar_41_5 = reversedFields_94;
if (__wm_scalar_41_0 === __wm_basis_Nil) {
const constructors_95 = __wm_scalar_41_1;
const layoutId_96 = __wm_scalar_41_2;
const nextFieldId_97 = __wm_scalar_41_3;
const reversedIds_98 = __wm_scalar_41_4;
const reversedFields_99 = __wm_scalar_41_5;
return [reverseInto_67__wm_d2(reversedIds_98, __wm_basis_Nil), nextFieldId_97, reverseInto_67__wm_d2(reversedFields_99, __wm_basis_Nil)];
} else if (__wm_scalar_41_0?.ctor === -6 && __wm_scalar_41_0.args.length === 1 && __wm_is_tuple(__wm_scalar_41_0.args[0]) && __wm_scalar_41_0.args[0].length === 2) {
const constructorId_100 = __wm_scalar_41_0.args[0][0];
const rest_101 = __wm_scalar_41_0.args[0][1];
const constructors_102 = __wm_scalar_41_1;
const layoutId_103 = __wm_scalar_41_2;
const nextFieldId_104 = __wm_scalar_41_3;
const reversedIds_105 = __wm_scalar_41_4;
const reversedFields_106 = __wm_scalar_41_5;
{
const constructor_107 = findConstructor_81__wm_d2(constructors_102, constructorId_100);
if ((constructor_107.payloadTypeId < 0)) {
{
const __wm_tail_arg_19_0 = rest_101;
const __wm_tail_arg_19_1 = constructors_102;
const __wm_tail_arg_19_2 = layoutId_103;
const __wm_tail_arg_19_3 = nextFieldId_104;
const __wm_tail_arg_19_4 = reversedIds_105;
const __wm_tail_arg_19_5 = reversedFields_106;
constructorIds_89 = __wm_tail_arg_19_0;
constructors_90 = __wm_tail_arg_19_1;
layoutId_91 = __wm_tail_arg_19_2;
nextFieldId_92 = __wm_tail_arg_19_3;
reversedIds_93 = __wm_tail_arg_19_4;
reversedFields_94 = __wm_tail_arg_19_5;
continue __wm_tail_16;
}
} else {
{
const field_108 = { id: nextFieldId_104, layoutId: layoutId_103, constructorId: constructor_107.id, tag: constructor_107.tag, typeId: constructor_107.payloadTypeId, spanId: constructor_107.spanId };
{
const __wm_tail_arg_20_0 = rest_101;
const __wm_tail_arg_20_1 = constructors_102;
const __wm_tail_arg_20_2 = layoutId_103;
const __wm_tail_arg_20_3 = (nextFieldId_104 + 1);
const __wm_tail_arg_20_4 = __wm_basis_Cons([field_108.id, reversedIds_105]);
const __wm_tail_arg_20_5 = __wm_basis_Cons([field_108, reversedFields_106]);
constructorIds_89 = __wm_tail_arg_20_0;
constructors_90 = __wm_tail_arg_20_1;
layoutId_91 = __wm_tail_arg_20_2;
nextFieldId_92 = __wm_tail_arg_20_3;
reversedIds_93 = __wm_tail_arg_20_4;
reversedFields_94 = __wm_tail_arg_20_5;
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
const fieldsForConstructors_88 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return fieldsForConstructors_88__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const buildLayouts_109__wm_d7 = (adts_110, types_111, constructors_112, nextLayoutId_113, nextFieldId_114, reversedLayouts_115, reversedFields_116) => {
__wm_tail_17: while (true) {
{
const __wm_scalar_42_0 = adts_110;
const __wm_scalar_42_1 = types_111;
const __wm_scalar_42_2 = constructors_112;
const __wm_scalar_42_3 = nextLayoutId_113;
const __wm_scalar_42_4 = nextFieldId_114;
const __wm_scalar_42_5 = reversedLayouts_115;
const __wm_scalar_42_6 = reversedFields_116;
if (__wm_scalar_42_0 === __wm_basis_Nil) {
const types_117 = __wm_scalar_42_1;
const constructors_118 = __wm_scalar_42_2;
const nextLayoutId_119 = __wm_scalar_42_3;
const nextFieldId_120 = __wm_scalar_42_4;
const reversedLayouts_121 = __wm_scalar_42_5;
const reversedFields_122 = __wm_scalar_42_6;
return [reverseInto_67__wm_d2(reversedLayouts_121, __wm_basis_Nil), reverseInto_67__wm_d2(reversedFields_122, __wm_basis_Nil)];
} else if (__wm_scalar_42_0?.ctor === -6 && __wm_scalar_42_0.args.length === 1 && __wm_is_tuple(__wm_scalar_42_0.args[0]) && __wm_scalar_42_0.args[0].length === 2) {
const adt_123 = __wm_scalar_42_0.args[0][0];
const rest_124 = __wm_scalar_42_0.args[0][1];
const types_125 = __wm_scalar_42_1;
const constructors_126 = __wm_scalar_42_2;
const nextLayoutId_127 = __wm_scalar_42_3;
const nextFieldId_128 = __wm_scalar_42_4;
const reversedLayouts_129 = __wm_scalar_42_5;
const reversedFields_130 = __wm_scalar_42_6;
{
const gpuType_131 = findAdtType_74__wm_d2(types_125, adt_123.typeNameId);
const __wm_bind_2 = fieldsForConstructors_88__wm_d6(Js.Array.toList(adt_123.constructorIds), constructors_126, nextLayoutId_127, nextFieldId_128, __wm_basis_Nil, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_2) && __wm_bind_2.length === 3)) __wm_fail("Bind", "pattern match failure in let binding");
const fieldIds_132 = __wm_bind_2[0];
const afterFieldId_133 = __wm_bind_2[1];
const fields_134 = __wm_bind_2[2];
const layout_135 = { id: nextLayoutId_127, typeId: gpuType_131.id, typeNameId: adt_123.typeNameId, fieldIds: Js.Array.fromList(fieldIds_132), spanId: adt_123.spanId };
{
const __wm_tail_arg_21_0 = rest_124;
const __wm_tail_arg_21_1 = types_125;
const __wm_tail_arg_21_2 = constructors_126;
const __wm_tail_arg_21_3 = (nextLayoutId_127 + 1);
const __wm_tail_arg_21_4 = afterFieldId_133;
const __wm_tail_arg_21_5 = __wm_basis_Cons([layout_135, reversedLayouts_129]);
const __wm_tail_arg_21_6 = reverseInto_67__wm_d2(fields_134, reversedFields_130);
adts_110 = __wm_tail_arg_21_0;
types_111 = __wm_tail_arg_21_1;
constructors_112 = __wm_tail_arg_21_2;
nextLayoutId_113 = __wm_tail_arg_21_3;
nextFieldId_114 = __wm_tail_arg_21_4;
reversedLayouts_115 = __wm_tail_arg_21_5;
reversedFields_116 = __wm_tail_arg_21_6;
continue __wm_tail_17;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildLayouts_109 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return buildLayouts_109__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const buildSliceLayouts_140 = (__arg) => {
if (true) {
const input_136 = __arg;
const __wm_bind_3 = buildLayouts_109__wm_d7(Js.Array.toList(input_136.adts), Js.Array.toList(input_136.types), Js.Array.toList(input_136.constructors), 0, 0, __wm_basis_Nil, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_3) && __wm_bind_3.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const layouts_137 = __wm_bind_3[0];
const fields_138 = __wm_bind_3[1];
const seed_139 = { adtLayouts: Js.Array.fromList(layouts_137), adtFields: Js.Array.fromList(fields_138) };
return seed_139;
}
__wm_fail("Match", "pattern match failure in function");
};
return { "numberEqual": numberEqual_66, "numberEqual__wm_d2": numberEqual_66__wm_d2, "reverseInto": reverseInto_67, "reverseInto__wm_d2": reverseInto_67__wm_d2, "findAdtType": findAdtType_74, "findAdtType__wm_d2": findAdtType_74__wm_d2, "findConstructor": findConstructor_81, "findConstructor__wm_d2": findConstructor_81__wm_d2, "fieldsForConstructors": fieldsForConstructors_88, "fieldsForConstructors__wm_d6": fieldsForConstructors_88__wm_d6, "buildLayouts": buildLayouts_109, "buildLayouts__wm_d7": buildLayouts_109__wm_d7, "buildSliceLayouts": buildSliceLayouts_140 };
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
const SliceLowerContext_141 = (__record_args) => ({ functions: __record_args[0], expressions: __record_args[1], matchArms: __record_args[2], params: __record_args[3], patterns: __record_args[4], constructors: __record_args[5], layouts: __record_args[6], fields: __record_args[7] });
const SliceLowerState_142 = (__record_args) => ({ nextLocalId: __record_args[0], nextAtomId: __record_args[1], nextOperationId: __record_args[2], nextStatementId: __record_args[3], nextBlockId: __record_args[4], nextCaseId: __record_args[5], functions: __record_args[6], locals: __record_args[7], atoms: __record_args[8], operations: __record_args[9], statements: __record_args[10], blocks: __record_args[11], cases: __record_args[12] });
const numberEqual_145__wm_d2 = (left_143, right_144) => {
return __wm_op_and_d2(__wm_op_not((left_143 < right_144)), __wm_op_not((left_143 > right_144)));
};
const numberEqual_145 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numberEqual_145__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const reverseInto_146__wm_d2 = (items_147, reversed_148) => {
__wm_tail_18: while (true) {
{
const __wm_scalar_43_0 = items_147;
const __wm_scalar_43_1 = reversed_148;
if (__wm_scalar_43_0 === __wm_basis_Nil) {
const reversed_149 = __wm_scalar_43_1;
return reversed_149;
} else if (__wm_scalar_43_0?.ctor === -6 && __wm_scalar_43_0.args.length === 1 && __wm_is_tuple(__wm_scalar_43_0.args[0]) && __wm_scalar_43_0.args[0].length === 2) {
const head_150 = __wm_scalar_43_0.args[0][0];
const rest_151 = __wm_scalar_43_0.args[0][1];
const reversed_152 = __wm_scalar_43_1;
{
const __wm_tail_arg_22_0 = rest_151;
const __wm_tail_arg_22_1 = __wm_basis_Cons([head_150, reversed_152]);
items_147 = __wm_tail_arg_22_0;
reversed_148 = __wm_tail_arg_22_1;
continue __wm_tail_18;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reverseInto_146 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reverseInto_146__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const append_153__wm_d2 = (left_154, right_155) => {
const __wm_scalar_44_0 = left_154;
const __wm_scalar_44_1 = right_155;
if (__wm_scalar_44_0 === __wm_basis_Nil) {
const right_156 = __wm_scalar_44_1;
return right_156;
} else if (__wm_scalar_44_0?.ctor === -6 && __wm_scalar_44_0.args.length === 1 && __wm_is_tuple(__wm_scalar_44_0.args[0]) && __wm_scalar_44_0.args[0].length === 2) {
const head_157 = __wm_scalar_44_0.args[0][0];
const rest_158 = __wm_scalar_44_0.args[0][1];
const right_159 = __wm_scalar_44_1;
return __wm_basis_Cons([head_157, append_153__wm_d2(rest_158, right_159)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const append_153 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return append_153__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const initialLowerState_161 = (__arg) => {
if (__arg === undefined) {

const state_160 = { nextLocalId: 0, nextAtomId: 0, nextOperationId: 0, nextStatementId: 0, nextBlockId: 0, nextCaseId: 0, functions: __wm_basis_Nil, locals: __wm_basis_Nil, atoms: __wm_basis_Nil, operations: __wm_basis_Nil, statements: __wm_basis_Nil, blocks: __wm_basis_Nil, cases: __wm_basis_Nil };
return state_160;
}
__wm_fail("Match", "pattern match failure in function");
};
const findIrFunction_162__wm_d2 = (items_163, id_164) => {
__wm_tail_19: while (true) {
{
const __wm_scalar_45_0 = items_163;
const __wm_scalar_45_1 = id_164;
if (__wm_scalar_45_0 === __wm_basis_Nil) {
const id_165 = __wm_scalar_45_1;
return __wm_fail("Panic", "missing schema-v2 IR function");
} else if (__wm_scalar_45_0?.ctor === -6 && __wm_scalar_45_0.args.length === 1 && __wm_is_tuple(__wm_scalar_45_0.args[0]) && __wm_scalar_45_0.args[0].length === 2) {
const item_166 = __wm_scalar_45_0.args[0][0];
const rest_167 = __wm_scalar_45_0.args[0][1];
const id_168 = __wm_scalar_45_1;
if (numberEqual_145__wm_d2(item_166.functionId, id_168)) {
return item_166;
} else {
{
const __wm_tail_arg_23_0 = rest_167;
const __wm_tail_arg_23_1 = id_168;
items_163 = __wm_tail_arg_23_0;
id_164 = __wm_tail_arg_23_1;
continue __wm_tail_19;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findIrFunction_162 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findIrFunction_162__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findIrExpression_169__wm_d2 = (items_170, id_171) => {
__wm_tail_20: while (true) {
{
const __wm_scalar_46_0 = items_170;
const __wm_scalar_46_1 = id_171;
if (__wm_scalar_46_0 === __wm_basis_Nil) {
const id_172 = __wm_scalar_46_1;
return __wm_fail("Panic", "missing schema-v2 IR expression");
} else if (__wm_scalar_46_0?.ctor === -6 && __wm_scalar_46_0.args.length === 1 && __wm_is_tuple(__wm_scalar_46_0.args[0]) && __wm_scalar_46_0.args[0].length === 2) {
const item_173 = __wm_scalar_46_0.args[0][0];
const rest_174 = __wm_scalar_46_0.args[0][1];
const id_175 = __wm_scalar_46_1;
if (numberEqual_145__wm_d2(item_173.id, id_175)) {
return item_173;
} else {
{
const __wm_tail_arg_24_0 = rest_174;
const __wm_tail_arg_24_1 = id_175;
items_170 = __wm_tail_arg_24_0;
id_171 = __wm_tail_arg_24_1;
continue __wm_tail_20;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findIrExpression_169 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findIrExpression_169__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findIrMatchArm_176__wm_d2 = (items_177, id_178) => {
__wm_tail_21: while (true) {
{
const __wm_scalar_47_0 = items_177;
const __wm_scalar_47_1 = id_178;
if (__wm_scalar_47_0 === __wm_basis_Nil) {
const id_179 = __wm_scalar_47_1;
return __wm_fail("Panic", "missing schema-v2 IR match arm");
} else if (__wm_scalar_47_0?.ctor === -6 && __wm_scalar_47_0.args.length === 1 && __wm_is_tuple(__wm_scalar_47_0.args[0]) && __wm_scalar_47_0.args[0].length === 2) {
const item_180 = __wm_scalar_47_0.args[0][0];
const rest_181 = __wm_scalar_47_0.args[0][1];
const id_182 = __wm_scalar_47_1;
if (numberEqual_145__wm_d2(item_180.id, id_182)) {
return item_180;
} else {
{
const __wm_tail_arg_25_0 = rest_181;
const __wm_tail_arg_25_1 = id_182;
items_177 = __wm_tail_arg_25_0;
id_178 = __wm_tail_arg_25_1;
continue __wm_tail_21;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findIrMatchArm_176 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findIrMatchArm_176__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLoweredAtom_183__wm_d2 = (items_184, id_185) => {
__wm_tail_22: while (true) {
{
const __wm_scalar_48_0 = items_184;
const __wm_scalar_48_1 = id_185;
if (__wm_scalar_48_0 === __wm_basis_Nil) {
const id_186 = __wm_scalar_48_1;
return __wm_fail("Panic", "missing lowered atom");
} else if (__wm_scalar_48_0?.ctor === -6 && __wm_scalar_48_0.args.length === 1 && __wm_is_tuple(__wm_scalar_48_0.args[0]) && __wm_scalar_48_0.args[0].length === 2) {
const item_187 = __wm_scalar_48_0.args[0][0];
const rest_188 = __wm_scalar_48_0.args[0][1];
const id_189 = __wm_scalar_48_1;
if (numberEqual_145__wm_d2(item_187.id, id_189)) {
return item_187;
} else {
{
const __wm_tail_arg_26_0 = rest_188;
const __wm_tail_arg_26_1 = id_189;
items_184 = __wm_tail_arg_26_0;
id_185 = __wm_tail_arg_26_1;
continue __wm_tail_22;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLoweredAtom_183 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLoweredAtom_183__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findParam_190__wm_d2 = (items_191, id_192) => {
__wm_tail_23: while (true) {
{
const __wm_scalar_49_0 = items_191;
const __wm_scalar_49_1 = id_192;
if (__wm_scalar_49_0 === __wm_basis_Nil) {
const id_193 = __wm_scalar_49_1;
return __wm_fail("Panic", "missing schema-v2 parameter");
} else if (__wm_scalar_49_0?.ctor === -6 && __wm_scalar_49_0.args.length === 1 && __wm_is_tuple(__wm_scalar_49_0.args[0]) && __wm_scalar_49_0.args[0].length === 2) {
const item_194 = __wm_scalar_49_0.args[0][0];
const rest_195 = __wm_scalar_49_0.args[0][1];
const id_196 = __wm_scalar_49_1;
if (numberEqual_145__wm_d2(item_194.id, id_196)) {
return item_194;
} else {
{
const __wm_tail_arg_27_0 = rest_195;
const __wm_tail_arg_27_1 = id_196;
items_191 = __wm_tail_arg_27_0;
id_192 = __wm_tail_arg_27_1;
continue __wm_tail_23;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findParam_190 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findParam_190__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findPattern_197__wm_d2 = (items_198, id_199) => {
__wm_tail_24: while (true) {
{
const __wm_scalar_50_0 = items_198;
const __wm_scalar_50_1 = id_199;
if (__wm_scalar_50_0 === __wm_basis_Nil) {
const id_200 = __wm_scalar_50_1;
return __wm_fail("Panic", "missing schema-v2 pattern");
} else if (__wm_scalar_50_0?.ctor === -6 && __wm_scalar_50_0.args.length === 1 && __wm_is_tuple(__wm_scalar_50_0.args[0]) && __wm_scalar_50_0.args[0].length === 2) {
const item_201 = __wm_scalar_50_0.args[0][0];
const rest_202 = __wm_scalar_50_0.args[0][1];
const id_203 = __wm_scalar_50_1;
if (numberEqual_145__wm_d2(item_201.id, id_203)) {
return item_201;
} else {
{
const __wm_tail_arg_28_0 = rest_202;
const __wm_tail_arg_28_1 = id_203;
items_198 = __wm_tail_arg_28_0;
id_199 = __wm_tail_arg_28_1;
continue __wm_tail_24;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findPattern_197 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findPattern_197__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findConstructor_204__wm_d2 = (items_205, id_206) => {
__wm_tail_25: while (true) {
{
const __wm_scalar_51_0 = items_205;
const __wm_scalar_51_1 = id_206;
if (__wm_scalar_51_0 === __wm_basis_Nil) {
const id_207 = __wm_scalar_51_1;
return __wm_fail("Panic", "missing schema-v2 constructor");
} else if (__wm_scalar_51_0?.ctor === -6 && __wm_scalar_51_0.args.length === 1 && __wm_is_tuple(__wm_scalar_51_0.args[0]) && __wm_scalar_51_0.args[0].length === 2) {
const item_208 = __wm_scalar_51_0.args[0][0];
const rest_209 = __wm_scalar_51_0.args[0][1];
const id_210 = __wm_scalar_51_1;
if (numberEqual_145__wm_d2(item_208.id, id_210)) {
return item_208;
} else {
{
const __wm_tail_arg_29_0 = rest_209;
const __wm_tail_arg_29_1 = id_210;
items_205 = __wm_tail_arg_29_0;
id_206 = __wm_tail_arg_29_1;
continue __wm_tail_25;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findConstructor_204 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findConstructor_204__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLayoutForType_211__wm_d2 = (items_212, typeId_213) => {
__wm_tail_26: while (true) {
{
const __wm_scalar_52_0 = items_212;
const __wm_scalar_52_1 = typeId_213;
if (__wm_scalar_52_0 === __wm_basis_Nil) {
const typeId_214 = __wm_scalar_52_1;
return __wm_fail("Panic", "missing schema-v2 ADT layout");
} else if (__wm_scalar_52_0?.ctor === -6 && __wm_scalar_52_0.args.length === 1 && __wm_is_tuple(__wm_scalar_52_0.args[0]) && __wm_scalar_52_0.args[0].length === 2) {
const item_215 = __wm_scalar_52_0.args[0][0];
const rest_216 = __wm_scalar_52_0.args[0][1];
const typeId_217 = __wm_scalar_52_1;
if (numberEqual_145__wm_d2(item_215.typeId, typeId_217)) {
return item_215;
} else {
{
const __wm_tail_arg_30_0 = rest_216;
const __wm_tail_arg_30_1 = typeId_217;
items_212 = __wm_tail_arg_30_0;
typeId_213 = __wm_tail_arg_30_1;
continue __wm_tail_26;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLayoutForType_211 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLayoutForType_211__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLayoutForConstructor_218__wm_d3 = (layouts_221, fields_222, constructorId_223) => {
__wm_tail_27: while (true) {
{
const __wm_scalar_53_0 = layouts_221;
const __wm_scalar_53_1 = fields_222;
const __wm_scalar_53_2 = constructorId_223;
if (__wm_scalar_53_0 === __wm_basis_Nil) {
const fields_224 = __wm_scalar_53_1;
const constructorId_225 = __wm_scalar_53_2;
return __wm_fail("Panic", "missing constructor ADT layout");
} else if (__wm_scalar_53_0?.ctor === -6 && __wm_scalar_53_0.args.length === 1 && __wm_is_tuple(__wm_scalar_53_0.args[0]) && __wm_scalar_53_0.args[0].length === 2) {
const layout_226 = __wm_scalar_53_0.args[0][0];
const rest_227 = __wm_scalar_53_0.args[0][1];
const fields_228 = __wm_scalar_53_1;
const constructorId_229 = __wm_scalar_53_2;
if (layoutContainsConstructor_219__wm_d3(Js.Array.toList(layout_226.fieldIds), fields_228, constructorId_229)) {
return layout_226;
} else {
{
const __wm_tail_arg_31_0 = rest_227;
const __wm_tail_arg_31_1 = fields_228;
const __wm_tail_arg_31_2 = constructorId_229;
layouts_221 = __wm_tail_arg_31_0;
fields_222 = __wm_tail_arg_31_1;
constructorId_223 = __wm_tail_arg_31_2;
continue __wm_tail_27;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLayoutForConstructor_218 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findLayoutForConstructor_218__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const layoutContainsConstructor_219__wm_d3 = (fieldIds_230, fields_231, constructorId_232) => {
__wm_tail_28: while (true) {
{
const __wm_scalar_54_0 = fieldIds_230;
const __wm_scalar_54_1 = fields_231;
const __wm_scalar_54_2 = constructorId_232;
if (__wm_scalar_54_0 === __wm_basis_Nil) {
const fields_233 = __wm_scalar_54_1;
const constructorId_234 = __wm_scalar_54_2;
return false;
} else if (__wm_scalar_54_0?.ctor === -6 && __wm_scalar_54_0.args.length === 1 && __wm_is_tuple(__wm_scalar_54_0.args[0]) && __wm_scalar_54_0.args[0].length === 2) {
const fieldId_235 = __wm_scalar_54_0.args[0][0];
const rest_236 = __wm_scalar_54_0.args[0][1];
const fields_237 = __wm_scalar_54_1;
const constructorId_238 = __wm_scalar_54_2;
{
const field_239 = findField_220__wm_d2(fields_237, fieldId_235);
if (numberEqual_145__wm_d2(field_239.constructorId, constructorId_238)) {
return true;
} else {
{
const __wm_tail_arg_32_0 = rest_236;
const __wm_tail_arg_32_1 = fields_237;
const __wm_tail_arg_32_2 = constructorId_238;
fieldIds_230 = __wm_tail_arg_32_0;
fields_231 = __wm_tail_arg_32_1;
constructorId_232 = __wm_tail_arg_32_2;
continue __wm_tail_28;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const layoutContainsConstructor_219 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return layoutContainsConstructor_219__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const findField_220__wm_d2 = (items_240, id_241) => {
__wm_tail_29: while (true) {
{
const __wm_scalar_55_0 = items_240;
const __wm_scalar_55_1 = id_241;
if (__wm_scalar_55_0 === __wm_basis_Nil) {
const id_242 = __wm_scalar_55_1;
return __wm_fail("Panic", "missing schema-v2 ADT field");
} else if (__wm_scalar_55_0?.ctor === -6 && __wm_scalar_55_0.args.length === 1 && __wm_is_tuple(__wm_scalar_55_0.args[0]) && __wm_scalar_55_0.args[0].length === 2) {
const item_243 = __wm_scalar_55_0.args[0][0];
const rest_244 = __wm_scalar_55_0.args[0][1];
const id_245 = __wm_scalar_55_1;
if (numberEqual_145__wm_d2(item_243.id, id_245)) {
return item_243;
} else {
{
const __wm_tail_arg_33_0 = rest_244;
const __wm_tail_arg_33_1 = id_245;
items_240 = __wm_tail_arg_33_0;
id_241 = __wm_tail_arg_33_1;
continue __wm_tail_29;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findField_220 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findField_220__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findFieldForConstructor_246__wm_d2 = (items_247, constructorId_248) => {
__wm_tail_30: while (true) {
{
const __wm_scalar_56_0 = items_247;
const __wm_scalar_56_1 = constructorId_248;
if (__wm_scalar_56_0 === __wm_basis_Nil) {
const constructorId_249 = __wm_scalar_56_1;
return __wm_fail("Panic", "missing constructor payload field");
} else if (__wm_scalar_56_0?.ctor === -6 && __wm_scalar_56_0.args.length === 1 && __wm_is_tuple(__wm_scalar_56_0.args[0]) && __wm_scalar_56_0.args[0].length === 2) {
const item_250 = __wm_scalar_56_0.args[0][0];
const rest_251 = __wm_scalar_56_0.args[0][1];
const constructorId_252 = __wm_scalar_56_1;
if (numberEqual_145__wm_d2(item_250.constructorId, constructorId_252)) {
return item_250;
} else {
{
const __wm_tail_arg_34_0 = rest_251;
const __wm_tail_arg_34_1 = constructorId_252;
items_247 = __wm_tail_arg_34_0;
constructorId_248 = __wm_tail_arg_34_1;
continue __wm_tail_30;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findFieldForConstructor_246 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findFieldForConstructor_246__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const pushLocal_256__wm_d2 = (local_253, state_254) => {
const next_255 = { ...state_254, nextLocalId: (state_254.nextLocalId + 1), locals: __wm_basis_Cons([local_253, state_254.locals]) };
return [local_253.id, next_255];
};
const pushLocal_256 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return pushLocal_256__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const freshLocal_265__wm_d7 = (functionId_257, kind_258, typeId_259, bindingId_260, mutable_261, spanId_262, state_263) => {
const local_264 = { id: state_263.nextLocalId, functionId: functionId_257, kind: kind_258, typeId: typeId_259, bindingId: bindingId_260, mutable: mutable_261, spanId: spanId_262 };
return pushLocal_256__wm_d2(local_264, state_263);
};
const freshLocal_265 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return freshLocal_265__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const pushAtom_269__wm_d2 = (atom_266, state_267) => {
const next_268 = { ...state_267, nextAtomId: (state_267.nextAtomId + 1), atoms: __wm_basis_Cons([atom_266, state_267.atoms]) };
return [atom_266.id, next_268];
};
const pushAtom_269 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return pushAtom_269__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const localAtom_277__wm_d6 = (functionId_270, typeId_271, sourceExprId_272, spanId_273, localId_274, state_275) => {
const atom_276 = { id: state_275.nextAtomId, functionId: functionId_270, kind: "local", typeId: typeId_271, sourceExprId: sourceExprId_272, spanId: spanId_273, localId: localId_274, numberValue: 0, numberKind: "", boolValue: false };
return pushAtom_269__wm_d2(atom_276, state_275);
};
const localAtom_277 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return localAtom_277__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const literalAtom_281__wm_d2 = (expression_278, state_279) => {
const atom_280 = { id: state_279.nextAtomId, functionId: expression_278.functionId, kind: expression_278.kind, typeId: expression_278.typeId, sourceExprId: expression_278.sourceExprId, spanId: expression_278.spanId, localId: __wm_op_sub(1), numberValue: expression_278.numberValue, numberKind: expression_278.numberKind, boolValue: expression_278.boolValue };
return pushAtom_269__wm_d2(atom_280, state_279);
};
const literalAtom_281 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return literalAtom_281__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const pushOperation_285__wm_d2 = (operation_282, state_283) => {
const next_284 = { ...state_283, nextOperationId: (state_283.nextOperationId + 1), operations: __wm_basis_Cons([operation_282, state_283.operations]) };
return [operation_282.id, next_284];
};
const pushOperation_285 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return pushOperation_285__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const baseOperation_290__wm_d3 = (expression_286, kind_287, state_288) => {
const operation_289 = { id: state_288.nextOperationId, functionId: expression_286.functionId, kind: kind_287, typeId: expression_286.typeId, sourceExprId: expression_286.sourceExprId, spanId: expression_286.spanId, targetFunctionId: expression_286.targetFunctionId, constructorId: expression_286.constructorId, layoutId: __wm_op_sub(1), fieldId: __wm_op_sub(1), operatorId: expression_286.operatorId, semanticId: expression_286.semanticId, builtinName: expression_286.builtinName, builtinOverloadId: expression_286.builtinOverloadId, resourceOperation: expression_286.resourceOperation, index: expression_286.index, args: Js.Array.fromList(__wm_basis_Nil) };
return operation_289;
};
const baseOperation_290 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return baseOperation_290__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const pushStatement_294__wm_d2 = (statement_291, state_292) => {
const next_293 = { ...state_292, nextStatementId: (state_292.nextStatementId + 1), statements: __wm_basis_Cons([statement_291, state_292.statements]) };
return [statement_291.id, next_293];
};
const pushStatement_294 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return pushStatement_294__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const baseStatement_301__wm_d5 = (functionId_295, kind_296, sourceExprId_297, spanId_298, state_299) => {
const statement_300 = { id: state_299.nextStatementId, functionId: functionId_295, kind: kind_296, sourceExprId: sourceExprId_297, spanId: spanId_298, localId: __wm_op_sub(1), operationId: __wm_op_sub(1), atomId: __wm_op_sub(1), conditionAtomId: __wm_op_sub(1), thenBlockId: __wm_op_sub(1), elseBlockId: __wm_op_sub(1), scrutineeAtomId: __wm_op_sub(1), layoutId: __wm_op_sub(1), caseIds: Js.Array.fromList(__wm_basis_Nil), bodyBlockId: __wm_op_sub(1), targetLocalIds: Js.Array.fromList(__wm_basis_Nil), valueAtomIds: Js.Array.fromList(__wm_basis_Nil), reason: "" };
return statement_300;
};
const baseStatement_301 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return baseStatement_301__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const pushBlock_307__wm_d3 = (functionId_302, statementIds_303, state_304) => {
const block_305 = { id: state_304.nextBlockId, functionId: functionId_302, statementIds: Js.Array.fromList(statementIds_303) };
const next_306 = { ...state_304, nextBlockId: (state_304.nextBlockId + 1), blocks: __wm_basis_Cons([block_305, state_304.blocks]) };
return [block_305.id, next_306];
};
const pushBlock_307 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return pushBlock_307__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const pushCase_311__wm_d2 = (gpuCase_308, state_309) => {
const next_310 = { ...state_309, nextCaseId: (state_309.nextCaseId + 1), cases: __wm_basis_Cons([gpuCase_308, state_309.cases]) };
return [gpuCase_308.id, next_310];
};
const pushCase_311 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return pushCase_311__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const pushFunction_315__wm_d2 = (fn_312, state_313) => {
const next_314 = { ...state_313, functions: __wm_basis_Cons([fn_312, state_313.functions]) };
return next_314;
};
const pushFunction_315 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return pushFunction_315__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const finishLoweredProgram_318 = (__arg) => {
if (true) {
const state_316 = __arg;
const output_317 = { functions: Js.Array.fromList(reverseInto_146__wm_d2(state_316.functions, __wm_basis_Nil)), locals: Js.Array.fromList(reverseInto_146__wm_d2(state_316.locals, __wm_basis_Nil)), atoms: Js.Array.fromList(reverseInto_146__wm_d2(state_316.atoms, __wm_basis_Nil)), operations: Js.Array.fromList(reverseInto_146__wm_d2(state_316.operations, __wm_basis_Nil)), statements: Js.Array.fromList(reverseInto_146__wm_d2(state_316.statements, __wm_basis_Nil)), blocks: Js.Array.fromList(reverseInto_146__wm_d2(state_316.blocks, __wm_basis_Nil)), cases: Js.Array.fromList(reverseInto_146__wm_d2(state_316.cases, __wm_basis_Nil)) };
return output_317;
}
__wm_fail("Match", "pattern match failure in function");
};
return { "SliceLowerContext": SliceLowerContext_141, "SliceLowerState": SliceLowerState_142, "numberEqual": numberEqual_145, "numberEqual__wm_d2": numberEqual_145__wm_d2, "reverseInto": reverseInto_146, "reverseInto__wm_d2": reverseInto_146__wm_d2, "append": append_153, "append__wm_d2": append_153__wm_d2, "initialLowerState": initialLowerState_161, "findIrFunction": findIrFunction_162, "findIrFunction__wm_d2": findIrFunction_162__wm_d2, "findIrExpression": findIrExpression_169, "findIrExpression__wm_d2": findIrExpression_169__wm_d2, "findIrMatchArm": findIrMatchArm_176, "findIrMatchArm__wm_d2": findIrMatchArm_176__wm_d2, "findLoweredAtom": findLoweredAtom_183, "findLoweredAtom__wm_d2": findLoweredAtom_183__wm_d2, "findParam": findParam_190, "findParam__wm_d2": findParam_190__wm_d2, "findPattern": findPattern_197, "findPattern__wm_d2": findPattern_197__wm_d2, "findConstructor": findConstructor_204, "findConstructor__wm_d2": findConstructor_204__wm_d2, "findLayoutForType": findLayoutForType_211, "findLayoutForType__wm_d2": findLayoutForType_211__wm_d2, "findLayoutForConstructor": findLayoutForConstructor_218, "findLayoutForConstructor__wm_d3": findLayoutForConstructor_218__wm_d3, "layoutContainsConstructor": layoutContainsConstructor_219, "layoutContainsConstructor__wm_d3": layoutContainsConstructor_219__wm_d3, "findField": findField_220, "findField__wm_d2": findField_220__wm_d2, "findFieldForConstructor": findFieldForConstructor_246, "findFieldForConstructor__wm_d2": findFieldForConstructor_246__wm_d2, "pushLocal": pushLocal_256, "pushLocal__wm_d2": pushLocal_256__wm_d2, "freshLocal": freshLocal_265, "freshLocal__wm_d7": freshLocal_265__wm_d7, "pushAtom": pushAtom_269, "pushAtom__wm_d2": pushAtom_269__wm_d2, "localAtom": localAtom_277, "localAtom__wm_d6": localAtom_277__wm_d6, "literalAtom": literalAtom_281, "literalAtom__wm_d2": literalAtom_281__wm_d2, "pushOperation": pushOperation_285, "pushOperation__wm_d2": pushOperation_285__wm_d2, "baseOperation": baseOperation_290, "baseOperation__wm_d3": baseOperation_290__wm_d3, "pushStatement": pushStatement_294, "pushStatement__wm_d2": pushStatement_294__wm_d2, "baseStatement": baseStatement_301, "baseStatement__wm_d5": baseStatement_301__wm_d5, "pushBlock": pushBlock_307, "pushBlock__wm_d3": pushBlock_307__wm_d3, "pushCase": pushCase_311, "pushCase__wm_d2": pushCase_311__wm_d2, "pushFunction": pushFunction_315, "pushFunction__wm_d2": pushFunction_315__wm_d2, "finishLoweredProgram": finishLoweredProgram_318 };
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
const SliceLowerContext_141 = __wm_module_2["SliceLowerContext"];
const SliceLowerState_142 = __wm_module_2["SliceLowerState"];
const append_153 = __wm_module_2["append"];
const append_153__wm_d2 = __wm_module_2["append__wm_d2"];
const baseOperation_290 = __wm_module_2["baseOperation"];
const baseOperation_290__wm_d3 = __wm_module_2["baseOperation__wm_d3"];
const baseStatement_301 = __wm_module_2["baseStatement"];
const baseStatement_301__wm_d5 = __wm_module_2["baseStatement__wm_d5"];
const findConstructor_204 = __wm_module_2["findConstructor"];
const findConstructor_204__wm_d2 = __wm_module_2["findConstructor__wm_d2"];
const findFieldForConstructor_246 = __wm_module_2["findFieldForConstructor"];
const findFieldForConstructor_246__wm_d2 = __wm_module_2["findFieldForConstructor__wm_d2"];
const findIrFunction_162 = __wm_module_2["findIrFunction"];
const findIrFunction_162__wm_d2 = __wm_module_2["findIrFunction__wm_d2"];
const findIrExpression_169 = __wm_module_2["findIrExpression"];
const findIrExpression_169__wm_d2 = __wm_module_2["findIrExpression__wm_d2"];
const findIrMatchArm_176 = __wm_module_2["findIrMatchArm"];
const findIrMatchArm_176__wm_d2 = __wm_module_2["findIrMatchArm__wm_d2"];
const findLoweredAtom_183 = __wm_module_2["findLoweredAtom"];
const findLoweredAtom_183__wm_d2 = __wm_module_2["findLoweredAtom__wm_d2"];
const findLayoutForType_211 = __wm_module_2["findLayoutForType"];
const findLayoutForType_211__wm_d2 = __wm_module_2["findLayoutForType__wm_d2"];
const findParam_190 = __wm_module_2["findParam"];
const findParam_190__wm_d2 = __wm_module_2["findParam__wm_d2"];
const findPattern_197 = __wm_module_2["findPattern"];
const findPattern_197__wm_d2 = __wm_module_2["findPattern__wm_d2"];
const finishLoweredProgram_318 = __wm_module_2["finishLoweredProgram"];
const freshLocal_265 = __wm_module_2["freshLocal"];
const freshLocal_265__wm_d7 = __wm_module_2["freshLocal__wm_d7"];
const initialLowerState_161 = __wm_module_2["initialLowerState"];
const literalAtom_281 = __wm_module_2["literalAtom"];
const literalAtom_281__wm_d2 = __wm_module_2["literalAtom__wm_d2"];
const localAtom_277 = __wm_module_2["localAtom"];
const localAtom_277__wm_d6 = __wm_module_2["localAtom__wm_d6"];
const numberEqual_145 = __wm_module_2["numberEqual"];
const numberEqual_145__wm_d2 = __wm_module_2["numberEqual__wm_d2"];
const pushAtom_269 = __wm_module_2["pushAtom"];
const pushAtom_269__wm_d2 = __wm_module_2["pushAtom__wm_d2"];
const pushBlock_307 = __wm_module_2["pushBlock"];
const pushBlock_307__wm_d3 = __wm_module_2["pushBlock__wm_d3"];
const pushCase_311 = __wm_module_2["pushCase"];
const pushCase_311__wm_d2 = __wm_module_2["pushCase__wm_d2"];
const pushFunction_315 = __wm_module_2["pushFunction"];
const pushFunction_315__wm_d2 = __wm_module_2["pushFunction__wm_d2"];
const pushOperation_285 = __wm_module_2["pushOperation"];
const pushOperation_285__wm_d2 = __wm_module_2["pushOperation__wm_d2"];
const pushStatement_294 = __wm_module_2["pushStatement"];
const pushStatement_294__wm_d2 = __wm_module_2["pushStatement__wm_d2"];
const reverseInto_146 = __wm_module_2["reverseInto"];
const reverseInto_146__wm_d2 = __wm_module_2["reverseInto__wm_d2"];
const LowerScope_319 = (__record_args) => ({ bindings: __record_args[0], loopParamLocalIds: __record_args[1] });
const LowerValueResult_320 = (__record_args) => ({ statementIds: __record_args[0], atomId: __record_args[1], state: __record_args[2] });
const LowerTailResult_321 = (__record_args) => ({ statementIds: __record_args[0], state: __record_args[1] });
const LowerChildrenResult_322 = (__record_args) => ({ statementIds: __record_args[0], atomIds: __record_args[1], state: __record_args[2] });
const LowerBindResult_323 = (__record_args) => ({ statementIds: __record_args[0], scope: __record_args[1], state: __record_args[2] });
const LowerParamResult_324 = (__record_args) => ({ physicalLocalIds: __record_args[0], activeLocalIds: __record_args[1], initialStatementIds: __record_args[2], iterationStatementIds: __record_args[3], scope: __record_args[4], state: __record_args[5] });
const LowerCasesResult_325 = (__record_args) => ({ caseIds: __record_args[0], state: __record_args[1] });
const emptyScope_327 = (__arg) => {
if (__arg === undefined) {

const scope_326 = { bindings: Map.empty(Map.numberCompare), loopParamLocalIds: __wm_basis_Nil };
return scope_326;
}
__wm_fail("Match", "pattern match failure in function");
};
const lowerLetValue_328__wm_d5 = (lower_333, expression_334, scope_335, context_336, state_337) => {
const __wm_return_value_19 = Js.Array.toList(expression_334.children);
if (__wm_return_value_19?.ctor === -6 && __wm_return_value_19.args.length === 1 && __wm_is_tuple(__wm_return_value_19.args[0]) && __wm_return_value_19.args[0].length === 2 && __wm_return_value_19.args[0][1]?.ctor === -6 && __wm_return_value_19.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_19.args[0][1].args[0]) && __wm_return_value_19.args[0][1].args[0].length === 2 && __wm_return_value_19.args[0][1].args[0][1] === __wm_basis_Nil) {
const valueExpressionId_338 = __wm_return_value_19.args[0][0];
const bodyExpressionId_339 = __wm_return_value_19.args[0][1].args[0][0];
const value_340 = lower_333([valueExpressionId_338, scope_335, context_336, state_337]);
const bound_341 = bindPattern_330__wm_d6(expression_334.patternId, value_340.atomId, expression_334, scope_335, context_336, value_340.state);
const body_342 = lower_333([bodyExpressionId_339, bound_341.scope, context_336, bound_341.state]);
const result_343 = { statementIds: append_153__wm_d2(value_340.statementIds, append_153__wm_d2(bound_341.statementIds, body_342.statementIds)), atomId: body_342.atomId, state: body_342.state };
return result_343;
} else if (true) {

return __wm_fail("Panic", "functional let does not have value and body children");
}
__wm_fail("Match", "non-exhaustive match");
};
const lowerLetValue_328 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return lowerLetValue_328__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerSequenceValue_329__wm_d5 = (lower_344, expression_345, scope_346, context_347, state_348) => {
const __wm_return_value_20 = Js.Array.toList(expression_345.children);
if (__wm_return_value_20?.ctor === -6 && __wm_return_value_20.args.length === 1 && __wm_is_tuple(__wm_return_value_20.args[0]) && __wm_return_value_20.args[0].length === 2 && __wm_return_value_20.args[0][1]?.ctor === -6 && __wm_return_value_20.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_20.args[0][1].args[0]) && __wm_return_value_20.args[0][1].args[0].length === 2 && __wm_return_value_20.args[0][1].args[0][1] === __wm_basis_Nil) {
const discardedExpressionId_349 = __wm_return_value_20.args[0][0];
const bodyExpressionId_350 = __wm_return_value_20.args[0][1].args[0][0];
const discarded_351 = lower_344([discardedExpressionId_349, scope_346, context_347, state_348]);
const body_352 = lower_344([bodyExpressionId_350, scope_346, context_347, discarded_351.state]);
const result_353 = { statementIds: append_153__wm_d2(discarded_351.statementIds, body_352.statementIds), atomId: body_352.atomId, state: body_352.state };
return result_353;
} else if (true) {

return __wm_fail("Panic", "functional sequence does not have discarded and body children");
}
__wm_fail("Match", "non-exhaustive match");
};
const lowerSequenceValue_329 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return lowerSequenceValue_329__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const bindPattern_330__wm_d6 = (patternId_354, atomId_355, owner_356, scope_357, context_358, state_359) => {
const pattern_360 = findPattern_197__wm_d2(context_358.patterns, patternId_354);
if (__wm_eq(pattern_360.kind, "wildcard")) {
const result_361 = { statementIds: __wm_basis_Nil, scope: scope_357, state: state_359 };
return result_361;
} else {
if (__wm_eq(pattern_360.kind, "binding")) {
return bindPatternValue_331__wm_d7(pattern_360, atomId_355, owner_356, "copy", __wm_op_sub(1), scope_357, state_359);
} else {
if (__wm_eq(pattern_360.kind, "tuple")) {
return bindTupleChildren_332__wm_d8(Js.Array.toList(pattern_360.children), atomId_355, owner_356, scope_357, context_358, state_359, 0, __wm_basis_Nil);
} else {
return __wm_fail("Panic", "constructor pattern reached irrefutable binding lowering");
}
}
}
};
const bindPattern_330 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return bindPattern_330__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const bindPatternValue_331__wm_d7 = (pattern_362, atomId_363, owner_364, operationKind_365, index_366, scope_367, state_368) => {
const operation_369 = { ...baseOperation_290__wm_d3(owner_364, operationKind_365, state_368), typeId: pattern_362.typeId, index: index_366, args: Js.Array.fromList(__wm_basis_Cons([atomId_363, __wm_basis_Nil])) };
const __wm_bind_4 = pushOperation_285__wm_d2(operation_369, state_368);
if (!(__wm_is_tuple(__wm_bind_4) && __wm_bind_4.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_370 = __wm_bind_4[0];
const afterOperation_371 = __wm_bind_4[1];
const __wm_bind_5 = freshLocal_265__wm_d7(owner_364.functionId, "binding", pattern_362.typeId, pattern_362.bindingId, false, pattern_362.spanId, afterOperation_371);
if (!(__wm_is_tuple(__wm_bind_5) && __wm_bind_5.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_372 = __wm_bind_5[0];
const afterLocal_373 = __wm_bind_5[1];
const statement_374 = { ...baseStatement_301__wm_d5(owner_364.functionId, "let", owner_364.sourceExprId, pattern_362.spanId, afterLocal_373), localId: localId_372, operationId: operationId_370, reason: "binding" };
const __wm_bind_6 = pushStatement_294__wm_d2(statement_374, afterLocal_373);
if (!(__wm_is_tuple(__wm_bind_6) && __wm_bind_6.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_375 = __wm_bind_6[0];
const afterStatement_376 = __wm_bind_6[1];
const nextScope_377 = { ...scope_367, bindings: Map.set([scope_367.bindings, pattern_362.bindingId, localId_372]) };
const result_378 = { statementIds: __wm_basis_Cons([statementId_375, __wm_basis_Nil]), scope: nextScope_377, state: afterStatement_376 };
return result_378;
};
const bindPatternValue_331 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return bindPatternValue_331__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const bindTupleChildren_332__wm_d8 = (childPatternIds_379, atomId_380, owner_381, scope_382, context_383, state_384, index_385, reversedStatements_386) => {
__wm_tail_31: while (true) {
{
const __wm_scalar_57_0 = childPatternIds_379;
const __wm_scalar_57_1 = atomId_380;
const __wm_scalar_57_2 = owner_381;
const __wm_scalar_57_3 = scope_382;
const __wm_scalar_57_4 = context_383;
const __wm_scalar_57_5 = state_384;
const __wm_scalar_57_6 = index_385;
const __wm_scalar_57_7 = reversedStatements_386;
if (__wm_scalar_57_0 === __wm_basis_Nil) {
const atomId_387 = __wm_scalar_57_1;
const owner_388 = __wm_scalar_57_2;
const scope_389 = __wm_scalar_57_3;
const context_390 = __wm_scalar_57_4;
const state_391 = __wm_scalar_57_5;
const index_392 = __wm_scalar_57_6;
const reversedStatements_393 = __wm_scalar_57_7;
{
const result_394 = { statementIds: reverseInto_146__wm_d2(reversedStatements_393, __wm_basis_Nil), scope: scope_389, state: state_391 };
return result_394;
}
} else if (__wm_scalar_57_0?.ctor === -6 && __wm_scalar_57_0.args.length === 1 && __wm_is_tuple(__wm_scalar_57_0.args[0]) && __wm_scalar_57_0.args[0].length === 2) {
const childPatternId_395 = __wm_scalar_57_0.args[0][0];
const rest_396 = __wm_scalar_57_0.args[0][1];
const atomId_397 = __wm_scalar_57_1;
const owner_398 = __wm_scalar_57_2;
const scope_399 = __wm_scalar_57_3;
const context_400 = __wm_scalar_57_4;
const state_401 = __wm_scalar_57_5;
const index_402 = __wm_scalar_57_6;
const reversedStatements_403 = __wm_scalar_57_7;
{
const pattern_404 = findPattern_197__wm_d2(context_400.patterns, childPatternId_395);
if (__wm_eq(pattern_404.kind, "wildcard")) {
{
const __wm_tail_arg_35_0 = rest_396;
const __wm_tail_arg_35_1 = atomId_397;
const __wm_tail_arg_35_2 = owner_398;
const __wm_tail_arg_35_3 = scope_399;
const __wm_tail_arg_35_4 = context_400;
const __wm_tail_arg_35_5 = state_401;
const __wm_tail_arg_35_6 = (index_402 + 1);
const __wm_tail_arg_35_7 = reversedStatements_403;
childPatternIds_379 = __wm_tail_arg_35_0;
atomId_380 = __wm_tail_arg_35_1;
owner_381 = __wm_tail_arg_35_2;
scope_382 = __wm_tail_arg_35_3;
context_383 = __wm_tail_arg_35_4;
state_384 = __wm_tail_arg_35_5;
index_385 = __wm_tail_arg_35_6;
reversedStatements_386 = __wm_tail_arg_35_7;
continue __wm_tail_31;
}
} else {
{
const bound_405 = bindPatternValue_331__wm_d7(pattern_404, atomId_397, owner_398, "project", index_402, scope_399, state_401);
{
const __wm_tail_arg_36_0 = rest_396;
const __wm_tail_arg_36_1 = atomId_397;
const __wm_tail_arg_36_2 = owner_398;
const __wm_tail_arg_36_3 = bound_405.scope;
const __wm_tail_arg_36_4 = context_400;
const __wm_tail_arg_36_5 = bound_405.state;
const __wm_tail_arg_36_6 = (index_402 + 1);
const __wm_tail_arg_36_7 = reverseInto_146__wm_d2(bound_405.statementIds, reversedStatements_403);
childPatternIds_379 = __wm_tail_arg_36_0;
atomId_380 = __wm_tail_arg_36_1;
owner_381 = __wm_tail_arg_36_2;
scope_382 = __wm_tail_arg_36_3;
context_383 = __wm_tail_arg_36_4;
state_384 = __wm_tail_arg_36_5;
index_385 = __wm_tail_arg_36_6;
reversedStatements_386 = __wm_tail_arg_36_7;
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
const bindTupleChildren_332 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 8) return bindTupleChildren_332__wm_d8(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7]);
__wm_fail("Match", "pattern match failure in function");
};
const assignJoin_411__wm_d4 = (expression_406, localId_407, atomId_408, state_409) => {
const statement_410 = { ...baseStatement_301__wm_d5(expression_406.functionId, "assign", expression_406.sourceExprId, expression_406.spanId, state_409), localId: localId_407, atomId: atomId_408, reason: "join" };
return pushStatement_294__wm_d2(statement_410, state_409);
};
const assignJoin_411 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return assignJoin_411__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerIfValue_439__wm_d5 = (lower_412, expression_413, scope_414, context_415, state_416) => {
const __wm_return_value_21 = Js.Array.toList(expression_413.children);
if (__wm_return_value_21?.ctor === -6 && __wm_return_value_21.args.length === 1 && __wm_is_tuple(__wm_return_value_21.args[0]) && __wm_return_value_21.args[0].length === 2 && __wm_return_value_21.args[0][1]?.ctor === -6 && __wm_return_value_21.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_21.args[0][1].args[0]) && __wm_return_value_21.args[0][1].args[0].length === 2 && __wm_return_value_21.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_21.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_21.args[0][1].args[0][1].args[0]) && __wm_return_value_21.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_21.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const conditionExpressionId_417 = __wm_return_value_21.args[0][0];
const thenExpressionId_418 = __wm_return_value_21.args[0][1].args[0][0];
const elseExpressionId_419 = __wm_return_value_21.args[0][1].args[0][1].args[0][0];
const condition_420 = lower_412([conditionExpressionId_417, scope_414, context_415, state_416]);
const __wm_bind_7 = freshLocal_265__wm_d7(expression_413.functionId, "join", expression_413.typeId, __wm_op_sub(1), true, expression_413.spanId, condition_420.state);
if (!(__wm_is_tuple(__wm_bind_7) && __wm_bind_7.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const joinLocalId_421 = __wm_bind_7[0];
const afterJoin_422 = __wm_bind_7[1];
const thenValue_423 = lower_412([thenExpressionId_418, scope_414, context_415, afterJoin_422]);
const __wm_bind_8 = assignJoin_411__wm_d4(expression_413, joinLocalId_421, thenValue_423.atomId, thenValue_423.state);
if (!(__wm_is_tuple(__wm_bind_8) && __wm_bind_8.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const thenAssignId_424 = __wm_bind_8[0];
const afterThenAssign_425 = __wm_bind_8[1];
const __wm_bind_9 = pushBlock_307__wm_d3(expression_413.functionId, append_153__wm_d2(thenValue_423.statementIds, __wm_basis_Cons([thenAssignId_424, __wm_basis_Nil])), afterThenAssign_425);
if (!(__wm_is_tuple(__wm_bind_9) && __wm_bind_9.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const thenBlockId_426 = __wm_bind_9[0];
const afterThenBlock_427 = __wm_bind_9[1];
const elseValue_428 = lower_412([elseExpressionId_419, scope_414, context_415, afterThenBlock_427]);
const __wm_bind_10 = assignJoin_411__wm_d4(expression_413, joinLocalId_421, elseValue_428.atomId, elseValue_428.state);
if (!(__wm_is_tuple(__wm_bind_10) && __wm_bind_10.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const elseAssignId_429 = __wm_bind_10[0];
const afterElseAssign_430 = __wm_bind_10[1];
const __wm_bind_11 = pushBlock_307__wm_d3(expression_413.functionId, append_153__wm_d2(elseValue_428.statementIds, __wm_basis_Cons([elseAssignId_429, __wm_basis_Nil])), afterElseAssign_430);
if (!(__wm_is_tuple(__wm_bind_11) && __wm_bind_11.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const elseBlockId_431 = __wm_bind_11[0];
const afterElseBlock_432 = __wm_bind_11[1];
const statement_433 = { ...baseStatement_301__wm_d5(expression_413.functionId, "if", expression_413.sourceExprId, expression_413.spanId, afterElseBlock_432), localId: joinLocalId_421, conditionAtomId: condition_420.atomId, thenBlockId: thenBlockId_426, elseBlockId: elseBlockId_431, reason: "join" };
const __wm_bind_12 = pushStatement_294__wm_d2(statement_433, afterElseBlock_432);
if (!(__wm_is_tuple(__wm_bind_12) && __wm_bind_12.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_434 = __wm_bind_12[0];
const afterIf_435 = __wm_bind_12[1];
const __wm_bind_13 = localAtom_277__wm_d6(expression_413.functionId, expression_413.typeId, expression_413.sourceExprId, expression_413.spanId, joinLocalId_421, afterIf_435);
if (!(__wm_is_tuple(__wm_bind_13) && __wm_bind_13.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_436 = __wm_bind_13[0];
const afterAtom_437 = __wm_bind_13[1];
const result_438 = { statementIds: append_153__wm_d2(condition_420.statementIds, __wm_basis_Cons([statementId_434, __wm_basis_Nil])), atomId: atomId_436, state: afterAtom_437 };
return result_438;
} else if (true) {

return __wm_fail("Panic", "functional if does not have three children");
}
__wm_fail("Match", "non-exhaustive match");
};
const lowerIfValue_439 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return lowerIfValue_439__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerMatchValue_440__wm_d5 = (lower_444, expression_445, scope_446, context_447, state_448) => {
const __wm_return_value_22 = Js.Array.toList(expression_445.children);
if (__wm_return_value_22?.ctor === -6 && __wm_return_value_22.args.length === 1 && __wm_is_tuple(__wm_return_value_22.args[0]) && __wm_return_value_22.args[0].length === 2 && __wm_return_value_22.args[0][1] === __wm_basis_Nil) {
const scrutineeExpressionId_449 = __wm_return_value_22.args[0][0];
const scrutinee_450 = lower_444([scrutineeExpressionId_449, scope_446, context_447, state_448]);
const scrutineeExpression_451 = findIrExpression_169__wm_d2(context_447.expressions, scrutineeExpressionId_449);
const layout_452 = findLayoutForType_211__wm_d2(context_447.layouts, scrutineeExpression_451.typeId);
const __wm_bind_14 = freshLocal_265__wm_d7(expression_445.functionId, "join", expression_445.typeId, __wm_op_sub(1), true, expression_445.spanId, scrutinee_450.state);
if (!(__wm_is_tuple(__wm_bind_14) && __wm_bind_14.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const joinLocalId_453 = __wm_bind_14[0];
const afterJoin_454 = __wm_bind_14[1];
const cases_455 = lowerMatchValueCases_441__wm_d9(lower_444, Js.Array.toList(expression_445.armIds), expression_445, scrutinee_450.atomId, joinLocalId_453, scope_446, context_447, afterJoin_454, __wm_basis_Nil);
const statement_456 = { ...baseStatement_301__wm_d5(expression_445.functionId, "switch", expression_445.sourceExprId, expression_445.spanId, cases_455.state), localId: joinLocalId_453, scrutineeAtomId: scrutinee_450.atomId, layoutId: layout_452.id, caseIds: Js.Array.fromList(cases_455.caseIds), reason: "join" };
const __wm_bind_15 = pushStatement_294__wm_d2(statement_456, cases_455.state);
if (!(__wm_is_tuple(__wm_bind_15) && __wm_bind_15.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_457 = __wm_bind_15[0];
const afterSwitch_458 = __wm_bind_15[1];
const __wm_bind_16 = localAtom_277__wm_d6(expression_445.functionId, expression_445.typeId, expression_445.sourceExprId, expression_445.spanId, joinLocalId_453, afterSwitch_458);
if (!(__wm_is_tuple(__wm_bind_16) && __wm_bind_16.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_459 = __wm_bind_16[0];
const afterAtom_460 = __wm_bind_16[1];
const result_461 = { statementIds: append_153__wm_d2(scrutinee_450.statementIds, __wm_basis_Cons([statementId_457, __wm_basis_Nil])), atomId: atomId_459, state: afterAtom_460 };
return result_461;
} else if (true) {

return __wm_fail("Panic", "functional match does not have one scrutinee child");
}
__wm_fail("Match", "non-exhaustive match");
};
const lowerMatchValue_440 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return lowerMatchValue_440__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerMatchValueCases_441__wm_d9 = (lower_462, armIds_463, expression_464, scrutineeAtomId_465, joinLocalId_466, scope_467, context_468, state_469, reversedCases_470) => {
__wm_tail_32: while (true) {
{
const __wm_scalar_58_0 = lower_462;
const __wm_scalar_58_1 = armIds_463;
const __wm_scalar_58_2 = expression_464;
const __wm_scalar_58_3 = scrutineeAtomId_465;
const __wm_scalar_58_4 = joinLocalId_466;
const __wm_scalar_58_5 = scope_467;
const __wm_scalar_58_6 = context_468;
const __wm_scalar_58_7 = state_469;
const __wm_scalar_58_8 = reversedCases_470;
if (__wm_scalar_58_1 === __wm_basis_Nil) {
const lower_471 = __wm_scalar_58_0;
const expression_472 = __wm_scalar_58_2;
const scrutineeAtomId_473 = __wm_scalar_58_3;
const joinLocalId_474 = __wm_scalar_58_4;
const scope_475 = __wm_scalar_58_5;
const context_476 = __wm_scalar_58_6;
const state_477 = __wm_scalar_58_7;
const reversedCases_478 = __wm_scalar_58_8;
{
const result_479 = { caseIds: reverseInto_146__wm_d2(reversedCases_478, __wm_basis_Nil), state: state_477 };
return result_479;
}
} else if (__wm_scalar_58_1?.ctor === -6 && __wm_scalar_58_1.args.length === 1 && __wm_is_tuple(__wm_scalar_58_1.args[0]) && __wm_scalar_58_1.args[0].length === 2) {
const lower_480 = __wm_scalar_58_0;
const armId_481 = __wm_scalar_58_1.args[0][0];
const rest_482 = __wm_scalar_58_1.args[0][1];
const expression_483 = __wm_scalar_58_2;
const scrutineeAtomId_484 = __wm_scalar_58_3;
const joinLocalId_485 = __wm_scalar_58_4;
const scope_486 = __wm_scalar_58_5;
const context_487 = __wm_scalar_58_6;
const state_488 = __wm_scalar_58_7;
const reversedCases_489 = __wm_scalar_58_8;
{
const arm_490 = findIrMatchArm_176__wm_d2(context_487.matchArms, armId_481);
const pattern_491 = findPattern_197__wm_d2(context_487.patterns, arm_490.patternId);
const constructor_492 = findConstructor_204__wm_d2(context_487.constructors, pattern_491.constructorId);
const bound_493 = bindMatchPayload_442__wm_d6(pattern_491, scrutineeAtomId_484, expression_483, scope_486, context_487, state_488);
const body_494 = lower_480([arm_490.bodyExprId, bound_493.scope, context_487, bound_493.state]);
const __wm_bind_17 = assignJoin_411__wm_d4(expression_483, joinLocalId_485, body_494.atomId, body_494.state);
if (!(__wm_is_tuple(__wm_bind_17) && __wm_bind_17.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const assignId_495 = __wm_bind_17[0];
const afterAssign_496 = __wm_bind_17[1];
const __wm_bind_18 = pushBlock_307__wm_d3(expression_483.functionId, append_153__wm_d2(bound_493.statementIds, append_153__wm_d2(body_494.statementIds, __wm_basis_Cons([assignId_495, __wm_basis_Nil]))), afterAssign_496);
if (!(__wm_is_tuple(__wm_bind_18) && __wm_bind_18.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const blockId_497 = __wm_bind_18[0];
const afterBlock_498 = __wm_bind_18[1];
const gpuCase_499 = { id: afterBlock_498.nextCaseId, functionId: expression_483.functionId, constructorId: constructor_492.id, tag: constructor_492.tag, blockId: blockId_497, spanId: arm_490.spanId };
const __wm_bind_19 = pushCase_311__wm_d2(gpuCase_499, afterBlock_498);
if (!(__wm_is_tuple(__wm_bind_19) && __wm_bind_19.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const caseId_500 = __wm_bind_19[0];
const afterCase_501 = __wm_bind_19[1];
{
const __wm_tail_arg_37_0 = lower_480;
const __wm_tail_arg_37_1 = rest_482;
const __wm_tail_arg_37_2 = expression_483;
const __wm_tail_arg_37_3 = scrutineeAtomId_484;
const __wm_tail_arg_37_4 = joinLocalId_485;
const __wm_tail_arg_37_5 = scope_486;
const __wm_tail_arg_37_6 = context_487;
const __wm_tail_arg_37_7 = afterCase_501;
const __wm_tail_arg_37_8 = __wm_basis_Cons([caseId_500, reversedCases_489]);
lower_462 = __wm_tail_arg_37_0;
armIds_463 = __wm_tail_arg_37_1;
expression_464 = __wm_tail_arg_37_2;
scrutineeAtomId_465 = __wm_tail_arg_37_3;
joinLocalId_466 = __wm_tail_arg_37_4;
scope_467 = __wm_tail_arg_37_5;
context_468 = __wm_tail_arg_37_6;
state_469 = __wm_tail_arg_37_7;
reversedCases_470 = __wm_tail_arg_37_8;
continue __wm_tail_32;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const lowerMatchValueCases_441 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return lowerMatchValueCases_441__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const bindMatchPayload_442__wm_d6 = (pattern_502, scrutineeAtomId_503, owner_504, scope_505, context_506, state_507) => {
const __wm_return_value_23 = Js.Array.toList(pattern_502.children);
if (__wm_return_value_23 === __wm_basis_Nil) {

const result_508 = { statementIds: __wm_basis_Nil, scope: scope_505, state: state_507 };
return result_508;
} else if (__wm_return_value_23?.ctor === -6 && __wm_return_value_23.args.length === 1 && __wm_is_tuple(__wm_return_value_23.args[0]) && __wm_return_value_23.args[0].length === 2 && __wm_return_value_23.args[0][1] === __wm_basis_Nil) {
const childPatternId_509 = __wm_return_value_23.args[0][0];
const child_510 = findPattern_197__wm_d2(context_506.patterns, childPatternId_509);
if (__wm_eq(child_510.kind, "wildcard")) {
const result_511 = { statementIds: __wm_basis_Nil, scope: scope_505, state: state_507 };
return result_511;
} else {
const field_512 = findFieldForConstructor_246__wm_d2(context_506.fields, pattern_502.constructorId);
const operation_513 = { ...baseOperation_290__wm_d3(owner_504, "payload", state_507), typeId: child_510.typeId, constructorId: pattern_502.constructorId, layoutId: field_512.layoutId, fieldId: field_512.id, args: Js.Array.fromList(__wm_basis_Cons([scrutineeAtomId_503, __wm_basis_Nil])) };
const __wm_bind_20 = pushOperation_285__wm_d2(operation_513, state_507);
if (!(__wm_is_tuple(__wm_bind_20) && __wm_bind_20.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_514 = __wm_bind_20[0];
const afterOperation_515 = __wm_bind_20[1];
const __wm_bind_21 = freshLocal_265__wm_d7(owner_504.functionId, "binding", child_510.typeId, child_510.bindingId, false, child_510.spanId, afterOperation_515);
if (!(__wm_is_tuple(__wm_bind_21) && __wm_bind_21.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_516 = __wm_bind_21[0];
const afterLocal_517 = __wm_bind_21[1];
const statement_518 = { ...baseStatement_301__wm_d5(owner_504.functionId, "let", owner_504.sourceExprId, child_510.spanId, afterLocal_517), localId: localId_516, operationId: operationId_514, reason: "binding" };
const __wm_bind_22 = pushStatement_294__wm_d2(statement_518, afterLocal_517);
if (!(__wm_is_tuple(__wm_bind_22) && __wm_bind_22.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_519 = __wm_bind_22[0];
const afterStatement_520 = __wm_bind_22[1];
const nextScope_521 = { ...scope_505, bindings: Map.set([scope_505.bindings, child_510.bindingId, localId_516]) };
const result_522 = { statementIds: __wm_basis_Cons([statementId_519, __wm_basis_Nil]), scope: nextScope_521, state: afterStatement_520 };
return result_522;
}
} else if (__wm_return_value_23?.ctor === -6 && __wm_return_value_23.args.length === 1 && __wm_is_tuple(__wm_return_value_23.args[0]) && __wm_return_value_23.args[0].length === 2) {
const firstChildPatternId_523 = __wm_return_value_23.args[0][0];
const restChildPatternIds_524 = __wm_return_value_23.args[0][1];
return bindMatchPayloadLanes_443__wm_d9(__wm_basis_Cons([firstChildPatternId_523, restChildPatternIds_524]), pattern_502, scrutineeAtomId_503, owner_504, scope_505, context_506, state_507, 0, __wm_basis_Nil);
}
__wm_fail("Match", "non-exhaustive match");
};
const bindMatchPayload_442 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return bindMatchPayload_442__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const bindMatchPayloadLanes_443__wm_d9 = (childPatternIds_525, pattern_526, scrutineeAtomId_527, owner_528, scope_529, context_530, state_531, index_532, reversedStatements_533) => {
__wm_tail_33: while (true) {
{
const __wm_scalar_59_0 = childPatternIds_525;
const __wm_scalar_59_1 = pattern_526;
const __wm_scalar_59_2 = scrutineeAtomId_527;
const __wm_scalar_59_3 = owner_528;
const __wm_scalar_59_4 = scope_529;
const __wm_scalar_59_5 = context_530;
const __wm_scalar_59_6 = state_531;
const __wm_scalar_59_7 = index_532;
const __wm_scalar_59_8 = reversedStatements_533;
if (__wm_scalar_59_0 === __wm_basis_Nil) {
const _pattern_534 = __wm_scalar_59_1;
const _scrutineeAtomId_535 = __wm_scalar_59_2;
const _owner_536 = __wm_scalar_59_3;
const scope_537 = __wm_scalar_59_4;
const _context_538 = __wm_scalar_59_5;
const state_539 = __wm_scalar_59_6;
const _index_540 = __wm_scalar_59_7;
const reversedStatements_541 = __wm_scalar_59_8;
{
const result_542 = { statementIds: reverseInto_146__wm_d2(reversedStatements_541, __wm_basis_Nil), scope: scope_537, state: state_539 };
return result_542;
}
} else if (__wm_scalar_59_0?.ctor === -6 && __wm_scalar_59_0.args.length === 1 && __wm_is_tuple(__wm_scalar_59_0.args[0]) && __wm_scalar_59_0.args[0].length === 2) {
const childPatternId_543 = __wm_scalar_59_0.args[0][0];
const rest_544 = __wm_scalar_59_0.args[0][1];
const pattern_545 = __wm_scalar_59_1;
const scrutineeAtomId_546 = __wm_scalar_59_2;
const owner_547 = __wm_scalar_59_3;
const scope_548 = __wm_scalar_59_4;
const context_549 = __wm_scalar_59_5;
const state_550 = __wm_scalar_59_6;
const index_551 = __wm_scalar_59_7;
const reversedStatements_552 = __wm_scalar_59_8;
{
const child_553 = findPattern_197__wm_d2(context_549.patterns, childPatternId_543);
if (__wm_eq(child_553.kind, "wildcard")) {
{
const __wm_tail_arg_38_0 = rest_544;
const __wm_tail_arg_38_1 = pattern_545;
const __wm_tail_arg_38_2 = scrutineeAtomId_546;
const __wm_tail_arg_38_3 = owner_547;
const __wm_tail_arg_38_4 = scope_548;
const __wm_tail_arg_38_5 = context_549;
const __wm_tail_arg_38_6 = state_550;
const __wm_tail_arg_38_7 = (index_551 + 1);
const __wm_tail_arg_38_8 = reversedStatements_552;
childPatternIds_525 = __wm_tail_arg_38_0;
pattern_526 = __wm_tail_arg_38_1;
scrutineeAtomId_527 = __wm_tail_arg_38_2;
owner_528 = __wm_tail_arg_38_3;
scope_529 = __wm_tail_arg_38_4;
context_530 = __wm_tail_arg_38_5;
state_531 = __wm_tail_arg_38_6;
index_532 = __wm_tail_arg_38_7;
reversedStatements_533 = __wm_tail_arg_38_8;
continue __wm_tail_33;
}
} else {
{
const field_554 = findFieldForConstructor_246__wm_d2(context_549.fields, pattern_545.constructorId);
const operation_555 = { ...baseOperation_290__wm_d3(owner_547, "payload", state_550), typeId: child_553.typeId, constructorId: pattern_545.constructorId, layoutId: field_554.layoutId, fieldId: field_554.id, index: index_551, args: Js.Array.fromList(__wm_basis_Cons([scrutineeAtomId_546, __wm_basis_Nil])) };
const __wm_bind_23 = pushOperation_285__wm_d2(operation_555, state_550);
if (!(__wm_is_tuple(__wm_bind_23) && __wm_bind_23.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_556 = __wm_bind_23[0];
const afterOperation_557 = __wm_bind_23[1];
const __wm_bind_24 = freshLocal_265__wm_d7(owner_547.functionId, "binding", child_553.typeId, child_553.bindingId, false, child_553.spanId, afterOperation_557);
if (!(__wm_is_tuple(__wm_bind_24) && __wm_bind_24.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_558 = __wm_bind_24[0];
const afterLocal_559 = __wm_bind_24[1];
const statement_560 = { ...baseStatement_301__wm_d5(owner_547.functionId, "let", owner_547.sourceExprId, child_553.spanId, afterLocal_559), localId: localId_558, operationId: operationId_556, reason: "binding" };
const __wm_bind_25 = pushStatement_294__wm_d2(statement_560, afterLocal_559);
if (!(__wm_is_tuple(__wm_bind_25) && __wm_bind_25.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_561 = __wm_bind_25[0];
const afterStatement_562 = __wm_bind_25[1];
const nextScope_563 = { ...scope_548, bindings: Map.set([scope_548.bindings, child_553.bindingId, localId_558]) };
{
const __wm_tail_arg_39_0 = rest_544;
const __wm_tail_arg_39_1 = pattern_545;
const __wm_tail_arg_39_2 = scrutineeAtomId_546;
const __wm_tail_arg_39_3 = owner_547;
const __wm_tail_arg_39_4 = nextScope_563;
const __wm_tail_arg_39_5 = context_549;
const __wm_tail_arg_39_6 = afterStatement_562;
const __wm_tail_arg_39_7 = (index_551 + 1);
const __wm_tail_arg_39_8 = __wm_basis_Cons([statementId_561, reversedStatements_552]);
childPatternIds_525 = __wm_tail_arg_39_0;
pattern_526 = __wm_tail_arg_39_1;
scrutineeAtomId_527 = __wm_tail_arg_39_2;
owner_528 = __wm_tail_arg_39_3;
scope_529 = __wm_tail_arg_39_4;
context_530 = __wm_tail_arg_39_5;
state_531 = __wm_tail_arg_39_6;
index_532 = __wm_tail_arg_39_7;
reversedStatements_533 = __wm_tail_arg_39_8;
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
const bindMatchPayloadLanes_443 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return bindMatchPayloadLanes_443__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const operationKind_565 = (__arg) => {
if (true) {
const expression_564 = __arg;
if (__wm_eq(expression_564.kind, "constructor")) {
return "construct";
} else {
return expression_564.kind;
}
}
__wm_fail("Match", "pattern match failure in function");
};
const bindOperation_584__wm_d7 = (expression_566, kind_567, args_568, localKind_569, reason_570, layoutId_571, state_572) => {
const operation_573 = { ...baseOperation_290__wm_d3(expression_566, kind_567, state_572), layoutId: layoutId_571, args: Js.Array.fromList(args_568) };
const __wm_bind_26 = pushOperation_285__wm_d2(operation_573, state_572);
if (!(__wm_is_tuple(__wm_bind_26) && __wm_bind_26.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_574 = __wm_bind_26[0];
const afterOperation_575 = __wm_bind_26[1];
const __wm_bind_27 = freshLocal_265__wm_d7(expression_566.functionId, localKind_569, expression_566.typeId, __wm_op_sub(1), false, expression_566.spanId, afterOperation_575);
if (!(__wm_is_tuple(__wm_bind_27) && __wm_bind_27.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_576 = __wm_bind_27[0];
const afterLocal_577 = __wm_bind_27[1];
const statement_578 = { ...baseStatement_301__wm_d5(expression_566.functionId, "let", expression_566.sourceExprId, expression_566.spanId, afterLocal_577), localId: localId_576, operationId: operationId_574, reason: reason_570 };
const __wm_bind_28 = pushStatement_294__wm_d2(statement_578, afterLocal_577);
if (!(__wm_is_tuple(__wm_bind_28) && __wm_bind_28.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_579 = __wm_bind_28[0];
const afterStatement_580 = __wm_bind_28[1];
const __wm_bind_29 = localAtom_277__wm_d6(expression_566.functionId, expression_566.typeId, expression_566.sourceExprId, expression_566.spanId, localId_576, afterStatement_580);
if (!(__wm_is_tuple(__wm_bind_29) && __wm_bind_29.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_581 = __wm_bind_29[0];
const afterAtom_582 = __wm_bind_29[1];
const result_583 = { statementIds: __wm_basis_Cons([statementId_579, __wm_basis_Nil]), atomId: atomId_581, state: afterAtom_582 };
return result_583;
};
const bindOperation_584 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return bindOperation_584__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const bindSourceOperation_590__wm_d4 = (expression_585, args_586, context_587, state_588) => {
if (__wm_eq(expression_585.kind, "constructor")) {
const layout_589 = findLayoutForType_211__wm_d2(context_587.layouts, expression_585.typeId);
return bindOperation_584__wm_d7(expression_585, "construct", args_586, "temporary", "temporary", layout_589.id, state_588);
} else {
return bindOperation_584__wm_d7(expression_585, operationKind_565(expression_585), args_586, "temporary", "temporary", __wm_op_sub(1), state_588);
}
};
const bindSourceOperation_590 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return bindSourceOperation_590__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerValue_591__wm_d4 = (expressionId_593, scope_594, context_595, state_596) => {
const expression_597 = findIrExpression_169__wm_d2(context_595.expressions, expressionId_593);
if (__wm_op_or_d2(__wm_op_or_d2(__wm_eq(expression_597.kind, "number"), __wm_eq(expression_597.kind, "bool")), __wm_eq(expression_597.kind, "void"))) {
const __wm_bind_30 = literalAtom_281__wm_d2(expression_597, state_596);
if (!(__wm_is_tuple(__wm_bind_30) && __wm_bind_30.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_598 = __wm_bind_30[0];
const next_599 = __wm_bind_30[1];
const result_600 = { statementIds: __wm_basis_Nil, atomId: atomId_598, state: next_599 };
return result_600;
} else {
if (__wm_eq(expression_597.kind, "local")) {
const __wm_return_value_24 = Map.get([scope_594.bindings, expression_597.bindingId]);
if (__wm_return_value_24?.ctor === -2 && __wm_return_value_24.args.length === 1) {
const localId_601 = __wm_return_value_24.args[0];
const __wm_bind_31 = localAtom_277__wm_d6(expression_597.functionId, expression_597.typeId, expression_597.sourceExprId, expression_597.spanId, localId_601, state_596);
if (!(__wm_is_tuple(__wm_bind_31) && __wm_bind_31.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_602 = __wm_bind_31[0];
const next_603 = __wm_bind_31[1];
const result_604 = { statementIds: __wm_basis_Nil, atomId: atomId_602, state: next_603 };
return result_604;
} else if (__wm_return_value_24 === __wm_basis_None) {

return __wm_fail("Panic", "lowered local has no lexical binding");
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_eq(expression_597.kind, "let")) {
return lowerLetValue_328__wm_d5(lowerValue_591, expression_597, scope_594, context_595, state_596);
} else {
if (__wm_eq(expression_597.kind, "sequence")) {
return lowerSequenceValue_329__wm_d5(lowerValue_591, expression_597, scope_594, context_595, state_596);
} else {
if (__wm_eq(expression_597.kind, "if")) {
return lowerIfValue_439__wm_d5(lowerValue_591, expression_597, scope_594, context_595, state_596);
} else {
if (__wm_eq(expression_597.kind, "match")) {
return lowerMatchValue_440__wm_d5(lowerValue_591, expression_597, scope_594, context_595, state_596);
} else {
if (__wm_eq(expression_597.kind, "tail-call")) {
return __wm_fail("Panic", "tail-call reached a value context");
} else {
const children_605 = lowerChildren_592__wm_d6(Js.Array.toList(expression_597.children), scope_594, context_595, state_596, __wm_basis_Nil, __wm_basis_Nil);
const value_606 = bindSourceOperation_590__wm_d4(expression_597, children_605.atomIds, context_595, children_605.state);
const result_607 = { statementIds: append_153__wm_d2(children_605.statementIds, value_606.statementIds), atomId: value_606.atomId, state: value_606.state };
return result_607;
}
}
}
}
}
}
}
};
const lowerValue_591 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return lowerValue_591__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerChildren_592__wm_d6 = (expressionIds_608, scope_609, context_610, state_611, reversedStatements_612, reversedAtoms_613) => {
__wm_tail_34: while (true) {
{
const __wm_scalar_60_0 = expressionIds_608;
const __wm_scalar_60_1 = scope_609;
const __wm_scalar_60_2 = context_610;
const __wm_scalar_60_3 = state_611;
const __wm_scalar_60_4 = reversedStatements_612;
const __wm_scalar_60_5 = reversedAtoms_613;
if (__wm_scalar_60_0 === __wm_basis_Nil) {
const scope_614 = __wm_scalar_60_1;
const context_615 = __wm_scalar_60_2;
const state_616 = __wm_scalar_60_3;
const reversedStatements_617 = __wm_scalar_60_4;
const reversedAtoms_618 = __wm_scalar_60_5;
{
const result_619 = { statementIds: reverseInto_146__wm_d2(reversedStatements_617, __wm_basis_Nil), atomIds: reverseInto_146__wm_d2(reversedAtoms_618, __wm_basis_Nil), state: state_616 };
return result_619;
}
} else if (__wm_scalar_60_0?.ctor === -6 && __wm_scalar_60_0.args.length === 1 && __wm_is_tuple(__wm_scalar_60_0.args[0]) && __wm_scalar_60_0.args[0].length === 2) {
const expressionId_620 = __wm_scalar_60_0.args[0][0];
const rest_621 = __wm_scalar_60_0.args[0][1];
const scope_622 = __wm_scalar_60_1;
const context_623 = __wm_scalar_60_2;
const state_624 = __wm_scalar_60_3;
const reversedStatements_625 = __wm_scalar_60_4;
const reversedAtoms_626 = __wm_scalar_60_5;
{
const value_627 = lowerValue_591__wm_d4(expressionId_620, scope_622, context_623, state_624);
{
const __wm_tail_arg_40_0 = rest_621;
const __wm_tail_arg_40_1 = scope_622;
const __wm_tail_arg_40_2 = context_623;
const __wm_tail_arg_40_3 = value_627.state;
const __wm_tail_arg_40_4 = reverseInto_146__wm_d2(value_627.statementIds, reversedStatements_625);
const __wm_tail_arg_40_5 = __wm_basis_Cons([value_627.atomId, reversedAtoms_626]);
expressionIds_608 = __wm_tail_arg_40_0;
scope_609 = __wm_tail_arg_40_1;
context_610 = __wm_tail_arg_40_2;
state_611 = __wm_tail_arg_40_3;
reversedStatements_612 = __wm_tail_arg_40_4;
reversedAtoms_613 = __wm_tail_arg_40_5;
continue __wm_tail_34;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const lowerChildren_592 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return lowerChildren_592__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const returnStatement_632__wm_d3 = (expression_628, atomId_629, state_630) => {
const statement_631 = { ...baseStatement_301__wm_d5(expression_628.functionId, "return", expression_628.sourceExprId, expression_628.spanId, state_630), atomId: atomId_629 };
return pushStatement_294__wm_d2(statement_631, state_630);
};
const returnStatement_632 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return returnStatement_632__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerTail_633__wm_d4 = (expressionId_639, scope_640, context_641, state_642) => {
const expression_643 = findIrExpression_169__wm_d2(context_641.expressions, expressionId_639);
if (__wm_eq(expression_643.kind, "tail-call")) {
return lowerTailCall_637__wm_d4(expression_643, scope_640, context_641, state_642);
} else {
if (__wm_eq(expression_643.kind, "let")) {
const __wm_return_value_25 = Js.Array.toList(expression_643.children);
if (__wm_return_value_25?.ctor === -6 && __wm_return_value_25.args.length === 1 && __wm_is_tuple(__wm_return_value_25.args[0]) && __wm_return_value_25.args[0].length === 2 && __wm_return_value_25.args[0][1]?.ctor === -6 && __wm_return_value_25.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_25.args[0][1].args[0]) && __wm_return_value_25.args[0][1].args[0].length === 2 && __wm_return_value_25.args[0][1].args[0][1] === __wm_basis_Nil) {
const valueExpressionId_644 = __wm_return_value_25.args[0][0];
const bodyExpressionId_645 = __wm_return_value_25.args[0][1].args[0][0];
const value_646 = lowerValue_591__wm_d4(valueExpressionId_644, scope_640, context_641, state_642);
const bound_647 = bindPattern_330__wm_d6(expression_643.patternId, value_646.atomId, expression_643, scope_640, context_641, value_646.state);
const body_648 = lowerTail_633__wm_d4(bodyExpressionId_645, bound_647.scope, context_641, bound_647.state);
const result_649 = { statementIds: append_153__wm_d2(value_646.statementIds, append_153__wm_d2(bound_647.statementIds, body_648.statementIds)), state: body_648.state };
return result_649;
} else if (true) {

return __wm_fail("Panic", "tail-position let does not have value and body children");
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_eq(expression_643.kind, "sequence")) {
const __wm_return_value_26 = Js.Array.toList(expression_643.children);
if (__wm_return_value_26?.ctor === -6 && __wm_return_value_26.args.length === 1 && __wm_is_tuple(__wm_return_value_26.args[0]) && __wm_return_value_26.args[0].length === 2 && __wm_return_value_26.args[0][1]?.ctor === -6 && __wm_return_value_26.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_26.args[0][1].args[0]) && __wm_return_value_26.args[0][1].args[0].length === 2 && __wm_return_value_26.args[0][1].args[0][1] === __wm_basis_Nil) {
const discardedExpressionId_650 = __wm_return_value_26.args[0][0];
const bodyExpressionId_651 = __wm_return_value_26.args[0][1].args[0][0];
const discarded_652 = lowerValue_591__wm_d4(discardedExpressionId_650, scope_640, context_641, state_642);
const body_653 = lowerTail_633__wm_d4(bodyExpressionId_651, scope_640, context_641, discarded_652.state);
const result_654 = { statementIds: append_153__wm_d2(discarded_652.statementIds, body_653.statementIds), state: body_653.state };
return result_654;
} else if (true) {

return __wm_fail("Panic", "tail-position sequence does not have two children");
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_eq(expression_643.kind, "if")) {
return lowerTailIf_634__wm_d4(expression_643, scope_640, context_641, state_642);
} else {
if (__wm_eq(expression_643.kind, "match")) {
return lowerTailMatch_635__wm_d4(expression_643, scope_640, context_641, state_642);
} else {
const value_655 = lowerValue_591__wm_d4(expressionId_639, scope_640, context_641, state_642);
const __wm_bind_32 = returnStatement_632__wm_d3(expression_643, value_655.atomId, value_655.state);
if (!(__wm_is_tuple(__wm_bind_32) && __wm_bind_32.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const returnId_656 = __wm_bind_32[0];
const afterReturn_657 = __wm_bind_32[1];
const result_658 = { statementIds: append_153__wm_d2(value_655.statementIds, __wm_basis_Cons([returnId_656, __wm_basis_Nil])), state: afterReturn_657 };
return result_658;
}
}
}
}
}
};
const lowerTail_633 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return lowerTail_633__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerTailIf_634__wm_d4 = (expression_659, scope_660, context_661, state_662) => {
const __wm_return_value_27 = Js.Array.toList(expression_659.children);
if (__wm_return_value_27?.ctor === -6 && __wm_return_value_27.args.length === 1 && __wm_is_tuple(__wm_return_value_27.args[0]) && __wm_return_value_27.args[0].length === 2 && __wm_return_value_27.args[0][1]?.ctor === -6 && __wm_return_value_27.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_27.args[0][1].args[0]) && __wm_return_value_27.args[0][1].args[0].length === 2 && __wm_return_value_27.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_27.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_27.args[0][1].args[0][1].args[0]) && __wm_return_value_27.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_27.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const conditionExpressionId_663 = __wm_return_value_27.args[0][0];
const thenExpressionId_664 = __wm_return_value_27.args[0][1].args[0][0];
const elseExpressionId_665 = __wm_return_value_27.args[0][1].args[0][1].args[0][0];
const condition_666 = lowerValue_591__wm_d4(conditionExpressionId_663, scope_660, context_661, state_662);
const thenTail_667 = lowerTail_633__wm_d4(thenExpressionId_664, scope_660, context_661, condition_666.state);
const __wm_bind_33 = pushBlock_307__wm_d3(expression_659.functionId, thenTail_667.statementIds, thenTail_667.state);
if (!(__wm_is_tuple(__wm_bind_33) && __wm_bind_33.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const thenBlockId_668 = __wm_bind_33[0];
const afterThen_669 = __wm_bind_33[1];
const elseTail_670 = lowerTail_633__wm_d4(elseExpressionId_665, scope_660, context_661, afterThen_669);
const __wm_bind_34 = pushBlock_307__wm_d3(expression_659.functionId, elseTail_670.statementIds, elseTail_670.state);
if (!(__wm_is_tuple(__wm_bind_34) && __wm_bind_34.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const elseBlockId_671 = __wm_bind_34[0];
const afterElse_672 = __wm_bind_34[1];
const statement_673 = { ...baseStatement_301__wm_d5(expression_659.functionId, "if", expression_659.sourceExprId, expression_659.spanId, afterElse_672), conditionAtomId: condition_666.atomId, thenBlockId: thenBlockId_668, elseBlockId: elseBlockId_671 };
const __wm_bind_35 = pushStatement_294__wm_d2(statement_673, afterElse_672);
if (!(__wm_is_tuple(__wm_bind_35) && __wm_bind_35.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_674 = __wm_bind_35[0];
const afterIf_675 = __wm_bind_35[1];
const result_676 = { statementIds: append_153__wm_d2(condition_666.statementIds, __wm_basis_Cons([statementId_674, __wm_basis_Nil])), state: afterIf_675 };
return result_676;
} else if (true) {

return __wm_fail("Panic", "tail-position if does not have three children");
}
__wm_fail("Match", "non-exhaustive match");
};
const lowerTailIf_634 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return lowerTailIf_634__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerTailMatch_635__wm_d4 = (expression_677, scope_678, context_679, state_680) => {
const __wm_return_value_28 = Js.Array.toList(expression_677.children);
if (__wm_return_value_28?.ctor === -6 && __wm_return_value_28.args.length === 1 && __wm_is_tuple(__wm_return_value_28.args[0]) && __wm_return_value_28.args[0].length === 2 && __wm_return_value_28.args[0][1] === __wm_basis_Nil) {
const scrutineeExpressionId_681 = __wm_return_value_28.args[0][0];
const scrutinee_682 = lowerValue_591__wm_d4(scrutineeExpressionId_681, scope_678, context_679, state_680);
const scrutineeExpression_683 = findIrExpression_169__wm_d2(context_679.expressions, scrutineeExpressionId_681);
const layout_684 = findLayoutForType_211__wm_d2(context_679.layouts, scrutineeExpression_683.typeId);
const cases_685 = lowerTailMatchCases_636__wm_d7(Js.Array.toList(expression_677.armIds), expression_677, scrutinee_682.atomId, scope_678, context_679, scrutinee_682.state, __wm_basis_Nil);
const statement_686 = { ...baseStatement_301__wm_d5(expression_677.functionId, "switch", expression_677.sourceExprId, expression_677.spanId, cases_685.state), scrutineeAtomId: scrutinee_682.atomId, layoutId: layout_684.id, caseIds: Js.Array.fromList(cases_685.caseIds) };
const __wm_bind_36 = pushStatement_294__wm_d2(statement_686, cases_685.state);
if (!(__wm_is_tuple(__wm_bind_36) && __wm_bind_36.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_687 = __wm_bind_36[0];
const afterSwitch_688 = __wm_bind_36[1];
const result_689 = { statementIds: append_153__wm_d2(scrutinee_682.statementIds, __wm_basis_Cons([statementId_687, __wm_basis_Nil])), state: afterSwitch_688 };
return result_689;
} else if (true) {

return __wm_fail("Panic", "tail-position match does not have one scrutinee");
}
__wm_fail("Match", "non-exhaustive match");
};
const lowerTailMatch_635 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return lowerTailMatch_635__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerTailMatchCases_636__wm_d7 = (armIds_690, expression_691, scrutineeAtomId_692, scope_693, context_694, state_695, reversedCases_696) => {
__wm_tail_35: while (true) {
{
const __wm_scalar_61_0 = armIds_690;
const __wm_scalar_61_1 = expression_691;
const __wm_scalar_61_2 = scrutineeAtomId_692;
const __wm_scalar_61_3 = scope_693;
const __wm_scalar_61_4 = context_694;
const __wm_scalar_61_5 = state_695;
const __wm_scalar_61_6 = reversedCases_696;
if (__wm_scalar_61_0 === __wm_basis_Nil) {
const expression_697 = __wm_scalar_61_1;
const scrutineeAtomId_698 = __wm_scalar_61_2;
const scope_699 = __wm_scalar_61_3;
const context_700 = __wm_scalar_61_4;
const state_701 = __wm_scalar_61_5;
const reversedCases_702 = __wm_scalar_61_6;
{
const result_703 = { caseIds: reverseInto_146__wm_d2(reversedCases_702, __wm_basis_Nil), state: state_701 };
return result_703;
}
} else if (__wm_scalar_61_0?.ctor === -6 && __wm_scalar_61_0.args.length === 1 && __wm_is_tuple(__wm_scalar_61_0.args[0]) && __wm_scalar_61_0.args[0].length === 2) {
const armId_704 = __wm_scalar_61_0.args[0][0];
const rest_705 = __wm_scalar_61_0.args[0][1];
const expression_706 = __wm_scalar_61_1;
const scrutineeAtomId_707 = __wm_scalar_61_2;
const scope_708 = __wm_scalar_61_3;
const context_709 = __wm_scalar_61_4;
const state_710 = __wm_scalar_61_5;
const reversedCases_711 = __wm_scalar_61_6;
{
const arm_712 = findIrMatchArm_176__wm_d2(context_709.matchArms, armId_704);
const pattern_713 = findPattern_197__wm_d2(context_709.patterns, arm_712.patternId);
const constructor_714 = findConstructor_204__wm_d2(context_709.constructors, pattern_713.constructorId);
const bound_715 = bindMatchPayload_442__wm_d6(pattern_713, scrutineeAtomId_707, expression_706, scope_708, context_709, state_710);
const body_716 = lowerTail_633__wm_d4(arm_712.bodyExprId, bound_715.scope, context_709, bound_715.state);
const __wm_bind_37 = pushBlock_307__wm_d3(expression_706.functionId, append_153__wm_d2(bound_715.statementIds, body_716.statementIds), body_716.state);
if (!(__wm_is_tuple(__wm_bind_37) && __wm_bind_37.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const blockId_717 = __wm_bind_37[0];
const afterBlock_718 = __wm_bind_37[1];
const gpuCase_719 = { id: afterBlock_718.nextCaseId, functionId: expression_706.functionId, constructorId: constructor_714.id, tag: constructor_714.tag, blockId: blockId_717, spanId: arm_712.spanId };
const __wm_bind_38 = pushCase_311__wm_d2(gpuCase_719, afterBlock_718);
if (!(__wm_is_tuple(__wm_bind_38) && __wm_bind_38.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const caseId_720 = __wm_bind_38[0];
const afterCase_721 = __wm_bind_38[1];
{
const __wm_tail_arg_41_0 = rest_705;
const __wm_tail_arg_41_1 = expression_706;
const __wm_tail_arg_41_2 = scrutineeAtomId_707;
const __wm_tail_arg_41_3 = scope_708;
const __wm_tail_arg_41_4 = context_709;
const __wm_tail_arg_41_5 = afterCase_721;
const __wm_tail_arg_41_6 = __wm_basis_Cons([caseId_720, reversedCases_711]);
armIds_690 = __wm_tail_arg_41_0;
expression_691 = __wm_tail_arg_41_1;
scrutineeAtomId_692 = __wm_tail_arg_41_2;
scope_693 = __wm_tail_arg_41_3;
context_694 = __wm_tail_arg_41_4;
state_695 = __wm_tail_arg_41_5;
reversedCases_696 = __wm_tail_arg_41_6;
continue __wm_tail_35;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const lowerTailMatchCases_636 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return lowerTailMatchCases_636__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerTailCall_637__wm_d4 = (expression_722, scope_723, context_724, state_725) => {
const children_726 = lowerChildren_592__wm_d6(Js.Array.toList(expression_722.children), scope_723, context_724, state_725, __wm_basis_Nil, __wm_basis_Nil);
const nextValues_727 = materializeTailNext_638__wm_d5(children_726.atomIds, expression_722, children_726.state, __wm_basis_Nil, __wm_basis_Nil);
const statement_728 = { ...baseStatement_301__wm_d5(expression_722.functionId, "continue", expression_722.sourceExprId, expression_722.spanId, nextValues_727.state), targetLocalIds: Js.Array.fromList(scope_723.loopParamLocalIds), valueAtomIds: Js.Array.fromList(nextValues_727.atomIds) };
const __wm_bind_39 = pushStatement_294__wm_d2(statement_728, nextValues_727.state);
if (!(__wm_is_tuple(__wm_bind_39) && __wm_bind_39.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_729 = __wm_bind_39[0];
const afterContinue_730 = __wm_bind_39[1];
const result_731 = { statementIds: append_153__wm_d2(children_726.statementIds, append_153__wm_d2(nextValues_727.statementIds, __wm_basis_Cons([statementId_729, __wm_basis_Nil]))), state: afterContinue_730 };
return result_731;
};
const lowerTailCall_637 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return lowerTailCall_637__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const materializeTailNext_638__wm_d5 = (atomIds_732, expression_733, state_734, reversedStatements_735, reversedAtoms_736) => {
__wm_tail_36: while (true) {
{
const __wm_scalar_62_0 = atomIds_732;
const __wm_scalar_62_1 = expression_733;
const __wm_scalar_62_2 = state_734;
const __wm_scalar_62_3 = reversedStatements_735;
const __wm_scalar_62_4 = reversedAtoms_736;
if (__wm_scalar_62_0 === __wm_basis_Nil) {
const expression_737 = __wm_scalar_62_1;
const state_738 = __wm_scalar_62_2;
const reversedStatements_739 = __wm_scalar_62_3;
const reversedAtoms_740 = __wm_scalar_62_4;
{
const result_741 = { statementIds: reverseInto_146__wm_d2(reversedStatements_739, __wm_basis_Nil), atomIds: reverseInto_146__wm_d2(reversedAtoms_740, __wm_basis_Nil), state: state_738 };
return result_741;
}
} else if (__wm_scalar_62_0?.ctor === -6 && __wm_scalar_62_0.args.length === 1 && __wm_is_tuple(__wm_scalar_62_0.args[0]) && __wm_scalar_62_0.args[0].length === 2) {
const atomId_742 = __wm_scalar_62_0.args[0][0];
const rest_743 = __wm_scalar_62_0.args[0][1];
const expression_744 = __wm_scalar_62_1;
const state_745 = __wm_scalar_62_2;
const reversedStatements_746 = __wm_scalar_62_3;
const reversedAtoms_747 = __wm_scalar_62_4;
{
const atom_748 = findLoweredAtom_183__wm_d2(state_745.atoms, atomId_742);
const operation_749 = { ...baseOperation_290__wm_d3(expression_744, "copy", state_745), typeId: atom_748.typeId, targetFunctionId: __wm_op_sub(1), args: Js.Array.fromList(__wm_basis_Cons([atomId_742, __wm_basis_Nil])) };
const __wm_bind_40 = pushOperation_285__wm_d2(operation_749, state_745);
if (!(__wm_is_tuple(__wm_bind_40) && __wm_bind_40.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_750 = __wm_bind_40[0];
const afterOperation_751 = __wm_bind_40[1];
const __wm_bind_41 = freshLocal_265__wm_d7(expression_744.functionId, "tail-next", atom_748.typeId, __wm_op_sub(1), false, expression_744.spanId, afterOperation_751);
if (!(__wm_is_tuple(__wm_bind_41) && __wm_bind_41.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_752 = __wm_bind_41[0];
const afterLocal_753 = __wm_bind_41[1];
const statement_754 = { ...baseStatement_301__wm_d5(expression_744.functionId, "let", expression_744.sourceExprId, expression_744.spanId, afterLocal_753), localId: localId_752, operationId: operationId_750, reason: "tail-next" };
const __wm_bind_42 = pushStatement_294__wm_d2(statement_754, afterLocal_753);
if (!(__wm_is_tuple(__wm_bind_42) && __wm_bind_42.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_755 = __wm_bind_42[0];
const afterStatement_756 = __wm_bind_42[1];
const __wm_bind_43 = localAtom_277__wm_d6(expression_744.functionId, atom_748.typeId, expression_744.sourceExprId, expression_744.spanId, localId_752, afterStatement_756);
if (!(__wm_is_tuple(__wm_bind_43) && __wm_bind_43.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextAtomId_757 = __wm_bind_43[0];
const afterAtom_758 = __wm_bind_43[1];
{
const __wm_tail_arg_42_0 = rest_743;
const __wm_tail_arg_42_1 = expression_744;
const __wm_tail_arg_42_2 = afterAtom_758;
const __wm_tail_arg_42_3 = __wm_basis_Cons([statementId_755, reversedStatements_746]);
const __wm_tail_arg_42_4 = __wm_basis_Cons([nextAtomId_757, reversedAtoms_747]);
atomIds_732 = __wm_tail_arg_42_0;
expression_733 = __wm_tail_arg_42_1;
state_734 = __wm_tail_arg_42_2;
reversedStatements_735 = __wm_tail_arg_42_3;
reversedAtoms_736 = __wm_tail_arg_42_4;
continue __wm_tail_36;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const materializeTailNext_638 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return materializeTailNext_638__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const setupParameters_759__wm_d7 = (paramIds_760, functionId_761, context_762, scope_763, state_764, reversedPhysicalIds_765, reversedStatements_766) => {
__wm_tail_37: while (true) {
{
const __wm_scalar_63_0 = paramIds_760;
const __wm_scalar_63_1 = functionId_761;
const __wm_scalar_63_2 = context_762;
const __wm_scalar_63_3 = scope_763;
const __wm_scalar_63_4 = state_764;
const __wm_scalar_63_5 = reversedPhysicalIds_765;
const __wm_scalar_63_6 = reversedStatements_766;
if (__wm_scalar_63_0 === __wm_basis_Nil) {
const functionId_767 = __wm_scalar_63_1;
const context_768 = __wm_scalar_63_2;
const scope_769 = __wm_scalar_63_3;
const state_770 = __wm_scalar_63_4;
const reversedPhysicalIds_771 = __wm_scalar_63_5;
const reversedStatements_772 = __wm_scalar_63_6;
{
const result_773 = { physicalLocalIds: reverseInto_146__wm_d2(reversedPhysicalIds_771, __wm_basis_Nil), activeLocalIds: reverseInto_146__wm_d2(reversedPhysicalIds_771, __wm_basis_Nil), initialStatementIds: reverseInto_146__wm_d2(reversedStatements_772, __wm_basis_Nil), iterationStatementIds: __wm_basis_Nil, scope: scope_769, state: state_770 };
return result_773;
}
} else if (__wm_scalar_63_0?.ctor === -6 && __wm_scalar_63_0.args.length === 1 && __wm_is_tuple(__wm_scalar_63_0.args[0]) && __wm_scalar_63_0.args[0].length === 2) {
const paramId_774 = __wm_scalar_63_0.args[0][0];
const rest_775 = __wm_scalar_63_0.args[0][1];
const functionId_776 = __wm_scalar_63_1;
const context_777 = __wm_scalar_63_2;
const scope_778 = __wm_scalar_63_3;
const state_779 = __wm_scalar_63_4;
const reversedPhysicalIds_780 = __wm_scalar_63_5;
const reversedStatements_781 = __wm_scalar_63_6;
{
const param_782 = findParam_190__wm_d2(context_777.params, paramId_774);
const pattern_783 = findPattern_197__wm_d2(context_777.patterns, param_782.patternId);
const bindingId_784 = (__wm_eq(pattern_783.kind, "binding") ? pattern_783.bindingId : __wm_op_sub(1));
const __wm_bind_44 = freshLocal_265__wm_d7(functionId_776, "parameter", param_782.typeId, bindingId_784, false, param_782.spanId, state_779);
if (!(__wm_is_tuple(__wm_bind_44) && __wm_bind_44.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_785 = __wm_bind_44[0];
const afterLocal_786 = __wm_bind_44[1];
const __wm_bind_45 = localAtom_277__wm_d6(functionId_776, param_782.typeId, __wm_op_sub(1), param_782.spanId, localId_785, afterLocal_786);
if (!(__wm_is_tuple(__wm_bind_45) && __wm_bind_45.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_787 = __wm_bind_45[0];
const afterAtom_788 = __wm_bind_45[1];
if (__wm_eq(pattern_783.kind, "binding")) {
{
const nextScope_789 = { ...scope_778, bindings: Map.set([scope_778.bindings, pattern_783.bindingId, localId_785]) };
{
const __wm_tail_arg_43_0 = rest_775;
const __wm_tail_arg_43_1 = functionId_776;
const __wm_tail_arg_43_2 = context_777;
const __wm_tail_arg_43_3 = nextScope_789;
const __wm_tail_arg_43_4 = afterAtom_788;
const __wm_tail_arg_43_5 = __wm_basis_Cons([localId_785, reversedPhysicalIds_780]);
const __wm_tail_arg_43_6 = reversedStatements_781;
paramIds_760 = __wm_tail_arg_43_0;
functionId_761 = __wm_tail_arg_43_1;
context_762 = __wm_tail_arg_43_2;
scope_763 = __wm_tail_arg_43_3;
state_764 = __wm_tail_arg_43_4;
reversedPhysicalIds_765 = __wm_tail_arg_43_5;
reversedStatements_766 = __wm_tail_arg_43_6;
continue __wm_tail_37;
}
}
} else {
{
const fn_790 = findIrFunction_162__wm_d2(context_777.functions, functionId_776);
const owner_791 = findIrExpression_169__wm_d2(context_777.expressions, fn_790.bodyExprId);
const bound_792 = bindPattern_330__wm_d6(pattern_783.id, atomId_787, owner_791, scope_778, context_777, afterAtom_788);
{
const __wm_tail_arg_44_0 = rest_775;
const __wm_tail_arg_44_1 = functionId_776;
const __wm_tail_arg_44_2 = context_777;
const __wm_tail_arg_44_3 = bound_792.scope;
const __wm_tail_arg_44_4 = bound_792.state;
const __wm_tail_arg_44_5 = __wm_basis_Cons([localId_785, reversedPhysicalIds_780]);
const __wm_tail_arg_44_6 = reverseInto_146__wm_d2(bound_792.statementIds, reversedStatements_781);
paramIds_760 = __wm_tail_arg_44_0;
functionId_761 = __wm_tail_arg_44_1;
context_762 = __wm_tail_arg_44_2;
scope_763 = __wm_tail_arg_44_3;
state_764 = __wm_tail_arg_44_4;
reversedPhysicalIds_765 = __wm_tail_arg_44_5;
reversedStatements_766 = __wm_tail_arg_44_6;
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
const setupParameters_759 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return setupParameters_759__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerNonrecursiveFunction_804__wm_d3 = (fn_793, context_794, state_795) => {
const params_796 = setupParameters_759__wm_d7(Js.Array.toList(fn_793.paramIds), fn_793.functionId, context_794, emptyScope_327(undefined), state_795, __wm_basis_Nil, __wm_basis_Nil);
const body_797 = lowerValue_591__wm_d4(fn_793.bodyExprId, params_796.scope, context_794, params_796.state);
const bodyExpression_798 = findIrExpression_169__wm_d2(context_794.expressions, fn_793.bodyExprId);
const __wm_bind_46 = returnStatement_632__wm_d3(bodyExpression_798, body_797.atomId, body_797.state);
if (!(__wm_is_tuple(__wm_bind_46) && __wm_bind_46.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const returnId_799 = __wm_bind_46[0];
const afterReturn_800 = __wm_bind_46[1];
const __wm_bind_47 = pushBlock_307__wm_d3(fn_793.functionId, append_153__wm_d2(params_796.initialStatementIds, append_153__wm_d2(body_797.statementIds, __wm_basis_Cons([returnId_799, __wm_basis_Nil]))), afterReturn_800);
if (!(__wm_is_tuple(__wm_bind_47) && __wm_bind_47.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const blockId_801 = __wm_bind_47[0];
const afterBlock_802 = __wm_bind_47[1];
const lowered_803 = { functionId: fn_793.functionId, physicalParamLocalIds: Js.Array.fromList(params_796.physicalLocalIds), loopParamLocalIds: Js.Array.fromList(__wm_basis_Nil), bodyBlockId: blockId_801, recursive: false, spanId: fn_793.spanId };
return pushFunction_315__wm_d2(lowered_803, afterBlock_802);
};
const lowerNonrecursiveFunction_804 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return lowerNonrecursiveFunction_804__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setupRecursiveParameters_805__wm_d9 = (paramIds_806, fn_807, context_808, scope_809, state_810, reversedPhysicalIds_811, reversedLoopIds_812, reversedInitialStatements_813, reversedIterationStatements_814) => {
__wm_tail_38: while (true) {
{
const __wm_scalar_64_0 = paramIds_806;
const __wm_scalar_64_1 = fn_807;
const __wm_scalar_64_2 = context_808;
const __wm_scalar_64_3 = scope_809;
const __wm_scalar_64_4 = state_810;
const __wm_scalar_64_5 = reversedPhysicalIds_811;
const __wm_scalar_64_6 = reversedLoopIds_812;
const __wm_scalar_64_7 = reversedInitialStatements_813;
const __wm_scalar_64_8 = reversedIterationStatements_814;
if (__wm_scalar_64_0 === __wm_basis_Nil) {
const fn_815 = __wm_scalar_64_1;
const context_816 = __wm_scalar_64_2;
const scope_817 = __wm_scalar_64_3;
const state_818 = __wm_scalar_64_4;
const reversedPhysicalIds_819 = __wm_scalar_64_5;
const reversedLoopIds_820 = __wm_scalar_64_6;
const reversedInitialStatements_821 = __wm_scalar_64_7;
const reversedIterationStatements_822 = __wm_scalar_64_8;
{
const loopIds_823 = reverseInto_146__wm_d2(reversedLoopIds_820, __wm_basis_Nil);
const nextScope_824 = { ...scope_817, loopParamLocalIds: loopIds_823 };
const result_825 = { physicalLocalIds: reverseInto_146__wm_d2(reversedPhysicalIds_819, __wm_basis_Nil), activeLocalIds: loopIds_823, initialStatementIds: reverseInto_146__wm_d2(reversedInitialStatements_821, __wm_basis_Nil), iterationStatementIds: reverseInto_146__wm_d2(reversedIterationStatements_822, __wm_basis_Nil), scope: nextScope_824, state: state_818 };
return result_825;
}
} else if (__wm_scalar_64_0?.ctor === -6 && __wm_scalar_64_0.args.length === 1 && __wm_is_tuple(__wm_scalar_64_0.args[0]) && __wm_scalar_64_0.args[0].length === 2) {
const paramId_826 = __wm_scalar_64_0.args[0][0];
const rest_827 = __wm_scalar_64_0.args[0][1];
const fn_828 = __wm_scalar_64_1;
const context_829 = __wm_scalar_64_2;
const scope_830 = __wm_scalar_64_3;
const state_831 = __wm_scalar_64_4;
const reversedPhysicalIds_832 = __wm_scalar_64_5;
const reversedLoopIds_833 = __wm_scalar_64_6;
const reversedInitialStatements_834 = __wm_scalar_64_7;
const reversedIterationStatements_835 = __wm_scalar_64_8;
{
const param_836 = findParam_190__wm_d2(context_829.params, paramId_826);
const pattern_837 = findPattern_197__wm_d2(context_829.patterns, param_836.patternId);
const bindingId_838 = (__wm_eq(pattern_837.kind, "binding") ? pattern_837.bindingId : __wm_op_sub(1));
const owner_839 = findIrExpression_169__wm_d2(context_829.expressions, fn_828.bodyExprId);
const __wm_bind_48 = freshLocal_265__wm_d7(fn_828.functionId, "parameter", param_836.typeId, bindingId_838, false, param_836.spanId, state_831);
if (!(__wm_is_tuple(__wm_bind_48) && __wm_bind_48.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const physicalId_840 = __wm_bind_48[0];
const afterPhysical_841 = __wm_bind_48[1];
const __wm_bind_49 = localAtom_277__wm_d6(fn_828.functionId, param_836.typeId, __wm_op_sub(1), param_836.spanId, physicalId_840, afterPhysical_841);
if (!(__wm_is_tuple(__wm_bind_49) && __wm_bind_49.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const physicalAtomId_842 = __wm_bind_49[0];
const afterPhysicalAtom_843 = __wm_bind_49[1];
const operation_844 = { ...baseOperation_290__wm_d3(owner_839, "copy", afterPhysicalAtom_843), typeId: param_836.typeId, args: Js.Array.fromList(__wm_basis_Cons([physicalAtomId_842, __wm_basis_Nil])) };
const __wm_bind_50 = pushOperation_285__wm_d2(operation_844, afterPhysicalAtom_843);
if (!(__wm_is_tuple(__wm_bind_50) && __wm_bind_50.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_845 = __wm_bind_50[0];
const afterOperation_846 = __wm_bind_50[1];
const __wm_bind_51 = freshLocal_265__wm_d7(fn_828.functionId, "loop-parameter", param_836.typeId, bindingId_838, true, param_836.spanId, afterOperation_846);
if (!(__wm_is_tuple(__wm_bind_51) && __wm_bind_51.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const loopId_847 = __wm_bind_51[0];
const afterLoopLocal_848 = __wm_bind_51[1];
const initial_849 = { ...baseStatement_301__wm_d5(fn_828.functionId, "let", owner_839.sourceExprId, param_836.spanId, afterLoopLocal_848), localId: loopId_847, operationId: operationId_845, reason: "loop-initial" };
const __wm_bind_52 = pushStatement_294__wm_d2(initial_849, afterLoopLocal_848);
if (!(__wm_is_tuple(__wm_bind_52) && __wm_bind_52.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const initialId_850 = __wm_bind_52[0];
const afterInitial_851 = __wm_bind_52[1];
const __wm_bind_53 = localAtom_277__wm_d6(fn_828.functionId, param_836.typeId, owner_839.sourceExprId, param_836.spanId, loopId_847, afterInitial_851);
if (!(__wm_is_tuple(__wm_bind_53) && __wm_bind_53.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const loopAtomId_852 = __wm_bind_53[0];
const afterLoopAtom_853 = __wm_bind_53[1];
if (__wm_eq(pattern_837.kind, "binding")) {
{
const nextScope_854 = { ...scope_830, bindings: Map.set([scope_830.bindings, pattern_837.bindingId, loopId_847]) };
{
const __wm_tail_arg_45_0 = rest_827;
const __wm_tail_arg_45_1 = fn_828;
const __wm_tail_arg_45_2 = context_829;
const __wm_tail_arg_45_3 = nextScope_854;
const __wm_tail_arg_45_4 = afterLoopAtom_853;
const __wm_tail_arg_45_5 = __wm_basis_Cons([physicalId_840, reversedPhysicalIds_832]);
const __wm_tail_arg_45_6 = __wm_basis_Cons([loopId_847, reversedLoopIds_833]);
const __wm_tail_arg_45_7 = __wm_basis_Cons([initialId_850, reversedInitialStatements_834]);
const __wm_tail_arg_45_8 = reversedIterationStatements_835;
paramIds_806 = __wm_tail_arg_45_0;
fn_807 = __wm_tail_arg_45_1;
context_808 = __wm_tail_arg_45_2;
scope_809 = __wm_tail_arg_45_3;
state_810 = __wm_tail_arg_45_4;
reversedPhysicalIds_811 = __wm_tail_arg_45_5;
reversedLoopIds_812 = __wm_tail_arg_45_6;
reversedInitialStatements_813 = __wm_tail_arg_45_7;
reversedIterationStatements_814 = __wm_tail_arg_45_8;
continue __wm_tail_38;
}
}
} else {
{
const bound_855 = bindPattern_330__wm_d6(pattern_837.id, loopAtomId_852, owner_839, scope_830, context_829, afterLoopAtom_853);
{
const __wm_tail_arg_46_0 = rest_827;
const __wm_tail_arg_46_1 = fn_828;
const __wm_tail_arg_46_2 = context_829;
const __wm_tail_arg_46_3 = bound_855.scope;
const __wm_tail_arg_46_4 = bound_855.state;
const __wm_tail_arg_46_5 = __wm_basis_Cons([physicalId_840, reversedPhysicalIds_832]);
const __wm_tail_arg_46_6 = __wm_basis_Cons([loopId_847, reversedLoopIds_833]);
const __wm_tail_arg_46_7 = __wm_basis_Cons([initialId_850, reversedInitialStatements_834]);
const __wm_tail_arg_46_8 = reverseInto_146__wm_d2(bound_855.statementIds, reversedIterationStatements_835);
paramIds_806 = __wm_tail_arg_46_0;
fn_807 = __wm_tail_arg_46_1;
context_808 = __wm_tail_arg_46_2;
scope_809 = __wm_tail_arg_46_3;
state_810 = __wm_tail_arg_46_4;
reversedPhysicalIds_811 = __wm_tail_arg_46_5;
reversedLoopIds_812 = __wm_tail_arg_46_6;
reversedInitialStatements_813 = __wm_tail_arg_46_7;
reversedIterationStatements_814 = __wm_tail_arg_46_8;
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
const setupRecursiveParameters_805 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return setupRecursiveParameters_805__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerRecursiveFunction_870__wm_d3 = (fn_856, context_857, state_858) => {
const params_859 = setupRecursiveParameters_805__wm_d9(Js.Array.toList(fn_856.paramIds), fn_856, context_857, emptyScope_327(undefined), state_858, __wm_basis_Nil, __wm_basis_Nil, __wm_basis_Nil, __wm_basis_Nil);
const tail_860 = lowerTail_633__wm_d4(fn_856.bodyExprId, params_859.scope, context_857, params_859.state);
const __wm_bind_54 = pushBlock_307__wm_d3(fn_856.functionId, append_153__wm_d2(params_859.iterationStatementIds, tail_860.statementIds), tail_860.state);
if (!(__wm_is_tuple(__wm_bind_54) && __wm_bind_54.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const loopBodyId_861 = __wm_bind_54[0];
const afterLoopBody_862 = __wm_bind_54[1];
const bodyExpression_863 = findIrExpression_169__wm_d2(context_857.expressions, fn_856.bodyExprId);
const loopStatement_864 = { ...baseStatement_301__wm_d5(fn_856.functionId, "loop", bodyExpression_863.sourceExprId, bodyExpression_863.spanId, afterLoopBody_862), bodyBlockId: loopBodyId_861 };
const __wm_bind_55 = pushStatement_294__wm_d2(loopStatement_864, afterLoopBody_862);
if (!(__wm_is_tuple(__wm_bind_55) && __wm_bind_55.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const loopStatementId_865 = __wm_bind_55[0];
const afterLoop_866 = __wm_bind_55[1];
const __wm_bind_56 = pushBlock_307__wm_d3(fn_856.functionId, append_153__wm_d2(params_859.initialStatementIds, __wm_basis_Cons([loopStatementId_865, __wm_basis_Nil])), afterLoop_866);
if (!(__wm_is_tuple(__wm_bind_56) && __wm_bind_56.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const outerBlockId_867 = __wm_bind_56[0];
const afterOuter_868 = __wm_bind_56[1];
const lowered_869 = { functionId: fn_856.functionId, physicalParamLocalIds: Js.Array.fromList(params_859.physicalLocalIds), loopParamLocalIds: Js.Array.fromList(params_859.activeLocalIds), bodyBlockId: outerBlockId_867, recursive: true, spanId: fn_856.spanId };
return pushFunction_315__wm_d2(lowered_869, afterOuter_868);
};
const lowerRecursiveFunction_870 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return lowerRecursiveFunction_870__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerFunctions_871__wm_d3 = (functions_872, context_873, state_874) => {
__wm_tail_39: while (true) {
{
const __wm_scalar_65_0 = functions_872;
const __wm_scalar_65_1 = context_873;
const __wm_scalar_65_2 = state_874;
if (__wm_scalar_65_0 === __wm_basis_Nil) {
const context_875 = __wm_scalar_65_1;
const state_876 = __wm_scalar_65_2;
return state_876;
} else if (__wm_scalar_65_0?.ctor === -6 && __wm_scalar_65_0.args.length === 1 && __wm_is_tuple(__wm_scalar_65_0.args[0]) && __wm_scalar_65_0.args[0].length === 2) {
const fn_877 = __wm_scalar_65_0.args[0][0];
const rest_878 = __wm_scalar_65_0.args[0][1];
const context_879 = __wm_scalar_65_1;
const state_880 = __wm_scalar_65_2;
if ((fn_877.recursionGroupId < 0)) {
{
const __wm_tail_arg_47_0 = rest_878;
const __wm_tail_arg_47_1 = context_879;
const __wm_tail_arg_47_2 = lowerNonrecursiveFunction_804__wm_d3(fn_877, context_879, state_880);
functions_872 = __wm_tail_arg_47_0;
context_873 = __wm_tail_arg_47_1;
state_874 = __wm_tail_arg_47_2;
continue __wm_tail_39;
}
} else {
{
const __wm_tail_arg_48_0 = rest_878;
const __wm_tail_arg_48_1 = context_879;
const __wm_tail_arg_48_2 = lowerRecursiveFunction_870__wm_d3(fn_877, context_879, state_880);
functions_872 = __wm_tail_arg_48_0;
context_873 = __wm_tail_arg_48_1;
state_874 = __wm_tail_arg_48_2;
continue __wm_tail_39;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const lowerFunctions_871 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return lowerFunctions_871__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerSliceProgram_891__wm_d8 = (functions_881, expressions_882, matchArms_883, params_884, patterns_885, constructors_886, layouts_887, fields_888) => {
const context_889 = { functions: Js.Array.toList(functions_881), expressions: Js.Array.toList(expressions_882), matchArms: Js.Array.toList(matchArms_883), params: Js.Array.toList(params_884), patterns: Js.Array.toList(patterns_885), constructors: Js.Array.toList(constructors_886), layouts: Js.Array.toList(layouts_887), fields: Js.Array.toList(fields_888) };
const state_890 = lowerFunctions_871__wm_d3(context_889.functions, context_889, initialLowerState_161(undefined));
return finishLoweredProgram_318(state_890);
};
const lowerSliceProgram_891 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 8) return lowerSliceProgram_891__wm_d8(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7]);
__wm_fail("Match", "pattern match failure in function");
};
return { "LowerScope": LowerScope_319, "LowerValueResult": LowerValueResult_320, "LowerTailResult": LowerTailResult_321, "LowerChildrenResult": LowerChildrenResult_322, "LowerBindResult": LowerBindResult_323, "LowerParamResult": LowerParamResult_324, "LowerCasesResult": LowerCasesResult_325, "emptyScope": emptyScope_327, "lowerLetValue": lowerLetValue_328, "lowerLetValue__wm_d5": lowerLetValue_328__wm_d5, "lowerSequenceValue": lowerSequenceValue_329, "lowerSequenceValue__wm_d5": lowerSequenceValue_329__wm_d5, "bindPattern": bindPattern_330, "bindPattern__wm_d6": bindPattern_330__wm_d6, "bindPatternValue": bindPatternValue_331, "bindPatternValue__wm_d7": bindPatternValue_331__wm_d7, "bindTupleChildren": bindTupleChildren_332, "bindTupleChildren__wm_d8": bindTupleChildren_332__wm_d8, "assignJoin": assignJoin_411, "assignJoin__wm_d4": assignJoin_411__wm_d4, "lowerIfValue": lowerIfValue_439, "lowerIfValue__wm_d5": lowerIfValue_439__wm_d5, "lowerMatchValue": lowerMatchValue_440, "lowerMatchValue__wm_d5": lowerMatchValue_440__wm_d5, "lowerMatchValueCases": lowerMatchValueCases_441, "lowerMatchValueCases__wm_d9": lowerMatchValueCases_441__wm_d9, "bindMatchPayload": bindMatchPayload_442, "bindMatchPayload__wm_d6": bindMatchPayload_442__wm_d6, "bindMatchPayloadLanes": bindMatchPayloadLanes_443, "bindMatchPayloadLanes__wm_d9": bindMatchPayloadLanes_443__wm_d9, "operationKind": operationKind_565, "bindOperation": bindOperation_584, "bindOperation__wm_d7": bindOperation_584__wm_d7, "bindSourceOperation": bindSourceOperation_590, "bindSourceOperation__wm_d4": bindSourceOperation_590__wm_d4, "lowerValue": lowerValue_591, "lowerValue__wm_d4": lowerValue_591__wm_d4, "lowerChildren": lowerChildren_592, "lowerChildren__wm_d6": lowerChildren_592__wm_d6, "returnStatement": returnStatement_632, "returnStatement__wm_d3": returnStatement_632__wm_d3, "lowerTail": lowerTail_633, "lowerTail__wm_d4": lowerTail_633__wm_d4, "lowerTailIf": lowerTailIf_634, "lowerTailIf__wm_d4": lowerTailIf_634__wm_d4, "lowerTailMatch": lowerTailMatch_635, "lowerTailMatch__wm_d4": lowerTailMatch_635__wm_d4, "lowerTailMatchCases": lowerTailMatchCases_636, "lowerTailMatchCases__wm_d7": lowerTailMatchCases_636__wm_d7, "lowerTailCall": lowerTailCall_637, "lowerTailCall__wm_d4": lowerTailCall_637__wm_d4, "materializeTailNext": materializeTailNext_638, "materializeTailNext__wm_d5": materializeTailNext_638__wm_d5, "setupParameters": setupParameters_759, "setupParameters__wm_d7": setupParameters_759__wm_d7, "lowerNonrecursiveFunction": lowerNonrecursiveFunction_804, "lowerNonrecursiveFunction__wm_d3": lowerNonrecursiveFunction_804__wm_d3, "setupRecursiveParameters": setupRecursiveParameters_805, "setupRecursiveParameters__wm_d9": setupRecursiveParameters_805__wm_d9, "lowerRecursiveFunction": lowerRecursiveFunction_870, "lowerRecursiveFunction__wm_d3": lowerRecursiveFunction_870__wm_d3, "lowerFunctions": lowerFunctions_871, "lowerFunctions__wm_d3": lowerFunctions_871__wm_d3, "lowerSliceProgram": lowerSliceProgram_891, "lowerSliceProgram__wm_d8": lowerSliceProgram_891__wm_d8 };
  },
  (value) => { __wm_module_3 = value; },
);
let __wm_module_4;
__wm_define_module(
  "__wm_module_4",
  ["__wm_module_0", "__wm_module_2"],
  async () => {
const GpuSliceAdtFieldDto_53 = __wm_module_0["GpuSliceAdtFieldDto"];
const GpuSliceAdtLayoutDto_52 = __wm_module_0["GpuSliceAdtLayoutDto"];
const GpuSliceConstructorDto_25 = __wm_module_0["GpuSliceConstructorDto"];
const GpuSliceElaborationInputDto_46 = __wm_module_0["GpuSliceElaborationInputDto"];
const GpuSliceEnvironmentFieldDto_42 = __wm_module_0["GpuSliceEnvironmentFieldDto"];
const GpuSliceLoweredAtomDto_56 = __wm_module_0["GpuSliceLoweredAtomDto"];
const GpuSliceLoweredBlockDto_59 = __wm_module_0["GpuSliceLoweredBlockDto"];
const GpuSliceLoweredCaseDto_60 = __wm_module_0["GpuSliceLoweredCaseDto"];
const GpuSliceLoweredFunctionDto_61 = __wm_module_0["GpuSliceLoweredFunctionDto"];
const GpuSliceLoweredLocalDto_55 = __wm_module_0["GpuSliceLoweredLocalDto"];
const GpuSliceLoweredOperationDto_57 = __wm_module_0["GpuSliceLoweredOperationDto"];
const GpuSliceLoweredStatementDto_58 = __wm_module_0["GpuSliceLoweredStatementDto"];
const GpuSliceRootDto_41 = __wm_module_0["GpuSliceRootDto"];
const GpuSliceTypeDto_21 = __wm_module_0["GpuSliceTypeDto"];
const numberEqual_145 = __wm_module_2["numberEqual"];
const numberEqual_145__wm_d2 = __wm_module_2["numberEqual__wm_d2"];
const SliceEmitContext_892 = (__record_args) => ({ input: __record_args[0], environmentFields: __record_args[1], types: __record_args[2], constructors: __record_args[3], layouts: __record_args[4], fields: __record_args[5], functions: __record_args[6], locals: __record_args[7], atoms: __record_args[8], operations: __record_args[9], statements: __record_args[10], blocks: __record_args[11], cases: __record_args[12], recursiveFunctionId: __record_args[13], portable: __record_args[14] });
const text_894 = (__arg) => {
if (true) {
const value_893 = __arg;
return Text.of(value_893);
}
__wm_fail("Match", "pattern match failure in function");
};
const localName_896 = (__arg) => {
if (true) {
const id_895 = __arg;
return ("wm_l_" + text_894(id_895));
}
__wm_fail("Match", "pattern match failure in function");
};
const functionName_898 = (__arg) => {
if (true) {
const id_897 = __arg;
return ("wm_f_" + text_894(id_897));
}
__wm_fail("Match", "pattern match failure in function");
};
const tupleName_900 = (__arg) => {
if (true) {
const id_899 = __arg;
return ("wm_tuple_" + text_894(id_899));
}
__wm_fail("Match", "pattern match failure in function");
};
const tupleFactoryName_902 = (__arg) => {
if (true) {
const id_901 = __arg;
return ("wm_make_tuple_" + text_894(id_901));
}
__wm_fail("Match", "pattern match failure in function");
};
const tupleFieldName_904 = (__arg) => {
if (true) {
const index_903 = __arg;
return ("wm_i_" + text_894(index_903));
}
__wm_fail("Match", "pattern match failure in function");
};
const layoutName_906 = (__arg) => {
if (true) {
const id_905 = __arg;
return ("wm_adt_" + text_894(id_905));
}
__wm_fail("Match", "pattern match failure in function");
};
const constructorName_908 = (__arg) => {
if (true) {
const id_907 = __arg;
return ("wm_make_ctor_" + text_894(id_907));
}
__wm_fail("Match", "pattern match failure in function");
};
const payloadFieldName_910 = (__arg) => {
if (true) {
const id_909 = __arg;
return ("wm_p_" + text_894(id_909));
}
__wm_fail("Match", "pattern match failure in function");
};
const uniformFieldName_912 = (__arg) => {
if (true) {
const index_911 = __arg;
return ("wm_u_" + text_894(index_911));
}
__wm_fail("Match", "pattern match failure in function");
};
const resourceFieldName_914 = (__arg) => {
if (true) {
const binding_913 = __arg;
return ("wm_r_" + text_894(binding_913));
}
__wm_fail("Match", "pattern match failure in function");
};
const recursiveResultName_916 = (__arg) => {
if (true) {
const id_915 = __arg;
return ("wm_result_" + text_894(id_915));
}
__wm_fail("Match", "pattern match failure in function");
};
const recursiveDoneName_918 = (__arg) => {
if (true) {
const id_917 = __arg;
return ("wm_done_" + text_894(id_917));
}
__wm_fail("Match", "pattern match failure in function");
};
const listLength_919__wm_d2 = (items_920, count_921) => {
__wm_tail_40: while (true) {
{
const __wm_scalar_66_0 = items_920;
const __wm_scalar_66_1 = count_921;
if (__wm_scalar_66_0 === __wm_basis_Nil) {
const count_922 = __wm_scalar_66_1;
return count_922;
} else if (__wm_scalar_66_0?.ctor === -6 && __wm_scalar_66_0.args.length === 1 && __wm_is_tuple(__wm_scalar_66_0.args[0]) && __wm_scalar_66_0.args[0].length === 2) {
const _item_923 = __wm_scalar_66_0.args[0][0];
const rest_924 = __wm_scalar_66_0.args[0][1];
const count_925 = __wm_scalar_66_1;
{
const __wm_tail_arg_49_0 = rest_924;
const __wm_tail_arg_49_1 = (count_925 + 1);
items_920 = __wm_tail_arg_49_0;
count_921 = __wm_tail_arg_49_1;
continue __wm_tail_40;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const listLength_919 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return listLength_919__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const vectorLaneName_927 = (__arg) => {
if (true) {
const index_926 = __arg;
if (numberEqual_145__wm_d2(index_926, 0)) {
return "x";
} else {
if (numberEqual_145__wm_d2(index_926, 1)) {
return "y";
} else {
if (numberEqual_145__wm_d2(index_926, 2)) {
return "z";
} else {
return "w";
}
}
}
}
__wm_fail("Match", "pattern match failure in function");
};
const findType_928__wm_d2 = (items_929, id_930) => {
__wm_tail_41: while (true) {
{
const __wm_scalar_67_0 = items_929;
const __wm_scalar_67_1 = id_930;
if (__wm_scalar_67_0 === __wm_basis_Nil) {
const id_931 = __wm_scalar_67_1;
return __wm_fail("Panic", "missing Slang-emission type");
} else if (__wm_scalar_67_0?.ctor === -6 && __wm_scalar_67_0.args.length === 1 && __wm_is_tuple(__wm_scalar_67_0.args[0]) && __wm_scalar_67_0.args[0].length === 2) {
const item_932 = __wm_scalar_67_0.args[0][0];
const rest_933 = __wm_scalar_67_0.args[0][1];
const id_934 = __wm_scalar_67_1;
if (numberEqual_145__wm_d2(item_932.id, id_934)) {
return item_932;
} else {
{
const __wm_tail_arg_50_0 = rest_933;
const __wm_tail_arg_50_1 = id_934;
items_929 = __wm_tail_arg_50_0;
id_930 = __wm_tail_arg_50_1;
continue __wm_tail_41;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findType_928 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findType_928__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const vectorName_940__wm_d2 = (gpuType_935, context_936) => {
const scalar_939 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2) {
const typeId_937 = __v.args[0][0];
const __938 = __v.args[0][1];
return findType_928__wm_d2(context_936.types, typeId_937);
} else if (__v === __wm_basis_Nil) {

return __wm_fail("Panic", "shader vector has no component type");
}
__wm_fail("Match", "non-exhaustive match");
})(Js.Array.toList(gpuType_935.items));
return ((__wm_eq(scalar_939.kind, "i32") ? "int" : "float") + text_894(listLength_919__wm_d2(Js.Array.toList(gpuType_935.items), 0)));
};
const vectorName_940 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return vectorName_940__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findEnvironmentField_941__wm_d3 = (items_942, environmentId_943, index_944) => {
__wm_tail_42: while (true) {
{
const __wm_scalar_68_0 = items_942;
const __wm_scalar_68_1 = environmentId_943;
const __wm_scalar_68_2 = index_944;
if (__wm_scalar_68_0 === __wm_basis_Nil) {
const _environmentId_945 = __wm_scalar_68_1;
const _index_946 = __wm_scalar_68_2;
return __wm_fail("Panic", "missing Slang-emission environment field");
} else if (__wm_scalar_68_0?.ctor === -6 && __wm_scalar_68_0.args.length === 1 && __wm_is_tuple(__wm_scalar_68_0.args[0]) && __wm_scalar_68_0.args[0].length === 2) {
const item_947 = __wm_scalar_68_0.args[0][0];
const rest_948 = __wm_scalar_68_0.args[0][1];
const environmentId_949 = __wm_scalar_68_1;
const index_950 = __wm_scalar_68_2;
if (__wm_op_and_d2(numberEqual_145__wm_d2(item_947.environmentId, environmentId_949), numberEqual_145__wm_d2(item_947.declaredIndex, index_950))) {
return item_947;
} else {
{
const __wm_tail_arg_51_0 = rest_948;
const __wm_tail_arg_51_1 = environmentId_949;
const __wm_tail_arg_51_2 = index_950;
items_942 = __wm_tail_arg_51_0;
environmentId_943 = __wm_tail_arg_51_1;
index_944 = __wm_tail_arg_51_2;
continue __wm_tail_42;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findEnvironmentField_941 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findEnvironmentField_941__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const findLayout_951__wm_d2 = (items_952, id_953) => {
__wm_tail_43: while (true) {
{
const __wm_scalar_69_0 = items_952;
const __wm_scalar_69_1 = id_953;
if (__wm_scalar_69_0 === __wm_basis_Nil) {
const id_954 = __wm_scalar_69_1;
return __wm_fail("Panic", "missing Slang-emission ADT layout");
} else if (__wm_scalar_69_0?.ctor === -6 && __wm_scalar_69_0.args.length === 1 && __wm_is_tuple(__wm_scalar_69_0.args[0]) && __wm_scalar_69_0.args[0].length === 2) {
const item_955 = __wm_scalar_69_0.args[0][0];
const rest_956 = __wm_scalar_69_0.args[0][1];
const id_957 = __wm_scalar_69_1;
if (numberEqual_145__wm_d2(item_955.id, id_957)) {
return item_955;
} else {
{
const __wm_tail_arg_52_0 = rest_956;
const __wm_tail_arg_52_1 = id_957;
items_952 = __wm_tail_arg_52_0;
id_953 = __wm_tail_arg_52_1;
continue __wm_tail_43;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLayout_951 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLayout_951__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLayoutByType_958__wm_d2 = (items_959, typeId_960) => {
__wm_tail_44: while (true) {
{
const __wm_scalar_70_0 = items_959;
const __wm_scalar_70_1 = typeId_960;
if (__wm_scalar_70_0 === __wm_basis_Nil) {
const typeId_961 = __wm_scalar_70_1;
return __wm_fail("Panic", "missing Slang-emission ADT type layout");
} else if (__wm_scalar_70_0?.ctor === -6 && __wm_scalar_70_0.args.length === 1 && __wm_is_tuple(__wm_scalar_70_0.args[0]) && __wm_scalar_70_0.args[0].length === 2) {
const item_962 = __wm_scalar_70_0.args[0][0];
const rest_963 = __wm_scalar_70_0.args[0][1];
const typeId_964 = __wm_scalar_70_1;
if (numberEqual_145__wm_d2(item_962.typeId, typeId_964)) {
return item_962;
} else {
{
const __wm_tail_arg_53_0 = rest_963;
const __wm_tail_arg_53_1 = typeId_964;
items_959 = __wm_tail_arg_53_0;
typeId_960 = __wm_tail_arg_53_1;
continue __wm_tail_44;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLayoutByType_958 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLayoutByType_958__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findField_965__wm_d2 = (items_966, id_967) => {
__wm_tail_45: while (true) {
{
const __wm_scalar_71_0 = items_966;
const __wm_scalar_71_1 = id_967;
if (__wm_scalar_71_0 === __wm_basis_Nil) {
const id_968 = __wm_scalar_71_1;
return __wm_fail("Panic", "missing Slang-emission ADT field");
} else if (__wm_scalar_71_0?.ctor === -6 && __wm_scalar_71_0.args.length === 1 && __wm_is_tuple(__wm_scalar_71_0.args[0]) && __wm_scalar_71_0.args[0].length === 2) {
const item_969 = __wm_scalar_71_0.args[0][0];
const rest_970 = __wm_scalar_71_0.args[0][1];
const id_971 = __wm_scalar_71_1;
if (numberEqual_145__wm_d2(item_969.id, id_971)) {
return item_969;
} else {
{
const __wm_tail_arg_54_0 = rest_970;
const __wm_tail_arg_54_1 = id_971;
items_966 = __wm_tail_arg_54_0;
id_967 = __wm_tail_arg_54_1;
continue __wm_tail_45;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findField_965 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findField_965__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findConstructor_972__wm_d2 = (items_973, id_974) => {
__wm_tail_46: while (true) {
{
const __wm_scalar_72_0 = items_973;
const __wm_scalar_72_1 = id_974;
if (__wm_scalar_72_0 === __wm_basis_Nil) {
const id_975 = __wm_scalar_72_1;
return __wm_fail("Panic", "missing Slang-emission constructor");
} else if (__wm_scalar_72_0?.ctor === -6 && __wm_scalar_72_0.args.length === 1 && __wm_is_tuple(__wm_scalar_72_0.args[0]) && __wm_scalar_72_0.args[0].length === 2) {
const item_976 = __wm_scalar_72_0.args[0][0];
const rest_977 = __wm_scalar_72_0.args[0][1];
const id_978 = __wm_scalar_72_1;
if (numberEqual_145__wm_d2(item_976.id, id_978)) {
return item_976;
} else {
{
const __wm_tail_arg_55_0 = rest_977;
const __wm_tail_arg_55_1 = id_978;
items_973 = __wm_tail_arg_55_0;
id_974 = __wm_tail_arg_55_1;
continue __wm_tail_46;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findConstructor_972 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findConstructor_972__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLocal_979__wm_d2 = (items_980, id_981) => {
__wm_tail_47: while (true) {
{
const __wm_scalar_73_0 = items_980;
const __wm_scalar_73_1 = id_981;
if (__wm_scalar_73_0 === __wm_basis_Nil) {
const id_982 = __wm_scalar_73_1;
return __wm_fail("Panic", "missing Slang-emission local");
} else if (__wm_scalar_73_0?.ctor === -6 && __wm_scalar_73_0.args.length === 1 && __wm_is_tuple(__wm_scalar_73_0.args[0]) && __wm_scalar_73_0.args[0].length === 2) {
const item_983 = __wm_scalar_73_0.args[0][0];
const rest_984 = __wm_scalar_73_0.args[0][1];
const id_985 = __wm_scalar_73_1;
if (numberEqual_145__wm_d2(item_983.id, id_985)) {
return item_983;
} else {
{
const __wm_tail_arg_56_0 = rest_984;
const __wm_tail_arg_56_1 = id_985;
items_980 = __wm_tail_arg_56_0;
id_981 = __wm_tail_arg_56_1;
continue __wm_tail_47;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLocal_979 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLocal_979__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findAtom_986__wm_d2 = (items_987, id_988) => {
__wm_tail_48: while (true) {
{
const __wm_scalar_74_0 = items_987;
const __wm_scalar_74_1 = id_988;
if (__wm_scalar_74_0 === __wm_basis_Nil) {
const id_989 = __wm_scalar_74_1;
return __wm_fail("Panic", "missing Slang-emission atom");
} else if (__wm_scalar_74_0?.ctor === -6 && __wm_scalar_74_0.args.length === 1 && __wm_is_tuple(__wm_scalar_74_0.args[0]) && __wm_scalar_74_0.args[0].length === 2) {
const item_990 = __wm_scalar_74_0.args[0][0];
const rest_991 = __wm_scalar_74_0.args[0][1];
const id_992 = __wm_scalar_74_1;
if (numberEqual_145__wm_d2(item_990.id, id_992)) {
return item_990;
} else {
{
const __wm_tail_arg_57_0 = rest_991;
const __wm_tail_arg_57_1 = id_992;
items_987 = __wm_tail_arg_57_0;
id_988 = __wm_tail_arg_57_1;
continue __wm_tail_48;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findAtom_986 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findAtom_986__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findOperation_993__wm_d2 = (items_994, id_995) => {
__wm_tail_49: while (true) {
{
const __wm_scalar_75_0 = items_994;
const __wm_scalar_75_1 = id_995;
if (__wm_scalar_75_0 === __wm_basis_Nil) {
const id_996 = __wm_scalar_75_1;
return __wm_fail("Panic", "missing Slang-emission operation");
} else if (__wm_scalar_75_0?.ctor === -6 && __wm_scalar_75_0.args.length === 1 && __wm_is_tuple(__wm_scalar_75_0.args[0]) && __wm_scalar_75_0.args[0].length === 2) {
const item_997 = __wm_scalar_75_0.args[0][0];
const rest_998 = __wm_scalar_75_0.args[0][1];
const id_999 = __wm_scalar_75_1;
if (numberEqual_145__wm_d2(item_997.id, id_999)) {
return item_997;
} else {
{
const __wm_tail_arg_58_0 = rest_998;
const __wm_tail_arg_58_1 = id_999;
items_994 = __wm_tail_arg_58_0;
id_995 = __wm_tail_arg_58_1;
continue __wm_tail_49;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findOperation_993 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findOperation_993__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findStatement_1000__wm_d2 = (items_1001, id_1002) => {
__wm_tail_50: while (true) {
{
const __wm_scalar_76_0 = items_1001;
const __wm_scalar_76_1 = id_1002;
if (__wm_scalar_76_0 === __wm_basis_Nil) {
const id_1003 = __wm_scalar_76_1;
return __wm_fail("Panic", "missing Slang-emission statement");
} else if (__wm_scalar_76_0?.ctor === -6 && __wm_scalar_76_0.args.length === 1 && __wm_is_tuple(__wm_scalar_76_0.args[0]) && __wm_scalar_76_0.args[0].length === 2) {
const item_1004 = __wm_scalar_76_0.args[0][0];
const rest_1005 = __wm_scalar_76_0.args[0][1];
const id_1006 = __wm_scalar_76_1;
if (numberEqual_145__wm_d2(item_1004.id, id_1006)) {
return item_1004;
} else {
{
const __wm_tail_arg_59_0 = rest_1005;
const __wm_tail_arg_59_1 = id_1006;
items_1001 = __wm_tail_arg_59_0;
id_1002 = __wm_tail_arg_59_1;
continue __wm_tail_50;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findStatement_1000 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findStatement_1000__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findBlock_1007__wm_d2 = (items_1008, id_1009) => {
__wm_tail_51: while (true) {
{
const __wm_scalar_77_0 = items_1008;
const __wm_scalar_77_1 = id_1009;
if (__wm_scalar_77_0 === __wm_basis_Nil) {
const id_1010 = __wm_scalar_77_1;
return __wm_fail("Panic", "missing Slang-emission block");
} else if (__wm_scalar_77_0?.ctor === -6 && __wm_scalar_77_0.args.length === 1 && __wm_is_tuple(__wm_scalar_77_0.args[0]) && __wm_scalar_77_0.args[0].length === 2) {
const item_1011 = __wm_scalar_77_0.args[0][0];
const rest_1012 = __wm_scalar_77_0.args[0][1];
const id_1013 = __wm_scalar_77_1;
if (numberEqual_145__wm_d2(item_1011.id, id_1013)) {
return item_1011;
} else {
{
const __wm_tail_arg_60_0 = rest_1012;
const __wm_tail_arg_60_1 = id_1013;
items_1008 = __wm_tail_arg_60_0;
id_1009 = __wm_tail_arg_60_1;
continue __wm_tail_51;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findBlock_1007 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findBlock_1007__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findCase_1014__wm_d2 = (items_1015, id_1016) => {
__wm_tail_52: while (true) {
{
const __wm_scalar_78_0 = items_1015;
const __wm_scalar_78_1 = id_1016;
if (__wm_scalar_78_0 === __wm_basis_Nil) {
const id_1017 = __wm_scalar_78_1;
return __wm_fail("Panic", "missing Slang-emission case");
} else if (__wm_scalar_78_0?.ctor === -6 && __wm_scalar_78_0.args.length === 1 && __wm_is_tuple(__wm_scalar_78_0.args[0]) && __wm_scalar_78_0.args[0].length === 2) {
const item_1018 = __wm_scalar_78_0.args[0][0];
const rest_1019 = __wm_scalar_78_0.args[0][1];
const id_1020 = __wm_scalar_78_1;
if (numberEqual_145__wm_d2(item_1018.id, id_1020)) {
return item_1018;
} else {
{
const __wm_tail_arg_61_0 = rest_1019;
const __wm_tail_arg_61_1 = id_1020;
items_1015 = __wm_tail_arg_61_0;
id_1016 = __wm_tail_arg_61_1;
continue __wm_tail_52;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findCase_1014 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findCase_1014__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findFunction_1021__wm_d2 = (items_1022, id_1023) => {
__wm_tail_53: while (true) {
{
const __wm_scalar_79_0 = items_1022;
const __wm_scalar_79_1 = id_1023;
if (__wm_scalar_79_0 === __wm_basis_Nil) {
const id_1024 = __wm_scalar_79_1;
return __wm_fail("Panic", "missing Slang-emission function");
} else if (__wm_scalar_79_0?.ctor === -6 && __wm_scalar_79_0.args.length === 1 && __wm_is_tuple(__wm_scalar_79_0.args[0]) && __wm_scalar_79_0.args[0].length === 2) {
const item_1025 = __wm_scalar_79_0.args[0][0];
const rest_1026 = __wm_scalar_79_0.args[0][1];
const id_1027 = __wm_scalar_79_1;
if (numberEqual_145__wm_d2(item_1025.functionId, id_1027)) {
return item_1025;
} else {
{
const __wm_tail_arg_62_0 = rest_1026;
const __wm_tail_arg_62_1 = id_1027;
items_1022 = __wm_tail_arg_62_0;
id_1023 = __wm_tail_arg_62_1;
continue __wm_tail_53;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findFunction_1021 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findFunction_1021__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findAdtForEmit_1028__wm_d2 = (items_1029, typeNameId_1030) => {
__wm_tail_54: while (true) {
{
const __wm_scalar_80_0 = items_1029;
const __wm_scalar_80_1 = typeNameId_1030;
if (__wm_scalar_80_0 === __wm_basis_Nil) {
const typeNameId_1031 = __wm_scalar_80_1;
return __wm_fail("Panic", "missing Slang-emission ADT");
} else if (__wm_scalar_80_0?.ctor === -6 && __wm_scalar_80_0.args.length === 1 && __wm_is_tuple(__wm_scalar_80_0.args[0]) && __wm_scalar_80_0.args[0].length === 2) {
const item_1032 = __wm_scalar_80_0.args[0][0];
const rest_1033 = __wm_scalar_80_0.args[0][1];
const typeNameId_1034 = __wm_scalar_80_1;
if (numberEqual_145__wm_d2(item_1032.typeNameId, typeNameId_1034)) {
return item_1032;
} else {
{
const __wm_tail_arg_63_0 = rest_1033;
const __wm_tail_arg_63_1 = typeNameId_1034;
items_1029 = __wm_tail_arg_63_0;
typeNameId_1030 = __wm_tail_arg_63_1;
continue __wm_tail_54;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findAdtForEmit_1028 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findAdtForEmit_1028__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findSourceFunction_1035__wm_d2 = (items_1036, functionId_1037) => {
__wm_tail_55: while (true) {
{
const __wm_scalar_81_0 = items_1036;
const __wm_scalar_81_1 = functionId_1037;
if (__wm_scalar_81_0 === __wm_basis_Nil) {
const functionId_1038 = __wm_scalar_81_1;
return __wm_fail("Panic", "missing Slang-emission source function");
} else if (__wm_scalar_81_0?.ctor === -6 && __wm_scalar_81_0.args.length === 1 && __wm_is_tuple(__wm_scalar_81_0.args[0]) && __wm_scalar_81_0.args[0].length === 2) {
const item_1039 = __wm_scalar_81_0.args[0][0];
const rest_1040 = __wm_scalar_81_0.args[0][1];
const functionId_1041 = __wm_scalar_81_1;
if (numberEqual_145__wm_d2(item_1039.id, functionId_1041)) {
return item_1039;
} else {
{
const __wm_tail_arg_64_0 = rest_1040;
const __wm_tail_arg_64_1 = functionId_1041;
items_1036 = __wm_tail_arg_64_0;
functionId_1037 = __wm_tail_arg_64_1;
continue __wm_tail_55;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findSourceFunction_1035 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findSourceFunction_1035__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const typeName_1046__wm_d2 = (typeId_1042, context_1043) => {
const gpuType_1044 = findType_928__wm_d2(context_1043.types, typeId_1042);
if (__wm_eq(gpuType_1044.kind, "f32")) {
return "float";
} else {
if (__wm_eq(gpuType_1044.kind, "i32")) {
return "int";
} else {
if (__wm_eq(gpuType_1044.kind, "bool")) {
return "bool";
} else {
if (__wm_eq(gpuType_1044.kind, "void")) {
return "void";
} else {
if (__wm_eq(gpuType_1044.kind, "vector")) {
return vectorName_940__wm_d2(gpuType_1044, context_1043);
} else {
if (__wm_eq(gpuType_1044.kind, "tuple")) {
return tupleName_900(typeId_1042);
} else {
if (__wm_eq(gpuType_1044.kind, "adt")) {
const layout_1045 = findLayoutByType_958__wm_d2(context_1043.layouts, typeId_1042);
return layoutName_906(layout_1045.id);
} else {
if (__wm_eq(gpuType_1044.kind, "sampled-texture-2d")) {
return "Texture2D<float4>";
} else {
if (__wm_eq(gpuType_1044.kind, "sampler")) {
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
const typeName_1046 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return typeName_1046__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitEnvironmentFields_1047__wm_d3 = (items_1048, context_1049, output_1050) => {
__wm_tail_56: while (true) {
{
const __wm_scalar_82_0 = items_1048;
const __wm_scalar_82_1 = context_1049;
const __wm_scalar_82_2 = output_1050;
if (__wm_scalar_82_0 === __wm_basis_Nil) {
const _context_1051 = __wm_scalar_82_1;
const output_1052 = __wm_scalar_82_2;
return output_1052;
} else if (__wm_scalar_82_0?.ctor === -6 && __wm_scalar_82_0.args.length === 1 && __wm_is_tuple(__wm_scalar_82_0.args[0]) && __wm_scalar_82_0.args[0].length === 2) {
const field_1053 = __wm_scalar_82_0.args[0][0];
const rest_1054 = __wm_scalar_82_0.args[0][1];
const context_1055 = __wm_scalar_82_1;
const output_1056 = __wm_scalar_82_2;
{
const __wm_tail_arg_65_0 = rest_1054;
const __wm_tail_arg_65_1 = context_1055;
const __wm_tail_arg_65_2 = (__wm_eq(field_1053.kind, "uniform") ? (() => {
const gpuType_1057 = findType_928__wm_d2(context_1055.types, field_1053.typeId);
const fieldType_1058 = (__wm_eq(gpuType_1057.kind, "bool") ? "int" : typeName_1046__wm_d2(field_1053.typeId, context_1055));
return (((((output_1056 + "  ") + fieldType_1058) + " ") + uniformFieldName_912(field_1053.declaredIndex)) + ";\n");
})() : output_1056);
items_1048 = __wm_tail_arg_65_0;
context_1049 = __wm_tail_arg_65_1;
output_1050 = __wm_tail_arg_65_2;
continue __wm_tail_56;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitEnvironmentFields_1047 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitEnvironmentFields_1047__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
let hasUniformField_1059 = (__arg) => {
__wm_tail_57: while (true) {
if (true) {
const items_1060 = __arg;
{
const __wm_tail_value_66 = items_1060;
if (__wm_tail_value_66 === __wm_basis_Nil) {

return false;
} else if (__wm_tail_value_66?.ctor === -6 && __wm_tail_value_66.args.length === 1 && __wm_is_tuple(__wm_tail_value_66.args[0]) && __wm_tail_value_66.args[0].length === 2) {
const field_1061 = __wm_tail_value_66.args[0][0];
const rest_1062 = __wm_tail_value_66.args[0][1];
if (__wm_eq(field_1061.kind, "uniform")) {
return true;
} else {
__arg = rest_1062;
continue __wm_tail_57;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "pattern match failure in function");
}
};
const emitResourceDeclarations_1063__wm_d3 = (items_1064, context_1065, output_1066) => {
__wm_tail_58: while (true) {
{
const __wm_scalar_83_0 = items_1064;
const __wm_scalar_83_1 = context_1065;
const __wm_scalar_83_2 = output_1066;
if (__wm_scalar_83_0 === __wm_basis_Nil) {
const _context_1067 = __wm_scalar_83_1;
const output_1068 = __wm_scalar_83_2;
return output_1068;
} else if (__wm_scalar_83_0?.ctor === -6 && __wm_scalar_83_0.args.length === 1 && __wm_is_tuple(__wm_scalar_83_0.args[0]) && __wm_scalar_83_0.args[0].length === 2) {
const field_1069 = __wm_scalar_83_0.args[0][0];
const rest_1070 = __wm_scalar_83_0.args[0][1];
const context_1071 = __wm_scalar_83_1;
const output_1072 = __wm_scalar_83_2;
{
const next_1073 = (__wm_eq(field_1069.kind, "uniform") ? output_1072 : (((((((output_1072 + "[[vk::binding(") + text_894(field_1069.binding)) + ", 0)]]\n") + typeName_1046__wm_d2(field_1069.typeId, context_1071)) + " ") + resourceFieldName_914(field_1069.binding)) + ";\n\n"));
{
const __wm_tail_arg_67_0 = rest_1070;
const __wm_tail_arg_67_1 = context_1071;
const __wm_tail_arg_67_2 = next_1073;
items_1064 = __wm_tail_arg_67_0;
context_1065 = __wm_tail_arg_67_1;
output_1066 = __wm_tail_arg_67_2;
continue __wm_tail_58;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitResourceDeclarations_1063 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitResourceDeclarations_1063__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitEnvironmentDeclaration_1077 = (__arg) => {
if (true) {
const context_1074 = __arg;
if (__wm_op_or_d2(context_1074.portable, numberEqual_145__wm_d2(context_1074.input.root.environmentId, __wm_op_sub(1)))) {
return "";
} else {
const fields_1075 = context_1074.environmentFields;
const uniformDeclaration_1076 = (hasUniformField_1059(fields_1075) ? (((("struct wm_environment {\n" + emitEnvironmentFields_1047__wm_d3(fields_1075, context_1074, "")) + "};\n") + "[[vk::binding(0, 0)]]\n") + "ConstantBuffer<wm_environment> wm_uniforms;\n\n") : "");
return (uniformDeclaration_1076 + emitResourceDeclarations_1063__wm_d3(fields_1075, context_1074, ""));
}
}
__wm_fail("Match", "pattern match failure in function");
};
const emitPortableEnvironmentAccessors_1078__wm_d3 = (items_1079, context_1080, output_1081) => {
__wm_tail_59: while (true) {
{
const __wm_scalar_84_0 = items_1079;
const __wm_scalar_84_1 = context_1080;
const __wm_scalar_84_2 = output_1081;
if (__wm_scalar_84_0 === __wm_basis_Nil) {
const _context_1082 = __wm_scalar_84_1;
const output_1083 = __wm_scalar_84_2;
return output_1083;
} else if (__wm_scalar_84_0?.ctor === -6 && __wm_scalar_84_0.args.length === 1 && __wm_is_tuple(__wm_scalar_84_0.args[0]) && __wm_scalar_84_0.args[0].length === 2) {
const field_1084 = __wm_scalar_84_0.args[0][0];
const rest_1085 = __wm_scalar_84_0.args[0][1];
const context_1086 = __wm_scalar_84_1;
const output_1087 = __wm_scalar_84_2;
{
const belongsToRoot_1088 = numberEqual_145__wm_d2(field_1084.environmentId, context_1086.input.root.environmentId);
const next_1090 = (__wm_op_not(belongsToRoot_1088) ? output_1087 : (() => {
const name_1089 = (__wm_eq(field_1084.kind, "uniform") ? ("WM_UNIFORM_" + text_894(field_1084.declaredIndex)) : ("WM_RESOURCE_" + text_894(field_1084.binding)));
return (((((((((output_1087 + "#ifndef ") + name_1089) + "\n") + "__extern_cpp ") + typeName_1046__wm_d2(field_1084.typeId, context_1086)) + " ") + name_1089) + "();\n") + "#endif\n");
})());
{
const __wm_tail_arg_68_0 = rest_1085;
const __wm_tail_arg_68_1 = context_1086;
const __wm_tail_arg_68_2 = next_1090;
items_1079 = __wm_tail_arg_68_0;
context_1080 = __wm_tail_arg_68_1;
output_1081 = __wm_tail_arg_68_2;
continue __wm_tail_59;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitPortableEnvironmentAccessors_1078 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitPortableEnvironmentAccessors_1078__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const joinText_1091__wm_d3 = (items_1092, separator_1093, output_1094) => {
__wm_tail_60: while (true) {
{
const __wm_scalar_85_0 = items_1092;
const __wm_scalar_85_1 = separator_1093;
const __wm_scalar_85_2 = output_1094;
if (__wm_scalar_85_0 === __wm_basis_Nil) {
const separator_1095 = __wm_scalar_85_1;
const output_1096 = __wm_scalar_85_2;
return output_1096;
} else if (__wm_scalar_85_0?.ctor === -6 && __wm_scalar_85_0.args.length === 1 && __wm_is_tuple(__wm_scalar_85_0.args[0]) && __wm_scalar_85_0.args[0].length === 2) {
const item_1097 = __wm_scalar_85_0.args[0][0];
const rest_1098 = __wm_scalar_85_0.args[0][1];
const separator_1099 = __wm_scalar_85_1;
const output_1100 = __wm_scalar_85_2;
{
const next_1101 = (__wm_eq(output_1100, "") ? item_1097 : ((output_1100 + separator_1099) + item_1097));
{
const __wm_tail_arg_69_0 = rest_1098;
const __wm_tail_arg_69_1 = separator_1099;
const __wm_tail_arg_69_2 = next_1101;
items_1092 = __wm_tail_arg_69_0;
separator_1093 = __wm_tail_arg_69_1;
output_1094 = __wm_tail_arg_69_2;
continue __wm_tail_60;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const joinText_1091 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return joinText_1091__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleFields_1102__wm_d4 = (typeIds_1103, index_1104, context_1105, output_1106) => {
__wm_tail_61: while (true) {
{
const __wm_scalar_86_0 = typeIds_1103;
const __wm_scalar_86_1 = index_1104;
const __wm_scalar_86_2 = context_1105;
const __wm_scalar_86_3 = output_1106;
if (__wm_scalar_86_0 === __wm_basis_Nil) {
const index_1107 = __wm_scalar_86_1;
const context_1108 = __wm_scalar_86_2;
const output_1109 = __wm_scalar_86_3;
return output_1109;
} else if (__wm_scalar_86_0?.ctor === -6 && __wm_scalar_86_0.args.length === 1 && __wm_is_tuple(__wm_scalar_86_0.args[0]) && __wm_scalar_86_0.args[0].length === 2) {
const typeId_1110 = __wm_scalar_86_0.args[0][0];
const rest_1111 = __wm_scalar_86_0.args[0][1];
const index_1112 = __wm_scalar_86_1;
const context_1113 = __wm_scalar_86_2;
const output_1114 = __wm_scalar_86_3;
{
const __wm_tail_arg_70_0 = rest_1111;
const __wm_tail_arg_70_1 = (index_1112 + 1);
const __wm_tail_arg_70_2 = context_1113;
const __wm_tail_arg_70_3 = (((((output_1114 + "  ") + typeName_1046__wm_d2(typeId_1110, context_1113)) + " ") + tupleFieldName_904(index_1112)) + ";\n");
typeIds_1103 = __wm_tail_arg_70_0;
index_1104 = __wm_tail_arg_70_1;
context_1105 = __wm_tail_arg_70_2;
output_1106 = __wm_tail_arg_70_3;
continue __wm_tail_61;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitTupleFields_1102 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitTupleFields_1102__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleParams_1115__wm_d4 = (typeIds_1116, index_1117, context_1118, output_1119) => {
__wm_tail_62: while (true) {
{
const __wm_scalar_87_0 = typeIds_1116;
const __wm_scalar_87_1 = index_1117;
const __wm_scalar_87_2 = context_1118;
const __wm_scalar_87_3 = output_1119;
if (__wm_scalar_87_0 === __wm_basis_Nil) {
const index_1120 = __wm_scalar_87_1;
const context_1121 = __wm_scalar_87_2;
const output_1122 = __wm_scalar_87_3;
return output_1122;
} else if (__wm_scalar_87_0?.ctor === -6 && __wm_scalar_87_0.args.length === 1 && __wm_is_tuple(__wm_scalar_87_0.args[0]) && __wm_scalar_87_0.args[0].length === 2) {
const typeId_1123 = __wm_scalar_87_0.args[0][0];
const rest_1124 = __wm_scalar_87_0.args[0][1];
const index_1125 = __wm_scalar_87_1;
const context_1126 = __wm_scalar_87_2;
const output_1127 = __wm_scalar_87_3;
{
const parameter_1128 = ((typeName_1046__wm_d2(typeId_1123, context_1126) + " ") + tupleFieldName_904(index_1125));
const next_1129 = (__wm_eq(output_1127, "") ? parameter_1128 : ((output_1127 + ", ") + parameter_1128));
{
const __wm_tail_arg_71_0 = rest_1124;
const __wm_tail_arg_71_1 = (index_1125 + 1);
const __wm_tail_arg_71_2 = context_1126;
const __wm_tail_arg_71_3 = next_1129;
typeIds_1116 = __wm_tail_arg_71_0;
index_1117 = __wm_tail_arg_71_1;
context_1118 = __wm_tail_arg_71_2;
output_1119 = __wm_tail_arg_71_3;
continue __wm_tail_62;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitTupleParams_1115 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitTupleParams_1115__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleAssignments_1130__wm_d3 = (typeIds_1131, index_1132, output_1133) => {
__wm_tail_63: while (true) {
{
const __wm_scalar_88_0 = typeIds_1131;
const __wm_scalar_88_1 = index_1132;
const __wm_scalar_88_2 = output_1133;
if (__wm_scalar_88_0 === __wm_basis_Nil) {
const index_1134 = __wm_scalar_88_1;
const output_1135 = __wm_scalar_88_2;
return output_1135;
} else if (__wm_scalar_88_0?.ctor === -6 && __wm_scalar_88_0.args.length === 1 && __wm_is_tuple(__wm_scalar_88_0.args[0]) && __wm_scalar_88_0.args[0].length === 2) {
const _typeId_1136 = __wm_scalar_88_0.args[0][0];
const rest_1137 = __wm_scalar_88_0.args[0][1];
const index_1138 = __wm_scalar_88_1;
const output_1139 = __wm_scalar_88_2;
{
const field_1140 = tupleFieldName_904(index_1138);
{
const __wm_tail_arg_72_0 = rest_1137;
const __wm_tail_arg_72_1 = (index_1138 + 1);
const __wm_tail_arg_72_2 = (((((output_1139 + "  value.") + field_1140) + " = ") + field_1140) + ";\n");
typeIds_1131 = __wm_tail_arg_72_0;
index_1132 = __wm_tail_arg_72_1;
output_1133 = __wm_tail_arg_72_2;
continue __wm_tail_63;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitTupleAssignments_1130 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitTupleAssignments_1130__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleDeclaration_1144__wm_d2 = (gpuType_1141, context_1142) => {
const items_1143 = Js.Array.toList(gpuType_1141.items);
return ((((((((((((((("struct " + tupleName_900(gpuType_1141.id)) + " {\n") + emitTupleFields_1102__wm_d4(items_1143, 0, context_1142, "")) + "};\n\n") + tupleName_900(gpuType_1141.id)) + " ") + tupleFactoryName_902(gpuType_1141.id)) + "(") + emitTupleParams_1115__wm_d4(items_1143, 0, context_1142, "")) + ") {\n") + "  ") + tupleName_900(gpuType_1141.id)) + " value;\n") + emitTupleAssignments_1130__wm_d3(items_1143, 0, "")) + "  return value;\n}\n\n");
};
const emitTupleDeclaration_1144 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitTupleDeclaration_1144__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleDeclarations_1145__wm_d3 = (types_1146, context_1147, output_1148) => {
__wm_tail_64: while (true) {
{
const __wm_scalar_89_0 = types_1146;
const __wm_scalar_89_1 = context_1147;
const __wm_scalar_89_2 = output_1148;
if (__wm_scalar_89_0 === __wm_basis_Nil) {
const context_1149 = __wm_scalar_89_1;
const output_1150 = __wm_scalar_89_2;
return output_1150;
} else if (__wm_scalar_89_0?.ctor === -6 && __wm_scalar_89_0.args.length === 1 && __wm_is_tuple(__wm_scalar_89_0.args[0]) && __wm_scalar_89_0.args[0].length === 2) {
const gpuType_1151 = __wm_scalar_89_0.args[0][0];
const rest_1152 = __wm_scalar_89_0.args[0][1];
const context_1153 = __wm_scalar_89_1;
const output_1154 = __wm_scalar_89_2;
{
const next_1155 = (__wm_eq(gpuType_1151.kind, "tuple") ? (output_1154 + emitTupleDeclaration_1144__wm_d2(gpuType_1151, context_1153)) : output_1154);
{
const __wm_tail_arg_73_0 = rest_1152;
const __wm_tail_arg_73_1 = context_1153;
const __wm_tail_arg_73_2 = next_1155;
types_1146 = __wm_tail_arg_73_0;
context_1147 = __wm_tail_arg_73_1;
output_1148 = __wm_tail_arg_73_2;
continue __wm_tail_64;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitTupleDeclarations_1145 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitTupleDeclarations_1145__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const zeroArgs_1156__wm_d4 = (items_1158, context_1159, index_1160, output_1161) => {
__wm_tail_65: while (true) {
{
const __wm_scalar_90_0 = items_1158;
const __wm_scalar_90_1 = context_1159;
const __wm_scalar_90_2 = index_1160;
const __wm_scalar_90_3 = output_1161;
if (__wm_scalar_90_0 === __wm_basis_Nil) {
const _context_1162 = __wm_scalar_90_1;
const _index_1163 = __wm_scalar_90_2;
const output_1164 = __wm_scalar_90_3;
return output_1164;
} else if (__wm_scalar_90_0?.ctor === -6 && __wm_scalar_90_0.args.length === 1 && __wm_is_tuple(__wm_scalar_90_0.args[0]) && __wm_scalar_90_0.args[0].length === 2) {
const typeId_1165 = __wm_scalar_90_0.args[0][0];
const rest_1166 = __wm_scalar_90_0.args[0][1];
const context_1167 = __wm_scalar_90_1;
const index_1168 = __wm_scalar_90_2;
const output_1169 = __wm_scalar_90_3;
{
const next_1170 = (numberEqual_145__wm_d2(index_1168, 0) ? zeroValue_1157__wm_d2(typeId_1165, context_1167) : ((output_1169 + ", ") + zeroValue_1157__wm_d2(typeId_1165, context_1167)));
{
const __wm_tail_arg_74_0 = rest_1166;
const __wm_tail_arg_74_1 = context_1167;
const __wm_tail_arg_74_2 = (index_1168 + 1);
const __wm_tail_arg_74_3 = next_1170;
items_1158 = __wm_tail_arg_74_0;
context_1159 = __wm_tail_arg_74_1;
index_1160 = __wm_tail_arg_74_2;
output_1161 = __wm_tail_arg_74_3;
continue __wm_tail_65;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const zeroArgs_1156 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return zeroArgs_1156__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const zeroValue_1157__wm_d2 = (typeId_1171, context_1172) => {
const gpuType_1173 = findType_928__wm_d2(context_1172.types, typeId_1171);
if (__wm_eq(gpuType_1173.kind, "f32")) {
return "float(0)";
} else {
if (__wm_eq(gpuType_1173.kind, "i32")) {
return "int(0)";
} else {
if (__wm_eq(gpuType_1173.kind, "bool")) {
return "false";
} else {
if (__wm_eq(gpuType_1173.kind, "vector")) {
return (vectorName_940__wm_d2(gpuType_1173, context_1172) + "(0)");
} else {
if (__wm_eq(gpuType_1173.kind, "tuple")) {
return (((tupleFactoryName_902(typeId_1171) + "(") + zeroArgs_1156__wm_d4(Js.Array.toList(gpuType_1173.items), context_1172, 0, "")) + ")");
} else {
return __wm_fail("Panic", "nested ADT payloads are outside the wmslang slice");
}
}
}
}
}
};
const zeroValue_1157 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return zeroValue_1157__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitLayoutFields_1174__wm_d3 = (fieldIds_1175, context_1176, output_1177) => {
__wm_tail_66: while (true) {
{
const __wm_scalar_91_0 = fieldIds_1175;
const __wm_scalar_91_1 = context_1176;
const __wm_scalar_91_2 = output_1177;
if (__wm_scalar_91_0 === __wm_basis_Nil) {
const context_1178 = __wm_scalar_91_1;
const output_1179 = __wm_scalar_91_2;
return output_1179;
} else if (__wm_scalar_91_0?.ctor === -6 && __wm_scalar_91_0.args.length === 1 && __wm_is_tuple(__wm_scalar_91_0.args[0]) && __wm_scalar_91_0.args[0].length === 2) {
const fieldId_1180 = __wm_scalar_91_0.args[0][0];
const rest_1181 = __wm_scalar_91_0.args[0][1];
const context_1182 = __wm_scalar_91_1;
const output_1183 = __wm_scalar_91_2;
{
const field_1184 = findField_965__wm_d2(context_1182.fields, fieldId_1180);
{
const __wm_tail_arg_75_0 = rest_1181;
const __wm_tail_arg_75_1 = context_1182;
const __wm_tail_arg_75_2 = (((((output_1183 + "  ") + typeName_1046__wm_d2(field_1184.typeId, context_1182)) + " ") + payloadFieldName_910(field_1184.id)) + ";\n");
fieldIds_1175 = __wm_tail_arg_75_0;
context_1176 = __wm_tail_arg_75_1;
output_1177 = __wm_tail_arg_75_2;
continue __wm_tail_66;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitLayoutFields_1174 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitLayoutFields_1174__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const fieldsForEmit_1185__wm_d2 = (fieldIds_1186, context_1187) => {
const __wm_scalar_92_0 = fieldIds_1186;
const __wm_scalar_92_1 = context_1187;
if (__wm_scalar_92_0 === __wm_basis_Nil) {
const _context_1188 = __wm_scalar_92_1;
return __wm_basis_Nil;
} else if (__wm_scalar_92_0?.ctor === -6 && __wm_scalar_92_0.args.length === 1 && __wm_is_tuple(__wm_scalar_92_0.args[0]) && __wm_scalar_92_0.args[0].length === 2) {
const fieldId_1189 = __wm_scalar_92_0.args[0][0];
const rest_1190 = __wm_scalar_92_0.args[0][1];
const context_1191 = __wm_scalar_92_1;
return __wm_basis_Cons([findField_965__wm_d2(context_1191.fields, fieldId_1189), fieldsForEmit_1185__wm_d2(rest_1190, context_1191)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const fieldsForEmit_1185 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return fieldsForEmit_1185__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitConstructorFieldAssignments_1192__wm_d5 = (fields_1193, constructorId_1194, payloadName_1195, context_1196, output_1197) => {
__wm_tail_67: while (true) {
{
const __wm_scalar_93_0 = fields_1193;
const __wm_scalar_93_1 = constructorId_1194;
const __wm_scalar_93_2 = payloadName_1195;
const __wm_scalar_93_3 = context_1196;
const __wm_scalar_93_4 = output_1197;
if (__wm_scalar_93_0 === __wm_basis_Nil) {
const _constructorId_1198 = __wm_scalar_93_1;
const _payloadName_1199 = __wm_scalar_93_2;
const _context_1200 = __wm_scalar_93_3;
const output_1201 = __wm_scalar_93_4;
return output_1201;
} else if (__wm_scalar_93_0?.ctor === -6 && __wm_scalar_93_0.args.length === 1 && __wm_is_tuple(__wm_scalar_93_0.args[0]) && __wm_scalar_93_0.args[0].length === 2) {
const field_1202 = __wm_scalar_93_0.args[0][0];
const rest_1203 = __wm_scalar_93_0.args[0][1];
const constructorId_1204 = __wm_scalar_93_1;
const payloadName_1205 = __wm_scalar_93_2;
const context_1206 = __wm_scalar_93_3;
const output_1207 = __wm_scalar_93_4;
{
const value_1208 = (numberEqual_145__wm_d2(field_1202.constructorId, constructorId_1204) ? payloadName_1205 : zeroValue_1157__wm_d2(field_1202.typeId, context_1206));
{
const __wm_tail_arg_76_0 = rest_1203;
const __wm_tail_arg_76_1 = constructorId_1204;
const __wm_tail_arg_76_2 = payloadName_1205;
const __wm_tail_arg_76_3 = context_1206;
const __wm_tail_arg_76_4 = (((((output_1207 + "  value.") + payloadFieldName_910(field_1202.id)) + " = ") + value_1208) + ";\n");
fields_1193 = __wm_tail_arg_76_0;
constructorId_1194 = __wm_tail_arg_76_1;
payloadName_1195 = __wm_tail_arg_76_2;
context_1196 = __wm_tail_arg_76_3;
output_1197 = __wm_tail_arg_76_4;
continue __wm_tail_67;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitConstructorFieldAssignments_1192 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return emitConstructorFieldAssignments_1192__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const emitConstructorDeclaration_1214__wm_d3 = (constructor_1209, layout_1210, context_1211) => {
const parameter_1212 = (numberEqual_145__wm_d2(constructor_1209.payloadTypeId, __wm_op_sub(1)) ? "" : (typeName_1046__wm_d2(constructor_1209.payloadTypeId, context_1211) + " payload"));
const payloadName_1213 = (numberEqual_145__wm_d2(constructor_1209.payloadTypeId, __wm_op_sub(1)) ? "float(0)" : "payload");
return (((((((((((((layoutName_906(layout_1210.id) + " ") + constructorName_908(constructor_1209.id)) + "(") + parameter_1212) + ") {\n") + "  ") + layoutName_906(layout_1210.id)) + " value;\n") + "  value.tag = ") + text_894(constructor_1209.tag)) + ";\n") + emitConstructorFieldAssignments_1192__wm_d5(fieldsForEmit_1185__wm_d2(Js.Array.toList(layout_1210.fieldIds), context_1211), constructor_1209.id, payloadName_1213, context_1211, "")) + "  return value;\n}\n\n");
};
const emitConstructorDeclaration_1214 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitConstructorDeclaration_1214__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitLayoutConstructors_1215__wm_d4 = (constructorIds_1216, layout_1217, context_1218, output_1219) => {
__wm_tail_68: while (true) {
{
const __wm_scalar_94_0 = constructorIds_1216;
const __wm_scalar_94_1 = layout_1217;
const __wm_scalar_94_2 = context_1218;
const __wm_scalar_94_3 = output_1219;
if (__wm_scalar_94_0 === __wm_basis_Nil) {
const layout_1220 = __wm_scalar_94_1;
const context_1221 = __wm_scalar_94_2;
const output_1222 = __wm_scalar_94_3;
return output_1222;
} else if (__wm_scalar_94_0?.ctor === -6 && __wm_scalar_94_0.args.length === 1 && __wm_is_tuple(__wm_scalar_94_0.args[0]) && __wm_scalar_94_0.args[0].length === 2) {
const constructorId_1223 = __wm_scalar_94_0.args[0][0];
const rest_1224 = __wm_scalar_94_0.args[0][1];
const layout_1225 = __wm_scalar_94_1;
const context_1226 = __wm_scalar_94_2;
const output_1227 = __wm_scalar_94_3;
{
const constructor_1228 = findConstructor_972__wm_d2(context_1226.constructors, constructorId_1223);
{
const __wm_tail_arg_77_0 = rest_1224;
const __wm_tail_arg_77_1 = layout_1225;
const __wm_tail_arg_77_2 = context_1226;
const __wm_tail_arg_77_3 = (output_1227 + emitConstructorDeclaration_1214__wm_d3(constructor_1228, layout_1225, context_1226));
constructorIds_1216 = __wm_tail_arg_77_0;
layout_1217 = __wm_tail_arg_77_1;
context_1218 = __wm_tail_arg_77_2;
output_1219 = __wm_tail_arg_77_3;
continue __wm_tail_68;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitLayoutConstructors_1215 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitLayoutConstructors_1215__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitLayoutDeclaration_1232__wm_d2 = (layout_1229, context_1230) => {
const adt_1231 = findAdtForEmit_1028__wm_d2(Js.Array.toList(context_1230.input.adts), layout_1229.typeNameId);
return ((((("struct " + layoutName_906(layout_1229.id)) + " {\n  int tag;\n") + emitLayoutFields_1174__wm_d3(Js.Array.toList(layout_1229.fieldIds), context_1230, "")) + "};\n\n") + emitLayoutConstructors_1215__wm_d4(Js.Array.toList(adt_1231.constructorIds), layout_1229, context_1230, ""));
};
const emitLayoutDeclaration_1232 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitLayoutDeclaration_1232__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitLayoutDeclarations_1233__wm_d3 = (layouts_1234, context_1235, output_1236) => {
__wm_tail_69: while (true) {
{
const __wm_scalar_95_0 = layouts_1234;
const __wm_scalar_95_1 = context_1235;
const __wm_scalar_95_2 = output_1236;
if (__wm_scalar_95_0 === __wm_basis_Nil) {
const context_1237 = __wm_scalar_95_1;
const output_1238 = __wm_scalar_95_2;
return output_1238;
} else if (__wm_scalar_95_0?.ctor === -6 && __wm_scalar_95_0.args.length === 1 && __wm_is_tuple(__wm_scalar_95_0.args[0]) && __wm_scalar_95_0.args[0].length === 2) {
const layout_1239 = __wm_scalar_95_0.args[0][0];
const rest_1240 = __wm_scalar_95_0.args[0][1];
const context_1241 = __wm_scalar_95_1;
const output_1242 = __wm_scalar_95_2;
{
const __wm_tail_arg_78_0 = rest_1240;
const __wm_tail_arg_78_1 = context_1241;
const __wm_tail_arg_78_2 = (output_1242 + emitLayoutDeclaration_1232__wm_d2(layout_1239, context_1241));
layouts_1234 = __wm_tail_arg_78_0;
context_1235 = __wm_tail_arg_78_1;
output_1236 = __wm_tail_arg_78_2;
continue __wm_tail_69;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitLayoutDeclarations_1233 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitLayoutDeclarations_1233__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitAtom_1247__wm_d2 = (atomId_1243, context_1244) => {
const atom_1245 = findAtom_986__wm_d2(context_1244.atoms, atomId_1243);
const __wm_return_value_29 = atom_1245.kind;
if (__wm_return_value_29 === "local") {

return localName_896(atom_1245.localId);
} else if (__wm_return_value_29 === "number") {

const gpuType_1246 = findType_928__wm_d2(context_1244.types, atom_1245.typeId);
return (((__wm_eq(gpuType_1246.kind, "i32") ? "int(" : "float(") + text_894(atom_1245.numberValue)) + ")");
} else if (__wm_return_value_29 === "bool") {

if (atom_1245.boolValue) {
return "true";
} else {
return "false";
}
} else if (true) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const emitAtom_1247 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitAtom_1247__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitArgs_1248__wm_d3 = (atomIds_1249, context_1250, output_1251) => {
__wm_tail_70: while (true) {
{
const __wm_scalar_96_0 = atomIds_1249;
const __wm_scalar_96_1 = context_1250;
const __wm_scalar_96_2 = output_1251;
if (__wm_scalar_96_0 === __wm_basis_Nil) {
const context_1252 = __wm_scalar_96_1;
const output_1253 = __wm_scalar_96_2;
return output_1253;
} else if (__wm_scalar_96_0?.ctor === -6 && __wm_scalar_96_0.args.length === 1 && __wm_is_tuple(__wm_scalar_96_0.args[0]) && __wm_scalar_96_0.args[0].length === 2) {
const atomId_1254 = __wm_scalar_96_0.args[0][0];
const rest_1255 = __wm_scalar_96_0.args[0][1];
const context_1256 = __wm_scalar_96_1;
const output_1257 = __wm_scalar_96_2;
{
const argument_1258 = emitAtom_1247__wm_d2(atomId_1254, context_1256);
const next_1259 = (__wm_eq(output_1257, "") ? argument_1258 : ((output_1257 + ", ") + argument_1258));
{
const __wm_tail_arg_79_0 = rest_1255;
const __wm_tail_arg_79_1 = context_1256;
const __wm_tail_arg_79_2 = next_1259;
atomIds_1249 = __wm_tail_arg_79_0;
context_1250 = __wm_tail_arg_79_1;
output_1251 = __wm_tail_arg_79_2;
continue __wm_tail_70;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitArgs_1248 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitArgs_1248__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const operatorText_1261 = (__arg) => {
if (true) {
const operatorId_1260 = __arg;
const __wm_return_value_30 = operatorId_1260;
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
const emitResourceCall_1270__wm_d3 = (operation_1262, args_1263, context_1264) => {
const __wm_return_value_31 = operation_1262.resourceOperation;
if (__wm_return_value_31 === "sample") {

const __wm_return_value_32 = args_1263;
if (__wm_return_value_32?.ctor === -6 && __wm_return_value_32.args.length === 1 && __wm_is_tuple(__wm_return_value_32.args[0]) && __wm_return_value_32.args[0].length === 2 && __wm_return_value_32.args[0][1]?.ctor === -6 && __wm_return_value_32.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_32.args[0][1].args[0]) && __wm_return_value_32.args[0][1].args[0].length === 2 && __wm_return_value_32.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_32.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_32.args[0][1].args[0][1].args[0]) && __wm_return_value_32.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_32.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const texture_1265 = __wm_return_value_32.args[0][0];
const sampler_1266 = __wm_return_value_32.args[0][1].args[0][0];
const coordinate_1267 = __wm_return_value_32.args[0][1].args[0][1].args[0][0];
return (((((emitAtom_1247__wm_d2(texture_1265, context_1264) + ".Sample(") + emitAtom_1247__wm_d2(sampler_1266, context_1264)) + ", ") + emitAtom_1247__wm_d2(coordinate_1267, context_1264)) + ")");
} else if (true) {

return __wm_fail("Panic", "texture Sample reached Slang emission with invalid arity");
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_31 === "load") {

const __wm_return_value_33 = args_1263;
if (__wm_return_value_33?.ctor === -6 && __wm_return_value_33.args.length === 1 && __wm_is_tuple(__wm_return_value_33.args[0]) && __wm_return_value_33.args[0].length === 2 && __wm_return_value_33.args[0][1]?.ctor === -6 && __wm_return_value_33.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_33.args[0][1].args[0]) && __wm_return_value_33.args[0][1].args[0].length === 2 && __wm_return_value_33.args[0][1].args[0][1] === __wm_basis_Nil) {
const texture_1268 = __wm_return_value_33.args[0][0];
const coordinate_1269 = __wm_return_value_33.args[0][1].args[0][0];
return (((emitAtom_1247__wm_d2(texture_1268, context_1264) + ".Load(") + emitAtom_1247__wm_d2(coordinate_1269, context_1264)) + ")");
} else if (true) {

return __wm_fail("Panic", "texture Load reached Slang emission with invalid arity");
}
__wm_fail("Match", "non-exhaustive match");
} else if (true) {

return __wm_fail("Panic", "resource call reached Slang emission without an operation");
}
__wm_fail("Match", "non-exhaustive match");
};
const emitResourceCall_1270 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitResourceCall_1270__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitPayload_1277__wm_d3 = (operation_1271, args_1272, context_1273) => {
const base_1274 = ((emitArgs_1248__wm_d3(args_1272, context_1273, "") + ".") + payloadFieldName_910(operation_1271.fieldId));
if ((operation_1271.index < 0)) {
return base_1274;
} else {
const field_1275 = findField_965__wm_d2(context_1273.fields, operation_1271.fieldId);
const fieldType_1276 = findType_928__wm_d2(context_1273.types, field_1275.typeId);
return (base_1274 + (__wm_eq(fieldType_1276.kind, "vector") ? ("." + vectorLaneName_927(operation_1271.index)) : ("." + tupleFieldName_904(operation_1271.index))));
}
};
const emitPayload_1277 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitPayload_1277__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitProjection_1284__wm_d3 = (operation_1278, args_1279, context_1280) => {
const __wm_return_value_34 = args_1279;
if (__wm_return_value_34?.ctor === -6 && __wm_return_value_34.args.length === 1 && __wm_is_tuple(__wm_return_value_34.args[0]) && __wm_return_value_34.args[0].length === 2 && __wm_return_value_34.args[0][1] === __wm_basis_Nil) {
const atomId_1281 = __wm_return_value_34.args[0][0];
const atom_1282 = findAtom_986__wm_d2(context_1280.atoms, atomId_1281);
const sourceType_1283 = findType_928__wm_d2(context_1280.types, atom_1282.typeId);
if (__wm_eq(sourceType_1283.kind, "vector")) {
return ((emitAtom_1247__wm_d2(atomId_1281, context_1280) + ".") + vectorLaneName_927(operation_1278.index));
} else {
return ((emitAtom_1247__wm_d2(atomId_1281, context_1280) + ".") + tupleFieldName_904(operation_1278.index));
}
} else if (true) {

return __wm_fail("Panic", "projection reached Slang emission with invalid arity");
}
__wm_fail("Match", "non-exhaustive match");
};
const emitProjection_1284 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitProjection_1284__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitOperatorOperation_1294__wm_d3 = (operation_1285, args_1286, context_1287) => {
const signedMinimum_1290 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2 && __v.args[0][1] === __wm_basis_Nil) {
const atomId_1288 = __v.args[0][0];
const atom_1289 = findAtom_986__wm_d2(context_1287.atoms, atomId_1288);
return __wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(__wm_eq(operation_1285.operatorId, "gpu.operator.negate"), __wm_eq(atom_1289.kind, "number")), __wm_eq(atom_1289.numberKind, "i32")), numberEqual_145__wm_d2(atom_1289.numberValue, 2147483648));
} else if (true) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
})(args_1286);
if (signedMinimum_1290) {
return "int(-2147483648)";
} else {
const __wm_return_value_35 = args_1286;
if (__wm_return_value_35?.ctor === -6 && __wm_return_value_35.args.length === 1 && __wm_is_tuple(__wm_return_value_35.args[0]) && __wm_return_value_35.args[0].length === 2 && __wm_return_value_35.args[0][1] === __wm_basis_Nil) {
const left_1291 = __wm_return_value_35.args[0][0];
return ((("(" + operatorText_1261(operation_1285.operatorId)) + emitAtom_1247__wm_d2(left_1291, context_1287)) + ")");
} else if (__wm_return_value_35?.ctor === -6 && __wm_return_value_35.args.length === 1 && __wm_is_tuple(__wm_return_value_35.args[0]) && __wm_return_value_35.args[0].length === 2 && __wm_return_value_35.args[0][1]?.ctor === -6 && __wm_return_value_35.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_35.args[0][1].args[0]) && __wm_return_value_35.args[0][1].args[0].length === 2 && __wm_return_value_35.args[0][1].args[0][1] === __wm_basis_Nil) {
const left_1292 = __wm_return_value_35.args[0][0];
const right_1293 = __wm_return_value_35.args[0][1].args[0][0];
return (((((("(" + emitAtom_1247__wm_d2(left_1292, context_1287)) + " ") + operatorText_1261(operation_1285.operatorId)) + " ") + emitAtom_1247__wm_d2(right_1293, context_1287)) + ")");
} else if (true) {

return __wm_fail("Panic", "operator reached Slang emission with invalid arity");
}
__wm_fail("Match", "non-exhaustive match");
}
};
const emitOperatorOperation_1294 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitOperatorOperation_1294__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitOperation_1304__wm_d2 = (operation_1295, context_1296) => {
const args_1297 = Js.Array.toList(operation_1295.args);
const __wm_return_value_36 = operation_1295.kind;
if (__wm_return_value_36 === "uniform") {

const field_1298 = findEnvironmentField_941__wm_d3(context_1296.environmentFields, context_1296.input.root.environmentId, operation_1295.index);
const access_1299 = (context_1296.portable ? (("WM_UNIFORM_" + text_894(field_1298.declaredIndex)) + "()") : ("wm_uniforms." + uniformFieldName_912(field_1298.declaredIndex)));
const gpuType_1300 = findType_928__wm_d2(context_1296.types, field_1298.typeId);
if (__wm_op_and_d2(__wm_eq(gpuType_1300.kind, "bool"), __wm_op_not(context_1296.portable))) {
return (("(" + access_1299) + " != 0)");
} else {
return access_1299;
}
} else if (__wm_return_value_36 === "resource") {

const field_1301 = findEnvironmentField_941__wm_d3(context_1296.environmentFields, context_1296.input.root.environmentId, operation_1295.index);
if (context_1296.portable) {
return (("WM_RESOURCE_" + text_894(field_1301.binding)) + "()");
} else {
return resourceFieldName_914(field_1301.binding);
}
} else if (__wm_return_value_36 === "resource-call") {

return emitResourceCall_1270__wm_d3(operation_1295, args_1297, context_1296);
} else if (__wm_return_value_36 === "copy") {

return emitArgs_1248__wm_d3(args_1297, context_1296, "");
} else if (__wm_return_value_36 === "tuple") {

const resultType_1302 = findType_928__wm_d2(context_1296.types, operation_1295.typeId);
const constructor_1303 = (__wm_eq(resultType_1302.kind, "vector") ? vectorName_940__wm_d2(resultType_1302, context_1296) : tupleFactoryName_902(operation_1295.typeId));
return (((constructor_1303 + "(") + emitArgs_1248__wm_d3(args_1297, context_1296, "")) + ")");
} else if (__wm_return_value_36 === "project") {

return emitProjection_1284__wm_d3(operation_1295, args_1297, context_1296);
} else if (__wm_return_value_36 === "call") {

return (((functionName_898(operation_1295.targetFunctionId) + "(") + emitArgs_1248__wm_d3(args_1297, context_1296, "")) + ")");
} else if (__wm_return_value_36 === "convert") {

return (((typeName_1046__wm_d2(operation_1295.typeId, context_1296) + "(") + emitArgs_1248__wm_d3(args_1297, context_1296, "")) + ")");
} else if (__wm_return_value_36 === "builtin") {

return (((operation_1295.builtinName + "(") + emitArgs_1248__wm_d3(args_1297, context_1296, "")) + ")");
} else if (__wm_return_value_36 === "construct") {

return (((constructorName_908(operation_1295.constructorId) + "(") + emitArgs_1248__wm_d3(args_1297, context_1296, "")) + ")");
} else if (__wm_return_value_36 === "payload") {

return emitPayload_1277__wm_d3(operation_1295, args_1297, context_1296);
} else if (__wm_return_value_36 === "binary") {

return emitOperatorOperation_1294__wm_d3(operation_1295, args_1297, context_1296);
} else if (__wm_return_value_36 === "unary") {

return emitOperatorOperation_1294__wm_d3(operation_1295, args_1297, context_1296);
} else if (true) {

return __wm_fail("Panic", "unsupported Slang-emission operation");
}
__wm_fail("Match", "non-exhaustive match");
};
const emitOperation_1304 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitOperation_1304__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitBlockStatements_1305__wm_d4 = (statementIds_1310, indent_1311, context_1312, output_1313) => {
__wm_tail_71: while (true) {
{
const __wm_scalar_97_0 = statementIds_1310;
const __wm_scalar_97_1 = indent_1311;
const __wm_scalar_97_2 = context_1312;
const __wm_scalar_97_3 = output_1313;
if (__wm_scalar_97_0 === __wm_basis_Nil) {
const indent_1314 = __wm_scalar_97_1;
const context_1315 = __wm_scalar_97_2;
const output_1316 = __wm_scalar_97_3;
return output_1316;
} else if (__wm_scalar_97_0?.ctor === -6 && __wm_scalar_97_0.args.length === 1 && __wm_is_tuple(__wm_scalar_97_0.args[0]) && __wm_scalar_97_0.args[0].length === 2) {
const statementId_1317 = __wm_scalar_97_0.args[0][0];
const rest_1318 = __wm_scalar_97_0.args[0][1];
const indent_1319 = __wm_scalar_97_1;
const context_1320 = __wm_scalar_97_2;
const output_1321 = __wm_scalar_97_3;
{
const statement_1322 = findStatement_1000__wm_d2(context_1320.statements, statementId_1317);
{
const __wm_tail_arg_80_0 = rest_1318;
const __wm_tail_arg_80_1 = indent_1319;
const __wm_tail_arg_80_2 = context_1320;
const __wm_tail_arg_80_3 = (output_1321 + emitStatement_1309__wm_d3(statement_1322, indent_1319, context_1320));
statementIds_1310 = __wm_tail_arg_80_0;
indent_1311 = __wm_tail_arg_80_1;
context_1312 = __wm_tail_arg_80_2;
output_1313 = __wm_tail_arg_80_3;
continue __wm_tail_71;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitBlockStatements_1305 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitBlockStatements_1305__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitBlock_1306__wm_d3 = (blockId_1323, indent_1324, context_1325) => {
const block_1326 = findBlock_1007__wm_d2(context_1325.blocks, blockId_1323);
return emitBlockStatements_1305__wm_d4(Js.Array.toList(block_1326.statementIds), indent_1324, context_1325, "");
};
const emitBlock_1306 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitBlock_1306__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitCases_1307__wm_d4 = (caseIds_1327, indent_1328, context_1329, output_1330) => {
__wm_tail_72: while (true) {
{
const __wm_scalar_98_0 = caseIds_1327;
const __wm_scalar_98_1 = indent_1328;
const __wm_scalar_98_2 = context_1329;
const __wm_scalar_98_3 = output_1330;
if (__wm_scalar_98_0 === __wm_basis_Nil) {
const indent_1331 = __wm_scalar_98_1;
const context_1332 = __wm_scalar_98_2;
const output_1333 = __wm_scalar_98_3;
return output_1333;
} else if (__wm_scalar_98_0?.ctor === -6 && __wm_scalar_98_0.args.length === 1 && __wm_is_tuple(__wm_scalar_98_0.args[0]) && __wm_scalar_98_0.args[0].length === 2) {
const caseId_1334 = __wm_scalar_98_0.args[0][0];
const rest_1335 = __wm_scalar_98_0.args[0][1];
const indent_1336 = __wm_scalar_98_1;
const context_1337 = __wm_scalar_98_2;
const output_1338 = __wm_scalar_98_3;
{
const gpuCase_1339 = findCase_1014__wm_d2(context_1337.cases, caseId_1334);
const item_1340 = ((((((((indent_1336 + "case ") + text_894(gpuCase_1339.tag)) + ": {\n") + emitBlock_1306__wm_d3(gpuCase_1339.blockId, (indent_1336 + "  "), context_1337)) + indent_1336) + "  break;\n") + indent_1336) + "}\n");
{
const __wm_tail_arg_81_0 = rest_1335;
const __wm_tail_arg_81_1 = indent_1336;
const __wm_tail_arg_81_2 = context_1337;
const __wm_tail_arg_81_3 = (output_1338 + item_1340);
caseIds_1327 = __wm_tail_arg_81_0;
indent_1328 = __wm_tail_arg_81_1;
context_1329 = __wm_tail_arg_81_2;
output_1330 = __wm_tail_arg_81_3;
continue __wm_tail_72;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitCases_1307 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitCases_1307__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitParallelAssignments_1308__wm_d5 = (targetIds_1341, valueIds_1342, indent_1343, context_1344, output_1345) => {
__wm_tail_73: while (true) {
{
const __wm_tail_value_82 = [targetIds_1341, valueIds_1342, indent_1343, context_1344, output_1345];
if (__wm_tail_value_82[0] === __wm_basis_Nil && __wm_tail_value_82[1] === __wm_basis_Nil) {
const indent_1346 = __wm_tail_value_82[2];
const context_1347 = __wm_tail_value_82[3];
const output_1348 = __wm_tail_value_82[4];
return output_1348;
} else if (__wm_tail_value_82[0]?.ctor === -6 && __wm_tail_value_82[0].args.length === 1 && __wm_is_tuple(__wm_tail_value_82[0].args[0]) && __wm_tail_value_82[0].args[0].length === 2 && __wm_tail_value_82[1]?.ctor === -6 && __wm_tail_value_82[1].args.length === 1 && __wm_is_tuple(__wm_tail_value_82[1].args[0]) && __wm_tail_value_82[1].args[0].length === 2) {
const targetId_1349 = __wm_tail_value_82[0].args[0][0];
const targetRest_1350 = __wm_tail_value_82[0].args[0][1];
const valueId_1351 = __wm_tail_value_82[1].args[0][0];
const valueRest_1352 = __wm_tail_value_82[1].args[0][1];
const indent_1353 = __wm_tail_value_82[2];
const context_1354 = __wm_tail_value_82[3];
const output_1355 = __wm_tail_value_82[4];
{
const __wm_tail_arg_83_0 = targetRest_1350;
const __wm_tail_arg_83_1 = valueRest_1352;
const __wm_tail_arg_83_2 = indent_1353;
const __wm_tail_arg_83_3 = context_1354;
const __wm_tail_arg_83_4 = (((((output_1355 + indent_1353) + localName_896(targetId_1349)) + " = ") + emitAtom_1247__wm_d2(valueId_1351, context_1354)) + ";\n");
targetIds_1341 = __wm_tail_arg_83_0;
valueIds_1342 = __wm_tail_arg_83_1;
indent_1343 = __wm_tail_arg_83_2;
context_1344 = __wm_tail_arg_83_3;
output_1345 = __wm_tail_arg_83_4;
continue __wm_tail_73;
}
} else if (true) {

return __wm_fail("Panic", "parallel tail update arity changed after validation");
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitParallelAssignments_1308 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return emitParallelAssignments_1308__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const emitStatement_1309__wm_d3 = (statement_1356, indent_1357, context_1358) => {
if (__wm_eq(statement_1356.kind, "let")) {
const local_1359 = findLocal_979__wm_d2(context_1358.locals, statement_1356.localId);
const operation_1360 = findOperation_993__wm_d2(context_1358.operations, statement_1356.operationId);
return ((((((indent_1357 + typeName_1046__wm_d2(local_1359.typeId, context_1358)) + " ") + localName_896(local_1359.id)) + " = ") + emitOperation_1304__wm_d2(operation_1360, context_1358)) + ";\n");
} else {
if (__wm_eq(statement_1356.kind, "assign")) {
return ((((indent_1357 + localName_896(statement_1356.localId)) + " = ") + emitAtom_1247__wm_d2(statement_1356.atomId, context_1358)) + ";\n");
} else {
if (__wm_eq(statement_1356.kind, "if")) {
const join_1362 = (numberEqual_145__wm_d2(statement_1356.localId, __wm_op_sub(1)) ? "" : (() => {
const local_1361 = findLocal_979__wm_d2(context_1358.locals, statement_1356.localId);
return ((((indent_1357 + typeName_1046__wm_d2(local_1361.typeId, context_1358)) + " ") + localName_896(local_1361.id)) + ";\n");
})());
return ((((((((((join_1362 + indent_1357) + "if (") + emitAtom_1247__wm_d2(statement_1356.conditionAtomId, context_1358)) + ") {\n") + emitBlock_1306__wm_d3(statement_1356.thenBlockId, (indent_1357 + "  "), context_1358)) + indent_1357) + "} else {\n") + emitBlock_1306__wm_d3(statement_1356.elseBlockId, (indent_1357 + "  "), context_1358)) + indent_1357) + "}\n");
} else {
if (__wm_eq(statement_1356.kind, "switch")) {
const join_1364 = (numberEqual_145__wm_d2(statement_1356.localId, __wm_op_sub(1)) ? "" : (() => {
const local_1363 = findLocal_979__wm_d2(context_1358.locals, statement_1356.localId);
return ((((indent_1357 + typeName_1046__wm_d2(local_1363.typeId, context_1358)) + " ") + localName_896(local_1363.id)) + ";\n");
})());
return (((((((join_1364 + indent_1357) + "switch (") + emitAtom_1247__wm_d2(statement_1356.scrutineeAtomId, context_1358)) + ".tag) {\n") + emitCases_1307__wm_d4(Js.Array.toList(statement_1356.caseIds), (indent_1357 + "  "), context_1358, "")) + indent_1357) + "}\n");
} else {
if (__wm_eq(statement_1356.kind, "loop")) {
return ((((((indent_1357 + "while (!") + recursiveDoneName_918(statement_1356.functionId)) + ") {\n") + emitBlock_1306__wm_d3(statement_1356.bodyBlockId, (indent_1357 + "  "), context_1358)) + indent_1357) + "}\n");
} else {
if (__wm_eq(statement_1356.kind, "continue")) {
return ((emitParallelAssignments_1308__wm_d5(Js.Array.toList(statement_1356.targetLocalIds), Js.Array.toList(statement_1356.valueAtomIds), indent_1357, context_1358, "") + indent_1357) + "continue;\n");
} else {
const atom_1365 = findAtom_986__wm_d2(context_1358.atoms, statement_1356.atomId);
if (__wm_eq(atom_1365.kind, "void")) {
if (numberEqual_145__wm_d2(context_1358.recursiveFunctionId, statement_1356.functionId)) {
return ((indent_1357 + recursiveDoneName_918(statement_1356.functionId)) + " = true;\n");
} else {
return (indent_1357 + "return;\n");
}
} else {
if (numberEqual_145__wm_d2(context_1358.recursiveFunctionId, statement_1356.functionId)) {
return (((((((indent_1357 + recursiveResultName_916(statement_1356.functionId)) + " = ") + emitAtom_1247__wm_d2(statement_1356.atomId, context_1358)) + ";\n") + indent_1357) + recursiveDoneName_918(statement_1356.functionId)) + " = true;\n");
} else {
return (((indent_1357 + "return ") + emitAtom_1247__wm_d2(statement_1356.atomId, context_1358)) + ";\n");
}
}
}
}
}
}
}
}
};
const emitStatement_1309 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitStatement_1309__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitFunctionParams_1366__wm_d3 = (localIds_1367, context_1368, output_1369) => {
__wm_tail_74: while (true) {
{
const __wm_scalar_99_0 = localIds_1367;
const __wm_scalar_99_1 = context_1368;
const __wm_scalar_99_2 = output_1369;
if (__wm_scalar_99_0 === __wm_basis_Nil) {
const context_1370 = __wm_scalar_99_1;
const output_1371 = __wm_scalar_99_2;
return output_1371;
} else if (__wm_scalar_99_0?.ctor === -6 && __wm_scalar_99_0.args.length === 1 && __wm_is_tuple(__wm_scalar_99_0.args[0]) && __wm_scalar_99_0.args[0].length === 2) {
const localId_1372 = __wm_scalar_99_0.args[0][0];
const rest_1373 = __wm_scalar_99_0.args[0][1];
const context_1374 = __wm_scalar_99_1;
const output_1375 = __wm_scalar_99_2;
{
const local_1376 = findLocal_979__wm_d2(context_1374.locals, localId_1372);
const parameter_1377 = ((typeName_1046__wm_d2(local_1376.typeId, context_1374) + " ") + localName_896(local_1376.id));
const next_1378 = (__wm_eq(output_1375, "") ? parameter_1377 : ((output_1375 + ", ") + parameter_1377));
{
const __wm_tail_arg_84_0 = rest_1373;
const __wm_tail_arg_84_1 = context_1374;
const __wm_tail_arg_84_2 = next_1378;
localIds_1367 = __wm_tail_arg_84_0;
context_1368 = __wm_tail_arg_84_1;
output_1369 = __wm_tail_arg_84_2;
continue __wm_tail_74;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitFunctionParams_1366 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitFunctionParams_1366__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitFunction_1388__wm_d2 = (fn_1379, context_1380) => {
const source_1381 = findSourceFunction_1035__wm_d2(Js.Array.toList(context_1380.input.functions), fn_1379.functionId);
const functionContext_1382 = { ...context_1380, recursiveFunctionId: (fn_1379.recursive ? fn_1379.functionId : __wm_op_sub(1)), portable: context_1380.portable };
const resultType_1383 = findType_928__wm_d2(context_1380.types, source_1381.resultTypeId);
const recursivePrefix_1385 = (fn_1379.recursive ? (() => {
const result_1384 = (__wm_eq(resultType_1383.kind, "void") ? "" : (((("  " + typeName_1046__wm_d2(source_1381.resultTypeId, context_1380)) + " ") + recursiveResultName_916(fn_1379.functionId)) + ";\n"));
return (((result_1384 + "  bool ") + recursiveDoneName_918(fn_1379.functionId)) + " = false;\n");
})() : "");
const recursiveSuffix_1386 = (fn_1379.recursive ? (__wm_eq(resultType_1383.kind, "void") ? "  return;\n" : (("  return " + recursiveResultName_916(fn_1379.functionId)) + ";\n")) : "");
const linkage_1387 = (__wm_op_and_d2(context_1380.portable, numberEqual_145__wm_d2(fn_1379.functionId, context_1380.input.root.functionId)) ? "export __extern_cpp " : "");
return ((((((((((linkage_1387 + typeName_1046__wm_d2(source_1381.resultTypeId, context_1380)) + " ") + functionName_898(fn_1379.functionId)) + "(") + emitFunctionParams_1366__wm_d3(Js.Array.toList(fn_1379.physicalParamLocalIds), context_1380, "")) + ") {\n") + recursivePrefix_1385) + emitBlock_1306__wm_d3(fn_1379.bodyBlockId, "  ", functionContext_1382)) + recursiveSuffix_1386) + "}\n\n");
};
const emitFunction_1388 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitFunction_1388__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitFunctions_1389__wm_d3 = (functions_1390, context_1391, output_1392) => {
__wm_tail_75: while (true) {
{
const __wm_scalar_100_0 = functions_1390;
const __wm_scalar_100_1 = context_1391;
const __wm_scalar_100_2 = output_1392;
if (__wm_scalar_100_0 === __wm_basis_Nil) {
const context_1393 = __wm_scalar_100_1;
const output_1394 = __wm_scalar_100_2;
return output_1394;
} else if (__wm_scalar_100_0?.ctor === -6 && __wm_scalar_100_0.args.length === 1 && __wm_is_tuple(__wm_scalar_100_0.args[0]) && __wm_scalar_100_0.args[0].length === 2) {
const fn_1395 = __wm_scalar_100_0.args[0][0];
const rest_1396 = __wm_scalar_100_0.args[0][1];
const context_1397 = __wm_scalar_100_1;
const output_1398 = __wm_scalar_100_2;
{
const __wm_tail_arg_85_0 = rest_1396;
const __wm_tail_arg_85_1 = context_1397;
const __wm_tail_arg_85_2 = (output_1398 + emitFunction_1388__wm_d2(fn_1395, context_1397));
functions_1390 = __wm_tail_arg_85_0;
context_1391 = __wm_tail_arg_85_1;
output_1392 = __wm_tail_arg_85_2;
continue __wm_tail_75;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitFunctions_1389 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitFunctions_1389__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitWrappers_1405 = (__arg) => {
if (true) {
const context_1399 = __arg;
const input_1400 = context_1399.input;
const rootRow_1401 = input_1400.root;
const root_1402 = findFunction_1021__wm_d2(context_1399.functions, rootRow_1401.functionId);
const __wm_return_value_37 = Js.Array.toList(root_1402.physicalParamLocalIds);
if (__wm_return_value_37?.ctor === -6 && __wm_return_value_37.args.length === 1 && __wm_is_tuple(__wm_return_value_37.args[0]) && __wm_return_value_37.args[0].length === 2 && __wm_return_value_37.args[0][1] === __wm_basis_Nil) {
const coordLocalId_1403 = __wm_return_value_37.args[0][0];
const coordLocal_1404 = findLocal_979__wm_d2(context_1399.locals, coordLocalId_1403);
return (((((((((((("[shader(\"vertex\")]\n" + "float4 wm_vertex(uint vertexID : SV_VertexID) : SV_Position {\n") + "  float2 uv = float2((vertexID << 1) & 2, vertexID & 2);\n") + "  return float4(uv * 2.0 - 1.0, 0.0, 1.0);\n") + "}\n\n") + "[shader(\"fragment\")]\n") + "float4 wm_fragment(float4 position : SV_Position) : SV_Target {\n") + "  return ") + functionName_898(root_1402.functionId)) + "(") + typeName_1046__wm_d2(coordLocal_1404.typeId, context_1399)) + "(position.x, position.y));\n") + "}\n");
} else if (true) {

return __wm_fail("Panic", "v1 fragment root does not have one physical coordinate parameter");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const emitSliceSlangModule_1417__wm_d10 = (input_1406, layouts_1407, fields_1408, functions_1409, locals_1410, atoms_1411, operations_1412, statements_1413, blocks_1414, cases_1415) => {
const context_1416 = { input: input_1406, environmentFields: Js.Array.toList(input_1406.environmentFields), types: Js.Array.toList(input_1406.types), constructors: Js.Array.toList(input_1406.constructors), layouts: Js.Array.toList(layouts_1407), fields: Js.Array.toList(fields_1408), functions: Js.Array.toList(functions_1409), locals: Js.Array.toList(locals_1410), atoms: Js.Array.toList(atoms_1411), operations: Js.Array.toList(operations_1412), statements: Js.Array.toList(statements_1413), blocks: Js.Array.toList(blocks_1414), cases: Js.Array.toList(cases_1415), recursiveFunctionId: __wm_op_sub(1), portable: true };
return ((((("// Generated by wmslang visual v2.\n\n" + emitPortableEnvironmentAccessors_1078__wm_d3(context_1416.environmentFields, context_1416, "")) + emitTupleDeclarations_1145__wm_d3(context_1416.types, context_1416, "")) + emitLayoutDeclarations_1233__wm_d3(context_1416.layouts, context_1416, "")) + emitEnvironmentDeclaration_1077(context_1416)) + emitFunctions_1389__wm_d3(context_1416.functions, context_1416, ""));
};
const emitSliceSlangModule_1417 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return emitSliceSlangModule_1417__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
const emitSliceCallableName_1419 = (__arg) => {
if (true) {
const input_1418 = __arg;
return functionName_898(input_1418.root.functionId);
}
__wm_fail("Match", "pattern match failure in function");
};
const emitSliceSlang_1431__wm_d10 = (input_1420, layouts_1421, fields_1422, functions_1423, locals_1424, atoms_1425, operations_1426, statements_1427, blocks_1428, cases_1429) => {
const context_1430 = { input: input_1420, environmentFields: Js.Array.toList(input_1420.environmentFields), types: Js.Array.toList(input_1420.types), constructors: Js.Array.toList(input_1420.constructors), layouts: Js.Array.toList(layouts_1421), fields: Js.Array.toList(fields_1422), functions: Js.Array.toList(functions_1423), locals: Js.Array.toList(locals_1424), atoms: Js.Array.toList(atoms_1425), operations: Js.Array.toList(operations_1426), statements: Js.Array.toList(statements_1427), blocks: Js.Array.toList(blocks_1428), cases: Js.Array.toList(cases_1429), recursiveFunctionId: __wm_op_sub(1), portable: false };
return ((((("// Generated by wmslang visual v2.\n\n" + emitTupleDeclarations_1145__wm_d3(context_1430.types, context_1430, "")) + emitLayoutDeclarations_1233__wm_d3(context_1430.layouts, context_1430, "")) + emitEnvironmentDeclaration_1077(context_1430)) + emitFunctions_1389__wm_d3(context_1430.functions, context_1430, "")) + emitWrappers_1405(context_1430));
};
const emitSliceSlang_1431 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return emitSliceSlang_1431__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
return { "SliceEmitContext": SliceEmitContext_892, "text": text_894, "localName": localName_896, "functionName": functionName_898, "tupleName": tupleName_900, "tupleFactoryName": tupleFactoryName_902, "tupleFieldName": tupleFieldName_904, "layoutName": layoutName_906, "constructorName": constructorName_908, "payloadFieldName": payloadFieldName_910, "uniformFieldName": uniformFieldName_912, "resourceFieldName": resourceFieldName_914, "recursiveResultName": recursiveResultName_916, "recursiveDoneName": recursiveDoneName_918, "listLength": listLength_919, "listLength__wm_d2": listLength_919__wm_d2, "vectorLaneName": vectorLaneName_927, "findType": findType_928, "findType__wm_d2": findType_928__wm_d2, "vectorName": vectorName_940, "vectorName__wm_d2": vectorName_940__wm_d2, "findEnvironmentField": findEnvironmentField_941, "findEnvironmentField__wm_d3": findEnvironmentField_941__wm_d3, "findLayout": findLayout_951, "findLayout__wm_d2": findLayout_951__wm_d2, "findLayoutByType": findLayoutByType_958, "findLayoutByType__wm_d2": findLayoutByType_958__wm_d2, "findField": findField_965, "findField__wm_d2": findField_965__wm_d2, "findConstructor": findConstructor_972, "findConstructor__wm_d2": findConstructor_972__wm_d2, "findLocal": findLocal_979, "findLocal__wm_d2": findLocal_979__wm_d2, "findAtom": findAtom_986, "findAtom__wm_d2": findAtom_986__wm_d2, "findOperation": findOperation_993, "findOperation__wm_d2": findOperation_993__wm_d2, "findStatement": findStatement_1000, "findStatement__wm_d2": findStatement_1000__wm_d2, "findBlock": findBlock_1007, "findBlock__wm_d2": findBlock_1007__wm_d2, "findCase": findCase_1014, "findCase__wm_d2": findCase_1014__wm_d2, "findFunction": findFunction_1021, "findFunction__wm_d2": findFunction_1021__wm_d2, "findAdtForEmit": findAdtForEmit_1028, "findAdtForEmit__wm_d2": findAdtForEmit_1028__wm_d2, "findSourceFunction": findSourceFunction_1035, "findSourceFunction__wm_d2": findSourceFunction_1035__wm_d2, "typeName": typeName_1046, "typeName__wm_d2": typeName_1046__wm_d2, "emitEnvironmentFields": emitEnvironmentFields_1047, "emitEnvironmentFields__wm_d3": emitEnvironmentFields_1047__wm_d3, "hasUniformField": hasUniformField_1059, "emitResourceDeclarations": emitResourceDeclarations_1063, "emitResourceDeclarations__wm_d3": emitResourceDeclarations_1063__wm_d3, "emitEnvironmentDeclaration": emitEnvironmentDeclaration_1077, "emitPortableEnvironmentAccessors": emitPortableEnvironmentAccessors_1078, "emitPortableEnvironmentAccessors__wm_d3": emitPortableEnvironmentAccessors_1078__wm_d3, "joinText": joinText_1091, "joinText__wm_d3": joinText_1091__wm_d3, "emitTupleFields": emitTupleFields_1102, "emitTupleFields__wm_d4": emitTupleFields_1102__wm_d4, "emitTupleParams": emitTupleParams_1115, "emitTupleParams__wm_d4": emitTupleParams_1115__wm_d4, "emitTupleAssignments": emitTupleAssignments_1130, "emitTupleAssignments__wm_d3": emitTupleAssignments_1130__wm_d3, "emitTupleDeclaration": emitTupleDeclaration_1144, "emitTupleDeclaration__wm_d2": emitTupleDeclaration_1144__wm_d2, "emitTupleDeclarations": emitTupleDeclarations_1145, "emitTupleDeclarations__wm_d3": emitTupleDeclarations_1145__wm_d3, "zeroArgs": zeroArgs_1156, "zeroArgs__wm_d4": zeroArgs_1156__wm_d4, "zeroValue": zeroValue_1157, "zeroValue__wm_d2": zeroValue_1157__wm_d2, "emitLayoutFields": emitLayoutFields_1174, "emitLayoutFields__wm_d3": emitLayoutFields_1174__wm_d3, "fieldsForEmit": fieldsForEmit_1185, "fieldsForEmit__wm_d2": fieldsForEmit_1185__wm_d2, "emitConstructorFieldAssignments": emitConstructorFieldAssignments_1192, "emitConstructorFieldAssignments__wm_d5": emitConstructorFieldAssignments_1192__wm_d5, "emitConstructorDeclaration": emitConstructorDeclaration_1214, "emitConstructorDeclaration__wm_d3": emitConstructorDeclaration_1214__wm_d3, "emitLayoutConstructors": emitLayoutConstructors_1215, "emitLayoutConstructors__wm_d4": emitLayoutConstructors_1215__wm_d4, "emitLayoutDeclaration": emitLayoutDeclaration_1232, "emitLayoutDeclaration__wm_d2": emitLayoutDeclaration_1232__wm_d2, "emitLayoutDeclarations": emitLayoutDeclarations_1233, "emitLayoutDeclarations__wm_d3": emitLayoutDeclarations_1233__wm_d3, "emitAtom": emitAtom_1247, "emitAtom__wm_d2": emitAtom_1247__wm_d2, "emitArgs": emitArgs_1248, "emitArgs__wm_d3": emitArgs_1248__wm_d3, "operatorText": operatorText_1261, "emitResourceCall": emitResourceCall_1270, "emitResourceCall__wm_d3": emitResourceCall_1270__wm_d3, "emitPayload": emitPayload_1277, "emitPayload__wm_d3": emitPayload_1277__wm_d3, "emitProjection": emitProjection_1284, "emitProjection__wm_d3": emitProjection_1284__wm_d3, "emitOperatorOperation": emitOperatorOperation_1294, "emitOperatorOperation__wm_d3": emitOperatorOperation_1294__wm_d3, "emitOperation": emitOperation_1304, "emitOperation__wm_d2": emitOperation_1304__wm_d2, "emitBlockStatements": emitBlockStatements_1305, "emitBlockStatements__wm_d4": emitBlockStatements_1305__wm_d4, "emitBlock": emitBlock_1306, "emitBlock__wm_d3": emitBlock_1306__wm_d3, "emitCases": emitCases_1307, "emitCases__wm_d4": emitCases_1307__wm_d4, "emitParallelAssignments": emitParallelAssignments_1308, "emitParallelAssignments__wm_d5": emitParallelAssignments_1308__wm_d5, "emitStatement": emitStatement_1309, "emitStatement__wm_d3": emitStatement_1309__wm_d3, "emitFunctionParams": emitFunctionParams_1366, "emitFunctionParams__wm_d3": emitFunctionParams_1366__wm_d3, "emitFunction": emitFunction_1388, "emitFunction__wm_d2": emitFunction_1388__wm_d2, "emitFunctions": emitFunctions_1389, "emitFunctions__wm_d3": emitFunctions_1389__wm_d3, "emitWrappers": emitWrappers_1405, "emitSliceSlangModule": emitSliceSlangModule_1417, "emitSliceSlangModule__wm_d10": emitSliceSlangModule_1417__wm_d10, "emitSliceCallableName": emitSliceCallableName_1419, "emitSliceSlang": emitSliceSlang_1431, "emitSliceSlang__wm_d10": emitSliceSlang_1431__wm_d10 };
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
const NumericContext_1432 = (__record_args) => ({ expressionOffset: __record_args[0], fieldOffset: __record_args[1], types: __record_args[2], expressions: __record_args[3], patterns: __record_args[4], params: __record_args[5], lets: __record_args[6], blocks: __record_args[7], functions: __record_args[8], environmentFields: __record_args[9], exprNodes: __record_args[10], patternNodes: __record_args[11], patternByBinding: __record_args[12], lanes: __record_args[13] });
const NumericEvidence_1433 = (__record_args) => ({ representation: __record_args[0], spanId: __record_args[1] });
const numberEqual_1436__wm_d2 = (left_1434, right_1435) => {
return __wm_op_and_d2(__wm_op_not((left_1434 < right_1435)), __wm_op_not((left_1434 > right_1435)));
};
const numberEqual_1436 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numberEqual_1436__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const listLength_1437__wm_d2 = (items_1438, length_1439) => {
__wm_tail_76: while (true) {
{
const __wm_scalar_101_0 = items_1438;
const __wm_scalar_101_1 = length_1439;
if (__wm_scalar_101_0 === __wm_basis_Nil) {
const length_1440 = __wm_scalar_101_1;
return length_1440;
} else if (__wm_scalar_101_0?.ctor === -6 && __wm_scalar_101_0.args.length === 1 && __wm_is_tuple(__wm_scalar_101_0.args[0]) && __wm_scalar_101_0.args[0].length === 2) {
const __1441 = __wm_scalar_101_0.args[0][0];
const rest_1442 = __wm_scalar_101_0.args[0][1];
const length_1443 = __wm_scalar_101_1;
{
const __wm_tail_arg_86_0 = rest_1442;
const __wm_tail_arg_86_1 = (length_1443 + 1);
items_1438 = __wm_tail_arg_86_0;
length_1439 = __wm_tail_arg_86_1;
continue __wm_tail_76;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const listLength_1437 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return listLength_1437__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findType_1444__wm_d2 = (items_1445, id_1446) => {
__wm_tail_77: while (true) {
{
const __wm_scalar_102_0 = items_1445;
const __wm_scalar_102_1 = id_1446;
if (__wm_scalar_102_0 === __wm_basis_Nil) {
const id_1447 = __wm_scalar_102_1;
return __wm_fail("Panic", "missing numeric semantic type");
} else if (__wm_scalar_102_0?.ctor === -6 && __wm_scalar_102_0.args.length === 1 && __wm_is_tuple(__wm_scalar_102_0.args[0]) && __wm_scalar_102_0.args[0].length === 2) {
const item_1448 = __wm_scalar_102_0.args[0][0];
const rest_1449 = __wm_scalar_102_0.args[0][1];
const id_1450 = __wm_scalar_102_1;
if (numberEqual_1436__wm_d2(item_1448.id, id_1450)) {
return item_1448;
} else {
{
const __wm_tail_arg_87_0 = rest_1449;
const __wm_tail_arg_87_1 = id_1450;
items_1445 = __wm_tail_arg_87_0;
id_1446 = __wm_tail_arg_87_1;
continue __wm_tail_77;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findType_1444 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findType_1444__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const allNumberTypes_1451__wm_d2 = (typeIds_1452, types_1453) => {
const __wm_scalar_103_0 = typeIds_1452;
const __wm_scalar_103_1 = types_1453;
if (__wm_scalar_103_0 === __wm_basis_Nil) {
const types_1454 = __wm_scalar_103_1;
return true;
} else if (__wm_scalar_103_0?.ctor === -6 && __wm_scalar_103_0.args.length === 1 && __wm_is_tuple(__wm_scalar_103_0.args[0]) && __wm_scalar_103_0.args[0].length === 2) {
const typeId_1455 = __wm_scalar_103_0.args[0][0];
const rest_1456 = __wm_scalar_103_0.args[0][1];
const types_1457 = __wm_scalar_103_1;
const gpuType_1458 = findType_1444__wm_d2(types_1457, typeId_1455);
return __wm_op_and_d2(__wm_eq(gpuType_1458.kind, "number"), allNumberTypes_1451__wm_d2(rest_1456, types_1457));
}
__wm_fail("Match", "non-exhaustive match");
};
const allNumberTypes_1451 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return allNumberTypes_1451__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const numericType_1464__wm_d2 = (typeId_1459, context_1460) => {
const gpuType_1461 = findType_1444__wm_d2(context_1460.types, typeId_1459);
if (__wm_eq(gpuType_1461.kind, "number")) {
return true;
} else {
if (__wm_eq(gpuType_1461.kind, "tuple")) {
const items_1462 = Js.Array.toList(gpuType_1461.items);
const width_1463 = listLength_1437__wm_d2(items_1462, 0);
return __wm_op_and_d2(__wm_op_and_d2((width_1463 >= 2), (width_1463 <= 4)), allNumberTypes_1451__wm_d2(items_1462, context_1460.types));
} else {
return false;
}
}
};
const numericType_1464 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numericType_1464__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const computeExpressionNode_1467__wm_d2 = (expression_1465, context_1466) => {
if (numericType_1464__wm_d2(expression_1465.typeId, context_1466)) {
return expression_1465.id;
} else {
return __wm_op_sub(1);
}
};
const computeExpressionNode_1467 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return computeExpressionNode_1467__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const expressionNode_1471__wm_d2 = (expression_1468, context_1469) => {
const __wm_return_value_38 = Map.get([context_1469.exprNodes, expression_1468.id]);
if (__wm_return_value_38?.ctor === -2 && __wm_return_value_38.args.length === 1) {
const node_1470 = __wm_return_value_38.args[0];
return node_1470;
} else if (__wm_return_value_38 === __wm_basis_None) {

return computeExpressionNode_1467__wm_d2(expression_1468, context_1469);
}
__wm_fail("Match", "non-exhaustive match");
};
const expressionNode_1471 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return expressionNode_1471__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const computePatternNode_1474__wm_d2 = (pattern_1472, context_1473) => {
if (numericType_1464__wm_d2(pattern_1472.typeId, context_1473)) {
return (context_1473.expressionOffset + pattern_1472.id);
} else {
return __wm_op_sub(1);
}
};
const computePatternNode_1474 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return computePatternNode_1474__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const patternNode_1478__wm_d2 = (pattern_1475, context_1476) => {
const __wm_return_value_39 = Map.get([context_1476.patternNodes, pattern_1475.id]);
if (__wm_return_value_39?.ctor === -2 && __wm_return_value_39.args.length === 1) {
const node_1477 = __wm_return_value_39.args[0];
return node_1477;
} else if (__wm_return_value_39 === __wm_basis_None) {

return computePatternNode_1474__wm_d2(pattern_1475, context_1476);
}
__wm_fail("Match", "non-exhaustive match");
};
const patternNode_1478 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return patternNode_1478__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const boundPatternNode_1483__wm_d3 = (context_1479, bindingId_1480, ownerFunctionId_1481) => {
const __wm_return_value_40 = Map.get([context_1479.patternByBinding, ((bindingId_1480 * 1000000) + ownerFunctionId_1481)]);
if (__wm_return_value_40?.ctor === -2 && __wm_return_value_40.args.length === 1) {
const node_1482 = __wm_return_value_40.args[0];
return node_1482;
} else if (__wm_return_value_40 === __wm_basis_None) {

return __wm_op_sub(1);
}
__wm_fail("Match", "non-exhaustive match");
};
const boundPatternNode_1483 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return boundPatternNode_1483__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lookupLanes_1487__wm_d2 = (context_1484, expressionId_1485) => {
const __wm_return_value_41 = Map.get([context_1484.lanes, expressionId_1485]);
if (__wm_return_value_41?.ctor === -2 && __wm_return_value_41.args.length === 1) {
const lanes_1486 = __wm_return_value_41.args[0];
return lanes_1486;
} else if (__wm_return_value_41 === __wm_basis_None) {

return __wm_basis_Nil;
}
__wm_fail("Match", "non-exhaustive match");
};
const lookupLanes_1487 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return lookupLanes_1487__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const fieldNode_1490__wm_d2 = (field_1488, context_1489) => {
if (numericType_1464__wm_d2(field_1488.typeId, context_1489)) {
return (context_1489.fieldOffset + field_1488.id);
} else {
return __wm_op_sub(1);
}
};
const fieldNode_1490 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return fieldNode_1490__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const evidence_1493__wm_d2 = (representations_1491, node_1492) => {
if ((node_1492 < 0)) {
return __wm_basis_None;
} else {
return Map.get([representations_1491, node_1492]);
}
};
const evidence_1493 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return evidence_1493__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const representation_1497__wm_d2 = (representations_1494, node_1495) => {
const __wm_return_value_42 = evidence_1493__wm_d2(representations_1494, node_1495);
if (__wm_return_value_42?.ctor === -2 && __wm_return_value_42.args.length === 1) {
const value_1496 = __wm_return_value_42.args[0];
return value_1496.representation;
} else if (__wm_return_value_42 === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const representation_1497 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return representation_1497__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const numericConflict_1500__wm_d2 = (left_1498, right_1499) => {
return __wm_fail("Panic", ((((((("WM_GPU_NUMERIC_CONFLICT|" + Text.of(left_1498.spanId)) + "|") + Text.of(right_1499.spanId)) + "|") + left_1498.representation) + "|") + right_1499.representation));
};
const numericConflict_1500 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numericConflict_1500__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const setEvidence_1505__wm_d3 = (representations_1501, node_1502, value_1503) => {
if (__wm_op_or_d2((node_1502 < 0), __wm_eq(value_1503.representation, ""))) {
return [representations_1501, false];
} else {
const __wm_return_value_43 = evidence_1493__wm_d2(representations_1501, node_1502);
if (__wm_return_value_43 === __wm_basis_None) {

return [Map.set([representations_1501, node_1502, value_1503]), true];
} else if (__wm_return_value_43?.ctor === -2 && __wm_return_value_43.args.length === 1) {
const previous_1504 = __wm_return_value_43.args[0];
if (__wm_eq(previous_1504.representation, value_1503.representation)) {
return [representations_1501, false];
} else {
return numericConflict_1500__wm_d2(previous_1504, value_1503);
}
}
__wm_fail("Match", "non-exhaustive match");
}
};
const setEvidence_1505 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return setEvidence_1505__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setRepresentation_1511__wm_d4 = (representations_1506, node_1507, value_1508, spanId_1509) => {
const item_1510 = { representation: value_1508, spanId: spanId_1509 };
return setEvidence_1505__wm_d3(representations_1506, node_1507, item_1510);
};
const setRepresentation_1511 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setRepresentation_1511__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const combinedEvidence_1512__wm_d3 = (nodes_1513, representations_1514, combined_1515) => {
__wm_tail_78: while (true) {
{
const __wm_scalar_104_0 = nodes_1513;
const __wm_scalar_104_1 = representations_1514;
const __wm_scalar_104_2 = combined_1515;
if (__wm_scalar_104_0 === __wm_basis_Nil) {
const representations_1516 = __wm_scalar_104_1;
const combined_1517 = __wm_scalar_104_2;
return combined_1517;
} else if (__wm_scalar_104_0?.ctor === -6 && __wm_scalar_104_0.args.length === 1 && __wm_is_tuple(__wm_scalar_104_0.args[0]) && __wm_scalar_104_0.args[0].length === 2) {
const node_1518 = __wm_scalar_104_0.args[0][0];
const rest_1519 = __wm_scalar_104_0.args[0][1];
const representations_1520 = __wm_scalar_104_1;
const combined_1521 = __wm_scalar_104_2;
{
const __wm_tail_value_88 = evidence_1493__wm_d2(representations_1520, node_1518);
if (__wm_tail_value_88 === __wm_basis_None) {

{
const __wm_tail_arg_89_0 = rest_1519;
const __wm_tail_arg_89_1 = representations_1520;
const __wm_tail_arg_89_2 = combined_1521;
nodes_1513 = __wm_tail_arg_89_0;
representations_1514 = __wm_tail_arg_89_1;
combined_1515 = __wm_tail_arg_89_2;
continue __wm_tail_78;
}
} else if (__wm_tail_value_88?.ctor === -2 && __wm_tail_value_88.args.length === 1) {
const value_1522 = __wm_tail_value_88.args[0];
{
const __wm_tail_value_90 = combined_1521;
if (__wm_tail_value_90 === __wm_basis_None) {

{
const __wm_tail_arg_91_0 = rest_1519;
const __wm_tail_arg_91_1 = representations_1520;
const __wm_tail_arg_91_2 = __wm_basis_Some(value_1522);
nodes_1513 = __wm_tail_arg_91_0;
representations_1514 = __wm_tail_arg_91_1;
combined_1515 = __wm_tail_arg_91_2;
continue __wm_tail_78;
}
} else if (__wm_tail_value_90?.ctor === -2 && __wm_tail_value_90.args.length === 1) {
const previous_1523 = __wm_tail_value_90.args[0];
if (__wm_eq(previous_1523.representation, value_1522.representation)) {
{
const __wm_tail_arg_92_0 = rest_1519;
const __wm_tail_arg_92_1 = representations_1520;
const __wm_tail_arg_92_2 = combined_1521;
nodes_1513 = __wm_tail_arg_92_0;
representations_1514 = __wm_tail_arg_92_1;
combined_1515 = __wm_tail_arg_92_2;
continue __wm_tail_78;
}
} else {
return numericConflict_1500__wm_d2(previous_1523, value_1522);
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
const combinedEvidence_1512 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return combinedEvidence_1512__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setGroup_1524__wm_d4 = (nodes_1525, value_1526, representations_1527, changed_1528) => {
__wm_tail_79: while (true) {
{
const __wm_scalar_105_0 = nodes_1525;
const __wm_scalar_105_1 = value_1526;
const __wm_scalar_105_2 = representations_1527;
const __wm_scalar_105_3 = changed_1528;
if (__wm_scalar_105_0 === __wm_basis_Nil) {
const value_1529 = __wm_scalar_105_1;
const representations_1530 = __wm_scalar_105_2;
const changed_1531 = __wm_scalar_105_3;
return [representations_1530, changed_1531];
} else if (__wm_scalar_105_0?.ctor === -6 && __wm_scalar_105_0.args.length === 1 && __wm_is_tuple(__wm_scalar_105_0.args[0]) && __wm_scalar_105_0.args[0].length === 2) {
const node_1532 = __wm_scalar_105_0.args[0][0];
const rest_1533 = __wm_scalar_105_0.args[0][1];
const value_1534 = __wm_scalar_105_1;
const representations_1535 = __wm_scalar_105_2;
const changed_1536 = __wm_scalar_105_3;
{
const __wm_bind_57 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const item_1537 = __v.args[0];
return setEvidence_1505__wm_d3(representations_1535, node_1532, item_1537);
} else if (__v === __wm_basis_None) {

return [representations_1535, false];
}
__wm_fail("Match", "non-exhaustive match");
})(value_1534);
if (!(__wm_is_tuple(__wm_bind_57) && __wm_bind_57.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1538 = __wm_bind_57[0];
const itemChanged_1539 = __wm_bind_57[1];
{
const __wm_tail_arg_93_0 = rest_1533;
const __wm_tail_arg_93_1 = value_1534;
const __wm_tail_arg_93_2 = next_1538;
const __wm_tail_arg_93_3 = __wm_op_or_d2(changed_1536, itemChanged_1539);
nodes_1525 = __wm_tail_arg_93_0;
value_1526 = __wm_tail_arg_93_1;
representations_1527 = __wm_tail_arg_93_2;
changed_1528 = __wm_tail_arg_93_3;
continue __wm_tail_79;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const setGroup_1524 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setGroup_1524__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeGroup_1543__wm_d2 = (nodes_1540, representations_1541) => {
const value_1542 = combinedEvidence_1512__wm_d3(nodes_1540, representations_1541, __wm_basis_None);
return setGroup_1524__wm_d4(nodes_1540, value_1542, representations_1541, false);
};
const mergeGroup_1543 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return mergeGroup_1543__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findPatternByBinding_1544__wm_d3 = (patterns_1545, bindingId_1546, ownerFunctionId_1547) => {
__wm_tail_80: while (true) {
{
const __wm_scalar_106_0 = patterns_1545;
const __wm_scalar_106_1 = bindingId_1546;
const __wm_scalar_106_2 = ownerFunctionId_1547;
if (__wm_scalar_106_0 === __wm_basis_Nil) {
const bindingId_1548 = __wm_scalar_106_1;
const ownerFunctionId_1549 = __wm_scalar_106_2;
return __wm_basis_None;
} else if (__wm_scalar_106_0?.ctor === -6 && __wm_scalar_106_0.args.length === 1 && __wm_is_tuple(__wm_scalar_106_0.args[0]) && __wm_scalar_106_0.args[0].length === 2) {
const pattern_1550 = __wm_scalar_106_0.args[0][0];
const rest_1551 = __wm_scalar_106_0.args[0][1];
const bindingId_1552 = __wm_scalar_106_1;
const ownerFunctionId_1553 = __wm_scalar_106_2;
if (__wm_op_and_d2(numberEqual_1436__wm_d2(pattern_1550.bindingId, bindingId_1552), numberEqual_1436__wm_d2(pattern_1550.ownerFunctionId, ownerFunctionId_1553))) {
return __wm_basis_Some(pattern_1550);
} else {
{
const __wm_tail_arg_94_0 = rest_1551;
const __wm_tail_arg_94_1 = bindingId_1552;
const __wm_tail_arg_94_2 = ownerFunctionId_1553;
patterns_1545 = __wm_tail_arg_94_0;
bindingId_1546 = __wm_tail_arg_94_1;
ownerFunctionId_1547 = __wm_tail_arg_94_2;
continue __wm_tail_80;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findPatternByBinding_1544 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findPatternByBinding_1544__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const findParam_1554__wm_d2 = (params_1555, id_1556) => {
__wm_tail_81: while (true) {
{
const __wm_scalar_107_0 = params_1555;
const __wm_scalar_107_1 = id_1556;
if (__wm_scalar_107_0 === __wm_basis_Nil) {
const id_1557 = __wm_scalar_107_1;
return __wm_fail("Panic", "missing numeric function parameter");
} else if (__wm_scalar_107_0?.ctor === -6 && __wm_scalar_107_0.args.length === 1 && __wm_is_tuple(__wm_scalar_107_0.args[0]) && __wm_scalar_107_0.args[0].length === 2) {
const param_1558 = __wm_scalar_107_0.args[0][0];
const rest_1559 = __wm_scalar_107_0.args[0][1];
const id_1560 = __wm_scalar_107_1;
if (numberEqual_1436__wm_d2(param_1558.id, id_1560)) {
return param_1558;
} else {
{
const __wm_tail_arg_95_0 = rest_1559;
const __wm_tail_arg_95_1 = id_1560;
params_1555 = __wm_tail_arg_95_0;
id_1556 = __wm_tail_arg_95_1;
continue __wm_tail_81;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findParam_1554 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findParam_1554__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findPattern_1561__wm_d2 = (patterns_1562, id_1563) => {
__wm_tail_82: while (true) {
{
const __wm_scalar_108_0 = patterns_1562;
const __wm_scalar_108_1 = id_1563;
if (__wm_scalar_108_0 === __wm_basis_Nil) {
const id_1564 = __wm_scalar_108_1;
return __wm_fail("Panic", "missing numeric pattern");
} else if (__wm_scalar_108_0?.ctor === -6 && __wm_scalar_108_0.args.length === 1 && __wm_is_tuple(__wm_scalar_108_0.args[0]) && __wm_scalar_108_0.args[0].length === 2) {
const pattern_1565 = __wm_scalar_108_0.args[0][0];
const rest_1566 = __wm_scalar_108_0.args[0][1];
const id_1567 = __wm_scalar_108_1;
if (numberEqual_1436__wm_d2(pattern_1565.id, id_1567)) {
return pattern_1565;
} else {
{
const __wm_tail_arg_96_0 = rest_1566;
const __wm_tail_arg_96_1 = id_1567;
patterns_1562 = __wm_tail_arg_96_0;
id_1563 = __wm_tail_arg_96_1;
continue __wm_tail_82;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findPattern_1561 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findPattern_1561__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findFunction_1568__wm_d2 = (functions_1569, id_1570) => {
__wm_tail_83: while (true) {
{
const __wm_scalar_109_0 = functions_1569;
const __wm_scalar_109_1 = id_1570;
if (__wm_scalar_109_0 === __wm_basis_Nil) {
const id_1571 = __wm_scalar_109_1;
return __wm_fail("Panic", "missing numeric function");
} else if (__wm_scalar_109_0?.ctor === -6 && __wm_scalar_109_0.args.length === 1 && __wm_is_tuple(__wm_scalar_109_0.args[0]) && __wm_scalar_109_0.args[0].length === 2) {
const fn_1572 = __wm_scalar_109_0.args[0][0];
const rest_1573 = __wm_scalar_109_0.args[0][1];
const id_1574 = __wm_scalar_109_1;
if (numberEqual_1436__wm_d2(fn_1572.id, id_1574)) {
return fn_1572;
} else {
{
const __wm_tail_arg_97_0 = rest_1573;
const __wm_tail_arg_97_1 = id_1574;
functions_1569 = __wm_tail_arg_97_0;
id_1570 = __wm_tail_arg_97_1;
continue __wm_tail_83;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findFunction_1568 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findFunction_1568__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findExpression_1575__wm_d2 = (expressions_1576, id_1577) => {
__wm_tail_84: while (true) {
{
const __wm_scalar_110_0 = expressions_1576;
const __wm_scalar_110_1 = id_1577;
if (__wm_scalar_110_0 === __wm_basis_Nil) {
const id_1578 = __wm_scalar_110_1;
return __wm_fail("Panic", "missing numeric expression");
} else if (__wm_scalar_110_0?.ctor === -6 && __wm_scalar_110_0.args.length === 1 && __wm_is_tuple(__wm_scalar_110_0.args[0]) && __wm_scalar_110_0.args[0].length === 2) {
const expression_1579 = __wm_scalar_110_0.args[0][0];
const rest_1580 = __wm_scalar_110_0.args[0][1];
const id_1581 = __wm_scalar_110_1;
if (numberEqual_1436__wm_d2(expression_1579.id, id_1581)) {
return expression_1579;
} else {
{
const __wm_tail_arg_98_0 = rest_1580;
const __wm_tail_arg_98_1 = id_1581;
expressions_1576 = __wm_tail_arg_98_0;
id_1577 = __wm_tail_arg_98_1;
continue __wm_tail_84;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findExpression_1575 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findExpression_1575__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findBlock_1582__wm_d2 = (blocks_1583, expressionId_1584) => {
__wm_tail_85: while (true) {
{
const __wm_scalar_111_0 = blocks_1583;
const __wm_scalar_111_1 = expressionId_1584;
if (__wm_scalar_111_0 === __wm_basis_Nil) {
const expressionId_1585 = __wm_scalar_111_1;
return __wm_fail("Panic", "missing numeric block");
} else if (__wm_scalar_111_0?.ctor === -6 && __wm_scalar_111_0.args.length === 1 && __wm_is_tuple(__wm_scalar_111_0.args[0]) && __wm_scalar_111_0.args[0].length === 2) {
const block_1586 = __wm_scalar_111_0.args[0][0];
const rest_1587 = __wm_scalar_111_0.args[0][1];
const expressionId_1588 = __wm_scalar_111_1;
if (numberEqual_1436__wm_d2(block_1586.expressionId, expressionId_1588)) {
return block_1586;
} else {
{
const __wm_tail_arg_99_0 = rest_1587;
const __wm_tail_arg_99_1 = expressionId_1588;
blocks_1583 = __wm_tail_arg_99_0;
expressionId_1584 = __wm_tail_arg_99_1;
continue __wm_tail_85;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findBlock_1582 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findBlock_1582__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findEnvironmentField_1589__wm_d2 = (fields_1590, declaredIndex_1591) => {
__wm_tail_86: while (true) {
{
const __wm_scalar_112_0 = fields_1590;
const __wm_scalar_112_1 = declaredIndex_1591;
if (__wm_scalar_112_0 === __wm_basis_Nil) {
const declaredIndex_1592 = __wm_scalar_112_1;
return __wm_fail("Panic", "missing numeric environment field");
} else if (__wm_scalar_112_0?.ctor === -6 && __wm_scalar_112_0.args.length === 1 && __wm_is_tuple(__wm_scalar_112_0.args[0]) && __wm_scalar_112_0.args[0].length === 2) {
const field_1593 = __wm_scalar_112_0.args[0][0];
const rest_1594 = __wm_scalar_112_0.args[0][1];
const declaredIndex_1595 = __wm_scalar_112_1;
if (numberEqual_1436__wm_d2(field_1593.declaredIndex, declaredIndex_1595)) {
return field_1593;
} else {
{
const __wm_tail_arg_100_0 = rest_1594;
const __wm_tail_arg_100_1 = declaredIndex_1595;
fields_1590 = __wm_tail_arg_100_0;
declaredIndex_1591 = __wm_tail_arg_100_1;
continue __wm_tail_86;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findEnvironmentField_1589 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findEnvironmentField_1589__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const laneContains_1596__wm_d2 = (ids_1597, id_1598) => {
__wm_tail_87: while (true) {
{
const __wm_scalar_113_0 = ids_1597;
const __wm_scalar_113_1 = id_1598;
if (__wm_scalar_113_0 === __wm_basis_Nil) {
const _id_1599 = __wm_scalar_113_1;
return false;
} else if (__wm_scalar_113_0?.ctor === -6 && __wm_scalar_113_0.args.length === 1 && __wm_is_tuple(__wm_scalar_113_0.args[0]) && __wm_scalar_113_0.args[0].length === 2) {
const head_1600 = __wm_scalar_113_0.args[0][0];
const rest_1601 = __wm_scalar_113_0.args[0][1];
const id_1602 = __wm_scalar_113_1;
if (numberEqual_1436__wm_d2(head_1600, id_1602)) {
return true;
} else {
{
const __wm_tail_arg_101_0 = rest_1601;
const __wm_tail_arg_101_1 = id_1602;
ids_1597 = __wm_tail_arg_101_0;
id_1598 = __wm_tail_arg_101_1;
continue __wm_tail_87;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const laneContains_1596 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return laneContains_1596__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const childLaneNodes_1603__wm_d2 = (ids_1604, exprNodes_1605) => {
const __wm_scalar_114_0 = ids_1604;
const __wm_scalar_114_1 = exprNodes_1605;
if (__wm_scalar_114_0 === __wm_basis_Nil) {
const _exprNodes_1606 = __wm_scalar_114_1;
return __wm_basis_Nil;
} else if (__wm_scalar_114_0?.ctor === -6 && __wm_scalar_114_0.args.length === 1 && __wm_is_tuple(__wm_scalar_114_0.args[0]) && __wm_scalar_114_0.args[0].length === 2) {
const id_1607 = __wm_scalar_114_0.args[0][0];
const rest_1608 = __wm_scalar_114_0.args[0][1];
const exprNodes_1609 = __wm_scalar_114_1;
const node_1611 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const n_1610 = __v.args[0];
return n_1610;
} else if (__v === __wm_basis_None) {

return __wm_op_sub(1);
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([exprNodes_1609, id_1607]));
return __wm_basis_Cons([node_1611, childLaneNodes_1603__wm_d2(rest_1608, exprNodes_1609)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const childLaneNodes_1603 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return childLaneNodes_1603__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const lookupMemoLanes_1615__wm_d2 = (memo_1612, expressionId_1613) => {
const __wm_return_value_44 = Map.get([memo_1612, expressionId_1613]);
if (__wm_return_value_44?.ctor === -2 && __wm_return_value_44.args.length === 1) {
const lanes_1614 = __wm_return_value_44.args[0];
return lanes_1614;
} else if (__wm_return_value_44 === __wm_basis_None) {

return __wm_basis_Nil;
}
__wm_fail("Match", "non-exhaustive match");
};
const lookupMemoLanes_1615 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return lookupMemoLanes_1615__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const patternLaneNodes_1616__wm_d2 = (ids_1617, context_1618) => {
const __wm_scalar_115_0 = ids_1617;
const __wm_scalar_115_1 = context_1618;
if (__wm_scalar_115_0 === __wm_basis_Nil) {
const _context_1619 = __wm_scalar_115_1;
return __wm_basis_Nil;
} else if (__wm_scalar_115_0?.ctor === -6 && __wm_scalar_115_0.args.length === 1 && __wm_is_tuple(__wm_scalar_115_0.args[0]) && __wm_scalar_115_0.args[0].length === 2) {
const id_1620 = __wm_scalar_115_0.args[0][0];
const rest_1621 = __wm_scalar_115_0.args[0][1];
const context_1622 = __wm_scalar_115_1;
const child_1623 = findPattern_1561__wm_d2(context_1622.patterns, id_1620);
return __wm_basis_Cons([patternNode_1478__wm_d2(child_1623, context_1622), patternLaneNodes_1616__wm_d2(rest_1621, context_1622)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const patternLaneNodes_1616 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return patternLaneNodes_1616__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeLanePairs_1624__wm_d4 = (left_1625, right_1626, representations_1627, changed_1628) => {
__wm_tail_88: while (true) {
{
const __wm_scalar_116_0 = left_1625;
const __wm_scalar_116_1 = right_1626;
const __wm_scalar_116_2 = representations_1627;
const __wm_scalar_116_3 = changed_1628;
if (__wm_scalar_116_0 === __wm_basis_Nil && __wm_scalar_116_1 === __wm_basis_Nil) {
const representations_1629 = __wm_scalar_116_2;
const changed_1630 = __wm_scalar_116_3;
return [representations_1629, changed_1630];
} else if (__wm_scalar_116_0?.ctor === -6 && __wm_scalar_116_0.args.length === 1 && __wm_is_tuple(__wm_scalar_116_0.args[0]) && __wm_scalar_116_0.args[0].length === 2 && __wm_scalar_116_1?.ctor === -6 && __wm_scalar_116_1.args.length === 1 && __wm_is_tuple(__wm_scalar_116_1.args[0]) && __wm_scalar_116_1.args[0].length === 2) {
const a_1631 = __wm_scalar_116_0.args[0][0];
const restA_1632 = __wm_scalar_116_0.args[0][1];
const b_1633 = __wm_scalar_116_1.args[0][0];
const restB_1634 = __wm_scalar_116_1.args[0][1];
const representations_1635 = __wm_scalar_116_2;
const changed_1636 = __wm_scalar_116_3;
{
const __wm_bind_58 = mergeGroup_1543__wm_d2(__wm_basis_Cons([a_1631, __wm_basis_Cons([b_1633, __wm_basis_Nil])]), representations_1635);
if (!(__wm_is_tuple(__wm_bind_58) && __wm_bind_58.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1637 = __wm_bind_58[0];
const pairChanged_1638 = __wm_bind_58[1];
{
const __wm_tail_arg_102_0 = restA_1632;
const __wm_tail_arg_102_1 = restB_1634;
const __wm_tail_arg_102_2 = next_1637;
const __wm_tail_arg_102_3 = __wm_op_or_d2(changed_1636, pairChanged_1638);
left_1625 = __wm_tail_arg_102_0;
right_1626 = __wm_tail_arg_102_1;
representations_1627 = __wm_tail_arg_102_2;
changed_1628 = __wm_tail_arg_102_3;
continue __wm_tail_88;
}
}
} else if (true) {
const representations_1639 = __wm_scalar_116_2;
const changed_1640 = __wm_scalar_116_3;
return [representations_1639, changed_1640];
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const mergeLanePairs_1624 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return mergeLanePairs_1624__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const findLetForPattern_1641__wm_d2 = (lets_1642, patternId_1643) => {
__wm_tail_89: while (true) {
{
const __wm_scalar_117_0 = lets_1642;
const __wm_scalar_117_1 = patternId_1643;
if (__wm_scalar_117_0 === __wm_basis_Nil) {
const _patternId_1644 = __wm_scalar_117_1;
return __wm_basis_None;
} else if (__wm_scalar_117_0?.ctor === -6 && __wm_scalar_117_0.args.length === 1 && __wm_is_tuple(__wm_scalar_117_0.args[0]) && __wm_scalar_117_0.args[0].length === 2) {
const binding_1645 = __wm_scalar_117_0.args[0][0];
const rest_1646 = __wm_scalar_117_0.args[0][1];
const patternId_1647 = __wm_scalar_117_1;
if (numberEqual_1436__wm_d2(binding_1645.patternId, patternId_1647)) {
return __wm_basis_Some(binding_1645);
} else {
{
const __wm_tail_arg_103_0 = rest_1646;
const __wm_tail_arg_103_1 = patternId_1647;
lets_1642 = __wm_tail_arg_103_0;
patternId_1643 = __wm_tail_arg_103_1;
continue __wm_tail_89;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLetForPattern_1641 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLetForPattern_1641__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const laneForMemo_1648__wm_d6 = (expressionId_1650, context_1651, exprNodes_1652, memo_1653, visited_1654, depth_1655) => {
const __wm_return_value_45 = Map.get([memo_1653, expressionId_1650]);
if (__wm_return_value_45?.ctor === -2 && __wm_return_value_45.args.length === 1) {
const _lanes_1656 = __wm_return_value_45.args[0];
return memo_1653;
} else if (__wm_return_value_45 === __wm_basis_None) {

if (numberEqual_1436__wm_d2(depth_1655, 0)) {
return Map.set([memo_1653, expressionId_1650, __wm_basis_Nil]);
} else {
if (laneContains_1596__wm_d2(visited_1654, expressionId_1650)) {
return Map.set([memo_1653, expressionId_1650, __wm_basis_Nil]);
} else {
return laneForUncached_1649__wm_d6(expressionId_1650, context_1651, exprNodes_1652, memo_1653, __wm_basis_Cons([expressionId_1650, visited_1654]), (depth_1655 - 1));
}
}
}
__wm_fail("Match", "non-exhaustive match");
};
const laneForMemo_1648 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return laneForMemo_1648__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const laneForUncached_1649__wm_d6 = (expressionId_1657, context_1658, exprNodes_1659, memo_1660, visited_1661, depth_1662) => {
const expression_1663 = findExpression_1575__wm_d2(context_1658.expressions, expressionId_1657);
if (__wm_eq(expression_1663.kind, "tuple")) {
return Map.set([memo_1660, expressionId_1657, childLaneNodes_1603__wm_d2(Js.Array.toList(expression_1663.children), exprNodes_1659)]);
} else {
if (__wm_eq(expression_1663.kind, "if")) {
const __wm_return_value_46 = Js.Array.toList(expression_1663.children);
if (__wm_return_value_46?.ctor === -6 && __wm_return_value_46.args.length === 1 && __wm_is_tuple(__wm_return_value_46.args[0]) && __wm_return_value_46.args[0].length === 2 && __wm_return_value_46.args[0][1]?.ctor === -6 && __wm_return_value_46.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_46.args[0][1].args[0]) && __wm_return_value_46.args[0][1].args[0].length === 2 && __wm_return_value_46.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_46.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_46.args[0][1].args[0][1].args[0]) && __wm_return_value_46.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_46.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const _cond_1664 = __wm_return_value_46.args[0][0];
const thenId_1665 = __wm_return_value_46.args[0][1].args[0][0];
const elseId_1666 = __wm_return_value_46.args[0][1].args[0][1].args[0][0];
const afterThen_1667 = laneForMemo_1648__wm_d6(thenId_1665, context_1658, exprNodes_1659, memo_1660, visited_1661, depth_1662);
const afterElse_1668 = laneForMemo_1648__wm_d6(elseId_1666, context_1658, exprNodes_1659, afterThen_1667, visited_1661, depth_1662);
return Map.set([afterElse_1668, expressionId_1657, lookupMemoLanes_1615__wm_d2(afterElse_1668, thenId_1665)]);
} else if (true) {

return Map.set([memo_1660, expressionId_1657, __wm_basis_Nil]);
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_eq(expression_1663.kind, "block")) {
const block_1669 = findBlock_1582__wm_d2(context_1658.blocks, expression_1663.id);
const afterResult_1670 = laneForMemo_1648__wm_d6(block_1669.resultExprId, context_1658, exprNodes_1659, memo_1660, visited_1661, depth_1662);
return Map.set([afterResult_1670, expressionId_1657, lookupMemoLanes_1615__wm_d2(afterResult_1670, block_1669.resultExprId)]);
} else {
if (__wm_eq(expression_1663.kind, "call")) {
const target_1671 = findFunction_1568__wm_d2(context_1658.functions, expression_1663.functionId);
const body_1672 = findExpression_1575__wm_d2(context_1658.expressions, target_1671.bodyExprId);
const afterBody_1673 = laneForMemo_1648__wm_d6(body_1672.id, context_1658, exprNodes_1659, memo_1660, visited_1661, depth_1662);
return Map.set([afterBody_1673, expressionId_1657, lookupMemoLanes_1615__wm_d2(afterBody_1673, body_1672.id)]);
} else {
if (__wm_eq(expression_1663.kind, "var")) {
const __wm_return_value_47 = findPatternByBinding_1544__wm_d3(context_1658.patterns, expression_1663.bindingId, expression_1663.ownerFunctionId);
if (__wm_return_value_47?.ctor === -2 && __wm_return_value_47.args.length === 1) {
const pattern_1674 = __wm_return_value_47.args[0];
const __wm_return_value_48 = findLetForPattern_1641__wm_d2(context_1658.lets, pattern_1674.id);
if (__wm_return_value_48?.ctor === -2 && __wm_return_value_48.args.length === 1) {
const binding_1675 = __wm_return_value_48.args[0];
const afterValue_1676 = laneForMemo_1648__wm_d6(binding_1675.valueExprId, context_1658, exprNodes_1659, memo_1660, visited_1661, depth_1662);
return Map.set([afterValue_1676, expressionId_1657, lookupMemoLanes_1615__wm_d2(afterValue_1676, binding_1675.valueExprId)]);
} else if (__wm_return_value_48 === __wm_basis_None) {

return Map.set([memo_1660, expressionId_1657, __wm_basis_Nil]);
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_47 === __wm_basis_None) {

return Map.set([memo_1660, expressionId_1657, __wm_basis_Nil]);
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_eq(expression_1663.kind, "copy")) {
const __wm_return_value_49 = Js.Array.toList(expression_1663.children);
if (__wm_return_value_49?.ctor === -6 && __wm_return_value_49.args.length === 1 && __wm_is_tuple(__wm_return_value_49.args[0]) && __wm_return_value_49.args[0].length === 2 && __wm_return_value_49.args[0][1] === __wm_basis_Nil) {
const childId_1677 = __wm_return_value_49.args[0][0];
const afterChild_1678 = laneForMemo_1648__wm_d6(childId_1677, context_1658, exprNodes_1659, memo_1660, visited_1661, depth_1662);
return Map.set([afterChild_1678, expressionId_1657, lookupMemoLanes_1615__wm_d2(afterChild_1678, childId_1677)]);
} else if (true) {

return Map.set([memo_1660, expressionId_1657, __wm_basis_Nil]);
}
__wm_fail("Match", "non-exhaustive match");
} else {
return Map.set([memo_1660, expressionId_1657, __wm_basis_Nil]);
}
}
}
}
}
}
};
const laneForUncached_1649 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return laneForUncached_1649__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const foldExprNodes_1679__wm_d3 = (items_1680, context_1681, nodes_1682) => {
__wm_tail_90: while (true) {
{
const __wm_scalar_118_0 = items_1680;
const __wm_scalar_118_1 = context_1681;
const __wm_scalar_118_2 = nodes_1682;
if (__wm_scalar_118_0 === __wm_basis_Nil) {
const _context_1683 = __wm_scalar_118_1;
const nodes_1684 = __wm_scalar_118_2;
return nodes_1684;
} else if (__wm_scalar_118_0?.ctor === -6 && __wm_scalar_118_0.args.length === 1 && __wm_is_tuple(__wm_scalar_118_0.args[0]) && __wm_scalar_118_0.args[0].length === 2) {
const expression_1685 = __wm_scalar_118_0.args[0][0];
const rest_1686 = __wm_scalar_118_0.args[0][1];
const context_1687 = __wm_scalar_118_1;
const nodes_1688 = __wm_scalar_118_2;
{
const __wm_tail_arg_104_0 = rest_1686;
const __wm_tail_arg_104_1 = context_1687;
const __wm_tail_arg_104_2 = Map.set([nodes_1688, expression_1685.id, computeExpressionNode_1467__wm_d2(expression_1685, context_1687)]);
items_1680 = __wm_tail_arg_104_0;
context_1681 = __wm_tail_arg_104_1;
nodes_1682 = __wm_tail_arg_104_2;
continue __wm_tail_90;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const foldExprNodes_1679 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldExprNodes_1679__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const foldPatternNodes_1689__wm_d3 = (items_1690, context_1691, nodes_1692) => {
__wm_tail_91: while (true) {
{
const __wm_scalar_119_0 = items_1690;
const __wm_scalar_119_1 = context_1691;
const __wm_scalar_119_2 = nodes_1692;
if (__wm_scalar_119_0 === __wm_basis_Nil) {
const _context_1693 = __wm_scalar_119_1;
const nodes_1694 = __wm_scalar_119_2;
return nodes_1694;
} else if (__wm_scalar_119_0?.ctor === -6 && __wm_scalar_119_0.args.length === 1 && __wm_is_tuple(__wm_scalar_119_0.args[0]) && __wm_scalar_119_0.args[0].length === 2) {
const pattern_1695 = __wm_scalar_119_0.args[0][0];
const rest_1696 = __wm_scalar_119_0.args[0][1];
const context_1697 = __wm_scalar_119_1;
const nodes_1698 = __wm_scalar_119_2;
{
const __wm_tail_arg_105_0 = rest_1696;
const __wm_tail_arg_105_1 = context_1697;
const __wm_tail_arg_105_2 = Map.set([nodes_1698, pattern_1695.id, computePatternNode_1474__wm_d2(pattern_1695, context_1697)]);
items_1690 = __wm_tail_arg_105_0;
context_1691 = __wm_tail_arg_105_1;
nodes_1692 = __wm_tail_arg_105_2;
continue __wm_tail_91;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const foldPatternNodes_1689 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldPatternNodes_1689__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const foldPatternBindings_1699__wm_d3 = (items_1700, context_1701, bound_1702) => {
__wm_tail_92: while (true) {
{
const __wm_scalar_120_0 = items_1700;
const __wm_scalar_120_1 = context_1701;
const __wm_scalar_120_2 = bound_1702;
if (__wm_scalar_120_0 === __wm_basis_Nil) {
const _context_1703 = __wm_scalar_120_1;
const bound_1704 = __wm_scalar_120_2;
return bound_1704;
} else if (__wm_scalar_120_0?.ctor === -6 && __wm_scalar_120_0.args.length === 1 && __wm_is_tuple(__wm_scalar_120_0.args[0]) && __wm_scalar_120_0.args[0].length === 2) {
const pattern_1705 = __wm_scalar_120_0.args[0][0];
const rest_1706 = __wm_scalar_120_0.args[0][1];
const context_1707 = __wm_scalar_120_1;
const bound_1708 = __wm_scalar_120_2;
if ((pattern_1705.bindingId < 0)) {
{
const __wm_tail_arg_106_0 = rest_1706;
const __wm_tail_arg_106_1 = context_1707;
const __wm_tail_arg_106_2 = bound_1708;
items_1700 = __wm_tail_arg_106_0;
context_1701 = __wm_tail_arg_106_1;
bound_1702 = __wm_tail_arg_106_2;
continue __wm_tail_92;
}
} else {
{
const key_1709 = ((pattern_1705.bindingId * 1000000) + pattern_1705.ownerFunctionId);
{
const __wm_tail_value_107 = Map.get([bound_1708, key_1709]);
if (__wm_tail_value_107?.ctor === -2 && __wm_tail_value_107.args.length === 1) {
const _node_1710 = __wm_tail_value_107.args[0];
{
const __wm_tail_arg_108_0 = rest_1706;
const __wm_tail_arg_108_1 = context_1707;
const __wm_tail_arg_108_2 = bound_1708;
items_1700 = __wm_tail_arg_108_0;
context_1701 = __wm_tail_arg_108_1;
bound_1702 = __wm_tail_arg_108_2;
continue __wm_tail_92;
}
} else if (__wm_tail_value_107 === __wm_basis_None) {

{
const __wm_tail_arg_109_0 = rest_1706;
const __wm_tail_arg_109_1 = context_1707;
const __wm_tail_arg_109_2 = Map.set([bound_1708, key_1709, computePatternNode_1474__wm_d2(pattern_1705, context_1707)]);
items_1700 = __wm_tail_arg_109_0;
context_1701 = __wm_tail_arg_109_1;
bound_1702 = __wm_tail_arg_109_2;
continue __wm_tail_92;
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
const foldPatternBindings_1699 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldPatternBindings_1699__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const buildAllLanes_1711__wm_d4 = (items_1712, context_1713, exprNodes_1714, memo_1715) => {
__wm_tail_93: while (true) {
{
const __wm_scalar_121_0 = items_1712;
const __wm_scalar_121_1 = context_1713;
const __wm_scalar_121_2 = exprNodes_1714;
const __wm_scalar_121_3 = memo_1715;
if (__wm_scalar_121_0 === __wm_basis_Nil) {
const _context_1716 = __wm_scalar_121_1;
const _exprNodes_1717 = __wm_scalar_121_2;
const memo_1718 = __wm_scalar_121_3;
return memo_1718;
} else if (__wm_scalar_121_0?.ctor === -6 && __wm_scalar_121_0.args.length === 1 && __wm_is_tuple(__wm_scalar_121_0.args[0]) && __wm_scalar_121_0.args[0].length === 2) {
const expression_1719 = __wm_scalar_121_0.args[0][0];
const rest_1720 = __wm_scalar_121_0.args[0][1];
const context_1721 = __wm_scalar_121_1;
const exprNodes_1722 = __wm_scalar_121_2;
const memo_1723 = __wm_scalar_121_3;
{
const __wm_tail_arg_110_0 = rest_1720;
const __wm_tail_arg_110_1 = context_1721;
const __wm_tail_arg_110_2 = exprNodes_1722;
const __wm_tail_arg_110_3 = laneForMemo_1648__wm_d6(expression_1719.id, context_1721, exprNodes_1722, memo_1723, __wm_basis_Nil, 256);
items_1712 = __wm_tail_arg_110_0;
context_1713 = __wm_tail_arg_110_1;
exprNodes_1714 = __wm_tail_arg_110_2;
memo_1715 = __wm_tail_arg_110_3;
continue __wm_tail_93;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildAllLanes_1711 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return buildAllLanes_1711__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const buildNumericCaches_1729 = (__arg) => {
if (true) {
const context_1724 = __arg;
const exprNodes_1725 = foldExprNodes_1679__wm_d3(context_1724.expressions, context_1724, Map.empty(Map.numberCompare));
const patternNodes_1726 = foldPatternNodes_1689__wm_d3(context_1724.patterns, context_1724, Map.empty(Map.numberCompare));
const patternByBinding_1727 = foldPatternBindings_1699__wm_d3(context_1724.patterns, context_1724, Map.empty(Map.numberCompare));
const lanes_1728 = buildAllLanes_1711__wm_d4(context_1724.expressions, context_1724, exprNodes_1725, Map.empty(Map.numberCompare));
return { ...context_1724, exprNodes: exprNodes_1725, patternNodes: patternNodes_1726, patternByBinding: patternByBinding_1727, lanes: lanes_1728 };
}
__wm_fail("Match", "pattern match failure in function");
};
const numericChildNodes_1730__wm_d3 = (children_1731, context_1732, nodes_1733) => {
__wm_tail_94: while (true) {
{
const __wm_scalar_122_0 = children_1731;
const __wm_scalar_122_1 = context_1732;
const __wm_scalar_122_2 = nodes_1733;
if (__wm_scalar_122_0 === __wm_basis_Nil) {
const context_1734 = __wm_scalar_122_1;
const nodes_1735 = __wm_scalar_122_2;
return nodes_1735;
} else if (__wm_scalar_122_0?.ctor === -6 && __wm_scalar_122_0.args.length === 1 && __wm_is_tuple(__wm_scalar_122_0.args[0]) && __wm_scalar_122_0.args[0].length === 2) {
const childId_1736 = __wm_scalar_122_0.args[0][0];
const rest_1737 = __wm_scalar_122_0.args[0][1];
const context_1738 = __wm_scalar_122_1;
const nodes_1739 = __wm_scalar_122_2;
{
const child_1740 = findExpression_1575__wm_d2(context_1738.expressions, childId_1736);
const node_1741 = expressionNode_1471__wm_d2(child_1740, context_1738);
{
const __wm_tail_arg_111_0 = rest_1737;
const __wm_tail_arg_111_1 = context_1738;
const __wm_tail_arg_111_2 = ((node_1741 < 0) ? nodes_1739 : __wm_basis_Cons([node_1741, nodes_1739]));
children_1731 = __wm_tail_arg_111_0;
context_1732 = __wm_tail_arg_111_1;
nodes_1733 = __wm_tail_arg_111_2;
continue __wm_tail_94;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const numericChildNodes_1730 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return numericChildNodes_1730__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const ownAndChildren_1746__wm_d2 = (expression_1742, context_1743) => {
const own_1744 = expressionNode_1471__wm_d2(expression_1742, context_1743);
const children_1745 = numericChildNodes_1730__wm_d3(Js.Array.toList(expression_1742.children), context_1743, __wm_basis_Nil);
if ((own_1744 < 0)) {
return children_1745;
} else {
return __wm_basis_Cons([own_1744, children_1745]);
}
};
const ownAndChildren_1746 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return ownAndChildren_1746__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeArguments_1747__wm_d5 = (argumentIds_1748, paramIds_1749, context_1750, representations_1751, changed_1752) => {
__wm_tail_95: while (true) {
{
const __wm_scalar_123_0 = argumentIds_1748;
const __wm_scalar_123_1 = paramIds_1749;
const __wm_scalar_123_2 = context_1750;
const __wm_scalar_123_3 = representations_1751;
const __wm_scalar_123_4 = changed_1752;
if (__wm_scalar_123_0 === __wm_basis_Nil) {
const context_1753 = __wm_scalar_123_2;
const representations_1754 = __wm_scalar_123_3;
const changed_1755 = __wm_scalar_123_4;
return [representations_1754, changed_1755];
} else if (__wm_scalar_123_1 === __wm_basis_Nil) {
const context_1756 = __wm_scalar_123_2;
const representations_1757 = __wm_scalar_123_3;
const changed_1758 = __wm_scalar_123_4;
return [representations_1757, changed_1758];
} else if (__wm_scalar_123_0?.ctor === -6 && __wm_scalar_123_0.args.length === 1 && __wm_is_tuple(__wm_scalar_123_0.args[0]) && __wm_scalar_123_0.args[0].length === 2 && __wm_scalar_123_1?.ctor === -6 && __wm_scalar_123_1.args.length === 1 && __wm_is_tuple(__wm_scalar_123_1.args[0]) && __wm_scalar_123_1.args[0].length === 2) {
const argumentId_1759 = __wm_scalar_123_0.args[0][0];
const argumentRest_1760 = __wm_scalar_123_0.args[0][1];
const paramId_1761 = __wm_scalar_123_1.args[0][0];
const paramRest_1762 = __wm_scalar_123_1.args[0][1];
const context_1763 = __wm_scalar_123_2;
const representations_1764 = __wm_scalar_123_3;
const changed_1765 = __wm_scalar_123_4;
{
const argument_1766 = findExpression_1575__wm_d2(context_1763.expressions, argumentId_1759);
const param_1767 = findParam_1554__wm_d2(context_1763.params, paramId_1761);
const pattern_1768 = findPattern_1561__wm_d2(context_1763.patterns, param_1767.patternId);
const __wm_bind_59 = (__wm_eq(pattern_1768.kind, "tuple") ? (() => {
const __wm_bind_60 = mergeGroup_1543__wm_d2(__wm_basis_Cons([expressionNode_1471__wm_d2(argument_1766, context_1763), __wm_basis_Cons([patternNode_1478__wm_d2(pattern_1768, context_1763), __wm_basis_Nil])]), representations_1764);
if (!(__wm_is_tuple(__wm_bind_60) && __wm_bind_60.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withSingle_1769 = __wm_bind_60[0];
const singleChanged_1770 = __wm_bind_60[1];
const __wm_bind_61 = mergeLanePairs_1624__wm_d4(patternLaneNodes_1616__wm_d2(Js.Array.toList(pattern_1768.children), context_1763), lookupLanes_1487__wm_d2(context_1763, argument_1766.id), withSingle_1769, false);
if (!(__wm_is_tuple(__wm_bind_61) && __wm_bind_61.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const merged_1771 = __wm_bind_61[0];
const lanesChanged_1772 = __wm_bind_61[1];
return [merged_1771, __wm_op_or_d2(singleChanged_1770, lanesChanged_1772)];
})() : mergeGroup_1543__wm_d2(__wm_basis_Cons([expressionNode_1471__wm_d2(argument_1766, context_1763), __wm_basis_Cons([patternNode_1478__wm_d2(pattern_1768, context_1763), __wm_basis_Nil])]), representations_1764));
if (!(__wm_is_tuple(__wm_bind_59) && __wm_bind_59.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1773 = __wm_bind_59[0];
const pairChanged_1774 = __wm_bind_59[1];
{
const __wm_tail_arg_112_0 = argumentRest_1760;
const __wm_tail_arg_112_1 = paramRest_1762;
const __wm_tail_arg_112_2 = context_1763;
const __wm_tail_arg_112_3 = next_1773;
const __wm_tail_arg_112_4 = __wm_op_or_d2(changed_1765, pairChanged_1774);
argumentIds_1748 = __wm_tail_arg_112_0;
paramIds_1749 = __wm_tail_arg_112_1;
context_1750 = __wm_tail_arg_112_2;
representations_1751 = __wm_tail_arg_112_3;
changed_1752 = __wm_tail_arg_112_4;
continue __wm_tail_95;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const mergeArguments_1747 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return mergeArguments_1747__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const applyExpression_1793__wm_d3 = (expression_1775, context_1776, representations_1777) => {
if (__wm_eq(expression_1775.kind, "var")) {
return mergeGroup_1543__wm_d2(__wm_basis_Cons([expressionNode_1471__wm_d2(expression_1775, context_1776), __wm_basis_Cons([boundPatternNode_1483__wm_d3(context_1776, expression_1775.bindingId, expression_1775.ownerFunctionId), __wm_basis_Nil])]), representations_1777);
} else {
if (__wm_eq(expression_1775.kind, "uniform")) {
const field_1778 = findEnvironmentField_1589__wm_d2(context_1776.environmentFields, expression_1775.index);
return mergeGroup_1543__wm_d2(__wm_basis_Cons([expressionNode_1471__wm_d2(expression_1775, context_1776), __wm_basis_Cons([fieldNode_1490__wm_d2(field_1778, context_1776), __wm_basis_Nil])]), representations_1777);
} else {
if (__wm_eq(expression_1775.kind, "tuple")) {
if (numberEqual_1436__wm_d2(expressionNode_1471__wm_d2(expression_1775, context_1776), __wm_op_sub(1))) {
return [representations_1777, false];
} else {
return mergeGroup_1543__wm_d2(ownAndChildren_1746__wm_d2(expression_1775, context_1776), representations_1777);
}
} else {
if (__wm_op_or_d2(__wm_op_or_d2(__wm_op_or_d2(__wm_op_or_d2(__wm_eq(expression_1775.kind, "project"), __wm_eq(expression_1775.kind, "copy")), __wm_eq(expression_1775.kind, "binary")), __wm_eq(expression_1775.kind, "unary")), __wm_eq(expression_1775.kind, "builtin"))) {
return mergeGroup_1543__wm_d2(ownAndChildren_1746__wm_d2(expression_1775, context_1776), representations_1777);
} else {
if (__wm_eq(expression_1775.kind, "if")) {
const __wm_bind_62 = mergeGroup_1543__wm_d2(ownAndChildren_1746__wm_d2(expression_1775, context_1776), representations_1777);
if (!(__wm_is_tuple(__wm_bind_62) && __wm_bind_62.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withOwn_1779 = __wm_bind_62[0];
const ownChanged_1780 = __wm_bind_62[1];
const own_1781 = expressionNode_1471__wm_d2(expression_1775, context_1776);
if (numberEqual_1436__wm_d2(own_1781, __wm_op_sub(1))) {
const __wm_return_value_50 = Js.Array.toList(expression_1775.children);
if (__wm_return_value_50?.ctor === -6 && __wm_return_value_50.args.length === 1 && __wm_is_tuple(__wm_return_value_50.args[0]) && __wm_return_value_50.args[0].length === 2 && __wm_return_value_50.args[0][1]?.ctor === -6 && __wm_return_value_50.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_50.args[0][1].args[0]) && __wm_return_value_50.args[0][1].args[0].length === 2 && __wm_return_value_50.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_50.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_50.args[0][1].args[0][1].args[0]) && __wm_return_value_50.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_50.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const _cond_1782 = __wm_return_value_50.args[0][0];
const thenId_1783 = __wm_return_value_50.args[0][1].args[0][0];
const elseId_1784 = __wm_return_value_50.args[0][1].args[0][1].args[0][0];
const __wm_bind_63 = mergeLanePairs_1624__wm_d4(lookupLanes_1487__wm_d2(context_1776, thenId_1783), lookupLanes_1487__wm_d2(context_1776, elseId_1784), withOwn_1779, false);
if (!(__wm_is_tuple(__wm_bind_63) && __wm_bind_63.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const merged_1785 = __wm_bind_63[0];
const pairChanged_1786 = __wm_bind_63[1];
return [merged_1785, __wm_op_or_d2(ownChanged_1780, pairChanged_1786)];
} else if (true) {

return [withOwn_1779, ownChanged_1780];
}
__wm_fail("Match", "non-exhaustive match");
} else {
return [withOwn_1779, ownChanged_1780];
}
} else {
if (__wm_eq(expression_1775.kind, "block")) {
const block_1787 = findBlock_1582__wm_d2(context_1776.blocks, expression_1775.id);
const result_1788 = findExpression_1575__wm_d2(context_1776.expressions, block_1787.resultExprId);
return mergeGroup_1543__wm_d2(__wm_basis_Cons([expressionNode_1471__wm_d2(expression_1775, context_1776), __wm_basis_Cons([expressionNode_1471__wm_d2(result_1788, context_1776), __wm_basis_Nil])]), representations_1777);
} else {
if (__wm_eq(expression_1775.kind, "call")) {
const target_1789 = findFunction_1568__wm_d2(context_1776.functions, expression_1775.functionId);
const body_1790 = findExpression_1575__wm_d2(context_1776.expressions, target_1789.bodyExprId);
const __wm_bind_64 = mergeGroup_1543__wm_d2(__wm_basis_Cons([expressionNode_1471__wm_d2(expression_1775, context_1776), __wm_basis_Cons([expressionNode_1471__wm_d2(body_1790, context_1776), __wm_basis_Nil])]), representations_1777);
if (!(__wm_is_tuple(__wm_bind_64) && __wm_bind_64.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withResult_1791 = __wm_bind_64[0];
const resultChanged_1792 = __wm_bind_64[1];
return mergeArguments_1747__wm_d5(Js.Array.toList(expression_1775.children), Js.Array.toList(target_1789.paramIds), context_1776, withResult_1791, resultChanged_1792);
} else {
return [representations_1777, false];
}
}
}
}
}
}
}
};
const applyExpression_1793 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return applyExpression_1793__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const expressionSweep_1794__wm_d4 = (expressions_1795, context_1796, representations_1797, changed_1798) => {
__wm_tail_96: while (true) {
{
const __wm_scalar_124_0 = expressions_1795;
const __wm_scalar_124_1 = context_1796;
const __wm_scalar_124_2 = representations_1797;
const __wm_scalar_124_3 = changed_1798;
if (__wm_scalar_124_0 === __wm_basis_Nil) {
const context_1799 = __wm_scalar_124_1;
const representations_1800 = __wm_scalar_124_2;
const changed_1801 = __wm_scalar_124_3;
return [representations_1800, changed_1801];
} else if (__wm_scalar_124_0?.ctor === -6 && __wm_scalar_124_0.args.length === 1 && __wm_is_tuple(__wm_scalar_124_0.args[0]) && __wm_scalar_124_0.args[0].length === 2) {
const expression_1802 = __wm_scalar_124_0.args[0][0];
const rest_1803 = __wm_scalar_124_0.args[0][1];
const context_1804 = __wm_scalar_124_1;
const representations_1805 = __wm_scalar_124_2;
const changed_1806 = __wm_scalar_124_3;
{
const __wm_bind_65 = applyExpression_1793__wm_d3(expression_1802, context_1804, representations_1805);
if (!(__wm_is_tuple(__wm_bind_65) && __wm_bind_65.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1807 = __wm_bind_65[0];
const itemChanged_1808 = __wm_bind_65[1];
{
const __wm_tail_arg_113_0 = rest_1803;
const __wm_tail_arg_113_1 = context_1804;
const __wm_tail_arg_113_2 = next_1807;
const __wm_tail_arg_113_3 = __wm_op_or_d2(changed_1806, itemChanged_1808);
expressions_1795 = __wm_tail_arg_113_0;
context_1796 = __wm_tail_arg_113_1;
representations_1797 = __wm_tail_arg_113_2;
changed_1798 = __wm_tail_arg_113_3;
continue __wm_tail_96;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const expressionSweep_1794 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return expressionSweep_1794__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const patternSweep_1809__wm_d4 = (patterns_1811, context_1812, representations_1813, changed_1814) => {
__wm_tail_97: while (true) {
{
const __wm_scalar_125_0 = patterns_1811;
const __wm_scalar_125_1 = context_1812;
const __wm_scalar_125_2 = representations_1813;
const __wm_scalar_125_3 = changed_1814;
if (__wm_scalar_125_0 === __wm_basis_Nil) {
const context_1815 = __wm_scalar_125_1;
const representations_1816 = __wm_scalar_125_2;
const changed_1817 = __wm_scalar_125_3;
return [representations_1816, changed_1817];
} else if (__wm_scalar_125_0?.ctor === -6 && __wm_scalar_125_0.args.length === 1 && __wm_is_tuple(__wm_scalar_125_0.args[0]) && __wm_scalar_125_0.args[0].length === 2) {
const pattern_1818 = __wm_scalar_125_0.args[0][0];
const rest_1819 = __wm_scalar_125_0.args[0][1];
const context_1820 = __wm_scalar_125_1;
const representations_1821 = __wm_scalar_125_2;
const changed_1822 = __wm_scalar_125_3;
{
const childNodes_1823 = mapPatternNodes_1810__wm_d3(Js.Array.toList(pattern_1818.children), context_1820, __wm_basis_Nil);
const own_1824 = patternNode_1478__wm_d2(pattern_1818, context_1820);
const nodes_1825 = (numberEqual_1436__wm_d2(own_1824, __wm_op_sub(1)) ? __wm_basis_Nil : __wm_basis_Cons([own_1824, childNodes_1823]));
const __wm_bind_66 = (__wm_eq(pattern_1818.kind, "tuple") ? mergeGroup_1543__wm_d2(nodes_1825, representations_1821) : [representations_1821, false]);
if (!(__wm_is_tuple(__wm_bind_66) && __wm_bind_66.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1826 = __wm_bind_66[0];
const itemChanged_1827 = __wm_bind_66[1];
{
const __wm_tail_arg_114_0 = rest_1819;
const __wm_tail_arg_114_1 = context_1820;
const __wm_tail_arg_114_2 = next_1826;
const __wm_tail_arg_114_3 = __wm_op_or_d2(changed_1822, itemChanged_1827);
patterns_1811 = __wm_tail_arg_114_0;
context_1812 = __wm_tail_arg_114_1;
representations_1813 = __wm_tail_arg_114_2;
changed_1814 = __wm_tail_arg_114_3;
continue __wm_tail_97;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const patternSweep_1809 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return patternSweep_1809__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const mapPatternNodes_1810__wm_d3 = (ids_1828, context_1829, nodes_1830) => {
__wm_tail_98: while (true) {
{
const __wm_scalar_126_0 = ids_1828;
const __wm_scalar_126_1 = context_1829;
const __wm_scalar_126_2 = nodes_1830;
if (__wm_scalar_126_0 === __wm_basis_Nil) {
const context_1831 = __wm_scalar_126_1;
const nodes_1832 = __wm_scalar_126_2;
return nodes_1832;
} else if (__wm_scalar_126_0?.ctor === -6 && __wm_scalar_126_0.args.length === 1 && __wm_is_tuple(__wm_scalar_126_0.args[0]) && __wm_scalar_126_0.args[0].length === 2) {
const id_1833 = __wm_scalar_126_0.args[0][0];
const rest_1834 = __wm_scalar_126_0.args[0][1];
const context_1835 = __wm_scalar_126_1;
const nodes_1836 = __wm_scalar_126_2;
{
const pattern_1837 = findPattern_1561__wm_d2(context_1835.patterns, id_1833);
const node_1838 = patternNode_1478__wm_d2(pattern_1837, context_1835);
{
const __wm_tail_arg_115_0 = rest_1834;
const __wm_tail_arg_115_1 = context_1835;
const __wm_tail_arg_115_2 = ((node_1838 < 0) ? nodes_1836 : __wm_basis_Cons([node_1838, nodes_1836]));
ids_1828 = __wm_tail_arg_115_0;
context_1829 = __wm_tail_arg_115_1;
nodes_1830 = __wm_tail_arg_115_2;
continue __wm_tail_98;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const mapPatternNodes_1810 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return mapPatternNodes_1810__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const letSweep_1839__wm_d4 = (lets_1840, context_1841, representations_1842, changed_1843) => {
__wm_tail_99: while (true) {
{
const __wm_scalar_127_0 = lets_1840;
const __wm_scalar_127_1 = context_1841;
const __wm_scalar_127_2 = representations_1842;
const __wm_scalar_127_3 = changed_1843;
if (__wm_scalar_127_0 === __wm_basis_Nil) {
const context_1844 = __wm_scalar_127_1;
const representations_1845 = __wm_scalar_127_2;
const changed_1846 = __wm_scalar_127_3;
return [representations_1845, changed_1846];
} else if (__wm_scalar_127_0?.ctor === -6 && __wm_scalar_127_0.args.length === 1 && __wm_is_tuple(__wm_scalar_127_0.args[0]) && __wm_scalar_127_0.args[0].length === 2) {
const binding_1847 = __wm_scalar_127_0.args[0][0];
const rest_1848 = __wm_scalar_127_0.args[0][1];
const context_1849 = __wm_scalar_127_1;
const representations_1850 = __wm_scalar_127_2;
const changed_1851 = __wm_scalar_127_3;
{
const pattern_1852 = findPattern_1561__wm_d2(context_1849.patterns, binding_1847.patternId);
const value_1853 = findExpression_1575__wm_d2(context_1849.expressions, binding_1847.valueExprId);
const __wm_bind_67 = (__wm_eq(pattern_1852.kind, "tuple") ? (() => {
const __wm_bind_68 = mergeGroup_1543__wm_d2(__wm_basis_Cons([patternNode_1478__wm_d2(pattern_1852, context_1849), __wm_basis_Cons([expressionNode_1471__wm_d2(value_1853, context_1849), __wm_basis_Nil])]), representations_1850);
if (!(__wm_is_tuple(__wm_bind_68) && __wm_bind_68.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withSingle_1854 = __wm_bind_68[0];
const singleChanged_1855 = __wm_bind_68[1];
const __wm_bind_69 = mergeLanePairs_1624__wm_d4(patternLaneNodes_1616__wm_d2(Js.Array.toList(pattern_1852.children), context_1849), lookupLanes_1487__wm_d2(context_1849, value_1853.id), withSingle_1854, false);
if (!(__wm_is_tuple(__wm_bind_69) && __wm_bind_69.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const merged_1856 = __wm_bind_69[0];
const lanesChanged_1857 = __wm_bind_69[1];
return [merged_1856, __wm_op_or_d2(singleChanged_1855, lanesChanged_1857)];
})() : mergeGroup_1543__wm_d2(__wm_basis_Cons([patternNode_1478__wm_d2(pattern_1852, context_1849), __wm_basis_Cons([expressionNode_1471__wm_d2(value_1853, context_1849), __wm_basis_Nil])]), representations_1850));
if (!(__wm_is_tuple(__wm_bind_67) && __wm_bind_67.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1858 = __wm_bind_67[0];
const itemChanged_1859 = __wm_bind_67[1];
{
const __wm_tail_arg_116_0 = rest_1848;
const __wm_tail_arg_116_1 = context_1849;
const __wm_tail_arg_116_2 = next_1858;
const __wm_tail_arg_116_3 = __wm_op_or_d2(changed_1851, itemChanged_1859);
lets_1840 = __wm_tail_arg_116_0;
context_1841 = __wm_tail_arg_116_1;
representations_1842 = __wm_tail_arg_116_2;
changed_1843 = __wm_tail_arg_116_3;
continue __wm_tail_99;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const letSweep_1839 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return letSweep_1839__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const seedExpressions_1860__wm_d3 = (expressions_1861, context_1862, representations_1863) => {
__wm_tail_100: while (true) {
{
const __wm_scalar_128_0 = expressions_1861;
const __wm_scalar_128_1 = context_1862;
const __wm_scalar_128_2 = representations_1863;
if (__wm_scalar_128_0 === __wm_basis_Nil) {
const context_1864 = __wm_scalar_128_1;
const representations_1865 = __wm_scalar_128_2;
return representations_1865;
} else if (__wm_scalar_128_0?.ctor === -6 && __wm_scalar_128_0.args.length === 1 && __wm_is_tuple(__wm_scalar_128_0.args[0]) && __wm_scalar_128_0.args[0].length === 2) {
const expression_1866 = __wm_scalar_128_0.args[0][0];
const rest_1867 = __wm_scalar_128_0.args[0][1];
const context_1868 = __wm_scalar_128_1;
const representations_1869 = __wm_scalar_128_2;
{
const explicit_1870 = (__wm_eq(expression_1866.semanticId, "gpu.i32") ? "i32" : (__wm_eq(expression_1866.semanticId, "gpu.f32") ? "f32" : expression_1866.numberKind));
const __wm_bind_70 = setRepresentation_1511__wm_d4(representations_1869, expressionNode_1471__wm_d2(expression_1866, context_1868), explicit_1870, expression_1866.spanId);
if (!(__wm_is_tuple(__wm_bind_70) && __wm_bind_70.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1871 = __wm_bind_70[0];
const _changed_1872 = __wm_bind_70[1];
const withResourceResult_1875 = (__wm_eq(expression_1866.kind, "resource-call") ? (() => {
const __wm_bind_71 = setRepresentation_1511__wm_d4(next_1871, expressionNode_1471__wm_d2(expression_1866, context_1868), "f32", expression_1866.spanId);
if (!(__wm_is_tuple(__wm_bind_71) && __wm_bind_71.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const updated_1873 = __wm_bind_71[0];
const _resourceChanged_1874 = __wm_bind_71[1];
return updated_1873;
})() : next_1871);
const withResourceCoordinate_1886 = (__wm_eq(expression_1866.kind, "resource-call") ? (() => {
const coordinateId_1881 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2 && __v.args[0][1]?.ctor === -6 && __v.args[0][1].args.length === 1 && __wm_is_tuple(__v.args[0][1].args[0]) && __v.args[0][1].args[0].length === 2 && __v.args[0][1].args[0][1]?.ctor === -6 && __v.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__v.args[0][1].args[0][1].args[0]) && __v.args[0][1].args[0][1].args[0].length === 2 && __v.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const _texture_1876 = __v.args[0][0];
const _sampler_1877 = __v.args[0][1].args[0][0];
const id_1878 = __v.args[0][1].args[0][1].args[0][0];
return id_1878;
} else if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2 && __v.args[0][1]?.ctor === -6 && __v.args[0][1].args.length === 1 && __wm_is_tuple(__v.args[0][1].args[0]) && __v.args[0][1].args[0].length === 2 && __v.args[0][1].args[0][1] === __wm_basis_Nil) {
const _texture_1879 = __v.args[0][0];
const id_1880 = __v.args[0][1].args[0][0];
return id_1880;
} else if (true) {

return __wm_fail("Panic", "GPU resource call has invalid coordinate arity");
}
__wm_fail("Match", "non-exhaustive match");
})(Js.Array.toList(expression_1866.children));
const coordinate_1882 = findExpression_1575__wm_d2(context_1868.expressions, coordinateId_1881);
const coordinateRepresentation_1883 = (__wm_eq(expression_1866.resourceOperation, "load") ? "i32" : "f32");
const __wm_bind_72 = setRepresentation_1511__wm_d4(withResourceResult_1875, expressionNode_1471__wm_d2(coordinate_1882, context_1868), coordinateRepresentation_1883, coordinate_1882.spanId);
if (!(__wm_is_tuple(__wm_bind_72) && __wm_bind_72.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const updated_1884 = __wm_bind_72[0];
const _coordinateChanged_1885 = __wm_bind_72[1];
return updated_1884;
})() : withResourceResult_1875);
{
const __wm_tail_arg_117_0 = rest_1867;
const __wm_tail_arg_117_1 = context_1868;
const __wm_tail_arg_117_2 = withResourceCoordinate_1886;
expressions_1861 = __wm_tail_arg_117_0;
context_1862 = __wm_tail_arg_117_1;
representations_1863 = __wm_tail_arg_117_2;
continue __wm_tail_100;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const seedExpressions_1860 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return seedExpressions_1860__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const seedFragmentAbi_1901__wm_d3 = (input_1887, context_1888, representations_1889) => {
const root_1890 = findFunction_1568__wm_d2(context_1888.functions, input_1887.root.functionId);
const firstParamId_1893 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2) {
const id_1891 = __v.args[0][0];
const __1892 = __v.args[0][1];
return id_1891;
} else if (__v === __wm_basis_Nil) {

return __wm_fail("Panic", "fragment root has no coordinate parameter");
}
__wm_fail("Match", "non-exhaustive match");
})(Js.Array.toList(root_1890.paramIds));
const param_1894 = findParam_1554__wm_d2(context_1888.params, firstParamId_1893);
const pattern_1895 = findPattern_1561__wm_d2(context_1888.patterns, param_1894.patternId);
const body_1896 = findExpression_1575__wm_d2(context_1888.expressions, root_1890.bodyExprId);
const __wm_bind_73 = setRepresentation_1511__wm_d4(representations_1889, patternNode_1478__wm_d2(pattern_1895, context_1888), "f32", pattern_1895.spanId);
if (!(__wm_is_tuple(__wm_bind_73) && __wm_bind_73.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withCoord_1897 = __wm_bind_73[0];
const _coordChanged_1898 = __wm_bind_73[1];
const __wm_bind_74 = setRepresentation_1511__wm_d4(withCoord_1897, expressionNode_1471__wm_d2(body_1896, context_1888), "f32", body_1896.spanId);
if (!(__wm_is_tuple(__wm_bind_74) && __wm_bind_74.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withResult_1899 = __wm_bind_74[0];
const _resultChanged_1900 = __wm_bind_74[1];
return withResult_1899;
};
const seedFragmentAbi_1901 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return seedFragmentAbi_1901__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const solveFixedPoint_1902__wm_d2 = (context_1903, representations_1904) => {
__wm_tail_101: while (true) {
{
const __wm_bind_75 = expressionSweep_1794__wm_d4(context_1903.expressions, context_1903, representations_1904, false);
if (!(__wm_is_tuple(__wm_bind_75) && __wm_bind_75.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterExpressions_1905 = __wm_bind_75[0];
const expressionChanged_1906 = __wm_bind_75[1];
const __wm_bind_76 = patternSweep_1809__wm_d4(context_1903.patterns, context_1903, afterExpressions_1905, false);
if (!(__wm_is_tuple(__wm_bind_76) && __wm_bind_76.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterPatterns_1907 = __wm_bind_76[0];
const patternChanged_1908 = __wm_bind_76[1];
const __wm_bind_77 = letSweep_1839__wm_d4(context_1903.lets, context_1903, afterPatterns_1907, false);
if (!(__wm_is_tuple(__wm_bind_77) && __wm_bind_77.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterLets_1909 = __wm_bind_77[0];
const letChanged_1910 = __wm_bind_77[1];
if (__wm_op_or_d2(__wm_op_or_d2(expressionChanged_1906, patternChanged_1908), letChanged_1910)) {
{
const __wm_tail_arg_118_0 = context_1903;
const __wm_tail_arg_118_1 = afterLets_1909;
context_1903 = __wm_tail_arg_118_0;
representations_1904 = __wm_tail_arg_118_1;
continue __wm_tail_101;
}
} else {
return afterLets_1909;
}
}
}
};
const solveFixedPoint_1902 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return solveFixedPoint_1902__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const ensureExpressionsResolved_1911__wm_d3 = (expressions_1912, context_1913, representations_1914) => {
__wm_tail_102: while (true) {
{
const __wm_scalar_129_0 = expressions_1912;
const __wm_scalar_129_1 = context_1913;
const __wm_scalar_129_2 = representations_1914;
if (__wm_scalar_129_0 === __wm_basis_Nil) {
const context_1915 = __wm_scalar_129_1;
const representations_1916 = __wm_scalar_129_2;
return undefined;
} else if (__wm_scalar_129_0?.ctor === -6 && __wm_scalar_129_0.args.length === 1 && __wm_is_tuple(__wm_scalar_129_0.args[0]) && __wm_scalar_129_0.args[0].length === 2) {
const expression_1917 = __wm_scalar_129_0.args[0][0];
const rest_1918 = __wm_scalar_129_0.args[0][1];
const context_1919 = __wm_scalar_129_1;
const representations_1920 = __wm_scalar_129_2;
{
const node_1921 = expressionNode_1471__wm_d2(expression_1917, context_1919);
if (__wm_op_and_d2((node_1921 >= 0), __wm_eq(representation_1497__wm_d2(representations_1920, node_1921), ""))) {
return __wm_fail("Panic", ((("WM_GPU_NUMERIC_UNRESOLVED|" + Text.of(expression_1917.spanId)) + "|expression ") + Text.of(expression_1917.id)));
} else {
{
const __wm_tail_arg_119_0 = rest_1918;
const __wm_tail_arg_119_1 = context_1919;
const __wm_tail_arg_119_2 = representations_1920;
expressions_1912 = __wm_tail_arg_119_0;
context_1913 = __wm_tail_arg_119_1;
representations_1914 = __wm_tail_arg_119_2;
continue __wm_tail_102;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const ensureExpressionsResolved_1911 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return ensureExpressionsResolved_1911__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const ensurePatternsResolved_1922__wm_d3 = (patterns_1923, context_1924, representations_1925) => {
__wm_tail_103: while (true) {
{
const __wm_scalar_130_0 = patterns_1923;
const __wm_scalar_130_1 = context_1924;
const __wm_scalar_130_2 = representations_1925;
if (__wm_scalar_130_0 === __wm_basis_Nil) {
const context_1926 = __wm_scalar_130_1;
const representations_1927 = __wm_scalar_130_2;
return undefined;
} else if (__wm_scalar_130_0?.ctor === -6 && __wm_scalar_130_0.args.length === 1 && __wm_is_tuple(__wm_scalar_130_0.args[0]) && __wm_scalar_130_0.args[0].length === 2) {
const pattern_1928 = __wm_scalar_130_0.args[0][0];
const rest_1929 = __wm_scalar_130_0.args[0][1];
const context_1930 = __wm_scalar_130_1;
const representations_1931 = __wm_scalar_130_2;
{
const node_1932 = patternNode_1478__wm_d2(pattern_1928, context_1930);
if (__wm_op_and_d2((node_1932 >= 0), __wm_eq(representation_1497__wm_d2(representations_1931, node_1932), ""))) {
return __wm_fail("Panic", ((("WM_GPU_NUMERIC_UNRESOLVED|" + Text.of(pattern_1928.spanId)) + "|pattern ") + Text.of(pattern_1928.id)));
} else {
{
const __wm_tail_arg_120_0 = rest_1929;
const __wm_tail_arg_120_1 = context_1930;
const __wm_tail_arg_120_2 = representations_1931;
patterns_1923 = __wm_tail_arg_120_0;
context_1924 = __wm_tail_arg_120_1;
representations_1925 = __wm_tail_arg_120_2;
continue __wm_tail_103;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const ensurePatternsResolved_1922 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return ensurePatternsResolved_1922__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const ensureFieldsResolved_1933__wm_d3 = (fields_1934, context_1935, representations_1936) => {
__wm_tail_104: while (true) {
{
const __wm_scalar_131_0 = fields_1934;
const __wm_scalar_131_1 = context_1935;
const __wm_scalar_131_2 = representations_1936;
if (__wm_scalar_131_0 === __wm_basis_Nil) {
const context_1937 = __wm_scalar_131_1;
const representations_1938 = __wm_scalar_131_2;
return undefined;
} else if (__wm_scalar_131_0?.ctor === -6 && __wm_scalar_131_0.args.length === 1 && __wm_is_tuple(__wm_scalar_131_0.args[0]) && __wm_scalar_131_0.args[0].length === 2) {
const field_1939 = __wm_scalar_131_0.args[0][0];
const rest_1940 = __wm_scalar_131_0.args[0][1];
const context_1941 = __wm_scalar_131_1;
const representations_1942 = __wm_scalar_131_2;
{
const node_1943 = fieldNode_1490__wm_d2(field_1939, context_1941);
if (__wm_op_and_d2((node_1943 >= 0), __wm_eq(representation_1497__wm_d2(representations_1942, node_1943), ""))) {
return __wm_fail("Panic", ((("WM_GPU_NUMERIC_UNRESOLVED|" + Text.of(field_1939.spanId)) + "|environment field ") + field_1939.name));
} else {
{
const __wm_tail_arg_121_0 = rest_1940;
const __wm_tail_arg_121_1 = context_1941;
const __wm_tail_arg_121_2 = representations_1942;
fields_1934 = __wm_tail_arg_121_0;
context_1935 = __wm_tail_arg_121_1;
representations_1936 = __wm_tail_arg_121_2;
continue __wm_tail_104;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const ensureFieldsResolved_1933 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return ensureFieldsResolved_1933__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const solveSliceNumericRepresentations_1952 = (__arg) => {
if (true) {
const input_1944 = __arg;
const expressions_1945 = Js.Array.toList(input_1944.expressions);
const patterns_1946 = Js.Array.toList(input_1944.patterns);
const expressionOffset_1947 = listLength_1437__wm_d2(expressions_1945, 0);
const context_1948 = { expressionOffset: expressionOffset_1947, fieldOffset: (expressionOffset_1947 + listLength_1437__wm_d2(patterns_1946, 0)), types: Js.Array.toList(input_1944.types), expressions: expressions_1945, patterns: patterns_1946, params: Js.Array.toList(input_1944.params), lets: Js.Array.toList(input_1944.lets), blocks: Js.Array.toList(input_1944.blocks), functions: Js.Array.toList(input_1944.functions), environmentFields: Js.Array.toList(input_1944.environmentFields), exprNodes: Map.empty(Map.numberCompare), patternNodes: Map.empty(Map.numberCompare), patternByBinding: Map.empty(Map.numberCompare), lanes: Map.empty(Map.numberCompare) };
const cached_1949 = buildNumericCaches_1729(context_1948);
const seeded_1950 = seedExpressions_1860__wm_d3(expressions_1945, cached_1949, Map.empty(Map.numberCompare));
const solved_1951 = solveFixedPoint_1902__wm_d2(cached_1949, seedFragmentAbi_1901__wm_d3(input_1944, cached_1949, seeded_1950));
ensureExpressionsResolved_1911__wm_d3(expressions_1945, cached_1949, solved_1951);
ensurePatternsResolved_1922__wm_d3(patterns_1946, cached_1949, solved_1951);
ensureFieldsResolved_1933__wm_d3(cached_1949.environmentFields, cached_1949, solved_1951);
return solved_1951;
}
__wm_fail("Match", "pattern match failure in function");
};
const expressionRepresentation_1955__wm_d2 = (representations_1953, expressionId_1954) => {
return representation_1497__wm_d2(representations_1953, expressionId_1954);
};
const expressionRepresentation_1955 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return expressionRepresentation_1955__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const patternRepresentation_1959__wm_d3 = (representations_1956, expressionCount_1957, patternId_1958) => {
return representation_1497__wm_d2(representations_1956, (expressionCount_1957 + patternId_1958));
};
const patternRepresentation_1959 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return patternRepresentation_1959__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
return { "NumericContext": NumericContext_1432, "NumericEvidence": NumericEvidence_1433, "numberEqual": numberEqual_1436, "numberEqual__wm_d2": numberEqual_1436__wm_d2, "listLength": listLength_1437, "listLength__wm_d2": listLength_1437__wm_d2, "findType": findType_1444, "findType__wm_d2": findType_1444__wm_d2, "allNumberTypes": allNumberTypes_1451, "allNumberTypes__wm_d2": allNumberTypes_1451__wm_d2, "numericType": numericType_1464, "numericType__wm_d2": numericType_1464__wm_d2, "computeExpressionNode": computeExpressionNode_1467, "computeExpressionNode__wm_d2": computeExpressionNode_1467__wm_d2, "expressionNode": expressionNode_1471, "expressionNode__wm_d2": expressionNode_1471__wm_d2, "computePatternNode": computePatternNode_1474, "computePatternNode__wm_d2": computePatternNode_1474__wm_d2, "patternNode": patternNode_1478, "patternNode__wm_d2": patternNode_1478__wm_d2, "boundPatternNode": boundPatternNode_1483, "boundPatternNode__wm_d3": boundPatternNode_1483__wm_d3, "lookupLanes": lookupLanes_1487, "lookupLanes__wm_d2": lookupLanes_1487__wm_d2, "fieldNode": fieldNode_1490, "fieldNode__wm_d2": fieldNode_1490__wm_d2, "evidence": evidence_1493, "evidence__wm_d2": evidence_1493__wm_d2, "representation": representation_1497, "representation__wm_d2": representation_1497__wm_d2, "numericConflict": numericConflict_1500, "numericConflict__wm_d2": numericConflict_1500__wm_d2, "setEvidence": setEvidence_1505, "setEvidence__wm_d3": setEvidence_1505__wm_d3, "setRepresentation": setRepresentation_1511, "setRepresentation__wm_d4": setRepresentation_1511__wm_d4, "combinedEvidence": combinedEvidence_1512, "combinedEvidence__wm_d3": combinedEvidence_1512__wm_d3, "setGroup": setGroup_1524, "setGroup__wm_d4": setGroup_1524__wm_d4, "mergeGroup": mergeGroup_1543, "mergeGroup__wm_d2": mergeGroup_1543__wm_d2, "findPatternByBinding": findPatternByBinding_1544, "findPatternByBinding__wm_d3": findPatternByBinding_1544__wm_d3, "findParam": findParam_1554, "findParam__wm_d2": findParam_1554__wm_d2, "findPattern": findPattern_1561, "findPattern__wm_d2": findPattern_1561__wm_d2, "findFunction": findFunction_1568, "findFunction__wm_d2": findFunction_1568__wm_d2, "findExpression": findExpression_1575, "findExpression__wm_d2": findExpression_1575__wm_d2, "findBlock": findBlock_1582, "findBlock__wm_d2": findBlock_1582__wm_d2, "findEnvironmentField": findEnvironmentField_1589, "findEnvironmentField__wm_d2": findEnvironmentField_1589__wm_d2, "laneContains": laneContains_1596, "laneContains__wm_d2": laneContains_1596__wm_d2, "childLaneNodes": childLaneNodes_1603, "childLaneNodes__wm_d2": childLaneNodes_1603__wm_d2, "lookupMemoLanes": lookupMemoLanes_1615, "lookupMemoLanes__wm_d2": lookupMemoLanes_1615__wm_d2, "patternLaneNodes": patternLaneNodes_1616, "patternLaneNodes__wm_d2": patternLaneNodes_1616__wm_d2, "mergeLanePairs": mergeLanePairs_1624, "mergeLanePairs__wm_d4": mergeLanePairs_1624__wm_d4, "findLetForPattern": findLetForPattern_1641, "findLetForPattern__wm_d2": findLetForPattern_1641__wm_d2, "laneForMemo": laneForMemo_1648, "laneForMemo__wm_d6": laneForMemo_1648__wm_d6, "laneForUncached": laneForUncached_1649, "laneForUncached__wm_d6": laneForUncached_1649__wm_d6, "foldExprNodes": foldExprNodes_1679, "foldExprNodes__wm_d3": foldExprNodes_1679__wm_d3, "foldPatternNodes": foldPatternNodes_1689, "foldPatternNodes__wm_d3": foldPatternNodes_1689__wm_d3, "foldPatternBindings": foldPatternBindings_1699, "foldPatternBindings__wm_d3": foldPatternBindings_1699__wm_d3, "buildAllLanes": buildAllLanes_1711, "buildAllLanes__wm_d4": buildAllLanes_1711__wm_d4, "buildNumericCaches": buildNumericCaches_1729, "numericChildNodes": numericChildNodes_1730, "numericChildNodes__wm_d3": numericChildNodes_1730__wm_d3, "ownAndChildren": ownAndChildren_1746, "ownAndChildren__wm_d2": ownAndChildren_1746__wm_d2, "mergeArguments": mergeArguments_1747, "mergeArguments__wm_d5": mergeArguments_1747__wm_d5, "applyExpression": applyExpression_1793, "applyExpression__wm_d3": applyExpression_1793__wm_d3, "expressionSweep": expressionSweep_1794, "expressionSweep__wm_d4": expressionSweep_1794__wm_d4, "patternSweep": patternSweep_1809, "patternSweep__wm_d4": patternSweep_1809__wm_d4, "mapPatternNodes": mapPatternNodes_1810, "mapPatternNodes__wm_d3": mapPatternNodes_1810__wm_d3, "letSweep": letSweep_1839, "letSweep__wm_d4": letSweep_1839__wm_d4, "seedExpressions": seedExpressions_1860, "seedExpressions__wm_d3": seedExpressions_1860__wm_d3, "seedFragmentAbi": seedFragmentAbi_1901, "seedFragmentAbi__wm_d3": seedFragmentAbi_1901__wm_d3, "solveFixedPoint": solveFixedPoint_1902, "solveFixedPoint__wm_d2": solveFixedPoint_1902__wm_d2, "ensureExpressionsResolved": ensureExpressionsResolved_1911, "ensureExpressionsResolved__wm_d3": ensureExpressionsResolved_1911__wm_d3, "ensurePatternsResolved": ensurePatternsResolved_1922, "ensurePatternsResolved__wm_d3": ensurePatternsResolved_1922__wm_d3, "ensureFieldsResolved": ensureFieldsResolved_1933, "ensureFieldsResolved__wm_d3": ensureFieldsResolved_1933__wm_d3, "solveSliceNumericRepresentations": solveSliceNumericRepresentations_1952, "expressionRepresentation": expressionRepresentation_1955, "expressionRepresentation__wm_d2": expressionRepresentation_1955__wm_d2, "patternRepresentation": patternRepresentation_1959, "patternRepresentation__wm_d3": patternRepresentation_1959__wm_d3 };
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
const buildSliceLayouts_140 = __wm_module_1["buildSliceLayouts"];
const lowerSliceProgram_891 = __wm_module_3["lowerSliceProgram"];
const lowerSliceProgram_891__wm_d8 = __wm_module_3["lowerSliceProgram__wm_d8"];
const emitSliceCallableName_1419 = __wm_module_4["emitSliceCallableName"];
const emitSliceSlang_1431 = __wm_module_4["emitSliceSlang"];
const emitSliceSlang_1431__wm_d10 = __wm_module_4["emitSliceSlang__wm_d10"];
const emitSliceSlangModule_1417 = __wm_module_4["emitSliceSlangModule"];
const emitSliceSlangModule_1417__wm_d10 = __wm_module_4["emitSliceSlangModule__wm_d10"];
const NumericEvidence_1433 = __wm_module_5["NumericEvidence"];
const expressionRepresentation_1955 = __wm_module_5["expressionRepresentation"];
const expressionRepresentation_1955__wm_d2 = __wm_module_5["expressionRepresentation__wm_d2"];
const patternRepresentation_1959 = __wm_module_5["patternRepresentation"];
const patternRepresentation_1959__wm_d3 = __wm_module_5["patternRepresentation__wm_d3"];
const solveSliceNumericRepresentations_1952 = __wm_module_5["solveSliceNumericRepresentations"];
const SliceContext_1960 = (__record_args) => ({ expressions: __record_args[0], blocks: __record_args[1], blockItems: __record_args[2], lets: __record_args[3], matches: __record_args[4], matchArms: __record_args[5], patterns: __record_args[6], types: __record_args[7], adts: __record_args[8], functions: __record_args[9], builtinOverloads: __record_args[10], occurrences: __record_args[11] });
const SliceIrState_1961 = (__record_args) => ({ nextExpressionId: __record_args[0], nextArmId: __record_args[1], functions: __record_args[2], expressions: __record_args[3], matchArms: __record_args[4], diagnostics: __record_args[5] });
const BuiltBlockItem_1962 = (__record_args) => ({ itemId: __record_args[0], valueExprId: __record_args[1] });
const reverseInto_1963__wm_d2 = (items_1964, reversed_1965) => {
__wm_tail_105: while (true) {
{
const __wm_scalar_132_0 = items_1964;
const __wm_scalar_132_1 = reversed_1965;
if (__wm_scalar_132_0 === __wm_basis_Nil) {
const reversed_1966 = __wm_scalar_132_1;
return reversed_1966;
} else if (__wm_scalar_132_0?.ctor === -6 && __wm_scalar_132_0.args.length === 1 && __wm_is_tuple(__wm_scalar_132_0.args[0]) && __wm_scalar_132_0.args[0].length === 2) {
const head_1967 = __wm_scalar_132_0.args[0][0];
const rest_1968 = __wm_scalar_132_0.args[0][1];
const reversed_1969 = __wm_scalar_132_1;
{
const __wm_tail_arg_122_0 = rest_1968;
const __wm_tail_arg_122_1 = __wm_basis_Cons([head_1967, reversed_1969]);
items_1964 = __wm_tail_arg_122_0;
reversed_1965 = __wm_tail_arg_122_1;
continue __wm_tail_105;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reverseInto_1963 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reverseInto_1963__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const append_1970__wm_d2 = (left_1971, right_1972) => {
const __wm_scalar_133_0 = left_1971;
const __wm_scalar_133_1 = right_1972;
if (__wm_scalar_133_0 === __wm_basis_Nil) {
const right_1973 = __wm_scalar_133_1;
return right_1973;
} else if (__wm_scalar_133_0?.ctor === -6 && __wm_scalar_133_0.args.length === 1 && __wm_is_tuple(__wm_scalar_133_0.args[0]) && __wm_scalar_133_0.args[0].length === 2) {
const head_1974 = __wm_scalar_133_0.args[0][0];
const rest_1975 = __wm_scalar_133_0.args[0][1];
const right_1976 = __wm_scalar_133_1;
return __wm_basis_Cons([head_1974, append_1970__wm_d2(rest_1975, right_1976)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const append_1970 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return append_1970__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const listLength_1977__wm_d2 = (items_1978, length_1979) => {
__wm_tail_106: while (true) {
{
const __wm_scalar_134_0 = items_1978;
const __wm_scalar_134_1 = length_1979;
if (__wm_scalar_134_0 === __wm_basis_Nil) {
const length_1980 = __wm_scalar_134_1;
return length_1980;
} else if (__wm_scalar_134_0?.ctor === -6 && __wm_scalar_134_0.args.length === 1 && __wm_is_tuple(__wm_scalar_134_0.args[0]) && __wm_scalar_134_0.args[0].length === 2) {
const __1981 = __wm_scalar_134_0.args[0][0];
const rest_1982 = __wm_scalar_134_0.args[0][1];
const length_1983 = __wm_scalar_134_1;
{
const __wm_tail_arg_123_0 = rest_1982;
const __wm_tail_arg_123_1 = (length_1983 + 1);
items_1978 = __wm_tail_arg_123_0;
length_1979 = __wm_tail_arg_123_1;
continue __wm_tail_106;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const listLength_1977 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return listLength_1977__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const numberEqual_1986__wm_d2 = (left_1984, right_1985) => {
return __wm_op_and_d2(__wm_op_not((left_1984 < right_1985)), __wm_op_not((left_1984 > right_1985)));
};
const numberEqual_1986 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numberEqual_1986__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const contains_1987__wm_d2 = (items_1988, expected_1989) => {
__wm_tail_107: while (true) {
{
const __wm_tail_value_124 = items_1988;
if (__wm_tail_value_124 === __wm_basis_Nil) {

return false;
} else if (__wm_tail_value_124?.ctor === -6 && __wm_tail_value_124.args.length === 1 && __wm_is_tuple(__wm_tail_value_124.args[0]) && __wm_tail_value_124.args[0].length === 2) {
const head_1990 = __wm_tail_value_124.args[0][0];
const rest_1991 = __wm_tail_value_124.args[0][1];
if (numberEqual_1986__wm_d2(head_1990, expected_1989)) {
return true;
} else {
{
const __wm_tail_arg_125_0 = rest_1991;
const __wm_tail_arg_125_1 = expected_1989;
items_1988 = __wm_tail_arg_125_0;
expected_1989 = __wm_tail_arg_125_1;
continue __wm_tail_107;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const contains_1987 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return contains_1987__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const unique_1992__wm_d2 = (items_1993, seen_1994) => {
__wm_tail_108: while (true) {
{
const __wm_tail_value_126 = items_1993;
if (__wm_tail_value_126 === __wm_basis_Nil) {

return true;
} else if (__wm_tail_value_126?.ctor === -6 && __wm_tail_value_126.args.length === 1 && __wm_is_tuple(__wm_tail_value_126.args[0]) && __wm_tail_value_126.args[0].length === 2) {
const head_1995 = __wm_tail_value_126.args[0][0];
const rest_1996 = __wm_tail_value_126.args[0][1];
if (contains_1987__wm_d2(seen_1994, head_1995)) {
return false;
} else {
{
const __wm_tail_arg_127_0 = rest_1996;
const __wm_tail_arg_127_1 = __wm_basis_Cons([head_1995, seen_1994]);
items_1993 = __wm_tail_arg_127_0;
seen_1994 = __wm_tail_arg_127_1;
continue __wm_tail_108;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const unique_1992 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return unique_1992__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findExpression_1997__wm_d2 = (items_1998, id_1999) => {
__wm_tail_109: while (true) {
{
const __wm_scalar_135_0 = items_1998;
const __wm_scalar_135_1 = id_1999;
if (__wm_scalar_135_0 === __wm_basis_Nil) {
const id_2000 = __wm_scalar_135_1;
return __wm_fail("Panic", "missing schema-v2 expression");
} else if (__wm_scalar_135_0?.ctor === -6 && __wm_scalar_135_0.args.length === 1 && __wm_is_tuple(__wm_scalar_135_0.args[0]) && __wm_scalar_135_0.args[0].length === 2) {
const item_2001 = __wm_scalar_135_0.args[0][0];
const rest_2002 = __wm_scalar_135_0.args[0][1];
const id_2003 = __wm_scalar_135_1;
if (numberEqual_1986__wm_d2(item_2001.id, id_2003)) {
return item_2001;
} else {
{
const __wm_tail_arg_128_0 = rest_2002;
const __wm_tail_arg_128_1 = id_2003;
items_1998 = __wm_tail_arg_128_0;
id_1999 = __wm_tail_arg_128_1;
continue __wm_tail_109;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findExpression_1997 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findExpression_1997__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findBlock_2004__wm_d2 = (items_2005, expressionId_2006) => {
__wm_tail_110: while (true) {
{
const __wm_scalar_136_0 = items_2005;
const __wm_scalar_136_1 = expressionId_2006;
if (__wm_scalar_136_0 === __wm_basis_Nil) {
const expressionId_2007 = __wm_scalar_136_1;
return __wm_fail("Panic", "missing schema-v2 block");
} else if (__wm_scalar_136_0?.ctor === -6 && __wm_scalar_136_0.args.length === 1 && __wm_is_tuple(__wm_scalar_136_0.args[0]) && __wm_scalar_136_0.args[0].length === 2) {
const item_2008 = __wm_scalar_136_0.args[0][0];
const rest_2009 = __wm_scalar_136_0.args[0][1];
const expressionId_2010 = __wm_scalar_136_1;
if (numberEqual_1986__wm_d2(item_2008.expressionId, expressionId_2010)) {
return item_2008;
} else {
{
const __wm_tail_arg_129_0 = rest_2009;
const __wm_tail_arg_129_1 = expressionId_2010;
items_2005 = __wm_tail_arg_129_0;
expressionId_2006 = __wm_tail_arg_129_1;
continue __wm_tail_110;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findBlock_2004 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findBlock_2004__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findBlockItem_2011__wm_d2 = (items_2012, id_2013) => {
__wm_tail_111: while (true) {
{
const __wm_scalar_137_0 = items_2012;
const __wm_scalar_137_1 = id_2013;
if (__wm_scalar_137_0 === __wm_basis_Nil) {
const id_2014 = __wm_scalar_137_1;
return __wm_fail("Panic", "missing schema-v2 block item");
} else if (__wm_scalar_137_0?.ctor === -6 && __wm_scalar_137_0.args.length === 1 && __wm_is_tuple(__wm_scalar_137_0.args[0]) && __wm_scalar_137_0.args[0].length === 2) {
const item_2015 = __wm_scalar_137_0.args[0][0];
const rest_2016 = __wm_scalar_137_0.args[0][1];
const id_2017 = __wm_scalar_137_1;
if (numberEqual_1986__wm_d2(item_2015.id, id_2017)) {
return item_2015;
} else {
{
const __wm_tail_arg_130_0 = rest_2016;
const __wm_tail_arg_130_1 = id_2017;
items_2012 = __wm_tail_arg_130_0;
id_2013 = __wm_tail_arg_130_1;
continue __wm_tail_111;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findBlockItem_2011 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findBlockItem_2011__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLet_2018__wm_d2 = (items_2019, id_2020) => {
__wm_tail_112: while (true) {
{
const __wm_scalar_138_0 = items_2019;
const __wm_scalar_138_1 = id_2020;
if (__wm_scalar_138_0 === __wm_basis_Nil) {
const id_2021 = __wm_scalar_138_1;
return __wm_fail("Panic", "missing schema-v2 let");
} else if (__wm_scalar_138_0?.ctor === -6 && __wm_scalar_138_0.args.length === 1 && __wm_is_tuple(__wm_scalar_138_0.args[0]) && __wm_scalar_138_0.args[0].length === 2) {
const item_2022 = __wm_scalar_138_0.args[0][0];
const rest_2023 = __wm_scalar_138_0.args[0][1];
const id_2024 = __wm_scalar_138_1;
if (numberEqual_1986__wm_d2(item_2022.id, id_2024)) {
return item_2022;
} else {
{
const __wm_tail_arg_131_0 = rest_2023;
const __wm_tail_arg_131_1 = id_2024;
items_2019 = __wm_tail_arg_131_0;
id_2020 = __wm_tail_arg_131_1;
continue __wm_tail_112;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLet_2018 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLet_2018__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findMatch_2025__wm_d2 = (items_2026, expressionId_2027) => {
__wm_tail_113: while (true) {
{
const __wm_scalar_139_0 = items_2026;
const __wm_scalar_139_1 = expressionId_2027;
if (__wm_scalar_139_0 === __wm_basis_Nil) {
const expressionId_2028 = __wm_scalar_139_1;
return __wm_fail("Panic", "missing schema-v2 match");
} else if (__wm_scalar_139_0?.ctor === -6 && __wm_scalar_139_0.args.length === 1 && __wm_is_tuple(__wm_scalar_139_0.args[0]) && __wm_scalar_139_0.args[0].length === 2) {
const item_2029 = __wm_scalar_139_0.args[0][0];
const rest_2030 = __wm_scalar_139_0.args[0][1];
const expressionId_2031 = __wm_scalar_139_1;
if (numberEqual_1986__wm_d2(item_2029.expressionId, expressionId_2031)) {
return item_2029;
} else {
{
const __wm_tail_arg_132_0 = rest_2030;
const __wm_tail_arg_132_1 = expressionId_2031;
items_2026 = __wm_tail_arg_132_0;
expressionId_2027 = __wm_tail_arg_132_1;
continue __wm_tail_113;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findMatch_2025 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findMatch_2025__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findMatchArm_2032__wm_d2 = (items_2033, id_2034) => {
__wm_tail_114: while (true) {
{
const __wm_scalar_140_0 = items_2033;
const __wm_scalar_140_1 = id_2034;
if (__wm_scalar_140_0 === __wm_basis_Nil) {
const id_2035 = __wm_scalar_140_1;
return __wm_fail("Panic", "missing schema-v2 match arm");
} else if (__wm_scalar_140_0?.ctor === -6 && __wm_scalar_140_0.args.length === 1 && __wm_is_tuple(__wm_scalar_140_0.args[0]) && __wm_scalar_140_0.args[0].length === 2) {
const item_2036 = __wm_scalar_140_0.args[0][0];
const rest_2037 = __wm_scalar_140_0.args[0][1];
const id_2038 = __wm_scalar_140_1;
if (numberEqual_1986__wm_d2(item_2036.id, id_2038)) {
return item_2036;
} else {
{
const __wm_tail_arg_133_0 = rest_2037;
const __wm_tail_arg_133_1 = id_2038;
items_2033 = __wm_tail_arg_133_0;
id_2034 = __wm_tail_arg_133_1;
continue __wm_tail_114;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findMatchArm_2032 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findMatchArm_2032__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findPattern_2039__wm_d2 = (items_2040, id_2041) => {
__wm_tail_115: while (true) {
{
const __wm_scalar_141_0 = items_2040;
const __wm_scalar_141_1 = id_2041;
if (__wm_scalar_141_0 === __wm_basis_Nil) {
const id_2042 = __wm_scalar_141_1;
return __wm_fail("Panic", "missing schema-v2 pattern");
} else if (__wm_scalar_141_0?.ctor === -6 && __wm_scalar_141_0.args.length === 1 && __wm_is_tuple(__wm_scalar_141_0.args[0]) && __wm_scalar_141_0.args[0].length === 2) {
const item_2043 = __wm_scalar_141_0.args[0][0];
const rest_2044 = __wm_scalar_141_0.args[0][1];
const id_2045 = __wm_scalar_141_1;
if (numberEqual_1986__wm_d2(item_2043.id, id_2045)) {
return item_2043;
} else {
{
const __wm_tail_arg_134_0 = rest_2044;
const __wm_tail_arg_134_1 = id_2045;
items_2040 = __wm_tail_arg_134_0;
id_2041 = __wm_tail_arg_134_1;
continue __wm_tail_115;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findPattern_2039 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findPattern_2039__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findType_2046__wm_d2 = (items_2047, id_2048) => {
__wm_tail_116: while (true) {
{
const __wm_scalar_142_0 = items_2047;
const __wm_scalar_142_1 = id_2048;
if (__wm_scalar_142_0 === __wm_basis_Nil) {
const id_2049 = __wm_scalar_142_1;
return __wm_fail("Panic", "missing schema-v2 type");
} else if (__wm_scalar_142_0?.ctor === -6 && __wm_scalar_142_0.args.length === 1 && __wm_is_tuple(__wm_scalar_142_0.args[0]) && __wm_scalar_142_0.args[0].length === 2) {
const item_2050 = __wm_scalar_142_0.args[0][0];
const rest_2051 = __wm_scalar_142_0.args[0][1];
const id_2052 = __wm_scalar_142_1;
if (numberEqual_1986__wm_d2(item_2050.id, id_2052)) {
return item_2050;
} else {
{
const __wm_tail_arg_135_0 = rest_2051;
const __wm_tail_arg_135_1 = id_2052;
items_2047 = __wm_tail_arg_135_0;
id_2048 = __wm_tail_arg_135_1;
continue __wm_tail_116;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findType_2046 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findType_2046__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findExpressionOccurrence_2053__wm_d2 = (items_2054, sourceId_2055) => {
__wm_tail_117: while (true) {
{
const __wm_scalar_143_0 = items_2054;
const __wm_scalar_143_1 = sourceId_2055;
if (__wm_scalar_143_0 === __wm_basis_Nil) {
const sourceId_2056 = __wm_scalar_143_1;
return __wm_fail("Panic", "missing schema-v2 expression type occurrence");
} else if (__wm_scalar_143_0?.ctor === -6 && __wm_scalar_143_0.args.length === 1 && __wm_is_tuple(__wm_scalar_143_0.args[0]) && __wm_scalar_143_0.args[0].length === 2) {
const item_2057 = __wm_scalar_143_0.args[0][0];
const rest_2058 = __wm_scalar_143_0.args[0][1];
const sourceId_2059 = __wm_scalar_143_1;
if (__wm_op_and_d2(__wm_eq(item_2057.kind, "expression"), numberEqual_1986__wm_d2(item_2057.sourceId, sourceId_2059))) {
return item_2057;
} else {
{
const __wm_tail_arg_136_0 = rest_2058;
const __wm_tail_arg_136_1 = sourceId_2059;
items_2054 = __wm_tail_arg_136_0;
sourceId_2055 = __wm_tail_arg_136_1;
continue __wm_tail_117;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findExpressionOccurrence_2053 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findExpressionOccurrence_2053__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const shaderBuiltinTypeName_2070__wm_d2 = (source_2060, context_2061) => {
const occurrence_2062 = findExpressionOccurrence_2053__wm_d2(context_2061.occurrences, source_2060.id);
const typeId_2063 = occurrence_2062.shaderTypeId;
const gpuType_2064 = findType_2046__wm_d2(context_2061.types, typeId_2063);
if (__wm_eq(gpuType_2064.kind, "f32")) {
return "f32";
} else {
if (__wm_eq(gpuType_2064.kind, "i32")) {
return "i32";
} else {
if (__wm_eq(gpuType_2064.kind, "vector")) {
const items_2065 = Js.Array.toList(gpuType_2064.items);
const component_2068 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2) {
const first_2066 = __v.args[0][0];
const __2067 = __v.args[0][1];
return findType_2046__wm_d2(context_2061.types, first_2066);
} else if (__v === __wm_basis_Nil) {

return __wm_fail("Panic", "GPU builtin vector type is empty");
}
__wm_fail("Match", "non-exhaustive match");
})(items_2065);
const prefix_2069 = (__wm_eq(component_2068.kind, "i32") ? "i32x" : "f32x");
return (prefix_2069 + Text.of(listLength_1977__wm_d2(items_2065, 0)));
} else {
return "";
}
}
}
};
const shaderBuiltinTypeName_2070 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return shaderBuiltinTypeName_2070__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const builtinParamsMatch_2071__wm_d3 = (expected_2072, sourceIds_2073, context_2074) => {
const __wm_scalar_144_0 = expected_2072;
const __wm_scalar_144_1 = sourceIds_2073;
const __wm_scalar_144_2 = context_2074;
if (__wm_scalar_144_0 === __wm_basis_Nil && __wm_scalar_144_1 === __wm_basis_Nil) {
const context_2075 = __wm_scalar_144_2;
return true;
} else if (__wm_scalar_144_0?.ctor === -6 && __wm_scalar_144_0.args.length === 1 && __wm_is_tuple(__wm_scalar_144_0.args[0]) && __wm_scalar_144_0.args[0].length === 2 && __wm_scalar_144_1?.ctor === -6 && __wm_scalar_144_1.args.length === 1 && __wm_is_tuple(__wm_scalar_144_1.args[0]) && __wm_scalar_144_1.args[0].length === 2) {
const expectedType_2076 = __wm_scalar_144_0.args[0][0];
const expectedRest_2077 = __wm_scalar_144_0.args[0][1];
const sourceId_2078 = __wm_scalar_144_1.args[0][0];
const sourceRest_2079 = __wm_scalar_144_1.args[0][1];
const context_2080 = __wm_scalar_144_2;
const source_2081 = findExpression_1997__wm_d2(context_2080.expressions, sourceId_2078);
return __wm_op_and_d2(__wm_eq(expectedType_2076, shaderBuiltinTypeName_2070__wm_d2(source_2081, context_2080)), builtinParamsMatch_2071__wm_d3(expectedRest_2077, sourceRest_2079, context_2080));
} else if (true) {
const context_2082 = __wm_scalar_144_2;
return false;
}
__wm_fail("Match", "non-exhaustive match");
};
const builtinParamsMatch_2071 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return builtinParamsMatch_2071__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const selectBuiltinOverload_2083__wm_d3 = (overloads_2084, source_2085, context_2086) => {
__wm_tail_118: while (true) {
{
const __wm_scalar_145_0 = overloads_2084;
const __wm_scalar_145_1 = source_2085;
const __wm_scalar_145_2 = context_2086;
if (__wm_scalar_145_0 === __wm_basis_Nil) {
const source_2087 = __wm_scalar_145_1;
const context_2088 = __wm_scalar_145_2;
return __wm_fail("Panic", "no exact pinned Slang builtin overload survived Workman GPU elaboration");
} else if (__wm_scalar_145_0?.ctor === -6 && __wm_scalar_145_0.args.length === 1 && __wm_is_tuple(__wm_scalar_145_0.args[0]) && __wm_scalar_145_0.args[0].length === 2) {
const overload_2089 = __wm_scalar_145_0.args[0][0];
const rest_2090 = __wm_scalar_145_0.args[0][1];
const source_2091 = __wm_scalar_145_1;
const context_2092 = __wm_scalar_145_2;
if (__wm_op_and_d2(__wm_op_and_d2(__wm_eq(overload_2089.name, source_2091.builtinName), __wm_eq(overload_2089.result, shaderBuiltinTypeName_2070__wm_d2(source_2091, context_2092))), builtinParamsMatch_2071__wm_d3(Js.Array.toList(overload_2089.params), Js.Array.toList(source_2091.children), context_2092))) {
return overload_2089.id;
} else {
{
const __wm_tail_arg_137_0 = rest_2090;
const __wm_tail_arg_137_1 = source_2091;
const __wm_tail_arg_137_2 = context_2092;
overloads_2084 = __wm_tail_arg_137_0;
source_2085 = __wm_tail_arg_137_1;
context_2086 = __wm_tail_arg_137_2;
continue __wm_tail_118;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const selectBuiltinOverload_2083 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return selectBuiltinOverload_2083__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const collectBuiltinSelections_2093__wm_d3 = (expressions_2094, context_2095, selections_2096) => {
__wm_tail_119: while (true) {
{
const __wm_scalar_146_0 = expressions_2094;
const __wm_scalar_146_1 = context_2095;
const __wm_scalar_146_2 = selections_2096;
if (__wm_scalar_146_0 === __wm_basis_Nil) {
const context_2097 = __wm_scalar_146_1;
const selections_2098 = __wm_scalar_146_2;
return reverseInto_1963__wm_d2(selections_2098, __wm_basis_Nil);
} else if (__wm_scalar_146_0?.ctor === -6 && __wm_scalar_146_0.args.length === 1 && __wm_is_tuple(__wm_scalar_146_0.args[0]) && __wm_scalar_146_0.args[0].length === 2) {
const expression_2099 = __wm_scalar_146_0.args[0][0];
const rest_2100 = __wm_scalar_146_0.args[0][1];
const context_2101 = __wm_scalar_146_1;
const selections_2102 = __wm_scalar_146_2;
if (__wm_eq(expression_2099.kind, "builtin")) {
{
const selection_2103 = { expressionId: expression_2099.id, overloadId: selectBuiltinOverload_2083__wm_d3(context_2101.builtinOverloads, expression_2099, context_2101) };
{
const __wm_tail_arg_138_0 = rest_2100;
const __wm_tail_arg_138_1 = context_2101;
const __wm_tail_arg_138_2 = __wm_basis_Cons([selection_2103, selections_2102]);
expressions_2094 = __wm_tail_arg_138_0;
context_2095 = __wm_tail_arg_138_1;
selections_2096 = __wm_tail_arg_138_2;
continue __wm_tail_119;
}
}
} else {
{
const __wm_tail_arg_139_0 = rest_2100;
const __wm_tail_arg_139_1 = context_2101;
const __wm_tail_arg_139_2 = selections_2102;
expressions_2094 = __wm_tail_arg_139_0;
context_2095 = __wm_tail_arg_139_1;
selections_2096 = __wm_tail_arg_139_2;
continue __wm_tail_119;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const collectBuiltinSelections_2093 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return collectBuiltinSelections_2093__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const allSemanticNumbers_2104__wm_d2 = (typeIds_2105, types_2106) => {
const __wm_scalar_147_0 = typeIds_2105;
const __wm_scalar_147_1 = types_2106;
if (__wm_scalar_147_0 === __wm_basis_Nil) {
const types_2107 = __wm_scalar_147_1;
return true;
} else if (__wm_scalar_147_0?.ctor === -6 && __wm_scalar_147_0.args.length === 1 && __wm_is_tuple(__wm_scalar_147_0.args[0]) && __wm_scalar_147_0.args[0].length === 2) {
const typeId_2108 = __wm_scalar_147_0.args[0][0];
const rest_2109 = __wm_scalar_147_0.args[0][1];
const types_2110 = __wm_scalar_147_1;
const gpuType_2111 = findType_2046__wm_d2(types_2110, typeId_2108);
return __wm_op_and_d2(__wm_eq(gpuType_2111.kind, "number"), allSemanticNumbers_2104__wm_d2(rest_2109, types_2110));
}
__wm_fail("Match", "non-exhaustive match");
};
const allSemanticNumbers_2104 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return allSemanticNumbers_2104__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const shaderTypeKind_2116__wm_d2 = (source_2112, types_2113) => {
if (__wm_eq(source_2112.kind, "number")) {
return "f32";
} else {
if (__wm_eq(source_2112.kind, "tuple")) {
const items_2114 = Js.Array.toList(source_2112.items);
const width_2115 = listLength_1977__wm_d2(items_2114, 0);
if (__wm_op_and_d2(__wm_op_and_d2((width_2115 >= 2), (width_2115 <= 4)), allSemanticNumbers_2104__wm_d2(items_2114, types_2113))) {
return "vector";
} else {
return "tuple";
}
} else {
return source_2112.kind;
}
}
};
const shaderTypeKind_2116 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return shaderTypeKind_2116__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const shaderTypeReason_2119__wm_d2 = (semanticKind_2117, shaderKind_2118) => {
if (__wm_eq(semanticKind_2117, "number")) {
return "shader-number-f32";
} else {
if (__wm_eq(semanticKind_2117, "tuple")) {
if (__wm_eq(shaderKind_2118, "vector")) {
return "homogeneous-numeric-tuple-default";
} else {
return "semantic-product";
}
} else {
return "semantic-shape";
}
}
};
const shaderTypeReason_2119 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return shaderTypeReason_2119__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const offsetTypeIds_2120__wm_d3 = (typeIds_2121, offset_2122, output_2123) => {
__wm_tail_120: while (true) {
{
const __wm_scalar_148_0 = typeIds_2121;
const __wm_scalar_148_1 = offset_2122;
const __wm_scalar_148_2 = output_2123;
if (__wm_scalar_148_0 === __wm_basis_Nil) {
const offset_2124 = __wm_scalar_148_1;
const output_2125 = __wm_scalar_148_2;
return reverseInto_1963__wm_d2(output_2125, __wm_basis_Nil);
} else if (__wm_scalar_148_0?.ctor === -6 && __wm_scalar_148_0.args.length === 1 && __wm_is_tuple(__wm_scalar_148_0.args[0]) && __wm_scalar_148_0.args[0].length === 2) {
const typeId_2126 = __wm_scalar_148_0.args[0][0];
const rest_2127 = __wm_scalar_148_0.args[0][1];
const offset_2128 = __wm_scalar_148_1;
const output_2129 = __wm_scalar_148_2;
{
const __wm_tail_arg_140_0 = rest_2127;
const __wm_tail_arg_140_1 = offset_2128;
const __wm_tail_arg_140_2 = __wm_basis_Cons([(offset_2128 + typeId_2126), output_2129]);
typeIds_2121 = __wm_tail_arg_140_0;
offset_2122 = __wm_tail_arg_140_1;
output_2123 = __wm_tail_arg_140_2;
continue __wm_tail_120;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const offsetTypeIds_2120 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return offsetTypeIds_2120__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const addI32ShaderTypes_2130__wm_d4 = (sourceTypes_2131, allTypes_2132, offset_2133, output_2134) => {
__wm_tail_121: while (true) {
{
const __wm_scalar_149_0 = sourceTypes_2131;
const __wm_scalar_149_1 = allTypes_2132;
const __wm_scalar_149_2 = offset_2133;
const __wm_scalar_149_3 = output_2134;
if (__wm_scalar_149_0 === __wm_basis_Nil) {
const allTypes_2135 = __wm_scalar_149_1;
const offset_2136 = __wm_scalar_149_2;
const output_2137 = __wm_scalar_149_3;
return reverseInto_1963__wm_d2(output_2137, __wm_basis_Nil);
} else if (__wm_scalar_149_0?.ctor === -6 && __wm_scalar_149_0.args.length === 1 && __wm_is_tuple(__wm_scalar_149_0.args[0]) && __wm_scalar_149_0.args[0].length === 2) {
const source_2138 = __wm_scalar_149_0.args[0][0];
const rest_2139 = __wm_scalar_149_0.args[0][1];
const allTypes_2140 = __wm_scalar_149_1;
const offset_2141 = __wm_scalar_149_2;
const output_2142 = __wm_scalar_149_3;
{
const items_2143 = Js.Array.toList(source_2138.items);
const width_2144 = listLength_1977__wm_d2(items_2143, 0);
const numericVector_2145 = __wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(__wm_eq(source_2138.kind, "tuple"), (width_2144 >= 2)), (width_2144 <= 4)), allSemanticNumbers_2104__wm_d2(items_2143, allTypes_2140));
if (__wm_op_or_d2(__wm_eq(source_2138.kind, "number"), numericVector_2145)) {
{
const clone_2146 = { ...source_2138, id: (offset_2141 + source_2138.id), kind: (__wm_eq(source_2138.kind, "number") ? "i32" : "vector"), items: (numericVector_2145 ? Js.Array.fromList(offsetTypeIds_2120__wm_d3(items_2143, offset_2141, __wm_basis_Nil)) : source_2138.items) };
{
const __wm_tail_arg_141_0 = rest_2139;
const __wm_tail_arg_141_1 = allTypes_2140;
const __wm_tail_arg_141_2 = offset_2141;
const __wm_tail_arg_141_3 = __wm_basis_Cons([clone_2146, output_2142]);
sourceTypes_2131 = __wm_tail_arg_141_0;
allTypes_2132 = __wm_tail_arg_141_1;
offset_2133 = __wm_tail_arg_141_2;
output_2134 = __wm_tail_arg_141_3;
continue __wm_tail_121;
}
}
} else {
{
const __wm_tail_arg_142_0 = rest_2139;
const __wm_tail_arg_142_1 = allTypes_2140;
const __wm_tail_arg_142_2 = offset_2141;
const __wm_tail_arg_142_3 = output_2142;
sourceTypes_2131 = __wm_tail_arg_142_0;
allTypes_2132 = __wm_tail_arg_142_1;
offset_2133 = __wm_tail_arg_142_2;
output_2134 = __wm_tail_arg_142_3;
continue __wm_tail_121;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addI32ShaderTypes_2130 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return addI32ShaderTypes_2130__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const concreteShaderTypeId_2154__wm_d4 = (semanticTypeId_2147, representation_2148, offset_2149, types_2150) => {
if (__wm_eq(representation_2148, "i32")) {
const source_2151 = findType_2046__wm_d2(types_2150, semanticTypeId_2147);
const items_2152 = Js.Array.toList(source_2151.items);
const width_2153 = listLength_1977__wm_d2(items_2152, 0);
if (__wm_op_or_d2(__wm_eq(source_2151.kind, "number"), __wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(__wm_eq(source_2151.kind, "tuple"), (width_2153 >= 2)), (width_2153 <= 4)), allSemanticNumbers_2104__wm_d2(items_2152, types_2150)))) {
return (offset_2149 + semanticTypeId_2147);
} else {
return semanticTypeId_2147;
}
} else {
return semanticTypeId_2147;
}
};
const concreteShaderTypeId_2154 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return concreteShaderTypeId_2154__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const elaborateSliceTypes_2155__wm_d4 = (sourceTypes_2156, allTypes_2157, shaderTypes_2158, evidence_2159) => {
__wm_tail_122: while (true) {
{
const __wm_scalar_150_0 = sourceTypes_2156;
const __wm_scalar_150_1 = allTypes_2157;
const __wm_scalar_150_2 = shaderTypes_2158;
const __wm_scalar_150_3 = evidence_2159;
if (__wm_scalar_150_0 === __wm_basis_Nil) {
const allTypes_2160 = __wm_scalar_150_1;
const shaderTypes_2161 = __wm_scalar_150_2;
const evidence_2162 = __wm_scalar_150_3;
return [reverseInto_1963__wm_d2(shaderTypes_2161, __wm_basis_Nil), reverseInto_1963__wm_d2(evidence_2162, __wm_basis_Nil)];
} else if (__wm_scalar_150_0?.ctor === -6 && __wm_scalar_150_0.args.length === 1 && __wm_is_tuple(__wm_scalar_150_0.args[0]) && __wm_scalar_150_0.args[0].length === 2) {
const source_2163 = __wm_scalar_150_0.args[0][0];
const rest_2164 = __wm_scalar_150_0.args[0][1];
const allTypes_2165 = __wm_scalar_150_1;
const shaderTypes_2166 = __wm_scalar_150_2;
const evidence_2167 = __wm_scalar_150_3;
{
const shaderKind_2168 = shaderTypeKind_2116__wm_d2(source_2163, allTypes_2165);
const shaderType_2169 = { ...source_2163, kind: shaderKind_2168 };
const typeEvidence_2170 = { typeId: source_2163.id, semanticKind: source_2163.kind, shaderKind: shaderKind_2168, reason: shaderTypeReason_2119__wm_d2(source_2163.kind, shaderKind_2168) };
{
const __wm_tail_arg_143_0 = rest_2164;
const __wm_tail_arg_143_1 = allTypes_2165;
const __wm_tail_arg_143_2 = __wm_basis_Cons([shaderType_2169, shaderTypes_2166]);
const __wm_tail_arg_143_3 = __wm_basis_Cons([typeEvidence_2170, evidence_2167]);
sourceTypes_2156 = __wm_tail_arg_143_0;
allTypes_2157 = __wm_tail_arg_143_1;
shaderTypes_2158 = __wm_tail_arg_143_2;
evidence_2159 = __wm_tail_arg_143_3;
continue __wm_tail_122;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const elaborateSliceTypes_2155 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return elaborateSliceTypes_2155__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const addExpressionOccurrences_2171__wm_d5 = (expressions_2172, representations_2173, typeOffset_2174, types_2175, occurrences_2176) => {
__wm_tail_123: while (true) {
{
const __wm_scalar_151_0 = expressions_2172;
const __wm_scalar_151_1 = representations_2173;
const __wm_scalar_151_2 = typeOffset_2174;
const __wm_scalar_151_3 = types_2175;
const __wm_scalar_151_4 = occurrences_2176;
if (__wm_scalar_151_0 === __wm_basis_Nil) {
const representations_2177 = __wm_scalar_151_1;
const typeOffset_2178 = __wm_scalar_151_2;
const types_2179 = __wm_scalar_151_3;
const occurrences_2180 = __wm_scalar_151_4;
return occurrences_2180;
} else if (__wm_scalar_151_0?.ctor === -6 && __wm_scalar_151_0.args.length === 1 && __wm_is_tuple(__wm_scalar_151_0.args[0]) && __wm_scalar_151_0.args[0].length === 2) {
const expression_2181 = __wm_scalar_151_0.args[0][0];
const rest_2182 = __wm_scalar_151_0.args[0][1];
const representations_2183 = __wm_scalar_151_1;
const typeOffset_2184 = __wm_scalar_151_2;
const types_2185 = __wm_scalar_151_3;
const occurrences_2186 = __wm_scalar_151_4;
{
const concreteRepresentation_2187 = expressionRepresentation_1955__wm_d2(representations_2183, expression_2181.id);
const occurrence_2188 = { kind: "expression", sourceId: expression_2181.id, typeId: expression_2181.typeId, shaderTypeId: concreteShaderTypeId_2154__wm_d4(expression_2181.typeId, concreteRepresentation_2187, typeOffset_2184, types_2185), spanId: expression_2181.spanId, representationEvidence: expression_2181.numberKind, representation: concreteRepresentation_2187 };
{
const __wm_tail_arg_144_0 = rest_2182;
const __wm_tail_arg_144_1 = representations_2183;
const __wm_tail_arg_144_2 = typeOffset_2184;
const __wm_tail_arg_144_3 = types_2185;
const __wm_tail_arg_144_4 = __wm_basis_Cons([occurrence_2188, occurrences_2186]);
expressions_2172 = __wm_tail_arg_144_0;
representations_2173 = __wm_tail_arg_144_1;
typeOffset_2174 = __wm_tail_arg_144_2;
types_2175 = __wm_tail_arg_144_3;
occurrences_2176 = __wm_tail_arg_144_4;
continue __wm_tail_123;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addExpressionOccurrences_2171 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return addExpressionOccurrences_2171__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const addPatternOccurrences_2189__wm_d6 = (patterns_2190, expressionCount_2191, representations_2192, typeOffset_2193, types_2194, occurrences_2195) => {
__wm_tail_124: while (true) {
{
const __wm_scalar_152_0 = patterns_2190;
const __wm_scalar_152_1 = expressionCount_2191;
const __wm_scalar_152_2 = representations_2192;
const __wm_scalar_152_3 = typeOffset_2193;
const __wm_scalar_152_4 = types_2194;
const __wm_scalar_152_5 = occurrences_2195;
if (__wm_scalar_152_0 === __wm_basis_Nil) {
const expressionCount_2196 = __wm_scalar_152_1;
const representations_2197 = __wm_scalar_152_2;
const typeOffset_2198 = __wm_scalar_152_3;
const types_2199 = __wm_scalar_152_4;
const occurrences_2200 = __wm_scalar_152_5;
return occurrences_2200;
} else if (__wm_scalar_152_0?.ctor === -6 && __wm_scalar_152_0.args.length === 1 && __wm_is_tuple(__wm_scalar_152_0.args[0]) && __wm_scalar_152_0.args[0].length === 2) {
const pattern_2201 = __wm_scalar_152_0.args[0][0];
const rest_2202 = __wm_scalar_152_0.args[0][1];
const expressionCount_2203 = __wm_scalar_152_1;
const representations_2204 = __wm_scalar_152_2;
const typeOffset_2205 = __wm_scalar_152_3;
const types_2206 = __wm_scalar_152_4;
const occurrences_2207 = __wm_scalar_152_5;
{
const concreteRepresentation_2208 = patternRepresentation_1959__wm_d3(representations_2204, expressionCount_2203, pattern_2201.id);
const occurrence_2209 = { kind: "pattern", sourceId: pattern_2201.id, typeId: pattern_2201.typeId, shaderTypeId: concreteShaderTypeId_2154__wm_d4(pattern_2201.typeId, concreteRepresentation_2208, typeOffset_2205, types_2206), spanId: pattern_2201.spanId, representationEvidence: "", representation: concreteRepresentation_2208 };
{
const __wm_tail_arg_145_0 = rest_2202;
const __wm_tail_arg_145_1 = expressionCount_2203;
const __wm_tail_arg_145_2 = representations_2204;
const __wm_tail_arg_145_3 = typeOffset_2205;
const __wm_tail_arg_145_4 = types_2206;
const __wm_tail_arg_145_5 = __wm_basis_Cons([occurrence_2209, occurrences_2207]);
patterns_2190 = __wm_tail_arg_145_0;
expressionCount_2191 = __wm_tail_arg_145_1;
representations_2192 = __wm_tail_arg_145_2;
typeOffset_2193 = __wm_tail_arg_145_3;
types_2194 = __wm_tail_arg_145_4;
occurrences_2195 = __wm_tail_arg_145_5;
continue __wm_tail_124;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addPatternOccurrences_2189 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return addPatternOccurrences_2189__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const addFunctionOccurrences_2210__wm_d2 = (functions_2211, occurrences_2212) => {
__wm_tail_125: while (true) {
{
const __wm_scalar_153_0 = functions_2211;
const __wm_scalar_153_1 = occurrences_2212;
if (__wm_scalar_153_0 === __wm_basis_Nil) {
const occurrences_2213 = __wm_scalar_153_1;
return occurrences_2213;
} else if (__wm_scalar_153_0?.ctor === -6 && __wm_scalar_153_0.args.length === 1 && __wm_is_tuple(__wm_scalar_153_0.args[0]) && __wm_scalar_153_0.args[0].length === 2) {
const fn_2214 = __wm_scalar_153_0.args[0][0];
const rest_2215 = __wm_scalar_153_0.args[0][1];
const occurrences_2216 = __wm_scalar_153_1;
{
const occurrence_2217 = { kind: "function", sourceId: fn_2214.id, typeId: fn_2214.typeId, shaderTypeId: fn_2214.typeId, spanId: fn_2214.spanId, representationEvidence: "", representation: "" };
{
const __wm_tail_arg_146_0 = rest_2215;
const __wm_tail_arg_146_1 = __wm_basis_Cons([occurrence_2217, occurrences_2216]);
functions_2211 = __wm_tail_arg_146_0;
occurrences_2212 = __wm_tail_arg_146_1;
continue __wm_tail_125;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addFunctionOccurrences_2210 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addFunctionOccurrences_2210__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const elaborateSliceProgramTypes_2232 = (__arg) => {
if (true) {
const input_2218 = __arg;
const semanticTypes_2219 = Js.Array.toList(input_2218.types);
const __wm_bind_78 = elaborateSliceTypes_2155__wm_d4(semanticTypes_2219, semanticTypes_2219, __wm_basis_Nil, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_78) && __wm_bind_78.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const shaderTypeItems_2220 = __wm_bind_78[0];
const typeEvidenceItems_2221 = __wm_bind_78[1];
const typeOffset_2222 = listLength_1977__wm_d2(semanticTypes_2219, 0);
const allShaderTypeItems_2223 = append_1970__wm_d2(shaderTypeItems_2220, addI32ShaderTypes_2130__wm_d4(semanticTypes_2219, semanticTypes_2219, typeOffset_2222, __wm_basis_Nil));
const expressionItems_2224 = Js.Array.toList(input_2218.expressions);
const numericRepresentations_2225 = solveSliceNumericRepresentations_1952(input_2218);
const withExpressions_2226 = addExpressionOccurrences_2171__wm_d5(expressionItems_2224, numericRepresentations_2225, typeOffset_2222, semanticTypes_2219, __wm_basis_Nil);
const withPatterns_2227 = addPatternOccurrences_2189__wm_d6(Js.Array.toList(input_2218.patterns), listLength_1977__wm_d2(expressionItems_2224, 0), numericRepresentations_2225, typeOffset_2222, semanticTypes_2219, withExpressions_2226);
const occurrenceItems_2228 = reverseInto_1963__wm_d2(addFunctionOccurrences_2210__wm_d2(Js.Array.toList(input_2218.functions), withPatterns_2227), __wm_basis_Nil);
const builtinCatalog_2229 = input_2218.builtinCatalog;
const typeContext_2230 = { expressions: Js.Array.toList(input_2218.expressions), blocks: Js.Array.toList(input_2218.blocks), blockItems: Js.Array.toList(input_2218.blockItems), lets: Js.Array.toList(input_2218.lets), matches: Js.Array.toList(input_2218.matches), matchArms: Js.Array.toList(input_2218.matchArms), patterns: Js.Array.toList(input_2218.patterns), types: allShaderTypeItems_2223, adts: Js.Array.toList(input_2218.adts), functions: Js.Array.toList(input_2218.functions), builtinOverloads: Js.Array.toList(builtinCatalog_2229.overloads), occurrences: occurrenceItems_2228 };
const output_2231 = { schemaVersion: 5, shaderTypes: Js.Array.fromList(allShaderTypeItems_2223), typeEvidence: Js.Array.fromList(typeEvidenceItems_2221), occurrences: Js.Array.fromList(occurrenceItems_2228), builtinSelections: Js.Array.fromList(collectBuiltinSelections_2093__wm_d3(Js.Array.toList(input_2218.expressions), typeContext_2230, __wm_basis_Nil)) };
return output_2231;
}
__wm_fail("Match", "pattern match failure in function");
};
const findAdt_2233__wm_d2 = (items_2234, typeNameId_2235) => {
__wm_tail_126: while (true) {
{
const __wm_scalar_154_0 = items_2234;
const __wm_scalar_154_1 = typeNameId_2235;
if (__wm_scalar_154_0 === __wm_basis_Nil) {
const typeNameId_2236 = __wm_scalar_154_1;
return __wm_fail("Panic", "missing schema-v2 ADT");
} else if (__wm_scalar_154_0?.ctor === -6 && __wm_scalar_154_0.args.length === 1 && __wm_is_tuple(__wm_scalar_154_0.args[0]) && __wm_scalar_154_0.args[0].length === 2) {
const item_2237 = __wm_scalar_154_0.args[0][0];
const rest_2238 = __wm_scalar_154_0.args[0][1];
const typeNameId_2239 = __wm_scalar_154_1;
if (numberEqual_1986__wm_d2(item_2237.typeNameId, typeNameId_2239)) {
return item_2237;
} else {
{
const __wm_tail_arg_147_0 = rest_2238;
const __wm_tail_arg_147_1 = typeNameId_2239;
items_2234 = __wm_tail_arg_147_0;
typeNameId_2235 = __wm_tail_arg_147_1;
continue __wm_tail_126;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findAdt_2233 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findAdt_2233__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findFunction_2240__wm_d2 = (items_2241, id_2242) => {
__wm_tail_127: while (true) {
{
const __wm_scalar_155_0 = items_2241;
const __wm_scalar_155_1 = id_2242;
if (__wm_scalar_155_0 === __wm_basis_Nil) {
const id_2243 = __wm_scalar_155_1;
return __wm_fail("Panic", "missing schema-v2 function");
} else if (__wm_scalar_155_0?.ctor === -6 && __wm_scalar_155_0.args.length === 1 && __wm_is_tuple(__wm_scalar_155_0.args[0]) && __wm_scalar_155_0.args[0].length === 2) {
const item_2244 = __wm_scalar_155_0.args[0][0];
const rest_2245 = __wm_scalar_155_0.args[0][1];
const id_2246 = __wm_scalar_155_1;
if (numberEqual_1986__wm_d2(item_2244.id, id_2246)) {
return item_2244;
} else {
{
const __wm_tail_arg_148_0 = rest_2245;
const __wm_tail_arg_148_1 = id_2246;
items_2241 = __wm_tail_arg_148_0;
id_2242 = __wm_tail_arg_148_1;
continue __wm_tail_127;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findFunction_2240 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findFunction_2240__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const initialState_2248 = (__arg) => {
if (__arg === undefined) {

const state_2247 = { nextExpressionId: 0, nextArmId: 0, functions: __wm_basis_Nil, expressions: __wm_basis_Nil, matchArms: __wm_basis_Nil, diagnostics: __wm_basis_Nil };
return state_2247;
}
__wm_fail("Match", "pattern match failure in function");
};
const baseIrExpression_2254__wm_d4 = (state_2249, source_2250, functionId_2251, kind_2252) => {
const expression_2253 = { id: state_2249.nextExpressionId, functionId: functionId_2251, sourceExprId: source_2250.id, kind: kind_2252, typeId: source_2250.typeId, spanId: source_2250.spanId, bindingId: (__wm_eq(source_2250.kind, "var") ? source_2250.bindingId : __wm_op_sub(1)), patternId: __wm_op_sub(1), targetFunctionId: (__wm_eq(source_2250.kind, "call") ? source_2250.functionId : __wm_op_sub(1)), constructorId: (__wm_eq(source_2250.kind, "constructor") ? source_2250.constructorId : __wm_op_sub(1)), semanticId: source_2250.semanticId, operatorId: source_2250.operatorId, builtinName: source_2250.builtinName, builtinOverloadId: __wm_op_sub(1), resourceOperation: source_2250.resourceOperation, numberValue: source_2250.numberValue, numberKind: source_2250.numberKind, boolValue: source_2250.boolValue, index: source_2250.index, children: Js.Array.fromList(__wm_basis_Nil), armIds: Js.Array.fromList(__wm_basis_Nil) };
return expression_2253;
};
const baseIrExpression_2254 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return baseIrExpression_2254__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const addExpression_2258__wm_d2 = (expression_2255, state_2256) => {
const next_2257 = { ...state_2256, nextExpressionId: (state_2256.nextExpressionId + 1), expressions: __wm_basis_Cons([expression_2255, state_2256.expressions]) };
return [expression_2255.id, next_2257];
};
const addExpression_2258 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addExpression_2258__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const addDiagnostic_2262__wm_d2 = (diagnostic_2259, state_2260) => {
const next_2261 = { ...state_2260, diagnostics: __wm_basis_Cons([diagnostic_2259, state_2260.diagnostics]) };
return next_2261;
};
const addDiagnostic_2262 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addDiagnostic_2262__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const nonTailDiagnostic_2267__wm_d2 = (source_2263, fn_2264) => {
const declaration_2265 = { spanId: fn_2264.spanId, label: "recursive function declared here" };
const diagnostic_2266 = { code: "gpu.recursion.non-tail", message: "direct self-recursion is allowed only in function, if, match, or block-result tail position", spanId: source_2263.spanId, related: Js.Array.fromList(__wm_basis_Cons([declaration_2265, __wm_basis_Nil])) };
return diagnostic_2266;
};
const nonTailDiagnostic_2267 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return nonTailDiagnostic_2267__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const nonExhaustiveDiagnostic_2270 = (__arg) => {
if (true) {
const source_2268 = __arg;
const diagnostic_2269 = { code: "gpu.pattern.non-exhaustive", message: "v1 GPU matches require exactly one arm for every constructor", spanId: source_2268.spanId, related: Js.Array.fromList(__wm_basis_Nil) };
return diagnostic_2269;
}
__wm_fail("Match", "pattern match failure in function");
};
const constructorPatterns_2271__wm_d4 = (armIds_2272, context_2273, constructors_2274, valid_2275) => {
__wm_tail_128: while (true) {
{
const __wm_scalar_156_0 = armIds_2272;
const __wm_scalar_156_1 = context_2273;
const __wm_scalar_156_2 = constructors_2274;
const __wm_scalar_156_3 = valid_2275;
if (__wm_scalar_156_0 === __wm_basis_Nil) {
const context_2276 = __wm_scalar_156_1;
const constructors_2277 = __wm_scalar_156_2;
const valid_2278 = __wm_scalar_156_3;
return [constructors_2277, valid_2278];
} else if (__wm_scalar_156_0?.ctor === -6 && __wm_scalar_156_0.args.length === 1 && __wm_is_tuple(__wm_scalar_156_0.args[0]) && __wm_scalar_156_0.args[0].length === 2) {
const armId_2279 = __wm_scalar_156_0.args[0][0];
const rest_2280 = __wm_scalar_156_0.args[0][1];
const context_2281 = __wm_scalar_156_1;
const constructors_2282 = __wm_scalar_156_2;
const valid_2283 = __wm_scalar_156_3;
{
const arm_2284 = findMatchArm_2032__wm_d2(context_2281.matchArms, armId_2279);
const pattern_2285 = findPattern_2039__wm_d2(context_2281.patterns, arm_2284.patternId);
if (__wm_eq(pattern_2285.kind, "constructor")) {
{
const __wm_tail_arg_149_0 = rest_2280;
const __wm_tail_arg_149_1 = context_2281;
const __wm_tail_arg_149_2 = __wm_basis_Cons([pattern_2285.constructorId, constructors_2282]);
const __wm_tail_arg_149_3 = valid_2283;
armIds_2272 = __wm_tail_arg_149_0;
context_2273 = __wm_tail_arg_149_1;
constructors_2274 = __wm_tail_arg_149_2;
valid_2275 = __wm_tail_arg_149_3;
continue __wm_tail_128;
}
} else {
{
const __wm_tail_arg_150_0 = rest_2280;
const __wm_tail_arg_150_1 = context_2281;
const __wm_tail_arg_150_2 = constructors_2282;
const __wm_tail_arg_150_3 = false;
armIds_2272 = __wm_tail_arg_150_0;
context_2273 = __wm_tail_arg_150_1;
constructors_2274 = __wm_tail_arg_150_2;
valid_2275 = __wm_tail_arg_150_3;
continue __wm_tail_128;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const constructorPatterns_2271 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return constructorPatterns_2271__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const matchIsExhaustive_2286__wm_d3 = (source_2288, row_2289, context_2290) => {
const value_2291 = findExpression_1997__wm_d2(context_2290.expressions, row_2289.valueExprId);
const valueType_2292 = findType_2046__wm_d2(context_2290.types, value_2291.typeId);
if (__wm_eq(valueType_2292.kind, "adt")) {
const adt_2293 = findAdt_2233__wm_d2(context_2290.adts, valueType_2292.typeNameId);
const __wm_bind_79 = constructorPatterns_2271__wm_d4(Js.Array.toList(row_2289.armIds), context_2290, __wm_basis_Nil, true);
if (!(__wm_is_tuple(__wm_bind_79) && __wm_bind_79.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const constructors_2294 = __wm_bind_79[0];
const valid_2295 = __wm_bind_79[1];
return __wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(valid_2295, unique_1992__wm_d2(constructors_2294, __wm_basis_Nil)), numberEqual_1986__wm_d2(listLength_1977__wm_d2(constructors_2294, 0), listLength_1977__wm_d2(Js.Array.toList(adt_2293.constructorIds), 0))), constructorSetContains_2287__wm_d2(Js.Array.toList(adt_2293.constructorIds), constructors_2294));
} else {
return false;
}
};
const matchIsExhaustive_2286 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return matchIsExhaustive_2286__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const constructorSetContains_2287__wm_d2 = (expected_2296, actual_2297) => {
const __wm_scalar_157_0 = expected_2296;
const __wm_scalar_157_1 = actual_2297;
if (__wm_scalar_157_0 === __wm_basis_Nil) {
const actual_2298 = __wm_scalar_157_1;
return true;
} else if (__wm_scalar_157_0?.ctor === -6 && __wm_scalar_157_0.args.length === 1 && __wm_is_tuple(__wm_scalar_157_0.args[0]) && __wm_scalar_157_0.args[0].length === 2) {
const head_2299 = __wm_scalar_157_0.args[0][0];
const rest_2300 = __wm_scalar_157_0.args[0][1];
const actual_2301 = __wm_scalar_157_1;
return __wm_op_and_d2(contains_1987__wm_d2(actual_2301, head_2299), constructorSetContains_2287__wm_d2(rest_2300, actual_2301));
}
__wm_fail("Match", "non-exhaustive match");
};
const constructorSetContains_2287 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return constructorSetContains_2287__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const buildExpression_2302__wm_d5 = (sourceId_2310, functionId_2311, tailPosition_2312, context_2313, state_2314) => {
const source_2315 = findExpression_1997__wm_d2(context_2313.expressions, sourceId_2310);
if (__wm_eq(source_2315.kind, "block")) {
return buildBlock_2307__wm_d5(source_2315, functionId_2311, tailPosition_2312, context_2313, state_2314);
} else {
if (__wm_eq(source_2315.kind, "if")) {
return buildIf_2304__wm_d5(source_2315, functionId_2311, tailPosition_2312, context_2313, state_2314);
} else {
if (__wm_eq(source_2315.kind, "match")) {
return buildMatch_2305__wm_d5(source_2315, functionId_2311, tailPosition_2312, context_2313, state_2314);
} else {
const selfCall_2316 = __wm_op_and_d2(__wm_eq(source_2315.kind, "call"), numberEqual_1986__wm_d2(source_2315.functionId, functionId_2311));
const kind_2317 = (__wm_op_and_d2(selfCall_2316, tailPosition_2312) ? "tail-call" : (__wm_eq(source_2315.kind, "var") ? "local" : source_2315.kind));
const diagnosed_2318 = (__wm_op_and_d2(selfCall_2316, __wm_op_not(tailPosition_2312)) ? addDiagnostic_2262__wm_d2(nonTailDiagnostic_2267__wm_d2(source_2315, findFunction_2240__wm_d2(context_2313.functions, functionId_2311)), state_2314) : state_2314);
const __wm_bind_80 = buildChildren_2303__wm_d5(Js.Array.toList(source_2315.children), functionId_2311, context_2313, diagnosed_2318, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_80) && __wm_bind_80.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const children_2319 = __wm_bind_80[0];
const withChildren_2320 = __wm_bind_80[1];
const expression_2321 = { ...baseIrExpression_2254__wm_d4(withChildren_2320, source_2315, functionId_2311, kind_2317), builtinOverloadId: (__wm_eq(source_2315.kind, "builtin") ? selectBuiltinOverload_2083__wm_d3(context_2313.builtinOverloads, source_2315, context_2313) : __wm_op_sub(1)), children: Js.Array.fromList(children_2319) };
return addExpression_2258__wm_d2(expression_2321, withChildren_2320);
}
}
}
};
const buildExpression_2302 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildExpression_2302__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildChildren_2303__wm_d5 = (sourceIds_2322, functionId_2323, context_2324, state_2325, reversed_2326) => {
__wm_tail_129: while (true) {
{
const __wm_scalar_158_0 = sourceIds_2322;
const __wm_scalar_158_1 = functionId_2323;
const __wm_scalar_158_2 = context_2324;
const __wm_scalar_158_3 = state_2325;
const __wm_scalar_158_4 = reversed_2326;
if (__wm_scalar_158_0 === __wm_basis_Nil) {
const functionId_2327 = __wm_scalar_158_1;
const context_2328 = __wm_scalar_158_2;
const state_2329 = __wm_scalar_158_3;
const reversed_2330 = __wm_scalar_158_4;
return [reverseInto_1963__wm_d2(reversed_2330, __wm_basis_Nil), state_2329];
} else if (__wm_scalar_158_0?.ctor === -6 && __wm_scalar_158_0.args.length === 1 && __wm_is_tuple(__wm_scalar_158_0.args[0]) && __wm_scalar_158_0.args[0].length === 2) {
const sourceId_2331 = __wm_scalar_158_0.args[0][0];
const rest_2332 = __wm_scalar_158_0.args[0][1];
const functionId_2333 = __wm_scalar_158_1;
const context_2334 = __wm_scalar_158_2;
const state_2335 = __wm_scalar_158_3;
const reversed_2336 = __wm_scalar_158_4;
{
const __wm_bind_81 = buildExpression_2302__wm_d5(sourceId_2331, functionId_2333, false, context_2334, state_2335);
if (!(__wm_is_tuple(__wm_bind_81) && __wm_bind_81.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const childId_2337 = __wm_bind_81[0];
const afterChild_2338 = __wm_bind_81[1];
{
const __wm_tail_arg_151_0 = rest_2332;
const __wm_tail_arg_151_1 = functionId_2333;
const __wm_tail_arg_151_2 = context_2334;
const __wm_tail_arg_151_3 = afterChild_2338;
const __wm_tail_arg_151_4 = __wm_basis_Cons([childId_2337, reversed_2336]);
sourceIds_2322 = __wm_tail_arg_151_0;
functionId_2323 = __wm_tail_arg_151_1;
context_2324 = __wm_tail_arg_151_2;
state_2325 = __wm_tail_arg_151_3;
reversed_2326 = __wm_tail_arg_151_4;
continue __wm_tail_129;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildChildren_2303 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildChildren_2303__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildIf_2304__wm_d5 = (source_2339, functionId_2340, tailPosition_2341, context_2342, state_2343) => {
const __wm_return_value_51 = Js.Array.toList(source_2339.children);
if (__wm_return_value_51?.ctor === -6 && __wm_return_value_51.args.length === 1 && __wm_is_tuple(__wm_return_value_51.args[0]) && __wm_return_value_51.args[0].length === 2 && __wm_return_value_51.args[0][1]?.ctor === -6 && __wm_return_value_51.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_51.args[0][1].args[0]) && __wm_return_value_51.args[0][1].args[0].length === 2 && __wm_return_value_51.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_51.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_51.args[0][1].args[0][1].args[0]) && __wm_return_value_51.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_51.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const conditionId_2344 = __wm_return_value_51.args[0][0];
const thenId_2345 = __wm_return_value_51.args[0][1].args[0][0];
const elseId_2346 = __wm_return_value_51.args[0][1].args[0][1].args[0][0];
const __wm_bind_82 = buildExpression_2302__wm_d5(conditionId_2344, functionId_2340, false, context_2342, state_2343);
if (!(__wm_is_tuple(__wm_bind_82) && __wm_bind_82.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const conditionIr_2347 = __wm_bind_82[0];
const afterCondition_2348 = __wm_bind_82[1];
const __wm_bind_83 = buildExpression_2302__wm_d5(thenId_2345, functionId_2340, tailPosition_2341, context_2342, afterCondition_2348);
if (!(__wm_is_tuple(__wm_bind_83) && __wm_bind_83.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const thenIr_2349 = __wm_bind_83[0];
const afterThen_2350 = __wm_bind_83[1];
const __wm_bind_84 = buildExpression_2302__wm_d5(elseId_2346, functionId_2340, tailPosition_2341, context_2342, afterThen_2350);
if (!(__wm_is_tuple(__wm_bind_84) && __wm_bind_84.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const elseIr_2351 = __wm_bind_84[0];
const afterElse_2352 = __wm_bind_84[1];
const expression_2353 = { ...baseIrExpression_2254__wm_d4(afterElse_2352, source_2339, functionId_2340, "if"), children: Js.Array.fromList(__wm_basis_Cons([conditionIr_2347, __wm_basis_Cons([thenIr_2349, __wm_basis_Cons([elseIr_2351, __wm_basis_Nil])])])) };
return addExpression_2258__wm_d2(expression_2353, afterElse_2352);
} else if (true) {

return __wm_fail("Panic", "schema-v2 if does not have three children");
}
__wm_fail("Match", "non-exhaustive match");
};
const buildIf_2304 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildIf_2304__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildMatch_2305__wm_d5 = (source_2354, functionId_2355, tailPosition_2356, context_2357, state_2358) => {
const row_2359 = findMatch_2025__wm_d2(context_2357.matches, source_2354.id);
const diagnosed_2360 = (matchIsExhaustive_2286__wm_d3(source_2354, row_2359, context_2357) ? state_2358 : addDiagnostic_2262__wm_d2(nonExhaustiveDiagnostic_2270(source_2354), state_2358));
const __wm_bind_85 = buildExpression_2302__wm_d5(row_2359.valueExprId, functionId_2355, false, context_2357, diagnosed_2360);
if (!(__wm_is_tuple(__wm_bind_85) && __wm_bind_85.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const valueIr_2361 = __wm_bind_85[0];
const afterValue_2362 = __wm_bind_85[1];
const __wm_bind_86 = buildMatchArms_2306__wm_d6(Js.Array.toList(row_2359.armIds), functionId_2355, tailPosition_2356, context_2357, afterValue_2362, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_86) && __wm_bind_86.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const armIds_2363 = __wm_bind_86[0];
const afterArms_2364 = __wm_bind_86[1];
const expression_2365 = { ...baseIrExpression_2254__wm_d4(afterArms_2364, source_2354, functionId_2355, "match"), children: Js.Array.fromList(__wm_basis_Cons([valueIr_2361, __wm_basis_Nil])), armIds: Js.Array.fromList(armIds_2363) };
return addExpression_2258__wm_d2(expression_2365, afterArms_2364);
};
const buildMatch_2305 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildMatch_2305__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildMatchArms_2306__wm_d6 = (sourceArmIds_2366, functionId_2367, tailPosition_2368, context_2369, state_2370, reversed_2371) => {
__wm_tail_130: while (true) {
{
const __wm_scalar_159_0 = sourceArmIds_2366;
const __wm_scalar_159_1 = functionId_2367;
const __wm_scalar_159_2 = tailPosition_2368;
const __wm_scalar_159_3 = context_2369;
const __wm_scalar_159_4 = state_2370;
const __wm_scalar_159_5 = reversed_2371;
if (__wm_scalar_159_0 === __wm_basis_Nil) {
const functionId_2372 = __wm_scalar_159_1;
const tailPosition_2373 = __wm_scalar_159_2;
const context_2374 = __wm_scalar_159_3;
const state_2375 = __wm_scalar_159_4;
const reversed_2376 = __wm_scalar_159_5;
return [reverseInto_1963__wm_d2(reversed_2376, __wm_basis_Nil), state_2375];
} else if (__wm_scalar_159_0?.ctor === -6 && __wm_scalar_159_0.args.length === 1 && __wm_is_tuple(__wm_scalar_159_0.args[0]) && __wm_scalar_159_0.args[0].length === 2) {
const sourceArmId_2377 = __wm_scalar_159_0.args[0][0];
const rest_2378 = __wm_scalar_159_0.args[0][1];
const functionId_2379 = __wm_scalar_159_1;
const tailPosition_2380 = __wm_scalar_159_2;
const context_2381 = __wm_scalar_159_3;
const state_2382 = __wm_scalar_159_4;
const reversed_2383 = __wm_scalar_159_5;
{
const sourceArm_2384 = findMatchArm_2032__wm_d2(context_2381.matchArms, sourceArmId_2377);
const __wm_bind_87 = buildExpression_2302__wm_d5(sourceArm_2384.bodyExprId, functionId_2379, tailPosition_2380, context_2381, state_2382);
if (!(__wm_is_tuple(__wm_bind_87) && __wm_bind_87.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const bodyIr_2385 = __wm_bind_87[0];
const afterBody_2386 = __wm_bind_87[1];
const arm_2387 = { id: afterBody_2386.nextArmId, sourceArmId: sourceArm_2384.id, patternId: sourceArm_2384.patternId, bodyExprId: bodyIr_2385, spanId: sourceArm_2384.spanId };
const afterArm_2388 = { ...afterBody_2386, nextArmId: (afterBody_2386.nextArmId + 1), matchArms: __wm_basis_Cons([arm_2387, afterBody_2386.matchArms]) };
{
const __wm_tail_arg_152_0 = rest_2378;
const __wm_tail_arg_152_1 = functionId_2379;
const __wm_tail_arg_152_2 = tailPosition_2380;
const __wm_tail_arg_152_3 = context_2381;
const __wm_tail_arg_152_4 = afterArm_2388;
const __wm_tail_arg_152_5 = __wm_basis_Cons([arm_2387.id, reversed_2383]);
sourceArmIds_2366 = __wm_tail_arg_152_0;
functionId_2367 = __wm_tail_arg_152_1;
tailPosition_2368 = __wm_tail_arg_152_2;
context_2369 = __wm_tail_arg_152_3;
state_2370 = __wm_tail_arg_152_4;
reversed_2371 = __wm_tail_arg_152_5;
continue __wm_tail_130;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildMatchArms_2306 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return buildMatchArms_2306__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const buildBlock_2307__wm_d5 = (source_2389, functionId_2390, tailPosition_2391, context_2392, state_2393) => {
const row_2394 = findBlock_2004__wm_d2(context_2392.blocks, source_2389.id);
const __wm_bind_88 = buildBlockValues_2308__wm_d5(Js.Array.toList(row_2394.itemIds), functionId_2390, context_2392, state_2393, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_88) && __wm_bind_88.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const builtItems_2395 = __wm_bind_88[0];
const afterItems_2396 = __wm_bind_88[1];
const __wm_bind_89 = buildExpression_2302__wm_d5(row_2394.resultExprId, functionId_2390, tailPosition_2391, context_2392, afterItems_2396);
if (!(__wm_is_tuple(__wm_bind_89) && __wm_bind_89.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const resultIr_2397 = __wm_bind_89[0];
const afterResult_2398 = __wm_bind_89[1];
return buildBlockWrappers_2309__wm_d6(reverseInto_1963__wm_d2(builtItems_2395, __wm_basis_Nil), source_2389, functionId_2390, resultIr_2397, context_2392, afterResult_2398);
};
const buildBlock_2307 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildBlock_2307__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildBlockValues_2308__wm_d5 = (itemIds_2399, functionId_2400, context_2401, state_2402, reversed_2403) => {
__wm_tail_131: while (true) {
{
const __wm_scalar_160_0 = itemIds_2399;
const __wm_scalar_160_1 = functionId_2400;
const __wm_scalar_160_2 = context_2401;
const __wm_scalar_160_3 = state_2402;
const __wm_scalar_160_4 = reversed_2403;
if (__wm_scalar_160_0 === __wm_basis_Nil) {
const functionId_2404 = __wm_scalar_160_1;
const context_2405 = __wm_scalar_160_2;
const state_2406 = __wm_scalar_160_3;
const reversed_2407 = __wm_scalar_160_4;
return [reverseInto_1963__wm_d2(reversed_2407, __wm_basis_Nil), state_2406];
} else if (__wm_scalar_160_0?.ctor === -6 && __wm_scalar_160_0.args.length === 1 && __wm_is_tuple(__wm_scalar_160_0.args[0]) && __wm_scalar_160_0.args[0].length === 2) {
const itemId_2408 = __wm_scalar_160_0.args[0][0];
const rest_2409 = __wm_scalar_160_0.args[0][1];
const functionId_2410 = __wm_scalar_160_1;
const context_2411 = __wm_scalar_160_2;
const state_2412 = __wm_scalar_160_3;
const reversed_2413 = __wm_scalar_160_4;
{
const item_2414 = findBlockItem_2011__wm_d2(context_2411.blockItems, itemId_2408);
if (__wm_eq(item_2414.kind, "let")) {
{
const letRow_2415 = findLet_2018__wm_d2(context_2411.lets, item_2414.letId);
const __wm_bind_90 = buildExpression_2302__wm_d5(letRow_2415.valueExprId, functionId_2410, false, context_2411, state_2412);
if (!(__wm_is_tuple(__wm_bind_90) && __wm_bind_90.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const valueIr_2416 = __wm_bind_90[0];
const afterValue_2417 = __wm_bind_90[1];
const built_2418 = { itemId: item_2414.id, valueExprId: valueIr_2416 };
{
const __wm_tail_arg_153_0 = rest_2409;
const __wm_tail_arg_153_1 = functionId_2410;
const __wm_tail_arg_153_2 = context_2411;
const __wm_tail_arg_153_3 = afterValue_2417;
const __wm_tail_arg_153_4 = __wm_basis_Cons([built_2418, reversed_2413]);
itemIds_2399 = __wm_tail_arg_153_0;
functionId_2400 = __wm_tail_arg_153_1;
context_2401 = __wm_tail_arg_153_2;
state_2402 = __wm_tail_arg_153_3;
reversed_2403 = __wm_tail_arg_153_4;
continue __wm_tail_131;
}
}
} else {
{
const __wm_bind_91 = buildExpression_2302__wm_d5(item_2414.expressionId, functionId_2410, false, context_2411, state_2412);
if (!(__wm_is_tuple(__wm_bind_91) && __wm_bind_91.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const valueIr_2419 = __wm_bind_91[0];
const afterValue_2420 = __wm_bind_91[1];
const built_2421 = { itemId: item_2414.id, valueExprId: valueIr_2419 };
{
const __wm_tail_arg_154_0 = rest_2409;
const __wm_tail_arg_154_1 = functionId_2410;
const __wm_tail_arg_154_2 = context_2411;
const __wm_tail_arg_154_3 = afterValue_2420;
const __wm_tail_arg_154_4 = __wm_basis_Cons([built_2421, reversed_2413]);
itemIds_2399 = __wm_tail_arg_154_0;
functionId_2400 = __wm_tail_arg_154_1;
context_2401 = __wm_tail_arg_154_2;
state_2402 = __wm_tail_arg_154_3;
reversed_2403 = __wm_tail_arg_154_4;
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
const buildBlockValues_2308 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildBlockValues_2308__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildBlockWrappers_2309__wm_d6 = (builtItems_2422, source_2423, functionId_2424, bodyIr_2425, context_2426, state_2427) => {
__wm_tail_132: while (true) {
{
const __wm_scalar_161_0 = builtItems_2422;
const __wm_scalar_161_1 = source_2423;
const __wm_scalar_161_2 = functionId_2424;
const __wm_scalar_161_3 = bodyIr_2425;
const __wm_scalar_161_4 = context_2426;
const __wm_scalar_161_5 = state_2427;
if (__wm_scalar_161_0 === __wm_basis_Nil) {
const source_2428 = __wm_scalar_161_1;
const functionId_2429 = __wm_scalar_161_2;
const bodyIr_2430 = __wm_scalar_161_3;
const context_2431 = __wm_scalar_161_4;
const state_2432 = __wm_scalar_161_5;
return [bodyIr_2430, state_2432];
} else if (__wm_scalar_161_0?.ctor === -6 && __wm_scalar_161_0.args.length === 1 && __wm_is_tuple(__wm_scalar_161_0.args[0]) && __wm_scalar_161_0.args[0].length === 2) {
const built_2433 = __wm_scalar_161_0.args[0][0];
const rest_2434 = __wm_scalar_161_0.args[0][1];
const source_2435 = __wm_scalar_161_1;
const functionId_2436 = __wm_scalar_161_2;
const bodyIr_2437 = __wm_scalar_161_3;
const context_2438 = __wm_scalar_161_4;
const state_2439 = __wm_scalar_161_5;
{
const item_2440 = findBlockItem_2011__wm_d2(context_2438.blockItems, built_2433.itemId);
if (__wm_eq(item_2440.kind, "let")) {
{
const letRow_2441 = findLet_2018__wm_d2(context_2438.lets, item_2440.letId);
const expression_2442 = { ...baseIrExpression_2254__wm_d4(state_2439, source_2435, functionId_2436, "let"), spanId: item_2440.spanId, bindingId: __wm_op_sub(1), patternId: letRow_2441.patternId, targetFunctionId: __wm_op_sub(1), children: Js.Array.fromList(__wm_basis_Cons([built_2433.valueExprId, __wm_basis_Cons([bodyIr_2437, __wm_basis_Nil])])) };
const __wm_bind_92 = addExpression_2258__wm_d2(expression_2442, state_2439);
if (!(__wm_is_tuple(__wm_bind_92) && __wm_bind_92.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const letIr_2443 = __wm_bind_92[0];
const afterLet_2444 = __wm_bind_92[1];
{
const __wm_tail_arg_155_0 = rest_2434;
const __wm_tail_arg_155_1 = source_2435;
const __wm_tail_arg_155_2 = functionId_2436;
const __wm_tail_arg_155_3 = letIr_2443;
const __wm_tail_arg_155_4 = context_2438;
const __wm_tail_arg_155_5 = afterLet_2444;
builtItems_2422 = __wm_tail_arg_155_0;
source_2423 = __wm_tail_arg_155_1;
functionId_2424 = __wm_tail_arg_155_2;
bodyIr_2425 = __wm_tail_arg_155_3;
context_2426 = __wm_tail_arg_155_4;
state_2427 = __wm_tail_arg_155_5;
continue __wm_tail_132;
}
}
} else {
{
const expression_2445 = { ...baseIrExpression_2254__wm_d4(state_2439, source_2435, functionId_2436, "sequence"), spanId: item_2440.spanId, bindingId: __wm_op_sub(1), targetFunctionId: __wm_op_sub(1), children: Js.Array.fromList(__wm_basis_Cons([built_2433.valueExprId, __wm_basis_Cons([bodyIr_2437, __wm_basis_Nil])])) };
const __wm_bind_93 = addExpression_2258__wm_d2(expression_2445, state_2439);
if (!(__wm_is_tuple(__wm_bind_93) && __wm_bind_93.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const sequenceIr_2446 = __wm_bind_93[0];
const afterSequence_2447 = __wm_bind_93[1];
{
const __wm_tail_arg_156_0 = rest_2434;
const __wm_tail_arg_156_1 = source_2435;
const __wm_tail_arg_156_2 = functionId_2436;
const __wm_tail_arg_156_3 = sequenceIr_2446;
const __wm_tail_arg_156_4 = context_2438;
const __wm_tail_arg_156_5 = afterSequence_2447;
builtItems_2422 = __wm_tail_arg_156_0;
source_2423 = __wm_tail_arg_156_1;
functionId_2424 = __wm_tail_arg_156_2;
bodyIr_2425 = __wm_tail_arg_156_3;
context_2426 = __wm_tail_arg_156_4;
state_2427 = __wm_tail_arg_156_5;
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
const buildBlockWrappers_2309 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return buildBlockWrappers_2309__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const buildFunctions_2448__wm_d3 = (functions_2449, context_2450, state_2451) => {
__wm_tail_133: while (true) {
{
const __wm_scalar_162_0 = functions_2449;
const __wm_scalar_162_1 = context_2450;
const __wm_scalar_162_2 = state_2451;
if (__wm_scalar_162_0 === __wm_basis_Nil) {
const context_2452 = __wm_scalar_162_1;
const state_2453 = __wm_scalar_162_2;
return state_2453;
} else if (__wm_scalar_162_0?.ctor === -6 && __wm_scalar_162_0.args.length === 1 && __wm_is_tuple(__wm_scalar_162_0.args[0]) && __wm_scalar_162_0.args[0].length === 2) {
const fn_2454 = __wm_scalar_162_0.args[0][0];
const rest_2455 = __wm_scalar_162_0.args[0][1];
const context_2456 = __wm_scalar_162_1;
const state_2457 = __wm_scalar_162_2;
{
const __wm_bind_94 = buildExpression_2302__wm_d5(fn_2454.bodyExprId, fn_2454.id, true, context_2456, state_2457);
if (!(__wm_is_tuple(__wm_bind_94) && __wm_bind_94.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const bodyIr_2458 = __wm_bind_94[0];
const afterBody_2459 = __wm_bind_94[1];
const irFunction_2460 = { functionId: fn_2454.id, bindingId: fn_2454.bindingId, name: fn_2454.name, paramIds: fn_2454.paramIds, resultTypeId: fn_2454.resultTypeId, bodyExprId: bodyIr_2458, recursionGroupId: fn_2454.recursionGroupId, spanId: fn_2454.spanId };
const afterFunction_2461 = { ...afterBody_2459, functions: __wm_basis_Cons([irFunction_2460, afterBody_2459.functions]) };
{
const __wm_tail_arg_157_0 = rest_2455;
const __wm_tail_arg_157_1 = context_2456;
const __wm_tail_arg_157_2 = afterFunction_2461;
functions_2449 = __wm_tail_arg_157_0;
context_2450 = __wm_tail_arg_157_1;
state_2451 = __wm_tail_arg_157_2;
continue __wm_tail_133;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildFunctions_2448 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return buildFunctions_2448__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const findOccurrence_2462__wm_d3 = (items_2463, kind_2464, sourceId_2465) => {
__wm_tail_134: while (true) {
{
const __wm_scalar_163_0 = items_2463;
const __wm_scalar_163_1 = kind_2464;
const __wm_scalar_163_2 = sourceId_2465;
if (__wm_scalar_163_0 === __wm_basis_Nil) {
const kind_2466 = __wm_scalar_163_1;
const sourceId_2467 = __wm_scalar_163_2;
return __wm_fail("Panic", "missing concrete GPU occurrence type");
} else if (__wm_scalar_163_0?.ctor === -6 && __wm_scalar_163_0.args.length === 1 && __wm_is_tuple(__wm_scalar_163_0.args[0]) && __wm_scalar_163_0.args[0].length === 2) {
const item_2468 = __wm_scalar_163_0.args[0][0];
const rest_2469 = __wm_scalar_163_0.args[0][1];
const kind_2470 = __wm_scalar_163_1;
const sourceId_2471 = __wm_scalar_163_2;
if (__wm_op_and_d2(__wm_eq(item_2468.kind, kind_2470), numberEqual_1986__wm_d2(item_2468.sourceId, sourceId_2471))) {
return item_2468;
} else {
{
const __wm_tail_arg_158_0 = rest_2469;
const __wm_tail_arg_158_1 = kind_2470;
const __wm_tail_arg_158_2 = sourceId_2471;
items_2463 = __wm_tail_arg_158_0;
kind_2464 = __wm_tail_arg_158_1;
sourceId_2465 = __wm_tail_arg_158_2;
continue __wm_tail_134;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findOccurrence_2462 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findOccurrence_2462__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizeExpressions_2472__wm_d3 = (expressions_2473, occurrences_2474, output_2475) => {
__wm_tail_135: while (true) {
{
const __wm_scalar_164_0 = expressions_2473;
const __wm_scalar_164_1 = occurrences_2474;
const __wm_scalar_164_2 = output_2475;
if (__wm_scalar_164_0 === __wm_basis_Nil) {
const occurrences_2476 = __wm_scalar_164_1;
const output_2477 = __wm_scalar_164_2;
return reverseInto_1963__wm_d2(output_2477, __wm_basis_Nil);
} else if (__wm_scalar_164_0?.ctor === -6 && __wm_scalar_164_0.args.length === 1 && __wm_is_tuple(__wm_scalar_164_0.args[0]) && __wm_scalar_164_0.args[0].length === 2) {
const expression_2478 = __wm_scalar_164_0.args[0][0];
const rest_2479 = __wm_scalar_164_0.args[0][1];
const occurrences_2480 = __wm_scalar_164_1;
const output_2481 = __wm_scalar_164_2;
{
const occurrence_2482 = findOccurrence_2462__wm_d3(occurrences_2480, "expression", expression_2478.id);
const concrete_2483 = { ...expression_2478, typeId: occurrence_2482.shaderTypeId };
{
const __wm_tail_arg_159_0 = rest_2479;
const __wm_tail_arg_159_1 = occurrences_2480;
const __wm_tail_arg_159_2 = __wm_basis_Cons([concrete_2483, output_2481]);
expressions_2473 = __wm_tail_arg_159_0;
occurrences_2474 = __wm_tail_arg_159_1;
output_2475 = __wm_tail_arg_159_2;
continue __wm_tail_135;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizeExpressions_2472 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concretizeExpressions_2472__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizePatterns_2484__wm_d3 = (patterns_2485, occurrences_2486, output_2487) => {
__wm_tail_136: while (true) {
{
const __wm_scalar_165_0 = patterns_2485;
const __wm_scalar_165_1 = occurrences_2486;
const __wm_scalar_165_2 = output_2487;
if (__wm_scalar_165_0 === __wm_basis_Nil) {
const occurrences_2488 = __wm_scalar_165_1;
const output_2489 = __wm_scalar_165_2;
return reverseInto_1963__wm_d2(output_2489, __wm_basis_Nil);
} else if (__wm_scalar_165_0?.ctor === -6 && __wm_scalar_165_0.args.length === 1 && __wm_is_tuple(__wm_scalar_165_0.args[0]) && __wm_scalar_165_0.args[0].length === 2) {
const pattern_2490 = __wm_scalar_165_0.args[0][0];
const rest_2491 = __wm_scalar_165_0.args[0][1];
const occurrences_2492 = __wm_scalar_165_1;
const output_2493 = __wm_scalar_165_2;
{
const occurrence_2494 = findOccurrence_2462__wm_d3(occurrences_2492, "pattern", pattern_2490.id);
const concrete_2495 = { ...pattern_2490, typeId: occurrence_2494.shaderTypeId };
{
const __wm_tail_arg_160_0 = rest_2491;
const __wm_tail_arg_160_1 = occurrences_2492;
const __wm_tail_arg_160_2 = __wm_basis_Cons([concrete_2495, output_2493]);
patterns_2485 = __wm_tail_arg_160_0;
occurrences_2486 = __wm_tail_arg_160_1;
output_2487 = __wm_tail_arg_160_2;
continue __wm_tail_136;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizePatterns_2484 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concretizePatterns_2484__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizeParams_2496__wm_d3 = (params_2497, patterns_2498, output_2499) => {
__wm_tail_137: while (true) {
{
const __wm_scalar_166_0 = params_2497;
const __wm_scalar_166_1 = patterns_2498;
const __wm_scalar_166_2 = output_2499;
if (__wm_scalar_166_0 === __wm_basis_Nil) {
const patterns_2500 = __wm_scalar_166_1;
const output_2501 = __wm_scalar_166_2;
return reverseInto_1963__wm_d2(output_2501, __wm_basis_Nil);
} else if (__wm_scalar_166_0?.ctor === -6 && __wm_scalar_166_0.args.length === 1 && __wm_is_tuple(__wm_scalar_166_0.args[0]) && __wm_scalar_166_0.args[0].length === 2) {
const param_2502 = __wm_scalar_166_0.args[0][0];
const rest_2503 = __wm_scalar_166_0.args[0][1];
const patterns_2504 = __wm_scalar_166_1;
const output_2505 = __wm_scalar_166_2;
{
const pattern_2506 = findPattern_2039__wm_d2(patterns_2504, param_2502.patternId);
const concrete_2507 = { ...param_2502, typeId: pattern_2506.typeId };
{
const __wm_tail_arg_161_0 = rest_2503;
const __wm_tail_arg_161_1 = patterns_2504;
const __wm_tail_arg_161_2 = __wm_basis_Cons([concrete_2507, output_2505]);
params_2497 = __wm_tail_arg_161_0;
patterns_2498 = __wm_tail_arg_161_1;
output_2499 = __wm_tail_arg_161_2;
continue __wm_tail_137;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizeParams_2496 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concretizeParams_2496__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizeFunctions_2508__wm_d3 = (functions_2509, expressions_2510, output_2511) => {
__wm_tail_138: while (true) {
{
const __wm_scalar_167_0 = functions_2509;
const __wm_scalar_167_1 = expressions_2510;
const __wm_scalar_167_2 = output_2511;
if (__wm_scalar_167_0 === __wm_basis_Nil) {
const expressions_2512 = __wm_scalar_167_1;
const output_2513 = __wm_scalar_167_2;
return reverseInto_1963__wm_d2(output_2513, __wm_basis_Nil);
} else if (__wm_scalar_167_0?.ctor === -6 && __wm_scalar_167_0.args.length === 1 && __wm_is_tuple(__wm_scalar_167_0.args[0]) && __wm_scalar_167_0.args[0].length === 2) {
const fn_2514 = __wm_scalar_167_0.args[0][0];
const rest_2515 = __wm_scalar_167_0.args[0][1];
const expressions_2516 = __wm_scalar_167_1;
const output_2517 = __wm_scalar_167_2;
{
const body_2518 = findExpression_1997__wm_d2(expressions_2516, fn_2514.bodyExprId);
const concrete_2519 = { ...fn_2514, resultTypeId: body_2518.typeId };
{
const __wm_tail_arg_162_0 = rest_2515;
const __wm_tail_arg_162_1 = expressions_2516;
const __wm_tail_arg_162_2 = __wm_basis_Cons([concrete_2519, output_2517]);
functions_2509 = __wm_tail_arg_162_0;
expressions_2510 = __wm_tail_arg_162_1;
output_2511 = __wm_tail_arg_162_2;
continue __wm_tail_138;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizeFunctions_2508 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concretizeFunctions_2508__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const uniformShaderTypeId_2520__wm_d4 = (expressions_2521, occurrences_2522, index_2523, fallback_2524) => {
__wm_tail_139: while (true) {
{
const __wm_scalar_168_0 = expressions_2521;
const __wm_scalar_168_1 = occurrences_2522;
const __wm_scalar_168_2 = index_2523;
const __wm_scalar_168_3 = fallback_2524;
if (__wm_scalar_168_0 === __wm_basis_Nil) {
const occurrences_2525 = __wm_scalar_168_1;
const index_2526 = __wm_scalar_168_2;
const fallback_2527 = __wm_scalar_168_3;
return fallback_2527;
} else if (__wm_scalar_168_0?.ctor === -6 && __wm_scalar_168_0.args.length === 1 && __wm_is_tuple(__wm_scalar_168_0.args[0]) && __wm_scalar_168_0.args[0].length === 2) {
const expression_2528 = __wm_scalar_168_0.args[0][0];
const rest_2529 = __wm_scalar_168_0.args[0][1];
const occurrences_2530 = __wm_scalar_168_1;
const index_2531 = __wm_scalar_168_2;
const fallback_2532 = __wm_scalar_168_3;
if (__wm_op_and_d2(__wm_eq(expression_2528.kind, "uniform"), numberEqual_1986__wm_d2(expression_2528.index, index_2531))) {
{
const occurrence_2533 = findOccurrence_2462__wm_d3(occurrences_2530, "expression", expression_2528.id);
return occurrence_2533.shaderTypeId;
}
} else {
{
const __wm_tail_arg_163_0 = rest_2529;
const __wm_tail_arg_163_1 = occurrences_2530;
const __wm_tail_arg_163_2 = index_2531;
const __wm_tail_arg_163_3 = fallback_2532;
expressions_2521 = __wm_tail_arg_163_0;
occurrences_2522 = __wm_tail_arg_163_1;
index_2523 = __wm_tail_arg_163_2;
fallback_2524 = __wm_tail_arg_163_3;
continue __wm_tail_139;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const uniformShaderTypeId_2520 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return uniformShaderTypeId_2520__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizeEnvironmentFields_2534__wm_d4 = (fields_2535, expressions_2536, occurrences_2537, output_2538) => {
__wm_tail_140: while (true) {
{
const __wm_scalar_169_0 = fields_2535;
const __wm_scalar_169_1 = expressions_2536;
const __wm_scalar_169_2 = occurrences_2537;
const __wm_scalar_169_3 = output_2538;
if (__wm_scalar_169_0 === __wm_basis_Nil) {
const expressions_2539 = __wm_scalar_169_1;
const occurrences_2540 = __wm_scalar_169_2;
const output_2541 = __wm_scalar_169_3;
return reverseInto_1963__wm_d2(output_2541, __wm_basis_Nil);
} else if (__wm_scalar_169_0?.ctor === -6 && __wm_scalar_169_0.args.length === 1 && __wm_is_tuple(__wm_scalar_169_0.args[0]) && __wm_scalar_169_0.args[0].length === 2) {
const field_2542 = __wm_scalar_169_0.args[0][0];
const rest_2543 = __wm_scalar_169_0.args[0][1];
const expressions_2544 = __wm_scalar_169_1;
const occurrences_2545 = __wm_scalar_169_2;
const output_2546 = __wm_scalar_169_3;
{
const concrete_2547 = { ...field_2542, typeId: uniformShaderTypeId_2520__wm_d4(expressions_2544, occurrences_2545, field_2542.declaredIndex, field_2542.typeId) };
{
const __wm_tail_arg_164_0 = rest_2543;
const __wm_tail_arg_164_1 = expressions_2544;
const __wm_tail_arg_164_2 = occurrences_2545;
const __wm_tail_arg_164_3 = __wm_basis_Cons([concrete_2547, output_2546]);
fields_2535 = __wm_tail_arg_164_0;
expressions_2536 = __wm_tail_arg_164_1;
occurrences_2537 = __wm_tail_arg_164_2;
output_2538 = __wm_tail_arg_164_3;
continue __wm_tail_140;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizeEnvironmentFields_2534 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return concretizeEnvironmentFields_2534__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const compileSliceProgram_2568 = (__arg) => {
if (true) {
const input_2548 = __arg;
const elaboration_2549 = elaborateSliceProgramTypes_2232(input_2548);
const shaderTypes_2550 = elaboration_2549.shaderTypes;
const occurrences_2551 = Js.Array.toList(elaboration_2549.occurrences);
const sourceExpressions_2552 = Js.Array.toList(input_2548.expressions);
const concreteExpressions_2553 = concretizeExpressions_2472__wm_d3(sourceExpressions_2552, occurrences_2551, __wm_basis_Nil);
const concretePatterns_2554 = concretizePatterns_2484__wm_d3(Js.Array.toList(input_2548.patterns), occurrences_2551, __wm_basis_Nil);
const elaboratedInput_2555 = { ...input_2548, types: shaderTypes_2550, environmentFields: Js.Array.fromList(concretizeEnvironmentFields_2534__wm_d4(Js.Array.toList(input_2548.environmentFields), sourceExpressions_2552, occurrences_2551, __wm_basis_Nil)), functions: Js.Array.fromList(concretizeFunctions_2508__wm_d3(Js.Array.toList(input_2548.functions), concreteExpressions_2553, __wm_basis_Nil)), patterns: Js.Array.fromList(concretePatterns_2554), params: Js.Array.fromList(concretizeParams_2496__wm_d3(Js.Array.toList(input_2548.params), concretePatterns_2554, __wm_basis_Nil)), expressions: Js.Array.fromList(concreteExpressions_2553) };
const builtinCatalog_2556 = elaboratedInput_2555.builtinCatalog;
const context_2557 = { expressions: Js.Array.toList(elaboratedInput_2555.expressions), blocks: Js.Array.toList(elaboratedInput_2555.blocks), blockItems: Js.Array.toList(elaboratedInput_2555.blockItems), lets: Js.Array.toList(elaboratedInput_2555.lets), matches: Js.Array.toList(elaboratedInput_2555.matches), matchArms: Js.Array.toList(elaboratedInput_2555.matchArms), patterns: Js.Array.toList(elaboratedInput_2555.patterns), types: Js.Array.toList(elaboratedInput_2555.types), adts: Js.Array.toList(elaboratedInput_2555.adts), functions: Js.Array.toList(elaboratedInput_2555.functions), builtinOverloads: Js.Array.toList(builtinCatalog_2556.overloads), occurrences: occurrences_2551 };
const state_2558 = buildFunctions_2448__wm_d3(Js.Array.toList(elaboratedInput_2555.functions), context_2557, initialState_2248(undefined));
const layouts_2559 = buildSliceLayouts_140(elaboratedInput_2555);
const irFunctions_2560 = Js.Array.fromList(reverseInto_1963__wm_d2(state_2558.functions, __wm_basis_Nil));
const irExpressions_2561 = Js.Array.fromList(reverseInto_1963__wm_d2(state_2558.expressions, __wm_basis_Nil));
const irMatchArms_2562 = Js.Array.fromList(reverseInto_1963__wm_d2(state_2558.matchArms, __wm_basis_Nil));
const lowered_2563 = lowerSliceProgram_891__wm_d8(irFunctions_2560, irExpressions_2561, irMatchArms_2562, elaboratedInput_2555.params, elaboratedInput_2555.patterns, elaboratedInput_2555.constructors, layouts_2559.adtLayouts, layouts_2559.adtFields);
const slangModule_2564 = ((__v) => {
if (__v === __wm_basis_Nil) {

return emitSliceSlangModule_1417__wm_d10(elaboratedInput_2555, layouts_2559.adtLayouts, layouts_2559.adtFields, lowered_2563.functions, lowered_2563.locals, lowered_2563.atoms, lowered_2563.operations, lowered_2563.statements, lowered_2563.blocks, lowered_2563.cases);
} else if (true) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
})(state_2558.diagnostics);
const callableName_2565 = ((__v) => {
if (__v === __wm_basis_Nil) {

return emitSliceCallableName_1419(elaboratedInput_2555);
} else if (true) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
})(state_2558.diagnostics);
const slangSource_2566 = ((__v) => {
if (__v === __wm_basis_Nil) {

return emitSliceSlang_1431__wm_d10(elaboratedInput_2555, layouts_2559.adtLayouts, layouts_2559.adtFields, lowered_2563.functions, lowered_2563.locals, lowered_2563.atoms, lowered_2563.operations, lowered_2563.statements, lowered_2563.blocks, lowered_2563.cases);
} else if (true) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
})(state_2558.diagnostics);
const output_2567 = { schemaVersion: 5, program: input_2548, shaderTypes: shaderTypes_2550, typeEvidence: elaboration_2549.typeEvidence, occurrences: elaboration_2549.occurrences, builtinSelections: elaboration_2549.builtinSelections, irFunctions: irFunctions_2560, irExpressions: irExpressions_2561, irMatchArms: irMatchArms_2562, adtLayouts: layouts_2559.adtLayouts, adtFields: layouts_2559.adtFields, loweredFunctions: lowered_2563.functions, loweredLocals: lowered_2563.locals, loweredAtoms: lowered_2563.atoms, loweredOperations: lowered_2563.operations, loweredStatements: lowered_2563.statements, loweredBlocks: lowered_2563.blocks, loweredCases: lowered_2563.cases, slangModule: slangModule_2564, callableName: callableName_2565, slangSource: slangSource_2566, diagnostics: Js.Array.fromList(reverseInto_1963__wm_d2(state_2558.diagnostics, __wm_basis_Nil)) };
return output_2567;
}
__wm_fail("Match", "pattern match failure in function");
};
return { "SliceContext": SliceContext_1960, "SliceIrState": SliceIrState_1961, "BuiltBlockItem": BuiltBlockItem_1962, "reverseInto": reverseInto_1963, "reverseInto__wm_d2": reverseInto_1963__wm_d2, "append": append_1970, "append__wm_d2": append_1970__wm_d2, "listLength": listLength_1977, "listLength__wm_d2": listLength_1977__wm_d2, "numberEqual": numberEqual_1986, "numberEqual__wm_d2": numberEqual_1986__wm_d2, "contains": contains_1987, "contains__wm_d2": contains_1987__wm_d2, "unique": unique_1992, "unique__wm_d2": unique_1992__wm_d2, "findExpression": findExpression_1997, "findExpression__wm_d2": findExpression_1997__wm_d2, "findBlock": findBlock_2004, "findBlock__wm_d2": findBlock_2004__wm_d2, "findBlockItem": findBlockItem_2011, "findBlockItem__wm_d2": findBlockItem_2011__wm_d2, "findLet": findLet_2018, "findLet__wm_d2": findLet_2018__wm_d2, "findMatch": findMatch_2025, "findMatch__wm_d2": findMatch_2025__wm_d2, "findMatchArm": findMatchArm_2032, "findMatchArm__wm_d2": findMatchArm_2032__wm_d2, "findPattern": findPattern_2039, "findPattern__wm_d2": findPattern_2039__wm_d2, "findType": findType_2046, "findType__wm_d2": findType_2046__wm_d2, "findExpressionOccurrence": findExpressionOccurrence_2053, "findExpressionOccurrence__wm_d2": findExpressionOccurrence_2053__wm_d2, "shaderBuiltinTypeName": shaderBuiltinTypeName_2070, "shaderBuiltinTypeName__wm_d2": shaderBuiltinTypeName_2070__wm_d2, "builtinParamsMatch": builtinParamsMatch_2071, "builtinParamsMatch__wm_d3": builtinParamsMatch_2071__wm_d3, "selectBuiltinOverload": selectBuiltinOverload_2083, "selectBuiltinOverload__wm_d3": selectBuiltinOverload_2083__wm_d3, "collectBuiltinSelections": collectBuiltinSelections_2093, "collectBuiltinSelections__wm_d3": collectBuiltinSelections_2093__wm_d3, "allSemanticNumbers": allSemanticNumbers_2104, "allSemanticNumbers__wm_d2": allSemanticNumbers_2104__wm_d2, "shaderTypeKind": shaderTypeKind_2116, "shaderTypeKind__wm_d2": shaderTypeKind_2116__wm_d2, "shaderTypeReason": shaderTypeReason_2119, "shaderTypeReason__wm_d2": shaderTypeReason_2119__wm_d2, "offsetTypeIds": offsetTypeIds_2120, "offsetTypeIds__wm_d3": offsetTypeIds_2120__wm_d3, "addI32ShaderTypes": addI32ShaderTypes_2130, "addI32ShaderTypes__wm_d4": addI32ShaderTypes_2130__wm_d4, "concreteShaderTypeId": concreteShaderTypeId_2154, "concreteShaderTypeId__wm_d4": concreteShaderTypeId_2154__wm_d4, "elaborateSliceTypes": elaborateSliceTypes_2155, "elaborateSliceTypes__wm_d4": elaborateSliceTypes_2155__wm_d4, "addExpressionOccurrences": addExpressionOccurrences_2171, "addExpressionOccurrences__wm_d5": addExpressionOccurrences_2171__wm_d5, "addPatternOccurrences": addPatternOccurrences_2189, "addPatternOccurrences__wm_d6": addPatternOccurrences_2189__wm_d6, "addFunctionOccurrences": addFunctionOccurrences_2210, "addFunctionOccurrences__wm_d2": addFunctionOccurrences_2210__wm_d2, "elaborateSliceProgramTypes": elaborateSliceProgramTypes_2232, "findAdt": findAdt_2233, "findAdt__wm_d2": findAdt_2233__wm_d2, "findFunction": findFunction_2240, "findFunction__wm_d2": findFunction_2240__wm_d2, "initialState": initialState_2248, "baseIrExpression": baseIrExpression_2254, "baseIrExpression__wm_d4": baseIrExpression_2254__wm_d4, "addExpression": addExpression_2258, "addExpression__wm_d2": addExpression_2258__wm_d2, "addDiagnostic": addDiagnostic_2262, "addDiagnostic__wm_d2": addDiagnostic_2262__wm_d2, "nonTailDiagnostic": nonTailDiagnostic_2267, "nonTailDiagnostic__wm_d2": nonTailDiagnostic_2267__wm_d2, "nonExhaustiveDiagnostic": nonExhaustiveDiagnostic_2270, "constructorPatterns": constructorPatterns_2271, "constructorPatterns__wm_d4": constructorPatterns_2271__wm_d4, "matchIsExhaustive": matchIsExhaustive_2286, "matchIsExhaustive__wm_d3": matchIsExhaustive_2286__wm_d3, "constructorSetContains": constructorSetContains_2287, "constructorSetContains__wm_d2": constructorSetContains_2287__wm_d2, "buildExpression": buildExpression_2302, "buildExpression__wm_d5": buildExpression_2302__wm_d5, "buildChildren": buildChildren_2303, "buildChildren__wm_d5": buildChildren_2303__wm_d5, "buildIf": buildIf_2304, "buildIf__wm_d5": buildIf_2304__wm_d5, "buildMatch": buildMatch_2305, "buildMatch__wm_d5": buildMatch_2305__wm_d5, "buildMatchArms": buildMatchArms_2306, "buildMatchArms__wm_d6": buildMatchArms_2306__wm_d6, "buildBlock": buildBlock_2307, "buildBlock__wm_d5": buildBlock_2307__wm_d5, "buildBlockValues": buildBlockValues_2308, "buildBlockValues__wm_d5": buildBlockValues_2308__wm_d5, "buildBlockWrappers": buildBlockWrappers_2309, "buildBlockWrappers__wm_d6": buildBlockWrappers_2309__wm_d6, "buildFunctions": buildFunctions_2448, "buildFunctions__wm_d3": buildFunctions_2448__wm_d3, "findOccurrence": findOccurrence_2462, "findOccurrence__wm_d3": findOccurrence_2462__wm_d3, "concretizeExpressions": concretizeExpressions_2472, "concretizeExpressions__wm_d3": concretizeExpressions_2472__wm_d3, "concretizePatterns": concretizePatterns_2484, "concretizePatterns__wm_d3": concretizePatterns_2484__wm_d3, "concretizeParams": concretizeParams_2496, "concretizeParams__wm_d3": concretizeParams_2496__wm_d3, "concretizeFunctions": concretizeFunctions_2508, "concretizeFunctions__wm_d3": concretizeFunctions_2508__wm_d3, "uniformShaderTypeId": uniformShaderTypeId_2520, "uniformShaderTypeId__wm_d4": uniformShaderTypeId_2520__wm_d4, "concretizeEnvironmentFields": concretizeEnvironmentFields_2534, "concretizeEnvironmentFields__wm_d4": concretizeEnvironmentFields_2534__wm_d4, "compileSliceProgram": compileSliceProgram_2568 };
  },
  (value) => { __wm_module_6 = value; },
);
let __wm_module_7;
__wm_define_module(
  "__wm_module_7",
  ["__wm_module_0", "__wm_module_6"],
  async () => {
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
const compileSliceProgram_2568 = __wm_module_6["compileSliceProgram"];
const elaborateSliceProgramTypes_2232 = __wm_module_6["elaborateSliceProgramTypes"];
const SpecializationRegistryEntry_2569 = (__record_args) => ({ specializationId: __record_args[0], paramRepresentations: __record_args[1], resultRepresentation: __record_args[2] });
const SpecializationBuildState_2570 = (__record_args) => ({ nextId: __record_args[0], registry: __record_args[1], specializations: __record_args[2], rootSpecializations: __record_args[3], calls: __record_args[4], diagnostics: __record_args[5] });
const IrBuildState_2571 = (__record_args) => ({ nextExpressionId: __record_args[0], functions: __record_args[1], expressions: __record_args[2] });
const typedExpression_2574 = (__arg) => {
if (true) {
const expression_2572 = __arg;
const output_2573 = { id: expression_2572.id, kind: expression_2572.kind, typeId: expression_2572.typeId, spanId: expression_2572.spanId, bindingId: expression_2572.bindingId, name: expression_2572.name, operator: expression_2572.operator, numberValue: expression_2572.numberValue, boolValue: expression_2572.boolValue, children: expression_2572.children, capability: expression_2572.capability };
return output_2573;
}
__wm_fail("Match", "pattern match failure in function");
};
const typedFunction_2579__wm_d2 = (reachable_2575, fn_2576) => {
const capability_2577 = (__wm_eq(fn_2576.capability, "gpu-only") ? "gpu-only" : (Map.has([reachable_2575, fn_2576.id]) ? "gpu-eligible" : "cpu-only"));
const output_2578 = { id: fn_2576.id, regionId: fn_2576.regionId, bindingId: fn_2576.bindingId, name: fn_2576.name, params: fn_2576.params, resultTypeId: fn_2576.resultTypeId, bodyExprId: fn_2576.bodyExprId, spanId: fn_2576.spanId, capability: capability_2577 };
return output_2578;
};
const typedFunction_2579 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return typedFunction_2579__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emptyOutput_2581 = (__arg) => {
if (__arg === undefined) {

const output_2580 = { schemaVersion: 1, functions: Js.Array.fromList(__wm_basis_Nil), captures: Js.Array.fromList(__wm_basis_Nil), specializations: Js.Array.fromList(__wm_basis_Nil), rootSpecializations: Js.Array.fromList(__wm_basis_Nil), calls: Js.Array.fromList(__wm_basis_Nil), irFunctions: Js.Array.fromList(__wm_basis_Nil), irExpressions: Js.Array.fromList(__wm_basis_Nil), types: Js.Array.fromList(__wm_basis_Nil), expressions: Js.Array.fromList(__wm_basis_Nil), diagnostics: Js.Array.fromList(__wm_basis_Nil) };
return output_2580;
}
__wm_fail("Match", "pattern match failure in function");
};
const incompatibleSchema_2585 = (__arg) => {
if (true) {
const version_2582 = __arg;
const diagnostic_2583 = { code: "gpu.schema-version", message: "unsupported GPU elaboration schema version", spanId: __wm_op_sub(1) };
const output_2584 = { schemaVersion: 1, functions: Js.Array.fromList(__wm_basis_Nil), captures: Js.Array.fromList(__wm_basis_Nil), specializations: Js.Array.fromList(__wm_basis_Nil), rootSpecializations: Js.Array.fromList(__wm_basis_Nil), calls: Js.Array.fromList(__wm_basis_Nil), irFunctions: Js.Array.fromList(__wm_basis_Nil), irExpressions: Js.Array.fromList(__wm_basis_Nil), types: Js.Array.fromList(__wm_basis_Nil), expressions: Js.Array.fromList(__wm_basis_Nil), diagnostics: Js.Array.fromList(__wm_basis_Cons([diagnostic_2583, __wm_basis_Nil])) };
return output_2584;
}
__wm_fail("Match", "pattern match failure in function");
};
const prependAll_2586__wm_d2 = (items_2587, tail_2588) => {
const __wm_scalar_170_0 = items_2587;
const __wm_scalar_170_1 = tail_2588;
if (__wm_scalar_170_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_170_1, tail_2588)) {

return tail_2588;
} else if (__wm_scalar_170_0?.ctor === -6 && __wm_scalar_170_0.args.length === 1 && __wm_is_tuple(__wm_scalar_170_0.args[0]) && __wm_scalar_170_0.args[0].length === 2 && __wm_eq(__wm_scalar_170_1, tail_2588)) {
const head_2589 = __wm_scalar_170_0.args[0][0];
const rest_2590 = __wm_scalar_170_0.args[0][1];
return __wm_basis_Cons([head_2589, prependAll_2586__wm_d2(rest_2590, tail_2588)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const prependAll_2586 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return prependAll_2586__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const reverseInto_2591__wm_d2 = (items_2592, reversed_2593) => {
__wm_tail_141: while (true) {
{
const __wm_scalar_171_0 = items_2592;
const __wm_scalar_171_1 = reversed_2593;
if (__wm_scalar_171_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_171_1, reversed_2593)) {

return reversed_2593;
} else if (__wm_scalar_171_0?.ctor === -6 && __wm_scalar_171_0.args.length === 1 && __wm_is_tuple(__wm_scalar_171_0.args[0]) && __wm_scalar_171_0.args[0].length === 2 && __wm_eq(__wm_scalar_171_1, reversed_2593)) {
const head_2594 = __wm_scalar_171_0.args[0][0];
const rest_2595 = __wm_scalar_171_0.args[0][1];
{
const __wm_tail_arg_165_0 = rest_2595;
const __wm_tail_arg_165_1 = __wm_basis_Cons([head_2594, reversed_2593]);
items_2592 = __wm_tail_arg_165_0;
reversed_2593 = __wm_tail_arg_165_1;
continue __wm_tail_141;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reverseInto_2591 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reverseInto_2591__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const capabilityDiagnostic_2599 = (__arg) => {
if (true) {
const expression_2596 = __arg;
if (__wm_eq(expression_2596.capability, "host-ffi")) {
const diagnostic_2597 = { code: "gpu.host-ffi", message: "host FFI expression cannot execute in a GPU region", spanId: expression_2596.spanId };
return __wm_basis_Some(diagnostic_2597);
} else {
if (__wm_eq(expression_2596.capability, "unsupported")) {
const diagnostic_2598 = { code: "gpu.unsupported-expression", message: "expression is not supported by the current GPU language subset", spanId: expression_2596.spanId };
return __wm_basis_Some(diagnostic_2598);
} else {
return __wm_basis_None;
}
}
}
__wm_fail("Match", "pattern match failure in function");
};
const reachableBodyIds_2600__wm_d3 = (functions_2601, reachable_2602, bodyIds_2603) => {
__wm_tail_142: while (true) {
{
const __wm_scalar_172_0 = functions_2601;
const __wm_scalar_172_1 = reachable_2602;
const __wm_scalar_172_2 = bodyIds_2603;
if (__wm_scalar_172_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_172_1, reachable_2602) && __wm_eq(__wm_scalar_172_2, bodyIds_2603)) {

return bodyIds_2603;
} else if (__wm_scalar_172_0?.ctor === -6 && __wm_scalar_172_0.args.length === 1 && __wm_is_tuple(__wm_scalar_172_0.args[0]) && __wm_scalar_172_0.args[0].length === 2 && __wm_eq(__wm_scalar_172_1, reachable_2602) && __wm_eq(__wm_scalar_172_2, bodyIds_2603)) {
const fn_2604 = __wm_scalar_172_0.args[0][0];
const rest_2605 = __wm_scalar_172_0.args[0][1];
if (Map.has([reachable_2602, fn_2604.id])) {
{
const __wm_tail_arg_166_0 = rest_2605;
const __wm_tail_arg_166_1 = reachable_2602;
const __wm_tail_arg_166_2 = __wm_basis_Cons([fn_2604.bodyExprId, bodyIds_2603]);
functions_2601 = __wm_tail_arg_166_0;
reachable_2602 = __wm_tail_arg_166_1;
bodyIds_2603 = __wm_tail_arg_166_2;
continue __wm_tail_142;
}
} else {
{
const __wm_tail_arg_167_0 = rest_2605;
const __wm_tail_arg_167_1 = reachable_2602;
const __wm_tail_arg_167_2 = bodyIds_2603;
functions_2601 = __wm_tail_arg_167_0;
reachable_2602 = __wm_tail_arg_167_1;
bodyIds_2603 = __wm_tail_arg_167_2;
continue __wm_tail_142;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reachableBodyIds_2600 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return reachableBodyIds_2600__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const reachableCapabilityDiagnostics_2606__wm_d4 = (pending_2607, expressionRegistry_2608, visited_2609, diagnostics_2610) => {
__wm_tail_143: while (true) {
{
const __wm_scalar_173_0 = pending_2607;
const __wm_scalar_173_1 = expressionRegistry_2608;
const __wm_scalar_173_2 = visited_2609;
const __wm_scalar_173_3 = diagnostics_2610;
if (__wm_scalar_173_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_173_1, expressionRegistry_2608) && __wm_eq(__wm_scalar_173_2, visited_2609) && __wm_eq(__wm_scalar_173_3, diagnostics_2610)) {

return diagnostics_2610;
} else if (__wm_scalar_173_0?.ctor === -6 && __wm_scalar_173_0.args.length === 1 && __wm_is_tuple(__wm_scalar_173_0.args[0]) && __wm_scalar_173_0.args[0].length === 2 && __wm_eq(__wm_scalar_173_1, expressionRegistry_2608) && __wm_eq(__wm_scalar_173_2, visited_2609) && __wm_eq(__wm_scalar_173_3, diagnostics_2610)) {
const expressionId_2611 = __wm_scalar_173_0.args[0][0];
const rest_2612 = __wm_scalar_173_0.args[0][1];
if (Map.has([visited_2609, expressionId_2611])) {
{
const __wm_tail_arg_168_0 = rest_2612;
const __wm_tail_arg_168_1 = expressionRegistry_2608;
const __wm_tail_arg_168_2 = visited_2609;
const __wm_tail_arg_168_3 = diagnostics_2610;
pending_2607 = __wm_tail_arg_168_0;
expressionRegistry_2608 = __wm_tail_arg_168_1;
visited_2609 = __wm_tail_arg_168_2;
diagnostics_2610 = __wm_tail_arg_168_3;
continue __wm_tail_143;
}
} else {
{
const nextVisited_2613 = Map.set([visited_2609, expressionId_2611, true]);
{
const __wm_tail_value_169 = Map.get([expressionRegistry_2608, expressionId_2611]);
if (__wm_tail_value_169 === __wm_basis_None) {

{
const __wm_tail_arg_170_0 = rest_2612;
const __wm_tail_arg_170_1 = expressionRegistry_2608;
const __wm_tail_arg_170_2 = nextVisited_2613;
const __wm_tail_arg_170_3 = diagnostics_2610;
pending_2607 = __wm_tail_arg_170_0;
expressionRegistry_2608 = __wm_tail_arg_170_1;
visited_2609 = __wm_tail_arg_170_2;
diagnostics_2610 = __wm_tail_arg_170_3;
continue __wm_tail_143;
}
} else if (__wm_tail_value_169?.ctor === -2 && __wm_tail_value_169.args.length === 1) {
const expression_2614 = __wm_tail_value_169.args[0];
{
const nextDiagnostics_2616 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const diagnostic_2615 = __v.args[0];
return __wm_basis_Cons([diagnostic_2615, diagnostics_2610]);
} else if (__v === __wm_basis_None) {

return diagnostics_2610;
}
__wm_fail("Match", "non-exhaustive match");
})(capabilityDiagnostic_2599(expression_2614));
{
const __wm_tail_arg_171_0 = prependAll_2586__wm_d2(Js.Array.toList(expression_2614.children), rest_2612);
const __wm_tail_arg_171_1 = expressionRegistry_2608;
const __wm_tail_arg_171_2 = nextVisited_2613;
const __wm_tail_arg_171_3 = nextDiagnostics_2616;
pending_2607 = __wm_tail_arg_171_0;
expressionRegistry_2608 = __wm_tail_arg_171_1;
visited_2609 = __wm_tail_arg_171_2;
diagnostics_2610 = __wm_tail_arg_171_3;
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
const reachableCapabilityDiagnostics_2606 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return reachableCapabilityDiagnostics_2606__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const duplicateFunctionDiagnostic_2619 = (__arg) => {
if (true) {
const fn_2617 = __arg;
const diagnostic_2618 = { code: "gpu.duplicate-function-id", message: "duplicate function ID in GPU elaboration input", spanId: fn_2617.spanId };
return diagnostic_2618;
}
__wm_fail("Match", "pattern match failure in function");
};
const registerFunctions_2620__wm_d3 = (functions_2621, registry_2622, diagnostics_2623) => {
__wm_tail_144: while (true) {
{
const __wm_scalar_174_0 = functions_2621;
const __wm_scalar_174_1 = registry_2622;
const __wm_scalar_174_2 = diagnostics_2623;
if (__wm_scalar_174_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_174_1, registry_2622) && __wm_eq(__wm_scalar_174_2, diagnostics_2623)) {

return [registry_2622, diagnostics_2623];
} else if (__wm_scalar_174_0?.ctor === -6 && __wm_scalar_174_0.args.length === 1 && __wm_is_tuple(__wm_scalar_174_0.args[0]) && __wm_scalar_174_0.args[0].length === 2 && __wm_eq(__wm_scalar_174_1, registry_2622) && __wm_eq(__wm_scalar_174_2, diagnostics_2623)) {
const fn_2624 = __wm_scalar_174_0.args[0][0];
const rest_2625 = __wm_scalar_174_0.args[0][1];
if (Map.has([registry_2622, fn_2624.id])) {
{
const __wm_tail_arg_172_0 = rest_2625;
const __wm_tail_arg_172_1 = registry_2622;
const __wm_tail_arg_172_2 = __wm_basis_Cons([duplicateFunctionDiagnostic_2619(fn_2624), diagnostics_2623]);
functions_2621 = __wm_tail_arg_172_0;
registry_2622 = __wm_tail_arg_172_1;
diagnostics_2623 = __wm_tail_arg_172_2;
continue __wm_tail_144;
}
} else {
{
const __wm_tail_arg_173_0 = rest_2625;
const __wm_tail_arg_173_1 = Map.set([registry_2622, fn_2624.id, fn_2624]);
const __wm_tail_arg_173_2 = diagnostics_2623;
functions_2621 = __wm_tail_arg_173_0;
registry_2622 = __wm_tail_arg_173_1;
diagnostics_2623 = __wm_tail_arg_173_2;
continue __wm_tail_144;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const registerFunctions_2620 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return registerFunctions_2620__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const indexFunctionBindings_2626__wm_d2 = (functions_2627, registry_2628) => {
__wm_tail_145: while (true) {
{
const __wm_scalar_175_0 = functions_2627;
const __wm_scalar_175_1 = registry_2628;
if (__wm_scalar_175_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_175_1, registry_2628)) {

return registry_2628;
} else if (__wm_scalar_175_0?.ctor === -6 && __wm_scalar_175_0.args.length === 1 && __wm_is_tuple(__wm_scalar_175_0.args[0]) && __wm_scalar_175_0.args[0].length === 2 && __wm_eq(__wm_scalar_175_1, registry_2628)) {
const fn_2629 = __wm_scalar_175_0.args[0][0];
const rest_2630 = __wm_scalar_175_0.args[0][1];
if ((fn_2629.bindingId < 0)) {
{
const __wm_tail_arg_174_0 = rest_2630;
const __wm_tail_arg_174_1 = registry_2628;
functions_2627 = __wm_tail_arg_174_0;
registry_2628 = __wm_tail_arg_174_1;
continue __wm_tail_145;
}
} else {
{
const __wm_tail_arg_175_0 = rest_2630;
const __wm_tail_arg_175_1 = Map.set([registry_2628, fn_2629.bindingId, fn_2629.id]);
functions_2627 = __wm_tail_arg_175_0;
registry_2628 = __wm_tail_arg_175_1;
continue __wm_tail_145;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexFunctionBindings_2626 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexFunctionBindings_2626__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const callDependency_2637__wm_d3 = (expression_2631, expressionRegistry_2632, bindingFunctions_2633) => {
if (__wm_eq(expression_2631.kind, "call")) {
const __wm_return_value_52 = Js.Array.toList(expression_2631.children);
if (__wm_return_value_52?.ctor === -6 && __wm_return_value_52.args.length === 1 && __wm_is_tuple(__wm_return_value_52.args[0]) && __wm_return_value_52.args[0].length === 2) {
const calleeId_2634 = __wm_return_value_52.args[0][0];
const _rest_2635 = __wm_return_value_52.args[0][1];
const __wm_return_value_53 = Map.get([expressionRegistry_2632, calleeId_2634]);
if (__wm_return_value_53?.ctor === -2 && __wm_return_value_53.args.length === 1) {
const callee_2636 = __wm_return_value_53.args[0];
return Map.get([bindingFunctions_2633, callee_2636.bindingId]);
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
const callDependency_2637 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return callDependency_2637__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const collectFunctionDependencies_2638__wm_d5 = (pending_2639, expressionRegistry_2640, bindingFunctions_2641, visited_2642, dependencies_2643) => {
__wm_tail_146: while (true) {
{
const __wm_scalar_176_0 = pending_2639;
const __wm_scalar_176_1 = expressionRegistry_2640;
const __wm_scalar_176_2 = bindingFunctions_2641;
const __wm_scalar_176_3 = visited_2642;
const __wm_scalar_176_4 = dependencies_2643;
if (__wm_scalar_176_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_176_1, expressionRegistry_2640) && __wm_eq(__wm_scalar_176_2, bindingFunctions_2641) && __wm_eq(__wm_scalar_176_3, visited_2642) && __wm_eq(__wm_scalar_176_4, dependencies_2643)) {

return dependencies_2643;
} else if (__wm_scalar_176_0?.ctor === -6 && __wm_scalar_176_0.args.length === 1 && __wm_is_tuple(__wm_scalar_176_0.args[0]) && __wm_scalar_176_0.args[0].length === 2 && __wm_eq(__wm_scalar_176_1, expressionRegistry_2640) && __wm_eq(__wm_scalar_176_2, bindingFunctions_2641) && __wm_eq(__wm_scalar_176_3, visited_2642) && __wm_eq(__wm_scalar_176_4, dependencies_2643)) {
const expressionId_2644 = __wm_scalar_176_0.args[0][0];
const rest_2645 = __wm_scalar_176_0.args[0][1];
if (Map.has([visited_2642, expressionId_2644])) {
{
const __wm_tail_arg_176_0 = rest_2645;
const __wm_tail_arg_176_1 = expressionRegistry_2640;
const __wm_tail_arg_176_2 = bindingFunctions_2641;
const __wm_tail_arg_176_3 = visited_2642;
const __wm_tail_arg_176_4 = dependencies_2643;
pending_2639 = __wm_tail_arg_176_0;
expressionRegistry_2640 = __wm_tail_arg_176_1;
bindingFunctions_2641 = __wm_tail_arg_176_2;
visited_2642 = __wm_tail_arg_176_3;
dependencies_2643 = __wm_tail_arg_176_4;
continue __wm_tail_146;
}
} else {
{
const nextVisited_2646 = Map.set([visited_2642, expressionId_2644, true]);
{
const __wm_tail_value_177 = Map.get([expressionRegistry_2640, expressionId_2644]);
if (__wm_tail_value_177 === __wm_basis_None) {

{
const __wm_tail_arg_178_0 = rest_2645;
const __wm_tail_arg_178_1 = expressionRegistry_2640;
const __wm_tail_arg_178_2 = bindingFunctions_2641;
const __wm_tail_arg_178_3 = nextVisited_2646;
const __wm_tail_arg_178_4 = dependencies_2643;
pending_2639 = __wm_tail_arg_178_0;
expressionRegistry_2640 = __wm_tail_arg_178_1;
bindingFunctions_2641 = __wm_tail_arg_178_2;
visited_2642 = __wm_tail_arg_178_3;
dependencies_2643 = __wm_tail_arg_178_4;
continue __wm_tail_146;
}
} else if (__wm_tail_value_177?.ctor === -2 && __wm_tail_value_177.args.length === 1) {
const expression_2647 = __wm_tail_value_177.args[0];
{
const nextDependencies_2649 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const functionId_2648 = __v.args[0];
return Map.set([dependencies_2643, functionId_2648, true]);
} else if (__v === __wm_basis_None) {

return dependencies_2643;
}
__wm_fail("Match", "non-exhaustive match");
})(callDependency_2637__wm_d3(expression_2647, expressionRegistry_2640, bindingFunctions_2641));
{
const __wm_tail_arg_179_0 = prependAll_2586__wm_d2(Js.Array.toList(expression_2647.children), rest_2645);
const __wm_tail_arg_179_1 = expressionRegistry_2640;
const __wm_tail_arg_179_2 = bindingFunctions_2641;
const __wm_tail_arg_179_3 = nextVisited_2646;
const __wm_tail_arg_179_4 = nextDependencies_2649;
pending_2639 = __wm_tail_arg_179_0;
expressionRegistry_2640 = __wm_tail_arg_179_1;
bindingFunctions_2641 = __wm_tail_arg_179_2;
visited_2642 = __wm_tail_arg_179_3;
dependencies_2643 = __wm_tail_arg_179_4;
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
const collectFunctionDependencies_2638 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return collectFunctionDependencies_2638__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const enqueueDependencies_2650__wm_d2 = (entries_2651, pending_2652) => {
__wm_tail_147: while (true) {
{
const __wm_scalar_177_0 = entries_2651;
const __wm_scalar_177_1 = pending_2652;
if (__wm_scalar_177_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_177_1, pending_2652)) {

return pending_2652;
} else if (__wm_scalar_177_0?.ctor === -6 && __wm_scalar_177_0.args.length === 1 && __wm_is_tuple(__wm_scalar_177_0.args[0]) && __wm_scalar_177_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_177_0.args[0][0]) && __wm_scalar_177_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_177_1, pending_2652)) {
const functionId_2653 = __wm_scalar_177_0.args[0][0][0];
const _reachable_2654 = __wm_scalar_177_0.args[0][0][1];
const rest_2655 = __wm_scalar_177_0.args[0][1];
{
const __wm_tail_arg_180_0 = rest_2655;
const __wm_tail_arg_180_1 = __wm_basis_Cons([functionId_2653, pending_2652]);
entries_2651 = __wm_tail_arg_180_0;
pending_2652 = __wm_tail_arg_180_1;
continue __wm_tail_147;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const enqueueDependencies_2650 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return enqueueDependencies_2650__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const rootFunctionIds_2656__wm_d2 = (roots_2657, functionIds_2658) => {
__wm_tail_148: while (true) {
{
const __wm_scalar_178_0 = roots_2657;
const __wm_scalar_178_1 = functionIds_2658;
if (__wm_scalar_178_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_178_1, functionIds_2658)) {

return functionIds_2658;
} else if (__wm_scalar_178_0?.ctor === -6 && __wm_scalar_178_0.args.length === 1 && __wm_is_tuple(__wm_scalar_178_0.args[0]) && __wm_scalar_178_0.args[0].length === 2 && __wm_eq(__wm_scalar_178_1, functionIds_2658)) {
const root_2659 = __wm_scalar_178_0.args[0][0];
const rest_2660 = __wm_scalar_178_0.args[0][1];
{
const __wm_tail_arg_181_0 = rest_2660;
const __wm_tail_arg_181_1 = __wm_basis_Cons([root_2659.functionId, functionIds_2658]);
roots_2657 = __wm_tail_arg_181_0;
functionIds_2658 = __wm_tail_arg_181_1;
continue __wm_tail_148;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const rootFunctionIds_2656 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return rootFunctionIds_2656__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const solveReachableFunctions_2661__wm_d5 = (pending_2662, functionRegistry_2663, expressionRegistry_2664, bindingFunctions_2665, reachable_2666) => {
__wm_tail_149: while (true) {
{
const __wm_scalar_179_0 = pending_2662;
const __wm_scalar_179_1 = functionRegistry_2663;
const __wm_scalar_179_2 = expressionRegistry_2664;
const __wm_scalar_179_3 = bindingFunctions_2665;
const __wm_scalar_179_4 = reachable_2666;
if (__wm_scalar_179_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_179_1, functionRegistry_2663) && __wm_eq(__wm_scalar_179_2, expressionRegistry_2664) && __wm_eq(__wm_scalar_179_3, bindingFunctions_2665) && __wm_eq(__wm_scalar_179_4, reachable_2666)) {

return reachable_2666;
} else if (__wm_scalar_179_0?.ctor === -6 && __wm_scalar_179_0.args.length === 1 && __wm_is_tuple(__wm_scalar_179_0.args[0]) && __wm_scalar_179_0.args[0].length === 2 && __wm_eq(__wm_scalar_179_1, functionRegistry_2663) && __wm_eq(__wm_scalar_179_2, expressionRegistry_2664) && __wm_eq(__wm_scalar_179_3, bindingFunctions_2665) && __wm_eq(__wm_scalar_179_4, reachable_2666)) {
const functionId_2667 = __wm_scalar_179_0.args[0][0];
const rest_2668 = __wm_scalar_179_0.args[0][1];
if (Map.has([reachable_2666, functionId_2667])) {
{
const __wm_tail_arg_182_0 = rest_2668;
const __wm_tail_arg_182_1 = functionRegistry_2663;
const __wm_tail_arg_182_2 = expressionRegistry_2664;
const __wm_tail_arg_182_3 = bindingFunctions_2665;
const __wm_tail_arg_182_4 = reachable_2666;
pending_2662 = __wm_tail_arg_182_0;
functionRegistry_2663 = __wm_tail_arg_182_1;
expressionRegistry_2664 = __wm_tail_arg_182_2;
bindingFunctions_2665 = __wm_tail_arg_182_3;
reachable_2666 = __wm_tail_arg_182_4;
continue __wm_tail_149;
}
} else {
{
const nextReachable_2669 = Map.set([reachable_2666, functionId_2667, true]);
{
const __wm_tail_value_183 = Map.get([functionRegistry_2663, functionId_2667]);
if (__wm_tail_value_183 === __wm_basis_None) {

{
const __wm_tail_arg_184_0 = rest_2668;
const __wm_tail_arg_184_1 = functionRegistry_2663;
const __wm_tail_arg_184_2 = expressionRegistry_2664;
const __wm_tail_arg_184_3 = bindingFunctions_2665;
const __wm_tail_arg_184_4 = nextReachable_2669;
pending_2662 = __wm_tail_arg_184_0;
functionRegistry_2663 = __wm_tail_arg_184_1;
expressionRegistry_2664 = __wm_tail_arg_184_2;
bindingFunctions_2665 = __wm_tail_arg_184_3;
reachable_2666 = __wm_tail_arg_184_4;
continue __wm_tail_149;
}
} else if (__wm_tail_value_183?.ctor === -2 && __wm_tail_value_183.args.length === 1) {
const fn_2670 = __wm_tail_value_183.args[0];
{
const dependencies_2671 = collectFunctionDependencies_2638__wm_d5(__wm_basis_Cons([fn_2670.bodyExprId, __wm_basis_Nil]), expressionRegistry_2664, bindingFunctions_2665, Map.empty(Map.numberCompare), Map.empty(Map.numberCompare));
{
const __wm_tail_arg_185_0 = enqueueDependencies_2650__wm_d2(Map.toList(dependencies_2671), rest_2668);
const __wm_tail_arg_185_1 = functionRegistry_2663;
const __wm_tail_arg_185_2 = expressionRegistry_2664;
const __wm_tail_arg_185_3 = bindingFunctions_2665;
const __wm_tail_arg_185_4 = nextReachable_2669;
pending_2662 = __wm_tail_arg_185_0;
functionRegistry_2663 = __wm_tail_arg_185_1;
expressionRegistry_2664 = __wm_tail_arg_185_2;
bindingFunctions_2665 = __wm_tail_arg_185_3;
reachable_2666 = __wm_tail_arg_185_4;
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
const solveReachableFunctions_2661 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return solveReachableFunctions_2661__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const indexBindings_2672__wm_d2 = (bindings_2673, registry_2674) => {
__wm_tail_150: while (true) {
{
const __wm_scalar_180_0 = bindings_2673;
const __wm_scalar_180_1 = registry_2674;
if (__wm_scalar_180_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_180_1, registry_2674)) {

return registry_2674;
} else if (__wm_scalar_180_0?.ctor === -6 && __wm_scalar_180_0.args.length === 1 && __wm_is_tuple(__wm_scalar_180_0.args[0]) && __wm_scalar_180_0.args[0].length === 2 && __wm_eq(__wm_scalar_180_1, registry_2674)) {
const binding_2675 = __wm_scalar_180_0.args[0][0];
const rest_2676 = __wm_scalar_180_0.args[0][1];
{
const __wm_tail_arg_186_0 = rest_2676;
const __wm_tail_arg_186_1 = Map.set([registry_2674, binding_2675.id, binding_2675]);
bindings_2673 = __wm_tail_arg_186_0;
registry_2674 = __wm_tail_arg_186_1;
continue __wm_tail_150;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexBindings_2672 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexBindings_2672__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const bindParams_2677__wm_d2 = (params_2678, bound_2679) => {
__wm_tail_151: while (true) {
{
const __wm_scalar_181_0 = params_2678;
const __wm_scalar_181_1 = bound_2679;
if (__wm_scalar_181_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_181_1, bound_2679)) {

return bound_2679;
} else if (__wm_scalar_181_0?.ctor === -6 && __wm_scalar_181_0.args.length === 1 && __wm_is_tuple(__wm_scalar_181_0.args[0]) && __wm_scalar_181_0.args[0].length === 2 && __wm_eq(__wm_scalar_181_1, bound_2679)) {
const param_2680 = __wm_scalar_181_0.args[0][0];
const rest_2681 = __wm_scalar_181_0.args[0][1];
{
const __wm_tail_arg_187_0 = rest_2681;
const __wm_tail_arg_187_1 = Map.set([bound_2679, param_2680.bindingId, true]);
params_2678 = __wm_tail_arg_187_0;
bound_2679 = __wm_tail_arg_187_1;
continue __wm_tail_151;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const bindParams_2677 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return bindParams_2677__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collectLocalBindings_2682__wm_d4 = (pending_2683, expressionRegistry_2684, visited_2685, bound_2686) => {
__wm_tail_152: while (true) {
{
const __wm_scalar_182_0 = pending_2683;
const __wm_scalar_182_1 = expressionRegistry_2684;
const __wm_scalar_182_2 = visited_2685;
const __wm_scalar_182_3 = bound_2686;
if (__wm_scalar_182_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_182_1, expressionRegistry_2684) && __wm_eq(__wm_scalar_182_2, visited_2685) && __wm_eq(__wm_scalar_182_3, bound_2686)) {

return bound_2686;
} else if (__wm_scalar_182_0?.ctor === -6 && __wm_scalar_182_0.args.length === 1 && __wm_is_tuple(__wm_scalar_182_0.args[0]) && __wm_scalar_182_0.args[0].length === 2 && __wm_eq(__wm_scalar_182_1, expressionRegistry_2684) && __wm_eq(__wm_scalar_182_2, visited_2685) && __wm_eq(__wm_scalar_182_3, bound_2686)) {
const expressionId_2687 = __wm_scalar_182_0.args[0][0];
const rest_2688 = __wm_scalar_182_0.args[0][1];
if (Map.has([visited_2685, expressionId_2687])) {
{
const __wm_tail_arg_188_0 = rest_2688;
const __wm_tail_arg_188_1 = expressionRegistry_2684;
const __wm_tail_arg_188_2 = visited_2685;
const __wm_tail_arg_188_3 = bound_2686;
pending_2683 = __wm_tail_arg_188_0;
expressionRegistry_2684 = __wm_tail_arg_188_1;
visited_2685 = __wm_tail_arg_188_2;
bound_2686 = __wm_tail_arg_188_3;
continue __wm_tail_152;
}
} else {
{
const nextVisited_2689 = Map.set([visited_2685, expressionId_2687, true]);
{
const __wm_tail_value_189 = Map.get([expressionRegistry_2684, expressionId_2687]);
if (__wm_tail_value_189 === __wm_basis_None) {

{
const __wm_tail_arg_190_0 = rest_2688;
const __wm_tail_arg_190_1 = expressionRegistry_2684;
const __wm_tail_arg_190_2 = nextVisited_2689;
const __wm_tail_arg_190_3 = bound_2686;
pending_2683 = __wm_tail_arg_190_0;
expressionRegistry_2684 = __wm_tail_arg_190_1;
visited_2685 = __wm_tail_arg_190_2;
bound_2686 = __wm_tail_arg_190_3;
continue __wm_tail_152;
}
} else if (__wm_tail_value_189?.ctor === -2 && __wm_tail_value_189.args.length === 1) {
const expression_2690 = __wm_tail_value_189.args[0];
{
const nextBound_2691 = (__wm_op_and_d2(__wm_eq(expression_2690.kind, "let"), (expression_2690.bindingId >= 0)) ? Map.set([bound_2686, expression_2690.bindingId, true]) : bound_2686);
{
const __wm_tail_arg_191_0 = prependAll_2586__wm_d2(Js.Array.toList(expression_2690.children), rest_2688);
const __wm_tail_arg_191_1 = expressionRegistry_2684;
const __wm_tail_arg_191_2 = nextVisited_2689;
const __wm_tail_arg_191_3 = nextBound_2691;
pending_2683 = __wm_tail_arg_191_0;
expressionRegistry_2684 = __wm_tail_arg_191_1;
visited_2685 = __wm_tail_arg_191_2;
bound_2686 = __wm_tail_arg_191_3;
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
const collectLocalBindings_2682 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return collectLocalBindings_2682__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const constantExpression_2692__wm_d5 = (expressionId_2694, expressionRegistry_2695, bindingRegistry_2696, visitedExpressions_2697, visitedBindings_2698) => {
__wm_tail_153: while (true) {
if (Map.has([visitedExpressions_2697, expressionId_2694])) {
return false;
} else {
{
const __wm_tail_value_192 = Map.get([expressionRegistry_2695, expressionId_2694]);
if (__wm_tail_value_192 === __wm_basis_None) {

return false;
} else if (__wm_tail_value_192?.ctor === -2 && __wm_tail_value_192.args.length === 1) {
const expression_2699 = __wm_tail_value_192.args[0];
{
const nextExpressions_2700 = Map.set([visitedExpressions_2697, expressionId_2694, true]);
if (__wm_op_or_d2(__wm_eq(expression_2699.kind, "number"), __wm_eq(expression_2699.kind, "bool"))) {
return true;
} else {
if (__wm_op_or_d2(__wm_op_or_d2(__wm_eq(expression_2699.kind, "tuple"), __wm_eq(expression_2699.kind, "binary")), __wm_eq(expression_2699.kind, "unary"))) {
return constantExpressions_2693__wm_d5(Js.Array.toList(expression_2699.children), expressionRegistry_2695, bindingRegistry_2696, nextExpressions_2700, visitedBindings_2698);
} else {
if (__wm_op_and_d2(__wm_eq(expression_2699.kind, "var"), (expression_2699.bindingId >= 0))) {
if (Map.has([visitedBindings_2698, expression_2699.bindingId])) {
return false;
} else {
{
const __wm_tail_value_193 = Map.get([bindingRegistry_2696, expression_2699.bindingId]);
if (__wm_tail_value_193?.ctor === -2 && __wm_tail_value_193.args.length === 1) {
const binding_2701 = __wm_tail_value_193.args[0];
if ((binding_2701.definitionExprId >= 0)) {
{
const __wm_tail_arg_194_0 = binding_2701.definitionExprId;
const __wm_tail_arg_194_1 = expressionRegistry_2695;
const __wm_tail_arg_194_2 = bindingRegistry_2696;
const __wm_tail_arg_194_3 = nextExpressions_2700;
const __wm_tail_arg_194_4 = Map.set([visitedBindings_2698, expression_2699.bindingId, true]);
expressionId_2694 = __wm_tail_arg_194_0;
expressionRegistry_2695 = __wm_tail_arg_194_1;
bindingRegistry_2696 = __wm_tail_arg_194_2;
visitedExpressions_2697 = __wm_tail_arg_194_3;
visitedBindings_2698 = __wm_tail_arg_194_4;
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
const constantExpression_2692 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return constantExpression_2692__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const constantExpressions_2693__wm_d5 = (pending_2702, expressionRegistry_2703, bindingRegistry_2704, visitedExpressions_2705, visitedBindings_2706) => {
const __wm_scalar_183_0 = pending_2702;
const __wm_scalar_183_1 = expressionRegistry_2703;
const __wm_scalar_183_2 = bindingRegistry_2704;
const __wm_scalar_183_3 = visitedExpressions_2705;
const __wm_scalar_183_4 = visitedBindings_2706;
if (__wm_scalar_183_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_183_1, expressionRegistry_2703) && __wm_eq(__wm_scalar_183_2, bindingRegistry_2704) && __wm_eq(__wm_scalar_183_3, visitedExpressions_2705) && __wm_eq(__wm_scalar_183_4, visitedBindings_2706)) {

return true;
} else if (__wm_scalar_183_0?.ctor === -6 && __wm_scalar_183_0.args.length === 1 && __wm_is_tuple(__wm_scalar_183_0.args[0]) && __wm_scalar_183_0.args[0].length === 2 && __wm_eq(__wm_scalar_183_1, expressionRegistry_2703) && __wm_eq(__wm_scalar_183_2, bindingRegistry_2704) && __wm_eq(__wm_scalar_183_3, visitedExpressions_2705) && __wm_eq(__wm_scalar_183_4, visitedBindings_2706)) {
const expressionId_2707 = __wm_scalar_183_0.args[0][0];
const rest_2708 = __wm_scalar_183_0.args[0][1];
return __wm_op_and_d2(constantExpression_2692__wm_d5(expressionId_2707, expressionRegistry_2703, bindingRegistry_2704, visitedExpressions_2705, visitedBindings_2706), constantExpressions_2693__wm_d5(rest_2708, expressionRegistry_2703, bindingRegistry_2704, visitedExpressions_2705, visitedBindings_2706));
}
__wm_fail("Match", "non-exhaustive match");
};
const constantExpressions_2693 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return constantExpressions_2693__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const reifiableCaptureType_2712__wm_d2 = (typeRegistry_2709, typeId_2710) => {
const __wm_return_value_54 = Map.get([typeRegistry_2709, typeId_2710]);
if (__wm_return_value_54?.ctor === -2 && __wm_return_value_54.args.length === 1) {
const gpuType_2711 = __wm_return_value_54.args[0];
return __wm_op_or_d2(__wm_op_or_d2(__wm_eq(gpuType_2711.kind, "number"), __wm_eq(gpuType_2711.kind, "bool")), __wm_eq(gpuType_2711.kind, "vector"));
} else if (__wm_return_value_54 === __wm_basis_None) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
};
const reifiableCaptureType_2712 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reifiableCaptureType_2712__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const captureCategory_2722__wm_d7 = (bindingId_2713, typeId_2714, reachable_2715, bindingFunctions_2716, bindingRegistry_2717, expressionRegistry_2718, typeRegistry_2719) => {
const __wm_return_value_55 = Map.get([bindingFunctions_2716, bindingId_2713]);
if (__wm_return_value_55?.ctor === -2 && __wm_return_value_55.args.length === 1) {
const functionId_2720 = __wm_return_value_55.args[0];
if (Map.has([reachable_2715, functionId_2720])) {
return "function";
} else {
return "illegal";
}
} else if (__wm_return_value_55 === __wm_basis_None) {

if (reifiableCaptureType_2712__wm_d2(typeRegistry_2719, typeId_2714)) {
const __wm_return_value_56 = Map.get([bindingRegistry_2717, bindingId_2713]);
if (__wm_return_value_56?.ctor === -2 && __wm_return_value_56.args.length === 1) {
const binding_2721 = __wm_return_value_56.args[0];
if (__wm_op_and_d2((binding_2721.definitionExprId >= 0), constantExpression_2692__wm_d5(binding_2721.definitionExprId, expressionRegistry_2718, bindingRegistry_2717, Map.empty(Map.numberCompare), Map.empty(Map.numberCompare)))) {
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
const captureCategory_2722 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return captureCategory_2722__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const collectFunctionCaptures_2723__wm_d10 = (pending_2724, regionId_2725, reachable_2726, bound_2727, expressionRegistry_2728, bindingFunctions_2729, bindingRegistry_2730, typeRegistry_2731, visited_2732, captures_2733) => {
__wm_tail_154: while (true) {
{
const __wm_scalar_184_0 = pending_2724;
const __wm_scalar_184_1 = regionId_2725;
const __wm_scalar_184_2 = reachable_2726;
const __wm_scalar_184_3 = bound_2727;
const __wm_scalar_184_4 = expressionRegistry_2728;
const __wm_scalar_184_5 = bindingFunctions_2729;
const __wm_scalar_184_6 = bindingRegistry_2730;
const __wm_scalar_184_7 = typeRegistry_2731;
const __wm_scalar_184_8 = visited_2732;
const __wm_scalar_184_9 = captures_2733;
if (__wm_scalar_184_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_184_1, regionId_2725) && __wm_eq(__wm_scalar_184_2, reachable_2726) && __wm_eq(__wm_scalar_184_3, bound_2727) && __wm_eq(__wm_scalar_184_4, expressionRegistry_2728) && __wm_eq(__wm_scalar_184_5, bindingFunctions_2729) && __wm_eq(__wm_scalar_184_6, bindingRegistry_2730) && __wm_eq(__wm_scalar_184_7, typeRegistry_2731) && __wm_eq(__wm_scalar_184_8, visited_2732) && __wm_eq(__wm_scalar_184_9, captures_2733)) {

return captures_2733;
} else if (__wm_scalar_184_0?.ctor === -6 && __wm_scalar_184_0.args.length === 1 && __wm_is_tuple(__wm_scalar_184_0.args[0]) && __wm_scalar_184_0.args[0].length === 2 && __wm_eq(__wm_scalar_184_1, regionId_2725) && __wm_eq(__wm_scalar_184_2, reachable_2726) && __wm_eq(__wm_scalar_184_3, bound_2727) && __wm_eq(__wm_scalar_184_4, expressionRegistry_2728) && __wm_eq(__wm_scalar_184_5, bindingFunctions_2729) && __wm_eq(__wm_scalar_184_6, bindingRegistry_2730) && __wm_eq(__wm_scalar_184_7, typeRegistry_2731) && __wm_eq(__wm_scalar_184_8, visited_2732) && __wm_eq(__wm_scalar_184_9, captures_2733)) {
const expressionId_2734 = __wm_scalar_184_0.args[0][0];
const rest_2735 = __wm_scalar_184_0.args[0][1];
if (Map.has([visited_2732, expressionId_2734])) {
{
const __wm_tail_arg_195_0 = rest_2735;
const __wm_tail_arg_195_1 = regionId_2725;
const __wm_tail_arg_195_2 = reachable_2726;
const __wm_tail_arg_195_3 = bound_2727;
const __wm_tail_arg_195_4 = expressionRegistry_2728;
const __wm_tail_arg_195_5 = bindingFunctions_2729;
const __wm_tail_arg_195_6 = bindingRegistry_2730;
const __wm_tail_arg_195_7 = typeRegistry_2731;
const __wm_tail_arg_195_8 = visited_2732;
const __wm_tail_arg_195_9 = captures_2733;
pending_2724 = __wm_tail_arg_195_0;
regionId_2725 = __wm_tail_arg_195_1;
reachable_2726 = __wm_tail_arg_195_2;
bound_2727 = __wm_tail_arg_195_3;
expressionRegistry_2728 = __wm_tail_arg_195_4;
bindingFunctions_2729 = __wm_tail_arg_195_5;
bindingRegistry_2730 = __wm_tail_arg_195_6;
typeRegistry_2731 = __wm_tail_arg_195_7;
visited_2732 = __wm_tail_arg_195_8;
captures_2733 = __wm_tail_arg_195_9;
continue __wm_tail_154;
}
} else {
{
const nextVisited_2736 = Map.set([visited_2732, expressionId_2734, true]);
{
const __wm_tail_value_196 = Map.get([expressionRegistry_2728, expressionId_2734]);
if (__wm_tail_value_196 === __wm_basis_None) {

{
const __wm_tail_arg_197_0 = rest_2735;
const __wm_tail_arg_197_1 = regionId_2725;
const __wm_tail_arg_197_2 = reachable_2726;
const __wm_tail_arg_197_3 = bound_2727;
const __wm_tail_arg_197_4 = expressionRegistry_2728;
const __wm_tail_arg_197_5 = bindingFunctions_2729;
const __wm_tail_arg_197_6 = bindingRegistry_2730;
const __wm_tail_arg_197_7 = typeRegistry_2731;
const __wm_tail_arg_197_8 = nextVisited_2736;
const __wm_tail_arg_197_9 = captures_2733;
pending_2724 = __wm_tail_arg_197_0;
regionId_2725 = __wm_tail_arg_197_1;
reachable_2726 = __wm_tail_arg_197_2;
bound_2727 = __wm_tail_arg_197_3;
expressionRegistry_2728 = __wm_tail_arg_197_4;
bindingFunctions_2729 = __wm_tail_arg_197_5;
bindingRegistry_2730 = __wm_tail_arg_197_6;
typeRegistry_2731 = __wm_tail_arg_197_7;
visited_2732 = __wm_tail_arg_197_8;
captures_2733 = __wm_tail_arg_197_9;
continue __wm_tail_154;
}
} else if (__wm_tail_value_196?.ctor === -2 && __wm_tail_value_196.args.length === 1) {
const expression_2737 = __wm_tail_value_196.args[0];
{
const captureTypeId_2739 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const binding_2738 = __v.args[0];
return binding_2738.typeId;
} else if (__v === __wm_basis_None) {

return expression_2737.typeId;
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([bindingRegistry_2730, expression_2737.bindingId]));
const nextCaptures_2741 = (__wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(__wm_eq(expression_2737.kind, "var"), (expression_2737.bindingId >= 0)), __wm_op_not(Map.has([bound_2727, expression_2737.bindingId]))), __wm_op_not(Map.has([captures_2733, expression_2737.bindingId]))) ? (() => {
const capture_2740 = { regionId: regionId_2725, bindingId: expression_2737.bindingId, typeId: captureTypeId_2739, spanId: expression_2737.spanId, category: captureCategory_2722__wm_d7(expression_2737.bindingId, captureTypeId_2739, reachable_2726, bindingFunctions_2729, bindingRegistry_2730, expressionRegistry_2728, typeRegistry_2731) };
return Map.set([captures_2733, expression_2737.bindingId, capture_2740]);
})() : captures_2733);
{
const __wm_tail_arg_198_0 = prependAll_2586__wm_d2(Js.Array.toList(expression_2737.children), rest_2735);
const __wm_tail_arg_198_1 = regionId_2725;
const __wm_tail_arg_198_2 = reachable_2726;
const __wm_tail_arg_198_3 = bound_2727;
const __wm_tail_arg_198_4 = expressionRegistry_2728;
const __wm_tail_arg_198_5 = bindingFunctions_2729;
const __wm_tail_arg_198_6 = bindingRegistry_2730;
const __wm_tail_arg_198_7 = typeRegistry_2731;
const __wm_tail_arg_198_8 = nextVisited_2736;
const __wm_tail_arg_198_9 = nextCaptures_2741;
pending_2724 = __wm_tail_arg_198_0;
regionId_2725 = __wm_tail_arg_198_1;
reachable_2726 = __wm_tail_arg_198_2;
bound_2727 = __wm_tail_arg_198_3;
expressionRegistry_2728 = __wm_tail_arg_198_4;
bindingFunctions_2729 = __wm_tail_arg_198_5;
bindingRegistry_2730 = __wm_tail_arg_198_6;
typeRegistry_2731 = __wm_tail_arg_198_7;
visited_2732 = __wm_tail_arg_198_8;
captures_2733 = __wm_tail_arg_198_9;
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
const collectFunctionCaptures_2723 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return collectFunctionCaptures_2723__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
const collectReachableCaptures_2742__wm_d9 = (functionEntries_2743, regionId_2744, reachable_2745, functionRegistry_2746, expressionRegistry_2747, bindingFunctions_2748, bindingRegistry_2749, typeRegistry_2750, captures_2751) => {
__wm_tail_155: while (true) {
{
const __wm_scalar_185_0 = functionEntries_2743;
const __wm_scalar_185_1 = regionId_2744;
const __wm_scalar_185_2 = reachable_2745;
const __wm_scalar_185_3 = functionRegistry_2746;
const __wm_scalar_185_4 = expressionRegistry_2747;
const __wm_scalar_185_5 = bindingFunctions_2748;
const __wm_scalar_185_6 = bindingRegistry_2749;
const __wm_scalar_185_7 = typeRegistry_2750;
const __wm_scalar_185_8 = captures_2751;
if (__wm_scalar_185_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_185_1, regionId_2744) && __wm_eq(__wm_scalar_185_2, reachable_2745) && __wm_eq(__wm_scalar_185_3, functionRegistry_2746) && __wm_eq(__wm_scalar_185_4, expressionRegistry_2747) && __wm_eq(__wm_scalar_185_5, bindingFunctions_2748) && __wm_eq(__wm_scalar_185_6, bindingRegistry_2749) && __wm_eq(__wm_scalar_185_7, typeRegistry_2750) && __wm_eq(__wm_scalar_185_8, captures_2751)) {

return captures_2751;
} else if (__wm_scalar_185_0?.ctor === -6 && __wm_scalar_185_0.args.length === 1 && __wm_is_tuple(__wm_scalar_185_0.args[0]) && __wm_scalar_185_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_185_0.args[0][0]) && __wm_scalar_185_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_185_1, regionId_2744) && __wm_eq(__wm_scalar_185_2, reachable_2745) && __wm_eq(__wm_scalar_185_3, functionRegistry_2746) && __wm_eq(__wm_scalar_185_4, expressionRegistry_2747) && __wm_eq(__wm_scalar_185_5, bindingFunctions_2748) && __wm_eq(__wm_scalar_185_6, bindingRegistry_2749) && __wm_eq(__wm_scalar_185_7, typeRegistry_2750) && __wm_eq(__wm_scalar_185_8, captures_2751)) {
const functionId_2752 = __wm_scalar_185_0.args[0][0][0];
const _present_2753 = __wm_scalar_185_0.args[0][0][1];
const rest_2754 = __wm_scalar_185_0.args[0][1];
{
const __wm_tail_value_199 = Map.get([functionRegistry_2746, functionId_2752]);
if (__wm_tail_value_199 === __wm_basis_None) {

{
const __wm_tail_arg_200_0 = rest_2754;
const __wm_tail_arg_200_1 = regionId_2744;
const __wm_tail_arg_200_2 = reachable_2745;
const __wm_tail_arg_200_3 = functionRegistry_2746;
const __wm_tail_arg_200_4 = expressionRegistry_2747;
const __wm_tail_arg_200_5 = bindingFunctions_2748;
const __wm_tail_arg_200_6 = bindingRegistry_2749;
const __wm_tail_arg_200_7 = typeRegistry_2750;
const __wm_tail_arg_200_8 = captures_2751;
functionEntries_2743 = __wm_tail_arg_200_0;
regionId_2744 = __wm_tail_arg_200_1;
reachable_2745 = __wm_tail_arg_200_2;
functionRegistry_2746 = __wm_tail_arg_200_3;
expressionRegistry_2747 = __wm_tail_arg_200_4;
bindingFunctions_2748 = __wm_tail_arg_200_5;
bindingRegistry_2749 = __wm_tail_arg_200_6;
typeRegistry_2750 = __wm_tail_arg_200_7;
captures_2751 = __wm_tail_arg_200_8;
continue __wm_tail_155;
}
} else if (__wm_tail_value_199?.ctor === -2 && __wm_tail_value_199.args.length === 1) {
const fn_2755 = __wm_tail_value_199.args[0];
{
const paramBound_2756 = bindParams_2677__wm_d2(Js.Array.toList(fn_2755.params), Map.empty(Map.numberCompare));
const bound_2757 = collectLocalBindings_2682__wm_d4(__wm_basis_Cons([fn_2755.bodyExprId, __wm_basis_Nil]), expressionRegistry_2747, Map.empty(Map.numberCompare), paramBound_2756);
const nextCaptures_2758 = collectFunctionCaptures_2723__wm_d10(__wm_basis_Cons([fn_2755.bodyExprId, __wm_basis_Nil]), regionId_2744, reachable_2745, bound_2757, expressionRegistry_2747, bindingFunctions_2748, bindingRegistry_2749, typeRegistry_2750, Map.empty(Map.numberCompare), captures_2751);
{
const __wm_tail_arg_201_0 = rest_2754;
const __wm_tail_arg_201_1 = regionId_2744;
const __wm_tail_arg_201_2 = reachable_2745;
const __wm_tail_arg_201_3 = functionRegistry_2746;
const __wm_tail_arg_201_4 = expressionRegistry_2747;
const __wm_tail_arg_201_5 = bindingFunctions_2748;
const __wm_tail_arg_201_6 = bindingRegistry_2749;
const __wm_tail_arg_201_7 = typeRegistry_2750;
const __wm_tail_arg_201_8 = nextCaptures_2758;
functionEntries_2743 = __wm_tail_arg_201_0;
regionId_2744 = __wm_tail_arg_201_1;
reachable_2745 = __wm_tail_arg_201_2;
functionRegistry_2746 = __wm_tail_arg_201_3;
expressionRegistry_2747 = __wm_tail_arg_201_4;
bindingFunctions_2748 = __wm_tail_arg_201_5;
bindingRegistry_2749 = __wm_tail_arg_201_6;
typeRegistry_2750 = __wm_tail_arg_201_7;
captures_2751 = __wm_tail_arg_201_8;
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
const collectReachableCaptures_2742 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return collectReachableCaptures_2742__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const captureValues_2759__wm_d2 = (entries_2760, captures_2761) => {
__wm_tail_156: while (true) {
{
const __wm_scalar_186_0 = entries_2760;
const __wm_scalar_186_1 = captures_2761;
if (__wm_scalar_186_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_186_1, captures_2761)) {

return captures_2761;
} else if (__wm_scalar_186_0?.ctor === -6 && __wm_scalar_186_0.args.length === 1 && __wm_is_tuple(__wm_scalar_186_0.args[0]) && __wm_scalar_186_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_186_0.args[0][0]) && __wm_scalar_186_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_186_1, captures_2761)) {
const _bindingId_2762 = __wm_scalar_186_0.args[0][0][0];
const capture_2763 = __wm_scalar_186_0.args[0][0][1];
const rest_2764 = __wm_scalar_186_0.args[0][1];
{
const __wm_tail_arg_202_0 = rest_2764;
const __wm_tail_arg_202_1 = __wm_basis_Cons([capture_2763, captures_2761]);
entries_2760 = __wm_tail_arg_202_0;
captures_2761 = __wm_tail_arg_202_1;
continue __wm_tail_156;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const captureValues_2759 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return captureValues_2759__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const rootCaptures_2765__wm_d7 = (roots_2766, functionRegistry_2767, expressionRegistry_2768, bindingFunctions_2769, bindingRegistry_2770, typeRegistry_2771, captures_2772) => {
__wm_tail_157: while (true) {
{
const __wm_scalar_187_0 = roots_2766;
const __wm_scalar_187_1 = functionRegistry_2767;
const __wm_scalar_187_2 = expressionRegistry_2768;
const __wm_scalar_187_3 = bindingFunctions_2769;
const __wm_scalar_187_4 = bindingRegistry_2770;
const __wm_scalar_187_5 = typeRegistry_2771;
const __wm_scalar_187_6 = captures_2772;
if (__wm_scalar_187_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_187_1, functionRegistry_2767) && __wm_eq(__wm_scalar_187_2, expressionRegistry_2768) && __wm_eq(__wm_scalar_187_3, bindingFunctions_2769) && __wm_eq(__wm_scalar_187_4, bindingRegistry_2770) && __wm_eq(__wm_scalar_187_5, typeRegistry_2771) && __wm_eq(__wm_scalar_187_6, captures_2772)) {

return captures_2772;
} else if (__wm_scalar_187_0?.ctor === -6 && __wm_scalar_187_0.args.length === 1 && __wm_is_tuple(__wm_scalar_187_0.args[0]) && __wm_scalar_187_0.args[0].length === 2 && __wm_eq(__wm_scalar_187_1, functionRegistry_2767) && __wm_eq(__wm_scalar_187_2, expressionRegistry_2768) && __wm_eq(__wm_scalar_187_3, bindingFunctions_2769) && __wm_eq(__wm_scalar_187_4, bindingRegistry_2770) && __wm_eq(__wm_scalar_187_5, typeRegistry_2771) && __wm_eq(__wm_scalar_187_6, captures_2772)) {
const root_2773 = __wm_scalar_187_0.args[0][0];
const rest_2774 = __wm_scalar_187_0.args[0][1];
{
const gpuRoot_2775 = root_2773;
const reachable_2776 = solveReachableFunctions_2661__wm_d5(__wm_basis_Cons([gpuRoot_2775.functionId, __wm_basis_Nil]), functionRegistry_2767, expressionRegistry_2768, bindingFunctions_2769, Map.empty(Map.numberCompare));
const rootCaptureRegistry_2777 = collectReachableCaptures_2742__wm_d9(Map.toList(reachable_2776), gpuRoot_2775.regionId, reachable_2776, functionRegistry_2767, expressionRegistry_2768, bindingFunctions_2769, bindingRegistry_2770, typeRegistry_2771, Map.empty(Map.numberCompare));
{
const __wm_tail_arg_203_0 = rest_2774;
const __wm_tail_arg_203_1 = functionRegistry_2767;
const __wm_tail_arg_203_2 = expressionRegistry_2768;
const __wm_tail_arg_203_3 = bindingFunctions_2769;
const __wm_tail_arg_203_4 = bindingRegistry_2770;
const __wm_tail_arg_203_5 = typeRegistry_2771;
const __wm_tail_arg_203_6 = prependAll_2586__wm_d2(captureValues_2759__wm_d2(Map.toList(rootCaptureRegistry_2777), __wm_basis_Nil), captures_2772);
roots_2766 = __wm_tail_arg_203_0;
functionRegistry_2767 = __wm_tail_arg_203_1;
expressionRegistry_2768 = __wm_tail_arg_203_2;
bindingFunctions_2769 = __wm_tail_arg_203_3;
bindingRegistry_2770 = __wm_tail_arg_203_4;
typeRegistry_2771 = __wm_tail_arg_203_5;
captures_2772 = __wm_tail_arg_203_6;
continue __wm_tail_157;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const rootCaptures_2765 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return rootCaptures_2765__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const illegalCaptureDiagnostic_2780 = (__arg) => {
if (true) {
const capture_2778 = __arg;
const diagnostic_2779 = { code: "gpu.illegal-capture", message: "captured value is not available to the GPU as a constant, uniform, resource, or function", spanId: capture_2778.spanId };
return diagnostic_2779;
}
__wm_fail("Match", "pattern match failure in function");
};
const captureDiagnostics_2781__wm_d2 = (captures_2782, diagnostics_2783) => {
__wm_tail_158: while (true) {
{
const __wm_scalar_188_0 = captures_2782;
const __wm_scalar_188_1 = diagnostics_2783;
if (__wm_scalar_188_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_188_1, diagnostics_2783)) {

return diagnostics_2783;
} else if (__wm_scalar_188_0?.ctor === -6 && __wm_scalar_188_0.args.length === 1 && __wm_is_tuple(__wm_scalar_188_0.args[0]) && __wm_scalar_188_0.args[0].length === 2 && __wm_eq(__wm_scalar_188_1, diagnostics_2783)) {
const capture_2784 = __wm_scalar_188_0.args[0][0];
const rest_2785 = __wm_scalar_188_0.args[0][1];
if (__wm_eq(capture_2784.category, "illegal")) {
{
const __wm_tail_arg_204_0 = rest_2785;
const __wm_tail_arg_204_1 = __wm_basis_Cons([illegalCaptureDiagnostic_2780(capture_2784), diagnostics_2783]);
captures_2782 = __wm_tail_arg_204_0;
diagnostics_2783 = __wm_tail_arg_204_1;
continue __wm_tail_158;
}
} else {
{
const __wm_tail_arg_205_0 = rest_2785;
const __wm_tail_arg_205_1 = diagnostics_2783;
captures_2782 = __wm_tail_arg_205_0;
diagnostics_2783 = __wm_tail_arg_205_1;
continue __wm_tail_158;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const captureDiagnostics_2781 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return captureDiagnostics_2781__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const indexExpressions_2786__wm_d2 = (expressions_2787, registry_2788) => {
__wm_tail_159: while (true) {
{
const __wm_scalar_189_0 = expressions_2787;
const __wm_scalar_189_1 = registry_2788;
if (__wm_scalar_189_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_189_1, registry_2788)) {

return registry_2788;
} else if (__wm_scalar_189_0?.ctor === -6 && __wm_scalar_189_0.args.length === 1 && __wm_is_tuple(__wm_scalar_189_0.args[0]) && __wm_scalar_189_0.args[0].length === 2 && __wm_eq(__wm_scalar_189_1, registry_2788)) {
const expression_2789 = __wm_scalar_189_0.args[0][0];
const rest_2790 = __wm_scalar_189_0.args[0][1];
{
const __wm_tail_arg_206_0 = rest_2790;
const __wm_tail_arg_206_1 = Map.set([registry_2788, expression_2789.id, expression_2789]);
expressions_2787 = __wm_tail_arg_206_0;
registry_2788 = __wm_tail_arg_206_1;
continue __wm_tail_159;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexExpressions_2786 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexExpressions_2786__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const indexTypes_2791__wm_d2 = (types_2792, registry_2793) => {
__wm_tail_160: while (true) {
{
const __wm_scalar_190_0 = types_2792;
const __wm_scalar_190_1 = registry_2793;
if (__wm_scalar_190_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_190_1, registry_2793)) {

return registry_2793;
} else if (__wm_scalar_190_0?.ctor === -6 && __wm_scalar_190_0.args.length === 1 && __wm_is_tuple(__wm_scalar_190_0.args[0]) && __wm_scalar_190_0.args[0].length === 2 && __wm_eq(__wm_scalar_190_1, registry_2793)) {
const gpuType_2794 = __wm_scalar_190_0.args[0][0];
const rest_2795 = __wm_scalar_190_0.args[0][1];
{
const __wm_tail_arg_207_0 = rest_2795;
const __wm_tail_arg_207_1 = Map.set([registry_2793, gpuType_2794.id, gpuType_2794]);
types_2792 = __wm_tail_arg_207_0;
registry_2793 = __wm_tail_arg_207_1;
continue __wm_tail_160;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexTypes_2791 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexTypes_2791__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const representationOf_2799__wm_d2 = (registry_2796, typeId_2797) => {
const __wm_return_value_57 = Map.get([registry_2796, typeId_2797]);
if (__wm_return_value_57?.ctor === -2 && __wm_return_value_57.args.length === 1) {
const representation_2798 = __wm_return_value_57.args[0];
return representation_2798;
} else if (__wm_return_value_57 === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const representationOf_2799 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return representationOf_2799__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const joinRepresentation_2802__wm_d2 = (left_2800, right_2801) => {
if (__wm_op_or_d2(__wm_eq(left_2800, "f32"), __wm_eq(right_2801, "f32"))) {
return "f32";
} else {
if (__wm_op_or_d2(__wm_eq(left_2800, "i32"), __wm_eq(right_2801, "i32"))) {
return "i32";
} else {
return "";
}
}
};
const joinRepresentation_2802 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return joinRepresentation_2802__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const combinedRepresentation_2803__wm_d3 = (typeIds_2804, registry_2805, combined_2806) => {
__wm_tail_161: while (true) {
{
const __wm_scalar_191_0 = typeIds_2804;
const __wm_scalar_191_1 = registry_2805;
const __wm_scalar_191_2 = combined_2806;
if (__wm_scalar_191_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_191_1, registry_2805) && __wm_eq(__wm_scalar_191_2, combined_2806)) {

return combined_2806;
} else if (__wm_scalar_191_0?.ctor === -6 && __wm_scalar_191_0.args.length === 1 && __wm_is_tuple(__wm_scalar_191_0.args[0]) && __wm_scalar_191_0.args[0].length === 2 && __wm_eq(__wm_scalar_191_1, registry_2805) && __wm_eq(__wm_scalar_191_2, combined_2806)) {
const typeId_2807 = __wm_scalar_191_0.args[0][0];
const rest_2808 = __wm_scalar_191_0.args[0][1];
{
const __wm_tail_arg_208_0 = rest_2808;
const __wm_tail_arg_208_1 = registry_2805;
const __wm_tail_arg_208_2 = joinRepresentation_2802__wm_d2(combined_2806, representationOf_2799__wm_d2(registry_2805, typeId_2807));
typeIds_2804 = __wm_tail_arg_208_0;
registry_2805 = __wm_tail_arg_208_1;
combined_2806 = __wm_tail_arg_208_2;
continue __wm_tail_161;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const combinedRepresentation_2803 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return combinedRepresentation_2803__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setRepresentation_2814__wm_d3 = (registry_2809, typeId_2810, representation_2811) => {
const previous_2812 = representationOf_2799__wm_d2(registry_2809, typeId_2810);
const next_2813 = joinRepresentation_2802__wm_d2(previous_2812, representation_2811);
if (__wm_op_or_d2(__wm_eq(next_2813, ""), __wm_eq(next_2813, previous_2812))) {
return [registry_2809, false];
} else {
return [Map.set([registry_2809, typeId_2810, next_2813]), true];
}
};
const setRepresentation_2814 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return setRepresentation_2814__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setRepresentations_2815__wm_d4 = (typeIds_2816, representation_2817, registry_2818, changed_2819) => {
__wm_tail_162: while (true) {
{
const __wm_scalar_192_0 = typeIds_2816;
const __wm_scalar_192_1 = representation_2817;
const __wm_scalar_192_2 = registry_2818;
const __wm_scalar_192_3 = changed_2819;
if (__wm_scalar_192_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_192_1, representation_2817) && __wm_eq(__wm_scalar_192_2, registry_2818) && __wm_eq(__wm_scalar_192_3, changed_2819)) {

return [registry_2818, changed_2819];
} else if (__wm_scalar_192_0?.ctor === -6 && __wm_scalar_192_0.args.length === 1 && __wm_is_tuple(__wm_scalar_192_0.args[0]) && __wm_scalar_192_0.args[0].length === 2 && __wm_eq(__wm_scalar_192_1, representation_2817) && __wm_eq(__wm_scalar_192_2, registry_2818) && __wm_eq(__wm_scalar_192_3, changed_2819)) {
const typeId_2820 = __wm_scalar_192_0.args[0][0];
const rest_2821 = __wm_scalar_192_0.args[0][1];
{
const __wm_bind_95 = setRepresentation_2814__wm_d3(registry_2818, typeId_2820, representation_2817);
if (!(__wm_is_tuple(__wm_bind_95) && __wm_bind_95.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_2822 = __wm_bind_95[0];
const itemChanged_2823 = __wm_bind_95[1];
{
const __wm_tail_arg_209_0 = rest_2821;
const __wm_tail_arg_209_1 = representation_2817;
const __wm_tail_arg_209_2 = nextRegistry_2822;
const __wm_tail_arg_209_3 = __wm_op_or_d2(changed_2819, itemChanged_2823);
typeIds_2816 = __wm_tail_arg_209_0;
representation_2817 = __wm_tail_arg_209_1;
registry_2818 = __wm_tail_arg_209_2;
changed_2819 = __wm_tail_arg_209_3;
continue __wm_tail_162;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const setRepresentations_2815 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setRepresentations_2815__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const seedRepresentations_2824__wm_d2 = (types_2825, registry_2826) => {
__wm_tail_163: while (true) {
{
const __wm_scalar_193_0 = types_2825;
const __wm_scalar_193_1 = registry_2826;
if (__wm_scalar_193_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_193_1, registry_2826)) {

return registry_2826;
} else if (__wm_scalar_193_0?.ctor === -6 && __wm_scalar_193_0.args.length === 1 && __wm_is_tuple(__wm_scalar_193_0.args[0]) && __wm_scalar_193_0.args[0].length === 2 && __wm_eq(__wm_scalar_193_1, registry_2826)) {
const gpuType_2827 = __wm_scalar_193_0.args[0][0];
const rest_2828 = __wm_scalar_193_0.args[0][1];
if (__wm_op_or_d2(__wm_eq(gpuType_2827.representation, "f32"), __wm_eq(gpuType_2827.representation, "i32"))) {
{
const __wm_tail_arg_210_0 = rest_2828;
const __wm_tail_arg_210_1 = Map.set([registry_2826, gpuType_2827.id, gpuType_2827.representation]);
types_2825 = __wm_tail_arg_210_0;
registry_2826 = __wm_tail_arg_210_1;
continue __wm_tail_163;
}
} else {
{
const __wm_tail_arg_211_0 = rest_2828;
const __wm_tail_arg_211_1 = registry_2826;
types_2825 = __wm_tail_arg_211_0;
registry_2826 = __wm_tail_arg_211_1;
continue __wm_tail_163;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const seedRepresentations_2824 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return seedRepresentations_2824__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const childTypeIds_2829__wm_d3 = (childIds_2830, expressionRegistry_2831, typeIds_2832) => {
__wm_tail_164: while (true) {
{
const __wm_scalar_194_0 = childIds_2830;
const __wm_scalar_194_1 = expressionRegistry_2831;
const __wm_scalar_194_2 = typeIds_2832;
if (__wm_scalar_194_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_194_1, expressionRegistry_2831) && __wm_eq(__wm_scalar_194_2, typeIds_2832)) {

return typeIds_2832;
} else if (__wm_scalar_194_0?.ctor === -6 && __wm_scalar_194_0.args.length === 1 && __wm_is_tuple(__wm_scalar_194_0.args[0]) && __wm_scalar_194_0.args[0].length === 2 && __wm_eq(__wm_scalar_194_1, expressionRegistry_2831) && __wm_eq(__wm_scalar_194_2, typeIds_2832)) {
const childId_2833 = __wm_scalar_194_0.args[0][0];
const rest_2834 = __wm_scalar_194_0.args[0][1];
{
const __wm_tail_value_212 = Map.get([expressionRegistry_2831, childId_2833]);
if (__wm_tail_value_212?.ctor === -2 && __wm_tail_value_212.args.length === 1) {
const child_2835 = __wm_tail_value_212.args[0];
{
const __wm_tail_arg_213_0 = rest_2834;
const __wm_tail_arg_213_1 = expressionRegistry_2831;
const __wm_tail_arg_213_2 = __wm_basis_Cons([child_2835.typeId, typeIds_2832]);
childIds_2830 = __wm_tail_arg_213_0;
expressionRegistry_2831 = __wm_tail_arg_213_1;
typeIds_2832 = __wm_tail_arg_213_2;
continue __wm_tail_164;
}
} else if (__wm_tail_value_212 === __wm_basis_None) {

{
const __wm_tail_arg_214_0 = rest_2834;
const __wm_tail_arg_214_1 = expressionRegistry_2831;
const __wm_tail_arg_214_2 = typeIds_2832;
childIds_2830 = __wm_tail_arg_214_0;
expressionRegistry_2831 = __wm_tail_arg_214_1;
typeIds_2832 = __wm_tail_arg_214_2;
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
const childTypeIds_2829 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return childTypeIds_2829__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const numericTypeIds_2836__wm_d3 = (typeIds_2837, typeRegistry_2838, numericIds_2839) => {
__wm_tail_165: while (true) {
{
const __wm_scalar_195_0 = typeIds_2837;
const __wm_scalar_195_1 = typeRegistry_2838;
const __wm_scalar_195_2 = numericIds_2839;
if (__wm_scalar_195_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_195_1, typeRegistry_2838) && __wm_eq(__wm_scalar_195_2, numericIds_2839)) {

return numericIds_2839;
} else if (__wm_scalar_195_0?.ctor === -6 && __wm_scalar_195_0.args.length === 1 && __wm_is_tuple(__wm_scalar_195_0.args[0]) && __wm_scalar_195_0.args[0].length === 2 && __wm_eq(__wm_scalar_195_1, typeRegistry_2838) && __wm_eq(__wm_scalar_195_2, numericIds_2839)) {
const typeId_2840 = __wm_scalar_195_0.args[0][0];
const rest_2841 = __wm_scalar_195_0.args[0][1];
{
const __wm_tail_value_215 = Map.get([typeRegistry_2838, typeId_2840]);
if (__wm_tail_value_215?.ctor === -2 && __wm_tail_value_215.args.length === 1) {
const gpuType_2842 = __wm_tail_value_215.args[0];
if (__wm_eq(gpuType_2842.kind, "vector")) {
{
const __wm_tail_arg_216_0 = rest_2841;
const __wm_tail_arg_216_1 = typeRegistry_2838;
const __wm_tail_arg_216_2 = __wm_basis_Cons([typeId_2840, numericTypeIds_2836__wm_d3(Js.Array.toList(gpuType_2842.items), typeRegistry_2838, numericIds_2839)]);
typeIds_2837 = __wm_tail_arg_216_0;
typeRegistry_2838 = __wm_tail_arg_216_1;
numericIds_2839 = __wm_tail_arg_216_2;
continue __wm_tail_165;
}
} else {
if (__wm_eq(gpuType_2842.kind, "number")) {
{
const __wm_tail_arg_217_0 = rest_2841;
const __wm_tail_arg_217_1 = typeRegistry_2838;
const __wm_tail_arg_217_2 = __wm_basis_Cons([typeId_2840, numericIds_2839]);
typeIds_2837 = __wm_tail_arg_217_0;
typeRegistry_2838 = __wm_tail_arg_217_1;
numericIds_2839 = __wm_tail_arg_217_2;
continue __wm_tail_165;
}
} else {
{
const __wm_tail_arg_218_0 = rest_2841;
const __wm_tail_arg_218_1 = typeRegistry_2838;
const __wm_tail_arg_218_2 = numericIds_2839;
typeIds_2837 = __wm_tail_arg_218_0;
typeRegistry_2838 = __wm_tail_arg_218_1;
numericIds_2839 = __wm_tail_arg_218_2;
continue __wm_tail_165;
}
}
}
} else if (__wm_tail_value_215 === __wm_basis_None) {

{
const __wm_tail_arg_219_0 = rest_2841;
const __wm_tail_arg_219_1 = typeRegistry_2838;
const __wm_tail_arg_219_2 = numericIds_2839;
typeIds_2837 = __wm_tail_arg_219_0;
typeRegistry_2838 = __wm_tail_arg_219_1;
numericIds_2839 = __wm_tail_arg_219_2;
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
const numericTypeIds_2836 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return numericTypeIds_2836__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lastChildTypeId_2843__wm_d3 = (childIds_2844, expressionRegistry_2845, lastTypeId_2846) => {
__wm_tail_166: while (true) {
{
const __wm_scalar_196_0 = childIds_2844;
const __wm_scalar_196_1 = expressionRegistry_2845;
const __wm_scalar_196_2 = lastTypeId_2846;
if (__wm_scalar_196_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_196_1, expressionRegistry_2845) && __wm_eq(__wm_scalar_196_2, lastTypeId_2846)) {

return lastTypeId_2846;
} else if (__wm_scalar_196_0?.ctor === -6 && __wm_scalar_196_0.args.length === 1 && __wm_is_tuple(__wm_scalar_196_0.args[0]) && __wm_scalar_196_0.args[0].length === 2 && __wm_eq(__wm_scalar_196_1, expressionRegistry_2845) && __wm_eq(__wm_scalar_196_2, lastTypeId_2846)) {
const childId_2847 = __wm_scalar_196_0.args[0][0];
const rest_2848 = __wm_scalar_196_0.args[0][1];
{
const nextTypeId_2850 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const child_2849 = __v.args[0];
return child_2849.typeId;
} else if (__v === __wm_basis_None) {

return lastTypeId_2846;
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([expressionRegistry_2845, childId_2847]));
{
const __wm_tail_arg_220_0 = rest_2848;
const __wm_tail_arg_220_1 = expressionRegistry_2845;
const __wm_tail_arg_220_2 = nextTypeId_2850;
childIds_2844 = __wm_tail_arg_220_0;
expressionRegistry_2845 = __wm_tail_arg_220_1;
lastTypeId_2846 = __wm_tail_arg_220_2;
continue __wm_tail_166;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const lastChildTypeId_2843 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return lastChildTypeId_2843__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const constraintTypeIds_2855__wm_d3 = (expression_2851, expressionRegistry_2852, typeRegistry_2853) => {
if (__wm_eq(expression_2851.kind, "binary")) {
return numericTypeIds_2836__wm_d3(__wm_basis_Cons([expression_2851.typeId, childTypeIds_2829__wm_d3(Js.Array.toList(expression_2851.children), expressionRegistry_2852, __wm_basis_Nil)]), typeRegistry_2853, __wm_basis_Nil);
} else {
if (__wm_eq(expression_2851.kind, "tuple")) {
const __wm_return_value_58 = Map.get([typeRegistry_2853, expression_2851.typeId]);
if (__wm_return_value_58?.ctor === -2 && __wm_return_value_58.args.length === 1) {
const gpuType_2854 = __wm_return_value_58.args[0];
if (__wm_eq(gpuType_2854.kind, "vector")) {
return numericTypeIds_2836__wm_d3(__wm_basis_Cons([expression_2851.typeId, childTypeIds_2829__wm_d3(Js.Array.toList(expression_2851.children), expressionRegistry_2852, __wm_basis_Nil)]), typeRegistry_2853, __wm_basis_Nil);
} else {
return __wm_basis_Nil;
}
} else if (__wm_return_value_58 === __wm_basis_None) {

return __wm_basis_Nil;
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_op_or_d2(__wm_eq(expression_2851.kind, "if"), __wm_eq(expression_2851.kind, "unary"))) {
return numericTypeIds_2836__wm_d3(__wm_basis_Cons([expression_2851.typeId, childTypeIds_2829__wm_d3(Js.Array.toList(expression_2851.children), expressionRegistry_2852, __wm_basis_Nil)]), typeRegistry_2853, __wm_basis_Nil);
} else {
if (__wm_op_or_d2(__wm_eq(expression_2851.kind, "block"), __wm_eq(expression_2851.kind, "let"))) {
return numericTypeIds_2836__wm_d3(__wm_basis_Cons([expression_2851.typeId, __wm_basis_Cons([lastChildTypeId_2843__wm_d3(Js.Array.toList(expression_2851.children), expressionRegistry_2852, expression_2851.typeId), __wm_basis_Nil])]), typeRegistry_2853, __wm_basis_Nil);
} else {
return __wm_basis_Nil;
}
}
}
}
};
const constraintTypeIds_2855 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return constraintTypeIds_2855__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const applyNumericGroup_2859__wm_d2 = (typeIds_2856, registry_2857) => {
const representation_2858 = combinedRepresentation_2803__wm_d3(typeIds_2856, registry_2857, "");
return setRepresentations_2815__wm_d4(typeIds_2856, representation_2858, registry_2857, false);
};
const applyNumericGroup_2859 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return applyNumericGroup_2859__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const applyArgumentConstraints_2860__wm_d6 = (argumentIds_2861, params_2862, expressionRegistry_2863, typeRegistry_2864, registry_2865, changed_2866) => {
__wm_tail_167: while (true) {
{
const __wm_scalar_197_0 = argumentIds_2861;
const __wm_scalar_197_1 = params_2862;
const __wm_scalar_197_2 = expressionRegistry_2863;
const __wm_scalar_197_3 = typeRegistry_2864;
const __wm_scalar_197_4 = registry_2865;
const __wm_scalar_197_5 = changed_2866;
if (__wm_scalar_197_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_197_1, params_2862) && __wm_eq(__wm_scalar_197_2, expressionRegistry_2863) && __wm_eq(__wm_scalar_197_3, typeRegistry_2864) && __wm_eq(__wm_scalar_197_4, registry_2865) && __wm_eq(__wm_scalar_197_5, changed_2866)) {

return [registry_2865, changed_2866];
} else if (__wm_eq(__wm_scalar_197_0, argumentIds_2861) && __wm_scalar_197_1 === __wm_basis_Nil && __wm_eq(__wm_scalar_197_2, expressionRegistry_2863) && __wm_eq(__wm_scalar_197_3, typeRegistry_2864) && __wm_eq(__wm_scalar_197_4, registry_2865) && __wm_eq(__wm_scalar_197_5, changed_2866)) {

return [registry_2865, changed_2866];
} else if (__wm_scalar_197_0?.ctor === -6 && __wm_scalar_197_0.args.length === 1 && __wm_is_tuple(__wm_scalar_197_0.args[0]) && __wm_scalar_197_0.args[0].length === 2 && __wm_scalar_197_1?.ctor === -6 && __wm_scalar_197_1.args.length === 1 && __wm_is_tuple(__wm_scalar_197_1.args[0]) && __wm_scalar_197_1.args[0].length === 2 && __wm_eq(__wm_scalar_197_2, expressionRegistry_2863) && __wm_eq(__wm_scalar_197_3, typeRegistry_2864) && __wm_eq(__wm_scalar_197_4, registry_2865) && __wm_eq(__wm_scalar_197_5, changed_2866)) {
const argumentId_2867 = __wm_scalar_197_0.args[0][0];
const restArguments_2868 = __wm_scalar_197_0.args[0][1];
const param_2869 = __wm_scalar_197_1.args[0][0];
const restParams_2870 = __wm_scalar_197_1.args[0][1];
{
const __wm_tail_value_221 = Map.get([expressionRegistry_2863, argumentId_2867]);
if (__wm_tail_value_221?.ctor === -2 && __wm_tail_value_221.args.length === 1) {
const argument_2871 = __wm_tail_value_221.args[0];
{
const typeIds_2872 = numericTypeIds_2836__wm_d3(__wm_basis_Cons([argument_2871.typeId, __wm_basis_Cons([param_2869.typeId, __wm_basis_Nil])]), typeRegistry_2864, __wm_basis_Nil);
const __wm_bind_96 = applyNumericGroup_2859__wm_d2(typeIds_2872, registry_2865);
if (!(__wm_is_tuple(__wm_bind_96) && __wm_bind_96.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_2873 = __wm_bind_96[0];
const pairChanged_2874 = __wm_bind_96[1];
{
const __wm_tail_arg_222_0 = restArguments_2868;
const __wm_tail_arg_222_1 = restParams_2870;
const __wm_tail_arg_222_2 = expressionRegistry_2863;
const __wm_tail_arg_222_3 = typeRegistry_2864;
const __wm_tail_arg_222_4 = nextRegistry_2873;
const __wm_tail_arg_222_5 = __wm_op_or_d2(changed_2866, pairChanged_2874);
argumentIds_2861 = __wm_tail_arg_222_0;
params_2862 = __wm_tail_arg_222_1;
expressionRegistry_2863 = __wm_tail_arg_222_2;
typeRegistry_2864 = __wm_tail_arg_222_3;
registry_2865 = __wm_tail_arg_222_4;
changed_2866 = __wm_tail_arg_222_5;
continue __wm_tail_167;
}
}
} else if (__wm_tail_value_221 === __wm_basis_None) {

{
const __wm_tail_arg_223_0 = restArguments_2868;
const __wm_tail_arg_223_1 = restParams_2870;
const __wm_tail_arg_223_2 = expressionRegistry_2863;
const __wm_tail_arg_223_3 = typeRegistry_2864;
const __wm_tail_arg_223_4 = registry_2865;
const __wm_tail_arg_223_5 = changed_2866;
argumentIds_2861 = __wm_tail_arg_223_0;
params_2862 = __wm_tail_arg_223_1;
expressionRegistry_2863 = __wm_tail_arg_223_2;
typeRegistry_2864 = __wm_tail_arg_223_3;
registry_2865 = __wm_tail_arg_223_4;
changed_2866 = __wm_tail_arg_223_5;
continue __wm_tail_167;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const applyArgumentConstraints_2860 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return applyArgumentConstraints_2860__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const applyCallConstraint_2889__wm_d6 = (expression_2875, expressionRegistry_2876, typeRegistry_2877, functionRegistry_2878, bindingFunctions_2879, registry_2880) => {
const __wm_return_value_59 = Js.Array.toList(expression_2875.children);
if (__wm_return_value_59?.ctor === -6 && __wm_return_value_59.args.length === 1 && __wm_is_tuple(__wm_return_value_59.args[0]) && __wm_return_value_59.args[0].length === 2) {
const calleeId_2881 = __wm_return_value_59.args[0][0];
const argumentIds_2882 = __wm_return_value_59.args[0][1];
const __wm_return_value_60 = Map.get([expressionRegistry_2876, calleeId_2881]);
if (__wm_return_value_60?.ctor === -2 && __wm_return_value_60.args.length === 1) {
const callee_2883 = __wm_return_value_60.args[0];
const __wm_return_value_61 = Map.get([bindingFunctions_2879, callee_2883.bindingId]);
if (__wm_return_value_61?.ctor === -2 && __wm_return_value_61.args.length === 1) {
const functionId_2884 = __wm_return_value_61.args[0];
const __wm_return_value_62 = Map.get([functionRegistry_2878, functionId_2884]);
if (__wm_return_value_62?.ctor === -2 && __wm_return_value_62.args.length === 1) {
const fn_2885 = __wm_return_value_62.args[0];
const resultIds_2886 = numericTypeIds_2836__wm_d3(__wm_basis_Cons([expression_2875.typeId, __wm_basis_Cons([fn_2885.resultTypeId, __wm_basis_Nil])]), typeRegistry_2877, __wm_basis_Nil);
const __wm_bind_97 = applyNumericGroup_2859__wm_d2(resultIds_2886, registry_2880);
if (!(__wm_is_tuple(__wm_bind_97) && __wm_bind_97.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const resultRegistry_2887 = __wm_bind_97[0];
const resultChanged_2888 = __wm_bind_97[1];
return applyArgumentConstraints_2860__wm_d6(argumentIds_2882, Js.Array.toList(fn_2885.params), expressionRegistry_2876, typeRegistry_2877, resultRegistry_2887, resultChanged_2888);
} else if (__wm_return_value_62 === __wm_basis_None) {

return [registry_2880, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_61 === __wm_basis_None) {

return [registry_2880, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_60 === __wm_basis_None) {

return [registry_2880, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_59 === __wm_basis_Nil) {

return [registry_2880, false];
}
__wm_fail("Match", "non-exhaustive match");
};
const applyCallConstraint_2889 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return applyCallConstraint_2889__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const applyNumericConstraint_2897__wm_d6 = (expression_2890, expressionRegistry_2891, typeRegistry_2892, functionRegistry_2893, bindingFunctions_2894, registry_2895) => {
if (__wm_eq(expression_2890.kind, "call")) {
return applyCallConstraint_2889__wm_d6(expression_2890, expressionRegistry_2891, typeRegistry_2892, functionRegistry_2893, bindingFunctions_2894, registry_2895);
} else {
const typeIds_2896 = constraintTypeIds_2855__wm_d3(expression_2890, expressionRegistry_2891, typeRegistry_2892);
return applyNumericGroup_2859__wm_d2(typeIds_2896, registry_2895);
}
};
const applyNumericConstraint_2897 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return applyNumericConstraint_2897__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const numericSweep_2898__wm_d7 = (expressions_2899, expressionRegistry_2900, typeRegistry_2901, functionRegistry_2902, bindingFunctions_2903, registry_2904, changed_2905) => {
__wm_tail_168: while (true) {
{
const __wm_scalar_198_0 = expressions_2899;
const __wm_scalar_198_1 = expressionRegistry_2900;
const __wm_scalar_198_2 = typeRegistry_2901;
const __wm_scalar_198_3 = functionRegistry_2902;
const __wm_scalar_198_4 = bindingFunctions_2903;
const __wm_scalar_198_5 = registry_2904;
const __wm_scalar_198_6 = changed_2905;
if (__wm_scalar_198_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_198_1, expressionRegistry_2900) && __wm_eq(__wm_scalar_198_2, typeRegistry_2901) && __wm_eq(__wm_scalar_198_3, functionRegistry_2902) && __wm_eq(__wm_scalar_198_4, bindingFunctions_2903) && __wm_eq(__wm_scalar_198_5, registry_2904) && __wm_eq(__wm_scalar_198_6, changed_2905)) {

return [registry_2904, changed_2905];
} else if (__wm_scalar_198_0?.ctor === -6 && __wm_scalar_198_0.args.length === 1 && __wm_is_tuple(__wm_scalar_198_0.args[0]) && __wm_scalar_198_0.args[0].length === 2 && __wm_eq(__wm_scalar_198_1, expressionRegistry_2900) && __wm_eq(__wm_scalar_198_2, typeRegistry_2901) && __wm_eq(__wm_scalar_198_3, functionRegistry_2902) && __wm_eq(__wm_scalar_198_4, bindingFunctions_2903) && __wm_eq(__wm_scalar_198_5, registry_2904) && __wm_eq(__wm_scalar_198_6, changed_2905)) {
const expression_2906 = __wm_scalar_198_0.args[0][0];
const rest_2907 = __wm_scalar_198_0.args[0][1];
{
const __wm_bind_98 = applyNumericConstraint_2897__wm_d6(expression_2906, expressionRegistry_2900, typeRegistry_2901, functionRegistry_2902, bindingFunctions_2903, registry_2904);
if (!(__wm_is_tuple(__wm_bind_98) && __wm_bind_98.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_2908 = __wm_bind_98[0];
const expressionChanged_2909 = __wm_bind_98[1];
{
const __wm_tail_arg_224_0 = rest_2907;
const __wm_tail_arg_224_1 = expressionRegistry_2900;
const __wm_tail_arg_224_2 = typeRegistry_2901;
const __wm_tail_arg_224_3 = functionRegistry_2902;
const __wm_tail_arg_224_4 = bindingFunctions_2903;
const __wm_tail_arg_224_5 = nextRegistry_2908;
const __wm_tail_arg_224_6 = __wm_op_or_d2(changed_2905, expressionChanged_2909);
expressions_2899 = __wm_tail_arg_224_0;
expressionRegistry_2900 = __wm_tail_arg_224_1;
typeRegistry_2901 = __wm_tail_arg_224_2;
functionRegistry_2902 = __wm_tail_arg_224_3;
bindingFunctions_2903 = __wm_tail_arg_224_4;
registry_2904 = __wm_tail_arg_224_5;
changed_2905 = __wm_tail_arg_224_6;
continue __wm_tail_168;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const numericSweep_2898 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return numericSweep_2898__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const solveNumericRepresentations_2910__wm_d6 = (expressions_2911, expressionRegistry_2912, typeRegistry_2913, functionRegistry_2914, bindingFunctions_2915, registry_2916) => {
__wm_tail_169: while (true) {
{
const __wm_bind_99 = numericSweep_2898__wm_d7(expressions_2911, expressionRegistry_2912, typeRegistry_2913, functionRegistry_2914, bindingFunctions_2915, registry_2916, false);
if (!(__wm_is_tuple(__wm_bind_99) && __wm_bind_99.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_2917 = __wm_bind_99[0];
const changed_2918 = __wm_bind_99[1];
if (changed_2918) {
{
const __wm_tail_arg_225_0 = expressions_2911;
const __wm_tail_arg_225_1 = expressionRegistry_2912;
const __wm_tail_arg_225_2 = typeRegistry_2913;
const __wm_tail_arg_225_3 = functionRegistry_2914;
const __wm_tail_arg_225_4 = bindingFunctions_2915;
const __wm_tail_arg_225_5 = nextRegistry_2917;
expressions_2911 = __wm_tail_arg_225_0;
expressionRegistry_2912 = __wm_tail_arg_225_1;
typeRegistry_2913 = __wm_tail_arg_225_2;
functionRegistry_2914 = __wm_tail_arg_225_3;
bindingFunctions_2915 = __wm_tail_arg_225_4;
registry_2916 = __wm_tail_arg_225_5;
continue __wm_tail_169;
}
} else {
return nextRegistry_2917;
}
}
}
};
const solveNumericRepresentations_2910 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return solveNumericRepresentations_2910__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const collectExpressionItems_2919__wm_d4 = (pending_2920, expressionRegistry_2921, visited_2922, expressions_2923) => {
__wm_tail_170: while (true) {
{
const __wm_scalar_199_0 = pending_2920;
const __wm_scalar_199_1 = expressionRegistry_2921;
const __wm_scalar_199_2 = visited_2922;
const __wm_scalar_199_3 = expressions_2923;
if (__wm_scalar_199_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_199_1, expressionRegistry_2921) && __wm_eq(__wm_scalar_199_2, visited_2922) && __wm_eq(__wm_scalar_199_3, expressions_2923)) {

return expressions_2923;
} else if (__wm_scalar_199_0?.ctor === -6 && __wm_scalar_199_0.args.length === 1 && __wm_is_tuple(__wm_scalar_199_0.args[0]) && __wm_scalar_199_0.args[0].length === 2 && __wm_eq(__wm_scalar_199_1, expressionRegistry_2921) && __wm_eq(__wm_scalar_199_2, visited_2922) && __wm_eq(__wm_scalar_199_3, expressions_2923)) {
const expressionId_2924 = __wm_scalar_199_0.args[0][0];
const rest_2925 = __wm_scalar_199_0.args[0][1];
if (Map.has([visited_2922, expressionId_2924])) {
{
const __wm_tail_arg_226_0 = rest_2925;
const __wm_tail_arg_226_1 = expressionRegistry_2921;
const __wm_tail_arg_226_2 = visited_2922;
const __wm_tail_arg_226_3 = expressions_2923;
pending_2920 = __wm_tail_arg_226_0;
expressionRegistry_2921 = __wm_tail_arg_226_1;
visited_2922 = __wm_tail_arg_226_2;
expressions_2923 = __wm_tail_arg_226_3;
continue __wm_tail_170;
}
} else {
{
const nextVisited_2926 = Map.set([visited_2922, expressionId_2924, true]);
{
const __wm_tail_value_227 = Map.get([expressionRegistry_2921, expressionId_2924]);
if (__wm_tail_value_227?.ctor === -2 && __wm_tail_value_227.args.length === 1) {
const expression_2927 = __wm_tail_value_227.args[0];
{
const __wm_tail_arg_228_0 = prependAll_2586__wm_d2(Js.Array.toList(expression_2927.children), rest_2925);
const __wm_tail_arg_228_1 = expressionRegistry_2921;
const __wm_tail_arg_228_2 = nextVisited_2926;
const __wm_tail_arg_228_3 = __wm_basis_Cons([expression_2927, expressions_2923]);
pending_2920 = __wm_tail_arg_228_0;
expressionRegistry_2921 = __wm_tail_arg_228_1;
visited_2922 = __wm_tail_arg_228_2;
expressions_2923 = __wm_tail_arg_228_3;
continue __wm_tail_170;
}
} else if (__wm_tail_value_227 === __wm_basis_None) {

{
const __wm_tail_arg_229_0 = rest_2925;
const __wm_tail_arg_229_1 = expressionRegistry_2921;
const __wm_tail_arg_229_2 = nextVisited_2926;
const __wm_tail_arg_229_3 = expressions_2923;
pending_2920 = __wm_tail_arg_229_0;
expressionRegistry_2921 = __wm_tail_arg_229_1;
visited_2922 = __wm_tail_arg_229_2;
expressions_2923 = __wm_tail_arg_229_3;
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
const collectExpressionItems_2919 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return collectExpressionItems_2919__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const concreteRepresentation_2933__wm_d3 = (typeRegistry_2928, representations_2929, typeId_2930) => {
const __wm_return_value_63 = Map.get([typeRegistry_2928, typeId_2930]);
if (__wm_return_value_63?.ctor === -2 && __wm_return_value_63.args.length === 1) {
const gpuType_2931 = __wm_return_value_63.args[0];
if (__wm_op_or_d2(__wm_eq(gpuType_2931.kind, "number"), __wm_eq(gpuType_2931.kind, "vector"))) {
const representation_2932 = representationOf_2799__wm_d2(representations_2929, typeId_2930);
if (__wm_eq(representation_2932, "")) {
return "i32";
} else {
return representation_2932;
}
} else {
return "";
}
} else if (__wm_return_value_63 === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const concreteRepresentation_2933 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concreteRepresentation_2933__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setTypeRepresentation_2939__wm_d4 = (typeId_2934, representation_2935, typeRegistry_2936, registry_2937) => {
const typeIds_2938 = numericTypeIds_2836__wm_d3(__wm_basis_Cons([typeId_2934, __wm_basis_Nil]), typeRegistry_2936, __wm_basis_Nil);
return setRepresentations_2815__wm_d4(typeIds_2938, representation_2935, registry_2937, false);
};
const setTypeRepresentation_2939 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setTypeRepresentation_2939__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const seedParamRepresentations_2940__wm_d4 = (params_2941, representations_2942, typeRegistry_2943, registry_2944) => {
__wm_tail_171: while (true) {
{
const __wm_scalar_200_0 = params_2941;
const __wm_scalar_200_1 = representations_2942;
const __wm_scalar_200_2 = typeRegistry_2943;
const __wm_scalar_200_3 = registry_2944;
if (__wm_scalar_200_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_200_1, representations_2942) && __wm_eq(__wm_scalar_200_2, typeRegistry_2943) && __wm_eq(__wm_scalar_200_3, registry_2944)) {

return registry_2944;
} else if (__wm_eq(__wm_scalar_200_0, params_2941) && __wm_scalar_200_1 === __wm_basis_Nil && __wm_eq(__wm_scalar_200_2, typeRegistry_2943) && __wm_eq(__wm_scalar_200_3, registry_2944)) {

return registry_2944;
} else if (__wm_scalar_200_0?.ctor === -6 && __wm_scalar_200_0.args.length === 1 && __wm_is_tuple(__wm_scalar_200_0.args[0]) && __wm_scalar_200_0.args[0].length === 2 && __wm_scalar_200_1?.ctor === -6 && __wm_scalar_200_1.args.length === 1 && __wm_is_tuple(__wm_scalar_200_1.args[0]) && __wm_scalar_200_1.args[0].length === 2 && __wm_eq(__wm_scalar_200_2, typeRegistry_2943) && __wm_eq(__wm_scalar_200_3, registry_2944)) {
const param_2945 = __wm_scalar_200_0.args[0][0];
const restParams_2946 = __wm_scalar_200_0.args[0][1];
const representation_2947 = __wm_scalar_200_1.args[0][0];
const restRepresentations_2948 = __wm_scalar_200_1.args[0][1];
{
const __wm_bind_100 = setTypeRepresentation_2939__wm_d4(param_2945.typeId, representation_2947, typeRegistry_2943, registry_2944);
if (!(__wm_is_tuple(__wm_bind_100) && __wm_bind_100.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_2949 = __wm_bind_100[0];
const _changed_2950 = __wm_bind_100[1];
{
const __wm_tail_arg_230_0 = restParams_2946;
const __wm_tail_arg_230_1 = restRepresentations_2948;
const __wm_tail_arg_230_2 = typeRegistry_2943;
const __wm_tail_arg_230_3 = nextRegistry_2949;
params_2941 = __wm_tail_arg_230_0;
representations_2942 = __wm_tail_arg_230_1;
typeRegistry_2943 = __wm_tail_arg_230_2;
registry_2944 = __wm_tail_arg_230_3;
continue __wm_tail_171;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const seedParamRepresentations_2940 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return seedParamRepresentations_2940__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const functionParamRepresentations_2951__wm_d4 = (params_2952, typeRegistry_2953, representations_2954, output_2955) => {
__wm_tail_172: while (true) {
{
const __wm_scalar_201_0 = params_2952;
const __wm_scalar_201_1 = typeRegistry_2953;
const __wm_scalar_201_2 = representations_2954;
const __wm_scalar_201_3 = output_2955;
if (__wm_scalar_201_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_201_1, typeRegistry_2953) && __wm_eq(__wm_scalar_201_2, representations_2954) && __wm_eq(__wm_scalar_201_3, output_2955)) {

return reverseInto_2591__wm_d2(output_2955, __wm_basis_Nil);
} else if (__wm_scalar_201_0?.ctor === -6 && __wm_scalar_201_0.args.length === 1 && __wm_is_tuple(__wm_scalar_201_0.args[0]) && __wm_scalar_201_0.args[0].length === 2 && __wm_eq(__wm_scalar_201_1, typeRegistry_2953) && __wm_eq(__wm_scalar_201_2, representations_2954) && __wm_eq(__wm_scalar_201_3, output_2955)) {
const param_2956 = __wm_scalar_201_0.args[0][0];
const rest_2957 = __wm_scalar_201_0.args[0][1];
{
const __wm_tail_arg_231_0 = rest_2957;
const __wm_tail_arg_231_1 = typeRegistry_2953;
const __wm_tail_arg_231_2 = representations_2954;
const __wm_tail_arg_231_3 = __wm_basis_Cons([concreteRepresentation_2933__wm_d3(typeRegistry_2953, representations_2954, param_2956.typeId), output_2955]);
params_2952 = __wm_tail_arg_231_0;
typeRegistry_2953 = __wm_tail_arg_231_1;
representations_2954 = __wm_tail_arg_231_2;
output_2955 = __wm_tail_arg_231_3;
continue __wm_tail_172;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const functionParamRepresentations_2951 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return functionParamRepresentations_2951__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const callArgumentRepresentations_2958__wm_d5 = (argumentIds_2959, expressionRegistry_2960, typeRegistry_2961, representations_2962, output_2963) => {
__wm_tail_173: while (true) {
{
const __wm_scalar_202_0 = argumentIds_2959;
const __wm_scalar_202_1 = expressionRegistry_2960;
const __wm_scalar_202_2 = typeRegistry_2961;
const __wm_scalar_202_3 = representations_2962;
const __wm_scalar_202_4 = output_2963;
if (__wm_scalar_202_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_202_1, expressionRegistry_2960) && __wm_eq(__wm_scalar_202_2, typeRegistry_2961) && __wm_eq(__wm_scalar_202_3, representations_2962) && __wm_eq(__wm_scalar_202_4, output_2963)) {

return reverseInto_2591__wm_d2(output_2963, __wm_basis_Nil);
} else if (__wm_scalar_202_0?.ctor === -6 && __wm_scalar_202_0.args.length === 1 && __wm_is_tuple(__wm_scalar_202_0.args[0]) && __wm_scalar_202_0.args[0].length === 2 && __wm_eq(__wm_scalar_202_1, expressionRegistry_2960) && __wm_eq(__wm_scalar_202_2, typeRegistry_2961) && __wm_eq(__wm_scalar_202_3, representations_2962) && __wm_eq(__wm_scalar_202_4, output_2963)) {
const argumentId_2964 = __wm_scalar_202_0.args[0][0];
const rest_2965 = __wm_scalar_202_0.args[0][1];
{
const representation_2967 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const argument_2966 = __v.args[0];
return concreteRepresentation_2933__wm_d3(typeRegistry_2961, representations_2962, argument_2966.typeId);
} else if (__v === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([expressionRegistry_2960, argumentId_2964]));
{
const __wm_tail_arg_232_0 = rest_2965;
const __wm_tail_arg_232_1 = expressionRegistry_2960;
const __wm_tail_arg_232_2 = typeRegistry_2961;
const __wm_tail_arg_232_3 = representations_2962;
const __wm_tail_arg_232_4 = __wm_basis_Cons([representation_2967, output_2963]);
argumentIds_2959 = __wm_tail_arg_232_0;
expressionRegistry_2960 = __wm_tail_arg_232_1;
typeRegistry_2961 = __wm_tail_arg_232_2;
representations_2962 = __wm_tail_arg_232_3;
output_2963 = __wm_tail_arg_232_4;
continue __wm_tail_173;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const callArgumentRepresentations_2958 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return callArgumentRepresentations_2958__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeArgumentRepresentations_2968__wm_d6 = (argumentIds_2969, representations_2970, expressionRegistry_2971, typeRegistry_2972, registry_2973, changed_2974) => {
__wm_tail_174: while (true) {
{
const __wm_scalar_203_0 = argumentIds_2969;
const __wm_scalar_203_1 = representations_2970;
const __wm_scalar_203_2 = expressionRegistry_2971;
const __wm_scalar_203_3 = typeRegistry_2972;
const __wm_scalar_203_4 = registry_2973;
const __wm_scalar_203_5 = changed_2974;
if (__wm_scalar_203_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_203_1, representations_2970) && __wm_eq(__wm_scalar_203_2, expressionRegistry_2971) && __wm_eq(__wm_scalar_203_3, typeRegistry_2972) && __wm_eq(__wm_scalar_203_4, registry_2973) && __wm_eq(__wm_scalar_203_5, changed_2974)) {

return [registry_2973, changed_2974];
} else if (__wm_eq(__wm_scalar_203_0, argumentIds_2969) && __wm_scalar_203_1 === __wm_basis_Nil && __wm_eq(__wm_scalar_203_2, expressionRegistry_2971) && __wm_eq(__wm_scalar_203_3, typeRegistry_2972) && __wm_eq(__wm_scalar_203_4, registry_2973) && __wm_eq(__wm_scalar_203_5, changed_2974)) {

return [registry_2973, changed_2974];
} else if (__wm_scalar_203_0?.ctor === -6 && __wm_scalar_203_0.args.length === 1 && __wm_is_tuple(__wm_scalar_203_0.args[0]) && __wm_scalar_203_0.args[0].length === 2 && __wm_scalar_203_1?.ctor === -6 && __wm_scalar_203_1.args.length === 1 && __wm_is_tuple(__wm_scalar_203_1.args[0]) && __wm_scalar_203_1.args[0].length === 2 && __wm_eq(__wm_scalar_203_2, expressionRegistry_2971) && __wm_eq(__wm_scalar_203_3, typeRegistry_2972) && __wm_eq(__wm_scalar_203_4, registry_2973) && __wm_eq(__wm_scalar_203_5, changed_2974)) {
const argumentId_2975 = __wm_scalar_203_0.args[0][0];
const restArguments_2976 = __wm_scalar_203_0.args[0][1];
const representation_2977 = __wm_scalar_203_1.args[0][0];
const restRepresentations_2978 = __wm_scalar_203_1.args[0][1];
{
const __wm_tail_value_233 = Map.get([expressionRegistry_2971, argumentId_2975]);
if (__wm_tail_value_233?.ctor === -2 && __wm_tail_value_233.args.length === 1) {
const argument_2979 = __wm_tail_value_233.args[0];
{
const __wm_bind_101 = setTypeRepresentation_2939__wm_d4(argument_2979.typeId, representation_2977, typeRegistry_2972, registry_2973);
if (!(__wm_is_tuple(__wm_bind_101) && __wm_bind_101.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_2980 = __wm_bind_101[0];
const itemChanged_2981 = __wm_bind_101[1];
{
const __wm_tail_arg_234_0 = restArguments_2976;
const __wm_tail_arg_234_1 = restRepresentations_2978;
const __wm_tail_arg_234_2 = expressionRegistry_2971;
const __wm_tail_arg_234_3 = typeRegistry_2972;
const __wm_tail_arg_234_4 = nextRegistry_2980;
const __wm_tail_arg_234_5 = __wm_op_or_d2(changed_2974, itemChanged_2981);
argumentIds_2969 = __wm_tail_arg_234_0;
representations_2970 = __wm_tail_arg_234_1;
expressionRegistry_2971 = __wm_tail_arg_234_2;
typeRegistry_2972 = __wm_tail_arg_234_3;
registry_2973 = __wm_tail_arg_234_4;
changed_2974 = __wm_tail_arg_234_5;
continue __wm_tail_174;
}
}
} else if (__wm_tail_value_233 === __wm_basis_None) {

{
const __wm_tail_arg_235_0 = restArguments_2976;
const __wm_tail_arg_235_1 = restRepresentations_2978;
const __wm_tail_arg_235_2 = expressionRegistry_2971;
const __wm_tail_arg_235_3 = typeRegistry_2972;
const __wm_tail_arg_235_4 = registry_2973;
const __wm_tail_arg_235_5 = changed_2974;
argumentIds_2969 = __wm_tail_arg_235_0;
representations_2970 = __wm_tail_arg_235_1;
expressionRegistry_2971 = __wm_tail_arg_235_2;
typeRegistry_2972 = __wm_tail_arg_235_3;
registry_2973 = __wm_tail_arg_235_4;
changed_2974 = __wm_tail_arg_235_5;
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
const mergeArgumentRepresentations_2968 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return mergeArgumentRepresentations_2968__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const solveFunctionInstance_2982__wm_d9 = (fn_2985, paramRepresentations_2986, resultRepresentation_2987, active_2988, functionRegistry_2989, expressionRegistry_2990, bindingFunctions_2991, typeRegistry_2992, typeItems_2993) => {
const seeded_2994 = seedRepresentations_2824__wm_d2(typeItems_2993, Map.empty(Map.numberCompare));
const withParams_2995 = seedParamRepresentations_2940__wm_d4(Js.Array.toList(fn_2985.params), paramRepresentations_2986, typeRegistry_2992, seeded_2994);
const __wm_bind_102 = setTypeRepresentation_2939__wm_d4(fn_2985.resultTypeId, resultRepresentation_2987, typeRegistry_2992, withParams_2995);
if (!(__wm_is_tuple(__wm_bind_102) && __wm_bind_102.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const initial_2996 = __wm_bind_102[0];
const _resultChanged_2997 = __wm_bind_102[1];
const expressions_2998 = collectExpressionItems_2919__wm_d4(__wm_basis_Cons([fn_2985.bodyExprId, __wm_basis_Nil]), expressionRegistry_2990, Map.empty(Map.numberCompare), __wm_basis_Nil);
return solveInstanceFixedPoint_2983__wm_d9(fn_2985, expressions_2998, Map.set([active_2988, fn_2985.id, true]), functionRegistry_2989, expressionRegistry_2990, bindingFunctions_2991, typeRegistry_2992, typeItems_2993, initial_2996);
};
const solveFunctionInstance_2982 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return solveFunctionInstance_2982__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const solveInstanceFixedPoint_2983__wm_d9 = (fn_2999, expressions_3000, active_3001, functionRegistry_3002, expressionRegistry_3003, bindingFunctions_3004, typeRegistry_3005, typeItems_3006, registry_3007) => {
__wm_tail_175: while (true) {
{
const __wm_bind_103 = instanceSweep_2984__wm_d10(expressions_3000, fn_2999, active_3001, functionRegistry_3002, expressionRegistry_3003, bindingFunctions_3004, typeRegistry_3005, typeItems_3006, registry_3007, false);
if (!(__wm_is_tuple(__wm_bind_103) && __wm_bind_103.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_3008 = __wm_bind_103[0];
const changed_3009 = __wm_bind_103[1];
if (changed_3009) {
{
const __wm_tail_arg_236_0 = fn_2999;
const __wm_tail_arg_236_1 = expressions_3000;
const __wm_tail_arg_236_2 = active_3001;
const __wm_tail_arg_236_3 = functionRegistry_3002;
const __wm_tail_arg_236_4 = expressionRegistry_3003;
const __wm_tail_arg_236_5 = bindingFunctions_3004;
const __wm_tail_arg_236_6 = typeRegistry_3005;
const __wm_tail_arg_236_7 = typeItems_3006;
const __wm_tail_arg_236_8 = nextRegistry_3008;
fn_2999 = __wm_tail_arg_236_0;
expressions_3000 = __wm_tail_arg_236_1;
active_3001 = __wm_tail_arg_236_2;
functionRegistry_3002 = __wm_tail_arg_236_3;
expressionRegistry_3003 = __wm_tail_arg_236_4;
bindingFunctions_3004 = __wm_tail_arg_236_5;
typeRegistry_3005 = __wm_tail_arg_236_6;
typeItems_3006 = __wm_tail_arg_236_7;
registry_3007 = __wm_tail_arg_236_8;
continue __wm_tail_175;
}
} else {
return nextRegistry_3008;
}
}
}
};
const solveInstanceFixedPoint_2983 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return solveInstanceFixedPoint_2983__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const instanceSweep_2984__wm_d10 = (expressions_3010, fn_3011, active_3012, functionRegistry_3013, expressionRegistry_3014, bindingFunctions_3015, typeRegistry_3016, typeItems_3017, registry_3018, changed_3019) => {
__wm_tail_176: while (true) {
{
const __wm_scalar_204_0 = expressions_3010;
const __wm_scalar_204_1 = fn_3011;
const __wm_scalar_204_2 = active_3012;
const __wm_scalar_204_3 = functionRegistry_3013;
const __wm_scalar_204_4 = expressionRegistry_3014;
const __wm_scalar_204_5 = bindingFunctions_3015;
const __wm_scalar_204_6 = typeRegistry_3016;
const __wm_scalar_204_7 = typeItems_3017;
const __wm_scalar_204_8 = registry_3018;
const __wm_scalar_204_9 = changed_3019;
if (__wm_scalar_204_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_204_1, fn_3011) && __wm_eq(__wm_scalar_204_2, active_3012) && __wm_eq(__wm_scalar_204_3, functionRegistry_3013) && __wm_eq(__wm_scalar_204_4, expressionRegistry_3014) && __wm_eq(__wm_scalar_204_5, bindingFunctions_3015) && __wm_eq(__wm_scalar_204_6, typeRegistry_3016) && __wm_eq(__wm_scalar_204_7, typeItems_3017) && __wm_eq(__wm_scalar_204_8, registry_3018) && __wm_eq(__wm_scalar_204_9, changed_3019)) {

return [registry_3018, changed_3019];
} else if (__wm_scalar_204_0?.ctor === -6 && __wm_scalar_204_0.args.length === 1 && __wm_is_tuple(__wm_scalar_204_0.args[0]) && __wm_scalar_204_0.args[0].length === 2 && __wm_eq(__wm_scalar_204_1, fn_3011) && __wm_eq(__wm_scalar_204_2, active_3012) && __wm_eq(__wm_scalar_204_3, functionRegistry_3013) && __wm_eq(__wm_scalar_204_4, expressionRegistry_3014) && __wm_eq(__wm_scalar_204_5, bindingFunctions_3015) && __wm_eq(__wm_scalar_204_6, typeRegistry_3016) && __wm_eq(__wm_scalar_204_7, typeItems_3017) && __wm_eq(__wm_scalar_204_8, registry_3018) && __wm_eq(__wm_scalar_204_9, changed_3019)) {
const expression_3020 = __wm_scalar_204_0.args[0][0];
const rest_3021 = __wm_scalar_204_0.args[0][1];
{
const currentFn_3022 = fn_3011;
const __wm_bind_104 = (__wm_eq(expression_3020.kind, "call") ? ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2) {
const calleeId_3023 = __v.args[0][0];
const argumentIds_3024 = __v.args[0][1];
const __wm_return_value_64 = Map.get([expressionRegistry_3014, calleeId_3023]);
if (__wm_return_value_64?.ctor === -2 && __wm_return_value_64.args.length === 1) {
const callee_3025 = __wm_return_value_64.args[0];
const __wm_return_value_65 = Map.get([bindingFunctions_3015, callee_3025.bindingId]);
if (__wm_return_value_65?.ctor === -2 && __wm_return_value_65.args.length === 1) {
const functionId_3026 = __wm_return_value_65.args[0];
const __wm_return_value_66 = Map.get([functionRegistry_3013, functionId_3026]);
if (__wm_return_value_66?.ctor === -2 && __wm_return_value_66.args.length === 1) {
const rawCalleeFn_3027 = __wm_return_value_66.args[0];
const calleeFn_3028 = rawCalleeFn_3027;
if (__wm_eq(calleeFn_3028.id, currentFn_3022.id)) {
return applyCallConstraint_2889__wm_d6(expression_3020, expressionRegistry_3014, typeRegistry_3016, functionRegistry_3013, bindingFunctions_3015, registry_3018);
} else {
if (Map.has([active_3012, calleeFn_3028.id])) {
return [registry_3018, false];
} else {
const argumentRepresentations_3029 = callArgumentRepresentations_2958__wm_d5(argumentIds_3024, expressionRegistry_3014, typeRegistry_3016, registry_3018, __wm_basis_Nil);
const callResultRepresentation_3030 = concreteRepresentation_2933__wm_d3(typeRegistry_3016, registry_3018, expression_3020.typeId);
const calleeRepresentations_3031 = solveFunctionInstance_2982__wm_d9(calleeFn_3028, argumentRepresentations_3029, callResultRepresentation_3030, active_3012, functionRegistry_3013, expressionRegistry_3014, bindingFunctions_3015, typeRegistry_3016, typeItems_3017);
const resolvedParams_3032 = functionParamRepresentations_2951__wm_d4(Js.Array.toList(calleeFn_3028.params), typeRegistry_3016, calleeRepresentations_3031, __wm_basis_Nil);
const resolvedResult_3033 = concreteRepresentation_2933__wm_d3(typeRegistry_3016, calleeRepresentations_3031, calleeFn_3028.resultTypeId);
const __wm_bind_105 = mergeArgumentRepresentations_2968__wm_d6(argumentIds_3024, resolvedParams_3032, expressionRegistry_3014, typeRegistry_3016, registry_3018, false);
if (!(__wm_is_tuple(__wm_bind_105) && __wm_bind_105.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withArguments_3034 = __wm_bind_105[0];
const argumentsChanged_3035 = __wm_bind_105[1];
const __wm_bind_106 = setTypeRepresentation_2939__wm_d4(expression_3020.typeId, resolvedResult_3033, typeRegistry_3016, withArguments_3034);
if (!(__wm_is_tuple(__wm_bind_106) && __wm_bind_106.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withResult_3036 = __wm_bind_106[0];
const resultChanged_3037 = __wm_bind_106[1];
return [withResult_3036, __wm_op_or_d2(argumentsChanged_3035, resultChanged_3037)];
}
}
} else if (__wm_return_value_66 === __wm_basis_None) {

return [registry_3018, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_65 === __wm_basis_None) {

return [registry_3018, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_64 === __wm_basis_None) {

return [registry_3018, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__v === __wm_basis_Nil) {

return [registry_3018, false];
}
__wm_fail("Match", "non-exhaustive match");
})(Js.Array.toList(expression_3020.children)) : (() => {
const typeIds_3038 = constraintTypeIds_2855__wm_d3(expression_3020, expressionRegistry_3014, typeRegistry_3016);
return applyNumericGroup_2859__wm_d2(typeIds_3038, registry_3018);
})());
if (!(__wm_is_tuple(__wm_bind_104) && __wm_bind_104.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_3039 = __wm_bind_104[0];
const expressionChanged_3040 = __wm_bind_104[1];
{
const __wm_tail_arg_237_0 = rest_3021;
const __wm_tail_arg_237_1 = fn_3011;
const __wm_tail_arg_237_2 = active_3012;
const __wm_tail_arg_237_3 = functionRegistry_3013;
const __wm_tail_arg_237_4 = expressionRegistry_3014;
const __wm_tail_arg_237_5 = bindingFunctions_3015;
const __wm_tail_arg_237_6 = typeRegistry_3016;
const __wm_tail_arg_237_7 = typeItems_3017;
const __wm_tail_arg_237_8 = nextRegistry_3039;
const __wm_tail_arg_237_9 = __wm_op_or_d2(changed_3019, expressionChanged_3040);
expressions_3010 = __wm_tail_arg_237_0;
fn_3011 = __wm_tail_arg_237_1;
active_3012 = __wm_tail_arg_237_2;
functionRegistry_3013 = __wm_tail_arg_237_3;
expressionRegistry_3014 = __wm_tail_arg_237_4;
bindingFunctions_3015 = __wm_tail_arg_237_5;
typeRegistry_3016 = __wm_tail_arg_237_6;
typeItems_3017 = __wm_tail_arg_237_7;
registry_3018 = __wm_tail_arg_237_8;
changed_3019 = __wm_tail_arg_237_9;
continue __wm_tail_176;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const instanceSweep_2984 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return instanceSweep_2984__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
const representationsEqual_3041__wm_d2 = (left_3042, right_3043) => {
const __wm_scalar_205_0 = left_3042;
const __wm_scalar_205_1 = right_3043;
if (__wm_scalar_205_0 === __wm_basis_Nil && __wm_scalar_205_1 === __wm_basis_Nil) {

return true;
} else if (__wm_scalar_205_0?.ctor === -6 && __wm_scalar_205_0.args.length === 1 && __wm_is_tuple(__wm_scalar_205_0.args[0]) && __wm_scalar_205_0.args[0].length === 2 && __wm_scalar_205_1?.ctor === -6 && __wm_scalar_205_1.args.length === 1 && __wm_is_tuple(__wm_scalar_205_1.args[0]) && __wm_scalar_205_1.args[0].length === 2) {
const leftHead_3044 = __wm_scalar_205_0.args[0][0];
const leftRest_3045 = __wm_scalar_205_0.args[0][1];
const rightHead_3046 = __wm_scalar_205_1.args[0][0];
const rightRest_3047 = __wm_scalar_205_1.args[0][1];
const same_3048 = __wm_op_or_d2(__wm_op_or_d2(__wm_op_and_d2(__wm_eq(leftHead_3044, ""), __wm_eq(rightHead_3046, "")), __wm_op_and_d2(__wm_eq(leftHead_3044, "i32"), __wm_eq(rightHead_3046, "i32"))), __wm_op_and_d2(__wm_eq(leftHead_3044, "f32"), __wm_eq(rightHead_3046, "f32")));
return __wm_op_and_d2(same_3048, representationsEqual_3041__wm_d2(leftRest_3045, rightRest_3047));
} else if (true) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
};
const representationsEqual_3041 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return representationsEqual_3041__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findSpecialization_3049__wm_d3 = (entries_3050, paramRepresentations_3051, resultRepresentation_3052) => {
__wm_tail_177: while (true) {
{
const __wm_tail_value_238 = entries_3050;
if (__wm_tail_value_238 === __wm_basis_Nil) {

return __wm_basis_None;
} else if (__wm_tail_value_238?.ctor === -6 && __wm_tail_value_238.args.length === 1 && __wm_is_tuple(__wm_tail_value_238.args[0]) && __wm_tail_value_238.args[0].length === 2) {
const entry_3053 = __wm_tail_value_238.args[0][0];
const rest_3054 = __wm_tail_value_238.args[0][1];
{
const sameResult_3055 = __wm_op_or_d2(__wm_op_or_d2(__wm_op_and_d2(__wm_eq(entry_3053.resultRepresentation, ""), __wm_eq(resultRepresentation_3052, "")), __wm_op_and_d2(__wm_eq(entry_3053.resultRepresentation, "i32"), __wm_eq(resultRepresentation_3052, "i32"))), __wm_op_and_d2(__wm_eq(entry_3053.resultRepresentation, "f32"), __wm_eq(resultRepresentation_3052, "f32")));
if (__wm_op_and_d2(sameResult_3055, representationsEqual_3041__wm_d2(Js.Array.toList(entry_3053.paramRepresentations), paramRepresentations_3051))) {
return __wm_basis_Some(entry_3053.specializationId);
} else {
{
const __wm_tail_arg_239_0 = rest_3054;
const __wm_tail_arg_239_1 = paramRepresentations_3051;
const __wm_tail_arg_239_2 = resultRepresentation_3052;
entries_3050 = __wm_tail_arg_239_0;
paramRepresentations_3051 = __wm_tail_arg_239_1;
resultRepresentation_3052 = __wm_tail_arg_239_2;
continue __wm_tail_177;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findSpecialization_3049 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findSpecialization_3049__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const representationSuffix_3056__wm_d2 = (representations_3057, suffix_3058) => {
__wm_tail_178: while (true) {
{
const __wm_scalar_206_0 = representations_3057;
const __wm_scalar_206_1 = suffix_3058;
if (__wm_scalar_206_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_206_1, suffix_3058)) {

return suffix_3058;
} else if (__wm_scalar_206_0?.ctor === -6 && __wm_scalar_206_0.args.length === 1 && __wm_is_tuple(__wm_scalar_206_0.args[0]) && __wm_scalar_206_0.args[0].length === 2 && __wm_eq(__wm_scalar_206_1, suffix_3058)) {
const representation_3059 = __wm_scalar_206_0.args[0][0];
const rest_3060 = __wm_scalar_206_0.args[0][1];
{
const separator_3061 = (__wm_eq(suffix_3058, "") ? "" : "_");
{
const __wm_tail_arg_240_0 = rest_3060;
const __wm_tail_arg_240_1 = ((suffix_3058 + separator_3061) + representation_3059);
representations_3057 = __wm_tail_arg_240_0;
suffix_3058 = __wm_tail_arg_240_1;
continue __wm_tail_178;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const representationSuffix_3056 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return representationSuffix_3056__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const specializationName_3065__wm_d3 = (fn_3062, paramRepresentations_3063, resultRepresentation_3064) => {
return ((((fn_3062.name + "__gpu_") + representationSuffix_3056__wm_d2(paramRepresentations_3063, "")) + "_to_") + resultRepresentation_3064);
};
const specializationName_3065 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return specializationName_3065__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const addTypeIds_3066__wm_d2 = (typeIds_3067, typeSet_3068) => {
__wm_tail_179: while (true) {
{
const __wm_scalar_207_0 = typeIds_3067;
const __wm_scalar_207_1 = typeSet_3068;
if (__wm_scalar_207_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_207_1, typeSet_3068)) {

return typeSet_3068;
} else if (__wm_scalar_207_0?.ctor === -6 && __wm_scalar_207_0.args.length === 1 && __wm_is_tuple(__wm_scalar_207_0.args[0]) && __wm_scalar_207_0.args[0].length === 2 && __wm_eq(__wm_scalar_207_1, typeSet_3068)) {
const typeId_3069 = __wm_scalar_207_0.args[0][0];
const rest_3070 = __wm_scalar_207_0.args[0][1];
{
const __wm_tail_arg_241_0 = rest_3070;
const __wm_tail_arg_241_1 = Map.set([typeSet_3068, typeId_3069, true]);
typeIds_3067 = __wm_tail_arg_241_0;
typeSet_3068 = __wm_tail_arg_241_1;
continue __wm_tail_179;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addTypeIds_3066 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addTypeIds_3066__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collectInstanceTypeIds_3071__wm_d3 = (expressions_3072, typeRegistry_3073, typeSet_3074) => {
__wm_tail_180: while (true) {
{
const __wm_scalar_208_0 = expressions_3072;
const __wm_scalar_208_1 = typeRegistry_3073;
const __wm_scalar_208_2 = typeSet_3074;
if (__wm_scalar_208_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_208_1, typeRegistry_3073) && __wm_eq(__wm_scalar_208_2, typeSet_3074)) {

return typeSet_3074;
} else if (__wm_scalar_208_0?.ctor === -6 && __wm_scalar_208_0.args.length === 1 && __wm_is_tuple(__wm_scalar_208_0.args[0]) && __wm_scalar_208_0.args[0].length === 2 && __wm_eq(__wm_scalar_208_1, typeRegistry_3073) && __wm_eq(__wm_scalar_208_2, typeSet_3074)) {
const expression_3075 = __wm_scalar_208_0.args[0][0];
const rest_3076 = __wm_scalar_208_0.args[0][1];
{
const __wm_tail_arg_242_0 = rest_3076;
const __wm_tail_arg_242_1 = typeRegistry_3073;
const __wm_tail_arg_242_2 = addTypeIds_3066__wm_d2(numericTypeIds_2836__wm_d3(__wm_basis_Cons([expression_3075.typeId, __wm_basis_Nil]), typeRegistry_3073, __wm_basis_Nil), typeSet_3074);
expressions_3072 = __wm_tail_arg_242_0;
typeRegistry_3073 = __wm_tail_arg_242_1;
typeSet_3074 = __wm_tail_arg_242_2;
continue __wm_tail_180;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const collectInstanceTypeIds_3071 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return collectInstanceTypeIds_3071__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const addParamTypeIds_3077__wm_d3 = (params_3078, typeRegistry_3079, typeSet_3080) => {
__wm_tail_181: while (true) {
{
const __wm_scalar_209_0 = params_3078;
const __wm_scalar_209_1 = typeRegistry_3079;
const __wm_scalar_209_2 = typeSet_3080;
if (__wm_scalar_209_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_209_1, typeRegistry_3079) && __wm_eq(__wm_scalar_209_2, typeSet_3080)) {

return typeSet_3080;
} else if (__wm_scalar_209_0?.ctor === -6 && __wm_scalar_209_0.args.length === 1 && __wm_is_tuple(__wm_scalar_209_0.args[0]) && __wm_scalar_209_0.args[0].length === 2 && __wm_eq(__wm_scalar_209_1, typeRegistry_3079) && __wm_eq(__wm_scalar_209_2, typeSet_3080)) {
const param_3081 = __wm_scalar_209_0.args[0][0];
const rest_3082 = __wm_scalar_209_0.args[0][1];
{
const __wm_tail_arg_243_0 = rest_3082;
const __wm_tail_arg_243_1 = typeRegistry_3079;
const __wm_tail_arg_243_2 = addTypeIds_3066__wm_d2(numericTypeIds_2836__wm_d3(__wm_basis_Cons([param_3081.typeId, __wm_basis_Nil]), typeRegistry_3079, __wm_basis_Nil), typeSet_3080);
params_3078 = __wm_tail_arg_243_0;
typeRegistry_3079 = __wm_tail_arg_243_1;
typeSet_3080 = __wm_tail_arg_243_2;
continue __wm_tail_181;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addParamTypeIds_3077 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return addParamTypeIds_3077__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const representationFacts_3083__wm_d4 = (typeEntries_3084, typeRegistry_3085, representations_3086, facts_3087) => {
__wm_tail_182: while (true) {
{
const __wm_scalar_210_0 = typeEntries_3084;
const __wm_scalar_210_1 = typeRegistry_3085;
const __wm_scalar_210_2 = representations_3086;
const __wm_scalar_210_3 = facts_3087;
if (__wm_scalar_210_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_210_1, typeRegistry_3085) && __wm_eq(__wm_scalar_210_2, representations_3086) && __wm_eq(__wm_scalar_210_3, facts_3087)) {

return reverseInto_2591__wm_d2(facts_3087, __wm_basis_Nil);
} else if (__wm_scalar_210_0?.ctor === -6 && __wm_scalar_210_0.args.length === 1 && __wm_is_tuple(__wm_scalar_210_0.args[0]) && __wm_scalar_210_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_210_0.args[0][0]) && __wm_scalar_210_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_210_1, typeRegistry_3085) && __wm_eq(__wm_scalar_210_2, representations_3086) && __wm_eq(__wm_scalar_210_3, facts_3087)) {
const typeId_3088 = __wm_scalar_210_0.args[0][0][0];
const _present_3089 = __wm_scalar_210_0.args[0][0][1];
const rest_3090 = __wm_scalar_210_0.args[0][1];
{
const fact_3091 = { typeId: typeId_3088, representation: concreteRepresentation_2933__wm_d3(typeRegistry_3085, representations_3086, typeId_3088) };
{
const __wm_tail_arg_244_0 = rest_3090;
const __wm_tail_arg_244_1 = typeRegistry_3085;
const __wm_tail_arg_244_2 = representations_3086;
const __wm_tail_arg_244_3 = __wm_basis_Cons([fact_3091, facts_3087]);
typeEntries_3084 = __wm_tail_arg_244_0;
typeRegistry_3085 = __wm_tail_arg_244_1;
representations_3086 = __wm_tail_arg_244_2;
facts_3087 = __wm_tail_arg_244_3;
continue __wm_tail_182;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const representationFacts_3083 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return representationFacts_3083__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const specializationTypeFacts_3099__wm_d4 = (fn_3092, expressions_3093, typeRegistry_3094, representations_3095) => {
const withExpressions_3096 = collectInstanceTypeIds_3071__wm_d3(expressions_3093, typeRegistry_3094, Map.empty(Map.numberCompare));
const withParams_3097 = addParamTypeIds_3077__wm_d3(Js.Array.toList(fn_3092.params), typeRegistry_3094, withExpressions_3096);
const allTypes_3098 = addTypeIds_3066__wm_d2(numericTypeIds_2836__wm_d3(__wm_basis_Cons([fn_3092.resultTypeId, __wm_basis_Nil]), typeRegistry_3094, __wm_basis_Nil), withParams_3097);
return representationFacts_3083__wm_d4(Map.toList(allTypes_3098), typeRegistry_3094, representations_3095, __wm_basis_Nil);
};
const specializationTypeFacts_3099 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return specializationTypeFacts_3099__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const initialSpecializationState_3100 = (__arg) => {
if (__arg === undefined) {

return { nextId: 0, registry: Map.empty(Map.numberCompare), specializations: __wm_basis_Nil, rootSpecializations: __wm_basis_Nil, calls: __wm_basis_Nil, diagnostics: __wm_basis_Nil };
}
__wm_fail("Match", "pattern match failure in function");
};
const withSpecializedCall_3103__wm_d2 = (state_3101, call_3102) => {
return { nextId: state_3101.nextId, registry: state_3101.registry, specializations: state_3101.specializations, rootSpecializations: state_3101.rootSpecializations, calls: __wm_basis_Cons([call_3102, state_3101.calls]), diagnostics: state_3101.diagnostics };
};
const withSpecializedCall_3103 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return withSpecializedCall_3103__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const withSpecializationDiagnostic_3106__wm_d2 = (state_3104, diagnostic_3105) => {
return { nextId: state_3104.nextId, registry: state_3104.registry, specializations: state_3104.specializations, rootSpecializations: state_3104.rootSpecializations, calls: state_3104.calls, diagnostics: __wm_basis_Cons([diagnostic_3105, state_3104.diagnostics]) };
};
const withSpecializationDiagnostic_3106 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return withSpecializationDiagnostic_3106__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const mutualRecursionDiagnostic_3109 = (__arg) => {
if (true) {
const expression_3107 = __arg;
const diagnostic_3108 = { code: "gpu.mutual-recursion", message: "mutually recursive GPU functions are not supported by the current specialization pass", spanId: expression_3107.spanId };
return diagnostic_3108;
}
__wm_fail("Match", "pattern match failure in function");
};
const materializeSpecialization_3110__wm_d10 = (fn_3112, requestedParams_3113, requestedResult_3114, active_3115, state_3116, functionRegistry_3117, expressionRegistry_3118, bindingFunctions_3119, typeRegistry_3120, typeItems_3121) => {
const representations_3122 = solveFunctionInstance_2982__wm_d9(fn_3112, requestedParams_3113, requestedResult_3114, Map.empty(Map.numberCompare), functionRegistry_3117, expressionRegistry_3118, bindingFunctions_3119, typeRegistry_3120, typeItems_3121);
const paramRepresentations_3123 = functionParamRepresentations_2951__wm_d4(Js.Array.toList(fn_3112.params), typeRegistry_3120, representations_3122, __wm_basis_Nil);
const resultRepresentation_3124 = concreteRepresentation_2933__wm_d3(typeRegistry_3120, representations_3122, fn_3112.resultTypeId);
const existingEntries_3126 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const entries_3125 = __v.args[0];
return entries_3125;
} else if (__v === __wm_basis_None) {

return __wm_basis_Nil;
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([state_3116.registry, fn_3112.id]));
const __wm_return_value_67 = findSpecialization_3049__wm_d3(existingEntries_3126, paramRepresentations_3123, resultRepresentation_3124);
if (__wm_return_value_67?.ctor === -2 && __wm_return_value_67.args.length === 1) {
const specializationId_3127 = __wm_return_value_67.args[0];
return [state_3116, specializationId_3127];
} else if (__wm_return_value_67 === __wm_basis_None) {

const specializationId_3128 = state_3116.nextId;
const expressions_3129 = collectExpressionItems_2919__wm_d4(__wm_basis_Cons([fn_3112.bodyExprId, __wm_basis_Nil]), expressionRegistry_3118, Map.empty(Map.numberCompare), __wm_basis_Nil);
const specialization_3131 = { id: specializationId_3128, functionId: fn_3112.id, bindingId: fn_3112.bindingId, name: specializationName_3065__wm_d3(fn_3112, paramRepresentations_3123, resultRepresentation_3124), paramTypeIds: Js.Array.fromList(List.map([Js.Array.toList(fn_3112.params), (__arg) => {
if (true) {
const param_3130 = __arg;
return param_3130.typeId;
}
__wm_fail("Match", "pattern match failure in function");
}])), resultTypeId: fn_3112.resultTypeId, paramRepresentations: Js.Array.fromList(paramRepresentations_3123), resultRepresentation: resultRepresentation_3124, typeFacts: Js.Array.fromList(specializationTypeFacts_3099__wm_d4(fn_3112, expressions_3129, typeRegistry_3120, representations_3122)) };
const entry_3132 = { specializationId: specializationId_3128, paramRepresentations: Js.Array.fromList(paramRepresentations_3123), resultRepresentation: resultRepresentation_3124 };
const registered_3133 = { nextId: (specializationId_3128 + 1), registry: Map.set([state_3116.registry, fn_3112.id, __wm_basis_Cons([entry_3132, existingEntries_3126])]), specializations: __wm_basis_Cons([specialization_3131, state_3116.specializations]), rootSpecializations: state_3116.rootSpecializations, calls: state_3116.calls, diagnostics: state_3116.diagnostics };
return materializeSpecializedCalls_3111__wm_d11(expressions_3129, fn_3112, specializationId_3128, representations_3122, Map.set([active_3115, fn_3112.id, specializationId_3128]), registered_3133, functionRegistry_3117, expressionRegistry_3118, bindingFunctions_3119, typeRegistry_3120, typeItems_3121);
}
__wm_fail("Match", "non-exhaustive match");
};
const materializeSpecialization_3110 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return materializeSpecialization_3110__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
const materializeSpecializedCalls_3111__wm_d11 = (expressions_3134, fn_3135, callerSpecializationId_3136, representations_3137, active_3138, state_3139, functionRegistry_3140, expressionRegistry_3141, bindingFunctions_3142, typeRegistry_3143, typeItems_3144) => {
__wm_tail_183: while (true) {
{
const __wm_scalar_211_0 = expressions_3134;
const __wm_scalar_211_1 = fn_3135;
const __wm_scalar_211_2 = callerSpecializationId_3136;
const __wm_scalar_211_3 = representations_3137;
const __wm_scalar_211_4 = active_3138;
const __wm_scalar_211_5 = state_3139;
const __wm_scalar_211_6 = functionRegistry_3140;
const __wm_scalar_211_7 = expressionRegistry_3141;
const __wm_scalar_211_8 = bindingFunctions_3142;
const __wm_scalar_211_9 = typeRegistry_3143;
const __wm_scalar_211_10 = typeItems_3144;
if (__wm_scalar_211_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_211_1, fn_3135) && __wm_eq(__wm_scalar_211_2, callerSpecializationId_3136) && __wm_eq(__wm_scalar_211_3, representations_3137) && __wm_eq(__wm_scalar_211_4, active_3138) && __wm_eq(__wm_scalar_211_5, state_3139) && __wm_eq(__wm_scalar_211_6, functionRegistry_3140) && __wm_eq(__wm_scalar_211_7, expressionRegistry_3141) && __wm_eq(__wm_scalar_211_8, bindingFunctions_3142) && __wm_eq(__wm_scalar_211_9, typeRegistry_3143) && __wm_eq(__wm_scalar_211_10, typeItems_3144)) {

return [state_3139, callerSpecializationId_3136];
} else if (__wm_scalar_211_0?.ctor === -6 && __wm_scalar_211_0.args.length === 1 && __wm_is_tuple(__wm_scalar_211_0.args[0]) && __wm_scalar_211_0.args[0].length === 2 && __wm_eq(__wm_scalar_211_1, fn_3135) && __wm_eq(__wm_scalar_211_2, callerSpecializationId_3136) && __wm_eq(__wm_scalar_211_3, representations_3137) && __wm_eq(__wm_scalar_211_4, active_3138) && __wm_eq(__wm_scalar_211_5, state_3139) && __wm_eq(__wm_scalar_211_6, functionRegistry_3140) && __wm_eq(__wm_scalar_211_7, expressionRegistry_3141) && __wm_eq(__wm_scalar_211_8, bindingFunctions_3142) && __wm_eq(__wm_scalar_211_9, typeRegistry_3143) && __wm_eq(__wm_scalar_211_10, typeItems_3144)) {
const expression_3145 = __wm_scalar_211_0.args[0][0];
const rest_3146 = __wm_scalar_211_0.args[0][1];
if (__wm_eq(expression_3145.kind, "call")) {
{
const __wm_tail_value_245 = Js.Array.toList(expression_3145.children);
if (__wm_tail_value_245?.ctor === -6 && __wm_tail_value_245.args.length === 1 && __wm_is_tuple(__wm_tail_value_245.args[0]) && __wm_tail_value_245.args[0].length === 2) {
const calleeId_3147 = __wm_tail_value_245.args[0][0];
const argumentIds_3148 = __wm_tail_value_245.args[0][1];
{
const __wm_tail_value_246 = Map.get([expressionRegistry_3141, calleeId_3147]);
if (__wm_tail_value_246?.ctor === -2 && __wm_tail_value_246.args.length === 1) {
const callee_3149 = __wm_tail_value_246.args[0];
{
const __wm_tail_value_247 = Map.get([bindingFunctions_3142, callee_3149.bindingId]);
if (__wm_tail_value_247?.ctor === -2 && __wm_tail_value_247.args.length === 1) {
const functionId_3150 = __wm_tail_value_247.args[0];
{
const __wm_tail_value_248 = Map.get([functionRegistry_3140, functionId_3150]);
if (__wm_tail_value_248?.ctor === -2 && __wm_tail_value_248.args.length === 1) {
const rawCalleeFn_3151 = __wm_tail_value_248.args[0];
{
const calleeFn_3152 = rawCalleeFn_3151;
const activeTarget_3153 = Map.get([active_3138, calleeFn_3152.id]);
const argumentRepresentations_3154 = callArgumentRepresentations_2958__wm_d5(argumentIds_3148, expressionRegistry_3141, typeRegistry_3143, representations_3137, __wm_basis_Nil);
const callResultRepresentation_3155 = concreteRepresentation_2933__wm_d3(typeRegistry_3143, representations_3137, expression_3145.typeId);
const __wm_bind_107 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const targetId_3156 = __v.args[0];
const nextState_3157 = (__wm_eq(calleeFn_3152.id, fn_3135.id) ? state_3139 : withSpecializationDiagnostic_3106__wm_d2(state_3139, mutualRecursionDiagnostic_3109(expression_3145)));
return [nextState_3157, targetId_3156];
} else if (__v === __wm_basis_None) {

return materializeSpecialization_3110__wm_d10(calleeFn_3152, argumentRepresentations_3154, callResultRepresentation_3155, active_3138, state_3139, functionRegistry_3140, expressionRegistry_3141, bindingFunctions_3142, typeRegistry_3143, typeItems_3144);
}
__wm_fail("Match", "non-exhaustive match");
})(activeTarget_3153);
if (!(__wm_is_tuple(__wm_bind_107) && __wm_bind_107.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterTarget_3158 = __wm_bind_107[0];
const targetSpecializationId_3159 = __wm_bind_107[1];
const call_3160 = { callerSpecializationId: callerSpecializationId_3136, expressionId: expression_3145.id, targetSpecializationId: targetSpecializationId_3159 };
{
const __wm_tail_arg_249_0 = rest_3146;
const __wm_tail_arg_249_1 = fn_3135;
const __wm_tail_arg_249_2 = callerSpecializationId_3136;
const __wm_tail_arg_249_3 = representations_3137;
const __wm_tail_arg_249_4 = active_3138;
const __wm_tail_arg_249_5 = withSpecializedCall_3103__wm_d2(afterTarget_3158, call_3160);
const __wm_tail_arg_249_6 = functionRegistry_3140;
const __wm_tail_arg_249_7 = expressionRegistry_3141;
const __wm_tail_arg_249_8 = bindingFunctions_3142;
const __wm_tail_arg_249_9 = typeRegistry_3143;
const __wm_tail_arg_249_10 = typeItems_3144;
expressions_3134 = __wm_tail_arg_249_0;
fn_3135 = __wm_tail_arg_249_1;
callerSpecializationId_3136 = __wm_tail_arg_249_2;
representations_3137 = __wm_tail_arg_249_3;
active_3138 = __wm_tail_arg_249_4;
state_3139 = __wm_tail_arg_249_5;
functionRegistry_3140 = __wm_tail_arg_249_6;
expressionRegistry_3141 = __wm_tail_arg_249_7;
bindingFunctions_3142 = __wm_tail_arg_249_8;
typeRegistry_3143 = __wm_tail_arg_249_9;
typeItems_3144 = __wm_tail_arg_249_10;
continue __wm_tail_183;
}
}
} else if (__wm_tail_value_248 === __wm_basis_None) {

{
const __wm_tail_arg_250_0 = rest_3146;
const __wm_tail_arg_250_1 = fn_3135;
const __wm_tail_arg_250_2 = callerSpecializationId_3136;
const __wm_tail_arg_250_3 = representations_3137;
const __wm_tail_arg_250_4 = active_3138;
const __wm_tail_arg_250_5 = state_3139;
const __wm_tail_arg_250_6 = functionRegistry_3140;
const __wm_tail_arg_250_7 = expressionRegistry_3141;
const __wm_tail_arg_250_8 = bindingFunctions_3142;
const __wm_tail_arg_250_9 = typeRegistry_3143;
const __wm_tail_arg_250_10 = typeItems_3144;
expressions_3134 = __wm_tail_arg_250_0;
fn_3135 = __wm_tail_arg_250_1;
callerSpecializationId_3136 = __wm_tail_arg_250_2;
representations_3137 = __wm_tail_arg_250_3;
active_3138 = __wm_tail_arg_250_4;
state_3139 = __wm_tail_arg_250_5;
functionRegistry_3140 = __wm_tail_arg_250_6;
expressionRegistry_3141 = __wm_tail_arg_250_7;
bindingFunctions_3142 = __wm_tail_arg_250_8;
typeRegistry_3143 = __wm_tail_arg_250_9;
typeItems_3144 = __wm_tail_arg_250_10;
continue __wm_tail_183;
}
}
__wm_fail("Match", "non-exhaustive match");
}
} else if (__wm_tail_value_247 === __wm_basis_None) {

{
const __wm_tail_arg_251_0 = rest_3146;
const __wm_tail_arg_251_1 = fn_3135;
const __wm_tail_arg_251_2 = callerSpecializationId_3136;
const __wm_tail_arg_251_3 = representations_3137;
const __wm_tail_arg_251_4 = active_3138;
const __wm_tail_arg_251_5 = state_3139;
const __wm_tail_arg_251_6 = functionRegistry_3140;
const __wm_tail_arg_251_7 = expressionRegistry_3141;
const __wm_tail_arg_251_8 = bindingFunctions_3142;
const __wm_tail_arg_251_9 = typeRegistry_3143;
const __wm_tail_arg_251_10 = typeItems_3144;
expressions_3134 = __wm_tail_arg_251_0;
fn_3135 = __wm_tail_arg_251_1;
callerSpecializationId_3136 = __wm_tail_arg_251_2;
representations_3137 = __wm_tail_arg_251_3;
active_3138 = __wm_tail_arg_251_4;
state_3139 = __wm_tail_arg_251_5;
functionRegistry_3140 = __wm_tail_arg_251_6;
expressionRegistry_3141 = __wm_tail_arg_251_7;
bindingFunctions_3142 = __wm_tail_arg_251_8;
typeRegistry_3143 = __wm_tail_arg_251_9;
typeItems_3144 = __wm_tail_arg_251_10;
continue __wm_tail_183;
}
}
__wm_fail("Match", "non-exhaustive match");
}
} else if (__wm_tail_value_246 === __wm_basis_None) {

{
const __wm_tail_arg_252_0 = rest_3146;
const __wm_tail_arg_252_1 = fn_3135;
const __wm_tail_arg_252_2 = callerSpecializationId_3136;
const __wm_tail_arg_252_3 = representations_3137;
const __wm_tail_arg_252_4 = active_3138;
const __wm_tail_arg_252_5 = state_3139;
const __wm_tail_arg_252_6 = functionRegistry_3140;
const __wm_tail_arg_252_7 = expressionRegistry_3141;
const __wm_tail_arg_252_8 = bindingFunctions_3142;
const __wm_tail_arg_252_9 = typeRegistry_3143;
const __wm_tail_arg_252_10 = typeItems_3144;
expressions_3134 = __wm_tail_arg_252_0;
fn_3135 = __wm_tail_arg_252_1;
callerSpecializationId_3136 = __wm_tail_arg_252_2;
representations_3137 = __wm_tail_arg_252_3;
active_3138 = __wm_tail_arg_252_4;
state_3139 = __wm_tail_arg_252_5;
functionRegistry_3140 = __wm_tail_arg_252_6;
expressionRegistry_3141 = __wm_tail_arg_252_7;
bindingFunctions_3142 = __wm_tail_arg_252_8;
typeRegistry_3143 = __wm_tail_arg_252_9;
typeItems_3144 = __wm_tail_arg_252_10;
continue __wm_tail_183;
}
}
__wm_fail("Match", "non-exhaustive match");
}
} else if (__wm_tail_value_245 === __wm_basis_Nil) {

{
const __wm_tail_arg_253_0 = rest_3146;
const __wm_tail_arg_253_1 = fn_3135;
const __wm_tail_arg_253_2 = callerSpecializationId_3136;
const __wm_tail_arg_253_3 = representations_3137;
const __wm_tail_arg_253_4 = active_3138;
const __wm_tail_arg_253_5 = state_3139;
const __wm_tail_arg_253_6 = functionRegistry_3140;
const __wm_tail_arg_253_7 = expressionRegistry_3141;
const __wm_tail_arg_253_8 = bindingFunctions_3142;
const __wm_tail_arg_253_9 = typeRegistry_3143;
const __wm_tail_arg_253_10 = typeItems_3144;
expressions_3134 = __wm_tail_arg_253_0;
fn_3135 = __wm_tail_arg_253_1;
callerSpecializationId_3136 = __wm_tail_arg_253_2;
representations_3137 = __wm_tail_arg_253_3;
active_3138 = __wm_tail_arg_253_4;
state_3139 = __wm_tail_arg_253_5;
functionRegistry_3140 = __wm_tail_arg_253_6;
expressionRegistry_3141 = __wm_tail_arg_253_7;
bindingFunctions_3142 = __wm_tail_arg_253_8;
typeRegistry_3143 = __wm_tail_arg_253_9;
typeItems_3144 = __wm_tail_arg_253_10;
continue __wm_tail_183;
}
}
__wm_fail("Match", "non-exhaustive match");
}
} else {
{
const __wm_tail_arg_254_0 = rest_3146;
const __wm_tail_arg_254_1 = fn_3135;
const __wm_tail_arg_254_2 = callerSpecializationId_3136;
const __wm_tail_arg_254_3 = representations_3137;
const __wm_tail_arg_254_4 = active_3138;
const __wm_tail_arg_254_5 = state_3139;
const __wm_tail_arg_254_6 = functionRegistry_3140;
const __wm_tail_arg_254_7 = expressionRegistry_3141;
const __wm_tail_arg_254_8 = bindingFunctions_3142;
const __wm_tail_arg_254_9 = typeRegistry_3143;
const __wm_tail_arg_254_10 = typeItems_3144;
expressions_3134 = __wm_tail_arg_254_0;
fn_3135 = __wm_tail_arg_254_1;
callerSpecializationId_3136 = __wm_tail_arg_254_2;
representations_3137 = __wm_tail_arg_254_3;
active_3138 = __wm_tail_arg_254_4;
state_3139 = __wm_tail_arg_254_5;
functionRegistry_3140 = __wm_tail_arg_254_6;
expressionRegistry_3141 = __wm_tail_arg_254_7;
bindingFunctions_3142 = __wm_tail_arg_254_8;
typeRegistry_3143 = __wm_tail_arg_254_9;
typeItems_3144 = __wm_tail_arg_254_10;
continue __wm_tail_183;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const materializeSpecializedCalls_3111 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 11) return materializeSpecializedCalls_3111__wm_d11(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9], __arg[10]);
__wm_fail("Match", "pattern match failure in function");
};
const materializeRootSpecializations_3161__wm_d7 = (roots_3162, state_3163, functionRegistry_3164, expressionRegistry_3165, bindingFunctions_3166, typeRegistry_3167, typeItems_3168) => {
__wm_tail_184: while (true) {
{
const __wm_scalar_212_0 = roots_3162;
const __wm_scalar_212_1 = state_3163;
const __wm_scalar_212_2 = functionRegistry_3164;
const __wm_scalar_212_3 = expressionRegistry_3165;
const __wm_scalar_212_4 = bindingFunctions_3166;
const __wm_scalar_212_5 = typeRegistry_3167;
const __wm_scalar_212_6 = typeItems_3168;
if (__wm_scalar_212_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_212_1, state_3163) && __wm_eq(__wm_scalar_212_2, functionRegistry_3164) && __wm_eq(__wm_scalar_212_3, expressionRegistry_3165) && __wm_eq(__wm_scalar_212_4, bindingFunctions_3166) && __wm_eq(__wm_scalar_212_5, typeRegistry_3167) && __wm_eq(__wm_scalar_212_6, typeItems_3168)) {

return state_3163;
} else if (__wm_scalar_212_0?.ctor === -6 && __wm_scalar_212_0.args.length === 1 && __wm_is_tuple(__wm_scalar_212_0.args[0]) && __wm_scalar_212_0.args[0].length === 2 && __wm_eq(__wm_scalar_212_1, state_3163) && __wm_eq(__wm_scalar_212_2, functionRegistry_3164) && __wm_eq(__wm_scalar_212_3, expressionRegistry_3165) && __wm_eq(__wm_scalar_212_4, bindingFunctions_3166) && __wm_eq(__wm_scalar_212_5, typeRegistry_3167) && __wm_eq(__wm_scalar_212_6, typeItems_3168)) {
const root_3169 = __wm_scalar_212_0.args[0][0];
const rest_3170 = __wm_scalar_212_0.args[0][1];
{
const gpuRoot_3171 = root_3169;
{
const __wm_tail_value_255 = Map.get([functionRegistry_3164, gpuRoot_3171.functionId]);
if (__wm_tail_value_255?.ctor === -2 && __wm_tail_value_255.args.length === 1) {
const rawFn_3172 = __wm_tail_value_255.args[0];
{
const fn_3173 = rawFn_3172;
const __wm_bind_108 = materializeSpecialization_3110__wm_d10(fn_3173, __wm_basis_Nil, "", Map.empty(Map.numberCompare), state_3163, functionRegistry_3164, expressionRegistry_3165, bindingFunctions_3166, typeRegistry_3167, typeItems_3168);
if (!(__wm_is_tuple(__wm_bind_108) && __wm_bind_108.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterSpecialization_3174 = __wm_bind_108[0];
const specializationId_3175 = __wm_bind_108[1];
const rootSpecialization_3176 = { regionId: gpuRoot_3171.regionId, specializationId: specializationId_3175 };
const withRoot_3177 = { nextId: afterSpecialization_3174.nextId, registry: afterSpecialization_3174.registry, specializations: afterSpecialization_3174.specializations, rootSpecializations: __wm_basis_Cons([rootSpecialization_3176, afterSpecialization_3174.rootSpecializations]), calls: afterSpecialization_3174.calls, diagnostics: afterSpecialization_3174.diagnostics };
{
const __wm_tail_arg_256_0 = rest_3170;
const __wm_tail_arg_256_1 = withRoot_3177;
const __wm_tail_arg_256_2 = functionRegistry_3164;
const __wm_tail_arg_256_3 = expressionRegistry_3165;
const __wm_tail_arg_256_4 = bindingFunctions_3166;
const __wm_tail_arg_256_5 = typeRegistry_3167;
const __wm_tail_arg_256_6 = typeItems_3168;
roots_3162 = __wm_tail_arg_256_0;
state_3163 = __wm_tail_arg_256_1;
functionRegistry_3164 = __wm_tail_arg_256_2;
expressionRegistry_3165 = __wm_tail_arg_256_3;
bindingFunctions_3166 = __wm_tail_arg_256_4;
typeRegistry_3167 = __wm_tail_arg_256_5;
typeItems_3168 = __wm_tail_arg_256_6;
continue __wm_tail_184;
}
}
} else if (__wm_tail_value_255 === __wm_basis_None) {

{
const __wm_tail_arg_257_0 = rest_3170;
const __wm_tail_arg_257_1 = state_3163;
const __wm_tail_arg_257_2 = functionRegistry_3164;
const __wm_tail_arg_257_3 = expressionRegistry_3165;
const __wm_tail_arg_257_4 = bindingFunctions_3166;
const __wm_tail_arg_257_5 = typeRegistry_3167;
const __wm_tail_arg_257_6 = typeItems_3168;
roots_3162 = __wm_tail_arg_257_0;
state_3163 = __wm_tail_arg_257_1;
functionRegistry_3164 = __wm_tail_arg_257_2;
expressionRegistry_3165 = __wm_tail_arg_257_3;
bindingFunctions_3166 = __wm_tail_arg_257_4;
typeRegistry_3167 = __wm_tail_arg_257_5;
typeItems_3168 = __wm_tail_arg_257_6;
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
const materializeRootSpecializations_3161 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return materializeRootSpecializations_3161__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const initialIrBuildState_3178 = (__arg) => {
if (__arg === undefined) {

return { nextExpressionId: 0, functions: Map.empty(Map.numberCompare), expressions: Map.empty(Map.numberCompare) };
}
__wm_fail("Match", "pattern match failure in function");
};
const indexRepresentationFacts_3179__wm_d2 = (facts_3180, registry_3181) => {
__wm_tail_185: while (true) {
{
const __wm_scalar_213_0 = facts_3180;
const __wm_scalar_213_1 = registry_3181;
if (__wm_scalar_213_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_213_1, registry_3181)) {

return registry_3181;
} else if (__wm_scalar_213_0?.ctor === -6 && __wm_scalar_213_0.args.length === 1 && __wm_is_tuple(__wm_scalar_213_0.args[0]) && __wm_scalar_213_0.args[0].length === 2 && __wm_eq(__wm_scalar_213_1, registry_3181)) {
const fact_3182 = __wm_scalar_213_0.args[0][0];
const rest_3183 = __wm_scalar_213_0.args[0][1];
{
const __wm_tail_arg_258_0 = rest_3183;
const __wm_tail_arg_258_1 = Map.set([registry_3181, fact_3182.typeId, fact_3182.representation]);
facts_3180 = __wm_tail_arg_258_0;
registry_3181 = __wm_tail_arg_258_1;
continue __wm_tail_185;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexRepresentationFacts_3179 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexRepresentationFacts_3179__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const irRepresentation_3187__wm_d2 = (facts_3184, typeId_3185) => {
const __wm_return_value_68 = Map.get([facts_3184, typeId_3185]);
if (__wm_return_value_68?.ctor === -2 && __wm_return_value_68.args.length === 1) {
const representation_3186 = __wm_return_value_68.args[0];
return representation_3186;
} else if (__wm_return_value_68 === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const irRepresentation_3187 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return irRepresentation_3187__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const specializedCallTarget_3188__wm_d3 = (calls_3189, specializationId_3190, expressionId_3191) => {
__wm_tail_186: while (true) {
{
const __wm_scalar_214_0 = calls_3189;
const __wm_scalar_214_1 = specializationId_3190;
const __wm_scalar_214_2 = expressionId_3191;
if (__wm_scalar_214_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_214_1, specializationId_3190) && __wm_eq(__wm_scalar_214_2, expressionId_3191)) {

return __wm_op_sub(1);
} else if (__wm_scalar_214_0?.ctor === -6 && __wm_scalar_214_0.args.length === 1 && __wm_is_tuple(__wm_scalar_214_0.args[0]) && __wm_scalar_214_0.args[0].length === 2 && __wm_eq(__wm_scalar_214_1, specializationId_3190) && __wm_eq(__wm_scalar_214_2, expressionId_3191)) {
const rawCall_3192 = __wm_scalar_214_0.args[0][0];
const rest_3193 = __wm_scalar_214_0.args[0][1];
{
const call_3194 = rawCall_3192;
if (__wm_op_and_d2(__wm_eq(call_3194.callerSpecializationId, specializationId_3190), __wm_eq(call_3194.expressionId, expressionId_3191))) {
return call_3194.targetSpecializationId;
} else {
{
const __wm_tail_arg_259_0 = rest_3193;
const __wm_tail_arg_259_1 = specializationId_3190;
const __wm_tail_arg_259_2 = expressionId_3191;
calls_3189 = __wm_tail_arg_259_0;
specializationId_3190 = __wm_tail_arg_259_1;
expressionId_3191 = __wm_tail_arg_259_2;
continue __wm_tail_186;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const specializedCallTarget_3188 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return specializedCallTarget_3188__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const irValueKind_3198__wm_d3 = (expression_3195, bound_3196, bindingFunctions_3197) => {
if (__wm_op_or_d2(__wm_op_or_d2(__wm_op_or_d2(__wm_eq(expression_3195.kind, "number"), __wm_eq(expression_3195.kind, "bool")), __wm_eq(expression_3195.kind, "string")), __wm_eq(expression_3195.kind, "void"))) {
return "literal";
} else {
if (__wm_eq(expression_3195.kind, "var")) {
if ((expression_3195.bindingId < 0)) {
return "unresolved";
} else {
if (Map.has([bound_3196, expression_3195.bindingId])) {
return "local";
} else {
if (Map.has([bindingFunctions_3197, expression_3195.bindingId])) {
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
const irValueKind_3198 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return irValueKind_3198__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const reifyIrExpression_3199__wm_d8 = (sourceExpressionId_3201, specializationId_3202, facts_3203, bound_3204, calls_3205, expressionRegistry_3206, bindingFunctions_3207, state_3208) => {
const __wm_return_value_69 = Map.get([expressionRegistry_3206, sourceExpressionId_3201]);
if (__wm_return_value_69 === __wm_basis_None) {

return [state_3208, __wm_op_sub(1)];
} else if (__wm_return_value_69?.ctor === -2 && __wm_return_value_69.args.length === 1) {
const rawExpression_3209 = __wm_return_value_69.args[0];
const expression_3210 = rawExpression_3209;
const irExpressionId_3211 = state_3208.nextExpressionId;
const reserved_3212 = { nextExpressionId: (irExpressionId_3211 + 1), functions: state_3208.functions, expressions: state_3208.expressions };
const __wm_bind_109 = reifyIrChildren_3200__wm_d9(Js.Array.toList(expression_3210.children), specializationId_3202, facts_3203, bound_3204, calls_3205, expressionRegistry_3206, bindingFunctions_3207, reserved_3212, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_109) && __wm_bind_109.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withChildren_3213 = __wm_bind_109[0];
const childIds_3214 = __wm_bind_109[1];
const irExpression_3215 = { id: irExpressionId_3211, specializationId: specializationId_3202, sourceExprId: expression_3210.id, kind: expression_3210.kind, typeId: expression_3210.typeId, representation: irRepresentation_3187__wm_d2(facts_3203, expression_3210.typeId), spanId: expression_3210.spanId, bindingId: expression_3210.bindingId, name: expression_3210.name, operator: expression_3210.operator, numberValue: expression_3210.numberValue, boolValue: expression_3210.boolValue, children: Js.Array.fromList(childIds_3214), capability: expression_3210.capability, valueKind: irValueKind_3198__wm_d3(expression_3210, bound_3204, bindingFunctions_3207), callTargetSpecializationId: specializedCallTarget_3188__wm_d3(calls_3205, specializationId_3202, expression_3210.id) };
const completed_3216 = { nextExpressionId: withChildren_3213.nextExpressionId, functions: withChildren_3213.functions, expressions: Map.set([withChildren_3213.expressions, irExpressionId_3211, irExpression_3215]) };
return [completed_3216, irExpressionId_3211];
}
__wm_fail("Match", "non-exhaustive match");
};
const reifyIrExpression_3199 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 8) return reifyIrExpression_3199__wm_d8(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7]);
__wm_fail("Match", "pattern match failure in function");
};
const reifyIrChildren_3200__wm_d9 = (sourceChildIds_3217, specializationId_3218, facts_3219, bound_3220, calls_3221, expressionRegistry_3222, bindingFunctions_3223, state_3224, childIds_3225) => {
__wm_tail_187: while (true) {
{
const __wm_scalar_215_0 = sourceChildIds_3217;
const __wm_scalar_215_1 = specializationId_3218;
const __wm_scalar_215_2 = facts_3219;
const __wm_scalar_215_3 = bound_3220;
const __wm_scalar_215_4 = calls_3221;
const __wm_scalar_215_5 = expressionRegistry_3222;
const __wm_scalar_215_6 = bindingFunctions_3223;
const __wm_scalar_215_7 = state_3224;
const __wm_scalar_215_8 = childIds_3225;
if (__wm_scalar_215_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_215_1, specializationId_3218) && __wm_eq(__wm_scalar_215_2, facts_3219) && __wm_eq(__wm_scalar_215_3, bound_3220) && __wm_eq(__wm_scalar_215_4, calls_3221) && __wm_eq(__wm_scalar_215_5, expressionRegistry_3222) && __wm_eq(__wm_scalar_215_6, bindingFunctions_3223) && __wm_eq(__wm_scalar_215_7, state_3224) && __wm_eq(__wm_scalar_215_8, childIds_3225)) {

return [state_3224, reverseInto_2591__wm_d2(childIds_3225, __wm_basis_Nil)];
} else if (__wm_scalar_215_0?.ctor === -6 && __wm_scalar_215_0.args.length === 1 && __wm_is_tuple(__wm_scalar_215_0.args[0]) && __wm_scalar_215_0.args[0].length === 2 && __wm_eq(__wm_scalar_215_1, specializationId_3218) && __wm_eq(__wm_scalar_215_2, facts_3219) && __wm_eq(__wm_scalar_215_3, bound_3220) && __wm_eq(__wm_scalar_215_4, calls_3221) && __wm_eq(__wm_scalar_215_5, expressionRegistry_3222) && __wm_eq(__wm_scalar_215_6, bindingFunctions_3223) && __wm_eq(__wm_scalar_215_7, state_3224) && __wm_eq(__wm_scalar_215_8, childIds_3225)) {
const sourceChildId_3226 = __wm_scalar_215_0.args[0][0];
const rest_3227 = __wm_scalar_215_0.args[0][1];
{
const __wm_bind_110 = reifyIrExpression_3199__wm_d8(sourceChildId_3226, specializationId_3218, facts_3219, bound_3220, calls_3221, expressionRegistry_3222, bindingFunctions_3223, state_3224);
if (!(__wm_is_tuple(__wm_bind_110) && __wm_bind_110.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextState_3228 = __wm_bind_110[0];
const childId_3229 = __wm_bind_110[1];
{
const __wm_tail_arg_260_0 = rest_3227;
const __wm_tail_arg_260_1 = specializationId_3218;
const __wm_tail_arg_260_2 = facts_3219;
const __wm_tail_arg_260_3 = bound_3220;
const __wm_tail_arg_260_4 = calls_3221;
const __wm_tail_arg_260_5 = expressionRegistry_3222;
const __wm_tail_arg_260_6 = bindingFunctions_3223;
const __wm_tail_arg_260_7 = nextState_3228;
const __wm_tail_arg_260_8 = __wm_basis_Cons([childId_3229, childIds_3225]);
sourceChildIds_3217 = __wm_tail_arg_260_0;
specializationId_3218 = __wm_tail_arg_260_1;
facts_3219 = __wm_tail_arg_260_2;
bound_3220 = __wm_tail_arg_260_3;
calls_3221 = __wm_tail_arg_260_4;
expressionRegistry_3222 = __wm_tail_arg_260_5;
bindingFunctions_3223 = __wm_tail_arg_260_6;
state_3224 = __wm_tail_arg_260_7;
childIds_3225 = __wm_tail_arg_260_8;
continue __wm_tail_187;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reifyIrChildren_3200 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return reifyIrChildren_3200__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const reifyIrParams_3230__wm_d3 = (params_3231, facts_3232, output_3233) => {
__wm_tail_188: while (true) {
{
const __wm_scalar_216_0 = params_3231;
const __wm_scalar_216_1 = facts_3232;
const __wm_scalar_216_2 = output_3233;
if (__wm_scalar_216_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_216_1, facts_3232) && __wm_eq(__wm_scalar_216_2, output_3233)) {

return reverseInto_2591__wm_d2(output_3233, __wm_basis_Nil);
} else if (__wm_scalar_216_0?.ctor === -6 && __wm_scalar_216_0.args.length === 1 && __wm_is_tuple(__wm_scalar_216_0.args[0]) && __wm_scalar_216_0.args[0].length === 2 && __wm_eq(__wm_scalar_216_1, facts_3232) && __wm_eq(__wm_scalar_216_2, output_3233)) {
const rawParam_3234 = __wm_scalar_216_0.args[0][0];
const rest_3235 = __wm_scalar_216_0.args[0][1];
{
const param_3236 = rawParam_3234;
const irParam_3237 = { bindingId: param_3236.bindingId, name: param_3236.name, typeId: param_3236.typeId, representation: irRepresentation_3187__wm_d2(facts_3232, param_3236.typeId) };
{
const __wm_tail_arg_261_0 = rest_3235;
const __wm_tail_arg_261_1 = facts_3232;
const __wm_tail_arg_261_2 = __wm_basis_Cons([irParam_3237, output_3233]);
params_3231 = __wm_tail_arg_261_0;
facts_3232 = __wm_tail_arg_261_1;
output_3233 = __wm_tail_arg_261_2;
continue __wm_tail_188;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reifyIrParams_3230 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return reifyIrParams_3230__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const reifyIrSpecializations_3238__wm_d6 = (specializations_3239, calls_3240, functionRegistry_3241, expressionRegistry_3242, bindingFunctions_3243, state_3244) => {
__wm_tail_189: while (true) {
{
const __wm_scalar_217_0 = specializations_3239;
const __wm_scalar_217_1 = calls_3240;
const __wm_scalar_217_2 = functionRegistry_3241;
const __wm_scalar_217_3 = expressionRegistry_3242;
const __wm_scalar_217_4 = bindingFunctions_3243;
const __wm_scalar_217_5 = state_3244;
if (__wm_scalar_217_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_217_1, calls_3240) && __wm_eq(__wm_scalar_217_2, functionRegistry_3241) && __wm_eq(__wm_scalar_217_3, expressionRegistry_3242) && __wm_eq(__wm_scalar_217_4, bindingFunctions_3243) && __wm_eq(__wm_scalar_217_5, state_3244)) {

return state_3244;
} else if (__wm_scalar_217_0?.ctor === -6 && __wm_scalar_217_0.args.length === 1 && __wm_is_tuple(__wm_scalar_217_0.args[0]) && __wm_scalar_217_0.args[0].length === 2 && __wm_eq(__wm_scalar_217_1, calls_3240) && __wm_eq(__wm_scalar_217_2, functionRegistry_3241) && __wm_eq(__wm_scalar_217_3, expressionRegistry_3242) && __wm_eq(__wm_scalar_217_4, bindingFunctions_3243) && __wm_eq(__wm_scalar_217_5, state_3244)) {
const rawSpecialization_3245 = __wm_scalar_217_0.args[0][0];
const rest_3246 = __wm_scalar_217_0.args[0][1];
{
const specialization_3247 = rawSpecialization_3245;
{
const __wm_tail_value_262 = Map.get([functionRegistry_3241, specialization_3247.functionId]);
if (__wm_tail_value_262?.ctor === -2 && __wm_tail_value_262.args.length === 1) {
const rawFn_3248 = __wm_tail_value_262.args[0];
{
const fn_3249 = rawFn_3248;
const facts_3250 = indexRepresentationFacts_3179__wm_d2(Js.Array.toList(specialization_3247.typeFacts), Map.empty(Map.numberCompare));
const paramBound_3251 = bindParams_2677__wm_d2(Js.Array.toList(fn_3249.params), Map.empty(Map.numberCompare));
const bound_3252 = collectLocalBindings_2682__wm_d4(__wm_basis_Cons([fn_3249.bodyExprId, __wm_basis_Nil]), expressionRegistry_3242, Map.empty(Map.numberCompare), paramBound_3251);
const __wm_bind_111 = reifyIrExpression_3199__wm_d8(fn_3249.bodyExprId, specialization_3247.id, facts_3250, bound_3252, calls_3240, expressionRegistry_3242, bindingFunctions_3243, state_3244);
if (!(__wm_is_tuple(__wm_bind_111) && __wm_bind_111.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withBody_3253 = __wm_bind_111[0];
const bodyExprId_3254 = __wm_bind_111[1];
const irFunction_3255 = { specializationId: specialization_3247.id, functionId: fn_3249.id, bindingId: fn_3249.bindingId, name: specialization_3247.name, params: Js.Array.fromList(reifyIrParams_3230__wm_d3(Js.Array.toList(fn_3249.params), facts_3250, __wm_basis_Nil)), resultTypeId: fn_3249.resultTypeId, resultRepresentation: specialization_3247.resultRepresentation, bodyExprId: bodyExprId_3254, spanId: fn_3249.spanId };
const completed_3256 = { nextExpressionId: withBody_3253.nextExpressionId, functions: Map.set([withBody_3253.functions, specialization_3247.id, irFunction_3255]), expressions: withBody_3253.expressions };
{
const __wm_tail_arg_263_0 = rest_3246;
const __wm_tail_arg_263_1 = calls_3240;
const __wm_tail_arg_263_2 = functionRegistry_3241;
const __wm_tail_arg_263_3 = expressionRegistry_3242;
const __wm_tail_arg_263_4 = bindingFunctions_3243;
const __wm_tail_arg_263_5 = completed_3256;
specializations_3239 = __wm_tail_arg_263_0;
calls_3240 = __wm_tail_arg_263_1;
functionRegistry_3241 = __wm_tail_arg_263_2;
expressionRegistry_3242 = __wm_tail_arg_263_3;
bindingFunctions_3243 = __wm_tail_arg_263_4;
state_3244 = __wm_tail_arg_263_5;
continue __wm_tail_189;
}
}
} else if (__wm_tail_value_262 === __wm_basis_None) {

{
const __wm_tail_arg_264_0 = rest_3246;
const __wm_tail_arg_264_1 = calls_3240;
const __wm_tail_arg_264_2 = functionRegistry_3241;
const __wm_tail_arg_264_3 = expressionRegistry_3242;
const __wm_tail_arg_264_4 = bindingFunctions_3243;
const __wm_tail_arg_264_5 = state_3244;
specializations_3239 = __wm_tail_arg_264_0;
calls_3240 = __wm_tail_arg_264_1;
functionRegistry_3241 = __wm_tail_arg_264_2;
expressionRegistry_3242 = __wm_tail_arg_264_3;
bindingFunctions_3243 = __wm_tail_arg_264_4;
state_3244 = __wm_tail_arg_264_5;
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
const reifyIrSpecializations_3238 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return reifyIrSpecializations_3238__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const irFunctionValues_3257__wm_d2 = (entries_3258, values_3259) => {
__wm_tail_190: while (true) {
{
const __wm_scalar_218_0 = entries_3258;
const __wm_scalar_218_1 = values_3259;
if (__wm_scalar_218_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_218_1, values_3259)) {

return reverseInto_2591__wm_d2(values_3259, __wm_basis_Nil);
} else if (__wm_scalar_218_0?.ctor === -6 && __wm_scalar_218_0.args.length === 1 && __wm_is_tuple(__wm_scalar_218_0.args[0]) && __wm_scalar_218_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_218_0.args[0][0]) && __wm_scalar_218_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_218_1, values_3259)) {
const _id_3260 = __wm_scalar_218_0.args[0][0][0];
const fn_3261 = __wm_scalar_218_0.args[0][0][1];
const rest_3262 = __wm_scalar_218_0.args[0][1];
{
const __wm_tail_arg_265_0 = rest_3262;
const __wm_tail_arg_265_1 = __wm_basis_Cons([fn_3261, values_3259]);
entries_3258 = __wm_tail_arg_265_0;
values_3259 = __wm_tail_arg_265_1;
continue __wm_tail_190;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const irFunctionValues_3257 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return irFunctionValues_3257__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const irExpressionValues_3263__wm_d2 = (entries_3264, values_3265) => {
__wm_tail_191: while (true) {
{
const __wm_scalar_219_0 = entries_3264;
const __wm_scalar_219_1 = values_3265;
if (__wm_scalar_219_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_219_1, values_3265)) {

return reverseInto_2591__wm_d2(values_3265, __wm_basis_Nil);
} else if (__wm_scalar_219_0?.ctor === -6 && __wm_scalar_219_0.args.length === 1 && __wm_is_tuple(__wm_scalar_219_0.args[0]) && __wm_scalar_219_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_219_0.args[0][0]) && __wm_scalar_219_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_219_1, values_3265)) {
const _id_3266 = __wm_scalar_219_0.args[0][0][0];
const expression_3267 = __wm_scalar_219_0.args[0][0][1];
const rest_3268 = __wm_scalar_219_0.args[0][1];
{
const __wm_tail_arg_266_0 = rest_3268;
const __wm_tail_arg_266_1 = __wm_basis_Cons([expression_3267, values_3265]);
entries_3264 = __wm_tail_arg_266_0;
values_3265 = __wm_tail_arg_266_1;
continue __wm_tail_191;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const irExpressionValues_3263 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return irExpressionValues_3263__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeConsensusRepresentation_3271__wm_d2 = (previous_3269, next_3270) => {
if (__wm_eq(previous_3269, "")) {
return next_3270;
} else {
if (__wm_eq(previous_3269, next_3270)) {
return previous_3269;
} else {
return "conflict";
}
}
};
const mergeConsensusRepresentation_3271 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return mergeConsensusRepresentation_3271__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const addConsensusFacts_3272__wm_d2 = (facts_3273, consensus_3274) => {
__wm_tail_192: while (true) {
{
const __wm_scalar_220_0 = facts_3273;
const __wm_scalar_220_1 = consensus_3274;
if (__wm_scalar_220_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_220_1, consensus_3274)) {

return consensus_3274;
} else if (__wm_scalar_220_0?.ctor === -6 && __wm_scalar_220_0.args.length === 1 && __wm_is_tuple(__wm_scalar_220_0.args[0]) && __wm_scalar_220_0.args[0].length === 2 && __wm_eq(__wm_scalar_220_1, consensus_3274)) {
const fact_3275 = __wm_scalar_220_0.args[0][0];
const rest_3276 = __wm_scalar_220_0.args[0][1];
{
const previous_3277 = representationOf_2799__wm_d2(consensus_3274, fact_3275.typeId);
{
const __wm_tail_arg_267_0 = rest_3276;
const __wm_tail_arg_267_1 = Map.set([consensus_3274, fact_3275.typeId, mergeConsensusRepresentation_3271__wm_d2(previous_3277, fact_3275.representation)]);
facts_3273 = __wm_tail_arg_267_0;
consensus_3274 = __wm_tail_arg_267_1;
continue __wm_tail_192;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addConsensusFacts_3272 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addConsensusFacts_3272__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const specializationConsensus_3278__wm_d2 = (specializations_3279, consensus_3280) => {
__wm_tail_193: while (true) {
{
const __wm_scalar_221_0 = specializations_3279;
const __wm_scalar_221_1 = consensus_3280;
if (__wm_scalar_221_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_221_1, consensus_3280)) {

return consensus_3280;
} else if (__wm_scalar_221_0?.ctor === -6 && __wm_scalar_221_0.args.length === 1 && __wm_is_tuple(__wm_scalar_221_0.args[0]) && __wm_scalar_221_0.args[0].length === 2 && __wm_eq(__wm_scalar_221_1, consensus_3280)) {
const specialization_3281 = __wm_scalar_221_0.args[0][0];
const rest_3282 = __wm_scalar_221_0.args[0][1];
{
const __wm_tail_arg_268_0 = rest_3282;
const __wm_tail_arg_268_1 = addConsensusFacts_3272__wm_d2(Js.Array.toList(specialization_3281.typeFacts), consensus_3280);
specializations_3279 = __wm_tail_arg_268_0;
consensus_3280 = __wm_tail_arg_268_1;
continue __wm_tail_193;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const specializationConsensus_3278 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return specializationConsensus_3278__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const refinedType_3288__wm_d2 = (consensus_3283, gpuType_3284) => {
const inferred_3285 = representationOf_2799__wm_d2(consensus_3283, gpuType_3284.id);
const representation_3286 = (__wm_eq(gpuType_3284.representation, "abstract") ? (__wm_op_or_d2(__wm_eq(inferred_3285, "i32"), __wm_eq(inferred_3285, "f32")) ? inferred_3285 : "abstract") : gpuType_3284.representation);
const output_3287 = { id: gpuType_3284.id, kind: gpuType_3284.kind, name: gpuType_3284.name, representation: representation_3286, width: gpuType_3284.width, items: gpuType_3284.items, params: gpuType_3284.params, result: gpuType_3284.result };
return output_3287;
};
const refinedType_3288 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return refinedType_3288__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const compileGpu_3312 = (__arg) => {
if (true) {
const input_3289 = __arg;
if (!__wm_eq(input_3289.schemaVersion, 1)) {
return incompatibleSchema_2585(input_3289.schemaVersion);
} else {
const functionItems_3290 = Js.Array.toList(input_3289.functions);
const bindingItems_3291 = Js.Array.toList(input_3289.bindings);
const expressionItems_3292 = Js.Array.toList(input_3289.expressions);
const typeItems_3293 = Js.Array.toList(input_3289.types);
const __wm_bind_112 = registerFunctions_2620__wm_d3(functionItems_3290, Map.empty(Map.numberCompare), __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_112) && __wm_bind_112.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const functionRegistry_3294 = __wm_bind_112[0];
const duplicateDiagnostics_3295 = __wm_bind_112[1];
const expressionRegistry_3296 = indexExpressions_2786__wm_d2(expressionItems_3292, Map.empty(Map.numberCompare));
const bindingFunctions_3297 = indexFunctionBindings_2626__wm_d2(functionItems_3290, Map.empty(Map.numberCompare));
const bindingRegistry_3298 = indexBindings_2672__wm_d2(bindingItems_3291, Map.empty(Map.numberCompare));
const typeRegistry_3299 = indexTypes_2791__wm_d2(typeItems_3293, Map.empty(Map.numberCompare));
const reachable_3300 = solveReachableFunctions_2661__wm_d5(rootFunctionIds_2656__wm_d2(Js.Array.toList(input_3289.roots), __wm_basis_Nil), functionRegistry_3294, expressionRegistry_3296, bindingFunctions_3297, Map.empty(Map.numberCompare));
const captureItems_3301 = reverseInto_2591__wm_d2(rootCaptures_2765__wm_d7(Js.Array.toList(input_3289.roots), functionRegistry_3294, expressionRegistry_3296, bindingFunctions_3297, bindingRegistry_3298, typeRegistry_3299, __wm_basis_Nil), __wm_basis_Nil);
const specializationState_3302 = materializeRootSpecializations_3161__wm_d7(Js.Array.toList(input_3289.roots), initialSpecializationState_3100(undefined), functionRegistry_3294, expressionRegistry_3296, bindingFunctions_3297, typeRegistry_3299, typeItems_3293);
const irState_3303 = reifyIrSpecializations_3238__wm_d6(specializationState_3302.specializations, specializationState_3302.calls, functionRegistry_3294, expressionRegistry_3296, bindingFunctions_3297, initialIrBuildState_3178(undefined));
const diagnostics_3304 = prependAll_2586__wm_d2(reverseInto_2591__wm_d2(specializationState_3302.diagnostics, __wm_basis_Nil), prependAll_2586__wm_d2(captureDiagnostics_2781__wm_d2(captureItems_3301, __wm_basis_Nil), prependAll_2586__wm_d2(reachableCapabilityDiagnostics_2606__wm_d4(reachableBodyIds_2600__wm_d3(functionItems_3290, reachable_3300, __wm_basis_Nil), expressionRegistry_3296, Map.empty(Map.numberCompare), __wm_basis_Nil), duplicateDiagnostics_3295)));
const consensus_3305 = specializationConsensus_3278__wm_d2(specializationState_3302.specializations, Map.empty(Map.numberCompare));
const types_3307 = Js.Array.fromList(List.map([typeItems_3293, (__arg) => {
if (true) {
const gpuType_3306 = __arg;
return refinedType_3288__wm_d2(consensus_3305, gpuType_3306);
}
__wm_fail("Match", "pattern match failure in function");
}]));
const expressions_3308 = Js.Array.fromList(List.map([Js.Array.toList(input_3289.expressions), typedExpression_2574]));
const functions_3310 = Js.Array.fromList(List.map([Js.Array.toList(input_3289.functions), (__arg) => {
if (true) {
const fn_3309 = __arg;
return typedFunction_2579__wm_d2(reachable_3300, fn_3309);
}
__wm_fail("Match", "pattern match failure in function");
}]));
const output_3311 = { schemaVersion: 1, functions: functions_3310, captures: Js.Array.fromList(captureItems_3301), specializations: Js.Array.fromList(reverseInto_2591__wm_d2(specializationState_3302.specializations, __wm_basis_Nil)), rootSpecializations: Js.Array.fromList(reverseInto_2591__wm_d2(specializationState_3302.rootSpecializations, __wm_basis_Nil)), calls: Js.Array.fromList(reverseInto_2591__wm_d2(specializationState_3302.calls, __wm_basis_Nil)), irFunctions: Js.Array.fromList(irFunctionValues_3257__wm_d2(Map.toList(irState_3303.functions), __wm_basis_Nil)), irExpressions: Js.Array.fromList(irExpressionValues_3263__wm_d2(Map.toList(irState_3303.expressions), __wm_basis_Nil)), types: types_3307, expressions: expressions_3308, diagnostics: Js.Array.fromList(diagnostics_3304) };
return output_3311;
}
}
__wm_fail("Match", "pattern match failure in function");
};
const compileGpuSlice_3315 = (__arg) => {
if (true) {
const input_3313 = __arg;
const output_3314 = compileSliceProgram_2568(input_3313);
return output_3314;
}
__wm_fail("Match", "pattern match failure in function");
};
const elaborateGpuSliceTypes_3318 = (__arg) => {
if (true) {
const input_3316 = __arg;
const output_3317 = elaborateSliceProgramTypes_2232(input_3316);
return output_3317;
}
__wm_fail("Match", "pattern match failure in function");
};
return { "SpecializationRegistryEntry": SpecializationRegistryEntry_2569, "SpecializationBuildState": SpecializationBuildState_2570, "IrBuildState": IrBuildState_2571, "typedExpression": typedExpression_2574, "typedFunction": typedFunction_2579, "typedFunction__wm_d2": typedFunction_2579__wm_d2, "emptyOutput": emptyOutput_2581, "incompatibleSchema": incompatibleSchema_2585, "prependAll": prependAll_2586, "prependAll__wm_d2": prependAll_2586__wm_d2, "reverseInto": reverseInto_2591, "reverseInto__wm_d2": reverseInto_2591__wm_d2, "capabilityDiagnostic": capabilityDiagnostic_2599, "reachableBodyIds": reachableBodyIds_2600, "reachableBodyIds__wm_d3": reachableBodyIds_2600__wm_d3, "reachableCapabilityDiagnostics": reachableCapabilityDiagnostics_2606, "reachableCapabilityDiagnostics__wm_d4": reachableCapabilityDiagnostics_2606__wm_d4, "duplicateFunctionDiagnostic": duplicateFunctionDiagnostic_2619, "registerFunctions": registerFunctions_2620, "registerFunctions__wm_d3": registerFunctions_2620__wm_d3, "indexFunctionBindings": indexFunctionBindings_2626, "indexFunctionBindings__wm_d2": indexFunctionBindings_2626__wm_d2, "callDependency": callDependency_2637, "callDependency__wm_d3": callDependency_2637__wm_d3, "collectFunctionDependencies": collectFunctionDependencies_2638, "collectFunctionDependencies__wm_d5": collectFunctionDependencies_2638__wm_d5, "enqueueDependencies": enqueueDependencies_2650, "enqueueDependencies__wm_d2": enqueueDependencies_2650__wm_d2, "rootFunctionIds": rootFunctionIds_2656, "rootFunctionIds__wm_d2": rootFunctionIds_2656__wm_d2, "solveReachableFunctions": solveReachableFunctions_2661, "solveReachableFunctions__wm_d5": solveReachableFunctions_2661__wm_d5, "indexBindings": indexBindings_2672, "indexBindings__wm_d2": indexBindings_2672__wm_d2, "bindParams": bindParams_2677, "bindParams__wm_d2": bindParams_2677__wm_d2, "collectLocalBindings": collectLocalBindings_2682, "collectLocalBindings__wm_d4": collectLocalBindings_2682__wm_d4, "constantExpression": constantExpression_2692, "constantExpression__wm_d5": constantExpression_2692__wm_d5, "constantExpressions": constantExpressions_2693, "constantExpressions__wm_d5": constantExpressions_2693__wm_d5, "reifiableCaptureType": reifiableCaptureType_2712, "reifiableCaptureType__wm_d2": reifiableCaptureType_2712__wm_d2, "captureCategory": captureCategory_2722, "captureCategory__wm_d7": captureCategory_2722__wm_d7, "collectFunctionCaptures": collectFunctionCaptures_2723, "collectFunctionCaptures__wm_d10": collectFunctionCaptures_2723__wm_d10, "collectReachableCaptures": collectReachableCaptures_2742, "collectReachableCaptures__wm_d9": collectReachableCaptures_2742__wm_d9, "captureValues": captureValues_2759, "captureValues__wm_d2": captureValues_2759__wm_d2, "rootCaptures": rootCaptures_2765, "rootCaptures__wm_d7": rootCaptures_2765__wm_d7, "illegalCaptureDiagnostic": illegalCaptureDiagnostic_2780, "captureDiagnostics": captureDiagnostics_2781, "captureDiagnostics__wm_d2": captureDiagnostics_2781__wm_d2, "indexExpressions": indexExpressions_2786, "indexExpressions__wm_d2": indexExpressions_2786__wm_d2, "indexTypes": indexTypes_2791, "indexTypes__wm_d2": indexTypes_2791__wm_d2, "representationOf": representationOf_2799, "representationOf__wm_d2": representationOf_2799__wm_d2, "joinRepresentation": joinRepresentation_2802, "joinRepresentation__wm_d2": joinRepresentation_2802__wm_d2, "combinedRepresentation": combinedRepresentation_2803, "combinedRepresentation__wm_d3": combinedRepresentation_2803__wm_d3, "setRepresentation": setRepresentation_2814, "setRepresentation__wm_d3": setRepresentation_2814__wm_d3, "setRepresentations": setRepresentations_2815, "setRepresentations__wm_d4": setRepresentations_2815__wm_d4, "seedRepresentations": seedRepresentations_2824, "seedRepresentations__wm_d2": seedRepresentations_2824__wm_d2, "childTypeIds": childTypeIds_2829, "childTypeIds__wm_d3": childTypeIds_2829__wm_d3, "numericTypeIds": numericTypeIds_2836, "numericTypeIds__wm_d3": numericTypeIds_2836__wm_d3, "lastChildTypeId": lastChildTypeId_2843, "lastChildTypeId__wm_d3": lastChildTypeId_2843__wm_d3, "constraintTypeIds": constraintTypeIds_2855, "constraintTypeIds__wm_d3": constraintTypeIds_2855__wm_d3, "applyNumericGroup": applyNumericGroup_2859, "applyNumericGroup__wm_d2": applyNumericGroup_2859__wm_d2, "applyArgumentConstraints": applyArgumentConstraints_2860, "applyArgumentConstraints__wm_d6": applyArgumentConstraints_2860__wm_d6, "applyCallConstraint": applyCallConstraint_2889, "applyCallConstraint__wm_d6": applyCallConstraint_2889__wm_d6, "applyNumericConstraint": applyNumericConstraint_2897, "applyNumericConstraint__wm_d6": applyNumericConstraint_2897__wm_d6, "numericSweep": numericSweep_2898, "numericSweep__wm_d7": numericSweep_2898__wm_d7, "solveNumericRepresentations": solveNumericRepresentations_2910, "solveNumericRepresentations__wm_d6": solveNumericRepresentations_2910__wm_d6, "collectExpressionItems": collectExpressionItems_2919, "collectExpressionItems__wm_d4": collectExpressionItems_2919__wm_d4, "concreteRepresentation": concreteRepresentation_2933, "concreteRepresentation__wm_d3": concreteRepresentation_2933__wm_d3, "setTypeRepresentation": setTypeRepresentation_2939, "setTypeRepresentation__wm_d4": setTypeRepresentation_2939__wm_d4, "seedParamRepresentations": seedParamRepresentations_2940, "seedParamRepresentations__wm_d4": seedParamRepresentations_2940__wm_d4, "functionParamRepresentations": functionParamRepresentations_2951, "functionParamRepresentations__wm_d4": functionParamRepresentations_2951__wm_d4, "callArgumentRepresentations": callArgumentRepresentations_2958, "callArgumentRepresentations__wm_d5": callArgumentRepresentations_2958__wm_d5, "mergeArgumentRepresentations": mergeArgumentRepresentations_2968, "mergeArgumentRepresentations__wm_d6": mergeArgumentRepresentations_2968__wm_d6, "solveFunctionInstance": solveFunctionInstance_2982, "solveFunctionInstance__wm_d9": solveFunctionInstance_2982__wm_d9, "solveInstanceFixedPoint": solveInstanceFixedPoint_2983, "solveInstanceFixedPoint__wm_d9": solveInstanceFixedPoint_2983__wm_d9, "instanceSweep": instanceSweep_2984, "instanceSweep__wm_d10": instanceSweep_2984__wm_d10, "representationsEqual": representationsEqual_3041, "representationsEqual__wm_d2": representationsEqual_3041__wm_d2, "findSpecialization": findSpecialization_3049, "findSpecialization__wm_d3": findSpecialization_3049__wm_d3, "representationSuffix": representationSuffix_3056, "representationSuffix__wm_d2": representationSuffix_3056__wm_d2, "specializationName": specializationName_3065, "specializationName__wm_d3": specializationName_3065__wm_d3, "addTypeIds": addTypeIds_3066, "addTypeIds__wm_d2": addTypeIds_3066__wm_d2, "collectInstanceTypeIds": collectInstanceTypeIds_3071, "collectInstanceTypeIds__wm_d3": collectInstanceTypeIds_3071__wm_d3, "addParamTypeIds": addParamTypeIds_3077, "addParamTypeIds__wm_d3": addParamTypeIds_3077__wm_d3, "representationFacts": representationFacts_3083, "representationFacts__wm_d4": representationFacts_3083__wm_d4, "specializationTypeFacts": specializationTypeFacts_3099, "specializationTypeFacts__wm_d4": specializationTypeFacts_3099__wm_d4, "initialSpecializationState": initialSpecializationState_3100, "withSpecializedCall": withSpecializedCall_3103, "withSpecializedCall__wm_d2": withSpecializedCall_3103__wm_d2, "withSpecializationDiagnostic": withSpecializationDiagnostic_3106, "withSpecializationDiagnostic__wm_d2": withSpecializationDiagnostic_3106__wm_d2, "mutualRecursionDiagnostic": mutualRecursionDiagnostic_3109, "materializeSpecialization": materializeSpecialization_3110, "materializeSpecialization__wm_d10": materializeSpecialization_3110__wm_d10, "materializeSpecializedCalls": materializeSpecializedCalls_3111, "materializeSpecializedCalls__wm_d11": materializeSpecializedCalls_3111__wm_d11, "materializeRootSpecializations": materializeRootSpecializations_3161, "materializeRootSpecializations__wm_d7": materializeRootSpecializations_3161__wm_d7, "initialIrBuildState": initialIrBuildState_3178, "indexRepresentationFacts": indexRepresentationFacts_3179, "indexRepresentationFacts__wm_d2": indexRepresentationFacts_3179__wm_d2, "irRepresentation": irRepresentation_3187, "irRepresentation__wm_d2": irRepresentation_3187__wm_d2, "specializedCallTarget": specializedCallTarget_3188, "specializedCallTarget__wm_d3": specializedCallTarget_3188__wm_d3, "irValueKind": irValueKind_3198, "irValueKind__wm_d3": irValueKind_3198__wm_d3, "reifyIrExpression": reifyIrExpression_3199, "reifyIrExpression__wm_d8": reifyIrExpression_3199__wm_d8, "reifyIrChildren": reifyIrChildren_3200, "reifyIrChildren__wm_d9": reifyIrChildren_3200__wm_d9, "reifyIrParams": reifyIrParams_3230, "reifyIrParams__wm_d3": reifyIrParams_3230__wm_d3, "reifyIrSpecializations": reifyIrSpecializations_3238, "reifyIrSpecializations__wm_d6": reifyIrSpecializations_3238__wm_d6, "irFunctionValues": irFunctionValues_3257, "irFunctionValues__wm_d2": irFunctionValues_3257__wm_d2, "irExpressionValues": irExpressionValues_3263, "irExpressionValues__wm_d2": irExpressionValues_3263__wm_d2, "mergeConsensusRepresentation": mergeConsensusRepresentation_3271, "mergeConsensusRepresentation__wm_d2": mergeConsensusRepresentation_3271__wm_d2, "addConsensusFacts": addConsensusFacts_3272, "addConsensusFacts__wm_d2": addConsensusFacts_3272__wm_d2, "specializationConsensus": specializationConsensus_3278, "specializationConsensus__wm_d2": specializationConsensus_3278__wm_d2, "refinedType": refinedType_3288, "refinedType__wm_d2": refinedType_3288__wm_d2, "compileGpu": compileGpu_3312, "compileGpuSlice": compileGpuSlice_3315, "elaborateGpuSliceTypes": elaborateGpuSliceTypes_3318 };
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
const Task = { "fromResult": __wm_basis_Task["fromResult"], "succeed": __wm_basis_Task["succeed"], "fail": __wm_basis_Task["fail"], "map": __wm_basis_Task["map"], "map2": __wm_basis_Task["map2"], "race": __wm_basis_Task["race"], "andThen": __wm_basis_Task["andThen"], "mapErr": __wm_basis_Task["mapErr"], "recover": __wm_basis_Task["recover"], "orElse": __wm_basis_Task["orElse"], "all": __wm_basis_Task["all"], "fn": __wm_std_Task["fn"], "fnError": __wm_std_Task["fnError"], "carrier": __wm_std_Task["carrier"], "collectList": __wm_std_Task["collectList"], "traverse": __wm_std_Task["traverse"] };
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