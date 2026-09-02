import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";

export type ServerProcessConfig<TTransport> = {
  command: string;
  args: string[];
  transport: TTransport;
  options: {
    cwd: string;
    env: Record<string, string | undefined>;
    shell: boolean;
  };
};

export type ServerModuleConfig<TTransport> = {
  module: string;
  transport: TTransport;
  options: {
    cwd: string;
    env: Record<string, string | undefined>;
  };
};

/**
 * Launch a `wm` launcher (usually a script wrapping `deno run -A main.ts`) in
 * language-server mode. Windows launchers are .bat/.cmd scripts, so they need a
 * shell; other platforms exec the script's shebang directly.
 */
export function wmServerConfig<TTransport>(
  command: string,
  frontendV2ModulePath: string | undefined,
  transport: TTransport,
  baseEnv: Record<string, string | undefined>,
  workspaceFolder?: string,
): ServerProcessConfig<TTransport> {
  return {
    command: shellCommand(command),
    args: ["lsp"],
    transport,
    options: {
      cwd: workspaceFolder ?? path.dirname(command),
      env: serverEnvironment(
        frontendV2ModulePath,
        baseEnv,
        workspaceFolder,
      ),
      shell: process.platform === "win32",
    },
  };
}

export function nodeServerConfig<TTransport>(
  module: string,
  frontendV2ModulePath: string | undefined,
  transport: TTransport,
  baseEnv: Record<string, string | undefined>,
  workspaceFolder?: string,
): ServerModuleConfig<TTransport> {
  return {
    module,
    transport,
    options: {
      cwd: workspaceFolder ?? path.dirname(module),
      env: serverEnvironment(
        frontendV2ModulePath,
        baseEnv,
        workspaceFolder,
      ),
    },
  };
}

export const SERVER_PROBE_TIMEOUT_MS = 15_000;

export async function probeServerCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<boolean> {
  // Executor form, not Promise.withResolvers: VS Code's extension host is
  // Node 20, which predates withResolvers.
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    let child: ChildProcess;
    try {
      child = spawn(shellCommand(command), args, {
        cwd: options.cwd,
        stdio: ["pipe", "ignore", "ignore"],
        shell: process.platform === "win32",
      });
    } catch {
      resolve(false);
      return;
    }
    const timer: NodeJS.Timeout = setTimeout(() => {
      child.kill();
      finish(false);
    }, options.timeoutMs ?? SERVER_PROBE_TIMEOUT_MS);
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
    child.stdin?.once("error", () => {});
    child.stdin?.end();
  });
}

function shellCommand(command: string): string {
  if (process.platform === "win32" && /\s/.test(command)) return `"${command}"`;
  return command;
}

function serverEnvironment(
  frontendV2ModulePath: string | undefined,
  baseEnv: Record<string, string | undefined>,
  workspaceFolder?: string,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...baseEnv };
  if (frontendV2ModulePath) {
    env.WORKMAN_FRONTEND_V2_MODULE = resolveConfiguredPath(
      frontendV2ModulePath,
      workspaceFolder,
    );
  }
  return env;
}

export function resolveConfiguredPath(
  configured: string,
  workspaceFolder?: string,
): string {
  if (path.isAbsolute(configured)) return configured;
  return workspaceFolder
    ? path.resolve(workspaceFolder, configured)
    : path.resolve(configured);
}
