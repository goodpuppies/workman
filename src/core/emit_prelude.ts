import { basisCtorId, basisCtorJsName, basisTypes } from "../basis.ts";

export function emitRuntimePrelude(): string[] {
  return [
    '"use strict";',
    "const __wm_tuple_tag = Symbol('wm.tuple');",
    "const __wm_tuple = (...items) => { items[__wm_tuple_tag] = true; return items; };",
    "const __wm_is_tuple = (value) => globalThis.Array.isArray(value) && value[__wm_tuple_tag] === true;",
    `const __wm_js_global = (path) => path.split(".").reduce((value, key) => value?.[key], globalThis);`,
    `const __wm_js_should_bind = (value) =>
  typeof value === "function" && !/^class\\s/.test(Function.prototype.toString.call(value));`,
    `const __wm_js_member = (path) => {
  const parts = path.split(".");
  const key = parts.pop();
  const owner = parts.length === 0 ? globalThis : __wm_js_global(parts.join("."));
  const value = owner?.[key];
  return __wm_js_should_bind(value) ? value.bind(owner) : value;
};`,
    `const __wm_js_member_obj = (owner, key) => {
  const value = owner?.[key];
  return __wm_js_should_bind(value) ? value.bind(owner) : value;
};`,
    `const __wm_js_receiver_member = (path) => (receiver, ...args) => {
  const owner = path.slice(0, -1).reduce((value, key) => value?.[key], receiver);
  const value = owner?.[path[path.length - 1]];
  return typeof value === "function" ? value.apply(owner, args) : value;
};`,
    `const __wm_js_construct = (path) => (...args) => new (__wm_js_global(path))(...args);`,
    `const __wm_js_call = (fn, arg) => __wm_is_tuple(arg) ? fn(...arg) : fn(arg);`,
    `const __wm_js_option_wrap = (value) => value == null ? __wm_basis_None : __wm_basis_Some(value);`,
    `const __wm_js_option_unwrap = (value) => value?.ctor === -1 ? undefined : value?.ctor === -2 ? value.args[0] : value;`,
    `const __wm_js_to_workman = (value, converter) => {
  if (converter === "option") return __wm_js_option_wrap(value);
  if (typeof converter === "object" && converter.kind === "fn") {
    return (...args) => __wm_js_to_workman(
      value(...args.map((arg, index) => __wm_js_to_js(arg, converter.params[index] ?? "id"))),
      converter.result,
    );
  }
  return value;
};`,
    `const __wm_js_to_js = (value, converter) => {
  if (converter === "option") return __wm_js_option_unwrap(value);
  if (typeof converter === "object" && converter.kind === "fn") {
    return (...args) => {
      const converted = args.map((arg, index) => __wm_js_to_workman(arg, converter.params[index] ?? "id"));
      const expected = converter.params.length;
      const limited = converted.slice(0, expected);
      const workmanArg = limited.length === 0 ? undefined : limited.length === 1 ? limited[0] : __wm_tuple(...limited);
      return __wm_js_to_js(
        value(workmanArg),
        converter.result,
      );
    };
  }
  return value;
};`,
    `const __wm_js_apply = (fn, arg, converters, resultConverter, fallible) => {
  const raw = converters.length === 0 ? [] : converters.length === 1 ? [arg] : (__wm_is_tuple(arg) ? Array.from(arg) : [arg]);
  const args = raw.map((value, index) => __wm_js_to_js(value, converters[index] ?? "id"));
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
    `const __wm_show = (value, seen = new WeakSet()) => {
  if (value === undefined) return "void";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "function") return "<function>";
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "<cycle>";
  seen.add(value);
  let shown;
  if (__wm_is_tuple(value)) {
    shown = "(" + value.map((item) => __wm_show(item, seen)).join(", ") + ")";
  } else if ("ctor" in value) {
    shown = value.args.length === 0
      ? value.name
      : value.name + "(" + value.args.map((item) => {
        if (__wm_is_tuple(item)) return item.map((part) => __wm_show(part, seen)).join(", ");
        return __wm_show(item, seen);
      }).join(", ") + ")";
  } else if (globalThis.Array.isArray(value)) {
    shown = "[" + value.map((item) => __wm_show(item, seen)).join(", ") + "]";
  } else {
    shown = "{ " + Object.keys(value).sort().map((key) => key + " = " + __wm_show(value[key], seen)).join(", ") + " }";
  }
  seen.delete(value);
  return shown;
};`,
    "const print = (value) => console.log(__wm_show(value));",
    `const __wm_text_of = (value) => {
  try {
    return value.toString();
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
    `const __wm_array_to_list = (items) => {
  let list = __wm_basis_Nil;
  for (let index = items.length - 1; index >= 0; index--) {
    list = __wm_basis_Cons(__wm_tuple(items[index], list));
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
  return items;
};`,
    `const Js = {
  Array: {
    toList: __wm_array_to_list,
    fromList: __wm_list_to_array,
  },
};`,
    `const Monad = {
  lift: (x) => (f) => x.fn(f),
};`,
    `const List = {
  map: ([items, fn]) => {
    const mapped = [];
    let cursor = items;
    while (cursor?.ctor === ${basisCtorId("Cons")}) {
      const [item, rest] = cursor.args[0];
      mapped.push(fn(item));
      cursor = rest;
    }
    return __wm_array_to_list(mapped);
  },
  foldRight: ([items, initial, fn]) => {
    const values = [];
    let cursor = items;
    while (cursor?.ctor === ${basisCtorId("Cons")}) {
      const [item, rest] = cursor.args[0];
      values.push(item);
      cursor = rest;
    }
    let acc = initial;
    for (let index = values.length - 1; index >= 0; index--) {
      acc = fn(__wm_tuple(values[index], acc));
    }
    return acc;
  },
  collectWith: ([empty, combine, items]) => List.foldRight(__wm_tuple(items, empty, combine)),
};`,
    `const __wm_result_mapN = (args) => {
  const fn = args[args.length - 1];
  const values = [];
  for (const result of args.slice(0, -1)) {
    if (result.ctor !== ${basisCtorId("Ok")}) return result;
    values.push(result.args[0]);
  }
  return __wm_basis_Ok(fn(__wm_tuple(...values)));
};`,
    `const Result = {
  fn: (fn) => (result) => Result.andThen(__wm_tuple(result, fn)),
  map: ([result, fn]) => result.ctor === ${
      basisCtorId("Ok")
    } ? __wm_basis_Ok(fn(result.args[0])) : result,
  map2: __wm_result_mapN,
  map3: __wm_result_mapN,
  map4: __wm_result_mapN,
  andThen: ([result, fn]) => result.ctor === ${basisCtorId("Ok")} ? fn(result.args[0]) : result,
  mapErr: ([result, fn]) => result.ctor === ${
      basisCtorId("Err")
    } ? __wm_basis_Err(fn(result.args[0])) : result,
  textOf: __wm_text_of,
  withDefault: ([result, fallback]) => result.ctor === ${
      basisCtorId("Ok")
    } ? result.args[0] : fallback,
  all: (results) => {
    const values = [];
    for (const result of results) {
      if (result.ctor !== ${basisCtorId("Ok")}) return result;
      values.push(result.args[0]);
    }
    return __wm_basis_Ok(values);
  },
  collectList: (results) => {
    const values = [];
    let cursor = results;
    while (cursor?.ctor === ${basisCtorId("Cons")}) {
      const [result, rest] = cursor.args[0];
      if (result.ctor !== ${basisCtorId("Ok")}) return result;
      values.push(result.args[0]);
      cursor = rest;
    }
    return __wm_basis_Ok(__wm_array_to_list(values));
  },
  traverse: ([items, fn]) => {
    const values = [];
    let cursor = items;
    while (cursor?.ctor === ${basisCtorId("Cons")}) {
      const [item, rest] = cursor.args[0];
      const result = fn(item);
      if (result.ctor !== ${basisCtorId("Ok")}) return result;
      values.push(result.args[0]);
      cursor = rest;
    }
    return __wm_basis_Ok(__wm_array_to_list(values));
  },
};`,
    `const Option = {
  map: ([option, fn]) => option.ctor === ${
      basisCtorId("Some")
    } ? __wm_basis_Some(fn(option.args[0])) : option,
  andThen: ([option, fn]) => option.ctor === ${basisCtorId("Some")} ? fn(option.args[0]) : option,
  withDefault: ([option, fallback]) => option.ctor === ${
      basisCtorId("Some")
    } ? option.args[0] : fallback,
  map2: ([left, right, fn]) => left.ctor === ${basisCtorId("Some")} && right.ctor === ${
      basisCtorId("Some")
    } ? __wm_basis_Some(fn(__wm_tuple(left.args[0], right.args[0]))) : __wm_basis_None,
  collectList: (options) => {
    const values = [];
    let cursor = options;
    while (cursor?.ctor === ${basisCtorId("Cons")}) {
      const [option, rest] = cursor.args[0];
      if (option.ctor !== ${basisCtorId("Some")}) return __wm_basis_None;
      values.push(option.args[0]);
      cursor = rest;
    }
    return __wm_basis_Some(__wm_array_to_list(values));
  },
  traverse: ([items, fn]) => Option.collectList(List.map(__wm_tuple(items, fn))),
};`,
    `const __wm_error_message = (error) => {
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error);
};`,
    `const Task = {
  fn: (fn) => (task) => Task.andThen(__wm_tuple(task, fn)),
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
    return __wm_basis_Ok(fn(__wm_tuple(left.args[0], right.args[0])));
  }),
  andThen: ([task, fn]) => Promise.resolve(task).then((result) =>
    result.ctor === ${basisCtorId("Ok")} ? fn(result.args[0]) : result
  ),
  mapErr: ([task, fn]) => Promise.resolve(task).then((result) =>
    result.ctor === ${basisCtorId("Err")} ? __wm_basis_Err(fn(result.args[0])) : result
  ),
  recover: ([task, fn]) => Promise.resolve(task).then((result) =>
    result.ctor === ${basisCtorId("Err")} ? __wm_basis_Ok(fn(result.args[0])) : result
  ),
  all: (tasks) => Promise.all(tasks).then((results) => {
    const values = [];
    for (const result of results) {
      if (result.ctor !== ${basisCtorId("Ok")}) return result;
      values.push(result.args[0]);
    }
    return __wm_basis_Ok(values);
  }),
  collectList: (tasks) => Promise.all(__wm_list_to_array(tasks)).then((results) => {
    const values = [];
    for (const result of results) {
      if (result.ctor !== ${basisCtorId("Ok")}) return result;
      values.push(result.args[0]);
    }
    return __wm_basis_Ok(__wm_array_to_list(values));
  }),
  traverse: ([items, fn]) => {
    const values = [];
    const loop = (cursor) => {
      if (cursor?.ctor !== ${
      basisCtorId("Cons")
    }) return Promise.resolve(__wm_basis_Ok(__wm_array_to_list(values)));
      const [item, rest] = cursor.args[0];
      return Promise.resolve(fn(item)).then((result) => {
        if (result.ctor !== ${basisCtorId("Ok")}) return result;
        values.push(result.args[0]);
        return loop(rest);
      });
    }
    return loop(items);
  },
};`,
    "const __wm_op_concat = ([a, b]) => a + b;",
    "const __wm_op_add = ([a, b]) => a + b;",
    "const __wm_op_sub = (x) => __wm_is_tuple(x) ? x[0] - x[1] : -x;",
    "const __wm_op_mul = ([a, b]) => a * b;",
    "const __wm_op_div = ([a, b]) => a / b;",
    "const __wm_op_mod = ([a, b]) => a % b;",
    "const __wm_op_eq = ([a, b]) => __wm_eq(a, b);",
    "const __wm_op_ne = ([a, b]) => !__wm_eq(a, b);",
    "const __wm_op_lt = ([a, b]) => a < b;",
    "const __wm_op_lte = ([a, b]) => a <= b;",
    "const __wm_op_gt = ([a, b]) => a > b;",
    "const __wm_op_gte = ([a, b]) => a >= b;",
    "const __wm_op_and = ([a, b]) => a && b;",
    "const __wm_op_or = ([a, b]) => a || b;",
    "const __wm_op_not = (x) => !x;",
  ];
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
