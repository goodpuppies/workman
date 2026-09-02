import { assertEquals, assertStringIncludes } from "@std/assert";
import { resolve } from "node:path";
import {
  nodeServerConfig,
  probeServerCommand,
  wmServerConfig,
} from "../editors/vscode/src/server_options.ts";

const repoRoot = resolve(import.meta.dirname!, "..");

Deno.test("VS Code bracket colors do not split arrow and pipe operators", async () => {
  const configuration = JSON.parse(
    await Deno.readTextFile(
      resolve(repoRoot, "editors/vscode/language-configuration.json"),
    ),
  );

  assertEquals(
    configuration.brackets.some(([open, close]: string[]) => open === "<" && close === ">"),
    false,
  );
  assertEquals(
    configuration.autoClosingPairs.some(
      ([open, close]: string[]) => open === "<" && close === ">",
    ),
    true,
  );
});

Deno.test("VS Code grammar scopes lowercase let bindings as constants", async () => {
  const grammar = JSON.parse(
    await Deno.readTextFile(
      resolve(repoRoot, "editors/vscode/syntaxes/wm.tmLanguage.json"),
    ),
  );
  const binding = grammar.repository.bindings.patterns[0];

  assertEquals(binding.captures["3"].name, "variable.other.constant.workman");
});

Deno.test("VS Code extension wm server config launches `wm lsp` with the frontend artifact env", () => {
  const config = wmServerConfig(
    "/bin/wm",
    "tooling/frontend-v2/frontend-v2.generated.mjs",
    "stdio",
    { KEEP: "yes" },
    "/repo",
  );

  assertEquals(config.command, "/bin/wm");
  assertEquals(config.args, ["lsp"]);
  assertEquals(config.transport, "stdio");
  assertEquals(config.options.cwd, "/repo");
  assertEquals(config.options.env.KEEP, "yes");
  assertEquals(config.options.env.WORKMAN_FRONTEND, undefined);
  assertEquals(
    config.options.env.WORKMAN_FRONTEND_V2_MODULE,
    resolve("/repo", "tooling/frontend-v2/frontend-v2.generated.mjs"),
  );
});

Deno.test("VS Code extension wm server config omits the generated artifact env when unset", () => {
  const config = wmServerConfig("/bin/wm", undefined, "stdio", {}, "/repo");

  assertEquals(config.options.env.WORKMAN_FRONTEND, undefined);
  assertEquals(config.options.env.WORKMAN_FRONTEND_V2_MODULE, undefined);
});

Deno.test("probeServerCommand accepts a command that exits cleanly on stdin EOF", async () => {
  assertEquals(await probeServerCommand(Deno.execPath(), ["eval", "0"]), true);
});

Deno.test("probeServerCommand rejects a command that exits nonzero", async () => {
  assertEquals(
    await probeServerCommand(Deno.execPath(), ["eval", "Deno.exit(1)"]),
    false,
  );
});

Deno.test("probeServerCommand rejects a missing command", async () => {
  assertEquals(
    await probeServerCommand("wm-definitely-not-on-path-xyz", ["lsp"]),
    false,
  );
});

Deno.test("VS Code extension can launch a packaged language server", () => {
  const config = nodeServerConfig(
    "/extension/server/workman-lsp.mjs",
    undefined,
    "stdio",
    { KEEP: "yes" },
    "/workspace",
  );

  assertEquals(config.module, "/extension/server/workman-lsp.mjs");
  assertEquals(config.transport, "stdio");
  assertEquals(config.options.cwd, "/workspace");
  assertEquals(config.options.env.KEEP, "yes");
  assertEquals(config.options.env.WORKMAN_FRONTEND, undefined);
  assertEquals(config.options.env.WORKMAN_FRONTEND_V2_MODULE, undefined);
});

Deno.test("VS Code build packages the generated frontend beside the bundled server", async () => {
  const buildScript = await Deno.readTextFile(
    resolve(repoRoot, "editors/vscode/scripts/build.mjs"),
  );

  assertStringIncludes(buildScript, 'path.join(generatedDirectory, "frontend_v2_parser.js")');
  assertStringIncludes(
    buildScript,
    'path.join(repositoryRoot, "src", "generated", "frontend_v2_parser.js")',
  );
  assertStringIncludes(
    buildScript,
    `fs.writeFile(path.join(generatedDirectory, "package.json"), '{"type":"module"}\\n')`,
  );
  assertStringIncludes(
    buildScript,
    'path.join(repositoryRoot, "tooling", "wmslang", "wmslang.generated.mjs")',
  );
  assertStringIncludes(buildScript, 'path.join(wmslangDirectory, "wmslang.generated.mjs")');
});
