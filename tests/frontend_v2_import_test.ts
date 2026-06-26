import { assertEquals } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { type FrontendV2, loadFrontendV2 } from "../src/frontend_v2_loader.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;
const frontend = await loadFrontendV2(await buildFrontend());

Deno.test("frontend-v2 preserves complete Workman and JavaScript imports", () => {
  const source =
    'from "./dep.wm" import { Thing };\nfrom js.global("console") import unsafe { log };';
  const result = frontend.parseStructural(source);

  assertEquals(result.virtualText, source);
  assertEquals(result.marks, []);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 recovers a missing import source", () => {
  const result = frontend.parseStructural("from import { Thing };");

  assertEquals(result.virtualText, 'from "" import { Thing };');
  assertEquals(
    result.marks.map((mark) => mark.code),
    ["parse.import.missing-source"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 recovers a missing import keyword", () => {
  const result = frontend.parseStructural('from "./dep.wm" { Thing };');

  assertEquals(result.virtualText, 'from "./dep.wm" import  { Thing };');
  assertEquals(
    result.marks.map((mark) => mark.code),
    ["parse.import.missing-keyword"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 recovers a missing import clause", () => {
  const result = frontend.parseStructural('from "./dep.wm" import;');

  assertEquals(result.virtualText, 'from "./dep.wm" import {};');
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    [" {", "}"],
  );
  assertEquals(result.marks[0].pairId, result.marks[1].pairId);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 closes an incomplete named import clause", () => {
  const result = frontend.parseStructural('from "./dep.wm" import { Thing;');

  assertEquals(result.virtualText, 'from "./dep.wm" import { Thing};');
  assertEquals(
    result.marks.map((mark) => mark.code),
    ["parse.import.missing-clause-close-brace"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 recovers JavaScript namespace aliases", () => {
  const result = frontend.parseStructural("from js.global import *;");

  assertEquals(result.virtualText, "from js.global import * as _;");
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    [" as ", "_"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 closes incomplete JavaScript import targets before import", () => {
  const result = frontend.parseStructural('from js.global("Deno" import *;');

  assertEquals(result.virtualText, 'from js.global("Deno") import * as _;');
  assertEquals(
    result.marks.map((mark) => mark.code),
    [
      "parse.import.missing-target-close-paren",
      "parse.import.missing-as",
      "parse.import.missing-alias",
    ],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 closes incomplete JavaScript import targets at EOF", () => {
  const result = frontend.parseStructural('from js.module("./dep.wm"');

  assertEquals(result.virtualText, 'from js.module("./dep.wm") import  {};');
  assertEquals(
    result.artifacts.map((artifact) => artifact.text),
    [")", " import ", " {", "}", ";"],
  );
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 allows Workman wildcard imports without aliases", () => {
  const source = 'from "./dep.wm" import *;';
  const result = frontend.parseStructural(source);

  assertEquals(result.virtualText, source);
  assertEquals(result.marks, []);
  assertStructuralRecoveryIntegrity(result);
});

Deno.test("frontend-v2 ports Workmangr import inlay regressions", () => {
  const workmanWildcard = 'from "std/list" import * as List;\nlet x = 1;';
  const cHeaderWildcard = 'from "errno.h" import * as Errno;\nlet x = 1;';

  for (const source of [workmanWildcard, cHeaderWildcard]) {
    const result = frontend.parseStructural(source);
    assertEquals(result.virtualText, source);
    assertEquals(result.marks, []);
    assertEquals(result.artifacts, []);
    assertStructuralRecoveryIntegrity(result);
  }
});

Deno.test("frontend-v2 incomplete imports preserve following declarations", () => {
  const result = frontend.parseStructural(
    'from "./dep.wm" import { Thing\nlet next = done;',
  );

  assertEquals(
    result.virtualText,
    'from "./dep.wm" import { Thing};\nlet next = done;',
  );
  assertEquals(result.items.map((item) => item.kind), ["import", "let"]);
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
