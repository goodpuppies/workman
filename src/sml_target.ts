// `wm sml`: translate a WM program to portable SubsetML that MLton builds.
//
// The translator is SubsetML's own reader (subm/SubsetML), whose source is SubsetML and so
// compiles to Workman and from there to src/generated/subsetml.js. It reads the entry and its
// imports with the SubsetML Basis, writes one `.sml` file per module and a `project.mlb`, and
// links the host modules to their MLton adapters. Every file it writes stays in the output
// directory, so the directory builds anywhere: `mlton project.mlb`.
import { basename, dirname, join, posix, resolve } from "node:path";
import { librarySources, nativeBasisSources } from "./generated/assets.ts";
import { createTemporaryDirectory } from "./temporary_directory.ts";
import { discoverStandardModules } from "./standard_library.ts";
import { libraryImport } from "./host_modules.ts";

const HOST_MODULES = [
  ["subset_host", "SubsetHost"],
  ["subset_text_host", "SubsetTextHost"],
  ["subset_real_host", "SubsetRealHost"],
] as const;

/** Workman host modules with an MLton adapter: the module's path, its staged checker and adapter
 * under `host/native/`, and the adapter's structure. */
const WM_HOST_MODULES = [
  ["host/js/debug.wm", "debug", "WmDebugHost"],
] as const;

export const SML_USAGE = `usage: wm sml <file.wm> <out-dir> [--mlton]
  translate <file.wm> and its imports to SML for MLton (project.mlb in <out-dir>)
  --mlton   also build <out-dir>/<name> with mlton`;

export async function smlCommand(args: string[]): Promise<number> {
  const mlton = args.includes("--mlton");
  const positional = args.filter((arg) => arg !== "--mlton");
  if (positional.length !== 2 || positional.some((arg) => arg.startsWith("-"))) {
    console.error(SML_USAGE);
    return 2;
  }
  const entry = resolve(positional[0]);
  const out = resolve(positional[1]);
  await Deno.mkdir(out, { recursive: true });

  const temporary = await createTemporaryDirectory({ prefix: "wm-sml-" });
  try {
    // The Basis as the translator reads it: the library modules, with each host module's checker
    // declarations in place of its JavaScript adapter.
    const basis = join(temporary.path, "basis");
    await Deno.mkdir(basis);
    for (const [path, source] of Object.entries(librarySources)) {
      const match = path.match(/^subml-basis\/([^/]+\.wm)$/);
      if (match) await Deno.writeTextFile(join(basis, match[1]), source);
    }
    // Stage source-only std extensions in dependency order. JS-backed extensions retain
    // the reader's source Basis namespace until a native adapter is available for them.
    const portable = new Set(Object.keys(librarySources).filter((path) => path.startsWith("subml-basis/")));
    const adapters: string[] = [];
    for (const [path, name, structure] of WM_HOST_MODULES) {
      const checker = join(basis, path);
      const native = join(out, `${name}_native.sml`);
      await Deno.mkdir(dirname(checker), { recursive: true });
      await Deno.writeTextFile(checker, nativeSource(`host/native/${name}.wm`));
      await Deno.writeTextFile(native, nativeSource(`host/native/${name}.sml`));
      adapters.push("--native-adapter-if-used", checker, native, structure);
      portable.add(path);
    }
    for (const module of await discoverStandardModules()) {
      if (!module.path.startsWith("std/")) continue;
      if (module.module.decls.some((decl) =>
        decl.kind === "JsImportDecl" ||
        (decl.kind === "ImportDecl" && !portable.has(
          libraryImport(decl.path)?.path ?? posix.normalize(posix.join(posix.dirname(module.path), decl.path)),
        ))
      )) continue;
      portable.add(module.path);
      await Deno.mkdir(join(basis, "std"), { recursive: true });
      await Deno.writeTextFile(join(basis, module.path), module.source);
    }
    await Deno.writeTextFile(join(basis, "module-scope.paths"), [...portable].sort().join("\n") + "\n");
    for (const [name, structure] of HOST_MODULES) {
      const checker = join(basis, `${name}.wm`);
      const native = join(out, `${name}_native.sml`);
      await Deno.writeTextFile(checker, nativeBasisSource(`${name}.wm`));
      await Deno.writeTextFile(native, nativeBasisSource(`${name}.sml`));
      adapters.push("--native-adapter-if-used", checker, native, structure);
    }

    const translator = new URL("./generated/subsetml.js", import.meta.url).href;
    const translated = await new Deno.Command(Deno.env.get("WORKMAN_DENO_PATH") || Deno.execPath(), {
      args: ["run", "-A", translator, "sml-entry", out, "--basis", basis, ...adapters, entry],
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    if (!translated.success) return 1;

    // The project names the adapters by the absolute paths given above; make them relative so the
    // directory can move.
    const project = join(out, "project.mlb");
    const prefix = JSON.stringify(out + "/").slice(0, -1);
    await Deno.writeTextFile(project, (await Deno.readTextFile(project)).replaceAll(prefix, '"'));

    if (!mlton) {
      console.log(`wrote ${project}; build it with: mlton ${project}`);
      return 0;
    }
    const program = join(out, basename(entry).replace(/\.wm$/, ""));
    let built;
    try {
      built = await new Deno.Command("mlton", {
        args: ["-output", program, project],
        stdout: "inherit",
        stderr: "inherit",
      }).output();
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        console.error(`mlton is not on PATH; the SML is in ${out}`);
        return 1;
      }
      throw error;
    }
    if (!built.success) return 1;
    console.log(`built ${program}`);
    return 0;
  } finally {
    await temporary.cleanup();
  }
}

function nativeBasisSource(name: string): string {
  return nativeSource(`subml-basis/native/${name}`);
}

function nativeSource(path: string): string {
  const source = nativeBasisSources[path];
  if (source === undefined) throw new Error(`the package lacks ${path}`);
  return source;
}
