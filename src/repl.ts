import { type CompileOptions, compileReplFileArtifacts } from "./compiler.ts";
import denoConfig from "../deno.json" with { type: "json" };
import { dirname, resolve } from "node:path";
import { runtimeFlagsForJavaScript } from "./runtime_flags.ts";
import {
  maskSourceRange,
  topLevelPhraseEnd,
  topLevelPhraseRanges,
} from "./top_level_phrases.ts";
import { createTemporaryDirectory } from "./temporary_directory.ts";

export { topLevelPhraseRanges } from "./top_level_phrases.ts";

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
  const temporaryDirectory = await createTemporaryDirectory({
    dir: dirname(inputPath),
    prefix: ".wm-mini-repl-",
  });
  const dir = temporaryDirectory.path;
  try {
    const entry = artifacts.find((artifact) => artifact.kind === "entry") ?? artifacts[0];
    if (!entry) throw new Error("compiler produced no REPL artifact");
    for (const artifact of artifacts) {
      await Deno.writeTextFile(`${dir}/${artifact.path}`, artifact.code);
    }
    return await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", ...runtimeFlagsForJavaScript(entry.code), `${dir}/${entry.path}`],
      stdout: "piped",
      stderr: "piped",
    }).output();
  } finally {
    await temporaryDirectory.cleanup();
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

export type InteractiveReplOptions = CompileOptions & {
  /** Reports static (parse/elaboration) errors for a rejected phrase. */
  onError?: (error: unknown) => void;
  /** Stdin source; defaults to Deno.stdin.readable. */
  input?: ReadableStream<Uint8Array>;
  /** Suppresses the primary/continuation prompts (non-interactive input). */
  quiet?: boolean;
};

/**
 * Interactive session following Section 7 "Programs" of the Definition of
 * Standard ML (Revised): upon `;` the machine parses, elaborates, and
 * evaluates the phrase against the accumulated basis. A failing elaboration
 * has no effect whatever (rule 65.2), and an evaluation that raises an
 * exception leaves the basis unchanged, so in both cases the phrase is
 * rejected and the session environment is unchanged.
 */
export async function runInteractiveRepl(
  options: InteractiveReplOptions = {},
): Promise<void> {
  const onError = options.onError ??
    ((error) => console.error(error instanceof Error ? error.message : String(error)));
  const { input: stdin, ...compileOptions } = options;
  const temporaryDirectory = await createTemporaryDirectory({
    dir: Deno.cwd(),
    prefix: ".wm-mini-repl-",
  });
  const sessionPath = `${temporaryDirectory.path}/session.wm`;
  let committed = "";
  let committedStdout = 0;
  let committedStderr = 0;
  let interrupted = false;
  const onInterrupt = () => {
    if (interrupted) return;
    interrupted = true;
    void temporaryDirectory.cleanup().then(() => Deno.exit(130));
  };
  Deno.addSignalListener("SIGINT", onInterrupt);
  try {
    await Deno.stdout.write(
      new TextEncoder().encode(
        `🗿 workman ${denoConfig.version} repl\nPress Ctrl-C or Ctrl-D to exit.\n`,
      ),
    );
    for await (const phrase of phrases(stdin ?? Deno.stdin.readable, options.quiet)) {
      const candidate = committed ? `${committed}\n${phrase}` : phrase;
      try {
        await Deno.writeTextFile(sessionPath, candidate);
        const artifacts = await compileReplFileArtifacts(sessionPath, compileOptions);
        const result = await executeReplArtifacts(sessionPath, artifacts);
        await Deno.stdout.write(result.stdout.subarray(committedStdout));
        await Deno.stderr.write(result.stderr.subarray(committedStderr));
        if (result.code === 0) {
          committed = candidate;
          committedStdout = result.stdout.length;
          committedStderr = result.stderr.length;
        }
      } catch (error) {
        onError(error);
      }
    }
  } finally {
    Deno.removeSignalListener("SIGINT", onInterrupt);
    if (!interrupted) await temporaryDirectory.cleanup();
  }
}


/**
 * Reads phrases from stdin, prompting `- ` for a new phrase and `= ` for its
 * continuation. A phrase is delivered once its terminating top-level `;` has
 * arrived; anything left over carries into the next phrase. At EOF any
 * unterminated trailing phrase is delivered, matching the trailing-phrase
 * treatment of watched REPL files.
 */
async function* phrases(
  stdin: ReadableStream<Uint8Array>,
  quiet: boolean | undefined,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const prompt = async (text: string) => {
    if (!quiet) await Deno.stdout.write(new TextEncoder().encode(text));
  };
  let pending = "";
  let needPrompt = false;
  await prompt("- ");
  for await (const chunk of stdin) {
    const lines = decoder.decode(chunk, { stream: true }).split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const completeLine = index < lines.length - 1;
      if (needPrompt) {
        await prompt(pending.trim() ? "= " : "- ");
        needPrompt = false;
      }
      pending = pending ? `${pending}\n${line}` : line;
      if (completeLine) needPrompt = true;
      for (;;) {
        const end = topLevelPhraseEnd(pending);
        if (end === undefined) break;
        const phrase = pending.slice(0, end);
        pending = pending.slice(end);
        yield phrase;
        needPrompt = true;
      }
    }
  }
  if (pending.trim()) yield pending;
}
