import { normalizeFrontendSemanticAstWithSpans } from "../src/frontend_v2_compare.ts";
import { decodeSurfaceProgram } from "../src/frontend_v2_surface_loader.ts";
import { surfaceProgramToModule } from "../src/frontend_v2_surface_semantic.ts";

const parser = await import("../src/generated/frontend_v2_parser.js") as {
  parseSurfaceProgram(source: string): unknown;
};

const outputUrl = new URL(
  "../tests/generated/frontend_v2_semantic_golden.json",
  import.meta.url,
);
const roots = [
  ["std", new URL("../std/", import.meta.url)],
  ["examples", new URL("../examples/", import.meta.url)],
  ["tooling", new URL("../tooling/", import.meta.url)],
] as const;

const files: Record<string, string | null> = {};
for (const [name, root] of roots) {
  for (const entry of await wmFiles(root, name)) {
    const source = await Deno.readTextFile(entry.url);
    const surface = decodeSurfaceProgram(parser.parseSurfaceProgram(source));
    if (!surface) {
      files[entry.relative] = null;
      continue;
    }
    const projected = surfaceProgramToModule(surface, source);
    if (projected.diagnostics.length > 0) {
      throw new Error(
        `${entry.relative}: ${
          projected.diagnostics.map((diagnostic) => diagnostic.message).join("; ")
        }`,
      );
    }
    files[entry.relative] = await hashValue(
      normalizeFrontendSemanticAstWithSpans(projected.module),
    );
  }
}

const golden = {
  schemaVersion: 1,
  provenance:
    "Initial hashes captured from the Workman Peggy semantic/span projection before executable-oracle retirement.",
  files,
};
await Deno.writeTextFile(outputUrl, JSON.stringify(golden, null, 2) + "\n");

async function wmFiles(
  root: URL,
  prefix: string,
): Promise<readonly Readonly<{ relative: string; url: URL }>[]> {
  const output: { relative: string; url: URL }[] = [];
  for await (const entry of Deno.readDir(root)) {
    const relative = `${prefix}/${entry.name}`;
    const url = new URL(entry.name + (entry.isDirectory ? "/" : ""), root);
    if (entry.isDirectory) {
      output.push(...await wmFiles(url, relative));
    } else if (entry.isFile && entry.name.endsWith(".wm")) {
      output.push({ relative, url });
    }
  }
  return output.sort((left, right) => left.relative.localeCompare(right.relative));
}

async function hashValue(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
