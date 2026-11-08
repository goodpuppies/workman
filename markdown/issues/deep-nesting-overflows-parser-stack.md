# Deeply nested expressions overflow the parser's stack

Status: open. Measured 2026-11-08 on `compiler-performance` at 3d108f1, Deno default stack.

## Reproduction

```ts
parser.parseSurfaceProgram(`let a = ${"(".repeat(300)}1${")".repeat(300)};\n`);
// RangeError: Maximum call stack size exceeded
```

The deepest parentheses that parse in a cold process:

| Parser | Depth |
| --- | ---: |
| start of the performance branch | 60 |
| single module, direct rule calls | 62 |
| with lexical scanners (current) | 108 |

Each parenthesis descends the whole precedence chain (`Expr`, `Or`, `And`, ... `Postfix`,
`Primary`), about 20 rules and several JS frames per rule, so the limit is much lower than the
source looks like it should allow. Hand-written code rarely nests this deep; generated WM could.

## Options

- Report a syntax diagnostic ("expression nested too deeply") instead of a raw `RangeError`. This is
  small and worth doing regardless.
- Skip the precedence chain when the next token rules out every operator level, which also removes
  a large share of rule executions.
- Frontend v3 is a manual rewrite and can choose its depth handling directly.
