# Issue: Profile-guided compiler performance follow-ups

Status: investigation backlog

## Measured improvements to retain

October 2026 experiments on Deno 2.9.7 / V8 15.0.245.2-rusty found useful improvements
without changing execution backend:

- Reject unequal primitives before vector/slice symbol checks in runtime equality. Raw parser
  batches improved by about 15% on two corpora; this is not a 15% whole-compiler claim.
- Resolve ordinary package declaration imports without discovering a separate Deno graph for
  every importer. The FFI-heavy `../wmthree/src/scripts/play.wm` workload went from a median
  8.43s to 5.86s for module loading plus staged analysis, with `deno info` calls falling from
  533 to 4. All inferred bindings and complete emitted JS matched byte-for-byte.

Measurements, commands, versions and compact results are retained in
[V8 parser notes](../../tooling/v8-experiments/README.md) and
[FFI profiling notes](../../tooling/ffi-experiments/README.md). Timings are fresh processes
with warm filesystem/package caches, not persistent LSP performance.

## 1. Reduce repeated TypeScript reflection setup

Even after fixing module resolution, wmthree still prepares 90 TypeScript programs: one initial
batch and 89 single-query preparations. Unprofiled medians attribute about 1.27s to program
creation and 0.87s to semantic diagnostics; actual reflection read callbacks total about 59ms.
These times are nested inside analysis, not additional costs. `previousProgram` and source/module
resolution caches already exist, so simply adding them is not the solution.

Investigate retaining project/checker state, reusing package metadata, and batching independent
call probes. Preserve the dependency ordering of argument inference and later contextual queries.
The October 17 CPU profile also shows JSON parsing and old-program structure reuse; inspect their
callers before choosing a cache or project API. Do not remove unresolved-import diagnostics or
change overload/contextual typing to improve a timing result.

Only after measuring that overhead should we compare TS7/tsgo or a Rust checker backend through
WM's actual query protocol. General `tsc` benchmarks cannot establish WM's gain or API fidelity.

## 2. Reduce frontend-v2 parser runtime work

The post-equality-fix Deno profiles still show sequence/choice matching, capture construction,
tuple discrimination, memo-table operations and substantial GC. Inspect the generator and runtime:

- `tooling/frontend-v2/generator/compiled_probe_emitter.ts`
- `tooling/frontend-v2/compiled_probe_runtime.wm`
- `tooling/frontend-v2/surface_parse_runtime.wm`
- `src/core/emit_prelude.ts`

Candidate experiments are direct control flow for one hot combinator, fewer callback/list/tuple
temporaries, or removal of an intermediate capture representation. Their source shapes suggest
allocation opportunities; the profiles do not establish exact allocation counts. Preserve raw
parse results, recovery marks, diagnostics, formatting and formatting fixes.

Pooling immutable literal/class tables remains unproven on top of the equality fix. It helped
about 4% alone, but the combined samples overlapped the equality-only result. Literal-site
equality specialization also failed to establish a further gain. Re-measure before implementing
either in the generator. Frontend v3 and its planned SubsetML/MLton path remain the longer-term
direction; keep interim v2 work small and independently justified.

## 3. Inspect diagnostic snapshot cost

The optimized wmthree CPU profile has roughly 183ms of `snapshotType` self time and additional
shape-rendering work. Establish which snapshots are required for diagnostic evidence and which
are repeated or constructed unnecessarily. Consider reuse or delayed construction only where
type mutation, provenance and diagnostic output remain correct.

## Existing validation debt

After removing experimental fixtures, the repository Surface semantic-golden test reaches a hash
mismatch for `tooling/frontend-v2/generated/compiled_probe_rules_15.wm`. The original generated
parser from `HEAD` gives the same mismatch as the optimized parser. Resolve the corpus/golden
discrepancy from its intended semantics before relying on that suite for performance experiments;
do not regenerate expected hashes merely to get a passing run. The existing supported-semantics
test also rejects its `.{ ... }` record example with both parser versions.

## Closed experiment: native TypeScript AOT compilers

Perry and scriptc were too early to be useful for this compiler. Compatibility work and unstable
representation performance outweighed the measured benefits; even small typed handwritten parser
probes failed to establish a repeatable advantage over warm V8. A scalar recursive numeric win did
not survive small record-representation changes. This does not establish that native compilation
is inherently unsuitable, but it does not justify WM emitter work tailored to these compilers.
Their harnesses, local compiler patches, fixtures and generated builds have been removed.

Keep the general dependency separation between pure inference/lowering, reflection and diagnostic
presentation. It does not depend on an AOT backend. Also retain the measured V8 equality and FFI
resolver improvements, the wmthree compatibility fixes and CLI progress reporting.

## Validation for future work

Use Deno's `--cpu-prof --cpu-prof-md` to choose a concrete target. Measure candidate and baseline
sequentially in fresh processes, alternating order; keep profiling, builds and report processing
outside timing comparisons. Compare complete semantic outputs, not just successful compilation.
For reflection, cover generic returns, overloads, contextual callbacks, constructors, nullable
values and import resolution. Report persistent-session and cold-process behavior separately.
