import { assertEquals, assertStringIncludes } from "@std/assert";
import { offsetToLineCol } from "../src/source.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";
import { validateUri } from "../src/lsp/validation.ts";

function rangeOf(source: string, text: string) {
  const offset = source.lastIndexOf(text);
  if (offset < 0) throw new Error(`missing ${text}`);
  const start = offsetToLineCol(source, offset);
  const end = offsetToLineCol(source, offset + text.length);
  return {
    start: { line: start.line - 1, character: start.col },
    end: { line: end.line - 1, character: end.col },
  };
}

Deno.test("LSP pipe conflicts highlight the displayed head and both origins", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const path = `${directory}/day1.wm`;
    await Deno.writeTextFile(path, "");
    const uri = pathToFileUri(path);
    const source = `type CErr = | SizeErr<String.Error> | InvalidToken<String>;
let parse = tok => {
  (size(tok) < 2) :> Result.mapErr(SizeErr)
  :> Monad.via Result =>
  :> if {
    Err("invalid tok" ++ tok)
  } else {
    Ok(1: Int32)
  }
};`;
    const results = await validateUri(uri, new Map([[path, source]]));
    const diagnostics = results.find((result) => result.uri === uri)!.diagnostics;
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 1);
    const expected = ["Monad.via Result =>", "SizeErr", '"invalid tok" ++ tok']
      .map((text) => rangeOf(source, text));
    assertEquals(errors.map((diagnostic) => diagnostic.code), [
      "type.pipe-input-mismatch",
      "type.pipe-input-mismatch",
      "type.pipe-input-mismatch",
    ]);
    assertEquals(errors.map((diagnostic) => diagnostic.range), expected);
    for (const [index, diagnostic] of errors.entries()) {
      assertEquals(diagnostic.range.start.line, diagnostic.range.end.line);
      assertStringIncludes(diagnostic.message, "Result<Bool, CErr>");
      assertStringIncludes(diagnostic.message, "Result<Bool, String>");
      assertEquals(
        diagnostic.relatedInformation?.slice(0, 2).map((related) => related.location),
        expected.filter((_, other) => other !== index).map((range) => ({ uri, range })),
      );
    }
    const fixed = source.replace(
      'Err("invalid tok" ++ tok)',
      'Err(InvalidToken("invalid tok" ++ tok))',
    );
    const cleared = await validateUri(uri, new Map([[path, fixed]]));
    assertEquals(
      cleared.flatMap((result) => result.diagnostics).filter((diagnostic) =>
        diagnostic.severity === 1
      ),
      [],
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("LSP pipe conflict ranges deduplicate a head that is also an origin", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const path = `${directory}/mapper.wm`;
    const source = `type ParseError = | ExpectedPair;
let bad = Int32.fromString("12") :> Result.mapErr(ExpectedPair);`;
    await Deno.writeTextFile(path, source);
    const uri = pathToFileUri(path);
    const results = await validateUri(uri, new Map());
    const errors = results.find((result) => result.uri === uri)!.diagnostics
      .filter((diagnostic) => diagnostic.severity === 1);
    assertEquals(errors.length, 1);
    assertEquals(errors[0].range, rangeOf(source, "ExpectedPair"));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("LSP nullary constructor pipes highlight the target and input without a broad range", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const path = `${directory}/constructor.wm`;
    const source = `type CErr = | SliceErr;
let e: String.Slice_error = String.InvalidIndex;
let bad = e :> SliceErr :> Err;`;
    await Deno.writeTextFile(path, source);
    const uri = pathToFileUri(path);
    const results = await validateUri(uri, new Map());
    const errors = results.find((result) => result.uri === uri)!.diagnostics
      .filter((diagnostic) => diagnostic.severity === 1);
    assertEquals(errors[0].range, rangeOf(source, "SliceErr"));
    assertEquals(errors.length, 2);
    assertStringIncludes(errors[0].message, "SliceErr<String.Slice_error>");
    assertStringIncludes(errors[1].message, "piped value: String.Slice_error");
    for (const error of errors) {
      assertEquals(error.range.start.line, error.range.end.line);
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("LSP continuation conflicts highlight the operation introducing the error", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const path = `${directory}/continuation.wm`;
    const source = `type CErr = | SliceErr<String.Slice_error>;
let num = String.extract("12", 0, None)
  :> Result.mapErr(SliceErr)
  :> Monad.via Result =>
  :> Int64.fromString;`;
    await Deno.writeTextFile(path, source);
    const uri = pathToFileUri(path);
    const results = await validateUri(uri, new Map());
    const errors = results.find((result) => result.uri === uri)!.diagnostics
      .filter((diagnostic) => diagnostic.severity === 1);
    assertEquals(errors.map((error) => error.range), [
      rangeOf(source, "Monad.via Result =>"),
      rangeOf(source, "SliceErr"),
      rangeOf(source, "Int64.fromString"),
    ]);
    assertStringIncludes(errors[2].message, "Int64.fromString call result: Int64.Error");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("LSP return mismatches highlight the returned expression and annotation", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const path = `${directory}/return.wm`;
    await Deno.writeTextFile(path, "");
    const uri = pathToFileUri(path);
    for (const trailing of [false, true]) {
      const source = `type CErr = | Failed;
record Spin = {distance: Int64};
let parse = (str)${trailing ? "" : ": List<Spin>"} => {
  let toks = Ok([Spin(1)]) : Result<List<Spin>, CErr>;
  toks
}${trailing ? ": List<Spin>" : ""};`;
      const results = await validateUri(uri, new Map([[path, source]]));
      const errors = results.find((result) => result.uri === uri)!.diagnostics
        .filter((diagnostic) => diagnostic.severity === 1);
      const expected = [rangeOf(source, "toks"), rangeOf(source, "List<Spin>")];
      // There is another List<Spin> in the binding inside the function.
      if (!trailing) {
        const annotation = source.indexOf("List<Spin>");
        const prefix = source.slice(0, annotation);
        const lines = prefix.split("\n");
        expected[1] = {
          start: { line: lines.length - 1, character: lines.at(-1)!.length },
          end: { line: lines.length - 1, character: lines.at(-1)!.length + "List<Spin>".length },
        };
      }
      assertEquals(errors.map((error) => error.code), ["type.mismatch", "type.mismatch"]);
      assertEquals(errors.map((error) => error.range), expected);
      assertStringIncludes(errors[1].message, "return annotation: List<Spin>");
      assertEquals(errors[0].relatedInformation?.[0].location, { uri, range: expected[1] });
      const fixed = source.replace(
        trailing ? ": List<Spin>;" : ": List<Spin> =>",
        trailing ? ": Result<List<Spin>, CErr>;" : ": Result<List<Spin>, CErr> =>",
      );
      const cleared = await validateUri(uri, new Map([[path, fixed]]));
      assertEquals(
        cleared.flatMap((result) => result.diagnostics)
          .filter((diagnostic) => diagnostic.severity === 1),
        [],
      );
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
