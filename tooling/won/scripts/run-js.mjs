// Byte strings cross the FFI boundary as Latin-1 carriers, matching native SML.
import { readFileSync, writeSync } from "node:fs";
import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";
const [library, mode = "normalize"] = Deno.args;
const { run } = await import(pathToFileURL(library).href);
const [success, output] = run([mode, readFileSync(0).toString("latin1")]);
const data = Buffer.from(output + "\n", "latin1");
let offset = 0;
while (offset < data.length) {
  const count = writeSync(success ? 1 : 2, data, offset, data.length - offset);
  if (count === 0) throw new Error("zero-length host write");
  offset += count;
}
Deno.exit(success ? 0 : 1);
