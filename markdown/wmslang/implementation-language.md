# Implementation language for wmslang

Status: implementation-boundary decision based on the current Workman compiler, frontend v2, and
GLML sources.

## Decision

Do not implement all of wmslang in one language.

Use **TypeScript for integration with the existing compiler and external toolchain**, and use
**Workman for the self-contained wmslang compiler core** once input has crossed a narrow,
versioned boundary.

The intended split is:

```text
TypeScript: Workman parser, HM integration, binding IDs, module graph
    -> versioned GpuElaborationInput DTO
Workman: GPU constraints, typed shader IR, specialization and pure lowerings
    -> generated Slang + predicted ABI + diagnostics/debug snapshots
TypeScript: slang-wasm, reflection reconciliation, caching and emitted artifacts
```

This is not a compromise in which every pass is divided between two implementations. There should
be one substantial handoff into the Workman package and one result back. The Workman package should
look like an importable compiler library, following the precedent established by frontend v2.

The first vertical slice should prove this split before the large functional passes are ported. If
the Workman slice cannot meet correctness, performance, or diagnostic requirements, its DTO allows
the implementation to remain in TypeScript without changing wmslang's source semantics.

## Why not all TypeScript

An all-TypeScript implementation would be the fastest route to the first generated shader. It also
has direct access to the current AST, mutable HM types, `Map`/`Set`, source diagnostics, Deno,
`slang-wasm`, and compiler artifacts.

It has two longer-term costs:

1. wmslang's functional middle-end would be written in a language with different invariants from
   the source language it implements. Immutable ADTs, recursive transformations, pattern lowering,
   ANF, and tail-call conversion are natural Workman programs.
2. It would miss a valuable self-hosting pressure test. A compiler package large enough to compile
   creative functional shaders will expose missing Workman library and performance capabilities in
   a useful, bounded context.

TypeScript remains the fallback for a pass whose data-structure or performance requirements are
not yet practical in Workman. The architecture must not make the implementation language part of
the user-visible wmslang semantics.

## Why not all Workman

Frontend v2 proves that Workman can already implement a nontrivial compiler component:

- its Workman sources are roughly 5,200 lines;
- they implement lossless lexing, tolerant parsing, recovery state, recursive surface trees,
  rendering, and semantic projection;
- `compile-library` emits an importable ES module;
- the stable entry module exposes schema-versioned JavaScript-native DTOs;
- TypeScript dynamically loads and validates that boundary.

That is strong evidence for writing tree transformations in Workman. It is not evidence that the
entire current compiler can be moved there today.

The live HM implementation is about 6,300 lines of TypeScript across `types.ts`, `infer.ts`, and
`src/infer/`. It depends on behavior which is not yet available through an equally direct,
fully typed Workman library surface:

- mutable union-find-like type variables whose `instance` field is filled by unification;
- object-identity maps from surface expressions and patterns to inferred facts;
- mutable `Map` and `Set` environments and work sets;
- callback constraints attached to type variables;
- staged TypeScript FFI elaboration and diagnostic objects;
- direct access to the module graph and Core artifact pipeline.

Rewriting that machinery is not required to implement wmslang. Doing so now would combine three
risks: shader-language design, a second HM implementation, and a larger self-hosting bootstrap.
The `@gpu` island should reuse the existing checker through a TypeScript integration layer, then
hand normalized facts to the Workman-owned shader compiler.

The Slang service also belongs in TypeScript. It owns WASM loading, async calls, target selection,
binary/text results, versioned caches, and error handling at an external API boundary. None of that
benefits from being expressed as a recursive Workman compiler pass.

## What each side owns

| Component | Initial owner | Reason |
| --- | --- | --- |
| Directive parsing in frontend v1 | TypeScript | It modifies the current compiler parser. |
| Directive parsing in frontend v2 | Workman | It belongs to the existing Workman-native frontend package. |
| Region-aware FFI traversal | TypeScript | It changes an existing deeply integrated host pass. |
| Scoped HM dialect hooks | TypeScript | They reuse the live `Ty`, unifier, facts, and diagnostics. |
| Stable binding and constructor IDs | TypeScript | They must be shared by host Core and shader analysis. |
| Module reachability and artifact roots | TypeScript | The module graph and compilation orchestration already live there. |
| Normalized GPU input construction | TypeScript | It snapshots mutable compiler state into an immutable ABI. |
| GPU scalar/vector constraints | Workman | This is a closed recursive solver over wmslang types, not host HM. |
| Type reification and capability checks | Workman | They define the shader dialect after ordinary HM inference. |
| Typed functional shader IR | Workman | ADTs and immutable recursive trees are the natural representation. |
| Monomorphization | Workman | It is a pure reachable-program transformation once types and IDs are stable. |
| ADT and pattern lowering | Workman | It maps one typed functional tree into another. |
| Lambda lifting and defunctionalization | Workman | They are closed transformations over the shader graph. |
| ANF and tail-call lowering | Workman | They benefit directly from Workman's recursive functional style. |
| Slang source generation | Workman | It is deterministic tree-to-text lowering and keeps backend naming with the IR. |
| Slang WASM invocation | TypeScript | It is external async toolchain integration. |
| Reflection reconciliation | TypeScript | It compares backend output with host artifact/resource contracts. |
| Cache, WGSL embedding, JS emission | TypeScript | These are existing compiler/toolchain responsibilities. |

Some ownership may move later, but avoid alternating TypeScript and Workman at every pass. In
particular, do not make each Workman transformation serialize an IR back to TypeScript before the
next transformation.

## The handoff ABI

The boundary must not expose the current mutable `Ty` object graph or use JavaScript object identity
as semantics. It should use numbers and closed discriminated records.

An initial conceptual input is:

```text
GpuElaborationInput {
  schemaVersion
  roots: ShaderRootId[]
  functions: GpuFunctionInput[]
  bindings: GpuBindingInput[]
  types: NormalizedType[]
  schemes: NormalizedGpuScheme[]
  expressions: GpuExprInput[]
  adts: GpuAdtInput[]
  spans: SourceSpan[]
}
```

Important properties:

- functions, bindings, constructors, types, expressions, and spans have stable numeric IDs;
- recursive types and expression references use those IDs rather than nested pointer identity;
- ordinary HM types are pruned and normalized before crossing;
- literal spelling facts and deferred GPU constraints are explicit;
- unsupported host/FFI nodes become explicit rejected capabilities, not arbitrary JS values;
- the DTO is JavaScript-native at the boundary, while Workman may convert it to private lists and
  ADTs internally;
- a schema version makes bootstrap mismatches fail clearly.

The output should be similarly closed:

```text
GpuCompilationOutput {
  schemaVersion
  programs: GeneratedShaderProgram[]
  diagnostics: GpuDiagnostic[]
  predictedManifests: PredictedShaderAbi[]
  debugSnapshots: GpuPassSnapshot[]
}
```

Each generated program contains Slang source, source-map/provenance data, stable entry names, and
enough target-independent identity for TypeScript to attach Slang diagnostics and reflection.
Large debug snapshots can be optional outside tests and diagnostic builds.

## Bootstrap and dependency direction

The Workman wmslang core must be ordinary CPU Workman. Compiling the compiler package must not
require `@gpu` support. That avoids a circular bootstrap:

```text
existing wm compiler
  -> compile tooling/wmslang/*.wm as an ES library
  -> new wm compiler imports that generated library
  -> new wm compiler can elaborate @gpu programs
```

The generated library should be reproducible and ignored in the same way as frontend v2's current
artifact. Tests should build it into a temporary directory and load it through a validating
TypeScript wrapper.

Do not let the Workman core call back into internal TypeScript inference functions. Its only inputs
are the normalized DTO and stable configuration; its result contains data, not compiler callbacks.
This keeps bootstrap versions testable and allows the core to be run independently on fixtures.

## What GLML can actually contribute

GLML is especially useful if the middle-end is written in Workman, but the reuse is mostly
**semantic and algorithmic**, not textual.

Good candidates to port are:

- its deferred constraint work-list structure and concrete/deferred split;
- occurs checks and structural substitution tests;
- reachable specialization and recursive-specialization guards;
- tuple, ADT, and pattern-lowering cases;
- lambda lifting and defunctionalization invariants;
- ANF normalization;
- tail-call parameter rebinding and argument-order tests;
- creative examples and pass snapshots as behavioral fixtures.

A line-for-line source port is not a good goal. GLML is built with OCaml Core and `ppx_jane`; its
compiler makes extensive use of maps, sets, hash tables, exceptions, derived equality/sexp
printers, labeled arguments, module interfaces, and rich `List` combinators. Workman has the ADTs,
pattern matching, records, functions, and recursion required for the algorithms, but not the same
library vocabulary or module system.

Port each algorithm against the smaller wmslang IR, using explicit `Result` diagnostics and
tail-recursive state passing where appropriate. Workman's JavaScript interoperability is a normal
language facility, not a last-resort escape hatch, so these ports do not need to recreate every
OCaml utility in pure Workman.

## Compiler utility policy

The main missing compiler utility should be filled by a small persistent Workman map, specified in
[`compiler-collections.md`](./compiler-collections.md). A generic ADT prototype already verifies
that the current compiler can infer `empty`, `get`, and persistent `set` correctly.

### Persistent Workman maps

Add a comparator-based AVL `Map<K,V>` to Workman `std`. Use it for lexical environments,
substitutions, deterministic registries, and other state where old versions must remain valid.
wmslang keys these maps primarily with stable numeric semantic IDs, so the initial library only
needs a pure numeric comparator.

Keep the first API small: lookup, persistent insertion, ordered folding/extraction, and eventually
balanced removal/update. More OCaml Core combinators can be expressed locally until repeated use
justifies expanding `std`.

### TypeScript utility modules imported by Workman

A local TypeScript module is appropriate for operations which are naturally implemented with the
JavaScript runtime: sorting, hashing, dense indexing, byte manipulation, or a tuned mutable work
queue. This follows the existing examples that import local modules and reflected libraries.

Prefer a coarse operation over a chatty bridge. For example, a TS helper may build an index from a
DTO array and return a DTO result; avoid making every recursive Workman node visit cross into
TypeScript. Export a concrete, reflection-friendly type surface, and retain normal `Result` error
handling unless the helper is a proven compiler-internal invariant where an unsafe import is
deliberately justified.

### Other utilities implemented in Workman

Implement a utility in Workman when its semantics are part of the functional compiler design or it
is broadly useful without relying on JavaScript identity. Likely candidates include:

- indexed list/array traversal helpers;
- `map2`/`fold` helpers with explicit unequal-length errors;
- deterministic fresh-ID and name state;
- structural equality/debug rendering helpers for compiler ADTs;
- small pass-specific sets, work lists, and state records.

Start wmslang-specific helpers inside the wmslang package and promote them only after their API
proves general. The persistent map is the exception because its semantics are already independently
useful to frontend/tooling packages and its generic implementation has been verified directly.

GLML is MIT licensed. If a function is translated closely enough to be a substantial copy rather
than an independent implementation of the algorithm, retain the required license notice and note
its origin. Tests and high-level pass designs can be adapted without pretending the OCaml source is
directly reusable Workman code.

## Performance risk

Frontend v2 also supplies a warning, not only encouragement. Its own history records a quadratic
recovery scan that made a corpus pass take about 79.6 seconds before an algorithmic fix reduced it
to 5.7 seconds; a generated runtime representation change then reduced two passes to about 1.5
seconds. Functional code is not inherently too slow, but list scans and allocation patterns matter.

The wmslang core therefore needs per-pass counters and corpus benchmarks from its first slice:

- number of functions and expression nodes visited;
- constraint queue iterations and deferrals;
- environment lookup count and worst depth;
- number of generated specializations;
- IR node counts before and after each lowering;
- generated Slang size and total compilation time.

Do not begin with association lists everywhere and assume they will scale. A small shader can hide
quadratic behavior that a creative library of combinators exposes. Conversely, do not move a pure
pass back to TypeScript based on intuition alone; measure the generated Workman implementation.

## First proof

Build a narrow H1 compiler library before implementing the full Phase 2:

1. TypeScript parses one `@gpu` lambda, runs normal HM inference, assigns stable IDs, and creates a
   versioned input containing literals, variables, `let`, calls, tuples, arithmetic, and `if`.
2. Workman validates the DTO, solves scalar/vector constraints, reifies homogeneous triples as
   vectors, builds typed functional IR, and emits one Slang helper plus source provenance.
3. TypeScript validates the output, compiles the Slang with `slang-wasm`, and reports backend
   diagnostics against Workman spans.
4. Tests snapshot the normalized input, Workman typed IR, generated Slang, and Slang result.
5. A benchmark compiles a generated graph with many helpers and constraints to expose poor lookup
   or recursion behavior early.

The proof succeeds only if the split preserves actionable diagnostics and remains simple to debug.
“It generated valid Slang” is necessary but insufficient.

After that proof, implement the remaining pure Phase 2 work and Phase 4 lowering in Workman. Port
the GLML-inspired Phase 5 passes one at a time, with an IR snapshot and semantic test for each.

## Revisit conditions

Keep a pass in or move it to TypeScript when one of these is demonstrated rather than assumed:

- its required lookup complexity cannot be achieved with the available Workman runtime/library;
- generated-code allocation or recursion behavior fails the agreed shader corpus benchmark;
- debugging across the generated-library boundary loses source provenance;
- it must manipulate live host `Ty` identity, FFI obligations, the module graph, or Core artifacts;
- it depends directly on an async or binary external API.

Move more work into Workman when a stable DTO can replace live TypeScript state and the operation is
a deterministic transformation over closed compiler data.

The resulting principle is simple: **TypeScript owns mutable host compiler state and toolchain
effects; Workman owns the pure shader-language compiler.**
