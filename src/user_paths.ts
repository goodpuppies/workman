import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** `name` when it holds an absolute path, else a directory under the home directory. */
function absoluteEnvironment(name: string, ...fallback: string[]): string {
  const value = Deno.env.get(name);
  // The home directory needs sys permission, so it is looked up only when it is used.
  return value && isAbsolute(value) ? value : join(homedir(), ...fallback);
}

export function workmanConfigFile(): string {
  const base = Deno.build.os === "windows"
    ? absoluteEnvironment("APPDATA", "AppData", "Roaming")
    : absoluteEnvironment("XDG_CONFIG_HOME", ".config");
  return join(base, "workman", "config.json");
}

export function workmanCache(): string {
  const base = Deno.build.os === "windows"
    ? absoluteEnvironment("LOCALAPPDATA", "AppData", "Local")
    : absoluteEnvironment("XDG_CACHE_HOME", ".cache");
  return join(base, "workman");
}

export function workmanState(): string {
  const base = Deno.build.os === "windows"
    ? absoluteEnvironment("LOCALAPPDATA", "AppData", "Local")
    : absoluteEnvironment("XDG_STATE_HOME", ".local", "state");
  return join(base, "workman");
}

export function pakmanStateDirectory(): string {
  return Deno.env.get("PAKMAN_STATE") || join(workmanState(), "pakman");
}
