# DSL concept audit against the Revised Definition

This audit checks the proposed initial DSL concepts against
`research/The-Definition-of-Standard-ML-Revised`. It distinguishes concepts stated by the
Definition from implementation abstractions and editor-specific requirements.

The purpose is not to force editor tooling terminology into the Definition. It is to ensure that
the literal SML layer begins with the Definition's own model and that every additional DSL concept
has an explicit reason to exist.

## Classification

- **Direct**: the Definition states the concept or uses it as part of its grammar conventions.
- **Representation**: the Definition contains the underlying idea, but the DSL needs a named data
  representation for it.
- **Editor requirement**: the concept is absent from the Definition and exists only because syntax
  highlighting backends require it.
- **Deferred**: the concept should not enter the initial DSL until an actual transcription or
  emitter demonstrates the need.

## Audit results

| Proposed concept | Classification | Evidence and decision |
| --- | --- | --- |
| Lexical items | Direct | `syncor.tex`, **Lexical analysis**, states that each lexical item is a reserved word, numeric label, special constant, or long identifier. Comments and formatting characters separate items and are otherwise ignored. The DSL should model the Definition's actual lexical classes rather than a generic token list. |
| Longest-item priority | Direct | `syncor.tex`, **Lexical analysis**, explicitly says: “At each stage the longest next item is taken.” This belongs in the literal SML syntax value. |
| Named syntax and phrase classes | Direct | `syncor.tex`, **Grammar**, defines the Core phrase classes `AtExp`, `ExpRow`, `Exp`, `Match`, `Mrule`, `Dec`, `ValBind`, `TypBind`, `DatBind`, `ConBind`, `ExBind`, `AtPat`, `PatRow`, `Pat`, `Ty`, and `TyRow`. The DSL should preserve these names for the literal SML transcription. |
| Terminals | Direct | `syncor.tex`, **Reserved Words**, enumerates alphabetic and symbolic reserved words. Grammar figures combine those literal forms with metavariables over syntax classes. A terminal representation is therefore justified. |
| Lexical classes | Direct | `syncor.tex`, **Special constants**, **Comments**, **Identifiers**, and **Lexical analysis**, defines special constants, formatting characters, comments, `VId`, `TyVar`, `TyCon`, `Lab`, `StrId`, and their long forms. These—not backend scopes—are the starting classes. |
| Ordered alternatives | Direct | `syncor.tex`, **Grammar**, convention 10.3 says alternatives for each phrase class appear in decreasing precedence and that the ordering resolves ambiguity. Alternative order must be preserved, not normalized into an unordered set. |
| Optional components | Direct | `syncor.tex`, **Grammar**, convention 10.2 defines angle brackets around optional phrases. The DSL needs an optional form. |
| Sequences and empty/singleton cases | Direct | The same convention defines `Xseq` as empty, singleton, or a parenthesized comma-separated sequence. Sequence cardinality is part of the source notation and should remain distinguishable where relevant. |
| Repetition | Representation | The Definition presents repeated families through `Xseq`, long forms, rows, and metavariables rather than a single generic repetition operator. The DSL may use repetition internally, but the first transcription should prefer the Definition's named sequence and row classes. Introduce unrestricted repetition only when a rule or emitter needs it. |
| Separated sequences | Representation | Comma-, semicolon-, bar-, and `and`-separated forms occur throughout the grammar and derived forms. A reusable separated representation is reasonable, but separators remain ordinary syntax and the named Definition classes must not disappear behind it. |
| Delimiters | Direct | Parentheses, brackets, braces, commas, colons, semicolons, bars, arrows, and related forms are reserved words and literal components of grammar productions. The DSL needs no special delimiter semantics merely to transcribe them. |
| Regions | Deferred | The Definition does not define a generic region abstraction. TextMate and Sublime may need begin/end contexts for strings, comments, and delimited phrases, but this should enter an emitter model or be introduced only when a shared source construct demonstrably needs it. |
| Precedence | Direct | Alternative order has precedence meaning under convention 10.3. `syncor.tex`, **Infixed operators**, also defines numeric infix precedence, and Appendix 4 gives the precedence relationship between infixed forms and other phrase constructions. |
| Left/right association | Direct | Grammar figures mark forms with `L` and `R`; the grammar conventions define those marks. **Infixed operators** separately defines association attached to fixity status. The DSL must not collapse grammatical association and fixity-environment association into one unexplained flag. |
| “Extends as far right as possible” | Direct | `syncor.tex`, **Grammar**, states that each iterated construct extends as far right as possible. This is a distinct grammar convention and should be preserved if any selected subset rule depends on it. |
| Long identifiers | Direct | `syncor.tex`, **Identifiers**, defines `longX` for classes marked long as either an identifier or a dot-qualified sequence of structure identifiers followed by that identifier. |
| Identifier positions | Direct, with a boundary | `syncor.tex`, **Identifiers**, classifies structure identifiers before `.`, labels at the start of record components, and type constructors elsewhere in types. Other occurrences are `VId` in the revised identifier-status presentation. Distinguishing value variables from constructors can require the static environment; the editor DSL must not claim that literal SML spelling alone always decides that distinction. Workman may deliberately make its translated surface stricter. |
| Highlight roles independent of backend scopes | Editor requirement | The Definition supplies syntax and identifier classes, not colors or highlighting roles. A backend-independent role layer is justified for generation, but it must be a projection from the syntax value rather than part of the literal SML transcription itself. |
| Permissive recovery and fallback | Editor requirement | The Definition does not specify editor recovery. `prog.tex`, **Programs**, explicitly leaves parse-error handling to implementers because it depends on the parser. Permissive recovery is a governing requirement for generated editor syntax, not an SML grammar concept. |

## Corrections to the initial concept list

The Definition directly verifies these concepts for its language grammar:

1. lexical classes and longest-item choice;
2. named phrase classes;
3. terminals and references to syntax classes;
4. ordered alternatives;
5. optional phrases and the Definition's named sequence/row classes;
6. precedence conventions and association marks;
7. long identifiers;
8. source-order or far-right-extension conventions where selected rules require them.

Verification against the Definition does not mean every concept belongs in the shared editor DSL.
The following should not be assumed to belong to that common model:

- generic regions;
- unrestricted generic repetition;
- backend highlight scopes;
- recovery and fallback machinery;
- parser acceptance, semantic actions, or compiler AST construction.
- parser-only precedence, association, and far-right-extension machinery.

Highlight roles and recovery belong to the generation/projection layer. Backend context machinery
belongs to emitters unless multiple targets prove that a shared abstraction is necessary.

The narrower context-free editor boundary is audited separately in
[context-free-audit.md](./context-free-audit.md).

## Important SML/Workman determinism finding

The Definition supports the premise that many identifier classes follow from syntactic position,
but it does not make every `VId` occurrence lexically distinguishable as a variable or constructor.
Literal SML constructor status can depend on the environment introduced by datatype and exception
bindings.

The literal SML editor syntax must remain honest about that ambiguity. The Workman transformation
may remove it through capitalization, explicit binding syntax, pinned patterns, or other stricter
surface rules. Such tightening belongs to the Workman-derived syntax rather than being projected
back into literal SML.

## Sources

- `research/The-Definition-of-Standard-ML-Revised/syncor.tex`
  - Reserved Words
  - Special constants
  - Comments
  - Identifiers
  - Lexical analysis
  - Infixed operators
  - Derived Forms
  - Grammar
- `research/The-Definition-of-Standard-ML-Revised/app4.tex`
  - Appendix: The Core Grammar
- `research/The-Definition-of-Standard-ML-Revised/prog.tex`
  - Programs and implementation-defined parse-error handling
