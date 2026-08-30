# Issue: Frontend v2 Is Not Yet Single-Pass Structural Parsing

Status: design gap

## Intended model

Workman has one canonical grammar. Parsing constructs that canonical structure in one pass.
Whenever an expected structural token is absent, the parser records a missing-token mark in the
same slot where an authored token would have appeared.

There is no separate recovery grammar and no privileged collection of named shorthands. Surface
forms with omitted structure emerge from the ordinary grammar because any number of structural
slots may be represented by marks.

For example, if the canonical lambda shape is:

```wm
(parameters) => { body }
```

then parsing:

```wm
x => x
```

should construct the same lambda Surface node as the canonical spelling, with marks for the absent
`(`, `)`, `{`, and `}` tokens. Parsing `=> x` should additionally construct the canonical empty
parameter list by marking both parameter-list delimiters.

The parser does not search among or rank possible completions. Authored tokens determine one
canonical structure. A structural slot is either authored or marked missing. If the input does not
determine one valid structure, parsing fails.

The completed Surface tree is the common authority for semantic projection, formatting, LSP
diagnostics, structural inlays, and a future `wm inlay` debugging command.

## Current frontend-v2 model

Frontend v2 does not currently implement that model.

The generated recognizer first tries rules with recovery disabled and then retries selected rules
with recovery enabled. `matchCommittedRule` in
`tooling/frontend-v2/compiled_probe_runtime.wm` implements this strict-then-recovery behavior.

Recovery is enabled only for explicitly annotated `(rule, token)` pairs from
`tooling/frontend-v2/generator/recovery_annotations.ts`. The current annotations cover `;`, `{`,
and `}` at selected grammar sites. `src/lsp/surface_recovery.ts` repeats the same token restriction
in its `committedTokens` set before exposing marks as diagnostics and inlays.

Consequently, the current implementation says, in effect:

```text
this particular token in this particular rule may be recovered
```

rather than:

```text
this required structural slot is authored or marked missing
```

## Observable mismatches

### Parsing happens under two modes

`matchCommittedRule` calls a rule once with recovery disabled and, after failure, calls it again
with recovery enabled. A recovered parse is therefore a second interpretation rather than the
same canonical derivation carrying token provenance.

This makes strict and structurally incomplete source follow different control flow and allows the
second attempt to interact with repetition and alternative selection differently.

### Recoverable structure is enumerated manually

Only annotated literal occurrences may become `MissingCompiledCapture` values. Adding another
kind of structural omission currently requires all of the following:

- adding rule/token recovery annotations;
- ensuring the generated runtime treats that literal as recoverable;
- adding the token to the LSP's `committedTokens` set;
- adding token-specific diagnostic naming and codes;
- updating formatter and generated-recovery expectations.

This does not produce the theoretically unbounded family of structurally incomplete surface forms
from the canonical grammar. It produces a maintained list of accepted omissions.

### Lambda parameter omissions are not represented structurally

The current lambda grammar has two alternatives: one with `ParamList`, and a second with no
parameters. Thus `=> { ... }` is an ordinary authored grammar alternative. It is not the canonical
`() => { ... }` structure with missing `(` and `)` marks.

Likewise, `x => { x }` can be accepted by the generated program parser without becoming a lambda
whose parameter-list delimiters are marked. In observed behavior it can be fragmented as a
completed `let f = x` phrase followed by a separate zero-parameter lambda phrase. Downstream
semantic analysis then reports `unknown name x`, and structural inlays describe the fragmented
parse rather than the intended lambda.

### Local recovery can commit the wrong enclosing structure

Opening-brace recovery uses punctuation checks in `matchRecoverableOpeningBrace`, rather than a
canonical structural derivation. For example, source shaped like:

```wm
let f = () x;
```

can receive missing block-brace marks even though the authored tokens do not contain a lambda
arrow. This demonstrates that a locally insertable delimiter is not enough to establish the
intended enclosing construct.

### Synchronization descriptions are not executable

Recovery annotations contain `after` and `synchronizeAt` descriptions. The generator contract
checks that these strings are present, and the recognizer manifest records them, but the generated
recognizer does not use `synchronizeAt` to control parsing. They are currently documentation and
validation metadata, not structural parsing semantics.

### Delimiter relationships are not represented

Structural LSP hints currently report `pairId: 0` for every mark. Opening and closing delimiters do
not retain a relationship derived from their containing grammar node. The system therefore cannot
reason about or debug the completed structure as groups of related slots.

### Parser failure and successful marked parsing can disagree

`parseSurfaceProgram` may return a marked Surface tree while `parseSurfaceFailure` still describes
the failure from the strict attempt. This is useful for some diagnostics today, but it exposes the
fact that the successful tree and reported failure came from separate parser executions.

## What should remain

Several frontend-v2 pieces already fit the intended direction and should not be discarded:

- missing terminals are represented explicitly as recovery captures and Surface marks;
- marks retain an insertion anchor, expected text, and provenance site;
- the lossless Surface tree is shared by formatting and semantic projection;
- `wm fmt --fix` can materialize marked terminals;
- the LSP consumes generated Surface marks directly instead of rediscovering them from source;
- the self-hosted generated frontend provides one runtime authority for compiler, formatter, and
  editor behavior.

The design gap is primarily in recognition and commitment, not in the existence of marks or the
Surface boundary.

## Direction of travel

Before changing lambda syntax, frontend v2 should move toward these invariants:

1. A required structural terminal is matched as either an authored token or a missing marked token
   during the ordinary parse.
2. There is no strict parse followed by a recovery parse.
3. The canonical grammar, rather than a rule/token allowlist, determines the available structural
   slots.
4. Marks cannot make the parser abandon authored tokens, split an intended construct into extra
   phrases, or select a different semantic production.
5. The result is either one canonical Surface structure or a parse failure.
6. Formatting, inlays, fixes, diagnostics, and CLI inspection all consume the same marks from that
   structure.

The first implementation step should be to reproduce the existing accepted missing-`;` and
missing-brace cases through a single parsing path. Lambda parentheses and bodies can then exercise
the general mechanism rather than introducing new lambda-specific recovery behavior.

## Regression probes for the redesign

The redesign should make the following distinctions explicit:

```wm
let main = () => { print("ok") };  -- fully authored canonical structure
let main = () => print("ok")       -- same structure with missing body delimiters/terminator
let main = => print("ok")          -- same structure with missing parameter and body delimiters
let id = x => x                    -- same structure with all four lambda delimiters marked
let value = () x;                  -- failure: authored tokens do not determine a lambda
let value =;                       -- failure: structural marks cannot invent an expression
```

For every successful case, tests should assert:

- one semantic lambda node, not multiple top-level phrases;
- the exact authored/missing provenance of structural slots;
- stable insertion anchors and ordering;
- identical semantics before and after materializing marks;
- idempotent canonical formatting after materialization;
- identical structural artifacts from the formatter, LSP, and `wm inlay` preview.

## Relationship to workmangr

`research/workmangr` demonstrates the desired user experience: virtual syntax can be previewed by
the CLI and shown as editor inlays, including reconstruction of omitted lambda delimiters. Its
implementation accumulated formatter/diff machinery and special cases.

wm-mini should preserve the user-facing idea while making grammar slots and their authored/missing
provenance authoritative. The goal is not to port workmangr's list of repairs. It is to make those
surface forms emerge from one canonical structural parser.
