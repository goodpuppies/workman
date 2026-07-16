# wmslang deferred diagnostics, provenance, and artifact identity

Status: deferred production diagnostic/artifact protocol. The vertical slice in
[`v1-scope.md`](./v1-scope.md) requires stable focused codes, primary Workman spans, retained
backend output, and a useful root/helper anchor. Structured evidence rows, global ordering, total
generated source maps, logical-module transport, and exact artifact hash framing are post-v1.

Terminology note: unqualified “v1” statements below describe the deferred production protocol.

## Workman source coordinates

wmslang uses Workman's existing `SourceSpan` convention without conversion:

- `line` is one-based and `col` is zero-based;
- `start` and `end` are zero-based JavaScript UTF-16 code-unit offsets;
- `[start, end)` is half-open;
- the line and column describe `start`;
- a source span is always paired with the module that owns the source bytes.

The parser already produces this convention, and `source.slice(start, end)` recovers the authored
text. Slang byte offsets or columns must never be stored in a `SourceSpan`.

Schema v2 retains a deduplicated span table. Each row has a compile-local `spanId`, a logical module
ID, and the four coordinate fields above. A companion module row carries `moduleId`, display path,
deterministic dependency-first `logicalOrder`, UTF-16 `sourceLength`, and every line-start offset.
Dependency order follows authored import-declaration order and never sorts absolute paths. `spanId`,
absolute filesystem paths, and line/column coordinates are diagnostic metadata: none participates in
semantic specialization or artifact identity. The loader verifies bounds, recomputes line/column
from the module row, and rejects a row whose module, offsets, or cached line/column disagree. The
TypeScript renderer separately retains the actual module source needed to recover an authored slice.

Real filesystem paths may be used by the CLI to load source and render an error. DTO snapshots,
generated Slang virtual paths, cache keys, and embedded artifacts use logical module IDs or
project-relative display paths and contain no machine-specific workspace prefix.

## Schema-v2 diagnostic row

The bootstrap schema-v1 row `{ code, message, spanId }` is not the v1 boundary. Schema v2 carries
structured evidence:

```ts
type GpuDiagnosticPhaseV1 =
  | "selection"
  | "closure"
  | "representation"
  | "lowering"
  | "backend";

type GpuDiagnosticRelatedV1 = {
  spanId: number;
  label: string;
};

type GpuDiagnosticFactV1 = {
  name: string;
  value: string;
};

type GpuDiagnosticV1 = {
  code: string;
  severity: "error";
  phase: GpuDiagnosticPhaseV1;
  rootId: number;
  primarySpanId: number;
  related: GpuDiagnosticRelatedV1[];
  facts: GpuDiagnosticFactV1[];
};
```

`rootId` is the schema-v2 `GpuRootId` assigned to the statically selected lambda and its ordered
selector set, not a region discovery index or function `BindingId`; inline roots therefore have an
identity too. Repeated `Gpu.fragment` calls resolving to the same lambda share the root and
artifact. It is `-1` for a failure that cannot belong to a materialized root, including an
unresolved or unmarked selector and a host call to an unselected GPU-only function. Every
source-language diagnostic has a valid primary span. A backend failure uses the earliest selecting
`Gpu.fragment(...)` call as its primary, relates later equivalent selectors, and keeps its generated
location in `facts`; it does not use `-1` to imitate a source span.

`related` entries are ordered explanatory anchors such as "i32 evidence", "f32 evidence", "declared
here", or "also participates in this cycle". `facts` contains stable machine-readable values needed
by the code's renderer, such as an operator ID, representation, or generated virtual line. Fact
names are unique and sorted lexically. User-facing prose is rendered in TypeScript from
`(diagnostic contract version, code, facts)` so the bootstrap Workman compiler does not own a second
set of drifting English templates.

Fact names match `[a-z][a-zA-Z0-9]*`. Fact values and related labels contain no NUL or ASCII control
character other than an embedded newline in a backend detail, and each is at most 65,536 UTF-8
bytes. Large generated source, raw reflection, and full Slang diagnostics are failure attachments,
not fact values.

The loader rejects unknown phases, severities, codes, missing spans, duplicate fact names,
out-of-order facts, invalid related spans, and malformed fact names or values. It also verifies that
every primary and related span belongs to the selected root's selector set or reachable source
graph; a rootless diagnostic may refer to any validated input module. Diagnostics are returned
through Workman's normal auditable diagnostic renderer by converting primary and related rows to
source anchors. The existing support-graph representation may grow richer later; v1 does not
fabricate type-unification evidence for a shader capability error.

Invalid DTOs, dangling semantic IDs, and impossible IR invariants are compiler-boundary failures,
not `GpuDiagnosticV1` rows. They fail closed as internal errors and preserve the validated input or
IR snapshot. In particular, `gpu.schema-version`, `gpu.duplicate-function-id`, and
`gpu.internal.semantic-id` from H0 are not user-language diagnostics in v1.

## Closed compilation-code catalog

The loader's v1 registry is exactly the following union. Feature documents remain authoritative for
the individual premise and legal source subset; this table freezes phase ownership and prevents an
emitter or backend from inventing nearby spellings.

| Phase            | Codes                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selection`      | `gpu.fragment.unresolved-root`, `gpu.fragment.not-marked`, `gpu.fragment.signature`, `gpu.fragment.host-call`, `gpu.color.signature`, `gpu.color.escape`, `gpu.uniform.schema`, `gpu.uniform.binding`, `gpu.adt.public-abi`     |
| `closure`        | `gpu.capture.illegal`, `gpu.capture.static-cycle`, `gpu.function.first-order`, `gpu.function.capability`, `gpu.uniform.multiple`                                                                                                |
| `representation` | `gpu.number.conflict`, `gpu.number.i32-range`, `gpu.number.recursive-specialization`, `gpu.vector.shape`, `gpu.operator.unsupported`, `gpu.operator.shape`, `gpu.intrinsic.shape`                                               |
| `lowering`       | `gpu.recursion.non-tail`, `gpu.recursion.mutual`, `gpu.adt.recursive-layout`, `gpu.adt.unsupported-payload`, `gpu.pattern.unsupported`, `gpu.pattern.pinned-runtime`, `gpu.pattern.refutable-let`, `gpu.pattern.non-exhaustive` |
| `backend`        | `gpu.backend.toolchain`, `gpu.backend.compile`, `gpu.backend.entry`, `gpu.backend.reflection`                                                                                                                                   |

`gpu.uniform.wrong-artifact` and `gpu.uniform.pack` are the only additional v1 GPU-prefixed runtime
error codes. They never appear in `GpuDiagnosticV1`. Adding, removing, renaming, or moving a code
between phases increments the diagnostic contract version and schema-v2 output version.

## Primary and related attribution

The primary anchor is the smallest authored occurrence whose replacement could change the failed
premise. A declaration is related evidence when a more local use caused the failure. This extends
Workman's existing preference for an offending call argument over the callee definition.

The feature tables refine that rule. The cross-feature cases are frozen as follows:

| Failure                               | Primary                                        | Required related anchors                          |
| ------------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| mixed numeric evidence                | operator, call, or value-flow occurrence       | first `i32` and first `f32` evidence              |
| illegal capture                       | free value occurrence in the reachable closure | captured binding declaration                      |
| second explicit uniform               | occurrence introducing the second `UniformId`  | first descriptor binding                          |
| non-tail self-call                    | resolved recursive call                        | recursive function declaration                    |
| mutual recursion                      | earliest call edge closing the SCC             | every participating declaration in semantic order |
| recursive ADT storage                 | edge closing the layout cycle                  | declarations along the shortest semantic-ID cycle |
| non-exhaustive match                  | complete `match` expression                    | none; missing constructor names are facts         |
| backend compile or reflection failure | selecting `Gpu.fragment(...)` call             | selected root declaration                         |

"First" means the lowest `(logical module order, start, end)` source coordinate, not the first edge
visited by a map or worklist. Cycle explanations choose the shortest cycle, breaking equal lengths
by the sequence of semantic IDs. These rules make diagnostics stable when worklists or map
implementations change.

One invalid source occurrence owns one most-specific diagnostic. Numeric requirements contributed by
a legal operator or intrinsic are solver edges: if fixed `i32` and `f32` evidence collide, the code
is `gpu.number.conflict`. `gpu.operator.shape` and `gpu.intrinsic.shape` are reserved for
scalar/vector kind, width, or arity failures after each occurrence has a non-conflicting concrete
representation. This removes any competing `operator.representation` or `intrinsic.representation`
diagnosis for `1 + 1.0` or `sin(1)`.

## Phase gates, ordering, and deduplication

Normal Workman parsing and HM inference run first. If they produce an error, no GPU diagnostic is
attempted for that module graph. Each selected fragment is then checked through these gates:

1. `selection`: root resolution, marker, public signature, color flow, and explicit uniform schema;
2. `closure`: reachable first-order functions, static captures, uniform cardinality, and capability;
3. `representation`: strict numeric solving, specialization signatures, operators, and intrinsics;
4. `lowering`: finite layouts, patterns, exhaustiveness, tail position, and closed-IR validation;
5. `backend`: deterministic emission, Slang compilation, entry checking, and reflection.

All independent failures in the earliest failing phase are returned for that root; later phases do
not run for it. Other roots continue through their own gates so one bad artifact does not hide an
independent artifact's error. This is error accumulation over validated facts, not recovery by
inventing shader types or values.

Within the compilation, rows are sorted by:

```text
(phase ordinal, root semantic ID, primary logical module order,
 primary start, primary end, code, related span tuple, fact tuple)
```

Exact duplicate tuples are removed only within the same root. The same helper failure reached from
two fragment roots remains two diagnostics because the closures and remediation may differ. No
ordering depends on Workman `Map`, JavaScript `Map`, recursion/worklist order, or emitted Slang
declaration order.

All v1 shader-language diagnostics are errors. Ordinary Workman's existing non-exhaustive-match
warning remains available outside a selected shader; the GPU phase adds `gpu.pattern.non-exhaustive`
as an error only for a reachable match.

## Generated-source provenance

The Slang emitter produces a sidecar segment map while it writes canonical source. Each half-open
generated UTF-16 range maps to:

- the typed/lowered IR node ID;
- its primary Workman `spanId`;
- the selected root ID; and
- a generated-origin kind for wrapper, declaration, expression, or synthetic control flow.

Segments are non-overlapping, sorted, and cover every generated token. Whitespace may inherit the
following token's segment and final whitespace inherits the preceding token. Synthetic wrapper
segments point to the selecting fragment call and name their generated-origin kind; they never
pretend the wrapper was authored Workman.

The generated module uses a stable virtual path derived from the artifact ID prefix, never an
absolute source path. Slang diagnostics are retained verbatim as backend evidence, then located in
the sidecar map by generated line/column. Because source capability and type errors must have been
caught before emission, a Slang rejection is `gpu.backend.compile`, not a newly inferred Workman
feature error. Its primary remains the selecting fragment call; a mapped authored segment is related
evidence labelled "generated from here". The renderer also shows the generated virtual location and
keeps the full generated Slang for debugging.

The pinned Slang adapter must lock and test the diagnostic line/column convention it receives. It
converts that convention to a generated UTF-16 offset before consulting the segment map; it never
copies a Slang column directly into `SourceSpan.col`.

## Backend and runtime failures

The compile-time backend has four stable codes:

| Code                     | Meaning                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `gpu.backend.toolchain`  | pinned assets, hashes, version, target, or session setup disagree  |
| `gpu.backend.compile`    | generated Slang fails checking or linking                          |
| `gpu.backend.entry`      | fixed vertex/fragment entry discovery or stage identity disagrees  |
| `gpu.backend.reflection` | normalized reflection disagrees with the predicted closed manifest |

The former uniform-specific reflection spelling is folded into `gpu.backend.reflection`; its facts
identify the uniform resource or field. Backend codes never replace an earlier source-language
diagnostic.

`gpu.uniform.wrong-artifact` and `gpu.uniform.pack` are host runtime errors, not compilation rows.
They carry the artifact ID and expected/actual uniform identities, and they do not expose raw
descriptor internals as Workman records.

Toolchain startup is global. If hashes, target availability, version, or session creation fails, the
compiler emits one rootless `gpu.backend.toolchain` row at the earliest selector and relates the
remaining selectors; no artifact enters its backend gate. Compile, entry, and reflection failures
remain per artifact.

## Artifact ID and cache preimage

`VisualShaderArtifactV1.id` is exactly `wms-v1-` followed by 64 lowercase hexadecimal characters.
The suffix is SHA-256 over a domain-separated, length-framed byte stream. Start with the UTF-8 bytes
of `workman-visual-artifact-v1`; then, for each component below in order, append its byte length as
an unsigned 64-bit big-endian integer followed by its bytes:

1. decimal schema-v2 version;
2. decimal artifact-manifest version (`1`);
3. decimal backend/emitter version;
4. canonical generated Slang UTF-8 bytes, which already contain the selected reachable semantics and
   static literal values;
5. uniform schema fingerprint bytes, or the empty byte string;
6. target/profile/options fingerprint bytes;
7. pinned Slang JavaScript-loader SHA-256 bytes;
8. pinned Slang declaration-file SHA-256 bytes;
9. pinned Slang WASM SHA-256 bytes;
10. UTF-8 runtime `getVersionString()` value.

The target/profile/options fingerprint is lowercase SHA-256 over UTF-8 JSON with fields in this
fixed order: `target`, `profile`, `vertexEntry`, `vertexStage`, `fragmentEntry`, `fragmentStage`,
then `sessionOptions`. The fixed entry values are `wm_vertex`/`vertex` and `wm_fragment`/`fragment`;
`target` is `wgsl`. The pinned build manifest supplies the profile and a lexically key-sorted
`sessionOptions` object containing only JSON primitive values. JSON strings use the standard JSON
escape spelling and the document has no insignificant whitespace.

Hash strings in the preimage, including the uniform and options fingerprints, are decoded to their
32 raw bytes. An absent optional component is a zero-length field, distinct from omitting the field.
`GpuRootId`, selector lists, source spans, display paths, diagnostic text, current runtime values,
and intermediate IR snapshots are absent. Successful artifacts are identified by their canonical
target input and pinned backend, not by compiler worklist or debug structure.

The artifact ID is also the cache key namespace. A cache hit is accepted only after parsing and
validating the embedded manifest and rechecking its backend identity; the ID alone is not trusted.
Current uniform values, descriptor object identity, canvas size, adapter/device identity, color
attachment format, and absolute project path are excluded. Changing source formatting or moving an
otherwise identical project therefore preserves identity; changing reachable semantics, static
literals, the uniform schema, emitter, target options, or pinned compiler changes it.

The provenance sidecar and diagnostics are stored beside a failed or debug artifact but excluded
from the hash. This prevents machine paths or renderer prose from invalidating shader code while the
canonical semantic and backend inputs still make stale cache reuse impossible.

## Focused proof fixtures

- Unicode before and inside an offending expression round-trips UTF-16 spans and renders the exact
  authored slice.
- Moving the same source tree changes CLI display paths but not generated Slang or artifact ID.
- An unreachable marked helper produces no GPU diagnostic or artifact of its own.
- `1 + 1.0` yields one `gpu.number.conflict` with ordered `i32` and `f32` related anchors.
- One illegal helper reached by two roots yields one closure diagnostic per root in stable order.
- Reversing registry/worklist insertion produces byte-identical diagnostic DTOs.
- A forced generated Slang failure retains the selector as primary, maps the generated segment to a
  related Workman occurrence, and retains its virtual line without constructing a fake source span.
- Changing one static literal, uniform field representation, emitter version, Slang asset hash, or
  session option changes the artifact ID; changing a runtime uniform value does not.
- Malformed diagnostic facts, dangling spans, and schema-v1 diagnostic rows fail loader validation
  rather than being rendered.
