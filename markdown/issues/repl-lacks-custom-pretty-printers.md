# The REPL has no custom pretty printers

Status: open. Raised 2026-11-05 while designing atview's REPL image API.

## Problem

The REPL shows every binding as `name = value : type` through a fixed formatter (`__wm_repl_show` in `src/core/emit_prelude.ts`). A library can't change how its own type is shown, so a value can't display as anything but its fields.

atview's terminal images are the case that raised this. `post :> Image.render;` can print a picture and bind data to `it`, but typing `it;` afterwards prints a record rather than redrawing the picture.

## Precedent

Some SML implementations let you register a printer for a type: `PolyML.addPrettyPrinter` in Poly/ML and `CompilerPPTable.install_pp` in SML/NJ. The Definition doesn't specify REPL printing, so this wouldn't conflict with it.

## Constraints

- Strings must stay sanitized by default. REPL output includes untrusted text, such as other people's posts in atview, and raw escape sequences could clear the screen, fake output or set the clipboard on some terminals. Removing the quoting globally isn't an acceptable way to get this.
- A printer has to be opt-in per type, and printing a value nested in a list or record needs a defined result.
- A display that writes escape sequences doesn't fit inside `it = ... : type`, so the binding line needs a layout for it.

## Not decided

Whether this should be a registered printer, as in Poly/ML and SML/NJ, or something the type itself declares. A symbol-keyed property on the value was tried and removed on 2026-11-05 without being used, because compiler-side hooks weren't wanted at that point.
