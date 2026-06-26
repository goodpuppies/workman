import { assertEquals } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { type FrontendV2, loadFrontendV2 } from "../src/frontend_v2_loader.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;
const frontend = await loadFrontendV2(await buildFrontend());

Deno.test("frontend-v2 preserves balanced annotated complex patterns", () => {
  const source = "let (first, Some(second)): Pair = value;";
  const result = frontend.parseStructural(source);

  assertEquals(result.virtualText, source);
  assertEquals(result.marks, []);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 closes a tuple pattern before equals", () => {
  const result = frontend.parseStructural("let (first, second = value;");

  assertEquals(result.virtualText, "let (first, second) = value;");
  assertEquals(
    result.marks.map((mark) => mark.code),
    ["parse.pattern.missing-close-paren"],
  );
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    [")"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 closes nested list and constructor patterns in order", () => {
  const result = frontend.parseStructural("let [Some(value = source;");

  assertEquals(result.virtualText, "let [Some(value)] = source;");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    [")", "]"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 closes a damaged pattern before its annotation", () => {
  const result = frontend.parseStructural("let (first, second: Pair = value;");

  assertEquals(result.virtualText, "let (first, second): Pair = value;");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    [")"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 damaged patterns preserve following declarations", () => {
  const result = frontend.parseStructural(
    "let [first, second = value\nlet next = done;",
  );

  assertEquals(
    result.virtualText,
    "let [first, second] = value;\nlet next = done;",
  );
  assertEquals(result.items.map((item) => item.kind), ["let", "let"]);
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    ["]", ";"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 orders a pattern closer before missing required slots at EOF", () => {
  const result = frontend.parseStructural("let (first, second");

  assertEquals(result.virtualText, "let (first, second)=?;");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    [")", "=", "?", ";"],
  );
  assertEquals(
    result.marks.map((mark) => mark.code),
    [
      "parse.pattern.missing-close-paren",
      "parse.let.missing-equals",
      "parse.let.missing-expression",
      "parse.let.missing-semicolon",
    ],
  );
  assertStructuralRecoveryIntegrity(result);
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
