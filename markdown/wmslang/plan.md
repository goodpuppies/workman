# wmslang implementation plan

Status: broad architecture and post-v2 direction. The static fragment slice in
[`v1-scope.md`](./v1-scope.md) and the initial pure-result, numeric-tuple-vector, and diagnostic
attribution work in [`v2-scope.md`](./v2-scope.md) are implemented. V2 now additionally scopes
Workman-owned shader type elaboration, lexically owned local helpers, and one curried nominal-record
CPU environment. Selection, schema normalization, uniform-read IR/lowering, and constant-buffer
Slang emission, artifact values, reflection-checked packing, stable factory/schema identity, and
renderer upload are implemented for that environment. Where this plan proposes more language,
analysis, resource, diagnostic, packaging, or target breadth, that v2 scope takes precedence.

V1 is intentionally not a production-complete visual release. It fixes all shader numbers to `f32`,
permits no captures or uniforms, compiles one same-module monomorphic call graph, and proves
immutability, one option-like ADT, and direct self-tail recursion in a single rendered artifact.
Uniforms, dual numeric representations, generalized specialization, multi-module roots, general
pattern matrices, exact artifact identity, and the full evidence protocol resume only after that
slice works end to end.

The compiler ownership and isolation strategy is specified in
[`compiler-boundary.md`](./compiler-boundary.md). In particular, `@gpu` is an elaboration island: it
reuses Workman's HM machinery through a scoped typing dialect, while shader analysis, IR, Slang
lowering, and artifacts remain a sidecar pipeline.

The comparison with TypeGPU, Tinyest, `typegpu-three`, and `typegpu-gl` is recorded in
[`typegpu-research.md`](./typegpu-research.md). The resulting decision is to build a Workman-owned
typed functional shader IR rather than reuse Tinyest as the canonical representation.

The comparison with the immutable HM shader language GLML is recorded in
[`glml-research.md`](./glml-research.md). It refines the design toward deferred GPU constraints,
reachable monomorphization, finite ADTs and higher-order functions, and two shader IR levels. GLML
remains a semantic and architectural reference, not the v1 feature checklist. In particular,
implicit coercion, higher-order shader values, and optimization are post-v1 work.

The implementation-language and bootstrap boundary is specified in
[`implementation-language.md`](./implementation-language.md). The compiler integration and Slang
service remain in TypeScript, while a generated Workman library owns the closed, pure wmslang
middle-end behind a versioned DTO.

The v1 source and host basis is specified in [`v1-basis.md`](./v1-basis.md). It contains only the
fragment/color boundary and three artifact accessors; math intrinsics are post-v1.

The minimal backend proof is specified by [`v1-scope.md`](./v1-scope.md) and
[`v1-acceptance.md`](./v1-acceptance.md). [`v1-backend.md`](./v1-backend.md) retains the broader
production packaging, reflection, manifest, and release design for later slices.

The executable specification in [`v1-acceptance.md`](./v1-acceptance.md) contains one flat-color
smoke shader, one combined static Mandelbrot release shader, and focused non-tail/capture/isolation
safeguards.

The expanded semantic implementation design remains in
[`v1-functional-lowering.md`](./v1-functional-lowering.md). V1 takes only its immutable joins,
restricted option-like tag switch, evaluation order, and direct-tail-call loop rewrite.

The closed v1 expression vocabulary in [`v1-operations.md`](./v1-operations.md) is scalar `f32` and
`Bool` only.

The restricted curried uniform ABI in [`v1-uniform.md`](./v1-uniform.md) is implemented. Its older
explicit-descriptor sections remain historical research for broader resource slices.

The dual-representation solver in [`v1-numerics.md`](./v1-numerics.md) is deferred. V1 directly maps
all reachable `Number` occurrences to `f32` and needs no numeric fixed point.

The expanded closure design in [`v1-captures.md`](./v1-captures.md) is deferred. V1 permits direct
same-module helpers and rejects every captured value.

The entry design in [`v1-entry.md`](./v1-entry.md) supplies raw coordinates, nominal color, and
host-runtime isolation. V1 requires only one inline or directly bound selection.

The production diagnostic and artifact protocol in [`v1-diagnostics.md`](./v1-diagnostics.md) is
deferred. V1 uses focused codes/spans and retains generated backend output without freezing the
complete protocol.

The ordered implementation handoff and H0 incompatibility audit are in
[`v1-readiness.md`](./v1-readiness.md).

The evolving post-v1 slice is specified in [`v2-scope.md`](./v2-scope.md). Its implemented portion
makes fragment color an ordinary pure four-tuple result, carries homogeneous numeric tuple vectors
through the production IR, adds scalar/vector broadcast, and owns related-span/backend attribution.
The lexical-helper portion now restricts shader helpers to first-order local functions inside the
selected GPU island and rejects other module-level helpers and cross-function value capture. The
semantic type-table boundary now leaves `number`/tuple rows unchanged in TypeScript and has Workman
produce validated concrete `f32`/vector/product rows with evidence. A separate pure Workman entry
returns stable expression/pattern/function occurrence types for LSP hover without lowering or Slang;
failed GPU analysis is shown as unresolved rather than a CPU fallback. Richer constraint-edge
evidence remains. One curried host shader factory now turns its nominal-record parameter into a
reflected uniform block end to end: applying the factory constructs a fresh immutable bound
fragment, generated host code copies its fields into the reflected byte layout, and the renderer
uploads those bytes while reusing one shader module and pipeline. The executable SDL2
mouse-to-Mandelbrot data flow is specified in [`v2-sdl-mandelbrot.md`](./v2-sdl-mandelbrot.md).
The requirement-by-requirement completion gate is recorded in
[`v2-acceptance.md`](./v2-acceptance.md).

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
shader IR is lowered to generated Slang. Slang validates and compiles that generated program to WGSL
or another target. The emitted JavaScript uses the resulting WGSL with normal WebGPU APIs.

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
      setupPipeline(
        device,
        module,
        Gpu.vertexEntryPoint(fragment),
        Gpu.fragmentEntryPoint(fragment)
      )
    })
};
```

`Gpu.wgsl` and the entry-point accessors above inspect a completed compile-time shader artifact;
they do not imply that source-to-source compilation happens at runtime.

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
- The existing Slang playground is a reference implementation and potential development harness, not
  the semantic definition of wmslang or a required production runtime.

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
- Implicit numeric promotion or narrowing; v1 conversions are explicit compiler intrinsics.
- Higher-order shader values, closure conversion, or optimization.
- Automatic uniform capture and packing.
- Compute and general user-authored vertex stages; v1 proves one fullscreen fragment artifact first.

## Compilation model

```text
Workman source
  -> surface AST, including lambda directive prologues
  -> normal name resolution plus shader-aware HM inference
  -> GPU capability and capture analysis
  -> typed functional wmslang IR
  -> reachable specialization and finite ADT lowering
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
- Directives are owned by frontend-v1 and must be preserved in its surface AST, formatting, and
  diagnostics. Frontend-v2 support is not part of the wmslang plan.
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

Function execution capability is an analysis fact, not part of the ordinary HM `Ty` union and not a
user-written effect annotation. Facts are keyed by resolved binding/lambda identity and, after
specialization, by specialization identity.

The initial capabilities are:

```text
CPU-only
GPU-only declared function
GPU-local inherited function
```

An `@gpu;` lambda is a GPU-only declared function and is not emitted as an ordinary CPU-callable
closure. Host Workman may name it and pass it through compiler-resolved immutable bindings as an
opaque `GpuFn`, but it cannot escape through arbitrary FFI or dynamic host data. It becomes an
artifact root only when a typed stage constructor selects it. A function declared lexically inside
that GPU body inherits GPU-only ownership and may be a first-order local helper. An ordinary
top-level Workman helper remains CPU-only; it is not reinterpreted merely because a shader root
calls it. A future explicitly dual declaration may add both capabilities, but that cannot be an
inferred property of an otherwise ordinary function body.

Required behavior regardless of representation:

- A GPU lambda may call a first-order function owned by the same lexical GPU island.
- A GPU lambda may not call a CPU-only or arbitrary JS FFI function.
- Host code may carry a GPU function only as a statically tracked opaque `GpuFn` for stage
  selection.
- Entry-point constructors accept only GPU-capable functions.
- GPU dependency discovery follows resolved binding identity, not source spelling.

Illegal cross-domain calls are diagnosed during final shader semantic analysis, before functional IR
construction and code generation.

## GPU effects and stage capabilities

Shader effects are also parallel analysis facts rather than additions to ordinary HM function types.
The closed fact vocabulary distinguishes pure computation, environment/resource reads, resource
writes, and stage-restricted operations. The first resource slice implements reads from the single
curried uniform environment; later resource slices and intrinsics enable general resource reads,
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

| Workman type/shape                     | Initial Slang representation                        | Notes                                                    |
| -------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| `Bool`                                 | `bool`                                              | Value and control-flow type.                             |
| `Number` from a floating context       | `float`                                             | Defaults to 32-bit for the first target.                 |
| integer required by a GPU builtin      | `int` or `uint`                                     | Context fixes signedness before typed IR.                |
| `Void`                                 | `void`                                              | Entry points and effectful operations.                   |
| `(Number, Number)`                     | `float2`                                            | Homogeneous numeric tuple reification.                   |
| `(Number, Number, Number)`             | `float3`                                            | Primary creative-coding vector syntax.                   |
| `(Number, Number, Number, Number)`     | `float4`                                            | Color and position syntax.                               |
| homogeneous integer tuple of arity 2-4 | corresponding integer vector                        | Context decides signedness.                              |
| nominal Workman record                 | generated Slang `struct`                            | All fields must be reifiable.                            |
| structural record                      | generated private Slang `struct`                    | Stable field order and identity are required.            |
| function                               | specialized direct call or defunctionalized closure | First-order H1; finite higher-order closure sets follow. |
| `String`                               | unsupported runtime shader value                    | Compile-time diagnostic text may be handled separately.  |
| `List<T>`                              | unsupported runtime value initially                 | Later compile-time unrolling is separate from storage.   |
| finite monomorphized ADT               | generated tag plus payload struct                   | Initially private shader values; ABI use is deferred.    |

Important distinctions:

- Ordinary CPU tuples keep their existing JavaScript representation.
- Vector reification happens only inside a GPU function or GPU ABI.
- `f(x, y, z)` remains a multi-argument call; `f((x, y, z))` passes one vector-shaped value.
- Heterogeneous and non-vector tuples become generated private product structs when every element is
  shader-reifiable. They are rejected at entry, resource, and uniform ABI boundaries initially.
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

The vertical v1 slice maps both `Int` and `Float` Workman syntax directly to shader `f32`; it does
not run this representation solver. The dual `i32`/`f32` conflict/default algorithm in
[`v1-numerics.md`](./v1-numerics.md), user-visible `u32`, contextual literal representation, and any
coercion system require later explicit language slices.

Homogeneous numeric tuples of width 2-4 are vector candidates and default to vectors in GPU code. A
persistent representation fact records that choice so later lowering never re-derives it from shape.
Product representation is reserved for heterogeneous, nested, or explicitly product-typed values;
matrices remain deferred until their orientation and multiplication semantics are defined.

## Expression mapping

Initial mappings:

| Workman construct     | Typed wmslang IR               | Generated Slang                                     |
| --------------------- | ------------------------------ | --------------------------------------------------- |
| literal               | typed literal                  | scalar literal                                      |
| variable              | resolved local/capture         | local/global/generated parameter                    |
| tuple expression      | vector or product construction | `floatN(...)` or generated product                  |
| record expression     | typed struct construction      | generated struct constructor/initializer            |
| immutable `let`       | `Let`                          | Slang `let`                                         |
| function call         | resolved GPU call              | specialized Slang call                              |
| arithmetic/comparison | typed operator                 | native Slang operator/intrinsic                     |
| `if` expression       | typed branch expression        | return branches or generated temporary/control flow |
| block result          | expression result              | final expression becomes `return` where required    |
| direct tail call      | typed functional `TailCall`    | lowered parameter update plus loop `continue`       |
| pipe                  | elaborated call                | ordinary specialized call                           |

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

## Lexical captures and future closure conversion

Every free resolved binding used by an `@gpu;` lambda is classified before Slang generation.

| Capture category                                  | Intended lowering                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| GPU-capable function                              | dependency edge and specialized/lifted Slang function                 |
| closed literal scalar/vector constant             | clone the literal tree into the using specialization                  |
| immediately enclosing shader-factory environment | one typed uniform block                                                |
| other runtime scalar/vector/record                | rejected; no automatic capture                                        |
| typed read-only GPU resource                      | reflected resource binding                                            |
| typed writable GPU resource                       | reflected writable binding plus GPU effect permission                 |
| sampler/texture handle with Workman type evidence | corresponding Slang resource                                          |
| arbitrary JS object or CPU-only function          | compile-time error                                                    |
| opaque raw `GPUBuffer` without element evidence   | compile-time error or explicit typed wrapping                         |

Captures should be keyed by semantic binding ID. Generated names are an implementation detail.

V1 rejects all captured values. The first resource slice uses the restricted curried
shader-environment boundary in [`v1-uniform.md`](./v1-uniform.md): one host nominal-record parameter,
one returned `@gpu` lambda, and no other dynamic capture. It still avoids executing Workman or
JavaScript to discover specialization values.

Static shader type information is sufficient to generate WGSL ahead of runtime even when the actual
GPU resource objects are created later. Runtime scalar captures should become uniform fields rather
than forcing runtime source generation. Pipeline/source caching therefore keys on shader IR, types,
entry-point configuration, and static specialization values—not on ordinary uniform values.

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
that evidence in the predicted manifest. Uniforms and these general resource wrappers begin after
the static v1 slice; allocation, update, and full WebGPU convenience APIs remain intentionally
outside wmslang.

## Entry points

`@gpu;` marks execution eligibility; it does not encode a shader stage. Stage wrappers are
compiler-known, typed host-level constructors, so stage configuration participates in inference:

```workman
let fragment = Gpu.fragment(shade);
let compute = Gpu.compute(workgroupSize, kernel);
```

`Gpu.fragment`, `Gpu.vertex`, and `Gpu.compute` eventually have typed surface declarations but are
recognized by stable intrinsic IDs and never execute as normal JavaScript calls. They accept an
opaque GPU function plus typed stage configuration and produce an opaque `ShaderArtifact` host
value. Entry lambdas use nominal records from the compiler-owned `Gpu` basis for stage inputs,
outputs, builtins, and interpolation evidence. There is no field-name magic. The v1 catalog is one
fullscreen case: a fragment function receives raw `f32` fragment coordinates and returns the nominal
color output constructed by `Gpu.color`. Normalization and aspect correction use explicit resolution
input in ordinary shader code. The artifact also contains a compiler-generated fullscreen-triangle
vertex wrapper. Its exact simpler signature is the one in [`v1-basis.md`](./v1-basis.md); later
stage records extend this model rather than overload ordinary tuple shape or field spelling with
stage semantics.

Stage construction is statically resolved. H3 accepts a direct GPU-function binding; later finite
function selection may use the same closed-world defunctionalization as higher-order shader code. An
arbitrary runtime choice of function cannot become an entry point because there is no runtime shader
compiler or AST interpreter.

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

The general shape above is post-v1 extensibility. V1 needs only WGSL plus the two fixed entry names
defined in [`v1-scope.md`](./v1-scope.md); draw setup remains in the focused host harness. The
richer descriptor is retained in [`v1-backend.md`](./v1-backend.md) for later work.

The JavaScript backend can embed the WGSL and metadata directly. Generated Slang may be retained in
debug artifacts, compiler snapshots, or an opt-in CLI output, but need not ship in production code.

At Workman compile time, a stage constructor is a compiler-known artifact selection operation. It
may appear inside ordinary host code so it can capture current uniform values and resource handles,
but its GPU function, static stage configuration, and ABI must be resolvable during compilation. The
emitter replaces it with construction of an immutable runtime descriptor holding precompiled WGSL,
stable entry names, binding metadata, and the current dynamic binding values. It is not a callable
CPU function and does not contain or interpret source/IR at runtime. `Gpu.wgsl` and similar
accessors are typed projections from that descriptor.

The module graph discovers shader dependencies lazily from selected artifact roots across imported
Workman source modules. The specialization key is the resolved binding ID, normalized GPU type
arguments, and relevant compile-time captures. Each entry root initially produces one independently
cacheable Slang/WGSL artifact; reachable helpers are deduplicated within it. Core contains only an
opaque artifact reference supplied after shader/backend materialization, and each single-file,
worker, library, or REPL output embeds the artifact table entries it actually references—never a
runtime shader AST.

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
- Host hover shows inferred Workman types. Inside a lexically owned GPU island, hover shows the
  concrete wmslang type produced by pure shader elaboration; the host HM shape is only recovery
  information, not a second displayed instantiation.
- Live shader checking runs the Workman elaborator but never Slang, WGSL generation, or WebGPU.
- Failed shader elaboration remains visible as an LSP diagnostic and cannot silently degrade to a
  successful CPU-only hover.
- Diagnostics identify the original expression and use Workman terminology.
- A future command may show generated Slang or WGSL for the selected GPU function.
- Frontend-v1 preserves directive and lambda structure through the host compiler boundary.
- Frontend-v2 and frontend compare mode are not wmslang targets or future milestones. Supporting
  them would require a separate decision after frontend-v2 matures.

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

- Frontend-v1 attaches `@gpu` to the lambda.
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

### H3: one fullscreen fragment entry point

Use the smallest useful visual ABI: raw fragment-coordinate input and one explicitly constructed
color output. The compiler supplies the fixed fullscreen vertex stage.

```workman
let shade = (coord) => {
  @gpu;
  let (x, y) = coord;
  Gpu.color((x / 256.0, y / 256.0, 0.8, 1.0))
};

let fragment = Gpu.fragment(shade);
```

`Gpu.color` constructs the nominal initial fragment-output type; it is not return-shape or
field-name magic. The stage constructor fixes the sole shader parameter to a fragment-coordinate
vector; normalization is visible source code. Typed user-authored vertex-to-fragment interfaces
extend the same stage-record model later.

Acceptance:

- Slang links the entry point and emits WGSL.
- The artifact exposes a stable entry-point name.
- Reflection reports the generated vertex entry, fragment entry, and expected color output.
- A minimal JS/WebGPU harness can draw the fullscreen triangle and verify rendered pixels.

### H4: finite ADT and immutable match

Have a reachable helper construct an option-like finite ADT and match its immutable result into a
color.

Acceptance:

- Constructor and pattern identity follows resolved Workman declaration IDs.
- The typed functional IR retains the exhaustive expression-valued match.
- Lowered control-flow IR uses deterministic private tag and payload storage.
- Generated Slang remains first-order and Slang accepts the result without requiring tag
  optimization.

### H5: post-v1 curried runtime uniform block

Provide one nominal record containing runtime `f32` scalar/vector values such as time and
resolution. Pass it to a host shader factory whose result is the selected `@gpu` fragment lambda.

Acceptance:

- The explicit record becomes one uniform block rather than source specialization.
- Slang reflection supplies final field offsets and aggregate size.
- Updating the value does not rebuild the shader program.
- CPU/GPU type disagreement is diagnosed before runtime.
- Capturing an ordinary host number outside the immediately enclosing environment parameter remains
  rejected.

### H6: multiple cooperating GPU functions

Acceptance:

- Reachability follows resolved binding IDs.
- Shared helpers are emitted once per required specialization.
- Cross-module Workman GPU functions work.
- CPU-only calls and illegal captures receive Workman diagnostics.

## Implementation phases

The language ownership below follows `implementation-language.md`: changes to the current host
compiler are TypeScript, and the pure wmslang compiler core is an importable Workman library. Slang
WASM and emitted artifact orchestration stay in TypeScript. Frontend-v2 support is not part of this
plan and is not deferred to a later phase.

### Supporting milestone: persistent std Map

Status: implemented.

- Add a generic comparator-based persistent `Map<K,V>` implemented in Workman.
- Use an ADT wrapper and height-annotated AVL tree.
- Initially provide `empty`, `singleton`, `get`, `has`, `set`, ordered `fold`, and `toList`.
- Add balanced `remove` and `update` when the first compiler client requires them.
- Export a pure numeric comparator for stable compiler IDs.
- Test persistence, generic inference, comparator ordering, rotations, height invariants, and sorted
  insertion performance.
- Load it under the standard `Map` namespace and keep internal tree constructors undocumented.

Exit criterion: a few thousand sorted numeric inserts remain balanced, old map versions retain their
values, and `Map<K,V>` inference works without annotations introducing type variables.

This milestone does not block Phase 1 directive syntax. Complete it before Phase 2's Workman
constraint solver and specialization registry grow beyond tiny list-backed fixtures.

### Phase 1: syntax and facts

- Add `Directive` to the Workman surface AST.
- Parse lambda directive prologues in frontend-v1.
- Add frontend-v1 placement, spelling, duplicate, and damaged-directive diagnostics.
- Record GPU-marked lambdas/bindings in analysis facts.
- Add parser and ordinary-compilation regression tests.

Exit criterion: H0 parses and checks without changing generated JavaScript behavior elsewhere.

### Phase 2: typed wmslang IR

Status: in progress. Schema-v1 input/output DTOs, the generated Workman library bootstrap, the
validating TypeScript loader, final-inference H0 normalization, stable
source/binding/type/expression tables, the initial deterministic function registry, and
scalar/vector `i32`/`f32` fixed-point refinement are implemented. GPU-rooted, resolved-ID call-graph
reachability now crosses module boundaries, classifies candidate helpers, and scopes capability
diagnostics to reachable expression trees. Per-root capture closure now classifies compiler-known
constants, dynamic scalar/vector uniforms, reachable functions, and illegal CPU/non-reifiable values
while excluding lexical locals; the resource category awaits nominal wrapper evidence. Explicit
user-requested conversion nodes remain part of this phase; user-visible `u32`, implicit coercions,
and the broader promotion vocabulary are post-v1. Numeric representation facts now use
binding/expression occurrence IDs and propagate through resolved calls, preventing unrelated GPU
roots from sharing evidence merely because both host types prune to `Number`; generalized helper
specializations now give a fixed-shape helper distinct `i32`/`f32` instances, deduplicate equal
instances across roots, preserve direct recursion through register-before-descend, reject mutual
recursion, and record call-expression-to-specialization edges. Concrete representation facts live on
each specialization; the shared type table is only their consensus. Full `GpuScheme` instantiation
across HM-polymorphic shapes and compile-time capture values remains part of this phase. Every
specialization now owns a typed functional IR clone with concrete representation overlays, resolved
call targets, value-origin classification, stable child IDs, and Workman source provenance. The
graph preserves blocks, immutable `let` declarations, tuples/vectors, calls, operators, and
expression-valued branches without introducing backend mutation. Explicit conversion/intrinsic
nodes, supported record/product reification, and pattern/ADT cases remain. Implicit coercion
materialization is no longer a Phase 2 or v1 requirement.

The implemented schema-v1 merge still treats mixed evidence as `f32` dominance, but that behavior is
now confined to H0 fixture APIs. Production program analysis uses the schema-v2 vertical slice: one
semantic `Gpu.fragment` selection and one lexical GPU island. Its DTO now carries semantic
`number`/tuple shapes; the Workman slice elaborator owns the concrete `f32`/vector/product table and
evidence consumed by lowering and emission.
Uniform/capture inference, numeric coercion, and ordered multi-selector machinery are deferred under
[`v1-scope.md`](./v1-scope.md), not prerequisites for the visual slice.

Target-neutral prerequisites preserve complete resolved patterns, authored recursion-group
membership and reference kinds, and the closed visual operator catalog. Schema v2 now transports the
restricted projection needed by the selected program.

- Define and validate the versioned selected-program schema-v2 input/output DTOs. (Done.)
- Transport shared constructor/declaration facts together with restricted patterns, ADT shapes, and
  recursive-group identity; do not guess them from schema-v1 strings. (Done for the v1 slice.)
- Add the generated Workman wmslang entry and dedicated TypeScript loader without coupling wmslang
  to frontend-v2. (Done; focused ABI roundtrip covered.)
- Define shader types, values, functions, captures, and source spans.
- Implement shader reification from inferred Workman types.
- Implement the v1 strict numeric contract, explicit conversions, and tuple-vector representation
  facts. Keep `u32` internal to the generated vertex ABI and defer user-visible unsigned numbers.
- Implement scalar operators, tuple-vector lifting, records, `let`, calls, blocks, and `if`.
- Implement GPU dependency and capability validation.
- Add stable structural snapshots.

Exit criterion: H1 produces a complete typed shader IR and deterministic generated Slang helper.

### Phase 3: Slang backend service

- Load the pinned official `slang-wasm` release without requiring a native install. The current
  backend downloads its integrity-checked release archive once into Deno's persistent Cache Storage;
  later compiler processes work from that cache without network access.
- Record the upstream commit/build recipe and hashes for all bundled assets, and verify
  `getVersionString()` plus WGSL target availability at startup. The research checkouts do not
  currently contain the required WASM artifacts.
- Create sessions and load generated source.
- Explicitly check vertex and fragment entries with their Slang stage constants, link them in stable
  order, and retrieve one whole-program WGSL module.
- Return target code, diagnostics, layout JSON, and compiler version.
- Add content-addressed cache keys including generated source, target/profile/options, and the
  runtime-reported Slang version.
- Preserve generated Slang for failed compilation diagnostics.
- Reconcile Workman-predicted entry/resource facts with Slang reflection in TypeScript.

Exit criterion: a compiler-owned vertex/fragment smoke module and generated H1 declarations are
checked in focused tests without invoking an external native install.

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
- For v1, lower the one restricted option-like ADT directly to declaration-order tags and one
  optional scalar payload. The general layout and pattern-matrix design in
  [`v1-functional-lowering.md`](./v1-functional-lowering.md) is later breadth.
- Keep v1 first-order. Lambda lifting, closure conversion, defunctionalization, and higher-order
  shader fixtures are post-v1 breadth.

The first ADT slice is closed, finite, monomorphized, exhaustively matched, and private to shader
code. Recursive layouts and ABI-crossing ADTs are rejected. Function/resource payloads and all
higher-order shader values wait until after v1. Function values do not cross entry/resource/uniform
ABIs.

Exit criterion for v1: a shader can use an option-like ADT and exhaustive match while generated
Slang remains first-order. Higher-order helpers have a separate post-v1 exit criterion.

### Phase 6: entry points and artifacts

- Implement `Gpu.fragment` and the minimal v1 artifact containing WGSL plus fixed entry names.
- Generate the fixed `SV_VertexID` fullscreen-triangle vertex wrapper and raw-`SV_Position` fragment
  wrapper from [`v1-backend.md`](./v1-backend.md).
- Link entry points and emit WGSL.
- Add `ShaderArtifact` to the compiler pipeline.
- Embed WGSL and stable entry names into JavaScript output.
- Add a minimal WebGPU integration test where the environment supports it, plus compile-only tests
  everywhere.

Exit criterion: H3 creates one real `GPUShaderModule`, a no-vertex-buffer render pipeline, and a
correct offscreen coordinate image from Workman-generated WGSL.

### Phase 7: post-v1 curried uniform and reflection

- [x] Recognize one restricted, directly resolved host shader factory returning exactly one inner
  `@gpu` lambda; keep the outer lambda host-owned.
- [x] Reify its annotated, same-module, non-generic nominal-record parameter as an ordered shader
  environment schema and reject all other captures.
- [x] Normalize resolved record-field uses as typed uniform reads while keeping the current outer
  argument out of the GPU expression graph.
- [x] Preserve those reads through Workman-owned type elaboration, functional IR, lowering, and
  deterministic group-zero/binding-zero Slang emission.
- [x] Teach the host artifact/materializer to retain stable shader/schema metadata and lower the
  current ordinary record to fresh immutable bytes. Reapplying the factory creates a new binding
  without compiling a shader or retaining a foreign record reference.
- [x] Predict field shapes, compare them to Slang reflection, and embed authoritative offsets,
  aggregate byte length, binding identity, and zero-padding requirements in the artifact manifest.
- [x] Generate the closed host packer for `Number` and homogeneous numeric tuple fields. It must
  zero-initialize the complete reflected range and reject missing, reordered, or wrong-schema data.
- [x] Extend fragment renderer creation to allocate the uniform buffer and bind group once, then make
  each render validate artifact/schema identity, obtain the submitted immutable bytes, call
  `queue.writeBuffer`, and draw with the existing module/pipeline.
- [x] Turn the SDL2 mouse-driven Mandelbrot design into a real example: CPU tail-recursive event
  draining updates immutable center/time/resolution state; GPU-local tail recursion handles escape
  iteration. Verify two distinct frames without pipeline recreation.
- [x] Accept chained `uniforms.resolution.y` during GPU pretyping and preserve it as a uniform read
  followed by a lane projection in normalized IR.

Exit criterion: the animated-uniform visual acceptance shader updates through ordinary WebGPU host
code without rebuilding its shader module or pipeline.

### Phase 8: further resource and capture breadth

- Introduce typed read-only buffers or textures when a post-v1 fixture requires them.
- Support shared resource captures and multiple resource groups.
- Automatic scalar/vector/record captures may be packed into a deterministic aggregate ordered by
  stable capture binding ID.

Exit criterion: a separately scoped resource fixture passes without weakening the explicit uniform
environment contract introduced in Phase 7.

### Phase 9: target and effect breadth

- Additional math intrinsic breadth and swizzles beyond the small visual v1 basis.
- Matrices with defined orientation and multiplication.
- Texture sampling and derivatives.
- More pattern forms and larger ADTs.
- Compile-time specialization/unrolling.
- Mutable resource effects, atomics, and workgroup memory.
- Multiple entry points and complete render-pipeline stage IO.
- Optional generated-code inspection in the LSP/editor.

## Testing strategy

- Parser tests for valid, misplaced, duplicated, and damaged directives.
- Frontend-v1 directive and ordinary-compilation isolation tests.
- HM inference tests for scalar/vector lifting and cross-domain calls.
- Shader reification unit tests independent of Slang.
- Golden typed-IR and generated-Slang snapshots.
- Tail-call semantic tests covering argument ordering and nested tail positions.
- Slang compile tests through the WASM API.
- Reflection contract tests comparing expected and actual ABI.
- JavaScript emission tests proving WGSL is embedded and no runtime Workman shader source remains.
- WebGPU smoke tests in developer environments, plus a mandatory supported release environment that
  renders the offscreen visual suite; a release cannot pass with every adapter test skipped.
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

The broad architecture questions are now answered. These describe the intended system beyond v1; the
explicit v1 exceptions below keep the first implementation a vertical slice:

1. GPU constraints and generalized `GpuScheme` facts remain parallel to HM types in the broad
   design. V1 skips generalized numeric solving and fixes every reachable `Number` to `f32`.
2. `@gpu` functions are GPU-only opaque values and become artifact roots only through typed stage
   constructors. First-order local helpers inherit the lexical GPU domain; ordinary top-level
   helpers remain CPU-only unless a future explicit dual-domain feature says otherwise.
3. Entry stages are compiler-known typed host constructors; nominal `Gpu` stage records carry
   semantic evidence, and `@gpu` has no stage arguments.
4. Common shader math and operators are stable compiler intrinsics opened only by the GPU typing
   dialect. Host constructors/artifact access remain explicitly qualified under `Gpu`.
5. Plain direct tail recursion is semantically unbounded and has no hidden budget or fallback.
6. The v1 ADT subset is one finite, non-generic option-like private shape. General monomorphized ADT
   layouts and higher-order shader values are post-v1.
7. Resources cross through nominal typed evidence wrappers, never raw reflected WebGPU handles.
8. V1 has no dynamic shader input. One explicit typed uniform block is the next resource slice;
   its nominal-record packer is compiler generated, while automatic capture and general resource
   packing remain later work.
9. V1 compiles one same-module artifact root and embeds only its opaque completed artifact, with no
   runtime AST interpreter. Multi-root and cross-module closure are later breadth.
10. V1 requires a working compile-time Slang-to-WGSL path. Pinned distribution packaging and
    content-addressed toolchain/cache identity are production hardening after the slice.
11. GPU resource effects and stage restrictions are inferred side facts propagated over the resolved
    call graph; they neither enter host HM types nor permit general mutation.
12. Stage roots are statically selected. The implemented v1 accepted one inline or directly bound
    root plus same-module helpers; v2 replaces the helper rule with non-escaping local functions in
    the root's lexical GPU island. Cross-module shader graphs come later only with an explicit domain
    model.

The deliberately deferred items are additive API breadth: implicit promotion, higher-order shader
values, optimization, automatic uniform capture, compute and general vertex stages, the full
stage-record catalog, storage/texture resource helpers, matrices, mutual tail recursion, multi-entry
packaging, and additional target capabilities. None changes the initial compiler ownership, type
boundary, IR sequence, or execution semantics.

The v1 release gates in [`v1-scope.md`](./v1-scope.md) and fixtures in
[`v1-acceptance.md`](./v1-acceptance.md) are implemented. Continue with the ordered ergonomic gates
in [`v2-scope.md`](./v2-scope.md) before beginning explicit uniforms or broader GLML-style coercion,
specialization, and optimization work.
