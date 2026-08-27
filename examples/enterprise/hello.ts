// deno run --allow-ffi examples/enterprise/hello.ts
import { File, close } from "./writev.ts";

const buf = new Uint8Array(4096); // var buf: [4096]u8 = undefined;
const stdout_writer = File.stdout().writer(buf);
const stdout = stdout_writer.interface;

stdout.print("hello\n");
stdout.flush();

close();
