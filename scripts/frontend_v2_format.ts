import { formatFrontendV2Source } from "../src/frontend_v2_formatter.ts";

const { path, stdout, fix } = parseArguments(Deno.args);
const source = await Deno.readTextFile(path);
const formatted = await formatFrontendV2Source(source, path, fix);
if (stdout) {
  await Deno.stdout.write(new TextEncoder().encode(formatted));
} else {
  if (formatted !== source) await Deno.writeTextFile(path, formatted);
}

function parseArguments(
  args: readonly string[],
): Readonly<{ path: string; stdout: boolean; fix: boolean }> {
  const supported = new Set(["--stdout", "--fix"]);
  const unsupported = args.filter((arg) => arg.startsWith("-") && !supported.has(arg));
  const paths = args.filter((arg) => !supported.has(arg));
  if (unsupported.length === 0 && paths.length === 1) {
    return {
      path: paths[0],
      stdout: args.includes("--stdout"),
      fix: args.includes("--fix"),
    };
  }
  throw new Error(
    "usage: deno task frontend-v2:format [--stdout] [--fix] <file.wm>",
  );
}
