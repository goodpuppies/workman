import { assertEquals, assertRejects } from "@std/assert";
import { compileReplFileArtifacts, coreFile } from "../src/compiler.ts";
import { ModuleAnalysisCache } from "../src/module_analysis_cache.ts";
import type { CachedModuleAnalysis } from "../src/module_analysis_cache.ts";

/** Records which modules each compile analyzed, by file name. */
class RecordingCache extends ModuleAnalysisCache {
  analyzed: string[] = [];

  override set(key: string, analysis: CachedModuleAnalysis): void {
    this.analyzed.push(key.slice(key.lastIndexOf("/") + 1, key.indexOf("#")));
    super.set(key, analysis);
  }

  take(): string[] {
    const analyzed = this.analyzed.sort();
    this.analyzed = [];
    return analyzed;
  }
}

async function withModules(
  files: Record<string, string>,
  body: (path: (name: string) => string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    for (const [name, source] of Object.entries(files)) {
      await Deno.writeTextFile(`${dir}/${name}`, source);
    }
    await body((name) => `${dir}/${name}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const modules = {
  "lib.wm": [
    'from js.global("Math") import unsafe { max: (Number, Number) -> Number };',
    "type Shape = Dot | Box<Number>;",
    "let size = (shape) => match(shape) { Dot => 0, Box(n) => max(n, 0) };",
  ].join("\n"),
  "a.wm": 'export from "./lib.wm" import *;\nlet a = size(Box(2));\n',
  "b.wm": 'export from "./a.wm" import *;\nlet b = a + 1;\n',
  "c.wm": 'from "./b.wm" import *;\nlet c = size(Box(b));\n',
};

Deno.test("REPL snapshots are captured only for the entry and cannot reuse a snapshot-free result", async () => {
  await withModules(
    {
      "lib.wm": "let base = 40;",
      "entry.wm": 'from "./lib.wm" import { base };\nlet it = base + 2;',
    },
    async (path) => {
      const cache = new RecordingCache();
      const options = { moduleAnalysisCache: cache };
      const plain = await coreFile(path("entry.wm"), options);
      assertEquals(plain.results.get(plain.graph.entry)?.steps, []);
      cache.take();
      const repl = await coreFile(path("entry.wm"), { ...options, captureEntrySteps: true });
      assertEquals(cache.take(), ["entry.wm"]);
      assertEquals(repl.results.get(repl.graph.entry)?.steps.at(-1)?.env.get("it")?.type, "Number");
      const dependency = [...repl.results.entries()].find(([id]) => id !== repl.graph.entry);
      assertEquals(dependency?.[1].steps, []);
      await coreFile(path("entry.wm"), { ...options, captureEntrySteps: true });
      assertEquals(cache.take(), []);
    },
  );
});

async function code(path: string, options = {}): Promise<string[]> {
  return (await compileReplFileArtifacts(path, options)).map((artifact) => artifact.code);
}

Deno.test("a compile analyzes only the modules the cache doesn't hold", async () => {
  await withModules(modules, async (path) => {
    const cache = new RecordingCache();
    await code(path("b.wm"), { moduleAnalysisCache: cache });
    assertEquals(cache.take(), ["a.wm", "b.wm", "lib.wm"]);
    const cached = await code(path("c.wm"), { moduleAnalysisCache: cache });
    assertEquals(cache.take(), ["c.wm"]);
    assertEquals(cached, await code(path("c.wm")));
  });
});

Deno.test("a changed module is analyzed again with everything that imports it", async () => {
  await withModules(modules, async (path) => {
    const cache = new RecordingCache();
    await code(path("c.wm"), { moduleAnalysisCache: cache });
    cache.take();
    await Deno.writeTextFile(path("a.wm"), 'export from "./lib.wm" import *;\nlet a = 7;\n');
    const cached = await code(path("c.wm"), { moduleAnalysisCache: cache });
    assertEquals(cache.take(), ["a.wm", "b.wm", "c.wm"]);
    assertEquals(cached, await code(path("c.wm")));
  });
});

Deno.test("a compile that fails to analyze keeps nothing", async () => {
  await withModules(
    { ...modules, "bad.wm": 'from "./b.wm" import *;\nlet c = size(b);\n' },
    async (path) => {
      const cache = new RecordingCache();
      await code(path("b.wm"), { moduleAnalysisCache: cache });
      cache.take();
      await assertRejects(() => code(path("bad.wm"), { moduleAnalysisCache: cache }));
      assertEquals(cache.take(), []);
      await code(path("c.wm"), { moduleAnalysisCache: cache });
      assertEquals(cache.take(), ["c.wm"]);
    },
  );
});
