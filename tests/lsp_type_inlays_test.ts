import { assertEquals } from "@std/assert";
import { semanticInlayHints } from "../src/lsp/type_inlays.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";

Deno.test("ordinary type inlays cover useful binders and inferred parameters", async () => {
  const path = "/test/main.wm";
  const source = [
    "let literal = 1;",
    "let identity = (item) => { item };",
    "let increment = (value) => { value + 1 };",
    "let annotated: Number -> Number = (hidden) => { hidden + 1 };",
    'let (left, right) = (1, "x");',
  ].join("\n");
  const hints = await semanticInlayHints(
    pathToFileUri(path),
    fullRange(source),
    new Map([[path, source]]),
  );
  const typeHints = hints.filter((hint) => hint.kind === 1);

  assertEquals(
    typeHints.map(({ label, position, data }) => ({ label, position, category: data.category })),
    [
      {
        label: ": 'a -> 'a",
        position: { line: 1, character: "let identity".length },
        category: "binding",
      },
      {
        label: ": Number -> Number",
        position: { line: 2, character: "let increment".length },
        category: "binding",
      },
      {
        label: ": Number",
        position: { line: 2, character: "let increment = (value".length },
        category: "parameter",
      },
      {
        label: ": Number",
        position: { line: 4, character: "let (left".length },
        category: "binding",
      },
      {
        label: ": String",
        position: { line: 4, character: "let (left, right".length },
        category: "binding",
      },
    ],
  );
  assertEquals(typeHints.length, hints.length);
  assertEquals(
    hints.every((hint) => hint.kind !== 1 || hint.tooltip.value.startsWith("```workman\n")),
    true,
  );
});

Deno.test("ordinary type inlays honor the requested range", async () => {
  const path = "/test/main.wm";
  const source = 'let identity = (item) => { item };\nlet (left, right) = (1, "x");';
  const hints = await semanticInlayHints(
    pathToFileUri(path),
    {
      start: { line: 1, character: 0 },
      end: { line: 1, character: source.split("\n")[1].length },
    },
    new Map([[path, source]]),
  );

  assertEquals(hints.map(({ label }) => label), [": Number", ": String"]);
});

Deno.test("ordinary type inlays include local let binders", async () => {
  const path = "/test/main.wm";
  const source = "let work = (input) => { let doubled = input + input; doubled };";
  const hints = await semanticInlayHints(
    pathToFileUri(path),
    fullRange(source),
    new Map([[path, source]]),
  );
  const typeHints = hints.filter((hint) => hint.kind === 1);

  assertEquals(
    typeHints.map(({ label, data }) => [label, data.category]),
    [
      [": Number -> Number", "binding"],
      [": Number", "parameter"],
      [": Number", "binding"],
    ],
  );
  assertEquals(hints[2].position.character, source.indexOf("doubled") + "doubled".length);
});

Deno.test("ordinary type inlays expose only compiler-certified recovered binders", async () => {
  const path = "/test/main.wm";
  const source = "let identity = (item) => { item }; let broken =";
  const hints = await semanticInlayHints(
    pathToFileUri(path),
    fullRange(source),
    new Map([[path, source]]),
  );

  assertEquals(hints.map(({ label }) => label), [": 'a -> 'a"]);
});

Deno.test("parameter-name inlays use compiler-resolved Workman callables", async () => {
  const path = "/test/main.wm";
  const source = 'let format = (count, label) => { label }; let label = "ok"; ' +
    "let result = format(1, label);";
  const hints = await semanticInlayHints(
    pathToFileUri(path),
    fullRange(source),
    new Map([[path, source]]),
  );
  const parameters = hints.filter((hint) => hint.kind === 2);

  assertEquals(parameters.map(({ label, position, data }) => ({ label, position, data })), [{
    label: "count:",
    position: { line: 0, character: source.indexOf("format(1") + "format(".length },
    data: { kind: "workman.parameter-name" },
  }]);
});

Deno.test("parameter-name inlays follow callable identities across imports", async () => {
  const main = "/test/main.wm";
  const lib = "/test/lib.wm";
  const source = 'from "./lib.wm" import { combine as join }; let result = join(1, 2);';
  const hints = await semanticInlayHints(
    pathToFileUri(main),
    fullRange(source),
    new Map([
      [main, source],
      [lib, "let combine = (left, right) => { left + right };"],
    ]),
  );

  assertEquals(
    hints.filter((hint) => hint.kind === 2).map(({ label }) => label),
    ["left:", "right:"],
  );
});

Deno.test("parameter-name inlays use record field names", async () => {
  const path = "/test/main.wm";
  const source = 'record Point = { x: Number, y: String }; let point = Point(1, "here");';
  const hints = await semanticInlayHints(
    pathToFileUri(path),
    fullRange(source),
    new Map([[path, source]]),
  );

  assertEquals(
    hints.filter((hint) => hint.kind === 2).map(({ label }) => label),
    ["x:", "y:"],
  );
});

Deno.test("parameter-name inlays omit aliases without reliable authored parameters", async () => {
  const path = "/test/main.wm";
  const source = "let original = (left, right) => { left + right }; " +
    "let alias = original; let result = alias(1, 2);";
  const hints = await semanticInlayHints(
    pathToFileUri(path),
    fullRange(source),
    new Map([[path, source]]),
  );

  assertEquals(hints.filter((hint) => hint.kind === 2), []);
});

function fullRange(source: string) {
  const lines = source.split("\n");
  return {
    start: { line: 0, character: 0 },
    end: { line: lines.length - 1, character: lines.at(-1)!.length },
  };
}
