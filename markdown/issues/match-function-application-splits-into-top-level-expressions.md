# Match-function application splits into top-level expressions

Status: fixed (2026-11-03)

## Resolution

Named match functions now enter the ordinary postfix application path alongside
anonymous match functions. Both `} true` and `}(true)` apply the function. Compact
`}true` is rejected as a syntax error for both forms, following the user's selected
policy. A lookahead guard prevents an adjacent argument from becoming a new implicit
phrase; explicit-call parentheses and subtraction remain available to the ordinary
postfix/arithmetic grammar.
Braceless match bodies retain their existing expression extent and arm ownership.

Regression checks cover recognition without recovery marks, a single declaration
in the compiler AST, named subject access, tuple subjects, chained calls, arithmetic
and pipes, formatting round trips, runtime results, and exact interactive REPL output.
The self-hosted frontend is rebuilt to a fixed point from the regenerated grammar.

## Reproduction

Checked with the production frontend (`parseCompilerModule`) and graph compiler
(`compileLibraryVirtual`) on 2026-11-03:

```wm
let named = match(x) => { true => 1, false => 1 } true;
let namedCall = match(x) => { true => 1, false => 1 }(true);
let compact = match{true=>1,false=>1}true;
```

All three compile without diagnostics. Inspection of the complete module AST
shows two declarations: the named binding holds the match lambda, and an implicit
`let it = true` follows it. The trailing argument is parsed as an independent
expression. This occurs even with a space before the named function's trailing argument.

The interactive REPL exposes the split directly:

```text
- match(x)=>{true=>1,false=>0}true;
it = <function> : Bool -> Number
it = true : Bool
```

The original investigation incorrectly described the argument as dropped after
examining only the first declaration; the full AST and REPL behavior correct that diagnosis.

These alternatives correctly evaluate to `1`:

```wm
let grouped = (match(x) => { true => 1, false => 1 }) true;
let spaced = match { true => 1, false => 1 } true;
let explicit = match { true => 1, false => 1 }(true);
```

The named and anonymous match functions have the same matching behavior; the named
form additionally exposes its parameter in each arm. That distinction should not
cause one expression to split into two implicit top-level bindings.

## Standard ML reference

The Revised Definition's resolved expression grammar in
`research/The-Definition-of-Standard-ML-Revised/app2.tex` distinguishes application
expressions (`appexp ::= atexp | appexp atexp`) from function expressions (`fn match`).
`syncor.tex` specifies that matches extend as far right as possible. Therefore
`(fn true => 1 | false => 0) true` applies the whole function, while
`fn true => 1 | false => 0 true` attempts `0 true` inside the final arm. This was
also checked with local SML/NJ 110.99.9: the former returns `1`; the latter reports
an operator-not-a-function error.

SML does not have WM's explicit braces terminating a match-function arm list.
Allowing application immediately after those braces is a WM surface-grammar
decision. The Definition's function-application semantics support applying the
resulting closure once that grouping is established; they do not justify the
current implicit phrase split.

## Expected behavior

Apply the trailing argument when separated by whitespace or explicit call parentheses.
Reject compact adjacency instead of accepting a declaration followed by an implicit
expression without an authored phrase separator. Compact support is a separate
[syntax proposal](compact-match-function-call-syntax.md).

The Definition's `prog.tex` requires `;` at the interactive phrase boundary, and
`app1.tex` derives `exp; program` as `val it = exp; program`. Adjacent declarations
can be sequenced without `and` (`synmod.tex`); that does not allow two bare
expressions to replace application. `and` groups bindings, not independent expressions.

The cheatsheet and syntax guide now document direct application for both forms.
