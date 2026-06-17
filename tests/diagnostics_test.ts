import { assertEquals, assertRejects } from "@std/assert";
import { checkSource } from "../src/compiler.ts";
import {
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
      "type mismatch",
      "  at type:",
      "    expected: Number",
      "    got:      String",
      '  full expected: "Number"',
      '  full got:      "String"',
    ].join("\n"),
  );
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

Deno.test("if branch mismatch records an if branch premise", async () => {
  const error = await assertRejects(
    () => checkSource('let bad = if (true) { 1 } else { "x" };'),
    FrontendDiagnosticError,
  );

  assertEquals(error.diagnostic.failure.frame.rule, "InferIf.BranchesSameType");
  assertEquals(error.diagnostic.failure.premise.role, "if branches have the same type");
  assertEquals(constraintRoles(error.diagnostic), ["then branch", "else branch"]);
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
