import { assertEquals } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { type FrontendV2, loadFrontendV2 } from "../src/frontend_v2_loader.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;
const frontend = await loadFrontendV2(await buildFrontend());

Deno.test("frontend-v2 complete top-level construct goldens render losslessly", () => {
  const cases = [
    {
      name: "workman import",
      source: 'from "./dep.wm" import { Thing };',
      itemKinds: ["import"],
    },
    {
      name: "javascript import",
      source: 'from js.module("./dep.mjs") import unsafe { thing };',
      itemKinds: ["import"],
    },
    {
      name: "let declaration",
      source: "let value = make([one, two]).field;",
      itemKinds: ["let"],
    },
    {
      name: "type declaration",
      source: "type Maybe<T> = Nothing | Some<T>;",
      itemKinds: ["type"],
    },
    {
      name: "record declaration",
      source: "record Point = { x: Number, y: Number };",
      itemKinds: ["record"],
    },
  ];

  for (const entry of cases) {
    const result = frontend.parseStructural(entry.source);
    assertEquals(result.virtualText, entry.source, entry.name);
    assertEquals(result.marks, [], entry.name);
    assertEquals(result.items.map((item) => item.kind), entry.itemKinds, entry.name);
    assertStructuralRecoveryIntegrity(result);
  }
});

Deno.test("frontend-v2 complete expression construct goldens render losslessly", () => {
  const sources = [
    "let lambda = (value) => { value };",
    "let lifted = lift Task (url) => { fetch(url) };",
    "let branch = if (ready) { yes } else { no };",
    "let choice = match(input) { Some(value) => { value }, None => { fallback } };",
    "let tuple = (left, right);",
    "let list = [one, two, three];",
    "let recValue = { name: value, count: total };",
    'let jsonObject = JSON{status: 200, message: "ok"};',
    'let jsonArray = JSON[repo.full_name, "stars", repo.stargazers_count];',
    "let piped = source :> transform :> finish;",
  ];

  for (const source of sources) {
    const result = frontend.parseStructural(source);
    assertEquals(result.virtualText, source);
    assertEquals(result.marks, []);
    assertEquals(result.items.map((item) => item.kind), ["let"]);
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
