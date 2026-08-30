# SML compatibility contract

## Position

“Close to SML,” “SML-like,” and “inspired by SML” are not strong enough descriptions for Workman's
shared language fragment. They describe resemblance, not compatibility, and allow an implementation
to drift while still sounding correct.

The stronger rule is:

> For every accepted Workman construct classified as part of the SML subset, its binding, static
> semantics, dynamic semantics, and observable result are those of its translation into Standard ML
> under the Revised Definition.

Workman can be smaller than SML without having different semantics. A limitation normally removes
programs from the language; it does not redefine the programs that remain.

## Four classifications

Every language feature should be assigned exactly one of these classifications.

### 1. SML form with different spelling

The Workman form has a direct translation into SML. The translation must preserve:

- binding and scope;
- value, type, constructor, and structure namespaces;
- generalization and instantiation;
- equality and nominal type identity;
- evaluation order;
- exceptions or failure behavior where the shared fragment includes them;
- observable values and effects.

Examples include ordinary value bindings, function application, tuples, datatype construction, and
the shared pattern forms.

These features are **equivalent**, not similar.

### 2. Restricted SML form

Workman accepts a proper subset of the programs admitted by an SML form, but accepted programs use
the SML semantics unchanged.

Examples may include:

- omitting signatures, functors, nested structures, and other grammar;
- rejecting an `open`-like import when its names collide;
- permitting only file-backed structure expressions;
- supporting fewer declaration and pattern forms.

A restriction should be expressible as an additional well-formedness or admissibility condition:

```text
if Workman accepts W
and translate(W) = S
then S has the Revised Definition's semantics
```

Rejecting more programs is a limitation. Giving an accepted shared program different binding or
evaluation behavior is not.

### 3. Definitional surface extension

The syntax is not an SML source form, but its meaning is completely defined by translation into SML
forms or by an exact operation on the Definition's semantic objects.

Examples include:

- file imports elaborated through hidden structure bindings;
- selective import as environment projection;
- import renaming as namespace-preserving environment renaming;
- JavaScript-like type-argument spelling translated to SML type application.

The definition must be precise enough to determine namespace status, polymorphism, type identity,
evaluation order, and shadowing. “Corresponds to” is insufficient.

An environment transformation is acceptable where surface SML cannot conveniently spell the
operation. It must operate on the same `Env`, `StrEnv`, `TyEnv`, and `ValEnv` concepts rather than
introduce parallel semantic objects.

### 4. Workman semantic extension

Some features intentionally have no SML-equivalent semantics. Examples include nominal records,
pinned pattern identifiers, JavaScript FFI, GPU regions, and bare-namespace-to-`carrier` expression
rewriting.

Each extension must document:

- why it is outside the SML subset;
- its own static and dynamic rule;
- how it composes with SML environments and types;
- where it deliberately changes behavior that an SML reader might expect.

Extensions must not be used to quietly redefine a shared SML form.

## Compatibility test

For the SML-defined subset, maintain a translation or semantic correspondence `T`:

```text
Workman source W
      |
      | parse/desugar T
      v
SML phrase or Definition-level environment operation T(W)
      |
      | Revised Definition
      v
static and dynamic result
```

The implementation need not literally emit SML. The translation is the specification and testing
oracle.

For any accepted `W` in classifications 1–3, where `T(W)` may be an SML phrase or a precisely
defined operation on the Definition's semantic objects:

1. **binding preservation:** corresponding occurrences resolve to corresponding declarations;
2. **static preservation:** `W` is accepted with a type exactly when `T(W)` is, subject only to
   documented Workman restrictions;
3. **identity preservation:** datatype, constructor, and structure aliases preserve or generate
   identity exactly as stated by `T`;
4. **dynamic preservation:** evaluation order and observable results match `T(W)`;
5. **diagnostic freedom:** diagnostics may be clearer or stricter, but cannot change the semantics
   of an accepted program.

When no such statement can be made, the feature is classification 4 and must be documented as an
extension.

## Application to files and structures

SML deliberately does not define a universal filesystem/project model, so Workman's path resolution
cannot be “equivalent to SML file handling.” There is no single SML file behavior to equal.

The semantic content after resolution can nevertheless be defined exactly in SML terms. For a
resolved, acyclic graph, assign each canonical source unit a hidden structure identifier and
translate units in dependency order:

```sml
structure Unit_lib = struct
  (* exact translation of lib.wm declarations *)
end

structure Unit_main = struct
  (* declarations before the import *)
  local
    structure Lib = Unit_lib
  in
    (* declarations after the import *)
  end
end
```

This divides the design cleanly:

- path resolution, graph roots, canonicalization, and cycle rejection are implementation/project
  policy;
- the resulting hidden structure bindings and their environments use SML semantics;
- omission of arbitrary structure expressions, signatures, and functors is a restriction;
- selective import is a defined projection/renaming operation over an SML environment;
- bare-namespace-to-`carrier` rewriting remains an explicit Workman syntactic extension.

“Every Workman file is an implicit structure” should therefore be read as a specified translation,
not as a claim that SML itself assigns structures to files.

## Application to import forms

### Namespace import

```wm
from "./lib.wm" import * as Lib;
```

After resolving the path to hidden structure `Unit_lib`, the import contributes the local part:

```sml
local
  structure Lib = Unit_lib
in
  (* remaining declarations in the Workman file *)
end
```

The structure binding itself has ordinary SML semantics, while `local` accounts exactly for the
file-protocol rule that imports are not automatically re-exported.

### Open import

```wm
from "./lib.wm" import *;
```

The corresponding local scaffolding is:

```sml
local
  open Unit_lib
in
  (* remaining declarations in the Workman file *)
end
```

Workman applies the Definition's ordinary `open` environment composition. Later environment
components replace earlier components within the same namespace.

### Named import

```wm
from "./lib.wm" import { value as local };
```

This is a definitional surface extension:

1. look up every applicable namespace component named `value` in `Unit_lib`'s environment;
2. project those components;
3. rename their keys to `local`;
4. preserve type schemes, identifier status, type names, and nominal identities;
5. compose the result into the current environment using ordinary SML environment modification.

It must not be approximated as an ordinary `val local = Unit_lib.value`, because that can lose
constructor identifier status and does not describe type-namespace imports.

## Consequences for compiler consumers

The compiler should expose the translated semantic roles rather than generic “module-like” facts:

- `ModuleId` identifies project input;
- a file structure has an SML `Env`-equivalent export;
- `StructureAliasId` identifies the local structure binding introduced by namespace import;
- imported members retain their target `SymbolId` and namespace status;
- restrictions produce diagnostics without fabricating alternate binding semantics;
- Workman extensions carry an explicit extension kind.

The LSP and other tools can then report the language rather than reconstructing it. Tool-specific
query design remains in the deferred LSP plan.

## Documentation rule

Use these terms consistently:

- **equivalent** for a direct SML translation and for the accepted portion of a restricted SML form;
- **restricted** when Workman rejects cases SML accepts without changing accepted semantics;
- **definitional extension** for exact operations on SML semantic objects without a direct SML
  source spelling;
- **extension** when behavior is genuinely outside SML;
- **implementation policy** for filesystem and project behavior the Definition does not specify.

Avoid “SML-like,” “close to SML,” “similar to SML,” and unqualified “corresponds to” in normative
language.

## Review requirement

Before implementing a language or LSP behavior, its planning entry should answer:

1. Which classification applies?
2. What is the exact translation or semantic operation?
3. Which programs are rejected as limitations?
4. Which identities and namespaces are preserved?
5. Is any remaining behavior a Workman extension?

If those answers are unavailable, the feature is not specified strongly enough to implement.
