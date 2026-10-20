import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompileArtifact } from "./compiler.ts";
import { runtimeFlagsForJavaScript } from "./runtime_flags.ts";

export function compileArguments(args: string[]) {
  let input: string | undefined;
  let output: string | undefined;
  let executable = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--executable") executable = true;
    else if (arg === "-o" || arg === "--output") {
      const value = args[++i];
      if (!value || value.startsWith("-") || output) throw new Error("expected one output path");
      output = value;
    } else if (arg.startsWith("-")) throw new Error(`unknown compile option ${arg}`);
    else if (!input) input = arg;
    else if (!output) output = arg;
    else throw new Error("too many compile arguments");
  }
  if (executable && !output) throw new Error("--executable requires -o <output>");
  return { input, output, executable };
}

// Deno owns fetching its runtime and imports. No warm cache or offline mode is
// required. Stage the complete emitted module set so generated workers survive
// removal of the source tree, and publish only a successful executable.
export async function compileExecutable(
  artifacts: CompileArtifact[],
  output: string,
): Promise<number> {
  const destination = resolve(output);
  await Deno.mkdir(dirname(destination), { recursive: true });
  const work = await Deno.makeTempDir({ dir: dirname(destination), prefix: ".wm-compile-" });
  try {
    const modules = join(work, "modules");
    await Deno.mkdir(modules);
    const entry = artifacts.find((artifact) => artifact.kind === "entry");
    if (!entry) throw new Error("compiler produced no entrypoint");
    for (const artifact of artifacts) {
      const target = join(modules, artifact.path);
      // Deno relocates embedded local modules under its virtual filesystem.
      // Absolute dynamic import strings would still point at the old host path.
      // These literal imports are emitted by WM's JS interop lowering.
      const code = artifact.code.replace(/\bimport\(("file:[^"\n]+")\)/g, (_, literal) => {
        const path = relative(dirname(target), fileURLToPath(JSON.parse(literal)))
          .split(sep).map(encodeURIComponent).join("/");
        return `import(${JSON.stringify(path.startsWith(".") ? path : `./${path}`)})`;
      });
      await Deno.writeTextFile(target, code);
    }
    const binary = join(work, Deno.build.os === "windows" ? "program.exe" : "program");
    const status = await new Deno.Command(Deno.env.get("WORKMAN_DENO_PATH") || Deno.execPath(), {
      args: [
        "compile",
        "-A",
        "--no-check",
        "--no-config",
        "--no-lock",
        ...runtimeFlagsForJavaScript(artifacts.map((artifact) => artifact.code).join("\n")),
        "--include",
        modules,
        "--output",
        binary,
        join(modules, entry.path),
      ],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn().status;
    if (!status.success) return status.code;
    await Deno.rename(binary, destination);
    return 0;
  } finally {
    await Deno.remove(work, { recursive: true });
  }
}
