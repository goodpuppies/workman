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
