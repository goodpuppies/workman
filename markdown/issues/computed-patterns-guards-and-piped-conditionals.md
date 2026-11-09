# Computed equality patterns and piped conditionals

Status: computed equality patterns and piped conditionals implemented; guards deferred.

The earlier deferral was revisited for the concrete React mood-expression use case.
The accepted implementation uses explicit `=(expr)` syntax and enclosing-scope
lookup only: computed expressions cannot read new binders from the same pattern.
See `docs/computed-patterns.md` for current behavior.

## Computed equality patterns

WM already supports comparing a subject with an existing pinned value:

```wm
let expected = calculate();
match(value) {
  expected => "hit",
  _ => "miss"
}
```

The `=(expr)` pattern computes a comparison value when its arm is reached,
for example `=(calculate())` or `=(limit - 1)`.

Computed equality does not directly replace a guard: with a numeric subject,
`=(x > 0)` would compare that number with a Boolean. A guard instead tests the
Boolean condition after structural matching and continues to another arm if it
is false.

The previously considered same-pattern-binding extension could emulate guards by
matching an additional Boolean slot (this extension remains unsupported):

```text
match(Some(1), true) {
  (Some(x), =(x > 0)) => "positive",
  (Some(_), _) => "nonpositive"
}
```

However, that would require computed patterns to see bindings introduced earlier
in the same pattern, establishing left-to-right evaluation and binding scope.
The current preference is more explicit code rather than adding this machinery.
Constructor payloads such as `Some(x)` already bind `x`; they do not need a
`Var(x)` wrapper. Bare names in other match-pattern positions are pinned.

## Alternative: pipe a Boolean into an explicit conditional

The accepted and implemented alternative is this pipeline stage:

```wm
condition :> if { "positive" } else { "nonpositive" }
```

This uses the piped Boolean as the condition, equivalent to:

```wm
if (condition) { "positive" } else { "nonpositive" }
```

For example, an explicit match can unwrap and test an optional value before
branching:

```wm
(Some(1) :> match {
  Some(x) => x > 0
}) :> if { "positive" } else { "nonpositive" }
```

The missing `None` arm is intentional: `None` would still hit a non-exhaustive
match, rather than becoming the conditional's false branch. This distinction
must survive any future implementation or rewriting of the example.

The implementation lowers to an ordinary conditional: evaluate the incoming
Boolean once, evaluate only the selected branch, retain normal branch type
checking and block scope, and add no implicit name for the subject. Branch
blocks delimit nested conditionals. The formatter preserves the piped form.
The normal `if (condition) { ... } else { ... }` form remains supported.

Parenthesize the whole computed condition before piping it where necessary:
WM's current pipe precedence can otherwise send an operand into the next stage
before a comparison is evaluated. See
[pipe precedence relative to arithmetic and comparisons](forward-pipe-binds-tighter-than-arithmetic.md).

## Current decision

- Implement `=(expr)` in match arms using existing pinned equality and enclosing scope.
- Do not add `when` or an implicit guard interpretation of expression patterns.
- Use the piped `if` form for explicit branching in pipelines.
- This is a project-local design issue, not a request to publish an external issue.
