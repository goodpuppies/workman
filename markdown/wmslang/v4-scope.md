# wmslang v4 HM specialization

Status: implemented. V4 removes the routine shader-helper annotations exposed by the V3 creative
probes without adding typeclasses, implicit dictionaries, automatic coercion, or a second
user-visible shader type system. It combines ordinary Workman HM inference with reachable GPU
specialization and deferred exact validation of Slang builtin and existing GPU-operation
occurrences.

V4 also admits a deliberately bounded higher-order slice when every function value is known during
specialization and disappears before shader IR emission. It does not add runtime shader closures,
general defunctionalization, imported shader libraries, or module-level GPU reinterpretation.

## Motivation

V3 proved that a generated Slang builtin catalog is sufficient for substantial warped-noise and
raymarching shaders. Those ports also exposed an ergonomic and architectural weakness: local helper
parameters often require concrete scalar/vector annotations solely so an overloaded operation can be
selected while the helper body is first visited.

For example, the desired source is:

```workman
let smoothNoise = (p) => {
  let cell = floor(p);
  let local = p - cell;
  -- ...
};

let shade = (coord) => {
  smoothNoise(coord * 6.0)
};
```

The call already determines that `p` is a two-component GPU vector. Requiring
`(p: (Number, Number))` repeats information available from the reachable program. Conversely, giving
`floor` a public type such as `A -> A` would be unsound: Slang `floor` is not defined for every
Workman type `A`.

GLML solves the broader problem with Algorithm W plus constrained polymorphism, followed by
monomorphization, lambda lifting, and defunctionalization. V4 borrows reachable specialization but
does not import GLML's typeclass and coercion constraint language. Workman continues to expose
ordinary HM types. Slang eligibility remains an occurrence-local compiler obligation.

## User-facing rule

A reachable GPU-local helper is written and inferred like an ordinary Workman function. Its
parameters do not require scalar/vector annotations when its concrete uses determine one or more
legal GPU instantiations.

```workman
let fractionalX = (v) => {
  (v - floor(v)).x
};

let from2 = fractionalX((0.5, 1.5));
let from3 = fractionalX((0.5, 1.5, 2.5));
```

V4 may specialize this binding twice:

```text
fractionalX<f32x2> : f32x2 -> f32
fractionalX<f32x3> : f32x3 -> f32
```

The source shape remains an ordinary generalized HM function shape. For a GPU-local binding with
pending operation obligations, that scheme is a specialization template rather than an independently
valid promise that the body works for every Workman type. The existing nonescape rule makes that
distinction local to the selected GPU island: every reachable instantiation is validated before an
artifact exists. Workman does not display a type such as `Floor A => A -> Number`, invent a GPU
typeclass, or pass a hidden user-level dictionary. Annotations remain available as ordinary Workman
checks, but correct connected shader programs must not require them merely to drive overload
selection.

If a reachable specialization remains underdetermined after all call, root, uniform, projection, and
result context has propagated, V4 reports insufficient GPU type context. It does not guess a
scalar/vector width or silently default an overload.

Such a remaining variable is normally an unanchored recursive/divergent component or another rare
disconnected polymorphic value. It remains an error. An annotation is not an escape hatch for that
error; the program must contain ordinary value flow that makes the reachable specialization
concrete.

## Annotation erasure invariant

V3 temporarily treats a concrete annotation on a GPU-local helper parameter as overload-elaboration
evidence. V4 removes that behavior because it contradicts Workman's general annotation model. An
ordinary `: Type` annotation checks the type inferred from the program; it does not assert, cast,
default, seed, or repair that type.

The V4 invariant is one-way:

```text
if an annotated shader program is accepted,
erasing its ordinary type annotations must also be accepted
with the same GPU specializations, operation rows, and shader meaning
```

The reverse need not hold. Adding an incorrect annotation may reject an otherwise valid inferred
program, because annotations are allowed to add verification failures. Removing a correct
documentation annotation cannot remove information required by inference.

Consequently GPU elaboration and specialization must never:

- read annotation syntax as a candidate-filtering or overload-selection fact;
- use an annotation to make a specialization seed concrete;
- use an annotation to close a pending result slot or operation obligation;
- give an annotated and annotation-erased helper different specialization identities;
- suggest adding an annotation as the fix for insufficient GPU context.

Annotations may improve the wording and source location of a mismatch after inference, and they may
document an intentional API/boundary type already established by ordinary program structure. Those
roles do not affect accepted semantics.

For an unanchored reachable cycle, both forms fail:

```workman
let rec unknown = (value) => {
  unknown(value)
};

let output = length(unknown(coord));
```

Adding `: (Number, Number)` somewhere in that flow does not turn it into a valid specialization. V4
reports the unresolved concrete-input/result path. If a programmer intends a concrete value, that
intent must appear through an actual typed boundary or value-producing operation—for example the
fragment coordinate ABI, a nominal uniform field, a literal/constructor, or a concrete call—not an
annotation that changes inference.

## HM first, exact operation validation second

V4 separates two questions:

1. **HM shape inference:** which source occurrences must have equal ordinary Workman types?
2. **GPU operation eligibility:** does each now-specialized operation occurrence exactly match a
   supported Slang catalog row or an existing wmslang operator row?

During HM inference, a direct GPU builtin call creates ordinary argument/result type occurrences and
applies only sound structural equalities shared by its eligible family. Representative relations
include:

```text
floor       argument = result
sin         argument = result
dot         left = right; result = Number
length      result = Number
smoothstep  edge0 = edge1 = value = result
reflect     incident = normal = result
cross       arguments and result are concrete three-component vectors
```

These facts are inputs to ordinary HM inference from the beginning; they do not wait for
specialization. For each builtin name and arity, catalog generation can derive a small HM skeleton
from the eligible finite rows:

- a position is concrete when every row gives it the same concrete type;
- two positions share one HM variable when every row gives them the same type;
- otherwise the position receives a fresh HM variable;
- the complete finite rows remain attached only as an admissibility obligation.

For example:

```text
floor      : A -> A
length     : A -> f32
dot        : (A, A) -> f32
cross      : (f32x3, f32x3) -> f32x3
refract    : (A, A, f32) -> A
smoothstep : (A, A, A) -> A
```

The displayed `A` is an internal HM variable, not a public promise that every Workman type is legal.
The attached occurrence obligation later checks its finite admissible set. For example, `length`
fixes its result to `f32` immediately and requires its eventual `A` to be exactly `f32x2`, `f32x3`,
or `f32x4`.

Multiple argument shapes collapsing to one result shape are therefore not intrinsically difficult.
Likewise, if every overload returns `f32x2`, that result is an immediate HM input even when the
argument remains unknown. The difficult family is one whose argument and result vary together by a
relationship that cannot be expressed with fixed types and equality:

```text
hypotheticalShift : f32   -> f32x2
hypotheticalShift : f32x2 -> f32x3
hypotheticalShift : f32x3 -> f32x4
```

There is no ordinary HM skeleton more informative than `A -> B` for that family. V4 may select its
row once a specialization makes the arguments concrete, but it does not use an expected result to
run the finite table backward and infer the argument. A still-unresolved argument receives an
insufficient-context diagnostic. The current V3 `f32`/vector builtin catalog does not require this
more general reverse-mapping machinery for its common creative-shader families.

Existing scalar/vector operators use the same boundary. Their finite rows include already-supported
relations such as scalar/scalar, equal-width vector/vector, and the V2 scalar-vector broadcast. This
does not add automatic conversion: a scalar broadcast row is an explicit supported operation, while
integer promotion, width conversion, and scalar representation conversion remain absent.

When fixed positions and shared equalities do not decide a type during initial HM inference, the
occurrence retains fresh HM variables. Concrete use-site substitution and exact finite-row matching
close them during specialization. Initial V4 row selection is argument-driven: an expected result
checks the selected row and participates through the generated HM skeleton, but does not otherwise
choose among rows with differently mapped argument types. Failure to close them is an ambiguity or
insufficient-context diagnostic, not a new form of polymorphic constraint.

## Compiler-owned operators

Operators such as `+` are already compiler-owned syntax with semantic elaboration. They are not
ordinary Workman functions that must be assigned one universally valid polymorphic type, and V4 does
not turn them into user-overloadable names.

GLML represents a source binary operator as a dedicated `Bop` node. Its
[`typecheck.ml`](../../research/GLML/compiler/typecheck.ml) gives `+` and `-` a
`Broadcast(left, right, result)` constraint, gives `*` and `/` the richer
`MulBroadcast(left, right, result)` constraint, and uses separate class/coercion constraints for
comparison and equality. Its
[`constraint_solver.ml`](../../research/GLML/compiler/constraint_solver.ml) defers those constraints
while variables remain and later recurses through scalar, vector, and matrix shapes. That design
supports GLML's constrained polymorphism and promotion rules, but V4 does not need to reproduce that
general constraint language.

Each Workman operator occurrence instead carries a stable compiler-owned identity such as
`gpu.operator.add` plus a finite set of eligible rows. The arithmetic table remains the V2 table:

| Left    | Operator  | Right   | Result  | Meaning                       |
| ------- | --------- | ------- | ------- | ----------------------------- |
| `f32`   | `+ - * /` | `f32`   | `f32`   | scalar operation              |
| `f32xN` | `+ - * /` | `f32xN` | `f32xN` | componentwise, equal width    |
| `f32xN` | `+ - * /` | `f32`   | `f32xN` | explicit scalar broadcast row |
| `f32`   | `+ - * /` | `f32xN` | `f32xN` | explicit scalar broadcast row |

Here `N` is exactly 2, 3, or 4. Rows are directional even when an operation is mathematically
commutative, so subtraction and division do not acquire an accidental operand swap. Vector/vector
width mismatch has no row. Matrices, integer vectors, promotion, conversion, and user-added rows
remain absent.

Unary arithmetic, Boolean operators, equality, and comparisons have their own finite tables rather
than inheriting arithmetic broadcast mechanically. A comparison result is `Bool`; it does not become
a numeric mask unless a later scope explicitly introduces that operation. V4 preserves the currently
supported semantics for those operators and does not infer new Slang meanings merely because the
backend happens to accept them.

A generic helper therefore owns an unresolved finite operator occurrence:

```workman
let twice = (x) => {
  x + x
};
```

At source inference the two operands have the same HM type and the result remains related to that
one occurrence. Reachable uses create concrete specializations:

```text
twice<Number>  selects f32 + f32 -> f32
twice<Vec3>    selects f32x3 + f32x3 -> f32x3
```

An unsupported use reports the concrete failed row at the authored `+`, together with the call path
that created the specialization. It does not expose an `Add A` predicate or search for user-defined
instances.

### Primitive Result coercion composes outside the payload operation

Workman's existing automatic carrier behavior for operators is specifically the
[primitive `Result` coercion](../../docs/carriers.md#primitive-result-coercion). It is not general
implicit `Monad.lift`, and V4 does not make arbitrary carriers automatically participate in syntax.

The semantic ordering is:

```text
source binary/unary syntax
  -> recognize an existing supported primitive Result coercion
  -> expose the unwrapped payload type occurrences
  -> specialize and select the exact host/GPU operator row on those payloads
  -> wrap the selected operation result in the same Result error carrier
  -> lower the carrier plan and concrete semantic operation
  -> emit the applicable backend operation
```

For a binary operation, if either operand is `Result<T, E>`, pure operands are treated as `Ok`, two
error types must unify, and operator selection sees the unwrapped payloads. Conceptually:

```workman
Ok(vector) + 0.5
```

becomes:

```text
Result.map2(Ok(vector), Ok(0.5), (left, right) => {
  selected_gpu_add_vector_scalar(left, right)
})
```

Carrier structure decides **where** the operation executes; the finite operator table decides
**which** operation executes after unwrapping. Consequently a carrier wrapper must never hide a GPU
vector payload from specialization, and GPU operator selection must never be attempted against the
outer `Result<T, E>` as though it were a numeric shader type.

The implementation should retain these as two facts on the original source occurrence:

```text
PrimitiveCarrierPlan(Result, error type, wrapped operands)
GpuOperationObligation(gpu.operator.add, payload arguments, payload result, eligible rows)
```

This avoids depending on the incidental order of surface-to-Core rewriting and GPU dialect hooks.
Host Core may continue lowering the first fact to `Result.map`/`Result.map2`; shader lowering may
use an equivalent immutable ADT branch when that concrete carrier is otherwise representable in the
current shader slice. V4 does not, solely through this composition rule, broaden shader ADT
representability. A `Result<Vec3, E>` artifact remains subject to the existing finite/private ADT
rules, and adding general generic-`Result` shader storage is a separate scope decision.

Before V4, inference invoked the GPU binary dialect hook before extracting `Result` payloads, while
later surface-to-Core lowering independently noticed the carrier and emitted
`Result.map`/`Result.map2`. The implementation now decomposes the supported carrier first, records a
`PrimitiveCarrierPlan`, presents only its payloads to the GPU operation elaborator, and records the
separate `GpuOperationObligation` on the same source occurrence. Merely teaching the GPU hook that
`Result` is a numeric shape would be incorrect.

## Deferred operation obligations

Every unresolved GPU operation occurrence records a compiler-owned obligation alongside the typed
program facts. Conceptually:

```text
GpuOperationObligation {
  occurrence,
  operation identity or builtin family,
  eligible catalog row identities,
  argument type occurrences,
  result type occurrence,
  stage and target capabilities,
  source span
}
```

This object is not a source type, a type-scheme predicate, or a globally extensible constraint. It
is a finite question about one authored operation occurrence against the pinned catalog. The
obligation is cloned with its owning helper body and receives the same HM substitution as that body.

Obligation discharge is a monotone specialization worklist rather than a second HM inference pass.
Selecting one exact row can unify a result that makes another operation selectable:

```workman
let rounded = (x) => {
  floor(x + 1.0)
};
```

Before specialization, `x + 1.0` may have a fresh result variable shared with the argument/result of
`floor`. At the `f32x3` specialization, selecting `f32x3 + f32 -> f32x3` makes that variable
concrete, after which `floor(f32x3) -> f32x3` can be selected.

The worklist must:

1. begin with every pending operation in the cloned specialization;
2. select an obligation only when its determining argument positions are concrete enough to choose
   exactly one row under the V4 argument-driven rule;
3. unify every selected row position with its cloned argument/result type occurrence;
4. enqueue obligations mentioning a type variable changed by that unification;
5. continue until the queue is empty and no substitution changed;
6. materialize selected V3 semantic builtin/operator identities in typed functional IR;
7. classify every remaining obligation as no exact row, genuine ambiguity, or insufficient context.

The process terminates because the operation set and candidate rows are finite and every successful
step only makes the specialization substitution more concrete. It never generalizes a type, adds a
candidate, or reruns source HM inference.

This continues the sidecar-facts direction rather than mutating or destructively annotating the
surface AST. The facts may later participate in the proposed unified program-evidence graph, but
that diagnostic architecture is not required for V4.

## Relationship to delayed TypeScript FFI solving

V4 follows the same broad architectural lesson as Workman's delayed TypeScript FFI system: ordinary
HM should connect the Workman program before a domain-specific elaborator commits to one external or
target operation. Both systems retain occurrence-local unresolved work rather than eagerly forcing a
candidate type into a shared helper.

The corresponding concepts are:

| Delayed TypeScript FFI                                     | V4 shader specialization                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| `freshFfi` result placeholder                              | fresh builtin/operator result occurrence                      |
| `FfiGet`/`FfiCall`/`FfiBindingCall` unresolved syntax node | `GpuOperationObligation` sidecar fact                         |
| HM-inferred receiver and argument types                    | HM/specialization-inferred operation argument types           |
| reflected TypeScript variants                              | checked-in finite Slang/operator rows                         |
| `selectVariant`                                            | exact row selection                                           |
| `solveReflectedFfiValue`                                   | unify selected row with cloned occurrence types               |
| rewrite to generated concrete import/call                  | materialize a semantic builtin/operator identity in shader IR |
| unresolved-FFI leak diagnostic before Core                 | unresolved-obligation diagnostic before shader IR             |

The common discipline is:

```text
create placeholder and evidence
  -> let ordinary HM propagate source-language information
  -> perform domain-specific finite/external selection
  -> solve the placeholder
  -> reject unresolved work before backend lowering
```

The implementation may reuse occurrence IDs, type facts, provenance edges, solve-on-bind helpers,
candidate diagnostics, and unresolved-leak checks. It should not route GPU operations through JS FFI
nodes or make the two candidate systems share semantics.

### Why the FFI needs whole-program reinference rounds

The production orchestration in [`staged_analysis.ts`](../../src/staged_analysis.ts) is
substantially broader than delayed overload choice:

```text
prepare FFI/reflection
  -> initial partial HM
  -> contextualize delayed callbacks
  -> contextual partial HM
  -> resolve delayed FFI
  -> post-resolution partial HM
  -> resolve delayed FFI again
  -> final HM
```

Those rounds are necessary because FFI resolution can change the ordinary Workman program seen by
HM:

- receiver reflection can reveal a new nominal foreign type used by a following member access;
- a reflected callback parameter type supplies new context inside an authored Workman lambda;
- TypeScript generics, promises, array-like obligations, and deep return reflection can expose new
  receiver/result structure;
- safe imports can introduce `Result`/`Task` boundary structure and JS representation rules;
- materialization rewrites unresolved nodes to concrete calls and generates imports or record/type
  declarations;
- cross-module exported HM types must be recomputed after those rewrites;
- final HM verifies that the rewritten ordinary Workman graph is sound.

FFI selection is also deliberately more permissive than V4.
[`selectVariant`](../../src/ffi/shared.ts) scores candidates using reflected types, literals,
`Js.Value`/`Js.Object` compatibility, and materialization obligations.
[`materialize.ts`](../../src/ffi/delayed/materialize.ts) may specialize TypeScript variables,
array-like types, deep calls, callback references, and safe result wrappers. This is an open
boundary to the active TypeScript declarations, not a closed exact intrinsic table.

### Why V4 needs only one HM pass plus a local worklist

The V4 shader domain is closed and monotone:

- builtin rows are already present in a deterministic pinned catalog;
- operator rows are a small compiler-owned table;
- selection is exact and introduces no coercion, structural JS compatibility, effect wrapper, or new
  source declaration;
- GPU helpers are reachable from one lexical shader root rather than discovered across arbitrary
  host FFI use;
- higher-order identities in the bounded subset are already ordinary HM values and must disappear
  during specialization;
- materialization changes only the fresh specialization clone and its sidecar facts;
- selected rows only unify existing occurrence variables with more concrete types;
- Slang validates the finalized module but never feeds a new Workman source type back into HM.

The V4 pipeline is consequently:

```text
ordinary Workman HM once
  -> select a GPU root
  -> preregister seed-keyed specializations
  -> clone and freshen typed bodies/facts
  -> run the local finite obligation/call worklist to a fixed point
  -> require concrete finalized shader types
  -> build functional shader IR and validate through Slang
```

The worklist may visit an obligation more than once and may enqueue newly concrete callees, but this
is not another traversal of or inference over the host module graph. It does not rewrite the surface
AST and rerun Algorithm W. If V4 implementation starts requiring repeated whole-module HM passes,
that is evidence that shader materialization has crossed this scope boundary or that an obligation
is incorrectly feeding target information back into host typing.

### The wmslang pipeline is acyclic

Unlike TypeScript FFI, this feature is not an attempt to add Slang as an open foreign language
inside Workman. Wmslang is its own Workman-owned language domain. Its source types, legal
operations, overload meaning, stage rules, immutable semantics, diagnostics, and functional IR are
decided without asking a live Slang compiler to interpret the Workman program.

The ownership direction is strictly one-way:

```text
Workman HM
  -> wmslang elaboration and specialization
  -> concrete Workman-owned functional/lowered shader IR
  -> Slang emission
  -> terminal Slang/WGSL validation
```

There is no backward edge from Slang validation to HM or wmslang specialization. In particular:

- normal source acceptance and exact operation selection finish before Slang is invoked;
- every emitted builtin has an already-selected pinned catalog identity and concrete occurrence
  types;
- Slang diagnostics never choose an overload, solve a Workman type variable, add a specialization,
  or cause another HM pass;
- backend success cannot retroactively make an invalid wmslang program valid;
- backend failure after successful wmslang typing is catalog/compiler drift, target legalization
  failure, or another backend-attributed error—not a request to try a different source meaning;
- hover, completion, diagnostics, and pure specialization analysis do not instantiate Slang or write
  temporary shader files;
- Slang reflection is an offline catalog-generation input whose pinned output is checked into the
  compiler, not an interactive inference phase.

The specialization worklist does not violate this rule. It operates entirely over Workman-owned HM
occurrences, finite checked-in rows, and cloned wmslang facts before backend emission. It is one
monotone internal computation inside wmslang elaboration, not a cycle between languages.

If a later shader feature cannot be typed without querying Slang and feeding its answer back into
Workman, the wmslang type/catalog model must first be extended explicitly. Adding a backend-directed
reinference loop is not an implementation shortcut permitted by V4.

## Generalization and body ownership

Ordinary HM generalization still occurs. A generalized GPU-local binding owns:

- its typed source body;
- the HM variables quantified by its ordinary Workman scheme;
- its GPU operation occurrences and pending finite obligations;
- its lexical GPU owner and source evidence.

Pending obligations are not printed as predicates on the scheme, but they remain compiler-owned
validity conditions on that GPU-local specialization template.

Every specialization must own fresh type-variable storage for its entire cloned body, not merely the
variables visible in the external HM scheme. A helper body can contain variables used only by
intermediate expressions, projections, joins, or pending operation obligations. Sharing any of those
mutable inference cells between specializations would allow the first specialization to constrain
the second.

At a concrete call, Workman must therefore:

1. allocate one freshening map for every type variable owned by the typed helper body, including
   scheme variables, body-local variables, and variables referenced only by facts/obligations;
2. clone the typed body, occurrence table, provenance, and pending obligations through that complete
   map;
3. translate and apply the concrete call-instantiation substitution to the fresh clone consistently;
4. run operation-obligation discharge only against the clone;
5. leave the generalized source body and every sibling specialization unchanged.

For example, the scalar and vector instances below must not share the internal result variable of
`+`, regardless of discovery order:

```workman
let twice = (x) => {
  x + x
};

let scalar = twice(1.0);
let vector = twice((1.0, 2.0, 3.0));
```

Consequently one source helper can have multiple shader representations without acquiring a second
CPU meaning. V4 still follows the V2 lexical-domain rule: only helpers lexically owned by the
selected `@gpu` island participate. A top-level host function is not reinterpreted as GPU code.

## Reachable monomorphization

Specialization begins only from a selected `Gpu.fragment` root. Unused local helpers do not need a
GPU type and produce no shader code.

Preregistration uses a specialization **seed key**, not the helper's unfinished complete function
type:

```text
SpecializationSeedKey {
  GPU lexical binding identity,
  canonical concrete call-argument types,
  compile-time function identities,
  supported static specialization captures,
  other already-concrete scheme inputs required by body/layout
}
```

The seed never contains the identity of an unresolved call-result metavariable. Two calls with the
same concrete arguments must therefore deduplicate even if ordinary HM gave their result occurrences
different fresh variable IDs. Parameter or other static determining inputs that are still unresolved
cannot seed a specialization yet; their call edges remain pending until they become concrete or are
reported as insufficient context.

The final specialization record is larger:

```text
GpuSpecialization {
  id,
  seedKey,
  state: pending | visiting | finalized | failed,
  concrete parameter types,
  canonical result type slot,
  selected operation rows,
  specialized typed body
}
```

The result slot belongs to the specialization and may initially be unresolved. Every ordinary or
recursive call that finds the same seed links its call-result occurrence to that one canonical slot.
Body HM equalities and the operation worklist then make the slot concrete. The complete specialized
function signature is an output of finalization, not a prerequisite for preregistration.

An already-concrete scheme instantiation that is independent of the parameters but genuinely affects
the body or result layout is an `other ... scheme input` in the seed. This covers ordinary
result-polymorphic/phantom layout cases without using raw metavariable identity. V4 still forbids
choosing an intrinsic row from an unresolved expected result: two otherwise identical calls cannot
request different operation meanings through return-type-directed overloading.

The pass must:

1. seed the fragment coordinate, pure RGBA result, and V2 uniform environment with their established
   contextual types;
2. instantiate each reachable local helper and wait until its seed inputs are concrete;
3. canonicalize the seed without unresolved result-variable identities and look it up;
4. on a miss, allocate a pending specialization ID and canonical result slot before visiting the
   body so ordinary direct recursion terminates;
5. link the initiating call-result occurrence to that canonical result slot;
6. clone the complete typed body and all sidecar facts while freshening every body-owned type
   variable;
7. translate and apply the concrete seed/call-instantiation substitution only to that clone;
8. discharge exact operation rows to a fixed point with the specialization-local worklist;
9. finalize delayed call arguments made concrete by the worklist, recursively enqueue direct and
   statically known higher-order callees, and link deduplicated call results to their canonical
   slots;
10. finalize the concrete result type and complete function signature;
11. assign deterministic specialization IDs and names from canonical seeds rather than discovery
    order or result metavariable IDs;
12. retain source binding, instantiation, call-site, and operation-selection evidence for
    diagnostics and hover;
13. reject any reachable specialization whose result slot, representation, delayed call seed, or
    operation obligation remains unresolved before functional shader IR emission.

Recursion remains ordinary HM recursion. A recursive binding is monomorphic within its own
definition. Every recursive call inside one specialization must reproduce the active seed's concrete
argument types, static function identities, and static captures. Such calls target its preregistered
ID. The recursive call's result occurrence links to the pending specialization's canonical result
slot; it does not require that slot to have been finalized already.

The same generalized recursive helper may be instantiated independently by two nonrecursive outer
call sites after its definition has been inferred; each resulting specialization recursively calls
only itself. A recursive body that calls itself at a different instantiation is polymorphic
recursion and is rejected in V4 rather than creating another specialization. V4 does not require
annotations or higher-rank checking for polymorphic recursion.

## Bounded higher-order specialization

V4 accepts authored higher-order GPU helpers only when specialization can eliminate the function
value statically. This supports useful functional combinators without committing to runtime closure
representation.

Representative accepted source:

```workman
let apply = (f, x) => {
  f(x)
};

let double = (x) => {
  x * 2.0
};

let value = apply(double, coord.x);
```

The concrete identity of `double` is part of the `apply` specialization. Lowering may inline the
call or emit a direct specialized helper, but no function-typed value reaches Slang.

The required V4 higher-order subset is:

- a GPU-local authored helper or noncapturing local lambda may be supplied to another GPU-local
  helper;
- the callee identity must be statically known at every reachable call;
- a function parameter may be invoked directly but may not be stored in a record/ADT, selected by
  runtime `if`/`match`, compared, or sent to host code;
- a higher-order helper may not return a function;
- a builtin name remains unavailable as a first-class value, although `(x) => { sin(x) }` is an
  ordinary authored wrapper;
- all function values must disappear through specialization, direct-call rewriting, or bounded
  inlining before typed functional shader IR is finalized.

General closure capture/conversion, returning closures, function-bearing ADTs, runtime closure
choice, recursive higher-order values, and general defunctionalization remain later work. If a
function value survives the bounded elimination pass, compilation fails with a source-local
unsupported-higher-order diagnostic.

## Explicit operation abstraction is deferred

Workman's carrier/lift style may eventually provide explicit user-authored abstraction over numeric
behavior using ordinary HM values. That design commonly requires function-valued records, returning
specialized functions, or both. Those constructs contradict V4's bounded higher-order rule because
the function values do not necessarily disappear at one statically known call boundary.

V4 therefore contains no `ShapeOps`/numeric-carrier API or acceptance example. It neither requires
nor forbids a later explicit abstraction design. Ordinary shader helpers use compiler-owned finite
operations and reachable specialization in this slice. Implicit carrier insertion, typeclass
instance search, higher-kinded types, and a compiler-authored `GpuShape` hierarchy remain out of
scope.

## Language service

Hover must reflect the source and specialization levels without presenting one expression as having
simultaneous CPU and GPU meanings:

- a helper declaration may show its ordinary generalized Workman shape and list its reachable GPU
  specializations;
- a parameter/body occurrence within a concrete GPU specialization shows the concrete wmslang type
  selected for that specialization;
- a builtin occurrence shows the exact selected Slang signature when one specialization is in focus;
- where multiple specializations apply to the same source occurrence, hover may list those concrete
  instances rather than inventing a constrained type;
- pending, invalid, and ambiguous occurrences remain visibly unresolved and publish their actual
  diagnostic instead of falling back to a CPU interpretation.

Diagnostics must retain both the generic helper definition path and the concrete call path that
created the failing specialization. For example, an invalid `floor(record)` should point to the
builtin occurrence and identify the call that instantiated the helper with that record. Existing
backend evidence remains attached if a supposedly valid selected row later fails Slang validation.

Completion remains the V3 contextual catalog completion. V4 does not require general typeclass-like
completion, implicit-argument UI, or signature help for hypothetical constrained schemes.

## Creative acceptance rewrites

The V3 warped-noise and raymarching probes become V4 inference fixtures:

- remove scalar/vector annotations that exist solely to select builtin or operator overloads;
- retain annotations that communicate an intentional public boundary only when erasing them leaves
  the same inferred specializations and operation rows;
- compile both probes through the same real Slang and WebGPU path;
- snapshot each reachable specialization and its selected operation identities;
- verify hover on formerly annotated parameters and builtin calls.

At least one focused fixture must specialize the same authored helper at two vector widths. At least
one must pass a statically known authored function through a higher-order helper and prove that no
function value survives into shader IR or emitted Slang.

## Non-goals

- GLML-style `HasClass`, broadcast typeclasses, coercion constraints, or predicates printed in
  Workman types;
- user declarations that add, replace, prioritize, or globally overload compiler-owned operator
  rows;
- automatic numeric coercion, integer-to-float promotion, vector width conversion, or defaulting;
- annotations that assert/cast GPU types, select overload rows, seed specialization, or rescue an
  insufficient-context error;
- implicit dictionaries, implicit carrier insertion, or compiler-selected user instances;
- runtime shader closures or a general closure ABI;
- returning functions, closures in records/ADTs, dynamic function selection, or full
  defunctionalization;
- explicit numeric-operation carrier libraries requiring function-valued records or returned
  functions;
- polymorphic recursion or recursively creating a different specialization of the active binding;
- return-type-directed intrinsic/operator overload selection or specialization identity based on an
  unresolved result metavariable's allocation ID;
- live Slang-driven overload selection, type inference, specialization, or any Slang-to-HM feedback
  loop;
- first-class Slang builtin values or partial application of a builtin;
- module-level, imported, or host/GPU-dual helper reinterpretation;
- arbitrary compile-time execution or specialization on runtime uniform values;
- matrices, textures, samplers, storage buffers, new scalar representations, or resource methods;
- optimization beyond bounded higher-order elimination and the cloning/deduplication required for
  semantic specialization;
- changing the V2 host-uniform boundary, fragment artifact ABI, or real WebGPU presentation path.

## Acceptance

V4 is complete when focused tests prove all of the following:

1. A reachable unannotated local helper receives its scalar/vector type from fragment-root, uniform,
   call-argument, projection, and result context using ordinary HM occurrence equalities.
2. Pending builtin and existing GPU-operator applications survive HM generalization as occurrence-
   local finite catalog obligations rather than user-visible typeclass predicates.
3. For every annotation-bearing acceptance fixture, erasing ordinary annotations preserves
   acceptance, specialization seed keys, selected operation rows, concrete shader types, and emitted
   meaning. An intentionally wrong annotation may add an error but never a new accepted meaning.
4. The formerly V3-specific `(p: (Number, Number))` overload-selection path no longer contributes
   GPU facts. A deliberately unanchored reachable fixture fails with and without that annotation and
   does not suggest adding one.
5. Catalog-derived fixed positions and position equalities enter ordinary HM inference before
   specialization; `floor`, `length`, `dot`, `cross`, `refract`, and `smoothstep` exercise the
   representative skeleton shapes.
6. A hypothetical or catalog fixture whose argument/result shapes vary through a non-equality
   mapping is selected from concrete arguments but is not inferred backward from its expected
   result; insufficient argument context produces a focused diagnostic.
7. One helper used at both two- and three-component vector types produces two deterministic,
   concrete specializations with independently selected exact Slang operation rows.
8. Every specialization freshens all scheme-visible, body-local, intermediate-only, and obligation-
   only type variables before applying its concrete call substitution. Running scalar then vector
   specialization and vector then scalar specialization produces identical independent results.
9. The chained `floor(x + 1.0)` fixture proves that selecting one operation can concretize and
   enqueue another; the finite worklist reaches a fixed point without rerunning HM inference.
10. Two `twice(Vec3)` calls with distinct fresh call-result metavariables produce one seed-keyed
    specialization, both link to its canonical result slot, and finalization gives both `Vec3`.
    Unused polymorphic helpers still emit nothing, and IDs/names do not depend on discovery order.
11. The recursive `process(Vec3, Number)` fixture preregisters from its concrete arguments before
    resolving `x + x`, then reuses that pending specialization after the worklist makes the
    recursive argument concrete. A self-call at a different instantiation is rejected as unsupported
    polymorphic recursion rather than creating another specialization.
12. Scalar/vector broadcast works only for the explicit V2 operation rows; mismatched vector widths,
    unsupported representations, and conversion-requiring calls still fail before Slang generation.
13. An unannotated `twice = (x) => { x + x }`-style helper specializes independently for scalar and
    vector uses, selecting the exact finite `+` row at each cloned occurrence.
14. Primitive `Result` coercion exposes payloads before operator-row selection, preserves/unifies
    the error type, and retains separate carrier-plan and concrete-operation evidence. Existing host
    `Result<Number, E>` behavior remains green; no arbitrary carrier gains implicit lifting.
15. Zero, multiple, and insufficiently concrete operation matches produce distinct source-local
    diagnostics and never silently default.
16. A statically known authored function can pass through a bounded higher-order helper and lower to
    direct first-order shader code.
17. Returning, storing, dynamically selecting, or otherwise preserving a function value reports the
    bounded-higher-order restriction before backend emission.
18. Builtin names remain direct-call-only; an authored lambda wrapper may be passed only when the
    wrapper itself satisfies the bounded rules.
19. Hover shows concrete specialization types and selected builtin signatures without inventing a
    constrained Workman type or silently falling back to host inference.
20. A failing specialized operation retains the path from concrete call site through generic helper
    to the authored operation occurrence, plus backend evidence if applicable.
21. The warped-noise and raymarching probes compile and render after removing annotations used only
    as overload-selection evidence.
22. Existing focused V1, V2, V3, catalog, shader-lowering, LSP, WebGPU-render, and SDL-window gates
    remain green. The repository-wide long-running `deno task test` suite is not required for the
    focused V4 iteration gate.
23. Focused instrumentation proves that HM, hover, diagnostics, specialization, and operation
    worklist convergence invoke no live Slang service. Slang runs only after concrete shader IR is
    complete, and a forced catalog/backend disagreement cannot trigger reinference or alternative
    overload selection.

Any need for runtime closure representation, imported GPU libraries, new resource types, coercion,
or broader optimization discovered during these fixtures must be recorded as later scope rather than
entering V4 implicitly.
