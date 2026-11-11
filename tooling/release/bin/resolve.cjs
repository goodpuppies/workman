const path = require("node:path");
const fs = require("node:fs");
const manifest = require("../package.json");

exports.resolveBinary = function () {
  const key = `${process.platform}-${process.arch}`;
  const names = {
    "linux-x64": "linux-x64",
    "linux-arm64": "linux-arm64",
    "darwin-x64": "darwin-x64",
    "darwin-arm64": "darwin-arm64",
    "win32-x64": "win32-x64",
    "win32-arm64": "win32-arm64",
  };
  const suffix = names[key];
  if (!suffix) throw new Error(`Workman has no prebuilt binary for ${key}`);
  const name = `${manifest.name}-${suffix}`;
  let metadata;
  try {
    metadata = require.resolve(`${name}/package.json`);
  } catch {
    throw new Error(
      `Missing ${name}@${manifest.version}. Install optional dependencies; Linux binaries require glibc.`,
    );
  }
  const platform = JSON.parse(fs.readFileSync(metadata, "utf8"));
  if (platform.version !== manifest.version) {
    throw new Error(
      `Workman binary version mismatch: expected ${manifest.version}, found ${platform.version}`,
    );
  }
  return path.join(path.dirname(metadata), "bin", process.platform === "win32" ? "wm.exe" : "wm");
};
