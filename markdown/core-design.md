# Core design

This document explains the reasoning behind Workman's core language decisions. The rules themselves
live in [`core-principles.md`](./core-principles.md); this is the commentary that says why they
exist and what they commit the language to. The FFI has its own reasoning in
[`ffi-principles.md`](./ffi-principles.md).

## What Workman is

Workman is meant to be all of the following at once:

- **A better TypeScript.**
- **A functional language that just works in 2026:** one-command runs, a good language server,
  errors that explain themselves, and direct access to the npm ecosystem. good ffi. crossplatform
- **A way to use Standard ML in a modern setting.** SML is a beautiful language whose ecosystem and
  tooling have kept it out of everyday use.
- **A bootstrapping path from TypeScript to native code.** The same programs should later compile
  through a future MLton backend, transpiled from Workman syntax as directly as possible, with
  native modules and FFI working the way the TypeScript side does now.
- **One uniform syntax across targets, in the spirit of Haxe.** Behavior is deliberately *not*
  identical everywhere. A GPU island such as wmslang cannot mean exactly what the host language
  means, and it should not pretend to.

The first three points don't conflict, because **SML already is a better TypeScript for the most
part.** Hindley-Milner inference, algebraic datatypes, pattern matching, immutability and a real
module semantics are what TypeScript users reach for and can't quite get. Workman therefore does
not need new semantic ideas. Its job is to take SML and add a syntax TypeScript developers can
read, access to the JavaScript ecosystem, and tooling that makes inference visible.

The native-code goal is what makes principle 1 load-bearing rather than aesthetic. An MLton backend
is only realistic if Workman already *is* SML underneath. The same holds for uniform syntax across
targets: it only stays coherent if there is one semantics underneath it.

## What Workman adds to SML

Every Workman addition should fall into one of three categories, and the first two should cover
almost everything.

**Syntax.** A different spelling of something SML already has: `let`/`let rec` for `val`/`fun`,
`(x) => { ... }` for `fn`, `match` for `case`, `type T = A | B<X>` for `datatype`, files as
structures, pipes (`:>`), the `.{ ... }` record literal and spread, `Carrier|...|` grouping, and
`via`. Each of these should lower to a small SML fragment. A construct that cannot lower that way is
a new feature, not sugar, and has to be justified as one.

**Visibility.** Making something SML leaves implicit explicit, or showing it back through tooling
(principle 4): explicit closure captures and their inlays, pinned patterns with `Var(x)` binders,
mandatory braces and `else`, and diagnostics that trace a type back to where it came from.
Principle 5 exempts this category from the "try userspace first" rule, because it adds no new
capability, only legibility.

**Semantics.** Only two additions are genuinely semantic:

- **Nominal records.** SML records are structural. Workman records are declared and nominal, and
  several records may share a label. These lower to SML records, with projection resolved by the
  same context rule SML uses for flexible records (see
  `issues/record-projection-resolution-is-not-sml-context-deferred.md`). The open question is how
  nominal identity survives when two records have identical fields.
- **The FFI.** TypeScript reflection, C imports and GPU islands are target boundaries, not core
  language. `ffi-principles.md` keeps them from reshaping the core.

These two are where principle 1 needs the closest watching, and so far they are also where the
subtle bugs have appeared.

## Deliberate omissions

With the core defined as "the SML subset that is implemented", the parts of SML that Workman
*leaves out on purpose* define the language as much as the parts it keeps.

| SML feature | Status | Short reason |
|---|---|---|
| `ref`, mutable arrays | Omitted | One way to do things; pressure goes into making immutable code better |
| Exceptions (`exception`/`raise`/`handle`) | Omitted | `Result` is exceptions made explicit; `Panic` is for bugs |
| `fun` and clausal function syntax | Omitted | `let rec` plus `match` covers it |
| Inline `structure` / `struct ... end` | Omitted | Files are the structures |
| Signatures and opaque ascription | Omitted | See below |
| Functors | Omitted | Records of operations cover the use cases |
| Equality types | Subset | The inferred attribute is kept; the `''a` machinery is not |
| `int`, numeric overloading and defaulting | Omitted | One `Number` (SML `real`); exact types are opt-in structures |
| `char` | Planned | Listed as intended syntax in the guide |

### Mutation: `ref` and arrays

`ref` is left out because of principle 2, not because mutation is hard to implement. The moment
`ref` exists, every loop, accumulator and cache has two forms: an immutable one and a mutable one
that is often more convenient or faster in the short term. The two would compete, the mutable form
would win locally, and effort would move away from making immutable code good. Principles 2 and 3
say that competition must never happen: the functional way should always be the path of least
friction, and when it is slower, the answer is a better compiler, not a less functional
alternative.

What this commits Workman to:

- **Immutable code has to keep improving.** Userspace first (principle 5): persistent data
  structures in std and fold-based state loops. Self-tail calls already compile to loops. After
  that, semantics-preserving compilation such as in-place reuse of provably unshared values, with
  the language server showing where it applies so it is not invisible magic.
- **Unavoidable mutation lives at target boundaries.** JavaScript objects, C buffers and GPU buffers
  are mutable whatever Workman says. They are reached through explicit carrier operations or basis
  operations, not through a general mutable cell in the core language. A game is a state value
  threaded through `update(state, input)` each frame, with mutation only where it meets rendering
  and GPU upload.

### Exceptions

At a single call boundary, an exception is a sum type: a function either returns a value or raises
an error, which is exactly `Result<T, E>`. What exceptions add on top is implicitness: the error
case is missing from the function's type, and propagation skips stack frames invisibly. Workman
keeps the concept and makes it explicit, in the same way explicit captures make closure
environments explicit (principle 4). **`Result` is exceptions made explicit.** That, more than
avoiding a second error channel, is why `exception`, `raise` and `handle` are omitted.

Errors in Workman are values: `Result<T, E>` for synchronous failure, `Task<T, E>` for
asynchronous failure, and carrier composition (`via`, pipelines, `Carrier|...|`) to propagate them.
Carriers do explicitly what exception propagation does implicitly.

The same rule applies to every source of raising code:

- **JavaScript:** safe imports convert thrown exceptions into `Result`/`Task` at the FFI boundary.
  `unsafe` controls that wrapping, never type precision (`ffi-principles.md` §11).
- **The SML Basis:** functions that raise return `Result` over a closed Basis error type. The Basis
  raises a small, documented set of exceptions, so unlike SML's open `exn` the error type can be an
  ordinary datatype. The mapping is a mechanical wrapper
  (`fn x => Ok (List.hd x) handle Empty => Err Empty`), so it still compiles directly to SML. See
  [`basis-design.md`](./basis-design.md).

**`Panic` is for bugs, not outcomes.** It covers states the program should never reach: match
failure, `Overflow` and `Div` from the exact numeric structures, and explicit `Panic("...")`. In
SML terms it is an exception that is raised and never handled, so it also compiles directly. The line between the
two follows Rust: an expected outcome such as "not found", "invalid input" or "file missing" is a
`Result`; a violated invariant is a `Panic`.

What is given up: SML code sometimes uses a local exception for non-local control flow, such as
escaping a traversal early with `exception Found`. In Workman that becomes a fold that stops
through a carrier, which is the functional way anyway (principle 3).

### Signatures and opaque ascription

SML's module language (signatures, transparent and opaque ascription, sharing constraints) is left
out along with inline structures. Files are the modules, and everything a file declares is visible
to importers.

The consequence to keep in mind: without signatures, Workman has no way to hide a representation.
An exported datatype exposes its constructors, and invariants are maintained by convention, for
example by only constructing values through the functions a module provides. If representation
hiding is ever needed, it has to come from a mechanism that still lowers to SML directly, such as
SML's `local ... in ... end` for file-private bindings, not from a reintroduced signature
language.

### Functors

Functors are left out; records of operations take their place. A record of functions is ordinary
core SML, so this choice keeps principle 1 trivially. The carrier design (`Result.carrier`,
`Monad.via Result`) shows the pattern: generic code takes a record of operations, and a carrier is
a value, not a module-level construct. See [`../docs/generic-programming.md`](../docs/generic-programming.md).

What is given up is the ability to abstract over *types* the way a functor argument can. Records
carry values, not types. Where that limits generic code, the answer follows principle 5: explore
userspace patterns first, and do not grow the core toward a module calculus.

### Equality

Many people consider SML's equality types a thorn: the `''a` syntax, `eqtype` specifications, and
the way equality leaks into signatures. Workman keeps the useful part and drops the rest.

- `==` and `!=` require a type that admits equality. On a type variable, the requirement is carried
  as an attribute and checked when the variable is resolved, which is SML's equality attribute
  without the syntax. It survives generalization: `let same = (a, b) => { a == b };` can be used at
  `Number` and `String`, and using it at a function type is rejected.
- There is no `''a` syntax and there are no `eqtype` declarations. Types that admit equality are
  the known equality-shaped ones: primitives, tuples, records and datatypes built from them.
- One deviation from SML to note: `Number` admits equality, whereas SML's `real` does not. `==` on
  `Number` compiles to `Real.==`, so this is still direct to express in SML. See [Numbers](#numbers).

### Numbers

Neither JavaScript nor SML handles numbers especially well. SML's numeric system is large: `int`,
`real`, `word`, `LargeInt`, `IntInf`, `IntN`, `WordN`, `RealN`, `Position`, overloading classes,
literal defaulting, and `fromLarge`/`toLarge` conversions between them. JavaScript has one double
and a separate `bigint`. Copying SML wholesale would bring its complexity in, and would also create
a conversion mess at the busiest boundary in the language: TypeScript's `number` means both indices
and measurements, and reflection cannot tell which one an API means. Every reflected `number` would
need converting to `int` or `real`, or a guessing heuristic that FFI principle 4 forbids.

The decision:

- **`Number` is SML's `real`, a 64-bit IEEE double, and the only numeric type in the core.** It is
  exactly JavaScript's `number`, so the FFI maps it without conversion, and exactly MLton's
  `Real64.real`, so principle 1 holds: a Workman program that uses only `real` is valid SML.
- **There is no numeric overloading or literal defaulting.** A numeric literal is a `Number`, and
  `+`, `-`, `*`, `/`, `%` and the comparisons are `Number` operations. SML's `int` is omitted from
  the core.
- **Exact fixed-width numbers are opt-in basis structures:** `Word8` through `Word64` today, and
  `Int32`, `Int64` and `IntInf` if a need appears. They are for binary formats, C interop and
  hashing, where the boundary already has precise types (a C header says `uint8_t`), so conversion
  is explicit there anyway. TypeScript's `bigint` maps to `IntInf` if it's added. SML's numeric
  precision lives in this low-level tier, not in everyday code.
- **Integer-ness is checked at runtime where an operation needs it.** An index, a length, a count
  or a shift amount that is not a suitable integer fails through the ordinary Basis exception rule:
  `Word8Vector.sub(v, 1.5)` fails with `Subscript`, and `Word8Vector.tabulate(-1, f)` with `Size`,
  each handled as the exception table in `basis-design.md` says. JavaScript does this implicitly;
  Workman makes it explicit.
- **`%` is JavaScript's remainder,** which truncates: `(0 - 7) % 3` is `-1`. This is the current
  behavior and what TypeScript users expect, and it is the Basis's `Real.rem`. Flooring division and
  modulo, SML's `div` and `mod` on `int`, are available as named functions in std (`Number.div`,
  `Number.mod`), where `Number.mod(0 - 7, 3)` is `2`.

The costs, accepted knowingly:

- **No exact integers above 2^53** without choosing `Word64` or `IntInf` explicitly. JavaScript and
  TypeScript share this limit, and identifiers that large already arrive as strings or `bigint`.
- **Native performance.** On MLton, loop counters and indices are doubles converted at each array
  access, which is slower than `int` in hot loops. If this matters, the answer is compiling
  `Number` code better (principle 3), not a second everyday number type.
- **Writing word values is verbose.** Word values are written as `Word8.fromNumber(1)`, and word
  arithmetic uses named functions (`Word8.add`). Literal syntax or operators on word types are
  possible later additions if word-heavy code becomes common.

### `char`

`char` is planned. Until it lands, single characters are strings.

## Targets and uniform syntax

The Haxe comparison is about syntax, not behavior. Haxe shows that one language can target several
runtimes, and also shows the failure mode: target conditionals spread through ordinary code, and
semantics drift toward what every target can manage.

The current direction, as practiced by wmslang:

- a target such as the GPU accepts a subset of Workman plus its own primitives;
- types may differ per target (a shader number is not a host `Number`), and target-specific code is
  bound at module and import boundaries rather than through conditional expressions.

A stricter rule is worth considering as the number of targets grows: **a construct either means
the same thing on a target or is rejected there; it is never reinterpreted.**

## Open decisions

- **A defined portable core.** Today the core is simply the implemented SML subset. The native
  bootstrap eventually needs a defined portable tier: the SML subset plus a std library built on
  the SML Basis, separate from target boundaries such as JavaScript imports, C imports and GPU
  islands. The low-level bytes work (`Word8Vector`, `PackWord`, `Binary`) already follows this.
- **Nominal identity in SML output.** Records with identical fields lower to the same SML record
  type. Whether that needs a wrapper depends on whether nominality is semantic or only a static
  check.
- **Checking principle 1 mechanically.** A `wm → SML` source emitter used as a conformance test, by
  type-checking the SML it emits for the test suite and examples, would catch violations
  automatically and would also be the first step of the MLton backend.
