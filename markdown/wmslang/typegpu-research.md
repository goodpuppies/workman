# TypeGPU research for wmslang

Status: architectural comparison against the local TypeGPU checkout. This is not a feature-parity
plan. TypeGPU is used to identify proven solutions, constraints caused by embedding in TypeScript,
and places where Workman should deliberately take a different route.

Relevant local sources:

- [`packages/tinyest`](../../research/TypeGPU/packages/tinyest/src/nodes.ts)
- [`packages/tinyest-for-wgsl`](../../research/TypeGPU/packages/tinyest-for-wgsl/src/parsers.ts)
- [`unplugin-typegpu`](../../research/TypeGPU/packages/unplugin-typegpu/src/core/factory.ts)
- [TypeGPU function resolution](../../research/TypeGPU/packages/typegpu/src/core/function/fnCore.ts)
- [TypeGPU WGSL generator](../../research/TypeGPU/packages/typegpu/src/tgsl/wgslGenerator.ts)
- [TypeGPU generator interface](../../research/TypeGPU/packages/typegpu/src/tgsl/shaderGenerator.ts)
- [`typegpu-three`](../../research/TypeGPU/packages/typegpu-three/src/typegpu-node.ts)
- [`typegpu-gl`](../../research/TypeGPU/packages/typegpu-gl/src/glslGenerator.ts)

## Executive conclusion

TypeGPU validates the overall product shape:

- host and shader code can coexist in one source file;
- a function-level directive is a pleasant domain boundary;
- shader functions can automatically discover dependencies;
- call-site specialization is practical;
- typed resource wrappers are essential;
- explicit entry-point constructors are cleaner than making every shader function an entry point;
- generated shader code and dependency metadata can remain an implementation detail.

However, Workman should **not reuse Tinyest as its wmslang IR**.

Tinyest solves a problem Workman does not have: extracting a compact, serializable subset of
JavaScript from a compiler TypeGPU does not control. It is intentionally untyped, uses string names,
models imperative JavaScript statements, and leaves most semantic work to TypeGPU's resolution and
generator layer.

Workman owns its parser, HM checker, binding resolver, Core lowering, and compiler artifacts. It can
produce a smaller and stronger **typed functional shader IR** directly, with resolved identities,
source spans, capture facts, shader types, and explicit tail-loop semantics.

The useful reuse is conceptual and test-oriented:

- directive-region extraction;
- external/capture discovery requirements;
- typed snippets as evidence that every generated value needs type and origin information;
- specialization and dependency memoization;
- typed entry-point shells and resource schemas;
- backend generator separation;
- diagnostics for unsupported host syntax.

## TypeGPU's actual compilation path

TypeGPU does not ask `tsc` for a typed shader AST. Its path is approximately:

```text
TypeScript/JavaScript source
  -> bundler plugin parses Babel/Acorn AST
  -> locate `use gpu` functions
  -> convert function body to Tinyest
  -> collect textual external property chains
  -> inject Tinyest + external getter metadata into JavaScript
  -> at shader resolution time:
       resolve runtime TypeGPU objects and schemas
       interpret Tinyest into typed snippets
       infer/coerce expression and return types
       specialize called functions by argument schemas
       collect declarations and resources
       generate WGSL (or experimental GLSL)
```

This split exists because TypeGPU does not own TypeScript compilation and some TypeGPU schemas may
only be chosen at JavaScript runtime. The TypeGPU documentation explicitly notes that TypeScript
types do not participate in WGSL generation.

Workman has no reason to reproduce that split. The compiler already has the source AST and inferred
types before JavaScript exists. Emitting an untyped AST into the JavaScript bundle only to recover
types later would discard information and move errors from compile time to runtime.

## What Tinyest is

Tinyest is a compact JavaScript-shaped syntax tree. Nodes are tuples identified by small numeric
tags. Identifiers are strings. Its statement set includes:

- blocks and returns;
- `if`;
- `let` and `const`;
- `for`, `while`, and `for-of`;
- `break` and `continue`;
- assignment and update expressions.

Its expression set includes:

- binary, logical, unary, and assignment expressions;
- member and index access;
- calls;
- arrays and objects;
- conditional expressions;
- numeric and string literals.

It does not carry:

- inferred or expected types;
- resolved binding identity;
- source spans;
- lexical capture classification;
- function capability;
- address space or resource semantics;
- specialization keys;
- tail-position information;
- a distinction between product tuples and shader vectors.

Even its numeric literals are preserved as strings mainly so later codegen can decide their shader
representation. The type is assigned by TypeGPU's generator using contextual schemas and snippets.

Tinyest is therefore closer to a compact surface AST/DTO than to the typed IR proposed for
wmslang.

## What `tinyest-for-wgsl` adds

`tinyest-for-wgsl` converts Babel or Acorn nodes into Tinyest and records external identifier
chains. It maintains lexical sets of locally declared names, but it does not perform semantic name
resolution.

For example, an external access such as `settings.palette.primary` can be flattened into one
textual external key. The bundler then emits a thunk for that key so TypeGPU can retrieve the
current JavaScript value later during shader resolution.

This machinery is necessary in TypeScript because the bundler transform cannot safely retain a
resolved compiler symbol and TypeGPU may need late-bound runtime resources.

Workman should instead use:

```text
surface reference node -> BindingId -> classified capture
```

This is both safer and simpler. Shadowing, imports, recursion, and dependency deduplication are
already compiler concepts. wmslang does not need textual external chains or runtime getter metadata.

## Where TypeGPU's real semantic IR lives

TypeGPU's closest equivalent to a typed value IR is its `Snippet` machinery, not Tinyest.

A snippet carries:

- a value or resolvable code fragment;
- a TypeGPU data schema;
- an origin, such as constant, argument, uniform, storage, workgroup, or function-local;
- possible side-effect information.

While walking Tinyest, the WGSL generator builds snippets, performs conversions, tracks mutation,
reports return types, discovers pointer/reference behavior, evaluates compile-time expressions,
and emits code. Function signatures can be specialized based on argument schemas seen at call
sites.

This contains several excellent lessons for wmslang:

1. Every shader IR value needs a concrete shader type by the time backend lowering begins.
2. Type alone is not enough for resources; storage class/capture origin matters.
3. Compile-time-known values should be distinguished from shader-runtime values.
4. Function specialization must be explicit and memoized.
5. Capture and dependency resolution should be demand-driven from selected roots.

It also exposes a boundary wmslang should improve upon. In TypeGPU, typing, partial evaluation,
mutation analysis, dependency resolution, and target text generation are substantially intertwined
inside `WgslGenerator` and `ResolutionCtx`. That makes an alternate target inherit many WGSL
assumptions.

wmslang should finish semantic analysis and typed IR construction before the Slang emitter starts.

## Why Tinyest should not be reused directly

### 1. It models the wrong source language

Tinyest mirrors JavaScript statements. Workman is expression-oriented and functional. Workman's
natural loop syntax is direct self-tail recursion, not `for`, `while`, assignment, `break`, and
`continue`.

Using Tinyest would require either:

- lowering Workman into imperative JavaScript concepts before shader analysis; or
- extending Tinyest with Workman-specific patterns, tail calls, typed tuples, and binding IDs.

The first loses useful semantics. The second effectively creates a new IR while retaining the wrong
foundation.

### 2. It is untyped

wmslang's main advantage over authoring Slang directly is Workman's type system and inference. An
untyped boundary would make the backend rediscover:

- tuple element homogeneity;
- vector widths;
- scalar precision/kind;
- function specialization;
- record layouts;
- intrinsic overloads;
- legal captures.

That duplicates the checker and weakens diagnostics.

### 3. It uses textual identity

Strings are sufficient when a bundler must serialize JavaScript metadata. They are not sufficient
for a compiler-owned capture and dependency graph. wmslang needs `BindingId`, `GpuFunctionId`, and
`GpuRegionId`.

### 4. It lacks source provenance

Slang/backend errors must map back to Workman expressions. Adding spans as an afterthought to tuple
nodes would remove much of Tinyest's compactness and still not provide inferred facts.

### 5. It exposes target-host accidents

Tinyest includes JavaScript-only distinctions and operators that WGSL later rejects or rewrites,
such as strict versus loose equality, `instanceof`, `in`, nullish operators, prefix/postfix update,
and string literals.

wmslang can make invalid states unrepresentable earlier.

### 6. Workman does not need runtime AST metadata

TypeGPU retains Tinyest in emitted JavaScript because resolution can depend on runtime schemas,
slots, accessors, and resources. The initial wmslang design compiles shader artifacts as part of the
Workman compilation. It should not ship source ASTs to the runtime unless a future runtime
specialization feature explicitly requires that tradeoff.

## What could still be reused

Direct package reuse is not recommended for the compiler pipeline, even though Tinyest is MIT
licensed. Smaller forms of reuse remain valuable:

- use Tinyest's supported-node list as a comparison checklist;
- port TypeGPU expression and capture tests into Workman-facing semantic tests;
- compare generated Slang/WGSL for equivalent small programs;
- study its compact snapshots when designing stable wmslang IR snapshots;
- borrow the separation between syntax extraction and external classification conceptually;
- use TypeGPU examples as creative-shader acceptance fixtures.

If Workman later needs to export shader functions to a JavaScript tool that already consumes
Tinyest, a one-way **typed wmslang IR -> Tinyest adapter** could be built. Tinyest should not be the
canonical representation.

## Proposed wmslang IR character

wmslang IR should describe shader semantics rather than Slang syntax or JavaScript syntax.

An illustrative shape:

```ts
type GpuValueId = number;

type GpuType =
  | { kind: "Bool" }
  | { kind: "Int"; width: 32; signed: boolean }
  | { kind: "Float"; width: 16 | 32 }
  | { kind: "Vector"; width: 2 | 3 | 4; element: GpuScalarType }
  | { kind: "Matrix"; columns: number; rows: number; element: GpuFloatType }
  | { kind: "Struct"; id: GpuStructId; fields: GpuField[] }
  | { kind: "Resource"; resource: GpuResourceType };

type GpuExpr =
  | { kind: "Const"; value: GpuConstant; type: GpuType; source: AstNode }
  | { kind: "Local"; id: GpuValueId; type: GpuType; source: AstNode }
  | { kind: "Capture"; id: CaptureId; type: GpuType; source: AstNode }
  | { kind: "Construct"; type: GpuType; args: GpuExpr[]; source: AstNode }
  | { kind: "Intrinsic"; op: GpuIntrinsic; args: GpuExpr[]; type: GpuType; source: AstNode }
  | { kind: "Call"; target: GpuSpecializationId; args: GpuExpr[]; type: GpuType; source: AstNode }
  | { kind: "Project"; value: GpuExpr; projection: GpuProjection; type: GpuType; source: AstNode }
  | { kind: "If"; cond: GpuExpr; then: GpuExpr; otherwise: GpuExpr; type: GpuType; source: AstNode }
  | { kind: "Let"; binder: GpuValue; value: GpuExpr; body: GpuExpr; type: GpuType; source: AstNode }
  | { kind: "TailCall"; target: GpuFunctionId; args: GpuExpr[]; type: GpuType; source: AstNode };
```

This is intentionally illustrative rather than a frozen schema. Its important properties are:

- every node is typed;
- local and global identity is resolved;
- source provenance is retained;
- pure expressions are natural;
- direct tail recursion remains explicit before becoming a parameterized loop in a later
  control-flow IR;
- captures are distinct from locals;
- intrinsic meaning is target-neutral;
- no node contains raw Slang text.

The GLML comparison in [`glml-research.md`](./glml-research.md) strengthens this into two levels: a
typed functional IR like the one above, followed by a first-order control-flow IR containing ANF,
switches, parameterized loops, and target-oriented mutation. The Slang backend consumes the latter;
neither representation leaks back into ordinary Workman inference.

## TypeGPU and alternate shader languages

There are two different experiments in the checkout.

### `typegpu-three`

`@typegpu/three` is an interoperability bridge with Three.js's TSL/node system. It:

- asks TypeGPU to resolve a GPU function to WGSL text;
- parses the generated WGSL function through Three's WGSL node builder;
- presents TSL nodes to TypeGPU as explicitly typed accessors;
- tracks Three node dependencies during analyze/generate phases;
- maps common TypeGPU/WGSL schema names to Three/GLSL-style type names for API calls.

It does **not** replace Tinyest with a shader-language-neutral IR, and it is not itself a general
backend abstraction. It demonstrates something still important for wmslang: typed foreign shader
values can cross a boundary through explicit accessors while each side retains its own graph.

### `typegpu-gl`

`typegpu-gl` is the actual alternate-codegen experiment. It supplies a `GlslGenerator` through
TypeGPU's unstable `ShaderGenerator` interface.

The interface abstracts several operations:

- global constant and variable declarations;
- function definitions;
- type annotation and construction;
- numeric literal emission.

However, `GlslGenerator` subclasses `WgslGenerator`, overrides selected syntax and entry-point
rules, and maps from WGSL-shaped schemas to GLSL names. The base generator still owns Tinyest body
interpretation and a large amount of WGSL-oriented semantic behavior.

This is a useful incremental seam, but not the architecture wmslang should copy. Slang is not just a
different spelling of WGSL; it has its own module, generic, overload, target, layout, and entry-point
model. wmslang should lower a completed typed semantic IR into Slang rather than subclass a WGSL
emitter.

## Slang changes the backend relationship

TypeGPU must generate target shader source itself. wmslang can delegate more work to Slang:

- overload selection after Workman has selected a wmslang intrinsic;
- legalization for WGSL/SPIR-V targets;
- target-specific feature validation;
- layout calculation and reflection;
- optimization and linking;
- entry-point target emission.

But Slang should not receive unresolved Workman concepts. Before generation, wmslang must already
know:

- which bindings and specializations are reachable;
- every expression's shader type;
- which tuple is a vector versus a product/struct;
- capture categories;
- legal tail loops;
- selected portable intrinsic semantics;
- entry-point stage and logical IO.

This makes the generated Slang conventional and inspectable while keeping Workman diagnostics in
the source language.

## Product-scope differences

TypeGPU aims to expose a large portion of WebGPU/WGSL for production graphics and compute,
including advanced resource control, pointers/references, atomics, workgroup state, layouts,
specialization, simulation, logging, slots, and runtime-selected schemas.

wmslang's initial product is deliberately narrower:

- creative fragment/compute-style shader functions;
- inferred scalar and tuple-vector math;
- pleasant functional composition;
- tail recursion as loops;
- a small typed resource boundary;
- Slang-produced WGSL for ordinary WebGPU host setup;
- strong compile-time diagnostics;
- inspectable generated code.

Therefore TypeGPU features should be classified as follows.

### Adopt early

- function-local GPU directive;
- automatic dependency reachability;
- typed stage constructors;
- typed resource evidence;
- call-site specialization;
- distinction between compile-time constants and runtime uniforms/resources;
- deterministic naming and generated-code inspection;
- source-level rejection of unsupported syntax.

### Design for, but defer

- multiple entry points sharing helpers;
- resource-layout reflection checks;
- compile-time specialization values;
- reusable abstract resource accessors;
- workgroup memory and atomics;
- matrices and broad intrinsic coverage;
- backend caching.

### Do not inherit by default

- raw Slang source escape hatches;
- runtime shader AST interpretation;
- runtime-selected shader schemas;
- a general slot/lazy/providing system;
- automatic CPU execution of every `@gpu` function;
- JavaScript mutation semantics;
- production-ML-level pointer/resource control in the first language subset;
- every WGSL/Slang construct merely because the backend supports it.

## Decisions narrowed by this research

### Canonical IR

Decision: create a Workman-owned typed wmslang IR. Do not reuse Tinyest as the canonical IR.

### GPU capability location

Decision for the first implementation: store capability facts outside the ordinary HM `Ty` union,
keyed by resolved binding/specialization identity. TypeGPU likewise treats GPU-callability as
metadata/runtime capability rather than part of TypeScript function types. Workman can do this more
statically.

Revisit only if capability polymorphism produces a concrete inference case that cannot be expressed
by post-inference constraints.

### Entry-point representation

Direction: keep `@gpu` about function eligibility/domain. Use typed host constructors or wrappers
for fragment, vertex, and compute entry points. TypeGPU's separate `fn`, `fragmentFn`, `vertexFn`,
and `computeFn` concepts support this separation.

The consolidated plan fixes the architectural API: compiler-known typed host constructors consume
GPU functions and nominal stage records. The exact initial record catalog is a Phase 6 breadth
choice, and stage configuration is never packed into untyped directive arguments.

### Specialization

Direction: specialize reachable polymorphic GPU functions by:

```text
(BindingId, concrete GPU argument types, relevant compile-time captures)
```

Unlike TypeGPU, specialization can start from HM schemes and resolved call facts rather than infer
everything while emitting target code.

### Captures

Decision: captures are statically resolved and classified. No textual external names, thunks, or
runtime getters are part of the initial design.

Capture categories remain:

- shader compile-time constant;
- runtime uniform;
- typed GPU resource;
- reachable GPU-capable function;
- illegal CPU/FFI value.

### CPU/GPU dual execution

Direction: do not promise TypeGPU-style dual execution for every `@gpu` function. TypeGPU requires
bundler operator rewriting and CPU vector implementations to preserve that promise. wmslang keeps
`@gpu` functions remain GPU-only initially, while pure ordinary helpers may be classified
`CPU + GPU`; a stage constructor separately selects an artifact root.

### Numeric literals

TypeGPU defaults integer-valued JavaScript numbers to shader integers, which means source `1.0` can
still behave as an integer after parsing. Workman owns literal syntax and should do better.

Direction for the inference spike:

- preserve whether a literal was written with a fractional/exponent form;
- infer an abstract constrained numeric type during HM checking;
- use expected operator/vector/intrinsic types before defaulting;
- default decimal-form literals toward `f32` in GPU creative-math contexts;
- default integral-form literals toward signed integer only when context does not imply float or
  unsigned;
- require evidence/casts where signedness affects resources, indexing, or bit operations.

The consolidated plan fixes constraints as parallel `GpuScheme`/expression facts solved after final
host inference and per reachable specialization. The spike may refine the closed DTO constructors
and work-list encoding, but not move shader scalar kinds into the host `Ty` union.

### Compile-time execution

Direction: distinguish constant folding from arbitrary host execution. Pure literal/constructor
expressions can be folded by the compiler. A broad `comptime` system like TypeGPU's slots and lazy
runtime resolution is out of scope initially.

### Backend abstraction

Decision: the wmslang IR expresses typed shader semantics, and Slang is the first backend. Do not
introduce a generic `ShaderGenerator` interface until a second backend exists. Keep the IR free of
Slang text so such an interface remains possible.

## Questions resolved by the consolidated plan

The later architecture review resolves the questions this comparison intentionally left open:

1. GPU constraints are parallel facts, not types inside HM, and are solved only after final host
   inference and again when generalized helpers are specialized.
2. Homogeneous numeric tuples of width 2-4 default to vectors in GPU code and retain an explicit
   representation fact.
3. Entry construction uses compiler-known typed host intrinsics and nominal stage records.
4. Resources require nominal Workman evidence wrappers over raw WebGPU objects.
5. The initial uniform policy is one reflected deterministic aggregate per entry root.
6. GPU functions are statically tracked opaque `GpuFn` values, and selected entry artifacts
   materialize as immutable runtime descriptors with dynamic captures; neither is a CPU-callable
   shader closure.
7. GPU functions cross Workman source modules and compile lazily from reachable artifact roots in
   one compiler graph. Emitted JavaScript libraries export only completed artifact descriptors.
8. Portable diagnostics stop at wmslang semantics; Slang target/capability failures form a remapped
   backend diagnostic layer.

The bootstrap fragment case is fixed by H3 in the main plan. Exact names for the broader
stage/resource catalog remain milestone-level API breadth, not architectural decisions.

## Recommended next spike

Build no WebGPU runtime yet. Implement a paper/test IR spike for three functions:

```workman
let palette = (t) => {
  @gpu;
  (0.5, 0.5, 0.5) + (0.5, 0.5, 0.5) * cos(t)
};

let shade = (uv, time) => {
  @gpu;
  let wave = sin(uv.x * 8.0 + time);
  (palette(wave), 1.0)
};

let repeat = (i, color) => {
  @gpu;
  if i <= 0 then color else repeat(i - 1, color * 0.9)
};
```

The spike should produce:

- resolved binding/capture facts;
- constrained and then reified scalar/vector types;
- two or three function specialization records;
- a typed functional IR snapshot;
- an explicit loop node for `repeat`;
- generated Slang text;
- no Tinyest, Core, WebGPU, or Slang reflection dependency.

That will test the architectural difference that matters most: whether Workman's own types can make
the intermediate representation simpler than TypeGPU's runtime Tinyest-plus-snippet pipeline.
