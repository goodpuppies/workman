// Repository acquisition is a manager operation. Package code gets immutable
// source URLs and cannot execute Git or read local working trees itself.
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { download, extract, freeze, sha256Text } from "./host.ts";

export type RepositorySnapshot = {
  locator: string;
  revision: string;
  published: string;
  archive: string;
  root: string;
};

export function isRepository(name: string): boolean {
  return name.startsWith("github.com/");
}

export function repositoryLocator(name: string): { owner: string; repo: string; ref: string } {
  const match = /^github\.com\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)(?:#([A-Za-z0-9_./-]+))?$/.exec(
    name,
  );
  if (!match || match[2] === "." || match[2] === "..") {
    throw new Error(`invalid repository ${name}; expected github.com/owner/repo[#ref]`);
  }
  return { owner: match[1], repo: match[2], ref: match[3] ?? "HEAD" };
}

export function packageStoreName(name: string): string {
  return name.replace(/[^A-Za-z0-9._+-]/g, "_");
}

async function jsonFile(path: string): Promise<RepositorySnapshot | undefined> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

function localRepositories(): Record<string, string> {
  const value = JSON.parse(Deno.env.get("PAKMAN_REPOSITORIES") ?? "{}");
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    Object.values(value).some((path) => typeof path !== "string")
  ) {
    throw new Error(
      "PAKMAN_REPOSITORIES must be a JSON object mapping repository names to local Git roots",
    );
  }
  return value;
}

async function git(root: string, args: string[]): Promise<string> {
  const result = await new Deno.Command("git", {
    args: ["-C", root, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (result.code) throw new Error(new TextDecoder().decode(result.stderr).trim());
  return new TextDecoder().decode(result.stdout);
}

async function localSnapshot(
  directory: string,
  locator: string,
  local: string,
): Promise<RepositorySnapshot> {
  const root = await Deno.realPath(resolve(local));
  if (await Deno.realPath((await git(root, ["rev-parse", "--show-toplevel"])).trim()) !== root) {
    throw new Error(`local repository mapping must name a Git root: ${local}`);
  }
  // Git's ignore rules exclude .env, compiler scratch, caches, and other local
  // private data. Include untracked source so a new pak.wm is testable pre-commit.
  const files = (await git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]))
    .split("\0").filter(Boolean).sort();
  const contents: { path: string; bytes: Uint8Array; mode: number }[] = [];
  const identities: string[] = [];
  for (const path of files) {
    if (path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`unsafe repository path: ${path}`);
    }
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.lstat(join(root, path));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue; // a locally deleted tracked file
      throw error;
    }
    if (!stat.isFile) {
      throw new Error(`local repository snapshots currently require regular files: ${path}`);
    }
    const bytes = await Deno.readFile(join(root, path));
    const mode = (stat.mode ?? 0o644) & 0o111 ? 0o755 : 0o644;
    identities.push(
      path,
      String(mode),
      Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join(""),
    );
    contents.push({ path, bytes, mode });
  }
  const revision = `local-${await sha256Text(JSON.stringify(identities))}`;
  const location = join(directory, revision);
  const existing = await jsonFile(join(location, "snapshot.json"));
  if (existing) return existing;
  await Deno.mkdir(directory, { recursive: true });
  const staging = await Deno.makeTempDir({ dir: directory, prefix: ".snapshot-" });
  try {
    const tree = join(staging, "tree");
    await Deno.mkdir(tree);
    for (const item of contents) {
      const target = join(tree, item.path);
      await Deno.mkdir(dirname(target), { recursive: true });
      await Deno.writeFile(target, item.bytes, { mode: item.mode });
    }
    await Deno.stat(join(tree, "pak.wm"));
    const result = await new Deno.Command("bsdtar", {
      args: ["-cf", join(staging, "source.tar"), "-C", tree, "."],
      stderr: "piped",
    }).output();
    if (result.code) throw new Error(new TextDecoder().decode(result.stderr));
    const snapshot: RepositorySnapshot = {
      locator,
      revision,
      published: new Date().toISOString(),
      archive: pathToFileURL(join(location, "source.tar")).href,
      root: join(location, "tree"),
    };
    await freeze(tree);
    await Deno.writeTextFile(join(staging, "snapshot.json"), JSON.stringify(snapshot));
    await Deno.rename(staging, location);
    return snapshot;
  } finally {
    await Deno.remove(staging, { recursive: true }).catch(() => {});
  }
}

async function remoteSnapshot(directory: string, locator: string): Promise<RepositorySnapshot> {
  const { owner, repo, ref } = repositoryLocator(locator);
  const token = Deno.env.get("GITHUB_TOKEN");
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
    {
      headers: { "User-Agent": "pakman", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${locator}: GitHub HTTP ${response.status}`);
  }
  const commit = await response.json();
  if (
    !/^[a-f0-9]{40}$/.test(commit.sha) ||
    !Number.isFinite(Date.parse(commit.commit?.committer?.date))
  ) {
    throw new Error(`${locator}: invalid GitHub commit metadata`);
  }
  const location = join(directory, commit.sha);
  const existing = await jsonFile(join(location, "snapshot.json"));
  if (existing) return existing;
  await Deno.mkdir(directory, { recursive: true });
  const staging = await Deno.makeTempDir({ dir: directory, prefix: ".snapshot-" });
  try {
    const archive = `https://codeload.github.com/${owner}/${repo}/tar.gz/${commit.sha}`;
    await download(archive, join(staging, "source.tar"));
    const tree = join(staging, "tree");
    await extract([join(staging, "source.tar")], [], tree, 1);
    try {
      await Deno.stat(join(tree, "pak.wm"));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(
          `${locator}@${commit.sha}: no root pak.wm; publish the recipe or set PAKMAN_REPOSITORIES to test a local checkout`,
        );
      }
      throw error;
    }
    const snapshot: RepositorySnapshot = {
      locator,
      revision: commit.sha,
      published: commit.commit.committer.date,
      archive,
      root: join(location, "tree"),
    };
    await freeze(tree);
    await Deno.writeTextFile(join(staging, "snapshot.json"), JSON.stringify(snapshot));
    await Deno.rename(staging, location);
    return snapshot;
  } finally {
    await Deno.remove(staging, { recursive: true }).catch(() => {});
  }
}

export async function repositoryRecipe(
  state: string,
  locator: string,
  refresh = false,
): Promise<string> {
  repositoryLocator(locator);
  const directory = join(state, "repositories", await sha256Text(locator));
  const pointer = join(directory, "current.json");
  const current = await jsonFile(pointer);
  if (current && !refresh) return join(current.root, "pak.wm");
  const local = localRepositories()[locator];
  const snapshot = local
    ? await localSnapshot(directory, locator, local)
    : await remoteSnapshot(directory, locator);
  await Deno.writeTextFile(`${pointer}.tmp`, JSON.stringify(snapshot));
  await Deno.rename(`${pointer}.tmp`, pointer);
  return join(snapshot.root, "pak.wm");
}

/** Metadata follows the compiled recipe, not a mutable repository HEAD pointer. */
export async function repositoryMetadata(program: string): Promise<RepositorySnapshot> {
  const source = await Deno.readTextFile(`${program}.source`);
  const metadata = await jsonFile(join(dirname(dirname(source)), "snapshot.json"));
  if (!metadata) throw new Error("pak:self requires a repository-native package");
  return metadata;
}

export async function repositoryVersion(program: string): Promise<string[]> {
  const snapshot = await repositoryMetadata(program);
  return [snapshot.revision, snapshot.published];
}

export async function recipeSource(program: string, url: string): Promise<string> {
  if (url === "pak:self") return (await repositoryMetadata(program)).archive;
  if (!url.startsWith("pak:recipe/")) return url;
  const relative = url.slice("pak:recipe/".length);
  if (
    !relative || relative.startsWith("/") ||
    relative.split("/").some((p) => p === ".." || p === "." || !p)
  ) {
    throw new Error(`invalid recipe resource ${url}`);
  }
  const source = await Deno.readTextFile(`${program}.source`);
  const root = await Deno.realPath(dirname(source));
  const path = await Deno.realPath(join(root, relative));
  if (!path.startsWith(`${root}/`)) {
    throw new Error(`recipe resource escapes its directory: ${url}`);
  }
  return pathToFileURL(path).href;
}

export async function packageProgramPath(
  state: string,
  name: string,
  recipe: string,
): Promise<string> {
  if (!isRepository(name)) return join(state, "programs", `${name}.js`);
  return join(
    state,
    "programs",
    "repositories",
    await sha256Text(name),
    `${await sha256Text(recipe)}.js`,
  );
}

async function receiptPath(lock: string, name: string, selection: string): Promise<string> {
  return join(`${lock}.recipes`, `${await sha256Text(name + "\0" + selection)}.json`);
}

export async function rememberRecipe(
  lock: string,
  name: string,
  selection: string,
  program: string,
): Promise<void> {
  if (!isRepository(name)) return;
  const path = await receiptPath(lock, name, selection);
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(`${path}.tmp`, JSON.stringify({ name, program }));
  await Deno.rename(`${path}.tmp`, path);
}

export async function lockedRecipe(lock: string, name: string, selection: string): Promise<string> {
  const path = await receiptPath(lock, name, selection);
  const receipt = JSON.parse(await Deno.readTextFile(path));
  if (receipt.name !== name || typeof receipt.program !== "string") {
    throw new Error("invalid recipe receipt");
  }
  return receipt.program;
}
