import { assertEquals, assertStringIncludes } from "@std/assert";
import { compileLibraryFile, compileLibraryVirtual, compileVirtual } from "../src/compiler.ts";

const fixture = new URL("../tooling/frontend-v2/library_fixture.wm", import.meta.url).pathname;

Deno.test("library emission exports entry bindings and does not invoke main", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/library.wm",
      `
        let main = () => { Panic("library main must not run") };
        let double = (value: Number) => { value * 2 };
      `,
    ],
  ]);
  const js = await compileLibraryVirtual("/test/library.wm", virtualFs);

  assertStringIncludes(js, "export {");
  assertStringIncludes(js, " as main");
  assertStringIncludes(js, " as double");
  assertEquals(js.includes("await main"), false);

  const module = await importGenerated(js, "no-main");
  assertEquals(module.double(21), 42);
  assertEquals(typeof module.main, "function");
});

Deno.test("executable emission retains main invocation", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/main.wm", "let main = () => { void };"],
  ]);
  const js = await compileVirtual("/test/main.wm", virtualFs);

  assertStringIncludes(js, "if (typeof main_");
  assertStringIncludes(js, "await main_");
});

Deno.test("compiled WM library is importable through stable plain-data exports", async () => {
  const js = await compileLibraryFile(fixture);
  assertEquals(await compileLibraryFile(fixture), js);
  const first = await importGenerated(js, "fixture-first");
  const second = await importGenerated(js, "fixture-second");

  assertEquals(Object.keys(first).sort(), ["FixtureDescription", "describe", "double"]);
  assertEquals(first.double(6), 12);
  assertEquals(second.double(7), 14);
  assertEquals(first.FixtureDescription(["frontend-v2-fixture", "zero"]), {
    kind: "frontend-v2-fixture",
    name: "zero",
  });
  assertEquals(first.describe("one"), {
    kind: "frontend-v2-fixture",
    name: "one",
  });
  assertEquals(Object.hasOwn(globalThis, "__wm_tuple"), false);
  assertEquals(Object.hasOwn(globalThis, "double"), false);
});

Deno.test("library exports only entry bindings and the final shadowed value", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/internal.wm", "let internalOnly = 20;"],
    [
      "/test/library.wm",
      `
        from "./internal.wm" import { internalOnly };
        let answer = 1;
        let answer = internalOnly + 22;
      `,
    ],
  ]);
  const js = await compileLibraryVirtual("/test/library.wm", virtualFs);
  const module = await importGenerated(js, "entry-only");

  assertEquals(Object.keys(module), ["answer"]);
  assertEquals(module.answer, 42);
});

async function importGenerated(source: string, label: string): Promise<Record<string, any>> {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/${label}.mjs`;
  await Deno.writeTextFile(path, source);
  try {
    return await import(`${new URL(`file://${path}`).href}?cache=${crypto.randomUUID()}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
