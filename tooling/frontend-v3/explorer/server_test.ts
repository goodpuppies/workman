import { assertEquals } from "@std/assert";
import { loadLexer } from "./bootstrap.ts";
import { handler } from "./server.ts";
import type { LexResponse } from "./model.ts";

Deno.test("explorer transports v3 marks and distinguishes source faults from unfinished code", async () => {
  const handle = handler(await loadLexer());
  const request = (source: string) => handle(new Request("http://localhost/api/lex", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source }),
  }));

  const response = await request('{ "\\q" /*');
  assertEquals(response.status, 200);
  const result = await response.json() as LexResponse;
  if (!result.success) throw new Error(result.error.message);
  const { tokens, marks } = result.document;
  assertEquals(marks.map((mark) => mark.problem.name), [
    "UnmatchedDelimiter", "InvalidEscape", "UnterminatedBlockComment",
  ]);
  const attached = tokens.flatMap((token) => [
    ...token.leadingTrivia.flatMap((item) => item.marks), ...token.marks,
  ]);
  assertEquals(attached, marks);
  assertEquals(marks.map((mark) => mark.id.args[0]), [0, 1, 2]);

  const large = await request("x ".repeat(10000));
  const document = await large.json() as LexResponse;
  if (!document.success) throw new Error(document.error.message);
  assertEquals(document.document.tokens.length, 10001);

  const template = await request("`text ${'😀'}`");
  assertEquals(template.status, 200);
  const parsedTemplate = await template.json() as LexResponse;
  if (!parsedTemplate.success) throw new Error(parsedTemplate.error.message);
  assertEquals(parsedTemplate.document.marks.length, 0);
  const damagedTemplate = await request("`text ${'ab'}");
  const damaged = await damagedTemplate.json() as LexResponse;
  if (!damaged.success) throw new Error(damaged.error.message);
  assertEquals(damaged.document.marks.map((mark) => mark.problem.name), [
    "UnterminatedMultilineString", "InvalidCharacterLength",
  ]);

  const pending = handler(() => {
    const error = new Error("pending frontend stage");
    error.name = "TypedHole";
    throw error;
  });
  const unfinished = await pending(new Request("http://localhost/api/lex", {
    method: "POST", body: JSON.stringify({ source: "x" }),
  }));
  assertEquals(unfinished.status, 422);
  const failed = await unfinished.json() as LexResponse;
  if (failed.success) throw new Error("Unfinished syntax must not produce a successful document");
  assertEquals(failed.error.kind, "unfinished");

  for (const body of ["{", JSON.stringify({ source: 42 })]) {
    const invalid = await handle(new Request("http://localhost/api/lex", { method: "POST", body }));
    assertEquals(invalid.status, 400);
  }
  assertEquals((await handle(new Request("http://localhost/api/lex"))).status, 405);
  assertEquals((await handle(new Request("http://localhost/missing"))).status, 404);

  const broken = handler(() => { throw new Error("frontend invariant failed"); });
  const internal = await broken(new Request("http://localhost/api/lex", {
    method: "POST", body: JSON.stringify({ source: "x" }),
  }));
  assertEquals(internal.status, 500);
  const error = await internal.json() as LexResponse;
  if (error.success) throw new Error("Internal failure must not produce a successful document");
  assertEquals(error.error.kind, "internal");
});
