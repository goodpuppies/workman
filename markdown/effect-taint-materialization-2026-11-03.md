# Materializing effect taint during inference

This records the stored-flag prototype. See the
[sequence-tuple experiment](effect-taint-sequence-tuples-2026-11-03.md) for the subsequent
structural rewrite and new measurements.

This experiment moves taint resolution out of type rendering. `isTainted` reads the stored flag;
ordinary binding completion resolves nested flags, and module completion resolves all observed
expression and environment types. The final traversal shares clean answers only while HM types are
stable. Positive results discard their resolved dependency lists.

There is no callback-specific solver, notification graph, qualifier variable, or extra callback
polymorphism. Unknown results remain ordinary HM variables. The existing sequence dependencies are
still needed: HM binding a callback result does not by itself connect that discarded result to a
different, concrete sequence result. This change resolves those stored dependencies during inference
rather than every time the result is displayed. It does not eliminate provenance graphs or their
instantiation cost.

## Timings

Same machine and harness as [the initial investigation](effect-taint-performance-2026-11-03.md).
Three rounds ran sequentially in baseline/walking/materialized order, reversing the order in the
second round. Each process warmed up three rounds and recorded seven samples per workload. The table
uses the median of the three process medians. These local timings are descriptive, not confidence
intervals. All workloads completed without inference errors.

The no-taint reference is `/tmp/wm-taint-baseline`; the previous implementation is
`/tmp/wm-taint-walking`. Unrelated grammar and generated parser changes made during this work were
synchronized into both references before the final measurement. A recursive source comparison
confirms that the materialization changes relative to the walking version are confined to
`src/taint.ts`, `src/infer.ts`, and `src/infer/decl_binding.ts`.

| Workload                                 |  No taint | Previous taint | Materialized | vs previous | vs no taint |
| ---------------------------------------- | --------: | -------------: | -----------: | ----------: | ----------: |
| 250 scalar functions, partial inference  |  16.80 ms |       19.64 ms |     20.94 ms |       +6.6% |      +24.7% |
| Same, with declaration snapshots         |  28.08 ms |       72.83 ms |     35.45 ms |      -51.3% |      +26.2% |
| Same source, warm `checkSource`          | 159.73 ms |      222.19 ms |    174.50 ms |      -21.5% |       +9.2% |
| 250 polymorphic tuple bindings           |  11.45 ms |       15.36 ms |     17.90 ms |      +16.5% |      +56.3% |
| 100 higher-order functions               |  16.38 ms |       22.68 ms |     25.64 ms |      +13.1% |      +56.5% |
| 150 functions with effectful nested data |  18.60 ms |       22.34 ms |     23.51 ms |       +5.2% |      +26.4% |
| 150 functions storing latent lambdas     |  16.85 ms |       20.63 ms |     21.68 ms |       +5.1% |      +28.7% |
| Standard library, 73 modules, partial    | 152.50 ms |      236.50 ms |    255.64 ms |       +8.1% |      +67.6% |
| Standard library, 73 modules, snapshots  | 166.76 ms |      275.94 ms |    276.92 ms |       +0.4% |      +66.1% |

The scalar snapshot workload improves by about 51%, and normal warm source checking improves by
about 21% relative to the previous implementation. Standard-library inference with snapshots is
essentially unchanged. Partial standard-library inference becomes about 8% slower. Materialization
adds work at binding and module completion even when snapshots are omitted.

This is not a zero-overhead implementation. Against the no-taint reference, the standard-library
workloads remain about 66–68% slower. Runtime execution of emitted programs was not measured.

A reverse-notification experiment was discarded after a large inference slowdown. Resolving every
expression eagerly and repeatedly resolving the entire environment before each snapshot were also
discarded. Neither approach remains in the implementation.

## Validation and artifacts

`deno task check` passes. The selected inference, compiler, semantic, LSP, FFI, numeric, and
diagnostic suite passes all 236 tests, including 19 focused taint regressions. Formatting checks and
`git diff --check` also pass.

Regression coverage includes late callback substitution, concrete callback annotations, captured
callbacks, nested containers, latent function bodies, returned closures before invocation, and
mutually recursive bindings whose effects become known later in the group. No unknown callback is
assumed effectful merely because its result is unresolved.

Raw samples and the driver are preserved in the gitignored
`research/effect-taint-performance/materialized-results.json` and
`research/effect-taint-performance/run-materialized-comparison.py`. The driver expects the two
reference source copies listed above. The shared harness remains `scripts/profile_taint.ts`.
