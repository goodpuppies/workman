# Persistent Workman map for compiler passes

Status: implemented in `std/map.wm`, loaded as the standard `Map` namespace, and covered by focused
inference, persistence, ordered-traversal, update/removal, and AVL-height tests.

## Decision

Add a small comparator-based persistent map to Workman `std` and use it where wmslang passes need
scope-preserving environments or deterministic keyed state.

Do not attempt to reproduce the full OCaml Core `Map` API before shader work begins. The initial
library should provide the functional operations used repeatedly by compiler passes, with an AVL
tree or similarly simple balanced binary tree underneath.

The implementation now provides `empty`, `singleton`, `get`, `has`, `set`, `update`, `remove`,
`fold`, `toList`, and `fromList`, plus `numberCompare`. `fromList` is last-write-wins. A
`debugHeight` helper exists for balance tests while the current file-module system has no private
declarations; it is not part of the encouraged application API.

As with the existing Workman-authored `List`, `Option`, and `Result` standard modules, the `.wm`
source is the inference contract and the JavaScript emitter carries a matching runtime
implementation. This duplication is a property of the current standard-library bootstrap, not a
wmslang design choice. The persistent semantics and comparator ordering are tested through emitted
programs so the two sides cannot silently diverge on the operations wmslang will use.

## Why a native persistent map fits

The GLML algorithms commonly treat maps as values:

```ocaml
let child_env = Map.set parent_env ~key ~data in
visit_left parent_env left;
visit_right child_env right
```

Old versions remain valid. This matters for:

- lexical/type environments;
- branch-local pattern bindings;
- substitutions with shadowing;
- lambda-lifting free-variable environments;
- recursive specialization state;
- deterministic pass snapshots.

A persistent Workman tree preserves those semantics directly. Workman's immutable ADTs, pattern
matching, parametric types, recursive functions, and higher-order comparator functions already
provide everything the basic implementation needs.

## Verified prototype

The tested representation was equivalent to:

```workman
type Ordering = Less | Equal | Greater;

type MapTree<K, V> =
  | MapEmpty
  | MapNode<K, V, MapTree<K, V>, MapTree<K, V>>;

type Map<K, V> =
  | MapValue<(K, K) => Ordering, MapTree<K, V>>;
```

The prototype implemented polymorphic `empty`, `get`, and persistent `set`. wm-mini inferred:

```text
empty : ((K, K) -> Ordering) -> Map<K, V>
get   : (Map<K, V>, K) -> Option<V>
set   : (Map<K, V>, K, V) -> Map<K, V>
```

A runtime check constructed an original `Map<Number,String>`, updated a value and inserted a new
key into a derived map, then verified:

- the original retained the old value;
- the derived map contained the replacement;
- the original did not gain the new key.

One representation finding matters: use an ADT wrapper rather than a generic nominal record for
the initial implementation. Pattern matching on `MapValue(compare, root)` propagated `K` and `V`
correctly. An unconstrained record wrapper lost part of that relationship through structural field
inference, and general function annotations cannot currently introduce fresh type variables.
The compiler defects exposed by that control, plus false exhaustiveness warnings from tuple/ADT
match functions, are recorded in
[`generic-record-constraints-and-match-exhaustiveness.md`](../issues/generic-record-constraints-and-match-exhaustiveness.md).

## Initial representation

Use a height-annotated AVL tree:

```workman
type MapTree<K, V> =
  | MapEmpty
  | MapNode<Number, K, V, MapTree<K, V>, MapTree<K, V>>;

type Map<K, V> =
  | MapValue<(K, K) => Ordering, MapTree<K, V>>;
```

The node height permits local rotations after insertion and deletion. Operations remain purely
functional: unchanged subtrees are reused and updated paths allocate new nodes.

Expected complexity:

| Operation | Time | New allocation |
| --- | --- | --- |
| `get` / `has` | `O(log n)` | none beyond result values |
| `set` | `O(log n)` | updated path and rotation nodes |
| `remove` | `O(log n)` | updated path and rotation nodes |
| `fold` / `toList` | `O(n)` | output/accumulator dependent |
| `size` | `O(1)` if node count is stored, otherwise `O(n)` |

Store both height and subtree size only if `size` or indexed operations are actually needed. Height
is sufficient for balancing.

## Comparator model

Store the comparator in the map so every operation uses the same ordering:

```text
Comparator<K> = (K, K) -> Ordering
```

The first library should export a pure numeric comparator. wmslang should prefer stable numeric
binding, constructor, type, expression, and specialization IDs as keys. That avoids requiring
string ordering in the first library and makes identity explicit.

Composite compiler keys should normally be represented by nested maps or assigned stable numeric
IDs. Do not add polymorphic structural comparison to Workman merely to key a compiler table.

A pure string comparator can be added when Workman has defined string ordering semantics. A
carrier-returning JS comparison function is not suitable as the comparator of this pure map.

## Minimum `std/map.wm` API

Start with:

```text
Map.empty     : Comparator<K> -> Map<K, V>
Map.singleton : (Comparator<K>, K, V) -> Map<K, V>
Map.get       : (Map<K, V>, K) -> Option<V>
Map.has       : (Map<K, V>, K) -> Bool
Map.set       : (Map<K, V>, K, V) -> Map<K, V>
Map.update    : (Map<K, V>, K, Option<V> -> Option<V>) -> Map<K, V>
Map.remove    : (Map<K, V>, K) -> Map<K, V>
Map.fold      : (Map<K, V>, A, (A, K, V) -> A) -> A
Map.toList    : Map<K, V> -> List<(K, V)>
Map.fromList  : (Comparator<K>, List<(K, V)>) -> Map<K, V>
```

`toList` and `fold` traverse comparator order, giving deterministic results independent of
insertion history.

Define duplicate behavior explicitly:

- `fromList` may use last-write-wins, matching repeated `set`;
- add `fromListUnique : ... -> Result<Map<K,V>, K>` only when a caller needs duplicate rejection;
- do not overload one constructor with hidden error behavior.

Defer until demonstrated by a real pass:

- `merge`;
- `filter` and `filterMap`;
- `mapValues`;
- min/max and range operations;
- structural map equality;
- a separate persistent Set module.

Most of these can be derived from `fold` and `set` initially. A set can later wrap
`Map<K, Void>` if enough callers need a named abstraction.

## Placement in Workman std

This belongs in `std`, not only under `tooling/wmslang`, because persistent environments are useful
to other Workman-written compiler/tooling packages, including frontend v2.

The implementation should still be developed as a narrow library rather than automatically
injecting every constructor into ordinary source. Follow the existing standard-library namespace
pattern:

```workman
Map.empty(numberCompare)
  :> Map.set(bindingId, value)
  :> Map.get(bindingId)
```

The internal tree constructors should not be the encouraged user API. If the current module export
model cannot hide them, use clearly internal names and treat their representation as unstable.

Adding the module requires:

- `std/map.wm`;
- a generated `mapSource` asset;
- standard-library loading under the `Map` namespace;
- inference and runtime tests;
- documentation of comparator and persistence semantics.

## Tests required before wmslang depends on it

### Type tests

- `empty` generalizes both key and value types;
- `set` fixes them from use;
- `get` returns the correct `Option<V>`;
- two maps with different key/value types remain independent;
- a comparator with the wrong key type is rejected.

### Semantic tests

- replacing a value does not change the old map;
- inserting/removing a key does not change the old map;
- duplicate `set` keeps one binding;
- `toList` is comparator ordered;
- `update` handles present and absent values;
- `remove` covers leaves, one-child nodes, two-child nodes, and a missing key.

### Balance tests

- ascending, descending, and alternating insertions remain logarithmic-height;
- all four AVL rotation shapes are covered;
- deletion rebalances;
- a few thousand sorted numeric keys do not overflow recursive lookup or become quadratic;
- invariants verify stored heights and balance factors after generated operation sequences.

### Compiler-use test

Port the small specialization registry from the first wmslang proof:

- key it by stable numeric binding/specialization IDs;
- register a specialization before traversing its body as the recursion-cycle guard;
- snapshot entries in comparator order;
- retain an earlier registry version in a test to prove persistence.

This exercises the relevant compiler behavior without first porting GLML's much larger lambda-lift
or defunctionalization passes.

## Implementation order

1. Land `Ordering`, comparator storage, unbalanced `empty/get/set`, and persistence/type tests.
2. Add AVL height maintenance and insertion rotations.
3. Add ordered `fold`, `toList`, `has`, and `singleton`.
4. Add balanced `remove` and `update` when the first compiler client needs them.
5. Run the specialization-registry benchmark and promote any generally useful helpers it exposes.
6. Add Set or richer map combinators only from demonstrated use.

The unbalanced first step is a development checkpoint, not the final std implementation. Do not
ship a public compiler map with linear worst-case behavior for already-sorted stable IDs.

## Result for the wmslang plan

The map is a small supporting standard-library milestone before the Workman wmslang middle-end
grows beyond trivial lists. It does not block directive parsing or the TypeScript/HM bridge. Phase
2's constraint solver and initial specialization registry may depend on the tested `Map` API; later
functional passes can extend the library only where their semantics require it.

The initial balanced-map milestone is complete. The next compiler-use test should be the Phase 2
specialization registry itself rather than another speculative collection feature.
