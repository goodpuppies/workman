# Frontend v2: WM implementation and TypeScript migration

## Decision

Build the new tolerant Workman frontend in Workman first. Compile it to an
importable JavaScript library and consume that library from the existing TypeScript
compiler as frontend v2. Keep module loading, FFI elaboration, Hindley-Milner type
inference, Core lowering, diagnostics, and JavaScript emission in TypeScript during
this migration.

After frontend v2 is stable in the compiler and current LSP, rebuild the LSP in WM
against the same frontend package. This prevents one feature from being split
between two implementations:

```text
                         frontend-v2 WM sources
                                  |
                                  | wm library compile
                                  v
                    importable frontend-v2 JavaScript
                         /                    \
                        /                      \
                       v                        v
        existing TypeScript compiler/LSP       new WM LSP
        (inference remains TypeScript)          (compiled to JavaScript)
```

The frontend becomes useful before the LSP rewrite. Better recovery, structural
diagnostics, exact syntax spans, and virtual completion can improve compiler and
current-editor behavior as soon as the TypeScript adapter adopts it.

## Ownership boundary

The exact recovery semantics are normative in
[`tolerance-and-recovery-model.md`](./tolerance-and-recovery-model.md). In
particular, every failed required syntax slot produces both a category-correct
fallback and a stable recovery mark; diagnostics and virtual repairs are
projections of that same event.

The larger product/state model is defined in
[`structural-editor-model.md`](./structural-editor-model.md). Frontend v2 is not
only a tolerant compiler parser: it constructs the structural document that the
editor renders through LSP.

Frontend v2 owns:

- lossless lexing, including comments and trivia;
- tolerant parsing and deterministic recovery;
- the structural surface tree;
- missing syntax, holes, opaque/error nodes, and repair artifacts;
- concrete and virtual rendering;
- concrete/virtual offset maps;
- syntax diagnostics;
- projection from the structural tree into a complete semantic surface DTO when
  enough structure exists;
- stable syntax node IDs suitable for editor queries.

TypeScript initially continues to own:

- filesystem/module graph construction;
- standard library and import environments;
- JS FFI reflection and elaboration;
- name resolution and HM inference;
- compiler semantic diagnostics and facts;
- lowering to Core and JavaScript emission;
- LSP transport, document orchestration, hover, and publication until their WM
  replacements are ready.

The boundary is a plain-data ABI. TypeScript must not traverse WM runtime closures
or depend on generated private names. WM must not receive TypeScript compiler class
instances.

## Code-size rule

Every maintained code file in this project must remain at or below 500 lines.
Markdown documentation is exempt. Generated compiler artifacts are not maintained
source, but must be reproducible and should not be hand-edited.

Apply the rule while designing module ownership:

- split lexer, parser productions, recovery helpers, rendering, source maps,
  diagnostics, DTO conversion, protocol transport, workspace state, and individual
  LSP features into coherent modules;
- do not wait until a file is already oversized before choosing boundaries;
- do not use many tiny arbitrary fragments merely to satisfy a line count;
- do not treat existing oversized files elsewhere in the repository as precedent;
- when new work must substantially modify an oversized maintained file, include a
  coherent split in the change when practical and never increase the violation
  casually.

## Two frontend products from one parse

One parse should produce related but distinct views.

### Structural result

Always returned for every finite text buffer:

```text
StructuralParseResult
  tree
  tokens
  repairs
  syntaxDiagnostics
  concreteToVirtualMap
  virtualText
```

This result is lossless, structurally valid, and tolerant. Error/opaque nodes and
typed fallbacks are part of its valid grammar rather than parse failure. It powers
structural inlays, syntax-aware selection/formatting later, and editor behavior even
when semantic analysis cannot run.

### Semantic projection

Returned when the tree can be projected into the current compiler surface model:

```text
SemanticProjection
  module
  sourceMap
  syntheticNodeIds
```

For complete source, projection should preserve current parser semantics. For
incomplete source, it may project virtual holes or inserted delimiters. If recovery
is too ambiguous, projection can fail for a bounded subtree or module without
destroying the structural result.

This separation prevents the compiler AST from becoming lossless-editor syntax and
prevents the editor tree from being constrained by the inference engine's current
input shape.

## Public JavaScript ABI

Start with one deliberately small exported function:

```ts
export function parseWorkmanV2(source: string, options?: ParseOptions): ParseResultDto;
```

The real generated module may expose additional functions later, but the first ABI
should use only:

- strings, booleans, numbers, null/options;
- arrays;
- records with explicit discriminant strings;
- stable numeric IDs and offsets.

Avoid `Map`, class instances, callbacks, exceptions as expected control flow, and
WM algebraic runtime representations in the TypeScript-facing DTO. Convert internal
WM values at the package boundary if necessary.

The DTO schema needs an explicit version such as `schemaVersion: 1`. Validate it in
the TypeScript adapter and fail loudly on incompatible generated artifacts.

### Offset contract

Use UTF-16 code-unit offsets at the ABI because JavaScript strings and LSP positions
make that the least surprising integration unit. Store line starts once per result.
Tests must cover astral Unicode, combining characters, CRLF, and a final line with
no newline.

### Error contract

Expected syntax errors are data in `syntaxDiagnostics`, not thrown exceptions.
Throw only for violated invariants, unsupported ABI versions, or host failures. A
crash should include a phase label and enough bounded source context to reproduce
it without logging an entire private document.

## Required compiler/backend work

The current JavaScript emitter produces an executable program and invokes `main`;
it does not emit an ES module API for importing exported WM bindings. Frontend v2
therefore first needs a library emission mode.

Add a compiler mode with these properties:

- it does not invoke `main`;
- exported entry-module WM values become explicit ES module exports;
- imported WM modules remain internal unless re-export is deliberately supported;
- runtime helpers are scoped without leaking accidental globals;
- generated export names are stable and valid JavaScript identifiers or use a
  stable exported namespace object;
- executable emission remains unchanged by default;
- library output can be imported repeatedly without process-global mutable state.

Prefer a compiler API such as `compileLibraryFile` or an explicit emission target
over detecting library mode from source conventions. Add direct Deno import tests
before using the mode for frontend v2.

## Bootstrap rule

Frontend v2 is initially compiled by frontend v1. This creates a real bootstrap
constraint:

- frontend-v2 WM source must remain valid in the v1 language subset until v2 can
  compile itself;
- generated JavaScript must be reproducible from a documented command;
- CI must rebuild and compare or rebuild then test the artifact;
- the TypeScript compiler must not require frontend v2 to compile frontend v2 until
  a separately tested bootstrap artifact is available.

Use a three-stage check when self-hosting becomes possible:

```text
stage 0: v1 compiler -> frontend-v2.js
stage 1: compiler using frontend-v2.js -> frontend-v2-stage1.js
stage 2: compiler using stage1       -> frontend-v2-stage2.js

require normalized stage1 == normalized stage2
```

Do not make self-host equality a prerequisite for initial TypeScript adoption. It
is a later confidence gate.

## Migration architecture in TypeScript

Introduce a narrow frontend interface rather than scattering v2 checks:

```ts
interface WorkmanFrontend {
  parse(source: string, filePath?: string): Promise<FrontendResult>;
}
```

Provide:

- `PeggyFrontend` wrapping the current `parse` function;
- `WorkmanFrontendV2` wrapping the generated JS ABI and translating DTOs;
- a comparison harness that runs both on valid-source corpora;
- one configuration point in compiler/module graph construction.

The rest of the compiler should receive the existing TypeScript `Module` shape at
first. Keep DTO translation in one adapter. Once v2 is established, the TypeScript
surface types can evolve deliberately rather than forcing a simultaneous compiler
rewrite.

### Modes during rollout

Support three internal/test modes:

- `v1`: Peggy only;
- `v2`: WM frontend only;
- `compare`: run both, use v1 for semantics initially, and report normalized
  differences.

Do not expose long-lived user configuration unless it is needed for rollout. The
goal is removal of v1, not permanent dual-parser product complexity.

## Frontend-first delivery plan

### Phase 0 — standalone WM frontend proof

Start the real frontend-v2 package in WM without waiting for TypeScript integration
or importable-library emission.

Deliver:

- initial source/span, token/trivia, mark, fallback, and artifact types;
- a lossless lexer for a narrow but representative subset;
- one tolerant vertical slice, preferably `let thing =`;
- concrete and marked virtual preview rendering;
- a WM executable or self-check module run through `wm run`.

Exit criteria:

- the authored sample round-trips exactly;
- the incomplete sample returns a valid structural document;
- its fallback, mark class, and virtual `?`/`;` artifacts are inspectable;
- the implementation is structured as reusable frontend modules rather than a
  disposable script;
- no TypeScript import is required to prove the frontend behavior.

### Phase A — importable WM libraries

Deliver:

- explicit library emission target;
- exported entry-module values;
- Deno import and repeated-import tests;
- a tiny WM library fixture called from TypeScript.

Exit criteria:

- TypeScript imports generated JavaScript and calls an exported WM function;
- executable compilation behavior is unchanged;
- generated library output has no implicit `main` execution;
- the build command is deterministic and documented.

### Phase B — frontend package and lossless lexer

Create a package such as `frontend-v2/` or `tooling/frontend-v2/` in WM. Settle its
permanent source location before other tools import it; `tooling/frontend-v2/` is
the safer bootstrap location while `src/` still means TypeScript compiler source.

Deliver:

- public DTO/version module;
- source span, token, trivia, diagnostic, and repair types;
- lossless lexer;
- concrete renderer;
- generated JS artifact and TypeScript loader;
- lexer golden/property tests.

Exit criteria:

- arbitrary source round-trips exactly through lex/render;
- valid repository WM files lex without opaque fallback;
- token spans and line maps pass Unicode/CRLF tests;
- the TypeScript test suite can import the artifact without enabling v2 parsing.

### Phase C — tolerant parser and structural result

Implement declarations and expressions incrementally, starting with the current
`wm-mini` grammar rather than the larger Grain grammar.

Recommended order:

1. top-level imports, `let`, records, and type declarations;
2. literals, names, calls, tuples, records, JSON, lists, and blocks;
3. lambdas, `if`, `match`, patterns, and type expressions;
4. JS import forms, pipes/lifts, and remaining current syntax;
5. recovery marks and virtual rendering for each form.

Exit criteria:

- valid-source normalized trees match the Peggy parser corpus;
- invalid inputs terminate and preserve all concrete text;
- repairs are deterministic and ordered;
- `let thing =` yields a structural tree and virtual `let thing = ?;`;
- syntax diagnostics are data, not exceptions.

### Phase D — semantic projection and compiler comparison

Deliver:

- WM structural-tree-to-semantic-DTO projection;
- one TypeScript DTO-to-`Module` adapter;
- `v1`, `v2`, and `compare` frontend modes;
- normalized AST comparison over repository fixtures and tests;
- source-span and diagnostic comparison reports.

Exit criteria:

- all supported valid WM sources produce equivalent semantic ASTs, with documented
  intentional differences;
- compile/check test suites pass in v2 mode;
- no downstream compiler phase imports frontend-v2 implementation details;
- performance is measured separately for lex, parse, DTO conversion, and total
  compile time.

### Phase E — adopt frontend v2 in the compiler and current LSP

Make v2 the default frontend while retaining a short-lived fallback for debugging.
Use its structural result in the existing TypeScript LSP before rewriting transport.

Initial current-LSP improvements can include:

- multiple syntax diagnostics instead of one thrown parse error;
- structural inlays from repair artifacts;
- semantic analysis of virtual-complete source;
- more precise hover/diagnostic spans from stable syntax IDs;
- formatting experiments backed by lossless syntax.

Exit criteria:

- v2 is the default compiler parser;
- the current LSP remains operational and gains at least structural inlays;
- v1 comparison finds no unexplained differences for a defined soak period;
- Peggy can be removed or retained only as an isolated compatibility test oracle.

### Phase F — rebuild the LSP in WM

Only now establish the WM server runtime and move LSP features. The server imports
frontend-v2 as a normal WM module, so no parsing or recovery logic is duplicated.

Recommended migration order:

1. JSON-RPC framing and lifecycle;
2. document store, line index, and versioned frontend cache;
3. structural inlays and syntax diagnostics;
4. TypeScript semantic-service bridge;
5. type inlays, hover, definitions, and module invalidation;
6. formatting and new structural features;
7. remove the TypeScript LSP after parity and soak time.

At this phase, TypeScript remains a semantic engine behind a narrow process or JS
adapter. Rewriting inference is a separate project and is not required for a
single-language LSP implementation.

### Phase G — advanced editing, incrementality, and cleanup

Add explanation/materialization interactions, structural selections, ambiguity
choices, and other editor features on the shared structural document. Profile real
edit traces before adding incremental token/subtree reuse, worker isolation, or
concurrency. Remove the old TypeScript LSP only after parity and soak time.

## Test gates

### Frontend equivalence

Compare normalized v1/v2 semantic outputs for:

- every `.wm` file in `std/`, `examples/`, and test fixtures;
- every parser/compiler source-string fixture that represents valid syntax;
- module import shapes and JS FFI declarations;
- node spans used by current hover and diagnostics.

Ignore only explicitly listed differences such as new recovery metadata or more
precise zero-width spans.

### Tolerance invariants

- lex/parse always makes progress;
- concrete rendering equals input;
- virtual rendering equals concrete source plus declared artifacts;
- every virtual segment maps to a concrete range or a declared zero-width anchor;
- fully explicit canonical files produce no missing-syntax repair artifacts;
  flexible valid files may produce optional/canonical virtual artifacts;
- inserting/deleting one token cannot silently discard unrelated declarations.

### Integration

- generated library imports from a fresh Deno process;
- no build step writes into source directories unexpectedly;
- compiler tests run in v2 mode in CI;
- current LSP tests run against v2 before the WM LSP exists;
- later, the same structural golden cases run against both LSP implementations.

## Main risks

### Generated module ABI

WM runtime representations are currently an implementation detail. Treat the
TypeScript-facing DTO conversion as a public boundary so backend representation
changes do not rewrite compiler integration.

### Grammar drift during migration

Frontend v1 remains the compiler used to build v2 while v2 is replacing v1. Keep
the v2 source within v1 syntax and run comparison continuously. Avoid adding new
surface syntax solely to make the frontend implementation more convenient.

### Circular build dependency

The compiler can consume a previously built frontend-v2 artifact, but building that
artifact must have a clear stage-0 path. Pin the bootstrap command/artifact policy
before switching the default frontend.

### Performance hidden by serialization

If TypeScript calls compiled WM in-process, prefer direct plain-data values over
JSON stringify/parse between phases. Keep JSON only for process boundaries or test
snapshots. Measure DTO construction and adaptation explicitly.

### Split semantic authority

Frontend v2 owns syntax; TypeScript inference owns semantics. Avoid reimplementing
name or type resolution in the frontend merely to power editor features. Export
stable syntax identities and let semantic facts attach to them through the adapter.

## Immediate implementation slice

The next code change should prove the frontend itself in WM:

1. Create the frontend-v2 package with initial structural data types.
2. Implement a narrow lossless lexer and concrete renderer.
3. Implement one tolerant `let`-binding recovery with a typed fallback and mark.
4. Render a marked virtual preview.
5. Run assertions from a WM entry point through `wm run`.

That first produces:

```text
WM text -> WM lexer/parser -> structural document -> WM preview/assertions
```

Phase A then adds the cross-language path:

```text
WM source -> wm-mini compiler -> JS library -> TypeScript import -> typed adapter
```

Neither step waits for an LSP rewrite.
