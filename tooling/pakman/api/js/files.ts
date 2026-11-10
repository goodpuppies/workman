// Shared file operations. Self-contained so WM can embed this module.
import { dirname, resolve } from "node:path";
const userAgent = "pakman/0.1 (+https://github.com/goodpuppies)";

function headers(): HeadersInit {
  const token = Deno.env.get("GITHUB_TOKEN");
  return token
    ? { "User-Agent": userAgent, "Authorization": `Bearer ${token}` }
    : { "User-Agent": userAgent };
}

/** Downloads `url` to `dest` (via a temporary file, so `dest` never holds a partial download). */
export async function download(url: string, dest: string): Promise<void> {
  if (url.startsWith("file://")) {
    const source = new URL(url);
    if (source.hostname !== "" && source.hostname !== "localhost") {
      throw new Error("local source must be on this machine");
    }
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

async function archiveListing(path: string): Promise<string> {
  const result = await new Deno.Command("bsdtar", {
    args: ["-tf", path],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout);
}

async function bsdtar(args: string[], stdoutTo?: string): Promise<void> {
  const result = await new Deno.Command("bsdtar", {
    args,
    stdout: stdoutTo ? "piped" : "null",
    stderr: "piped",
  }).output();
  if (result.code !== 0) {
    throw new Error(`bsdtar failed:\n${new TextDecoder().decode(result.stderr).trim()}`);
  }
  if (stdoutTo) await Deno.writeFile(stdoutTo, result.stdout);
}

/**
 * Unpacks an archive with bsdtar (tar of any compression, .deb, .zip, ...).
 * `chain` is the archive file followed by members to open in turn, for archives
 * inside archives; `members` selects paths in the innermost one ([] = all).
 */
export async function extract(
  chain: string[],
  members: string[],
  dest: string,
  strip: number,
  payloadChoices?: string[],
): Promise<void> {
  if (!chain.length) throw new Error("archive chain is empty");
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
    if (payloadChoices !== undefined) {
      const listing = await archiveListing(current);
      const matches = listing.split("\n").filter((name) => payloadChoices.includes(name));
      if (matches.length !== 1) {
        throw new Error(
          `expected exactly one payload member from [${
            payloadChoices.join(", ")
          }], found ${matches.length}`,
        );
      }
      const temp = await Deno.makeTempFile({ prefix: "pakman-payload-" });
      temps.push(temp);
      await bsdtar(["-xOf", current, matches[0]], temp);
      current = temp;
    }
    await bsdtar([
      "-xf",
      current,
      "-C",
      dest,
      `--strip-components=${strip}`,
      "--no-same-owner",
      ...members,
    ]);
  } finally {
    for (const temp of temps) await Deno.remove(temp).catch(() => {});
  }
}

type Settle<T, R> = [ok: (value: T) => R, err: (message: string) => R];
async function settle<T, R>(run: () => Promise<T>, [ok, err]: Settle<T, R>): Promise<R> {
  try {
    return ok(await run());
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}
async function hash(path: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fetch pinned bytes to an ordinary file, publishing only after verification. */
export async function fetchVerified(url: string, sha256: string, dest: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("expected a 64-character lowercase SHA-256");
  if (!["https:", "file:"].includes(new URL(url).protocol)) {
    throw new Error("expected an HTTPS or local file URL");
  }
  try {
    if (await hash(dest) === sha256) return dest;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const directory = dirname(resolve(dest));
  await Deno.mkdir(directory, { recursive: true });
  const temporary = await Deno.makeTempDir({ dir: directory, prefix: ".pakman-fetch-" });
  try {
    const path = `${temporary}/download`;
    await download(url, path);
    if (await hash(path) !== sha256) throw new Error(`SHA-256 mismatch for ${url}`);
    await Deno.rename(path, dest);
    return dest;
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
}

export function fetchFile<R>(
  url: string,
  sha256: string,
  dest: string,
  ...settled: Settle<string, R>
): Promise<R> {
  return settle(() => fetchVerified(url, sha256, dest), settled);
}
export function unpackFile<R>(
  archive: string,
  dest: string,
  strip: number,
  ...settled: Settle<void, R>
): Promise<R> {
  return settle(async () => {
    if (!Number.isSafeInteger(strip) || strip < 0) {
      throw new Error("strip must be a nonnegative integer");
    }
    await extract([archive], [], dest, strip);
  }, settled);
}
