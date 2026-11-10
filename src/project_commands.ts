import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFile } from "./compiler.ts";
import { watchProject } from "./project_watch.ts";
import { createTemporaryDirectory } from "./temporary_directory.ts";
import {
  exitIfTerminated,
  handleTerminationSignals,
  relayTerminationSignals,
  terminateChild,
  terminationExitCode,
} from "./child_runtime.ts";

export type ProjectStep = { kind: "wm" | "exec"; program: string; arguments: string[] };
export type ProjectCommand = {
  name: string;
  watchPaths?: string[];
  steps: ProjectStep[];
  env: { name: string; value: string }[];
};

/** File-looking operands always mean files, including nonexistent ones. */
export function isRunFile(input: string): boolean {
  return input.endsWith(".wm") || isAbsolute(input) || /[/\\]/.test(input) || input.startsWith(".");
}

export async function findProject(directory: string): Promise<string | undefined> {
  for (let current = resolve(directory);; current = dirname(current)) {
    const path = join(current, "pak.wm");
    try {
      if ((await Deno.stat(path)).isFile) return path;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    if (dirname(current) === current) return undefined;
  }
}

/** The same compiler installation that is executing this command, independent of PATH. */
function wmInvocation(arguments_: string[]): string[] {
  const cli = new URL("./cli.ts", import.meta.url);
  const configuration = cli.protocol === "file:"
    ? ["--config", fileURLToPath(new URL("../deno.json", import.meta.url))]
    : ["--no-config"];
  return [
    "run",
    "-A",
    ...configuration,
    cli.protocol === "file:" ? fileURLToPath(cli) : cli.href,
    ...arguments_,
  ];
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function decodeProjectCommands(value: unknown): ProjectCommand[] {
  const invalid = () => {
    throw new Error("pak.wm must export commands: List<Command> from pakman/project.wm");
  };
  if (
    !value || typeof value !== "object" || !("version" in value) || value.version !== 1 ||
    !("commands" in value) || !Array.isArray(value.commands)
  ) return invalid();
  const names = new Set<string>();
  for (const command of value.commands) {
    if (
      !command || typeof command.name !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]*$/.test(command.name) ||
      !Array.isArray(command.steps) || command.steps.length === 0 || !Array.isArray(command.env)
    ) return invalid();
    if (names.has(command.name)) throw new Error(`duplicate project command ${command.name}`);
    names.add(command.name);
    for (const step of command.steps) {
      if (
        !step || !["wm", "exec"].includes(step.kind) || typeof step.program !== "string" ||
        (step.kind === "exec" && !step.program) || !strings(step.arguments) ||
        step.program.includes("\0") || step.arguments.some((arg: string) => arg.includes("\0"))
      ) return invalid();
    }
    if (
      command.watchPaths !== undefined &&
      (!strings(command.watchPaths) ||
        command.watchPaths.some((path: string) => !path || path.includes("\0")))
    ) return invalid();
    const variables = new Set<string>();
    for (const variable of command.env) {
      if (
        !variable || typeof variable.name !== "string" ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.name) ||
        typeof variable.value !== "string" || variable.value.includes("\0") ||
        variables.has(variable.name)
      ) return invalid();
      variables.add(variable.name);
    }
  }
  return value.commands;
}

export async function readProjectCommands(path: string): Promise<ProjectCommand[]> {
  const temporary = await createTemporaryDirectory({ prefix: "wm-project-" });
  try {
    const specifier = relative(temporary.path, path).replaceAll("\\", "/");
    const entry = join(temporary.path, "describe.wm");
    await Deno.writeTextFile(
      entry,
      [
        `from ${
          JSON.stringify(
            specifier.startsWith(".") || isAbsolute(specifier) ? specifier : `./${specifier}`,
          )
        } import { commands };`,
        'from "pakman/project.wm" import { describe };',
        "let main = () => { describe(commands) };",
      ].join("\n"),
    );
    const output = join(temporary.path, "describe.mjs");
    await Deno.writeTextFile(output, await compileFile(entry));
    const child = new Deno.Command(Deno.execPath(), {
      args: ["run", "--no-config", "--no-prompt", output],
      cwd: dirname(path),
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(10000),
    }).spawn();
    const stopRelaying = relayTerminationSignals(child);
    try {
      const result = await child.output();
      if (!result.success) {
        throw new Error(
          `cannot evaluate ${path}: ${new TextDecoder().decode(result.stderr).trim()}`,
        );
      }
      try {
        return decodeProjectCommands(JSON.parse(new TextDecoder().decode(result.stdout)));
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error(`invalid project command description from ${path}`);
        }
        throw error;
      }
    } finally {
      stopRelaying();
    }
  } finally {
    await temporary.cleanup();
  }
}

export async function runProjectCommand(
  name: string,
  arguments_: string[],
  directory = Deno.cwd(),
): Promise<number> {
  const path = await findProject(directory);
  if (!path) {
    throw new Error(`no pak.wm found from ${directory}; use wm run ./file.wm to run a file`);
  }
  let commands: ProjectCommand[];
  try {
    commands = await readProjectCommands(path);
  } finally {
    // Evaluation has finished cleaning up its temporary files before a relayed signal exits us.
    exitIfTerminated();
  }
  const command = commands.find((candidate) => candidate.name === name);
  if (!command) {
    throw new Error(
      `unknown project command ${name}; available: ${
        commands.map((entry) => entry.name).join(", ") || "(none)"
      }`,
    );
  }
  const run = (signal?: AbortSignal) => runProjectSteps(command, arguments_, dirname(path), signal);
  if (!command.watchPaths?.length) return await run();
  const controller = new AbortController();
  let exitCode = 0;
  const stopHandling = handleTerminationSignals((signal) => {
    exitCode = terminationExitCode[signal];
    controller.abort();
  });
  try {
    await watchProject(
      command.watchPaths.map((entry) => resolve(dirname(path), entry)),
      run,
      controller.signal,
    );
    return exitCode;
  } finally {
    stopHandling();
  }
}

async function runProjectSteps(
  command: ProjectCommand,
  arguments_: string[],
  directory: string,
  signal?: AbortSignal,
): Promise<number> {
  const env = Object.fromEntries(command.env.map((variable) => [variable.name, variable.value]));
  for (const [index, step] of command.steps.entries()) {
    if (signal?.aborted) return 0;
    // Extra CLI arguments belong to the final command, not prerequisite build steps.
    const args = [...step.arguments, ...(index === command.steps.length - 1 ? arguments_ : [])];
    const child = new Deno.Command(step.kind === "wm" ? Deno.execPath() : step.program, {
      args: step.kind === "wm" ? wmInvocation(args) : args,
      cwd: directory,
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    const stopRelaying = relayTerminationSignals(child);
    let rejectStop!: (error: unknown) => void;
    const stopFailure = new Promise<never>((_, reject) => {
      rejectStop = reject;
    });
    const stop = () => {
      void terminateChild(child).catch(rejectStop);
    };
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    let code: number;
    try {
      code = (await Promise.race([child.status, stopFailure])).code;
    } finally {
      signal?.removeEventListener("abort", stop);
      stopRelaying();
    }
    exitIfTerminated();
    if (code !== 0) return code;
  }
  return 0;
}
