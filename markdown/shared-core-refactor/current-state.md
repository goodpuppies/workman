# Shared Core refactor: current state

Status date: 2026-09-09

## Objective

Make Core the typed semantic boundary shared by every backend. Surface syntax,
name resolution, and type inference happen once. Host JavaScript, shader code,
and a future SML backend then fork from the same representation.

The immediate motivating case is creative shader code using ordinary Workman
syntax:

```workman
let direction = uv :> classify;
let amount = direction :> match {
  Left => { 0.0 },
  Right => { 2.0 }
};
let shifted = amount :> add(1.0);
```

These forms must not acquire WMSLang-specific parsing or independent semantic
desugaring.

## Implemented

### Backend-neutral Core mode

`src/core/from_surface.ts` now has two explicit lowering targets:

- `shared`: retains declarations needed by any backend and avoids host policy;
- `host`: preserves the existing JavaScript-oriented behavior.

`sharedCoreFromSurface` currently:

- retains `@gpu` lambdas instead of requiring prior shader materialization;
- retains authored lambda directives on `CoreFn`;
- retains compiler semantic IDs such as `gpu.color` and `gpu.fragment`;
- retains GPU-only bindings and nominal types;
- does not replace selected fragments with `CoreShaderRef`;
- does not inject host carrier imports or perform host carrier lifting;
- normalizes calls to unary `CoreApp` with tuple-packed arguments;
- normalizes pipes to `CoreApp`;
- erases expression and pattern ascriptions after checking;
- represents anonymous match functions with `CoreFn` and `CoreMatch`.

The pipe-and-match example therefore reaches shared Core as application and
function/match structure rather than as a shader-specific syntax case.

### Typed shared artifact

`src/core/elaboration.ts` defines `SharedCoreModule`:

```text
SharedCoreModule
  module: CoreModule
  facts:
    expressions: Map<source NodeId, SharedCoreExpressionFact>
    patterns: Map<source NodeId, SharedCorePatternFact>
```

Expression facts currently retain:

- inferred HM type;
- compiler semantic ID;
- GPU operator selection;
- GPU builtin identity;
- GPU operation obligation;
- GPU resource-call fact.

`CoreProgramAnalysis.sharedCore` contains this artifact for every analyzed
module. Backends no longer need to recover these facts solely through Surface
`Expr` object identity.

### WMSLang Core expression migration

WMSLang is now a hybrid Surface/Core consumer, but shader function bodies are
emitted from Core:

- local and inline GPU function discovery traverses `CoreFn` and `CoreApp`;
- call graph edges use binding IDs retained on Core variables;
- GPU call specialization is driven by Core application topology;
- literals, tuples, projections, applications, operators, conditionals,
  matches, and blocks are emitted by walking Core;
- applications originating from pipes use the same `CoreApp` path as authored
  calls, including an inline anonymous match function;
- specialization occurrences can represent semantic applications whose source
  occurrence was a pipe rather than only a Surface `Call`.

The complete Shader Studio example now checks successfully:

```sh
deno task wm check /home/ellie/git/gpuman-shader-studio/examples/shader_studio.wm
```

The jelly shader continues to check and compile through the window example.

Pipe application shape is now classified once in `src/pipe_elaboration.ts`.
Ordinary calls and pipes share domain invocation typing while retaining the
authored pipe occurrence for diagnostics. Direct stages, tuple insertion, and
curried/computed stages remain distinct plan modes; Core construction consumes
the same plan. This also lets piped Slang builtins such as `uv :> normalize`
follow the ordinary builtin overload path without a WMSLang syntax rule.

## Current pipeline

The compiler is not yet fully `Surface -> Shared Core -> backend`.

| Stage | Current authority |
| --- | --- |
| Parsing and authored layout | frontend v2 Surface |
| HM inference and semantic identities | inference facts over Surface |
| Common application semantics | Shared Core |
| WMSLang function discovery | Shared Core |
| WMSLang call specialization | Shared Core topology plus typed Core facts |
| WMSLang expression DTO emission | Shared Core plus source provenance |
| WMSLang patterns and capture ownership | Surface-derived resolved facts |
| GPU root selection and lexical slicing | Surface AST plus binding facts |
| Host JavaScript Core construction | separate host mode from Surface |
| Future SML backend | not implemented |

The host and shared modes reuse one lowering implementation, but host lowering
does not yet consume an already-built `SharedCoreModule`. That is an important
remaining architectural step.

## What the pipe support does and does not do

The WMSLang path does not calculate pipe argument insertion itself. It looks up
the `CoreApp` produced by common Core elaboration, then emits/specializes that
application like any other call.

WMSLang function-body emission no longer has a Surface `Pipe` dispatch. Surface
nodes remain as diagnostic provenance and as keys for pattern, capture,
recursion, and specialization facts that have not yet moved to Core occurrence
identity.

No Peggy grammar or generated frontend change was needed for these forms.

## Known architectural debt

### Source node IDs are provenance, not unique Core occurrence IDs

Core nodes retain their originating Surface `NodeId`. A transformation may
create several Core nodes with the same source ID—for example, the operator
variable, tuple argument, and application produced from one binary expression.
The typed fact table is therefore safe only when queried for the Core node that
semantically corresponds to the source occurrence.

Before every backend is fully Core-native, Core should gain its own occurrence
identity while retaining a separate `sourceNodeId` for diagnostics. Typed facts
can then be keyed unambiguously by Core occurrence.

### `CoreRecord` is overloaded

Both a Core record declaration and a Core record expression use the
`"CoreRecord"` discriminant. This makes heterogeneous block traversal require
field-shape inspection. The tags should become distinct, for example
`CoreRecordDecl` and `CoreRecordExpr`, before more generic backend passes are
built.

### The Core union still contains host-oriented constructs

`CoreJsImport`, JSON nodes, and `CoreShaderRef` live in the same union as the
shared functional language. The shared path does not produce a materialized
shader reference, but the type boundary does not yet express which constructs
are legal at which phase. Phase-specific module types or validation passes are
still needed.

### Some backend facts still carry Surface objects

GPU selection, recursion, resolved patterns, and portions of specialization
still retain Surface nodes for identity or diagnostics. Stable binding,
constructor, pattern, Core occurrence, and source provenance IDs should replace
object identity as each consumer migrates.

## Invariants to preserve

1. Frontend v2 remains the sole runtime parser authority.
2. Source syntax is normalized once before backend-specific lowering.
3. Compiler intrinsics are recognized by semantic ID, never spelling alone.
4. Binding and constructor identity survive module boundaries and shadowing.
5. Shared Core retains enough source provenance for precise diagnostics.
6. Host behavior must remain unchanged while consumers migrate.
7. Shader restrictions are validation of typed Core, not a second language
   grammar.
8. The future SML backend must fork from shared Core, not from WMSLang DTOs or
   JavaScript-oriented Core.

## Next slices

### 1. Give Core occurrences distinct identity

- allocate a Core occurrence ID for every expression and pattern;
- retain source node provenance separately;
- re-key `SharedCoreFacts` by Core occurrence ID;
- add validation that every typed Core occurrence has the required fact.

This removes the most fragile part of the current Surface/Core bridge.

### 2. Finish the Core-native WMSLang boundary

- remove the now-unused Surface expression-emission helpers;
- re-key specialization, recursion, and pattern facts by Core occurrence;
- retain Surface nodes only as diagnostic provenance.

### 3. Move patterns and ownership to Core identities

- attach resolved pattern/type facts to Core patterns;
- derive local binding ownership and capture validation from Core scopes;
- stop walking Surface blocks to discover local functions and lets.

### 4. Make host lowering a true post-Core pass

- consume `SharedCoreModule` rather than lowering Surface a second time;
- erase GPU-only declarations at the host fork;
- materialize selected `CoreApp(gpu.fragment, ...)` expressions as shader
  references;
- perform carrier lifting as an explicit host transformation;
- separate host-only Core constructs from shared Core.

### 5. Define the backend contract

Add a small backend interface around typed shared modules, backend validation,
and emitted artifacts. WMSLang/Slang becomes one implementation, JavaScript
another, and the planned SML backend a third.

## Verification

Current regression coverage includes common Core normalization, typed shared
facts, GPU selection, WMSLang specialization, all three pipe forms, the real
WMSLang compiler, and the window examples.

Useful commands:

```sh
deno task check
deno test -A tests/core_test.ts tests/gpu_selection_test.ts \
  tests/wmslang_v2_slice_test.ts tests/wmslang_v4_specialize_test.ts \
  tests/wmslang_window_example_test.ts
deno task wm check /home/ellie/git/gpuman-shader-studio/examples/shader_studio.wm
deno task wm check examples/wmslang_window/src/jelly_shader.wm
```

At the time of this status document, the focused pipe, Core, WMSLang, CLI, and
LSP suites pass, both example checks report `ok`, and the full TypeScript check
passes.
