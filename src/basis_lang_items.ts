/** Compiler-recognized source types. Their declarations live in the shared Basis. */
export const BASIS_LANG_ITEMS = Object.freeze(
  [
    {
      name: "Option",
      typeNameId: -10,
      arity: 1,
      firstConstructorId: -1,
      lastConstructorId: -2,
      source: "subml-basis/subset_option_value.wm",
    },
    {
      name: "Result",
      typeNameId: -11,
      arity: 2,
      firstConstructorId: -3,
      lastConstructorId: -4,
      source: "subml-basis/subset_result_value.wm",
    },
  ] as const,
);
