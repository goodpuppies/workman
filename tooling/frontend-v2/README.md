# Frontend v2

This package contains the generated WM-native Workman parser and formatter. The earlier handwritten
structural bootstrap, flat DTO boundary, and recovery-only parser suite have been removed; generated
Surface parsing is the compiler, formatter, and LSP authority.

The versioned Peggy-AST boundary, generated layout, action classification rules, and generator
contracts are specified in [`generator/README.md`](generator/README.md).

Parser changes and recovery from a broken stage-0 artifact are documented in
[`bootstrap.md`](bootstrap.md). Frontend v2 self-hosts from its tracked generated artifact; there is
no supported v1 Workman parser fallback.

Exercise the generated frontend directly:

```sh
deno task wm fmt path/to/program.wm
deno task wm fmt --fix path/to/incomplete-program.wm
deno task wm fmt --stdout examples/exercises/math.wm
deno task frontend-v2:format path/to/program.wm
deno task frontend-v2:format --fix path/to/incomplete-program.wm
deno task frontend-v2:format --stdout examples/exercises/math.wm
```

Formatting is in place by default. Plain formatting canonicalizes authored whitespace while
omitting marked fallbacks; `--fix` additionally materializes committed missing `;`, `{`, and `}`.
The maintained handwritten WM modules are the small generated-capture runtime, Surface builders and
renderer, and the four-export `compiler_frontend.wm` boundary. Grammar-specific types, dispatch, and
schema modules live under `generated/` and are reproducible from `src/grammar.peggy`.

## Performance profiling

Run a timing-only corpus pass with:

```sh
deno task profile:frontend-v2
```

Generate a V8 CPU profile, Markdown hot-function report, and interactive SVG flamegraph with:

```sh
deno task profile:frontend-v2:cpu
```

The harness accepts `surface`, `failure`, or `format` followed by an iteration count.

## Importable library emission

Build the importable frontend library with:

```sh
deno task frontend-v2:build
```

This reproducibly writes the tracked runtime asset `src/generated/frontend_v2_parser.js`. The
generated ES module exports `parseSurfaceProgram`, `parseSurfaceFailure`, `formatSurfaceSource`, and
`formatSurfaceSourceFix`; compiler, LSP, and `wm fmt` consume that same artifact. The earlier
`lexRoundTrip`, `parseStructural`, and `projectSemantic` DTO experiment is no longer part of the
live runtime ABI.

The tracked artifact is also the stage-0 compiler for this command: frontend-v2 parses and compiles
its own WM sources, then replaces the artifact only if the self-hosted output changes. Restore the
tracked artifact before rebuilding if it is absent.

The frontend ABI will expose JavaScript-native DTO values deliberately:

- WM records already cross this boundary as plain JavaScript objects;
- DTO arrays will be constructed as `Js.Array`/`JSON[]`, not exported as WM `List`;
- optional DTO fields will use nullable values or explicit discriminated records, not the tagged
  internal WM `Option` runtime representation;
- internal ADTs remain private and are converted by the exported boundary function.

## Bootstrap findings

- Workman string receiver operations are safe FFI calls. The lexer gives source and offset
  parameters explicit types and deliberately handles their `Result` values rather than treating
  JavaScript string operations as pure.
- Current WM string literals do not accept a `\r` escape, and string ordering operators are
  numeric-only. The lexer therefore classifies JavaScript UTF-16 code units through safe
  `charCodeAt` calls. It handles CR, LF, and CRLF line starts explicitly and retains non-grammar
  Unicode as opaque concrete tokens; valid surrogate pairs stay together in one token.
- General function return annotations are not currently available. Nominal record values are
  contextually typed at construction sites instead.
- `examples/exercises/tree.wm`, one onboarding example named by `how-to-workman.md`, no longer
  parses with the current compiler. The current `std/list.wm` and `examples/aoc_depths.wm` examples
  do check successfully and were used as the module/recursion references for this slice.
- The self-check uses one unsafe `Deno.exit` import solely to make failed assertions produce a
  nonzero process status. No frontend behavior crosses that boundary.
