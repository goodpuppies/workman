import { assertEquals } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { structuralDiagnostics } from "../src/frontend_v2_diagnostics.ts";
import { type FrontendV2, loadFrontendV2 } from "../src/frontend_v2_loader.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;
const frontend = await loadFrontendV2(await buildFrontend());

Deno.test("frontend-v2 parses the repository WM corpus without top-level opaque items", async () => {
  const roots = [
    new URL("../std", import.meta.url),
    new URL("../examples", import.meta.url),
    new URL("../tooling", import.meta.url),
  ];
  let checked = 0;

  for (const root of roots) {
    for await (const path of wmFiles(root)) {
      const source = await Deno.readTextFile(path);
      const result = frontend.parseStructural(source);
      const second = frontend.parseStructural(source);
      const diagnostics = structuralDiagnostics(result, source);
      const secondDiagnostics = structuralDiagnostics(second, source);
      assertEquals(second, result, path);
      assertEquals(secondDiagnostics, diagnostics, path);
      assertEquals(result.concreteText, source, path);
      assertStructuralRecoveryIntegrity(result, path);
      assertEquals(
        result.items.some((item) => item.kind === "opaque"),
        false,
        path,
      );
      assertEquals(
        result.marks.some((mark) => mark.code === "parse.module.opaque-item"),
        false,
        path,
      );
      checked += 1;
    }
  }

  if (checked < 50) throw new Error("expected a WM corpus, checked only " + checked + " files");
});

Deno.test("frontend-v2 structural parsing is deterministic on bounded finite strings", () => {
  const alphabet = [
    "a",
    "Z",
    "0",
    " ",
    "\n",
    "\r",
    "(",
    ")",
    "{",
    "}",
    "[",
    "]",
    ";",
    "=",
    '"',
    "@",
    "🚀",
  ];
  let seed = 0x51ade;

  for (let sample = 0; sample < 80; sample += 1) {
    let source = "";
    const length = sample % 29;
    for (let index = 0; index < length; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      source += alphabet[seed % alphabet.length];
    }

    const first = frontend.parseStructural(source);
    const second = frontend.parseStructural(source);
    assertEquals(second, first, "sample " + sample);
    assertEquals(
      structuralDiagnostics(second, source),
      structuralDiagnostics(first, source),
      "sample " + sample,
    );
    assertEquals(first.concreteText, source, "sample " + sample);
    assertStructuralRecoveryIntegrity(first, "sample " + sample);
  }
});

function assertStructuralRecoveryIntegrity(
  result: ReturnType<FrontendV2["parseStructural"]>,
  context: string,
): void {
  const markIds = result.marks.map((mark) => mark.id);
  assertEquals(new Set(markIds).size, markIds.length, context);
  assertEquals(
    result.artifacts.every((artifact) => markIds.includes(artifact.recoveryId)),
    true,
    context,
  );
  let cursor = 0;
  let rebuilt = "";
  for (const artifact of result.artifacts) {
    rebuilt += result.concreteText.slice(cursor, artifact.anchor) + artifact.text;
    cursor = artifact.anchor;
  }
  rebuilt += result.concreteText.slice(cursor);
  assertEquals(rebuilt, result.virtualText, context);
  for (let index = 1; index < result.artifacts.length; index += 1) {
    const previous = result.artifacts[index - 1];
    const current = result.artifacts[index];
    assertEquals(previous.anchor <= current.anchor, true, context);
    if (previous.anchor === current.anchor) {
      assertEquals(previous.order < current.order, true, context);
    }
  }
}

async function buildFrontend(): Promise<URL> {
  const output = (await Deno.makeTempDir()) + "/frontend-v2.mjs";
  await Deno.writeTextFile(output, await compileLibraryFile(frontendSource));
  return new URL("file://" + output);
}

async function* wmFiles(root: URL): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(root)) {
    const path = root.pathname + "/" + entry.name;
    if (entry.isDirectory) {
      yield* wmFiles(new URL(root.href + "/" + entry.name + "/"));
    } else if (entry.isFile && entry.name.endsWith(".wm")) {
      yield path;
    }
  }
}
