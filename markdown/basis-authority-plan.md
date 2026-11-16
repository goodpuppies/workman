# The SubsetML Basis owns its names

**Status:** planned 2026-11-16. Extends [subsetml-basis.md](subsetml-basis.md), whose
"transitional duplicates" this removes. API shape questions are answered by SubsetML's
[`docs/basis-conventions.md`](../subm/SubsetML/docs/basis-conventions.md).

## Problem

A qualified name can mean two different things depending on imports:

- In a `.wm` file, `List`, `Option`, `Result`, `String` and `ListPair` without an import name the
  `std/` modules. `from "basis/list.wm" import * as List` names the Basis module instead. The
  two disagree: std's `List.length` is `Number` and the Basis's is `I32`, the `foldLeft`
  callbacks take opposite argument orders, std's `at`/`take`/`drop` forgive while the Basis
  returns `Result`, `Option.filter` filters different things, and std's `ListPair` truncates.
- The unqualified pervasives `length` and `foldLeft` already come from the Basis, so `length(xs)`
  and `List.length(xs)` differ in a file with no imports at all.
- `Int` (to become `Int32`), `Char`, `Bool`, `OS`, `StringCvt` and the other Basis modules exist without an import in
  the REPL (its session header imports them) but not in files.

## Rules after this change

1. **Every Basis module is an implicit namespace** in every file and the REPL, named as in
   `basis/` (`subset_string_cvt.wm` is `StringCvt`; `subset_os.wm` is `OS`). An explicit
   `from "basis/x.wm" import * as Y` only picks a local name.
2. **A std module with a Basis name extends that Basis module.** It starts with
   `export from "basis/x.wm" import *;` and may only add names the Basis module doesn't define.
   So the implicit `List` is a superset of `basis/list.wm`, and every shared name means the
   same value.
3. **One operation, one name.** A std addition that duplicates a Basis operation under another
   name (`any` for `exists`, `mapPartial` for `filterMap`) is removed, following the naming table
   in `basis-conventions.md` §3.
4. A conformance test enforces rule 2: no auto-opened std module may define a name its Basis
   module exports.

## Status (2026-11-16)

Steps 1–4 are done. Deviations from the table below, decided during the work:

- `Option.app` became `Option.forEach` (§3 names), and `Option.valOf` was removed.
- `ListPair` keeps `forEach`, `foldLeft`, `foldRight`, `all` and `exists` as additions; each
  checks the lengths first and returns `Err(UnequalLengths)`, like the Basis `zip` and `map`.
  The non-`Eq` forms that silently truncated, and the `Eq` duplicates, are gone.
- The Basis's host adapters (`subset_host`, `subset_text_host`) stay import-only. Every other
  Basis module is opened, including the helpers (`OptionValue`, `Source`, `WonParser`, …).
- An unbound compiler-owned structure (`Text` in a `@no-prelude` module) now names its prelude
  object `__wm_basis_Text`, as `Int32` already did.
- Opening `Won` made `Won.Node = { path, value }` compete with user records in field-based
  record inference (`.{ value = x } => …`, `x.value` on an unknown type), which searched every
  registered record. Decided: a library record reachable only through a namespace no longer
  takes part; it needs an annotation, its qualified constructor, or an unqualified import. The
  program's own records, including those of namespace-imported user modules, still take part
  (`fieldSelectableRecordTypes` in `src/types.ts`). `Carrier` and `Applicative` from
  `std/monad.wm` are pervasive types (`LIBRARY_PERVASIVE_TYPES`), so a carrier literal
  `.{ succeed, map, … }` still needs no import. A record pattern parameter with a nominal record annotation,
  `(.{ via }: Monad.Carrier<…>) =>`, now takes its type from the annotation instead of a
  field search.
- Startup cost: none measurable (`wm check` of a one-liner, 1.3 s before and after).

Not done: explicitly importing a std module that overlays a compiler structure
(`from "std/int32.wm" import * as Int32`) still drops the compiler's members.

## Today

This runs after the numeric rename in [numeric-names-plan.md](numeric-names-plan.md) (step 1
there), so `I32`/`Number` below read as `Int32`/`Real64` by the time this work starts.

### 1. List, Option, Result, String, ListPair become Basis supersets

Per module: add the `export from`, delete the std definitions the Basis provides, keep the
genuine additions, migrate callers. The type checker finds every changed call site.

| Module | Std definitions replaced by the Basis's | Renamed to the Basis name | Kept as additions |
|---|---|---|---|
| `List` | `length` (now `I32`), `foldLeft` (callback `(x, acc)`), `at`/`take`/`drop`/`tabulate` (now `Result`), `last` | `any`→`exists`, `mapPartial`→`filterMap`, `revAppend`→`reverseAppend`, `null`→`isEmpty`, `app`→`forEach`, `hd`/`tl`→`head`/`tail` | `toString`, `toStringRender`, `collectWith`, `getItem`, `findMap`, `collate` |
| `Option` | `filter` (now filters an `Option`) | — | `map2`, `traverse`, `collectList`, `join`, `app`?, `compose`, `composePartial`; `valOf` removed (no unchecked unwrap) |
| `Result` | — (already forwards) | — | `succeed`, `carrier`, `debug`, `map2`–`map4`, `toBool`, `traverse`, `all`, `collectList`, `filter`; private `reverse`/`reverseAcc` stop being exported |
| `String` | — | — | `toList`, `isSubsequence` |
| `ListPair` | `zip`, `map` (now strict `Result`) | `zipEq`→`zip` | `app`, `foldl`/`foldr`, `all`, `exists` and the `Eq` forms are reviewed against §3/§6 |

Known callers of changed definitions (rough counts): `List.length` 26 in `.wm` and 6 in TS test
sources, `List.foldLeft` 14, `List.any` 19, `List.mapPartial` 14, `Option.filter` 5, `List.at` 5,
`List.tabulate` 4, plus a few `hd`/`tl`/`last`/`null`/`ListPair` uses in tests. They are in
`tooling/pakman`, `tooling/tuiman`, `tooling/problems`, `tooling/testman`, `tests/`, `std/` and two
examples. `Option` std helpers whose name will clash with a future Basis addition are not
renamed preemptively.

Order: `List` first (largest), then `Option`, `ListPair`, `Result`, `String`. One commit per module
where callers allow.

### 2. Conformance test

A test over the generated library: for each `std/x.wm` whose namespace equals a Basis module's,
the std module re-exports the Basis module and defines no name the Basis exports.

### 3. Every Basis module is an implicit namespace

- `src/standard_library.ts`: auto-open `subml-basis/` public modules (the `manifest.json` list)
  under their `basis/` names, unless a std module of that name extends it (rule 2). Internal
  modules (`subset_host`, `subset_text_host`) stay import-only.
- Initial-basis structures with the same name (`Text` holds the compiler's `Text.of`) are
  overlaid as std modules already are (`composeInitialStructure`).
- `src/repl.ts`: drop the Basis imports from the session header and the `Text` shim.
- Check startup time: the Basis modules are already analyzed on every start because std imports
  them, so this should cost only namespace binding. Measure before and after.

### 4. Documentation

`docs/modules.md` (library imports section), `std/README.md`, the overlap section of
[subsetml-basis.md](subsetml-basis.md), and the REPL docs. Mark `i32-plan.md`'s `Int`→`I32` rename
superseded (see below).

### 5. Submodule pin

Record SubsetML `efaab48` (the conventions doc) with the first commit.

## Not today

- The Basis's own known deviations (`basis-conventions.md`), fixed in SubsetML.
- Removing `std/basis.wm`'s `Basis.Error` once nothing returns it.

## Testing

Targeted tests for each step: the library loader and conformance tests, `cli_test.ts` REPL cases,
and the tests of each migrated tool (`tooling/pakman/tests`, tuiman, problems, testman). The full
`deno task test` gate runs once at the end.
