# GLML research for wmslang

Scope note: GLML demonstrates a valuable long-term functional shader design, but it is not the v1
feature checklist. The narrower release contract is [`v1-scope.md`](./v1-scope.md). Automatic
coercion, higher-order shader values, and optimization described here are intentionally post-v1;
finite ADTs, immutable semantics, and direct tail recursion remain the parts promoted into v1. Their
restricted Workman-specific rules are fixed in [`v1-scope.md`](./v1-scope.md); the broader lowering
design remains in [`v1-functional-lowering.md`](./v1-functional-lowering.md). V1 also follows GLML's
useful low-level entry convention of passing raw fragment pixel coordinates. Its static acceptance
shader uses authored dimensions directly; explicit resolution/time uniforms are the next resource
slice rather than compiler-inserted coordinate magic.

Status: compiler and language-design comparison against the local GLML checkout. GLML is a much
closer semantic reference than TypeGPU because it is an immutable HM language with recursion,
higher-order functions, records, polymorphic ADTs, and pattern matching that compiles to shaders.

Relevant local sources:

- [compiler pipeline](../../research/GLML/compiler/glml_compiler.ml)
- [typed AST and HM inference](../../research/GLML/compiler/typecheck.ml)
- [shader constraints](../../research/GLML/compiler/type_system.mli)
- [constraint solver](../../research/GLML/compiler/constraint_solver.ml)
- [integer promotion](../../research/GLML/compiler/promote_ints.ml)
- [monomorphization](../../research/GLML/compiler/monomorphize.ml)
- [tuple lowering](../../research/GLML/compiler/lower_tuples.ml)
- [lambda lifting](../../research/GLML/compiler/lambda_lift.ml)
- [defunctionalization](../../research/GLML/compiler/defunctionalize.ml)
- [variant lowering](../../research/GLML/compiler/lower_variants.ml)
- [ANF conversion](../../research/GLML/compiler/anf.ml)
- [tail-call lowering](../../research/GLML/compiler/tail_call.ml)
- [GLSL translation](../../research/GLML/compiler/translate.ml)
- [creative examples](../../research/GLML/examples)

## Executive conclusion

GLML validates the ambitious part of wmslang: an immutable, inferred, higher-order functional shader
language is practical. Shader authoring does not need to resemble GLSL, WGSL, or Slang to produce
conventional target code.

Its strongest lessons are:

1. Extend HM inference with deferred shader constraints instead of encoding every overload as a
   fixed basis function.
2. Preserve a typed functional IR through specialization, tuple/ADT handling, and closure
   conversion.
3. Introduce ANF, assignments, switches, and loops only in a later lowered IR.
4. Monomorphize constrained polymorphism before target lowering.
5. Lower finite ADTs to tagged data plus ordinary control flow.
6. Higher-order functions can be supported through lambda lifting and defunctionalization.
7. Tail recursion is a sound source-level loop model, but its exhaustion behavior must be explicit.

GLML should not be copied wholesale. It is an entire shader module language rather than an island
inside a host language; it hardcodes a fragment entry point, has a small resource model, defaults
recursion to a hidden 1000-iteration budget, uses explicit vector syntax distinct from tuples, and
targets a narrower numeric universe than Slang.

The most important change to the current wmslang plan is to define **two shader IR levels**:

```text
typed functional wmslang IR
  -> specialization / ADT and closure lowering
  -> lowered first-order control-flow IR (ANF + loops + switches)
  -> Slang target AST/text
```

The canonical IR should not contain mutation merely because Slang eventually will.

## GLML's compiler pipeline

GLML uses a long sequence of small passes:

```text
parse
  -> desugar
  -> uniquify
  -> HM typecheck with shader constraints
  -> erase module abstraction
  -> materialize int-to-float promotions
  -> monomorphize
  -> lower tuples to records
  -> uncurry
  -> lambda lift
  -> defunctionalize higher-order values
  -> lower variants and pattern matches
  -> ANF
  -> optimize
  -> lift non-constant globals
  -> lower tail recursion to bounded loops
  -> translate to GLSL AST
  -> patch fragment `main`
  -> print GLSL
```

This phase ordering is more valuable to wmslang than any individual surface syntax choice. It avoids
making one emitter responsible for inference, closures, ADTs, recursion, and target syntax.

TypeGPU largely interprets its untyped Tinyest tree into typed snippets while generating code. GLML
instead finishes progressively stronger whole-program representations before emitting GLSL. wmslang
should follow the latter model because Workman already owns static typing and compilation.

## Shader-aware HM inference

GLML implements Algorithm W with a constraint language layered on top of ordinary equality
unification. Its constraints include:

```text
Eq(a, b)
HasClass(class, type)
Broadcast(left, right, result)
MulBroadcast(left, right, result)
IndexAccess(container, index, result)
FieldAccess(record, field, result)
Coerce(source, target)
```

The type classes include generic float/vector types, integer types, boolean types, matrices, numeric
types, comparable types, and equatable types.

This solves several shader-language problems without contaminating the basic unifier:

- `float + vec3` produces `vec3`;
- `vec3 * float` produces `vec3`;
- matrix/vector multiplication has different result-shape rules from component-wise arithmetic;
- `sin` works for scalar or vector floating values;
- `length` accepts a suitable vector and returns a scalar;
- integer values can be promoted to float where required;
- a polymorphic helper such as `scale x = x * 2.0 - 1.0` can be used for scalars and vectors;
- constraints can remain attached to generalized schemes until a concrete use specializes them.

This is a better reference for wmslang than adding separate overloads for every tuple width and
numeric combination to Workman's global environment.

## Recommended Workman integration

Workman's ordinary HM result should still own structural program typing: functions, records, tuples,
ADTs, branches, and bindings. wmslang should add a parallel GPU constraint/refinement layer for
operations whose shader representation is more precise than Workman's public types.

An illustrative constraint set is:

```ts
type GpuConstraint =
  | { kind: "Scalar"; value: GpuTypeVar }
  | { kind: "Numeric"; value: GpuTypeVar }
  | { kind: "FloatLike"; value: GpuTypeVar }
  | { kind: "IntegerLike"; value: GpuTypeVar }
  | {
    kind: "Broadcast";
    left: GpuTypeRef;
    right: GpuTypeRef;
    result: GpuTypeRef;
  }
  | {
    kind: "Multiply";
    left: GpuTypeRef;
    right: GpuTypeRef;
    result: GpuTypeRef;
  }
  | { kind: "Coerce"; from: GpuTypeRef; to: GpuTypeRef }
  | { kind: "VectorCandidate"; tuple: Ty; width: 2 | 3 | 4; element: GpuTypeRef }
  | { kind: "Intrinsic"; intrinsic: GpuIntrinsic; args: GpuTypeRef[]; result: GpuTypeRef };
```

The exact private Workman ADT encoding needs a spike, but the architectural representation is fixed
as parallel GPU constraint and representation facts. Its required properties are:

- constraints are emitted only while using the GPU typing dialect;
- constraints can be generalized with a GPU-capable function and instantiated at each
  specialization;
- ordinary host inference does not acquire Slang-specific scalar types;
- the shader refinement solver can distinguish `float`, `int`, and `uint` underneath Workman's
  broader `Number`;
- resolved results are recorded as facts consumed by typed wmslang IR construction;
- constraint errors retain Workman source spans.

This is not a second HM checker. It is analogous to GLML's shader-specific constraints, but it uses
Workman's existing HM types as the structural skeleton.

## Numeric literals and promotion

GLML has separate `Int` and `Float` syntax nodes. Integer literals begin as `int`; float literals
begin as `float`. A coercion lattice permits `int <: float`. The solver delays coercion involving
type variables to avoid prematurely fixing a polymorphic value to `int`, computes least upper
bounds, and then a later pass inserts concrete float constructors or rewrites integer literals.

This yields pleasant creative code:

```text
[0, 0, -6]                -- can become a float vector from context
2 * [0.5, 0.5, 0.5]      -- scalar/vector broadcast with promotion
sin n                     -- promotes an integer value for a float intrinsic
```

Workman currently has one public `Number` type. The GLML comparison suggests the following design:

1. Keep ordinary Workman `Number` unchanged.
2. Preserve literal spelling/kind in source facts (`1`, `1.0`, exponent form).
3. Allocate GPU numeric refinement variables for numeric expressions inside `@gpu`.
4. Emit constraints from operators, intrinsics, indexing, resources, and stage IO.
5. Solve concrete scalar kind and width before wmslang IR construction.
6. Insert explicit conversions in typed functional IR or a dedicated coercion-materialization pass.

Initial GPU numeric kinds should be:

```text
abstract integral literal
abstract decimal literal
i32
u32
f32
```

`f16` can be added when resource/layout and target capability policy exists. The abstract kinds do
not need to appear in user-facing Workman types.

Recommended defaults after constraints:

- decimal/exponent syntax defaults to `f32`;
- integral syntax defaults to `i32`;
- creative vector arithmetic with any float demand promotes compatible integral components to `f32`;
- indexing, dispatch IDs, bit operations, and resource dimensions require explicit integer evidence
  and choose signedness from their operation;
- no implicit float-to-int conversion.

Unlike GLML, wmslang must model `u32` because WebGPU builtins, indexing, layouts, and Slang/WGSL
APIs use unsigned values extensively.

## Vectors versus tuples

GLML avoids ambiguity through syntax:

- `[a, b, c]` is a homogeneous vector;
- `(a, b, c)` is a product tuple.

Its type system likewise distinguishes `TyVec` from `TyTuple` before lowering. Product tuples later
become generated records; vectors become native GLSL vectors.

Workman deliberately wants `(a, b, c)` to be the pleasant `float3` spelling inside shaders. That
means type shape alone is not quite enough: the same structural tuple can represent a product in
host code and a vector in shader code.

Recommended rule:

- a homogeneous numeric tuple of width 2-4 is a **vector candidate** in GPU analysis;
- vector operators, swizzles, vector intrinsics, stage IO, or resource types force vector
  representation;
- when a GPU-only homogeneous numeric tuple remains otherwise ambiguous, default it to a vector for
  creative-code ergonomics;
- heterogeneous tuples remain products;
- a product tuple lowers to a generated struct in shader code;
- vector/product choice is recorded as a GPU representation fact and survives through bindings and
  function specialization;
- if users eventually need a homogeneous numeric product distinct from a vector, add an explicit
  record/newtype mechanism rather than weakening the common tuple-vector default.

Thus the remaining implementation question is no longer “type shape or fact?” The design needs both:
type shape identifies candidates, and a representation constraint/fact records the decision.

## Immutability and target mutation

GLML source has immutable `let`, expression-valued `if` and `match`, and recursion rather than
source loops. Nevertheless, its generated GLSL contains mutable locals, result temporaries,
parameter reassignment, switches, and `for` loops.

The compiler introduces these only after:

- typing;
- specialization;
- closure conversion;
- ADT lowering;
- ANF conversion.

This separation is the right model for wmslang:

### Typed functional IR

Represents the source semantics:

- literals and resolved values;
- immutable `let`;
- lambdas and calls;
- records, tuples, vectors, and variants;
- expression-valued `if` and `match`;
- explicit coercions;
- direct tail-call markers;
- typed captures and intrinsics.

### Lowered control-flow IR

Represents backend-relevant execution:

- atoms and let-bound operations (ANF or similar);
- first-order specialized calls;
- structs and tagged variant values;
- branch destinations/result slots;
- switches;
- parameterized loops and `continue` state;
- explicit local mutation introduced by lowering;
- resource operations and address-space facts.

Slang generation consumes the second IR. Workman diagnostics and most semantic tests target the
first.

This refines the earlier wmslang plan: `Loop` belongs in lowered control-flow IR, not necessarily in
the canonical typed functional expression union.

## Tail recursion

GLML marks recursive definitions, verifies that self-calls occur only in tail position, converts
tail calls into `Continue(args)`, and wraps the function body in a loop. It correctly uses
temporaries when new arguments depend on parameters that are also being overwritten.

For example, a functional factorial becomes conceptually:

```text
loop (n, acc):
  if n == 0:
    return acc
  else:
    continue (n - 1, acc * n)
```

This strongly validates the Workman tail-call plan and provides concrete implementation tests:

- self-call identity must be resolved, not textual;
- calls nested in non-tail let-bound expressions are rejected;
- both `if` and lowered `match` branches preserve tail position;
- next-state arguments are evaluated under the old environment;
- structs and vectors need valid fallback/control-flow handling;
- `main`/entry wrappers should not themselves be recursive.

The implemented static slice makes one intentional staging change from GLML. GLML discovers and
patches recursive returns after ANF; wmslang marks resolved direct self-calls in its typed
functional IR before ANF. This lets source diagnostics retain the exact recursive call span and
leaves S3 free to lower an already validated `tail-call` node into simultaneous loop-parameter
updates. As in GLML, conditions, operands, arguments, and let initializers are non-tail; unlike
GLML, wmslang will not add an iteration counter or type-directed zero fallback.

### Where wmslang should differ

GLML silently gives every recursive function a 1000-iteration loop and returns a type-directed zero
value if the limit is exceeded. This prevents unbounded target loops but changes program semantics
in a surprising way.

wmslang should not silently return zero. The alternatives considered were:

1. Generate an unbounded loop and require the program's own tail-recursive state to establish its
   exit condition.
2. Require or infer a compile-time maximum for GPU recursion and require an explicit fallback
   result.
3. Provide a typed standard helper for bounded iteration while leaving plain tail recursion
   semantically unbounded.

Decision: lower plain direct tail recursion to a normal unbounded Slang loop with no hidden semantic
fallback or compiler budget. Add static diagnostics for obviously unconditional recursion and
document GPU watchdog risks. A future bounded-iteration helper must be explicit and does not change
plain tail-recursion semantics.

## ADTs and pattern matching

GLML supports polymorphic records and variants such as:

```text
type option['a] = Some of 'a | None

type material =
  | Lambert of albedo_fn
  | Phong of albedo_fn * float
```

It performs exhaustiveness and redundancy checking while types are still rich. After
monomorphization, variants become structs containing:

- an integer constructor tag;
- payload slots shared across constructors when their lowered types and positions allow it.

Pattern matches become `if`/`switch` control flow with payload-field extraction. Product tuples are
first lowered to generated records, so the variant pass only handles a smaller set of data shapes.

This suggests that suitable Workman ADTs should be a real wmslang feature, not distant syntax
breadth. Workman already owns ADT typing and match diagnostics; wmslang mainly needs representation
and lowering.

Initial GPU ADT restrictions should be:

- the ADT is closed and fully known at specialization time;
- every used type parameter is monomorphized;
- payload fields have shader-reifiable types;
- recursive data layouts are rejected initially;
- pattern matching remains exhaustive under normal Workman rules;
- ADTs crossing resource/uniform ABI boundaries are deferred until layout rules are explicit;
- function-valued payloads wait for closure defunctionalization support.

The portable representation should be an explicit tag plus payload struct, even if Slang offers
richer source constructs. This produces predictable WGSL and reflection.

An optimization can later specialize away tags when the constructor is statically known, as many
GLML examples do after constant folding and inlining.

## Higher-order functions and closures

GLML goes considerably beyond first-order shader helpers. Its examples and tests include:

- functions passed to `apply` and `map`;
- local lambdas;
- captured shader values;
- functions returning closures;
- partial application;
- ADTs containing function values;
- SDF combinators and material functions.

The compiler supports this through:

1. monomorphization;
2. uncurrying;
3. lambda lifting with captured variables;
4. defunctionalization by arrow type;
5. a generated variant representing the finite set of closures;
6. generated apply functions dispatching by closure tag;
7. optimization/devirtualization when the concrete function is statically known.

This matters to wmslang's product identity. A “functional shader language” limited permanently to
first-order calls would miss pleasant creative patterns such as:

```text
makePalette(config) -> color function
union(sdfA, sdfB) -> SDF
mapColor(transform, material)
chooseMaterial(condition, materialA, materialB)
```

Recommendation:

- keep the first executable H1 spike first-order for scope;
- design typed functional IR with lambdas and function-valued terms from the start;
- add closure conversion and defunctionalization before broad resources and production effects;
- require the reachable closure set to be finite after specialization;
- specialize/devirtualize direct known calls before allocating closure structs;
- reject closures that capture CPU-only or non-reifiable values using the normal capture classifier;
- key closure constructors by resolved lambda identity and specialization, never textual names.

This is more work than generating direct Slang functions, but GLML demonstrates that it composes
with HM, ADTs, and immutable source semantics.

## Monomorphization

GLML preserves constraints inside generalized schemes and creates concrete function specializations
from observed uses. It registers a specialization before recursively processing its dependencies,
which acts as a cycle guard for recursive functions.

wmslang needs the analogous key:

```text
(BindingId, concrete GPU function type, compile-time specialization captures)
```

The specialization pass should:

- begin only from selected entry points/artifact roots;
- instantiate Workman schemes and associated GPU constraints;
- solve numeric/vector representation;
- recursively enqueue reachable GPU functions;
- register before descending to support direct recursion;
- generate deterministic `GpuSpecializationId`s and names;
- deduplicate the same specialization reached from multiple roots;
- retain a mapping back to the source binding and type instantiation.

The bootstrap now implements the representation-level subset of this algorithm. It starts from GPU
roots, solves a concrete `i32`/`f32` overlay per function instance, registers the instance before
walking calls, reuses equal signatures across roots, and emits explicit root/call-target mappings.
This proves the recursion guard and prevents cross-instance representation widening. It does not yet
instantiate general Workman type variables, parametrized ADT shapes, or varying static capture
values; those require the parallel `GpuScheme` and richer specialization key described above.

The same bootstrap stage now produces a distinct typed functional expression graph per
specialization. Concrete representation overlays are applied while cloning; direct calls point to
specialization IDs; and resolved variables are classified as locals, captures, or function
dependencies. This intentionally mirrors GLML's typed-term ownership before ANF rather than its
later GLSL statement form. Backend temporaries, assignments, and loops are therefore still absent
from the canonical graph.

This is the correct place to finalize polymorphic ADT layouts and closure arrow families.

Unlike GLML, Workman libraries may contain GPU-capable functions that are never used by any shader
artifact. They must not be monomorphized or sent to Slang merely because their module was imported.

## Pattern compilation

GLML uses a pattern-matrix style analysis/lowering strategy and performs usefulness checks for
redundant and non-exhaustive arms before variants disappear. It later chooses switches for finite
integer/tag domains and nested conditions for other patterns.

Workman should preserve its existing match typing and diagnostics, then add a GPU lowering pass that
consumes already-resolved patterns. Useful principles to borrow:

- evaluate the scrutinee once;
- compile nested patterns through projections of stable temporaries;
- select a switch only when the target type has a suitable finite/integer tag;
- preserve expression-valued match results using a result join in lowered IR;
- perform ADT representation lowering after exhaustiveness information has served its purpose;
- keep generated tag and payload details out of the source type checker.

## Constant folding and global values

GLML runs constant folding, common-subexpression elimination, dead-code elimination, and inlining on
ANF. It also distinguishes top-level expressions that can become GLSL constants from those that must
become zero-argument functions.

wmslang should initially use conservative compile-time evaluation:

- literals, vector/record/ADT constructors, and pure scalar/vector intrinsics when all operands are
  known;
- no arbitrary execution of host or FFI code;
- captured host constants must have a stable compiler-known value;
- non-constant runtime captures become uniform/resource inputs;
- constant folding happens after specialization and coercion materialization, when shader numeric
  semantics are known.

This gains most creative-shader value without TypeGPU's runtime slot/lazy system.

## What GLML proves through creative examples

The examples are unusually relevant acceptance tests:

- Mandelbrot uses a recursive loop returning `option` and matches it into color.
- Ray marching combines recursion, vector broadcasting, uniforms, and `option[float]`.
- SDF composition passes and returns functions.
- Materials store closures inside ADTs and dispatch through pattern matching.
- Palettes rely on inferred vector/scalar broadcasting.
- Pipelines of immutable functions build complex images without source mutation.
- Local shadowing is used naturally to describe successive transformed values.

These should inspire wmslang test fixtures more than GLML's fragment-only host interface should
inspire its API.

Recommended creative acceptance ladder additions:

```text
G0  polymorphic scalar/vector `scale`
G1  ray-march tail recursion returning Option<Number>
G2  pattern match over Option into a color vector
G3  SDF combinator accepting two functions
G4  palette factory returning a closure
G5  material ADT containing a shader function
```

Each test should snapshot typed functional IR, lowered control-flow IR, and generated Slang.

## Important GLML limitations not to inherit

### Whole-program shader language

GLML compiles an entire source program as a fragment shader. wmslang must remain a local domain
inside host Workman code with typed captures and explicit artifact roots.

### Hardcoded entry point

GLML requires `main : vec2 -> vec4` and patches it to `gl_FragCoord`/`fragColor`. wmslang should use
typed host-side stage constructors and Slang semantics, not a Shadertoy-shaped language rule.

### Hidden recursion budget

The default 1000 iterations plus a zero-value fallback is pragmatic but semantically surprising.

### Narrow numerics

GLML primarily models `int`, `float`, float vectors, and float matrices. wmslang must include `u32`
and eventually `f16`, integer vectors, and target capability constraints.

### Narrow resources

GLML externals become uniforms and it special-cases a sampler/texture operation. Workman's typed
WebGPU boundary needs buffers, textures, samplers, mutability, layout, and reflection evidence.

### Explicit vector syntax

GLML gets vector/product disambiguation from `[]` versus `()`. Workman intentionally chooses more
contextual tuple-vector inference and therefore needs representation constraints.

### Potential representation cost

Generic tagged structs and defunctionalized closures can inflate shader data and control flow.
wmslang should specialize, inline, and devirtualize before committing to runtime tags.

## Adopt, adapt, avoid

### Adopt

- constrained HM schemes for shader operations;
- monomorphization from reachable roots;
- typed functional IR before target lowering;
- a later ANF/control-flow IR;
- explicit coercion materialization;
- tail-call-to-loop transformation;
- ADT exhaustiveness before representation erasure;
- tagged ADT lowering;
- closure conversion/defunctionalization as the path to higher-order shaders;
- small composable compiler passes with snapshots.

### Adapt

- use Workman tuples as contextually inferred vectors instead of adding GLML bracket syntax;
- refine `Number` in GPU facts instead of changing all host numerics;
- include `u32` and Slang target capabilities;
- classify lexical captures instead of declaring global shader externs;
- select entry points through typed host values;
- make loop exhaustion semantics explicit;
- compile only reachable shader islands rather than the whole module.

### Avoid

- a fixed Shadertoy entry signature;
- a hidden recursion sentinel;
- treating every imported GPU-capable function as an emitted shader function;
- lowering immutability away too early;
- exposing generated ADT tags or closure structs to Workman users;
- making Slang reflection responsible for source inference;
- copying GLML's narrower GLSL type universe.

## Decisions changed or narrowed by this research

### Shader IR levels

Decision: use a typed functional wmslang IR and a separate lowered control-flow IR. Slang generation
consumes the latter.

### Numeric inference

Direction: add deferred GPU constraints and a coercion-materialization pass. Preserve ordinary
Workman `Number`, but solve concrete shader scalar kinds before typed IR is finalized.

### Tuple/vector representation

Direction: homogeneous numeric tuples are vector candidates. Type shape identifies the candidate;
GPU constraints and a persistent representation fact choose vector versus product. Ambiguous
GPU-only candidates default to vectors.

### ADTs

Direction: finite monomorphized ADTs and pattern matching belong in the core functional-shader
roadmap, not only a late “creative breadth” phase. Initial lowering uses tagged payload structs.

### Higher-order functions

Direction: first-order H1 remains the implementation bootstrap, but the IR must support lambdas and
function-valued terms. Closure conversion and defunctionalization should precede broad resource and
effect features.

### Tail recursion

Decision: use explicit unbounded parameterized loops in lowered IR and reject non-tail recursion. Do
not copy GLML's silent zero fallback or insert a hidden loop budget.

### Specialization

Direction: specialize reachable functions before ADT, closure, and control-flow lowering. Carry
generalized GPU constraints alongside function capability facts.

## Questions resolved by the consolidated plan

1. Generalized GPU constraints attach as `GpuScheme` facts keyed by resolved helper identity and do
   not alter ordinary imported/host schemes.
2. Literal and constraint seeds survive frontend-v1 in the final elaboration DTO; solving occurs
   after the final FFI/HM pass, not during every partial pass. Frontend-v2 is not a wmslang target.
3. Homogeneous numeric tuples of width 2-4 default to vectors in GPU code and carry a persistent
   representation fact; private heterogeneous products do not cross an initial ABI.
4. The first ADT subset excludes function/resource payloads. Function payloads arrive only with
   finite closure conversion and defunctionalization.
5. Reachable helpers are monomorphized before lowering; using Slang generics later is only a backend
   optimization and cannot change Workman semantics.
6. Plain direct tail recursion is an unbounded loop with no hidden budget or fallback.
7. Closure/ADT lowering begins without an optimization prerequisite; snapshots and corpus benchmarks
   decide later optimization work without weakening the semantic subset.

## Recommended next compiler spike

The next isolated prototype should be based on GLML's `scale` example rather than WebGPU setup:

```workman
let scale = (x) => {
  @gpu;
  x * 2.0 - 1.0
};

let shader = (x) => {
  @gpu;
  let scalar = scale(x);
  let vector = scale((x, 2.0, 3.0));
  .{ scalar, vector }
};
```

It should demonstrate:

- one Workman HM scheme for `scale`;
- generalized GPU broadcast constraints associated with it;
- scalar and vector specializations;
- tuple-vector representation facts;
- inserted numeric coercions;
- typed functional IR snapshots;
- no Slang, WebGPU, resources, ADTs, or closure lowering yet.

The second spike should add a tail-recursive ray march returning Workman's existing option-like ADT,
then lower its match and recursion into the control-flow IR. Together those experiments test the two
most important GLML-derived claims without prematurely building the runtime boundary.
