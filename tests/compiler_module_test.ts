import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { pathToFileURL } from "node:url";
import {
  checkSource,
  checkVirtual,
  compileFile,
  compileVirtual,
  ModuleAnalysisError,
} from "../src/compiler.ts";
import { formatDiagnostic, FrontendDiagnosticError } from "../src/diagnostics.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("compiles file imports as implicit structures", async () => {
  const js = await compileFile(new URL("../examples/use_math.wm", import.meta.url).pathname);
  assertStringIncludes(js, "const Math_");
  assertStringIncludes(js, ".add");
  assertStringIncludes(js, ".Just");
});

Deno.test("source-only frontend rejects imports with clear API boundary", async () => {
  await assertRejects(
    () => checkSource('from "./math.wm" import * as Math; let x = 1;'),
    Error,
    "source strings with imports require checkFile",
  );
});

Deno.test("type diagnostics retain the constraint origin across an imported callback", async () => {
  const mainSource = `record Coord = { x: Number };
from "./runtime.wm" import * as Runtime;
let render = (model, state) => { model.x };
let bad = Runtime.run(.{x=0}, render);`;
  const virtualFs = new Map<string, string>([
    ["/test/runtime.wm", "let run = (initial, render) => { render(None, initial) };"],
    ["/test/main.wm", mainSource],
  ]);
  const error = await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    ModuleAnalysisError,
  );
  if (!(error.originalError instanceof FrontendDiagnosticError)) {
    throw new Error("expected a frontend diagnostic");
  }

  const diagnostic = error.originalError.diagnostic;
  if (diagnostic.primary.kind !== "source") throw new Error("expected a source primary");
  assertEquals(diagnostic.primary.span.start, mainSource.indexOf("model"));
  assertEquals(diagnostic.primary.span.end, mainSource.indexOf("model") + "model".length);
  const rendered = formatDiagnostic(diagnostic, error.path, error.source);
  assertStringIncludes(rendered.split("-- Origins")[0], "let render = (model, state)");
  assertStringIncludes(rendered, "type error: render parameter 1 can't be both:");
  assertStringIncludes(rendered, "render(None, initial)");
  assertStringIncludes(rendered, "runtime.wm:1:");
  assertStringIncludes(rendered, "Option<T>");
  assertStringIncludes(rendered, "Coord");
});

Deno.test("imports are declaration-ordered and not hoisted", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let value = 1;"],
    ["/test/main.wm", 'let x = Lib.value; from "./lib.wm" import * as Lib;'],
  ]);
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "unknown name Lib.value",
  );
});

Deno.test("checkFile accepts URL pathname entry paths", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let value = 1;"],
    ["/test/main.wm", 'from "./lib.wm" import * as Lib; let x = Lib.value;'],
  ]);
  const pathname = pathToFileURL("/test/main.wm").pathname;
  await checkVirtual(pathname, virtualFs);
});

Deno.test("supports long type constructors from imported files", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/box.wm", "type Box<T> = | Box<T>; let make = (x) => { Box(x) };"],
    [
      "/test/main.wm",
      'from "./box.wm" import * as Boxed; let x: Boxed.Box<Number> = Boxed.make(1);',
    ],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
  const javaScript = await compileVirtual("/test/main.wm", virtualFs);
  assertStringIncludes(javaScript, "?.ctor ===");
  assertStringIncludes(javaScript, ".args.length === 0");
});

Deno.test("supports long constructor identifiers in match patterns", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/option.wm",
      "type Option<T> = None | Some<T>; let wrap = (x) => { Some(x) };",
    ],
    [
      "/test/main.wm",
      'from "./option.wm" import * as Opt; let value = Opt.wrap(1); let get = match(value) => { Opt.Some(x) => { x }, Opt.None => { 0 } };',
    ],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("supports named imports for values constructors and types", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/option.wm",
      "type Option<T> = None | Some<T>; let make = (x) => { Some(x) };",
    ],
    [
      "/test/main.wm",
      'from "./option.wm" import { Option, Some, None, make as wrap }; let value: Option<Number> = wrap(1); let get = match(value) => { Some(x) => { x }, None => { 0 } };',
    ],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("named imports reject missing members", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let present = 1;"],
    ["/test/main.wm", 'from "./lib.wm" import { missing }; let x = 1;'],
  ]);
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "unknown import missing",
  );
});

Deno.test("rejects duplicate imported bindings in the same namespace", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let present = 1;"],
    ["/test/main.wm", 'from "./lib.wm" import { present, present as present }; let x = present;'],
  ]);
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "duplicate value import present",
  );
});

Deno.test("later namespace imports shadow earlier structure aliases", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "let value = 1;"],
    ["/test/b.wm", 'let value = "later";'],
    [
      "/test/main.wm",
      'from "./a.wm" import * as Lib; from "./b.wm" import * as Lib; let x = Lib.value;',
    ],
  ]);
  const main = (await checkVirtual("/test/main.wm", virtualFs)).get("/test/main.wm")!;
  expectBinding(main.env, "x", { type: "String", vars: 0 });
});

Deno.test("later named imports shadow earlier imports", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "let value = 1;"],
    ["/test/b.wm", 'let value = "later";'],
    [
      "/test/main.wm",
      'from "./a.wm" import { value }; from "./b.wm" import { value }; let x = value;',
    ],
  ]);
  const main = (await checkVirtual("/test/main.wm", virtualFs)).get("/test/main.wm")!;
  expectBinding(main.env, "x", { type: "String", vars: 0 });
});

Deno.test("local declarations shadow imported bindings", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let value = 1;"],
    [
      "/test/main.wm",
      'from "./lib.wm" import { value }; let value = "local"; let ok = value == "local";',
    ],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("named imports see plain declarations by default", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let hidden = 1; let visible = hidden + 1;"],
    ["/test/main.wm", 'from "./lib.wm" import { hidden }; let x = 1;'],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("namespace imports expose plain declarations by default", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/lib.wm", "let hidden = 1; let visible = hidden + 1;"],
    ["/test/main.wm", 'from "./lib.wm" import * as Lib; let x = Lib.hidden;'],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("supports transitive file imports", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/base.wm", "let id = (x) => { x };"],
    ["/test/mid.wm", 'from "./base.wm" import * as Base; let keep = (x) => { Base.id(x) };'],
    [
      "/test/main.wm",
      'from "./mid.wm" import * as Mid; let a = Mid.keep(1); let b = Mid.keep("s");',
    ],
  ]);
  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("staged FFI reinference rebuilds shared monotypes with consumer nominals", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/runtime.wm",
      `
        from js.global("console") import unsafe {
          log: String -> Void
        } as Console;

        type Step<State> = | Continue<State>;

        let run = (initial, update) => {
          let _ = Console.log("start");
          update(initial)
        };
      `,
    ],
    [
      "/test/trigger.wm",
      `
        let clean = (text, needle: String) => {
          text :> .replaceAll(needle, "") :> Result.withDefault(text)
        };
      `,
    ],
    [
      "/test/main.wm",
      `
        from "./runtime.wm" import * as Runtime;
        from "./trigger.wm" import * as Trigger;

        type State = | State<Number>;

        let label = Trigger.clean("hello", "h");
        let result = Runtime.run(
          State(0),
          (state: State) => { Runtime.Continue(state) },
        );
      `,
    ],
  ]);

  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("infers imported record projections in via callbacks", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/game.wm",
      `
        record Controls = { quit: Bool };
        record Game = { controls: Controls };
        let initialGame = () => { .{ controls = .{ quit = false } } };
      `,
    ],
    [
      "/test/main.wm",
      `
        from "./game.wm" import { Controls, Game, initialGame };
        let via = Monad.via;
        let readQuit = via Result (game) => { Ok(game.controls.quit) };
        let value = readQuit(Ok(initialGame()));
      `,
    ],
  ]);

  const results = await checkVirtual("/test/main.wm", virtualFs);
  const result = results.get("/test/main.wm");
  if (!result) throw new Error("missing main result");
  expectBinding(result.env, "readQuit", {
    type: "Result<Game, 'a> -> Result<Bool, 'a>",
    vars: 0,
  });

  virtualFs.set(
    "/test/main.wm",
    `
      from "./game.wm" import { Controls, Game, initialGame };
      let via = Monad.via;
      let readMissing = via Result (game) => { Ok(game.missing) };
      let value = readMissing(Ok(initialGame()));
    `,
  );
  await assertRejects(
    () => checkVirtual("/test/main.wm", virtualFs),
    Error,
    "record Game has no field missing; available fields: controls",
  );
});

Deno.test("compiles virtual file system to JS", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/lib.wm",
      "type Option<T> = None | Some<T>; let wrap = (x) => { Some(x) };",
    ],
    ["/test/main.wm", 'from "./lib.wm" import * as Lib; let value = Lib.wrap(1);'],
  ]);
  const js = await compileVirtual("/test/main.wm", virtualFs);
  assertStringIncludes(js, "const Lib_");
  assertStringIncludes(js, ".wrap");
  assertStringIncludes(js, "Some");
});

Deno.test("imported values retain their identity in pinned match patterns", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/materials.wm", "let panel = 1;"],
    [
      "/test/main.wm",
      'from "./materials.wm" import { panel }; let selected = match(1) { panel => { true }, _ => { false } };',
    ],
  ]);
  const js = await compileVirtual("/test/main.wm", virtualFs);
  await import(`data:text/javascript;base64,${btoa(js)}#${crypto.randomUUID()}`);
});

Deno.test("rejects import cycles", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", 'from "./b.wm" import * as B; let x = 1;'],
    ["/test/b.wm", 'from "./a.wm" import * as A; let y = 2;'],
  ]);
  await assertRejects(() => checkVirtual("/test/a.wm", virtualFs), Error, "import cycle");
});

Deno.test("same-spelled datatypes from different files are nominally distinct", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/a.wm", "type Box = | Box; let make = () => { Box };"],
    ["/test/b.wm", "type Box = | Box; let make = () => { Box };"],
    [
      "/test/main.wm",
      'from "./a.wm" import * as A; from "./b.wm" import * as B; let bad: A.Box = B.make();',
    ],
  ]);
  await assertRejects(() => checkVirtual("/test/main.wm", virtualFs), Error, "type mismatch");
});
