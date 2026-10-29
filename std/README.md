# std

Workman's own library: what the SubsetML Basis in [`../subml-basis/`](../subml-basis/) doesn't
provide. That includes the carriers, `Task`, `Map` and the binary decoding in `binary.wm`, and the
modules that need host types SubsetML doesn't have yet: the words (`Word8`–`Word64`), vectors,
`Pack*`, `Float32`/`Float64`, `Real` and `Math`. Portable modules can later move into the SubsetML
Basis. See [`../markdown/subsetml-basis.md`](../markdown/subsetml-basis.md).

The SubsetML Basis is the primary portable API. Duplicate implementations still
present here are transitional and will be removed later as callers migrate;
their differing signatures or error types do not define a second portable Basis.
Default pervasives should project the shared Basis where it provides the operation.

Every top-level `.wm` file here is a library module, discovered automatically by
`scripts/generate_assets.ts`. Its namespace comes from its snake_case file name, so
`word8_vector.wm` defines `Word8Vector`. After adding or changing a file, run
`deno task generate-assets`.

A module's JavaScript primitives live in `js/` and are imported with a relative specifier and
manual types, as `word8_vector.wm` does:

```wm
from js.module("./js/byte_vector.js") import unsafe {
  length as primLength: Word8Vector.Vector -> Number,
};
```

`unsafe` imports compile to direct calls. The files are embedded in the compiler and inlined into
emitted programs once each, so they never need to be on disk next to user code. An inlined file
can't import another file, so primitives that share a representation share a file
(`byte_vector.js` serves `Word8Vector`, `Word8VectorSlice`, `Pack*` and `Byte`). Several modules
importing one file is fine. A primitive file works on
plain JavaScript values. Conversions to `List` and `Option`, and `Result` wrapping, belong in the
`.wm` module.

The JavaScript host helper modules live in [`../host/js/`](../host/js/), also with the same rules,
but are never opened implicitly: programs import them with `from js.host("table")` (BD17).

A library module names `Js.*` only in the signatures of its primitive imports, never in its function
bodies, so porting to another target means replacing the primitive imports and nothing else. A
conformance test checks this.

Primitive signatures should avoid `Option` and callback parameters on hot paths. `Option` in an
`unsafe` signature is still converted to and from nullable values, and a callback parameter gets an
FFI adapter on every call. `host/js/table.wm` shows the pattern: return the raw value and test it
with a second primitive.
