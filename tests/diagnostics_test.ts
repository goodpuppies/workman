import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource, checkVirtual, ModuleAnalysisError } from "../src/compiler.ts";
import {
  formatDiagnostic,
  formatDiagnosticDocument,
  formatDiagnosticInspection,
  formatReplDiagnostic,
  formatReplError,
  type FrontendDiagnostic,
  FrontendDiagnosticBundleError,
  FrontendDiagnosticError,
  renderDiagnosticSummary,
} from "../src/diagnostics.ts";
import { line, span, wrapDocument } from "../tooling/tuiman/document.ts";
import { createDiagnosticWriter } from "../src/diagnostic_writer.ts";
import { fn, fresh, prim, unify } from "../src/types.ts";

Deno.test("diagnostic snapshots retain introduction types across later unification", () => {
  const writer = createDiagnosticWriter();
  const variable = fresh("input");
  const type = fn([variable], variable);
  const before = writer.snapshotType(type);
  unify(variable, prim("Real64.Real"));
  const after = writer.snapshotType(type);
  const support = writer.buildSupport([]);
  assertEquals(
    support.types.find((snapshot) => snapshot.id === before)?.rendered,
    "input -> input",
  );
  assertEquals(
    support.types.find((snapshot) => snapshot.id === after)?.rendered,
    "Real64.Real -> Real64.Real",
  );
  assertEquals(writer.buildSupport([]), support);
});

Deno.test("terminal diagnostic documents flow to narrow widths without losing roles", () => {
  const wrapped = wrapDocument(
    { lines: [line(span("123456", "header"), span("abcdef", "type"))] },
    8,
  );
  assertEquals(wrapped.lines.map((item) => item.spans.map((part) => part.text).join("")), [
    "123456ab",
    "cdef",
  ]);
  assertEquals(wrapped.lines[1].spans[0].role, "type");
});

Deno.test("terminal diagnostic documents wrap on words and keep their indentation", () => {
  const wrapped = wrapDocument(
    { lines: [line(span("  type error: ", "error"), span("render can't be both", "type"))] },
    20,
  );
  assertEquals(wrapped.lines.map((item) => item.spans.map((part) => part.text).join("")), [
    "  type error: render",
    "can't be both",
  ]);
  assertEquals(wrapped.lines[0].spans.at(-1)?.role, "type");
});

Deno.test("instantiated field requirements retain source-aware type mismatch origins", async () => {
  const source = `record Post = { author: String };
record FeedPost = { author: Real64.Real };
record FeedPage = { posts: List<FeedPost>, cursor: Option<String> };
let renderPost = (post) => { post.author ++ "!" };
let renderPosts = (posts) => { List.map(posts, renderPost) };
let renderFeed = (feed) => {
  let cursor = feed.cursor;
  renderPosts(feed.posts)
};
let bad = renderFeed(FeedPage([FeedPost(1)], None));`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const diagnostic = error.diagnostic;
  assertEquals(diagnostic.failure.frame.rule, "InferRecord.ProjectField");
  const rendered = formatDiagnostic(diagnostic, "feed.wm", source);
  assertStringIncludes(rendered, "post.author");
  assertStringIncludes(rendered, "FeedPost.author field: Real64.Real");
  assertStringIncludes(rendered, "String");
  assertStringIncludes(rendered, "feed.wm:4:");
  assertEquals(rendered.includes("ambiguous record projection"), false);
});

Deno.test("call mismatch produces an auditable diagnostic artifact", async () => {
  const error = await assertRejects(
    () => checkSource('let inc = (x: Real64.Real) => { x + 1 }; let bad = inc("no");'),
    FrontendDiagnosticError,
  );

  const diagnostic = error.diagnostic;
  assertEquals(diagnostic.code, "type.call-argument-mismatch");
  assertEquals(diagnostic.failure.frame.rule, "InferCall.Argument");
  assertEquals(diagnostic.failure.premise.role, "argument matches parameter");
  assertEquals(diagnostic.failure.violation.kind, "contradicted");
  assertEquals(diagnostic.support.entries.some((entry) => entry.kind === "constraint"), true);
  assertEquals(diagnostic.support.entries.some((entry) => entry.kind === "collision"), true);
  assertEquals(diagnostic.support.entries.some((entry) => entry.kind === "claim"), true);
  assertEquals(diagnostic.support.entries.some((entry) => entry.kind === "note"), false);
  assertEquals(constraintRoles(diagnostic), ["parameter", "argument"]);
  assertEquals(
    diagnostic.support.types.some((snapshot) => snapshot.rendered === "Real64.Real"),
    true,
  );
  assertEquals(
    diagnostic.support.types.some((snapshot) => snapshot.rendered === "String"),
    true,
  );
  assertEquals(
    renderDiagnosticSummary(diagnostic),
    [
      "type collision: InferCall.Argument: argument matches parameter",
      "  conflict: type",
      "  left: Real64.Real",
      "    source: parameter x",
      "  right: String",
      "    source: argument",
    ].join("\n"),
  );
});

Deno.test("piping into a nullary constructor highlights the target and explains the missing payload", async () => {
  const source = `type CErr = | SliceErr;
let e: String.Slice_error = String.InvalidIndex;
let bad = e :> SliceErr :> Err;`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const rendered = formatDiagnostic(error.diagnostic, "day1.wm", source);
  assertStringIncludes(rendered, "type error: SliceErr pipe target can't be both:");
  assertStringIncludes(rendered, "  - CErr");
  assertStringIncludes(rendered, "  - String.Slice_error -> T");
  assertStringIncludes(rendered, "day1.wm:3:16");
  assertStringIncludes(rendered, "piped value: String.Slice_error");
  assertStringIncludes(rendered, "SliceErr is declared without a payload");
  assertStringIncludes(rendered, "SliceErr<String.Slice_error>");
  assertEquals(rendered.includes("pipe sides"), false);
  const fixed = source.replace("| SliceErr;", "| SliceErr<String.Slice_error>;");
  assertEquals((await checkSource(fixed)).diagnostics, []);
});

Deno.test("a nullary constructor pipe explains missing payloads before the input is inferred", async () => {
  const source = "type CErr = | SliceErr; let f = e => e :> SliceErr :> Err;";
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const rendered = formatDiagnostic(error.diagnostic, "day1.wm", source);
  assertStringIncludes(rendered, "SliceErr pipe target");
  assertStringIncludes(rendered, "SliceErr is declared without a payload");
  assertStringIncludes(rendered, "piped value: T");
  assertEquals(rendered.includes("SliceErr<T>"), false);
});

Deno.test("inline pipe matches establish error payloads before checking a failing arm", async () => {
  const source = `type CErr = | SliceErr;
let parse = tok => String.substring(tok, 0, 0) :> match {
  Ok("L") => Ok(1: Int32),
  Ok("R") => Ok(2: Int32),
  Err(e) => e :> SliceErr,
  Ok(_) => Panic "invalid direction"
};`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const rendered = formatDiagnostic(error.diagnostic, "day1.wm", source);
  assertStringIncludes(rendered, "  - String.Slice_error -> T");
  assertStringIncludes(rendered, "piped value: String.Slice_error");
  assertStringIncludes(rendered, "SliceErr<String.Slice_error>");
  assertEquals(rendered.includes("piped value: T"), false);
});

Deno.test("inline pipe lambdas establish nested and tuple input types before body errors", async () => {
  for (
    const source of [
      `type Failure = | Wrapped;
let bad = ((1: Int32), "text") :> ((number, text) => text :> Wrapped);`,
      `type Failure = | Wrapped;
let bad = Some(Err("error")) :> match {
  Some(Err(error)) => error :> Wrapped,
  _ => Panic "other"
};`,
    ]
  ) {
    const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
    const rendered = formatDiagnostic(error.diagnostic, "input.wm", source);
    assertStringIncludes(rendered, "piped value: String");
    assertStringIncludes(rendered, "Wrapped<String>");
  }
});

Deno.test("non-constructor pipe targets do not receive a constructor repair", async () => {
  const source = 'let target = "text"; let bad = (1: Int32) :> target;';
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const rendered = formatDiagnostic(error.diagnostic, "target.wm", source);
  assertStringIncludes(rendered, "target pipe target");
  assertStringIncludes(rendered, "piped value: Int32.Int");
  assertEquals(rendered.includes("without a payload"), false);
});

Deno.test("library error names identify their public module without qualifying user errors", async () => {
  const source = `type Error = | LocalFailure;
let dir = String.substring("L1",0,0) :> match {
  Ok(x) => Err(LocalFailure),
  Err(e) => Err(e)
};`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const rendered = formatDiagnostic(error.diagnostic, "day1.wm", source);
  assertStringIncludes(rendered, "String.Slice_error");
  assertStringIncludes(rendered, "LocalFailure: Error");
  assertEquals(rendered.includes("LocalFailure: String.Error"), false);
});

Deno.test("unary call collisions highlight the argument and retain its authored producer", async () => {
  for (const alias of [false, true]) {
    const source = `let extracted = String.extract("R48", 1, None);
${alias ? "let numStr = extracted;" : ""}
let n = Int64.fromString(${alias ? "numStr" : "extracted"});`;
    const argument = alias ? "numStr" : "extracted";
    const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
    const primary = error.diagnostic.primary;
    if (primary.kind !== "source") throw new Error("missing argument location");
    assertEquals(primary.span.start, source.lastIndexOf(argument));
    assertEquals(primary.span.end, source.lastIndexOf(argument) + argument.length);

    const rendered = formatDiagnostic(error.diagnostic, "day1.wm", source);
    assertStringIncludes(rendered, `type error: ${argument} can't be both:`);
    const origins = rendered.split("-- Origins")[1];
    assertStringIncludes(origins, 'let extracted = String.extract("R48", 1, None);');
    assertStringIncludes(origins, "day1.wm:1:17");
    assertStringIncludes(origins, "String.extract call result: Result<String, String.Slice_error>");
    assertEquals(origins.includes("subml-basis/subset_result.wm:"), false);
    assertEquals(origins.includes("subml-basis/subset_text_host.wm:"), false);
    assertStringIncludes(
      origins,
      "Int64.fromString signature: String -> Result<Int64.Int, Int64.Error>",
    );

    // Inspection still exposes the implementation evidence behind the public call.
    const detailed = formatDiagnosticInspection(error.diagnostic, "day1.wm", source);
    assertStringIncludes(detailed, "subml-basis/subset_result.wm:");
  }
});

Deno.test("signature origins shorten around the conflicting parameter at narrow widths", async () => {
  const source =
    'let numStr = String.extract("R48", 1, None);\nlet bad = Int64.fromString(numStr);';
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const previousColumns = Deno.env.get("COLUMNS");
  try {
    Deno.env.set("COLUMNS", "40");
    const rendered = formatDiagnostic(error.diagnostic, "day1.wm", source);
    const origins = rendered.split("-- Origins")[1];
    assertStringIncludes(origins, "Int64.fromString signature: String -> ..");
    assertStringIncludes(origins, "String.extract call result: Result<String, String.Slice_error>");
    assertEquals(origins.includes("subml-basis/"), false);
    const document = formatDiagnosticDocument(error.diagnostic, "day1.wm", source);
    assertEquals(
      document.lines.some((line) =>
        line.spans.some((part) => part.role === "type" && part.text === "String -> ..")
      ),
      true,
    );
  } finally {
    if (previousColumns === undefined) Deno.env.delete("COLUMNS");
    else Deno.env.set("COLUMNS", previousColumns);
  }
});

Deno.test("call origins follow an imported user callback through List.map", async () => {
  const entry = "/test/app/main.wm";
  const producer = "/test/app/producer.wm";
  const source = `from "./producer.wm" import { values };
let accept = (x: List<String>) => x;
let bad = accept(values);`;
  const files = new Map([
    [entry, source],
    [
      producer,
      `let number: Int32 = 1;
let values = List.map(["x"], _ => number);`,
    ],
  ]);
  const error = await assertRejects(() => checkVirtual(entry, files), ModuleAnalysisError);
  if (!(error.originalError instanceof FrontendDiagnosticError)) throw error.originalError;
  const diagnostic = error.originalError.diagnostic;
  const previousColumns = Deno.env.get("COLUMNS");
  try {
    for (const width of [120, 40]) {
      Deno.env.set("COLUMNS", String(width));
      const rendered = formatDiagnostic(diagnostic, entry, source);
      const origins = rendered.split("-- Origins")[1];
      assertStringIncludes(origins, "producer.wm:1:21");
      assertStringIncludes(origins, "let number: Int32 = 1;");
      assertEquals(origins.includes("subml-basis/"), false);
      assertEquals(origins.includes("std/"), false);
    }
  } finally {
    if (previousColumns === undefined) Deno.env.delete("COLUMNS");
    else Deno.env.set("COLUMNS", previousColumns);
  }
});

Deno.test("branch collisions show library calls in user code as origins", async () => {
  for (
    const expression of [
      'if (true) { String.extract("R48", 1, None) } else { "x" }',
      'match(true) { true => String.extract("R48", 1, None), false => "x" }',
    ]
  ) {
    const source = `let bad = ${expression};`;
    const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
    const rendered = formatDiagnostic(error.diagnostic, "branch.wm", source);
    const origins = rendered.split("-- Origins")[1];
    assertStringIncludes(origins, "String.extract");
    assertStringIncludes(origins, "Result<String, String.Slice_error>");
    assertStringIncludes(origins, "branch.wm:1:");
    assertEquals(origins.includes("subml-basis/"), false);
    assertEquals(origins.includes("std/"), false);
  }
});

Deno.test("traversal callback collisions retain the library constraint and call-site head", async () => {
  const source = `record Pair = { first: Int32, second: Int32 };
let parsePair = (s: String) => {
  Ok(Pair(1, 2)) :> Result.debug
};
let bad = List.traverse(["1-2"], parsePair);`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  assertEquals(error.diagnostic.code, "type.call-argument-mismatch");
  const collision = error.diagnostic.support.entries.find((entry) => entry.kind === "collision");
  if (!collision || collision.kind !== "collision") throw new Error("missing collision");
  const observed = error.diagnostic.support.edges
    .filter((edge) => edge.to === collision.id && edge.role === "observed")
    .map((edge) => error.diagnostic.support.entries.find((entry) => entry.id === edge.from));
  const types = new Map(error.diagnostic.support.types.map((type) => [type.id, type.rendered]));
  const expected = observed.find((entry) =>
    entry?.kind === "claim" && entry.claim.kind === "has-type" &&
    types.get(entry.claim.type)?.startsWith("Result<")
  );
  if (!expected || expected.kind !== "claim" || expected.origin.kind !== "source") {
    throw new Error("missing source-aware Result expectation");
  }
  assertEquals(expected.origin.filePath, "subml-basis/subset_list.wm");
  const primary = error.diagnostic.primary;
  if (primary.kind !== "source") throw new Error("missing call-site head");
  assertEquals(primary.span.start, source.lastIndexOf("parsePair"));
  const rendered = formatDiagnostic(error.diagnostic, "app/day2.wm", source);
  assertStringIncludes(rendered, "type error: parsePair function type can't be both:");
  assertStringIncludes(rendered, "-> Result<T, U>  List.traverse callback");
  assertStringIncludes(rendered, "String -> Pair");
  assertEquals(rendered.includes("collision in callback"), false);
  const origins = rendered.split("-- Origins")[1].split("-- Provenance")[0];
  assertStringIncludes(origins, "Result<");
  assertStringIncludes(origins, "List.traverse callback result: Result<T, U>");
  assertStringIncludes(origins, "Result.debug");
  assertEquals(origins.includes("Ok(value) => { value }"), false);
  assertStringIncludes(origins, "List.traverse");
  assertEquals(rendered.includes("subml-basis/subset_list.wm:"), false);
  assertStringIncludes(rendered, "app/day2.wm:3:");
  assertEquals(origins.includes("std/result.wm:"), false);
  const detailed = formatDiagnosticInspection(error.diagnostic, "app/day2.wm", source);
  assertStringIncludes(detailed, "type error: parsePair function type");
  assertStringIncludes(detailed, "-> Result<T, U>  List.traverse callback");
  assertStringIncludes(detailed, "String -> Pair");
  assertEquals(detailed.includes("collision in callback"), false);
  assertStringIncludes(detailed, "-- Origins");
  const document = formatDiagnosticDocument(error.diagnostic, "app/day2.wm", source);
  const rows = document.lines.filter((row) =>
    row.spans.some((item) =>
      item.role === "secondary" && ["List.traverse callback", "parsePair"].includes(item.text)
    )
  );
  assertEquals(rows.length, 2);
  const text = rows.map((row) => row.spans.map((item) => item.text).join(""));
  assertEquals(text[0].indexOf("->"), text[1].indexOf("->"));
  assertEquals(text[0].indexOf("List.traverse callback"), text[1].indexOf("parsePair"));
  assertEquals(text[0].trimEnd().endsWith("List.traverse callback"), true);
  assertEquals(text[1].trimEnd().endsWith("parsePair"), true);
});

Deno.test("generic forwarding calls keep the caller's origin beside concrete library constraints", async () => {
  const source = `record Pair = { first: Int32, second: Int32 };
let parsePair = (s: String) => Result.debug(Ok(Pair(1, 2)));
let bad = List.traverse(["1-2"], parsePair);`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const rendered = formatDiagnostic(error.diagnostic, "app/direct.wm", source);
  const origins = rendered.split("-- Origins")[1];
  assertStringIncludes(origins, "Result.debug(Ok(Pair(1, 2)))");
  assertStringIncludes(origins, "app/direct.wm:2:");
  assertStringIncludes(origins, "List.traverse callback result: Result<T, U>");
  assertEquals(origins.includes("subml-basis/"), false);
  assertEquals(origins.includes("std/result.wm:"), false);
});

Deno.test("pipe argument collisions retain both origins and highlight the explicit argument", async () => {
  const source = `type ParseError = | ExpectedPair;
let bad = Int32.fromString("12") :> Result.mapErr(ExpectedPair);`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  assertEquals(error.diagnostic.code, "type.pipe-input-mismatch");
  const primary = error.diagnostic.primary;
  if (primary.kind !== "source") throw new Error("missing argument location");
  assertEquals(primary.span.start, source.lastIndexOf("ExpectedPair"));
  assertEquals(primary.span.end, source.lastIndexOf("ExpectedPair") + "ExpectedPair".length);
  const rendered = formatDiagnostic(error.diagnostic, "app/mapper.wm", source);
  assertStringIncludes(rendered, "type error: Result.mapErr argument 1 can't be both:");
  assertStringIncludes(rendered, "ParseError");
  assertStringIncludes(rendered, "-> T");
  const origins = rendered.split("-- Origins")[1];
  assertStringIncludes(origins, "Result.mapErr");
  assertEquals(origins.includes("subml-basis/subset_result.wm:"), false);
  assertStringIncludes(origins, "app/mapper.wm:2:");
  const detailed = formatDiagnosticInspection(error.diagnostic, "app/mapper.wm", source);
  assertEquals(detailed.includes("no source path was retained"), false);
  assertEquals(rendered.includes("expected:"), false);
  assertEquals(rendered.includes("actual:"), false);
});

Deno.test("unwrapped Result arms keep their full excerpt and a tentative hint", async () => {
  for (const piped of [true, false]) {
    const source = `type Problem = | Bad;
${
      piped
        ? "let bad = Ok(1) :> Result.mapErr((_) => Bad) :> match {"
        : "let input: Result<Int32, Problem> = Err(Bad);\nlet bad = match(input) {"
    }
  Ok(n) => Ok(n),
  Err(e) => e
};`;
    const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
    const rendered = formatDiagnostic(error.diagnostic, "unwrap.wm", source);
    assertStringIncludes(rendered, "Err(e) => e");
    assertEquals(rendered.includes("Err(e) => {..}"), false);
    const hint = "Hint: Did you accidentally unwrap?";
    assertEquals(rendered.split(hint).length - 1, 1);
    assertEquals(rendered.includes("Err(e) => Err(e)"), false);
    const payloadClaim = error.diagnostic.support.entries.find((entry) =>
      entry.kind === "claim" && entry.claim.kind === "has-type" &&
      entry.claim.subject === "returned constructor payload"
    );
    if (!payloadClaim || payloadClaim.kind !== "claim" || payloadClaim.claim.kind !== "has-type") {
      throw new Error("missing payload result evidence");
    }
    const typeId = payloadClaim.claim.type;
    const type = error.diagnostic.support.types.find((type) => type.id === typeId);
    assertEquals(type?.rendered, "Problem");
    const detailed = formatDiagnosticInspection(error.diagnostic, "unwrap.wm", source);
    assertStringIncludes(detailed, hint);
    const document = formatDiagnosticDocument(error.diagnostic, "unwrap.wm", source);
    assertEquals(
      document.lines.flatMap((row) => row.spans)
        .some((item) => item.role === "hint" && item.text.includes(hint)),
      true,
    );
  }
});

Deno.test("unwrap hints cover constructor payloads beyond errors and either arm order", async () => {
  const cases = [
    {
      prefix: "",
      input: "Some(one)",
      arms: ["None => None", "Some(x) => x"],
      payload: "Int32.Int",
    },
    {
      prefix: "",
      input: "Ok(one)",
      arms: ["Err(e) => Err(e)", "Ok(x) => x"],
      payload: "Int32.Int",
    },
    {
      prefix: "type Box<a> = Empty | Boxed<a>;",
      input: "Boxed(one)",
      arms: ["Empty => Empty", "Boxed(x) => x"],
      payload: "Int32.Int",
    },
    { prefix: "", input: "[one]", arms: ["[] => []", "[x, ..rest] => x"], payload: "Int32.Int" },
  ];
  for (const item of cases) {
    for (const reverse of [false, true]) {
      const arms = reverse ? [...item.arms].reverse() : item.arms;
      const source = `${item.prefix}\nlet one: Int32 = 1;\nlet bad = ${item.input} :> match {\n${
        arms.join(",\n")
      }\n};`;
      const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
      const rendered = formatDiagnostic(error.diagnostic, "payload.wm", source);
      assertStringIncludes(rendered, "Hint: Did you accidentally unwrap?");
      const claim = error.diagnostic.support.entries.find((entry) =>
        entry.kind === "claim" && entry.claim.kind === "has-type" &&
        entry.claim.subject === "returned constructor payload"
      );
      if (!claim || claim.kind !== "claim" || claim.claim.kind !== "has-type") {
        throw new Error("missing payload type");
      }
      const typeId = claim.claim.type;
      assertEquals(
        error.diagnostic.support.types.find((type) => type.id === typeId)?.rendered,
        item.payload,
      );
    }
  }
});

Deno.test("intentional payload returns do not receive an accidental unwrap hint", async () => {
  const source = `let input: Result<Int32, Int32> = Err(1);
let value = match(input) {
  Ok(n) => n,
  Err(e) => e
};
let bad = String.length(value);`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const rendered = formatDiagnosticInspection(error.diagnostic, "intentional.wm", source);
  assertEquals(rendered.includes("Did you accidentally unwrap"), false);
});

Deno.test("return annotation mismatches point at the final expression and retain the annotation", async () => {
  for (const trailing of [false, true]) {
    const source = `type CErr = | Failed;
record Spin = {distance: Int64};
let parse = (str)${trailing ? "" : ": List<Spin>"} => {
  let toks: Result<List<Spin>, CErr> = Ok([]);
  toks
}${trailing ? ": List<Spin>" : ""};`;
    const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
    const primary = error.diagnostic.primary;
    if (primary.kind !== "source") throw new Error("missing returning expression");
    assertEquals(primary.span.start, source.lastIndexOf("toks"));
    assertEquals(primary.span.end, source.lastIndexOf("toks") + 4);
    const rendered = formatDiagnostic(error.diagnostic, "return.wm", source);
    assertStringIncludes(rendered, "type error: toks can't be both:");
    const origins = rendered.split("-- Origins")[1];
    assertStringIncludes(origins, "return annotation: List<Spin>");
    assertStringIncludes(origins, "return expression: Result<List<Spin>, CErr>");
    assertStringIncludes(origins, `return.wm:${trailing ? "6:4" : "3:20"}`);
    assertEquals(rendered.includes("parseASpi"), false);
  }
});

Deno.test("return mismatches from a discarded expression point at its terminating semicolon", async () => {
  const source = `let f = (): Int32 => {
  let local: Int32 = 1;
  local;
};`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const primary = error.diagnostic.primary;
  if (primary.kind !== "source") throw new Error("missing return location");
  assertEquals(primary.span.start, source.lastIndexOf("local;") + 5);
  assertEquals(primary.span.end, primary.span.start + 1);
  const rendered = formatDiagnostic(error.diagnostic, "void-return.wm", source);
  assertStringIncludes(rendered, "return annotation: Int32.Int");
  assertStringIncludes(rendered, "this trailing `;` makes the block result Void");
});

Deno.test("parameter annotation mismatch uses the authored collision renderer", async () => {
  const source = `let consumeText = (thing) => { thing == "text" };
let useKind = (kind: Real64.Real) => { consumeText(kind) };`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatDiagnostic(error.diagnostic, "case.wm", source);
  assertStringIncludes(rendered, "type error: parameter thing can't be both:");
  assertStringIncludes(rendered, "annotation requires: Real64.Real");
  assertStringIncludes(rendered, "parameter thing inferred as: String");
  assertStringIncludes(rendered, "case.wm:1:");
  assertStringIncludes(rendered, "case.wm:2:");
  assertEquals(rendered.includes("collision:"), false);
  assertEquals(rendered.includes("typetrace:"), false);
});

Deno.test("call arity mismatch retains callee and argument locations", async () => {
  const source = `let takes = (a: Real64.Real, b: String, c: Bool, d: Real64.Real) => { void };
let f = (x: Real64.Real) => {
  takes(
    x "text",
    true,
    1
  )
};`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatDiagnosticInspection(error.diagnostic, "case.wm", source);
  assertStringIncludes(rendered, "takes expects 4 arguments but got 3");
  assertStringIncludes(rendered, "4 parameters declared here");
  assertStringIncludes(rendered, "3 arguments supplied here");
  assertStringIncludes(rendered, "case.wm:1:14");
  assertStringIncludes(rendered, "case.wm:4:5");
  assertEquals(rendered.includes("no source path was retained"), false);
});

Deno.test("HM call collision renders neutral origins and both provenance paths", async () => {
  const source = `record Coord = { x: Real64.Real, y: Real64.Real };
type Step<State> = | Continue<State>;
let coordUpdate = (coord) => {};
let update = match(event, model) => {
  (0, _) => { Continue(coordUpdate(model)) },
  _ => { Continue(model) },
};
let run = (initial, updateFn) => { updateFn(0, initial) };
let bad = run(.{ x=0, y=0 }, update);`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatDiagnostic(error.diagnostic, "case.wm", source);
  assertStringIncludes(rendered, "Error: TYPE CHECKER[type.call-argument-mismatch]");
  assertStringIncludes(rendered, "type error: update function type can't be both:");
  assertStringIncludes(rendered, "-> T");
  assertStringIncludes(rendered, "run callback");
  assertStringIncludes(rendered, "-> Step<Void>  update");
  assertEquals(rendered.includes("collision in callback"), false);
  assertStringIncludes(rendered, "case.wm:9:");
  assertEquals(rendered.includes(" ~ "), false);
  assertStringIncludes(rendered, "Coord");
  assertStringIncludes(rendered, "Void");
  assertStringIncludes(rendered, ".{ x=0, y=0 }");
  assertStringIncludes(rendered, "let coordUpdate = (coord) => {}");
  assertStringIncludes(rendered, "empty block result: Void");
  assertStringIncludes(rendered, "record literal: Coord");
  assertStringIncludes(rendered, "-- Origins ");
  assertStringIncludes(rendered, "│");
  assertStringIncludes(rendered, "use wm err case.wm to see a more detailed error");
  assertEquals(rendered.includes("-- Provenance "), false);
  assertEquals(rendered.includes("Collision at"), false);
  assertEquals(rendered.includes("expected:"), false);
  assertEquals(rendered.includes("actual:"), false);

  const document = formatDiagnosticDocument(error.diagnostic, "case.wm", source);
  assertEquals(document.lines[0].spans[0], { text: "Error:", role: "error" });
  assertEquals(document.lines[0].spans[1].role, "header");
  const typed = document.lines.flatMap((line) => line.spans)
    .filter((span) => span.role === "type")
    .map((span) => span.text);
  assertEquals(typed, [
    "(Int32.Int, Coord) -> T",
    " (Int32.Int, Void) -> Step<Void>",
    "Void",
    "Coord",
  ]);
  const hint = document.lines.flatMap((line) => line.spans)
    .find((span) => span.text.startsWith("Hint: use wm err"));
  assertEquals(hint?.role, "hint");

  const inspection = formatDiagnosticInspection(error.diagnostic, "case.wm", source);
  assertStringIncludes(inspection, "-- Provenance ");
  assertStringIncludes(inspection, "case.wm:");
  assertStringIncludes(inspection, " : ");
  assertStringIncludes(inspection, "* low-level diagnostic:");
  assertStringIncludes(inspection, "rule: InferCall.Argument");
  assertStringIncludes(inspection, "support:");
  assertStringIncludes(inspection, "* compiler trace:");
});

Deno.test("call mismatch prefers use-site argument over callee definition", async () => {
  const source = `
from js.global("Math") import { sin as msin };
let viaR = Monad.via Result;
let sin = viaR msin;
let uw = match(res) => { Ok(i) => { i }, Err(_) => { Panic("bad") } };
let main = () => {
  let time = Ok(1.5) :> uw;
  let pulse = 0.55 + sin(time * 2):>uw * 0.25;
};
`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const primary = error.diagnostic.primary;
  if (primary.kind !== "source") {
    throw new Error("expected source primary diagnostic");
  }
  const expectedStart = source.indexOf("time * 2");
  assertEquals(primary.span.start, expectedStart);
  assertEquals(primary.span.end, expectedStart + "time * 2".length);
});

Deno.test("call mismatch preserves the nested HM constraint origin through generalization", async () => {
  const source = `let printList = (list) => {
  let rec listPrinter = (l, i) => {
    (match(l) {
      Cons(x, rest) => { x },
      Nil => { "no" },
    }) :> print
  };
  listPrinter(list, 0)
};

let tokens: List<Real64.Real> = [];
let bad = printList(tokens);`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const literalStart = source.indexOf('"no"');
  const stringOrigin = error.diagnostic.support.entries.find((entry) =>
    entry.kind === "claim" && entry.claim.kind === "has-type" &&
    entry.origin.kind === "source" && entry.origin.span.start === literalStart
  );
  assertEquals(stringOrigin?.kind, "claim");
  const rendered = formatDiagnostic(error.diagnostic, "nested-origin.wm", source);
  assertStringIncludes(rendered, 'Nil => { "no" }');
});

Deno.test("carrier tuple mismatch points at offending item", async () => {
  const source = `let bad = Result|1, Ok("a")|;`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const primary = error.diagnostic.primary;
  if (primary.kind !== "source") {
    throw new Error("expected source primary diagnostic");
  }
  const expectedStart = source.indexOf("1");
  assertEquals(primary.span.start, expectedStart);
  assertEquals(primary.span.end, expectedStart + "1".length);
});

Deno.test("carrier tuple mismatch points at later offending item", async () => {
  const source = `let bad = Result|Ok("a"), 32, Ok(true)|;`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const primary = error.diagnostic.primary;
  if (primary.kind !== "source") {
    throw new Error("expected source primary diagnostic");
  }
  const expectedStart = source.indexOf("32");
  assertEquals(primary.span.start, expectedStart);
  assertEquals(primary.span.end, expectedStart + "32".length);
});

Deno.test("multi-argument call mismatch points at offending argument", async () => {
  const source = `let draw = (x: Real64.Real, y: Real64.Real) => { x }; let bad = draw(1, Ok(2));`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const primary = error.diagnostic.primary;
  if (primary.kind !== "source") {
    throw new Error("expected source primary diagnostic");
  }
  const expectedStart = source.indexOf("Ok(2)");
  assertEquals(primary.span.start, expectedStart);
  assertEquals(primary.span.end, expectedStart + "Ok(2)".length);
});

Deno.test("basic diagnostic summary displays generic variables TypeScript style", async () => {
  const source = `


let rec filterList = (fn, list) => {
  match(list) => {
    [] => {[]},
    [head, ..tail] => {
      if (fn(head)) {
        [head, ..filterList(fn, tail)]
      } else {
        filterList(fn, tail)
      }
    }
  }
};
`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const summary = renderDiagnosticSummary(error.diagnostic);
  assertStringIncludes(summary, "List<T>");
  assertEquals(summary.includes("'"), false);
});

Deno.test("pipe mismatch records a pipe step premise", async () => {
  const error = await assertRejects(
    () => checkSource('let render = (n: Real64.Real) => { n }; let bad = "x" :> render;'),
    FrontendDiagnosticError,
  );

  assertEquals(error.diagnostic.code, "type.pipe-input-mismatch");
  assertEquals(error.diagnostic.failure.frame.rule, "InferPipe.StepInput");
  assertEquals(error.diagnostic.failure.premise.role, "pipe output matches next function input");
  assertEquals(constraintRoles(error.diagnostic), ["callee", "pipe function"]);
  assertEquals(claimSubjects(error.diagnostic), [
    "render",
    "render call result",
    "piped value",
    "pipe result",
    "render pipe",
  ]);
});

Deno.test("pipe mismatch uses the enhanced authored renderer", async () => {
  const source = 'let render = (n: Real64.Real) => { n };\nlet bad = "x" :> render;';
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatDiagnostic(error.diagnostic, "Main.wm", source);
  assertStringIncludes(rendered, "Error: TYPE CHECKER[type.pipe-input-mismatch]");
  assertStringIncludes(rendered, "Main.wm");
  assertStringIncludes(rendered, "type error: render pipe input can't be both:");
  assertStringIncludes(rendered, 'let bad = "x"');
  assertStringIncludes(rendered, ": String");
  assertStringIncludes(rendered, 'let bad = "x" :> render');
  assertStringIncludes(rendered, "  - Real64.Real");
  assertStringIncludes(rendered, "-- Origins");
});

Deno.test("a separately bound projection callback specializes through a pipe", async () => {
  const source = `record ProfileCore = { did: String, handle: String };
record ActorCore = { did: String, handle: String };
type Actor = | Actor<String, String>;
let input: Result<ActorCore, Js.Error> = Err(Js.Unknown);
let toActor = (core) => { Actor(core.did, core.handle) };
let result = input :> Result.map(toActor);`;
  const result = await checkSource(source);
  assertEquals(result.diagnostics, []);
  assertEquals(result.warnings, []);
});

Deno.test("REPL diagnostics keep one compact source excerpt", async () => {
  const source = 'let inc = (x: Real64.Real) => { x + 1 };\nlet bad = inc("no");';
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatReplDiagnostic(error.diagnostic, "Main.wm", source);
  assertStringIncludes(rendered, "error[type.call-argument-mismatch] Main.wm:2:");
  assertStringIncludes(rendered, "Real64.Real conflicts with String");
  assertStringIncludes(rendered, '2 | let bad = inc("no");');
  assertEquals(rendered.includes("Error: TYPE CHECKER"), false);
  assertEquals(rendered.includes("support:"), false);
  assertEquals(rendered.includes("rule:"), false);
  assertEquals(rendered.split("\n").filter(Boolean).length, 3);
});

Deno.test("REPL syntax explanations stay below the excerpt without truncating the hint", () => {
  const source = "let f = match(a,b) => print(1);";
  const details = [
    "`match (names) =>` declares named parameters and requires an arm list.",
    "If the parenthesized names are your first pattern, put braces around the arms:",
    "  match { (a, b) => expression, _ => fallback }",
  ].join("\n");
  const rendered = formatReplError(
    "Expected a match arm (`pattern => body`) after named match parameters.\n" + details,
    "Main.wm",
    source,
    { start: 27, end: 28, line: 1, col: 27 },
  );
  assertStringIncludes(rendered, "error[parse.syntax-error] Main.wm:1:28:");
  assertStringIncludes(rendered, "1 | " + source);
  assertEquals(rendered.endsWith(details + "\n"), true);
  assertEquals(rendered.includes("…"), false);
});

Deno.test("pipe mismatch points at trailing semicolon Void source", async () => {
  const source = `
let parseConfig: Real64.Real -> Result<String, Js.Error> = (n) => { Ok("ok") };
let input: Result<Real64.Real, Js.Error> = Err(Js.Unknown);
let bad = input
  :> Result.mapErr((e) => {
    e;
  })
  :> Result.andThen(parseConfig);
`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatDiagnostic(error.diagnostic, "test.wm", source);
  assertStringIncludes(rendered, "type error: Result.andThen argument 1 can't be both:");
  assertStringIncludes(rendered, ": Void");
  assertStringIncludes(rendered, ": Js.Error");
  assertStringIncludes(rendered, "6|     e;");
  assertStringIncludes(
    rendered,
    "this trailing `;` makes the block result Void",
  );
  assertStringIncludes(rendered, "let annotation: Js.Error");
});

Deno.test("recursive result mismatch explains accidental match function", async () => {
  const source = `


let rec filterList = (fn, list) => {
  match(list) => {
    [] => {[]},
    [head, ..tail] => {
      if (fn(head)) {
        [head, ..filterList(fn, tail)]
      } else {
        filterList(fn, tail)
      }
    }
  }
};
`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  assertEquals(error.diagnostic.code, "type.recursive-result-mismatch");
  const rendered = formatDiagnostic(error.diagnostic, "math.wm", source);
  assertStringIncludes(rendered, "`filterList` is recursive");
  assertStringIncludes(rendered, "Recursive calls produce:");
  assertStringIncludes(rendered, "List<T>");
  assertEquals(rendered.includes("'"), false);
  assertStringIncludes(rendered, "But the body produces:");
  assertStringIncludes(rendered, "match(list) => {");
  assertStringIncludes(rendered, "This looks like an accidental match-function expression.");
  assertStringIncludes(rendered, "Use `match(list) { ... }`");
});

Deno.test("reflected Result versus plain values use a source-aware type mismatch", async () => {
  const source = `from js.global("JSON") import { stringify } as JSON;
let accept = (text: String) => { text };
let bad = JSON.stringify(JSON{ ok: true }) :> accept;`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  assertEquals(error.diagnostic.code, "type.pipe-input-mismatch");
  const rendered = formatDiagnostic(error.diagnostic, "app/encode.wm", source);
  assertStringIncludes(rendered, "Result<String, Js.Error>");
  assertStringIncludes(rendered, "String");
  const origins = rendered.split("-- Origins")[1];
  assertStringIncludes(origins, "app/encode.wm:3:");
  assertStringIncludes(origins, "pipe output: Result<String, Js.Error>");
  assertEquals(rendered.includes("unwrap the Result first"), false);
});

Deno.test("declared plain JS results are not mislabeled as returning a Result", async () => {
  const source = `from js.global("JSON") import unsafe {
  stringify: Js.Value -> String,
} as JSON;
let encode = Monad.viaErr Task ((error) => { error }) (values) => {
  let (identifier, password) = values;
  JSON.stringify(JSON{ identifier: identifier, password: password }) :> Task.fromResult
};
let bad = encode(Task.succeed(("id", "secret")));`;
  const bundle = await assertRejects(() => checkSource(source), FrontendDiagnosticBundleError);
  if (!(bundle.primary instanceof FrontendDiagnosticError)) throw bundle.primary;
  const diagnostic = bundle.primary.diagnostic;
  assertEquals(diagnostic.code, "type.mismatch");
  const rendered = formatDiagnostic(diagnostic, "app/encode.wm", source);
  assertStringIncludes(rendered, "type error: JS call JSON.stringify can't be both:");
  assertStringIncludes(rendered, "JS call JSON.stringify return type: String");
  assertStringIncludes(rendered.split("-- Origins")[1], "app/encode.wm:2:26");
  assertStringIncludes(rendered, "Task.fromResult: Result<T, U>");
  assertStringIncludes(rendered, "app/encode.wm:6:");
  assertEquals(rendered.includes("unwrap the Result first"), false);
});

Deno.test("constructor pattern mismatches retain the matched value and pattern locations", async () => {
  const source = `from js.global("Deno") import unsafe { args: Js.Array<String> };
let main = () => {
  match(args) {
    Err(error) => { void },
    Ok(values) => { void }
  }
};`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const filePath = `${Deno.cwd()}/app/cli.wm`;
  const previousColumns = Deno.env.get("COLUMNS");
  try {
    for (const columns of [120, 40]) {
      Deno.env.set("COLUMNS", String(columns));
      const rendered = formatDiagnostic(error.diagnostic, filePath, source);
      const origins = rendered.split("-- Origins")[1];
      assertStringIncludes(rendered, "type error: Err(error) can't be both:");
      assertStringIncludes(origins, "app/cli.wm:1:46");
      assertStringIncludes(origins, "app/cli.wm:4:5");
      assertStringIncludes(origins, "Js.Array<String>");
      assertStringIncludes(origins, "Result<T, U>");
      assertStringIncludes(origins, "args import type");
      assertStringIncludes(origins, "Err(error)");
      assertEquals(rendered.includes(Deno.cwd()), false);
      const inspection = formatDiagnosticInspection(error.diagnostic, filePath, source);
      assertStringIncludes(inspection, "app/cli.wm:1:46");
      assertStringIncludes(inspection, "app/cli.wm:4:5");
    }
  } finally {
    if (previousColumns === undefined) Deno.env.delete("COLUMNS");
    else Deno.env.set("COLUMNS", previousColumns);
  }
});

Deno.test("pattern mismatch traces aliases across modules back to the JS import type", async () => {
  const importedSource = `from js.global("Deno") import unsafe { args: Js.Array<String> };
let values = args;`;
  const source = `from "../proto/args.wm" import { values };
let alias = values;
let bad = match(alias) {
  Err(error) => { void },
  Ok(value) => { void }
};`;
  const root = Deno.cwd().replaceAll("\\", "/");
  const filePath = `${root}/app/cli.wm`;
  const files = new Map([
    [filePath, source],
    [`${root}/proto/args.wm`, importedSource],
  ]);
  const error = await assertRejects(
    () => checkVirtual(filePath, files),
    ModuleAnalysisError,
  );
  if (!(error.originalError instanceof FrontendDiagnosticError)) {
    throw error.originalError;
  }
  const rendered = formatDiagnostic(error.originalError.diagnostic, filePath, source);
  const origins = rendered.split("-- Origins")[1];
  assertStringIncludes(origins, "proto/args.wm:1:46");
  assertStringIncludes(origins, "args import type: Js.Array<String>");
  assertStringIncludes(origins, "app/cli.wm:4:3");
  assertEquals(origins.includes("match(alias)"), false);
});

Deno.test("literal pattern mismatches retain match input context", async () => {
  const source = `let value = "hello";
let bad = match(value) {
  1 => { void },
  _ => { void }
};`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const rendered = formatDiagnostic(error.diagnostic, "app/literal.wm", source);
  const origins = rendered.split("-- Origins")[1];
  assertStringIncludes(origins, "String");
  assertStringIncludes(origins, "Real64.Real");
  assertStringIncludes(origins, "app/literal.wm:3:3");
  assertStringIncludes(origins, "pattern 1");
});

Deno.test("nested pattern mismatches retain the concrete payload origin", async () => {
  const source = `let bad = match(Some("hello")) {
  Some(1) => { void },
  _ => { void }
};`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const rendered = formatDiagnostic(error.diagnostic, "app/nested.wm", source);
  const origins = rendered.split("-- Origins")[1];
  assertStringIncludes(origins, "expression: String");
  assertStringIncludes(origins, "pattern 1: Real64.Real");
  assertStringIncludes(origins, "app/nested.wm:1:");
  assertStringIncludes(origins, "app/nested.wm:2:8");
});

Deno.test("match arm mismatch uses the shared neutral collision diagnostic", async () => {
  const source = `type AppError = | RenderError<String>;
let renderErr = (e) => { RenderError(e) };
let bad = match(true) {
  true => { Result|Err("js")| },
  false => { Err(renderErr("app")) }
};`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  assertEquals(error.diagnostic.code, "type.match-arm-results-disagree");
  const rendered = formatDiagnostic(error.diagnostic, "test.wm", source);
  assertStringIncludes(rendered, "Error: TYPE CHECKER[type.match-arm-results-disagree]");
  assertStringIncludes(rendered, "type error: match arms can't be both:");
  assertStringIncludes(rendered, '4|   true => { Result|Err("js")| }');
  assertStringIncludes(rendered, '5|   false => { Err(renderErr("app")) }');
  assertStringIncludes(rendered, ": Result<T, String>");
  assertStringIncludes(rendered, ": Result<T, AppError>");
  assertStringIncludes(rendered, "expression: String");
  assertStringIncludes(rendered, "RenderError call result: AppError");
  assertStringIncludes(rendered, "-- Origins ");
  assertStringIncludes(rendered, "use wm err test.wm to see a more detailed error");
  assertEquals(rendered.includes("These match arms return different types."), false);
  assertEquals(rendered.includes("expected: AppError"), false);
});

Deno.test("match arm summaries retain relative file locations at wide and narrow widths", async () => {
  const source = `let parse = match(value) => {
  None => { Ok(1) },
  Some(value) => { 2 }
};`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const filePath = `${Deno.cwd()}/app/cli.wm`;
  const previousColumns = Deno.env.get("COLUMNS");
  try {
    for (const columns of [120, 40]) {
      Deno.env.set("COLUMNS", String(columns));
      const rendered = formatDiagnostic(error.diagnostic, filePath, source);
      const summary = rendered.split("-- Origins")[0];
      assertStringIncludes(summary, "app/cli.wm:2:");
      assertStringIncludes(summary, "app/cli.wm:3:");
      assertStringIncludes(rendered, "use wm err app/cli.wm");
      assertEquals(rendered.includes(Deno.cwd()), false);
      const inspection = formatDiagnosticInspection(error.diagnostic, filePath, source);
      assertStringIncludes(inspection, "app/cli.wm:2:");
      assertStringIncludes(inspection, "app/cli.wm:3:");
    }
  } finally {
    if (previousColumns === undefined) Deno.env.delete("COLUMNS");
    else Deno.env.set("COLUMNS", previousColumns);
  }
});

Deno.test("match arm collision traces Void to an ending semicolon", async () => {
  const source = `record Coord = { x: Real64.Real, y: Real64.Real };
type Step<State> = | Continue<State> | Quit;
let coordUpdate = (coord) => {
  coord;
};
let update = match(event, model) => {
  (0, _) => { Continue(coordUpdate(model)) },
  (1, _) => { Continue(coordUpdate(model)) },
  (2, _) => { Continue(coordUpdate(model)) },
  (3, _) => { Continue(coordUpdate(model)) },
  (4, _) => { Quit },
  _ => { Continue(.{..model, x=model.x}) },
};`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatDiagnostic(error.diagnostic, "case.wm", source);
  assertStringIncludes(rendered, "type error: match arms can't be both:");
  assertStringIncludes(rendered, "10|   (3, _) => { Continue(coordUpdate(model)) }");
  assertStringIncludes(rendered, "12|   _ => { Continue(.{..model, x=model.x}) }");
  assertStringIncludes(rendered, ": Step<Void>");
  assertStringIncludes(rendered, ": Step<Coord>");
  assertEquals(rendered.includes("11|   (4, _) => {..}"), false);
  assertStringIncludes(rendered, "^ ending semicolon: Void");
  assertStringIncludes(rendered, "record literal: Coord");

  const document = formatDiagnosticDocument(error.diagnostic, "case.wm", source);
  const types = document.lines.flatMap((line) => line.spans)
    .filter((span) => span.role === "type")
    .map((span) => span.text);
  assertEquals(types, ["Step<Void>", "Step<Coord>", "Void", "Coord"]);

  const inspection = formatDiagnosticInspection(error.diagnostic, "case.wm", source);
  assertStringIncludes(inspection, "10|   (3, _) => { Continue(coordUpdate(model)) }");
  assertStringIncludes(inspection, "12|   _ => { Continue(.{..model, x=model.x}) }");
  assertStringIncludes(inspection, "-- Provenance ");
  assertStringIncludes(inspection, "* low-level diagnostic:");
});

Deno.test("if branch mismatch records an if branch premise", async () => {
  const source = `let bad = if (true) {
  true
} else {
  "x"
};`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  assertEquals(error.diagnostic.code, "type.if-branch-results-disagree");
  assertEquals(error.diagnostic.failure.frame.rule, "InferIf.BranchesSameType");
  assertEquals(error.diagnostic.failure.premise.role, "if branches have the same type");
  assertEquals(constraintRoles(error.diagnostic), ["then branch", "else branch"]);
  const rendered = formatDiagnostic(error.diagnostic, "if.wm", source);
  assertStringIncludes(rendered, "type error: if branches can't be both:");
  assertStringIncludes(rendered, "1| let bad = if (true) {..}: Bool");
  assertStringIncludes(rendered, "3| } else {..}");
  assertStringIncludes(rendered, ": String");
  assertStringIncludes(rendered, "expression: Bool");
  assertStringIncludes(rendered, "expression: String");
  assertStringIncludes(rendered, "-- Origins");
});

Deno.test("if mismatch traces a recursive match result to its concrete empty arm", async () => {
  const source = `let rec loop = (flag) => {
  if (flag) {
    match(flag) {
      true => { loop(false) },
      false => {}
    }
  } else {
    [1]
  }
};`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  assertEquals(error.diagnostic.code, "type.if-branch-results-disagree");
  const rendered = formatDiagnostic(error.diagnostic, "recursive-if.wm", source);
  assertStringIncludes(rendered, "empty block result: Void");
  assertStringIncludes(rendered, "5|       false => {}");
  assertEquals(rendered.includes("Void — loop call result"), false);
});

Deno.test("compact collision excerpts collapse excessive indentation", async () => {
  const source = `let inc = (x: Real64.Real) => { x + 1 };
let main = () => {
                    inc("no")
};`;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );

  const rendered = formatDiagnostic(error.diagnostic, "indent.wm", source);
  assertStringIncludes(rendered, '3|   inc("no")');
  assertEquals(rendered.includes('3|                     inc("no")'), false);
  assertStringIncludes(rendered, "indent.wm:3:25");
});

Deno.test("binary operand mismatch records an operator premise", async () => {
  const error = await assertRejects(
    () => checkSource('let bad = 1 + "x";'),
    FrontendDiagnosticError,
  );

  assertEquals(error.diagnostic.failure.frame.rule, "InferBinary.OperatorOperands");
  assertEquals(error.diagnostic.failure.premise.role, "operator operands match operator type");
  assertEquals(constraintRoles(error.diagnostic), ["operator", "operands"]);
  assertEquals(
    [`operator +: "('num, 'num) -> 'num"`, "left operand", "right operand"]
      .every((subject) => claimSubjects(error.diagnostic).includes(subject)),
    true,
  );
});

Deno.test("panic message mismatch records a panic premise", async () => {
  const error = await assertRejects(
    () => checkSource("let bad = Panic(1);"),
    FrontendDiagnosticError,
  );

  assertEquals(error.diagnostic.failure.frame.rule, "InferPanic.MessageString");
  assertEquals(error.diagnostic.failure.premise.role, "panic message is String");
  assertEquals(constraintRoles(error.diagnostic), ["required type", "message"]);
});

Deno.test("unary operand mismatch records a unary premise", async () => {
  const error = await assertRejects(
    () => checkSource('let bad = -"x";'),
    FrontendDiagnosticError,
  );

  assertEquals(error.diagnostic.failure.frame.rule, "InferUnary.NumericOperand");
  assertEquals(
    error.diagnostic.failure.premise.role,
    "unary - operand has a supported numeric type",
  );
  assertEquals(constraintRoles(error.diagnostic), ["required type", "operand"]);
});

function constraintRoles(diagnostic: FrontendDiagnostic): string[] {
  const entry = diagnostic.support.entries.find((item) => item.kind === "constraint");
  return entry?.kind === "constraint" ? entry.roles.map((role) => role.role) : [];
}

function claimSubjects(diagnostic: FrontendDiagnostic): string[] {
  return diagnostic.support.entries
    .filter((entry) => entry.kind === "claim")
    .map((entry) => entry.claim.subject);
}

Deno.test("pipe mismatches show the authored producer instead of a library implementation", async () => {
  const source = `let add = (a: Int64, b: Int32) =>
  (a, Int64.fromInt32(b)) :> Int64.checkedAdd :> Option.toResult :> Result.debug;
let total = [1, 2] :> List.foldLeft((0: Int64), add);`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const rendered = formatDiagnostic(error.diagnostic, "day2.wm", source);
  assertStringIncludes(rendered, "type error: Option.toResult pipe input can't be both:");
  assertStringIncludes(rendered, "  - Result<Int64.Int, Int64.Error>");
  assertStringIncludes(rendered, "  - (Option<T>, U)");
  assertStringIncludes(rendered, "Int64.checkedAdd :> Option.toResult");
  assertStringIncludes(rendered, "day2.wm:2:");
  assertEquals(rendered.includes("std/int64.wm:"), false);
  assertEquals(rendered.includes("List.foldLeft((0: Int64), add){..}"), false);
  const detailed = formatDiagnosticInspection(error.diagnostic, "day2.wm", source);
  assertStringIncludes(detailed, "std/int64.wm:");
  assertStringIncludes(detailed, "if ((b > 0 && a > maximum - b)");
  assertEquals(detailed.includes("List.foldLeft((0: Int64), add){..}"), false);
  const document = formatDiagnosticDocument(error.diagnostic, "day2.wm", source);
  assertEquals(
    document.lines.some((row) =>
      row.spans.some((part) =>
        part.role === "type" && part.text === "Result<Int64.Int, Int64.Error>"
      )
    ),
    true,
  );
});

Deno.test("pipe input mismatches show whole container types instead of only differing leaves", async () => {
  const source = `let render = (values: List<String>) => values;
let values: List<Int32> = [1, 2];
let bad = values :> render;`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const rendered = formatDiagnostic(error.diagnostic, "lists.wm", source);
  assertStringIncludes(rendered, "  - List<Int32.Int>");
  assertStringIncludes(rendered, "  - List<String>");
});

Deno.test("a pipe input mismatch excludes the fixed arguments from the expected input type", async () => {
  const source = "let bad = (42: Int32) :> List.map(x => x);";
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const rendered = formatDiagnostic(error.diagnostic, "map.wm", source);
  assertStringIncludes(rendered, "  - Int32.Int");
  assertStringIncludes(rendered, "  - List<T>");
});

Deno.test("authored pipe boundaries retain their types without source text and at narrow widths", async () => {
  const source = "let bad = Int64.checkedAdd(1, 2) :> Option.toResult;";
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const withoutSource = formatDiagnostic(error.diagnostic, "day2.wm", undefined);
  assertStringIncludes(withoutSource, "type error: Option.toResult pipe input can't be both:");
  assertStringIncludes(withoutSource, "  - Result<Int64.Int, Int64.Error>");
  const previousColumns = Deno.env.get("COLUMNS");
  try {
    for (const columns of [120, 40]) {
      Deno.env.set("COLUMNS", String(columns));
      const rendered = formatDiagnostic(error.diagnostic, `${Deno.cwd()}/day2.wm`, source);
      assertStringIncludes(rendered, "day2.wm:1:");
      assertStringIncludes(rendered, "  - (Option<T>, U)");
      assertEquals(rendered.includes("std/int64.wm:"), false);
      assertEquals(rendered.includes(Deno.cwd()), false);
    }
  } finally {
    if (previousColumns === undefined) Deno.env.delete("COLUMNS");
    else Deno.env.set("COLUMNS", previousColumns);
  }
});

Deno.test("carrier continuations retain the operation introducing their error type", async () => {
  const source = `type CErr = | SliceErr<String.Slice_error>;
let num = String.extract("12", 0, None)
  :> Result.mapErr(SliceErr)
  :> Monad.via Result =>
  :> Int64.fromString;`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const previousColumns = Deno.env.get("COLUMNS");
  try {
    for (const width of [120, 40]) {
      Deno.env.set("COLUMNS", String(width));
      const rendered = formatDiagnostic(error.diagnostic, "day1.wm", source);
      assertStringIncludes(rendered, "  - Result<String, CErr>");
      assertStringIncludes(rendered, "  - Result<String, Int64.Error>");
      const origins = rendered.split("-- Origins")[1];
      assertStringIncludes(origins, "SliceErr: CErr");
      assertStringIncludes(origins, "Int64.fromString call result: Int64.Error");
      assertStringIncludes(origins, "day1.wm:5:6");
      assertEquals(origins.includes("next stage input"), false);
      assertEquals(origins.includes("std/int64.wm:"), false);
      assertEquals(origins.includes("subml-basis/"), false);
    }
  } finally {
    if (previousColumns === undefined) Deno.env.delete("COLUMNS");
    else Deno.env.set("COLUMNS", previousColumns);
  }
  const withoutSource = formatDiagnostic(error.diagnostic, "day1.wm", undefined);
  assertStringIncludes(withoutSource, "Int64.fromString call result: Int64.Error");
  assertStringIncludes(
    formatDiagnosticInspection(error.diagnostic, "day1.wm", source),
    "std/int64.wm:",
  );
});

Deno.test("continuation error origins traverse a user helper across modules", async () => {
  const entry = "/test/main.wm";
  const source = `from "./parse.wm" import { parse };
type CErr = | SliceErr<String.Slice_error>;
let num = String.extract("12", 0, None)
  :> Result.mapErr(SliceErr)
  :> Monad.via Result =>
  :> parse;`;
  const error = await assertRejects(() =>
    checkVirtual(
      entry,
      new Map([
        [entry, source],
        ["/test/parse.wm", "let parse = text => text :> Int64.fromString;"],
      ]),
    ), ModuleAnalysisError);
  if (!(error.originalError instanceof FrontendDiagnosticError)) throw error.originalError;
  const rendered = formatDiagnostic(error.originalError.diagnostic, entry, source);
  const origins = rendered.split("-- Origins")[1];
  assertStringIncludes(origins, "Int64.fromString call result: Int64.Error");
  assertStringIncludes(origins, "parse.wm:1:");
  assertEquals(origins.includes("std/int64.wm:"), false);
});

Deno.test("nested pipe error origins point to the predicate operation through a carrier traversal", async () => {
  const source = `type ParseError = | InvalidInput;
let parsed: Result<List<Int64>, ParseError> = Ok([11, 22]);
let predicate = n => List.splitAt([n], 0) :> Result.map(_ => true);
let filter = Monad.via Result items => Monad.traverse(items, Result, predicate);
let mapped = parsed :> filter;`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const previousColumns = Deno.env.get("COLUMNS");
  try {
    for (const width of [120, 40]) {
      Deno.env.set("COLUMNS", String(width));
      const rendered = formatDiagnostic(error.diagnostic, "filter.wm", source);
      const origins = rendered.split("-- Origins")[1];
      assertStringIncludes(origins, "filter.wm:3:");
      assertStringIncludes(origins, "List.splitAt call result: List.Error");
      assertEquals(origins.includes("next stage input: Result"), false);
      assertEquals(rendered.includes("mapErr"), false);
    }
  } finally {
    if (previousColumns === undefined) Deno.env.delete("COLUMNS");
    else Deno.env.set("COLUMNS", previousColumns);
  }
});

Deno.test("mapErr with a nullary constructor suggests a payload qualified by its owning module", async () => {
  const source = `type ParseError = | TabErr;
let bad = List.tabulate(3, i => i) :> Result.mapErr(TabErr);`;
  const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  const rendered = formatDiagnostic(error.diagnostic, "tabulate.wm", source);
  const hint = "Did you mean to declare TabErr with a payload, as TabErr<List.Error>?";
  assertStringIncludes(rendered, hint);
  assertEquals(rendered.split(hint).length - 1, 1);
  assertStringIncludes(formatDiagnosticInspection(error.diagnostic, "tabulate.wm", source), hint);
  const document = formatDiagnosticDocument(error.diagnostic, "tabulate.wm", source);
  assertEquals(
    document.lines.some((row) =>
      row.spans.some((part) => part.role === "hint" && part.text.includes(hint))
    ),
    true,
  );
});

Deno.test("constructor payload hints work for other mapper functions and input types", async () => {
  for (
    const [source, expected] of [
      [
        `type Failure = | NumberFailed;
let bad = Result.mapErr(Int64.parseDecimal("12"), NumberFailed);`,
        "NumberFailed<Int64.Error>",
      ],
      [
        `type Failure = | Wrapped;
let accept = (mapper: String -> Failure) => mapper("value");
let bad = accept(Wrapped);`,
        "Wrapped<String>",
      ],
    ]
  ) {
    const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
    const rendered = formatDiagnostic(error.diagnostic, "mapper.wm", source);
    assertStringIncludes(rendered, expected);
    assertStringIncludes(rendered, "Did you mean to declare");
  }
});

Deno.test("payload suggestions require a constructor and a concrete unary mapper input", async () => {
  for (
    const source of [
      `let value = 42; let bad = List.tabulate(3, i => i) :> Result.mapErr(value);`,
      `type Failure = | Wrapped;
let bad = [] :> List.map(Wrapped);`,
    ]
  ) {
    const error = await assertRejects(() => checkSource(source), FrontendDiagnosticError);
    assertEquals(
      formatDiagnostic(error.diagnostic, "mapper.wm", source).includes("Did you mean to declare"),
      false,
    );
  }
  const checked = await checkSource(`type Failure = | TabErr<List.Error>;
let mapped = List.tabulate(3, i => i) :> Result.mapErr(TabErr);`);
  assertEquals(checked.diagnostics, []);
});
