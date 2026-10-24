// `wm pakman`: the package manager in tooling/pakman. It is compiled into
// a user cache when any of its sources changed, then run like
// `wm run`. Package programs are compiled and sandboxed by pakman itself.
import { compileFileArtifacts } from "./compiler.ts";
import { runtimeFlagsForJavaScript } from "./runtime_flags.ts";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cacheJsrPackage, workmanCache } from "./package_cache.ts";

const sourceUrl = new URL("../tooling/pakman", import.meta.url);
const root = sourceUrl.protocol === "file:" ? fileURLToPath(sourceUrl) : undefined;
// Generated imports contain checkout-relative paths. Keep different installed
// compilers in separate writable caches, never inside the compiler source tree.
async function cachedOutput(root: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(root));
  const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return join(workmanCache(), key, "pakman.js");
}

async function mtime(path: string): Promise<number> {
  try {
    return (await Deno.stat(path)).mtime?.getTime() ?? 0;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return 0;
    throw error;
  }
}

async function newestSource(dir: string): Promise<number> {
  let newest = 0;
  for await (const item of Deno.readDir(dir)) {
    const path = `${dir}/${item.name}`;
    if (item.isDirectory) newest = Math.max(newest, await newestSource(path));
    else if (/\.(wm|ts)$/.test(item.name)) newest = Math.max(newest, await mtime(path));
  }
  return newest;
}

async function build(root: string, output: string): Promise<string> {
  const entry = join(root, "pakman.wm");
  // The "pakman/" modules pakman shares with packages are embedded in the compiler's assets.
  const assets = fileURLToPath(new URL("./generated/assets.ts", import.meta.url));
  const newest = Math.max(
    await mtime(entry),
    await newestSource(`${root}/src`),
    await mtime(assets),
  );
  if (await mtime(output) >= newest) return await Deno.readTextFile(output);
  const artifacts = await compileFileArtifacts(entry);
  await Deno.mkdir(dirname(output), { recursive: true });
  let code = "";
  for (const artifact of artifacts) {
    const target = artifact.kind === "entry" ? output : join(dirname(output), artifact.path);
    // The entry is written last, so an interrupted build is never mistaken for a fresh one.
    if (artifact.kind === "entry") code = artifact.code;
    else await Deno.writeTextFile(target, artifact.code);
  }
  await Deno.writeTextFile(`${output}.tmp`, code);
  await Deno.rename(`${output}.tmp`, output);
  return code;
}

export async function pakmanCommand(args: string[]): Promise<number> {
  if (!root) {
    const local = await cacheJsrPackage(new URL(import.meta.url));
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        "--no-lock",
        "--node-modules-dir=none",
        "--config",
        join(local, "deno.json"),
        join(local, "src/cli.ts"),
        "pakman",
        ...args,
      ],
      env: { WORKMAN_DENO_PATH: Deno.execPath() },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    return (await child.status).code;
  }
  const output = await cachedOutput(root);
  const code = await build(root, output);
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", ...runtimeFlagsForJavaScript(code), output, ...args],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  return (await child.status).code;
}
