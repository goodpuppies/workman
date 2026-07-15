import { type CompileOptions, compileReplFileArtifacts } from "./compiler.ts";
import { dirname, resolve } from "node:path";

export type ReplEvaluation = {
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
  staticErrors?: unknown[];
};

export async function evaluateReplFile(
  input: string,
  options: CompileOptions = {},
): Promise<ReplEvaluation> {
  const inputPath = await Deno.realPath(resolve(input));
  const source = await Deno.readTextFile(inputPath);
  try {
    const artifacts = await compileReplFileArtifacts(inputPath, options);
    return await executeReplArtifacts(inputPath, artifacts);
  } catch (fullError) {
    let successfulArtifacts: Awaited<ReturnType<typeof compileReplFileArtifacts>> | undefined;
    const staticErrors: unknown[] = [];
    let committedSource = source;
    let attemptedPhrase = false;
    for (const { start, end } of topLevelPhraseRanges(source)) {
      attemptedPhrase = true;
      try {
        successfulArtifacts = await compileReplFileArtifacts(
          inputPath,
          withEntrySource(options, inputPath, committedSource.slice(0, end)),
        );
      } catch (error) {
        staticErrors.push(error);
        committedSource = maskSourceRange(committedSource, start, end);
      }
    }
    if (!attemptedPhrase) staticErrors.push(fullError);
    const prior = successfulArtifacts
      ? await executeReplArtifacts(inputPath, successfulArtifacts)
      : emptyEvaluation();
    return { ...prior, code: 1, staticErrors };
  }
}

async function executeReplArtifacts(
  inputPath: string,
  artifacts: Awaited<ReturnType<typeof compileReplFileArtifacts>>,
): Promise<ReplEvaluation> {
  const dir = await Deno.makeTempDir({ dir: dirname(inputPath), prefix: ".wm-mini-repl-" });
  try {
    const entry = artifacts.find((artifact) => artifact.kind === "entry") ?? artifacts[0];
    if (!entry) throw new Error("compiler produced no REPL artifact");
    for (const artifact of artifacts) {
      await Deno.writeTextFile(`${dir}/${artifact.path}`, artifact.code);
    }
    return await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", ...runtimeFlags(entry.code), `${dir}/${entry.path}`],
      stdout: "piped",
      stderr: "piped",
    }).output();
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

function withEntrySource(
  options: CompileOptions,
  inputPath: string,
  source: string,
): CompileOptions {
  return {
    ...options,
    sourceOverrides: new Map([...(options.sourceOverrides ?? []), [inputPath, source]]),
  };
}

function emptyEvaluation(): ReplEvaluation {
  return { code: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
}

export function topLevelPhraseRanges(source: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const stack: string[] = [];
  let stringEnd: '"' | "`" | undefined;
  let escaped = false;
  let lineComment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n" || char === "\r") lineComment = false;
      continue;
    }
    if (stringEnd) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === stringEnd) stringEnd = undefined;
      continue;
    }
    if ((char === "/" && next === "/") || (char === "-" && next === "-")) {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "`") {
      stringEnd = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") stack.push(char);
    else if (char === ")" || char === "]" || char === "}") stack.pop();
    else if (char === ";" && stack.length === 0) {
      const start = ranges.at(-1)?.end ?? 0;
      ranges.push({ start, end: index + 1 });
    }
  }
  const trailingStart = ranges.at(-1)?.end ?? 0;
  if (source.slice(trailingStart).trim()) ranges.push({ start: trailingStart, end: source.length });
  return ranges;
}

function maskSourceRange(source: string, start: number, end: number): string {
  const masked = source.slice(start, end).replace(/[^\r\n]/g, " ");
  return source.slice(0, start) + masked + source.slice(end);
}

export async function* watchReplChanges(input: string): AsyncGenerator<void> {
  const inputPath = resolve(input);
  yield;
  const watcher = Deno.watchFs(dirname(inputPath));
  try {
    for await (const event of watcher) {
      if (!event.paths.some((path) => resolve(path) === inputPath)) continue;
      yield;
    }
  } finally {
    watcher.close();
  }
}

function runtimeFlags(js: string): string[] {
  return js.includes("Deno.UnsafeWindowSurface") ? ["--unstable-webgpu"] : [];
}
