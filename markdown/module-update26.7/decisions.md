# Decisions and deferred questions

Items marked **decided** are recorded constraints for the current design and require an explicit
superseding decision to change. Non-blocking future questions are kept separate from this register.

## Decision register

### D1. Exact SML semantics for the shared fragment

**Status:** decided

Every accepted shared construct follows its Revised Definition translation exactly. Limitations
reject syntax or impose stricter admissibility; they do not redefine accepted programs.

### D2. A separate Workman compilation-unit protocol

**Status:** decided

Filesystem/project behavior is not called SML semantics. Workman specifies resolution, identity,
graph, visibility boundaries, and initialization directly.

### D3. Adopt a small set of ESM graph properties

**Status:** decided

Adopt static requests, resolved module identity, direct imported-binding identity, conceptual
link/evaluate separation, and initialization once. Do not claim broader ESM compatibility.

### D4. Reject dependency cycles

**Status:** decided

The reachable file graph is a DAG. Cross-file recursion requires a future explicit recursive-module
design rather than ESM temporal initialization.

### D5. Defer `private`

**Status:** decided

For the current correctness pass, every module-owned top-level declaration enters the public
environment. Imported and prelude bindings are not module-owned and are not automatically
re-exported.

Surface `private`, public-interface restriction, and private nominal-type leakage checks are
deferred until a concrete need for private declarations appears. The semantic model should not
prevent that future restriction, but the current update does not design speculative `private`
syntax.

### D6. Keep imports declaration-ordered

**Status:** decided

The compiler discovers every graph edge before elaboration, but an import extends the local basis at
its declaration position. This matches current behavior and SML sequential environment extension.
Imports remain static, literal, and top-level; declaration ordering does not make them runtime or
conditional.

Adopt a required import preamble only if the correctness pass demonstrates a material semantic or
implementation problem with declaration ordering. That is a future reason to supersede this
decision, not an unresolved choice in the initial design.

### D7. Preserve target declaration identity

**Status:** decided

Imports project and alias original semantic objects. They do not re-elaborate declarations,
re-generalize schemes, or generate fresh nominal identities.

### D8. Keep file namespaces static

**Status:** decided

A namespace alias is a static structure qualifier, not an ordinary Workman record or first-class
module value. Backend namespace objects are representation details.

The existing bare namespace expression is retained as a syntactic extension:

```text
Module  in expression position  ==>  Module.carrier
```

This does not add a value binding named `Module`. Ordinary value-environment lookup takes
precedence; the rewrite is attempted only when the bare identifier does not resolve as a value and
does resolve as a structure alias whose environment contains a value member named `carrier`.
Qualified lookup remains structural, and a missing `carrier` is an ordinary static lookup error.

### D9. Do not add re-export syntax initially

**Status:** decided

Re-export needs a namespace-aware identity rule. Ordinary value aliasing remains an ordinary new
declaration.

### D10. Defer the general LSP update

**Status:** decided

The module correctness pass supplies stable module, interface, dependency, and alias facts before
the LSP analysis boundary is implemented around them.

### D11. Use a per-module basis, not an ambient project basis

**Status:** decided

Each module begins with the shared prelude and environment fragments selected by its explicit
imports. Its declarations then extend that working basis with ordinary SML sequential semantics.
Topological compilation order does not place unrelated earlier modules into scope.

### D12. Do not automatically re-export imports

**Status:** decided

A module's public environment currently contains all module-owned top-level declarations. Imported
and prelude bindings are working scope only. Any future re-export is explicit and preserves the
originating semantic identity.

This is not a separate ownership-based environment calculus. After dependency resolution,
declaration-ordered namespace and open imports are modeled using nested SML `local` declarations:
the import environment is the local part, and the remaining source declarations are the body. The
ordinary SML rule exports the body's environment but not the local import bindings. Named imports
use the same scaffolding with their explicitly projected environment fragment.

### D13. Use an opaque, locally canonical `ModuleId`

**Status:** decided

Compiler consumers see an opaque `ModuleId`, not a path string they may parse. For the initial local
resolver, its identity is backed by the canonical real path of an ordinary file. A virtual source
provider supplies a stable opaque identity within the project snapshot.

Display paths, source specifiers, and backend emit names are separate facts. No persistent or
cross-machine identity is promised yet. Package and URL resolution may add new resolver-produced
identity variants without changing semantic consumers.

### D14. Use SML environment composition for collisions

**Status:** decided

Imports elaborate to environment fragments at their declaration positions. Sequential phrases
compose environments with the Revised Definition's right-biased modification operation:

```text
E1 + E2
```

Therefore a later import or local declaration shadows an earlier binding in the same namespace.
Values, types, and structures remain separate namespaces, so equal spellings in different components
do not collide. An open import has the same overlap behavior as SML `open`: later components win.

A single named-import clause may not bind the same local identifier twice in one namespace. This is
a syntactic well-formedness restriction on a simultaneous clause, not a cross-declaration collision
policy. Constructors occupy the value namespace while their datatype information also appears in the
type environment, as in SML.

The current rule that rejects import/import and import-after-local overlap is a correctness issue to
replace, not a permanent Workman module rule.

### D15. Use source-ordered ESM graph evaluation and SML declaration evaluation

**Status:** decided

Outgoing import edges are visited in source order. Initialization performs a depth-first traversal
in that order and skips any resolved `ModuleId` already visited. A dependency completes before its
importer, a shared dependency initializes once, and a repeated request observes the same completed
instance.

Within a module, declarations evaluate in source order under Workman's SML-derived dynamic
semantics. An initialization failure stops that module, prevents its importers from starting, and is
remembered for repeated requests; effects already performed before failure are not rolled back.
Cycles remain a pre-evaluation graph error.

Invoking an exported `main` is a target-specific action after successful entry-module
initialization, not part of module initialization itself.

### D16. Represent SML namespaces structurally

**Status:** decided

The semantic environment follows the Revised Definition's shape:

```text
Env = StrEnv x TyEnv x ValEnv
StrEnv = StrId -> Env
```

Only the components implemented by Workman need exist, but qualification is structural lookup
through `StrEnv`. Dotted strings are permitted only as lowering or backend emit names after semantic
resolution. They are not semantic keys and must not define structure membership, shadowing, rename,
or identity.

### D17. Use the SML basis model independently of library size

**Status:** decided

Workman has a minimal kernel basis, selected standard structures, an explicit pervasive environment,
and a per-module working basis. All four use the Revised Definition's namespace and environment
composition rules.

The kernel contains only semantic facts and runtime primitives that cannot be expressed as ordinary
Workman. Source-expressible library code is elaborated through the ordinary front end and installed
as structure environments. Pervasive bindings are explicit projections, not implicit flattening.
Static and dynamic initial bases are two corresponding views of one selected basis profile.

A small Workman library does not justify provenance-based collisions, dotted pseudo-structures,
hand-synchronized static/runtime preludes, or different shadowing rules. See
[`sml-basis.md`](./sml-basis.md).

### D18. Preserve the default basis API during the semantic migration

**Status:** decided

The first basis refactor preserves the current default source-visible API unless exact SML
correctness requires a change. Before moving entries, record that API as a checked inventory and
classify every entry as:

- mandatory language-kernel fact;
- host/compiler intrinsic;
- source-defined standard-structure member;
- explicit pervasive projection.

This is a compatibility rule, not approval of the current implementation grouping. It prevents an
unrelated standard-library redesign from blocking the module correction while still replacing
fragmented tables, dotted pseudo-structures, and privileged imports.

`@no-prelude` means the recorded minimal profile: it retains the language kernel and host facts
required by accepted syntax, while omitting optional compiled standard structures and pervasive
additions. Its exact compatibility interface must be checked in before migration.

### D19. Treat Workman operators as fixed syntax

**Status:** decided

Workman's grammar parses a fixed operator set directly into unary and binary expression nodes and
does not provide SML symbolic value declarations or `op`. For the current language, operators are a
documented syntactic restriction relative to SML, not rebindable `ValEnv` identifiers.

Their typing, equality constraints, lowering identity, and runtime operation belong to a single
kernel operator catalog. They must not participate in import collisions through fake
`standardLibrary` value bindings. Ordinary initial values such as `print` remain ordinary,
shadowable `ValEnv` entries.

### D20. Preserve only explicit pervasive bindings

**Status:** decided

The migration records the current unqualified default bindings and preserves them for compatibility;
it does not make every standard-structure member pervasive. Constructors and ordinary values in the
pervasive environment are explicit projections or initial bindings with normal SML shadowing.
Qualified facilities are installed in `StrEnv`.

Adding or removing pervasive API is a later standard-library decision.

### D21. Require effect-free standard-basis construction

**Status:** decided

Compiled `std/*.wm` modules used to construct the default basis must be observationally effect-free
to user programs, apart from allocation of their unreachable/internal runtime values. Their build
and initialization order remains deterministic.

A future library facility requiring initialization effects belongs in the ordinary file-module graph
or requires an explicit superseding decision; it must not make basis construction order observable
accidentally.

### D22. Resolve intrinsics as ordinary semantic bindings

**Status:** decided

A compiler intrinsic is an ordinary resolved structure/value binding carrying an intrinsic tag.
Lookup, shadowing, qualification, import, and alias identity use the same environment rules as other
bindings. The tag selects special lowering only after semantic resolution.

Tags crossing a compiler artifact boundary are versioned frontend semantic IDs. Tags used only
inside one backend remain backend-private.

### D23. Begin with conservative interface invalidation

**Status:** decided

The first module interface artifact carries a snapshot-local generation and invalidates dependents
conservatively. Persistent semantic fingerprints and serialized cross-build identity are future
optimizations, not prerequisites for correcting module semantics or handing authoritative facts to
the LSP.

When added, a fingerprint is derived from importer-visible semantic content. It excludes display
paths, backend names, rendered type strings, and unstable allocation IDs.

### D24. Treat runtime import hoisting as an implementation defect until proven equivalent

**Status:** decided

Static import bindings take effect at their declaration positions. Dependency module initialization
still happens before the importer begins, but emitted aliases and binding selection must preserve
the specified lexical and declaration evaluation behavior.

The current runtime alias hoisting is not accepted semantics. Focused parity tests decide which
lowering changes are required; the language rule does not depend on the result.

### D25. Defer package and non-local resolution

**Status:** decided

The first resolver supports explicit local files and snapshot-stable virtual sources. Package names,
import maps, lockfiles, integrity, vendoring, host conditional exports, and non-file URLs are a
separate future protocol design.

### D26. Make the per-module interface the sole semantic tooling API

**Status:** decided

The compiler-produced module interface is the only supported source of names, scopes, modules,
types, occurrences, identities, and other semantic facts for the LSP, frontend-v2, and future editor
integrations. Concrete syntax and structural rendering may remain frontend-owned, but no tooling
layer may implement a fallback semantic environment.

The interface is per module and per project snapshot. A project-wide index is derived only by
aggregating these interfaces.

### D27. Analyze the current source and expose structured completeness

**Status:** decided

Editor queries consume a compiler-produced partial interface for the current source snapshot. They
do not silently use last-known-good semantics.

SML top-level elaboration determines how successfully elaborated declarations extend the partial
basis and ensures a failed declaration contributes no bindings. Syntax recovery boundaries remain a
Workman compiler/frontend responsibility because the Definition explicitly leaves parse errors to
implementations.

Completeness is structured by syntax, imports, elaboration, occurrences, FFI, and GPU rather than
being inferred from diagnostic count.

### D28. Separate workspace containment from project membership

**Status:** decided

A workspace folder is not a semantic project. A project snapshot contains only explicit entries and
their reachable import graphs. Unrelated files, reference-only sources, and neighboring projects do
not participate merely because they share a directory.

The same physical source may have separate module interfaces in multiple project snapshots. An open
source in no project receives a detached snapshot.

### D29. Prefer conservative correctness over early incremental reuse

**Status:** decided

Incremental recomputation and advanced partial recovery are not first-priority requirements. The
initial implementation may rebuild complete affected project snapshots and conservatively invalidate
dependents. It must not copy Millet's single-file update behavior when that would leave dependent
semantic facts stale.

### D30. Remove the handwritten LSP resolver when interface parity is ready

**Status:** decided

The compiler interface initially develops beside the current LSP implementation only long enough to
establish parity. Once it can answer an existing feature, that feature switches immediately and its
tooling-owned resolver/fallback is deleted. A permanent dual semantic system is not accepted.

### D31. Define a project as one `main` head and its reachable graph

**Status:** decided

A Workman project is:

```text
Project(head) = head + every module reachable from head
```

where `head` is an entry file containing `main`. A workspace analysis may have one or more heads,
and reachable closures may overlap.

The presence of a binding named `main` in a dependency does not create a nested project and does not
change import semantics. It is an ordinary binding while that file is below another head. The same
file becomes the head of a second project only when it is independently selected or discovered as a
head, for example because its test/example entry file is open or is the closest head found for
another open library file.

Libraries do not require an entrypointless project category. Library source participates in every
project whose head reaches it. Tests and examples are ordinary projects with their own `main` heads.
Library emission, if retained as an output operation, does not introduce different source module
semantics or persistent project membership.

Head discovery may use a lightweight reverse-import index. Reading or parsing import edges for that
index does not make a file a project member and does not authorize typechecking it. Semantic
participation begins only through a selected head's reachable closure.

Opening a file does not attach it to or add it to a project. A selected head's project snapshot
already contains every reachable module and its interface, whether or not those files are open.

When resolving the context for a newly open file:

1. if an active project graph already contains the file, use that existing project context and do
   not search for another head;
2. otherwise, walk reverse imports to the closest main-bearing head and activate that head's
   reachable project graph;
3. if no head exists, use a detached snapshot.

Thus opening shared lib3 implementation code while an application project that imports it is active
does not activate lib3's parallel test/example project. With no containing project active, the same
file discovers its closest lib3 head, which matches the likely editing focus. Multiple projects
become active only when an open file is outside every currently active project graph and discovers a
different head.

Head selection and project expansion are separate one-way operations:

```text
uncovered open file --reverse imports--> closest head
closest head --forward imports--> complete project snapshot
```

Forward expansion never starts another reverse head search from a dependency. Therefore an
application project reaching lib3 implementation code does not activate lib3's test/example project.
That second project becomes active only when another open file independently selects its head.

### D32. Reuse existing project membership before head discovery

**Status:** decided

Opening a document never attaches a module to a project. A project snapshot already owns interfaces
for its complete reachable graph.

If an active project contains a newly opened file, tooling uses that existing project interface and
does not run reverse-head discovery. Only a file outside every active project graph searches for its
closest `main` head. A project remains active while an open document uses its context and may be
released when no document does.

Document-to-project association remains stable across ordinary edits and tab changes while the
selected project still contains the document. If graph changes remove it from that project,
selection runs again. A compiler-produced current-source `main` candidate keeps a project
discoverable while `main` is incomplete or ill-typed; the semantic problem is diagnosed rather than
making the project disappear.

## Resolved terminology and non-blocking future questions

### Interface terminology

The public environment is compiler-inferred, but principal SML signatures have stronger theoretical
meaning. Use **inferred public environment**, not “principal interface,” until the stronger property
is specified or proved.

### Persistent interface fingerprints

The semantic inputs are constrained by D23, but canonical serialization and persistent nominal
identity remain deferred. Conservative invalidation is sufficient for the first implementation.

### Runtime import parity

This is no longer a language question. D24 fixes the required semantics; checklist tests determine
the implementation work.

### Package resolution

D25 defers the entire feature family. Its eventual choices do not block the local module update.

### Basis API evolution

D18-D22 answer the semantic and migration questions. The exact current-name inventory remains a
mechanical Stage 0 deliverable in [`checklist.md`](./checklist.md), not an open design choice.
