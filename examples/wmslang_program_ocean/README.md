# wmslang program ocean

This experiment evolves tiny shader-interpreted programs rather than applying one fixed cellular
rule. Two persistent `rgba16float` fields have different roles:

- the **signal field** is the phenotype: two signed registers, recent structured surprise, and
  accumulated viability;
- the **program field** is the genotype: instruction family, sensing geometry, nonlinear parameter,
  and mutation/recombination behavior.

Each signal fragment runs the program stored at its coordinate. A program chooses between transport,
oscillator, reaction, and conditional instruction families and samples the phenotype at fractional,
heritable offsets. The following program pass observes the resulting viability, competes with a
distant program, recombines, and occasionally mutates. The fixed shader is therefore a small virtual
machine; the program population is mutable texture data.

The display deliberately exposes both layers. Phenotype occupies the left three quarters. The right
quarter shows the genotype, divided into four horizontal bands for its four channels; hue identifies
the instruction family. White flashes are recent structured surprise. Moving the mouse temporarily
raises mutation pressure and perturbs the phenotype, providing a causal test of recovery without
becoming a permanent input.

The simulation remains fixed at 480x320 when the presentation window is resized. It uses continuous
bilinear transport, explicit program inheritance, nonlocal sensing, and temporal state; the texture
is a numerical substrate rather than a board of live/dead cells.

From the repository root:

```sh
deno run -A src/main.ts run examples/wmslang_program_ocean/main.wm
```

The example reuses `examples/wmslang_window/SDL2.so`; see that example's README for setup.
