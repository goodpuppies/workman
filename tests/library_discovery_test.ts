import { assertEquals, assertRejects } from "@std/assert";
import { fileURLToPath } from "node:url";
import { discoverStandardModules, libraryModuleAlias } from "../src/standard_library.ts";
import { librarySources } from "../src/generated/assets.ts";
import { analyzeFile, analyzeRecoveredFile } from "../src/compiler.ts";

Deno.test("library module aliases come from snake_case file names", () => {
  assertEquals(libraryModuleAlias("std/list.wm"), "List");
  assertEquals(libraryModuleAlias("std/result.wm"), "Result");
  assertEquals(libraryModuleAlias("basis/word8_vector.wm"), "Word8Vector");
  assertEquals(libraryModuleAlias("basis/pack_word32_little.wm"), "PackWord32Little");
});

Deno.test("every generated library source is discovered and imports precede importers", async () => {
  const modules = await discoverStandardModules();
  assertEquals(modules.map((module) => module.path).sort(), Object.keys(librarySources).sort());
  const position = new Map(modules.map((module, index) => [module.path, index]));
  for (const module of modules) {
    for (const decl of module.module.decls) {
      if (decl.kind !== "ImportDecl") continue;
      const target = `std/${decl.path.replace(/^\.\//, "")}`;
      if (!position.has(target)) continue;
      if (position.get(target)! > position.get(module.path)!) {
        throw new Error(`${module.path} is ordered before its import ${target}`);
      }
    }
  }
});

Deno.test("a new library file needs no registration and is ordered after its imports", async () => {
  const modules = await discoverStandardModules({
    "std/aardvark.wm":
      'from "./zebra.wm" import * as Zebra;\nlet twice = (x) => { Zebra.once(Zebra.once(x)) };\n',
    "std/zebra.wm": "let once = (x) => { x + 1 };\n",
  });
  assertEquals(
    modules.map((module) => [module.path, module.alias]),
    [["std/zebra.wm", "Zebra"], ["std/aardvark.wm", "Aardvark"]],
  );
});

Deno.test("library discovery reports missing imports, cycles, and duplicate namespaces", async () => {
  await assertRejects(
    () => discoverStandardModules({ "std/a.wm": 'from "./missing.wm" import * as M;\n' }),
    Error,
    "std/a.wm imports missing library module std/missing.wm",
  );
  await assertRejects(
    () =>
      discoverStandardModules({
        "std/a.wm": 'from "./b.wm" import * as B;\n',
        "std/b.wm": 'from "./a.wm" import * as A;\n',
      }),
    Error,
    "library import cycle: std/a.wm -> std/b.wm -> std/a.wm",
  );
  await assertRejects(
    () =>
      discoverStandardModules({
        "basis/option.wm": "let x = 1;\n",
        "std/option.wm": "let y = 2;\n",
      }),
    Error,
    "both define namespace Option",
  );
  await assertRejects(
    () =>
      discoverStandardModules(
        { "basis/a.wm": 'from js.module("./js/a.js") import unsafe { f: Number -> Number };\n' },
        {},
      ),
    Error,
    "library module basis/a.wm imports missing JavaScript file basis/js/a.js",
  );
});

Deno.test("library JavaScript imports resolve to embedded library files", async () => {
  const modules = await discoverStandardModules();
  const vector = modules.find((module) => module.alias === "Word8Vector")!;
  const specifiers = vector.module.decls.flatMap((decl) =>
    decl.kind === "JsImportDecl" && decl.target.kind === "JsModule" ? [decl.target.specifier] : []
  );
  assertEquals([...new Set(specifiers)], ["wm-library:basis/js/byte_vector.js"]);
});

const cli = fileURLToPath(new URL("../src/main.ts", import.meta.url));

async function runProgram(
  source: string,
  command = "run",
  siblings: Record<string, string> = {},
) {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(input, source);
  for (const [name, text] of Object.entries(siblings)) {
    await Deno.writeTextFile(`${dir}/${name}`, text);
  }
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", cli, command, input],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

const shortSlice = "Word8VectorSlice.full(Word8Vector.fromList([Word8.fromNumber(1)]))";

Deno.test("qualified std datatype constructors work in patterns", async () => {
  const result = await runProgram(`
    let main = () => {
      match(Binary.u32le(${shortSlice}, 1)) {
        Err(Binary.Bounds(offset, width, available)) => { print((offset, width, available)) },
        _ => { print("other") }
      }
    };
  `);
  assertEquals(result.stderr, "");
  assertEquals(result.code, 0);
  assertEquals(result.stdout, "(1, 4, 1)\n");
});

Deno.test("qualified std datatype constructors work in expressions", async () => {
  const result = await runProgram(`
    let main = () => {
      match(Binary.u32le(${shortSlice}, 1)) {
        Err(e) => { print(e == Binary.Bounds(1, 4, 1)) },
        _ => { print("other") }
      }
    };
  `);
  assertEquals(result.stderr, "");
  assertEquals(result.code, 0);
  assertEquals(result.stdout, "true\n");
});

Deno.test("basis structures are library modules over inlined JavaScript primitive files", async () => {
  const source = `
    let main = () => {
      let bytes = Word8Vector.fromList([Word8.fromNumber(1), Word8.fromNumber(2)]);
      print((Result.debug(Word8Vector.sub(bytes, 1)), Word8Vector.length(bytes)))
    };
  `;
  const compiled = await runProgram(source, "compile");
  assertEquals(compiled.code, 0);
  const js = compiled.stdout;
  // Each library file is inlined once, as a program-level constant that module bodies import.
  const inlined = [
    ...js.matchAll(/const __wm_library_js_\d+ = "data:text\/javascript,([^"]{0,120})/g),
  ]
    .map((match) => decodeURIComponent(match[1].replace(/%[0-9A-F]?$/, "")));
  // `Result.debug` reaches `host/js/debug.wm` through an ordinary library import.
  assertEquals(inlined.length, 3);
  assertEquals(inlined.some((text) => text.includes("byte structures")), true);
  assertEquals(inlined.some((text) => text.includes("basis/word8.wm")), true);
  assertEquals(inlined.some((text) => text.includes("host/js/debug.wm")), true);
  assertEquals(js.includes('await import("data:'), false);
  assertEquals(js.includes("const Word8Vector = {"), false);
  // `sub` calls the primitive directly with spread arguments.
  assertEquals(
    /__wm_js_member_obj\(__wm_js_module_\d+, "sub"\); return \(__arg\) => __wm_js_direct_\d+\(\.\.\.__arg\)/
      .test(js),
    true,
  );
  const result = await runProgram(source);
  assertEquals(result.stderr, "");
  assertEquals(result.stdout, "(2, 2)\n");
});

Deno.test("bindings over declared unsafe imports generalize like ordinary bindings", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/ident.js`, "export const ident = (value) => value;\n");
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `from js.module("./ident.js") import unsafe { ident: value -> value };
let wrap = (x) => { ident(x) };
let main = () => {
  print((wrap(1), wrap("one")));
  print(Word8Vector.unfoldN(1, 0, (s) => { (Word8.fromNumber(s), s + 1) }));
  print(Word8Vector.unfoldN(1, "a", (s) => { (Word8.fromNumber(7), s ++ "b") }))
};
`,
  );
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", cli, "run", input],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(new TextDecoder().decode(output.stderr), "");
  assertEquals(
    new TextDecoder().decode(output.stdout),
    "(1, one)\n(Word8Vector[0], 1)\n(Word8Vector[7], ab)\n",
  );
});

Deno.test("Task operations defined in std/task.wm keep their behavior", async () => {
  const result = await runProgram(`
    let main = () => {
      Task.map2(Task.succeed(2), Task.succeed(3), (a, b) => { a * b })
        :> Task.andThen((product) => { Task.fail(product) })
        :> Task.recover((error) => { error + 1 })
        :> Task.andThen((value) => {
          Task.all(Js.Array.fromList([Task.succeed(value), Task.succeed(value * 10)]))
        })
        :> Task.andThen((values) => {
          Task.new((complete) => {
            complete(Ok(Js.Array.toList(values)));
            Ok(void)
          })
        })
        :> Task.map((values) => { print(values) })
    };
  `);
  assertEquals(result.stderr, "");
  assertEquals(result.stdout, "Cons(7, Cons(70, Nil))\n");
});

Deno.test("tooling analysis resolves std constructors in patterns", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `let s = Word8VectorSlice.full(Word8Vector.fromList([Word8.fromNumber(1)]));
let main = () => {
  match(Binary.u32le(s, 1)) {
    Err(Binary.Bounds(offset, width, available)) => { print((offset, width, available)) },
    _ => { print("other") }
  }
};
`,
  );
  // Facts cover the library, but the snapshot still describes only the program's module.
  const strict = await analyzeFile(input);
  assertEquals(strict.interfaces.size, 1);
  assertEquals(strict.graph.order.length, 1);
  const recovered = await analyzeRecoveredFile(input);
  assertEquals(recovered.interfaces.size, 1);
});

Deno.test("js.host imports host helper modules by name (BD17)", async () => {
  const cache = `from js.host("table") import * as Table;
let remember = (key, value) => {
  let table = Table.empty();
  Table.set(table, key, value);
  Table.get(table, key)
};
`;
  const result = await runProgram(
    `from "./cache.wm" import { remember };
from js.host("dict") import { empty, get, set };
from js.host("debug") import * as Debug;

let main = () => {
  print(remember("a", 1));
  let dict = empty();
  set(dict, "x", "hello");
  print((get(dict, "x"), get(dict, "y")));
  print(Debug.errorMessage(Js.Error("boom")));
};
`,
    "run",
    { "cache.wm": cache },
  );
  assertEquals(result.stderr, "");
  assertEquals(result.code, 0);
  assertEquals(result.stdout, "Some(1)\n(Some(hello), None)\nboom\n");
});

Deno.test("host helper modules are never opened without a js.host import", async () => {
  const result = await runProgram(`let main = () => { print(Table.empty()) };\n`, "check");
  assertEquals(result.code === 0, false);
  const unknown = await runProgram(
    `from js.host("nope") import * as Nope;\nlet main = () => { print(1) };\n`,
    "check",
  );
  assertEquals(unknown.code === 0, false);
  assertEquals(unknown.stderr.includes(`unknown host module js.host("nope")`), true);
});

Deno.test("tooling analysis follows js.host edges without listing library modules", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `from js.host("table") import * as Table;
let main = () => {
  let table = Table.empty();
  Table.set(table, "a", 1);
  print(Table.get(table, "a"))
};
`,
  );
  const strict = await analyzeFile(input);
  assertEquals(strict.interfaces.size, 1);
  assertEquals(strict.graph.order.length, 1);
  const recovered = await analyzeRecoveredFile(input);
  assertEquals(recovered.interfaces.size, 1);
});
