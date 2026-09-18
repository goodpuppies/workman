# Shared Core backend refactor

This folder tracks the migration from backend-specific Surface AST lowering to
one typed, backend-neutral Core followed by explicit backend forks.

The intended compiler shape is:

```text
frontend-v2 parser
        |
        v
Surface AST + inference/name/nominal facts
        |
        v
typed Shared Core
        |
        +----------------+----------------+
        |                |                |
        v                v                v
host lowering       shader lowering    future SML lowering
        |                |                |
        v                v                v
     JavaScript       WMSLang/Slang       SML
```

Frontend v2 is the live parser. Peggy is generator input for the self-hosted
frontend artifact; it is not a second runtime parser and this refactor must not
introduce one.

See [current-state.md](current-state.md) for the implemented boundary, known
transitional dependencies, verification, and the next migration slices.

See [shader-authoring-milestone.md](shader-authoring-milestone.md) for the
short-term, deliberately limited checklist.

See [pipe-elaboration-plan.md](pipe-elaboration-plan.md) for the first follow-up
slice: one hygienic definition of pipe, application, and currying behavior.

## Governing rule

Workman syntax is normalized once, before backend selection. A backend may
reject a Core construct it cannot represent, but it should not independently
define what source syntax such as a pipe, anonymous match function, tupled
application, or ascription means.

This is what lets the host, shader, and future SML backends share language
semantics without three parser/desugar implementations.
