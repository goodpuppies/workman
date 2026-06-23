#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

type Options = {
  binDir: string;
  force: boolean;
  modifyPath: boolean;
};

const repoRoot = dirname(dirname(pathFromFileUrl(import.meta.url)));

async function main(args: string[]): Promise<number> {
  const options = parseArgs(args);
  if (!options) return 2;

  await Deno.mkdir(options.binDir, { recursive: true });

  const targets = launcherTargets(options.binDir);
  for (const target of targets) {
    const existing = await readIfExists(target.path);
    if (existing && !options.force && !existing.includes("wm-mini installer")) {
      console.error(`refusing to overwrite existing ${target.path}`);
      console.error("rerun with --force to replace it");
      return 1;
    }
  }

  for (const target of targets) {
    await Deno.writeTextFile(target.path, target.content);
    if (target.executable) await Deno.chmod(target.path, 0o755);
    console.log(`installed wm -> ${target.path}`);
  }

  if (options.modifyPath && Deno.build.os !== "windows") {
    await installShellPath(options.binDir);
  }

  console.log(`launcher target: ${join(repoRoot, "src/main.ts")}`);
  return 0;
}

function parseArgs(args: string[]): Options | undefined {
  let binDir = defaultBinDir();
  let force = false;
  let modifyPath = true;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      usage();
      return undefined;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--no-modify-path") {
      modifyPath = false;
      continue;
    }
    if (arg === "--bin-dir") {
      binDir = requireValue(args, ++index, arg);
      continue;
    }
    if (arg.startsWith("--bin-dir=")) {
      binDir = arg.slice("--bin-dir=".length);
      continue;
    }
    if (arg === "--prefix") {
      binDir = join(requireValue(args, ++index, arg), "bin");
      continue;
    }
    if (arg.startsWith("--prefix=")) {
      binDir = join(arg.slice("--prefix=".length), "bin");
      continue;
    }
    console.error(`unknown argument: ${arg}`);
    usage();
    return undefined;
  }

  return { binDir: expandHome(binDir), force, modifyPath };
}

function defaultBinDir(): string {
  const configured = Deno.env.get("WM_INSTALL_BIN_DIR");
  if (configured) return configured;

  const denoInstallRoot = Deno.env.get("DENO_INSTALL_ROOT");
  if (denoInstallRoot) return join(denoInstallRoot, "bin");

  if (Deno.build.os === "windows") return "~/.deno/bin";
  return "~/.local/bin";
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function expandHome(path: string): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (path === "~") return home ?? path;
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return join(home ?? "~", path.slice(2));
  }
  return path;
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

const pathBlockStart = "# >>> wm-mini installer >>>";
const pathBlockEnd = "# <<< wm-mini installer <<<";

async function installShellPath(binDir: string): Promise<void> {
  const home = Deno.env.get("HOME");
  if (!home) {
    console.error(`could not update shell PATH: HOME is not set; add ${binDir} manually`);
    return;
  }

  const posixBlock = `${pathBlockStart}\nexport PATH=${
    shellQuote(binDir)
  }:"$PATH"\n${pathBlockEnd}`;
  const fishBlock = `${pathBlockStart}\nfish_add_path --global ${
    fishQuote(binDir)
  }\n${pathBlockEnd}`;
  const fishConfigRoot = Deno.env.get("XDG_CONFIG_HOME") ?? join(home, ".config");
  const configs = [
    { shell: "bash", path: join(home, ".bashrc"), block: posixBlock },
    { shell: "zsh", path: join(home, ".zshrc"), block: posixBlock },
    {
      shell: "fish",
      path: join(fishConfigRoot, "fish", "conf.d", "wm-mini.fish"),
      block: fishBlock,
    },
  ];

  for (const config of configs) {
    await Deno.mkdir(dirname(config.path), { recursive: true });
    const existing = await readIfExists(config.path) ?? "";
    const updated = replaceManagedBlock(existing, config.block);
    if (updated !== existing) await Deno.writeTextFile(config.path, updated);
    console.log(`configured ${config.shell} PATH -> ${config.path}`);
  }
}

function replaceManagedBlock(content: string, block: string): string {
  const start = content.indexOf(pathBlockStart);
  const end = start < 0 ? -1 : content.indexOf(pathBlockEnd, start);
  if (start >= 0 && end >= 0) {
    return `${content.slice(0, start)}${block}${content.slice(end + pathBlockEnd.length)}`;
  }

  const separator = content.length === 0 || content.endsWith("\n") ? "" : "\n";
  return `${content}${separator}${block}\n`;
}

function launcherScript(root: string): string {
  const main = join(root, "src/main.ts");
  return `#!/usr/bin/env sh
# generated by wm-mini installer
exec deno run -A ${shellQuote(main)} "$@"
`;
}

function launcherTargets(binDir: string): { path: string; content: string; executable: boolean }[] {
  if (Deno.build.os === "windows") {
    return [
      {
        path: join(binDir, "wm.cmd"),
        content: windowsLauncherScript(repoRoot),
        executable: false,
      },
    ];
  }

  return [
    {
      path: join(binDir, "wm"),
      content: launcherScript(repoRoot),
      executable: true,
    },
  ];
}

function windowsLauncherScript(root: string): string {
  const main = join(root, "src/main.ts");
  return `@echo off\r
rem generated by wm-mini installer\r
deno run -A "${main}" %*\r
`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function fishQuote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function join(...parts: string[]): string {
  const separator = Deno.build.os === "windows" ? "\\" : "/";
  const [first = "", ...rest] = parts;
  return rest.reduce((path, part) => {
    const left = trimRightSeparator(path);
    const right = trimLeftSeparator(part);
    return `${left}${separator}${right}`;
  }, first);
}

function dirname(path: string): string {
  const trimmed = trimRightSeparator(path);
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index <= 0) return trimmed;
  return trimmed.slice(0, index);
}

function trimRightSeparator(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function trimLeftSeparator(path: string): string {
  return path.replace(/^[\\/]+/, "");
}

function pathFromFileUrl(value: string): string {
  const url = new URL(value);
  let path = decodeURIComponent(url.pathname);
  if (Deno.build.os === "windows") {
    path = path.replace(/^\/([A-Za-z]:)/, "$1").replaceAll("/", "\\");
  }
  return trimRightSeparator(path);
}

function usage() {
  console.error(`usage: deno run --allow-read --allow-write --allow-env scripts/install.ts [options]

options:
  --bin-dir DIR   install wm directly into DIR
  --prefix DIR    install wm into DIR/bin
  --force         overwrite an existing non-wm-mini launcher
  --no-modify-path
                  do not configure PATH for bash, zsh, and fish

default:
  ~/.local/bin, or WM_INSTALL_BIN_DIR if set; shell PATH files are updated
`);
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
