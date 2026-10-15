# Frontend-v3 → SubsetML lowering plan

Priority: WM execution and completing frontend v3 are the main path. SubsetML/MLton
remains an intended target, with checks at useful milestones. Record blockers; do not
stall independent editor work or expand lowering machinery merely to finish a slice.
The speculative parser/schema and their drivers/checks have been removed. Follow
[worklist.md](worklist.md) and [structural-editor-plan.md](structural-editor-plan.md).

Status: agreed implementation direction, 2026-10-11. This plan records decisions and remaining
work. The portable lexer now translates and passes a disposable MLton smoke build;
entry-driven builds, native driver tooling and complete WM/native document parity checks
now work. Parser design and implementation remain the next phase.

## Design goal and temporary approach

Frontend-v3 remains authored in WM. Generated SML and native build artifacts are disposable
outputs. SubsetML itself remains authored in constrained SML; its generated WM is not edited
as the source of truth.

The intended future architecture is a WM → SubsetML lowerer inside the WM compiler. That
lowerer can use the compiler's resolved bindings, constructor identities, inferred receiver
and operand types, record layouts and generalization information. It can automate translations
that the current standalone lowerer cannot determine from syntax alone.

Until that exists, use the lowerer included in SubsetML and a small set of explicit source
constraints. These are a temporary, easier way to make the frontend portable without
reimplementing WM inference inside SubsetML. The manual work in the current frontend is small,
so explicit record names and occasional receiver type constraints are an acceptable tradeoff.
They do not establish permanent restrictions on WM or require expanding SubsetML's language.

Prefer narrow lowerings backed by existing declaration resolution and SubsetML checking.
Do not guess a record identity or comparison operation when the available information is
insufficient. Diagnose unsupported cases. Reconsider this boundary if future parser code makes
the manual constraints substantial; that would be a reason to move work into the WM compiler.

## Decisions

### Record spreads name their layout

Keep updates explicit:

```wm
Token.Token { ..token, marks = marks }
```

Reconstruction needs the complete field layout and must preserve once-only evaluation,
source order and override precedence. Naming the record supplies the layout without inferring
the spread operand's nominal type. Imported layouts must preserve their owning module identity
and private dependency scope.

Anonymous spread remains outside the current translation profile. Punning is separate:
`field` expands to `field = field` and does not itself need type inference. The restriction
concerns spread/layout selection, not punning.

### Distinct nominal records use distinct field-label sets

Decision: preserve SubsetML's R2 restriction for the current port and enforce it as a
frontend coding convention. No two distinct nominal record declarations in the portable
source graph may have the same complete label set. Individual labels can be shared when
the complete sets differ. Use meaningful labels rather than dummy discriminator fields.

`TypeArguments<T>` uses `argumentAngles`; `TypeParameters` uses `parameterAngles`.
`BlockItem` uses `blockPhrase`; `TopPhrase` uses `topPhrase` to distinguish their formerly
identical `{node, phrase, terminator}` shapes. They remain separate nominal records. This is a temporary, small manual accommodation;
expanding the standalone lowerer here offers little benefit now. Reconsider it with the
future WM compiler-informed lowerer, which can preserve resolved record identity. R2 is
an intentional subset restriction, not an SML conformance bug or a permanent WM rule.

### Record projection receivers must have a known complete type

Use ordinary constraints within each helper's definition to establish the receiver type.
Add a parameter or binding type constraint when necessary:

```wm
let peekByOne = (reader: Reader, index) => {
  Text.peek(reader.source, index)
};
```

Do not annotate every projection if other constraints already establish its receiver type.
This applies to local helpers and recursive helpers as well as module-level functions.
Later calls to an already checked/generalized helper are not a substitute for constraints
within its definition.

SML has projection (`#source reader`), but does not choose a declared record merely because
it contains that label. An unresolved flexible record cannot remain at the declaration
boundary. WM's nominal record disambiguation can accept definitions the target checker cannot
resolve. For now, establish the receiver explicitly rather than adding WM-style record
selection to SubsetML. A future compiler lowerer can carry WM's resolved receiver type and
emit the needed SML constraint automatically.

### Equality keeps the existing type-directed lowering

The SubsetML lowerer already infers operand types, rewrites real equality/inequality to
`Real.==` / `Real.!=`, and checks the result under strict SML equality rules. Numeric source
units and indices need real comparison; variant values such as `Token.PairGroup` use SML
equality. A blanket syntactic rewrite would be wrong.

Retain this existing machinery. A generic comparison generalized before its callers cannot
be specialized afterward merely because a later call supplies numbers. Helpers must establish
necessary numeric constraints at their own declaration. This is a supported-profile limitation,
not permission to change WM inference or give source annotations new disambiguation semantics.

### Numeric and pinned patterns lower to ordered checks

Implement numeric literal patterns, including literals nested in list, tuple and constructor
patterns, using ordinary structural matches plus real comparisons. Literal types are known;
this does not need general WM inference or add real literal patterns to SubsetML.

For pinned patterns, resolve whether a name denotes a value or a constructor. The current
lexer pins `Char.classLetter` and related numeric constant bindings. These are expected to
require modest lowering work, using the existing resolution/checking machinery. Arbitrary
pinned values are supported only where that machinery can establish a valid comparison;
otherwise diagnose the limitation rather than guessing numeric or structural equality.

The lowering must preserve:

- One evaluation of the subject, including a subject with effects.
- Source branch order, binding scope and hygienic temporary names.
- Fallthrough to the next source branch when a comparison fails, including inside a nested pattern.
- Constructor identity and the correct comparison operation for pinned values.
- Evaluation of pinned expressions at the appropriate branch-check point; do not hoist them
  indiscriminately or assume every future pin is an immutable numeric constant.

Use supported nested conditional expressions. Keep simple examples and focused regression
cases for failed nested checks; successful compilation alone does not establish match semantics.

### Use one general binding-aware backend renaming system

Decision: implement a shared renaming system in the SubsetML lowerer before extending the
constructor workaround. Avoid accumulating separate spelling rewrites for each lowering.
Reuse the existing collision-free project prefix allocator and fresh-name machinery, but
replace independent policies with one backend name-planning/resolution layer.

Assign backend names to resolved declaration identities, preserving their module and lexical
scope. Keep value, type and module namespaces distinct; record labels need a consistent
layout/label mapping rather than being treated as ordinary lexical variables. Different
aliases of one imported declaration must use its same backend name. Shadowed or unrelated
same-spelled declarations must retain their own identities.

The shared system must cover SML keywords, reserved/omitted Basis constructor names such as
`Span`, generated record constructor functions, helper bindings and temporary names. Preserve
valid authored spellings where possible; allocate collision-free alternatives when required.
Protect names introduced by the target Basis as well as authored and generated names. Do not
rename actual target primitives merely because their spelling also appears in source bindings.

Plan names before target elaboration so an otherwise invalid binding can be checked under
its safe spelling. Apply the map consistently to binding sites, resolved references, qualified
exports/imports, recursive groups, type references and record labels/selections. Lowering passes
must request names through this system rather than constructing their own prefixes. Preserve
source positions and source names for diagnostics; backend spellings must not become semantic
module identities or change the WM API.

Implementation: `BackendNames` now resolves lexical bindings and direct imported exports
before checking, with separate value/type scopes, constructor status, label mapping and a
source/backend symbol table. The old spelling-only keyword traversal has been replaced;
existing helper-name callers share its collision-checking allocator. Duplicate source bindings
remain errors after renaming, and diagnostics restore renamed declarations to their source
spellings. Continue migrating new generated-name needs into this shared system without
breaking translation/round-trip behavior.
Embedded SML declarations are no longer part of the WM profile. Diagnose forward declaration
forms that would require them. Opaque native adapters remain separate; never perform blind
textual substitutions in their SML implementations.

This requires declaration/binding resolution, not a second WM type checker. It also prepares
the architecture for a future compiler-integrated lowerer that already has resolved identities.
Tests must exercise shadowing, recursive references, imported aliases, same basenames in distinct
modules, authored names resembling generated names, reserved spellings and record field labels.

### Explicit positional record constructors need declaration-based lowering

Support calls such as `Source.Position(0, 0, 0)`, `Token.Token(...)` and `ReadResult(...)`.
The current translator emits record type declarations but does not provide these constructor
values. The explicitly named record declaration supplies the field order and layout; no
inferred record-name selection is necessary.

Preserve argument evaluation order, once-only evaluation, arity and generic relationships.
Cover first-class constructor references as ordinary constructor functions where needed.
Do not confuse record constructors with variant constructors or unrelated same-spelled values.

### Built-in Panic targets the source Basis panic function

Lower the resolved WM built-in `Panic(message)` to `SubsetProcess.panic message`.
The Basis function exists with type `string -> 'a`: it attempts to write the byte-string
message plus one newline to stderr, then exits unsuccessfully even if writing fails.
No new host operation or surrounding-result-type inference is needed.

Evaluate the argument once, retain its string constraint, and preserve shadowing: an unrelated
binding named `Panic` is not the built-in. Do not reproduce catchable WM host panic semantics;
process termination is the agreed native behavior. First-class built-in uses need coverage if
encountered. Resolved built-in lowering is implemented for calls and first-class uses. Reverse translation
selects its canonical source runtime with `--panic-runtime FILE.wm`, validates the polymorphic
string-to-result contract, and adds private dependencies/metadata only where it is used.

### Generalization machinery is not expanded speculatively

The current translator has type-directed handling of eligible function-field aliases and
record copies to preserve let-polymorphism. The authored frontend currently does not use
function-valued record fields/carrier copies. Ordinary data aliases such as
`let pos = trivia.newPosition` are a different case.

Keep the existing supported behavior. If parser work introduces carriers or combinators that
need additional generalization support, discuss their concrete semantics and limitations before
extending the lowerer. Do not eta-expand every field selection or silently lose polymorphism.

## SubsetML conformance defects encountered during the port

When the port exposes a defect in SubsetML itself, fix it in SubsetML according to the
Definition of Standard ML (Revised). Do not treat a checker defect as a new frontend coding
restriction or add source annotations merely to conceal it. Preserve SubsetML's explicitly
agreed language subset; distinguish an intentional omitted feature from incorrect semantics
for a supported feature.

The Definition is authoritative. Use the local MLton and MLWorks implementations as references
for inference algorithms, constraint handling and practical behavior:

- [Definition of Standard ML (Revised)](/home/ellie/git/wm-mini/research/The-Definition-of-Standard-ML-Revised/)
- [MLton reference implementation](/home/ellie/git/mlton/)
- [MLWorks reference implementation](/home/ellie/git/mlworks/)

Reduce each defect to a constrained SML example, identify the applicable Definition rules,
and inspect or compare the reference implementations where useful. Acceptance by a reference
compiler is supporting evidence, not a replacement for the Definition. Account for version
and supported-feature differences, particularly when consulting MLWorks.

Correct the general semantic mechanism rather than special-casing the triggering frontend
syntax. Add focused regressions for the valid case, equivalent derived forms, relevant invalid
cases and generalization/scope invariants. Keep implementation changes in authoritative SML,
regenerate WM, and run the relevant constrained self-check/bootstrap checks. Record the cause,
rule references, fix and validation in the portability notes before continuing the port.
New lowering design questions or missing Basis APIs still require discussion; ordinary
Definition-backed conformance corrections are part of this plan.

## Implementation sequence

At every step, apply the conformance-defect policy above when a failure originates in
SubsetML itself. Correct supported SML semantics before adding frontend workarounds or
continuing the affected lowering work.

1. Apply the projection receiver rule to frontend helpers as needed. Preserve the existing
   named-spread style; no lexer behavior change is intended.
2. Implement the general backend renaming system and migrate existing naming policies into
   it. Resolve the `Span` constructor collision through this shared mechanism, not a special
   constructor-only rename. Preserve checking and round-trip behavior.
3. Implement numeric/pinned pattern lowering and finish declaration-based positional record
   constructors in SubsetML's lowerer. Use a small translation representation where syntax
   must survive until binding resolution/checking, without building another WM type checker.
4. Implement resolved built-in Panic lowering and supply its Basis dependencies.
5. Generate MLton builds from the canonical import graph. Entry-driven reverse discovery
   now works through `sml-entry`, including a selected panic runtime closure. Header namespace
   aliases, private checking environments and generated SML comment imports are shared with
   explicit source-list translation. Generated private MLton build scopes are now implemented;
   explicit canonical native adapter selection is now implemented through repeatable
   `--native-adapter CHECKER.wm NATIVE.sml STRUCTURE` options, preserving private source
   import aliases and allocated backend identities without rewriting opaque native SML.
   Named imports in the surface AST and later/open-only imports still need their own
   supported-profile work.
6. Add a small native lexer driver and compare complete documents against the WM lexer.
   Implemented: `tools/native-lex.wm`, `adapters/portable/document.wm`, and the native build/parity
   scripts. Files decode as strict UTF-8; `--utf16le` retains raw units for damaged editor buffers.
   Full document parity passes for 126 raw-unit buffers and 121 UTF-8 files, including the
   example source, malformed input and prefix buffers. Invalid encodings fail before lexing.
7. Start parser implementation on the portable source/token boundary once the lexer baseline
   works. Keep parser design discussion separate from implementing the temporary lowerer.

## Validation and completion boundary

Use focused tests for changed lowerings, plus constrained SubsetML self-checking and compiler
bootstrap where relevant. Avoid treating a full repository test run as a prerequisite for every
small change. All translation errors must fail explicitly; no partial output or success fallback.

For the native lexer milestone, compare tokens, exact trivia spelling, UTF-16 positions, marks,
causal mark references and delimiter mates. Include EOF, CRLF, NUL, supplementary scalars,
lone surrogates, malformed escapes and damaged templates. Host/debug tools and explorer UI
remain separate consumers; native compilation does not require translating their JS/Deno APIs.

## References

- [Frontend conventions and ownership](README.md)
- [Portability status and type-dependent lowering audit](native-portability.md)
- [SubsetML native frontend decisions](../../../SubsetML/docs/frontend-v3-native.md)
- [SubsetML translation profile](../../../SubsetML/docs/translation.md)
- [Module loading contract](../../../SubsetML/docs/module-loading-plan.md)

## Implementation checkpoint and resolved naming decision

The initial projection constraints have been added to lexer helpers. Positional record
constructor generation is implemented in the SubsetML lowerer and tested for declared field
order, once-only left-to-right argument evaluation, generics and first-class references.
Numeric/pinned match patterns now lower through the shared resolver into structural matches
and ordered checks. Native regressions cover nested fallthrough, scope, equality, once-only
subjects and non-exhaustive Match failure. Numeric/pinned let binding patterns are explicitly
outside the current reverse profile. Built-in Panic lowering is now implemented with an explicitly selected source runtime.
The full source-list probe reaches a case-subject inference gap in pair; see the discussion
boundary in the native frontend decisions. That conformance defect is now corrected; the full
lexer translates and passes an MLton smoke probe. Entry-driven builds and native adapter
selection now work. Native driver tooling and complete document parity validation now pass.

The declaration-module translation probe exposed another backend naming issue:
`Source.Span` now generates a record constructor value `Span`, but SubsetML rejects binding
that spelling because it reserves an omitted SML Basis constructor (spec B1). This is not
missing record layout information or a missing Basis API. The discussion is resolved: use a
general binding-aware renaming system shared by lowering passes, including constructor references
and exports. The shared renaming pass is now implemented, and the source/mark/character declaration
modules translate successfully with hygienic constructor spellings. Do not relax SubsetML's
reserved-constructor rule or rename authored frontend declarations merely to bypass this
backend collision.

### Definition audit follow-up

The case-subject failure is a general SubsetML selector/closure conformance bug. The Definition
expands case into function application; both forms fail in the current checker despite being
accepted by MLton. A case-only expected-type change would leave the equivalent application and
whole-function constraints broken. An isolated compiler experiment instead propagated pending
selector receiver scope into field types before declaration closure; six focused acceptance/
rejection probes agreed with MLton, including captured-field monomorphism and independent local
polymorphism. The general selector scope propagation is now implemented in authoritative SML, with nine
MLton comparison regressions, constrained selfcheck and bootstrap validation. The detailed rules,
reproduction and correction are in the SubsetML native frontend decisions.

### Entry discovery checkpoint

SubsetML now supports `sml-entry OUTDIR [--panic-runtime R.wm] ENTRY.wm`. It discovers the
supported header import graph canonically, preserves private scopes and source import order,
and uses the same lowering as explicit source-list translation. Diamond initialization,
symlink identity, distinct same-basename modules, private scope and failure diagnostics have
focused regressions. The staged lexer translates from just the entry and selected runtime.
Generated private MLton build scopes are now implemented and native-tested for initialization,
identity and hidden dependencies. Explicit native adapter selection is now implemented and
native-tested for canonical identity, import aliases and hidden implementation structures.
The full lexer smoke builds/runs with generated adapter scopes. Native driver tooling and
full document parity checks are now implemented, as described below.


### Native lexer baseline checkpoint

`python3 scripts/build_frontend_v3_native.py` stages the authoritative Basis checker graph and
WM frontend sources, then uses entry discovery, native adapter selection and the generated
private MLB to build the lexer. It requires an already built SubsetML compiler and MLton;
no hand-maintained module order or replacement of generated files is needed.

`tools/native-lex.wm` reads strict UTF-8 files or raw little-endian UTF-16 units. BOMs remain
ordinary source units. Raw input preserves lone surrogates; malformed UTF-8 and odd byte
lengths fail explicitly. The portable document encoder emits ASCII JSON for every token,
trivia unit, UTF-16 position, mate, mark, recovery and causal reference.

`deno run -A scripts/check_frontend_v3_native.ts` builds once and compares 126 raw-unit and
121 UTF-8 complete documents with WM output, independently normalizing the WM runtime result
as a check on the shared encoder. The corpus covers EOF, CRLF, NUL, supplementary scalars,
lone surrogates, damaged escapes/comments/templates, realistic editor prefixes and the example
source. Existing lexer regressions and the vendored native Basis typecheck also pass.

The driver filename exposed invalid filesystem stems becoming target structure names.
`BackendNames.moduleHint` now normalizes those hints, with canonical allocation still resolving
collisions. Native regressions cover hyphen/underscore collisions, digit-leading and
punctuation-only filenames. Authoritative SML selfcheck, WM regeneration and bootstrap pass.
No Basis API expansion was required; the snapshot now includes existing process/I/O and numeric
formatting modules. Parser design remains a separate discussion before implementation.


### Compatibility findings from removed parser/schema probes

The removed speculative schema established that namespace imports, the generic
missing-slot kernel, and neutral token traversal can be translated. Distinct complete
record-label sets are required by current SubsetML R2. Embedded SML declarations were
removed from the WM profile, resolving the `open:` ambiguity. These findings and the
existing source-level conventions remain useful; they do not approve an AST schema,
closer-only recovery, or a parser implementation sequence.

Concrete grammar facts were moved to [grammar-audit.md](grammar-audit.md). New editor
work follows the worklist and is verified on WM first. Native compatibility checks can
be run independently of the working lexer baseline.
