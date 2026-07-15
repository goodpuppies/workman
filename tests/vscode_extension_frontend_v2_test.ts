import { assertEquals } from "@std/assert";
import { resolve } from "node:path";
import { denoServerConfig, nodeServerConfig } from "../editors/vscode/src/server_options.ts";

Deno.test("VS Code extension server config passes frontend v2 mode and artifact path", () => {
  const config = denoServerConfig(
    "deno",
    "/repo/src/lsp/server.ts",
    "v2",
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
  assertEquals(config.options.env.WORKMAN_FRONTEND, "v2");
  assertEquals(
    config.options.env.WORKMAN_FRONTEND_V2_MODULE,
    resolve("/repo", "tooling/frontend-v2/frontend-v2.generated.mjs"),
  );
});

Deno.test("VS Code extension server config omits frontend v2 artifact env when unset", () => {
  const config = denoServerConfig(
    "deno",
    "/repo/src/lsp/server.ts",
    "v1",
    undefined,
    "stdio",
    {},
    "/repo",
  );

  assertEquals(config.options.env.WORKMAN_FRONTEND, "v1");
  assertEquals(config.options.env.WORKMAN_FRONTEND_V2_MODULE, undefined);
});

Deno.test("VS Code extension can launch a packaged language server", () => {
  const config = nodeServerConfig(
    "/extension/server/workman-lsp.mjs",
    "v1",
    undefined,
    "stdio",
    { KEEP: "yes" },
    "/workspace",
  );

  assertEquals(config.module, "/extension/server/workman-lsp.mjs");
  assertEquals(config.transport, "stdio");
  assertEquals(config.options.cwd, "/workspace");
  assertEquals(config.options.env.KEEP, "yes");
  assertEquals(config.options.env.WORKMAN_FRONTEND, "v1");
});
