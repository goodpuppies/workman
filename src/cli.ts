import { runCli } from "./main.ts";

if (import.meta.main) Deno.exitCode = await runCli(Deno.args);
