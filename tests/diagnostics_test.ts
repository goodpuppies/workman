import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource } from "../src/compiler.ts";
import {
  formatDiagnostic,
  formatReplDiagnostic,
  type FrontendDiagnostic,
  FrontendDiagnosticError,
  renderDiagnosticSummary,
} from "../src/diagnostics.ts";

Deno.test("call mismatch produces an auditable diagnostic artifact", async () => {
  const error = await assertRejects(
    () => checkSource('let inc = (x: Number) => { x + 1 }; let bad = inc("no");'),
    FrontendDiagnosticError,
  );

  const diagnostic = error.diagnostic;
  assertEquals(diagnostic.code, "type.mismatch");
  assertEquals(diagnostic.failure.frame.rule, "InferCall.Argument");
  assertEquals(diagnostic.failure.premise.role, "argument matches parameter");
  assertEquals(diagnostic.failure.violation.kind, "contradicted");
  assertEquals(diagnostic.support.entries.some((entry) => entry.kind === "constraint"), true);
  assertEquals(diagnostic.support.entries.some((entry) => entry.kind === "collision"), true);
  assertEquals(diagnostic.support.entries.some((entry) => entry.kind === "claim"), true);
  assertEquals(diagnostic.support.entries.some((entry) => entry.kind === "note"), false);
  assertEquals(constraintRoles(diagnostic), ["parameter", "argument"]);
  assertEquals(
    diagnostic.support.types.some((snapshot) => snapshot.rendered === "Number"),
    true,
  );
  assertEquals(
    diagnostic.support.types.some((snapshot) => snapshot.rendered === "String"),
    true,
  );
  assertEquals(
    renderDiagnosticSummary(diagnostic),
    [
      "type mismatch: InferCall.Argument: argument matches parameter",
      "  conflict: type",
      "  expected: Number",
      "  actual:   String",
    ].join("\n"),
  );
});

Deno.test("call mismatch prefers use-site argument over callee definition", async () => {
  const source = `
from js.global("Math") import { sin as msin };
let liftR = Monad.lift Result;
let sin = liftR msin;
let uw = match(res) => { Ok(i) => { i }, Err(_) => { Panic("bad") } };
let main = () => {
  let time = Ok(1.5) :> uw;
  let pulse = 0.55 + sin(time * 2):>uw * 0.25;
};
`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const primary = error.diagnostic.primary;
  if (primary.kind !== "source") {
    throw new Error("expected source primary diagnostic");
  }
  const expectedStart = source.indexOf("sin(time * 2)");
  assertEquals(primary.span.start, expectedStart);
  assertEquals(primary.span.end, expectedStart + "sin(time * 2)".length);
});

Deno.test("carrier tuple mismatch points at offending item", async () => {
  const source = `let bad = Result|1, Ok("a")|;`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const primary = error.diagnostic.primary;
  if (primary.kind !== "source") {
    throw new Error("expected source primary diagnostic");
  }
  const expectedStart = source.indexOf("1");
  assertEquals(primary.span.start, expectedStart);
  assertEquals(primary.span.end, expectedStart + "1".length);
});

Deno.test("carrier tuple mismatch points at later offending item", async () => {
  const source = `let bad = Result|Ok("a"), 32, Ok(true)|;`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const primary = error.diagnostic.primary;
  if (primary.kind !== "source") {
    throw new Error("expected source primary diagnostic");
  }
  const expectedStart = source.indexOf("32");
  assertEquals(primary.span.start, expectedStart);
  assertEquals(primary.span.end, expectedStart + "32".length);
});

Deno.test("multi-argument call mismatch points at offending argument", async () => {
  const source = `let draw = (x: Number, y: Number) => { x }; let bad = draw(1, Ok(2));`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const primary = error.diagnostic.primary;
  if (primary.kind !== "source") {
    throw new Error("expected source primary diagnostic");
  }
  const expectedStart = source.indexOf("Ok(2)");
  assertEquals(primary.span.start, expectedStart);
  assertEquals(primary.span.end, expectedStart + "Ok(2)".length);
});

Deno.test("basic diagnostic summary displays generic variables TypeScript style", async () => {
  const source = `
type List<T> = Nil | Cons<T, List<T>>;

let rec filterList = (fn, list) => {
  match(list) => {
    [] => {[]},
    [head, ..tail] => {
      if (fn(head)) {
        [head, ..filterList(fn, tail)]
      } else {
        filterList(fn, tail)
      }
    }
  }
};
`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const summary = renderDiagnosticSummary(error.diagnostic);
  assertStringIncludes(summary, "List<T>");
  assertEquals(summary.includes("'"), false);
});

Deno.test("pipe mismatch records a pipe step premise", async () => {
  const error = await assertRejects(
    () => checkSource('let render = (n: Number) => { n }; let bad = "x" :> render;'),
    FrontendDiagnosticError,
  );

  assertEquals(error.diagnostic.failure.frame.rule, "InferPipe.StepInput");
  assertEquals(error.diagnostic.failure.premise.role, "pipe output matches next function input");
  assertEquals(constraintRoles(error.diagnostic), ["callee", "pipe function"]);
  assertEquals(claimSubjects(error.diagnostic), [
    "render",
    "piped value",
    "pipe result",
    "render pipe",
  ]);
});

Deno.test("pipe mismatch uses the enhanced authored renderer", async () => {
  const source = 'let render = (n: Number) => { n };\nlet bad = "x" :> render;';
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatDiagnostic(error.diagnostic, "Main.wm", source);
  assertStringIncludes(rendered, "-- TYPE CHECKER");
  assertStringIncludes(rendered, "Main.wm");
  assertStringIncludes(rendered, "This expression produces:");
  assertStringIncludes(rendered, "    String");
  assertStringIncludes(rendered, '2| let bad = "x" :> render;');
  assertStringIncludes(rendered, "But this pipeline step needs:");
  assertStringIncludes(rendered, "    Number");
  assertStringIncludes(rendered, "`render` takes a `Number` as its first argument.");
});

Deno.test("REPL diagnostics keep one compact source excerpt", async () => {
  const source = 'let inc = (x: Number) => { x + 1 };\nlet bad = inc("no");';
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatReplDiagnostic(error.diagnostic, "Main.wm", source);
  assertStringIncludes(rendered, "error[type.mismatch] Main.wm:2:");
  assertStringIncludes(rendered, "expected Number, got String");
  assertStringIncludes(rendered, '2 | let bad = inc("no");');
  assertEquals(rendered.includes("-- TYPE CHECKER"), false);
  assertEquals(rendered.includes("support:"), false);
  assertEquals(rendered.includes("rule:"), false);
  assertEquals(rendered.split("\n").filter(Boolean).length, 3);
});

Deno.test("pipe mismatch points at trailing semicolon Void source", async () => {
  const source = `
let parseConfig: (Number) => Result<String, Js.Error> = (n) => { Ok("ok") };
let input: Result<Number, Js.Error> = Err(Js.Unknown);
let bad = input
  :> Result.mapErr((e) => {
    e;
  })
  :> Result.andThen(parseConfig);
`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatDiagnostic(error.diagnostic, "test.wm", source);
  assertStringIncludes(rendered, "This expression produces:");
  assertStringIncludes(rendered, "    Void");
  assertStringIncludes(rendered, "6|     e;");
  assertStringIncludes(
    rendered,
    "this trailing `;` makes the block result Void",
  );
  assertStringIncludes(rendered, "But this pipeline step needs:");
  assertStringIncludes(rendered, "    Js.Error");
});

Deno.test("recursive result mismatch explains accidental match function", async () => {
  const source = `
type List<T> = Nil | Cons<T, List<T>>;

let rec filterList = (fn, list) => {
  match(list) => {
    [] => {[]},
    [head, ..tail] => {
      if (fn(head)) {
        [head, ..filterList(fn, tail)]
      } else {
        filterList(fn, tail)
      }
    }
  }
};
`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatDiagnostic(error.diagnostic, "math.wm", source);
  assertStringIncludes(rendered, "`filterList` is recursive");
  assertStringIncludes(rendered, "Recursive calls produce:");
  assertStringIncludes(rendered, "List<T>");
  assertEquals(rendered.includes("'"), false);
  assertStringIncludes(rendered, "But the body produces:");
  assertStringIncludes(rendered, "match(list) => {");
  assertStringIncludes(rendered, "This looks like an accidental match-function expression.");
  assertStringIncludes(rendered, "Use `match(list) { ... }`");
});

Deno.test("match arm mismatch explains previous and current arm result types", async () => {
  const source = `type AppError = | RenderError<String>;
let renderErr = (e) => { RenderError(e) };
let bad = match(true) {
  true => { Result|Err("js")| },
  false => { Err(renderErr("app")) }
};`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatDiagnostic(error.diagnostic, "test.wm", source);
  assertStringIncludes(rendered, "-- TYPE CHECKER");
  assertStringIncludes(rendered, "These match arms return different types.");
  assertStringIncludes(rendered, "Earlier arm result:");
  assertStringIncludes(rendered, "    Result<T, String>");
  assertStringIncludes(rendered, '4|   true => { Result|Err("js")| },');
  assertStringIncludes(rendered, "This arm result:");
  assertStringIncludes(rendered, "    Result<T, AppError>");
  assertStringIncludes(rendered, '5|   false => { Err(renderErr("app")) }');
  assertStringIncludes(rendered, "Different part:");
  assertStringIncludes(rendered, "Result<_, E>");
  assertStringIncludes(rendered, "previous arm(s): String");
  assertStringIncludes(rendered, "this arm:       AppError");
  assertEquals(rendered.includes("expected: AppError"), false);
});

Deno.test("if branch mismatch records an if branch premise", async () => {
  const error = await assertRejects(
    () => checkSource('let bad = if (true) { 1 } else { "x" };'),
    FrontendDiagnosticError,
  );

  assertEquals(error.diagnostic.failure.frame.rule, "InferIf.BranchesSameType");
  assertEquals(error.diagnostic.failure.premise.role, "if branches have the same type");
  assertEquals(constraintRoles(error.diagnostic), ["then branch", "else branch"]);
});

Deno.test("binary operand mismatch records an operator premise", async () => {
  const error = await assertRejects(
    () => checkSource('let bad = 1 + "x";'),
    FrontendDiagnosticError,
  );

  assertEquals(error.diagnostic.failure.frame.rule, "InferBinary.OperatorOperands");
  assertEquals(error.diagnostic.failure.premise.role, "operator operands match operator type");
  assertEquals(constraintRoles(error.diagnostic), ["operator", "operands"]);
  assertEquals(
    ['operator +: "((Number, Number)) => Number"', "left operand", "right operand"]
      .every((subject) => claimSubjects(error.diagnostic).includes(subject)),
    true,
  );
});

Deno.test("panic message mismatch records a panic premise", async () => {
  const error = await assertRejects(
    () => checkSource("let bad = Panic(1);"),
    FrontendDiagnosticError,
  );

  assertEquals(error.diagnostic.failure.frame.rule, "InferPanic.MessageString");
  assertEquals(error.diagnostic.failure.premise.role, "panic message is String");
  assertEquals(constraintRoles(error.diagnostic), ["required type", "message"]);
});

Deno.test("unary operand mismatch records a unary premise", async () => {
  const error = await assertRejects(
    () => checkSource('let bad = -"x";'),
    FrontendDiagnosticError,
  );

  assertEquals(error.diagnostic.failure.frame.rule, "InferUnary.NumericOperand");
  assertEquals(error.diagnostic.failure.premise.role, "unary - operand is Number");
  assertEquals(constraintRoles(error.diagnostic), ["required type", "operand"]);
});

function constraintRoles(diagnostic: FrontendDiagnostic): string[] {
  const entry = diagnostic.support.entries.find((item) => item.kind === "constraint");
  return entry?.kind === "constraint" ? entry.roles.map((role) => role.role) : [];
}

function claimSubjects(diagnostic: FrontendDiagnostic): string[] {
  return diagnostic.support.entries
    .filter((entry) => entry.kind === "claim")
    .map((entry) => entry.claim.subject);
}
