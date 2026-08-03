# Match Refactor Notes

Status: exploratory. This version chooses a small SML-compatible design over
first-class matcher values, coverage types, matcher lists, or runtime
composition protocols.

## Decision summary

- `pattern => body` is an ordinary SML-style pattern lambda.
- A name directly bound to a pattern lambda or arm group may also be referenced
  by a match; there it hygienically expands to its defining arm or arms.
- Expansion happens before exhaustiveness, redundancy, and code-generation
  analysis, so the compiler still sees one ordinary pattern matrix.
- There is no `Matcher` type, coverage row, public `NoMatch`, list of matcher
  functions, or `orElse` protocol.
- `match(value) { ... }` and `match(value) => { ... }` remain parser sugar and
  may be removed later.

## Proposal index

| Proposal | Category | Effect |
| --- | --- | --- |
| [Pattern lambdas](#1-pattern-lambdas) | Existing SML semantics in Workman notation | Generalizes lambda parameters from names to patterns |
| [Named arm and group expansion](#2-named-arm-expansion) | Static Workman extension | Reuses one arm or a statically named arm group |
| [`match { ... }`](#3-anonymous-match-function) | Small retained match form | Builds a function from a statically visible arm list |
| [Existing match forms](#4-existing-match-sugars) | Parser-only sugar | Preserves current syntax during migration |
| [As-patterns](#5-as-patterns-and-the-whole-input) | SML feature to adopt | Replaces the main special benefit of named match functions |

## 1. Pattern lambdas

```wm
let some = Some(x) => { x };
```

This is Workman notation for SML's `fn SOME x => x`. It is an ordinary
function with the ordinary inferred type:

```text
some : Option<A> -> A
```

Calling `some(None)` raises `Match`, exactly as the corresponding SML function
does. It can otherwise be passed and called like any function:

```wm
values :> List.map(Some(x) => { x + 1 });
```

No new matcher semantics are required for this proposal.

## 2. Named arm expansion

The same binding can be referenced as an arm inside a match:

```wm
let some = Some(x) => { x };

let unwrap = match {
  some,
  None => { 0 },
};
```

In arm-list position, `some` expands statically:

```wm
let unwrap = match {
  Some(x) => { x },
  None => { 0 },
};
```

Outside arm-list position, `some` remains the ordinary partial function from
§1. The extension therefore adds reuse without making clauses runtime values.

This resembles F# active patterns in allowing a definition name to participate
in pattern matching, but it is simpler and more static. An F# active pattern is
a recognizer function executed during matching and can compute a new view of
its input. A Workman named arm is instead a hygienic reference to an existing
pattern-and-body template: it performs no recognizer call and introduces no
`Option` result.

### What this enables

Common cases can be named once and assembled into larger matches:

```wm
let mapLeft = Left(x) => { Left(f(x)) };
let keepRight = Right(x) => { Right(x) };

let mapEither = match {
  mapLeft,
  keepRight,
};
```

Ordering is exactly textual after expansion. A named catch-all can shadow
later arms, and the ordinary redundancy checker should report that fact.

### Named arm groups

The same mechanism can retain several arms as a syntax-only group:

```wm
let optionArms = {
  some,
  None => { 0 },
};

let result = Some(1) :> match optionArms;
```

This expands recursively to:

```wm
let result = Some(1) :> match {
  Some(x) => { x },
  None => { 0 },
};
```

An arm-group binding is not a runtime list or a general value. In the minimal
design it is valid only where an arm group is expected: after `match` or as an
entry in another arm group. `match optionArms` is the operation that produces
the ordinary function value. This keeps the expansion fully static while
allowing reusable and extendable groups:

```wm
let specialNumbers = {
  0 => { "zero" },
  1 => { "one" },
};

let numberArms = {
  specialNumbers,
  _ => { "other" },
};
```

## 3. Anonymous match function

```wm
let unwrap = match {
  Some(x) => { x },
  None => { 0 },
};

let result = option :> unwrap;
```

`match { arms }` is the one useful match-function form. Its arms must remain
statically enumerable after named-arm expansion. It lowers to the same
`CoreFn { arms }` representation already used by Workman functions.

Because it is a normal function expression after elaboration, it composes in
pipelines and higher-order calls:

```wm
let result = option :> match {
  some,
  None => { 0 },
};
```

Unlike the earlier proposals, the braces are neither a tuple nor a runtime
list. They delimit syntax that the compiler expands and checks as one match.

This special arm-list syntax is intentional. SML likewise has a dedicated
`pattern => expression | ...` match category. Removing the delimiter entirely
would require patterns or clauses to become general first-class values, which
reintroduces runtime representation, binder hygiene, composition typing,
ordering, and cross-boundary exhaustiveness problems. Named-arm expansion is a
small static reuse feature inside that boundary, not an attempt to erase it.

## 4. Existing match sugars

The current parser hardcodes both of these spellings:

```wm
match(value) { arms }
match(value) => { arms }
```

They add no semantics in this proposal.

Immediate matching expands to pipeline application:

```text
match(value) { arms }
= value :> match { arms }
```

The named match function expands to an ordinary lambda:

```text
match(value) => { arms }
= (value) => { value :> match { arms } }
```

Both forms can remain during migration. If minimizing special grammar is more
important than compatibility, they can later be removed independently.

## 5. As-patterns and the whole input

The remaining advantage of `match(value) => { ... }` is that every arm body can
refer to the complete input. SML as-patterns provide this without a separate
function form:

```wm
let inspect = match {
  Some(x) as option => { (option, x) },
  None as option => { (option, 0) },
};
```

Adding top-level as-patterns would make the named match-function sugar a
stronger candidate for deletion.

## Expansion rules

- Only a direct reference to an immutable binding with retained arm or arm-group
  metadata expands initially. `let alias = some; match { alias }` does not
  implicitly become dataflow analysis; aliases can be added later if useful.
- Arm-group expansion recursively flattens nested groups. Cyclic groups are a
  static error.
- Expansion is hygienic. Pattern binders are freshened, while free names in the
  body keep definition-site resolution and closure behavior.
- Expansion occurs at the arm's textual position and preserves left-to-right
  priority.
- The expanded pattern and body participate normally in type inference,
  exhaustiveness checking, redundancy checking, diagnostics, and formatting.
- A guarded named arm expands with its guard. It contributes no more static
  coverage than the same literal guarded arm.
- Recursive calls in the body remain ordinary calls to the named function;
  they do not recursively trigger arm expansion.
- Cross-module expansion requires exported interface metadata containing the
  elaborated arm template and definition-site identities. A minimal first
  version may restrict named arms to the current module.

## Non-goals

- No coverage rows, constructor refinements, or coverage subtyping.
- No runtime list or tuple of clauses.
- No general first-class-case composition protocol.
- No catching a public `Match` exception to implement fallback.
- No claim that imported or computed function values can be inspected as arms.

## Local grounding

- SML `case` as application of `fn match`:
  [`app1.tex`](../../research/The-Definition-of-Standard-ML-Revised/app1.tex)
- SML closures, match-rule `FAIL`, and exception packets:
  [`dyncor.tex`](../../research/The-Definition-of-Standard-ML-Revised/dyncor.tex)
- SML typing of matches and match rules:
  [`statcor.tex`](../../research/The-Definition-of-Standard-ML-Revised/statcor.tex)
- Current Workman Core representation:
  [`src/core/ast.ts`](../../src/core/ast.ts)
- Earlier, more ambitious first-class-arm research retained for comparison:
  [`research/workman-old/plans/match`](../../research/workman-old/plans/match)

## Related design

F# active patterns allow named recognizer functions to define partitions or
partial views used in pattern position. They are broader than the static named
arm expansion proposed here:
[Microsoft F# active-pattern reference](https://learn.microsoft.com/en-us/dotnet/fsharp/language-reference/active-patterns).
