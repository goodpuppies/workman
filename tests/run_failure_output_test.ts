import { assertEquals, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";

const config = fileURLToPath(new URL("../deno.json", import.meta.url));
const runner = new URL("../src/run.ts", import.meta.url).href;

for (const terminal of [true, false]) {
  for (const silent of [true, false]) {
    Deno.test(`run preserves failure diagnostics (terminal=${terminal}, silent=${silent})`, async () => {
      const directory = await Deno.makeTempDir();
      try {
        const input = `${directory}/main.wm`;
        const harness = `${directory}/runner.mjs`;
        await Deno.writeTextFile(
          input,
          silent
            ? 'from js.global("process") import unsafe { exit: Number -> Void }; let main = () => { exit(7) };'
            : 'let main = () => { Panic("retained diagnostic") };',
        );
        // Record writes from the runner to verify ordering across stdout and stderr. The real
        // terminal protocol is also checked manually with a PTY; this keeps CI portable.
        await Deno.writeTextFile(
          harness,
          `import { runFile } from ${JSON.stringify(runner)};
const writes = [];
Deno.stdin.isTerminal = () => false;
Deno.stdout.isTerminal = () => ${terminal};
Deno.stderr.isTerminal = () => ${terminal};
Deno.stdout.writeSync = (bytes) => { writes.push(["stdout", new TextDecoder().decode(bytes)]); return bytes.length; };
Deno.stderr.writeSync = (bytes) => { writes.push(["stderr", new TextDecoder().decode(bytes)]); return bytes.length; };
console.error = (message) => writes.push(["stderr", message + "\\n"]);
const result = await runFile(${JSON.stringify(input)}, { progress: false });
console.log(JSON.stringify({ code: result.code, writes }));`,
        );
        const result = await new Deno.Command(Deno.execPath(), {
          args: ["run", "-A", "--config", config, harness],
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
        const captured = JSON.parse(new TextDecoder().decode(result.stdout)) as {
          code: number;
          writes: [string, string][];
        };
        assertEquals(captured.code, silent ? 7 : 1);
        const reset = captured.writes.findIndex(([stream, text]) =>
          stream === "stdout" && text.includes("\x1b[?1049l")
        );
        const expected = silent ? "error[runtime.exit]" : "retained diagnostic";
        const messages = captured.writes.filter(([stream, text]) =>
          stream === "stderr" && text.includes(expected)
        );
        assertEquals(messages.length, terminal && !silent ? 2 : 1);
        if (terminal) {
          assertEquals(reset >= 0, true);
          assertStringIncludes(captured.writes[reset][1], "\x1b[?2026l");
          assertEquals(
            captured.writes.slice(reset + 1).some(([, text]) => text.includes(expected)),
            true,
          );
        } else {
          assertEquals(reset, -1);
        }
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    });
  }
}
