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
