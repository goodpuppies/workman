# Why WON exists

WON is a deliberately "dumb" data format, closer to JSON than its tags and
attributes might suggest. It reads and writes ordinary data. Its goal is to
remove concrete JSON limitations that force workarounds in real applications,
while keeping the format small enough to implement yourself.

The motivating applications exchange data among WM, SML, JavaScript, and Zig,
and sometimes need people to edit that data. WON should make those exchanges
straightforward without requiring a schema system, a particular language,
or a particular runtime representation.

See [the concrete application examples](won-use-cases.md) for existing JSON
workarounds, proposed WON representations, and their practical limits, and
[the format specification](won.md) for syntax and observable behavior.

## Fix the data representation

Each feature should address a specific obstacle:

- Comments let people annotate configuration and temporarily disable sections.
- Blobs represent byte contents directly, without application-specific wrappers
  around strings or arrays of numbers.
- Exact number spellings let each application choose its numeric types without
  losing precision during generic parsing or requiring a numeric library.
  The token grammar is JSON's, so host-generated numbers need no respelling.
- Tags express named variants without inventing a record convention, such as
  a magic `__type` key, for every application.
- Attributes and mixed content express markup: a UI tree written as data in
  WM, in the spirit of JSX, is a list of text and tags with properties.
  Attributes are ordinary key/value fields, not a second value language.
- Bare keys and whitespace-separated entries reduce punctuation in edited files.
  Commas are accepted as whitespace so habitual JSON punctuation is harmless.

Features should earn their place by making existing application data easier
to represent. If a proposal mainly introduces a programming abstraction, put
it in a library. For any proposed feature, ask:

1. What concrete JSON workaround does it eliminate?
2. Does it describe data or introduce program behavior?
3. Can an implementation preserve it without understanding an application schema?
4. Can a tiny generic reader expose it directly?

Dates, UUIDs, sets, tuples, options, and results do not automatically need new
primitives: first test whether ordinary tags and existing values suffice.
File inclusion, environment lookup, imports, and schema-driven defaults would
add evaluation or application policy and are outside WON's format. A field or
tag named Include or Env is still just data; the reader performs no action.

There is one strict shape for each construct and fixed token spellings, with
flexible whitespace, commas, and comments. Avoid alternative forms, fallback
parsing, and compatibility modes.

### Considered and declined: type annotations

A `count = 3 : u64` or KDL-style `(u64)3` annotation was considered as a way
to give readers types without handwritten codecs. Other formats have two
kinds of type marker. One replaces the value, like EDN's `#inst "…"` and
YAML's `!date`. The other is an ignorable annotation, like KDL's `(u8)123` and
Ion's `int32::42`.

WON already has the first kind. Tags carry nominal types in the data
(`Pose{…}`, `BigInt(3)`), and an attribute can carry type metadata without
new syntax (`Value<type = u64>(3)`). An ignorable annotation would add only a
hint that readers which don't care never see. It does not remove codecs:

- Typed hosts ignore it, since the program's type decides the conversion.
  The [Zig experiment](won-zig.md) needed no annotations.
- A language like SML cannot use it either. A decode result's static type
  cannot depend on the document, so the program still matches a generic
  `Value` into its own datatype. Codec-free typed reading comes from code
  generated from the program's types (derive, `@typeInfo`, a WM compiler
  feature), not from the document.
- A shared vocabulary of type names (`u64`, `int64`, `bigint`) would drift
  towards a schema language.

Comments already serve as ignorable hints for people and tools:
`count = 3 // u64`. A reader discards them and attaches no meaning, which is
exactly what an ignorable hint is. Revisit annotations only if an untyped
reader shows a concrete need to distinguish types without changing the data's
shape, for example JS BigInt in the Stageforge harness.

## Generic access is the baseline

The core operations are ordinary data exchange:

```text
value → encode → WON bytes
WON bytes → decode → value
```

A small program must be able to read a document, access a field, inspect a
list, and forward an unfamiliar value without first supplying an application
schema. This directness is one of JSON's useful properties to preserve. See
[accessing WON data](won-access.md):

```wm
let name = Won.read(source) :> Won.get("name") :> Won.text;
```

Another implementation might expose field lookup through a map or pattern
matching. The specification constrains observable data and syntax, not how an
implementation stores it: records are field lists in WM, and an independent
Zig implementation need not use linked lists.

## Preserve data without prescribing its interpretation

One number case holds the exact spelling, rather than splitting the format
into host-sized integers and floating-point numbers. Generic reading and
forwarding preserve `1`, `1.0`, and `1e0` as distinct data. A host-specific
conversion may interpret all three numerically, but that is a separate
operation. A reader that eagerly converts numbers is not a lossless generic
reader unless it also retains the spelling.

Field order is available for traversal and writing. That does not give fields
positional meaning or make lookup depend on position. It also does not
establish a universal host equality or hashing policy.

Value preservation is not source preservation. The reader/writer keeps number
spelling and field order, but drops comments, commas, and original whitespace.
Comment-preserving editing would need additional implementation work.

`Date("2026-10-22")`, `BigInt(3)`, `Some(42)`, and `Ok(true)` are ordinary
tags. A generic reader preserves them without constructing a host date, big
integer, option, or result. No tag name or record field is reserved for
automatic host revival; application adapters agree on meanings themselves.

## Three responsibilities remain distinct

**Format correctness** belongs to WON. Reject malformed syntax, invalid UTF-8,
duplicate keys, and invalid token or payload shapes. Writing a programmatically
constructed value must also enforce the format's invariants.

**Host representation conversion** belongs at the language or application
boundary: bytes into a buffer, a number token into u64 or a finite float, a
field list into a host record. Small byte, list, result, and value-access
helpers are within the reference implementation's scope.

**Application validation** belongs to the application or another library. WON
does not decide whether a record is a valid Position, whether a command accepts
a field, or whether a number is in range. An earlier prototype shipped schema
combinators alongside the format; they were removed because they made schemas
look like a prerequisite for using WON. Do not reintroduce one under another
name.

Stageforgeman derives direct handlers and forwarded calls from a shared
inferred function-record factory, and its erased runtime boundary trusts that
relationship. Moving its transport to WON should not require a second
handwritten schema restating method types. Conversion may still need a policy
for tuples, nominal records, variants, and numeric types; the RPC integration
owns it. See [the Stageforge findings](won-use-cases.md#stageforge-integration).

## Keep application and transport policy outside the format

WON does not define actor routing, RPC, ownership transfer, resource lifetimes,
or IPC framing. A blob carries bytes, not a transferable GPU resource. A tag
carries a name and data, not executable behavior.

## Portable implementation

The reference implementation is the SubsetML Basis module `SubsetWon`, written in
SubsetML. It compiles natively with MLton and translates to the WM used through the
Basis snapshot, and the interop tests exchange documents between the two builds of one
conformance probe. It uses only other Basis modules; no host calls. Host I/O belongs to
callers.

Judge the implementation by how little an independent author needs to
understand to implement basic support, and by how much application workaround
code it removes. A larger abstraction stack is not the objective.

## Roadmap

1. Scanner and structural parser rewrite, per the
   [implementation notes](won-grammar.md).
2. A Zig reader/writer, tested against the WM corpus: done as an
   [experiment](won-zig.md), followed by a [Rust/Zig IPC experiment](won-ipc.md)
   and the [mapping guide](won-mapping.md).
3. An offline Stageforge harness exchanging the existing envelope shapes among
   WM, JS, and Zig, with explicit host conversions (see
   [use cases](won-use-cases.md#next-evaluation)).
4. Type-directed, trusted conversion between WM values and WON, generated by
   the compiler from inferred types (see [typed conversion](won-access.md#typed-conversion-trusted-not-checked)).
5. `.won` files read directly by WM.
