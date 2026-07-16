# wmslang deferred uniform descriptor and packing

Status: restricted curried shader environment implemented end to end, including reflection
verification, immutable host packing, and renderer upload. The older explicit-descriptor mechanics
below remain historical packing and identity research where explicitly noted.

Terminology note: unqualified “v1” statements below describe the former expanded resource contract.

## TypeGPU findings and Workman direction

TypeGPU does not turn arbitrary captured JavaScript values into shader inputs. It requires a runtime
data schema such as `d.f32`, `d.vec2f`, or `d.struct(...)`, then creates a typed buffer or uniform
from that schema. The schema drives host serialization, WGSL layout, permitted buffer usage, and the
TypeScript type of values accepted by `.write(...)` and `.patch(...)`.

TypeGPU exposes two related binding styles:

- `root.createUniform(schema, initial)` returns one object with CPU `.write`/`.patch` operations and
  a shader-only `$` view; shader resolution discovers that resource and assigns a binding;
- `tgpu.bindGroupLayout(...)` explicitly declares named uniform, storage, texture, and sampler
  entries; host code creates matching resources and a bind group, shader code uses the layout's `$`
  views, and a pipeline is executed with the matching group.

The important property is the schema-bearing resource identity. A JavaScript number or record is
not a uniform merely because shader code closes over it. TypeGPU's mode-sensitive `$` proxy and
mutable `.write` API are consequences of executing embedded TypeScript during code generation and
do not need to be copied into Workman.

Workman already has a better schema source for the first slice: a concrete nominal record
declaration. It can also make the host/device frequency boundary part of ordinary functional
structure rather than exposing a mutable buffer wrapper.

```workman
record FrameParams = {
  resolution: (Number, Number),
  time: Number
};

let shade = (params: FrameParams) => {
  (coord) => {
    @gpu;
    let centered = (coord * 2.0 - params.resolution) / params.resolution.y;
    -- pure shader computation using params.time
  }
};

let fragment = Gpu.fragment(shade(.{
  resolution = (960.0, 640.0),
  time = 1.0
}));
```

The outer function is a host-side shader factory. Its one nominal record parameter is the dynamic
per-draw environment. The returned inner function is the GPU island; therefore `@gpu;` belongs on
the inner lambda. Everything captured from that immediately enclosing parameter is lowered as one
uniform block, while the inner coordinate parameter remains fragment stage input.

Conceptually the types are:

```text
shade        : FrameParams -> gpu(f32x2 -> f32x4)
Gpu.fragment : gpu(f32x2 -> f32x4) -> Gpu.Fragment<FrameParams>
```

The exact internal type may use an opaque GPU-closure/environment fact rather than adding `gpu(...)`
to Workman's surface type algebra. The important property is that the environment schema remains
attached to the returned GPU value and resulting fragment artifact.

Calling `shade(nextParams)` creates a new immutable bound-shader value that shares the same compiled
shader and schema identity while carrying new runtime data. It replaces user-facing
`Gpu.withValue`; it does not remove packing, buffer allocation, or `queue.writeBuffer` from the
runtime. The renderer performs those effects when drawing the bound fragment.

This is a deliberately restricted form of partial application, not general runtime shader closure
conversion. The first resource slice accepts:

- one directly resolved shader-factory binding;
- exactly one annotated nominal-record host parameter;
- a body whose result is exactly one `@gpu` lambda;
- capture by the inner lambda of that environment parameter only;
- direct selection of the applied result by `Gpu.fragment`.

The selected call result is statically known even though its environment value is dynamic. The
compiler emits the shader once and lowers the runtime outer application to construction of a small
artifact/environment descriptor. Pipeline caching keys on shader/schema identity, never on the
current record value.

Outer application always means dynamic uniform binding in this slice. It must not sometimes mean
uniform data and sometimes trigger compile-time specialization based on whether the argument happens
to be a literal. Static specialization needs a later explicit operation and a visibly different
cache/code-size contract.

This syntax gives frequency-of-change useful structure without claiming that all curried Workman
functions have GPU meaning. An ordinary function returning an ordinary function remains ordinary;
the inner `@gpu` marker and compiler-known stage selection establish this boundary together.

It also resolves the LSP ambiguity:

- the outer parameter occurrence is host `FrameParams`;
- its uses captured by the inner island are the uniform view of that same explicit boundary;
- `params.resolution` inside the island is `f32x2` and `params.time` is `f32`;
- no arbitrary top-level CPU value is reinterpreted or captured.

For the initial resource slice, keep one nominal environment record and one fixed binding.
TypeGPU-style explicit bind-group layouts become useful when textures, samplers, storage buffers, or
multiple resource groups arrive. Raw `GPUBuffer` values never acquire element or layout evidence
automatically; pairing one with a schema must be an explicit unsafe/foreign operation if supported.

The remaining sections predate this curried surface and use `Gpu.Uniform`, `Gpu.read`, and
`Gpu.withValue` terminology. Preserve their stable identity, reflection, zeroed packing, and failure
requirements, but translate the descriptor identity to the shader-factory binding/environment schema
and the current value to the outer application argument.

## Schema boundary

`Gpu.uniform(initial)` requires one concrete nominal Workman record type. Its declaration supplies:

- one stable `RecordId` and semantic type identity;
- fields in declaration order, each identified by `(RecordId, declaredIndex)`;
- the source field name and span for diagnostics only;
- one direct field shape from `Number`, `(Number, Number)`, `(Number, Number, Number)`, or
  `(Number, Number, Number, Number)`.

Every field representation is fixed to `f32`, `f32x2`, `f32x3`, or `f32x4` at this boundary. A type
alias is acceptable only when normal inference resolves it to that same nominal record identity; the
uniform never becomes a structural record. Nested records, booleans, integer fields, ADTs, arrays,
resources, functions, record spreads that change type, and unresolved type variables are rejected.

The complete declared record is the ABI even if shader code reads only one field. Reachability and
backend optimization may remove a `Gpu.read` or projection from executable code, but may not shrink,
reorder, or retype the captured uniform schema.

## Descriptor identity and immutability

V1 accepts `Gpu.uniform(initial)` only as the complete initializer of one immutable `PVar` binding.
That binding's resolved non-negative `BindingId` is the `UniformId`; no parallel allocator or
spelling-derived resource ID is introduced. At runtime its opaque descriptor conceptually contains:

```text
UniformDescriptorV1<T>
  version = 1
  uniformId
  recordId
  schemaFingerprint
  value: T
```

These are compiler/runtime internals, not user-projectable Workman record fields.

Immutable aliases of the descriptor retain the same `UniformId`; shader capture analysis follows
resolved value provenance rather than assigning an alias a new resource. Calling `Gpu.withValue`
checks the same nominal `T` statically and returns a new opaque descriptor containing the new value
with the original `UniformId`, `RecordId`, and fingerprint.

The surrounding free-value and helper closure rules are defined in
[`v1-captures.md`](./v1-captures.md); an ordinary shape-compatible value never reaches this
descriptor path.

Two independent `Gpu.uniform` source bindings have different `UniformId` values even when their
record types and current values are equal. A v1 fragment artifact may close over zero descriptors or
exactly one `UniformId`. Multiple reads and immutable aliases of that one descriptor are legal;
capturing two independent IDs is `gpu.uniform.multiple`.

The descriptor value is not part of shader source, specialization, artifact identity, or cache keys.
The schema fingerprint is. Calling a function that constructs the same statically recognized visual
artifact more than once may therefore reuse compiled shader code while its returned descriptors hold
different runtime values.

The fingerprint is lowercase SHA-256 hex over the UTF-8 bytes of this whitespace-free canonical
text, with decimal IDs and indices:

```text
wm-uniform-v1|record:{RecordId}|fields:{index}:{representation},{index}:{representation},...
```

Fields occur in declared-index order and the empty field list is illegal. Source names and runtime
values are absent. The artifact cache additionally includes the normal program/DTO/backend inputs;
the fingerprint is a schema identity, not the complete shader cache key.

## Shader-side lowering

`Gpu.read(descriptor)` is accepted only inside a GPU region whose selected fragment artifact
captures that descriptor's `UniformId`. It lowers to a typed uniform-read node, not a normal
function call. Reading it multiple times has no source-visible mutation; ordinary expression
evaluation order is still retained in IR.

The generated Slang names are semantic and do not depend on legalizing source field spellings:

```text
struct name   __wm_uniform_r{RecordId}
field name    __wm_r{RecordId}_f{declaredIndex}
parameter     __wm_uniforms
```

The struct fields are emitted in declared-index order. Workman projection by source name has already
resolved to `(RecordId, declaredIndex)` before emission. Generated helpers access the corresponding
semantic field name; the backend never performs source-name lookup.

The only resource declaration is:

```slang
[[vk::binding(0, 0)]]
ConstantBuffer<__wm_uniform_rN> __wm_uniforms;
```

It is omitted for a static artifact. There is no synthesized empty buffer.

## Reflection reconciliation

Workman predicts resource identity, record identity, ordered field identities, concrete field
representations, and group/binding zero. The pinned Slang result is authoritative only for physical
offsets, field storage sizes, aggregate byte length, and padding.

The TypeScript adapter normalizes the pinned reflection JSON into:

```text
ReflectedUniformLayoutV1
  group = 0
  binding = 0
  byteLength
  fields in declared-index order:
    recordId
    declaredIndex
    offset
    byteLength
    representation
```

Reconciliation fails closed unless all of these hold:

1. the artifact predicts exactly the zero-or-one resource count reflected by Slang;
2. the resource kind is a constant/uniform buffer at group zero, binding zero;
3. its generated parameter and semantic field names match the predicted IDs;
4. every predicted field appears exactly once, with the same representation and declaration order;
5. no extra reflected field exists;
6. every offset and size is a non-negative integer, each field range is within the aggregate, and
   field ranges do not overlap;
7. aggregate byte length is positive and a multiple of four;
8. the fragment entry uses the resource and the generated vertex entry does not.

Source field names remain attached as diagnostic notes but are not reflection keys. Unknown JSON
shapes, missing unused fields, duplicate entries, or disagreement between reflection views are
backend contract errors retaining the raw JSON and generated Slang.

## Host packing

The curried implementation exposes `Gpu.uniformBytes(fragment)`. The fragment was already bound
through its compiler-selected factory, so no separate descriptor argument or `UniformId` is needed.
Its hidden artifact/schema metadata and reflected layout govern packing.

The generated packer then:

1. allocates exactly the reflected aggregate byte length;
2. initializes every byte, including padding, to zero;
3. visits fields by `declaredIndex`, never JavaScript property enumeration order;
4. obtains the statically known Workman record field and visits tuple components from zero upward;
5. applies JavaScript `Math.fround` semantics to each `Number`;
6. writes each component with `DataView.setFloat32(offset, value, true)`;
7. returns a fresh `Js.Array<Number>` whose elements are integer bytes from 0 through 255.

The final `true` fixes little-endian encoding. Component offsets within a reflected scalar/vector
field are 0, 4, 8, and 12 bytes as applicable; the adapter verifies that the reflected field range
can contain those components. A three-component field writes 12 value bytes and leaves any following
alignment padding zero.

Host values that round to NaN or infinity are packed as target `f32`, but the visual-v1 portability
and render gates assign them no stable pixel meaning. Packing never silently clamps, substitutes
zero, or changes the descriptor.

`Gpu.uniformByteLength(fragment)` returns the reflected aggregate length and
`Gpu.uniformBinding(fragment)` returns zero. Static fragments report length zero and binding `-1`.
`Gpu.artifactIdentity(fragment)` exposes the compiler-generated identity used by a presenter to
reject a fragment from another shader factory or nominal environment schema. The identity manifest
includes generated WGSL, the selected source factory, and the reflected nominal layout; ordinary
uniform values do not participate. The accessors never accept a separate shape-compatible
descriptor.

## Failure surface

| Code                         | Phase                  | Meaning                                                             |
| ---------------------------- | ---------------------- | ------------------------------------------------------------------- |
| `gpu.uniform.schema`         | shader analysis        | `T` is not the closed nominal field subset                          |
| `gpu.uniform.binding`        | shader analysis        | `Gpu.uniform` is not the complete initializer of one immutable name |
| `gpu.uniform.multiple`       | reachability/capture   | one artifact reaches more than one `UniformId`                      |
| `gpu.uniform.wrong-artifact` | host accessor          | descriptor identity does not belong to the artifact                 |
| `gpu.backend.reflection`     | backend reconciliation | reflected resource or field layout disagrees                        |
| `gpu.uniform.pack`           | host accessor          | runtime descriptor/value violates its generated packer invariant    |

Compile-time failures carry Workman spans. Runtime accessor failures use the existing Workman
runtime-error path and include the artifact ID plus expected and actual uniform identity; they do
not expose the descriptor's value. The shared phase, provenance, and backend-code rules are in
[`v1-diagnostics.md`](./v1-diagnostics.md).

## Focused proof fixtures

- The declared `resolution`, then `time` record remains two reflected fields when only `time` is
  read.
- `f32x2`, `f32`, `f32x3`, and `f32x4` layouts pack known bit patterns at reflected offsets while
  all padding stays zero.
- Reordering JavaScript object properties cannot change bytes.
- Two applications of the same shader factory produce different bytes but share one compiled
  artifact and WGSL module.
- Static artifacts contain no uniform declaration, manifest entry, buffer allocation requirement, or
  packer.
- Reflection fixtures fail on a wrong group, binding, kind, representation, field order, missing
  unused field, overlapping range, or unknown pinned-version JSON shape.

This design follows Workman's nominal records and immutable values. Slang reflection determines
physical storage, while the source compiler remains authoritative for semantic field identity. The
split prevents both JavaScript object ordering and hand-copied WGSL alignment rules from becoming
language semantics.
