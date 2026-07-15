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

The TypeScript/JavaScript FFI is intentionally a core-language integration. In the current
compiler it crosses nearly every semantic layer:

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

| Area | Current shape | Consequence for wmslang |
| --- | --- | --- |
| Parsing | Produces one surface `Module` | Good place to preserve lambda directives |
| FFI preparation | Recursively rewrites all expressions, including lambda bodies | Must treat GPU region roots as opaque before any rewrite |
| HM inference | Central recursive `inferExpr`, split into helpers | Reusable, but it needs a scoped dialect/context rather than more positional flags |
| Type algebra | General HM types plus deeply embedded FFI cases | Do not add a general `gpu` type variant merely to mark execution domain |
| Type facts | Types are keyed by surface `Expr` identity | Useful for shader reification and diagnostics |
| Name identity | Stable `BindingId`s are assigned only after lowering to Core | Insufficient for capture/dependency analysis while preserving GPU surface meaning |
| Core lowering | Recursively lowers every lambda body to `CoreFn` | Must replace a GPU region root with an opaque shader reference, not lower its body normally |
| Core JS emission | Owns JS output and direct self-tail-call optimization | Add one artifact/reference boundary; keep shader semantics out of this emitter |
| Compilation artifacts | Currently JavaScript entry/worker artifacts | Needs a shader sidecar carried alongside Core emission |

The compiler is modular enough to host wmslang, but two boundaries need deliberate work:

1. recursive host passes need a shared region-aware traversal policy;
2. resolved value identity needs to exist before or alongside target-specific lowering.

Without those changes, the implementation will appear modular initially and then accumulate
special cases as soon as captures, cross-module GPU helpers, and FFI-adjacent code are added.

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

Create a single predicate such as `gpuDirective(lambda)` or a general
`directivesFor(lambda)` API. Passes should not repeatedly scan directive spelling themselves.

## The FFI traversal hazard

`prepareFfiElaboration` runs before inference. Its receiver rewrite currently descends into every
`Lambda`, records its parameters as possible JS object receivers, and rewrites the body. Delayed
FFI callback, annotation, and resolution passes also recursively visit lambdas.

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
warnings, diagnostics, and provenance positionally through the recursive checker. Adding a
`gpuMode` argument would spread through the same call graph and invite more flags later.

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
  lookupIntrinsic?(name: string, ctx: InferContext): Scheme | undefined;
  inferNumericLiteral?(expr: IntExpr | FloatExpr, ctx: InferContext): Ty | undefined;
  inferOperator?(expr: BinaryExpr, ctx: InferContext): Ty | undefined;
  inferProjection?(expr: VarExpr, ctx: InferContext): Ty | undefined;
  validateCall?(expr: CallExpr, callee: Ty, ctx: InferContext): void;
};
```

The exact hooks should only be added when an inference spike proves they are needed. Host behavior
remains the default implementation. Entering an `@gpu` lambda derives a nested context with the GPU
dialect; leaving it restores the host dialect.

This reuses the HM engine without pretending the two domains have identical primitive operations.
It also keeps shader capability out of the core `Ty` union unless a later experiment proves that
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

HM inference answers “what type does this expression have?” It should not also answer every
question about whether the expression is legal on a GPU.

After the final staged inference result is available, wmslang analysis should consume the
elaborated module and produce something like:

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

It may reuse small target-neutral utilities such as tail-position walking, but it must not emit Core
or Slang while checking HM types.

Run this semantic pass only after the final FFI resolution/inference cycle. Partial inference still
needs the GPU dialect because a GPU lambda's function type can flow through its surrounding
Workman program. Expensive capture closure conversion and Slang generation do not need to repeat
for every partial FFI pass.

## Host boundary and Core lowering

Normal Core lowering must not recurse into a GPU-only lambda body. Lower the root to one opaque
host value referring to a compiled artifact:

```ts
type CoreExpr =
  | ...
  | { kind: "CoreShaderRef"; region: GpuRegionId; node?: AstNode };
```

The name is illustrative. It could instead be a synthetic runtime constructor generated during
lowering. What matters is that Core and the JavaScript emitter know only how to reference/embed a
shader artifact; they do not know vector lifting, shader intrinsics, captures, Slang syntax, or
reflection rules.

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

This still satisfies the important TypeGPU-like property: CPU setup, GPU functions, resources,
and pipeline construction are interleaved and fully typed in one `.wm` file. It does not require
the same function value to execute in both domains.

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

- Add lambda directive metadata in both frontends.
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

- Consolidate recursive inference arguments into `InferContext` without changing behavior.
- Preserve existing diagnostics and type snapshots.
- Add the minimal `TypingDialect` hooks proven by scalar/vector inference tests.
- Switch dialect only while checking an `@gpu` lambda body.

Exit criterion: ordinary tests are unchanged and a GPU tuple/operator spike typechecks without a
GPU branch in the unifier.

### B4: target-neutral value resolution

- Extract `BindingId` assignment from Core artifact construction.
- Produce binding/reference facts over elaborated source.
- Make Core lowering consume those facts rather than resolve identities privately.
- Test shadowing, recursion, imports, patterns, and pinned patterns.

Exit criterion: wmslang and Core observe exactly the same binding identity.

### B5: shader sidecar analysis

- Add `ShaderAnalysis` after final staged inference.
- Build reachability, capability, and capture facts.
- Reify typed functional wmslang IR without changing the normal `Ty` union merely for GPU markers.
- Carry deferred GPU numeric/broadcast constraints in shader analysis facts, then produce a
  separate lowered control-flow IR for ADTs, closures, matches, and tail loops.
- Diagnose surviving FFI nodes and CPU-only captures.

Exit criterion: shader analysis is independently snapshot-testable and Slang-free.

### B6: opaque Core reference and artifacts

- Replace GPU-only lambda roots during Core lowering.
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
