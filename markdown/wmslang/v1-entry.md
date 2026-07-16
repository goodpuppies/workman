# wmslang expanded fragment selection and color boundary

Status: expanded entry/artifact design. The vertical slice in [`v1-scope.md`](./v1-scope.md) uses
only one inline or directly bound root, fixed entry names, raw coordinates, nominal color, and host
artifact isolation. Alias chains, repeated selectors, deduplication, cache identity, and the broader
proof matrix are post-v1.

Terminology note: unqualified “v1” statements below describe the former expanded visual contract
unless [`v1-scope.md`](./v1-scope.md) explicitly retains them.

## Marker versus artifact root

`@gpu;` is lambda prologue metadata. It selects the GPU typing dialect for that body and prevents
host FFI rewriting, but it does not by itself request Slang/WGSL generation.

A visual artifact root exists only at a compiler-known `Gpu.fragment(functionValue)` call. The
function value must resolve statically to exactly one `@gpu` lambda through one of:

- the inline lambda itself;
- its direct immutable `PVar` binding;
- a finite chain of immutable variable aliases ending at that binding.

Resolution uses lambda region facts and `BindingId`s. Function parameters, record fields, tuple/ADT
members, conditional or matched function values, arbitrary call results, and host FFI values cannot
select a root even if their ordinary HM type happens to match.

Every syntactically valid, statically resolved `Gpu.fragment` selection is compiled during Workman
compilation. Repeated selections of the same root plus identical closed schema/capture facts reuse
one completed artifact. An `@gpu` lambda with no selecting constructor remains an unmaterialized
GPU-only candidate: its ordinary inference facts are checked, but capability closure and Slang
generation do not run merely because the marker exists.

Calling an `@gpu` function from host execution is illegal. Inside a reachable shader graph it may be
a direct first-order callee if its signature is in the private v1 subset, but using it as general
function data remains excluded by [`v1-captures.md`](./v1-captures.md).

## Frozen source signatures

The compiler basis signatures are:

```text
Gpu.fragment : (((Number, Number)) => Gpu.Color) => Gpu.Fragment
Gpu.color    : ((Number, Number, Number, Number)) => Gpu.Color
```

The extra tuple layer is semantic: the root receives one two-component value, not two curried or
independent Workman parameters. After GPU representation solving the closed signature is:

```text
fragment root : (f32x2) -> Gpu.Color
Gpu.color      : (f32x4 components) -> Gpu.Color
```

A mismatch is diagnosed at the constructor call with notes on the root parameter/result. The
compiler does not adapt a two-parameter function, structural four-tuple result, record result, or
ordinary CPU function.

## Fragment coordinate

The generated fragment wrapper receives `float4 position : SV_Position` and passes exactly
`position.xy` to the specialized Workman root. No generated code normalizes, centers, scales,
rounds, flips, or consults uniform resolution.

For the WGSL/WebGPU v1 target this value is the pixel center in framebuffer coordinates with a
top-left origin. The fixed fullscreen triangle and viewport produce `(x + 0.5, y + 0.5)` for an
integer pixel `(x, y)` under the acceptance setup. Viewport/scissor configuration remains explicit
host state; tests use a full-target viewport and scissor.

The coordinate is an ordinary immutable `f32x2` shader value after entry. It may be destructured,
passed to helpers, stored in private records/finite ADTs where otherwise legal, or ignored.

## Nominal color

`Gpu.color((r, g, b, a))` creates the nominal `Gpu.Color` stage value from four already solved `f32`
components. It is a closed `GpuSemanticId`, not a record/tuple-shape convention.

The operation does not clamp, premultiply alpha, change color space, reorder components, or inspect
the host render-target format. The fragment wrapper returns the four components as `float4` with
`SV_Target`; WebGPU pipeline/attachment conversion owns any normalization or format conversion.

`Gpu.Color` may flow through immutable `let`, `if`, exhaustive `match`, and direct helper returns.
V1 exposes no color projection or arithmetic and does not permit `Gpu.Color` in uniforms, record/ADT
payloads, static captures, or function parameters other than an internal direct return path. The
selected fragment root must return it on every branch.

Acceptance rendering uses one `rgba8unorm` offscreen attachment. Exact probes use only component
values `0.0` and `1.0`; broader visual probes avoid relying on cross-device rounding of intermediate
values. A host may use another WebGPU color format compatible with a float fragment output, but
format selection and validation are outside the shader language and artifact cache key.

## Compile-time construction and runtime value

`Gpu.fragment` is recognized during compilation. The pipeline performs:

1. resolve the selected region/root identity;
2. close first-order reachability and captures;
3. solve concrete numeric/record/ADT specializations;
4. lower immutable Workman semantics and emit deterministic Slang;
5. validate/link/reflect through the pinned Slang service;
6. reconcile the predicted manifest and embed one completed artifact payload in generated
   JavaScript.

At runtime, evaluating the source `Gpu.fragment` expression returns an opaque immutable
`Gpu.Fragment` descriptor referencing that embedded payload. It never parses Workman, invokes
wmslang, loads Slang WASM, fetches compiler assets, or recompiles shader source.

The descriptor exposes data only through the frozen host accessors. Re-evaluating the same source
constructor may return an equivalent descriptor, but the API does not promise JavaScript object
identity. Artifact identity comes from its stable artifact ID and manifest.

The content-addressed artifact key is derived from exactly the framed components in
[`v1-diagnostics.md`](./v1-diagnostics.md). In product terms those components cover:

- normalized schema/DTO and backend/emitter versions;
- canonical generated Slang containing the selected reachable program and static literal captures;
- the uniform schema fingerprint, but not uniform runtime values;
- deterministic generation options and stable entry contract;
- pinned Slang version and asset hash;
- target `wgsl`.

Intermediate IR snapshots and compile-local selector IDs are deliberately absent: they are compiler
evidence, while the successful raster artifact is identified by its canonical target input and
pinned backend.

Host attachment format, buffer objects, current uniform values, canvas size, and render-pass state
do not change shader identity.

## Artifact isolation

GPU-only basis operations (`Gpu.color`, `Gpu.read`, conversions, and visual intrinsics) have no host
runtime meaning. Before host Core lowering begins, the GPU pipeline replaces each resolved
`Gpu.fragment(...)` selection with a completed artifact handoff. Core receives only an opaque
artifact reference; it never receives or lowers the selected lambda body.

Ordinary Workman functions and unselected source remain on the existing Core/JavaScript path. A
completed `Gpu.Fragment` may be stored in host records, passed to its accessors, and used alongside
ordinary typed WebGPU FFI code, but it cannot be called or inspected as a shader AST.

## Diagnostics

| Code                           | Primary span            | Meaning                                                            |
| ------------------------------ | ----------------------- | ------------------------------------------------------------------ |
| `gpu.fragment.unresolved-root` | `Gpu.fragment` argument | value does not statically resolve to one lambda                    |
| `gpu.fragment.not-marked`      | resolved lambda         | selected function lacks `@gpu`                                     |
| `gpu.fragment.signature`       | constructor call        | root is not one `f32x2` argument returning `Gpu.Color`             |
| `gpu.fragment.host-call`       | host call occurrence    | GPU-only function is invoked as CPU code                           |
| `gpu.color.signature`          | `Gpu.color` call        | argument is not four concrete `f32` components                     |
| `gpu.color.escape`             | illegal color use       | nominal color appears outside the allowed return/control-flow path |

Backend/link/reflection failures retain their separate backend codes and generated artifacts; they
are not reported as root-signature errors after this contract has passed.

## Current schema boundary

Production program analysis now recognizes `Gpu.fragment` through its closed compiler-basis semantic
ID and gives the schema-v2 Workman boundary one inline or directly bound same-module root. The v1
slice rejects aliases beyond that source boundary, repeated selectors, multiple roots, and
cross-module helpers. An unselected marked lambda is absent from the selected-program DTO. Explicit
H0 fixture normalizers still treat every discovered `@gpu` region as a root solely to preserve the
bootstrap numeric/capture experiments.

## Focused proof fixtures

- An inline marked lambda and a two-hop immutable alias select the same root identity.
- An unselected marked lambda produces no Slang, WGSL, manifest, or capability diagnostic from an
  otherwise unreachable host-only helper.
- A same-shaped unmarked function, function parameter, conditional function value, and record field
  each fail static root selection.
- The coordinate wrapper passes raw `position.xy`; the quadrant render detects normalization or a Y
  flip.
- A structural four-tuple return fails until wrapped by `Gpu.color`.
- Color control flow through `if` and exhaustive `match` succeeds; color payload/storage/projection
  uses fail.
- Re-evaluating an artifact with changed uniform values does not invoke compiler code or change its
  artifact ID.
- Generated host JavaScript contains embedded WGSL and no executable copy of the GPU lambda body.

This boundary makes the product concrete: `@gpu` describes a language island, while `Gpu.fragment`
is the explicit static act that turns one island into a usable visual artifact.
