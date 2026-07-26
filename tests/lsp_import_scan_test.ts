import { assertEquals } from "@std/assert";
import {
  directWorkmanImportSpecifiers,
  hasTopLevelMainBinding,
} from "../src/lsp/import_scan.ts";

Deno.test("direct import scan handles multiline imports and ignores non-module text", () => {
  const source = String.raw`
-- from "./comment.wm" import * as Comment;
let text = "from \"./string.wm\" import * as String";
let block = ` + '`from "./template.wm" import * as Template`' + String.raw`;
from
  "./one.wm"
  import * as One;
from "./two.wm" import { value };
from js import { console };
let nested = () => { from "./nested.wm" import * as Nested; };
from "./one.wm" import { duplicate };
`;

  assertEquals(directWorkmanImportSpecifiers(source), ["./one.wm", "./two.wm"]);
});

Deno.test("direct import scan tolerates comments between import tokens", () => {
  assertEquals(
    directWorkmanImportSpecifiers('from -- source\n "./lib.wm" // clause\n import * as Lib;'),
    ["./lib.wm"],
  );
});

Deno.test("[module update A613] discovery finds only top-level main binders", () => {
  assertEquals(hasTopLevelMainBinding("let main = () => { 0 };"), true);
  assertEquals(hasTopLevelMainBinding("let rec main = () => { main() };"), true);
  assertEquals(hasTopLevelMainBinding("let maintain = 1;"), false);
  assertEquals(hasTopLevelMainBinding('let text = "let main = 1";'), false);
  assertEquals(hasTopLevelMainBinding("let nested = () => { let main = 1; main };"), false);
  assertEquals(hasTopLevelMainBinding("-- let main = 1;\nlet value = 2;"), false);
});
