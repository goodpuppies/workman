# Context-free surface audit

## Conclusion

The intended Workman surface language can be defined as a context-free language over a separately
tokenized input. No current core Workman feature requires context-sensitive parsing.

The literal SML subset can also remain context-free, provided it deliberately excludes dynamic
fixity declarations and does not require the grammar to decide environment-dependent constructor
status.

This is a design boundary for the syntax generator, not a claim that every current implementation
already observes the boundary cleanly.

## Workman features that remain context-free

- Fixed reserved words and operators
- Lowercase identifiers, uppercase constructors, and qualified names
- Literals, escapes, line comments, multiline strings, and interpolation
- Nested expressions inside interpolation
- Parenthesized and brace-delimited sequences
- Tuples, lists, records, spreads, and patterns
- Lambdas, calls, whitespace application, and pipes
- Match expressions and match functions
- Type expressions and angle-bracket type application
- Value, type, record, import, and JavaScript import declarations
- Fixed operator precedence and association

Nested regions do not break context-freedom. Literal SML's nested comments and Workman's nested
interpolation require a stack, but both are context-free structures.

## Current implementation details that are not language counterexamples

### PEG lookahead

`src/grammar.peggy` uses negative lookahead for keyword boundaries, constructor-pattern exclusions,
and distinguishing an explicit call from the parameter list before `=>`. These are PEG
implementation choices. Keyword boundaries belong in lexical analysis, and the remaining cases can
be represented with distinct context-free productions or resolved conservatively by an editor
backend.

The start-rule semantic predicate only resets generated node identifiers. It does not constrain the
language.

### Parser actions that reject local shapes

The parser currently checks that datatype variant members have constructor-name shape. That rule can
be represented by a dedicated context-free variant-member production; the JavaScript action is not
fundamentally required.

Other parser actions construct or lower AST nodes and have no bearing on context-freedom.

### Static restrictions

These checks depend on accumulated facts, but they are not parsing requirements:

- duplicate pattern binders;
- duplicate record fields;
- duplicate or unknown directives;
- guarded recursive value use;
- constructor existence and arity;
- name resolution and import environments;
- type correctness and equality admissibility.

The editor syntax must highlight their source forms without attempting to enforce the restriction.

## The two SML boundaries

### Dynamic fixity is excluded

Full Standard ML permits `infix`, `infixr`, and `nonfix` directives. Their scope changes how later
symbolic identifiers are parsed, so parsing full SML infix syntax depends on a changing fixity
environment.

Workman already omits user symbolic identifiers and fixity directives in favor of a fixed operator
table. The literal SML subset used by this project should make the same restriction explicit. Fixed
operators and fixed precedence remain context-free.

### Constructor status is not decided by the grammar

In literal SML, a `VId` in a pattern may denote a variable or a constructor according to the static
environment. The Revised Definition's revised identifier presentation intentionally uses the shared
`VId` syntax class and resolves status outside lexical spelling.

The old `src/grammar.wmsml.peggy` keeps a mutable constructor set while parsing. That is historical
implementation behavior and must not be copied into the DSL. The literal SML editor syntax should
classify the occurrence as a pattern `VId`; optional semantic highlighting can refine it later.

Workman removes most of this ambiguity structurally through capitalization, explicit `Var(...)`
patterns, and pinned match identifiers.

## Meaning of “context-free” for this project

The source definition may use lexical rules followed by a context-free surface structure. It must
not depend on:

- a symbol table;
- earlier declarations;
- inferred types;
- constructor or fixity environments;
- declaration-order state;
- indentation or layout state;
- compiler validity judgments.

This does not require every target syntax format to implement the complete context-free structure.
TextMate and Sublime outputs may conservatively project only the parts they can represent, while the
shared shallow Tree-sitter output and its editor adapters preserve useful structure. The generator
must not pretend that an unsupported structural distinction was enforced.

## Consequence for the initial DSL

The initial common model should remain smaller than a parser grammar. Start from lexical classes,
ordered matching, references, sequences, alternatives, optional parts, repetition, and recursively
nested contexts. Do not add parser-only precedence machinery merely because the Revised Definition
uses it in its language grammar.

The literal SML grammar remains a verification source, but only its editor-representable,
context-free projection enters the shared syntax value.
