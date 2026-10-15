# Canonical assembly: first slice

This directory is the new parser, not the deleted type recognizer. Functions return
structure and state; source damage is represented in the document. There is no strict
parse/recovery retry or token insertion into the lexical stream.

The first slice supports plain name/wildcard bindings, names/simple literals/holes,
groups/tuples, explicit and whitespace calls, lambdas with name/wildcard parameters,
and blocks. Other language features must remain visibly unimplemented, with preserved
source and no fabricated source-error marks. Expand the schema/projector/codec together.

Commitment and boundaries:

- `let` commits a binding. Missing pattern, `=`, expression and terminator occupy that
  structure; a later `let` remains available for its own declaration.
- An authored `=>` commits a lambda. Bare name/wildcard parameters get marked list
  delimiters; parameterless arrows get a genuine empty list with marked delimiters.
- A paired `(` is a parameter opener only if its actual closer is followed by `=>`.
  An unpaired `(` can commit at a directly encountered parameter-list arrow. An arrow
  inside an authored group, such as `(x => x)`, does not commandeer that group's `(`.
- An authored call opener owns its lexer mate. A nested construct cannot consume the
  enclosing caller's closer. Missing delimiters never advance the authored cursor.
- A virtual opener may claim a free authored closer; an authored unpaired opener never
  fabricates lexical pairing. Container comma boundaries follow the nearest authored
  parentheses, not an enclosing list through a real block.
- Missing lambda body braces wrap the parsed body expression in the canonical Block.
  Empty authored blocks have optional results and do not invent expression holes.
- Semicolons terminate statements; a final block expression without a semicolon stays
  a result. New declarations and caller-owned closers stop incomplete child assembly.
- Loops consume, return at a boundary, or terminate at EOF. Unknown damage is retained
  as nonempty opaque runs. Known unimplemented syntax has a distinct fragment status.

`authoredEnd` is updated only by actual token consumption. Missing-only nodes use a
zero-width span at their expectation; parents retain authored extent. Syntax mark IDs
start after lexer marks; node/delimiter IDs are fresh per document. No proximity-based
causal links or incremental identity guarantees are introduced.
