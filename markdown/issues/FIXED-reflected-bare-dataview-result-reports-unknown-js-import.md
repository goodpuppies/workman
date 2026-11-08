# A reflected function returning a bare DataView reports "unknown JS import"

Status: fixed 2026-11-08. Found the same day; the same on 0.6.0. It stopped bigger-fish's `play.wm` and 28 entry points in an older wmthree copy.

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

## Fix

`2da3555` (2026-10-30) started preserving generic classes through FFI, which caused three problems:

- A default argument with no WM type made the whole type unmappable. It now maps to `Js.Value`.
- A parameter written without arguments no longer accepted subclasses, where a non-generic class
  parameter does. A generic parameter using only its defaults is `Js.Value` again.
- A generic named only by a parameter was declared with arity 0. Its arity is now declared.
