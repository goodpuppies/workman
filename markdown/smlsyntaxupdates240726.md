# SML Syntax Updates 2026-07-24

This note records agreed Workman syntax changes derived from the review of `docs/smlparallels.md`
against the Revised Definition of Standard ML. It is an implementation and migration document, not
user-facing language documentation.

The design criterion is to keep SML features that add local expressive power through small,
orthogonal rules. Workman does not need to reproduce complex SML machinery when files, imports,
records, functions, datatypes, or explicit bindings already express the useful behavior.

## Agreed Updates

### General Type Constraints With `:`

Add type constraints to arbitrary expressions and patterns:

```wm
let point = (.{ x = 1, y = 2 } : Point);
consume(makeValue() : Result<Number, String>);

match(value) {
  (Some(x) : Option<Number>) => { x },
  None => { 0 },
}
```

This is one semantic feature with two grammatical placements. Expressions and patterns need
different surface AST nodes, but elaboration should perform the same operation:

1. Infer the expression or pattern type.
2. Elaborate the written type.
3. Unify the two types at the constraint site.

A constraint is never a coercion, conversion, FFI assertion, or cast.

Workman already accepts annotations on `let` bindings, lambda parameters, and lambda results.
General constraints extend that mechanism to precise nested locations. They improve error locality,
document intermediate intent, constrain direct call arguments, and disambiguate nominal record
literals.

Type-variable names introduced by a general constraint are local to that one constraint site.
Repeated names within the constraint refer to the same variable, but the same spelling in a separate
constraint introduces a fresh variable. Existing let-group annotations and the parameter and result
annotations of one lambda retain their wider shared scopes.

Definition anchors:

- `syncor.tex` includes typed expressions and typed patterns in the Core grammar.
- `statcor.tex` `typedexp-rule` and `typedpat-rule` require the inferred phrase type and elaborated
  written type to be the same.

### Distinct Function-Type Arrow

Replace the current `(T) => U` function-type syntax with `T -> U`:

```wm
let id: T -> T = (t) => { t };
let first: (T, Y) -> T = (t, y) => { t };
let apply: (T -> Y, T) -> Y = (f, value) => { f(value) };
```

The syntax rules are:

- `=>` constructs lambda values and separates match patterns from arm bodies.
- `->` appears only in function types.
- `T -> U` is a unary function type.
- `(T, Y) -> U` takes one tuple-shaped argument.
- `T -> Y -> Z` associates to the right as `T -> (Y -> Z)`.
- `(T -> Y) -> Z` uses parentheses to group a higher-order domain.
- Remove standalone parenthesized type syntax such as `(T)`. It must not remain as an alternative
  spelling of `T` or as a one-element tuple type.
- `Void -> Z` is the type of a zero-argument surface function.

This is a coordinated source migration. The parser, surface AST, formatter/type renderer,
diagnostics, FFI annotations, frontend-v2 grammar, editor support, fixtures, examples, tests, and
user documentation must change together. Compatibility handling for the old arrow should be an
explicit migration decision rather than an accidental parser ambiguity.

### Lightweight Chained Curried Lambdas

Accept a lambda directly as another lambda's body:

```wm
let f = (a) => (b) => (c) => {
  result(a, b, c)
};
```

This desugars to the existing nested form:

```wm
let f = (a) => {
  (b) => {
    (c) => {
      result(a, b, c)
    }
  }
};
```

The change removes intermediate block ceremony. It does not change currying, capture, application,
inference, or runtime semantics. The final body remains a block; this decision does not by itself
approve arbitrary expression-bodied lambdas.

Whitespace application is already implemented:

```wm
f x y
```

It associates to the left and means `f(x)(y)`. It remains distinct from `f(x, y)`, which passes one
tuple-shaped argument.

### Mutually Recursive Datatype Groups

Add datatype groups using `and`:

```wm
type Tree = Node<Forest>
and Forest = Empty | Trees<Tree, Forest>;
```

The whole group must introduce its nominal type names before constructor payloads are resolved.
Constructor names must be checked for collisions across the complete group. Equality,
exhaustiveness, export, nominal-fact, Core-lowering, REPL, and import metadata must be produced for
the group consistently.

Current Workman supports `and` only for `let` groups. Recursive `let` elaboration already provides a
useful placeholder-first analogy, but datatype groups require their own type-environment staging.

### Simultaneous Type Abbreviations

Add non-recursive type-alias groups:

```wm
type Name = String
and Count = Number;
```

The bindings are simultaneous rather than recursively defined. They use the same declaration-group
surface convention as `let ... and ...` and mutually recursive datatypes.

The parser and elaborator must distinguish an all-alias group from a mutually recursive datatype
group. Whether aliases and datatype bindings may be mixed in one `and` group should be decided
explicitly; SML's `withtype` should not emerge accidentally from permissive parsing.

### File-Level `private`

A `private` keyword is planned as a small Workman-specific hiding mechanism, but it is low priority.
It should control which top-level values, types, records, and constructors enter the file's visible
import environment.

Workman files already elaborate as implicit, flat structures. `private` adds hiding to that model
without adopting explicit or nested structure declarations, signatures, opaque ascription, or
`abstype`. Exact syntax and the interaction with named, namespace, and open imports still require a
separate design.

## Deliberate Omissions

### Datatype Replication

SML datatype replication preserves an existing datatype's nominal identity and copies its
constructor environment under another type binding:

```sml
datatype color = Red | Blue
type shade = color
datatype tint = datatype color
```

Both `shade` and `tint` share `color`'s type identity. Unlike the alias, the replication also
reintroduces `Red` and `Blue` through the replicated datatype binding. This is especially useful
with SML structures and signature matching.

Workman can use a type alias to preserve identity and an explicit named import to bring constructors
into scope. Dedicated datatype-replication syntax is omitted for now.

### Other Omissions Confirmed By This Review

- Character literals and a distinct character type: use one-character `String` values.
- Explicit SML equality type variables such as `''a`.
- General exceptions: use `Option`, `Result`, and `Panic`.
- References, dereference, and assignment.
- Structural record rows and flexible record constraints.
- User-defined fixity and symbolic operators.
- Explicit and nested structures, signatures, sharing, and functors. Workman files already provide
  implicit flat structures.
- `while`, which adds little without mutation and is expressible through guarded recursion.
- Direct layered/as-pattern syntax. An outer binding or match-function parameter can retain the
  whole value while a nested pattern binds its components.
- A separate `fun` declaration syntax. `let rec` and match functions cover the useful behavior.
- Exact `local ... in ... end` syntax. Lexical block expressions cover the useful behavior.

## Still Open

### `withtype`

`withtype` is convenient when helper aliases belong next to a datatype group, but many uses can be
written as ordinary aliases. Reconsider it only after mutually recursive datatype and simultaneous
alias groups have precise rules.

### Migration And Implementation Order

A practical order is:

1. Change function type parsing and rendering from `=>` to `->` across both frontends and all
   diagnostics.
2. Add chained-lambda parsing as a small surface desugaring.
3. Add the shared type-constraint elaboration operation, then expose it in expression and pattern
   grammar positions.
4. Add grouped type-declaration AST representation and parser recovery.
5. Implement simultaneous aliases.
6. Implement mutually recursive datatype environment staging and downstream metadata.
7. Design and implement `private` separately.

Each syntax change needs positive parser, inference, Core, diagnostic, frontend-v2, LSP, REPL, and
module/import tests in proportion to the layers it affects.
