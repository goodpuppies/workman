import { fileURLToPath, pathToFileURL } from "node:url";

export function pathToFileUri(path: string): string {
  return pathToFileURL(canonicalFilePath(path)).href;
}

export function fileUriToPath(uri: string): string {
  return fileURLToPath(uri);
}

function canonicalFilePath(path: string): string {
  try {
    return Deno.realPathSync(path);
  } catch {
    return path;
  }
}
