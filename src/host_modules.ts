// Import specifiers that name library modules rather than files.
//
// - `from js.host("table") import * as Table;` is projected to an ordinary `ImportDecl` whose path
//   carries `JS_HOST_IMPORT_PREFIX`, naming the import-only host helper `host/js/table.wm` (BD17).
// - `from "testman/test.wm"` names `tooling/testman/test.wm`.
// - `from "pakman/model.wm"` names `tooling/pakman/api/model.wm`.
// - `from "std/result.wm"` names `std/result.wm`.
// - `from "basis/won.wm"` names the SubsetML Basis module `subml-basis/subset_won.wm`.
//
// The module graph resolves these to library modules; a local folder of the same name is imported
// with an explicit relative path (`"./basis/..."`). The rules are SubsetML's `WmModuleScope`
// (src/module_scope.wm), which SubsetML's WM reader shares.

// Programs that wm builds import this file at run time (pakman's host), without this repository's
// import map, so it imports the built artifact of module_scope.wm rather than the `.wm` module.
import * as moduleScope from "./generated/wm/src/module_scope.wm.js";
// @ts-types="./integrations/interop.d.mts"
import { type Option, toNullable } from "./integrations/interop.mjs";

const {
  jsHostImportPrefix,
  jsHostModulePath: sharedJsHostModulePath,
  libraryImport: sharedLibraryImport,
} = moduleScope as {
  jsHostImportPrefix: string;
  jsHostModulePath: (name: string) => string;
  libraryImport: (specifier: string) => Option<LibraryImport>;
};

export const JS_HOST_IMPORT_PREFIX: string = jsHostImportPrefix;

/** The host module name of a `js.host` import path, or `undefined` for a file import. */
export function jsHostImportName(path: string): string | undefined {
  return path.startsWith(JS_HOST_IMPORT_PREFIX)
    ? path.slice(JS_HOST_IMPORT_PREFIX.length)
    : undefined;
}

/** Library path of the host module that `js.host(name)` names. */
export function jsHostModulePath(name: string): string {
  return sharedJsHostModulePath(name);
}

/** A library module named by an import specifier, with how to describe it in errors. */
export type LibraryImport = { path: string; description: string };

/** The library module an import specifier names, or `undefined` for a file import. */
export function libraryImport(specifier: string): LibraryImport | undefined {
  // Host names are opaque JS strings, including Unicode; preserve them and quote diagnostics
  // at this boundary. The shared portable resolver classifies byte-string module file names.
  const host = jsHostImportName(specifier);
  if (host !== undefined) {
    return {
      path: jsHostModulePath(host),
      description: `host module js.host(${JSON.stringify(host)})`,
    };
  }
  return toNullable(sharedLibraryImport(specifier));
}
