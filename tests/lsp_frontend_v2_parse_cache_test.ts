import { assertEquals, assertStrictEquals } from "@std/assert";
import type { StructuralParseResult } from "../src/frontend_v2_loader.ts";
import { FrontendV2ParseCache } from "../src/lsp/frontend_v2_parse_cache.ts";
import { frontendV2ModuleUrl } from "../src/lsp/server.ts";

Deno.test("frontend-v2 LSP default module URL resolves without deferred initialization", () => {
  const resolved = frontendV2ModuleUrl({ frontend: "v2" });
  assertEquals(resolved instanceof URL, true);
  assertEquals(
    resolved instanceof URL &&
      resolved.pathname.endsWith("/tooling/frontend-v2/frontend-v2.generated.mjs"),
    true,
  );
});

Deno.test("frontend-v2 LSP parse cache reuses matching URI source and version", () => {
  const cache = new FrontendV2ParseCache();
  const frontend = countingFrontend();

  const first = cache.structural("file:///main.wm", "let x = 1;", 1, frontend);
  const second = cache.structural("file:///main.wm", "let x = 1;", 1, frontend);
  const third = cache.structural("file:///main.wm", "let x = 1;", 2, frontend);

  assertStrictEquals(second, first);
  assertEquals(third === first, false);
  assertEquals(frontend.calls, 2);
});

Deno.test("frontend-v2 LSP parse cache invalidates by source and delete", () => {
  const cache = new FrontendV2ParseCache();
  const frontend = countingFrontend();

  const first = cache.structural("file:///main.wm", "let x = 1;", undefined, frontend);
  const changed = cache.structural("file:///main.wm", "let x = 2;", undefined, frontend);
  cache.delete("file:///main.wm");
  const afterDelete = cache.structural("file:///main.wm", "let x = 2;", undefined, frontend);

  assertEquals(changed === first, false);
  assertEquals(afterDelete === changed, false);
  assertEquals(frontend.calls, 3);
});

function countingFrontend() {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    parseStructural(source: string): StructuralParseResult {
      calls += 1;
      return {
        schemaVersion: 1,
        sourceLength: source.length,
        progressSteps: calls,
        concreteText: source,
        virtualText: source,
        items: [],
        marks: [],
        artifacts: [],
        pieces: [],
      };
    },
  };
}
