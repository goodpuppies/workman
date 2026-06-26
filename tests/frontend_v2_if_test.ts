import { assertEquals } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { type FrontendV2, loadFrontendV2 } from "../src/frontend_v2_loader.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;
const frontend = await loadFrontendV2(await buildFrontend());

Deno.test("frontend-v2 preserves complete if branch blocks", () => {
  const source = "let choose = if (ready) { yes } else { no };";
  const result = frontend.parseStructural(source);

  assertEquals(result.virtualText, source);
  assertEquals(result.marks, []);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 recovers bare then and else branches independently", () => {
  const result = frontend.parseStructural("let choose = if (ready) yes else no;");

  assertEquals(result.virtualText, "let choose = if (ready) {yes} else {no};");
  assertEquals(
    result.marks.map((mark) => [mark.code, mark.repairClass]),
    [
      ["parse.if.missing-then-open-block", "autoFix"],
      ["parse.if.missing-then-close-block", "autoFix"],
      ["parse.if.missing-else-open-block", "autoFix"],
      ["parse.if.missing-else-close-block", "autoFix"],
    ],
  );
  assertEquals(result.marks[0].pairId, result.marks[1].pairId);
  assertEquals(result.marks[2].pairId, result.marks[3].pairId);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 recovers only a bare else branch", () => {
  const result = frontend.parseStructural("let choose = if (ready) { yes } else no;");

  assertEquals(result.virtualText, "let choose = if (ready) { yes } else {no};");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    ["{", "}"],
  );
  assertEquals(
    result.marks.map((mark) => mark.code),
    ["parse.if.missing-else-open-block", "parse.if.missing-else-close-block"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 recovers only a bare then branch", () => {
  const result = frontend.parseStructural("let choose = if (ready) yes else { no };");

  assertEquals(result.virtualText, "let choose = if (ready) {yes} else { no };");
  assertEquals(
    result.marks.map((mark) => mark.code),
    ["parse.if.missing-then-open-block", "parse.if.missing-then-close-block"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 recovers a missing then branch as an empty block", () => {
  const result = frontend.parseStructural("let choose = if (ready) else no;");

  assertEquals(result.virtualText, "let choose = if (ready){} else {no};");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    ["{", "}", "{", "}"],
  );
  assertEquals(result.artifacts[0].anchor, result.artifacts[1].anchor);
  assertEquals(result.artifacts[0].order < result.artifacts[1].order, true);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 recovers a bare then branch without else", () => {
  const result = frontend.parseStructural("let choose = if (ready) yes;");

  assertEquals(result.virtualText, "let choose = if (ready) {yes};");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    ["{", "}"],
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
