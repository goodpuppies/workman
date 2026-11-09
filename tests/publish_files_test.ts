import { assert } from "@std/assert";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import denoConfig from "../deno.json" with { type: "json" };

const root = dirname(fileURLToPath(new URL("../deno.json", import.meta.url)));

/** Whether a repository-relative path is published, by `publish.include` in deno.json. */
function published(path: string): boolean {
  return denoConfig.publish.include.some((pattern) => {
    if (pattern.endsWith("/")) return path.startsWith(pattern) || `${path}/` === pattern;
    if (pattern.includes("*")) {
      const expression = new RegExp(
        `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*")}$`,
      );
      return expression.test(path);
    }
    return path === pattern || pattern.startsWith(`${path}/`);
  });
}

async function* sourceFiles(directory: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(directory)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory) yield* sourceFiles(path);
    else if (entry.name.endsWith(".ts")) yield path;
  }
}

/**
 * Read only outside Deno, where wm can't build it, and generated, so it is never in the repository.
 * Under Deno, wm builds it from `tooling/wmslang/*.wm`.
 */
const unpublishedResources = new Set(["tooling/wmslang/wmslang.generated.mjs"]);

// The release publishes only what wm needs to run (deno.json `publish.include`). Files the compiler
// reads beside its own modules at runtime, such as the wmslang and pakman sources, must be in it.
Deno.test("every resource the compiler reads at runtime is published", async () => {
  const missing: string[] = [];
  for await (const file of sourceFiles(join(root, "src"))) {
    const sourcePath = relative(root, file).replaceAll("\\", "/");
    if (sourcePath.includes("/generated/") || sourcePath.includes("/vendor/")) continue;
    const source = await Deno.readTextFile(file);
    for (const match of source.matchAll(/new URL\("(\.\.?\/[^"]*)", import\.meta\.url\)/g)) {
      const resource = relative(root, join(dirname(file), match[1])).replaceAll("\\", "/")
        .replace(/\/$/, "");
      if (resource === "" || resource.startsWith("..")) continue;
      if (!published(resource) && !unpublishedResources.has(resource)) {
        missing.push(`${sourcePath}: ${resource}`);
      }
    }
  }
  assert(missing.length === 0, `not published:\n${missing.join("\n")}`);
});

Deno.test("examples, tests and development tooling are not published", () => {
  for (
    const path of ["examples/effect-ts/effect_server.wm", "tests/cli_test.ts", "scripts/install.ts"]
  ) {
    assert(!published(path), path);
  }
});
