# Workman syntax generator plan

## Outcome

Create one typed Workman DSL that describes editor-visible syntax and generates the maintained
syntax artifacts for Workman and its literal SML subset.

The derivation chain is:

```text
The Definition of Standard ML (Revised)
                 |
                 | mechanical transcription of the implemented Core subset
                 v
       literal SML editor syntax
                 |
                 | executable, named surface transformations
                 v
          Workman editor syntax
                 |
                 +-- TextMate / VS Code
                 +-- Sublime Syntax / Fresh
                 +-- Tree-sitter grammar and logical queries
                 +-- Helix / Zed / Neovim query adapters
                 +-- Emacs treesit adapter
                 +-- readable syntax documentation
```

Generated artifacts are committed. Editors run their native syntax engines and do not start a
Workman VM, parser, or language server merely to obtain immediate highlighting.

The initial first-class editors and their backend/adaptor boundaries are fixed in
[supported-backends.md](./supported-backends.md).

## Governing decisions

### This is editor syntax, not the language recognizer

The DSL describes how source is segmented, structured, and highlighted. It does not define the set
of valid programs.

- Unknown or malformed text must not invalidate a document.
- Recognizable prefixes and later syntax islands remain highlightable.
- Unclosed regions may continue safely to end of file.
- There is no authoritative `accepts(source)` operation.
- Compiler AST construction and semantic actions do not belong in the DSL.
- Binder uniqueness, typing, scope resolution, and other Definition judgments remain compiler work.
- A parser generator may be added as a convenience, but cannot become the DSL's contract.

### The selected surfaces are context-free

The Workman surface and literal SML subset must not require symbol tables, prior declarations,
constructor environments, dynamic fixity environments, types, or validity judgments to structure
source. See [context-free-audit.md](./context-free-audit.md).

The literal SML subset therefore excludes user fixity directives and dynamic infix parsing.
Constructor status remains a later semantic distinction on a syntactic `VId`; the editor grammar
does not maintain the mutable constructor set used by the outdated `wmsml` parser.

### Literal SML comes first

The first complete syntax value uses literal SML spelling. This makes transcription reviewable
against the Revised Definition without simultaneously reasoning about Workman spelling.

Only the SML Core forms belonging to Workman's intended semantic subset are transcribed. The old
`src/grammar.wmsml.peggy` and its tests are characterization material, not the authority for the
subset: that implementation is incomplete and outdated.

### Workman is derived, not independently restated

Rules unchanged between the surfaces are shared by identity. Workman replaces named surface forms,
removes unavailable forms, and adds its extensions. A rule must not be copied merely to change its
spelling.

Human explanation of the relationship remains in `docs/smlparallels.md`; the executable DSL does
not contain a parallel table of retained, omitted, or respelled concepts.

### The Revised Definition shapes the DSL

Do not begin with a speculative universal grammar algebra. Add a primitive when it is required by a
construct in the Revised Definition, by an explicit Workman extension, or by a target emitter.

The initial concept proposal has been checked against the Definition in
[definition-concept-audit.md](./definition-concept-audit.md). That audit is the gate for adding
concepts to the core model.

The Definition directly supports these concepts, but that does not automatically place all of them
in the common editor DSL. They remain reference concepts for transcription and testing:

- lexical classes and longest-item priority;
- named syntax and phrase classes;
- terminals and syntax-class references;
- ordered alternatives;
- optional phrases and the Definition's named sequence/row classes;
- precedence, association, and far-right-extension conventions in the full language grammar;
- long identifiers and the identifier positions the Definition classifies syntactically.

The initial common editor model is deliberately narrower: lexical classes, ordered matching,
references, sequences, alternatives, optional components, repetition, and recursive lexical
contexts. Parser-oriented precedence, association, and far-right-extension machinery is excluded
unless an output syntax format and a concrete highlighting requirement justify it. Highlight roles
and permissive recovery are editor-generation requirements rather than SML grammar concepts.

## Proposed source layout

Names are provisional until the first implementation slice confirms the boundaries.

```text
tooling/syntax-definition/
  model.wm                 typed DSL data model
  sml_core.wm              literal SML subset transcription
  workman.wm               transformations and Workman extensions
  highlight_roles.wm       backend-independent classifications
  validate.wm              internal DSL consistency checks
  emit/
    textmate.wm
    sublime.wm
    tree_sitter.wm
    tree_sitter_queries.wm
    emacs_treesit.wm
    documentation.wm
  fixtures/
    sml/
    workman/
```

Generated files stay in their editor-owned locations under `editors/`.

## Phase 1: establish the literal SML foundation

### 1.1 Inventory the intended subset

Use these sources in authority order:

1. `research/The-Definition-of-Standard-ML-Revised`
2. The semantic overlap documented in `docs/smlparallels.md`
3. Current Workman compiler and formatter behavior
4. Existing `wmsml` tests and parser as historical characterization

Produce a checklist of the selected lexical and Core phrase classes. Do not encode a separate
SML-to-Workman mapping.

### 1.2 Implement the smallest DSL model

Implement only enough typed data to transcribe the first coherent slice. The recommended first
slice is:

- formatting characters and comments;
- reserved words and identifiers;
- integer, real, string, boolean, and unit constants relevant to the subset;
- atomic patterns and expressions;
- value bindings;
- `val`, `val rec`, `fn`, and application.

The model must distinguish recognition structure from highlight roles.

### 1.3 Transcribe literal SML

Transcribe the selected rules directly from the Revised Definition. Preserve Definition phrase
names, alternative order, precedence, and association where applicable. Source citations may be
comments or inert provenance strings; they must not create a second executable grammar.

### 1.4 Add a readable renderer

Before any editor emitter, render the typed syntax into a stable, human-reviewable grammar table.
Reviewing this output beside the Definition is the first correctness gate.

## Phase 2: define executable Workman transformations

Transform named SML forms rather than restating the entire grammar. Initial transformations include:

- `val` to `let`;
- `fn` and matches to Workman lambda and match spellings;
- `case` to `match`;
- SML application to Workman's whitespace and parenthesized applications;
- SML sequence/local-expression forms to Workman blocks;
- postfix SML type application to Workman angle-bracket application;
- structural SML records to Workman's nominal record surface;
- SML comments and constants to Workman spellings;
- fixed Workman operators and the forward pipe;
- file imports, JavaScript imports, interpolation, directives, and other explicit extensions.

Each transformation must operate on stable named forms and return another `EditorSyntax` value.
Transformation validation must detect missing targets, duplicate form names, and accidental mutation
of the literal SML source value.

## Phase 3: reference highlighting and differential tests

Implement a reference interpreter for tests. It produces ranges and backend-independent highlight
roles; it is not shipped as an editor tokenizer and does not judge validity.

### Valid-source comparison

For parser-accepted SML or Workman source, compare parser-derived structural facts with DSL-derived
highlighting:

- every authored token is covered as intended;
- multicharacter tokens such as `=>`, `->`, `:>`, and `..` are not split;
- comments, strings, escapes, and interpolation have correct boundaries;
- reserved words are not identifiers;
- bindings, parameters, constructors, types, namespaces, and fields receive the intended roles;
- ranges are ordered, in bounds, and do not overlap illegally.

The real parser is an oracle for valid examples, not an acceptance standard for the highlighter.

### Incomplete and malformed source

Run every prefix of representative examples and targeted mutations. Assert that highlighting:

- terminates and does not throw;
- emits only in-bounds ranges;
- preserves highlighting before the edit where appropriate;
- handles unfinished comments, strings, interpolation, and declarations sensibly;
- resumes after unknown or malformed text.

### Corpus

Include:

- every repository `.wm` file;
- SML and Workman snippets from tests;
- frontend and formatter fixtures;
- documentation examples;
- paired `wmsml`/Workman equivalence fixtures;
- generated prefixes and mutations.

## Phase 4: first production emitters

Use the shared lowering and capability model in [emitter-model.md](./emitter-model.md). Regex and
state-machine formats consume a lexical-context projection, while Tree-sitter consumes a permissive
token-tree projection plus queries. They share the normalized syntax graph and highlight roles, not
a target-shaped grammar IR.

Implement emitters in order of immediate repository value:

1. TextMate JSON for VS Code
2. Sublime Syntax YAML for Fresh
3. Tree-sitter grammar plus shared highlight queries
4. Helix, Zed, and Neovim adapters from the shared Tree-sitter outputs
5. Emacs treesit integration using the same grammar and logical queries

An emitter may lower the DSL conservatively when its backend cannot express a construct exactly.
Such degradation must be explicit, deterministic, and covered by fixtures. Backend-specific escape
hatches require a demonstrated need and must not redefine a language construct.

Start with one cross-backend experiment covering bindings, overlapping multicharacter operators,
strings and interpolation, comments, identifiers, and constants. Generate TextMate, Sublime Syntax,
and the shallow Tree-sitter grammar and queries before expanding its consumer adapters.

## Phase 5: migration and drift enforcement

- Generate into temporary paths and compare with committed artifacts.
- Add a check mode that fails when generated files differ.
- Migrate one backend at a time; do not replace all editor grammars in one change.
- Preserve behavioral fixtures for every fixed highlighting bug.
- Mark generated files clearly as generated and name their source DSL entrypoint.
- Remove hand-maintained duplicates only after the corresponding generated backend passes its
  fixtures and manual editor smoke tests.

## Phase 6: optional `wmsml` parser generation

After the editor syntax and emitters are stable, investigate generating the permissive syntactic
portion of `wmsml` from the literal SML value. This is optional convenience, not an acceptance
criterion for the syntax generator.

Any generated compiler parser still needs separate semantic actions, recovery policy, spans, and
conformance tests. The Revised Definition and compiler semantics remain authoritative.

## Acceptance criteria

The project is complete when:

- literal SML subset syntax is represented once and reviewable against the Revised Definition;
- Workman syntax is reproducibly derived through transformations plus explicit extensions;
- VS Code, Fresh, Tree-sitter, Helix, and Zed artifacts are generated rather than independently
  maintained;
- the valid-source corpus agrees with parser-derived highlighting facts;
- prefix and mutation suites demonstrate permissive, stable behavior;
- regeneration is deterministic and enforced by tests or CI;
- generated editors retain immediate native highlighting with no runtime Workman dependency;
- documentation clearly preserves the boundary between editor syntax and compiler validity.

## First implementation slice

The first coding milestone should stop after proving the architecture:

1. Define `EditorSyntax`, named classes, patterns, and highlight roles.
2. Transcribe SML comments, identifiers, constants, `val`, patterns, `fn`, and application.
3. Render a readable grammar snapshot.
4. Derive Workman's comments, identifiers, `let`, lambda, and application forms.
5. Run reference-highlighting fixtures for paired SML and Workman examples.
6. Emit neither TextMate nor Tree-sitter until this slice is reviewable and stable.

This milestone answers whether the derivation model works before backend constraints shape the DSL.
