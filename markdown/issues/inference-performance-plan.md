# Compiler performance plan

Status: planned, not started. Measured on 2026-11-04 at `31750e2`.

The inference benchmark is now faster than it was before effect taint existed, but real programs are
not. Inference is only about 11 to 15% of a real run, and parsing is more than half. Start with
[real programs](#real-programs), not with inference.

## Real programs

These analyze real programs through `analyzeFile` or `wm check`, including parsing and module
loading. Times are in ms.

| Program, repeated analysis in one process  | No taint | `490cfe1` | `31750e2` |
| ------------------------------------------ | -------: | --------: | --------: |
| `examples/factorial.wm`                    |     53.3 |      55.8 |      53.1 |
| `examples/webhook.wm`                      |    127.7 |     137.3 |     139.0 |
| `tooling/tuiman/demo.wm`                   |    480.4 |     524.2 |     485.6 |
| `tooling/pakman/pakman.wm`                 |   1262.4 |    1394.4 |    1339.8 |
| `tooling/wmslang/compiler.wm`              |   2176.5 |    2392.9 |    2281.0 |
| `tooling/frontend-v2/compiler_frontend.wm` |   5246.3 |    5681.9 |    5379.9 |

| Program, fresh `wm check` process | No taint | `490cfe1` | `31750e2` |
| --------------------------------- | -------: | --------: | --------: |
| `examples/factorial.wm`           |     2753 |      2926 |      2827 |
| `examples/webhook.wm`             |     3261 |      3460 |      3330 |
| `tooling/wmslang/compiler.wm`     |     5541 |      5801 |      5620 |
| `tooling/pakman/pakman.wm`        |     8421 |      8967 |      8703 |

Across all ten programs measured, the current build compares like this:

- **Fresh `wm check`:** 3 to 5% faster than `490cfe1`, and 1 to 4% slower than no taint.
- **Repeated analysis, large programs:** 4 to 7% faster than `490cfe1`, and 1 to 6% slower than no
  taint.
- **Repeated analysis, small programs:** mixed against `490cfe1`, from 5% faster to 5% slower, and
  up to 11% slower than no taint on `ffi_reflection_stress.wm`. These runs are short, so small
  differences may be noise.

### What each commit cost

Fresh `wm check`, median of five rounds, in ms. Each step changes one thing: `de73691` adds taint,
`89e5bfa` includes only grammar and parser changes under `src/`, `490cfe1` adds LSP and `!` fixes,
and `31750e2` makes constraint diagnostics lazy.

| Program                       | `4e9b523` | `de73691` | `89e5bfa` | `490cfe1` | `31750e2` |
| ----------------------------- | --------: | --------: | --------: | --------: | --------: |
| `examples/factorial.wm`       |      2753 |      2858 |      2917 |      2948 |      2775 |
| `examples/webhook.wm`         |      3264 |      3393 |      3478 |      3468 |      3325 |
| `tooling/wmslang/compiler.wm` |      5390 |      5653 |      5827 |      5774 |      5724 |
| `tooling/pakman/pakman.wm`    |      8446 |      8719 |      8969 |      9109 |      8731 |

- **Taint commit:** +3 to +5%, including the closed-scheme skip that offsets part of it. Accepted on
  2026-11-04 as near enough to zero, so removing it is not a goal in itself.
- **Grammar changes:** +2 to +3%.
- **LSP and `!` fixes:** about zero, within noise.
- **Lazy constraint diagnostics:** -1 to -6%. This is unrelated to taint, so it hides the taint cost
  and does not remove it.
- **Net since `4e9b523`:** +1 to +6%.

Repeated analysis in one process is noisier, and agrees in direction on large programs. `pakman.wm`
goes 1295, 1375, 1417, 1413, 1369 ms over the same commits.

Where the time goes, from CPU profiles:

| Phase                          | `wmslang/compiler.wm`, warm | `factorial.wm`, fresh process |
| ------------------------------ | --------------------------: | ----------------------------: |
| Parsing and surface projection |                         54% |                           57% |
| Module interface and facts     |                         14% |                            2% |
| Garbage collection             |                         14% |                            9% |
| Inference, including taint     |                         11% |                           15% |
| Deno runtime and startup       |                             |                           10% |

### Priorities for real programs

Each of these is a profile reading, not yet a measured result.

1. **Stop reparsing the standard library.** A fresh `wm check` of `factorial.wm` spends about 1.8 s
   of 2.8 s in the parser, nearly all of it on library modules that never change. Caching the parsed
   library, on disk or as a generated artifact, is likely the largest gain available by a wide
   margin.
2. **Speed up the parser.** It is PEG-style memoized rule matching, and an expression descends
   through about a dozen precedence levels (`rule_Or` to `rule_Primary`). It accounts for most of
   the time on large programs too, and for much of the garbage collection.
3. **Fix `semanticInferredTypeHints`.** It takes 163 ms per run on `wmslang/compiler.wm`.
   `addPattern` runs `typedNodes.find` and `[...result.facts.patternTypes].find` for each pattern,
   which is quadratic in module size. Indexing by span should remove nearly all of it.
4. **Stop re-reading clean taint links.** `carries` takes 52 ms and `isTainted` is 38 ms on
   `wmslang/compiler.wm`, about 3% together, and is the largest taint cost on real programs.
   `resolve` caches only a positive answer, so an unresolved link is walked again by every reader,
   including the semantic snapshot. A snapshot runs after inference, when links could be collapsed
   once.

The rest of this issue covers inference only, measured on the benchmark.

## Inference benchmark

Median of three process medians, seven samples after three warm-ups, with process order reversed on
alternate rounds. "No taint" is `4e9b523` plus the closed-scheme skip in `ftvEnv`.

| Workload                     | No taint | `490cfe1` | `31750e2` | Vs no taint |
| ---------------------------- | -------: | --------: | --------: | ----------: |
| `stdlib-wave`                |    146.0 |     173.1 |     118.2 |        -19% |
| `stdlib-wave-with-snapshots` |    157.5 |     191.2 |     138.6 |        -12% |
| `polymorphic-250`            |     11.0 |      12.6 |       9.2 |        -17% |
| `latent-functions-150`       |     13.2 |      15.3 |      11.4 |        -14% |
| `higher-order-100`           |     15.0 |      18.3 |      13.3 |        -11% |
| `nested-data-150`            |     15.9 |      20.2 |      14.5 |         -9% |
| `scalar-250`                 |     11.4 |      12.9 |      11.5 |         +1% |
| `scalar-250-with-snapshots`  |     22.9 |      29.2 |      27.9 |        +22% |
| `scalar-250-check-source`    |    131.0 |     158.4 |     156.5 |        +19% |

Times are in ms. The gain from `31750e2` would also speed up a build without taint, so it does not
mean taint is free. An ablation at `490cfe1` measured taint at about 16 ms of operations and 7 ms of
structure on `stdlib-wave`.

### Where inference time goes

CPU profile of `stdlib-wave` at `31750e2`, 20 samples, about 123 ms of inference per wave. Times are
per wave. Inclusive figures overlap.

| Function               | Self | Inclusive |
| ---------------------- | ---: | --------: |
| `inferExprInner`       | 10.0 |           |
| `unify`                |  8.3 |      22.2 |
| Garbage collector      |  7.7 |           |
| `constrainAt`          |  2.5 |      24.7 |
| `collectProvenance`    |  4.8 |       6.4 |
| `sourceForTypedExpr`   |  4.1 |       4.2 |
| `originForSource`      |  4.0 |       5.9 |
| `sourceAt`             |  1.5 |       7.8 |
| `withSchemeProvenance` |      |       6.5 |
| `generalizeBinding`    |      |       5.4 |
| `findMissingCases`     |  2.0 |       3.6 |
| `joinTypeTaints`       |  1.7 |           |
| `taintExpression`      |  1.4 |           |

### Inference candidates, most promising first

These are unmeasured until ablated. Each estimate is what the profile suggests, not a result.

#### 1. Make the remaining provenance lazy

The provenance functions above are still eager, and they serve diagnostics. They are the largest
group left, possibly 10 to 20 ms a wave, using the same reasoning as the `constrainAt` change:
nothing reads them unless a constraint fails.

The difficulty is that `provenance` records state over time, and a later failure reads what earlier
successful constraints recorded. It cannot simply be rebuilt from a failure, as a single
constraint's trace could. Options:

- Store the inputs and compute origins and sources when read.
- Run inference without provenance, and on the first failure rerun the module with it on. This is
  the bigger win but requires inference to be restartable, including facts and FFI obligations.

Check `sourceForTypedExpr` first. It also compares `show` output, in `provenance.ts`, which may be
avoidable on its own.

#### 2. Find what `scalar-250-with-snapshots` spends

It is the largest gap over the baseline that comes from inference code, at +22%. The likely cause is
`createSemanticTypeArena` calling `isTainted` on every type and keeping two identity maps, but this
has not been confirmed. Profile this workload before changing anything.

#### 3. Split `scalar-250-check-source`

The +19% includes parsing, and the baseline predates `d04d72f`'s grammar changes, so an unknown
share is not inference. Measure parsing and inference separately, against a baseline on the same
grammar. There may be nothing to fix.

#### 4. Look inside `inferExprInner`

10 ms of self time is the largest single entry, in a large switch where V8 has probably inlined
callees. Split it or ablate case by case to see what is really there. The eager
`recordExpectedExprType` and fact recording are worth checking.

#### 5. Reduce environment copying

`new Map(env)` runs per block, lambda and match arm (`expr_flow.ts`, `expr_lambda.ts`), and for
recursive bindings in `decl.ts`. Earlier notes guessed this was large, but the profile bounds it:
the self time of `inferBlock`, `inferLambdaTy` and `inferMatch` together is at most about 6.5 ms a
wave. A persistent map or scope chain could remove most of that, at the cost of touching every `env`
user. Worthwhile only after the items above. Sharing the map in blocks with no declarations is a
cheap first step.

#### 6. Trim the taint operations

These are now small, about 3 ms self between `joinTypeTaints` and `taintExpression` on the profile.

- `unify` walks both sides in `joinTypeTaints` and then again in `prune`. One walk could do both.
- `taintExpression` allocates an input array and does a `Map` lookup per child, for 18,186 calls a
  wave.
- `open` and `carries` re-walk the same concrete types as calls nest (11,343 and 13,215 visits a
  wave). A permanently clean concrete type could be marked, for example with `tainted: false`. Joins
  would then have to clear that mark, since `{ ...a, args }` copies it.

#### 7. Reduce allocation and `prune` calls

`prune` runs about 410,000 times a wave, and the garbage collector takes about 6%. `Ty` also has one
object shape per tag, so sites that read `tag` are megamorphic. A single shape for all of `Ty` might
help all of inference, but it is an invasive change with an uncertain return. Try it last, on a
branch.

## Taint correctness

Performance work must not lose `!`. Over-taint in an edge case is an acceptable trade, and losing
taint is not.

One known loss remains: a generic `let (a, b) = p; [a]` can lose the inner `!`, although the outer
`!` still holds at the call. See `markdown/effect-taint-bit-on-type-2026-11-04.md`. Fix it
independently of this plan.

## How to measure

- **Real programs:** benchmark gains must be confirmed here before they are claimed. `stdlib-wave`
  runs hot inference on parsed library modules, with no parsing, module loading or real program.
- **Timing:** `deno run -A scripts/profile_taint.ts --root=ROOT --samples=7 --warmup=3`, with
  process order reversed on alternate rounds. Compare against a `git archive` of the baseline
  commit.
- **Attribution:** use ablation, timing a copy with one piece disabled. Profile self times mislead,
  because inlining differs between builds. Use profiles to find candidates, not to size them.
- **Counts:** add temporary counters to a copy, never to the tree.
- **Diagnostics:** `constrainAt` was checked by comparing diagnostic JSON byte for byte against the
  previous commit, over failing programs that bind variables before the mismatch. Do the same for
  any provenance change. That script was a throwaway, so a committed version would be useful here.
- **Tests:** `tests/compiler_*` must be part of the selection for inference changes. Leaving them
  out hid 88 failures in `de73691`.

## Known limit of the `constrainAt` change

A failing constraint rewinds its bindings to rebuild the trace. That cannot undo path compression,
or a binding made by a constraint callback that throws before `onBind` runs. A rare diagnostic could
show a slightly different intermediate type. None of the 46 compared programs did.
