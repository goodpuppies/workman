import type { StaticEnv } from "../infer/environment.ts";
import { basisCtorId } from "../basis.ts";
import { prune, type Ty } from "../types.ts";

/** Only representation changes are retained. null means the WM/JS value is unchanged. */
export type JsAbiShape =
  | null
  | ["fn", number, JsAbiShape[], JsAbiShape]
  | ["tuple", JsAbiShape[]]
  | ["result" | "task", JsAbiShape, JsAbiShape]
  | ["option", JsAbiShape]
  | ["record", [string, JsAbiShape][]];

/** The outer tuple is an argument list; tuple components and results remain tuple values. */
export function functionArguments(type: Extract<Ty, { tag: "fn" }>): Ty[] {
  if (type.params.length !== 1) return type.params;
  const parameter = prune(type.params[0]);
  if (parameter.tag === "prim" && parameter.name === "Void") return [];
  return parameter.tag === "tuple" ? parameter.items : type.params;
}

export function jsAbiShape(input: Ty, visiting = new Set<Ty>()): JsAbiShape {
  const type = prune(input);
  if (visiting.has(type)) return null;
  const nested = new Set(visiting).add(type);
  const shape = (item: Ty) => jsAbiShape(item, nested);
  switch (type.tag) {
    case "fn": {
      const args = functionArguments(type).map(shape);
      const result = shape(type.result);
      return args.length === 1 && args[0] === null && result === null
        ? null
        : ["fn", args.length, args, result];
    }
    case "tuple": {
      const items = type.items.map(shape);
      return items.every((item) => item === null) ? null : ["tuple", items];
    }
    case "struct":
      return recordShape(type.fields.map((field) => [field.name, shape(field.type)]));
    case "named":
      if (type.definition?.basis && type.name === "Option") {
        const payload = shape(type.args[0]);
        return payload === null ? null : ["option", payload];
      }
      if (type.definition?.basis && (type.name === "Result" || type.name === "Task")) {
        return [type.name === "Task" ? "task" : "result", ...type.args.map(shape)] as [
          "result" | "task",
          JsAbiShape,
          JsAbiShape,
        ];
      }
      return null;
    default:
      return null;
  }
}

function recordShape(fields: [string, JsAbiShape][]): JsAbiShape {
  const changed = fields.filter(([, shape]) => shape !== null);
  return changed.length ? ["record", changed] : null;
}

export function structureAbiShape(environment: StaticEnv): JsAbiShape {
  return recordShape([
    ...[...environment.valEnv].map((
      [name, scheme],
    ): [string, JsAbiShape] => [name, jsAbiShape(scheme.type)]),
    ...[...environment.strEnv].map((
      [name, structure],
    ): [string, JsAbiShape] => [name, structureAbiShape(structure)]),
  ]);
}

/** Runtime for the public positional ABI. WM's generic entry remains single-argument. */
export function emitJsAbiRuntime(): string {
  return `const __wm_abi_origin = Symbol.for("wm.jsAbi.v1.origin");
const __wm_abi_out = new WeakMap();
const __wm_abi_in = new WeakMap();
const __wm_abi_convert = (value, shape, outward) => {
  if (shape === null) return value;
  const convert = (item, descriptor, direction = outward) => __wm_abi_convert(item, descriptor, direction);
  if (shape[0] === "option") {
    // Options cross as opaque WM values; only a payload with another representation changes.
    // None is the shared singleton (see emit_prelude.ts), so identity matching holds on both sides.
    if (value === __wm_basis_None) return value;
    if (value?.ctor === ${basisCtorId("Some")}) return __wm_basis_Some(convert(value.a0, shape[1]));
    throw new TypeError("Invalid Workman Option at the JavaScript boundary");
  }
  if (shape[0] === "task") {
    return Promise.resolve(value).then(item => convert(item, ["result", shape[1], shape[2]]));
  }
  if (shape[0] === "result") {
    if (outward) {
      if (value.ctor === ${
    basisCtorId("Ok")
  }) return { ok: true, value: convert(value.a0, shape[1]) };
      if (value.ctor === ${
    basisCtorId("Err")
  }) return { ok: false, error: convert(value.a0, shape[2]) };
    } else {
      if (value.ok === true) return __wm_basis_Ok(convert(value.value, shape[1]));
      if (value.ok === false) return __wm_basis_Err(convert(value.error, shape[2]));
    }
    throw new TypeError("Invalid Workman Result at the JavaScript boundary");
  }
  // Containers may be mutable on the JS side: refresh their contents on every crossing.
  // Cache only functions, whose adapters must preserve aliases and callback identity.
  if (shape[0] === "tuple") {
    return value.map((item, index) => convert(item, shape[1][index] ?? null));
  }
  if (shape[0] === "record") {
    const result = { ...value };
    shape[1].forEach(([name, item]) => { result[name] = convert(value[name], item); });
    return result;
  }
  const key = JSON.stringify(shape);
  const origin = value?.[__wm_abi_origin];
  if (origin && origin.key === key && origin.outward !== outward) return origin.value;
  const cache = outward ? __wm_abi_out : __wm_abi_in;
  let entries = cache.get(value);
  if (entries?.has(key)) return entries.get(key);
  if (!entries) { entries = new Map(); cache.set(value, entries); }
  const [, arity, parameters, resultShape] = shape;
  const fast = outward && value[Symbol.for("wm.tupleEntry.v1." + arity)];
  const simple = parameters.every(item => item === null) && resultShape === null;
  // The common tuple-function export is the emitted positional implementation itself.
  if (fast && simple) {
    entries.set(key, fast);
    if (!fast[__wm_abi_origin]) Object.defineProperty(fast, __wm_abi_origin, {
      value: { key, value, outward }
    });
    return fast;
  }
  const converted = outward ? (...args) => {
    const supplied = parameters.map((item, index) => convert(args[index], item, false));
    const result = fast ? fast(...supplied) : value(arity === 0 ? undefined : arity === 1 ? supplied[0] : supplied);
    return convert(result, resultShape, true);
  } : (argument) => {
    const supplied = arity === 0 ? [] : arity === 1 ? [argument] : argument;
    const args = parameters.map((item, index) => convert(supplied[index], item, true));
    return convert(value(...args), resultShape, false);
  };
  Object.defineProperty(converted, "length", { value: outward ? arity : 1 });
  Object.defineProperty(converted, __wm_abi_origin, { value: { key, value, outward } });
  if (!outward && simple && arity >= 2) {
    Object.defineProperty(converted, Symbol.for("wm.tupleEntry.v1." + arity), { value });
  }
  entries.set(key, converted);
  return converted;
};`;
}
