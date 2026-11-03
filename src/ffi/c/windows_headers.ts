import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const zigLibDirectories = new Map<string, Promise<string>>();

/** A separate header installation can use the same directory layout as Zig's lib/. */
export async function windowsGnuHeaderDirectories(
  libDir = process.env.WM_C_HEADER_ZIG_LIB_DIR,
  zigPath = process.env.WM_ZIG_PATH ?? "zig",
): Promise<string[]> {
  if (!libDir) {
    let pending = zigLibDirectories.get(zigPath);
    if (!pending) {
      pending = (async () => {
        const { stdout } = await execFileAsync(zigPath, ["env"], {
          encoding: "utf8",
          windowsHide: true,
        });
        // Zig 0.16 emits ZON; older distributions emitted JSON.
        let directory: unknown;
        try {
          directory = JSON.parse(stdout).lib_dir;
        } catch {
          const quoted = stdout.match(/\.lib_dir\s*=\s*("(?:\\.|[^"\\])*")/)?.[1];
          if (quoted) directory = JSON.parse(quoted);
        }
        if (typeof directory !== "string" || !directory) {
          throw new Error("zig env did not report lib_dir");
        }
        return directory;
      })();
      zigLibDirectories.set(zigPath, pending);
    }
    try {
      libDir = await pending;
    } catch (error) {
      zigLibDirectories.delete(zigPath);
      throw new Error(
        `Cannot locate Windows MinGW headers. Set WM_C_HEADER_ZIG_LIB_DIR to a Zig lib directory ` +
          `(tested with Zig 0.16.0), or install Zig on PATH / set WM_ZIG_PATH. ${String(error)}`,
      );
    }
  }
  const root = resolve(libDir);
  const mingw = join(root, "libc", "include", "any-windows-any");
  const compiler = join(root, "include");
  try {
    await Promise.all([
      fs.access(join(mingw, "_mingw.h")),
      fs.access(join(compiler, "stddef.h")),
    ]);
  } catch {
    throw new Error(
      `Windows MinGW headers are incomplete in ${root}. WM_C_HEADER_ZIG_LIB_DIR must contain ` +
        `libc/include/any-windows-any/_mingw.h and include/stddef.h (tested with Zig 0.16.0).`,
    );
  }
  return [mingw, compiler];
}
