import { assertEquals } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { type FrontendV2, loadFrontendV2 } from "../src/frontend_v2_loader.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;
const frontend = await loadFrontendV2(await buildFrontend());

Deno.test("frontend-v2 preserves balanced expression delimiters", () => {
  const source = "let value = make([one, two]);";
  const result = frontend.parseStructural(source);

  assertEquals(result.virtualText, source);
  assertEquals(result.marks, []);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 closes nested expression delimiters at EOF", () => {
  const result = frontend.parseStructural("let value = make([one");

  assertEquals(result.virtualText, "let value = make([one]);");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    ["]", ")", ";"],
  );
  assertEquals(
    result.marks.map((mark) => mark.code),
    [
      "parse.expression.missing-close-bracket",
      "parse.expression.missing-close-paren",
      "parse.let.missing-semicolon",
    ],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 closes grouping delimiters before a concrete top-level semicolon", () => {
  const result = frontend.parseStructural("let value = make([one;");

  assertEquals(result.virtualText, "let value = make([one]);");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    ["]", ")"],
  );
  assertEquals(
    result.marks.map((mark) => mark.code),
    [
      "parse.expression.missing-close-bracket",
      "parse.expression.missing-close-paren",
    ],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 unmatched grouping delimiters do not swallow the next declaration", () => {
  const result = frontend.parseStructural(
    "let value = make([one\nlet next = done;",
  );

  assertEquals(
    result.virtualText,
    "let value = make([one]);\nlet next = done;",
  );
  assertEquals(result.items.map((item) => item.kind), ["let", "let"]);
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    ["]", ")", ";"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 orders a call closer before a recovered lambda block closer", () => {
  const result = frontend.parseStructural("let main = (x) => call(x");

  assertEquals(result.virtualText, "let main = (x) => {call(x)};");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    ["{", ")", "}", ";"],
  );
  assertEquals(result.artifacts[1].anchor, result.artifacts[2].anchor);
  assertEquals(result.artifacts[1].order < result.artifacts[2].order, true);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 orders a call closer before a recovered if branch closer", () => {
  const result = frontend.parseStructural("let choose = if (ready) call(x");

  assertEquals(result.virtualText, "let choose = if (ready) {call(x)};");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    ["{", ")", "}", ";"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 closes an authored lambda block without adding another block", () => {
  const result = frontend.parseStructural("let main = (x) => { call(x)");

  assertEquals(result.virtualText, "let main = (x) => { call(x)};");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    ["}", ";"],
  );
  assertEquals(
    result.marks.map((mark) => mark.code),
    ["parse.expression.missing-close-brace", "parse.let.missing-semicolon"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 closes damaged JSON expression delimiters", () => {
  const object = frontend.parseStructural('let response = JSON{status: 200, body: JSON["ok"');
  const array = frontend.parseStructural("let values = JSON[one, JSON{two: three");

  assertEquals(object.virtualText, 'let response = JSON{status: 200, body: JSON["ok"]};');
  assertEquals(
    object.artifacts.map((artifact) => artifact.text),
    ["]", "}", ";"],
  );
  assertEquals(array.virtualText, "let values = JSON[one, JSON{two: three}];");
  assertEquals(
    array.artifacts.map((artifact) => artifact.text),
    ["}", "]", ";"],
  );
  assertStructuralRecoveryIntegrity(object);
  assertStructuralRecoveryIntegrity(array);
});

function assertStructuralRecoveryIntegrity(
  result: ReturnType<FrontendV2["parseStructural"]>,
): void {
  const markIds = result.marks.map((mark) => mark.id);
  assertEquals(new Set(markIds).size, markIds.length);
  assertEquals(
    result.artifacts.every((artifact) => markIds.includes(artifact.recoveryId)),
    true,
  );
  let cursor = 0;
  let rebuilt = "";
  for (const artifact of result.artifacts) {
    rebuilt += result.concreteText.slice(cursor, artifact.anchor) + artifact.text;
    cursor = artifact.anchor;
  }
  rebuilt += result.concreteText.slice(cursor);
  assertEquals(rebuilt, result.virtualText);
  for (let index = 1; index < result.artifacts.length; index += 1) {
    const previous = result.artifacts[index - 1];
    const current = result.artifacts[index];
    assertEquals(previous.anchor <= current.anchor, true);
    if (previous.anchor === current.anchor) {
      assertEquals(previous.order < current.order, true);
    }
  }
}

async function buildFrontend(): Promise<URL> {
  const output = (await Deno.makeTempDir()) + "/frontend-v2.mjs";
  await Deno.writeTextFile(output, await compileLibraryFile(frontendSource));
  return new URL("file://" + output);
}
