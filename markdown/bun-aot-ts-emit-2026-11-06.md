# Bun AOT, TS emit and datatype representation, 2026-11-06

Bun 1.4.4-canary.1+b1305ddc7 (`bun compile`, native AOT) against Deno 2.x, Linux x86_64.

## Where the compiler spends time

Deno CPU profile, two rounds compiling `tooling/frontend-v2/compiler_frontend.wm` (15.9 s sampled):

| Self time | Where |
| ---: | --- |
| 56.8% | `src/generated/frontend_v2_parser.js` |
| 14.5% | garbage collector (mostly parser allocation) |
| 6.0% | `host/js/table.wm` primitives (`set`, `lookup`) called by the parser |
| ~15–20% | the TypeScript compiler (`types.ts` 3.2%, `infer/provenance.ts` 2.6%, `taint.ts` 1.4%, rest spread) |

Hot parser functions: `parseCompiledRule` 6.2%, `matchSequenceInto` 5.4%, `__wm_is_tuple` 4.5%,
`matchChoiceAt` 4.2%, `buildCompiledCapture` 3.4%, `__wm_basis_Cons` 2.5%.

## What Bun's `--explain` says

- The generated parser is 9.8% typed (3,782 of 38,479 property accesses). `infer/` is not among the
  least-typed files.
- The headline cause, "builtin-result at `basis.ts:18`, 91.3% of untyped time", is an attribution
  artifact. Rewriting that `flatMap` as a typed loop moved the same 91.3% to `basis.ts:27`. The
  cascade is syntax-tree values (`TypeExpr`, `AstNode`) that originate in the untyped parser.
- AOT gave Deno-level speed on the compiler (atview `main.wm`: AOT 8.5 / 4.2 s, Deno 8.5 / 3.8 s
  for round 1 / round 3) and was much slower than Deno on wm-compiled parser code.

## Would emitting TypeScript help?

A micro-benchmark in the current emitted style (build and fold a 1M-element `List` of a two-constructor
tree, 20 rounds):

| Variant | Bun AOT | Deno |
| --- | ---: | ---: |
| current shape `{ctor, name, args: [tuple]}`, untyped JS | 2.8 s | 3.1 s |
| current shape, fully typed TS (discriminated unions) | 2.9 s | 3.1 s |
| flat shape `{ctor, head, tail}` / `{ctor, a0, a1}`, typed TS | 0.49 s | 0.95 s |
| flat shape, same code with types stripped | 0.50 s | 0.95 s |

Types alone changed nothing; Bun reported the typed current-shape file as only 40% typed. The flat
shape is about 6× faster on Bun AOT and about 3.3× faster on Deno, with or without annotations: Bun
infers object shapes from the constructors itself.

TS emit also has a fixed cost: `bun compile` type-checks with TS7 and refuses to build on errors, so
emitted TS must check cleanly (the first typed attempt failed on a `Object.freeze(...) as List<never>`
cast). FFI values, structural equality and the runtime helpers would all need typings that satisfy tsc.

## Conclusion

The lever is the runtime representation, not annotations. One object per constructor value with
positional fields (`{ctor, a0, a1, ...}`; list cells `{ctor, head, tail}` or equivalent) removes two
of the three allocations per cons cell and the `__wm_is_tuple` checks on constructor payloads. It
helps the shipped Deno build, not just Bun. TS emit can be reconsidered afterwards for Bun AOT only.

This answers part of the open questions in `markdown/compiler-infra.md` ("Runtime Representation").
Readers of the runtime shape outside the emitter include `src/frontend_v2_surface_semantic.ts`,
`src/frontend_v2_surface_loader.ts`, `src/core/emit_prelude.ts`, `src/core/emit_js_import.ts`,
`tooling/won/interop.ts` and `tooling/frontend-v3/adapters/js/preview.ts`. Payloads that are tuples
in wm (a constructor of `a * b`) would need the emitter to spread them into fields and rebuild a
tuple only when the payload is used as a whole.

Micro-benchmark sources are in the session job directory, not the repo; they are reproduced in
spirit by the table above.

## Result: flat layout implemented

`src/core/ctor_layout.ts` now defines the layout; the emitter builds values in place when the
constructor is known and matches spread fields directly. The parser regenerated to a fixed point
in two stages: `.args[` reads went from 10,078 to 0, `__wm_is_tuple` checks from 2,803 to 2,212,
and the artifact shrank from 1.50 MB to 1.38 MB.

Deno, three rounds per process, `HEAD` export against the working tree (second of two passes):

| Input | Round 1 | Warm round | CPU | Peak |
| --- | ---: | ---: | ---: | ---: |
| `compiler_frontend.wm`, before | 9.0 s | 5.7 s | 33.3 s | 1,116 MB |
| `compiler_frontend.wm`, after | 6.3 s | 3.9 s | 22.1 s | 910 MB |
| atview `app/main.wm`, before | 8.8 s | 3.8 s | 26.6 s | 1,767 MB |
| atview `app/main.wm`, after | 7.4 s | 2.9 s | 21.2 s | 1,681 MB |

Emitted JS is smaller too (3.26 M to 2.50 M characters for `compiler_frontend.wm`).

Known gap: a payload written through a tuple alias (`Tagged<Pair>` with `type Pair = (A, B)`) stays
whole in `a0`, because the layout follows declaration syntax while the checker expands the alias.
It is correct, only not flattened.

## Where a one-shot compile goes after the layout change

atview `app/main.wm`, one fresh process (`scripts/profile_typecheck.ts`, `scripts/profile_reflection.ts`
and wall-clock timers around `analyzeModuleGraph`), 7.6 s total:

| Cost | Time | Notes |
| --- | ---: | --- |
| Parse the program's 48 modules | 1.75 s | `load module graph` |
| Parse and analyze the standard library | 1.9 s | `externalImportResults`; no `onTiming` phase reports it. Parsing the 87 library modules (260 KB) alone is 1.5–1.7 s |
| JS reflection workspace | 2.0 s | 126 TypeScript batches: `createProgram` 1.35 s (204 files, 6.1 MB, `lib.dom.d.ts` 2.3 MB), `getSemanticDiagnostics()` 0.62 s, 68 `deno info` subprocesses 0.40 s |
| Other FFI preparation and delayed resolution | ~0.5 s | `prepare FFI`, `resolve delayed FFI` beyond reflection |
| Inference | 1.05 s | three passes per module: initial partial, post-resolution partial, final |
| Build program analysis | 0.8 s | |

The parser runs at about 170 KB/s, so parsing (program plus library) is ~45% of the compile and
type inference proper is ~15%.

Findings:

- The library's parsed modules are plain data (143,609 objects, no class instances, no `undefined`
  fields). As JSON they are 4.3 MB and load in 27 ms against 1.5–1.7 s to parse. 63 objects are
  referenced twice, all `node` span records shared by a parameter and its pattern; a cache must
  keep that sharing or show it does not matter (`binding_facts.scopeNodes` and
  `module_interface` `byRegion` are keyed by nodes).
- `prepareReflectionSources` calls `program.getSemanticDiagnostics()` for every file only to look
  for TS2307 (unresolved import). Checking the root files alone would skip most of the 0.62 s, but
  stops reporting unresolved imports inside imported TypeScript dependencies.
- In the staged pipeline, any module that needs FFI staging makes every fresh module, library
  included, go through the partial passes again.
