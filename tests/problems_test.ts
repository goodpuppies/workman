import { assertEquals, assertRejects } from "@std/assert";
import {
  collectProblems,
  collectSnapshot,
  defaultEntrypoint,
  type ProblemsSession,
  startProblemsSession,
  watchProject,
} from "../src/problems.ts";
import { current, nextSnapshot, publish, reset } from "../src/problems_client.ts";
import { runFile } from "../src/run.ts";

Deno.test("problems collects a stable snapshot from a separate LSP process", async () => {
  const directory = await Deno.makeTempDir();
  const input = `${directory}/main.wm`;
  try {
    await Deno.writeTextFile(input, "let answer: String = 42;");
    const problems = await collectProblems(input);
    assertEquals(
      problems.map(({ path, line, severity, code }) => ({ path, line, severity, code })),
      [
        { path: "main.wm", line: 1, severity: 1, code: "type.mismatch" },
      ],
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("problems reports the project head owning the entrypoint", async () => {
  const directory = await Deno.makeTempDir();
  const input = `${directory}/main.wm`;
  try {
    await Deno.writeTextFile(`${directory}/helper.wm`, "let answer = 42;");
    await Deno.writeTextFile(
      input,
      'from "./helper.wm" import { answer };\nlet main = () => { print(Result.textOf(answer)) };\n',
    );
    const snapshot = await collectSnapshot(input);
    assertEquals(snapshot.head.kind, "headed");
    assertEquals(snapshot.head.path, "main.wm");
    assertEquals(snapshot.head.moduleCount, 2);
    assertEquals(snapshot.head.recovered, false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("problems defaults to main.wm, then to a lone .wm file", async () => {
  const directory = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${directory}/only.wm`, "let answer = 42;");
    assertEquals(await defaultEntrypoint(directory), `${directory}/only.wm`);

    await Deno.writeTextFile(`${directory}/main.wm`, "let answer = 42;");
    assertEquals(await defaultEntrypoint(directory), `${directory}/main.wm`);

    await Deno.remove(`${directory}/main.wm`);
    await Deno.writeTextFile(`${directory}/other.wm`, "let answer = 42;");
    assertEquals(await defaultEntrypoint(directory), undefined);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

// The TUI exits by ending the process, so `problemsCommand` tears the session
// down from an `unload` handler, where only synchronous work can run.
Deno.test("problems session disposes synchronously without awaiting shutdown", async () => {
  const directory = await Deno.makeTempDir();
  const input = `${directory}/main.wm`;
  try {
    await Deno.writeTextFile(input, "let answer = 42;");
    const session = await startProblemsSession(input);
    await session.refresh();
    session.dispose();
    await assertRejects(() => session.refresh(), Error, "closed");
    await session.close();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("problems TUI wraps diagnostic text to the terminal width", async () => {
  const probe = new URL("../tooling/problems/wrap-probe.wm", import.meta.url).pathname;
  const result = await runFile(probe, { stdout: "piped", stderr: "piped", progress: false });

  assertEquals(result.code, 0);
  assertEquals(
    new TextDecoder().decode(result.stdout),
    "type mismatch|between String|and Number\n" +
      "main.wm:1:1|error [type.mismatch]\n" +
      "supercal|ifragili|stic\n" +
      "[]\n",
  );
  assertEquals(new TextDecoder().decode(result.stderr), "");
});

Deno.test("problems TUI decodes clicks and wheel input in Workman", async () => {
  const probe = new URL("../tooling/tuiman/mouse-probe.wm", import.meta.url).pathname;
  const result = await runFile(probe, { stdout: "piped", stderr: "piped", progress: false });

  assertEquals(result.code, 0);
  assertEquals(new TextDecoder().decode(result.stdout), "click 11,6\nup\ndown\n");
  assertEquals(new TextDecoder().decode(result.stderr), "");
});

Deno.test("problems TUI toggles severity filters in Workman", async () => {
  const probe = new URL("../tooling/problems/filter-probe.wm", import.meta.url).pathname;
  const result = await runFile(probe, { stdout: "piped", stderr: "piped", progress: false });

  assertEquals(result.code, 0);
  assertEquals(new TextDecoder().decode(result.stdout), "4,3,4\n");
  assertEquals(new TextDecoder().decode(result.stderr), "");
});

Deno.test("problems watcher adds and clears diagnostics after saves", async () => {
  const directory = await Deno.makeTempDir();
  const input = `${directory}/main.wm`;
  const controller = new AbortController();
  reset();
  try {
    await Deno.writeTextFile(input, "let answer = 42;");
    const watching = watchProject(input, controller.signal);

    await Deno.writeTextFile(input, "let answer: String = 42;");
    const broken = await nextSnapshot(0);
    assertEquals(broken.problems.map((problem) => problem.code), ["type.mismatch"]);

    await Deno.writeTextFile(input, "let answer = 42;");
    const fixed = await nextSnapshot(broken.revision);
    assertEquals(fixed.problems, []);

    controller.abort();
    await watching;
  } finally {
    controller.abort();
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("problems watcher coalesces one editor save burst", async () => {
  const directory = await Deno.makeTempDir();
  const input = `${directory}/main.wm`;
  const controller = new AbortController();
  let refreshes = 0;
  const session: ProblemsSession = {
    async refresh() {
      refreshes++;
      return { problems: [], head: detachedHead };
    },
    async close() {},
    dispose() {},
  };
  reset();
  try {
    await Deno.writeTextFile(input, "let answer = 1;");
    const watching = watchProject(input, controller.signal, session);

    await Deno.writeTextFile(input, "let answer = 2;");
    await Deno.writeTextFile(input, "let answer = 3;");
    await Deno.writeTextFile(input, "let answer = 4;");
    await nextSnapshot(0);
    await new Promise((resolve) => setTimeout(resolve, 250));

    assertEquals(refreshes, 1);
    assertEquals(current().revision, 1);
    controller.abort();
    await watching;
  } finally {
    controller.abort();
    await Deno.remove(directory, { recursive: true });
  }
});

// A waiter parked before the publish must be woken by it, not left for a poll.
Deno.test("problems client wakes a waiter parked before the publish", async () => {
  reset();
  const waiting = nextSnapshot(0);
  let settled = false;
  void waiting.then(() => (settled = true));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assertEquals(settled, false);

  publish([], detachedHead);
  const snapshot = await waiting;
  assertEquals(snapshot.revision, 1);
  // A revision already in hand resolves without waiting for another publish.
  assertEquals((await nextSnapshot(0)).revision, 1);
  reset();
});

const detachedHead = { kind: "detached", path: "main.wm", moduleCount: 0, recovered: false };
