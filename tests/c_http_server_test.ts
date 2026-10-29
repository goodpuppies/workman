import { assertEquals, assertStringIncludes } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { fileURLToPath } from "node:url";

function deadline<T>(promise: Promise<T>, milliseconds = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("HTTP server test timed out")), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

Deno.test({
  name:
    "C FFI Windows HTTP server handles fragmented headers and sends a byte-counted UTF-8 response",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const dir = await Deno.makeTempDir();
    let child: Deno.ChildProcess | undefined;
    let connection: Deno.TcpConn | undefined;
    let finished = false;
    try {
      const source = fileURLToPath(
        new URL("../examples/c_ffi/http_server_windows.wm", import.meta.url),
      );
      await Deno.writeTextFile(`${dir}/server.mjs`, await compileLibraryFile(source));
      await Deno.writeTextFile(
        `${dir}/run.mjs`,
        `// Force short writes while still calling the real Winsock send function.
        const open = Deno.dlopen;
        const allocations = new Set();
        Deno.dlopen = (path, definitions) => {
          const library = open(path, definitions);
          const symbols = { ...library.symbols };
          if (definitions.send) symbols.send = (socket, bytes, length, flags) =>
            library.symbols.send(socket, bytes, Math.min(length, 3), flags);
          for (const name of ["malloc", "calloc"]) {
            if (definitions[name]) symbols[name] = (...args) => {
              const pointer = library.symbols[name](...args);
              if (pointer) allocations.add(Deno.UnsafePointer.value(pointer));
              return pointer;
            };
          }
          if (definitions.free) symbols.free = pointer => {
            if (pointer && !allocations.delete(Deno.UnsafePointer.value(pointer)))
              throw new Error("free of an untracked allocation");
            library.symbols.free(pointer);
          };
          return { symbols, close: () => library.close() };
        };
        const { serveOnce } = await import("./server.mjs");
        serveOnce(0);
        if (allocations.size) throw new Error("server leaked C allocations");\n`,
      );
      child = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--no-config", `${dir}/run.mjs`],
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const status = child.status.then((status) => {
        finished = true;
        return status;
      });
      const stderr = new Response(child.stderr).text();
      const reader = child.stdout.getReader();
      let startup = "";
      try {
        while (!startup.includes("\n")) {
          const next = await deadline(reader.read());
          if (next.done) throw new Error(`server exited during startup: ${await stderr}`);
          startup += new TextDecoder().decode(next.value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      const port = Number(/LISTENING (\d+)/.exec(startup)?.[1]);
      assertEquals(Number.isInteger(port) && port > 0, true, startup);
      connection = await Deno.connect({ hostname: "127.0.0.1", port });
      const encoder = new TextEncoder();
      await connection.write(
        encoder.encode("GET / HTTP/1.1\r\nHost: localhost\r\nX-Test: fragmented\r\n\r"),
      );
      // Split the terminator across recv calls, exercising the three-byte overlap scan.
      await new Promise((resolve) => setTimeout(resolve, 30));
      await connection.write(encoder.encode("\n"));
      const chunks: Uint8Array[] = [];
      const buffer = new Uint8Array(256);
      while (true) {
        const count = await deadline(connection.read(buffer));
        if (count === null) break;
        chunks.push(buffer.slice(0, count));
      }
      const response = new TextDecoder().decode(
        new Uint8Array(chunks.flatMap((chunk) => [...chunk])),
      );
      const [headers, body] = response.split("\r\n\r\n");
      assertStringIncludes(headers, "HTTP/1.1 200 OK");
      assertStringIncludes(headers, "Connection: close");
      assertEquals(body, "hello from wm C FFI — moi!\n");
      assertEquals(
        Number(/Content-Length: (\d+)/i.exec(headers)?.[1]),
        encoder.encode(body).length,
      );
      assertEquals((await deadline(status)).code, 0, await stderr);
    } finally {
      connection?.close();
      if (child && !finished) {
        try {
          child.kill();
        } catch { /* Already exited. */ }
        await child.status;
      }
      await Deno.remove(dir, { recursive: true });
    }
  },
});
