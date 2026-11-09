import { assertEquals, assertStringIncludes } from "@std/assert";
import { hoverAt } from "../src/lsp/hover.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";
import { offsetToLineCol } from "../src/source.ts";
import { ProjectIndex } from "../src/lsp/project_index.ts";
import { SemanticService } from "../src/lsp/semantic_service.ts";

async function withDocument(source: string, run: (uri: string, path: string) => Promise<void>) {
  const path = await Deno.makeTempFile({ suffix: ".wm" });
  try {
    await Deno.writeTextFile(path, source);
    await run(pathToFileUri(path), path);
  } finally {
    await Deno.remove(path);
  }
}

function position(source: string, text: string) {
  const at = offsetToLineCol(source, source.indexOf(text));
  return { line: at.line - 1, character: at.col };
}

Deno.test("WON hover explains tags and properties using authored syntax", async () => {
  const source = `let view = WON[main[button<onClick = Action("increment")>("Add one")]];`;
  await withDocument(source, async (uri) => {
    const tag = await hoverAt(uri, position(source, "button"), new Map());
    assertStringIncludes(tag!.contents.value, "**WON tag**");
    assertStringIncludes(tag!.contents.value, "onClick");
    assertStringIncludes(tag!.contents.value, "Payload: text");
    assertStringIncludes(tag!.contents.value, "Containing tag: ` main `");
    assertEquals(tag!.range?.end.character! - tag!.range?.start.character!, 6);
    const property = await hoverAt(uri, position(source, "onClick"), new Map());
    assertStringIncludes(property!.contents.value, "**WON property**");
    assertStringIncludes(property!.contents.value, "Value: tag Action");
    assertStringIncludes(property!.contents.value, "Containing tag: ` button `");
    assertEquals(property!.contents.value.includes("$wonLiteral"), false);
    const action = await hoverAt(uri, position(source, "Action"), new Map());
    assertStringIncludes(action!.contents.value, "interpreted by the consumer");
    assertEquals(action!.contents.value.includes("MouseEvent"), false);
  });
});

Deno.test("WON hover explains literal containers and exact scalar storage", async () => {
  const source = String
    .raw`let config = WON{title = "🌍\n" step = 1E+00 blob = x"00ff" enabled = true empty = null};`;
  await withDocument(source, async (uri) => {
    for (
      const [target, expected] of [
        ["WON", "WON record literal"],
        ["{title", "5 properties"],
        ['"🌍', "5 bytes of UTF-8 text"],
        ["1E+00", "exact number spelling"],
        ['x"00ff"', "2 bytes"],
        ["true", "WON boolean"],
        ["null", "WON null"],
      ]
    ) {
      const hover = await hoverAt(uri, position(source, target), new Map());
      assertStringIncludes(hover!.contents.value, expected);
      assertStringIncludes(hover!.contents.value, "basis/won_value.wm.Value");
    }
  });
});

Deno.test("WON hover uses unsaved source and leaves ordinary WM and comments alone", async () => {
  const saved = "let view = WON[Old];";
  const changed =
    'let count = 3; let text = "WON[Fake]"; let view = WON[/* comment */ New<value = 2>["hi"]];';
  await withDocument(saved, async (uri, path) => {
    const overrides = new Map([[path, changed]]);
    const hover = await hoverAt(uri, position(changed, "New"), overrides);
    assertStringIncludes(hover!.contents.value, "WON tag");
    assertStringIncludes(hover!.contents.value, "New");
    const ordinary = await hoverAt(uri, position(changed, "count"), overrides);
    assertStringIncludes(ordinary!.contents.value, "Number");
    const fake = await hoverAt(uri, position(changed, "Fake"), overrides);
    assertEquals(fake?.contents.value.includes("**WON tag**") ?? false, false);
    const comment = await hoverAt(uri, position(changed, "comment"), overrides);
    assertEquals(comment, null);
  });
});

Deno.test("WON hover escapes Markdown fences from literal text", async () => {
  const source = 'let view = WON["```hello"];';
  await withDocument(source, async (uri) => {
    const hover = await hoverAt(uri, position(source, '"```'), new Map());
    assertStringIncludes(hover!.contents.value, "````won\n");
    assertStringIncludes(hover!.contents.value, "**WON text**");
  });
});

Deno.test("WON hover refreshes compiler-owned facts in the live semantic service", async () => {
  const saved = "let view = WON[Old];";
  const changed = "let view = WON[New<step = 2>];";
  await withDocument(saved, async (uri, path) => {
    const overrides = new Map<string, string>();
    const index = new ProjectIndex();
    await index.refreshFile(path, overrides);
    const service = new SemanticService(index.discovery, {
      sourceOverrides: () => overrides,
      frontendOptions: () => ({}),
    });
    const before = await hoverAt(uri, position(saved, "Old"), overrides, {}, service);
    assertStringIncludes(before!.contents.value, "Old");
    const context = await service.documentContext(uri);
    assertEquals(Object.isFrozen(context!.moduleInterface.wonLiterals), true);
    overrides.set(path, changed);
    await index.refreshFile(path, overrides);
    await service.invalidatePaths([path]);
    const after = await hoverAt(uri, position(changed, "New"), overrides, {}, service);
    assertStringIncludes(after!.contents.value, "New");
    assertStringIncludes(after!.contents.value, "step");
  });
});
