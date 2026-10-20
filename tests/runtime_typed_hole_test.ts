import { assertEquals, assertStringIncludes } from "@std/assert";
import { compile, compileVirtual } from "../src/compiler.ts";

for (
  const [label, body] of [
    ["synchronous main", "?"],
    ["awaited Task callback", "Task.succeed(void) :> Task.map((_) => { ? })"],
    ["detached Task callback", "let _ = Task.succeed(void) :> Task.map((_) => { ? }); void"],
  ] as const
) {
  Deno.test(`a typed hole in ${label} terminates despite active event-loop handles`, async () => {
    const source = `from js.global import unsafe {
  setInterval: (Void -> Void, Number) -> Number,
};
let main = () => {
  let _ = setInterval((_) => { void }, 1000);
  ${body}
};`;
    const js = await compile(source);
    const directory = await Deno.makeTempDir();
    try {
      const path = `${directory}/main.mjs`;
      await Deno.writeTextFile(path, js);
      const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", path],
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 3000);
      try {
        const result = await child.output();
        const stderr = new TextDecoder().decode(result.stderr);
        assertEquals(timedOut, false, "typed-hole error left the event loop running");
        assertEquals(result.code, 1);
        assertStringIncludes(stderr, "error[type.typed-hole <source>:");
        assertEquals(stderr.match(/error\[type\.typed-hole/g)?.length, 1);
        assertEquals(stderr.includes("Uncaught"), false);
        assertEquals(stderr.includes("main.mjs"), false);
        assertEquals(new TextDecoder().decode(result.stdout), "");
      } finally {
        clearTimeout(timer);
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
}

Deno.test("a reached hole identifies the exact hole and source callers across modules", async () => {
  const files = new Map([
    [
      "/app/helpers.wm",
      `let unused = () => { ? };
let reached = () => { ? };`,
    ],
    [
      "/app/main.wm",
      `from "./helpers.wm" import { reached };
let main = () => { reached() };`,
    ],
  ]);
  const stderr = await runHoleProgram(await compileVirtual("/app/main.wm", files));
  assertStringIncludes(stderr, "error[type.typed-hole /app/helpers.wm:2:");
  assertStringIncludes(stderr, "Reached from:");
  assertStringIncludes(stderr, "/app/main.wm:2:20");
  assertStringIncludes(stderr, "let main = () => { reached() }");
  assertEquals(stderr.includes("/app/helpers.wm:1:"), false);
});

for (const asynchronous of [false, true]) {
  Deno.test(`Result.debug identifies which aliased call was reached (async=${asynchronous})`, async () => {
    const source = `let unwrap = Result.debug;
let unused = () => { Err(Js.Error("unused")) :> unwrap };
let reached = () => {
  Err(Js.Error("failed decoding")) :> unwrap
};
let main = () => {
  ${asynchronous ? "Task.succeed(void) :> Task.map((_) => { reached() })" : "reached()"}
};`;
    const stderr = await runHoleProgram(await compile(source));
    assertStringIncludes(stderr, "error[type.typed-hole std/result.wm:72:4]");
    assertStringIncludes(stderr, "Reached from:");
    assertStringIncludes(stderr, "<source>:4:39");
    assertStringIncludes(stderr, 'Err(Js.Error("failed decoding")) :> unwrap');
    assertEquals(stderr.includes('Err(Js.Error("unused"))'), false);
  });
}

async function runHoleProgram(js: string): Promise<string> {
  const directory = await Deno.makeTempDir();
  try {
    const path = `${directory}/main.mjs`;
    await Deno.writeTextFile(path, js);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", path],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(result.stderr);
    assertEquals(result.code, 1, stderr);
    assertEquals(stderr.includes("main.mjs"), false);
    assertEquals(stderr.match(/error\[type\.typed-hole/g)?.length, 1);
    return stderr;
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("two debug calls on one line identify only the reached call, including Unicode", async () => {
  const call = 'Err(Js.Error("decode failed 🐈")) :> Result.debug';
  const source = `let main = () => { let _ = Ok("🐈") :> Result.debug; ${call} };`;
  const column = source.lastIndexOf("Result.debug") + 1;
  const stderr = await runHoleProgram(await compile(source));
  assertStringIncludes(stderr, `<source>:1:${column}`);
  const earlierColumn = source.indexOf("Result.debug") + 1;
  assertEquals(stderr.includes(`<source>:1:${earlierColumn}\n`), false);
});
