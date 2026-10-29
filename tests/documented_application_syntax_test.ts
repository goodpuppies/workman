import { assert, assertEquals } from "@std/assert";
import { compileLibraryVirtual } from "../src/compiler.ts";
import { parseCompilerModule } from "../src/compiler_frontend.ts";
import { normalizeFrontendSemanticAst } from "../src/frontend_v2_compare.ts";
import { formatFrontendV2Source } from "../src/frontend_v2_formatter.ts";
import type { Expr } from "../src/ast.ts";

function application(expression: Expr): unknown {
  if (expression.kind === "Var") return expression.name;
  if (expression.kind === "Call") {
    return [application(expression.callee), ...expression.args.map(application)];
  }
  throw new Error(`unexpected expression ${expression.kind}`);
}

// docs/carriers.md and docs/generic-programming.md rely on these being ordinary
// left-associated applications, including when the final parentheses have a gap.
Deno.test("documented carrier application grouping survives formatting", async () => {
  const cases: [string, unknown][] = [
    ["via Result transform(input)", [[["via", "Result"], "transform"], "input"]],
    ["Monad.via Result console.log(input)", [[["Monad.via", "Result"], "console.log"], "input"]],
    ["Traverse.with Result (items, transform)", [
      ["Traverse.with", "Result"],
      "items",
      "transform",
    ]],
    ["joinWith Result (nested)", [["joinWith", "Result"], "nested"]],
    ["f a b", [["f", "a"], "b"]],
    ["f(a)(b)", [["f", "a"], "b"]],
  ];
  for (const [expression, expected] of cases) {
    const source = `let value = ${expression};`;
    const module = await parseCompilerModule(source);
    const declaration = module.decls[0];
    assert(declaration.kind === "LetDecl");
    assertEquals(application(declaration.bindings[0].value), expected, expression);
    for (const fix of [false, true]) {
      const formatted = await formatFrontendV2Source(source, "<documented-application>", fix);
      assertEquals(
        normalizeFrontendSemanticAst(await parseCompilerModule(formatted)),
        normalizeFrontendSemanticAst(module),
        formatted,
      );
    }
  }
});

// Executable counterparts of docs/advancedsyntax.md's inline Task progression,
// computed-function pipe rule and explicit-call argument insertion.
Deno.test("documented via and pipe forms preserve their runtime behavior", async () => {
  const source = `
    let via = Monad.via;
    let double = (n) => { Ok(n * 2) };
    let direct: Result<Number, String> = via Result double(Ok(21));
    let placeholder: Result<Number, String> = Ok(21) :> via Result double();
    let computed: Result<Number, String> = Ok(21) :> via Result double;
    let traversed: Result<List<Number>, String> = Traverse.with Result ([1, 2], double);

    let nextTask: Task<Number, String> = Task.succeed(42);
    let boundStage = via Task (_) => { nextTask };
    let bound: Task<Number, String> = Task.succeed(void) :> boundStage;
    let inline: Task<Number, String> = Task.succeed(void) :> via Task (_) => { nextTask };
    let legacy: Task<Number, String> = Task.succeed(void) :> via Task (_) => { nextTask }();
    let bare: Task<Number, String> = Task.succeed(void) :> via Task => { nextTask };
    let parameter: Task<Number, String> = Task.succeed(41)
      :> via Task (value) => { Task.succeed(value + 1) };
    let unwrap = (result) => { match(result) { Ok(value) => { value }, Err(_) => { -1 } } };
    let results = (unwrap(direct), unwrap(placeholder), unwrap(computed),
      Result.getOr(traversed == Ok([2, 4]), false));

    let add = (left, right) => { left + right };
    let adapt = (transform) => { (value) => { transform(value) } };
    let makeAdd = (amount) => { (value) => { value + amount } };
    let pipes = (40 :> add(2), 40 :> (adapt(makeAdd(2))), 40 :> (makeAdd(2)));
  `;
  const code = await compileLibraryVirtual(
    "/test/documented-application.wm",
    new Map([["/test/documented-application.wm", source]]),
  );
  const runtime = await import(`data:text/javascript;base64,${btoa(code)}`);
  assertEquals(runtime.results, [42, 42, 42, true]);
  assertEquals(runtime.pipes, [42, 42, 42]);
  for (const name of ["bound", "inline", "legacy", "bare", "parameter"]) {
    assertEquals(runtime.unwrap(await runtime[name]), 42, name);
  }
});
