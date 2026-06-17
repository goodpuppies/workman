# SML Elaboration Audit For Diagnostics

This audit asks whether `wm-mini` already has the SML-style static-semantics building blocks needed
for auditable diagnostics, or whether refactors are needed before adding rule/evidence diagnostics.

The companion notes are:

- `markdown/diagnostics/auditable-error-diagnostics.md` for the design thesis
- `markdown/diagnostics/diagnostic-object-model.md` for the concrete object model

This audit is about whether the current compiler has the semantic building blocks needed by that
diagnostic object model.

Verdict:

```txt
The core SML-like building blocks are mostly present.

Before implementing auditable diagnostics, refactor the diagnostic/evidence plumbing, not the
language semantics.
```

The compiler already has:

- declaration-ordered elaboration
- separate value/type/ADT environments
- exported structures for module boundaries
- HM-style mutable unification variables
- let generalization with a value restriction
- constructor identifier status
- simultaneous non-recursive binding groups
- recursive binding placeholders and post-solve generalization
- pattern elaboration with constructor-sensitive binding
- match exhaustiveness and redundancy warnings

The main blockers are architectural:

- inference is still exception-driven
- recovery stops at the first failed declaration
- diagnostics are message-shaped, not rule/evidence-shaped
- unification mutates type nodes, so evidence must be captured at constraint time
- environment mutation is not transactionally rolled back inside a failing declaration

These are refactors around elaboration reporting, not signs that the SML subset is unusable.

## Verified Tests

Targeted SML-building-block tests passed:

```txt
deno test --allow-read --allow-env \
  tests\type_elaboration_test.ts \
  tests\datatype_test.ts \
  tests\pattern_test.ts \
  tests\module_test.ts
```

Result:

```txt
52 passed, 0 failed
```

Earlier runs without `--allow-env` and `--allow-read` failed on Deno permissions for TypeScript and
grammar file reads, not on compiler behavior.

## Audit Areas

### Module And Basis Boundaries

Relevant implementation:

- `src/infer.ts`
- `src/module_graph.ts`
- `src/compiler.ts`
- `src/infer/imports.ts`
- `src/infer/module_exports.ts`

`inferModuleCore` creates the static basis pieces:

```ts
const typeEnv = baseTypeEnv();
const env = baseEnv(typeEnv);
const exports: Env = new Map();
const typeExports: TypeEnv = new Map();
const adts = baseAdts(typeEnv);
```

This is a good approximation of the SML static basis for `wm-mini`:

- `env` is the value environment
- `typeEnv` is the type environment
- `adts` carries datatype constructor metadata for pattern/exhaustiveness analysis
- `exports`, `typeExports`, and `exportedStructure` model module export boundaries

`loadModuleGraph` resolves imports and analyzes dependencies before dependents. This gives `wm-mini`
the SML-like property that a module elaborates against an already-known static basis from its
imports.

Refactor needed before diagnostics:

```txt
No semantic refactor required.
```

Needed later:

- expose import/addImport as rule frames such as `ElaborateImport.NamedValue`
- preserve import diagnostics as structured module facts
- keep dependency-invalid diagnostics separate from the imported file's own diagnostics

### Failed Elaboration And Basis Effects

Relevant implementation:

- `src/infer.ts`

`inferModuleCore` has a `recover` mode used by `inferModulePartial`. On declaration failure, it
pushes the diagnostic and breaks:

```ts
if (!recover) throw diagnostic;
diagnostics.push(diagnostic.diagnostic);
break;
```

This broadly matches the SML program rule that a failing top-level elaboration has no basis effect:
later declarations are not elaborated against a failed update.

However, there is a subtle implementation risk. Individual declaration elaboration mutates `env`,
`typeEnv`, `exports`, `typeExports`, `adts`, `types`, `facts`, and type-variable `instance` fields
as it goes. If an error is thrown midway through a declaration after some mutation has occurred,
`recover` mode stops, but it does not transactionally roll back every partial mutation.

For normal compile mode this is fine because the error aborts. For future diagnostic/evidence mode,
it matters because we may want to inspect the environment after failure.

Refactor needed before diagnostics:

```txt
Yes, but scoped.
```

Add an explicit declaration transaction boundary before richer recovery:

- snapshot or stage `env`, `typeEnv`, `exports`, `typeExports`, and `adts` per declaration
- commit only after successful declaration elaboration
- keep failed-declaration evidence separately
- do not rely on partially mutated env as the post-failure basis

This does not require changing the language semantics. It makes the SML "failed elaboration has no
effect" rule explicit in implementation.

### HM Types, Schemes, And Unification

Relevant implementation:

- `src/types.ts`
- `src/type_diff.ts`
- `src/infer/provenance.ts`

`Ty` has mutable variables:

```txt
var type node:
  tag: "var"
  id: number
  name: string or absent
  instance: Ty or absent
```

`unify` prunes variables, writes `instance`, performs occurs checks, descends through functions,
tuples, and nominal named types, and reports `TypeMismatchError` with a structural diff path.

This is an appropriate HM-style implementation for the current compiler. The existing `UnifyBind`
callback is also the right hook for provenance:

```ts
variable, target, path, targetSide
```

The important diagnostic consequence is that type objects are not stable historical facts. After
unification proceeds, later `show(type)` or `prune(type)` may reveal a different state than existed
when the constraint was introduced.

Refactor needed before diagnostics:

```txt
No unifier rewrite required.
Yes evidence capture must happen at unification/constrainAt time.
```

Do:

- allocate constraint IDs at `constrainAt`
- record left/right role, source, rule, and type snapshot before solving
- record `UnifyBind` commitments immediately
- record collision evidence when `TypeMismatchError` is created

Do not:

- derive historical evidence later by inspecting mutable `Ty` objects
- replace HM unification just to improve diagnostics

### Generalization And Value Restriction

Relevant implementation:

- `src/types.ts`
- `src/infer/decl_binding.ts`
- `src/infer/decl.ts`

`generalize` computes free type variables not free in the environment. `generalizeBinding` applies
a value restriction:

- non-expansive expressions generalize
- expansive expressions remain monomorphic
- unresolved FFI and JS-boundary cases stay monomorphic

Tests cover:

- declaration-ordered generalized lets
- SML-style `val` generalization boundaries
- simultaneous non-recursive groups
- recursive group generalization after solving
- ordinary call results staying monomorphic
- constructor applications still generalizing when non-expansive

Refactor needed before diagnostics:

```txt
No semantic refactor required.
```

Needed later:

- record `GeneralizeLet` and `InstantiateScheme` rule frames
- capture why a binding did or did not generalize
- expose value-restriction diagnostics or notes when useful

This is a strong existing building block for auditable diagnostics because generalization is already
localized at binding boundaries.

### Simultaneous And Recursive Bindings

Relevant implementation:

- `src/infer/decl.ts`
- `src/infer/decl_binding.ts`
- `src/infer/decl_helpers.ts`

Non-recursive `let ... and ...` is simultaneous:

- each binding is inferred against `base = new Map(env)`
- bindings are only published after all group members are inferred

Recursive bindings:

- require simple variable patterns
- reject unguarded recursive references
- install monomorphic placeholders
- infer each body against the recursive environment
- constrain placeholders to inferred values
- generalize after solving against the original base env

This is exactly the kind of building block the diagnostic plan needs. A recursive mismatch can be
explained as:

```txt
Rule:
  ElaborateRecursiveBinding

Generated:
  placeholder for f

Constraint:
  placeholder(f) == inferred body type
```

Refactor needed before diagnostics:

```txt
No semantic refactor required.
```

Needed later:

- make placeholders first-class facts
- make guardedness checks structured diagnostics
- attach rule context to `constrainBinding`

### Pattern Elaboration

Relevant implementation:

- `src/infer/patterns.ts`
- `src/infer/decl_binding.ts`

Patterns are constructor-sensitive:

- `PVar` binds
- `PPinned` looks up an existing value
- `PCtor` requires a scheme with `status: "constructor"`
- tuple, record, literal, and constructor patterns constrain the expected type

For the Workman surface, bare match identifiers are pinned unless explicitly wrapped in `Var(...)`;
for `wmsml`, parser/lowering handles SML-style constructor-sensitive identifiers. Tests cover both
constructor status and duplicate binders.

Let patterns are elaborated against the initializer type and can warn if refutable.

Refactor needed before diagnostics:

```txt
No semantic refactor required.
Yes diagnostic contexts should be added.
```

Needed later:

- route pattern constraints through `constrainAt` instead of raw `constrain`
- add rule IDs such as `ElaboratePattern.Constructor`, `ElaboratePattern.Tuple`,
  `ElaboratePattern.RecordField`
- record pattern-binder facts with parent links to the scrutinee/initializer fact

The current pattern implementation is useful, but much of its failure evidence is thrown as plain
messages.

### Match Exhaustiveness And Redundancy

Relevant implementation:

- `src/infer/exhaustiveness.ts`
- `src/infer/decl_helpers.ts`
- `src/infer/expr_flow.ts`

`inferMatch`:

- infers the scrutinee
- elaborates each pattern against the scrutinee type
- constrains all arm bodies to one result type
- emits redundant-arm warnings
- emits non-exhaustive warnings

This aligns well with SML's "further restrictions": warnings should be reported while still
compiling the match.

Refactor needed before diagnostics:

```txt
No semantic refactor required.
Yes warning evidence should become structured.
```

Needed later:

- replace warning strings with structured diagnostic details
- expose missing case evidence as data, not only formatted text
- represent redundancy as failed `CheckMatch.Irredundant` with covered-space evidence
- route match arm result constraints with explicit rule context

### Records And Ambiguity

Relevant implementation:

- `src/infer/records.ts`
- `src/infer/patterns.ts`

Records are nominal in `wm-mini`, not SML row-polymorphic records. Record literals and patterns infer
a target nominal record by exact or containing field sets, rejecting ambiguity.

This differs from full SML, but it is an intentional subset/design choice. The SML building block
needed for diagnostics is still present: record constraints have a clear rule and clear ambiguity
failure points.

Refactor needed before diagnostics:

```txt
No semantic refactor required.
```

Needed later:

- add rule contexts for `InferRecordLiteral`, `InferRecordField`, and `ElaborateRecordPattern`
- preserve candidate record sets for ambiguity diagnostics

### Type Declarations, Constructors, And Nominality

Relevant implementation:

- `src/infer/decl.ts`
- `src/types.ts`
- `src/types_basis.ts`

Datatype declarations allocate fresh `TypeInfo` IDs and constructor schemes. Constructors carry
`status: "constructor"`, and imported same-spelled nominal types remain distinct by ID.

Tests cover:

- constructor arity
- polymorphic constructor generalization
- unbound type variables in declarations
- type alias substitution
- nominal distinction across imports
- constructor availability through namespace imports

Refactor needed before diagnostics:

```txt
No semantic refactor required.
```

Needed later:

- rule frames for datatype elaboration and constructor scheme generation
- structured errors for duplicate constructors, arity mismatch, unknown type, cyclic alias

### Diagnostics Model

Relevant implementation:

- `src/diagnostics.ts`
- `src/infer/provenance.ts`

Current diagnostics are:

```ts
severity
code
message
node/span
related[]
```

This is adequate for current CLI/LSP output, but not enough for auditable diagnostics.

Refactor needed before diagnostics:

```txt
Yes.
```

Replace message-shaped diagnostics with a structured diagnostic object:

```ts
type Diagnostic = {
  id: DiagnosticId;
  severity: "error" | "warning";
  code: string;
  primary: SourceAnchor;
  failure: Failure;
  support: SupportGraph;
  repairs: Repair[];
  dependsOn: DiagnosticId[];
};
```

Rewrite rule:

- render all user-facing text from the structured diagnostic object
- stop deriving codes from message strings
- make support evidence and repairs explicit data, not hidden formatter logic
- do not preserve old message compatibility as a goal of the rewrite
- do not build an adapter that forces structured diagnostics to imitate old diagnostics
- prefer a full diagnostic pipeline rewrite over a long mixed-model migration

### Inference Context Shape

Relevant implementation:

- `src/infer/expr.ts`
- `src/infer/decl.ts`
- `src/infer/expr_flow.ts`
- `src/infer/expr_call.ts`

Many inference functions thread long parameter lists:

```txt
env, typeEnv, adts, types, facts, warnings, diagnostics, provenance
```

For today's compiler this is manageable. For auditable diagnostics, adding rule frames, constraint
IDs, fact IDs, diagnostic modes, and current branch path will make this style brittle.

Refactor needed before diagnostics:

```txt
Recommended before broad implementation.
Not required before the first end-to-end rewrite slice.
```

Suggested path:

1. Add diagnostic/evidence id allocation and immutable type snapshots.
2. Add premise metadata by extending `constrainAt` options.
3. Once that works, introduce an `InferContext` object.
4. Move maps and diagnostic/evidence allocation into the context.
5. Keep env/typeEnv explicit only where local scope copies are semantically important.

### Parser Recovery And ErrorTy

Relevant implementation:

- `src/parser.ts`
- `src/ast.ts`
- `src/infer.ts`

The AST has no `MissingExpr`, `ErrorExpr`, or `ErrorTy`. Parse errors still stop before inference.
This is consistent with the earlier decision not to implement full Hazel now.

For auditable type errors, this is not a blocker. For LSP-quality multi-error recovery, it becomes a
separate project.

Refactor needed before diagnostics:

```txt
No for first auditable type mismatch work.
Yes for future total/recovering frontend work.
```

## Required Refactors For The Error System Rewrite

### 1. Add Diagnostic Evidence Ids And Immutable Type Snapshots

This is the first necessary refactor. Every rule frame, premise, claim, constraint, substitution,
search, recovery step, and repair needs a stable id when it is created.

Because type nodes mutate, evidence must be captured when a constraint is introduced and when a
binding/collision occurs. Historical diagnostic evidence should use immutable type snapshots, not
stable references to mutable `Ty` nodes.

Minimum:

- rule frame id
- premise id
- constraint id
- source anchor
- left/right roles
- immutable left/right type snapshots
- `UnifyBind` commitment record with immutable committed type snapshot
- collision record with immutable operand snapshots

### 2. Add Premise Context To Constraint Sites

Extend `constrainAt` options with:

```ts
type PremiseContext = {
  frame: RuleFrame;
  premise: Premise;
  roles: ConstraintRole[];
  origin: SourceAnchor;
};
```

Start with:

- `InferCall.Argument`
- `InferPipe.StepInput`
- `InferIf.ConditionBool`
- `InferIf.BranchesSameType`
- `InferMatch.ArmsSameType`
- `InferAnnotation.ExpressionMatchesAnnotation`

This makes rule identity, requirement identity, operand roles, and origin part of the same data path.
Do not split this across separate `RuleContext`, string origin, and role parameters.

### 3. Make Declaration Failure Transactional Before Rich Recovery

This is required before richer recovery, multi-error continuation, recovery entries, or meaningful
`dependsOn` cascades. It is not required before the first end-to-end structured diagnostic slice if
that slice still stops at the first failed declaration. Before richer recovery, make
declaration-level mutation explicit:

```txt
begin declaration
  stage env/typeEnv/export/adts mutations
  collect local facts/evidence
on success
  commit staged mutations
on failure
  discard staged static-basis mutations
  retain diagnostic evidence
```

This protects the SML rule that failed elaboration has no static effect.

## Refactors Not Needed First

These are not prerequisites for the first end-to-end rewrite slice:

- full Hazel marked AST
- gradual unknown types
- whole-program constraint graph solver
- replacement of mutable HM unification
- parser recovery
- broad `InferContext` migration
- complete diagnostic code taxonomy

They may become useful later, but doing them first would slow down the rewrite without improving the
core evidence model.

## Recommended First Slice

Implement auditable diagnostics for one symmetric and one directional rule:

1. `InferIf.BranchesSameType`
2. `InferPipe.StepInput`

Why these:

- `if` branch joins test neutral, non-expected/got rendering
- pipe input tests directional, role-based rendering
- both are central language features
- both already use or can easily use the `constrainAt` choke point

Success criteria:

```txt
The diagnostic object can answer:
  which rule failed
  which requirement failed
  which operands or evidence roles participated
  where each data point came from
  which violation happened
```

The user-facing output should be rendered from the new diagnostic object for these rewritten rules.
Old diagnostics may remain only for checks not yet rewritten; do not maintain a compatibility layer
inside the new model.

## Final Assessment

`wm-mini` implements enough SML-like static-semantics structure to support auditable diagnostics.
The compiler does not need a language-semantics rewrite first; it does need an error-system rewrite.

The necessary preparation is:

- allocate diagnostic evidence ids and immutable type snapshots first
- add premise context to constraints
- record evidence at the moment constraints and unification commitments happen
- make declaration failure boundaries explicit before richer recovery

That gives Workman the SML building blocks: elaboration rules, static basis updates, HM
constraints, constructor status, warnings-as-restrictions, and module-basis boundaries.
