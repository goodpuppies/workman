import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  decodeProjectCommands,
  findProject,
  isRunFile,
  readProjectCommands,
} from "../src/project_commands.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const config = fileURLToPath(new URL("../deno.json", import.meta.url));
const decoder = new TextDecoder();
function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  return new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "--config", config, cli, "run", ...args],
    cwd,
    env,
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(30000),
  }).output();
}

Deno.test("project discovery finds the nearest pak.wm and file operands remain explicit", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(root, "nested", "src"), { recursive: true });
    await Deno.writeTextFile(join(root, "pak.wm"), "");
    await Deno.writeTextFile(join(root, "nested", "pak.wm"), "");
    assertEquals(await findProject(join(root, "nested", "src")), join(root, "nested", "pak.wm"));
    for (
      const input of ["main.wm", "./dev", "../dev", "folder/dev", "folder\\dev", join(root, "dev")]
    ) assertEquals(isRunFile(input), true, input);
    assertEquals(isRunFile("dev"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("project commands use their root, environment, current WM, and literal forwarded arguments", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(root, "src"));
    await Deno.writeTextFile(
      join(root, "deno.json"),
      JSON.stringify({ imports: { host: "./host.ts" } }),
    );
    await Deno.writeTextFile(
      join(root, "host.ts"),
      'export function value() { return Deno.env.get("PROJECT_LABEL") + ":" + Deno.readTextFileSync("marker"); }',
    );
    await Deno.writeTextFile(join(root, "marker"), "root");
    await Deno.writeTextFile(
      join(root, "app.wm"),
      `
      from "std/list.wm" import * as List;
      from js.module("host") import unsafe { value: Void -> String };
      from js.global("Deno") import unsafe { args: Js.Array<String> };
      let rec printArgs=match { []=>void, [first,..rest]=>{print(first);printArgs(rest)} };
      let main=()=>{ print(value()); printArgs(Js.Array.toList(args)) };
    `,
    );
    await Deno.writeTextFile(
      join(root, "pak.wm"),
      `
      from "pakman/project.wm" import {command,withEnv,Variable,Wm};
      let commands=[withEnv([Variable("PROJECT_LABEL","configured")],command("dev",[Wm(["run","app.wm","--"])]))];
    `,
    );
    const result = await run(join(root, "src"), [
      "dev",
      "--",
      "two words",
      "$(touch SHOULD_NOT_EXIST)",
      "--flag",
    ], { PROJECT_LABEL: "inherited" });
    assertEquals(result.code, 0, decoder.decode(result.stderr));
    assertEquals(
      decoder.decode(result.stdout),
      "configured:root\ntwo words\n$(touch SHOULD_NOT_EXIST)\n--flag\n",
    );
    await assertRejects(() => Deno.stat(join(root, "SHOULD_NOT_EXIST")), Deno.errors.NotFound);
    const implicit = await run(root, ["dev", "plain"]);
    assertEquals(implicit.code, 0, decoder.decode(implicit.stderr));
    assertStringIncludes(decoder.decode(implicit.stdout), "plain\n");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("project steps run sequentially, stop on failure, and forward arguments only to the last step", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, "step.ts"),
      `
      const label=Deno.args[0];
      console.log(JSON.stringify(Deno.args));
      if(label==="fail") Deno.exit(7);
    `,
    );
    await Deno.writeTextFile(
      join(root, "pak.wm"),
      `
      from "pakman/project.wm" import {command,Exec};
      let commands=[
        command("ok",[Exec(${
        JSON.stringify(Deno.execPath())
      },["run","-A","step.ts","first"]),Exec(${
        JSON.stringify(Deno.execPath())
      },["run","-A","step.ts","last"])]),
        command("bad",[Exec(${
        JSON.stringify(Deno.execPath())
      },["run","-A","step.ts","fail"]),Exec("missing-program",[])])
      ];
    `,
    );
    const ok = await run(root, ["ok", "--", "extra"]);
    assertEquals(ok.code, 0, decoder.decode(ok.stderr));
    assertEquals(decoder.decode(ok.stdout), '["first"]\n["last","extra"]\n');
    const bad = await run(root, ["bad"]);
    assertEquals(bad.code, 7, decoder.decode(bad.stderr));
    assertEquals(decoder.decode(bad.stdout), '["fail"]\n');
    const unknown = await run(root, ["absent"]);
    assertEquals(unknown.code, 1);
    assertStringIncludes(decoder.decode(unknown.stderr), "available: ok, bad");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("project descriptions reject duplicate commands and evaluate without filesystem permission", async () => {
  const root = await Deno.makeTempDir();
  try {
    const path = join(root, "pak.wm");
    await Deno.writeTextFile(
      path,
      `
      from "pakman/project.wm" import {command,Wm};
      let commands=[command("dev",[Wm(["help"])]),command("dev",[Wm(["version"])])];
    `,
    );
    await assertRejects(() => readProjectCommands(path), Error, "duplicate project command dev");
    await Deno.writeTextFile(
      path,
      `
      from "pakman/project.wm" import {command,Wm};
      from js.global("Deno") import unsafe {writeTextFileSync};
      let effect=writeTextFileSync("unexpected","written");
      let commands=[command("dev",[Wm(["version"])])];
    `,
    );
    await assertRejects(() => readProjectCommands(path), Error, "Requires write access");
    await assertRejects(() => Deno.stat(join(root, "unexpected")), Deno.errors.NotFound);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("project command protocol validates commands, arguments and environment", () => {
  for (
    const command of [
      { name: "dev", steps: [], env: [] },
      {
        name: "dev",
        steps: [{ kind: "wm", program: "", arguments: [] }],
        env: [],
        watchPaths: [2],
      },
      {
        name: "dev",
        steps: [{ kind: "wm", program: "", arguments: [] }],
        env: [],
        watchPaths: [""],
      },
      { name: "../dev", steps: [{ kind: "wm", program: "", arguments: [] }], env: [] },
      { name: "dev", steps: [{ kind: "exec", program: "", arguments: [] }], env: [] },
      { name: "dev", steps: [{ kind: "wm", program: "", arguments: [2] }], env: [] },
      {
        name: "dev",
        steps: [{ kind: "wm", program: "", arguments: [] }],
        env: [{ name: "BAD=ENV", value: "x" }],
      },
    ]
  ) assertThrows(() => decodeProjectCommands({ version: 1, commands: [command] }));
});

Deno.test("explicit file execution bypasses pak.wm and missing named projects fail clearly", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(root, "pak.wm"), "invalid project syntax");
    await Deno.writeTextFile(join(root, "dev.wm"), 'let main=()=>{print("file");3};');
    const file = await run(root, ["./dev.wm"]);
    assertEquals(file.code, 3, decoder.decode(file.stderr));
    assertEquals(decoder.decode(file.stdout), "file\n");
    await Deno.remove(join(root, "pak.wm"));
    const absent = await run(root, ["dev"]);
    assertEquals(absent.code, 1);
    assertStringIncludes(decoder.decode(absent.stderr), "no pak.wm found");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("project command timed out")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

Deno.test({
  name: "project command termination reaches its active process and prevents later steps",
  ignore: Deno.build.os === "windows",
  async fn() {
    const root = await Deno.makeTempDir();
    let child: Deno.ChildProcess | undefined;
    let exited = false;
    try {
      await Deno.writeTextFile(
        join(root, "wait.ts"),
        `
        const timer=setInterval(()=>{},1000);
        Deno.addSignalListener("SIGTERM",()=>{
          Deno.writeTextFileSync("stopped","yes"); clearInterval(timer); Deno.exit(0);
        });
        console.log("READY");
      `,
      );
      await Deno.writeTextFile(
        join(root, "pak.wm"),
        `
        from "pakman/project.wm" import {command,Exec};
        let commands=[command("dev",[
          Exec(${JSON.stringify(Deno.execPath())},["run","-A","wait.ts"]),
          Exec(${JSON.stringify(Deno.execPath())},["eval","Deno.writeTextFileSync('later','bad')"])
        ])];
      `,
      );
      child = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--config", config, cli, "run", "dev"],
        cwd: root,
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const status = child.status.then((result) => {
        exited = true;
        return result;
      });
      const stderr = new Response(child.stderr).text();
      const reader = child.stdout.getReader();
      let output = "";
      while (!output.includes("READY")) {
        const next = await deadline(reader.read(), 20000);
        if (next.done) throw new Error(`child exited: ${await stderr}`);
        output += decoder.decode(next.value);
      }
      await reader.cancel();
      reader.releaseLock();
      child.kill("SIGTERM");
      const result = await deadline(status, 5000);
      assertEquals(result.code, 143, await stderr);
      assertEquals(await Deno.readTextFile(join(root, "stopped")), "yes");
      await assertRejects(() => Deno.stat(join(root, "later")), Deno.errors.NotFound);
    } finally {
      if (child && !exited) {
        try {
          child.kill("SIGKILL");
        } catch {}
        await child.status;
      }
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test({
  name: "watched project commands rebuild nested inputs, recover from failure, and stop children",
  ignore: Deno.build.os === "windows",
  async fn() {
    const root = await Deno.makeTempDir();
    let child: Deno.ChildProcess | undefined;
    let exited = false;
    let errors: Promise<string> | undefined;
    const events = () => Deno.readTextFile(join(root, "events")).catch(() => "");
    const waitFor = (expected: string) =>
      deadline(
        (async () => {
          while (!(await events()).includes(expected)) {
            if (exited) throw new Error(`watch exited: ${await errors}`);
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        })(),
        20000,
      );
    try {
      await Deno.mkdir(join(root, "src", "nested"), { recursive: true });
      await Deno.mkdir(join(root, "dist"));
      const input = join(root, "src", "nested", "value");
      await Deno.writeTextFile(input, "first");
      await Deno.writeTextFile(
        join(root, "build.ts"),
        `
        const value=Deno.readTextFileSync("src/nested/value");
        Deno.writeTextFileSync("events","build:"+value+"\\n",{append:true});
        if(value==="broken") Deno.exit(9);
        Deno.writeTextFileSync("dist/value",value);
      `,
      );
      await Deno.writeTextFile(
        join(root, "server.ts"),
        `
        const value=Deno.readTextFileSync("dist/value");
        Deno.addSignalListener("SIGTERM",()=>{
          Deno.writeTextFileSync("events","stop:"+value+"\\n",{append:true}); Deno.exit(0);
        });
        Deno.writeTextFileSync("events","start:"+value+":"+Deno.args.join(",")+":"+Deno.env.get("LABEL")+"\\n",{append:true});
        setInterval(()=>{},1000);
      `,
      );
      await Deno.writeTextFile(
        join(root, "pak.wm"),
        `
        from "pakman/project.wm" import {command,watch,withEnv,Variable,Exec};
        let commands=[withEnv([Variable("LABEL","watched")], watch(["src"], command("dev",[
          Exec(${JSON.stringify(Deno.execPath())},["run","-A","build.ts"]),
          Exec(${JSON.stringify(Deno.execPath())},["run","-A","server.ts"])
        ])))];
      `,
      );
      child = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--config", config, cli, "run", "dev", "--", "extra"],
        cwd: join(root, "src"),
        stdout: "null",
        stderr: "piped",
      }).spawn();
      const status = child.status.then((result) => {
        exited = true;
        return result;
      });
      errors = new Response(child.stderr).text();
      await waitFor("start:first:extra:watched");
      await Deno.writeTextFile(input, "broken");
      await waitFor("build:broken");
      assertStringIncludes(await events(), "stop:first\nbuild:broken\n");
      await Deno.writeTextFile(input, "fixed");
      await waitFor("start:fixed:extra:watched");
      child.kill("SIGTERM");
      assertEquals((await deadline(status, 5000)).code, 143, await errors);
      assertEquals(
        await events(),
        "build:first\nstart:first:extra:watched\nstop:first\nbuild:broken\nbuild:fixed\nstart:fixed:extra:watched\nstop:fixed\n",
      );
    } finally {
      if (child && !exited) {
        child.kill("SIGTERM");
        await deadline(child.status, 5000);
      }
      await errors;
      await Deno.remove(root, { recursive: true });
    }
  },
});
