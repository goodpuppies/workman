import { assertEquals } from "@std/assert";
import { signatureHelpAt } from "../src/lsp/signature_help.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";

Deno.test("signature help selects active parameters for named Workman calls", async () => {
  const path = "/test/main.wm";
  const source =
    'let format = (count: Number, label: String) => { label }; let result = format(1, "x");';
  const overrides = new Map([[path, source]]);
  const first = await signatureHelpAt(
    pathToFileUri(path),
    positionAt(source, source.indexOf("format(1") + "format(".length),
    overrides,
  );
  const second = await signatureHelpAt(
    pathToFileUri(path),
    positionAt(source, source.indexOf('"x"')),
    overrides,
  );

  assertEquals(first, {
    signatures: [{
      label: "format(count: Number, label: String) -> String",
      parameters: [
        { label: "count: Number", documentation: undefined },
        { label: "label: String", documentation: undefined },
      ],
    }],
    activeSignature: 0,
    activeParameter: 0,
  });
  assertEquals(second?.activeParameter, 1);
});

Deno.test("signature help follows named imports and innermost nested calls", async () => {
  const main = "/test/main.wm";
  const lib = "/test/lib.wm";
  const source = 'from "./lib.wm" import { combine as join }; ' +
    "let wrap = (value: Number) => { value }; let result = wrap(join(1, 2));";
  const overrides = new Map([
    [main, source],
    [lib, "let combine = (left: Number, right: Number) => { left + right };"],
  ]);
  const inner = await signatureHelpAt(
    pathToFileUri(main),
    positionAt(source, source.lastIndexOf("2")),
    overrides,
  );
  const outer = await signatureHelpAt(
    pathToFileUri(main),
    positionAt(source, source.indexOf("join(1")),
    overrides,
  );

  assertEquals(inner?.signatures[0].label, "join(left: Number, right: Number) -> Number");
  assertEquals(inner?.activeParameter, 1);
  assertEquals(outer?.signatures[0].label, "wrap(value: Number) -> Number");
  assertEquals(outer?.activeParameter, 0);
});

Deno.test("signature help supports constructors, pipes, and curried stages", async () => {
  const path = "/test/main.wm";
  const source = [
    "record Point = { x: Number, y: String };",
    'let point = Point(1, "x");',
    "let combine = (left: Number, right: Number) => { left + right };",
    "let piped = 1 :> combine(2);",
    "let curried = (left: Number) => { (right: Number) => { left + right } };",
    "let applied = curried(1)(2);",
    "let whitespaceApplied = curried 1 2;",
  ].join("\n");
  const overrides = new Map([[path, source]]);
  const constructor = await signatureHelpAt(
    pathToFileUri(path),
    positionAt(source, source.indexOf('"x"')),
    overrides,
  );
  const pipe = await signatureHelpAt(
    pathToFileUri(path),
    positionAt(source, source.indexOf("combine(2") + "combine(".length),
    overrides,
  );
  const curried = await signatureHelpAt(
    pathToFileUri(path),
    positionAt(source, source.lastIndexOf("(2)") + 1),
    overrides,
  );
  const whitespace = await signatureHelpAt(
    pathToFileUri(path),
    positionAt(source, source.lastIndexOf("curried 1 2") + "curried 1 ".length),
    overrides,
  );

  assertEquals(constructor?.signatures[0].label, "Point(x: Number, y: String) -> Point");
  assertEquals(constructor?.activeParameter, 1);
  assertEquals(pipe?.signatures[0].label, "combine(left: Number, right: Number) -> Number");
  assertEquals(pipe?.activeParameter, 1);
  assertEquals(curried?.signatures[0].label, "curried(right: Number) -> Number");
  assertEquals(curried?.activeParameter, 0);
  assertEquals(whitespace?.signatures[0].label, "curried(right: Number) -> Number");
  assertEquals(whitespace?.activeParameter, 0);
});

Deno.test("signature help keeps tuple-shaped arguments as one parameter", async () => {
  const path = "/test/main.wm";
  const source =
    'let consume = (pair: (Number, String)) => { pair }; let result = consume((1, "x"));';
  const help = await signatureHelpAt(
    pathToFileUri(path),
    positionAt(source, source.lastIndexOf('"x"')),
    new Map([[path, source]]),
  );

  assertEquals(help?.signatures[0].label, "consume(pair: (Number, String)) -> (Number, String)");
  assertEquals(help?.signatures[0].parameters.length, 1);
  assertEquals(help?.activeParameter, 0);
});

Deno.test("signature help survives incomplete current calls from certified scope facts", async () => {
  const main = "/test/main.wm";
  const lib = "/test/lib.wm";
  const source = 'from "./lib.wm" import * as Lib; ' +
    'let local = (first: String, second: String) => { second }; let a = local("a,b",';
  const overrides = new Map([
    [main, source],
    [lib, "let combine = (left: Number, right: Number) => { left + right };"],
  ]);
  const local = await signatureHelpAt(
    pathToFileUri(main),
    positionAt(source, source.length),
    overrides,
  );
  const namespaceSource = 'from "./lib.wm" import * as Lib; let result = Lib.combine(1,';
  overrides.set(main, namespaceSource);
  const namespace = await signatureHelpAt(
    pathToFileUri(main),
    positionAt(namespaceSource, namespaceSource.length),
    overrides,
  );

  assertEquals(local?.signatures[0].label, "local(first: String, second: String) -> String");
  assertEquals(local?.activeParameter, 1);
  assertEquals(
    namespace?.signatures[0].label,
    "Lib.combine(left: Number, right: Number) -> Number",
  );
  assertEquals(namespace?.activeParameter, 1);
});

Deno.test("incomplete record calls use field names and ignore commas in comments", async () => {
  const path = "/test/main.wm";
  const source = [
    "record Point = { x: Number, y: String };",
    "let point = Point(1, /* not, an argument */",
  ].join("\n");
  const help = await signatureHelpAt(
    pathToFileUri(path),
    positionAt(source, source.length),
    new Map([[path, source]]),
  );

  assertEquals(help?.signatures[0].label, "Point(x: Number, y: String) -> Point");
  assertEquals(help?.activeParameter, 1);
});

Deno.test("signature help returns null when no compiler-resolved callable is active", async () => {
  const path = "/test/main.wm";
  const source = "let value = unknown(";
  const help = await signatureHelpAt(
    pathToFileUri(path),
    positionAt(source, source.length),
    new Map([[path, source]]),
  );

  assertEquals(help, null);
});

function positionAt(source: string, offset: number): { line: number; character: number } {
  const lines = source.slice(0, offset).split("\n");
  return { line: lines.length - 1, character: lines.at(-1)!.length };
}
