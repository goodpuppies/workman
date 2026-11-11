# First-class arity raising

## Implemented slice

The JS emitter already emits positional entries for named functions with one simple tuple pattern.
Known direct calls and recursive tail loops use these entries. The tupled entry remains necessary
for generic HM code, existing library consumers, and the runtime's higher-order helpers.

This change attaches the positional entry to its tupled function value using a non-enumerable,
read-only `Symbol.for("wm.tupleEntry.v1.N")` property. The arity and version are explicit. Global
symbols allow independently compiled libraries in the same JS realm to agree on the entry key.
Aliases, values stored in records/tuples, imported/re-exported values, and returned closures keep
the same function object and metadata. Eligible anonymous tuple lambdas get the same two entries.
There is no adaptation at each escape or module boundary.

An indirect Core application with a literal tuple argument emits a fixed-signature
`__wm_tuple_call_N(fn, a, b, ...)`. The helper looks up the matching positional entry once. If
present it invokes that entry with scalar arguments; this path creates neither an argument tuple nor
a rest array. Otherwise it constructs the original tuple and calls the original function. Known
direct calls still use their original direct entries without the metadata lookup. Evaluation order
is callee, argument components left-to-right, invocation, with each expression evaluated once.

The fallback is important even for a call with a concrete tuple argument: a generic identity
function instantiated at a tuple type still expects one value. Using JS `Function.length` or the
instantiated type alone to choose a calling convention would be unsound.

## Public JS ABI

Library emission defaults to positional outer tuple arguments. `src/core/js_abi.ts` owns
`functionArguments`, shared with content mapper declarations, and a compact representation-change
descriptor. It recursively plans function arguments/results, tuple components, and structures.
Opaque nominal data keeps its existing layout; projecting nominal types remains separate work.

At the boundary, simple tuple functions expose their existing direct implementation, with no
per-call export wrapper. Functions requiring callback or returned-function conversion use adapters.
Function caches retain alias identity, and a versioned global origin symbol recognizes exact round
trips across separate generated libraries. Inward simple positional callbacks carry the same
tuple-entry metadata so WM higher-order calls can invoke them without allocating tuples.

Containers are converted afresh, not cached, because TS can pass mutable tuples/objects. Function
identity is cached; container identity is not guaranteed when contained functions need conversion.
Generic type variables have no representation conversion: a generic `T -> U` callback takes one
value even when instantiated at a tuple. No JS Function.length heuristic or generic specialization
is involved. Curried stages stay curried; nested tuple values and return tuples stay arrays.

`CompileOptions.libraryAbi: "tuple"` retains the fixed bootstrap transport where needed. Low-level
arity dispatch tests explicitly select it. The public CLI and content mapper use positional calls.
The checked-in tuiman stage-0 renderer's builder explicitly retains the old tuple transport.

## Optimization bounds

The internal Core convention stays single-argument for generic code. Calls passing an existing tuple
variable continue through that entry. Refutable and nested parameter patterns retain checks via a
boundary adapter when no simple direct implementation exists.

There is one metadata property per eligible function object and a lookup at indirect tuple call
sites. No claim of an overall speedup is made without workload benchmarks. Generated helpers are
included only for arities encountered during emission. Older tuple-entry libraries can participate
through generic fallback; consumers of old public JS exports must rebuild or select legacy ABI.

## Validation

`tests/arity_raising_test.ts` checks named and anonymous callbacks, aliases, closures, conditional
functions, records/tuples, currying, recursion, separately compiled libraries, generic fallback,
refutable patterns, arity mismatches, and evaluation order. Proxy call traps deliberately reject the
tupled entry to prove eligible higher-order calls actually use positional implementations. Existing
FFI, tail specialization, runtime diagnostics, module, and content-mapper checks cover
compatibility. The ssrtan backend still builds and runs against the updated emitter.

## Next steps

- Measure representative higher-order workloads and parser compile/run costs.
- Track conventions in typed Core to remove indirect dispatch where representation is proven.
- Extend nominal-type projection and nested nominal data conversion together.
- Add specialization for generic higher-order functions only when workloads justify it.
