import { assertEquals } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { type FrontendV2, loadFrontendV2 } from "../src/frontend_v2_loader.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;
const frontend = await loadFrontendV2(await buildFrontend());

Deno.test("frontend-v2 recovers missing match arm commas as separate artifacts", () => {
  const complete = frontend.parseStructural(
    "let value = match(x) { A => { one }, B => { two } };",
  );
  const missingComma = frontend.parseStructural(
    "let value = match(x) { A => { one } B => { two } };",
  );

  assertEquals(complete.virtualText, complete.concreteText);
  assertEquals(complete.marks, []);
  assertEquals(
    missingComma.virtualText,
    "let value = match(x) { A => { one }, B => { two } };",
  );
  assertEquals(
    missingComma.marks.map((mark) => [mark.code, mark.severity, mark.repairClass]),
    [["parse.match.missing-arm-comma", "warning", "recoveryOnly"]],
  );
  assertEquals(
    missingComma.artifacts.map((artifact) => [artifact.text, artifact.repairClass]),
    [[",", "recoveryOnly"]],
  );
  assertStructuralRecoveryIntegrity(complete);
  assertStructuralRecoveryIntegrity(missingComma);
});

Deno.test("frontend-v2 recovers bare match arm bodies with paired blocks", () => {
  const source = 'let value = match(input) => { Some(x) => x, None => Panic("panic") }';
  const result = frontend.parseStructural(source);

  assertEquals(
    result.virtualText,
    'let value = match(input) => { Some(x) => {x}, None => {Panic("panic")} };',
  );
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    ["{", "}", "{", "}", ";"],
  );
  assertEquals(
    result.marks.map((mark) => [mark.code, mark.repairClass]),
    [
      ["parse.match.missing-arm-body-open-block", "autoFix"],
      ["parse.match.missing-arm-body-close-block", "autoFix"],
      ["parse.match.missing-arm-body-open-block", "autoFix"],
      ["parse.match.missing-arm-body-close-block", "autoFix"],
      ["parse.let.missing-semicolon", "autoFix"],
    ],
  );
  assertEquals(result.marks[0].pairId > 0, true);
  assertEquals(result.marks[0].pairId, result.marks[1].pairId);
  assertEquals(result.marks[2].pairId > 0, true);
  assertEquals(result.marks[2].pairId, result.marks[3].pairId);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 orders recovered match body close before missing comma", () => {
  const source = 'let value = match(input) => { Some(x) => x\n  None => Panic("panic")\n}';
  const result = frontend.parseStructural(source);

  assertEquals(
    result.virtualText,
    'let value = match(input) => { Some(x) => {x},\n  None => {Panic("panic")}\n};',
  );
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    ["{", "}", ",", "{", "}", ";"],
  );
  assertEquals(result.artifacts[1].anchor, result.artifacts[2].anchor);
  assertEquals(result.artifacts[1].order < result.artifacts[2].order, true);
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
