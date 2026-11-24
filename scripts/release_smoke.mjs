import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const output = resolve(process.argv[2] ?? "_scratch/release");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check through npm run release:smoke");
const metadata = JSON.parse(await readFile(join(output, "release.json"), "utf8"));
const target = `${process.platform}-${process.arch}`;
assert(
  metadata.artifacts.some((item) => item.target === target),
  `No host binary staged for ${target}`,
);
const directory = await mkdtemp(join(tmpdir(), "wm-release-smoke-"));
function run(command, args, options = {}) {
  const child = spawnSync(command, args, { cwd: directory, encoding: "utf8", ...options });
  if (child.error || child.status !== 0) {
    throw new Error(child.error?.message ?? `${command} failed: ${child.stdout}\n${child.stderr}`);
  }
  return child.stdout;
}
const npm = (args) => run(process.execPath, [npmCli, ...args]);
try {
  const tarballs = [];
  for (const name of ["workman", `workman-${target}`]) {
    const report = JSON.parse(
      npm([
        "pack",
        join(output, "npm", name),
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        directory,
      ]),
    );
    tarballs.push(join(directory, report[0].filename));
  }
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  npm([
    "install",
    "--offline",
    "--ignore-scripts",
    "--omit=optional",
    "--no-audit",
    "--no-fund",
    ...tarballs,
  ]);
  const bin = join(directory, "node-only");
  await mkdir(bin);
  if (process.platform === "win32") await copyFile(process.execPath, join(bin, "node.exe"));
  else await symlink(process.execPath, join(bin, "node"));
  const env = { ...process.env, PATH: bin, WORKMAN_DENO_PATH: join(bin, "missing-deno") };
  const launcher = join(directory, "node_modules", ...metadata.name.split("/"), "bin/wm.cjs");
  assert(run(process.execPath, [launcher, "--version"], { env }).includes(metadata.version));
  await writeFile(
    join(directory, "math.wm"),
    "let add = (a: Real64.Real, b: Real64.Real) => a + b;",
  );
  // The binary runs programs itself: no Deno on PATH, and WORKMAN_DENO_PATH names a missing file.
  const wm = (args) => run(process.execPath, [launcher, ...args], { env });
  await writeFile(
    join(directory, "hello.wm"),
    'from js.module("node:path") import { basename };\n' +
      'from js.module("./util.ts") import { double };\n' +
      "let main = () => {\n" +
      '  print(basename("/a/b/c.txt") :> Result.debug);\n' +
      "  print(double(21) :> Result.debug)\n" +
      "};\n",
  );
  await writeFile(
    join(directory, "util.ts"),
    "export function double(n: number): number { return n * 2; }\n",
  );
  assert.equal(wm(["run", "hello.wm"]), "c.txt\n42\n");
  assert(wm(["repl", "40 + 2;"]).includes("it = 42"));
  await writeFile(
    join(directory, "math.test.wm"),
    'from "testman/test.wm" import *;\nlet tests = [ test("adds", () => assertEqual(1 + 1, 2)) ];\n',
  );
  assert(wm(["test", "math.test.wm"]).includes("1 passed"));
  // Bare `node_modules` package imports work end-to-end (tsrs reflection + embedded esbuild).
  const demoPkgDir = join(directory, "node_modules", "demo-pkg");
  await mkdir(demoPkgDir, { recursive: true });
  await writeFile(
    join(demoPkgDir, "package.json"),
    JSON.stringify({
      name: "demo-pkg",
      version: "1.0.0",
      type: "module",
      exports: { ".": { types: "./index.d.ts", import: "./index.mjs" } },
    }),
  );
  await writeFile(
    join(demoPkgDir, "index.d.ts"),
    "export declare function greet(name: string): string;\n",
  );
  await writeFile(
    join(demoPkgDir, "index.mjs"),
    'export function greet(name) { return `hello, ${name}!`; }\n',
  );
  await writeFile(
    join(directory, "pkg_user.wm"),
    'from js.module("demo-pkg") import { greet };\n' +
      'let main = () => { print(greet("workman") :> Result.debug) };\n',
  );
  assert.equal(wm(["run", "pkg_user.wm"]), "hello, workman!\n");
  const rejected = (args, message) => {
    const child = spawnSync(process.execPath, [launcher, ...args], {
      cwd: directory,
      encoding: "utf8",
      env,
    });
    assert.notEqual(child.status, 0);
    assert(child.stderr.includes(message), child.stderr);
  };
  await writeFile(
    join(directory, "package.wm"),
    'from js.module("npm:left-pad@1.3.0") import unsafe { default as pad };\n',
  );
  rejected(["check", "package.wm"], "not supported without a Deno CLI");
  rejected(["compile", "hello.wm", "--executable", "-o", "hello"], "cannot create executables");
  const compiled = JSON.parse(
    run(process.execPath, [launcher, "compile-library-json", join(directory, "math.wm")], { env }),
  );
  await writeFile(join(directory, "math.mjs"), compiled.code);
  assert.equal((await import(pathToFileURL(join(directory, "math.mjs")).href)).add(20, 22), 42);
  // Module graph paths are canonical: macOS resolves /var through /private/var,
  // and Windows can change drive casing or path prefixes during resolution.
  const expectedDependency = await realpath(join(directory, "math.wm"));
  const dependencies = await Promise.all(compiled.dependencies.map((path) => realpath(path)));
  assert(dependencies.includes(expectedDependency), JSON.stringify(dependencies));
  // Exercise installed Node integration code, not just the binary's direct CLI.
  await writeFile(
    join(directory, "integration.mjs"),
    `
    import { strict as assert } from 'node:assert';
    import { workman } from ${JSON.stringify(metadata.name + "/vite")};
    const plugin = workman();
    const paths = [];
    const result = await plugin.load.call({ addWatchFile(path) { paths.push(path); } }, ${
      JSON.stringify(join(directory, "math.wm"))
    });
    assert(result.code.includes('add'));
    assert(paths.length > 0);
  `,
  );
  run(process.execPath, [join(directory, "integration.mjs")], { env });
  const requests = [
    [1, "initialize", { positionEncodings: ["utf-16"] }],
    [2, "openProject", { projectHandle: "smoke" }],
    [3, "transform", {
      projectHandle: "smoke",
      fileName: join(directory, "math.wm"),
      content: "let add = (left: Real64.Real, right: Real64.Real) => left + right;",
    }],
  ].map(([id, method, params]) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
  }).join("");
  const mapper = run(process.execPath, [launcher, "content-mapper"], { env, input: requests });
  assert(mapper.includes("left: number, right: number"));
  assert(!mapper.includes('"error":'));
  // The standalone binary is copied out of the package and run without its source directory.
  const file = process.platform === "win32" ? "wm.exe" : "wm";
  const standalone = join(directory, file);
  await copyFile(join(output, "binaries", target, file), standalone);
  if (process.platform !== "win32") {
    await (await import("node:fs/promises")).chmod(standalone, 0o755);
  }
  assert(run(standalone, ["--version"], { env }).includes(metadata.version));
  console.log(
    `Passed packed-package smoke checks: ${metadata.name}@${metadata.version} (${target}); Deno absent from PATH`,
  );
} finally {
  // Windows can keep the copied wm.exe locked briefly after its last run (EBUSY). The checks are
  // done by now, so retry, and leave the temp directory behind rather than fail the job.
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(
    (error) => console.warn(`Could not remove ${directory}: ${error.message}`),
  );
}
