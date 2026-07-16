# wmslang expanded functional lowering

Status: expanded lowering design for immutability, finite ADTs, patterns, and direct self-tail
recursion. The vertical slice in [`v1-scope.md`](./v1-scope.md) requires only immutable scalar
control flow, one option-like ADT with top-level constructor arms, and one fixed-signature direct
self-tail loop. General records, nested patterns, pattern matrices, representation-specialized
layouts, and multi-specialization SCC analysis are post-v1.

Terminology note: unqualified “v1” statements below describe the expanded lowering design. The
current slice is only the restricted subset named above.

## Implemented slice checkpoint

The static-fragment slice now has a schema-v2 functional IR pass in `tooling/wmslang/slice_ir.wm`.
It deliberately stops before ANF and target control flow:

- source blocks become nested immutable `let` and `sequence` nodes;
- all nodes retain concrete schema-v2 type IDs, source expression IDs, spans, and resolved semantic
  targets;
- restricted matches retain ordered IR-arm rows and resolved pattern IDs;
- tail position propagates through function results, `if`, match arms, and block results;
- a direct self-call in tail position becomes `tail-call`; another self-call receives
  `gpu.recursion.non-tail`;
- constructor coverage is checked against the complete declaration-order ADT table and an incomplete
  match receives `gpu.pattern.non-exhaustive`;
- the TypeScript output loader validates every function, expression, arm, type, pattern,
  constructor, binding, span, and child reference.

The broader representation-specialized layouts, nested pattern matrix, ANF, joins, switches, and
loop lowering described later in this document remain future work. They are not partially encoded in
the functional IR.

The contract is deliberately independent of optimization. A correct implementation may emit extra
private structs, locals, assignments, and branches. It may not change Workman evaluation order,
binding identity, constructor identity, match behavior, or recursion semantics to make the target
code smaller.

## Current-state gap

The existing schema-v1 GPU boundary is an H0 scaffold, not a representation of this v1 subset:

- `GpuExprDto.kind` and `GpuIrExprDto.kind` are open strings with positional `children` only;
- `match`, records, lambdas, and pipes are currently classified as unsupported;
- match patterns and arm spans are not normalized at all;
- schema-v1 rows omit constructor declarations/references, tags, payloads, and record identity even
  though final program analysis now owns those facts;
- named schema-v1 types retain a display name but do not transport the shared semantic type/record
  identity or record/ADT shape;
- recursive `let` intent is not carried into `GpuFunctionDto`;
- the current typed functional IR is a specialization-owned clone of those same shallow expression
  rows, so it cannot safely recover any missing meaning.

The slice uses schema version 2 across the TypeScript DTO, Workman mirror, loader validation, and
generated-library tests. There is no v1-to-v2 compatibility adapter that guesses constructors,
patterns, semantic operations, or recursion from names. Schema v1 remains an explicitly named H0
fixture boundary only.

## Shared semantic identity

Bindings and constructors occupy different Workman namespaces and require different IDs. An authored
value may shadow a constructor in expression position, while a constructor pattern still has
constructor meaning established by inference. Source spelling is therefore insufficient.

Program analysis should produce one shared semantic-ID bundle in deterministic module-graph order:

```text
BindingFacts
  value binder/reference -> BindingId

ConstructorFacts
  type declaration       -> TypeNameId
  record declaration     -> RecordId
  constructor declaration/reference/pattern -> CtorId
```

The existing `CompilerIdAllocator` has separate counters for these ID families. Final program
analysis now creates one `NominalFacts` bundle in module/source order, including block-local
declarations, and preserves each constructor declaration token through inference and imports. Core
consumes that bundle directly for declarations, expressions, and patterns; its former post-lowering
textual import resolver and parallel constructor allocator have been removed. Schema v2 must carry
the same facts into wmslang rows. This guarantees that JavaScript output, shader IR, diagnostics,
cross-module imports, and snapshots describe the same declaration.

Built-in constructors retain the fixed negative IDs from `basis.ts` (`None = -1`, `Some = -2`, and
so on); basis type declarations now use a closed negative `TypeNameId` catalog. Authored
declarations use deterministic non-negative allocator IDs. `Option<T>` can therefore be a legal
finite private shader ADT when `T` is reifiable, while the recursive basis `List<T>` fails storage
finiteness validation.

Inference remains authoritative for whether a name is a constructor and for its instantiated type.
Resolution supplies identity, not type meaning. The normalizer rejects any constructor occurrence
whose inference fact and constructor fact disagree.

Compiler-owned operations such as `Gpu.f32`, `Gpu.color`, and the visual `sin` use their separate
closed `GpuSemanticId` catalog. They never consume `BindingId` or `CtorId` values and are not
recognized from dotted or unqualified spelling.

## Schema-v2 semantic rows

The transport remains flat, JavaScript-native data. The exact TypeScript spelling may follow the
existing DTO style, but v2 must carry these concepts explicitly.

### Type and declaration rows

`GpuTypeDto` adds stable declaration identity for named types and distinguishes nominal records from
ADTs. A concrete named instance still references normalized type-argument rows, whose numeric
representations may be solved per function specialization.

```text
GpuTypeDto
  id
  kind: ... | record | adt
  semanticTypeId: TypeNameId or -1
  recordId: RecordId or -1
  items: concrete type argument IDs

GpuRecordShapeDto
  recordShapeId, recordId, semanticTypeId, name, modulePath
  fields: [{ name, declaredIndex, typeId }]

GpuAdtShapeDto
  adtShapeId
  semanticTypeId
  typeId
  name
  constructors: GpuConstructorShapeDto[]

GpuConstructorShapeDto
  constructorId: CtorId
  name
  tag
  payloadTypeIds
```

An ADT shape is monomorphic in HM shape but may still contain abstract numeric rows until GPU
representation solving completes. Its key is the semantic type declaration plus concrete normalized
HM type arguments, never the display name. Tags follow constructor declaration order starting at
zero and do not depend on reachability or which constructors appear in source expressions.

The normalizer instantiates constructor payload shapes using the inference result's `TypeDeclInfo`,
`paramTypeIds`, and `ctorTypes`, just as Workman's exhaustiveness checker substitutes the concrete
named-type arguments. All constructors are included even when a reachable shader only constructs one
of them. After numeric solving, the Workman middle-end creates a `GpuAdtLayoutDto` per distinct
`(adtShapeId, representation overlay)` and deduplicates equal layouts across specializations. Thus
the same HM shape can correctly produce separate `Escape<i32>` and `Escape<f32>` shader layouts.

### Pattern and match rows

Patterns need their own table because they carry binders, projections, tests, and source spans:

```text
GpuPatternDto
  id, kind, typeId, spanId
  bindingId                 // variable binder only
  constructorId             // constructor pattern only
  literal value             // literal pattern only
  fieldIndices / children   // product and record subpatterns
  pinnedBindingId           // pinned value pattern only

GpuMatchArmDto
  id, patternId, bodyExprId, spanId

GpuLetDto
  id, patternId, valueExprId, bodyExprId, spanId

GpuParamDto
  id, patternId, typeId, declaredIndex, spanId
```

`GpuExprDto` represents a match with an explicit scrutinee ID and ordered arm IDs. Constructor
expressions carry `constructorId` and ordered argument IDs. Records carry `recordId` and stable
field indices. A field's semantic identity is `(RecordId, declaredIndex)`; no spelling-only
`FieldId` is invented. As with ADTs, the middle-end derives a `GpuRecordLayoutDto` for each distinct
representation overlay after solving. Calls separately carry either a resolved function
specialization target or a `GpuSemanticId`—never a textual callee classification.

The supported v1 pattern set follows existing finite Workman values:

- wildcard and variable binders;
- boolean and `i32` literal patterns supported by the current Workman surface grammar;
- tuples/products and nominal records;
- finite ADT constructor patterns, including nested constructor payload patterns;
- pinned values only when they resolve to a GPU-reifiable compile-time scalar constant.

String patterns, lists, recursive layouts, resource patterns, function patterns, and runtime pinned
host values are rejected at their pattern spans. Workman does not currently author `f32` literal
patterns.

Pattern spelling depends on its existing Workman grammar context and is resolved before the DTO:

- in a `match`, a bare name is `PPinned`; `Var(name)` is the explicit binder;
- in a `let`, a bare lowercase identifier is `PVar`, while constructor syntax remains `PCtor`;
- parameter patterns use bare identifiers as `PVar` and do not admit pinned/literal patterns.

Workman's let and parameter grammars also admit list-pattern sugar. The frontend has already
desugared that syntax to `Nil`/`Cons` constructor patterns before inference and normalization, so
schema v2 never receives a separate list-pattern spelling. The expanded lowering design rejects
those resolved rows as refutable and recursively laid out; it does not confuse their original
parameter context with an irrefutable binder pattern.

Schema v2 transports the resolved pattern kind and IDs. It never tries to reproduce these grammar
rules from the name string.

### Irrefutable let and parameter patterns

V1 accepts parameter patterns and `let` patterns only when they are statically irrefutable from
their inferred type:

- `PVar`, `PWildcard`, and typed `PVoid`;
- nested tuples/products containing only irrefutable patterns;
- nominal record patterns containing only irrefutable field patterns.

List patterns are excluded with recursive layouts. Literal, pinned, and constructor `let` patterns
are rejected as `gpu.pattern.refutable-let`, even if a particular constructor happens to be the only
one currently reachable. Refutable behavior belongs in an exhaustive `match`.

The functional builder evaluates a let initializer once, then elaborates an irrefutable pattern into
stable `Project` plus single-binder `Let` nodes in source pattern order. A wildcard still evaluates
its initializer and becomes `Sequence`; it does not erase a potentially diverging call. Record
fields project by `(RecordId, declaredIndex)`, not pattern spelling.

A destructuring function parameter retains one physical parameter for the source parameter position.
The helper prologue projects that value and creates immutable locals for each pattern `BindingId`
before evaluating the body. A simple `PVar` may use the physical parameter directly. All generated
projections carry the parameter-pattern span.

The current TypeScript prerequisite keeps constructor lookup facts separate from authoritative
pattern-result types: `TypeFacts.patternTypes` records the expected type at every recursive pattern
inference entry, while constructor-origin facts retain the instantiated constructor function.
`ResolvedPatternFacts` then assigns deterministic pattern/parameter/let/arm IDs and joins those
types to shared binding, constructor, record, and declared-field identities. These are internal
facts only; they do not partially extend the schema-v1 transport.

### Functions and recursion

Static selection produces an explicit root row rather than reusing the old discovered-region index:

```text
GpuRootDto
  rootId: GpuRootId
  functionId
  selectorExprIds
  selectorSpanIds
```

Repeated `Gpu.fragment` selections resolving to the same lambda share one root row; selector IDs and
spans remain in authored module/source order. An inline lambda still receives a `GpuFunctionId` and
`GpuRootId` even though it has no source `BindingId`.

`GpuFunctionDto` adds its declaration's `recursive` flag and recursive-group identity. v1 accepts a
group of one and diagnoses a reachable group with more than one function as unsupported mutual
recursion. The flag is not inferred later merely because a call target equals the current function.

The current target-neutral `RecursionFacts` assigns group identity directly from each authored
`let rec ... and ...` declaration and records its ordered member `BindingId`s. Resolved references
distinguish direct calls, pipe invocations, and function-value uses, and classify self, same-group
mutual, and external edges without consulting spelling. A nested non-function let initializer keeps
the enclosing function owner; a nested lambda or nested recursive declaration starts a new owner.
Tail-position and reachable-specialization validation consume these facts later rather than trying
to reconstruct authored groups from a call graph.

## Typed functional IR

After reachability, concrete HM-shape specialization, numeric representation solving, and capture
classification, every specialization owns a closed typed functional tree. It uses a closed node kind
rather than copying arbitrary source strings. The accepted free-value categories are fixed in
[`v1-captures.md`](./v1-captures.md); `Constant` below means its closed literal tree, never an
evaluated arbitrary Workman expression.

```text
Literal            Bool | I32 | F32
Local               resolved BindingId
Constant            legal compile-time capture
UniformRead         explicit uniform identity and field
Vector              ordered component expressions
Product             ordered item expressions
Record              RecordLayoutId plus ordered field expressions
Project             typed product/record projection with semantic field index
Let                 BindingId, value, body
Sequence            ordered discarded expressions, then result
If                  condition, then, else
Construct           AdtLayoutId, CtorId, ordered payload expressions
Match               scrutinee, ordered typed arms
Unary / Binary      closed typed operator ID
Call                target SpecializationId, ordered arguments
Intrinsic           GpuSemanticId, ordered arguments
Convert             GpuSemanticId.I32 or GpuSemanticId.F32, operand
Color               four f32 components
TailCall            self SpecializationId, ordered arguments
```

Each node carries its concrete shader type, source span, and source expression ID. Constructor,
record, field, binding, function, and intrinsic identities are numeric semantic facts. Display names
exist only for diagnostics and deterministic generated-name hints.

There is no general function-valued node in v1. A source variable referring to a reachable helper is
legal only as the callee of a resolved direct call. There is likewise no mutation, assignment, loop,
switch, target-language syntax, or implicit conversion in this IR.

The closed operator IDs, legal operand/result shapes, and intrinsic semantic IDs are defined in
[`v1-operations.md`](./v1-operations.md). IR construction validates those rows before ANF; the
backend cannot select a different Slang overload from source spelling. All numeric nodes are
concrete under the conflict/default/specialization rules in [`v1-numerics.md`](./v1-numerics.md); a
shared abstract debug row never authorizes an abstract IR node.

Surface block declarations normalize to nested `Let` nodes, while expression items normalize to a
`Sequence` followed by the block result. Every discarded expression is still evaluated exactly once
and left-to-right. It cannot be erased merely because accepted operations have no external effects:
a recursive call may diverge, so erasure would change Workman semantics.

When a block ends in `expr;`, the current parser places `expr` in the block items and records that
same source expression as `Void.implicitStatement` for diagnostic provenance. Schema v2 normalizes
the item as the single executable occurrence and the result as `Void`; it must not clone or evaluate
the implicit-statement reference a second time.

## Evaluation order

Current Workman JavaScript emission evaluates tuple items, record fields, callees, and call
arguments in source order through JavaScript's left-to-right expression evaluation. Its existing
direct-tail lowering evaluates the complete next tuple before the next loop iteration destructures
parameters. wmslang preserves this observable order even though accepted shader operations are pure:
a call may diverge, and changing which argument is evaluated first can therefore change program
behavior.

The functional IR stores every ordered child in source order. ANF conversion processes children
left-to-right and binds every non-atom exactly once before later siblings. No map iteration order
may participate in expression evaluation.

## Finite ADT layout

Implementation checkpoint: `tooling/wmslang/slice_layout.wm` now materializes the restricted v1
layout before control-flow lowering. The schema-v2 output contains one layout row and one field row
for each payload-carrying constructor; nullary constructors have only their declaration-order tag.
Field rows retain constructor identity rather than sharing slots by payload type. Emitted field
names remain an S3 backend concern derived from these IDs.

Each reachable, monomorphic, representation-specialized ADT layout becomes one private Slang struct:

```slang
struct wm_adt_0
{
    int tag;
    float wm_p_0;
};
```

The first field is always signed `i32` tag storage. Every constructor payload gets its own field,
named by its deterministic layout-field ID (`wm_p_{fieldId}`). Slots are not shared between
constructors even when their types match. This is larger than GLML's type-based slot sharing, but it
is deterministic, simpler to diagnose, and needs no optimization to be correct.

For example, `Escape = Inside | Escaped<Number>` maps `Inside` to tag zero and `Escaped` to tag one
with one `f32` field after specialization. ADT structs and fields remain private: they never appear
in the fragment ABI, uniform reflection contract, or Workman host value representation.

### Construction

Constructor arguments are ANF atoms evaluated left-to-right. A generated constructor operation
zero-initializes the entire plain struct, writes its valid tag, writes only that constructor's
active payload fields, and returns the value:

```slang
wm_adt_0 wm_make_ctor_1(float payload)
{
    wm_adt_0 value;
    value.tag = 1;
    value.wm_p_0 = payload;
    return value;
}
```

The generated constructor assigns every payload field. Its active field receives the payload and
inactive fields receive a typed zero, so no field is uninitialized.

Inactive zeroed fields are representation padding, not a Workman fallback value. They can never be
projected unless the tag selects their constructor. The compiler does not return a zero ADT, color,
or payload when a match or recursion path is missing.

### Finiteness validation

Build the storage-dependency graph for every reachable ADT/record instance. Edges follow payload and
field storage through products, records, and ADTs; scalar/vector leaves terminate. A cycle is a
recursive data layout and receives `gpu.adt.recursive-layout` at the payload field that closes the
cycle. Function and resource leaves receive their own unsupported-payload diagnostics.

This validation runs after monomorphic instance construction and before any Slang is emitted. A
recursive type is rejected even if target dead-code elimination might remove the recursive field.

## Match compilation

Workman's existing checker remains responsible for its ordinary exhaustiveness and redundant-arm
warnings. Because ordinary non-exhaustiveness is currently a warning, GPU validation additionally
requires every reachable match to be exhaustive and emits `gpu.pattern.non-exhaustive` at the match
when it is not. Shader lowering does not invent a fallback. It consumes ordered, typed, resolved
patterns and compiles them with a standard pattern-matrix decision algorithm like the one used by
GLML's `lower_variants.ml`, adapted to Workman's constructor and binding IDs.

Rules:

1. Evaluate the scrutinee once into a stable ANF atom.
2. Preserve source arm priority.
3. Choose a deterministic decision column from source pattern order.
4. Test an ADT's `tag`; project payload fields only inside the matching constructor branch.
5. Project tuple/record components into stable typed atoms before testing nested patterns.
6. Bind a pattern variable only on the path where all enclosing tests succeeded.
7. Carry the original pattern and arm spans onto tests, projections, and branch bodies.
8. Produce one expression result of the match's already-inferred type.

For a complete finite constructor signature, the final valid constructor is emitted as the target
switch's `default` arm. This mirrors GLML and gives Slang/WGSL a structurally complete switch
without inventing a zero return. The default is the final constructor case under the internal
invariant that all ADT values originate from generated constructors; it is not a source wildcard or
recovery path. If an authored wildcard/default arm exists, that arm remains the default and retains
its source priority.

An impossible empty matrix after successful Workman exhaustiveness is an internal compiler error,
not generated shader behavior. It retains the normalized reflection/IR dump and never emits a
synthetic color or payload.

## Immutable expression joins

ANF makes conditions, operands, arguments, and constructor payloads atomic. The lowered structured
control-flow IR then introduces target-only locals:

```text
Atom = typed local or literal

Operation = unary | binary | vector | record | project | construct | call | intrinsic | convert

Statement =
  LetLocal immutableLocal = Operation
  Evaluate Operation
  DeclareJoin mutableLocal, type
  Assign mutableLocal = Atom
  If Atom then Block else Block
  Switch Atom cases ... default ...
  Loop Block
  Continue
  Return Atom
```

An `if` or `match` in value position declares one join local. Every reachable branch assigns it
exactly once before control rejoins. The Slang emitter may initialize that local with `{}` to
satisfy definite-assignment checking, but the initializer is not a semantic fallback: validation
proves all source branches assign, and tests snapshot that proof. In tail position, branches emit
`Return` or `Continue` directly and need no join.

`Evaluate` preserves a discarded source expression after its operands and calls have been converted
to ANF. Source `let` bindings remain immutable `LetLocal` values. Only join locals, ADT construction
locals, and recursive parameter locals may be assigned in lowered IR. Each assignment records a
lowering reason so snapshots can distinguish the three cases.

## Tail-position analysis

Tail position begins at a specialized function body and propagates only through:

- the selected result of a block after all preceding declarations and expression items;
- both branches of a tail-position `if`;
- every arm body of a tail-position `match`.

It does not propagate into operands, conditions, constructor payloads, record/vector fields, call
arguments, let-bound values, or operations surrounding a call. A direct call is recursive only when
its resolved target `SpecializationId` is the current specialization.

Analysis classifies every self-call, not merely the first one:

- a self-call in tail position becomes `TailCall`;
- any self-call outside tail position produces `gpu.recursion.non-tail` at that call;
- an SCC containing more than one reachable specialization produces `gpu.recursion.mutual` at the
  participating declarations;
- a reachable recursive declaration with no recursive call is harmless and lowers normally.

The diagnostic note points to the recursive declaration and explains the allowed tail positions. No
failure is deferred to Slang.

## Tail-call lowering

A function containing `TailCall` becomes a target loop with mutable local copies of its parameters.
There is no hidden iteration counter, budget, or exhaustion value:

```slang
wm_adt_0 wm_escape(float cx0, float cy0, float zx0, float zy0, float remaining0)
{
    wm_adt_0 result;
    bool done = false;
    float cx = cx0;
    float cy = cy0;
    float zx = zx0;
    float zy = zy0;
    float remaining = remaining0;

    while (!done)
    {
        // A source return assigns result and sets done.
        // A source tail call updates the loop parameters and continues.
    }

    return result;
}
```

The result slot and `done` flag make the target function's definite return explicit to both Slang
and WGSL validators. They do not impose a hidden bound: `done` becomes true only when control
reaches an actual non-recursive source return.

At each `TailCall`, lower every next argument left-to-right into a fresh typed temporary while all
old parameter locals are still visible. Only after all temporaries exist are all parameter locals
assigned in declaration order, followed by `continue`:

```slang
float next0 = cx;
float next1 = cy;
float next2 = nextX;
float next3 = nextY;
int next4 = iteration + 1;
int next5 = maxIterations;

cx = next0;
cy = next1;
zx = next2;
zy = next3;
iteration = next4;
maxIterations = next5;
continue;
```

Always materializing every next argument keeps the v1 transform simple and proves simultaneous
parameter rebinding. Removing identity moves or temporaries is a later optimization. The classic
`swap(a, b) -> swap(b, a)` fixture must work without special cases.

Non-recursive source returns assign the result slot and set `done`; the function returns that exact
value after leaving the loop. Because source recursion is unbounded, an actually non-terminating
shader remains non-terminating; the compiler never substitutes a zero or a fixed maximum iteration
count. Acceptance shaders supply their own explicit bound as ordinary source logic.

## Pass order

The required order is:

1. Complete normal Workman inference, exhaustiveness checking, and shared semantic resolution.
2. Normalize schema-v2 types, declarations, patterns, expressions, spans, and semantic IDs.
3. Close reachability from `Gpu.fragment` roots and instantiate concrete first-order helpers.
4. Solve strict numeric representations and explicit conversions.
5. Build and validate monomorphic record/ADT storage graphs.
6. Reify the closed typed functional IR.
7. Mark tail positions and reject non-tail or mutual recursion.
8. Compile patterns and ADT construction while preserving `TailCall` nodes.
9. Convert left-to-right to ANF.
10. Introduce joins and lower `TailCall` to structured control-flow IR.
11. Emit deterministic Slang, then validate/link/reflect through the pinned backend.

Optimization is absent from this sequence. Reachability and specialization are required for a closed
target program; they are not justification for erasing tags, branches, or source calls.

## Diagnostics

At minimum this slice owns stable codes for:

| Code                          | Primary span                                       |
| ----------------------------- | -------------------------------------------------- |
| `gpu.recursion.non-tail`      | offending resolved self-call                       |
| `gpu.recursion.mutual`        | earliest call edge that closes the recursive SCC   |
| `gpu.adt.recursive-layout`    | payload/field edge closing the storage cycle       |
| `gpu.adt.unsupported-payload` | unsupported function/resource/string payload       |
| `gpu.pattern.unsupported`     | unsupported pattern form                           |
| `gpu.pattern.pinned-runtime`  | pinned value without a legal compile-time constant |
| `gpu.pattern.refutable-let`   | refutable `let` or parameter pattern               |
| `gpu.pattern.non-exhaustive`  | reachable match not proven exhaustive              |
| `gpu.adt.public-abi`          | ADT use at fragment, color, or uniform boundary    |

Inconsistent semantic IDs are a validated schema/IR boundary failure, not a shader-language
diagnostic. The common attribution and ordering contract is
[`v1-diagnostics.md`](./v1-diagnostics.md).

Backend errors after these validations are compiler/backend defects and include the generated Slang
plus normalized source facts. They are not rewritten as source feature errors.

## Focused proof fixtures

In addition to `mandelbrot_adt.wm`, implementation needs small structural tests:

- constructor tags remain in declaration order when only the last constructor is used;
- two constructors carrying the same type receive distinct payload slots;
- inactive payload fields are zero-initialized but never projected on the wrong tag;
- a nested finite ADT/tuple/record pattern evaluates its scrutinee once and preserves arm order;
- tuple/record parameter and `let` destructuring evaluate/project once into immutable binder IDs;
- a refutable constructor `let` is rejected while the equivalent exhaustive match succeeds;
- a non-exhaustive GPU match is an error even though ordinary Workman reports its standard warning;
- a discarded call remains in a `Sequence`/`Evaluate` operation and is not duplicated by
  trailing-semicolon provenance; a discarded self-call is separately diagnosed as non-tail;
- a bare pinned name is not converted into a binder;
- a match returning a vector and one returning an ADT each get a correctly typed join;
- a tail call under both `if` branches and every match arm becomes `TailCall`;
- `1 + self(...)` and `Ctor(self(...))` are diagnosed non-tail;
- `self(b, a)` uses temporaries and swaps correctly;
- a recursive ADT layout is rejected before Slang;
- the emitted recursive helper contains a loop, no self-call, and no hidden bound;
- all source and arm spans survive through the two IR snapshots.

These are focused tests beside the wmslang suite. The repository-wide long test task remains a
periodic integration check.

## Research relationship

GLML provides strong evidence for the overall shape: it lowers variants to tagged records, compiles
patterns as a decision matrix, converts to ANF, then replaces recursive tail returns with loop
continuations. wmslang intentionally differs in three places:

- tags and declarations use Workman's resolved semantic IDs instead of constructor strings;
- each constructor receives distinct payload fields rather than GLML's type-based slot sharing;
- recursion is semantically unbounded and has no GLML-style generated limit or zero-on-exhaustion
  path.

The current Workman JavaScript backend provides the source-language precedent for resolved
direct-self detection, tail positions through `if`/`match`/block results, and simultaneous next
arguments. Slang's local conformance material provides the target precedent for zero-initialized
plain structs and WGSL emission. Neither backend defines Workman shader semantics; the typed
functional IR and the rules above do.
