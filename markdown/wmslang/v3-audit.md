# wmslang v3 completion audit

Date: 2026-07-17. This audit checks the numbered acceptance contract in
[`v3-scope.md`](./v3-scope.md) against executable evidence. The repository-wide `deno task test`
is intentionally not the V3 gate; the focused shader, backend, render, window, and LSP suites are.

| Requirement | Evidence | Result |
| --- | --- | --- |
| 1. Pinned reproducible catalog and drift rejection | `deno task wmslang:builtins:check`; catalog identity/schema/row-drift tests | Proven |
| 2. GPU-only fallback and lexical shadowing | host-isolation and local-`sin` shadowing tests | Proven |
| 3. Typed unary/binary/ternary builtins survive both IRs | `sin`, `length`, and `smoothstep` end-to-end test, including real WGSL | Proven |
| 4. Strict exact overloads | width, `Bool`, scalar-broadcast, and unresolved-family tests | Proven |
| 5. Structural ineligibility reasons | generated blocker catalog and diagnostics for representation, parameter mode, effect, stage, and WGSL target | Proven |
| 6. No first-class builtin values | `gpu.builtin.first-class` test | Proven |
| 7. Hover and GPU-local completion without backend work | permission-restricted hover/completion tests and host completion isolation | Proven |
| 8. Source diagnostics and backend drift evidence | spelling, overload, ambiguity, and forced-backend-drift tests; drift retains builtin call spans and raw Slang evidence | Proven |
| 9. Warped-noise probe | runnable SDL entry, pinned WGSL compilation, and real-adapter offscreen render with varying opaque pixels | Proven |
| 10. Raymarcher probe | runnable mouse/time SDL entry, private ADT and tail recursion assertions, pinned WGSL, and real-adapter render | Proven |
| 11. Focused regressions | directive, selection, H0, V1/V2/V3, Slang, WebGPU, window, hover, and server suites | Proven |

The two creative probes exposed no new shader capability requirement. Warped noise did expose one
typing defect: GPU-local parameter annotations must constrain the body during elaboration. That was
fixed without changing host annotation safety. The raymarcher exposed only an accidental use of GPU
tuple arithmetic in host input code; ordinary scalar Workman code was the correct fix.

V3 therefore remains the slice originally scoped: a pinned Slang builtin bridge plus the language
service and evidence needed to make it dependable. Textures, matrices, integer representations,
module-level shader helper cloning, multipass rendering, and a compiler-owned ShaderToy runtime
remain outside V3.
