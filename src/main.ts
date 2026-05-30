import { checkFile, compileFile, ModuleAnalysisError } from "./compiler.ts";
import { formatError } from "./diagnostics.ts";
import { ParseError } from "./parser.ts";
import { runFile } from "./run.ts";

const commands = new Set(["check", "compile", "run", "help"]);

if (import.meta.main) {
  const code = await main(Deno.args).catch((error) => {
    if (error instanceof ParseError) {
      console.error(formatError(error.message, error.filePath, error.source, error.span));
    } else if (error instanceof ModuleAnalysisError) {
      if (error.originalError instanceof ParseError) {
        console.error(formatError(error.originalError.message, error.originalError.filePath || error.path, error.originalError.source, error.originalError.span));
      } else {
        console.error(formatError(error.message, error.path, error.source, undefined));
      }
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    return 1;
  });
  Deno.exit(code);
}

export async function main(args: string[]): Promise<number> {
  const [head, ...rest] = args;
  const command = commands.has(head ?? "") ? head : "compile";
  const commandArgs = command === head ? rest : args;

  switch (command) {
    case "check":
      return await checkCommand(commandArgs);
    case "compile":
      return await compileCommand(commandArgs);
    case "run":
      return await runCommand(commandArgs);
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

function missingInput(command: string): number {
  console.error(`usage: wm ${command} <input.wm>`);
  return 2;
}

function usage() {
  console.error(`usage: wm <command> [args]

commands:
  check <input.wm>              typecheck a module graph
  compile <input.wm> [out.js]   emit JavaScript
  run <input.wm> [-- args...]   compile and execute with Deno

compat:
  wm <input.wm> [out.js]        same as wm compile <input.wm> [out.js]`);
}
