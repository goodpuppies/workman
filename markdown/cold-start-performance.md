# Cold-start compiler performance

Status: 2026-08-03

This document records the current cold-start performance work, the benchmark
project, how to reproduce the measurements, what has already improved, and the
most promising next steps.

The priority is small projects started in a fresh Deno process. ~~TypeScript FFI
reflection is intentionally not the immediate focus because the TypeScript Go
API may change that part of the implementation soon.~~ **Revised: reflection is
now 27.8% of `coreFile`, second only to parsing, and it is not `tsc`'s type
checker doing the work — it is `createProgram` parsing megabytes of `.d.ts`.
See "What `wm run` actually spends, end to end".**

## Benchmark project

The working benchmark is `~/git/atview`, with `app/main.wm` as the entry point:

```sh
cd /home/ellie/git/atview
```

The imported program graph is small enough that startup should feel immediate,
but large enough to expose parser and analysis overhead:

- 26 imported Workman modules
- 124,031 bytes in the imported graph
- 43 `.wm` files and 5,737 lines in the whole repository
- approximately 447 KB of generated JavaScript

JavaScript emission takes only about 18-21 ms, so it is not a meaningful part
of the current startup delay. `wm run` compiles the graph and then launches the
program; atview itself continues running without terminal output, so use the
compiler-only measurements below when investigating startup.

## Current result

Measurements here are separate fresh Deno processes, not repeated compilation
inside one process.

| Measurement | Before | Current | Change |
| --- | ---: | ---: | ---: |
| `coreFile("app/main.wm")` | 5,152 ms | 3,137 ms average | about 2,015 ms / 39% faster |
| Parser only, 43 files / 148 KB | 3,000 ms | 1,756 ms | about 41% faster, 48.5 -> 82.8 KB/s |
| Module graph loading | about 2,947 ms | about 2,250-2,330 ms | parser dispatch is substantially cheaper |
| Generated parser dispatch self time | 534 ms | 43 ms | about 92% lower |
| Generated parser total CPU time | 2,554 ms | 1,794 ms | about 760 ms / 30% lower |
| JavaScript emission | 18.5 ms | about 21 ms | effectively unchanged |

The current `coreFile` cold-process samples were 3,160.4 ms, 3,155.0 ms, and
3,094.6 ms, averaging 3,136.7 ms.

A trivial single-file program compiles in about 548 ms. That is the fixed floor
(basis, standard library, TypeScript reflection). Everything above it scales
with the imported graph, so the remaining cost is per-byte frontend work rather
than startup constants.

The full phase profiler currently reports approximately 4.4 seconds. It still
builds the complete language-service project snapshot, while `wm run` and the
compile commands now use the leaner compiler-only analysis path. Therefore the
phase profiler is useful for finding expensive stages, but it is not an exact
measurement of the current `wm run` compiler path.

## Changes retained so far

### Constant-time generated parser dispatch

The generated frontend-v2 parser previously selected a grammar rule using a
large `match((name, recover))`. With 132 grammar rules and strict/recovering
variants, this became 264 arms. Workman's generated JavaScript implemented the
match as a linear `else if` chain, repeatedly checking names and tuple shapes on
every rule invocation.

The generator now emits separate strict and recovering `Dict` tables that map a
rule name directly to its parser function. `makeCompiledParser` selects the
appropriate table and performs one lookup while retaining the existing per-
parse memo cache.

Relevant files:

- [compiled_probe_emitter.ts](../tooling/frontend-v2/generator/compiled_probe_emitter.ts)
- [compiled_probe_dispatch.wm](../tooling/frontend-v2/generated/compiled_probe_dispatch.wm)
- [frontend_v2_parser.js](../src/generated/frontend_v2_parser.js)
- [frontend_v2_grammar_ir_test.ts](../tests/frontend_v2_grammar_ir_test.ts)

The semantic golden changed only because the generated dispatch artifact hash
changed.

### Lean compiler analysis

`wm run`, file compilation, and library compilation do not need the complete
language-service project snapshot. They now build `CoreProgramAnalysis`, which
contains the facts required by code generation without constructing interfaces,
occurrences, completion data, and other editor-only state.

`analyzeFile` continues to build the full `ProgramAnalysis` for LSP and tooling
consumers, preserving their behavior.

Relevant files:

- [program_analysis.ts](../src/program_analysis.ts)
- [compiler.ts](../src/compiler.ts)
- [materialize.ts](../src/wmslang/materialize.ts)

On this benchmark, the full project snapshot accounted for roughly 341 ms of
CPU time. The remaining compiler-only fact construction is about 86 ms.

### Prelude helpers hoisted out of the hot path

`__wm_js_receiver_member` rebuilt its owner path on every call with
`path.slice(0, -1).reduce(...)`, allocating an array per FFI receiver call. The
path is fixed when the binding is created, so it is now resolved once at closure
construction. `__wm_js_apply` converted arguments through an extra `map`
allocation, which is now done in place.

This alone moved the parser benchmark from 3,000 ms to 2,531 ms.

### Map-backed `Js.Table` for hot caches

`Js.Dict` must stay a plain JavaScript object: it is FFI-visible, passes
`assertJsCompatible`, and is treated as object-like by the JSON path. Its
representation therefore cannot change.

`Js.Table` was added as a Map-backed sibling that deliberately does *not* cross
the FFI boundary, which is exactly what frees it from that contract. The parser
memo cache and the strict/recovering rule tables now use it. `Dict.set` fell
from 397 ms to 62 ms of self time; the benchmark moved 2,531 ms to 2,159 ms.

Relevant files:

- [basis_manifest.ts](../src/basis_manifest.ts)
- [types_basis.ts](../src/types_basis.ts)
- [emit_prelude.ts](../src/core/emit_prelude.ts)

### Numeric memo slots instead of built string keys

`compiledRuleMemoKey` built a fresh key like `Name@1234@1@0` per rule
invocation: a `toString`, a `Result` allocation, six string concatenations and
their tuples. Because the string was new every time it never had a cached hash,
so V8 rehashed roughly twenty characters on every memo probe.

The cache is now two-level. The outer key is the rule name, which is a string
literal with a cached hash; the inner key is a number,
`offset * 4 + diagnose * 2 + recover`. Key construction and string hashing both
disappear from the hot path. The benchmark moved 2,159 ms to 1,756 ms.

### Cached line starts for `offsetToLineCol`

`offsetToLineCol` scanned the source from offset zero on every call and was
invoked per node, costing about 212 ms. It now reuses the existing
`offsetToLineColFromStarts` binary search over a bounded per-source cache of
line starts. Verified equivalent against the old implementation, including
out-of-range offsets, which the scan clamped to the end of the source.

## Measured constraints and negative results

These bound future work; do not re-litigate them without new measurements.

- ~~The tuple representation is already near optimal.~~ **Withdrawn — this was
  wrong, and it was wrong because it rested on a `deno bench` microbenchmark.**
  Tagging every tuple cost about 9% of parse time, measured in situ; see "The
  tuple tag was the single biggest cost" below. The microbenchmark had reported
  all representations within noise of each other, because a tight monomorphic
  loop lets V8 cache the map transition that the real parser pays for. The one
  conclusion that survived is that `Object.setPrototypeOf` is catastrophic —
  confirmed in situ at four times slower.
- When benchmarking allocation, keep the allocated values reachable. An earlier
  version of the tuple benchmark reported 0.25 ns per tuple because escape
  analysis had removed the allocation entirely.
- A `Dict.get` fast path that avoided `Object.hasOwn` on misses was neutral and
  was reverted rather than added to every emitted program.

## Where the remaining parser time goes

Profiled with a 100us sampling interval, which is necessary here: at the default
1ms interval there are too few samples to trust the tail.

```sh
deno run --cpu-prof-dir=pf --cpu-prof-name=parser.cpuprofile \
  --cpu-prof-interval=100 --cpu-prof-md --cpu-prof-flamegraph \
  -A bench_parse.ts /home/ellie/git/atview
```

`--cpu-prof-md` writes a ready-made report with self and total time per
function, which is more useful than a self-time-only summary because it
separates a function's own cost from its subtree.

The remaining cost is not a long tail of unrelated small things. It is one
theme, allocation, spread across several functions:

| Function | Self | Note |
| --- | ---: | --- |
| `(garbage collector)` | 18.0% | consequence of allocation |
| `__wm_tuple` | 10.3% | allocation |
| `__wm_is_tuple` | 9.2% | checking those tuples |
| `__wm_basis_Cons` | 2.4% | allocation |
| `buildCompiledCapture` | 8.3% self, 22.2% total | mostly subtree cost |
| `Table.setAt` + `Table.get` | 5.3% | after the memo rework |

### The measurement that matters

Counting allocations directly, for a 1,746 byte module:

- 443,143 tuples created, about **254 tuples per source byte**
- 445,038 `__wm_is_tuple` checks, a ratio of **1.00 per tuple created**
- 5,372 capture nodes built, so captures are not the allocation driver
- packrat memo hit rate of only **15.9%**, 905 hits against 4,784 misses

The 1.00 ratio is the important one. Every tuple that is created is destructured
exactly once, which means essentially all of them are function arguments in a
create, pass, destructure pattern rather than data being stored. Backtracking is
not throwing captures away, and the tuple encoding itself is already optimal.
The cost is that the calling convention allocates.

### Design: arity raising (implemented and reverted, see below)

Workman is an SML: a function takes a single tuple argument, so tuple passing
cannot simply be removed. But a *direct call to a statically known function*
with a literal tuple of matching arity can avoid materializing that tuple, while
the tupled entry point stays for first-class and partial use.

For a function whose arms all destructure one tuple of arity N with simple
variable elements, which covers the parser's helpers, emit both forms:

```js
const f__d3 = (a0, a1, a2) => { /* body, parameters bound directly */ };
const f = (__arg) => f__d3(__arg[0], __arg[1], __arg[2]);
```

Then rewrite `f(__wm_tuple(x, y, z))` into `f__d3(x, y, z)`. Semantics are
preserved because `f` still exists unchanged.

This removes the allocation and the entry check on the hot path, so it should
reach `__wm_tuple` and `__wm_is_tuple` (19.5% of self time) plus a large share
of the 18% spent in garbage collection. The relevant emission sites are
`CoreApp` and `CoreTuple` in [emit_js.ts](../src/core/emit_js.ts). It changes
code generation for every Workman program, so it needs the full suite and a
byte-identical bootstrap fixed point, not just the parser benchmark.

The 15.9% memo hit rate is a separate lead. Removing memoization entirely was
already measured at roughly 3x slower, so the question is not whether to
memoize but which rules are worth memoizing.

## Arity raising

Implemented in [emit_js.ts](../src/core/emit_js.ts). A function whose single arm
destructures a tuple of simple variables gets a second, multi-parameter entry
point; the tupled entry point stays for first-class and partial use, so SML
semantics are preserved. Calls to a statically known function with a literal
tuple of matching arity are routed to the direct form.

```js
const f__wm_d3 = (a, b, c) => { /* body, parameters bound directly */ };
const f = (__arg) =>
  __wm_is_tuple(__arg) && __arg.length === 3
    ? f__wm_d3(__arg[0], __arg[1], __arg[2])
    : __wm_fail(...);
```

### It has to cross module boundaries

A first attempt collected candidates per module and was not worth keeping: 269
functions each gained a forwarding hop, but only 218 call sites were rewritten.
The hot calls are cross-module. Helpers such as `matchSequenceInto` are defined
in the runtime module and reached from the generated rule modules through
`__wm_module_N["..."]`, so a per-module pre-pass misses exactly the calls that
dominate the profile.

Collecting across the whole program fixes this. Binding ids are program-global,
and an imported value is already aliased under the *exporting* module's binding
id, so one map keyed by binding id resolves call sites in any module. Each
module additionally exports its direct entry points under `<name>__wm_dN`, and
import alias emission binds them.

Specialized call sites went from 218 to 2,164.

### Result

Interleaved A/B, alternating artifacts within one session so thermal drift
affects both equally:

| Round | Baseline | Arity raised |
| --- | ---: | ---: |
| 1 | 1,837 ms | 1,655 ms |
| 2 | 1,834 ms | 1,626 ms |
| 3 | 1,851 ms | 1,742 ms |
| average | 1,841 ms | 1,674 ms |

About 166 ms, or 9%, with the arity-raised build ahead in every paired round.

Interleaving mattered. An earlier non-interleaved comparison made the
intra-module variant look like a 3% regression when the builds were in fact
within noise of each other; the machine had drifted between measurements. Trust
the count of specialized call sites for the mechanism and paired runs for the
timing.

## Recursive coverage: where the remaining tuples come from

Arity raising skips recursive bindings, and that is where the hot loop lives.
All six hottest matchers are declared `let rec` in
[compiled_probe_runtime.wm](../tooling/frontend-v2/compiled_probe_runtime.wm):
`matchSequenceInto` (72.3% total, 6.4% self), `matchChoiceAt` (72.0% / 4.3%),
`matchRepeatedInto`, `matchCodes`, `classContains`, `reverseInto`. In the
generated JavaScript they appear without a `__wm_d` suffix while their thin
non-recursive wrappers (`matchSequence_211__wm_d4`, `matchChoice_241__wm_d4`)
did get specialized. The specialization is landing on the wrappers and missing
the loops.

That is why tuple allocation only fell from 254 to 203 per source byte.

Attributing `__wm_tuple`, `__wm_is_tuple` and `__wm_basis_Cons` samples to their
calling function gives 329 ms of allocation-helper time, split roughly:

| Caller | Share |
| --- | ---: |
| `buildCompiledCapture` + `buildCompiledCaptureList` | 14.4% |
| `matchSequenceInto` | 7.0% |
| `matchChoiceAt` | 5.8% |
| `reverseInto` (both copies) | 5.2% |
| `matchRepeatedInto` | 1.6% |

Note that already-specialized functions still allocate (`matchLiteral__wm_d5`
2.9%, `wrapCompiledRule__wm_d3` 2.0%), because they call constructors and
unspecialized recursive callees.

### Two distinct wastes in the tail-loop form

Both are visible in `matchSequenceInto`, and neither is addressed by the current
pass.

**1. The self tail call rebuilds the argument tuple every iteration.**
`emitTailExpr` in [emit_js.ts](../src/core/emit_js.ts) emits
`__arg = <tuple>; continue label;`, and the loop head destructures `__arg`
again. Fix: hold the parameters in mutable locals and assign them through
temporaries on the tail call, so no tuple is materialized per iteration.

```js
const t0 = e0, t1 = e1; p0 = t0; p1 = t1; continue label;
```

**2. A `match` on a tuple literal materializes its scrutinee.**
`emitTailExpr` for `CoreMatch` emits
`const __wm_tail_value_N = __wm_tuple(...)` purely so the arm patterns can
destructure it:

```js
const __wm_tail_value_15 = __wm_tuple(parsers_183, diagnose_184, source_185, ...);
if (__wm_is_tuple(__wm_tail_value_15) && __wm_tail_value_15.length === 6 && ...)
```

This is general, not tail-loop specific: the ordinary `CoreMatch` path emits
`((__v) => {...})(<scrutinee>)`. When the scrutinee is a `CoreTuple` literal and
every arm is a `CorePTuple` of the same arity, the elements can be bound to
temporaries and matched element-wise, skipping both the allocation and the
`__wm_is_tuple` and `length` checks.

`patternChecks` and `emitPatternBind` address sub-values as `${value}[${index}]`,
so this needs them to accept a per-element accessor rather than a single value
expression. That is the main piece of work.

## Recursive coverage (option B)

Arity raising now covers recursive bindings, including the tail-loop form. When
a recursive function is eligible, the loop runs over the parameters directly, so
a self tail call assigns them through staged temporaries instead of rebuilding
the argument tuple:

```js
const f__wm_d6 = (a, b, c, d, e, g) => {
  __wm_tail_3: while (true) {
    ...
    const __wm_tail_arg_7_0 = ...; /* staged so assignment is simultaneous */
    a = __wm_tail_arg_7_0; ...
    continue __wm_tail_3;
  }
};
```

`emitTailExpr` takes the loop parameters and, when the tail argument is a tuple
literal of matching arity, never materializes it. A non-literal argument is read
element-wise from the existing value, which also allocates nothing.

All the hot matchers are now specialized (`matchSequenceInto__wm_d6`,
`matchChoiceAt__wm_d6`, `reverseInto__wm_d2`), and no `__arg = __wm_tuple(...)`
rebuild remains in the generated parser.

### Result

Tuple allocation fell from 203.3 to 171.3 per source byte, against 254 before
any arity raising.

Interleaved A/B over six rounds:

| | Previous | Recursive coverage |
| --- | ---: | ---: |
| average | 1,748 ms | 1,664 ms |

About 85 ms, or 4.8%, ahead in five of six rounds.

### Allocation count is a weaker predictor than assumed

A 16% cut in tuples bought about 5% of time, and the first three rounds read as
only 2% before more rounds firmed it up. Two lessons:

- Three interleaved rounds are not enough at this noise level. Six were needed
  before the effect was clear.
- Allocation-helper attribution overstated the available win. Roughly 20% of
  allocation-helper time sat under the recursive matchers, but removing most of
  their tuples returned far less than that. Young-generation allocation in V8 is
  cheap enough that the remaining cost in those functions is genuine matcher
  work, not the allocation itself.

That materially weakens the case for chasing the rest of the allocation cluster,
including constructor payload flattening (option D). The capture builders and the
per-character FFI path are now the better targets.

## Allocation is not the lever; two neutral results

Two separate changes removed real per-call allocation and returned nothing.

**Recursive coverage** cut tuple allocation by 16% (203.3 to 171.3 per byte) and
returned about 5% of time.

**FFI receiver hoisting.** The emitted binding for a receiver member rebuilt its
closure and converter list on every call:

```js
const ...charCodeAt_0_7 = (__arg) =>
  __wm_js_apply(__wm_js_receiver_member(["charCodeAt"]), __arg, ["id","id"], "id", "result");
```

`__wm_js_receiver_member(["charCodeAt"])` ran per character read, allocating the
path array and constructing a fresh closure, plus the `["id","id"]` literal.
Hoisting all three to binding time measured **neutral**: 1,614 ms against
1,610 ms over five interleaved rounds, with the hoisted build ahead in three.
It was reverted, since it is neutral and the IIFE wrapper makes emitted output
less readable, which works against the direct-style goal.

The conclusion for future work is that V8 handles short-lived allocation and
closure construction well enough that removing it is not reliably profitable
here. Allocation counts are a good *diagnostic* for finding where work happens,
but a poor *predictor* of what removing it will buy.

Prefer targets that remove genuine computation:

- `buildCompiledCapture` and `buildCompiledCaptureList`, about 20% total time
  each, are the largest remaining subtree and are parser-level rather than
  codegen-level. They can be attacked in the `.wm` sources or the generator
  without touching the compiler.
- The packrat memo hit rate is still 15.9%. Most memo entries are stored and
  never reused, so the work is the storing, not the lookup. Deciding *which*
  rules are worth memoizing is real computation removed, not allocation moved.

Constructor payload flattening (option D) should be considered dropped: it is
the riskiest remaining option, it is purely an allocation change, and the two
results above predict it returns little.

## Measuring wall-clock time

Run commands from the atview repository so relative imports resolve as they do
for a real invocation.

For a user-facing cold `wm check` measurement:

```sh
cd /home/ellie/git/atview
TIMEFORMAT='wall=%3R user=%3U sys=%3S'
time deno run -A /home/ellie/git/wm-mini/src/main.ts check app/main.wm
```

atview currently produces many warnings. Redirect them when only timing is
needed:

```sh
time deno run -A /home/ellie/git/wm-mini/src/main.ts check app/main.wm \
  > /tmp/atview-check.out \
  2> /tmp/atview-check.err
```

Use at least three separate command invocations when comparing a change. A
single cold run is noisy, and iterations inside one Deno process measure warm
caches rather than the startup experience.

## Profiling compiler phases

The phase profiler shows where typechecking time is spent:

```sh
cd /home/ellie/git/atview
deno run -A \
  /home/ellie/git/wm-mini/scripts/profile_typecheck.ts \
  app/main.wm --iterations=1
```

To deliberately inspect warm, same-process behavior:

```sh
deno run -A \
  /home/ellie/git/wm-mini/scripts/profile_typecheck.ts \
  app/main.wm --warmup=1 --iterations=3
```

The profiler calls the full analysis path, including the language-service
snapshot. This makes it useful for comparing compiler and LSP stages, but the
lean `coreFile` measurement below is more representative of `wm run`.

## Measuring the exact compiler path

This isolates `coreFile` from JavaScript artifact emission:

```sh
cd /home/ellie/git/atview
deno eval --config /home/ellie/git/wm-mini/deno.json '
import {
  compileFileArtifactsFromCore,
  coreFile,
} from "/home/ellie/git/wm-mini/src/compiler.ts";

let start = performance.now();
const compiled = await coreFile("app/main.wm");
const coreMs = performance.now() - start;

start = performance.now();
await compileFileArtifactsFromCore(compiled);
const emitMs = performance.now() - start;

console.log({ coreMs, emitMs });
'
```

The wm-mini Deno configuration is required because the compiler uses its import
map.

## Deno CPU profiling

Deno can produce a Chrome-compatible CPU profile, a Markdown report, and an
interactive SVG flamegraph in one run:

```sh
cd /home/ellie/git/atview
profile_dir=$(mktemp -d /tmp/atview-cpu.XXXXXX)

deno run \
  --cpu-prof-dir="$profile_dir" \
  --cpu-prof-name=atview-check.cpuprofile \
  --cpu-prof-md \
  --cpu-prof-flamegraph \
  -A /home/ellie/git/wm-mini/src/main.ts check app/main.wm

printf '%s\n' "$profile_dir"
```

The profiling flags must come before the script path. After a clean exit, the
directory contains the `.cpuprofile`, Markdown report, and SVG flamegraph. The
`.cpuprofile` can also be opened in the Chrome DevTools Performance panel.

For a compact summary:

```sh
deno run -A \
  /home/ellie/git/wm-mini/scripts/summarize_cpu_profile.ts \
  "$profile_dir/atview-check.cpuprofile"
```

CPU profiling adds overhead, so use ordinary process timings for the headline
wall-clock result and profiles for relative hotspot attribution. V8 reports
locations in transpiled JavaScript, so TypeScript line numbers may not exactly
match the source.

## Current cold-start breakdown

The latest measurements suggest this approximate shape:

- generated parser and module loading: about 1.8-2.3 seconds, depending on
  whether CPU or wall time is being inspected
- TypeScript reflection: about 0.65 seconds
- standard-library loading and construction: about 0.34 seconds
- FFI preparation and repeated inference/resolution stages: about 0.8 seconds
- compiler-only analysis facts: about 0.09 seconds
- JavaScript emission: about 0.02 seconds

The parser remains the largest actionable cost. After the dispatch change, its
cost is no longer dominated by finding the requested grammar rule. Allocation,
captures, memoization, tuple/list operations, source offset conversion, and
garbage collection are now more visible.

## Experiments that were reverted

These results are useful constraints for future work:

- Removing packrat memoization increased graph loading from roughly 2.27
  seconds to 6.44-6.55 seconds. Memoization is essential for the current
  grammar.
- Splitting strict and recovery memo caches and shortening memo keys was neutral
  or slightly slower, at roughly 2.33-2.46 seconds.
- A generic `Dict.getOrSet` intrinsic intended to avoid `Option` allocation was
  about 5% slower, with graph loading around 2.41-2.54 seconds.

These experiments were fully reverted. The next parser improvement should
specialize the representation rather than remove memoization.

## Regenerating the frontend-v2 parser

After editing the parser generator, rebuild both generated stages from the
wm-mini repository:

```sh
cd /home/ellie/git/wm-mini
deno task frontend-v2:generate-recognizer
deno task frontend-v2:build
```

The second command bootstraps the tracked self-hosted parser artifact. Review
both generated diffs and the semantic golden hash before accepting the result.

## Verification

The retained changes have been checked with:

```sh
cd /home/ellie/git/wm-mini
deno task check

deno test -A \
  tests/compiler_test.ts \
  tests/compiler_module_test.ts \
  tests/compiler_js_import_test.ts \
  tests/core_test.ts \
  tests/module_interface_test.ts

deno test -A \
  tests/wmslang_webgpu_render_test.ts \
  tests/wmslang_window_example_test.ts
```

The compiler/interface group passed 153 tests and the GPU/codegen group passed
8 tests. The frontend-v2 suite passed its generation and parser tests. A full
frontend corpus run had two failures because the local, untracked
`examples/test.wm` has no semantic golden; this is a dirty-worktree fixture
issue, not a regression in the retained changes.

## Next work

- [ ] Repeat the atview cold benchmark in at least three fresh processes after
  every candidate change.
- [ ] Replace the remaining rule-name `Table.get` dispatch with numeric grammar
  rule IDs and array indexing, removing the last per-invocation string hash.
- [ ] Extend arity raising to recursive bindings, which are currently skipped
  because they may be rewritten into a tail loop over `__arg`.
- [ ] Reduce `buildCompiledCapture` allocation, now among the top parser costs.
- [ ] Order the `buildCompiledCapture` arms by observed frequency, or dispatch
  on `ctor` through a table, as rule dispatch already does.
- [ ] Have the matcher produce `ParseValue` directly instead of building a
  `CompiledCapture` tree that a second pass walks.
- [ ] Investigate a prebuilt standard-library artifact so a fresh process does
  not parse and infer the same library every time.
- [ ] Decide whether CLI `wm check` can use the lean analysis path while still
  producing all diagnostics it promises.
- [ ] Revisit TypeScript reflection after the TypeScript Go API direction is
  clear.
- [ ] Keep LSP responsiveness work separate from this cold-start benchmark; the
  shared parser and analysis improvements should still benefit both.

The acceptance target is not merely a faster warm process: a small application
such as atview should compile quickly on its first invocation after starting
Deno.

## Redundant shape guards in tuple matches

The last of the two wastes described under "Two distinct wastes in the tail-loop
form" turned out to be the wrong half to chase. Avoiding the scrutinee
allocation is the low-value part — allocation has been a poor predictor twice
already. The valuable part is the guard duplication it causes.

`buildCompiledCapture` in the generated parser dispatches over eleven arms:

```js
const __wm_tail_value_84 = __wm_tuple(capture, source, state);
if      (__wm_is_tuple(v) && v.length === 3 && v[0]?.ctor === 90 && ...)
else if (__wm_is_tuple(v) && v.length === 3 && v[0]?.ctor === 91 && ...)
else if (__wm_is_tuple(v) && v.length === 3 && v[0]?.ctor === 92 && ...)
```

Every arm re-tests `__wm_is_tuple(v) && v.length === 3`. The scrutinee is a
tuple literal built on the line above, so that guard is invariant: a capture
node could run up to eleven redundant `__wm_is_tuple` calls and eleven length
comparisons before reaching the `ctor` test that actually discriminates. This
explains `__wm_is_tuple` at 6.1% self time better than allocation pressure did.

### The fix

`literalTupleArity` in [emit_js.ts](../src/core/emit_js.ts) reports the arity of
a scrutinee written as a `CoreTuple`. The three `CoreMatch` emitters pass it to
`patternChecks`, which drops the top-level `__wm_is_tuple` and `length` checks
when the arm's `CorePTuple` has the same arity. Nested checks are unaffected —
a constructor payload's shape is not statically known.

The scrutinee tuple is still materialized. Keeping it avoided the accessor
refactor that `patternChecks`/`emitPatternBind` would otherwise need, and the
allocation itself is not what costs.

### Result

180 `__wm_is_tuple` sites removed from the generated parser (2280 to 2100).

Twelve interleaved rounds, with the A/B order flipped after round 6 to control
for ordering and thermal bias:

| | baseline | guards elided |
| --- | --- | --- |
| rounds 1-6 (baseline first) | 1712.2 ms | 1676.0 ms |
| rounds 7-12 (guards first) | 1655.0 ms | 1624.0 ms |
| all 12 | 1683.6 ms | 1650.0 ms |

2.0% overall, 9 wins of 12, consistent across both orderings. Small, but real
and free: strictly less code is emitted, and the generated JavaScript reads
better. Kept.

Six rounds would not have settled this on their own — the first block read 2.1%
at 4 wins of 6, inside the noise band. Reversing the order and doubling the
sample is what made the effect credible.

### Basis facts for `Js.Table`

Running the full `tests/` directory surfaced two failures from the earlier
`Js.Table` work rather than from this change: the type was added to
[types_basis.ts](../src/types_basis.ts) and the prelude but never registered as
an implementation fact. Fixed by adding the `Table.*` export names to
`src/basis_manifest.ts` and listing `Js.Table` in the basis profile golden.

`tests/` now runs 869 passed, 3 failed, and all three failures are the
pre-existing semantic-golden mismatches caused by untracked scratch files under
`examples/` (`test.wm`, `1.wm`, `node-gotchi.wm`). Verified at clean `HEAD`.

### Still open in the capture path

Matching builds a `CompiledCapture` tree, and `buildCompiledCapture` then walks
it to build a second `ParseValue` tree: two trees, two traversals.
`LabeledCompiledCapture` and `ActionCompiledCapture` are pure pass-through arms
that cost a dispatch each. Having the matcher produce `ParseValue` directly
would delete a whole pass, but that is a parser redesign rather than a codegen
tweak.

The arm order is also unmeasured. `MissingCompiledCapture`, the rare recovery
case, is tested third, ahead of the very common `SequenceCompiledCapture`.
Ordering arms by observed frequency, or dispatching on `ctor` through a table
the way rule dispatch already does, are both untried.

## The tuple tag was the single biggest cost

Re-profiling after the guard work put `__wm_tuple` at 163 ms self and the
garbage collector at 313 ms, together the largest remaining block. The
constructor was:

```js
const __wm_tuple = (...items) => { items[__wm_tuple_tag] = true; return items; };
```

A `JSArray` has no in-object property slots, so storing a symbol on one forces
V8 to allocate a separate properties backing store for every tuple — a second
allocation per tuple, which also explains the GC share.

### Bounding the cost first

Three prelude-only variants, measured in situ over five interleaved rounds:

| variant | mean | delta |
| --- | --- | --- |
| current | 1657.4 ms | — |
| check ignores the tag | 1616.6 ms | −2.5% |
| tag removed entirely | 1475.4 ms | **−11.0%** |

The untagged variant won 5 of 5 and its slowest run beat the baseline's fastest,
so the effect is not noise. About 2.5% is the tag *check* and 8.5% is the
per-tuple *store*.

A `deno bench` of four tuple representations disagreed, putting all of them
within noise of each other. It was wrong: a tight monomorphic loop lets V8 cache
the map transition, which the parser's varied allocation sites do not. The
in-situ A/B is the measurement to trust — the same lesson as the earlier
allocation work, now with a concrete counterexample.

### Dead end: prototype tagging

Tagging by prototype instead of per instance keeps the semantics and needs no
codegen change:

```js
class __wm_TupleArray extends globalThis.Array {}
const __wm_tuple = (...items) => { Object.setPrototypeOf(items, proto); return items; };
```

It ran at **6.9 s**, four times slower than baseline. V8 deoptimizes hard on
prototype mutation. Any scheme that touches an array's prototype after creation
is off the table.

### What shipped: mark Js.Array, not tuples

The tag exists only to tell a tuple from a `Js.Array`. Only two consumers
genuinely need it — `__wm_js_call`, which decides whether to spread, and
`__wm_show`, which renders them differently. The rest are assertions or cases
where a `Js.Array` is not a legal value.

Since `Js.Array` values are far rarer than tuples and only cross the FFI
boundary, the tag now marks *them*:

```js
const __wm_tuple = (...items) => items;
const __wm_is_tuple = (value) =>
  globalThis.Array.isArray(value) && value[__wm_js_array_tag] !== true;
```

The missing-symbol load is nearly free, because V8 caches the negative lookup on
the array's map. Arrays are marked in `__wm_js_array_mark` at each point one can
enter Workman: the `__wm_js_to_workman` array converter and its `"id"`
fallthrough, `Js.Array.fromList`, and the bare member readers. The mark uses
`Object.defineProperty` so it is non-enumerable — assigning it made marked
arrays stop comparing equal to plain ones and broke sixteen wmslang tests.

Marking cost half the win back at first (4.9%), because the `"id"` fallthrough
runs on every FFI return and the parser's hottest FFI call, `charCodeAt`,
returns a number. Guarding each hot site with an inline `Array.isArray` instead
of an unconditional call recovered it.

### Result

Five interleaved rounds of the final built artifact: **1704.4 ms to 1541.8 ms,
9.5%, 5 of 5 rounds.** `tests/` is unchanged at 869 passed, 3 failed, all three
the pre-existing untracked-example goldens.

### The caveat

This inverts the safe default. Previously an unmarked array was correctly *not*
a tuple; now an unmarked array is *assumed* to be one, so any array reaching
Workman without passing a marking site is silently misread — it renders wrongly
in `show`, and `__wm_js_call` will spread it.

The hole is not just missing call sites. **A frozen array can never be marked**,
which is how `Gpu.uniformBytes` broke: it built `Object.freeze(Array.from(...))`
and the mark was swallowed. That one is fixed by marking before freezing, but a
frozen array arriving from host JavaScript cannot be.

The sound version of this win is a class-based tuple — fields in the object's
own shape, so no second allocation, and `instanceof` for a check nothing else
can pass. It costs a broader refactor: `emit_js` accessors from `v[0]` to `v._0`
and the prelude's tuple-shaped destructuring. It should land at or above the
11% ceiling, since the check becomes a single map comparison. Worth doing if
FFI-boundary correctness is judged to outweigh the refactor.

## What `wm run` actually spends, end to end

The parser benchmark had become a proxy. Measuring `wm run app/main.wm` on
atview directly, timed from process start:

| phase | cost |
| --- | ---: |
| bare Deno startup (parent) | ~13 ms |
| import `compiler.ts` | ~100 ms |
| **`coreFile`** | **~2,760 ms** |
| emit artifacts | ~19 ms |
| write artifacts | ~1 ms |
| child Deno startup | ~13 ms |

Generated output is 460,909 bytes in one artifact. Process startup is not the
problem in either direction — a bare `deno run` is 12-14 ms. Essentially all of
the wait is `coreFile`.

Note when timing this by hand: `wm run` on atview launches a TUI that never
exits, so wall-clock on the whole command measures the app, not the compiler.

### Where `coreFile` goes

Self time grouped by subsystem, sampled at 100 µs:

| subsystem | | |
| --- | ---: | ---: |
| generated parser | 1254.1 ms | 37.4% |
| TypeScript reflection / FFI | 930.5 ms | 27.8% |
| garbage collector | 282.0 ms | 8.4% |
| compiler: `infer` | 269.5 ms | 8.0% |
| compiler: `types` | 136.5 ms | 4.1% |
| compiler: `diagnostic_writer` | 84.8 ms | 2.5% |
| compiler: `binding_facts` | 59.4 ms | 1.8% |

TypeScript reflection is now the second largest cost and is no longer safe to
defer on the grounds that the TypeScript Go API may change it.

### Inside TypeScript reflection

`setJsReflectionProfileSink` already instruments this. On atview it reports
**39 separate `createProgram` batches**:

- Batch 1: 5 roots, 14 requests, 220 program files, **6.20 MB** of `.d.ts`,
  **597 ms**. The largest inputs are `lib.dom.d.ts` at 2,349 KB,
  `__wm_deno_types.d.ts` at 721 KB, then `inspector.generated.d.ts`,
  `lib.es5.d.ts`, and `fs.d.ts` at ~200 KB each.
- Batches 2-39: one root each, 2-16 ms apiece, roughly 150 ms together.
  `previousProgram` reuse is working — these are cheap because of it.
- Reads (prepare + read): 202 ms across 48 events.

`checkerMs` is **0 in every batch**. The cost is not type checking; it is
`createProgram` parsing and binding several megabytes of declaration files.

### What does not work

Dropping `lib.dom.d.ts` from `compilerOptions` fails on atview with a
`ModuleAnalysisError: type mismatch` — it genuinely reflects DOM types, so the
lib list cannot simply be trimmed.

### Ranked candidates

1. **Collapse the 39 batches into one.** The JS import set is known from the
   module graph once parsing finishes, so reflection could be issued as a single
   batch instead of one per import. Worth roughly the 150 ms the extra batches
   cost, and it removes per-batch overhead that will grow with project size.
2. **Make the lib set demand-driven.** Batch 1 spends most of its 597 ms parsing
   declaration files the project may not touch. `lib.dom.d.ts` alone is 38% of
   those bytes. Attempting without DOM and retrying on failure would pay off for
   non-DOM projects and cost a retry for atview; selecting per root would be
   better but needs a way to know which roots want DOM.
3. **The parser is still the largest single item** at 1254 ms for the 124 KB
   imported graph — about 10 ms/KB. The memo hit rate of 15.9% (905 hits against
   4,784 misses) suggests packrat memoization is not paying for itself and its
   selectivity is worth revisiting.

## Compile progress display

`wm run` now draws a single-line progress indicator while compiling, in the
style of `zig build`:

```
[1/4] load modules 26 modules 1.1s
[2/4] analyze 14/26 prepare FFI 1.8s
[3/4] build core 2.7s
[4/4] emit javascript 2.7s
```

[progress.ts](../src/progress.ts) owns the drawing. It writes to stderr only
when stderr is a terminal, so piped or redirected output is byte-for-byte
unchanged, and stdout stays free for the compiled program. The line is cleared
before the child process starts, so a TUI never inherits a partial line.

Stage boundaries come from hooks threaded through `ModuleGraphOptions`:

- `onStage` fires in `analyzeStrict` and `coreResultFromAnalysis`.
- `onModuleParsed` fires per module in `visitModule`. Imports are followed
  depth-first, so the total is unknown until the graph closes — this reports a
  running count, not a fraction, rather than showing a misleading `n/n`.
- `onAnalysisProgress` is driven by `analyzeModuleGraph`'s existing `onEvent`
  hook, counting distinct modules cleared per phase.

The display doubles as a profiler. It makes visible that `prepare FFI` alone
accounts for roughly 0.7 s of the analyze stage on atview, matching the 597 ms
first `createProgram` batch measured above.

`RunOptions.progress` forces the display on or off for tests and for callers
that are not attached to a terminal.
