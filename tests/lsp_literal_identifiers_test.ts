import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { completionAt } from "../src/lsp/completion.ts";
import { hoverAt } from "../src/lsp/hover.ts";
import { prepareRenameAt, renameAt } from "../src/lsp/rename.ts";
import { signatureHelpAt } from "../src/lsp/signature_help.ts";
import { definitionAt } from "../src/lsp/symbols.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";

Deno.test("lsp definition and rename preserve named JS member receivers", async () => {
  const path = "/test/js-member-receiver.wm";
  const uri = pathToFileUri(path);
  for (const annotation of ["", ": String"]) {
    for (const member of ["length", "toUpperCase()"]) {
      const source = `let text${annotation} = "hello"; let size = text.${member};`;
      const overrides = new Map([[path, source]]);
      const reference = source.lastIndexOf("text");
      const position = { line: 0, character: reference + 1 };
      const definition = await definitionAt(uri, position, overrides);
      assertEquals(definition?.range, {
        start: { line: 0, character: source.indexOf("text") },
        end: { line: 0, character: source.indexOf("text") + 4 },
      });
      const rename = await renameAt(uri, position, "message", overrides);
      assertEquals(rename?.changes[uri].length, 2);
      for (const edit of rename?.changes[uri] ?? []) {
        assertEquals(source.slice(edit.range.start.character, edit.range.end.character), "text");
        assertEquals(edit.newText, "message");
      }
    }
  }
});

Deno.test("lsp supports Char types and full primed identifier ranges", async () => {
  const path = "/test/primed.wm";
  const uri = pathToFileUri(path);
  const source = "let choose' = (value': Char, other': Char) => { value' }; " +
    "let answer' = choose'('a', 'b'); let use = answer';";
  const overrides = new Map([[path, source]]);
  const reference = source.lastIndexOf("answer'");
  const position = { line: 0, character: reference + "answer".length };
  const hover = await hoverAt(uri, position, overrides);
  assertStringIncludes(hover?.contents.value ?? "", "Char");
  const completions = await completionAt(
    uri,
    { line: 0, character: reference + "answer'".length },
    overrides,
  );
  assert(completions.some((item) => item.label === "answer'" && item.detail.includes("Char")));
  const definition = await definitionAt(uri, position, overrides);
  const start = source.indexOf("answer'");
  assertEquals(definition?.range, {
    start: { line: 0, character: start },
    end: { line: 0, character: start + "answer'".length },
  });
  const prepare = await prepareRenameAt(uri, position, overrides);
  assertEquals(prepare?.placeholder, "answer'");
  assertEquals(prepare?.range.end.character, reference + "answer'".length);
  const rename = await renameAt(uri, position, "result''", overrides);
  assertEquals(rename?.changes[uri].length, 2);
  for (const edit of rename?.changes[uri] ?? []) {
    assertEquals(edit.newText, "result''");
    assertEquals(edit.range.end.character - edit.range.start.character, "answer'".length);
  }
});

Deno.test("lsp recovers primed calls without counting commas inside characters", async () => {
  const path = "/test/primed-call.wm";
  for (const argument of ["','", "value'"]) {
    const source = "let choose' = (first': Char, second': Char) => { first' }; " +
      "let value' = 'a'; let use = choose'(" + argument + ", ";
    const help = await signatureHelpAt(
      pathToFileUri(path),
      { line: 0, character: source.length },
      new Map([[path, source]]),
    );
    assertStringIncludes(help?.signatures[0].label ?? "", "choose'");
    assertStringIncludes(help?.signatures[0].label ?? "", "Char");
    assertEquals(help?.activeParameter, 1);
  }
});
