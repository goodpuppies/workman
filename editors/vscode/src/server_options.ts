import * as path from "node:path";

export type ServerProcessConfig<TTransport> = {
  command: string;
  args: string[];
  transport: TTransport;
  options: {
    cwd: string;
    env: Record<string, string | undefined>;
  };
};

export function denoServerConfig<TTransport>(
  command: string,
  serverPath: string,
  frontendMode: string,
  frontendV2ModulePath: string | undefined,
  transport: TTransport,
  baseEnv: Record<string, string | undefined>,
  workspaceFolder?: string,
): ServerProcessConfig<TTransport> {
  const env: Record<string, string | undefined> = {
    ...baseEnv,
    WM_MINI_FRONTEND: frontendMode,
  };
  if (frontendV2ModulePath) {
    env.WM_MINI_FRONTEND_V2_MODULE = resolveConfiguredPath(
      frontendV2ModulePath,
      workspaceFolder,
    );
  }
  return {
    command,
    args: ["run", "--allow-read", "--allow-env", "--allow-run", serverPath],
    transport,
    options: {
      cwd: path.dirname(path.dirname(path.dirname(serverPath))),
      env,
    },
  };
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
