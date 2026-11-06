import { assertEquals } from "@std/assert";
import { runFile } from "../src/run.ts";

// `wm run` writes the emitted program to the OS temporary directory, never beside the source, and
// tells Deno where the project's deno.json is, since Deno would otherwise look beside the program.
Deno.test("run leaves nothing beside the source and keeps the project's import map", async () => {
  const project = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${project}/src`);
    await Deno.writeTextFile(
      `${project}/deno.json`,
      JSON.stringify({ imports: { greeting: "./greeting.js" } }),
    );
    await Deno.writeTextFile(`${project}/greeting.js`, 'export const message = "mapped";\n');
    await Deno.writeTextFile(
      `${project}/src/main.wm`,
      'from js.module("greeting") import unsafe { message: String };\n' +
        "let main = () => { print(message); };\n",
    );
    const result = await runFile(`${project}/src/main.wm`, { stdout: "piped", stderr: "piped" });
    assertEquals(new TextDecoder().decode(result.stderr), "");
    assertEquals(new TextDecoder().decode(result.stdout), "mapped\n");
    const left = [];
    for await (const entry of Deno.readDir(`${project}/src`)) left.push(entry.name);
    assertEquals(left, ["main.wm"]);
  } finally {
    await Deno.remove(project, { recursive: true });
  }
});
