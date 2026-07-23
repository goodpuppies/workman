import {
  analyzeFile,
  compileFile,
  compileFileArtifacts,
  compileLibraryFile,
  coreFile,
  ModuleAnalysisError,
} from "./compiler.ts";
import { dirname } from "node:path";
import {
  formatDiagnostic,
  formatDiagnosticError,
  formatDiagnosticInspection,
  formatError,
  formatReplDiagnostic,
  formatReplError,
  FrontendDiagnosticBundleError,
  FrontendDiagnosticError,
} from "./diagnostics.ts";
import { ParseError } from "./parser.ts";
import { runEntrypointDiagnostic, RunEntrypointError, runFile } from "./run.ts";
import { typeDebugFile } from "./type_debug.ts";
import { evaluateReplFile, watchReplChanges } from "./repl.ts";
import denoConfig from "../deno.json" with { type: "json" };

const commands = new Set([
  "check",
  "compile",
  "compile-library",
  "run",
  "repl",
  "err",
  "type-debug",
  "help",
  "version",
]);
const VERSION = denoConfig.version;

export async function runCli(args: string[]): Promise<number> {
  return await main(args).catch((error) => {
    reportError(error);
    return 1;
  });
}

function reportError(error: unknown): void {
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
  } else if (error instanceof RunEntrypointError) {
    console.error(formatDiagnosticError(error, error.path, error.source));
  } else if (error instanceof FrontendDiagnosticError) {
    console.error(formatDiagnosticError(error, undefined, undefined));
  } else if (error instanceof FrontendDiagnosticBundleError) {
    console.error(formatBundleError(error, undefined, undefined));
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
}

function reportReplError(error: unknown): void {
  if (error instanceof ParseError) {
    console.error(formatReplError(error.message, error.filePath, error.source, error.span));
  } else if (error instanceof ModuleAnalysisError) {
    if (error.originalError instanceof ParseError) {
      console.error(
        formatReplError(
          error.originalError.message,
          error.originalError.filePath || error.path,
          error.originalError.source,
          error.originalError.span,
        ),
      );
    } else if (error.originalError instanceof FrontendDiagnosticError) {
      console.error(formatReplDiagnostic(error.originalError.diagnostic, error.path, error.source));
      for (const diagnostic of error.diagnostics) {
        console.error(formatReplDiagnostic(diagnostic, error.path, error.source));
      }
    } else if (error.originalError instanceof FrontendDiagnosticBundleError) {
      if (error.originalError.primary instanceof FrontendDiagnosticError) {
        console.error(
          formatReplDiagnostic(error.originalError.primary.diagnostic, error.path, error.source),
        );
      } else {
        console.error(
          formatReplError(error.originalError.message, error.path, error.source, undefined),
        );
      }
      for (const diagnostic of error.originalError.diagnostics) {
        console.error(formatReplDiagnostic(diagnostic, error.path, error.source));
      }
    } else {
      console.error(formatReplError(error.message, error.path, error.source, undefined));
    }
  } else if (error instanceof FrontendDiagnosticError) {
    console.error(formatReplDiagnostic(error.diagnostic, undefined, undefined));
  } else if (error instanceof FrontendDiagnosticBundleError) {
    if (error.primary instanceof FrontendDiagnosticError) {
      console.error(formatReplDiagnostic(error.primary.diagnostic, undefined, undefined));
    } else {
      console.error(formatReplError(error.message, undefined, undefined, undefined));
    }
    for (const diagnostic of error.diagnostics) {
      console.error(formatReplDiagnostic(diagnostic, undefined, undefined));
    }
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
}

if (import.meta.main) {
  Deno.exitCode = await runCli(Deno.args);
}

export async function main(args: string[]): Promise<number> {
  const [head, ...rest] = args;
  if (!head || head === "--help" || head === "-h") {
    usage();
    return 0;
  }
  if (head === "--version" || head === "-V" || head === "-v") {
    version();
    return 0;
  }
  if (!commands.has(head) && !head.endsWith(".wm")) {
    console.error(`unknown command: ${head}`);
    console.error("try: wm --help");
    return 2;
  }
  const command = commands.has(head) ? head : "compile";
  const commandArgs = command === head ? rest : args;

  switch (command) {
    case "check":
      return await checkCommand(commandArgs);
    case "compile":
      return await compileCommand(commandArgs);
    case "compile-library":
      return await compileLibraryCommand(commandArgs);
    case "run":
      return await runCommand(commandArgs);
    case "repl":
      return await replCommand(commandArgs);
    case "err":
      return await errCommand(commandArgs);
    case "type-debug":
      return await typeDebugCommand(commandArgs);
    case "version":
      version();
      return 0;
    case "help":
    default:
      usage();
      return command === "help" ? 0 : 2;
  }
}

async function checkCommand(args: string[]): Promise<number> {
  const [input] = args;
  if (!input) return missingInput("check");
  const analysis = await analyzeFile(input);
  for (const path of analysis.graph.order) {
    const result = analysis.results.get(path);
    const source = analysis.graph.nodes.get(path)?.source ?? "";
    for (const diagnostic of result?.diagnostics ?? []) {
      console.error(formatDiagnostic(diagnostic, path, source));
    }
  }
  console.log("ok");
  return 0;
}

async function compileCommand(args: string[]): Promise<number> {
  const [input, output] = args;
  if (!input) return missingInput("compile");
  if (!output) {
    console.log(await compileFile(input));
    return 0;
  }
  const artifacts = await compileFileArtifacts(input);
  const outputDir = dirname(output);
  await Deno.mkdir(outputDir, { recursive: true });
  for (const artifact of artifacts) {
    const target = artifact.kind === "entry" ? output : `${outputDir}/${artifact.path}`;
    await Deno.writeTextFile(target, artifact.code);
  }
  return 0;
}

async function compileLibraryCommand(args: string[]): Promise<number> {
  const [input, output] = args;
  if (!input) return missingInput("compile-library");
  const js = await compileLibraryFile(input);
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

async function replCommand(args: string[]): Promise<number> {
  const { input, options } = parseReplArguments(args);
  if (!input) return missingInput("repl");
  for await (const _ of watchReplChanges(input)) {
    try {
      const result = await evaluateReplFile(input, options);
      clearReplOutput();
      await Deno.stdout.write(result.stdout);
      await Deno.stderr.write(result.stderr);
      for (const error of result.staticErrors ?? []) reportReplError(error);
    } catch (error) {
      clearReplOutput();
      reportReplError(error);
    }
  }
  return 0;
}

export function parseReplArguments(args: string[]): {
  input: string | undefined;
  options: { frontend?: "v2" };
} {
  const v2 = args.includes("--v2");
  return {
    input: args.find((arg) => arg !== "--v2"),
    options: v2 ? { frontend: "v2" } : {},
  };
}

function clearReplOutput(): void {
  if (Deno.stdout.isTerminal()) console.log("\x1b[2J\x1b[H");
}

async function errCommand(args: string[]): Promise<number> {
  const [input] = args;
  if (!input) return missingInput("err");

  const inspections: string[] = [];
  let foundError = false;
  try {
    const compiled = await coreFile(input);
    for (const [path, result] of compiled.results) {
      const source = compiled.graph.nodes.get(path)?.source ?? "";
      for (const diagnostic of result.diagnostics) {
        inspections.push(formatDiagnosticInspection(diagnostic, path, source));
        foundError ||= diagnostic.severity === "error";
      }
    }
    const entryDiagnostic = runEntrypointDiagnostic(compiled);
    if (entryDiagnostic) {
      const entry = compiled.core.modules.get(compiled.core.entry)!;
      inspections.push(formatDiagnosticInspection(entryDiagnostic, entry.path, entry.source));
      foundError = true;
    }
  } catch (error) {
    foundError = true;
    if (error instanceof ModuleAnalysisError) {
      collectErrorInspections(error.originalError, error.path, error.source, inspections);
      for (const diagnostic of error.diagnostics) {
        inspections.push(formatDiagnosticInspection(diagnostic, error.path, error.source));
      }
    } else {
      collectErrorInspections(error, undefined, undefined, inspections);
    }
  }

  if (inspections.length === 0) {
    console.error("err: no compiler or runner errors found");
    return 0;
  }
  for (const [index, inspection] of uniqueInspections(inspections).entries()) {
    console.error(formatInspectionBlock(index + 1, inspection));
  }
  console.error("\n--- compiler state ---\n");
  console.error(await typeDebugFile(input));
  return foundError ? 1 : 0;
}

function collectErrorInspections(
  error: unknown,
  filePath: string | undefined,
  source: string | undefined,
  inspections: string[],
): void {
  if (error instanceof FrontendDiagnosticError) {
    inspections.push(formatDiagnosticInspection(error.diagnostic, filePath, source));
    return;
  }
  if (error instanceof FrontendDiagnosticBundleError) {
    collectErrorInspections(error.primary, filePath, source, inspections);
    for (const diagnostic of error.diagnostics) {
      inspections.push(formatDiagnosticInspection(diagnostic, filePath, source));
    }
    return;
  }
  if (error instanceof ParseError) {
    inspections.push(
      formatError(error.message, error.filePath ?? filePath, error.source ?? source, error.span),
    );
    return;
  }
  inspections.push(
    formatError(
      error instanceof Error ? error.message : String(error),
      filePath,
      source,
      undefined,
    ),
  );
}

function uniqueInspections(inspections: string[]): string[] {
  return [...new Set(inspections)];
}

function formatInspectionBlock(number: number, inspection: string): string {
  const label = `error ${number}`;
  return [
    inspectionDivider(label),
    inspection,
    inspectionDivider(`${label} end`),
  ].join("\n\n");
}

function inspectionDivider(label: string): string {
  return `-- ${label} ${"-".repeat(Math.max(1, 64 - label.length - 3))}`;
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
  const additional = error.diagnostics.map((diagnostic) =>
    formatDiagnostic(diagnostic, filePath, source)
  );
  return [primary, ...additional].join("");
}

function missingInput(command: string): number {
  console.error(`usage: wm ${command} <input.wm>`);
  console.error(`try: wm --help`);
  return 2;
}

function version(): void {
  console.log(`🗿 workman ${VERSION}`);
}

function usage(): void {
  console.log(`🗿 workman ${VERSION} - compiler and runner

usage:
  wm <command> [args]
  wm <file.wm> [out.js]

commands:
  check <file.wm>               typecheck a module graph
  compile <file.wm> [out.js]    emit JavaScript
  compile-library <file.wm> [out.js]
                                emit an importable ES module without running main
  run <file.wm> [-- args...]    compile and execute with Deno
  repl [--v2] <file.wm>         watch and evaluate top-level bindings
  err <file.wm>                 print authored diagnostics, evidence, and compiler state
  type-debug <file.wm>           print staged typechecker state on failure
  help                          show this help (-h, --help)
  version                       show the version (-v, -V, --version)

compat:
  wm <file.wm> [out.js]         same as wm compile <file.wm> [out.js]

examples:
  wm check examples/factorial.wm
  wm run examples/factorial.wm
  wm compile examples/factorial.wm out.mjs
  wm compile-library tooling/frontend-v2/library_fixture.wm frontend-v2.mjs
  wm run app.wm -- arg1 arg2
  wm repl --v2 scratch.wm

notes:
  JS FFI uses Deno under the hood. Runtime permissions come from the wm launcher.`);
}
