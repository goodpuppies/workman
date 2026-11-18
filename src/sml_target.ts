// `wm sml`: translate a WM program to portable SubsetML that MLton builds.
//
// The translator is SubsetML's own reader (subm/SubsetML), whose source is SubsetML and so
// compiles to Workman and from there to src/generated/subsetml.js. It reads the entry and its
// imports with the SubsetML Basis, writes one `.sml` file per module and a `project.mlb`, and
// links the host modules to their MLton adapters. Every file it writes stays in the output
// directory, so the directory builds anywhere: `mlton project.mlb`.
//
// With MLton on PATH, the translator runs natively: the package carries its SML, which is built
// once into the Workman cache. Without MLton, or with WM_SML_TRANSLATOR=js, it runs as JavaScript.
import { basename, dirname, join, posix, resolve } from "node:path";
import { librarySources, nativeBasisSources, translatorSmlSources } from "./generated/assets.ts";
import { workmanCache } from "./user_paths.ts";
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
    const portable = new Set(
      Object.keys(librarySources).filter((path) => path.startsWith("subml-basis/")),
    );
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
      if (
        module.module.decls.some((decl) =>
          decl.kind === "JsImportDecl" ||
          (decl.kind === "ImportDecl" && !portable.has(
            libraryImport(decl.path)?.path ??
              posix.normalize(posix.join(posix.dirname(module.path), decl.path)),
          ))
        )
      ) continue;
      portable.add(module.path);
      await Deno.mkdir(join(basis, "std"), { recursive: true });
      // The current native reader supports Int32 only. Keep the portable 32-bit exports and
      // std additions, but leave Int64 entry points unsupported until the target implements them.
      const wideCounts = module.source.indexOf("// @int64-counts");
      const source = wideCounts < 0 ? module.source : module.source.slice(0, wideCounts);
      await Deno.writeTextFile(join(basis, module.path), source);
    }
    await Deno.writeTextFile(
      join(basis, "module-scope.paths"),
      [...portable].sort().join("\n") + "\n",
    );
    for (const [name, structure] of HOST_MODULES) {
      const checker = join(basis, `${name}.wm`);
      const native = join(out, `${name}_native.sml`);
      await Deno.writeTextFile(checker, nativeBasisSource(`${name}.wm`));
      await Deno.writeTextFile(native, nativeBasisSource(`${name}.sml`));
      adapters.push("--native-adapter-if-used", checker, native, structure);
    }

    const translatorArgs = ["sml-entry", out, "--basis", basis, ...adapters, entry];
    const nativeBinary = Deno.env.get("WM_SML_TRANSLATOR") === "js"
      ? undefined
      : await nativeTranslator();
    const translated = nativeBinary
      ? await new Deno.Command(nativeBinary, {
        args: translatorArgs,
        stdout: "inherit",
        stderr: "inherit",
      }).output()
      : await new Deno.Command(Deno.env.get("WORKMAN_DENO_PATH") || Deno.execPath(), {
        args: [
          "run",
          "-A",
          new URL("./generated/subsetml.js", import.meta.url).href,
          ...translatorArgs,
        ],
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

/** The native translator, built from the packaged SML on first use; undefined without MLton or
 * when the build fails, so the caller falls back to the JavaScript translator. */
async function nativeTranslator(): Promise<string | undefined> {
  const files = Object.entries(translatorSmlSources)
    .map(([path, source]) => [basename(path), source] as const)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  if (files.length === 0) return undefined;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(files)),
  );
  const key = [...new Uint8Array(digest)].slice(0, 12).map((byte) =>
    byte.toString(16).padStart(2, "0")
  )
    .join("");
  const cache = join(workmanCache(), "subsetml");
  const binary = join(cache, `subsetml-${key}${Deno.build.os === "windows" ? ".exe" : ""}`);
  try {
    if ((await Deno.stat(binary)).isFile) return binary;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }

  await Deno.mkdir(cache, { recursive: true });
  // Built beside its final name and renamed into place, so a concurrent run never sees half a
  // binary and two builds racing both succeed.
  const build = await Deno.makeTempDir({ dir: cache, prefix: "build-" });
  try {
    for (const [name, source] of files) await Deno.writeTextFile(join(build, name), source);
    console.error("building the native SubsetML translator for wm sml; this happens once");
    let built;
    try {
      built = await new Deno.Command("mlton", {
        args: ["-output", join(build, "subsetml"), join(build, "subsetml.mlb")],
        stdout: "piped",
        stderr: "piped",
      }).output();
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    if (!built.success) {
      console.error(
        "building the native translator failed; translating with the JavaScript one\n" +
          new TextDecoder().decode(built.stderr).split("\n").slice(-20).join("\n"),
      );
      return undefined;
    }
    await Deno.rename(join(build, "subsetml"), binary);
    return binary;
  } finally {
    await Deno.remove(build, { recursive: true }).catch(() => {});
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
