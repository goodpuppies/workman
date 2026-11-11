import { runCli } from "./main.ts";

// These paths currently launch Deno.execPath() as a full Deno CLI. In a compiled release
// that is this executable, so fail clearly until runtime dispatch is made standalone-aware.
const needsDenoCli = new Set(["run", "watch", "repl", "pakman", "problems", "test"]);
if (import.meta.main) {
  const command = Deno.args[0] ?? "repl";
  if (needsDenoCli.has(command) || Deno.args.includes("--executable")) {
    console.error(
      `The experimental standalone release does not support ${command} yet. Use the source-based Deno/JSR installation for this command.`,
    );
    Deno.exitCode = 2;
  } else {
    Deno.exitCode = await runCli(Deno.args);
  }
}
