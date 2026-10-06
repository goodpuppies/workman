import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { Buffer } from "node:buffer";
import { resources } from "../src/generated/c_header_extractor/resources.js";

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const sourceSha256 = hash(
  await Deno.readFile(new URL("../tooling/c-header-extractor/main.zig", import.meta.url)),
);
for (
  const [platform, { asset }] of [
    ["linux-x64", await import("../src/generated/c_header_extractor/linux-x64.js")],
    ["linux-arm64", await import("../src/generated/c_header_extractor/linux-arm64.js")],
    ["darwin-x64", await import("../src/generated/c_header_extractor/darwin-x64.js")],
    ["darwin-arm64", await import("../src/generated/c_header_extractor/darwin-arm64.js")],
    ["win32-x64", await import("../src/generated/c_header_extractor/win32-x64.js")],
    ["win32-arm64", await import("../src/generated/c_header_extractor/win32-arm64.js")],
  ] as const
) {
  if (
    asset.protocol !== 1 || asset.platform !== platform || asset.zigBuildVersion !== "0.16.0" ||
    asset.sourceSha256 !== sourceSha256 ||
    asset.resourcesSha256 !== hash(JSON.stringify(resources)) ||
    hash(gunzipSync(Buffer.from(asset.gzipBase64, "base64"))) !== asset.sha256
  ) {
    throw new Error(`Stale or invalid ${platform} extractor; run deno task c-header:build`);
  }
}
for (const [name, contents] of Object.entries(resources)) {
  if (name.startsWith("licenses/") || name === "NOTICE") {
    if (
      await Deno.readTextFile(new URL(`../tooling/c-header-extractor/${name}`, import.meta.url)) !==
        contents
    ) {
      throw new Error(`Stale bundled ${name}; run deno task c-header:build`);
    }
  }
}
console.log("All six bundled C header extractors match source, resources and checksums");
