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

- [Syntactic Differences](./syntax-differences.md)
- [Semantic Differences](./semantic-differences.md)
