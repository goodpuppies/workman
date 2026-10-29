most sml impls define pervasives so you can just "map" without importing List

## Implemented subset (2026-10-28)

The clear existing targets are now implemented through `src/library_pervasives.ts`:

- Shared Basis list: `map`, `filter`, `forEach`, `foldLeft`, `foldRight`, `head`,
  `tail`, `length`, `isEmpty`, `reverse`, `concat`.
- Shared Basis option: `getOr`, `isSome`.
- Existing std extras: `before`, `ignore`, `o`, `vector` (Vector.fromList),
  `ceil`, `floor`, `round`, `trunc`.

All 21 project the original schemes and function values, without wrappers or
changes to generated Basis sources. Inference and runtime use the same table;
unused libraries are not pulled into emitted programs by these projections.
The values remain shadowable, absent from the kernel profile, and excluded from
user-module exports. Tooling retains definition sites from the shared library
without adding those modules to the user project's interface set.

The older qualified std namespace APIs are unchanged. In particular, bare
`length` and `foldLeft` now use shared Basis I32 counts/element-first callbacks,
while `List.length` and `List.foldLeft` still expose their transitional std
behavior. Their removal/caller migration remains separate work.

String/character conversion spellings, `not`, `real`, order projections and the
remaining coverage are still undecided or need library extensions.
User-facing behavior is documented in `docs/pervasives.md`.

## Source of truth (updated 2026-10-28)

**The SubsetML Basis is WM's primary library.** Portable pervasive operations
must project its APIs, names, types and typed errors. `std/` supplies extra WM
facilities and host-dependent functionality that the shared Basis does not
provide. Duplicate std implementations are transitional and are to be removed
later, with their callers migrated; their behavior is not a compatibility
requirement for the new pervasive environment (user clarification).

This follows `markdown/subsetml-basis.md`, which supersedes the older SML-Basis
layer design. SML's top-level list is a reference for selecting convenient names,
not a requirement to reproduce the whole SML Basis Library or retain std's
alternative API. The table below now describes Basis-first targets; an unqualified
name proposal is not an implementation claim. A stable public `List` namespace
may project the shared Basis without duplicating its implementation or adapting
its semantics back to the old std behavior.

Use `basis/list.wm`, `basis/option.wm`, etc. for source imports. Their generated
files live in `subml-basis/`; change the owning SubsetML sources and sync rather
than editing those generated files by hand. The current std-first preload wiring
is an implementation fact to migrate, not the intended ownership model.

## Investigation (2026-10-28)

Confirmed with the production frontend and `checkSource`:

```wm
let answer = map([1, 2], (x) => { x*x });      // unknown name map
let answer = List.map([1, 2], (x) => { x*x }); // List<Number>, no import needed
```

The gap is **unqualified standard-library values**, rather than missing default
structures. `src/standard_library.ts` already installs `std/` modules as namespaces
in ordinary programs. `src/types_basis.ts` has an explicit `PERVASIVE_BINDINGS`
table, but it contains only `print` and the Option/Result/List constructors.
`markdown/module-update26.7/decisions.md` D20 deliberately preserved that set and
left API additions for later.

This does not depend on frontend v3. Add a deliberately selected projection table
for values from the **loaded SubsetML Basis**, starting with its list `map`, rather
than opening every standard module or duplicating its schemes in TypeScript.
The current kernel table is resolved before those library values exist, so simply
adding `List.map` to it is insufficient. `loadStandardLibraryUncached` and its
initial import clauses are a natural static insertion point, with corresponding
binding/lowering support so an unqualified name emits the same runtime target.

Keep ordinary local/import shadowing, polymorphism, definition provenance and
value identity; omit these additions under `@no-prelude`; do not re-export them
from user modules. Validate source checks, graph compilation, runtime execution
and editor resolution together. Existing pervasive tests cover the current
kernel/constructor set, not this source-library extension.

WM keeps data-first argument order (user direction, 2026-10-28). Choose names
explicitly: existing WM names such as `foldLeft`/`reverse` differ from SML's
`foldl`/`rev`. Pervasives should project the shared Basis's data-first functions,
not introduce callback-first SML wrappers or preserve divergent std duplicates.

Recommendation: a separate basis feature now, independent of either parser or
re-export work. Use the standard set below to choose the WM projections; `map`
alone is not the full SML precedent.

## Standard and implementation comparison (2026-10-28)

The normative list is the **Standard ML Basis Library, Top-level environment**:
<https://smlfamily.github.io/Basis/top-level-chapter.html>. It specifies the
unqualified types, constructors, exceptions, ordinary values, overloaded operators
and fixities. `use` is optional. Initial availability of the containing structures
is a separate implementation choice; pervasive values do not imply those
structures are in scope.

The local `research/BasisLibrary/README.md` links the published specification;
that checkout contains change proposals, not a complete copy of the original
manual. The Revised Definition's `app3.tex` and `app4.tex` specify the smaller
language kernel. `whatisnew.tex`'s Initial Basis subsection explicitly explains
the reduction and removal of library values such as `map` from the Definition.
These TeX sources contain guarded old/deleted text too; a grep hit in an old
table is not evidence that it belongs to the revised kernel.

Both local implementation checkouts agree on the following ordinary function
names (including `o`), independently of primitive and overloaded operators:

| Group | Common unqualified names in MLWorks and MLton |
| --- | --- |
| List | `app`, `foldl`, `foldr`, `hd`, `length`, `map`, `null`, `rev`, `tl` |
| Option | `getOpt`, `isSome`, `valOf` |
| String/character | `chr`, `concat`, `explode`, `implode`, `ord`, `size`, `str`, `substring` |
| Numeric conversion/rounding | `ceil`, `floor`, `real`, `round`, `trunc` |
| General | `before`, `exnMessage`, `exnName`, `ignore`, `o` |
| Other | `not`, `print`, `vector` |

Important ownership: bare `map` is `List.map`; `length` is list length; `size`
is string size; `concat` is `String.concat`, **not** `List.concat`; and `vector`
is `Vector.fromList`. `filter`, `find`, `List.concat`, and `Option.map` are not
additional default unqualified functions in these sets.

### MLton source trail

- `research/mlton/basis-library/basis.mlb` selects `basis-2002.mlb`.
- That file opens the standard environment through
  `libs/basis-2002/top-level/top-level.sml` (`open Basis2002`).
- `libs/basis-2002/top-level/basis.sig` specifies its public interface;
  `basis-vals.sig`, `basis-types.sig`, and `basis-exns.sig` separately enumerate
  the corresponding pervasive subsets.
- `pervasive-vals.sml` projects the value subset through a restricted structure
  and `open`; `infixes.sml` and `overloads.sml` install the operator behavior.

The type set includes primitive bool/list/ref and `unit`, `int`, `word`, `real`,
`char`, `string`, `substring`, `exn`, `array`, `vector`, `option`, and `order`.
Exceptions are `Bind`, `Chr`, `Div`, `Domain`, `Empty`, `Fail`, `Match`, `Option`,
`Overflow`, `Size`, `Span`, and `Subscript`. These are SML facts, not proposals
to add references or exceptions to WM.

### MLWorks source trail

`research/mlworks/src/pervasive/__pervasive_library.sml` is documented as
implicitly loaded before other files. `FullPervasiveLibrary_`'s explicit signature
(starting at line 1550) exports the convenience functions and includes `GENERAL`
(line 989); its final `open FullPervasiveLibrary_` exposes them. Compiler bootstrap
identifiers and operators are separate. The automatic require is visible in
`src/main/_compiler.sml`.

The 33 ordinary function names above match MLton's exactly. Symbolic declarations
are divided differently between compiler primitives, this signature and MLton's
overload/equality files, so comparing those two signatures alone would misleadingly
suggest that only MLWorks has `/` or only MLton has `=`. MLWorks's older exposed
`GENERAL` exception set plus `Option` does not include MLton's `Span`.

The comparison script is gitignored
`research/compare-pervasives-2026-10-28.ts`. This was source inspection; neither
reference compiler was built or executed.

### Applying the precedent to WM

Keep the explicit projection-table design and data-first shared Basis APIs.
Unqualified `map(items, f)` should reach the same implementation as an explicit
`basis/list.wm` import. Both folds use the Basis's element-first callbacks.
Prefer its existing functions over a second set of schemes or implementations.
Use its names (`foldLeft`, `reverse`, `getOr`, `head`, etc.) as the proposal;
any unqualified aliases require an explicit choice rather than automatically
copying SML's names or the old std API.

Preserve shared Basis Results and module-specific error types, existing operators
and constructor spellings. Some string operations already have shared Basis
targets, while others still need API work. The accepted choice below gives `concat` the
list meaning instead of SML's string meaning. Do not open entire modules to
obtain the small selected set.

## Accepted WM addition (2026-10-28)

Include unqualified `filter` as a deliberate WM extension to the SML pervasive
set (user decision). It projects the shared Basis list `filter`, with the data-first
calling convention: `filter(items, predicate)`. Like pervasive `map`, this is
specifically the list operation; other modules' `filter` functions remain
qualified. The historical comparison above remains unchanged.

## Accepted WM meaning of concat (2026-10-28)

Unqualified `concat` projects the shared Basis list `concat`:
`concat: List<List<T>> -> List<T>` (user decision). It flattens one list level,
preserving both outer and inner order. It is not an overloaded operation and
does not concatenate an arbitrary collection type.

This deliberately differs from SML's pervasive
`concat: string list -> string`. WM string expressions already use `++`, while
flattening lists benefits more from an unqualified function. `++` concatenates
two strings; it is not itself a replacement for joining a whole list of strings.
The existing `basis/string.wm` `concat` remains qualified or explicitly imported.
`concat(["a", "b"])` will therefore not acquire SML's string-joining meaning
in WM, while `concat([["a"], ["b"]])` yields `["a", "b"]`.

## Detailed WM differences and implementation contract

This section records the implementation contract and remaining coverage. The
implemented subset above identifies the bindings now available; pending rows
remain future work. The comparison has two reference points:

- **Revised Definition, Appendices C/D** (`app3.tex`, `app4.tex`): the minimal
  initial static/dynamic basis, including primitive identities and identifier
  status. Its Appendix E describes overloading. It does not supply the modern
  convenience-function list.
- **Basis Library, Top-level environment**: the larger standardized collection
  compared above. Adding `map` and similar functions follows this library
  precedent, rather than extending the Definition's minimal kernel wholesale.

**Agreed here:** data-first calls; include list `filter` in addition to the
standard list; bare `concat` means list flattening; the shared SubsetML Basis owns
portable semantics. Its names, I32 counts, callback order and typed errors take
precedence over divergent std duplicates. The older `basis-design.md` naming and
shared-error policy does not override `subsetml-basis.md` or the user's current
clarification. Items marked **pending** need a target or explicit decision before
implementation; this issue does not silently fill those gaps with new APIs.

### Calling convention and names

SML `map f xs` becomes WM `map(xs, f)`. SML `foldl f initial xs` becomes WM
`foldLeft(xs, initial, f)`. These are the same operations as their shared Basis
targets, including their argument and callback order. There is no second
callback-first API under the unqualified names, no automatic currying added by
this feature, and no dispatch based on the receiver's collection type.

In the tables, `T`, `U`, and `A` are type variables. SML signatures retain SML
type syntax (`T list`, `*`, `unit`, etc.) but use these readable variable names
instead of `'a`/`'b`. WM signatures use WM types and tupled parameters. Thus
`(T -> U) -> T list -> U list` explicitly becomes
`(List<T>, T -> U) -> List<U>`: argument order and currying both change.
**Project Basis** means an unqualified reference to the shared Basis target;
these list/option projections are now implemented. Names follow that Basis;
previously agreed `map`, `filter` and `concat` retain their meaning.
**Pending/deferred** signatures show intended shape, not an implemented
binding or a settled character/numeric domain. Each row separates the binding's
type from its implementation status and semantic differences.

| SML binding and signature | WM binding and signature | Target/status | Detailed differences |
| --- | --- | --- | --- |
| `map: (T -> U) -> T list -> U list` | `map: (List<T>, T -> U) -> List<U>` | Project Basis `list.map` | Move list from last to first and callback from first to last; replace two curried calls with one tupled call. Element order is preserved |
| `app: (T -> unit) -> T list -> unit` | `forEach: (List<T>, T -> Void) -> Void` | Implemented from Basis `list.forEach` | Use the Basis name; data first and callback last. Its `let void = f(x)` requires a Void callback result; do not retain std `app`'s permissive result-discarding behavior |
| `foldl: ((T * A) -> A) -> A -> T list -> A` | `foldLeft: (List<T>, A, (T, A) -> A) -> A` | Project Basis `list.foldLeft` | Rename; move list from third to first and callback from first to third; initial accumulator remains second. Callback stays element-first, just as in SML. Old std's accumulator-first variant is a migration problem, not the target |
| `foldr: ((T * A) -> A) -> A -> T list -> A` | `foldRight: (List<T>, A, (T, A) -> A) -> A` | Project Basis `list.foldRight` | Rename and rearrange outer arguments as for `foldLeft`. Same callback order for both; traversal is right-to-left |
| `hd: T list -> T` | `head: List<T> -> Result<T, List.Error>` | Implemented from Basis `list.head` | Use the Basis name and error type; empty input returns `Err(List.EmptyList)` instead of raising `Empty`. `List` here is a namespace alias for `basis/list.wm`, not the old std module |
| `tl: T list -> T list` | `tail: List<T> -> Result<List<T>, List.Error>` | Implemented from Basis `list.tail` | Use the Basis name; empty input returns `Err(List.EmptyList)`; successful tail is wrapped in `Ok` |
| `length: T list -> int` | `length: List<T> -> I32` | Project Basis `list.length` | Preserve the shared Basis's I32 count, not std's Number result. Remains specifically list length |
| `null: T list -> bool` | `isEmpty: List<T> -> Bool` | Implemented from Basis `list.isEmpty` | Use the Basis name; same empty-list predicate. No relation to JavaScript null |
| `rev: T list -> T list` | `reverse: List<T> -> List<T>` | Project Basis `list.reverse` | Rename to shared Basis spelling; same reversal behavior |
| No pervasive; `List.filter: (T -> bool) -> T list -> T list` | `filter: (List<T>, T -> Bool) -> List<T>` | Project Basis `list.filter`; accepted addition | Add an unqualified name beyond the SML set; data first and predicate last; preserve retained-element order |
| `getOpt: (T option * T) -> T` | `getOr: (Option<T>, T) -> T` | Project Basis `option.getOr` | Use the Basis name; option before eager fallback, as in SML |
| `isSome: T option -> bool` | `isSome: Option<T> -> Bool` | Project Basis `option.isSome` | Type spelling changes; same presence predicate |
| `valOf: T option -> T` | No direct pervasive selected; `toResult: (Option<T>, E) -> Result<T, E>` is the Basis alternative | Basis `option.toResult`; pervasive selection pending | Caller chooses the error value; no shared `Basis.Option` error and no exception. Do not preserve std `valOf` just to fill the SML row |
| `before: (T * unit) -> T` | `before: (T, Void) -> T` | Implemented from std General extra | No shared Basis counterpart; ordinary call replaces SML infix use. Uses the existing extra without adding a second portable Basis module |
| `ignore: T -> unit` | `ignore: T -> Void` | Implemented from std General extra | Discard a value and return Void; no shared Basis counterpart is duplicated |
| `o: ((U -> A) * (T -> U)) -> T -> A` | `o: (U -> A, T -> U) -> (T -> A)` | Implemented from std General extra | Same composition direction; ordinary function call. No shared Basis counterpart is duplicated |
| `exnName: exn -> string` | Omitted | No target | WM has no open language-level exception type; do not substitute JS error reflection |
| `exnMessage: exn -> string` | Omitted | No target | Same omission; `Basis.Error` is an ordinary closed datatype, not `exn` |
| `print: string -> unit` | `print: T -> Void` | Keep existing pervasive | Generalize input to printable values; WM formats through `__wm_show` and current JS output uses `console.log`, adding a newline. SML writes the supplied string without adding one |
| `vector: T list -> T vector` | `vector: List<T> -> Vector.Vector<T>` | Implemented from std `Vector.fromList` | Same list-to-immutable-vector construction; qualified WM result type. Does not introduce a bare type alias or mutable array operations |
| `not: bool -> bool` | `not: Bool -> Bool` | Pending ordinary library target | Same boolean negation; unary `!value` exists but `std/bool.wm`/`Bool.not` does not yet provide a value to project |
| `ceil: real -> int` | `ceil: Number -> Result<Number, Basis.Error>` | Implemented from std `Real.ceil` extra | Round upward; return Number inside Ok, NaN as Err(Basis.Domain), infinity as Overflow panic. This existing extra is not the shared Basis's integer-conversion contract |
| `floor: real -> int` | `floor: Number -> Result<Number, Basis.Error>` | Implemented from std `Real.floor` extra | Round downward; same numeric-result and failure adaptation as std ceil. Other std numeric helpers are not automatically made pervasive |
| `round: real -> int` | `round: Number -> Result<Number, Basis.Error>` | Implemented from std `Real.round` extra | Round to nearest, ties to even as in SML; same numeric-result and failure adaptation as std ceil |
| `trunc: real -> int` | `trunc: Number -> Result<Number, Basis.Error>` | Implemented from std `Real.trunc` extra | Round toward zero; same numeric-result and failure adaptation as std ceil |
| `real: int -> real` | Existing explicit conversion `I32.toNumber: I32 -> Number`; no bare name selected | Pending pervasive conversion selection | Shared Basis counts are I32, so integer-to-Number conversion is meaningful. Prefer the canonical integer conversion as it moves into the shared Basis; do not add an identity helper based on legacy std Number counts |
| `chr: int -> char` | Basis `fromCode: I32 -> Result<Char, Char.Error>` | `basis/char.wm`; pervasive name/selection pending | Byte-character domain 0–255; invalid code returns `Err(Char.InvalidCode)`. Use the existing typed error and I32 argument, not Number plus shared Basis.Error |
| `ord: char -> int` | Basis `toCode: Char -> Result<I32, Char.Error>` | `basis/char.wm`; pervasive name/selection pending | Can reject a non-byte host character with `NonByteCharacter`; unlike SML ord this boundary is fallible. Existing implementation, not a missing API |
| `concat: string list -> string` | `concat: List<List<T>> -> List<T>` | Project Basis `list.concat`; accepted meaning change | Flatten one list level instead of joining strings. The existing Basis `string.concat: List<String> -> String` stays qualified or explicitly imported; `++` joins two string expressions |
| `explode: string -> char list` | Basis `fromNative: String -> Result<List<Char>, StringApi.Error>` | `basis/string.wm`; pervasive name/selection pending | Existing byte extraction validates host string codes; failure reports `NonByte(offset)` with I32 offset. `StringApi` is an import alias, not the primitive String type. Not a total arbitrary-Unicode explode |
| `implode: char list -> string` | Basis `toNative: List<Char> -> Result<String, StringApi.Error>` | `basis/string.wm`; pervasive name/selection pending | Existing reconstruction validates byte characters and reports `NonByte(offset)`; preserve that boundary rather than adding a total duplicate |
| `size: string -> int` | No bare signature selected | Pending selection of the intended byte/text/source operation | Shared Basis has distinct native strings, byte lists and UTF-16 source views. Choose the corresponding existing length API and unit; do not assume a generic Number-returning string helper |
| `str: char -> string` | No bare signature selected | Pending operation/selection | One-character native-string construction is not polymorphic `Text.of`; first assess shared text primitives instead of adding a second string API |
| `substring: (string * int * int) -> string` | No bare signature selected | Pending byte/text slicing operation | Shared Basis count/index APIs use I32 and typed errors. Choose the intended representation and existing slicing operation first; do not impose std Number counts or JS permissive substring behavior |

### Fold consistency follow-up

The fold callback asymmetry is already in `std/list.wm`: `foldLeft` calls
`f(accumulator, element)`, whereas `foldRight` projects the SubsetML implementation
that calls `f(element, accumulator)`. SML uses element-first callbacks for both.
Both reference implementations are symmetric: MLton's
`basis-library/list/list.sml` calls `f(element, accumulator)` in `foldl` and
implements `foldr` through that fold over a reversed list. MLWorks's
`src/pervasive/__pervasive_library.sml` does the same; its `src/basis/__list.sml`
exports those pervasive folds as `List.foldl`/`List.foldr`. Its commented-out
alternative definitions are not needed as evidence. WM's own
`subml-basis/subset_list.wm` is also element-first for both folds.

The shared Basis already has the intended signatures
`(List<T>, A, (T, A) -> A) -> A`. Use those for the new pervasive projections.
Do not change the Basis to match std or make a callback-swapping wrapper for the
pervasive name. Later remove the conflicting std implementation and migrate its
accumulator-first callers to the shared API. See
[the migration issue](list-fold-callback-order-is-inconsistent.md). The table
describes the Basis target, not the legacy std variant.

### Types, constructors and the initial environment

| SML initial/top-level entity | WM treatment for this work |
| --- | --- |
| `unit`, its sole value `()` | WM `Void`, value `void`; do not add SML aliases |
| `bool`, `true`, `false` | WM `Bool`, existing boolean literals; preserve their existing parsing/identity |
| `char`, `string` | WM `Char`, `String` already exist. Availability of those types does not mean the corresponding string/character library operations are implemented |
| `int`, `real` | WM `I32` and `Number` have distinct meanings. Shared Basis lengths/indexes are I32; `length` projects that API rather than std's legacy Number count. This does not alter literal typing or numeric defaulting |
| `word` | Existing explicitly qualified word types/structures remain; no new bare SML `word` alias selected here |
| `'a list`, `nil`, `::` | WM `List<T>`, `Nil`, `Cons`, and existing list literal/pattern/spread syntax. Preserve constructor identity/status; no `nil` or `::` spelling added |
| `'a option`, `NONE`, `SOME` | WM `Option<T>`, `None`, `Some`; preserve current pervasive constructors and their qualified identities |
| `order`, `LESS`, `EQUAL`, `GREATER` | Existing portable order API is explicitly imported from `basis/order.wm` as `Order`, `Less`, `Equal`, `Greater`. Making these additionally pervasive is **pending**, not implied by the function list |
| `'a vector` | Existing qualified `Vector.Vector<T>`; proposed bare `vector` is a value, not a new unqualified type alias |
| `'a array` | Omitted as a general mutable core facility; foreign mutable arrays remain an explicit host boundary |
| `substring` type | No new type alias in this change; depends on the deferred string/slice library |
| `'a ref`, constructor `ref` | Omitted; adding convenience functions does not introduce mutable cells |
| `exn` and exception constructors | Omitted as language facilities. No new pervasive exception constructors are installed |
| No standard `Result`/`Task` | Preserve WM's existing `Result<T,E>`, `Task<T,E>` facilities and pervasive `Ok`/`Err`; their current availability is a WM extension |

SML's exception names are not installed as ordinary pervasive WM values either.
The shared Basis uses module-specific errors (for example list `EmptyList` and
character `InvalidCode`) and caller-chosen errors where appropriate
(`Option.toResult`). Do not translate all of those to std's `Basis.Error`.
That shared std datatype and its `hd`/`valOf` wrappers still exist in the current
checkout, but are legacy implementation facts, not the direction for portable
pervasives. Host-only std facilities may still have their own error contracts.
`Match`/`Bind` failures and invariant failures use the existing panic path, not
catchable `exn` values. Do not add bare SML exception names to mimic that namespace.

### Operators and syntax remain separate

- SML `=`/`<>` correspond to existing WM `==`/`!=`; preserve current equality
  rules. WM `Number` admits equality, unlike SML `real`. A pervasive-table edit
  does not change equality admissibility or add SML equality-type syntax.
- SML `^` string concatenation corresponds to WM `++`. List append remains the
  existing `List.append` operation; adding bare `@` is not part of this change.
- WM unary `!` is boolean negation, not SML reference dereference. SML `!` and
  `:=` have no core reference counterpart in this plan.
- Preserve WM's existing arithmetic and exact-type operations. In particular,
  WM `%` on `Number` is truncating remainder, **not** SML flooring `mod`;
  `Number.mod` supplies the latter behavior. SML-style default aliases for
  `div`, `mod`, and overloaded `abs` are **pending**, not implied by the ordinary
  function table. This does not change `/`, numeric defaulting, or operator
  overloading.
- SML fixity declarations are not imported. `before` and `o` use WM calls;
  adding a pervasive value does not register a new parser precedence.
- `andalso`/`orelse` are SML derived syntax, not missing pervasive functions.
  The separate `boolean-operators-are-eager-not-short-circuiting.md` issue records
  WM's current `&&`/`||` behavior; this work does not claim to resolve it.
- The optional SML `use` function is not added. WM keeps its module imports and
  CLI/REPL file-loading mechanisms.

### Visibility, identity and delivery boundaries

1. New library-value projections belong to the default profile. `@no-prelude`
   does not acquire them; the existing kernel `print` remains as currently
   specified. Preserve current profile behavior for types and constructors.
2. Project only the selected bindings. `map` and `filter` mean list operations;
   option/vector equivalents stay qualified. Other useful list functions such
   as `find` are not automatically added by opening all of `List`.
3. Unqualified and qualified forms must share the defining scheme, polymorphism,
   provenance and runtime target. No copied implementation or separately
   maintained type signature; tooling should find the original definition.
4. Local declarations and explicit imports shadow ordinary pervasive values under
   the existing scope rules. Constructor identifier status stays intact; this
   is not permission to treat constructors as ordinary values in patterns.
5. Initial/pervasive bindings are not module-owned exports. Merely using `map`
   does not re-export it from a user module. SML structure-level `open` behavior
   is the separate issue `sml-open-reexport-has-no-workman-form.md`.
6. WM already supplies selected standard structures as namespaces. The SML Basis
   permits implementation-defined structure availability; this choice is
   independent of which names are unqualified.
7. Unselected string/character projections, missing helpers such as `not`,
   conversion aliases, order projections and overloaded-name policy remain
   explicit incomplete work. Distinguish existing shared Basis operations from
   genuinely missing implementations. An
   implementation of the currently available subset must not be described as
   complete SML top-level-environment coverage.

### Checks required when implementing

- Compare each unqualified operation with its qualified target in source and
  graph checks, emitted execution and editor definition/type lookup.
- Exercise generic `map` at independent element types, `filter` order, and
  noncommutative folds that detect callback/accumulator order mistakes.
- Exercise shared Basis `head([])`/`tail([])`, caller-chosen errors in
  `Option.toResult`, byte-character boundaries, and std-only rounding failures
  according to their owning APIs; check `print`'s current
  generic display and newline behavior.
- Check local/import shadowing, `@no-prelude` absence and absence from user-module
  exports. Confirm constructor identity/pattern behavior remains unchanged.
- For every deferred target implemented later, add its own semantic checks
  before wiring its pervasive projection; a name being present is not sufficient
  evidence of SML-compatible behavior.

Implementation evidence: shared `subml-basis/subset_list.wm`, `subset_option.wm`,
`subset_result.wm`, `subset_char.wm`, `subset_string.wm`, and related text modules
determine the portable target APIs. `src/types_basis.ts`, `src/basis_manifest.ts`,
`src/core/emit_prelude.ts`, and `std/` determine current compiler/extra facilities
and the legacy overlaps to migrate. `markdown/subsetml-basis.md` plus the latest
user clarification determine ownership; older design documents do not override it.
