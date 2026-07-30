import { compileLibraryFile } from "./compiler.ts";

type WorkmanOption<T> =
  | Readonly<{ name: "Some"; args: readonly [T] }>
  | Readonly<{ name: "None"; args: readonly [] }>;

type FormatterLibrary = Readonly<{
  formatSurfaceSource(source: string): WorkmanOption<string>;
  formatSurfaceSourceFix(source: string): WorkmanOption<string>;
}>;

let formatterPromise: Promise<FormatterLibrary> | undefined;

export async function formatFrontendV2Source(
  source: string,
  path = "<input>",
  fix = false,
): Promise<string> {
  const formatter = await (formatterPromise ??= loadFormatter());
  const result = fix
    ? formatter.formatSurfaceSourceFix(source)
    : formatter.formatSurfaceSource(source);
  if (result.name === "None") {
    throw new Error(`frontend-v2 has no complete Surface tree for ${path}`);
  }
  return result.args[0];
}

async function loadFormatter(): Promise<FormatterLibrary> {
  const frontendPath = new URL(
    "../tooling/frontend-v2/surface_parser_frontend.wm",
    import.meta.url,
  ).pathname;
  const javaScript = await compileLibraryFile(frontendPath);
  const directory = await Deno.makeTempDir({ prefix: "wm-frontend-v2-format-" });
  const modulePath = `${directory}/formatter.mjs`;
  try {
    await Deno.writeTextFile(modulePath, javaScript);
    return await import(
      `${new URL(`file://${modulePath}`).href}?cache=${crypto.randomUUID()}`
    ) as FormatterLibrary;
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}
