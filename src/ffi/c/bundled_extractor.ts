import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { gunzipSync } from "node:zlib";

// Keep payloads lazy: ordinary compilation never loads or unpacks native binaries.
const loaders: Record<string, () => Promise<{ asset: Asset }>> = {
  "linux-x64": () => import("../../generated/c_header_extractor/linux-x64.js"),
  "linux-arm64": () => import("../../generated/c_header_extractor/linux-arm64.js"),
  "darwin-x64": () => import("../../generated/c_header_extractor/darwin-x64.js"),
  "darwin-arm64": () => import("../../generated/c_header_extractor/darwin-arm64.js"),
  "win32-x64": () => import("../../generated/c_header_extractor/win32-x64.js"),
  "win32-arm64": () => import("../../generated/c_header_extractor/win32-arm64.js"),
};
interface Asset {
  protocol: number;
  platform: string;
  executable: string;
  sha256: string;
  resourcesSha256: string;
  gzipBase64: string;
}
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
let pending: Promise<string | undefined> | undefined;

export function bundledCHeaderExtractor(): Promise<string | undefined> {
  if (!pending) {
    pending = materialize().catch((error) => {
      pending = undefined;
      throw error;
    });
  }
  return pending;
}

async function materialize(): Promise<string | undefined> {
  const platform = `${process.platform}-${process.arch}`;
  const load = loaders[platform];
  if (!load) return undefined;
  const { asset } = await load();
  const { resources } = await import("../../generated/c_header_extractor/resources.js");
  if (
    asset.protocol !== 1 || asset.platform !== platform ||
    hash(JSON.stringify(resources)) !== asset.resourcesSha256
  ) {
    throw new Error(
      "Bundled C header extractor metadata/resource mismatch; regenerate with deno task c-header:build",
    );
  }
  const cache = process.env.WM_C_EXTRACTOR_CACHE_DIR ??
    join(tmpdir(), "workman-c-header-extractor");
  const directory = join(cache, `${platform}-${asset.sha256}-${asset.resourcesSha256}`);
  const executable = join(directory, asset.executable);
  async function valid() {
    try {
      if (hash(await fs.readFile(executable)) !== asset.sha256) return false;
      for (const [path, contents] of Object.entries(resources)) {
        if (await fs.readFile(join(directory, path), "utf8") !== contents) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  if (await valid()) {
    if (process.platform !== "win32") await fs.chmod(executable, 0o755);
    return executable;
  }
  const bytes = gunzipSync(Buffer.from(asset.gzipBase64, "base64"));
  if (hash(bytes) !== asset.sha256) throw new Error("Bundled C header extractor checksum mismatch");
  await fs.mkdir(cache, { recursive: true });
  const staging = await fs.mkdtemp(join(cache, ".install-"));
  try {
    await fs.writeFile(join(staging, asset.executable), bytes, { mode: 0o755 });
    for (const [path, contents] of Object.entries(resources)) {
      await fs.mkdir(dirname(join(staging, path)), { recursive: true });
      await fs.writeFile(join(staging, path), contents);
    }
    // Publish the complete directory atomically. Another process may have installed it first.
    if (await fs.stat(directory).catch(() => undefined)) {
      if (!(await valid())) await fs.rm(directory, { recursive: true, force: true });
    }
    try {
      await fs.rename(staging, directory);
    } catch (error) {
      if (!(await valid())) throw error;
    }
    return executable;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
