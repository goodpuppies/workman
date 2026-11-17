# WM → SubsetML translation gap audit

Status: 2026-11-16, input to [release080plan.md](release080plan.md) step 8. The tables record the
original probes; implemented work and current blockers are recorded below.

## What was checked

WM code that must translate to SML is written in a subset of WM. Today that is
`tooling/frontend-v3` (the lexer closure and the editor diff/preview closure) and
`tooling/pakman-subsetml`. The subset is defined by SubsetML's reverse translator
(`subsetml sml`, `docs/translation.md`) plus the coding rules in
`tooling/frontend-v3/subsetml-lowering-plan.md`.

Each WM feature was written as a one-declaration probe and translated with
`subm/SubsetML/bin/subsetml sml` (probes kept in the session scratchpad, not the repository).
22 of 42 probes translated. The failures fall into four groups.

## A. Syntax the reader does not accept yet

Each is a source-level desugaring that needs no type information.

| WM form | Reader result | Translation |
|---|---|---|
| computed pattern `=(limit - 1)` | `expected a pattern, found =` | the existing ordered pinned-pattern checks; pins of names already translate |
| cond-style match `match { =(c) => … } true` | same | follows from computed patterns |
| pipeline lambda `=> :> f :> g` | `expected an expression` | `x => x :> f :> g` |
| `let f ==> …` | `expected =, found ==` | the two lambda forms above |
| capture clause `(y) \|x\| => …` | `expected }, found \|` | checked by WM, then dropped |
| match-function capture `match(x) \|limit\| => …` | `expected {, found \|` | as above |
| lambda result annotation `(n: T): T => …` | `expected ;, found :` | `fn n => (e : t)` |
| piped conditional `b :> if { … } else { … }` | `expected (, found {` | `if b then … else …` |
| space application with a grouped argument `add (1: Int32.Int) one` | `expected ), found :` | reader defect: WM accepts it |
| inline record type `.{ a = 1 }: Point{ a: Int32 }` | `expected ;, found :` | hoist `type point = {a : int}` before the declaration |
| named import `from "./x.wm" import { a, B };` | `reverse discovery requires header namespace imports` | qualify each imported value, constructor and type (`X.a`, `X.B` in patterns); found later, see below |
| typed hole `?` | `unexpected character` | could lower to the panic runtime; holes are development-only, so rejection is reasonable |

## B. Forms whose translation depends on types

The reader is syntactic, but the translator already infers types after lowering: it chooses
`Real.==` for real equality that way, and reports "cannot determine the record type" from
inference. Each form below uses that inference, an explicitly written carrier, or a required
annotation in portable WM code. Only WM's choice of a record type by field name has no SML
counterpart; an annotation on the receiver replaces it.

| WM form | Today | 0.8.0 |
|---|---|---|
| record projection `r.x` | the receiver's type must be fixed inside the declaration ([lowering plan](../tooling/frontend-v3/subsetml-lowering-plan.md#record-projection-receivers-must-have-a-known-complete-type)) | unchanged rule: annotate the receiver; the existing error says where |
| record member pipe `p :> .x`, `p :> .f(a)` | rejected as a receiver pipe | rewrite to `p.x` / `p.f(a)`; projection's rule applies. A non-record receiver is an error |
| record update `.{ ..p, x = 1 }` | must name the layout: `P { ..p, x = 1 }` | expand after inference once `p`'s record type is known |
| template string `` `n is ${n}` `` | rejected | `String`, `Int.toString` or `Real.toString` by inferred type; other types need an explicit conversion |
| `%` | rejected: "SML `mod` differs" | `Int.rem` or `Real.rem` by inferred type (release step 4) |
| arithmetic only a default decides, `(a, b) => a + b` | rejected | accepted: WM and SML both default to `int` (release step 5) |
| carrier group `Result\|a, b\|` | parse error | syntactic: the group names its carrier; lower to `SubsetResult.map2` |
| `Monad.via Result f`, `Monad.map(Result, …)`, a carrier passed as a variable | `unbound identifier Monad.via` | ordinary record code: `Monad` functions are field accesses on a `Carrier` record. Move the `Carrier` record type and a `SubsetResult.carrier` value into the Basis and translate `std/monad.wm` as portable code; a bare `Result` in value position is syntactic shorthand for `SubsetResult.carrier` |
| real equality `a == b` | translates | unchanged |

What remains a rule rather than a translation:

- R2: two record types with the same label set are one SML type, so portable code keeps label
  sets distinct. Wrapping each record in a one-constructor datatype would lift this, at the cost
  of unnatural SML. Not planned.
- A typed lowerer that reads WM's own resolved types would remove the receiver annotations. Not
  needed for 0.8.0.

## C. Missing from the translation environment

| WM | Today |
|---|---|
| `Ok`, `Err`, `Result` | `unbound identifier Ok`: code must import `subset_result.wm` as `SubsetResult` |
| `Some`, `None`, `List.length` | translate |
| `Monad`, other std modules | unbound; std is WM's extension layer, not part of the Basis |
| `Panic` | needs `--panic-runtime FILE.wm` on the command line |

`Option` is in SubsetML's initial environment but `Result` is not, although both are Basis types
WM programs use unqualified.

## D. Out of scope

`JSON{}`/`JSON[]` and JS receivers are JavaScript FFI. `Task` is a host carrier. `WON[...]`
literals are excluded too: portable code uses the `SubsetWon` constructors directly.

## Later finding: named imports

Translating `tooling/frontend-v2` (the self-hosted WM frontend, 27 modules, 31,308 lines including
the 25,922-line generated `compiled_probe_rules.wm`) stops at its first import. All 75 of its
module imports use named clauses, which the reader does not accept; only `import * as Name` is
in the profile. Named imports are ordinary WM style, so they belong in group A.

frontend-v2's remaining JS dependencies are small: `String.prototype.charCodeAt` and `slice`,
one `:> .length`, and a `Js.Table` memo for packrat parsing. The first three map to Basis text
functions. The memo table is mutable, which SubsetML cannot express; it needs a host kernel
adapter like the existing text and file adapters, or a persistent map such as SubsetML's
`int_map`.

### Status, 2026-11-16

With the two JS host modules replaced by stubs, all of frontend-v2 translates (32 SML modules,
43,496 lines) and MLton type-checks it. The work took these SubsetML changes, each found by the
port:

- group A: named imports, lambda result annotations, a conditional as a binary operand, and a
  field read on a call result (`f(x).node`);
- integer literals typed by context, as in WM, so `x / 2` on a `Real64` needs no `2.0`;
- R3 finding record types declared in imported structures;
- group C: WM opens each Basis module `subset_x.wm` as the namespace `X`, so `List.filter` is
  `SubsetList.filter`. The translator gave `List` the SML-style bootstrap instead. With `--basis`
  it now adds the same implicit imports. The audit's table above missed this, because
  `List.length` has the same meaning in both;
- native names: `before` and `o` are infix in the SML Basis Library, which MLton rejects as
  binding names.

frontend-v2 itself needed receiver annotations on 13 field reads, and its choice indices
(`ChoiceParseValue`, `ChoiceCompiledCapture`) became `Int32`: SML has no real patterns, and an
index was never a real. Running the native parser still needs real host modules for text and the
memo table.

## Known defects found by the ports

- frontend-v3's projector/View closure fails SubsetML inference with `argument of expr:
  expected Writer * 'a, found Writer * Expr`
  ([native-portability.md](../tooling/frontend-v3/native-portability.md)). Root cause unknown;
  the lowering plan treats checker defects as SubsetML bugs to fix against the Definition.
- `tooling/pakman-subsetml` no longer translates: it uses `SubsetHost.success`, which SubsetML
  `7c92a71` removed.

### Follow-up, 2026-11-16

The pakman port now uses integer exit codes and the shared Basis's data-first List and byte-string
APIs. Native strings are checked at conversion; invalid bytes trigger the selected panic runtime.
The full native package lifecycle, refusal cases and host contract pass through SubsetML and
MLton. Its Option-producing helper explicitly uses the Basis datatype.

Postfix type annotations now translate in ordinary expressions and call arguments. This fixes
the grouped-argument failure for `add (1: Int32.Int) one`; the pipe suite compares annotated
curried/tuple calls against WM execution, and the translation suite passes.

With `--basis`, SubsetML now supplies private opens of the source Option/Result datatypes for
unqualified type and constructor uses. Basis-returned options match bare `Some`/`None`; authored
datatypes and imports still shadow the defaults. The private leak rule distinguishes newly
declared types from imported types. The compatibility checker now derives its host Option
definition from embedded shared source, and WM's constructor descriptors generate from source
declarations (release step 9).

The frontend-v3 parser/projector/View closure now builds with MLton and passes ten WM/native
cases (`scripts/check_frontend_v3_projector_native.py`). Its older generic error was a scoped
type variable in a nested callback annotation, also rejected by MLton in a reduced SML case.
Annotating the `items` helper's argument as `Ast.Items<a>` scopes that variable at the helper.
The JavaScript editor/preview adapters now decode the library Result ABI; their three parser
and preview tests pass. All ten direct projector tests pass too.

### Syntax and validation follow-up, 2026-11-17

Computed patterns, cond-style matches, implicit pipeline lambdas (including `==>`), capture-clause
syntax and piped conditionals now translate. Record member pipes project/call ordinary records;
receiver types must still be established by inference or annotations. Pattern tests compare WM
and native effects and results, including short-circuiting and shadowed outer names.
`sml-entry --basis DIR` defaults the panic provider to the supplied Basis's process module;
explicit runtime overrides and native adapter selection remain available.

The frontend-v3 WM suite now uses the same public testman API as its runner and passes 61 tests.
This exposed and fixed missing list-closer ownership and declaration-boundary recovery; both are
included in the ten native/WM cases. JSON boundary tests and the Result.filter identity test also
pass after updating their library ABI assumptions.

Remaining feature probes: inline record types, unnamed record updates, template strings,
carrier groups and portable Monad/Carrier support. The restricted native profile still needs
bootstrap-pervasive lowerings.

## Recommendation for 0.8.0

Cover A, B and C, so that ordinary WM code following two rules translates: annotate record
receivers that the declaration does not otherwise fix, and keep record label sets distinct.

- A: all of it.
- B: all of the table above.
- C: `Result`, `Ok` and `Err` in the translation environment, and a default panic runtime so
  `Panic` needs no command-line flag.
- Fix both known defects.
- Out of scope: R2, JS FFI, `Task` and `WON[...]` literals.
