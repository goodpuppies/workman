import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";
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

async function projectWithPackage(): Promise<string> {
  const project = await Deno.makeTempDir();
  await Deno.mkdir(`${project}/node_modules/fakepkg`, { recursive: true });
  await Deno.mkdir(`${project}/src`);
  await Deno.writeTextFile(
    `${project}/package.json`,
    JSON.stringify({ dependencies: { fakepkg: "1.0.0" } }),
  );
  await Deno.writeTextFile(
    `${project}/node_modules/fakepkg/package.json`,
    JSON.stringify({ name: "fakepkg", version: "1.0.0", type: "module", exports: "./index.js" }),
  );
  await Deno.writeTextFile(
    `${project}/node_modules/fakepkg/index.js`,
    'export const answer = "packaged";\n',
  );
  return project;
}

// Deno finds `package.json` and `node_modules` from the program's own folder.
Deno.test("run imports npm packages of the project above the source", async () => {
  const project = await projectWithPackage();
  try {
    await Deno.writeTextFile(
      `${project}/src/main.wm`,
      'from js.module("fakepkg") import unsafe { answer: String };\n' +
        "let main = () => { print(answer); };\n",
    );
    const result = await runFile(`${project}/src/main.wm`, { stdout: "piped", stderr: "piped" });
    assertEquals(new TextDecoder().decode(result.stderr), "");
    assertEquals(new TextDecoder().decode(result.stdout), "packaged\n");
    // Removing the output folder must remove the link, not what it points at.
    await Deno.stat(`${project}/node_modules/fakepkg/index.js`);
  } finally {
    await Deno.remove(project, { recursive: true });
  }
});

Deno.test("repl imports npm packages of the project it started in", async () => {
  const project = await projectWithPackage();
  try {
    const child = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", fileURLToPath(new URL("../src/main.ts", import.meta.url)), "repl"],
      cwd: project,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(
      new TextEncoder().encode(
        'from js.module("fakepkg") import unsafe { answer: String };\nprint(answer);\n',
      ),
    );
    await writer.close();
    const result = await child.output();
    assertEquals(new TextDecoder().decode(result.stdout).includes("packaged\n"), true);
    await Deno.stat(`${project}/node_modules/fakepkg/index.js`);
  } finally {
    await Deno.remove(project, { recursive: true });
  }
});
