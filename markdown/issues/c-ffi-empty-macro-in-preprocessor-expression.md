# Aro rejects an empty macro before unary plus in a preprocessor expression

Status: open (2026-10-31). Found while auditing SQLite's private B-tree API.

Verified 2026-11-04: fails with `InvalidHeader`.

Known-issue test: `tests/known_issues_test.ts`.

The bundled extractor rejects this valid header:

```c
#define FLEXARRAY
#if FLEXARRAY+1 > 1
#error wrong
#endif
#define OK 17
```

Import `OK` with `from c.header("/absolute/path/repro.h") import unsafe { OK };`.
Compilation reports `Aro C header reflection failed`, followed by
`<scratch space>:0:1: error: invalid token at start of a preprocessor expression`
and `InvalidHeader`. GCC accepts the header. This is reduced from SQLite
3.54.1's amalgamation, which defines FLEXARRAY as empty for C99 and uses
`#if FLEXARRAY+1 > 1` when defining its internal KeyInfo layout.

This blocks direct reflection of that amalgamation, rather than SQLite's
public sqlite3.h. The server continues to use the public header and prepared
SQL. Research-only private API probes used manually authored signatures and
ABI offsets verified by a separate C layout probe; those offsets are specific
to the pinned source, flags and platform and are not a general solution.

Investigate the bundled Aro preprocessor's expansion of an empty object macro
in a conditional expression. No dependency patch or compiler workaround has
been added for this experiment.
