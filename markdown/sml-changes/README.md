# Workman Changes From Standard ML

This folder tracks the semantic and surface-language places where current
`wm-mini` intentionally differs from Standard ML.

`wm-mini` should be read as an SML-shaped language, not as a full Standard ML
implementation. The goal of these notes is to separate four things:

- SML behavior that Workman keeps.
- SML behavior that Workman only spells differently.
- SML behavior that Workman changes deliberately.
- SML behavior that `wm-mini` omits for now because the implementation is small.

The local Standard ML reference is:

```txt
research/The-Definition-of-Standard-ML-Revised
```

Useful starting points in that tree:

- `syncor.tex`: core syntax, including atomic expressions, records, `let`, and
  sequential declarations.
- `synmod.tex`: modules syntax, top-level declarations, structure-level
  declarations, and sequencing.
- `prog.tex`: program execution as semicolon-delimited top-level declarations.
- `statcor.tex`: core static semantics, including record row types, local
  declarations, value restriction, and datatype escape restrictions.

Reader-facing translation remains in `docs/smlparallels.md`. This folder is
for design accounting and future formalization.

## Notes

- [Current Subset Ledger](./current-differences.md)
- [Syntactic Differences](./syntax-differences.md)
- [Semantic Differences](./semantic-differences.md)

## Working Method

When documenting a feature, classify it before deciding whether it belongs in
the future formal core:

- `kept`: same SML idea and close enough behavior.
- `re-spelled`: same SML idea, different Workman surface.
- `changed`: intentionally different behavior or type discipline.
- `omitted`: absent from current `wm-mini`.
- `extension`: Workman-specific feature outside SML.
- `reconsider`: implemented or documented, but not yet justified as part of
  the SML-shaped subset.

This classification is useful because `wm-mini` is not trying to grow into all
of SML. It is trying to keep the small SML-shaped core precise.
