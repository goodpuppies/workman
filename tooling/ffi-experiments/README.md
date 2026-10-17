# WM FFI profiling on wmthree

## Baseline, 2026-10-15

Profile the current pipeline before comparing TypeScript backends. The entry is `../wmthree/src/scripts/play.wm`, run with **wmthree as the working directory** and wm-mini's Deno config selecting the compiler's dependencies. Both working trees have existing uncommitted changes; [wmthree-results.json](wmthree-results.json) records repository HEADs, runtime versions and hashes of the 28 WM input modules actually measured.

Three successful fresh-process executions without CPU sampling take **8.49–8.73 seconds** inside the graph-loading/analysis driver, median **8.61 seconds**. Process wall times are 8.68–8.95 seconds. OS/package caches are warm; compiler caches begin empty in each process. This is staged analysis, not JS emission, application startup or execution of the game.

The workload has 28 application WM modules and 207,875 source characters. Initial TS reflection loads 666 source/declaration files, about 5.49 million characters, from 81 requests combined into 13 roots. The installed checker is **TypeScript 6.0.3**, behind `typescript-api`; Deno is 2.9.7 / V8 15.0.245.2-rusty. No replacement checker was installed or integrated for this baseline.

## Where the time goes

Median wall times across the three executions:

| Analysis phase | Time |
| --- | ---: |
| Load WM module graph, including parsing | 1,694 ms |
| Prepare initial JS reflection | 2,844 ms |
| Prepare FFI bindings | 301 ms |
| Load standard library | 804 ms |
| Initial partial inference | 356 ms |
| Contextualize delayed callbacks | 10 ms |
| Resolve delayed FFI | 1,621 ms |
| Post-resolution partial inference | 339 ms |
| Resolve delayed FFI, second pass | 269 ms |
| Final inference | 357 ms |

These are independently computed medians, so their sum need not equal the median total. The initial-reflection phase is reported against the first graph node (`trig.wm`) by the existing pipeline hook; it is a **whole-graph batch**, not a cost attributable to that module's own FFI imports.

Reflection instrumentation gives this separate breakdown, nested inside those phases:

| Reflection metric | Median / stable count |
| --- | ---: |
| Program preparations | 90 |
| Initial batch | 81 requests / 13 roots |
| Subsequent single-probe preparations | 89 |
| All batch preparation time | 4,836 ms |
| `ts.createProgram` time | 3,817 ms |
| `program.getSemanticDiagnostics()` time | 985 ms |
| Timed reflection-read callbacks | 171 calls / 58 ms |
| Prepared reads / reads requiring preparation | 82 / 89 |
| Preparation for those 89 misses | 2,035 ms |
| `deno info` subprocesses | **533** |
| Subprocesses whose specifier ends in `.d.ts` | **529** |
| Time waiting for `deno info` | **2,051 ms** |

Do not add these rows: subprocess time occurs mostly inside `createProgram`, and fallback preparation is part of all batch preparation. The program construction already uses `previousProgram` and caches for source ASTs, filesystem operations and module resolution. The 90 calls are observed despite those caches; they do not imply reparsing all 666 files 90 times.

`getTypeChecker()` itself measures essentially zero because the code calls `getSemanticDiagnostics()` first, which has already caused checker work. The new `diagnosticsMs` field makes that previously hidden work explicit. Likewise, 58 ms is the time inside the `reflectSource` **read callbacks**, including type conversion; it excludes their preceding program preparation and does not mean the entire TypeScript checker costs only 58 ms.

## Deno CPU evidence

A separate Deno CPU-profiler run completes in approximately 8.9 seconds of recorded time. Deno's generated Markdown provides hot functions and a call tree. The `.cpuprofile` also lets us follow sampled `op_spawn_sync` frames through:

```text
TypeScript module resolution
  → host.resolveModuleNames
    → denoResolvedModule
      → resolveDenoSpecifier
        → denoModuleGraph
          → runtime.runSync
            → deno info --json <importing file>
```

About **1.91 seconds** of time-weighted samples have that child-process path. The later explicit per-process timers independently measure about 2.05 seconds across 533 children. Those are waiting/elapsed-time costs attributed by the profiler, not proof that the WM process spent that time executing CPU instructions. The profile makes clear that much of the apparent TypeScript program-creation cost is actually WM's resolver invoking Deno.

The branch in `resolveDenoSpecifier` discovers a graph for each not-yet-graphed existing importer when earlier resolution paths fail. In this workload that reaches hundreds of package declaration files. The following experiment changes discovery order for package declarations and checks its outputs against this baseline.

Time-weighted self samples additionally show roughly 522 ms in GC, 185 ms in diagnostic `snapshotType`, and substantial WM parsing/inference work. Percentages from `summarize_cpu_profile.py` use `timeDeltas` over all sampled time; Deno's Markdown uses different totals. Treat both as diagnostic views, and use the unprofiled runs for the baseline timings.

## What this means for a native TS backend

A faster compiler can still help, but the first comparison must include program loading, custom module resolution and the actual WM query protocol. General `tsc` throughput benchmarks do not establish the gain here.

Two immediately relevant investigations were:

1. Whether ordinary package `.d.ts` resolution can stay on TypeScript's resolver without launching hundreds of Deno processes, while retaining Deno-specific resolution where needed.
2. Whether call-specific probes can share a retained project/checker or be batched, instead of preparing a new program and requesting semantic diagnostics for each missed probe.

Then compare TS6 with tsgo/Rust on equivalent reflection outputs: overload choice, contextual callback types, generic return types, constructors and property/type mappings. This profiling step does not establish API compatibility or endorse a backend. Backend source research was paused to obtain this real workload baseline first.

## Resolver change and comparison

For declaration files under `node_modules`, resolution now checks known Deno mappings, then TypeScript's normal resolver, then discovers a Deno graph only if those paths fail. Other importers retain eager Deno discovery. This keeps known Deno mappings authoritative and retains the discovery fallback; it avoids starting a subprocess merely to resolve ordinary package declaration imports.

Three interleaved fresh-process samples per variant on October 15 isolate this resolver change using an import-map override for the baseline host. Both variants use the same compiler, application and profiling driver. [resolver-results.json](resolver-results.json) retains commands, samples, versions, output hashes and the subsequent CPU summary. The 28 WM input hashes still match the original baseline manifest on October 17.

| Metric, median unless count | Original resolver | Deferred package discovery |
| --- | ---: | ---: |
| Graph loading + staged analysis | 8,430 ms | **5,864 ms** |
| Whole process wall time | 8,630 ms | 6,059 ms |
| Initial JS reflection phase | 2,832 ms | 739 ms |
| All reflection preparation | 4,744 ms | 2,174 ms |
| `ts.createProgram` | 3,790 ms | 1,267 ms |
| Semantic diagnostics | 911 ms | 875 ms |
| Reflection read callbacks | 56 ms | 59 ms |
| `deno info` subprocesses | 533 | **4** |
| Time in subprocess calls | 2,051 ms | 20 ms |
| Program preparations | 90 | 90 |

Analysis time falls **30.4%**, or 1.44× throughput on this entry. These are warm filesystem/package caches and empty compiler caches in separate processes. This is not a measurement of a persistent LSP session, JS emission or running the game. Nested timing rows must not be added together.

Correctness checks compare every inferred binding in all 28 module environments and the complete emitted JS: both are byte-identical (252,582 and 835,444 bytes respectively). The two new resolver tests cover relative declaration imports without per-importer subprocesses and known Deno import-map precedence over a conflicting installed package. The former fails against the original resolver's subprocess count. The combined resolution, JS import, reflection and FFI elaboration tests pass **107/107**; `deno task check` and formatting checks pass. These checks do not establish equivalence for every possible Deno/package configuration.

### Remaining costs, October 17 CPU profile

A separate Deno `--cpu-prof --cpu-prof-md` run after the change has 6.83 seconds of sampled time. Its time-weighted summary attributes about 35 ms to `op_spawn_sync`, down from roughly 1.9 seconds in the earlier recording. It still shows 1.36 seconds inclusive in `createProgram` and 947 ms in semantic diagnostics, with 273 ms in `tryReuseStructureFromOldProgram` and 135 ms self time in `tryParseJson`. These are nested samples, not independent costs. Deno's generated Markdown separately confirms the parser, inference, diagnostics and JSON parsing as hot paths; its percentages use a different denominator from the time-weighted summarizer.

The unprofiled comparison is the performance evidence; this later sampled run identifies remaining work. There are still 89 single-query preparations after the initial batch, and individual reflection reads usually take a fraction of a millisecond while preparation takes tens of milliseconds. Existing `previousProgram` reuse is therefore insufficient to remove the query setup cost. The next FFI experiment should inspect retained project/checker state or batching of independent probes. Dependencies between inferred arguments and later queries prevent assuming that every query can simply be batched up front. Do not remove semantic diagnostics just for speed: the host currently uses them to reject unresolved imports.

Outside FFI, the new sample also has about 579 ms of GC self time, 183 ms of `snapshotType` self time and substantial generated-parser time. A native checker cannot eliminate those costs. The recordings are `/tmp/wm-ffi-profiles-2026-10-17/play-resolver.cpuprofile` and `play-resolver.md`; compact selected samples survive in `resolver-results.json`.

To reproduce the isolated resolver comparison, from wm-mini:

```sh
python3 tooling/ffi-experiments/prepare_resolution_baseline.py /tmp/wm-resolver-baseline
python3 tooling/ffi-experiments/compare_resolution.py \
  --baseline-map=/tmp/wm-resolver-baseline/baseline-import-map.json \
  --output=/tmp/wm-resolver-comparison --samples=3
```

Use a new baseline directory; the generator refuses to overwrite existing snapshots and fails if the resolver's expected source shape changes. It restores eager discovery only, retaining current instrumentation and other compiler changes. `check_output.ts` captures inferred environments and JS for the same entry without executing it; run it from wmthree with the compiler config and optionally the baseline import map, followed by an output prefix.

## Compatibility fixes and validation

`wmthree` had three manually typed safe imports of `Deno.args`. The compiler requires explicit `unsafe` for those declarations; a manually typed unsafe import is a raw value and has no automatic `Result` wrapper. The fixes retain `args: Js.Array<String>`, add `unsafe`, remove the obsolete wrapper handling, and retain fallible handling of `.at(...)` and numeric parsing:

- `src/engine/frame_limit.wm`: feed the raw array into the argument selector.
- `src/engine/physics_lab_backend.wm`: call `.at(0)` directly on the array.
- `src/engine/physics_lab_route.wm`: call `.at(2)` directly on the array.

Existing unrelated changes, including the migration from `Monad.lift` to `Monad.via`, are preserved. `play.wm` now passes checking; it emits pre-existing wide-tuple style warnings. A standalone probe imports all three argument modules and runs valid, missing and invalid arguments to check frame-limit/backend/route results. No SDL window or game runtime is launched for profiling.

The broader `physics_lab.wm` entry still stops on another pre-existing migration issue: manually typed safe Havok-helper imports beginning with `worldCreate` in `physics_lab_runtime.wm`. That module was not changed; this does not prevent the complete `play.wm` profile. Do not describe the entire wmthree repository as migrated.

In wm-mini, `deno task check`, checks of both profiling scripts, and 54 JS-import/FFI-elaboration tests pass. Profiling changes are observational: extra timers, `deno-info` events, graph-load timing, and optional `--json=PATH` output. The driver retains metrics and exits nonzero on analysis failures. The initial-reflection script also fixes its `three-direct` path lookup to use the entry node's path rather than its branded module ID.

## Reproduction

From wmthree:

```sh
deno run --config=../wm-mini/deno.json -A ../wm-mini/src/main.ts check src/scripts/play.wm

deno run --config=../wm-mini/deno.json -A \
  ../wm-mini/scripts/profile_reflection.ts src/scripts/play.wm \
  --json=/tmp/wmthree-reflection.json

mkdir -p /tmp/wmthree-profiles
deno run --config=../wm-mini/deno.json -A --cpu-prof --cpu-prof-md \
  --cpu-prof-dir=/tmp/wmthree-profiles --cpu-prof-name=play.cpuprofile \
  ../wm-mini/scripts/profile_reflection.ts src/scripts/play.wm \
  --json=/tmp/wmthree-profiled-reflection.json
```

Run each measurement in a fresh process and avoid concurrent builds/profiling during timing comparisons. The CPU profile includes imports/startup and report generation; the driver's phase timers cover graph loading and staged analysis.

Original logs, full reflection events, validation output and subprocess command records are under `wm-mini/_scratch/ts-backends/profile/wmthree/`. Large CPU recordings and Deno Markdown reports are under `/tmp/wm-ffi-profiles-2026-10-15/`. The compact result file alongside this document retains the three timing runs and a CPU summary if those temporary artifacts are removed.
