import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";
import type { JsTarget, Module } from "./ast.ts";

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
  if (Deno.build.os === "windows" && /^\/[A-Za-z]:[\\/]/.test(specifier)) {
    return specifier.slice(1);
  }
  return specifier;
}
