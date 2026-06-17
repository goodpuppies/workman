# Diagnostic Object Model

This document defines the data model for auditable diagnostics in `wm-mini`.

For one fully worked example, see `markdown/diagnostics/diagnostic-single-error-example.md`.

Core thesis:

```txt
A diagnostic is a failed compiler premise plus the evidence needed to replay that failure.
```

User-facing thesis, kept verbatim:

```txt
you told me a rule failed? please list out - what is the exact rule - what part of the rule i violated if the rule is has parts to fix: - you told me data points, how did you figure out those data points? basically where do i look in my code to reproduce the error in my head? - if the error message essentially tells me the solution i need to know the exact reason why i have to solve it myself and so on essentially i see an error as state snapshot that should allow me to reconstruct the compilers state in my head at the moment of the failure, to do that i need to know what logic branch were in, what that logic is in the branch is, what state was relevant in that branch
```

The model should answer four questions directly:

- Which exact rule was being applied
- Which premise of that rule failed
- Which observed facts made the premise fail
- How those facts were derived from source

## Thesis To Model Mapping

Most thesis questions are not answered by one field alone. They are answered by a small group of
fields working together.

```txt
Question:
  what is the exact rule?

Answered by:
  failure.frame.rule
  failure.frame.subject
  failure.frame.anchor
  failure.frame.path

Why more than one field:
  rule names the check
  subject says what semantic object the rule was checking
  anchor says where that rule frame lives
  path says which compiler branch reached the rule
```

```txt
Question:
  what part of the rule was violated?

Answered by:
  failure.premise.role
  failure.premise.predicate
  failure.premise.origin
  failure.violation.kind

Why more than one field:
  role gives the human-stable name of the rule part
  predicate gives the formal condition
  origin says where the premise came from
  violation says the kind of counterexample observed
```

```txt
Question:
  what data points did the compiler use?

Answered by:
  support.entries
  support.roots
  failure.violation.observed for contradicted failures

Why more than one field:
  entries hold all available evidence
  roots identify the evidence that should be read first
  observed gives the immediate counterexample when the failure is a contradiction
```

```txt
Question:
  how did the compiler figure out those data points?

Answered by:
  support.edges
  ConstraintEntry.createdBy
  SubstitutionEntry.reason
  SearchEntry.query, SearchEntry.space, SearchEntry.result
  RuleEntry.frame

Why more than one field:
  edges explain causal relationships between evidence entries
  constraints connect facts back to the premise that required them
  substitutions explain committed type variables
  searches explain lookup success, failure, or ambiguity
  rule entries preserve parent or nested rule frames when needed
```

```txt
Question:
  where do I look in my code to replay the error?

Answered by:
  primary
  failure.frame.anchor
  failure.premise.origin
  SupportEntry.origin on claims, constraints, searches, and recovery entries

Why more than one field:
  primary is the first place to look
  frame anchor is the whole construct or generated item being checked
  premise origin is the logical site of the failed requirement
  support origins point to every source fact used in the failure
```

```txt
Question:
  if the message implies a fix, why is that fix required?

Answered by:
  failure.premise.predicate
  failure.violation
  support.roots
  support.edges

Why more than one field:
  the predicate says what must become true
  the violation says why it is currently false
  roots show the relevant facts
  edges show why changing those facts would affect the failed premise
```

```txt
Question:
  what compiler state snapshot matters?

Answered by:
  failure
  support
  dependsOn

Why more than one field:
  failure gives the active rule, premise, and counterexample
  support gives the relevant state slice as evidence entries and edges
  dependsOn separates primary failures from cascades caused by earlier diagnostics
```

The model should stay small. It should not have a field for every compiler subsystem. Environments,
substitutions, searches, recovery holes, type facts, and rule frames are all evidence entries in one
support graph.

## Core Shape

```ts
type Diagnostic = {
  id: DiagnosticId;
  code: DiagnosticCode;
  severity: Severity;
  primary: SourceAnchor;
  failure: Failure;
  support: SupportGraph;
  repairs: Repair[];
  dependsOn: DiagnosticId[];
};
```

There are no nullable or optional fields in the core model. Absence is represented by an empty
collection or by choosing a different tagged variant. This applies to nested model types too: do not
use optional spans or nullable references to mean "compiler-generated", "basis", or "unknown".

```txt
Diagnostic
  Failure
    RuleFrame
    Premise
    Violation
  SupportGraph
    Entries
    Edges
    Roots
  Dependencies
```

`SourceAnchor` is a tagged location, not a nullable source span. Some evidence is source text, but
some evidence is generated by the compiler, imported from another module, or produced by recovery.

```ts
type SourceAnchor =
  | { kind: "source"; file: FileId; span: Span }
  | { kind: "imported-source"; module: ModuleId; exportedName: NameId; file: FileId; span: Span }
  | { kind: "imported-symbol"; module: ModuleId; exportedName: NameId }
  | { kind: "basis"; name: NameId }
  | { kind: "generated"; by: RuleFrameId; label: string }
  | { kind: "recovery"; step: RecoveryId; label: string };
```

This keeps the core non-null while avoiding fake source spans for compiler-generated facts.

## Failure

```ts
type Failure = {
  frame: RuleFrame;
  premise: Premise;
  violation: Violation;
};
```

Read this as:

```txt
While applying this rule frame,
the compiler required this premise,
but observed this violation.
```

This is the semantic center of the diagnostic.

`failure` owns the canonical `RuleFrame`, `Premise`, and `Violation` for the diagnostic. The support
evidence should not duplicate those full objects. If support needs to refer to the active rule or
premise, it should refer to `RuleFrameId`, `PremiseId`, or `ConstraintId`.

## Rule Frame

```ts
type RuleFrame = {
  id: RuleFrameId;
  rule: RuleId;
  subject: SubjectId;
  anchor: SourceAnchor;
  path: RulePath;
};
```

`rule` names the compiler or language rule. `anchor` is where the rule frame lives, which may be
source, imported, basis, generated, or recovery evidence. `path` names the semantic logic branch
that led there. This is not a JavaScript stack trace. It is the compiler's rule path.

Examples:

```txt
InferExpr -> InferIf -> JoinBranches
InferExpr -> InferApplication -> CheckArgument
ElaborateDec -> ElaborateValBind -> CheckPatternExpressionAgreement
ElaborateType -> ApplyTypeConstructor
```

## Premise

```ts
type Premise = {
  id: PremiseId;
  role: PremiseRole;
  predicate: Predicate;
  origin: SourceAnchor;
};
```

A premise is one formal requirement of a rule.

The `role` explains why the predicate exists. The same predicate can arise for different reasons.
For example, `equal(typeA, typeB, type)` can mean if branches agree, match arms agree, an annotation
matches an expression, or an argument matches a parameter.

## Premise Context

`PremiseContext` is the one object passed into compiler choke points such as `constrainAt`. It is
the implementation-facing input that creates the canonical `RuleFrame`, `Premise`, and failed
constraint evidence.

```ts
type PremiseContext = {
  frame: RuleFrame;
  premise: Premise;
  roles: ConstraintRole[];
  origin: SourceAnchor;
};
```

`RuleContext` and string-shaped constraint origins should not be separate concepts. A constraint is
created because a premise of a rule requires it, so the context should name the rule frame, the
premise, the operand roles, and the source or generated origin in one place.

The initial implementation may construct `RuleFrame` and `Premise` inline at the call site. Later,
helpers can reduce boilerplate, but they should still allocate the same canonical ids.

## Type Snapshots

Type evidence must not store references to mutable `Ty` nodes. Every type fact that may appear in a
diagnostic stores an immutable snapshot captured at the moment the evidence is created.

```ts
type TypeSnapshot = {
  id: TypeSnapshotId;
  rendered: string;
  shape: TypeSnapshotShape;
};

type TypeSnapshotShape =
  | { kind: "named-var"; id: TypeVarId; name: string }
  | { kind: "anonymous-var"; id: TypeVarId }
  | { kind: "named"; typeId: TypeInfoId; name: string; args: TypeSnapshotId[] }
  | { kind: "function"; params: TypeSnapshotId[]; result: TypeSnapshotId }
  | { kind: "tuple"; items: TypeSnapshotId[] }
  | { kind: "record"; fields: FieldSnapshot[] }
  | { kind: "primitive"; name: string };
```

The exact shape can evolve with the type language. The important rule is stable history:

- constraint introduction captures left and right snapshots
- type-variable commitment captures the committed snapshot
- collision captures both operand snapshots after pruning at the failure point
- rendering reads snapshots, not live mutable types

## Predicate

```ts
type Predicate =
  | { kind: "equal"; left: TermId; right: TermId; domain: EqualityDomain }
  | { kind: "has-type"; subject: SubjectId; ty: TypeSnapshotId }
  | { kind: "has-kind"; subject: SubjectId; kindId: KindId }
  | { kind: "callable"; subject: TermId }
  | { kind: "cardinality"; subject: TermId; expected: CountSpec; domain: CountDomain }
  | { kind: "not-contains"; needle: TermId; haystack: TermId; domain: ContainmentDomain }
  | { kind: "resolves"; name: NameId; scope: ScopeId }
  | { kind: "has-field"; record: TermId; field: FieldId }
  | { kind: "unique"; key: KeyId; domain: UniquenessDomain }
  | { kind: "covered"; space: SpaceId; cases: CaseSetId }
  | { kind: "irredundant"; caseId: CaseId; previous: CaseSetId }
  | { kind: "region-contained"; item: TermId; inner: RegionId; outer: RegionId };
```

This is deliberately small. New compiler features should usually add predicates or support entries,
not top-level diagnostic fields.

## Violation

```ts
type Violation =
  | { kind: "contradicted"; observed: Observation[]; conflictPath: Path[] }
  | { kind: "unsatisfied"; search: SearchId }
  | { kind: "ambiguous"; search: SearchId; candidates: CandidateId[] }
  | { kind: "cardinality-failed"; actual: CountSpec; mapping: CountMapping }
  | { kind: "cycle-found"; cycle: CyclePath };
```

The violation says how the premise failed.

The premise owns the required condition. The violation owns only the counterexample. If the compiler
needs a normalized failed condition such as `equal(Int, String, type)`, store it as a failed
constraint in the support graph, created by the premise. Do not repeat it inside the violation.

- `contradicted`: incompatible facts were found
- `unsatisfied`: no solution was found
- `ambiguous`: more than one solution was found
- `cardinality-failed`: a count or arity requirement failed
- `cycle-found`: a forbidden containment or dependency cycle was witnessed

These five are enough to prove the architecture for the initial implementation:

- type mismatch, branch mismatch, annotation mismatch
- unbound names and missing fields
- ambiguous names or inference choices
- call, tuple, constructor, and type-constructor arity
- occurs checks and recursive occurrence cycles

Known later extensions:

```ts
type ExtendedViolation =
  | { kind: "duplicate-found"; key: KeyId; first: SourceAnchor; duplicate: SourceAnchor }
  | { kind: "escaped-region"; actual: RegionId; path: Path[] }
  | { kind: "uncovered-space"; witness: WitnessId }
  | { kind: "redundant-case"; caseId: CaseId; coveredBy: CaseSetId };
```

These are meaningful, but they are not needed to start the architecture. They can be added when
duplicate checks, scope escape checks, and coverage checks are moved onto the structured model.

## Support Graph

```ts
type SupportGraph = {
  entries: SupportEntry[];
  edges: SupportEdge[];
  roots: SupportRoot[];
};
```

The support graph is the state snapshot. Keep the implementation simple: record evidence entries in
creation order, then add roots and edges only where they help the renderer answer "why did this fact
matter?" A chronological evidence log is acceptable. The problem to avoid is not chronology; it is
recording every internal compiler step with no semantic ids or source anchors.

In other words:

- do record facts, constraints, substitutions, searches, rule frames, recovery steps, and repairs
- do keep enough ordering to replay the local failure
- do not invent a separate fixed state record for every compiler subsystem
- do not require a fully connected graph before the first rewrite works

```ts
type SupportEntry =
  | ClaimEntry
  | ConstraintEntry
  | ScopeEntry
  | SubstitutionEntry
  | SearchEntry
  | RuleEntry
  | RecoveryEntry;
```

```ts
type ClaimEntry = {
  kind: "claim";
  id: ClaimId;
  proposition: Proposition;
  origin: SourceAnchor;
};

type ConstraintEntry = {
  kind: "constraint";
  id: ConstraintId;
  predicate: Predicate;
  origin: SourceAnchor;
  createdBy: PremiseId;
  status: ConstraintStatus;
};

type ScopeEntry = {
  kind: "scope";
  id: ScopeId;
  bindings: BindingSummary[];
};

type SubstitutionEntry = {
  kind: "substitution";
  id: SubstitutionId;
  variable: TypeVarId;
  value: TypeSnapshotId;
  reason: ConstraintId;
};

type SearchEntry = {
  kind: "search";
  id: SearchId;
  query: SearchQuery;
  space: SearchSpace;
  result: SearchResult;
};

type RuleEntry = {
  kind: "rule";
  id: RuleFrameId;
  frame: RuleFrame;
};

type RecoveryEntry = {
  kind: "recovery";
  id: RecoveryId;
  step: RecoveryStep;
};
```

Edges explain causality:

```ts
type SupportId =
  | ClaimId
  | ConstraintId
  | ScopeId
  | SubstitutionId
  | SearchId
  | RuleFrameId
  | RecoveryId;

type SupportEdge = {
  from: SupportId;
  to: SupportId;
  relation: SupportRelation;
};
```

Roots tell renderers where to start:

```ts
type SupportRoot =
  {
    entry: SupportId;
    role: SupportRootRole;
  };
```

## SML Example: Variable Lookup

The SML Definition has an atomic-expression rule for value identifiers:

```txt
C(longvid) = (sigma, is)
sigma specializes to tau
--------------------------------
C |- longvid => tau
```

A missing variable is not a type contradiction. It is an unsatisfied lookup premise.

```txt
failure:
  frame:
    rule: SML.AtomicExpression.ValueIdentifier
    path: ElaborateExpression -> ElaborateAtomicExpression -> ResolveValueIdentifier
  premise:
    role: value-identifier-must-resolve
    predicate: resolves(longvid, value-environment)
  violation:
    kind: unsatisfied

support:
  search query: resolve value identifier "foo"
  search space: current value environment
  search result: zero exact matches
```

The diagnostic can render candidates, imports, or similar names from the search entry, but the failed
rule remains a lookup premise.

## SML Example: Value Binding Agreement

The SML value binding rule has premises shaped like:

```txt
C |- pat => (VE, tau)
C |- exp => tau
--------------------------------
C |- pat = exp => VE
```

A mismatch between the pattern type and expression type is a contradicted equality premise.

```txt
failure:
  frame:
    rule: SML.ValueBinding
    path: ElaborateDeclaration -> ElaborateValueBinding
  premise:
    role: pattern-and-expression-types-must-agree
    predicate: equal(type(pattern), type(expression), type)
  violation:
    kind: contradicted

support:
  claim: pattern has type Bool
  claim: expression has type Int
  constraint: type(pattern) equals type(expression)
  edges:
    pattern claim provided left side of constraint
    expression claim provided right side of constraint
```

This is the ordinary unification-shaped case, but it is still anchored to a rule premise.

## SML Example: Match Rule

The SML match-rule premise is shaped like:

```txt
C |- pat => (VE, tau)
C + VE |- exp => tau'
--------------------------------
C |- pat => exp => tau -> tau'
```

There are at least two distinct diagnostic shapes here.

First, the pattern may elaborate but the expression may fail under the extended environment. That is
not merely a local expression error; the support graph should include the rule frame showing that the
expression was checked under `C + VE`.

Second, the type names introduced by the pattern must not escape. In the revised Definition this is
represented by a side condition:

```txt
TyNames(VE) subset TyNames(C)
```

That failure uses the later `escaped-region` extension:

```txt
failure:
  frame:
    rule: SML.MatchRule
    path: ElaborateMatch -> ElaborateMatchRule
  premise:
    role: pattern-bound-type-names-must-not-escape
    predicate: region-contained(type-names(VE), pattern-region, context-region)
  violation:
    kind: escaped-region

support:
  claim: pattern elaboration produced VE
  claim: VE contains generated type name t
  claim: surrounding context does not contain t
  edge: generated type name came from pattern elaboration
```

This is a good example of why the model cannot be only left/right type equality.

## SML Example: Constructed Type Arity

The constructed-type rule elaborates each type argument, looks up the type constructor, and applies
the type function. The Definition notes that the type function application is defined only when the
constructor has the right arity.

```txt
tyseq = ty1 ... tyk
C |- tyi => taui
C(longtycon) = theta
theta applied to tau1 ... tauk is defined
--------------------------------
C |- tyseq longtycon => theta(tau1 ... tauk)
```

An arity mismatch should use `cardinality-failed`, not a generic contradiction.

```txt
failure:
  frame:
    rule: SML.TypeExpression.ConstructedType
    path: ElaborateTypeExpression -> ApplyTypeConstructor
  premise:
    role: type-constructor-arity-must-match
    predicate: cardinality(type-arguments, exact arity(theta), type-constructor-arguments)
  violation:
    kind: cardinality-failed

support:
  claim: List has arity 1
  claim: supplied type argument tuple has arity 2
  mapping: argument 0 matched, argument 1 extra
```

The repair may be obvious to a renderer, but the reason is the arity premise.

## SML Example: Recursive Value Binding

The recursive value binding rule elaborates a value binding in an environment extended with the
value environment being defined:

```txt
C + VE |- valbind => VE
--------------------------------
C |- rec valbind => VE
```

This is the SML-level rule behind wm-mini's recursive occurrence diagnostics.

For wm-mini, a recursive function binding has an implementation-level invariant:

```txt
recursive occurrences share one monomorphic placeholder
the body result must agree with the binding result
```

That becomes:

```txt
failure:
  frame:
    rule: WM.RecursiveBinding.Result
    path: ElaborateDeclaration -> ElaborateRecursiveBinding -> CheckResult
  premise:
    role: recursive-body-result-must-match-placeholder-result
    predicate: equal(type(body-result), type(recursive-placeholder-result), type)
  violation:
    kind: contradicted

support:
  claim: binding placeholder sumList has type (Int_list, Number) -> Number
  claim: recursive occurrence sumList(rest, val+i) has result Number
  claim: body result has type Int_list -> Number
  claim: operator + has type Number
  constraint: body result equals recursive placeholder result
```

The support graph is where occurrence evidence lives. The failure remains one premise.

## Future SML Example: Match Exhaustiveness

The Definition treats match irredundancy and exhaustiveness as further restrictions. A compiler must
warn on violation but still compile the match.

That is the same diagnostic object with `severity: "warning"`, but it uses the future coverage
violation variants listed above. The initial implementation does not need these coverage variants; the
example shows where match checking should land when coverage evidence moves onto the structured
model.

```txt
failure:
  frame:
    rule: SML.FurtherRestriction.MatchExhaustive
    path: CheckMatchRestrictions -> CheckExhaustiveness
  premise:
    role: match-must-cover-input-space
    predicate: covered(input-space, pattern-cases)
  violation:
    kind: uncovered-space

support:
  claim: input space is Bool
  claim: pattern cases cover true
  witness: false
```

Irredundancy is similar:

```txt
failure:
  frame:
    rule: SML.FurtherRestriction.MatchIrredundant
  premise:
    role: each-pattern-must-add-new-coverage
    predicate: irredundant(case-3, previous-cases)
  violation:
    kind: redundant-case
```

These examples show why severity does not define the model. Fatal errors and warnings both report a
failed premise with support.

## SML Example: Failed Program Elaboration

The Programs rule says a failing top-level elaboration has no effect on the basis.

For diagnostics, that means recovery must appear in the support graph if the driver continues:

```txt
failure:
  frame:
    rule: SML.Program.FailingElaboration
  premise:
    role: top-level-declaration-must-elaborate
    predicate: elaborates(topdec, basis)
  violation:
    kind: unsatisfied

support:
  recovery entry: keep previous basis
  recovery entry: continue with next top-level declaration
  edge: failed elaboration caused basis recovery
```

The diagnostic artifact may preserve the failed derivation slice, but the language semantics still
does not apply the failed basis update.

## Rendering Discipline

A renderer should not invent hidden reasoning. It should project the model.

Minimum rendering:

```txt
[code] rule failed: <frame.rule>

failed premise:
  <premise.role>
  <premise.predicate>

violation:
  <violation.kind>

observed:
  <support roots and nearby claims>

compiler path:
  <frame.path>
```

Repair text is allowed only when the diagnostic contains enough support to justify it. If the
message says "add a type annotation", the support graph should show the ambiguity or escaped region
that annotation would resolve.

Repairs are optional structured projections:

```ts
type Repair = {
  id: RepairId;
  description: string;
  makesTrue: PremiseId;
  requires: SupportId[];
};
```

An empty `repairs` list means the diagnostic explains the failure but does not claim a concrete
repair.

## Design Rule

The top-level diagnostic type should not know compiler subsystems.

Avoid fixed state records such as:

```txt
environment field
substitution field
active effects field
active holes field
```

Prefer:

```txt
support.entries: typed evidence entries
support.edges: causal links
support.roots: render starting points
```

That keeps the model simple while still allowing rich diagnostics.

For every proposed field or variant, ask:

```txt
this is the rule
this is the premise
this is the counterexample
this is support evidence
this is diagnostic identity or policy
```

If it is none of those, remove it. If it restates another part of the model, remove it.
