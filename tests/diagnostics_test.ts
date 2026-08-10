import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource } from "../src/compiler.ts";
import {
  formatDiagnostic,
  formatDiagnosticDocument,
  formatDiagnosticInspection,
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
  assertEquals(diagnostic.code, "type.call-argument-mismatch");
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
      "type collision: InferCall.Argument: argument matches parameter",
      "  conflict: type",
      "  left: Number",
      "    source: parameter x",
      "  right: String",
      "    source: argument",
    ].join("\n"),
  );
});

Deno.test("HM call collision renders neutral origins and both provenance paths", async () => {
  const source = `record Coord = { x: Number, y: Number };
type Step<State> = | Continue<State>;
let coordUpdate = (coord) => {};
let update = match(event, model) => {
  (0, _) => { Continue(coordUpdate(model)) },
  _ => { Continue(model) },
};
let run = (initial, updateFn) => { updateFn(0, initial) };
let bad = run(.{ x=0, y=0 }, update);`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatDiagnostic(error.diagnostic, "case.wm", source);
  assertStringIncludes(rendered, "Error: TYPE CHECKER[type.call-argument-mismatch]");
  assertStringIncludes(rendered, "type error: update can't be both:\n  - Void\n  - Coord");
  assertStringIncludes(rendered, "case.wm:9:");
  assertEquals(rendered.includes(" ~ "), false);
  assertStringIncludes(rendered, "Coord");
  assertStringIncludes(rendered, "Void");
  assertStringIncludes(rendered, ".{ x=0, y=0 }");
  assertStringIncludes(rendered, "let coordUpdate = (coord) => {}");
  assertStringIncludes(rendered, "empty block result: Void");
  assertStringIncludes(rendered, "record literal: Coord");
  assertStringIncludes(rendered, "-- Origins ");
  assertStringIncludes(rendered, "│");
  assertStringIncludes(rendered, "use wm err case.wm to see a more detailed error");
  assertEquals(rendered.includes("-- Provenance "), false);
  assertEquals(rendered.includes("Collision at"), false);
  assertEquals(rendered.includes("expected:"), false);
  assertEquals(rendered.includes("actual:"), false);

  const document = formatDiagnosticDocument(error.diagnostic, "case.wm", source);
  assertEquals(document.lines[0].spans[0], { text: "Error:", role: "error" });
  assertEquals(document.lines[0].spans[1].role, "header");
  const typed = document.lines.flatMap((line) => line.spans)
    .filter((span) => span.role === "type")
    .map((span) => span.text);
  assertEquals(typed, ["Void", "Coord", "Void", "Coord"]);
  const hint = document.lines.flatMap((line) => line.spans)
    .find((span) => span.text.startsWith("- use wm err"));
  assertEquals(hint?.role, "hint");

  const inspection = formatDiagnosticInspection(error.diagnostic, "case.wm", source);
  assertStringIncludes(inspection, "-- Provenance ");
  assertStringIncludes(inspection, "case.wm:");
  assertStringIncludes(inspection, " : ");
  assertStringIncludes(inspection, "* low-level diagnostic:");
  assertStringIncludes(inspection, "rule: InferCall.Argument");
  assertStringIncludes(inspection, "support:");
  assertStringIncludes(inspection, "* compiler trace:");
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

  assertEquals(error.diagnostic.code, "type.pipe-input-mismatch");
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
  assertStringIncludes(rendered, "Error: TYPE CHECKER[type.pipe-input-mismatch]");
  assertStringIncludes(rendered, "Main.wm");
  assertStringIncludes(rendered, "type error: pipe sides can't be both:");
  assertStringIncludes(rendered, "let bad = {..}");
  assertStringIncludes(rendered, ": String");
  assertStringIncludes(rendered, 'let bad = "x" :> {..}');
  assertStringIncludes(rendered, ": Number");
  assertStringIncludes(rendered, "-- Origins");
});

Deno.test("REPL diagnostics keep one compact source excerpt", async () => {
  const source = 'let inc = (x: Number) => { x + 1 };\nlet bad = inc("no");';
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatReplDiagnostic(error.diagnostic, "Main.wm", source);
  assertStringIncludes(rendered, "error[type.call-argument-mismatch] Main.wm:2:");
  assertStringIncludes(rendered, "Number conflicts with String");
  assertStringIncludes(rendered, '2 | let bad = inc("no");');
  assertEquals(rendered.includes("Error: TYPE CHECKER"), false);
  assertEquals(rendered.includes("support:"), false);
  assertEquals(rendered.includes("rule:"), false);
  assertEquals(rendered.split("\n").filter(Boolean).length, 3);
});

Deno.test("pipe mismatch points at trailing semicolon Void source", async () => {
  const source = `
let parseConfig: Number -> Result<String, Js.Error> = (n) => { Ok("ok") };
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
  assertStringIncludes(rendered, "type error: pipe sides can't be both:");
  assertStringIncludes(rendered, ": Void");
  assertStringIncludes(rendered, ": Js.Error");
  assertStringIncludes(rendered, "6|     e;");
  assertStringIncludes(
    rendered,
    "this trailing `;` makes the block result Void",
  );
  assertStringIncludes(rendered, "let annotation: Js.Error");
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

  assertEquals(error.diagnostic.code, "type.recursive-result-mismatch");
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

Deno.test("match arm mismatch uses the shared neutral collision diagnostic", async () => {
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

  assertEquals(error.diagnostic.code, "type.match-arm-results-disagree");
  const rendered = formatDiagnostic(error.diagnostic, "test.wm", source);
  assertStringIncludes(rendered, "Error: TYPE CHECKER[type.match-arm-results-disagree]");
  assertStringIncludes(rendered, "type error: match arms can't be both:");
  assertStringIncludes(rendered, "4|   true => {..} : Result<T, String>");
  assertStringIncludes(rendered, "5|   false => {..}: Result<T, AppError>");
  assertStringIncludes(rendered, "expression: String");
  assertStringIncludes(rendered, "RenderError call result: AppError");
  assertStringIncludes(rendered, "-- Origins ");
  assertStringIncludes(rendered, "use wm err test.wm to see a more detailed error");
  assertEquals(rendered.includes("These match arms return different types."), false);
  assertEquals(rendered.includes("expected: AppError"), false);
});

Deno.test("match arm collision traces Void to an ending semicolon", async () => {
  const source = `record Coord = { x: Number, y: Number };
type Step<State> = | Continue<State> | Quit;
let coordUpdate = (coord) => {
  coord;
};
let update = match(event, model) => {
  (0, _) => { Continue(coordUpdate(model)) },
  (1, _) => { Continue(coordUpdate(model)) },
  (2, _) => { Continue(coordUpdate(model)) },
  (3, _) => { Continue(coordUpdate(model)) },
  (4, _) => { Quit },
  _ => { Continue(.{..model, x=model.x}) },
};`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatDiagnostic(error.diagnostic, "case.wm", source);
  assertStringIncludes(rendered, "type error: match arms can't be both:");
  assertStringIncludes(rendered, "10|   (3, _) => {..}: Step<Void>");
  assertStringIncludes(rendered, "12|   _ => {..}     : Step<Coord>");
  assertEquals(rendered.includes("11|   (4, _) => {..}"), false);
  assertStringIncludes(rendered, "^ ending semicolon: Void");
  assertStringIncludes(rendered, "record literal: Coord");

  const document = formatDiagnosticDocument(error.diagnostic, "case.wm", source);
  const types = document.lines.flatMap((line) => line.spans)
    .filter((span) => span.role === "type")
    .map((span) => span.text);
  assertEquals(types, ["Step<Void>", "Step<Coord>", "Void", "Coord"]);

  const inspection = formatDiagnosticInspection(error.diagnostic, "case.wm", source);
  assertStringIncludes(inspection, "10|   (3, _) => {..}: Step<Void>");
  assertStringIncludes(inspection, "12|   _ => {..}     : Step<Coord>");
  assertStringIncludes(inspection, "-- Provenance ");
  assertStringIncludes(inspection, "* low-level diagnostic:");
});

Deno.test("if branch mismatch records an if branch premise", async () => {
  const source = `let bad = if (true) {
  true
} else {
  "x"
};`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  assertEquals(error.diagnostic.code, "type.if-branch-results-disagree");
  assertEquals(error.diagnostic.failure.frame.rule, "InferIf.BranchesSameType");
  assertEquals(error.diagnostic.failure.premise.role, "if branches have the same type");
  assertEquals(constraintRoles(error.diagnostic), ["then branch", "else branch"]);
  const rendered = formatDiagnostic(error.diagnostic, "if.wm", source);
  assertStringIncludes(rendered, "type error: if branches can't be both:");
  assertStringIncludes(rendered, "1| let bad = if (true) {..}: Bool");
  assertStringIncludes(rendered, "3| } else {..}");
  assertStringIncludes(rendered, ": String");
  assertStringIncludes(rendered, "expression: Bool");
  assertStringIncludes(rendered, "expression: String");
  assertStringIncludes(rendered, "-- Origins");
});

Deno.test("compact collision excerpts collapse excessive indentation", async () => {
  const source = `let inc = (x: Number) => { x + 1 };
let main = () => {
                    inc("no")
};`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatDiagnostic(error.diagnostic, "indent.wm", source);
  assertStringIncludes(rendered, '3|   inc("no")');
  assertEquals(rendered.includes('3|                     inc("no")'), false);
  assertStringIncludes(rendered, "indent.wm:3:21");
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
    ['operator +: "(Number, Number) -> Number"', "left operand", "right operand"]
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
