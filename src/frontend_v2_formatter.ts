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
  return await import("./generated/frontend_v2_parser.js") as FormatterLibrary;
}
