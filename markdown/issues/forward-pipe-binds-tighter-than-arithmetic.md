# Issue: `:>` binds tighter than arithmetic, comparison, and boolean operators

Status: open

## Summary

The forward pipe `:>` sits above every binary arithmetic, comparison, equality,
and boolean operator in the grammar. As a result `a + b :> f` parses as
`a + (b :> f)`, not `(a + b) :> f`.

Every other ML-family language that has a pipe operator declares it at the
lowest infix fixity, so that the whole left-hand expression is piped:

```sml
infix 0 |>
```

Workman's binding is the opposite, and it is silent: nothing in the expression
requires parentheses, the result is often still a valid type, and the program
does the wrong thing instead of failing.

Standard ML has no forward pipe in its core grammar at all, so this is not a
divergence from the Definition so much as a divergence from the expectation
every reader brings to a pipe operator.

## Minimal reproduction

```wm
let tenx = (v) => { v * 10 };
print(1 + 2 :> tenx);
```

Observed:

```text
21
```

The pipe consumed only `2`, so the program computed `1 + (2 :> tenx)` = 21.
The intended meaning, and what any reader expects, is 30:

```wm
print((1 + 2) :> tenx);
```

```text
30
```

## Why it matters

The failure mode is silent type-correctness-preserving misparse. Unlike a name
error or an arity error, nothing surfaces. Pipelines are precisely the place
where people stop parenthesizing, because the operator's whole purpose is to
remove that noise:

```wm
-- reads as "compute the total, then add tax"
subtotal + tax :> roundMoney

-- actually computes subtotal + (tax :> roundMoney), or errors
```

The hazard grows with every additional operator in the chain. `&&`, `||`,
`==`, `<` are all below the pipe, so any guard or comparison feeding a pipe is
affected too.

## Current cause

Grammar precedence, in `src/grammar.peggy:389-404`:

```peggy
Binary = Or
Or = left:And rest:(_ op:("||") _ right:And { return { op, right }; })*
And = left:Equality rest:(_ op:("&&") _ right:Equality { return { op, right }; })*
Equality = left:Compare rest:(_ op:("==" / "!=") _ right:Compare { return { op, right }; })*
Compare = left:Add rest:(_ op:("<=" / ">=" / "<" / ">") _ right:Add { return { op, right }; })*
Add = left:Mul rest:(_ op:("++" / "+" / "-") _ right:Mul { return { op, right }; })*
Mul = left:Unary rest:(_ op:("*" / "/" / "%") _ right:Unary { return { op, right }; })*
Unary = op:("!" / "-") _ value:Unary { ... } / Pipe
Pipe = left:Postfix rest:(_ ":>" _ right:(PipeMember / Postfix) { ... })*
```

Each rule binds tighter than the rule above it. `Pipe` is reached through
`Unary`, which is the operand of `Mul`, so `:>` outranks `*`, `/`, `%`, `+`,
`-`, `++`, the comparisons, `==`, `!=`, `&&`, and `||`.

The surface semantic path in `src/frontend_v2_surface_semantic.ts:690-721`
follows the same nesting.

## Existing call sites that depend on the current binding

Changing the precedence is not a one-line grammar edit. At least one shipped
example is written the current way and would change meaning:

`examples/github_repos.wm:76`:

```wm
heading ++ "\n" ++ "=" :> .repeat(heading :> .length :> Result.withDefault(0)) :> Result.withDefault("") ++ "\n\n" ++ body
```

This reads `heading ++ "\n" ++ ("=" :> .repeat(...) :> Result.withDefault("")) ++ ...`.
Under lowest-pipe precedence the leading `"Recent ..." ++ "\n" ++ "="`
concatenation would instead be the pipe operand, producing a different string.

A survey of the repository found no other shipped call site that pipes a bare
unparenthesized arithmetic or comparison operand, and no test in
`tests/pipe_test.ts` that asserts this precedence. `examples/node-gotchi.wm:150`
pipes a parenthesized `Math.min(...)` call, which is precedence-independent.

## Proposed resolution

1. Move `Pipe` down the precedence chain so it binds looser than every binary
   operator, matching `infix 0 |>` in the rest of the ML family.
2. Keep `:>` right-associative and left-associative respectively as today:
   `a :> b :> c` is left-associative, and `a :> f(x)` must still parse as a
   single call.
3. Preserve `PipeMember` forms (`.map(...)`, `.log(...)`) at their current
   tight binding relative to `Postfix`, so `value :> .map(f)` and
   `receiver.method() :> .log(x)` keep working.
4. Audit and update `examples/github_repos.wm:76` before or with the change.

An alternative, if the current binding is retained deliberately, is to require
that a pipe's left operand be parenthesized or a single primary expression, and
reject the ambiguous form at parse time. That converts a silent misparse into a
diagnostic, which is strictly better than the status quo, but it is a larger
source-compatibility break than changing precedence.

## Documentation gap

`docs/smlparallels.md:653-674` presents the pipe as a plain re-spelling of
application and shows only forms where the operand is already a parenthesized
expression or an identifier. The precedence relationship is never stated, so a
reader cannot see the hazard. Whichever resolution is chosen, the chosen binding
belongs in that section.

## Regression coverage

Add parser and evaluation tests pinning the binding:

1. `1 + 2 :> tenx` and `(1 + 2) :> tenx` produce the same result;
2. `a && b :> f` pipes the whole conjunction;
3. `a == b :> f` pipes the whole comparison;
4. `x :> f :> g` remains left-associative;
5. `value :> .map(f)` and `receiver.method() :> .log(x)` still parse as
   intended;
6. `examples/github_repos.wm` still produces its current output.
