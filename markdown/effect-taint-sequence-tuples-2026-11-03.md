# Sequence-tuple taint experiment

This records the sequence-query prototype. See the
[construction/unification refactor](effect-taint-unification-2026-11-03.md) for its subsequent
replacement and new measurements.

## Representation

Sequences are internal tuple types with a selected member index. Ordinary tuples omit that index and
retain independent element types. A sequence exposes the selected member's shape to normal
unification, while its evaluated member types determine its scar. Local statement sequences expose
the last member; expression and pattern views can expose another member without unifying the
members' underlying types.

For example, `(Number!, String)` remains an ordinary tuple with a clean second position, while a
sequence producing a string after an effect produces `String!`.

Discarded callback results remain in the sequence tuple. They are visited during ordinary type
substitution, including callbacks with concrete annotations. Function bodies stay latent when a
function value is evaluated. Type copying stops at a discarded function's own scar; already copied
signature positions retain their shared identity. Known-tainted sequences collapse to a scarred
result at construction. A one-member sequence can give an unresolved type an independently scarred
occurrence.

Variable path compression retains sequence projections. Occurs checking compares value shapes, so
recursive references through discarded members do not become recursive value types. The shared
type-copy traversal handles those structural cycles. Diagnostic type comparisons and origin tracking
inspect the selected member.

## Removed machinery

The prototype removes `taintInputs`, `taintInputsDeep`, synthetic negative-ID aliases,
`copyTypeTaint`, the deferred taint-copy queue, and the binding/module taint-resolution passes.
Instantiation and type freshening now use a shared type-copy traversal. There is no
callback-specific solver or qualifier polymorphism.

This does not make taint free. Unresolved sequence tuples still retain structure, and querying their
scar traverses that structure. Positive results are cached. There is no separate provenance graph or
final resolution pass, but ordinary type copying still has to preserve sequence members and shared
signature positions.

## Validation

`deno task check` passes. The main inference, compiler, LSP, semantic, FFI, numeric, and diagnostic
suite passes all 238 selected tests, including 21 focused taint regressions. Additional GPU tests
pass 8 selection tests and 13 of 14 specialization tests; the one failure is reproduced below.
Formatting checks and `git diff --check` pass.

The focused regressions cover discarded effects, independent top-level declarations, clean and
tainted instantiations, concrete and unknown callbacks, branches, nested containers, latent and
captured lambdas, projections, FFI boundaries, recursive groups, and ordinary tuple independence.

The additional GPU catalog-skeleton test
(`v4 catalog skeletons contribute only universal HM
equalities`) fails with the same
`Number -> Result<Number!, Error>!` versus `'a -> 'a` mismatch in both the saved pre-rewrite source
and this rewrite. The reference reproduction uses the identical test source with
`/tmp/wm-before-sequence-tuple` compiler sources.

## Performance

Three sequential process triplets compare the no-taint baseline (`/tmp/wm-taint-baseline`), the
previous stored-flag prototype (`/tmp/wm-before-sequence-tuple`), and the sequence-tuple rewrite.
Order reverses in the second triplet. Each process warms up three rounds and records seven samples;
the table reports the median of its three process medians. All nine workloads validate without
inference errors. The grammar, generated parser, and unrelated source changes match across variants.

The harness, workload definitions, machine, and runtime are described in the
[initial investigation](effect-taint-performance-2026-11-03.md). These are descriptive local
measurements, not confidence intervals.

| Workload                                 |  No taint |  Previous | Sequence tuples | vs previous | vs no taint |
| ---------------------------------------- | --------: | --------: | --------------: | ----------: | ----------: |
| 250 scalar functions, partial inference  |  17.96 ms |  22.43 ms |        23.32 ms |       +4.0% |      +29.8% |
| Same, with declaration snapshots         |  29.88 ms |  38.93 ms |        57.37 ms |      +47.4% |      +92.0% |
| Same source, warm `checkSource`          | 175.17 ms | 190.49 ms |       226.04 ms |      +18.7% |      +29.0% |
| 250 polymorphic tuple bindings           |  11.92 ms |  19.64 ms |        14.82 ms |      -24.5% |      +24.3% |
| 100 higher-order functions               |  17.56 ms |  28.29 ms |        26.09 ms |       -7.8% |      +48.6% |
| 150 functions with effectful nested data |  19.51 ms |  27.00 ms |        24.83 ms |       -8.0% |      +27.2% |
| 150 functions storing latent lambdas     |  17.87 ms |  23.89 ms |        23.12 ms |       -3.2% |      +29.4% |
| Standard library, 73 modules, partial    | 161.94 ms | 270.99 ms |       263.24 ms |       -2.9% |      +62.6% |
| Standard library, 73 modules, snapshots  | 177.28 ms | 294.91 ms |       302.39 ms |       +2.5% |      +70.6% |

Polymorphic tuple bindings improve by about 25% relative to the previous implementation, but remain
about 24% above the no-taint baseline. Warm source checking regresses by about 19%, and scalar
snapshots by about 47%. Partial standard-library inference improves slightly; the small change does
not establish a consistent general speedup. Standard-library inference remains about 63% above the
no-taint baseline. This prototype does not meet the near-zero-overhead goal.

Earlier intermediate measurements are not comparisons of the final code. The first naive
implementation retained latent function signatures through sequence members and exhausted the V8
heap during library analysis; that implementation was discarded. Keeping the evaluated/latent
distinction in type copying allows the library wave to complete.

Raw samples and the comparison driver are preserved in the gitignored
`research/effect-taint-performance/sequence-results.json` and
`research/effect-taint-performance/run-sequence-comparison.py`. The shared harness is
`scripts/profile_taint.ts`. The reference copies are temporary local artifacts.
