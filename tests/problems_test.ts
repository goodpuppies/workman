import { assertEquals } from "@std/assert";
import { collectProblems, type ProblemsSession, watchProject } from "../src/problems.ts";
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

Deno.test("problems TUI decodes clicks and wheel input in Workman", async () => {
  const probe = new URL("../tooling/problems/tui/mouse-probe.wm", import.meta.url).pathname;
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
  const data = `${directory}/problems.json`;
  const controller = new AbortController();
  try {
    await Deno.writeTextFile(input, "let answer = 42;");
    await Deno.writeTextFile(data, JSON.stringify({ revision: 0, problems: [] }));
    const watching = watchProject(input, data, controller.signal);

    await Deno.writeTextFile(input, "let answer: String = 42;");
    const broken = await waitForSnapshot(data, 1);
    assertEquals(broken.problems.map((problem) => problem.code), ["type.mismatch"]);

    await Deno.writeTextFile(input, "let answer = 42;");
    const fixed = await waitForSnapshot(data, 2);
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
  const data = `${directory}/problems.json`;
  const controller = new AbortController();
  let refreshes = 0;
  const session: ProblemsSession = {
    async refresh() {
      refreshes++;
      return [];
    },
    async close() {},
  };
  try {
    await Deno.writeTextFile(input, "let answer = 1;");
    await Deno.writeTextFile(data, JSON.stringify({ revision: 0, problems: [] }));
    const watching = watchProject(input, data, controller.signal, session);

    await Deno.writeTextFile(input, "let answer = 2;");
    await Deno.writeTextFile(input, "let answer = 3;");
    await Deno.writeTextFile(input, "let answer = 4;");
    await waitForSnapshot(data, 1);
    await new Promise((resolve) => setTimeout(resolve, 250));

    assertEquals(refreshes, 1);
    assertEquals(JSON.parse(await Deno.readTextFile(data)).revision, 1);
    controller.abort();
    await watching;
  } finally {
    controller.abort();
    await Deno.remove(directory, { recursive: true });
  }
});

async function waitForSnapshot(
  path: string,
  revision: number,
): Promise<{ revision: number; problems: { code: string }[] }> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const snapshot = JSON.parse(await Deno.readTextFile(path));
    if (snapshot.revision >= revision) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for problems revision ${revision}`);
}
