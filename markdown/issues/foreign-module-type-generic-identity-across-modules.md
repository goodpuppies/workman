# Module-declared type arguments lose identity across Workman modules

Status: open. Reproduced 2026-11-05 on 0.6.0 plus the working-tree fix for global type arguments.

The same bug as `FIXED-foreign-arraybuffer-generic-identity-across-modules.md`, for types declared in a JS or TS module rather than globally. That fix only covers global types.

## Reproduction

`lib.ts`:

```ts
export class Inner { n = 1; }
export class Box<T> { constructor(public value: T) {} }
export const innerBox = () => new Box(new Inner());
```

`m/holder.wm`:

```wm
from js.module("../lib.ts") import type { Box, Inner };
record Holder = { box: Box<Inner> };
```

`m/main.wm`:

```wm
from "./holder.wm" import { Holder };
from js.module("../lib.ts") import unsafe { innerBox };
let main = () => { let h = Holder(innerBox()); print(h.box :> .value :> Result.debug :> .n :> Result.debug); };
```

`wm run m/main.wm` fails with `type.mismatch`.

## Cause

`Inner` gets two foreign keys:

- The import uses `module-type:<specifier>.Inner` (`jsModuleTypeRef` in `src/ffi/reflect/types.ts`).
- The nested type argument uses `nominal-type:import("<path>").Inner` (`nestedForeignTypeRefs` in `src/ffi/reflect/type_mapping.ts`).

The specifier form is written relative to the importing file, and the nested form comes from TypeScript's module name, so the fix needs one key derived from the resolved declaration.

## Also open

Delayed FFI mismatch diagnostics don't show the origin of each foreign type, so two different types with the same display name produce a message that names the same type on both sides.
