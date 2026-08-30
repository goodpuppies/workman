# Program ocean: evolving shader programs as a continuous material

## Goal

Build a Workman feedback experiment whose evolving objects are small programs, not cells in a fixed
automaton. The target behavior is a long-lived mixture of ordered structures, disorder, and
localized interactions: the qualitative territory usually called Class IV.

The first version should optimize for inspectability rather than claiming open-ended evolution.
Every state channel, source of mutation, fitness signal, and scheduling choice should have a visible
meaning.

## Why not another cellular automaton

The current V5 GPU boundary is a fragment function over sampled `rgba16float` textures. It has no
scatter writes, atomics, storage buffers, workgroup memory, or compute stage. A literal population
of variable-sized syntax trees therefore spends most of its machinery on allocation and collision
avoidance. `wmslang_interaction_ocean` demonstrates this clearly: spatial iota graphs are genuine
programs, but monotonic allocation fills the world and a tiled schedule makes reductions sparse.

A better match for fragment throughput is a **continuous program material**:

- the texture is an Eulerian discretization of a continuous field, not a board of discrete cells;
- bilinear samples implement transport and nonlocal sensing at fractional coordinates;
- one field contains dynamic registers and accumulated quality signals;
- a second field contains heritable program parameters;
- each fragment interprets its local program to update the dynamic field;
- a second pass selects, recombines, and mutates programs according to locally measured novelty.

The shader stays fixed, but the program executed at every point is data and can reproduce. This is
the same useful distinction as a virtual machine versus the programs running inside it.

This design is closest to Flow-Lenia's localized rule parameters, despite using an explicit tiny
program interpreter and selection pass. It is still a field simulation discretized on a texture. If
"not cellular" means no spatial lattice even as a numerical representation, V5 cannot honestly meet
that requirement; a particle ODE substrate such as Particle Lenia needs compute/storage or an
impractical gather over texture-encoded particles.

## State model

Use two ping-pong `rgba16float` fields at a lower fixed simulation resolution, initially 480x320.
Four physical textures are enough.

### Signal field

| Channel | Meaning                                                   |
| ------- | --------------------------------------------------------- |
| R, G    | two continuous registers operated on by the local program |
| B       | exponentially decayed prediction error / novelty          |
| A       | viability: novelty discounted by noise and update cost    |

### Program field

| Channel | Meaning                                |
| ------- | -------------------------------------- |
| R       | instruction-family selector            |
| G       | sensing direction and radius           |
| B       | nonlinear constant / coupling strength |
| A       | mutation rate and recombination bias   |

Half-float precision is desirable here: it bounds information and lets mutations have a real floor.
Program channels should remain in `[0, 1]`; signal registers can remain signed.

## The tiny program VM

Each point samples the signal at two fractional offsets derived from its program. The red program
channel selects one of four operation families. The other channels parameterize the selected
operation.

1. **Transport**: rotate and mix two sampled register pairs. This moves coherent structures without
   copying along a fixed lattice direction.
2. **Oscillator**: apply coupled sine oscillators with a heritable phase and frequency.
3. **Reaction**: multiply/cross-couple registers, then squash them. This supports boundaries,
   amplification, and inhibition.
4. **Conditional**: compare sampled signals and select or negate a branch. This supplies a sharp,
   logic-like operation without discretizing the entire world.

The family boundaries are deliberately discontinuous. Mutation can therefore make a small parameter
change or cross into a qualitatively different instruction. A later version can use two or three
instructions per point by deriving additional opcodes from decorrelated bits of the four genes, but
the first version should remain legible.

Conceptually, the signal pass is:

```workman
let signalShade = (inputs: SignalInputs) => {
  (coord) => {
    @gpu;
    let uv = coord / inputs.resolution;
    let program = inputs.program.Sample(inputs.linear, uv);
    let old = inputs.signal.Sample(inputs.linear, uv);
    let angle = program.y * 6.2831853;
    let radius = 1.0 + program.w * 11.0;
    let offset =
      (cos(angle) * radius, sin(angle) * radius) / inputs.resolution;
    let ahead = inputs.signal.Sample(inputs.linear, uv + offset);
    let behind = inputs.signal.Sample(inputs.linear, uv - offset);

    -- Select one parameterized operation family using program.x.
    let candidate = interpret(program, old, ahead, behind);

    -- Reward surprising but spatially coherent changes. Raw white noise is
    -- surprising but poorly predicted by its nearby samples, so coherence
    -- and bounded change must both contribute to viability.
    let change = distance2(candidate, old);
    let coherence = 1.0 / (1.0 + distance2(ahead, behind));
    let novelty = change / (0.04 + change) * coherence;
    let viability = old.w * 0.985 + novelty * (1.0 - novelty) * 0.04;
    (candidate.x, candidate.y, novelty, viability)
  }
};
```

This is illustrative rather than copy-paste-ready: helper lowering and available Slang overloads
must be checked while implementing it.

## Evolution pass

After producing the next signal field, update the program field. Every program compares its
viability with programs sampled at two fractional offsets. This is a continuous tournament rather
than a neighbor-count rule.

- Retain the current program when it performs at least as well as its challengers.
- Otherwise copy or recombine the better challenger with the current program.
- Mutate rarely when viability is healthy and increasingly when it is low.
- Keep a very small viability-independent mutation floor so a frozen attractor is escapable.
- Mutate one channel at a time more often than all channels, preserving partial programs.

All randomness should be a deterministic hash of coordinate, frame, and the previous program. The
frame-dependent term is an explicit mutation source, not hidden semantic state.

An important anti-cheating rule: program fitness must never directly reward large register values,
rapid flicker, or a particular color. It should reward an intermediate rate of unpredictable but
locally compressible change. A simple initial objective is:

```text
viability = temporal_surprise
          * spatial_coherence
          * (1 - saturation)
          * (1 - high_frequency_flicker)
```

No scalar local objective guarantees emergence. This one is only a pressure toward the boundary
between frozen order and uncorrelated noise.

## Pass order

One frame uses three fragment draws:

```text
previous signal + previous program
              -> next signal

previous program + previous signal + next signal
              -> next program

next signal + next program
              -> display
```

The host then swaps both feedback pairs. Program evolution sees the consequence of the program it is
evaluating within the same frame, while the signal update sees a consistent previous generation.

Resize should only resize presentation. Restarting the evolutionary history because the window was
resized makes long-run observation too fragile.

## Make the causal structure visible

The display should have switchable views, even if the first implementation cycles them on mouse
movement:

- phenotype: signal R/G as color and novelty as brightness;
- genotype: the four program channels mapped to hue, direction strokes, and brightness;
- viability: a monochrome heatmap;
- ancestry/change: highlight locations whose program changed this frame.

Without a genotype view, smooth advection can look like evolution. Without a phenotype view,
selection can look like harmless texture diffusion.

## Measuring whether it is actually interesting

Visual appeal is not enough. Periodically read back a small downsampled diagnostic texture once a
host readback path exists, or initially inspect render captures offline. Track:

1. **Program diversity**: occupied histogram bins in quantized program space.
2. **Spatial mutual information**: correlation between program/signal samples at increasing
   distances.
3. **Temporal novelty**: distance from frames at several lags, not only the immediately prior frame.
4. **Compressibility**: PNG/zstd size of quantized state. Class-I-like fields compress too well;
   white noise compresses poorly but has low spatial mutual information.
5. **Perturbation response**: divergence between two runs differing in a small injected region.
   Interesting behavior should spread information without immediately saturating the whole field.
6. **Lineage persistence**: how long related program clusters survive while continuing to alter
   phenotype.

A useful experimental score can combine diversity, multi-scale mutual information, and perturbation
spread, but raw component traces must remain available so optimization cannot hide a degenerate
solution.

## Experiment ladder

### P0: coupled fields

Implement the two feedback pairs, the four operation families, deterministic mutation, and the three
diagnostic views. Confirm that removing mutation freezes ancestry and removing selection turns
genotype into diffusion.

### P1: novelty at multiple scales

Sample radii 1, 4, 16, and 64 using additional passes or rotating one scale per frame. Reward
programs whose effects are neither purely microscopic nor globally uniform.

### P2: program sequences

Add a third texture that stores four instruction selectors or an instruction pointer and scratch
registers. A point then executes a short cyclic program rather than one instruction. This is the
first version that deserves the name shader-program soup without qualification.

Even P2 has a fixed maximum genome and therefore only supports exploratory open-endedness inside a
bounded behavior space. Expansive evolution requires variable-size composition, and transformational
evolution requires the system to create new kinds of phenotype/environment interaction. The graph
program direction remains important for those later goals.

### P3: resources and ecological niches

Add a slowly replenishing resource field. Programs must spend resource to amplify or reproduce;
transport and inhibition have different costs. Spatial resource gradients create niches and make
unbounded replication impossible.

### P4: compute-era graph programs

When Workman gains compute shaders and storage buffers, revisit graph-reduction organisms with
atomic free lists, bounded garbage collection, and genuine scatter allocation. Keep the continuous
program ocean as an environment and fitness substrate rather than replacing it.

## Failure modes to expect

- **Pretty attractor**: the field settles into a reaction-diffusion wallpaper. Multi-lag novelty and
  lineage change expose this.
- **Noise wins**: mutation or oscillation produces maximum flicker. Coherence, saturation penalties,
  and update cost must make it unfit.
- **One genome sweeps**: a robust generalist erases diversity. Use spatially varying resources,
  frequency-dependent fitness, or novelty relative to nearby genomes.
- **Genome diffusion masquerades as heredity**: continuous interpolation blends programs until all
  opcodes are similar. Program sampling should be linear for sensing but nearest for inheritance;
  recombination must be explicit.
- **Frame clock does the work**: patterns are driven by global time rather than accumulated state.
  Restrict frame use to mutation hashing and diagnostics after initialization.
- **Edge ecology dominates**: clamp-to-edge textures create special boundary niches. Use a fixed
  simulation field with an explicit dead margin initially; add toroidal addressing only if it is
  authored in the shader.

## Recommended first implementation

Start with P0 as a new `examples/wmslang_program_ocean` example and leave the SKI/iota experiments
intact. Use separate nearest and linear samplers: linear for continuous signal transport, nearest
for program inheritance. Run at 480x320 and upscale for display. The first success criterion is not
"looks alive"; it is that visible genotype lineages persist, compete, and keep causing structured
phenotypic changes for at least tens of thousands of frames without external interaction.

## Related work

- Bert Wang-Chak Chan, [_Lenia — Biology of Artificial Life_](https://arxiv.org/abs/1812.05433)
  (2018), establishes the rich behavior available in continuous field rules.
- Erwan Plantec et al.,
  [_Flow-Lenia: Towards open-ended evolution in cellular automata through mass
  conservation and parameter localization_](https://arxiv.org/abs/2212.07906) (2022), is the most
  direct precedent for local, heritable dynamics and motivates adding resource conservation early.
- Erwan Plantec et al.,
  [_Particle Lenia and the energy-based formulation_](https://google-research.github.io/self-organising-systems/particle-lenia/)
  (2022), is the cleanest route away from a field substrate once Workman exposes appropriate compute
  primitives.
- Emily Dolson et al.,
  [_The MODES Toolbox: Measurements of Open-Ended Dynamics in Evolving
  Systems_](https://direct.mit.edu/artl/article/25/1/50/2915/The-MODES-Toolbox-Measurements-of-Open-Ended)
  (2019), motivates tracking change, novelty, complexity, and ecology separately.
- Tim Taylor, [_Evolutionary Innovations and Where to Find Them_](https://arxiv.org/abs/1806.01883)
  (2018), supplies the distinction between exploratory, expansive, and transformational
  open-endedness used above.
- Thomas S. Ray-style program ecologies and Stringmol/automata chemistries motivate explicit energy
  costs, bounded resources, and executable hereditary material rather than novelty alone.
