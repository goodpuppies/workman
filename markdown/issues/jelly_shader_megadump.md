# jelly_shader megadump

Status: triage raw material. Each section lists issues found while building
the `examples/wmslang_window/src/jelly_shader.wm` port (glass jelly cubes
raymarcher) plus the N-ADT/product compiler work and the specialization
dedup work it forced. Nothing here is de-duplicated against existing docs;
convert entries to individual issues as needed.

Conventions below: `[FIXED]` means resolved in the worktree, `[OPEN]`
means still true, `[DEBT]` means known-bad architecture we should replace
rather than patch.

## Fixed during this work

### [FIXED] Single-ADT limit in wmslang slices
`src/wmslang/v2_loader.ts` rejected `adts.length > 1`; the normalizer only
allowed nullary-or-one-`Number` payloads. Any shader needing two small enums
(game state + material tags) was unrepresentable.
Resolution: N non-generic ADTs; payloads `Number | Bool | (nested) tuple`;
flat multi-binder arms plus grouped call form `Hit((a, b))`; per-layout
field scoping and typed zero values in `tooling/wmslang/slice_emit.wm`;
lane-indexed payload reads in `slice_lower.wm`.
Covered by: `two reachable ADTs with Bool and tuple payloads` backend test.

### [FIXED] No heterogeneous products (multi-return SDF hits)
`map(p) -> (distance, id, point)` had no representation: homogeneous tuples
default to vectors, so mixed tuples collapsed lanes in the numeric solver
(`gpu.numeric.conflict`) or failed HM (`GPU vector tuple component` forcing
a nested tuple to `Number`).
Resolution: heterogeneous = product (tuple rows that fail
`allSemanticNumbers`); tuple-expression/pattern merging scoped to vectors
only in `slice_numeric.wm`; per-lane resolution through
tuple/if/block/call/var/copy in the solver; GPU dialect claims vectors only
for all-concrete-numeric tuples, with legacy HM forcing gated behind
`InferModuleOptions.legacyGpuVectorTuples` (H0 research fixtures only).
Covered by: `helpers return heterogeneous product tuples` backend test.

### [FIXED] 556 specialization instances (122s compile)
V4 worklist key was `binding<args>@parentInstance:callNode`, so children
re-specialized per parent instance (`scene×33` → `rotate×132`). Measured:
19,024 exprs, ~100s in `compileGpuSlice`, 276KB WGSL.
Resolution: key is now `(binding, canonical arg types, syntactic rep
seeds)` per GLML's `(name, concrete_ty)` pattern, adapted to host HM's
single `Number` (`twice(2)` vs `twice(2.0)` split on seeds). Unknown seeds
share optimistically; a genuine mixed-representation conflict pins the
implicated multi-call bindings to per-site instances and retries in
`materialize.ts`. Now: 15 instances, ~1k exprs, ~3s compile, 16KB WGSL.
Covered by: seed/pin unit tests, mixed-uniform retry backend test.

### [FIXED] Stale block-item ids with branch-local lets (latent)
`blockExpr` in `src/wmslang/v2_normalize.ts` captured `itemId` before
normalizing the value, so a `let` whose value contained nested blocks reused
an id (`duplicate GPU slice block item`). Pre-existing; jelly's branch-local
lets (e.g. `let bands` inside an `if` arm used as a let value) were the
first to trigger it.

### [FIXED] Dropped `value.tag` assignment in ADT emit
Refactor of constructor field emission dropped the tag line; Mandelbrot
rendered black. Caught only by the real-adapter render test. Lesson already
known: codegen changes need render coverage, not just golden snapshots.

### [FIXED] Synthetic binding ids collide across modules
`#nextSyntheticBindingId` started at the *shader module's* local max, so
per-instance synthetic ids landed on later modules' source ids inside the
program-wide `gpuOnlyBindings` set. Splitting jelly into shader+host modules
misflagged `drainEvents` & co as GPU-only (`gpu.fragment.host-call`).
Single-module programs were immune by luck. Resolution: allocate from the
global high-water mark over all modules' locals, with comment.
Covered by: `jelly host module drives the imported fragment` test
(`coreFile` through the import).

### [FIXED] Port bugs: degrees vs radians, rotation composition, Y flip
- Original `r2d` takes degrees; the port passed `14.0 * time` etc. straight
  to `sin`/`cos` (57x spin, temporal aliasing). Fixed with `radians()`.
  Only the four `r2d` angles were degrees; all other time coefficients were
  already radians.
- `pbox.xz *= m` then `pbox.yz *= m` mutates in place; the port fed the
  *original* z into both stages. Second stage must read the rotated z lane.
- WebGPU `SV_Position` is top-left origin; Shadertoy `fragCoord` is
  bottom-left. Mirrored y in-shader (compiler passes raw position by design).

### [FIXED] `Result.andThen` frame loops overflow the stack
Chaining frames with synchronous `Result.andThen` grows one JS frame per
frame; jelly died at ~230s, `main.wm` dies at ~36s. Fix: cross one `Task`
(Promise/microtask) boundary per frame. `main.wm` still has the broken
idiom (see open issues).

### [FIXED, footgun documented] `Task.fromResult` unpacks
`Task.fromResult : Result<a,e> -> Task<a,e>` lifts the *payload*, it does
not preserve the `Result` as the value. `Task.fromResult(Err(e))` has
unknown value type; joining it with `Ok(void)` branches yields `Void`, and
matching that downstream is (correctly!) rejected. The fix is
`Task.succeed`, which wraps without unpacking. Inference was right; the
combinator choice was wrong. This will bite again.

## Open: language limits that shaped the port

### [OPEN] No imported/shared shader helpers
GPU-called helpers must be lexically inside the selected `@gpu` root
(`gpu.function.unsupported` otherwise). Every shader copy-pastes its
noise/SDF helpers per root; no shader library is possible. The
jelly/host split works only because *nothing GPU* crosses the boundary
(opaque fragment + nominal uniforms). `v2_normalize.ts` still rejects
cross-module factories (`gpu.fragment.cross-module`).

### [OPEN] No records in shader bodies
Only tuples/ADTs/scalars. SDF hit structs, material params, ray bundles
must be positional tuples. Named-field access (`.x` on a struct) does not
exist in-shader.

### [OPEN] Single-lane projections only
`vectorProjectionExpr` accepts exactly one of `x/y/z/w`. Multi-lane reads
(`p.xz`, `e.xyy`) must be spelled lane by lane; swizzle-assign has no
equivalent (must rebuild the vector).

### [OPEN] No literal/guard/nested patterns in matches
`match` needs one top-level arm per constructor with wildcard/direct binders
only. `firstId == 3` style dispatch on numbers must go through if-chains or
an ADT conversion. No guards, no literal patterns, no nested
`Escaped((x, y))` (whole-payload binder + `let`-destructure instead).

### [OPEN] Recursion is single direct self-tail only
`gpu.recursion.mutual` / `gpu.recursion.non-tail` otherwise. March loops fit;
anything mutually recursive or result-transforming does not. No `for`
sugar: bounded loops are hand-rolled `rec` helpers threading all state
(march takes 7 params, occlude 8).

### [OPEN] Strict numerics, no promotion, no `u32`
`1 + 1.0`, `sin(1)`, `(1, 2.0)` are errors; explicit `Gpu.i32`/`Gpu.f32`
required. Texel dims, bit ops, and compute IDs have no `u32` home. Builtin
overloads must match exactly (e.g. `lerp(f32x3, f32x3, f32)` fails; the
scalar factor must be broadcast by hand to `(t, t, t)`).

### [OPEN] One nominal environment record, narrow resources
Fields: numeric/`Bool` uniforms plus sampled/sampler only. Generic/nested
records out. Every declared resource field must be *used* (else the
reflected WebGPU layout diverges). `rgba16float` only; nearest/linear
clamp-to-edge samplers only; `Sample`/`Load` only. No storage, no compute,
no user vertex stage, no matrices.

### [OPEN] Whole-program GLSL only, raylib seam is string surgery
`Gpu.shaderSource(GLSL)` emits one whole module; `glsl_stage.ts` excises the
vertex `main` by string matching (`void main` + `gl_Position` anchor) and
retargets `#version 460` to 330. A compiler per-stage entry would delete
that file. Uniform blocks need 420pack (beyond stock GL3.3 raylib context);
the `Shader` struct stays behind opaque numeric handles (no `null`/pointer
crossing the FFI).

### [OPEN] Textures don't cross the raylib boundary
Same handle problem as shaders: no texture-handle plumbing in the
`glsl_stage.ts` pattern, so jelly-equivalent detail textures are WebGPU-only
(port used procedural value noise instead of `iChannel0`).

## Open: architecture / tech debt

### [DEBT] Host HM erases what the GPU needs (the fundamental hack)
One host `Number` type; i32/f32 live as occurrence-local evidence. Any
identity computed from HM types alone (dedup keys, and anything future that
keys on types) is blind to rep differences. Current standing:
syntactic rep seeds in specialization keys + optimistic sharing +
conflict-driven pin-to-per-site retry. Deliberate stopgap until a deeper
rewrite (GPU HM dialect with int/float, or constraints in the type system).
See `gpuCallArgSeed`, `sharedConflictPins`, `InferModuleOptions.legacyGpuVectorTuples`.

### [DEBT] Middle-end is linear scans over lists, iterated to fixpoint
Profiled on jelly (pre-dedup): `findExpressionOccurrence` ~25% self,
`findExpression` variants ~30%, `__wm_is_tuple` ~27% (tag check per list
cell in generated JS), `shaderBuiltinTypeName` recomputed per catalog
*candidate* instead of per site (310 overloads walked per builtin site).
GLML does one-shot folds in native code with no fixpoint and no DTO
boundary. Still worth doing after dedup: hoist per-site name computation,
group the catalog by name, index id-lookups. Dedup masked the urgency;
the structure is still quadratic-ish underneath.

### [DEBT] Fixed-point solver scaling unproven at large sizes
`solveFixedPoint` recurses until no sweep changes anything; per-sweep cost
is linear-find dominated. Fine at ~1k rows now. No sweep budget, no
worklist ordering, no convergence diagnostics.

### [DEBT] `legacyGpuVectorTuples` + H0 frozen paths
The dialect's legacy HM forcing survives behind a flag used only by H0
research fixtures (`compileGpu`, schema-v1). H0 behavior is pinned by
`tests/wmslang_test.ts`, not by product need. Any future inference change
must check both modes.

### [DEBT] Numeric-solver caches add conceptual surface
`exprNodes`/`patternNodes`/`patternByBinding`/`lanes` maps in
`slice_numeric.wm` were added to claw back per-sweep walk costs. They helped
marginally (the heat was elsewhere); they now duplicate what the maps they
replaced did, with fallback paths. Revisit after the indexing work above;
possibly delete.

### [DEBT] `gpuOnlyBindings` is a program-wide mixed-namespace set
Fixed one collision (synthetic ids); the set still mixes source ids from
every module plus synthetic and inline (`-2` going down) namespaces by
convention only. Any new id source must be audited against all three.
Consider a namespaced or qualified identity.

### [DEBT] Specialization naming/numbering is unstable
`wm_f_N` ids and `__Suffix` names shift with instance count/order, so any
test asserting exact generated text is coupled to specialization behavior.
Prefer structural assertions (counts, presence) over golden WGSL.

### [DEBT] Conflict diagnostics don't name the merge point
`gpu.numeric.conflict` reports the two evidence spans (seed locations),
never the shared node/instance where they merged. The backstop works around
this by pinning every multi-call binding. If diagnostics carried the
instance id, retry could pin precisely instead of broadly.

### [DEBT] No artifact caching across runs
Every `wm run` re-materializes (now seconds for jelly, was minutes).
Iteration would benefit from content-addressed artifact caching; the
artifact digest work in `materialize.ts` is a start.

## Open: host loop, docs, process

### [OPEN] `main.wm` still has the overflowing `Result.andThen` loop
Measured death at ~36s. Same Task-boundary fix as jelly applies
(`Task.succeed` + `Task.andThen`, explicit step match). Left untouched as
someone's reference file; patch is in `jelly_main.wm:frameLoop` to copy.

### [OPEN] No documented host-loop idiom
Nothing tells authors that infinite loops must cross `Task` (async,
fresh-stack) rather than chain `Result` (sync, accumulating). The stack
guard's advice ("direct tail call or explicit loop") doesn't mention it.
Needs a docs section (carriers.md or a windowing guide) with the
`Task.succeed` + explicit-step-match pattern, including the
`fromResult`-unpacks footgun above.

### [OPEN] No jelly render test, only check-level
`tests/wmslang_window_example_test.ts` typechecks jelly and compiles
`jelly_main` through `coreFile` once. No pixel assertions (unlike
Mandelbrot/raymarch probes). Manual headless renders were used during
development (stats hashes recorded in chat, not in repo). A small probe
test (opaque + varying + top/bottom brightness ordering) would lock the
orientation and exposure behavior.

### [OPEN] Frontend golden churn on every new example
Any new `.wm` file breaks two golden suites until
`scripts/update_frontend_v2_semantic_golden.ts` runs, and the rejected-list
in the recognizer test is hand-maintained (already drifted once against
its own golden file for stageforge). Consider generating the rejected list
or failing with an actionable message.

### [OPEN] Fidelity gaps to the original nobody asked to close (yet)
- Procedural value noise instead of the `iChannel0` texture (different
  grain by design).
- Milliseconds-to-seconds time convention (`* 0.001`, matches the window
  examples, not the original's seconds).
- No mouse interaction (original has none either; noting so a future
  interactive port doesn't assume otherwise).

## Port notes that should survive (for whoever ports next)

- `r2d` takes degrees; everything else in the original is radians.
  Forgetting `radians()` spins the scene ~57x (temporal aliasing reads as
  horizontal explosion, not fast motion).
- GLSL `vec2 *= mat2(c,s,-s,c)` (column-major ctor) equals
  `(x*c - z*s, x*s + z*c)`. Verify lane signs, don't eyeball them.
- `pbox.xz *= …; pbox.yz *= …` is sequential mutation: stage two reads
  stage one's output lane.
- `isInside ? -1 : 1` times the merge maps to an `if` selecting
  `0.0 - softMin` vs `softMin`.
- `texture()` detail lookups need a procedural stand-in on paths without
  texture plumbing; `frac(sin(dot(p, (127.1, 311.7))) * 43758.5453)` plus
  bilinear `vnoise` is the established one.
- Unused `let` bindings vanish silently; thread state explicitly or lose it.
- `Gpu.f32`/`Gpu.i32` conversions are the only legal rep crossings; plan
  where counters meet distances (`occlude`'s `Gpu.f32(a)`).
