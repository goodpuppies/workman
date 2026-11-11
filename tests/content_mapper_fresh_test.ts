import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const fresh = Deno.env.get("WM_CONTENT_MAPPER_FRESH");
const tsc = Deno.env.get("WM_CONTENT_MAPPER_TSC");
const root = dirname(dirname(fileURLToPath(import.meta.url)));

for (const terminal of [false, true]) {
  Deno.test({
    name: `Fresh ${
      terminal ? "terminal/server with autosave" : "web"
    } plugin updates transitive TS hover and displayed diagnostics after WM edits`,
    ignore: !fresh || !tsc || Deno.build.os === "windows" ||
      (terminal && Deno.build.os !== "linux"),
    async fn() {
      const dir = await Deno.makeTempDir({ prefix: "wm-fresh-" });
      const project = join(dir, "project");
      const packages = join(dir, "config/fresh/plugins/packages");
      for (
        const path of [
          project,
          packages,
          join(project, "node_modules/@goodpuppies"),
          join(dir, "runtime"),
        ]
      ) {
        await Deno.mkdir(path, { recursive: true, mode: 0o700 });
      }
      const plugin = join(packages, "workman-typescript-sync");
      await Deno.mkdir(plugin);
      for (const file of ["package.json", "sync.ts"]) {
        await Deno.copyFile(
          join(root, "editors/fresh-typescript-sync", file),
          join(plugin, file),
        );
      }
      await Deno.symlink(
        root,
        join(project, "node_modules/@goodpuppies/workman"),
      );
      await Deno.writeTextFile(
        join(project, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            module: "esnext",
            moduleResolution: "bundler",
            types: [],
          },
          contentMappers: [{
            package: "@goodpuppies/workman",
            extensions: [".wm"],
          }],
          files: ["consumer.ts"],
        }),
      );
      await Deno.writeTextFile(
        join(project, "consumer.ts"),
        'import { double } from "./facade.wm";\nconst value = double("hello");\n',
      );
      await Deno.writeTextFile(
        join(project, "math.wm"),
        "let double = value => value + value;",
      );
      await Deno.writeTextFile(
        join(project, "forward.wm"),
        'export from "./math.wm" import { double };',
      );
      await Deno.writeTextFile(
        join(project, "facade.wm"),
        'from "./forward.wm" import * as Inner; let double = Inner.double;',
      );
      const trust = join(
        dir,
        "data/fresh/workspaces",
        project.replaceAll("_", "%5F").replaceAll("/", "_").replace(/^_+/, ""),
      );
      await Deno.mkdir(trust, { recursive: true });
      await Deno.writeTextFile(
        join(trust, "trust.json"),
        '{"level":"trusted"}',
      );
      await Deno.writeTextFile(
        join(dir, "config/fresh/config.json"),
        JSON.stringify({
          version: 3,
          auto_attach: terminal,
          theme: "dark",
          editor: { auto_save_enabled: terminal, auto_save_interval_secs: 1 },
          languages: { workman: { extensions: ["wm"] } },
          lsp: {
            workman: {
              enabled: terminal,
              auto_start: true,
              command: Deno.execPath(),
              args: [
                "run",
                "-A",
                "--config",
                join(root, "deno.json"),
                join(root, "src/lsp/server.ts"),
              ],
              root_markers: ["tsconfig.json"],
            },
            typescript: {
              command: Deno.execPath(),
              name: "workman-typescript",
              enabled: true,
              auto_start: true,
              args: [
                "run",
                "-A",
                "--config",
                join(root, "deno.json"),
                join(root, "src/content_mapper/typescript_lsp.ts"),
                "--tsc",
                resolve(tsc!),
              ],
              root_markers: ["tsconfig.json"],
              initialization_options: { runExternalCode: true },
            },
          },
          plugins: { "workman-typescript-sync": { enabled: true } },
        }),
      );
      // This test-only plugin uses the real QuickJS/editor APIs; it edits scratch buffers only.
      const probe = join(packages, "wm-sync-probe");
      await Deno.mkdir(probe);
      await Deno.writeTextFile(
        join(probe, "package.json"),
        JSON.stringify({
          name: "wm-sync-probe",
          version: "0.0.0",
          type: "plugin",
          fresh: { entry: "probe.ts" },
        }),
      );
      await Deno.writeTextFile(
        join(probe, "probe.ts"),
        `
const uri = ${JSON.stringify(pathToFileURL(join(project, "consumer.ts")).href)};
async function hover(label, expectedType, expectedErrors, retry) {
  // Wait for independently delivered push diagnostics; initial project loading can exceed
  // the first timer when compiler tests run concurrently. Never pull diagnostics manually.
  const value = await editor.sendLspRequest("typescript", "textDocument/hover", {textDocument:{uri},position:{line:1,character:16}});
  const binding = await editor.sendLspRequest("typescript", "textDocument/hover", {textDocument:{uri},position:{line:1,character:7}});
  const diagnostics = editor.getAllDiagnostics().filter(d => d.uri === uri && d.severity === 1);
  if (!JSON.stringify(binding).includes("value: " + expectedType) || diagnostics.length !== expectedErrors) {
    console.log("WM_SYNC_WAIT", JSON.stringify({label,value,binding,diagnostics}));
    editor.setTimeout(150, retry);
    return false;
  }
  console.log("WM_SYNC_PROBE", JSON.stringify({label,value,binding,diagnostics}));
  return true;
}
async function change(text) {
  const buffer = editor.listBuffers().find(b => b.path.endsWith("/math.wm"));
  editor.deleteRange(buffer.id, 0, buffer.length);
  editor.insertText(buffer.id, 0, text);
  await editor.flush();
}
registerHandler("wm_probe_before", async () => {
  if (!await hover("before", "number", 1, "wm_probe_before")) return;
  await change("let double = value => value ++ value;");
  editor.setTimeout(1200, "wm_probe_after");
});
registerHandler("wm_probe_after", async () => {
  if (!await hover("after", "string", 0, "wm_probe_after")) return;
  await change("let double = (flag: Bool) => flag;");
  editor.setTimeout(1200, "wm_probe_again");
});
registerHandler("wm_probe_again", async () => {
  if (!await hover("again", "boolean", 1, "wm_probe_again")) return;
  await change("let double = value => value ++ value;");
  editor.setTimeout(1200, "wm_probe_restored");
});
registerHandler("wm_probe_restored", async () => { await hover("restored", "string", 0, "wm_probe_restored"); });
editor.setTimeout(2000, "wm_probe_before");
`,
      );
      const freshArgs = [
        "--no-init",
        "--no-upgrade-check",
        "--no-restore",
        ...(terminal
          ? ["-a", "wm-sync-test"]
          : ["--web", "127.0.0.1:0", "--session-name", "wm-sync-test"]),
        "consumer.ts",
        "math.wm",
      ];
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
      const child = new Deno.Command(terminal ? "script" : resolve(fresh!), {
        args: terminal
          ? [
            "-q",
            "-e",
            "-c",
            [resolve(fresh!), ...freshArgs].map(quote).join(" "),
            "/dev/null",
          ]
          : freshArgs,
        cwd: project,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
        env: {
          XDG_CONFIG_HOME: join(dir, "config"),
          XDG_DATA_HOME: join(dir, "data"),
          XDG_STATE_HOME: join(dir, "state"),
          XDG_RUNTIME_DIR: join(dir, "runtime"),
          FRESH_SESSION: "",
          FRESH_CMD_TOKEN: "",
          RUST_LOG: "info",
        },
      }).spawn();
      let log = "";
      let complete!: () => void;
      const observed = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const drain = async (stream: ReadableStream<Uint8Array>) => {
        const decoder = new TextDecoder();
        for await (const chunk of stream) {
          log += decoder.decode(chunk, { stream: true });
          if (/WM_SYNC_PROBE \{"label":"restored"/.test(log)) complete();
        }
      };
      const streams = Promise.all([drain(child.stdout), drain(child.stderr)]);
      let stopped = false;
      // In terminal/server mode logs belong to the daemon, not its attached PTY client.
      const follow = (async () => {
        if (!terminal) return;
        while (!stopped) {
          try {
            let logs = "";
            for await (
              const entry of Deno.readDir(join(dir, "state/fresh/logs"))
            ) {
              if (entry.isFile && /^fresh.*\.log$/.test(entry.name)) {
                logs += await Deno.readTextFile(
                  join(dir, "state/fresh/logs", entry.name),
                );
              }
            }
            if (/WM_SYNC_PROBE \{"label":"restored"/.test(logs)) {
              log = logs;
              complete();
              return;
            }
          } catch { /* The daemon creates its log directory asynchronously. */ }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      })();
      let timeout!: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([
          observed,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new Error("Fresh sync probe timed out:\n" + log.slice(-5000)),
                ),
              15_000,
            );
          }),
          child.status.then((status) => {
            throw new Error(
              `Fresh exited (${status.code}):\n${log.slice(-5000)}`,
            );
          }),
        ]);
        const results = log.split("\n").filter((line) => line.includes("WM_SYNC_PROBE "));
        assertStringIncludes(
          results.find((line) => line.includes('"label":"before"')) ?? "",
          "value: number",
        );
        assertStringIncludes(
          results.find((line) => line.includes('"label":"after"')) ?? "",
          "value: string",
        );
        assertStringIncludes(
          results.find((line) => line.includes('"label":"again"')) ?? "",
          "flag: boolean",
        );
        for (
          const [label, type] of [["before", "number"], ["after", "string"], [
            "again",
            "boolean",
          ], ["restored", "string"]]
        ) {
          const line = results.find((line) => line.includes(`"label":"${label}"`))!;
          const result = JSON.parse(line.split("WM_SYNC_PROBE ")[1]);
          assertStringIncludes(
            JSON.stringify(result.binding),
            `value: ${type}`,
          );
          assertEquals(
            result.diagnostics.length,
            label === "before" || label === "again" ? 1 : 0,
            `${label}: ${JSON.stringify(result.diagnostics)}`,
          );
        }
      } finally {
        stopped = true;
        clearTimeout(timeout);
        await follow;
        if (terminal) {
          try {
            const pid = Number(
              (await Deno.readTextFile(
                join(dir, "runtime/fresh/wm-sync-test.pid"),
              )).trim(),
            );
            if (Number.isInteger(pid) && pid > 1 && pid !== Deno.pid) {
              Deno.kill(pid, "SIGKILL");
            }
          } catch { /* The isolated daemon may already have exited. */ }
        }
        try {
          child.kill("SIGKILL");
        } catch { /* Already exited. */ }
        await child.status;
        await streams;
        await Deno.remove(dir, { recursive: true });
      }
    },
  });
}
