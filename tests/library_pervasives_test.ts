import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import {
  analyzeVirtual,
  checkSource,
  checkVirtual,
  compile,
  compileLibraryVirtual,
} from "../src/compiler.ts";
import { LIBRARY_PERVASIVES, pervasiveSourceName } from "../src/library_pervasives.ts";
import { loadStandardModules } from "../src/standard_library.ts";
import { semanticDefinitionsAt } from "../src/module_interface.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("library pervasives project their defining schemes without exporting them", async () => {
  const result = await checkSource("let value = 1;");
  const modules = await loadStandardModules();
  for (const binding of LIBRARY_PERVASIVES) {
    const owner = modules.find((module) => module.path === binding.modulePath)!;
    const original = owner.result.exportedStructure.valEnv.get(pervasiveSourceName(binding))!;
    const projected = result.initialStructure.valEnv.get(binding.name)!;
    assertStrictEquals(projected.type, original.type, binding.name);
    assertEquals(projected.valueId, original.valueId, binding.name);
    assertEquals(result.exportedStructure.valEnv.has(binding.name), false, binding.name);
  }
  const checked = await checkSource(`
    let numbers = map([1, 2], (n) => { n + 1 });
    let texts = map(["a"], (s) => { s ++ "b" });
    let count = length(numbers);
    let left = foldLeft(numbers, "", (item, acc) => { acc ++ Text.of(item) });
    let right = foldRight(numbers, "", (item, acc) => { Text.of(item) ++ acc });
  `);
  expectBinding(checked.env, "numbers", { type: "List<Number>", vars: 0 });
  expectBinding(checked.env, "texts", { type: "List<String>", vars: 0 });
  expectBinding(checked.env, "count", { type: "I32", vars: 0 });
  expectBinding(checked.env, "left", { type: "String", vars: 0 });
  expectBinding(checked.env, "right", { type: "String", vars: 0 });
  await assertRejects(() => checkSource("let value = forEach([1], (n) => { n });"));
  await assertRejects(() => checkSource('let value = concat(["a", "b"]);'));
});

Deno.test("bare library pervasives retain Basis behavior through code generation", async () => {
  const source = `
    let values = map([1, 2, 3], (n) => { n * 2 });
    let selected = filter(values, (n) => { n > 2 });
    let flattened = concat([[1, 2], [], [3]]);
    let checks = (
      values == [2, 4, 6], selected == [4, 6], flattened == [1, 2, 3],
      reverse(flattened) == [3, 2, 1], isEmpty([]), !isEmpty(values),
      length(values) == (3: I32),
      Result.getOr(head(values) == Ok(2), false),
      Result.getOr(tail(values) == Ok([4, 6]), false),
      match(head([])) { Err(_) => { true }, Ok(_) => { false } },
      match(tail([])) { Err(_) => { true }, Ok(_) => { false } },
      foldLeft([1, 2, 3], "", (item, acc) => { acc ++ Text.of(item) }) == "123",
      foldRight([1, 2, 3], "", (item, acc) => { acc ++ Text.of(item) }) == "321",
      getOr(None, 7) == 7, getOr(Some(2), 7) == 2,
      isSome(Some(1)), !isSome(None),
      before(42, ignore("discard")) == 42,
      o((n) => { n * 2 }, (n) => { n + 1 })(3) == 8,
      Vector.length(vector([1, 2])) == 2,
      Result.getOr(ceil(1.2) == Ok(2), false),
      Result.getOr(floor(1.8) == Ok(1), false),
      Result.getOr(round(2.5) == Ok(2), false),
      Result.getOr(trunc(0 - 1.8) == Ok(0 - 1), false)
    );
    let exerciseEach = () => { forEach([1, 2, 3], (n) => { print(n) }) };
  `;
  const code = await compileLibraryVirtual("/test/main.wm", new Map([["/test/main.wm", source]]));
  const runtime = await import(`data:text/javascript;base64,${btoa(code)}`);
  assertEquals(runtime.checks, Array(24).fill(true));
  const output: unknown[] = [];
  const original = console.log;
  console.log = (value) => {
    output.push(value);
  };
  try {
    runtime.exerciseEach();
  } finally {
    console.log = original;
  }
  assertEquals(output, ["1", "2", "3"]);
});

Deno.test("pervasive projections share runtime function identity with explicit imports", async () => {
  const paths = [...new Set(LIBRARY_PERVASIVES.map((binding) => binding.modulePath))];
  const imports = paths.map((path, i) => {
    const specifier = path.startsWith("subml-basis/")
      ? path.replace("subml-basis/subset_", "basis/")
      : path;
    return `from "${specifier}" import * as Owner${i};`;
  });
  const aliases = LIBRARY_PERVASIVES.flatMap((binding) => [
    `let alias_${binding.name} = ${binding.name};`,
    `let source_${binding.name} = Owner${paths.indexOf(binding.modulePath)}.${
      pervasiveSourceName(binding)
    };`,
  ]);
  const source = [...imports, ...aliases].join("\n");
  const code = await compileLibraryVirtual("/test/main.wm", new Map([["/test/main.wm", source]]));
  const runtime = await import(`data:text/javascript;base64,${btoa(code)}`);
  for (const { name } of LIBRARY_PERVASIVES) {
    assertStrictEquals(runtime[`alias_${name}`], runtime[`source_${name}`], name);
  }
});

Deno.test("pervasives respect import and local shadowing without pulling unused libraries", async () => {
  const source = `
    let earlier = length([1]);
    from "./custom.wm" import { map };
    let imported = map(2);
    let nested = (length) => { length(2) };
    let local = { let length = (n) => { n + 1 }; length(2) };
  `;
  const files = new Map([
    ["/test/main.wm", source],
    ["/test/custom.wm", "let map = (n) => { n + 10 };"],
  ]);
  const main = (await checkVirtual("/test/main.wm", files)).get("/test/main.wm")!;
  assertEquals(main.exportedStructure.valEnv.has("map"), false);
  const code = await compileLibraryVirtual("/test/main.wm", files);
  const runtime = await import(`data:text/javascript;base64,${btoa(code)}`);
  assertEquals([runtime.earlier, runtime.imported, runtime.local], [1, 12, 3]);
  assertEquals(runtime.nested((n: number) => n * 2), 4);
  const shadowed = await compile("let map = (n) => { n + 1 }; let answer = map(1);");
  assertEquals(shadowed.includes("__wm_lib_subml_basis_subset_list"), false);
  const unused = await compile("let answer = 42;");
  assertEquals(unused.includes("__wm_lib_subml_basis_subset_list"), false);
  for (const { name } of LIBRARY_PERVASIVES) {
    await assertRejects(() => checkSource(`-- @no-prelude\nlet value = ${name};`));
  }
  await assertRejects(() => checkSource("let value = SubsetList.map;"));
});

Deno.test("pervasive editor definitions point at their shared Basis declarations", async () => {
  const source = `
    from "basis/list.wm" import * as Lists;
    let bare = map([1], (n) => { n });
    let qualified = Lists.map([1], (n) => { n });
  `;
  const analysis = await analyzeVirtual("/test/main.wm", new Map([["/test/main.wm", source]]));
  const project = analysis.projectSnapshot;
  const main = [...project.interfaces.values()].find((item) => item.path === "/test/main.wm")!;
  const bare = semanticDefinitionsAt(project, main.moduleId, source.indexOf("map(["));
  const qualified = semanticDefinitionsAt(project, main.moduleId, source.indexOf("Lists.map") + 6);
  assertEquals(bare.length, 1);
  assertEquals(bare[0].path, "subml-basis/subset_list.wm");
  assertEquals(bare[0].path, qualified[0].path);
  assertEquals(bare[0].span, qualified[0].span);
});

Deno.test("explicit JS imports shadow pervasive values", async () => {
  const source = `
    from js.global("Math") import { floor };
    from js.global("Math") import * as map;
    let named = match(floor(4.8)) { Ok(n) => { n }, Err(_) => { -1 } };
    let namespace = match(map.sqrt(9)) { Ok(n) => { n }, Err(_) => { -1 } };
  `;
  const code = await compileLibraryVirtual("/test/main.wm", new Map([["/test/main.wm", source]]));
  const runtime = await import(`data:text/javascript;base64,${btoa(code)}`);
  assertEquals([runtime.named, runtime.namespace], [4, 3]);
});

Deno.test("string, character, boolean and option pervasives preserve checked boundaries", async () => {
  const source = String.raw`
    from "basis/string.wm" import * as Strings;
    from "basis/char.wm" import * as Chars;
    let checks = (
      match(explode("")) { Ok(xs) => { xs == [] }, Err(_) => { false } },
      match(explode("a\u0000\u00ff")) {
        Ok(xs) => { xs == ['a', '\u0000', '\u00ff'] }, Err(_) => { false }
      },
      match(implode(['a', '\u0000', '\u00ff'])) {
        Ok(s) => { s == "a\u0000\u00ff" }, Err(_) => { false }
      },
      match(implode([])) { Ok(s) => { s == "" }, Err(_) => { false } },
      match(explode("a\u0100")) {
        Err(Strings.NonByte(offset)) => { offset == (1: I32) }, _ => { false }
      },
      match(explode("a\u{1f600}")) {
        Err(Strings.NonByte(offset)) => { offset == (1: I32) }, _ => { false }
      },
      match(implode(['a', '\u0100'])) {
        Err(Strings.NonByte(offset)) => { offset == (1: I32) }, _ => { false }
      },
      match(chr(0: I32)) { Ok(c) => { c == '\u0000' }, Err(_) => { false } },
      match(chr(255: I32)) { Ok(c) => { c == '\u00ff' }, Err(_) => { false } },
      match(chr(-1: I32)) { Err(Chars.InvalidCode) => { true }, _ => { false } },
      match(chr(256: I32)) { Err(Chars.InvalidCode) => { true }, _ => { false } },
      match(ord('\u00ff')) { Ok(n) => { n == (255: I32) }, Err(_) => { false } },
      match(ord('\u0100')) { Err(Chars.NonByteCharacter) => { true }, _ => { false } },
      match(size("")) { Ok(n) => { n == (0: I32) }, Err(_) => { false } },
      match(size("a\u0000\u00ff")) { Ok(n) => { n == (3: I32) }, Err(_) => { false } },
      match(size("a\u0100")) {
        Err(Strings.NonByte(offset)) => { offset == (1: I32) }, _ => { false }
      },
      match(str('\u0000')) { Ok(s) => { s == "\u0000" }, Err(_) => { false } },
      match(str('\u00ff')) { Ok(s) => { s == "\u00ff" }, Err(_) => { false } },
      match(str('\u0100')) {
        Err(Strings.NonByte(offset)) => { offset == (0: I32) }, _ => { false }
      },
      not(false), !not(true), map([true, false], not) == [false, true],
      match(toResult(Some(42), "missing")) { Ok(n) => { n == 42 }, Err(_) => { false } },
      match(toResult(None, "missing")) { Err(e) => { e == "missing" }, Ok(_) => { false } },
      match(toResult(None, 7)) { Err(e) => { e == 7 }, Ok(_) => { false } }
    );
  `;
  await checkSource(source);
  const files = new Map([["/test/main.wm", source]]);
  await checkVirtual("/test/main.wm", files);
  const code = await compileLibraryVirtual("/test/main.wm", files);
  const runtime = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  assertEquals(runtime.checks, Array(25).fill(true));
  for (
    const expression of [
      "chr(1: Number)",
      'ord("a")',
      'implode(["a"])',
      "size([])",
      'str("a")',
      "not(1)",
    ]
  ) {
    await assertRejects(() => checkSource(`let value = ${expression};`));
  }
});

Deno.test("every pervasive alias resolves to the defining library declaration", async () => {
  const paths = [...new Set(LIBRARY_PERVASIVES.map((binding) => binding.modulePath))];
  const imports = paths.map((path, i) => {
    const specifier = path.replace("subml-basis/subset_", "basis/");
    return `from "${specifier}" import * as Owner${i};`;
  });
  const aliases = LIBRARY_PERVASIVES.flatMap((binding) => [
    `let bare_${binding.name} = ${binding.name};`,
    `let qualified_${binding.name} = Owner${paths.indexOf(binding.modulePath)}.${
      pervasiveSourceName(binding)
    };`,
  ]);
  const source = [...imports, ...aliases].join("\n");
  const { projectSnapshot: project } = await analyzeVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const main = [...project.interfaces.values()].find((item) => item.path === "/test/main.wm")!;
  for (const binding of LIBRARY_PERVASIVES) {
    const bareOffset = source.indexOf(`= ${binding.name};`) + 2;
    const qualifiedOffset = source.indexOf(
      `= Owner${paths.indexOf(binding.modulePath)}.${pervasiveSourceName(binding)};`,
    ) + 2;
    const bare = semanticDefinitionsAt(project, main.moduleId, bareOffset);
    const qualified = semanticDefinitionsAt(
      project,
      main.moduleId,
      qualifiedOffset + `Owner${paths.indexOf(binding.modulePath)}.`.length,
    );
    assertEquals(bare.length, 1, binding.name);
    assertEquals(bare[0].path, binding.modulePath, binding.name);
    assertEquals(bare, qualified, binding.name);
  }
});

Deno.test("std String.toList projects portable byte conversions with an empty error fallback", async () => {
  const source = String.raw`
    let convert = toList;
    let qualified = String.toList;
    let checks = (
      toList("") == [],
      toList("abc") == ["a", "b", "c"],
      toList("a\u0000\u00ff") == ["a", "\u0000", "\u00ff"],
      toList("\u0100") == [],
      toList("abc\u0100") == [],
      toList("a\u{1f600}b") == [],
      toList("e\u0301") == [],
      String.toList("ab") == toList("ab")
    );
  `;
  const checked = await checkSource(source);
  expectBinding(checked.env, "convert", { type: "String -> List<String>", vars: 0 });
  const code = await compileLibraryVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", source]]),
  );
  const runtime = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  assertEquals(runtime.checks, Array(8).fill(true));
  assertStrictEquals(runtime.convert, runtime.qualified);
  await assertRejects(() => checkSource("let value = toList(42);"));
});
