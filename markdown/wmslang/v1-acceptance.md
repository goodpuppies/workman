# wmslang visual acceptance slice

Status: the executable v1 vertical-slice fixtures, migrated to the pure-result surface and vector
representation introduced by [`v2-scope.md`](./v2-scope.md). The original nominal-color contract
remains documented historically in [`v1-scope.md`](./v1-scope.md).

The positive programs use current Workman syntax and the compiler-owned fragment selector. They
must parse and pass ordinary Workman HM inference before GPU capability/lowering begins. Tests must
not prepend authored mock `Gpu` definitions.

## A1: `flat_color.wm`

This is the smallest end-to-end compiler/backend/artifact smoke test.

```workman
let flatShade = (_coord) => {
  @gpu;

  (1.0, 0.0, 0.0, 1.0)
};

let flatFragment = Gpu.fragment(flatShade);
```

Required assertions:

- one root is selected and no shader capture is present;
- generated Slang contains `wm_vertex` and `wm_fragment`;
- Slang produces non-empty WGSL accepted by WebGPU;
- generated JavaScript embeds the completed artifact and no executable copy of `flatShade`;
- a `16x16` `rgba8unorm` render produces opaque red at every pixel.

This fixture is a development gate, not the semantic definition of done.

## A2: `static_mandelbrot.wm`

This one program is the semantic center and release gate. It uses only shader `f32` numbers, fixed
image dimensions, immutable locals, a private option-like ADT, exhaustive matching, and direct
self-tail recursion.

```workman
type Escape = Inside | Escaped<Number>;

let rec escapeIterations = (cx, cy, zx, zy, remaining) => {
  if (remaining <= 0) {
    Inside
  } else {
    let magnitudeSquared = zx * zx + zy * zy;

    if (magnitudeSquared > 4.0) {
      Escaped(remaining)
    } else {
      let nextX = zx * zx - zy * zy + cx;
      let nextY = 2.0 * zx * zy + cy;
      escapeIterations(cx, cy, nextX, nextY, remaining - 1)
    }
  }
};

let mandelbrotShade = (coord) => {
  @gpu;

  let (x, y) = coord;
  let cx = (2.0 * x - 64.0) / 48.0 - 0.5;
  let cy = (2.0 * y - 64.0) / 48.0;
  let escape = escapeIterations(cx, cy, 0.0, 0.0, 96);

  match(escape) {
    Inside => {
      (0.0, 0.0, 0.0, 1.0)
    },
    Escaped(remaining) => {
      let amount = remaining / 96.0;
      (amount, 0.25 * amount, 1.0 - amount, 1.0)
    }
  }
};

let mandelbrotFragment = Gpu.fragment(mandelbrotShade);
```

The integral-looking literals `0`, `1`, and `96` are shader `f32` under the v1 fixed numeric
dialect. No integer conversion, numeric representation solver, or compiler-supplied math intrinsic
participates.

Required compiler/lowering assertions:

1. The selected program contains `mandelbrotShade`, `escapeIterations`, and `Escape`, with no host
   values or unrelated module declarations.
2. `Inside` and `Escaped` receive declaration-order tags `0` and `1`.
3. The ADT payload is one private `f32` slot and never enters the public artifact.
4. The match evaluates `escape` once, switches on the tag, and reads the payload only in the
   `Escaped` arm.
5. The recursive call is marked as a direct self-tail call.
6. All five next arguments are evaluated before any loop parameter update.
7. Generated Slang/WGSL contains a loop and no self-call from `escapeIterations`.
8. There is no generated resource binding, uniform, storage buffer, texture, or sampler.

Required render assertions:

- render to `64x64 rgba8unorm` with a full-target viewport and scissor;
- compare stable interior/exterior probes selected by a CPU implementation of the exact 96-step
  recurrence and coordinate transform;
- choose probes with a neighborhood margin so small cross-device floating differences at the fractal
  boundary cannot flip the expected classification;
- require at least two interior and four exterior probes;
- retain generated Slang and WGSL when a render or backend assertion fails.

The focused real-adapter gate uses interior probes `(43, 31)` and `(44, 32)`, and exterior probes
`(2, 2)`, `(61, 2)`, `(2, 61)`, and `(61, 61)`. Coordinates are zero-based pixel indices; the CPU
oracle evaluates their pixel centers. Every probe's surrounding `3x3` neighborhood has the same
oracle classification.

The CPU oracle selects and documents probes; it cannot replace the real adapter render.

## N1: `non_tail_recursion.wm`

```workman
let rec nonTail = (value) => {
  if (value <= 0) {
    0
  } else {
    1 + nonTail(value - 1)
  }
};

let illegalFragment = Gpu.fragment((coord) => {
  @gpu;

  let (x, _y) = coord;
  (nonTail(x), 0.0, 0.0, 1.0)
});
```

This fails with `gpu.recursion.non-tail` at the recursive call before Slang generation. A related
source anchor identifies the recursive declaration. It must not surface as a backend recursion
error.

## N2: excluded capture

```workman
let makeIllegal = (hostValue) => {
  let fragment = Gpu.fragment((_coord) => {
    @gpu;

    (hostValue, 0.0, 0.0, 1.0)
  });

  fragment
};
```

This fails at the free occurrence of `hostValue`. V1 does not infer a uniform, serialize a static
value, or specialize the artifact by runtime input.

## N3: ordinary Workman isolation

A focused existing non-GPU program containing lambdas, records, ADTs, recursion, FFI, and same-named
ordinary functions retains its existing inference and JavaScript behavior. In addition:

- an unselected `@gpu` lambda produces no backend artifact;
- GPU-only basis operations do not become ordinary host functions;
- Core rejects a raw reachable GPU lambda/reference if artifact materialization did not complete;
- emitted JavaScript for a successful artifact contains WGSL and no GPU surface AST/body.

## Completion rule

Green schema/IR/golden tests and the flat-color render are necessary stepping stones. V1 is complete
only after `static_mandelbrot.wm` passes the compiler assertions and a real-adapter render in at
least one supported environment.
