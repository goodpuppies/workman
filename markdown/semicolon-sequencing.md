# Semicolon Sequencing

`wm-mini` currently uses semicolons as declaration terminators and block-item separators. Standard
ML also has semicolon sequencing as an expression form:

```sml
(e1; e2; e3)
```

This means:

```txt
evaluate e1
discard its result
evaluate e2
discard its result
evaluate e3
return e3
```

The long-term goal should be to make Workman semicolon behavior align with SML as strictly as is
practical, not merely to add an SML-ish convenience syntax.

## Current Workman Behavior

Current blocks already contain a related idea:

```wm
{
  print("a");
  print("b");
  42
}
```

This evaluates the semicolon-terminated block items, discards their results, and returns the final
expression.

Top-level declarations also require semicolons:

```wm
let x = 1;
let y = 2;
```

But semicolon sequencing is not currently a general expression form:

```wm
let x = (print("a"); 42);
```

is planned, not currently supported.

## Target Semantics

The target should follow SML's sequencing semantics:

```txt
e1; e2
```

is an expression whose result is the result of `e2`.

For longer sequences:

```txt
e1; e2; ...; en
```

the result is `en`.

Earlier expressions are evaluated for effect and their values are discarded.

## Typechecking Rule

The SML Definition presents sequencing as a derived form. In Appendix 1, a sequence:

```sml
(exp1; ...; expn; exp)
```

is derived into nested `case` expressions:

```sml
case exp1 of _ =>
  ...
  case expn of _ => exp
```

Because `_` can match a value of any type, the Definition does not require discarded sequence
expressions to have type `unit`.

Workman should follow that rule. Earlier sequence expressions should not be required to have type
`Void`.

Target typing shape:

```txt
e1 : T1
e2 : T2
...
en : T
----------------
e1; e2; ...; en : T
```

This also matches current Workman block behavior, where semicolon-terminated block items may have
any type and their values are discarded.

An implementation may later add an optional lint for discarded non-`Void` values, but that would be
an editor/style warning, not SML static semantics and not a type error.

## Surface Forms

The minimal future syntax:

```wm
let x = (print("a"); 42);
```

Nested examples:

```wm
let y = (
  print("a");
  print("b");
  42
);
```

Inside blocks:

```wm
let main = () => {
  (print("a"); print("b"); void)
};
```

## Parser Strategy

Implementation can start with parenthesized sequences:

```txt
( expr ; expr ; ... ; expr )
```

This avoids ambiguity with top-level declaration terminators and block item separators.

Later, the grammar can be reviewed for whether semicolon sequencing should be available anywhere an
expression appears, matching SML more closely.

Important cases to preserve:

```wm
(a, b)      -- tuple
(a)         -- grouping
(a; b)      -- sequence
```

The AST can probably reuse `Block`:

```txt
Block(items = [a], result = b)
```

or introduce a distinct `Seq` node if diagnostics or stricter typing need to distinguish SML
sequencing from Workman blocks.

## Diagnostics

Diagnostics should distinguish:

```wm
let x = print("a"); 42;
```

from:

```wm
let x = (print("a"); 42);
```

The first is still a declaration followed by another phrase/block item depending on context. The
second is a sequencing expression.

If discarded-value linting is added, it should point at the discarded expression:

```txt
discarded non-Void value in sequence
```

This should not be a type error if Workman is following the SML Definition's derived-form behavior.

## Checklist

- Follow the SML Definition: discarded sequence items are not required to be `Void`.
- Decide whether to add a non-typechecking lint for discarded non-`Void` values.
- Decide whether sequence should reuse `Block` or get a distinct AST node.
- Add parser support for parenthesized semicolon sequences.
- Preserve tuple/group parsing behavior.
- Add type inference tests for result type and discarded-item rule.
- Add runtime/codegen tests for evaluation order.
- Update `docs/wm-minisyntaxguide.md`.
- Update `docs/smlparallels.md` once implemented.
