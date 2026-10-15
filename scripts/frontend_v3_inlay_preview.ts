import { type Insertion, loadPreview } from "../tooling/frontend-v3/adapters/js/preview.ts";

// Renderer harness only: supplied projection/hints are not v3 parser output.
export async function main(args: string[]) {
  const paths = args.filter((arg) => !arg.startsWith("--"));
  const options = args.filter((arg) => arg.startsWith("--"));
  if (paths.length !== 1 || options.some((arg) => !["--marked", "--json"].includes(arg))) {
    throw new Error("Usage: frontend_v3_inlay_preview.ts [--marked] [--json] fixture.json");
  }
  const fixture = JSON.parse(await Deno.readTextFile(paths[0]));
  if (typeof fixture.source !== "string") {
    throw new Error("Fixture must contain a source string");
  }
  const render = await loadPreview();
  if (typeof fixture.projected === "string") {
    if (fixture.insertions !== undefined) {
      throw new Error("Supply either projected text or insertions");
    }
    const result = render.compare(
      fixture.source,
      fixture.projected,
      options.includes("--marked"),
      fixture.limit ?? 256,
    );
    console.log(options.includes("--json") ? JSON.stringify(result, null, 2) : result.text);
    return;
  }
  if (!Array.isArray(fixture.insertions)) {
    throw new Error("Fixture must contain projected text or an insertions array");
  }
  const insertions: Insertion[] = fixture.insertions.map((item: any, index: number) => {
    const id = item.id ?? index;
    if (
      !Number.isSafeInteger(id) || !Number.isSafeInteger(item.anchor) ||
      typeof item.text !== "string"
    ) {
      throw new Error(`Invalid insertion at index ${index}`);
    }
    return { id, anchor: item.anchor, text: item.text };
  });
  const result = render(fixture.source, insertions, options.includes("--marked"));
  console.log(options.includes("--json") ? JSON.stringify(result, null, 2) : result.text);
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
