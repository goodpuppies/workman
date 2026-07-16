# wmslang v2 acceptance evidence

Status: all sixteen requirements in [`v2-scope.md`](./v2-scope.md) have focused implementation and
runtime evidence. This is the audit index; it does not expand V2 beyond that scope.

| Requirement | Authoritative evidence |
| --- | --- |
| 1. Pure RGBA tuple | `visual-v1 renders the flat-color artifact as opaque red` compiles the pure tuple fixture and checks every rendered pixel. |
| 2. Vector arithmetic | `schema v2 lowers GLML-style vector arithmetic and scalar broadcasts` checks exact vector-typed multiply/subtract operations and emitted Slang. |
| 3. Broadcast and width rejection | The same fixture proves both operand orders; `schema v2 vector rules do not leak into host code or resize widths` rejects mismatched widths at source analysis. |
| 4. Destructuring lane order | `schema v2 tuple destructuring preserves vector lane order` checks lowered projection indices and emitted `.x`, then `.y`, order. |
| 5. Concrete Slang vectors and pure return | The flat-color golden contains `float2`/`float4` signatures and returns the root result directly from `wm_fragment`. |
| 6. Mandelbrot ADT and recursion render | `visual-v1 renders stable Mandelbrot probes from the f32 CPU oracle` runs the real adapter gate after pure-result migration. |
| 7. Diagnostic anchors | The non-tail fixture checks the call and declaration spans; backend attribution checks the selector and selected root. |
| 8. Host isolation | The vector-isolation fixture rejects host tuple arithmetic while the corresponding GPU operations compile. |
| 9. Workman-owned type elaboration | `schema v2 round-trips through the real Workman wmslang ABI` checks semantic input rows, concrete output rows, evidence, occurrence completeness, and the type-only entry. |
| 10. Lexical helper ownership | The lexical-ownership negatives reject top-level/capturing/escaping helpers; the Mandelbrot fixture proves its local self-tail-recursive helper lowers to one loop. |
| 11. Contextual hover | Hover fixtures check `coord: f32x2`, uniform fields and lanes, GPU-local helper signatures, and ordinary host tuple types. |
| 12. Visible failed elaboration | Cross-domain validation publishes a source-local error; a failed type-only elaborator publishes warning `gpu.type.unresolved`, while hover shows `unresolved GPU type`. Neither path loads Slang or WebGPU, and the successful hover path is tested with filesystem writes denied like the VS Code server. |
| 13. Restricted curried boundary | Curried positives compile; marked outer factories, extra captures, unsupported fields, and a shape-compatible wrong nominal record fail. |
| 14. Immutable per-frame binding | The bound-fragment runtime fixture proves one identity/WGSL and distinct copied byte arrays. The SDL window compiles one renderer/pipeline, calls `GPUQueue.writeBuffer` per frame, and remains live in the real runtime smoke. |
| 15. Reflection and identity rejection | Reflection mismatch tests fail before presentation. WGSL-identical factories with different source/schema identity receive different artifact IDs, and the Workman renderer compares that identity before upload or draw. |
| 16. SDL2 mouse Mandelbrot | The executable window fixture compiles SDL polling, signed mouse motion, relative mode, immutable CPU tail loops, bound-fragment packing, uniform upload, and independent shader tail recursion. |

## Focused gate

Run from the repository root:

```sh
deno test -A \
  tests/gpu_selection_test.ts \
  tests/wmslang_v2_slice_test.ts \
  tests/wmslang_slang_backend_test.ts \
  tests/wmslang_webgpu_render_test.ts \
  tests/wmslang_window_example_test.ts \
  tests/lsp_hover_test.ts \
  tests/lsp_test.ts

deno run -A src/main.ts check examples/wmslang_window/src/main.wm
deno run -A src/main.ts run examples/wmslang_window/src/main.wm
```

The final command is an interactive window and intentionally runs until the user quits. Automated
smoke verification may place it under a timeout and treat continued execution until that timeout as
success. The repository-wide `deno task test` is not part of this focused gate.
