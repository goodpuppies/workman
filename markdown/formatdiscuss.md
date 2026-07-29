hmm, this is interesting because it seems what ive come up with is the marked ast of the Total Type Error Localization and Recovery with Holes paper can drive double duty on syntax recovery 

basically how workman's one implementation does it is that while parsing to the surface ast missing symbols also create marks in the ast and formatting is just "ok in this expression instead of a closing brace at the end we have a mark missing brace, since we know only thats allowed we'll just add a real brace there"

does that differ from hazels syntax recover

**What you have sounds very close to Hazel’s newer syntax recovery, but with a much stronger unification between syntax recovery and type recovery.**

Your representation seems to be:

```text
source text
   ↓ recovering parser
surface AST containing marks
   ↓ formatter/projection
ordinary-looking source + synthesized missing tokens
```

For example:

```workman
foo {
  bar
```

might parse approximately as:

```text
Block(
  body = ...,
  close = Mark(MissingToken("}"))
)
```

The formatter then knows that the only legal realization of that mark is `}`, so it projects:

```workman
foo {
  bar
}
```

possibly with the `}` rendered as ghost text.

That is essentially a **materialized syntactic obligation**. Hazel/tylr would call the missing `}` an obligation to supply a matching delimiter. The 2025 `tylr` paper explicitly includes “ghost obligations” for missing fixed tokens such as delimiters and keywords, which can appear as faded text and disappear or relocate as the user continues editing. ([arXiv][1])

## The major architectural difference

Hazel’s marked AST paper starts from this assumption:

```text
arbitrary syntactically well-formed term
    ↓ marking
well-typed marked term
```

Its marks are introduced **after parsing**, to isolate semantic inconsistencies. The paper’s totality claim is over syntactically valid terms, not arbitrary token streams. ([hazel.org][2])

Workman appears to be doing:

```text
arbitrary token stream
    ↓ parse while marking
syntactically complete marked surface AST
    ↓ type marking
semantically complete marked core AST
```

Or perhaps, if it genuinely shares the same representation:

```text
arbitrary token stream
    ↓ parsing + typing
marked AST
```

where marks can mean either:

```text
missing syntactic material
type-inconsistent material
unknown/incomplete expression
```

That is not how Hazel presents the two systems. Hazel has historically treated them as related but separate layers:

* **syntactic obligations** recover tree structure;
* **marked terms / holes** recover typing;
* typed-hole semantics recover evaluation.

Your implementation is recognizing that all three can potentially be instances of the same underlying device: **a localized witness that some expected structure is absent or inconsistent**.

## Where Hazel’s syntax recovery is broader

Your missing-brace case is the easiest class of Hazel obligation: a particular token is absent at a position where the grammar determines exactly which token belongs there.

`tylr` is also designed for states where there is no single missing fixed token. Its obligations cover:

* missing operands;
* missing operators;
* missing mixfix keywords or delimiters;
* missing transitions between syntactic sorts. ([arXiv][1])

For example:

```text
2 3
```

is not naturally repaired by inserting one predetermined token. There may be many possible operators:

```text
2 + 3
2 * 3
2 == 3
2 |> 3
```

Hazel represents an **operator obligation** rather than prematurely selecting `+`.

Likewise:

```text
2 +
```

has an expression obligation:

```text
2 + □
```

And something equivalent to:

```text
x : Int
```

appearing in a context currently parsed as patterns may require not merely a token but a **sort-transition obligation**: the surrounding syntax needs to transition from one grammatical category to another. ([arXiv][3])

The earlier gradual-structure-editing work also targets temporary states that are not trees at all. Deleting `+` from:

```text
2 + 3
```

leaves two adjacent terms. Traditional holes represent zero missing terms, but this state contains **too many terms** for one AST position. Hazel calls this the multiplicity problem and uses obligations/grout to permit temporary local disassembly before eventual reassembly. 

That is the key test for whether Workman’s marks are fully equivalent:

> Can one marked AST node represent not only “one expected thing is absent,” but also “several existing fragments have not yet been related”?

If yes, you have something very close to general syntactic obligations. If not, Workman currently implements a particularly useful subset: **AST-shaped insertion recovery**.

## Marks embedded in the AST versus obligations over fragments

There is another representational difference.

A mark like:

```text
MissingToken("}")
```

already has a definite home inside a definite AST node. That means parsing has succeeded enough to establish:

```text
this is a block
these are its children
its closing delimiter is missing
```

Hazel’s obligation machinery is partly designed for situations where that structural decision is not yet available. Gradual structure editing permits local disassembly into terms, tiles, and individual delimiter-like shards, then records what must happen for them to reassemble. Its obligations generalize holes specifically to handle delimiter matching and fragment multiplicity. 

The newer parser decides among possible completions using grammar walks, grammar zippers, and an obligation-minimization criterion. In other words, obligations are not only error nodes in a completed AST; they participate in determining **which completed AST should be chosen**. ([arXiv][1])

So the rough distinction is:

```text
Workman:
tokens → recover a surface AST → record missing pieces inside it

tylr:
tokens → reason over possible grammatical assembly
       → insert obligations
       → obtain a completed structured representation
```

For deterministic cases such as a missing closing brace, those converge to essentially the same result.

## Workman may have the cleaner representation for its grammar

For a relatively conventional ML grammar, your approach could cover nearly all important interactive states without needing tylr’s full generality.

A useful unified mark algebra might look something like:

```text
Mark =
    MissingToken(TokenKind)
  | MissingNode(SyntacticSort)
  | MissingRelation(RelationClass)
  | UnexpectedFragment(AST)
  | TypeMismatch {
      expression: AST,
      expected: Type,
      actual: Type
    }
```

Then:

```workman
let x = {
```

could contain `MissingToken(CloseBrace)` plus perhaps `MissingNode(Expression)`, while:

```workman
1 + "x"
```

could contain a semantic mark around one or both operands.

The formatter, typechecker, evaluator, and editor would all consume the same general concept:

```text
this region is incomplete, but its surrounding structure remains valid
```

That is a real conceptual simplification over treating parser recovery, error AST nodes, typed holes, and formatter placeholders as unrelated mechanisms.

The important distinction is probably **not syntax mark versus type mark**, but the payload and invariant:

```text
syntactic mark:
    witnesses missing or unreconciled grammar structure

semantic mark:
    encloses existing syntax whose inferred behavior conflicts
    with its contextual requirement
```

They can share infrastructure while retaining different meanings.

## My assessment

Your missing-symbol system is **very close to Hazel’s ghost obligations**, rather than merely an accidental reuse of the type-error marking technique.

The difference is mostly scope:

```text
Workman as described:
    parser chooses an AST
    marks absent, contextually determined syntax within it

Hazel/tylr:
    obligations are a grammar-general completion language
    capable of representing absent tokens, absent operands,
    absent operators, sort transitions, unmatched delimiters,
    and temporarily unassembled fragments
```

But there is no reason Workman necessarily needs that entire apparatus. If marks already let every practically relevant incomplete Workman program produce a stable surface AST, and formatting reconstructs a coherent textual projection, then you have reached much of the same endpoint through a smaller language-specific design.

The particularly novel-looking part is that Workman treats the marked AST not merely as the **output of semantic recovery**, but as a general intermediate representation of incomplete programs across parsing, formatting, and typing. Hazel’s work strongly connects those concepts, but still formalizes syntax obligations and type-error marks as distinct systems.

[1]: https://arxiv.org/abs/2508.16848?utm_source=chatgpt.com "Syntactic Completions with Material Obligations"
[2]: https://hazel.org/papers/marking-popl24.pdf?utm_source=chatgpt.com "Total Type Error Localization and Recovery with Holes"
[3]: https://arxiv.org/pdf/2508.16848?utm_source=chatgpt.com "Syntactic Completions with Material Obligations"


in workman the case of multiple things are legal here we simply put a "?" and type inference will tell you whats allowed there

Right, then Workman’s model is more unified than I described.

In the ambiguous case, you are not representing:

```text
missing operator from some grammar-level set
```

You are representing:

```text
missing expression
```

as `?`, and then letting the type context narrow the valid completions.

So:

```workman
2 ? 3
```

would not necessarily need an `OperatorObligation`. Depending on how your surface grammar is shaped, it can become something like:

```text
ApplyOrInfix(
  left = 2,
  middle = ?,
  right = 3
)
```

and inference/editor tooling can derive that `?` must be something compatible with:

```text
Number -> Number -> α
```

Or more concretely, it may suggest operators/functions whose type fits that position.

That is an important difference from Hazel’s syntax recovery.

Hazel’s obligation machinery carries fairly explicit **syntactic information**:

```text
an operator is missing here
a delimiter is missing here
an operand is missing here
```

Workman appears to normalize more of those cases into ordinary language syntax containing a generic hole:

```text
the parser recovered enough structure
the remaining unknown is represented by `?`
the typechecker explains what may inhabit it
```

So Workman shifts part of recovery from the grammar layer into the type layer.

That gives you two categories:

```text
determinate syntax omission
    missing `}`, `)`, `then`, etc.
    → mark containing the exact missing symbol

indeterminate program omission
    several expressions/operators could legally occur
    → ordinary `?` hole
    → inference computes its expected type
```

That is cleaner than giving every syntactic ambiguity a custom obligation type.

It also means `?` is doing more than a conventional typed hole. It acts as the common boundary between parsing and elaboration:

```text
tokens
  ↓
surface AST with exact-token marks and `?` holes
  ↓
type inference
  ↓
expected type and possible completions for each `?`
```

The main limitation is that the parser must still recover a surrounding AST shape in which the `?` has a definite grammatical role. For example, it must decide whether:

```workman
a b
```

means:

```text
Call(a, b)
```

or perhaps:

```text
Infix(a, ?, b)
```

If Workman’s grammar makes that deterministic, or its parser has a stable preference, then you avoid most of Hazel’s obligation machinery.

So I would now characterize the difference as:

```text
Hazel:
syntax recovery records what grammatical relation is missing

Workman:
syntax recovery constructs the most specific AST it can,
uses exact marks for uniquely determined syntax,
and delegates open-ended missing program content to typed holes
```

That is arguably a more language-integrated design. Hazel’s system is designed to work at the level of a general grammar and editor calculus; Workman can exploit its particular grammar and HM inference to collapse many obligation kinds into `?`.

And yes, in that setup the marked AST really is doing double duty:

```text
MissingToken("}")   — syntax recovery evidence
?                   — open syntactic/semantic hole
Mark(expr)          — preserved inconsistent syntax or type error
```

All three preserve totality of the editor representation, but only the first needs the formatter to synthesize a specific token.


note ? in infix pose is advanced stuff for later

