// Import-only host helper modules (BD17). `from js.host("table") import * as Table;` is projected
// to an ordinary `ImportDecl` whose path carries this prefix, and the module graph resolves that
// path to the library module `host/js/table.wm`.

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
