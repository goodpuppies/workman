import { assertEquals } from "@std/assert";
import { compileLibraryVirtual } from "../src/compiler.ts";

Deno.test("kernel source, graph, recovered, and emission paths do not load the library", async () => {
  // A fresh process prevents another test's library cache from hiding an eager load.
  // Poisoning the embedded sources makes any accidental library load fail deterministically.
  const code = `
    const { librarySources } = await import(${
    JSON.stringify(
      new URL("../src/generated/assets.ts", import.meta.url).href,
    )
  });
    for (const path of Object.keys(librarySources)) librarySources[path] = "let broken = ;";
    const api = await import(${
    JSON.stringify(
      new URL("../src/compiler.ts", import.meta.url).href,
    )
  });
    const source = "-- @no-prelude\\nlet square = (n: Number) => { n * n }; let answer = square(7);";
    const files = new Map([["/test/main.wm", source]]);
    await api.checkSource(source);
    await api.checkSourceSteps(source);
    await api.coreSource(source);
    await api.compile(source);
    await api.analyzeVirtual("/test/main.wm", files);
    await api.analyzeRecoveredVirtual("/test/main.wm", files);
    await api.analyzeRecoveredVirtual("/test/main.wm", new Map([
      ["/test/main.wm", source + " let incomplete = ;"]
    ]));
    await api.coreVirtual("/test/main.wm", files);
    await api.compileLibraryVirtual("/test/main.wm", files);
    let failed = false;
    try { await api.checkSource("let ordinary = 1;"); } catch { failed = true; }
    if (!failed) throw new Error("the poisoned library was not exercised");
  `;
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["eval", code],
    cwd: new URL("../", import.meta.url),
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
});

Deno.test("kernel entry points retain the prelude needed by an imported module", async () => {
  const js = await compileLibraryVirtual(
    "/test/main.wm",
    new Map([
      ["/test/main.wm", '-- @no-prelude\nfrom "./dep.wm" import { count }; let answer = count;'],
      ["/test/dep.wm", "let count = List.length([1, 2, 3]);"],
    ]),
  );
  const module = await import(`data:text/javascript;base64,${btoa(js)}`);
  assertEquals(module.answer, 3);
});
