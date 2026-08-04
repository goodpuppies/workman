import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeMessages, encodeMessage, type RpcMessage } from "../src/lsp/rpc.ts";
import { createTemporaryDirectory, type TemporaryDirectory } from "../src/temporary_directory.ts";

type ServerName = "current" | "old";
type ScenarioName = "tiny" | "node-gotchi" | "file";

type Options = Readonly<{
  servers: readonly ServerName[];
  delayMs: number;
  quietMs: number;
  timeoutMs: number;
  cpuProfile: boolean;
  outputDir: string;
  scenario: ScenarioName;
  entry?: string;
  root?: string;
  deletePosition?: Readonly<{ line: number; column: number }>;
  initialDeletePosition?: Readonly<{ line: number; column: number }>;
  saveAfterMs?: number;
  watchedAfterMs?: number;
}>;

type ReceivedMessage = Readonly<{ message: RpcMessage; at: number }>;

type BenchmarkResult = Readonly<{
  server: ServerName;
  scenario: ScenarioName;
  typedCharacters: number;
  editCount: number;
  interKeyDelayMs: number;
  startupMs: number;
  initialDiagnosticsMs: number;
  typingWallMs: number;
  finalDiagnosticsAfterLastKeyMs: number;
  totalWallMs: number;
  mainDiagnosticPublications: number;
  publicationsDuringTyping: number;
  publicationsAfterLastKey: number;
  maximumWriteLagMs: number;
  matchedEditPublications: number;
  editDiagnostics: readonly Readonly<{
    version: number;
    latencyMs: number;
    count: number;
  }>[];
  diagnosticLatencyP50Ms?: number;
  diagnosticLatencyP95Ms?: number;
  diagnosticLatencyMaxMs?: number;
  activeCpuMs?: number;
  cpuUtilizationPercent?: number;
  exitCode: number;
  profile?: string;
}>;

type CpuProfile = Readonly<{
  nodes: readonly Readonly<{
    id: number;
    callFrame: Readonly<{ functionName: string }>;
  }>[];
  samples?: readonly number[];
  timeDeltas?: readonly number[];
}>;

type Scenario = Readonly<{
  directory: string;
  temporaryDirectory?: TemporaryDirectory;
  mainPath: string;
  initialSource: string;
  editSources: readonly string[];
  typedCharacters: number;
}>;

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

async function main(): Promise<void> {
  const options = parseOptions(Deno.args);
  await Deno.mkdir(options.outputDir, { recursive: true });
  const results: BenchmarkResult[] = [];
  for (const server of options.servers) {
    console.log(`\nprofiling ${server} LSP`);
    results.push(await benchmark(server, options));
  }
  await writeReports(results, options);
  printResults(results, options);
}

async function benchmark(server: ServerName, options: Options): Promise<BenchmarkResult> {
  const scenario = await prepareScenario(server, options);
  const { directory: projectDirectory, mainPath, initialSource, editSources } = scenario;

  const profileName = `${server}.cpuprofile`;
  const launch = serverLaunch(server, options, profileName);
  const startedAt = performance.now();
  const child = new Deno.Command(Deno.execPath(), {
    args: launch.args,
    cwd: launch.cwd,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const stderrPromise = new Response(child.stderr).text();
  const client = new LspClient(child.stdin, child.stdout);
  const mainUri = pathToFileURL(mainPath).href;

  try {
    await client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initializeParams(server, projectDirectory),
    });
    await client.waitFor(({ message }) => message.id === 1, 0, options.timeoutMs);
    const initializedAt = performance.now();

    await client.send({
      jsonrpc: "2.0",
      method: "initialized",
      params: {},
    });
    await client.send({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: mainUri,
          languageId: "workman",
          version: 1,
          text: initialSource,
        },
      },
    });
    const initialDiagnostics = await client.waitFor(
      (received) => isMainDiagnostics(received, mainUri),
      0,
      options.timeoutMs,
    );
    const initialDiagnosticsAt = performance.now();

    let version = 1;
    const typingStartedAt = performance.now();
    let maximumWriteLagMs = 0;
    const editSentAt: number[] = [];
    const editSentByVersion = new Map<number, number>();
    for (let index = 0; index < editSources.length; index++) {
      const intendedAt = typingStartedAt + index * options.delayMs;
      await delayUntil(intendedAt);
      maximumWriteLagMs = Math.max(maximumWriteLagMs, performance.now() - intendedAt);
      version++;
      editSentAt.push(performance.now());
      editSentByVersion.set(version, editSentAt.at(-1)!);
      await client.send({
        jsonrpc: "2.0",
        method: "textDocument/didChange",
        params: {
          textDocument: { uri: mainUri, version },
          contentChanges: [{ text: editSources[index] }],
        },
      });
      if (options.saveAfterMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, options.saveAfterMs));
        await client.send({
          jsonrpc: "2.0",
          method: "textDocument/didSave",
          params: { textDocument: { uri: mainUri } },
        });
      }
      if (options.watchedAfterMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, options.watchedAfterMs));
        await client.send({
          jsonrpc: "2.0",
          method: "workspace/didChangeWatchedFiles",
          params: { changes: [{ uri: mainUri, type: 2 }] },
        });
      }
    }
    const lastKeyAt = performance.now();

    await client.send({ jsonrpc: "2.0", id: 2, method: "shutdown", params: null });
    await client.waitFor(({ message }) => message.id === 2, 0, options.timeoutMs);
    await client.waitFor(
      (received) => received.at >= lastKeyAt && isMainDiagnostics(received, mainUri),
      0,
      options.timeoutMs,
    );
    await client.waitForDiagnosticQuiet(mainUri, options.quietMs, options.timeoutMs);
    const finalDiagnostics = client.lastDiagnostics(mainUri)!;
    const finalDiagnosticsAt = finalDiagnostics.at;
    if (
      diagnosticFingerprint(finalDiagnostics.message) !==
        diagnosticFingerprint(initialDiagnostics.message)
    ) {
      throw new Error(`${server} final diagnostics do not match the restored initial source`);
    }

    await client.send({ jsonrpc: "2.0", method: "exit", params: null });
    await client.closeInput();
    const status = await child.status;
    await client.finished;
    const stderr = await stderrPromise;
    if (!status.success) {
      throw new Error(`${server} LSP exited with ${status.code}:\n${stderr}`);
    }

    const mainPublications = client.messages.filter((received) =>
      isMainDiagnostics(received, mainUri)
    );
    const editPublications = mainPublications.filter((item) => item.at >= typingStartedAt);
    const editDiagnostics = server === "current"
      ? editPublications.flatMap((publication) => {
        const version = diagnosticVersion(publication.message);
        const sentAt = version === undefined ? undefined : editSentByVersion.get(version);
        return sentAt === undefined || version === undefined ? [] : [{
          version,
          latencyMs: publication.at - sentAt,
          count: diagnosticCount(publication.message),
        }];
      })
      : editPublications.length === editSentAt.length
      ? editSentAt.map((sentAt, index) => ({
        version: index + 2,
        latencyMs: editPublications[index].at - sentAt,
        count: diagnosticCount(editPublications[index].message),
      }))
      : [];
    const diagnosticLatencies = editDiagnostics.map((item) => item.latencyMs);
    const matchedEditPublications = diagnosticLatencies.length;
    const cpu = options.cpuProfile
      ? await summarizeCpuProfile(join(options.outputDir, profileName))
      : undefined;
    const finishedAt = performance.now();
    return {
      server,
      scenario: options.scenario,
      typedCharacters: scenario.typedCharacters,
      editCount: editSources.length,
      interKeyDelayMs: options.delayMs,
      startupMs: initializedAt - startedAt,
      initialDiagnosticsMs: initialDiagnosticsAt - initializedAt,
      typingWallMs: lastKeyAt - typingStartedAt,
      finalDiagnosticsAfterLastKeyMs: finalDiagnosticsAt - lastKeyAt,
      totalWallMs: finishedAt - startedAt,
      mainDiagnosticPublications: mainPublications.length,
      publicationsDuringTyping: mainPublications.filter((item) =>
        item.at >= typingStartedAt && item.at < lastKeyAt
      ).length,
      publicationsAfterLastKey: mainPublications.filter((item) => item.at >= lastKeyAt).length,
      maximumWriteLagMs,
      matchedEditPublications,
      editDiagnostics,
      diagnosticLatencyP50Ms: percentile(diagnosticLatencies, 0.5),
      diagnosticLatencyP95Ms: percentile(diagnosticLatencies, 0.95),
      diagnosticLatencyMaxMs: diagnosticLatencies.length
        ? Math.max(...diagnosticLatencies)
        : undefined,
      activeCpuMs: cpu?.activeMs,
      cpuUtilizationPercent: cpu?.utilizationPercent,
      exitCode: status.code,
      profile: options.cpuProfile ? join(options.outputDir, profileName) : undefined,
    };
  } finally {
    try {
      child.kill("SIGTERM");
    } catch {
      // The normal path has already exited and written its CPU profile.
    }
    await scenario.temporaryDirectory?.cleanup();
  }
}

class LspClient {
  readonly messages: ReceivedMessage[] = [];
  readonly finished: Promise<void>;
  #writer: WritableStreamDefaultWriter<Uint8Array>;
  #waiters = new Set<() => void>();

  constructor(
    input: WritableStream<Uint8Array>,
    output: ReadableStream<Uint8Array>,
  ) {
    this.#writer = input.getWriter();
    this.finished = this.#read(output);
  }

  async send(message: RpcMessage): Promise<void> {
    await this.#writer.write(encodeMessage(message));
  }

  async closeInput(): Promise<void> {
    await this.#writer.close();
  }

  async waitFor(
    predicate: (message: ReceivedMessage) => boolean,
    afterIndex: number,
    timeoutMs: number,
  ): Promise<ReceivedMessage> {
    const deadline = performance.now() + timeoutMs;
    while (true) {
      const found = this.messages.slice(afterIndex).find(predicate);
      if (found) return found;
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new Error("timed out waiting for an LSP message");
      await this.#waitForMessage(Math.min(remaining, 1_000));
    }
  }

  lastDiagnosticAt(uri: string): number | undefined {
    return this.lastDiagnostics(uri)?.at;
  }

  lastDiagnostics(uri: string): ReceivedMessage | undefined {
    return this.messages.findLast((received) => isMainDiagnostics(received, uri));
  }

  async waitForDiagnosticQuiet(uri: string, quietMs: number, timeoutMs: number): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (true) {
      const last = this.lastDiagnosticAt(uri);
      if (last !== undefined && performance.now() - last >= quietMs) return;
      if (performance.now() >= deadline) {
        throw new Error("timed out waiting for diagnostics to settle");
      }
      await this.#waitForMessage(Math.min(quietMs, 250));
    }
  }

  async #read(output: ReadableStream<Uint8Array>): Promise<void> {
    const reader = output.getReader();
    let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer = concatenate(buffer, chunk.value);
      const decoded = decodeMessages(buffer);
      buffer = decoded.rest;
      for (const message of decoded.messages) {
        this.messages.push({ message, at: performance.now() });
      }
      for (const wake of this.#waiters) wake();
      this.#waiters.clear();
    }
    for (const wake of this.#waiters) wake();
    this.#waiters.clear();
  }

  #waitForMessage(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.#waiters.delete(finish);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      this.#waiters.add(finish);
    });
  }
}

function serverLaunch(
  server: ServerName,
  options: Options,
  profileName: string,
): { cwd: string; args: string[] } {
  const cpu = options.cpuProfile
    ? [
      `--cpu-prof-dir=${options.outputDir}`,
      `--cpu-prof-name=${profileName}`,
      "--cpu-prof-md",
      "--cpu-prof-flamegraph",
    ]
    : [];
  return server === "current"
    ? {
      cwd: repositoryRoot,
      args: ["run", "-A", ...cpu, "src/lsp/server.ts"],
    }
    : {
      cwd: join(repositoryRoot, "research", "workman-old", "lsp", "server"),
      args: ["run", "-A", ...cpu, "src/server.ts"],
    };
}

function initializeParams(server: ServerName, project: string): Record<string, unknown> {
  const rootUri = pathToFileURL(project).href;
  return server === "current"
    ? { rootUri, workspaceFolders: [{ uri: rootUri, name: "lsp-typing" }] }
    : {
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: "lsp-typing" }],
      initializationOptions: {
        stdRoots: [join(repositoryRoot, "research", "workman-old", "std")],
      },
    };
}

function isMainDiagnostics(received: ReceivedMessage, mainUri: string): boolean {
  if (received.message.method !== "textDocument/publishDiagnostics") return false;
  const params = received.message.params as { uri?: unknown } | undefined;
  return params?.uri === mainUri;
}

function diagnosticFingerprint(message: RpcMessage): string {
  const params = message.params as { diagnostics?: unknown } | undefined;
  return JSON.stringify(Array.isArray(params?.diagnostics) ? params.diagnostics : []);
}

function diagnosticVersion(message: RpcMessage): number | undefined {
  const params = message.params as { version?: unknown } | undefined;
  return typeof params?.version === "number" ? params.version : undefined;
}

function diagnosticCount(message: RpcMessage): number {
  const params = message.params as { diagnostics?: unknown } | undefined;
  return Array.isArray(params?.diagnostics) ? params.diagnostics.length : 0;
}

function concatenate(
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
  const output = new Uint8Array(left.length + right.length);
  output.set(left);
  output.set(right, left.length);
  return output;
}

async function delayUntil(target: number): Promise<void> {
  const remaining = target - performance.now();
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

function parseOptions(args: readonly string[]): Options {
  let servers: readonly ServerName[] = ["current", "old"];
  let delayMs = 200;
  let quietMs = 1_000;
  let timeoutMs = 120_000;
  let cpuProfile = false;
  let outputDir = join(repositoryRoot, "profiles", "lsp-typing");
  let scenario: ScenarioName = "tiny";
  let entry: string | undefined;
  let root: string | undefined;
  let deletePosition: Readonly<{ line: number; column: number }> | undefined;
  let initialDeletePosition: Readonly<{ line: number; column: number }> | undefined;
  let saveAfterMs: number | undefined;
  let watchedAfterMs: number | undefined;
  for (const arg of args) {
    if (arg.startsWith("--server=")) {
      const value = arg.slice("--server=".length);
      if (value !== "current" && value !== "old" && value !== "both") {
        throw new Error(`invalid --server value: ${value}`);
      }
      servers = value === "both" ? ["current", "old"] : [value];
    } else if (arg.startsWith("--delay-ms=")) {
      delayMs = nonNegativeNumber(arg.slice("--delay-ms=".length), "--delay-ms");
    } else if (arg.startsWith("--quiet-ms=")) {
      quietMs = positiveNumber(arg.slice("--quiet-ms=".length), "--quiet-ms");
    } else if (arg.startsWith("--timeout-ms=")) {
      timeoutMs = positiveNumber(arg.slice("--timeout-ms=".length), "--timeout-ms");
    } else if (arg.startsWith("--output-dir=")) {
      outputDir = resolve(arg.slice("--output-dir=".length));
    } else if (arg.startsWith("--scenario=")) {
      const value = arg.slice("--scenario=".length);
      if (value !== "tiny" && value !== "node-gotchi" && value !== "file") {
        throw new Error(`invalid --scenario value: ${value}`);
      }
      scenario = value;
    } else if (arg.startsWith("--entry=")) {
      entry = resolve(arg.slice("--entry=".length));
      scenario = "file";
    } else if (arg.startsWith("--root=")) {
      root = resolve(arg.slice("--root=".length));
    } else if (arg.startsWith("--delete=")) {
      deletePosition = sourcePosition(arg.slice("--delete=".length), "--delete");
    } else if (arg.startsWith("--initial-delete=")) {
      initialDeletePosition = sourcePosition(
        arg.slice("--initial-delete=".length),
        "--initial-delete",
      );
    } else if (arg.startsWith("--save-after-ms=")) {
      saveAfterMs = nonNegativeNumber(arg.slice("--save-after-ms=".length), "--save-after-ms");
    } else if (arg.startsWith("--watched-after-ms=")) {
      watchedAfterMs = nonNegativeNumber(
        arg.slice("--watched-after-ms=".length),
        "--watched-after-ms",
      );
    } else if (arg === "--cpu-profile") {
      cpuProfile = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      Deno.exit(0);
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  if (scenario === "node-gotchi" && servers.includes("old")) {
    throw new Error("the node-gotchi scenario is only available for --server=current");
  }
  if (scenario === "file" && !entry) throw new Error("--scenario=file requires --entry=PATH");
  if (deletePosition && scenario !== "file") {
    throw new Error("--delete requires --entry=PATH");
  }
  if (initialDeletePosition && scenario !== "file") {
    throw new Error("--initial-delete requires --entry=PATH");
  }
  if (deletePosition && initialDeletePosition) {
    throw new Error("--delete and --initial-delete are mutually exclusive");
  }
  return {
    servers,
    delayMs,
    quietMs,
    timeoutMs,
    cpuProfile,
    outputDir,
    scenario,
    entry,
    root,
    deletePosition,
    initialDeletePosition,
    saveAfterMs,
    watchedAfterMs,
  };
}

async function prepareScenario(server: ServerName, options: Options): Promise<Scenario> {
  if (options.scenario === "file") {
    return await prepareFileScenario(
      options.entry!,
      options.root,
      options.deletePosition,
      options.initialDeletePosition,
    );
  }
  if (options.scenario === "node-gotchi") return await prepareNodeGotchiScenario();
  const fixture = join(repositoryRoot, "benchmarks", "lsp-typing", server);
  const temporaryDirectory = await createTemporaryDirectory({ prefix: `wm-lsp-${server}-` });
  const directory = temporaryDirectory.path;
  const mainPath = join(directory, "main.wm");
  const initialSource = await Deno.readTextFile(join(fixture, "main.wm"));
  const fragment = await Deno.readTextFile(
    join(repositoryRoot, "benchmarks", "lsp-typing", "typed-fragment.wm"),
  );
  await Deno.writeTextFile(mainPath, initialSource);
  await Deno.copyFile(join(fixture, "math.wm"), join(directory, "math.wm"));
  const editSources: string[] = [];
  let source = initialSource;
  for (const character of fragment) {
    source += character;
    editSources.push(source);
  }
  return {
    directory,
    temporaryDirectory,
    mainPath,
    initialSource,
    editSources,
    typedCharacters: fragment.length,
  };
}

async function prepareFileScenario(
  entry: string,
  root?: string,
  deletePosition?: Readonly<{ line: number; column: number }>,
  initialDeletePosition?: Readonly<{ line: number; column: number }>,
): Promise<Scenario> {
  const diskSource = await Deno.readTextFile(entry);
  const initialSource = initialDeletePosition
    ? deleteAt(diskSource, initialDeletePosition.line, initialDeletePosition.column)
    : diskSource;
  const editedSource = deletePosition
    ? deleteAt(initialSource, deletePosition.line, deletePosition.column)
    : initialDeletePosition
    ? diskSource
    : `${initialSource}\n`;
  return {
    directory: root ?? dirname(entry),
    mainPath: entry,
    initialSource,
    editSources: [editedSource, initialSource],
    typedCharacters: 1,
  };
}

function deleteAt(source: string, line: number, column: number): string {
  const lines = source.split("\n");
  const text = lines[line - 1];
  if (text === undefined) throw new Error(`--delete line ${line} does not exist`);
  if (column > text.length) {
    throw new Error(`--delete column ${column} is past line ${line}'s ${text.length} characters`);
  }
  const lineStart = lines.slice(0, line - 1).reduce((length, item) => length + item.length + 1, 0);
  const offset = lineStart + column - 1;
  return source.slice(0, offset) + source.slice(offset + 1);
}

function sourcePosition(
  value: string,
  option: string,
): Readonly<{ line: number; column: number }> {
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) throw new Error(`${option} must be LINE:COLUMN using one-based positions`);
  const line = positiveNumber(match[1], `${option} line`);
  const column = positiveNumber(match[2], `${option} column`);
  if (!Number.isInteger(line) || !Number.isInteger(column)) {
    throw new Error(`${option} must use integer positions`);
  }
  return { line, column };
}

async function prepareNodeGotchiScenario(): Promise<Scenario> {
  const initialSource = await Deno.readTextFile(join(repositoryRoot, "examples", "node-gotchi.wm"));
  const lines = initialSource.split("\n");
  const targetLine = lines[237];
  const lineWordOffset = targetLine?.indexOf("succeed") ?? -1;
  if (lineWordOffset < 0) throw new Error("expected `succeed` on node-gotchi.wm line 238");
  const lineStart = lines.slice(0, 237).reduce((length, line) => length + line.length + 1, 0);
  const wordStart = lineStart + lineWordOffset;
  const word = "succeed";
  let source = initialSource.slice(0, wordStart) + initialSource.slice(wordStart + word.length);
  const editSources = [source];
  for (let index = 0; index < word.length; index++) {
    source = source.slice(0, wordStart + index) + word[index] + source.slice(wordStart + index);
    editSources.push(source);
  }
  if (source !== initialSource) throw new Error("node-gotchi edit did not restore the source");
  const temporaryDirectory = await createTemporaryDirectory({
    dir: join(repositoryRoot, "examples"),
    prefix: ".lsp-node-gotchi-",
  });
  const directory = temporaryDirectory.path;
  const mainPath = join(directory, "node-gotchi.wm");
  await Deno.writeTextFile(mainPath, initialSource);
  return {
    directory,
    temporaryDirectory,
    mainPath,
    initialSource,
    editSources,
    typedCharacters: word.length,
  };
}

function positiveNumber(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${option} must be positive`);
  return parsed;
}

function nonNegativeNumber(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${option} must be non-negative`);
  return parsed;
}

async function summarizeCpuProfile(
  path: string,
): Promise<{ activeMs: number; utilizationPercent: number }> {
  const profile = JSON.parse(await Deno.readTextFile(path)) as CpuProfile;
  const names = new Map(profile.nodes.map((node) => [node.id, node.callFrame.functionName]));
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  let totalMicroseconds = 0;
  let idleMicroseconds = 0;
  for (let index = 0; index < Math.min(samples.length, deltas.length); index++) {
    const delta = deltas[index];
    totalMicroseconds += delta;
    if (names.get(samples[index]) === "(idle)") idleMicroseconds += delta;
  }
  const activeMicroseconds = totalMicroseconds - idleMicroseconds;
  return {
    activeMs: activeMicroseconds / 1_000,
    utilizationPercent: totalMicroseconds === 0 ? 0 : activeMicroseconds / totalMicroseconds * 100,
  };
}

function percentile(values: readonly number[], fraction: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function writeReports(results: readonly BenchmarkResult[], options: Options): Promise<void> {
  const jsonPath = join(options.outputDir, "summary.json");
  const markdownPath = join(options.outputDir, "summary.md");
  await Deno.writeTextFile(
    jsonPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), options, results }, null, 2)}\n`,
  );
  const rows = results.map((result) =>
    `| ${result.server} | ${formatMs(result.startupMs)} | ${
      formatMs(result.initialDiagnosticsMs)
    } | ${formatOptionalMs(result.diagnosticLatencyP50Ms)} | ` +
    `${formatOptionalMs(result.diagnosticLatencyP95Ms)} | ` +
    `${formatOptionalMs(result.diagnosticLatencyMaxMs)} | ${result.mainDiagnosticPublications} | ` +
    `${formatOptionalMs(result.activeCpuMs)} | ${
      formatOptionalPercent(result.cpuUtilizationPercent)
    } |`
  );
  await Deno.writeTextFile(
    markdownPath,
    `# LSP typing benchmark result\n\n` +
      `Scenario: ${options.scenario}; inter-key delay: ${options.delayMs} ms; edits: ${
        results[0]?.editCount ?? 0
      }; typed characters: ${results[0]?.typedCharacters ?? 0}.\n\n` +
      `| server | startup | initial diagnostics | diagnostic p50 | diagnostic p95 | ` +
      `diagnostic max | publications | active CPU | CPU utilization |\n` +
      `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows.join("\n")}\n\n` +
      `The old server does not include document versions in diagnostic notifications. Publication ` +
      `latencies pair edits and publications in observed order and should be read with that ` +
      `limitation. Active CPU excludes V8 samples attributed to \`(idle)\`.\n`,
  );
}

function printResults(results: readonly BenchmarkResult[], options: Options): void {
  console.log(`\nLSP typing comparison (${options.delayMs} ms between keys)`);
  console.log(
    "server   startup   diagnostic p50   diagnostic p95   active CPU   CPU utilization",
  );
  for (const result of results) {
    console.log(
      `${result.server.padEnd(8)} ${formatMs(result.startupMs).padStart(8)} ` +
        `${formatOptionalMs(result.diagnosticLatencyP50Ms).padStart(16)} ` +
        `${formatOptionalMs(result.diagnosticLatencyP95Ms).padStart(16)} ` +
        `${formatOptionalMs(result.activeCpuMs).padStart(12)} ` +
        `${formatOptionalPercent(result.cpuUtilizationPercent).padStart(15)}`,
    );
    for (const edit of result.editDiagnostics) {
      console.log(
        `  version ${edit.version}: ${formatMs(edit.latencyMs)}, ${edit.count} diagnostics`,
      );
    }
  }
  console.log(`reports: ${join(options.outputDir, "summary.md")}`);
}

function formatMs(value: number): string {
  return `${value.toFixed(1)} ms`;
}

function formatOptionalMs(value: number | undefined): string {
  return value === undefined ? "-" : formatMs(value);
}

function formatOptionalPercent(value: number | undefined): string {
  return value === undefined ? "-" : `${value.toFixed(1)}%`;
}

function usage(): void {
  console.log(`usage: deno run -A scripts/profile_lsp_typing.ts [options]

options:
  --server=current|old|both  servers to compare, default both
  --scenario=tiny|node-gotchi|file  benchmark scenario, default tiny
  --entry=PATH               profile an existing file without modifying it
  --root=PATH                workspace root for --entry, default entry directory
  --delete=LINE:COLUMN       delete one character in-memory, then restore it
  --initial-delete=LINE:COLUMN  open with one character deleted, then repair it
  --save-after-ms=N           send didSave N ms after every edit
  --watched-after-ms=N        send a watched-file change after every edit/save
  --delay-ms=N               delay between full-document changes, default 200
  --quiet-ms=N               diagnostic quiet period, default 1000
  --timeout-ms=N             per-stage timeout, default 120000
  --cpu-profile              profile each server and emit Markdown/flamegraph output
  --output-dir=PATH          result directory, default profiles/lsp-typing`);
}

await main();
