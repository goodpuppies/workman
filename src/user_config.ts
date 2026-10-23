import { dirname, isAbsolute, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { workmanConfigFile } from "./user_paths.ts";

type Configuration = Record<string, unknown>;

function record(value: unknown): value is Configuration {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readConfiguration(file: string): Configuration {
  try {
    const config: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!record(config)) throw new Error("expected a JSON object");
    return config;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return {};
    throw new Error(`cannot read WM configuration ${file}: ${String(error)}`);
  }
}

function directories(config: Configuration, file: string): string[] {
  if (config.pakman === undefined) return [];
  if (!record(config.pakman)) throw new Error(`invalid pakman settings in ${file}`);
  const paths = config.pakman.directories;
  if (paths === undefined) return [];
  if (
    !Array.isArray(paths) || paths.some((path) => typeof path !== "string" || !isAbsolute(path))
  ) {
    throw new Error(`pakman.directories in ${file} must be an array of absolute paths`);
  }
  return paths;
}

export function packageDirectories(fallback: string, file = workmanConfigFile()): string[] {
  // Explicit command environment remains an override, useful for isolated tests.
  const override = Deno.env.get("PAKMAN_PKGS");
  if (override !== undefined) return [...new Set(override.split(":").filter(Boolean))];
  const saved = directories(readConfiguration(file), file);
  return [...new Set([...saved, fallback].filter(Boolean))];
}

export async function addPackageDirectory(
  path: string,
  file = workmanConfigFile(),
): Promise<string> {
  const canonical = await Deno.realPath(resolve(path));
  if (!(await Deno.stat(canonical)).isDirectory) throw new Error(`not a directory: ${path}`);
  const config = readConfiguration(file);
  const saved = directories(config, file);
  if (saved.includes(canonical)) return canonical;
  config.pakman = {
    ...(config.pakman as Configuration | undefined),
    directories: [...saved, canonical],
  };
  await Deno.mkdir(dirname(file), { recursive: true });
  const temporary = await Deno.makeTempFile({ dir: dirname(file), prefix: ".config-" });
  try {
    await Deno.writeTextFile(temporary, JSON.stringify(config, null, 2) + "\n");
    await Deno.chmod(temporary, 0o600);
    await Deno.rename(temporary, file);
  } finally {
    await Deno.remove(temporary).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
  return canonical;
}
