# wmslang expanded visual backend

Status: expanded production-backend design. The vertical slice in [`v1-scope.md`](./v1-scope.md)
requires fixed fullscreen entries, compile-time Slang-to-WGSL, minimal artifact embedding, and a
real-adapter static render. Uniform reflection, exact manifests, content-addressed identity, pinned
distribution packaging, and the larger release harness are post-v1.

Terminology note: unqualified “v1” statements below describe the expanded production backend unless
[`v1-scope.md`](./v1-scope.md) explicitly retains them.

## Backend promise

One `Gpu.Fragment` produces one deterministic Slang module, one linked WGSL module, and one compact
raster manifest. The WGSL module contains exactly two public entry points:

```text
wm_vertex
wm_fragment
```

The vertex entry synthesizes a fullscreen triangle from `SV_VertexID`; the fragment entry receives
raw framebuffer position through `SV_Position`, passes its `xy` components to the specialized
Workman root, and returns one `float4` color. There are no vertex buffers, user varyings, textures,
storage resources, or user-authored stage wrappers in v1.

The backend is compile-time infrastructure. Generated Slang, WGSL, reflection, and metadata are
completed before JavaScript execution. A deployed Workman program never downloads Slang and never
interprets Workman shader source at runtime.

## Bundled Slang toolchain

The vertical slice now vendors the working Emscripten runtime exercised by the local `slangtest`
Deno harness. It reports Slang `2026.13.1`, includes the WGSL target, and is recorded with hashes
and license provenance beside the generated JavaScript, declarations, and WASM binary. A focused
test compiles the generated Mandelbrot module through this runtime, not through a mock or native
`slangc` fallback.

Reproducible build recipes, automated replacement tooling, cache-version framing, and distribution
polish remain expanded-backend work. They are not required to prove the thin static slice.

The expanded compiler distribution should eventually replace this locally proven bundle through a
reproducible pinned build containing:

- the exact upstream Slang commit and build recipe;
- hashes for the JavaScript loader, declarations, and uncompressed WASM payload;
- the enabled WGSL target and fixed session options/profile;
- the runtime value returned by `getVersionString()`;
- a license/provenance record beside the generated asset.

The thin slice records the copied asset hashes and checks the WGSL target, runtime version,
entry-point reflection, and absence of global parameters in focused tests. Expanded compiler startup
will also verify hashes and a build manifest before cache use. Compilation itself needs no native
Slang installation, CDN, or network access.

Cache identity includes the generated Slang bytes, target and options, wmslang DTO/backend version,
Slang asset hashes, and runtime-reported Slang version. It excludes current uniform values.

## Slang WASM compilation sequence

For a visual artifact, the TypeScript service performs this fixed sequence:

1. Find the `WGSL` compile target and create a target session.
2. Load the generated module with a deterministic virtual path.
3. Call `findAndCheckEntryPoint("wm_vertex", STAGE_VERTEX)`.
4. Call `findAndCheckEntryPoint("wm_fragment", STAGE_FRAGMENT)`.
5. Create a composite from the module followed by those two entry-point components, in that order.
6. Link the composite.
7. Obtain one whole-program WGSL module with `getTargetCode(0)`.
8. Obtain layout JSON with `getLayout(0).toJsonObject()`.
9. Reconcile reflection against the predicted v1 manifest before caching or embedding the artifact.
10. Delete the target session in a `finally` path.

The stage values are the Slang WASM constants for vertex and fragment; the local playground wrapper
currently exposes them as `1` and `5`. The service should use exported named constants when the
pinned declaration provides them, with a small compatibility adapter that tests those values for the
exact pinned bundle. It must not reuse the playground helper that assumes discovered entries are
compute entries.

`getEntryPointCode` is useful for isolated diagnostics, but it is not the artifact format. v1 uses
whole-program WGSL so `Gpu.wgsl(fragment)` supplies one `GPUShaderModule` containing both stable
entries.

## Deterministic generated module

The conceptual outer shape is:

```slang
struct __wm_VisualParams
{
    float2 resolution;
    float time;
};

[[vk::binding(0, 0)]]
ConstantBuffer<__wm_VisualParams> __wm_uniforms;

// Deterministically ordered generated private types and specialized functions.

[shader("vertex")]
float4 wm_vertex(uint vertexId : SV_VertexID) : SV_Position
{
    float2 position;
    if (vertexId == 0)
        position = float2(-1.0, -1.0);
    else if (vertexId == 1)
        position = float2(3.0, -1.0);
    else
        position = float2(-1.0, 3.0);
    return float4(position, 0.0, 1.0);
}

[shader("fragment")]
float4 wm_fragment(float4 position : SV_Position) : SV_Target
{
    return __wm_shade(position.xy);
}
```

The uniform declaration is omitted completely for a static artifact. `__wm_VisualParams` above is
illustrative: generated fields and order come from the one captured nominal Workman record.

The oversized triangle covers the viewport without diagonal overlap. WebGPU supplies fragment pixel
centers to `SV_Position`; the Workman program owns normalization, aspect correction, and any Y-axis
transformation. The wrapper has no dependency on uniform resolution and no vertex input.

Generated internal mutation is allowed only after immutable Workman semantics have been lowered. The
vertex wrapper's local assignment and tail-recursion loop locals are backend implementation details,
not source mutation.

### Naming and ordering

- The two public entry names above are fixed literals.
- User and generated private names are escaped and derived from stable numeric semantic IDs, not
  source spelling alone.
- Declarations are ordered by kind and stable ID, never map insertion order or traversal accident.
- One reachable specialization is emitted once; unreachable functions are absent.
- Generated ADT tags have deterministic numeric values derived from declaration constructor order.
- Their concrete private struct layouts and match lowering follow
  [`v1-functional-lowering.md`](./v1-functional-lowering.md); the backend does not infer tags or
  payload fields from emitted names.
- Formatting and numeric literal spelling are canonical and covered by golden tests.
- Generated paths and diagnostics contain no machine-specific workspace prefix.

Changing any of these rules increments the backend/DTO version used by artifact caches and
snapshots.

## Uniform ABI

The only v1 resource is a read-only uniform buffer at WebGPU bind group `0`, binding `0`. The
generated Slang annotation fixes that location; reflection must agree. This deliberately avoids an
API for arbitrary groups while v1 has only one resource.

Workman predicts the resource identity, record field order, `f32` scalar/vector shapes, and the
fixed binding location. Slang reflection is authoritative for byte offsets, field sizes, aggregate
size, and padding. Reconciliation requires:

- zero resources for a static artifact, or exactly one constant-buffer parameter named
  `__wm_uniforms`;
- binding index `0` and register space/group `0` when the reflection JSON reports space explicitly;
- a reflected struct with exactly the predicted fields and scalar/vector shapes;
- monotonically non-overlapping field ranges contained in the reflected aggregate range;
- both entry points present with stages `vertex` and `fragment`;
- the uniform reported as used by the fragment entry and not required by the vertex entry.

The reflection JSON vocabulary varies slightly across Slang versions (for example, `constantBuffer`
versus a container layout around uniform fields). The compatibility adapter may normalize only the
shapes observed and locked for the pinned bundle. Unknown shapes fail closed and retain the raw
reflection JSON for diagnosis.

The generated host packer allocates the reflected aggregate byte length, initializes every byte to
zero, and writes each value at its reflected offset through an explicitly little-endian `DataView`.
Each Workman `Number` is rounded with f32 semantics. Vector components are written in source order.
The packer never guesses alignment from WGSL rules and never serializes JavaScript object
enumeration order.

Descriptor identity, semantic field naming, reflection normalization, and byte packing are frozen in
[`v1-uniform.md`](./v1-uniform.md).

Backend failure attribution, the generated-source sidecar map, and the exact content-addressed ID
preimage are frozen in [`v1-diagnostics.md`](./v1-diagnostics.md).

## Artifact manifest

The embedded v1 descriptor has a closed raster shape:

```ts
type VisualShaderArtifactV1 = {
  version: 1;
  id: `wms-v1-${string}`;
  target: "wgsl";
  wgsl: string;
  vertexEntry: "wm_vertex";
  fragmentEntry: "wm_fragment";
  primitive: {
    topology: "triangle-list";
    vertexBuffers: [];
    vertexCount: 3;
    instanceCount: 1;
  };
  colorTargets: 1;
  uniform: null | {
    uniformId: number;
    recordId: number;
    schemaFingerprint: string;
    group: 0;
    binding: 0;
    byteLength: number;
    fields: Array<{
      recordId: number;
      declaredIndex: number;
      offset: number;
      byteLength: number;
      representation: "f32" | "f32x2" | "f32x3" | "f32x4";
    }>;
  };
  backend: {
    dtoVersion: number;
    emitterVersion: number;
    slangVersion: string;
    slangLoaderHash: string;
    slangDeclarationsHash: string;
    slangWasmHash: string;
    optionsFingerprint: string;
  };
};
```

The ID syntax, hash algorithms, length-framed preimage, and fields excluded from identity are exact
in [`v1-diagnostics.md`](./v1-diagnostics.md). Each hash/fingerprint manifest string is lowercase
hex, and cache lookup revalidates every backend field rather than trusting the ID alone.

The host selects the one color-target format while creating its WebGPU pipeline. The format is not
part of shader cache identity because this v1 shader writes a plain float color and does not declare
format-specific storage. The artifact exposes no general draw-command abstraction: the host still
records a normal render pass and calls `draw(3, 1, 0, 0)`.

## Release evidence

There are two test tiers. Adapter-free coverage is mandatory everywhere, but it cannot by itself
claim that the expanded visual release works. At least one supported release environment must run
the adapter-backed suite successfully; a release where every renderer test was skipped is a failure.

### Adapter-free gate

For every acceptance shader, run the focused Workman pipeline and check:

- parse, normal HM inference, GPU facts, capture classification, and typed functional IR;
- lowered control-flow IR, including no recursive call after tail-call lowering;
- deterministic generated Slang golden text;
- successful pinned Slang WASM compilation to non-empty whole-program WGSL;
- reflection reconciliation for both raster entries and the optional uniform;
- deterministic artifact serialization and generated JavaScript embedding;
- focused negative diagnostics at Workman spans for unsupported recursion, types, captures, and
  mixed representations.

Tests should invoke focused files or filters. They must not make the repository's very long full
`deno task test` run the normal inner loop.

The stable source names, pixel expectations, lowering assertions, and negative diagnostics are the
ones in [`v1-acceptance.md`](./v1-acceptance.md).

### Adapter-backed gate

The renderer requests a WebGPU adapter and device, creates one shader module from artifact WGSL, and
renders to a `64x64` `rgba8unorm` offscreen texture. It uses the manifest entries, no vertex
buffers, triangle-list topology, and a three-vertex draw. Readback copies the texture to a buffer
with a 256-byte row pitch and strips row padding before assertions.

The minimum release cases are:

1. **Coordinate image:** a simple shader with stable, exactly representable regions proves
   fullscreen coverage, coordinate orientation, fragment entry wiring, and RGBA output. Assert
   corners, center-adjacent pixels, and the absence of untouched clear pixels.
2. **Uniform update:** render twice with the same pipeline and artifact but different immutable
   uniform descriptor values. Assert different expected probes and that shader/pipeline creation
   happened once.
3. **Tail recursion and ADT:** render a bounded Mandelbrot-derived classification image at fixed
   resolution. Assert several pixels chosen away from fractal boundaries, while separately
   snapshotting the loop and tag/payload lowering. Do not require an exact whole-image hash across
   GPU vendors.

On failure, the harness should retain generated Slang, WGSL, normalized reflection, the artifact
manifest, adapter information, and an optional PNG of the readback. GPU-vendor-dependent
transcendental results use tolerances or stable region predicates; the basic coordinate test avoids
transcendentals and uses exact byte expectations.

Adapter absence is an explicit skip only in developer environments that are not release evidence.
Shader-module validation errors, device loss, unexpected pixels, or reflection mismatches are test
failures, not skips.

## Local reference evidence

- Slang's `tests/wgsl/semantic-vertex-id.slang` verifies that `SV_VertexID` becomes WGSL
  `vertex_index`.
- Slang's `tests/wgsl/multiple-entrypoints.slang` verifies one WGSL target can contain vertex and
  fragment entries together.
- Slang's `tests/wgsl/explicit-binding.slang` verifies explicit Vulkan binding/group annotations
  become WGSL `@binding` and `@group` attributes.
- Slang's shader-toy example feeds fragment `SV_Position` to an image function and keeps raster
  setup in a separate vertex entry.
- Slang's WebGPU WASM example demonstrates explicit vertex/fragment entry checking, composite
  linking, and WGSL retrieval.
- The Slang playground compiler demonstrates whole-program `getTargetCode(0)`, layout JSON through
  `getLayout(0).toJsonObject()`, and runtime version reporting. Its compute-oriented resource and
  entry helpers are reference code only and are not reused as the v1 raster contract.

The audited local revisions are Slang `694022a11ac4d1c6a22af0236721035a18cafbca` and Slang
playground `631c0d838fef1e7992e2a71a91c71ef89cb84f10`. These research revisions document the
decision; the eventually bundled compiler still needs its own exact artifact provenance and hashes.
