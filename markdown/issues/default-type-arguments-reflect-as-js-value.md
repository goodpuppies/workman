# Default type arguments without a WM type reflect as Js.Value

Status: open. Follows `FIXED-reflected-bare-dataview-result-reports-unknown-js-import.md`.

A bare generic such as three's `Mesh` is `Mesh<BufferGeometry, Material | Material[], Object3DEventMap>`
in TypeScript. WM has no union type for `Material | Material[]`, so that slot reflects as `Js.Value`,
giving `Mesh<Js.Value, Js.Value, Js.Value>` once the other arguments are erased too. The same goes
for `DataView`'s `ArrayBufferLike`. It type-checks, but the slot says nothing and two different
instantiations look alike.

## Direction

Reflect such an argument as an opaque foreign type identified by its TypeScript text, the way
`opaqueTupleAliasTypeName` keeps tuple aliases opaque. The instantiation then survives a round trip
through WM, and reflected calls can rebuild the real TypeScript type from it.

`75e12e8` records why applying the declared default as a WM type doesn't work on its own: HM can't
accept `Buffer<ArrayBuffer>` where `Buffer<ArrayBufferLike>` is expected. An opaque default has the
same problem, so a value of a concrete instantiation must still reach a parameter written with the
defaults. Parameters using only their defaults are `Js.Value` for that reason.
