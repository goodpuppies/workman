# Issue: Safe JS Imports Accept a Manual Type

Status: fixed 2026-10-07 (`rejectSafeManualType` in `src/ffi/imports.ts`)

Recorded on 2026-10-07 while checking the JS FFI docs against the compiler.

## The rule

A manual type on a JS import is a trusted claim about the JavaScript side that Workman cannot
check, so it requires `unsafe`. The valid forms are:

| form | meaning |
|---|---|
| `import { f }` | safe, reflected: result wrapped in `Result`/`Task` with `Js.Error` |
| `import unsafe { f }` | unsafe, reflected: direct call |
| `import unsafe { f: A -> B }` | unsafe, manual type: direct call at the declared type |
| `import { f: A -> B }` | **invalid**: a safe import cannot rest on an unchecked claim |

## Behavior before the fix

The compiler accepted the invalid form and wrapped the declared result in `Result<_, Js.Error>`,
or kept it as written when it already was a `Result` or `Task` (`fallibleValueType` in
`src/ffi/shared.ts`; `jsFallibleMode` in `src/core/emit_js_import.ts`). Until 2026-10-07 the docs
described this as a feature ("safe manual imports"); `docs/jsffi.md`, `docs/js-errors.md`,
`docs/async.md` and `docs/wm-minisyntaxguide.md` now state the rule instead.

Because the claim is unchecked, the form can silently lie:

```workman
-- Accepted. At runtime a failure is a Js.Error, not a String.
from js.global("Promise") import { resolve as lie: Number -> Task<Number, String> };

-- Accepted. Promise.resolve returns a promise, so this is Ok(<promise object>), not Ok(1).
from js.global("Promise") import { resolve as wrong: Number -> Number };
```

## Expected behavior

`import { f: A -> B }` without `unsafe` is a compile error that says to either drop the type
(reflection) or add `unsafe`.

## Fix

`rejectSafeManualType` in `src/ffi/imports.ts` rejects a typed spec in a safe JS import:

```text
a safe JS import can't declare a type for parse: drop the type to use reflection
(import { parse }), or make the import unsafe to trust the declared type (import unsafe { parse: ... })
```

C imports (`c.lib`) declare their types by design and are unaffected.

Migrated with the fix: pakman, testman, `tooling/problems` (which now imports
`nextSnapshotData` from `src/problems_client.ts`, a plain-data version of `nextSnapshot`),
`tooling/tuiman`, and the compiler tests that used the form (rewritten to reflection or `unsafe`,
or, for the tests of the old behavior, to expect the new error).

Still using the invalid form, to be migrated separately: `examples/` (`enterprise/writev.wm`,
`github_repos.wm`, `node-gotchi.wm`, `portscan.wm`, `weather.wm`) and projects outside wm-mini.

## Related points still open

- **`Task` in an unsafe manual type is never honest for a plain JS promise.** An unsafe import is
  a direct call, so the declared `Task` would be the raw promise, which resolves to the value
  rather than to a `Result`. Consider rejecting `Task` (and `Result`) as the declared result of an
  unsafe manual import, except for representation-level primitives like `std/js/task.js`, which
  use free type variables instead.
- **`Js.Promise` is half-supported.** `isManualFfiBuiltinType` in `src/ffi/imports.ts` lists it,
  but a manual type mentioning it fails with "unknown type Js.Promise". With the rule above, a raw
  promise type would be the honest unsafe declaration of a promise-returning function, so it may
  be worth making real.
- **Reflection gaps matter more under this rule,** since a safe import can no longer fall back to
  a manual type. Values that are members of a namespace object are not found: `Math.PI`,
  `Deno.pid`, `Deno.args`, `Deno.build.os` all fail with "unknown JS import" (root globals like
  `navigator` work). See also `global-type-reflection-misses-active-deno-declarations.md`.

## Focused regression coverage

- `import { f: A -> B }` is rejected with a diagnostic naming both fixes.
- `import { f }`, `import unsafe { f }` and `import unsafe { f: A -> B }` still work.
- Type-only imports (`import type { Request }`) are unaffected.
