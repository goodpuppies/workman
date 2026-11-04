import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { knownIssue } from "./known_issue.ts";

// Each test here asserts the correct behavior of something that is currently wrong. See known_issue.ts.

const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));

type Files = Record<string, string>;

async function wm(command: "check" | "run", files: Files) {
  const dir = await Deno.makeTempDir({ prefix: "wm-known-issue-" });
  try {
    for (const [name, text] of Object.entries(files)) {
      await Deno.mkdir(dirname(join(dir, name)), { recursive: true });
      await Deno.writeTextFile(join(dir, name), text);
    }
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", main, command, "m.wm"],
      cwd: dir,
      env: { NO_COLOR: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    return { code: output.code, stdout: decode(output.stdout), stderr: decode(output.stderr) };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function issue(slug: string, name: string, fn: () => Promise<void>) {
  Deno.test({ name: `[known issue: ${slug}] ${name}`, ignore: knownIssue(slug), fn });
}

async function checks(files: Files) {
  const result = await wm("check", files);
  assertEquals(result.code, 0, result.stderr);
  return result;
}

async function runs(files: Files, expectedStdout: string) {
  const result = await wm("run", files);
  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.stdout, expectedStdout);
}

async function rejects(files: Files) {
  const result = await wm("check", files);
  assert(result.code !== 0, "expected a compile error, but the program was accepted");
}

issue(
  "forward-pipe-binds-tighter-than-arithmetic",
  "a pipe takes the whole arithmetic expression on its left",
  () =>
    runs(
      {
        "m.wm": `
          let tenx = (v) => { v * 10 };
          let main = () => { print(1 + 2 :> tenx) };
        `,
      },
      "30\n",
    ),
);

issue(
  "equality-does-not-check-option-list-result-arguments",
  "== rejects functions inside an Option",
  () =>
    rejects({
      "m.wm": `
        let main = () => {
          let f = (x) => { x + 1 };
          print(Some(f) == Some(f))
        };
      `,
    }),
);

issue(
  "equality-through-imported-generic-function-rejects-user-types",
  "an imported generic == helper accepts a user datatype",
  () =>
    runs(
      {
        "colors.wm": `type Color = | Red | Green;`,
        "helpers.wm": `let same = (a, b) => { a == b };`,
        "m.wm": `
          from "./colors.wm" import { Red };
          from "./helpers.wm" import { same };
          let main = () => { print(same(Red, Red)) };
        `,
      },
      "true\n",
    ),
);

const orderedTree = `
  type Ordering = Less | Equal | Greater;
  type Tree<K, V> = | Empty | Node<K, V, Tree<K, V>, Tree<K, V>>;
`;

issue(
  "generic-record-constraints-and-match-exhaustiveness",
  "an exhaustive match function over a tuple doesn't warn",
  async () => {
    const result = await checks({
      "m.wm": `${orderedTree}
        let rec findTree = match(compare, key, tree) => {
          (_, _, Empty) => { None },
          (compare, key, Node(nodeKey, value, left, right)) => {
            match(compare(key, nodeKey)) {
              Less => { findTree(compare, key, left) },
              Equal => { Some(value) },
              Greater => { findTree(compare, key, right) },
            }
          },
        };
      `,
    });
    assert(!(result.stdout + result.stderr).includes("non-exhaustive"), result.stderr);
  },
);

issue(
  "ffi-boundary-blocks-independent-generalization",
  "a helper that logs through FFI generalizes across modules",
  async () => {
    await checks({
      "runtime.wm": `
        from js.global("console") import { log };
        let pass = (value) => { log("pass"); value };
      `,
      "m.wm": `
        from "./runtime.wm" import * as Runtime;
        let number = Runtime.pass(1);
        let text = Runtime.pass("hello");
        let main ==> { void };
      `,
    });
  },
);

issue(
  "jsobject-is-accepted-as-any-foreign-object-type",
  "Js.Object isn't accepted where a specific foreign class is expected",
  () =>
    rejects({
      "m.wm": `
        from js.global import type { Request };
        from js.global import unsafe { structuredClone as makeObj: String -> Js.Object };
        from js.global("Deno") import unsafe { serve: Request -> Js.Value };
        let main = () => { serve(makeObj("x")) };
      `,
    }),
);

issue(
  "partial-inference-drops-ffi-blocked-export",
  "an export blocked on FFI isn't reported as an unknown import",
  async () => {
    const result = await wm("check", {
      "exa.wm": `
        from js.global import { fetch };
        from js.global("JSON") import unsafe { stringify: Js.Value -> String } as JSON;
        let search = (query: String) => {
          let body = JSON.stringify(JSON{ query: query });
          fetch("https://example.com", JSON{ method: "POST", body: body })
            :> Task.mapErr(Js.Error)
        };
      `,
      "m.wm": `
        from "./exa.wm" import { search };
        let main = () => { print("ok") };
      `,
    });
    assert(!result.stderr.includes("unknown import search"), result.stderr);
  },
);

issue(
  "recursive-via-binding-mismatch-diagnostic-is-too-indirect",
  "a bad recursive via call is reported at the call",
  async () => {
    const result = await wm("check", {
      "m.wm": `
        record State = { n: Number };
        let rec loop = Monad.via Task (state: State) => {
          let continue = Monad.via Task (_) => {
            state :> loop
          };
          Task.succeed(void) :> continue
        };
        let main = () => { print("ok") };
      `,
    });
    assert(result.code !== 0);
    assertStringIncludes(result.stderr, "state :> loop");
  },
);

const libc = (result: string) =>
  `dlopen("libc.so.6", JSON{
    write: JSON{ parameters: JSON["i32", "buffer", "usize"], result: "${result}" }
  })`;

issue(
  "polymorphic-unwrap-helper-strands-ffi-reflection",
  "a generic Result unwrap helper keeps FFI evidence",
  async () => {
    await checks({
      "m.wm": `
        from js.global("Deno") import { dlopen: _deep_ };
        from js.global import { TextEncoder };
        let try = (result) => {
          match(result) {
            Ok(value) => { value },
            Err(_) => { Panic("JS FFI call failed") },
          }
        };
        let main = () => {
          match(${libc("i32")}) {
            Err(_) => { print("dlopen failed") },
            Ok(lib) => {
              let enc = TextEncoder.new() :> try;
              let bytes = enc.encode("hi") :> try;
              match(lib.symbols.write(1, Some(bytes), 2)) {
                Ok(_) => { print("ok") },
                Err(_) => { print("err") },
              }
            },
          }
        };
      `,
    });
  },
);

issue(
  "top-level-viaerror-binding-does-not-generalize",
  "a top-level partial viaError binding works at two types",
  async () => {
    await checks({
      "m.wm": `
        from js.global import { TextEncoder };
        type AppError = | JsFail<Js.Error>;
        let viaJs = Monad.viaError Result JsFail;
        let main = () => {
          let encode = viaJs (enc) => { enc.encode("hi") };
          let count = viaJs (bytes) => { bytes.length };
          match(TextEncoder.new() :> Result.mapErr(JsFail) :> encode :> count) {
            Ok(_) => { print("ok") },
            Err(_) => { print("err") },
          }
        };
      `,
    });
  },
);

issue(
  "ffi-64-bit-integer-result-types-are-unreflectable",
  "a dlopen symbol returning isize can be called",
  async () => {
    await checks({
      "m.wm": `
        from js.global("Deno") import { dlopen: _deep_ };
        let libc = ${libc("isize")};
        let main = () => {
          let use = Monad.via Result (lib) => { lib.symbols.write(1, None, 0) };
          match(libc :> use) {
            Ok(_) => { print("ok") },
            Err(_) => { print("err") },
          }
        };
      `,
    });
  },
);

issue(
  "c-ffi-empty-macro-in-preprocessor-expression",
  "an empty macro in #if doesn't invalidate the header",
  () =>
    runs(
      {
        "x.h": `#define FLEXARRAY\n#if FLEXARRAY+1 > 1\n#error wrong\n#endif\n#define OK 17\n`,
        "m.wm": `
          from c.header("./x.h") import unsafe { OK };
          let main = () => { print(OK) };
        `,
      },
      "17\n",
    ),
);

// These reproduced in an issue file once and no longer do. Keep them passing.
Deno.test("fixed: a missing js.module path gets a diagnostic", async () => {
  const result = await wm("check", {
    "m.wm": `
      from js.module("./does-not-exist.js") import * as Raylib;
      let main = () => { print("ok") };
    `,
  });
  assert(result.code !== 0);
  assertStringIncludes(result.stderr, "ffi.import-resolution");
});

Deno.test("fixed: a named import can share the name of its module", () =>
  runs(
    {
      "render.wm": `let render = (value) => { value };`,
      "m.wm": `
        from "./render.wm" import { render };
        let main = () => { print(render("ok")) };
      `,
    },
    "ok\n",
  ));

Deno.test("fixed: a parameter annotation through List resolves a shared field", () =>
  runs(
    {
      "m.wm": `
        record A = { s: String, n: Number };
        record B = { s: String, k: Number };
        let first = (rows: List<B>) => {
          match(rows) {
            [] => { "" },
            [Var(row), ..Var(_rest)] => { row.s }
          }
        };
        let main = () => { print(first([B { s = "x", k = 1 }])) };
      `,
    },
    "x\n",
  ));

Deno.test("fixed: a lambda parameter annotation provides equality evidence", () =>
  runs(
    {
      "m.wm": `
        let rec stringIn = (name: String, expected: List<String>) => {
          match(expected) {
            [] => { false },
            [Var(candidate), ..Var(rest)] => {
              if (name == candidate) { true } else { stringIn(name, rest) }
            }
          }
        };
        let main = () => { print(stringIn("b", ["a", "b"])) };
      `,
    },
    "true\n",
  ));

Deno.test({
  name: "fixed: an anonymous C struct typedef emits valid helper names",
  ignore: Deno.build.os !== "linux",
  fn: () =>
    runs(
      {
        "m.wm": `
          from c.header("signal.h") import type { sigset_t };
          let main = () => { print(sizeOfsigset_t); };
        `,
      },
      "128\n",
    ),
});
