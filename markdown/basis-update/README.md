# Basis update

## Status

Planned. Started on 2026-09-28 after the core-design discussion that produced
[`../core-design.md`](../core-design.md) and [`../basis-design.md`](../basis-design.md).

## Goal

Reorganize how the basis and standard library are *built and stored*, so that:

- adding a library module means adding a file, with no compiler edits;
- adding a primitive means editing a `.wm` file and a real `.js` file, with no compiler edits;
- the compiler owns only the Definition's initial basis (layer 0);
- library modules are ordinary modules in the ordinary module graph.

The target layering (initial basis, SML Basis subset, Workman std, host layers) and its rules are
specified in [`../basis-design.md`](../basis-design.md). This folder is the implementation plan for
getting there.

## Relationship to the module update

[`../module-update26.7/`](../module-update26.7/) Stage 3 ("Initial basis correction") already made
the basis *semantics* coherent: an immutable `InitialBasis` artifact, a single manifest for
primitive facts, structural `StrEnv` for standard structures, no provenance-based collision rules,
and source-expressible `std/*.wm` modules compiled through the ordinary front end
(`B301`–`B319`). See [`../module-update26.7/sml-basis.md`](../module-update26.7/sml-basis.md) for
that model. This plan builds on it and does not reopen it.

What Stage 3 did not change is the physical organization: the hard-coded module list, embedded
string assets, the separate standard runtime graph, and primitive members defined in TypeScript.
That is this plan's scope.

Two earlier positions are superseded; see [`decisions.md`](./decisions.md):

- **D18** of the module update froze the default basis API during the semantic migration. That
  migration is complete, and this plan deliberately changes the API toward the SML Basis.
- The `sml-basis.md` non-goal "using the same standard structure names or function inventory as
  Standard ML" is reversed for layer 1. Fidelity to the Basis spec is now a goal, because it is
  what makes a future MLton backend cheap.

## Documents

- [`current-state.md`](./current-state.md): how the basis and std are built, loaded and emitted
  today, and what adding a module or primitive costs.
- [`decisions.md`](./decisions.md): decisions made for this update.
- [`plan.md`](./plan.md): the staged plan, with checklist items and completion gates.
- [`sml-alignment.md`](./sml-alignment.md): what the Definition and the Basis spec say about
  implementing a basis, how LunarML does it, and the gaps this found in the plan.
