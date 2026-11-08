import { type CompileOptions, compileReplFileArtifacts, coreFile } from "./compiler.ts";
import denoConfig from "../deno.json" with { type: "json" };
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runtimeFlagsForJavaScript } from "./runtime_flags.ts";
import { maskSourceRange, topLevelPhraseEnd, topLevelPhraseRanges } from "./top_level_phrases.ts";
import {
  denoConfigArgs,
  handleTerminationSignals,
  linkProjectPackages,
  relayTerminationSignals,
  terminationExitCode,
} from "./child_runtime.ts";
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
import { FrontendV2ParseCache } from "./frontend_v2_parse_cache.ts";
import { ModuleAnalysisCache } from "./module_analysis_cache.ts";

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
  const temporaryDirectory = await createTemporaryDirectory({ prefix: "wm-repl-" });
  const dir = temporaryDirectory.path;
  try {
    const entry = artifacts.find((artifact) => artifact.kind === "entry") ?? artifacts[0];
    if (!entry) throw new Error("compiler produced no REPL artifact");
    await linkProjectPackages(dirname(inputPath), dir);
    for (const artifact of artifacts) {
      await Deno.writeTextFile(`${dir}/${artifact.path}`, artifact.code);
    }
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        ...denoConfigArgs(dirname(inputPath)),
        ...runtimeFlagsForJavaScript(entry.code),
        `${dir}/${entry.path}`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const stopRelaying = relayTerminationSignals(child);
    try {
      return await child.output();
    } finally {
      stopRelaying();
    }
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
/**
 * A session's modules exist only in memory, at these names in the working directory, so a phrase's
 * relative imports resolve from where `wm repl` was started. `<` and `>` keep them apart from real
 * files: Windows can't name a file with them, and nobody does elsewhere.
 */
function sessionModuleName(name: string): string {
  return `<repl-${name}>.wm`;
}

const REPL_PERVASIVES_FILE = sessionModuleName("pervasives");
const REPL_PERVASIVES_SOURCE = `from js.global("Deno") import { exit as hostExit };
// Never returns, so a call fits wherever a value of any type is expected.
let quit = () => {
  let _ = hostExit(${REPL_QUIT_EXIT_CODE});
  let rec unreachable = () => { unreachable() };
  unreachable()
};
`;
// A session is an ordinary module, so these are ordinary imports, loaded at startup and shadowed
// like any others. They're what an SML session has at top level; modules that `std` already
// provides, such as `List`, don't need a line here. `Io` and `Text` are SubsetML's counterparts of
// `TextIO` and Unicode text.
export const REPL_SESSION_HEADER = [
  `from "./${REPL_PERVASIVES_FILE}" import { quit };`,
  `from "basis/bool.wm" import * as Bool;`,
  `from "basis/char.wm" import * as Char;`,
  `from "basis/int.wm" import * as Int;`,
  `from "basis/io.wm" import * as Io;`,
  `from "basis/os.wm" import * as OS;`,
  `from "basis/string_cvt.wm" import * as StringCvt;`,
  `from "basis/text.wm" import * as Text;`,
].join("\n");

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
 * A session follows Section 8, "Programs", of the Definition of Standard ML (Revised). Each phrase
 * is its own module, `phrase_n.wm`, which re-exports the previous accepted phrase and then declares
 * its own bindings, so a later binding shadows an earlier one: B' = B ⊕ B1. One host process imports
 * each phrase's bundle once, and modules that earlier phrases initialized are shared through the
 * emitted registry, so no phrase is evaluated twice.
 *
 * - A phrase that fails to elaborate has no effect whatever (rule 189): it never runs.
 * - A phrase that raises keeps its effects on the state but doesn't change the basis (rule 190): the
 *   next phrase imports the previous accepted phrase, not this one.
 * - A phrase that succeeds extends the basis (rule 191).
 */
class PhraseSession {
  #sourceDirectory: string;
  #outputDirectory: string;
  #sources: Map<string, string>;
  #accepted = 0;
  #next = 1;
  /** Accepted `from js...` imports, which can't be re-exported, so every later phrase repeats them. */
  #jsImports: string[] = [];
  #host: ReplHost | undefined;

  /**
   * Phrase modules are entries of `sources`, the compile options' `sourceOverrides`, named as if
   * they were in `sourceDirectory`. Emitted code and the host go in `outputDirectory`.
   */
  constructor(sourceDirectory: string, outputDirectory: string, sources: Map<string, string>) {
    this.#sourceDirectory = sourceDirectory;
    this.#outputDirectory = outputDirectory;
    this.#sources = sources;
  }

  #path(name: string): string {
    return `${this.#sourceDirectory}/${sessionModuleName(name)}`;
  }

  get headerPath(): string {
    return this.#path("0");
  }

  start(): void {
    this.#sources.set(this.#path("pervasives"), REPL_PERVASIVES_SOURCE);
    // The header's imports are re-exported, so every phrase sees them, as SML's top level does.
    const header = REPL_SESSION_HEADER.split("\n").map((line) => `export ${line}`).join("\n");
    this.#sources.set(this.headerPath, `${header}\n`);
  }

  /** The source of a module that sees every accepted binding and then holds `body`. */
  #module(body: string): string {
    const imports = this.#jsImports.map((declaration) => `${declaration}\n`).join("");
    const accepted = sessionModuleName(String(this.#accepted));
    return `export from "./${accepted}" import *;\n${imports}${body}`;
  }

  async evaluate(phrase: string, options: CompileOptions): Promise<"accepted" | "raised" | "quit"> {
    const index = this.#next++;
    const path = this.#path(String(index));
    // An import phrase is re-exported, so the names it brings in stay visible to later phrases.
    const jsImport = /^\s*from\s+js\./.test(phrase);
    const source = jsImport ? phrase : phrase.replace(/^(\s*)from\s/, "$1export from ");
    this.#sources.set(path, this.#module(source));
    const artifacts = await compileReplFileArtifacts(path, options);
    const output = `${this.#outputDirectory}/${index}`;
    await Deno.mkdir(output);
    for (const artifact of artifacts) {
      await Deno.writeTextFile(`${output}/${artifact.path}`, artifact.code);
    }
    const entry = artifacts.find((artifact) => artifact.kind === "entry") ?? artifacts[0];
    if (!entry) throw new Error("compiler produced no REPL artifact");
    this.#host ??= await ReplHost.start(this.#outputDirectory, this.#sourceDirectory);
    const result = await this.#host.run(pathToFileURL(`${output}/${entry.path}`).href);
    if (result.kind === "exited") {
      this.#host = undefined;
      if (result.code === REPL_QUIT_EXIT_CODE) return "quit";
      // The session's state is gone with its process. Earlier phrases run again, once, when the
      // next phrase imports them.
      await Deno.stderr.write(new TextEncoder().encode(
        `the session's process exited with code ${result.code}; its state was lost\n`,
      ));
      return "raised";
    }
    if (result.code !== 0) return "raised";
    this.#accepted = index;
    if (jsImport) this.#jsImports.push(phrase.trim());
    return "accepted";
  }

  /** Types an expression against the accepted phrases without running anything. */
  async typeOf(expression: string, options: CompileOptions): Promise<string> {
    const path = this.#path("type");
    // The newline keeps a trailing comment from swallowing the parenthesis.
    this.#sources.set(path, this.#module(`let it = (${expression}\n);`));
    const { core } = await coreFile(path, { ...options, captureEntrySteps: true });
    const type = core.modules.get(core.entry)?.analysis.steps.at(-1)?.env.get("it")?.type;
    if (type === undefined) throw new Error(`cannot find the type of ${expression}`);
    return type;
  }

  async close(): Promise<void> {
    await this.#host?.close();
    this.#host = undefined;
  }
}

/**
 * Imports one phrase bundle per request and reports its exit status, then a marker, on stdout and
 * stderr. A bundle reports a raised exception through `Deno.exitCode` without exiting.
 */
const REPL_HOST_SOURCE = `const decoder = new TextDecoder();
const encoder = new TextEncoder();
let pending = "";
for await (const chunk of Deno.stdin.readable) {
  pending += decoder.decode(chunk, { stream: true });
  for (let newline = pending.indexOf("\\n"); newline >= 0; newline = pending.indexOf("\\n")) {
    const { url, marker } = JSON.parse(pending.slice(0, newline));
    pending = pending.slice(newline + 1);
    Deno.exitCode = 0;
    try {
      await import(url);
    } catch (error) {
      console.error("runtime[" + (error?.name ?? "Error") + "]: " + String(error?.message ?? error));
      Deno.exitCode = 1;
    }
    const code = Deno.exitCode;
    Deno.exitCode = 0;
    await Deno.stdout.write(encoder.encode(marker + code + "\\n"));
    await Deno.stderr.write(encoder.encode(marker + code + "\\n"));
  }
}
`;

type HostResult = { kind: "completed"; code: number } | { kind: "exited"; code: number };

class ReplHost {
  #child: Deno.ChildProcess;
  #writer: WritableStreamDefaultWriter<Uint8Array>;
  #stdout: MarkedStream;
  #stderr: MarkedStream;

  private constructor(child: Deno.ChildProcess) {
    this.#child = child;
    this.#writer = child.stdin.getWriter();
    this.#stdout = new MarkedStream(child.stdout, (chunk) => Deno.stdout.write(chunk));
    this.#stderr = new MarkedStream(child.stderr, (chunk) => Deno.stderr.write(chunk));
  }

  /** Starts a host in `directory` that runs with the configuration of the project at `project`. */
  static async start(directory: string, project: string): Promise<ReplHost> {
    const path = `${directory}/host.mjs`;
    await Deno.writeTextFile(path, REPL_HOST_SOURCE);
    await linkProjectPackages(project, directory);
    // One process serves every phrase, so it gets every runtime flag a phrase might need.
    const child = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", ...denoConfigArgs(project), "--unstable-webgpu", path],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    return new ReplHost(child);
  }

  async run(url: string): Promise<HostResult> {
    const marker = `\u0000wm-repl-done:${crypto.randomUUID()}:`;
    await this.#writer.write(new TextEncoder().encode(`${JSON.stringify({ url, marker })}\n`));
    const [stdout, stderr] = await Promise.all([
      this.#stdout.until(marker),
      this.#stderr.until(marker),
    ]);
    if (stdout === undefined || stderr === undefined) {
      return { kind: "exited", code: (await this.#child.status).code };
    }
    return { kind: "completed", code: stdout };
  }

  async close(): Promise<void> {
    try {
      await this.#writer.close();
    } catch {
      /* The process already ended. */
    }
    await this.#child.status;
    await Promise.all([this.#stdout.drain(), this.#stderr.drain()]);
  }
}

/** Forwards a stream as it arrives and finds the status a marker reports. */
class MarkedStream {
  #reader: ReadableStreamDefaultReader<Uint8Array>;
  #forward: (chunk: Uint8Array) => Promise<unknown>;
  #decoder = new TextDecoder();
  #encoder = new TextEncoder();
  #text = "";
  #ended = false;

  constructor(stream: ReadableStream<Uint8Array>, forward: (chunk: Uint8Array) => Promise<unknown>) {
    this.#reader = stream.getReader();
    this.#forward = forward;
  }

  /** Forwards output up to the marker and returns its status, or undefined if the stream ended. */
  async until(marker: string): Promise<number | undefined> {
    for (;;) {
      const at = this.#text.indexOf(marker);
      const end = at < 0 ? -1 : this.#text.indexOf("\n", at);
      if (end >= 0) {
        await this.#emit(this.#text.slice(0, at));
        const code = Number(this.#text.slice(at + marker.length, end));
        this.#text = this.#text.slice(end + 1);
        return code;
      }
      // Keep a possible start of the marker back until the next chunk shows whether it is one.
      const keep = at >= 0 ? this.#text.length - at : Math.min(this.#text.length, marker.length);
      await this.#emit(this.#text.slice(0, this.#text.length - keep));
      this.#text = this.#text.slice(this.#text.length - keep);
      if (this.#ended) {
        await this.#emit(this.#text);
        this.#text = "";
        return undefined;
      }
      const { value, done } = await this.#reader.read();
      if (done) this.#ended = true;
      else this.#text += this.#decoder.decode(value, { stream: true });
    }
  }

  async drain(): Promise<void> {
    while (!this.#ended) {
      const { value, done } = await this.#reader.read();
      if (done) this.#ended = true;
      else this.#text += this.#decoder.decode(value, { stream: true });
    }
    await this.#emit(this.#text);
    this.#text = "";
  }

  async #emit(text: string): Promise<void> {
    if (text) await this.#forward(this.#encoder.encode(text));
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
 * Interactive session following Section 8 "Programs" of the Definition of
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
  const { input: stdin, ...sessionOptions } = options;
  const sources = new Map(sessionOptions.sourceOverrides ?? []);
  // Each phrase compiles its module and everything it imports, so the session keeps what it parsed.
  const compileOptions: CompileOptions = {
    ...sessionOptions,
    frontendV2ParseCache: sessionOptions.frontendV2ParseCache ?? new FrontendV2ParseCache(),
    // A phrase analyzes only itself and what it newly imports, as an SML top level elaborates a
    // phrase against the static basis it already holds.
    moduleAnalysisCache: sessionOptions.moduleAnalysisCache ?? new ModuleAnalysisCache(),
    sourceOverrides: sources,
  };
  // Only emitted code touches the disk, in the OS temporary directory.
  const temporaryDirectory = await createTemporaryDirectory({ prefix: "wm-repl-" });
  const session = new PhraseSession(Deno.cwd(), temporaryDirectory.path, sources);
  session.start();
  let editor: TerminalEditor | undefined;
  let loadingBar: LoadingBar | undefined;
  let interruption: Promise<void> | undefined;
  const endSession = (code: number) => {
    loadingBar?.finish();
    editor?.release();
    interruption ??= temporaryDirectory.cleanup().then(() => Deno.exit(code));
    return interruption;
  };
  // A closed terminal or a `kill` ends the session as Ctrl-C does, so the session cleans up. The
  // host's stdin closes with this process, so it ends too.
  const stopHandlingSignals = handleTerminationSignals((signal) => {
    endSession(terminationExitCode[signal]);
  });
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
        await endSession(130);
        return;
      }
      const entry = result.text.trimEnd();
      record(entry);
      // What can follow the end is only comments, and a command without an expression has no end.
      yield entry.slice(0, topLevelPhraseEnd(entry));
    }
  }
  try {
    if (editor) {
      // Keys pressed while loading become the start of the first input.
      editor.holdInput();
      loadingBar = createLoadingBar();
    }
    await warmSession(session.headerPath, compileOptions, loadingBar);
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
        output = await session.typeOf(command.argument, compileOptions);
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
      try {
        // Output streams while the phrase runs, so the editor gives the terminal back first.
        editor?.release();
        if (await session.evaluate(phrase, compileOptions) === "quit") break;
      } catch (error) {
        editor?.release();
        onError(error);
      }
    }
  } finally {
    editor?.release();
    stopHandlingSignals();
    await session.close();
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
