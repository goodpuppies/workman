repl `let square = x => x*x;` becomes `{x*x;};` Void return, void return should likely hard depend on manually written `;}`
generally support is poor for less punctuation dense style

## V2 implementation (2026-10-29)

Implemented bare single-parameter lambdas and expression bodies in the production
v2 frontend. `x => x*x`, `(x) => x*x`, `x => (x*x)`, and chained `x => y => x+y`
are now strict syntax with no recovery marks. Existing delimited single parameter
patterns and parameter annotations also work without outer parameter-list
parentheses; whitespace before the annotation colon is accepted consistently.
Multi-parameter tuple lists retain `(x, y)`.

Match arms now accept expression bodies, including ordinary `match(value)` and
anonymous `match { ... }` expressions. Match functions also accept a braceless arm
list, so both requested factorial spellings are strict syntax:

```workman
let rec fac = match(n) => 0 => 1, Var(n) => n * fac(n - 1);
let rec fac = match(n) => {0 => 1, Var(n) => n * fac(n - 1)};
```

The braceless list consumes comma-separated pattern/arrow pairs, but no trailing
comma. This leaves an enclosing call's argument separator intact. Braced lists
retain optional trailing commas. As with nested SML matches, an ungrouped inner
braceless match owns subsequent arms; use braces or parentheses to identify the
end of its arms when an outer match continues. `BareMatchFunctionNode` preserves
the authored absence of braces through formatting and semantic projection.

The final declaration semicolon remains outside an expression body. Authored
`{expr;}` and `(expr;)` sequences still discard the expression and return Void.
No inference or backend semantic change is needed: expression-valued lambda bodies
already exist in the compiler AST. The Surface tree now distinguishes bare
parameters through `BareParametersNode` rather than fabricating delimiter tokens;
the formatter preserves the accepted style in both normal and fix modes.

The grammar, Surface builders/schema, semantic projection and formatter were
updated together, with regenerated recognizer/runtime artifacts. This supersedes
the recommendation below to defer bare parameters to v3. Broader changes such as
omitting declaration semicolons, branch braces or `if` condition parentheses are
outside this change; they are independent grammar decisions.

The investigation below records the previous behavior and the reason for the fix.

## Application precedence investigation (2026-10-29)

Keep the current application precedence. A separate investigation of
`area Circle(10)` found that accepting it as `area(Circle(10))` by making explicit
calls bind tighter would break documented carrier applications. This precedence
change is not part of the implemented lightweight lambda/match syntax above.

The Revised Definition's Appendix B (`research/The-Definition-of-Standard-ML-Revised/app2.tex`,
lines 91–112) defines atomic expressions, including identifiers and parenthesized
expressions, and `appexp ::= atexp | appexp atexp`. The Core grammar labels
application left-associative (`syncor.tex`, lines 526–527). SML has no separate
postfix-call operator: `f(x)` applies `f` to the parenthesized expression `x`.
Consequently SML also parses `area Circle(10)` as `(area Circle)(10)`; applying
its rule does not resolve this example differently. WM's current grouping agrees.

Two isolated Peggy prototypes were compared with the current grammar, without
changing the production frontend: explicit calls tighter regardless of preceding
whitespace, and tighter calls only when `(` directly touches its callee.

| Source | Current grouping | Explicit calls tighter |
| --- | --- | --- |
| `area Circle(10)` | `area(Circle)(10)` | `area(Circle(10))` |
| `f a b` | `f(a)(b)` | unchanged |
| `f(a)(b)` | `f(a)(b)` | unchanged |
| `via Result transform(input)` | `via(Result)(transform)(input)` | `via(Result)(transform(input))` |
| `Traverse.with Result (items, transform)` | `Traverse.with(Result)(items, transform)` | `Traverse.with(Result(items, transform))` |
| `joinWith Result (nested)` | `joinWith(Result)(nested)` | `joinWith(Result(nested))` |

The `via` difference adapts an evaluated result instead of the function. `via` is
an ordinary curried function, including through aliases and user-defined carriers;
giving that spelling a parser exception would not preserve the general rule.

Compatibility audit:

- Compared semantic ASTs for all strictly accepted tracked WM files: 333 in
  Workman and 106 in `../atview`. Two Workman files were already rejected by the
  strict baseline parser and were excluded. Neither prototype introduced a new
  strict syntax rejection in the accepted corpus, but that does not imply semantic
  compatibility.
- General tighter explicit calls changed three Workman example files:
  `examples/generic_traverse.wm`, `examples/node-gotchi.wm`, and
  `examples/raylib/main.wm`. The adjacency-only variant changed the latter two.
  Neither changed an accepted atview file's AST.
- Audited WM/plain fenced examples in `docs/`, splitting separate expression
  demonstrations and supplying an outer semicolon where needed. Of 192 candidate
  fragments, 119 were strictly parseable; the remaining 73 were not established
  as valid complete WM snippets by this audit. This was a syntax/AST comparison,
  not a claim that all documentation examples typecheck or execute.
- Confirmed meaningful changes in `docs/carriers.md`'s call-site `via` example
  and `docs/generic-programming.md`'s `Traverse.with` and `joinWith` examples.
  Existing carrier, reflection and diagnostics tests also contain affected forms.
- An adjacency-only rule would additionally make layout semantic: `f g(x)` and
  `f g (x)` would differ. The current formatter renders the latter as the former,
  so this cannot be introduced as a grammar-only patch.

Added `tests/documented_application_syntax_test.ts` to protect carrier grouping
through both formatter modes and execute the documented Result adapter, generic
traversal, Task continuation progression (bound, inline, placeholder, bare Void
and named parameter), and pipe insertion/computed-function forms. Existing tests
already cover reflected `Monad.via Result console.log(input)`, Task/Result
composition and `Traverse.with` behavior.

Validation: the new test file typechecks, both new tests pass, and the focused
documented-application/carrier/reflection/pipe run passes 32 tests with no failures.

Retain `area(Circle(10))` or `area (Circle(10))` for the original example. Keep
future syntax proposals constrained by these ordinary application and formatting
contracts. The ignored `research/application-precedence-audit.ts` and its JSON
reports record the experimental comparison; no production precedence was changed.

## Investigation (2026-10-28)

There are two separate production-v2 problems. These reproduce through
`parseCompilerModule`, `checkSource` and the formatter, without the REPL:

| Source | Current behavior |
| --- | --- |
| `let square = x => x*x;` | Splits into `square = x` and a zero-argument lambda phrase; checking fails with `unknown name x` |
| `let square = x => {x*x};` | Parses as a space application of `x` to a zero-argument lambda; `unknown name x` |
| `let square = (x) => x*x;` | Recovery inserts a block around `x*x;`; inferred `Number -> Void` |
| `let square = (x) => {x*x};` | Inferred `Number -> Number` |
| `let square = (x) => {x*x;};` | Inferred `Number -> Void`, as explicitly authored |
| `let square = (x) => (x*x);` | Also recovered into a statement block; inferred `Number -> Void` |

`src/grammar.peggy` requires a parenthesized `ParamList`. Its `LambdaBody` accepts
only a lambda block, another lambda, or a parenthesized **sequence** (which requires
a semicolon). An ordinary expression body is not accepted strictly. V2's
`LambdaBlock` brace recovery then inserts braces, and `BlockSeqItem` consumes the
authored declaration semicolon before recovery inserts the closing brace. The
resulting block has an implicit Void result. The formatter with fixes exposes
exactly that recovered structure.

### Scope of a v2 change

The narrow expression-body case is small enough to investigate as a v2 patch:
accept an expression body whose terminating semicolon remains owned by the outer
phrase. This is a parser/recovery boundary change; inference already handles an
expression-valued lambda body. Preserve authored `{expr;}` as Void.

It is not just an edit to a generated parser: change the grammar source, account
for ordered alternatives/recovery and transparent surface projection, rebuild the
self-hosted frontend and generated artifacts, and check formatting and semantic
goldens. Cover arithmetic, grouped expressions, nested lambdas, call arguments,
following declarations and explicit Void bodies. Return-annotation ownership and
space application also need checking before claiming general expression support.

Bare parameters are a separate grammar/surface change and interact with space
application. Do not bundle a general punctuation-light syntax redesign into the
semicolon fix.

### V3 already preserves the intended result during recovery

Ran `tooling/frontend-v3/adapters/js/editor.ts` against the same examples:

```text
let square = x => x*x;      -> let square = (x) => { x * x };
let square = (x) => x*x;    -> let square = (x) => { x * x };
let square = (x) => {x*x;}; -> explicit statement remains inside the body
```

`tooling/frontend-v3/src/parser/program.wm` recognizes bare lambda prefixes and,
when recovering missing body braces, constructs `BlockBody([], Some(value))`.
It leaves the outer semicolon outside that body. These remain marked repairs,
not a decision that omitted punctuation is valid strict syntax. V3 is not yet the
production compiler frontend.

Recommendation: the narrow v2 expression-body/semicolon fix is reasonable if this
is hurting current use; defer broad punctuation-light syntax to v3, which already
has the desired recovery behavior. No production parser change was made in this
investigation. Reproduction scripts/log are in gitignored `research/` as
`issue-triage-2026-10-28.ts`, its `.log`, and `issue-triage-v3-2026-10-28.ts`.
