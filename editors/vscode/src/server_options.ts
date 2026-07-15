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

export type ServerModuleConfig<TTransport> = {
  module: string;
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
  return {
    command,
    args: ["run", "--allow-read", "--allow-env", "--allow-run", serverPath],
    transport,
    options: {
      cwd: path.dirname(path.dirname(path.dirname(serverPath))),
      env: serverEnvironment(
        frontendMode,
        frontendV2ModulePath,
        baseEnv,
        workspaceFolder,
      ),
    },
  };
}

export function nodeServerConfig<TTransport>(
  module: string,
  frontendMode: string,
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
        frontendMode,
        frontendV2ModulePath,
        baseEnv,
        workspaceFolder,
      ),
    },
  };
}

function serverEnvironment(
  frontendMode: string,
  frontendV2ModulePath: string | undefined,
  baseEnv: Record<string, string | undefined>,
  workspaceFolder?: string,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...baseEnv,
    WORKMAN_FRONTEND: frontendMode,
  };
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
  return workspaceFolder ? path.resolve(workspaceFolder, configured) : path.resolve(configured);
}
