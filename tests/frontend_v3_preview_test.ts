import { assertEquals, assertThrows } from "@std/assert";
import { type Insertion, loadPreview } from "../tooling/frontend-v3/adapters/js/preview.ts";

Deno.test("v3 WM inlay preview preserves source, whitespace and structural order", async () => {
  const render = await loadPreview();
  const derived = render.compare("let thing=", "let thing = ?;", true);
  assertEquals(derived.text, "let thing* *=* **?**;*");
  assertEquals(derived.hints.map((hint) => hint.label), [" ", " ", "?", ";"]);
  assertEquals(derived.edits.filter((edit) => edit.kind === "Delete"), []);
  const excess = render.compare("let  x=1;", "let x = 1;");
  assertEquals(excess.text, "let  x = 1;");
  assertEquals(excess.edits.filter((edit) => edit.kind === "Delete").length, 1);
  assertThrows(() => render.compare("abc", "xyz", false, 2), RangeError, "edit-distance");
  const hints = (entries: [number, string][]): Insertion[] =>
    entries.map(([anchor, text], id) => ({ id, anchor, text }));
  const spacing = render("let x=1", hints([[7, ";"], [5, " "], [6, " "]]));
  assertEquals(spacing.text, "let x = 1;");
  assertEquals(spacing.placements.map((item) => item.anchor), [5, 6, 7]);
  assertEquals(spacing.placements.map((item) => [item.previewStart, item.previewEnd]), [[5, 6], [
    7,
    8,
  ], [9, 10]]);
  assertEquals(
    render("let x=1", hints([[5, " "], [6, " "], [7, ";"]]), true).text,
    "let x* *=* *1*;*",
  );

  // Equal anchors retain supplied order, not numerical identity order.
  const shared = render("let thing = ", [
    { id: 90, anchor: 12, text: "?" },
    { id: 2, anchor: 12, text: ";" },
  ], true);
  assertEquals(shared.text, "let thing = *?**;*");
  assertEquals(shared.placements.map((item) => item.id), [90, 2]);
  assertEquals(render("x", hints([[1, "}"], [1, ","]]), true).text, "x*}**,*");
  assertEquals(render("=> x", hints([[0, "() "], [3, "{ "], [4, " }"]])).text, "() => { x }");

  // Excess whitespace, comments, opaque text and line endings remain authored.
  const source = "@@broken  /* untouched */\r\n\tlet x=1\r";
  assertEquals(render(source, []).text, source);
  const end = render(source, hints([[source.length, " "]]));
  assertEquals(end.text, source + " ");
  assertEquals(end.placements[0].position, { index: source.length, line: 2, col: 0 });
  const lines = render("a\r\nb\rc\nd", hints([[3, " "], [5, " "], [7, " "]]));
  assertEquals(lines.text, "a\r\n b\r c\n d");
  assertEquals(lines.placements.map((item) => [item.position.line, item.position.col]), [[1, 0], [
    2,
    0,
  ], [3, 0]]);

  // Offset units match JS/LSP UTF-16, including surrogate halves and lone surrogates.
  const unicode = "😀\ud800\0";
  assertEquals(render(unicode, hints([[2, " "], [4, "\udfff"]])).text, "😀 \ud800\0\udfff");
  assertEquals(render(unicode, hints([[2, " "]])).placements[0].position.col, 2);
  assertEquals(render("", hints([[0, " "], [0, "?"]])).text, " ?");
  assertEquals(render("x", hints([[0, ""], [1, "\n  "]])).text, "x\n  ");
  assertEquals(render("x", hints([[1, "\r\n  "]])).hints[0].label, "[LF]  ");

  for (const anchor of [-1, 2, 0.5, NaN, Infinity]) {
    assertThrows(() => render("x", [{ id: 7, anchor, text: "?" }]), RangeError);
  }
  // Large unsorted batches exercise stable sorting and iterative source traversal.
  const batch = Array.from({ length: 5000 }, (_, i) => ({ id: i, anchor: 5000 - i, text: "." }));
  const large = render("x".repeat(5000), batch);
  assertEquals(large.text, "x.".repeat(5000));
  assertEquals(large.placements.length, 5000);
});
