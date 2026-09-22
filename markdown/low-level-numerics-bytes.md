# Low-level numerics and bytes through the SML basis model

## Purpose

Workman's first low-level facilities should not be a second foreign-runtime object model layered on
top of JavaScript. They should extend the small SML-shaped basis already used by the compiler with:

1. exact fixed-width signed integers and unsigned words;
2. compact immutable and mutable byte sequences;
3. zero-copy slices over those sequences; and
4. endian-specific packing operations.

These facilities serve C ABI values, game-engine buffers, and binary asset parsing, but none of
those clients owns their semantics. The semantic model comes from Standard ML; the JavaScript
backend supplies efficient representations.

This document is a design proposal, not an assertion that the described interface is implemented.

## Sources and evidence

Primary sources:

- the local Revised Definition, especially `research/The-Definition-of-Standard-ML-Revised/`
  `syncor.tex`, `statcor.tex`, `overloading.tex`, and Appendices C and D;
- the Standard ML Basis Library `INTEGER` and `WORD` signatures;
- `Word8Vector`, `Word8Array`, `Word8VectorSlice`, and `Word8ArraySlice`;
- `Byte`, `PACK_WORD`, `PACK_REAL`, and `BinIO`.

Repository evidence:

- `research/workmangr` uses Grain's host `Bytes`, `Uint8`, and `Int64` modules in its lexer and LSP.
  This demonstrates useful operations and workloads, but Grain owns those semantics; it is not a
  Workman implementation to port wholesale.
- `research/workman-old` contains useful native-memory and pointer experiments, but its canonical
  `Byte`, `Bytes`, and fixed-width numeric descriptions were mostly plans rather than a complete,
  exercised implementation.
- `wmthree/sotcexperiment/pipeline/binary_view.ts` exists mainly to create byte views, slice files,
  and decode scalar fields and strings. Its format interpretation already belongs to Workman.
- `wmthree/sotcexperiment/pipeline/nto_decode.ts` and `tools/ts/ambience_synth.ts` show the mutation,
  word operations, and compact-buffer workloads that the new basis should eventually absorb.

## Definition versus Basis Library

The Revised Definition gives `int`, `real`, and `word` language-level identity, literal classes,
and overloaded primitive operators. It deliberately leaves most operations and additional
precisions to the separately specified Basis Library.

The same division fits Workman:

- exact primitive type identity, literal interpretation, equality, and runtime representation are
  kernel-basis facts;
- arithmetic, logical operations, conversions, arrays, vectors, slices, and packing operations are
  qualified basis-structure members;
- convenient higher-level binary readers can be ordinary Workman source built over that basis;
- C reflection maps ABI types to the same exact types rather than creating C-only numeric types.

This continues the architecture in `markdown/module-update26.7/sml-basis.md`. A type is not made a
JavaScript FFI type merely because its current runtime representation uses a JavaScript number,
bigint, or typed array.

## 1. Numeric model

### Preserve `Number`

`Number` remains Workman's convenient JS-oriented numeric type. Existing integer and real literals
continue to default to `Number`, and existing arithmetic remains unchanged. Exact integers are
added for representation-sensitive work; they do not silently change ordinary application code.

### Unsigned values follow SML `WORD`

Unsigned fixed-width types have modular arithmetic and logical operations. For width `N`:

- values range from `0` through `2^N - 1`;
- addition, subtraction, multiplication, negation, and conversion from larger integral values keep
  the low `N` bits;
- logical left and right shifts fill with zero;
- shifting by at least the width produces zero;
- arithmetic right shift preserves the high bit, matching SML `~>>`;
- word arithmetic does not raise an overflow error merely because high bits are discarded.

The initial useful structures are:

```text
Word8
Word16
Word32
Word64
SysWord
```

Each implements the relevant subset of SML's `WORD` interface:

```text
wordSize
fromNumber       -- explicit conversion from current Workman Number
toNumber         -- checked; fails when Number cannot represent the value exactly
fromLarge / toLarge / toLargeX
andb / orb / xorb / notb
shiftLeft / shiftRight / shiftRightArithmetic
add / sub / mul / div / mod
compare / min / max
```

The source spelling need not adopt SML symbolic word operators immediately. Named members allow
the representation and conversion semantics to land before general overloaded-operator solving.
Later, SML word literals (`0w5`, `0wxFF`) and operator overloading can elaborate to the same semantic
members rather than creating another numeric implementation.

### Signed values follow SML `INTEGER`

Signed fixed-width types use two's-complement representation, but ordinary signed arithmetic is
checked rather than modular. This follows the Basis `INTEGER` contract:

- an unrepresentable arithmetic result is an overflow failure;
- `div`/`mod` and `quot`/`rem` remain distinct where Workman exposes both;
- conversion from a wider integer is checked;
- bit reinterpretation is explicit and distinct from numeric conversion.

Initial structures:

```text
Int8
Int16
Int32
Int64
Position
```

`Position` is the exact integral type used for file positions. It must not collapse to `Number` on
a 64-bit host.

Workman currently has no recoverable SML exception mechanism. Therefore operations which SML says
raise `Overflow` or `Div` need one consistent Workman adaptation. The preferred first API is:

```text
Int32.add        : (Int32, Int32) -> Result<Int32, IntError>
Int32.wrappingAdd: (Int32, Int32) -> Int32
Int32.fromNumber : Number -> Result<Int32, IntError>
```

Unsigned `WordN.add` remains direct and modular. This distinction is more important than matching
the exact SML surface spelling.

### C names are aliases, not another numeric family

The C FFI can present convenient aliases where a header demands them:

```text
U8     = Word8.word
U16    = Word16.word
U32    = Word32.word
U64    = Word64.word
I8     = Int8.int
I16    = Int16.int
I32    = Int32.int
I64    = Int64.int
Usize  = SysWord.word
Isize  = Position.int or a target-sized signed basis type
```

These aliases must share semantic type identity with the basis types. A `uint32_t` returned from C
must be directly usable by `Word32.andb`; no conversion through `Number` or a C-private wrapper is
required.

### JavaScript representation

A practical first backend representation is:

| Type | JavaScript representation |
| --- | --- |
| `Word8`, `Word16`, `Word32` | unboxed `number`, normalized at producing operations |
| `Int8`, `Int16`, `Int32` | unboxed `number`, normalized and range-checked at producing operations |
| `Word64`, `Int64`, `SysWord`, `Position` on a 64-bit target | `bigint` |

Static Workman types, not runtime tags, distinguish the unboxed 32-bit values. Every primitive
producer must preserve the invariant; arbitrary JavaScript numbers cannot be asserted into these
types without a checked conversion.

Using `bigint` for exact 64-bit values removes the existing pointer-shaped workaround for
`ssize_t`, `size_t`, file positions, and similar Deno FFI results.

## 2. Byte sequences

### Start with the monomorphic immutable vector

The SML Basis model distinguishes the important semantic axes:

```text
Word8Vector.vector       immutable compact byte sequence
Word8Array.array         mutable compact byte sequence
Word8VectorSlice.slice   immutable shared view
Word8ArraySlice.slice    mutable shared view
```

That remains the right compatibility model, but Workman does not need to expose both halves in the
first implementation. Start with `Word8Vector` and `Word8VectorSlice`. In particular:

- immutable vectors can be shared freely by pure Workman code;
- mutable arrays, if added later for Basis compatibility, have identity equality and explicit
  update operations;
- slices describe `(base, start, length)` without allocating or copying;
- freezing an array into a vector is an explicit operation with documented copy/transfer behavior;
- endian interpretation stays separate from storage.

Workman may initially provide these ergonomic aliases:

```text
Bytes     = Word8Vector.vector
ByteSlice = Word8VectorSlice.slice
```

The aliases must not introduce additional runtime representations.

### Minimum vector interface

```text
Word8Vector.empty    : Word8Vector
Word8Vector.fromList : List<Word8> -> Word8Vector
Word8Vector.length   : Word8Vector -> Number
Word8Vector.sub      : (Word8Vector, Number) -> Word8
Word8Vector.get      : (Word8Vector, Number) -> Option<Word8>
Word8Vector.update   : (Word8Vector, Number, Word8) -> Word8Vector
Word8Vector.concat   : List<Word8Vector> -> Word8Vector
```

`update` returns a new vector as in SML. It is not the primitive used for bulk construction.

### Deferred Basis array interface

```text
Word8Array.array     : (Number, Word8) -> Word8Array
Word8Array.fromList  : List<Word8> -> Word8Array
Word8Array.length    : Word8Array -> Number
Word8Array.sub       : (Word8Array, Number) -> Word8
Word8Array.get       : (Word8Array, Number) -> Option<Word8>
Word8Array.update    : (Word8Array, Number, Word8) -> Void
Word8Array.vector    : Word8Array -> Word8Vector
Word8Array.copy      : (Word8ArraySlice, Word8Array, Number) -> Result<Void, BoundsError>
Word8Array.copyVec   : (Word8VectorSlice, Word8Array, Number) -> Result<Void, BoundsError>
```

This interface is useful for eventual SML Basis compatibility, but the engine and asset pipeline do
not require it as their ordinary byte representation. Mutation needed solely to construct a fresh
vector can remain hidden in pure bulk operations. Mutation performed by C belongs in a separate
unsafe native-buffer facility. Neither case requires adding SML `ref`, `!`, or `:=` syntax.

### Bounds behavior

SML's `sub`, `update`, and slice constructors raise `Subscript`. Workman does not currently have a
recoverable exception corresponding to it.

The initial compromise is:

- SML-shaped `sub`/`update` are partial and panic on a violated programmer precondition;
- `get` returns `Option` for ordinary probing;
- range operations such as `slice` and `copy` have total `Result` variants;
- binary parsers validate a range once, then use direct `sub`/pack operations inside that range.

This avoids allocating a `Result` for every byte in a texture or audio loop while still offering a
total API at untrusted input boundaries. If Workman later implements recoverable SML exceptions,
the partial operations can acquire the precise `Subscript` behavior without changing the storage
model.

### Runtime representation and immutability

The JavaScript backend should use `Uint8Array` storage internally:

- a future `Word8Array` directly owns a mutable `Uint8Array`;
- a future `Word8ArraySlice` owns a base reference plus offset and length;
- `Word8Vector` uses a compiler-owned wrapper around byte storage which exposes no mutating
  operation;
- `Word8VectorSlice` shares immutable storage with its vector;
- array-to-vector conversion copies in the first implementation, preserving immutability;
- vector-to-array conversion copies;
- foreign JavaScript boundaries cannot recover the internal mutable `Uint8Array` of a vector
  without an explicitly unsafe operation.

A JavaScript `Uint8Array` imported through `js.*` remains a foreign JS value. It is not implicitly a
`Word8Array`, because that would let arbitrary foreign aliases violate the basis invariants.
Explicit copy and unsafe borrow operations can be added at the boundary.

## 3. Packing and endian access

Do not put endianness in the byte-sequence type. Follow SML's `PACK_WORD` organization:

```text
PackWord16Little
PackWord16Big
PackWord32Little
PackWord32Big
PackWord64Little
PackWord64Big
```

Each structure reports `bytesPerElem` and `isBigEndian`, reads from vectors or arrays, and updates
arrays. The SML-compatible members use element indices:

```text
PackWord32Little.subVec(vec, i)   -- starts at byte 4 * i
PackWord32Little.subArr(arr, i)
PackWord32Little.update(arr, i, value)
```

Workman's asset formats frequently use byte offsets which are not naturally expressed as element
indices. A small ordinary Workman `Binary` module can layer byte-offset operations over the pack
structures:

```text
Binary.u16le : (Word8VectorSlice, Number) -> Result<Word16, BinaryError>
Binary.u32le : (Word8VectorSlice, Number) -> Result<Word32, BinaryError>
Binary.i16le : (Word8VectorSlice, Number) -> Result<Int16, BinaryError>
Binary.f32le : (Word8VectorSlice, Number) -> Result<Float32, BinaryError>
Binary.asciiZ: (Word8VectorSlice, Number) -> Result<String, BinaryError>
```

`Binary` owns bounds diagnostics and format-friendly byte offsets. `PackWord*` owns primitive,
allocation-free endian conversion. Keeping these layers separate preserves Basis compatibility
without forcing asset parsers to perform index division.

`PACK_REAL`-shaped `PackReal32*` and `PackReal64*` follow after exact float types are available.

## 4. I/O and C interop

The first file operation can be a narrow Workman extension:

```text
Bytes.readFile : String -> Task<Word8Vector, IoError>
```

The eventual SML-shaped home is `BinIO`, whose element is `Word8.word` and whose vector is
`Word8Vector.vector`. Streaming and seekable input should use exact `Position`, not `Number`.

C interop rules:

- `Word8Array` may be borrowed as an input/output C buffer while the call is active;
- a `Word8ArraySlice` passes its starting address and explicit length;
- `Word8Vector` may be borrowed as const input, but never as mutable output;
- asynchronous/nonblocking native calls must retain the owner until completion;
- obtaining a storable raw pointer is an explicitly unsafe operation and does not extend the
  lifetime of the owner;
- a C-returned pointer is not silently a byte vector: its length and ownership are absent.

These rules let the C emitter recognize basis byte types directly instead of converting through
`Js.Array`, `ArrayBuffer`, or handwritten `DataView` code.

## 5. What wmthree actually needs

The existing engine and SOTC experiments contain substantial JavaScript mutation, but most of it
does not require general language-level references or mutable arrays:

| Workload | Current mutation | Immutable-facing design |
| --- | --- | --- |
| NTO texture decode and RGBA expansion | Write each result byte once | `Word8Vector.tabulate`, `mapi`, or a pure decoder operation |
| Procedural textures and capture row flips | Fill a fresh pixel buffer | Pure raster generation backed by hidden fresh-buffer mutation |
| NMO packet parsing | Push variable numbers of vertices and indices | `unfold`, `mapAccum`, chunk vectors, then one `concat` |
| GLB assembly | Append and pad binary chunks | Immutable byte chunks plus `Word8Vector.concat` |
| ISO/XFF scanning | Reuse a read buffer and retain a three-byte carry | Immutable `BinIO` chunks with an explicitly threaded tail slice |
| Ambience synthesis | Mutate filter state and fill each audio block | Thread an immutable `SynthState` through `unfoldN`/`mapAccum` |
| SDL structs and events | C writes through caller-owned pointers | Explicit `C.Out`/`Native.Buffer` at the unsafe boundary |
| Three, Rapier, Havok, and WebGPU objects | Mutate opaque library objects | Keep mutation inside foreign handles and expose intentional operations |

An immutable API must not imply repeated copy-on-update. `tabulate`, `unfoldN`, `mapAccum`, decoding,
and `concat` may fill a fresh mutable allocation internally, provided it cannot escape before being
frozen. This gives ordinary Workman code value semantics without making asset conversion quadratic.

`tabulate` alone is insufficient for audio and some stream parsers because each output depends on
the preceding state. The vector family should therefore eventually include an operation resembling:

```sml
val unfoldN : int * 'state * ('state -> 'elem * 'state)
              -> 'elem vector * 'state
```

The state is still an ordinary immutable value. Variable-length decoders can use chunk vectors,
two-pass sizing, or a runtime-owned collector exposed only through a pure operation.

SDL is genuinely different. Functions such as `SDL_PollEvent`, `SDL_GetVersion`, and
`SDL_GetWindowWMInfo` write into supplied storage. That storage should be an explicitly unsafe
native buffer or typed out-parameter, not a reason to make ordinary `Word8Vector` mutable. A wrapper
can reuse the foreign buffer and decode or freeze each result into an immutable Workman value.

Consequently, neither `ref` nor public `Word8Array` is a prerequisite for wmthree. They can be
considered later for SML compatibility independently of the low-level byte and FFI design.

## 6. Implementation slices

### Slice A: exact words without operator overloading

1. Add kernel type identities for `Word8`, `Word16`, `Word32`, and `Word64`.
2. Add compiler-owned `WordN` structure members for construction, conversion, logical operations,
   shifts, and modular arithmetic.
3. Emit 8/16/32-bit operations over normalized JS numbers and 64-bit operations over bigint.
4. Map reflected C unsigned integers to these types.
5. Add runtime and inference tests, especially shifts at and beyond the word width.

Acceptance: the PSMT4 nibble-order and PSMT8 offset arithmetic from `nto_decode.ts` can be written
as pure scalar Workman functions without JavaScript bitwise calls.

### Slice B: exact signed integers

1. Add `Int8`, `Int16`, `Int32`, and `Int64` identities and checked constructors.
2. Define `IntError = Overflow | DivisionByZero | InexactNumber` in the source standard library.
3. Add checked arithmetic and explicit wrapping/bit-reinterpretation operations.
4. Map C signed integers, `isize`, and `ssize_t` without pointer-shaped workarounds.

Acceptance: the `writev` example represents its return value as an exact signed integer and removes
the `PointerObject`/`BigInt.asIntN` reinterpretation path.

### Slice C: `Word8Vector`, slices, and bulk generation

1. Add opaque kernel identities and runtime intrinsics for vector creation, length, subscript,
   slicing, and concatenation.
2. Add `Word8VectorSlice` as a shared `(base, offset, length)` view.
3. Add `tabulate`, `mapi`, and a state-threading bulk operation such as `unfoldN` or `mapAccum`.
4. Add explicit UTF-8/ASCII conversion helpers; do not claim SML's extended-ASCII `String`
   representation if Workman strings remain JavaScript Unicode strings.
5. Integrate `Deno.readFile` results through an explicit trusted host adapter initially, then a
   `Bytes.readFile`/`BinIO` member.

Acceptance: `nto_summary.wm` opens a file and reads its header without importing `DataView` or
`binary_view.ts`.

### Slice D: packing and foreign output storage

1. Add immutable `PackWord16/32/64Little` and `Big` reads and vector-producing encoders.
2. Implement the ordinary source-level `Binary` convenience module.
3. Add an explicit `C.Out`/`Native.Buffer` abstraction for caller-owned storage foreign code may
   mutate, with call-scoped keepalive and explicit decode/freeze operations.
4. Teach the C emitter to borrow immutable vector/slice storage as const input.

Acceptance: Workman performs the PSMT4/PSMT8 index decode into a compact immutable vector, while SDL
out-parameters use visibly foreign mutable storage without constructing `JSON[]` byte lists.

### Slice E: source syntax and overloading

Only after the concrete structures are exercised:

1. decide whether to add SML `0w`/`0wx` literals;
2. extend the kernel's fixed operator catalog with SML-style numeric overloading classes;
3. default ordinary integer literals exactly as today unless word context resolves them;
4. preserve one selected type throughout an overloaded operator occurrence;
5. reject out-of-range literals after resolution.

The Revised Definition explicitly leaves formal overloading machinery outside its main static
semantics and specifies the admissible classes and default types separately. Workman should likewise
make overloading a contained elaboration mechanism, not weaken HM unification or turn annotations
into casts.

## Non-goals of the first implementation

- no general mutable reference syntax;
- no public mutable `Word8Array` in the initial slice;
- no arbitrary typed-array family;
- no implicit `Number`/word/integer coercions;
- no list-backed byte representation;
- no endian phantom type threaded through every operation;
- no automatic pointer-to-vector conversion;
- no claim that Workman `String` is an SML 8-bit character vector;
- no complete Standard ML Basis Library conformance claim;
- no requirement to implement signatures or functors before these selected basis structures.

## Decisions still required before code

1. **Surface type spelling:** expose `Word8` directly as a type, or use a qualified member such as
   `Word8.Word` while reserving `Word8` for the structure. The semantic identity is the same either
   way.
2. **Checked signed arithmetic shape:** `Result` as proposed, panic to approximate SML exceptions,
   or both a partial SML-shaped member and a total Workman member.
3. **Length/index type:** retain `Number` for Basis compatibility with current Workman collections,
   or use `Usize` at the low-level layer and convert at the collection boundary.
4. **Naming aliases:** whether `Bytes` is a public alias or merely an explanatory name for
   `Word8Vector`; mutable aliases wait until a Basis array is actually added.
5. **Float timing:** whether `Float32`/`Float64` land with signed integers or wait until
   `PackReal*` and C float fidelity demand them.

These are local interface decisions. They do not change the underlying SML-derived split between
words, integers, monomorphic vectors, monomorphic arrays, slices, and endian pack structures.
