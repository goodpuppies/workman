import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Regenerate subml-basis/, the library modules WM loads from the SubsetML Basis, from the
// authoritative SubsetML sources: deno run -A scripts/sync_subml_basis.ts [subm/SubsetML]
const repository = fileURLToPath(new URL("../", import.meta.url));
const subsetml = resolve(Deno.args[0] ?? join(repository, "subm/SubsetML"));
const output = join(repository, "subml-basis");
const inventory = JSON.parse(
  await Deno.readTextFile(join(subsetml, "docs/basis-dependencies.json")),
) as {
  modules: Record<string, { source: string; sourceDependencies: string[]; primitives: string[] }>;
};
const modules = Object.entries(inventory.modules);
// Goes under any `// @basis-type` line, so that line stays first.
const SYNCED = "// Synced from subm/SubsetML by scripts/sync_subml_basis.ts. Do not edit here.\n";
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const synced = (bytes: Uint8Array) => encoder.encode(SYNCED + decoder.decode(bytes));
/** Basis modules whose implementation is the host's: a JS adapter here, an SML adapter natively. */
const HOST_MODULES = ["subset_host", "subset_text_host", "subset_real_host"];

const temporary = await Deno.makeTempDir({ prefix: "subml-basis-" });
try {
  const generated = await new Deno.Command(join(subsetml, "bin/subsetml"), {
    args: [
      "wm",
      temporary,
      "src/subset_text_host.sml",
      "src/subset_real_host.sml",
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
    files.set(filename, synced(await Deno.readFile(join(temporary, filename))));
  }
  // SubsetResultValue's datatype shares WM's Result identity, so FFI results, std functions and
  // the Basis share one type and one Ok/Err.
  files.set(
    "subset_result_value.wm",
    new TextEncoder().encode(
      "// @basis-type Result\n" +
        new TextDecoder().decode(files.get("subset_result_value.wm")!),
    ),
  );
  // The source-owned option datatype shares WM's existing FFI/constructor identity.
  files.set(
    "subset_option_value.wm",
    new TextEncoder().encode(
      "// @basis-type Option\n" +
        new TextDecoder().decode(files.get("subset_option_value.wm")!),
    ),
  );
  // The host primitives' WM side is SubsetML's hand-written adapters, not a translation. A
  // library module's JS lives in js/, so the host adapter's import is pointed there.
  files.set(
    "subset_text_host.wm",
    synced(await Deno.readFile(join(subsetml, "lib/subset_text_host.wm"))),
  );
  files.set(
    "subset_real_host.wm",
    synced(await Deno.readFile(join(subsetml, "lib/subset_real_host.wm"))),
  );
  const host = await Deno.readTextFile(join(subsetml, "lib/subset_host.wm"));
  if (!host.includes('js.module("./subset_host.js")')) {
    throw new Error("lib/subset_host.wm no longer imports ./subset_host.js");
  }
  files.set(
    "subset_host.wm",
    synced(encoder.encode(
      host.replaceAll('js.module("./subset_host.js")', 'js.module("./js/subset_host.js")'),
    )),
  );
  files.set("js/subset_host.js", synced(await Deno.readFile(join(subsetml, "lib/subset_host.js"))));

  for await (const entry of Deno.readDir(output)) {
    if (entry.isFile && entry.name.endsWith(".wm") && !files.has(entry.name)) {
      await Deno.remove(join(output, entry.name));
    }
  }
  await Deno.mkdir(join(output, "js"), { recursive: true });
  for (const [name, bytes] of files) await Deno.writeFile(join(output, name), bytes);

  // `wm sml` translates with the host modules' checker declarations, unchanged so the translator
  // reads their headers, and stages the MLton adapters that implement them.
  const native = join(output, "native");
  await Deno.remove(native, { recursive: true }).catch(() => {});
  await Deno.mkdir(native, { recursive: true });
  for (const name of HOST_MODULES) {
    await Deno.copyFile(join(temporary, `${name}.wm`), join(native, `${name}.wm`));
    await Deno.copyFile(join(subsetml, "lib", `${name}.sml`), join(native, `${name}.sml`));
  }

  // The translator's SML, which `wm sml` builds once with MLton when it is available: the files
  // src/subsetml.mlb names, flattened into one directory, and the .mlb naming them there.
  const translatorSources = join(output, "translator");
  await Deno.remove(translatorSources, { recursive: true }).catch(() => {});
  await Deno.mkdir(translatorSources, { recursive: true });
  const mlb: string[] = [];
  for (const line of (await Deno.readTextFile(join(subsetml, "src/subsetml.mlb"))).split("\n")) {
    const entry = line.trim();
    if (entry === "" || entry.startsWith("$(SML_LIB)")) {
      mlb.push(line);
      continue;
    }
    const name = entry.split("/").pop()!;
    if (!name.endsWith(".sml") || mlb.includes(name)) throw new Error(`unexpected subsetml.mlb entry ${entry}`);
    await Deno.copyFile(join(subsetml, "src", entry), join(translatorSources, name));
    mlb.push(name);
  }
  await Deno.writeTextFile(join(translatorSources, "subsetml.mlb"), mlb.join("\n"));

  // The translator itself, SubsetML's own source in Workman, compiled to one JavaScript program.
  const translator = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "src/main.ts", "compile", join(subsetml, "src/main.wm"), "src/generated/subsetml.js"],
    cwd: repository,
    stderr: "piped",
  }).output();
  if (!translator.success) {
    throw new Error(`compiling the SubsetML translator failed: ${decoder.decode(translator.stderr)}`);
  }
  // The compiler names a JS module import by its absolute file URL, which exists only in this
  // checkout. The published package carries the host adapter as subml-basis/js/subset_host.js,
  // so the translator imports it relative to its own location.
  const bundle = join(repository, "src/generated/subsetml.js");
  const hostUrl = pathToFileURL(join(subsetml, "src/subset_host.js")).href;
  const program = await Deno.readTextFile(bundle);
  if (!program.includes(JSON.stringify(hostUrl))) {
    throw new Error(`the SubsetML translator no longer imports ${hostUrl}`);
  }
  const relocated = program.replaceAll(JSON.stringify(hostUrl), JSON.stringify("../../subml-basis/js/subset_host.js"));
  if (relocated.includes('import("file://')) {
    throw new Error("the SubsetML translator imports another module by its absolute file URL");
  }
  await Deno.writeTextFile(bundle, relocated);

  const hash = async (bytes: Uint8Array) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))]
      .map((value) => value.toString(16).padStart(2, "0")).join("");
  const sources = [
    "lib/subset_host.js",
    "lib/subset_host.wm",
    "lib/subset_text_host.wm",
    "lib/subset_real_host.wm",
    ...HOST_MODULES.map((name) => `lib/${name}.sml`),
    "src/main.wm",
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
