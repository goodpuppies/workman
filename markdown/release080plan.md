# 0.8.0 release plan

Status: 2026-11-17, in progress. Done: 1 (`viaErr`), 2 (collection names), 3 (missing counterparts), 4 (operator table), 5
(SubsetML numbers), 6 (scope expansions: `local`, `op`, alias modules, sized numbers), 7 (private declarations),
9 (source-owned Option/Result definitions), 10 (consistent list display). Step 8 is under
way: the [gap audit](subml-gap-audit.md) records what porting frontend-v2 to SML added. Nothing
is tagged or published.

0.8.0 is a minor release with breaking API changes. It ships the numeric work since 0.7.0
(`Int32`/`Real64`/`Real32` names, Basis-owned names, `Int32` literal default), extends the
operator table to the sized numeric types, makes a naming pass over the Basis and std, adds
private declarations, and expands SubsetML with the forms these need. The
SubsetML Basis is primary and std holds extra facilities
([list-fold issue](issues/list-fold-callback-order-is-inconsistent.md)), so Basis renames are
made in the SubsetML `.sml` sources and synced with `scripts/sync_subml_basis.ts`. SubsetML's spec
and translator move with WM. The release routine is [RELEASE.md](RELEASE.md).

Renames are hard renames without compatibility aliases; the release notes list each one as an
upgrade step.

## 1. `viaError` → `viaErr`

Matches `Err` and `mapErr`. Applies to `Monad.viaErr`, `Result.viaErr`, `Task.viaErr`, the
`Carrier` record field, SubsetML's `SubsetResult.viaErr`, and every doc, example, test and tool
that uses them.

## 2. One modern name per collection operation

Modern names win over SML's where the two differ. The List names in the SubsetML Basis are
the reference; the SML-shaped `Vector`, `VectorSlice`, `Word8Vector` and `Word8VectorSlice` move to
them.

| Concept | Now | 0.8.0 |
|---|---|---|
| left/right fold | `foldl`, `foldr` (vectors), `fold` (Map) | `foldLeft`, `foldRight` |
| indexed fold | `foldli`, `foldri` | `foldLefti`, `foldRighti` |
| iterate | `app` (vectors) | `forEach` |
| indexed iterate | `appi` | `forEachi` |
| indexed map, find | `mapi`, `findi` | unchanged |
| index | `sub` (vectors) | `at` |
| comparison by element order | `collate` (List, vectors) | `compareWith`, as in `SubsetBytes` |

Fold callbacks are element-first, `(T, A) -> A`, for both directions, which resolves the
[list-fold issue](issues/list-fold-callback-order-is-inconsistent.md): std List's `foldLeft`
stops overriding the Basis order. `Map.foldLeft` passes `(key, value, acc)`.

`getItem` (std List, VectorSlice) stays: it returns the first element and the rest, as in SML,
not an indexed element, and `List.at` already indexes.

Indexed variants keep the trailing `i` used by SML, OCaml, Grain and F#. Check the full member
lists during implementation for further SML spellings (`tabulate`, `concat`, `exists`/`all`
stay).

## 3. Missing counterparts

- Add `Option.isNone` and `Result.isErr` to the SubsetML Basis beside `isSome`/`isOk`.
- Add `Result.fail` beside `Result.succeed`, matching `Task.fail`.
- Remove `Result.toBool`.

## 4. Table-driven operator overloading

`+ - * < <= > >=` accept only `Int32` and `Real64` (`OPERATOR_NUMERIC_TYPES`, `src/numeric.ts`).
The other sized types need named functions such as `Word8.add`. Follow the Definition's
Appendix E: a fixed, hardcoded table of overloaded operators and the types each accepts, using
the Basis classes `realint`, `wordint` and `num`. Not user-definable overloading.

| Operators | Types |
|---|---|
| `+ - *`, ordering | `Int32`, `Int64`, `Word8`–`Word64`, `Real32`, `Real64` |
| unary `-` | `Int32`, `Int64`, `Real32`, `Real64`: Appendix E's `~` is `realint`, so words are excluded |
| `/` | `Real32`, `Real64` |
| `%` | all of the above |

Defaulting stays as in 0.7.0+: `Int32` for integer literals, `Real64` otherwise and in `@gpu`.

### Integer `%` (decided 2026-11-16)

`%` accepts every numeric type and truncates toward zero for all of them: the remainder has the
dividend's sign, as `Real64`'s existing `%`, JavaScript, Rust and C do. `/` stays real-only, as in
SML, so integer division is never implicit. `Int32.div`/`Int32.mod` (flooring, SML's `div`/`mod`)
remain the named forms. No new keywords.

- Today `%` is fixed at `(Real64, Real64) -> Real64` (`basisOperatorEnv`, `src/types_basis.ts`),
  so it pins unconstrained operands to `Real64`. Afterwards they default to `Int32`, as with `+`:
  `n => n % 2 == 0` becomes `Int32 -> Bool`. Callers that pass a real get a type error, not a
  different result. Check every example for an unannotated `%` that relied on the old pinning.
- `Real64` results are unchanged; the emitted JS `%` is the same.
- Integer runtime: a zero divisor must fail as `Int32.mod` does, never yield `NaN` (JS `5 % 0`).
  `-2147483648 % -1` must give `0`, not JS `-0`. BigInt-backed `Int64` and `Word` types truncate
  already, but a zero divisor throws a JS `RangeError` and needs the same failure.
- SubsetML: integer `%` is SML's `Int.rem`. Add `Int32.rem` to the SubsetML Basis beside `div`
  and `mod`, and translate between it and `%` in both directions.

## 5. SubsetML: numbers in step with WM

- `docs/translation.md#integers` says Workman integer literals default to `Real64.Real`; since
  `1bafa71` they default to `Int32`. Update the spec and translation docs.
- The SML → WM translator ascribes every int constant (`(42: Int32.Int)`). Under the new
  default the ascription is redundant where the context is `int`; drop it.
- WM → SML: a bare WM integer literal in a `Real64` context (`let x: Real64 = 1;`) must become
  an SML real constant. Decide whether the reader needs the inferred type or rejects this form.
- Extend the overloading rules in `docs/spec.md` §5 and §9 with the operator table of step 4.
  SubsetML has only `int` and `real` until step 6, and its rules already match the table for
  them (`%` arrives as `Int.rem`), so the spec's table grows with the step 6 types.

## 6. SubsetML scope expansions

Each adds a Standard ML form SubsetML currently omits; none changes the meaning of an accepted
phrase, so the language conformance rule in `docs/spec.md` §1 still holds.

| Expansion | Why |
|---|---|
| `word` types (Word8–Word64) and `Int64`/`Real32` structures | Step 4's operator table must translate; resolves the `word` open question in `docs/spec.md` §11 |
| `local dec1 in dec2 end` | Private helpers and private `open`; fixes SubsetML's [private-imports issue](../subm/SubsetML/markdown/issues/private-imports.md) and is the translation target for step 7 |
| top-level structure aliases (`structure A = B`) | Resolves the §11 open question; WM already expresses it with `export from … import * as` |
| `op` | Passes an operator as a function value (`op +`); needs a WM spelling for an operator value |

Done 2026-11-16. Decisions made on the way: a top-level alias is a whole-file alias module
(`export from "./b.wm" import *;`); Word64, Int64 and Real32 build with MLton only, since MLWorks
lacks them; WM decimal literals now take `Real32` from context, as Appendix E's real constants do
(`@gpu` code keeps them `Real64`); `Int64.div`/`Int64.mod` were added to std for `wordint`.

## 7. Private declarations

Imports are already private unless written `export from`, but every top-level `let`, `type` and
`record` is exported. That made helpers such as `Map.rotateLeft`, `Map.numberCompare`, the JSON
parser internals and `List.joinRaw` public API. Decided 2026-11-16:

```wm
private let rotateLeft = …;
private let rec go = … and step = …;
private type Tree = | Leaf | Node<Tree, Tree>;
let set = (map, key, value) => … rotateLeft(…) …;
```

- `private` is a modifier on a top-level declaration, as `export` is on `from … import`. It is a
  contextual keyword, recognized only at the start of a declaration, so it stays usable as a name.
- A private declaration is visible in the rest of its module and invisible to importers. The
  default stays public.
- On `let rec … and …`, `private` applies to the whole group; there is no per-binding form.
- A private type makes its constructors private too.
- A public binding whose type mentions a private type is an error, at the binding. A type no
  importer can name must not appear in the public surface.

### SubsetML translation

`private` translates to step 6's `local`. Declarations are sequential in both languages, so each
private declaration wraps the rest of the structure, and several private declarations nest:

```sml
structure Map = struct
  local val rotateLeft = fn … in
    val set = fn …
  end
end
```

A private import becomes `local open X in … end`. The reader inverts both: the declarations in
`dec1` become `private`, and a `local open` becomes a non-exported import.

SubsetML adds the leak rule as its own restriction: a type declared in a `local`'s `dec1` may not
occur in the type of a binding in its `dec2` that remains visible outside the `local`. The
Definition allows the escape, so this only rejects phrases, as the conformance rule permits.

Done 2026-11-16. WM parses, formats and checks private declarations; SubsetML translates them
to and from `local`. Std List, Map and JSON helpers are private, with pinned public interfaces
updated. The frontend-v2 grammar inventory and structural golden include `PrivateDecl`.
The two pre-existing [JSON test failures](issues/json-test-library-boundary-failures.md) remain
tracked separately.

## 8. Close WM → SubsetML translation gaps

From the [translation gap audit](subml-gap-audit.md): cover groups A, B and C, so that ordinary WM
code translates to SML under two rules: annotate a record receiver whose type the declaration
does not otherwise fix, and keep record label sets distinct (R2).

- A, syntax: named imports (`import { a, B }`), computed patterns and cond-style matches, pipeline lambdas and `==>`, capture
  clauses, lambda result annotations, piped conditionals, inline record types, and the reader's
  grouped-argument space application defect.
- B, using the translator's existing inference: record member pipes on records, record updates
  without a layout name, template strings, `%`, default-only arithmetic, carrier groups, and
  `Monad`, with the `Carrier` record type and `SubsetResult.carrier` moved into the Basis.
- C, environment: `Result`/`Ok`/`Err` and a default panic runtime.
- The frontend-v3 View inference defect and the stale `SubsetHost.success` in pakman-subsetml.

Progress 2026-11-16: pakman-subsetml uses integer exit codes and the current shared Basis APIs;
its native lifecycle/refusal/host tests pass. Postfix type annotations fix grouped space-call
arguments, with JS/native parity coverage. Bare Option/Result constructors now use the source
Basis with `--basis`, and the private leak check permits imported types. The frontend-v3
parser/projector/View closure builds with MLton and passes eight WM/native cases after scoping
the generic helper's type parameter. See the gap audit's follow-up for details. The source-owned
Option/Result work is recorded in step 9.
The native graph still needs [bootstrap pervasive lowerings](issues/wm-native-output-still-uses-bootstrap-pervasives.md)
to pass `check-portable`; the [WM test runner identity/exit-status failure](issues/wm-test-runner-reports-distinct-test-identities.md)
was resolved by using the public testman import consistently. The malformed-suite status test
passes; the frontend-v3 WM suite now passes all 61 cases.

Progress 2026-11-17: computed/cond-style patterns preserve guard order, effects and outer scope;
implicit pipeline lambdas (including `==>`), capture-clause syntax, piped conditionals and record
member pipes translate. Capture contracts remain WM's validation responsibility; capture lists
are parsed and erased in SML. `sml-entry --basis DIR` defaults Panic to the supplied Basis process
module, with explicit overrides retained. Native/WM pattern and pipe parity, translation tests,
portable selfcheck, round trips, backend-name tests and native panic checks pass.

The list-display and validation follow-up passes the collection/library regressions, generated
parser checks and TypeScript check. Frontend-v3 passes 61 WM tests and ten WM/native parity
cases. Pakman passes all 92 WM tests with a writable temporary cache and host access for its
bubblewrap-isolated build fixtures; the restricted execution sandbox blocks their namespace
socket setup before the callbacks run.

Progress 2026-11-17 (later): template strings and unnamed record updates translate. A
`${ e }` becomes the text of e by its inferred type (string, char, int, Int64, real or bool;
SML's number text differs from WM's display for negatives and some reals). `.{ ..p, x = e }`
takes p's inferred record type and expands after elaboration. SubsetML's `--basis` default Panic
runtime now applies only to graphs that use Panic, which fixed the MLWorks host test; the
kernel-portable test lists the new `basis_source.sml`. The full SubsetML suite passes.

Remaining step-8 features: inline record types, carrier groups and portable Monad/Carrier
support. The restricted-profile bootstrap-pervasive lowering
work also remains; these native tests use the supported target Basis environment.

## 9. Chore: `Option` and `Result` are Basis types, defined once

The Definition's initial basis has `bool`, `list`, `unit`, `int`, `real`, `string`, `char`, `ref`
and `exn`. `option` comes from the SML Basis Library, and `Result` is not in SML. Both belong in the
SubsetML Basis source only, and today they are handled differently:

- SubsetML's checker still seeds SML's `option`, `NONE`/`SOME` and an `Option` structure
  (`src/basis.sml`, bootstrap compatibility). The Basis datatype in `subset_option_value.sml`
  shadows it; `Result` has only its Basis datatype. Translated WM code therefore finds `Some` but
  not `Ok` (gap audit group C). Remove the seeded `option`; the translator supplies the
  constructors of both Basis datatypes to the code it translates.
- `Option`'s type lives in `subset_option_value`, apart from its functions, to avoid an import
  cycle; `Result`'s type shares `subset_result` with its functions, which also re-exports
  `SOME`/`NONE`. Give `Result` the same layout (`subset_result_value`), and use step 6's `local`
  so neither functions module re-exports the other's type.
- WM defines each type twice: the full descriptor with constructors in `src/basis_manifest.ts`,
  and the `// @basis-type` source declaration, checked against it in `src/infer/decl.ts`. The
  compiler needs to recognize both types (FFI results and nullables, `Task`, carrier groups), but
  not to define them. Keep only identity and arity in the manifest, as a lang item, and take the
  constructors and their runtime names from the Basis source.

`List` and `Bool` stay built in: they are in the Definition's initial basis and have syntax.

Separate decision: the std APIs differ beyond what errors explain. `Result` has `succeed`,
`carrier`, `map3`/`map4`, `all` and `debug`; `Option` has `forEach` and `join`. An `Option.carrier`
would make `Monad.traverse(Option, …)` and `Option|a, b|` work.

Progress 2026-11-16: the source layout is split. `SubsetResultValue` owns Result's datatype;
`SubsetResult` re-exports its own type/constructors and keeps its Option open local. The WM sync
marks `subset_result_value.wm` as the Result identity source, and the public interface snapshots
exclude Option from Result. Portability, round trips and WM/FFI identity tests pass. The compiler's
datatype descriptors now generate from source declarations via `generate-assets`. Lang-item
entries retain identity, arity, source location and stable constructor ID allocation; source
supplies parameter names, constructor names/payloads and runtime spellings. The adoption check
uses this generated contract, including alpha-renamed parameters. Reproducibility and source-change
tests cover generation. The compatibility checker's hand-authored Option datatype table and
reserved `optionName` definition are removed too: it elaborates an embedded copy of the shared
source declaration at the reserved host identity. Host APIs (`Int.fromString`, `Option.map`,
etc.) remain compatibility interfaces, with host Option distinct from an explicitly imported
source datatype. `check-portable` still supplies neither. This preserves the existing SML host
compatibility contract without defining the datatype twice. The follow-up passes portable
selfcheck, 108 language fixtures, WM-entry and Basis tests, round trips, and the SML target
compiler bootstrap. Profile tests also verify host/source nominal separation and host
`Int.fromString`/`Option.map` interoperability.
The pre-existing
[Result.filter export identity assertion](issues/result-filter-export-identity-test-fails-at-js-boundary.md)
was fixed by checking internal identity before export and public JS values separately. The two
JSON boundary tests likewise pass after migrating their calls to the positional library ABI.

## 10. Chore: show lists as lists everywhere

Done 2026-11-17. `print`, `Text.of`, interpolation and main-failure messages use bracketed list
syntax at every depth. The rendering flag is removed; REPL string quoting stays intact, and user
datatypes named Cons/Nil retain their constructor spelling. Long and cyclic foreign list spines
are handled without recursive spine traversal. Updated output expectations pass collection and
library tests, with focused print/Text/interpolation/error-message and REPL coverage.

`__wm_show` (`src/core/emit_prelude.ts`) already renders a list as `[1, 2, 3]` behind a
`listSyntax` flag, but only the REPL's `__wm_repl_show` passes it. `print`, `Text.of` and
template-string interpolation (both through `__wm_text_of`) and the `main failed` message show
`Cons(1, Cons(2, Cons(3, Nil)))`. Make list syntax the only rendering and remove the flag. It
changes program output: about a dozen test files and `examples/aoc2021_day1.wm` mention `Cons(`,
most of them building lists rather than asserting output; update the ones that assert it.

## Deferred

- Removing `Traverse.with`, which `Monad.traverse` replaces, and `List.traverse`, which is
  `Result`-only and duplicated by `Result.traverse`.
- `()` as the `Void` value, and printing `Int32`/`Real64` rather than `Int32.Int`/`Real64.Real`
  in diagnostics and hovers.
- [Trailing pipeline lambda absorbs later stages](issues/trailing-pipeline-lambda-absorbs-later-stages.md).

## Release

After the steps above: the [RELEASE.md](RELEASE.md) checklist, release notes in
`releases/0.8.0.md` with the rename table as upgrade steps, and version 0.8.0 in `deno.json` and
`editors/vscode/package.json`.
