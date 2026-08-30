import { assertEquals } from "@std/assert";
import { resolve } from "node:path";
import { denoServerConfig, nodeServerConfig } from "../editors/vscode/src/server_options.ts";

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

Deno.test("VS Code extension server config passes the generated frontend artifact path", () => {
  const config = denoServerConfig(
    "deno",
    "/repo/src/lsp/server.ts",
    "tooling/frontend-v2/frontend-v2.generated.mjs",
    "stdio",
    { KEEP: "yes" },
    "/repo",
  );

  assertEquals(config.command, "deno");
  assertEquals(config.args, [
    "run",
    "--allow-read",
    "--allow-env",
    "--allow-run",
    "/repo/src/lsp/server.ts",
  ]);
  assertEquals(config.transport, "stdio");
  assertEquals(config.options.cwd, "/repo");
  assertEquals(config.options.env.KEEP, "yes");
  assertEquals(config.options.env.WORKMAN_FRONTEND, undefined);
  assertEquals(
    config.options.env.WORKMAN_FRONTEND_V2_MODULE,
    resolve("/repo", "tooling/frontend-v2/frontend-v2.generated.mjs"),
  );
});

Deno.test("VS Code extension server config omits the generated artifact env when unset", () => {
  const config = denoServerConfig(
    "deno",
    "/repo/src/lsp/server.ts",
    undefined,
    "stdio",
    {},
    "/repo",
  );

  assertEquals(config.options.env.WORKMAN_FRONTEND, undefined);
  assertEquals(config.options.env.WORKMAN_FRONTEND_V2_MODULE, undefined);
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
});
