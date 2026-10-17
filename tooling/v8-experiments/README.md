# V8 parser optimizations, 2026-10-15

Deno's CPU profiler identified a small runtime-emitter change that cuts measured parser time by about **15%**. The equality helper now rejects unequal primitive values before looking for vector symbols. The change is in `src/core/emit_prelude.ts`; `scripts/build_frontend_v2.ts` regenerated `src/generated/frontend_v2_parser.js`. The regenerated artifact differs from the timed candidate only by two comments. No PEG generator changes are installed.

## Profile first

The existing `scripts/profile_frontend_v2.ts` scans 273 WM files under `std`, `examples` and `tooling` (1,550,630 source characters in this working tree). Its `surface` mode includes raw parsing, surface decoding, file reads and startup. A separate profile of the optimized artifact uses exactly the same scan. These are diagnostic executions, not the unprofiled performance samples below.

```sh
deno run -A --cpu-prof --cpu-prof-md \
  --cpu-prof-dir=_scratch/v8-optimization --cpu-prof-name=parser.cpuprofile \
  scripts/profile_frontend_v2.ts surface 1
```

Deno writes both `.cpuprofile` and a detailed Markdown report with hot functions and a call tree. `summarize_cpu_profile.py` additionally merges source frames across recursive calling contexts and weights samples using `timeDeltas`. Its inclusive attribution counts a given source frame once per sample, avoiding inflated totals from recursion. Its percentages use all sampled time, including idle; do not mix them with Deno's generated Markdown percentages.

| Sampled self time, time-weighted | Original | Early primitive check |
| --- | ---: | ---: |
| Entire recorded interval | 13,049 ms | 11,022 ms |
| `__wm_eq` | 1,448 ms (11.09%) | 44 ms (0.40%) |
| Garbage collector | 2,017 ms (15.46%) | 2,078 ms (18.85%) |
| `matchSequenceInto` | 1,029 ms (7.89%) | 761 ms (6.90%) |
| `buildCompiledCapture` | 975 ms (7.48%) | 977 ms (8.86%) |
| `__wm_is_tuple` | 656 ms (5.03%) | 720 ms (6.53%) |

These are two individual sampled profiles, not precise causal accounting of every difference. Equality's large drop supports the change directly. GC time remains approximately unchanged; its larger percentage after the change does not establish a GC regression. This optimization removes runtime work rather than demonstrating fewer parser allocations.

## Independent unprofiled measurements

Deno 2.9.7 / V8 15.0.245.2-rusty, Linux x86_64, Ryzen 7 5800X3D. Each fresh process preloads inputs, checks complete raw parser-output hashes, warms up, then times another batch using `performance.now()`. Construction, validation, hashing and logging are outside the measured region. Runtime order reverses each round. Every compared artifact produces identical hashes and successful hot-loop parse checks. All five samples are retained in [results-summary.json](results-summary.json).

The larger corpus contains seven files: factorial, standard lists, frontend-v2 surface runtime and generated dispatcher, the wmslang compiler and slice emitter, and frontend-v3's parser/program module. A measured batch parses each twice, following a two-pass warmup. Five interleaved samples give:

| Scratch variant | Median parser time | Reduction from original |
| --- | ---: | ---: |
| Original | 2,879 ms | — |
| Early primitive rejection | 2,443 ms | 15.1% |
| Shared literal/class tables only | 2,759 ms | 4.2% |
| Early primitive rejection + shared tables | 2,423 ms | 15.8% |

Original samples range from 2,772–2,955 ms; primitive-check samples from 2,373–2,489 ms. Combined samples overlap the primitive-only samples, so the extra benefit of shared tables after this fix is not established. The generator change remains a scratch experiment.

A second comparison uses the earlier three-file corpus (factorial, lists, frontend-v2 surface runtime), six passes per measured batch and five interleaved samples. The regenerated production parser takes **562 ms versus 663 ms**, a **15.3% time reduction**. These results concern raw in-memory parsing; they are not a claim of a 15% improvement in complete WM compilation.

## Candidates and decisions

- **Apply the early primitive check.** `__wm_eq` previously performed several optional symbol lookups for vectors and slices before reaching its primitive rejection. Unequal numbers, strings, booleans and unit cannot be structural containers. Checking immediately after identity avoids that work. Structural object, ADT, array and vector comparisons remain on the existing paths.
- **Do not specialize literal equality sites yet.** A scratch AST transform replaced 86 eligible calls with strict comparisons when an operand was a primitive literal. Three calibration samples did not improve the larger corpus. That calibration included profile-summary processing during part of the run and is not a final uncontended comparison. It provided no reason to pursue the change; the applied runtime fix handles the wider hot path anyway.
- **Retain constant pooling as an experiment.** The PEG generator emits literal code lists and character-class descriptors at rule execution sites. A scratch transform pools 194 distinct immutable lists across 371 sites within their existing rule modules. This tests the allocation decision without modifying the generator or changing constructor layouts. The standalone improvement is modest, and the combined result does not establish an additional gain after the equality fix.

`prepare_literal_equality.ts` and `prepare_constants.ts` model the latter candidates in generated JS. They accept a scratch destination and an optional source artifact. They are not production postprocessors. A generator implementation of pooling would need to preserve module scope, initialization and bounded generated-file sizes; it should be measured again on top of the current emitter.

## Remaining profile-guided work

The post-change profile still contains substantial sequence/choice matching, capture-tree construction, tuple discrimination and memo-table operations, with roughly two seconds of sampled GC. That provides concrete places to inspect in `tooling/frontend-v2/generator/compiled_probe_emitter.ts`, `compiled_probe_runtime.wm`, `surface_parse_runtime.wm` and the Core emitter.

Sequence/choice rules build lists of callbacks at execution time; indirect callback calls pass source/offset tuples, and matching repeatedly checks ADT/tuple shapes. Parsing also constructs a compiled capture tree before converting it to parse values and Surface nodes. These are identifiable mechanisms, not measured allocation counts. Next experiments should specialize one hot combinator path or remove one intermediate capture layer, then collect a new Deno profile, compare full outputs, and measure the same corpus without instrumentation. Avoid a broad rewrite based solely on how the generated source looks.

## Validation and limitations

- `deno task check` passes.
- The original targeted run had **91 passing tests and two failures**. Both reproduced with the original artifact through an explicit import-map override: the supported-semantics test rejects the existing `.{ ... }` record example, and the repository semantic-golden test encountered an experimental fixture outside its recorded corpus. That fixture was removed when the native-backend experiment was closed. No goldens or expectations were rewritten to hide those failures.
- Cleanup validation on October 17 passes 41 inference/lowering, diagnostics and runtime-equality tests plus `deno task check`. With the experimental fixtures gone, the repository Surface semantic-golden test reaches a hash mismatch for `tooling/frontend-v2/generated/compiled_probe_rules_15.wm`. The original parser from `HEAD` produces the identical actual hash and failure, verified through an import-map override. This is remaining corpus/golden debt, not a new mismatch introduced by the equality optimization or cleanup.
- Two new runtime-equality tests cover primitives (including NaN and signed zero), nested records/tuples/ADTs, vectors and slice identity semantics.
- `verify_parser.ts` matches 36 complete results across valid, malformed and empty inputs, checking raw ASTs, failure diagnostics, formatting and formatting fixes against the original parser.
- Raw profiles can be large (hundreds of MiB because of recursive calling contexts); they stay under `_scratch`. The compact results retain timings, checked output hashes and profile summaries. These corpus runs do not establish full parser conformance or allocation counts.

## Reproduction

Retain an original artifact under scratch before rebuilding; for this working-tree change the original can also be read from `HEAD`:

```sh
mkdir -p _scratch/v8-optimization/artifacts
git show HEAD:src/generated/frontend_v2_parser.js > _scratch/v8-optimization/artifacts/baseline.js
deno run -A scripts/build_frontend_v2.ts
python tooling/v8-experiments/compare.py \
  --case baseline _scratch/v8-optimization/artifacts/baseline.js \
  --case current src/generated/frontend_v2_parser.js \
  --samples 5 --iterations 2 --output _scratch/v8-optimization/current-comparison.json
python tooling/v8-experiments/compare.py \
  --case baseline _scratch/v8-optimization/artifacts/baseline.js \
  --case current src/generated/frontend_v2_parser.js \
  --samples 5 --iterations 6 --corpus small --output _scratch/v8-optimization/current-small.json
deno run -A tooling/v8-experiments/verify_parser.ts \
  _scratch/v8-optimization/artifacts/baseline.js src/generated/frontend_v2_parser.js
```

Run profiling and compilation separately from timing comparisons. For isolated generator controls, pass the same baseline artifact as the optional second argument to the preparation scripts. Original artifacts, profiles, Deno's generated Markdown, complete samples and baseline-failure logs from this investigation are under `_scratch/v8-optimization/`.
