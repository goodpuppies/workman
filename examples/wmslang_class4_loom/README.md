# wmslang SKI soup

This V5 feedback experiment begins with the smallest useful picture: full-screen RGB noise where
every pixel is one combinator.

- red is **S**;
- green is **K**;
- blue is **I**.

The seed is deterministic, generated independently by every fragment, and strictly one-hot—there are
no visible colors other than the three tokens. The hidden alpha channel gives each token one of four
uniformly seeded orientations and one of four update clocks. Subsequent passes apply a tiny spatial
analogy of each combinator inside that private coordinate frame: `I` moves forward, `K` selects the
reverse stream, and `S` alternates between the two sideways branches. Orientation and clock remain
encoded with the token state, so no screen direction is globally assigned to a combinator and the
field does not reduce in one synchronized pulse.

Each completed reduction also turns its private orientation 90 degrees. The token and clock decide
whether that turn is left or right, keeping handedness balanced across the soup. Orientation thus
acts more like changing momentum than permanent crystal grain: even locally settled regions keep
redirecting their transport instead of freezing into a static reef.

Unlike tokens create the missing third token when they collide: S+K produces I, K+I produces S, and
I+S produces K. This rule is symmetric under renaming the colors. It lets the soup create local
novelty rather than inevitably coarsening through copying alone, while preserving the one-hot RGB
invariant.

Moving the mouse stirs the soup. SDL's relative motion vector is clamped and, for six feedback
steps, rotated four different ways across the field. This produces a local-looking shuffle while
preserving the one-hot token invariant. It can tear open new fronts in regions that are settling;
sampling beyond the texture edge still feeds the slowly advancing black void.

This is intentionally not claimed to be a formal SKI evaluator. Real combinator reduction also needs
application topology, which three color channels do not encode. It is a minimal visual substrate for
exploring what representation should come next, while keeping the GPU-as-monkeys idea visible and
immediate.

From the `wm-mini` repository root:

```sh
deno run -A src/main.ts run examples/wmslang_class4_loom/main.wm
```

Resize the window to generate a fresh field. The example reuses `examples/wmslang_window/SDL2.so`;
see that example's README for setup.
