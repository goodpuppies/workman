# A reflected function returning a bare DataView reports "unknown JS import"

Status: open. Found 2026-11-08; the same on 0.6.0. 28 entry points in wmthree stop here.

## Reproduction

```ts
// a.ts
export function view(): DataView { return new DataView(new ArrayBuffer(1)); }
```

```wm
from js.module("./a.ts") import { view };
```

The import fails with `unknown JS import .../a.ts.view`. A function in the same file returning
`number` imports fine.

## Cause

TypeScript's `DataView` is generic with a default, so a bare `DataView` is
`DataView<ArrayBufferLike>`. `typeExprFromTsType` (`src/ffi/reflect/type_mapping.ts`) maps each type
argument; `ArrayBufferLike` is a union of objects, which gives `undefined` in result position, so
the whole result type is `undefined` and the import is reported as unknown.

Related: `buffer-from-loses-concrete-backing-type.md` and
`buffer-subarray-loses-concrete-backing-type.md`.

## To decide

- What a bare `DataView` should reflect to: `DataView<Js.Value>`, or a backing type chosen another
  way. Other generic globals with `ArrayBufferLike` defaults presumably behave the same.
- The message should name the type it could not map rather than say the import is unknown.
