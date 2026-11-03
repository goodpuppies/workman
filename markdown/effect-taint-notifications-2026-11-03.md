# Local taint notifications

Superseded by [symbolic summaries](effect-taint-symbolic-2026-11-03.md).

## Representation and update rules

Immediate child dependencies are recorded during construction and type copying. `evaluatedUsers` is
a weak map from a type position to the parents that consume its evaluated taint. One dependent is
stored directly; branching sources use a set. An ordinary tuple, structural record, or nominal
argument updates the parent's `containedTaint` summary. A sequence instead updates its outer scar
and scars its member occurrences. Function parameters and result types are latent: no edges lead
from a function signature to the function value's evaluated summary.

Outer scar equality has different semantics from directed containment. Unification merges outer
positions into union-find groups, including distinct concrete positions that have already been
unified. A late scar marks all members once. The groups preserve shared state through ordinary
substitution and unification rather than adding source-level qualifier variables. Positive groups
release their member lists after the transition.

A notification queue delivers only positive transitions; there is no recursive parent walk.
Evaluated subscriber lists are released when their source becomes positive. Branches and cycles are
supported. Sequence views share outer scar equality, and each shared sequence member array is spread
only once. New record fields and resolved FFI placeholders register their edges when those
structures change.

The binding-time `resolveType` traversal is removed, as are the old sequence-resolution checks in
unification. Ordinary tuple and nominal unification no longer refresh every child's summary after
recursive unification: their existing edges deliver changes directly.

## Instantiation

Normal type copying still copies the retained internal sequence members, rebuilding immediate edges
as it constructs the copied nodes. Reverse subscribers are never copied from the source. The
existing node-copy memo also maps original outer equality groups to their representatives in the new
instance. This preserves transitive sharing without a separate graph-copy traversal or connecting
independent concrete instances to each other. Captured unquantified HM variables retain their
existing identity under the ordinary instantiation rules.

Discarded function signatures still use the existing evaluated-copy path so their latent body
history is not expanded. Internal sequence representation and its retained member-copy cost have not
been removed by this change.

## Validation

The focused suite contains 34 tests, including immediate notification after source unification,
branching nested containers, a chain of 10,000 dependencies, a cyclic sequence dependency,
transitive concrete equality links copied independently, sequence-view consumers, record field
insertion, and late FFI resolution. Existing callback, captured closure, recursive binding,
container-position, latent function, and eliminator regressions remain covered.

Final verification: `deno task check` passes; the selected inference, compiler, FFI, diagnostics,
semantic-facts, and LSP suite passes **251 tests with zero failures**, including all 34 focused
taint tests. The diff whitespace check passes for the files changed by this refactor.

## Initial performance investigation

The first implementation used two sets of notifications, for outer scars and evaluated summaries. A
concrete equality-copy regression showed that copying structural children alone loses equality links
through intermediate type positions outside the signature. Outer equality was therefore represented
by union-find groups, copied through the existing memo.

An initial three-triplet comparison found library inference about 30% slower than the previous
local-summary implementation. A CPU profile showed construction/dependency registration, outer
unification, and garbage collection as significant costs. The implementation then avoided set
allocation for sources with one subscriber, removed redundant outer linking during variable binding,
and removed the obsolete scar update in pruning. The final measurements use this revised
implementation, including shared sequence views.

## Final performance comparison

Three process triplets compare the no-taint baseline, the previous local-summary version with
binding-time resolution, and the notification version. The second triplet reverses order. Each
process warms up three times and records seven samples; the table uses the median of the three
process medians. Prepared scalar/library workloads exclude parsing. Warm scalar source checking
includes parsing and warm standard-library setup. The library workload checks 73 modules with fresh
inference results and no declaration snapshots.

| Workload                | No-taint baseline |  Previous | Notifications | Change vs previous |
| ----------------------- | ----------------: | --------: | ------------: | -----------------: |
| scalar-250              |          17.49 ms |  23.14 ms |      25.48 ms |             +10.1% |
| scalar-250-check-source |         160.57 ms | 199.58 ms |     205.14 ms |              +2.8% |
| stdlib-wave             |         167.41 ms | 258.66 ms |     334.91 ms |             +29.5% |

The notification implementation removes recursive discovery but **does not meet the low-overhead
goal**. Library inference is about 30% slower than the preceding version and about twice the
no-taint baseline. The retained sequence/type-copy work remains, while recording dependencies and
preserving late equality sharing adds allocation and unification work. The single-subscriber
optimization did not establish a library speed improvement in these trials.

Raw final results are in `research/effect-taint-performance/notification-results.json`; initial
results and the exploratory initial CPU profile are archived alongside them. Reproduction uses:

```sh
deno run -A scripts/profile_taint.ts --root=ROOT \
  --only=scalar-250,scalar-250-check-source,stdlib-wave --samples=7 --warmup=3
```

The preceding source snapshot is `/tmp/wm-before-notifications`; the baseline is
`/tmp/wm-taint-baseline`. No commits were made.

## Follow-up: why direct notifications cost more

No compiler implementation changes were made in this investigation. Both versions were profiled for
15 prepared-AST library waves after three warmups, with parsing and library setup outside the
sampling interval. Isolated instrumented copies then counted operations for one library wave;
instrumented elapsed times are not used for performance comparisons.

| Sampled cost, 15 library waves                 | Previous | Notifications |
| ---------------------------------------------- | -------: | ------------: |
| Dependency construction / `refreshTaint`, self |    31 ms |        526 ms |
| Outer-scar joining / `joinTypeTaints`, self    |    47 ms |        398 ms |
| Removed `resolveType` pass, inclusive          |   148 ms |        absent |
| Notification delivery / `notify`, inclusive    |   absent |        101 ms |
| Instantiation, inclusive                       |   472 ms |      1,357 ms |
| Garbage collection, self                       |   236 ms |      1,356 ms |

Inclusive rows overlap, and sampling/inlining can attribute helper work to its caller. These are
profile attribution figures, not replacements for the unprofiled latency comparisons above.
Notification delivery itself is substantially smaller than dependency registration, equality
maintenance, and garbage collection. Eliminating the old discovery traversal saved a relatively
small part of the old work.

For a single 73-module library wave:

| Operation                               | Previous | Notifications |
| --------------------------------------- | -------: | ------------: |
| Type-copy operations                    |    9,454 |         9,454 |
| Type-node visits during copying         |  124,088 |       122,654 |
| Visits in evaluated/discarded-copy mode |   72,341 |        70,877 |
| Retained sequence nodes cloned          |   23,563 |        23,464 |
| Compound/primitive type nodes cloned    |   71,119 |        70,313 |
| Dependency registration calls           |        — |       123,167 |
| New directed dependency edges           |        — |       105,064 |
| Equality groups allocated               |        — |        18,303 |
| Branching subscriber sets allocated     |        — |        15,247 |
| Directed edge notifications delivered   |        — |        15,205 |

There are still about 23,500 retained sequence clones and 70,900 evaluated-copy visits per wave. The
notification representation therefore supplements almost all the existing recursive type-copy work
instead of replacing it. It adds weak-map operations, group/member-array allocation, subscriber
storage, and equality-sharing reconstruction across a much larger population than the positions that
actually deliver notifications in that wave. Many registered links may still be needed for future
inference; these counts do not justify dropping clean links indiscriminately.

The next representation target is the duplicated retained-history/dependency work and registration
cost, rather than further optimizing notification delivery. A concrete clean shape alone is not a
proof that a late taint edge is unnecessary.

The two profiles, profile summary, counter results, counter harness, and isolated instrumentation
patches are archived in `research/effect-taint-performance/notification-*`.
