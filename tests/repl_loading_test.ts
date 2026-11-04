import { assertEquals, assertStringIncludes } from "@std/assert";
import { LoadingProgress, renderLoadingBar } from "../src/repl_loading.ts";

const PLAIN = { color: "none" } as const;

Deno.test("loading bar fills in proportion and shows its percentage and label", () => {
  assertEquals(
    renderLoadingBar(0.5, "Parsing", 0, 80, PLAIN),
    `🗿 ${"█".repeat(14)}${"░".repeat(14)}  50%  Parsing`,
  );
  assertEquals(renderLoadingBar(0, "x", 0, 80, PLAIN), `🗿 ${"░".repeat(28)}   0%  x`);
  assertEquals(renderLoadingBar(2, "x", 0, 80, PLAIN), `🗿 ${"█".repeat(28)} 100%  x`);
});

Deno.test("loading bar drops its caption, then percentage, in a narrow window", () => {
  assertEquals(
    renderLoadingBar(1, "A long caption", 0, 38, PLAIN),
    `🗿 ${"█".repeat(28)} 100%`,
  );
  assertEquals(renderLoadingBar(1, "x", 0, 33, PLAIN), `🗿 ${"█".repeat(28)}`);
  assertEquals(renderLoadingBar(1, "x", 0, 13, PLAIN), `🗿 ${"█".repeat(9)}`);
});

Deno.test("loading bar sweeps its colors over time and resets them", () => {
  const style = { color: "truecolor" } as const;
  const early = renderLoadingBar(0.5, "x", 0, 80, style);
  assertStringIncludes(early, "\x1b[38;2;255;106;21m█"); // The logo's orange.
  assertStringIncludes(early, "\x1b[0m");
  assertEquals(early === renderLoadingBar(0.5, "x", 300, 80, style), false);
});

Deno.test("loading progress moves through the phases and never backward", () => {
  const progress = new LoadingProgress();
  const seen = [0];
  for (let done = 1; done <= 10; done++) {
    progress.parsed(done, 10);
    seen.push(progress.ratio);
  }
  assertEquals(progress.label, "Parsing standard library");
  for (let step = 0; step < 200; step++) {
    progress.analyzed();
    seen.push(progress.ratio);
  }
  assertEquals(progress.label, "Checking standard library");
  progress.stage("load modules");
  assertEquals(progress.label, "Checking standard library");
  progress.stage("emit javascript");
  seen.push(progress.ratio);
  progress.stage("build core");
  seen.push(progress.ratio);
  assertEquals(progress.label, "Preparing session");
  assertEquals(seen, [...seen].sort((a, b) => a - b));
  assertEquals(seen.at(-1)! < 1, true);
});

Deno.test("loading progress ignores analysis of the session before the library is parsed", () => {
  const progress = new LoadingProgress();
  progress.analyzed();
  assertEquals(progress.ratio, 0);
  assertEquals(progress.label, "Parsing standard library");
});
