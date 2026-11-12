# A method returning an array of a default-exported class fails with "unknown type …:element"

Status: open. Reproduced 2026-11-12 at 1a969af (before and after the dictionary/property-identity
reflection changes), while porting bskygraph's vector-tile decoding to WM.

## Reproduction

Two installed packages; `shape-lib`'s declarations import a default-exported class from `point-lib`:

```ts
// node_modules/point-lib/index.d.ts
declare class Point { x: number; y: number; }
export default Point;

// node_modules/shape-lib/index.d.ts
import Point from "point-lib";
export declare class Shape { points(): Point[]; }
```

```wm
from js.module("shape-lib") import type { Shape };
let first = (shape: Shape) => shape.points()
  :> Result.map(Js.Array.toList)
  :> Result.map(match { [point, .._] => Some(point), [] => None });
```

`checkSource` (and `wm check`) fail with `unknown type points():return:element`.

Expected: `Shape -> Result<Option<Point>, Js.Error>`, with `Point` keeping its module identity.

## Notes

- `rings(): Point[][]` (the shape `@mapbox/vector-tile`'s `loadGeometry` returns) works; the
  nested array goes through `nestedForeignTypeRefs` instead of the single-level element ref in
  `src/ffi/reflect/types.ts` (`elementKey = \`${key}:element\``).
- The element ref's key, not the element's nominal identity, appears to reach inference as a type
  name. `tests/ffi_dictionary_reflection_test.ts` covers the working `Point[][]` shape.
