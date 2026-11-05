// Synced from subm/SubsetML by scripts/sync_subml_basis.ts. Do not edit here.
// Deno/Node adapter. Latin-1 strings carry raw bytes across the FFI boundary.
// Nothing throws: a fallible call returns [true, value] or [false, message].
import { readFileSync, writeFileSync, writeSync, realpathSync } from "node:fs";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { constants } from "node:os";
const bytes = (text) => Buffer.from(text, "latin1");
const carrier = (data) => Buffer.from(data).toString("latin1");
const attempt = (call) => {
  try { return [true, call()]; }
  catch (error) { return [false, carrier(Buffer.from(String(error?.message ?? error), "utf8"))]; }
};
export const readFile = (path) => attempt(() => carrier(readFileSync(bytes(path))));
export const canonicalPath = (path) => attempt(() => carrier(realpathSync(bytes(path), { encoding: "buffer" })));
export const writeFile = (data, path) => attempt(() => { writeFileSync(bytes(path), bytes(data)); return ""; });
const writeAll = (fd, data) => attempt(() => {
  const buffer = bytes(data);
  let offset = 0;
  while (offset < buffer.length) {
    const count = writeSync(fd, buffer, offset, buffer.length - offset);
    if (count === 0) throw new Error("zero-length host write");
    offset += count;
  }
  return "";
});
export const writeStdout = (data) => writeAll(1, data);
export const writeStderr = (data) => writeAll(2, data);
export const argumentCount = () => Deno.args.length;
export const argument = (index) => carrier(Buffer.from(Deno.args[index], "utf8"));
// Host text APIs take Unicode, so byte strings cross this boundary as UTF-8.
const hostText = (data) => bytes(data).toString("utf8");
const carrierText = (text) => carrier(Buffer.from(text, "utf8"));
// A child killed by a signal reports the shell's convention of 128 + signal.
export const system = (command) => {
  try {
    const child = spawnSync(hostText(command), { shell: true, stdio: "inherit" });
    if (child.error) throw child.error;
    return [true, child.status ?? 128 + (constants.signals[child.signal] ?? 0), ""];
  } catch (error) {
    return [false, 0, carrierText(String(error?.message ?? error))];
  }
};
// [true, value], or [false, ""] when unset or when the host rejects the name.
export const getEnv = (name) => {
  try {
    const value = Deno.env.get(hostText(name));
    return value === undefined ? [false, ""] : [true, carrierText(value)];
  } catch {
    return [false, ""];
  }
};
export const exit = (code) => Deno.exit(code);
export const terminate = (code) => Deno.exit(code);
