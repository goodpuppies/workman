# wmslang v1 scope

Status: authoritative vertical-slice boundary. When another wmslang document describes a broader
visual language or production release contract, this document takes precedence for v1.

## Intent

V1 is one thin, usable path through the complete compiler:

```text
Workman fragment source
  -> ordinary Workman parsing, resolution, and HM inference
  -> selected GPU program
  -> typed immutable shader IR
  -> finite ADT and tail-recursion lowering
  -> generated Slang
  -> validated WGSL
  -> opaque host artifact
  -> one fullscreen WebGPU draw
```

It is not the first production release of a general shader language. Its job is to prove that a
recognizably Workman program can survive the entire GPU pipeline and render an image without
handwritten shader source.

The distinctive source-language work in this slice is deliberately limited to:

| Workman source semantics                   | Required target transformation                     |
| ------------------------------------------ | -------------------------------------------------- |
| immutable `let`, `if`, and `match` results | explicit control flow and private join locals      |
| one finite, private ADT shape              | a tag, optional scalar payload, and branch control |
| direct self-tail recursion                 | one target loop with simultaneous argument updates |

Everything else is fixed plumbing or a direct scalar mapping. V1 does not attempt to implement the
larger GLML or TypeGPU feature sets.

## Product promise

A Workman program can define one statically selected fullscreen fragment shader, compile it ahead of
runtime, obtain WGSL and fixed entry names from an opaque `Gpu.Fragment`, and render it with
ordinary Workman/WebGPU host code.

The fragment receives raw framebuffer coordinates and returns one nominal RGBA color. The compiler
generates the fullscreen vertex stage. The shader is static: v1 has no uniform or resource input.

The release proof is one adapter-backed rendered program combining immutable computation, an
option-like ADT, exhaustive matching, and direct self-tail recursion. A simpler flat-color shader is
only a stepping-stone test.

## Source boundary

### Entry and artifact

V1 recognizes:

```text
Gpu.fragment : (((Number, Number)) => Gpu.Color) => Gpu.Fragment
Gpu.color    : ((Number, Number, Number, Number)) => Gpu.Color

Gpu.wgsl               : (Gpu.Fragment) => String
Gpu.vertexEntryPoint   : (Gpu.Fragment) => String
Gpu.fragmentEntryPoint : (Gpu.Fragment) => String
```

Exactly one `Gpu.fragment(...)` selection is compiled per program. Its argument must be either an
inline `@gpu` lambda or the direct immutable `PVar` binding of one. General alias chasing,
conditional function values, record fields, and multiple artifact roots are outside the slice.

The selected root has one tuple-shaped coordinate parameter and returns `Gpu.Color`. The generated
fragment wrapper passes raw `SV_Position.xy`; it does not normalize, center, scale, or flip it.
`Gpu.color` receives four scalar color components and performs no clamping or color conversion.

At runtime the `Gpu.fragment` expression evaluates to an opaque descriptor for an artifact already
completed during compilation. Core lowering sees only that artifact reference and never lowers or
emits the GPU lambda body as JavaScript.

### Program closure

The selected root may directly call monomorphic, first-order helper bindings declared in the same
Workman module. A helper is compiled once with one concrete shader signature. It may call another
same-module helper or directly self-recur.

V1 does not require:

- imported shader helpers or cross-module shader declaration closure;
- polymorphic shader helpers or multiple specializations of one source function;
- functions stored, returned, passed as values, or selected through control flow;
- closures or captured runtime/static values.

Every free value occurrence other than a resolved same-module helper, ADT constructor, or compiler
basis operation is rejected. Authors place scalar literals and computations inside the shader
program.

### Values and numbers

The shader value subset is:

- `f32`-represented Workman `Number`;
- `Bool`;
- tuples used for parameters, calls, local destructuring, fragment coordinates, and color
  construction;
- one private non-recursive ADT family used entirely inside the shader graph;
- `Gpu.Color` only on the fragment result path.

All reachable Workman `Number` occurrences are `f32` in v1. Both integral and decimal numeric
literals denote `f32` shader values after ordinary Workman inference. This is a fixed dialect
mapping, not an automatic `i32`/`f32` coercion system: v1 has no user-visible shader `i32`, `u32`,
numeric representation variables, promotion lattice, conversion insertion, or representation
specialization.

Consequently an iteration counter is written using ordinary numeric literals such as `0`, `1`, and
`96`, but is represented as `f32` in the shader. A later numeric slice may distinguish integer and
floating representations and add explicit conversions without changing the v1 recursion or ADT
semantics.

V1 scalar operators are:

```text
unary -
+ - * /
< <= > >= == !=
! && ||
```

Arithmetic and numeric comparison operate only on scalar `f32`; equality also accepts `Bool`.
Boolean operators preserve Workman's evaluation order. Tuple/vector arithmetic, scalar broadcast,
structural equality, `%`, strings, and bitwise operations are outside the slice.

V1 has no unqualified compiler-supplied math intrinsics. Visual functions such as `sin`, `fract`,
`sqrt`, `clamp`, vector `dot`, and `length` are a later additive basis slice. The Mandelbrot
acceptance program needs only scalar arithmetic and comparison.

### Immutable expressions

V1 accepts:

- scalar and boolean literals;
- resolved local variables and same-module direct function calls;
- immutable `let` bindings with a single `PVar` or wildcard pattern;
- tuple construction and flat tuple destructuring in function parameters or `let` bindings;
- blocks with ordered expression/declaration items and one final result;
- expression-valued `if`;
- constructor creation and the restricted exhaustive `match` described below;
- the closed scalar operators above.

Records, record projection/update, lists, strings, arrays, FFI calls, panic/effects, nested lambdas,
and general destructuring are outside shader code in this slice. They remain ordinary host Workman
features.

The semantic lowering may introduce mutable locals only for expression joins and tail-loop
parameters. ADT construction is an ordinary immutable value operation. A later text emitter may use
target-language initialization syntax, but it must not turn that implementation detail into
observable Workman mutation. Authored Workman bindings remain immutable and source evaluation order
is preserved.

### ADT and match

V1 must support one option-like, non-generic, non-recursive ADT declared in the same module as the
shader, for example:

```workman
type Escape = Inside | Escaped<Number>;
```

For the slice, a constructor is either nullary or has one `Number` payload. The ADT may be created,
returned from helpers, bound immutably, and consumed by `match`. It may not appear in the fragment
ABI, host artifact, capture boundary, or another constructor payload.

Matches over that ADT must:

- be exhaustive;
- contain one top-level arm per constructor;
- use only the constructor itself, a wildcard payload, or one direct payload binder;
- preserve authored arm order and evaluate the scrutinee once;
- produce one common v1 result type.

Nested patterns, tuple/record patterns inside constructors, pinned runtime patterns, literal
patterns, guards, redundancy analysis, generic ADT layouts, recursive layouts, and a general
pattern-matrix compiler are deferred. V1 may lower the closed constructor table directly to a tag
switch.

### Recursion

V1 accepts an authored `let rec` helper only when:

- it belongs to a single-member recursive group;
- every recursive occurrence is a direct call to that same binding;
- every recursive call is in tail position;
- the recursive call has the same fixed parameter/result shape;
- all next arguments are evaluated before loop parameters are reassigned.

Tail position flows through the function result, the selected branch of `if` or `match`, and the
final result of an immutable `let` body. A recursive call used as an operator operand, call
argument, constructor payload, let initializer, or other surrounding computation is rejected.

The generated target contains an unbounded loop and no recursive call. The source program supplies
its own termination condition; the compiler adds no hidden budget or fallback value.

Mutual recursion, non-tail recursion, signature-changing recursion, and recursive data are outside
v1 and receive source diagnostics before backend emission.

## Backend boundary

The compiler emits one Slang module containing:

- private declarations and helper functions for the selected program;
- a generated fullscreen-triangle vertex entry named `wm_vertex`;
- a generated fragment entry named `wm_fragment`;
- no resource bindings.

The Workman compiler library returns this deterministic generated module as `slangSource` beside its
validated lowered tables. A semantic diagnostic returns no generated module. TypeScript owns the
subsequent Slang invocation because compiler loading, lifecycle, binary assets, and backend failures
are infrastructure concerns rather than shader-language semantics.

Slang is invoked at compile time and must produce a non-empty whole-program WGSL module accepted by
WebGPU. The emitted host artifact needs only:

```ts
type VisualShaderArtifactV1 = {
  wgsl: string;
  vertexEntry: "wm_vertex";
  fragmentEntry: "wm_fragment";
};
```

A production-grade offline bundle, reflection schema, content-addressed cache key, canonical hash
preimage, complete generated-source map, and multi-target manifest are valuable later work, not v1
completion requirements. The slice must retain generated Slang and backend diagnostics on failure
and attribute a failure to the selected Workman root or helper when that source anchor is known.

The focused host harness creates a no-vertex-buffer triangle-list pipeline, draws three vertices to
one `rgba8unorm` target, and reads pixels back. General render-pipeline construction remains
ordinary host code rather than a new Workman GPU runtime.

## Required diagnostics

V1 needs focused source errors for:

- unresolved, unmarked, multiple, or wrongly shaped fragment roots;
- unsupported shader expressions, values, calls, patterns, or captures;
- non-exhaustive or unsupported ADT matches;
- non-tail or mutual recursion;
- generated Slang/backend failure.

Stable codes and primary Workman spans are required. The full auditable diagnostic evidence graph,
cross-phase ordering protocol, logical-module transport, exact generated-source sidecar, and
artifact-identity framing are not part of this slice.

## Explicitly outside v1

- uniforms, automatic captures, static captures, buffers, textures, samplers, and all reflected
  resource packing;
- user-visible `i32`/`u32`, numeric coercion, promotion, conversion operations, representation
  constraints, and numeric specialization;
- compiler-supplied math intrinsics, vector operators, matrices, swizzles, derivatives, atomics, and
  mutable GPU resources;
- polymorphic helpers, multiple specializations, higher-order functions, closure conversion, lambda
  lifting, and defunctionalization;
- imported shader helpers, cross-module shader closure, multiple roots, selector deduplication, and
  artifact sharing;
- general records/products in shader storage and general pattern-matrix compilation;
- recursive/generic/nested ADT layouts and ADTs in public GPU ABIs;
- user-authored vertex shaders, varyings, interpolation, multiple render targets, compute shaders,
  and storage shaders;
- optimization: constant folding, inlining, dead-code elimination as a language rule, CSE, tag
  elimination, loop unrolling, or vectorization;
- exact reflection manifests, deterministic cache identity, pinned distribution packaging, and the
  complete diagnostic evidence protocol;
- frontend-v2 support and CPU execution of `@gpu` lambdas.

Existing prototype machinery for some excluded items may remain in the worktree, but it is not a v1
dependency and must not make the slice wait for its completion.

## Acceptance

V1 has one positive release program and three focused safeguards:

1. `static_mandelbrot.wm` renders a deterministic image and combines immutable lets/branches, one
   option-like ADT, exhaustive matching, and direct self-tail recursion.
2. A small `flat_color.wm` proves the artifact path while the semantic program is developed.
3. `non_tail_recursion.wm` fails at the recursive call before Slang generation.
4. An ordinary non-GPU Workman program retains its existing inference and JavaScript output, and
   generated host JavaScript contains WGSL but no executable GPU body.

The exact sources and assertions are in [`v1-acceptance.md`](./v1-acceptance.md). V1 is done only
when the static Mandelbrot program renders through a real WebGPU adapter in at least one supported
environment. IR and generated-source snapshots alone are insufficient.

## Implementation order

1. Normalize only the selected single-module root, direct helpers, restricted expressions, one ADT,
   and authored recursion identity into a small schema-v2 input.
2. Build typed immutable functional IR with every shader `Number` fixed directly to `f32`.
3. Lower restricted ADT matches, expression joins, and direct self-tail calls.
4. Emit Slang plus fixed raster wrappers and compile it to WGSL.
5. Materialize the opaque artifact before Core lowering and embed it in generated JavaScript.
6. Render the flat-color smoke shader, then the combined static Mandelbrot acceptance shader.

Uniforms, expanded numeric solving, generalized specialization, logical multi-module roots, and the
full diagnostic/artifact protocols begin only after this vertical slice works end to end.
