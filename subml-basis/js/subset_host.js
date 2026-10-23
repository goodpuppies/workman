// Deno/Node adapter. Latin-1 strings carry raw bytes across the FFI boundary.
// Nothing throws: a fallible call returns [true, value] or [false, message].
import { readFileSync, writeFileSync, writeSync, realpathSync } from "node:fs";
import { Buffer } from "node:buffer";
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
export const exit = (success) => Deno.exit(success ? 0 : 1);
