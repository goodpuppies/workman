# Current module implementation

This document distinguishes implemented behavior from the proposed specification.

## Parsing and source shape

The current grammar permits Workman file imports only as `TopDecl` forms:

```wm
from "./lib.wm" import * as Lib;
from "./lib.wm" import *;
from "./lib.wm" import { value, Type as LocalType };
```

Blocks permit record, type, and let declarations but not Workman file imports. Import specifiers are
therefore literal strings in statically discoverable top-level declarations.

Imports may be interspersed with other top-level phrases. Static inference makes their bindings
visible only after the import's declaration position.

## Resolution and graph construction

`src/module_graph.ts` currently:

- resolves relative specifiers against the importing file;
- uses `realPath` for ordinary filesystem inputs;
- supports normalized virtual filesystem paths in tests and open-document overrides;
- keys graph nodes by resolver-owned `ModuleId`;
- visits every canonical node once;
- records import edges with original specifier, resolved path, and import clause;
- produces dependencies-before-importer topological order;
- rejects cycles;
- rejects Workman import syntax for JavaScript/TypeScript targets.

This provides the proposed DAG and single-identity behavior for local files. Graph, analysis,
nominal-owner, Core, and tooling maps now use interned opaque `ModuleId` tokens. The token has no
display, path, string conversion, or emitted-name representation; graph nodes and edges carry paths
separately for source display and I/O.

The first-pass decisions use canonical filesystem identity for local files and snapshot-stable
opaque identities for virtual sources. Symlink and platform-path behavior need characterization
tests. Package names, non-file URLs, import maps, and persistent generated-source identity are
explicitly deferred.

## Static environments and exports

Each file currently starts from the Workman basis/prelude plus its explicit imports. It does not
inherit the accumulated basis of a previously listed source file as Millet does.

Inference now produces the explicit SML-shaped product:

```text
StaticEnv = StrEnv × TyEnv × ValEnv
StrEnv = StrId → StaticEnv
```

Namespace imports populate `StrEnv` with the dependency-owned public environment. Each file has a
complete local `StaticEnv` plus ADT metadata and an `exportedStructure` containing the public
environment plus exported ADTs. Qualified imported values, constructors, records, and types are
looked up by recursive structure projection. A type-identity registry keeps imported nominal
metadata available without making those types unqualified.

Qualified source names are now the Revised Definition's long identifiers rather than dotted strings.
The parser produces `LongId = { qualifiers, id }` (the Definition's `LongX = StrId* x X`) on `Var`,
`PPinned`, `PCtor`, and `TName`; the joined spelling is retained only for display and emit.
Elaboration resolves through `StrEnv` from that structure, so no semantic lookup re-parses a name.
Per `D33`, JavaScript FFI member paths, reflected foreign-type keys, and the GPU backend are
permanently not SML long identifiers and keep their own representations.

The kernel's dynamic artifact is built from the same manifest as the static one: binary and unary
operator definitions and constructor runtime names derive from the catalog, a catalog entry without
an implementation fails emission loudly, and a regression evaluates every basis fact — including
dotted host members — proving each is a defined runtime value.

Record projection through a qualified value member (`Lib.origin.x`) now typechecks, lowers, and
runs: inference previously rejected any qualified spelling that was not entirely a structure member
before the record-projection path could consume `resolveLongValue`'s remaining fields. Occurrence
and scope completeness on strict analyses are audited by permanent regressions — every authored
named node has an occurrence in its span, and every reference/qualifier occurrence is reproducible
from the lexical scope at its own offset with the same identity — and both report `complete`;
recovered analyses remain partial. Receiver-model `__ffi_*` helper bindings no longer leak into
source scopes.

The initial basis now also exposes its qualified facilities through real structure environments. Its
working `TyEnv` contains only unqualified bindings; `Js.*` and `Gpu.*` types live under `StrEnv`.
Compiler metadata lookup uses a non-visible identity registry, not a parallel dotted source
namespace. Semantic qualified-type lookup has no flat fallback.

Basis selection now goes through immutable `BasisProfile` and `InitialBasis` artifacts. Each module
receives a fresh working instance, so declaration elaboration cannot mutate the cached definition or
another module's basis. `-- @no-prelude` selects the recorded kernel profile; ordinary source
selects the default profile. A compiler-owned basis manifest now supplies type/profile membership,
semantic type IDs, equality classification, constructor IDs and runtime names, fixed-operator
descriptors, ordinary runtime value names, and GPU intrinsic IDs/runtime names. `InitialBasis.facts`
exposes the selected type, value, and constructor facts plus pervasive, operator, and intrinsic
metadata to later compiler and tooling consumers. Static/runtime correspondence tests fail if a
visible initial value lacks an implementation fact or if a recorded runtime reference is absent from
emitted code.

Fixed binary operators are stored in the kernel operator catalog and are no longer fake `ValEnv`
bindings. Ordinary pervasive values such as `print` remain in `ValEnv` and shadow normally. The
profile's explicit pervasive table selects `print` for both profiles and selects `None`, `Some`,
`Ok`, `Err`, `Nil`, and `Cons` for the default profile. Qualified host members are removed from the
working top-level `ValEnv` after their structure environments are built. The constructor entries are
genuine projections from `Option`, `Result`, and `List`; each pervasive binding and its qualified
structure member is the same scheme and runtime constructor. Compiled standard modules are
elaborated through the ordinary front end, then their public environments are composed with
host-only structure members before normal namespace installation. There is no standard-library-only
collision branch in import elaboration. Basis installation, namespace imports, open imports, named
projections, JS import bindings, and ordinary top-level declarations all extend their working
environment through the same right-biased SML environment-modification operation.

`Text.of` is host-owned. The source `Result` module owns all of its members. The host owns
the irreducible `Task` operations; `std/task.wm` uniquely owns `fn`, `fnError`, `carrier`,
`collectList`, and `traverse`. Runtime namespace construction uses this compiler-owned member table
and emits explicit references rather than using JavaScript object spread to decide ownership.

The AST already carries `exported: boolean` on let, record, and type declarations. The inference
engine:

- adds exported declarations to the public value/type environments;
- rejects exported records, datatypes, aliases, and values whose types mention a non-exportable
  nominal type;
- filters exported ADT metadata by exported type identity.

However, the surface parser currently sets `exported: true` for every ordinary top-level let,
record, and type declaration. There is no `private` syntax yet. All top-level declarations are
therefore public in ordinary source.

## Import semantics

Namespace import:

- binds the alias only in `StrEnv`;
- preserves imported schemes and type identities;
- treats bare `Lib` as syntax sugar for structural lookup of `Lib.carrier`, after ordinary `ValEnv`
  lookup, without fabricating a value binding.

Open import:

- opens all implemented public environment components using right-biased SML environment
  modification.

Named import:

- selects each requested name independently from value and type environments;
- may therefore import both namespace components with one spelling;
- preserves the imported semantic objects;
- supports local renaming;
- rejects duplicate local targets only within the same namespace component of one clause.

Imports are consumed at their declaration positions by both inference and binding-fact resolution.
Later imports and local declarations shadow earlier bindings independently in each namespace.

Tests confirm:

- declaration-ordered import visibility;
- transitive imports;
- qualified values, types, and constructors;
- named value/type/constructor imports;
- nominal distinction between same-spelled datatypes in different files;
- one nominal identity when the same canonical file is imported under two aliases;
- cycle rejection.

The same-file/two-alias identity behavior is a permanent regression test.

## Runtime emission

Generated output now contains a compiler-owned module-instance registry. Every reachable file,
including the entry file, is registered with:

- an explicit `uninitialized`, `initializing`, `completed`, or `failed` state;
- its resolved outgoing dependency keys in source-edge order;
- one initializer and one publisher for its completed dynamic export record;
- its completed value or remembered failure.

Requesting a module recursively requests its dependencies in recorded order, evaluates its body
once, publishes the completed record, and reuses that record on later requests. A thrown value is
remembered and rethrown; effects performed before it remain observable, while the importer never
starts. The acyclic graph check runs before emission, and the runtime's `initializing` case remains
an invariant check rather than a cyclic-module semantics.

Executable, library, worker/test, and REPL output all use this same request path. Executable `main`
invocation happens only after the entry request completes and is outside the entry initializer.
Library exports are projections from the completed entry record.

Import aliases are emitted at their Core import occurrences rather than in a module-wide preamble.
Value and constructor aliases retain target declaration identities; namespace aliases have distinct
compiler-owned structure identities. Backend names include those identities, so a later import or
local declaration does not mutate what an earlier closure captured. Qualified Core access carries
the structure identity plus resolved member/constructor identity. The dynamic export record is a
backend representation of a completed static namespace, not a first-class Workman module value.

The parallel-semantics audit originally confirmed several concrete failures. Repeated aliases,
same-basename backend declarations, right-biased import shadowing, constructor preservation,
declaration-position closure capture, explicit initialization state, and final runtime exports are
now fixed and covered by permanent regressions. Binding facts consume imports at declaration
position, and qualified imported lookup is structural. The migration risks formerly listed here are
resolved: the LSP contains no dotted-name resolution or path-derived identity (`L705`), FFI host
member paths are permanently outside long-identifier semantics by `D33` with authored/generated
identities related through compiler facts, and intrinsic and qualified-member facts travel on the
module interface artifact (`A601`–`A615`, audited by the `A608` occurrence and scope regressions).

See [`parallel-semantics-audit.md`](./parallel-semantics-audit.md) for the original reproductions
and common causes.

## Current implementation gaps against the normative semantics

- FFI host member paths keep their own non-long-identifier representation permanently (`D33`);
  authored and generated FFI identities are related through compiler facts, and the LSP symbol
  index consumes only interface occurrences.
- Internal visibility flags remain unused; surface `private` is deliberately deferred.
- Re-export is deliberately absent until forwarding identity is designed.
- `src/module_interface.ts` now contains an initial strict-analysis artifact with `ModuleId`, public
  environment, origins, dependencies, import projections, basis profile, a snapshot-local
  generation, diagnostics, and structured completeness. Each analysis creates an opaque
  project-snapshot owner shared by its module interfaces; separate analyses of the same paths do not
  share that ownership. Warnings no longer imply incompleteness. The artifact now carries initial
  compiler-owned value, structure, type-declaration, type-use, and constructor occurrence records
  with source spans, module import-path occurrences, distinct import-source and import-alias roles,
  and simultaneous namespace targets for named imports. Type uses come directly from elaboration,
  not a tooling spelling resolver. Nominal record fields now have stable `FieldId` identities shared
  by declarations, literals, patterns, and inference-resolved projections across module boundaries.
  A projection with multiple nominal record candidates deterministically selects the first field
  identity and emits `record.ambiguous-projection`, asking for a receiver/binding/parameter
  annotation. The unannotated receiver keeps its structural row constraint; selecting an occurrence
  target does not silently cast it to the first nominal record. An annotation, or earlier projection
  evidence that leaves one compatible record candidate, resolves the field without that warning. A
  field with no nominal candidate remains structural and has no fictional nominal target. Value,
  constructor, and nominal-field
  occurrences carry references into an immutable, protocol-neutral semantic type arena. The arena
  preserves generalized-versus-instantiated use, quantified-variable counts, structural type shape,
  and stable nominal `TypeNameId` when available; mutable inference `Ty` objects do not escape
  through the interface. Module alias qualifiers are covered for values, constructor and pinned
  patterns, and types. Qualified type elaboration records the exact resolved namespace `StaticEnv`;
  interface assembly matches that object to its import occurrence and `StructureId`. This preserves
  distinct identities for repeated aliases of the same module without re-resolving the dotted
  spelling. Ordinary host-basis values now carry stable `basis-value:*` identities,
  compiled-standard public values carry owner-qualified `standard-value:*` identities, and their
  structures carry stable `basis-structure:*` identities. These identities travel on schemes through
  ordinary structure projection and import cloning, so references such as `print` and `Option.map`
  use the same occurrence API as local values. They remain stable across project snapshots while
  local `BindingId`s remain snapshot-owned. Protocol-neutral queries map source offsets to
  occurrences, semantic identities back to every recorded project occurrence, and occurrences back
  to compiler-owned declaration definitions. Public value/type/constructor origins carry exact
  source spans and visibility. Compiler-owned lexical snapshots now expose declaration-ordered value
  and structure scopes for top-level declarations, imports, blocks, lambdas, and match arms,
  overlaid on the captured initial basis/standard environment. Local/imported types and
  constructors, JS-import bindings, and reflected foreign types use the same checkpoints and their
  compiler identities. FFI-generated JS aliases retain separate lowering identities plus an explicit
  compiler relation to the authored import identity, so tooling sees authored names while runtime
  emission remains collision-safe. Compiler-owned type-variable regions now cover one shared
  annotation-variable environment per `let ... and` group, lambda parameter/result annotations, and
  explicit record/datatype parameters. Each region exposes its elaborator identity, lexical extent,
  reference spans, and an explicit binder span when the syntax has one; scope and definition queries
  consume those same facts. Every elaborated expression, pattern, and authored type expression with
  a source node is also frozen into a per-interface typed-node index. Smallest-containing-node
  queries distinguish generalized binder schemes from instantiated occurrences and preserve nominal
  identity through type shadowing. Occurrence and scope completeness are audited and derived:
  strict analyses report both complete, recovered analyses partial.
  For successfully parsed current source, partial inference now records a certified
  declaration prefix and recovery boundary, transactionally re-elaborates that prefix after a
  failure, and can build a partial project snapshot containing only its certified semantic facts and
  reachable imports. Recovered analysis additionally masks malformed explicit top-level phrases
  without shifting source offsets and transactionally continues after independent syntax,
  elaboration, and import failures. Valid later imports still extend the recovered project graph;
  failed/dependent phrases contribute no bindings. Finer recovery inside one malformed phrase
  remains frontend-v2 work. Failed declarations/phrases contribute no typed nodes; independently
  recovered later phrases do. Named value/constructor import source and alias occurrences now retain
  their exported generalized scheme while ordinary uses retain their local instantiation. The final
  tooling contract still lacks complete source mappings and final GPU elaboration results. Result
  carrier-lifting plans now cross the same interface boundary with source spans, wrapped-versus-pure
  operand choices, and frozen semantic error/payload types. GPU overload obligations,
  builtin/resource uses, selected fragment roots, and selector calls now cross that boundary too,
  with every HM type represented through the shared semantic type arena. Normalized slice inputs are
  recursively frozen on their owning module interfaces. A compiler query keyed by project-snapshot
  and interface-generation identity produces immutable per-module specialized occurrence,
  representation, and builtin-selection results from those slices. Applicable GPU completeness is
  therefore `complete`; modules with no GPU semantics report `not-applicable`. Final-graph FFI facts explicitly
  describe authored JS targets, safety/type-only mode, authored source/local bindings, fallibility,
  structure aliases, immutable signature types, and reflected foreign-type keys/identities.
  Compiler-generated aliases are excluded. Strict applicable FFI reports `complete`, non-FFI modules
  report `not-applicable`, and conservative/recovered failures report `partial`. Delayed reflected
  type materialization now resolves qualified types through `StrEnv` instead of a parallel flat-name
  lookup.
- Project snapshots now distinguish headed and detached contexts and record frontend/surface
  configuration. A compiler project-context registry selects existing active coverage before
  consulting a syntax-only reverse-import index, activates exactly one closest main-bearing head,
  and keeps overlapping snapshots separate. Its forward analysis cannot recursively trigger another
  head search. The LSP validation index mirrors this scheduling rule: workspace enumeration is
  discovery-only, main-bearing dependencies below an active head remain ordinary dependencies, and
  unrelated indexed files no longer receive diagnostics after nearby changes. A two-head overlap
  regression additionally proves that one shared path retains separate diagnostics, occurrences,
  scopes, semantic type arenas, definitions, and query results in both snapshots, even when their
  snapshot-local numeric compiler IDs happen to repeat.
- Namespace-to-`carrier` is an expression-level fallback and does not install an alias value.
- The Core and analysis facts carry module, structure, value, constructor, and qualified-member
  identities, consolidated into the module interface artifact (`A601`–`A615`).
