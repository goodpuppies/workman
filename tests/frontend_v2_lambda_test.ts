import { assertEquals } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { type FrontendV2, loadFrontendV2 } from "../src/frontend_v2_loader.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;
const frontend = await loadFrontendV2(await buildFrontend());

Deno.test("frontend-v2 marks bare lambda unit parameters as optional canonical", () => {
  const result = frontend.parseStructural("let main = => print(thing);");

  assertEquals(result.virtualText, "let main = ()=> {print(thing)};");
  assertEquals(
    result.marks.map((mark) => [mark.code, mark.severity, mark.repairClass, mark.hasRepair]),
    [
      ["parse.lambda.optional-unit-params", "hint", "optionalCanonical", false],
      ["parse.lambda.missing-body-open-block", "warning", "autoFix", true],
      ["parse.lambda.missing-body-close-block", "warning", "autoFix", true],
    ],
  );
  assertEquals(
    result.artifacts.map((artifact) => [artifact.anchor, artifact.text, artifact.repairClass]),
    [
      [11, "()", "optionalCanonical"],
      [14, "{", "autoFix"],
      [26, "}", "autoFix"],
    ],
  );
  assertEquals(result.marks[1].pairId, result.marks[2].pairId);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 keeps bare lambda brace and semicolon recovery ordered", () => {
  const result = frontend.parseStructural("let main = => print(thing)");

  assertEquals(result.virtualText, "let main = ()=> {print(thing)};");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    ["()", "{", "}", ";"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 does not wrap an existing bare-arrow lambda block", () => {
  const result = frontend.parseStructural("let main = => { print(thing) };");

  assertEquals(result.virtualText, "let main = ()=> { print(thing) };");
  assertEquals(
    result.marks.map((mark) => mark.code),
    ["parse.lambda.optional-unit-params"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 recovers parameterized lambda bare bodies", () => {
  const result = frontend.parseStructural("let main = (thing) => print(thing);");

  assertEquals(result.virtualText, "let main = (thing) => {print(thing)};");
  assertEquals(
    result.marks.map((mark) => [mark.code, mark.repairClass]),
    [
      ["parse.lambda.missing-body-open-block", "autoFix"],
      ["parse.lambda.missing-body-close-block", "autoFix"],
    ],
  );
  assertEquals(result.marks[0].pairId, result.marks[1].pairId);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 preserves parameterized lambda blocks", () => {
  const source = "let main = (thing) => { print(thing) };";
  const result = frontend.parseStructural(source);

  assertEquals(result.virtualText, source);
  assertEquals(result.marks, []);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 recovers a missing parameterized lambda body as an empty block", () => {
  const result = frontend.parseStructural("let main = (thing) =>;");

  assertEquals(result.virtualText, "let main = (thing) =>{};");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    ["{", "}"],
  );
  assertEquals(result.artifacts[0].anchor, result.artifacts[1].anchor);
  assertEquals(result.artifacts[0].order < result.artifacts[1].order, true);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 recovers lifted lambda bare bodies", () => {
  const result = frontend.parseStructural("let fetch = lift Task (url) => fetchUrl(url);");

  assertEquals(
    result.virtualText,
    "let fetch = lift Task (url) => {fetchUrl(url)};",
  );
  assertEquals(
    result.marks.map((mark) => mark.code),
    ["parse.lambda.missing-body-open-block", "parse.lambda.missing-body-close-block"],
  );
  assertEquals(result.marks[0].pairId, result.marks[1].pairId);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 preserves lifted lambda blocks", () => {
  const source = "let fetch = lift Task (url) => { fetchUrl(url) };";
  const result = frontend.parseStructural(source);

  assertEquals(result.virtualText, source);
  assertEquals(result.marks, []);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 leaves non-lambda lift applications unchanged", () => {
  const source = "let value = lift Result sin(value);";
  const result = frontend.parseStructural(source);

  assertEquals(result.virtualText, source);
  assertEquals(result.marks, []);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 preserves carrier lifts and pipelines as shallow expressions", () => {
  const carrierLift = "let combined = Task|first, second|;";
  const pipeline = "let output = source :> transform :> finish;";

  for (const source of [carrierLift, pipeline]) {
    const result = frontend.parseStructural(source);
    assertEquals(result.virtualText, source);
    assertEquals(result.marks, []);
    assertStructuralRecoveryIntegrity(result);
  }
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
