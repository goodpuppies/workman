# Workman module update, 26 July

## Status

This is the active planning track. The general LSP update in
[`../lsp-update26.7/`](../lsp-update26.7/) is deferred until this module/SML correctness pass
defines the compiler facts that editor tooling should consume.

## Goal

Define and implement a module system with two deliberately separate foundations:

```text
language semantics              compilation-unit protocol
------------------              -------------------------
Revised Standard ML             selected static ESM properties
declarations and environments   graph discovery and resolution
binding and namespaces          canonical module identity
type inference and identity     initialize once
sequential elaboration          dependency-before-importer order
```

The result is not approximate SML plus approximate JavaScript. The shared language fragment follows
the Revised Definition exactly. The file layer is a small Workman protocol whose selected ESM
properties are specified directly.

## Documents

- [`checklist.md`](./checklist.md) is the canonical progress tracker, with ordered implementation
  stages, dependencies, evidence requirements, and completion gates.
- [`direction.md`](./direction.md) states the semantic split and overall direction.
- [`current-state.md`](./current-state.md) records what the compiler, parser, inference engine, and
  emitter do today.
- [`sml-compatibility-contract.md`](./sml-compatibility-contract.md) defines equivalence,
  restriction, definitional extension, and genuine Workman extension.
- [`sml-correctness-audit.md`](./sml-correctness-audit.md) defines the Definition-backed conformance
  matrix and priority checks for environments, schemes, identity, patterns, and ordering.
- [`sml-conformance-matrix.md`](./sml-conformance-matrix.md) is the concrete import-facing audit
  matrix with Definition rules, implementation evidence, tests, and current status.
- [`parallel-semantics-audit.md`](./parallel-semantics-audit.md) challenges every planned and
  current module mechanism that may duplicate SML or ESM semantics and turns implementation
  divergences into required fixes.
- [`sml-basis.md`](./sml-basis.md) separates the minimal initial basis, standard structures,
  pervasive bindings, and per-module working basis, then audits the current fragmented prelude
  implementation.
- [`basis-inventory.md`](./basis-inventory.md) records and classifies the exact current
  source-visible basis profiles and standard structures before migration.
- [`identity-inventory.md`](./identity-inventory.md) inventories every overloaded path, specifier,
  alias, emit-name, and nominal-ID role that must migrate to explicit identities.
- [`tooling-interface.md`](./tooling-interface.md) defines the sole compiler semantic API for
  tooling, current-source partial interfaces, project isolation, the Millet comparison, and the
  current LSP migration.
- [`sml-files-and-structures.md`](./sml-files-and-structures.md) records what the Revised Definition
  says, how Millet composes SML source files, and how Workman can retain exact SML environment
  semantics.
- [`sml-relative-comparison.md`](./sml-relative-comparison.md) compares plain top-level loading,
  MLB, SML/NJ CM, and Workman's proposed DAG of declaration sequences.
- [`esm-research.md`](./esm-research.md) separates ECMAScript module semantics from host resolution
  and identifies which properties Workman should and should not adopt.
- [`proposed-semantics.md`](./proposed-semantics.md) is the normative Workman file-module draft
  specification.
- [`decisions.md`](./decisions.md) records settled first-pass decisions and explicitly deferred
  questions.
- [`milestones.md`](./milestones.md) orders the correctness audit, specification, implementation,
  and LSP handoff.

## Working rule

Every behavior must have one owner:

- the Revised Definition;
- the Workman compilation-unit protocol;
- an explicitly documented Workman language extension.

If a rule is justified only by saying it is “close to SML” or “like ESM,” it is not yet specified.
