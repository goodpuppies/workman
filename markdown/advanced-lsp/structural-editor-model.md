# Structural editor model over text and LSP

## Product definition

This project is a structural editor in the Hazel/Workman sense. It is not primarily
a language server that adds unusually good hints to an otherwise conventional text
language.

Its unusual implementation boundary is:

```text
input surface:   ordinary text editor buffer
editor model:    tolerant structural document
output surface:  LSP inlays, diagnostics, edits, navigation, and decorations
```

Hazel uses a custom web editor to display holes and incomplete structure directly.
Workman uses the host editor's text buffer for authored input and projects the
missing/implicit structure back through LSP. The inlays are therefore part of the
editor's structural rendering, not incidental annotations.

The working predecessor is mapped in
[`grain-inventory.md`](./grain-inventory.md). Its structural frontend, virtual
formatter, inlay generator, previews, and regression tests are behavioral reference
material, not merely historical background.

## Three simultaneous views

The editor maintains three related views of one document.

### Authored text

The literal characters currently in the text buffer and, on save, usually in the
file. They express user intent but may omit delimiters, separators, holes,
parameters, or other canonical structure.

Authored text must be preserved exactly. It is not automatically rewritten merely
because the structural interpretation contains more syntax.

### Structural document

The tolerant frontend's explicit interpretation of the authored text. It contains:

- all concrete tokens and trivia;
- ordinary syntax nodes;
- holes and typed fallbacks;
- missing/virtual tokens;
- error and opaque regions;
- recovery and canonicalization marks;
- stable node/recovery identities;
- the relationship between concrete and virtual structure.

This is the canonical editor state. Compiler semantic analysis consumes a
projection of this structure, not the raw text directly.

## There is always a valid structural interpretation

The structural grammar is total. Every finite text buffer maps to a valid
structural document.

“Valid” here means the document is well-formed in the editor's structural domain:

- every required slot contains a concrete node or typed fallback;
- every concrete character is owned by a token, trivia, error, or opaque node;
- every recovery choice is represented by a mark;
- the tree can be traversed, rendered, queried, and edited without exceptional
  missing cases.

It does not mean the authored text is a fully explicit canonical Workman program,
that no error-severity marks exist, or that batch compilation must produce an
executable. Those are separate acceptance questions over an already-valid
structural document.

The Grain implementation already demonstrates this principle:

- expressions, types, and patterns receive holes/wildcards;
- punctuation receives synthetic tokens or marks;
- missing blocks receive structural wrappers;
- unexpected syntax is skipped with progress recovery or retained as opaque
  trivia;
- top-level parsing still returns a `Program`.

Frontend v2 should strengthen the bookkeeping and diagnostics without weakening
this totality. There is no “parse failed, no document” result for user input.

### Rendered structural view

What the user sees when authored text and LSP output are composed:

```text
authored text + structural inlays + diagnostics/decorations
```

This view makes the current interpretation explicit. If the text omits a semicolon,
unit parameter, brace, hole, or separator, the structural view can still show it.
The visible result should answer “what program is the editor currently treating
this as?”

## The file is a suggestion

“The file is a suggestion” does not mean source characters are ignored or that
interpretation may be arbitrary. It means the file is a partial concrete
projection of a richer structural state.

The frontend must deterministically reconcile authored text into a valid structural
document. Omitted structure is represented explicitly in that document. When
several interpretations are plausible, the editor still chooses a valid documented
recovery interpretation, records its uncertainty/alternatives as structural state,
and makes that choice visible rather than silently pretending certainty.

Consequences:

- syntactic completeness is not required before the editor has a program-shaped
  value;
- removing a token may change it from concrete to virtual rather than destroy the
  surrounding tree;
- inserting the token later may materialize existing virtual structure rather than
  create unrelated new structure;
- the saved file can remain concise/flexible while the rendered view is explicit;
- diagnostics describe the distance and uncertainty between authored text and the
  interpreted document.

## Marks are structural state

A mark records a difference between authored text and the structural document, or
a place where interpretation required recovery. Marks are not all equally severe.

### Optional canonical marks

The text has an unambiguous concise form and the editor supplies the canonical
structure. Example from the Grain formatter: an omitted unit parameter displayed as
virtual `()`.

This may be visible only as an inlay or published as an LSP hint. It is still a real
structural mark because the rendered document contains syntax absent from the file.

### Safe completion marks

Required structure is absent, but there is one locally justified completion.
Examples in Grain include missing semicolons and paired braces around a bare body.

These are `AutoFix` marks and typically warning/hint-level diagnostics. The editor
may offer a safe materialization action, but the file need not be rewritten merely
to keep analysis alive.

### Recovery-only marks

The text is damaged or ambiguous enough that the frontend needs a typed fallback
without claiming one correct edit. Missing expressions, types, or patterns often
fall here.

These remain errors even though the structural document is valid enough to inspect,
render, and often typecheck around. The inlay shows the chosen fallback or hole; the
diagnostic explains why it was necessary.

This graded model is why “valid versus invalid text” is not the main editor-state
boundary. The relevant questions are:

- Does a structural interpretation exist?
- How much recovery did it require?
- Which parts are authored, canonical, safely completed, or uncertain?
- Has the editor made every non-authored part visible?

## Structural completeness versus textual completeness

A document can be structurally complete while textually incomplete.

```text
authored:    let main = => print("hello")

structural:  let main = () => { print("hello") };
```

The structural view may show `()`, `{`, `}`, and `;` as inlays. Their exact repair
classes depend on the grammar policy. The compiler can analyze the structural
projection even though those characters are absent from the file.

Conversely, a buffer can contain many concrete tokens that do not form an ordinary
language construct. The valid structural interpretation of that region is then a
marked error/opaque node. The region remains part of the tree and the rest of the
document remains available.

## Inlays are a renderer

The inlay subsystem must not independently guess fixes by diffing raw source. Its
input is the structural document's virtual artifacts:

```text
structural node/mark
  -> virtual token with anchor, order, class, and provenance
  -> LSP inlay hint
```

Properties:

- every inlay refers to structural state and a stable mark/node ID;
- multiple inlays at one anchor retain structural order;
- concrete and virtual tokens are styled differently but compose into one readable
  program;
- hovering or invoking an explanation can reveal why an inlay exists;
- materializing an inlay is an explicit edit, not a prerequisite for analysis;
- deleting a materialized token can restore a virtual token when interpretation
  remains stable.

Type inlays are another projection of the same structural/semantic document. They
must not be confused with structural-token inlays, though the UI may render both.

## LSP is the current display protocol

LSP is used because it lets the structural editor inhabit VS Code and other text
editors without first building a custom frontend. It is not the conceptual model.

Useful LSP projections include:

- inlay hints for virtual syntax and inferred types;
- diagnostics for marks according to severity policy;
- related information explaining recovery evidence;
- code actions to materialize safe completions or choose interpretations;
- hover for holes, marks, types, and structural explanation;
- semantic tokens/decorations to distinguish concrete, virtual, ambiguous, and
  recovery-only structure;
- selection ranges, folding, rename, and navigation based on structural nodes;
- formatting as a projection/materialization policy over the structural document.

Standard inlay hints are non-editable and have UI limitations. A mature structural
editor may require paired commands, code actions, decorations, or a custom editor
extension. Those are transport/rendering limitations, not reasons to weaken the
structural model.

## Edit reconciliation

Each text edit produces a new authored buffer. The frontend reconciles it with the
previous structural document:

```text
previous structural document + text edit + new buffer
  -> new structural document
  -> identity correspondence
  -> changed virtual artifacts and diagnostics
```

The first implementation may reparse the full buffer, but its data model should
allow stable correspondence later. Useful identity rules include:

- concrete nodes retain identity when their structural role and source region are
  recognizably unchanged;
- a virtual token and its later concrete materialization should be matchable as the
  same structural role;
- recovery IDs are version-local unless correspondence is proven;
- stale LSP results are discarded by document version;
- ambiguous rematches prefer correctness and visible change over false identity.

## Persistence

The initial persistence format remains ordinary `.wm` text. Reopening a file
reconstructs its structural document deterministically.

This imposes a rule: any interpretation choice that affects semantics must be
recoverable from text and deterministic context, or be materialized/persisted
explicitly. Ephemeral UI choices cannot silently alter compiled meaning after the
editor closes.

Possible later persistence mechanisms include sidecar metadata or encoded stable
node choices, but they are not required for the first system. Until then:

- deterministic recovery may provide a temporary interpretation;
- ambiguity remains visibly marked;
- user selection that must survive reload becomes a concrete edit;
- batch compilation uses the same frontend policy as the editor.

## Compiler relationship

The structural document owns syntax interpretation. The TypeScript compiler
initially owns elaboration, type inference, module semantics, and Core lowering.

```text
authored text
  -> WM structural frontend
  -> structural document
  -> semantic projection with recovery provenance
  -> TypeScript elaboration/inference
  -> semantic facts attached back to structural IDs
  -> LSP rendering
```

The compiler must know which values came from authored text and which came from
fallbacks. This allows useful analysis around holes while suppressing cascades that
exist only because recovery invented a value.

Batch compilation and editor analysis should not use unrelated parsers. They may
apply different acceptance policies to the same structural result—for example,
batch compilation can refuse recovery-only marks while the editor continues—but
they must agree on the interpreted tree.

## Acceptance criteria

The implementation is behaving like a structural editor when:

- every finite text buffer produces a valid traversable structural document;
- omitted structure remains explicit in that document;
- the composed text-plus-LSP view reveals all semantically relevant virtual
  structure;
- concise text can remain unmaterialized without disabling analysis;
- serious recovery remains visibly distinct from optional canonical completion;
- the same marks drive inlays, diagnostics, explanations, and edits;
- removing or adding punctuation changes concrete/virtual status predictably;
- compiler facts attach to structural identities rather than raw token guesses;
- saving and reopening reconstructs the same semantic interpretation or visibly
  reports ambiguity;
- the system never calls text complete merely because a fallback exists, and never
  calls the structural document unusable merely because the text is incomplete.
