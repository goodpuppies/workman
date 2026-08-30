# wmslang v2 ergonomic slice

Status: ergonomic, lexical-helper, semantic-to-shader type ownership, occurrence-hover, and the
restricted curried-environment slice implemented end to end. This document extends the
completed static visual-v1 pipeline without opening automatic capture, coercion, generalized
specialization, or general optimization designs.

Implementation checkpoint: pure four-tuple results, shader-side `float2`/`float4` representation,
symmetric scalar/vector arithmetic, deferred root-coordinate shape solving, vector projection, and
the migrated Mandelbrot/window examples are implemented and covered by focused compiler and real
WebGPU render tests. Semantic diagnostics retain resolved primary/related Workman anchors, and
backend failures are attributed to the selecting fragment call and selected shader declaration.
First-order local `let`/`let rec` helpers are now discovered within the selected lexical GPU island;
module-level helpers are rejected as host-only, and local helpers must receive outer dynamic values
as parameters. The static Mandelbrot acceptance fixture and SDL/WebGPU window example use a local
recursive `escapeIterations`, including the real offscreen WebGPU render gate.
TypeScript normalization now emits only semantic `number` and tuple shapes. The Workman core creates
the separate concrete `f32`/vector/product table plus an evidence row for every semantic type, and
functional IR, lowering, Slang emission, and output validation consume that concrete table. The
Workman also returns stable expression, pattern, and function occurrence rows. Live hover consumes
those rows through a type-only compiler entry that performs neither functional lowering nor Slang
emission. GPU expressions show contextual types such as `f32`, `f32x2`, and GPU-local function
signatures; host expressions retain ordinary Workman types. If selected-island normalization or
type elaboration fails, hover labels the target `unresolved GPU type` rather than falling back to a
successful CPU interpretation. A richer per-constraint evidence graph remains future work.
The selector now also recognizes one restricted application of an annotated host shader factory.
Normalization reifies its nominal record and ordered fields, uniform-field reads survive the pure
Workman IR and lowering as closed `uniform` operations, and Slang emission produces one fixed
group-zero/binding-zero constant buffer. Materialization now compares normalized field
representations with pinned Slang reflection, records authoritative offsets and padded aggregate
size, and lowers each outer application to a fresh immutable bound fragment containing copied,
zero-padded bytes. The Workman WebGPU presenter allocates one buffer/bind group, uploads each bound
value, and reuses its module and pipeline. The SDL2 window example drives center and time from a
tail-recursive CPU event/frame loop while the fragment retains independent GPU-local recursion.

## Intent

V1 proved the hard semantic path: ordinary Workman inference, immutable control flow, one private
ADT, exhaustive matching, direct self-tail recursion, Workman-written lowering, Slang, WGSL, an
opaque host artifact, and a real render. V2 first removes shader-specific ceremony from ordinary
pure expressions.

The target source style is:

```workman
record View = {
  resolution: (Number, Number)
};

let shade = (view: View) => {
  (uv) => {
    @gpu;

    let centered = uv * 2.0 - view.resolution;
    let (x, y) = centered;
    (x, y, 0.25, 1.0)
  }
};

let fragment = Gpu.fragment(shade(currentView));
```

The fragment is still selected explicitly by `Gpu.fragment`, because selection creates a host
artifact. Its body is otherwise a pure function. Returning an RGBA value does not require a
side-effect-looking `Gpu.color(...)` call. The outer application binds ordinary CPU data; it does
not make `currentView` an unrestricted lexical capture and does not compile another shader.

The v2 type-table slice makes the type boundary honest. Workman continues to infer ordinary source
types such as `Number` and `(Number, Number)`. A separate wmslang elaboration then proves that a reachable
occurrence has shader representation `f32` or `float2`. These are two judgments about the same
program value, not competing members of one global type union.

```text
Workman semantic judgment       shader representation judgment
expression : Number             expression => f32
expression : (Number, Number)   expression => vector(2, f32)
expression : (A, B)             expression => product(A', B')
```

The representation judgment is GPU-local evidence. It must not change what the value means to
ordinary Workman, make host tuple arithmetic legal, or add `f32` and vectors to the global host
`Ty` algebra.

These judgments are layers of one GPU-owned interpretation, not two alternative typings of the same
source body. V2 does not infer an ordinary helper once for CPU execution and again under a shader
dialect.

## Scope

V2 contains six related changes:

1. A fragment root returns an ordinary homogeneous numeric 4-tuple. The stage boundary interprets
   that result as RGBA.
2. Homogeneous numeric tuples of width 2–4 may use the GPU vector representation. Arithmetic
   supports componentwise vector/vector operations and symmetric scalar/vector broadcast.
3. Shader semantic and backend diagnostics retain a primary Workman span plus related Workman
   anchors when known. Backend errors identify the selected root or helper rather than ending at
   generated Slang alone.
4. Shader scalar/vector/product representation is solved and reified by the Workman wmslang core
   from normalized host shapes and explicit GPU-use constraints. TypeScript no longer silently
   decides that `Number` means `f32` or that a tuple means a vector while serializing the input.
5. Shader helpers are first-order local functions owned by the selected lexical GPU island. Ordinary
   top-level helpers are host-only rather than silently acquiring a second GPU interpretation.
6. One nominal CPU record may cross through a restricted curried shader factory. Outer application
   binds dynamic per-draw data; the returned inner `@gpu` lambda owns per-fragment computation.

This remains a narrow resource slice. It contains one compiler-generated uniform block derived from
one explicit nominal-record factory parameter, but no automatic capture, user-declared bind groups,
buffers, textures, samplers, or general resource reflection API.

## Pure fragment result

For a fragment with no CPU environment, the v2 fragment constructor retains the source type:

```text
Gpu.fragment : ((((Number, Number)) => (Number, Number, Number, Number))) => Gpu.Fragment
```

For the restricted curried form described below, its conceptual contextual type is:

```text
Gpu.fragment : gpu(f32x2 -> f32x4, environment E) -> Gpu.Fragment<E>
```

This is one selection operation, not a general overloaded function surface. `E` is a compiler fact
derived from the selected shader factory's annotated nominal-record parameter. A direct static
`@gpu` lambda has no environment and therefore uses the existing non-generic `Gpu.Fragment` shape;
an applied factory produces a bound fragment whose artifact carries `E` for host checking and
packing.

The extra parentheses reflect Workman's existing tuple-shaped function representation; they do not
introduce a new nominal color type. At the selected fragment boundary only, the result tuple is
required to have exactly four numeric components and is emitted as the target `float4`/`vec4` color
value.

Inside shader code, a four-component numeric tuple is still an ordinary immutable value. It may be
bound, returned through `if` or `match`, passed to a monomorphic helper, destructured, and combined
with the vector operations below. The public fragment ABI supplies its meaning as RGBA; tuple
construction itself does not perform clamping, conversion, output, or mutation.

`Gpu.color` is not part of the v2 authoring contract. A temporary compatibility identity may remain
while v1 examples migrate, but it must disappear before typed functional IR: there is no `color`
expression, type, or lowered operation in the v2 representation.

## Numeric tuple vectors

Workman has one tuple syntax where GLML distinguishes vectors (`[x,y]`) from products (`(x,y)`).
For this slice, a tuple is vector-representable when all of the following hold:

- its width is 2, 3, or 4;
- every component has ordinary Workman type `Number`;
- it occurs in GPU-reachable code;
- its uses require the vector representation, or it reaches the fixed coordinate/color stage ABI.

Heterogeneous tuples and nested product shapes remain products. The implementation may initially
choose the vector representation for every homogeneous numeric width-2–4 tuple in the closed GPU
slice, because v2 exposes no shader ABI where the product/vector layout difference is observable.
The representation decision must nevertheless be recorded in the shader sidecar/IR rather than
changing Workman's host `Ty` union or global tuple semantics.

The v2 operator table is:

| Left       | Operator    | Right      | Result      | Meaning                         |
| ---------- | ----------- | ---------- | ----------- | ------------------------------- |
| scalar     | `+ - * /`   | scalar     | scalar      | existing scalar operation       |
| vector `N` | `+ - * /`   | vector `N` | vector `N`  | componentwise                   |
| vector `N` | `+ - * /`   | scalar     | vector `N`  | broadcast scalar to every lane  |
| scalar     | `+ - * /`   | vector `N` | vector `N`  | broadcast scalar to every lane  |

Widths must agree for vector/vector operations. V2 does not resize, truncate, pad, or implicitly
swizzle vectors. Arithmetic stays `f32`; there is no `i32`, `u32`, promotion lattice, or inserted
numeric conversion.

## Current type-system status

Ordinary Workman inference currently knows only the source-language shape. Its `Ty` algebra has
`Number`, `Bool`, functions, tuples, records, named types, and variables, but deliberately has no
shader scalar, vector, matrix, address-space, or stage types. The GPU dialect hook adds the minimum
shape rules needed by this slice: it recognizes homogeneous numeric tuples of width 2–4, validates
scalar/vector arithmetic, defers a small number of unresolved operand checks, and recognizes named
vector lane projections.

The original production normalizer performed the representation decision itself:

- every reachable `Number`, and even an unresolved reachable host type variable, becomes `f32`;
- every width-2–4 tuple whose normalized children are `f32` becomes `vector`;
- all other supported tuples become product tuples;
- the Workman compiler receives those concrete rows and trusts them.

That was sufficient to prove the ergonomic slice, but it reversed the ownership promised by the
compiler boundary. It also loses the evidence needed to explain *why* a tuple is a vector, and it
would make later integer representations or per-specialization choices unsafe: structurally equal
host `Number` types could accidentally share one target decision.

The current boundary no longer does that conversion. It emits semantic `number`, `tuple`, function,
ADT, boolean, and void rows. Workman's `elaborateSliceTypes` pass returns a distinct `shaderTypes`
table with stable matching IDs and `typeEvidence` rows; subsequent Workman passes receive an
elaborated program view, while the output retains the original semantic program for validation.
For the closed v2 subset, every semantic number becomes `f32`, and every direct homogeneous numeric
tuple of width 2–4 uses the permitted explicit vector default. The loader rejects missing, duplicate,
or source-inconsistent shader/evidence rows. The pure `elaborateGpuSliceTypes` entry additionally
returns one stable occurrence row for every selected expression, pattern, and function without
building functional IR or generated Slang.

The callback stored on unresolved host type variables is only a scoped HM integration mechanism. It
can reject an eventually non-numeric/non-vector shape, but it is not a shader representation solver
and should not grow into one.

## V2 shader type elaboration

The bounded v2 design keeps the accepted language unchanged and moves only ownership and evidence.
Step 1, occurrence identity, the type-table portion of step 5, and editor consumption are
implemented. Constraint edges still need to become occurrence-local before representations beyond
the closed all-`f32` slice are introduced:

1. TypeScript serializes pruned semantic shapes (`number`, `bool`, `tuple`, function, ADT), stable
   expression/binding identities, and closed GPU constraints. It does not pre-label semantic
   `number` as `f32` or a semantic tuple as `vector`.
2. Each reachable value occurrence has a GPU representation variable separate from the structurally
   interned host type. Equality edges connect occurrences only through real value flow: binding use,
   call argument/result, branch result, tuple component, and operator result.
3. Stage ABI rows and the v2 numeric operator rows provide fixed `f32` evidence. Vector operations,
   named lane projections, and coordinate/color ABI rows provide fixed vector-width evidence.
4. The Workman core solves those constraints to a fixed point, retaining the originating expression,
   span, and semantic reason on every edge.
5. Only after solving does it create concrete typed-IR rows such as `F32`, `Vector(2, F32)`, and
   `Product([...])`. Lowering and emission consume only these reified rows.

For this slice the scalar representation domain is intentionally trivial:

```text
Unknown | F32(evidence)
```

Every accepted numeric occurrence must reach `F32`; an unresolved occurrence is a compiler error,
not an implicit normalizer default. Incompatible shape or capability constraints are reported
separately. Introducing `I32`, `U32`, representation conflicts, literal-representation rules, or
explicit conversions later extends this domain without changing ordinary Workman HM types. The
larger design in [`v1-numerics.md`](./v1-numerics.md) remains research for that later slice rather
than v2 acceptance criteria.

Tuple shape and tuple representation are likewise separate. A Workman tuple always remains a
semantic product. Within the current closed shader subset, a direct homogeneous numeric tuple of
width 2–4 reifies as a vector when a vector operator, projection, or stage ABI requires it. The
requirement propagates through immutable value flow and GPU-local helper calls, so a local helper
need not mention shader types. Destructuring is representation-neutral and can lower from either a
vector or a product.

For untouched homogeneous numeric tuples, v2 may retain its current GPU-local vector default because
the restricted language exposes no operation or ABI that can observe a different product layout.
The default must be recorded as explicit evidence by the Workman solver. If a later feature makes
the choice observable, it must add a product/vector constraint or explicit source distinction rather
than relying on tuple shape alone.

This is not a second source-language type checker. Host HM remains authoritative for tuple width,
component types, functions, ADTs, and binding identity. Shader elaboration only answers whether a
host-typed, GPU-reachable program has one legal concrete target representation.

## Lexical ownership of helper functions

V2 makes the `@gpu` lambda a lexical elaboration island rather than treating arbitrary ordinary
helpers as potentially dual CPU/GPU programs. This avoids one source expression acquiring two
operator interpretations, two representation overlays, and confusing hover/diagnostic results.

The domain rules are:

- a top-level or module-level function other than the selected root is outside that root's lexical
  GPU island and cannot be called from it, even if it is independently marked `@gpu`;
- the lambda selected by `Gpu.fragment` must contain `@gpu;` and is GPU-only;
- a local function declaration lexically inside that lambda inherits the GPU domain;
- a GPU-local function may be called directly, including a supported direct self-tail call, but may
  not escape as a returned value, data member, general argument, capture, or host value;
- the selected root itself may be the exact inner `@gpu` lambda returned by the restricted curried
  shader factory below; this is a compiler-known environment boundary, not general function escape;
- v2 does not automatically clone, specialize, or reinterpret one ordinary function body for both
  CPU and GPU use.

Consequently the Mandelbrot helper belongs inside the shader root:

```workman
let mandelbrotShade = (coord) => {
  @gpu;

  let rec escapeIterations = (cx, cy, zx, zy, remaining) => {
    -- immutable recursive shader computation
  };

  -- call escapeIterations here
};
```

The local helper still passes through ordinary Workman semantic shape inference, then receives one
concrete contextual type from the GPU representation solver. The editor presents that wmslang type,
not separate CPU and GPU instantiations of the same expression.

The production normalizer now closes over called block-local `let`/`let rec` functions, omits their
declarations from executable expression rows, and serializes them as ordinary first-order GPU
functions. Binding ownership is tracked per normalized function, so a helper cannot accidentally
capture a root parameter or root local through the former program-wide allowed-binding set. Unused
local helper declarations disappear with no runtime effect. General lexical capture and closure
conversion remain deferred.

## Curried CPU-to-GPU environment

V2 expresses frequency of change with one restricted host function returning the selected GPU
function:

```workman
record MandelbrotUniforms = {
  resolution: (Number, Number),
  center: (Number, Number),
  scale: Number,
  time: Number
};

let mandelbrotShade = (uniforms: MandelbrotUniforms) => {
  (coord) => {
    @gpu;

    let pixel = (coord * 2.0 - uniforms.resolution) / uniforms.resolution.y;
    let c = pixel * uniforms.scale + uniforms.center;
    -- local immutable recursion and color result
  }
};

let fragment = Gpu.fragment(mandelbrotShade(currentUniforms));
```

The placement of `@gpu` is semantic. The outer lambda is host code and its parameter is updated at
CPU/per-frame frequency. The returned inner lambda is the GPU island and its coordinate parameter
varies at fragment-invocation frequency. Placing `@gpu` on the outer lambda instead would make both
layers GPU-owned and would not define a CPU-data boundary.

Conceptually:

```text
mandelbrotShade : MandelbrotUniforms -> gpu(f32x2 -> f32x4)
Gpu.fragment    : gpu(f32x2 -> f32x4) -> Gpu.Fragment<MandelbrotUniforms>
```

The ordinary host `Ty` may continue to represent the returned value with a function shape plus
parallel GPU capability/environment facts. The compiler and language service must nevertheless
retain the nominal environment type on the bound GPU value and artifact.

This is not general closure conversion. V2 accepts exactly:

- one directly resolved host shader-factory binding;
- one outer parameter annotated with a concrete nominal record type;
- an outer body whose result is exactly one `@gpu` lambda;
- capture by the inner lambda of that outer parameter only;
- direct application whose result is selected by `Gpu.fragment`;
- scalar and homogeneous numeric tuple fields accepted by the single uniform-block layout.

GPU pretyping recognizes the chained spelling `uniforms.resolution.y` as one nominal record-field
read followed by vector lane projection. The normalized GPU graph still contains two explicit nodes:
a typed uniform read and numeric lane projection. Host records and host tuples do not acquire this
GPU-only shorthand.

The inner lambda may contain the non-escaping first-order local helpers described above. It may not
capture other host locals, module values, FFI objects, functions, or arbitrary records. Ordinary
functions returning ordinary functions remain ordinary Workman; only the inner marker plus the
compiler-known stage selector establish a shader factory.

Applying the outer function is a runtime data operation, not shader compilation. Each application
creates a lightweight immutable bound-shader value containing the stable artifact/schema identity
and freshly copied bytes for the current record value. Generated host code packs those bytes using
the reflected layout at the application boundary; it does not retain the record or a foreign
reference to it. Generated Slang/WGSL and the WebGPU pipeline are shared across all applications
with that identity. The renderer validates the bound value and performs `GPUQueue.writeBuffer`
before drawing.

Outer application always means dynamic uniform binding in v2, even when the argument is a literal.
It never silently produces a specialized shader variant. Compile-time specialization requires a
later explicit operation so code size and cache behavior remain visible.

This removes `Gpu.uniform`, `Gpu.read`, and `Gpu.withValue` from ordinary v2 authoring. Their proposed
descriptor identity, reflection, zero-initialized packing, and mismatch checks remain implementation
machinery, as detailed and marked for terminology revision in
[`v1-uniform.md`](./v1-uniform.md).

The host presentation contract correspondingly separates stable renderer creation from per-frame
binding:

```text
createFragmentRenderer(surface, initialBoundFragment) -> Renderer<Environment>
renderFragment(renderer, boundFragment)                -> Result<Void, Error>
```

The second call verifies artifact and nominal environment identity, uploads the already packed
immutable bytes, and draws.
Passing a bound fragment from another shader factory or record schema fails statically where the
generic host type is available and fails closed by stable identity at the runtime/FFI boundary.

### Implementation boundary

The environment slice is deliberately split so each phase has a closed contract:

1. **Selection (implemented):** resolve `Gpu.fragment(factory(value))` to one host factory and its
   exact returned inner `@gpu` lambda. Reject unannotated, multi-parameter, marked-outer, indirect,
   or non-exact factories.
2. **Schema normalization (implemented):** resolve the outer parameter to one same-module,
   non-generic nominal record. Preserve declaration order and allow only `Number` plus homogeneous
   numeric tuples of width 2–4.
3. **GPU elaboration (implemented):** keep the outer argument out of the shader expression graph;
   turn only resolved `environment.field` uses into typed uniform-read occurrences. Bare environment
   values, unknown fields, other captures, and unsupported field types fail closed.
4. **IR and Slang (implemented):** preserve uniform reads through Workman-owned functional IR and
   lowering, emit one deterministic constant-buffer declaration, and leave static shader output
   unchanged.
5. **Reflection and packing (implemented):** predict field representations, ask Slang for authoritative
   offsets and aggregate size, reject disagreement, and generate a zero-initialized host packer keyed
   by artifact plus nominal schema identity.
6. **Bound artifact (implemented):** materialize the selector as an immutable value containing stable
   shader/schema metadata and freshly copied uniform bytes. The ordinary record is not retained as a
   foreign reference or side channel. Reapplying the factory changes only the bytes.
7. **Presentation (implemented):** allocate one uniform buffer/bind group per renderer, validate each
   submitted bound fragment, pass its copied bytes to `queue.writeBuffer` before drawing, and reuse
   the module and pipeline. Packing belongs to bound-fragment construction in step 6 rather than to
   the renderer.
8. **Real acceptance (implemented):** drive resolution, time, and mouse-derived center through the
   SDL2 Mandelbrot example. Focused execution proves two distinct bound values share WGSL and have
   different reflected-layout bytes; the real window path runs multiple frames without rebuilding
   its renderer.

## Typechecking and language-service contract

The ordinary HM pass is a shared *pretyping* phase, not the complete shader typechecker. Reusing it
for binding, function, tuple, ADT, and control-flow shape is desirable; treating its host `Ty` result
as the final type of a GPU-owned expression is not.

Checking a source file proceeds in three semantic phases before any backend work:

1. Parse, resolve bindings, and assign every expression, pattern, and local declaration one lexical
   domain owner (`host` or a particular GPU island).
2. Run ordinary Workman HM shape inference with the scoped GPU dialect. GPU-only operations emit
   attributable shader constraints instead of pretending that the host operator table explains
   them.
3. Run the pure Workman wmslang elaborator over each selected island. It validates capability and
   representation constraints and returns a concrete shader type for every reachable source
   occurrence.

The result of phase 3 is required compiler analysis, not something deferred until Slang emission.
Slang remains a backend validator and is not needed for editor typechecking.

Within a successfully elaborated GPU island, hover presents the contextual wmslang type as the
primary type:

```text
coord              : f32x2
uniforms            : MandelbrotUniforms (uniform environment)
uniforms.resolution : f32x2
uniforms.time       : f32
escapeIterations   : (f32, f32, f32, f32, f32) => Escape
```

Host code continues to present ordinary Workman types such as `Number` and `(Number, Number)`. The
language server does not display both a host instantiation and a shader instantiation for one body,
because v2 lexical ownership makes that state illegal. Source annotations may continue to use
ordinary Workman type names; the hover result is their solved contextual shader interpretation.
At the deliberate curried boundary, the outer parameter declaration is host
`MandelbrotUniforms`; occurrences captured by the inner island are its one uniform-environment view.
The editor identifies that boundary rather than displaying two overloads or independently inferred
function bodies.

The GPU elaborator output includes an initial occurrence table keyed by stable expression, pattern,
and function IDs. Each row retains its source span and concrete shader type ID; selected-island
membership supplies its lexical domain, and the semantic program/type evidence tables supply the
other side of the judgment. Hover consumes this table rather than reconstructing shader types from
tuple shape. Explicit binding rows, per-constraint diagnostic/evidence IDs, definition, and signature
help consumption remain follow-on language-service breadth.

Live analysis invokes only parsing, resolution, HM pretyping, and the pure GPU elaborator. It must
not load `slang-wasm`, generate WGSL, or create a WebGPU device. The generated Workman elaborator
library can be cached by the language-server process and rerun per changed island. If that
elaborator cannot produce contextual types, validation publishes a `gpu.type.unresolved` warning at
the selector and hover continues to label expressions `unresolved GPU type`; the failure is never
silent. The VS Code server intentionally starts without `--allow-write`, so the generated Workman
compiler library is imported from an in-memory `data:` module; live GPU typing must not create a
temporary file.

During incomplete editing, the language server may use the HM shape for recovery, but it must label
the result as an unresolved GPU type and retain the shader diagnostic. It must not silently fall back
to an apparently valid CPU hover when GPU normalization or elaboration fails. In particular, an
unsupported operation or cross-domain call remains visible even when surrounding source is broken.

The current implementation meets the hover portion of this contract. It caches the generated
Workman compiler module, calls only `elaborateGpuSliceTypes`, matches stable occurrence/span rows back
to authored targets, and formats the returned shader table. It does not call functional lowering,
Slang source emission, `slang-wasm`, or WebGPU. When full GPU analysis fails and partial HM recovery
succeeds, targets lexically inside `@gpu` are labeled unresolved instead of receiving the recovered
host type. Publishing the retained shader diagnostic through every recovery path remains diagnostic
breadth beyond hover itself.

The requested expression therefore resolves as:

```text
uv            : f32x2
2.0           : f32
uv * 2.0      : f32x2  -- scalar broadcast
resolution    : f32x2
... - resolution : f32x2  -- componentwise subtraction
```

Tuple destructuring and `.x`/`.y`/`.z`/`.w` projection lower to vector lane extraction when the
source value is vector-represented. The named spelling follows Slang/HLSL shader convention. It is
available only in GPU typing regions, checks the selected lane against the solved vector width, and
does not add fields to ordinary host tuples. Product tuples continue to use product fields.

## GLML findings

GLML provides a useful semantic reference but not a representation to copy directly.

Its surface syntax and type algebra distinguish vectors from products immediately: `[x, y]` creates
`TyVec`, while `(x, y)` creates `TyTuple`. It also distinguishes `TyInt` from `TyFloat`, carries
deferred `Broadcast`, `MulBroadcast`, `IndexAccess`, type-class, and `Coerce` constraints, solves an
`int <: float` relation, materializes conversion nodes, and monomorphizes before tuple lowering.
Consequently GLML does not have Workman's tuple/vector duality: the author selected the aggregate
kind before inference.

Wmslang should copy GLML's useful phase separation—generate constraints, solve them, then materialize
concrete typed nodes—but not its early vector/product syntax split or implicit integer promotion.
Workman's single tuple syntax is a feature, while its global `Number` semantics must remain valid on
both CPU and GPU.

### Fragment result

GLML checks `main` against `vec2 -> vec4` in `compiler/typecheck.ml`. The authored function returns
its color as its final pure expression. Much later, `compiler/patch_main.ml` changes the target
entry into GLSL's required `void main()` and rewrites value returns to `fragColor = value`.

That separation is the right model for Workman: source semantics remain a pure function, while the
fixed raster wrapper owns target output mechanics.

### Broadcasting

GLML's type checker emits `Broadcast(left, right, result)` constraints for `+` and `-`, and
`MulBroadcast(left, right, result)` for `*` and `/`. Its constraint solver handles equal-width
vector/vector operands and either scalar/vector ordering recursively through element types.

For example, GLML's `2d_sdf_variants.glml` writes:

```text
let top = 2 * coord - u_resolution
```

and resolves it to GLSL equivalent to:

```glsl
vec2 top = (2.0 * coord) - u_resolution;
```

GLML's multiplication constraint also includes matrices and linear-algebra shapes. V2 deliberately
takes only its scalar/vector and equal-width componentwise cases. Matrices and general
multiplication semantics remain deferred.

GLML projects vector lanes numerically: `u_resolution.1` creates an `IndexAccess` constraint and
eventually emits an indexed vector access. It reserves named `.field` projection for records.
Workman instead uses shader-familiar `resolution.y` because its existing surface grammar already
represents dotted names and Slang directly supports `float2` lanes named `x` and `y`; schema-v2
still records the projection as numeric lane index `1` rather than carrying the spelling downstream.

## Diagnostic evidence moved from v1

V1 retains stable diagnostic codes and source span IDs in the shader DTO, which is sufficient to
prove semantic rejection. V2 owns the next presentation/evidence step:

- every shader diagnostic has one primary Workman span;
- non-tail and mutual-recursion diagnostics may identify the recursive declaration as a related
  span;
- generated Slang/backend failures identify the selected root and, when available, the emitted
  helper whose generated range failed;
- the thrown compiler error preserves structured diagnostics instead of flattening them to only
  `code: message` text;
- this remains compatible with the proposed program-evidence graph, but does not require that
  larger unification project.

Exact generated-source maps, multi-error ordering, and the complete diagnostic evidence protocol
remain later work.

## Non-goals

- automatic captures, user-declared bind groups, storage/vertex buffers, textures, samplers, or a
  general resource/reflection API beyond the one compiler-generated uniform block;
- integer shader representations or automatic numeric coercion;
- changing the global Workman `Ty` union to contain `f32`, vectors, matrices, stages, or address
  spaces;
- vector comparisons, structural equality, matrices, multi-lane swizzles, or general indexing;
- compiler math intrinsics;
- imported helpers, multiple roots, polymorphism, or higher-order shader values;
- automatic CPU/GPU dual interpretation of ordinary helpers;
- escaping GPU-local functions or general closure capture/conversion;
- general tuple representation solving outside GPU-reachable code;
- optimization.

## Acceptance

V2 is complete when focused fixtures prove:

The current requirement-to-test audit is maintained in
[`v2-acceptance.md`](./v2-acceptance.md).

1. A fragment ending in `(1.0, 0.0, 0.0, 1.0)` compiles and renders opaque red without
   `Gpu.color`.
2. `uv * 2.0 - resolution` type-checks and lowers to one vector multiply and one vector subtract,
   with no four independent authored scalar expressions.
3. Both `vector * scalar` and `scalar * vector` work; mismatched vector widths fail at the Workman
   source operation.
4. Tuple destructuring of a vector-represented value preserves lane order.
5. Generated Slang uses `float2`/`float4` values and the fragment wrapper returns the pure root
   result as its output color.
6. The existing Mandelbrot ADT and tail-recursion render remains green after removing `Gpu.color`.
7. A non-tail recursion diagnostic retains both its primary recursive-call span and the related
   declaration span; a forced backend failure retains its Workman root anchor.
8. Ordinary host tuple arithmetic remains unchanged outside `@gpu` regions.
9. The normalized input contains semantic `number`/tuple shapes plus attributable constraints; the
   Workman compiler, not TypeScript normalization, produces the concrete `f32`/vector/product type
   rows consumed by typed IR.
10. A first-order local `let rec` helper inside the selected root compiles, while calling an
    unmarked top-level helper from that root produces a cross-domain diagnostic. The Mandelbrot
    example defines `escapeIterations` locally and still lowers its self-tail call to a loop.
11. Hover inside the Mandelbrot root reports `coord: f32x2`, `uniforms.resolution: f32x2`, and the
    concrete GPU-local helper signature; equivalent host expressions retain ordinary Workman types.
12. A shader representation or cross-domain error remains an LSP diagnostic and hover is marked
    unresolved instead of falling back to a successful CPU interpretation. Live checking does not
    invoke Slang or WebGPU.
13. A host factory taking one nominal environment record may return the selected inner `@gpu`
    lambda. Putting `@gpu` on the outer factory does not establish this boundary, and capturing any
    other host value fails.
14. Applying one factory to two different environment values produces one shader module/pipeline
    identity and two immutable bound-fragment values; rendering each uploads different bytes without
    recompilation.
15. Slang reflection and the predicted nominal record layout agree before the renderer accepts the
    artifact. Wrong record schema or shader-factory identity is rejected before drawing.
16. The executable SDL2 mouse-driven Mandelbrot in
    [`v2-sdl-mandelbrot.md`](./v2-sdl-mandelbrot.md) demonstrates tail-recursive CPU event/frame
    loops, immutable environment construction, per-frame binding, and separate GPU tail recursion.
