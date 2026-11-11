import { assertEquals } from "@std/assert";
import { compileLibraryVirtual } from "../src/compiler.ts";

Deno.test("shared Basis text helpers preserve Unicode and validate before matching/callbacks", async () => {
  const filename = "/test/shared-text.wm";
  const source = `
    from "basis/string.wm" import * as S;
    from "basis/text.wm" import * as T;
    from "basis/result.wm" import * as R;
    let same = (result, expected) => {
      match(result) { R.Ok(value) => { value == expected }, R.Err(_) => { false } }
    };
    let checks =
      same(T.fields("/café//東京/🦊/", (c) => { c == (47: I32) }), ["", "café", "", "東京", "🦊", ""])
      && same(T.tokens("/café//東京/🦊/", (c) => { c == (47: I32) }), ["café", "東京", "🦊"])
      && same(T.fields("a🦊b🦊", (c) => { c == (129418: I32) }), ["a", "b", ""])
      && same(T.isPrefix("café/東京/🦊", "café"), true)
      && same(T.isSuffix("café/東京/🦊", "🦊"), true)
      && same(T.isSubstring("café/東京/🦊", "東京"), true)
      && same(T.isSubstring("café", "e"), false)
      && same(T.isSubstring("é", "é"), false)
      && same(T.isPrefix("", ""), true)
      && same(T.fields("", (_) => { true }), [""])
      && same(T.tokens("", (_) => { true }), [])
    ;
    let byteChecks = same(S.fields("|abc||def", (c) => { c == '|' }), ["", "abc", "", "def"])
      && same(S.tokens("|abc||def", (c) => { c == '|' }), ["abc", "def"]);
    let rejectsText = (value: String) => {
      !R.isOk(T.isPrefix(value, "")) && !R.isOk(T.isSuffix(value, ""))
      && !R.isOk(T.isSubstring(value, ""))
      && !R.isOk(T.isPrefix("", value)) && !R.isOk(T.isSuffix("", value))
      && !R.isOk(T.isSubstring("", value))
    };
    let rejectsByteString = (value: String) => {
      !R.isOk(S.isPrefix(value, "")) && !R.isOk(S.isSuffix(value, ""))
      && !R.isOk(S.isSubstring(value, ""))
      && !R.isOk(S.isPrefix("", value)) && !R.isOk(S.isSuffix("", value))
      && !R.isOk(S.isSubstring("", value))
    };
    let textFieldsOkay = (value: String, predicate) => { R.isOk(T.fields(value, predicate)) };
    let textTokensOkay = (value: String, predicate) => { R.isOk(T.tokens(value, predicate)) };
    let byteFieldsOkay = (value: String, predicate) => { R.isOk(S.fields(value, predicate)) };
    let byteTokensOkay = (value: String, predicate) => { R.isOk(S.tokens(value, predicate)) };
    let editChecks =
      same(T.explode("a🦊é"), [(97: I32), (129418: I32), (233: I32)])
      && same(T.implode([(97: I32), (129418: I32), (233: I32)]), "a🦊é")
      && same(T.substring("a🦊é", (1: I32), (1: I32)), "🦊")
      && same(T.extract("a🦊é", (1: I32), None), "🦊é")
      && same(T.extract("a🦊é", (1: I32), Some((1: I32))), "🦊")
      && same(T.extract("a🦊é", (3: I32), None), "")
      && same(T.map("a🦊é", (c) => { if (c == (129418: I32)) { (47: I32) } else { c } }), "a/é")
      && same(T.translate("a🦊é", (c) => { if (c == (129418: I32)) { "XY" } else { "" } }), "XY")
      && same(S.substring("abc", (1: I32), (1: I32)), "b")
      && same(S.extract("abc", (3: I32), None), "")
      && same(S.map("a|b", (c) => { if (c == '|') { '/' } else { c } }), "a/b")
      && same(S.translate("a|b||", (c) => { if (c == '|') { "::" } else { "" } }), "::::::");
    let textMapOkay = (value: String, f) => { R.isOk(T.map(value, f)) };
    let textTranslateOkay = (value: String, f) => { R.isOk(T.translate(value, f)) };
    let byteMapOkay = (value: String, f) => { R.isOk(S.map(value, f)) };
    let byteTranslateOkay = (value: String, f) => { R.isOk(S.translate(value, f)) };
    let rejectsSlices = (value: String) => {
      !R.isOk(T.substring(value, (0: I32), (0: I32)))
      && !R.isOk(T.extract(value, (0: I32), None))
    };
    let rejectsByteSlices = (value: String) => {
      !R.isOk(S.substring(value, (0: I32), (0: I32)))
      && !R.isOk(S.extract(value, (0: I32), None))
    };
  `;
  const compiled = await compileLibraryVirtual(filename, new Map([[filename, source]]));
  const runtime = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);
  assertEquals(runtime.checks, true);
  assertEquals(runtime.byteChecks, true);
  assertEquals(runtime.editChecks, true);
  for (const invalid of ["\ud800", "a\udfff", "\ud800a"]) {
    assertEquals(runtime.rejectsText(invalid), true);
    const unexpected = () => {
      throw new Error("callback on invalid text");
    };
    assertEquals(runtime.textFieldsOkay(invalid, unexpected), false);
    assertEquals(runtime.textTokensOkay(invalid, unexpected), false);
    assertEquals(runtime.textMapOkay(invalid, unexpected), false);
    assertEquals(runtime.textTranslateOkay(invalid, unexpected), false);
    assertEquals(runtime.rejectsSlices(invalid), true);
  }
  for (const invalid of ["a東京", "🦊"]) {
    assertEquals(runtime.rejectsByteString(invalid), true);
    const unexpected = () => {
      throw new Error("callback on non-byte input");
    };
    assertEquals(runtime.byteFieldsOkay(invalid, unexpected), false);
    assertEquals(runtime.byteTokensOkay(invalid, unexpected), false);
    assertEquals(runtime.byteMapOkay(invalid, unexpected), false);
    assertEquals(runtime.byteTranslateOkay(invalid, unexpected), false);
    assertEquals(runtime.rejectsByteSlices(invalid), true);
  }
  for (const name of ["textFieldsOkay", "textTokensOkay"]) {
    const seen: number[] = [];
    assertEquals(
      runtime[name]("a🦊/é", (scalar: number) => {
        seen.push(scalar);
        return scalar === 47;
      }),
      true,
    );
    assertEquals(seen, [97, 129418, 47, 233]);
  }
  for (const name of ["textMapOkay", "textTranslateOkay"]) {
    const seen: number[] = [];
    assertEquals(
      runtime[name]("a🦊é", (scalar: number) => {
        seen.push(scalar);
        return name === "textMapOkay" ? scalar : "";
      }),
      true,
    );
    assertEquals(seen, [97, 129418, 233]);
  }
  assertEquals(runtime.textMapOkay("ab", () => 55296), false);
  assertEquals(runtime.byteMapOkay("ab", () => "東京"), false);
  for (const name of ["textTranslateOkay", "byteTranslateOkay"]) {
    let calls = 0;
    assertEquals(
      runtime[name]("ab", () => {
        calls++;
        return "\ud800";
      }),
      false,
    );
    assertEquals(calls, 1);
  }
});
