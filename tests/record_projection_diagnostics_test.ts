import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource, checkVirtual, ModuleAnalysisError } from "../src/compiler.ts";
import {
  formatDiagnostic,
  formatDiagnosticDocument,
  formatDiagnosticInspection,
  FrontendDiagnosticError,
} from "../src/diagnostics.ts";
import { plainText } from "../tooling/tuiman/document.ts";

Deno.test("field access on print's return value has authored receiver provenance", async () => {
  const source = 'print (.{name="test"}:User{name:String}).name;';
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const diagnostic = error.diagnostic;
  assertEquals(diagnostic.code, "record.invalid-projection");
  assertEquals(diagnostic.failure.frame.rule, "InferRecord.ProjectField");
  assertEquals(diagnostic.failure.premise.predicate, {
    kind: "present",
    subject: "name",
    syntaxCategory: "record field",
  });
  const receiver = diagnostic.support.entries.find((entry) =>
    entry.kind === "claim" && entry.claim.kind === "has-type" &&
    entry.claim.subject === "print call result"
  );
  if (!receiver || receiver.kind !== "claim" || receiver.claim.kind !== "has-type") {
    throw new Error("missing receiver type evidence");
  }
  assertEquals(receiver.origin.kind, "source");
  if (receiver.origin.kind === "source") {
    assertEquals(
      source.slice(receiver.origin.span.start, receiver.origin.span.end),
      'print (.{name="test"}:User{name:String})',
    );
  }
  assertEquals(diagnostic.support.edges.some((edge) => edge.from === receiver.id), true);
  const rendered = formatDiagnostic(diagnostic, "scratch3.wm", source);
  assertStringIncludes(rendered, "TYPE CHECKER[record.invalid-projection]");
  assertStringIncludes(rendered, "type Void! has no field name");
  assertStringIncludes(rendered, "print call result: Void!");
  assertStringIncludes(rendered, "-- Origins ");
  assertStringIncludes(rendered, "- use wm err scratch3.wm to see a more detailed error");
  assertEquals(
    diagnostic.support.entries.some((entry) =>
      entry.kind === "claim" && entry.claim.kind === "fact" &&
      entry.claim.subject === "receiver description"
    ),
    false,
  );
  assertEquals(rendered.includes("For JavaScript member access"), false);
  assertEquals(rendered.includes("rule: error"), false);
  assertEquals(rendered.includes("$wm_"), false);
  assertEquals(
    plainText(formatDiagnosticDocument(diagnostic, "scratch3.wm", source)),
    rendered.trimEnd(),
  );
  const inspection = formatDiagnosticInspection(diagnostic, "scratch3.wm", source);
  assertStringIncludes(inspection, "InferRecord.ProjectField");
  assertStringIncludes(inspection, "print call result");
  // Grouping the projection still accepts the original intended program.
  await checkSource('print ((.{name="test"}:User{name:String}).name);');
});

Deno.test("other failed projections use the same authored profile", async () => {
  const source = `record User = { name: String };
let make = () => { User("test") };
let bad = make().missing;`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const rendered = formatDiagnostic(error.diagnostic, "user.wm", source);
  assertEquals(error.diagnostic.code, "record.invalid-projection");
  assertStringIncludes(rendered, "User has no field missing");
  assertStringIncludes(rendered, "make call result: User");
  assertEquals(rendered.includes("$wm_"), false);
});

Deno.test("receiver provenance retains imported binding source locations", async () => {
  const entry = "/test/app/main.wm";
  const imported = "/test/lib/value.wm";
  const value = 'let result = print("test");';
  const source = 'from "../lib/value.wm" import { result };\nlet bad = result.name;';
  const error = await assertRejects(() =>
    checkVirtual(
      entry,
      new Map([
        [entry, source],
        [imported, value],
      ]),
    ), ModuleAnalysisError);
  if (!(error.originalError instanceof FrontendDiagnosticError)) throw error.originalError;
  const diagnostic = error.originalError.diagnostic;
  const rendered = formatDiagnostic(diagnostic, entry, source);
  assertStringIncludes(rendered, "print call result: Void!");
  assertStringIncludes(rendered, "lib/value.wm:1:14");
  assertStringIncludes(rendered, value);
  assertEquals(
    diagnostic.support.sources?.some((item) => item.filePath === imported && item.source === value),
    true,
  );
});

Deno.test("projection origins separate label and type colors and keep cropped carets aligned", async () => {
  const source = 'print (.{name="test"}:User{name:String}).name;';
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const previous = Deno.env.get("COLUMNS");
  try {
    for (const width of [120, 80, 45, 30]) {
      Deno.env.set("COLUMNS", String(width));
      const document = formatDiagnosticDocument(error.diagnostic, "scratch3.wm", source);
      const rendered = plainText(document);
      assertStringIncludes(rendered, "-- Origins ");
      const spans = document.lines.flatMap((line) => line.spans);
      assertEquals(
        spans.filter((part) => part.role === "secondary").map((part) => part.text).join("")
          .includes("print call result:"),
        true,
      );
      assertEquals(spans.filter((part) => part.role === "type").map((part) => part.text), [
        "Void!",
      ]);
      const lines = rendered.split("\n");
      let excerpts = 0;
      for (let index = 0; index < lines.length; index++) {
        if (!/^\s*1\|/.test(lines[index])) continue;
        excerpts++;
        const code = lines[index];
        const caret = lines[index + 1];
        assertEquals(code.length <= width, true, code);
        assertEquals(caret.length <= width, true, caret);
        const first = caret.indexOf("^");
        const last = caret.lastIndexOf("^") + 1;
        assertEquals(first >= code.indexOf("|") + 1 && last <= code.length, true, rendered);
        if (excerpts === 1) assertEquals(code.slice(first, last), "name");
      }
      assertEquals(excerpts, 2, rendered);
    }
  } finally {
    if (previous === undefined) Deno.env.delete("COLUMNS");
    else Deno.env.set("COLUMNS", previous);
  }
});
