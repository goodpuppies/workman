import { pervasives, pervasiveTypes } from "./module_scope.wm";

type Pervasive = Readonly<{ modulePath: string; name: string; sourceName?: string }>;

/**
 * Default unqualified library values. Portable operations belong to the shared SubsetML Basis;
 * std contributes only existing extra facilities. The kernel profile does not install this table.
 * Names project the defining values, without wrappers or separately maintained type schemes. The
 * table is SubsetML's `WmModuleScope.pervasives` (src/module_scope.wm), which its WM reader shares.
 */
export const LIBRARY_PERVASIVES: readonly Pervasive[] = Object.freeze(
  (pervasives as Pervasive[]).map((binding) => Object.freeze({ ...binding })),
);

/**
 * `@gpu` code can't call host library values, and these names (`floor`, `length`) would otherwise hide
 * the GPU builtins of the same name. Anything the program bound or imported itself stays in scope.
 */
export function hideLibraryPervasives(env: Map<string, { standardLibrary?: boolean }>): void {
  for (const { name } of LIBRARY_PERVASIVES) {
    if (env.get(name)?.standardLibrary) env.delete(name);
  }
}

/**
 * Type projections use the same named-import semantics, but have no runtime aliases. The carrier
 * records are here so a `.{ succeed, map, … }` literal finds them by its fields without an import
 * (field-based record inference only considers library records in scope unqualified).
 */
export const LIBRARY_PERVASIVE_TYPES: readonly Pervasive[] = Object.freeze(
  (pervasiveTypes as Pervasive[]).map((binding) => Object.freeze({ ...binding })),
);

export function pervasiveSourceName(binding: (typeof LIBRARY_PERVASIVES)[number]): string {
  return binding.sourceName ?? binding.name;
}
