# C FFI: surface syntax

The JS FFI reads `from js.global("Math") import { max, floor }`. C imports
follow the same shape. This replaces workman-old's bare
`from "winapi.h" import { ... }`, which put C on a different grammar path with
no target namespace.

## Forms

### Reflected: `c.header`

Header is the source of truth. The embedded Zig extractor produces types for
the imported symbols; at runtime symbols resolve from the loadable library.

```wm
from c.header("raylib.h", lib: "raylib") import unsafe {
  InitWindow,
  CloseWindow,
};
```

`lib` names the `.so` passed to `Deno.dlopen`. It is optional:

- **Derived from the header stem**: `c.header("dir/vec3.h")` with no `lib:`
  searches `dir/libvec3.so`, `dir/vec3.so` (then `.dylib`/`.dll`), then the
  same names without a directory (OS search path). If nothing is found and the
  import declares fn symbols, compilation fails with `c-ffi.missing-library`
  listing every candidate tried.
- **System headers** (bare names like `"stdio.h"`) fall back to `libc.so.6`:
  ```wm
  from c.header("stdio.h") import unsafe { printf };
  ```
- **No library needed** for imports that use only types and constants —
  constants materialize at compile time and no `dlopen` is emitted:
  ```wm
  from c.header("vec3.h") import type { Vector3 };
  from c.header("vec3.h") import unsafe { V2_LIMIT };
  ```

Deno's `dlopen` does *not* append `.so`/`.dylib`/`.dll` itself (verified on
Deno 2.9), so the derived candidates above carry the platform suffix.

`lib: "self"` (or omitting `lib` while declaring `headerOnly`) is a later
extension for symbols that live in the program's own compiled code — not in v1.

### Manual: `c.lib`

Direct dlopen of a system library with hand-written signatures — the exact
parallel of JS manual typed imports. Trusted boundary declaration, no
reflection:

```wm
from c.lib("libc") import unsafe {
  printf: (Ptr<Char>) -> I32,
  malloc: Usize -> Ptr<Void>,
};
```

Manual signatures may quantify lowercase type variables, mirroring
`docs/jsffi.md`.

### Type-only imports

Same as JS: nominal foreign types for C structs/enums/typedefs:

```wm
from c.header("raylib.h") import type { Vector3, Shader };
```

Type-only imports still drive extractor symbol collection (the struct layout
must be extracted to give the nominal type its size, even when no field is
accessed yet).

### unsafe is required

Every C **value** import must carry `unsafe`. No safe-by-default, unlike JS.

The two FFIs differ in what can go wrong, and the syntax states it:

- JS: calls can **throw** — a catchable error channel exists, so the safe
  form wraps it in `Result<T, Js.Error>` and `unsafe` opts out.
- C: calls can **kill the process** (segfault) — there is no catchable error
  channel, so there is nothing a safe form could wrap. A `Result` would
  fabricate a channel the ABI does not have. What C guarantees is that any
  call can misbehave at the process level, and `unsafe` is the honest marker
  of exactly that.

```wm
from c.header("raylib.h", lib: "raylib") import unsafe { InitWindow, CloseWindow };
from c.lib("libc") import unsafe { printf: (Ptr<Char>) -> I32 };
```

- Missing `unsafe` on a C value import is a syntax-level diagnostic with a
  hint ("C calls are process-unsafe; add unsafe").
- Error codes stay ordinary values: if an API returns status codes, match on
  them like any other value. errno-style `Result` helpers belong in a std
  module, not the compiler.
- `Deno.dlopen` load failures, symbol resolution failures, and codec/layout
  mismatches are registration-time/programmer errors → panic (same channel as
  a failed `js.global` reflection), not values in normal types.
- **Type-only imports do not need `unsafe`** — no runtime crossing occurs:

```wm
from c.header("raylib.h") import type { Vector3, Shader };
```

## V2 direction: blast-radius tracking

V1's mandatory `unsafe` is the seed for call-graph infection tracking: if
`main` calls `x`, `x` calls `y`, `y` calls `printf` (imported unsafe), then
`main`, `x`, and `y` are themselves unsafe — the effect propagates through
the call graph and surfaces in signatures, so "which parts of my program can
blow up the process" is a type-level answer. That is workman-old's infection
machinery applied where it has genuine value. Deferred to v2; the v1 shape
(required keyword at the boundary) is chosen so the infection rule has an
exact place to plug in: today the boundary is "imported unsafe," and v2
generalizes it to "calls an unsafe fn."

Not designed in v1: signatures, storage, diagnostics.

## Renaming

`as` renames, as everywhere else (value imports still need `unsafe`):

```wm
from c.header("stdio.h") import unsafe { printf as c_printf };
```

## Non-goals (v1)

- No `@raw` directive. Unsafe pointer ops live in `std/unsafe` (see
  type-mapping.md), not in a source-file mode.
- No `zigImport` (that was workman-old's `.zig` native path).
- No build.wm / zig build integration.
- No function-pointer imports (hard error with a clear diagnostic; see
  type-mapping.md).
