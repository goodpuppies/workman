# wmslang interaction ocean

This example is a sparse spatial term graph for the one-combinator iota calculus. Empty texels are
black free space. Every occupied texel is one of only two semantic node kinds:

```text
iota         a leaf
application  a node with left and right graph links
```

An application stores two `(dx, dy)` links packed into its green and blue channels. Although the
packing can represent a larger range, every authored link is restricted to the eight immediately
adjacent texels. Graph topology is therefore genuinely spatial: connected programs remain connected
physical structures, and larger programs consume more occupied area.

## Reduction and allocation

The sole rewrite is:

```text
ι x  ->  x S K
```

`S` and `K` are not node types or opcodes. A successful rewrite allocates their complete pure-iota
graphs in nearby empty texels:

```text
K = ι (ι (ι ι))
S = ι (ι (ι (ι ι)))
```

The old application becomes `App(A, K)`, where its consumed iota neighbor becomes `A = App(x, S)`.
The old graph is otherwise untouched. All new graph edges join immediate neighbors. This makes
expansion spatial and monotonic: unsuccessful, inactive, or large programs are never deleted to
reclaim memory.

Application order is defined in a canonical frame relative to its two existing child edges. The
single rewrite geometry is rotated into that inherited frame; it never chooses a random embedding or
an absolute up/down/left/right direction. Rotation changes only the physical embedding, not the
ordered application term.

Fragment shaders cannot scatter or atomically allocate. Instead, one coordinate residue owns each
non-overlapping radius-four neighborhood per frame. Every possible root gets a turn over 100 frames.
All texels in a neighborhood inspect the same previous-frame redex and free-space condition, then
independently write their portion of the same rotation-equivariant rewrite. The scheduling lattice
controls only when a root may act; it does not create links or semantic structures.

## Infinite monkeys

Initialization creates irregular sparse iota seeds in genuinely empty space. Every frame, empty
texels inspect two adjacent occupied terms in one of four rotations. A small fraction become
applications linking those immediate neighbors; an even smaller fraction seed new iota leaves.
Existing nodes are not randomly modified. Thus the monkeys continuously assemble local connected
programs while persistent graphs retain their structure.

Iota nodes are dim gray, applications are blue with link-dependent color variation, and recent
allocation or reduction is orange. Alpha is visualization-only activity; node kind and links are the
semantic graph state.

Window resizing only resizes presentation. The graph remains at 960x640 and keeps its state. The
host loop crosses a Promise boundary each frame to avoid recursive JavaScript stack growth.

From the `wm-mini` repository root:

```sh
deno run -A src/main.ts run examples/wmslang_interaction_ocean/main.wm
```

The example reuses `examples/wmslang_window/SDL2.so`; see the window example README for setup.
