# Issue: deeply reflect structural object-literal FFI property gets

## Status

Immediate breakage fixed in the compiler via a narrow `Js.Object` fallback for **anonymous**
object-literal result types (Proposal B). Named static result types still remain unresolved rather
than being collapsed to an opaque type. General reflection of simple structural property results
through the existing deep-record path (Proposal A) remains open as the preferred longer-term
improvement.

## Summary

A foreign object property whose TypeScript type is an **anonymous inline object literal** could not
previously be reflected as a Workman value. The read resolved to an unresolved FFI obligation and
the compiler reported:

```txt
error: cannot resolve JS FFI property shadowMap on module-type:three/webgpu.WebGPURenderer
```

Concrete trigger: `three/webgpu`'s `WebGPURenderer` inherits `shadowMap` from the base `Renderer`
(`@types/three/src/renderers/common/Renderer.d.ts`), declared as a bare structural type:

```ts
shadowMap: {
  enabled: boolean;
  transmitted: boolean;
  type: ShadowMapType;
};
```

`ShadowMapType` is itself a union of `typeof X` numeric constants
(`BasicShadowMap | PCFShadowMap | PCFSoftShadowMap | VSMShadowMap`).

This is a static, finite, well-typed shape. It is not dynamic, yet because it is an **anonymous
inline object literal** (no nominal identity, cannot be imported as a named foreign type), there is
no honest *named* Workman representation for it other than an opaque object. The pre-commit code
mapped exactly this case to `Js.Object` and produced no error. Whether that fallback is acceptable
here was the immediate question: `ffi-principles.md` #7 and the "Opaque Types Are Not Reflection
Recovery" section forbid using `Js.Object`/`Js.Value` as a recovery type for a static type the
mapper failed to understand, but they sanction `Js.Object` when the declaration is itself
coarse/dynamic — and an anonymous structural literal sits in the gray area between "named static
type" and "genuinely dynamic value". The implemented fix accepts that fallback only for anonymous
object-literal results; it does not restore the former broad fallback for arbitrary object-like
results.

## Reproduction

Workman (`wmthree/src/scripts/play.wm:217`):

```wm
renderer.shadowMap :> threeResult :> enableShadows,
```

`renderer` is a `WebGPURenderer` (imported from `three/webgpu`). The get is discarded, so the value
is never used — but the member access must still resolve before it can escape a top-level binding.

Compiler state at the `resolve delayed FFI` phase:

```txt
?:? FfiGet "FfiGet": ?ffi#363:shadowMap
?ffi#363:shadowMap
  kind: get
  status: unresolved
  receiver: WebGPURenderer
  constraints: Result<'a, Js.Error>
```

## Root cause

`jsRefMember` in `src/ffi/reflect/types.ts` reflects a property get by:

1. calling `jsMemberTypeFromTsType` — returns `undefined` for a non-callable object type;
2. falling back to `typeExprFromTsType(checker, propertyType)` (default `position: "result"`).

For the anonymous object, `typeExprFromTsType` walks every branch and reaches the terminal line:

```ts
return position === "param" ? name("Js.Value") : undefined;
```

`position` is `"result"`, so it returns `undefined`. `jsRefMember` then does
`if (!type) return undefined;` and reports the property as unresolvable.

At delayed resolution (`src/ffi/delayed/delayed_resolve.ts:236-256`), the receiver *does* resolve to
a known foreign ref (`WebGPURenderer`), but `jsRefMember` returned `undefined`, so `member` is
falsy and the code unconditionally throws `cannot resolve JS FFI property shadowMap on …`.

### Why this is principled, not a bug

The `result`-position `undefined` return is correct under the FFI principles: unsupported static
results must remain unresolved rather than being recovered as opaque. The deep-record machinery
needed to map such a shape *does* already exist, but it is currently reserved for specific
situations (notably Deno FFI `dlopen` foreign-object returns) and is only wired into the
**call-result** reflector (`jsRefDeepCall`, `types.ts:355-375`), not the **property-get** path.

Enabling general property gets through deep reflection is closer to "reimplementing TypeScript's
structural object model" and is therefore held back for now, per `ffi-principles.md` #4/#5.

### Note on the anonymous-literal nuance

The objection above is strongest for **named** static types, where a foreign ref preserves nominal
identity that opaque recovery would erase. An anonymous inline object literal has no such identity:
it cannot be named, imported, or asserted back into a foreign type, so there is nothing for
`Js.Object` to "erase" beyond the literal's own fields. For a discarded read like
`renderer.shadowMap` the value is never observed, so a `Js.Object` recovery is harmless. This is the
pragmatic 80/20 reading that the earlier (pre-commit) behavior embodied, and it is a defensible
alternative to leaving the property unresolved.

## Proposal A: eventual deep-record handling for simple property gets

When `jsRefMember` gets `undefined` from the shallow `typeExprFromTsType` for a property get, and the
property type satisfies `isFiniteObjectForDeepReflection` (object-flagged, 1–32 properties, not a
banned global), fall back to `deepTypeExprFromTsType` — the same helper already used for call
results. For `shadowMap` this would synthesize a generated record:

```wm
record __Deep_WebGPURenderer_shadowMap = {
  enabled: Bool;
  transmitted: Bool;
  type: Number
}
```

and the get would resolve to `TName(__Deep_WebGPURenderer_shadowMap)`.

Open sub-questions to resolve before adopting this:

- The deep path is currently scoped to specific situations (Deno FFI). Extending it to arbitrary
  foreign property gets needs a guard so it stays limited to genuinely simple, finite, static
  shapes and never becomes a silent catch-all for dynamic values.
- Field mapping of non-trivial members such as `ShadowMapType` (a union of numeric `typeof`
  constants) must resolve honestly — expected `Number` via the existing union/enum handling, but
  should be verified; if a field maps to `undefined` it is dropped, which narrows the record.
- `materializeReceiverProperty` must emit a getter that produces the record value. The deep-call
  path already does this for record-shaped returns; the get path is less exercised and should be
  confirmed.

This would make simple foreign object-literal properties first-class without an opaque fallback and
without a user shim, while preserving the honest "remain unresolved" behavior for dynamic or
unsupported types.

## Proposal B (alternative): restore the `Js.Object` fallback for anonymous object literals

In `typeExprFromTsType`, the terminal `result`-position line currently returns `undefined`:

```ts
return position === "param" ? name("Js.Value") : undefined;
```

The pre-commit code instead mapped unrecognized object-like result types to `Js.Object`:

```ts
if (position === "result" && isObjectLike(type)) return name("Js.Object");
return name("Js.Value");
```

Because `shadowMap`'s type is anonymous and object-like, restoring that fallback (or a narrower
variant limited to anonymous/finite object literals without a nominal name) would make the property
resolve to `Js.Object` and the program would type-check exactly as it did before commit
`1172a6791359f84bf9d3562329bf0c7120d1578c`. This is the smallest change and matches the earlier
non-erroring behavior.

Caveat: this re-introduces the exact pattern `ffi-principles.md` #7 warns about — an unsupported
static type silently becoming opaque, with the loss of field evidence downstream. It is only
defensible here because the type is anonymous (no nominal identity to lose) and because the value is
typically unused. It should **not** be applied to named static types, where the unresolved behavior
remains correct.

## Decision and remaining work

- **Proposal B was chosen for the immediate fix.** Anonymous inline object-literal results now map
  to `Js.Object`, unblocking ports such as `play.wm` without weakening the unresolved behavior for
  named static result types.
- **Proposal A remains open.** Simple, finite structural property results should eventually be
  reflected as real generated records where the deep-reflection guard and property-get
  materialization can do so honestly. That would preserve field evidence instead of stopping at an
  opaque object boundary.

The typed-TS-shim workaround below remains valid when callers need typed access to the fields, or
when a structural result is outside the narrow fallback and deep reflection is not available.

## Workaround for typed field access

Until the deep path is generalized, code that needs more than an opaque `Js.Object` should use a
small type-checked TypeScript shim that terminates the mismatch at the boundary
(`js-ffi-architecture.md`, "The FFI Is A Semantic Boundary"):

```ts
// src/engine/shadows.ts
import type { WebGPURenderer } from "three/webgpu";

export function enableShadows(renderer: WebGPURenderer): void {
  renderer.shadowMap.enabled = true;
}
```

Imported and called from `play.wm` in place of the bare `renderer.shadowMap` get. If the read is
spurious, dropping the statement is the smallest fix.
