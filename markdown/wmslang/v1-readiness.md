# wmslang v1 vertical-slice readiness

Status: authoritative implementation checklist for [`v1-scope.md`](./v1-scope.md).

## Scope rule

V1 is complete when one static Workman fragment using immutability, a finite option-like ADT, and
direct self-tail recursion renders through the real compiler/backend/host path. It is not gated on
uniforms, generalized numeric solving, polymorphic specialization, production cache identity,
complete diagnostic evidence, or multi-module shader closure.

Supporting documents written for the former expanded visual release are design references only where
they exceed [`v1-scope.md`](./v1-scope.md).

## Reusable foundation already present

- frontend-v1 parses `@gpu;` lambda metadata;
- host FFI traversal treats marked bodies as opaque;
- compiler-basis GPU operations carry semantic IDs;
- shared binding and nominal facts prevent Core and shader analysis from resolving the same source
  independently;
- resolved pattern facts cover Workman's different let, parameter, and match contexts;
- authored recursion groups and self/mutual/external reference kinds are recorded;
- `Gpu.fragment` selection resolves inline and directly bound marked lambdas;
- the generated Workman wmslang library and validating TypeScript loader already prove the
  TypeScript-to-Workman boundary;
- H0 reachability, numeric propagation, specialization, and immutable IR tests may be reused when
  they simplify the slice, but their broader behavior is not a v1 requirement;
- Core already accepts completed shader artifacts, lowers selected calls to opaque references, and
  fails closed instead of emitting a raw GPU body.

The shared nominal, pattern, and recursion facts remain important because the slice genuinely uses
an ADT, `match`, and recursion. Draft explicit-uniform and multi-module logical-root facts are not
needed for v1 and should be parked rather than expanded.

## Implemented schema cut

Schema v1 was too shallow for the semantic slice. The production `ProgramAnalysis.gpuInput` now uses
schema v2 and carries only what the selected program requires:

- one selected root and its direct same-module helper closure;
- shared binding/type/constructor identities;
- one non-recursive ADT declaration with nullary or one-`Number` constructors;
- direct constructor expressions and restricted constructor match arms;
- `PVar`, wildcard, and flat tuple parameter/let patterns;
- authored single-member recursion identity and direct call targets;
- closed scalar operator semantic IDs;
- immutable blocks, lets, calls, tuples, `if`, `match`, and source spans.

All numeric rows normalize directly to shader `f32`. Do not port schema-v1's `f32`-wins merge or the
expanded four-state `i32`/`f32` solver into this slice.

The DTO, Workman mirror, loader, and generated library now change together. The v2 loader validates
every transported reference, but it does not include logical multi-module rows, ordered selector
occurrence tables, uniform rows, diagnostic evidence rows, or representation overlays.

## Ordered slices

### S1: selected program DTO

Status: implemented and covered by focused TypeScript validation plus a real generated-Workman ABI
roundtrip. Schema v1 remains reachable only through explicitly named H0 fixture APIs.

- normalize exactly one inline/directly-bound fragment root;
- close direct same-module helper calls;
- reject all other captures and function-value uses;
- transport the restricted declarations, patterns, expressions, spans, and semantic IDs;
- validate the complete small DTO in TypeScript and Workman.

Exit evidence:

- the flat-color fixture round-trips through schema v2;
- the Mandelbrot fixture contains its exact helper, ADT, constructors, match arms, and recursion
  group;
- malformed IDs and excluded cross-module/function-value forms fail validation or capability
  checking;
- an unselected marked lambda is absent.

### S2: typed functional IR

Status: implemented for the frozen slice. The generated Workman pass builds one typed IR function
per selected source function, folds blocks into immutable `let`/`sequence` nodes, preserves resolved
match patterns and arm order, marks direct self-calls in propagated tail position, and diagnoses
non-tail self-calls or incomplete constructor coverage. The TypeScript loader validates all IR
references and the closed node vocabulary.

- map every reachable `Number` occurrence directly to `f32`;
- build closed typed nodes for the accepted expression forms;
- preserve immutable bindings and left-to-right evaluation;
- represent constructor creation and restricted exhaustive matches;
- mark direct self-tail calls and reject non-tail/mutual recursion.

Exit evidence:

- the combined fixture has one monomorphic instance per source helper;
- no numeric constraint/default/specialization state is required;
- the ADT has deterministic declaration-order tags;
- recursive calls appear as explicit tail calls in functional IR;
- excluded records, nested patterns, captures, and higher-order uses fail before emission.

### S3: minimal lowering and Slang

Status: implemented through validated whole-program WGSL. The closed structured lowering is
implemented and validated. Workman derives one deterministic private ADT layout from the complete
constructor table, assigns a distinct payload field to each payload-carrying constructor in
declaration order, and transports the source type, constructor, tag, payload type, and span
identities. It then lowers expressions to function-local locals, atoms, operations, ordered blocks,
branches, switches, loops, and returns.

The Mandelbrot ABI test now proves that value matches use a typed join, cases retain
declaration-order tags, payload access names the payload constructor's distinct private field, and
constructor values name the same layout. It also proves that the recursive helper contains one loop
and no recursive call operation, and that all five next arguments are materialized left-to-right
into immutable `tail-next` locals before one simultaneous `continue`. The TypeScript loader rejects
dangling or cross-function lowered references, illicit mutable locals, incompatible joins, malformed
ADT identity, and incompatible tail-update vectors.

Deterministic Slang text emission is also implemented for exactly this validated vocabulary. Scalar
operations, private tuple and ADT structs, constructor helpers, ordered branches and switches, tail
loops, and fixed raster wrappers are emitted by Workman. The flat-color module has an exact golden;
the Mandelbrot test asserts its private payload access, loop, lack of a recursive self-call, fixed
entry annotations, and absence of resource declarations. Failed semantic programs carry an empty
Slang source so `non_tail_recursion.wm` cannot accidentally reach the backend. The bundled Slang
2026.13.1 WASM runtime parses the generated module, checks both fixed entries with their explicit
stages, links one composite, emits whole-program WGSL, and reflects exactly those two stages with no
global parameters. Backend errors retain generated Slang and compiler diagnostics. The emitted
recursion uses an explicit result slot and source-return-driven completion flag, so the real WebGPU
validator can prove a result without introducing an iteration budget.

- lower immutable `if`/`match` results to typed joins;
- lower the option-like ADT to one private tag/payload representation;
- lower a direct self-tail helper to an unbounded loop with simultaneous argument updates;
- emit scalar operations and fixed `wm_vertex`/`wm_fragment` wrappers;
- compile the generated Slang to a whole-program WGSL module.

All five bullets are implemented. The backend service remains intentionally narrow: it has no extra
inference pass, coercion system, optimizer, reflection-normalization framework, or general Slang
feature layer.

Exit evidence:

- generated code contains no recursive self-call and no hidden iteration limit;
- the match tests the generated tag and reads a payload only in its constructor arm;
- the flat fixture has an exact Slang golden, while focused Mandelbrot assertions cover its ADT,
  match, join, and recursion-only structures;
- backend failures retain generated Slang and the Slang diagnostic; source semantic failures retain
  their Workman spans and never invoke the backend.

### S4: artifact and render

Status: implemented and exercised on a real WebGPU adapter. Compilation materializes one
content-identified artifact before Core lowering. The runtime-visible descriptor contains only WGSL
and the two fixed entry names. Core replaces the selected `Gpu.fragment` call with that opaque
descriptor, removes selected shader functions and the private ADT from emitted host JavaScript, and
implements the three host accessors. The focused render harness creates a no-resource fullscreen
pipeline, draws three vertices, and reads back `rgba8unorm` pixels.

- materialize `VisualShaderArtifactV1` before Core lowering;
- embed WGSL and fixed entry names in JavaScript without an executable GPU body;
- create the focused no-resource fullscreen pipeline;
- render `flat_color.wm`, then `static_mandelbrot.wm`, to `rgba8unorm`;
- retain adapter-independent compiler tests and one mandatory supported real-adapter run.

Exit evidence:

- every pixel of the real `16x16` flat-color render is opaque red;
- two interior and four exterior probes in the real `64x64` Mandelbrot render agree with the exact
  f32 CPU oracle and each has a same-classification `3x3` margin;
- the emitted helper is a loop and the private ADT is absent from the public artifact;
- `non_tail_recursion.wm` fails before backend invocation;
- ordinary Workman compilation remains unchanged outside GPU islands.

## Work explicitly parked

- `Gpu.Uniform`, descriptor aliases, reflection, packers, and runtime updates;
- logical multi-module/root/selector tables beyond the one selected root;
- static literal capture evaluation and capture specialization keys;
- `i32`/`f32` conflicts, explicit conversions, vector classification, and multiple helper
  specializations;
- general record/product storage and general pattern matrices;
- complete generated-source maps, structured evidence rows, deterministic error accumulation, and
  artifact hash framing;
- pinned distribution packaging and cache invalidation beyond what the local backend invocation
  needs to run the slice.

Code already written for parked work should not be deleted merely for existing, but unfinished code
must not remain wired into the production analysis path if it can reject programs or complicate the
slice before it has focused tests.

## Focused command policy

Do not use the repository-wide `deno task test` as the inner loop. Add named schema, IR, lowering,
backend, artifact, and render test files, then run only the relevant filters plus nearby compiler
regressions. Run the long suite at an integration boundary.

## Definition of done

Status: satisfied by the focused v1 suite and real-adapter render gate.

V1 is done when:

1. `static_mandelbrot.wm` compiles from Workman source to validated WGSL;
2. generated host JavaScript embeds only the completed artifact, not the GPU body;
3. the shader renders expected stable probes through a real WebGPU adapter;
4. the generated recursive helper is a loop and the private ADT match behaves correctly;
5. the focused non-tail and ordinary-host isolation regressions pass.

Uniform animation, multiple numeric representations, polished evidence traces, and production
artifact caching are subsequent vertical slices, not unfinished v1 work.

Related Workman spans for recursion diagnostics and Workman-root attribution for generated
Slang/backend failures are now explicitly owned by the post-v1 diagnostic step in
[`v2-scope.md`](./v2-scope.md). V1 retains stable codes and primary span IDs but is not reopened for
that presentation/evidence extension.

## Runnable window example

[`examples/wmslang_window/src/main.wm`](../../examples/wmslang_window/src/main.wm) is the direct
presentation example for this slice. It defines the recursive Mandelbrot fragment in Workman, opens
an SDL2 window, obtains its X11 or Wayland handles through `SDL_SysWMInfo`, constructs
`Deno.UnsafeWindowSurface`, and presents the generated WGSL with WebGPU. It does not read pixels
back to the CPU or ask SDL to compile the shader. Adapter and device acquisition, precise
`GPUCanvasContext` reflection, pipeline construction, render-pass encoding, queue submission,
presentation, and cleanup are all authored in Workman; the example has no TypeScript presentation
shim or dynamic `Json.assert` boundary.
