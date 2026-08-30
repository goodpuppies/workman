# Program evidence graph unification

Status: deferred architecture proposal. This is not a visual-v1 wmslang prerequisite.

## Proposal

Unify the compiler's resolved program facts and its auditable diagnostic evidence around one
program-level semantic evidence graph.

The graph would be the durable record of claims the compiler established, the constraints and rules
which established them, and the relationships between source syntax and semantic identities.
Existing compiler-facing maps remain as efficient indexes over that graph. A diagnostic becomes a
failed premise plus a relevant graph slice. A compiler boundary such as wmslang schema v2 becomes a
closed projection of final, relevant facts rather than a copy of the whole reasoning history.

This proposal follows two existing directions:

- [`type-inspection-facts.md`](./type-inspection-facts.md) records resolved information beside the
  unchanged surface AST for hover, debugging, and downstream compiler consumers;
- [`diagnostic-object-model.md`](./diagnostics/diagnostic-object-model.md) represents an error as a
  failed premise supported by claims, constraints, substitutions, searches, rules, and causal edges.

These systems ask different questions of substantially the same semantic history. Keeping their
views distinct is useful; keeping their sources of truth permanently separate is not necessarily
useful.

## Motivation

The resolved-facts side answers questions such as:

- which declaration a reference denotes;
- which nominal record or constructor a syntax node denotes;
- what type an expression or recursively nested pattern received;
- whether a call is self-recursive, mutually recursive, or external;
- which lambda a shader selector selected;
- which bindings a shader root captures.

The diagnostic-evidence side answers questions such as:

- which rule was active;
- which premise failed;
- where the conflicting types or other observations came from;
- which earlier constraint committed a type variable;
- which source paths caused a property, call, or pattern requirement to reach the failure;
- how the programmer can replay the relevant compiler state.

Both sides therefore associate semantic claims with identities, source origins, and derivation
relationships. A final fact such as "expression `e` has type `T`" is also potential diagnostic and
inspection evidence. Conversely, the constraint history explaining `T` can be useful even when
compilation succeeds: an editor could answer "why does this expression have this type?" without
reconstructing inference after the fact.

The goal is not merely to avoid repeated inference. The stronger goal is to make name resolution,
inference, Core lowering, shader analysis, diagnostics, and editor inspection agree on one semantic
interpretation of the program and retain enough provenance to explain it.

## Why not annotate or mutate the surface AST

A fully typed and resolved AST is a valid compiler architecture. A reference node could be replaced
with a node carrying its `BindingId`, inferred type, and origin. This would avoid some side tables,
but it would make the surface tree serve several incompatible purposes:

- exact representation of authored syntax;
- mutable inference work state;
- final resolved program;
- recovery and partial-program representation;
- input to host Core lowering;
- input to shader normalization;
- identity anchor for editor and diagnostic queries.

Those consumers do not all become ready at the same time and do not all require the same projection.
Destructively elaborating the surface tree also makes it harder to preserve failed attempts,
historical type commitments, recovery alternatives, and authored syntax independently from final
semantics.

The proposed graph keeps the surface AST stable. Syntax nodes remain anchors; semantic nodes and
edges describe what the compiler learned about them. Closed typed IRs may still be constructed for
Core and wmslang after the relevant analysis is complete.

## Conceptual model

The graph has program-scoped semantic nodes and typed causal edges. It is append-oriented during a
compilation. Specialized indexes provide efficient queries and may be built incrementally.

```text
Workman source
    -> stable surface AST
    -> program semantic evidence graph
         -> ProgramAnalysis indexes
         -> diagnostic support slices
         -> hover and explain-type queries
         -> host Core inputs
         -> schema-v2 GPU projection
```

An illustrative, deliberately incomplete node model is:

```ts
type SemanticNode =
  | SyntaxNode
  | BindingNode
  | TypeDeclarationNode
  | RecordNode
  | ConstructorNode
  | PatternNode
  | TypeSnapshotNode
  | ClaimNode
  | RuleNode
  | PremiseNode
  | ConstraintNode
  | SubstitutionNode
  | SearchNode
  | RecursionGroupNode
  | ShaderRootNode
  | ShaderSelectorNode
  | RecoveryNode;
```

Illustrative edges include:

```ts
type SemanticEdge =
  | ResolvesTo
  | Declares
  | Binds
  | HasType
  | Instantiates
  | Requires
  | Constrains
  | Substitutes
  | DerivedFrom
  | IntroducedBy
  | Satisfies
  | Contradicts
  | MemberOf
  | Calls
  | Selects
  | Captures
  | RecoversWith;
```

The exact variants should be derived from real compiler queries. This document does not freeze a
schema.

## Example: tracing a distant type cause

Suppose a property operation near the top of a program requires a value to have property `y`, but
the value's type was fixed by a call or binding many inference steps away.

The graph might contain:

```text
property expression `.y`
  --introduced--> requirement "receiver has y : Number"
  --constrains---> type variable a

reference `x`
  --has-type-----> type variable a
  --resolves-to--> BindingId 17

distant argument expression
  --flows-to-----> BindingId 17
  --has-type-----> nominal type Foo

type variable a
  --solved-as----> nominal type Foo
```

If `Foo` has no field `y`, the diagnostic roots its support slice at the failed requirement and the
collision. Following the two causal paths explains both where the property requirement originated
and where the incompatible receiver type originated. The renderer need not guess which source site
is "wrong" and need not rebuild provenance from the final mutable type graph.

The same stored relationships support a successful inspection query. If `Foo` does contain `y`, an
editor can still explain why the property operation has its resulting type.

## Final state and historical evidence

Unification mutates the current `Ty` graph. Final semantic facts and historical evidence therefore
cannot simply hold references to those mutable objects.

The unified design must distinguish:

- **live solver state**, used internally while inference proceeds;
- **immutable observations**, captured when a constraint, commitment, collision, or other meaningful
  semantic event occurs;
- **final resolved facts**, published after pruning and successful analysis;
- **failed or recovered facts**, retained only when needed to explain a diagnostic or partial
  program.

For example, the final fact may say that expression `e` has type `Number`, while the historical
evidence says that constraint `C4` first related two variables and constraint `C19` later committed
one of them to `Number`. The final fact is suitable for lowering; the historical path is necessary
for explanation.

Immutable type snapshots remain necessary. Unification events should refer to snapshots and stable
semantic IDs rather than expecting a later traversal of mutated `Ty` nodes to reconstruct history.

## Views over the graph

### Program analysis indexes

Compiler passes need direct lookup rather than general graph traversal. `ProgramAnalysis` should be
understood as a set of materialized views or indexes, for example:

```text
surface reference object -> BindingId
surface pattern object   -> PatternId and binding facts
BindingId                 -> declaration and recursion membership
constructor use object   -> CtorId
fragment call object      -> GpuSelectorId and GpuRootId
GpuRootId                 -> selected lambda and capture closure
```

These maps are not competing sources of truth if their entries are created from, or registered with,
the same semantic identities and claims. They are the performance-oriented API used by ordinary
compiler code.

### Diagnostic support

An auditable diagnostic contains:

- the failed rule and premise;
- immediate contradictory or missing observations;
- roots into the program evidence graph;
- the relevant causal slice;
- proposed repairs and their prerequisites.

A diagnostic should not serialize the complete program graph. It should retain or project the
smallest sufficient slice needed to replay the failure. Renderer modes can choose how much of that
slice to show.

### wmslang schema

The wmslang boundary needs a deterministic immutable program projection, not inference history. It
should include only the selected shader roots and their closed, final semantic dependencies:

- logical modules and source spans;
- resolved bindings and declarations;
- nominal type, record, and constructor identities;
- patterns and recursion groups;
- operation identities and final representation facts;
- shader roots, selector occurrences, captures, and uniform schemas.

Constraint histories, failed alternatives, diagnostic rendering state, and mutable TypeScript
objects do not cross this boundary. A wmslang diagnostic may refer to the transported semantic IDs
and add its own lowering evidence, which can later be joined to the host graph by those IDs.

### Editor and inspection tools

Hover remains a compact final-state projection. An explicit trace view may request paths such as:

```text
why does this expression have this type?
why does this reference resolve here?
why is this helper reachable from this shader?
why is this value classified as a capture?
```

This extends auditable reasoning beyond failures without making verbose traces the default user
experience.

## Identity and lifetime

The current systems use different identity domains:

- live analysis often keys maps by TypeScript AST object identity and assigns compiler-global
  numeric semantic IDs;
- diagnostic support currently allocates local string evidence IDs;
- serialized compiler boundaries require deterministic closed numeric rows.

Unification does not require one ID format for every purpose, but it does require explicit joins.
Likely identity classes are:

- ephemeral syntax anchors valid for one compiler invocation;
- program-scoped semantic IDs for bindings, declarations, patterns, modules, and shader roots;
- append-only evidence-event IDs for claims, constraints, and substitutions;
- schema-local row IDs in a deterministic serialized projection.

Conversions between these domains must be deliberate and validated. Source spelling is never a
semantic join key.

## Incremental path

This proposal should not interrupt visual-v1 wmslang. It can be approached later through compatible
steps:

1. Treat `ProgramAnalysis` as one coherent resolved-program product rather than a collection of
   unrelated mini-passes.
2. Keep new analysis facts keyed by shared binding, nominal, pattern, module, and root identities.
3. Give final facts explicit source origins where those origins are known.
4. Allow diagnostic claims and constraints to refer to shared semantic IDs instead of repeating
   names or opaque descriptions.
5. Introduce a program-scoped evidence store while retaining the existing fast maps.
6. Make each diagnostic select a support slice from that store rather than owning an unrelated
   evidence universe.
7. Add successful inspection queries only after failure traces are correct and bounded.
8. Consider replacing individually maintained fact maps with generated/materialized graph indexes
   only when doing so simplifies real compiler code.

The first valuable convergence is shared identity and provenance, not a generic graph framework.

## Constraints and risks

- Recording every unifier or compiler implementation step would be too large and would expose noise
  rather than semantic reasoning. Evidence capture points must correspond to rules, claims,
  constraints, commitments, searches, and transformations meaningful to a programmer or compiler
  consumer.
- A general graph traversal must not replace constant-time compiler lookups on hot paths.
- Recovery evidence and failed inference attempts must not become authoritative successful facts.
- Mutable `Ty` nodes must never serve as historical evidence.
- Schema-v2 stability must not depend on diagnostic event ordering or graph allocation accidents.
- Host and shader branches must share semantic identities without making shader bodies pass through
  Workman Core.
- Memory and compile-time costs need corpus measurements before retaining full successful traces by
  default.
- A graph API must not hide which phase owns a semantic decision or permit two phases to publish
  contradictory authoritative claims silently.

## Non-goals

- Replacing the surface AST with the evidence graph.
- Making wmslang consume the whole host inference history.
- Serializing all diagnostic evidence into production shader artifacts.
- Replacing typed Core or typed wmslang IR with a generic graph.
- Reimplementing HM inference as a graph solver merely to fit this representation.
- Making visual-v1 shader delivery wait for program-wide evidence unification.

## Consequence for current wmslang work

The current side-table direction remains compatible with this proposal and is preferable to
destructive surface-AST mutation when the compiler also cares about diagnostics, partial programs,
editor inspection, and multiple lowering branches.

Current wmslang facts should nevertheless stay narrow. A persistent fact or identity is justified
when it is shared across compiler consumers, unsafe to reconstruct by spelling, required for a
stable boundary, or useful as authoritative provenance. Temporary results owned by one lowering pass
should remain local.

Schema v2 should be designed as one validated projection of resolved program evidence. It should not
prematurely freeze the complete future evidence graph, but its stable semantic IDs and explicit
origins should make a later join possible.

## Open questions

- Which successful inference events are worth retaining by default, and which should be enabled only
  for trace or editor modes?
- Should evidence storage be program-global, module-local with cross-module edges, or a hybrid?
- How should failed and recovered claims be isolated from authoritative resolved facts?
- Which `ProgramAnalysis` indexes can be generated from registered graph claims, and which are
  clearer as purpose-built analyses?
- How should Workman-owned wmslang lowering evidence join the TypeScript-owned host graph without
  coupling the two implementations at every compiler pass?
- What deterministic identity is required for cached evidence across compiler invocations, if any?
- What bounded graph-slicing rule gives useful explanations without dropping a distant causal path?
