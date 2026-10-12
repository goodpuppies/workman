// Host primitives for pakman.
//
// Everything that touches Deno, bytes or the filesystem lives here, behind
// Workman-shaped signatures: strings, numbers, string arrays, and promises of
// those. pakman's .wm code never reaches into Deno directly, which keeps the
// boundary small for the later rewrite off the JS APIs.

const userAgent = "pakman/0.1 (+https://github.com/goodpuppies)";

export function argv(): string[] {
  return Deno.args;
}

export function envOr(name: string, fallback: string): string {
  return Deno.env.get(name) ?? fallback;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Seconds since the epoch for an ISO-8601 timestamp, or -1 if it does not parse. */
export function isoToSeconds(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? -1 : Math.floor(ms / 1000);
}

/** The full match followed by every capture group, or [] when nothing matches. */
export function captures(pattern: string, text: string): string[] {
  const match = text.match(new RegExp(pattern));
  return match ? Array.from(match, (part) => part ?? "") : [];
}

// Every match of `pattern` in `text`, each as its captures (whole match first).
export function capturesAll(pattern: string, text: string): string[][] {
  return Array.from(text.matchAll(new RegExp(pattern, "g")), (match) => Array.from(match, (part) => part ?? ""));
}

/** Every full match of a global pattern's first capture group. */
export function captureAll(pattern: string, text: string): string[] {
  return Array.from(text.matchAll(new RegExp(pattern, "g")), (m) => m[1] ?? m[0]);
}

/** A JSON string literal for `text`. */
export function quote(text: string): string {
  return JSON.stringify(text);
}

// ---------------------------------------------------------------------------
// Network

function headers(): HeadersInit {
  const token = Deno.env.get("GITHUB_TOKEN");
  return token
    ? { "User-Agent": userAgent, "Authorization": `Bearer ${token}` }
    : { "User-Agent": userAgent };
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`GET ${url}: HTTP ${response.status}`);
  }
  return await response.text();
}

/** Downloads `url` to `dest` (via a temporary file, so `dest` never holds a partial download). */
export async function download(url: string, dest: string): Promise<void> {
  if (url.startsWith("file://")) {
    const source = new URL(url);
    if (source.hostname !== "" && source.hostname !== "localhost") throw new Error("local source must be on this machine");
    await Deno.copyFile(source, `${dest}.part`);
    await Deno.rename(`${dest}.part`, dest);
    return;
  }
  const response = await fetch(url, { headers: headers() });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`GET ${url}: HTTP ${response.status}`);
  }
  const partial = `${dest}.part`;
  const file = await Deno.open(partial, { write: true, create: true, truncate: true });
  await response.body.pipeTo(file.writable);
  await Deno.rename(partial, dest);
}

// ---------------------------------------------------------------------------
// Hashing

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256File(path: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", await Deno.readFile(path)));
}

export async function sha256Text(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// ---------------------------------------------------------------------------
// Filesystem

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

export async function mkdirp(path: string): Promise<void> {
  await Deno.mkdir(path, { recursive: true });
}

export async function makeTempDir(parent: string, prefix: string): Promise<string> {
  await Deno.mkdir(parent, { recursive: true });
  return await Deno.makeTempDir({ dir: parent, prefix });
}

export async function readText(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

/** Reads a file, or returns `fallback` when it does not exist. */
export async function readTextOr(path: string, fallback: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return fallback;
    throw error;
  }
}

/** Atomically replaces `path` with `text`. */
export async function writeText(path: string, text: string, mode: number): Promise<void> {
  const partial = `${path}.part`;
  await Deno.writeTextFile(partial, text, { mode });
  await Deno.chmod(partial, mode);
  await Deno.rename(partial, path);
}

export async function copyFile(source: string, dest: string, mode: number): Promise<void> {
  await Deno.copyFile(source, dest);
  await Deno.chmod(dest, mode);
}

export async function symlink(target: string, path: string): Promise<void> {
  await Deno.symlink(target, path);
}

export async function readLink(path: string): Promise<string> {
  return await Deno.readLink(path);
}

export async function isSymlink(path: string): Promise<boolean> {
  return (await Deno.lstat(path)).isSymlink;
}

/** Hardlinks `source` to `dest`, copying instead when they are on different filesystems. */
export async function linkOrCopy(source: string, dest: string): Promise<void> {
  try {
    await Deno.link(source, dest);
  } catch (error) {
    if (!(error instanceof Error) || !/cross-device|EXDEV/i.test(error.message)) throw error;
    await Deno.copyFile(source, dest);
    await Deno.chmod(dest, (await Deno.stat(source)).mode! & 0o7777);
  }
}

/** Removes a file or symlink (never a directory). Missing paths are fine. */
export async function removeFile(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

/** Removes `path` and any parents up to (not including) `stop` while they are empty. */
export async function pruneEmptyDirs(path: string, stop: string): Promise<void> {
  let dir = path;
  while (dir.startsWith(stop + "/") && dir !== stop) {
    try {
      await Deno.remove(dir);
    } catch {
      return;
    }
    dir = dir.slice(0, dir.lastIndexOf("/"));
  }
}

export async function removeTree(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

export async function rename(source: string, dest: string): Promise<void> {
  await Deno.rename(source, dest);
}

/** Marks every file under `root` read-only, as store trees are immutable. */
export async function freeze(root: string): Promise<void> {
  for (const entry of await walk(root)) {
    const path = `${root}/${entry}`;
    const info = await Deno.lstat(path);
    if (info.isFile) await Deno.chmod(path, info.mode! & 0o555);
  }
}

/** Files and symlinks under `root`, as sorted paths relative to it. Directories are implied. */
export async function walk(root: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (dir: string, rel: string) => {
    for await (const entry of Deno.readDir(dir)) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory) await visit(`${dir}/${entry.name}`, childRel);
      else found.push(childRel);
    }
  };
  await visit(root, "");
  return found.sort();
}

export async function listDir(path: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(path)) names.push(entry.name);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return names.sort();
}

/**
 * Files and symlinks under `root` as a flat [path, linkTarget, path, linkTarget, ...] list,
 * sorted by path. `linkTarget` is "" for regular files.
 */
export async function walkEntries(root: string): Promise<string[]> {
  const flat: string[] = [];
  for (const rel of await walk(root)) {
    const info = await Deno.lstat(`${root}/${rel}`);
    flat.push(rel, info.isSymlink ? await Deno.readLink(`${root}/${rel}`) : "");
  }
  return flat;
}

/** Runs a command with its output discarded; returns the exit code (127 if it is missing). */
export async function runQuiet(cmd: string, args: string[]): Promise<number> {
  try {
    const { code } = await new Deno.Command(cmd, { args, stdout: "null", stderr: "null" }).output();
    return code;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return 127;
    throw error;
  }
}

export function eprint(text: string): void {
  console.error(text);
}

export function exit(code: number): void {
  Deno.exit(code);
}

export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

/** -1, 0 or 1 by code-unit order (not locale order, so it is stable everywhere). */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// Whether `text` contains `letters` in order, not necessarily adjacent: ogb in oscgoesbrrr.
export function hasLetters(letters: string, text: string): boolean {
  let at = 0;
  for (const letter of text) if (letter === letters[at]) at++;
  return at === letters.length;
}

/** The decimal integer in `text` (surrounding whitespace allowed), or `fallback`. */
export function parseIntOr(text: string, fallback: number): number {
  return /^\s*\d+\s*$/.test(text) ? Number.parseInt(text, 10) : fallback;
}

/** JSON with two-space indentation and a trailing newline, for files people read and diff. */
export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Package programs
//
// Each package is its own wm program. pakman compiles it once (reusing the
// result until a tracked Workman input or compiler source changes), then runs it
// as a separate Deno process with only the permissions the command needs.

const pakmanSrc = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const wmMain = new URL("../../../src/main.ts", import.meta.url).pathname;

/** The pakman checkout this code runs from. */
export function pakmanRoot(): string {
  return pakmanSrc.slice(0, pakmanSrc.lastIndexOf("/"));
}

async function mtime(path: string): Promise<number> {
  try {
    return (await Deno.stat(path)).mtime?.getTime() ?? 0;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return 0;
    throw error;
  }
}

/** Compiles a package program when stale and returns the compiled JS path. */
export async function compileProgram(source: string, compiled: string): Promise<string> {
  const inputs: string[] = [];
  const visited = new Set<string>();
  const visit = async (file: string) => {
    if (visited.has(file)) return;
    visited.add(file);
    const text = await Deno.readTextFile(file);
    inputs.push(file, await sha256Text(text));
    for (const match of text.matchAll(/^\s*from\s+["']([^"']+)["']/gm)) {
      await visit(decodeURIComponent(new URL(match[1], `file://${file}`).pathname));
    }
  };
  await visit(source);
  // Implicit standard modules and compiler changes also invalidate compilation.
  const checkout = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
  for (const tree of ["src", "std"]) {
    for (const file of await walk(`${checkout}/${tree}`)) {
      if (/\.(wm|ts|js)$/.test(file)) inputs.push(`${tree}/${file}`, String(await mtime(`${checkout}/${tree}/${file}`)));
    }
  }
  const compiler = Deno.env.get("PAKMAN_WM");
  if (compiler) inputs.push(compiler, await sha256File(compiler));
  const fingerprint = await sha256Text(JSON.stringify(inputs));
  if (await exists(compiled) && await readTextOr(`${compiled}.inputs`, "") === fingerprint) return compiled;
  await Deno.mkdir(dirname(compiled), { recursive: true });
  // The wm compiler this pakman is part of, unless PAKMAN_WM names another.
  const wm = Deno.env.get("PAKMAN_WM");
  const command = wm ? [wm] : [Deno.execPath(), "run", "-A", wmMain];
  const { code, stdout, stderr } = await new Deno.Command(command[0], {
    args: [...command.slice(1), "compile", source, `${compiled}.tmp`],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    const decoder = new TextDecoder();
    const detail = (decoder.decode(stderr) + decoder.decode(stdout)).trim();
    throw new Error(`${source} does not compile:\n${detail}`);
  }
  await Deno.rename(`${compiled}.tmp`, compiled);
  await Deno.writeTextFile(`${compiled}.inputs`, fingerprint);
  return compiled;
}

/** Runs a command and returns its stdout. A non-zero exit fails with its stderr. */
export async function runCapture(cmd: string, args: string[]): Promise<string> {
  const { code, stdout, stderr } = await new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  if (code !== 0) {
    const message = decoder.decode(stderr).trim();
    throw new Error(message === "" ? `${cmd} exited with ${code}` : message);
  }
  return decoder.decode(stdout);
}

async function bsdtar(args: string[], stdoutTo?: string): Promise<void> {
  const result = await new Deno.Command("bsdtar", {
    args,
    stdout: stdoutTo ? "piped" : "null",
    stderr: "piped",
  }).output();
  if (result.code !== 0) throw new Error(`bsdtar failed:\n${new TextDecoder().decode(result.stderr).trim()}`);
  if (stdoutTo) await Deno.writeFile(stdoutTo, result.stdout);
}

/**
 * Unpacks an archive with bsdtar (tar of any compression, .deb, .zip, ...).
 * `chain` is the archive file followed by members to open in turn, for archives
 * inside archives; `members` selects paths in the innermost one ([] = all).
 */
export async function extract(chain: string[], members: string[], dest: string, strip: number): Promise<void> {
  await Deno.mkdir(dest, { recursive: true });
  const temps: string[] = [];
  try {
    let current = chain[0];
    for (const member of chain.slice(1)) {
      const temp = await Deno.makeTempFile({ prefix: "pakman-nested-" });
      temps.push(temp);
      await bsdtar(["-xOf", current, member], temp);
      current = temp;
    }
    await bsdtar(["-xf", current, "-C", dest, `--strip-components=${strip}`, "--no-same-owner", ...members]);
  } finally {
    for (const temp of temps) await Deno.remove(temp).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Dynamic JSON, for documents a wm record can't describe (object keys that are
// data, such as version numbers, or names like "x86_64-linux").

/** The keys of a JSON object in document order, or [] for anything else. */
export function jsonKeys(value: unknown): string[] {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
}

/** The field `key` of a JSON object; fails when it is missing. */
export function jsonField(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || !(key in value)) {
    throw new Error(`missing field ${key}`);
  }
  return (value as Record<string, unknown>)[key];
}

/** A JSON string value, or `fallback` for null, missing or non-string values. */
export function jsonTextOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Follows redirects with a HEAD request. Returns [final URL, Last-Modified as
 * ISO-8601 or ""], for downloads whose version is only visible in where a
 * stable link redirects to.
 */
export async function headInfo(url: string): Promise<string[]> {
  const response = await fetch(url, { method: "HEAD", redirect: "follow", headers: headers() });
  if (!response.ok) throw new Error(`HEAD ${url}: HTTP ${response.status}`);
  const modified = response.headers.get("last-modified");
  const ms = modified ? Date.parse(modified) : NaN;
  return [response.url, Number.isNaN(ms) ? "" : new Date(ms).toISOString()];
}

// ---------------------------------------------------------------------------
// Applying generations

/** Copies a file keeping its permission bits (the copy is owned by whoever runs this). */
export async function copyPreserving(source: string, dest: string): Promise<void> {
  await Deno.copyFile(source, dest);
  await Deno.chmod(dest, (await Deno.stat(source)).mode! & 0o7777);
}

/** Whether the current user can create files in `dir` (which must exist). */
export async function canWrite(dir: string): Promise<boolean> {
  try {
    const probe = await Deno.makeTempFile({ dir, prefix: ".pakman-probe-" });
    await Deno.remove(probe);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.PermissionDenied) return false;
    throw error;
  }
}

/** Asks a y/N question on the terminal. No terminal means no. */
export function confirmYes(question: string): boolean {
  if (!Deno.stdin.isTerminal()) return false;
  return confirm(question);
}

/** The Deno executable running pakman, so an elevated applier runs the same one. */
export function denoPath(): string {
  return Deno.execPath();
}

/** Runs a command attached to the terminal (sudo may prompt) and returns its exit code. */
export async function runInteractive(cmd: string, args: string[]): Promise<number> {
  const { code } = await new Deno.Command(cmd, { args, stdin: "inherit", stdout: "inherit", stderr: "inherit" })
    .spawn().status;
  return code;
}

/**
 * The given root-relative paths that a pacman database inside `root` lists as
 * owned (`<root>/var/lib/pacman/local/<pkg>/files`). [] when there is no such
 * database, as in a test root or a system without pacman.
 */
export async function pacmanOwned(root: string, paths: string[]): Promise<string[]> {
  const local = `${root}/var/lib/pacman/local`;
  const wanted = new Set(paths);
  const owned: string[] = [];
  try {
    for await (const entry of Deno.readDir(local)) {
      if (!entry.isDirectory) continue;
      let text: string;
      try {
        text = await Deno.readTextFile(`${local}/${entry.name}/files`);
      } catch {
        continue;
      }
      const start = text.indexOf("%FILES%\n");
      if (start < 0) continue;
      for (const line of text.slice(start + 8).split("\n")) {
        if (line === "" || line.startsWith("%")) break;
        const path = line.endsWith("/") ? line.slice(0, -1) : line;
        if (wanted.has(path)) owned.push(`${path} (pacman: ${entry.name})`);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
  return owned;
}

// The compiler bundles Workman modules but preserves JS FFI imports. Snapshot
// literal local imports recursively so their code is mounted and hashed too.
async function buildModules(program: string): Promise<string[]> {
  const found = new Set<string>();
  const visit = async (path: string) => {
    if (found.has(path)) return;
    found.add(path);
    const text = await Deno.readTextFile(path);
    const imports = /\bimport\s*\(\s*["']([^"']+)["']|^\s*(?:import|export)[^\n]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm;
    for (const match of text.matchAll(imports)) {
      const url = new URL(match[1] ?? match[2] ?? match[3], `file://${path}`);
      if (url.protocol !== "file:") throw new Error(`host builds require local JS imports: ${url}`);
      await visit(decodeURIComponent(url.pathname));
    }
  };
  await visit(program);
  return [...found].sort();
}

// First backend: offline Linux host builds. /usr is the host tool environment,
// not a hermetic tool closure. Keep its package database in the cache identity.
export async function buildIdentity(program: string, tools: string[]): Promise<string> {
  const entries: string[] = ["pakman-host-build-v1", Deno.build.os, Deno.build.arch];
  for (const path of [...await buildModules(program), Deno.execPath(), "/usr/bin/bwrap", ...tools]) {
    if (!path.startsWith("/") || path.includes("..") || path.includes(",")) {
      throw new Error(`build tools must be absolute paths: ${path}`);
    }
    entries.push(path, await sha256File(path));
  }
  // Arch's installed package manifests cover the toolchain, loader and libraries.
  // Undeclared/manual changes under /usr are outside this backend's cache contract.
  if (await exists("/var/lib/pacman/local")) {
    for (const file of await walk("/var/lib/pacman/local")) {
      entries.push(file, await sha256File(`/var/lib/pacman/local/${file}`));
    }
  } else {
    throw new Error("host build cache identity currently requires an Arch package database");
  }
  return await sha256Text(JSON.stringify(entries));
}

export async function runBuild(
  program: string, id: string, version: string, ref: string,
  inputs: string, work: string, out: string, tools: string[],
): Promise<void> {
  for (const name of await listDir(inputs)) {
    if (!/^[A-Za-z0-9._+-]+$/.test(name) || name === "." || name === "..") {
      throw new Error(`unsafe build input name: ${name}`);
    }
  }
  const scratch = `${work}/scratch`;
  await mkdirp(scratch);
  const mounts: string[] = [];
  for (const module of await buildModules(program)) mounts.push("--ro-bind", module, module);
  // Tools outside /usr (e.g. an explicitly selected compiler) are mounted alone.
  for (const tool of tools) {
    if (!tool.startsWith("/usr/")) mounts.push("--ro-bind", await Deno.realPath(tool), tool);
  }
  await runCapture("/usr/bin/bwrap", [
    "--unshare-all", "--die-with-parent", "--new-session", "--clearenv",
    "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin",
    "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib", "/lib64",
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
    "--ro-bind", program, "/runner/program.js",
    "--ro-bind", Deno.execPath(), "/runner/deno",
    "--ro-bind", inputs, "/inputs", "--bind", scratch, "/work", "--bind", out, "/out",
    ...mounts, "--setenv", "HOME", "/work", "--setenv", "PATH", "/usr/bin:/bin",
    "--setenv", "TMPDIR", "/tmp", "--setenv", "DENO_DIR", "/work/deno-cache",
    "--setenv", "LC_ALL", "C", "--setenv", "SOURCE_DATE_EPOCH", "0", "--chdir", "/work",
    "/runner/deno", "run", "--no-prompt", "--quiet", "--cached-only",
    "--allow-read=/inputs,/work,/out,/usr", "--allow-write=/work,/out,/tmp",
    "--allow-env=HOME,PATH,TMPDIR,LC_ALL,SOURCE_DATE_EPOCH",
    ...(tools.length ? [`--allow-run=${tools.join(",")}`] : []),
    "/runner/program.js", "build", id, version, ref,
  ]);
  for (const file of await walk(out)) {
    const stat = await Deno.lstat(`${out}/${file}`);
    if (!(stat.isFile || stat.isSymlink) || (stat.mode! & 0o6000) !== 0 || (stat.isFile && stat.nlink! > 1)) {
      throw new Error(`build produced an unsupported file: ${file}`);
    }
  }
}

export async function stageBuildInput(source: string, inputs: string, name: string): Promise<void> {
  if (!/^[A-Za-z0-9._+-]+$/.test(name) || name === "." || name === "..") throw new Error(`unsafe build input name: ${name}`);
  await copyFile(source, `${inputs}/${name}`, 0o444);
}
