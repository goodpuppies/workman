// Runs `wm pakman` the way a user would, for the end-to-end tests: with the
// test packages in ./pkgs, and pakman's state in `state`.

const wmMain = new URL("../../../src/main.ts", import.meta.url).pathname;
const packages = new URL("./pkgs", import.meta.url).pathname;

/** [exit code, stdout and stderr together]. */
export async function pakman(state: string, args: string[]): Promise<string[]> {
  const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", wmMain, "pakman", ...args],
    env: { PAKMAN_PKGS: packages, PAKMAN_STATE: state, NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return [String(code), decoder.decode(stdout) + decoder.decode(stderr)];
}

/** Where a symlink points. */
export async function readLink(path: string): Promise<string> {
  return await Deno.readLink(path);
}
