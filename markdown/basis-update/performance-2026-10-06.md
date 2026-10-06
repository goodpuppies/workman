# Basis performance investigation — 2026-10-06

The cold and warm regressions have different causes. Moving implementations from
TypeScript into Workman made startup parse and infer substantially more library
source. A subsequent tooling fix made editor analysis resolve facts for that
library on every snapshot, which exposed expensive binding-environment copying.
The library itself is already parsed/inferred once per process; warm requests are
not reparsing it.

## Comparison method

The same tiny program was checked, analyzed, and compiled in isolated copies of
these revisions:

- `fb56ea6`: immediately before the library/basis move.
- `5e46e5f`: the basis move itself.
- `2a03ae9`: host-helper extraction and the tooling fact-graph fix.
- The current 0.4.0 checkout, including binding-scope snapshot reuse.

Runs were sequential, without the full suite or publish job running. Cold library
measurements are single fresh-process samples and exclude process launch/compiler
module import. Warm API measurements average 20 iterations after five warmups.
The tiny program uses only numeric bindings and a function call, so the increase
in library work is easy to distinguish from program work. Absolute timings are
machine-specific, not service-level guarantees.

Phase instrumentation was added only to temporary copies under `/tmp`; none of
those experimental compiler changes are in the working tree.

| State | Library modules | Source characters | Top-level declarations | Cold library load | Warm editor analysis | Warm source compilation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Before basis move | 8 | 21,781 | 117 | 384 ms | 2.3 ms | 7.8 ms |
| Basis moved | 35 | 69,604 | 643 | 824 ms | 2.8 ms | 27.3 ms |
| Host/tooling integration | 39 | 74,674 | 676 | 979 ms | 30.5 ms | 26.5 ms |
| Current, with scope reuse | 39 | 74,674 | 676 | 963 ms | 19.0 ms | 14.2 ms |

The current compiler also contains syntax backports, so changes between the last
two rows are not a perfectly isolated scope-cache A/B. The adjacent first three
commits isolate the historical changes more closely.

## Cold: parsing and inference, not TypeScript reflection

Current first-library-load breakdown:

| Work | Time |
| --- | ---: |
| Generated recognizer execution | 697 ms |
| Surface-to-semantic projection | 14 ms |
| Parser finalization | 1 ms |
| Initial partial inference | 113 ms |
| Final inference | 80 ms |
| FFI preparation/resolution/callback work | About 21 ms |

Library discovery/parsing wall time was 740 ms. Per-module asynchronous elapsed
parse times cannot be added: `Promise.all` starts overlapping calls whose waits
include other modules' parsing. The recognizer measurements above time the actual
synchronous parsing work instead.

The largest individual parses included `std/binary.wm` (71 ms),
`basis/list_pair.wm` (66 ms), `std/map.wm` (61 ms), `basis/vector_slice.wm` (50 ms),
and `std/list.wm` (48 ms). The initial library has about 3.4 times the source and
5.8 times the declarations it had before the move. Code that used to arrive as
compiler-owned TypeScript schemes/runtime strings now goes through the Workman
frontend and inference pipeline.

The reflection profiler recorded **zero TypeScript reflection batches** during
library loading. The primitive JS imports have explicit signatures, so initial
reflection preparation costs less than 1 ms. This is different from a user program
that imports unannotated JS or Deno APIs. The intermediate contextual and
post-resolution inference phases are already effectively skipped for this library;
they are not each repeating the whole inference pass.

## Warm: tooling rebuilds library facts

The host-helper commit explicitly fixed std-constructor patterns by extending the
editor's fact graph with the library. Before it, the tiny editor probe constructed
Core for one module and three pattern facts. Now it constructs Core for 40 modules
and 2,196 pattern facts.

Current warm fact-building costs on the tiny probe:

| Work | Time |
| --- | ---: |
| Binding facts, including scope snapshots/captures | 8.5 ms |
| Shared Core | 2.3 ms |
| Pattern facts | 0.8 ms |
| Nominal facts | 0.7 ms |
| Fragment selection | 0.8 ms |
| Recursion and GPU-only binding discovery | About 1.0 ms |
| GPU normalization | 0.025 ms |

CPU samples identify `snapshotBindingEnv`, `cloneBindingEnv`, capture analysis,
and Core lowering as the remaining warm costs. The previous scope reuse fix
removed repeated snapshots of an unchanged environment, but environments are
still cloned at each declaration, and snapshots are still recorded throughout
library bodies even though the editor snapshot describes only the program modules.

Rebuilding `standardRuntimeGraph` took about **0.2 ms** on the webhook probe.
Caching that small graph-construction step would not address the main regression.
GPU normalization itself is also too small to be a useful target here.

## Experiments and priorities

These are prototypes in temporary copies, not shipped optimizations.

| Candidate | Observed effect | What a production change must preserve |
| --- | --- | --- |
| Generated/pre-parsed library ASTs | Cold library load about 989 ms → 274 ms | Source spans, parser/compiler/source fingerprints, regeneration checks, mutation isolation |
| Only capture-contract scopes for library modules | Warm editor analysis 18.7 ms → 12.9 ms; bindings 8.7 ms → 4.6 ms | Full scopes for program modules; explicit lambda capture validation; library declaration identities |
| One inference pass for plain source-string checks | Warm `checkSource` 3.28 ms → 1.47 ms | The existing delayed-FFI path for imports, receiver access, callbacks, and foreign types |
| Skip library loading for an isolated `@no-prelude` source check | First kernel check 978 ms → 56 ms | Explicit imports must still load their dependencies; graph/file/recovered entry points need equivalent guards |

The pre-parsed AST prototype stores 1.35 MB of JSON. Its reported cold time
includes reading and decoding that file plus library inference. It proves the
size of the opportunity, not a ready cache format. A generated artifact tied to
the compiler/parser and library-source hashes is preferable to an unchecked cache.

The scope prototype preserves all binding, nominal, pattern, recursion, and Core
facts. It omits editor-only scope checkpoints in library bodies and records the
scope at a lambda only when an explicit capture clause requires it. Binding,
closure-capture, library-discovery, and completion tests passed (50 tests).

`checkPreparedModuleWithoutImports` currently runs three partial inference passes
and a final pass even for plain Workman. The graph pipeline already has a pure
module fast path. Reusing the same eligibility rule in the source-string entry
point is a small, promising change. The compiler/frontend prototype passed 78 tests. One initial failure was a
missing `examples/factorial.wm` fixture in the temporary copy; that test passed
after supplying the fixture. The combined pre-parsed-AST/capture-scope/fast-path
prototype also passed 31 basis/profile/library-discovery checks. These are focused
prototype checks, not a full-suite certification or a production cache contract.

Combining scope minimization with the plain-source fast path reduced warm tiny
compilation from 13.9 ms to 8.8 ms in the experiment.

Larger follow-ups are possible but need more design: immutable environment
structure sharing to avoid declaration-by-declaration map copies, and reusable
library binding/Core templates with a correct per-program identity remapping.
Blindly caching the existing fact maps would leak binding/type identities between
projects. Dropping library facts would restore the std-constructor-pattern bug.

Recommended implementation order: the plain-source and no-prelude guards, then
library scope minimization, then a generated library AST artifact for the larger
cold-start gain. Further inference/fact caching should follow measured evidence
and explicit identity/invalidation design.

## Profiler correction

`scripts/profile_typecheck.ts` previously called `buildProgramAnalysis` without
the library graph extension that the real editor uses. Its warm analysis phase
therefore missed most of the new basis overhead. It now merges the library for
fact analysis and reports library graph preparation separately. This is the only
compiler-tooling change applied to the checkout during this investigation.

Reproduce the corrected warm profile with:

```sh
deno run -A scripts/profile_typecheck.ts examples/webhook.wm --warmup=1 --iterations=5
```

The corrected webhook sample averaged 116 ms: 53 ms loading/parsing the program
and 36 ms building program-plus-library analysis. This should be read separately
from the earlier cold, mixed-iteration release-preparation measurements.

Detailed experiment logs and harnesses from this session are under `/tmp`:
`wm-basis-detailed.log`, `wm-basis-experiments.log`,
`wm-basis-fastpath-experiments.log`, `wm-basis-kernel.log`,
`wm-basis-investigate.ts`, and `instrument-wm-basis.py`.

## Approved implementation follow-up

Implemented the plain-source single-inference path and no-prelude loading guards.
Plain Workman source checks now use the same FFI staging eligibility rule as the
graph pipeline. Imports, foreign types, and delayed receiver/callback work retain
the staged pipeline. Isolated no-prelude programs skip standard-library loading
in source checks, strict/recovered editor analysis, and emission. The decision is
graph-wide: an imported module that needs the prelude still gets it. Explicit
external library imports also retain their dependency results.

Library scope collection remains unchanged. Scope minimization was declined
because it could affect LSP behavior. Pre-parsed library ASTs are deferred until
after the planned parser rewrite.

Focused compiler, FFI, basis, library-discovery, and LSP checks passed: 221 tests,
plus typechecking. A fresh-process regression poisons the embedded library and
exercises the no-prelude entry points, proving that they do not load it. A mixed
graph regression verifies that a no-prelude entry can import a module using
`List.length`.

Local follow-up samples measured warm plain-source checks at 1.4–1.6 ms and an
isolated cold no-prelude check at 54 ms. Default-prelude cold checks still take
about 964 ms; the parser-heavy library startup remains. Warm editor analysis was
19–24 ms and compilation 13–15 ms. These samples overlapped some verification
work and are indicative, not controlled benchmarks. Logs are in
`/tmp/wm-fastpaths-benchmark.log` and `/tmp/wm-fastpaths-*.log`.

The local 0.4.0 VSIX was rebuilt with these changes. No commit or upload was made.
