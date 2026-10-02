// Primitives of `host/js/table.wm`. A `Js.Table` is a JavaScript `Map` with string or number keys.
// `lookup` gives `undefined` for a missing key and `present` tells the two apart, so this file
// doesn't depend on how the compiler represents `Option`. Neither takes a callback: a callback
// parameter needs an FFI adapter on every call, and these are on the self-hosted parser's hot path.

export const empty = () => new Map();

export const lookup = (table, key) => table.get(key);

export const present = (value) => value != null;

export const set = (table, key, value) => {
  table.set(key, value);
};
