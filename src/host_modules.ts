// Import specifiers that name library modules rather than files.
//
// - `from js.host("table") import * as Table;` is projected to an ordinary `ImportDecl` whose path
//   carries `JS_HOST_IMPORT_PREFIX`, naming the import-only host helper `host/js/table.wm` (BD17).
// - `from "std/result.wm"` names `std/result.wm`.
// - `from "basis/won.wm"` names the SubsetML Basis module `subml-basis/subset_won.wm`.
//
// The module graph resolves these to library modules; a local folder of the same name is imported
// with an explicit relative path (`"./basis/..."`).

export const JS_HOST_IMPORT_PREFIX = "js.host:";

/** The host module name of a `js.host` import path, or `undefined` for a file import. */
export function jsHostImportName(path: string): string | undefined {
  return path.startsWith(JS_HOST_IMPORT_PREFIX)
    ? path.slice(JS_HOST_IMPORT_PREFIX.length)
    : undefined;
}

/** Library path of the host module that `js.host(name)` names. */
export function jsHostModulePath(name: string): string {
  return `host/js/${name}.wm`;
}

/** A library module named by an import specifier, with how to describe it in errors. */
export type LibraryImport = { path: string; description: string };

/** The library module an import specifier names, or `undefined` for a file import. */
export function libraryImport(specifier: string): LibraryImport | undefined {
  const host = jsHostImportName(specifier);
  if (host !== undefined) {
    return {
      path: jsHostModulePath(host),
      description: `host module js.host(${JSON.stringify(host)})`,
    };
  }
  const std = /^std\/([a-z][a-z0-9_]*\.wm)$/.exec(specifier);
  const c = /^host\/c\/([a-z][a-z0-9_]*\.wm)$/.exec(specifier);
  if (c) return { path: `host/c/${c[1]}`, description: `C host module "${specifier}"` };
  if (std) return { path: `std/${std[1]}`, description: `library module "${specifier}"` };
  const pakman = /^pakman\/([a-z][a-z0-9_]*\.wm)$/.exec(specifier);
  if (pakman) return { path: `pakman/${pakman[1]}`, description: `pakman module "${specifier}"` };
  const basis = /^basis\/([a-z][a-z0-9_]*\.wm)$/.exec(specifier);
  if (basis) {
    return { path: `subml-basis/subset_${basis[1]}`, description: `Basis module "${specifier}"` };
  }
  return undefined;
}
