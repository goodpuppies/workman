# Feature roadmap

This roadmap orders features by daily value and by the semantic infrastructure they require. Every
feature is standard-LSP-first and should use the shared analysis boundary.

## 1. Preserve and unify existing features

Before adding visible behavior:

- route diagnostics and hover through shared snapshots;
- route definition, references, and document symbols through the shared semantic index;
- retain current partial FFI/GPU hover behavior;
- retain dependency-aware revalidation;
- retain contextual GPU completion;
- share type rendering across all existing surfaces.

This is a parity milestone, not a rewrite of feature behavior.

## 2. General completion

This is the first major user-visible feature.

Status: **in progress.** Lexical/prelude values, constructors, type positions, project and basis
namespace members, nominal record fields, keywords, incomplete-source name scopes, contextual GPU
builtins, named-import exports, nearby import paths, prefix ranking, semantic type detail, and
standard `.` triggering are implemented. Compiler-produced expected types rank candidates at
annotations, calls, operators, lambda returns, match arms, nominal record fields, conditional
branches, unary operands, panic messages, recursive bindings, and piped-call arguments. Compiler
origin tiers order local, imported, and basis candidates; declaration-distance ranking refines each
tier. Certifiable expected-type recovery inside otherwise uncertified phrases remains.

### Candidate sources

- lexical local values;
- top-level values visible at the cursor;
- imported and prelude values;
- datatype and record constructors;
- type names in type positions;
- namespace/module aliases;
- members after a namespace qualifier;
- record fields after a resolved nominal record expression;
- importable exported names inside named import clauses;
- import paths;
- language keywords where syntactically appropriate;
- contextual GPU builtins inside GPU regions.

Named-import discovery analyzes the referenced file as a detached compiler snapshot. It therefore
does not enroll a merely mentioned or half-written import in the selected project's reachable graph.
One import spelling may expose separate SML value/constructor/type namespace candidates; those
identities remain distinct and use a deterministic type, constructor, value display order. Path
discovery merges nearby disk entries with unsaved/virtual Workman files and directories.

### Ranking

Rank using:

1. prefix and exact spelling;
2. lexical proximity;
3. local before imported before broad catalog;
4. correct namespace and syntactic context;
5. expected-type compatibility;
6. deprecation/generated/internal status.

Type compatibility should improve ordering. It should not aggressively remove candidates when
expected types or partial inference are uncertain.

The initial implementation records expected-expression types during inference, freezes them into the
module interface, and compares immutable semantic type shapes. Compatible candidates sort first;
unknown and incompatible candidates remain available. This deliberately avoids an LSP-side parallel
constraint system.

### Incomplete source

Completion is most important while the source is incomplete. It must not require a complete strict
parse.

Current compiler-owned recovery may use:

- token/prefix context;
- import scanning;
- declarations/scopes known before the failure boundary;
- frontend-v2 structural facts when available.

The LSP does not use a last-successful fallback snapshot. Current-source compiler facts include the
last certified transactional basis plus name-only scopes from parseable uncertified phrases.

Each completion item should state only facts that remain trustworthy. A stale type detail is worse
than a name-only completion.

### LSP behavior

- return meaningful `CompletionItemKind`;
- use `detail` for compact type/signature information;
- use markdown `documentation` only when useful;
- reserve snippets for constructs where they clearly improve editing;
- support `.` as a namespace/field trigger;
- consider `completionItem/resolve` if eager documentation becomes expensive.

## 3. Ordinary inferred-type inlays

Ordinary type inlays are independent from frontend-v2 structural inlays and must be separately
configurable.

Status: **initial milestone implemented.** The compiler interface owns inferred binding/parameter
facts and source spans. Standard LSP inlays cover top-level and local bindings, useful inferred
lambda parameters, and destructured binders. They omit explicit annotations, unconstrained parameter
variables, and obvious literal bindings. Recovered files expose only transactionally certified
hints.

Initial targets:

- top-level let binders;
- local let binders;
- lambda parameters when inference is useful and no annotation exists;
- destructured binders where a concise type is available;
- optionally record fields whose values obscure the inferred field type.

Parameter-name hints are a separate category:

- tuple/call arguments;
- curried application stages;
- reflected foreign functions with reliable parameter names.

Status: **initial Workman-call milestone implemented.** Compiler-resolved named Workman callables
and nominal record constructors produce standard parameter hints, including calls through named
imports and namespace-independent aliases whose call occurrence retains the exporter `ValueId`.
Record field names provide authored constructor parameter names. An argument already using the
parameter's unqualified name is not repeated. Calls through value aliases without an authored
callable declaration, later curried stages, datatype constructors, and reflected foreign functions
remain unhinted until they have equally reliable compiler metadata.

Policy:

- omit an inlay when the same type is written explicitly;
- avoid repeating obvious literal types unless requested;
- honor the requested range;
- cap or abbreviate long labels using structured rendering;
- provide full type information in the tooltip;
- keep type, parameter, and structural inlays independently configurable;
- never expose generated helper types as if they were source types.

Hole/partial-type hints from `workman-old` are worth revisiting after ordinary type inlays are
stable.

`typeInlayHints`, `parameterInlayHints`, and `structuralInlayHints` are independent initialization
options, with matching `WORKMAN_*_INLAYS` standalone-server fallbacks. Compact type labels and full
tooltips use the shared structured semantic type renderer.

## 4. Navigation and refactoring

### Go to type definition

Use occurrence types and nominal/alias facts to navigate from a value or constructor use to the
relevant type declaration. Return multiple locations only when the type is genuinely composite or
ambiguous.

Implemented: the compiler query traverses immutable semantic type shapes, resolves nominal
`TypeNameId`s through the selected project snapshot, and supports direct type occurrences, inferred
values and constructors, imports, composites, and certified recovered phrases.

### Document highlights

Use the same `SymbolId` as references to mark reads and writes/declarations within the current
document. This is a small feature once symbol roles are reliable.

Implemented: compiler occurrence grouping supplies identity-correct read/write highlights and shares
the local-import-alias selection policy used by rename.

### Workspace references

Expand from the active module graph and open documents to indexed workspace files. The service needs
a workspace occurrence index or a bounded plan for loading candidate modules.

References must distinguish:

- shadowed locals with the same name;
- values versus types;
- constructors versus type names;
- module qualifiers versus members;
- pinned pattern uses versus binders;
- import aliases versus their targets.

### Rename

Implement `prepareRename` before rename. Refuse when:

- the occurrence has no stable symbol identity;
- analysis is too incomplete to find a safe workspace scope;
- the symbol is generated or foreign and cannot be edited safely;
- the requested spelling is invalid for the namespace.

Implemented initial behavior: selecting a local import alias or its use renames only that alias
group; selecting the import source or exported declaration renames the shared target across the
selected project snapshot. `prepareRename` refuses incomplete analysis, non-editable targets,
invalid lexical-category changes, and structurally ambiguous record projections.

## 5. Signature help

Signature help should understand Workman's actual application semantics:

- tuple-shaped single arguments;
- curried functions;
- whitespace application;
- parenthesized application;
- forward pipe;
- constructors;
- reflected foreign calls;
- contextual GPU builtins.

It should share parameter names and type rendering with parameter inlays and hover.

Status: **initial milestone implemented.** Each module interface owns immutable call-site facts with
the compiler-resolved callee type, argument spans, pipe-supplied parameter count, result type, and
reliable authored parameter names. The compiler query selects the innermost active site and returns
a protocol-neutral signature. Standard LSP mapping shares the compact/full semantic type renderer.

Covered application forms are tuple-shaped single arguments, multi-parameter calls, curried
parenthesized and whitespace stages, forward pipe, record constructors, local and named-imported
functions, and nested calls. For a trailing incomplete parenthesized call, compiler-side recovery
may resolve an unqualified or qualified callable from the current certified scope and count only
top-level commas, ignoring strings and comments. It returns no result when the target cannot be
resolved; the LSP never invents a fallback environment.

Still remaining:

- reflected foreign calls once parameter-name metadata is authoritative;
- contextual GPU builtins where signatures improve over completion/hover;
- incomplete later curried stages such as `curried(1)(`;
- optional nullary-call presentation if Workman's `Void` convention needs it.

## 6. Semantic tokens

Semantic tokens improve portability for editors whose TextMate grammar support is absent or limited.

Useful classifications:

- value, function, parameter, type, constructor, record field, module;
- declaration versus readonly/default-library modifiers;
- generated/foreign symbols only when a standard modifier communicates useful meaning;
- pinned pattern references distinct from new binders through token role and modifiers where
  possible.

Semantic tokens should be generated from the semantic index, not a second regex-based highlighter.
Start with full-document tokens; add deltas only after measurement.

Status: **initial full-document milestone implemented.** `ModuleInterface` owns immutable token
facts derived from resolved occurrences, semantic types, and compiler binding roles. Standard LSP
encoding classifies namespaces, types, type parameters, parameters, variables, fields, datatype
constructors, and functions, with declaration modifiers. It includes certified recovered occurrences
and excludes failed phrases.

One source span can introduce several valid SML namespace components, such as a record name or a
same-spelled named import. LSP semantic tokens cannot overlap. The compiler facts retain every
identity; the token presentation selects one exact-span token with deterministic type,
type-parameter, constructor, function/value precedence. This is a protocol display rule, not a
merged Workman namespace.

The initial slice deliberately leaves lexical keywords, literals, comments, and operators to the
editor grammar. Full-document tokens are portable and standard; ranges and deltas should be added
only after persistent snapshot/invalidation measurement.

## 7. Workspace symbols

Index exported and significant top-level declarations across workspace files:

- functions and values;
- datatypes, aliases, and records;
- constructors;
- modules/files.

Do not flood results with every local binder initially.

Status: **initial milestone implemented.** The shared semantic service aggregates top-level module,
value, function, datatype, record, foreign-type, and constructor facts from active headed snapshots
plus currently open detached contexts. It never analyzes or activates every indexed `.wm` file.

Overlapping projects retain separate semantic identities. Identical declaration path/span/kind
entries are deduplicated only in the standard `SymbolInformation` presentation, so a shared library
does not produce duplicate UI rows. Closing the final document releases its context; unrelated
indexed files never appear merely because they share a workspace folder.

## 8. Formatting

Do not add LSP formatting until Workman has one canonical formatter suitable for real source,
including comments and incomplete-source policy.

When ready:

- return standard text edits;
- use the same formatter from CLI and LSP;
- distinguish format from structural repair;
- decide whether malformed input is left unchanged, partially formatted, or rejected;
- support format-on-save without changing program meaning.

WorkmanGR's formatter integration is useful research, but its recovery-derived virtual formatting is
governed by the advanced structural-editor plan.

## 9. Code actions

Start with actions backed by structured diagnostics and unambiguous edits:

- add a missing import when one target is clear;
- materialize an explicitly represented missing token;
- fill a match only when datatype and coverage facts are complete;
- add an inferred type annotation;
- qualify or select an import to resolve a known collision.

Every action must remain safe when invoked by a generic client. Actions that depend on incomplete
inference should be omitted rather than guessed.

## Deferred features

These may be useful later but should not shape the first analysis API:

- folding and selection ranges;
- call hierarchy;
- type hierarchy;
- code lens;
- linked editing;
- inline values;
- pull diagnostics;
- notebook documents.

The query boundary should be extensible without pre-implementing these features.
