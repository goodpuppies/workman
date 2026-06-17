# wm-mini Changes From Standard ML

This folder tracks the semantic and surface-language places where current
`wm-mini` intentionally differs from Standard ML.

`wm-mini` should be read as a small language whose core is compared against
Standard ML, not as a full Standard ML implementation. The goal of these notes
is to separate four things:

- SML behavior that current `wm-mini` keeps.
- SML behavior that current `wm-mini` only spells differently.
- SML behavior that current `wm-mini` changes deliberately.
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

- `kept`: checked against the relevant SML rule and current `wm-mini`
  implementation, with behavior close enough to treat as the same core rule.
- `re-spelled`: checked as the same overlapping rule, but with different
  `wm-mini` surface syntax.
- `changed`: intentionally different behavior or type discipline.
- `omitted`: absent from current `wm-mini`.
- `extension`: `wm-mini`-specific feature outside SML.
- `reconsider`: implemented or documented, but not yet justified as part of
  the compared-against-SML subset.

This classification is useful because `wm-mini` is not trying to grow into all
of SML. It is trying to keep the small compared-against-SML core precise.

## Evidence Rule

Every claimed difference should be grounded in both sides:

- the SML side should cite a relevant file from
  `research/The-Definition-of-Standard-ML-Revised`, and
- the `wm-mini` side should cite current grammar, implementation behavior, or
  tests from this repository.

User-facing docs such as `docs/wm-minisyntaxguide.md` are useful orientation,
but they are not proof of current behavior. The `research/workman` and
`research/workmangr` trees are related history and design context, not
authoritative evidence for current `wm-mini`.

If a point is only a possible future direction, mark it as design work rather
than as a current difference.
