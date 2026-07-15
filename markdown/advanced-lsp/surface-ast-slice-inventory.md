# Surface AST slice: WorkmanGR adoption inventory

## Purpose

This document records the `adopt`, `adapt`, or `drop` decision for every WorkmanGR Surface AST,
lexer, recovery, and formatter form considered by the first
[`surface-ast-milestone.md`](./surface-ast-milestone.md) slice.

It is a pre-implementation constraint. The first slice must not grow by mechanically copying an
older constructor, and it must not recreate supported syntax in a TypeScript adapter.

## Decision meanings

| Decision          | Meaning for the first slice                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Adopt`           | Preserve the WorkmanGR concept and substantially the same structural role. Names and WM representation may still change. |
| `Adapt`           | Preserve the architectural idea, but change the shape or semantics for current Workman.                                  |
| `Drop (obsolete)` | Do not port it. The form conflicts with or does not exist in current Workman.                                            |
| `Drop (defer)`    | Do not include it in this slice. A later current-Workman grammar slice must reconsider it independently.                 |

`Drop (defer)` is not a claim that current Workman lacks the feature. It keeps this milestone narrow
and prevents placeholder constructors from becoming accidental architecture.

## Sources reviewed

### WorkmanGR reference

- `C:\Git\workmangr\src\core\surface_ast.gr`
- `C:\Git\workmangr\src\core\error.gr`
- `C:\Git\workmangr\src\frontend\lexer.gr`
- `C:\Git\workmangr\src\frontend\parser.gr`
- `C:\Git\workmangr\src\frontend\formatter.gr`
- `C:\Git\workmangr\tools\lsp_preview.ts`

### Current Workman authority

- [`research/The-Definition-of-Standard-ML-Revised/syncor.tex`](../../research/The-Definition-of-Standard-ML-Revised/syncor.tex)
- [`docs/smlparallels.md`](../../docs/smlparallels.md)
- [`src/grammar.peggy`](../../src/grammar.peggy)
- [`src/ast.ts`](../../src/ast.ts)
- [`docs/wm-minisyntaxguide.md`](../../docs/wm-minisyntaxguide.md)
- [`docs/carriers.md`](../../docs/carriers.md)
- current `examples/`, `std/`, and parser/compiler tests

For this slice, `src/grammar.peggy` and current behavior decide concrete spelling. The SML
references decide overlapping language structure. `src/ast.ts` describes the existing semantic
boundary, not the final user-facing Surface AST.

## SML semantic anchor

Current Workman is an SML implementation with a deliberately small set of surface and semantic
differences. The relevant reference is `research/The-Definition-of-Standard-ML-Revised`, especially
its Core syntax and long-identifier model, together with
[`docs/smlparallels.md`](../../docs/smlparallels.md).

The current Peggy AST sometimes flattens SML structure for implementation convenience. That
flattening is not a Surface AST precedent. For example, `Lambda.params` and `Call.args` are lowered
by [`src/core/from_surface.ts`](../../src/core/from_surface.ts) into one tuple pattern/argument when
their arrays contain multiple elements. The new Surface AST must represent that tuple structure
directly:

- functions are unary abstractions over patterns;
- multiple items inside `(x, y)` form one tuple pattern;
- multiple call items in `f(a, b)` form one tuple argument;
- currying is nested abstraction/application;
- `Lib.printer` is an SML-style qualified/long identifier linking the Core-like language to the
  file-module environment;
- Workman blocks retain their authored brace/terminator surface while representing an SML-shaped
  local declaration and body/result expression.

The planned WMSML/SML subset is verification machinery for this shared language structure, not a
separate user-facing language feature.

The adaptations around that SML center are explicit: current Workman has nominal records, file
imports rather than the full SML module system, pinned bare identifiers in match patterns,
Workman-specific delimiters and type-application spelling, and JavaScript FFI. None changes unary
function abstraction/application.

## Current slice grammar

The adopted slice recognizes these current-Workman forms:

```text
Program       := TopPhrase*
TopPhrase     := (ImportDecl | LetDecl) ";"
ImportDecl    := "from" String "import" ("*" "as" Name)
LetDecl       := "let" Binding
Binding       := Pattern TypeAnnotation? "=" Expr
Pattern       := Identifier | "_" | recovery-hole
Type          := qualified type name | recovery-hole
Expr          := literal | qualified name | application | lambda | block | hole | error
Lambda        := LambdaPattern "=>" Block
LambdaPattern := "()" | "(" TypedPattern ("," TypedPattern)* ")"
TypedPattern  := Pattern TypeAnnotation?
Block         := "{" terminated-item* result? "}"
Application   := Expr Argument
Argument      := whitespace Expr | "(" Expr ("," Expr)* ")"
```

`LambdaPattern` denotes one pattern. Zero items represent the Workman spelling of unit/void, one
item represents that pattern, and multiple items represent one tuple pattern. Likewise an explicit
call with multiple items constructs one tuple argument.

The implementation may support already-proven adjacent cases when doing so requires no extra
secondary parser, but those cases do not expand the milestone gate.

## Core identity and source forms

| WorkmanGR form             | Decision     | Current-Workman slice form and rationale                                                                                                                                       |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Node { id, span }`        | Adapt        | Keep a parse-local stable node ID and UTF-16 source span. Add recovered/concrete provenance where the node itself is synthetic.                                                |
| `Name { node, text }`      | Adapt        | Use SML-style identifiers and long identifiers. A qualified identifier is a non-empty structure/module path plus terminal identifier with its own span, not one dotted string. |
| `HoleOrigin.UserTyped`     | Adopt        | Authored `?` remains distinct from recovery. It may not lower through the strict compiler yet, but it is valid Surface AST state.                                              |
| `HoleOrigin.Inferred`      | Adopt        | Missing required pattern/type/expression slots receive inferred holes.                                                                                                         |
| `HoleKind.ExprHole`        | Adopt        | Required for `let main =` recovery.                                                                                                                                            |
| `HoleKind.PatternHole`     | Adopt        | Required for a missing binding or parameter pattern.                                                                                                                           |
| `HoleKind.TypeHole`        | Adopt        | Required when a present annotation lacks a type.                                                                                                                               |
| `HoleKind.NameHole`        | Adapt        | Keep for missing import aliases and names, with a recovery ID that cannot resolve as an authored binding.                                                                      |
| `AtomLiteral.Int/Bool/Str` | Adapt        | Preserve the concepts and add current Workman `Float` and `Void`. Preserve authored spelling separately from decoded value where diagnostics/formatting need it.               |
| `AtomLiteral.Char/Byte`    | Drop (defer) | Not needed by the slice; reconsider only against current grammar.                                                                                                              |
| `AtomLiteral.Unit`         | Adapt        | Current value spelling and semantic node are `void`; do not import Grain unit spelling.                                                                                        |

## Trivia and authored islands

| WorkmanGR form                                | Decision        | Current-Workman slice form and rationale                                                                                                        |
| --------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `TriviaKind.LineComment`                      | Adapt           | Preserve both current `--` and `//` spellings and their authored text.                                                                          |
| `TriviaKind.BlockComment`                     | Drop (defer)    | Current grammar does not establish a block-comment form for this slice.                                                                         |
| `TriviaKind.Opaque`                           | Adopt           | Retain bounded unclassified authored syntax so later declarations remain traversable.                                                           |
| `TriviaPlacement.Gap`                         | Adapt           | Use attachment between structural neighbors; original whitespace is not part of the identity.                                                   |
| `TriviaPlacement.Island`                      | Adopt           | Preserve block/top-level opaque or comment regions that format as their own structural item.                                                    |
| `Attachments { leading, trailing, dangling }` | Adopt           | Use on nodes where comment ownership matters. Exact attachment rules need golden tests, not formatter guesses.                                  |
| Whitespace as retained tokens                 | Drop (obsolete) | The bootstrap lexer may continue exposing it temporarily, but the canonical Surface AST and formatter do not preserve authored spaces/newlines. |

## Lexer and delimiter forms

| WorkmanGR form                         | Decision        | Current-Workman slice form and rationale                                                                                                                             |
| -------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate name/constructor tokens       | Adapt           | Keep current identifier/constructor distinction, while qualified names are assembled structurally from segments and periods.                                         |
| Number/string/bool tokens              | Adapt           | Add current float, quoted string, multiline string, and `void` behavior. Preserve malformed tokens as marked lexical nodes.                                          |
| `LParen/RParen`                        | Adopt           | Required for lambda patterns, tuple patterns/arguments, application, and grouping. Store explicit pair identity.                                                     |
| `LBrace/RBrace`                        | Adapt           | Required as concrete-or-missing paired delimiters owned by the block node. WorkmanGR token mates are the reference, but pair identity must also cover virtual mates. |
| `FatArrow`                             | Adopt           | Current lambda arrow is `=>`. Missing-arrow recovery is deferred unless required by a milestone edit state.                                                          |
| `SemiColon`                            | Adapt           | Represent a concrete or missing declaration/item terminator with recovery provenance. Do not reduce it to a boolean.                                                 |
| `Comma`                                | Adapt           | Commas belong to tuple pattern/argument structure, not a multi-parameter function or `BlockItem.Comma`.                                                              |
| `Colon`, `Star`, `Period`, `Eq`        | Adopt           | Required by annotations, namespace imports, qualified names, and bindings. They retain spans or missing-token recovery where applicable.                             |
| `LineComment` token                    | Adapt           | Preserve exact current comment spelling and convert it into attached/island trivia.                                                                                  |
| `Opaque` token                         | Adopt           | Preserve exact text and produce a marked surface error/island when it cannot be classified.                                                                          |
| `EOF`                                  | Adopt           | Required as a synchronization boundary and insertion anchor.                                                                                                         |
| `Token.mate`                           | Adapt           | Generalize into a stable delimiter-pair identity reachable from both concrete and missing delimiter nodes. Consumers must not rescan raw source.                     |
| WorkmanGR ASCII-only byte lexer        | Drop (obsolete) | Current offsets must support Unicode and agree with the JavaScript/LSP UTF-16 boundary.                                                                              |
| WorkmanGR dummy lexer mark with ID `0` | Drop (obsolete) | Every lexical recovery receives a real unique recovery ID and joins the normal mark/diagnostic result.                                                               |

Braces inside strings, comments, and opaque islands never enter the delimiter pairing stack.

## Expression forms

| WorkmanGR `ExprKind`   | Decision        | Current-Workman slice form and rationale                                                                                                                                                                |
| ---------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Lit`                  | Adapt           | Structured current literals: int, float, string, bool, and `void`.                                                                                                                                      |
| `Ident(Name)`          | Adapt           | `NameExpr(LongValueIdentifier)`. `Lib.printer` is an SML-style qualified identifier, not a postfix field projection.                                                                                    |
| `Apply(callee, arg)`   | Adopt           | This is the SML application model. `Lib.printer x` has one argument; `f(a, b)` has one tuple argument; `f(a)(b)` is nested application.                                                                 |
| `Fn(FnExpr)`           | Adapt           | Preserve WorkmanGR's function-rule direction, but the first slice constructs one rule whose domain is one pattern. Multiple tuple elements are a tuple pattern; currying is nested `Fn`.                |
| `Block(Block)`         | Adapt           | Store paired `{`/`}`, terminated items, final result, trivia, and recovery provenance.                                                                                                                  |
| `Paren(Expr)`          | Adapt           | Retain paired parentheses as surface syntax even when semantic lowering erases grouping. Lambda-pattern and application parentheses own tuple/void interpretation rather than parameter/argument arity. |
| `Hole(Hole)`           | Adopt           | Supports authored and inferred expression holes.                                                                                                                                                        |
| `Annotate`             | Adapt           | Lambda annotations are typed patterns in the SML model; binding annotations remain attached to the binding/pattern surface. A general expression annotation needs a later current-grammar decision.     |
| `Cast`                 | Drop (defer)    | Outside the slice.                                                                                                                                                                                      |
| `Match`                | Drop (defer)    | Current Workman supports it, but it is not needed for this ownership proof.                                                                                                                             |
| `ArrowPrefix`          | Drop (defer)    | Current `=> body` sugar denotes abstraction over an inferred void/unit pattern, not a zero-arity function. The fixture uses an explicit pattern; reconsider the sugar with its own recovery policy.     |
| `InfixChain`           | Drop (defer)    | Current operators require a later precedence-aware Surface AST slice.                                                                                                                                   |
| `Postfix`              | Drop (defer)    | Ordinary `f(a, b)` is `Apply(f, Tuple(a, b))`, not a postfix multi-argument call. Projection/indexing/FFI postfix forms are later; qualified names must not use this constructor.                       |
| `Tuple`                | Adapt           | Required to prove the SML function/application model: `(x, y)` is one tuple pattern/value and `f(a, b)` supplies one tuple argument.                                                                    |
| `List`, `RecordLit`    | Drop (defer)    | Current forms exist but are outside this milestone.                                                                                                                                                     |
| `Seq`                  | Drop (obsolete) | Current block structure explicitly separates terminated items and a final result; do not add a parallel sequence representation.                                                                        |
| `If`                   | Drop (defer)    | Outside the slice.                                                                                                                                                                                      |
| expression-level `Let` | Drop (obsolete) | Current local lets are block declarations/items, not a separate `Let(binding, body)` expression form.                                                                                                   |
| `Assign`               | Drop (defer)    | Outside the slice and must be checked against current syntax before porting.                                                                                                                            |
| `Expr.attach`          | Adopt           | Required for comment ownership and canonical formatter output.                                                                                                                                          |

## Functions, patterns, currying, and blocks

| WorkmanGR form                    | Decision        | Current-Workman slice form and rationale                                                                                                                                             |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FnClause`                        | Adapt           | Keep the core idea of one pattern and one body. Drop guards for this slice. Current `(x, y)` supplies one tuple pattern to the rule.                                                 |
| `FnItem.Clause` / `FnExpr.items`  | Adapt           | Keep a rule-oriented `SurfaceFn`; the first slice has exactly one rule. This remains extensible to Workman's match-function/SML verification work without inventing parameter arity. |
| `FnItem.Include`                  | Drop (obsolete) | No current-slice equivalent.                                                                                                                                                         |
| `FnItem.Trivia/Hole`              | Adapt           | Trivia attaches to function/rule/pattern/body nodes; a missing body is an expression/block fallback, not a fake parameter.                                                           |
| WorkmanGR single `FnClause.param` | Adopt           | A function rule abstracts over one pattern. Parenthesized multiple binders become one tuple pattern; `()` becomes the void/unit pattern.                                             |
| `FnClause.guard`                  | Drop (defer)    | Current slice has no guards.                                                                                                                                                         |
| `Block { node, items, body }`     | Adapt           | Keep WorkmanGR's items plus body/result shape, add explicit opening/closing delimiter nodes, and lower it as Workman's SML-shaped local declaration/sequencing expression.           |
| `BlockItem.ExprItem`              | Adapt           | Distinguish a terminated expression item from the final unterminated result expression.                                                                                              |
| `BlockItem.LetItem/DeclGroup`     | Drop (defer)    | Current blocks allow local declarations, but the initial fixture only needs a final expression. Add them in the next block slice.                                                    |
| `BlockItem.Semicolon`             | Adapt           | Attach the concrete/missing terminator to its preceding item rather than storing punctuation as an unrelated item.                                                                   |
| `BlockItem.Comma`                 | Drop (obsolete) | Commas belong to their owning lists/arms, not general current block items.                                                                                                           |
| `BlockItem.MarkItem`              | Adopt           | Keep explicit ordered marks when missing/unexpected syntax is itself a surface item.                                                                                                 |
| `BlockItem.TriviaItem`            | Adopt           | Preserve block-scale comments and opaque islands.                                                                                                                                    |
| `BlockItem.Directive`             | Drop (defer)    | Outside the slice.                                                                                                                                                                   |

## Pattern forms

| WorkmanGR `PatternKind` | Decision        | Current-Workman slice form and rationale                                                                            |
| ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `Hole`                  | Adopt           | Missing parameter/binding patterns receive a typed fallback linked to one mark.                                     |
| `Wildcard`              | Adopt           | Current `_` pattern.                                                                                                |
| `Var(Name)`             | Adapt           | Current binding and lambda-pattern variables use a structured unqualified identifier and current SML scoping rules. |
| `Pin(Name)`             | Drop (defer)    | Current general patterns support pinned names, but the slice does not require them.                                 |
| `Lit`                   | Drop (defer)    | Current let patterns support literals, but they are outside this slice.                                             |
| `Tuple`                 | Adopt           | Required for lambda domains and tuple arguments. It is one pattern, never a list of function parameters.            |
| `Constructor`, `List`   | Drop (defer)    | Outside the slice.                                                                                                  |
| `AllErrors`             | Drop (obsolete) | Do not import the WorkmanGR-specific sentinel into current Workman. Use explicit error/hole patterns.               |
| `Pattern.attach`        | Adopt           | Required for comment ownership and formatter behavior.                                                              |

## Type forms

| WorkmanGR `TypeExprKind`     | Decision        | Current-Workman slice form and rationale                                                                                                                          |
| ---------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Hole`                       | Adopt           | A syntactically present but missing annotation type receives a typed fallback and mark.                                                                           |
| `Var(Name)`                  | Drop (defer)    | Current type variables exist, but the primary fixture only needs `String`.                                                                                        |
| `Ref(Name, args)`            | Adapt           | Use `TypeName(LongTypeIdentifier, args)`. The slice requires a zero-argument named type; generic arguments remain structurally representable if inexpensive.      |
| `Tuple`                      | Adapt           | Required when annotations are added to tuple domains; preserve it as one type.                                                                                    |
| `Arrow`                      | Adapt           | Model a unary function type from one domain type to one result type. `(A, B) => C` has tuple domain; currying nests arrows. Full annotation coverage is deferred. |
| `Record`, `Ptr`, `EffectRow` | Drop (defer)    | Reconsider only from current Workman grammar/docs, not WorkmanGR precedent.                                                                                       |
| `UnitType`                   | Drop (obsolete) | Current named `Void`/other type spelling should be represented according to current grammar, not a Grain-specific unit constructor.                               |
| `TypeExpr.attach`            | Adopt           | Required for comments and canonical formatting.                                                                                                                   |

## Imports, declarations, and top-level forms

| WorkmanGR form                                                    | Decision        | Current-Workman slice form and rationale                                                                                                                                                                        |
| ----------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ImportDecl { modulePath, alias, names }`                         | Adapt           | Use a tagged current clause: `Namespace(alias)`, `All`, or `Named(specs)`. The slice requires `Namespace`. Preserve the path literal node separately from its decoded value.                                    |
| `ImportName`                                                      | Adapt           | Retain for the later named-clause case as `{ name, alias? }`; it is not used by namespace import.                                                                                                               |
| `ReexportDecl`                                                    | Drop (obsolete) | Current slice has no re-export syntax. Do not infer it from default exports.                                                                                                                                    |
| `Export`                                                          | Drop (obsolete) | The keyword was removed. Current top-level declarations export by default. No `SurfaceExport`, exported modifier, or export mark is permitted.                                                                  |
| `LetDecl`                                                         | Adapt           | Current node owns `recursive`, one or more bindings, and a concrete/missing top-level terminator. No exported flag is needed in the Surface AST.                                                                |
| `LetBinding`                                                      | Adapt           | Keep pattern, optional annotation, equals token, and structured value. `hasEq: Bool` becomes a concrete-or-missing token/fallback.                                                                              |
| `DeclGroup.LetGroup`                                              | Adapt           | Current `let rec ... and ...` remains one recursive value-binding group in the SML tradition. The slice accepts one non-recursive binding but chooses a shape that can later add the group without replacement. |
| `DeclGroup` exported flag                                         | Drop (obsolete) | Export is the current default, not authored surface syntax.                                                                                                                                                     |
| `TypeDecl`, `RecordDecl`                                          | Drop (defer)    | Current forms exist but are outside this slice.                                                                                                                                                                 |
| `InfixDecl`, `PrefixDecl`, domain/policy/op/annotate declarations | Drop (obsolete) | Do not port WorkmanGR-only forms. Any future current operator declaration must start from current syntax authority.                                                                                             |
| `Directive`                                                       | Drop (defer)    | Current directive/FFI policy needs a separate inventory.                                                                                                                                                        |
| `TopItem.Import`                                                  | Adapt           | Current `SurfaceTopItem.Import`.                                                                                                                                                                                |
| `TopItem.DeclGroup`                                               | Adapt           | Current `SurfaceTopItem.Let`; avoid a generic group whose variants are mostly obsolete.                                                                                                                         |
| `TopItem.Mark`                                                    | Adopt           | Required for ordered top-level recovery state.                                                                                                                                                                  |
| `TopItem.Trivia`                                                  | Adopt           | Required for comments and opaque islands.                                                                                                                                                                       |
| `TopItem.Reexport/Export`                                         | Drop (obsolete) | Not current syntax.                                                                                                                                                                                             |
| `Program { items, core }`                                         | Adapt           | Keep ordered items; drop WorkmanGR `core` state unless a later current directive explicitly requires an equivalent.                                                                                             |

## Marks and diagnostic forms

| WorkmanGR form                                             | Decision        | Current-Workman slice form and rationale                                                                                                                   |
| ---------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExpectedKind`                                             | Adapt           | Keep typed expected categories and use current rule/premise names. Add name and delimiter-pair specificity where useful.                                   |
| `RepairClass.AutoFix`                                      | Adopt           | Missing semicolon or uniquely justified delimiter insertion can be safely materialized.                                                                    |
| `RepairClass.OptionalCanonical`                            | Adopt           | Retain the distinction even if this fixture produces none.                                                                                                 |
| `RepairClass.RecoveryOnly`                                 | Adopt           | Required for holes, malformed tokens, and ambiguous damage.                                                                                                |
| `Mark { node, kind, expected, repairClass, repairPairId }` | Adapt           | Preserve syntax identity and pair ID, while retaining v2 recovery ID, rule path, expectation, observation, fallback, ordering, severity, and dependencies. |
| `UnknownTopLevel/InvalidTopLevel`                          | Adapt           | Use a marked opaque/error top-level item that retains concrete text.                                                                                       |
| `MissingSemicolon`                                         | Adopt           | Primary fixture recovery.                                                                                                                                  |
| `MissingRBrace`                                            | Adapt           | Generalize to a missing close-delimiter mark tied to the block's pair identity; retain a brace-specific stable code.                                       |
| `MissingToken`                                             | Adopt           | Used for missing `{`, `}`, `=`, `:`, arrow, or list punctuation as the supported grammar grows.                                                            |
| `MissingExpr/Pattern/TypeExpr/Block`                       | Adopt           | Typed fallback categories are required by the milestone.                                                                                                   |
| `UnexpectedToken`                                          | Adopt           | Required for a stray `}` and bounded progress recovery.                                                                                                    |
| `FormattingMismatch`                                       | Drop (obsolete) | Original whitespace/newline differences are not marks. Canonical formatting is emergent from the Surface AST.                                              |
| `MarkedError` pairing                                      | Adapt           | Preserve the one mark/diagnostic identity but return it in the parse result. Do not use side-channel global lists.                                         |
| `createMarkedError(..., recovery)` control-flow idea       | Adopt           | A required-slot helper records/returns the mark and category-correct fallback while parsing continues. Implement explicitly/purely in parser state.        |
| Global `diagnostics` / `markedDiagnostics` buffers         | Drop (obsolete) | Frontend v2 returns marks and diagnostic facts as result data.                                                                                             |

For a bare body that requires both `{` and `}`, create two missing-token recovery IDs and one shared
repair-pair ID. For an authored `{` with only `}` missing, create only the missing-close recovery.

## Formatter and reprojection decisions

| WorkmanGR behavior                                 | Decision        | Current-Workman slice behavior                                                                                 |
| -------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| Surface AST drives formatting                      | Adopt           | The tree, not authored whitespace, owns the visible legal shape.                                               |
| Marks render virtual syntax                        | Adopt           | Missing braces/semicolon/hole render from their mark/fallback nodes.                                           |
| Delimiter-aware block formatting                   | Adapt           | Use explicit concrete-or-missing delimiter pairs rather than searching block items for a `MissingRBrace` mark. |
| Comment/opaque trivia emission                     | Adapt           | Preserve meaningful text using current attachment/island rules.                                                |
| Formatter repairs whitespace mismatches with marks | Drop (obsolete) | Whitespace/newlines are always formatter-owned and do not require recovery evidence.                           |
| Marked preview/inlay projection                    | Adopt           | Derive from formatter pieces and recovery provenance, adapted to the current LSP DTO.                          |
| Exact original source reproduction                 | Drop (obsolete) | Debug token rendering may remain, but Surface-AST structural equivalence is the formatter invariant.           |

## Selected slice schema

The implementation may choose different WM spelling, but it must preserve this ownership graph:

```text
SurfaceProgram
  items: List<SurfaceTopItem>
  marks: canonical recovery table/result data

SurfaceTopItem
  Import(SurfaceImportDecl)
  Let(SurfaceLetDecl)
  Mark(RecoveryId)
  Trivia(SurfaceTrivia)
  Error(SurfaceErrorItem)

SurfaceImportDecl
  fromToken
  pathLiteral
  importToken
  clause: Namespace(alias) | All | Named(specs)
  terminator: ConcreteOrMissingToken

SurfaceLetDecl
  letToken
  recursive
  bindings: non-empty List<SurfaceBinding>
  terminator: ConcreteOrMissingToken

SurfaceBinding
  pattern: SurfacePattern
  annotation: Option<SurfaceTypeAnnotation>
  equals: ConcreteOrMissingToken
  value: SurfaceExpr

SurfacePattern
  Var(identifier)
  Wildcard
  Void
  Tuple(non-empty items)
  Typed(pattern, type)
  Hole(origin, RecoveryId?)
  Error(retained region, RecoveryId)

SurfaceExpr
  Literal
  Name(LongValueIdentifier)
  Apply(callee, argument)
  Tuple(items)
  Fn(rule: { pattern, arrow, body })
  Block(SurfaceBlock)
  Paren(PairedDelimiter, expression)
  Hole(HoleOrigin, RecoveryId?)
  Error(retained region, RecoveryId)

SurfaceBlock
  braces: PairedDelimiter<"{", "}">
  items: List<SurfaceBlockItem>
  result: SurfaceExpr

PairedDelimiter
  pairId
  open: ConcreteToken | MissingToken(RecoveryId)
  close: ConcreteToken | MissingToken(RecoveryId)
```

Every missing token or fallback points to one canonical recovery mark. Every canonical mark points
back to its fallback or retained error region.

## Decisions intentionally left for later inventories

The first slice makes no architectural promise for:

- match and multi-clause function representation;
- precedence-preserving infix trees;
- indexing, FFI projection, records, lists, and JSON beyond the tuple/application forms selected
  here;
- local block declarations;
- recursive `and` group formatting beyond keeping the selected let shape extensible;
- type variables, generics, full tuple/function annotation syntax, and type/record declarations
  beyond the unary domain/codomain invariant recorded here;
- carrier/lift Surface AST representation;
- JavaScript imports and reflection annotations;
- directives;
- code actions beyond missing brace/semicolon materialization.

Each later slice must extend this inventory using current Workman as its authority.

## Inventory completion result

The slice should begin implementation with these non-negotiable choices:

1. Surface AST identity is syntactic, not byte/whitespace identity.
2. Qualified names are structured names, not dotted strings or postfix projections.
3. Functions are unary abstractions over patterns; tuple domains and currying remain explicit SML
   structure rather than parameter counts.
4. Applications are unary; tuple arguments and nested curried applications remain explicit.
5. Blocks own explicit concrete-or-missing delimiter pairs while retaining their SML-shaped local
   declaration/body meaning.
6. Current blocks retain terminated surface items and a final result expression.
7. Missing paired braces use two recovery marks and one repair-pair identity.
8. Marks remain reachable syntax state and generate diagnostics/inlays/repairs.
9. The removed `export` keyword has no Surface AST representation.
10. Canonical formatting owns spaces/newlines and is derived from the Surface AST.
11. Supported nodes lower structurally; TypeScript does not reparse their text.
