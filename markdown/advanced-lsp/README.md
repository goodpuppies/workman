# Advanced LSP

This directory plans a WM-native structural editor for Workman. It uses an ordinary
text buffer as its input surface and LSP diagnostics, inlays, edits, and related
features as its rendering surface. Replacing the current TypeScript language server
is part of that work, but the product is not merely a better LSP.

The plan is split into:

- [`frontend-v2-migration.md`](./frontend-v2-migration.md) — the frontend-first
  bootstrap and migration plan: write the tolerant frontend in WM, compile it to
  an importable JavaScript library, and adopt it from TypeScript before rewriting
  the LSP.
- [`structural-editor-model.md`](./structural-editor-model.md) — the product and
  state model: authored text is an incomplete suggestion, the structural document
  is the interpreted program, and LSP inlays make omitted structure explicit.
- [`tolerance-and-recovery-model.md`](./tolerance-and-recovery-model.md) — the
  normative model for marks, fallbacks, recovery, structural diagnostics, and
  integration with wm-mini's auditable diagnostic system.
- [`plan.md`](./plan.md) — target architecture, milestones, and acceptance criteria.
- [`grain-inventory.md`](./grain-inventory.md) — exact entry points into the proven
  structural-editor/LSP subsystem in the unfinished larger `research/workmangr`
  attempt, including implementation, tests, previews, and benchmarks.
- [`checklist.md`](./checklist.md) — phase-by-phase implementation tracker and
  proportionate test plan.
- [`how-to-workman.md`](./how-to-workman.md) — practical onboarding for implementing
  frontend v2 in current WM, including FP structure, modules, tests, JS/Deno
  interop, and repository examples.

These documents have distinct authority:

- `structural-editor-model.md` defines the product and state model.
- `tolerance-and-recovery-model.md` defines marks, fallbacks, diagnostics, and
  recovery invariants.
- `frontend-v2-migration.md` defines execution order and TypeScript migration.
- `plan.md` defines cross-component architecture and feature acceptance gates.
- `grain-inventory.md` identifies the old implementation used as the behavioral
  reference.
- `checklist.md` is the operational tracker; it does not redefine architecture.
- `how-to-workman.md` is the implementation-language guide for contributors and
  agents starting the WM code.

## Current decision

Start with the frontend, not the server. The tolerant frontend should be written in
WM and compiled to an importable JavaScript module. TypeScript can then adopt it as
frontend v2 while keeping the current inference/module implementation and current
LSP operational. Once that boundary is stable, rebuild the LSP in WM against the
same frontend.

Existing JavaScript/Deno/Node APIs should be consumed through safe WM FFI, and the
already-written TypeScript compiler/LSP can receive narrow migration bridges. Do
not create new TypeScript/JavaScript feature helpers for work that can be written in
WM. Parsing recovery, virtual syntax, source mapping, inlay selection, document
state, and request handling belong in WM.

Every maintained code file created or refactored by this work must stay at or below
500 lines. Markdown files are exempt. Existing oversized repository files are
technical debt, not precedent for new structural-editor code.

The first technical vertical slice stays entirely in WM:

```text
WM frontend-v2 source
  -> wm run
  -> lossless lex + one tolerant recovery
  -> structural/virtual preview
  -> WM assertions verify the result
```

The next slice compiles that working frontend into an importable JavaScript library
for the TypeScript compiler and current LSP.

The first editor-facing slice then proves the structural-editor loop:

```text
flexible/incomplete WM text
  -> tolerant structural parse
  -> explicit structural document and virtual artifacts
  -> textDocument/inlayHint
  -> VS Code renders the interpreted structure without rewriting the file
```

Type inlays, hover, definitions, formatting, module graphs, and full replacement of
the TypeScript server follow after this loop is correct and fast.
