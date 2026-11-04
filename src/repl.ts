import { type CompileOptions, compileReplFileArtifacts, coreFile } from "./compiler.ts";
import denoConfig from "../deno.json" with { type: "json" };
import { dirname, resolve } from "node:path";
import { runtimeFlagsForJavaScript } from "./runtime_flags.ts";
import { maskSourceRange, topLevelPhraseEnd, topLevelPhraseRanges } from "./top_level_phrases.ts";
import { createTemporaryDirectory } from "./temporary_directory.ts";
import { readReplHistory, recordReplHistory, replHistoryFile } from "./repl_history.ts";
import {
  isReplCommand,
  parseReplCommand,
  replCommandNeedsSemicolon,
  replHelpText,
} from "./repl_commands.ts";
import { editorPrompts, TerminalEditor } from "./repl_editor.ts";
import { highlightSpans } from "./repl_highlight.ts";
import { type ReplSettings, replSettings } from "./user_config.ts";
import { createLoadingBar, type LoadingBar } from "./repl_loading.ts";
import { observeLibraryLoad } from "./standard_library.ts";

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

/**
 * An evaluation ending with this code asked to leave the session. The phrase runs in a
 * child process, so `quit` can only end that child; the parent reads this code to stop.
 */
const REPL_QUIT_EXIT_CODE = 113;

/** REPL-only pervasives. The session imports this module, so `let quit = ...` still shadows it. */
const REPL_PERVASIVES_FILE = "repl_pervasives.wm";
const REPL_PERVASIVES_SOURCE = `from js.global("Deno") import { exit as hostExit };
// Never returns, so a call fits wherever a value of any type is expected.
let quit = () => {
  let _ = hostExit(${REPL_QUIT_EXIT_CODE});
  let rec unreachable = () => { unreachable() };
  unreachable()
};
`;
const REPL_SESSION_HEADER = `from "./${REPL_PERVASIVES_FILE}" import { quit };`;

/**
 * Compiles the empty session so the first phrase finds the standard library already loaded. A
 * failure is ignored here: the first phrase hits the same error and reports it properly.
 */
async function warmSession(
  sessionPath: string,
  options: CompileOptions,
  bar: LoadingBar | undefined,
): Promise<void> {
  observeLibraryLoad(bar?.observer);
  try {
    await compileReplFileArtifacts(sessionPath, {
      ...options,
      onStage: (name) => {
        bar?.stage(name);
        options.onStage?.(name);
      },
    });
  } catch {
    /* Reported by the first phrase. */
  } finally {
    observeLibraryLoad(undefined);
    bar?.finish();
  }
}

/**
 * Types an expression against the session without emitting or running anything. The binding is new
 * to this compile, and the newline keeps a trailing comment from swallowing the parenthesis.
 */
async function typeOfExpression(
  sessionPath: string,
  committed: string,
  expression: string,
  options: CompileOptions,
): Promise<string> {
  try {
    await Deno.writeTextFile(sessionPath, `${committed}\nlet it = (${expression}\n);`);
    const { core } = await coreFile(sessionPath, options);
    const type = core.modules.get(core.entry)?.analysis.steps.at(-1)?.env.get("it")?.type;
    if (type === undefined) throw new Error(`cannot find the type of ${expression}`);
    return type;
  } finally {
    await Deno.writeTextFile(sessionPath, committed);
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
  await Deno.writeTextFile(
    `${temporaryDirectory.path}/${REPL_PERVASIVES_FILE}`,
    REPL_PERVASIVES_SOURCE,
  );
  let committed = REPL_SESSION_HEADER;
  let committedStdout = 0;
  let committedStderr = 0;
  let editor: TerminalEditor | undefined;
  let loadingBar: LoadingBar | undefined;
  let interruption: Promise<void> | undefined;
  const onInterrupt = () => {
    loadingBar?.finish();
    editor?.release();
    interruption ??= temporaryDirectory.cleanup().then(() => Deno.exit(130));
    return interruption;
  };
  Deno.addSignalListener("SIGINT", onInterrupt);
  const isTerminal = !stdin && !options.quiet && Deno.stdin.isTerminal() &&
    Deno.stdout.isTerminal();
  let historyFile: string | undefined;
  let history: string[] = [];
  let historyWarning = false;
  const reportHistoryError = (error: unknown) => {
    if (historyWarning) return;
    historyWarning = true;
    console.error(
      `warning: REPL history unavailable: ${error instanceof Error ? error.message : error}`,
    );
  };
  if (isTerminal) {
    try {
      historyFile = replHistoryFile();
      history = readReplHistory(historyFile);
    } catch (error) {
      reportHistoryError(error);
    }
  }
  // Piped input ignores this, so a script's output doesn't depend on this user's setup.
  let settings: ReplSettings = {};
  if (isTerminal) {
    try {
      settings = replSettings();
    } catch (error) {
      console.error(
        `warning: using the default REPL settings: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }
  editor = isTerminal
    ? new TerminalEditor(
      history,
      editorPrompts(settings),
      settings.highlight !== false && !Deno.noColor ? highlightSpans : undefined,
    )
    : undefined;
  const record = (entry: string) => {
    editor?.remember(entry);
    if (!historyFile) return;
    try {
      recordReplHistory(historyFile, entry);
    } catch (error) {
      reportHistoryError(error);
    }
  };
  async function* editedPhrases(terminal: TerminalEditor): AsyncGenerator<string> {
    for (;;) {
      const result = await terminal.read();
      if (result.kind === "eof") return;
      if (result.kind === "interrupt") {
        await onInterrupt();
        return;
      }
      const entry = result.text.trimEnd();
      record(entry);
      // What can follow the end is only comments, and a command without an expression has no end.
      yield entry.slice(0, topLevelPhraseEnd(entry));
    }
  }
  try {
    await Deno.writeTextFile(sessionPath, committed);
    if (editor) {
      // Keys pressed while loading become the start of the first input.
      editor.holdInput();
      loadingBar = createLoadingBar();
    }
    await warmSession(sessionPath, compileOptions, loadingBar);
    await Deno.stdout.write(
      new TextEncoder().encode(
        `🗿 Workman ${denoConfig.version}\n${
          editor ? "Exit using ctrl+d, ctrl+c, or quit()" : "Press Ctrl-C or Ctrl-D to exit."
        }\n`,
      ),
    );
    const inputPhrases = editor
      ? editedPhrases(editor)
      : phrases(stdin ?? Deno.stdin.readable, options.quiet);
    const runCommand = async (text: string) => {
      const command = parseReplCommand(text);
      let output: string;
      if (command.kind === "error") output = command.message;
      else if (command.name === "help") output = replHelpText(command.argument);
      else if (!command.argument) output = "usage: :type <expression>;";
      else {
        output = await typeOfExpression(sessionPath, committed, command.argument, compileOptions);
      }
      await Deno.stdout.write(new TextEncoder().encode(`${output}\n`));
    };
    for await (const phrase of inputPhrases) {
      if (isReplCommand(phrase)) {
        editor?.release();
        try {
          await runCommand(phrase);
        } catch (error) {
          onError(error);
        }
        continue;
      }
      const candidate = committed ? `${committed}\n${phrase}` : phrase;
      try {
        await Deno.writeTextFile(sessionPath, candidate);
        const artifacts = await compileReplFileArtifacts(sessionPath, compileOptions);
        const result = await executeReplArtifacts(sessionPath, artifacts);
        editor?.release();
        await Deno.stdout.write(result.stdout.subarray(committedStdout));
        await Deno.stderr.write(result.stderr.subarray(committedStderr));
        if (result.code === REPL_QUIT_EXIT_CODE) break;
        if (result.code === 0) {
          committed = candidate;
          committedStdout = result.stdout.length;
          committedStderr = result.stderr.length;
        }
      } catch (error) {
        editor?.release();
        onError(error);
      } finally {
        // The on-disk session must agree with the accepted basis even after a
        // parse, type, or runtime error. Compile the next candidate from that basis.
        await Deno.writeTextFile(sessionPath, committed);
      }
    }
  } finally {
    editor?.release();
    Deno.removeSignalListener("SIGINT", onInterrupt);
    if (!interruption) await temporaryDirectory.cleanup();
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
  stdin: AsyncIterable<Uint8Array>,
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
      pending += line + (completeLine ? "\n" : "");
      if (completeLine) needPrompt = true;
      if (completeLine && isReplCommand(pending) && !replCommandNeedsSemicolon(pending)) {
        yield pending;
        pending = "";
        continue;
      }
      // A read can end anywhere, including inside an identifier or just after
      // a semicolon. Only submit complete lines (or the trailing input at EOF).
      if (!completeLine) continue;
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
