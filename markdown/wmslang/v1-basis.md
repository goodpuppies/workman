# wmslang v1 Workman basis

Status: source API for the vertical slice in [`v1-scope.md`](./v1-scope.md). This file intentionally
contains only names required by that slice.

## Compiler-owned types

```text
Gpu.Color
Gpu.Fragment
```

`Gpu.Color` is a nominal fragment result backed by four shader `f32` components. It prevents an
arbitrary tuple from becoming a stage result accidentally.

`Gpu.Fragment` is an opaque completed host artifact. It is not a callable Workman function and does
not expose a shader AST.

## Compiler-owned operations

```text
Gpu.color              : ((Number, Number, Number, Number)) => Gpu.Color
Gpu.fragment           : (((Number, Number)) => Gpu.Color) => Gpu.Fragment

Gpu.wgsl               : (Gpu.Fragment) => String
Gpu.vertexEntryPoint   : (Gpu.Fragment) => String
Gpu.fragmentEntryPoint : (Gpu.Fragment) => String
```

`Gpu.color` is GPU-only. `Gpu.fragment` is a compile-time-recognized host constructor which selects
exactly one inline or directly bound `@gpu` lambda. The accessors operate on the completed artifact
embedded in generated JavaScript.

The root receives one two-component tuple. It is not a curried or two-parameter function. The
generated wrapper supplies raw fragment coordinates and expects `Gpu.Color` on every result path.

`Gpu.fragment`, `Gpu.color`, and the artifact accessors are compiler-basis entries with closed
semantic IDs. They are never identified from dotted source spelling after inference. GPU-only names
have no ordinary JavaScript implementation.

## Isolation

The selected GPU body is analyzed by the shader branch and never lowered through Workman Core. The
shader branch may contain only the source subset in [`v1-scope.md`](./v1-scope.md). Host FFI values,
ordinary captured values, resources, and calls with surviving foreign behavior are rejected.

The shader pipeline completes first and supplies Core lowering with a map from the selected
`Gpu.fragment(...)` call object to a completed artifact. Core replaces that call with an opaque
artifact reference and omits the GPU-only binding/body.

## Deferred basis

The following previously proposed names are not v1 requirements:

```text
Gpu.i32 Gpu.f32
Gpu.Uniform<T> Gpu.uniform Gpu.read Gpu.withValue
Gpu.uniformBinding Gpu.uniformByteLength Gpu.uniformBytes
sin cos abs floor fract sqrt min max clamp dot length
```

They belong to later numeric and resource slices. Their design remains recorded in
[`v1-numerics.md`](./v1-numerics.md) and [`v1-uniform.md`](./v1-uniform.md), but those documents no
longer define v1 completion.
