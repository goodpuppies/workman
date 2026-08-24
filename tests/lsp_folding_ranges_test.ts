import { assertEquals } from "@std/assert";
import {
  regionFoldingRanges,
  sourceFoldingRanges,
  syntaxFoldingRanges,
} from "../src/lsp/folding_ranges.ts";

Deno.test("region folding ranges support both comment forms, casing, labels, and nesting", () => {
  const source = [
    "let before = 0;",
    "  //#region outer label",
    "let outer = 1;",
    "--#REGION inner",
    "let inner = 2;",
    "--#ENDregion",
    "//#endREGION",
    "let after = 3;",
  ].join("\n");

  assertEquals(regionFoldingRanges(source), [
    { startLine: 1, endLine: 6, kind: "region" },
    { startLine: 3, endLine: 5, kind: "region" },
  ]);
});

Deno.test("region folding ranges ignore non-comment, unsupported-case, and unmatched markers", () => {
  const source = [
    'let text = "//#region not a marker";',
    "//#Region unsupported casing",
    "//#endregion unmatched",
    "//#region unclosed",
  ].join("\n");

  assertEquals(regionFoldingRanges(source), []);
});

Deno.test("syntax folding ranges include multiline Workman delimiters", () => {
  const source = [
    "let lex = (source) => {",
    "  let tokens = [",
    "    makeToken(",
    "      source",
    "    )",
    "  ];",
    "  tokens",
    "};",
  ].join("\n");

  assertEquals(syntaxFoldingRanges(source), [
    { startLine: 0, endLine: 7 },
    { startLine: 1, endLine: 5 },
    { startLine: 2, endLine: 4 },
  ]);
});

Deno.test("syntax folding ignores delimiters in comments and strings and folds backticks", () => {
  const source = [
    "let text = `first {",
    "second }`;",
    "// { ignored",
    'let quoted = "[ignored]";',
    "let body = {",
    "  value",
    "};",
  ].join("\n");

  assertEquals(syntaxFoldingRanges(source), [
    { startLine: 0, endLine: 1 },
    { startLine: 4, endLine: 6 },
  ]);
});

Deno.test("source folds combine regions with ordinary syntax", () => {
  const source = [
    "//#region helper",
    "let helper = () => {",
    "  1",
    "};",
    "//#endregion",
  ].join("\n");

  assertEquals(sourceFoldingRanges(source), [
    { startLine: 0, endLine: 4, kind: "region" },
    { startLine: 1, endLine: 3 },
  ]);
});
