# Semicolon Layering

This note reframes semicolon work as a grammar correctness refactor, not a small
feature addition. The earlier `semicolon-sequencing.md` plan treats
parenthesized sequencing as a safe subset. That is still a useful implementation
step, but it is probably too conservative as the language design target.

Workman syntax is close enough to Standard ML that semicolon behavior can be
made more fundamentally equivalent to SML by modelling the same phrase layers:

```txt
program / top declaration
declaration
expression
```

In that model, `;` is not an ad hoc terminator owned by `let`, `type`, `record`,
or `import`. It is a separator or delimiter at the current phrase layer.

## SML Shape

The SML Definition uses semicolons at more than one syntactic layer.

Core sequential declarations have the shape:

```txt
dec1 <;> dec2
```

Structure declarations have the same idea:

```txt
strdec1 <;> strdec2
```

Programs / interactive top-level phrases are also semicolon-delimited:

```txt
topdec ; <program>
```

Expression sequencing is a derived expression form:

```sml
(exp1; ...; expn; exp)
```

and derives to nested wildcard cases:

```sml
case exp1 of _ =>
  ...
  case expn of _ => exp
```

This means discarded expressions are not required to have type `unit`.

The important design lesson is not that every `;` token is the same AST node. It
is that semicolon separates phrases at the current grammar layer.

## Current Workman Shape

Current Workman already has the broad layers, but semicolon handling is baked
into individual rules:

```txt
Start   = TopDecl*
TopDecl = ImportDecl | RecordDecl | TypeDecl | LetDecl
LetDecl = "let" ... ";"
```

Blocks have a separate sequence-like rule:

```txt
Block     = "{" BlockItem* result:Expr? "}"
BlockItem = Decl | Expr ";"
```

This means `{ print("a"); 42 }` already behaves like SML expression sequencing:
evaluate `print("a")`, discard its result, then return `42`.

The mismatch is mostly architectural. Workman declarations own their trailing
semicolon, while SML puts semicolon behavior in the surrounding declaration or
program phrase.

## Target Workman Shape

The target should be:

```txt
Semicolon belongs to the enclosing phrase layer.
Workman requires semicolons in declaration/program layers.
Expression-layer semicolon forms a sequence expression.
Trailing expression semicolon is Workman sugar for `; void`.
```

For top-level declarations:

```txt
Module     = TopPhrase*
TopPhrase  = TopDecl ";"
TopDecl    = ImportDecl | RecordDecl | TypeDecl | LetDecl
LetDecl    = "let" ...
TypeDecl   = "type" ...
RecordDecl = "record" ...
ImportDecl = "from" ...
```

This preserves current syntax:

```wm
let x = 1;
type Option<T> = None | Some<T>;
record Point = { x: Number, y: Number };
```

but semantically the final `;` is a top phrase delimiter, not part of each
declaration rule.

For expression sequences:

```txt
SeqBody =
  item:Expr ";" ...
  result:Expr?

missing result => Void
```

Then both braces and parenthesized sequences can use the same expression
sequence concept:

```wm
{ print("a"); 42 }
(print("a"); 42)
```

Both mean:

```txt
Seq(items = [print("a")], result = 42)
```

The Workman extension is:

```wm
{ print("a"); }
(print("a");)
```

which means:

```txt
Seq(items = [print("a")], result = void)
```

Equivalently:

```txt
e;  ==  e; void
```

inside expression sequence contexts.

This extension removes the optionality axis for expression-final semicolons by
making presence and absence mean different things:

```wm
{ print("a") }   -- result is whatever print returns
{ print("a"); }  -- result is Void
```

## Why This Should Not Break Current Syntax

The common worry is that making `;` SML-like would invalidate existing Workman
programs because declarations currently require semicolons. That only happens if
`;` is incorrectly treated as expression sequencing everywhere.

SML itself has semicolon behavior at declaration and program layers, so current
Workman declarations can remain legal:

```wm
let x = 1;
let f = () => { print("a"); 42 };
```

The inner semicolon belongs to the block expression sequence. The outer
semicolon belongs to the top-level phrase layer.

This is exactly the distinction Workman should model.

## Blocks

Workman blocks are already close to SML expression sequences:

```wm
{ print("a"); 42 }
```

should be understood as the Workman spelling of:

```sml
(print "a"; 42)
```

or, when declarations are present, as analogous to:

```sml
let
  dec
in
  exp1;
  exp2
end
```

Whether Workman continues to allow declarations after expressions inside blocks
is a separate block grammar question, not a semicolon question. The semicolon
layering refactor should not need to decide that immediately unless it falls out
of parser cleanup.

## Typechecking Rule

Expression sequencing should follow SML:

```txt
e1 : T1
e2 : T2
...
en : T
----------------
e1; e2; ...; en : T
```

Discarded expressions are not required to be `Void`.

This already matches current Workman block behavior, where semicolon-terminated
block items are inferred and discarded without requiring a `Void` type.

An optional lint may later warn about discarded non-`Void` values, but that
would be a style warning, not a type error.

## Implementation Direction

Refactor in the direction of phrase layers:

1. Move top-level semicolons out of individual declaration rules and into a
   top phrase rule.
2. Do the same for block-local declarations if practical: parse declarations
   independently from the surrounding `;`.
3. Extract the existing block expression sequencing shape into a reusable
   sequence-body concept.
4. Use that sequence concept for brace blocks.
5. Add parenthesized expression sequences.
6. Preserve trailing expression semicolon as `void` sugar.
7. Add tests showing existing `.wm` syntax still parses.

The important compatibility examples are:

```wm
let x = 1;
let f = () => { print("a"); 42 };
let g = () => { print("a"); };
let h = () => (print("a"); 42);
let i = () => (print("a"););
```

The intended AST shape can continue to reuse `Block` if that remains convenient:

```txt
Block(items = [e1, e2, ...], result = finalExpr)
```

or the compiler can introduce a distinct `Seq` node if diagnostics benefit from
distinguishing brace blocks from parenthesized sequences.

## Open Questions

- Should parenthesized `(e;)` be accepted immediately, or should trailing
  `void` sugar initially apply only to brace blocks?
- Should block declarations remain mixed with expressions, or should blocks
  eventually move toward an SML-like `decls first, expression sequence second`
  shape?
- Should Workman keep mandatory top-level semicolons permanently, even though
  SML declaration sequencing allows optional semicolons in some layers?
- Should docs describe `{ ... }` as Workman's primary spelling of SML sequence
  expressions?

## Summary

The stronger target is not "add a subset of SML semicolon sequencing because the
full behavior might break Workman." The stronger target is:

```txt
Make Workman semicolon behavior emerge from SML-like phrase layering.
Keep current mandatory declaration/program semicolons.
Make brace blocks and parenthesized sequences equivalent at the expression layer.
Add one explicit Workman extension: trailing expression `;` means `; void`.
```

This is more principled, closer to SML, and likely compatible with existing
Workman syntax.
