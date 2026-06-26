import { assertEquals } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { type FrontendV2, loadFrontendV2 } from "../src/frontend_v2_loader.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;
const frontend = await loadFrontendV2(await buildFrontend());

Deno.test("frontend-v2 preserves complete type and record declarations", () => {
  const source = "type Maybe<T> = Nothing | Some<T>;\nrecord Point = { x: Number, y: Number };";
  const result = frontend.parseStructural(source);

  assertEquals(result.virtualText, source);
  assertEquals(result.marks, []);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 recovers missing type declaration slots", () => {
  const missingName = frontend.parseStructural("type = Number;");
  const missingEquals = frontend.parseStructural("type Maybe Number;");
  const missingBody = frontend.parseStructural("type Maybe =;");

  assertEquals(missingName.virtualText, "type _= Number;");
  assertEquals(missingName.artifacts.map((artifact) => artifact.text), ["_"]);
  assertEquals(missingEquals.virtualText, "type Maybe= Number;");
  assertEquals(missingEquals.artifacts.map((artifact) => artifact.text), ["="]);
  assertEquals(missingBody.virtualText, "type Maybe =?;");
  assertEquals(missingBody.artifacts.map((artifact) => artifact.text), ["?"]);
  assertStructuralRecoveryIntegrity(missingName);
  assertStructuralRecoveryIntegrity(missingEquals);
  assertStructuralRecoveryIntegrity(missingBody);
});

Deno.test("frontend-v2 closes type parameters before equals", () => {
  const result = frontend.parseStructural("type Maybe<T = T;");

  assertEquals(result.virtualText, "type Maybe<T> = T;");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    [">"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 closes nested type applications before a concrete semicolon", () => {
  const result = frontend.parseStructural("type Value = List<Result<T, E;");

  assertEquals(result.virtualText, "type Value = List<Result<T, E>>;");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    [">", ">"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 recovers missing record bodies and authored body closers", () => {
  const missingBody = frontend.parseStructural("record Point =;");
  const missingClose = frontend.parseStructural("record Point = { x: Number;");

  assertEquals(missingBody.virtualText, "record Point ={};");
  assertEquals(
    missingBody.artifacts.map((artifact) => artifact.text),
    ["{", "}"],
  );
  assertEquals(missingBody.marks[0].pairId, missingBody.marks[1].pairId);
  assertEquals(missingClose.virtualText, "record Point = { x: Number};");
  assertEquals(
    missingClose.artifacts.map((artifact) => artifact.text),
    ["}"],
  );
  assertStructuralRecoveryIntegrity(missingBody);
  assertStructuralRecoveryIntegrity(missingClose);
});

Deno.test("frontend-v2 incomplete type declarations preserve following declarations", () => {
  const result = frontend.parseStructural(
    "type Value = List<Result<T, E\nlet next = done;",
  );

  assertEquals(
    result.virtualText,
    "type Value = List<Result<T, E>>;\nlet next = done;",
  );
  assertEquals(result.items.map((item) => item.kind), ["type", "let"]);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 orders all missing type slots at EOF", () => {
  const result = frontend.parseStructural("type");

  assertEquals(result.virtualText, "type_=?;");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    ["_", "=", "?", ";"],
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
