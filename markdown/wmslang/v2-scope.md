# wmslang v2 ergonomic slice

Status: implemented ergonomic slice. This document extends the completed static visual-v1 pipeline without opening
the deferred uniform, coercion, specialization, or general optimization designs.

Implementation checkpoint: pure four-tuple results, shader-side `float2`/`float4` representation,
symmetric scalar/vector arithmetic, deferred root-coordinate shape solving, vector projection, and
the migrated Mandelbrot/window examples are implemented and covered by focused compiler and real
WebGPU render tests. Semantic diagnostics retain resolved primary/related Workman anchors, and
backend failures are attributed to the selecting fragment call and selected shader declaration.

## Intent

V1 proved the hard semantic path: ordinary Workman inference, immutable control flow, one private
ADT, exhaustive matching, direct self-tail recursion, Workman-written lowering, Slang, WGSL, an
opaque host artifact, and a real render. V2 first removes shader-specific ceremony from ordinary
pure expressions.

The target source style is:

```workman
let shade = (uv) => {
  @gpu;

  let centered = uv * 2.0 - resolution;
  let (x, y) = centered;
  (x, y, 0.25, 1.0)
};

let fragment = Gpu.fragment(shade);
```

The fragment is still selected explicitly by `Gpu.fragment`, because selection creates a host
artifact. Its body is otherwise a pure function. Returning an RGBA value does not require a
side-effect-looking `Gpu.color(...)` call.

## Scope

V2 contains three related changes:

1. A fragment root returns an ordinary homogeneous numeric 4-tuple. The stage boundary interprets
   that result as RGBA.
2. Homogeneous numeric tuples of width 2–4 may use the GPU vector representation. Arithmetic
   supports componentwise vector/vector operations and symmetric scalar/vector broadcast.
3. Shader semantic and backend diagnostics retain a primary Workman span plus related Workman
   anchors when known. Backend errors identify the selected root or helper rather than ending at
   generated Slang alone.

This is an ergonomic and evidence slice, not a resource slice. `resolution` in the example above is
a shader value supplied by a later explicit-uniform slice; focused v2 arithmetic tests may use a
parameter or local tuple instead. V2 does not silently capture a host binding.

## Pure fragment result

The v2 fragment constructor has the source type:

```text
Gpu.fragment : ((((Number, Number)) => (Number, Number, Number, Number))) => Gpu.Fragment
```

The extra parentheses reflect Workman's existing tuple-shaped function representation; they do not
introduce a new nominal color type. At the selected fragment boundary only, the result tuple is
required to have exactly four numeric components and is emitted as the target `float4`/`vec4` color
value.

Inside shader code, a four-component numeric tuple is still an ordinary immutable value. It may be
bound, returned through `if` or `match`, passed to a monomorphic helper, destructured, and combined
with the vector operations below. The public fragment ABI supplies its meaning as RGBA; tuple
construction itself does not perform clamping, conversion, output, or mutation.

`Gpu.color` is not part of the v2 authoring contract. A temporary compatibility identity may remain
while v1 examples migrate, but it must disappear before typed functional IR: there is no `color`
expression, type, or lowered operation in the v2 representation.

## Numeric tuple vectors

Workman has one tuple syntax where GLML distinguishes vectors (`[x,y]`) from products (`(x,y)`).
For this slice, a tuple is vector-representable when all of the following hold:

- its width is 2, 3, or 4;
- every component has ordinary Workman type `Number`;
- it occurs in GPU-reachable code;
- its uses require the vector representation, or it reaches the fixed coordinate/color stage ABI.

Heterogeneous tuples and nested product shapes remain products. The implementation may initially
choose the vector representation for every homogeneous numeric width-2–4 tuple in the closed GPU
slice, because v2 exposes no shader ABI where the product/vector layout difference is observable.
The representation decision must nevertheless be recorded in the shader sidecar/IR rather than
changing Workman's host `Ty` union or global tuple semantics.

The v2 operator table is:

| Left       | Operator    | Right      | Result      | Meaning                         |
| ---------- | ----------- | ---------- | ----------- | ------------------------------- |
| scalar     | `+ - * /`   | scalar     | scalar      | existing scalar operation       |
| vector `N` | `+ - * /`   | vector `N` | vector `N`  | componentwise                   |
| vector `N` | `+ - * /`   | scalar     | vector `N`  | broadcast scalar to every lane  |
| scalar     | `+ - * /`   | vector `N` | vector `N`  | broadcast scalar to every lane  |

Widths must agree for vector/vector operations. V2 does not resize, truncate, pad, or implicitly
swizzle vectors. Arithmetic stays `f32`; there is no `i32`, `u32`, promotion lattice, or inserted
numeric conversion.

The requested expression therefore resolves as:

```text
uv            : f32x2
2.0           : f32
uv * 2.0      : f32x2  -- scalar broadcast
resolution    : f32x2
... - resolution : f32x2  -- componentwise subtraction
```

Tuple destructuring and `.x`/`.y`/`.z`/`.w` projection lower to vector lane extraction when the
source value is vector-represented. The named spelling follows Slang/HLSL shader convention. It is
available only in GPU typing regions, checks the selected lane against the solved vector width, and
does not add fields to ordinary host tuples. Product tuples continue to use product fields.

## GLML findings

GLML provides a useful semantic reference but not a representation to copy directly.

### Fragment result

GLML checks `main` against `vec2 -> vec4` in `compiler/typecheck.ml`. The authored function returns
its color as its final pure expression. Much later, `compiler/patch_main.ml` changes the target
entry into GLSL's required `void main()` and rewrites value returns to `fragColor = value`.

That separation is the right model for Workman: source semantics remain a pure function, while the
fixed raster wrapper owns target output mechanics.

### Broadcasting

GLML's type checker emits `Broadcast(left, right, result)` constraints for `+` and `-`, and
`MulBroadcast(left, right, result)` for `*` and `/`. Its constraint solver handles equal-width
vector/vector operands and either scalar/vector ordering recursively through element types.

For example, GLML's `2d_sdf_variants.glml` writes:

```text
let top = 2 * coord - u_resolution
```

and resolves it to GLSL equivalent to:

```glsl
vec2 top = (2.0 * coord) - u_resolution;
```

GLML's multiplication constraint also includes matrices and linear-algebra shapes. V2 deliberately
takes only its scalar/vector and equal-width componentwise cases. Matrices and general
multiplication semantics remain deferred.

GLML projects vector lanes numerically: `u_resolution.1` creates an `IndexAccess` constraint and
eventually emits an indexed vector access. It reserves named `.field` projection for records.
Workman instead uses shader-familiar `resolution.y` because its existing surface grammar already
represents dotted names and Slang directly supports `float2` lanes named `x` and `y`; schema-v2
still records the projection as numeric lane index `1` rather than carrying the spelling downstream.

## Diagnostic evidence moved from v1

V1 retains stable diagnostic codes and source span IDs in the shader DTO, which is sufficient to
prove semantic rejection. V2 owns the next presentation/evidence step:

- every shader diagnostic has one primary Workman span;
- non-tail and mutual-recursion diagnostics may identify the recursive declaration as a related
  span;
- generated Slang/backend failures identify the selected root and, when available, the emitted
  helper whose generated range failed;
- the thrown compiler error preserves structured diagnostics instead of flattening them to only
  `code: message` text;
- this remains compatible with the proposed program-evidence graph, but does not require that
  larger unification project.

Exact generated-source maps, multi-error ordering, and the complete diagnostic evidence protocol
remain later work.

## Non-goals

- uniforms, automatic captures, buffers, textures, samplers, or resource reflection;
- integer shader representations or automatic numeric coercion;
- vector comparisons, structural equality, matrices, multi-lane swizzles, or general indexing;
- compiler math intrinsics;
- imported helpers, multiple roots, polymorphism, or higher-order shader values;
- general tuple representation solving outside GPU-reachable code;
- optimization.

## Acceptance

V2 is complete when focused fixtures prove:

1. A fragment ending in `(1.0, 0.0, 0.0, 1.0)` compiles and renders opaque red without
   `Gpu.color`.
2. `uv * 2.0 - resolution` type-checks and lowers to one vector multiply and one vector subtract,
   with no four independent authored scalar expressions.
3. Both `vector * scalar` and `scalar * vector` work; mismatched vector widths fail at the Workman
   source operation.
4. Tuple destructuring of a vector-represented value preserves lane order.
5. Generated Slang uses `float2`/`float4` values and the fragment wrapper returns the pure root
   result as its output color.
6. The existing Mandelbrot ADT and tail-recursion render remains green after removing `Gpu.color`.
7. A non-tail recursion diagnostic retains both its primary recursive-call span and the related
   declaration span; a forced backend failure retains its Workman root anchor.
8. Ordinary host tuple arithmetic remains unchanged outside `@gpu` regions.
