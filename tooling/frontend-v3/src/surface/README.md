# Canonical surface slice

`ast.wm` is the new schema for the first whole-program slice, not the removed
recognizer schema and not complete WM coverage. Bindings, names/literals, holes,
groups/tuples, calls, lambdas and blocks are currently representable.

Required structure occupies `TokenSlot`: authored lexer token or missing expectation
with mark identity. Lambda parameters always have a `Delimited` list, and the body
always has a `Block`; omitted parentheses/braces do not change those shapes. Empty
parameter/argument lists are genuine language structure. Tuples require a first element
and comma, distinguishing `(x,)` from grouped `(x)`.
Calls likewise have one delimited argument-list shape: whitespace application fills
missing parenthesis slots during parsing, rather than using a different AST constructor
or asking the projector to invent call punctuation.

Authored expression holes own the actual `?` token. Virtual expression holes own a
missing-expression mark, with no invented token. Missing binding patterns retain their
own mark and project as the recovered wildcard `_`, as in Workmangr; their compilation
eligibility must be decided during semantic integration, independently of punctuation.

Each authored non-EOF token must belong exactly once to a slot/leaf or a nonempty
contiguous opaque run. Leading trivia belongs to its token; trailing trivia belongs
to EOF. Inside opaque runs, internal trivia is retained in the exact source interval.
Projection copies authored token/comment/opaque spelling and records correspondence;
original whitespace remains in the document while canonical formatting regenerates
layout. Additive diff preserves that original whitespace in the editor view.

`Node.authoredSpan` describes only authored extent, including intervening source, and
may be zero-width for a missing-only node. It is distinct from mark anchors/affected
spans and projected ranges. The parser must allocate fresh document-local node and
delimiter IDs. Preserve lexer mark IDs, then allocate syntax IDs after their count;
do not infer causal links from proximity. Stable IDs across edits remain later work.

`Delimited.delimiterId` identifies the pair even when only one side is missing.
Projection records virtual ranges with that identity; View attributes diff insertions
to those ranges. Emergent whitespace has no syntax mark. Formatting, hints and fixes
must not rediscover syntax independently.

Opaque status distinguishes damaged syntax from a supported-but-unimplemented feature.
The latter has no fabricated source-error mark and must prevent claims of complete
parsing/semantic support. Future syntax extends this schema and all exhaustive visitors
together. The portable codec covers every current constructor.
