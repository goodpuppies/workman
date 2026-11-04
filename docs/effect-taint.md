# Inferred effect taint (experimental)

The compiler displays `!` on values produced through an effectful or unchecked boundary. Printing,
foreign calls and explicit panic introduce taint. Taint is additive: combining clean and tainted
values retains the taint.

```wm
let effect = () => { print("hello"); 1 };
let value = effect();
let next = value + 1;
let clean = 5;
```

The inferred types are:

```text
effect : Void -> Number!
value  : Number!
next   : Number!
clean  : Number
```

## Sequences and containers

A local sequence shares taint among its items and its result. Top-level declarations remain
independent.

Container elements and the container itself occupy different type positions:

```wm
let sequence = () => { effect(); [1, effect()] };
let elements = () => { [1, effect()] };
```

```text
sequence : Void -> List<Number!>!
elements : Void -> List<Number!>
```

Ordinary tuples keep independent element positions: `(effect(), "clean")` has type
`(Number!, String)`. A local sequence shares taint across its evaluated members while their
underlying types remain independent.

An outer `!` means producing the value crossed an effect, so only what ran before a value adds one.
A value's own contents do not: `elements()` is still `List<Number!>`. The preceding call in
`sequence` is what gives its result the outer `!`.

Using a value that contains taint does propagate it. Every input of a computation counts, including
a discarded one:

```wm
let discard = () => { let pair = (effect(), 1); 1 };
```

`discard` returns `Number!`. Discarding the tuple does not discard the effect. A `match` result
carries its scrutinee's `!`, and `let` destructuring passes along a known `!`, so extraction cannot
remove taint. A `match` arm's bindings keep their own positions, so mapping over
`Result<Number, Js.Error>!` gives `Result<Number, Js.Error>!`, with no `!` added inside. Propagation
stops at function bodies: storing `(() => { effect() }, 1)` does not execute `effect`. A function
value's own outer `!` still counts.

A concrete datatype or record field has no type argument to record `!` in, so a tainted value stored
there marks the constructed value. With `type Box = | Box<Number>`, `Box(effect())` has type `Box!`,
and with `type H = | H<Void -> Number>`, `H(effect)` has type `H!`. A generic field records it in
the type instead: `Some(effect())` has type `Option<Number!>`, and `Some(effect)` has type
`Option<Void -> Number!>`. Record literals and constructor calls follow the same rule.

## Functions

Function argument taint is hidden in type displays. Callback return taint remains visible, for
example `(Void -> Number!) -> Number!`.

An annotation does not hide taint. `let value: Number = effect();` is `Number!`, and a callback's
result stays open for each call even when the signature names a concrete type: with
`let run = (f: Void -> Number): Number => { f() };`, `run(effect)` is `Number!` and `run(clean)` is
`Number`.

Creating a function does not execute its body. Calling an effectful function, including through a
higher-order function, propagates its result taint. A discarded effectful result still taints its
enclosing sequence.

## Language server

Hover, inlay hints, signature help and completion all show `!`. A long inlay label keeps a trailing
`!` when it is shortened, for example `List<(Number, Stri...!`. An annotated binding has no inlay,
so its `!` appears on hover only.

## Prototype scope

This prototype infers and displays taint as a bit on HM types. Unifying `T` with `T!` gives `T!`,
replacing what the variable involved holds. A sequence with an unresolved member keeps a link to
that HM variable, and instantiation freshens it like any other. It does not add source-level `T!`
annotations, purity enforcement, runtime wrappers, or optimizer rules. FFI error handling through
`Result` and `Task` continues to work independently of these marks.
