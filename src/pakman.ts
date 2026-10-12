// `wm pakman`: the package manager in tooling/pakman. It is compiled into
// tooling/pakman/.build when any of its sources changed, then run like
// `wm run`. Package programs are compiled and sandboxed by pakman itself.
import { compileFileArtifacts } from "./compiler.ts";
import { runtimeFlagsForJavaScript } from "./runtime_flags.ts";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../tooling/pakman", import.meta.url));
const entry = `${root}/pakman.wm`;
const buildDir = `${root}/.build`;
const output = `${buildDir}/pakman.js`;

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

async function build(): Promise<string> {
  const newest = Math.max(await mtime(entry), await newestSource(`${root}/src`));
  if (await mtime(output) >= newest) return await Deno.readTextFile(output);
  const artifacts = await compileFileArtifacts(entry);
  await Deno.mkdir(buildDir, { recursive: true });
  let code = "";
  for (const artifact of artifacts) {
    const target = artifact.kind === "entry" ? output : `${buildDir}/${artifact.path}`;
    // The entry is written last, so an interrupted build is never mistaken for a fresh one.
    if (artifact.kind === "entry") code = artifact.code;
    else await Deno.writeTextFile(target, artifact.code);
  }
  await Deno.writeTextFile(`${output}.tmp`, code);
  await Deno.rename(`${output}.tmp`, output);
  return code;
}

export async function pakmanCommand(args: string[]): Promise<number> {
  const code = await build();
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", ...runtimeFlagsForJavaScript(code), output, ...args],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  return (await child.status).code;
}
