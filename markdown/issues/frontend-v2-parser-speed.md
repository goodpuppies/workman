# frontend-v2 parsing is slow in both builds

Status: open, 2026-11-16. Deferred until after 0.8.0.

## Measurements

The native MLton build (`scripts/build_frontend_v2_native.py`) runs at about the speed of the
warmed-up JS build, so the cost is in the parser's design, not in the JS backend.

| Input | JS (warm, in-process) | Native |
|---|---|---|
| 323 files under `std/`, `examples/`, `tooling/` (2.9 MB), format | ~3.4 s | ~3.7 s, of which ~0.4 s is process startup |
| `generated/compiled_probe_rules.wm` (1.5 MB) | 1.35–1.8 s | 1.2–1.75 s |
| `tooling/wmslang/compiler.wm` (72 KB) | 85 ms | 50 ms |

JS figures come from `scripts/profile_frontend_v2.ts format 3`.

MLton's time profile on the 1.5 MB file: GC 28%, the memo table about 21%, string
concatenation 9% (the renderer appends its output piece by piece), and the format tool's UTF-8
conversion about 7%. The generated rules themselves are a small share.

Memo counts on the same file: 1.16M lookups and 123k hits, a 10.6% hit rate. 72 of the 87
memoized rules never hit, and they account for 63% of the lookups.

## Options

1. Memoize only rules that are re-entered. The memo is a cache, so dropping it never changes a
   result. Measure hits over the whole corpus first, and keep memoization for rules that
   could backtrack repeatedly over the same input. This is a generator change and speeds up
   the JS build too.
2. Native memo by offset: an array per offset instead of the real-keyed hash table.
3. Join renderer output from a list instead of appending.
4. Parse tokens rather than characters, the structure of MLWorks's frontend (`../mlworks/src/lexer`
   generates DFA tables; `src/parser` is LR). A token stream gives about 5× fewer positions,
   an array memo by token index, and no backtracking through trivia. frontend-v3's lexer
   already builds natively. An LR parser removes the memo entirely, but WM's grammar is a PEG
   (ordered choice, lookahead), so that would be a rewrite.

Order: 1, then 4 when parser speed matters again, notably for an MLWorks/PS2 build, whose
optimizer can't hide an expensive algorithm the way MLton's can.
