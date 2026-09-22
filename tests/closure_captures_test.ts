import { assertEquals } from "@std/assert";
import { resolveModuleBindingFacts } from "../src/binding_facts.ts";
import { parseCompilerModule } from "../src/compiler_frontend.ts";
import { analyzeDetachedVirtual } from "../src/compiler.ts";
import { formatFrontendV2Source } from "../src/frontend_v2_formatter.ts";
import { CompilerIdAllocator } from "../src/ids.ts";
import { semanticInlayHints } from "../src/lsp/type_inlays.ts";
import { hoverAt } from "../src/lsp/hover.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";
import { moduleId } from "../src/module_id.ts";

Deno.test("lambda capture clauses survive parsing and formatting", async () => {
  const source = "let make=(x)=>{(y): Number |x|=>{x+y}};";
  const module = await parseCompilerModule(source, { frontend: "v2" });
  const outer = module.decls[0].kind === "LetDecl" ? module.decls[0].bindings[0].value : undefined;
  const inner = outer?.kind === "Lambda" && outer.body.kind === "Block"
    ? outer.body.result
    : undefined;

  assertEquals(inner?.kind, "Lambda");
  assertEquals(inner?.kind === "Lambda" ? inner.captureClause?.names : undefined, ["x"]);
  assertEquals(
    await formatFrontendV2Source(source),
    [
      "let make = (x) => {",
      "  (y): Number |x| => {",
      "    x + y",
      "  }",
      "};",
    ].join("\n"),
  );
});

Deno.test("explicit capture clauses are complete binding-identity contracts", async () => {
  const source = [
    "let make = (x) => {",
    "  let z = 1;",
    "  (y) |x| => { x + y + z }",
    "};",
  ].join("\n");
  const module = await parseCompilerModule(source, { frontend: "v2" });
  const facts = resolveModuleBindingFacts(module, new CompilerIdAllocator());

  assertEquals(
    [...facts.closureCaptures.values()].map((captures) => captures.map(({ name }) => name)),
    [["x", "z"], []],
  );
  assertEquals(facts.captureDiagnostics.map(({ code, severity }) => [code, severity]), [
    ["capture.unlisted", "error"],
  ]);
});

Deno.test("an authored empty capture clause requires a captureless lambda", async () => {
  const source = "let make = (x) => { (y) || => { x + y } };";
  const module = await parseCompilerModule(source, { frontend: "v2" });
  const facts = resolveModuleBindingFacts(module, new CompilerIdAllocator());

  assertEquals(facts.captureDiagnostics.map(({ code }) => code), ["capture.unlisted"]);
});

Deno.test("module let values may be captured explicitly", async () => {
  const source =
    "let enabled = true; let check = (input: Bool): Bool |enabled| => { input && enabled };";
  const module = await parseCompilerModule(source, { frontend: "v2" });
  const facts = resolveModuleBindingFacts(module, new CompilerIdAllocator());

  assertEquals(
    [...facts.closureCaptures.values()].map((captures) => captures.map(({ name }) => name)),
    [
      ["enabled"],
    ],
  );
  assertEquals(facts.captureDiagnostics, []);
});

Deno.test("omitted capture clauses produce lambda-head inlays", async () => {
  const path = "/test/main.wm";
  const source = "let make = (x: Number) => { (y: Number) => { x + y } };";
  const hints = await semanticInlayHints(
    pathToFileUri(path),
    {
      start: { line: 0, character: 0 },
      end: { line: 0, character: source.length },
    },
    new Map([[path, source]]),
  );
  const captureHints = hints.filter((hint) => hint.data.kind === "workman.inferred-captures");

  assertEquals(captureHints.map(({ label, position }) => ({ label, position })), [{
    label: "|x|",
    position: { line: 0, character: source.indexOf("=>", source.indexOf("y: Number")) },
  }]);
});

Deno.test("authored capture clauses suppress inferred capture inlays", async () => {
  const path = "/test/main.wm";
  const source = "let make = (x: Number) => { (y: Number) |x| => { x + y } };";
  const hints = await semanticInlayHints(
    pathToFileUri(path),
    {
      start: { line: 0, character: 0 },
      end: { line: 0, character: source.length },
    },
    new Map([[path, source]]),
  );

  assertEquals(hints.some((hint) => hint.data.kind === "workman.inferred-captures"), false);
});

Deno.test("authored capture names retain semantic binding identity", async () => {
  const path = "/test/main.wm";
  const source = "let make = (x: Number) => { (y: Number) |x| => { x + y } };";
  const snapshot = await analyzeDetachedVirtual(path, new Map([[path, source]]));
  const occurrences = snapshot.interfaces.get(moduleId(path))!.occurrences
    .filter((occurrence) => occurrence.name === "x");

  assertEquals(occurrences.map(({ role, span }) => [role, span.start]), [
    ["declaration", source.indexOf("x: Number")],
    ["reference", source.indexOf("|x|") + 1],
    ["reference", source.lastIndexOf("x + y")],
  ]);
  assertEquals(occurrences[0].target, occurrences[1].target);
});

Deno.test("function-name hover includes its closure capture contract", async () => {
  const path = "/test/main.wm";
  const source = [
    "let enabled = true;",
    "let check = (input: Bool): Bool => { input && enabled };",
    "let result = check(false);",
  ].join("\n");
  const overrides = new Map([[path, source]]);

  const declaration = await hoverAt(
    pathToFileUri(path),
    { line: 1, character: "let ".length },
    overrides,
  );
  const reference = await hoverAt(
    pathToFileUri(path),
    { line: 2, character: "let result = ".length },
    overrides,
  );

  assertEquals(declaration?.contents.value, "```wm\ncheck: Bool -> Bool |enabled|\n```");
  assertEquals(reference?.contents.value, "```wm\ncheck: Bool -> Bool |enabled|\n```");
});

Deno.test("lambda result and capture inlays have independent truncation budgets", async () => {
  const path = "/test/main.wm";
  const source = [
    "let firstLongCaptureName = 1;",
    "let secondLongCaptureName = 2;",
    "let thirdLongCaptureName = 3;",
    "let make = () => { () => {",
    "  (firstLongCaptureName, secondLongCaptureName, thirdLongCaptureName)",
    "} };",
  ].join("\n");
  const hints = await semanticInlayHints(
    pathToFileUri(path),
    {
      start: { line: 0, character: 0 },
      end: { line: 5, character: source.split("\n")[5].length },
    },
    new Map([[path, source]]),
  );
  const lambdaHeadHints = hints.filter((hint) =>
    hint.data.kind === "workman.inferred-captures" ||
    (hint.data.kind === "workman.inferred-type" && hint.data.category === "result")
  );

  assertEquals(lambdaHeadHints.every((hint) => hint.label.length <= 24), true);
  assertEquals(
    lambdaHeadHints.some((hint) =>
      hint.data.kind === "workman.inferred-type" && hint.label.endsWith("...")
    ),
    true,
  );
  assertEquals(
    lambdaHeadHints.some((hint) =>
      hint.data.kind === "workman.inferred-captures" && hint.label.endsWith("...")
    ),
    true,
  );
});
