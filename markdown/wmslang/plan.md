# wmslang implementation plan

Status: architecture reviewed and locked for implementation spikes. Small milestones still have to
validate the design, but they should refine representations rather than reopen the ownership,
typing, execution, or artifact model below.

The compiler ownership and isolation strategy is specified in
[`compiler-boundary.md`](./compiler-boundary.md). In particular, `@gpu` is an elaboration island:
it reuses Workman's HM machinery through a scoped typing dialect, while shader analysis, IR,
Slang lowering, and artifacts remain a sidecar pipeline.

The comparison with TypeGPU, Tinyest, `typegpu-three`, and `typegpu-gl` is recorded in
[`typegpu-research.md`](./typegpu-research.md). The resulting decision is to build a Workman-owned
typed functional shader IR rather than reuse Tinyest as the canonical representation.

The comparison with the immutable HM shader language GLML is recorded in
[`glml-research.md`](./glml-research.md). It refines the design toward deferred GPU constraints,
reachable monomorphization, finite ADTs and higher-order functions, and two shader IR levels.

The implementation-language and bootstrap boundary is specified in
[`implementation-language.md`](./implementation-language.md). The compiler integration and Slang
service remain in TypeScript, while a generated Workman library owns the closed, pure wmslang
middle-end behind a versioned DTO.

The supporting collection design in [`compiler-collections.md`](./compiler-collections.md) specifies
a small comparator-based persistent AVL map in Workman `std`. It supplies the scope-preserving,
deterministic environment semantics needed by Workman-written compiler passes.

## Goal

Allow CPU code, WebGPU setup through Workman's TypeScript FFI, and inferred shader code to coexist
in one `.wm` file.

Shader code is written as ordinary Workman lambdas with an `@gpu;` directive prologue:

```workman
let palette = (t) => {
  @gpu;

  let a = (0.5, 0.5, 0.5);
  let b = (0.5, 0.5, 0.5);
  a + b * cos(t)
};
```

Workman owns parsing, name resolution, type inference, shader eligibility, and diagnostics. A typed
shader IR is lowered to generated Slang. Slang validates and compiles that generated program to
WGSL or another target. The emitted JavaScript uses the resulting WGSL with normal WebGPU APIs.

The intended end state is one large program shaped like this. The fuller compute/readback sketch in
[`illustrative-example.md`](./illustrative-example.md) places the current raw-WebGPU Workman example
beside its future inline-wmslang counterpart:

```workman
from js.global import { navigator };

let shade = (uv, time) => {
  @gpu;
  let wave = sin(uv.x * 8.0 + time);
  (0.2 + wave * 0.1, 0.4, 0.8, 1.0)
};

-- Illustrative spelling of the compiler-owned entry constructor and artifact accessors.
let fragment = Gpu.fragment(shade);

let main = () => {
  navigator.gpu.requestAdapter()
    :> Task.andThen((adapter) => { adapter.requestDevice() })
    :> Task.map((device) => {
      let module = device.createShaderModule(JSON{
        "code": Gpu.wgsl(fragment)
      });

      -- The rest is ordinary typed WebGPU setup through the existing TS FFI.
      setupPipeline(device, module, Gpu.entryPoint(fragment))
    })
};
```

`Gpu.wgsl` and `Gpu.entryPoint` above illustrate compile-time shader artifacts, not a requirement
that source-to-source compilation happen at runtime.

## Firm direction

- `wmslang` is a Workman shader dialect, not embedded Slang syntax.
- `@gpu;` is local to a lambda. It does not switch an entire file or module into shader mode.
- CPU code, GPU functions, entry points, resources, and WebGPU FFI calls may be interleaved.
- Workman's HM-based checker is the source-language type checker.
- Slang is a validation, legalization, optimization, and target-code backend.
- Slang reflection describes the compiled GPU ABI. It does not typecheck Workman source.
- Homogeneous numeric tuples provide the pleasant vector syntax; users should not have to spell
  `float3` for normal creative shader code.
- Direct self-tail recursion is Workman's primary shader-loop syntax and lowers to an imperative
  loop in generated Slang.
- Generated Slang should be inspectable for debugging, but users are not expected to author it.
- The existing Slang playground is a reference implementation and potential development harness,
  not the semantic definition of wmslang or a required production runtime.

## Non-goals for the first implementation

- Importing arbitrary `.slang` source into Workman.
- Raw Slang snippets or an escape hatch embedded in Workman expressions.
- Reproducing the Slang language surface.
- Making Slang reflection decide Workman types.
- Supporting every Slang target or shader feature initially.
- General recursion on the GPU.
- Mutual tail recursion in the first tail-call lowering pass.
- Automatically treating an opaque TypeScript `GPUBuffer` as a typed `Buffer<T>` without any
  Workman-side evidence for `T`.

## Compilation model

```text
Workman source
  -> surface AST, including lambda directive prologues
  -> normal name resolution plus shader-aware HM inference
  -> GPU capability and capture analysis
  -> typed functional wmslang IR
  -> reachable specialization, ADT lowering, and closure conversion
  -> lowered control-flow IR (ANF, switches, parameterized loops)
  -> generated Slang module
  -> Slang parse/check/link
  -> target code (WGSL first) plus reflected ABI
  -> JavaScript emitter embeds target code and shader metadata
```

The typed functional wmslang IR is the semantic boundary TypeGPU cannot obtain from `tsc`: every
node carries a resolved shader type, binding identity, and Workman source span. A second lowered IR
introduces the mutation and control flow needed by Slang without changing the source language's
immutable semantics.

## Directive syntax and AST

The initial syntax is a directive prologue at the beginning of a lambda block:

```workman
let f = (x) => {
  @gpu;
  x * x
};
```

Rules:

- `@gpu;` must occur before executable expressions and declarations in that lambda body.
- It applies to the immediately containing lambda, not nested lambdas.
- Repeated `@gpu;` is an error.
- An `@gpu;` outside a lambda is an error initially.
- Directives must be preserved by both frontends, structural tooling, formatting, and diagnostics.
- A directive is not an expression returning `Void`; it is semantic syntax removed before runtime
  Core lowering.

Suggested surface representation:

```ts
type Directive = Located<{ name: string }>;

type LambdaExpr = Located<{
  kind: "Lambda";
  params: Param[];
  directives: Directive[];
  body: Expr;
}>;
```

Arguments on directives are not part of the initial design. Workgroup sizes, resource formats, and
stage configuration are typed arguments to host-side `Gpu` constructors instead.

## Type checking ownership

Workman checks:

- parameter and result inference;
- operator types and vector lifting;
- calls between GPU-capable functions;
- which lexical captures may enter a shader graph;
- record and tuple construction;
- shader intrinsics;
- tail-position legality;
- GPU-storable and GPU-passable types;
- rejection of CPU-only FFI values inside shader execution.

Slang subsequently checks:

- correctness of generated Slang;
- target capability and legalization constraints;
- stage and resource rules not represented in the portable wmslang checker;
- final layout and target code generation.

After Workman accepts a shader, a Slang type error should normally be classified as a backend
limitation or compiler defect and remapped to the originating Workman span where possible.

## Function capabilities

Function execution capability is an analysis fact, not part of the ordinary HM `Ty` union and not
a user-written effect annotation. Facts are keyed by resolved binding/lambda identity and, after
specialization, by specialization identity.

The initial capabilities are:

```text
CPU-only
GPU-eligible ordinary helper
GPU-only declared function
```

An `@gpu;` lambda is a GPU-only declared function and is not emitted as an ordinary CPU-callable
closure. Host Workman may name it and pass it through compiler-resolved immutable bindings as an
opaque `GpuFn`, but it cannot escape through arbitrary FFI or dynamic host data. It becomes an
artifact root only when a typed stage constructor selects it. An ordinary pure Workman helper
remains CPU-callable and may additionally be proven GPU-eligible when reached from such a root. GPU
capability therefore does not participate in ordinary HM generalization. Generalized shader
representation constraints live in a parallel `GpuScheme` fact keyed by the helper's binding ID.

Required behavior regardless of representation:

- A GPU lambda may call another GPU-capable function.
- A GPU lambda may not call a CPU-only or arbitrary JS FFI function.
- Host code may carry a GPU function only as a statically tracked opaque `GpuFn` for stage selection.
- Entry-point constructors accept only GPU-capable functions.
- GPU dependency discovery follows resolved binding identity, not source spelling.

Illegal cross-domain calls are diagnosed during final shader semantic analysis, before functional
IR construction and code generation.

## GPU effects and stage capabilities

Shader effects are also parallel analysis facts rather than additions to ordinary HM function
types. The closed fact vocabulary distinguishes pure computation, resource reads, resource writes,
and stage-restricted operations. The first resource slice implements reads; later intrinsics enable
writes, derivatives, atomics, and workgroup memory.

Facts refer to stable resource/capture IDs where applicable, are unioned transitively through the
resolved GPU call graph, and are validated when a stage constructor selects an artifact root.

Only compiler-known GPU intrinsics introduce effects. Workman source remains immutable: writable
buffers, textures, atomics, and workgroup memory do not expose general local mutation or arbitrary
Slang statements. A pure helper stays usable in every compatible stage; a helper using derivatives,
for example, is rejected from a compute root before Slang generation. This is deliberately a
shader-local capability analysis, not a new host-language effect system.

## Workman-to-Slang type reification

This is a representation mapping after Workman inference plus GPU constraint solving, not a
replacement HM type system.

| Workman type/shape | Initial Slang representation | Notes |
| --- | --- | --- |
| `Bool` | `bool` | Value and control-flow type. |
| `Number` from a floating context | `float` | Defaults to 32-bit for the first target. |
| integer required by a GPU builtin | `int` or `uint` | Context fixes signedness before typed IR. |
| `Void` | `void` | Entry points and effectful operations. |
| `(Number, Number)` | `float2` | Homogeneous numeric tuple reification. |
| `(Number, Number, Number)` | `float3` | Primary creative-coding vector syntax. |
| `(Number, Number, Number, Number)` | `float4` | Color and position syntax. |
| homogeneous integer tuple of arity 2-4 | corresponding integer vector | Context decides signedness. |
| nominal Workman record | generated Slang `struct` | All fields must be reifiable. |
| structural record | generated private Slang `struct` | Stable field order and identity are required. |
| function | specialized direct call or defunctionalized closure | First-order H1; finite higher-order closure sets follow. |
| `String` | unsupported runtime shader value | Compile-time diagnostic text may be handled separately. |
| `List<T>` | unsupported runtime value initially | Later compile-time unrolling is separate from storage. |
| finite monomorphized ADT | generated tag plus payload struct | Initially private shader values; ABI use is deferred. |

Important distinctions:

- Ordinary CPU tuples keep their existing JavaScript representation.
- Vector reification happens only inside a GPU function or GPU ABI.
- `f(x, y, z)` remains a multi-argument call; `f((x, y, z))` passes one vector-shaped value.
- Heterogeneous and non-vector tuples become generated private product structs when every element
  is shader-reifiable. They are rejected at entry, resource, and uniform ABI boundaries initially.
- Nested homogeneous tuples as matrices are attractive, but deferred until matrix orientation and
  multiplication semantics are specified.

### Numeric refinement contract

Current Workman deliberately unifies integer and floating literals as `Number`. GPU code needs at
least float, signed integer, and unsigned integer representations.

Public Workman types continue to use `Number`. GPU inference hooks preserve literal spelling and
record constraint seeds, but the GPU solver runs only after the final staged FFI/HM inference pass.
It consumes pruned normalized HM types, expression facts, and resolved IDs. Generalized helpers
carry a parallel `GpuScheme`; each reachable specialization instantiates and solves that scheme
before typed functional IR is finalized. The solver never mutates the host `Ty` graph.

Fractional or exponent-form literals seed `f32`. Integral spelling creates an unresolved numeric
representation that context may fix to `i32`, `u32`, or `f32`; a negative value excludes `u32`.
Indexing, dispatch IDs, bit operations, and resource operations must provide integer/signedness
evidence. Otherwise an unresolved integral-form shader number defaults to `i32`; decimal-form
creative math remains `f32`. Required promotions and conversions are materialized explicitly in
typed IR.

Homogeneous numeric tuples of width 2-4 are vector candidates and default to vectors in GPU code.
A persistent representation fact records that choice so later lowering never re-derives it from
shape. Product representation is reserved for heterogeneous, nested, or explicitly product-typed
values; matrices remain deferred until their orientation and multiplication semantics are defined.

## Expression mapping

Initial mappings:

| Workman construct | Typed wmslang IR | Generated Slang |
| --- | --- | --- |
| literal | typed literal | scalar literal |
| variable | resolved local/capture | local/global/generated parameter |
| tuple expression | vector or product construction | `floatN(...)` or generated product |
| record expression | typed struct construction | generated struct constructor/initializer |
| immutable `let` | `Let` | Slang `let` |
| function call | resolved GPU call | specialized Slang call |
| arithmetic/comparison | typed operator | native Slang operator/intrinsic |
| `if` expression | typed branch expression | return branches or generated temporary/control flow |
| block result | expression result | final expression becomes `return` where required |
| direct tail call | typed functional `TailCall` | lowered parameter update plus loop `continue` |
| pipe | elaborated call | ordinary specialized call |

Later mappings include record/tuple patterns, suitable `match` forms, texture operations, buffer
operations, atomics, workgroup memory, derivatives, and stage-specific builtins.

## Tail recursion as shader loops

Direct self-tail recursion is a core wmslang feature, not a workaround for missing loop syntax.

```workman
let rec march = (origin, direction, distance, remaining) => {
  @gpu;

  let point = origin + direction * distance;
  let nearest = sceneDistance(point);

  if (nearest < 0.001 || remaining == 0) {
    .{ point, distance, hit = nearest < 0.001 }
  } else {
    march(origin, direction, distance + nearest, remaining - 1)
  }
};
```

Lowering requirements:

- Recognize calls to the same resolved binding in tail position.
- Tail positions include the function result, either branch of a tail `if`, tail `match` arms, and
  the final result of a block.
- Evaluate every next-call argument using the old parameter environment.
- Store next arguments into temporaries before assigning loop parameters.
- Turn the function into a Slang loop with mutable internal parameter locals.
- Preserve source spans on the loop and each rewritten argument.
- Reject remaining non-tail self-calls with a Workman diagnostic.
- Reject mutual recursion initially; later it may lower to a tagged state-machine loop.
- Do not rely on Slang accepting recursion and hope the target supports it.
- Lower plain direct tail recursion to an unbounded Slang loop with no compiler-inserted iteration
  budget or fallback value. Termination is the program's semantics; diagnostics may flag an
  obviously unconditional loop, and a future bounded-iteration helper must be explicit.

This pass should share tail-position analysis concepts with the current JavaScript direct-tail-call
optimization, while producing a shader-specific IR transformation rather than reusing JS emission.

## Lexical captures and closure conversion

Every free resolved binding used by an `@gpu;` lambda is classified before Slang generation.

| Capture category | Intended lowering |
| --- | --- |
| GPU-capable function | dependency edge and specialized/lifted Slang function |
| compile-time scalar/vector/record constant | inline constant or generated Slang constant |
| runtime scalar/vector/record | uniform data |
| typed read-only GPU resource | reflected resource binding |
| typed writable GPU resource | reflected writable binding plus GPU effect permission |
| sampler/texture handle with Workman type evidence | corresponding Slang resource |
| arbitrary JS object or CPU-only function | compile-time error |
| opaque raw `GPUBuffer` without element evidence | compile-time error or explicit typed wrapping |

Captures should be keyed by semantic binding ID. Generated names are an implementation detail.

Compile-time capture means a pure expression composed only of literals, immutable constructors,
and other compiler-evaluable constants. The compiler does not execute arbitrary Workman or
JavaScript to discover specialization values. Any other legal scalar/vector/record host capture is
runtime uniform data; changing it must not change the shader cache key.

Static shader type information is sufficient to generate WGSL ahead of runtime even when the
actual GPU resource objects are created later. Runtime scalar captures should become uniform fields
rather than forcing runtime source generation. Pipeline/source caching therefore keys on shader IR,
types, entry-point configuration, and static specialization values—not on ordinary uniform values.

## Typed GPU boundary

TypeScript's WebGPU declarations type `GPUBuffer` as an opaque allocation; they do not preserve its
element schema. End-to-end checking therefore needs a thin Workman-owned evidence layer even if all
device and command setup remains direct TS FFI.

The evidence layer consists of nominal Workman types with compiler-known runtime representations:

```text
Gpu.Buffer<T, Access>
Gpu.Texture2D<T, Access>
Gpu.Sampler
Gpu.Vertex<F>
Gpu.Fragment<F>
Gpu.Compute<F>
Gpu.Program<Entries, Bindings>
```

This layer must:

- carry static element/format/access evidence;
- wrap or pair with the underlying FFI WebGPU object;
- expose generated WGSL, entry-point names, and reflected binding metadata;
- avoid becoming a second all-encompassing WebGPU API.

Raw WebGPU objects never acquire shader element types through TypeScript reflection alone. A typed
wrapper constructor pairs the raw object with static schema/access evidence, and the compiler emits
that evidence in the predicted manifest. Phase 7 may add only the constructors demanded by its
first resource fixture; allocation, update, and full WebGPU convenience APIs remain intentionally
outside wmslang.

## Entry points

`@gpu;` marks execution eligibility; it does not encode a shader stage. Stage wrappers are
compiler-known, typed host-level constructors, so stage configuration participates in inference:

```workman
let fragment = Gpu.fragment(shade);
let compute = Gpu.compute(workgroupSize, kernel);
```

`Gpu.fragment`, `Gpu.vertex`, and `Gpu.compute` have ordinary typed surface declarations but are
recognized by stable intrinsic IDs and never execute as normal JavaScript calls. They accept an
opaque GPU function plus typed stage configuration and produce an opaque `ShaderArtifact` host
value. Entry lambdas use nominal records from the compiler-owned `Gpu` basis for stage inputs,
outputs, builtins, and interpolation evidence. There is no positional convention or field-name
magic. The H3 catalog is deliberately one case: a no-input fragment function returning the nominal
color output constructed by `Gpu.color`. Later stage records extend this model rather than overload
tuple shape or field spelling with stage semantics.

Stage construction is statically resolved. H3 accepts a direct GPU-function binding; later finite
function selection may use the same closed-world defunctionalization as higher-order shader code.
An arbitrary runtime choice of function cannot become an entry point because there is no runtime
shader compiler or AST interpreter.

Shader operators and common creative-math names are likewise stable compiler intrinsics. The GPU
typing dialect opens the compiler-owned math basis within an `@gpu` body, allowing `sin`, `cos`,
`dot`, and similar conventional names without polluting host scope. Qualified `Gpu.*` declarations
remain the explicit host-facing spelling for entry constructors and artifact access.

Avoid field-name magic unless it is deliberately specified and diagnosed. Stage semantics should be
represented by types or explicit constructors, not accidental record spelling.

## Slang generation

The emitter should generate simple, monomorphic Slang first:

- one declaration per reachable specialized GPU function;
- generated structs for reified Workman records;
- generated globals/parameter blocks for captures;
- stage entry-point wrappers around reusable GPU functions;
- `#line` information or an equivalent source map where Slang supports it;
- deterministic names and declaration order for snapshots and caching;
- no attempt to expose generated names as Workman semantics.

Slang generics, interfaces, lambdas, autodiff, and modules can be used later when they materially
improve generated code. The first backend should prefer predictable output over demonstrating every
Slang feature.

The backend may import pinned compiler-owned Slang support modules. Such imports are generated
implementation details, never a Workman source escape hatch. Slang playground modules may support
fixtures and the development harness, but they do not define production stage IO or wmslang types.

## Slang reflection

After linking generated entry points, obtain target layout reflection from the compiled component.

Reflection is used to:

- obtain final binding indices and access modes;
- obtain uniform offsets, sizes, and padding;
- obtain entry-point stages and workgroup sizes;
- describe textures, samplers, and structured-buffer element layouts;
- validate that the generated ABI matches the manifest predicted from typed wmslang IR;
- embed a compact runtime binding manifest beside the WGSL.

Reflection is not used to:

- infer Workman lambda parameter types;
- decide tuple-to-vector mapping;
- validate calls between Workman functions;
- determine whether a CPU value is legal to capture;
- replace Workman diagnostics.

The Slang playground demonstrates the intended mechanics: link the program, call
`getLayout(0).toJsonObject()`, and interpret reflected parameters and entry points. Workman should
reuse this principle without inheriting the playground's attribute protocol as its language model.

## Compile-time and emitted artifacts

For each reachable shader program, the Workman compiler should eventually retain:

```ts
type ShaderArtifact = {
  id: string;
  target: "wgsl";
  code: string;
  entries: ShaderEntryArtifact[];
  bindings: ShaderBindingArtifact[];
  sourceMap: ShaderSourceMap;
  generatedSlang?: string;
};
```

The JavaScript backend can embed the WGSL and metadata directly. Generated Slang may be retained in
debug artifacts, compiler snapshots, or an opt-in CLI output, but need not ship in production code.

At Workman compile time, a stage constructor is a compiler-known artifact selection operation. It
may appear inside ordinary host code so it can capture current uniform values and resource handles,
but its GPU function, static stage configuration, and ABI must be resolvable during compilation.
The emitter replaces it with construction of an immutable runtime descriptor holding precompiled
WGSL, stable entry names, binding metadata, and the current dynamic binding values. It is not a
callable CPU function and does not contain or interpret source/IR at runtime. `Gpu.wgsl` and similar
accessors are typed projections from that descriptor.

The module graph discovers shader dependencies lazily from selected artifact roots across imported
Workman source modules. The specialization key is the resolved binding ID, normalized GPU type
arguments, and relevant compile-time captures. Each entry root initially produces one independently
cacheable Slang/WGSL artifact; reachable helpers are deduplicated within it. Core contains only an
opaque artifact reference, and each single-file, worker, library, or REPL output embeds the artifact
table entries it actually references—never a runtime shader AST.

Lazy GPU functions cross Workman source-module boundaries only while those modules are present in
the same compiler graph. A standalone emitted JavaScript library may export completed
`ShaderArtifact` descriptors, but it cannot export an unresolved GPU function for a later unrelated
Workman compilation. A future serialized compiler-metadata format could add that capability; it is
not implicit in the JavaScript FFI ABI.

## Diagnostics and tooling

Required diagnostic layers:

1. Directive syntax and placement diagnostics.
2. Workman shader type and capability diagnostics.
3. Capture eligibility diagnostics.
4. Unsupported shader construct diagnostics.
5. Tail-recursion legality diagnostics.
6. Slang backend diagnostics remapped to Workman spans.
7. ABI disagreement diagnostics treated as compiler errors.

LSP expectations:

- `@gpu` is tokenized and structurally represented rather than treated as opaque damage.
- Hover continues to show inferred Workman types, optionally with GPU representation facts.
- Diagnostics identify the original expression and use Workman terminology.
- A future command may show generated Slang or WGSL for the selected GPU function.
- Frontend-v1, frontend-v2, and compare mode agree on directive and lambda structure.

## Hello-world ladder

Each rung must have snapshots for Workman AST, inferred facts, typed wmslang IR, generated Slang,
and final WGSL or Slang reflection as applicable.

### H0: directive and pure shader IR

```workman
let tint = (color) => {
  @gpu;
  color * 0.5
};
```

Acceptance:

- Both frontends attach `@gpu` to the lambda.
- HM inference infers the ordinary function shape.
- GPU analysis records a GPU-capable function.
- A typed shader IR snapshot exists.
- Normal CPU-only compilation remains unchanged for files without directives.

### H1: tuple vectors and generated Slang helper

```workman
let color = (t) => {
  @gpu;
  (0.2 + t, 0.4, 0.8)
};
```

Acceptance:

- The result reifies as `float3` without annotations.
- Generated Slang contains a typed helper function.
- Slang accepts the generated module.
- Generated diagnostics map back to the Workman source.

### H2: direct tail recursion

Use a bounded numeric loop such as a small ray-march or iterative color function.

Acceptance:

- Direct self-tail calls become a loop.
- Argument evaluation uses temporaries and preserves Workman semantics.
- No recursive call remains in generated Slang.
- A non-tail recursive variant receives a focused diagnostic.

### H3: one fragment entry point

Use the smallest general fragment ABI: no stage input and one explicitly constructed color output.

```workman
let solid = () => {
  @gpu;
  Gpu.color((0.2, 0.4, 0.8, 1.0))
};

let fragment = Gpu.fragment(solid);
```

`Gpu.color` constructs the nominal initial fragment-output type; it is not return-shape or field-name
magic. This bootstrap entry does not define a Shadertoy/playground ABI. Typed vertex-to-fragment
interfaces extend the same nominal stage-record model later.

Acceptance:

- Slang links the entry point and emits WGSL.
- The artifact exposes a stable entry-point name.
- Reflection reports fragment stage and the expected color output.
- A minimal JS/WebGPU harness can create the shader module.

### H4: one typed resource

Introduce one read-only buffer or texture with explicit Workman type evidence.

Acceptance:

- The resource type flows from host construction into the GPU lambda.
- Generated Slang uses the correct resource type and access.
- Reflection agrees with Workman's predicted binding manifest.
- Ordinary WebGPU FFI code can bind the underlying resource and dispatch/draw.

### H5: one runtime uniform capture

Capture a host `Number` or numeric tuple from an inline GPU function.

Acceptance:

- The capture becomes a uniform rather than source specialization.
- Slang reflection supplies the final byte offset and size.
- Updating the value does not rebuild the shader program.
- CPU/GPU type disagreement is diagnosed before runtime.

### H6: multiple cooperating GPU functions

Acceptance:

- Reachability follows resolved binding IDs.
- Shared helpers are emitted once per required specialization.
- Cross-module Workman GPU functions work.
- CPU-only calls and illegal captures receive Workman diagnostics.

## Implementation phases

The language ownership below follows `implementation-language.md`: changes to the current host
compiler are TypeScript, frontend-v2 changes are Workman, and the pure wmslang compiler core is an
importable Workman library. Slang WASM and emitted artifact orchestration stay in TypeScript.

### Supporting milestone: persistent std Map

- Add a generic comparator-based persistent `Map<K,V>` implemented in Workman.
- Use an ADT wrapper and height-annotated AVL tree.
- Initially provide `empty`, `singleton`, `get`, `has`, `set`, ordered `fold`, and `toList`.
- Add balanced `remove` and `update` when the first compiler client requires them.
- Export a pure numeric comparator for stable compiler IDs.
- Test persistence, generic inference, comparator ordering, rotations, height invariants, and sorted
  insertion performance.
- Load it under the standard `Map` namespace and keep internal tree constructors undocumented.

Exit criterion: a few thousand sorted numeric inserts remain balanced, old map versions retain
their values, and `Map<K,V>` inference works without annotations introducing type variables.

This milestone does not block Phase 1 directive syntax. Complete it before Phase 2's Workman
constraint solver and specialization registry grow beyond tiny list-backed fixtures.

### Phase 1: syntax and facts

- Add `Directive` to the Workman surface AST.
- Parse lambda directive prologues in frontend-v1.
- Add equivalent structural and semantic representation to frontend-v2.
- Update comparison normalization, DTOs, syntax highlighting, and recovery.
- Record GPU-marked lambdas/bindings in analysis facts.
- Add directive placement and recovery tests.

Exit criterion: H0 parses and checks without changing generated JavaScript behavior elsewhere.

### Phase 2: typed wmslang IR

- Define and validate the versioned `GpuElaborationInput` and `GpuCompilationOutput` DTOs.
- Add the generated Workman wmslang library and TypeScript loader, following the frontend-v2
  build/test pattern.
- Define shader types, values, functions, captures, and source spans.
- Implement shader reification from inferred Workman types.
- Implement generalized GPU constraints, numeric refinement, tuple-vector representation facts,
  and coercion materialization.
- Implement scalar operators, tuple-vector lifting, records, `let`, calls, blocks, and `if`.
- Implement GPU dependency and capability validation.
- Add stable structural snapshots.

Exit criterion: H1 produces a complete typed shader IR and deterministic generated Slang helper.

### Phase 3: Slang backend service

- Bundle a pinned `slang-wasm` toolchain artifact for Deno compiler use; do not require a native
  install, CDN, or network access during compilation.
- Create sessions and load generated source.
- Link selected generated functions/entry points.
- Return target code, diagnostics, layout JSON, and compiler version.
- Add content-addressed cache keys including generated source, target/profile/options, and the
  runtime-reported Slang version.
- Preserve generated Slang for failed compilation diagnostics.
- Reconcile Workman-predicted entry/resource facts with Slang reflection in TypeScript.

Exit criterion: generated H1 Slang is checked in tests without invoking an external native install.

### Phase 4: tail-call lowering

- Share or extract tail-position analysis from the existing direct-self-tail-call implementation.
- Add explicit `TailCall` representation to typed functional wmslang IR.
- Introduce the lowered control-flow IR and normalize the required subset to ANF.
- Lower parameter rebinding through temporaries and a parameterized loop.
- Diagnose non-tail recursion and unsupported mutual recursion.
- Do not add an implicit iteration limit or zero-value fallback.

Exit criterion: H2 passes semantic and generated-code tests.

### Phase 5: functional shader breadth

- Monomorphize GPU helpers from reachable artifact roots and generalized GPU constraints.
- Lower suitable finite Workman ADTs to tagged payload structs.
- Lower exhaustive matches to result joins, branches, and switches.
- Add lambda lifting, closure conversion, and defunctionalization for finite reachable function
  sets.
- Specialize and devirtualize statically known higher-order calls.
- Add GLML-inspired SDF combinator, palette closure, and material ADT fixtures.

The first ADT slice is closed, finite, monomorphized, exhaustively matched, and private to shader
code. Recursive layouts and ABI-crossing ADTs are rejected. Function/resource payloads wait for
the closure slice. The first higher-order slice accepts only a finite reachable set of lambdas with
shader-reifiable captures; it lambda-lifts, closure-converts, defunctionalizes, and rejects escaping
or unknown function sets. Function values do not cross entry/resource/uniform ABIs.

Exit criterion: a shader can use an option-like ADT and a captured higher-order helper while the
generated Slang remains first-order.

### Phase 6: entry points and artifacts

- Implement the compiler-owned typed entry constructors and the minimal nominal stage-record catalog.
- Generate stage wrappers and semantics.
- Link entry points and emit WGSL.
- Add `ShaderArtifact` to the compiler pipeline.
- Embed WGSL and stable entry names into JavaScript output.
- Add a minimal WebGPU integration test where the environment supports it, plus compile-only tests
  everywhere.

Exit criterion: H3 creates a real `GPUShaderModule` from Workman-generated WGSL.

### Phase 7: typed resources and reflection

- Introduce the smallest typed wrappers/evidence for one read-only buffer or texture; add the other
  resource families only when a fixture requires them.
- Classify resource captures.
- Predict a binding manifest from wmslang IR.
- Compare the prediction to Slang layout reflection.
- Embed reflected layout metadata for host binding code.

Exit criterion: H4 binds and uses one resource through otherwise ordinary TS-reflected WebGPU code.

### Phase 8: uniform capture packing

- Reify runtime scalar/vector/record captures into uniform fields.
- Initially generate one deterministic uniform aggregate per entry root, ordered by stable capture
  binding ID; explicit user grouping is deferred until a real layout/API case requires it.
- Use reflected offsets and sizes for packing.
- Add cache behavior that excludes ordinary uniform values.
- Support shared captures and multiple GPU helper functions.

Exit criterion: H5 and H6 pass, including updates without shader recompilation.

### Phase 9: target and effect breadth

- Math intrinsic basis and swizzles.
- Matrices with defined orientation and multiplication.
- Texture sampling and derivatives.
- More pattern forms and larger ADTs.
- Compile-time specialization/unrolling.
- Mutable resource effects, atomics, and workgroup memory.
- Multiple entry points and complete render-pipeline stage IO.
- Optional generated-code inspection in the LSP/editor.

## Testing strategy

- Parser tests for valid, misplaced, duplicated, and damaged directives.
- Frontend-v1/v2 equivalence tests.
- HM inference tests for scalar/vector lifting and cross-domain calls.
- Shader reification unit tests independent of Slang.
- Golden typed-IR and generated-Slang snapshots.
- Tail-call semantic tests covering argument ordering and nested tail positions.
- Slang compile tests through the WASM API.
- Reflection contract tests comparing expected and actual ABI.
- JavaScript emission tests proving WGSL is embedded and no runtime Workman shader source remains.
- WebGPU smoke tests when an adapter is available, with deterministic compile-only coverage otherwise.
- Regression tests showing ordinary Workman programs are unchanged.

The Slang playground demos are useful fixtures for identifying the minimum Slang constructs and
reflection shapes needed for image, compute, printing, and multi-kernel programs. They should be
ported into Workman-facing tests incrementally rather than adopted as the wmslang language design.

## Decision ledger

TypeGPU research closed or narrowed several architectural questions:

- wmslang uses its own typed functional IR, not Tinyest;
- GPU capability initially lives in analysis facts rather than the ordinary `Ty` union;
- captures use resolved Workman binding IDs rather than textual external names;
- entry-point stage is represented by typed host construction, not directive arguments;
- `@gpu` functions are initially GPU-only rather than automatically dual CPU/GPU;
- arbitrary runtime shader-AST interpretation and a TypeGPU-style slot system are deferred;
- Slang is the concrete backend, while the typed IR remains free of raw Slang syntax.

GLML research additionally established:

- shader overloads use deferred GPU constraints associated with generalized function facts;
- homogeneous numeric tuple shape identifies vector candidates, while a representation fact makes
  the final vector/product choice;
- typed functional and lowered control-flow shader IRs are separate;
- suitable finite ADTs and higher-order functions are baseline functional-language goals;
- mutation is introduced only by control-flow lowering;
- recursive exhaustion never silently returns a generated zero value.

The implementation-language audit additionally established:

- the live HM checker, region integration, module graph, and artifacts remain TypeScript-owned;
- the normalized GPU solver and pure shader IR lowerings are implemented as a Workman library;
- Slang source generation is pure Workman code, while `slang-wasm`, reflection reconciliation,
  caching, and embedding remain TypeScript-owned;
- the TypeScript/Workman handoff uses stable numeric identity and versioned JavaScript-native DTOs;
- GLML is ported algorithmically against the wmslang IR rather than translated line for line.
- persistent keyed compiler environments use the comparator-based Workman std Map;
- other compiler utilities remain package-local Workman structures or coarse TypeScript helpers
  imported through normal carrier-oriented FFI until broader reuse is demonstrated.

The architecture-critical questions are now answered:

1. GPU constraints and generalized `GpuScheme` facts are parallel to HM types, are captured in the
   final elaboration DTO, and are solved per reachable specialization after final FFI/HM inference.
2. `@gpu` functions are GPU-only opaque values and become artifact roots only through typed stage
   constructors. Ordinary pure helpers may be proven GPU-eligible without changing host types.
3. Entry stages are compiler-known typed host constructors; nominal `Gpu` stage records carry
   semantic evidence, and `@gpu` has no stage arguments.
4. Common shader math and operators are stable compiler intrinsics opened only by the GPU typing
   dialect. Host constructors/artifact access remain explicitly qualified under `Gpu`.
5. Plain direct tail recursion is semantically unbounded and has no hidden budget or fallback.
6. The initial ADT and higher-order subsets are finite, reachable, monomorphized, private shader
   values lowered to first-order code; recursive/escaping/unknown cases are rejected.
7. Resources cross through nominal typed evidence wrappers, never raw reflected WebGPU handles.
8. Runtime captures initially form one deterministic reflected uniform aggregate per entry root;
   updates change data, not shader code or cache identity.
9. Shader compilation is lazy from artifact roots across the resolved module graph. Each output
   unit embeds only referenced opaque artifacts, and no runtime AST interpreter exists.
10. A pinned bundled `slang-wasm` service is part of the compiler toolchain, and its reported
    version plus all compilation inputs participate in content-addressed cache keys.
11. GPU resource effects and stage restrictions are inferred side facts propagated over the
    resolved call graph; they neither enter host HM types nor permit general mutation.
12. Stage roots are statically selected. Unresolved GPU functions cross source modules in one
    compiler graph, while standalone JavaScript libraries expose only completed artifacts.

The deliberately deferred items are additive API breadth: the full stage-record catalog, complete
resource allocation/update helpers, explicit uniform grouping, matrices, mutual tail recursion,
multi-entry packaging, and additional target capabilities. None changes the initial compiler
ownership, type boundary, IR sequence, or execution semantics.

The next implementation proof remains the cross-language scalar/vector specialization fixture in
`implementation-language.md`, followed by H0 and H1 before any resource runtime work.
