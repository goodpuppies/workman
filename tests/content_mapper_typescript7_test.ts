import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeMessages, encodeMessage, type RpcMessage } from "../src/lsp/rpc.ts";

// Keep experimental tooling out of the compiler's dependency graph. Opt in with an absolute
// path to a TypeScript 7.1 tsc executable (see docs/content-mapper.md).
const tsc = Deno.env.get("WM_CONTENT_MAPPER_TSC");
const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function fixture(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "wm-content-mapper-" });
  const packages = join(dir, "node_modules", "@goodpuppies");
  await Deno.mkdir(packages, { recursive: true });
  await Deno.symlink(
    root,
    join(packages, "workman"),
    {
      type: "dir",
    },
  );
  await Deno.writeTextFile(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: "esnext",
        moduleResolution: "bundler",
        target: "es2022",
        types: [],
      },
      contentMappers: [{
        package: "@goodpuppies/workman",
        extensions: [".wm"],
        options: { entryPoints: ["entry.wm"] },
      }],
      files: ["consumer.ts"],
    }),
  );
  await Deno.writeTextFile(
    join(dir, "math.wm"),
    "let double = (value: Number) => value + value;\nlet identity = (item) => item;\n" +
      "let sum = (left: Number, right: Number) => left + right;\n" +
      "let curried = (first: Number) => (second: Number) => first + second;\nlet shared = 1;\n" +
      "let invoke = (function, a: Number, b: Number) => function(a, b);\n",
  );
  await Deno.writeTextFile(
    join(dir, "mid.wm"),
    'export from "./math.wm" import { shared as renamed };',
  );
  await Deno.writeTextFile(
    join(dir, "entry.wm"),
    'from "./mid.wm" import * as Mid; let result = Mid.renamed;',
  );
  await Deno.writeTextFile(
    join(dir, "consumer.ts"),
    `import { double, identity, sum, curried, invoke } from "./math.wm";
const value: number = double(21);
const text: string = identity("hello");
const total: number = sum(1, 2);
const nested: number = curried(1)(2);
import { result } from "./entry.wm";
const snapshot: number = result;
const callback: number = invoke((a, b) => a + b, 20, 22);
`,
  );
  return dir;
}

Deno.test({
  name: "TypeScript 7.1 imports WM, checks calls, and emits declarations without JS",
  ignore: !tsc,
  async fn() {
    const dir = await fixture();
    const compile = (...args: string[]) =>
      new Deno.Command(resolve(tsc!), {
        args: ["-p", dir, "--runExternalCode", ...args],
        cwd: dir,
        stdout: "piped",
        stderr: "piped",
      }).output();
    try {
      const good = await compile();
      assertEquals(
        good.code,
        0,
        new TextDecoder().decode(good.stdout) + new TextDecoder().decode(good.stderr),
      );
      const emitted = await compile(
        "--noEmit",
        "false",
        "--declaration",
        "--emitDeclarationOnly",
        "--outDir",
        "out",
      );
      assertEquals(emitted.code, 0, new TextDecoder().decode(emitted.stdout));
      const declaration = await Deno.readTextFile(join(dir, "out/math.d.wm.ts"));
      assertStringIncludes(declaration, "number");
      assertStringIncludes(declaration, "identity");
      assertStringIncludes(declaration, "value: number");
      assertStringIncludes(declaration, "left: number, right: number");
      assert(!declaration.includes("__wm_value"));
      const names = [];
      for await (const entry of Deno.readDir(join(dir, "out"))) names.push(entry.name);
      assert(names.every((name) => !name.endsWith(".js")));
      await Deno.writeTextFile(
        join(dir, "consumer.ts"),
        'import { double } from "./math.wm"; double("wrong");',
      );
      const bad = await compile();
      assertEquals(bad.code, 2);
      assertStringIncludes(new TextDecoder().decode(bad.stdout), "TS2345");
      await Deno.writeTextFile(
        join(dir, "math.wm"),
        "let double = (x: Number) => x + x; let broken = 1 + true;",
      );
      const broken = await compile();
      assertStringIncludes(new TextDecoder().decode(broken.stdout), "type.mismatch");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

for (const bridge of [false, true]) {
  Deno.test({
    name: `TypeScript 7.1 ${
      bridge ? "Fresh adapter" : "native LSP"
    } navigates into WM and tracks unsaved changes`,
    ignore: !tsc,
    async fn() {
      const dir = await fixture();
      const child = new Deno.Command(bridge ? Deno.execPath() : resolve(tsc!), {
        args: bridge
          ? [
            "run",
            "-A",
            "--config",
            join(root, "deno.json"),
            join(root, "src/content_mapper/typescript_lsp.ts"),
            "--tsc",
            resolve(tsc!),
          ]
          : ["--lsp", "--stdio"],
        cwd: dir,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(30_000),
      }).spawn();
      const stderr = new Response(child.stderr).text();
      const writer = child.stdin.getWriter();
      const reader = child.stdout.getReader();
      let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
      const messages: RpcMessage[] = [];
      let id = 0;
      const send = (message: RpcMessage) => writer.write(encodeMessage(message));
      const request = async (method: string, params: unknown): Promise<unknown> => {
        const requestId = ++id;
        await send({ jsonrpc: "2.0", id: requestId, method, params });
        while (true) {
          const message = messages.shift();
          if (message) {
            if (message.id === requestId && !message.method) {
              assert(!message.error, JSON.stringify(message.error));
              return message.result;
            }
            if (message.method && message.id !== undefined) {
              await send({ jsonrpc: "2.0", id: message.id, result: null });
            }
            continue;
          }
          const chunk = await reader.read();
          assert(!chunk.done, "TypeScript language server exited early");
          const next = new Uint8Array(buffer.length + chunk.value.length);
          next.set(buffer);
          next.set(chunk.value, buffer.length);
          const decoded = decodeMessages(next);
          assertEquals(decoded.errors, []);
          buffer = decoded.rest;
          messages.push(...decoded.messages);
        }
      };
      try {
        const rootUri = pathToFileURL(dir).href;
        await request("initialize", {
          processId: Deno.pid,
          rootUri,
          workspaceFolders: [{ uri: rootUri, name: "fixture" }],
          initializationOptions: { runExternalCode: true },
          capabilities: {
            textDocument: {
              hover: { contentFormat: ["markdown"] },
              diagnostic: {},
              signatureHelp: {
                signatureInformation: { parameterInformation: { labelOffsetSupport: true } },
              },
            },
          },
        });
        await send({ jsonrpc: "2.0", method: "initialized", params: {} });
        const consumerUri = pathToFileURL(join(dir, "consumer.ts")).href;
        const wmUri = pathToFileURL(join(dir, "math.wm")).href;
        await send({
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: {
            textDocument: {
              uri: consumerUri,
              languageId: "typescript",
              version: 1,
              text: await Deno.readTextFile(join(dir, "consumer.ts")),
            },
          },
        });
        const position = { line: 1, character: 23 }; // double(21)
        const definition = await request("textDocument/definition", {
          textDocument: { uri: consumerUri },
          position,
        }) as { uri: string; range: { start: { line: number; character: number } } }[];
        assert(
          definition.some((location) =>
            location.uri === wmUri &&
            location.range.start.line === 0 && location.range.start.character === 4
          ),
          JSON.stringify(definition),
        );
        const hover = await request("textDocument/hover", {
          textDocument: { uri: consumerUri },
          position,
        });
        assertStringIncludes(JSON.stringify(hover), "number");
        assertStringIncludes(JSON.stringify(hover), "const double: (value: number) => number");
        assert(!/__wm_value|arg\d/.test(JSON.stringify(hover)));
        const signature = await request("textDocument/signatureHelp", {
          textDocument: { uri: consumerUri },
          position: { line: 1, character: 29 },
          context: { triggerKind: 1, isRetrigger: false },
        }) as { signatures: { label: string }[] };
        assertStringIncludes(signature.signatures[0].label, "value: number");
        assert(!/__wm_value|arg\d/.test(signature.signatures[0].label));
        for (
          const [line, expected] of [[3, "left: number, right: number"], [
            4,
            "second: number",
          ]] as const
        ) {
          const display = await request("textDocument/hover", {
            textDocument: { uri: consumerUri },
            position: { line, character: line === 3 ? 23 : 25 },
          });
          assertStringIncludes(JSON.stringify(display), expected);
          assert(!/__wm_value|arg\d/.test(JSON.stringify(display)));
        }
        const changed =
          'let double = (x: String) => x;\nlet identity = (x) => x;\nlet shared = "updated";\n';
        if (bridge) {
          await request("workman/syncDocuments", { documents: [{ uri: wmUri, text: changed }] });
        } else {await send({
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
              textDocument: {
                uri: wmUri,
                languageId: "wm",
                version: 1,
                text: changed,
              },
            },
          });}
        const updated = await request("textDocument/hover", {
          textDocument: { uri: consumerUri },
          position,
        });
        assertStringIncludes(JSON.stringify(updated), "string");
        if (bridge) {
          const transitive = await request("textDocument/hover", {
            textDocument: { uri: consumerUri },
            position: { line: 6, character: 25 },
          });
          assertStringIncludes(JSON.stringify(transitive), "const result: string");
        }
        const diagnostics = await request("textDocument/diagnostic", {
          textDocument: { uri: consumerUri },
        }) as { items: { code: number }[] };
        assert(
          diagnostics.items.some((diagnostic) => diagnostic.code === 2345),
          JSON.stringify(diagnostics),
        );
        const changedAgain =
          "let double = (flag: Bool) => flag;\nlet identity = (x) => x;\nlet shared = true;\n";
        if (bridge) {
          await request("workman/syncDocuments", {
            documents: [{ uri: wmUri, text: changedAgain }],
          });
        } else {await send({
            jsonrpc: "2.0",
            method: "textDocument/didChange",
            params: {
              textDocument: { uri: wmUri, version: 2 },
              contentChanges: [{ text: changedAgain }],
            },
          });}
        const live = await request("textDocument/hover", {
          textDocument: { uri: consumerUri },
          position,
        });
        assertStringIncludes(JSON.stringify(live), "flag: boolean");
        if (bridge) {
          const transitive = await request("textDocument/hover", {
            textDocument: { uri: consumerUri },
            position: { line: 6, character: 25 },
          });
          assertStringIncludes(JSON.stringify(transitive), "const result: boolean");
        }
        // Closing the unsaved WM buffer must remove its overlay, not retain the last type.
        if (bridge) await request("workman/syncDocuments", { documents: [] });
        else {await send({
            jsonrpc: "2.0",
            method: "textDocument/didClose",
            params: { textDocument: { uri: wmUri } },
          });}
        const closed = await request("textDocument/hover", {
          textDocument: { uri: consumerUri },
          position,
        });
        assertStringIncludes(JSON.stringify(closed), "value: number");
        if (bridge) {
          const transitive = await request("textDocument/hover", {
            textDocument: { uri: consumerUri },
            position: { line: 6, character: 25 },
          });
          assertStringIncludes(JSON.stringify(transitive), "const result: number");
        }
        // A closed dependency is watched through entryPoints, even though the projection
        // contains an inferred type rather than a TS import of that WM dependency.
        await Deno.writeTextFile(
          join(dir, "math.wm"),
          'let double = (value: Number) => value + value; let shared = "saved";',
        );
        await send({
          jsonrpc: "2.0",
          method: "workspace/didChangeWatchedFiles",
          params: { changes: [{ uri: wmUri, type: 2 }] },
        });
        const saved = await request("textDocument/hover", {
          textDocument: { uri: consumerUri },
          position: { line: 6, character: 25 },
        });
        assertStringIncludes(JSON.stringify(saved), "const result: string");
        await request("shutdown", undefined);
        await send({ jsonrpc: "2.0", method: "exit" });
        await child.status;
      } finally {
        await writer.close().catch(() => {});
        await reader.cancel();
        try {
          child.kill("SIGKILL");
        } catch { /* Already exited. */ }
        await child.status;
        // The native beta may print "context canceled" when shutting down its LSP.
        // Protocol assertions above determine success; stderr is drained to avoid pipe leaks.
        await stderr;
        await Deno.remove(dir, { recursive: true });
      }
    },
  });
}
