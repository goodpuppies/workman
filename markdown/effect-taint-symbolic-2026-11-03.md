# Symbolic taint summaries

This experiment is superseded by [taint as a bit on the type](effect-taint-bit-on-type-2026-11-04.md).

## Scope

This experiment replaces sequence-history types and the notification graph with monotone Boolean
summaries. It takes the summary-in-signature idea from Madsen and van de Pol's OOPSLA 2020 paper,
[Polymorphic Types and Effects with Boolean Unification](https://cs.au.dk/~magnusm/papers/oopsla20/paper_b.pdf),
particularly section 3.5. It does not implement their complete Boolean unification algorithm or
adopt their exact-effect equality semantics. WM retains additive scars and container provenance.

A local sequence keeps its result's ordinary value type and a summary of the evaluated members.
Discarded members' value types are no longer retained in that result. A callback dependency such as
`run = f => { f(); 1 }` lives in symbolic terms on the callback result and returned Number, not in a
copied tuple of the computation's member types.

## Representation

Each type position can have an outer `taint` and a `contents` summary. A summary is a mutable
symbolic variable with substitution links, OR inputs, or a positive constant. Normal construction
joins immediate children. Functions contribute their outer scar only; their signatures are latent.
Sequence item views share the enclosing result summary while preserving their own value shapes. An
occurrence view around an unresolved HM variable contains only that variable and its scar, never the
discarded sequence history.

Normal unification merges outer symbolic substitutions. A joined result retains its own summary
identity so adding an outer scar does not mark its inputs backward. Structural rows keep a stable
contained-summary identity because later projection/unification may add fields.

There are no reverse subscriber maps, parent-notification queue, sequence member arrays, evaluated
copy mode, or recursive binding-time type-normalization pass. Ordinary pruning now performs normal
path compression through bound variables; it no longer preserves sequence wrappers/history.

Reading an unresolved OR summary still traverses its symbolic terms, with a visited set for cycles.
Positive findings are permanently collapsed; clean findings are not cached because later
substitution may introduce taint. This is not a claim of constant-time queries for every formula.

## Generalization and substitution

The existing HM free-variable walk collects symbolic roots and type positions at let generalization.
Internal equations are simplified to visible/captured variables, discarding hidden value-production
history. Captured environment summaries remain live. Generalized schemes record their quantified and
captured roots; later environment walks reuse the captured set instead of rediscovering all of a
polymorphic scheme's internal terms.

Instantiation freshens quantified symbolic terms through the same memo used for value-type
substitution. Captured monomorphic variables and summaries retain identity. Manually constructed
basis signatures are treated as independently instantiated templates; missing scheme metadata on an
ordinary monomorphic binding instead preserves captured state. Conflating those cases caused both
cross-use contamination and excessive copying in early iterations.

Copying a bound HM alias preserves its outer scar as an occurrence view instead of overwriting an
underlying shared value's summary. Ordinary type copying remains, and symbolic formulas still
require freshening/substitution. The representation eliminates extra copying of discarded value
types; it does not eliminate all work for effect polymorphism or freeze a shared mutable effect
state across independent instances.

## Observable correction

Extracted values retain container provenance when rebuilt into another container. A mapped
`Result<Number, Error>!` can therefore become `Result<Number!, Error!>!`, while the original
container's inner types remain unchanged. The previous notification version lost some of these
relations through copied bound aliases. Four existing FFI/type-debug expectations were updated to
retain the reconstructed payload/error scars, with an explicit direct datatype regression. All other
selected expected behavior remains unchanged.

## Verification

The focused suite covers callbacks, concrete annotations, returned/captured closures, independent
uses, branch/sequence propagation, container positions, FFI resolution, recursive equations, 10,000
joined summaries, bound aliases, and discarded-shape elimination. `deno task check` passes. The
selected inference, compiler, FFI, diagnostics, module-interface, semantic-facts, and LSP suite
passes **256 tests with zero failures**, including all **39** focused taint regressions. The touched
files pass the diff whitespace check.

## Performance

Three process triplets compare the no-taint baseline, the notification version, and symbolic
summaries. The second triplet reverses order. Each process warms up three times and records seven
samples; the table uses the median of the three process medians. Timing runs exclude profiling and
instrumentation. Prepared-AST workloads exclude parsing. Source checking includes parsing and warm
library setup; library waves infer 73 modules with fresh results.

| Workload                   | No-taint baseline | Notifications | Symbolic summaries | Change vs notifications |
| -------------------------- | ----------------: | ------------: | -----------------: | ----------------------: |
| scalar-250                 |          18.91 ms |      26.37 ms |           25.45 ms |                   -3.5% |
| scalar-250-with-snapshots  |          31.09 ms |      48.92 ms |           54.48 ms |                  +11.4% |
| scalar-250-check-source    |         169.20 ms |     207.98 ms |          209.50 ms |                   +0.7% |
| polymorphic-250            |          12.05 ms |      16.37 ms |           15.71 ms |                   -4.0% |
| higher-order-100           |          17.72 ms |      29.15 ms |           27.22 ms |                   -6.6% |
| nested-data-150            |          20.42 ms |      29.18 ms |           27.45 ms |                   -5.9% |
| latent-functions-150       |          18.09 ms |      25.43 ms |           27.04 ms |                   +6.3% |
| stdlib-wave                |         159.99 ms |     308.15 ms |          261.78 ms |                  -15.0% |
| stdlib-wave-with-snapshots |         177.42 ms |     345.19 ms |          293.44 ms |                  -15.0% |

Library inference is about 15% faster than notifications, but remains about 64% above the no-taint
baseline. Warm source checking is approximately unchanged. Scalar inference with declaration
snapshots is about 11% slower than notifications; latent-function workloads are also slightly
slower. This is a representation improvement, not a near-zero-overhead result.

An isolated instrumented library wave confirms the removal of discarded value-history copying:

| Operation per 73-module wave                  | Notifications | Symbolic summaries |
| --------------------------------------------- | ------------: | -----------------: |
| Value-type copying operations                 |         9,454 |              9,454 |
| Value-type node visits during copying         |       122,654 |             46,921 |
| Retained sequence nodes cloned                |        23,464 |                  0 |
| Separate evaluated/discarded-copy node visits |        70,877 |                  0 |
| Symbolic terms freshened                      |             — |             29,627 |

Value-type node visits fall about 62%. The remaining symbolic freshening, formula simplification,
summary queries, generalization, and mutable primitive occurrence copies still have costs. Clean
summary queries may traverse OR terms; only positive results are cached. These costs need separate
profiling before another performance claim or optimization. Counts from instrumentation are not used
as latency measurements.

Raw timing results, operation counts, and isolated instrumentation are archived in
`research/effect-taint-performance/symbolic-*` and `profile-symbolic-counts.ts`. The notification
reference source is `/tmp/wm-before-symbolic-taint`, and the no-taint baseline is
`/tmp/wm-taint-baseline`. Reproduce a timing worker with:

```sh
deno run -A scripts/profile_taint.ts --root=ROOT --samples=7 --warmup=3
```

No commits were made.
