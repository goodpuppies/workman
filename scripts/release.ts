import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const releaseTargets = [
  { name: "linux-x64", triple: "x86_64-unknown-linux-gnu", os: "linux", cpu: "x64" },
  { name: "linux-arm64", triple: "aarch64-unknown-linux-gnu", os: "linux", cpu: "arm64" },
  { name: "darwin-x64", triple: "x86_64-apple-darwin", os: "darwin", cpu: "x64" },
  { name: "darwin-arm64", triple: "aarch64-apple-darwin", os: "darwin", cpu: "arm64" },
  { name: "win32-x64", triple: "x86_64-pc-windows-msvc", os: "win32", cpu: "x64" },
  { name: "win32-arm64", triple: "aarch64-pc-windows-msvc", os: "win32", cpu: "arm64" },
] as const;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const json = async (path: string) => JSON.parse(await Deno.readTextFile(path));
const writeJson = (path: string, value: unknown) =>
  Deno.writeTextFile(path, JSON.stringify(value, null, 2) + "\n");

export async function stageRelease(output: string, targets: readonly string[], build = true) {
  const config = await json(join(root, "deno.json"));
  const sourcePackage = await json(join(root, "package.json"));
  const version: string = config.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Invalid release version");
  }
  const selected = targets.map((name) => {
    const target = releaseTargets.find((candidate) => candidate.name === name);
    if (!target) throw new Error(`Unsupported release target: ${name}`);
    return target;
  });
  const out = resolve(output);
  await Deno.mkdir(out, { recursive: true });
  const npm = join(out, "npm");
  const main = join(npm, "workman");
  await Deno.mkdir(join(main, "bin"), { recursive: true });
  await Deno.mkdir(join(main, "src/integrations"), { recursive: true });
  for (const name of ["wm.cjs", "resolve.cjs"]) {
    await Deno.copyFile(join(root, "tooling/release/bin", name), join(main, "bin", name));
  }
  if (Deno.build.os !== "windows") await Deno.chmod(join(main, "bin/wm.cjs"), 0o755);
  for (
    const name of ["vite.mjs", "vite.d.mts", "bun.mjs", "bun.d.mts", "interop.mjs", "interop.d.mts"]
  ) {
    await Deno.copyFile(join(root, "src/integrations", name), join(main, "src/integrations", name));
    if (name.endsWith(".d.mts")) {
      const path = join(main, "src/integrations", name);
      await Deno.writeTextFile(
        path,
        (await Deno.readTextFile(path)).replace("denoPath?: string", "compilerPath?: string"),
      );
    }
  }
  await Deno.copyFile(
    join(root, "tooling/release/compile.mjs"),
    join(main, "src/integrations/compile.mjs"),
  );
  await Deno.copyFile(join(root, "LICENSE"), join(main, "LICENSE"));
  await Deno.writeTextFile(
    join(main, "README.md"),
    `# Workman\n\nWorkman ${version}: the compiler, language server, REPL, test runner, TypeScript 7.1 content mapper and Vite/Bun integrations.\n\nInstall optional dependencies to obtain the platform binary, which embeds the Deno runtime; no separate Deno installation is needed. Node is required for the CLI and mapper launcher; Bun can use the integration directly.\n\nThis build does not yet support programs that import packages (bare, npm:, jsr: or remote specifiers), or building executables with --executable; use the Deno/JSR installation for those.\n`,
  );
  await writeJson(join(main, "package.json"), {
    name: config.name,
    version,
    type: "module",
    description: sourcePackage.description,
    license: config.license,
    repository: { type: "git", url: "git+https://github.com/goodpuppies/workman.git" },
    bin: { wm: "./bin/wm.cjs" },
    exports: sourcePackage.exports,
    files: ["bin", "src/integrations", "README.md", "LICENSE"],
    publishConfig: { access: "public" },
    engines: { node: ">=20" },
    typescript: {
      contentMapper: {
        exec: ["node", "./bin/wm.cjs", "content-mapper"],
        compilerOptions: [],
        dynamicConfig: true,
      },
    },
    optionalDependencies: Object.fromEntries(
      releaseTargets.map((target) => [`${config.name}-${target.name}`, version]),
    ),
  });
  const revision = await new Deno.Command("git", {
    args: ["rev-parse", "HEAD"],
    cwd: root,
    stdout: "piped",
    stderr: "null",
  }).output();
  const state = await new Deno.Command("git", {
    args: ["status", "--porcelain"],
    cwd: root,
    stdout: "piped",
    stderr: "null",
  }).output();
  const source = {
    revision: new TextDecoder().decode(revision.stdout).trim(),
    dirty: state.stdout.length > 0,
  };
  const artifacts = [];
  for (const target of selected) {
    const file = target.os === "win32" ? "wm.exe" : "wm";
    const binary = join(out, "binaries", target.name, file);
    await Deno.mkdir(dirname(binary), { recursive: true });
    if (build) {
      // Modules reached only through URL strings: the problems viewer's language server, which the
      // binary runs as a script, and the JavaScript SubsetML reader for wm sml.
      const include = [
        "src/generated/frontend_v2_parser.js",
        "src/lsp/node_entry.ts",
        "src/generated/subsetml.js",
        // Node's declarations for reflecting node: modules, with undici-types beside them in
        // Deno's node_modules layout; nothing imports these types-only packages.
        relative(root, dirname(dirname(Deno.realPathSync(join(root, "node_modules/@types/node"))))),
      ];
      const assets = [
        "std",
        "subml-basis",
        "host",
        "tooling/pakman/pakman.wm",
        "tooling/pakman/api",
        "tooling/pakman/src",
      ];
      for await (const item of Deno.readDir(join(root, "tooling/wmslang"))) {
        if (item.isFile && item.name.endsWith(".wm")) assets.push(`tooling/wmslang/${item.name}`);
      }
      const status = await new Deno.Command(Deno.execPath(), {
        args: [
          "compile",
          "-A",
          // Every unstable API a program run by the binary may need (runtime_flags.ts).
          "--unstable-webgpu",
          "--no-check",
          // Embed only the npm packages the CLI reaches. With the repository's node_modules
          // (manual mode), deno compile would embed all of it, dev tools and the package's
          // self-link included.
          "--node-modules-dir=none",
          "--exclude-unused-npm",
          "--target",
          target.triple,
          ...include.flatMap((path) => ["--include", path]),
          ...assets.flatMap((path) => ["--include", path]),
          "--output",
          binary,
          "src/release_cli.ts",
        ],
        cwd: root,
      }).spawn().status;
      if (!status.success) throw new Error(`Binary build failed: ${target.name}`);
    }
    const platform = join(npm, `workman-${target.name}`);
    await Deno.mkdir(join(platform, "bin"), { recursive: true });
    await Deno.copyFile(binary, join(platform, "bin", file));
    if (Deno.build.os !== "windows") await Deno.chmod(join(platform, "bin", file), 0o755);
    await Deno.copyFile(join(root, "LICENSE"), join(platform, "LICENSE"));
    await writeJson(join(platform, "package.json"), {
      name: `${config.name}-${target.name}`,
      version,
      license: config.license,
      os: [target.os],
      cpu: [target.cpu],
      ...(target.os === "linux" ? { libc: ["glibc"] } : {}),
      files: ["bin", "LICENSE"],
      publishConfig: { access: "public" },
    });
    const sha256 = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", await Deno.readFile(binary))),
    ].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    artifacts.push({ target: target.name, path: `binaries/${target.name}/${file}`, sha256 });
  }
  await writeJson(join(out, "release.json"), {
    name: config.name,
    version,
    deno: Deno.version.deno,
    source,
    artifacts,
  });
  console.log(`Staged ${config.name}@${version}: ${out}`);
}

if (import.meta.main) {
  let output = join(root, "_scratch/release");
  let targets = [
    `${Deno.build.os === "windows" ? "win32" : Deno.build.os}-${
      Deno.build.arch === "x86_64" ? "x64" : "arm64"
    }`,
  ];
  let build = true;
  for (let index = 0; index < Deno.args.length; index++) {
    const arg = Deno.args[index];
    if (arg === "--out") output = Deno.args[++index] ?? "";
    else if (arg === "--target") targets = (Deno.args[++index] ?? "").split(",");
    else if (arg === "--all") targets = releaseTargets.map((target) => target.name);
    else if (arg === "--skip-build") build = false;
    else throw new Error(`Unknown release argument: ${arg}`);
  }
  if (!output) throw new Error("--out requires a path");
  await stageRelease(output, targets, build);
}
