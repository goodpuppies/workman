# WM-native structural LSP plan

> Execution order is frontend-first. See
> [`frontend-v2-migration.md`](./frontend-v2-migration.md) for the authoritative
> bootstrap and migration sequence. This document describes the structural/LSP
> architecture and feature acceptance criteria.

## Goal

Build a new language server in WM whose syntax model treats incomplete source as a
valid editor state. The initial user-visible feature is structural inlays for
missing syntax such as `?`, `_`, `;`, delimiters, and small required keywords or
operators. The system should later become the primary WM LSP.

This is not a line-by-line port of the Grain server. The Grain implementation is a
behavioral reference and test corpus. The new design should fit `wm-mini`'s smaller
language, compiler facts, JavaScript backend, and per-source-file size discipline.

## Why this requires a new syntax layer

The current `wm-mini` parser is a strict Peggy grammar. It returns a complete AST or
throws one `ParseError`. That is suitable for batch compilation, but it cannot be
the structural editor model: an editor document is routinely missing a token,
contains half of a declaration, or has an unmatched delimiter.

The advanced LSP therefore needs a tolerant, lossless syntax layer in addition to
the compiler's semantic AST. It must preserve concrete tokens and trivia, represent
missing syntax explicitly, and always produce a valid traversable structural tree
for every finite text buffer.

The structural editor tree is the authority for the interpreted source structure.
The compiler AST remains the authority for elaborated language semantics after the
structural tree projects into the semantic frontend. The literal file is authored
evidence, not necessarily a complete serialization of every interpreted token.

## Non-goals for the first implementation

- Rewriting the compiler or Hindley-Milner inference engine in WM.
- Incremental tree surgery before whole-document performance has been measured.
- Automatically rewriting authored text. Structural completions begin as inlays;
  materialization remains an explicit user action until later editor features.
- Replacing diagnostics, hover, definitions, and formatting in the first slice.
- Porting the Grain infection/layer-2 type system into `wm-mini`.
- Making every malformed byte sequence meaningful. Recovery may stop at a bounded
  opaque/error node while keeping the rest of the document available.

## Architecture

```text
                         concrete source + document version
                                      |
                                      v
                         lossless lexer (WM)
                                      |
                                      v
                   tolerant parser / structural tree (WM)
                     | concrete nodes | holes | marks |
                                      |
                 +--------------------+--------------------+
                 |                                         |
                 v                                         v
       virtual renderer + repair map             structural diagnostics
                 |
                 +--------------------+
                                      |
                                      v
                        inlay projection/filtering
                                      |
                                      v
                          LSP inlay hint response

Later semantic path:

  virtual-complete snapshot -> existing compiler analysis bridge
                            -> typed facts in virtual offsets
                            -> repair/source map
                            -> type inlays, hover, definitions, diagnostics
```

### 1. Host boundary

Keep the WM/JavaScript boundary narrow and explicit. The likely bootstrap surface is:

- read and write byte chunks on stdio;
- parse and serialize JSON values;
- monotonic time and debug logging to stderr;
- read files and obtain canonical paths;
- call a small adapter around the existing compiler analysis API.

The server loop, framing state machine, document store, caches, recovery parser, and
feature logic belong in WM. If an operation is awkward because the WM FFI lacks a
safe type, improve reflection or the shared WM wrapper rather than moving the
feature into a new TypeScript/JavaScript helper. Narrow adapters inside the
already-existing TypeScript compiler are permitted only for DTO/semantic-service
integration and must not own frontend behavior.

The compiler bridge should exchange plain records/lists and stable IDs, not expose
TypeScript compiler objects. A first response shape can contain diagnostics,
inferred schemes by node/span, resolved-definition spans, and module dependencies.

### 2. Lossless tokens

Every token needs:

- kind and concrete text;
- byte/UTF-16-safe source span policy;
- leading/trailing trivia or explicit trivia tokens;
- concrete versus virtual origin;
- a stable order at shared zero-width anchors.

LSP positions are UTF-16 code-unit offsets. Internal offsets may use another unit
only if conversion is centralized and tested with non-ASCII text. The simplest
initial rule is to make source offsets and line maps explicitly UTF-16-compatible
because the JS backend uses JavaScript strings.

### 3. Structural tree and recovery

The detailed normative model is
[`tolerance-and-recovery-model.md`](./tolerance-and-recovery-model.md). The short
description here is architectural context, not a separate recovery specification.

Use an editor-specific tree rather than weakening the semantic AST. Its minimum
forms are:

- `Present` token/node;
- `Missing` expected token or category at a zero-width anchor;
- `Error`/`Opaque` concrete source that could not be classified;
- `HoleExpr`, `HolePattern`, and `HoleType` where an absent construct has a semantic
  category;
- ordinary declaration, expression, pattern, type, and list nodes.

Recovery rules must be local and deterministic. Prefer insertion when the next
concrete token is a good synchronization point; otherwise consume a bounded opaque
region. Synchronize on top-level declaration starters, semicolons, commas, closing
delimiters, and match-arm boundaries. Every recovery action emits a `RepairArtifact`
rather than being hidden in parser control flow.

Suggested repair model:

```wm
type RepairClass =
  | LocalInsert
  | PairedOpen
  | PairedClose
  | StructuralHole
  | RecoveryBoundary;

record RepairArtifact {
  id: Number,
  anchor: Number,
  text: String,
  reason: String,
  class: RepairClass,
  pairId: Option<Number>,
  order: Number,
}
```

Exact syntax will follow the WM subset available when implementation starts.

### 4. Virtual rendering and source mapping

Render the structural tree in two modes:

- `Concrete`: reproduces the user's source exactly.
- `Virtual`: includes repair artifacts and can be fed to semantic analysis.

Rendering returns text plus a bidirectional piece map between concrete and virtual
offsets. Shared-anchor repairs must retain parser/renderer order; sorting only by
anchor is insufficient. Repairs inside comments or opaque lexical regions must
never become inlays.

The virtual renderer is not the full formatter. Formatting and structural repair
can share a document model later, but the first renderer should avoid whitespace
rewrites so offset mapping stays simple and auditable.

### 5. LSP core

Implement only the protocol needed for the first slice:

- `initialize`, `initialized`, `shutdown`, and `exit`;
- full-sync `didOpen`, `didChange`, and `didClose`;
- `textDocument/inlayHint`;
- JSON-RPC framing with partial and multiple messages per byte chunk;
- serialized stdout writes and stderr-only logging.

Cache analysis by `(uri, version)`. A response must be computed from a captured
document version and discarded if that version is stale before publication. Start
with full-document lex/parse; add incrementality only after benchmark evidence.

### 6. Inlay policy

Structural inlays are the LSP rendering of syntax present in the interpreted
structural document but absent from the text buffer. Some are repairs; others are
lightweight canonical completions. They should:

- honor the requested LSP range;
- omit whitespace-only artifacts;
- keep paired/shared-anchor tokens in structural order;
- use separate hints for separate tokens (`}` then `;`, not `};`);
- avoid comments and opaque source;
- expose enough metadata for future commands such as “materialize this repair”;
- be suppressible independently from type inlays.

The first supported repairs should be chosen by usefulness and low ambiguity:

1. missing top-level semicolon;
2. missing expression RHS as `?`;
3. missing binding pattern as `_`;
4. missing closing `)`, `]`, or `}` when the opener is known;
5. missing match-arm comma;
6. missing lambda parameter list/body delimiters where the surrounding form is
   unambiguous.

Do not initially synthesize arbitrary identifiers or large grammar fragments.

## Delivery sequence

The detailed frontend steps and bootstrap rules are in
[`frontend-v2-migration.md`](./frontend-v2-migration.md). This is the coherent
cross-component sequence.

### Phase 0 — standalone WM frontend proof

Create the frontend-v2 WM package and a WM-only executable/self-check before adding
the JavaScript library boundary. Implement enough lossless lexing, structural data,
one tolerant recovery such as `let thing =`, and virtual preview rendering to prove
the model can be expressed and run comfortably in current `wm-mini`.

This code is the beginning of frontend v2, not a throwaway prototype. The harness
may be temporary; the lexer, marks, fallback, and renderer become normal package
modules.

Exit criteria:

- `wm run` can execute the frontend proof without TypeScript importing it;
- authored text round-trips exactly;
- the incomplete sample always has a valid structural interpretation;
- the preview exposes expected virtual structure and recovery classes;
- missing language/standard-library capabilities are recorded before the frontend
  architecture depends on workarounds.

### Phase A — importable WM libraries

Add an explicit JavaScript library-emission target. Prove that TypeScript can import
a compiled WM module and call exported plain-data functions without invoking
`main`.

This phase exists because frontend v2 must be useful to the current TypeScript
compiler before a WM LSP process exists.

### Phase B — frontend package and lossless lexer

Create the WM frontend-v2 package, public DTO/version boundary, lossless token and
trivia model, concrete renderer, generated JavaScript artifact, and TypeScript
loader.

Exit criteria include exact concrete round trips, correct UTF-16/line maps, and
successful TypeScript calls into the generated lexer artifact.

### Phase C — tolerant parser and structural document

Implement the total tolerant parser, structural AST, marks, typed fallbacks,
concrete/virtual rendering, source maps, and auditable structural diagnostics in
WM.

Exit criteria include:

- every finite buffer produces a valid structural document;
- concrete rendering is byte-for-byte identical to authored text;
- every inserted/fallback structure has one stable mark and deterministic artifact
  order;
- fully explicit canonical files have no missing-syntax marks;
- flexible files receive only justified optional/auto-fix/recovery marks;
- relevant `research/workmangr` structural regression behavior is ported.

### Phase D — semantic projection and compiler comparison

Compile frontend v2 to an importable JavaScript artifact. Translate its semantic
projection into the current TypeScript `Module` shape, compare it with Peggy, and
run compiler/check suites in v2 and comparison modes.

Exit criteria include semantic AST parity for supported valid source, one isolated
DTO adapter, measured conversion cost, and no downstream compiler dependency on
frontend-v2 internals.

### Phase E — TypeScript compiler and current-LSP adoption

Make frontend v2 the default compiler frontend after parity.

Before rewriting the LSP, use the same structural result in the current TypeScript
server for:

- multiple structural diagnostics;
- structural-token inlays;
- semantic analysis through holes/fallbacks;
- concrete/virtual source mapping;
- existing hover, definition, and type-inlay behavior.

This proves the frontend and delivers structural-editor value without waiting for
transport work.

### Phase F — rebuild the structural-editor LSP in WM

First prove a small WM executable can handle framed JSON-RPC on stdio without
corrupting stdout. Then port features in dependency order.

Host deliverables:

- WM modules for byte framing, JSON envelopes, serialized output, and stderr-only
  logging;
- a TypeScript black-box process test with fragmented and multiple frames;
- startup and framing benchmarks;
- versioned document state and stale-result cancellation rules.

The server imports frontend v2 as a normal WM module. It does not recreate lexing,
recovery, virtual rendering, or structural diagnostics.

Feature order:

1. lifecycle and document synchronization;
2. structural inlays and syntax diagnostics;
3. TypeScript semantic-service bridge;
4. type inlays, hover, definitions, and module invalidation;
5. formatting/materialization commands and richer structural interactions.

Treat the old Grain LSP as the behavioral reference for structural editing. Port
its tests and preview expectations before redesigning behavior. Reuse existing
TypeScript compiler facts; do not recreate name or type resolution from token text.

Exit criteria:

- current `tests/lsp_*` behavior passes against the WM server;
- selected `research/workmangr/tests/lsp_*` structural behavior passes with syntax
  adaptations documented;
- dependency edits clear stale diagnostics in open dependents;
- VS Code can select the WM server by default with a temporary fallback during
  rollout.

### Phase G — advanced editing, incrementality, and cleanup

Add explanation/materialization interactions, structural selections, ambiguity
choices, and other editor features on the shared document model. Profile real edit
traces before adding incremental line maps, token/subtree reuse, worker isolation,
or concurrency. Remove the old TypeScript server only after parity and soak time.

## Test strategy

Use three layers:

1. Pure WM unit/golden tests for lexing, recovery, rendering, ordering, and maps.
2. TypeScript black-box tests for process startup, framing, cancellation/staleness,
   and exact LSP payloads.
3. VS Code smoke tests for visual behavior and configuration.

Seed the regression corpus with the Grain cases for:

- type inlays under a missing semicolon;
- missing match body braces and arm commas;
- multiple virtual tokens at one anchor;
- inferred hole before a semicolon;
- missing lambda parameter/body structure;
- missing binding patterns;
- no artifacts inside imports/comments.

Add property tests or fuzz-style bounded tests for these invariants:

- parser termination and progress;
- concrete round trip;
- monotonic source-map segments;
- applying artifacts in declared order equals virtual rendering;
- every returned inlay position is within the document and requested range.

## Performance policy

The Grain attempt showed that implementation language/runtime overhead can dominate
once the editor pipeline grows. Avoid reproducing that failure mode by setting
measurement gates early:

- benchmark lex, parse, render, and JSON serialization separately;
- record cold and warm timings;
- use representative complete and incomplete files;
- keep an edit-trace benchmark, not just repeated hover on an unchanged snapshot;
- cap caches by document/version rather than retaining every historical tree;
- avoid repeated tokenization within one request;
- keep every maintained code file at or below the repository's hard 500-line limit;
  Markdown is exempt;
- split files along coherent ownership/phase boundaries before they cross the
  limit, rather than scattering one algorithm arbitrarily.

Do not add concurrency before state ownership and version cancellation are explicit.
A fast whole-document parser is preferable to a fragile incremental parser at this
stage.

## Bootstrap risks and decisions still to validate

1. **Streaming FFI ergonomics.** WM can reach Deno/JS APIs, but stdio streaming and
   byte-array operations need a compile-and-run spike before the architecture is
   considered proven.
2. **Compiler API boundary.** The existing compiler is TypeScript and its internal
   objects are not a stable WM FFI. Define a plain-data adapter rather than importing
   internals ad hoc.
3. **Parser duplication during migration.** Frontend v2 and Peggy can drift while
   both exist. Run a valid-source corpus through both and compare normalized syntax
   and semantic projections. The target is to make frontend v2 the compiler parser
   and retire Peggy after parity, not preserve two permanent syntax authorities.
4. **Offset units.** Settle UTF-16 versus byte/code-point semantics before storing
   persistent spans.
5. **Hole semantics.** Structural holes initially make editor snapshots analyzable;
   runtime/compile acceptance of explicit `?` is a separate language decision.
6. **VS Code rendering limits.** Standard inlay hints are non-editable visual text.
   Materializing or navigating structural repairs will require commands, code
   actions, decorations, or a custom editor layer later.

## Immediate next slice

Begin with the standalone WM frontend proof:

1. Create the frontend-v2 WM package and minimal structural data types.
2. Implement a narrow lossless lexer and exact concrete renderer.
3. Implement one tolerant `let thing =` recovery with a typed fallback and mark.
4. Render ordered virtual `?` and `;` artifacts in a marked preview.
5. Verify the result through WM assertions executed by `wm run`.
6. Record missing WM/standard-library capabilities before expanding the frontend.

After that proof, add importable-library emission and the TypeScript adapter around
the working WM package.

The WM JSON-RPC/stdio spike moves after the frontend is useful from TypeScript. It
remains a required gate before the LSP rewrite, but it should not block frontend
adoption or structural improvements in the current server.
