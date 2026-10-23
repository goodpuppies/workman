import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Regenerate subml-basis/, the library modules WM loads from the SubsetML Basis, from the
// authoritative SubsetML sources: deno run -A scripts/sync_subml_basis.ts [../SubsetML]
const repository = fileURLToPath(new URL("../", import.meta.url));
const subsetml = resolve(Deno.args[0] ?? join(repository, "../SubsetML"));
const output = join(repository, "subml-basis");
const inventory = JSON.parse(
  await Deno.readTextFile(join(subsetml, "docs/basis-dependencies.json")),
) as {
  modules: Record<string, { source: string; sourceDependencies: string[]; primitives: string[] }>;
};
const modules = Object.entries(inventory.modules);

const temporary = await Deno.makeTempDir({ prefix: "subml-basis-" });
try {
  const generated = await new Deno.Command(join(subsetml, "bin/subsetml"), {
    args: [
      "wm",
      temporary,
      "src/subset_text_host.sml",
      "src/subset_host.sml",
      ...modules.map(([, m]) => m.source),
    ],
    cwd: subsetml,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!generated.success || generated.stderr.length > 0) {
    throw new Error(`SubsetML generation failed: ${new TextDecoder().decode(generated.stderr)}`);
  }
  const files = new Map<string, Uint8Array>();
  for (const [, module] of modules) {
    const filename = module.source.replace(/^src\//, "").replace(/\.sml$/, ".wm");
    files.set(filename, await Deno.readFile(join(temporary, filename)));
  }
  // SubsetResult's datatype is WM's built-in Result, so FFI results, std's Result functions and
  // the Basis share one type and one Ok/Err.
  files.set(
    "subset_result.wm",
    new TextEncoder().encode(
      "// @basis-type Result\n" +
        new TextDecoder().decode(files.get("subset_result.wm")!),
    ),
  );
  // The host primitives' WM side is SubsetML's hand-written adapters, not a translation. A
  // library module's JS lives in js/, so the host adapter's import is pointed there.
  files.set("subset_text_host.wm", await Deno.readFile(join(subsetml, "lib/subset_text_host.wm")));
  const host = await Deno.readTextFile(join(subsetml, "lib/subset_host.wm"));
  if (!host.includes('js.module("./subset_host.js")')) {
    throw new Error("lib/subset_host.wm no longer imports ./subset_host.js");
  }
  files.set(
    "subset_host.wm",
    new TextEncoder().encode(
      host.replaceAll('js.module("./subset_host.js")', 'js.module("./js/subset_host.js")'),
    ),
  );
  files.set("js/subset_host.js", await Deno.readFile(join(subsetml, "lib/subset_host.js")));

  for await (const entry of Deno.readDir(output)) {
    if (entry.isFile && entry.name.endsWith(".wm") && !files.has(entry.name)) {
      await Deno.remove(join(output, entry.name));
    }
  }
  await Deno.mkdir(join(output, "js"), { recursive: true });
  for (const [name, bytes] of files) await Deno.writeFile(join(output, name), bytes);

  const hash = async (bytes: Uint8Array) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))]
      .map((value) => value.toString(16).padStart(2, "0")).join("");
  const sources = [
    "lib/subset_host.js",
    "lib/subset_host.wm",
    "lib/subset_text_host.wm",
    ...modules.map(([, m]) => m.source),
  ].sort();
  const commit = await new Deno.Command("git", {
    args: ["rev-parse", "HEAD"],
    cwd: subsetml,
    stdout: "piped",
  }).output();
  await Deno.writeTextFile(
    join(output, "manifest.json"),
    JSON.stringify(
      {
        source: "SubsetML",
        commit: new TextDecoder().decode(commit.stdout).trim(),
        modules: modules.map(([name]) => name).sort(),
        sourceHashes: Object.fromEntries(
          await Promise.all(
            sources.map(async (
              source,
            ) => [source, await hash(await Deno.readFile(join(subsetml, source)))]),
          ),
        ),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Wrote ${files.size} SubsetML Basis files to subml-basis/`);
} finally {
  await Deno.remove(temporary, { recursive: true });
}
