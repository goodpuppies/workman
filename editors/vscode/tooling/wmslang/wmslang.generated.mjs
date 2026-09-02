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
const __wm_js_option_unwrap = (value) => value?.ctor === -1 ? undefined : value?.ctor === -2 ? value.args[0] : value;
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
const __wm_gpu_wgsl = (artifact) => artifact.wgsl;
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
  } else if (uniformBuffer !== undefined) {
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
const map_3045__wm_d2 = (items_3046, f_3047) => {
const __wm_scalar_0_0 = items_3046;
const __wm_scalar_0_1 = f_3047;
if (__wm_scalar_0_0 === __wm_basis_Nil) {

return __wm_basis_Nil;
} else if (__wm_scalar_0_0?.ctor === -6 && __wm_scalar_0_0.args.length === 1 && __wm_is_tuple(__wm_scalar_0_0.args[0]) && __wm_scalar_0_0.args[0].length === 2 && __wm_eq(__wm_scalar_0_1, f_3047)) {
const head_3048 = __wm_scalar_0_0.args[0][0];
const rest_3049 = __wm_scalar_0_0.args[0][1];
return __wm_basis_Cons([f_3047(head_3048), map_3045__wm_d2(rest_3049, f_3047)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const map_3045 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return map_3045__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const length_3056 = (__arg) => {
if (true) {
const items_3050 = __arg;
const loop_3051__wm_d2 = (remaining_3052, count_3053) => {
__wm_tail_0: while (true) {
{
const __wm_scalar_1_0 = remaining_3052;
const __wm_scalar_1_1 = count_3053;
if (__wm_scalar_1_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_1_1, count_3053)) {

return count_3053;
} else if (__wm_scalar_1_0?.ctor === -6 && __wm_scalar_1_0.args.length === 1 && __wm_is_tuple(__wm_scalar_1_0.args[0]) && __wm_scalar_1_0.args[0].length === 2 && __wm_eq(__wm_scalar_1_1, count_3053)) {
const __3054 = __wm_scalar_1_0.args[0][0];
const rest_3055 = __wm_scalar_1_0.args[0][1];
{
const __wm_tail_arg_0_0 = rest_3055;
const __wm_tail_arg_0_1 = (count_3053 + 1);
remaining_3052 = __wm_tail_arg_0_0;
count_3053 = __wm_tail_arg_0_1;
continue __wm_tail_0;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const loop_3051 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return loop_3051__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return loop_3051__wm_d2(items_3050, 0);
}
__wm_fail("Match", "pattern match failure in function");
};
const append_3057__wm_d2 = (left_3058, right_3059) => {
const __wm_scalar_2_0 = left_3058;
const __wm_scalar_2_1 = right_3059;
if (__wm_scalar_2_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_2_1, right_3059)) {

return right_3059;
} else if (__wm_scalar_2_0?.ctor === -6 && __wm_scalar_2_0.args.length === 1 && __wm_is_tuple(__wm_scalar_2_0.args[0]) && __wm_scalar_2_0.args[0].length === 2 && __wm_eq(__wm_scalar_2_1, right_3059)) {
const head_3060 = __wm_scalar_2_0.args[0][0];
const rest_3061 = __wm_scalar_2_0.args[0][1];
return __wm_basis_Cons([head_3060, append_3057__wm_d2(rest_3061, right_3059)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const append_3057 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return append_3057__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const filter_3062__wm_d2 = (items_3063, predicate_3064) => {
__wm_tail_1: while (true) {
{
const __wm_scalar_3_0 = items_3063;
const __wm_scalar_3_1 = predicate_3064;
if (__wm_scalar_3_0 === __wm_basis_Nil) {

return __wm_basis_Nil;
} else if (__wm_scalar_3_0?.ctor === -6 && __wm_scalar_3_0.args.length === 1 && __wm_is_tuple(__wm_scalar_3_0.args[0]) && __wm_scalar_3_0.args[0].length === 2 && __wm_eq(__wm_scalar_3_1, predicate_3064)) {
const head_3065 = __wm_scalar_3_0.args[0][0];
const rest_3066 = __wm_scalar_3_0.args[0][1];
if (predicate_3064(head_3065)) {
return __wm_basis_Cons([head_3065, filter_3062__wm_d2(rest_3066, predicate_3064)]);
} else {
{
const __wm_tail_arg_1_0 = rest_3066;
const __wm_tail_arg_1_1 = predicate_3064;
items_3063 = __wm_tail_arg_1_0;
predicate_3064 = __wm_tail_arg_1_1;
continue __wm_tail_1;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const filter_3062 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return filter_3062__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const take_3067__wm_d2 = (items_3068, count_3069) => {
const __wm_scalar_4_0 = items_3068;
const __wm_scalar_4_1 = count_3069;
if (__wm_scalar_4_0 === __wm_basis_Nil) {

return __wm_basis_Nil;
} else if (__wm_scalar_4_1 === 0) {

return __wm_basis_Nil;
} else if (__wm_scalar_4_0?.ctor === -6 && __wm_scalar_4_0.args.length === 1 && __wm_is_tuple(__wm_scalar_4_0.args[0]) && __wm_scalar_4_0.args[0].length === 2 && __wm_eq(__wm_scalar_4_1, count_3069)) {
const head_3070 = __wm_scalar_4_0.args[0][0];
const rest_3071 = __wm_scalar_4_0.args[0][1];
return __wm_basis_Cons([head_3070, take_3067__wm_d2(rest_3071, (count_3069 - 1))]);
}
__wm_fail("Match", "non-exhaustive match");
};
const take_3067 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return take_3067__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const drop_3072__wm_d2 = (items_3073, count_3074) => {
__wm_tail_2: while (true) {
{
const __wm_scalar_5_0 = items_3073;
const __wm_scalar_5_1 = count_3074;
if (__wm_eq(__wm_scalar_5_0, items_3073) && __wm_scalar_5_1 === 0) {

return items_3073;
} else if (__wm_scalar_5_0 === __wm_basis_Nil) {

return __wm_basis_Nil;
} else if (__wm_scalar_5_0?.ctor === -6 && __wm_scalar_5_0.args.length === 1 && __wm_is_tuple(__wm_scalar_5_0.args[0]) && __wm_scalar_5_0.args[0].length === 2 && __wm_eq(__wm_scalar_5_1, count_3074)) {
const __3075 = __wm_scalar_5_0.args[0][0];
const rest_3076 = __wm_scalar_5_0.args[0][1];
{
const __wm_tail_arg_2_0 = rest_3076;
const __wm_tail_arg_2_1 = (count_3074 - 1);
items_3073 = __wm_tail_arg_2_0;
count_3074 = __wm_tail_arg_2_1;
continue __wm_tail_2;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const drop_3072 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return drop_3072__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const at_3077__wm_d2 = (items_3078, index_3079) => {
__wm_tail_3: while (true) {
{
const __wm_scalar_6_0 = items_3078;
const __wm_scalar_6_1 = index_3079;
if (__wm_scalar_6_0 === __wm_basis_Nil) {

return __wm_basis_None;
} else if (__wm_scalar_6_0?.ctor === -6 && __wm_scalar_6_0.args.length === 1 && __wm_is_tuple(__wm_scalar_6_0.args[0]) && __wm_scalar_6_0.args[0].length === 2 && __wm_scalar_6_1 === 0) {
const head_3080 = __wm_scalar_6_0.args[0][0];
const __3081 = __wm_scalar_6_0.args[0][1];
return __wm_basis_Some(head_3080);
} else if (__wm_scalar_6_0?.ctor === -6 && __wm_scalar_6_0.args.length === 1 && __wm_is_tuple(__wm_scalar_6_0.args[0]) && __wm_scalar_6_0.args[0].length === 2 && __wm_eq(__wm_scalar_6_1, index_3079)) {
const __3082 = __wm_scalar_6_0.args[0][0];
const rest_3083 = __wm_scalar_6_0.args[0][1];
{
const __wm_tail_arg_3_0 = rest_3083;
const __wm_tail_arg_3_1 = (index_3079 - 1);
items_3078 = __wm_tail_arg_3_0;
index_3079 = __wm_tail_arg_3_1;
continue __wm_tail_3;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const at_3077 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return at_3077__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const foldLeft_3084__wm_d3 = (items_3085, initial_3086, f_3087) => {
__wm_tail_4: while (true) {
{
const __wm_scalar_7_0 = items_3085;
const __wm_scalar_7_1 = initial_3086;
const __wm_scalar_7_2 = f_3087;
if (__wm_scalar_7_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_7_1, initial_3086)) {

return initial_3086;
} else if (__wm_scalar_7_0?.ctor === -6 && __wm_scalar_7_0.args.length === 1 && __wm_is_tuple(__wm_scalar_7_0.args[0]) && __wm_scalar_7_0.args[0].length === 2 && __wm_eq(__wm_scalar_7_1, initial_3086) && __wm_eq(__wm_scalar_7_2, f_3087)) {
const head_3088 = __wm_scalar_7_0.args[0][0];
const rest_3089 = __wm_scalar_7_0.args[0][1];
{
const __wm_tail_arg_4_0 = rest_3089;
const __wm_tail_arg_4_1 = f_3087([initial_3086, head_3088]);
const __wm_tail_arg_4_2 = f_3087;
items_3085 = __wm_tail_arg_4_0;
initial_3086 = __wm_tail_arg_4_1;
f_3087 = __wm_tail_arg_4_2;
continue __wm_tail_4;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const foldLeft_3084 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldLeft_3084__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const foldRight_3090__wm_d3 = (items_3091, initial_3092, f_3093) => {
const __wm_scalar_8_0 = items_3091;
const __wm_scalar_8_1 = initial_3092;
const __wm_scalar_8_2 = f_3093;
if (__wm_scalar_8_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_8_1, initial_3092)) {

return initial_3092;
} else if (__wm_scalar_8_0?.ctor === -6 && __wm_scalar_8_0.args.length === 1 && __wm_is_tuple(__wm_scalar_8_0.args[0]) && __wm_scalar_8_0.args[0].length === 2 && __wm_eq(__wm_scalar_8_1, initial_3092) && __wm_eq(__wm_scalar_8_2, f_3093)) {
const head_3094 = __wm_scalar_8_0.args[0][0];
const rest_3095 = __wm_scalar_8_0.args[0][1];
return f_3093([head_3094, foldRight_3090__wm_d3(rest_3095, initial_3092, f_3093)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const foldRight_3090 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldRight_3090__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const reverse_3099 = (__arg) => {
if (true) {
const items_3096 = __arg;
return foldLeft_3084__wm_d3(items_3096, __wm_basis_Nil, (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) {
const reversed_3097 = __arg[0];
const item_3098 = __arg[1];
return __wm_basis_Cons([item_3098, reversed_3097]);
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
const any_3100__wm_d2 = (items_3101, predicate_3102) => {
__wm_tail_5: while (true) {
{
const __wm_scalar_9_0 = items_3101;
const __wm_scalar_9_1 = predicate_3102;
if (__wm_scalar_9_0 === __wm_basis_Nil) {

return false;
} else if (__wm_scalar_9_0?.ctor === -6 && __wm_scalar_9_0.args.length === 1 && __wm_is_tuple(__wm_scalar_9_0.args[0]) && __wm_scalar_9_0.args[0].length === 2 && __wm_eq(__wm_scalar_9_1, predicate_3102)) {
const head_3103 = __wm_scalar_9_0.args[0][0];
const rest_3104 = __wm_scalar_9_0.args[0][1];
if (predicate_3102(head_3103)) {
return true;
} else {
{
const __wm_tail_arg_5_0 = rest_3104;
const __wm_tail_arg_5_1 = predicate_3102;
items_3101 = __wm_tail_arg_5_0;
predicate_3102 = __wm_tail_arg_5_1;
continue __wm_tail_5;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const any_3100 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return any_3100__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const all_3105__wm_d2 = (items_3106, predicate_3107) => {
__wm_tail_6: while (true) {
{
const __wm_scalar_10_0 = items_3106;
const __wm_scalar_10_1 = predicate_3107;
if (__wm_scalar_10_0 === __wm_basis_Nil) {

return true;
} else if (__wm_scalar_10_0?.ctor === -6 && __wm_scalar_10_0.args.length === 1 && __wm_is_tuple(__wm_scalar_10_0.args[0]) && __wm_scalar_10_0.args[0].length === 2 && __wm_eq(__wm_scalar_10_1, predicate_3107)) {
const head_3108 = __wm_scalar_10_0.args[0][0];
const rest_3109 = __wm_scalar_10_0.args[0][1];
if (predicate_3107(head_3108)) {
{
const __wm_tail_arg_6_0 = rest_3109;
const __wm_tail_arg_6_1 = predicate_3107;
items_3106 = __wm_tail_arg_6_0;
predicate_3107 = __wm_tail_arg_6_1;
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
const all_3105 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return all_3105__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collectWith_3113__wm_d3 = (empty_3110, combine_3111, items_3112) => {
return foldRight_3090__wm_d3(items_3112, empty_3110, combine_3111);
};
const collectWith_3113 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return collectWith_3113__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
let joinRaw_3114 = (__arg) => {
if (true) {
const items_3115 = __arg;
const __wm_return_value_0 = items_3115;
if (__wm_return_value_0 === __wm_basis_Nil) {

return "";
} else if (__wm_return_value_0?.ctor === -6 && __wm_return_value_0.args.length === 1 && __wm_is_tuple(__wm_return_value_0.args[0]) && __wm_return_value_0.args[0].length === 2 && __wm_return_value_0.args[0][1] === __wm_basis_Nil) {
const head_3116 = __wm_return_value_0.args[0][0];
return (("" + Text.of(head_3116)) + "");
} else if (__wm_return_value_0?.ctor === -6 && __wm_return_value_0.args.length === 1 && __wm_is_tuple(__wm_return_value_0.args[0]) && __wm_return_value_0.args[0].length === 2) {
const head_3117 = __wm_return_value_0.args[0][0];
const rest_3118 = __wm_return_value_0.args[0][1];
return (((("" + Text.of(head_3117)) + "") + ", ") + joinRaw_3114(rest_3118));
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const toString_3120 = (__arg) => {
if (true) {
const items_3119 = __arg;
return (("[" + joinRaw_3114(items_3119)) + "]");
}
__wm_fail("Match", "pattern match failure in function");
};
const toStringRender_3123__wm_d2 = (items_3121, render_3122) => {
return toString_3120(map_3045__wm_d2(items_3121, render_3122));
};
const toStringRender_3123 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return toStringRender_3123__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return { "map": map_3045, "map__wm_d2": map_3045__wm_d2, "length": length_3056, "append": append_3057, "append__wm_d2": append_3057__wm_d2, "filter": filter_3062, "filter__wm_d2": filter_3062__wm_d2, "take": take_3067, "take__wm_d2": take_3067__wm_d2, "drop": drop_3072, "drop__wm_d2": drop_3072__wm_d2, "at": at_3077, "at__wm_d2": at_3077__wm_d2, "foldLeft": foldLeft_3084, "foldLeft__wm_d3": foldLeft_3084__wm_d3, "foldRight": foldRight_3090, "foldRight__wm_d3": foldRight_3090__wm_d3, "reverse": reverse_3099, "any": any_3100, "any__wm_d2": any_3100__wm_d2, "all": all_3105, "all__wm_d2": all_3105__wm_d2, "collectWith": collectWith_3113, "collectWith__wm_d3": collectWith_3113__wm_d3, "joinRaw": joinRaw_3114, "toString": toString_3120, "toStringRender": toStringRender_3123, "toStringRender__wm_d2": toStringRender_3123__wm_d2 };
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
const numberCompare_3126__wm_d2 = (left_3124, right_3125) => {
if ((left_3124 < right_3125)) {
return Less_ctor_0;
} else {
if ((left_3124 > right_3125)) {
return Greater_ctor_2;
} else {
return Equal_ctor_1;
}
}
};
const numberCompare_3126 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numberCompare_3126__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const height_3133 = (__arg) => {
if (true) {
const tree_3127 = __arg;
const __wm_return_value_1 = tree_3127;
if (__wm_return_value_1 === MapEmpty_ctor_3) {

return 0;
} else if (__wm_return_value_1?.ctor === 4 && __wm_return_value_1.args.length === 1 && __wm_is_tuple(__wm_return_value_1.args[0]) && __wm_return_value_1.args[0].length === 5) {
const nodeHeight_3128 = __wm_return_value_1.args[0][0];
const _key_3129 = __wm_return_value_1.args[0][1];
const _value_3130 = __wm_return_value_1.args[0][2];
const _left_3131 = __wm_return_value_1.args[0][3];
const _right_3132 = __wm_return_value_1.args[0][4];
return nodeHeight_3128;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const max_3136__wm_d2 = (left_3134, right_3135) => {
if ((left_3134 > right_3135)) {
return left_3134;
} else {
return right_3135;
}
};
const max_3136 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return max_3136__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const node_3141__wm_d4 = (key_3137, value_3138, left_3139, right_3140) => {
return MapNode_ctor_4([(1 + max_3136__wm_d2(height_3133(left_3139), height_3133(right_3140))), key_3137, value_3138, left_3139, right_3140]);
};
const node_3141 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return node_3141__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const rotateLeft_3152 = (__arg) => {
if (true) {
const tree_3142 = __arg;
const __wm_return_value_2 = tree_3142;
if (__wm_return_value_2?.ctor === 4 && __wm_return_value_2.args.length === 1 && __wm_is_tuple(__wm_return_value_2.args[0]) && __wm_return_value_2.args[0].length === 5 && __wm_return_value_2.args[0][4]?.ctor === 4 && __wm_return_value_2.args[0][4].args.length === 1 && __wm_is_tuple(__wm_return_value_2.args[0][4].args[0]) && __wm_return_value_2.args[0][4].args[0].length === 5) {
const _height_3143 = __wm_return_value_2.args[0][0];
const key_3144 = __wm_return_value_2.args[0][1];
const value_3145 = __wm_return_value_2.args[0][2];
const left_3146 = __wm_return_value_2.args[0][3];
const _rightHeight_3147 = __wm_return_value_2.args[0][4].args[0][0];
const rightKey_3148 = __wm_return_value_2.args[0][4].args[0][1];
const rightValue_3149 = __wm_return_value_2.args[0][4].args[0][2];
const rightLeft_3150 = __wm_return_value_2.args[0][4].args[0][3];
const rightRight_3151 = __wm_return_value_2.args[0][4].args[0][4];
return node_3141__wm_d4(rightKey_3148, rightValue_3149, node_3141__wm_d4(key_3144, value_3145, left_3146, rightLeft_3150), rightRight_3151);
} else if (true) {

return tree_3142;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const rotateRight_3163 = (__arg) => {
if (true) {
const tree_3153 = __arg;
const __wm_return_value_3 = tree_3153;
if (__wm_return_value_3?.ctor === 4 && __wm_return_value_3.args.length === 1 && __wm_is_tuple(__wm_return_value_3.args[0]) && __wm_return_value_3.args[0].length === 5 && __wm_return_value_3.args[0][3]?.ctor === 4 && __wm_return_value_3.args[0][3].args.length === 1 && __wm_is_tuple(__wm_return_value_3.args[0][3].args[0]) && __wm_return_value_3.args[0][3].args[0].length === 5) {
const _height_3154 = __wm_return_value_3.args[0][0];
const key_3155 = __wm_return_value_3.args[0][1];
const value_3156 = __wm_return_value_3.args[0][2];
const _leftHeight_3157 = __wm_return_value_3.args[0][3].args[0][0];
const leftKey_3158 = __wm_return_value_3.args[0][3].args[0][1];
const leftValue_3159 = __wm_return_value_3.args[0][3].args[0][2];
const leftLeft_3160 = __wm_return_value_3.args[0][3].args[0][3];
const leftRight_3161 = __wm_return_value_3.args[0][3].args[0][4];
const right_3162 = __wm_return_value_3.args[0][4];
return node_3141__wm_d4(leftKey_3158, leftValue_3159, leftLeft_3160, node_3141__wm_d4(key_3155, value_3156, leftRight_3161, right_3162));
} else if (true) {

return tree_3153;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const balance_3181 = (__arg) => {
if (true) {
const tree_3164 = __arg;
const __wm_return_value_4 = tree_3164;
if (__wm_return_value_4 === MapEmpty_ctor_3) {

return MapEmpty_ctor_3;
} else if (__wm_return_value_4?.ctor === 4 && __wm_return_value_4.args.length === 1 && __wm_is_tuple(__wm_return_value_4.args[0]) && __wm_return_value_4.args[0].length === 5) {
const _height_3165 = __wm_return_value_4.args[0][0];
const key_3166 = __wm_return_value_4.args[0][1];
const value_3167 = __wm_return_value_4.args[0][2];
const left_3168 = __wm_return_value_4.args[0][3];
const right_3169 = __wm_return_value_4.args[0][4];
const difference_3170 = (height_3133(left_3168) - height_3133(right_3169));
if ((difference_3170 > 1)) {
const __wm_return_value_5 = left_3168;
if (__wm_return_value_5?.ctor === 4 && __wm_return_value_5.args.length === 1 && __wm_is_tuple(__wm_return_value_5.args[0]) && __wm_return_value_5.args[0].length === 5) {
const _leftHeight_3171 = __wm_return_value_5.args[0][0];
const _leftKey_3172 = __wm_return_value_5.args[0][1];
const _leftValue_3173 = __wm_return_value_5.args[0][2];
const leftLeft_3174 = __wm_return_value_5.args[0][3];
const leftRight_3175 = __wm_return_value_5.args[0][4];
if ((height_3133(leftLeft_3174) < height_3133(leftRight_3175))) {
return rotateRight_3163(node_3141__wm_d4(key_3166, value_3167, rotateLeft_3152(left_3168), right_3169));
} else {
return rotateRight_3163(node_3141__wm_d4(key_3166, value_3167, left_3168, right_3169));
}
} else if (__wm_return_value_5 === MapEmpty_ctor_3) {

return node_3141__wm_d4(key_3166, value_3167, left_3168, right_3169);
}
__wm_fail("Match", "non-exhaustive match");
} else {
if ((difference_3170 < __wm_op_sub(1))) {
const __wm_return_value_6 = right_3169;
if (__wm_return_value_6?.ctor === 4 && __wm_return_value_6.args.length === 1 && __wm_is_tuple(__wm_return_value_6.args[0]) && __wm_return_value_6.args[0].length === 5) {
const _rightHeight_3176 = __wm_return_value_6.args[0][0];
const _rightKey_3177 = __wm_return_value_6.args[0][1];
const _rightValue_3178 = __wm_return_value_6.args[0][2];
const rightLeft_3179 = __wm_return_value_6.args[0][3];
const rightRight_3180 = __wm_return_value_6.args[0][4];
if ((height_3133(rightRight_3180) < height_3133(rightLeft_3179))) {
return rotateLeft_3152(node_3141__wm_d4(key_3166, value_3167, left_3168, rotateRight_3163(right_3169)));
} else {
return rotateLeft_3152(node_3141__wm_d4(key_3166, value_3167, left_3168, right_3169));
}
} else if (__wm_return_value_6 === MapEmpty_ctor_3) {

return node_3141__wm_d4(key_3166, value_3167, left_3168, right_3169);
}
__wm_fail("Match", "non-exhaustive match");
} else {
return node_3141__wm_d4(key_3166, value_3167, left_3168, right_3169);
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const empty_3183 = (__arg) => {
if (true) {
const compare_3182 = __arg;
return MapValue_ctor_5([compare_3182, MapEmpty_ctor_3]);
}
__wm_fail("Match", "pattern match failure in function");
};
const getTree_3184__wm_d3 = (tree_3185, key_3186, compare_3187) => {
__wm_tail_7: while (true) {
{
const __wm_scalar_11_0 = tree_3185;
const __wm_scalar_11_1 = key_3186;
const __wm_scalar_11_2 = compare_3187;
if (__wm_scalar_11_0 === MapEmpty_ctor_3) {

return __wm_basis_None;
} else if (__wm_scalar_11_0?.ctor === 4 && __wm_scalar_11_0.args.length === 1 && __wm_is_tuple(__wm_scalar_11_0.args[0]) && __wm_scalar_11_0.args[0].length === 5 && __wm_eq(__wm_scalar_11_1, key_3186) && __wm_eq(__wm_scalar_11_2, compare_3187)) {
const _height_3188 = __wm_scalar_11_0.args[0][0];
const nodeKey_3189 = __wm_scalar_11_0.args[0][1];
const value_3190 = __wm_scalar_11_0.args[0][2];
const left_3191 = __wm_scalar_11_0.args[0][3];
const right_3192 = __wm_scalar_11_0.args[0][4];
{
const __wm_tail_value_7 = compare_3187([key_3186, nodeKey_3189]);
if (__wm_tail_value_7 === Less_ctor_0) {

{
const __wm_tail_arg_8_0 = left_3191;
const __wm_tail_arg_8_1 = key_3186;
const __wm_tail_arg_8_2 = compare_3187;
tree_3185 = __wm_tail_arg_8_0;
key_3186 = __wm_tail_arg_8_1;
compare_3187 = __wm_tail_arg_8_2;
continue __wm_tail_7;
}
} else if (__wm_tail_value_7 === Equal_ctor_1) {

return __wm_basis_Some(value_3190);
} else if (__wm_tail_value_7 === Greater_ctor_2) {

{
const __wm_tail_arg_9_0 = right_3192;
const __wm_tail_arg_9_1 = key_3186;
const __wm_tail_arg_9_2 = compare_3187;
tree_3185 = __wm_tail_arg_9_0;
key_3186 = __wm_tail_arg_9_1;
compare_3187 = __wm_tail_arg_9_2;
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
const getTree_3184 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return getTree_3184__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const get_3197__wm_d2 = (map_3193, key_3194) => {
const __wm_scalar_12_0 = map_3193;
const __wm_scalar_12_1 = key_3194;
if (__wm_scalar_12_0?.ctor === 5 && __wm_scalar_12_0.args.length === 1 && __wm_is_tuple(__wm_scalar_12_0.args[0]) && __wm_scalar_12_0.args[0].length === 2 && __wm_eq(__wm_scalar_12_1, key_3194)) {
const compare_3195 = __wm_scalar_12_0.args[0][0];
const tree_3196 = __wm_scalar_12_0.args[0][1];
return getTree_3184__wm_d3(tree_3196, key_3194, compare_3195);
}
__wm_fail("Match", "non-exhaustive match");
};
const get_3197 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return get_3197__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const has_3201__wm_d2 = (map_3198, key_3199) => {
const __wm_return_value_7 = get_3197__wm_d2(map_3198, key_3199);
if (__wm_return_value_7?.ctor === -2 && __wm_return_value_7.args.length === 1) {
const __3200 = __wm_return_value_7.args[0];
return true;
} else if (__wm_return_value_7 === __wm_basis_None) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
};
const has_3201 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return has_3201__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const setTree_3202__wm_d4 = (tree_3203, key_3204, value_3205, compare_3206) => {
const __wm_scalar_13_0 = tree_3203;
const __wm_scalar_13_1 = key_3204;
const __wm_scalar_13_2 = value_3205;
const __wm_scalar_13_3 = compare_3206;
if (__wm_scalar_13_0 === MapEmpty_ctor_3 && __wm_eq(__wm_scalar_13_1, key_3204) && __wm_eq(__wm_scalar_13_2, value_3205)) {

return node_3141__wm_d4(key_3204, value_3205, MapEmpty_ctor_3, MapEmpty_ctor_3);
} else if (__wm_scalar_13_0?.ctor === 4 && __wm_scalar_13_0.args.length === 1 && __wm_is_tuple(__wm_scalar_13_0.args[0]) && __wm_scalar_13_0.args[0].length === 5 && __wm_eq(__wm_scalar_13_1, key_3204) && __wm_eq(__wm_scalar_13_2, value_3205) && __wm_eq(__wm_scalar_13_3, compare_3206)) {
const _height_3207 = __wm_scalar_13_0.args[0][0];
const nodeKey_3208 = __wm_scalar_13_0.args[0][1];
const nodeValue_3209 = __wm_scalar_13_0.args[0][2];
const left_3210 = __wm_scalar_13_0.args[0][3];
const right_3211 = __wm_scalar_13_0.args[0][4];
const __wm_return_value_8 = compare_3206([key_3204, nodeKey_3208]);
if (__wm_return_value_8 === Less_ctor_0) {

return balance_3181(node_3141__wm_d4(nodeKey_3208, nodeValue_3209, setTree_3202__wm_d4(left_3210, key_3204, value_3205, compare_3206), right_3211));
} else if (__wm_return_value_8 === Equal_ctor_1) {

return node_3141__wm_d4(nodeKey_3208, value_3205, left_3210, right_3211);
} else if (__wm_return_value_8 === Greater_ctor_2) {

return balance_3181(node_3141__wm_d4(nodeKey_3208, nodeValue_3209, left_3210, setTree_3202__wm_d4(right_3211, key_3204, value_3205, compare_3206)));
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
};
const setTree_3202 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setTree_3202__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const set_3217__wm_d3 = (map_3212, key_3213, value_3214) => {
const __wm_scalar_14_0 = map_3212;
const __wm_scalar_14_1 = key_3213;
const __wm_scalar_14_2 = value_3214;
if (__wm_scalar_14_0?.ctor === 5 && __wm_scalar_14_0.args.length === 1 && __wm_is_tuple(__wm_scalar_14_0.args[0]) && __wm_scalar_14_0.args[0].length === 2 && __wm_eq(__wm_scalar_14_1, key_3213) && __wm_eq(__wm_scalar_14_2, value_3214)) {
const compare_3215 = __wm_scalar_14_0.args[0][0];
const tree_3216 = __wm_scalar_14_0.args[0][1];
return MapValue_ctor_5([compare_3215, setTree_3202__wm_d4(tree_3216, key_3213, value_3214, compare_3215)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const set_3217 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return set_3217__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const singleton_3221__wm_d3 = (compare_3218, key_3219, value_3220) => {
return set_3217__wm_d3(empty_3183(compare_3218), key_3219, value_3220);
};
const singleton_3221 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return singleton_3221__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
let removeSmallest_3222 = (__arg) => {
if (true) {
const tree_3223 = __arg;
const __wm_return_value_9 = tree_3223;
if (__wm_return_value_9?.ctor === 4 && __wm_return_value_9.args.length === 1 && __wm_is_tuple(__wm_return_value_9.args[0]) && __wm_return_value_9.args[0].length === 5 && __wm_return_value_9.args[0][3] === MapEmpty_ctor_3) {
const _height_3224 = __wm_return_value_9.args[0][0];
const key_3225 = __wm_return_value_9.args[0][1];
const value_3226 = __wm_return_value_9.args[0][2];
const right_3227 = __wm_return_value_9.args[0][4];
return [key_3225, value_3226, right_3227];
} else if (__wm_return_value_9?.ctor === 4 && __wm_return_value_9.args.length === 1 && __wm_is_tuple(__wm_return_value_9.args[0]) && __wm_return_value_9.args[0].length === 5) {
const _height_3228 = __wm_return_value_9.args[0][0];
const key_3229 = __wm_return_value_9.args[0][1];
const value_3230 = __wm_return_value_9.args[0][2];
const left_3231 = __wm_return_value_9.args[0][3];
const right_3232 = __wm_return_value_9.args[0][4];
const __wm_bind_0 = removeSmallest_3222(left_3231);
if (!(__wm_is_tuple(__wm_bind_0) && __wm_bind_0.length === 3)) __wm_fail("Bind", "pattern match failure in let binding");
const smallestKey_3233 = __wm_bind_0[0];
const smallestValue_3234 = __wm_bind_0[1];
const remainingLeft_3235 = __wm_bind_0[2];
return [smallestKey_3233, smallestValue_3234, balance_3181(node_3141__wm_d4(key_3229, value_3230, remainingLeft_3235, right_3232))];
} else if (__wm_return_value_9 === MapEmpty_ctor_3) {

return __wm_fail("Panic", "Map.removeSmallest called with an empty tree");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const removeTree_3236__wm_d3 = (tree_3237, key_3238, compare_3239) => {
const __wm_scalar_15_0 = tree_3237;
const __wm_scalar_15_1 = key_3238;
const __wm_scalar_15_2 = compare_3239;
if (__wm_scalar_15_0 === MapEmpty_ctor_3) {

return MapEmpty_ctor_3;
} else if (__wm_scalar_15_0?.ctor === 4 && __wm_scalar_15_0.args.length === 1 && __wm_is_tuple(__wm_scalar_15_0.args[0]) && __wm_scalar_15_0.args[0].length === 5 && __wm_eq(__wm_scalar_15_1, key_3238) && __wm_eq(__wm_scalar_15_2, compare_3239)) {
const _height_3240 = __wm_scalar_15_0.args[0][0];
const nodeKey_3241 = __wm_scalar_15_0.args[0][1];
const value_3242 = __wm_scalar_15_0.args[0][2];
const left_3243 = __wm_scalar_15_0.args[0][3];
const right_3244 = __wm_scalar_15_0.args[0][4];
const __wm_return_value_10 = compare_3239([key_3238, nodeKey_3241]);
if (__wm_return_value_10 === Less_ctor_0) {

return balance_3181(node_3141__wm_d4(nodeKey_3241, value_3242, removeTree_3236__wm_d3(left_3243, key_3238, compare_3239), right_3244));
} else if (__wm_return_value_10 === Greater_ctor_2) {

return balance_3181(node_3141__wm_d4(nodeKey_3241, value_3242, left_3243, removeTree_3236__wm_d3(right_3244, key_3238, compare_3239)));
} else if (__wm_return_value_10 === Equal_ctor_1) {

const __wm_scalar_16_0 = left_3243;
const __wm_scalar_16_1 = right_3244;
if (__wm_scalar_16_0 === MapEmpty_ctor_3) {

return right_3244;
} else if (__wm_scalar_16_1 === MapEmpty_ctor_3) {

return left_3243;
} else if (__wm_eq(__wm_scalar_16_1, right_3244)) {

const __wm_bind_1 = removeSmallest_3222(right_3244);
if (!(__wm_is_tuple(__wm_bind_1) && __wm_bind_1.length === 3)) __wm_fail("Bind", "pattern match failure in let binding");
const nextKey_3245 = __wm_bind_1[0];
const nextValue_3246 = __wm_bind_1[1];
const remainingRight_3247 = __wm_bind_1[2];
return balance_3181(node_3141__wm_d4(nextKey_3245, nextValue_3246, left_3243, remainingRight_3247));
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
};
const removeTree_3236 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return removeTree_3236__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const remove_3252__wm_d2 = (map_3248, key_3249) => {
const __wm_scalar_17_0 = map_3248;
const __wm_scalar_17_1 = key_3249;
if (__wm_scalar_17_0?.ctor === 5 && __wm_scalar_17_0.args.length === 1 && __wm_is_tuple(__wm_scalar_17_0.args[0]) && __wm_scalar_17_0.args[0].length === 2 && __wm_eq(__wm_scalar_17_1, key_3249)) {
const compare_3250 = __wm_scalar_17_0.args[0][0];
const tree_3251 = __wm_scalar_17_0.args[0][1];
return MapValue_ctor_5([compare_3250, removeTree_3236__wm_d3(tree_3251, key_3249, compare_3250)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const remove_3252 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return remove_3252__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const update_3257__wm_d3 = (map_3253, key_3254, transform_3255) => {
const __wm_return_value_11 = transform_3255(get_3197__wm_d2(map_3253, key_3254));
if (__wm_return_value_11?.ctor === -2 && __wm_return_value_11.args.length === 1) {
const value_3256 = __wm_return_value_11.args[0];
return set_3217__wm_d3(map_3253, key_3254, value_3256);
} else if (__wm_return_value_11 === __wm_basis_None) {

return remove_3252__wm_d2(map_3253, key_3254);
}
__wm_fail("Match", "non-exhaustive match");
};
const update_3257 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return update_3257__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const foldTree_3258__wm_d3 = (tree_3259, initial_3260, combine_3261) => {
__wm_tail_8: while (true) {
{
const __wm_scalar_18_0 = tree_3259;
const __wm_scalar_18_1 = initial_3260;
const __wm_scalar_18_2 = combine_3261;
if (__wm_scalar_18_0 === MapEmpty_ctor_3 && __wm_eq(__wm_scalar_18_1, initial_3260)) {

return initial_3260;
} else if (__wm_scalar_18_0?.ctor === 4 && __wm_scalar_18_0.args.length === 1 && __wm_is_tuple(__wm_scalar_18_0.args[0]) && __wm_scalar_18_0.args[0].length === 5 && __wm_eq(__wm_scalar_18_1, initial_3260) && __wm_eq(__wm_scalar_18_2, combine_3261)) {
const _height_3262 = __wm_scalar_18_0.args[0][0];
const key_3263 = __wm_scalar_18_0.args[0][1];
const value_3264 = __wm_scalar_18_0.args[0][2];
const left_3265 = __wm_scalar_18_0.args[0][3];
const right_3266 = __wm_scalar_18_0.args[0][4];
{
const afterLeft_3267 = foldTree_3258__wm_d3(left_3265, initial_3260, combine_3261);
{
const __wm_tail_arg_10_0 = right_3266;
const __wm_tail_arg_10_1 = combine_3261([afterLeft_3267, key_3263, value_3264]);
const __wm_tail_arg_10_2 = combine_3261;
tree_3259 = __wm_tail_arg_10_0;
initial_3260 = __wm_tail_arg_10_1;
combine_3261 = __wm_tail_arg_10_2;
continue __wm_tail_8;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const foldTree_3258 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return foldTree_3258__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const fold_3273__wm_d3 = (map_3268, initial_3269, combine_3270) => {
const __wm_scalar_19_0 = map_3268;
const __wm_scalar_19_1 = initial_3269;
const __wm_scalar_19_2 = combine_3270;
if (__wm_scalar_19_0?.ctor === 5 && __wm_scalar_19_0.args.length === 1 && __wm_is_tuple(__wm_scalar_19_0.args[0]) && __wm_scalar_19_0.args[0].length === 2 && __wm_eq(__wm_scalar_19_1, initial_3269) && __wm_eq(__wm_scalar_19_2, combine_3270)) {
const _compare_3271 = __wm_scalar_19_0.args[0][0];
const tree_3272 = __wm_scalar_19_0.args[0][1];
return foldTree_3258__wm_d3(tree_3272, initial_3269, combine_3270);
}
__wm_fail("Match", "non-exhaustive match");
};
const fold_3273 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return fold_3273__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const toListTree_3274__wm_d2 = (tree_3275, tail_3276) => {
__wm_tail_9: while (true) {
{
const __wm_scalar_20_0 = tree_3275;
const __wm_scalar_20_1 = tail_3276;
if (__wm_scalar_20_0 === MapEmpty_ctor_3 && __wm_eq(__wm_scalar_20_1, tail_3276)) {

return tail_3276;
} else if (__wm_scalar_20_0?.ctor === 4 && __wm_scalar_20_0.args.length === 1 && __wm_is_tuple(__wm_scalar_20_0.args[0]) && __wm_scalar_20_0.args[0].length === 5 && __wm_eq(__wm_scalar_20_1, tail_3276)) {
const _height_3277 = __wm_scalar_20_0.args[0][0];
const key_3278 = __wm_scalar_20_0.args[0][1];
const value_3279 = __wm_scalar_20_0.args[0][2];
const left_3280 = __wm_scalar_20_0.args[0][3];
const right_3281 = __wm_scalar_20_0.args[0][4];
{
const __wm_tail_arg_11_0 = left_3280;
const __wm_tail_arg_11_1 = __wm_basis_Cons([[key_3278, value_3279], toListTree_3274__wm_d2(right_3281, tail_3276)]);
tree_3275 = __wm_tail_arg_11_0;
tail_3276 = __wm_tail_arg_11_1;
continue __wm_tail_9;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const toListTree_3274 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return toListTree_3274__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const toList_3285 = (__arg) => {
if (true) {
const map_3282 = __arg;
const __wm_return_value_12 = map_3282;
if (__wm_return_value_12?.ctor === 5 && __wm_return_value_12.args.length === 1 && __wm_is_tuple(__wm_return_value_12.args[0]) && __wm_return_value_12.args[0].length === 2) {
const _compare_3283 = __wm_return_value_12.args[0][0];
const tree_3284 = __wm_return_value_12.args[0][1];
return toListTree_3274__wm_d2(tree_3284, __wm_basis_Nil);
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const debugHeight_3289 = (__arg) => {
if (true) {
const map_3286 = __arg;
const __wm_return_value_13 = map_3286;
if (__wm_return_value_13?.ctor === 5 && __wm_return_value_13.args.length === 1 && __wm_is_tuple(__wm_return_value_13.args[0]) && __wm_return_value_13.args[0].length === 2) {
const _compare_3287 = __wm_return_value_13.args[0][0];
const tree_3288 = __wm_return_value_13.args[0][1];
return height_3133(tree_3288);
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const fromListItems_3290__wm_d2 = (map_3291, items_3292) => {
__wm_tail_10: while (true) {
{
const __wm_scalar_21_0 = map_3291;
const __wm_scalar_21_1 = items_3292;
if (__wm_eq(__wm_scalar_21_0, map_3291) && __wm_scalar_21_1 === __wm_basis_Nil) {

return map_3291;
} else if (__wm_eq(__wm_scalar_21_0, map_3291) && __wm_scalar_21_1?.ctor === -6 && __wm_scalar_21_1.args.length === 1 && __wm_is_tuple(__wm_scalar_21_1.args[0]) && __wm_scalar_21_1.args[0].length === 2 && __wm_is_tuple(__wm_scalar_21_1.args[0][0]) && __wm_scalar_21_1.args[0][0].length === 2) {
const key_3293 = __wm_scalar_21_1.args[0][0][0];
const value_3294 = __wm_scalar_21_1.args[0][0][1];
const rest_3295 = __wm_scalar_21_1.args[0][1];
{
const __wm_tail_arg_12_0 = set_3217__wm_d3(map_3291, key_3293, value_3294);
const __wm_tail_arg_12_1 = rest_3295;
map_3291 = __wm_tail_arg_12_0;
items_3292 = __wm_tail_arg_12_1;
continue __wm_tail_10;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const fromListItems_3290 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return fromListItems_3290__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const fromList_3298__wm_d2 = (compare_3296, items_3297) => {
return fromListItems_3290__wm_d2(empty_3183(compare_3296), items_3297);
};
const fromList_3298 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return fromList_3298__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return { "Less": Less_ctor_0, "Equal": Equal_ctor_1, "Greater": Greater_ctor_2, "MapEmpty": MapEmpty_ctor_3, "MapNode": MapNode_ctor_4, "MapValue": MapValue_ctor_5, "numberCompare": numberCompare_3126, "numberCompare__wm_d2": numberCompare_3126__wm_d2, "height": height_3133, "max": max_3136, "max__wm_d2": max_3136__wm_d2, "node": node_3141, "node__wm_d4": node_3141__wm_d4, "rotateLeft": rotateLeft_3152, "rotateRight": rotateRight_3163, "balance": balance_3181, "empty": empty_3183, "getTree": getTree_3184, "getTree__wm_d3": getTree_3184__wm_d3, "get": get_3197, "get__wm_d2": get_3197__wm_d2, "has": has_3201, "has__wm_d2": has_3201__wm_d2, "setTree": setTree_3202, "setTree__wm_d4": setTree_3202__wm_d4, "set": set_3217, "set__wm_d3": set_3217__wm_d3, "singleton": singleton_3221, "singleton__wm_d3": singleton_3221__wm_d3, "removeSmallest": removeSmallest_3222, "removeTree": removeTree_3236, "removeTree__wm_d3": removeTree_3236__wm_d3, "remove": remove_3252, "remove__wm_d2": remove_3252__wm_d2, "update": update_3257, "update__wm_d3": update_3257__wm_d3, "foldTree": foldTree_3258, "foldTree__wm_d3": foldTree_3258__wm_d3, "fold": fold_3273, "fold__wm_d3": fold_3273__wm_d3, "toListTree": toListTree_3274, "toListTree__wm_d2": toListTree_3274__wm_d2, "toList": toList_3285, "debugHeight": debugHeight_3289, "fromListItems": fromListItems_3290, "fromListItems__wm_d2": fromListItems_3290__wm_d2, "fromList": fromList_3298, "fromList__wm_d2": fromList_3298__wm_d2 };
  },
  (value) => { __wm_std_Map = value; },
);
let __wm_std_Option;
__wm_define_module(
  "__wm_std_Option",
  [],
  async () => {
const map_3302__wm_d2 = (option_3299, f_3300) => {
const __wm_scalar_22_0 = option_3299;
const __wm_scalar_22_1 = f_3300;
if (__wm_scalar_22_0?.ctor === -2 && __wm_scalar_22_0.args.length === 1 && __wm_eq(__wm_scalar_22_1, f_3300)) {
const value_3301 = __wm_scalar_22_0.args[0];
return __wm_basis_Some(f_3300(value_3301));
} else if (__wm_scalar_22_0 === __wm_basis_None) {

return __wm_basis_None;
}
__wm_fail("Match", "non-exhaustive match");
};
const map_3302 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return map_3302__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const andThen_3306__wm_d2 = (option_3303, f_3304) => {
const __wm_scalar_23_0 = option_3303;
const __wm_scalar_23_1 = f_3304;
if (__wm_scalar_23_0?.ctor === -2 && __wm_scalar_23_0.args.length === 1 && __wm_eq(__wm_scalar_23_1, f_3304)) {
const value_3305 = __wm_scalar_23_0.args[0];
return f_3304(value_3305);
} else if (__wm_scalar_23_0 === __wm_basis_None) {

return __wm_basis_None;
}
__wm_fail("Match", "non-exhaustive match");
};
const andThen_3306 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return andThen_3306__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const withDefault_3310__wm_d2 = (option_3307, fallback_3308) => {
const __wm_scalar_24_0 = option_3307;
const __wm_scalar_24_1 = fallback_3308;
if (__wm_scalar_24_0?.ctor === -2 && __wm_scalar_24_0.args.length === 1) {
const value_3309 = __wm_scalar_24_0.args[0];
return value_3309;
} else if (__wm_scalar_24_0 === __wm_basis_None && __wm_eq(__wm_scalar_24_1, fallback_3308)) {

return fallback_3308;
}
__wm_fail("Match", "non-exhaustive match");
};
const withDefault_3310 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return withDefault_3310__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const map2_3316__wm_d3 = (a_3311, b_3312, f_3313) => {
const __wm_scalar_25_0 = a_3311;
const __wm_scalar_25_1 = b_3312;
const __wm_scalar_25_2 = f_3313;
if (__wm_scalar_25_0?.ctor === -2 && __wm_scalar_25_0.args.length === 1 && __wm_scalar_25_1?.ctor === -2 && __wm_scalar_25_1.args.length === 1 && __wm_eq(__wm_scalar_25_2, f_3313)) {
const left_3314 = __wm_scalar_25_0.args[0];
const right_3315 = __wm_scalar_25_1.args[0];
return __wm_basis_Some(f_3313([left_3314, right_3315]));
} else if (__wm_scalar_25_0 === __wm_basis_None) {

return __wm_basis_None;
} else if (__wm_scalar_25_1 === __wm_basis_None) {

return __wm_basis_None;
}
__wm_fail("Match", "non-exhaustive match");
};
const map2_3316 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return map2_3316__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const traverse_3317__wm_d2 = (items_3318, f_3319) => {
const __wm_scalar_26_0 = items_3318;
const __wm_scalar_26_1 = f_3319;
if (__wm_scalar_26_0 === __wm_basis_Nil) {

return __wm_basis_Some(__wm_basis_Nil);
} else if (__wm_scalar_26_0?.ctor === -6 && __wm_scalar_26_0.args.length === 1 && __wm_is_tuple(__wm_scalar_26_0.args[0]) && __wm_scalar_26_0.args[0].length === 2 && __wm_eq(__wm_scalar_26_1, f_3319)) {
const item_3320 = __wm_scalar_26_0.args[0][0];
const rest_3321 = __wm_scalar_26_0.args[0][1];
const __wm_return_value_14 = f_3319(item_3320);
if (__wm_return_value_14 === __wm_basis_None) {

return __wm_basis_None;
} else if (__wm_return_value_14?.ctor === -2 && __wm_return_value_14.args.length === 1) {
const value_3322 = __wm_return_value_14.args[0];
const __wm_return_value_15 = traverse_3317__wm_d2(rest_3321, f_3319);
if (__wm_return_value_15 === __wm_basis_None) {

return __wm_basis_None;
} else if (__wm_return_value_15?.ctor === -2 && __wm_return_value_15.args.length === 1) {
const values_3323 = __wm_return_value_15.args[0];
return __wm_basis_Some(__wm_basis_Cons([value_3322, values_3323]));
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "non-exhaustive match");
};
const traverse_3317 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return traverse_3317__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collectList_3326 = (__arg) => {
if (true) {
const items_3324 = __arg;
return traverse_3317__wm_d2(items_3324, (__arg) => {
if (true) {
const item_3325 = __arg;
return item_3325;
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
return { "map": map_3302, "map__wm_d2": map_3302__wm_d2, "andThen": andThen_3306, "andThen__wm_d2": andThen_3306__wm_d2, "withDefault": withDefault_3310, "withDefault__wm_d2": withDefault_3310__wm_d2, "map2": map2_3316, "map2__wm_d3": map2_3316__wm_d3, "traverse": traverse_3317, "traverse__wm_d2": traverse_3317__wm_d2, "collectList": collectList_3326 };
  },
  (value) => { __wm_std_Option = value; },
);
let __wm_std_Monad;
__wm_define_module(
  "__wm_std_Monad",
  [],
  async () => {
const Carrier_3327 = (__record_args) => ({ fn: __record_args[0], fnError: __record_args[1], succeed: __record_args[2], map: __record_args[3], map2: __record_args[4], andThen: __record_args[5] });
const Applicative_3328 = (__record_args) => ({ succeed: __record_args[0], map: __record_args[1], map2: __record_args[2] });
const via_3331 = (__arg) => {
if (true) {
const domain_3329 = __arg;
return (__arg) => {
if (true) {
const f_3330 = __arg;
return domain_3329.fn(f_3330);
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const viaError_3335 = (__arg) => {
if (true) {
const domain_3332 = __arg;
return (__arg) => {
if (true) {
const inject_3333 = __arg;
return (__arg) => {
if (true) {
const f_3334 = __arg;
return domain_3332.fnError(inject_3333)(f_3334);
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
return { "Carrier": Carrier_3327, "Applicative": Applicative_3328, "via": via_3331, "viaError": viaError_3335 };
  },
  (value) => { __wm_std_Monad = value; },
);
let __wm_std_Result;
__wm_define_module(
  "__wm_std_Result",
  ["__wm_std_Monad"],
  async () => {
const Carrier_3327 = __wm_std_Monad["Carrier"];
const succeed_3337 = (__arg) => {
if (true) {
const value_3336 = __arg;
return __wm_basis_Ok(value_3336);
}
__wm_fail("Match", "pattern match failure in function");
};
const map_3342__wm_d2 = (result_3338, f_3339) => {
const __wm_scalar_27_0 = result_3338;
const __wm_scalar_27_1 = f_3339;
if (__wm_scalar_27_0?.ctor === -3 && __wm_scalar_27_0.args.length === 1 && __wm_eq(__wm_scalar_27_1, f_3339)) {
const value_3340 = __wm_scalar_27_0.args[0];
return __wm_basis_Ok(f_3339(value_3340));
} else if (__wm_scalar_27_0?.ctor === -4 && __wm_scalar_27_0.args.length === 1) {
const error_3341 = __wm_scalar_27_0.args[0];
return __wm_basis_Err(error_3341);
}
__wm_fail("Match", "non-exhaustive match");
};
const map_3342 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return map_3342__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const andThen_3347__wm_d2 = (result_3343, f_3344) => {
const __wm_scalar_28_0 = result_3343;
const __wm_scalar_28_1 = f_3344;
if (__wm_scalar_28_0?.ctor === -3 && __wm_scalar_28_0.args.length === 1 && __wm_eq(__wm_scalar_28_1, f_3344)) {
const value_3345 = __wm_scalar_28_0.args[0];
return f_3344(value_3345);
} else if (__wm_scalar_28_0?.ctor === -4 && __wm_scalar_28_0.args.length === 1) {
const error_3346 = __wm_scalar_28_0.args[0];
return __wm_basis_Err(error_3346);
}
__wm_fail("Match", "non-exhaustive match");
};
const andThen_3347 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return andThen_3347__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const toBool_3351 = (__arg) => {
if (true) {
const r_3348 = __arg;
const __wm_return_value_16 = r_3348;
if (__wm_return_value_16?.ctor === -3 && __wm_return_value_16.args.length === 1) {
const v_3349 = __wm_return_value_16.args[0];
const __wm_return_value_17 = v_3349;
if (__wm_return_value_17 === true) {

return true;
} else if (__wm_return_value_17 === false) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_16?.ctor === -4 && __wm_return_value_16.args.length === 1) {
const __3350 = __wm_return_value_16.args[0];
return false;
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const fn_3354 = (__arg) => {
if (true) {
const f_3352 = __arg;
return (__arg) => {
if (true) {
const result_3353 = __arg;
return andThen_3347__wm_d2(result_3353, f_3352);
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const mapErr_3359__wm_d2 = (result_3355, f_3356) => {
const __wm_scalar_29_0 = result_3355;
const __wm_scalar_29_1 = f_3356;
if (__wm_scalar_29_0?.ctor === -3 && __wm_scalar_29_0.args.length === 1) {
const value_3357 = __wm_scalar_29_0.args[0];
return __wm_basis_Ok(value_3357);
} else if (__wm_scalar_29_0?.ctor === -4 && __wm_scalar_29_0.args.length === 1 && __wm_eq(__wm_scalar_29_1, f_3356)) {
const error_3358 = __wm_scalar_29_0.args[0];
return __wm_basis_Err(f_3356(error_3358));
}
__wm_fail("Match", "non-exhaustive match");
};
const mapErr_3359 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return mapErr_3359__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const fnError_3363 = (__arg) => {
if (true) {
const inject_3360 = __arg;
return (__arg) => {
if (true) {
const f_3361 = __arg;
return fn_3354((__arg) => {
if (true) {
const value_3362 = __arg;
return mapErr_3359__wm_d2(f_3361(value_3362), inject_3360);
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const map2_3371__wm_d3 = (a_3364, b_3365, f_3366) => {
const __wm_scalar_30_0 = a_3364;
const __wm_scalar_30_1 = b_3365;
const __wm_scalar_30_2 = f_3366;
if (__wm_scalar_30_0?.ctor === -3 && __wm_scalar_30_0.args.length === 1 && __wm_scalar_30_1?.ctor === -3 && __wm_scalar_30_1.args.length === 1 && __wm_eq(__wm_scalar_30_2, f_3366)) {
const left_3367 = __wm_scalar_30_0.args[0];
const right_3368 = __wm_scalar_30_1.args[0];
return __wm_basis_Ok(f_3366([left_3367, right_3368]));
} else if (__wm_scalar_30_0?.ctor === -4 && __wm_scalar_30_0.args.length === 1) {
const error_3369 = __wm_scalar_30_0.args[0];
return __wm_basis_Err(error_3369);
} else if (__wm_scalar_30_1?.ctor === -4 && __wm_scalar_30_1.args.length === 1) {
const error_3370 = __wm_scalar_30_1.args[0];
return __wm_basis_Err(error_3370);
}
__wm_fail("Match", "non-exhaustive match");
};
const map2_3371 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return map2_3371__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const carrier_3372 = { fn: fn_3354, fnError: fnError_3363, succeed: succeed_3337, map: map_3342, map2: map2_3371, andThen: andThen_3347 };
const withDefault_3377__wm_d2 = (result_3373, fallback_3374) => {
const __wm_scalar_31_0 = result_3373;
const __wm_scalar_31_1 = fallback_3374;
if (__wm_scalar_31_0?.ctor === -3 && __wm_scalar_31_0.args.length === 1) {
const value_3375 = __wm_scalar_31_0.args[0];
return value_3375;
} else if (__wm_scalar_31_0?.ctor === -4 && __wm_scalar_31_0.args.length === 1 && __wm_eq(__wm_scalar_31_1, fallback_3374)) {
const __3376 = __wm_scalar_31_0.args[0];
return fallback_3374;
}
__wm_fail("Match", "non-exhaustive match");
};
const withDefault_3377 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return withDefault_3377__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const debug_3381 = (__arg) => {
if (true) {
const result_3378 = __arg;
const __wm_return_value_18 = result_3378;
if (__wm_return_value_18?.ctor === -3 && __wm_return_value_18.args.length === 1) {
const value_3379 = __wm_return_value_18.args[0];
return value_3379;
} else if (__wm_return_value_18?.ctor === -4 && __wm_return_value_18.args.length === 1) {
const error_3380 = __wm_return_value_18.args[0];
print(Debug.errorMessage(error_3380));
return __wm_fail("TypedHole", "error[type.typed-hole std/result.wm:70:4]: typed hole; expected type: 'a\n70|     ?\n        ^");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const map3_3392__wm_d4 = (a_3382, b_3383, c_3384, f_3385) => {
const __wm_scalar_32_0 = a_3382;
const __wm_scalar_32_1 = b_3383;
const __wm_scalar_32_2 = c_3384;
const __wm_scalar_32_3 = f_3385;
if (__wm_scalar_32_0?.ctor === -3 && __wm_scalar_32_0.args.length === 1 && __wm_scalar_32_1?.ctor === -3 && __wm_scalar_32_1.args.length === 1 && __wm_scalar_32_2?.ctor === -3 && __wm_scalar_32_2.args.length === 1 && __wm_eq(__wm_scalar_32_3, f_3385)) {
const av_3386 = __wm_scalar_32_0.args[0];
const bv_3387 = __wm_scalar_32_1.args[0];
const cv_3388 = __wm_scalar_32_2.args[0];
return __wm_basis_Ok(f_3385([av_3386, bv_3387, cv_3388]));
} else if (__wm_scalar_32_0?.ctor === -4 && __wm_scalar_32_0.args.length === 1) {
const error_3389 = __wm_scalar_32_0.args[0];
return __wm_basis_Err(error_3389);
} else if (__wm_scalar_32_1?.ctor === -4 && __wm_scalar_32_1.args.length === 1) {
const error_3390 = __wm_scalar_32_1.args[0];
return __wm_basis_Err(error_3390);
} else if (__wm_scalar_32_2?.ctor === -4 && __wm_scalar_32_2.args.length === 1) {
const error_3391 = __wm_scalar_32_2.args[0];
return __wm_basis_Err(error_3391);
}
__wm_fail("Match", "non-exhaustive match");
};
const map3_3392 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return map3_3392__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const map4_3406__wm_d5 = (a_3393, b_3394, c_3395, d_3396, f_3397) => {
const __wm_scalar_33_0 = a_3393;
const __wm_scalar_33_1 = b_3394;
const __wm_scalar_33_2 = c_3395;
const __wm_scalar_33_3 = d_3396;
const __wm_scalar_33_4 = f_3397;
if (__wm_scalar_33_0?.ctor === -3 && __wm_scalar_33_0.args.length === 1 && __wm_scalar_33_1?.ctor === -3 && __wm_scalar_33_1.args.length === 1 && __wm_scalar_33_2?.ctor === -3 && __wm_scalar_33_2.args.length === 1 && __wm_scalar_33_3?.ctor === -3 && __wm_scalar_33_3.args.length === 1 && __wm_eq(__wm_scalar_33_4, f_3397)) {
const av_3398 = __wm_scalar_33_0.args[0];
const bv_3399 = __wm_scalar_33_1.args[0];
const cv_3400 = __wm_scalar_33_2.args[0];
const dv_3401 = __wm_scalar_33_3.args[0];
return __wm_basis_Ok(f_3397([av_3398, bv_3399, cv_3400, dv_3401]));
} else if (__wm_scalar_33_0?.ctor === -4 && __wm_scalar_33_0.args.length === 1) {
const error_3402 = __wm_scalar_33_0.args[0];
return __wm_basis_Err(error_3402);
} else if (__wm_scalar_33_1?.ctor === -4 && __wm_scalar_33_1.args.length === 1) {
const error_3403 = __wm_scalar_33_1.args[0];
return __wm_basis_Err(error_3403);
} else if (__wm_scalar_33_2?.ctor === -4 && __wm_scalar_33_2.args.length === 1) {
const error_3404 = __wm_scalar_33_2.args[0];
return __wm_basis_Err(error_3404);
} else if (__wm_scalar_33_3?.ctor === -4 && __wm_scalar_33_3.args.length === 1) {
const error_3405 = __wm_scalar_33_3.args[0];
return __wm_basis_Err(error_3405);
}
__wm_fail("Match", "non-exhaustive match");
};
const map4_3406 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return map4_3406__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const reverseAcc_3407__wm_d2 = (items_3408, acc_3409) => {
__wm_tail_11: while (true) {
{
const __wm_scalar_34_0 = items_3408;
const __wm_scalar_34_1 = acc_3409;
if (__wm_scalar_34_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_34_1, acc_3409)) {

return acc_3409;
} else if (__wm_scalar_34_0?.ctor === -6 && __wm_scalar_34_0.args.length === 1 && __wm_is_tuple(__wm_scalar_34_0.args[0]) && __wm_scalar_34_0.args[0].length === 2 && __wm_eq(__wm_scalar_34_1, acc_3409)) {
const head_3410 = __wm_scalar_34_0.args[0][0];
const rest_3411 = __wm_scalar_34_0.args[0][1];
{
const __wm_tail_arg_13_0 = rest_3411;
const __wm_tail_arg_13_1 = __wm_basis_Cons([head_3410, acc_3409]);
items_3408 = __wm_tail_arg_13_0;
acc_3409 = __wm_tail_arg_13_1;
continue __wm_tail_11;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reverseAcc_3407 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reverseAcc_3407__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const reverse_3413 = (__arg) => {
if (true) {
const items_3412 = __arg;
return reverseAcc_3407__wm_d2(items_3412, __wm_basis_Nil);
}
__wm_fail("Match", "pattern match failure in function");
};
const traverseAcc_3414__wm_d3 = (items_3415, f_3416, acc_3417) => {
__wm_tail_12: while (true) {
{
const __wm_scalar_35_0 = items_3415;
const __wm_scalar_35_1 = f_3416;
const __wm_scalar_35_2 = acc_3417;
if (__wm_scalar_35_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_35_2, acc_3417)) {

return __wm_basis_Ok(reverse_3413(acc_3417));
} else if (__wm_scalar_35_0?.ctor === -6 && __wm_scalar_35_0.args.length === 1 && __wm_is_tuple(__wm_scalar_35_0.args[0]) && __wm_scalar_35_0.args[0].length === 2 && __wm_eq(__wm_scalar_35_1, f_3416) && __wm_eq(__wm_scalar_35_2, acc_3417)) {
const item_3418 = __wm_scalar_35_0.args[0][0];
const rest_3419 = __wm_scalar_35_0.args[0][1];
{
const __wm_tail_value_14 = f_3416(item_3418);
if (__wm_tail_value_14?.ctor === -4 && __wm_tail_value_14.args.length === 1) {
const error_3420 = __wm_tail_value_14.args[0];
return __wm_basis_Err(error_3420);
} else if (__wm_tail_value_14?.ctor === -3 && __wm_tail_value_14.args.length === 1) {
const value_3421 = __wm_tail_value_14.args[0];
{
const __wm_tail_arg_15_0 = rest_3419;
const __wm_tail_arg_15_1 = f_3416;
const __wm_tail_arg_15_2 = __wm_basis_Cons([value_3421, acc_3417]);
items_3415 = __wm_tail_arg_15_0;
f_3416 = __wm_tail_arg_15_1;
acc_3417 = __wm_tail_arg_15_2;
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
const traverseAcc_3414 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return traverseAcc_3414__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const traverse_3424__wm_d2 = (items_3422, f_3423) => {
return traverseAcc_3414__wm_d3(items_3422, f_3423, __wm_basis_Nil);
};
const traverse_3424 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return traverse_3424__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const all_3427 = (__arg) => {
if (true) {
const items_3425 = __arg;
return map_3342__wm_d2(traverse_3424__wm_d2(Js.Array.toList(items_3425), (__arg) => {
if (true) {
const item_3426 = __arg;
return item_3426;
}
__wm_fail("Match", "pattern match failure in function");
}), Js.Array.fromList);
}
__wm_fail("Match", "pattern match failure in function");
};
const collectList_3430 = (__arg) => {
if (true) {
const items_3428 = __arg;
return traverse_3424__wm_d2(items_3428, (__arg) => {
if (true) {
const item_3429 = __arg;
return item_3429;
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
return { "succeed": succeed_3337, "map": map_3342, "map__wm_d2": map_3342__wm_d2, "andThen": andThen_3347, "andThen__wm_d2": andThen_3347__wm_d2, "toBool": toBool_3351, "fn": fn_3354, "mapErr": mapErr_3359, "mapErr__wm_d2": mapErr_3359__wm_d2, "fnError": fnError_3363, "map2": map2_3371, "map2__wm_d3": map2_3371__wm_d3, "carrier": carrier_3372, "withDefault": withDefault_3377, "withDefault__wm_d2": withDefault_3377__wm_d2, "debug": debug_3381, "map3": map3_3392, "map3__wm_d4": map3_3392__wm_d4, "map4": map4_3406, "map4__wm_d5": map4_3406__wm_d5, "reverseAcc": reverseAcc_3407, "reverseAcc__wm_d2": reverseAcc_3407__wm_d2, "reverse": reverse_3413, "traverseAcc": traverseAcc_3414, "traverseAcc__wm_d3": traverseAcc_3414__wm_d3, "traverse": traverse_3424, "traverse__wm_d2": traverse_3424__wm_d2, "all": all_3427, "collectList": collectList_3430 };
  },
  (value) => { __wm_std_Result = value; },
);
let __wm_std_Task;
__wm_define_module(
  "__wm_std_Task",
  ["__wm_std_Monad"],
  async () => {
const Carrier_3327 = __wm_std_Monad["Carrier"];
const fn_3433 = (__arg) => {
if (true) {
const f_3431 = __arg;
return (__arg) => {
if (true) {
const task_3432 = __arg;
return Task.andThen([task_3432, f_3431]);
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const fnError_3437 = (__arg) => {
if (true) {
const inject_3434 = __arg;
return (__arg) => {
if (true) {
const f_3435 = __arg;
return fn_3433((__arg) => {
if (true) {
const value_3436 = __arg;
return Task.mapErr([f_3435(value_3436), inject_3434]);
}
__wm_fail("Match", "pattern match failure in function");
});
}
__wm_fail("Match", "pattern match failure in function");
};
}
__wm_fail("Match", "pattern match failure in function");
};
const carrier_3446 = { fn: fn_3433, fnError: fnError_3437, succeed: (__arg) => {
if (true) {
const value_3438 = __arg;
return Task.succeed(value_3438);
}
__wm_fail("Match", "pattern match failure in function");
}, map: (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) {
const task_3439 = __arg[0];
const f_3440 = __arg[1];
return Task.map([task_3439, f_3440]);
}
__wm_fail("Match", "pattern match failure in function");
}, map2: (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) {
const left_3441 = __arg[0];
const right_3442 = __arg[1];
const combine_3443 = __arg[2];
return Task.map2([left_3441, right_3442, combine_3443]);
}
__wm_fail("Match", "pattern match failure in function");
}, andThen: (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) {
const task_3444 = __arg[0];
const f_3445 = __arg[1];
return Task.andThen([task_3444, f_3445]);
}
__wm_fail("Match", "pattern match failure in function");
} };
const collectList_3448 = (__arg) => {
if (true) {
const tasks_3447 = __arg;
return Task.map([Task.all(Js.Array.fromList(tasks_3447)), Js.Array.toList]);
}
__wm_fail("Match", "pattern match failure in function");
};
const traverse_3449__wm_d2 = (items_3450, f_3451) => {
const __wm_scalar_36_0 = items_3450;
const __wm_scalar_36_1 = f_3451;
if (__wm_scalar_36_0 === __wm_basis_Nil) {

return Task.succeed(__wm_basis_Nil);
} else if (__wm_scalar_36_0?.ctor === -6 && __wm_scalar_36_0.args.length === 1 && __wm_is_tuple(__wm_scalar_36_0.args[0]) && __wm_scalar_36_0.args[0].length === 2 && __wm_eq(__wm_scalar_36_1, f_3451)) {
const item_3452 = __wm_scalar_36_0.args[0][0];
const rest_3453 = __wm_scalar_36_0.args[0][1];
return Task.andThen([f_3451(item_3452), (__arg) => {
if (true) {
const value_3454 = __arg;
return Task.map([traverse_3449__wm_d2(rest_3453, f_3451), (__arg) => {
if (true) {
const values_3455 = __arg;
return __wm_basis_Cons([value_3454, values_3455]);
}
__wm_fail("Match", "pattern match failure in function");
}]);
}
__wm_fail("Match", "pattern match failure in function");
}]);
}
__wm_fail("Match", "non-exhaustive match");
};
const traverse_3449 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return traverse_3449__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return { "fn": fn_3433, "fnError": fnError_3437, "carrier": carrier_3446, "collectList": collectList_3448, "traverse": traverse_3449, "traverse__wm_d2": traverse_3449__wm_d2 };
  },
  (value) => { __wm_std_Task = value; },
);
let __wm_std_Traverse;
__wm_define_module(
  "__wm_std_Traverse",
  ["__wm_std_Monad"],
  async () => {
const Carrier_3327 = __wm_std_Monad["Carrier"];
const with_3466 = (__arg) => {
if (__arg !== null && typeof __arg === "object") {
const succeed_3456 = __arg.succeed;
const map_3457 = __arg.map;
const andThen_3458 = __arg.andThen;
const traverse_3459__wm_d2 = (items_3460, transform_3461) => {
const __wm_scalar_37_0 = items_3460;
const __wm_scalar_37_1 = transform_3461;
if (__wm_scalar_37_0 === __wm_basis_Nil) {

return succeed_3456(__wm_basis_Nil);
} else if (__wm_scalar_37_0?.ctor === -6 && __wm_scalar_37_0.args.length === 1 && __wm_is_tuple(__wm_scalar_37_0.args[0]) && __wm_scalar_37_0.args[0].length === 2 && __wm_eq(__wm_scalar_37_1, transform_3461)) {
const item_3462 = __wm_scalar_37_0.args[0][0];
const rest_3463 = __wm_scalar_37_0.args[0][1];
return andThen_3458([transform_3461(item_3462), (__arg) => {
if (true) {
const value_3464 = __arg;
return map_3457([traverse_3459__wm_d2(rest_3463, transform_3461), (__arg) => {
if (true) {
const values_3465 = __arg;
return __wm_basis_Cons([value_3464, values_3465]);
}
__wm_fail("Match", "pattern match failure in function");
}]);
}
__wm_fail("Match", "pattern match failure in function");
}]);
}
__wm_fail("Match", "non-exhaustive match");
};
const traverse_3459 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return traverse_3459__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
return traverse_3459;
}
__wm_fail("Match", "pattern match failure in function");
};
return { "with": with_3466 };
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
const GpuSliceCompilationOutputDto_63 = (__record_args) => ({ schemaVersion: __record_args[0], program: __record_args[1], shaderTypes: __record_args[2], typeEvidence: __record_args[3], occurrences: __record_args[4], builtinSelections: __record_args[5], irFunctions: __record_args[6], irExpressions: __record_args[7], irMatchArms: __record_args[8], adtLayouts: __record_args[9], adtFields: __record_args[10], loweredFunctions: __record_args[11], loweredLocals: __record_args[12], loweredAtoms: __record_args[13], loweredOperations: __record_args[14], loweredStatements: __record_args[15], loweredBlocks: __record_args[16], loweredCases: __record_args[17], slangSource: __record_args[18], diagnostics: __record_args[19] });
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
const lowerMatchValue_440__wm_d5 = (lower_443, expression_444, scope_445, context_446, state_447) => {
const __wm_return_value_22 = Js.Array.toList(expression_444.children);
if (__wm_return_value_22?.ctor === -6 && __wm_return_value_22.args.length === 1 && __wm_is_tuple(__wm_return_value_22.args[0]) && __wm_return_value_22.args[0].length === 2 && __wm_return_value_22.args[0][1] === __wm_basis_Nil) {
const scrutineeExpressionId_448 = __wm_return_value_22.args[0][0];
const scrutinee_449 = lower_443([scrutineeExpressionId_448, scope_445, context_446, state_447]);
const scrutineeExpression_450 = findIrExpression_169__wm_d2(context_446.expressions, scrutineeExpressionId_448);
const layout_451 = findLayoutForType_211__wm_d2(context_446.layouts, scrutineeExpression_450.typeId);
const __wm_bind_14 = freshLocal_265__wm_d7(expression_444.functionId, "join", expression_444.typeId, __wm_op_sub(1), true, expression_444.spanId, scrutinee_449.state);
if (!(__wm_is_tuple(__wm_bind_14) && __wm_bind_14.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const joinLocalId_452 = __wm_bind_14[0];
const afterJoin_453 = __wm_bind_14[1];
const cases_454 = lowerMatchValueCases_441__wm_d9(lower_443, Js.Array.toList(expression_444.armIds), expression_444, scrutinee_449.atomId, joinLocalId_452, scope_445, context_446, afterJoin_453, __wm_basis_Nil);
const statement_455 = { ...baseStatement_301__wm_d5(expression_444.functionId, "switch", expression_444.sourceExprId, expression_444.spanId, cases_454.state), localId: joinLocalId_452, scrutineeAtomId: scrutinee_449.atomId, layoutId: layout_451.id, caseIds: Js.Array.fromList(cases_454.caseIds), reason: "join" };
const __wm_bind_15 = pushStatement_294__wm_d2(statement_455, cases_454.state);
if (!(__wm_is_tuple(__wm_bind_15) && __wm_bind_15.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_456 = __wm_bind_15[0];
const afterSwitch_457 = __wm_bind_15[1];
const __wm_bind_16 = localAtom_277__wm_d6(expression_444.functionId, expression_444.typeId, expression_444.sourceExprId, expression_444.spanId, joinLocalId_452, afterSwitch_457);
if (!(__wm_is_tuple(__wm_bind_16) && __wm_bind_16.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_458 = __wm_bind_16[0];
const afterAtom_459 = __wm_bind_16[1];
const result_460 = { statementIds: append_153__wm_d2(scrutinee_449.statementIds, __wm_basis_Cons([statementId_456, __wm_basis_Nil])), atomId: atomId_458, state: afterAtom_459 };
return result_460;
} else if (true) {

return __wm_fail("Panic", "functional match does not have one scrutinee child");
}
__wm_fail("Match", "non-exhaustive match");
};
const lowerMatchValue_440 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return lowerMatchValue_440__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerMatchValueCases_441__wm_d9 = (lower_461, armIds_462, expression_463, scrutineeAtomId_464, joinLocalId_465, scope_466, context_467, state_468, reversedCases_469) => {
__wm_tail_32: while (true) {
{
const __wm_scalar_58_0 = lower_461;
const __wm_scalar_58_1 = armIds_462;
const __wm_scalar_58_2 = expression_463;
const __wm_scalar_58_3 = scrutineeAtomId_464;
const __wm_scalar_58_4 = joinLocalId_465;
const __wm_scalar_58_5 = scope_466;
const __wm_scalar_58_6 = context_467;
const __wm_scalar_58_7 = state_468;
const __wm_scalar_58_8 = reversedCases_469;
if (__wm_scalar_58_1 === __wm_basis_Nil) {
const lower_470 = __wm_scalar_58_0;
const expression_471 = __wm_scalar_58_2;
const scrutineeAtomId_472 = __wm_scalar_58_3;
const joinLocalId_473 = __wm_scalar_58_4;
const scope_474 = __wm_scalar_58_5;
const context_475 = __wm_scalar_58_6;
const state_476 = __wm_scalar_58_7;
const reversedCases_477 = __wm_scalar_58_8;
{
const result_478 = { caseIds: reverseInto_146__wm_d2(reversedCases_477, __wm_basis_Nil), state: state_476 };
return result_478;
}
} else if (__wm_scalar_58_1?.ctor === -6 && __wm_scalar_58_1.args.length === 1 && __wm_is_tuple(__wm_scalar_58_1.args[0]) && __wm_scalar_58_1.args[0].length === 2) {
const lower_479 = __wm_scalar_58_0;
const armId_480 = __wm_scalar_58_1.args[0][0];
const rest_481 = __wm_scalar_58_1.args[0][1];
const expression_482 = __wm_scalar_58_2;
const scrutineeAtomId_483 = __wm_scalar_58_3;
const joinLocalId_484 = __wm_scalar_58_4;
const scope_485 = __wm_scalar_58_5;
const context_486 = __wm_scalar_58_6;
const state_487 = __wm_scalar_58_7;
const reversedCases_488 = __wm_scalar_58_8;
{
const arm_489 = findIrMatchArm_176__wm_d2(context_486.matchArms, armId_480);
const pattern_490 = findPattern_197__wm_d2(context_486.patterns, arm_489.patternId);
const constructor_491 = findConstructor_204__wm_d2(context_486.constructors, pattern_490.constructorId);
const bound_492 = bindMatchPayload_442__wm_d6(pattern_490, scrutineeAtomId_483, expression_482, scope_485, context_486, state_487);
const body_493 = lower_479([arm_489.bodyExprId, bound_492.scope, context_486, bound_492.state]);
const __wm_bind_17 = assignJoin_411__wm_d4(expression_482, joinLocalId_484, body_493.atomId, body_493.state);
if (!(__wm_is_tuple(__wm_bind_17) && __wm_bind_17.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const assignId_494 = __wm_bind_17[0];
const afterAssign_495 = __wm_bind_17[1];
const __wm_bind_18 = pushBlock_307__wm_d3(expression_482.functionId, append_153__wm_d2(bound_492.statementIds, append_153__wm_d2(body_493.statementIds, __wm_basis_Cons([assignId_494, __wm_basis_Nil]))), afterAssign_495);
if (!(__wm_is_tuple(__wm_bind_18) && __wm_bind_18.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const blockId_496 = __wm_bind_18[0];
const afterBlock_497 = __wm_bind_18[1];
const gpuCase_498 = { id: afterBlock_497.nextCaseId, functionId: expression_482.functionId, constructorId: constructor_491.id, tag: constructor_491.tag, blockId: blockId_496, spanId: arm_489.spanId };
const __wm_bind_19 = pushCase_311__wm_d2(gpuCase_498, afterBlock_497);
if (!(__wm_is_tuple(__wm_bind_19) && __wm_bind_19.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const caseId_499 = __wm_bind_19[0];
const afterCase_500 = __wm_bind_19[1];
{
const __wm_tail_arg_37_0 = lower_479;
const __wm_tail_arg_37_1 = rest_481;
const __wm_tail_arg_37_2 = expression_482;
const __wm_tail_arg_37_3 = scrutineeAtomId_483;
const __wm_tail_arg_37_4 = joinLocalId_484;
const __wm_tail_arg_37_5 = scope_485;
const __wm_tail_arg_37_6 = context_486;
const __wm_tail_arg_37_7 = afterCase_500;
const __wm_tail_arg_37_8 = __wm_basis_Cons([caseId_499, reversedCases_488]);
lower_461 = __wm_tail_arg_37_0;
armIds_462 = __wm_tail_arg_37_1;
expression_463 = __wm_tail_arg_37_2;
scrutineeAtomId_464 = __wm_tail_arg_37_3;
joinLocalId_465 = __wm_tail_arg_37_4;
scope_466 = __wm_tail_arg_37_5;
context_467 = __wm_tail_arg_37_6;
state_468 = __wm_tail_arg_37_7;
reversedCases_469 = __wm_tail_arg_37_8;
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
const bindMatchPayload_442__wm_d6 = (pattern_501, scrutineeAtomId_502, owner_503, scope_504, context_505, state_506) => {
const __wm_return_value_23 = Js.Array.toList(pattern_501.children);
if (__wm_return_value_23 === __wm_basis_Nil) {

const result_507 = { statementIds: __wm_basis_Nil, scope: scope_504, state: state_506 };
return result_507;
} else if (__wm_return_value_23?.ctor === -6 && __wm_return_value_23.args.length === 1 && __wm_is_tuple(__wm_return_value_23.args[0]) && __wm_return_value_23.args[0].length === 2 && __wm_return_value_23.args[0][1] === __wm_basis_Nil) {
const childPatternId_508 = __wm_return_value_23.args[0][0];
const child_509 = findPattern_197__wm_d2(context_505.patterns, childPatternId_508);
if (__wm_eq(child_509.kind, "wildcard")) {
const result_510 = { statementIds: __wm_basis_Nil, scope: scope_504, state: state_506 };
return result_510;
} else {
const field_511 = findFieldForConstructor_246__wm_d2(context_505.fields, pattern_501.constructorId);
const operation_512 = { ...baseOperation_290__wm_d3(owner_503, "payload", state_506), typeId: child_509.typeId, constructorId: pattern_501.constructorId, layoutId: field_511.layoutId, fieldId: field_511.id, args: Js.Array.fromList(__wm_basis_Cons([scrutineeAtomId_502, __wm_basis_Nil])) };
const __wm_bind_20 = pushOperation_285__wm_d2(operation_512, state_506);
if (!(__wm_is_tuple(__wm_bind_20) && __wm_bind_20.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_513 = __wm_bind_20[0];
const afterOperation_514 = __wm_bind_20[1];
const __wm_bind_21 = freshLocal_265__wm_d7(owner_503.functionId, "binding", child_509.typeId, child_509.bindingId, false, child_509.spanId, afterOperation_514);
if (!(__wm_is_tuple(__wm_bind_21) && __wm_bind_21.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_515 = __wm_bind_21[0];
const afterLocal_516 = __wm_bind_21[1];
const statement_517 = { ...baseStatement_301__wm_d5(owner_503.functionId, "let", owner_503.sourceExprId, child_509.spanId, afterLocal_516), localId: localId_515, operationId: operationId_513, reason: "binding" };
const __wm_bind_22 = pushStatement_294__wm_d2(statement_517, afterLocal_516);
if (!(__wm_is_tuple(__wm_bind_22) && __wm_bind_22.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_518 = __wm_bind_22[0];
const afterStatement_519 = __wm_bind_22[1];
const nextScope_520 = { ...scope_504, bindings: Map.set([scope_504.bindings, child_509.bindingId, localId_515]) };
const result_521 = { statementIds: __wm_basis_Cons([statementId_518, __wm_basis_Nil]), scope: nextScope_520, state: afterStatement_519 };
return result_521;
}
} else if (true) {

return __wm_fail("Panic", "v1 constructor pattern has multiple payload children");
}
__wm_fail("Match", "non-exhaustive match");
};
const bindMatchPayload_442 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return bindMatchPayload_442__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const operationKind_523 = (__arg) => {
if (true) {
const expression_522 = __arg;
if (__wm_eq(expression_522.kind, "constructor")) {
return "construct";
} else {
return expression_522.kind;
}
}
__wm_fail("Match", "pattern match failure in function");
};
const bindOperation_542__wm_d7 = (expression_524, kind_525, args_526, localKind_527, reason_528, layoutId_529, state_530) => {
const operation_531 = { ...baseOperation_290__wm_d3(expression_524, kind_525, state_530), layoutId: layoutId_529, args: Js.Array.fromList(args_526) };
const __wm_bind_23 = pushOperation_285__wm_d2(operation_531, state_530);
if (!(__wm_is_tuple(__wm_bind_23) && __wm_bind_23.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_532 = __wm_bind_23[0];
const afterOperation_533 = __wm_bind_23[1];
const __wm_bind_24 = freshLocal_265__wm_d7(expression_524.functionId, localKind_527, expression_524.typeId, __wm_op_sub(1), false, expression_524.spanId, afterOperation_533);
if (!(__wm_is_tuple(__wm_bind_24) && __wm_bind_24.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_534 = __wm_bind_24[0];
const afterLocal_535 = __wm_bind_24[1];
const statement_536 = { ...baseStatement_301__wm_d5(expression_524.functionId, "let", expression_524.sourceExprId, expression_524.spanId, afterLocal_535), localId: localId_534, operationId: operationId_532, reason: reason_528 };
const __wm_bind_25 = pushStatement_294__wm_d2(statement_536, afterLocal_535);
if (!(__wm_is_tuple(__wm_bind_25) && __wm_bind_25.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_537 = __wm_bind_25[0];
const afterStatement_538 = __wm_bind_25[1];
const __wm_bind_26 = localAtom_277__wm_d6(expression_524.functionId, expression_524.typeId, expression_524.sourceExprId, expression_524.spanId, localId_534, afterStatement_538);
if (!(__wm_is_tuple(__wm_bind_26) && __wm_bind_26.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_539 = __wm_bind_26[0];
const afterAtom_540 = __wm_bind_26[1];
const result_541 = { statementIds: __wm_basis_Cons([statementId_537, __wm_basis_Nil]), atomId: atomId_539, state: afterAtom_540 };
return result_541;
};
const bindOperation_542 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return bindOperation_542__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const bindSourceOperation_548__wm_d4 = (expression_543, args_544, context_545, state_546) => {
if (__wm_eq(expression_543.kind, "constructor")) {
const layout_547 = findLayoutForType_211__wm_d2(context_545.layouts, expression_543.typeId);
return bindOperation_542__wm_d7(expression_543, "construct", args_544, "temporary", "temporary", layout_547.id, state_546);
} else {
return bindOperation_542__wm_d7(expression_543, operationKind_523(expression_543), args_544, "temporary", "temporary", __wm_op_sub(1), state_546);
}
};
const bindSourceOperation_548 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return bindSourceOperation_548__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerValue_549__wm_d4 = (expressionId_551, scope_552, context_553, state_554) => {
const expression_555 = findIrExpression_169__wm_d2(context_553.expressions, expressionId_551);
if (__wm_op_or_d2(__wm_op_or_d2(__wm_eq(expression_555.kind, "number"), __wm_eq(expression_555.kind, "bool")), __wm_eq(expression_555.kind, "void"))) {
const __wm_bind_27 = literalAtom_281__wm_d2(expression_555, state_554);
if (!(__wm_is_tuple(__wm_bind_27) && __wm_bind_27.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_556 = __wm_bind_27[0];
const next_557 = __wm_bind_27[1];
const result_558 = { statementIds: __wm_basis_Nil, atomId: atomId_556, state: next_557 };
return result_558;
} else {
if (__wm_eq(expression_555.kind, "local")) {
const __wm_return_value_24 = Map.get([scope_552.bindings, expression_555.bindingId]);
if (__wm_return_value_24?.ctor === -2 && __wm_return_value_24.args.length === 1) {
const localId_559 = __wm_return_value_24.args[0];
const __wm_bind_28 = localAtom_277__wm_d6(expression_555.functionId, expression_555.typeId, expression_555.sourceExprId, expression_555.spanId, localId_559, state_554);
if (!(__wm_is_tuple(__wm_bind_28) && __wm_bind_28.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_560 = __wm_bind_28[0];
const next_561 = __wm_bind_28[1];
const result_562 = { statementIds: __wm_basis_Nil, atomId: atomId_560, state: next_561 };
return result_562;
} else if (__wm_return_value_24 === __wm_basis_None) {

return __wm_fail("Panic", "lowered local has no lexical binding");
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_eq(expression_555.kind, "let")) {
return lowerLetValue_328__wm_d5(lowerValue_549, expression_555, scope_552, context_553, state_554);
} else {
if (__wm_eq(expression_555.kind, "sequence")) {
return lowerSequenceValue_329__wm_d5(lowerValue_549, expression_555, scope_552, context_553, state_554);
} else {
if (__wm_eq(expression_555.kind, "if")) {
return lowerIfValue_439__wm_d5(lowerValue_549, expression_555, scope_552, context_553, state_554);
} else {
if (__wm_eq(expression_555.kind, "match")) {
return lowerMatchValue_440__wm_d5(lowerValue_549, expression_555, scope_552, context_553, state_554);
} else {
if (__wm_eq(expression_555.kind, "tail-call")) {
return __wm_fail("Panic", "tail-call reached a value context");
} else {
const children_563 = lowerChildren_550__wm_d6(Js.Array.toList(expression_555.children), scope_552, context_553, state_554, __wm_basis_Nil, __wm_basis_Nil);
const value_564 = bindSourceOperation_548__wm_d4(expression_555, children_563.atomIds, context_553, children_563.state);
const result_565 = { statementIds: append_153__wm_d2(children_563.statementIds, value_564.statementIds), atomId: value_564.atomId, state: value_564.state };
return result_565;
}
}
}
}
}
}
}
};
const lowerValue_549 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return lowerValue_549__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerChildren_550__wm_d6 = (expressionIds_566, scope_567, context_568, state_569, reversedStatements_570, reversedAtoms_571) => {
__wm_tail_33: while (true) {
{
const __wm_scalar_59_0 = expressionIds_566;
const __wm_scalar_59_1 = scope_567;
const __wm_scalar_59_2 = context_568;
const __wm_scalar_59_3 = state_569;
const __wm_scalar_59_4 = reversedStatements_570;
const __wm_scalar_59_5 = reversedAtoms_571;
if (__wm_scalar_59_0 === __wm_basis_Nil) {
const scope_572 = __wm_scalar_59_1;
const context_573 = __wm_scalar_59_2;
const state_574 = __wm_scalar_59_3;
const reversedStatements_575 = __wm_scalar_59_4;
const reversedAtoms_576 = __wm_scalar_59_5;
{
const result_577 = { statementIds: reverseInto_146__wm_d2(reversedStatements_575, __wm_basis_Nil), atomIds: reverseInto_146__wm_d2(reversedAtoms_576, __wm_basis_Nil), state: state_574 };
return result_577;
}
} else if (__wm_scalar_59_0?.ctor === -6 && __wm_scalar_59_0.args.length === 1 && __wm_is_tuple(__wm_scalar_59_0.args[0]) && __wm_scalar_59_0.args[0].length === 2) {
const expressionId_578 = __wm_scalar_59_0.args[0][0];
const rest_579 = __wm_scalar_59_0.args[0][1];
const scope_580 = __wm_scalar_59_1;
const context_581 = __wm_scalar_59_2;
const state_582 = __wm_scalar_59_3;
const reversedStatements_583 = __wm_scalar_59_4;
const reversedAtoms_584 = __wm_scalar_59_5;
{
const value_585 = lowerValue_549__wm_d4(expressionId_578, scope_580, context_581, state_582);
{
const __wm_tail_arg_38_0 = rest_579;
const __wm_tail_arg_38_1 = scope_580;
const __wm_tail_arg_38_2 = context_581;
const __wm_tail_arg_38_3 = value_585.state;
const __wm_tail_arg_38_4 = reverseInto_146__wm_d2(value_585.statementIds, reversedStatements_583);
const __wm_tail_arg_38_5 = __wm_basis_Cons([value_585.atomId, reversedAtoms_584]);
expressionIds_566 = __wm_tail_arg_38_0;
scope_567 = __wm_tail_arg_38_1;
context_568 = __wm_tail_arg_38_2;
state_569 = __wm_tail_arg_38_3;
reversedStatements_570 = __wm_tail_arg_38_4;
reversedAtoms_571 = __wm_tail_arg_38_5;
continue __wm_tail_33;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const lowerChildren_550 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return lowerChildren_550__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const returnStatement_590__wm_d3 = (expression_586, atomId_587, state_588) => {
const statement_589 = { ...baseStatement_301__wm_d5(expression_586.functionId, "return", expression_586.sourceExprId, expression_586.spanId, state_588), atomId: atomId_587 };
return pushStatement_294__wm_d2(statement_589, state_588);
};
const returnStatement_590 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return returnStatement_590__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerTail_591__wm_d4 = (expressionId_597, scope_598, context_599, state_600) => {
const expression_601 = findIrExpression_169__wm_d2(context_599.expressions, expressionId_597);
if (__wm_eq(expression_601.kind, "tail-call")) {
return lowerTailCall_595__wm_d4(expression_601, scope_598, context_599, state_600);
} else {
if (__wm_eq(expression_601.kind, "let")) {
const __wm_return_value_25 = Js.Array.toList(expression_601.children);
if (__wm_return_value_25?.ctor === -6 && __wm_return_value_25.args.length === 1 && __wm_is_tuple(__wm_return_value_25.args[0]) && __wm_return_value_25.args[0].length === 2 && __wm_return_value_25.args[0][1]?.ctor === -6 && __wm_return_value_25.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_25.args[0][1].args[0]) && __wm_return_value_25.args[0][1].args[0].length === 2 && __wm_return_value_25.args[0][1].args[0][1] === __wm_basis_Nil) {
const valueExpressionId_602 = __wm_return_value_25.args[0][0];
const bodyExpressionId_603 = __wm_return_value_25.args[0][1].args[0][0];
const value_604 = lowerValue_549__wm_d4(valueExpressionId_602, scope_598, context_599, state_600);
const bound_605 = bindPattern_330__wm_d6(expression_601.patternId, value_604.atomId, expression_601, scope_598, context_599, value_604.state);
const body_606 = lowerTail_591__wm_d4(bodyExpressionId_603, bound_605.scope, context_599, bound_605.state);
const result_607 = { statementIds: append_153__wm_d2(value_604.statementIds, append_153__wm_d2(bound_605.statementIds, body_606.statementIds)), state: body_606.state };
return result_607;
} else if (true) {

return __wm_fail("Panic", "tail-position let does not have value and body children");
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_eq(expression_601.kind, "sequence")) {
const __wm_return_value_26 = Js.Array.toList(expression_601.children);
if (__wm_return_value_26?.ctor === -6 && __wm_return_value_26.args.length === 1 && __wm_is_tuple(__wm_return_value_26.args[0]) && __wm_return_value_26.args[0].length === 2 && __wm_return_value_26.args[0][1]?.ctor === -6 && __wm_return_value_26.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_26.args[0][1].args[0]) && __wm_return_value_26.args[0][1].args[0].length === 2 && __wm_return_value_26.args[0][1].args[0][1] === __wm_basis_Nil) {
const discardedExpressionId_608 = __wm_return_value_26.args[0][0];
const bodyExpressionId_609 = __wm_return_value_26.args[0][1].args[0][0];
const discarded_610 = lowerValue_549__wm_d4(discardedExpressionId_608, scope_598, context_599, state_600);
const body_611 = lowerTail_591__wm_d4(bodyExpressionId_609, scope_598, context_599, discarded_610.state);
const result_612 = { statementIds: append_153__wm_d2(discarded_610.statementIds, body_611.statementIds), state: body_611.state };
return result_612;
} else if (true) {

return __wm_fail("Panic", "tail-position sequence does not have two children");
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_eq(expression_601.kind, "if")) {
return lowerTailIf_592__wm_d4(expression_601, scope_598, context_599, state_600);
} else {
if (__wm_eq(expression_601.kind, "match")) {
return lowerTailMatch_593__wm_d4(expression_601, scope_598, context_599, state_600);
} else {
const value_613 = lowerValue_549__wm_d4(expressionId_597, scope_598, context_599, state_600);
const __wm_bind_29 = returnStatement_590__wm_d3(expression_601, value_613.atomId, value_613.state);
if (!(__wm_is_tuple(__wm_bind_29) && __wm_bind_29.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const returnId_614 = __wm_bind_29[0];
const afterReturn_615 = __wm_bind_29[1];
const result_616 = { statementIds: append_153__wm_d2(value_613.statementIds, __wm_basis_Cons([returnId_614, __wm_basis_Nil])), state: afterReturn_615 };
return result_616;
}
}
}
}
}
};
const lowerTail_591 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return lowerTail_591__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerTailIf_592__wm_d4 = (expression_617, scope_618, context_619, state_620) => {
const __wm_return_value_27 = Js.Array.toList(expression_617.children);
if (__wm_return_value_27?.ctor === -6 && __wm_return_value_27.args.length === 1 && __wm_is_tuple(__wm_return_value_27.args[0]) && __wm_return_value_27.args[0].length === 2 && __wm_return_value_27.args[0][1]?.ctor === -6 && __wm_return_value_27.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_27.args[0][1].args[0]) && __wm_return_value_27.args[0][1].args[0].length === 2 && __wm_return_value_27.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_27.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_27.args[0][1].args[0][1].args[0]) && __wm_return_value_27.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_27.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const conditionExpressionId_621 = __wm_return_value_27.args[0][0];
const thenExpressionId_622 = __wm_return_value_27.args[0][1].args[0][0];
const elseExpressionId_623 = __wm_return_value_27.args[0][1].args[0][1].args[0][0];
const condition_624 = lowerValue_549__wm_d4(conditionExpressionId_621, scope_618, context_619, state_620);
const thenTail_625 = lowerTail_591__wm_d4(thenExpressionId_622, scope_618, context_619, condition_624.state);
const __wm_bind_30 = pushBlock_307__wm_d3(expression_617.functionId, thenTail_625.statementIds, thenTail_625.state);
if (!(__wm_is_tuple(__wm_bind_30) && __wm_bind_30.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const thenBlockId_626 = __wm_bind_30[0];
const afterThen_627 = __wm_bind_30[1];
const elseTail_628 = lowerTail_591__wm_d4(elseExpressionId_623, scope_618, context_619, afterThen_627);
const __wm_bind_31 = pushBlock_307__wm_d3(expression_617.functionId, elseTail_628.statementIds, elseTail_628.state);
if (!(__wm_is_tuple(__wm_bind_31) && __wm_bind_31.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const elseBlockId_629 = __wm_bind_31[0];
const afterElse_630 = __wm_bind_31[1];
const statement_631 = { ...baseStatement_301__wm_d5(expression_617.functionId, "if", expression_617.sourceExprId, expression_617.spanId, afterElse_630), conditionAtomId: condition_624.atomId, thenBlockId: thenBlockId_626, elseBlockId: elseBlockId_629 };
const __wm_bind_32 = pushStatement_294__wm_d2(statement_631, afterElse_630);
if (!(__wm_is_tuple(__wm_bind_32) && __wm_bind_32.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_632 = __wm_bind_32[0];
const afterIf_633 = __wm_bind_32[1];
const result_634 = { statementIds: append_153__wm_d2(condition_624.statementIds, __wm_basis_Cons([statementId_632, __wm_basis_Nil])), state: afterIf_633 };
return result_634;
} else if (true) {

return __wm_fail("Panic", "tail-position if does not have three children");
}
__wm_fail("Match", "non-exhaustive match");
};
const lowerTailIf_592 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return lowerTailIf_592__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerTailMatch_593__wm_d4 = (expression_635, scope_636, context_637, state_638) => {
const __wm_return_value_28 = Js.Array.toList(expression_635.children);
if (__wm_return_value_28?.ctor === -6 && __wm_return_value_28.args.length === 1 && __wm_is_tuple(__wm_return_value_28.args[0]) && __wm_return_value_28.args[0].length === 2 && __wm_return_value_28.args[0][1] === __wm_basis_Nil) {
const scrutineeExpressionId_639 = __wm_return_value_28.args[0][0];
const scrutinee_640 = lowerValue_549__wm_d4(scrutineeExpressionId_639, scope_636, context_637, state_638);
const scrutineeExpression_641 = findIrExpression_169__wm_d2(context_637.expressions, scrutineeExpressionId_639);
const layout_642 = findLayoutForType_211__wm_d2(context_637.layouts, scrutineeExpression_641.typeId);
const cases_643 = lowerTailMatchCases_594__wm_d7(Js.Array.toList(expression_635.armIds), expression_635, scrutinee_640.atomId, scope_636, context_637, scrutinee_640.state, __wm_basis_Nil);
const statement_644 = { ...baseStatement_301__wm_d5(expression_635.functionId, "switch", expression_635.sourceExprId, expression_635.spanId, cases_643.state), scrutineeAtomId: scrutinee_640.atomId, layoutId: layout_642.id, caseIds: Js.Array.fromList(cases_643.caseIds) };
const __wm_bind_33 = pushStatement_294__wm_d2(statement_644, cases_643.state);
if (!(__wm_is_tuple(__wm_bind_33) && __wm_bind_33.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_645 = __wm_bind_33[0];
const afterSwitch_646 = __wm_bind_33[1];
const result_647 = { statementIds: append_153__wm_d2(scrutinee_640.statementIds, __wm_basis_Cons([statementId_645, __wm_basis_Nil])), state: afterSwitch_646 };
return result_647;
} else if (true) {

return __wm_fail("Panic", "tail-position match does not have one scrutinee");
}
__wm_fail("Match", "non-exhaustive match");
};
const lowerTailMatch_593 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return lowerTailMatch_593__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerTailMatchCases_594__wm_d7 = (armIds_648, expression_649, scrutineeAtomId_650, scope_651, context_652, state_653, reversedCases_654) => {
__wm_tail_34: while (true) {
{
const __wm_scalar_60_0 = armIds_648;
const __wm_scalar_60_1 = expression_649;
const __wm_scalar_60_2 = scrutineeAtomId_650;
const __wm_scalar_60_3 = scope_651;
const __wm_scalar_60_4 = context_652;
const __wm_scalar_60_5 = state_653;
const __wm_scalar_60_6 = reversedCases_654;
if (__wm_scalar_60_0 === __wm_basis_Nil) {
const expression_655 = __wm_scalar_60_1;
const scrutineeAtomId_656 = __wm_scalar_60_2;
const scope_657 = __wm_scalar_60_3;
const context_658 = __wm_scalar_60_4;
const state_659 = __wm_scalar_60_5;
const reversedCases_660 = __wm_scalar_60_6;
{
const result_661 = { caseIds: reverseInto_146__wm_d2(reversedCases_660, __wm_basis_Nil), state: state_659 };
return result_661;
}
} else if (__wm_scalar_60_0?.ctor === -6 && __wm_scalar_60_0.args.length === 1 && __wm_is_tuple(__wm_scalar_60_0.args[0]) && __wm_scalar_60_0.args[0].length === 2) {
const armId_662 = __wm_scalar_60_0.args[0][0];
const rest_663 = __wm_scalar_60_0.args[0][1];
const expression_664 = __wm_scalar_60_1;
const scrutineeAtomId_665 = __wm_scalar_60_2;
const scope_666 = __wm_scalar_60_3;
const context_667 = __wm_scalar_60_4;
const state_668 = __wm_scalar_60_5;
const reversedCases_669 = __wm_scalar_60_6;
{
const arm_670 = findIrMatchArm_176__wm_d2(context_667.matchArms, armId_662);
const pattern_671 = findPattern_197__wm_d2(context_667.patterns, arm_670.patternId);
const constructor_672 = findConstructor_204__wm_d2(context_667.constructors, pattern_671.constructorId);
const bound_673 = bindMatchPayload_442__wm_d6(pattern_671, scrutineeAtomId_665, expression_664, scope_666, context_667, state_668);
const body_674 = lowerTail_591__wm_d4(arm_670.bodyExprId, bound_673.scope, context_667, bound_673.state);
const __wm_bind_34 = pushBlock_307__wm_d3(expression_664.functionId, append_153__wm_d2(bound_673.statementIds, body_674.statementIds), body_674.state);
if (!(__wm_is_tuple(__wm_bind_34) && __wm_bind_34.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const blockId_675 = __wm_bind_34[0];
const afterBlock_676 = __wm_bind_34[1];
const gpuCase_677 = { id: afterBlock_676.nextCaseId, functionId: expression_664.functionId, constructorId: constructor_672.id, tag: constructor_672.tag, blockId: blockId_675, spanId: arm_670.spanId };
const __wm_bind_35 = pushCase_311__wm_d2(gpuCase_677, afterBlock_676);
if (!(__wm_is_tuple(__wm_bind_35) && __wm_bind_35.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const caseId_678 = __wm_bind_35[0];
const afterCase_679 = __wm_bind_35[1];
{
const __wm_tail_arg_39_0 = rest_663;
const __wm_tail_arg_39_1 = expression_664;
const __wm_tail_arg_39_2 = scrutineeAtomId_665;
const __wm_tail_arg_39_3 = scope_666;
const __wm_tail_arg_39_4 = context_667;
const __wm_tail_arg_39_5 = afterCase_679;
const __wm_tail_arg_39_6 = __wm_basis_Cons([caseId_678, reversedCases_669]);
armIds_648 = __wm_tail_arg_39_0;
expression_649 = __wm_tail_arg_39_1;
scrutineeAtomId_650 = __wm_tail_arg_39_2;
scope_651 = __wm_tail_arg_39_3;
context_652 = __wm_tail_arg_39_4;
state_653 = __wm_tail_arg_39_5;
reversedCases_654 = __wm_tail_arg_39_6;
continue __wm_tail_34;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const lowerTailMatchCases_594 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return lowerTailMatchCases_594__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerTailCall_595__wm_d4 = (expression_680, scope_681, context_682, state_683) => {
const children_684 = lowerChildren_550__wm_d6(Js.Array.toList(expression_680.children), scope_681, context_682, state_683, __wm_basis_Nil, __wm_basis_Nil);
const nextValues_685 = materializeTailNext_596__wm_d5(children_684.atomIds, expression_680, children_684.state, __wm_basis_Nil, __wm_basis_Nil);
const statement_686 = { ...baseStatement_301__wm_d5(expression_680.functionId, "continue", expression_680.sourceExprId, expression_680.spanId, nextValues_685.state), targetLocalIds: Js.Array.fromList(scope_681.loopParamLocalIds), valueAtomIds: Js.Array.fromList(nextValues_685.atomIds) };
const __wm_bind_36 = pushStatement_294__wm_d2(statement_686, nextValues_685.state);
if (!(__wm_is_tuple(__wm_bind_36) && __wm_bind_36.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_687 = __wm_bind_36[0];
const afterContinue_688 = __wm_bind_36[1];
const result_689 = { statementIds: append_153__wm_d2(children_684.statementIds, append_153__wm_d2(nextValues_685.statementIds, __wm_basis_Cons([statementId_687, __wm_basis_Nil]))), state: afterContinue_688 };
return result_689;
};
const lowerTailCall_595 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return lowerTailCall_595__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const materializeTailNext_596__wm_d5 = (atomIds_690, expression_691, state_692, reversedStatements_693, reversedAtoms_694) => {
__wm_tail_35: while (true) {
{
const __wm_scalar_61_0 = atomIds_690;
const __wm_scalar_61_1 = expression_691;
const __wm_scalar_61_2 = state_692;
const __wm_scalar_61_3 = reversedStatements_693;
const __wm_scalar_61_4 = reversedAtoms_694;
if (__wm_scalar_61_0 === __wm_basis_Nil) {
const expression_695 = __wm_scalar_61_1;
const state_696 = __wm_scalar_61_2;
const reversedStatements_697 = __wm_scalar_61_3;
const reversedAtoms_698 = __wm_scalar_61_4;
{
const result_699 = { statementIds: reverseInto_146__wm_d2(reversedStatements_697, __wm_basis_Nil), atomIds: reverseInto_146__wm_d2(reversedAtoms_698, __wm_basis_Nil), state: state_696 };
return result_699;
}
} else if (__wm_scalar_61_0?.ctor === -6 && __wm_scalar_61_0.args.length === 1 && __wm_is_tuple(__wm_scalar_61_0.args[0]) && __wm_scalar_61_0.args[0].length === 2) {
const atomId_700 = __wm_scalar_61_0.args[0][0];
const rest_701 = __wm_scalar_61_0.args[0][1];
const expression_702 = __wm_scalar_61_1;
const state_703 = __wm_scalar_61_2;
const reversedStatements_704 = __wm_scalar_61_3;
const reversedAtoms_705 = __wm_scalar_61_4;
{
const atom_706 = findLoweredAtom_183__wm_d2(state_703.atoms, atomId_700);
const operation_707 = { ...baseOperation_290__wm_d3(expression_702, "copy", state_703), typeId: atom_706.typeId, targetFunctionId: __wm_op_sub(1), args: Js.Array.fromList(__wm_basis_Cons([atomId_700, __wm_basis_Nil])) };
const __wm_bind_37 = pushOperation_285__wm_d2(operation_707, state_703);
if (!(__wm_is_tuple(__wm_bind_37) && __wm_bind_37.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_708 = __wm_bind_37[0];
const afterOperation_709 = __wm_bind_37[1];
const __wm_bind_38 = freshLocal_265__wm_d7(expression_702.functionId, "tail-next", atom_706.typeId, __wm_op_sub(1), false, expression_702.spanId, afterOperation_709);
if (!(__wm_is_tuple(__wm_bind_38) && __wm_bind_38.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_710 = __wm_bind_38[0];
const afterLocal_711 = __wm_bind_38[1];
const statement_712 = { ...baseStatement_301__wm_d5(expression_702.functionId, "let", expression_702.sourceExprId, expression_702.spanId, afterLocal_711), localId: localId_710, operationId: operationId_708, reason: "tail-next" };
const __wm_bind_39 = pushStatement_294__wm_d2(statement_712, afterLocal_711);
if (!(__wm_is_tuple(__wm_bind_39) && __wm_bind_39.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const statementId_713 = __wm_bind_39[0];
const afterStatement_714 = __wm_bind_39[1];
const __wm_bind_40 = localAtom_277__wm_d6(expression_702.functionId, atom_706.typeId, expression_702.sourceExprId, expression_702.spanId, localId_710, afterStatement_714);
if (!(__wm_is_tuple(__wm_bind_40) && __wm_bind_40.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextAtomId_715 = __wm_bind_40[0];
const afterAtom_716 = __wm_bind_40[1];
{
const __wm_tail_arg_40_0 = rest_701;
const __wm_tail_arg_40_1 = expression_702;
const __wm_tail_arg_40_2 = afterAtom_716;
const __wm_tail_arg_40_3 = __wm_basis_Cons([statementId_713, reversedStatements_704]);
const __wm_tail_arg_40_4 = __wm_basis_Cons([nextAtomId_715, reversedAtoms_705]);
atomIds_690 = __wm_tail_arg_40_0;
expression_691 = __wm_tail_arg_40_1;
state_692 = __wm_tail_arg_40_2;
reversedStatements_693 = __wm_tail_arg_40_3;
reversedAtoms_694 = __wm_tail_arg_40_4;
continue __wm_tail_35;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const materializeTailNext_596 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return materializeTailNext_596__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const setupParameters_717__wm_d7 = (paramIds_718, functionId_719, context_720, scope_721, state_722, reversedPhysicalIds_723, reversedStatements_724) => {
__wm_tail_36: while (true) {
{
const __wm_scalar_62_0 = paramIds_718;
const __wm_scalar_62_1 = functionId_719;
const __wm_scalar_62_2 = context_720;
const __wm_scalar_62_3 = scope_721;
const __wm_scalar_62_4 = state_722;
const __wm_scalar_62_5 = reversedPhysicalIds_723;
const __wm_scalar_62_6 = reversedStatements_724;
if (__wm_scalar_62_0 === __wm_basis_Nil) {
const functionId_725 = __wm_scalar_62_1;
const context_726 = __wm_scalar_62_2;
const scope_727 = __wm_scalar_62_3;
const state_728 = __wm_scalar_62_4;
const reversedPhysicalIds_729 = __wm_scalar_62_5;
const reversedStatements_730 = __wm_scalar_62_6;
{
const result_731 = { physicalLocalIds: reverseInto_146__wm_d2(reversedPhysicalIds_729, __wm_basis_Nil), activeLocalIds: reverseInto_146__wm_d2(reversedPhysicalIds_729, __wm_basis_Nil), initialStatementIds: reverseInto_146__wm_d2(reversedStatements_730, __wm_basis_Nil), iterationStatementIds: __wm_basis_Nil, scope: scope_727, state: state_728 };
return result_731;
}
} else if (__wm_scalar_62_0?.ctor === -6 && __wm_scalar_62_0.args.length === 1 && __wm_is_tuple(__wm_scalar_62_0.args[0]) && __wm_scalar_62_0.args[0].length === 2) {
const paramId_732 = __wm_scalar_62_0.args[0][0];
const rest_733 = __wm_scalar_62_0.args[0][1];
const functionId_734 = __wm_scalar_62_1;
const context_735 = __wm_scalar_62_2;
const scope_736 = __wm_scalar_62_3;
const state_737 = __wm_scalar_62_4;
const reversedPhysicalIds_738 = __wm_scalar_62_5;
const reversedStatements_739 = __wm_scalar_62_6;
{
const param_740 = findParam_190__wm_d2(context_735.params, paramId_732);
const pattern_741 = findPattern_197__wm_d2(context_735.patterns, param_740.patternId);
const bindingId_742 = (__wm_eq(pattern_741.kind, "binding") ? pattern_741.bindingId : __wm_op_sub(1));
const __wm_bind_41 = freshLocal_265__wm_d7(functionId_734, "parameter", param_740.typeId, bindingId_742, false, param_740.spanId, state_737);
if (!(__wm_is_tuple(__wm_bind_41) && __wm_bind_41.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const localId_743 = __wm_bind_41[0];
const afterLocal_744 = __wm_bind_41[1];
const __wm_bind_42 = localAtom_277__wm_d6(functionId_734, param_740.typeId, __wm_op_sub(1), param_740.spanId, localId_743, afterLocal_744);
if (!(__wm_is_tuple(__wm_bind_42) && __wm_bind_42.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const atomId_745 = __wm_bind_42[0];
const afterAtom_746 = __wm_bind_42[1];
if (__wm_eq(pattern_741.kind, "binding")) {
{
const nextScope_747 = { ...scope_736, bindings: Map.set([scope_736.bindings, pattern_741.bindingId, localId_743]) };
{
const __wm_tail_arg_41_0 = rest_733;
const __wm_tail_arg_41_1 = functionId_734;
const __wm_tail_arg_41_2 = context_735;
const __wm_tail_arg_41_3 = nextScope_747;
const __wm_tail_arg_41_4 = afterAtom_746;
const __wm_tail_arg_41_5 = __wm_basis_Cons([localId_743, reversedPhysicalIds_738]);
const __wm_tail_arg_41_6 = reversedStatements_739;
paramIds_718 = __wm_tail_arg_41_0;
functionId_719 = __wm_tail_arg_41_1;
context_720 = __wm_tail_arg_41_2;
scope_721 = __wm_tail_arg_41_3;
state_722 = __wm_tail_arg_41_4;
reversedPhysicalIds_723 = __wm_tail_arg_41_5;
reversedStatements_724 = __wm_tail_arg_41_6;
continue __wm_tail_36;
}
}
} else {
{
const fn_748 = findIrFunction_162__wm_d2(context_735.functions, functionId_734);
const owner_749 = findIrExpression_169__wm_d2(context_735.expressions, fn_748.bodyExprId);
const bound_750 = bindPattern_330__wm_d6(pattern_741.id, atomId_745, owner_749, scope_736, context_735, afterAtom_746);
{
const __wm_tail_arg_42_0 = rest_733;
const __wm_tail_arg_42_1 = functionId_734;
const __wm_tail_arg_42_2 = context_735;
const __wm_tail_arg_42_3 = bound_750.scope;
const __wm_tail_arg_42_4 = bound_750.state;
const __wm_tail_arg_42_5 = __wm_basis_Cons([localId_743, reversedPhysicalIds_738]);
const __wm_tail_arg_42_6 = reverseInto_146__wm_d2(bound_750.statementIds, reversedStatements_739);
paramIds_718 = __wm_tail_arg_42_0;
functionId_719 = __wm_tail_arg_42_1;
context_720 = __wm_tail_arg_42_2;
scope_721 = __wm_tail_arg_42_3;
state_722 = __wm_tail_arg_42_4;
reversedPhysicalIds_723 = __wm_tail_arg_42_5;
reversedStatements_724 = __wm_tail_arg_42_6;
continue __wm_tail_36;
}
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const setupParameters_717 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return setupParameters_717__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerNonrecursiveFunction_762__wm_d3 = (fn_751, context_752, state_753) => {
const params_754 = setupParameters_717__wm_d7(Js.Array.toList(fn_751.paramIds), fn_751.functionId, context_752, emptyScope_327(undefined), state_753, __wm_basis_Nil, __wm_basis_Nil);
const body_755 = lowerValue_549__wm_d4(fn_751.bodyExprId, params_754.scope, context_752, params_754.state);
const bodyExpression_756 = findIrExpression_169__wm_d2(context_752.expressions, fn_751.bodyExprId);
const __wm_bind_43 = returnStatement_590__wm_d3(bodyExpression_756, body_755.atomId, body_755.state);
if (!(__wm_is_tuple(__wm_bind_43) && __wm_bind_43.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const returnId_757 = __wm_bind_43[0];
const afterReturn_758 = __wm_bind_43[1];
const __wm_bind_44 = pushBlock_307__wm_d3(fn_751.functionId, append_153__wm_d2(params_754.initialStatementIds, append_153__wm_d2(body_755.statementIds, __wm_basis_Cons([returnId_757, __wm_basis_Nil]))), afterReturn_758);
if (!(__wm_is_tuple(__wm_bind_44) && __wm_bind_44.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const blockId_759 = __wm_bind_44[0];
const afterBlock_760 = __wm_bind_44[1];
const lowered_761 = { functionId: fn_751.functionId, physicalParamLocalIds: Js.Array.fromList(params_754.physicalLocalIds), loopParamLocalIds: Js.Array.fromList(__wm_basis_Nil), bodyBlockId: blockId_759, recursive: false, spanId: fn_751.spanId };
return pushFunction_315__wm_d2(lowered_761, afterBlock_760);
};
const lowerNonrecursiveFunction_762 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return lowerNonrecursiveFunction_762__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setupRecursiveParameters_763__wm_d9 = (paramIds_764, fn_765, context_766, scope_767, state_768, reversedPhysicalIds_769, reversedLoopIds_770, reversedInitialStatements_771, reversedIterationStatements_772) => {
__wm_tail_37: while (true) {
{
const __wm_scalar_63_0 = paramIds_764;
const __wm_scalar_63_1 = fn_765;
const __wm_scalar_63_2 = context_766;
const __wm_scalar_63_3 = scope_767;
const __wm_scalar_63_4 = state_768;
const __wm_scalar_63_5 = reversedPhysicalIds_769;
const __wm_scalar_63_6 = reversedLoopIds_770;
const __wm_scalar_63_7 = reversedInitialStatements_771;
const __wm_scalar_63_8 = reversedIterationStatements_772;
if (__wm_scalar_63_0 === __wm_basis_Nil) {
const fn_773 = __wm_scalar_63_1;
const context_774 = __wm_scalar_63_2;
const scope_775 = __wm_scalar_63_3;
const state_776 = __wm_scalar_63_4;
const reversedPhysicalIds_777 = __wm_scalar_63_5;
const reversedLoopIds_778 = __wm_scalar_63_6;
const reversedInitialStatements_779 = __wm_scalar_63_7;
const reversedIterationStatements_780 = __wm_scalar_63_8;
{
const loopIds_781 = reverseInto_146__wm_d2(reversedLoopIds_778, __wm_basis_Nil);
const nextScope_782 = { ...scope_775, loopParamLocalIds: loopIds_781 };
const result_783 = { physicalLocalIds: reverseInto_146__wm_d2(reversedPhysicalIds_777, __wm_basis_Nil), activeLocalIds: loopIds_781, initialStatementIds: reverseInto_146__wm_d2(reversedInitialStatements_779, __wm_basis_Nil), iterationStatementIds: reverseInto_146__wm_d2(reversedIterationStatements_780, __wm_basis_Nil), scope: nextScope_782, state: state_776 };
return result_783;
}
} else if (__wm_scalar_63_0?.ctor === -6 && __wm_scalar_63_0.args.length === 1 && __wm_is_tuple(__wm_scalar_63_0.args[0]) && __wm_scalar_63_0.args[0].length === 2) {
const paramId_784 = __wm_scalar_63_0.args[0][0];
const rest_785 = __wm_scalar_63_0.args[0][1];
const fn_786 = __wm_scalar_63_1;
const context_787 = __wm_scalar_63_2;
const scope_788 = __wm_scalar_63_3;
const state_789 = __wm_scalar_63_4;
const reversedPhysicalIds_790 = __wm_scalar_63_5;
const reversedLoopIds_791 = __wm_scalar_63_6;
const reversedInitialStatements_792 = __wm_scalar_63_7;
const reversedIterationStatements_793 = __wm_scalar_63_8;
{
const param_794 = findParam_190__wm_d2(context_787.params, paramId_784);
const pattern_795 = findPattern_197__wm_d2(context_787.patterns, param_794.patternId);
const bindingId_796 = (__wm_eq(pattern_795.kind, "binding") ? pattern_795.bindingId : __wm_op_sub(1));
const owner_797 = findIrExpression_169__wm_d2(context_787.expressions, fn_786.bodyExprId);
const __wm_bind_45 = freshLocal_265__wm_d7(fn_786.functionId, "parameter", param_794.typeId, bindingId_796, false, param_794.spanId, state_789);
if (!(__wm_is_tuple(__wm_bind_45) && __wm_bind_45.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const physicalId_798 = __wm_bind_45[0];
const afterPhysical_799 = __wm_bind_45[1];
const __wm_bind_46 = localAtom_277__wm_d6(fn_786.functionId, param_794.typeId, __wm_op_sub(1), param_794.spanId, physicalId_798, afterPhysical_799);
if (!(__wm_is_tuple(__wm_bind_46) && __wm_bind_46.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const physicalAtomId_800 = __wm_bind_46[0];
const afterPhysicalAtom_801 = __wm_bind_46[1];
const operation_802 = { ...baseOperation_290__wm_d3(owner_797, "copy", afterPhysicalAtom_801), typeId: param_794.typeId, args: Js.Array.fromList(__wm_basis_Cons([physicalAtomId_800, __wm_basis_Nil])) };
const __wm_bind_47 = pushOperation_285__wm_d2(operation_802, afterPhysicalAtom_801);
if (!(__wm_is_tuple(__wm_bind_47) && __wm_bind_47.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const operationId_803 = __wm_bind_47[0];
const afterOperation_804 = __wm_bind_47[1];
const __wm_bind_48 = freshLocal_265__wm_d7(fn_786.functionId, "loop-parameter", param_794.typeId, bindingId_796, true, param_794.spanId, afterOperation_804);
if (!(__wm_is_tuple(__wm_bind_48) && __wm_bind_48.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const loopId_805 = __wm_bind_48[0];
const afterLoopLocal_806 = __wm_bind_48[1];
const initial_807 = { ...baseStatement_301__wm_d5(fn_786.functionId, "let", owner_797.sourceExprId, param_794.spanId, afterLoopLocal_806), localId: loopId_805, operationId: operationId_803, reason: "loop-initial" };
const __wm_bind_49 = pushStatement_294__wm_d2(initial_807, afterLoopLocal_806);
if (!(__wm_is_tuple(__wm_bind_49) && __wm_bind_49.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const initialId_808 = __wm_bind_49[0];
const afterInitial_809 = __wm_bind_49[1];
const __wm_bind_50 = localAtom_277__wm_d6(fn_786.functionId, param_794.typeId, owner_797.sourceExprId, param_794.spanId, loopId_805, afterInitial_809);
if (!(__wm_is_tuple(__wm_bind_50) && __wm_bind_50.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const loopAtomId_810 = __wm_bind_50[0];
const afterLoopAtom_811 = __wm_bind_50[1];
if (__wm_eq(pattern_795.kind, "binding")) {
{
const nextScope_812 = { ...scope_788, bindings: Map.set([scope_788.bindings, pattern_795.bindingId, loopId_805]) };
{
const __wm_tail_arg_43_0 = rest_785;
const __wm_tail_arg_43_1 = fn_786;
const __wm_tail_arg_43_2 = context_787;
const __wm_tail_arg_43_3 = nextScope_812;
const __wm_tail_arg_43_4 = afterLoopAtom_811;
const __wm_tail_arg_43_5 = __wm_basis_Cons([physicalId_798, reversedPhysicalIds_790]);
const __wm_tail_arg_43_6 = __wm_basis_Cons([loopId_805, reversedLoopIds_791]);
const __wm_tail_arg_43_7 = __wm_basis_Cons([initialId_808, reversedInitialStatements_792]);
const __wm_tail_arg_43_8 = reversedIterationStatements_793;
paramIds_764 = __wm_tail_arg_43_0;
fn_765 = __wm_tail_arg_43_1;
context_766 = __wm_tail_arg_43_2;
scope_767 = __wm_tail_arg_43_3;
state_768 = __wm_tail_arg_43_4;
reversedPhysicalIds_769 = __wm_tail_arg_43_5;
reversedLoopIds_770 = __wm_tail_arg_43_6;
reversedInitialStatements_771 = __wm_tail_arg_43_7;
reversedIterationStatements_772 = __wm_tail_arg_43_8;
continue __wm_tail_37;
}
}
} else {
{
const bound_813 = bindPattern_330__wm_d6(pattern_795.id, loopAtomId_810, owner_797, scope_788, context_787, afterLoopAtom_811);
{
const __wm_tail_arg_44_0 = rest_785;
const __wm_tail_arg_44_1 = fn_786;
const __wm_tail_arg_44_2 = context_787;
const __wm_tail_arg_44_3 = bound_813.scope;
const __wm_tail_arg_44_4 = bound_813.state;
const __wm_tail_arg_44_5 = __wm_basis_Cons([physicalId_798, reversedPhysicalIds_790]);
const __wm_tail_arg_44_6 = __wm_basis_Cons([loopId_805, reversedLoopIds_791]);
const __wm_tail_arg_44_7 = __wm_basis_Cons([initialId_808, reversedInitialStatements_792]);
const __wm_tail_arg_44_8 = reverseInto_146__wm_d2(bound_813.statementIds, reversedIterationStatements_793);
paramIds_764 = __wm_tail_arg_44_0;
fn_765 = __wm_tail_arg_44_1;
context_766 = __wm_tail_arg_44_2;
scope_767 = __wm_tail_arg_44_3;
state_768 = __wm_tail_arg_44_4;
reversedPhysicalIds_769 = __wm_tail_arg_44_5;
reversedLoopIds_770 = __wm_tail_arg_44_6;
reversedInitialStatements_771 = __wm_tail_arg_44_7;
reversedIterationStatements_772 = __wm_tail_arg_44_8;
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
const setupRecursiveParameters_763 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return setupRecursiveParameters_763__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerRecursiveFunction_828__wm_d3 = (fn_814, context_815, state_816) => {
const params_817 = setupRecursiveParameters_763__wm_d9(Js.Array.toList(fn_814.paramIds), fn_814, context_815, emptyScope_327(undefined), state_816, __wm_basis_Nil, __wm_basis_Nil, __wm_basis_Nil, __wm_basis_Nil);
const tail_818 = lowerTail_591__wm_d4(fn_814.bodyExprId, params_817.scope, context_815, params_817.state);
const __wm_bind_51 = pushBlock_307__wm_d3(fn_814.functionId, append_153__wm_d2(params_817.iterationStatementIds, tail_818.statementIds), tail_818.state);
if (!(__wm_is_tuple(__wm_bind_51) && __wm_bind_51.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const loopBodyId_819 = __wm_bind_51[0];
const afterLoopBody_820 = __wm_bind_51[1];
const bodyExpression_821 = findIrExpression_169__wm_d2(context_815.expressions, fn_814.bodyExprId);
const loopStatement_822 = { ...baseStatement_301__wm_d5(fn_814.functionId, "loop", bodyExpression_821.sourceExprId, bodyExpression_821.spanId, afterLoopBody_820), bodyBlockId: loopBodyId_819 };
const __wm_bind_52 = pushStatement_294__wm_d2(loopStatement_822, afterLoopBody_820);
if (!(__wm_is_tuple(__wm_bind_52) && __wm_bind_52.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const loopStatementId_823 = __wm_bind_52[0];
const afterLoop_824 = __wm_bind_52[1];
const __wm_bind_53 = pushBlock_307__wm_d3(fn_814.functionId, append_153__wm_d2(params_817.initialStatementIds, __wm_basis_Cons([loopStatementId_823, __wm_basis_Nil])), afterLoop_824);
if (!(__wm_is_tuple(__wm_bind_53) && __wm_bind_53.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const outerBlockId_825 = __wm_bind_53[0];
const afterOuter_826 = __wm_bind_53[1];
const lowered_827 = { functionId: fn_814.functionId, physicalParamLocalIds: Js.Array.fromList(params_817.physicalLocalIds), loopParamLocalIds: Js.Array.fromList(params_817.activeLocalIds), bodyBlockId: outerBlockId_825, recursive: true, spanId: fn_814.spanId };
return pushFunction_315__wm_d2(lowered_827, afterOuter_826);
};
const lowerRecursiveFunction_828 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return lowerRecursiveFunction_828__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerFunctions_829__wm_d3 = (functions_830, context_831, state_832) => {
__wm_tail_38: while (true) {
{
const __wm_scalar_64_0 = functions_830;
const __wm_scalar_64_1 = context_831;
const __wm_scalar_64_2 = state_832;
if (__wm_scalar_64_0 === __wm_basis_Nil) {
const context_833 = __wm_scalar_64_1;
const state_834 = __wm_scalar_64_2;
return state_834;
} else if (__wm_scalar_64_0?.ctor === -6 && __wm_scalar_64_0.args.length === 1 && __wm_is_tuple(__wm_scalar_64_0.args[0]) && __wm_scalar_64_0.args[0].length === 2) {
const fn_835 = __wm_scalar_64_0.args[0][0];
const rest_836 = __wm_scalar_64_0.args[0][1];
const context_837 = __wm_scalar_64_1;
const state_838 = __wm_scalar_64_2;
if ((fn_835.recursionGroupId < 0)) {
{
const __wm_tail_arg_45_0 = rest_836;
const __wm_tail_arg_45_1 = context_837;
const __wm_tail_arg_45_2 = lowerNonrecursiveFunction_762__wm_d3(fn_835, context_837, state_838);
functions_830 = __wm_tail_arg_45_0;
context_831 = __wm_tail_arg_45_1;
state_832 = __wm_tail_arg_45_2;
continue __wm_tail_38;
}
} else {
{
const __wm_tail_arg_46_0 = rest_836;
const __wm_tail_arg_46_1 = context_837;
const __wm_tail_arg_46_2 = lowerRecursiveFunction_828__wm_d3(fn_835, context_837, state_838);
functions_830 = __wm_tail_arg_46_0;
context_831 = __wm_tail_arg_46_1;
state_832 = __wm_tail_arg_46_2;
continue __wm_tail_38;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const lowerFunctions_829 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return lowerFunctions_829__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lowerSliceProgram_849__wm_d8 = (functions_839, expressions_840, matchArms_841, params_842, patterns_843, constructors_844, layouts_845, fields_846) => {
const context_847 = { functions: Js.Array.toList(functions_839), expressions: Js.Array.toList(expressions_840), matchArms: Js.Array.toList(matchArms_841), params: Js.Array.toList(params_842), patterns: Js.Array.toList(patterns_843), constructors: Js.Array.toList(constructors_844), layouts: Js.Array.toList(layouts_845), fields: Js.Array.toList(fields_846) };
const state_848 = lowerFunctions_829__wm_d3(context_847.functions, context_847, initialLowerState_161(undefined));
return finishLoweredProgram_318(state_848);
};
const lowerSliceProgram_849 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 8) return lowerSliceProgram_849__wm_d8(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7]);
__wm_fail("Match", "pattern match failure in function");
};
return { "LowerScope": LowerScope_319, "LowerValueResult": LowerValueResult_320, "LowerTailResult": LowerTailResult_321, "LowerChildrenResult": LowerChildrenResult_322, "LowerBindResult": LowerBindResult_323, "LowerParamResult": LowerParamResult_324, "LowerCasesResult": LowerCasesResult_325, "emptyScope": emptyScope_327, "lowerLetValue": lowerLetValue_328, "lowerLetValue__wm_d5": lowerLetValue_328__wm_d5, "lowerSequenceValue": lowerSequenceValue_329, "lowerSequenceValue__wm_d5": lowerSequenceValue_329__wm_d5, "bindPattern": bindPattern_330, "bindPattern__wm_d6": bindPattern_330__wm_d6, "bindPatternValue": bindPatternValue_331, "bindPatternValue__wm_d7": bindPatternValue_331__wm_d7, "bindTupleChildren": bindTupleChildren_332, "bindTupleChildren__wm_d8": bindTupleChildren_332__wm_d8, "assignJoin": assignJoin_411, "assignJoin__wm_d4": assignJoin_411__wm_d4, "lowerIfValue": lowerIfValue_439, "lowerIfValue__wm_d5": lowerIfValue_439__wm_d5, "lowerMatchValue": lowerMatchValue_440, "lowerMatchValue__wm_d5": lowerMatchValue_440__wm_d5, "lowerMatchValueCases": lowerMatchValueCases_441, "lowerMatchValueCases__wm_d9": lowerMatchValueCases_441__wm_d9, "bindMatchPayload": bindMatchPayload_442, "bindMatchPayload__wm_d6": bindMatchPayload_442__wm_d6, "operationKind": operationKind_523, "bindOperation": bindOperation_542, "bindOperation__wm_d7": bindOperation_542__wm_d7, "bindSourceOperation": bindSourceOperation_548, "bindSourceOperation__wm_d4": bindSourceOperation_548__wm_d4, "lowerValue": lowerValue_549, "lowerValue__wm_d4": lowerValue_549__wm_d4, "lowerChildren": lowerChildren_550, "lowerChildren__wm_d6": lowerChildren_550__wm_d6, "returnStatement": returnStatement_590, "returnStatement__wm_d3": returnStatement_590__wm_d3, "lowerTail": lowerTail_591, "lowerTail__wm_d4": lowerTail_591__wm_d4, "lowerTailIf": lowerTailIf_592, "lowerTailIf__wm_d4": lowerTailIf_592__wm_d4, "lowerTailMatch": lowerTailMatch_593, "lowerTailMatch__wm_d4": lowerTailMatch_593__wm_d4, "lowerTailMatchCases": lowerTailMatchCases_594, "lowerTailMatchCases__wm_d7": lowerTailMatchCases_594__wm_d7, "lowerTailCall": lowerTailCall_595, "lowerTailCall__wm_d4": lowerTailCall_595__wm_d4, "materializeTailNext": materializeTailNext_596, "materializeTailNext__wm_d5": materializeTailNext_596__wm_d5, "setupParameters": setupParameters_717, "setupParameters__wm_d7": setupParameters_717__wm_d7, "lowerNonrecursiveFunction": lowerNonrecursiveFunction_762, "lowerNonrecursiveFunction__wm_d3": lowerNonrecursiveFunction_762__wm_d3, "setupRecursiveParameters": setupRecursiveParameters_763, "setupRecursiveParameters__wm_d9": setupRecursiveParameters_763__wm_d9, "lowerRecursiveFunction": lowerRecursiveFunction_828, "lowerRecursiveFunction__wm_d3": lowerRecursiveFunction_828__wm_d3, "lowerFunctions": lowerFunctions_829, "lowerFunctions__wm_d3": lowerFunctions_829__wm_d3, "lowerSliceProgram": lowerSliceProgram_849, "lowerSliceProgram__wm_d8": lowerSliceProgram_849__wm_d8 };
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
const SliceEmitContext_850 = (__record_args) => ({ input: __record_args[0], environmentFields: __record_args[1], types: __record_args[2], constructors: __record_args[3], layouts: __record_args[4], fields: __record_args[5], functions: __record_args[6], locals: __record_args[7], atoms: __record_args[8], operations: __record_args[9], statements: __record_args[10], blocks: __record_args[11], cases: __record_args[12], recursiveFunctionId: __record_args[13] });
const text_852 = (__arg) => {
if (true) {
const value_851 = __arg;
return Text.of(value_851);
}
__wm_fail("Match", "pattern match failure in function");
};
const localName_854 = (__arg) => {
if (true) {
const id_853 = __arg;
return ("wm_l_" + text_852(id_853));
}
__wm_fail("Match", "pattern match failure in function");
};
const functionName_856 = (__arg) => {
if (true) {
const id_855 = __arg;
return ("wm_f_" + text_852(id_855));
}
__wm_fail("Match", "pattern match failure in function");
};
const tupleName_858 = (__arg) => {
if (true) {
const id_857 = __arg;
return ("wm_tuple_" + text_852(id_857));
}
__wm_fail("Match", "pattern match failure in function");
};
const tupleFactoryName_860 = (__arg) => {
if (true) {
const id_859 = __arg;
return ("wm_make_tuple_" + text_852(id_859));
}
__wm_fail("Match", "pattern match failure in function");
};
const tupleFieldName_862 = (__arg) => {
if (true) {
const index_861 = __arg;
return ("wm_i_" + text_852(index_861));
}
__wm_fail("Match", "pattern match failure in function");
};
const layoutName_864 = (__arg) => {
if (true) {
const id_863 = __arg;
return ("wm_adt_" + text_852(id_863));
}
__wm_fail("Match", "pattern match failure in function");
};
const constructorName_866 = (__arg) => {
if (true) {
const id_865 = __arg;
return ("wm_make_ctor_" + text_852(id_865));
}
__wm_fail("Match", "pattern match failure in function");
};
const payloadFieldName_868 = (__arg) => {
if (true) {
const id_867 = __arg;
return ("wm_p_" + text_852(id_867));
}
__wm_fail("Match", "pattern match failure in function");
};
const uniformFieldName_870 = (__arg) => {
if (true) {
const index_869 = __arg;
return ("wm_u_" + text_852(index_869));
}
__wm_fail("Match", "pattern match failure in function");
};
const resourceFieldName_872 = (__arg) => {
if (true) {
const binding_871 = __arg;
return ("wm_r_" + text_852(binding_871));
}
__wm_fail("Match", "pattern match failure in function");
};
const recursiveResultName_874 = (__arg) => {
if (true) {
const id_873 = __arg;
return ("wm_result_" + text_852(id_873));
}
__wm_fail("Match", "pattern match failure in function");
};
const recursiveDoneName_876 = (__arg) => {
if (true) {
const id_875 = __arg;
return ("wm_done_" + text_852(id_875));
}
__wm_fail("Match", "pattern match failure in function");
};
const listLength_877__wm_d2 = (items_878, count_879) => {
__wm_tail_39: while (true) {
{
const __wm_scalar_65_0 = items_878;
const __wm_scalar_65_1 = count_879;
if (__wm_scalar_65_0 === __wm_basis_Nil) {
const count_880 = __wm_scalar_65_1;
return count_880;
} else if (__wm_scalar_65_0?.ctor === -6 && __wm_scalar_65_0.args.length === 1 && __wm_is_tuple(__wm_scalar_65_0.args[0]) && __wm_scalar_65_0.args[0].length === 2) {
const _item_881 = __wm_scalar_65_0.args[0][0];
const rest_882 = __wm_scalar_65_0.args[0][1];
const count_883 = __wm_scalar_65_1;
{
const __wm_tail_arg_47_0 = rest_882;
const __wm_tail_arg_47_1 = (count_883 + 1);
items_878 = __wm_tail_arg_47_0;
count_879 = __wm_tail_arg_47_1;
continue __wm_tail_39;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const listLength_877 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return listLength_877__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const vectorLaneName_885 = (__arg) => {
if (true) {
const index_884 = __arg;
if (numberEqual_145__wm_d2(index_884, 0)) {
return "x";
} else {
if (numberEqual_145__wm_d2(index_884, 1)) {
return "y";
} else {
if (numberEqual_145__wm_d2(index_884, 2)) {
return "z";
} else {
return "w";
}
}
}
}
__wm_fail("Match", "pattern match failure in function");
};
const findType_886__wm_d2 = (items_887, id_888) => {
__wm_tail_40: while (true) {
{
const __wm_scalar_66_0 = items_887;
const __wm_scalar_66_1 = id_888;
if (__wm_scalar_66_0 === __wm_basis_Nil) {
const id_889 = __wm_scalar_66_1;
return __wm_fail("Panic", "missing Slang-emission type");
} else if (__wm_scalar_66_0?.ctor === -6 && __wm_scalar_66_0.args.length === 1 && __wm_is_tuple(__wm_scalar_66_0.args[0]) && __wm_scalar_66_0.args[0].length === 2) {
const item_890 = __wm_scalar_66_0.args[0][0];
const rest_891 = __wm_scalar_66_0.args[0][1];
const id_892 = __wm_scalar_66_1;
if (numberEqual_145__wm_d2(item_890.id, id_892)) {
return item_890;
} else {
{
const __wm_tail_arg_48_0 = rest_891;
const __wm_tail_arg_48_1 = id_892;
items_887 = __wm_tail_arg_48_0;
id_888 = __wm_tail_arg_48_1;
continue __wm_tail_40;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findType_886 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findType_886__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const vectorName_898__wm_d2 = (gpuType_893, context_894) => {
const scalar_897 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2) {
const typeId_895 = __v.args[0][0];
const __896 = __v.args[0][1];
return findType_886__wm_d2(context_894.types, typeId_895);
} else if (__v === __wm_basis_Nil) {

return __wm_fail("Panic", "shader vector has no component type");
}
__wm_fail("Match", "non-exhaustive match");
})(Js.Array.toList(gpuType_893.items));
return ((__wm_eq(scalar_897.kind, "i32") ? "int" : "float") + text_852(listLength_877__wm_d2(Js.Array.toList(gpuType_893.items), 0)));
};
const vectorName_898 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return vectorName_898__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findEnvironmentField_899__wm_d3 = (items_900, environmentId_901, index_902) => {
__wm_tail_41: while (true) {
{
const __wm_scalar_67_0 = items_900;
const __wm_scalar_67_1 = environmentId_901;
const __wm_scalar_67_2 = index_902;
if (__wm_scalar_67_0 === __wm_basis_Nil) {
const _environmentId_903 = __wm_scalar_67_1;
const _index_904 = __wm_scalar_67_2;
return __wm_fail("Panic", "missing Slang-emission environment field");
} else if (__wm_scalar_67_0?.ctor === -6 && __wm_scalar_67_0.args.length === 1 && __wm_is_tuple(__wm_scalar_67_0.args[0]) && __wm_scalar_67_0.args[0].length === 2) {
const item_905 = __wm_scalar_67_0.args[0][0];
const rest_906 = __wm_scalar_67_0.args[0][1];
const environmentId_907 = __wm_scalar_67_1;
const index_908 = __wm_scalar_67_2;
if (__wm_op_and_d2(numberEqual_145__wm_d2(item_905.environmentId, environmentId_907), numberEqual_145__wm_d2(item_905.declaredIndex, index_908))) {
return item_905;
} else {
{
const __wm_tail_arg_49_0 = rest_906;
const __wm_tail_arg_49_1 = environmentId_907;
const __wm_tail_arg_49_2 = index_908;
items_900 = __wm_tail_arg_49_0;
environmentId_901 = __wm_tail_arg_49_1;
index_902 = __wm_tail_arg_49_2;
continue __wm_tail_41;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findEnvironmentField_899 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findEnvironmentField_899__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const findLayout_909__wm_d2 = (items_910, id_911) => {
__wm_tail_42: while (true) {
{
const __wm_scalar_68_0 = items_910;
const __wm_scalar_68_1 = id_911;
if (__wm_scalar_68_0 === __wm_basis_Nil) {
const id_912 = __wm_scalar_68_1;
return __wm_fail("Panic", "missing Slang-emission ADT layout");
} else if (__wm_scalar_68_0?.ctor === -6 && __wm_scalar_68_0.args.length === 1 && __wm_is_tuple(__wm_scalar_68_0.args[0]) && __wm_scalar_68_0.args[0].length === 2) {
const item_913 = __wm_scalar_68_0.args[0][0];
const rest_914 = __wm_scalar_68_0.args[0][1];
const id_915 = __wm_scalar_68_1;
if (numberEqual_145__wm_d2(item_913.id, id_915)) {
return item_913;
} else {
{
const __wm_tail_arg_50_0 = rest_914;
const __wm_tail_arg_50_1 = id_915;
items_910 = __wm_tail_arg_50_0;
id_911 = __wm_tail_arg_50_1;
continue __wm_tail_42;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLayout_909 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLayout_909__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLayoutByType_916__wm_d2 = (items_917, typeId_918) => {
__wm_tail_43: while (true) {
{
const __wm_scalar_69_0 = items_917;
const __wm_scalar_69_1 = typeId_918;
if (__wm_scalar_69_0 === __wm_basis_Nil) {
const typeId_919 = __wm_scalar_69_1;
return __wm_fail("Panic", "missing Slang-emission ADT type layout");
} else if (__wm_scalar_69_0?.ctor === -6 && __wm_scalar_69_0.args.length === 1 && __wm_is_tuple(__wm_scalar_69_0.args[0]) && __wm_scalar_69_0.args[0].length === 2) {
const item_920 = __wm_scalar_69_0.args[0][0];
const rest_921 = __wm_scalar_69_0.args[0][1];
const typeId_922 = __wm_scalar_69_1;
if (numberEqual_145__wm_d2(item_920.typeId, typeId_922)) {
return item_920;
} else {
{
const __wm_tail_arg_51_0 = rest_921;
const __wm_tail_arg_51_1 = typeId_922;
items_917 = __wm_tail_arg_51_0;
typeId_918 = __wm_tail_arg_51_1;
continue __wm_tail_43;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLayoutByType_916 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLayoutByType_916__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findField_923__wm_d2 = (items_924, id_925) => {
__wm_tail_44: while (true) {
{
const __wm_scalar_70_0 = items_924;
const __wm_scalar_70_1 = id_925;
if (__wm_scalar_70_0 === __wm_basis_Nil) {
const id_926 = __wm_scalar_70_1;
return __wm_fail("Panic", "missing Slang-emission ADT field");
} else if (__wm_scalar_70_0?.ctor === -6 && __wm_scalar_70_0.args.length === 1 && __wm_is_tuple(__wm_scalar_70_0.args[0]) && __wm_scalar_70_0.args[0].length === 2) {
const item_927 = __wm_scalar_70_0.args[0][0];
const rest_928 = __wm_scalar_70_0.args[0][1];
const id_929 = __wm_scalar_70_1;
if (numberEqual_145__wm_d2(item_927.id, id_929)) {
return item_927;
} else {
{
const __wm_tail_arg_52_0 = rest_928;
const __wm_tail_arg_52_1 = id_929;
items_924 = __wm_tail_arg_52_0;
id_925 = __wm_tail_arg_52_1;
continue __wm_tail_44;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findField_923 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findField_923__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findConstructor_930__wm_d2 = (items_931, id_932) => {
__wm_tail_45: while (true) {
{
const __wm_scalar_71_0 = items_931;
const __wm_scalar_71_1 = id_932;
if (__wm_scalar_71_0 === __wm_basis_Nil) {
const id_933 = __wm_scalar_71_1;
return __wm_fail("Panic", "missing Slang-emission constructor");
} else if (__wm_scalar_71_0?.ctor === -6 && __wm_scalar_71_0.args.length === 1 && __wm_is_tuple(__wm_scalar_71_0.args[0]) && __wm_scalar_71_0.args[0].length === 2) {
const item_934 = __wm_scalar_71_0.args[0][0];
const rest_935 = __wm_scalar_71_0.args[0][1];
const id_936 = __wm_scalar_71_1;
if (numberEqual_145__wm_d2(item_934.id, id_936)) {
return item_934;
} else {
{
const __wm_tail_arg_53_0 = rest_935;
const __wm_tail_arg_53_1 = id_936;
items_931 = __wm_tail_arg_53_0;
id_932 = __wm_tail_arg_53_1;
continue __wm_tail_45;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findConstructor_930 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findConstructor_930__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLocal_937__wm_d2 = (items_938, id_939) => {
__wm_tail_46: while (true) {
{
const __wm_scalar_72_0 = items_938;
const __wm_scalar_72_1 = id_939;
if (__wm_scalar_72_0 === __wm_basis_Nil) {
const id_940 = __wm_scalar_72_1;
return __wm_fail("Panic", "missing Slang-emission local");
} else if (__wm_scalar_72_0?.ctor === -6 && __wm_scalar_72_0.args.length === 1 && __wm_is_tuple(__wm_scalar_72_0.args[0]) && __wm_scalar_72_0.args[0].length === 2) {
const item_941 = __wm_scalar_72_0.args[0][0];
const rest_942 = __wm_scalar_72_0.args[0][1];
const id_943 = __wm_scalar_72_1;
if (numberEqual_145__wm_d2(item_941.id, id_943)) {
return item_941;
} else {
{
const __wm_tail_arg_54_0 = rest_942;
const __wm_tail_arg_54_1 = id_943;
items_938 = __wm_tail_arg_54_0;
id_939 = __wm_tail_arg_54_1;
continue __wm_tail_46;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLocal_937 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLocal_937__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findAtom_944__wm_d2 = (items_945, id_946) => {
__wm_tail_47: while (true) {
{
const __wm_scalar_73_0 = items_945;
const __wm_scalar_73_1 = id_946;
if (__wm_scalar_73_0 === __wm_basis_Nil) {
const id_947 = __wm_scalar_73_1;
return __wm_fail("Panic", "missing Slang-emission atom");
} else if (__wm_scalar_73_0?.ctor === -6 && __wm_scalar_73_0.args.length === 1 && __wm_is_tuple(__wm_scalar_73_0.args[0]) && __wm_scalar_73_0.args[0].length === 2) {
const item_948 = __wm_scalar_73_0.args[0][0];
const rest_949 = __wm_scalar_73_0.args[0][1];
const id_950 = __wm_scalar_73_1;
if (numberEqual_145__wm_d2(item_948.id, id_950)) {
return item_948;
} else {
{
const __wm_tail_arg_55_0 = rest_949;
const __wm_tail_arg_55_1 = id_950;
items_945 = __wm_tail_arg_55_0;
id_946 = __wm_tail_arg_55_1;
continue __wm_tail_47;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findAtom_944 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findAtom_944__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findOperation_951__wm_d2 = (items_952, id_953) => {
__wm_tail_48: while (true) {
{
const __wm_scalar_74_0 = items_952;
const __wm_scalar_74_1 = id_953;
if (__wm_scalar_74_0 === __wm_basis_Nil) {
const id_954 = __wm_scalar_74_1;
return __wm_fail("Panic", "missing Slang-emission operation");
} else if (__wm_scalar_74_0?.ctor === -6 && __wm_scalar_74_0.args.length === 1 && __wm_is_tuple(__wm_scalar_74_0.args[0]) && __wm_scalar_74_0.args[0].length === 2) {
const item_955 = __wm_scalar_74_0.args[0][0];
const rest_956 = __wm_scalar_74_0.args[0][1];
const id_957 = __wm_scalar_74_1;
if (numberEqual_145__wm_d2(item_955.id, id_957)) {
return item_955;
} else {
{
const __wm_tail_arg_56_0 = rest_956;
const __wm_tail_arg_56_1 = id_957;
items_952 = __wm_tail_arg_56_0;
id_953 = __wm_tail_arg_56_1;
continue __wm_tail_48;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findOperation_951 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findOperation_951__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findStatement_958__wm_d2 = (items_959, id_960) => {
__wm_tail_49: while (true) {
{
const __wm_scalar_75_0 = items_959;
const __wm_scalar_75_1 = id_960;
if (__wm_scalar_75_0 === __wm_basis_Nil) {
const id_961 = __wm_scalar_75_1;
return __wm_fail("Panic", "missing Slang-emission statement");
} else if (__wm_scalar_75_0?.ctor === -6 && __wm_scalar_75_0.args.length === 1 && __wm_is_tuple(__wm_scalar_75_0.args[0]) && __wm_scalar_75_0.args[0].length === 2) {
const item_962 = __wm_scalar_75_0.args[0][0];
const rest_963 = __wm_scalar_75_0.args[0][1];
const id_964 = __wm_scalar_75_1;
if (numberEqual_145__wm_d2(item_962.id, id_964)) {
return item_962;
} else {
{
const __wm_tail_arg_57_0 = rest_963;
const __wm_tail_arg_57_1 = id_964;
items_959 = __wm_tail_arg_57_0;
id_960 = __wm_tail_arg_57_1;
continue __wm_tail_49;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findStatement_958 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findStatement_958__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findBlock_965__wm_d2 = (items_966, id_967) => {
__wm_tail_50: while (true) {
{
const __wm_scalar_76_0 = items_966;
const __wm_scalar_76_1 = id_967;
if (__wm_scalar_76_0 === __wm_basis_Nil) {
const id_968 = __wm_scalar_76_1;
return __wm_fail("Panic", "missing Slang-emission block");
} else if (__wm_scalar_76_0?.ctor === -6 && __wm_scalar_76_0.args.length === 1 && __wm_is_tuple(__wm_scalar_76_0.args[0]) && __wm_scalar_76_0.args[0].length === 2) {
const item_969 = __wm_scalar_76_0.args[0][0];
const rest_970 = __wm_scalar_76_0.args[0][1];
const id_971 = __wm_scalar_76_1;
if (numberEqual_145__wm_d2(item_969.id, id_971)) {
return item_969;
} else {
{
const __wm_tail_arg_58_0 = rest_970;
const __wm_tail_arg_58_1 = id_971;
items_966 = __wm_tail_arg_58_0;
id_967 = __wm_tail_arg_58_1;
continue __wm_tail_50;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findBlock_965 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findBlock_965__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findCase_972__wm_d2 = (items_973, id_974) => {
__wm_tail_51: while (true) {
{
const __wm_scalar_77_0 = items_973;
const __wm_scalar_77_1 = id_974;
if (__wm_scalar_77_0 === __wm_basis_Nil) {
const id_975 = __wm_scalar_77_1;
return __wm_fail("Panic", "missing Slang-emission case");
} else if (__wm_scalar_77_0?.ctor === -6 && __wm_scalar_77_0.args.length === 1 && __wm_is_tuple(__wm_scalar_77_0.args[0]) && __wm_scalar_77_0.args[0].length === 2) {
const item_976 = __wm_scalar_77_0.args[0][0];
const rest_977 = __wm_scalar_77_0.args[0][1];
const id_978 = __wm_scalar_77_1;
if (numberEqual_145__wm_d2(item_976.id, id_978)) {
return item_976;
} else {
{
const __wm_tail_arg_59_0 = rest_977;
const __wm_tail_arg_59_1 = id_978;
items_973 = __wm_tail_arg_59_0;
id_974 = __wm_tail_arg_59_1;
continue __wm_tail_51;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findCase_972 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findCase_972__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findFunction_979__wm_d2 = (items_980, id_981) => {
__wm_tail_52: while (true) {
{
const __wm_scalar_78_0 = items_980;
const __wm_scalar_78_1 = id_981;
if (__wm_scalar_78_0 === __wm_basis_Nil) {
const id_982 = __wm_scalar_78_1;
return __wm_fail("Panic", "missing Slang-emission function");
} else if (__wm_scalar_78_0?.ctor === -6 && __wm_scalar_78_0.args.length === 1 && __wm_is_tuple(__wm_scalar_78_0.args[0]) && __wm_scalar_78_0.args[0].length === 2) {
const item_983 = __wm_scalar_78_0.args[0][0];
const rest_984 = __wm_scalar_78_0.args[0][1];
const id_985 = __wm_scalar_78_1;
if (numberEqual_145__wm_d2(item_983.functionId, id_985)) {
return item_983;
} else {
{
const __wm_tail_arg_60_0 = rest_984;
const __wm_tail_arg_60_1 = id_985;
items_980 = __wm_tail_arg_60_0;
id_981 = __wm_tail_arg_60_1;
continue __wm_tail_52;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findFunction_979 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findFunction_979__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findAdtForEmit_986__wm_d2 = (items_987, typeNameId_988) => {
__wm_tail_53: while (true) {
{
const __wm_scalar_79_0 = items_987;
const __wm_scalar_79_1 = typeNameId_988;
if (__wm_scalar_79_0 === __wm_basis_Nil) {
const typeNameId_989 = __wm_scalar_79_1;
return __wm_fail("Panic", "missing Slang-emission ADT");
} else if (__wm_scalar_79_0?.ctor === -6 && __wm_scalar_79_0.args.length === 1 && __wm_is_tuple(__wm_scalar_79_0.args[0]) && __wm_scalar_79_0.args[0].length === 2) {
const item_990 = __wm_scalar_79_0.args[0][0];
const rest_991 = __wm_scalar_79_0.args[0][1];
const typeNameId_992 = __wm_scalar_79_1;
if (numberEqual_145__wm_d2(item_990.typeNameId, typeNameId_992)) {
return item_990;
} else {
{
const __wm_tail_arg_61_0 = rest_991;
const __wm_tail_arg_61_1 = typeNameId_992;
items_987 = __wm_tail_arg_61_0;
typeNameId_988 = __wm_tail_arg_61_1;
continue __wm_tail_53;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findAdtForEmit_986 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findAdtForEmit_986__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findSourceFunction_993__wm_d2 = (items_994, functionId_995) => {
__wm_tail_54: while (true) {
{
const __wm_scalar_80_0 = items_994;
const __wm_scalar_80_1 = functionId_995;
if (__wm_scalar_80_0 === __wm_basis_Nil) {
const functionId_996 = __wm_scalar_80_1;
return __wm_fail("Panic", "missing Slang-emission source function");
} else if (__wm_scalar_80_0?.ctor === -6 && __wm_scalar_80_0.args.length === 1 && __wm_is_tuple(__wm_scalar_80_0.args[0]) && __wm_scalar_80_0.args[0].length === 2) {
const item_997 = __wm_scalar_80_0.args[0][0];
const rest_998 = __wm_scalar_80_0.args[0][1];
const functionId_999 = __wm_scalar_80_1;
if (numberEqual_145__wm_d2(item_997.id, functionId_999)) {
return item_997;
} else {
{
const __wm_tail_arg_62_0 = rest_998;
const __wm_tail_arg_62_1 = functionId_999;
items_994 = __wm_tail_arg_62_0;
functionId_995 = __wm_tail_arg_62_1;
continue __wm_tail_54;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findSourceFunction_993 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findSourceFunction_993__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const typeName_1004__wm_d2 = (typeId_1000, context_1001) => {
const gpuType_1002 = findType_886__wm_d2(context_1001.types, typeId_1000);
if (__wm_eq(gpuType_1002.kind, "f32")) {
return "float";
} else {
if (__wm_eq(gpuType_1002.kind, "i32")) {
return "int";
} else {
if (__wm_eq(gpuType_1002.kind, "bool")) {
return "bool";
} else {
if (__wm_eq(gpuType_1002.kind, "void")) {
return "void";
} else {
if (__wm_eq(gpuType_1002.kind, "vector")) {
return vectorName_898__wm_d2(gpuType_1002, context_1001);
} else {
if (__wm_eq(gpuType_1002.kind, "tuple")) {
return tupleName_858(typeId_1000);
} else {
if (__wm_eq(gpuType_1002.kind, "adt")) {
const layout_1003 = findLayoutByType_916__wm_d2(context_1001.layouts, typeId_1000);
return layoutName_864(layout_1003.id);
} else {
if (__wm_eq(gpuType_1002.kind, "sampled-texture-2d")) {
return "Texture2D<float4>";
} else {
if (__wm_eq(gpuType_1002.kind, "sampler")) {
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
const typeName_1004 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return typeName_1004__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitEnvironmentFields_1005__wm_d3 = (items_1006, context_1007, output_1008) => {
__wm_tail_55: while (true) {
{
const __wm_scalar_81_0 = items_1006;
const __wm_scalar_81_1 = context_1007;
const __wm_scalar_81_2 = output_1008;
if (__wm_scalar_81_0 === __wm_basis_Nil) {
const _context_1009 = __wm_scalar_81_1;
const output_1010 = __wm_scalar_81_2;
return output_1010;
} else if (__wm_scalar_81_0?.ctor === -6 && __wm_scalar_81_0.args.length === 1 && __wm_is_tuple(__wm_scalar_81_0.args[0]) && __wm_scalar_81_0.args[0].length === 2) {
const field_1011 = __wm_scalar_81_0.args[0][0];
const rest_1012 = __wm_scalar_81_0.args[0][1];
const context_1013 = __wm_scalar_81_1;
const output_1014 = __wm_scalar_81_2;
{
const __wm_tail_arg_63_0 = rest_1012;
const __wm_tail_arg_63_1 = context_1013;
const __wm_tail_arg_63_2 = (__wm_eq(field_1011.kind, "uniform") ? (() => {
const gpuType_1015 = findType_886__wm_d2(context_1013.types, field_1011.typeId);
const fieldType_1016 = (__wm_eq(gpuType_1015.kind, "bool") ? "int" : typeName_1004__wm_d2(field_1011.typeId, context_1013));
return (((((output_1014 + "  ") + fieldType_1016) + " ") + uniformFieldName_870(field_1011.declaredIndex)) + ";\n");
})() : output_1014);
items_1006 = __wm_tail_arg_63_0;
context_1007 = __wm_tail_arg_63_1;
output_1008 = __wm_tail_arg_63_2;
continue __wm_tail_55;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitEnvironmentFields_1005 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitEnvironmentFields_1005__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
let hasUniformField_1017 = (__arg) => {
__wm_tail_56: while (true) {
if (true) {
const items_1018 = __arg;
{
const __wm_tail_value_64 = items_1018;
if (__wm_tail_value_64 === __wm_basis_Nil) {

return false;
} else if (__wm_tail_value_64?.ctor === -6 && __wm_tail_value_64.args.length === 1 && __wm_is_tuple(__wm_tail_value_64.args[0]) && __wm_tail_value_64.args[0].length === 2) {
const field_1019 = __wm_tail_value_64.args[0][0];
const rest_1020 = __wm_tail_value_64.args[0][1];
if (__wm_eq(field_1019.kind, "uniform")) {
return true;
} else {
__arg = rest_1020;
continue __wm_tail_56;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "pattern match failure in function");
}
};
const emitResourceDeclarations_1021__wm_d3 = (items_1022, context_1023, output_1024) => {
__wm_tail_57: while (true) {
{
const __wm_scalar_82_0 = items_1022;
const __wm_scalar_82_1 = context_1023;
const __wm_scalar_82_2 = output_1024;
if (__wm_scalar_82_0 === __wm_basis_Nil) {
const _context_1025 = __wm_scalar_82_1;
const output_1026 = __wm_scalar_82_2;
return output_1026;
} else if (__wm_scalar_82_0?.ctor === -6 && __wm_scalar_82_0.args.length === 1 && __wm_is_tuple(__wm_scalar_82_0.args[0]) && __wm_scalar_82_0.args[0].length === 2) {
const field_1027 = __wm_scalar_82_0.args[0][0];
const rest_1028 = __wm_scalar_82_0.args[0][1];
const context_1029 = __wm_scalar_82_1;
const output_1030 = __wm_scalar_82_2;
{
const next_1031 = (__wm_eq(field_1027.kind, "uniform") ? output_1030 : (((((((output_1030 + "[[vk::binding(") + text_852(field_1027.binding)) + ", 0)]]\n") + typeName_1004__wm_d2(field_1027.typeId, context_1029)) + " ") + resourceFieldName_872(field_1027.binding)) + ";\n\n"));
{
const __wm_tail_arg_65_0 = rest_1028;
const __wm_tail_arg_65_1 = context_1029;
const __wm_tail_arg_65_2 = next_1031;
items_1022 = __wm_tail_arg_65_0;
context_1023 = __wm_tail_arg_65_1;
output_1024 = __wm_tail_arg_65_2;
continue __wm_tail_57;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitResourceDeclarations_1021 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitResourceDeclarations_1021__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitEnvironmentDeclaration_1035 = (__arg) => {
if (true) {
const context_1032 = __arg;
if (numberEqual_145__wm_d2(context_1032.input.root.environmentId, __wm_op_sub(1))) {
return "";
} else {
const fields_1033 = context_1032.environmentFields;
const uniformDeclaration_1034 = (hasUniformField_1017(fields_1033) ? (((("struct wm_environment {\n" + emitEnvironmentFields_1005__wm_d3(fields_1033, context_1032, "")) + "};\n") + "[[vk::binding(0, 0)]]\n") + "ConstantBuffer<wm_environment> wm_uniforms;\n\n") : "");
return (uniformDeclaration_1034 + emitResourceDeclarations_1021__wm_d3(fields_1033, context_1032, ""));
}
}
__wm_fail("Match", "pattern match failure in function");
};
const joinText_1036__wm_d3 = (items_1037, separator_1038, output_1039) => {
__wm_tail_58: while (true) {
{
const __wm_scalar_83_0 = items_1037;
const __wm_scalar_83_1 = separator_1038;
const __wm_scalar_83_2 = output_1039;
if (__wm_scalar_83_0 === __wm_basis_Nil) {
const separator_1040 = __wm_scalar_83_1;
const output_1041 = __wm_scalar_83_2;
return output_1041;
} else if (__wm_scalar_83_0?.ctor === -6 && __wm_scalar_83_0.args.length === 1 && __wm_is_tuple(__wm_scalar_83_0.args[0]) && __wm_scalar_83_0.args[0].length === 2) {
const item_1042 = __wm_scalar_83_0.args[0][0];
const rest_1043 = __wm_scalar_83_0.args[0][1];
const separator_1044 = __wm_scalar_83_1;
const output_1045 = __wm_scalar_83_2;
{
const next_1046 = (__wm_eq(output_1045, "") ? item_1042 : ((output_1045 + separator_1044) + item_1042));
{
const __wm_tail_arg_66_0 = rest_1043;
const __wm_tail_arg_66_1 = separator_1044;
const __wm_tail_arg_66_2 = next_1046;
items_1037 = __wm_tail_arg_66_0;
separator_1038 = __wm_tail_arg_66_1;
output_1039 = __wm_tail_arg_66_2;
continue __wm_tail_58;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const joinText_1036 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return joinText_1036__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleFields_1047__wm_d4 = (typeIds_1048, index_1049, context_1050, output_1051) => {
__wm_tail_59: while (true) {
{
const __wm_scalar_84_0 = typeIds_1048;
const __wm_scalar_84_1 = index_1049;
const __wm_scalar_84_2 = context_1050;
const __wm_scalar_84_3 = output_1051;
if (__wm_scalar_84_0 === __wm_basis_Nil) {
const index_1052 = __wm_scalar_84_1;
const context_1053 = __wm_scalar_84_2;
const output_1054 = __wm_scalar_84_3;
return output_1054;
} else if (__wm_scalar_84_0?.ctor === -6 && __wm_scalar_84_0.args.length === 1 && __wm_is_tuple(__wm_scalar_84_0.args[0]) && __wm_scalar_84_0.args[0].length === 2) {
const typeId_1055 = __wm_scalar_84_0.args[0][0];
const rest_1056 = __wm_scalar_84_0.args[0][1];
const index_1057 = __wm_scalar_84_1;
const context_1058 = __wm_scalar_84_2;
const output_1059 = __wm_scalar_84_3;
{
const __wm_tail_arg_67_0 = rest_1056;
const __wm_tail_arg_67_1 = (index_1057 + 1);
const __wm_tail_arg_67_2 = context_1058;
const __wm_tail_arg_67_3 = (((((output_1059 + "  ") + typeName_1004__wm_d2(typeId_1055, context_1058)) + " ") + tupleFieldName_862(index_1057)) + ";\n");
typeIds_1048 = __wm_tail_arg_67_0;
index_1049 = __wm_tail_arg_67_1;
context_1050 = __wm_tail_arg_67_2;
output_1051 = __wm_tail_arg_67_3;
continue __wm_tail_59;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitTupleFields_1047 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitTupleFields_1047__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleParams_1060__wm_d4 = (typeIds_1061, index_1062, context_1063, output_1064) => {
__wm_tail_60: while (true) {
{
const __wm_scalar_85_0 = typeIds_1061;
const __wm_scalar_85_1 = index_1062;
const __wm_scalar_85_2 = context_1063;
const __wm_scalar_85_3 = output_1064;
if (__wm_scalar_85_0 === __wm_basis_Nil) {
const index_1065 = __wm_scalar_85_1;
const context_1066 = __wm_scalar_85_2;
const output_1067 = __wm_scalar_85_3;
return output_1067;
} else if (__wm_scalar_85_0?.ctor === -6 && __wm_scalar_85_0.args.length === 1 && __wm_is_tuple(__wm_scalar_85_0.args[0]) && __wm_scalar_85_0.args[0].length === 2) {
const typeId_1068 = __wm_scalar_85_0.args[0][0];
const rest_1069 = __wm_scalar_85_0.args[0][1];
const index_1070 = __wm_scalar_85_1;
const context_1071 = __wm_scalar_85_2;
const output_1072 = __wm_scalar_85_3;
{
const parameter_1073 = ((typeName_1004__wm_d2(typeId_1068, context_1071) + " ") + tupleFieldName_862(index_1070));
const next_1074 = (__wm_eq(output_1072, "") ? parameter_1073 : ((output_1072 + ", ") + parameter_1073));
{
const __wm_tail_arg_68_0 = rest_1069;
const __wm_tail_arg_68_1 = (index_1070 + 1);
const __wm_tail_arg_68_2 = context_1071;
const __wm_tail_arg_68_3 = next_1074;
typeIds_1061 = __wm_tail_arg_68_0;
index_1062 = __wm_tail_arg_68_1;
context_1063 = __wm_tail_arg_68_2;
output_1064 = __wm_tail_arg_68_3;
continue __wm_tail_60;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitTupleParams_1060 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitTupleParams_1060__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleAssignments_1075__wm_d3 = (typeIds_1076, index_1077, output_1078) => {
__wm_tail_61: while (true) {
{
const __wm_scalar_86_0 = typeIds_1076;
const __wm_scalar_86_1 = index_1077;
const __wm_scalar_86_2 = output_1078;
if (__wm_scalar_86_0 === __wm_basis_Nil) {
const index_1079 = __wm_scalar_86_1;
const output_1080 = __wm_scalar_86_2;
return output_1080;
} else if (__wm_scalar_86_0?.ctor === -6 && __wm_scalar_86_0.args.length === 1 && __wm_is_tuple(__wm_scalar_86_0.args[0]) && __wm_scalar_86_0.args[0].length === 2) {
const _typeId_1081 = __wm_scalar_86_0.args[0][0];
const rest_1082 = __wm_scalar_86_0.args[0][1];
const index_1083 = __wm_scalar_86_1;
const output_1084 = __wm_scalar_86_2;
{
const field_1085 = tupleFieldName_862(index_1083);
{
const __wm_tail_arg_69_0 = rest_1082;
const __wm_tail_arg_69_1 = (index_1083 + 1);
const __wm_tail_arg_69_2 = (((((output_1084 + "  value.") + field_1085) + " = ") + field_1085) + ";\n");
typeIds_1076 = __wm_tail_arg_69_0;
index_1077 = __wm_tail_arg_69_1;
output_1078 = __wm_tail_arg_69_2;
continue __wm_tail_61;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitTupleAssignments_1075 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitTupleAssignments_1075__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleDeclaration_1089__wm_d2 = (gpuType_1086, context_1087) => {
const items_1088 = Js.Array.toList(gpuType_1086.items);
return ((((((((((((((("struct " + tupleName_858(gpuType_1086.id)) + " {\n") + emitTupleFields_1047__wm_d4(items_1088, 0, context_1087, "")) + "};\n\n") + tupleName_858(gpuType_1086.id)) + " ") + tupleFactoryName_860(gpuType_1086.id)) + "(") + emitTupleParams_1060__wm_d4(items_1088, 0, context_1087, "")) + ") {\n") + "  ") + tupleName_858(gpuType_1086.id)) + " value;\n") + emitTupleAssignments_1075__wm_d3(items_1088, 0, "")) + "  return value;\n}\n\n");
};
const emitTupleDeclaration_1089 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitTupleDeclaration_1089__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitTupleDeclarations_1090__wm_d3 = (types_1091, context_1092, output_1093) => {
__wm_tail_62: while (true) {
{
const __wm_scalar_87_0 = types_1091;
const __wm_scalar_87_1 = context_1092;
const __wm_scalar_87_2 = output_1093;
if (__wm_scalar_87_0 === __wm_basis_Nil) {
const context_1094 = __wm_scalar_87_1;
const output_1095 = __wm_scalar_87_2;
return output_1095;
} else if (__wm_scalar_87_0?.ctor === -6 && __wm_scalar_87_0.args.length === 1 && __wm_is_tuple(__wm_scalar_87_0.args[0]) && __wm_scalar_87_0.args[0].length === 2) {
const gpuType_1096 = __wm_scalar_87_0.args[0][0];
const rest_1097 = __wm_scalar_87_0.args[0][1];
const context_1098 = __wm_scalar_87_1;
const output_1099 = __wm_scalar_87_2;
{
const next_1100 = (__wm_eq(gpuType_1096.kind, "tuple") ? (output_1099 + emitTupleDeclaration_1089__wm_d2(gpuType_1096, context_1098)) : output_1099);
{
const __wm_tail_arg_70_0 = rest_1097;
const __wm_tail_arg_70_1 = context_1098;
const __wm_tail_arg_70_2 = next_1100;
types_1091 = __wm_tail_arg_70_0;
context_1092 = __wm_tail_arg_70_1;
output_1093 = __wm_tail_arg_70_2;
continue __wm_tail_62;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitTupleDeclarations_1090 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitTupleDeclarations_1090__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitLayoutFields_1101__wm_d3 = (fieldIds_1102, context_1103, output_1104) => {
__wm_tail_63: while (true) {
{
const __wm_scalar_88_0 = fieldIds_1102;
const __wm_scalar_88_1 = context_1103;
const __wm_scalar_88_2 = output_1104;
if (__wm_scalar_88_0 === __wm_basis_Nil) {
const context_1105 = __wm_scalar_88_1;
const output_1106 = __wm_scalar_88_2;
return output_1106;
} else if (__wm_scalar_88_0?.ctor === -6 && __wm_scalar_88_0.args.length === 1 && __wm_is_tuple(__wm_scalar_88_0.args[0]) && __wm_scalar_88_0.args[0].length === 2) {
const fieldId_1107 = __wm_scalar_88_0.args[0][0];
const rest_1108 = __wm_scalar_88_0.args[0][1];
const context_1109 = __wm_scalar_88_1;
const output_1110 = __wm_scalar_88_2;
{
const field_1111 = findField_923__wm_d2(context_1109.fields, fieldId_1107);
{
const __wm_tail_arg_71_0 = rest_1108;
const __wm_tail_arg_71_1 = context_1109;
const __wm_tail_arg_71_2 = (((((output_1110 + "  ") + typeName_1004__wm_d2(field_1111.typeId, context_1109)) + " ") + payloadFieldName_868(field_1111.id)) + ";\n");
fieldIds_1102 = __wm_tail_arg_71_0;
context_1103 = __wm_tail_arg_71_1;
output_1104 = __wm_tail_arg_71_2;
continue __wm_tail_63;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitLayoutFields_1101 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitLayoutFields_1101__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitConstructorFieldAssignments_1112__wm_d4 = (fields_1113, constructorId_1114, payloadName_1115, output_1116) => {
__wm_tail_64: while (true) {
{
const __wm_scalar_89_0 = fields_1113;
const __wm_scalar_89_1 = constructorId_1114;
const __wm_scalar_89_2 = payloadName_1115;
const __wm_scalar_89_3 = output_1116;
if (__wm_scalar_89_0 === __wm_basis_Nil) {
const constructorId_1117 = __wm_scalar_89_1;
const payloadName_1118 = __wm_scalar_89_2;
const output_1119 = __wm_scalar_89_3;
return output_1119;
} else if (__wm_scalar_89_0?.ctor === -6 && __wm_scalar_89_0.args.length === 1 && __wm_is_tuple(__wm_scalar_89_0.args[0]) && __wm_scalar_89_0.args[0].length === 2) {
const field_1120 = __wm_scalar_89_0.args[0][0];
const rest_1121 = __wm_scalar_89_0.args[0][1];
const constructorId_1122 = __wm_scalar_89_1;
const payloadName_1123 = __wm_scalar_89_2;
const output_1124 = __wm_scalar_89_3;
{
const value_1125 = (numberEqual_145__wm_d2(field_1120.constructorId, constructorId_1122) ? payloadName_1123 : "float(0)");
{
const __wm_tail_arg_72_0 = rest_1121;
const __wm_tail_arg_72_1 = constructorId_1122;
const __wm_tail_arg_72_2 = payloadName_1123;
const __wm_tail_arg_72_3 = (((((output_1124 + "  value.") + payloadFieldName_868(field_1120.id)) + " = ") + value_1125) + ";\n");
fields_1113 = __wm_tail_arg_72_0;
constructorId_1114 = __wm_tail_arg_72_1;
payloadName_1115 = __wm_tail_arg_72_2;
output_1116 = __wm_tail_arg_72_3;
continue __wm_tail_64;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitConstructorFieldAssignments_1112 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitConstructorFieldAssignments_1112__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitConstructorDeclaration_1131__wm_d3 = (constructor_1126, layout_1127, context_1128) => {
const parameter_1129 = (numberEqual_145__wm_d2(constructor_1126.payloadTypeId, __wm_op_sub(1)) ? "" : (typeName_1004__wm_d2(constructor_1126.payloadTypeId, context_1128) + " payload"));
const payloadName_1130 = (numberEqual_145__wm_d2(constructor_1126.payloadTypeId, __wm_op_sub(1)) ? "float(0)" : "payload");
return (((((((((((((layoutName_864(layout_1127.id) + " ") + constructorName_866(constructor_1126.id)) + "(") + parameter_1129) + ") {\n") + "  ") + layoutName_864(layout_1127.id)) + " value;\n") + "  value.tag = ") + text_852(constructor_1126.tag)) + ";\n") + emitConstructorFieldAssignments_1112__wm_d4(context_1128.fields, constructor_1126.id, payloadName_1130, "")) + "  return value;\n}\n\n");
};
const emitConstructorDeclaration_1131 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitConstructorDeclaration_1131__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitLayoutConstructors_1132__wm_d4 = (constructorIds_1133, layout_1134, context_1135, output_1136) => {
__wm_tail_65: while (true) {
{
const __wm_scalar_90_0 = constructorIds_1133;
const __wm_scalar_90_1 = layout_1134;
const __wm_scalar_90_2 = context_1135;
const __wm_scalar_90_3 = output_1136;
if (__wm_scalar_90_0 === __wm_basis_Nil) {
const layout_1137 = __wm_scalar_90_1;
const context_1138 = __wm_scalar_90_2;
const output_1139 = __wm_scalar_90_3;
return output_1139;
} else if (__wm_scalar_90_0?.ctor === -6 && __wm_scalar_90_0.args.length === 1 && __wm_is_tuple(__wm_scalar_90_0.args[0]) && __wm_scalar_90_0.args[0].length === 2) {
const constructorId_1140 = __wm_scalar_90_0.args[0][0];
const rest_1141 = __wm_scalar_90_0.args[0][1];
const layout_1142 = __wm_scalar_90_1;
const context_1143 = __wm_scalar_90_2;
const output_1144 = __wm_scalar_90_3;
{
const constructor_1145 = findConstructor_930__wm_d2(context_1143.constructors, constructorId_1140);
{
const __wm_tail_arg_73_0 = rest_1141;
const __wm_tail_arg_73_1 = layout_1142;
const __wm_tail_arg_73_2 = context_1143;
const __wm_tail_arg_73_3 = (output_1144 + emitConstructorDeclaration_1131__wm_d3(constructor_1145, layout_1142, context_1143));
constructorIds_1133 = __wm_tail_arg_73_0;
layout_1134 = __wm_tail_arg_73_1;
context_1135 = __wm_tail_arg_73_2;
output_1136 = __wm_tail_arg_73_3;
continue __wm_tail_65;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitLayoutConstructors_1132 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitLayoutConstructors_1132__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitLayoutDeclaration_1149__wm_d2 = (layout_1146, context_1147) => {
const adt_1148 = findAdtForEmit_986__wm_d2(Js.Array.toList(context_1147.input.adts), layout_1146.typeNameId);
return ((((("struct " + layoutName_864(layout_1146.id)) + " {\n  int tag;\n") + emitLayoutFields_1101__wm_d3(Js.Array.toList(layout_1146.fieldIds), context_1147, "")) + "};\n\n") + emitLayoutConstructors_1132__wm_d4(Js.Array.toList(adt_1148.constructorIds), layout_1146, context_1147, ""));
};
const emitLayoutDeclaration_1149 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitLayoutDeclaration_1149__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitLayoutDeclarations_1150__wm_d3 = (layouts_1151, context_1152, output_1153) => {
__wm_tail_66: while (true) {
{
const __wm_scalar_91_0 = layouts_1151;
const __wm_scalar_91_1 = context_1152;
const __wm_scalar_91_2 = output_1153;
if (__wm_scalar_91_0 === __wm_basis_Nil) {
const context_1154 = __wm_scalar_91_1;
const output_1155 = __wm_scalar_91_2;
return output_1155;
} else if (__wm_scalar_91_0?.ctor === -6 && __wm_scalar_91_0.args.length === 1 && __wm_is_tuple(__wm_scalar_91_0.args[0]) && __wm_scalar_91_0.args[0].length === 2) {
const layout_1156 = __wm_scalar_91_0.args[0][0];
const rest_1157 = __wm_scalar_91_0.args[0][1];
const context_1158 = __wm_scalar_91_1;
const output_1159 = __wm_scalar_91_2;
{
const __wm_tail_arg_74_0 = rest_1157;
const __wm_tail_arg_74_1 = context_1158;
const __wm_tail_arg_74_2 = (output_1159 + emitLayoutDeclaration_1149__wm_d2(layout_1156, context_1158));
layouts_1151 = __wm_tail_arg_74_0;
context_1152 = __wm_tail_arg_74_1;
output_1153 = __wm_tail_arg_74_2;
continue __wm_tail_66;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitLayoutDeclarations_1150 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitLayoutDeclarations_1150__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitAtom_1164__wm_d2 = (atomId_1160, context_1161) => {
const atom_1162 = findAtom_944__wm_d2(context_1161.atoms, atomId_1160);
const __wm_return_value_29 = atom_1162.kind;
if (__wm_return_value_29 === "local") {

return localName_854(atom_1162.localId);
} else if (__wm_return_value_29 === "number") {

const gpuType_1163 = findType_886__wm_d2(context_1161.types, atom_1162.typeId);
return (((__wm_eq(gpuType_1163.kind, "i32") ? "int(" : "float(") + text_852(atom_1162.numberValue)) + ")");
} else if (__wm_return_value_29 === "bool") {

if (atom_1162.boolValue) {
return "true";
} else {
return "false";
}
} else if (true) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const emitAtom_1164 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitAtom_1164__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitArgs_1165__wm_d3 = (atomIds_1166, context_1167, output_1168) => {
__wm_tail_67: while (true) {
{
const __wm_scalar_92_0 = atomIds_1166;
const __wm_scalar_92_1 = context_1167;
const __wm_scalar_92_2 = output_1168;
if (__wm_scalar_92_0 === __wm_basis_Nil) {
const context_1169 = __wm_scalar_92_1;
const output_1170 = __wm_scalar_92_2;
return output_1170;
} else if (__wm_scalar_92_0?.ctor === -6 && __wm_scalar_92_0.args.length === 1 && __wm_is_tuple(__wm_scalar_92_0.args[0]) && __wm_scalar_92_0.args[0].length === 2) {
const atomId_1171 = __wm_scalar_92_0.args[0][0];
const rest_1172 = __wm_scalar_92_0.args[0][1];
const context_1173 = __wm_scalar_92_1;
const output_1174 = __wm_scalar_92_2;
{
const argument_1175 = emitAtom_1164__wm_d2(atomId_1171, context_1173);
const next_1176 = (__wm_eq(output_1174, "") ? argument_1175 : ((output_1174 + ", ") + argument_1175));
{
const __wm_tail_arg_75_0 = rest_1172;
const __wm_tail_arg_75_1 = context_1173;
const __wm_tail_arg_75_2 = next_1176;
atomIds_1166 = __wm_tail_arg_75_0;
context_1167 = __wm_tail_arg_75_1;
output_1168 = __wm_tail_arg_75_2;
continue __wm_tail_67;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitArgs_1165 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitArgs_1165__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const operatorText_1178 = (__arg) => {
if (true) {
const operatorId_1177 = __arg;
const __wm_return_value_30 = operatorId_1177;
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
const emitResourceCall_1187__wm_d3 = (operation_1179, args_1180, context_1181) => {
const __wm_return_value_31 = operation_1179.resourceOperation;
if (__wm_return_value_31 === "sample") {

const __wm_return_value_32 = args_1180;
if (__wm_return_value_32?.ctor === -6 && __wm_return_value_32.args.length === 1 && __wm_is_tuple(__wm_return_value_32.args[0]) && __wm_return_value_32.args[0].length === 2 && __wm_return_value_32.args[0][1]?.ctor === -6 && __wm_return_value_32.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_32.args[0][1].args[0]) && __wm_return_value_32.args[0][1].args[0].length === 2 && __wm_return_value_32.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_32.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_32.args[0][1].args[0][1].args[0]) && __wm_return_value_32.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_32.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const texture_1182 = __wm_return_value_32.args[0][0];
const sampler_1183 = __wm_return_value_32.args[0][1].args[0][0];
const coordinate_1184 = __wm_return_value_32.args[0][1].args[0][1].args[0][0];
return (((((emitAtom_1164__wm_d2(texture_1182, context_1181) + ".Sample(") + emitAtom_1164__wm_d2(sampler_1183, context_1181)) + ", ") + emitAtom_1164__wm_d2(coordinate_1184, context_1181)) + ")");
} else if (true) {

return __wm_fail("Panic", "texture Sample reached Slang emission with invalid arity");
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_31 === "load") {

const __wm_return_value_33 = args_1180;
if (__wm_return_value_33?.ctor === -6 && __wm_return_value_33.args.length === 1 && __wm_is_tuple(__wm_return_value_33.args[0]) && __wm_return_value_33.args[0].length === 2 && __wm_return_value_33.args[0][1]?.ctor === -6 && __wm_return_value_33.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_33.args[0][1].args[0]) && __wm_return_value_33.args[0][1].args[0].length === 2 && __wm_return_value_33.args[0][1].args[0][1] === __wm_basis_Nil) {
const texture_1185 = __wm_return_value_33.args[0][0];
const coordinate_1186 = __wm_return_value_33.args[0][1].args[0][0];
return (((emitAtom_1164__wm_d2(texture_1185, context_1181) + ".Load(") + emitAtom_1164__wm_d2(coordinate_1186, context_1181)) + ")");
} else if (true) {

return __wm_fail("Panic", "texture Load reached Slang emission with invalid arity");
}
__wm_fail("Match", "non-exhaustive match");
} else if (true) {

return __wm_fail("Panic", "resource call reached Slang emission without an operation");
}
__wm_fail("Match", "non-exhaustive match");
};
const emitResourceCall_1187 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitResourceCall_1187__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitProjection_1194__wm_d3 = (operation_1188, args_1189, context_1190) => {
const __wm_return_value_34 = args_1189;
if (__wm_return_value_34?.ctor === -6 && __wm_return_value_34.args.length === 1 && __wm_is_tuple(__wm_return_value_34.args[0]) && __wm_return_value_34.args[0].length === 2 && __wm_return_value_34.args[0][1] === __wm_basis_Nil) {
const atomId_1191 = __wm_return_value_34.args[0][0];
const atom_1192 = findAtom_944__wm_d2(context_1190.atoms, atomId_1191);
const sourceType_1193 = findType_886__wm_d2(context_1190.types, atom_1192.typeId);
if (__wm_eq(sourceType_1193.kind, "vector")) {
return ((emitAtom_1164__wm_d2(atomId_1191, context_1190) + ".") + vectorLaneName_885(operation_1188.index));
} else {
return ((emitAtom_1164__wm_d2(atomId_1191, context_1190) + ".") + tupleFieldName_862(operation_1188.index));
}
} else if (true) {

return __wm_fail("Panic", "projection reached Slang emission with invalid arity");
}
__wm_fail("Match", "non-exhaustive match");
};
const emitProjection_1194 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitProjection_1194__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitOperatorOperation_1204__wm_d3 = (operation_1195, args_1196, context_1197) => {
const signedMinimum_1200 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2 && __v.args[0][1] === __wm_basis_Nil) {
const atomId_1198 = __v.args[0][0];
const atom_1199 = findAtom_944__wm_d2(context_1197.atoms, atomId_1198);
return __wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(__wm_eq(operation_1195.operatorId, "gpu.operator.negate"), __wm_eq(atom_1199.kind, "number")), __wm_eq(atom_1199.numberKind, "i32")), numberEqual_145__wm_d2(atom_1199.numberValue, 2147483648));
} else if (true) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
})(args_1196);
if (signedMinimum_1200) {
return "int(-2147483648)";
} else {
const __wm_return_value_35 = args_1196;
if (__wm_return_value_35?.ctor === -6 && __wm_return_value_35.args.length === 1 && __wm_is_tuple(__wm_return_value_35.args[0]) && __wm_return_value_35.args[0].length === 2 && __wm_return_value_35.args[0][1] === __wm_basis_Nil) {
const left_1201 = __wm_return_value_35.args[0][0];
return ((("(" + operatorText_1178(operation_1195.operatorId)) + emitAtom_1164__wm_d2(left_1201, context_1197)) + ")");
} else if (__wm_return_value_35?.ctor === -6 && __wm_return_value_35.args.length === 1 && __wm_is_tuple(__wm_return_value_35.args[0]) && __wm_return_value_35.args[0].length === 2 && __wm_return_value_35.args[0][1]?.ctor === -6 && __wm_return_value_35.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_35.args[0][1].args[0]) && __wm_return_value_35.args[0][1].args[0].length === 2 && __wm_return_value_35.args[0][1].args[0][1] === __wm_basis_Nil) {
const left_1202 = __wm_return_value_35.args[0][0];
const right_1203 = __wm_return_value_35.args[0][1].args[0][0];
return (((((("(" + emitAtom_1164__wm_d2(left_1202, context_1197)) + " ") + operatorText_1178(operation_1195.operatorId)) + " ") + emitAtom_1164__wm_d2(right_1203, context_1197)) + ")");
} else if (true) {

return __wm_fail("Panic", "operator reached Slang emission with invalid arity");
}
__wm_fail("Match", "non-exhaustive match");
}
};
const emitOperatorOperation_1204 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitOperatorOperation_1204__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitOperation_1214__wm_d2 = (operation_1205, context_1206) => {
const args_1207 = Js.Array.toList(operation_1205.args);
const __wm_return_value_36 = operation_1205.kind;
if (__wm_return_value_36 === "uniform") {

const field_1208 = findEnvironmentField_899__wm_d3(context_1206.environmentFields, context_1206.input.root.environmentId, operation_1205.index);
const access_1209 = ("wm_uniforms." + uniformFieldName_870(field_1208.declaredIndex));
const gpuType_1210 = findType_886__wm_d2(context_1206.types, field_1208.typeId);
if (__wm_eq(gpuType_1210.kind, "bool")) {
return (("(" + access_1209) + " != 0)");
} else {
return access_1209;
}
} else if (__wm_return_value_36 === "resource") {

const field_1211 = findEnvironmentField_899__wm_d3(context_1206.environmentFields, context_1206.input.root.environmentId, operation_1205.index);
return resourceFieldName_872(field_1211.binding);
} else if (__wm_return_value_36 === "resource-call") {

return emitResourceCall_1187__wm_d3(operation_1205, args_1207, context_1206);
} else if (__wm_return_value_36 === "copy") {

return emitArgs_1165__wm_d3(args_1207, context_1206, "");
} else if (__wm_return_value_36 === "tuple") {

const resultType_1212 = findType_886__wm_d2(context_1206.types, operation_1205.typeId);
const constructor_1213 = (__wm_eq(resultType_1212.kind, "vector") ? vectorName_898__wm_d2(resultType_1212, context_1206) : tupleFactoryName_860(operation_1205.typeId));
return (((constructor_1213 + "(") + emitArgs_1165__wm_d3(args_1207, context_1206, "")) + ")");
} else if (__wm_return_value_36 === "project") {

return emitProjection_1194__wm_d3(operation_1205, args_1207, context_1206);
} else if (__wm_return_value_36 === "call") {

return (((functionName_856(operation_1205.targetFunctionId) + "(") + emitArgs_1165__wm_d3(args_1207, context_1206, "")) + ")");
} else if (__wm_return_value_36 === "convert") {

return (((typeName_1004__wm_d2(operation_1205.typeId, context_1206) + "(") + emitArgs_1165__wm_d3(args_1207, context_1206, "")) + ")");
} else if (__wm_return_value_36 === "builtin") {

return (((operation_1205.builtinName + "(") + emitArgs_1165__wm_d3(args_1207, context_1206, "")) + ")");
} else if (__wm_return_value_36 === "construct") {

return (((constructorName_866(operation_1205.constructorId) + "(") + emitArgs_1165__wm_d3(args_1207, context_1206, "")) + ")");
} else if (__wm_return_value_36 === "payload") {

return ((emitArgs_1165__wm_d3(args_1207, context_1206, "") + ".") + payloadFieldName_868(operation_1205.fieldId));
} else if (__wm_return_value_36 === "binary") {

return emitOperatorOperation_1204__wm_d3(operation_1205, args_1207, context_1206);
} else if (__wm_return_value_36 === "unary") {

return emitOperatorOperation_1204__wm_d3(operation_1205, args_1207, context_1206);
} else if (true) {

return __wm_fail("Panic", "unsupported Slang-emission operation");
}
__wm_fail("Match", "non-exhaustive match");
};
const emitOperation_1214 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitOperation_1214__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitBlockStatements_1215__wm_d4 = (statementIds_1220, indent_1221, context_1222, output_1223) => {
__wm_tail_68: while (true) {
{
const __wm_scalar_93_0 = statementIds_1220;
const __wm_scalar_93_1 = indent_1221;
const __wm_scalar_93_2 = context_1222;
const __wm_scalar_93_3 = output_1223;
if (__wm_scalar_93_0 === __wm_basis_Nil) {
const indent_1224 = __wm_scalar_93_1;
const context_1225 = __wm_scalar_93_2;
const output_1226 = __wm_scalar_93_3;
return output_1226;
} else if (__wm_scalar_93_0?.ctor === -6 && __wm_scalar_93_0.args.length === 1 && __wm_is_tuple(__wm_scalar_93_0.args[0]) && __wm_scalar_93_0.args[0].length === 2) {
const statementId_1227 = __wm_scalar_93_0.args[0][0];
const rest_1228 = __wm_scalar_93_0.args[0][1];
const indent_1229 = __wm_scalar_93_1;
const context_1230 = __wm_scalar_93_2;
const output_1231 = __wm_scalar_93_3;
{
const statement_1232 = findStatement_958__wm_d2(context_1230.statements, statementId_1227);
{
const __wm_tail_arg_76_0 = rest_1228;
const __wm_tail_arg_76_1 = indent_1229;
const __wm_tail_arg_76_2 = context_1230;
const __wm_tail_arg_76_3 = (output_1231 + emitStatement_1219__wm_d3(statement_1232, indent_1229, context_1230));
statementIds_1220 = __wm_tail_arg_76_0;
indent_1221 = __wm_tail_arg_76_1;
context_1222 = __wm_tail_arg_76_2;
output_1223 = __wm_tail_arg_76_3;
continue __wm_tail_68;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitBlockStatements_1215 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitBlockStatements_1215__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitBlock_1216__wm_d3 = (blockId_1233, indent_1234, context_1235) => {
const block_1236 = findBlock_965__wm_d2(context_1235.blocks, blockId_1233);
return emitBlockStatements_1215__wm_d4(Js.Array.toList(block_1236.statementIds), indent_1234, context_1235, "");
};
const emitBlock_1216 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitBlock_1216__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitCases_1217__wm_d4 = (caseIds_1237, indent_1238, context_1239, output_1240) => {
__wm_tail_69: while (true) {
{
const __wm_scalar_94_0 = caseIds_1237;
const __wm_scalar_94_1 = indent_1238;
const __wm_scalar_94_2 = context_1239;
const __wm_scalar_94_3 = output_1240;
if (__wm_scalar_94_0 === __wm_basis_Nil) {
const indent_1241 = __wm_scalar_94_1;
const context_1242 = __wm_scalar_94_2;
const output_1243 = __wm_scalar_94_3;
return output_1243;
} else if (__wm_scalar_94_0?.ctor === -6 && __wm_scalar_94_0.args.length === 1 && __wm_is_tuple(__wm_scalar_94_0.args[0]) && __wm_scalar_94_0.args[0].length === 2) {
const caseId_1244 = __wm_scalar_94_0.args[0][0];
const rest_1245 = __wm_scalar_94_0.args[0][1];
const indent_1246 = __wm_scalar_94_1;
const context_1247 = __wm_scalar_94_2;
const output_1248 = __wm_scalar_94_3;
{
const gpuCase_1249 = findCase_972__wm_d2(context_1247.cases, caseId_1244);
const item_1250 = ((((((((indent_1246 + "case ") + text_852(gpuCase_1249.tag)) + ": {\n") + emitBlock_1216__wm_d3(gpuCase_1249.blockId, (indent_1246 + "  "), context_1247)) + indent_1246) + "  break;\n") + indent_1246) + "}\n");
{
const __wm_tail_arg_77_0 = rest_1245;
const __wm_tail_arg_77_1 = indent_1246;
const __wm_tail_arg_77_2 = context_1247;
const __wm_tail_arg_77_3 = (output_1248 + item_1250);
caseIds_1237 = __wm_tail_arg_77_0;
indent_1238 = __wm_tail_arg_77_1;
context_1239 = __wm_tail_arg_77_2;
output_1240 = __wm_tail_arg_77_3;
continue __wm_tail_69;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitCases_1217 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return emitCases_1217__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const emitParallelAssignments_1218__wm_d5 = (targetIds_1251, valueIds_1252, indent_1253, context_1254, output_1255) => {
__wm_tail_70: while (true) {
{
const __wm_tail_value_78 = [targetIds_1251, valueIds_1252, indent_1253, context_1254, output_1255];
if (__wm_tail_value_78[0] === __wm_basis_Nil && __wm_tail_value_78[1] === __wm_basis_Nil) {
const indent_1256 = __wm_tail_value_78[2];
const context_1257 = __wm_tail_value_78[3];
const output_1258 = __wm_tail_value_78[4];
return output_1258;
} else if (__wm_tail_value_78[0]?.ctor === -6 && __wm_tail_value_78[0].args.length === 1 && __wm_is_tuple(__wm_tail_value_78[0].args[0]) && __wm_tail_value_78[0].args[0].length === 2 && __wm_tail_value_78[1]?.ctor === -6 && __wm_tail_value_78[1].args.length === 1 && __wm_is_tuple(__wm_tail_value_78[1].args[0]) && __wm_tail_value_78[1].args[0].length === 2) {
const targetId_1259 = __wm_tail_value_78[0].args[0][0];
const targetRest_1260 = __wm_tail_value_78[0].args[0][1];
const valueId_1261 = __wm_tail_value_78[1].args[0][0];
const valueRest_1262 = __wm_tail_value_78[1].args[0][1];
const indent_1263 = __wm_tail_value_78[2];
const context_1264 = __wm_tail_value_78[3];
const output_1265 = __wm_tail_value_78[4];
{
const __wm_tail_arg_79_0 = targetRest_1260;
const __wm_tail_arg_79_1 = valueRest_1262;
const __wm_tail_arg_79_2 = indent_1263;
const __wm_tail_arg_79_3 = context_1264;
const __wm_tail_arg_79_4 = (((((output_1265 + indent_1263) + localName_854(targetId_1259)) + " = ") + emitAtom_1164__wm_d2(valueId_1261, context_1264)) + ";\n");
targetIds_1251 = __wm_tail_arg_79_0;
valueIds_1252 = __wm_tail_arg_79_1;
indent_1253 = __wm_tail_arg_79_2;
context_1254 = __wm_tail_arg_79_3;
output_1255 = __wm_tail_arg_79_4;
continue __wm_tail_70;
}
} else if (true) {

return __wm_fail("Panic", "parallel tail update arity changed after validation");
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitParallelAssignments_1218 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return emitParallelAssignments_1218__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const emitStatement_1219__wm_d3 = (statement_1266, indent_1267, context_1268) => {
if (__wm_eq(statement_1266.kind, "let")) {
const local_1269 = findLocal_937__wm_d2(context_1268.locals, statement_1266.localId);
const operation_1270 = findOperation_951__wm_d2(context_1268.operations, statement_1266.operationId);
return ((((((indent_1267 + typeName_1004__wm_d2(local_1269.typeId, context_1268)) + " ") + localName_854(local_1269.id)) + " = ") + emitOperation_1214__wm_d2(operation_1270, context_1268)) + ";\n");
} else {
if (__wm_eq(statement_1266.kind, "assign")) {
return ((((indent_1267 + localName_854(statement_1266.localId)) + " = ") + emitAtom_1164__wm_d2(statement_1266.atomId, context_1268)) + ";\n");
} else {
if (__wm_eq(statement_1266.kind, "if")) {
const join_1272 = (numberEqual_145__wm_d2(statement_1266.localId, __wm_op_sub(1)) ? "" : (() => {
const local_1271 = findLocal_937__wm_d2(context_1268.locals, statement_1266.localId);
return ((((indent_1267 + typeName_1004__wm_d2(local_1271.typeId, context_1268)) + " ") + localName_854(local_1271.id)) + ";\n");
})());
return ((((((((((join_1272 + indent_1267) + "if (") + emitAtom_1164__wm_d2(statement_1266.conditionAtomId, context_1268)) + ") {\n") + emitBlock_1216__wm_d3(statement_1266.thenBlockId, (indent_1267 + "  "), context_1268)) + indent_1267) + "} else {\n") + emitBlock_1216__wm_d3(statement_1266.elseBlockId, (indent_1267 + "  "), context_1268)) + indent_1267) + "}\n");
} else {
if (__wm_eq(statement_1266.kind, "switch")) {
const join_1274 = (numberEqual_145__wm_d2(statement_1266.localId, __wm_op_sub(1)) ? "" : (() => {
const local_1273 = findLocal_937__wm_d2(context_1268.locals, statement_1266.localId);
return ((((indent_1267 + typeName_1004__wm_d2(local_1273.typeId, context_1268)) + " ") + localName_854(local_1273.id)) + ";\n");
})());
return (((((((join_1274 + indent_1267) + "switch (") + emitAtom_1164__wm_d2(statement_1266.scrutineeAtomId, context_1268)) + ".tag) {\n") + emitCases_1217__wm_d4(Js.Array.toList(statement_1266.caseIds), (indent_1267 + "  "), context_1268, "")) + indent_1267) + "}\n");
} else {
if (__wm_eq(statement_1266.kind, "loop")) {
return ((((((indent_1267 + "while (!") + recursiveDoneName_876(statement_1266.functionId)) + ") {\n") + emitBlock_1216__wm_d3(statement_1266.bodyBlockId, (indent_1267 + "  "), context_1268)) + indent_1267) + "}\n");
} else {
if (__wm_eq(statement_1266.kind, "continue")) {
return ((emitParallelAssignments_1218__wm_d5(Js.Array.toList(statement_1266.targetLocalIds), Js.Array.toList(statement_1266.valueAtomIds), indent_1267, context_1268, "") + indent_1267) + "continue;\n");
} else {
const atom_1275 = findAtom_944__wm_d2(context_1268.atoms, statement_1266.atomId);
if (__wm_eq(atom_1275.kind, "void")) {
if (numberEqual_145__wm_d2(context_1268.recursiveFunctionId, statement_1266.functionId)) {
return ((indent_1267 + recursiveDoneName_876(statement_1266.functionId)) + " = true;\n");
} else {
return (indent_1267 + "return;\n");
}
} else {
if (numberEqual_145__wm_d2(context_1268.recursiveFunctionId, statement_1266.functionId)) {
return (((((((indent_1267 + recursiveResultName_874(statement_1266.functionId)) + " = ") + emitAtom_1164__wm_d2(statement_1266.atomId, context_1268)) + ";\n") + indent_1267) + recursiveDoneName_876(statement_1266.functionId)) + " = true;\n");
} else {
return (((indent_1267 + "return ") + emitAtom_1164__wm_d2(statement_1266.atomId, context_1268)) + ";\n");
}
}
}
}
}
}
}
}
};
const emitStatement_1219 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitStatement_1219__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitFunctionParams_1276__wm_d3 = (localIds_1277, context_1278, output_1279) => {
__wm_tail_71: while (true) {
{
const __wm_scalar_95_0 = localIds_1277;
const __wm_scalar_95_1 = context_1278;
const __wm_scalar_95_2 = output_1279;
if (__wm_scalar_95_0 === __wm_basis_Nil) {
const context_1280 = __wm_scalar_95_1;
const output_1281 = __wm_scalar_95_2;
return output_1281;
} else if (__wm_scalar_95_0?.ctor === -6 && __wm_scalar_95_0.args.length === 1 && __wm_is_tuple(__wm_scalar_95_0.args[0]) && __wm_scalar_95_0.args[0].length === 2) {
const localId_1282 = __wm_scalar_95_0.args[0][0];
const rest_1283 = __wm_scalar_95_0.args[0][1];
const context_1284 = __wm_scalar_95_1;
const output_1285 = __wm_scalar_95_2;
{
const local_1286 = findLocal_937__wm_d2(context_1284.locals, localId_1282);
const parameter_1287 = ((typeName_1004__wm_d2(local_1286.typeId, context_1284) + " ") + localName_854(local_1286.id));
const next_1288 = (__wm_eq(output_1285, "") ? parameter_1287 : ((output_1285 + ", ") + parameter_1287));
{
const __wm_tail_arg_80_0 = rest_1283;
const __wm_tail_arg_80_1 = context_1284;
const __wm_tail_arg_80_2 = next_1288;
localIds_1277 = __wm_tail_arg_80_0;
context_1278 = __wm_tail_arg_80_1;
output_1279 = __wm_tail_arg_80_2;
continue __wm_tail_71;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitFunctionParams_1276 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitFunctionParams_1276__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitFunction_1297__wm_d2 = (fn_1289, context_1290) => {
const source_1291 = findSourceFunction_993__wm_d2(Js.Array.toList(context_1290.input.functions), fn_1289.functionId);
const functionContext_1292 = { ...context_1290, recursiveFunctionId: (fn_1289.recursive ? fn_1289.functionId : __wm_op_sub(1)) };
const resultType_1293 = findType_886__wm_d2(context_1290.types, source_1291.resultTypeId);
const recursivePrefix_1295 = (fn_1289.recursive ? (() => {
const result_1294 = (__wm_eq(resultType_1293.kind, "void") ? "" : (((("  " + typeName_1004__wm_d2(source_1291.resultTypeId, context_1290)) + " ") + recursiveResultName_874(fn_1289.functionId)) + ";\n"));
return (((result_1294 + "  bool ") + recursiveDoneName_876(fn_1289.functionId)) + " = false;\n");
})() : "");
const recursiveSuffix_1296 = (fn_1289.recursive ? (__wm_eq(resultType_1293.kind, "void") ? "  return;\n" : (("  return " + recursiveResultName_874(fn_1289.functionId)) + ";\n")) : "");
return (((((((((typeName_1004__wm_d2(source_1291.resultTypeId, context_1290) + " ") + functionName_856(fn_1289.functionId)) + "(") + emitFunctionParams_1276__wm_d3(Js.Array.toList(fn_1289.physicalParamLocalIds), context_1290, "")) + ") {\n") + recursivePrefix_1295) + emitBlock_1216__wm_d3(fn_1289.bodyBlockId, "  ", functionContext_1292)) + recursiveSuffix_1296) + "}\n\n");
};
const emitFunction_1297 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return emitFunction_1297__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emitFunctions_1298__wm_d3 = (functions_1299, context_1300, output_1301) => {
__wm_tail_72: while (true) {
{
const __wm_scalar_96_0 = functions_1299;
const __wm_scalar_96_1 = context_1300;
const __wm_scalar_96_2 = output_1301;
if (__wm_scalar_96_0 === __wm_basis_Nil) {
const context_1302 = __wm_scalar_96_1;
const output_1303 = __wm_scalar_96_2;
return output_1303;
} else if (__wm_scalar_96_0?.ctor === -6 && __wm_scalar_96_0.args.length === 1 && __wm_is_tuple(__wm_scalar_96_0.args[0]) && __wm_scalar_96_0.args[0].length === 2) {
const fn_1304 = __wm_scalar_96_0.args[0][0];
const rest_1305 = __wm_scalar_96_0.args[0][1];
const context_1306 = __wm_scalar_96_1;
const output_1307 = __wm_scalar_96_2;
{
const __wm_tail_arg_81_0 = rest_1305;
const __wm_tail_arg_81_1 = context_1306;
const __wm_tail_arg_81_2 = (output_1307 + emitFunction_1297__wm_d2(fn_1304, context_1306));
functions_1299 = __wm_tail_arg_81_0;
context_1300 = __wm_tail_arg_81_1;
output_1301 = __wm_tail_arg_81_2;
continue __wm_tail_72;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const emitFunctions_1298 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return emitFunctions_1298__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const emitWrappers_1314 = (__arg) => {
if (true) {
const context_1308 = __arg;
const input_1309 = context_1308.input;
const rootRow_1310 = input_1309.root;
const root_1311 = findFunction_979__wm_d2(context_1308.functions, rootRow_1310.functionId);
const __wm_return_value_37 = Js.Array.toList(root_1311.physicalParamLocalIds);
if (__wm_return_value_37?.ctor === -6 && __wm_return_value_37.args.length === 1 && __wm_is_tuple(__wm_return_value_37.args[0]) && __wm_return_value_37.args[0].length === 2 && __wm_return_value_37.args[0][1] === __wm_basis_Nil) {
const coordLocalId_1312 = __wm_return_value_37.args[0][0];
const coordLocal_1313 = findLocal_937__wm_d2(context_1308.locals, coordLocalId_1312);
return (((((((((((("[shader(\"vertex\")]\n" + "float4 wm_vertex(uint vertexID : SV_VertexID) : SV_Position {\n") + "  float2 uv = float2((vertexID << 1) & 2, vertexID & 2);\n") + "  return float4(uv * 2.0 - 1.0, 0.0, 1.0);\n") + "}\n\n") + "[shader(\"fragment\")]\n") + "float4 wm_fragment(float4 position : SV_Position) : SV_Target {\n") + "  return ") + functionName_856(root_1311.functionId)) + "(") + typeName_1004__wm_d2(coordLocal_1313.typeId, context_1308)) + "(position.x, position.y));\n") + "}\n");
} else if (true) {

return __wm_fail("Panic", "v1 fragment root does not have one physical coordinate parameter");
}
__wm_fail("Match", "non-exhaustive match");
}
__wm_fail("Match", "pattern match failure in function");
};
const emitSliceSlang_1326__wm_d10 = (input_1315, layouts_1316, fields_1317, functions_1318, locals_1319, atoms_1320, operations_1321, statements_1322, blocks_1323, cases_1324) => {
const context_1325 = { input: input_1315, environmentFields: Js.Array.toList(input_1315.environmentFields), types: Js.Array.toList(input_1315.types), constructors: Js.Array.toList(input_1315.constructors), layouts: Js.Array.toList(layouts_1316), fields: Js.Array.toList(fields_1317), functions: Js.Array.toList(functions_1318), locals: Js.Array.toList(locals_1319), atoms: Js.Array.toList(atoms_1320), operations: Js.Array.toList(operations_1321), statements: Js.Array.toList(statements_1322), blocks: Js.Array.toList(blocks_1323), cases: Js.Array.toList(cases_1324), recursiveFunctionId: __wm_op_sub(1) };
return ((((("// Generated by wmslang visual v2.\n\n" + emitTupleDeclarations_1090__wm_d3(context_1325.types, context_1325, "")) + emitLayoutDeclarations_1150__wm_d3(context_1325.layouts, context_1325, "")) + emitEnvironmentDeclaration_1035(context_1325)) + emitFunctions_1298__wm_d3(context_1325.functions, context_1325, "")) + emitWrappers_1314(context_1325));
};
const emitSliceSlang_1326 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return emitSliceSlang_1326__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
return { "SliceEmitContext": SliceEmitContext_850, "text": text_852, "localName": localName_854, "functionName": functionName_856, "tupleName": tupleName_858, "tupleFactoryName": tupleFactoryName_860, "tupleFieldName": tupleFieldName_862, "layoutName": layoutName_864, "constructorName": constructorName_866, "payloadFieldName": payloadFieldName_868, "uniformFieldName": uniformFieldName_870, "resourceFieldName": resourceFieldName_872, "recursiveResultName": recursiveResultName_874, "recursiveDoneName": recursiveDoneName_876, "listLength": listLength_877, "listLength__wm_d2": listLength_877__wm_d2, "vectorLaneName": vectorLaneName_885, "findType": findType_886, "findType__wm_d2": findType_886__wm_d2, "vectorName": vectorName_898, "vectorName__wm_d2": vectorName_898__wm_d2, "findEnvironmentField": findEnvironmentField_899, "findEnvironmentField__wm_d3": findEnvironmentField_899__wm_d3, "findLayout": findLayout_909, "findLayout__wm_d2": findLayout_909__wm_d2, "findLayoutByType": findLayoutByType_916, "findLayoutByType__wm_d2": findLayoutByType_916__wm_d2, "findField": findField_923, "findField__wm_d2": findField_923__wm_d2, "findConstructor": findConstructor_930, "findConstructor__wm_d2": findConstructor_930__wm_d2, "findLocal": findLocal_937, "findLocal__wm_d2": findLocal_937__wm_d2, "findAtom": findAtom_944, "findAtom__wm_d2": findAtom_944__wm_d2, "findOperation": findOperation_951, "findOperation__wm_d2": findOperation_951__wm_d2, "findStatement": findStatement_958, "findStatement__wm_d2": findStatement_958__wm_d2, "findBlock": findBlock_965, "findBlock__wm_d2": findBlock_965__wm_d2, "findCase": findCase_972, "findCase__wm_d2": findCase_972__wm_d2, "findFunction": findFunction_979, "findFunction__wm_d2": findFunction_979__wm_d2, "findAdtForEmit": findAdtForEmit_986, "findAdtForEmit__wm_d2": findAdtForEmit_986__wm_d2, "findSourceFunction": findSourceFunction_993, "findSourceFunction__wm_d2": findSourceFunction_993__wm_d2, "typeName": typeName_1004, "typeName__wm_d2": typeName_1004__wm_d2, "emitEnvironmentFields": emitEnvironmentFields_1005, "emitEnvironmentFields__wm_d3": emitEnvironmentFields_1005__wm_d3, "hasUniformField": hasUniformField_1017, "emitResourceDeclarations": emitResourceDeclarations_1021, "emitResourceDeclarations__wm_d3": emitResourceDeclarations_1021__wm_d3, "emitEnvironmentDeclaration": emitEnvironmentDeclaration_1035, "joinText": joinText_1036, "joinText__wm_d3": joinText_1036__wm_d3, "emitTupleFields": emitTupleFields_1047, "emitTupleFields__wm_d4": emitTupleFields_1047__wm_d4, "emitTupleParams": emitTupleParams_1060, "emitTupleParams__wm_d4": emitTupleParams_1060__wm_d4, "emitTupleAssignments": emitTupleAssignments_1075, "emitTupleAssignments__wm_d3": emitTupleAssignments_1075__wm_d3, "emitTupleDeclaration": emitTupleDeclaration_1089, "emitTupleDeclaration__wm_d2": emitTupleDeclaration_1089__wm_d2, "emitTupleDeclarations": emitTupleDeclarations_1090, "emitTupleDeclarations__wm_d3": emitTupleDeclarations_1090__wm_d3, "emitLayoutFields": emitLayoutFields_1101, "emitLayoutFields__wm_d3": emitLayoutFields_1101__wm_d3, "emitConstructorFieldAssignments": emitConstructorFieldAssignments_1112, "emitConstructorFieldAssignments__wm_d4": emitConstructorFieldAssignments_1112__wm_d4, "emitConstructorDeclaration": emitConstructorDeclaration_1131, "emitConstructorDeclaration__wm_d3": emitConstructorDeclaration_1131__wm_d3, "emitLayoutConstructors": emitLayoutConstructors_1132, "emitLayoutConstructors__wm_d4": emitLayoutConstructors_1132__wm_d4, "emitLayoutDeclaration": emitLayoutDeclaration_1149, "emitLayoutDeclaration__wm_d2": emitLayoutDeclaration_1149__wm_d2, "emitLayoutDeclarations": emitLayoutDeclarations_1150, "emitLayoutDeclarations__wm_d3": emitLayoutDeclarations_1150__wm_d3, "emitAtom": emitAtom_1164, "emitAtom__wm_d2": emitAtom_1164__wm_d2, "emitArgs": emitArgs_1165, "emitArgs__wm_d3": emitArgs_1165__wm_d3, "operatorText": operatorText_1178, "emitResourceCall": emitResourceCall_1187, "emitResourceCall__wm_d3": emitResourceCall_1187__wm_d3, "emitProjection": emitProjection_1194, "emitProjection__wm_d3": emitProjection_1194__wm_d3, "emitOperatorOperation": emitOperatorOperation_1204, "emitOperatorOperation__wm_d3": emitOperatorOperation_1204__wm_d3, "emitOperation": emitOperation_1214, "emitOperation__wm_d2": emitOperation_1214__wm_d2, "emitBlockStatements": emitBlockStatements_1215, "emitBlockStatements__wm_d4": emitBlockStatements_1215__wm_d4, "emitBlock": emitBlock_1216, "emitBlock__wm_d3": emitBlock_1216__wm_d3, "emitCases": emitCases_1217, "emitCases__wm_d4": emitCases_1217__wm_d4, "emitParallelAssignments": emitParallelAssignments_1218, "emitParallelAssignments__wm_d5": emitParallelAssignments_1218__wm_d5, "emitStatement": emitStatement_1219, "emitStatement__wm_d3": emitStatement_1219__wm_d3, "emitFunctionParams": emitFunctionParams_1276, "emitFunctionParams__wm_d3": emitFunctionParams_1276__wm_d3, "emitFunction": emitFunction_1297, "emitFunction__wm_d2": emitFunction_1297__wm_d2, "emitFunctions": emitFunctions_1298, "emitFunctions__wm_d3": emitFunctions_1298__wm_d3, "emitWrappers": emitWrappers_1314, "emitSliceSlang": emitSliceSlang_1326, "emitSliceSlang__wm_d10": emitSliceSlang_1326__wm_d10 };
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
const NumericContext_1327 = (__record_args) => ({ expressionOffset: __record_args[0], fieldOffset: __record_args[1], types: __record_args[2], expressions: __record_args[3], patterns: __record_args[4], params: __record_args[5], lets: __record_args[6], blocks: __record_args[7], functions: __record_args[8], environmentFields: __record_args[9] });
const NumericEvidence_1328 = (__record_args) => ({ representation: __record_args[0], spanId: __record_args[1] });
const numberEqual_1331__wm_d2 = (left_1329, right_1330) => {
return __wm_op_and_d2(__wm_op_not((left_1329 < right_1330)), __wm_op_not((left_1329 > right_1330)));
};
const numberEqual_1331 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numberEqual_1331__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const listLength_1332__wm_d2 = (items_1333, length_1334) => {
__wm_tail_73: while (true) {
{
const __wm_scalar_97_0 = items_1333;
const __wm_scalar_97_1 = length_1334;
if (__wm_scalar_97_0 === __wm_basis_Nil) {
const length_1335 = __wm_scalar_97_1;
return length_1335;
} else if (__wm_scalar_97_0?.ctor === -6 && __wm_scalar_97_0.args.length === 1 && __wm_is_tuple(__wm_scalar_97_0.args[0]) && __wm_scalar_97_0.args[0].length === 2) {
const __1336 = __wm_scalar_97_0.args[0][0];
const rest_1337 = __wm_scalar_97_0.args[0][1];
const length_1338 = __wm_scalar_97_1;
{
const __wm_tail_arg_82_0 = rest_1337;
const __wm_tail_arg_82_1 = (length_1338 + 1);
items_1333 = __wm_tail_arg_82_0;
length_1334 = __wm_tail_arg_82_1;
continue __wm_tail_73;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const listLength_1332 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return listLength_1332__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findType_1339__wm_d2 = (items_1340, id_1341) => {
__wm_tail_74: while (true) {
{
const __wm_scalar_98_0 = items_1340;
const __wm_scalar_98_1 = id_1341;
if (__wm_scalar_98_0 === __wm_basis_Nil) {
const id_1342 = __wm_scalar_98_1;
return __wm_fail("Panic", "missing numeric semantic type");
} else if (__wm_scalar_98_0?.ctor === -6 && __wm_scalar_98_0.args.length === 1 && __wm_is_tuple(__wm_scalar_98_0.args[0]) && __wm_scalar_98_0.args[0].length === 2) {
const item_1343 = __wm_scalar_98_0.args[0][0];
const rest_1344 = __wm_scalar_98_0.args[0][1];
const id_1345 = __wm_scalar_98_1;
if (numberEqual_1331__wm_d2(item_1343.id, id_1345)) {
return item_1343;
} else {
{
const __wm_tail_arg_83_0 = rest_1344;
const __wm_tail_arg_83_1 = id_1345;
items_1340 = __wm_tail_arg_83_0;
id_1341 = __wm_tail_arg_83_1;
continue __wm_tail_74;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findType_1339 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findType_1339__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const allNumberTypes_1346__wm_d2 = (typeIds_1347, types_1348) => {
const __wm_scalar_99_0 = typeIds_1347;
const __wm_scalar_99_1 = types_1348;
if (__wm_scalar_99_0 === __wm_basis_Nil) {
const types_1349 = __wm_scalar_99_1;
return true;
} else if (__wm_scalar_99_0?.ctor === -6 && __wm_scalar_99_0.args.length === 1 && __wm_is_tuple(__wm_scalar_99_0.args[0]) && __wm_scalar_99_0.args[0].length === 2) {
const typeId_1350 = __wm_scalar_99_0.args[0][0];
const rest_1351 = __wm_scalar_99_0.args[0][1];
const types_1352 = __wm_scalar_99_1;
const gpuType_1353 = findType_1339__wm_d2(types_1352, typeId_1350);
return __wm_op_and_d2(__wm_eq(gpuType_1353.kind, "number"), allNumberTypes_1346__wm_d2(rest_1351, types_1352));
}
__wm_fail("Match", "non-exhaustive match");
};
const allNumberTypes_1346 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return allNumberTypes_1346__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const numericType_1359__wm_d2 = (typeId_1354, context_1355) => {
const gpuType_1356 = findType_1339__wm_d2(context_1355.types, typeId_1354);
if (__wm_eq(gpuType_1356.kind, "number")) {
return true;
} else {
if (__wm_eq(gpuType_1356.kind, "tuple")) {
const items_1357 = Js.Array.toList(gpuType_1356.items);
const width_1358 = listLength_1332__wm_d2(items_1357, 0);
return __wm_op_and_d2(__wm_op_and_d2((width_1358 >= 2), (width_1358 <= 4)), allNumberTypes_1346__wm_d2(items_1357, context_1355.types));
} else {
return false;
}
}
};
const numericType_1359 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numericType_1359__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const expressionNode_1362__wm_d2 = (expression_1360, context_1361) => {
if (numericType_1359__wm_d2(expression_1360.typeId, context_1361)) {
return expression_1360.id;
} else {
return __wm_op_sub(1);
}
};
const expressionNode_1362 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return expressionNode_1362__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const patternNode_1365__wm_d2 = (pattern_1363, context_1364) => {
if (numericType_1359__wm_d2(pattern_1363.typeId, context_1364)) {
return (context_1364.expressionOffset + pattern_1363.id);
} else {
return __wm_op_sub(1);
}
};
const patternNode_1365 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return patternNode_1365__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const fieldNode_1368__wm_d2 = (field_1366, context_1367) => {
if (numericType_1359__wm_d2(field_1366.typeId, context_1367)) {
return (context_1367.fieldOffset + field_1366.id);
} else {
return __wm_op_sub(1);
}
};
const fieldNode_1368 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return fieldNode_1368__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const evidence_1371__wm_d2 = (representations_1369, node_1370) => {
if ((node_1370 < 0)) {
return __wm_basis_None;
} else {
return Map.get([representations_1369, node_1370]);
}
};
const evidence_1371 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return evidence_1371__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const representation_1375__wm_d2 = (representations_1372, node_1373) => {
const __wm_return_value_38 = evidence_1371__wm_d2(representations_1372, node_1373);
if (__wm_return_value_38?.ctor === -2 && __wm_return_value_38.args.length === 1) {
const value_1374 = __wm_return_value_38.args[0];
return value_1374.representation;
} else if (__wm_return_value_38 === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const representation_1375 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return representation_1375__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const numericConflict_1378__wm_d2 = (left_1376, right_1377) => {
return __wm_fail("Panic", ((((((("WM_GPU_NUMERIC_CONFLICT|" + Text.of(left_1376.spanId)) + "|") + Text.of(right_1377.spanId)) + "|") + left_1376.representation) + "|") + right_1377.representation));
};
const numericConflict_1378 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numericConflict_1378__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const setEvidence_1383__wm_d3 = (representations_1379, node_1380, value_1381) => {
if (__wm_op_or_d2((node_1380 < 0), __wm_eq(value_1381.representation, ""))) {
return [representations_1379, false];
} else {
const __wm_return_value_39 = evidence_1371__wm_d2(representations_1379, node_1380);
if (__wm_return_value_39 === __wm_basis_None) {

return [Map.set([representations_1379, node_1380, value_1381]), true];
} else if (__wm_return_value_39?.ctor === -2 && __wm_return_value_39.args.length === 1) {
const previous_1382 = __wm_return_value_39.args[0];
if (__wm_eq(previous_1382.representation, value_1381.representation)) {
return [representations_1379, false];
} else {
return numericConflict_1378__wm_d2(previous_1382, value_1381);
}
}
__wm_fail("Match", "non-exhaustive match");
}
};
const setEvidence_1383 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return setEvidence_1383__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setRepresentation_1389__wm_d4 = (representations_1384, node_1385, value_1386, spanId_1387) => {
const item_1388 = { representation: value_1386, spanId: spanId_1387 };
return setEvidence_1383__wm_d3(representations_1384, node_1385, item_1388);
};
const setRepresentation_1389 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setRepresentation_1389__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const combinedEvidence_1390__wm_d3 = (nodes_1391, representations_1392, combined_1393) => {
__wm_tail_75: while (true) {
{
const __wm_scalar_100_0 = nodes_1391;
const __wm_scalar_100_1 = representations_1392;
const __wm_scalar_100_2 = combined_1393;
if (__wm_scalar_100_0 === __wm_basis_Nil) {
const representations_1394 = __wm_scalar_100_1;
const combined_1395 = __wm_scalar_100_2;
return combined_1395;
} else if (__wm_scalar_100_0?.ctor === -6 && __wm_scalar_100_0.args.length === 1 && __wm_is_tuple(__wm_scalar_100_0.args[0]) && __wm_scalar_100_0.args[0].length === 2) {
const node_1396 = __wm_scalar_100_0.args[0][0];
const rest_1397 = __wm_scalar_100_0.args[0][1];
const representations_1398 = __wm_scalar_100_1;
const combined_1399 = __wm_scalar_100_2;
{
const __wm_tail_value_84 = evidence_1371__wm_d2(representations_1398, node_1396);
if (__wm_tail_value_84 === __wm_basis_None) {

{
const __wm_tail_arg_85_0 = rest_1397;
const __wm_tail_arg_85_1 = representations_1398;
const __wm_tail_arg_85_2 = combined_1399;
nodes_1391 = __wm_tail_arg_85_0;
representations_1392 = __wm_tail_arg_85_1;
combined_1393 = __wm_tail_arg_85_2;
continue __wm_tail_75;
}
} else if (__wm_tail_value_84?.ctor === -2 && __wm_tail_value_84.args.length === 1) {
const value_1400 = __wm_tail_value_84.args[0];
{
const __wm_tail_value_86 = combined_1399;
if (__wm_tail_value_86 === __wm_basis_None) {

{
const __wm_tail_arg_87_0 = rest_1397;
const __wm_tail_arg_87_1 = representations_1398;
const __wm_tail_arg_87_2 = __wm_basis_Some(value_1400);
nodes_1391 = __wm_tail_arg_87_0;
representations_1392 = __wm_tail_arg_87_1;
combined_1393 = __wm_tail_arg_87_2;
continue __wm_tail_75;
}
} else if (__wm_tail_value_86?.ctor === -2 && __wm_tail_value_86.args.length === 1) {
const previous_1401 = __wm_tail_value_86.args[0];
if (__wm_eq(previous_1401.representation, value_1400.representation)) {
{
const __wm_tail_arg_88_0 = rest_1397;
const __wm_tail_arg_88_1 = representations_1398;
const __wm_tail_arg_88_2 = combined_1399;
nodes_1391 = __wm_tail_arg_88_0;
representations_1392 = __wm_tail_arg_88_1;
combined_1393 = __wm_tail_arg_88_2;
continue __wm_tail_75;
}
} else {
return numericConflict_1378__wm_d2(previous_1401, value_1400);
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
const combinedEvidence_1390 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return combinedEvidence_1390__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setGroup_1402__wm_d4 = (nodes_1403, value_1404, representations_1405, changed_1406) => {
__wm_tail_76: while (true) {
{
const __wm_scalar_101_0 = nodes_1403;
const __wm_scalar_101_1 = value_1404;
const __wm_scalar_101_2 = representations_1405;
const __wm_scalar_101_3 = changed_1406;
if (__wm_scalar_101_0 === __wm_basis_Nil) {
const value_1407 = __wm_scalar_101_1;
const representations_1408 = __wm_scalar_101_2;
const changed_1409 = __wm_scalar_101_3;
return [representations_1408, changed_1409];
} else if (__wm_scalar_101_0?.ctor === -6 && __wm_scalar_101_0.args.length === 1 && __wm_is_tuple(__wm_scalar_101_0.args[0]) && __wm_scalar_101_0.args[0].length === 2) {
const node_1410 = __wm_scalar_101_0.args[0][0];
const rest_1411 = __wm_scalar_101_0.args[0][1];
const value_1412 = __wm_scalar_101_1;
const representations_1413 = __wm_scalar_101_2;
const changed_1414 = __wm_scalar_101_3;
{
const __wm_bind_54 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const item_1415 = __v.args[0];
return setEvidence_1383__wm_d3(representations_1413, node_1410, item_1415);
} else if (__v === __wm_basis_None) {

return [representations_1413, false];
}
__wm_fail("Match", "non-exhaustive match");
})(value_1412);
if (!(__wm_is_tuple(__wm_bind_54) && __wm_bind_54.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1416 = __wm_bind_54[0];
const itemChanged_1417 = __wm_bind_54[1];
{
const __wm_tail_arg_89_0 = rest_1411;
const __wm_tail_arg_89_1 = value_1412;
const __wm_tail_arg_89_2 = next_1416;
const __wm_tail_arg_89_3 = __wm_op_or_d2(changed_1414, itemChanged_1417);
nodes_1403 = __wm_tail_arg_89_0;
value_1404 = __wm_tail_arg_89_1;
representations_1405 = __wm_tail_arg_89_2;
changed_1406 = __wm_tail_arg_89_3;
continue __wm_tail_76;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const setGroup_1402 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setGroup_1402__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeGroup_1421__wm_d2 = (nodes_1418, representations_1419) => {
const value_1420 = combinedEvidence_1390__wm_d3(nodes_1418, representations_1419, __wm_basis_None);
return setGroup_1402__wm_d4(nodes_1418, value_1420, representations_1419, false);
};
const mergeGroup_1421 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return mergeGroup_1421__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findPatternByBinding_1422__wm_d3 = (patterns_1423, bindingId_1424, ownerFunctionId_1425) => {
__wm_tail_77: while (true) {
{
const __wm_scalar_102_0 = patterns_1423;
const __wm_scalar_102_1 = bindingId_1424;
const __wm_scalar_102_2 = ownerFunctionId_1425;
if (__wm_scalar_102_0 === __wm_basis_Nil) {
const bindingId_1426 = __wm_scalar_102_1;
const ownerFunctionId_1427 = __wm_scalar_102_2;
return __wm_basis_None;
} else if (__wm_scalar_102_0?.ctor === -6 && __wm_scalar_102_0.args.length === 1 && __wm_is_tuple(__wm_scalar_102_0.args[0]) && __wm_scalar_102_0.args[0].length === 2) {
const pattern_1428 = __wm_scalar_102_0.args[0][0];
const rest_1429 = __wm_scalar_102_0.args[0][1];
const bindingId_1430 = __wm_scalar_102_1;
const ownerFunctionId_1431 = __wm_scalar_102_2;
if (__wm_op_and_d2(numberEqual_1331__wm_d2(pattern_1428.bindingId, bindingId_1430), numberEqual_1331__wm_d2(pattern_1428.ownerFunctionId, ownerFunctionId_1431))) {
return __wm_basis_Some(pattern_1428);
} else {
{
const __wm_tail_arg_90_0 = rest_1429;
const __wm_tail_arg_90_1 = bindingId_1430;
const __wm_tail_arg_90_2 = ownerFunctionId_1431;
patterns_1423 = __wm_tail_arg_90_0;
bindingId_1424 = __wm_tail_arg_90_1;
ownerFunctionId_1425 = __wm_tail_arg_90_2;
continue __wm_tail_77;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findPatternByBinding_1422 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findPatternByBinding_1422__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const findParam_1432__wm_d2 = (params_1433, id_1434) => {
__wm_tail_78: while (true) {
{
const __wm_scalar_103_0 = params_1433;
const __wm_scalar_103_1 = id_1434;
if (__wm_scalar_103_0 === __wm_basis_Nil) {
const id_1435 = __wm_scalar_103_1;
return __wm_fail("Panic", "missing numeric function parameter");
} else if (__wm_scalar_103_0?.ctor === -6 && __wm_scalar_103_0.args.length === 1 && __wm_is_tuple(__wm_scalar_103_0.args[0]) && __wm_scalar_103_0.args[0].length === 2) {
const param_1436 = __wm_scalar_103_0.args[0][0];
const rest_1437 = __wm_scalar_103_0.args[0][1];
const id_1438 = __wm_scalar_103_1;
if (numberEqual_1331__wm_d2(param_1436.id, id_1438)) {
return param_1436;
} else {
{
const __wm_tail_arg_91_0 = rest_1437;
const __wm_tail_arg_91_1 = id_1438;
params_1433 = __wm_tail_arg_91_0;
id_1434 = __wm_tail_arg_91_1;
continue __wm_tail_78;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findParam_1432 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findParam_1432__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findPattern_1439__wm_d2 = (patterns_1440, id_1441) => {
__wm_tail_79: while (true) {
{
const __wm_scalar_104_0 = patterns_1440;
const __wm_scalar_104_1 = id_1441;
if (__wm_scalar_104_0 === __wm_basis_Nil) {
const id_1442 = __wm_scalar_104_1;
return __wm_fail("Panic", "missing numeric pattern");
} else if (__wm_scalar_104_0?.ctor === -6 && __wm_scalar_104_0.args.length === 1 && __wm_is_tuple(__wm_scalar_104_0.args[0]) && __wm_scalar_104_0.args[0].length === 2) {
const pattern_1443 = __wm_scalar_104_0.args[0][0];
const rest_1444 = __wm_scalar_104_0.args[0][1];
const id_1445 = __wm_scalar_104_1;
if (numberEqual_1331__wm_d2(pattern_1443.id, id_1445)) {
return pattern_1443;
} else {
{
const __wm_tail_arg_92_0 = rest_1444;
const __wm_tail_arg_92_1 = id_1445;
patterns_1440 = __wm_tail_arg_92_0;
id_1441 = __wm_tail_arg_92_1;
continue __wm_tail_79;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findPattern_1439 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findPattern_1439__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findFunction_1446__wm_d2 = (functions_1447, id_1448) => {
__wm_tail_80: while (true) {
{
const __wm_scalar_105_0 = functions_1447;
const __wm_scalar_105_1 = id_1448;
if (__wm_scalar_105_0 === __wm_basis_Nil) {
const id_1449 = __wm_scalar_105_1;
return __wm_fail("Panic", "missing numeric function");
} else if (__wm_scalar_105_0?.ctor === -6 && __wm_scalar_105_0.args.length === 1 && __wm_is_tuple(__wm_scalar_105_0.args[0]) && __wm_scalar_105_0.args[0].length === 2) {
const fn_1450 = __wm_scalar_105_0.args[0][0];
const rest_1451 = __wm_scalar_105_0.args[0][1];
const id_1452 = __wm_scalar_105_1;
if (numberEqual_1331__wm_d2(fn_1450.id, id_1452)) {
return fn_1450;
} else {
{
const __wm_tail_arg_93_0 = rest_1451;
const __wm_tail_arg_93_1 = id_1452;
functions_1447 = __wm_tail_arg_93_0;
id_1448 = __wm_tail_arg_93_1;
continue __wm_tail_80;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findFunction_1446 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findFunction_1446__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findExpression_1453__wm_d2 = (expressions_1454, id_1455) => {
__wm_tail_81: while (true) {
{
const __wm_scalar_106_0 = expressions_1454;
const __wm_scalar_106_1 = id_1455;
if (__wm_scalar_106_0 === __wm_basis_Nil) {
const id_1456 = __wm_scalar_106_1;
return __wm_fail("Panic", "missing numeric expression");
} else if (__wm_scalar_106_0?.ctor === -6 && __wm_scalar_106_0.args.length === 1 && __wm_is_tuple(__wm_scalar_106_0.args[0]) && __wm_scalar_106_0.args[0].length === 2) {
const expression_1457 = __wm_scalar_106_0.args[0][0];
const rest_1458 = __wm_scalar_106_0.args[0][1];
const id_1459 = __wm_scalar_106_1;
if (numberEqual_1331__wm_d2(expression_1457.id, id_1459)) {
return expression_1457;
} else {
{
const __wm_tail_arg_94_0 = rest_1458;
const __wm_tail_arg_94_1 = id_1459;
expressions_1454 = __wm_tail_arg_94_0;
id_1455 = __wm_tail_arg_94_1;
continue __wm_tail_81;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findExpression_1453 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findExpression_1453__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findBlock_1460__wm_d2 = (blocks_1461, expressionId_1462) => {
__wm_tail_82: while (true) {
{
const __wm_scalar_107_0 = blocks_1461;
const __wm_scalar_107_1 = expressionId_1462;
if (__wm_scalar_107_0 === __wm_basis_Nil) {
const expressionId_1463 = __wm_scalar_107_1;
return __wm_fail("Panic", "missing numeric block");
} else if (__wm_scalar_107_0?.ctor === -6 && __wm_scalar_107_0.args.length === 1 && __wm_is_tuple(__wm_scalar_107_0.args[0]) && __wm_scalar_107_0.args[0].length === 2) {
const block_1464 = __wm_scalar_107_0.args[0][0];
const rest_1465 = __wm_scalar_107_0.args[0][1];
const expressionId_1466 = __wm_scalar_107_1;
if (numberEqual_1331__wm_d2(block_1464.expressionId, expressionId_1466)) {
return block_1464;
} else {
{
const __wm_tail_arg_95_0 = rest_1465;
const __wm_tail_arg_95_1 = expressionId_1466;
blocks_1461 = __wm_tail_arg_95_0;
expressionId_1462 = __wm_tail_arg_95_1;
continue __wm_tail_82;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findBlock_1460 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findBlock_1460__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findEnvironmentField_1467__wm_d2 = (fields_1468, declaredIndex_1469) => {
__wm_tail_83: while (true) {
{
const __wm_scalar_108_0 = fields_1468;
const __wm_scalar_108_1 = declaredIndex_1469;
if (__wm_scalar_108_0 === __wm_basis_Nil) {
const declaredIndex_1470 = __wm_scalar_108_1;
return __wm_fail("Panic", "missing numeric environment field");
} else if (__wm_scalar_108_0?.ctor === -6 && __wm_scalar_108_0.args.length === 1 && __wm_is_tuple(__wm_scalar_108_0.args[0]) && __wm_scalar_108_0.args[0].length === 2) {
const field_1471 = __wm_scalar_108_0.args[0][0];
const rest_1472 = __wm_scalar_108_0.args[0][1];
const declaredIndex_1473 = __wm_scalar_108_1;
if (numberEqual_1331__wm_d2(field_1471.declaredIndex, declaredIndex_1473)) {
return field_1471;
} else {
{
const __wm_tail_arg_96_0 = rest_1472;
const __wm_tail_arg_96_1 = declaredIndex_1473;
fields_1468 = __wm_tail_arg_96_0;
declaredIndex_1469 = __wm_tail_arg_96_1;
continue __wm_tail_83;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findEnvironmentField_1467 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findEnvironmentField_1467__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const numericChildNodes_1474__wm_d3 = (children_1475, context_1476, nodes_1477) => {
__wm_tail_84: while (true) {
{
const __wm_scalar_109_0 = children_1475;
const __wm_scalar_109_1 = context_1476;
const __wm_scalar_109_2 = nodes_1477;
if (__wm_scalar_109_0 === __wm_basis_Nil) {
const context_1478 = __wm_scalar_109_1;
const nodes_1479 = __wm_scalar_109_2;
return nodes_1479;
} else if (__wm_scalar_109_0?.ctor === -6 && __wm_scalar_109_0.args.length === 1 && __wm_is_tuple(__wm_scalar_109_0.args[0]) && __wm_scalar_109_0.args[0].length === 2) {
const childId_1480 = __wm_scalar_109_0.args[0][0];
const rest_1481 = __wm_scalar_109_0.args[0][1];
const context_1482 = __wm_scalar_109_1;
const nodes_1483 = __wm_scalar_109_2;
{
const child_1484 = findExpression_1453__wm_d2(context_1482.expressions, childId_1480);
const node_1485 = expressionNode_1362__wm_d2(child_1484, context_1482);
{
const __wm_tail_arg_97_0 = rest_1481;
const __wm_tail_arg_97_1 = context_1482;
const __wm_tail_arg_97_2 = ((node_1485 < 0) ? nodes_1483 : __wm_basis_Cons([node_1485, nodes_1483]));
children_1475 = __wm_tail_arg_97_0;
context_1476 = __wm_tail_arg_97_1;
nodes_1477 = __wm_tail_arg_97_2;
continue __wm_tail_84;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const numericChildNodes_1474 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return numericChildNodes_1474__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const ownAndChildren_1490__wm_d2 = (expression_1486, context_1487) => {
const own_1488 = expressionNode_1362__wm_d2(expression_1486, context_1487);
const children_1489 = numericChildNodes_1474__wm_d3(Js.Array.toList(expression_1486.children), context_1487, __wm_basis_Nil);
if ((own_1488 < 0)) {
return children_1489;
} else {
return __wm_basis_Cons([own_1488, children_1489]);
}
};
const ownAndChildren_1490 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return ownAndChildren_1490__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeArguments_1491__wm_d5 = (argumentIds_1492, paramIds_1493, context_1494, representations_1495, changed_1496) => {
__wm_tail_85: while (true) {
{
const __wm_scalar_110_0 = argumentIds_1492;
const __wm_scalar_110_1 = paramIds_1493;
const __wm_scalar_110_2 = context_1494;
const __wm_scalar_110_3 = representations_1495;
const __wm_scalar_110_4 = changed_1496;
if (__wm_scalar_110_0 === __wm_basis_Nil) {
const context_1497 = __wm_scalar_110_2;
const representations_1498 = __wm_scalar_110_3;
const changed_1499 = __wm_scalar_110_4;
return [representations_1498, changed_1499];
} else if (__wm_scalar_110_1 === __wm_basis_Nil) {
const context_1500 = __wm_scalar_110_2;
const representations_1501 = __wm_scalar_110_3;
const changed_1502 = __wm_scalar_110_4;
return [representations_1501, changed_1502];
} else if (__wm_scalar_110_0?.ctor === -6 && __wm_scalar_110_0.args.length === 1 && __wm_is_tuple(__wm_scalar_110_0.args[0]) && __wm_scalar_110_0.args[0].length === 2 && __wm_scalar_110_1?.ctor === -6 && __wm_scalar_110_1.args.length === 1 && __wm_is_tuple(__wm_scalar_110_1.args[0]) && __wm_scalar_110_1.args[0].length === 2) {
const argumentId_1503 = __wm_scalar_110_0.args[0][0];
const argumentRest_1504 = __wm_scalar_110_0.args[0][1];
const paramId_1505 = __wm_scalar_110_1.args[0][0];
const paramRest_1506 = __wm_scalar_110_1.args[0][1];
const context_1507 = __wm_scalar_110_2;
const representations_1508 = __wm_scalar_110_3;
const changed_1509 = __wm_scalar_110_4;
{
const argument_1510 = findExpression_1453__wm_d2(context_1507.expressions, argumentId_1503);
const param_1511 = findParam_1432__wm_d2(context_1507.params, paramId_1505);
const pattern_1512 = findPattern_1439__wm_d2(context_1507.patterns, param_1511.patternId);
const __wm_bind_55 = mergeGroup_1421__wm_d2(__wm_basis_Cons([expressionNode_1362__wm_d2(argument_1510, context_1507), __wm_basis_Cons([patternNode_1365__wm_d2(pattern_1512, context_1507), __wm_basis_Nil])]), representations_1508);
if (!(__wm_is_tuple(__wm_bind_55) && __wm_bind_55.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1513 = __wm_bind_55[0];
const pairChanged_1514 = __wm_bind_55[1];
{
const __wm_tail_arg_98_0 = argumentRest_1504;
const __wm_tail_arg_98_1 = paramRest_1506;
const __wm_tail_arg_98_2 = context_1507;
const __wm_tail_arg_98_3 = next_1513;
const __wm_tail_arg_98_4 = __wm_op_or_d2(changed_1509, pairChanged_1514);
argumentIds_1492 = __wm_tail_arg_98_0;
paramIds_1493 = __wm_tail_arg_98_1;
context_1494 = __wm_tail_arg_98_2;
representations_1495 = __wm_tail_arg_98_3;
changed_1496 = __wm_tail_arg_98_4;
continue __wm_tail_85;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const mergeArguments_1491 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return mergeArguments_1491__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const applyExpression_1526__wm_d3 = (expression_1515, context_1516, representations_1517) => {
if (__wm_eq(expression_1515.kind, "var")) {
const __wm_return_value_40 = findPatternByBinding_1422__wm_d3(context_1516.patterns, expression_1515.bindingId, expression_1515.ownerFunctionId);
if (__wm_return_value_40?.ctor === -2 && __wm_return_value_40.args.length === 1) {
const pattern_1518 = __wm_return_value_40.args[0];
return mergeGroup_1421__wm_d2(__wm_basis_Cons([expressionNode_1362__wm_d2(expression_1515, context_1516), __wm_basis_Cons([patternNode_1365__wm_d2(pattern_1518, context_1516), __wm_basis_Nil])]), representations_1517);
} else if (__wm_return_value_40 === __wm_basis_None) {

return [representations_1517, false];
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_eq(expression_1515.kind, "uniform")) {
const field_1519 = findEnvironmentField_1467__wm_d2(context_1516.environmentFields, expression_1515.index);
return mergeGroup_1421__wm_d2(__wm_basis_Cons([expressionNode_1362__wm_d2(expression_1515, context_1516), __wm_basis_Cons([fieldNode_1368__wm_d2(field_1519, context_1516), __wm_basis_Nil])]), representations_1517);
} else {
if (__wm_op_or_d2(__wm_op_or_d2(__wm_op_or_d2(__wm_op_or_d2(__wm_op_or_d2(__wm_eq(expression_1515.kind, "project"), __wm_eq(expression_1515.kind, "copy")), __wm_eq(expression_1515.kind, "tuple")), __wm_eq(expression_1515.kind, "binary")), __wm_eq(expression_1515.kind, "unary")), __wm_eq(expression_1515.kind, "builtin"))) {
return mergeGroup_1421__wm_d2(ownAndChildren_1490__wm_d2(expression_1515, context_1516), representations_1517);
} else {
if (__wm_eq(expression_1515.kind, "if")) {
return mergeGroup_1421__wm_d2(ownAndChildren_1490__wm_d2(expression_1515, context_1516), representations_1517);
} else {
if (__wm_eq(expression_1515.kind, "block")) {
const block_1520 = findBlock_1460__wm_d2(context_1516.blocks, expression_1515.id);
const result_1521 = findExpression_1453__wm_d2(context_1516.expressions, block_1520.resultExprId);
return mergeGroup_1421__wm_d2(__wm_basis_Cons([expressionNode_1362__wm_d2(expression_1515, context_1516), __wm_basis_Cons([expressionNode_1362__wm_d2(result_1521, context_1516), __wm_basis_Nil])]), representations_1517);
} else {
if (__wm_eq(expression_1515.kind, "call")) {
const target_1522 = findFunction_1446__wm_d2(context_1516.functions, expression_1515.functionId);
const body_1523 = findExpression_1453__wm_d2(context_1516.expressions, target_1522.bodyExprId);
const __wm_bind_56 = mergeGroup_1421__wm_d2(__wm_basis_Cons([expressionNode_1362__wm_d2(expression_1515, context_1516), __wm_basis_Cons([expressionNode_1362__wm_d2(body_1523, context_1516), __wm_basis_Nil])]), representations_1517);
if (!(__wm_is_tuple(__wm_bind_56) && __wm_bind_56.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withResult_1524 = __wm_bind_56[0];
const resultChanged_1525 = __wm_bind_56[1];
return mergeArguments_1491__wm_d5(Js.Array.toList(expression_1515.children), Js.Array.toList(target_1522.paramIds), context_1516, withResult_1524, resultChanged_1525);
} else {
return [representations_1517, false];
}
}
}
}
}
}
};
const applyExpression_1526 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return applyExpression_1526__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const expressionSweep_1527__wm_d4 = (expressions_1528, context_1529, representations_1530, changed_1531) => {
__wm_tail_86: while (true) {
{
const __wm_scalar_111_0 = expressions_1528;
const __wm_scalar_111_1 = context_1529;
const __wm_scalar_111_2 = representations_1530;
const __wm_scalar_111_3 = changed_1531;
if (__wm_scalar_111_0 === __wm_basis_Nil) {
const context_1532 = __wm_scalar_111_1;
const representations_1533 = __wm_scalar_111_2;
const changed_1534 = __wm_scalar_111_3;
return [representations_1533, changed_1534];
} else if (__wm_scalar_111_0?.ctor === -6 && __wm_scalar_111_0.args.length === 1 && __wm_is_tuple(__wm_scalar_111_0.args[0]) && __wm_scalar_111_0.args[0].length === 2) {
const expression_1535 = __wm_scalar_111_0.args[0][0];
const rest_1536 = __wm_scalar_111_0.args[0][1];
const context_1537 = __wm_scalar_111_1;
const representations_1538 = __wm_scalar_111_2;
const changed_1539 = __wm_scalar_111_3;
{
const __wm_bind_57 = applyExpression_1526__wm_d3(expression_1535, context_1537, representations_1538);
if (!(__wm_is_tuple(__wm_bind_57) && __wm_bind_57.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1540 = __wm_bind_57[0];
const itemChanged_1541 = __wm_bind_57[1];
{
const __wm_tail_arg_99_0 = rest_1536;
const __wm_tail_arg_99_1 = context_1537;
const __wm_tail_arg_99_2 = next_1540;
const __wm_tail_arg_99_3 = __wm_op_or_d2(changed_1539, itemChanged_1541);
expressions_1528 = __wm_tail_arg_99_0;
context_1529 = __wm_tail_arg_99_1;
representations_1530 = __wm_tail_arg_99_2;
changed_1531 = __wm_tail_arg_99_3;
continue __wm_tail_86;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const expressionSweep_1527 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return expressionSweep_1527__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const patternSweep_1542__wm_d4 = (patterns_1544, context_1545, representations_1546, changed_1547) => {
__wm_tail_87: while (true) {
{
const __wm_scalar_112_0 = patterns_1544;
const __wm_scalar_112_1 = context_1545;
const __wm_scalar_112_2 = representations_1546;
const __wm_scalar_112_3 = changed_1547;
if (__wm_scalar_112_0 === __wm_basis_Nil) {
const context_1548 = __wm_scalar_112_1;
const representations_1549 = __wm_scalar_112_2;
const changed_1550 = __wm_scalar_112_3;
return [representations_1549, changed_1550];
} else if (__wm_scalar_112_0?.ctor === -6 && __wm_scalar_112_0.args.length === 1 && __wm_is_tuple(__wm_scalar_112_0.args[0]) && __wm_scalar_112_0.args[0].length === 2) {
const pattern_1551 = __wm_scalar_112_0.args[0][0];
const rest_1552 = __wm_scalar_112_0.args[0][1];
const context_1553 = __wm_scalar_112_1;
const representations_1554 = __wm_scalar_112_2;
const changed_1555 = __wm_scalar_112_3;
{
const childNodes_1556 = mapPatternNodes_1543__wm_d3(Js.Array.toList(pattern_1551.children), context_1553, __wm_basis_Nil);
const own_1557 = patternNode_1365__wm_d2(pattern_1551, context_1553);
const nodes_1558 = ((own_1557 < 0) ? childNodes_1556 : __wm_basis_Cons([own_1557, childNodes_1556]));
const __wm_bind_58 = (__wm_eq(pattern_1551.kind, "tuple") ? mergeGroup_1421__wm_d2(nodes_1558, representations_1554) : [representations_1554, false]);
if (!(__wm_is_tuple(__wm_bind_58) && __wm_bind_58.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1559 = __wm_bind_58[0];
const itemChanged_1560 = __wm_bind_58[1];
{
const __wm_tail_arg_100_0 = rest_1552;
const __wm_tail_arg_100_1 = context_1553;
const __wm_tail_arg_100_2 = next_1559;
const __wm_tail_arg_100_3 = __wm_op_or_d2(changed_1555, itemChanged_1560);
patterns_1544 = __wm_tail_arg_100_0;
context_1545 = __wm_tail_arg_100_1;
representations_1546 = __wm_tail_arg_100_2;
changed_1547 = __wm_tail_arg_100_3;
continue __wm_tail_87;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const patternSweep_1542 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return patternSweep_1542__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const mapPatternNodes_1543__wm_d3 = (ids_1561, context_1562, nodes_1563) => {
__wm_tail_88: while (true) {
{
const __wm_scalar_113_0 = ids_1561;
const __wm_scalar_113_1 = context_1562;
const __wm_scalar_113_2 = nodes_1563;
if (__wm_scalar_113_0 === __wm_basis_Nil) {
const context_1564 = __wm_scalar_113_1;
const nodes_1565 = __wm_scalar_113_2;
return nodes_1565;
} else if (__wm_scalar_113_0?.ctor === -6 && __wm_scalar_113_0.args.length === 1 && __wm_is_tuple(__wm_scalar_113_0.args[0]) && __wm_scalar_113_0.args[0].length === 2) {
const id_1566 = __wm_scalar_113_0.args[0][0];
const rest_1567 = __wm_scalar_113_0.args[0][1];
const context_1568 = __wm_scalar_113_1;
const nodes_1569 = __wm_scalar_113_2;
{
const pattern_1570 = findPattern_1439__wm_d2(context_1568.patterns, id_1566);
const node_1571 = patternNode_1365__wm_d2(pattern_1570, context_1568);
{
const __wm_tail_arg_101_0 = rest_1567;
const __wm_tail_arg_101_1 = context_1568;
const __wm_tail_arg_101_2 = ((node_1571 < 0) ? nodes_1569 : __wm_basis_Cons([node_1571, nodes_1569]));
ids_1561 = __wm_tail_arg_101_0;
context_1562 = __wm_tail_arg_101_1;
nodes_1563 = __wm_tail_arg_101_2;
continue __wm_tail_88;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const mapPatternNodes_1543 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return mapPatternNodes_1543__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const letSweep_1572__wm_d4 = (lets_1573, context_1574, representations_1575, changed_1576) => {
__wm_tail_89: while (true) {
{
const __wm_scalar_114_0 = lets_1573;
const __wm_scalar_114_1 = context_1574;
const __wm_scalar_114_2 = representations_1575;
const __wm_scalar_114_3 = changed_1576;
if (__wm_scalar_114_0 === __wm_basis_Nil) {
const context_1577 = __wm_scalar_114_1;
const representations_1578 = __wm_scalar_114_2;
const changed_1579 = __wm_scalar_114_3;
return [representations_1578, changed_1579];
} else if (__wm_scalar_114_0?.ctor === -6 && __wm_scalar_114_0.args.length === 1 && __wm_is_tuple(__wm_scalar_114_0.args[0]) && __wm_scalar_114_0.args[0].length === 2) {
const binding_1580 = __wm_scalar_114_0.args[0][0];
const rest_1581 = __wm_scalar_114_0.args[0][1];
const context_1582 = __wm_scalar_114_1;
const representations_1583 = __wm_scalar_114_2;
const changed_1584 = __wm_scalar_114_3;
{
const pattern_1585 = findPattern_1439__wm_d2(context_1582.patterns, binding_1580.patternId);
const value_1586 = findExpression_1453__wm_d2(context_1582.expressions, binding_1580.valueExprId);
const __wm_bind_59 = mergeGroup_1421__wm_d2(__wm_basis_Cons([patternNode_1365__wm_d2(pattern_1585, context_1582), __wm_basis_Cons([expressionNode_1362__wm_d2(value_1586, context_1582), __wm_basis_Nil])]), representations_1583);
if (!(__wm_is_tuple(__wm_bind_59) && __wm_bind_59.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1587 = __wm_bind_59[0];
const itemChanged_1588 = __wm_bind_59[1];
{
const __wm_tail_arg_102_0 = rest_1581;
const __wm_tail_arg_102_1 = context_1582;
const __wm_tail_arg_102_2 = next_1587;
const __wm_tail_arg_102_3 = __wm_op_or_d2(changed_1584, itemChanged_1588);
lets_1573 = __wm_tail_arg_102_0;
context_1574 = __wm_tail_arg_102_1;
representations_1575 = __wm_tail_arg_102_2;
changed_1576 = __wm_tail_arg_102_3;
continue __wm_tail_89;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const letSweep_1572 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return letSweep_1572__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const seedExpressions_1589__wm_d3 = (expressions_1590, context_1591, representations_1592) => {
__wm_tail_90: while (true) {
{
const __wm_scalar_115_0 = expressions_1590;
const __wm_scalar_115_1 = context_1591;
const __wm_scalar_115_2 = representations_1592;
if (__wm_scalar_115_0 === __wm_basis_Nil) {
const context_1593 = __wm_scalar_115_1;
const representations_1594 = __wm_scalar_115_2;
return representations_1594;
} else if (__wm_scalar_115_0?.ctor === -6 && __wm_scalar_115_0.args.length === 1 && __wm_is_tuple(__wm_scalar_115_0.args[0]) && __wm_scalar_115_0.args[0].length === 2) {
const expression_1595 = __wm_scalar_115_0.args[0][0];
const rest_1596 = __wm_scalar_115_0.args[0][1];
const context_1597 = __wm_scalar_115_1;
const representations_1598 = __wm_scalar_115_2;
{
const explicit_1599 = (__wm_eq(expression_1595.semanticId, "gpu.i32") ? "i32" : (__wm_eq(expression_1595.semanticId, "gpu.f32") ? "f32" : expression_1595.numberKind));
const __wm_bind_60 = setRepresentation_1389__wm_d4(representations_1598, expressionNode_1362__wm_d2(expression_1595, context_1597), explicit_1599, expression_1595.spanId);
if (!(__wm_is_tuple(__wm_bind_60) && __wm_bind_60.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const next_1600 = __wm_bind_60[0];
const _changed_1601 = __wm_bind_60[1];
const withResourceResult_1604 = (__wm_eq(expression_1595.kind, "resource-call") ? (() => {
const __wm_bind_61 = setRepresentation_1389__wm_d4(next_1600, expressionNode_1362__wm_d2(expression_1595, context_1597), "f32", expression_1595.spanId);
if (!(__wm_is_tuple(__wm_bind_61) && __wm_bind_61.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const updated_1602 = __wm_bind_61[0];
const _resourceChanged_1603 = __wm_bind_61[1];
return updated_1602;
})() : next_1600);
const withResourceCoordinate_1615 = (__wm_eq(expression_1595.kind, "resource-call") ? (() => {
const coordinateId_1610 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2 && __v.args[0][1]?.ctor === -6 && __v.args[0][1].args.length === 1 && __wm_is_tuple(__v.args[0][1].args[0]) && __v.args[0][1].args[0].length === 2 && __v.args[0][1].args[0][1]?.ctor === -6 && __v.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__v.args[0][1].args[0][1].args[0]) && __v.args[0][1].args[0][1].args[0].length === 2 && __v.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const _texture_1605 = __v.args[0][0];
const _sampler_1606 = __v.args[0][1].args[0][0];
const id_1607 = __v.args[0][1].args[0][1].args[0][0];
return id_1607;
} else if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2 && __v.args[0][1]?.ctor === -6 && __v.args[0][1].args.length === 1 && __wm_is_tuple(__v.args[0][1].args[0]) && __v.args[0][1].args[0].length === 2 && __v.args[0][1].args[0][1] === __wm_basis_Nil) {
const _texture_1608 = __v.args[0][0];
const id_1609 = __v.args[0][1].args[0][0];
return id_1609;
} else if (true) {

return __wm_fail("Panic", "GPU resource call has invalid coordinate arity");
}
__wm_fail("Match", "non-exhaustive match");
})(Js.Array.toList(expression_1595.children));
const coordinate_1611 = findExpression_1453__wm_d2(context_1597.expressions, coordinateId_1610);
const coordinateRepresentation_1612 = (__wm_eq(expression_1595.resourceOperation, "load") ? "i32" : "f32");
const __wm_bind_62 = setRepresentation_1389__wm_d4(withResourceResult_1604, expressionNode_1362__wm_d2(coordinate_1611, context_1597), coordinateRepresentation_1612, coordinate_1611.spanId);
if (!(__wm_is_tuple(__wm_bind_62) && __wm_bind_62.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const updated_1613 = __wm_bind_62[0];
const _coordinateChanged_1614 = __wm_bind_62[1];
return updated_1613;
})() : withResourceResult_1604);
{
const __wm_tail_arg_103_0 = rest_1596;
const __wm_tail_arg_103_1 = context_1597;
const __wm_tail_arg_103_2 = withResourceCoordinate_1615;
expressions_1590 = __wm_tail_arg_103_0;
context_1591 = __wm_tail_arg_103_1;
representations_1592 = __wm_tail_arg_103_2;
continue __wm_tail_90;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const seedExpressions_1589 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return seedExpressions_1589__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const seedFragmentAbi_1630__wm_d3 = (input_1616, context_1617, representations_1618) => {
const root_1619 = findFunction_1446__wm_d2(context_1617.functions, input_1616.root.functionId);
const firstParamId_1622 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2) {
const id_1620 = __v.args[0][0];
const __1621 = __v.args[0][1];
return id_1620;
} else if (__v === __wm_basis_Nil) {

return __wm_fail("Panic", "fragment root has no coordinate parameter");
}
__wm_fail("Match", "non-exhaustive match");
})(Js.Array.toList(root_1619.paramIds));
const param_1623 = findParam_1432__wm_d2(context_1617.params, firstParamId_1622);
const pattern_1624 = findPattern_1439__wm_d2(context_1617.patterns, param_1623.patternId);
const body_1625 = findExpression_1453__wm_d2(context_1617.expressions, root_1619.bodyExprId);
const __wm_bind_63 = setRepresentation_1389__wm_d4(representations_1618, patternNode_1365__wm_d2(pattern_1624, context_1617), "f32", pattern_1624.spanId);
if (!(__wm_is_tuple(__wm_bind_63) && __wm_bind_63.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withCoord_1626 = __wm_bind_63[0];
const _coordChanged_1627 = __wm_bind_63[1];
const __wm_bind_64 = setRepresentation_1389__wm_d4(withCoord_1626, expressionNode_1362__wm_d2(body_1625, context_1617), "f32", body_1625.spanId);
if (!(__wm_is_tuple(__wm_bind_64) && __wm_bind_64.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withResult_1628 = __wm_bind_64[0];
const _resultChanged_1629 = __wm_bind_64[1];
return withResult_1628;
};
const seedFragmentAbi_1630 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return seedFragmentAbi_1630__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const solveFixedPoint_1631__wm_d2 = (context_1632, representations_1633) => {
__wm_tail_91: while (true) {
{
const __wm_bind_65 = expressionSweep_1527__wm_d4(context_1632.expressions, context_1632, representations_1633, false);
if (!(__wm_is_tuple(__wm_bind_65) && __wm_bind_65.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterExpressions_1634 = __wm_bind_65[0];
const expressionChanged_1635 = __wm_bind_65[1];
const __wm_bind_66 = patternSweep_1542__wm_d4(context_1632.patterns, context_1632, afterExpressions_1634, false);
if (!(__wm_is_tuple(__wm_bind_66) && __wm_bind_66.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterPatterns_1636 = __wm_bind_66[0];
const patternChanged_1637 = __wm_bind_66[1];
const __wm_bind_67 = letSweep_1572__wm_d4(context_1632.lets, context_1632, afterPatterns_1636, false);
if (!(__wm_is_tuple(__wm_bind_67) && __wm_bind_67.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterLets_1638 = __wm_bind_67[0];
const letChanged_1639 = __wm_bind_67[1];
if (__wm_op_or_d2(__wm_op_or_d2(expressionChanged_1635, patternChanged_1637), letChanged_1639)) {
{
const __wm_tail_arg_104_0 = context_1632;
const __wm_tail_arg_104_1 = afterLets_1638;
context_1632 = __wm_tail_arg_104_0;
representations_1633 = __wm_tail_arg_104_1;
continue __wm_tail_91;
}
} else {
return afterLets_1638;
}
}
}
};
const solveFixedPoint_1631 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return solveFixedPoint_1631__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const ensureExpressionsResolved_1640__wm_d3 = (expressions_1641, context_1642, representations_1643) => {
__wm_tail_92: while (true) {
{
const __wm_scalar_116_0 = expressions_1641;
const __wm_scalar_116_1 = context_1642;
const __wm_scalar_116_2 = representations_1643;
if (__wm_scalar_116_0 === __wm_basis_Nil) {
const context_1644 = __wm_scalar_116_1;
const representations_1645 = __wm_scalar_116_2;
return undefined;
} else if (__wm_scalar_116_0?.ctor === -6 && __wm_scalar_116_0.args.length === 1 && __wm_is_tuple(__wm_scalar_116_0.args[0]) && __wm_scalar_116_0.args[0].length === 2) {
const expression_1646 = __wm_scalar_116_0.args[0][0];
const rest_1647 = __wm_scalar_116_0.args[0][1];
const context_1648 = __wm_scalar_116_1;
const representations_1649 = __wm_scalar_116_2;
{
const node_1650 = expressionNode_1362__wm_d2(expression_1646, context_1648);
if (__wm_op_and_d2((node_1650 >= 0), __wm_eq(representation_1375__wm_d2(representations_1649, node_1650), ""))) {
return __wm_fail("Panic", ((("WM_GPU_NUMERIC_UNRESOLVED|" + Text.of(expression_1646.spanId)) + "|expression ") + Text.of(expression_1646.id)));
} else {
{
const __wm_tail_arg_105_0 = rest_1647;
const __wm_tail_arg_105_1 = context_1648;
const __wm_tail_arg_105_2 = representations_1649;
expressions_1641 = __wm_tail_arg_105_0;
context_1642 = __wm_tail_arg_105_1;
representations_1643 = __wm_tail_arg_105_2;
continue __wm_tail_92;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const ensureExpressionsResolved_1640 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return ensureExpressionsResolved_1640__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const ensurePatternsResolved_1651__wm_d3 = (patterns_1652, context_1653, representations_1654) => {
__wm_tail_93: while (true) {
{
const __wm_scalar_117_0 = patterns_1652;
const __wm_scalar_117_1 = context_1653;
const __wm_scalar_117_2 = representations_1654;
if (__wm_scalar_117_0 === __wm_basis_Nil) {
const context_1655 = __wm_scalar_117_1;
const representations_1656 = __wm_scalar_117_2;
return undefined;
} else if (__wm_scalar_117_0?.ctor === -6 && __wm_scalar_117_0.args.length === 1 && __wm_is_tuple(__wm_scalar_117_0.args[0]) && __wm_scalar_117_0.args[0].length === 2) {
const pattern_1657 = __wm_scalar_117_0.args[0][0];
const rest_1658 = __wm_scalar_117_0.args[0][1];
const context_1659 = __wm_scalar_117_1;
const representations_1660 = __wm_scalar_117_2;
{
const node_1661 = patternNode_1365__wm_d2(pattern_1657, context_1659);
if (__wm_op_and_d2((node_1661 >= 0), __wm_eq(representation_1375__wm_d2(representations_1660, node_1661), ""))) {
return __wm_fail("Panic", ((("WM_GPU_NUMERIC_UNRESOLVED|" + Text.of(pattern_1657.spanId)) + "|pattern ") + Text.of(pattern_1657.id)));
} else {
{
const __wm_tail_arg_106_0 = rest_1658;
const __wm_tail_arg_106_1 = context_1659;
const __wm_tail_arg_106_2 = representations_1660;
patterns_1652 = __wm_tail_arg_106_0;
context_1653 = __wm_tail_arg_106_1;
representations_1654 = __wm_tail_arg_106_2;
continue __wm_tail_93;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const ensurePatternsResolved_1651 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return ensurePatternsResolved_1651__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const ensureFieldsResolved_1662__wm_d3 = (fields_1663, context_1664, representations_1665) => {
__wm_tail_94: while (true) {
{
const __wm_scalar_118_0 = fields_1663;
const __wm_scalar_118_1 = context_1664;
const __wm_scalar_118_2 = representations_1665;
if (__wm_scalar_118_0 === __wm_basis_Nil) {
const context_1666 = __wm_scalar_118_1;
const representations_1667 = __wm_scalar_118_2;
return undefined;
} else if (__wm_scalar_118_0?.ctor === -6 && __wm_scalar_118_0.args.length === 1 && __wm_is_tuple(__wm_scalar_118_0.args[0]) && __wm_scalar_118_0.args[0].length === 2) {
const field_1668 = __wm_scalar_118_0.args[0][0];
const rest_1669 = __wm_scalar_118_0.args[0][1];
const context_1670 = __wm_scalar_118_1;
const representations_1671 = __wm_scalar_118_2;
{
const node_1672 = fieldNode_1368__wm_d2(field_1668, context_1670);
if (__wm_op_and_d2((node_1672 >= 0), __wm_eq(representation_1375__wm_d2(representations_1671, node_1672), ""))) {
return __wm_fail("Panic", ((("WM_GPU_NUMERIC_UNRESOLVED|" + Text.of(field_1668.spanId)) + "|environment field ") + field_1668.name));
} else {
{
const __wm_tail_arg_107_0 = rest_1669;
const __wm_tail_arg_107_1 = context_1670;
const __wm_tail_arg_107_2 = representations_1671;
fields_1663 = __wm_tail_arg_107_0;
context_1664 = __wm_tail_arg_107_1;
representations_1665 = __wm_tail_arg_107_2;
continue __wm_tail_94;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const ensureFieldsResolved_1662 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return ensureFieldsResolved_1662__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const solveSliceNumericRepresentations_1680 = (__arg) => {
if (true) {
const input_1673 = __arg;
const expressions_1674 = Js.Array.toList(input_1673.expressions);
const patterns_1675 = Js.Array.toList(input_1673.patterns);
const expressionOffset_1676 = listLength_1332__wm_d2(expressions_1674, 0);
const context_1677 = { expressionOffset: expressionOffset_1676, fieldOffset: (expressionOffset_1676 + listLength_1332__wm_d2(patterns_1675, 0)), types: Js.Array.toList(input_1673.types), expressions: expressions_1674, patterns: patterns_1675, params: Js.Array.toList(input_1673.params), lets: Js.Array.toList(input_1673.lets), blocks: Js.Array.toList(input_1673.blocks), functions: Js.Array.toList(input_1673.functions), environmentFields: Js.Array.toList(input_1673.environmentFields) };
const seeded_1678 = seedExpressions_1589__wm_d3(expressions_1674, context_1677, Map.empty(Map.numberCompare));
const solved_1679 = solveFixedPoint_1631__wm_d2(context_1677, seedFragmentAbi_1630__wm_d3(input_1673, context_1677, seeded_1678));
ensureExpressionsResolved_1640__wm_d3(expressions_1674, context_1677, solved_1679);
ensurePatternsResolved_1651__wm_d3(patterns_1675, context_1677, solved_1679);
ensureFieldsResolved_1662__wm_d3(context_1677.environmentFields, context_1677, solved_1679);
return solved_1679;
}
__wm_fail("Match", "pattern match failure in function");
};
const expressionRepresentation_1683__wm_d2 = (representations_1681, expressionId_1682) => {
return representation_1375__wm_d2(representations_1681, expressionId_1682);
};
const expressionRepresentation_1683 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return expressionRepresentation_1683__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const patternRepresentation_1687__wm_d3 = (representations_1684, expressionCount_1685, patternId_1686) => {
return representation_1375__wm_d2(representations_1684, (expressionCount_1685 + patternId_1686));
};
const patternRepresentation_1687 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return patternRepresentation_1687__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
return { "NumericContext": NumericContext_1327, "NumericEvidence": NumericEvidence_1328, "numberEqual": numberEqual_1331, "numberEqual__wm_d2": numberEqual_1331__wm_d2, "listLength": listLength_1332, "listLength__wm_d2": listLength_1332__wm_d2, "findType": findType_1339, "findType__wm_d2": findType_1339__wm_d2, "allNumberTypes": allNumberTypes_1346, "allNumberTypes__wm_d2": allNumberTypes_1346__wm_d2, "numericType": numericType_1359, "numericType__wm_d2": numericType_1359__wm_d2, "expressionNode": expressionNode_1362, "expressionNode__wm_d2": expressionNode_1362__wm_d2, "patternNode": patternNode_1365, "patternNode__wm_d2": patternNode_1365__wm_d2, "fieldNode": fieldNode_1368, "fieldNode__wm_d2": fieldNode_1368__wm_d2, "evidence": evidence_1371, "evidence__wm_d2": evidence_1371__wm_d2, "representation": representation_1375, "representation__wm_d2": representation_1375__wm_d2, "numericConflict": numericConflict_1378, "numericConflict__wm_d2": numericConflict_1378__wm_d2, "setEvidence": setEvidence_1383, "setEvidence__wm_d3": setEvidence_1383__wm_d3, "setRepresentation": setRepresentation_1389, "setRepresentation__wm_d4": setRepresentation_1389__wm_d4, "combinedEvidence": combinedEvidence_1390, "combinedEvidence__wm_d3": combinedEvidence_1390__wm_d3, "setGroup": setGroup_1402, "setGroup__wm_d4": setGroup_1402__wm_d4, "mergeGroup": mergeGroup_1421, "mergeGroup__wm_d2": mergeGroup_1421__wm_d2, "findPatternByBinding": findPatternByBinding_1422, "findPatternByBinding__wm_d3": findPatternByBinding_1422__wm_d3, "findParam": findParam_1432, "findParam__wm_d2": findParam_1432__wm_d2, "findPattern": findPattern_1439, "findPattern__wm_d2": findPattern_1439__wm_d2, "findFunction": findFunction_1446, "findFunction__wm_d2": findFunction_1446__wm_d2, "findExpression": findExpression_1453, "findExpression__wm_d2": findExpression_1453__wm_d2, "findBlock": findBlock_1460, "findBlock__wm_d2": findBlock_1460__wm_d2, "findEnvironmentField": findEnvironmentField_1467, "findEnvironmentField__wm_d2": findEnvironmentField_1467__wm_d2, "numericChildNodes": numericChildNodes_1474, "numericChildNodes__wm_d3": numericChildNodes_1474__wm_d3, "ownAndChildren": ownAndChildren_1490, "ownAndChildren__wm_d2": ownAndChildren_1490__wm_d2, "mergeArguments": mergeArguments_1491, "mergeArguments__wm_d5": mergeArguments_1491__wm_d5, "applyExpression": applyExpression_1526, "applyExpression__wm_d3": applyExpression_1526__wm_d3, "expressionSweep": expressionSweep_1527, "expressionSweep__wm_d4": expressionSweep_1527__wm_d4, "patternSweep": patternSweep_1542, "patternSweep__wm_d4": patternSweep_1542__wm_d4, "mapPatternNodes": mapPatternNodes_1543, "mapPatternNodes__wm_d3": mapPatternNodes_1543__wm_d3, "letSweep": letSweep_1572, "letSweep__wm_d4": letSweep_1572__wm_d4, "seedExpressions": seedExpressions_1589, "seedExpressions__wm_d3": seedExpressions_1589__wm_d3, "seedFragmentAbi": seedFragmentAbi_1630, "seedFragmentAbi__wm_d3": seedFragmentAbi_1630__wm_d3, "solveFixedPoint": solveFixedPoint_1631, "solveFixedPoint__wm_d2": solveFixedPoint_1631__wm_d2, "ensureExpressionsResolved": ensureExpressionsResolved_1640, "ensureExpressionsResolved__wm_d3": ensureExpressionsResolved_1640__wm_d3, "ensurePatternsResolved": ensurePatternsResolved_1651, "ensurePatternsResolved__wm_d3": ensurePatternsResolved_1651__wm_d3, "ensureFieldsResolved": ensureFieldsResolved_1662, "ensureFieldsResolved__wm_d3": ensureFieldsResolved_1662__wm_d3, "solveSliceNumericRepresentations": solveSliceNumericRepresentations_1680, "expressionRepresentation": expressionRepresentation_1683, "expressionRepresentation__wm_d2": expressionRepresentation_1683__wm_d2, "patternRepresentation": patternRepresentation_1687, "patternRepresentation__wm_d3": patternRepresentation_1687__wm_d3 };
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
const lowerSliceProgram_849 = __wm_module_3["lowerSliceProgram"];
const lowerSliceProgram_849__wm_d8 = __wm_module_3["lowerSliceProgram__wm_d8"];
const emitSliceSlang_1326 = __wm_module_4["emitSliceSlang"];
const emitSliceSlang_1326__wm_d10 = __wm_module_4["emitSliceSlang__wm_d10"];
const NumericEvidence_1328 = __wm_module_5["NumericEvidence"];
const expressionRepresentation_1683 = __wm_module_5["expressionRepresentation"];
const expressionRepresentation_1683__wm_d2 = __wm_module_5["expressionRepresentation__wm_d2"];
const patternRepresentation_1687 = __wm_module_5["patternRepresentation"];
const patternRepresentation_1687__wm_d3 = __wm_module_5["patternRepresentation__wm_d3"];
const solveSliceNumericRepresentations_1680 = __wm_module_5["solveSliceNumericRepresentations"];
const SliceContext_1688 = (__record_args) => ({ expressions: __record_args[0], blocks: __record_args[1], blockItems: __record_args[2], lets: __record_args[3], matches: __record_args[4], matchArms: __record_args[5], patterns: __record_args[6], types: __record_args[7], adts: __record_args[8], functions: __record_args[9], builtinOverloads: __record_args[10], occurrences: __record_args[11] });
const SliceIrState_1689 = (__record_args) => ({ nextExpressionId: __record_args[0], nextArmId: __record_args[1], functions: __record_args[2], expressions: __record_args[3], matchArms: __record_args[4], diagnostics: __record_args[5] });
const BuiltBlockItem_1690 = (__record_args) => ({ itemId: __record_args[0], valueExprId: __record_args[1] });
const reverseInto_1691__wm_d2 = (items_1692, reversed_1693) => {
__wm_tail_95: while (true) {
{
const __wm_scalar_119_0 = items_1692;
const __wm_scalar_119_1 = reversed_1693;
if (__wm_scalar_119_0 === __wm_basis_Nil) {
const reversed_1694 = __wm_scalar_119_1;
return reversed_1694;
} else if (__wm_scalar_119_0?.ctor === -6 && __wm_scalar_119_0.args.length === 1 && __wm_is_tuple(__wm_scalar_119_0.args[0]) && __wm_scalar_119_0.args[0].length === 2) {
const head_1695 = __wm_scalar_119_0.args[0][0];
const rest_1696 = __wm_scalar_119_0.args[0][1];
const reversed_1697 = __wm_scalar_119_1;
{
const __wm_tail_arg_108_0 = rest_1696;
const __wm_tail_arg_108_1 = __wm_basis_Cons([head_1695, reversed_1697]);
items_1692 = __wm_tail_arg_108_0;
reversed_1693 = __wm_tail_arg_108_1;
continue __wm_tail_95;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reverseInto_1691 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reverseInto_1691__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const append_1698__wm_d2 = (left_1699, right_1700) => {
const __wm_scalar_120_0 = left_1699;
const __wm_scalar_120_1 = right_1700;
if (__wm_scalar_120_0 === __wm_basis_Nil) {
const right_1701 = __wm_scalar_120_1;
return right_1701;
} else if (__wm_scalar_120_0?.ctor === -6 && __wm_scalar_120_0.args.length === 1 && __wm_is_tuple(__wm_scalar_120_0.args[0]) && __wm_scalar_120_0.args[0].length === 2) {
const head_1702 = __wm_scalar_120_0.args[0][0];
const rest_1703 = __wm_scalar_120_0.args[0][1];
const right_1704 = __wm_scalar_120_1;
return __wm_basis_Cons([head_1702, append_1698__wm_d2(rest_1703, right_1704)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const append_1698 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return append_1698__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const listLength_1705__wm_d2 = (items_1706, length_1707) => {
__wm_tail_96: while (true) {
{
const __wm_scalar_121_0 = items_1706;
const __wm_scalar_121_1 = length_1707;
if (__wm_scalar_121_0 === __wm_basis_Nil) {
const length_1708 = __wm_scalar_121_1;
return length_1708;
} else if (__wm_scalar_121_0?.ctor === -6 && __wm_scalar_121_0.args.length === 1 && __wm_is_tuple(__wm_scalar_121_0.args[0]) && __wm_scalar_121_0.args[0].length === 2) {
const __1709 = __wm_scalar_121_0.args[0][0];
const rest_1710 = __wm_scalar_121_0.args[0][1];
const length_1711 = __wm_scalar_121_1;
{
const __wm_tail_arg_109_0 = rest_1710;
const __wm_tail_arg_109_1 = (length_1711 + 1);
items_1706 = __wm_tail_arg_109_0;
length_1707 = __wm_tail_arg_109_1;
continue __wm_tail_96;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const listLength_1705 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return listLength_1705__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const numberEqual_1714__wm_d2 = (left_1712, right_1713) => {
return __wm_op_and_d2(__wm_op_not((left_1712 < right_1713)), __wm_op_not((left_1712 > right_1713)));
};
const numberEqual_1714 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return numberEqual_1714__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const contains_1715__wm_d2 = (items_1716, expected_1717) => {
__wm_tail_97: while (true) {
{
const __wm_tail_value_110 = items_1716;
if (__wm_tail_value_110 === __wm_basis_Nil) {

return false;
} else if (__wm_tail_value_110?.ctor === -6 && __wm_tail_value_110.args.length === 1 && __wm_is_tuple(__wm_tail_value_110.args[0]) && __wm_tail_value_110.args[0].length === 2) {
const head_1718 = __wm_tail_value_110.args[0][0];
const rest_1719 = __wm_tail_value_110.args[0][1];
if (numberEqual_1714__wm_d2(head_1718, expected_1717)) {
return true;
} else {
{
const __wm_tail_arg_111_0 = rest_1719;
const __wm_tail_arg_111_1 = expected_1717;
items_1716 = __wm_tail_arg_111_0;
expected_1717 = __wm_tail_arg_111_1;
continue __wm_tail_97;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const contains_1715 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return contains_1715__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const unique_1720__wm_d2 = (items_1721, seen_1722) => {
__wm_tail_98: while (true) {
{
const __wm_tail_value_112 = items_1721;
if (__wm_tail_value_112 === __wm_basis_Nil) {

return true;
} else if (__wm_tail_value_112?.ctor === -6 && __wm_tail_value_112.args.length === 1 && __wm_is_tuple(__wm_tail_value_112.args[0]) && __wm_tail_value_112.args[0].length === 2) {
const head_1723 = __wm_tail_value_112.args[0][0];
const rest_1724 = __wm_tail_value_112.args[0][1];
if (contains_1715__wm_d2(seen_1722, head_1723)) {
return false;
} else {
{
const __wm_tail_arg_113_0 = rest_1724;
const __wm_tail_arg_113_1 = __wm_basis_Cons([head_1723, seen_1722]);
items_1721 = __wm_tail_arg_113_0;
seen_1722 = __wm_tail_arg_113_1;
continue __wm_tail_98;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const unique_1720 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return unique_1720__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findExpression_1725__wm_d2 = (items_1726, id_1727) => {
__wm_tail_99: while (true) {
{
const __wm_scalar_122_0 = items_1726;
const __wm_scalar_122_1 = id_1727;
if (__wm_scalar_122_0 === __wm_basis_Nil) {
const id_1728 = __wm_scalar_122_1;
return __wm_fail("Panic", "missing schema-v2 expression");
} else if (__wm_scalar_122_0?.ctor === -6 && __wm_scalar_122_0.args.length === 1 && __wm_is_tuple(__wm_scalar_122_0.args[0]) && __wm_scalar_122_0.args[0].length === 2) {
const item_1729 = __wm_scalar_122_0.args[0][0];
const rest_1730 = __wm_scalar_122_0.args[0][1];
const id_1731 = __wm_scalar_122_1;
if (numberEqual_1714__wm_d2(item_1729.id, id_1731)) {
return item_1729;
} else {
{
const __wm_tail_arg_114_0 = rest_1730;
const __wm_tail_arg_114_1 = id_1731;
items_1726 = __wm_tail_arg_114_0;
id_1727 = __wm_tail_arg_114_1;
continue __wm_tail_99;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findExpression_1725 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findExpression_1725__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findBlock_1732__wm_d2 = (items_1733, expressionId_1734) => {
__wm_tail_100: while (true) {
{
const __wm_scalar_123_0 = items_1733;
const __wm_scalar_123_1 = expressionId_1734;
if (__wm_scalar_123_0 === __wm_basis_Nil) {
const expressionId_1735 = __wm_scalar_123_1;
return __wm_fail("Panic", "missing schema-v2 block");
} else if (__wm_scalar_123_0?.ctor === -6 && __wm_scalar_123_0.args.length === 1 && __wm_is_tuple(__wm_scalar_123_0.args[0]) && __wm_scalar_123_0.args[0].length === 2) {
const item_1736 = __wm_scalar_123_0.args[0][0];
const rest_1737 = __wm_scalar_123_0.args[0][1];
const expressionId_1738 = __wm_scalar_123_1;
if (numberEqual_1714__wm_d2(item_1736.expressionId, expressionId_1738)) {
return item_1736;
} else {
{
const __wm_tail_arg_115_0 = rest_1737;
const __wm_tail_arg_115_1 = expressionId_1738;
items_1733 = __wm_tail_arg_115_0;
expressionId_1734 = __wm_tail_arg_115_1;
continue __wm_tail_100;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findBlock_1732 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findBlock_1732__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findBlockItem_1739__wm_d2 = (items_1740, id_1741) => {
__wm_tail_101: while (true) {
{
const __wm_scalar_124_0 = items_1740;
const __wm_scalar_124_1 = id_1741;
if (__wm_scalar_124_0 === __wm_basis_Nil) {
const id_1742 = __wm_scalar_124_1;
return __wm_fail("Panic", "missing schema-v2 block item");
} else if (__wm_scalar_124_0?.ctor === -6 && __wm_scalar_124_0.args.length === 1 && __wm_is_tuple(__wm_scalar_124_0.args[0]) && __wm_scalar_124_0.args[0].length === 2) {
const item_1743 = __wm_scalar_124_0.args[0][0];
const rest_1744 = __wm_scalar_124_0.args[0][1];
const id_1745 = __wm_scalar_124_1;
if (numberEqual_1714__wm_d2(item_1743.id, id_1745)) {
return item_1743;
} else {
{
const __wm_tail_arg_116_0 = rest_1744;
const __wm_tail_arg_116_1 = id_1745;
items_1740 = __wm_tail_arg_116_0;
id_1741 = __wm_tail_arg_116_1;
continue __wm_tail_101;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findBlockItem_1739 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findBlockItem_1739__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findLet_1746__wm_d2 = (items_1747, id_1748) => {
__wm_tail_102: while (true) {
{
const __wm_scalar_125_0 = items_1747;
const __wm_scalar_125_1 = id_1748;
if (__wm_scalar_125_0 === __wm_basis_Nil) {
const id_1749 = __wm_scalar_125_1;
return __wm_fail("Panic", "missing schema-v2 let");
} else if (__wm_scalar_125_0?.ctor === -6 && __wm_scalar_125_0.args.length === 1 && __wm_is_tuple(__wm_scalar_125_0.args[0]) && __wm_scalar_125_0.args[0].length === 2) {
const item_1750 = __wm_scalar_125_0.args[0][0];
const rest_1751 = __wm_scalar_125_0.args[0][1];
const id_1752 = __wm_scalar_125_1;
if (numberEqual_1714__wm_d2(item_1750.id, id_1752)) {
return item_1750;
} else {
{
const __wm_tail_arg_117_0 = rest_1751;
const __wm_tail_arg_117_1 = id_1752;
items_1747 = __wm_tail_arg_117_0;
id_1748 = __wm_tail_arg_117_1;
continue __wm_tail_102;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findLet_1746 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findLet_1746__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findMatch_1753__wm_d2 = (items_1754, expressionId_1755) => {
__wm_tail_103: while (true) {
{
const __wm_scalar_126_0 = items_1754;
const __wm_scalar_126_1 = expressionId_1755;
if (__wm_scalar_126_0 === __wm_basis_Nil) {
const expressionId_1756 = __wm_scalar_126_1;
return __wm_fail("Panic", "missing schema-v2 match");
} else if (__wm_scalar_126_0?.ctor === -6 && __wm_scalar_126_0.args.length === 1 && __wm_is_tuple(__wm_scalar_126_0.args[0]) && __wm_scalar_126_0.args[0].length === 2) {
const item_1757 = __wm_scalar_126_0.args[0][0];
const rest_1758 = __wm_scalar_126_0.args[0][1];
const expressionId_1759 = __wm_scalar_126_1;
if (numberEqual_1714__wm_d2(item_1757.expressionId, expressionId_1759)) {
return item_1757;
} else {
{
const __wm_tail_arg_118_0 = rest_1758;
const __wm_tail_arg_118_1 = expressionId_1759;
items_1754 = __wm_tail_arg_118_0;
expressionId_1755 = __wm_tail_arg_118_1;
continue __wm_tail_103;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findMatch_1753 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findMatch_1753__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findMatchArm_1760__wm_d2 = (items_1761, id_1762) => {
__wm_tail_104: while (true) {
{
const __wm_scalar_127_0 = items_1761;
const __wm_scalar_127_1 = id_1762;
if (__wm_scalar_127_0 === __wm_basis_Nil) {
const id_1763 = __wm_scalar_127_1;
return __wm_fail("Panic", "missing schema-v2 match arm");
} else if (__wm_scalar_127_0?.ctor === -6 && __wm_scalar_127_0.args.length === 1 && __wm_is_tuple(__wm_scalar_127_0.args[0]) && __wm_scalar_127_0.args[0].length === 2) {
const item_1764 = __wm_scalar_127_0.args[0][0];
const rest_1765 = __wm_scalar_127_0.args[0][1];
const id_1766 = __wm_scalar_127_1;
if (numberEqual_1714__wm_d2(item_1764.id, id_1766)) {
return item_1764;
} else {
{
const __wm_tail_arg_119_0 = rest_1765;
const __wm_tail_arg_119_1 = id_1766;
items_1761 = __wm_tail_arg_119_0;
id_1762 = __wm_tail_arg_119_1;
continue __wm_tail_104;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findMatchArm_1760 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findMatchArm_1760__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findPattern_1767__wm_d2 = (items_1768, id_1769) => {
__wm_tail_105: while (true) {
{
const __wm_scalar_128_0 = items_1768;
const __wm_scalar_128_1 = id_1769;
if (__wm_scalar_128_0 === __wm_basis_Nil) {
const id_1770 = __wm_scalar_128_1;
return __wm_fail("Panic", "missing schema-v2 pattern");
} else if (__wm_scalar_128_0?.ctor === -6 && __wm_scalar_128_0.args.length === 1 && __wm_is_tuple(__wm_scalar_128_0.args[0]) && __wm_scalar_128_0.args[0].length === 2) {
const item_1771 = __wm_scalar_128_0.args[0][0];
const rest_1772 = __wm_scalar_128_0.args[0][1];
const id_1773 = __wm_scalar_128_1;
if (numberEqual_1714__wm_d2(item_1771.id, id_1773)) {
return item_1771;
} else {
{
const __wm_tail_arg_120_0 = rest_1772;
const __wm_tail_arg_120_1 = id_1773;
items_1768 = __wm_tail_arg_120_0;
id_1769 = __wm_tail_arg_120_1;
continue __wm_tail_105;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findPattern_1767 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findPattern_1767__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findType_1774__wm_d2 = (items_1775, id_1776) => {
__wm_tail_106: while (true) {
{
const __wm_scalar_129_0 = items_1775;
const __wm_scalar_129_1 = id_1776;
if (__wm_scalar_129_0 === __wm_basis_Nil) {
const id_1777 = __wm_scalar_129_1;
return __wm_fail("Panic", "missing schema-v2 type");
} else if (__wm_scalar_129_0?.ctor === -6 && __wm_scalar_129_0.args.length === 1 && __wm_is_tuple(__wm_scalar_129_0.args[0]) && __wm_scalar_129_0.args[0].length === 2) {
const item_1778 = __wm_scalar_129_0.args[0][0];
const rest_1779 = __wm_scalar_129_0.args[0][1];
const id_1780 = __wm_scalar_129_1;
if (numberEqual_1714__wm_d2(item_1778.id, id_1780)) {
return item_1778;
} else {
{
const __wm_tail_arg_121_0 = rest_1779;
const __wm_tail_arg_121_1 = id_1780;
items_1775 = __wm_tail_arg_121_0;
id_1776 = __wm_tail_arg_121_1;
continue __wm_tail_106;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findType_1774 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findType_1774__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findExpressionOccurrence_1781__wm_d2 = (items_1782, sourceId_1783) => {
__wm_tail_107: while (true) {
{
const __wm_scalar_130_0 = items_1782;
const __wm_scalar_130_1 = sourceId_1783;
if (__wm_scalar_130_0 === __wm_basis_Nil) {
const sourceId_1784 = __wm_scalar_130_1;
return __wm_fail("Panic", "missing schema-v2 expression type occurrence");
} else if (__wm_scalar_130_0?.ctor === -6 && __wm_scalar_130_0.args.length === 1 && __wm_is_tuple(__wm_scalar_130_0.args[0]) && __wm_scalar_130_0.args[0].length === 2) {
const item_1785 = __wm_scalar_130_0.args[0][0];
const rest_1786 = __wm_scalar_130_0.args[0][1];
const sourceId_1787 = __wm_scalar_130_1;
if (__wm_op_and_d2(__wm_eq(item_1785.kind, "expression"), numberEqual_1714__wm_d2(item_1785.sourceId, sourceId_1787))) {
return item_1785;
} else {
{
const __wm_tail_arg_122_0 = rest_1786;
const __wm_tail_arg_122_1 = sourceId_1787;
items_1782 = __wm_tail_arg_122_0;
sourceId_1783 = __wm_tail_arg_122_1;
continue __wm_tail_107;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findExpressionOccurrence_1781 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findExpressionOccurrence_1781__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const shaderBuiltinTypeName_1798__wm_d2 = (source_1788, context_1789) => {
const occurrence_1790 = findExpressionOccurrence_1781__wm_d2(context_1789.occurrences, source_1788.id);
const typeId_1791 = occurrence_1790.shaderTypeId;
const gpuType_1792 = findType_1774__wm_d2(context_1789.types, typeId_1791);
if (__wm_eq(gpuType_1792.kind, "f32")) {
return "f32";
} else {
if (__wm_eq(gpuType_1792.kind, "i32")) {
return "i32";
} else {
if (__wm_eq(gpuType_1792.kind, "vector")) {
const items_1793 = Js.Array.toList(gpuType_1792.items);
const component_1796 = ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2) {
const first_1794 = __v.args[0][0];
const __1795 = __v.args[0][1];
return findType_1774__wm_d2(context_1789.types, first_1794);
} else if (__v === __wm_basis_Nil) {

return __wm_fail("Panic", "GPU builtin vector type is empty");
}
__wm_fail("Match", "non-exhaustive match");
})(items_1793);
const prefix_1797 = (__wm_eq(component_1796.kind, "i32") ? "i32x" : "f32x");
return (prefix_1797 + Text.of(listLength_1705__wm_d2(items_1793, 0)));
} else {
return "";
}
}
}
};
const shaderBuiltinTypeName_1798 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return shaderBuiltinTypeName_1798__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const builtinParamsMatch_1799__wm_d3 = (expected_1800, sourceIds_1801, context_1802) => {
const __wm_scalar_131_0 = expected_1800;
const __wm_scalar_131_1 = sourceIds_1801;
const __wm_scalar_131_2 = context_1802;
if (__wm_scalar_131_0 === __wm_basis_Nil && __wm_scalar_131_1 === __wm_basis_Nil) {
const context_1803 = __wm_scalar_131_2;
return true;
} else if (__wm_scalar_131_0?.ctor === -6 && __wm_scalar_131_0.args.length === 1 && __wm_is_tuple(__wm_scalar_131_0.args[0]) && __wm_scalar_131_0.args[0].length === 2 && __wm_scalar_131_1?.ctor === -6 && __wm_scalar_131_1.args.length === 1 && __wm_is_tuple(__wm_scalar_131_1.args[0]) && __wm_scalar_131_1.args[0].length === 2) {
const expectedType_1804 = __wm_scalar_131_0.args[0][0];
const expectedRest_1805 = __wm_scalar_131_0.args[0][1];
const sourceId_1806 = __wm_scalar_131_1.args[0][0];
const sourceRest_1807 = __wm_scalar_131_1.args[0][1];
const context_1808 = __wm_scalar_131_2;
const source_1809 = findExpression_1725__wm_d2(context_1808.expressions, sourceId_1806);
return __wm_op_and_d2(__wm_eq(expectedType_1804, shaderBuiltinTypeName_1798__wm_d2(source_1809, context_1808)), builtinParamsMatch_1799__wm_d3(expectedRest_1805, sourceRest_1807, context_1808));
} else if (true) {
const context_1810 = __wm_scalar_131_2;
return false;
}
__wm_fail("Match", "non-exhaustive match");
};
const builtinParamsMatch_1799 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return builtinParamsMatch_1799__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const selectBuiltinOverload_1811__wm_d3 = (overloads_1812, source_1813, context_1814) => {
__wm_tail_108: while (true) {
{
const __wm_scalar_132_0 = overloads_1812;
const __wm_scalar_132_1 = source_1813;
const __wm_scalar_132_2 = context_1814;
if (__wm_scalar_132_0 === __wm_basis_Nil) {
const source_1815 = __wm_scalar_132_1;
const context_1816 = __wm_scalar_132_2;
return __wm_fail("Panic", "no exact pinned Slang builtin overload survived Workman GPU elaboration");
} else if (__wm_scalar_132_0?.ctor === -6 && __wm_scalar_132_0.args.length === 1 && __wm_is_tuple(__wm_scalar_132_0.args[0]) && __wm_scalar_132_0.args[0].length === 2) {
const overload_1817 = __wm_scalar_132_0.args[0][0];
const rest_1818 = __wm_scalar_132_0.args[0][1];
const source_1819 = __wm_scalar_132_1;
const context_1820 = __wm_scalar_132_2;
if (__wm_op_and_d2(__wm_op_and_d2(__wm_eq(overload_1817.name, source_1819.builtinName), __wm_eq(overload_1817.result, shaderBuiltinTypeName_1798__wm_d2(source_1819, context_1820))), builtinParamsMatch_1799__wm_d3(Js.Array.toList(overload_1817.params), Js.Array.toList(source_1819.children), context_1820))) {
return overload_1817.id;
} else {
{
const __wm_tail_arg_123_0 = rest_1818;
const __wm_tail_arg_123_1 = source_1819;
const __wm_tail_arg_123_2 = context_1820;
overloads_1812 = __wm_tail_arg_123_0;
source_1813 = __wm_tail_arg_123_1;
context_1814 = __wm_tail_arg_123_2;
continue __wm_tail_108;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const selectBuiltinOverload_1811 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return selectBuiltinOverload_1811__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const collectBuiltinSelections_1821__wm_d3 = (expressions_1822, context_1823, selections_1824) => {
__wm_tail_109: while (true) {
{
const __wm_scalar_133_0 = expressions_1822;
const __wm_scalar_133_1 = context_1823;
const __wm_scalar_133_2 = selections_1824;
if (__wm_scalar_133_0 === __wm_basis_Nil) {
const context_1825 = __wm_scalar_133_1;
const selections_1826 = __wm_scalar_133_2;
return reverseInto_1691__wm_d2(selections_1826, __wm_basis_Nil);
} else if (__wm_scalar_133_0?.ctor === -6 && __wm_scalar_133_0.args.length === 1 && __wm_is_tuple(__wm_scalar_133_0.args[0]) && __wm_scalar_133_0.args[0].length === 2) {
const expression_1827 = __wm_scalar_133_0.args[0][0];
const rest_1828 = __wm_scalar_133_0.args[0][1];
const context_1829 = __wm_scalar_133_1;
const selections_1830 = __wm_scalar_133_2;
if (__wm_eq(expression_1827.kind, "builtin")) {
{
const selection_1831 = { expressionId: expression_1827.id, overloadId: selectBuiltinOverload_1811__wm_d3(context_1829.builtinOverloads, expression_1827, context_1829) };
{
const __wm_tail_arg_124_0 = rest_1828;
const __wm_tail_arg_124_1 = context_1829;
const __wm_tail_arg_124_2 = __wm_basis_Cons([selection_1831, selections_1830]);
expressions_1822 = __wm_tail_arg_124_0;
context_1823 = __wm_tail_arg_124_1;
selections_1824 = __wm_tail_arg_124_2;
continue __wm_tail_109;
}
}
} else {
{
const __wm_tail_arg_125_0 = rest_1828;
const __wm_tail_arg_125_1 = context_1829;
const __wm_tail_arg_125_2 = selections_1830;
expressions_1822 = __wm_tail_arg_125_0;
context_1823 = __wm_tail_arg_125_1;
selections_1824 = __wm_tail_arg_125_2;
continue __wm_tail_109;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const collectBuiltinSelections_1821 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return collectBuiltinSelections_1821__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const allSemanticNumbers_1832__wm_d2 = (typeIds_1833, types_1834) => {
const __wm_scalar_134_0 = typeIds_1833;
const __wm_scalar_134_1 = types_1834;
if (__wm_scalar_134_0 === __wm_basis_Nil) {
const types_1835 = __wm_scalar_134_1;
return true;
} else if (__wm_scalar_134_0?.ctor === -6 && __wm_scalar_134_0.args.length === 1 && __wm_is_tuple(__wm_scalar_134_0.args[0]) && __wm_scalar_134_0.args[0].length === 2) {
const typeId_1836 = __wm_scalar_134_0.args[0][0];
const rest_1837 = __wm_scalar_134_0.args[0][1];
const types_1838 = __wm_scalar_134_1;
const gpuType_1839 = findType_1774__wm_d2(types_1838, typeId_1836);
return __wm_op_and_d2(__wm_eq(gpuType_1839.kind, "number"), allSemanticNumbers_1832__wm_d2(rest_1837, types_1838));
}
__wm_fail("Match", "non-exhaustive match");
};
const allSemanticNumbers_1832 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return allSemanticNumbers_1832__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const shaderTypeKind_1844__wm_d2 = (source_1840, types_1841) => {
if (__wm_eq(source_1840.kind, "number")) {
return "f32";
} else {
if (__wm_eq(source_1840.kind, "tuple")) {
const items_1842 = Js.Array.toList(source_1840.items);
const width_1843 = listLength_1705__wm_d2(items_1842, 0);
if (__wm_op_and_d2(__wm_op_and_d2((width_1843 >= 2), (width_1843 <= 4)), allSemanticNumbers_1832__wm_d2(items_1842, types_1841))) {
return "vector";
} else {
return "tuple";
}
} else {
return source_1840.kind;
}
}
};
const shaderTypeKind_1844 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return shaderTypeKind_1844__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const shaderTypeReason_1847__wm_d2 = (semanticKind_1845, shaderKind_1846) => {
if (__wm_eq(semanticKind_1845, "number")) {
return "shader-number-f32";
} else {
if (__wm_eq(semanticKind_1845, "tuple")) {
if (__wm_eq(shaderKind_1846, "vector")) {
return "homogeneous-numeric-tuple-default";
} else {
return "semantic-product";
}
} else {
return "semantic-shape";
}
}
};
const shaderTypeReason_1847 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return shaderTypeReason_1847__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const offsetTypeIds_1848__wm_d3 = (typeIds_1849, offset_1850, output_1851) => {
__wm_tail_110: while (true) {
{
const __wm_scalar_135_0 = typeIds_1849;
const __wm_scalar_135_1 = offset_1850;
const __wm_scalar_135_2 = output_1851;
if (__wm_scalar_135_0 === __wm_basis_Nil) {
const offset_1852 = __wm_scalar_135_1;
const output_1853 = __wm_scalar_135_2;
return reverseInto_1691__wm_d2(output_1853, __wm_basis_Nil);
} else if (__wm_scalar_135_0?.ctor === -6 && __wm_scalar_135_0.args.length === 1 && __wm_is_tuple(__wm_scalar_135_0.args[0]) && __wm_scalar_135_0.args[0].length === 2) {
const typeId_1854 = __wm_scalar_135_0.args[0][0];
const rest_1855 = __wm_scalar_135_0.args[0][1];
const offset_1856 = __wm_scalar_135_1;
const output_1857 = __wm_scalar_135_2;
{
const __wm_tail_arg_126_0 = rest_1855;
const __wm_tail_arg_126_1 = offset_1856;
const __wm_tail_arg_126_2 = __wm_basis_Cons([(offset_1856 + typeId_1854), output_1857]);
typeIds_1849 = __wm_tail_arg_126_0;
offset_1850 = __wm_tail_arg_126_1;
output_1851 = __wm_tail_arg_126_2;
continue __wm_tail_110;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const offsetTypeIds_1848 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return offsetTypeIds_1848__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const addI32ShaderTypes_1858__wm_d4 = (sourceTypes_1859, allTypes_1860, offset_1861, output_1862) => {
__wm_tail_111: while (true) {
{
const __wm_scalar_136_0 = sourceTypes_1859;
const __wm_scalar_136_1 = allTypes_1860;
const __wm_scalar_136_2 = offset_1861;
const __wm_scalar_136_3 = output_1862;
if (__wm_scalar_136_0 === __wm_basis_Nil) {
const allTypes_1863 = __wm_scalar_136_1;
const offset_1864 = __wm_scalar_136_2;
const output_1865 = __wm_scalar_136_3;
return reverseInto_1691__wm_d2(output_1865, __wm_basis_Nil);
} else if (__wm_scalar_136_0?.ctor === -6 && __wm_scalar_136_0.args.length === 1 && __wm_is_tuple(__wm_scalar_136_0.args[0]) && __wm_scalar_136_0.args[0].length === 2) {
const source_1866 = __wm_scalar_136_0.args[0][0];
const rest_1867 = __wm_scalar_136_0.args[0][1];
const allTypes_1868 = __wm_scalar_136_1;
const offset_1869 = __wm_scalar_136_2;
const output_1870 = __wm_scalar_136_3;
{
const items_1871 = Js.Array.toList(source_1866.items);
const width_1872 = listLength_1705__wm_d2(items_1871, 0);
const numericVector_1873 = __wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(__wm_eq(source_1866.kind, "tuple"), (width_1872 >= 2)), (width_1872 <= 4)), allSemanticNumbers_1832__wm_d2(items_1871, allTypes_1868));
if (__wm_op_or_d2(__wm_eq(source_1866.kind, "number"), numericVector_1873)) {
{
const clone_1874 = { ...source_1866, id: (offset_1869 + source_1866.id), kind: (__wm_eq(source_1866.kind, "number") ? "i32" : "vector"), items: (numericVector_1873 ? Js.Array.fromList(offsetTypeIds_1848__wm_d3(items_1871, offset_1869, __wm_basis_Nil)) : source_1866.items) };
{
const __wm_tail_arg_127_0 = rest_1867;
const __wm_tail_arg_127_1 = allTypes_1868;
const __wm_tail_arg_127_2 = offset_1869;
const __wm_tail_arg_127_3 = __wm_basis_Cons([clone_1874, output_1870]);
sourceTypes_1859 = __wm_tail_arg_127_0;
allTypes_1860 = __wm_tail_arg_127_1;
offset_1861 = __wm_tail_arg_127_2;
output_1862 = __wm_tail_arg_127_3;
continue __wm_tail_111;
}
}
} else {
{
const __wm_tail_arg_128_0 = rest_1867;
const __wm_tail_arg_128_1 = allTypes_1868;
const __wm_tail_arg_128_2 = offset_1869;
const __wm_tail_arg_128_3 = output_1870;
sourceTypes_1859 = __wm_tail_arg_128_0;
allTypes_1860 = __wm_tail_arg_128_1;
offset_1861 = __wm_tail_arg_128_2;
output_1862 = __wm_tail_arg_128_3;
continue __wm_tail_111;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addI32ShaderTypes_1858 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return addI32ShaderTypes_1858__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const concreteShaderTypeId_1882__wm_d4 = (semanticTypeId_1875, representation_1876, offset_1877, types_1878) => {
if (__wm_eq(representation_1876, "i32")) {
const source_1879 = findType_1774__wm_d2(types_1878, semanticTypeId_1875);
const items_1880 = Js.Array.toList(source_1879.items);
const width_1881 = listLength_1705__wm_d2(items_1880, 0);
if (__wm_op_or_d2(__wm_eq(source_1879.kind, "number"), __wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(__wm_eq(source_1879.kind, "tuple"), (width_1881 >= 2)), (width_1881 <= 4)), allSemanticNumbers_1832__wm_d2(items_1880, types_1878)))) {
return (offset_1877 + semanticTypeId_1875);
} else {
return semanticTypeId_1875;
}
} else {
return semanticTypeId_1875;
}
};
const concreteShaderTypeId_1882 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return concreteShaderTypeId_1882__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const elaborateSliceTypes_1883__wm_d4 = (sourceTypes_1884, allTypes_1885, shaderTypes_1886, evidence_1887) => {
__wm_tail_112: while (true) {
{
const __wm_scalar_137_0 = sourceTypes_1884;
const __wm_scalar_137_1 = allTypes_1885;
const __wm_scalar_137_2 = shaderTypes_1886;
const __wm_scalar_137_3 = evidence_1887;
if (__wm_scalar_137_0 === __wm_basis_Nil) {
const allTypes_1888 = __wm_scalar_137_1;
const shaderTypes_1889 = __wm_scalar_137_2;
const evidence_1890 = __wm_scalar_137_3;
return [reverseInto_1691__wm_d2(shaderTypes_1889, __wm_basis_Nil), reverseInto_1691__wm_d2(evidence_1890, __wm_basis_Nil)];
} else if (__wm_scalar_137_0?.ctor === -6 && __wm_scalar_137_0.args.length === 1 && __wm_is_tuple(__wm_scalar_137_0.args[0]) && __wm_scalar_137_0.args[0].length === 2) {
const source_1891 = __wm_scalar_137_0.args[0][0];
const rest_1892 = __wm_scalar_137_0.args[0][1];
const allTypes_1893 = __wm_scalar_137_1;
const shaderTypes_1894 = __wm_scalar_137_2;
const evidence_1895 = __wm_scalar_137_3;
{
const shaderKind_1896 = shaderTypeKind_1844__wm_d2(source_1891, allTypes_1893);
const shaderType_1897 = { ...source_1891, kind: shaderKind_1896 };
const typeEvidence_1898 = { typeId: source_1891.id, semanticKind: source_1891.kind, shaderKind: shaderKind_1896, reason: shaderTypeReason_1847__wm_d2(source_1891.kind, shaderKind_1896) };
{
const __wm_tail_arg_129_0 = rest_1892;
const __wm_tail_arg_129_1 = allTypes_1893;
const __wm_tail_arg_129_2 = __wm_basis_Cons([shaderType_1897, shaderTypes_1894]);
const __wm_tail_arg_129_3 = __wm_basis_Cons([typeEvidence_1898, evidence_1895]);
sourceTypes_1884 = __wm_tail_arg_129_0;
allTypes_1885 = __wm_tail_arg_129_1;
shaderTypes_1886 = __wm_tail_arg_129_2;
evidence_1887 = __wm_tail_arg_129_3;
continue __wm_tail_112;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const elaborateSliceTypes_1883 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return elaborateSliceTypes_1883__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const addExpressionOccurrences_1899__wm_d5 = (expressions_1900, representations_1901, typeOffset_1902, types_1903, occurrences_1904) => {
__wm_tail_113: while (true) {
{
const __wm_scalar_138_0 = expressions_1900;
const __wm_scalar_138_1 = representations_1901;
const __wm_scalar_138_2 = typeOffset_1902;
const __wm_scalar_138_3 = types_1903;
const __wm_scalar_138_4 = occurrences_1904;
if (__wm_scalar_138_0 === __wm_basis_Nil) {
const representations_1905 = __wm_scalar_138_1;
const typeOffset_1906 = __wm_scalar_138_2;
const types_1907 = __wm_scalar_138_3;
const occurrences_1908 = __wm_scalar_138_4;
return occurrences_1908;
} else if (__wm_scalar_138_0?.ctor === -6 && __wm_scalar_138_0.args.length === 1 && __wm_is_tuple(__wm_scalar_138_0.args[0]) && __wm_scalar_138_0.args[0].length === 2) {
const expression_1909 = __wm_scalar_138_0.args[0][0];
const rest_1910 = __wm_scalar_138_0.args[0][1];
const representations_1911 = __wm_scalar_138_1;
const typeOffset_1912 = __wm_scalar_138_2;
const types_1913 = __wm_scalar_138_3;
const occurrences_1914 = __wm_scalar_138_4;
{
const concreteRepresentation_1915 = expressionRepresentation_1683__wm_d2(representations_1911, expression_1909.id);
const occurrence_1916 = { kind: "expression", sourceId: expression_1909.id, typeId: expression_1909.typeId, shaderTypeId: concreteShaderTypeId_1882__wm_d4(expression_1909.typeId, concreteRepresentation_1915, typeOffset_1912, types_1913), spanId: expression_1909.spanId, representationEvidence: expression_1909.numberKind, representation: concreteRepresentation_1915 };
{
const __wm_tail_arg_130_0 = rest_1910;
const __wm_tail_arg_130_1 = representations_1911;
const __wm_tail_arg_130_2 = typeOffset_1912;
const __wm_tail_arg_130_3 = types_1913;
const __wm_tail_arg_130_4 = __wm_basis_Cons([occurrence_1916, occurrences_1914]);
expressions_1900 = __wm_tail_arg_130_0;
representations_1901 = __wm_tail_arg_130_1;
typeOffset_1902 = __wm_tail_arg_130_2;
types_1903 = __wm_tail_arg_130_3;
occurrences_1904 = __wm_tail_arg_130_4;
continue __wm_tail_113;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addExpressionOccurrences_1899 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return addExpressionOccurrences_1899__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const addPatternOccurrences_1917__wm_d6 = (patterns_1918, expressionCount_1919, representations_1920, typeOffset_1921, types_1922, occurrences_1923) => {
__wm_tail_114: while (true) {
{
const __wm_scalar_139_0 = patterns_1918;
const __wm_scalar_139_1 = expressionCount_1919;
const __wm_scalar_139_2 = representations_1920;
const __wm_scalar_139_3 = typeOffset_1921;
const __wm_scalar_139_4 = types_1922;
const __wm_scalar_139_5 = occurrences_1923;
if (__wm_scalar_139_0 === __wm_basis_Nil) {
const expressionCount_1924 = __wm_scalar_139_1;
const representations_1925 = __wm_scalar_139_2;
const typeOffset_1926 = __wm_scalar_139_3;
const types_1927 = __wm_scalar_139_4;
const occurrences_1928 = __wm_scalar_139_5;
return occurrences_1928;
} else if (__wm_scalar_139_0?.ctor === -6 && __wm_scalar_139_0.args.length === 1 && __wm_is_tuple(__wm_scalar_139_0.args[0]) && __wm_scalar_139_0.args[0].length === 2) {
const pattern_1929 = __wm_scalar_139_0.args[0][0];
const rest_1930 = __wm_scalar_139_0.args[0][1];
const expressionCount_1931 = __wm_scalar_139_1;
const representations_1932 = __wm_scalar_139_2;
const typeOffset_1933 = __wm_scalar_139_3;
const types_1934 = __wm_scalar_139_4;
const occurrences_1935 = __wm_scalar_139_5;
{
const concreteRepresentation_1936 = patternRepresentation_1687__wm_d3(representations_1932, expressionCount_1931, pattern_1929.id);
const occurrence_1937 = { kind: "pattern", sourceId: pattern_1929.id, typeId: pattern_1929.typeId, shaderTypeId: concreteShaderTypeId_1882__wm_d4(pattern_1929.typeId, concreteRepresentation_1936, typeOffset_1933, types_1934), spanId: pattern_1929.spanId, representationEvidence: "", representation: concreteRepresentation_1936 };
{
const __wm_tail_arg_131_0 = rest_1930;
const __wm_tail_arg_131_1 = expressionCount_1931;
const __wm_tail_arg_131_2 = representations_1932;
const __wm_tail_arg_131_3 = typeOffset_1933;
const __wm_tail_arg_131_4 = types_1934;
const __wm_tail_arg_131_5 = __wm_basis_Cons([occurrence_1937, occurrences_1935]);
patterns_1918 = __wm_tail_arg_131_0;
expressionCount_1919 = __wm_tail_arg_131_1;
representations_1920 = __wm_tail_arg_131_2;
typeOffset_1921 = __wm_tail_arg_131_3;
types_1922 = __wm_tail_arg_131_4;
occurrences_1923 = __wm_tail_arg_131_5;
continue __wm_tail_114;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addPatternOccurrences_1917 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return addPatternOccurrences_1917__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const addFunctionOccurrences_1938__wm_d2 = (functions_1939, occurrences_1940) => {
__wm_tail_115: while (true) {
{
const __wm_scalar_140_0 = functions_1939;
const __wm_scalar_140_1 = occurrences_1940;
if (__wm_scalar_140_0 === __wm_basis_Nil) {
const occurrences_1941 = __wm_scalar_140_1;
return occurrences_1941;
} else if (__wm_scalar_140_0?.ctor === -6 && __wm_scalar_140_0.args.length === 1 && __wm_is_tuple(__wm_scalar_140_0.args[0]) && __wm_scalar_140_0.args[0].length === 2) {
const fn_1942 = __wm_scalar_140_0.args[0][0];
const rest_1943 = __wm_scalar_140_0.args[0][1];
const occurrences_1944 = __wm_scalar_140_1;
{
const occurrence_1945 = { kind: "function", sourceId: fn_1942.id, typeId: fn_1942.typeId, shaderTypeId: fn_1942.typeId, spanId: fn_1942.spanId, representationEvidence: "", representation: "" };
{
const __wm_tail_arg_132_0 = rest_1943;
const __wm_tail_arg_132_1 = __wm_basis_Cons([occurrence_1945, occurrences_1944]);
functions_1939 = __wm_tail_arg_132_0;
occurrences_1940 = __wm_tail_arg_132_1;
continue __wm_tail_115;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addFunctionOccurrences_1938 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addFunctionOccurrences_1938__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const elaborateSliceProgramTypes_1960 = (__arg) => {
if (true) {
const input_1946 = __arg;
const semanticTypes_1947 = Js.Array.toList(input_1946.types);
const __wm_bind_68 = elaborateSliceTypes_1883__wm_d4(semanticTypes_1947, semanticTypes_1947, __wm_basis_Nil, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_68) && __wm_bind_68.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const shaderTypeItems_1948 = __wm_bind_68[0];
const typeEvidenceItems_1949 = __wm_bind_68[1];
const typeOffset_1950 = listLength_1705__wm_d2(semanticTypes_1947, 0);
const allShaderTypeItems_1951 = append_1698__wm_d2(shaderTypeItems_1948, addI32ShaderTypes_1858__wm_d4(semanticTypes_1947, semanticTypes_1947, typeOffset_1950, __wm_basis_Nil));
const expressionItems_1952 = Js.Array.toList(input_1946.expressions);
const numericRepresentations_1953 = solveSliceNumericRepresentations_1680(input_1946);
const withExpressions_1954 = addExpressionOccurrences_1899__wm_d5(expressionItems_1952, numericRepresentations_1953, typeOffset_1950, semanticTypes_1947, __wm_basis_Nil);
const withPatterns_1955 = addPatternOccurrences_1917__wm_d6(Js.Array.toList(input_1946.patterns), listLength_1705__wm_d2(expressionItems_1952, 0), numericRepresentations_1953, typeOffset_1950, semanticTypes_1947, withExpressions_1954);
const occurrenceItems_1956 = reverseInto_1691__wm_d2(addFunctionOccurrences_1938__wm_d2(Js.Array.toList(input_1946.functions), withPatterns_1955), __wm_basis_Nil);
const builtinCatalog_1957 = input_1946.builtinCatalog;
const typeContext_1958 = { expressions: Js.Array.toList(input_1946.expressions), blocks: Js.Array.toList(input_1946.blocks), blockItems: Js.Array.toList(input_1946.blockItems), lets: Js.Array.toList(input_1946.lets), matches: Js.Array.toList(input_1946.matches), matchArms: Js.Array.toList(input_1946.matchArms), patterns: Js.Array.toList(input_1946.patterns), types: allShaderTypeItems_1951, adts: Js.Array.toList(input_1946.adts), functions: Js.Array.toList(input_1946.functions), builtinOverloads: Js.Array.toList(builtinCatalog_1957.overloads), occurrences: occurrenceItems_1956 };
const output_1959 = { schemaVersion: 5, shaderTypes: Js.Array.fromList(allShaderTypeItems_1951), typeEvidence: Js.Array.fromList(typeEvidenceItems_1949), occurrences: Js.Array.fromList(occurrenceItems_1956), builtinSelections: Js.Array.fromList(collectBuiltinSelections_1821__wm_d3(Js.Array.toList(input_1946.expressions), typeContext_1958, __wm_basis_Nil)) };
return output_1959;
}
__wm_fail("Match", "pattern match failure in function");
};
const findAdt_1961__wm_d2 = (items_1962, typeNameId_1963) => {
__wm_tail_116: while (true) {
{
const __wm_scalar_141_0 = items_1962;
const __wm_scalar_141_1 = typeNameId_1963;
if (__wm_scalar_141_0 === __wm_basis_Nil) {
const typeNameId_1964 = __wm_scalar_141_1;
return __wm_fail("Panic", "missing schema-v2 ADT");
} else if (__wm_scalar_141_0?.ctor === -6 && __wm_scalar_141_0.args.length === 1 && __wm_is_tuple(__wm_scalar_141_0.args[0]) && __wm_scalar_141_0.args[0].length === 2) {
const item_1965 = __wm_scalar_141_0.args[0][0];
const rest_1966 = __wm_scalar_141_0.args[0][1];
const typeNameId_1967 = __wm_scalar_141_1;
if (numberEqual_1714__wm_d2(item_1965.typeNameId, typeNameId_1967)) {
return item_1965;
} else {
{
const __wm_tail_arg_133_0 = rest_1966;
const __wm_tail_arg_133_1 = typeNameId_1967;
items_1962 = __wm_tail_arg_133_0;
typeNameId_1963 = __wm_tail_arg_133_1;
continue __wm_tail_116;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findAdt_1961 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findAdt_1961__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findFunction_1968__wm_d2 = (items_1969, id_1970) => {
__wm_tail_117: while (true) {
{
const __wm_scalar_142_0 = items_1969;
const __wm_scalar_142_1 = id_1970;
if (__wm_scalar_142_0 === __wm_basis_Nil) {
const id_1971 = __wm_scalar_142_1;
return __wm_fail("Panic", "missing schema-v2 function");
} else if (__wm_scalar_142_0?.ctor === -6 && __wm_scalar_142_0.args.length === 1 && __wm_is_tuple(__wm_scalar_142_0.args[0]) && __wm_scalar_142_0.args[0].length === 2) {
const item_1972 = __wm_scalar_142_0.args[0][0];
const rest_1973 = __wm_scalar_142_0.args[0][1];
const id_1974 = __wm_scalar_142_1;
if (numberEqual_1714__wm_d2(item_1972.id, id_1974)) {
return item_1972;
} else {
{
const __wm_tail_arg_134_0 = rest_1973;
const __wm_tail_arg_134_1 = id_1974;
items_1969 = __wm_tail_arg_134_0;
id_1970 = __wm_tail_arg_134_1;
continue __wm_tail_117;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findFunction_1968 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return findFunction_1968__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const initialState_1976 = (__arg) => {
if (__arg === undefined) {

const state_1975 = { nextExpressionId: 0, nextArmId: 0, functions: __wm_basis_Nil, expressions: __wm_basis_Nil, matchArms: __wm_basis_Nil, diagnostics: __wm_basis_Nil };
return state_1975;
}
__wm_fail("Match", "pattern match failure in function");
};
const baseIrExpression_1982__wm_d4 = (state_1977, source_1978, functionId_1979, kind_1980) => {
const expression_1981 = { id: state_1977.nextExpressionId, functionId: functionId_1979, sourceExprId: source_1978.id, kind: kind_1980, typeId: source_1978.typeId, spanId: source_1978.spanId, bindingId: (__wm_eq(source_1978.kind, "var") ? source_1978.bindingId : __wm_op_sub(1)), patternId: __wm_op_sub(1), targetFunctionId: (__wm_eq(source_1978.kind, "call") ? source_1978.functionId : __wm_op_sub(1)), constructorId: (__wm_eq(source_1978.kind, "constructor") ? source_1978.constructorId : __wm_op_sub(1)), semanticId: source_1978.semanticId, operatorId: source_1978.operatorId, builtinName: source_1978.builtinName, builtinOverloadId: __wm_op_sub(1), resourceOperation: source_1978.resourceOperation, numberValue: source_1978.numberValue, numberKind: source_1978.numberKind, boolValue: source_1978.boolValue, index: source_1978.index, children: Js.Array.fromList(__wm_basis_Nil), armIds: Js.Array.fromList(__wm_basis_Nil) };
return expression_1981;
};
const baseIrExpression_1982 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return baseIrExpression_1982__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const addExpression_1986__wm_d2 = (expression_1983, state_1984) => {
const next_1985 = { ...state_1984, nextExpressionId: (state_1984.nextExpressionId + 1), expressions: __wm_basis_Cons([expression_1983, state_1984.expressions]) };
return [expression_1983.id, next_1985];
};
const addExpression_1986 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addExpression_1986__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const addDiagnostic_1990__wm_d2 = (diagnostic_1987, state_1988) => {
const next_1989 = { ...state_1988, diagnostics: __wm_basis_Cons([diagnostic_1987, state_1988.diagnostics]) };
return next_1989;
};
const addDiagnostic_1990 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addDiagnostic_1990__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const nonTailDiagnostic_1995__wm_d2 = (source_1991, fn_1992) => {
const declaration_1993 = { spanId: fn_1992.spanId, label: "recursive function declared here" };
const diagnostic_1994 = { code: "gpu.recursion.non-tail", message: "direct self-recursion is allowed only in function, if, match, or block-result tail position", spanId: source_1991.spanId, related: Js.Array.fromList(__wm_basis_Cons([declaration_1993, __wm_basis_Nil])) };
return diagnostic_1994;
};
const nonTailDiagnostic_1995 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return nonTailDiagnostic_1995__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const nonExhaustiveDiagnostic_1998 = (__arg) => {
if (true) {
const source_1996 = __arg;
const diagnostic_1997 = { code: "gpu.pattern.non-exhaustive", message: "v1 GPU matches require exactly one arm for every constructor", spanId: source_1996.spanId, related: Js.Array.fromList(__wm_basis_Nil) };
return diagnostic_1997;
}
__wm_fail("Match", "pattern match failure in function");
};
const constructorPatterns_1999__wm_d4 = (armIds_2000, context_2001, constructors_2002, valid_2003) => {
__wm_tail_118: while (true) {
{
const __wm_scalar_143_0 = armIds_2000;
const __wm_scalar_143_1 = context_2001;
const __wm_scalar_143_2 = constructors_2002;
const __wm_scalar_143_3 = valid_2003;
if (__wm_scalar_143_0 === __wm_basis_Nil) {
const context_2004 = __wm_scalar_143_1;
const constructors_2005 = __wm_scalar_143_2;
const valid_2006 = __wm_scalar_143_3;
return [constructors_2005, valid_2006];
} else if (__wm_scalar_143_0?.ctor === -6 && __wm_scalar_143_0.args.length === 1 && __wm_is_tuple(__wm_scalar_143_0.args[0]) && __wm_scalar_143_0.args[0].length === 2) {
const armId_2007 = __wm_scalar_143_0.args[0][0];
const rest_2008 = __wm_scalar_143_0.args[0][1];
const context_2009 = __wm_scalar_143_1;
const constructors_2010 = __wm_scalar_143_2;
const valid_2011 = __wm_scalar_143_3;
{
const arm_2012 = findMatchArm_1760__wm_d2(context_2009.matchArms, armId_2007);
const pattern_2013 = findPattern_1767__wm_d2(context_2009.patterns, arm_2012.patternId);
if (__wm_eq(pattern_2013.kind, "constructor")) {
{
const __wm_tail_arg_135_0 = rest_2008;
const __wm_tail_arg_135_1 = context_2009;
const __wm_tail_arg_135_2 = __wm_basis_Cons([pattern_2013.constructorId, constructors_2010]);
const __wm_tail_arg_135_3 = valid_2011;
armIds_2000 = __wm_tail_arg_135_0;
context_2001 = __wm_tail_arg_135_1;
constructors_2002 = __wm_tail_arg_135_2;
valid_2003 = __wm_tail_arg_135_3;
continue __wm_tail_118;
}
} else {
{
const __wm_tail_arg_136_0 = rest_2008;
const __wm_tail_arg_136_1 = context_2009;
const __wm_tail_arg_136_2 = constructors_2010;
const __wm_tail_arg_136_3 = false;
armIds_2000 = __wm_tail_arg_136_0;
context_2001 = __wm_tail_arg_136_1;
constructors_2002 = __wm_tail_arg_136_2;
valid_2003 = __wm_tail_arg_136_3;
continue __wm_tail_118;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const constructorPatterns_1999 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return constructorPatterns_1999__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const matchIsExhaustive_2014__wm_d3 = (source_2016, row_2017, context_2018) => {
const value_2019 = findExpression_1725__wm_d2(context_2018.expressions, row_2017.valueExprId);
const valueType_2020 = findType_1774__wm_d2(context_2018.types, value_2019.typeId);
if (__wm_eq(valueType_2020.kind, "adt")) {
const adt_2021 = findAdt_1961__wm_d2(context_2018.adts, valueType_2020.typeNameId);
const __wm_bind_69 = constructorPatterns_1999__wm_d4(Js.Array.toList(row_2017.armIds), context_2018, __wm_basis_Nil, true);
if (!(__wm_is_tuple(__wm_bind_69) && __wm_bind_69.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const constructors_2022 = __wm_bind_69[0];
const valid_2023 = __wm_bind_69[1];
return __wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(valid_2023, unique_1720__wm_d2(constructors_2022, __wm_basis_Nil)), numberEqual_1714__wm_d2(listLength_1705__wm_d2(constructors_2022, 0), listLength_1705__wm_d2(Js.Array.toList(adt_2021.constructorIds), 0))), constructorSetContains_2015__wm_d2(Js.Array.toList(adt_2021.constructorIds), constructors_2022));
} else {
return false;
}
};
const matchIsExhaustive_2014 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return matchIsExhaustive_2014__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const constructorSetContains_2015__wm_d2 = (expected_2024, actual_2025) => {
const __wm_scalar_144_0 = expected_2024;
const __wm_scalar_144_1 = actual_2025;
if (__wm_scalar_144_0 === __wm_basis_Nil) {
const actual_2026 = __wm_scalar_144_1;
return true;
} else if (__wm_scalar_144_0?.ctor === -6 && __wm_scalar_144_0.args.length === 1 && __wm_is_tuple(__wm_scalar_144_0.args[0]) && __wm_scalar_144_0.args[0].length === 2) {
const head_2027 = __wm_scalar_144_0.args[0][0];
const rest_2028 = __wm_scalar_144_0.args[0][1];
const actual_2029 = __wm_scalar_144_1;
return __wm_op_and_d2(contains_1715__wm_d2(actual_2029, head_2027), constructorSetContains_2015__wm_d2(rest_2028, actual_2029));
}
__wm_fail("Match", "non-exhaustive match");
};
const constructorSetContains_2015 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return constructorSetContains_2015__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const buildExpression_2030__wm_d5 = (sourceId_2038, functionId_2039, tailPosition_2040, context_2041, state_2042) => {
const source_2043 = findExpression_1725__wm_d2(context_2041.expressions, sourceId_2038);
if (__wm_eq(source_2043.kind, "block")) {
return buildBlock_2035__wm_d5(source_2043, functionId_2039, tailPosition_2040, context_2041, state_2042);
} else {
if (__wm_eq(source_2043.kind, "if")) {
return buildIf_2032__wm_d5(source_2043, functionId_2039, tailPosition_2040, context_2041, state_2042);
} else {
if (__wm_eq(source_2043.kind, "match")) {
return buildMatch_2033__wm_d5(source_2043, functionId_2039, tailPosition_2040, context_2041, state_2042);
} else {
const selfCall_2044 = __wm_op_and_d2(__wm_eq(source_2043.kind, "call"), numberEqual_1714__wm_d2(source_2043.functionId, functionId_2039));
const kind_2045 = (__wm_op_and_d2(selfCall_2044, tailPosition_2040) ? "tail-call" : (__wm_eq(source_2043.kind, "var") ? "local" : source_2043.kind));
const diagnosed_2046 = (__wm_op_and_d2(selfCall_2044, __wm_op_not(tailPosition_2040)) ? addDiagnostic_1990__wm_d2(nonTailDiagnostic_1995__wm_d2(source_2043, findFunction_1968__wm_d2(context_2041.functions, functionId_2039)), state_2042) : state_2042);
const __wm_bind_70 = buildChildren_2031__wm_d5(Js.Array.toList(source_2043.children), functionId_2039, context_2041, diagnosed_2046, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_70) && __wm_bind_70.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const children_2047 = __wm_bind_70[0];
const withChildren_2048 = __wm_bind_70[1];
const expression_2049 = { ...baseIrExpression_1982__wm_d4(withChildren_2048, source_2043, functionId_2039, kind_2045), builtinOverloadId: (__wm_eq(source_2043.kind, "builtin") ? selectBuiltinOverload_1811__wm_d3(context_2041.builtinOverloads, source_2043, context_2041) : __wm_op_sub(1)), children: Js.Array.fromList(children_2047) };
return addExpression_1986__wm_d2(expression_2049, withChildren_2048);
}
}
}
};
const buildExpression_2030 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildExpression_2030__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildChildren_2031__wm_d5 = (sourceIds_2050, functionId_2051, context_2052, state_2053, reversed_2054) => {
__wm_tail_119: while (true) {
{
const __wm_scalar_145_0 = sourceIds_2050;
const __wm_scalar_145_1 = functionId_2051;
const __wm_scalar_145_2 = context_2052;
const __wm_scalar_145_3 = state_2053;
const __wm_scalar_145_4 = reversed_2054;
if (__wm_scalar_145_0 === __wm_basis_Nil) {
const functionId_2055 = __wm_scalar_145_1;
const context_2056 = __wm_scalar_145_2;
const state_2057 = __wm_scalar_145_3;
const reversed_2058 = __wm_scalar_145_4;
return [reverseInto_1691__wm_d2(reversed_2058, __wm_basis_Nil), state_2057];
} else if (__wm_scalar_145_0?.ctor === -6 && __wm_scalar_145_0.args.length === 1 && __wm_is_tuple(__wm_scalar_145_0.args[0]) && __wm_scalar_145_0.args[0].length === 2) {
const sourceId_2059 = __wm_scalar_145_0.args[0][0];
const rest_2060 = __wm_scalar_145_0.args[0][1];
const functionId_2061 = __wm_scalar_145_1;
const context_2062 = __wm_scalar_145_2;
const state_2063 = __wm_scalar_145_3;
const reversed_2064 = __wm_scalar_145_4;
{
const __wm_bind_71 = buildExpression_2030__wm_d5(sourceId_2059, functionId_2061, false, context_2062, state_2063);
if (!(__wm_is_tuple(__wm_bind_71) && __wm_bind_71.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const childId_2065 = __wm_bind_71[0];
const afterChild_2066 = __wm_bind_71[1];
{
const __wm_tail_arg_137_0 = rest_2060;
const __wm_tail_arg_137_1 = functionId_2061;
const __wm_tail_arg_137_2 = context_2062;
const __wm_tail_arg_137_3 = afterChild_2066;
const __wm_tail_arg_137_4 = __wm_basis_Cons([childId_2065, reversed_2064]);
sourceIds_2050 = __wm_tail_arg_137_0;
functionId_2051 = __wm_tail_arg_137_1;
context_2052 = __wm_tail_arg_137_2;
state_2053 = __wm_tail_arg_137_3;
reversed_2054 = __wm_tail_arg_137_4;
continue __wm_tail_119;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildChildren_2031 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildChildren_2031__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildIf_2032__wm_d5 = (source_2067, functionId_2068, tailPosition_2069, context_2070, state_2071) => {
const __wm_return_value_41 = Js.Array.toList(source_2067.children);
if (__wm_return_value_41?.ctor === -6 && __wm_return_value_41.args.length === 1 && __wm_is_tuple(__wm_return_value_41.args[0]) && __wm_return_value_41.args[0].length === 2 && __wm_return_value_41.args[0][1]?.ctor === -6 && __wm_return_value_41.args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_41.args[0][1].args[0]) && __wm_return_value_41.args[0][1].args[0].length === 2 && __wm_return_value_41.args[0][1].args[0][1]?.ctor === -6 && __wm_return_value_41.args[0][1].args[0][1].args.length === 1 && __wm_is_tuple(__wm_return_value_41.args[0][1].args[0][1].args[0]) && __wm_return_value_41.args[0][1].args[0][1].args[0].length === 2 && __wm_return_value_41.args[0][1].args[0][1].args[0][1] === __wm_basis_Nil) {
const conditionId_2072 = __wm_return_value_41.args[0][0];
const thenId_2073 = __wm_return_value_41.args[0][1].args[0][0];
const elseId_2074 = __wm_return_value_41.args[0][1].args[0][1].args[0][0];
const __wm_bind_72 = buildExpression_2030__wm_d5(conditionId_2072, functionId_2068, false, context_2070, state_2071);
if (!(__wm_is_tuple(__wm_bind_72) && __wm_bind_72.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const conditionIr_2075 = __wm_bind_72[0];
const afterCondition_2076 = __wm_bind_72[1];
const __wm_bind_73 = buildExpression_2030__wm_d5(thenId_2073, functionId_2068, tailPosition_2069, context_2070, afterCondition_2076);
if (!(__wm_is_tuple(__wm_bind_73) && __wm_bind_73.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const thenIr_2077 = __wm_bind_73[0];
const afterThen_2078 = __wm_bind_73[1];
const __wm_bind_74 = buildExpression_2030__wm_d5(elseId_2074, functionId_2068, tailPosition_2069, context_2070, afterThen_2078);
if (!(__wm_is_tuple(__wm_bind_74) && __wm_bind_74.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const elseIr_2079 = __wm_bind_74[0];
const afterElse_2080 = __wm_bind_74[1];
const expression_2081 = { ...baseIrExpression_1982__wm_d4(afterElse_2080, source_2067, functionId_2068, "if"), children: Js.Array.fromList(__wm_basis_Cons([conditionIr_2075, __wm_basis_Cons([thenIr_2077, __wm_basis_Cons([elseIr_2079, __wm_basis_Nil])])])) };
return addExpression_1986__wm_d2(expression_2081, afterElse_2080);
} else if (true) {

return __wm_fail("Panic", "schema-v2 if does not have three children");
}
__wm_fail("Match", "non-exhaustive match");
};
const buildIf_2032 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildIf_2032__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildMatch_2033__wm_d5 = (source_2082, functionId_2083, tailPosition_2084, context_2085, state_2086) => {
const row_2087 = findMatch_1753__wm_d2(context_2085.matches, source_2082.id);
const diagnosed_2088 = (matchIsExhaustive_2014__wm_d3(source_2082, row_2087, context_2085) ? state_2086 : addDiagnostic_1990__wm_d2(nonExhaustiveDiagnostic_1998(source_2082), state_2086));
const __wm_bind_75 = buildExpression_2030__wm_d5(row_2087.valueExprId, functionId_2083, false, context_2085, diagnosed_2088);
if (!(__wm_is_tuple(__wm_bind_75) && __wm_bind_75.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const valueIr_2089 = __wm_bind_75[0];
const afterValue_2090 = __wm_bind_75[1];
const __wm_bind_76 = buildMatchArms_2034__wm_d6(Js.Array.toList(row_2087.armIds), functionId_2083, tailPosition_2084, context_2085, afterValue_2090, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_76) && __wm_bind_76.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const armIds_2091 = __wm_bind_76[0];
const afterArms_2092 = __wm_bind_76[1];
const expression_2093 = { ...baseIrExpression_1982__wm_d4(afterArms_2092, source_2082, functionId_2083, "match"), children: Js.Array.fromList(__wm_basis_Cons([valueIr_2089, __wm_basis_Nil])), armIds: Js.Array.fromList(armIds_2091) };
return addExpression_1986__wm_d2(expression_2093, afterArms_2092);
};
const buildMatch_2033 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildMatch_2033__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildMatchArms_2034__wm_d6 = (sourceArmIds_2094, functionId_2095, tailPosition_2096, context_2097, state_2098, reversed_2099) => {
__wm_tail_120: while (true) {
{
const __wm_scalar_146_0 = sourceArmIds_2094;
const __wm_scalar_146_1 = functionId_2095;
const __wm_scalar_146_2 = tailPosition_2096;
const __wm_scalar_146_3 = context_2097;
const __wm_scalar_146_4 = state_2098;
const __wm_scalar_146_5 = reversed_2099;
if (__wm_scalar_146_0 === __wm_basis_Nil) {
const functionId_2100 = __wm_scalar_146_1;
const tailPosition_2101 = __wm_scalar_146_2;
const context_2102 = __wm_scalar_146_3;
const state_2103 = __wm_scalar_146_4;
const reversed_2104 = __wm_scalar_146_5;
return [reverseInto_1691__wm_d2(reversed_2104, __wm_basis_Nil), state_2103];
} else if (__wm_scalar_146_0?.ctor === -6 && __wm_scalar_146_0.args.length === 1 && __wm_is_tuple(__wm_scalar_146_0.args[0]) && __wm_scalar_146_0.args[0].length === 2) {
const sourceArmId_2105 = __wm_scalar_146_0.args[0][0];
const rest_2106 = __wm_scalar_146_0.args[0][1];
const functionId_2107 = __wm_scalar_146_1;
const tailPosition_2108 = __wm_scalar_146_2;
const context_2109 = __wm_scalar_146_3;
const state_2110 = __wm_scalar_146_4;
const reversed_2111 = __wm_scalar_146_5;
{
const sourceArm_2112 = findMatchArm_1760__wm_d2(context_2109.matchArms, sourceArmId_2105);
const __wm_bind_77 = buildExpression_2030__wm_d5(sourceArm_2112.bodyExprId, functionId_2107, tailPosition_2108, context_2109, state_2110);
if (!(__wm_is_tuple(__wm_bind_77) && __wm_bind_77.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const bodyIr_2113 = __wm_bind_77[0];
const afterBody_2114 = __wm_bind_77[1];
const arm_2115 = { id: afterBody_2114.nextArmId, sourceArmId: sourceArm_2112.id, patternId: sourceArm_2112.patternId, bodyExprId: bodyIr_2113, spanId: sourceArm_2112.spanId };
const afterArm_2116 = { ...afterBody_2114, nextArmId: (afterBody_2114.nextArmId + 1), matchArms: __wm_basis_Cons([arm_2115, afterBody_2114.matchArms]) };
{
const __wm_tail_arg_138_0 = rest_2106;
const __wm_tail_arg_138_1 = functionId_2107;
const __wm_tail_arg_138_2 = tailPosition_2108;
const __wm_tail_arg_138_3 = context_2109;
const __wm_tail_arg_138_4 = afterArm_2116;
const __wm_tail_arg_138_5 = __wm_basis_Cons([arm_2115.id, reversed_2111]);
sourceArmIds_2094 = __wm_tail_arg_138_0;
functionId_2095 = __wm_tail_arg_138_1;
tailPosition_2096 = __wm_tail_arg_138_2;
context_2097 = __wm_tail_arg_138_3;
state_2098 = __wm_tail_arg_138_4;
reversed_2099 = __wm_tail_arg_138_5;
continue __wm_tail_120;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildMatchArms_2034 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return buildMatchArms_2034__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const buildBlock_2035__wm_d5 = (source_2117, functionId_2118, tailPosition_2119, context_2120, state_2121) => {
const row_2122 = findBlock_1732__wm_d2(context_2120.blocks, source_2117.id);
const __wm_bind_78 = buildBlockValues_2036__wm_d5(Js.Array.toList(row_2122.itemIds), functionId_2118, context_2120, state_2121, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_78) && __wm_bind_78.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const builtItems_2123 = __wm_bind_78[0];
const afterItems_2124 = __wm_bind_78[1];
const __wm_bind_79 = buildExpression_2030__wm_d5(row_2122.resultExprId, functionId_2118, tailPosition_2119, context_2120, afterItems_2124);
if (!(__wm_is_tuple(__wm_bind_79) && __wm_bind_79.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const resultIr_2125 = __wm_bind_79[0];
const afterResult_2126 = __wm_bind_79[1];
return buildBlockWrappers_2037__wm_d6(reverseInto_1691__wm_d2(builtItems_2123, __wm_basis_Nil), source_2117, functionId_2118, resultIr_2125, context_2120, afterResult_2126);
};
const buildBlock_2035 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildBlock_2035__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildBlockValues_2036__wm_d5 = (itemIds_2127, functionId_2128, context_2129, state_2130, reversed_2131) => {
__wm_tail_121: while (true) {
{
const __wm_scalar_147_0 = itemIds_2127;
const __wm_scalar_147_1 = functionId_2128;
const __wm_scalar_147_2 = context_2129;
const __wm_scalar_147_3 = state_2130;
const __wm_scalar_147_4 = reversed_2131;
if (__wm_scalar_147_0 === __wm_basis_Nil) {
const functionId_2132 = __wm_scalar_147_1;
const context_2133 = __wm_scalar_147_2;
const state_2134 = __wm_scalar_147_3;
const reversed_2135 = __wm_scalar_147_4;
return [reverseInto_1691__wm_d2(reversed_2135, __wm_basis_Nil), state_2134];
} else if (__wm_scalar_147_0?.ctor === -6 && __wm_scalar_147_0.args.length === 1 && __wm_is_tuple(__wm_scalar_147_0.args[0]) && __wm_scalar_147_0.args[0].length === 2) {
const itemId_2136 = __wm_scalar_147_0.args[0][0];
const rest_2137 = __wm_scalar_147_0.args[0][1];
const functionId_2138 = __wm_scalar_147_1;
const context_2139 = __wm_scalar_147_2;
const state_2140 = __wm_scalar_147_3;
const reversed_2141 = __wm_scalar_147_4;
{
const item_2142 = findBlockItem_1739__wm_d2(context_2139.blockItems, itemId_2136);
if (__wm_eq(item_2142.kind, "let")) {
{
const letRow_2143 = findLet_1746__wm_d2(context_2139.lets, item_2142.letId);
const __wm_bind_80 = buildExpression_2030__wm_d5(letRow_2143.valueExprId, functionId_2138, false, context_2139, state_2140);
if (!(__wm_is_tuple(__wm_bind_80) && __wm_bind_80.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const valueIr_2144 = __wm_bind_80[0];
const afterValue_2145 = __wm_bind_80[1];
const built_2146 = { itemId: item_2142.id, valueExprId: valueIr_2144 };
{
const __wm_tail_arg_139_0 = rest_2137;
const __wm_tail_arg_139_1 = functionId_2138;
const __wm_tail_arg_139_2 = context_2139;
const __wm_tail_arg_139_3 = afterValue_2145;
const __wm_tail_arg_139_4 = __wm_basis_Cons([built_2146, reversed_2141]);
itemIds_2127 = __wm_tail_arg_139_0;
functionId_2128 = __wm_tail_arg_139_1;
context_2129 = __wm_tail_arg_139_2;
state_2130 = __wm_tail_arg_139_3;
reversed_2131 = __wm_tail_arg_139_4;
continue __wm_tail_121;
}
}
} else {
{
const __wm_bind_81 = buildExpression_2030__wm_d5(item_2142.expressionId, functionId_2138, false, context_2139, state_2140);
if (!(__wm_is_tuple(__wm_bind_81) && __wm_bind_81.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const valueIr_2147 = __wm_bind_81[0];
const afterValue_2148 = __wm_bind_81[1];
const built_2149 = { itemId: item_2142.id, valueExprId: valueIr_2147 };
{
const __wm_tail_arg_140_0 = rest_2137;
const __wm_tail_arg_140_1 = functionId_2138;
const __wm_tail_arg_140_2 = context_2139;
const __wm_tail_arg_140_3 = afterValue_2148;
const __wm_tail_arg_140_4 = __wm_basis_Cons([built_2149, reversed_2141]);
itemIds_2127 = __wm_tail_arg_140_0;
functionId_2128 = __wm_tail_arg_140_1;
context_2129 = __wm_tail_arg_140_2;
state_2130 = __wm_tail_arg_140_3;
reversed_2131 = __wm_tail_arg_140_4;
continue __wm_tail_121;
}
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildBlockValues_2036 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return buildBlockValues_2036__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const buildBlockWrappers_2037__wm_d6 = (builtItems_2150, source_2151, functionId_2152, bodyIr_2153, context_2154, state_2155) => {
__wm_tail_122: while (true) {
{
const __wm_scalar_148_0 = builtItems_2150;
const __wm_scalar_148_1 = source_2151;
const __wm_scalar_148_2 = functionId_2152;
const __wm_scalar_148_3 = bodyIr_2153;
const __wm_scalar_148_4 = context_2154;
const __wm_scalar_148_5 = state_2155;
if (__wm_scalar_148_0 === __wm_basis_Nil) {
const source_2156 = __wm_scalar_148_1;
const functionId_2157 = __wm_scalar_148_2;
const bodyIr_2158 = __wm_scalar_148_3;
const context_2159 = __wm_scalar_148_4;
const state_2160 = __wm_scalar_148_5;
return [bodyIr_2158, state_2160];
} else if (__wm_scalar_148_0?.ctor === -6 && __wm_scalar_148_0.args.length === 1 && __wm_is_tuple(__wm_scalar_148_0.args[0]) && __wm_scalar_148_0.args[0].length === 2) {
const built_2161 = __wm_scalar_148_0.args[0][0];
const rest_2162 = __wm_scalar_148_0.args[0][1];
const source_2163 = __wm_scalar_148_1;
const functionId_2164 = __wm_scalar_148_2;
const bodyIr_2165 = __wm_scalar_148_3;
const context_2166 = __wm_scalar_148_4;
const state_2167 = __wm_scalar_148_5;
{
const item_2168 = findBlockItem_1739__wm_d2(context_2166.blockItems, built_2161.itemId);
if (__wm_eq(item_2168.kind, "let")) {
{
const letRow_2169 = findLet_1746__wm_d2(context_2166.lets, item_2168.letId);
const expression_2170 = { ...baseIrExpression_1982__wm_d4(state_2167, source_2163, functionId_2164, "let"), spanId: item_2168.spanId, bindingId: __wm_op_sub(1), patternId: letRow_2169.patternId, targetFunctionId: __wm_op_sub(1), children: Js.Array.fromList(__wm_basis_Cons([built_2161.valueExprId, __wm_basis_Cons([bodyIr_2165, __wm_basis_Nil])])) };
const __wm_bind_82 = addExpression_1986__wm_d2(expression_2170, state_2167);
if (!(__wm_is_tuple(__wm_bind_82) && __wm_bind_82.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const letIr_2171 = __wm_bind_82[0];
const afterLet_2172 = __wm_bind_82[1];
{
const __wm_tail_arg_141_0 = rest_2162;
const __wm_tail_arg_141_1 = source_2163;
const __wm_tail_arg_141_2 = functionId_2164;
const __wm_tail_arg_141_3 = letIr_2171;
const __wm_tail_arg_141_4 = context_2166;
const __wm_tail_arg_141_5 = afterLet_2172;
builtItems_2150 = __wm_tail_arg_141_0;
source_2151 = __wm_tail_arg_141_1;
functionId_2152 = __wm_tail_arg_141_2;
bodyIr_2153 = __wm_tail_arg_141_3;
context_2154 = __wm_tail_arg_141_4;
state_2155 = __wm_tail_arg_141_5;
continue __wm_tail_122;
}
}
} else {
{
const expression_2173 = { ...baseIrExpression_1982__wm_d4(state_2167, source_2163, functionId_2164, "sequence"), spanId: item_2168.spanId, bindingId: __wm_op_sub(1), targetFunctionId: __wm_op_sub(1), children: Js.Array.fromList(__wm_basis_Cons([built_2161.valueExprId, __wm_basis_Cons([bodyIr_2165, __wm_basis_Nil])])) };
const __wm_bind_83 = addExpression_1986__wm_d2(expression_2173, state_2167);
if (!(__wm_is_tuple(__wm_bind_83) && __wm_bind_83.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const sequenceIr_2174 = __wm_bind_83[0];
const afterSequence_2175 = __wm_bind_83[1];
{
const __wm_tail_arg_142_0 = rest_2162;
const __wm_tail_arg_142_1 = source_2163;
const __wm_tail_arg_142_2 = functionId_2164;
const __wm_tail_arg_142_3 = sequenceIr_2174;
const __wm_tail_arg_142_4 = context_2166;
const __wm_tail_arg_142_5 = afterSequence_2175;
builtItems_2150 = __wm_tail_arg_142_0;
source_2151 = __wm_tail_arg_142_1;
functionId_2152 = __wm_tail_arg_142_2;
bodyIr_2153 = __wm_tail_arg_142_3;
context_2154 = __wm_tail_arg_142_4;
state_2155 = __wm_tail_arg_142_5;
continue __wm_tail_122;
}
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildBlockWrappers_2037 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return buildBlockWrappers_2037__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const buildFunctions_2176__wm_d3 = (functions_2177, context_2178, state_2179) => {
__wm_tail_123: while (true) {
{
const __wm_scalar_149_0 = functions_2177;
const __wm_scalar_149_1 = context_2178;
const __wm_scalar_149_2 = state_2179;
if (__wm_scalar_149_0 === __wm_basis_Nil) {
const context_2180 = __wm_scalar_149_1;
const state_2181 = __wm_scalar_149_2;
return state_2181;
} else if (__wm_scalar_149_0?.ctor === -6 && __wm_scalar_149_0.args.length === 1 && __wm_is_tuple(__wm_scalar_149_0.args[0]) && __wm_scalar_149_0.args[0].length === 2) {
const fn_2182 = __wm_scalar_149_0.args[0][0];
const rest_2183 = __wm_scalar_149_0.args[0][1];
const context_2184 = __wm_scalar_149_1;
const state_2185 = __wm_scalar_149_2;
{
const __wm_bind_84 = buildExpression_2030__wm_d5(fn_2182.bodyExprId, fn_2182.id, true, context_2184, state_2185);
if (!(__wm_is_tuple(__wm_bind_84) && __wm_bind_84.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const bodyIr_2186 = __wm_bind_84[0];
const afterBody_2187 = __wm_bind_84[1];
const irFunction_2188 = { functionId: fn_2182.id, bindingId: fn_2182.bindingId, name: fn_2182.name, paramIds: fn_2182.paramIds, resultTypeId: fn_2182.resultTypeId, bodyExprId: bodyIr_2186, recursionGroupId: fn_2182.recursionGroupId, spanId: fn_2182.spanId };
const afterFunction_2189 = { ...afterBody_2187, functions: __wm_basis_Cons([irFunction_2188, afterBody_2187.functions]) };
{
const __wm_tail_arg_143_0 = rest_2183;
const __wm_tail_arg_143_1 = context_2184;
const __wm_tail_arg_143_2 = afterFunction_2189;
functions_2177 = __wm_tail_arg_143_0;
context_2178 = __wm_tail_arg_143_1;
state_2179 = __wm_tail_arg_143_2;
continue __wm_tail_123;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const buildFunctions_2176 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return buildFunctions_2176__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const findOccurrence_2190__wm_d3 = (items_2191, kind_2192, sourceId_2193) => {
__wm_tail_124: while (true) {
{
const __wm_scalar_150_0 = items_2191;
const __wm_scalar_150_1 = kind_2192;
const __wm_scalar_150_2 = sourceId_2193;
if (__wm_scalar_150_0 === __wm_basis_Nil) {
const kind_2194 = __wm_scalar_150_1;
const sourceId_2195 = __wm_scalar_150_2;
return __wm_fail("Panic", "missing concrete GPU occurrence type");
} else if (__wm_scalar_150_0?.ctor === -6 && __wm_scalar_150_0.args.length === 1 && __wm_is_tuple(__wm_scalar_150_0.args[0]) && __wm_scalar_150_0.args[0].length === 2) {
const item_2196 = __wm_scalar_150_0.args[0][0];
const rest_2197 = __wm_scalar_150_0.args[0][1];
const kind_2198 = __wm_scalar_150_1;
const sourceId_2199 = __wm_scalar_150_2;
if (__wm_op_and_d2(__wm_eq(item_2196.kind, kind_2198), numberEqual_1714__wm_d2(item_2196.sourceId, sourceId_2199))) {
return item_2196;
} else {
{
const __wm_tail_arg_144_0 = rest_2197;
const __wm_tail_arg_144_1 = kind_2198;
const __wm_tail_arg_144_2 = sourceId_2199;
items_2191 = __wm_tail_arg_144_0;
kind_2192 = __wm_tail_arg_144_1;
sourceId_2193 = __wm_tail_arg_144_2;
continue __wm_tail_124;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findOccurrence_2190 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findOccurrence_2190__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizeExpressions_2200__wm_d3 = (expressions_2201, occurrences_2202, output_2203) => {
__wm_tail_125: while (true) {
{
const __wm_scalar_151_0 = expressions_2201;
const __wm_scalar_151_1 = occurrences_2202;
const __wm_scalar_151_2 = output_2203;
if (__wm_scalar_151_0 === __wm_basis_Nil) {
const occurrences_2204 = __wm_scalar_151_1;
const output_2205 = __wm_scalar_151_2;
return reverseInto_1691__wm_d2(output_2205, __wm_basis_Nil);
} else if (__wm_scalar_151_0?.ctor === -6 && __wm_scalar_151_0.args.length === 1 && __wm_is_tuple(__wm_scalar_151_0.args[0]) && __wm_scalar_151_0.args[0].length === 2) {
const expression_2206 = __wm_scalar_151_0.args[0][0];
const rest_2207 = __wm_scalar_151_0.args[0][1];
const occurrences_2208 = __wm_scalar_151_1;
const output_2209 = __wm_scalar_151_2;
{
const occurrence_2210 = findOccurrence_2190__wm_d3(occurrences_2208, "expression", expression_2206.id);
const concrete_2211 = { ...expression_2206, typeId: occurrence_2210.shaderTypeId };
{
const __wm_tail_arg_145_0 = rest_2207;
const __wm_tail_arg_145_1 = occurrences_2208;
const __wm_tail_arg_145_2 = __wm_basis_Cons([concrete_2211, output_2209]);
expressions_2201 = __wm_tail_arg_145_0;
occurrences_2202 = __wm_tail_arg_145_1;
output_2203 = __wm_tail_arg_145_2;
continue __wm_tail_125;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizeExpressions_2200 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concretizeExpressions_2200__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizePatterns_2212__wm_d3 = (patterns_2213, occurrences_2214, output_2215) => {
__wm_tail_126: while (true) {
{
const __wm_scalar_152_0 = patterns_2213;
const __wm_scalar_152_1 = occurrences_2214;
const __wm_scalar_152_2 = output_2215;
if (__wm_scalar_152_0 === __wm_basis_Nil) {
const occurrences_2216 = __wm_scalar_152_1;
const output_2217 = __wm_scalar_152_2;
return reverseInto_1691__wm_d2(output_2217, __wm_basis_Nil);
} else if (__wm_scalar_152_0?.ctor === -6 && __wm_scalar_152_0.args.length === 1 && __wm_is_tuple(__wm_scalar_152_0.args[0]) && __wm_scalar_152_0.args[0].length === 2) {
const pattern_2218 = __wm_scalar_152_0.args[0][0];
const rest_2219 = __wm_scalar_152_0.args[0][1];
const occurrences_2220 = __wm_scalar_152_1;
const output_2221 = __wm_scalar_152_2;
{
const occurrence_2222 = findOccurrence_2190__wm_d3(occurrences_2220, "pattern", pattern_2218.id);
const concrete_2223 = { ...pattern_2218, typeId: occurrence_2222.shaderTypeId };
{
const __wm_tail_arg_146_0 = rest_2219;
const __wm_tail_arg_146_1 = occurrences_2220;
const __wm_tail_arg_146_2 = __wm_basis_Cons([concrete_2223, output_2221]);
patterns_2213 = __wm_tail_arg_146_0;
occurrences_2214 = __wm_tail_arg_146_1;
output_2215 = __wm_tail_arg_146_2;
continue __wm_tail_126;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizePatterns_2212 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concretizePatterns_2212__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizeParams_2224__wm_d3 = (params_2225, patterns_2226, output_2227) => {
__wm_tail_127: while (true) {
{
const __wm_scalar_153_0 = params_2225;
const __wm_scalar_153_1 = patterns_2226;
const __wm_scalar_153_2 = output_2227;
if (__wm_scalar_153_0 === __wm_basis_Nil) {
const patterns_2228 = __wm_scalar_153_1;
const output_2229 = __wm_scalar_153_2;
return reverseInto_1691__wm_d2(output_2229, __wm_basis_Nil);
} else if (__wm_scalar_153_0?.ctor === -6 && __wm_scalar_153_0.args.length === 1 && __wm_is_tuple(__wm_scalar_153_0.args[0]) && __wm_scalar_153_0.args[0].length === 2) {
const param_2230 = __wm_scalar_153_0.args[0][0];
const rest_2231 = __wm_scalar_153_0.args[0][1];
const patterns_2232 = __wm_scalar_153_1;
const output_2233 = __wm_scalar_153_2;
{
const pattern_2234 = findPattern_1767__wm_d2(patterns_2232, param_2230.patternId);
const concrete_2235 = { ...param_2230, typeId: pattern_2234.typeId };
{
const __wm_tail_arg_147_0 = rest_2231;
const __wm_tail_arg_147_1 = patterns_2232;
const __wm_tail_arg_147_2 = __wm_basis_Cons([concrete_2235, output_2233]);
params_2225 = __wm_tail_arg_147_0;
patterns_2226 = __wm_tail_arg_147_1;
output_2227 = __wm_tail_arg_147_2;
continue __wm_tail_127;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizeParams_2224 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concretizeParams_2224__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizeFunctions_2236__wm_d3 = (functions_2237, expressions_2238, output_2239) => {
__wm_tail_128: while (true) {
{
const __wm_scalar_154_0 = functions_2237;
const __wm_scalar_154_1 = expressions_2238;
const __wm_scalar_154_2 = output_2239;
if (__wm_scalar_154_0 === __wm_basis_Nil) {
const expressions_2240 = __wm_scalar_154_1;
const output_2241 = __wm_scalar_154_2;
return reverseInto_1691__wm_d2(output_2241, __wm_basis_Nil);
} else if (__wm_scalar_154_0?.ctor === -6 && __wm_scalar_154_0.args.length === 1 && __wm_is_tuple(__wm_scalar_154_0.args[0]) && __wm_scalar_154_0.args[0].length === 2) {
const fn_2242 = __wm_scalar_154_0.args[0][0];
const rest_2243 = __wm_scalar_154_0.args[0][1];
const expressions_2244 = __wm_scalar_154_1;
const output_2245 = __wm_scalar_154_2;
{
const body_2246 = findExpression_1725__wm_d2(expressions_2244, fn_2242.bodyExprId);
const concrete_2247 = { ...fn_2242, resultTypeId: body_2246.typeId };
{
const __wm_tail_arg_148_0 = rest_2243;
const __wm_tail_arg_148_1 = expressions_2244;
const __wm_tail_arg_148_2 = __wm_basis_Cons([concrete_2247, output_2245]);
functions_2237 = __wm_tail_arg_148_0;
expressions_2238 = __wm_tail_arg_148_1;
output_2239 = __wm_tail_arg_148_2;
continue __wm_tail_128;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizeFunctions_2236 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concretizeFunctions_2236__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const uniformShaderTypeId_2248__wm_d4 = (expressions_2249, occurrences_2250, index_2251, fallback_2252) => {
__wm_tail_129: while (true) {
{
const __wm_scalar_155_0 = expressions_2249;
const __wm_scalar_155_1 = occurrences_2250;
const __wm_scalar_155_2 = index_2251;
const __wm_scalar_155_3 = fallback_2252;
if (__wm_scalar_155_0 === __wm_basis_Nil) {
const occurrences_2253 = __wm_scalar_155_1;
const index_2254 = __wm_scalar_155_2;
const fallback_2255 = __wm_scalar_155_3;
return fallback_2255;
} else if (__wm_scalar_155_0?.ctor === -6 && __wm_scalar_155_0.args.length === 1 && __wm_is_tuple(__wm_scalar_155_0.args[0]) && __wm_scalar_155_0.args[0].length === 2) {
const expression_2256 = __wm_scalar_155_0.args[0][0];
const rest_2257 = __wm_scalar_155_0.args[0][1];
const occurrences_2258 = __wm_scalar_155_1;
const index_2259 = __wm_scalar_155_2;
const fallback_2260 = __wm_scalar_155_3;
if (__wm_op_and_d2(__wm_eq(expression_2256.kind, "uniform"), numberEqual_1714__wm_d2(expression_2256.index, index_2259))) {
{
const occurrence_2261 = findOccurrence_2190__wm_d3(occurrences_2258, "expression", expression_2256.id);
return occurrence_2261.shaderTypeId;
}
} else {
{
const __wm_tail_arg_149_0 = rest_2257;
const __wm_tail_arg_149_1 = occurrences_2258;
const __wm_tail_arg_149_2 = index_2259;
const __wm_tail_arg_149_3 = fallback_2260;
expressions_2249 = __wm_tail_arg_149_0;
occurrences_2250 = __wm_tail_arg_149_1;
index_2251 = __wm_tail_arg_149_2;
fallback_2252 = __wm_tail_arg_149_3;
continue __wm_tail_129;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const uniformShaderTypeId_2248 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return uniformShaderTypeId_2248__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const concretizeEnvironmentFields_2262__wm_d4 = (fields_2263, expressions_2264, occurrences_2265, output_2266) => {
__wm_tail_130: while (true) {
{
const __wm_scalar_156_0 = fields_2263;
const __wm_scalar_156_1 = expressions_2264;
const __wm_scalar_156_2 = occurrences_2265;
const __wm_scalar_156_3 = output_2266;
if (__wm_scalar_156_0 === __wm_basis_Nil) {
const expressions_2267 = __wm_scalar_156_1;
const occurrences_2268 = __wm_scalar_156_2;
const output_2269 = __wm_scalar_156_3;
return reverseInto_1691__wm_d2(output_2269, __wm_basis_Nil);
} else if (__wm_scalar_156_0?.ctor === -6 && __wm_scalar_156_0.args.length === 1 && __wm_is_tuple(__wm_scalar_156_0.args[0]) && __wm_scalar_156_0.args[0].length === 2) {
const field_2270 = __wm_scalar_156_0.args[0][0];
const rest_2271 = __wm_scalar_156_0.args[0][1];
const expressions_2272 = __wm_scalar_156_1;
const occurrences_2273 = __wm_scalar_156_2;
const output_2274 = __wm_scalar_156_3;
{
const concrete_2275 = { ...field_2270, typeId: uniformShaderTypeId_2248__wm_d4(expressions_2272, occurrences_2273, field_2270.declaredIndex, field_2270.typeId) };
{
const __wm_tail_arg_150_0 = rest_2271;
const __wm_tail_arg_150_1 = expressions_2272;
const __wm_tail_arg_150_2 = occurrences_2273;
const __wm_tail_arg_150_3 = __wm_basis_Cons([concrete_2275, output_2274]);
fields_2263 = __wm_tail_arg_150_0;
expressions_2264 = __wm_tail_arg_150_1;
occurrences_2265 = __wm_tail_arg_150_2;
output_2266 = __wm_tail_arg_150_3;
continue __wm_tail_130;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const concretizeEnvironmentFields_2262 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return concretizeEnvironmentFields_2262__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const compileSliceProgram_2294 = (__arg) => {
if (true) {
const input_2276 = __arg;
const elaboration_2277 = elaborateSliceProgramTypes_1960(input_2276);
const shaderTypes_2278 = elaboration_2277.shaderTypes;
const occurrences_2279 = Js.Array.toList(elaboration_2277.occurrences);
const sourceExpressions_2280 = Js.Array.toList(input_2276.expressions);
const concreteExpressions_2281 = concretizeExpressions_2200__wm_d3(sourceExpressions_2280, occurrences_2279, __wm_basis_Nil);
const concretePatterns_2282 = concretizePatterns_2212__wm_d3(Js.Array.toList(input_2276.patterns), occurrences_2279, __wm_basis_Nil);
const elaboratedInput_2283 = { ...input_2276, types: shaderTypes_2278, environmentFields: Js.Array.fromList(concretizeEnvironmentFields_2262__wm_d4(Js.Array.toList(input_2276.environmentFields), sourceExpressions_2280, occurrences_2279, __wm_basis_Nil)), functions: Js.Array.fromList(concretizeFunctions_2236__wm_d3(Js.Array.toList(input_2276.functions), concreteExpressions_2281, __wm_basis_Nil)), patterns: Js.Array.fromList(concretePatterns_2282), params: Js.Array.fromList(concretizeParams_2224__wm_d3(Js.Array.toList(input_2276.params), concretePatterns_2282, __wm_basis_Nil)), expressions: Js.Array.fromList(concreteExpressions_2281) };
const builtinCatalog_2284 = elaboratedInput_2283.builtinCatalog;
const context_2285 = { expressions: Js.Array.toList(elaboratedInput_2283.expressions), blocks: Js.Array.toList(elaboratedInput_2283.blocks), blockItems: Js.Array.toList(elaboratedInput_2283.blockItems), lets: Js.Array.toList(elaboratedInput_2283.lets), matches: Js.Array.toList(elaboratedInput_2283.matches), matchArms: Js.Array.toList(elaboratedInput_2283.matchArms), patterns: Js.Array.toList(elaboratedInput_2283.patterns), types: Js.Array.toList(elaboratedInput_2283.types), adts: Js.Array.toList(elaboratedInput_2283.adts), functions: Js.Array.toList(elaboratedInput_2283.functions), builtinOverloads: Js.Array.toList(builtinCatalog_2284.overloads), occurrences: occurrences_2279 };
const state_2286 = buildFunctions_2176__wm_d3(Js.Array.toList(elaboratedInput_2283.functions), context_2285, initialState_1976(undefined));
const layouts_2287 = buildSliceLayouts_140(elaboratedInput_2283);
const irFunctions_2288 = Js.Array.fromList(reverseInto_1691__wm_d2(state_2286.functions, __wm_basis_Nil));
const irExpressions_2289 = Js.Array.fromList(reverseInto_1691__wm_d2(state_2286.expressions, __wm_basis_Nil));
const irMatchArms_2290 = Js.Array.fromList(reverseInto_1691__wm_d2(state_2286.matchArms, __wm_basis_Nil));
const lowered_2291 = lowerSliceProgram_849__wm_d8(irFunctions_2288, irExpressions_2289, irMatchArms_2290, elaboratedInput_2283.params, elaboratedInput_2283.patterns, elaboratedInput_2283.constructors, layouts_2287.adtLayouts, layouts_2287.adtFields);
const slangSource_2292 = ((__v) => {
if (__v === __wm_basis_Nil) {

return emitSliceSlang_1326__wm_d10(elaboratedInput_2283, layouts_2287.adtLayouts, layouts_2287.adtFields, lowered_2291.functions, lowered_2291.locals, lowered_2291.atoms, lowered_2291.operations, lowered_2291.statements, lowered_2291.blocks, lowered_2291.cases);
} else if (true) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
})(state_2286.diagnostics);
const output_2293 = { schemaVersion: 5, program: input_2276, shaderTypes: shaderTypes_2278, typeEvidence: elaboration_2277.typeEvidence, occurrences: elaboration_2277.occurrences, builtinSelections: elaboration_2277.builtinSelections, irFunctions: irFunctions_2288, irExpressions: irExpressions_2289, irMatchArms: irMatchArms_2290, adtLayouts: layouts_2287.adtLayouts, adtFields: layouts_2287.adtFields, loweredFunctions: lowered_2291.functions, loweredLocals: lowered_2291.locals, loweredAtoms: lowered_2291.atoms, loweredOperations: lowered_2291.operations, loweredStatements: lowered_2291.statements, loweredBlocks: lowered_2291.blocks, loweredCases: lowered_2291.cases, slangSource: slangSource_2292, diagnostics: Js.Array.fromList(reverseInto_1691__wm_d2(state_2286.diagnostics, __wm_basis_Nil)) };
return output_2293;
}
__wm_fail("Match", "pattern match failure in function");
};
return { "SliceContext": SliceContext_1688, "SliceIrState": SliceIrState_1689, "BuiltBlockItem": BuiltBlockItem_1690, "reverseInto": reverseInto_1691, "reverseInto__wm_d2": reverseInto_1691__wm_d2, "append": append_1698, "append__wm_d2": append_1698__wm_d2, "listLength": listLength_1705, "listLength__wm_d2": listLength_1705__wm_d2, "numberEqual": numberEqual_1714, "numberEqual__wm_d2": numberEqual_1714__wm_d2, "contains": contains_1715, "contains__wm_d2": contains_1715__wm_d2, "unique": unique_1720, "unique__wm_d2": unique_1720__wm_d2, "findExpression": findExpression_1725, "findExpression__wm_d2": findExpression_1725__wm_d2, "findBlock": findBlock_1732, "findBlock__wm_d2": findBlock_1732__wm_d2, "findBlockItem": findBlockItem_1739, "findBlockItem__wm_d2": findBlockItem_1739__wm_d2, "findLet": findLet_1746, "findLet__wm_d2": findLet_1746__wm_d2, "findMatch": findMatch_1753, "findMatch__wm_d2": findMatch_1753__wm_d2, "findMatchArm": findMatchArm_1760, "findMatchArm__wm_d2": findMatchArm_1760__wm_d2, "findPattern": findPattern_1767, "findPattern__wm_d2": findPattern_1767__wm_d2, "findType": findType_1774, "findType__wm_d2": findType_1774__wm_d2, "findExpressionOccurrence": findExpressionOccurrence_1781, "findExpressionOccurrence__wm_d2": findExpressionOccurrence_1781__wm_d2, "shaderBuiltinTypeName": shaderBuiltinTypeName_1798, "shaderBuiltinTypeName__wm_d2": shaderBuiltinTypeName_1798__wm_d2, "builtinParamsMatch": builtinParamsMatch_1799, "builtinParamsMatch__wm_d3": builtinParamsMatch_1799__wm_d3, "selectBuiltinOverload": selectBuiltinOverload_1811, "selectBuiltinOverload__wm_d3": selectBuiltinOverload_1811__wm_d3, "collectBuiltinSelections": collectBuiltinSelections_1821, "collectBuiltinSelections__wm_d3": collectBuiltinSelections_1821__wm_d3, "allSemanticNumbers": allSemanticNumbers_1832, "allSemanticNumbers__wm_d2": allSemanticNumbers_1832__wm_d2, "shaderTypeKind": shaderTypeKind_1844, "shaderTypeKind__wm_d2": shaderTypeKind_1844__wm_d2, "shaderTypeReason": shaderTypeReason_1847, "shaderTypeReason__wm_d2": shaderTypeReason_1847__wm_d2, "offsetTypeIds": offsetTypeIds_1848, "offsetTypeIds__wm_d3": offsetTypeIds_1848__wm_d3, "addI32ShaderTypes": addI32ShaderTypes_1858, "addI32ShaderTypes__wm_d4": addI32ShaderTypes_1858__wm_d4, "concreteShaderTypeId": concreteShaderTypeId_1882, "concreteShaderTypeId__wm_d4": concreteShaderTypeId_1882__wm_d4, "elaborateSliceTypes": elaborateSliceTypes_1883, "elaborateSliceTypes__wm_d4": elaborateSliceTypes_1883__wm_d4, "addExpressionOccurrences": addExpressionOccurrences_1899, "addExpressionOccurrences__wm_d5": addExpressionOccurrences_1899__wm_d5, "addPatternOccurrences": addPatternOccurrences_1917, "addPatternOccurrences__wm_d6": addPatternOccurrences_1917__wm_d6, "addFunctionOccurrences": addFunctionOccurrences_1938, "addFunctionOccurrences__wm_d2": addFunctionOccurrences_1938__wm_d2, "elaborateSliceProgramTypes": elaborateSliceProgramTypes_1960, "findAdt": findAdt_1961, "findAdt__wm_d2": findAdt_1961__wm_d2, "findFunction": findFunction_1968, "findFunction__wm_d2": findFunction_1968__wm_d2, "initialState": initialState_1976, "baseIrExpression": baseIrExpression_1982, "baseIrExpression__wm_d4": baseIrExpression_1982__wm_d4, "addExpression": addExpression_1986, "addExpression__wm_d2": addExpression_1986__wm_d2, "addDiagnostic": addDiagnostic_1990, "addDiagnostic__wm_d2": addDiagnostic_1990__wm_d2, "nonTailDiagnostic": nonTailDiagnostic_1995, "nonTailDiagnostic__wm_d2": nonTailDiagnostic_1995__wm_d2, "nonExhaustiveDiagnostic": nonExhaustiveDiagnostic_1998, "constructorPatterns": constructorPatterns_1999, "constructorPatterns__wm_d4": constructorPatterns_1999__wm_d4, "matchIsExhaustive": matchIsExhaustive_2014, "matchIsExhaustive__wm_d3": matchIsExhaustive_2014__wm_d3, "constructorSetContains": constructorSetContains_2015, "constructorSetContains__wm_d2": constructorSetContains_2015__wm_d2, "buildExpression": buildExpression_2030, "buildExpression__wm_d5": buildExpression_2030__wm_d5, "buildChildren": buildChildren_2031, "buildChildren__wm_d5": buildChildren_2031__wm_d5, "buildIf": buildIf_2032, "buildIf__wm_d5": buildIf_2032__wm_d5, "buildMatch": buildMatch_2033, "buildMatch__wm_d5": buildMatch_2033__wm_d5, "buildMatchArms": buildMatchArms_2034, "buildMatchArms__wm_d6": buildMatchArms_2034__wm_d6, "buildBlock": buildBlock_2035, "buildBlock__wm_d5": buildBlock_2035__wm_d5, "buildBlockValues": buildBlockValues_2036, "buildBlockValues__wm_d5": buildBlockValues_2036__wm_d5, "buildBlockWrappers": buildBlockWrappers_2037, "buildBlockWrappers__wm_d6": buildBlockWrappers_2037__wm_d6, "buildFunctions": buildFunctions_2176, "buildFunctions__wm_d3": buildFunctions_2176__wm_d3, "findOccurrence": findOccurrence_2190, "findOccurrence__wm_d3": findOccurrence_2190__wm_d3, "concretizeExpressions": concretizeExpressions_2200, "concretizeExpressions__wm_d3": concretizeExpressions_2200__wm_d3, "concretizePatterns": concretizePatterns_2212, "concretizePatterns__wm_d3": concretizePatterns_2212__wm_d3, "concretizeParams": concretizeParams_2224, "concretizeParams__wm_d3": concretizeParams_2224__wm_d3, "concretizeFunctions": concretizeFunctions_2236, "concretizeFunctions__wm_d3": concretizeFunctions_2236__wm_d3, "uniformShaderTypeId": uniformShaderTypeId_2248, "uniformShaderTypeId__wm_d4": uniformShaderTypeId_2248__wm_d4, "concretizeEnvironmentFields": concretizeEnvironmentFields_2262, "concretizeEnvironmentFields__wm_d4": concretizeEnvironmentFields_2262__wm_d4, "compileSliceProgram": compileSliceProgram_2294 };
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
const compileSliceProgram_2294 = __wm_module_6["compileSliceProgram"];
const elaborateSliceProgramTypes_1960 = __wm_module_6["elaborateSliceProgramTypes"];
const SpecializationRegistryEntry_2295 = (__record_args) => ({ specializationId: __record_args[0], paramRepresentations: __record_args[1], resultRepresentation: __record_args[2] });
const SpecializationBuildState_2296 = (__record_args) => ({ nextId: __record_args[0], registry: __record_args[1], specializations: __record_args[2], rootSpecializations: __record_args[3], calls: __record_args[4], diagnostics: __record_args[5] });
const IrBuildState_2297 = (__record_args) => ({ nextExpressionId: __record_args[0], functions: __record_args[1], expressions: __record_args[2] });
const typedExpression_2300 = (__arg) => {
if (true) {
const expression_2298 = __arg;
const output_2299 = { id: expression_2298.id, kind: expression_2298.kind, typeId: expression_2298.typeId, spanId: expression_2298.spanId, bindingId: expression_2298.bindingId, name: expression_2298.name, operator: expression_2298.operator, numberValue: expression_2298.numberValue, boolValue: expression_2298.boolValue, children: expression_2298.children, capability: expression_2298.capability };
return output_2299;
}
__wm_fail("Match", "pattern match failure in function");
};
const typedFunction_2305__wm_d2 = (reachable_2301, fn_2302) => {
const capability_2303 = (__wm_eq(fn_2302.capability, "gpu-only") ? "gpu-only" : (Map.has([reachable_2301, fn_2302.id]) ? "gpu-eligible" : "cpu-only"));
const output_2304 = { id: fn_2302.id, regionId: fn_2302.regionId, bindingId: fn_2302.bindingId, name: fn_2302.name, params: fn_2302.params, resultTypeId: fn_2302.resultTypeId, bodyExprId: fn_2302.bodyExprId, spanId: fn_2302.spanId, capability: capability_2303 };
return output_2304;
};
const typedFunction_2305 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return typedFunction_2305__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const emptyOutput_2307 = (__arg) => {
if (__arg === undefined) {

const output_2306 = { schemaVersion: 1, functions: Js.Array.fromList(__wm_basis_Nil), captures: Js.Array.fromList(__wm_basis_Nil), specializations: Js.Array.fromList(__wm_basis_Nil), rootSpecializations: Js.Array.fromList(__wm_basis_Nil), calls: Js.Array.fromList(__wm_basis_Nil), irFunctions: Js.Array.fromList(__wm_basis_Nil), irExpressions: Js.Array.fromList(__wm_basis_Nil), types: Js.Array.fromList(__wm_basis_Nil), expressions: Js.Array.fromList(__wm_basis_Nil), diagnostics: Js.Array.fromList(__wm_basis_Nil) };
return output_2306;
}
__wm_fail("Match", "pattern match failure in function");
};
const incompatibleSchema_2311 = (__arg) => {
if (true) {
const version_2308 = __arg;
const diagnostic_2309 = { code: "gpu.schema-version", message: "unsupported GPU elaboration schema version", spanId: __wm_op_sub(1) };
const output_2310 = { schemaVersion: 1, functions: Js.Array.fromList(__wm_basis_Nil), captures: Js.Array.fromList(__wm_basis_Nil), specializations: Js.Array.fromList(__wm_basis_Nil), rootSpecializations: Js.Array.fromList(__wm_basis_Nil), calls: Js.Array.fromList(__wm_basis_Nil), irFunctions: Js.Array.fromList(__wm_basis_Nil), irExpressions: Js.Array.fromList(__wm_basis_Nil), types: Js.Array.fromList(__wm_basis_Nil), expressions: Js.Array.fromList(__wm_basis_Nil), diagnostics: Js.Array.fromList(__wm_basis_Cons([diagnostic_2309, __wm_basis_Nil])) };
return output_2310;
}
__wm_fail("Match", "pattern match failure in function");
};
const prependAll_2312__wm_d2 = (items_2313, tail_2314) => {
const __wm_scalar_157_0 = items_2313;
const __wm_scalar_157_1 = tail_2314;
if (__wm_scalar_157_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_157_1, tail_2314)) {

return tail_2314;
} else if (__wm_scalar_157_0?.ctor === -6 && __wm_scalar_157_0.args.length === 1 && __wm_is_tuple(__wm_scalar_157_0.args[0]) && __wm_scalar_157_0.args[0].length === 2 && __wm_eq(__wm_scalar_157_1, tail_2314)) {
const head_2315 = __wm_scalar_157_0.args[0][0];
const rest_2316 = __wm_scalar_157_0.args[0][1];
return __wm_basis_Cons([head_2315, prependAll_2312__wm_d2(rest_2316, tail_2314)]);
}
__wm_fail("Match", "non-exhaustive match");
};
const prependAll_2312 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return prependAll_2312__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const reverseInto_2317__wm_d2 = (items_2318, reversed_2319) => {
__wm_tail_131: while (true) {
{
const __wm_scalar_158_0 = items_2318;
const __wm_scalar_158_1 = reversed_2319;
if (__wm_scalar_158_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_158_1, reversed_2319)) {

return reversed_2319;
} else if (__wm_scalar_158_0?.ctor === -6 && __wm_scalar_158_0.args.length === 1 && __wm_is_tuple(__wm_scalar_158_0.args[0]) && __wm_scalar_158_0.args[0].length === 2 && __wm_eq(__wm_scalar_158_1, reversed_2319)) {
const head_2320 = __wm_scalar_158_0.args[0][0];
const rest_2321 = __wm_scalar_158_0.args[0][1];
{
const __wm_tail_arg_151_0 = rest_2321;
const __wm_tail_arg_151_1 = __wm_basis_Cons([head_2320, reversed_2319]);
items_2318 = __wm_tail_arg_151_0;
reversed_2319 = __wm_tail_arg_151_1;
continue __wm_tail_131;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reverseInto_2317 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reverseInto_2317__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const capabilityDiagnostic_2325 = (__arg) => {
if (true) {
const expression_2322 = __arg;
if (__wm_eq(expression_2322.capability, "host-ffi")) {
const diagnostic_2323 = { code: "gpu.host-ffi", message: "host FFI expression cannot execute in a GPU region", spanId: expression_2322.spanId };
return __wm_basis_Some(diagnostic_2323);
} else {
if (__wm_eq(expression_2322.capability, "unsupported")) {
const diagnostic_2324 = { code: "gpu.unsupported-expression", message: "expression is not supported by the current GPU language subset", spanId: expression_2322.spanId };
return __wm_basis_Some(diagnostic_2324);
} else {
return __wm_basis_None;
}
}
}
__wm_fail("Match", "pattern match failure in function");
};
const reachableBodyIds_2326__wm_d3 = (functions_2327, reachable_2328, bodyIds_2329) => {
__wm_tail_132: while (true) {
{
const __wm_scalar_159_0 = functions_2327;
const __wm_scalar_159_1 = reachable_2328;
const __wm_scalar_159_2 = bodyIds_2329;
if (__wm_scalar_159_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_159_1, reachable_2328) && __wm_eq(__wm_scalar_159_2, bodyIds_2329)) {

return bodyIds_2329;
} else if (__wm_scalar_159_0?.ctor === -6 && __wm_scalar_159_0.args.length === 1 && __wm_is_tuple(__wm_scalar_159_0.args[0]) && __wm_scalar_159_0.args[0].length === 2 && __wm_eq(__wm_scalar_159_1, reachable_2328) && __wm_eq(__wm_scalar_159_2, bodyIds_2329)) {
const fn_2330 = __wm_scalar_159_0.args[0][0];
const rest_2331 = __wm_scalar_159_0.args[0][1];
if (Map.has([reachable_2328, fn_2330.id])) {
{
const __wm_tail_arg_152_0 = rest_2331;
const __wm_tail_arg_152_1 = reachable_2328;
const __wm_tail_arg_152_2 = __wm_basis_Cons([fn_2330.bodyExprId, bodyIds_2329]);
functions_2327 = __wm_tail_arg_152_0;
reachable_2328 = __wm_tail_arg_152_1;
bodyIds_2329 = __wm_tail_arg_152_2;
continue __wm_tail_132;
}
} else {
{
const __wm_tail_arg_153_0 = rest_2331;
const __wm_tail_arg_153_1 = reachable_2328;
const __wm_tail_arg_153_2 = bodyIds_2329;
functions_2327 = __wm_tail_arg_153_0;
reachable_2328 = __wm_tail_arg_153_1;
bodyIds_2329 = __wm_tail_arg_153_2;
continue __wm_tail_132;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reachableBodyIds_2326 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return reachableBodyIds_2326__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const reachableCapabilityDiagnostics_2332__wm_d4 = (pending_2333, expressionRegistry_2334, visited_2335, diagnostics_2336) => {
__wm_tail_133: while (true) {
{
const __wm_scalar_160_0 = pending_2333;
const __wm_scalar_160_1 = expressionRegistry_2334;
const __wm_scalar_160_2 = visited_2335;
const __wm_scalar_160_3 = diagnostics_2336;
if (__wm_scalar_160_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_160_1, expressionRegistry_2334) && __wm_eq(__wm_scalar_160_2, visited_2335) && __wm_eq(__wm_scalar_160_3, diagnostics_2336)) {

return diagnostics_2336;
} else if (__wm_scalar_160_0?.ctor === -6 && __wm_scalar_160_0.args.length === 1 && __wm_is_tuple(__wm_scalar_160_0.args[0]) && __wm_scalar_160_0.args[0].length === 2 && __wm_eq(__wm_scalar_160_1, expressionRegistry_2334) && __wm_eq(__wm_scalar_160_2, visited_2335) && __wm_eq(__wm_scalar_160_3, diagnostics_2336)) {
const expressionId_2337 = __wm_scalar_160_0.args[0][0];
const rest_2338 = __wm_scalar_160_0.args[0][1];
if (Map.has([visited_2335, expressionId_2337])) {
{
const __wm_tail_arg_154_0 = rest_2338;
const __wm_tail_arg_154_1 = expressionRegistry_2334;
const __wm_tail_arg_154_2 = visited_2335;
const __wm_tail_arg_154_3 = diagnostics_2336;
pending_2333 = __wm_tail_arg_154_0;
expressionRegistry_2334 = __wm_tail_arg_154_1;
visited_2335 = __wm_tail_arg_154_2;
diagnostics_2336 = __wm_tail_arg_154_3;
continue __wm_tail_133;
}
} else {
{
const nextVisited_2339 = Map.set([visited_2335, expressionId_2337, true]);
{
const __wm_tail_value_155 = Map.get([expressionRegistry_2334, expressionId_2337]);
if (__wm_tail_value_155 === __wm_basis_None) {

{
const __wm_tail_arg_156_0 = rest_2338;
const __wm_tail_arg_156_1 = expressionRegistry_2334;
const __wm_tail_arg_156_2 = nextVisited_2339;
const __wm_tail_arg_156_3 = diagnostics_2336;
pending_2333 = __wm_tail_arg_156_0;
expressionRegistry_2334 = __wm_tail_arg_156_1;
visited_2335 = __wm_tail_arg_156_2;
diagnostics_2336 = __wm_tail_arg_156_3;
continue __wm_tail_133;
}
} else if (__wm_tail_value_155?.ctor === -2 && __wm_tail_value_155.args.length === 1) {
const expression_2340 = __wm_tail_value_155.args[0];
{
const nextDiagnostics_2342 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const diagnostic_2341 = __v.args[0];
return __wm_basis_Cons([diagnostic_2341, diagnostics_2336]);
} else if (__v === __wm_basis_None) {

return diagnostics_2336;
}
__wm_fail("Match", "non-exhaustive match");
})(capabilityDiagnostic_2325(expression_2340));
{
const __wm_tail_arg_157_0 = prependAll_2312__wm_d2(Js.Array.toList(expression_2340.children), rest_2338);
const __wm_tail_arg_157_1 = expressionRegistry_2334;
const __wm_tail_arg_157_2 = nextVisited_2339;
const __wm_tail_arg_157_3 = nextDiagnostics_2342;
pending_2333 = __wm_tail_arg_157_0;
expressionRegistry_2334 = __wm_tail_arg_157_1;
visited_2335 = __wm_tail_arg_157_2;
diagnostics_2336 = __wm_tail_arg_157_3;
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
const reachableCapabilityDiagnostics_2332 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return reachableCapabilityDiagnostics_2332__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const duplicateFunctionDiagnostic_2345 = (__arg) => {
if (true) {
const fn_2343 = __arg;
const diagnostic_2344 = { code: "gpu.duplicate-function-id", message: "duplicate function ID in GPU elaboration input", spanId: fn_2343.spanId };
return diagnostic_2344;
}
__wm_fail("Match", "pattern match failure in function");
};
const registerFunctions_2346__wm_d3 = (functions_2347, registry_2348, diagnostics_2349) => {
__wm_tail_134: while (true) {
{
const __wm_scalar_161_0 = functions_2347;
const __wm_scalar_161_1 = registry_2348;
const __wm_scalar_161_2 = diagnostics_2349;
if (__wm_scalar_161_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_161_1, registry_2348) && __wm_eq(__wm_scalar_161_2, diagnostics_2349)) {

return [registry_2348, diagnostics_2349];
} else if (__wm_scalar_161_0?.ctor === -6 && __wm_scalar_161_0.args.length === 1 && __wm_is_tuple(__wm_scalar_161_0.args[0]) && __wm_scalar_161_0.args[0].length === 2 && __wm_eq(__wm_scalar_161_1, registry_2348) && __wm_eq(__wm_scalar_161_2, diagnostics_2349)) {
const fn_2350 = __wm_scalar_161_0.args[0][0];
const rest_2351 = __wm_scalar_161_0.args[0][1];
if (Map.has([registry_2348, fn_2350.id])) {
{
const __wm_tail_arg_158_0 = rest_2351;
const __wm_tail_arg_158_1 = registry_2348;
const __wm_tail_arg_158_2 = __wm_basis_Cons([duplicateFunctionDiagnostic_2345(fn_2350), diagnostics_2349]);
functions_2347 = __wm_tail_arg_158_0;
registry_2348 = __wm_tail_arg_158_1;
diagnostics_2349 = __wm_tail_arg_158_2;
continue __wm_tail_134;
}
} else {
{
const __wm_tail_arg_159_0 = rest_2351;
const __wm_tail_arg_159_1 = Map.set([registry_2348, fn_2350.id, fn_2350]);
const __wm_tail_arg_159_2 = diagnostics_2349;
functions_2347 = __wm_tail_arg_159_0;
registry_2348 = __wm_tail_arg_159_1;
diagnostics_2349 = __wm_tail_arg_159_2;
continue __wm_tail_134;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const registerFunctions_2346 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return registerFunctions_2346__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const indexFunctionBindings_2352__wm_d2 = (functions_2353, registry_2354) => {
__wm_tail_135: while (true) {
{
const __wm_scalar_162_0 = functions_2353;
const __wm_scalar_162_1 = registry_2354;
if (__wm_scalar_162_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_162_1, registry_2354)) {

return registry_2354;
} else if (__wm_scalar_162_0?.ctor === -6 && __wm_scalar_162_0.args.length === 1 && __wm_is_tuple(__wm_scalar_162_0.args[0]) && __wm_scalar_162_0.args[0].length === 2 && __wm_eq(__wm_scalar_162_1, registry_2354)) {
const fn_2355 = __wm_scalar_162_0.args[0][0];
const rest_2356 = __wm_scalar_162_0.args[0][1];
if ((fn_2355.bindingId < 0)) {
{
const __wm_tail_arg_160_0 = rest_2356;
const __wm_tail_arg_160_1 = registry_2354;
functions_2353 = __wm_tail_arg_160_0;
registry_2354 = __wm_tail_arg_160_1;
continue __wm_tail_135;
}
} else {
{
const __wm_tail_arg_161_0 = rest_2356;
const __wm_tail_arg_161_1 = Map.set([registry_2354, fn_2355.bindingId, fn_2355.id]);
functions_2353 = __wm_tail_arg_161_0;
registry_2354 = __wm_tail_arg_161_1;
continue __wm_tail_135;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexFunctionBindings_2352 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexFunctionBindings_2352__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const callDependency_2363__wm_d3 = (expression_2357, expressionRegistry_2358, bindingFunctions_2359) => {
if (__wm_eq(expression_2357.kind, "call")) {
const __wm_return_value_42 = Js.Array.toList(expression_2357.children);
if (__wm_return_value_42?.ctor === -6 && __wm_return_value_42.args.length === 1 && __wm_is_tuple(__wm_return_value_42.args[0]) && __wm_return_value_42.args[0].length === 2) {
const calleeId_2360 = __wm_return_value_42.args[0][0];
const _rest_2361 = __wm_return_value_42.args[0][1];
const __wm_return_value_43 = Map.get([expressionRegistry_2358, calleeId_2360]);
if (__wm_return_value_43?.ctor === -2 && __wm_return_value_43.args.length === 1) {
const callee_2362 = __wm_return_value_43.args[0];
return Map.get([bindingFunctions_2359, callee_2362.bindingId]);
} else if (__wm_return_value_43 === __wm_basis_None) {

return __wm_basis_None;
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_42 === __wm_basis_Nil) {

return __wm_basis_None;
}
__wm_fail("Match", "non-exhaustive match");
} else {
return __wm_basis_None;
}
};
const callDependency_2363 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return callDependency_2363__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const collectFunctionDependencies_2364__wm_d5 = (pending_2365, expressionRegistry_2366, bindingFunctions_2367, visited_2368, dependencies_2369) => {
__wm_tail_136: while (true) {
{
const __wm_scalar_163_0 = pending_2365;
const __wm_scalar_163_1 = expressionRegistry_2366;
const __wm_scalar_163_2 = bindingFunctions_2367;
const __wm_scalar_163_3 = visited_2368;
const __wm_scalar_163_4 = dependencies_2369;
if (__wm_scalar_163_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_163_1, expressionRegistry_2366) && __wm_eq(__wm_scalar_163_2, bindingFunctions_2367) && __wm_eq(__wm_scalar_163_3, visited_2368) && __wm_eq(__wm_scalar_163_4, dependencies_2369)) {

return dependencies_2369;
} else if (__wm_scalar_163_0?.ctor === -6 && __wm_scalar_163_0.args.length === 1 && __wm_is_tuple(__wm_scalar_163_0.args[0]) && __wm_scalar_163_0.args[0].length === 2 && __wm_eq(__wm_scalar_163_1, expressionRegistry_2366) && __wm_eq(__wm_scalar_163_2, bindingFunctions_2367) && __wm_eq(__wm_scalar_163_3, visited_2368) && __wm_eq(__wm_scalar_163_4, dependencies_2369)) {
const expressionId_2370 = __wm_scalar_163_0.args[0][0];
const rest_2371 = __wm_scalar_163_0.args[0][1];
if (Map.has([visited_2368, expressionId_2370])) {
{
const __wm_tail_arg_162_0 = rest_2371;
const __wm_tail_arg_162_1 = expressionRegistry_2366;
const __wm_tail_arg_162_2 = bindingFunctions_2367;
const __wm_tail_arg_162_3 = visited_2368;
const __wm_tail_arg_162_4 = dependencies_2369;
pending_2365 = __wm_tail_arg_162_0;
expressionRegistry_2366 = __wm_tail_arg_162_1;
bindingFunctions_2367 = __wm_tail_arg_162_2;
visited_2368 = __wm_tail_arg_162_3;
dependencies_2369 = __wm_tail_arg_162_4;
continue __wm_tail_136;
}
} else {
{
const nextVisited_2372 = Map.set([visited_2368, expressionId_2370, true]);
{
const __wm_tail_value_163 = Map.get([expressionRegistry_2366, expressionId_2370]);
if (__wm_tail_value_163 === __wm_basis_None) {

{
const __wm_tail_arg_164_0 = rest_2371;
const __wm_tail_arg_164_1 = expressionRegistry_2366;
const __wm_tail_arg_164_2 = bindingFunctions_2367;
const __wm_tail_arg_164_3 = nextVisited_2372;
const __wm_tail_arg_164_4 = dependencies_2369;
pending_2365 = __wm_tail_arg_164_0;
expressionRegistry_2366 = __wm_tail_arg_164_1;
bindingFunctions_2367 = __wm_tail_arg_164_2;
visited_2368 = __wm_tail_arg_164_3;
dependencies_2369 = __wm_tail_arg_164_4;
continue __wm_tail_136;
}
} else if (__wm_tail_value_163?.ctor === -2 && __wm_tail_value_163.args.length === 1) {
const expression_2373 = __wm_tail_value_163.args[0];
{
const nextDependencies_2375 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const functionId_2374 = __v.args[0];
return Map.set([dependencies_2369, functionId_2374, true]);
} else if (__v === __wm_basis_None) {

return dependencies_2369;
}
__wm_fail("Match", "non-exhaustive match");
})(callDependency_2363__wm_d3(expression_2373, expressionRegistry_2366, bindingFunctions_2367));
{
const __wm_tail_arg_165_0 = prependAll_2312__wm_d2(Js.Array.toList(expression_2373.children), rest_2371);
const __wm_tail_arg_165_1 = expressionRegistry_2366;
const __wm_tail_arg_165_2 = bindingFunctions_2367;
const __wm_tail_arg_165_3 = nextVisited_2372;
const __wm_tail_arg_165_4 = nextDependencies_2375;
pending_2365 = __wm_tail_arg_165_0;
expressionRegistry_2366 = __wm_tail_arg_165_1;
bindingFunctions_2367 = __wm_tail_arg_165_2;
visited_2368 = __wm_tail_arg_165_3;
dependencies_2369 = __wm_tail_arg_165_4;
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
const collectFunctionDependencies_2364 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return collectFunctionDependencies_2364__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const enqueueDependencies_2376__wm_d2 = (entries_2377, pending_2378) => {
__wm_tail_137: while (true) {
{
const __wm_scalar_164_0 = entries_2377;
const __wm_scalar_164_1 = pending_2378;
if (__wm_scalar_164_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_164_1, pending_2378)) {

return pending_2378;
} else if (__wm_scalar_164_0?.ctor === -6 && __wm_scalar_164_0.args.length === 1 && __wm_is_tuple(__wm_scalar_164_0.args[0]) && __wm_scalar_164_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_164_0.args[0][0]) && __wm_scalar_164_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_164_1, pending_2378)) {
const functionId_2379 = __wm_scalar_164_0.args[0][0][0];
const _reachable_2380 = __wm_scalar_164_0.args[0][0][1];
const rest_2381 = __wm_scalar_164_0.args[0][1];
{
const __wm_tail_arg_166_0 = rest_2381;
const __wm_tail_arg_166_1 = __wm_basis_Cons([functionId_2379, pending_2378]);
entries_2377 = __wm_tail_arg_166_0;
pending_2378 = __wm_tail_arg_166_1;
continue __wm_tail_137;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const enqueueDependencies_2376 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return enqueueDependencies_2376__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const rootFunctionIds_2382__wm_d2 = (roots_2383, functionIds_2384) => {
__wm_tail_138: while (true) {
{
const __wm_scalar_165_0 = roots_2383;
const __wm_scalar_165_1 = functionIds_2384;
if (__wm_scalar_165_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_165_1, functionIds_2384)) {

return functionIds_2384;
} else if (__wm_scalar_165_0?.ctor === -6 && __wm_scalar_165_0.args.length === 1 && __wm_is_tuple(__wm_scalar_165_0.args[0]) && __wm_scalar_165_0.args[0].length === 2 && __wm_eq(__wm_scalar_165_1, functionIds_2384)) {
const root_2385 = __wm_scalar_165_0.args[0][0];
const rest_2386 = __wm_scalar_165_0.args[0][1];
{
const __wm_tail_arg_167_0 = rest_2386;
const __wm_tail_arg_167_1 = __wm_basis_Cons([root_2385.functionId, functionIds_2384]);
roots_2383 = __wm_tail_arg_167_0;
functionIds_2384 = __wm_tail_arg_167_1;
continue __wm_tail_138;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const rootFunctionIds_2382 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return rootFunctionIds_2382__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const solveReachableFunctions_2387__wm_d5 = (pending_2388, functionRegistry_2389, expressionRegistry_2390, bindingFunctions_2391, reachable_2392) => {
__wm_tail_139: while (true) {
{
const __wm_scalar_166_0 = pending_2388;
const __wm_scalar_166_1 = functionRegistry_2389;
const __wm_scalar_166_2 = expressionRegistry_2390;
const __wm_scalar_166_3 = bindingFunctions_2391;
const __wm_scalar_166_4 = reachable_2392;
if (__wm_scalar_166_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_166_1, functionRegistry_2389) && __wm_eq(__wm_scalar_166_2, expressionRegistry_2390) && __wm_eq(__wm_scalar_166_3, bindingFunctions_2391) && __wm_eq(__wm_scalar_166_4, reachable_2392)) {

return reachable_2392;
} else if (__wm_scalar_166_0?.ctor === -6 && __wm_scalar_166_0.args.length === 1 && __wm_is_tuple(__wm_scalar_166_0.args[0]) && __wm_scalar_166_0.args[0].length === 2 && __wm_eq(__wm_scalar_166_1, functionRegistry_2389) && __wm_eq(__wm_scalar_166_2, expressionRegistry_2390) && __wm_eq(__wm_scalar_166_3, bindingFunctions_2391) && __wm_eq(__wm_scalar_166_4, reachable_2392)) {
const functionId_2393 = __wm_scalar_166_0.args[0][0];
const rest_2394 = __wm_scalar_166_0.args[0][1];
if (Map.has([reachable_2392, functionId_2393])) {
{
const __wm_tail_arg_168_0 = rest_2394;
const __wm_tail_arg_168_1 = functionRegistry_2389;
const __wm_tail_arg_168_2 = expressionRegistry_2390;
const __wm_tail_arg_168_3 = bindingFunctions_2391;
const __wm_tail_arg_168_4 = reachable_2392;
pending_2388 = __wm_tail_arg_168_0;
functionRegistry_2389 = __wm_tail_arg_168_1;
expressionRegistry_2390 = __wm_tail_arg_168_2;
bindingFunctions_2391 = __wm_tail_arg_168_3;
reachable_2392 = __wm_tail_arg_168_4;
continue __wm_tail_139;
}
} else {
{
const nextReachable_2395 = Map.set([reachable_2392, functionId_2393, true]);
{
const __wm_tail_value_169 = Map.get([functionRegistry_2389, functionId_2393]);
if (__wm_tail_value_169 === __wm_basis_None) {

{
const __wm_tail_arg_170_0 = rest_2394;
const __wm_tail_arg_170_1 = functionRegistry_2389;
const __wm_tail_arg_170_2 = expressionRegistry_2390;
const __wm_tail_arg_170_3 = bindingFunctions_2391;
const __wm_tail_arg_170_4 = nextReachable_2395;
pending_2388 = __wm_tail_arg_170_0;
functionRegistry_2389 = __wm_tail_arg_170_1;
expressionRegistry_2390 = __wm_tail_arg_170_2;
bindingFunctions_2391 = __wm_tail_arg_170_3;
reachable_2392 = __wm_tail_arg_170_4;
continue __wm_tail_139;
}
} else if (__wm_tail_value_169?.ctor === -2 && __wm_tail_value_169.args.length === 1) {
const fn_2396 = __wm_tail_value_169.args[0];
{
const dependencies_2397 = collectFunctionDependencies_2364__wm_d5(__wm_basis_Cons([fn_2396.bodyExprId, __wm_basis_Nil]), expressionRegistry_2390, bindingFunctions_2391, Map.empty(Map.numberCompare), Map.empty(Map.numberCompare));
{
const __wm_tail_arg_171_0 = enqueueDependencies_2376__wm_d2(Map.toList(dependencies_2397), rest_2394);
const __wm_tail_arg_171_1 = functionRegistry_2389;
const __wm_tail_arg_171_2 = expressionRegistry_2390;
const __wm_tail_arg_171_3 = bindingFunctions_2391;
const __wm_tail_arg_171_4 = nextReachable_2395;
pending_2388 = __wm_tail_arg_171_0;
functionRegistry_2389 = __wm_tail_arg_171_1;
expressionRegistry_2390 = __wm_tail_arg_171_2;
bindingFunctions_2391 = __wm_tail_arg_171_3;
reachable_2392 = __wm_tail_arg_171_4;
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
const solveReachableFunctions_2387 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return solveReachableFunctions_2387__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const indexBindings_2398__wm_d2 = (bindings_2399, registry_2400) => {
__wm_tail_140: while (true) {
{
const __wm_scalar_167_0 = bindings_2399;
const __wm_scalar_167_1 = registry_2400;
if (__wm_scalar_167_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_167_1, registry_2400)) {

return registry_2400;
} else if (__wm_scalar_167_0?.ctor === -6 && __wm_scalar_167_0.args.length === 1 && __wm_is_tuple(__wm_scalar_167_0.args[0]) && __wm_scalar_167_0.args[0].length === 2 && __wm_eq(__wm_scalar_167_1, registry_2400)) {
const binding_2401 = __wm_scalar_167_0.args[0][0];
const rest_2402 = __wm_scalar_167_0.args[0][1];
{
const __wm_tail_arg_172_0 = rest_2402;
const __wm_tail_arg_172_1 = Map.set([registry_2400, binding_2401.id, binding_2401]);
bindings_2399 = __wm_tail_arg_172_0;
registry_2400 = __wm_tail_arg_172_1;
continue __wm_tail_140;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexBindings_2398 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexBindings_2398__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const bindParams_2403__wm_d2 = (params_2404, bound_2405) => {
__wm_tail_141: while (true) {
{
const __wm_scalar_168_0 = params_2404;
const __wm_scalar_168_1 = bound_2405;
if (__wm_scalar_168_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_168_1, bound_2405)) {

return bound_2405;
} else if (__wm_scalar_168_0?.ctor === -6 && __wm_scalar_168_0.args.length === 1 && __wm_is_tuple(__wm_scalar_168_0.args[0]) && __wm_scalar_168_0.args[0].length === 2 && __wm_eq(__wm_scalar_168_1, bound_2405)) {
const param_2406 = __wm_scalar_168_0.args[0][0];
const rest_2407 = __wm_scalar_168_0.args[0][1];
{
const __wm_tail_arg_173_0 = rest_2407;
const __wm_tail_arg_173_1 = Map.set([bound_2405, param_2406.bindingId, true]);
params_2404 = __wm_tail_arg_173_0;
bound_2405 = __wm_tail_arg_173_1;
continue __wm_tail_141;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const bindParams_2403 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return bindParams_2403__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collectLocalBindings_2408__wm_d4 = (pending_2409, expressionRegistry_2410, visited_2411, bound_2412) => {
__wm_tail_142: while (true) {
{
const __wm_scalar_169_0 = pending_2409;
const __wm_scalar_169_1 = expressionRegistry_2410;
const __wm_scalar_169_2 = visited_2411;
const __wm_scalar_169_3 = bound_2412;
if (__wm_scalar_169_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_169_1, expressionRegistry_2410) && __wm_eq(__wm_scalar_169_2, visited_2411) && __wm_eq(__wm_scalar_169_3, bound_2412)) {

return bound_2412;
} else if (__wm_scalar_169_0?.ctor === -6 && __wm_scalar_169_0.args.length === 1 && __wm_is_tuple(__wm_scalar_169_0.args[0]) && __wm_scalar_169_0.args[0].length === 2 && __wm_eq(__wm_scalar_169_1, expressionRegistry_2410) && __wm_eq(__wm_scalar_169_2, visited_2411) && __wm_eq(__wm_scalar_169_3, bound_2412)) {
const expressionId_2413 = __wm_scalar_169_0.args[0][0];
const rest_2414 = __wm_scalar_169_0.args[0][1];
if (Map.has([visited_2411, expressionId_2413])) {
{
const __wm_tail_arg_174_0 = rest_2414;
const __wm_tail_arg_174_1 = expressionRegistry_2410;
const __wm_tail_arg_174_2 = visited_2411;
const __wm_tail_arg_174_3 = bound_2412;
pending_2409 = __wm_tail_arg_174_0;
expressionRegistry_2410 = __wm_tail_arg_174_1;
visited_2411 = __wm_tail_arg_174_2;
bound_2412 = __wm_tail_arg_174_3;
continue __wm_tail_142;
}
} else {
{
const nextVisited_2415 = Map.set([visited_2411, expressionId_2413, true]);
{
const __wm_tail_value_175 = Map.get([expressionRegistry_2410, expressionId_2413]);
if (__wm_tail_value_175 === __wm_basis_None) {

{
const __wm_tail_arg_176_0 = rest_2414;
const __wm_tail_arg_176_1 = expressionRegistry_2410;
const __wm_tail_arg_176_2 = nextVisited_2415;
const __wm_tail_arg_176_3 = bound_2412;
pending_2409 = __wm_tail_arg_176_0;
expressionRegistry_2410 = __wm_tail_arg_176_1;
visited_2411 = __wm_tail_arg_176_2;
bound_2412 = __wm_tail_arg_176_3;
continue __wm_tail_142;
}
} else if (__wm_tail_value_175?.ctor === -2 && __wm_tail_value_175.args.length === 1) {
const expression_2416 = __wm_tail_value_175.args[0];
{
const nextBound_2417 = (__wm_op_and_d2(__wm_eq(expression_2416.kind, "let"), (expression_2416.bindingId >= 0)) ? Map.set([bound_2412, expression_2416.bindingId, true]) : bound_2412);
{
const __wm_tail_arg_177_0 = prependAll_2312__wm_d2(Js.Array.toList(expression_2416.children), rest_2414);
const __wm_tail_arg_177_1 = expressionRegistry_2410;
const __wm_tail_arg_177_2 = nextVisited_2415;
const __wm_tail_arg_177_3 = nextBound_2417;
pending_2409 = __wm_tail_arg_177_0;
expressionRegistry_2410 = __wm_tail_arg_177_1;
visited_2411 = __wm_tail_arg_177_2;
bound_2412 = __wm_tail_arg_177_3;
continue __wm_tail_142;
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
const collectLocalBindings_2408 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return collectLocalBindings_2408__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const constantExpression_2418__wm_d5 = (expressionId_2420, expressionRegistry_2421, bindingRegistry_2422, visitedExpressions_2423, visitedBindings_2424) => {
__wm_tail_143: while (true) {
if (Map.has([visitedExpressions_2423, expressionId_2420])) {
return false;
} else {
{
const __wm_tail_value_178 = Map.get([expressionRegistry_2421, expressionId_2420]);
if (__wm_tail_value_178 === __wm_basis_None) {

return false;
} else if (__wm_tail_value_178?.ctor === -2 && __wm_tail_value_178.args.length === 1) {
const expression_2425 = __wm_tail_value_178.args[0];
{
const nextExpressions_2426 = Map.set([visitedExpressions_2423, expressionId_2420, true]);
if (__wm_op_or_d2(__wm_eq(expression_2425.kind, "number"), __wm_eq(expression_2425.kind, "bool"))) {
return true;
} else {
if (__wm_op_or_d2(__wm_op_or_d2(__wm_eq(expression_2425.kind, "tuple"), __wm_eq(expression_2425.kind, "binary")), __wm_eq(expression_2425.kind, "unary"))) {
return constantExpressions_2419__wm_d5(Js.Array.toList(expression_2425.children), expressionRegistry_2421, bindingRegistry_2422, nextExpressions_2426, visitedBindings_2424);
} else {
if (__wm_op_and_d2(__wm_eq(expression_2425.kind, "var"), (expression_2425.bindingId >= 0))) {
if (Map.has([visitedBindings_2424, expression_2425.bindingId])) {
return false;
} else {
{
const __wm_tail_value_179 = Map.get([bindingRegistry_2422, expression_2425.bindingId]);
if (__wm_tail_value_179?.ctor === -2 && __wm_tail_value_179.args.length === 1) {
const binding_2427 = __wm_tail_value_179.args[0];
if ((binding_2427.definitionExprId >= 0)) {
{
const __wm_tail_arg_180_0 = binding_2427.definitionExprId;
const __wm_tail_arg_180_1 = expressionRegistry_2421;
const __wm_tail_arg_180_2 = bindingRegistry_2422;
const __wm_tail_arg_180_3 = nextExpressions_2426;
const __wm_tail_arg_180_4 = Map.set([visitedBindings_2424, expression_2425.bindingId, true]);
expressionId_2420 = __wm_tail_arg_180_0;
expressionRegistry_2421 = __wm_tail_arg_180_1;
bindingRegistry_2422 = __wm_tail_arg_180_2;
visitedExpressions_2423 = __wm_tail_arg_180_3;
visitedBindings_2424 = __wm_tail_arg_180_4;
continue __wm_tail_143;
}
} else {
return false;
}
} else if (__wm_tail_value_179 === __wm_basis_None) {

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
const constantExpression_2418 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return constantExpression_2418__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const constantExpressions_2419__wm_d5 = (pending_2428, expressionRegistry_2429, bindingRegistry_2430, visitedExpressions_2431, visitedBindings_2432) => {
const __wm_scalar_170_0 = pending_2428;
const __wm_scalar_170_1 = expressionRegistry_2429;
const __wm_scalar_170_2 = bindingRegistry_2430;
const __wm_scalar_170_3 = visitedExpressions_2431;
const __wm_scalar_170_4 = visitedBindings_2432;
if (__wm_scalar_170_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_170_1, expressionRegistry_2429) && __wm_eq(__wm_scalar_170_2, bindingRegistry_2430) && __wm_eq(__wm_scalar_170_3, visitedExpressions_2431) && __wm_eq(__wm_scalar_170_4, visitedBindings_2432)) {

return true;
} else if (__wm_scalar_170_0?.ctor === -6 && __wm_scalar_170_0.args.length === 1 && __wm_is_tuple(__wm_scalar_170_0.args[0]) && __wm_scalar_170_0.args[0].length === 2 && __wm_eq(__wm_scalar_170_1, expressionRegistry_2429) && __wm_eq(__wm_scalar_170_2, bindingRegistry_2430) && __wm_eq(__wm_scalar_170_3, visitedExpressions_2431) && __wm_eq(__wm_scalar_170_4, visitedBindings_2432)) {
const expressionId_2433 = __wm_scalar_170_0.args[0][0];
const rest_2434 = __wm_scalar_170_0.args[0][1];
return __wm_op_and_d2(constantExpression_2418__wm_d5(expressionId_2433, expressionRegistry_2429, bindingRegistry_2430, visitedExpressions_2431, visitedBindings_2432), constantExpressions_2419__wm_d5(rest_2434, expressionRegistry_2429, bindingRegistry_2430, visitedExpressions_2431, visitedBindings_2432));
}
__wm_fail("Match", "non-exhaustive match");
};
const constantExpressions_2419 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return constantExpressions_2419__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const reifiableCaptureType_2438__wm_d2 = (typeRegistry_2435, typeId_2436) => {
const __wm_return_value_44 = Map.get([typeRegistry_2435, typeId_2436]);
if (__wm_return_value_44?.ctor === -2 && __wm_return_value_44.args.length === 1) {
const gpuType_2437 = __wm_return_value_44.args[0];
return __wm_op_or_d2(__wm_op_or_d2(__wm_eq(gpuType_2437.kind, "number"), __wm_eq(gpuType_2437.kind, "bool")), __wm_eq(gpuType_2437.kind, "vector"));
} else if (__wm_return_value_44 === __wm_basis_None) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
};
const reifiableCaptureType_2438 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return reifiableCaptureType_2438__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const captureCategory_2448__wm_d7 = (bindingId_2439, typeId_2440, reachable_2441, bindingFunctions_2442, bindingRegistry_2443, expressionRegistry_2444, typeRegistry_2445) => {
const __wm_return_value_45 = Map.get([bindingFunctions_2442, bindingId_2439]);
if (__wm_return_value_45?.ctor === -2 && __wm_return_value_45.args.length === 1) {
const functionId_2446 = __wm_return_value_45.args[0];
if (Map.has([reachable_2441, functionId_2446])) {
return "function";
} else {
return "illegal";
}
} else if (__wm_return_value_45 === __wm_basis_None) {

if (reifiableCaptureType_2438__wm_d2(typeRegistry_2445, typeId_2440)) {
const __wm_return_value_46 = Map.get([bindingRegistry_2443, bindingId_2439]);
if (__wm_return_value_46?.ctor === -2 && __wm_return_value_46.args.length === 1) {
const binding_2447 = __wm_return_value_46.args[0];
if (__wm_op_and_d2((binding_2447.definitionExprId >= 0), constantExpression_2418__wm_d5(binding_2447.definitionExprId, expressionRegistry_2444, bindingRegistry_2443, Map.empty(Map.numberCompare), Map.empty(Map.numberCompare)))) {
return "constant";
} else {
return "uniform";
}
} else if (__wm_return_value_46 === __wm_basis_None) {

return "illegal";
}
__wm_fail("Match", "non-exhaustive match");
} else {
return "illegal";
}
}
__wm_fail("Match", "non-exhaustive match");
};
const captureCategory_2448 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return captureCategory_2448__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const collectFunctionCaptures_2449__wm_d10 = (pending_2450, regionId_2451, reachable_2452, bound_2453, expressionRegistry_2454, bindingFunctions_2455, bindingRegistry_2456, typeRegistry_2457, visited_2458, captures_2459) => {
__wm_tail_144: while (true) {
{
const __wm_scalar_171_0 = pending_2450;
const __wm_scalar_171_1 = regionId_2451;
const __wm_scalar_171_2 = reachable_2452;
const __wm_scalar_171_3 = bound_2453;
const __wm_scalar_171_4 = expressionRegistry_2454;
const __wm_scalar_171_5 = bindingFunctions_2455;
const __wm_scalar_171_6 = bindingRegistry_2456;
const __wm_scalar_171_7 = typeRegistry_2457;
const __wm_scalar_171_8 = visited_2458;
const __wm_scalar_171_9 = captures_2459;
if (__wm_scalar_171_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_171_1, regionId_2451) && __wm_eq(__wm_scalar_171_2, reachable_2452) && __wm_eq(__wm_scalar_171_3, bound_2453) && __wm_eq(__wm_scalar_171_4, expressionRegistry_2454) && __wm_eq(__wm_scalar_171_5, bindingFunctions_2455) && __wm_eq(__wm_scalar_171_6, bindingRegistry_2456) && __wm_eq(__wm_scalar_171_7, typeRegistry_2457) && __wm_eq(__wm_scalar_171_8, visited_2458) && __wm_eq(__wm_scalar_171_9, captures_2459)) {

return captures_2459;
} else if (__wm_scalar_171_0?.ctor === -6 && __wm_scalar_171_0.args.length === 1 && __wm_is_tuple(__wm_scalar_171_0.args[0]) && __wm_scalar_171_0.args[0].length === 2 && __wm_eq(__wm_scalar_171_1, regionId_2451) && __wm_eq(__wm_scalar_171_2, reachable_2452) && __wm_eq(__wm_scalar_171_3, bound_2453) && __wm_eq(__wm_scalar_171_4, expressionRegistry_2454) && __wm_eq(__wm_scalar_171_5, bindingFunctions_2455) && __wm_eq(__wm_scalar_171_6, bindingRegistry_2456) && __wm_eq(__wm_scalar_171_7, typeRegistry_2457) && __wm_eq(__wm_scalar_171_8, visited_2458) && __wm_eq(__wm_scalar_171_9, captures_2459)) {
const expressionId_2460 = __wm_scalar_171_0.args[0][0];
const rest_2461 = __wm_scalar_171_0.args[0][1];
if (Map.has([visited_2458, expressionId_2460])) {
{
const __wm_tail_arg_181_0 = rest_2461;
const __wm_tail_arg_181_1 = regionId_2451;
const __wm_tail_arg_181_2 = reachable_2452;
const __wm_tail_arg_181_3 = bound_2453;
const __wm_tail_arg_181_4 = expressionRegistry_2454;
const __wm_tail_arg_181_5 = bindingFunctions_2455;
const __wm_tail_arg_181_6 = bindingRegistry_2456;
const __wm_tail_arg_181_7 = typeRegistry_2457;
const __wm_tail_arg_181_8 = visited_2458;
const __wm_tail_arg_181_9 = captures_2459;
pending_2450 = __wm_tail_arg_181_0;
regionId_2451 = __wm_tail_arg_181_1;
reachable_2452 = __wm_tail_arg_181_2;
bound_2453 = __wm_tail_arg_181_3;
expressionRegistry_2454 = __wm_tail_arg_181_4;
bindingFunctions_2455 = __wm_tail_arg_181_5;
bindingRegistry_2456 = __wm_tail_arg_181_6;
typeRegistry_2457 = __wm_tail_arg_181_7;
visited_2458 = __wm_tail_arg_181_8;
captures_2459 = __wm_tail_arg_181_9;
continue __wm_tail_144;
}
} else {
{
const nextVisited_2462 = Map.set([visited_2458, expressionId_2460, true]);
{
const __wm_tail_value_182 = Map.get([expressionRegistry_2454, expressionId_2460]);
if (__wm_tail_value_182 === __wm_basis_None) {

{
const __wm_tail_arg_183_0 = rest_2461;
const __wm_tail_arg_183_1 = regionId_2451;
const __wm_tail_arg_183_2 = reachable_2452;
const __wm_tail_arg_183_3 = bound_2453;
const __wm_tail_arg_183_4 = expressionRegistry_2454;
const __wm_tail_arg_183_5 = bindingFunctions_2455;
const __wm_tail_arg_183_6 = bindingRegistry_2456;
const __wm_tail_arg_183_7 = typeRegistry_2457;
const __wm_tail_arg_183_8 = nextVisited_2462;
const __wm_tail_arg_183_9 = captures_2459;
pending_2450 = __wm_tail_arg_183_0;
regionId_2451 = __wm_tail_arg_183_1;
reachable_2452 = __wm_tail_arg_183_2;
bound_2453 = __wm_tail_arg_183_3;
expressionRegistry_2454 = __wm_tail_arg_183_4;
bindingFunctions_2455 = __wm_tail_arg_183_5;
bindingRegistry_2456 = __wm_tail_arg_183_6;
typeRegistry_2457 = __wm_tail_arg_183_7;
visited_2458 = __wm_tail_arg_183_8;
captures_2459 = __wm_tail_arg_183_9;
continue __wm_tail_144;
}
} else if (__wm_tail_value_182?.ctor === -2 && __wm_tail_value_182.args.length === 1) {
const expression_2463 = __wm_tail_value_182.args[0];
{
const captureTypeId_2465 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const binding_2464 = __v.args[0];
return binding_2464.typeId;
} else if (__v === __wm_basis_None) {

return expression_2463.typeId;
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([bindingRegistry_2456, expression_2463.bindingId]));
const nextCaptures_2467 = (__wm_op_and_d2(__wm_op_and_d2(__wm_op_and_d2(__wm_eq(expression_2463.kind, "var"), (expression_2463.bindingId >= 0)), __wm_op_not(Map.has([bound_2453, expression_2463.bindingId]))), __wm_op_not(Map.has([captures_2459, expression_2463.bindingId]))) ? (() => {
const capture_2466 = { regionId: regionId_2451, bindingId: expression_2463.bindingId, typeId: captureTypeId_2465, spanId: expression_2463.spanId, category: captureCategory_2448__wm_d7(expression_2463.bindingId, captureTypeId_2465, reachable_2452, bindingFunctions_2455, bindingRegistry_2456, expressionRegistry_2454, typeRegistry_2457) };
return Map.set([captures_2459, expression_2463.bindingId, capture_2466]);
})() : captures_2459);
{
const __wm_tail_arg_184_0 = prependAll_2312__wm_d2(Js.Array.toList(expression_2463.children), rest_2461);
const __wm_tail_arg_184_1 = regionId_2451;
const __wm_tail_arg_184_2 = reachable_2452;
const __wm_tail_arg_184_3 = bound_2453;
const __wm_tail_arg_184_4 = expressionRegistry_2454;
const __wm_tail_arg_184_5 = bindingFunctions_2455;
const __wm_tail_arg_184_6 = bindingRegistry_2456;
const __wm_tail_arg_184_7 = typeRegistry_2457;
const __wm_tail_arg_184_8 = nextVisited_2462;
const __wm_tail_arg_184_9 = nextCaptures_2467;
pending_2450 = __wm_tail_arg_184_0;
regionId_2451 = __wm_tail_arg_184_1;
reachable_2452 = __wm_tail_arg_184_2;
bound_2453 = __wm_tail_arg_184_3;
expressionRegistry_2454 = __wm_tail_arg_184_4;
bindingFunctions_2455 = __wm_tail_arg_184_5;
bindingRegistry_2456 = __wm_tail_arg_184_6;
typeRegistry_2457 = __wm_tail_arg_184_7;
visited_2458 = __wm_tail_arg_184_8;
captures_2459 = __wm_tail_arg_184_9;
continue __wm_tail_144;
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
const collectFunctionCaptures_2449 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return collectFunctionCaptures_2449__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
const collectReachableCaptures_2468__wm_d9 = (functionEntries_2469, regionId_2470, reachable_2471, functionRegistry_2472, expressionRegistry_2473, bindingFunctions_2474, bindingRegistry_2475, typeRegistry_2476, captures_2477) => {
__wm_tail_145: while (true) {
{
const __wm_scalar_172_0 = functionEntries_2469;
const __wm_scalar_172_1 = regionId_2470;
const __wm_scalar_172_2 = reachable_2471;
const __wm_scalar_172_3 = functionRegistry_2472;
const __wm_scalar_172_4 = expressionRegistry_2473;
const __wm_scalar_172_5 = bindingFunctions_2474;
const __wm_scalar_172_6 = bindingRegistry_2475;
const __wm_scalar_172_7 = typeRegistry_2476;
const __wm_scalar_172_8 = captures_2477;
if (__wm_scalar_172_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_172_1, regionId_2470) && __wm_eq(__wm_scalar_172_2, reachable_2471) && __wm_eq(__wm_scalar_172_3, functionRegistry_2472) && __wm_eq(__wm_scalar_172_4, expressionRegistry_2473) && __wm_eq(__wm_scalar_172_5, bindingFunctions_2474) && __wm_eq(__wm_scalar_172_6, bindingRegistry_2475) && __wm_eq(__wm_scalar_172_7, typeRegistry_2476) && __wm_eq(__wm_scalar_172_8, captures_2477)) {

return captures_2477;
} else if (__wm_scalar_172_0?.ctor === -6 && __wm_scalar_172_0.args.length === 1 && __wm_is_tuple(__wm_scalar_172_0.args[0]) && __wm_scalar_172_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_172_0.args[0][0]) && __wm_scalar_172_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_172_1, regionId_2470) && __wm_eq(__wm_scalar_172_2, reachable_2471) && __wm_eq(__wm_scalar_172_3, functionRegistry_2472) && __wm_eq(__wm_scalar_172_4, expressionRegistry_2473) && __wm_eq(__wm_scalar_172_5, bindingFunctions_2474) && __wm_eq(__wm_scalar_172_6, bindingRegistry_2475) && __wm_eq(__wm_scalar_172_7, typeRegistry_2476) && __wm_eq(__wm_scalar_172_8, captures_2477)) {
const functionId_2478 = __wm_scalar_172_0.args[0][0][0];
const _present_2479 = __wm_scalar_172_0.args[0][0][1];
const rest_2480 = __wm_scalar_172_0.args[0][1];
{
const __wm_tail_value_185 = Map.get([functionRegistry_2472, functionId_2478]);
if (__wm_tail_value_185 === __wm_basis_None) {

{
const __wm_tail_arg_186_0 = rest_2480;
const __wm_tail_arg_186_1 = regionId_2470;
const __wm_tail_arg_186_2 = reachable_2471;
const __wm_tail_arg_186_3 = functionRegistry_2472;
const __wm_tail_arg_186_4 = expressionRegistry_2473;
const __wm_tail_arg_186_5 = bindingFunctions_2474;
const __wm_tail_arg_186_6 = bindingRegistry_2475;
const __wm_tail_arg_186_7 = typeRegistry_2476;
const __wm_tail_arg_186_8 = captures_2477;
functionEntries_2469 = __wm_tail_arg_186_0;
regionId_2470 = __wm_tail_arg_186_1;
reachable_2471 = __wm_tail_arg_186_2;
functionRegistry_2472 = __wm_tail_arg_186_3;
expressionRegistry_2473 = __wm_tail_arg_186_4;
bindingFunctions_2474 = __wm_tail_arg_186_5;
bindingRegistry_2475 = __wm_tail_arg_186_6;
typeRegistry_2476 = __wm_tail_arg_186_7;
captures_2477 = __wm_tail_arg_186_8;
continue __wm_tail_145;
}
} else if (__wm_tail_value_185?.ctor === -2 && __wm_tail_value_185.args.length === 1) {
const fn_2481 = __wm_tail_value_185.args[0];
{
const paramBound_2482 = bindParams_2403__wm_d2(Js.Array.toList(fn_2481.params), Map.empty(Map.numberCompare));
const bound_2483 = collectLocalBindings_2408__wm_d4(__wm_basis_Cons([fn_2481.bodyExprId, __wm_basis_Nil]), expressionRegistry_2473, Map.empty(Map.numberCompare), paramBound_2482);
const nextCaptures_2484 = collectFunctionCaptures_2449__wm_d10(__wm_basis_Cons([fn_2481.bodyExprId, __wm_basis_Nil]), regionId_2470, reachable_2471, bound_2483, expressionRegistry_2473, bindingFunctions_2474, bindingRegistry_2475, typeRegistry_2476, Map.empty(Map.numberCompare), captures_2477);
{
const __wm_tail_arg_187_0 = rest_2480;
const __wm_tail_arg_187_1 = regionId_2470;
const __wm_tail_arg_187_2 = reachable_2471;
const __wm_tail_arg_187_3 = functionRegistry_2472;
const __wm_tail_arg_187_4 = expressionRegistry_2473;
const __wm_tail_arg_187_5 = bindingFunctions_2474;
const __wm_tail_arg_187_6 = bindingRegistry_2475;
const __wm_tail_arg_187_7 = typeRegistry_2476;
const __wm_tail_arg_187_8 = nextCaptures_2484;
functionEntries_2469 = __wm_tail_arg_187_0;
regionId_2470 = __wm_tail_arg_187_1;
reachable_2471 = __wm_tail_arg_187_2;
functionRegistry_2472 = __wm_tail_arg_187_3;
expressionRegistry_2473 = __wm_tail_arg_187_4;
bindingFunctions_2474 = __wm_tail_arg_187_5;
bindingRegistry_2475 = __wm_tail_arg_187_6;
typeRegistry_2476 = __wm_tail_arg_187_7;
captures_2477 = __wm_tail_arg_187_8;
continue __wm_tail_145;
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
const collectReachableCaptures_2468 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return collectReachableCaptures_2468__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const captureValues_2485__wm_d2 = (entries_2486, captures_2487) => {
__wm_tail_146: while (true) {
{
const __wm_scalar_173_0 = entries_2486;
const __wm_scalar_173_1 = captures_2487;
if (__wm_scalar_173_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_173_1, captures_2487)) {

return captures_2487;
} else if (__wm_scalar_173_0?.ctor === -6 && __wm_scalar_173_0.args.length === 1 && __wm_is_tuple(__wm_scalar_173_0.args[0]) && __wm_scalar_173_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_173_0.args[0][0]) && __wm_scalar_173_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_173_1, captures_2487)) {
const _bindingId_2488 = __wm_scalar_173_0.args[0][0][0];
const capture_2489 = __wm_scalar_173_0.args[0][0][1];
const rest_2490 = __wm_scalar_173_0.args[0][1];
{
const __wm_tail_arg_188_0 = rest_2490;
const __wm_tail_arg_188_1 = __wm_basis_Cons([capture_2489, captures_2487]);
entries_2486 = __wm_tail_arg_188_0;
captures_2487 = __wm_tail_arg_188_1;
continue __wm_tail_146;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const captureValues_2485 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return captureValues_2485__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const rootCaptures_2491__wm_d7 = (roots_2492, functionRegistry_2493, expressionRegistry_2494, bindingFunctions_2495, bindingRegistry_2496, typeRegistry_2497, captures_2498) => {
__wm_tail_147: while (true) {
{
const __wm_scalar_174_0 = roots_2492;
const __wm_scalar_174_1 = functionRegistry_2493;
const __wm_scalar_174_2 = expressionRegistry_2494;
const __wm_scalar_174_3 = bindingFunctions_2495;
const __wm_scalar_174_4 = bindingRegistry_2496;
const __wm_scalar_174_5 = typeRegistry_2497;
const __wm_scalar_174_6 = captures_2498;
if (__wm_scalar_174_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_174_1, functionRegistry_2493) && __wm_eq(__wm_scalar_174_2, expressionRegistry_2494) && __wm_eq(__wm_scalar_174_3, bindingFunctions_2495) && __wm_eq(__wm_scalar_174_4, bindingRegistry_2496) && __wm_eq(__wm_scalar_174_5, typeRegistry_2497) && __wm_eq(__wm_scalar_174_6, captures_2498)) {

return captures_2498;
} else if (__wm_scalar_174_0?.ctor === -6 && __wm_scalar_174_0.args.length === 1 && __wm_is_tuple(__wm_scalar_174_0.args[0]) && __wm_scalar_174_0.args[0].length === 2 && __wm_eq(__wm_scalar_174_1, functionRegistry_2493) && __wm_eq(__wm_scalar_174_2, expressionRegistry_2494) && __wm_eq(__wm_scalar_174_3, bindingFunctions_2495) && __wm_eq(__wm_scalar_174_4, bindingRegistry_2496) && __wm_eq(__wm_scalar_174_5, typeRegistry_2497) && __wm_eq(__wm_scalar_174_6, captures_2498)) {
const root_2499 = __wm_scalar_174_0.args[0][0];
const rest_2500 = __wm_scalar_174_0.args[0][1];
{
const gpuRoot_2501 = root_2499;
const reachable_2502 = solveReachableFunctions_2387__wm_d5(__wm_basis_Cons([gpuRoot_2501.functionId, __wm_basis_Nil]), functionRegistry_2493, expressionRegistry_2494, bindingFunctions_2495, Map.empty(Map.numberCompare));
const rootCaptureRegistry_2503 = collectReachableCaptures_2468__wm_d9(Map.toList(reachable_2502), gpuRoot_2501.regionId, reachable_2502, functionRegistry_2493, expressionRegistry_2494, bindingFunctions_2495, bindingRegistry_2496, typeRegistry_2497, Map.empty(Map.numberCompare));
{
const __wm_tail_arg_189_0 = rest_2500;
const __wm_tail_arg_189_1 = functionRegistry_2493;
const __wm_tail_arg_189_2 = expressionRegistry_2494;
const __wm_tail_arg_189_3 = bindingFunctions_2495;
const __wm_tail_arg_189_4 = bindingRegistry_2496;
const __wm_tail_arg_189_5 = typeRegistry_2497;
const __wm_tail_arg_189_6 = prependAll_2312__wm_d2(captureValues_2485__wm_d2(Map.toList(rootCaptureRegistry_2503), __wm_basis_Nil), captures_2498);
roots_2492 = __wm_tail_arg_189_0;
functionRegistry_2493 = __wm_tail_arg_189_1;
expressionRegistry_2494 = __wm_tail_arg_189_2;
bindingFunctions_2495 = __wm_tail_arg_189_3;
bindingRegistry_2496 = __wm_tail_arg_189_4;
typeRegistry_2497 = __wm_tail_arg_189_5;
captures_2498 = __wm_tail_arg_189_6;
continue __wm_tail_147;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const rootCaptures_2491 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return rootCaptures_2491__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const illegalCaptureDiagnostic_2506 = (__arg) => {
if (true) {
const capture_2504 = __arg;
const diagnostic_2505 = { code: "gpu.illegal-capture", message: "captured value is not available to the GPU as a constant, uniform, resource, or function", spanId: capture_2504.spanId };
return diagnostic_2505;
}
__wm_fail("Match", "pattern match failure in function");
};
const captureDiagnostics_2507__wm_d2 = (captures_2508, diagnostics_2509) => {
__wm_tail_148: while (true) {
{
const __wm_scalar_175_0 = captures_2508;
const __wm_scalar_175_1 = diagnostics_2509;
if (__wm_scalar_175_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_175_1, diagnostics_2509)) {

return diagnostics_2509;
} else if (__wm_scalar_175_0?.ctor === -6 && __wm_scalar_175_0.args.length === 1 && __wm_is_tuple(__wm_scalar_175_0.args[0]) && __wm_scalar_175_0.args[0].length === 2 && __wm_eq(__wm_scalar_175_1, diagnostics_2509)) {
const capture_2510 = __wm_scalar_175_0.args[0][0];
const rest_2511 = __wm_scalar_175_0.args[0][1];
if (__wm_eq(capture_2510.category, "illegal")) {
{
const __wm_tail_arg_190_0 = rest_2511;
const __wm_tail_arg_190_1 = __wm_basis_Cons([illegalCaptureDiagnostic_2506(capture_2510), diagnostics_2509]);
captures_2508 = __wm_tail_arg_190_0;
diagnostics_2509 = __wm_tail_arg_190_1;
continue __wm_tail_148;
}
} else {
{
const __wm_tail_arg_191_0 = rest_2511;
const __wm_tail_arg_191_1 = diagnostics_2509;
captures_2508 = __wm_tail_arg_191_0;
diagnostics_2509 = __wm_tail_arg_191_1;
continue __wm_tail_148;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const captureDiagnostics_2507 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return captureDiagnostics_2507__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const indexExpressions_2512__wm_d2 = (expressions_2513, registry_2514) => {
__wm_tail_149: while (true) {
{
const __wm_scalar_176_0 = expressions_2513;
const __wm_scalar_176_1 = registry_2514;
if (__wm_scalar_176_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_176_1, registry_2514)) {

return registry_2514;
} else if (__wm_scalar_176_0?.ctor === -6 && __wm_scalar_176_0.args.length === 1 && __wm_is_tuple(__wm_scalar_176_0.args[0]) && __wm_scalar_176_0.args[0].length === 2 && __wm_eq(__wm_scalar_176_1, registry_2514)) {
const expression_2515 = __wm_scalar_176_0.args[0][0];
const rest_2516 = __wm_scalar_176_0.args[0][1];
{
const __wm_tail_arg_192_0 = rest_2516;
const __wm_tail_arg_192_1 = Map.set([registry_2514, expression_2515.id, expression_2515]);
expressions_2513 = __wm_tail_arg_192_0;
registry_2514 = __wm_tail_arg_192_1;
continue __wm_tail_149;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexExpressions_2512 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexExpressions_2512__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const indexTypes_2517__wm_d2 = (types_2518, registry_2519) => {
__wm_tail_150: while (true) {
{
const __wm_scalar_177_0 = types_2518;
const __wm_scalar_177_1 = registry_2519;
if (__wm_scalar_177_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_177_1, registry_2519)) {

return registry_2519;
} else if (__wm_scalar_177_0?.ctor === -6 && __wm_scalar_177_0.args.length === 1 && __wm_is_tuple(__wm_scalar_177_0.args[0]) && __wm_scalar_177_0.args[0].length === 2 && __wm_eq(__wm_scalar_177_1, registry_2519)) {
const gpuType_2520 = __wm_scalar_177_0.args[0][0];
const rest_2521 = __wm_scalar_177_0.args[0][1];
{
const __wm_tail_arg_193_0 = rest_2521;
const __wm_tail_arg_193_1 = Map.set([registry_2519, gpuType_2520.id, gpuType_2520]);
types_2518 = __wm_tail_arg_193_0;
registry_2519 = __wm_tail_arg_193_1;
continue __wm_tail_150;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexTypes_2517 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexTypes_2517__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const representationOf_2525__wm_d2 = (registry_2522, typeId_2523) => {
const __wm_return_value_47 = Map.get([registry_2522, typeId_2523]);
if (__wm_return_value_47?.ctor === -2 && __wm_return_value_47.args.length === 1) {
const representation_2524 = __wm_return_value_47.args[0];
return representation_2524;
} else if (__wm_return_value_47 === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const representationOf_2525 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return representationOf_2525__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const joinRepresentation_2528__wm_d2 = (left_2526, right_2527) => {
if (__wm_op_or_d2(__wm_eq(left_2526, "f32"), __wm_eq(right_2527, "f32"))) {
return "f32";
} else {
if (__wm_op_or_d2(__wm_eq(left_2526, "i32"), __wm_eq(right_2527, "i32"))) {
return "i32";
} else {
return "";
}
}
};
const joinRepresentation_2528 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return joinRepresentation_2528__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const combinedRepresentation_2529__wm_d3 = (typeIds_2530, registry_2531, combined_2532) => {
__wm_tail_151: while (true) {
{
const __wm_scalar_178_0 = typeIds_2530;
const __wm_scalar_178_1 = registry_2531;
const __wm_scalar_178_2 = combined_2532;
if (__wm_scalar_178_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_178_1, registry_2531) && __wm_eq(__wm_scalar_178_2, combined_2532)) {

return combined_2532;
} else if (__wm_scalar_178_0?.ctor === -6 && __wm_scalar_178_0.args.length === 1 && __wm_is_tuple(__wm_scalar_178_0.args[0]) && __wm_scalar_178_0.args[0].length === 2 && __wm_eq(__wm_scalar_178_1, registry_2531) && __wm_eq(__wm_scalar_178_2, combined_2532)) {
const typeId_2533 = __wm_scalar_178_0.args[0][0];
const rest_2534 = __wm_scalar_178_0.args[0][1];
{
const __wm_tail_arg_194_0 = rest_2534;
const __wm_tail_arg_194_1 = registry_2531;
const __wm_tail_arg_194_2 = joinRepresentation_2528__wm_d2(combined_2532, representationOf_2525__wm_d2(registry_2531, typeId_2533));
typeIds_2530 = __wm_tail_arg_194_0;
registry_2531 = __wm_tail_arg_194_1;
combined_2532 = __wm_tail_arg_194_2;
continue __wm_tail_151;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const combinedRepresentation_2529 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return combinedRepresentation_2529__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setRepresentation_2540__wm_d3 = (registry_2535, typeId_2536, representation_2537) => {
const previous_2538 = representationOf_2525__wm_d2(registry_2535, typeId_2536);
const next_2539 = joinRepresentation_2528__wm_d2(previous_2538, representation_2537);
if (__wm_op_or_d2(__wm_eq(next_2539, ""), __wm_eq(next_2539, previous_2538))) {
return [registry_2535, false];
} else {
return [Map.set([registry_2535, typeId_2536, next_2539]), true];
}
};
const setRepresentation_2540 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return setRepresentation_2540__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setRepresentations_2541__wm_d4 = (typeIds_2542, representation_2543, registry_2544, changed_2545) => {
__wm_tail_152: while (true) {
{
const __wm_scalar_179_0 = typeIds_2542;
const __wm_scalar_179_1 = representation_2543;
const __wm_scalar_179_2 = registry_2544;
const __wm_scalar_179_3 = changed_2545;
if (__wm_scalar_179_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_179_1, representation_2543) && __wm_eq(__wm_scalar_179_2, registry_2544) && __wm_eq(__wm_scalar_179_3, changed_2545)) {

return [registry_2544, changed_2545];
} else if (__wm_scalar_179_0?.ctor === -6 && __wm_scalar_179_0.args.length === 1 && __wm_is_tuple(__wm_scalar_179_0.args[0]) && __wm_scalar_179_0.args[0].length === 2 && __wm_eq(__wm_scalar_179_1, representation_2543) && __wm_eq(__wm_scalar_179_2, registry_2544) && __wm_eq(__wm_scalar_179_3, changed_2545)) {
const typeId_2546 = __wm_scalar_179_0.args[0][0];
const rest_2547 = __wm_scalar_179_0.args[0][1];
{
const __wm_bind_85 = setRepresentation_2540__wm_d3(registry_2544, typeId_2546, representation_2543);
if (!(__wm_is_tuple(__wm_bind_85) && __wm_bind_85.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_2548 = __wm_bind_85[0];
const itemChanged_2549 = __wm_bind_85[1];
{
const __wm_tail_arg_195_0 = rest_2547;
const __wm_tail_arg_195_1 = representation_2543;
const __wm_tail_arg_195_2 = nextRegistry_2548;
const __wm_tail_arg_195_3 = __wm_op_or_d2(changed_2545, itemChanged_2549);
typeIds_2542 = __wm_tail_arg_195_0;
representation_2543 = __wm_tail_arg_195_1;
registry_2544 = __wm_tail_arg_195_2;
changed_2545 = __wm_tail_arg_195_3;
continue __wm_tail_152;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const setRepresentations_2541 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setRepresentations_2541__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const seedRepresentations_2550__wm_d2 = (types_2551, registry_2552) => {
__wm_tail_153: while (true) {
{
const __wm_scalar_180_0 = types_2551;
const __wm_scalar_180_1 = registry_2552;
if (__wm_scalar_180_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_180_1, registry_2552)) {

return registry_2552;
} else if (__wm_scalar_180_0?.ctor === -6 && __wm_scalar_180_0.args.length === 1 && __wm_is_tuple(__wm_scalar_180_0.args[0]) && __wm_scalar_180_0.args[0].length === 2 && __wm_eq(__wm_scalar_180_1, registry_2552)) {
const gpuType_2553 = __wm_scalar_180_0.args[0][0];
const rest_2554 = __wm_scalar_180_0.args[0][1];
if (__wm_op_or_d2(__wm_eq(gpuType_2553.representation, "f32"), __wm_eq(gpuType_2553.representation, "i32"))) {
{
const __wm_tail_arg_196_0 = rest_2554;
const __wm_tail_arg_196_1 = Map.set([registry_2552, gpuType_2553.id, gpuType_2553.representation]);
types_2551 = __wm_tail_arg_196_0;
registry_2552 = __wm_tail_arg_196_1;
continue __wm_tail_153;
}
} else {
{
const __wm_tail_arg_197_0 = rest_2554;
const __wm_tail_arg_197_1 = registry_2552;
types_2551 = __wm_tail_arg_197_0;
registry_2552 = __wm_tail_arg_197_1;
continue __wm_tail_153;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const seedRepresentations_2550 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return seedRepresentations_2550__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const childTypeIds_2555__wm_d3 = (childIds_2556, expressionRegistry_2557, typeIds_2558) => {
__wm_tail_154: while (true) {
{
const __wm_scalar_181_0 = childIds_2556;
const __wm_scalar_181_1 = expressionRegistry_2557;
const __wm_scalar_181_2 = typeIds_2558;
if (__wm_scalar_181_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_181_1, expressionRegistry_2557) && __wm_eq(__wm_scalar_181_2, typeIds_2558)) {

return typeIds_2558;
} else if (__wm_scalar_181_0?.ctor === -6 && __wm_scalar_181_0.args.length === 1 && __wm_is_tuple(__wm_scalar_181_0.args[0]) && __wm_scalar_181_0.args[0].length === 2 && __wm_eq(__wm_scalar_181_1, expressionRegistry_2557) && __wm_eq(__wm_scalar_181_2, typeIds_2558)) {
const childId_2559 = __wm_scalar_181_0.args[0][0];
const rest_2560 = __wm_scalar_181_0.args[0][1];
{
const __wm_tail_value_198 = Map.get([expressionRegistry_2557, childId_2559]);
if (__wm_tail_value_198?.ctor === -2 && __wm_tail_value_198.args.length === 1) {
const child_2561 = __wm_tail_value_198.args[0];
{
const __wm_tail_arg_199_0 = rest_2560;
const __wm_tail_arg_199_1 = expressionRegistry_2557;
const __wm_tail_arg_199_2 = __wm_basis_Cons([child_2561.typeId, typeIds_2558]);
childIds_2556 = __wm_tail_arg_199_0;
expressionRegistry_2557 = __wm_tail_arg_199_1;
typeIds_2558 = __wm_tail_arg_199_2;
continue __wm_tail_154;
}
} else if (__wm_tail_value_198 === __wm_basis_None) {

{
const __wm_tail_arg_200_0 = rest_2560;
const __wm_tail_arg_200_1 = expressionRegistry_2557;
const __wm_tail_arg_200_2 = typeIds_2558;
childIds_2556 = __wm_tail_arg_200_0;
expressionRegistry_2557 = __wm_tail_arg_200_1;
typeIds_2558 = __wm_tail_arg_200_2;
continue __wm_tail_154;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const childTypeIds_2555 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return childTypeIds_2555__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const numericTypeIds_2562__wm_d3 = (typeIds_2563, typeRegistry_2564, numericIds_2565) => {
__wm_tail_155: while (true) {
{
const __wm_scalar_182_0 = typeIds_2563;
const __wm_scalar_182_1 = typeRegistry_2564;
const __wm_scalar_182_2 = numericIds_2565;
if (__wm_scalar_182_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_182_1, typeRegistry_2564) && __wm_eq(__wm_scalar_182_2, numericIds_2565)) {

return numericIds_2565;
} else if (__wm_scalar_182_0?.ctor === -6 && __wm_scalar_182_0.args.length === 1 && __wm_is_tuple(__wm_scalar_182_0.args[0]) && __wm_scalar_182_0.args[0].length === 2 && __wm_eq(__wm_scalar_182_1, typeRegistry_2564) && __wm_eq(__wm_scalar_182_2, numericIds_2565)) {
const typeId_2566 = __wm_scalar_182_0.args[0][0];
const rest_2567 = __wm_scalar_182_0.args[0][1];
{
const __wm_tail_value_201 = Map.get([typeRegistry_2564, typeId_2566]);
if (__wm_tail_value_201?.ctor === -2 && __wm_tail_value_201.args.length === 1) {
const gpuType_2568 = __wm_tail_value_201.args[0];
if (__wm_eq(gpuType_2568.kind, "vector")) {
{
const __wm_tail_arg_202_0 = rest_2567;
const __wm_tail_arg_202_1 = typeRegistry_2564;
const __wm_tail_arg_202_2 = __wm_basis_Cons([typeId_2566, numericTypeIds_2562__wm_d3(Js.Array.toList(gpuType_2568.items), typeRegistry_2564, numericIds_2565)]);
typeIds_2563 = __wm_tail_arg_202_0;
typeRegistry_2564 = __wm_tail_arg_202_1;
numericIds_2565 = __wm_tail_arg_202_2;
continue __wm_tail_155;
}
} else {
if (__wm_eq(gpuType_2568.kind, "number")) {
{
const __wm_tail_arg_203_0 = rest_2567;
const __wm_tail_arg_203_1 = typeRegistry_2564;
const __wm_tail_arg_203_2 = __wm_basis_Cons([typeId_2566, numericIds_2565]);
typeIds_2563 = __wm_tail_arg_203_0;
typeRegistry_2564 = __wm_tail_arg_203_1;
numericIds_2565 = __wm_tail_arg_203_2;
continue __wm_tail_155;
}
} else {
{
const __wm_tail_arg_204_0 = rest_2567;
const __wm_tail_arg_204_1 = typeRegistry_2564;
const __wm_tail_arg_204_2 = numericIds_2565;
typeIds_2563 = __wm_tail_arg_204_0;
typeRegistry_2564 = __wm_tail_arg_204_1;
numericIds_2565 = __wm_tail_arg_204_2;
continue __wm_tail_155;
}
}
}
} else if (__wm_tail_value_201 === __wm_basis_None) {

{
const __wm_tail_arg_205_0 = rest_2567;
const __wm_tail_arg_205_1 = typeRegistry_2564;
const __wm_tail_arg_205_2 = numericIds_2565;
typeIds_2563 = __wm_tail_arg_205_0;
typeRegistry_2564 = __wm_tail_arg_205_1;
numericIds_2565 = __wm_tail_arg_205_2;
continue __wm_tail_155;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const numericTypeIds_2562 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return numericTypeIds_2562__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const lastChildTypeId_2569__wm_d3 = (childIds_2570, expressionRegistry_2571, lastTypeId_2572) => {
__wm_tail_156: while (true) {
{
const __wm_scalar_183_0 = childIds_2570;
const __wm_scalar_183_1 = expressionRegistry_2571;
const __wm_scalar_183_2 = lastTypeId_2572;
if (__wm_scalar_183_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_183_1, expressionRegistry_2571) && __wm_eq(__wm_scalar_183_2, lastTypeId_2572)) {

return lastTypeId_2572;
} else if (__wm_scalar_183_0?.ctor === -6 && __wm_scalar_183_0.args.length === 1 && __wm_is_tuple(__wm_scalar_183_0.args[0]) && __wm_scalar_183_0.args[0].length === 2 && __wm_eq(__wm_scalar_183_1, expressionRegistry_2571) && __wm_eq(__wm_scalar_183_2, lastTypeId_2572)) {
const childId_2573 = __wm_scalar_183_0.args[0][0];
const rest_2574 = __wm_scalar_183_0.args[0][1];
{
const nextTypeId_2576 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const child_2575 = __v.args[0];
return child_2575.typeId;
} else if (__v === __wm_basis_None) {

return lastTypeId_2572;
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([expressionRegistry_2571, childId_2573]));
{
const __wm_tail_arg_206_0 = rest_2574;
const __wm_tail_arg_206_1 = expressionRegistry_2571;
const __wm_tail_arg_206_2 = nextTypeId_2576;
childIds_2570 = __wm_tail_arg_206_0;
expressionRegistry_2571 = __wm_tail_arg_206_1;
lastTypeId_2572 = __wm_tail_arg_206_2;
continue __wm_tail_156;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const lastChildTypeId_2569 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return lastChildTypeId_2569__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const constraintTypeIds_2581__wm_d3 = (expression_2577, expressionRegistry_2578, typeRegistry_2579) => {
if (__wm_eq(expression_2577.kind, "binary")) {
return numericTypeIds_2562__wm_d3(__wm_basis_Cons([expression_2577.typeId, childTypeIds_2555__wm_d3(Js.Array.toList(expression_2577.children), expressionRegistry_2578, __wm_basis_Nil)]), typeRegistry_2579, __wm_basis_Nil);
} else {
if (__wm_eq(expression_2577.kind, "tuple")) {
const __wm_return_value_48 = Map.get([typeRegistry_2579, expression_2577.typeId]);
if (__wm_return_value_48?.ctor === -2 && __wm_return_value_48.args.length === 1) {
const gpuType_2580 = __wm_return_value_48.args[0];
if (__wm_eq(gpuType_2580.kind, "vector")) {
return numericTypeIds_2562__wm_d3(__wm_basis_Cons([expression_2577.typeId, childTypeIds_2555__wm_d3(Js.Array.toList(expression_2577.children), expressionRegistry_2578, __wm_basis_Nil)]), typeRegistry_2579, __wm_basis_Nil);
} else {
return __wm_basis_Nil;
}
} else if (__wm_return_value_48 === __wm_basis_None) {

return __wm_basis_Nil;
}
__wm_fail("Match", "non-exhaustive match");
} else {
if (__wm_op_or_d2(__wm_eq(expression_2577.kind, "if"), __wm_eq(expression_2577.kind, "unary"))) {
return numericTypeIds_2562__wm_d3(__wm_basis_Cons([expression_2577.typeId, childTypeIds_2555__wm_d3(Js.Array.toList(expression_2577.children), expressionRegistry_2578, __wm_basis_Nil)]), typeRegistry_2579, __wm_basis_Nil);
} else {
if (__wm_op_or_d2(__wm_eq(expression_2577.kind, "block"), __wm_eq(expression_2577.kind, "let"))) {
return numericTypeIds_2562__wm_d3(__wm_basis_Cons([expression_2577.typeId, __wm_basis_Cons([lastChildTypeId_2569__wm_d3(Js.Array.toList(expression_2577.children), expressionRegistry_2578, expression_2577.typeId), __wm_basis_Nil])]), typeRegistry_2579, __wm_basis_Nil);
} else {
return __wm_basis_Nil;
}
}
}
}
};
const constraintTypeIds_2581 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return constraintTypeIds_2581__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const applyNumericGroup_2585__wm_d2 = (typeIds_2582, registry_2583) => {
const representation_2584 = combinedRepresentation_2529__wm_d3(typeIds_2582, registry_2583, "");
return setRepresentations_2541__wm_d4(typeIds_2582, representation_2584, registry_2583, false);
};
const applyNumericGroup_2585 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return applyNumericGroup_2585__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const applyArgumentConstraints_2586__wm_d6 = (argumentIds_2587, params_2588, expressionRegistry_2589, typeRegistry_2590, registry_2591, changed_2592) => {
__wm_tail_157: while (true) {
{
const __wm_scalar_184_0 = argumentIds_2587;
const __wm_scalar_184_1 = params_2588;
const __wm_scalar_184_2 = expressionRegistry_2589;
const __wm_scalar_184_3 = typeRegistry_2590;
const __wm_scalar_184_4 = registry_2591;
const __wm_scalar_184_5 = changed_2592;
if (__wm_scalar_184_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_184_1, params_2588) && __wm_eq(__wm_scalar_184_2, expressionRegistry_2589) && __wm_eq(__wm_scalar_184_3, typeRegistry_2590) && __wm_eq(__wm_scalar_184_4, registry_2591) && __wm_eq(__wm_scalar_184_5, changed_2592)) {

return [registry_2591, changed_2592];
} else if (__wm_eq(__wm_scalar_184_0, argumentIds_2587) && __wm_scalar_184_1 === __wm_basis_Nil && __wm_eq(__wm_scalar_184_2, expressionRegistry_2589) && __wm_eq(__wm_scalar_184_3, typeRegistry_2590) && __wm_eq(__wm_scalar_184_4, registry_2591) && __wm_eq(__wm_scalar_184_5, changed_2592)) {

return [registry_2591, changed_2592];
} else if (__wm_scalar_184_0?.ctor === -6 && __wm_scalar_184_0.args.length === 1 && __wm_is_tuple(__wm_scalar_184_0.args[0]) && __wm_scalar_184_0.args[0].length === 2 && __wm_scalar_184_1?.ctor === -6 && __wm_scalar_184_1.args.length === 1 && __wm_is_tuple(__wm_scalar_184_1.args[0]) && __wm_scalar_184_1.args[0].length === 2 && __wm_eq(__wm_scalar_184_2, expressionRegistry_2589) && __wm_eq(__wm_scalar_184_3, typeRegistry_2590) && __wm_eq(__wm_scalar_184_4, registry_2591) && __wm_eq(__wm_scalar_184_5, changed_2592)) {
const argumentId_2593 = __wm_scalar_184_0.args[0][0];
const restArguments_2594 = __wm_scalar_184_0.args[0][1];
const param_2595 = __wm_scalar_184_1.args[0][0];
const restParams_2596 = __wm_scalar_184_1.args[0][1];
{
const __wm_tail_value_207 = Map.get([expressionRegistry_2589, argumentId_2593]);
if (__wm_tail_value_207?.ctor === -2 && __wm_tail_value_207.args.length === 1) {
const argument_2597 = __wm_tail_value_207.args[0];
{
const typeIds_2598 = numericTypeIds_2562__wm_d3(__wm_basis_Cons([argument_2597.typeId, __wm_basis_Cons([param_2595.typeId, __wm_basis_Nil])]), typeRegistry_2590, __wm_basis_Nil);
const __wm_bind_86 = applyNumericGroup_2585__wm_d2(typeIds_2598, registry_2591);
if (!(__wm_is_tuple(__wm_bind_86) && __wm_bind_86.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_2599 = __wm_bind_86[0];
const pairChanged_2600 = __wm_bind_86[1];
{
const __wm_tail_arg_208_0 = restArguments_2594;
const __wm_tail_arg_208_1 = restParams_2596;
const __wm_tail_arg_208_2 = expressionRegistry_2589;
const __wm_tail_arg_208_3 = typeRegistry_2590;
const __wm_tail_arg_208_4 = nextRegistry_2599;
const __wm_tail_arg_208_5 = __wm_op_or_d2(changed_2592, pairChanged_2600);
argumentIds_2587 = __wm_tail_arg_208_0;
params_2588 = __wm_tail_arg_208_1;
expressionRegistry_2589 = __wm_tail_arg_208_2;
typeRegistry_2590 = __wm_tail_arg_208_3;
registry_2591 = __wm_tail_arg_208_4;
changed_2592 = __wm_tail_arg_208_5;
continue __wm_tail_157;
}
}
} else if (__wm_tail_value_207 === __wm_basis_None) {

{
const __wm_tail_arg_209_0 = restArguments_2594;
const __wm_tail_arg_209_1 = restParams_2596;
const __wm_tail_arg_209_2 = expressionRegistry_2589;
const __wm_tail_arg_209_3 = typeRegistry_2590;
const __wm_tail_arg_209_4 = registry_2591;
const __wm_tail_arg_209_5 = changed_2592;
argumentIds_2587 = __wm_tail_arg_209_0;
params_2588 = __wm_tail_arg_209_1;
expressionRegistry_2589 = __wm_tail_arg_209_2;
typeRegistry_2590 = __wm_tail_arg_209_3;
registry_2591 = __wm_tail_arg_209_4;
changed_2592 = __wm_tail_arg_209_5;
continue __wm_tail_157;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const applyArgumentConstraints_2586 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return applyArgumentConstraints_2586__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const applyCallConstraint_2615__wm_d6 = (expression_2601, expressionRegistry_2602, typeRegistry_2603, functionRegistry_2604, bindingFunctions_2605, registry_2606) => {
const __wm_return_value_49 = Js.Array.toList(expression_2601.children);
if (__wm_return_value_49?.ctor === -6 && __wm_return_value_49.args.length === 1 && __wm_is_tuple(__wm_return_value_49.args[0]) && __wm_return_value_49.args[0].length === 2) {
const calleeId_2607 = __wm_return_value_49.args[0][0];
const argumentIds_2608 = __wm_return_value_49.args[0][1];
const __wm_return_value_50 = Map.get([expressionRegistry_2602, calleeId_2607]);
if (__wm_return_value_50?.ctor === -2 && __wm_return_value_50.args.length === 1) {
const callee_2609 = __wm_return_value_50.args[0];
const __wm_return_value_51 = Map.get([bindingFunctions_2605, callee_2609.bindingId]);
if (__wm_return_value_51?.ctor === -2 && __wm_return_value_51.args.length === 1) {
const functionId_2610 = __wm_return_value_51.args[0];
const __wm_return_value_52 = Map.get([functionRegistry_2604, functionId_2610]);
if (__wm_return_value_52?.ctor === -2 && __wm_return_value_52.args.length === 1) {
const fn_2611 = __wm_return_value_52.args[0];
const resultIds_2612 = numericTypeIds_2562__wm_d3(__wm_basis_Cons([expression_2601.typeId, __wm_basis_Cons([fn_2611.resultTypeId, __wm_basis_Nil])]), typeRegistry_2603, __wm_basis_Nil);
const __wm_bind_87 = applyNumericGroup_2585__wm_d2(resultIds_2612, registry_2606);
if (!(__wm_is_tuple(__wm_bind_87) && __wm_bind_87.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const resultRegistry_2613 = __wm_bind_87[0];
const resultChanged_2614 = __wm_bind_87[1];
return applyArgumentConstraints_2586__wm_d6(argumentIds_2608, Js.Array.toList(fn_2611.params), expressionRegistry_2602, typeRegistry_2603, resultRegistry_2613, resultChanged_2614);
} else if (__wm_return_value_52 === __wm_basis_None) {

return [registry_2606, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_51 === __wm_basis_None) {

return [registry_2606, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_50 === __wm_basis_None) {

return [registry_2606, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_49 === __wm_basis_Nil) {

return [registry_2606, false];
}
__wm_fail("Match", "non-exhaustive match");
};
const applyCallConstraint_2615 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return applyCallConstraint_2615__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const applyNumericConstraint_2623__wm_d6 = (expression_2616, expressionRegistry_2617, typeRegistry_2618, functionRegistry_2619, bindingFunctions_2620, registry_2621) => {
if (__wm_eq(expression_2616.kind, "call")) {
return applyCallConstraint_2615__wm_d6(expression_2616, expressionRegistry_2617, typeRegistry_2618, functionRegistry_2619, bindingFunctions_2620, registry_2621);
} else {
const typeIds_2622 = constraintTypeIds_2581__wm_d3(expression_2616, expressionRegistry_2617, typeRegistry_2618);
return applyNumericGroup_2585__wm_d2(typeIds_2622, registry_2621);
}
};
const applyNumericConstraint_2623 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return applyNumericConstraint_2623__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const numericSweep_2624__wm_d7 = (expressions_2625, expressionRegistry_2626, typeRegistry_2627, functionRegistry_2628, bindingFunctions_2629, registry_2630, changed_2631) => {
__wm_tail_158: while (true) {
{
const __wm_scalar_185_0 = expressions_2625;
const __wm_scalar_185_1 = expressionRegistry_2626;
const __wm_scalar_185_2 = typeRegistry_2627;
const __wm_scalar_185_3 = functionRegistry_2628;
const __wm_scalar_185_4 = bindingFunctions_2629;
const __wm_scalar_185_5 = registry_2630;
const __wm_scalar_185_6 = changed_2631;
if (__wm_scalar_185_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_185_1, expressionRegistry_2626) && __wm_eq(__wm_scalar_185_2, typeRegistry_2627) && __wm_eq(__wm_scalar_185_3, functionRegistry_2628) && __wm_eq(__wm_scalar_185_4, bindingFunctions_2629) && __wm_eq(__wm_scalar_185_5, registry_2630) && __wm_eq(__wm_scalar_185_6, changed_2631)) {

return [registry_2630, changed_2631];
} else if (__wm_scalar_185_0?.ctor === -6 && __wm_scalar_185_0.args.length === 1 && __wm_is_tuple(__wm_scalar_185_0.args[0]) && __wm_scalar_185_0.args[0].length === 2 && __wm_eq(__wm_scalar_185_1, expressionRegistry_2626) && __wm_eq(__wm_scalar_185_2, typeRegistry_2627) && __wm_eq(__wm_scalar_185_3, functionRegistry_2628) && __wm_eq(__wm_scalar_185_4, bindingFunctions_2629) && __wm_eq(__wm_scalar_185_5, registry_2630) && __wm_eq(__wm_scalar_185_6, changed_2631)) {
const expression_2632 = __wm_scalar_185_0.args[0][0];
const rest_2633 = __wm_scalar_185_0.args[0][1];
{
const __wm_bind_88 = applyNumericConstraint_2623__wm_d6(expression_2632, expressionRegistry_2626, typeRegistry_2627, functionRegistry_2628, bindingFunctions_2629, registry_2630);
if (!(__wm_is_tuple(__wm_bind_88) && __wm_bind_88.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_2634 = __wm_bind_88[0];
const expressionChanged_2635 = __wm_bind_88[1];
{
const __wm_tail_arg_210_0 = rest_2633;
const __wm_tail_arg_210_1 = expressionRegistry_2626;
const __wm_tail_arg_210_2 = typeRegistry_2627;
const __wm_tail_arg_210_3 = functionRegistry_2628;
const __wm_tail_arg_210_4 = bindingFunctions_2629;
const __wm_tail_arg_210_5 = nextRegistry_2634;
const __wm_tail_arg_210_6 = __wm_op_or_d2(changed_2631, expressionChanged_2635);
expressions_2625 = __wm_tail_arg_210_0;
expressionRegistry_2626 = __wm_tail_arg_210_1;
typeRegistry_2627 = __wm_tail_arg_210_2;
functionRegistry_2628 = __wm_tail_arg_210_3;
bindingFunctions_2629 = __wm_tail_arg_210_4;
registry_2630 = __wm_tail_arg_210_5;
changed_2631 = __wm_tail_arg_210_6;
continue __wm_tail_158;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const numericSweep_2624 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return numericSweep_2624__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const solveNumericRepresentations_2636__wm_d6 = (expressions_2637, expressionRegistry_2638, typeRegistry_2639, functionRegistry_2640, bindingFunctions_2641, registry_2642) => {
__wm_tail_159: while (true) {
{
const __wm_bind_89 = numericSweep_2624__wm_d7(expressions_2637, expressionRegistry_2638, typeRegistry_2639, functionRegistry_2640, bindingFunctions_2641, registry_2642, false);
if (!(__wm_is_tuple(__wm_bind_89) && __wm_bind_89.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_2643 = __wm_bind_89[0];
const changed_2644 = __wm_bind_89[1];
if (changed_2644) {
{
const __wm_tail_arg_211_0 = expressions_2637;
const __wm_tail_arg_211_1 = expressionRegistry_2638;
const __wm_tail_arg_211_2 = typeRegistry_2639;
const __wm_tail_arg_211_3 = functionRegistry_2640;
const __wm_tail_arg_211_4 = bindingFunctions_2641;
const __wm_tail_arg_211_5 = nextRegistry_2643;
expressions_2637 = __wm_tail_arg_211_0;
expressionRegistry_2638 = __wm_tail_arg_211_1;
typeRegistry_2639 = __wm_tail_arg_211_2;
functionRegistry_2640 = __wm_tail_arg_211_3;
bindingFunctions_2641 = __wm_tail_arg_211_4;
registry_2642 = __wm_tail_arg_211_5;
continue __wm_tail_159;
}
} else {
return nextRegistry_2643;
}
}
}
};
const solveNumericRepresentations_2636 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return solveNumericRepresentations_2636__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const collectExpressionItems_2645__wm_d4 = (pending_2646, expressionRegistry_2647, visited_2648, expressions_2649) => {
__wm_tail_160: while (true) {
{
const __wm_scalar_186_0 = pending_2646;
const __wm_scalar_186_1 = expressionRegistry_2647;
const __wm_scalar_186_2 = visited_2648;
const __wm_scalar_186_3 = expressions_2649;
if (__wm_scalar_186_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_186_1, expressionRegistry_2647) && __wm_eq(__wm_scalar_186_2, visited_2648) && __wm_eq(__wm_scalar_186_3, expressions_2649)) {

return expressions_2649;
} else if (__wm_scalar_186_0?.ctor === -6 && __wm_scalar_186_0.args.length === 1 && __wm_is_tuple(__wm_scalar_186_0.args[0]) && __wm_scalar_186_0.args[0].length === 2 && __wm_eq(__wm_scalar_186_1, expressionRegistry_2647) && __wm_eq(__wm_scalar_186_2, visited_2648) && __wm_eq(__wm_scalar_186_3, expressions_2649)) {
const expressionId_2650 = __wm_scalar_186_0.args[0][0];
const rest_2651 = __wm_scalar_186_0.args[0][1];
if (Map.has([visited_2648, expressionId_2650])) {
{
const __wm_tail_arg_212_0 = rest_2651;
const __wm_tail_arg_212_1 = expressionRegistry_2647;
const __wm_tail_arg_212_2 = visited_2648;
const __wm_tail_arg_212_3 = expressions_2649;
pending_2646 = __wm_tail_arg_212_0;
expressionRegistry_2647 = __wm_tail_arg_212_1;
visited_2648 = __wm_tail_arg_212_2;
expressions_2649 = __wm_tail_arg_212_3;
continue __wm_tail_160;
}
} else {
{
const nextVisited_2652 = Map.set([visited_2648, expressionId_2650, true]);
{
const __wm_tail_value_213 = Map.get([expressionRegistry_2647, expressionId_2650]);
if (__wm_tail_value_213?.ctor === -2 && __wm_tail_value_213.args.length === 1) {
const expression_2653 = __wm_tail_value_213.args[0];
{
const __wm_tail_arg_214_0 = prependAll_2312__wm_d2(Js.Array.toList(expression_2653.children), rest_2651);
const __wm_tail_arg_214_1 = expressionRegistry_2647;
const __wm_tail_arg_214_2 = nextVisited_2652;
const __wm_tail_arg_214_3 = __wm_basis_Cons([expression_2653, expressions_2649]);
pending_2646 = __wm_tail_arg_214_0;
expressionRegistry_2647 = __wm_tail_arg_214_1;
visited_2648 = __wm_tail_arg_214_2;
expressions_2649 = __wm_tail_arg_214_3;
continue __wm_tail_160;
}
} else if (__wm_tail_value_213 === __wm_basis_None) {

{
const __wm_tail_arg_215_0 = rest_2651;
const __wm_tail_arg_215_1 = expressionRegistry_2647;
const __wm_tail_arg_215_2 = nextVisited_2652;
const __wm_tail_arg_215_3 = expressions_2649;
pending_2646 = __wm_tail_arg_215_0;
expressionRegistry_2647 = __wm_tail_arg_215_1;
visited_2648 = __wm_tail_arg_215_2;
expressions_2649 = __wm_tail_arg_215_3;
continue __wm_tail_160;
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
const collectExpressionItems_2645 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return collectExpressionItems_2645__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const concreteRepresentation_2659__wm_d3 = (typeRegistry_2654, representations_2655, typeId_2656) => {
const __wm_return_value_53 = Map.get([typeRegistry_2654, typeId_2656]);
if (__wm_return_value_53?.ctor === -2 && __wm_return_value_53.args.length === 1) {
const gpuType_2657 = __wm_return_value_53.args[0];
if (__wm_op_or_d2(__wm_eq(gpuType_2657.kind, "number"), __wm_eq(gpuType_2657.kind, "vector"))) {
const representation_2658 = representationOf_2525__wm_d2(representations_2655, typeId_2656);
if (__wm_eq(representation_2658, "")) {
return "i32";
} else {
return representation_2658;
}
} else {
return "";
}
} else if (__wm_return_value_53 === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const concreteRepresentation_2659 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return concreteRepresentation_2659__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const setTypeRepresentation_2665__wm_d4 = (typeId_2660, representation_2661, typeRegistry_2662, registry_2663) => {
const typeIds_2664 = numericTypeIds_2562__wm_d3(__wm_basis_Cons([typeId_2660, __wm_basis_Nil]), typeRegistry_2662, __wm_basis_Nil);
return setRepresentations_2541__wm_d4(typeIds_2664, representation_2661, registry_2663, false);
};
const setTypeRepresentation_2665 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return setTypeRepresentation_2665__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const seedParamRepresentations_2666__wm_d4 = (params_2667, representations_2668, typeRegistry_2669, registry_2670) => {
__wm_tail_161: while (true) {
{
const __wm_scalar_187_0 = params_2667;
const __wm_scalar_187_1 = representations_2668;
const __wm_scalar_187_2 = typeRegistry_2669;
const __wm_scalar_187_3 = registry_2670;
if (__wm_scalar_187_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_187_1, representations_2668) && __wm_eq(__wm_scalar_187_2, typeRegistry_2669) && __wm_eq(__wm_scalar_187_3, registry_2670)) {

return registry_2670;
} else if (__wm_eq(__wm_scalar_187_0, params_2667) && __wm_scalar_187_1 === __wm_basis_Nil && __wm_eq(__wm_scalar_187_2, typeRegistry_2669) && __wm_eq(__wm_scalar_187_3, registry_2670)) {

return registry_2670;
} else if (__wm_scalar_187_0?.ctor === -6 && __wm_scalar_187_0.args.length === 1 && __wm_is_tuple(__wm_scalar_187_0.args[0]) && __wm_scalar_187_0.args[0].length === 2 && __wm_scalar_187_1?.ctor === -6 && __wm_scalar_187_1.args.length === 1 && __wm_is_tuple(__wm_scalar_187_1.args[0]) && __wm_scalar_187_1.args[0].length === 2 && __wm_eq(__wm_scalar_187_2, typeRegistry_2669) && __wm_eq(__wm_scalar_187_3, registry_2670)) {
const param_2671 = __wm_scalar_187_0.args[0][0];
const restParams_2672 = __wm_scalar_187_0.args[0][1];
const representation_2673 = __wm_scalar_187_1.args[0][0];
const restRepresentations_2674 = __wm_scalar_187_1.args[0][1];
{
const __wm_bind_90 = setTypeRepresentation_2665__wm_d4(param_2671.typeId, representation_2673, typeRegistry_2669, registry_2670);
if (!(__wm_is_tuple(__wm_bind_90) && __wm_bind_90.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_2675 = __wm_bind_90[0];
const _changed_2676 = __wm_bind_90[1];
{
const __wm_tail_arg_216_0 = restParams_2672;
const __wm_tail_arg_216_1 = restRepresentations_2674;
const __wm_tail_arg_216_2 = typeRegistry_2669;
const __wm_tail_arg_216_3 = nextRegistry_2675;
params_2667 = __wm_tail_arg_216_0;
representations_2668 = __wm_tail_arg_216_1;
typeRegistry_2669 = __wm_tail_arg_216_2;
registry_2670 = __wm_tail_arg_216_3;
continue __wm_tail_161;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const seedParamRepresentations_2666 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return seedParamRepresentations_2666__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const functionParamRepresentations_2677__wm_d4 = (params_2678, typeRegistry_2679, representations_2680, output_2681) => {
__wm_tail_162: while (true) {
{
const __wm_scalar_188_0 = params_2678;
const __wm_scalar_188_1 = typeRegistry_2679;
const __wm_scalar_188_2 = representations_2680;
const __wm_scalar_188_3 = output_2681;
if (__wm_scalar_188_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_188_1, typeRegistry_2679) && __wm_eq(__wm_scalar_188_2, representations_2680) && __wm_eq(__wm_scalar_188_3, output_2681)) {

return reverseInto_2317__wm_d2(output_2681, __wm_basis_Nil);
} else if (__wm_scalar_188_0?.ctor === -6 && __wm_scalar_188_0.args.length === 1 && __wm_is_tuple(__wm_scalar_188_0.args[0]) && __wm_scalar_188_0.args[0].length === 2 && __wm_eq(__wm_scalar_188_1, typeRegistry_2679) && __wm_eq(__wm_scalar_188_2, representations_2680) && __wm_eq(__wm_scalar_188_3, output_2681)) {
const param_2682 = __wm_scalar_188_0.args[0][0];
const rest_2683 = __wm_scalar_188_0.args[0][1];
{
const __wm_tail_arg_217_0 = rest_2683;
const __wm_tail_arg_217_1 = typeRegistry_2679;
const __wm_tail_arg_217_2 = representations_2680;
const __wm_tail_arg_217_3 = __wm_basis_Cons([concreteRepresentation_2659__wm_d3(typeRegistry_2679, representations_2680, param_2682.typeId), output_2681]);
params_2678 = __wm_tail_arg_217_0;
typeRegistry_2679 = __wm_tail_arg_217_1;
representations_2680 = __wm_tail_arg_217_2;
output_2681 = __wm_tail_arg_217_3;
continue __wm_tail_162;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const functionParamRepresentations_2677 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return functionParamRepresentations_2677__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const callArgumentRepresentations_2684__wm_d5 = (argumentIds_2685, expressionRegistry_2686, typeRegistry_2687, representations_2688, output_2689) => {
__wm_tail_163: while (true) {
{
const __wm_scalar_189_0 = argumentIds_2685;
const __wm_scalar_189_1 = expressionRegistry_2686;
const __wm_scalar_189_2 = typeRegistry_2687;
const __wm_scalar_189_3 = representations_2688;
const __wm_scalar_189_4 = output_2689;
if (__wm_scalar_189_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_189_1, expressionRegistry_2686) && __wm_eq(__wm_scalar_189_2, typeRegistry_2687) && __wm_eq(__wm_scalar_189_3, representations_2688) && __wm_eq(__wm_scalar_189_4, output_2689)) {

return reverseInto_2317__wm_d2(output_2689, __wm_basis_Nil);
} else if (__wm_scalar_189_0?.ctor === -6 && __wm_scalar_189_0.args.length === 1 && __wm_is_tuple(__wm_scalar_189_0.args[0]) && __wm_scalar_189_0.args[0].length === 2 && __wm_eq(__wm_scalar_189_1, expressionRegistry_2686) && __wm_eq(__wm_scalar_189_2, typeRegistry_2687) && __wm_eq(__wm_scalar_189_3, representations_2688) && __wm_eq(__wm_scalar_189_4, output_2689)) {
const argumentId_2690 = __wm_scalar_189_0.args[0][0];
const rest_2691 = __wm_scalar_189_0.args[0][1];
{
const representation_2693 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const argument_2692 = __v.args[0];
return concreteRepresentation_2659__wm_d3(typeRegistry_2687, representations_2688, argument_2692.typeId);
} else if (__v === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([expressionRegistry_2686, argumentId_2690]));
{
const __wm_tail_arg_218_0 = rest_2691;
const __wm_tail_arg_218_1 = expressionRegistry_2686;
const __wm_tail_arg_218_2 = typeRegistry_2687;
const __wm_tail_arg_218_3 = representations_2688;
const __wm_tail_arg_218_4 = __wm_basis_Cons([representation_2693, output_2689]);
argumentIds_2685 = __wm_tail_arg_218_0;
expressionRegistry_2686 = __wm_tail_arg_218_1;
typeRegistry_2687 = __wm_tail_arg_218_2;
representations_2688 = __wm_tail_arg_218_3;
output_2689 = __wm_tail_arg_218_4;
continue __wm_tail_163;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const callArgumentRepresentations_2684 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 5) return callArgumentRepresentations_2684__wm_d5(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeArgumentRepresentations_2694__wm_d6 = (argumentIds_2695, representations_2696, expressionRegistry_2697, typeRegistry_2698, registry_2699, changed_2700) => {
__wm_tail_164: while (true) {
{
const __wm_scalar_190_0 = argumentIds_2695;
const __wm_scalar_190_1 = representations_2696;
const __wm_scalar_190_2 = expressionRegistry_2697;
const __wm_scalar_190_3 = typeRegistry_2698;
const __wm_scalar_190_4 = registry_2699;
const __wm_scalar_190_5 = changed_2700;
if (__wm_scalar_190_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_190_1, representations_2696) && __wm_eq(__wm_scalar_190_2, expressionRegistry_2697) && __wm_eq(__wm_scalar_190_3, typeRegistry_2698) && __wm_eq(__wm_scalar_190_4, registry_2699) && __wm_eq(__wm_scalar_190_5, changed_2700)) {

return [registry_2699, changed_2700];
} else if (__wm_eq(__wm_scalar_190_0, argumentIds_2695) && __wm_scalar_190_1 === __wm_basis_Nil && __wm_eq(__wm_scalar_190_2, expressionRegistry_2697) && __wm_eq(__wm_scalar_190_3, typeRegistry_2698) && __wm_eq(__wm_scalar_190_4, registry_2699) && __wm_eq(__wm_scalar_190_5, changed_2700)) {

return [registry_2699, changed_2700];
} else if (__wm_scalar_190_0?.ctor === -6 && __wm_scalar_190_0.args.length === 1 && __wm_is_tuple(__wm_scalar_190_0.args[0]) && __wm_scalar_190_0.args[0].length === 2 && __wm_scalar_190_1?.ctor === -6 && __wm_scalar_190_1.args.length === 1 && __wm_is_tuple(__wm_scalar_190_1.args[0]) && __wm_scalar_190_1.args[0].length === 2 && __wm_eq(__wm_scalar_190_2, expressionRegistry_2697) && __wm_eq(__wm_scalar_190_3, typeRegistry_2698) && __wm_eq(__wm_scalar_190_4, registry_2699) && __wm_eq(__wm_scalar_190_5, changed_2700)) {
const argumentId_2701 = __wm_scalar_190_0.args[0][0];
const restArguments_2702 = __wm_scalar_190_0.args[0][1];
const representation_2703 = __wm_scalar_190_1.args[0][0];
const restRepresentations_2704 = __wm_scalar_190_1.args[0][1];
{
const __wm_tail_value_219 = Map.get([expressionRegistry_2697, argumentId_2701]);
if (__wm_tail_value_219?.ctor === -2 && __wm_tail_value_219.args.length === 1) {
const argument_2705 = __wm_tail_value_219.args[0];
{
const __wm_bind_91 = setTypeRepresentation_2665__wm_d4(argument_2705.typeId, representation_2703, typeRegistry_2698, registry_2699);
if (!(__wm_is_tuple(__wm_bind_91) && __wm_bind_91.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_2706 = __wm_bind_91[0];
const itemChanged_2707 = __wm_bind_91[1];
{
const __wm_tail_arg_220_0 = restArguments_2702;
const __wm_tail_arg_220_1 = restRepresentations_2704;
const __wm_tail_arg_220_2 = expressionRegistry_2697;
const __wm_tail_arg_220_3 = typeRegistry_2698;
const __wm_tail_arg_220_4 = nextRegistry_2706;
const __wm_tail_arg_220_5 = __wm_op_or_d2(changed_2700, itemChanged_2707);
argumentIds_2695 = __wm_tail_arg_220_0;
representations_2696 = __wm_tail_arg_220_1;
expressionRegistry_2697 = __wm_tail_arg_220_2;
typeRegistry_2698 = __wm_tail_arg_220_3;
registry_2699 = __wm_tail_arg_220_4;
changed_2700 = __wm_tail_arg_220_5;
continue __wm_tail_164;
}
}
} else if (__wm_tail_value_219 === __wm_basis_None) {

{
const __wm_tail_arg_221_0 = restArguments_2702;
const __wm_tail_arg_221_1 = restRepresentations_2704;
const __wm_tail_arg_221_2 = expressionRegistry_2697;
const __wm_tail_arg_221_3 = typeRegistry_2698;
const __wm_tail_arg_221_4 = registry_2699;
const __wm_tail_arg_221_5 = changed_2700;
argumentIds_2695 = __wm_tail_arg_221_0;
representations_2696 = __wm_tail_arg_221_1;
expressionRegistry_2697 = __wm_tail_arg_221_2;
typeRegistry_2698 = __wm_tail_arg_221_3;
registry_2699 = __wm_tail_arg_221_4;
changed_2700 = __wm_tail_arg_221_5;
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
const mergeArgumentRepresentations_2694 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return mergeArgumentRepresentations_2694__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const solveFunctionInstance_2708__wm_d9 = (fn_2711, paramRepresentations_2712, resultRepresentation_2713, active_2714, functionRegistry_2715, expressionRegistry_2716, bindingFunctions_2717, typeRegistry_2718, typeItems_2719) => {
const seeded_2720 = seedRepresentations_2550__wm_d2(typeItems_2719, Map.empty(Map.numberCompare));
const withParams_2721 = seedParamRepresentations_2666__wm_d4(Js.Array.toList(fn_2711.params), paramRepresentations_2712, typeRegistry_2718, seeded_2720);
const __wm_bind_92 = setTypeRepresentation_2665__wm_d4(fn_2711.resultTypeId, resultRepresentation_2713, typeRegistry_2718, withParams_2721);
if (!(__wm_is_tuple(__wm_bind_92) && __wm_bind_92.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const initial_2722 = __wm_bind_92[0];
const _resultChanged_2723 = __wm_bind_92[1];
const expressions_2724 = collectExpressionItems_2645__wm_d4(__wm_basis_Cons([fn_2711.bodyExprId, __wm_basis_Nil]), expressionRegistry_2716, Map.empty(Map.numberCompare), __wm_basis_Nil);
return solveInstanceFixedPoint_2709__wm_d9(fn_2711, expressions_2724, Map.set([active_2714, fn_2711.id, true]), functionRegistry_2715, expressionRegistry_2716, bindingFunctions_2717, typeRegistry_2718, typeItems_2719, initial_2722);
};
const solveFunctionInstance_2708 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return solveFunctionInstance_2708__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const solveInstanceFixedPoint_2709__wm_d9 = (fn_2725, expressions_2726, active_2727, functionRegistry_2728, expressionRegistry_2729, bindingFunctions_2730, typeRegistry_2731, typeItems_2732, registry_2733) => {
__wm_tail_165: while (true) {
{
const __wm_bind_93 = instanceSweep_2710__wm_d10(expressions_2726, fn_2725, active_2727, functionRegistry_2728, expressionRegistry_2729, bindingFunctions_2730, typeRegistry_2731, typeItems_2732, registry_2733, false);
if (!(__wm_is_tuple(__wm_bind_93) && __wm_bind_93.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_2734 = __wm_bind_93[0];
const changed_2735 = __wm_bind_93[1];
if (changed_2735) {
{
const __wm_tail_arg_222_0 = fn_2725;
const __wm_tail_arg_222_1 = expressions_2726;
const __wm_tail_arg_222_2 = active_2727;
const __wm_tail_arg_222_3 = functionRegistry_2728;
const __wm_tail_arg_222_4 = expressionRegistry_2729;
const __wm_tail_arg_222_5 = bindingFunctions_2730;
const __wm_tail_arg_222_6 = typeRegistry_2731;
const __wm_tail_arg_222_7 = typeItems_2732;
const __wm_tail_arg_222_8 = nextRegistry_2734;
fn_2725 = __wm_tail_arg_222_0;
expressions_2726 = __wm_tail_arg_222_1;
active_2727 = __wm_tail_arg_222_2;
functionRegistry_2728 = __wm_tail_arg_222_3;
expressionRegistry_2729 = __wm_tail_arg_222_4;
bindingFunctions_2730 = __wm_tail_arg_222_5;
typeRegistry_2731 = __wm_tail_arg_222_6;
typeItems_2732 = __wm_tail_arg_222_7;
registry_2733 = __wm_tail_arg_222_8;
continue __wm_tail_165;
}
} else {
return nextRegistry_2734;
}
}
}
};
const solveInstanceFixedPoint_2709 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return solveInstanceFixedPoint_2709__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const instanceSweep_2710__wm_d10 = (expressions_2736, fn_2737, active_2738, functionRegistry_2739, expressionRegistry_2740, bindingFunctions_2741, typeRegistry_2742, typeItems_2743, registry_2744, changed_2745) => {
__wm_tail_166: while (true) {
{
const __wm_scalar_191_0 = expressions_2736;
const __wm_scalar_191_1 = fn_2737;
const __wm_scalar_191_2 = active_2738;
const __wm_scalar_191_3 = functionRegistry_2739;
const __wm_scalar_191_4 = expressionRegistry_2740;
const __wm_scalar_191_5 = bindingFunctions_2741;
const __wm_scalar_191_6 = typeRegistry_2742;
const __wm_scalar_191_7 = typeItems_2743;
const __wm_scalar_191_8 = registry_2744;
const __wm_scalar_191_9 = changed_2745;
if (__wm_scalar_191_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_191_1, fn_2737) && __wm_eq(__wm_scalar_191_2, active_2738) && __wm_eq(__wm_scalar_191_3, functionRegistry_2739) && __wm_eq(__wm_scalar_191_4, expressionRegistry_2740) && __wm_eq(__wm_scalar_191_5, bindingFunctions_2741) && __wm_eq(__wm_scalar_191_6, typeRegistry_2742) && __wm_eq(__wm_scalar_191_7, typeItems_2743) && __wm_eq(__wm_scalar_191_8, registry_2744) && __wm_eq(__wm_scalar_191_9, changed_2745)) {

return [registry_2744, changed_2745];
} else if (__wm_scalar_191_0?.ctor === -6 && __wm_scalar_191_0.args.length === 1 && __wm_is_tuple(__wm_scalar_191_0.args[0]) && __wm_scalar_191_0.args[0].length === 2 && __wm_eq(__wm_scalar_191_1, fn_2737) && __wm_eq(__wm_scalar_191_2, active_2738) && __wm_eq(__wm_scalar_191_3, functionRegistry_2739) && __wm_eq(__wm_scalar_191_4, expressionRegistry_2740) && __wm_eq(__wm_scalar_191_5, bindingFunctions_2741) && __wm_eq(__wm_scalar_191_6, typeRegistry_2742) && __wm_eq(__wm_scalar_191_7, typeItems_2743) && __wm_eq(__wm_scalar_191_8, registry_2744) && __wm_eq(__wm_scalar_191_9, changed_2745)) {
const expression_2746 = __wm_scalar_191_0.args[0][0];
const rest_2747 = __wm_scalar_191_0.args[0][1];
{
const currentFn_2748 = fn_2737;
const __wm_bind_94 = (__wm_eq(expression_2746.kind, "call") ? ((__v) => {
if (__v?.ctor === -6 && __v.args.length === 1 && __wm_is_tuple(__v.args[0]) && __v.args[0].length === 2) {
const calleeId_2749 = __v.args[0][0];
const argumentIds_2750 = __v.args[0][1];
const __wm_return_value_54 = Map.get([expressionRegistry_2740, calleeId_2749]);
if (__wm_return_value_54?.ctor === -2 && __wm_return_value_54.args.length === 1) {
const callee_2751 = __wm_return_value_54.args[0];
const __wm_return_value_55 = Map.get([bindingFunctions_2741, callee_2751.bindingId]);
if (__wm_return_value_55?.ctor === -2 && __wm_return_value_55.args.length === 1) {
const functionId_2752 = __wm_return_value_55.args[0];
const __wm_return_value_56 = Map.get([functionRegistry_2739, functionId_2752]);
if (__wm_return_value_56?.ctor === -2 && __wm_return_value_56.args.length === 1) {
const rawCalleeFn_2753 = __wm_return_value_56.args[0];
const calleeFn_2754 = rawCalleeFn_2753;
if (__wm_eq(calleeFn_2754.id, currentFn_2748.id)) {
return applyCallConstraint_2615__wm_d6(expression_2746, expressionRegistry_2740, typeRegistry_2742, functionRegistry_2739, bindingFunctions_2741, registry_2744);
} else {
if (Map.has([active_2738, calleeFn_2754.id])) {
return [registry_2744, false];
} else {
const argumentRepresentations_2755 = callArgumentRepresentations_2684__wm_d5(argumentIds_2750, expressionRegistry_2740, typeRegistry_2742, registry_2744, __wm_basis_Nil);
const callResultRepresentation_2756 = concreteRepresentation_2659__wm_d3(typeRegistry_2742, registry_2744, expression_2746.typeId);
const calleeRepresentations_2757 = solveFunctionInstance_2708__wm_d9(calleeFn_2754, argumentRepresentations_2755, callResultRepresentation_2756, active_2738, functionRegistry_2739, expressionRegistry_2740, bindingFunctions_2741, typeRegistry_2742, typeItems_2743);
const resolvedParams_2758 = functionParamRepresentations_2677__wm_d4(Js.Array.toList(calleeFn_2754.params), typeRegistry_2742, calleeRepresentations_2757, __wm_basis_Nil);
const resolvedResult_2759 = concreteRepresentation_2659__wm_d3(typeRegistry_2742, calleeRepresentations_2757, calleeFn_2754.resultTypeId);
const __wm_bind_95 = mergeArgumentRepresentations_2694__wm_d6(argumentIds_2750, resolvedParams_2758, expressionRegistry_2740, typeRegistry_2742, registry_2744, false);
if (!(__wm_is_tuple(__wm_bind_95) && __wm_bind_95.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withArguments_2760 = __wm_bind_95[0];
const argumentsChanged_2761 = __wm_bind_95[1];
const __wm_bind_96 = setTypeRepresentation_2665__wm_d4(expression_2746.typeId, resolvedResult_2759, typeRegistry_2742, withArguments_2760);
if (!(__wm_is_tuple(__wm_bind_96) && __wm_bind_96.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withResult_2762 = __wm_bind_96[0];
const resultChanged_2763 = __wm_bind_96[1];
return [withResult_2762, __wm_op_or_d2(argumentsChanged_2761, resultChanged_2763)];
}
}
} else if (__wm_return_value_56 === __wm_basis_None) {

return [registry_2744, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_55 === __wm_basis_None) {

return [registry_2744, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__wm_return_value_54 === __wm_basis_None) {

return [registry_2744, false];
}
__wm_fail("Match", "non-exhaustive match");
} else if (__v === __wm_basis_Nil) {

return [registry_2744, false];
}
__wm_fail("Match", "non-exhaustive match");
})(Js.Array.toList(expression_2746.children)) : (() => {
const typeIds_2764 = constraintTypeIds_2581__wm_d3(expression_2746, expressionRegistry_2740, typeRegistry_2742);
return applyNumericGroup_2585__wm_d2(typeIds_2764, registry_2744);
})());
if (!(__wm_is_tuple(__wm_bind_94) && __wm_bind_94.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextRegistry_2765 = __wm_bind_94[0];
const expressionChanged_2766 = __wm_bind_94[1];
{
const __wm_tail_arg_223_0 = rest_2747;
const __wm_tail_arg_223_1 = fn_2737;
const __wm_tail_arg_223_2 = active_2738;
const __wm_tail_arg_223_3 = functionRegistry_2739;
const __wm_tail_arg_223_4 = expressionRegistry_2740;
const __wm_tail_arg_223_5 = bindingFunctions_2741;
const __wm_tail_arg_223_6 = typeRegistry_2742;
const __wm_tail_arg_223_7 = typeItems_2743;
const __wm_tail_arg_223_8 = nextRegistry_2765;
const __wm_tail_arg_223_9 = __wm_op_or_d2(changed_2745, expressionChanged_2766);
expressions_2736 = __wm_tail_arg_223_0;
fn_2737 = __wm_tail_arg_223_1;
active_2738 = __wm_tail_arg_223_2;
functionRegistry_2739 = __wm_tail_arg_223_3;
expressionRegistry_2740 = __wm_tail_arg_223_4;
bindingFunctions_2741 = __wm_tail_arg_223_5;
typeRegistry_2742 = __wm_tail_arg_223_6;
typeItems_2743 = __wm_tail_arg_223_7;
registry_2744 = __wm_tail_arg_223_8;
changed_2745 = __wm_tail_arg_223_9;
continue __wm_tail_166;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const instanceSweep_2710 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return instanceSweep_2710__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
const representationsEqual_2767__wm_d2 = (left_2768, right_2769) => {
const __wm_scalar_192_0 = left_2768;
const __wm_scalar_192_1 = right_2769;
if (__wm_scalar_192_0 === __wm_basis_Nil && __wm_scalar_192_1 === __wm_basis_Nil) {

return true;
} else if (__wm_scalar_192_0?.ctor === -6 && __wm_scalar_192_0.args.length === 1 && __wm_is_tuple(__wm_scalar_192_0.args[0]) && __wm_scalar_192_0.args[0].length === 2 && __wm_scalar_192_1?.ctor === -6 && __wm_scalar_192_1.args.length === 1 && __wm_is_tuple(__wm_scalar_192_1.args[0]) && __wm_scalar_192_1.args[0].length === 2) {
const leftHead_2770 = __wm_scalar_192_0.args[0][0];
const leftRest_2771 = __wm_scalar_192_0.args[0][1];
const rightHead_2772 = __wm_scalar_192_1.args[0][0];
const rightRest_2773 = __wm_scalar_192_1.args[0][1];
const same_2774 = __wm_op_or_d2(__wm_op_or_d2(__wm_op_and_d2(__wm_eq(leftHead_2770, ""), __wm_eq(rightHead_2772, "")), __wm_op_and_d2(__wm_eq(leftHead_2770, "i32"), __wm_eq(rightHead_2772, "i32"))), __wm_op_and_d2(__wm_eq(leftHead_2770, "f32"), __wm_eq(rightHead_2772, "f32")));
return __wm_op_and_d2(same_2774, representationsEqual_2767__wm_d2(leftRest_2771, rightRest_2773));
} else if (true) {

return false;
}
__wm_fail("Match", "non-exhaustive match");
};
const representationsEqual_2767 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return representationsEqual_2767__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const findSpecialization_2775__wm_d3 = (entries_2776, paramRepresentations_2777, resultRepresentation_2778) => {
__wm_tail_167: while (true) {
{
const __wm_tail_value_224 = entries_2776;
if (__wm_tail_value_224 === __wm_basis_Nil) {

return __wm_basis_None;
} else if (__wm_tail_value_224?.ctor === -6 && __wm_tail_value_224.args.length === 1 && __wm_is_tuple(__wm_tail_value_224.args[0]) && __wm_tail_value_224.args[0].length === 2) {
const entry_2779 = __wm_tail_value_224.args[0][0];
const rest_2780 = __wm_tail_value_224.args[0][1];
{
const sameResult_2781 = __wm_op_or_d2(__wm_op_or_d2(__wm_op_and_d2(__wm_eq(entry_2779.resultRepresentation, ""), __wm_eq(resultRepresentation_2778, "")), __wm_op_and_d2(__wm_eq(entry_2779.resultRepresentation, "i32"), __wm_eq(resultRepresentation_2778, "i32"))), __wm_op_and_d2(__wm_eq(entry_2779.resultRepresentation, "f32"), __wm_eq(resultRepresentation_2778, "f32")));
if (__wm_op_and_d2(sameResult_2781, representationsEqual_2767__wm_d2(Js.Array.toList(entry_2779.paramRepresentations), paramRepresentations_2777))) {
return __wm_basis_Some(entry_2779.specializationId);
} else {
{
const __wm_tail_arg_225_0 = rest_2780;
const __wm_tail_arg_225_1 = paramRepresentations_2777;
const __wm_tail_arg_225_2 = resultRepresentation_2778;
entries_2776 = __wm_tail_arg_225_0;
paramRepresentations_2777 = __wm_tail_arg_225_1;
resultRepresentation_2778 = __wm_tail_arg_225_2;
continue __wm_tail_167;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const findSpecialization_2775 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return findSpecialization_2775__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const representationSuffix_2782__wm_d2 = (representations_2783, suffix_2784) => {
__wm_tail_168: while (true) {
{
const __wm_scalar_193_0 = representations_2783;
const __wm_scalar_193_1 = suffix_2784;
if (__wm_scalar_193_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_193_1, suffix_2784)) {

return suffix_2784;
} else if (__wm_scalar_193_0?.ctor === -6 && __wm_scalar_193_0.args.length === 1 && __wm_is_tuple(__wm_scalar_193_0.args[0]) && __wm_scalar_193_0.args[0].length === 2 && __wm_eq(__wm_scalar_193_1, suffix_2784)) {
const representation_2785 = __wm_scalar_193_0.args[0][0];
const rest_2786 = __wm_scalar_193_0.args[0][1];
{
const separator_2787 = (__wm_eq(suffix_2784, "") ? "" : "_");
{
const __wm_tail_arg_226_0 = rest_2786;
const __wm_tail_arg_226_1 = ((suffix_2784 + separator_2787) + representation_2785);
representations_2783 = __wm_tail_arg_226_0;
suffix_2784 = __wm_tail_arg_226_1;
continue __wm_tail_168;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const representationSuffix_2782 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return representationSuffix_2782__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const specializationName_2791__wm_d3 = (fn_2788, paramRepresentations_2789, resultRepresentation_2790) => {
return ((((fn_2788.name + "__gpu_") + representationSuffix_2782__wm_d2(paramRepresentations_2789, "")) + "_to_") + resultRepresentation_2790);
};
const specializationName_2791 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return specializationName_2791__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const addTypeIds_2792__wm_d2 = (typeIds_2793, typeSet_2794) => {
__wm_tail_169: while (true) {
{
const __wm_scalar_194_0 = typeIds_2793;
const __wm_scalar_194_1 = typeSet_2794;
if (__wm_scalar_194_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_194_1, typeSet_2794)) {

return typeSet_2794;
} else if (__wm_scalar_194_0?.ctor === -6 && __wm_scalar_194_0.args.length === 1 && __wm_is_tuple(__wm_scalar_194_0.args[0]) && __wm_scalar_194_0.args[0].length === 2 && __wm_eq(__wm_scalar_194_1, typeSet_2794)) {
const typeId_2795 = __wm_scalar_194_0.args[0][0];
const rest_2796 = __wm_scalar_194_0.args[0][1];
{
const __wm_tail_arg_227_0 = rest_2796;
const __wm_tail_arg_227_1 = Map.set([typeSet_2794, typeId_2795, true]);
typeIds_2793 = __wm_tail_arg_227_0;
typeSet_2794 = __wm_tail_arg_227_1;
continue __wm_tail_169;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addTypeIds_2792 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addTypeIds_2792__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const collectInstanceTypeIds_2797__wm_d3 = (expressions_2798, typeRegistry_2799, typeSet_2800) => {
__wm_tail_170: while (true) {
{
const __wm_scalar_195_0 = expressions_2798;
const __wm_scalar_195_1 = typeRegistry_2799;
const __wm_scalar_195_2 = typeSet_2800;
if (__wm_scalar_195_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_195_1, typeRegistry_2799) && __wm_eq(__wm_scalar_195_2, typeSet_2800)) {

return typeSet_2800;
} else if (__wm_scalar_195_0?.ctor === -6 && __wm_scalar_195_0.args.length === 1 && __wm_is_tuple(__wm_scalar_195_0.args[0]) && __wm_scalar_195_0.args[0].length === 2 && __wm_eq(__wm_scalar_195_1, typeRegistry_2799) && __wm_eq(__wm_scalar_195_2, typeSet_2800)) {
const expression_2801 = __wm_scalar_195_0.args[0][0];
const rest_2802 = __wm_scalar_195_0.args[0][1];
{
const __wm_tail_arg_228_0 = rest_2802;
const __wm_tail_arg_228_1 = typeRegistry_2799;
const __wm_tail_arg_228_2 = addTypeIds_2792__wm_d2(numericTypeIds_2562__wm_d3(__wm_basis_Cons([expression_2801.typeId, __wm_basis_Nil]), typeRegistry_2799, __wm_basis_Nil), typeSet_2800);
expressions_2798 = __wm_tail_arg_228_0;
typeRegistry_2799 = __wm_tail_arg_228_1;
typeSet_2800 = __wm_tail_arg_228_2;
continue __wm_tail_170;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const collectInstanceTypeIds_2797 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return collectInstanceTypeIds_2797__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const addParamTypeIds_2803__wm_d3 = (params_2804, typeRegistry_2805, typeSet_2806) => {
__wm_tail_171: while (true) {
{
const __wm_scalar_196_0 = params_2804;
const __wm_scalar_196_1 = typeRegistry_2805;
const __wm_scalar_196_2 = typeSet_2806;
if (__wm_scalar_196_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_196_1, typeRegistry_2805) && __wm_eq(__wm_scalar_196_2, typeSet_2806)) {

return typeSet_2806;
} else if (__wm_scalar_196_0?.ctor === -6 && __wm_scalar_196_0.args.length === 1 && __wm_is_tuple(__wm_scalar_196_0.args[0]) && __wm_scalar_196_0.args[0].length === 2 && __wm_eq(__wm_scalar_196_1, typeRegistry_2805) && __wm_eq(__wm_scalar_196_2, typeSet_2806)) {
const param_2807 = __wm_scalar_196_0.args[0][0];
const rest_2808 = __wm_scalar_196_0.args[0][1];
{
const __wm_tail_arg_229_0 = rest_2808;
const __wm_tail_arg_229_1 = typeRegistry_2805;
const __wm_tail_arg_229_2 = addTypeIds_2792__wm_d2(numericTypeIds_2562__wm_d3(__wm_basis_Cons([param_2807.typeId, __wm_basis_Nil]), typeRegistry_2805, __wm_basis_Nil), typeSet_2806);
params_2804 = __wm_tail_arg_229_0;
typeRegistry_2805 = __wm_tail_arg_229_1;
typeSet_2806 = __wm_tail_arg_229_2;
continue __wm_tail_171;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addParamTypeIds_2803 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return addParamTypeIds_2803__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const representationFacts_2809__wm_d4 = (typeEntries_2810, typeRegistry_2811, representations_2812, facts_2813) => {
__wm_tail_172: while (true) {
{
const __wm_scalar_197_0 = typeEntries_2810;
const __wm_scalar_197_1 = typeRegistry_2811;
const __wm_scalar_197_2 = representations_2812;
const __wm_scalar_197_3 = facts_2813;
if (__wm_scalar_197_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_197_1, typeRegistry_2811) && __wm_eq(__wm_scalar_197_2, representations_2812) && __wm_eq(__wm_scalar_197_3, facts_2813)) {

return reverseInto_2317__wm_d2(facts_2813, __wm_basis_Nil);
} else if (__wm_scalar_197_0?.ctor === -6 && __wm_scalar_197_0.args.length === 1 && __wm_is_tuple(__wm_scalar_197_0.args[0]) && __wm_scalar_197_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_197_0.args[0][0]) && __wm_scalar_197_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_197_1, typeRegistry_2811) && __wm_eq(__wm_scalar_197_2, representations_2812) && __wm_eq(__wm_scalar_197_3, facts_2813)) {
const typeId_2814 = __wm_scalar_197_0.args[0][0][0];
const _present_2815 = __wm_scalar_197_0.args[0][0][1];
const rest_2816 = __wm_scalar_197_0.args[0][1];
{
const fact_2817 = { typeId: typeId_2814, representation: concreteRepresentation_2659__wm_d3(typeRegistry_2811, representations_2812, typeId_2814) };
{
const __wm_tail_arg_230_0 = rest_2816;
const __wm_tail_arg_230_1 = typeRegistry_2811;
const __wm_tail_arg_230_2 = representations_2812;
const __wm_tail_arg_230_3 = __wm_basis_Cons([fact_2817, facts_2813]);
typeEntries_2810 = __wm_tail_arg_230_0;
typeRegistry_2811 = __wm_tail_arg_230_1;
representations_2812 = __wm_tail_arg_230_2;
facts_2813 = __wm_tail_arg_230_3;
continue __wm_tail_172;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const representationFacts_2809 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return representationFacts_2809__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const specializationTypeFacts_2825__wm_d4 = (fn_2818, expressions_2819, typeRegistry_2820, representations_2821) => {
const withExpressions_2822 = collectInstanceTypeIds_2797__wm_d3(expressions_2819, typeRegistry_2820, Map.empty(Map.numberCompare));
const withParams_2823 = addParamTypeIds_2803__wm_d3(Js.Array.toList(fn_2818.params), typeRegistry_2820, withExpressions_2822);
const allTypes_2824 = addTypeIds_2792__wm_d2(numericTypeIds_2562__wm_d3(__wm_basis_Cons([fn_2818.resultTypeId, __wm_basis_Nil]), typeRegistry_2820, __wm_basis_Nil), withParams_2823);
return representationFacts_2809__wm_d4(Map.toList(allTypes_2824), typeRegistry_2820, representations_2821, __wm_basis_Nil);
};
const specializationTypeFacts_2825 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 4) return specializationTypeFacts_2825__wm_d4(__arg[0], __arg[1], __arg[2], __arg[3]);
__wm_fail("Match", "pattern match failure in function");
};
const initialSpecializationState_2826 = (__arg) => {
if (__arg === undefined) {

return { nextId: 0, registry: Map.empty(Map.numberCompare), specializations: __wm_basis_Nil, rootSpecializations: __wm_basis_Nil, calls: __wm_basis_Nil, diagnostics: __wm_basis_Nil };
}
__wm_fail("Match", "pattern match failure in function");
};
const withSpecializedCall_2829__wm_d2 = (state_2827, call_2828) => {
return { nextId: state_2827.nextId, registry: state_2827.registry, specializations: state_2827.specializations, rootSpecializations: state_2827.rootSpecializations, calls: __wm_basis_Cons([call_2828, state_2827.calls]), diagnostics: state_2827.diagnostics };
};
const withSpecializedCall_2829 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return withSpecializedCall_2829__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const withSpecializationDiagnostic_2832__wm_d2 = (state_2830, diagnostic_2831) => {
return { nextId: state_2830.nextId, registry: state_2830.registry, specializations: state_2830.specializations, rootSpecializations: state_2830.rootSpecializations, calls: state_2830.calls, diagnostics: __wm_basis_Cons([diagnostic_2831, state_2830.diagnostics]) };
};
const withSpecializationDiagnostic_2832 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return withSpecializationDiagnostic_2832__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const mutualRecursionDiagnostic_2835 = (__arg) => {
if (true) {
const expression_2833 = __arg;
const diagnostic_2834 = { code: "gpu.mutual-recursion", message: "mutually recursive GPU functions are not supported by the current specialization pass", spanId: expression_2833.spanId };
return diagnostic_2834;
}
__wm_fail("Match", "pattern match failure in function");
};
const materializeSpecialization_2836__wm_d10 = (fn_2838, requestedParams_2839, requestedResult_2840, active_2841, state_2842, functionRegistry_2843, expressionRegistry_2844, bindingFunctions_2845, typeRegistry_2846, typeItems_2847) => {
const representations_2848 = solveFunctionInstance_2708__wm_d9(fn_2838, requestedParams_2839, requestedResult_2840, Map.empty(Map.numberCompare), functionRegistry_2843, expressionRegistry_2844, bindingFunctions_2845, typeRegistry_2846, typeItems_2847);
const paramRepresentations_2849 = functionParamRepresentations_2677__wm_d4(Js.Array.toList(fn_2838.params), typeRegistry_2846, representations_2848, __wm_basis_Nil);
const resultRepresentation_2850 = concreteRepresentation_2659__wm_d3(typeRegistry_2846, representations_2848, fn_2838.resultTypeId);
const existingEntries_2852 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const entries_2851 = __v.args[0];
return entries_2851;
} else if (__v === __wm_basis_None) {

return __wm_basis_Nil;
}
__wm_fail("Match", "non-exhaustive match");
})(Map.get([state_2842.registry, fn_2838.id]));
const __wm_return_value_57 = findSpecialization_2775__wm_d3(existingEntries_2852, paramRepresentations_2849, resultRepresentation_2850);
if (__wm_return_value_57?.ctor === -2 && __wm_return_value_57.args.length === 1) {
const specializationId_2853 = __wm_return_value_57.args[0];
return [state_2842, specializationId_2853];
} else if (__wm_return_value_57 === __wm_basis_None) {

const specializationId_2854 = state_2842.nextId;
const expressions_2855 = collectExpressionItems_2645__wm_d4(__wm_basis_Cons([fn_2838.bodyExprId, __wm_basis_Nil]), expressionRegistry_2844, Map.empty(Map.numberCompare), __wm_basis_Nil);
const specialization_2857 = { id: specializationId_2854, functionId: fn_2838.id, bindingId: fn_2838.bindingId, name: specializationName_2791__wm_d3(fn_2838, paramRepresentations_2849, resultRepresentation_2850), paramTypeIds: Js.Array.fromList(List.map([Js.Array.toList(fn_2838.params), (__arg) => {
if (true) {
const param_2856 = __arg;
return param_2856.typeId;
}
__wm_fail("Match", "pattern match failure in function");
}])), resultTypeId: fn_2838.resultTypeId, paramRepresentations: Js.Array.fromList(paramRepresentations_2849), resultRepresentation: resultRepresentation_2850, typeFacts: Js.Array.fromList(specializationTypeFacts_2825__wm_d4(fn_2838, expressions_2855, typeRegistry_2846, representations_2848)) };
const entry_2858 = { specializationId: specializationId_2854, paramRepresentations: Js.Array.fromList(paramRepresentations_2849), resultRepresentation: resultRepresentation_2850 };
const registered_2859 = { nextId: (specializationId_2854 + 1), registry: Map.set([state_2842.registry, fn_2838.id, __wm_basis_Cons([entry_2858, existingEntries_2852])]), specializations: __wm_basis_Cons([specialization_2857, state_2842.specializations]), rootSpecializations: state_2842.rootSpecializations, calls: state_2842.calls, diagnostics: state_2842.diagnostics };
return materializeSpecializedCalls_2837__wm_d11(expressions_2855, fn_2838, specializationId_2854, representations_2848, Map.set([active_2841, fn_2838.id, specializationId_2854]), registered_2859, functionRegistry_2843, expressionRegistry_2844, bindingFunctions_2845, typeRegistry_2846, typeItems_2847);
}
__wm_fail("Match", "non-exhaustive match");
};
const materializeSpecialization_2836 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 10) return materializeSpecialization_2836__wm_d10(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9]);
__wm_fail("Match", "pattern match failure in function");
};
const materializeSpecializedCalls_2837__wm_d11 = (expressions_2860, fn_2861, callerSpecializationId_2862, representations_2863, active_2864, state_2865, functionRegistry_2866, expressionRegistry_2867, bindingFunctions_2868, typeRegistry_2869, typeItems_2870) => {
__wm_tail_173: while (true) {
{
const __wm_scalar_198_0 = expressions_2860;
const __wm_scalar_198_1 = fn_2861;
const __wm_scalar_198_2 = callerSpecializationId_2862;
const __wm_scalar_198_3 = representations_2863;
const __wm_scalar_198_4 = active_2864;
const __wm_scalar_198_5 = state_2865;
const __wm_scalar_198_6 = functionRegistry_2866;
const __wm_scalar_198_7 = expressionRegistry_2867;
const __wm_scalar_198_8 = bindingFunctions_2868;
const __wm_scalar_198_9 = typeRegistry_2869;
const __wm_scalar_198_10 = typeItems_2870;
if (__wm_scalar_198_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_198_1, fn_2861) && __wm_eq(__wm_scalar_198_2, callerSpecializationId_2862) && __wm_eq(__wm_scalar_198_3, representations_2863) && __wm_eq(__wm_scalar_198_4, active_2864) && __wm_eq(__wm_scalar_198_5, state_2865) && __wm_eq(__wm_scalar_198_6, functionRegistry_2866) && __wm_eq(__wm_scalar_198_7, expressionRegistry_2867) && __wm_eq(__wm_scalar_198_8, bindingFunctions_2868) && __wm_eq(__wm_scalar_198_9, typeRegistry_2869) && __wm_eq(__wm_scalar_198_10, typeItems_2870)) {

return [state_2865, callerSpecializationId_2862];
} else if (__wm_scalar_198_0?.ctor === -6 && __wm_scalar_198_0.args.length === 1 && __wm_is_tuple(__wm_scalar_198_0.args[0]) && __wm_scalar_198_0.args[0].length === 2 && __wm_eq(__wm_scalar_198_1, fn_2861) && __wm_eq(__wm_scalar_198_2, callerSpecializationId_2862) && __wm_eq(__wm_scalar_198_3, representations_2863) && __wm_eq(__wm_scalar_198_4, active_2864) && __wm_eq(__wm_scalar_198_5, state_2865) && __wm_eq(__wm_scalar_198_6, functionRegistry_2866) && __wm_eq(__wm_scalar_198_7, expressionRegistry_2867) && __wm_eq(__wm_scalar_198_8, bindingFunctions_2868) && __wm_eq(__wm_scalar_198_9, typeRegistry_2869) && __wm_eq(__wm_scalar_198_10, typeItems_2870)) {
const expression_2871 = __wm_scalar_198_0.args[0][0];
const rest_2872 = __wm_scalar_198_0.args[0][1];
if (__wm_eq(expression_2871.kind, "call")) {
{
const __wm_tail_value_231 = Js.Array.toList(expression_2871.children);
if (__wm_tail_value_231?.ctor === -6 && __wm_tail_value_231.args.length === 1 && __wm_is_tuple(__wm_tail_value_231.args[0]) && __wm_tail_value_231.args[0].length === 2) {
const calleeId_2873 = __wm_tail_value_231.args[0][0];
const argumentIds_2874 = __wm_tail_value_231.args[0][1];
{
const __wm_tail_value_232 = Map.get([expressionRegistry_2867, calleeId_2873]);
if (__wm_tail_value_232?.ctor === -2 && __wm_tail_value_232.args.length === 1) {
const callee_2875 = __wm_tail_value_232.args[0];
{
const __wm_tail_value_233 = Map.get([bindingFunctions_2868, callee_2875.bindingId]);
if (__wm_tail_value_233?.ctor === -2 && __wm_tail_value_233.args.length === 1) {
const functionId_2876 = __wm_tail_value_233.args[0];
{
const __wm_tail_value_234 = Map.get([functionRegistry_2866, functionId_2876]);
if (__wm_tail_value_234?.ctor === -2 && __wm_tail_value_234.args.length === 1) {
const rawCalleeFn_2877 = __wm_tail_value_234.args[0];
{
const calleeFn_2878 = rawCalleeFn_2877;
const activeTarget_2879 = Map.get([active_2864, calleeFn_2878.id]);
const argumentRepresentations_2880 = callArgumentRepresentations_2684__wm_d5(argumentIds_2874, expressionRegistry_2867, typeRegistry_2869, representations_2863, __wm_basis_Nil);
const callResultRepresentation_2881 = concreteRepresentation_2659__wm_d3(typeRegistry_2869, representations_2863, expression_2871.typeId);
const __wm_bind_97 = ((__v) => {
if (__v?.ctor === -2 && __v.args.length === 1) {
const targetId_2882 = __v.args[0];
const nextState_2883 = (__wm_eq(calleeFn_2878.id, fn_2861.id) ? state_2865 : withSpecializationDiagnostic_2832__wm_d2(state_2865, mutualRecursionDiagnostic_2835(expression_2871)));
return [nextState_2883, targetId_2882];
} else if (__v === __wm_basis_None) {

return materializeSpecialization_2836__wm_d10(calleeFn_2878, argumentRepresentations_2880, callResultRepresentation_2881, active_2864, state_2865, functionRegistry_2866, expressionRegistry_2867, bindingFunctions_2868, typeRegistry_2869, typeItems_2870);
}
__wm_fail("Match", "non-exhaustive match");
})(activeTarget_2879);
if (!(__wm_is_tuple(__wm_bind_97) && __wm_bind_97.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterTarget_2884 = __wm_bind_97[0];
const targetSpecializationId_2885 = __wm_bind_97[1];
const call_2886 = { callerSpecializationId: callerSpecializationId_2862, expressionId: expression_2871.id, targetSpecializationId: targetSpecializationId_2885 };
{
const __wm_tail_arg_235_0 = rest_2872;
const __wm_tail_arg_235_1 = fn_2861;
const __wm_tail_arg_235_2 = callerSpecializationId_2862;
const __wm_tail_arg_235_3 = representations_2863;
const __wm_tail_arg_235_4 = active_2864;
const __wm_tail_arg_235_5 = withSpecializedCall_2829__wm_d2(afterTarget_2884, call_2886);
const __wm_tail_arg_235_6 = functionRegistry_2866;
const __wm_tail_arg_235_7 = expressionRegistry_2867;
const __wm_tail_arg_235_8 = bindingFunctions_2868;
const __wm_tail_arg_235_9 = typeRegistry_2869;
const __wm_tail_arg_235_10 = typeItems_2870;
expressions_2860 = __wm_tail_arg_235_0;
fn_2861 = __wm_tail_arg_235_1;
callerSpecializationId_2862 = __wm_tail_arg_235_2;
representations_2863 = __wm_tail_arg_235_3;
active_2864 = __wm_tail_arg_235_4;
state_2865 = __wm_tail_arg_235_5;
functionRegistry_2866 = __wm_tail_arg_235_6;
expressionRegistry_2867 = __wm_tail_arg_235_7;
bindingFunctions_2868 = __wm_tail_arg_235_8;
typeRegistry_2869 = __wm_tail_arg_235_9;
typeItems_2870 = __wm_tail_arg_235_10;
continue __wm_tail_173;
}
}
} else if (__wm_tail_value_234 === __wm_basis_None) {

{
const __wm_tail_arg_236_0 = rest_2872;
const __wm_tail_arg_236_1 = fn_2861;
const __wm_tail_arg_236_2 = callerSpecializationId_2862;
const __wm_tail_arg_236_3 = representations_2863;
const __wm_tail_arg_236_4 = active_2864;
const __wm_tail_arg_236_5 = state_2865;
const __wm_tail_arg_236_6 = functionRegistry_2866;
const __wm_tail_arg_236_7 = expressionRegistry_2867;
const __wm_tail_arg_236_8 = bindingFunctions_2868;
const __wm_tail_arg_236_9 = typeRegistry_2869;
const __wm_tail_arg_236_10 = typeItems_2870;
expressions_2860 = __wm_tail_arg_236_0;
fn_2861 = __wm_tail_arg_236_1;
callerSpecializationId_2862 = __wm_tail_arg_236_2;
representations_2863 = __wm_tail_arg_236_3;
active_2864 = __wm_tail_arg_236_4;
state_2865 = __wm_tail_arg_236_5;
functionRegistry_2866 = __wm_tail_arg_236_6;
expressionRegistry_2867 = __wm_tail_arg_236_7;
bindingFunctions_2868 = __wm_tail_arg_236_8;
typeRegistry_2869 = __wm_tail_arg_236_9;
typeItems_2870 = __wm_tail_arg_236_10;
continue __wm_tail_173;
}
}
__wm_fail("Match", "non-exhaustive match");
}
} else if (__wm_tail_value_233 === __wm_basis_None) {

{
const __wm_tail_arg_237_0 = rest_2872;
const __wm_tail_arg_237_1 = fn_2861;
const __wm_tail_arg_237_2 = callerSpecializationId_2862;
const __wm_tail_arg_237_3 = representations_2863;
const __wm_tail_arg_237_4 = active_2864;
const __wm_tail_arg_237_5 = state_2865;
const __wm_tail_arg_237_6 = functionRegistry_2866;
const __wm_tail_arg_237_7 = expressionRegistry_2867;
const __wm_tail_arg_237_8 = bindingFunctions_2868;
const __wm_tail_arg_237_9 = typeRegistry_2869;
const __wm_tail_arg_237_10 = typeItems_2870;
expressions_2860 = __wm_tail_arg_237_0;
fn_2861 = __wm_tail_arg_237_1;
callerSpecializationId_2862 = __wm_tail_arg_237_2;
representations_2863 = __wm_tail_arg_237_3;
active_2864 = __wm_tail_arg_237_4;
state_2865 = __wm_tail_arg_237_5;
functionRegistry_2866 = __wm_tail_arg_237_6;
expressionRegistry_2867 = __wm_tail_arg_237_7;
bindingFunctions_2868 = __wm_tail_arg_237_8;
typeRegistry_2869 = __wm_tail_arg_237_9;
typeItems_2870 = __wm_tail_arg_237_10;
continue __wm_tail_173;
}
}
__wm_fail("Match", "non-exhaustive match");
}
} else if (__wm_tail_value_232 === __wm_basis_None) {

{
const __wm_tail_arg_238_0 = rest_2872;
const __wm_tail_arg_238_1 = fn_2861;
const __wm_tail_arg_238_2 = callerSpecializationId_2862;
const __wm_tail_arg_238_3 = representations_2863;
const __wm_tail_arg_238_4 = active_2864;
const __wm_tail_arg_238_5 = state_2865;
const __wm_tail_arg_238_6 = functionRegistry_2866;
const __wm_tail_arg_238_7 = expressionRegistry_2867;
const __wm_tail_arg_238_8 = bindingFunctions_2868;
const __wm_tail_arg_238_9 = typeRegistry_2869;
const __wm_tail_arg_238_10 = typeItems_2870;
expressions_2860 = __wm_tail_arg_238_0;
fn_2861 = __wm_tail_arg_238_1;
callerSpecializationId_2862 = __wm_tail_arg_238_2;
representations_2863 = __wm_tail_arg_238_3;
active_2864 = __wm_tail_arg_238_4;
state_2865 = __wm_tail_arg_238_5;
functionRegistry_2866 = __wm_tail_arg_238_6;
expressionRegistry_2867 = __wm_tail_arg_238_7;
bindingFunctions_2868 = __wm_tail_arg_238_8;
typeRegistry_2869 = __wm_tail_arg_238_9;
typeItems_2870 = __wm_tail_arg_238_10;
continue __wm_tail_173;
}
}
__wm_fail("Match", "non-exhaustive match");
}
} else if (__wm_tail_value_231 === __wm_basis_Nil) {

{
const __wm_tail_arg_239_0 = rest_2872;
const __wm_tail_arg_239_1 = fn_2861;
const __wm_tail_arg_239_2 = callerSpecializationId_2862;
const __wm_tail_arg_239_3 = representations_2863;
const __wm_tail_arg_239_4 = active_2864;
const __wm_tail_arg_239_5 = state_2865;
const __wm_tail_arg_239_6 = functionRegistry_2866;
const __wm_tail_arg_239_7 = expressionRegistry_2867;
const __wm_tail_arg_239_8 = bindingFunctions_2868;
const __wm_tail_arg_239_9 = typeRegistry_2869;
const __wm_tail_arg_239_10 = typeItems_2870;
expressions_2860 = __wm_tail_arg_239_0;
fn_2861 = __wm_tail_arg_239_1;
callerSpecializationId_2862 = __wm_tail_arg_239_2;
representations_2863 = __wm_tail_arg_239_3;
active_2864 = __wm_tail_arg_239_4;
state_2865 = __wm_tail_arg_239_5;
functionRegistry_2866 = __wm_tail_arg_239_6;
expressionRegistry_2867 = __wm_tail_arg_239_7;
bindingFunctions_2868 = __wm_tail_arg_239_8;
typeRegistry_2869 = __wm_tail_arg_239_9;
typeItems_2870 = __wm_tail_arg_239_10;
continue __wm_tail_173;
}
}
__wm_fail("Match", "non-exhaustive match");
}
} else {
{
const __wm_tail_arg_240_0 = rest_2872;
const __wm_tail_arg_240_1 = fn_2861;
const __wm_tail_arg_240_2 = callerSpecializationId_2862;
const __wm_tail_arg_240_3 = representations_2863;
const __wm_tail_arg_240_4 = active_2864;
const __wm_tail_arg_240_5 = state_2865;
const __wm_tail_arg_240_6 = functionRegistry_2866;
const __wm_tail_arg_240_7 = expressionRegistry_2867;
const __wm_tail_arg_240_8 = bindingFunctions_2868;
const __wm_tail_arg_240_9 = typeRegistry_2869;
const __wm_tail_arg_240_10 = typeItems_2870;
expressions_2860 = __wm_tail_arg_240_0;
fn_2861 = __wm_tail_arg_240_1;
callerSpecializationId_2862 = __wm_tail_arg_240_2;
representations_2863 = __wm_tail_arg_240_3;
active_2864 = __wm_tail_arg_240_4;
state_2865 = __wm_tail_arg_240_5;
functionRegistry_2866 = __wm_tail_arg_240_6;
expressionRegistry_2867 = __wm_tail_arg_240_7;
bindingFunctions_2868 = __wm_tail_arg_240_8;
typeRegistry_2869 = __wm_tail_arg_240_9;
typeItems_2870 = __wm_tail_arg_240_10;
continue __wm_tail_173;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const materializeSpecializedCalls_2837 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 11) return materializeSpecializedCalls_2837__wm_d11(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8], __arg[9], __arg[10]);
__wm_fail("Match", "pattern match failure in function");
};
const materializeRootSpecializations_2887__wm_d7 = (roots_2888, state_2889, functionRegistry_2890, expressionRegistry_2891, bindingFunctions_2892, typeRegistry_2893, typeItems_2894) => {
__wm_tail_174: while (true) {
{
const __wm_scalar_199_0 = roots_2888;
const __wm_scalar_199_1 = state_2889;
const __wm_scalar_199_2 = functionRegistry_2890;
const __wm_scalar_199_3 = expressionRegistry_2891;
const __wm_scalar_199_4 = bindingFunctions_2892;
const __wm_scalar_199_5 = typeRegistry_2893;
const __wm_scalar_199_6 = typeItems_2894;
if (__wm_scalar_199_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_199_1, state_2889) && __wm_eq(__wm_scalar_199_2, functionRegistry_2890) && __wm_eq(__wm_scalar_199_3, expressionRegistry_2891) && __wm_eq(__wm_scalar_199_4, bindingFunctions_2892) && __wm_eq(__wm_scalar_199_5, typeRegistry_2893) && __wm_eq(__wm_scalar_199_6, typeItems_2894)) {

return state_2889;
} else if (__wm_scalar_199_0?.ctor === -6 && __wm_scalar_199_0.args.length === 1 && __wm_is_tuple(__wm_scalar_199_0.args[0]) && __wm_scalar_199_0.args[0].length === 2 && __wm_eq(__wm_scalar_199_1, state_2889) && __wm_eq(__wm_scalar_199_2, functionRegistry_2890) && __wm_eq(__wm_scalar_199_3, expressionRegistry_2891) && __wm_eq(__wm_scalar_199_4, bindingFunctions_2892) && __wm_eq(__wm_scalar_199_5, typeRegistry_2893) && __wm_eq(__wm_scalar_199_6, typeItems_2894)) {
const root_2895 = __wm_scalar_199_0.args[0][0];
const rest_2896 = __wm_scalar_199_0.args[0][1];
{
const gpuRoot_2897 = root_2895;
{
const __wm_tail_value_241 = Map.get([functionRegistry_2890, gpuRoot_2897.functionId]);
if (__wm_tail_value_241?.ctor === -2 && __wm_tail_value_241.args.length === 1) {
const rawFn_2898 = __wm_tail_value_241.args[0];
{
const fn_2899 = rawFn_2898;
const __wm_bind_98 = materializeSpecialization_2836__wm_d10(fn_2899, __wm_basis_Nil, "", Map.empty(Map.numberCompare), state_2889, functionRegistry_2890, expressionRegistry_2891, bindingFunctions_2892, typeRegistry_2893, typeItems_2894);
if (!(__wm_is_tuple(__wm_bind_98) && __wm_bind_98.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const afterSpecialization_2900 = __wm_bind_98[0];
const specializationId_2901 = __wm_bind_98[1];
const rootSpecialization_2902 = { regionId: gpuRoot_2897.regionId, specializationId: specializationId_2901 };
const withRoot_2903 = { nextId: afterSpecialization_2900.nextId, registry: afterSpecialization_2900.registry, specializations: afterSpecialization_2900.specializations, rootSpecializations: __wm_basis_Cons([rootSpecialization_2902, afterSpecialization_2900.rootSpecializations]), calls: afterSpecialization_2900.calls, diagnostics: afterSpecialization_2900.diagnostics };
{
const __wm_tail_arg_242_0 = rest_2896;
const __wm_tail_arg_242_1 = withRoot_2903;
const __wm_tail_arg_242_2 = functionRegistry_2890;
const __wm_tail_arg_242_3 = expressionRegistry_2891;
const __wm_tail_arg_242_4 = bindingFunctions_2892;
const __wm_tail_arg_242_5 = typeRegistry_2893;
const __wm_tail_arg_242_6 = typeItems_2894;
roots_2888 = __wm_tail_arg_242_0;
state_2889 = __wm_tail_arg_242_1;
functionRegistry_2890 = __wm_tail_arg_242_2;
expressionRegistry_2891 = __wm_tail_arg_242_3;
bindingFunctions_2892 = __wm_tail_arg_242_4;
typeRegistry_2893 = __wm_tail_arg_242_5;
typeItems_2894 = __wm_tail_arg_242_6;
continue __wm_tail_174;
}
}
} else if (__wm_tail_value_241 === __wm_basis_None) {

{
const __wm_tail_arg_243_0 = rest_2896;
const __wm_tail_arg_243_1 = state_2889;
const __wm_tail_arg_243_2 = functionRegistry_2890;
const __wm_tail_arg_243_3 = expressionRegistry_2891;
const __wm_tail_arg_243_4 = bindingFunctions_2892;
const __wm_tail_arg_243_5 = typeRegistry_2893;
const __wm_tail_arg_243_6 = typeItems_2894;
roots_2888 = __wm_tail_arg_243_0;
state_2889 = __wm_tail_arg_243_1;
functionRegistry_2890 = __wm_tail_arg_243_2;
expressionRegistry_2891 = __wm_tail_arg_243_3;
bindingFunctions_2892 = __wm_tail_arg_243_4;
typeRegistry_2893 = __wm_tail_arg_243_5;
typeItems_2894 = __wm_tail_arg_243_6;
continue __wm_tail_174;
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
const materializeRootSpecializations_2887 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 7) return materializeRootSpecializations_2887__wm_d7(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6]);
__wm_fail("Match", "pattern match failure in function");
};
const initialIrBuildState_2904 = (__arg) => {
if (__arg === undefined) {

return { nextExpressionId: 0, functions: Map.empty(Map.numberCompare), expressions: Map.empty(Map.numberCompare) };
}
__wm_fail("Match", "pattern match failure in function");
};
const indexRepresentationFacts_2905__wm_d2 = (facts_2906, registry_2907) => {
__wm_tail_175: while (true) {
{
const __wm_scalar_200_0 = facts_2906;
const __wm_scalar_200_1 = registry_2907;
if (__wm_scalar_200_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_200_1, registry_2907)) {

return registry_2907;
} else if (__wm_scalar_200_0?.ctor === -6 && __wm_scalar_200_0.args.length === 1 && __wm_is_tuple(__wm_scalar_200_0.args[0]) && __wm_scalar_200_0.args[0].length === 2 && __wm_eq(__wm_scalar_200_1, registry_2907)) {
const fact_2908 = __wm_scalar_200_0.args[0][0];
const rest_2909 = __wm_scalar_200_0.args[0][1];
{
const __wm_tail_arg_244_0 = rest_2909;
const __wm_tail_arg_244_1 = Map.set([registry_2907, fact_2908.typeId, fact_2908.representation]);
facts_2906 = __wm_tail_arg_244_0;
registry_2907 = __wm_tail_arg_244_1;
continue __wm_tail_175;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const indexRepresentationFacts_2905 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return indexRepresentationFacts_2905__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const irRepresentation_2913__wm_d2 = (facts_2910, typeId_2911) => {
const __wm_return_value_58 = Map.get([facts_2910, typeId_2911]);
if (__wm_return_value_58?.ctor === -2 && __wm_return_value_58.args.length === 1) {
const representation_2912 = __wm_return_value_58.args[0];
return representation_2912;
} else if (__wm_return_value_58 === __wm_basis_None) {

return "";
}
__wm_fail("Match", "non-exhaustive match");
};
const irRepresentation_2913 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return irRepresentation_2913__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const specializedCallTarget_2914__wm_d3 = (calls_2915, specializationId_2916, expressionId_2917) => {
__wm_tail_176: while (true) {
{
const __wm_scalar_201_0 = calls_2915;
const __wm_scalar_201_1 = specializationId_2916;
const __wm_scalar_201_2 = expressionId_2917;
if (__wm_scalar_201_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_201_1, specializationId_2916) && __wm_eq(__wm_scalar_201_2, expressionId_2917)) {

return __wm_op_sub(1);
} else if (__wm_scalar_201_0?.ctor === -6 && __wm_scalar_201_0.args.length === 1 && __wm_is_tuple(__wm_scalar_201_0.args[0]) && __wm_scalar_201_0.args[0].length === 2 && __wm_eq(__wm_scalar_201_1, specializationId_2916) && __wm_eq(__wm_scalar_201_2, expressionId_2917)) {
const rawCall_2918 = __wm_scalar_201_0.args[0][0];
const rest_2919 = __wm_scalar_201_0.args[0][1];
{
const call_2920 = rawCall_2918;
if (__wm_op_and_d2(__wm_eq(call_2920.callerSpecializationId, specializationId_2916), __wm_eq(call_2920.expressionId, expressionId_2917))) {
return call_2920.targetSpecializationId;
} else {
{
const __wm_tail_arg_245_0 = rest_2919;
const __wm_tail_arg_245_1 = specializationId_2916;
const __wm_tail_arg_245_2 = expressionId_2917;
calls_2915 = __wm_tail_arg_245_0;
specializationId_2916 = __wm_tail_arg_245_1;
expressionId_2917 = __wm_tail_arg_245_2;
continue __wm_tail_176;
}
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const specializedCallTarget_2914 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return specializedCallTarget_2914__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const irValueKind_2924__wm_d3 = (expression_2921, bound_2922, bindingFunctions_2923) => {
if (__wm_op_or_d2(__wm_op_or_d2(__wm_op_or_d2(__wm_eq(expression_2921.kind, "number"), __wm_eq(expression_2921.kind, "bool")), __wm_eq(expression_2921.kind, "string")), __wm_eq(expression_2921.kind, "void"))) {
return "literal";
} else {
if (__wm_eq(expression_2921.kind, "var")) {
if ((expression_2921.bindingId < 0)) {
return "unresolved";
} else {
if (Map.has([bound_2922, expression_2921.bindingId])) {
return "local";
} else {
if (Map.has([bindingFunctions_2923, expression_2921.bindingId])) {
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
const irValueKind_2924 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return irValueKind_2924__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const reifyIrExpression_2925__wm_d8 = (sourceExpressionId_2927, specializationId_2928, facts_2929, bound_2930, calls_2931, expressionRegistry_2932, bindingFunctions_2933, state_2934) => {
const __wm_return_value_59 = Map.get([expressionRegistry_2932, sourceExpressionId_2927]);
if (__wm_return_value_59 === __wm_basis_None) {

return [state_2934, __wm_op_sub(1)];
} else if (__wm_return_value_59?.ctor === -2 && __wm_return_value_59.args.length === 1) {
const rawExpression_2935 = __wm_return_value_59.args[0];
const expression_2936 = rawExpression_2935;
const irExpressionId_2937 = state_2934.nextExpressionId;
const reserved_2938 = { nextExpressionId: (irExpressionId_2937 + 1), functions: state_2934.functions, expressions: state_2934.expressions };
const __wm_bind_99 = reifyIrChildren_2926__wm_d9(Js.Array.toList(expression_2936.children), specializationId_2928, facts_2929, bound_2930, calls_2931, expressionRegistry_2932, bindingFunctions_2933, reserved_2938, __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_99) && __wm_bind_99.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withChildren_2939 = __wm_bind_99[0];
const childIds_2940 = __wm_bind_99[1];
const irExpression_2941 = { id: irExpressionId_2937, specializationId: specializationId_2928, sourceExprId: expression_2936.id, kind: expression_2936.kind, typeId: expression_2936.typeId, representation: irRepresentation_2913__wm_d2(facts_2929, expression_2936.typeId), spanId: expression_2936.spanId, bindingId: expression_2936.bindingId, name: expression_2936.name, operator: expression_2936.operator, numberValue: expression_2936.numberValue, boolValue: expression_2936.boolValue, children: Js.Array.fromList(childIds_2940), capability: expression_2936.capability, valueKind: irValueKind_2924__wm_d3(expression_2936, bound_2930, bindingFunctions_2933), callTargetSpecializationId: specializedCallTarget_2914__wm_d3(calls_2931, specializationId_2928, expression_2936.id) };
const completed_2942 = { nextExpressionId: withChildren_2939.nextExpressionId, functions: withChildren_2939.functions, expressions: Map.set([withChildren_2939.expressions, irExpressionId_2937, irExpression_2941]) };
return [completed_2942, irExpressionId_2937];
}
__wm_fail("Match", "non-exhaustive match");
};
const reifyIrExpression_2925 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 8) return reifyIrExpression_2925__wm_d8(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7]);
__wm_fail("Match", "pattern match failure in function");
};
const reifyIrChildren_2926__wm_d9 = (sourceChildIds_2943, specializationId_2944, facts_2945, bound_2946, calls_2947, expressionRegistry_2948, bindingFunctions_2949, state_2950, childIds_2951) => {
__wm_tail_177: while (true) {
{
const __wm_scalar_202_0 = sourceChildIds_2943;
const __wm_scalar_202_1 = specializationId_2944;
const __wm_scalar_202_2 = facts_2945;
const __wm_scalar_202_3 = bound_2946;
const __wm_scalar_202_4 = calls_2947;
const __wm_scalar_202_5 = expressionRegistry_2948;
const __wm_scalar_202_6 = bindingFunctions_2949;
const __wm_scalar_202_7 = state_2950;
const __wm_scalar_202_8 = childIds_2951;
if (__wm_scalar_202_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_202_1, specializationId_2944) && __wm_eq(__wm_scalar_202_2, facts_2945) && __wm_eq(__wm_scalar_202_3, bound_2946) && __wm_eq(__wm_scalar_202_4, calls_2947) && __wm_eq(__wm_scalar_202_5, expressionRegistry_2948) && __wm_eq(__wm_scalar_202_6, bindingFunctions_2949) && __wm_eq(__wm_scalar_202_7, state_2950) && __wm_eq(__wm_scalar_202_8, childIds_2951)) {

return [state_2950, reverseInto_2317__wm_d2(childIds_2951, __wm_basis_Nil)];
} else if (__wm_scalar_202_0?.ctor === -6 && __wm_scalar_202_0.args.length === 1 && __wm_is_tuple(__wm_scalar_202_0.args[0]) && __wm_scalar_202_0.args[0].length === 2 && __wm_eq(__wm_scalar_202_1, specializationId_2944) && __wm_eq(__wm_scalar_202_2, facts_2945) && __wm_eq(__wm_scalar_202_3, bound_2946) && __wm_eq(__wm_scalar_202_4, calls_2947) && __wm_eq(__wm_scalar_202_5, expressionRegistry_2948) && __wm_eq(__wm_scalar_202_6, bindingFunctions_2949) && __wm_eq(__wm_scalar_202_7, state_2950) && __wm_eq(__wm_scalar_202_8, childIds_2951)) {
const sourceChildId_2952 = __wm_scalar_202_0.args[0][0];
const rest_2953 = __wm_scalar_202_0.args[0][1];
{
const __wm_bind_100 = reifyIrExpression_2925__wm_d8(sourceChildId_2952, specializationId_2944, facts_2945, bound_2946, calls_2947, expressionRegistry_2948, bindingFunctions_2949, state_2950);
if (!(__wm_is_tuple(__wm_bind_100) && __wm_bind_100.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const nextState_2954 = __wm_bind_100[0];
const childId_2955 = __wm_bind_100[1];
{
const __wm_tail_arg_246_0 = rest_2953;
const __wm_tail_arg_246_1 = specializationId_2944;
const __wm_tail_arg_246_2 = facts_2945;
const __wm_tail_arg_246_3 = bound_2946;
const __wm_tail_arg_246_4 = calls_2947;
const __wm_tail_arg_246_5 = expressionRegistry_2948;
const __wm_tail_arg_246_6 = bindingFunctions_2949;
const __wm_tail_arg_246_7 = nextState_2954;
const __wm_tail_arg_246_8 = __wm_basis_Cons([childId_2955, childIds_2951]);
sourceChildIds_2943 = __wm_tail_arg_246_0;
specializationId_2944 = __wm_tail_arg_246_1;
facts_2945 = __wm_tail_arg_246_2;
bound_2946 = __wm_tail_arg_246_3;
calls_2947 = __wm_tail_arg_246_4;
expressionRegistry_2948 = __wm_tail_arg_246_5;
bindingFunctions_2949 = __wm_tail_arg_246_6;
state_2950 = __wm_tail_arg_246_7;
childIds_2951 = __wm_tail_arg_246_8;
continue __wm_tail_177;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reifyIrChildren_2926 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 9) return reifyIrChildren_2926__wm_d9(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5], __arg[6], __arg[7], __arg[8]);
__wm_fail("Match", "pattern match failure in function");
};
const reifyIrParams_2956__wm_d3 = (params_2957, facts_2958, output_2959) => {
__wm_tail_178: while (true) {
{
const __wm_scalar_203_0 = params_2957;
const __wm_scalar_203_1 = facts_2958;
const __wm_scalar_203_2 = output_2959;
if (__wm_scalar_203_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_203_1, facts_2958) && __wm_eq(__wm_scalar_203_2, output_2959)) {

return reverseInto_2317__wm_d2(output_2959, __wm_basis_Nil);
} else if (__wm_scalar_203_0?.ctor === -6 && __wm_scalar_203_0.args.length === 1 && __wm_is_tuple(__wm_scalar_203_0.args[0]) && __wm_scalar_203_0.args[0].length === 2 && __wm_eq(__wm_scalar_203_1, facts_2958) && __wm_eq(__wm_scalar_203_2, output_2959)) {
const rawParam_2960 = __wm_scalar_203_0.args[0][0];
const rest_2961 = __wm_scalar_203_0.args[0][1];
{
const param_2962 = rawParam_2960;
const irParam_2963 = { bindingId: param_2962.bindingId, name: param_2962.name, typeId: param_2962.typeId, representation: irRepresentation_2913__wm_d2(facts_2958, param_2962.typeId) };
{
const __wm_tail_arg_247_0 = rest_2961;
const __wm_tail_arg_247_1 = facts_2958;
const __wm_tail_arg_247_2 = __wm_basis_Cons([irParam_2963, output_2959]);
params_2957 = __wm_tail_arg_247_0;
facts_2958 = __wm_tail_arg_247_1;
output_2959 = __wm_tail_arg_247_2;
continue __wm_tail_178;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const reifyIrParams_2956 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 3) return reifyIrParams_2956__wm_d3(__arg[0], __arg[1], __arg[2]);
__wm_fail("Match", "pattern match failure in function");
};
const reifyIrSpecializations_2964__wm_d6 = (specializations_2965, calls_2966, functionRegistry_2967, expressionRegistry_2968, bindingFunctions_2969, state_2970) => {
__wm_tail_179: while (true) {
{
const __wm_scalar_204_0 = specializations_2965;
const __wm_scalar_204_1 = calls_2966;
const __wm_scalar_204_2 = functionRegistry_2967;
const __wm_scalar_204_3 = expressionRegistry_2968;
const __wm_scalar_204_4 = bindingFunctions_2969;
const __wm_scalar_204_5 = state_2970;
if (__wm_scalar_204_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_204_1, calls_2966) && __wm_eq(__wm_scalar_204_2, functionRegistry_2967) && __wm_eq(__wm_scalar_204_3, expressionRegistry_2968) && __wm_eq(__wm_scalar_204_4, bindingFunctions_2969) && __wm_eq(__wm_scalar_204_5, state_2970)) {

return state_2970;
} else if (__wm_scalar_204_0?.ctor === -6 && __wm_scalar_204_0.args.length === 1 && __wm_is_tuple(__wm_scalar_204_0.args[0]) && __wm_scalar_204_0.args[0].length === 2 && __wm_eq(__wm_scalar_204_1, calls_2966) && __wm_eq(__wm_scalar_204_2, functionRegistry_2967) && __wm_eq(__wm_scalar_204_3, expressionRegistry_2968) && __wm_eq(__wm_scalar_204_4, bindingFunctions_2969) && __wm_eq(__wm_scalar_204_5, state_2970)) {
const rawSpecialization_2971 = __wm_scalar_204_0.args[0][0];
const rest_2972 = __wm_scalar_204_0.args[0][1];
{
const specialization_2973 = rawSpecialization_2971;
{
const __wm_tail_value_248 = Map.get([functionRegistry_2967, specialization_2973.functionId]);
if (__wm_tail_value_248?.ctor === -2 && __wm_tail_value_248.args.length === 1) {
const rawFn_2974 = __wm_tail_value_248.args[0];
{
const fn_2975 = rawFn_2974;
const facts_2976 = indexRepresentationFacts_2905__wm_d2(Js.Array.toList(specialization_2973.typeFacts), Map.empty(Map.numberCompare));
const paramBound_2977 = bindParams_2403__wm_d2(Js.Array.toList(fn_2975.params), Map.empty(Map.numberCompare));
const bound_2978 = collectLocalBindings_2408__wm_d4(__wm_basis_Cons([fn_2975.bodyExprId, __wm_basis_Nil]), expressionRegistry_2968, Map.empty(Map.numberCompare), paramBound_2977);
const __wm_bind_101 = reifyIrExpression_2925__wm_d8(fn_2975.bodyExprId, specialization_2973.id, facts_2976, bound_2978, calls_2966, expressionRegistry_2968, bindingFunctions_2969, state_2970);
if (!(__wm_is_tuple(__wm_bind_101) && __wm_bind_101.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const withBody_2979 = __wm_bind_101[0];
const bodyExprId_2980 = __wm_bind_101[1];
const irFunction_2981 = { specializationId: specialization_2973.id, functionId: fn_2975.id, bindingId: fn_2975.bindingId, name: specialization_2973.name, params: Js.Array.fromList(reifyIrParams_2956__wm_d3(Js.Array.toList(fn_2975.params), facts_2976, __wm_basis_Nil)), resultTypeId: fn_2975.resultTypeId, resultRepresentation: specialization_2973.resultRepresentation, bodyExprId: bodyExprId_2980, spanId: fn_2975.spanId };
const completed_2982 = { nextExpressionId: withBody_2979.nextExpressionId, functions: Map.set([withBody_2979.functions, specialization_2973.id, irFunction_2981]), expressions: withBody_2979.expressions };
{
const __wm_tail_arg_249_0 = rest_2972;
const __wm_tail_arg_249_1 = calls_2966;
const __wm_tail_arg_249_2 = functionRegistry_2967;
const __wm_tail_arg_249_3 = expressionRegistry_2968;
const __wm_tail_arg_249_4 = bindingFunctions_2969;
const __wm_tail_arg_249_5 = completed_2982;
specializations_2965 = __wm_tail_arg_249_0;
calls_2966 = __wm_tail_arg_249_1;
functionRegistry_2967 = __wm_tail_arg_249_2;
expressionRegistry_2968 = __wm_tail_arg_249_3;
bindingFunctions_2969 = __wm_tail_arg_249_4;
state_2970 = __wm_tail_arg_249_5;
continue __wm_tail_179;
}
}
} else if (__wm_tail_value_248 === __wm_basis_None) {

{
const __wm_tail_arg_250_0 = rest_2972;
const __wm_tail_arg_250_1 = calls_2966;
const __wm_tail_arg_250_2 = functionRegistry_2967;
const __wm_tail_arg_250_3 = expressionRegistry_2968;
const __wm_tail_arg_250_4 = bindingFunctions_2969;
const __wm_tail_arg_250_5 = state_2970;
specializations_2965 = __wm_tail_arg_250_0;
calls_2966 = __wm_tail_arg_250_1;
functionRegistry_2967 = __wm_tail_arg_250_2;
expressionRegistry_2968 = __wm_tail_arg_250_3;
bindingFunctions_2969 = __wm_tail_arg_250_4;
state_2970 = __wm_tail_arg_250_5;
continue __wm_tail_179;
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
const reifyIrSpecializations_2964 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 6) return reifyIrSpecializations_2964__wm_d6(__arg[0], __arg[1], __arg[2], __arg[3], __arg[4], __arg[5]);
__wm_fail("Match", "pattern match failure in function");
};
const irFunctionValues_2983__wm_d2 = (entries_2984, values_2985) => {
__wm_tail_180: while (true) {
{
const __wm_scalar_205_0 = entries_2984;
const __wm_scalar_205_1 = values_2985;
if (__wm_scalar_205_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_205_1, values_2985)) {

return reverseInto_2317__wm_d2(values_2985, __wm_basis_Nil);
} else if (__wm_scalar_205_0?.ctor === -6 && __wm_scalar_205_0.args.length === 1 && __wm_is_tuple(__wm_scalar_205_0.args[0]) && __wm_scalar_205_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_205_0.args[0][0]) && __wm_scalar_205_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_205_1, values_2985)) {
const _id_2986 = __wm_scalar_205_0.args[0][0][0];
const fn_2987 = __wm_scalar_205_0.args[0][0][1];
const rest_2988 = __wm_scalar_205_0.args[0][1];
{
const __wm_tail_arg_251_0 = rest_2988;
const __wm_tail_arg_251_1 = __wm_basis_Cons([fn_2987, values_2985]);
entries_2984 = __wm_tail_arg_251_0;
values_2985 = __wm_tail_arg_251_1;
continue __wm_tail_180;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const irFunctionValues_2983 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return irFunctionValues_2983__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const irExpressionValues_2989__wm_d2 = (entries_2990, values_2991) => {
__wm_tail_181: while (true) {
{
const __wm_scalar_206_0 = entries_2990;
const __wm_scalar_206_1 = values_2991;
if (__wm_scalar_206_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_206_1, values_2991)) {

return reverseInto_2317__wm_d2(values_2991, __wm_basis_Nil);
} else if (__wm_scalar_206_0?.ctor === -6 && __wm_scalar_206_0.args.length === 1 && __wm_is_tuple(__wm_scalar_206_0.args[0]) && __wm_scalar_206_0.args[0].length === 2 && __wm_is_tuple(__wm_scalar_206_0.args[0][0]) && __wm_scalar_206_0.args[0][0].length === 2 && __wm_eq(__wm_scalar_206_1, values_2991)) {
const _id_2992 = __wm_scalar_206_0.args[0][0][0];
const expression_2993 = __wm_scalar_206_0.args[0][0][1];
const rest_2994 = __wm_scalar_206_0.args[0][1];
{
const __wm_tail_arg_252_0 = rest_2994;
const __wm_tail_arg_252_1 = __wm_basis_Cons([expression_2993, values_2991]);
entries_2990 = __wm_tail_arg_252_0;
values_2991 = __wm_tail_arg_252_1;
continue __wm_tail_181;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const irExpressionValues_2989 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return irExpressionValues_2989__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const mergeConsensusRepresentation_2997__wm_d2 = (previous_2995, next_2996) => {
if (__wm_eq(previous_2995, "")) {
return next_2996;
} else {
if (__wm_eq(previous_2995, next_2996)) {
return previous_2995;
} else {
return "conflict";
}
}
};
const mergeConsensusRepresentation_2997 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return mergeConsensusRepresentation_2997__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const addConsensusFacts_2998__wm_d2 = (facts_2999, consensus_3000) => {
__wm_tail_182: while (true) {
{
const __wm_scalar_207_0 = facts_2999;
const __wm_scalar_207_1 = consensus_3000;
if (__wm_scalar_207_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_207_1, consensus_3000)) {

return consensus_3000;
} else if (__wm_scalar_207_0?.ctor === -6 && __wm_scalar_207_0.args.length === 1 && __wm_is_tuple(__wm_scalar_207_0.args[0]) && __wm_scalar_207_0.args[0].length === 2 && __wm_eq(__wm_scalar_207_1, consensus_3000)) {
const fact_3001 = __wm_scalar_207_0.args[0][0];
const rest_3002 = __wm_scalar_207_0.args[0][1];
{
const previous_3003 = representationOf_2525__wm_d2(consensus_3000, fact_3001.typeId);
{
const __wm_tail_arg_253_0 = rest_3002;
const __wm_tail_arg_253_1 = Map.set([consensus_3000, fact_3001.typeId, mergeConsensusRepresentation_2997__wm_d2(previous_3003, fact_3001.representation)]);
facts_2999 = __wm_tail_arg_253_0;
consensus_3000 = __wm_tail_arg_253_1;
continue __wm_tail_182;
}
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const addConsensusFacts_2998 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return addConsensusFacts_2998__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const specializationConsensus_3004__wm_d2 = (specializations_3005, consensus_3006) => {
__wm_tail_183: while (true) {
{
const __wm_scalar_208_0 = specializations_3005;
const __wm_scalar_208_1 = consensus_3006;
if (__wm_scalar_208_0 === __wm_basis_Nil && __wm_eq(__wm_scalar_208_1, consensus_3006)) {

return consensus_3006;
} else if (__wm_scalar_208_0?.ctor === -6 && __wm_scalar_208_0.args.length === 1 && __wm_is_tuple(__wm_scalar_208_0.args[0]) && __wm_scalar_208_0.args[0].length === 2 && __wm_eq(__wm_scalar_208_1, consensus_3006)) {
const specialization_3007 = __wm_scalar_208_0.args[0][0];
const rest_3008 = __wm_scalar_208_0.args[0][1];
{
const __wm_tail_arg_254_0 = rest_3008;
const __wm_tail_arg_254_1 = addConsensusFacts_2998__wm_d2(Js.Array.toList(specialization_3007.typeFacts), consensus_3006);
specializations_3005 = __wm_tail_arg_254_0;
consensus_3006 = __wm_tail_arg_254_1;
continue __wm_tail_183;
}
}
__wm_fail("Match", "non-exhaustive match");
}
}
};
const specializationConsensus_3004 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return specializationConsensus_3004__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const refinedType_3014__wm_d2 = (consensus_3009, gpuType_3010) => {
const inferred_3011 = representationOf_2525__wm_d2(consensus_3009, gpuType_3010.id);
const representation_3012 = (__wm_eq(gpuType_3010.representation, "abstract") ? (__wm_op_or_d2(__wm_eq(inferred_3011, "i32"), __wm_eq(inferred_3011, "f32")) ? inferred_3011 : "abstract") : gpuType_3010.representation);
const output_3013 = { id: gpuType_3010.id, kind: gpuType_3010.kind, name: gpuType_3010.name, representation: representation_3012, width: gpuType_3010.width, items: gpuType_3010.items, params: gpuType_3010.params, result: gpuType_3010.result };
return output_3013;
};
const refinedType_3014 = (__arg) => {
if (__wm_is_tuple(__arg) && __arg.length === 2) return refinedType_3014__wm_d2(__arg[0], __arg[1]);
__wm_fail("Match", "pattern match failure in function");
};
const compileGpu_3038 = (__arg) => {
if (true) {
const input_3015 = __arg;
if (!__wm_eq(input_3015.schemaVersion, 1)) {
return incompatibleSchema_2311(input_3015.schemaVersion);
} else {
const functionItems_3016 = Js.Array.toList(input_3015.functions);
const bindingItems_3017 = Js.Array.toList(input_3015.bindings);
const expressionItems_3018 = Js.Array.toList(input_3015.expressions);
const typeItems_3019 = Js.Array.toList(input_3015.types);
const __wm_bind_102 = registerFunctions_2346__wm_d3(functionItems_3016, Map.empty(Map.numberCompare), __wm_basis_Nil);
if (!(__wm_is_tuple(__wm_bind_102) && __wm_bind_102.length === 2)) __wm_fail("Bind", "pattern match failure in let binding");
const functionRegistry_3020 = __wm_bind_102[0];
const duplicateDiagnostics_3021 = __wm_bind_102[1];
const expressionRegistry_3022 = indexExpressions_2512__wm_d2(expressionItems_3018, Map.empty(Map.numberCompare));
const bindingFunctions_3023 = indexFunctionBindings_2352__wm_d2(functionItems_3016, Map.empty(Map.numberCompare));
const bindingRegistry_3024 = indexBindings_2398__wm_d2(bindingItems_3017, Map.empty(Map.numberCompare));
const typeRegistry_3025 = indexTypes_2517__wm_d2(typeItems_3019, Map.empty(Map.numberCompare));
const reachable_3026 = solveReachableFunctions_2387__wm_d5(rootFunctionIds_2382__wm_d2(Js.Array.toList(input_3015.roots), __wm_basis_Nil), functionRegistry_3020, expressionRegistry_3022, bindingFunctions_3023, Map.empty(Map.numberCompare));
const captureItems_3027 = reverseInto_2317__wm_d2(rootCaptures_2491__wm_d7(Js.Array.toList(input_3015.roots), functionRegistry_3020, expressionRegistry_3022, bindingFunctions_3023, bindingRegistry_3024, typeRegistry_3025, __wm_basis_Nil), __wm_basis_Nil);
const specializationState_3028 = materializeRootSpecializations_2887__wm_d7(Js.Array.toList(input_3015.roots), initialSpecializationState_2826(undefined), functionRegistry_3020, expressionRegistry_3022, bindingFunctions_3023, typeRegistry_3025, typeItems_3019);
const irState_3029 = reifyIrSpecializations_2964__wm_d6(specializationState_3028.specializations, specializationState_3028.calls, functionRegistry_3020, expressionRegistry_3022, bindingFunctions_3023, initialIrBuildState_2904(undefined));
const diagnostics_3030 = prependAll_2312__wm_d2(reverseInto_2317__wm_d2(specializationState_3028.diagnostics, __wm_basis_Nil), prependAll_2312__wm_d2(captureDiagnostics_2507__wm_d2(captureItems_3027, __wm_basis_Nil), prependAll_2312__wm_d2(reachableCapabilityDiagnostics_2332__wm_d4(reachableBodyIds_2326__wm_d3(functionItems_3016, reachable_3026, __wm_basis_Nil), expressionRegistry_3022, Map.empty(Map.numberCompare), __wm_basis_Nil), duplicateDiagnostics_3021)));
const consensus_3031 = specializationConsensus_3004__wm_d2(specializationState_3028.specializations, Map.empty(Map.numberCompare));
const types_3033 = Js.Array.fromList(List.map([typeItems_3019, (__arg) => {
if (true) {
const gpuType_3032 = __arg;
return refinedType_3014__wm_d2(consensus_3031, gpuType_3032);
}
__wm_fail("Match", "pattern match failure in function");
}]));
const expressions_3034 = Js.Array.fromList(List.map([Js.Array.toList(input_3015.expressions), typedExpression_2300]));
const functions_3036 = Js.Array.fromList(List.map([Js.Array.toList(input_3015.functions), (__arg) => {
if (true) {
const fn_3035 = __arg;
return typedFunction_2305__wm_d2(reachable_3026, fn_3035);
}
__wm_fail("Match", "pattern match failure in function");
}]));
const output_3037 = { schemaVersion: 1, functions: functions_3036, captures: Js.Array.fromList(captureItems_3027), specializations: Js.Array.fromList(reverseInto_2317__wm_d2(specializationState_3028.specializations, __wm_basis_Nil)), rootSpecializations: Js.Array.fromList(reverseInto_2317__wm_d2(specializationState_3028.rootSpecializations, __wm_basis_Nil)), calls: Js.Array.fromList(reverseInto_2317__wm_d2(specializationState_3028.calls, __wm_basis_Nil)), irFunctions: Js.Array.fromList(irFunctionValues_2983__wm_d2(Map.toList(irState_3029.functions), __wm_basis_Nil)), irExpressions: Js.Array.fromList(irExpressionValues_2989__wm_d2(Map.toList(irState_3029.expressions), __wm_basis_Nil)), types: types_3033, expressions: expressions_3034, diagnostics: Js.Array.fromList(diagnostics_3030) };
return output_3037;
}
}
__wm_fail("Match", "pattern match failure in function");
};
const compileGpuSlice_3041 = (__arg) => {
if (true) {
const input_3039 = __arg;
const output_3040 = compileSliceProgram_2294(input_3039);
return output_3040;
}
__wm_fail("Match", "pattern match failure in function");
};
const elaborateGpuSliceTypes_3044 = (__arg) => {
if (true) {
const input_3042 = __arg;
const output_3043 = elaborateSliceProgramTypes_1960(input_3042);
return output_3043;
}
__wm_fail("Match", "pattern match failure in function");
};
return { "SpecializationRegistryEntry": SpecializationRegistryEntry_2295, "SpecializationBuildState": SpecializationBuildState_2296, "IrBuildState": IrBuildState_2297, "typedExpression": typedExpression_2300, "typedFunction": typedFunction_2305, "typedFunction__wm_d2": typedFunction_2305__wm_d2, "emptyOutput": emptyOutput_2307, "incompatibleSchema": incompatibleSchema_2311, "prependAll": prependAll_2312, "prependAll__wm_d2": prependAll_2312__wm_d2, "reverseInto": reverseInto_2317, "reverseInto__wm_d2": reverseInto_2317__wm_d2, "capabilityDiagnostic": capabilityDiagnostic_2325, "reachableBodyIds": reachableBodyIds_2326, "reachableBodyIds__wm_d3": reachableBodyIds_2326__wm_d3, "reachableCapabilityDiagnostics": reachableCapabilityDiagnostics_2332, "reachableCapabilityDiagnostics__wm_d4": reachableCapabilityDiagnostics_2332__wm_d4, "duplicateFunctionDiagnostic": duplicateFunctionDiagnostic_2345, "registerFunctions": registerFunctions_2346, "registerFunctions__wm_d3": registerFunctions_2346__wm_d3, "indexFunctionBindings": indexFunctionBindings_2352, "indexFunctionBindings__wm_d2": indexFunctionBindings_2352__wm_d2, "callDependency": callDependency_2363, "callDependency__wm_d3": callDependency_2363__wm_d3, "collectFunctionDependencies": collectFunctionDependencies_2364, "collectFunctionDependencies__wm_d5": collectFunctionDependencies_2364__wm_d5, "enqueueDependencies": enqueueDependencies_2376, "enqueueDependencies__wm_d2": enqueueDependencies_2376__wm_d2, "rootFunctionIds": rootFunctionIds_2382, "rootFunctionIds__wm_d2": rootFunctionIds_2382__wm_d2, "solveReachableFunctions": solveReachableFunctions_2387, "solveReachableFunctions__wm_d5": solveReachableFunctions_2387__wm_d5, "indexBindings": indexBindings_2398, "indexBindings__wm_d2": indexBindings_2398__wm_d2, "bindParams": bindParams_2403, "bindParams__wm_d2": bindParams_2403__wm_d2, "collectLocalBindings": collectLocalBindings_2408, "collectLocalBindings__wm_d4": collectLocalBindings_2408__wm_d4, "constantExpression": constantExpression_2418, "constantExpression__wm_d5": constantExpression_2418__wm_d5, "constantExpressions": constantExpressions_2419, "constantExpressions__wm_d5": constantExpressions_2419__wm_d5, "reifiableCaptureType": reifiableCaptureType_2438, "reifiableCaptureType__wm_d2": reifiableCaptureType_2438__wm_d2, "captureCategory": captureCategory_2448, "captureCategory__wm_d7": captureCategory_2448__wm_d7, "collectFunctionCaptures": collectFunctionCaptures_2449, "collectFunctionCaptures__wm_d10": collectFunctionCaptures_2449__wm_d10, "collectReachableCaptures": collectReachableCaptures_2468, "collectReachableCaptures__wm_d9": collectReachableCaptures_2468__wm_d9, "captureValues": captureValues_2485, "captureValues__wm_d2": captureValues_2485__wm_d2, "rootCaptures": rootCaptures_2491, "rootCaptures__wm_d7": rootCaptures_2491__wm_d7, "illegalCaptureDiagnostic": illegalCaptureDiagnostic_2506, "captureDiagnostics": captureDiagnostics_2507, "captureDiagnostics__wm_d2": captureDiagnostics_2507__wm_d2, "indexExpressions": indexExpressions_2512, "indexExpressions__wm_d2": indexExpressions_2512__wm_d2, "indexTypes": indexTypes_2517, "indexTypes__wm_d2": indexTypes_2517__wm_d2, "representationOf": representationOf_2525, "representationOf__wm_d2": representationOf_2525__wm_d2, "joinRepresentation": joinRepresentation_2528, "joinRepresentation__wm_d2": joinRepresentation_2528__wm_d2, "combinedRepresentation": combinedRepresentation_2529, "combinedRepresentation__wm_d3": combinedRepresentation_2529__wm_d3, "setRepresentation": setRepresentation_2540, "setRepresentation__wm_d3": setRepresentation_2540__wm_d3, "setRepresentations": setRepresentations_2541, "setRepresentations__wm_d4": setRepresentations_2541__wm_d4, "seedRepresentations": seedRepresentations_2550, "seedRepresentations__wm_d2": seedRepresentations_2550__wm_d2, "childTypeIds": childTypeIds_2555, "childTypeIds__wm_d3": childTypeIds_2555__wm_d3, "numericTypeIds": numericTypeIds_2562, "numericTypeIds__wm_d3": numericTypeIds_2562__wm_d3, "lastChildTypeId": lastChildTypeId_2569, "lastChildTypeId__wm_d3": lastChildTypeId_2569__wm_d3, "constraintTypeIds": constraintTypeIds_2581, "constraintTypeIds__wm_d3": constraintTypeIds_2581__wm_d3, "applyNumericGroup": applyNumericGroup_2585, "applyNumericGroup__wm_d2": applyNumericGroup_2585__wm_d2, "applyArgumentConstraints": applyArgumentConstraints_2586, "applyArgumentConstraints__wm_d6": applyArgumentConstraints_2586__wm_d6, "applyCallConstraint": applyCallConstraint_2615, "applyCallConstraint__wm_d6": applyCallConstraint_2615__wm_d6, "applyNumericConstraint": applyNumericConstraint_2623, "applyNumericConstraint__wm_d6": applyNumericConstraint_2623__wm_d6, "numericSweep": numericSweep_2624, "numericSweep__wm_d7": numericSweep_2624__wm_d7, "solveNumericRepresentations": solveNumericRepresentations_2636, "solveNumericRepresentations__wm_d6": solveNumericRepresentations_2636__wm_d6, "collectExpressionItems": collectExpressionItems_2645, "collectExpressionItems__wm_d4": collectExpressionItems_2645__wm_d4, "concreteRepresentation": concreteRepresentation_2659, "concreteRepresentation__wm_d3": concreteRepresentation_2659__wm_d3, "setTypeRepresentation": setTypeRepresentation_2665, "setTypeRepresentation__wm_d4": setTypeRepresentation_2665__wm_d4, "seedParamRepresentations": seedParamRepresentations_2666, "seedParamRepresentations__wm_d4": seedParamRepresentations_2666__wm_d4, "functionParamRepresentations": functionParamRepresentations_2677, "functionParamRepresentations__wm_d4": functionParamRepresentations_2677__wm_d4, "callArgumentRepresentations": callArgumentRepresentations_2684, "callArgumentRepresentations__wm_d5": callArgumentRepresentations_2684__wm_d5, "mergeArgumentRepresentations": mergeArgumentRepresentations_2694, "mergeArgumentRepresentations__wm_d6": mergeArgumentRepresentations_2694__wm_d6, "solveFunctionInstance": solveFunctionInstance_2708, "solveFunctionInstance__wm_d9": solveFunctionInstance_2708__wm_d9, "solveInstanceFixedPoint": solveInstanceFixedPoint_2709, "solveInstanceFixedPoint__wm_d9": solveInstanceFixedPoint_2709__wm_d9, "instanceSweep": instanceSweep_2710, "instanceSweep__wm_d10": instanceSweep_2710__wm_d10, "representationsEqual": representationsEqual_2767, "representationsEqual__wm_d2": representationsEqual_2767__wm_d2, "findSpecialization": findSpecialization_2775, "findSpecialization__wm_d3": findSpecialization_2775__wm_d3, "representationSuffix": representationSuffix_2782, "representationSuffix__wm_d2": representationSuffix_2782__wm_d2, "specializationName": specializationName_2791, "specializationName__wm_d3": specializationName_2791__wm_d3, "addTypeIds": addTypeIds_2792, "addTypeIds__wm_d2": addTypeIds_2792__wm_d2, "collectInstanceTypeIds": collectInstanceTypeIds_2797, "collectInstanceTypeIds__wm_d3": collectInstanceTypeIds_2797__wm_d3, "addParamTypeIds": addParamTypeIds_2803, "addParamTypeIds__wm_d3": addParamTypeIds_2803__wm_d3, "representationFacts": representationFacts_2809, "representationFacts__wm_d4": representationFacts_2809__wm_d4, "specializationTypeFacts": specializationTypeFacts_2825, "specializationTypeFacts__wm_d4": specializationTypeFacts_2825__wm_d4, "initialSpecializationState": initialSpecializationState_2826, "withSpecializedCall": withSpecializedCall_2829, "withSpecializedCall__wm_d2": withSpecializedCall_2829__wm_d2, "withSpecializationDiagnostic": withSpecializationDiagnostic_2832, "withSpecializationDiagnostic__wm_d2": withSpecializationDiagnostic_2832__wm_d2, "mutualRecursionDiagnostic": mutualRecursionDiagnostic_2835, "materializeSpecialization": materializeSpecialization_2836, "materializeSpecialization__wm_d10": materializeSpecialization_2836__wm_d10, "materializeSpecializedCalls": materializeSpecializedCalls_2837, "materializeSpecializedCalls__wm_d11": materializeSpecializedCalls_2837__wm_d11, "materializeRootSpecializations": materializeRootSpecializations_2887, "materializeRootSpecializations__wm_d7": materializeRootSpecializations_2887__wm_d7, "initialIrBuildState": initialIrBuildState_2904, "indexRepresentationFacts": indexRepresentationFacts_2905, "indexRepresentationFacts__wm_d2": indexRepresentationFacts_2905__wm_d2, "irRepresentation": irRepresentation_2913, "irRepresentation__wm_d2": irRepresentation_2913__wm_d2, "specializedCallTarget": specializedCallTarget_2914, "specializedCallTarget__wm_d3": specializedCallTarget_2914__wm_d3, "irValueKind": irValueKind_2924, "irValueKind__wm_d3": irValueKind_2924__wm_d3, "reifyIrExpression": reifyIrExpression_2925, "reifyIrExpression__wm_d8": reifyIrExpression_2925__wm_d8, "reifyIrChildren": reifyIrChildren_2926, "reifyIrChildren__wm_d9": reifyIrChildren_2926__wm_d9, "reifyIrParams": reifyIrParams_2956, "reifyIrParams__wm_d3": reifyIrParams_2956__wm_d3, "reifyIrSpecializations": reifyIrSpecializations_2964, "reifyIrSpecializations__wm_d6": reifyIrSpecializations_2964__wm_d6, "irFunctionValues": irFunctionValues_2983, "irFunctionValues__wm_d2": irFunctionValues_2983__wm_d2, "irExpressionValues": irExpressionValues_2989, "irExpressionValues__wm_d2": irExpressionValues_2989__wm_d2, "mergeConsensusRepresentation": mergeConsensusRepresentation_2997, "mergeConsensusRepresentation__wm_d2": mergeConsensusRepresentation_2997__wm_d2, "addConsensusFacts": addConsensusFacts_2998, "addConsensusFacts__wm_d2": addConsensusFacts_2998__wm_d2, "specializationConsensus": specializationConsensus_3004, "specializationConsensus__wm_d2": specializationConsensus_3004__wm_d2, "refinedType": refinedType_3014, "refinedType__wm_d2": refinedType_3014__wm_d2, "compileGpu": compileGpu_3038, "compileGpuSlice": compileGpuSlice_3041, "elaborateGpuSliceTypes": elaborateGpuSliceTypes_3044 };
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