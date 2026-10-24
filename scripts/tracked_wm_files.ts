import { fileURLToPath } from "node:url";

/**
 * The `.wm` files Git tracks under `root`, as absolute paths. The semantic golden covers the
 * repository's files, not untracked work in a checkout.
 */
export async function trackedWmFiles(root: URL): Promise<string[]> {
  const directory = fileURLToPath(root);
  const { code, stdout, stderr } = await new Deno.Command("git", {
    args: ["ls-files", "-z", "--", "*.wm"],
    cwd: directory,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) throw new Error(`git ls-files failed: ${new TextDecoder().decode(stderr)}`);
  const base = directory.endsWith("/") ? directory : `${directory}/`;
  const paths = new TextDecoder().decode(stdout).split("\0").filter((path) => path !== "");
  const existing: string[] = [];
  for (const path of paths) {
    // A tracked file deleted in the working tree is not part of the corpus.
    try {
      if ((await Deno.stat(base + path)).isFile) existing.push(base + path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return existing.sort();
}
