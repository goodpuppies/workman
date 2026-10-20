import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource, checkVirtual, ModuleAnalysisError } from "../src/compiler.ts";
import {
  formatDiagnostic,
  formatDiagnosticInspection,
  FrontendDiagnosticError,
} from "../src/diagnostics.ts";
import { expectBinding } from "./type_helpers.ts";
import { validateUri } from "../src/lsp/validation.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";

Deno.test("an unannotated incomplete literal identifies the unique containing record", async () => {
  const source = `record Point = {
  x: Number,
  y: Number,
  z: Number,
};
let point = .{ x = 1 };`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  assertEquals(error.diagnostic.code, "record.missing-fields");
  assertEquals(error.diagnostic.failure.premise.predicate.kind, "well-formed");
  const rendered = formatDiagnostic(error.diagnostic, "app/point.wm", source);
  assertStringIncludes(rendered, "record literal for Point has missing fields: y, z");
  assertStringIncludes(rendered, "Point requires field y");
  assertStringIncludes(rendered, "Point requires field z");
  assertStringIncludes(rendered, "app/point.wm:3:3");
  assertStringIncludes(rendered, "app/point.wm:4:3");
  assertStringIncludes(rendered, "app/point.wm:6:13");
});

Deno.test("incomplete literals with several containing records do not pick a type", async () => {
  for (
    const declarations of [
      "record Point = { x: Number, y: Number }; record Label = { x: Number, title: String };",
      "record Label = { x: Number, title: String }; record Point = { x: Number, y: Number };",
    ]
  ) {
    const source = `${declarations}\nlet value = .{ x = 1 };`;
    const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
    assertEquals(error.diagnostic.code, "record.ambiguous-incomplete");
    const rendered = formatDiagnostic(error.diagnostic, "app/main.wm", source);
    assertStringIncludes(rendered, "multiple record types contain its fields");
    assertStringIncludes(rendered, "Point requires field y");
    assertStringIncludes(rendered, "Label requires field title");
    assertEquals(rendered.includes("using first"), false);
  }
});

Deno.test("an exact literal match wins over incomplete containing records", async () => {
  const result = await checkSource(`
record Point = { x: Number, y: Number };
record Scalar = { x: Number };
let value = .{ x = 1 };`);
  expectBinding(result.env, "value", { type: "Scalar", vars: 0 });
  assertEquals(result.diagnostics, []);
});

Deno.test("explicit, annotated, and spread literals share field-set diagnostics", async () => {
  for (const literal of ["let p = Point{ x = 1 };", "let p: Point = .{ x = 1 };"]) {
    const source = `record Point = { x: Number, y: Number };\n${literal}`;
    const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
    assertEquals(error.diagnostic.code, "record.missing-fields");
    assertStringIncludes(
      formatDiagnostic(error.diagnostic, "point.wm", source),
      "missing fields: y",
    );
  }
  for (
    const literal of [
      "let p: Point = .{ x = 1, y = 2, other = true };",
      "let p = Point{ x = 1, y = 2, other = true };",
      "let p = .{ ..Point(1, 2), other = true };",
    ]
  ) {
    const source = `record Point = { x: Number, y: Number };\n${literal}`;
    const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
    assertEquals(error.diagnostic.code, "record.unknown-fields");
    const rendered = formatDiagnostic(error.diagnostic, "point.wm", source);
    assertStringIncludes(rendered, "unknown fields: other");
    assertEquals(rendered.includes("missing fields:"), false);
  }
  const source = "record Point = { x: Number, y: Number }; let p = Point{ x = 1, other = 2 };";
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  assertEquals(error.diagnostic.code, "record.field-set-mismatch");
  assertStringIncludes(
    formatDiagnostic(error.diagnostic, "point.wm", source),
    "missing fields: y; unknown fields: other",
  );
});

Deno.test("unmatched literals report their fields without suggesting unrelated records", async () => {
  const source = "-- @no-prelude\nrecord Point = { x: Number }; let p = .{ absent = 1 };";
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  assertEquals(error.diagnostic.code, "record.no-matching-type");
  const rendered = formatDiagnostic(error.diagnostic, "point.wm", source);
  assertStringIncludes(rendered, "no record type matches these fields: absent");
  assertEquals(rendered.includes("Point requires"), false);
});

Deno.test("empty literals retain exact matching and honest incomplete candidates", async () => {
  const result = await checkSource("-- @no-prelude\nrecord Empty = {}; let empty = .{};");
  expectBinding(result.env, "empty", { type: "Empty", vars: 0 });
  const source = "-- @no-prelude\nrecord Point = { x: Number }; let p = .{};";
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  assertEquals(error.diagnostic.code, "record.missing-fields");
  assertStringIncludes(formatDiagnostic(error.diagnostic, "point.wm", source), "missing fields: x");
});

Deno.test("missing-field evidence keeps imported declaration locations at narrow widths", async () => {
  const root = Deno.cwd();
  const entry = `${root}/app/main.wm`;
  const recordPath = `${root}/proto/point.wm`;
  const recordSource = `record Point = {
  x: Number,
  y: Number,
};`;
  const source = 'from "../proto/point.wm" import { Point };\nlet point = .{ x = 1 };';
  const error = await assertRejects(
    () => checkVirtual(entry, new Map([[entry, source], [recordPath, recordSource]])),
    ModuleAnalysisError,
  );
  if (!(error.originalError instanceof FrontendDiagnosticError)) throw error.originalError;
  const diagnostic = error.originalError.diagnostic;
  assertEquals(diagnostic.code, "record.missing-fields");
  const previousColumns = Deno.env.get("COLUMNS");
  try {
    for (const width of [120, 40]) {
      Deno.env.set("COLUMNS", String(width));
      const rendered = formatDiagnostic(diagnostic, entry, source);
      assertStringIncludes(rendered, "app/main.wm:2:13");
      assertStringIncludes(rendered, "proto/point.wm:3:3");
      assertStringIncludes(rendered, "Point requires field y");
      assertStringIncludes(rendered, "y: Number");
      assertEquals(rendered.includes(root), false);
    }
    const inspection = formatDiagnosticInspection(diagnostic, entry, source);
    assertStringIncludes(inspection, "Point requires field y");
    assertStringIncludes(inspection, "proto/point.wm");
  } finally {
    if (previousColumns === undefined) Deno.env.delete("COLUMNS");
    else Deno.env.set("COLUMNS", previousColumns);
  }
});

Deno.test("LSP missing-field references point into the declaring module", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const entry = `${directory}/main.wm`;
    const library = `${directory}/point.wm`;
    const recordSource = "record Point = {\n  x: Number,\n  y: Number,\n};";
    await Deno.writeTextFile(library, recordSource);
    await Deno.writeTextFile(entry, 'from "./point.wm" import { Point };\nlet p = .{ x = 1 };');
    const uri = pathToFileUri(entry);
    const results = await validateUri(uri, new Map());
    const diagnostic = results.find((result) => result.uri === uri)?.diagnostics.find((item) =>
      item.code === "record.missing-fields"
    );
    assertEquals(diagnostic?.range.start, { line: 1, character: 8 });
    const requirement = diagnostic?.relatedInformation?.find((item) =>
      item.message === "Point requires field y"
    );
    assertEquals(requirement?.location.uri, pathToFileUri(library));
    assertEquals(requirement?.location.range.start, { line: 2, character: 2 });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
