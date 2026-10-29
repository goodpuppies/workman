# Issue: SML `open` Inside a Structure Re-exports; Workman Imports Cannot

Status: open (2026-10-02)

Found while building the SubsetML ⇄ Workman translator (`../SubsetML`, `docs/translation.md`).

## Summary

In SML, `open` is an ordinary declaration. When a structure opens another, the opened bindings
become part of the opening structure's environment, so they are visible through it:

```sml
structure Syntax = struct
  datatype scon = SInt of string | SReal of string
end

structure Lexer = struct
  open Syntax
  datatype token = TScon of scon
end

val x = Lexer.SInt "1"   (* fine: Lexer's environment includes Syntax's bindings *)
```

Workman's import is not re-exported (module-update26.7 decision D5: "Imported and prelude
bindings are not module-owned and are not automatically re-exported"), and re-export syntax is
deferred (D9). So the direct translation:

```wm
// lexer.wm
from "./syntax.wm" import *;
type Token = TScon<Scon>;
```

```wm
// a client
from "./lexer.wm" import * as Lexer;
let x = Lexer.SInt("1");   // unbound: SInt is not in Lexer's public environment
```

loses `Lexer.SInt`. Any SubsetML program that reaches a name through a structure that opened it
translates to Workman with a lookup error. That includes `open Lexer` reaching Syntax's names
transitively.

The meaning is also different when nothing fails. In SML, opening `Lexer` after `Syntax` shadows
Syntax's bindings with the copies Lexer re-exports (the same objects, so harmless). Opening a
structure that rebinds a name changes which binding wins. In Workman, only Lexer's own
declarations take part.

## Why it matters

- SubsetML promises that its programs mean the same in SML and Workman (the translator is two-way).
  This is the one module-level construct where a straightforward SubsetML program has no Workman
  equivalent.
- The future MLton bridge has the opposite problem. A Workman module translated to an SML
  structure that `open`s its imports would *start* re-exporting them, unless the bridge uses
  `local open … in … end` (which SubsetML omits) or qualified names.

## Options

1. **A re-export form in Workman** that projects an imported module's public environment into the
   importing module's, preserving identity (the semantic object D9 asks for). The translator
   would emit it for every SML `open` at structure level. A star form is enough for SML `open`;
   per-name forwarding is not needed for this.
2. **A SubsetML restriction instead:** a name may only be reached through the structure that
   declares it. That cannot be checked syntactically; the SubsetML elaborator would reject
   qualified or opened access to a binding that came in through another structure's `open`.
   It keeps Workman unchanged and is allowed by SubsetML's rules (it only rejects programs).
3. **The translator adds the imports a client needs** by resolving each qualified name to its
   declaring module. This works for qualified access, but cannot reproduce shadowing order, and it
   hides the difference instead of resolving it.

Option 1 matches SML exactly and is the natural partner of D9's identity-preserving re-export.
Option 2 is the fallback if Workman should never re-export.

## Current workaround

The SubsetML implementation opens every structure it uses directly (`open Syntax` and
`open Lexer` in the parser), so its own translation is unaffected. The translator does not detect
programs that depend on re-export.

## Investigation (2026-10-28)

This is a separate difference from the missing-type-import bug tracked in
`FIXED-transitive-imported-nominal-fails-block-escape-check.md`. It remains intentional
WM behavior, enforced by the passing `T118` test in
`tests/module_update_characterization_test.ts`: an imported binding can be used in
the importing module, but is absent from that module's public environment. A client
trying to import it through the middle module gets `unknown import imported`.

The local reference agrees with the SML account above:
`research/The-Definition-of-Standard-ML-Revised/statcor.tex`'s open-declaration rule
returns the opened environments (`E_1 + ... + E_n`) as the declaration's result.
Consequently structure-level `open` contributes those bindings to the structure.
This does not mean SML automatically re-exports every dependency or every initial
basis binding: it follows specifically from an `open` declaration in the structure.

This is independent of default pervasives and frontend v3. A parser form alone
cannot fix it: an explicit WM re-export must compose public value, type and
structure environments while preserving nominal type/constructor identity,
identifier status, shadowing order, provenance and runtime targets. Existing
`addImport`/`projectStaticEnv` machinery provides much of the environment projection,
but imports currently update working scope rather than public exports.

Recommendation: keep ordinary imports private and add an explicit,
identity-preserving star re-export as a separate module feature if SML `open`
compatibility is wanted. The translator can emit that form for structure-level
`open`. Do not turn every import into an implicit re-export or postpone the semantic
decision merely because v3 is underway. Required checks include a three-module
chain, constructor patterns, type annotations, nested structures, collisions and
runtime access through the forwarding module. No syntax was selected or
implemented by this investigation.
