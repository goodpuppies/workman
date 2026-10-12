// Deno/Node adapter. Latin-1 strings carry raw bytes across the FFI boundary.
import { readFileSync, writeFileSync, writeSync, realpathSync } from "node:fs";
import { Buffer } from "node:buffer";
const bytes = (text) => Buffer.from(text, "latin1");
const carrier = (data) => Buffer.from(data).toString("latin1");
const protect = (call) => {
  try { return call(); }
  catch (error) { throw carrier(Buffer.from(String(error?.message ?? error), "utf8")); }
};
export const readFile = (path) => protect(() => carrier(readFileSync(bytes(path))));
export const canonicalPath = (path) => protect(() => carrier(realpathSync(bytes(path), { encoding: "buffer" })));
export const writeFile = (data, path) => protect(() => { writeFileSync(bytes(path), bytes(data)); });
const writeAll = (fd, data) => protect(() => {
  const buffer = bytes(data);
  let offset = 0;
  while (offset < buffer.length) {
    const count = writeSync(fd, buffer, offset, buffer.length - offset);
    if (count === 0) throw new Error("zero-length host write");
    offset += count;
  }
});
export const writeStdout = (data) => writeAll(1, data);
export const writeStderr = (data) => writeAll(2, data);
const processArguments = () => protect(() => Deno.args.map((value) => carrier(Buffer.from(value, "utf8"))));
export { processArguments as arguments };
export const exit = (success) => Deno.exit(success ? 0 : 1);
