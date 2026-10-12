import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Generate a self-contained WM snapshot from the authoritative SubsetML source graph.
const repository = fileURLToPath(new URL("../", import.meta.url));
const subsetml = resolve(Deno.args[0] ?? join(repository, "../SubsetML"));
const output = join(repository, "tooling/frontend-v3/lib/subsetml");
const inventory = JSON.parse(
  await Deno.readTextFile(join(subsetml, "docs/basis-dependencies.json")),
) as {
  modules: Record<string, { source: string; sourceDependencies: string[]; primitives: string[] }>;
};
const roots = ["SubsetUtf16Source", "SubsetNatural", "SubsetProcess"];
const selected = new Set(roots);
for (const name of selected) {
  const module = inventory.modules[name];
  if (!module) throw new Error(`Unknown Basis dependency ${name}`);
  module.sourceDependencies.forEach((dependency) => selected.add(dependency));
}
const sources = ["src/subset_text_host.sml"];
for (const [name, module] of Object.entries(inventory.modules)) {
  sources.push(module.source);
  if (name === "SubsetResult") sources.push("src/subset_host.sml");
}
const temporary = await Deno.makeTempDir({ prefix: "frontend-v3-basis-" });
try {
  const generated = await new Deno.Command(join(subsetml, "bin/subsetml"), {
    args: ["wm", temporary, ...sources],
    cwd: subsetml,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!generated.success || generated.stderr.length > 0) {
    throw new Error(`SubsetML generation failed: ${new TextDecoder().decode(generated.stderr)}`);
  }
  const files = new Map<string, Uint8Array>();
  for (const name of selected) {
    const filename = inventory.modules[name].source.replace(/^src\//, "").replace(/\.sml$/, ".wm");
    files.set(filename, await Deno.readFile(join(temporary, filename)));
    const sourceFilename = filename.replace(/\.wm$/, ".sml");
    files.set(sourceFilename, await Deno.readFile(join(subsetml, inventory.modules[name].source)));
  }
  files.set(
    "subset_text_host.sml",
    await Deno.readFile(join(subsetml, "src/subset_text_host.sml")),
  );
  files.set(
    "native/subset_text_host.sml",
    await Deno.readFile(join(subsetml, "lib/subset_text_host.sml")),
  );
  files.set("subset_text_host.wm", await Deno.readFile(join(subsetml, "lib/subset_text_host.wm")));
  for (
    const [target, source] of [
      ["subset_host.sml", "src/subset_host.sml"],
      ["subset_host.wm", "lib/subset_host.wm"],
      ["subset_host.js", "lib/subset_host.js"],
      ["native/subset_host.sml", "lib/subset_host.sml"],
    ]
  ) files.set(target, await Deno.readFile(join(subsetml, source)));
  for await (const license of Deno.readDir(join(subsetml, "LICENSES"))) {
    if (license.isFile) {
      files.set(license.name, await Deno.readFile(join(subsetml, "LICENSES", license.name)));
    }
  }
  const nativeOrder: string[] = [];
  const visited = new Set<string>();
  const visit = (name: string) => {
    if (visited.has(name)) return;
    visited.add(name);
    inventory.modules[name].sourceDependencies.forEach(visit);
    nativeOrder.push(inventory.modules[name].source.replace(/^src\//, ""));
  };
  roots.forEach(visit);
  files.set(
    "basis.mlb",
    new TextEncoder().encode([
      "$(SML_LIB)/basis/basis.mlb",
      "native/subset_text_host.sml",
      ...nativeOrder.flatMap((file) =>
        file === "subset_io.sml" ? ["native/subset_host.sml", file] : [file]
      ),
      "",
    ].join("\n")),
  );
  const hash = async (bytes: Uint8Array) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))]
      .map((value) => value.toString(16).padStart(2, "0")).join("");
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      [...selected].sort().map(async (name) => {
        const source = inventory.modules[name].source;
        return [source, await hash(await Deno.readFile(join(subsetml, source)))];
      }),
    ),
  );
  const hashes = Object.fromEntries(
    await Promise.all(
      [...files].sort(([a], [b]) => a.localeCompare(b))
        .map(async ([name, bytes]) => [name, await hash(bytes)]),
    ),
  );
  await Deno.mkdir(join(output, "native"), { recursive: true });
  for (const [name, bytes] of files) await Deno.writeFile(join(output, name), bytes);
  await Deno.writeTextFile(
    join(output, "manifest.json"),
    JSON.stringify(
      {
        source: "SubsetML",
        modules: [...selected].sort(),
        sourceHashes,
        files: hashes,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Generated ${selected.size} portable Basis modules and the existing text adapter`);
} finally {
  await Deno.remove(temporary, { recursive: true });
}
