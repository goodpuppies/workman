import { assertEquals, assertStringIncludes } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { formatDiagnostic } from "../src/diagnostics.ts";
import { structuralDiagnostics } from "../src/frontend_v2_diagnostics.ts";
import { loadFrontendV2 } from "../src/frontend_v2_loader.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;
const frontend = await loadFrontendV2(await buildFrontend());

Deno.test("structural marks project into auditable failure and recovery evidence", () => {
  const source = "let thing =";
  const result = frontend.parseStructural(source);
  const diagnostics = structuralDiagnostics(result, source);

  assertEquals(diagnostics.length, 2);
  const missingExpression = diagnostics[0];
  assertEquals(missingExpression.code, "parse.let.missing-expression");
  assertEquals(missingExpression.severity, "error");
  assertEquals(missingExpression.primary, {
    kind: "source",
    span: { line: 1, col: 11, start: 11, end: 11 },
  });
  assertEquals(missingExpression.failure.frame.rule, "ParseLetBinding");
  assertEquals(missingExpression.failure.frame.path, [
    "ParseModule",
    "ParseLetDecl",
    "ParseBinding",
    "RequireExpression",
  ]);
  assertEquals(missingExpression.failure.premise.predicate, {
    kind: "present",
    subject: "node#1",
    syntaxCategory: "Expression",
  });
  assertEquals(missingExpression.failure.violation, {
    kind: "missing",
    observedBoundary: "end of file",
  });
  assertEquals(
    missingExpression.support.entries.map((entry) => entry.kind),
    ["recovery", "note"],
  );
  assertEquals(missingExpression.support.edges, [{
    from: "syntax-recovery-1",
    to: "syntax-fallback-1",
    role: "produced-fallback",
  }]);
  assertEquals(missingExpression.repairs, []);
});

Deno.test("safe structural completion carries a justified concrete repair", () => {
  const source = "let thing =";
  const diagnostics = structuralDiagnostics(frontend.parseStructural(source), source);
  const semicolon = diagnostics[1];

  assertEquals(semicolon.code, "parse.let.missing-semicolon");
  assertEquals(semicolon.severity, "warning");
  assertEquals(semicolon.repairs, [{
    id: "syntax-repair-2",
    description: 'Insert ";"',
    edits: [{
      span: { line: 1, col: 11, start: 11, end: 11 },
      text: ";",
    }],
    makesTrue: "syntax-premise-2",
    requires: ["syntax-recovery-2"],
    applicability: "safe",
  }]);

  const rendered = formatDiagnostic(semicolon, "test.wm", source);
  assertStringIncludes(rendered, "rule: ParseTopPhrase");
  assertStringIncludes(rendered, "premise: present(node#1, Token)");
  assertStringIncludes(rendered, "missing syntax at end of file");
  assertStringIncludes(rendered, "recovery: insert semicolon");
  assertStringIncludes(rendered, "repairs:");
  assertStringIncludes(rendered, '11..11 -> ";"');
});

Deno.test("structural diagnostic dependencies and identities follow recovery IDs", () => {
  const source = "let thing";
  const result = frontend.parseStructural(source);
  const diagnostics = structuralDiagnostics(result, source);

  assertEquals(diagnostics.map((diagnostic) => diagnostic.id), [
    "syntax-diagnostic-1",
    "syntax-diagnostic-2",
    "syntax-diagnostic-3",
  ]);
  assertEquals(diagnostics[1].dependsOn, ["syntax-diagnostic-1"]);

  const withDuplicateMark = { ...result, marks: [result.marks[0], ...result.marks] };
  assertEquals(structuralDiagnostics(withDuplicateMark, source).length, 3);
});

Deno.test("optional canonical marks stay out of default diagnostics", () => {
  const source = "let main = => print(thing);";
  const result = frontend.parseStructural(source);

  assertEquals(
    result.marks.map((mark) => [mark.code, mark.repairClass]),
    [
      ["parse.lambda.optional-unit-params", "optionalCanonical"],
      ["parse.lambda.missing-body-open-block", "autoFix"],
      ["parse.lambda.missing-body-close-block", "autoFix"],
    ],
  );
  assertEquals(
    structuralDiagnostics(result, source).map((diagnostic) => diagnostic.code),
    [
      "parse.lambda.missing-body-open-block",
      "parse.lambda.missing-body-close-block",
    ],
  );

  const diagnostics = structuralDiagnostics(result, source, {
    includeOptionalCanonical: true,
  });
  assertEquals(diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.severity]), [
    ["parse.lambda.optional-unit-params", "hint"],
    ["parse.lambda.missing-body-open-block", "warning"],
    ["parse.lambda.missing-body-close-block", "warning"],
  ]);
  assertEquals(diagnostics[0].support.entries[0].kind, "recovery");
});

Deno.test("recovered match arm blocks expose separate safe brace repairs", () => {
  const source = "let value = match(input) => { Some(x) => x };";
  const result = frontend.parseStructural(source);
  const diagnostics = structuralDiagnostics(result, source);

  assertEquals(
    diagnostics.map((diagnostic) => diagnostic.code),
    [
      "parse.match.missing-arm-body-open-block",
      "parse.match.missing-arm-body-close-block",
    ],
  );
  assertEquals(
    diagnostics.map((diagnostic) => diagnostic.repairs[0]?.edits[0].text),
    ["{", "}"],
  );
  assertEquals(
    diagnostics.map((diagnostic) => diagnostic.repairs[0]?.applicability),
    ["safe", "safe"],
  );
});

async function buildFrontend(): Promise<URL> {
  const output = (await Deno.makeTempDir()) + "/frontend-v2.mjs";
  await Deno.writeTextFile(output, await compileLibraryFile(frontendSource));
  return new URL("file://" + output);
}
