import type { Module } from "../src/ast.ts";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { normalizeFrontendSemanticAstWithSpans } from "../src/frontend_v2_compare.ts";
import { trackedWmFiles } from "../scripts/tracked_wm_files.ts";

type FrontendV2SemanticGolden = Readonly<{
  schemaVersion: 1;
  provenance: string;
  files: Readonly<Record<string, string | null>>;
}>;

const goldenUrl = new URL(
  "./generated/frontend_v2_semantic_golden.json",
  import.meta.url,
);
const parsed = JSON.parse(await Deno.readTextFile(goldenUrl)) as FrontendV2SemanticGolden;
if (parsed.schemaVersion !== 1 || typeof parsed.files !== "object") {
  throw new Error("unsupported frontend-v2 semantic golden");
}

export const frontendV2SemanticGolden = Object.freeze(parsed);

/** Include explicitly baselined new modules even before they are staged in Git. */
export async function semanticGoldenFiles(root: URL): Promise<string[]> {
  const directory = fileURLToPath(root);
  const baselined = Object.keys(frontendV2SemanticGolden.files)
    .map((path) => fileURLToPath(new URL(`../${path}`, import.meta.url)))
    .filter((path) => path.startsWith(directory));
  return [...new Set([...await trackedWmFiles(root), ...baselined].map((path) => resolve(path)))]
    .sort();
}

export function repositoryWmPath(path: string): string {
  const root = fileURLToPath(new URL("../", import.meta.url));
  if (!path.startsWith(root)) throw new Error(`path is outside repository: ${path}`);
  return path.slice(root.length).replaceAll("\\", "/");
}

export async function hashFrontendSemanticWithSpans(module: Module): Promise<string> {
  const value = normalizeFrontendSemanticAstWithSpans(module);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
