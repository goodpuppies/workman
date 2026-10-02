// Primitives of `host/js/dict.wm`. A `Js.Dict` is a plain JavaScript object used as a string-keyed
// map, so it can cross the FFI boundary. `lookup` gives `undefined` for a missing key and `present`
// tells the two apart, so this file doesn't depend on how the compiler represents `Option`.

export const empty = () => ({});

export const lookup = (dict, key) => (Object.hasOwn(dict, key) ? dict[key] : undefined);

export const present = (value) => value != null;

export const set = (dict, key, value) => {
  dict[key] = value;
};
