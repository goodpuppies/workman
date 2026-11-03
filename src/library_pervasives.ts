/**
 * Default unqualified library values. Portable operations belong to the shared SubsetML Basis;
 * std contributes only existing extra facilities. The kernel profile does not install this table.
 * Names project the defining values, without wrappers or separately maintained type schemes.
 */
export const LIBRARY_PERVASIVES: readonly Readonly<{
  modulePath: string;
  name: string;
  sourceName?: string;
}>[] = Object.freeze([
  ...[
    "map",
    "filter",
    "forEach",
    "foldLeft",
    "foldRight",
    "head",
    "tail",
    "length",
    "isEmpty",
    "reverse",
    "concat",
  ].map((name) => Object.freeze({ modulePath: "subml-basis/subset_list.wm", name })),
  ...["getOr", "isSome", "toResult"].map((name) =>
    Object.freeze({ modulePath: "subml-basis/subset_option.wm", name })
  ),
  Object.freeze({ modulePath: "subml-basis/subset_bool.wm", name: "not" }),
  ...["Less", "Equal", "Greater"].map((name) =>
    Object.freeze({ modulePath: "subml-basis/subset_order.wm", name })
  ),
  Object.freeze({ modulePath: "subml-basis/subset_char.wm", name: "chr", sourceName: "fromCode" }),
  Object.freeze({ modulePath: "subml-basis/subset_char.wm", name: "ord", sourceName: "toCode" }),
  Object.freeze({
    modulePath: "subml-basis/subset_string.wm",
    name: "explode",
    sourceName: "fromNative",
  }),
  Object.freeze({
    modulePath: "subml-basis/subset_string.wm",
    name: "implode",
    sourceName: "toNative",
  }),
  ...["size", "str"].map((name) =>
    Object.freeze({ modulePath: "subml-basis/subset_string.wm", name })
  ),
  ...["before", "ignore", "o"].map((name) => Object.freeze({ modulePath: "std/general.wm", name })),
  ...["ceil", "floor", "round", "trunc"].map((name) =>
    Object.freeze({ modulePath: "std/real.wm", name })
  ),
  Object.freeze({ modulePath: "std/vector.wm", name: "vector", sourceName: "fromList" }),
  Object.freeze({ modulePath: "std/string.wm", name: "toList" }),
]);

/** Type projections use the same named-import semantics, but have no runtime aliases. */
export const LIBRARY_PERVASIVE_TYPES = Object.freeze([
  Object.freeze({ modulePath: "subml-basis/subset_order.wm", name: "Order" }),
]);

export function pervasiveSourceName(binding: (typeof LIBRARY_PERVASIVES)[number]): string {
  return binding.sourceName ?? binding.name;
}
