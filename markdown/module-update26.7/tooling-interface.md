# Compiler tooling interface and Millet comparison

## Status

This document fixes the tooling handoff required before the general LSP update resumes. It compares
the intended compiler boundary with Millet and with Workman's current language server.

The central decision is:

> The compiler-produced per-module semantic interface is the sole supported semantic API for the
> LSP, frontend-v2, and future editor integrations.

This does not forbid a frontend from exposing concrete syntax, tokens, recovery artifacts, or
structural-editor layout. It means that every claim about names, scopes, modules, types, nominal
identity, constructors, imports, or runtime/compiler identity comes from this interface. A tooling
consumer may not fill a missing compiler fact by implementing a second resolver or type model.

## Artifact and ownership model

The artifact is per module **and per headed project snapshot**:

```text
ProjectSnapshot
  head ModuleId and project configuration
  source revisions and overrides
  basis profile and generation
  module graph and resolver state
  ModuleInterface(ModuleId)*
```

A filesystem path is not a sufficient key. The same source may be analyzed:

- as a member of project A;
- under different configuration as a member of project B;
- as an explicitly opened, detached document;
- as a reference-only file that must not participate in either project.

Each context has its own project snapshot and snapshot-local `ModuleId`s. The stable lookup key is
conceptually `(ProjectSnapshotId, ModuleId)`, even if the opaque `ModuleId` token already carries
snapshot ownership in the first implementation.

The project-wide index is an aggregation of module interfaces. It is not another source of semantic
truth.

## Required contents

The name `ModuleInterface` includes more than an export signature. It is the module-shaped compiler
interface presented to semantic tooling and contains two related views.

### Public view

- opaque `ModuleId`;
- inferred public `Env = StrEnv × TyEnv × ValEnv`;
- origins and nominal identities;
- constructor identifier status;
- basis profile and generation;
- ordered dependency edges;
- resolved import occurrences;
- local structure aliases and their target modules;
- public declaration source locations;
- interface generation;
- diagnostics and explicit completeness.

### File-semantic view

- precise declaration and occurrence records;
- compiler-owned value, type, constructor, field, structure, and alias identities;
- occurrence roles such as declaration, use, import source, import alias, qualifier, and pinned
  reference;
- lexical scope/environment facts at source positions;
- generalized declaration schemes and occurrence-local inferred types;
- source-to-semantic and semantic-to-source mappings;
- module ownership and public/private status;
- Workman-specific FFI, GPU, carrier, and nominal-record facts where applicable.

These facts remain protocol-neutral. The compiler does not construct LSP hovers, locations,
completion items, semantic tokens, edits, or UTF-16 protocol ranges.

## Incomplete current source

The language service always queries an interface produced from the **current source snapshot**. It
does not silently answer from the last successful analysis and it does not invent a fallback
environment in the LSP.

Three different concerns must remain separate.

### SML-defined basis behavior

The Revised Definition's program rules define transactional top-level execution:

- a top-level declaration that fails elaboration contributes no change to the basis;
- a declaration that elaborates and evaluates successfully extends the basis;
- evaluation failure also prevents the declaration's static change from entering the resulting
  basis;
- processing later top-level declarations may continue from the last committed basis.

For a static tooling interface, the relevant rule is that only successfully elaborated declarations
extend the partial static basis. Later recovered declarations see the basis produced by preceding
successful declarations, not bindings tentatively produced by a failed declaration.

### Workman-defined syntax recovery

The Definition explicitly leaves parse-error handling to implementations because it depends on the
parser. Therefore SML does **not** by itself decide:

- how to find the end of a malformed declaration;
- whether to synthesize a missing token or hole;
- which later declarations remain parseable;
- which concrete range owns a recovery diagnostic.

These are compiler/frontend policies. They must produce explicit recovery artifacts and trustworthy
declaration boundaries. They are not LSP policies.

The existing Workman REPL provided the first implementation pattern: find top-level
semicolon-delimited phrases, mask a failing phrase, retain preceding successful phrases, and attempt
later phrases. `inferModulePartial` remains the conservative prefix primitive; recovered project
analysis now composes it into transactional continuation.

That conservative first interface is now implemented. `InferResult.elaboration` records the exact
successful declaration prefix, whether failure occurred while importing, elaborating a declaration,
or checking the final module boundary, and the compiler-owned recovery range. When a declaration
fails, inference does not return the already-mutated working maps: it re-elaborates only the
accepted prefix from a fresh initial environment. This is necessary because inference types are
mutable and rolling back map keys alone would not remove constraints imposed while attempting the
failed declaration.

`buildPartialProjectSnapshot` then constructs binding, nominal, occurrence, scope, and type facts
from those prefix modules only. An import after the failure is not installed, its target is not
pulled into the partial reachable project graph solely through that uncertified edge, and
declarations after the boundary contribute no occurrence or scope identities. Scope queries beyond
the boundary conservatively see the last certified sequential environment. The diagnostic and
recovery range remain attached to the current-source interface.

Transactional phrase recovery is now implemented as a compiler facility. The delimiter-aware phrase
scanner was extracted from the REPL and is shared by recovered parsing. A malformed phrase is
replaced with same-length whitespace, preserving every surviving AST offset and line. The parser
then sees later explicit top-level phrases normally. The compiler does not guess a boundary inside
one malformed phrase; finer token/delimiter recovery remains frontend-v2's responsibility.

After parsing, `inferModuleRecovered` repeatedly invokes the clean-prefix primitive. Each failing
declaration is removed, and the remaining declarations are re-elaborated from the initial basis.
Thus an independent later phrase sees the last committed environment, while a phrase that refers to
a failed binder produces its own failure and contributes nothing. This is intentionally full
re-elaboration rather than map rollback because earlier mutable inference types must not retain
constraints from either failed phrase.

Recovered graph loading applies the same rule to imports. A malformed or unresolvable import has a
compiler diagnostic and recovery range and makes import completeness partial. It contributes no edge
or scope binding, but a valid later import is still resolved and participates in the recovered
project closure. `analyzeRecoveredFile` and `analyzeRecoveredVirtual` return the resulting
current-source `ProjectSnapshot` directly.

Millet goes further through a lossless CST, parser recovery, lowering holes, and static analysis
that accumulates errors while retaining `Info`. That is the long-term frontend-v2 model, not a
reason to add equivalent recovery heuristics to the LSP.

### Explicit completeness

One boolean cannot describe the reliability of all facts. The interface should expose structured
completeness, initially at least:

```ts
type ModuleCompleteness = {
  syntax: "complete" | "recovered" | "unavailable";
  imports: "complete" | "partial";
  elaboration: "complete" | "partial";
  occurrences: "complete" | "partial";
  scopes: "complete" | "partial";
  ffi: "complete" | "partial" | "not-applicable";
  gpu: "complete" | "partial" | "not-applicable";
  recoveryBoundaries: readonly SourceRange[];
};
```

A query consumes only facts whose component is sufficiently complete. An unavailable fact produces
an explicit unavailable/ambiguous result; the tooling layer must not substitute a name-based guess.
Diagnostics and known facts from the current snapshot remain usable.

Incremental recomputation and sophisticated partial recovery are not first-priority requirements.
Correct full-snapshot production of this artifact comes first.

## Project isolation and difficult workspaces

Workspace folders are containers presented by an editor, not Workman projects. A project is one head
file containing `main` and that head's reachable import closure:

```text
Project(H) = Reachable(H), where H contains main
WorkspaceAnalysis = union of Project(H1), ..., Project(Hn)
```

The closures may overlap. An overlapping module receives a separate semantic interface in each
project snapshot, although parsing and other context-free work may later be reused.

The first project model must obey these rules:

1. A project consists only of one `main` head/configuration and modules reachable through resolved
   imports.
2. Merely existing under a workspace directory does not make a `.wm` file a project member.
3. Recursive workspace discovery must not cause unrelated files to be checked.
4. A source that belongs to more than one project receives a separate interface in each project
   snapshot.
5. An opened source belonging to no project receives a detached snapshot rather than being silently
   attached to a neighboring project.
6. Reference-only files and unrelated projects may be discoverable for explicit navigation, but do
   not contribute diagnostics, bindings, references, or rename edits to the active project unless a
   query explicitly selects that scope.
7. Cross-project aggregation preserves project identity. It never merges same-path or same-name
   semantic objects by accident.
8. A dependency that happens to define `main` remains an ordinary dependency. It becomes another
   head only when independently selected or discovered as a head.

This prevents the failure mode where a workspace-level command or language server checks every
nearby file even though only one import graph participates in the program.

Opening a document does not change project membership. Once a head is active, its project snapshot
already contains every module in its reachable graph, including interfaces for files that are not
open.

Document context lookup is:

```text
if openFile is in an active project's reachable graph:
  use that existing project context
else if closestHead(openFile) exists:
  activate Project(closestHead(openFile))
  use that project context
else:
  use a detached snapshot
```

The first branch performs no attachment or semantic mutation: the file, module identity, and
interface were already project members. The reverse-import index runs only for a file outside every
active project graph.

Selection and expansion are deliberately not recursive through one another:

```text
uncovered open file --reverse discovery--> closest head
closest head --forward resolution--> complete reachable project graph
```

The forward walk includes dependencies but never performs another upward head search from those
dependencies. In particular, walking down from an application head into lib3 cannot discover or
activate lib3's separate test/example head.

For example:

- an application project is active and reaches a lib3 implementation file: opening that file uses
  its already-existing application-project interface and activates nothing;
- no project is active and a lib3 implementation file is opened: its closest lib3 test/example head
  becomes active;
- an application project is active, but another opened lib3 file is outside its reachable graph:
  that file discovers the lib3 head, producing two active projects;
- a dependency merely contains `main`, but every open dependency file is already covered by the
  application graph: it remains an ordinary dependency and creates no project.

The reverse-import index is discovery data only. It may scan or parse import declarations, but doing
so must not typecheck the file, publish its diagnostics, add it to references, or make it a project
member. This preserves simple graph discovery without recreating the “check every workspace file”
problem.

This selection model is now implemented in two layers. Compiler `ProjectSnapshot`s explicitly record
whether they are `headed` or `detached` and the frontend/surface configuration that owns them.
`ProjectContextRegistry` keys active contexts by head and configuration, retains separate snapshots
for overlapping closures, and remembers the context originally selected for each open document.

`ReverseImportDiscoveryIndex` stores only syntax-scanned import edges and top-level `main`
candidates. Its reverse breadth-first search stops at the first distance containing a head;
equal-distance ties use canonical path order so selection remains deterministic and singular. The
registry first checks active forward closures. Only an uncovered file invokes this search. The
selected head is then expanded forward once through ordinary project analysis; that expansion has no
callback into reverse discovery.

The LSP's workspace `ProjectIndex` now applies the same rule to validation scheduling. Recursive
workspace enumeration populates discovery data but activates no project. Changes revalidate only
active roots whose forward closures contained the changed file before or after the update. Unrelated
reverse importers are not checked merely because they were indexed. Closing the last open document
associated with a context deactivates that scheduling context.

A library therefore needs no entrypointless project abstraction:

- ordinary library source exists only as part of projects whose heads reach it;
- a library test or example is an ordinary project because it has a `main` head;
- if an uncovered open file activates a library test head beside an active application head, the
  workspace has two project heads whose closures may share some library implementation;
- a `main` binding in the library's imported barrel has no effect while that barrel is below the
  application head.

## Millet: what transfers directly

Millet has the correct semantic layering:

```text
language server request
  -> analysis query
  -> per-source semantic Info and source mappings
  -> protocol conversion
```

Concrete ideas to adopt:

- one compiler/analysis owner for hover, definition, type definition, references, completions,
  symbols, inlays, and diagnostics;
- semantic definitions and references identified by compiler objects, not names;
- bidirectional CST/HIR source mapping;
- environments and types queried from static analysis;
- partial syntax/lowering/static results retained alongside diagnostics;
- the language-server crate acting mostly as state management and LSP conversion.

Millet's `Analysis` stores `SourceFile` records containing syntax, lowering maps, static `Info`, the
incoming scope, and the resulting basis. Definition and references operate through semantic `Def`
objects. Completion queries the stored incoming and resulting environments. This is strong evidence
for Workman's semantic API boundary.

## Millet: what Workman deliberately does differently

### File composition

Millet evaluates CM/MLB input by threading an SML basis through ordered source items. A source file
is not automatically an SML structure. Workman instead uses:

- a declaration sequence with exact SML environment semantics inside each file;
- an explicit acyclic file graph;
- per-file inferred public environments;
- declaration-position imports that project another file's environment.

Workman therefore adopts Millet's analysis separation, not its accumulated-basis compilation policy.

### Artifact granularity

Millet stores one path-keyed `SourceFile` inside one `Analysis`. Its MLB evaluator notes that the
same source can be analyzed under different scopes and currently overwrites the previous path entry.
That representation is unsuitable as Workman's public tooling boundary.

Workman uses one module interface per project snapshot. A path may have several interfaces in
several project contexts without collision.

### Workspace and project model

Millet's language server supports one workspace root and warns that it uses only the last folder
when several are supplied. Its root input is organized around a CM/MLB root group. Workman intends
multi-project and multi-root editor support and therefore must make project membership explicit
rather than make the workspace root the semantic universe.

Millet also rejects multiple automatically discovered root groups unless configured. The useful idea
is explicit roots; the exact one-root restriction is not copied.

### Incremental update policy

When diagnostics-on-change is disabled, Millet's `update_one` reparses and rechecks only the changed
file under its previously stored incoming scope. Its own comment states that it does not recalculate
other paths or diagnostics. Workman should not copy this stale-dependent compromise.

The first Workman implementation may recompute whole affected snapshots. A changed module
conservatively invalidates every dependent interface. Finer incremental reuse comes later.

### Current snapshot policy

Millet's recovered CST/HIR lets it analyze the changed source directly. Workman adopts the same
principle: current partial facts are preferable to a semantically complete but stale snapshot. Until
frontend-v2 supplies richer recovery, missing current facts remain explicitly missing.

## Audit of the current Workman LSP

### Keep

- source overrides for unsaved documents;
- diagnostics grouped by actual source file, including related evidence;
- conservative reverse-dependency revalidation;
- specialized FFI and GPU facts and their useful host/GPU distinction;
- frontend-v2 structural rendering and parse caching as syntax/structural services;
- editor-neutral protocol behavior already expressed as standard LSP.

### Replace with module-interface queries

- structural inlay paths retain their separate frontend-v2 structural input.

Definition and references no longer use the former `symbols.ts` resolver. They select occurrences
from the requested module interface, follow compiler definition queries, and aggregate references
only by target identity within the owning `ProjectSnapshot`. Namespace qualifiers retain their local
`StructureId`; the compiler query follows that import binding to the target module. Unrelated
open-document graphs are not merged. If strict analysis fails, these queries consume the compiler's
transactionally recovered snapshot, so failed phrases contribute no invented fallback bindings.

Hover now uses the same semantic document-context adapter. Typed nodes carry compiler-owned labels,
occurrence-local and generalized types, and explicit generated-FFI presentation facts. GPU hover
combines interface-owned normalized slices with specialized snapshot results; resource receiver
types and builtin selections remain compiler facts. The former graph rebuild, direct `InferResult`
reads, and `inferModulePartial` fallback have been deleted.

Successful validation publishes each interface's diagnostic list rather than reading
`analysis.results`. Document symbols map compiler-owned top-level declaration facts, including
datatype constructor children, and recovered files expose only transactionally certified
declarations.

GPU completion now consumes compiler-owned current-source completion facts. These facts preserve GPU
region spans and name-only value/structure/type/constructor lexical scopes before failed phrases are
transactionally removed. They deliberately do not assign semantic identities to uncertified
declarations. The interface also exposes initial-basis target types and basis-structure members. A
protocol-neutral compiler query owns context and prefix detection, lexical shadowing, project and
basis namespace members, nominal record fields, keywords, GPU catalog merging, and candidate
ranking. The LSP only converts candidate kinds and compiler semantic-type references to completion
items through the shared hover type renderer.

Import discovery is also compiler-owned. An unfinished named-import clause resolves and analyzes its
target as a detached file snapshot, returning public value, constructor, and type candidates without
adding that target to the selected project's reachable graph. Same-spelled SML namespaces remain
distinct. Import-path discovery merges nearby disk entries with virtual/current-source files and
directories; the LSP only maps the resulting neutral file/folder candidates.

Expected-type ranking likewise comes from inference. Static rules record expression expectations,
which the interface freezes in the same semantic type arena used by hover and completion detail. The
completion query compares those immutable shapes and promotes compatible candidates without
filtering uncertain or incompatible names. Initial coverage includes binding annotations, ordinary
call arguments, nominal record fields, Boolean conditions and unary operands, panic messages, and
already-inferred `else` branches.

Rename is likewise a compiler query, not an LSP-side name search. It consumes occurrence roles and
target identities from one complete project snapshot. Selecting a named-import alias produces a
local alias-and-use group; selecting the source name or exported declaration produces a target group
across the reachable project. This preserves the module rule that aliases change environment keys
without creating a second target identity while still supporting the editor operation users expect.
Incomplete snapshots, targets without editable project declarations, and ambiguous nominal record
projections are refused. The language server only validates the requested lexical category through
the compiler query and converts its source spans into a standard `WorkspaceEdit`.

Type definition walks the selected occurrence's immutable semantic type shape and resolves every
genuinely present nominal `TypeNameId` through project definition mappings. Composite types may
therefore return several declarations, while primitives and unresolved variables return none.
Document highlights reuse the same compiler-owned occurrence and import-alias selection rules as
references and rename, then expose protocol-neutral read/write classification. The LSP layers for
both features only convert source locations and access kinds.

The current `ProjectIndex` recursively discovers every `.wm` file beneath each workspace folder.
That is acceptable only as temporary file discovery. It must not define project membership,
diagnostic scope, reference scope, or rename scope.

### Frontend-v2 boundary

Frontend-v2 may continue to own:

- lossless or structural syntax;
- repair nodes and layout;
- custom structural inlay rendering;
- concrete/virtual source mapping.

It must obtain semantic names, identities, scopes, modules, and types from the compiler module
interface. If frontend-v2 can parse a node for which the semantic interface has no current fact, it
may render the structure but must mark the semantic information unavailable rather than infer it
independently.

## Migration order

1. Complete and test the compiler-owned module interface on strict current analyses.
2. **Implemented:** add structured completeness and expose the current conservative
   declaration-prefix result.
3. Put occurrence, scope, type, and source-mapping facts into each module interface.
4. Add explicit project snapshots, detached snapshots, and project membership.
5. **Implemented for definition/references:** build project occurrence/reference indexes only by
   aggregating module interfaces.
6. **Implemented:** route successful validation and strict/recovered hover through the interface.
7. **Implemented:** route definition, references, and document symbols through the interface.
8. **Implemented for ordinary, GPU, named-import, and path completion:** route completion through
   current-source, compiler-owned semantic and name-only recovery scopes plus detached import
   discovery. Initial compiler-owned expected-type ranking is implemented; broader expectation
   recovery remains.
9. **Implemented for ordinary inferred-type inlays:** compiler-owned binder/parameter facts feed
   standard, range-aware LSP hints using the shared semantic type renderer. Structural frontend-v2
   inlays remain a separate fact source and configuration category. Compiler-resolved named Workman
   callables and record constructors also expose authored parameter/field names across imports;
   unreliable value aliases and foreign functions without parameter metadata remain unhinted.
10. **Implemented for initial signature help:** per-module callable definitions and call sites carry
    resolved semantic parameter/result types, authored parameter stages, argument spans, and
    pipe-supplied arity. A project-snapshot query selects the active signature or conservatively
    resolves an incomplete call through the certified scope. The LSP layer only renders standard
    `SignatureHelp`.
11. **Implemented for initial semantic tokens:** each interface owns compiler-classified symbol
    spans for structures/modules, types, type parameters, lambda parameters, values, fields,
    constructors, and functions. Exact-span SML multi-namespace occurrences retain separate
    identities; a deterministic presentation-only selection satisfies LSP's non-overlap rule.
12. **Implemented for shared LSP snapshot lifetime:** `SemanticService` consumes the compiler
    `ProjectContextRegistry`, retains closest-headed/detached snapshots across unchanged requests,
    invalidates affected forward closures, preserves overlapping-project ownership, and pairs strict
    failures with current recovered interfaces.
13. **Implemented for initial workspace symbols:** a protocol-neutral aggregation of active
    `ProjectSnapshot` declarations feeds standard workspace symbols. Recursive discovery never
    supplies semantic members, and identical shared-source locations are deduplicated only in the
    presentation.
14. **Implemented:** delete the handwritten definition/reference resolver after parity and recovery
    tests pass.
15. Improve recovery beyond the implemented phrase transactions toward Millet's tolerant CST/HIR
    model when finer within-phrase semantics become worthwhile.

The first implemented occurrence slice now includes compiler identities and source spans for values,
structures, nominal type declarations and uses, constructors, module import paths, named import
sources and aliases, namespace aliases, value qualifiers, and nominal record fields. Type uses are
captured at the `typeFromAst` elaboration boundary and translated from resolved inference `TypeInfo`
identity to the project's stable `TypeNameId`; tooling never re-resolves their spelling. Nominal
field declarations, literal fields, pattern fields, and projections selected by inference share one
`FieldId`. When a projection such as `value.x` has several nominal record candidates, inference
selects the first declaration-order candidate identity, records its `FieldId`, and emits
`record.ambiguous-projection` asking for an annotation. This deterministic occurrence target does
not coerce the receiver to that nominal record: its type remains the structural row requirement
until an annotation makes a nominal choice semantic. Only a label with no nominal candidates lacks a
nominal target; the compiler does not invent a parallel global-label identity.

Module-alias qualifier occurrences cover value expressions, constructor and pinned patterns, and
type expressions. Type elaboration carries the exact resolved namespace `StaticEnv` into its
compiler fact; the module interface relates that environment object to the corresponding import's
`StructureId`. Repeated aliases of one module therefore remain distinct without re-running name
resolution from the dotted source text.

The lexical-scope slice is compiler-owned rather than reconstructed by tooling. The canonical
binding resolver snapshots its sequential value and structure environments at AST nodes and at
top-level/block declaration checkpoints. `ModuleInterface` translates those snapshots to semantic
identities and overlays them on the initial static environment captured after basis and compiled
standard installation but before ordinary file declarations. This already covers declaration
ordering, shadowing, imports, lambda and match binders, block locals, pervasive values, basis types,
and standard structures. Local and named/open-imported types and constructors are captured in the
same sequential snapshots and translated through the nominal fact table, including the case where
one named import introduces same-spelled type and constructor components.

Type-variable scope is also elaborator-owned. One `TypeVariableId` is shared by every annotation
occurrence in a simultaneous `let ... and` group and by the parameter/result annotations of one
lambda. Explicit record and datatype parameters additionally expose their binder spans, so
definition queries resolve a parameter use without inventing a declaration for implicit annotation
variables. Nested regions shadow by lexical extent. A partial interface includes regions only from
its certified declaration prefix. `scopes` remains explicitly `partial` until the remaining source
mappings are complete.

JS imports use the same compiler binding resolver as Core lowering. FFI-generated aliases keep
distinct lowering identities so emitted declarations and references remain correct, while an
explicit compiler fact relates each generated identity to its authored import identity. Semantic
occurrences use that authored target and lexical scope snapshots omit compiler-only aliases. When
lowering replaces an authored named structure clause such as `as console`, the transformed
declaration retains that clause as semantic-only compiler metadata. Qualifier and member occurrences
therefore remain `console.log`, while executable Core continues to reference the standalone
generated binding. Reflected foreign types likewise retain their authored import-spec node, nominal
`TypeNameId`, declaration occurrence, public origin, and declaration-ordered type-scope membership.

Named value and constructor import-source/import-alias occurrences retain the target declaration's
generalized scheme; later references retain their occurrence-local instantiation. Occurrence
coverage remains explicitly partial until the remaining recovery-produced and role-specific source
mappings are present.

Occurrence-local types use a frozen semantic type arena owned by each `ModuleInterface`. Named
occurrences reference arena IDs and state whether the referenced type is generalized plus its
quantified variable count. A separate compiler-owned typed-node index covers every elaborated
expression, pattern, and authored type expression that has a source node. Its smallest-containing
node query lets hover and structural tooling ask about literals, calls, compound annotations, and
binders without retaining `InferResult.types` or walking syntax to reconstruct a target. Binder
patterns retain generalized schemes; expression and annotation nodes retain their occurrence-local
instantiations. Failed declarations contribute no nodes to conservative partial interfaces, while
independently recovered later phrases do.

Arena nodes preserve variables, functions, tuples, structural records, FFI obligations, primitives,
and named types; named nodes carry the stable project `TypeNameId` whenever one exists. This is a
compiler DTO, not an LSP hover string, and it prevents tooling from retaining or mutating inference
`Ty` graphs.

Compiler-selected Result carrier operations are part of the same artifact. Each operation carries
its authored source span, wrapped-versus-pure operand plan, and semantic type-arena references for
the shared error and payload-result types. Tooling therefore does not have to rediscover carrier
lifting from an operator's surface syntax or inferred result string.

GPU HM facts use the same rule. The interface records finite overload obligations with compiler
catalog identity, source span, candidate rows, determining arguments, and semantic-arena argument
and result types. It also records builtin/resource occurrences and compiler-resolved fragment
root/selector relationships, including source binding identity and factory/environment spans where
present. Direct single-source compilation consumes the same selection facts as project compilation.
Normalized GPU slice inputs are recursively frozen on the interface that owns each fragment root.
The compiler's language-service query accepts only the immutable `ProjectSnapshot` and returns an
immutable per-module elaboration artifact carrying the same snapshot and generation identities.
Specialized occurrence types, representation evidence, shader types, and builtin selections
therefore no longer require `ProgramAnalysis`, binding maps, or LSP-side semantic reconstruction.
Applicable GPU completeness is `complete`; a module with no GPU semantics reports `not-applicable`,
not `unavailable`.

Final FFI lowering also produces an explicit interface DTO rather than requiring tooling to inspect
generated declarations. Each authored JS import records its target kind/path, source range,
safe/unsafe and type-only modes, optional structure alias identity, and authored source/local
bindings with fallibility and semantic-arena signature types. Generated `__ffi_*` bindings never
appear. Reflected foreign types record their nominal `TypeNameId`, reflection key, and authored
declaration span. Strict applicable FFI is `complete`; absent FFI is `not-applicable`; a failed
current analysis remains `partial` and exposes only certified facts. Delayed reflection resolves
qualified types through the same `StrEnv` lookup as ordinary elaboration, including `Js.Error`.

Initial-basis and compiled-standard values are semantic declarations too. Host entries use stable
`basis-value:*` identities, compiled source entries use `standard-value:<owner>:<member>`
identities, and qualified facilities use `basis-structure:*` identities. The identity is attached to
the scheme at basis construction and survives ordinary structure projection and import cloning.
Consequently `print`, `Option.map`, and local/imported values all appear through one occurrence
target model; tooling does not special-case their spellings.

The basis profile and its opaque generation are analysis inputs, not labels reconstructed from the
result. `InferResult`, every `ModuleInterface`, and the owning `ProjectSnapshot` retain the exact
`InitialBasis` artifact identity consumed by inference. Public value/type/constructor origins carry
compiler source spans, and protocol-neutral definition queries map any recorded occurrence target
back to those declarations (or a module-import target to the target module source range).

The replacement is not staged as a permanent dual system. Once the compiler interface can answer a
current feature correctly, the LSP-owned implementation is removed.

## Acceptance rules

- Every semantic tooling fact can be traced to one module interface.
- Current malformed source yields current partial facts plus explicit completeness.
- No LSP fallback environment exists.
- Declaration ordering and namespace separation match compiler elaboration.
- The same source in two project snapshots cannot collide.
- Unrelated workspace files are not silently checked or added to project reference/rename scope.
- Project-wide indexes contain only identities aggregated from module interfaces.
- Frontend-v2 never becomes a second semantic analyzer.
- Replacing the current resolver does not reduce existing FFI/GPU behavior.
