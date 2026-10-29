# List fold callback order is inconsistent

Status: open; verified by source inspection 2026-10-28

`std/list.wm` calls the `foldLeft` callback as `f(accumulator, element)`, but
exports `foldRight` from `subml-basis/subset_list.wm`, whose callback is
`f(element, accumulator)`. The outer call convention is data-first for both:
`foldLeft(items, initial, f)` / `foldRight(items, initial, f)`.

This difference is specific to the current std API. All of the following use
element-first callbacks for both left and right folds:

- MLton: `research/mlton/basis-library/list/list.sml`, `foldl`/`foldr`.
- MLWorks: `research/mlworks/src/pervasive/__pervasive_library.sml`, `foldl`/`foldr`;
  `research/mlworks/src/basis/__list.sml` reuses those functions.
- WM's portable Basis: `subml-basis/subset_list.wm`, `foldLeft`/`foldRight`.

The SML reference signatures for both are
`((T * A) -> A) -> A -> T list -> A`. Traversal direction differs; callback
operand positions do not. Data-first outer arguments in WM are independent of
the callback's operand order.

## Resolution direction (user clarification 2026-10-28)

The SubsetML Basis is primary; std is for extra facilities. Both portable Basis
folds already have the correct, consistent signature:

```text
foldLeft:  (List<T>, A, (T, A) -> A) -> A
foldRight: (List<T>, A, (T, A) -> A) -> A
```

Use those existing Basis functions for new pervasive bindings. Later remove
the duplicate std implementation and migrate its existing callers together.
Do not retain the old accumulator-first behavior through a new wrapper, change
the portable Basis, or duplicate its fold algorithm in std. Public namespace
projection may preserve access to the canonical function without owning a
second implementation. The deletion/caller migration has not been implemented.

Check callers by resolved target, not spelling alone: several modules import
different list libraries under aliases. Cover external consumers such as atview
when planning the migration.

Use checks with distinct element/accumulator types to catch swapped callback
operands, plus noncommutative operations to check traversal direction. Verify
empty-list behavior and the inferred public types. This issue changes no source
code; it records the problem found during the pervasive-binding design.

Related: [default pervasives](lacks-pervasives.md).
