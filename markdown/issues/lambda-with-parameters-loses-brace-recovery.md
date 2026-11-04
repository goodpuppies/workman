# An unfinished lambda with parameters no longer recovers as a lambda

Status: open, found 2026-11-04. Release blocker: it affects every half-typed lambda in the editor.

Introduced by `d04d72f` ("Support grouped pattern lambdas and shared expression operands"). The
parser now reads `(x)` as a grouped expression unless the lambda parses completely, so recovery
breaks the binding in two.

## Reproduction

| Source (frontend v2) | Parsed as |
|---|---|
| `let id = () => { 1` | `id = Lambda` (correct) |
| `let id = (x) => { x };` | `id = Lambda` (correct) |
| `let id = (x) => { x` | `id = Var` and a stray `it = Lambda` |
| `let id = x => { x` | `id = Var` and a stray `it = Lambda` |
| `let f = (x: String) => { x` | `f = Ascribed` and a stray `it = Lambda` |
| `let f = (x, y) => { x` | `f = Tuple` and a stray `it = Lambda` |
| `let f = (x) => { @gpu x };` | `f = Var` and a stray `it = Lambda` |

The body then fails with misleading errors, such as `unknown name x`, because the parameter is no
longer in scope.

## Known-issue tests

These passed before `d04d72f` and are now ignored:

- `tests/compiler_frontend_v2_test.ts`: lowers typed lambdas through a structurally missing block mate
- `tests/lsp_frontend_v2_test.ts`: validation typechecks through a structurally missing block mate
- `tests/directive_test.ts`: missing directive semicolon is preserved normally
- `tests/cli_test.ts`: v2 repl evaluates source with recovered terminators and delimiters

## Likely fix

In `src/grammar.peggy`, once `(...) =>` has been seen, commit to the lambda alternative, so that
recovery inside the body can't send the parser back to the grouped expression.
