import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource, compile, compileVirtual } from "../src/compiler.ts";
import { parseCompilerModule } from "../src/compiler_frontend.ts";
import { formatFrontendV2Source } from "../src/frontend_v2_formatter.ts";
import { expectBinding } from "./type_helpers.ts";

async function execute(source: string): Promise<string> {
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(path, await compile(source));
    const result = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", path] }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    return new TextDecoder().decode(result.stdout).trim();
  } finally {
    await Deno.remove(path);
  }
}

Deno.test("computed patterns parse and format as explicit equality patterns", async () => {
  const source =
    'let classify = (n) => { match(true) { =(n == 0) => "zero", =(n > 0) => "positive", _ => "negative" } };';
  const module = await parseCompilerModule(source);
  const declaration = module.decls[0];
  const lambda = declaration.kind === "LetDecl" ? declaration.bindings[0].value : undefined;
  const match = lambda?.kind === "Lambda" && lambda.body.kind === "Block"
    ? lambda.body.result
    : undefined;
  assertEquals(match?.kind === "Match" ? match.arms[0].pattern.kind : undefined, "PComputed");
  const formatted = await formatFrontendV2Source(source);
  assertStringIncludes(formatted, "=(n == 0)");
  assertEquals(await formatFrontendV2Source(formatted), formatted);
  await checkSource(formatted);
});

Deno.test("computed predicates select zero positive and negative branches", async () => {
  assertEquals(
    await execute(`
    let classify = (n) => { match(true) {
      =(n == 0) => { "zero" },
      =(n > 0) => { "positive" },
      _ => { "negative" },
    } };
    let main = () => { print(classify(0)); print(classify(2)); print(classify(0 - 2)) };
  `),
    "zero\npositive\nnegative",
  );
});

Deno.test("computed patterns preserve one subject evaluation and ordered short circuiting", async () => {
  assertEquals(
    await execute(`
    let probe = (label, value) => { print(label); value };
    let main = () => {
      match(probe("subject", true)) {
        =(probe("first", false)) => { Panic("wrong arm") },
        =(probe("second", true)) => { print("hit") },
        =(Panic("later arm evaluated")) => { void },
        _ => { Panic("miss") },
      };
      match((1, 2)) {
        (=(probe("nested", 0)), =(Panic("later tuple part evaluated"))) => { void },
        _ => { print("fallthrough") },
      };
      match(None) {
        Some(=(Panic("constructor payload evaluated"))) => { void },
        None => { print("shape skipped") },
      }
    };
  `),
    "subject\nfirst\nsecond\nhit\nnested\nfallthrough\nshape skipped",
  );
});

Deno.test("computed values use enclosing scope and participate in closure captures", async () => {
  assertEquals(
    await execute(`
    let x = 10;
    let make = (limit) => { (input) |limit| => {
      match(input) { =(limit + 1) => { true }, _ => { false } }
    } };
    let main = () => {
      match((Some(3), 10)) {
        (Some(x), =(x)) => { print(x) },
        _ => { Panic("computed expression saw a new pattern binder") },
      };
      print(make(4)(5))
    };
  `),
    "3\ntrue",
  );
  await assertRejects(() =>
    checkSource(`
    let bad = match(Some(1), true) { (Some(x), =(x > 0)) => { true }, _ => { false } };
  `)
  );
});

Deno.test("computed equality accepts constructed values and reflected JS calls", async () => {
  assertEquals(
    await execute(`
    from js.global("Math") import { floor };
    let main = () => {
      let expected = 1;
      print(match(Some(1)) { =(Some(expected)) => { "constructed" }, _ => { "miss" } });
      print(match(1) { =(floor(1.9) :> Result.debug) => { "reflected" }, _ => { "miss" } })
    };
  `),
    "constructed\nreflected",
  );
});

Deno.test("computed patterns reject mismatched types and retain non-exhaustiveness", async () => {
  await assertRejects(() => checkSource("let bad = match(1) { =(true) => { 1 }, _ => { 0 } };"));
  await assertRejects(() => checkSource("let =(1) = 1;"));
  const result = await checkSource(
    "let expected = 1; let partial = match(1) { =(expected) => { 1 } };",
  );
  assertStringIncludes(result.warnings.join("\n"), "non-exhaustive");
  await assertRejects(() => checkSource("let rec bad = match(1) { =(bad) => { 1 }, _ => { 0 } };"));
});

Deno.test("computed pattern effects taint the match result", async () => {
  const result = await checkSource(`
    let check = (value) => {
      match(value) {
        =({ print("checked"); 1 }) => { true },
        _ => { false },
      }
    };
  `);
  expectBinding(result.env, "check", { type: "Number -> Bool!", vars: 0 });
});

Deno.test("computed patterns work in lists records constrained patterns and match functions", async () => {
  assertEquals(
    await execute(`
    record Pair = { left: Number, right: Number };
    let expected = 2;
    let label = match { =(expected + 1) => { "function" }, _ => { "miss" } };
    let main = () => {
      print(match([1, 2]) { [1, =(expected)] => { "list" }, _ => { "miss" } });
      print(match(.{ left = 1, right = 2 }) {
        .{ left = =(1), right = =(expected) } => { "record" }, _ => { "miss" }
      });
      print(match(2) { (=(expected) : Number) => { "constrained" }, _ => { "miss" } });
      print(label(3))
    };
  `),
    "list\nrecord\nconstrained\nfunction",
  );
});

Deno.test("computed pattern imports retain the defining module and captured names", async () => {
  const js = await compileVirtual(
    "/test/main.wm",
    new Map([
      [
        "/test/rules.wm",
        `let expected = 3; let matches = (n) => { match(n) { =(expected) => { true }, _ => { false } } };`,
      ],
      [
        "/test/main.wm",
        `from "./rules.wm" import { matches }; let main = () => { print(matches(3)) };`,
      ],
    ]),
  );
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(path, js);
    const result = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", path] }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    assertEquals(new TextDecoder().decode(result.stdout).trim(), "true");
  } finally {
    await Deno.remove(path);
  }
});
