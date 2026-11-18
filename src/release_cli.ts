import { runCli } from "./main.ts";
import { runScriptIfRequested } from "./child_runtime.ts";

// The compiled binary embeds the Deno runtime but not the Deno CLI. Commands that run a program
// restart this binary as a script runner (child_runtime.ts); building an executable needs Deno's
// own compile toolchain, which the binary does not have.
if (import.meta.main && !await runScriptIfRequested()) {
  if (Deno.args.includes("--executable")) {
    console.error(
      "This wm build cannot create executables. Use the Deno/JSR installation for --executable.",
    );
    Deno.exitCode = 2;
  } else {
    Deno.exitCode = await runCli(Deno.args);
  }
}
