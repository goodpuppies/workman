# From the syntax DSL to editor formats

## Principle

The source DSL describes editor-visible language structure. It is not written in TextMate regexes,
Tree-sitter combinators, or any other target's vocabulary.

Generation is a small compiler pipeline:

```text
SML or Workman EditorSyntax
          |
          v
normalized syntax graph + highlight roles
          |
          +-- lexical-context lowering --> TextMate / Sublime
          |
          `-- token-tree lowering ------> Tree-sitter grammar
                                           |
                                           `--> Helix / Zed / Neovim queries
                                            `-> Emacs treesit rules
```

The normalized graph is shared. The two lowerings are deliberately different projections of it.
Trying to force both families through one regex-shaped intermediate form would merely move the
current duplication into the generator.

## What the targets actually share

The common information is smaller than a complete parser grammar, but larger than a token list:

- literal tokens, lexical classes, and identifier boundaries;
- longest-token and ordered-match priority, so `=>` wins over `=` and `>`;
- named forms and references between them;
- sequences, alternatives, optional parts, and repetition;
- delimited recursive contexts such as comments, strings, and interpolation;
- highlight roles attached to a whole form or a named component;
- fallback behavior for unfinished constructs;
- delimiter pairs and comment tokens from which editor configuration can also be derived.

This is enough to state facts such as “a `let` binder is a value binding” once, without stating a
TextMate scope, a Helix capture, and an Emacs face independently.

Highlight roles should be a small Workman-owned vocabulary, for example `keyword`, `valueBinding`,
`valueReference`, `type`, `constructor`, `field`, `operator`, `number`, `string`, and `comment`.
Each emitter owns the mechanical mapping from those roles to its target names. A role is not a
promise that every target can identify every occurrence with equal precision.

## Two backend families

### Ordered lexical contexts

TextMate and Sublime Syntax primarily consume patterns and begin/end regions. Their lowering walks
the syntax graph and extracts an ordered set of lexical contexts:

- single-token matches;
- fixed-width local sequences and captures;
- begin/end regions with nested included contexts;
- keyword and literal sets;
- conservative fallback matches when a larger phrase is incomplete.

These targets do not receive a full context-free grammar. If a role requires unbounded syntactic
knowledge that the target cannot express, the emitter emits the nearest sound lexical rule or
leaves the token at its more general role. It must not guess a more specific meaning.

The family still needs one lowering per target because regex dialects and context operations differ.
Those lowerings consume the same lexical-context IR; regex spelling is a serialization concern, not
part of the language DSL.

### Token tree plus queries

Tree-sitter receives a permissive structural projection. Named DSL forms become nodes where that
provides useful stable structure; lexical forms remain tokens. Error recovery and incomplete input
are properties of the generated Tree-sitter grammar, not changes to the language definition.

Highlight roles are emitted separately as logical queries over named nodes and fields. Indentation
and text objects are additional projections from delimiter and region metadata. Helix, Zed, and
Neovim package target `.scm` queries; Emacs receives equivalent generated `treesit` rules in Lisp.

The initial Tree-sitter output should remain shallow. Deeper phrase nodes are added only when an
editor feature or a fixture demonstrates a benefit.

## Capability matrix

| Source fact | TextMate / VS Code | Sublime / Fresh | Tree-sitter consumers | Emacs treesit adapter |
| --- | --- | --- | --- | --- |
| literal and lexical class | match | match | token rule | shared parser node |
| ordered/longest choice | pattern order and combined token regex | context order | lexical precedence | shared parser behavior |
| delimited context | begin/end repository rule | push/pop context | named rule/node | query over parser node |
| recursive nesting | include self where supported | recursive push/include | recursive grammar rule | shared parser behavior |
| local component role | captures | captures | node field + query | generated treesit rule |
| arbitrary CFG phrase | conservative lexical projection | conservative lexical projection | grammar rule | shared parser node + treesit rule |
| incomplete construct | unterminated region/fallback | context/fallback | error recovery | shared parser recovery |
| indentation/text objects | separate editor config or unsupported | separate settings | consumer query adapter | separate generated mode logic, later |

The matrix is a planning contract, not an assertion that similarly named facilities behave
identically. Each emitter needs conformance fixtures for its actual behavior.

## Lowering rules and loss

Every normalized construct is classified during emission as one of:

1. **Exact**: the target can preserve its recognition and role.
2. **Conservative**: the target preserves a broader role or a smaller local pattern.
3. **Unsupported**: emitting a rule would create misleading highlighting, so none is emitted.

Conservative and unsupported decisions are named diagnostics produced by the generator. They are
checked into a readable capability report so a backend cannot silently lose support as the DSL
grows.

An escape hatch is allowed only in a target emitter and only for representation details such as a
regex dialect workaround, a query predicate, or editor metadata. It may not introduce a Workman
token, phrase, or highlight classification absent from the shared syntax value. If multiple
emitters need the same escape hatch, that is evidence for a missing normalized concept.

## Suggested implementation passes

1. Validate names, references, nullable repetition, recursive contexts, and role attachments.
2. Normalize conveniences such as keyword sets and separated repetition into a small syntax graph.
3. Compute lexical conflicts and explicit priority. Reject an unspecified overlap rather than let
   target rule order decide it accidentally.
4. Project the graph to either lexical contexts or a token tree.
5. Map Workman highlight roles to target scopes, captures, or faces.
6. Serialize with a target-specific regex printer or grammar/query printer.
7. Emit a capability report and compare generated artifacts with fixtures.

The normalized graph should retain source form names and provenance. Generated rules can therefore
say which shared form produced them, and test failures can point back to the DSL instead of only to
generated JSON or YAML.

## First emitter experiment

Do not design all target IRs upfront. Use one representative slice containing:

- `let` bindings and references;
- the overlapping operators `=>`, `:>`, `=`, `:`, and `>`;
- strings with escapes and interpolation;
- nested or unfinished comments;
- keywords, constructors, identifiers, and numeric constants.

Lower that slice to TextMate, Sublime Syntax, and the shallow Tree-sitter grammar plus highlight
queries. These three exercise both backend families and the current repository's concrete bugs.
Only after the slice passes shared range fixtures should the Tree-sitter consumer adapters be
expanded from Helix to Zed, Neovim, and Emacs.

## What remains outside the common syntax definition

The generator may own these files, but they are not language grammar:

- file extensions, root scopes, language IDs, icons, and package manifests;
- editor-specific scope/capture/face names;
- regex dialect rendering;
- bracket colorization and auto-closing policy;
- LSP launch configuration;
- installation paths and pinned grammar revisions;
- advanced indentation, folding, selections, and text objects that require target-specific APIs.

Where such metadata is mechanically implied by shared facts, an emitter can derive it. Otherwise it
belongs in a small target configuration beside the emitter, not in the SML or Workman syntax value.
