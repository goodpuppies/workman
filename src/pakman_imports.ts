import { fileURLToPath } from "node:url";

/** Stable package API imports, independent of a recipe's checkout location. */
export function pakmanImport(specifier: string): string | undefined {
  if (!specifier.startsWith("pakman/")) return undefined;
  const relative = specifier.slice("pakman/".length);
  if (!/^[a-z][a-z0-9-]*\.wm$/.test(relative)) {
    throw new Error(`invalid pakman API import ${specifier}`);
  }
  return fileURLToPath(new URL(`../tooling/pakman/src/${relative}`, import.meta.url));
}
