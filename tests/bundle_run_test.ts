import { assertEquals } from "@std/assert";
import { join } from "node:path";
import { runFile } from "../src/run.ts";

Deno.test("embedded esbuild bundles ESM and CJS node_modules imports for wm run", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wm-bundle-test-" });
  try {
    await Deno.writeTextFile(
      join(dir, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    const esmDir = join(dir, "node_modules", "esm-greet");
    await Deno.mkdir(esmDir, { recursive: true });
    await Deno.writeTextFile(
      join(esmDir, "package.json"),
      JSON.stringify({
        name: "esm-greet",
        version: "1.0.0",
        type: "module",
        exports: { ".": { types: "./index.d.ts", import: "./index.mjs" } },
      }),
    );
    await Deno.writeTextFile(
      join(esmDir, "index.d.ts"),
      "export declare function greet(name: string): string;\n",
    );
    await Deno.writeTextFile(
      join(esmDir, "index.mjs"),
      'export function greet(name) { return `hi ${name}`; }\n',
    );

    const cjsDir = join(dir, "node_modules", "cjs-math");
    await Deno.mkdir(cjsDir, { recursive: true });
    await Deno.writeTextFile(
      join(cjsDir, "package.json"),
      JSON.stringify({
        name: "cjs-math",
        version: "1.0.0",
        main: "./index.cjs",
        types: "./index.d.ts",
      }),
    );
    await Deno.writeTextFile(
      join(cjsDir, "index.d.ts"),
      "export declare function triple(n: number): number;\n",
    );
    await Deno.writeTextFile(
      join(cjsDir, "index.cjs"),
      "const path = require('node:path');\nexports.triple = (n) => n * 3 + (path.basename('a') === 'a' ? 0 : 1);\n",
    );

    const entry = join(dir, "main.wm");
    await Deno.writeTextFile(
      entry,
      'from js.module("esm-greet") import { greet };\n' +
        'from js.module("cjs-math") import { triple };\n' +
        'from js.module("node:path") import { basename };\n' +
        "let main = () => {\n" +
        '  print(greet("world") :> Result.debug);\n' +
        "  print(triple(14) :> Result.debug);\n" +
        '  print(basename("/x/y.txt") :> Result.debug)\n' +
        "};\n",
    );

    const result = await runFile(entry, {
      bundle: true,
      stdout: "piped",
      stderr: "piped",
      progress: false,
    });
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    assertEquals(new TextDecoder().decode(result.stdout), "hi world\n42\ny.txt\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
