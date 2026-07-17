# wmslang v5 implementation

Date: 2026-07-17. This document describes how the V5 scope was implemented, why it required more
work than the earlier wmslang slices, and which architectural boundaries were preserved while doing
it. The normative feature contract remains [`v5-scope.md`](./v5-scope.md); executable completion
evidence is indexed in [`v5-audit.md`](./v5-audit.md).

## What V5 delivered

V5 turned wmslang from a capable single-pass fragment language into a small but practical creative
shader system. It added two related vertical slices:

1. exact signed-integer representation inside GPU code; and
2. sampled textures, offscreen targets, multiple fragment roots, and explicit host-owned feedback.

The completed system supports:

- `i32` scalar and homogeneous vector expressions alongside the existing `f32` representation;
- explicit `Gpu.i32` and `Gpu.f32` conversions with no implicit promotion or defaulting;
- reflected and range-checked signed integer uniforms;
- compiler-known sampled texture, render-target, physical texture, and sampler boundary types;
- pinned Slang `Texture2D.Sample` and `Texture2D.Load` operations;
- deterministic uniform/resource partitioning from one nominal Workman environment;
- multiple independently addressable `Gpu.fragment` roots;
- surface and `rgba16float` offscreen pipelines;
- immutable host-controlled ping-pong state;
- resize reinitialization, alias checking, device checking, and explicit cleanup; and
- concrete numeric and resource hover information for every selected GPU root.

The creative gate is a real two-pass Game of Life program. Its update shader exact-loads the
previous texture and renders into the other texture. Its display shader samples that result onto an
SDL window. Ordinary recursive Workman host code owns event processing, pass order, swapping,
resize, errors, and lifetime.

## Why V5 was the largest implementation slice

Earlier wmslang versions mostly deepened one existing compiler path:

```text
Workman GPU source
  -> typed GPU facts
  -> serialized slice
  -> Workman-written IR/lowering
  -> Slang
  -> WGSL
```

V5 had to extend that entire path and add a second, runtime-facing path:

```text
nominal environment value
  -> copied uniform bytes + typed opaque resources
  -> WebGPU bind-group entries
  -> surface/offscreen render pass
  -> explicit host scheduling and lifetime
```

That distinction accounts for most of the work. Integer support touched inference, specialization,
IR, Slang emission, reflection, packing, hover, and diagnostics. Texture feedback touched all of
those layers plus physical WebGPU ownership, view roles, bind groups, render attachments, multiple
pipelines, pass ordering, resize, and cleanup.

V5 was therefore not merely “add two shader builtins.” A sampled texture has three identities that
must never be confused:

1. the logical shader resource and its stable layout slot;
2. the concrete physical texture/view currently bound to that slot; and
3. the render destination selected by the host for this pass.

Ping-pong rendering works only when changing the second and third identities does not change the
first. Establishing and testing that invariant required coordinated compiler, artifact, generated
runtime, and Workman host changes.

The work was also deliberately implementation-complete. The feature was not considered finished
when Slang accepted a texture declaration. It had to survive real reflection, produce valid WGSL,
construct real bind groups, execute several ordered passes on WebGPU, read back evolving pixels,
and run through the SDL presentation path.

## Numeric representation

### Workman still has one host `Number`

V5 did not split ordinary Workman into host-visible `I32` and `F32` types. Host inference continues
to see `Number`. Representation is occurrence-local evidence owned by the selected GPU island.

Integral spelling supplies `i32` evidence and decimal spelling supplies `f32` evidence. Connected
operations, calls, recursion, tuples, uniforms, and constructors propagate that evidence. A
reachable numeric occurrence left unresolved is an error; an annotation cannot select its GPU
representation.

This preserves the Workman thesis established in V4:

- HM infers program structure;
- the finite GPU operation table resolves compiler-owned operators and builtins;
- specialization clones and freshens generic helper bodies; and
- no annotation-only version of an otherwise invalid shader is accepted.

### Finite integer rows

The GPU dialect gained deliberately finite `i32` rows for scalar and homogeneous vector arithmetic,
comparison, and verified pure Slang builtins. Mixed `i32`/`f32` flow fails unless source contains an
explicit conversion.

The selected representation and conversion identity survive the serialized graph, Workman-written
typed IR, lowering, and Slang emission. Slang is never asked to infer a promotion that Workman did
not choose.

### Diagnostics and evidence

Representation conflicts retain both provenance paths. This is particularly useful when a value is
forced to `i32` by recursion or an integral literal but reaches `f32` many expressions later.
Signed literals are validated against the exact 32-bit range only when they are reachable from a
selected GPU root.

The same occurrence-local information drives GPU hover. Host hover still reports `Number`, while a
shader occurrence can report `i32`, `i32x3`, `f32`, or another concrete GPU shape.

### Uniform layout and packing

Numeric environment fields are no longer assumed to be floats. Connected GPU evidence selects
`i32` or `f32` scalar/vector layout. Slang reflection remains authoritative for offsets and total
constant-buffer size.

The generated host packer writes signed fields with `DataView.setInt32`, checks the signed range,
and continues to use `setFloat32` for float fields. Unused numeric fields remain errors rather than
being silently defaulted.

The GLML-derived raymarcher is the numeric acceptance program: its step counter specializes to
`i32`, while the distance calculation stays `f32`; the only crossing is an explicit `Gpu.f32`.

## Resource facts and the serialized boundary

### Compiler-known opaque types

V5 introduced four narrow basis types:

```text
Gpu.Texture2D
Gpu.SampledTexture2D
Gpu.RenderTarget2D
Gpu.Sampler
```

They are opaque on the Workman side. A physical `Gpu.Texture2D` is never legal shader data. The
compiler can derive separate sampled and render-target wrappers from it, which makes role confusion
unrepresentable in ordinary typed Workman code.

These values are not generalized foreign references and do not participate in the TypeScript FFI
evidence side channel. Their kinds and environment slots are statically known; only their concrete
runtime identities remain opaque.

### Environment partitioning

One outer nominal record remains the host-to-GPU boundary. Normalization partitions its declared
fields into:

- a constant-buffer schema for copyable numeric fields; and
- a resource schema for sampled textures and samplers.

Declaration identity and order remain stable. Uniforms occupy binding `0` when present. Resources
receive deterministic flat bindings after it. The artifact records the nominal environment,
declared field index, resource kind, group, and binding.

Concrete resources never enter the serialized shader graph. The graph contains logical resource
expressions and resource-call operations keyed by declared environment fields.

### Direct resource operations

Inference recognizes only direct calls on the current environment's sampled texture field:

```workman
inputs.image.Sample(inputs.sampler, uv)
inputs.previous.Load((x, y, 0))
```

They normalize to explicit resource-call facts carrying the selected canonical operation. The
Workman-written middle end validates and preserves those operations through typed IR and immutable
lowering. The Slang emitter produces `Texture2D<float4>`, `SamplerState`, `.Sample(...)`, and
`.Load(...)` from those already-completed decisions.

Resource methods cannot be extracted, partially applied, dynamically selected, or used on host
objects. Texture reads remain pure expressions; the only shader output is still the returned
four-component color.

### Unused resource rejection

The real feedback test exposed an important interface rule. Slang source reflection can retain an
unused declared resource while linked WGSL and WebGPU `layout: "auto"` omit it. That makes a
source-predicted bind group disagree with the actual pipeline layout.

The normalizer now requires every declared texture or sampler field to be used by the selected GPU
root. An unused resource is rejected before serialization. This keeps Workman facts, emitted Slang,
linked WGSL, and WebGPU auto-layout in exact agreement without adding a backend-to-inference loop.

## Slang emission and terminal reflection

The generated resource interface is intentionally flat:

```slang
[[vk::binding(0, 0)]]
ConstantBuffer<Inputs> wm_uniforms;

[[vk::binding(1, 0)]]
Texture2D<float4> wm_r_1;

[[vk::binding(2, 0)]]
SamplerState wm_r_2;
```

Slang reflection validates the completed prediction:

- resource kind;
- generated field identity;
- group and binding;
- sampled texture shape; and
- constant-buffer offsets and total size.

Reflection is terminal. It can reject a compiler/backend disagreement, but it cannot create a
missing field, select another overload, change a numeric representation, or trigger another HM or
specialization pass. This is intentionally simpler than the TypeScript FFI reflection machinery:
wmslang owns its source language and uses Slang as verifier and lowering backend, not as a source of
new Workman meaning.

Artifact identity includes shader and resource-layout identity. It deliberately excludes concrete
textures and sampler objects. Rebinding another texture or changing nearest to linear filtering
therefore retains the same artifact, WGSL, shader module, and compatible pipeline.

## Generated host runtime

### Physical resources and role wrappers

The generated JavaScript runtime creates one-mip `rgba16float` textures with texture-binding,
render-attachment, and copy-destination usage. Creation immediately zero-clears the texture, so the
first sampled frame never observes undefined contents.

A physical wrapper records its device, dimensions, fixed format, and raw texture. Sampled and
render-target wrappers retain the same physical identity but carry distinct private brands and
views. Sampler wrappers similarly carry their device and fixed nearest/linear configuration.

The runtime validates these brands rather than accepting arbitrary `Js.Object` values. This is the
runtime counterpart of the opaque Workman boundary types.

### Bound fragments

Applying a shader factory produces a bound fragment containing:

- its immutable completed artifact;
- freshly packed uniform bytes; and
- ordered typed resource bindings derived from the nominal environment value.

`Gpu.bindGroupEntries` checks the artifact layout, uniform-buffer presence, resource count and
order, device ownership, role, and liveness before returning WebGPU entries. Resource identity is a
binding choice, not a specialization key.

### Render-target validation

Before an offscreen pass is encoded, `Gpu.validateRenderTarget` checks:

- that the value is a compiler-created render-target wrapper;
- that its physical texture is still live;
- that it belongs to the renderer's device; and
- that no sampled resource in the bound fragment refers to the same physical texture.

The last check is the core ping-pong safety rule. It fails before submission and reports the illegal
read/write alias rather than relying on a WebGPU validation error.

Texture destruction is explicit and idempotent. Later binding or target access through any retained
view is rejected as use-after-destroy.

## Multiple fragment roots and materialization

V5 replaced the singleton selected-fragment assumption with a deterministic collection of GPU
slices. Selectors resolving to the same root share one normalization and artifact. Distinct roots
materialize independently and remain mapped back to their individual selector sites.

This required coordinated changes in:

- selection analysis;
- program analysis;
- slice normalization;
- artifact materialization;
- Core shader references and artifact-table embedding;
- generated host descriptors;
- hover lookup; and
- diagnostic ownership.

The legacy first-slice view remains only as a compatibility convenience. Actual materialization and
language-service work iterate every selected root. Diagnostics retain their owning root, preventing
an error in one shader from being incorrectly attached to another selector.

## Workman-owned presentation and offscreen rendering

The WebGPU presenter remains Workman code. V5 generalized it from one fixed surface bind group to
per-frame bind-group construction, allowing concrete resources to change without rebuilding the
pipeline.

It now supports:

- sibling surface renderers sharing a device and context;
- offscreen `rgba16float` renderers;
- optional uniform buffers and bind-group layouts;
- per-draw uniform upload and resource binding;
- host-selected render targets; and
- explicit buffer, texture, context, and device cleanup.

Renderers retain their completed `GPUShaderModule`. Creating an offscreen pipeline for the same
artifact reuses that module even though the target format differs. Different roots get different
modules, as they should. Pipeline construction is separate from concrete texture binding.

Sequential Workman calls determine pass order. V5 adds no render graph, dependency inference,
scheduler, pass fusion, or implicit swap.

## Feedback and resize lifecycle

The Game of Life example represents feedback orientation as ordinary immutable data:

```text
FeedbackPair { read, write }
```

Each frame performs:

1. bind `read.sampled` to the update fragment;
2. render the update result to `write.target`;
3. bind `write.sampled` to the display fragment;
4. render and present the surface; and
5. recurse with the pair swapped and frame incremented.

The shader artifact does not change during a swap. Only concrete resource bindings and the selected
attachment change.

SDL resize events are carried into the recursive frame state. A resize transition:

1. allocates and zero-initializes a new texture pair;
2. updates the Deno window-surface dimensions;
3. resets the simulation frame and pair orientation;
4. updates the size used by the display environment; and
5. explicitly destroys the old pair.

Neither shader source nor either renderer pipeline is reconstructed. If resizing the native surface
fails after allocating the replacement pair, that replacement is retired before the error is
returned.

The feedback texture is also its visual state. The real GPU gate caught that a nonzero “dead” red
channel polluted the next generation's neighbor sum. The example now reserves an exact zero/one red
lane for simulation state and uses the remaining lanes for its dark background color.

## Bootstrap performance follow-up

The completed V5 emitter initially exposed a compiler-startup regression. Every fresh shader CLI or
LSP process rebuilt the Workman-written wmslang compiler, and the V1 Peggy parser handled the
emitter's deeply nested operation-dispatch conditionals pathologically. Parsing `slice_emit.wm`
grew from roughly 1.3--1.8 seconds to about 6.2 seconds even though the file grew by only a few
kilobytes. A warm one-root shader compile consequently grew from about 5.1 seconds before V5 to
about 10.2 seconds.

The operation emitter now dispatches with string-pattern matches and small resource, projection,
and operator helpers. This both expresses the finite lowered-operation vocabulary more directly and
reduces isolated emitter parsing to roughly 0.23 seconds.

Normal CLI and LSP use also cache the validated generated wmslang ES module in CacheStorage, like
the separately cached pinned Slang WASM asset. The cache key is a SHA-256 digest of Workman compiler
sources, host compiler sources, standard-library sources, and build configuration. Relevant edits
therefore cause one source bootstrap; subsequent processes load the generated module directly. An
invalid cached module is discarded, and unavailable CacheStorage merely falls back to compilation.

After both changes, the measured one-root shader compile is about 4.3 seconds on an empty cache and
2.4 seconds from a fresh process with a populated cache. The same focused nine-test V5 slice group
dropped from about 58 seconds to 14 seconds.

## Verification strategy

V5 was developed against focused gates because the full repository test task is intentionally
long-running. The final evidence includes:

- nine V5 slice tests covering representations, conversions, operations, specialization, resource
  lowering, and unused-resource rejection;
- twelve V4 specialization and annotation regressions;
- terminal Slang reflection and generated-runtime tests;
- replacement-texture, sampler, cross-device, alias, and destruction tests;
- deterministic multi-root materialization tests;
- multi-root hover and diagnostic ownership tests;
- a real WebGPU test executing three update/display feedback iterations and reading back pixels;
- a real WebGPU regression render for the integer-counter raymarcher;
- full compilation of both SDL entries;
- a controlled 20-second run of the actual SDL/WebGPU feedback window;
- deterministic builtin-catalog verification;
- a rebuild of the Workman-written wmslang compiler; and
- `deno task check` across the compiler and test sources.

The real WebGPU test uses a validation error scope in addition to image assertions. This was
essential: it distinguished an interface-layout failure from a shader that merely produced an
unexpected image.

## Architectural result

V5 validates the original wmslang direction rather than weakening it:

- Workman HM still owns ordinary program typing.
- GPU facts and specialization own occurrence-local shader meaning.
- The serialized boundary contains values and evidence, not mutated surface AST.
- The Workman-written middle end owns typed functional IR and lowering.
- Slang validates and lowers a completed shader interface.
- The generated adapter owns physical WebGPU resources and safety checks.
- Ordinary Workman host code owns time, input, pass order, swapping, resize, errors, and lifetime.

This separation is why a feature spanning integers, resources, multiple shaders, WebGPU, SDL, and
the LSP remained incremental instead of requiring a compiler rewrite. It was a large amount of work
because it completed every layer of a genuinely stateful rendering feature, not because the core
language or compiler architecture had to be replaced.

The implementation also stayed within the V5 boundary. It introduced no storage resources,
compute, `u32`, general texture formats, mutable shader state, automatic scheduling, TypeGPU-style
slots, or Slang-driven reinference. Those remain possible later slices rather than hidden complexity
inside this one.
