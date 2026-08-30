import {
  compileFileArtifactsFromCore,
  type CompileOptions,
  coreFile,
  type CoreFileResult,
} from "./compiler.ts";
import {
  type FrontendDiagnostic,
  FrontendDiagnosticError,
  missingEntrypointDiagnostic,
} from "./diagnostics.ts";
import { dirname, relative, resolve } from "node:path";
import { runtimeFlagsForJavaScript } from "./runtime_flags.ts";
import { createProgressReporter } from "./progress.ts";
import { ReverseImportDiscoveryIndex } from "./project_context.ts";
import { resolveModuleImportPath } from "./module_graph.ts";
import { createTemporaryDirectory } from "./temporary_directory.ts";

export type RunOptions = CompileOptions & {
  args?: string[];
  stdout?: "inherit" | "piped";
  stderr?: "inherit" | "piped";
  /** Stop the spawned program when the signal is aborted. */
  signal?: AbortSignal;
  /** Force compile progress on or off; defaults to on when stderr is a TTY. */
  progress?: boolean;
};

export type RunResult = {
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
};

export class RunEntrypointError extends FrontendDiagnosticError {
  constructor(
    diagnostic: FrontendDiagnostic,
    readonly path: string,
    readonly source: string,
    readonly suggestedEntrypoints: readonly string[] = [],
  ) {
    super(diagnostic);
    this.name = "RunEntrypointError";
  }
}

export function runEntrypointDiagnostic(compiled: CoreFileResult): FrontendDiagnostic | undefined {
  const entry = compiled.core.modules.get(compiled.core.entry)!;
  return entry.dynamicExports.some((item) => item.name === "main")
    ? undefined
    : missingEntrypointDiagnostic();
}

export async function runFile(input: string, options: RunOptions = {}): Promise<RunResult> {
  const inputPath = await Deno.realPath(resolve(input));
  const temporaryDirectory = await createTemporaryDirectory({
    dir: dirname(inputPath),
    prefix: ".wm-mini-",
  });
  const dir = temporaryDirectory.path;
  const output = `${dir}/main.mjs`;
  // Progress is drawn only while compiling; it is cleared before the program
  // takes over the terminal, so a TUI never inherits a partial line.
  const progress = createProgressReporter({ enabled: options.progress });
  try {
    const compiled = await coreFile(inputPath, {
      ...options,
      onStage: (name) => progress.stage(name),
      onModuleParsed: (loaded) => progress.step(loaded, 0, `${loaded} modules`),
      onAnalysisProgress: (done, total, phase) => progress.step(done, total, phase),
    });
    await assertEntrypoint(compiled);
    progress.stage("emit javascript");
    const artifacts = await compileFileArtifactsFromCore(compiled, options);
    const entry = artifacts.find((artifact) => artifact.kind === "entry") ?? artifacts[0];
    if (!entry) throw new Error("compiler produced no executable artifact");
    for (const artifact of artifacts) {
      await Deno.writeTextFile(`${dir}/${artifact.path}`, artifact.code);
    }
    progress.finish();
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        ...runtimeFlagsForJavaScript(entry.code),
        output,
        ...(options.args ?? []),
      ],
      stdin: "inherit",
      stdout: options.stdout ?? "inherit",
      stderr: options.stderr ?? "inherit",
    }).spawn();
    const stop = () => {
      try {
        child.kill();
      } catch (error) {
        // The child may have exited between the abort and kill calls.
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    };
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) stop();
    try {
      return await child.output();
    } finally {
      options.signal?.removeEventListener("abort", stop);
    }
  } finally {
    progress.finish();
    await temporaryDirectory.cleanup();
  }
}

async function assertEntrypoint(compiled: CoreFileResult): Promise<void> {
  const entry = compiled.core.modules.get(compiled.core.entry)!;
  const diagnostic = runEntrypointDiagnostic(compiled);
  if (!diagnostic) return;
  const suggestedEntrypoints = await discoverEntrypoints(entry.path);
  throw new RunEntrypointError(diagnostic, entry.path, entry.source, suggestedEntrypoints);
}

async function discoverEntrypoints(inputPath: string): Promise<string[]> {
  const cwd = resolve(Deno.cwd());
  const root = relative(cwd, inputPath).startsWith("..") ? dirname(inputPath) : cwd;
  const files = await collectWorkmanFiles(root);
  const discovery = new ReverseImportDiscoveryIndex();
  await Promise.all(files.map(async (path) => {
    const source = await Deno.readTextFile(path);
    await discovery.update(path, source, async (referrer, specifier) => {
      try {
        return await resolveModuleImportPath(referrer, specifier);
      } catch {
        return undefined;
      }
    });
  }));
  return [...discovery.headsFor(inputPath)];
}

async function collectWorkmanFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.isDirectory && entry.name.startsWith(".")) continue;
    const path = resolve(root, entry.name);
    if (entry.isDirectory) files.push(...await collectWorkmanFiles(path));
    else if (entry.isFile && entry.name.endsWith(".wm")) files.push(path);
  }
  return files;
}
