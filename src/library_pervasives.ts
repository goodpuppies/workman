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
  ...["getOr", "isSome"].map((name) =>
    Object.freeze({ modulePath: "subml-basis/subset_option.wm", name })
  ),
  ...["before", "ignore", "o"].map((name) => Object.freeze({ modulePath: "std/general.wm", name })),
  ...["ceil", "floor", "round", "trunc"].map((name) =>
    Object.freeze({ modulePath: "std/real.wm", name })
  ),
  Object.freeze({ modulePath: "std/vector.wm", name: "vector", sourceName: "fromList" }),
]);

export function pervasiveSourceName(binding: (typeof LIBRARY_PERVASIVES)[number]): string {
  return binding.sourceName ?? binding.name;
}
