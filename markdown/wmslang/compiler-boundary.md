# wmslang compiler boundary

Status: architecture audit based on the current Workman compiler. This document answers where
`@gpu;` should enter the compiler, what it should reuse, and which existing boundaries need to be
strengthened before implementation.

## Decision

Treat an `@gpu;` lambda as an **elaboration island** inside a normal Workman module.

It is not:

- a module mode;
- a second source language parser;
- raw Slang embedded in Workman;
- a new branch in every compiler phase;
- or a copy of the Workman HM checker.

The island shares Workman syntax and HM inference machinery. It switches to a small, scoped GPU
typing dialect while its body is inferred. After final host/FFI inference, a separate wmslang
analysis owns shader capabilities, captures, typed shader IR, tail-call lowering, Slang generation,
and shader artifacts.

The important ownership rule is:

> Host transformations may observe that an `@gpu` region exists, but they must not reinterpret or
> rewrite the inside of that region.

This is the practical meaning of a directive “stepping into another dimension.”

## Why the TypeScript FFI is not the model

The TypeScript/JavaScript FFI is intentionally a core-language integration. In the current compiler
it crosses nearly every semantic layer:

- surface AST nodes include `JsImportDecl`, `ForeignTypeDecl`, `FfiGet`, `FfiCall`, and
  `FfiBindingCall`;
- FFI elaboration rewrites ordinary expression trees before inference;
- staged analysis runs partial inference several times to resolve reflected calls contextually;
- `Ty` has an `ffi` placeholder variant;
- unification and final inference know about unresolved JS-boundary types;
- lambda inference tracks callback obligations;
- Core contains JS imports and rejects unresolved FFI nodes;
- JavaScript emission directly owns the resulting runtime boundary.

That depth is appropriate because JS interoperability is pervasive host semantics. Almost every
Workman program can import and use JS values, and JS types must participate directly in ordinary
Workman inference.

wmslang has the opposite requirement. Shader code is locally delimited and should have one clear
semantic owner. Copying the FFI architecture would make `@gpu` a permanent condition in the AST,
type algebra, unifier, staged analyzer, Core IR, and JS emitter.

## Current compiler boundary audit

| Area                  | Current shape                                                    | Consequence for wmslang                                                          |
| --------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Parsing               | Produces one surface `Module`                                    | Good place to preserve lambda directives                                         |
| FFI preparation       | Uses shared traversal and leaves marked lambda bodies opaque     | Host FFI no longer reinterprets shader syntax                                    |
| HM inference          | Scoped GPU dialect plus compiler-owned `Gpu` basis identities    | Reuses ordinary HM shapes while preserving closed operation identity             |
| Type algebra          | General HM types plus deeply embedded FFI cases                  | Do not add a general `gpu` type variant merely to mark execution domain          |
| Type facts            | Types are keyed by surface `Expr` identity                       | Useful for shader reification and diagnostics                                    |
| Name identity         | Shared `BindingFacts` are assigned before downstream lowering    | Core and wmslang consume the same authored value identities                      |
| Fragment selection    | Resolves semantic constructor calls through `BindingId` aliases  | Selected roots are shared facts, not text rediscovered by either target pipeline |
| Core lowering         | Omits GPU-only values and rejects raw/selected pre-artifact uses | Completed selections still need opaque artifact replacement                      |
| Core JS emission      | Owns JS output and direct self-tail-call optimization            | Add one artifact/reference boundary; keep shader semantics out of this emitter   |
| Compilation artifacts | Currently JavaScript entry/worker artifacts                      | Needs a shader sidecar carried alongside Core emission                           |

The initial integration required two deliberate compiler seams:

1. recursive host passes need a shared region-aware traversal policy;
2. resolved value identity needs to exist before or alongside target-specific lowering.

Both now exist: host FFI visitors share an opaque-region policy, and final program analysis creates
one `BindingFacts` identity graph consumed by both Core and GPU normalization. Static fragment
selection is a third shared fact layered on those seams. The remaining boundary work is completed
artifact materialization, not another path through Core for shader expressions.

## Proposed phase ownership

```text
parse Workman
  -> discover and validate directives
  -> prepare host FFI, treating GPU bodies as opaque
  -> staged HM inference with a scoped GPU typing dialect
  -> resolve stable value identities
  -> final Workman analysis
       |                         |
       |                         +-> analyze GPU regions
       |                               -> capability/capture graph
       |                               -> typed functional wmslang IR
       |                               -> lowered control-flow IR
       |                               -> Slang -> WGSL + reflection
       |
       +-> lower host program to Core
               -> opaque shader artifact references
               -> JavaScript emission embeds WGSL and metadata
```

The split happens after shared source semantics, not before parsing or after JavaScript emission.
This gives wmslang Workman's syntax, inferred types, lexical scope, and module graph without giving
it ownership of host FFI or Core JavaScript semantics.

## Surface representation

Add directives as metadata on the existing lambda node:

```ts
type Directive = Located<{ name: string }>;

type LambdaExpr = Located<{
  kind: "Lambda";
  params: Param[];
  directives: Directive[];
  body: Expr;
}>;
```

This is preferable to a new `Expr` variant:

- the directive applies to the containing lambda rather than evaluating in its body;
- it does not create a fake `Void` expression;
- existing exhaustive expression switches do not all need a directive case;
- region ownership can be decided at the lambda boundary;
- non-semantic visitors can preserve the field by spreading the lambda node.

Create a single predicate such as `gpuDirective(lambda)` or a general `directivesFor(lambda)` API.
Passes should not repeatedly scan directive spelling themselves.

## The FFI traversal hazard

`prepareFfiElaboration` runs before inference. Its receiver rewrite currently descends into every
`Lambda`, records its parameters as possible JS object receivers, and rewrites the body. Delayed FFI
callback, annotation, and resolution passes also recursively visit lambdas.

That creates a concrete ambiguity before wmslang even starts type checking. For example, a shader
projection such as `uv.x` could be interpreted as a host JS receiver/property access and rewritten
into FFI syntax.

All host FFI passes must stop at an `@gpu` lambda region root:

```ts
case "Lambda":
  if (isGpuLambda(expr)) return expr;
  return rewriteOrdinaryLambda(expr);
```

Do not implement this as unrelated checks scattered through each FFI file. Introduce one shared
expression traversal policy, for example:

```ts
type RegionTraversal = {
  enterLambda(lambda: LambdaExpr): "descend" | "opaque";
};
```

The FFI policy returns `opaque` for GPU lambdas. Formatting, source collection, and editor tooling
can use policies that still descend. Later directive kinds can define their own ownership without
teaching the FFI about each one's internal semantics.

This is a narrow compiler mechanism, not a general plugin system.

### FFI lambda traversal audit

| Visitor                                                                       | Classification                        | GPU-region behavior                               |
| ----------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------- |
| `ffi/receiver/rewrite_expr.ts` receiver/call rewrite                          | host-only transform                   | return the lambda unchanged                       |
| `ffi/delayed/annotations.ts` dynamic-callback validation                      | host-only validation                  | do not inspect the body                           |
| `ffi/delayed/delayed_callbacks.ts` callback context collection and annotation | host-only transform                   | neither collect from nor annotate the body        |
| `ffi/delayed/delayed.ts` generated-ref collection and delayed type solving    | host-only analysis                    | do not inspect the body                           |
| `ffi/delayed/delayed_resolve.ts` reflected-call resolution                    | host-only transform                   | return the lambda unchanged                       |
| delayed callback-result/reflection hints                                      | host-only analysis                    | do not derive host callback results from the body |
| callback arity and parameter-shape helpers in `ffi/shared.ts`                 | target-neutral, root-only observation | may observe the lambda boundary but never descend |

All host-only entries use the shared `hostFfiRegionTraversal` policy. Ordinary lambdas still use the
existing recursive behavior. Shader analysis is domain-owned and will deliberately enter GPU regions
after final host inference; it does not reuse the host FFI policy.

## Reusing HM without merging the languages

Most of shader type inference is ordinary HM work and should remain shared:

- lambda parameters and results;
- lexical `let` bindings and generalization rules;
- tuples and records;
- calls;
- `if` and `match` result unification;
- recursive binding inference;
- imported Workman values and types.

The GPU differences are concentrated at a few semantic choke points:

- name lookup for shader intrinsics;
- numeric literal constraints and defaulting;
- unary and binary operator resolution, including homogeneous tuple/vector lifting;
- member lookup for swizzles such as `uv.x`;
- call validation and CPU/GPU capability constraints;
- rejection or classification of host/FFI values at capture boundaries;
- validation of shader-reifiable result and storage types.

The current `inferExpr` interface passes environment, type environment, ADTs, type maps, facts,
warnings, diagnostics, and provenance positionally through the recursive checker. Adding a `gpuMode`
argument would spread through the same call graph and invite more flags later.

First consolidate these services into an inference context:

```ts
type InferContext = {
  env: Env;
  typeEnv: TypeEnv;
  adts: Map<number, TypeDeclInfo>;
  types: Map<Expr, Ty>;
  facts: TypeFacts;
  warnings: string[];
  diagnostics: FrontendDiagnostic[];
  provenance: TypeProvenance;
  dialect: TypingDialect;
};
```

`TypingDialect` should be small and driven by actual choke points, not mirror the full checker:

```ts
type TypingDialect = {
  domain: "host" | "gpu";
  inferBinary?(
    expr: BinaryExpr,
    left: Ty,
    right: Ty,
    ctx: InferContext,
  ): Ty | undefined;
};
```

This is the initial implemented interface, not a forecast of every possible hook. Further hooks
should only be added when an inference spike proves they are needed. Host behavior remains the
default implementation. Entering an `@gpu` lambda derives a nested context with the GPU dialect;
ordinary lambdas nested inside inherit that dialect, and leaving the marked lambda restores the
parent dialect.

The first GPU hook accepts arithmetic over homogeneous numeric tuples of width 2-4, including scalar
broadcast, as a proof of the boundary. It constrains the participating elements to `Number` and
returns a same-width numeric tuple. This is deliberately not the final vector solver: generalized
numeric refinement, deferred broadcast constraints, and vector/product representation facts remain
owned by the shader-analysis milestones. The initial spike emitted GPU lambdas through the existing
JavaScript path. Core lowering now fails closed instead: direct marked bindings and their immutable
aliases are compiler-only and omitted, while any remaining raw GPU lambda/reference is rejected.
Materializing the completed opaque artifact reference remains the unfinished part of B6.

This reuses the HM engine without pretending the two domains have identical primitive operations. It
also keeps shader capability out of the core `Ty` union unless a later experiment proves that
capability genuinely participates in unification. Initially, capability can live in facts keyed by
resolved function identity.

## Stable identity is the missing elaboration layer

`InferResult.types` preserves surface expression identity, which wmslang needs to understand tuple
syntax, projections, and source spans. However, `BindingId` assignment currently occurs in
`core/artifact.ts`, after `coreFromSurface` has erased or normalized some surface meaning.

A capture graph cannot safely use names alone:

- nested scopes can shadow names;
- recursive functions need self identity;
- imported helpers need module-qualified identity;
- one helper may be reached from multiple shader roots;
- specialization and deduplication need stable keys.

Do not make wmslang inspect surface names and then separately guess which Core binding they became.
Move or extract value resolution into a target-neutral elaboration result:

```ts
type ElaboratedModule = {
  surface: Module;
  analysis: InferResult;
  bindings: BindingFacts; // binder and reference node -> BindingId
};
```

Core lowering and wmslang analysis should both consume this result. It is acceptable for binding
facts to be side tables rather than mutating every surface node. The essential property is that one
resolver assigns identities once for all downstream consumers.

This is a generally useful compiler boundary: LSP references, future transforms, diagnostics, Core,
and wmslang all benefit. It should not live under `src/wmslang/`.

## Separate shader semantic analysis

HM inference answers “what type does this expression have?” It should not also answer every question
about whether the expression is legal on a GPU.

After the final staged inference result is available, wmslang analysis should consume the elaborated
module and produce something like:

```ts
type ShaderAnalysis = {
  regions: Map<GpuRegionId, TypedGpuFunction>;
  functions: Map<BindingId, TypedGpuFunction>;
  captures: Map<GpuRegionId, Capture[]>;
  capabilities: Map<BindingId, FunctionCapability>;
  diagnostics: FrontendDiagnostic[];
};
```

This pass owns:

- reachability from each GPU region root and selected artifact root;
- CPU/GPU function capability;
- legal expression and type subsets;
- lexical capture classification;
- resource and uniform evidence;
- recursion and tail-position validation;
- conversion to typed functional wmslang IR;
- specialization decisions.

For the v1 ADT slice, “stable IDs” includes one shared constructor/declaration fact bundle, not only
value `BindingFacts`. TypeScript creates it before either downstream product: Core artifact lowering
and wmslang normalization consume the same `TypeNameId` and `CtorId` facts. The restricted
schema-v2 rows are in [`v1-readiness.md`](./v1-readiness.md); the broader layout design remains in
[`v1-functional-lowering.md`](./v1-functional-lowering.md).

It may reuse small target-neutral utilities such as tail-position walking, but it must not emit Core
or Slang while checking HM types.

Run this semantic pass only after the final FFI resolution/inference cycle. Partial inference still
needs the GPU dialect because a GPU lambda's function type can flow through its surrounding Workman
program. Expensive capture closure conversion and Slang generation do not need to repeat for every
partial FFI pass.

## Host boundary and Core lowering

Normal Core lowering must not recurse into a GPU-only lambda body. Shader elaboration and backend
compilation run first and hand host lowering a map from each resolved `Gpu.fragment(...)` call
identity to one completed artifact. Host lowering turns only that already-materialized call into an
opaque reference:

```ts
type CoreExpr =
  | ...
  | { kind: "CoreShaderRef"; artifactId: ShaderArtifactId; node?: AstNode };
```

The implementation keys the handoff by selected surface-call object identity. A missing artifact
fails closed before the call can be lowered as an ordinary application. Core and the JavaScript
emitter know only how to reference/embed a shader artifact; they do not know vector lifting, shader
intrinsics, captures, Slang syntax, or reflection rules.

The compiler result becomes two coordinated products:

```ts
type ProgramAnalysis = {
  graph: ModuleGraph;
  modules: Map<string, ElaboratedModule>;
  shaders: ShaderAnalysis;
};

type ProgramArtifacts = {
  core: CoreProgram;
  shaders: Map<GpuRegionId, ShaderArtifact>;
};
```

`ShaderArtifact` can contain WGSL, generated Slang for inspection, entry-point metadata, reflected
layout, source mapping, and a stable cache key. The JavaScript emitter receives this map and has a
single responsibility: materialize the referenced artifact in emitted host code.

The total generated segment sidecar and cache-key preimage in
[`v1-diagnostics.md`](./v1-diagnostics.md) are production hardening after v1. The slice retains
generated backend output and useful root/helper source anchors without freezing the complete
protocol.

## Direct FFI inside GPU regions

The FFI preparer skipping a GPU body does not mean arbitrary JS becomes valid shader code.

The wmslang pass should reject `FfiGet`, `FfiCall`, and `FfiBindingCall` if any survive inside a GPU
region. A host value may cross into the region only through an explicit, typed capture category:

- compile-time constant/specialization value;
- runtime uniform value;
- typed GPU resource wrapper/evidence;
- reachable GPU-capable Workman function.

A raw reflected TypeScript object is CPU-only. In particular, a TypeScript `GPUBuffer` does not
prove its shader element type; Workman needs typed evidence at the boundary.

This preserves deep JS interoperability around shader code while keeping JS semantics outside the
shader language.

## The CPU-callable question

There is one design choice that materially changes how isolated wmslang can remain.

If `@gpu` means GPU-only, normal Core replaces the lambda body with a shader handle. CPU code can
construct pipelines, pass the handle, or request WGSL, but cannot call the function as an ordinary
Workman function. This is the clean initial architecture.

If every GPU lambda must also run on the CPU, Core must lower its body too. Vector arithmetic,
swizzles, shader intrinsics, and possibly resource operations then need JavaScript meanings and
runtime helpers. That makes wmslang substantially more cross-cutting even if the source remains
pleasant.

Decision: begin with GPU-only `@gpu` functions while allowing ordinary Workman helpers to be
classified `CPU + GPU` when their operation subset supports both targets. Dual execution of an
`@gpu` function can later be an explicit capability or directive, rather than an accidental promise
attached to all shader code.

This still satisfies the important TypeGPU-like property: CPU setup, GPU functions, resources, and
pipeline construction are interleaved and fully typed in one `.wm` file. It does not require the
same function value to execute in both domains.

## Dependency direction

The intended source dependency graph is:

```text
ast / source / diagnostics / types
              ^
              |
        target-neutral inference and elaboration
          ^                         ^
          |                         |
       core + JS emitter        wmslang analysis
                                      |
                                  Slang backend
```

Forbidden dependencies:

- the HM type algebra importing wmslang IR;
- generic inference importing Slang services;
- FFI elaboration importing shader semantics;
- Core JS emission walking GPU source bodies;
- wmslang reaching into FFI reflection internals;
- the Slang backend deciding Workman source types.

Allowed narrow dependencies:

- inference calling a target-neutral `TypingDialect` supplied by wmslang;
- directive discovery returning opaque-region facts to host traversals;
- wmslang consuming inferred types and stable binding facts;
- Core referring to a `GpuRegionId` and receiving completed shader artifacts.

## Implementation order for the boundary

### B0: regression fixtures

- Add mixed host/FFI/lambda fixtures before changing traversal.
- Include dotted JS receiver access outside a future GPU region.
- Include nested ordinary lambdas so opaque traversal cannot accidentally skip too much.

### B1: directive syntax and region discovery

- Add lambda directive metadata in frontend-v1 only. Frontend-v2 support is not a wmslang milestone.
- Validate placement and duplicate `@gpu` directives.
- Assign stable per-compilation `GpuRegionId`s.
- Add `isGpuLambda`/region query helpers.

Exit criterion: the parser and tooling preserve `@gpu`, with no semantic behavior yet.

### B2: opaque host traversal

- Extract or introduce the shared region traversal policy.
- Make initial and delayed FFI transforms skip GPU lambda bodies.
- Audit every recursive lambda visitor and classify it as host-only, target-neutral, or
  domain-owned.
- Add a test proving `uv.x` inside `@gpu` is not rewritten as an FFI access while equivalent host
  access still is.

Exit criterion: host FFI cannot mutate shader syntax.

### B3: inference context refactor

Status: implemented.

- Consolidate recursive inference arguments into `InferContext` without changing behavior.
- Preserve existing diagnostics and type snapshots.
- Add the minimal `TypingDialect` hooks proven by scalar/vector inference tests.
- Switch dialect only while checking an `@gpu` lambda body.

Exit criterion: ordinary tests are unchanged and a GPU tuple/operator spike typechecks without a GPU
branch in the unifier.

### B4: target-neutral value resolution

Status: implemented.

- Extract `BindingId` assignment from Core artifact construction.
- Produce binding/reference facts over elaborated source.
- Make Core lowering consume those facts rather than resolve identities privately.
- Test shadowing, recursion, imports, patterns, and pinned patterns.

Exit criterion: wmslang and Core observe exactly the same binding identity.

`BindingFacts` is now produced over the final surface module and records binder patterns, variable
and pinned-pattern references, local IDs, and exported IDs. Whole-program resolution follows module
import clauses, so namespace, open, and named references point to the exporting Workman binding
rather than acquiring a second textual identity. Core lowering consumes these facts for all authored
local binders and references; it no longer performs a private lexical-resolution walk.

The current JavaScript backend still addresses imported values through its existing module alias, so
imported IDs remain in `BindingFacts` instead of being copied into the runtime `CoreVar` name.
Core-only binders synthesized while lowering lifted `Result` operators receive separate IDs from the
shared compiler allocator. They have no surface identity and are intentionally absent from
`BindingFacts`.

The same pre-target seam now owns nominal declaration identity. Final inference records the exact
`TypeInfo` created for every authored type and record declaration, including block-local ones, and
constructor schemes retain their source declaration token through imports. `NominalFacts` assigns
deterministic `TypeNameId`, `RecordId`, and `CtorId` families, maps inference type IDs to semantic
IDs, and resolves constructor expressions/patterns only when inference classified them as
constructors. Core consumes these maps while lowering. It no longer allocates constructors after
lowering or reconstructs constructor meaning from text and import clauses. Schema v2 will serialize
the same bundle for wmslang rather than creating another resolver.

### B5: shader sidecar analysis

Status: in progress. The versioned DTO, final-inference normalization, generated Workman library,
validated loader, stable H0 typed tables, persistent-map function registry, and initial
host-FFI/unsupported-expression diagnostics are implemented. GPU roots now drive a resolved-ID
call-graph closure across modules; reachable candidates are classified `gpu-eligible`, unused
candidates remain `cpu-only`, and capability diagnostics inspect only reachable expression trees.
Per-root capture closure now excludes parameters and lexical `let` binders, follows reachable
helpers transitively, and deduplicates captures by resolved binding ID. Compiler-known numeric,
boolean, and vector initializer trees are classified as constants; other reifiable scalar/vector
values become uniforms; reachable helpers become function captures; and CPU-only or non-reifiable
values produce `gpu.illegal-capture`. The resource category is reserved for nominal wrapper evidence
that has not yet been added. The first monotone numeric solver propagates `i32`/`f32` evidence
through scalar arithmetic, tuple-vector construction, broadcast, blocks, branches, unary operators,
and resolved function calls, then defaults unresolved numeric representations after the fixed point.
Its current schema-v1 merge lets `f32` dominate mixed evidence; that is H0 scaffolding, not v1
language behavior. The v1 schema bypasses the solver by mapping all reachable `Number` values
directly to `f32`. The inferred-uniform and general unary/binary constant categories are likewise H0
scaffolding; v1 rejects all captured values. The conflict system in
[`v1-numerics.md`](./v1-numerics.md) and capture grammar in
[`v1-captures.md`](./v1-captures.md) are later slices. Numeric representation IDs
are owned by binding and expression occurrences rather than globally interned `Number` shapes, so
float evidence in one root cannot widen an unrelated integer root. A shared fixed-shape numeric
helper is now instantiated independently from concrete reachable calls, so one source helper can
have separate `i32` and `f32` specializations. The Workman pass registers a deterministic
specialization ID before descending, deduplicates equal signatures across roots, records every
specialized call target, and uses early registration as a direct-recursion cycle guard. Mutual
recursion is diagnosed explicitly. Each specialization carries its own concrete type-representation
overlay; the shared type table is concrete only where all instances agree and otherwise remains
abstract. Full HM/GPU-scheme shape instantiation, explicit conversion evidence, typed uniform
evidence, static-capture key material, user-visible unsigned values, and coercion materialization are
post-v1. V1 consumes only one monomorphic instance per source helper and fixes its numbers to `f32`.
Each H0 specialization is now reified into a separate immutable functional expression graph with
concrete representation facts, cloned child IDs, source expression/span
provenance, resolved specialized call targets, and variable origins (`local`, `capture`, or
`function`). Its function record owns typed parameters and a specialized result. Blocks and
immutable declaration nodes are preserved as source-semantic IR; ANF, result slots, and mutation
still belong to the later lowered control-flow IR.

- Add `ShaderAnalysis` after final staged inference.
- Build reachability, capability, and capture facts.
- Reify typed functional wmslang IR without changing the normal `Ty` union merely for GPU markers.
- Carry deferred GPU numeric/broadcast constraints in shader analysis facts, then produce a separate
  lowered control-flow IR for ADTs, closures, matches, and tail loops.
- Diagnose surviving FFI nodes and CPU-only captures.

Exit criterion: shader analysis is independently snapshot-testable and Slang-free.

### B6: opaque Core reference and artifacts

Status: in progress. GPU-only function bodies no longer enter Core or JavaScript. Static
`Gpu.fragment` calls now resolve by closed compiler-basis semantic identity through inline lambdas
and finite immutable `BindingId` aliases, including imports; repeated selectors share one root and
unselected markers are not production roots. Completed artifact materialization is not implemented
yet, so a selected constructor fails closed before Core rather than becoming executable host code.

- Omit compiler-only marked lambda bindings and immutable aliases, rejecting unsafe host uses.
- Replace the already resolved `Gpu.fragment` selections with completed artifact references.
- Add shader sidecars to compiler results.
- Teach JS emission only to materialize a shader artifact reference.
- Keep Slang compilation behind the wmslang backend boundary.

Exit criterion: a mixed `.wm` file emits host JavaScript plus one embedded shader without Core or
the JS emitter understanding shader expressions.

## Guardrails to keep over time

- Adding a shader expression feature should normally touch `src/wmslang/`, a narrow dialect hook,
  and tests—not FFI, Core, and the JS emitter.
- Adding a host FFI feature must not require changes in wmslang unless it introduces a deliberately
  supported GPU boundary wrapper.
- No GPU pass runs during each delayed-FFI inference iteration except the scoped type rules needed
  to infer the lambda's Workman type.
- Core never contains the lowered body of a GPU-only lambda.
- Slang diagnostics are backend validation results, not the primary Workman type checker.
- Cross-module reachability is keyed by resolved IDs, never textual names.
- New directive domains should be able to reuse opaque-region traversal without becoming GPU
  concepts.

## Immediate conclusion

The current compiler does not require a second HM checker, but implementing `@gpu` directly on top
of today's recursive passes would make it cross-cutting. The safe path is to first expose three
small general compiler seams:

1. region-aware traversal;
2. an inference context with a scoped typing dialect;
3. target-neutral resolved binding facts.

With those seams, wmslang becomes a separate semantic and artifact pipeline embedded inside one
typed Workman program. JS FFI remains deeply integrated by design, while GPU code only meets it at
explicit typed capture and artifact boundaries.
