# wmslang SKI brain

This V5 feedback experiment uses four completely visible states:

- red is active **S**;
- green is cooling **K**;
- blue is refractory **I**;
- black is empty space.

There is no hidden alpha memory, orientation, clock, genome, autonomous perturbation, or preferred
direction. Every fragment applies the same isotropic rule to its eight neighbors:

```text
S → K
K → I
I → black
black → S when exactly two neighbors are S
```

The initial field is deterministic one-hot RGB noise. It rapidly burns into black space; anything
that persists, travels, reproduces, or collides after that is produced by the exact-two excitation
rule rather than seeded structure. Texture-edge reads are black, making vacuum part of the machine
instead of an error condition.

Moving the mouse injects a sparse deterministic dusting of new S cells for six frames. It does not
shuffle existing memory or change the rule.

From the `wm-mini` repository root:

```sh
deno run -A src/main.ts run examples/wmslang_class4_loom/main.wm
```

Resize the window to restart the field. The example reuses `examples/wmslang_window/SDL2.so`; see
that example's README for setup.
