import { assertEquals, assertRejects } from "@std/assert";
import { analyzeVirtual, compile } from "../src/compiler.ts";
import { coreProgramFromAnalysis } from "../src/core/artifact.ts";
import { emitCoreProgram } from "../src/core/emit_js.ts";
import { showCore } from "../src/core/snapshot.ts";
import { GPU_SEMANTIC_IDS } from "../src/compiler_semantics.ts";
import { GpuFragmentSelectionError } from "../src/gpu_selection.ts";
import type { VisualShaderArtifactV1 } from "../src/gpu_artifact.ts";
import { baseEnv, baseTypeEnv } from "../src/types.ts";

Deno.test("compiler Gpu basis carries closed semantic identity", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([[
      "/test/main.wm",
      `
      let shade = (coord) => {
        @gpu;
        Gpu.color((0.0, 0.0, 0.0, 1.0))
      };
      let fragment = Gpu.fragment(shade);
    `,
    ]]),
  );
  const result = analysis.results.get("/test/main.wm")!;
  const semanticIds = [...result.facts.expressions.values()]
    .map((fact) => fact.origin?.semanticId)
    .filter((id) => id !== undefined);

  assertEquals(semanticIds.includes(GPU_SEMANTIC_IDS.color), true);
  assertEquals(semanticIds.includes(GPU_SEMANTIC_IDS.fragment), true);
  assertEquals(result.typeEnv.has("Gpu.Color"), true);
  assertEquals(result.typeEnv.has("Gpu.Fragment"), true);
  assertEquals(result.typeEnv.has("Gpu.Uniform"), true);
  assertEquals(
    [...baseEnv(baseTypeEnv()).values()]
      .map((scheme) => scheme.semanticId)
      .filter((id) => id !== undefined)
      .sort(),
    Object.values(GPU_SEMANTIC_IDS).sort(),
  );
});

Deno.test("fragment selection resolves same-module aliases into the selected slice", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([[
      "/test/main.wm",
      `let shade = (coord) => {
          @gpu;
          Gpu.color((0.0, 0.0, 0.0, 1.0))
        };
         let firstAlias = shade;
         let secondAlias = firstAlias;
         let first = Gpu.fragment(secondAlias);
         let unused = (coord) => {
           @gpu;
           Gpu.color((1.0, 0.0, 0.0, 1.0))
         };`,
    ]]),
  );

  assertEquals(analysis.fragmentSelections.roots.length, 1);
  assertEquals(analysis.fragmentSelections.selectors.length, 1);
  assertEquals(analysis.fragmentSelections.roots[0].selectors.map((item) => item.id), [0]);
  assertEquals(
    analysis.fragmentSelections.roots[0].bindingId,
    analysis.bindings.get("/test/main.wm")!.exports.get("shade"),
  );
  assertEquals(analysis.gpuInput.schemaVersion, 2);
  assertEquals(analysis.gpuInput.root.functionId, 0);
  assertEquals(analysis.gpuInput.functions.map((fn) => fn.name), ["shade"]);
});

Deno.test("inline marked lambda receives a selected root without a source binding", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([[
      "/test/main.wm",
      `let fragment = Gpu.fragment((coord) => {
        @gpu;
        Gpu.color((0.0, 0.0, 0.0, 1.0))
      });`,
    ]]),
  );

  assertEquals(analysis.fragmentSelections.roots.length, 1);
  assertEquals(analysis.fragmentSelections.roots[0].bindingId, undefined);
  assertEquals(analysis.gpuInput.root.functionId, 0);
  assertEquals(analysis.gpuInput.functions[0].name, "fragment");
});

Deno.test("unselected marked lambdas are candidates, not artifact roots", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([[
      "/test/main.wm",
      `
      let unused = (coord) => {
        @gpu;
        Gpu.color((0.0, 0.0, 0.0, 1.0))
      };
    `,
    ]]),
  );

  assertEquals(analysis.fragmentSelections.roots, []);
  assertEquals(analysis.gpuInput.root, { functionId: -1, selectorSpanId: -1 });
  assertEquals(analysis.gpuInput.functions, []);
});

Deno.test("same-spelled imported operation is not a compiler fragment selector", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([
      ["/test/fake.wm", "let fragment = (value) => { value };"],
      [
        "/test/main.wm",
        `from "./fake.wm" import * as Gpu;
         let ordinary = (coord) => { Gpu.color((0.0, 0.0, 0.0, 1.0)) };
         let result = Gpu.fragment(ordinary);`,
      ],
    ]),
  );

  assertEquals(analysis.fragmentSelections.roots, []);
  assertEquals(analysis.gpuInput.root, { functionId: -1, selectorSpanId: -1 });
  const fragmentFacts = [...analysis.results.get("/test/main.wm")!.facts.expressions.values()]
    .filter((fact) => fact.origin?.name === "Gpu.fragment");
  assertEquals(fragmentFacts.map((fact) => [fact.origin?.source, fact.origin?.semanticId]), [
    ["import", undefined],
  ]);
});

Deno.test("fragment selection rejects ordinary and dynamically supplied functions", async () => {
  await assertRejects(
    () =>
      analyzeVirtual(
        "/test/main.wm",
        new Map([[
          "/test/main.wm",
          `
          let ordinary = (coord) => { Gpu.color((0.0, 0.0, 0.0, 1.0)) };
          let fragment = Gpu.fragment(ordinary);
        `,
        ]]),
      ),
    GpuFragmentSelectionError,
    "Gpu.fragment resolved function is not marked @gpu",
  );
  await assertRejects(
    () =>
      analyzeVirtual(
        "/test/main.wm",
        new Map([[
          "/test/main.wm",
          `
          let make = (shader: ((Number, Number)) => Gpu.Color) => {
            Gpu.fragment(shader)
          };
        `,
        ]]),
      ),
    GpuFragmentSelectionError,
    "Gpu.fragment argument does not statically resolve to one lambda",
  );
});

Deno.test("selected fragment remains outside Core until its artifact is completed", async () => {
  await assertRejects(
    () =>
      compile(`
        let shade = (coord) => {
          @gpu;
          Gpu.color((0.0, 0.0, 0.0, 1.0))
        };
        let fragment = Gpu.fragment(shade);
      `),
    Error,
    "selected GPU fragment reached host Core lowering before artifact materialization",
  );
  await assertRejects(
    () => compile("let hostColor = Gpu.color((0.0, 0.0, 0.0, 1.0));"),
    Error,
    "compiler-owned GPU operation gpu.color reached host Core lowering before materialization",
  );
});

Deno.test("host Core consumes only a completed opaque fragment artifact", async () => {
  const analysis = await analyzeVirtual(
    "/test/main.wm",
    new Map([[
      "/test/main.wm",
      `let shade = (coord) => {
        @gpu;
        Gpu.color((0.0, 0.0, 0.0, 1.0))
      };
      let fragment = Gpu.fragment(shade);`,
    ]]),
  );
  const artifact: VisualShaderArtifactV1 = {
    id: `wms-v1-${"0".repeat(64)}`,
    wgsl: "@fragment fn wm_fragment() -> @location(0) vec4f { return vec4f(); }",
    vertexEntry: "wm_vertex",
    fragmentEntry: "wm_fragment",
  };
  const selectedCall = analysis.fragmentSelections.selectors[0].call;
  const core = coreProgramFromAnalysis(analysis.graph, analysis.results, {
    ...analysis,
    materializedGpuArtifacts: new Map([[selectedCall, artifact]]),
  });
  const module = core.modules.get("/test/main.wm")!.module;
  const emitted = emitCoreProgram(core);

  assertEquals(showCore(module), `let fragment = shader-ref(${artifact.id})`);
  assertEquals(core.shaderArtifacts.get(artifact.id), artifact);
  assertEquals(emitted.includes(artifact.wgsl), true);
  assertEquals(emitted.includes(artifact.id), true);
  assertEquals(emitted.includes(`\"id\":\"${artifact.id}\"`), false);
  assertEquals(emitted.includes("Gpu.color"), false);
  assertEquals(emitted.includes("=> {\n        @gpu"), false);
});
