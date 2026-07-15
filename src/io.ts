import { spawnSync } from "node:child_process";
import { promises as fs, readFileSync, realpathSync } from "node:fs";
import process from "node:process";

export const runtime = {
  platform: process.platform,
  cwd: () => process.cwd(),
  env: (name: string) => process.env[name],

  readTextFile: (path: string) => fs.readFile(path, "utf8"),
  readTextFileSync: (path: string) => readFileSync(path, "utf8"),
  realPath: (path: string) => fs.realpath(path),
  realPathSync: (path: string) => realpathSync(path),

  async readDirectory(path: string): Promise<RuntimeDirEntry[]> {
    const entries = await fs.readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
    }));
  },

  runSync(command: string, args: string[], options: { cwd?: string } = {}): RuntimeCommandResult {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      windowsHide: true,
    });
    return {
      success: !result.error && result.status === 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? result.error?.message ?? "",
    };
  },
};

export type RuntimeDirEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
};

export type RuntimeCommandResult = {
  success: boolean;
  stdout: string;
  stderr: string;
};
