import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute, posix, resolve } from "node:path";
import type { JsTarget, Module } from "./ast.ts";
import { runtime } from "./io.ts";
import { libraryJsSources } from "./generated/assets.ts";

/**
 * Specifier prefix of a library module's JavaScript primitive file, followed by its
 * repository-relative path (`wm-library:basis/js/word8_vector.js`). The library is embedded in the
 * compiler rather than read from disk, so emission inlines the file's source as a `data:` URL.
 */
export const LIBRARY_JS_SCHEME = "wm-library:";

/** Rewrite a library module's relative JS specifiers to `wm-library:` specifiers. */
export function resolveLibraryJsModuleSpecifiers(module: Module, libraryPath: string): Module {
  const decls = module.decls.map((decl) => {
    if (
      decl.kind !== "JsImportDecl" || decl.target.kind !== "JsModule" ||
      !isLocalPathSpecifier(decl.target.specifier)
    ) return decl;
    const path = posix.normalize(posix.join(posix.dirname(libraryPath), decl.target.specifier));
    return { ...decl, target: { ...decl.target, specifier: `${LIBRARY_JS_SCHEME}${path}` } };
  });
  return { ...module, decls };
}

export function resolveLocalJsModuleSpecifiers(module: Module, fromPath?: string): Module {
  if (!fromPath) return module;
  const decls = module.decls.map((decl) =>
    decl.kind === "JsImportDecl"
      ? { ...decl, target: resolveJsTarget(decl.target, fromPath) }
      : decl
  );
  return { ...module, decls };
}

export function runtimeJsModuleSpecifier(specifier: string): string {
  if (specifier.startsWith(LIBRARY_JS_SCHEME)) {
    const path = specifier.slice(LIBRARY_JS_SCHEME.length);
    const source = libraryJsSources[path];
    if (source === undefined) throw new Error(`missing library JavaScript file ${path}`);
    return `data:text/javascript,${encodeURIComponent(source)}`;
  }
  if (!isAbsolutePathSpecifier(specifier)) return specifier;
  return pathToFileURL(normalizePathSpecifier(specifier)).href;
}

function resolveJsTarget(target: JsTarget, fromPath: string): JsTarget {
  if (
    (target.kind !== "JsModule" && target.kind !== "JsWorker") ||
    !isLocalPathSpecifier(target.specifier)
  ) {
    return target;
  }
  return {
    ...target,
    specifier: resolve(dirname(normalizePathSpecifier(fromPath)), target.specifier),
  };
}

function isLocalPathSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") ||
    isAbsolutePathSpecifier(specifier);
}

function isAbsolutePathSpecifier(specifier: string): boolean {
  return isAbsolute(normalizePathSpecifier(specifier)) || /^\/[A-Za-z]:[\\/]/.test(specifier);
}

function normalizePathSpecifier(specifier: string): string {
  if (specifier.startsWith("file:")) return fileURLToPath(specifier);
  if (runtime.platform === "win32" && /^\/[A-Za-z]:[\\/]/.test(specifier)) {
    return specifier.slice(1);
  }
  return specifier;
}
