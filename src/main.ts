import { checkFile, compileFile, ModuleAnalysisError } from "./compiler.ts";
import {
  formatDiagnostic,
  formatDiagnosticError,
  formatError,
  FrontendDiagnosticBundleError,
  FrontendDiagnosticError,
} from "./diagnostics.ts";
import { ParseError } from "./parser.ts";
import { runFile } from "./run.ts";
import { typeDebugFile } from "./type_debug.ts";

const commands = new Set(["check", "compile", "run", "type-debug", "help"]);

if (import.meta.main) {
  const code = await main(Deno.args).catch((error) => {
    if (error instanceof ParseError) {
      console.error(formatError(error.message, error.filePath, error.source, error.span));
    } else if (error instanceof ModuleAnalysisError) {
      if (error.originalError instanceof ParseError) {
        console.error(
          formatError(
            error.originalError.message,
            error.originalError.filePath || error.path,
            error.originalError.source,
            error.originalError.span,
          ),
        );
      } else if (error.originalError instanceof FrontendDiagnosticError) {
        console.error(formatDiagnosticError(error.originalError, error.path, error.source));
        for (const diagnostic of error.diagnostics) {
          console.error(formatDiagnostic(diagnostic, error.path, error.source));
        }
      } else if (error.originalError instanceof FrontendDiagnosticBundleError) {
        console.error(formatBundleError(error.originalError, error.path, error.source));
      } else {
        console.error(formatError(error.message, error.path, error.source, undefined));
        for (const diagnostic of error.diagnostics) {
          console.error(formatDiagnostic(diagnostic, error.path, error.source));
        }
      }
    } else if (error instanceof FrontendDiagnosticError) {
      console.error(formatDiagnosticError(error, undefined, undefined));
    } else if (error instanceof FrontendDiagnosticBundleError) {
      console.error(formatBundleError(error, undefined, undefined));
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    return 1;
  });
  Deno.exit(code);
}

export async function main(args: string[]): Promise<number> {
  const [head, ...rest] = args;
  if (!head || head === "--help" || head === "-h") {
    usage();
    return 0;
  }
  const command = commands.has(head ?? "") ? head : "compile";
  const commandArgs = command === head ? rest : args;

  switch (command) {
    case "check":
      return await checkCommand(commandArgs);
    case "compile":
      return await compileCommand(commandArgs);
    case "run":
      return await runCommand(commandArgs);
    case "type-debug":
      return await typeDebugCommand(commandArgs);
    case "help":
    default:
      usage();
      return command === "help" ? 0 : 2;
  }
}

async function checkCommand(args: string[]): Promise<number> {
  const [input] = args;
  if (!input) return missingInput("check");
  await checkFile(input);
  console.log("ok");
  return 0;
}

async function compileCommand(args: string[]): Promise<number> {
  const [input, output] = args;
  if (!input) return missingInput("compile");
  const js = await compileFile(input);
  if (output) await Deno.writeTextFile(output, js);
  else console.log(js);
  return 0;
}

async function runCommand(args: string[]): Promise<number> {
  const separator = args.indexOf("--");
  const inputArgs = separator === -1 ? args : args.slice(0, separator);
  const programArgs = separator === -1 ? [] : args.slice(separator + 1);
  const [input] = inputArgs;
  if (!input) return missingInput("run");
  return (await runFile(input, { args: programArgs })).code;
}

async function typeDebugCommand(args: string[]): Promise<number> {
  const [input] = args;
  if (!input) return missingInput("type-debug");
  console.log(await typeDebugFile(input));
  return 0;
}

function formatBundleError(
  error: FrontendDiagnosticBundleError,
  filePath: string | undefined,
  source: string | undefined,
): string {
  const primary = error.primary instanceof FrontendDiagnosticError
    ? formatDiagnosticError(error.primary, filePath, source)
    : formatError(error.message, filePath, source, undefined);
  const additional = error.diagnostics.map((diagnostic) => formatDiagnostic(diagnostic, filePath, source));
  return [primary, ...additional].join("");
}

function missingInput(command: string): number {
  console.error(`usage: wm ${command} <input.wm>`);
  console.error(`try: wm --help`);
  return 2;
}

function usage() {
  console.log(`wm-mini - Workman subset compiler and runner

usage:
  wm <command> [args]
  wm <file.wm> [out.js]

commands:
  check <file.wm>               typecheck a module graph
  compile <file.wm> [out.js]    emit JavaScript
  run <file.wm> [-- args...]    compile and execute with Deno
  type-debug <file.wm>           print staged typechecker state on failure
  help                          show this help

compat:
  wm <file.wm> [out.js]         same as wm compile <file.wm> [out.js]

examples:
  wm check examples/factorial.wm
  wm run examples/factorial.wm
  wm compile examples/factorial.wm out.mjs
  wm run app.wm -- arg1 arg2

notes:
  JS FFI uses Deno under the hood. Runtime permissions come from the wm launcher.`);
}
