import { fileURLToPath, pathToFileURL } from "node:url";
import { normalize, posix, resolve } from "node:path";
import { runtime } from "../io.ts";

export function pathToFileUri(path: string): string {
  if (isPosixVirtualPath(path)) {
    const url = new URL("file:///");
    url.pathname = path;
    return url.href;
  }
  return pathToFileURL(canonicalFilePath(path)).href;
}

export function fileUriToPath(uri: string): string {
  const url = new URL(uri);
  if (runtime.platform === "win32" && !/^\/[A-Za-z]:\//.test(url.pathname)) {
    return decodeURIComponent(url.pathname);
  }
  return fileURLToPath(uri);
}

function isPosixVirtualPath(path: string): boolean {
  return runtime.platform === "win32" && path.startsWith("/") && !/^\/[A-Za-z]:\//.test(path);
}

export function canonicalFilePath(path: string): string {
  if (isPosixVirtualPath(path)) return posix.normalize(path);
  try {
    return runtime.realPathSync(path);
  } catch {
    return normalize(resolve(path));
  }
}
