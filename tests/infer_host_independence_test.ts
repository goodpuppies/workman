import { assertEquals } from "@std/assert";

Deno.test("pure inference and lowering load without TS reflection or npm resolution", async () => {
  const inferUrl = new URL("../src/infer.ts", import.meta.url).href;
  const loweringUrl = new URL("../src/core/from_surface.ts", import.meta.url).href;
  const typesUrl = new URL("../src/types.ts", import.meta.url).href;
  const astUrl = new URL("../src/ast.ts", import.meta.url).href;
  const source = `
    import { inferModule } from ${JSON.stringify(inferUrl)};
    import { coreFromSurface } from ${JSON.stringify(loweringUrl)};
    import { show } from ${JSON.stringify(typesUrl)};
    import type { Module } from ${JSON.stringify(astUrl)};
    const module: Module = {
      kind: "Module",
      decls: [{
        kind: "LetDecl", exported: true, recursive: false,
        bindings: [{ pattern: { kind: "PVar", name: "answer" }, value: { kind: "Int", value: 42 } }],
      }],
    };
    const result = inferModule(module);
    const answer = result.env.get("answer");
    if (!answer) throw new Error("missing inferred answer");
    const core = coreFromSurface(module, result);
    console.log(show(answer.type));
    console.log(core.kind);
    console.log(core.decls.length);
  `;
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["eval", "--no-config", "--no-npm", source],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  assertEquals(new TextDecoder().decode(result.stdout), "Number\nCoreModule\n1\n");

  // Loading generated diagnostic renderers also works in Deno, so execution
  // alone cannot guard the separation between inference and presentation.
  for (const entry of [inferUrl, loweringUrl]) {
    const graph = await new Deno.Command(Deno.execPath(), {
      args: ["info", "--json", "--no-config", "--no-npm", entry],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(graph.code, 0, new TextDecoder().decode(graph.stderr));
    const modules = JSON.parse(new TextDecoder().decode(graph.stdout)).modules as {
      specifier: string;
    }[];
    const presentation = modules.filter(({ specifier }) =>
      specifier.includes("/src/diagnostics/") || specifier.includes("/tooling/tuiman/") ||
      specifier.endsWith("/src/diagnostics.ts")
    );
    assertEquals(presentation, [], entry);
  }
});
