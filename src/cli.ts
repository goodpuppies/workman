import { runCli } from "./main.ts";

if (import.meta.main) Deno.exit(await runCli(Deno.args));
