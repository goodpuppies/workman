# wmslang catalytic ocean

This experiment asks whether larger programs can emerge from one closed local interaction instead of
choosing from an authored instruction set. It preserves `wmslang_program_ocean` as a comparison
baseline but removes all four of its opcode branches and its long-range evolutionary jumps.

Every simulation point carries two signal values, free resource, and bound resource. Every catalyst
carries only four continuous heritable parameters:

- phase;
- coupling strength;
- sub-texel transport distance;
- resource cost and mutation scale.

All points perform the same operation: locally transported complex values are rotated and complex-
multiplied, then fed back in the same representation. Because outputs have exactly the same type as
inputs, adjacent transformations compose into chains and recurrent circuits without a predefined
program length.

The causal light cone is at most 1.5 texels per generation. Catalysts do not compete, reproduce, or
copy neighboring genomes. Each catalyst persists in place and drifts through smooth parameter fields
when its local phenotype becomes familiar.

Signal transformation binds diffusing free resource; bound resource slowly returns to the free
field. Catalyst plasticity follows a local structured-novelty estimate combining temporal surprise
and spatial coherence. A third feedback field learns the slow signal mean and expected deviation at
every location. Repeated smoke or color cycles therefore become familiar and stop counting as novel,
while departures from learned dynamics temporarily preserve their catalysts. Familiar regions drift
through smooth spatial fields rather than independent per-pixel mutation. Except for
texture-boundary effects, free plus bound resource is conserved by the update.

The learned deviation also closes the dormancy loop: historically quiet regions receive a stronger
resource-powered signal seed, while variable regions receive less. This lets a dormant phenotype
restart without an external perturbation or a permanent random-noise source.

The left panel shows the complete phenotype without aspect-ratio stretching. The four smaller right
panels show complete maps of phase, coupling, transport distance, and resource/mutation behavior.
Moving the mouse temporarily perturbs signals and catalyst parameters as an intervention test. The
moving shock is deliberately external to the conserved autonomous resource cycle, so a strong
gesture can destroy established structures instead of merely being metabolized by them.

From the repository root:

```sh
deno run -A src/main.ts run examples/wmslang_catalytic_ocean/main.wm
```

The example reuses `examples/wmslang_window/SDL2.so`; see that example's README for setup.
