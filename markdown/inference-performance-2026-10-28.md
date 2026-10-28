# Inference performance investigation

Measured on Windows against `C:/Git/atview/app/main.wm` (47 modules).
Existing local LSP fixes and scope-presentation sharing optimization were retained.

## Isolated inference

`research/profile_inference.ts` loads and elaborates the graph once, then measures eight
fresh dependency-ordered inference waves over the elaborated AST. This excludes parsing,
TS reflection, FFI rewriting, and building the semantic project snapshot. Fresh user-module
results are built each wave; standard-library import results retain normal sharing.

One sequential A/B run, changing only diagnostic rendering:

| Mode | Before | Deferred diagnostic rendering |
| --- | ---: | ---: |
| Strict, including declaration environment snapshots | 626.7 ms | 472.9 ms |
| Partial, without declaration snapshots | 596.6 ms | 414.5 ms |

These are averages within one run, not confidence intervals. Strict versus partial timing
does not isolate snapshots perfectly: they also differ in error handling. Both succeed here.

CPU sampling of the prepared inference benchmark plus initial staged analysis attributed
approximately 36% of samples within inference to `constrainAt`, including about 15% to
diagnostic type snapshotting. Other visible costs include provenance deduplication,
type-environment copying, free-variable scanning/generalization, and environment rendering.
These categories overlap and must not be added together. This is not a measurement of pure
HM unification alone.

## Implemented change

`createDiagnosticWriter` still captures immutable type shapes at introduction/substitution
time, preserving historical evidence. It renders those shapes into strings only when
`buildSupport` is requested. Successful constraints discard their writer without rendering.
No FFI, inference, generalization, or diagnostic semantics are intentionally changed.

## Older compiler comparison

`research/compare_inference.ts` parses the same 200 independent identity bindings in each
compiler, warms each three times, and measures 15 inference runs. One run measured:

- old `inferProgram`: 15.9 ms
- current strict: 20.7 ms
- current partial: 9.5 ms

This is a narrow synthetic benchmark with different bases and output artifacts. It does not
establish equivalent full-project or editor performance. The current engine is not uniformly
slower on basic HM workloads.

The old `src/layer1/context.ts` unification wrapper computes/composes a substitution or stores
a failure reason. Current `constrainAt` additionally creates support entries, type snapshots,
claims, edges, and provenance for successful constraints. The old engine still has its own
marks, provenance, constraint stubs, and later solver/presentation passes; it is not bare HM.

## Remaining targets

- Avoid constructing diagnostic support artifacts for successful constraints while preserving
  pre-mutation evidence and existing diagnostics. Deferred string rendering addresses only
  part of this cost.
- Audit strict declaration snapshots: REPL phrase output and type-trace consumers use them;
  ordinary LSP analysis does not appear to read them. Preserve the actual consumers.
- Measure type-environment copying and provenance separately before changing their ownership.
- Keep FFI behavior stable while investigating these costs; graph-wide staging is a separate
  multiplier, not the explanation for all per-pass work.

## CPU profile after deferred diagnostic rendering

`research/profile_inference_cpu.ts` prepares the elaborated 47-module graph, warms four
partial waves, then measures 24 partial waves and 24 strict waves. Named wrapper functions
identify each measurement window in the V8 CPU profile; startup, parsing, FFI preparation,
and snapshot construction are excluded from the reported windows. Fresh user inference
results are created in dependency order on every wave. This is full inference of already
elaborated ASTs, not the initial unresolved-FFI partial pass.

Command:

```powershell
deno run -A --cpu-prof --cpu-prof-dir=research --cpu-prof-name=inference-optimized.cpuprofile research/profile_inference_cpu.ts
python research/summarize_inference_cpu.py
```

Raw profile: `research/inference-optimized.cpuprofile` (about 218 MB).
Machine-readable summary: `research/inference-optimized-summary.json`.

Measured wall time per wave under CPU profiling: partial 533.5 ms, strict 629.1 ms.
These are slower than the earlier non-profiled A/B run. Use percentages to locate work;
do not compare these absolute timings directly to the earlier 414/473 ms measurements.

The following categories are exclusive, attributed by matching stack ancestry. Constraint
checking includes its nested evidence/provenance callbacks; the separate provenance category
contains only work outside that stack. GC samples are attributed by their position within
the measured loop, not by guessing which allocation caused them.

| Sample category | Partial ms/wave | Partial share | Strict ms/wave | Strict share |
| --- | ---: | ---: | ---: | ---: |
| Constraint checking and evidence | 140.7 | 26.4% | 150.8 | 24.0% |
| Type environment copying/scanning | 65.5 | 12.3% | 62.0 | 9.9% |
| Garbage collection | 51.7 | 9.7% | 101.8 | 16.2% |
| Generalization | 36.6 | 6.9% | 32.2 | 5.1% |
| Other provenance | 30.5 | 5.7% | 32.1 | 5.1% |
| Basis/import/environment setup | 28.2 | 5.3% | 25.1 | 4.0% |
| Scheme instantiation | 12.9 | 2.4% | 13.5 | 2.1% |
| Declaration trace snapshots | 0 | 0% | 42.5 | 6.8% |
| Remaining inference and runtime | 167.5 | 31.4% | 169.0 | 26.9% |

Selected inclusive function timings (overlap; do not add them):

| Function | Partial ms/wave | Strict ms/wave |
| --- | ---: | ---: |
| constrainAt | 140.7 | 150.8 |
| unify, including called functions and callbacks | 57.5 | 62.2 |
| cloneTypeEnv | 37.9 | 30.7 |
| dedupeOrigins | 36.8 | 38.2 |
| generalize | 33.1 | 28.2 |
| ftvEnv | 29.1 | 25.0 |
| diagnostic snapshotType | 21.4 | 21.9 |

`unify` self time is only 7.9/9.0 ms; this excludes recursive calls and therefore is not
the total cost of unification. Its inclusive cost also includes provenance callbacks.

Concrete follow-ups supported by this profile:

1. `inferBlock` clones the type environment, including its registry, for every block and
   scans known type IDs before the block and for individual declarations. Investigate
   sharing or copy-on-write for scopes that introduce no types, preserving local-type
   escape checks and nominal type registration.
2. `dedupeOrigins` repeatedly allocates composite string keys and sets. Its filter callback
   is one of the largest JavaScript self-time locations. Preserve exact deduplication and
   origin ordering while reducing repeated key construction.
3. Successful constraints still build snapshot shapes and diagnostic support records.
   Deferred rendering removed only the string formatting, not these allocations.
4. Strict trace snapshots add direct work and may contribute to higher GC. The profile
   does not attribute GC to a particular allocation site or prove the strict/partial GC
   difference is entirely caused by snapshots.

No further compiler changes were made for this profiling run.

## Follow-up: registry sharing and trivial provenance lists

Implemented copy-on-write for the private nominal-type registry used by `cloneTypeEnv`.
The visible name map still gets its own copy. Both parent and clone detach their shared
registry before registration; registering the exact same object again is a no-op. TypeInfo
objects remain shallow-shared as before. This does not share mutable inference variables
across additional module boundaries.

`dedupeOrigins` now returns a fresh array immediately for zero or one origin. Lists with
multiple entries retain the same composite-string key and first-occurrence behavior.

Quiet sequential A/B, eight prepared inference waves per mode, changing only `types.ts`
and `infer/provenance.ts` while retaining earlier optimizations:

| Mode | Baseline | Optimized |
| --- | ---: | ---: |
| Strict | 489.2 ms | 411.4 ms |
| Partial | 444.2 ms | 363.8 ms |

This is about 16–18% in one sequential run, not a confidence interval or separate attribution
of the two changes. An earlier run overlapping tests was noisy and did not show a benefit;
it is not used for the reported comparison.

Validation: 144 targeted tests covering inference bookkeeping, diagnostics, type elaboration,
records, and module interfaces passed; a further 17 tests covering bookkeeping, nominal
identities, FFI elaboration and reflection passed. The repeated bookkeeping tests verify writes
to a parent, sibling, child, and grandchild cannot leak through shared registry storage.
