import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Target = {
  denoTarget: string;
  serverName: string;
};

const targets: Target[] = [
  {
    denoTarget: "x86_64-unknown-linux-gnu",
    serverName: "workman-lsp-linux-x64",
  },
  {
    denoTarget: "aarch64-unknown-linux-gnu",
    serverName: "workman-lsp-linux-arm64",
  },
  {
    denoTarget: "x86_64-pc-windows-msvc",
    serverName: "workman-lsp-win32-x64.exe",
  },
  {
    denoTarget: "x86_64-apple-darwin",
    serverName: "workman-lsp-darwin-x64",
  },
  {
    denoTarget: "aarch64-apple-darwin",
    serverName: "workman-lsp-darwin-arm64",
  },
];

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionRoot = join(repositoryRoot, "editors", "vscode");
const extensionPackage = JSON.parse(
  await Deno.readTextFile(join(extensionRoot, "package.json")),
) as { name: string; publisher: string; version: string };
const binDirectory = join(extensionRoot, "bin");
const outputDirectory = join(extensionRoot, "dist");

try {
  await Deno.mkdir(outputDirectory, { recursive: true });
  await Deno.remove(binDirectory, { recursive: true }).catch(() => {});
  await Deno.mkdir(binDirectory, { recursive: true });
  for (const target of targets) {
    const serverPath = join(binDirectory, target.serverName);
    await run(Deno.execPath(), [
      "compile",
      "--allow-read",
      "--allow-env",
      "--allow-run",
      "--target",
      target.denoTarget,
      "--output",
      serverPath,
      "src/lsp/server.ts",
    ], repositoryRoot);
  }
  const vsixPath = join(
    outputDirectory,
    `${extensionPackage.publisher}.${extensionPackage.name}-${extensionPackage.version}.vsix`,
  );
  await run("npx", ["--yes", "@vscode/vsce", "package", "--out", vsixPath], extensionRoot);
} finally {
  await Deno.remove(binDirectory, { recursive: true }).catch(() => {});
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  const result = await new Deno.Command(command, { args, cwd }).output();
  if (result.success) return;
  const stderr = new TextDecoder().decode(result.stderr).trim();
  throw new Error(`${command} ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
}
