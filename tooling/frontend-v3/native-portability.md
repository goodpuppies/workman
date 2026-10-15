# Native frontend plan

Priority: frontend completion and WM execution come first. SubsetML/MLton remains
a target; record compatibility blockers and continue independent editor work.

Status: the lexer translates through SubsetML, builds with MLton, and passes complete
WM/native document parity. Its file driver accepts strict UTF-8 or raw UTF-16 units.
The speculative parser and surface schema have been removed; their former portability
success does not constrain the new design. Follow [worklist.md](worklist.md).

## Boundaries

`src/source/` owns positions and the marking kernel. `src/lexer/` owns lexical types
and algorithms. `src/syntax/` contains neutral cursor/keyword helpers. The new editor
modules remain WM-authored; transport and presentation belong in adapters/tools.
Generated SML and staged build artifacts are disposable. Native lexer builds remain
independent of editor modules.

## Current editor checkpoint

The WM diff/additive/preview closure translates and MLton-typechecks. The new canonical
projector/View closure does not yet translate: SubsetML reports `argument of expr:
expected Writer * 'a, found Writer * Expr`. Explicit types on recursive `expr` and
`statement` parameters did not resolve it. WM compilation and the direct projector
tests pass. Record this as a deferred compatibility blocker; continue canonical parser
assembly on WM without splitting implementations or restoring the rejected schema.
Investigate generic higher-order `items` specialization/recursive nominal types in a
focused reproduction when native work resumes; the exact root cause is not established.

## Existing agreements

The [SubsetML native decision record](../../../SubsetML/docs/frontend-v3-native.md)
records the relevant lowerings. Keep their semantics while implementing them:

- Invariant `Panic` lowers to `SubsetProcess.panic`: evaluate its message once, attempt to
  write it with a newline to stderr, then exit unsuccessfully on the native target. The Basis
  function and resolved built-in lowering are implemented.
- Numeric and pinned-value patterns lower to ordered conditional checks, with correct
  fallthrough. Do not change SubsetML to accept real literal patterns.
- Nominal record spreads name the record layout. Frontend updates already follow this rule.
- Preserve eligible let-polymorphism and source evaluation order when lowering records/carriers.

Those agreements do not establish that every transformation is implemented. The sibling
repository's record/carrier work and its remaining module translation work are separate
from moving files here.

## Translation probe

The lexer closure is, in dependency order:

```text
src/source/source.wm
src/source/mark.wm
src/lexer/token.wm
src/lexer/character.wm
src/lexer/reader.wm
src/lexer/read.wm
src/lexer/string.wm
src/lexer/trivia.wm
src/lexer/pair.wm
src/lexer/lexer.wm
```

The pre-integration `../SubsetML/bin/subsetml sml OUTDIR FILE...` probe reported:

- `character.wm`: the JS import has no SubsetML counterpart.
- `reader.wm`: member pipes in string access are not recognized by reverse translation.
- `string.wm`: real constants cannot occur in SubsetML patterns.
- `lexer.wm`: `Char.classLetter` is a pinned Workman value, not a SubsetML constructor pattern.
- Subsequent translation/checking reports unresolved reader/character dependencies and `Panic`.

Character lookup and reader slicing no longer contain JS imports/member pipes. The JS adapter
and the existing Basis text-host adapter remain host-specific entry points; native builds must
supply their existing SML counterpart. Reverse source-list translation now preserves canonical import identity and header namespace
aliases, checks each module in its direct import environment, and emits SML import metadata.
Numeric/pinned patterns, Panic, entry-driven discovery and scoped MLton build generation
are now implemented. The old probe failures below describe the pre-integration state.

These were a first probe, not an exhaustive compatibility list. Some errors follow from
rejected dependency modules. The tool can print translation errors while exiting zero;
a successful process exit alone does not prove that a complete lexer was generated.
Source-list translation is also not graph-driven MLton build generation.

## First design boundary: source text

Preserve the current contract: spans count UTF-16 code units, source spelling is lossless,
and lone surrogate units are valid input that the lexer can diagnose. SubsetML's byte
`char` and native SML byte strings are not interchangeable with JS strings. Strict UTF-16
codecs reject lone surrogates and must not silently normalize or replace editor input.

The initial Basis implementation now exists in `../SubsetML/src/subset_utf16_source.sml`:
a balanced raw-unit tree, shared slice views, explicit Option lookahead, and strict UTF-8/scalar
conversion. It now backs frontend-v3's reader. The core lexer consumes it directly; the JS adapter
constructs it once from the original buffer. This does not yet make the lexer native.

The implemented direction and remaining frontend integration choices:

- Represent source as an immutable index of numeric UTF-16 units, each integral and in
  0..65535. Use a balanced source tree to avoid repeated linear list indexing.
- Construct the index once at the host boundary. JS extracts its raw string units;
  native file input passes through an explicitly selected byte decoding policy.
- The initial implementation follows the source-built byte index's balanced-tree design,
  with one numeric-unit leaf per unit. Packed storage or sequential cursors can be considered
  later without requiring host indexing.
- Lexer internals operate on unit codes and ranges, not one-character JS strings.
  Trivia spelling needs a portable source slice or unit sequence; explorer transport
  reconstructs its existing JS string at the boundary.

The Basis contract and remaining driver decision are separate:

1. Optional lexer lookahead now uses `peek` and explicit `None` cases. Required reads
   assert established integral/in-bounds positions. The former NaN-based EOF probes are gone;
   a valid unit such as NUL is never EOF.
2. What is native file input? Strict UTF-8 files are a reasonable initial driver policy;
   arbitrary UTF-16 units are still needed for editor/parity fixtures. A file decoding
   error belongs to the driver, not a fabricated successful lexical document.

Trivia now stores a source slice view. Fixed symbols/comment prefixes compare short numeric
unit lists instead of host strings. Existing WM/explorer contracts and raw-unit/JS-entry parity
are tested, including EOF, malformed escapes, CRLF, NUL and lone surrogates. Native execution
and its comparison transport remain pending. Keeping UTF-16 positions requires neither UTF-16
files nor extending SubsetML's language.

## Milestones after the representation decision

1. Implemented: portable source reader, source-view trivia, JS string adapter and a self-contained
   generated Basis snapshot. `.wm` algorithms remain the frontend's source of truth.
2. Header namespace alias/module identity resolution is implemented in reverse source-list
   translation. Teach reverse translation the agreed pattern/Panic lowerings; imported nominal
   record layouts now use the resolved backend names. Prefer fixing the translator to
   hand-rewriting every portable Workman pattern into SML-shaped source.
3. Generate the lexer closure, target adapters and MLton build scopes. Use a small native
   driver; the Deno filesystem walker and browser UI do not belong in that build.
4. Run the same vectors through WM and native lexers and compare complete documents:
   token kinds, trivia spelling, UTF-16 positions, marks, mark identity references and mates.
   Include CRLF, supplementary scalars, lone surrogates, EOF lookahead and damaged templates.
5. Add the parser on the portable source/token boundary once the lexer baseline works.

A successful compile is a milestone, not evidence of identical behavior. There is no new
recovery policy, ignored translation error or native-success fallback in this plan.


## Integration fallback audit

EOF lookahead has explicit `None` branches: it ends a run, fails a spelling predicate, or
marks a partial escape damaged according to the existing contract. Required source reads
and ordered slice boundaries retain invariant panics. Fixed-symbol lookup's `None` means
that the unit sequence is absent from its complete table. No valid unit substitutes for EOF,
no Unicode replacement is introduced, and no codec error is ignored. There are no new typed
holes or `Result.debug` calls in frontend `src/`; existing host/debug consumers remain separate.

## Type-dependent lowering audit (2026-10-11)

Scope: WM-authored `src/`, with adapters/tools distinguished from the native lexer closure.
The generated Basis snapshot is already authored in constrained SubsetML and can be consumed
as SML by the native build. This is a source/translator audit, not a successful full lexer build.

- Equality is type-dependent. `reader.isCode` compares numeric units, whereas `pair.append`
  compares `Token.PairGroup` variants. Reverse translation needs real comparison for the former
  and SML equality for the latter. `Translate.realEquality` already uses inferred operand types;
  a syntax-only blanket rewrite is incorrect. A generic equality helper generalized before its
  numeric callers cannot be repaired by looking at later calls; frontend helpers should retain
  sufficient numeric constraints within their declarations.
- Record projections are a source-inference compatibility gap. `reader.peekByOne` selects
  `reader.source`; `read.lexicalMark` selects `span.startPos.index`; `pair.finish`'s local
  `stampMarks` selects `mark.causedBy`. WM can identify a nominal receiver from visible record
  declarations, while SubsetML's SML-style selectors need the receiver type established by
  ordinary constraints at the declaration boundary. Inference in the target checker does not
  reproduce WM's record-name disambiguation. Explicit receiver types or another independent
  constraint may be needed until a WM-aware lowering can carry resolved receiver information.
- All seven record updates name their layouts. No executable anonymous record literal or
  record pattern occurs in `src/` (mentions in token comments and Surface AST constructors
  describe syntax, rather than using it). Punning alone expands to `field = field` without
  inference; anonymous spread needs the full record layout. Naming the layout supplies it.
- Positional record construction is another unimplemented lowering, but needs declaration
  resolution rather than inferred types: `Source.Position(...)`, `Token.Token(...)`, `ReadResult(...)`
  and similar calls have an explicit owner/layout. The current translator emits record type
  declarations but no constructor function. This gap is now implemented: declaration-based constructor functions preserve field order,
  generic types and first-class references. Shared backend renaming handles reserved spellings
  such as `Span` before checking. First-class record constructors should be covered too.
- Numeric literal patterns have known real type and can lower without general inference,
  including literals nested in lists/constructors. Pinned patterns need binding resolution
  and the correct equality operation. The current `Char.classLetter` family consists of
  explicitly numeric constant bindings; arbitrary pinned values would require type information.
  Variant constructor patterns require constructor identity, rather than a numeric comparison.
  This match lowering is now implemented in SubsetML, with native tests for ordered nested
  fallthrough and scope. An isolated lexer probe using the SML checker text adapter now reaches
  the expected remaining built-in Panic gap.
- Function-field alias/copy generalization is an existing type-dependent translator pass
  (`Translate.portableValues`), but the authored frontend currently has no function-valued record
  fields or carrier-copy use. Local aliases such as `let pos = trivia.newPosition` select data,
  not polymorphic functions. Keep this distinction when adding parser combinators/carriers.
- `Panic` needs resolved built-in identity and an ordinary argument type check; its translation
  to the existing process function does not need the surrounding expression's inferred result type.
  Resolved built-in lowering is now implemented with an explicitly selected canonical runtime
  and private generated dependencies. Core `src/` uses no pipes, JS member access, JSON assertions or FFI imports. Those constructs
  remain in host/debug consumers, whose native treatment is a separate boundary.
- A now-removed schema probe established namespace import support, distinct record
  label-set conventions under R2, and the removal of embedded SML declarations to
  resolve `open:` ambiguity. These are compatibility findings, not approved AST shapes.

Minimal temporary probes confirmed: explicit named record punning translates; an unannotated
standalone `pos.index` helper fails unresolved selector checking; a positional record constructor
call fails unresolved value checking; and a generalized equality helper subsequently applied to
real arguments fails SML equality checking. No frontend implementation changes were made by this audit.

The updated source-list probe reaches pair's nested `token.span.endPos.index` inside a case
branch despite an existing typed subject. A plain SML reproduction compiles in MLton and
fails SubsetML checking. This case-subject propagation gap is recorded in the
[SubsetML native decisions](../../../SubsetML/docs/frontend-v3-native.md); the general selector scope correction is now implemented. The full lexer translates and
passes an entry-driven MLton smoke build with explicit native adapter selection. Native driver tooling and complete document parity now pass; see the lowering plan and
README for the build/input contract. Pair/string/trivia now import the existing portable
list operations explicitly, with no Basis expansion.
