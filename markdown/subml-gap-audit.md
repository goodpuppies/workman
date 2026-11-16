# WM → SubsetML translation gap audit

Status: 2026-11-16, input to [release080plan.md](release080plan.md) step 8. Nothing here is
implemented yet.

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

## Known defects found by the ports

- frontend-v3's projector/View closure fails SubsetML inference with `argument of expr:
  expected Writer * 'a, found Writer * Expr`
  ([native-portability.md](../tooling/frontend-v3/native-portability.md)). Root cause unknown;
  the lowering plan treats checker defects as SubsetML bugs to fix against the Definition.
- `tooling/pakman-subsetml` no longer translates: it uses `SubsetHost.success`, which SubsetML
  `7c92a71` removed.

## Recommendation for 0.8.0

Cover A, B and C, so that ordinary WM code following two rules translates: annotate record
receivers that the declaration does not otherwise fix, and keep record label sets distinct.

- A: all of it.
- B: all of the table above.
- C: `Result`, `Ok` and `Err` in the translation environment, and a default panic runtime so
  `Panic` needs no command-line flag.
- Fix both known defects.
- Out of scope: R2, JS FFI, `Task` and `WON[...]` literals.
