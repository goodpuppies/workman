import { assertEquals } from "@std/assert";
import { genericDiagnostic } from "../src/diagnostic_model.ts";
import type { SupportEntry } from "../src/diagnostic_writer.ts";
import { authoredOrigin } from "../src/diagnostics/origin_selection.ts";

type ClaimEntry = Extract<SupportEntry, { kind: "claim" }>;
function claim(id: string, filePath: string): ClaimEntry {
  return {
    kind: "claim",
    id,
    claim: { kind: "fact", subject: id, text: id },
    origin: { kind: "source", filePath, span: { start: 0, end: 1, line: 1, col: 0 } },
  };
}

Deno.test("origin selection searches past library nodes on every provenance branch", () => {
  const diagnostic = genericDiagnostic("error", "test", "origin selection");
  const user = claim("user", "/project/producer.wm");
  const callback = claim("callback", "subml-basis/subset_result.wm");
  const boundary = claim("boundary", "/project/main.wm");
  const library = [0, 1, 2].map((index) => claim(`library${index}`, "std/string.wm"));
  diagnostic.support.entries = [user, callback, boundary, ...library];
  const paths = [
    [user, callback, boundary],
    [...library, boundary],
  ];
  const edges = paths.flatMap((path) =>
    path.slice(1).map((to, index) => ({ from: path[index].id, to: to.id, role: "derived" }))
  );
  for (const ordering of [edges, [...edges].reverse()]) {
    diagnostic.support.edges = ordering;
    assertEquals(authoredOrigin(diagnostic, boundary), user);
  }
  assertEquals(authoredOrigin(diagnostic, library[2]), undefined);
});

Deno.test("user std directories and modules with different source are not library internals", () => {
  const diagnostic = genericDiagnostic("error", "test", "origin selection");
  const directory = claim("directory", "/project/std/string.wm");
  const relative = claim("relative", "std/custom.wm");
  const sameName = claim("sameName", "std/string.wm");
  diagnostic.support.entries = [directory, relative, sameName];
  diagnostic.support.sources = [{ filePath: "std/string.wm", source: "user module" }];
  for (const user of [directory, relative, sameName]) {
    assertEquals(authoredOrigin(diagnostic, user), user);
  }
});
