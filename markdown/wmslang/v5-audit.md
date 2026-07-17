# wmslang v5 completion audit

Date: 2026-07-17. The implementation is described in
[`v5-implementation.md`](./v5-implementation.md). This audit checks the numbered acceptance contract in
[`v5-scope.md`](./v5-scope.md) against executable evidence. The repository-wide `deno task test`
is intentionally not the V5 gate; focused numeric, specialization, backend, WebGPU, LSP, and SDL
suites are.

| Requirements | Evidence | Result |
| --- | --- | --- |
| 1--5. `i32` evidence, exact rows, explicit conversion, specialization, and no defaulting | Nine `schema v5` slice tests plus twelve V4 specialization/annotation tests | Proven |
| 6. Integer raymarch counter | GLML-derived raymarcher uses an unannotated `i32` counter and explicit `Gpu.f32`; real WebGPU render remains stable | Proven |
| 7. Signed uniforms | Slang reflection, host packing, vector layout, and out-of-range runtime rejection tests | Proven |
| 8--10. Resource schema, pinned `Sample`/`Load`, and logical immutable IR | Source-to-IR-to-lowered-to-Slang test, terminal reflection test, and unused-resource layout rejection | Proven |
| 11--13. Typed wrappers, samplers, binding identity, and lifetime | Generated-runtime test covers distinct sampled/target roles, cross-device rejection, nearest/linear samplers, replacement textures, idempotent destruction, and dead-resource rejection | Proven |
| 14. Multiple roots | Multi-root analysis/materialization test proves deterministic independent roots and equal-root deduplication | Proven |
| 15. Compatible pipeline/module reuse | Workman presenter retains the completed module and reuses it for a same-artifact offscreen target; both window examples fully compile | Proven |
| 16--17. Ordered passes and alias rejection | Real WebGPU test executes three update/display submissions and runtime validation rejects sampled-target physical aliasing before encoding | Proven |
| 18. Resize initialization and retirement | SDL resize path allocates two zero-cleared textures, resets frame/orientation, updates the surface dimensions, and destroys the old pair; compiled-host lifecycle test retains the path | Proven |
| 19. SDL Game of Life | Runnable two-pass example survived a controlled 20-second real SDL/WebGPU smoke run; headless readback separately proves evolving opaque output | Proven |
| 20. Hover and diagnostics | Focused tests cover occurrence-local `i32`, both numeric provenance paths, every selected root, and concrete sampled texture/sampler hover | Proven |
| 21. Focused regressions | V5 slice, V4 specialization, backend, LSP, real WebGPU, and both SDL compile tests pass; `deno task check` passes | Proven |
| 22--23. One-way ownership | Catalog check, typed IR validation, terminal Slang agreement, and adapter-only resource creation tests preserve the documented layer boundary | Proven |

The Game of Life gate exposed two useful invariants. First, every declared resource must remain live
in the linked shader interface; otherwise WebGPU `layout: "auto"` may omit it even when source-level
Slang reflection reports it. The normalizer now rejects such unused resource fields. Second, data
textures may also be visual outputs, so simulation channels must preserve their exact state
encoding—the example uses an exact zero/one red lane while keeping color in the other lanes.

V5 remains the scoped slice: signed integers, sampled `rgba16float` textures, nearest/linear
samplers, multiple fragment roots, and explicit host-owned feedback. It adds no storage writes,
compute, render graph, `u32`, general texture formats, or Slang-driven reinference.
