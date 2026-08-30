# Workman wmslang compiler core

This directory is the bootstrap boundary for the pure Workman shader compiler. TypeScript owns the
live host compiler state and normalizes final inference into the schema-v2 selected-program DTO in
`src/wmslang/v2_dto.ts`. `compiler.wm` consumes only those JavaScript-native records and arrays.

Build the ignored, reproducible ES library with:

```sh
deno task wmslang:build
```

The generated `wmslang.generated.mjs` exports the production `compileGpuSlice(input)` entry. Load it
through `src/wmslang/v2_loader.ts`, which validates both input and output schema shapes. Normal CLI
and LSP use stores the validated generated source in CacheStorage under a digest of the compiler
inputs; a source or host-compiler edit therefore performs one bootstrap rebuild and subsequent
processes reuse it. Tests may still compile the Workman entry into a temporary library to verify the
bootstrap rather than trusting the cache. The older `compileGpu(input)` export and schema-v1 loader
remain H0 research fixtures only.

Current H0 responsibilities:

- accept stable function, binding, type, expression, and span IDs;
- register functions deterministically in the persistent standard `Map`;
- solve the initial monotone `i32`/`f32` representation constraints through arithmetic and
  tuple-vector construction, scalar/vector broadcast, value-flow nodes, and resolved calls;
- isolate numeric representation IDs by binding/expression occurrence so unrelated roots do not
  exchange evidence through the shared host `Number` shape;
- default only numeric types left abstract after the fixed point;
- reject duplicate function IDs;
- close the call graph from GPU roots by resolved function/binding IDs, including imported helpers;
- classify reachable candidates as `gpu-eligible` and unused candidates as `cpu-only`;
- diagnose reachable expressions classified as host FFI or outside the current GPU subset;
- close and deduplicate captures independently for each GPU root while excluding parameters and
  lexical `let` binders;
- classify conservative numeric/boolean/vector constants, runtime uniforms, reachable functions, and
  illegal CPU or non-reifiable captures;
- instantiate fixed-shape numeric helpers from reachable call signatures, deduplicate equal
  instances across roots, and register before descending to guard direct recursion;
- return per-specialization representation overlays plus explicit root and call-target tables;
- reject mutual recursion until its lowering semantics are implemented;
- clone each specialization into typed functional function/expression tables with concrete
  representations, source provenance, resolved calls, and local/capture/function value origins.

These H0 responsibilities are not the v1 product contract. Visual v1 instead takes the much smaller
schema-v2 slice through one static same-module fragment, semantic `number`/tuple input shapes, one
option-like ADT, immutable control flow, and direct self-tail recursion. V2 additionally accepts one
restricted curried nominal-record environment: ordered field reads remain explicit `uniform` nodes
through functional IR and lowering, and this Workman emitter creates the fixed Slang constant
buffer. Artifact-bound values, reflection-checked host packing, and renderer upload remain outside
this pure core and are now implemented by TypeScript materialization/Core emission plus the Workman
window presenter. Automatic coercion, general resources, `u32`/compute work, the broader promotion
vocabulary, HM-shape specialization, and higher-order closure work remain deferred. The visual
product boundary is in `markdown/wmslang/v1-scope.md`; its
Workman basis and fixed fullscreen backend are in `markdown/wmslang/v1-basis.md` and
`markdown/wmslang/v1-backend.md`. The exact release fixtures are in
`markdown/wmslang/v1-acceptance.md`. The library must not import live TypeScript compiler state or
call back into inference. The selected-program DTO and typed functional IR are now schema v2.
`slice_ir.wm` first elaborates semantic types into a separate concrete `f32`/vector/product table and
evidence rows entirely in Workman; the normalizer never emits those shader kinds. The exported
`elaborateGpuSliceTypes(input)` path also returns stable expression, pattern, and function occurrence
rows without running functional lowering or Slang emission, for language-service use. The full
compiler then folds
immutable blocks, retains restricted ADT matches, and validates direct self-tail
recursion as specified in `markdown/wmslang/v1-functional-lowering.md`. The closed v1 operator rows are specified in
`markdown/wmslang/v1-operations.md`; Slang's larger overload set must not leak back across this
boundary. Expanded uniform, numeric, capture, and diagnostic designs in their respective `v1-*.md`
files are deferred references where they exceed `v1-scope.md`. Static fragment-root selection and
host artifact isolation are specified in `markdown/wmslang/v1-entry.md`; the complete ordered
handoff is `markdown/wmslang/v1-readiness.md`.
