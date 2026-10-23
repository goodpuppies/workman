import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

function absoluteEnvironment(name: string, fallback: string): string {
  const value = Deno.env.get(name);
  return value && isAbsolute(value) ? value : fallback;
}

export function workmanConfigFile(): string {
  const base = Deno.build.os === "windows"
    ? absoluteEnvironment("APPDATA", join(homedir(), "AppData", "Roaming"))
    : absoluteEnvironment("XDG_CONFIG_HOME", join(homedir(), ".config"));
  return join(base, "workman", "config.json");
}

export function workmanCache(): string {
  const base = Deno.build.os === "windows"
    ? absoluteEnvironment("LOCALAPPDATA", join(homedir(), "AppData", "Local"))
    : absoluteEnvironment("XDG_CACHE_HOME", join(homedir(), ".cache"));
  return join(base, "workman");
}

export function workmanState(): string {
  const base = Deno.build.os === "windows"
    ? absoluteEnvironment("LOCALAPPDATA", join(homedir(), "AppData", "Local"))
    : absoluteEnvironment("XDG_STATE_HOME", join(homedir(), ".local", "state"));
  return join(base, "workman");
}

export function pakmanStateDirectory(): string {
  return Deno.env.get("PAKMAN_STATE") || join(workmanState(), "pakman");
}
