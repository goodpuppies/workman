# Issue: reflect global types against the active Deno declarations

## Status

Open. A narrow compatibility declaration for `Deno.UnsafeWindowSurface.getContext("webgpu")`
currently unblocks the visual wmslang example, but root-global type reflection still does not
consistently see the declaration set supplied by the active Deno executable.

## Summary

Workman should reflect `from js.global import type { ... }` imports against the same ambient
declarations that the active Deno runtime exposes through `deno types`. At present, root-global type
references are created from an empty source string, so they primarily see TypeScript's bundled
libraries. Global-member imports such as `from js.global("Deno") ...` take a different path that
does reference Workman's generated Deno declaration file.

This is a general Workman reflection-source bug. It is distinct from a second, narrower problem in
Deno's declarations: Deno 2.9.2 does not declare the literal-discriminated `"webgpu"` overload on
`Deno.UnsafeWindowSurface`, even though it does declare that overload on `OffscreenCanvas`.

Fixing Workman's source selection should expose precise overloads that are present in `deno types`.
It cannot recover information that Deno's declarations omit, so the `UnsafeWindowSurface`
compatibility overload remains necessary unless Deno adds it upstream.

## Reproduction

The active Deno declarations contain a precise overload for `OffscreenCanvas`:

```ts
interface OffscreenCanvas extends EventTarget {
  getContext(contextId: "webgpu", options?: any): GPUCanvasContext | null;
  getContext(
    contextId: OffscreenRenderingContextId,
    options?: any,
  ): OffscreenRenderingContext | null;
}
```

Workman should therefore preserve the result type in this program:

```wm
from js.global import type { OffscreenCanvas, GPUCanvasContext };

let context = (canvas: OffscreenCanvas) => {
  canvas.getContext("webgpu")
};
```

Expected:

```txt
(OffscreenCanvas) => Result<Option<GPUCanvasContext>, Js.Error>
```

Without the active Deno declarations in the root-global reflection program, the call instead loses
the overload result and can degrade to:

```txt
(OffscreenCanvas) => Result<Option<Js.Object>, Js.Error>
```

`UnsafeWindowSurface` exposes the separate Deno declaration limitation:

```wm
from js.global("Deno") import type { UnsafeWindowSurface };

let context = (surface: UnsafeWindowSurface) => {
  surface.getContext("webgpu")
};
```

Deno 2.9.2 declares only:

```ts
export class UnsafeWindowSurface {
  getContext(
    contextId: OffscreenRenderingContextId,
    options?: any,
  ): OffscreenRenderingContext | null;
}
```

Its honest reflected result is consequently the broad union, not specifically
`GPUCanvasContext | null`.

## Expected behavior

- Every global type reflection program uses the declaration set from the active Deno executable.
- A literal call argument selects a matching literal-discriminated overload when that overload is
  present in those declarations.
- Static result types retain their nominal foreign type evidence rather than silently becoming
  `Js.Object` or `Js.Value`.
- Missing or imprecise upstream declarations remain explicit compatibility concerns; Workman does
  not infer facts that the declaration source does not contain.

## Actual behavior

`jsGlobalTypeRef` in `src/ffi/reflect/types.ts` currently creates a type reference with no source:

```ts
export function jsGlobalTypeRef(name: string): JsTypeRef {
  return typeRefFromSource(`global-type:${name}`, "", name);
}
```

By contrast, the source produced for a member of a global path includes:

```ts
/// <reference path="/__wm_deno_types.d.ts" />
```

The two global-import forms can therefore reflect against different ambient declaration sets.

## Root cause

Workman has two independent pieces of the desired mechanism, but they are not joined for root-global
type imports:

1. `denoTypesSource()` in `src/ffi/reflect/host.ts` loads declarations from the configured Deno
   executable (`WORKMAN_DENO_PATH`, or `deno`).
2. Reflection already retains literal string and number call arguments as `JsCallArgHint` values.
   `jsRefCallTarget` synthesizes literal argument expressions, allowing TypeScript overload
   resolution to select a discriminator-specific signature.

The missing part is making `jsGlobalTypeRef` compile its reference in a source that includes the
active Deno declaration file. The literal-aware call mechanism cannot select an overload that is not
visible in the reflection program.

`Js.Object` is not a substitute for repairing this link. It is a valid opaque boundary when the
foreign declaration is genuinely broad, but it intentionally discards named member and result
information. Workman should not first lose available static evidence and then treat opaque dynamic
access as typed recovery.

## Workman scope versus Deno scope

The Workman issue is declaration provenance: root-global reflection must use the active Deno
declarations consistently. This should fix cases such as `OffscreenCanvas.getContext("webgpu")`,
where Deno already supplies the precise overload.

The `UnsafeWindowSurface` issue is declaration precision. Its current Deno declaration accepts the
same discriminator union but returns the entire context union, with no correlation between input and
output. Even perfect Workman reflection must preserve that broad type. A narrow compatibility
augmentation is therefore required for the known runtime behavior:

```ts
declare namespace Deno {
  interface UnsafeWindowSurface {
    getContext(contextId: "webgpu", options?: any): GPUCanvasContext | null;
  }
}
```

This overload is a declaration compatibility patch, not a Workman inference rule and not a foreign
reference side channel.

## Proposed fix

1. Give `jsGlobalTypeRef` a host source that references `__wm_deno_types.d.ts`, matching the active
   declaration environment used by global-member reflection.
2. Keep the source and type-reference cache keys sensitive to the declaration environment so a
   change of configured Deno executable cannot reuse incompatible reflected types.
3. Preserve the existing literal argument hints and TypeScript overload-selection path; do not add a
   WebGPU-specific rule to call resolution.
4. Keep Deno compatibility declarations in a clearly identified overlay. The current inline
   `UnsafeWindowSurface` augmentation is acceptable for the immediate slice, but the overlay should
   eventually be isolated and versioned so it is easy to remove when upstream declarations become
   precise.
5. Do not propagate foreign type references through ordinary Workman values merely to recover lost
   precision later. The declaration boundary should establish the correct type once.

## Regression coverage

Add focused tests for both sides of the distinction:

- A root-global `OffscreenCanvas.getContext("webgpu")` call resolves to
  `Result<Option<GPUCanvasContext>, Js.Error>` using only the active Deno declarations.
- A `Deno.UnsafeWindowSurface.getContext("webgpu")` call resolves to that same result while the
  compatibility overlay is enabled.
- A broad or unknown discriminator does not incorrectly select the `"webgpu"` overload.
- The tests use a focused filter; the full Workman test task is not required for this issue.

## Current compatibility workaround

Keep the narrow `UnsafeWindowSurface` overload augmentation in `denoTypesSource()` while this issue
is open. It is needed independently of the general Workman fix because it supplies information
missing from Deno 2.9.2 itself. The visual wmslang example can then remain fully typed without a
`Json.assert` boundary and without degrading its WebGPU context to blind `Js.Object` access.
