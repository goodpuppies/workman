# Effect-taint performance investigation

This records the initial implementation. See the
[materialization follow-up](effect-taint-materialization-2026-11-03.md) for the subsequent compiler
changes and new measurements.

The current addition has a material compile-time cost. The earlier 250-function, partial-inference
benchmark understated the cost of ordinary source checking, standard-library inference and
declaration snapshots. No compiler implementation was changed during this investigation.

## Comparison

Measured on Linux, AMD Ryzen 7 5800X3D, Deno 2.9.8, V8 15.0.245.2-rusty. The working tree is based
on `4e9b523` with local changes. The reference tree at `/tmp/wm-taint-baseline` matches the current
`src/` tree except for the taint implementation. In particular, the generated parser, frontend, FFI
resolver and unrelated existing changes match. This was checked with a recursive source diff.

Three independent process pairs ran sequentially, alternating baseline/current order. Each worker
validates the synthetic sources, warms up three rounds and records seven samples per workload.
Reported numbers are the median of the three process medians. The change column compares those
medians; ranges below use individual paired process medians. These are descriptive local
measurements, not confidence intervals.

| Workload                                        |  Baseline | With taint |  Change |
| ----------------------------------------------- | --------: | ---------: | ------: |
| 250 scalar functions, partial inference         |  16.44 ms |   20.26 ms |  +23.2% |
| Same, with declaration snapshots                |  26.80 ms |   73.46 ms | +174.1% |
| Same source, normal `checkSource`, warm library | 140.24 ms |  213.03 ms |  +51.9% |
| 250 polymorphic tuple bindings                  |  10.61 ms |   15.71 ms |  +48.2% |
| 100 higher-order functions                      |  16.07 ms |   22.54 ms |  +40.2% |
| 150 functions with effectful nested containers  |  17.77 ms |   22.57 ms |  +27.0% |
| 150 functions storing latent effectful lambdas  |  16.45 ms |   20.03 ms |  +21.7% |
| Standard-library wave, 73 modules, partial      | 146.75 ms |  238.61 ms |  +62.6% |
| Standard-library wave, 73 modules, snapshots    | 162.37 ms |  278.71 ms |  +71.7% |

The main results were consistent across pairs: source checking was 51.8–52.8% slower, partial
standard-library inference 61.3–63.3% slower, and the scalar snapshot workload 171.4–177.7% slower.
The small nested-data workload varied more: 22.7–42.2% slower.

The first source check in each process, including library initialization, measured 2.60 s versus
2.91 s (+12.2% by medians; individual paired increases 5.8–14.9%). This excludes importing the
compiler's JavaScript modules and is not a cold filesystem or empty Deno cache measurement. Its
large initialization cost masks much of the inference-specific overhead.

Prepared-AST inference excludes parsing, JS reflection, FFI preparation and semantic-project
construction. Each standard-library wave creates fresh inference results in dependency order, with
fresh results supplied to importers. Every wave checks that there were no inference errors. Partial
inference omits declaration snapshots; the snapshot variant calls `inferModule`. These modes also
differ in recovery behavior, so their difference is not a pure snapshot microbenchmark. The
`checkSource` row includes parsing, preparation and the normal standard-library imports, with the
library already initialized.

These measurements concern compilation. They do not benchmark execution of emitted Workman programs.

## CPU profile

Separate V8 CPU profiles start after parsing, library preparation and warm-up, and record 15
measured rounds of the same nine workloads at a requested 100 microsecond sampling interval.
Profiled wall times were not used for the comparison table.

| Inclusive sampled time over the profile  | Baseline | With taint |
| ---------------------------------------- | -------: | ---------: |
| Type rendering, `show`                   |   483 ms |   2,773 ms |
| Taint queries, `isTainted`               |   absent |   1,840 ms |
| Type-scheme instantiation, `instantiate` |   124 ms |     656 ms |
| Unification, `unify`                     |   796 ms |   1,976 ms |
| Garbage collection                       |   881 ms |   1,087 ms |

Inclusive rows overlap and must not be added together: rendering and unification both include taint
queries. Profiler control and idle samples are not useful compiler work; absolute totals are only
diagnostic samples, not the unprofiled latencies above.

Of the self time sampled in `isTainted`, 66.9% was under type rendering and 33.0% under unification.
The routine caches a positive answer on the queried type, but returns a clean answer without caching
it. A nontrivial query creates two arrays and two visited sets, then follows the stored
type/provenance references.

Declaration snapshots render the entire environment after each declaration. With 250 user bindings,
those bindings alone account for 31,375 renders, before basis bindings. Each snapshot repeats
clean-taint traversals for earlier bindings. This explains why the snapshot workload grows much more
than partial inference. It also affects the normal strict source-check path.

Instantiation is a second cost: the prototype copies provenance dependencies in addition to the
ordinary HM type shape. Additional alias chains also increase pruning work. Garbage collection
increased in absolute sampled time, but it does not explain most of the regression.

## Next optimization targets

1. Avoid rewalking resolved clean provenance during type display. Reuse answers at boundaries where
   inference cannot mutate the underlying types, or collapse resolved dependencies before repeated
   rendering. Do not cache a clean answer prematurely while a callback or sequence source is still
   unresolved.
2. Retain and substitute only the provenance dependencies that are still needed during
   instantiation, rather than copying resolved expression ancestry.
3. Rerun this exact comparison and the late-callback, nested-container and latent function
   regressions before claiming the overhead is negligible.

No new qualifier polymorphism or separate solver is proposed by these findings. The current cost is
in the implementation's repeated graph traversal and copying.

## Real-project limitation

The 47-module `/home/ellie/git/atview/app/main.wm` project was attempted without modifying its
sources. Both baseline and taint compilers fail during initial partial inference with
`Buffer expects 1 type arguments`, in `tui/png.wm`. Consequently it is excluded from the timing
table. The 73-module standard-library wave is the valid real-code workload used here.

## Reproduction and artifacts

The harness is `scripts/profile_taint.ts`:

```sh
deno run -A scripts/profile_taint.ts --root=/tmp/wm-taint-baseline --samples=7 --warmup=3
deno run -A scripts/profile_taint.ts --root=/home/ellie/git/wm-mini --samples=7 --warmup=3
```

Repeat in alternating order, with no other benchmark or test process running. `--only=stdlib-wave`
selects one workload. Each invocation emits raw JSON samples.

For profiles (omit profiling when comparing timings):

```sh
deno run -A scripts/profile_taint.ts --samples=15 --warmup=3 --profile=/tmp/current.cpuprofile
```

With narrow Deno permissions, CPU profiling additionally requires `--allow-sys=inspector`. The
harness does not execute the Workman programs.

Gitignored raw artifacts are in `research/effect-taint-performance/`: `results.json`,
`cpu-summary.json`, `current.cpuprofile`, and `baseline.cpuprofile`. The V8 profiles can be opened
in DevTools.

Validation: the harness passes `deno check` and formatting checks. Both compiler variants completed
all benchmark workloads without inference errors. The existing compiler regression suite was not
rerun because compiler source was unchanged in this investigation; its preceding run passed 234
selected tests.
