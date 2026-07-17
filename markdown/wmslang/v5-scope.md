# wmslang v5 integer and feedback-texture slice

Status: implemented and focused-audited; see [`v5-implementation.md`](./v5-implementation.md) and
[`v5-audit.md`](./v5-audit.md). V5 makes the completed V4 fragment language useful for persistent
creative simulations. It adds one new numeric representation, `i32`, and one deliberately narrow
resource family: sampled two-dimensional float textures, samplers, offscreen fragment targets, and
explicit host-controlled ping-pong rendering. It also permits multiple selected fragment artifacts
in one Workman program so an update pass can feed a separate presentation pass.

V5 does not add compute shaders, storage textures, shader writes, automatic render graphs, general
bind-group authoring, or another numeric hierarchy. A fragment remains an immutable function that
samples declared inputs and returns one four-component color. Host Workman code chooses the render
target, orders passes, and carries feedback orientation as ordinary immutable state.

## Evidence and intent

The GLML corpus supplies both requirements:

- signed integers represent frame numbers, march counters, recursive subdivision depth, and discrete
  state; seven of seventeen examples explicitly mention `int`, and Mandelbrot infers an integer
  counter without annotating it;
- eight files form four sampled-buffer pairs: Game of Life, reaction diffusion, ripples, and
  interactive Bezier control points.

The continuous geometry and color paths remain overwhelmingly floating-point. The examples provide
no comparable pressure for `u32`, `f16`, or `f64`.

TypeGPU demonstrates the resource ownership split V5 adopts. Shader code is compiled against a
stable bind-group layout, while concrete bindings can change between executions. Its ping-pong
examples create two physical resources and two inverse binding arrangements, choose one at each
step, and swap a host index. TypeGPU explicitly describes directly captured resources as fixed and
non-swappable. Workman's existing curried shader environment can provide the stable layout without
copying TypeGPU's general slot or bind-group language.

The numeric and resource changes belong in one slice because exact texel access and feedback logic
exercise `i32`, while the feedback fixture gives the representation a real creative-programming
acceptance target.

## User-facing model

A shader factory's outer nominal record may contain copyable uniform fields and explicit opaque
resource fields:

```workman
record RippleInputs = {
  resolution: (Number, Number),
  frame: Number,
  mouse: (Number, Number),
  mouseDown: Bool,
  previous: Gpu.SampledTexture2D,
  sampler: Gpu.Sampler
};

let rippleStep = (inputs: RippleInputs) => {
  (coord) => {
    @gpu;

    let uv = coord / inputs.resolution;
    let previous = inputs.previous.Sample(inputs.sampler, uv);
    -- Pure calculation of the next state.
    (previous.x, previous.y, 0.0, 1.0)
  }
};
```

`Sample` illustrates the canonical pinned Slang resource operation. V5 extends the generated Slang
catalog and contextual GPU member lookup for structurally representable resource methods. It does
not invent a parallel `#texture` vocabulary. The final source spelling must be the pinned Slang
spelling retained by the generated catalog.

The host owns two textures and swaps their roles explicitly:

```workman
record FeedbackTexture = {
  sampled: Gpu.SampledTexture2D,
  target: Gpu.RenderTarget2D
};

record FeedbackPair = {
  read: FeedbackTexture,
  write: FeedbackTexture
};

record DisplayInputs = {
  image: Gpu.SampledTexture2D,
  sampler: Gpu.Sampler
};

let swap = (pair) => {
  FeedbackPair{ read: pair.write, write: pair.read }
};

let rec frameLoop = (updateRenderer, displayRenderer, pair, state) => {
  let updateFragment = Gpu.fragment(rippleStep(RippleInputs{
    resolution: state.resolution,
    frame: state.frame,
    mouse: state.mouse,
    mouseDown: state.mouseDown,
    previous: pair.read.sampled,
    sampler: state.nearestSampler
  }));

  let displayFragment = Gpu.fragment(display(DisplayInputs{
    image: pair.write.sampled,
    sampler: state.nearestSampler
  }));

  renderFragmentTo(updateRenderer, updateFragment, pair.write.target)
  :> Result.andThen((_) => {
    renderFragment(displayRenderer, displayFragment)
  })
  :> Result.andThen((_) => {
    frameLoop(updateRenderer, displayRenderer, swap(pair), nextState(state))
  })
};
```

The host operation names are conceptual until the adapter implementation is scoped in code. The
semantic division is fixed:

- factories declare uniform and sampled-resource inputs;
- bound fragments contain copied uniform bytes and explicit immutable resource bindings;
- renderers own compiled pipelines and WebGPU state;
- each draw names the surface or one offscreen target;
- host code owns ordering, swapping, initialization, resize, and lifetime.

## Numeric representations

Ordinary Workman retains one public `Number` type. V5 does not add host `I32` and `F32` types or
change JavaScript numeric representation. Each reachable GPU occurrence instead receives a concrete
representation overlay:

```text
f32
i32
f32x2, f32x3, f32x4
i32x2, i32x3, i32x4
```

Integer vectors are homogeneous Workman tuples using the one new scalar representation. The same
width-two-through-four rule as float vectors keeps tuple classification deterministic; `i32x2` is
needed for exact texel coordinates.

There is no `u32`, `f16`, `f64`, abstract integer kind, target-sized integer, numeric typeclass, or
promotion lattice.

### Literals, conversions, and unresolved values

Literal spelling is concrete evidence:

- an integral literal seeds `i32`;
- a decimal-point literal seeds `f32`;
- unary negation preserves the child literal representation;
- signed integer literals and patterns must fit `i32`, including direct `-2147483648`.

Context never silently promotes a literal. These are representation errors:

```workman
1 + 1.0
sin(1)
(1, 2.0)
```

The explicit compiler-known conversions are:

```text
Gpu.i32 : Number -> Number
Gpu.f32 : Number -> Number
```

Their public HM shape remains `Number -> Number`. GPU facts retain concrete input/output
representations, and typed IR contains an explicit conversion node. A conversion never equates its
operand and result representations, and V5 inserts no conversion because Slang could accept one.

V5 performs no numeric defaulting. A reachable representation still unresolved after call
substitution and operation-worklist convergence is an insufficient-context error. An annotation
cannot seed or repair it, preserving V4's annotation-erasure invariant.

### Operators, builtins, and specialization

Compiler-owned operators gain exact `i32` rows:

```text
i32    + - * / %  i32    -> i32
i32xN  + - * / %  i32xN  -> i32xN
i32xN  + - * / %  i32    -> i32xN
i32    + - * / %  i32xN  -> i32xN
```

`N` is 2, 3, or 4. Unary negation preserves shape. Equality and ordered scalar comparisons require
equal concrete representations and return `Bool`. Vector mask/comparison semantics remain absent.

Existing `f32` rows are unchanged. There are no mixed `i32`/`f32` arithmetic, comparison, broadcast,
branch-join, tuple, or argument rows; authors convert explicitly.

Pure `i32` scalar/vector overloads from the pinned Slang catalog become eligible when they satisfy
the existing V3 structural rules. V4 HM skeleton derivation, body freshening, concrete seed keys,
pending exact obligations, and the monotone specialization worklist remain the complete inference
mechanism. V5 adds finite rows, not another HM pass, constraint language, or Slang feedback loop.

### Integer uniforms

Numeric fields in the outer environment receive `f32` or `i32` layout from connected GPU occurrence
evidence rather than being hard-coded to `f32`. Homogeneous tuples receive corresponding vector
layouts. An unused or disconnected numeric field is rejected instead of defaulted.

Slang reflection remains authoritative for offsets and total size. The host packer writes signed
fields with range validation and float fields with existing packing. One artifact/schema identity
cannot silently acquire incompatible layouts at different applications.

## Texture and sampler types

V5 adds only these compiler-known opaque boundary types:

```text
Gpu.Texture2D           -- host-owned physical rgba16float texture
Gpu.SampledTexture2D    -- read-only shader-visible view
Gpu.RenderTarget2D      -- host-only fragment attachment view
Gpu.Sampler             -- shader-visible filtering state
```

The physical texture is created with sampled and render-attachment usage. Its views share storage
but have distinct types, preventing sampled and target roles from being confused.

The first offscreen format is fixed to `rgba16float`. It supplies more state precision than
`rgba8unorm`, has a direct four-`f32` shader view, and avoids general format/type relations. Surface
presentation retains the adapter-selected format. One shader module may therefore have separate
offscreen and presentation pipelines keyed by target format.

V5 exposes nearest and linear filtering samplers with clamp-to-edge addressing. Comparison sampling,
anisotropy, arbitrary address modes, sampler arrays, and general sampler descriptors are deferred.

### Environment partition and binding identity

The outer nominal environment normalizes into two deterministic schemas:

```text
uniform schema:
  copyable f32/i32 scalar and homogeneous vector fields

resource schema:
  sampled texture and sampler fields
```

Resource fields are never packed into constant-buffer bytes. Declaration order, resolved field
identity, kind, sample type, visibility, and binding position become artifact layout facts.
Generated Slang declarations and WebGPU layouts must agree; reflection/backend disagreement is an
internal error retaining Workman source evidence.

Applying a factory remains a runtime binding operation, never recompilation. A bound fragment holds:

- artifact, nominal environment, uniform schema, and resource-layout identities;
- freshly copied uniform bytes;
- an ordered immutable set of typed opaque resource bindings.

A texture cannot be serialized by value, so retaining an opaque runtime binding is necessary. This
is not the foreign-reference inference side channel rejected elsewhere: the resource is authored in
the nominal boundary, has a compiler-known kind and layout slot, and is validated explicitly. It
never enters HM as `Js.Object`, supplies hidden type evidence, or changes shader meaning according
to object identity.

Concrete texture and sampler identities are excluded from module and pipeline cache keys. Resource
layout identity is included. Opposite ping-pong bindings therefore share Slang, WGSL, and pipelines.

### Sampling operations

Only pure fragment-legal pinned Slang operations become eligible. V5 requires:

```text
sampled f32 Texture2D + Sampler + f32x2 normalized coordinate -> f32x4
sampled f32 Texture2D + i32x3 (x, y, mip) coordinate           -> f32x4
```

These are the pinned Slang `Sample` and exact-load resource operations after catalog normalization.
They remain direct builtin calls and cannot be extracted, partially applied, stored, or passed as
values.

Exact load is required because Game of Life must not depend on normalized-coordinate rounding. The
canonical Slang `Texture2D.Load` coordinate combines the two texel lanes and mip level in `i32x3`;
V5 textures have one mip and acceptance uses explicit mip `0`. Shader-side dimensions are deferred
if the pinned operation would require `u32` or implicit narrowing; the existing `resolution` uniform
is the initial dimension source.

Sampled textures are read-only in shader source. There is no storage view, texture store, atomic,
pointer, mutable receiver, or hidden fragment effect. The only write remains the pure fragment
result routed to the host-selected target.

## Offscreen targets and multiple passes

V5 removes the whole-program restriction of one selected `Gpu.fragment` call. Every selector maps to
one completed artifact/bound site. Equal factory/schema identities deduplicate modules and
compatible pipelines; update and display roots remain distinct. Selection, materialization, Core
erasure, embedding, and diagnostics consume a deterministic selector map rather than a singleton.

Drawing a compatible bound fragment:

1. validates artifact, nominal environment, uniform schema, and resource layout;
2. uploads copied uniform bytes;
3. binds submitted sampled views and samplers without recompilation;
4. validates target format and read/write alias rules;
5. renders to the surface or supplied offscreen target.

Sequential Workman calls establish pass order through WebGPU queue ordering. V5 builds no render
graph, infers no dependencies, fuses no passes, and never reorders host calls. Failures use normal
`Result`/`Task` composition.

The runtime rejects sampling the same physical subresource used as the current color output. It also
rejects destroyed resources, cross-device resources, wrong view/sample type, incompatible target
format, and bound fragments from another layout before submission.

Both feedback textures have defined initialized contents before first sampling. Creation may
zero-clear them or use an explicit initialization draw, but cannot expose undefined prior state.
Resize creates and initializes a new pair, resets orientation, updates size-dependent views and
bindings, and retires old resources without recompiling shader source. Lifetime and idempotent
cleanup remain explicit host behavior, not shader effects.

## Compiler and language service

TypeScript continues to own parsing, binding identity, environment normalization, WebGPU adapter
integration, artifact embedding, and LSP transport. The Workman-written middle end owns numeric
representation facts, V4 worklist extension, typed resource reads, functional IR validation, and
immutable lowering.

The sidecar handoff gains literal representation evidence, occurrence-local `i32`/`f32` variables,
explicit conversion identities, resource-layout fields, sampled-resource types and call obligations,
multiple selector rows, and resource diagnostic evidence. Raw WebGPU objects and TypeGPU-style slots
never enter the serialized shader graph; shader IR contains logical resource parameters only.

GPU hover reports concrete `i32`/`f32` scalar or vector types and sampled texture/sampler types per
specialization. Resource calls show their selected pinned Slang signatures. Host hover continues to
show ordinary `Number` and nominal opaque `Gpu.*` types. Annotations never choose representation,
resource overload, or binding layout.

Diagnostics distinguish numeric conflict/range/insufficient context, unsupported resource method,
layout mismatch, illegal aliasing, wrong-device/destroyed resource, incompatible target format, and
backend/reflection drift.

## TypeGPU lessons

V5 adopts stable layouts separated from concrete bindings; distinct physical, sampled-view,
render-view, and sampler roles; usage fixed at texture creation; inverse ping-pong bindings sharing
one program; and explicit host swap/order/resize/cleanup.

V5 does not copy general bind-group declarations, catch-all fixed captures, runtime slots, lazy
resource resolution, TypeScript/WGSL dual execution, mutable storage syntax, or general pipeline
APIs. The Workman nominal factory environment is sufficient until a concrete fixture disproves it.

## TypeGPU versus Slang responsibility

TypeGPU and Slang are similar at the shader-resource boundary but operate at different layers.
TypeGPU is both a TypeScript shader DSL and a host resource library: its schemas describe shader
types, its layouts describe bindings, and its runtime creates resources, bind groups, pipelines, and
passes. Slang is the shader compiler only. It supplies resource types, operations, target lowering,
and reflection; the Workman/WebGPU adapter must own every concrete host resource and command.

The similarity is sufficient for V5 at the resource ABI, not at the language or library API. Both
models ultimately need a stable typed binding layout, concrete resources supplied separately from
that layout, and host-selected render attachments. V5 can therefore reuse TypeGPU's ownership and
ping-pong arrangement without reproducing its TypeScript schema system, slots, `.with(...)` API, or
WGSL code-generation model. Workman facts and typed wmslang IR replace TypeGPU's shader schemas;
generated Slang replaces its WGSL-producing DSL; the existing Workman/WebGPU adapter fills the host
runtime role.

The V5 mapping is:

| Concern             | TypeGPU                                       | V5 through Slang                               |
| ------------------- | --------------------------------------------- | ---------------------------------------------- |
| sampled texture     | `d.texture2d()` and a sampled view            | generated `Texture2D<float4>` parameter        |
| sampler             | sampler schema and runtime sampler            | generated `SamplerState` parameter             |
| normalized sample   | `std.textureSample(texture, sampler, uv)`     | canonical `texture.Sample(sampler, uv)`        |
| exact load          | `std.textureLoad(texture, coordinate, mip)`   | canonical `texture.Load(int3(x, y, mip))`      |
| stable layout       | `bindGroupLayout(...)`                        | Workman resource schema plus fixed bindings    |
| concrete binding    | `.with(bindGroup)`                            | immutable bound fragment plus WebGPU group     |
| render destination  | `.withColorAttachment(...)`                   | host-selected surface/offscreen attachment     |
| interface checking  | TypeGPU schema/code generation                | Workman prediction checked by Slang reflection |
| ping-pong selection | host index chooses inverse groups/attachments | immutable Workman `FeedbackPair`               |

Slang's WGSL target directly lowers its HLSL-style resource methods to WGSL resource operations.
`Texture2D.Sample` becomes `textureSample`; `Texture2D.Load(int3(x, y, mip))` becomes `textureLoad`.
V5 therefore needs no Workman-authored implementation of sampling and no GLSL compatibility
intrinsic. Catalog generation must learn resource receiver types and method overloads, then retain
the exact selected Slang declaration as it already does for free builtins.

The complete direction of information is one-way:

```text
Workman source
  -> Workman HM plus GPU facts and exact operation selection
  -> typed wmslang IR with a predicted resource layout
  -> generated Slang with explicit bindings
  -> Slang validation, WGSL, and reflected resource ABI
  -> terminal agreement check against the Workman prediction
  -> WebGPU layouts, concrete bind groups, and host-submitted render passes
```

Neither Slang reflection nor WebGPU runtime objects feed types, overload choices, resource fields,
or specialization decisions back into Workman. A disagreement at the terminal check is a compiler or
backend error, not a reason to run HM or GPU elaboration again. Slang may of course perform its own
internal compiler passes, but those are opaque backend implementation details.

This gives implementation questions a strict owner:

- Workman HM, GPU facts, and typed wmslang IR own source meaning, resource-field eligibility,
  operation selection, and the predicted binding schema;
- the Slang emitter and backend own concrete shader declarations, target legalization, WGSL
  generation, and terminal reflection of the generated interface;
- the Workman/WebGPU adapter owns physical textures and views, samplers, bind groups, attachments,
  command encoding, submission order, resize, and lifetime.

TypeGPU may inform the third layer's API and lifecycle design, but it cannot substitute for that
layer. Slang may verify the second layer, but it cannot create or schedule anything in the third.
Conversely, neither TypeGPU-inspired host machinery nor reflected Slang metadata may redefine the
first layer after elaboration has completed.

V5 keeps three identities distinct:

1. shader and resource-layout identity, which controls Slang/WGSL and pipeline reuse;
2. concrete binding identity, which selects the current texture views and sampler without
   recompilation; and
3. render-destination/pass identity, which selects the surface or offscreen attachment and command
   order on the host.

This is what makes TypeGPU's ping-pong pattern portable to the Slang-backed design. Swapping the
second and third identities does not change the first.

The initial generated interface should remain explicit and flat, conceptually:

```slang
[[vk::binding(0, 0)]]
ConstantBuffer<Uniforms> uniforms;

[[vk::binding(1, 0)]]
Texture2D<float4> previous;

[[vk::binding(2, 0)]]
SamplerState previousSampler;
```

Slang accepts these explicit group/binding assignments for its WGSL target and emits corresponding
WGSL `@group`/`@binding` declarations. The `vk::binding` source spelling is a Slang cross-target
binding attribute; using it does not make the V5 runtime Vulkan-specific.

V5 deliberately does not use Slang `ParameterBlock` for the first resource slice. Parameter blocks
are useful for broad material/resource grouping, but the existing Workman nominal environment
already supplies the grouping and identity boundary. Flat deterministic bindings are easier to
predict, reflect, validate, and construct with WebGPU. A later general-resource scope may revisit
parameter blocks if several independently replaceable resource groups require them.

Workman layout facts remain authoritative for source meaning. Slang reflection is a terminal
agreement check, exactly as with the existing uniform layout: it confirms resource kind, group,
binding, and stage visibility but never invents a missing Workman field, changes a selected
overload, or feeds another inference pass. The adapter constructs the matching `GPUBindGroupLayout`
and concrete bind groups from the completed artifact metadata.

The output side is intentionally asymmetric. The sampled input is a declared Slang resource; the
offscreen output is not. A fragment still returns `f32x4`, while the host render pass routes that
value to its selected color attachment. Swapping A and B therefore changes one sampled binding and
one host attachment without changing generated Slang or WGSL.

TypeGPU statically tracks physical texture usage through TypeScript wrapper types. Slang sees only
the shader-facing view and cannot validate that the underlying WebGPU texture was created with both
sampled and render-attachment usage, belongs to the active device, remains alive, or is not also the
current output. V5's opaque Workman wrappers and pre-submission adapter checks own those guarantees.

Finally, Slang's type named `FeedbackTexture2D` means hardware sampler-feedback metadata and is not
temporal frame feedback. V5 uses ordinary `Texture2D<float4>` inputs plus two host-owned
`rgba16float` render targets. No Slang feedback resource, writable texture, or hidden mutation is
involved.

“Multiple fragment passes” in this document always means multiple ordered WebGPU render passes
submitted by host Workman code. It does not mean multiple Workman inference passes, a
TypeScript-FFI-style reinference loop, or feedback from Slang into wmslang elaboration.

## Creative acceptance programs

### Integer ray marcher

Use a genuine `i32` step counter in the existing raymarcher while distance remains `f32`. Any float
use of the count crosses through explicit `Gpu.f32`. The unannotated program keeps one monomorphic
recursive specialization and emits an integer loop variable.

### Sampled image pass

Create and initialize one `rgba16float` texture, bind its sampled view and a sampler through a
shader factory, and display it through the real surface path. Changing only the concrete sampled
texture must reuse artifact and pipeline identity.

### Ping-pong Game of Life

Port the GLML buffer/image structure as two Workman fragment factories. The update exact-loads the
read texture and renders next state to the write target. The display samples that result to the
window. The SDL loop carries input/frame state and an immutable `FeedbackPair`, swaps after each
frame, handles resize, and never reconstructs modules. A forced alias must fail before submission.

Game of Life is the scope gate. Reaction diffusion and ripples should be expressible with the same
API but are not both required ports.

## Non-goals

- `u32`, `f16`, `f64`, abstract numeric types, contextual promotion, or defaulting;
- annotation-driven representation, implicit conversion, narrowing, or widening;
- matrices, general vector indexing, multi-lane swizzles, or vector mask comparisons;
- other texture formats/dimensions, arrays, cubes, depth, multisampling, mip generation, or external
  images;
- general sampler descriptors, comparison samplers, or anisotropy;
- storage textures/buffers, shader writes, atomics, barriers, or workgroup memory;
- compute or user-authored vertex stages;
- automatic render graphs, scheduling, dependency inference, fusion, or implicit swapping;
- user-declared bind groups, TypeGPU slots, or hidden resource capture;
- sampling and rendering one physical subresource in the same pass;
- resource-driven shader specialization or concrete-resource cache keys;
- runtime shader closures, imported GPU modules, or broader higher-order conversion;
- Slang-driven reinference or another HM loop.

## Acceptance

V5 is complete when focused tests prove:

1. Integral and decimal literals produce `i32` and `f32` evidence with signed-range validation.
2. Mixed flow fails with both provenance paths; explicit conversions survive typed/lowered IR.
3. Scalar and homogeneous `i32` vector operations select only the documented finite rows.
4. V4 specialization independently instantiates one unannotated helper for `i32` and `f32` using
   fresh body/obligation variables and the existing worklist.
5. An unresolved reachable representation fails with and without annotations; no defaulting occurs.
6. The raymarcher uses an integer counter and explicit float conversion with stable output.
7. Uniform reflection/packing supports signed scalar/vector fields and range-checks host values.
8. One nominal environment deterministically partitions uniform bytes from resource bindings, emits
   fixed flat group/binding assignments, and agrees with terminal Slang resource reflection.
9. The catalog exposes required `Texture2D.Sample`/`Load` receiver rows only in GPU context and only
   as direct calls, preserving the selected canonical Slang method identity through IR and WGSL.
10. Shader IR contains logical resources and reads but no raw object or mutable texture write.
11. One `rgba16float` texture yields distinct sampled/target wrappers; role, device, and lifetime
    errors fail explicitly.
12. Nearest and linear samplers can change without artifact recompilation.
13. Different concrete textures preserve WGSL/artifact/layout identity and change only bindings.
14. Multiple selectors materialize deterministically, deduplicate equal roots, survive Core
    lowering, and remain independently addressable in host output.
15. Compatible offscreen and presentation pipelines reuse one completed shader module where roots
    agree, without recompiling Workman source.
16. Sequential update/display calls preserve submission order without a compiler render graph.
17. Read/write aliasing is rejected before submission with both resource roles identified.
18. New/resized feedback pairs are initialized, reset orientation, and retire old resources safely.
19. SDL Game of Life repeatedly updates, displays, and swaps while reusing modules and pipelines.
20. Hover and diagnostics show concrete numeric/resource types without changing host `Number` or
    using annotations as evidence.
21. Focused V1--V4, catalog, lowering, WebGPU, LSP, and SDL gates remain green; full
    `deno task test` is not the V5 iteration gate.
22. HM and specialization finish before Slang; reflection/backend validation cannot trigger
    reinference, alternate overload selection, or promotion.
23. Tests keep layer ownership explicit: wmslang facts predict the interface, Slang only validates
    and lowers it, and the adapter alone creates resources, bindings, attachments, and render
    commands.

Storage writes, compute, another texture family, `u32`, general layouts, or automatic scheduling
found necessary by implementation must be separately scoped rather than entering V5 implicitly.
