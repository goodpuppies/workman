# Current state and research inventory

## Current server

The current language server lives in [`../../src/lsp/`](../../src/lsp/). Its advertised protocol
surface is:

- full text-document synchronization with open, close, change, and save;
- push diagnostics;
- hover;
- go to definition;
- go to type definition;
- find references;
- document highlights;
- prepare rename and project-scoped rename;
- document symbols;
- workspace symbols over active projects and open detached contexts;
- completion;
- signature help;
- full-document semantic tokens;
- ordinary inferred-type and parameter-name inlay hints;
- frontend-v2 structural inlay hints.

Completion is now compiler-owned and covers lexical/prelude values, constructors, type positions,
project and basis namespaces, nominal record fields, keywords, recovery-only names, and contextual
GPU builtins. It also discovers public value/constructor/type exports in unfinished named-import
clauses and nearby disk/virtual module paths. Compiler-produced expected types rank candidates in
annotations, calls, operators, lambda returns, match arms, record fields, conditions, unary
expressions, panic messages, recursive bindings, and pipes. Local/import/basis origin tiers and
declaration proximity are implemented. Expected-type recovery within uncertified phrases remains.

### Current strengths

Diagnostics:

- analyze unsaved source overrides;
- publish imported-module errors on the imported file;
- retain diagnostic codes and related information;
- clear stale diagnostics after the set of analyzed files changes;
- revalidate transitive dependents using a workspace dependency index;
- include specialized FFI and GPU elaboration failures.

Hover:

- displays inferred schemes and occurrence-local instantiated types;
- handles local pattern binders and constructors;
- preserves useful partial types after some FFI failures;
- distinguishes host types from GPU representation types;
- avoids exposing generated FFI helper details as if they were source types.

Navigation:

- resolves lexical locals;
- distinguishes value and type namespaces;
- follows named, open, and namespace imports;
- resolves types, constructors, record constructors, and module qualifiers;
- consumes unsaved source for modules in the selected project snapshot;
- respects `includeDeclaration` for references.
- derives definition/reference identity entirely from compiler-owned module interfaces;
- excludes unrelated open-document projects from reference scope;
- retains current compiler-certified navigation after independent malformed phrases.
- emits role-aware standard workspace edits for safe renames;
- distinguishes local named-import alias rename from imported-target rename;
- refuses incomplete, non-editable, lexically invalid, and structurally ambiguous renames.
- follows inferred nominal and composite types to their declarations;
- highlights identity-correct reads and writes, including local import aliases and recovered facts.

Project behavior:

- discovers `.wm` files in every initialization workspace root;
- scans imports even when full parsing is unavailable;
- maintains dependency and reverse-dependency edges;
- selects and retains compiler snapshots through `ProjectContextRegistry`;
- reuses an active project when it already reaches an opened file;
- preserves distinct snapshots for overlapping headed projects;
- treats uncovered files as detached contexts when no closest head exists;
- handles watched file changes and deletion cleanup.

The current focused compiler-interface/LSP/project/binding/frontend-v2 compatibility run covers
validation, hover, navigation, references, rename, symbols, completion recovery, ordinary and
structural inlays, signature help, semantic tokens, import scanning, project selection, and
server-level request behavior. The generated GPU builtin suite adds 27 passing hover, completion,
diagnostic, and specialization tests.

### Current limitations

General semantic analysis now has one LSP-owned lifetime:

- `SemanticService` owns `ProjectContextRegistry` and immutable compiler snapshots;
- validation and every ordinary semantic request reuse the selected current snapshot;
- source changes invalidate every snapshot whose forward closure contains the changed path;
- open-document selections survive invalidation and are rebuilt against their original head when
  membership remains valid;
- strict compiler failures are retained beside recovered interfaces so diagnostics can avoid
  secondary importer cascades while editor queries still use current partial facts.

Frontend-v2 structural inlays still use a separate syntax-only parse cache. They do not reconstruct
semantic names or types.

Other limitations:

- expected-type recovery does not yet reach inside uncertified phrases;
- ordinary inferred-type inlays and reliable named-Workman-call and record-constructor parameter
  hints are implemented; alias/curried/foreign parameter hints and hole/partial-type hints are not;
- references remain intentionally scoped to the selected project snapshot rather than crossing every
  active project;
- the semantic service has coarse closure invalidation but not document/workspace revision tokens,
  in-flight analysis sharing, cancellation, or stale-publication rejection;
- semantic tokens currently cover compiler-owned symbols only; lexical keywords, literals, comments,
  and operators remain grammar-owned, and token deltas/ranges are not implemented;
- no formatting or code actions;
- file watching is installed by the VS Code client rather than negotiated by the server;
- most configuration is passed through process environment variables;
- read requests can run concurrently and cancelled/stale responses are suppressed, but compiler work
  is not cooperatively aborted and diagnostics remain serial with document mutations;
- lifecycle and common JSON-RPC errors are implemented, but method-specific invalid-parameter
  validation is incomplete;
- the portable Node bundle is packaged inside the VSIX rather than presented as a standalone
  editor-neutral server artifact.

## `research/workman-old`

The old TypeScript/Deno server advertises diagnostics, hover, definition, references, completion,
and inlay hints. Its AST and type system are no longer current, so it is a behavioral reference
rather than a source to port mechanically.

Behavior worth recovering:

- environment completion with lexical visibility checks;
- type-directed completion scoring;
- inferred types beside let binders and record fields;
- parameter-name hints for Workman and reflected foreign functions;
- explicit hole/partial-type hints;
- detailed record and datatype hover rendering;
- a tolerant-analysis mode for editor queries.

Lessons from its unfinished refactor plan:

- hover, inlay, signature, and diagnostics had diverging type formatters;
- string post-processing of formatted types became fragile;
- module contexts helped performance but did not provide a clean, query-oriented analysis API;
- type-directed completion should rank weak matches lower, not necessarily hide them when analysis
  is incomplete.

## `research/workmangr`

WorkmanGR's server has a smaller ordinary protocol surface—diagnostics, hover, definition,
formatting, and inlays—but contains valuable performance and recovery experiments.

Reusable ideas:

- a graph epoch used in inference cache keys;
- cached module summaries with reuse/recompute accounting;
- per-document version caches;
- cached line starts;
- diagnostic fingerprints that suppress unchanged publications;
- explicit timing instrumentation around graph, inference, hover, and inlay work;
- source-size limits for expensive optional features;
- semantic indexes separated from request serialization;
- recovery-aware queries that still return facts from imperfect source.

The formatter-derived structural inlays and custom preview workflow belong to the advanced
structural-editor plan, not this general LSP update.

## Millet

Millet's current LSP surface includes:

- diagnostics;
- hover;
- definition and type definition;
- references;
- completion;
- document symbols;
- inferred-type inlay hints;
- formatting;
- code actions.

More important than the feature list is its architecture:

- lossless concrete syntax accepts partial and malformed programs;
- lowering retains missing subnodes rather than rejecting the entire tree;
- analysis passes return their best output together with accumulated errors;
- HIR-to-syntax and syntax-to-HIR mappings connect semantic facts to source;
- the `analysis` crate owns language queries;
- the language-server crate is mostly state management and conversion between analysis and LSP
  types.

That separation is the main model for this update.

## Summary

The current Workman server should remain the base. It is ahead of the older servers in diagnostics,
dependency invalidation, specialized type hover, and navigation breadth. The update should recover
the older user-facing completion and inlay behavior, adopt WorkmanGR's cache discipline, and use
Millet's analysis/LSP separation as the organizing architecture.
