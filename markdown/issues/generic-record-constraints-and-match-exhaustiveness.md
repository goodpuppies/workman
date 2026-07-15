# Issue: Generic Record Constraints Are Lost and Exhaustive Match Functions Warn

Status: open

Discovered while prototyping a generic persistent Workman map for the wmslang compiler plan.

## Summary

Two likely independent compiler bugs appear in a small immutable-map implementation:

1. Multiple field accesses on one unconstrained generic record parameter do not remain connected
   in the inferred function type. A tree field is typed locally but disappears from the parameter
   constraint, leaving the result value type free. Spreading the same parameter fails with
   `record spread requires a record type`.
2. Multi-argument match functions covering every constructor in an ADT-bearing tuple emit false
   `pattern.non-exhaustive` warnings even though their inferred types and runtime behavior are
   correct.

The ADT-based map representation works and preserves old map versions at runtime, so neither issue
blocks the design permanently. They should be fixed before a standard persistent map relies on
these patterns or standard-library inference begins reporting spurious warnings.

## Environment

Observed in the current wm-mini checkout on 2026-07-15 with:

```text
deno task wm check <file>
deno task wm type-debug <file>
```

## Issue A: generic record field constraints are lost

### Minimal reproduction

```workman
type Ordering = Less | Equal | Greater;
type Tree<K, V> = | Empty | Node<K, V, Tree<K, V>, Tree<K, V>>;

record MapBox<K, V> = {
  compare: (K, K) => Ordering,
  root: Tree<K, V>,
};

let rec findTree = match(compare, key, tree) => {
  (_, _, Empty) => { None },
  (compare, key, Node(nodeKey, value, left, right)) => {
    match(compare(key, nodeKey)) {
      Less => { findTree(compare, key, left) },
      Equal => { Some(value) },
      Greater => { findTree(compare, key, right) },
    }
  },
};

let find = (map, key) => {
  findTree(map.compare, key, map.root)
};

let replaceRoot = (map, root) => {
  .{ ..map, root = root }
};
```

### Observed result

`type-debug` fails at `replaceRoot`:

```text
record spread requires a record type
```

Before that failure, its environment reports:

```text
findTree : (((K1, K2) -> Ordering, K1, Tree<K2, V>)) -> Option<V>
find     : (({ compare: (K1, K2) -> Ordering }, K1)) -> Option<V2>
```

The exact variable names differ, but two losses are stable:

- `find`'s parameter only retains the `compare` field, not `root`;
- its result element is independent of the tree value type.

This is inconsistent with the nearby expression facts, which correctly include:

```text
map.root : Tree<K, V>
findTree(map.compare, key, map.root) : Option<V>
```

Thus parsing and individual field selection succeed; the constraints are lost or not merged while
forming the lambda parameter/scheme.

### Expected result

The declared nominal record gives enough evidence to infer the connection:

```text
find        : (MapBox<K, V>, K) -> Option<V>
replaceRoot : (MapBox<K, V>, Tree<K, V>) -> MapBox<K, V>
```

If field-only inference deliberately remains structural, its type must at least retain both fields
and connect their variables:

```text
find : ({ compare: (K, K) -> Ordering, root: Tree<K, V> }, K) -> Option<V>
```

Silently dropping the `root` constraint is unsound regardless of whether nominal selection is
intended.

### Related spread behavior

The record-spread failure may be the same missing constraint or a second inference-order problem.
The parameter begins as a type variable; field use and the declared record shape should establish
a record type before or while the spread is checked. Instead, spread rejects the still-unpruned
variable immediately.

General function annotations are not a sufficient workaround because current Workman annotations
cannot introduce fresh `K` and `V` variables at the function definition.

### Working workaround

An ADT wrapper preserves the parameters through pattern matching:

```workman
type Map<K, V> = | MapValue<(K, K) => Ordering, Tree<K, V>>;

let get = match(map, key) => {
  (MapValue(compare, root), key) => { findTree(compare, key, root) },
};
```

The current compiler correctly infers:

```text
get : (Map<K, V>, K) -> Option<V>
```

This is a valid representation choice for `std/map.wm`, but it should not hide the generic-record
inference defect.

## Issue B: exhaustive tuple/ADT match functions warn

### Minimal reproduction

```workman
type Ordering = Less | Equal | Greater;
type Tree<K, V> = | Empty | Node<K, V, Tree<K, V>, Tree<K, V>>;
type Box<K, V> = | BoxValue<(K, K) => Ordering, Tree<K, V>>;

let rec insertTree = match(compare, key, value, tree) => {
  (_, key, value, Empty) => {
    Node(key, value, Empty, Empty)
  },
  (compare, key, value, Node(nodeKey, oldValue, left, right)) => {
    match(compare(key, nodeKey)) {
      Less => { Node(nodeKey, oldValue, insertTree(compare, key, value, left), right) },
      Equal => { Node(nodeKey, value, left, right) },
      Greater => { Node(nodeKey, oldValue, left, insertTree(compare, key, value, right)) },
    }
  },
};

let getRoot = match(box) => {
  BoxValue(_, root) => { root },
};

let set = match(box, key, value) => {
  (BoxValue(compare, root), key, value) => {
    BoxValue(compare, insertTree(compare, key, value, root))
  },
};
```

### Observed result

`wm check` exits successfully but emits:

```text
non-exhaustive match: missing _
```

for `insertTree`, and:

```text
non-exhaustive match: in BoxValue, missing: _
```

for `set`.

The inferred types are correct:

```text
insertTree : ((K, K) -> Ordering, K, V, Tree<K, V>) -> Tree<K, V>
getRoot    : Box<K, V> -> Tree<K, V>
set        : (Box<K, V>, K, V) -> Box<K, V>
```

`getRoot` is a useful control: a unary match over the same single-constructor generic ADT produces
no warning. The false positive appears when the ADT pattern is one column of a larger tuple/match
function.

### Why the matches are exhaustive

For `insertTree`:

- the first three tuple positions are variables or wildcards in both rows;
- the final `Tree` position covers `Empty` and `Node`, the complete datatype.

For `set`:

- `BoxValue` is the only `Box` constructor;
- `key` and `value` are variable patterns and cover every value of their types.

No runtime input is omitted.

### Expected result

Both functions should check without `pattern.non-exhaustive` diagnostics. Truly missing `Empty`,
`Node`, or `BoxValue` cases must continue to warn.

## Likely compiler boundaries

Issue A likely involves:

- record field constraint accumulation in `src/infer/records.ts`;
- structural-record merging in `src/types.ts`;
- how repeated projections on the same binder are recorded/generalized;
- record-spread handling when its source is still an unbound type variable.

Issue B likely involves:

- tuple-column specialization in `src/infer/exhaustiveness.ts`;
- constructor completeness when an ADT pattern appears beside wildcard/variable columns;
- the conversion of multi-parameter match functions into one tuple scrutinee;
- parametric constructor payloads in the pattern matrix.

These may be split into separate implementation issues if investigation confirms unrelated root
causes. This report keeps them together because one small generic persistent-map fixture exposes
both and provides a useful end-to-end regression.

## Candidate regression tests

### Record inference

1. Two different field projections on one unconstrained generic-record parameter both survive in
   the inferred structural constraint.
2. Variables shared between those fields remain shared in the result type.
3. The same function with an explicitly concrete `MapBox<Number,String>` parameter infers the same
   connections.
4. Spreading an unconstrained parameter after field evidence selects or constructs the correct
   record type.
5. An actually non-record spread still fails.
6. Ambiguous records sharing the same field names produce an actionable ambiguity diagnostic rather
   than dropping constraints.

### Exhaustiveness

1. A tuple match whose final column covers every constructor and whose other columns are variables.
2. A tuple match whose first column covers a single-constructor generic ADT.
3. The same cases with two- and three-constructor ADTs.
4. Nested ADT patterns with generic payloads.
5. Controls omitting each constructor still warn.
6. Redundant rows remain diagnosed independently of exhaustiveness.

### Persistent-map integration

1. `Map.get` infers `(Map<K,V>, K) -> Option<V>`.
2. `Map.set` infers `(Map<K,V>, K, V) -> Map<K,V>` without warnings.
3. Updating a map does not change an earlier version at runtime.
4. Sorted insertions preserve the balanced-tree invariants once AVL balancing lands.

## Severity and impact

- The record issue can produce an over-general public type whose result is disconnected from an
  accessed field. This is a type-inference correctness problem, not only a poor diagnostic.
- The exhaustiveness issue produces false warnings for an idiomatic Workman compiler style and
  would make standard-library/compiler code noisy.
- The ADT workaround permits progress on the persistent map, so neither issue needs to block all
  wmslang planning.

## Non-goals

- Adding row polymorphism or changing Workman's nominal-record policy.
- Adding explicit higher-rank or universally quantified function annotations.
- Suppressing all exhaustiveness warnings in generic functions.
- Making the persistent map mutable to avoid the inference paths.
- Coupling the fix to JavaScript collection reflection.
