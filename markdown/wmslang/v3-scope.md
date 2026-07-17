# wmslang v3 Slang builtin bridge

Status: implemented and focused acceptance verified. See [`v3-audit.md`](./v3-audit.md). V3 adds a
principled bridge from GPU-contextual Workman calls to the pinned Slang
core-module builtin surface. It does not add a ShaderToy runtime, module-level shader helpers,
top-level shader constant cloning, textures, multipass rendering, automatic coercion, or general
optimization.

The scope is intentionally evidence-driven. Two substantial creative shaders are acceptance probes:
a warped-noise shader and a raymarcher. They must first be attempted using the completed V2 language
plus the builtin bridge. If a probe exposes another genuine compiler or language requirement, this
document must be amended explicitly before that requirement becomes V3 work. Convenience alone does
not expand the compiler slice.

## Intent

V1 proved immutable fragment compilation, a private ADT, and direct self-tail recursion. V2 made
fragment results ordinary RGBA tuples, added scalar/vector arithmetic and projection, established
GPU-local type ownership and hover, and bound one immutable nominal-record environment. Those
features are already sufficient to express substantial shaders, but creative shader programs still
lack the standard mathematical operations supplied by the target shader language.

V3 supplies those operations without designing a second, Workman-specific standard-math list.
Calls such as these refer to Slang builtins while they are inside a selected GPU island:

```workman
let shade = (uniforms: Uniforms) => {
  (coord) => {
    @gpu;

    let uv =
      (coord * 2.0 - uniforms.resolution)
      / uniforms.resolution.y;
    let wave = sin(length(uv) * 8.0 - uniforms.time);
    let edge = smoothstep(0.2, 0.8, wave);
    (edge, edge, edge, 1.0)
  }
};
```

There is no `#fn` syntax. GLML's `#sin`, `#length`, and similar forms are explicit references to
its fixed GLSL builtin enum; the marker is not an intrinsic part of functional shader programming.
Workman instead uses its existing call syntax and the lexical GPU domain to decide which name
environment is available.

## Core rule

Wmslang supports every pinned Slang builtin overload that satisfies all of these conditions:

1. its parameters and result can be represented by the current wmslang type algebra;
2. it is a direct pure value operation and needs no pointer, `ref`, `out`, or `inout` semantics;
3. it is legal for the selected shader stage and the configured WebGPU/WGSL target capabilities;
4. its overload can be selected by Workman's GPU elaborator without an implicit numeric conversion;
5. it can be expressed in the typed functional IR without adding a hidden effect or mutable source
   operation.

Eligibility is structural, not a handwritten allowlist of desirable math names. When the wmslang
type and capability systems later acquire matrices, textures, samplers, integer representations, or
other shader facilities, more overloads from the same Slang catalog may become eligible without
inventing a parallel Workman intrinsic namespace.

The initial representable value universe remains the completed V2 universe: `f32`, `Bool`,
homogeneous `f32` vectors of width 2--4, supported immutable products/ADTs, and direct first-order
GPU-local functions. V3 does not add scalar representations or aggregate kinds merely because the
Slang core contains overloads using them.

This rule admits ordinary pure scalar/vector creative operations when their Slang signatures fit.
It can also admit fragment derivatives when their signatures fit and Slang marks them legal for the
fragment/WGSL target. It initially excludes, by structure rather than name:

- texture and sampler operations, because V3 has no resource types;
- atomics, stores, barriers, and other effectful operations;
- pointer, reference, output-parameter, and mutable-receiver operations;
- matrix overloads before wmslang has a matrix representation;
- integer-only, bit-level, and conversion overloads before their representation design;
- subgroup, mesh, ray-tracing, and target-specific facilities whose capabilities are unavailable;
- builtin values used as higher-order functions rather than called directly.

## Slang-owned vocabulary

The source spelling is the canonical spelling exposed by the pinned Slang core module. Wmslang does
not create a GLSL compatibility vocabulary simply because GLML targets GLSL. For example, if the
pinned Slang surface calls an operation `frac`, `lerp`, `ddx`, or `fmod`, Workman code uses that
spelling. A GLSL name such as `fract`, `mix`, or `dFdx` is available only if it is independently
present in the pinned Slang surface.

Likewise, V3 does not define a `Gpu.Math`, standard-library import, or compiler-authored list of
functions whose implementation happens to emit Slang. The builtin identity retained in typed IR is
the resolved Slang declaration/overload identity, not merely a source string.

This does not make arbitrary Slang source visible to Workman. Users cannot import `.slang` modules,
embed raw Slang, name Slang types that Workman cannot represent, or depend on an unpinned system
installation.

## Contextual name resolution

Name lookup inside a GPU island follows this order:

1. resolve lexical Workman bindings normally;
2. for an otherwise unresolved name in direct call position, consult the pinned Slang builtin
   catalog;
3. elaborate the arguments and select one eligible overload;
4. retain the selected builtin identity and concrete argument/result types in functional IR;
5. emit the canonical Slang call and let the pinned backend validate the completed module.

A lexical Workman binding shadows a same-named Slang builtin. The compiler never silently chooses a
builtin when an authored binding resolved successfully, even if the authored value is not callable
with the supplied arguments.

Builtin fallback exists only in a GPU-owned expression. The same unqualified name in host code is
unresolved unless an ordinary Workman declaration or import supplies it. Consequently one source
function does not acquire simultaneous CPU and GPU interpretations, and host HM inference does not
gain Slang overloads.

V3 supports builtin calls, not first-class builtin function values. A builtin name without a direct
application cannot be returned, stored, passed as an argument, partially applied, or captured.
Higher-order shader values remain a separate future feature.

## Pinned generated catalog

Workman must know builtin signatures before Slang emission so source typing, diagnostics, hover, and
completion do not depend on a backend failure. That knowledge comes from a versioned catalog derived
from the pinned Slang core-module surface, not from a manually maintained enum modeled after GLSL.

The checked-in catalog records at least:

- canonical source name and stable overload identity;
- parameter and result signature patterns;
- scalar/vector shape relations used by overload selection;
- parameter modes needed to reject `ref`, `out`, and `inout` operations;
- purity/effect eligibility needed by the immutable functional IR;
- stage and target capability requirements available from the pinned Slang surface;
- the Slang version and core-module/toolchain identity from which it was produced.

Catalog generation is a development/build operation. It may use the pinned Slang tooling and its
core-module declarations, but normal Workman compilation and language-server analysis consume the
checked-in deterministic result. In particular, editor hover and completion must not download or
load `slang-wasm`, create temporary files, or ask Slang to infer the Workman program on every edit.

Regenerating the catalog with the same pinned inputs must produce identical bytes. A Slang upgrade
changes the recorded toolchain identity and catalog together. Tests must reject a catalog whose
schema or pinned identity disagrees with the compiler/backend configuration.

The extraction mechanism may normalize Slang generic/overloaded declarations into a smaller
declarative signature-pattern schema. That normalization may discard declarations outside the
representable functional category, but it must do so by documented signature, parameter-mode, type,
effect, or capability rules rather than by a hand-selected set of function names.

## Workman-owned overload elaboration

Slang remains the final backend validator, but it does not decide the source type of a Workman
expression. GPU elaboration selects the builtin overload and returns a concrete occurrence type
before functional lowering.

The initial numeric policy remains strict:

- every accepted numeric occurrence is `f32`;
- vector widths must agree wherever the builtin signature relates them;
- scalar/vector behavior is accepted only when the Slang signature pattern permits it;
- no integer literal is silently promoted to `f32` for a builtin;
- no widening, narrowing, or inserted conversion is introduced;
- ambiguity or absence of an exact eligible overload is a Workman source diagnostic.

An ordinary annotation on a GPU-local helper parameter is elaboration evidence while that helper's
body is checked. For example, `(p: (Number, Number)) => { floor(p) }` selects the vector family
rather than defaulting an otherwise unconstrained occurrence to the scalar family. This does not
change host annotation safety: host annotations remain post-inference checks and do not become
casts or JS/JSON receiver assertions.

The typed functional IR gains a semantic builtin-call node carrying the selected catalog identity,
argument occurrence IDs, concrete argument/result type IDs, and source span. It does not store an
unvalidated string call or defer overload selection to generated Slang. Lowered IR and emission
preserve the chosen operation and evaluation order.

Constant folding, algebraic simplification, common-subexpression elimination, and other
optimizations are not required. The Slang backend may perform its normal target optimizations after
Workman has fixed the source meaning.

## Diagnostics and language service

Builtin analysis participates in the existing GPU occurrence and evidence machinery. At minimum,
V3 distinguishes:

- an unknown GPU call name, with a nearby builtin suggestion when one is unambiguous;
- a known Slang builtin for which no eligible overload matches the argument types;
- a known declaration whose signature uses a type or parameter mode unsupported by wmslang;
- an otherwise representable overload unavailable in the selected stage or WGSL target;
- an ambiguous overload that Workman's strict representation rules cannot resolve;
- a generated-catalog/backend disagreement, which is an internal compiler error retaining the
  Workman call span and generated Slang evidence.

Ordinary source mistakes should fail before Slang generation. Backend validation remains necessary
to catch compiler/catalog drift and target legalization failures, but it is not the normal overload
checker.

Hover on a successfully selected call or builtin name shows the concrete selected GPU signature.
When arguments are incomplete, hover may show the eligible overload family, but it must identify the
result as GPU/Slang contextual rather than an ordinary host type. Failed elaboration retains the
existing visible `unresolved GPU type` behavior and publishes the underlying builtin diagnostic.

Completion inside a GPU island includes eligible builtin names and signatures appropriate to the
current stage and representable type universe. Lexical Workman names retain normal precedence.
Completion outside a GPU island does not advertise Slang builtins. This is the first required
builtin-completion slice; it need not become general signature help or a complete Slang language
service.

## Creative acceptance probes

The GLML examples demonstrate that the completed V2 language already contains much of the hard
creative-shader structure: immutable local bindings, vector arithmetic, records/ADTs, branches,
tail-recursive loops, and pure color results. Their most common missing facility is builtin math.

V3 uses two ports to test that claim.

### Warped noise

Port GLML's single-pass warped-noise example into a selected Workman fragment using:

- only local GPU helpers and local constants;
- a normal curried V2 uniform environment for resolution/time where needed;
- canonical pinned Slang builtin spellings;
- no raw Slang, builtin aliases, module-level helper cloning, or application-specific compiler hook.

This probe stresses overloaded scalar/vector elementary functions, fractional/remainder behavior,
interpolation, vector geometry, animated palette work, and nested local helper calls.

### Raymarcher

Port one substantial single-pass GLML raymarching example and render it through the existing real
WebGPU presentation path. It should exercise vector geometry, normalization/dot/distance-like
operations, SDF composition, time or mouse-driven uniforms, immutable ADTs/branches where useful,
and tail recursion for bounded marching.

The port should remain recognizable, pleasant Workman rather than scalar-expanded generated-looking
code. It may use ordinary user code for windowing, input, frame timing, uniform construction, and
WebGPU presentation.

### Probe-driven amendments

A failed port does not automatically add its desired feature to V3. Classify each blocker first:

1. **Builtin bridge defect:** a representable pure Slang overload is missing, typed incorrectly, or
   emitted incorrectly. Fix it within V3.
2. **Existing-language defect:** V2 promised the construct but its implementation fails. Fix the
   regression within V3.
3. **User-library concern:** input policy, window lifecycle, reusable runner structure, or application
   composition. Implement it as ordinary Workman code or leave it to the example/library.
4. **New shader capability:** textures, matrices, integers, higher-order values, module-level GPU
   cloning, general captures, or another unscoped feature. Record the finding and amend this scope
   only after a separate design decision.
5. **Convenience:** shorter spelling or reuse that is not needed to express the shader. It does not
   block V3 acceptance.

This makes the ports useful evidence about the next slice instead of allowing them to turn V3 into
an open-ended attempt to reproduce ShaderToy, GLSL, or all of Slang.

## User-code boundary

V3 does not prescribe a ShaderToy runtime API. A record containing resolution, time, frame number,
mouse position, or button state is an ordinary Workman record. SDL event processing, immutable frame
loops, WebGPU surface setup, resizing, and calls that bind a new environment value are ordinary
Workman application or library code.

A reusable local-playground library may be built from those pieces without compiler support. Its
shape, naming, coordinate convention, and reload policy are not wmslang semantics. The existing SDL
Mandelbrot application remains valid evidence that this host-side division works.

Similarly, V3 does not require module-level GPU helpers or cloning top-level constants. Helpers and
constants may be defined lexically inside the GPU function as V2 permits. Those broader reuse
features can be scoped later if real programs demonstrate that nesting is materially limiting.

## Non-goals

- a compiler-owned ShaderToy input record, render loop, window runner, or hot-reload supervisor;
- a handwritten Workman/GLSL math intrinsic list or `#fn`-style syntax;
- GLSL aliases for Slang names absent from the pinned core module;
- arbitrary Slang imports, raw Slang expressions, or exposing the entire Slang language surface;
- asking Slang or Slang reflection to infer Workman source types;
- loading the Slang compiler during ordinary LSP typing, hover, or completion;
- implicit numeric coercion, integer representations, or conversion insertion;
- matrices, textures, samplers, storage buffers, image loading, or resource methods;
- multipass rendering, feedback buffers, persistent ping-pong targets, or a pass graph;
- module-level shader helper reuse, imported GPU helpers, or top-level constant cloning;
- higher-order builtin/function values, partial application, or general closure conversion;
- atomics, barriers, mutation, derivatives with unavailable stage/target capability, or other hidden
  effects;
- additional fragment roots, user-authored vertex stages, or compute shaders;
- compiler optimization beyond the existing lowering and the pinned Slang backend.

## Acceptance

V3 is complete when focused tests prove all of the following:

1. A reproducible catalog derived from the pinned Slang core module is checked in, records its
   toolchain identity, and is rejected when that identity or its schema disagrees with the backend.
2. An unqualified direct call inside a selected GPU island resolves to an eligible Slang builtin,
   while the same unbound name in host code remains unresolved and a lexical Workman binding
   shadows it.
3. Representative unary, binary, and ternary scalar/vector builtin overloads elaborate to concrete
   Workman-owned GPU types, survive typed functional/lowered IR with stable builtin identities, and
   emit canonical Slang calls.
4. Strict overload behavior rejects mismatched widths, unsupported scalar representations,
   ambiguity, and calls that would require implicit coercion before Slang generation.
5. Known but ineligible declarations report whether their blocker is type representation,
   parameter mode/effect, stage, or target capability rather than appearing to be unknown names.
6. Builtin names cannot escape direct call position or become higher-order shader values.
7. Hover reports selected builtin signatures, GPU-local completion advertises eligible catalog
   entries, host completion does not, and neither path loads Slang, writes temporary files, or
   creates WebGPU state.
8. Misspelled names and invalid overloads publish source-local diagnostics with useful suggestions
   or candidate information. Forced catalog/backend drift retains both the Workman call anchor and
   backend evidence.
9. The warped-noise probe compiles and renders through real WebGPU using local helpers/constants and
   the canonical Slang builtin vocabulary.
10. The raymarcher probe compiles and renders through real WebGPU, including immutable bounded
    marching and dynamic V2 uniforms, without shader-specific host side channels.
11. Existing focused V1/V2 shader, LSP, WebGPU render, and SDL-window gates remain green. The
    repository-wide long-running test suite is not required for the focused V3 iteration gate.

Any new capability discovered by requirements 9 or 10 must be recorded as a scoped amendment or
deferred follow-up before V3 can claim it.
