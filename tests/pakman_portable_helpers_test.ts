import { assertEquals } from "@std/assert";
import { compileLibraryVirtual } from "../src/compiler.ts";

Deno.test("portable pakman helpers agree with Unicode ordering, checked parsing and source policies", async () => {
  const filename = "/test/pakman-portable.wm";
  const source = `
    from "basis/text.wm" import * as T;
    from "basis/int.wm" import * as Int;
    from "basis/string_cvt.wm" import * as Cvt;
    from "basis/path.wm" import * as Path;
    from "basis/order.wm" import * as O;
    from "basis/result.wm" import * as R;
    from "std/string.wm" import * as Strings;
    from "pakman/number.wm" import * as Numbers;
    let natural = (value) => { R.getOr(R.map(Int.parseNatural(value), I32.toNumber), -1) };
    let prefix = (value) => { R.getOr(R.map(Int.fromString(value), I32.toNumber), -999) };
    let legacy = (value) => { Numbers.parseIntOr(value, -1) };
    let order = (left: String, right: String) => {
      match(T.compare(left, right)) {
        R.Ok(O.Less) => { -1 }, R.Ok(O.Equal) => { 0 }, R.Ok(O.Greater) => { 1 }, R.Err(_) => { 99 }
      }
    };
    let pad = (text: String, width: I32) => { R.getOr(Cvt.padTextRight(text, width, (32: I32)), "FAILED") };
    let parent = (text: String) => { R.getOr(Path.dir(text), "FAILED") };
    let subsequence = (text: String, pattern: String) => { R.getOr(Strings.isSubsequence(text, pattern), false) };
  `;
  const compiled = await compileLibraryVirtual(filename, new Map([[filename, source]]));
  const runtime = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);
  for (const text of ["0", "000", "123", "2147483647"]) {
    assertEquals(runtime.natural(text), Number(text));
  }
  for (
    const text of ["", "+1", "-1", " 1", "1 ", "1x", "2147483648", "99999999999999999999", "東京"]
  ) {
    assertEquals(runtime.natural(text), -1);
  }
  assertEquals(runtime.natural("0".repeat(20000) + "1"), 1);
  assertEquals(runtime.prefix(" \t~2147483648tail"), -2147483648);
  assertEquals(runtime.prefix("+123tail"), 123);
  for (const text of ["1", "  12\t", "\u00a012\u2000", "\ufeff12\u2029", "00012"]) {
    assertEquals(runtime.legacy(text), Number(text));
  }
  for (const text of ["", "  ", "-1", "+1", "1x", "1.5", "2147483648", "\ud80012"]) {
    assertEquals(runtime.legacy(text), -1);
  }
  const words = [
    "",
    "a",
    "ab",
    "a\0",
    "é",
    "é",
    "東京",
    "\ud7ff",
    "\ue000",
    "\uffff",
    "𐀀",
    "🦊",
    "🦊a",
    "🦊b",
    "𐏿",
    "𐐀",
    "􏿿",
  ];
  for (const left of words) {
    for (const right of words) {
      assertEquals(runtime.order([left, right]), left < right ? -1 : left > right ? 1 : 0);
    }
  }
  assertEquals(runtime.order(["a\ud800", "b"]), 99);
  assertEquals(runtime.order(["b", "a\udfff"]), 99);
  assertEquals(runtime.pad(["🦊", 3]), "🦊  ");
  assertEquals(runtime.pad(["abc", -2147483648]), "abc");
  assertEquals(runtime.pad(["a\ud800", 0]), "FAILED");
  for (
    const [path, parent] of [["", ""], ["file", ""], ["/", "/"], ["/a", "/"], ["a//b", "a/"], [
      "/café/東京/🦊",
      "/café/東京",
    ]]
  ) {
    assertEquals(runtime.parent(path), parent);
  }
  assertEquals(runtime.subsequence(["oscgoesbrrr", "ogb"]), true);
  assertEquals(runtime.subsequence(["café/🦊/東京", "é🦊東"]), true);
  assertEquals(runtime.subsequence(["abc", "ca"]), false);
  assertEquals(runtime.subsequence(["abc", ""]), true);
  assertEquals(runtime.subsequence(["a\ud800", ""]), false);
});
