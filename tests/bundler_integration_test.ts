import { assertEquals } from "@std/assert";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const bun = Deno.env.get("WM_BUN");
const vite = Deno.env.get("WM_VITE_ENTRY");
const root = dirname(dirname(fileURLToPath(import.meta.url)));

for (const mode of ["bun", "vite"]) {
  Deno.test({
    name: `${mode} compiles WM modules with positional exports${
      mode === "vite" ? " and refreshes dependencies" : " in runtime and bundles"
    }`,
    ignore: !bun || (mode === "vite" && !vite),
    async fn() {
      const directory = await Deno.makeTempDir({ prefix: "wm-bundler-" });
      const moduleUrl = (path: string) => JSON.stringify(pathToFileURL(path).href);
      try {
        await Deno.writeTextFile(join(directory, "base.wm"), "let offset = 2;");
        await Deno.writeTextFile(
          join(directory, "entry.wm"),
          'from "./base.wm" import { offset }; let add = (a: Number, b: Number) => a + b + offset;',
        );
        await Deno.writeTextFile(
          join(directory, "consumer.js"),
          'import { add } from "./entry.wm"; export const answer = add(20, 20);',
        );
        const source = mode === "bun"
          ? `
          import { plugin, build } from "bun";
          import { workman } from ${moduleUrl(join(root, "src/integrations/bun.mjs"))};
          import { strict as assert } from "node:assert";
          plugin(workman());
          assert.equal((await import("./consumer.js")).answer, 42);
          const result = await build({ entrypoints: ["./consumer.js"], target: "bun", plugins: [workman()] });
          assert.equal(result.success, true, JSON.stringify(result.logs));
          await Bun.write("./bundle.mjs", await result.outputs[0].text());
          assert.equal((await import("./bundle.mjs")).answer, 42);
        `
          : `
          import { createServer } from ${moduleUrl(vite!)};
          import { workman } from ${moduleUrl(join(root, "src/integrations/vite.mjs"))};
          import { strict as assert } from "node:assert";
          const server = await createServer({ configFile: false, root: ${JSON.stringify(directory)},
            logLevel: "silent", plugins: [workman()], server: { host: "127.0.0.1", port: 0 } });
          try {
            await server.listen();
            assert.equal((await server.ssrLoadModule("/consumer.js")).answer, 42);
            await Bun.write("./base.wm", "let offset = 3;");
            const deadline = Date.now() + 15000;
            let answer;
            do {
              await Bun.sleep(100);
              answer = (await server.ssrLoadModule("/consumer.js")).answer;
            } while (answer !== 43 && Date.now() < deadline);
            assert.equal(answer, 43, "a transitive WM edit must invalidate the bundled entry");
          } finally { await server.close(); }
        `;
        await Deno.writeTextFile(join(directory, "check.mjs"), source);
        const result = await new Deno.Command(bun!, {
          args: ["check.mjs"],
          cwd: directory,
          stdout: "piped",
          stderr: "piped",
          signal: AbortSignal.timeout(45_000),
        }).output();
        assertEquals(
          result.code,
          0,
          new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
        );
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    },
  });
}
