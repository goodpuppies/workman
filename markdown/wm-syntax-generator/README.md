# Workman syntax generator

This directory plans a single, typed source for Workman editor syntax definitions.

The project begins by mechanically transcribing the literal Standard ML Core subset on which
Workman is based. That syntax is independently reviewable against *The Definition of Standard ML
(Revised)*. Workman syntax is then produced through named transformations of those shared rules and
the addition of Workman-specific surface forms.

The system is optimized for editor tooling: TextMate, Sublime Syntax, and a shared Tree-sitter
grammar with adapters for Helix, Zed, Neovim, and Emacs. It is intentionally permissive and is not an
authority on whether a program is valid. Parser generation may be a useful secondary output, but the
compiler parser remains responsible for acceptance, recovery, static semantics, and dynamic semantics.

The lowering from that shared syntax value into the unlike editor format families is described in
[emitter-model.md](./emitter-model.md).
The first-class editor set and the distinction between backend artifacts and editor adapters is
fixed in [supported-backends.md](./supported-backends.md).

See [plan.md](./plan.md) for scope, architecture, milestones, and acceptance criteria. The proposed
DSL primitives are checked against the Revised Definition in
[definition-concept-audit.md](./definition-concept-audit.md). The boundary that keeps Workman and
the selected literal SML surface context-free is recorded in
[context-free-audit.md](./context-free-audit.md).
