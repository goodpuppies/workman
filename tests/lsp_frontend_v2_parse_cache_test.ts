import { assertEquals, assertStrictEquals } from "@std/assert";
import type { FrontendV2SurfaceProgram } from "../src/frontend_v2_surface_loader.ts";
import { FrontendV2ParseCache } from "../src/lsp/frontend_v2_parse_cache.ts";
import { frontendV2ModuleUrl } from "../src/lsp/server.ts";

Deno.test("frontend-v2 LSP default module URL resolves without deferred initialization", () => {
  const resolved = frontendV2ModuleUrl({ frontend: "v2" });
  assertEquals(resolved instanceof URL, true);
  assertEquals(
    resolved instanceof URL &&
      resolved.pathname.endsWith("/src/generated/frontend_v2_parser.js"),
    true,
  );
});

Deno.test("frontend-v2 LSP Surface cache reuses matching URI source and version", () => {
  const cache = new FrontendV2ParseCache();
  const frontend = countingSurfaceFrontend();

  const first = cache.surface("file:///main.wm", "let x = 1;", 1, frontend);
  const second = cache.surface("file:///main.wm", "let x = 1;", 1, frontend);
  const third = cache.surface("file:///main.wm", "let x = 1;", 2, frontend);

  assertStrictEquals(second, first);
  assertEquals(third === first, false);
  assertEquals(frontend.calls, 2);
});

Deno.test("frontend-v2 LSP Surface cache invalidates by source and delete", () => {
  const cache = new FrontendV2ParseCache();
  const frontend = countingSurfaceFrontend();

  const first = cache.surface("file:///main.wm", "let x = 1;", undefined, frontend);
  const changed = cache.surface("file:///main.wm", "let x = 2;", undefined, frontend);
  cache.delete("file:///main.wm");
  const afterDelete = cache.surface("file:///main.wm", "let x = 2;", undefined, frontend);

  assertEquals(changed === first, false);
  assertEquals(afterDelete === changed, false);
  assertEquals(frontend.calls, 3);
});

Deno.test("frontend-v2 LSP Surface cache remembers generated rejection", () => {
  const cache = new FrontendV2ParseCache();
  let calls = 0;
  const frontend = {
    parseSurfaceProgram(_source: string): undefined {
      calls += 1;
      return undefined;
    },
  };
  const uri = "file:///main.wm";
  const source = "let =";

  assertEquals(cache.surface(uri, source, 1, frontend), undefined);
  assertEquals(cache.surface(uri, source, 1, frontend), undefined);
  assertEquals(calls, 1);
});

function countingSurfaceFrontend() {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    parseSurfaceProgram(source: string): FrontendV2SurfaceProgram {
      calls += 1;
      return {
        root: { name: "ProgramNode", args: [[source, calls]] },
        marks: [],
      };
    },
  };
}
