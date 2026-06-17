# Auditable Error Diagnostics

This note records a longer-term story for how errors in `wm-mini` should work. The core idea is:

> An error is a failed compiler rule with enough preserved semantic evidence to let the programmer
> reconstruct the relevant compiler state.

This is deliberately different from Elm-style prose diagnostics. Elm is good at tutor-like,
friendly explanations, but Workman should optimize for auditable explanations:

- the exact compiler or language rule being applied
- the requirement of that rule that failed
- the facts that participated in the failure
- the source origins of those facts
- the path through compiler rules that connected the source facts to the collision
- the legal repairs that would make the failed requirement true

The error should not hide the machine state behind prose. It should expose the relevant slice of the
machine state in a stable, readable form.

## Current Compiler Shape

`wm-mini` already has several pieces that point in this direction.

### Diagnostics

`src/diagnostics.ts` currently defines `FrontendDiagnostic`:

```txt
export type FrontendDiagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  node: AstNode or absent;
  span: SourceSpan or absent;
  related: FrontendRelatedDiagnostic[] or empty;
};
```

This is still mostly message-oriented. A diagnostic has a stable-ish code, a primary span, and
related spans, but it does not know which static rule failed or which semantic facts were involved.

The formatter is also minimal: it prints the message plus one source excerpt. Related diagnostics
mostly benefit LSP today.

### Type Mismatch Diffing

`src/type_diff.ts` can find the first structural mismatch inside two types. This already gives one
important piece of evidence:

```txt
at parameter 1 -> Task error:
  expected: Js.Error
  got:      String
```

The weakness is that this path is structural, not causal. It explains where two type trees differ,
but not which rule required equality or which source facts forced each side.

### Type Facts

`src/infer/type_facts.ts` records facts for expressions, patterns, bindings, and FFI obligations.
This is useful for hover, type-debug, and future diagnostics because it gives the compiler a shared
fact layer rather than forcing tools to rediscover facts from local maps.

The current facts are mostly observational:

- this expression has this instantiated type
- this variable use came from this general scheme
- this FFI placeholder is unresolved or resolved

That is necessary, but not sufficient for auditable failures. The rewrite needs causal facts:

- this fact was derived by this rule
- this fact depends on these parent facts
- this constraint was introduced by this rule requirement

### Type Provenance

`src/infer/provenance.ts` is the closest current implementation piece.

`constrainAt` wraps unification at important inference choke points. When a type variable is bound,
`rememberProvenance` can record:

- the type variable id
- the committed type
- the source origin for the constraint that caused the commitment

If a later unification fails against that commitment, `typeCommitmentMismatchMessage` can print both
the previous commitment and the new attempted commitment.

That is already a small version of the desired model:

```txt
failed constraint:
  expected Task error: Js.Error
    from ...

  got Task error: String
    from ...
```

The limitation is that provenance is still shaped around final messages and related diagnostics. It
does not preserve first-class rule ids, requirement ids, fact ids, or a derivation graph.

### Unifier Hook

`src/types.ts` exposes `UnifyBind`:

```ts
export type UnifyBind = (
  variable: Extract<Ty, { tag: "var" }>,
  target: Ty,
  path: DiffPath,
  targetSide: "left" | "right",
) => void;
```

This is an important low-cost hook. The compiler already discovers the useful moment:

- a type variable becomes committed to a concrete or partially concrete type
- the commitment happens at a structural path
- the commitment has a left/right constraint side

The auditable model should use this kind of hook rather than replacing HM inference with a large
solver rewrite.

## Diagnostic Model

The concrete object model now lives in
`markdown/diagnostics/diagnostic-object-model.md`.

The short version is:

```txt
Diagnostic =
  one failed compiler premise
  + evidence needed to reconstruct that premise
  + diagnostic dependency edges
```

This replaces the earlier idea of diagnostics as a bundle of optional compiler-state fields. The
model has one required `failure`, and the state snapshot is a simple support/evidence log made from
typed entries:
claims, constraints, scopes, substitutions, searches, rule frames, and recovery entries.

The important discipline is:

- the top-level diagnostic type should not know compiler subsystems
- each diagnostic should name the exact rule frame and failed premise
- support entries should explain how the observed data points were derived
- renderers should project the support evidence instead of inventing hidden reasoning

## Expected/Got Is Presentation, Not Data

The internal model should not assume every type mismatch has a morally correct expected side and got
side.

Unification is often symmetric:

```wm
if cond then 1 else "hi"
```

The real failure is:

```txt
InferIf.BranchesSameType failed:
  type(thenBranch) == type(elseBranch)

Observed:
  thenBranch = Number
  elseBranch = String
```

For a call, `expected/got` is often useful because the rule gives direction:

```txt
InferCall.Argument failed:
  argumentType == parameterType

Expected:
  parameter 1: User

Got:
  argument: Task<HttpError, User>
```

So the data should store neutral sides:

```ts
type TypeCollision = {
  left: TypeEvidence;
  right: TypeEvidence;
  collision: ConstraintId;
};
```

The renderer can choose one of several views:

- symmetric: `could not unify A and B`
- contextual: `expected A, got B`
- branch-based: `thenBranch A, elseBranch B`
- pipe-based: `previousOutput A, nextParameter B`

## Recursive Occurrence Diagnostic Shape

The current compiler already has a diagnostic that proves the model cannot be only unification
shaped: recursive binding result mismatches. In `src/infer/decl_binding.ts`, `constrainBinding` can
report that recursive occurrences share one monomorphic type, then attach related evidence for the
body result, recursive call sites, operator provenance, and common mistaken forms such as
`match(...) =>` or trailing semicolons returning `Void`.

The concrete object-model example lives in
`markdown/diagnostics/diagnostic-object-model.md` under "SML Example: Recursive Value Binding".

A compact rendering should still look like:

```txt
[type.mismatch] rule failed: CheckRecursiveBinding.Result

subject:
  recursive binding sumList

rule:
  recursive occurrences of sumList share one monomorphic type
  the body result must match that recursive binding result

observed:
  binding placeholder:
    sumList : (Int_list, Number) => Number

  recursive occurrence:
    sumList(rest, val+i) : Number

  body result:
    match body : (Int_list) => Number

failed:
  body result == recursive binding result
  at result:
    expected: Number
    got:      (Int_list) => Number

supporting evidence:
  operator + : Number
```

The important part is the occurrence set. The user needs to know that the compiler is not comparing
two arbitrary expressions. It is checking the invariant for a recursive binding: every occurrence of
the recursive name is tied to the same monomorphic placeholder while the binding body is inferred.

This also shows why SML-shaped diagnostics and implementation-shaped diagnostics must coexist. SML
gives the broad rule: recursive value declarations elaborate against an environment containing the
recursive identifiers. `wm-mini` has an implementation-specific constraint shape for how recursive
lambda results are checked and localized. The object model should preserve both:

- SML-level rule: elaborate recursive binding against a recursive static environment
- wm-mini-level check: body result must match the monomorphic recursive occurrence type
- evidence: binding node, body result node, recursive occurrence nodes, and any operator/callee facts

## Compiler Path

The trace should be a semantic rule path, not a TypeScript stack trace.

```txt
compiler path:
  InferExpr
  -> InferPipe
  -> InferPipe.Step[2]
  -> ApplyPipedValueAsFirstArg
  -> Unify.EqualTypes
```

This tells the programmer what logic branch the compiler was in. It should be derived from
`RuleFrame.path` or parent rule-frame links, not from thrown JavaScript stack frames.

## Rendering Modes

The same structured data should support multiple renderings.

### Summary

Small enough for editor squiggles and compact CLI output:

```txt
[type.mismatch] InferIf.BranchesSameType failed

thenBranch : Number
elseBranch : String

failed:
  Number == String
```

### Explanation

Enough to reconstruct the relevant state:

```txt
[type.mismatch] rule failed: InferIf.BranchesSameType

rule:
  infer(if cond then a else b) requires:
    cond : Bool
    type(a) == type(b)

failed requirement:
  type(thenBranch) == type(elseBranch)

observed:
  thenBranch : Number
    from integer literal at main.wm:4:15

  elseBranch : String
    from string literal at main.wm:4:22

collision:
  unify(Number, String)
    at if-expression result join, main.wm:4:3

compiler path:
  InferExpr -> InferIf -> JoinBranches -> Unify.EqualTypes
```

### Trace

For compiler debugging:

```txt
constraint C17:
  rule: InferIf.BranchesSameType
  left:  F12 thenBranch : t4
  right: F13 elseBranch : t5

commitments:
  t4 := Number
    from F8 integer literal

  t5 := String
    from F9 string literal

collision:
  unify(Number, String)
```

The trace mode can be noisier because it is explicitly a debugging tool.

## Cost Model

This does not require keeping a huge compiler log.

Bad version:

```txt
step 1 entered inferExpr
step 2 visited child node
step 3 created local variable
step 4 called unify
...
```

Good version:

```txt
Fact F12:
  thenBranch : Number
  derived by InferLiteral.Int
  origin main.wm:4:15

Constraint C7:
  F12 == F13
  introduced by InferIf.BranchesSameType
  origin main.wm:4:3
```

This is "provenance by default, detail by demand":

- Always store compact ids, origins, rule ids, and parent links.
- Store larger environment snapshots only in debug or LSP modes.
- Render only a graph slice around the failed constraint.

The compiler already computes much of the information. The architectural change is to stop throwing
away the relevant semantic evidence.

## Fit With Existing Notes

This note supersedes lower-level implementation notes.

`markdown/type-mismatch-origin-diagnostics.md` is useful background for mismatch origins,
type-variable commitments, and source-aware constraint origins.

`markdown/frontend-diagnostics-design.md` describes the broader structured frontend target:
diagnostic objects, recovery nodes, and `ErrorTy`. That remains important because auditable
diagnostics work best when the frontend returns a result object instead of stopping at the first
thrown exception.

Use the lower-level notes this way:

1. Use `constrainAt` and `UnifyBind` as evidence capture points.
2. Replace message-shaped exceptions with structured diagnostic objects.
3. Add rule ids and requirement ids at central inference choke points.
4. Replace current type facts/provenance diagnostics with a compact evidence graph.
5. Add render modes over the same diagnostic data.

## Theory: SML And Hazel

The design should be understood as a tool-facing extension of SML-style elaboration, influenced by
Hazel's treatment of incomplete and ill-typed programs.

### SML: Elaboration As Rule-Governed Static Meaning

The Definition of Standard ML divides execution into three phases:

- parsing determines grammatical form
- elaboration determines whether a phrase is well typed and well formed
- evaluation determines values and dynamic effects

This is directly relevant to diagnostics because type errors are elaboration failures. The SML
Definition is not centered on compiler messages; it gives natural-semantics rules for successful
judgments such as:

```txt
A |- phrase => A'
```

Read operationally, a successful elaboration means:

```txt
against this static background,
this phrase elaborates to this semantic object
```

For `wm-mini`, auditable diagnostics are the dual of that idea:

```txt
against this static background,
this phrase failed to elaborate because this rule requirement failed
```

So the error model should not be separate from the language semantics. It should report the failed
static judgment or failed premise of a judgment.

This is why rule ids matter. The SML Definition already thinks in rules and premises. A Workman
diagnostic should expose that rule structure in implementation form:

```txt
Rule:
  InferIf

Premises:
  condition : Bool
  thenBranch : t
  elseBranch : t

Failed premise:
  thenBranch type == elseBranch type
```

The user does not need raw LaTeX inference rules in the terminal, but the diagnostic should be
traceable back to a real elaboration rule.

### SML: Rule Shapes Are Not All Binary

SML's static semantics is useful precisely because it distinguishes several shapes of obligation.
That should influence the diagnostic object.

Examples:

- expression elaboration: given a context, produce a type
- pattern elaboration: given a context, produce a type and value environment
- declaration elaboration: given a basis, produce a basis extension
- type constructor checks: verify arity, equality properties, and scope
- pattern restrictions: check exhaustiveness, irredundancy, and binding consistency
- module checks: elaborate structures, signatures, sharing, and paths through a basis

Only some of these naturally look like `left == right`. Many are better represented as:

```txt
premise failed:
  lookup x in value environment

premise failed:
  type constructor List expects 1 argument

side condition failed:
  bound type variable escapes its scope

further restriction failed:
  match is not exhaustive
```

So the `Failure` and `SupportGraph` split in `diagnostic-object-model.md` is not decorative. It is
the data model that lets the compiler represent SML-style judgments faithfully instead of pushing
every failure through unification-shaped slots.

### SML: Failed Elaboration Has No Static Effect

The Programs section of the Definition is also useful. It says that if elaboration of a top-level
declaration fails, that declaration has no effect on the basis.

This should remain true for `wm-mini`'s language semantics:

- a failed declaration must not extend the exported static basis
- a failed module should not provide normal value/type exports to dependents
- evaluation should not run after failed elaboration

But the tooling model can still preserve a diagnostic artifact from the failed attempt:

```txt
successful elaboration:
  produces static basis changes

failed elaboration:
  produces no static basis changes
  produces diagnostic evidence
```

That distinction is important. We should not make the language Hazel-like by pretending ill-typed
programs have ordinary SML static meaning. Instead, we can make the compiler and LSP preserve the
semantic evidence from the failed elaboration attempt.

In other words:

```txt
SML semantics:
  no derivation, no basis update

Workman tooling:
  no derivation, no basis update, but keep the failed derivation slice
```

The failed derivation slice is the diagnostic.

### SML: Further Restrictions And Warnings

The Definition separates some compiler obligations from the main inference rules. For example,
match irredundancy and exhaustiveness are "further restrictions": the compiler must warn when they
are violated but should still compile the match.

That gives `wm-mini` a useful precedent for structured non-fatal diagnostics:

```txt
Rule:
  CheckMatch.Exhaustive

Status:
  warning, not elaboration failure

Evidence:
  uncovered pattern space
  source match arms
```

This matters because auditable diagnostics are not only for fatal type mismatch errors. The same
failed-rule model can cover warnings:

- non-exhaustive match
- redundant arm
- non-exhaustive value binding pattern
- ambiguous record wildcard
- local type escape
- FFI boundary mismatch

The severity changes, but the diagnostic shape remains:

```txt
which rule or restriction was checked
which requirement failed
what evidence supports that report
whether elaboration continues
```

### SML: Principal Types And Unification

SML's type discipline comes from the Hindley-Milner line: principal type schemes, equation solving,
and unification. `wm-mini` is already in that family.

That gives the diagnostic model an important constraint: preserve principal inference behavior. The
compiler should not change the inferred type to improve the error. It should explain the same
unification and elaboration process it already performs.

The provenance model should therefore be observational:

```txt
Do:
  record which rule introduced a type equality
  record which source fact committed a type variable
  record which later constraint collided with that commitment

Do not:
  change the unification order to manufacture nicer blame
  pick one branch as "wrong" unless the rule gives direction
  insert gradual unknowns into normal batch semantics
```

This keeps `wm-mini` close to SML while still making failures intelligible.

### Hazel: The Semantic Gap

Hazel's important lesson is that conventional type systems define meaning mainly for well-typed
programs. During editing, the program is often syntactically present but statically broken, so
semantic services lose information exactly when the user needs them most.

Hazel attacks this by making every editor state meaningful with marks, holes, gradual unknowns, and
total recovery.

`wm-mini` should not copy that full design. In particular, this plan does not require:

- a marked AST as the primary typed program
- non-empty expression holes as semantic membranes
- gradual unknown types in ordinary elaboration
- total marking for every syntactically well-formed broken program
- interactive type-hole filling as the core error model

The borrowed idea is narrower:

```txt
Do not throw away semantic state just because elaboration failed.
```

Hazel motivates treating diagnostics as semantic artifacts rather than side effects.

### Hazel: Neutrality About User Intent

Hazel is careful not to guess which branch or use site is "wrong" when the evidence is symmetric.
For example, if two `if` branches have inconsistent types, Hazel localizes the inconsistency to the
conditional as a whole instead of pretending one branch is expected and the other is wrong.

This maps directly to Workman diagnostics:

```txt
Bad core model:
  expected Number, got String

Better core model:
  InferIf.BranchesSameType failed
  thenBranch : Number
  elseBranch : String
```

The renderer can still use expected/got when the rule is directional:

- function parameter versus argument
- annotation versus expression
- pattern expectation versus scrutinee
- FFI boundary requirement versus supplied value

But for symmetric constraints, the diagnostic should stay neutral.

This is the practical Hazel influence: preserve enough structure to avoid fake blame.

### Hazel: Provenance Instead Of Substitution-Only State

The Hazel paper explicitly warns that eager substitution during unification loses information needed
to explain partial solutions and failures. Their type-hole system keeps provenance and potential
solution sets.

`wm-mini` does not need Hazel's potential type sets, but the same engineering principle applies:

```txt
If unification commits t4 := Number, keep why.
If a later constraint asks for t4 := String, report both commitments.
```

The current `UnifyBind` and `TypeProvenance` design is already a small version of this. The next
step is to make the "why" structured:

```txt
t4 := Number
  fact: thenBranch type
  origin: integer literal
  rule: InferIf.ThenBranch

t4 conflicts with String
  fact: elseBranch type
  origin: string literal
  rule: InferIf.BranchesSameType
```

That keeps the core HM implementation intact while retaining the causal edges needed for
diagnostics.

### The SML/Hazel Synthesis For wm-mini

The right theoretical position is:

```txt
SML gives the language semantics:
  elaboration is a rule-governed static judgment
  successful elaboration updates the static basis
  failed elaboration does not update the static basis
  warnings can be required without rejecting the phrase

Hazel gives the tooling mindset:
  broken programs are normal during editing
  localization should avoid arbitrary intent guesses
  missing semantic information should be represented deliberately
  provenance should survive unification and recovery

wm-mini should combine them by:
  preserving SML-style elaboration
  recording failed rule attempts as diagnostic artifacts
  exposing evidence slices instead of prose guesses
  staying neutral when constraints are symmetric
```

So the diagnostic object is not a new semantics for invalid programs. It is a record of an
unsuccessful attempt to construct the ordinary SML-style elaboration derivation.

## Error System Rewrite Plan

This should be a clean rewrite of the error system around structured diagnostic artifacts.

The existing message-shaped diagnostics are reference material only:

- what cases currently exist
- what tests should still be covered
- what useful related spans or hints should not be lost

They should not constrain the internal model, renderer, or implementation order. The goal is one
diagnostic pipeline:

```txt
compiler rule/premise
  -> evidence entries and type snapshots
  -> structured Diagnostic
  -> CLI/LSP renderers
```

### Step 1: Add The Diagnostic Writer

Add a small allocator and writer for diagnostic evidence before adding individual diagnostics. Every
rule frame, premise, claim, constraint, substitution, search, recovery step, and repair should have a
stable id when it is created.

Keep this deliberately KISS:

```ts
type DiagnosticWriter = {
  nextId(): EvidenceId;
  snapshotType(ty: Ty): TypeSnapshotId;
  add(entry: SupportEntry): void;
  addEdge(edge: SupportEdge): void;
};
```

The writer may store entries chronologically. Chronology is useful for replaying the compiler's
local reasoning. The anti-goal is a raw trace of every function call; the acceptable goal is an
ordered list of semantic evidence with ids and anchors.

This step also makes type evidence immutable. Do not keep historical evidence as references to
mutable `Ty` nodes. Capture immutable type snapshots at constraint introduction, type-variable
commitment, and collision time.

### Step 2: Pass Premise Context To Constraint Sites

Add premise metadata to `constrainAt` at call sites that produce structured diagnostics.

```ts
type PremiseContext = {
  frame: RuleFrame;
  premise: Premise;
  roles: ConstraintRole[];
  origin: SourceAnchor;
};
```

Start at central choke points:

- call arguments
- pipe step input
- if condition
- if branch join
- match arm result
- type annotations
- binary operator application

The point is to get rule identity, premise identity, operand roles, and origin into the data path as
one concept. Avoid separate `RuleContext`, `ConstraintOrigin.message`, and ad hoc role fields.

### Step 3: Replace Message Origins With Anchored Claims

Current string origins are useful but too presentation-shaped. Replace them with claims and anchors:

```ts
type ClaimEntry = {
  kind: "claim";
  id: ClaimId;
  proposition: Proposition;
  origin: SourceAnchor;
};

type ConstraintRole = {
  term: TermId;
  role: string;
  snapshot: TypeSnapshotId;
};
```

Rendering can print `from <label> at line:col`, but the stored data should be semantic evidence:
literal facts, variable facts, callee facts, argument facts, branch facts, annotation facts, basis
facts, and FFI facts.

### Step 4: Add Constraint And Substitution Evidence

Extend the current type-fact/provenance code so constraints and substitutions can be emitted as
support entries. Constraint entries should be created with the `ConstraintId` allocated before the
unifier runs, so commitments and collisions can point back to the same constraint.

```ts
type SupportEntry =
  | ClaimEntry
  | ConstraintEntry
  | ScopeEntry
  | SubstitutionEntry
  | SearchEntry
  | RecoveryEntry
  | RuleEntry;
```

The id lets constraints and rule frames refer to evidence without embedding large trees.

### Step 5: Add Constraint Evidence

When `constrainAt` calls the unifier, attach the already allocated `ConstraintId` to any resulting
commitments or failure.

The unifier should not become responsible for user-facing explanations. It should report low-level
collision evidence:

- left type
- right type
- immutable snapshots of both types
- structural diff path
- previously committed variable, if any
- attempted side
- constraint id

The diagnostic layer then asks the support evidence what that means.

### Step 6: Rule Trace

Thread a lightweight `RuleFrameId` through inference, either explicitly or through an inference
context object.

An inference context would eventually replace the current long parameter list:

```ts
type InferContext = {
  env: Env;
  typeEnv: TypeEnv;
  adts: Map<number, TypeDeclInfo>;
  types: Map<Expr, Ty>;
  facts: TypeFacts;
  provenance: TypeProvenance;
  diagnostics: Diagnostic[];
  rulePath: RuleFrameId[];
};
```

This should be done only when it reduces friction. The current codebase is small enough that premise
contexts can prove the shape before introducing a full inference context.

### Step 7: Render Auditable Diagnostics

Keep the default concise, but make it structured:

```txt
[type.mismatch] rule failed: InferPipe.StepInput

failed:
  output(previousStep) == parameter(nextFunction, 0)

observed:
  previousStep : Task<HttpError, User>
    from fetchUser()

  nextFunction parameter 1 : User
    from render
```

Full trace mode can be added as a renderer over the same diagnostic object.

## Near-Term Target

The initial rewrite target is not a complete Hazel-style solver. It is the model in
`markdown/diagnostics/diagnostic-object-model.md`, applied to type mismatch sites.

The initial diagnostics can have small evidence logs:

```txt
failure:
  frame: rule path and source subject
  premise: the exact requirement being checked
  violation: contradicted, unsatisfied, cardinality-failed, cycle-found, or another model variant

support:
  entries: chronological claims and constraints near the failure
  roots: failed constraint and observed operands
  edges: only the causal links needed to justify the rendering
```

This fits the current implementation because `constrainAt` already knows local role names and source
expressions at the best choke points. But the stored shape should be the general model from the
start, so later diagnostics can add lookup, arity, coverage, scope, occurrence, and graph evidence
without another redesign.

The first concrete implementation target should be narrow in language coverage but complete in
pipeline shape:

- Add `PremiseContext` to central `constrainAt` call sites.
- Capture immutable type snapshots at constraint introduction, commitment, and collision.
- Convert recursive binding result mismatches into a failed premise plus evidence log.
- Route the selected checks through the new diagnostic writer and renderer end to end.

## Example: If Branch Mismatch

Input:

```wm
let x =
  if ok then 1 else "no"
```

Diagnostic:

```txt
[type.mismatch] rule failed: InferIf.BranchesSameType

rule:
  an if-expression must produce one result type

failed requirement:
  type(thenBranch) == type(elseBranch)

observed:
  thenBranch : Number
    from integer literal at main.wm:2:14

  elseBranch : String
    from string literal at main.wm:2:21

collision:
  Number != String
```

No prose apology is needed. The error tells the user exactly which rule failed and shows the facts.

## Example: Pipe Mismatch

Input:

```wm
fetchUser()
  :> render
```

Diagnostic:

```txt
[type.mismatch] rule failed: InferPipe.StepInput

rule:
  for `a :> f`, the output of `a` must match the first parameter of `f`

failed requirement:
  output(previousStep) == parameter(nextFunction, 0)

observed:
  previousStep : Task<HttpError, User>
    from fetchUser()

  nextFunction parameter 1 : User
    from render : User -> Html

legal repairs:
  - make the previous step produce User
  - make render accept Task<HttpError, User>
  - insert a step that converts Task<HttpError, User> to User
```

The legal repairs are not commands. They are the ways the failed requirement could become true.

## Non-Goals

- Do not copy Elm's conversational prose style.
- Do not build a giant chronological solver log.
- Do not special-case individual basis functions when a rule/constraint origin is enough.
- Do not replace HM inference just to improve diagnostics.
- Do not make verbose trace output the default editor experience.
- Do not make expected/got the core model for all unification failures.

## Decision

`wm-mini` should replace message-shaped diagnostics with auditable diagnostics:

- diagnostics as failed rule instances
- facts and constraints as retained semantic evidence
- unification failures as collisions between evidence, not just strings
- rule traces as semantic paths through compiler logic
- rendering modes over one structured diagnostic object

The current compiler already has the right starting points: `constrainAt`, `UnifyBind`,
`TypeProvenance`, `TypeFacts`, and `type_diff`. The next step is to make rule identity and evidence
identity first-class without turning the compiler into a full event recorder.
