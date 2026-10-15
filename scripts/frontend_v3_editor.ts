import { loadEditor } from "../tooling/frontend-v3/adapters/js/editor.ts";

// Actual v3 pipeline, not a supplied-projection renderer fixture.
export async function main(args: string[]) {
  const paths = args.filter((arg) => !arg.startsWith("--"));
  const options = args.filter((arg) => arg.startsWith("--"));
  if (
    paths.length !== 1 ||
    options.some((arg) => !["--marked", "--json", "--projected"].includes(arg))
  ) {
    throw new Error("Usage: frontend_v3_editor.ts [--marked] [--json | --projected] file.wm");
  }
  const inspect = await loadEditor();
  const result = inspect(await Deno.readTextFile(paths[0]), options.includes("--marked"));
  console.log(
    options.includes("--json")
      ? JSON.stringify(result, null, 2)
      : options.includes("--projected")
      ? result.projected
      : result.preview,
  );
}
if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
