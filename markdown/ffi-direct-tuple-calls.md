# Direct tuple calls at foreign boundaries

Implemented 2026-11-02. No language syntax or foreign ABI changes.

## Implementation

The existing WM arity-raising registry now includes resolved named C and JS
function imports with at least two parameters. A call through that binding's
identity with a literal Core tuple of matching arity targets a fixed-argument
entry point. It evaluates the source arguments in order without allocating the
WM tuple. Existing module export/import machinery carries those entries across
WM module boundaries where the binding is exported.

C direct entries select conversions at compile time, including pointer Options,
UTF-8 strings and by-value struct codecs. No argument map, converter dispatch or
spread call is needed for that entry. Allocation required for actual string or
struct conversion remains.

JS direct entries convert each parameter independently and call with fixed
argument positions. Safe calls retain Result/Task wrapping, result conversion,
and the existing placement of argument conversions outside the host exception
boundary. Receiver and constructor helpers retain their existing semantics.
Unsafe identity imports share one eager member lookup between the direct and
ordinary entries; safe/converting imports retain their existing lazy lookup.

The original tuple wrappers remain for function values, existing tuple arguments
and call sites without a matching known target. This is not general alias
analysis, a change to overload resolution, or removal of rest arrays inside
every host helper. C namespace/codec imports and aliased namespace objects retain
their existing paths unless access resolves to a named foreign binding.

## Focused comparison

Same WM loop source, compiled by the emitter captured before this change and by
the final emitter. Deno 2.9.8, Linux x86-64, one million iterations per sample,
nine alternating before/after rounds. Checksums are checked outside timing.
Final medians in nanoseconds per iteration:

| Workload | Before | After |
| --- | ---: | ---: |
| Three-argument libc memcmp, pretyped byte count | 16.45 | 9.81 |
| Unsafe two-argument Math.imul | 3.55 | 3.50 |
| Safe two-argument Math.imul with Result handling | 548.73 | 453.79 |

The C probe improved about 40%, the safe JS probe about 17%. Unsafe primitive JS
showed no meaningful change; V8 appears to eliminate the old wrapper's overhead
in this loop already. Earlier runs showed the same direction, with safe JS gains
of 14–17%. The safe probe includes the existing per-call global member lookup;
this change does not cache mutable safe JS members.

The C probe deliberately uses a tiny operation to expose boundary cost. It does
not predict the same percentage improvement for SQLite queries, socket syscalls
or whole requests. The workstation has competing load, no core was isolated,
and no server capacity result is claimed.

Sources are under `examples/server/challenge/comparisons/ffi/`:

- `tuple_probe.wm`: WM loops with actual statically known foreign call sites.
- `tuple_compare.mjs`: checks and compares two compiled artifacts, alternating
  their sample order and recording artifact hashes.

Compile the probe with each compiler version, then run:

```sh
deno run -A --no-config examples/server/challenge/comparisons/ffi/tuple_compare.mjs \
  /absolute/path/to/before.mjs /absolute/path/to/after.mjs 1000000 9
```

Local artifacts: `_scratch/twelve-dollar/tuple-ffi/`. The before emitter files
were captured before editing. An import map redirects only those emitter modules
to snapshots with their relative imports made absolute; the rest of the compiler
and runtime remain the same. `final-loop-results.json` records both compiled
artifact hashes. Earlier measurement files are retained separately.

## Validation

- Existing compiler, C codec, JS reflection/dynamic, generic FFI, library and
  inference tests passed. New tests cover emitted direct calls, module boundaries,
  shadowing, higher-order and existing-tuple fallback, resolved variadic calls,
  left-to-right evaluation, callbacks, pointer/string/Option conversions,
  receiver ownership, constructors, Result failures, Promise rejection and
  synchronous throws from Promise-returning functions.
- Project type checks passed.
- Rebuilt the native server, checkpoint worker, Deno HTTP comparison and FFI probe.
  Tiny disposable databases passed write/commit, NUL/Unicode, JSON validation,
  failed-write recovery, feed ordering, fragmented/interleaved buffers,
  pipelining and slow-reader checks. Both signal-ownership modes passed, including
  thread ownership and forced fatal signal-queue overflow.
- Standalone probe passed pointer-sentinel/copy-lifetime checks and 100,000 errno
  captures. No C application shim was introduced.
