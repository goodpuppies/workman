import { runScriptIfRequested } from "./child_runtime.ts";
import { runCli } from "./main.ts";

// Entry for the compiled binary. Runs a requested script when restarted by `scriptCommand`
// (child_runtime.ts), otherwise starts the normal CLI with automatic Deno CLI detection.
if (import.meta.main && !await runScriptIfRequested()) {
  Deno.exitCode = await runCli(Deno.args);
}
