# Computed equality patterns

Use `=(expression)` in a `match` arm to compare the subject with a computed value:

```wm
let mood = match(true) {
  =(count == 0) => { "A clean slate." },
  =(count > 0) => { "On the bright side." },
  _ => { "Exploring the negatives." },
};
```

A bare name pins an existing value; `=(...)` computes a value and uses the same
equality operation. It is not a guard: the expression must have the subject's
type. A numeric subject compared with `=(count > 0)` is a type error. Matching
`true` makes Boolean conditions useful as patterns.

The subject is evaluated once. Arms are tried in order. Each expression is
evaluated once when its check is reached; checks inside tuples, records, lists,
and constructors run left to right. Earlier shape/value failures skip later
checks. An earlier successful arm skips every later arm. Expressions are not
hoisted into eagerly evaluated bindings.

```wm
let expected = 3;
match(Some(3)) {
  Some(=(expected + 0)) => { "hit" },
  _ => { "miss" },
};
```

Expressions use the enclosing lexical scope, without new binders from the same
pattern. If a name exists outside and as a new pattern binder, the computed
expression reads the outer value; the arm body reads the new binder. This avoids
adding binding-order dependencies or implicit guards.

Parentheses still group patterns. `Some(x)` destructures and binds `x`, while
`=(Some(x))` constructs a comparison value using an existing `x`.

Computed patterns are refutable. Include a fallback unless structural arms cover
every case; the checker does not prove arbitrary expressions exhaustive.

The current host-language implementation supports match arms, including named
and first-class match functions. Ordinary `let` and lambda parameter patterns do
not support this form. Match guards (`when`) remain unsupported.
