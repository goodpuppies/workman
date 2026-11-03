# Taint joining during construction and unification

This experiment is superseded by [local notifications](effect-taint-notifications-2026-11-03.md).

## Rules and implementation

`unify(Number, Number!)` joins the scar. An ordinary tuple retains independent positions, so
`(Number!, String)` stays `(Number!, String)`. Constructing or resolving a sequence tuple joins
contained member taint, spreading the scar to its member occurrences while retaining each member's
underlying type. Functions contribute their own scar; their body types remain latent.

`sequenceType` resolves the currently known member taint at construction. The existing HM
unification entry point calls `joinTypeTaints`, which now resolves sequence operands before their
selected value shapes are compared. A positive join updates the sequence's shared member array, so
local views observe the same scar without parent notifications. Frozen primitive constants remain
unchanged; scarred occurrences are independent values.

An unresolved sequence retains its members for ordinary substitution. This is an unresolved
computation of its scar, not an open record, extensible tuple, or another kind of open type. The
binding-signature constructor resolves nested sequence positions after the declaration group's
equations have been unified. It follows visible type positions and selected sequence results,
without separately traversing discarded function bodies. This handles returned closures and mutually
recursive bindings.

A proposed extra traversal when binding every variable to a compound type was removed: ordinary
unification already reaches the relevant sequence operands. No qualifier variables, callback solver,
parent notification graph, extra instantiation pass, or module-wide propagation phase was
introduced. The existing type-copy traversal and sequence representation are unchanged.

`isTainted` now reads only the value's stored scar through ordinary variable substitutions and
selected sequence members. It does not inspect discarded members or nested container positions,
allocate visited sets, or mutate the type. Type display and semantic snapshots therefore do not
discover effects. The contained-member traversal exists only for constructing/resolving sequences.

## Validation

`deno task check` passes. The selected inference, compiler, LSP, semantic, FFI, numeric, and
diagnostic suite passes all 241 tests, including 24 focused taint tests. Formatting and
`git diff --check` pass.

New coverage verifies that primitive unification joins scars while ordinary tuple siblings stay
independent, and that an unresolved sequence is joined by unification rather than by reading or
rendering it. Incoming scars through HM aliases also spread to all sequence views. Existing coverage
retains late callbacks, concrete callback annotations, returned closures, independent
instantiations, nested containers, latent functions, recursive groups, FFI boundaries, and
diagnostic origins.

## Performance

Three process triplets ran sequentially, reversing order in the second triplet. Each process warmed
up three rounds and recorded seven samples per workload. The table uses the median of the three
process medians. These local measurements are descriptive, not confidence intervals. All workloads
completed without inference errors. Machine, runtime, and workload definitions are described in the
[initial investigation](effect-taint-performance-2026-11-03.md).

The no-taint reference is `/tmp/wm-taint-baseline`. The preceding sequence implementation is
`/tmp/wm-before-unify-spread`. A source comparison confirms that grammar, generated parser, and
unrelated source changes match; this refactor changes only `src/taint.ts` and
`src/infer/decl_binding.ts`, plus the focused regression tests and reports.

| Workload                                 |  No taint | Previous sequence | Construction/unification | vs sequence | vs no taint |
| ---------------------------------------- | --------: | ----------------: | -----------------------: | ----------: | ----------: |
| 250 scalar functions, partial inference  |  17.14 ms |          21.88 ms |                 22.81 ms |       +4.3% |      +33.1% |
| Same, with declaration snapshots         |  29.29 ms |          53.37 ms |                 44.60 ms |      -16.4% |      +52.3% |
| Same source, warm `checkSource`          | 158.73 ms |         206.26 ms |                184.83 ms |      -10.4% |      +16.4% |
| 250 polymorphic tuple bindings           |  11.56 ms |          13.73 ms |                 14.27 ms |       +4.0% |      +23.4% |
| 100 higher-order functions               |  16.74 ms |          25.07 ms |                 25.85 ms |       +3.1% |      +54.4% |
| 150 functions with effectful nested data |  18.66 ms |          23.96 ms |                 24.91 ms |       +4.0% |      +33.5% |
| 150 functions storing latent lambdas     |  16.69 ms |          21.70 ms |                 22.76 ms |       +4.9% |      +36.4% |
| Standard library, 73 modules, partial    | 155.03 ms |         244.39 ms |                250.07 ms |       +2.3% |      +61.3% |
| Standard library, 73 modules, snapshots  | 167.39 ms |         288.05 ms |                275.23 ms |       -4.4% |      +64.4% |

Warm source checking is 10.4% faster than the preceding sequence implementation, and scalar
snapshots 16.4% faster. Against the no-taint baseline, source checking retains 16.4% overhead, and
partial standard-library inference 61.3% overhead. This does not meet the near-zero-overhead goal.
It removes a measured source of repeated work; it does not remove the cost of retaining and copying
unresolved sequence structure.

## Source-check CPU profile

Separate profiles record 40 warm checks of the same 250-function scalar source, after five warm-up
rounds, at a requested 100-microsecond sampling interval. Profiled times were not used for the
timing table. Inclusive rows overlap and must not be added together.

| Sampled time over 40 checks            | Previous sequence | Construction/unification |
| -------------------------------------- | ----------------: | -----------------------: |
| Taint reader (self)                    |            540 ms |                    35 ms |
| Sequence member check (self)           |                 — |                     4 ms |
| Binding type normalization (inclusive) |                 — |                     9 ms |
| Type rendering (inclusive)             |          1,880 ms |                 1,070 ms |
| Environment snapshots (inclusive)      |          2,179 ms |                 1,350 ms |
| Pruning (self)                         |            426 ms |                   400 ms |
| Garbage collection (self)              |          1,363 ms |                   801 ms |

Previously, 521 of the reader's 540 sampled milliseconds were under environment snapshots. The new
reader no longer traverses discarded/contained members or allocates traversal arrays and sets. No
`containsTaint` or `resolveType` samples occurred under environment snapshots in the new profile.
Normalization is performed during inference, before rendering. The existing compiler still captures
full environment snapshots after declarations; this refactor does not change that API behavior or
add a snapshot cache.

## Remaining costs and artifacts

Unresolved member types remain part of sequence types for substitution, including callback returns
whose ordinary value type is already concrete. A clean observation at one point cannot be frozen as
permanently clean before the relevant unifications. The shared type-copy traversal still visits
sequence members and preserves signature sharing. These costs remain visible in the library and
higher-order workloads.

Raw artifacts are gitignored under `research/effect-taint-performance/`: `unification-results.json`,
`run-unification-comparison.py`, `unification-source-profile-summary.json`,
`unification-source.cpuprofile`, and `sequence-query-source.cpuprofile`. The driver uses the
reference copies above. The shared harness remains `scripts/profile_taint.ts`.

## Library-profile follow-up

A separate profile comparison records 20 prepared-AST library waves (73 modules per wave), after
three warm-up waves. Each compiler uses the same harness with
`--only=stdlib-wave --samples=20
--warmup=3 --profile=...`. These are partial inference waves
without declaration snapshots. Profiles use a requested 100-microsecond sampling interval. Profiled
totals are not replacements for the unprofiled timing table above.

| Sampled time across 20 library waves           | No taint | Construction/unification |
| ---------------------------------------------- | -------: | -----------------------: |
| Scheme instantiation (inclusive)               |    73 ms |                   477 ms |
| Instantiation type-copy traversal (self)       |    54 ms |                   439 ms |
| Contained member check, `containsTaint` (self) |   absent |                   422 ms |
| Type pruning (self)                            |    26 ms |                   167 ms |
| Binding type normalization (inclusive)         |   absent |                   128 ms |
| Unification (inclusive)                        |   455 ms |                 1,023 ms |
| Garbage collection (self)                      |   263 ms |                   308 ms |
| Taint reader (self)                            |   absent |                     5 ms |

Inclusive rows overlap: instantiation includes type-copy work, and unification includes sequence
normalization and pruning. Do not add the rows together.

This workload exposes costs that the scalar source-check profile understates. Taint queries during
rendering are no longer the main issue. Sequence members are still retained and recursively checked
during construction/unification, and copied during instantiation. `copyType` allocates two node maps
and copies primitive occurrences even for clean types, in addition to normal variable freshening.
Preserving sequence wrappers also prevents the original pruning routine from fully compressing
through those wrappers. These are implementation costs, not the cost of joining a single Boolean
bit.

The raw profiles and summary are gitignored in `research/effect-taint-performance/` as
`unification-library.cpuprofile`, `baseline-library.cpuprofile`, and `library-profile-summary.json`.
No compiler implementation changes were made during this follow-up.

## Immediate-child joins and the remaining completion problem

The follow-up removes `containsTaint` and its recursive searches. Tuple, record, and nominal
construction now summarize evaluated taint from immediate children, independently of the outer scar.
Structural unification and type copying refresh that summary on their existing return paths.
Sequence resolution reads those immediate summaries, following only substitution/result links.
Function signatures remain latent. Three additional regressions cover eliminators, nested late
substitution, and independent nested tuple positions (27 focused tests).

This does **not** eliminate the binding-time `resolveType` traversal. An experiment deleting it
produced four failing focused regressions: discarded nested containers, returned closures, mutually
recursive bindings, and nested late substitution. It was restored. A fully HM-resolved concrete
shape does not establish that its taint can no longer change; the current representation has no
local completion notification for the enclosing sequence. Moving this traversal into another
unrelated pass would not resolve that representation problem. No notification graph or new solver
was added. Removing the traversal remains unfinished.

Three alternating process pairs (seven samples after three warmups) comparing the previous
implementation with immediate-child joins are in `/tmp/wm-local-join-comparison.json`. Median of
process medians: library inference 250.48 -> 243.37 ms; warm scalar source checking 186.92 -> 181.15
ms; scalar partial inference 21.82 -> 23.19 ms. This is mixed performance, not a near-zero-overhead
result. The larger 241-test selection passed before the three additional regressions; the final
focused suite passes all 27 tests.
