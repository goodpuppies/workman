# Issue: close the main functional-language gaps between wmslang and GLML

## Status

Open. Wmslang V5 can compile substantial immutable fragment programs, but the source language
accepted by the GPU island is still a strict subset of ordinary Workman and a substantially smaller
functional language than GLML.

This is an umbrella issue for source-language and lowering parity. It is not a request to copy
GLML's runtime, GLSL backend, hidden recursion budget, or whole-program entry model.

## Summary

Wmslang already demonstrates the core idea shared with GLML:

- shader code is typed functional source rather than a GLSL/WGSL string;
- ordinary HM inference supplies the structural type skeleton;
- reachable helpers are specialized;
- immutable branches and a restricted ADT match lower to target control flow;
- direct self-tail recursion lowers to a loop;
- scalar/vector builtins are selected before Slang emission;
- the host and shader remain parts of one Workman program.

The remaining gap is no longer “can functional shader code work?” The gap is whether shader authors
can use the characteristic abstractions of the host language without repeatedly falling off a
small normalization whitelist.

The most important missing pieces are:

1. general monomorphized records, ADTs, and pattern matching;
2. closure conversion and defunctionalization for finite higher-order shader values;
3. GPU closure across imported Workman helpers and types;
4. fuller Workman-expression lowering, including pipes as syntax-level composition;
5. shader constraints and coercion beyond exact finite overload rows;
6. matrices and richer aggregate/numeric representations;
7. optimization sufficient to make the richer functional surface practical.

GLML comparison research already motivates the architecture in
[`markdown/wmslang/glml-research.md`](../wmslang/glml-research.md). This issue turns that research
into an implementation-facing gap list against the current V5 code.

## What “comparable to GLML” means

Comparable does not mean syntax compatibility or feature-for-feature backend parity. It means a
shader author can naturally express the same class of immutable functional programs:

- reusable polymorphic scalar/vector helpers;
- local and imported shader-capable functions;
- records and variants as ordinary intermediate shader values;
- exhaustive nested pattern matching;
- functions accepted, returned, captured, and stored in finite data;
- SDF/material/palette combinators expressed as functions rather than manually inlined branches;
- tail-recursive iteration over typed state;
- predictable numeric broadcasting and promotion;
- matrices for common graphics transformations;
- compilation to conventional first-order target code after specialization and lowering.

Workman should retain its stronger host/shader island boundary, explicit artifact selection, Slang
backend, WebGPU resource types, and explicit recursion semantics.

## Current implemented baseline

The current compiler is materially beyond the initial static V1 fragment:

- `f32` and signed `i32` scalars;
- homogeneous numeric vectors of width two through four;
- exact scalar/vector operator rows and contextual Slang builtin calls;
- explicit `Gpu.f32` and `Gpu.i32` conversions;
- one curried nominal environment containing uniform and sampled-resource fields;
- local helper discovery and HM-driven reachable specialization;
- a restricted higher-order slice when every function argument is statically known and erased;
- immutable blocks, `if`, tuples, projections, calls, and direct self-tail recursion;
- one local non-generic ADT, whose constructors are nullary or carry one `Number`;
- exhaustive one-arm-per-constructor matching for that ADT;
- sampled float `Texture2D.Sample` and exact `Load`;
- multiple selected fragments and host-owned offscreen feedback passes.

The advanced examples under `examples/wmslang_*` prove this subset is already useful. They should
remain regression fixtures while the language surface expands.

## P0: remove accidental lowering restrictions

These restrictions arise from the current schema/normalizer shape rather than an intended semantic
boundary. They should be fixed before adding substantially richer types.

### Nested block-item identity

A block item currently reserves its ID before recursively normalizing its expression. If a `let`
initializer contains a `match` whose arms contain local declarations, nested block items can consume
the reserved ID. Executable compilation then fails with a duplicate item diagnostic.

Representative source:

```wm
let color = match(result) {
  Miss => {
    let horizon = smoothstep(-0.7, 0.8, direction.y);
    background(horizon)
  },
  Hit(distance) => {
    let point = origin + direction * distance;
    shade(point)
  }
};
```

The current workaround is to extract the match into a helper whose root expression is the match.
Both forms have the same shader semantics and should normalize identically.

Expected fix:

- allocate block-item identity when the row is appended, after recursive normalization; or
- reserve an explicit placeholder in `blockItems`, as expression normalization already does; and
- add nested `let`/`if`/`match` initializer fixtures to both `check` and executable compilation.

### Syntax accepted by inference but rejected late

GPU eligibility should reject unsupported forms with a source diagnostic before artifact loading.
A valid host AST such as `Pipe`, `Record`, or unsupported pattern form should not survive until a
generic “outside the v1 expression slice” failure or schema panic.

Every intentionally unsupported form needs:

- a stable diagnostic code;
- the authored span;
- a description of the supported equivalent when one exists;
- identical behavior in `wm check`, `wm compile`, `wm run`, and LSP validation.

## P1: general monomorphized data and matches

This is the largest semantic gap for ordinary expression-heavy Workman.

### Current restriction

The normalizer currently requires:

- at most one reachable ADT;
- declaration beside the selected root;
- no type parameters;
- zero or one constructor payload;
- payload type exactly `Number`;
- exactly one match arm per constructor;
- no general record value in the GPU expression IR.

This supports `Miss | Hit<Number>` but not typical Workman or GLML modeling:

```wm
type Material =
  | Lambert<(Number, Number, Number)>
  | Metal<(Number, Number, Number), Number>;

record Ray = {
  origin: (Number, Number, Number),
  direction: (Number, Number, Number)
};
```

### Required capability

- Any finite set of reachable, non-recursive ADTs after specialization.
- Monomorphized generic ADTs such as `Option<Number>` and `Option<Vec3>`.
- Multiple constructor payloads represented as a generated product.
- Payloads containing all shader-reifiable scalar, vector, product, record, and ADT types.
- Private nominal record construction, update-free field access, and destructuring.
- Nested tuple, record, and constructor patterns.
- Existing Workman exhaustiveness and redundancy evidence retained until representation lowering.
- Match lowering that evaluates its scrutinee once and preserves expression-valued joins.

Recursive data layouts, resources inside private ADTs, and function-valued payloads may remain later
steps, but their diagnostics should be structural rather than hard-coded to “one ADT.”

### Acceptance program

A ray marcher should be able to use distinct records and variants without sentinel encodings:

```wm
type Surface = Sky | Surface<Hit, Material>;
type Material = Diffuse<Vec3> | Mirror<Vec3, Number>;

record Hit = { point: Vec3, normal: Vec3, distance: Number };

let shadeSurface = match(surface) {
  Sky => { sky(ray.direction) },
  Surface(hit, material) => { shadeMaterial(hit, material) }
};
```

## P1: real finite higher-order shader values

### Current restriction

V4 accepts a function parameter only when specialization knows its exact local helper identity and
eliminates the function value. Function values may not survive in tuples or records, escape from a
call, be selected dynamically, or be stored in an ADT. Imported helpers are not candidates.

This is useful static inlining, but it is not yet GLML-style higher-order programming.

### Required capability

Implement the finite closure pipeline already outlined by the GLML research:

```text
reachable specialization
  -> uncurry
  -> lambda lift and explicit capture records
  -> enumerate finite closure families by concrete arrow type
  -> defunctionalize into tags plus capture payloads
  -> generate apply dispatch
  -> inline/devirtualize statically known cases
```

The reachable closure set must be finite after monomorphization. Captures must be shader-reifiable,
and host/FFI/resource captures must retain the existing boundary checks.

### Acceptance ladder

1. Pass either of two local SDF functions to `union`.
2. Select a palette function with an `if` and apply it later.
3. Return a closure that captures a color or scalar parameter.
4. Store a closure in a material ADT.
5. Specialize away the tag when the concrete closure is statically known.

Representative goal:

```wm
let translate = (offset, sdf) => {
  (point) => { sdf(point - offset) }
};

let union = (left, right) => {
  (point) => { min(left(point), right(point)) }
};

let scene = union(
  translate((-1.0, 0.0, 0.0), sphere(0.7)),
  translate((1.0, 0.0, 0.0), box((0.5, 0.5, 0.5)))
);
```

## P1: shader closure across Workman modules

### Current restriction

The selected factory and GPU body must be in one module. Shader helpers must be lexically inside the
selected root. A top-level helper is rejected even in the same file, and imported helper bodies are
outside the selected lexical GPU island. The one ADT must also be declared beside the root.

This prevents an ordinary shader library from exposing reusable noise, SDF, palette, transform, or
material functions.

### Required capability

- Discover reachable Workman helper bodies by resolved binding identity across the module graph.
- Preserve module and source provenance for diagnostics and generated mappings.
- Specialize only helpers reachable from selected artifacts.
- Deduplicate the same imported specialization shared by multiple roots.
- Include imported nominal records and ADTs in private shader-data lowering.
- Reject helpers that depend on host FFI or non-reifiable captures with a complete cross-module call
  path.
- Keep unused imported code CPU-only and absent from the shader artifact.

Module support should use Workman's resolved environment and binding facts. It should not concatenate
source text, clone syntax by name, or introduce a shader-specific import system.

## P1: lower more ordinary Workman expressions

The GPU island should feel like a capability-restricted part of Workman, not a separate miniature
surface language.

### Pipe expressions

`:>` is ordinary function application syntax with a different authored order. It should desugar
before GPU functional IR construction:

```wm
point
  :> rotate(angle)
  :> translate(offset)
  :> sceneDistance
```

should have the same GPU meaning and operation facts as:

```wm
sceneDistance(translate(rotate(point, angle), offset))
```

Carrier-aware pipes remain host-only unless a separate pure shader carrier design exists. Supporting
ordinary direct-call pipes does not imply GPU `Task`, `Result`, FFI, or effects.

### General immutable blocks

Remove the normalization restriction of one non-recursive binding per `let` declaration when the
ordinary binder has already resolved all patterns. Grouped immutable bindings can lower in declared
evaluation order. Local recursive function groups remain governed by recursion capability.

### Pattern-directed helpers

First-class `match` syntax is lambda sugar in Workman. After general ADT/pattern lowering exists, a
local `match` helper should compile like its explicit lambda expansion when its function identity is
statically reachable.

### Still intentionally host-only

The following need not become shader features for GLML comparability:

- strings and interpolation;
- JS/JSON literals and FFI;
- `Task`, runtime `Result` errors, printing, filesystem/network operations;
- arbitrary lists or recursively allocated host data;
- `Panic` as a target exception mechanism.

## P1: constrained numeric inference and promotion

### Current restriction

V5 uses exact finite operation rows over:

```text
f32, i32,
f32x2..f32x4,
i32x2..i32x4
```

Integral and decimal literals seed different representations. Mixed `i32`/`f32` operations are
rejected unless the author inserts `Gpu.i32` or `Gpu.f32`. There is no `u32`, matrix kind, or general
promotion relation.

Strictness is predictable, but it makes common GLML/GLSL-style numeric helpers noisy and limits the
constraint vocabulary available to generalized schemes.

### Required capability

- Carry shader constraints alongside generalized Workman schemes.
- Represent at least numeric, float-like, integer-like, comparable, broadcast, multiply, and
  coercion relations.
- Materialize every accepted coercion explicitly in typed shader IR.
- Define literal and promotion policy once; do not let Slang silently choose Workman semantics.
- Add `u32` where WebGPU indexing and dimensions require it.
- Preserve precise diagnostics showing the selected or failed constraint row.

Automatic promotion should be narrow and specified. “Comparable to GLML” does not require accepting
every conversion Slang happens to support.

## P1/P2: matrices and richer shader aggregates

Matrices are a central graphics abstraction and a conspicuous gap relative to GLML. They are also a
prerequisite for comfortable authored vertex work later, even though GLML itself is fragment-first.

Required design work:

- a distinct matrix representation rather than ambiguous nested tuples;
- dimensions and scalar-kind constraints;
- matrix/matrix, matrix/vector, vector/matrix, and scalar broadcast rules;
- constructors, indexing, transpose, determinant, and supported inverse behavior;
- uniform/reflection layout and host packing;
- precise WGSL target capability validation.

Do not infer every nested tuple as a matrix. Matrix identity must survive inference, specialization,
reflection, and diagnostics.

After matrices, consider `u32`, `f16`, integer vectors beyond current uses, fixed shader arrays, and
broader swizzle syntax according to demonstrated programs rather than catalog availability alone.

## P2: optimization needed for functional abstraction

GLML's source expressiveness depends on compilation passes that remove abstraction cost. Wmslang can
add semantic support before optimizing it, but parity is not practical if closure tags, ADT payload
structs, helper calls, and repeated immutable expressions produce unmanageably large shaders.

The useful sequence is:

1. typed functional IR;
2. specialization and coercion materialization;
3. record/ADT/closure representation lowering;
4. ANF or equivalent explicit control-flow IR;
5. constant folding and propagation;
6. dead-code and dead-field elimination;
7. direct-call and statically known closure inlining;
8. devirtualization of single-constructor closure families;
9. common-subexpression elimination where target semantics permit it;
10. Slang optimization and target legalization.

Source semantics and diagnostics must not depend on an optimization firing.

## Resource and stage features are a separate axis

GLML is not the right parity target for broad WebGPU resources or shader stages. Current wmslang V5
already has a more explicit host/resource boundary for sampled textures, offscreen targets, and
feedback. Compute shaders, storage buffers/textures, atomics, authored vertex stages, and general
bind groups are important future graphics features, but they are not required to close the main
functional-language gap to GLML.

Track those features separately so this issue remains answerable: can Workman express GLML-class
functional fragment programs naturally?

## Proposed implementation order

### Milestone F0: correctness and syntax equivalence

- Fix nested block-item identity.
- Make `check`, `compile`, `run`, and LSP agree on GPU normalization failures.
- Desugar ordinary direct-call pipes into the existing call representation.
- Accept grouped immutable local bindings.

### Milestone F1: data-language breadth

- Multiple local monomorphic ADTs.
- Multiple reifiable constructor payloads.
- Private records and nested product patterns.
- Monomorphized generic ADTs.
- General exhaustive match lowering.

### Milestone F2: reusable shader libraries

- Reachable top-level helpers in the root module.
- Imported helper closure by binding identity.
- Imported private records and ADTs.
- Cross-module specialization deduplication and diagnostics.

### Milestone F3: higher-order parity

- Lambda lifting and capture records.
- Finite closure-family construction.
- Defunctionalized apply dispatch.
- Returned, selected, and ADT-stored shader functions.
- Static devirtualization.

### Milestone F4: numeric and graphics algebra

- Generalized GPU constraint schemes.
- Explicit narrow promotion/coercion policy.
- `u32` where required.
- Matrix representation, operations, uniform layout, and reflection.

### Milestone F5: practical optimization

- ANF/control-flow cleanup.
- Constant/dead-code/dead-field passes.
- Inlining, devirtualization, and size/performance baselines.

## Acceptance suite

Parity should be demonstrated by programs, not only isolated IR fixtures.

1. **Polymorphic scale** — one helper specialized for scalar, `vec2`, and `vec3`.
2. **Piped SDF composition** — direct-call pipes produce the same IR as nested calls.
3. **Typed ray result** — multiple records and ADTs describe hits and materials.
4. **Imported noise library** — a root imports and specializes reusable shader helpers.
5. **SDF closures** — translate, union, and smooth-union accept and return functions.
6. **Material closures** — an ADT stores a finite shader closure and dispatches through match.
7. **Matrix camera** — a uniform matrix transforms rays with reflected layout evidence.
8. **Mandelbrot/Option** — tail recursion returns a monomorphized generic option.
9. **GLML raymarch port** — recognizable source without manual sentinel or scalar expansion.
10. **Existing V5 feedback corpus** — all current texture and simulation examples remain unchanged.

For each acceptance program, snapshot:

- resolved Workman binding/type facts;
- specialized functional IR;
- lowered ADT/closure/control-flow IR;
- generated Slang;
- generated WGSL and reflection;
- one rendered checksum or pixel assertion where deterministic.

## Completion criteria

This umbrella issue is complete when:

- the F0–F4 acceptance programs compile without application-specific compiler hooks;
- shader authors can place reusable pure helpers and data declarations in ordinary Workman modules;
- finite records, ADTs, nested matches, and closure values survive source typing and are lowered
  systematically;
- common expression-oriented Workman composition no longer requires manual rewriting solely because
  it occurs inside `@gpu`;
- numeric coercions and matrix operations have explicit Workman-owned semantics;
- diagnostics remain source-anchored across modules and lowering phases;
- current V5 resource and feedback examples remain valid;
- the remaining differences from GLML are deliberate and documented rather than consequences of
  one-off V1 schema restrictions.

## Non-goals

- Replacing Slang with GLSL emission.
- Copying GLML's hard-coded `main : vec2 -> vec4` whole-program model.
- Copying GLML's silent 1000-iteration recursion fallback.
- Making host effects or JS FFI executable on the GPU.
- Treating every Slang builtin or target feature as automatically available in Workman.
- Blocking functional-language progress on compute, storage-resource, or authored-stage design.

