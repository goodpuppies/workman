import { assertEquals, assertStringIncludes } from "@std/assert";
import { compileLibraryVirtual } from "../src/compiler.ts";

let runtimePromise: Promise<Record<string, any>> | undefined;
function runtime() {
  return runtimePromise ??= (async () => {
    const filename = "/test/json-probes.wm";
    const source = `
      from "std/json.wm" import * as J;
      from "std/json_value.wm" import * as V;
      from "basis/result.wm" import * as R;
      let normalize = (source) => { R.getOr(R.andThen(J.decode(source), J.encode), "FAILED") };
      let diagnostic = (source) => {
        match(J.read(source)) { Ok(_) => { "" }, Err(problem) => { J.problemText(problem) } }
      };
      let spelling = (source) => { R.getOr(J.number(J.read(source)), "FAILED") };
      let integer = (source) => { R.getOr(R.map(J.integer(J.read(source)), I32.toNumber), -999) };
      let text = (source) => { R.getOr(J.text(J.read(source)), "FAILED") };
      let field = (source, key) => { R.getOr(J.text(J.get(J.read(source), key)), "FAILED") };
      let atError = (index: I32) => {
        match(J.at(J.read("[]"), index)) { Ok(_) => { "" }, Err(problem) => { J.problemText(problem) } }
      };
      let nestedError = (source) => {
        let found = J.text(J.get(J.at(J.get(J.read(source), "releases"), (0: I32)), "name"));
        match(found) { Ok(_) => { "" }, Err(problem) => { J.problemText(problem) } }
      };
      let optional = (source, key) => {
        match(J.optional(J.get(J.read(source), key))) {
          Ok(None) => { "missing" },
          Ok(Some(node)) => { if (R.getOr(J.isNull(Ok(node)), false)) { "null" } else { "present" } },
          Err(problem) => { J.problemText(problem) }
        }
      };
      let keys = (source) => { R.getOr(R.map(J.keys(J.read(source)), (keys) => { Text.of(keys) }), "FAILED") };
      let invalidNumbers = !R.isOk(J.encode(V.Number("1,2")))
        && !R.isOk(J.encode(V.Number("NaN"))) && !R.isOk(J.encode(V.Number(" 1")))
        && !R.isOk(J.encode(V.Number("01")));
      let invalidIntegers = !R.isOk(J.integer(J.root(V.Number("+1"))))
        && !R.isOk(J.integer(J.root(V.Number("~1"))))
        && !R.isOk(J.integer(J.root(V.Number("01"))));
      let invalidStrings = !R.isOk(J.encode(V.Text(['\\u0080'])))
        && !R.isOk(J.encode(V.Object([(['\\u0080'], V.Null)])));
      let badBytes = !R.isOk(J.decodeBytes(['\\u00ff']));
      let legacy: Result<String, Js.Error> = Json.assert("legacy");
      let legacyOkay = match(legacy) { Ok(text) => { text == "legacy" }, _ => { false } };
      let limited = (source, limit: I32) => { R.isOk(J.decodeWithLimit(source, limit)) };
    `;
    const code = await compileLibraryVirtual(filename, new Map([[filename, source]]));
    return await import(`data:text/javascript,${encodeURIComponent(code)}`);
  })();
}

Deno.test("portable JSON parses and encodes JSON values without host conversion", async () => {
  const m = await runtime();
  const values = [
    null,
    true,
    false,
    0,
    -1,
    1.5,
    "",
    'quote" slash\\ /',
    "a\0\b\f\n\r\t",
    "café/東京/🦊",
    [],
    {},
    [1, "x", null],
    { x: [false, { "a.b[]": "🦊" }] },
  ];
  for (const value of values) {
    const source = JSON.stringify(value);
    const result = m.normalize(source);
    assertEquals(JSON.parse(result), value);
  }
  assertEquals(m.spelling("-0"), "-0");
  for (
    const number of [
      "9007199254740993",
      "1e400",
      "-1.2300E+004",
      "0.0000",
      "123456789012345678901234567890",
    ]
  ) {
    assertEquals(m.spelling(number), number);
    assertEquals(m.normalize(number), number);
  }
  assertEquals(m.integer("-2147483648"), -2147483648);
  assertEquals(m.integer("2147483647"), 2147483647);
  for (const invalid of ["2147483648", "1.0", "1e0"]) assertEquals(m.integer(invalid), -999);
  assertEquals(m.text('"\\uD83E\\uDD8A"'), "🦊");
  assertEquals(m.text('"\\u0000\\u00e9\\u6771"'), "\0é東");
  assertEquals(m.legacyOkay, true);
  assertEquals(m.invalidNumbers, true);
  assertEquals(m.invalidStrings, true);
  assertEquals(m.invalidIntegers, true);
  assertEquals(m.badBytes, true);
});

Deno.test("portable JSON rejects malformed syntax and ill-formed Unicode with offsets", async () => {
  const m = await runtime();
  const invalid = [
    "",
    " ",
    "+1",
    "01",
    "-.1",
    "1.",
    "1e",
    "1e+",
    "NaN",
    "Infinity",
    "undefined",
    "true false",
    "null,",
    "[1,]",
    "[,1]",
    "[1 2]",
    '{"x":1,}',
    '{"x" 1}',
    "{'x':1}",
    "{x:1}",
    "//comment\n1",
    "[/*x*/]",
    '"\\x20"',
    '"\\u12xz"',
    '"\\uD800"',
    '"\\uDC00"',
    '"\\uD800\\u0041"',
    '"\\uD800\\uD800"',
    '"raw\nline"',
    '"raw\0byte"',
    '"unterminated',
    "\u00a01",
    "\ufeffnull",
    '"\ud800"',
  ];
  for (const source of invalid) {
    assertEquals(m.normalize(source), "FAILED", JSON.stringify(source));
    assertStringIncludes(m.diagnostic(source), "byte ", JSON.stringify(source));
  }
  assertStringIncludes(m.diagnostic("[1,]"), "byte 3:");
  assertEquals(m.limited(["[]", 1]), true);
  assertEquals(m.limited(["[[]]", 1]), false);
  assertEquals(m.limited(["0", 0]), true);
  assertEquals(m.limited(["0", -1]), false);
  assertEquals(m.normalize("[".repeat(129) + "]".repeat(129)), "FAILED");
});

Deno.test("portable JSON accessors preserve paths, nulls, duplicate keys and dynamic names", async () => {
  const m = await runtime();
  assertEquals(m.field(['{"東京":"🦊"}', "東京"]), "🦊");
  assertEquals(m.field(['{"x":"first","x":"last"}', "x"]), "last");
  assertEquals(m.normalize('{"x":1,"x":2}'), '{"x":1,"x":2}');
  assertEquals(
    m.nestedError('{"releases":[{"name":1}]}'),
    '$["releases"][0]["name"]: expected text',
  );
  assertEquals(m.nestedError('{"releases":[{}]}'), '$["releases"][0]["name"]: missing');
  assertEquals(m.optional(["{}", "x"]), "missing");
  assertEquals(m.optional(['{"x":null}', "x"]), "null");
  assertEquals(m.optional(['{"x":false}', "x"]), "present");
  assertEquals(m.optional(["[]", "x"]), "$: expected object");
  assertEquals(m.atError(-1), "$[-1]: missing");
  assertEquals(m.atError(-2147483648), "$[-2147483648]: missing");
  assertEquals(m.keys('{"a":1,"b":2,"a":3}'), "Cons(a, Cons(b, Nil))");
});

Deno.test("portable JSON handles wide containers and long escape sequences in constant call stack", async () => {
  const m = await runtime();
  const array = Array.from({ length: 12000 }, (_, i) => i);
  const object = Object.fromEntries(array.map((i) => [`key${i}`, i]));
  for (const value of [array, object]) {
    assertEquals(JSON.parse(m.normalize(JSON.stringify(value))), value);
  }
  assertEquals(m.text('"' + "\\u0061".repeat(12000) + '"'), "a".repeat(12000));
  assertEquals(m.text('"' + "\\ud83e\\udd8a".repeat(4000) + '"'), "🦊".repeat(4000));
});

Deno.test("portable JSON roundtrips a deterministic generated corpus", async () => {
  const m = await runtime();
  let state = 12345;
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
  const texts = [
    "",
    "a\0b",
    "東京🦊",
    'quote"\\',
    "__proto__",
    "constructor",
    "\u2028\u2029",
    "é",
    "a.b[]",
  ];
  const value = (depth: number): unknown => {
    const kind = next() % (depth > 0 ? 6 : 4);
    if (kind === 0) return null;
    if (kind === 1) return (next() & 1) === 0;
    if (kind === 2) return (next() % 1000000) / 100;
    if (kind === 3) return texts[next() % texts.length];
    if (kind === 4) return Array.from({ length: next() % 6 }, () => value(depth - 1));
    return Object.fromEntries(
      Array.from({ length: next() % 6 }, () => [texts[next() % texts.length], value(depth - 1)]),
    );
  };
  for (let i = 0; i < 250; i++) {
    const original = value(5);
    assertEquals(JSON.parse(m.normalize(JSON.stringify(original))), original);
  }
});
