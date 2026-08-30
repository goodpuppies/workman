# SML files and structures

## Why this needs an explicit model

The difficult boundary is not type inference inside one file. It is the relationship between:

- an SML structure, which is a semantic environment;
- a source file, which is physical input;
- a project or compilation graph, which decides which files are analyzed and in what context;
- a Workman import, which makes another file's exported environment visible.

If these are all called "modules" without qualification, Workman can accidentally grow a second
module calculus beside SML's. The intended direction is stricter: the resolved program has an exact
translation to SML structure and environment semantics, with one small implementation-defined
file-compilation policy around it.

This document applies the [`SML compatibility contract`](./sml-compatibility-contract.md). “Limited”
means Workman rejects unsupported forms; it does not license different semantics for accepted shared
forms.

## What the Revised Definition actually specifies

The Revised Definition specifies programs as sequences of top-level declarations. It says an
implementation may provide a directive that includes programs from files, and that a file may
contain a sequence of top-level declarations. It then explicitly leaves the effect of file inclusion
on the static and dynamic basis to implementations. See
[`prog.tex`](../../research/The-Definition-of-Standard-ML-Revised/prog.tex), especially the
discussion before the program execution rules.

The environment tuple, structural qualified lookup, modification operation, sequential-declaration
rule, and `open` rule are in
[`statcor.tex`](../../research/The-Definition-of-Standard-ML-Revised/statcor.tex).

This gives a firm dividing line:

- SML specifies structures, environments, bases, top-level declarations, and sequential
  elaboration/evaluation.
- SML does not specify filesystem paths, project roots, dependency discovery, separate compilation,
  or a universal rule that one file equals one structure.

The semantic objects are nevertheless a strong foundation:

```text
Env = StrEnv x TyEnv x ValEnv
StrEnv = StrId -> Env
Basis = type names x FunEnv x SigEnv x Env
```

In the Revised Definition there is no separate semantic object behind a structure. A structure
expression elaborates to an environment, and a structure binding stores that environment in the
structure environment. A core declaration also elaborates to an environment.

Sequential declarations are right-biased environment composition:

```text
C |- dec1 => E1
C + E1 |- dec2 => E2
----------------------
C |- dec1 dec2 => E1 + E2
```

Therefore later declarations see earlier declarations, and later bindings replace earlier bindings
in the same namespace. `open A B` produces `EA + EB`, so later opened environments win where names
overlap. Workman imports will follow this rule; the current rejection of collisions between imports
is an implementation issue to replace.

The Definition's core-language-program reduction is also useful: a top-level declaration reduces to
a structure-level declaration, which reduces to a core declaration. This explains why the same
environment machinery applies without implying that every physical file is a named structure.

## How Millet handles files and modules

Millet preserves the separation above.

### SML layer

Millet's SML statics represent a basis containing:

- an environment;
- a signature environment;
- a functor environment.

The environment in turn has structure, type, and value environments. Its top-level elaborator
implements the Definition's sequential basis and structure rules. An explicit SML `structure`
declaration places an environment into the structure environment.

### Compilation-manager layer

Millet separately reads an MLB or CM group as the workspace root. Only transitively reachable files
are analyzed. CM input is lowered into the same basis-level representation used for MLB processing.

At that layer Millet:

1. obtains a source or nested group path from the group description;
2. parses a source file using the fixity environment selected for that input;
3. elaborates it under the basis accumulated before the file;
4. appends the file's resulting basis so later inputs can see it;
5. uses dependency ordering for CM source sets.

A source file is therefore a chunk of top-level SML declarations that transforms a basis. Millet
does **not** turn every source file into an implicit SML structure or derive a namespace from its
filename. Namespaces come from explicit SML `structure` declarations or from MLB basis-level
composition.

This is correct for Millet's job, but it exposes a language-service complication: the same physical
source can be included by different groups under different incoming bases. Millet's current code
stores one analysis per path and notes that a later context can replace the earlier result. Workman
can avoid this ambiguity if its explicit-import rule guarantees one elaboration context per
canonical source unit in an entry graph.

Relevant Millet implementation points:

- `docs/manual.md`: root CM/MLB discovery and reachability;
- `crates/input/src/lib.rs`: sources, groups, and root-group input;
- `crates/mlb-hir/src/lib.rs`: basis declarations and source/group paths;
- `crates/mlb-statics/src/lib.rs`: sequential basis accumulation and source analysis;
- `crates/sml-statics/src/basis.rs`: SML basis representation;
- `crates/sml-statics/src/top_dec.rs`: Definition-aligned top-level elaboration.

SML/NJ CM provides a different comparison: it already computes a dependency graph, rejects cycles,
and links a reachable compilation unit at most once. Its dependencies are inferred through top-level
language-module definitions and uses inside externally described libraries, rather than declared as
selective per-file imports. See [`sml-relative-comparison.md`](./sml-relative-comparison.md) for the
full comparison.

## Current Workman behavior

Workman currently makes a different, smaller project-language choice:

- an entry file and explicit imports determine a directed graph;
- canonical paths identify graph nodes;
- dependencies are loaded before their importers;
- import cycles are rejected;
- every file begins with the Workman basis/prelude plus explicit imports, not the preceding file's
  basis;
- imports take effect in declaration order;
- inference produces a full local structure environment and an exported structure environment;
- declarations are exported by default;
- namespace imports expose qualified values, types, and constructors;
- open and named imports copy selected exported bindings into local environments;
- imported nominal type identities are preserved;
- the same-named datatype declared in two different files has different nominal identity;
- imported-binding collisions are errors, while a later local declaration may shadow an imported
  binding;
- a namespace whose file exports `carrier` also has special Workman value behavior.

This is not Millet's source-file semantics. It is closer to compiling every canonical Workman file
once as a hidden structure, then making that structure available through explicit imports.

## Proposed normative model for Workman

Use three distinct terms:

- **source unit** or **compilation unit**: one canonical `.wm` file in a project graph;
- **file structure**: the exported environment produced by elaborating that source unit;
- **module graph**: the external mechanism that resolves source units and their dependencies.

Reserve **structure** for the SML semantic environment and **module language** for the broader SML
concepts. A path is a compilation-unit identifier, not a structure identifier.

### Conceptual elaboration

For each canonical source unit `U`, exactly once per entry snapshot:

1. resolve its imported source units;
2. begin with the selected Workman basis;
3. elaborate its declarations in source order;
4. interpret each Workman import as an environment operation at its declaration position;
5. retain an internal environment for checking the remainder of the file;
6. use nested SML `local` declarations so import environments scope over the remaining declarations
   without entering the file's exported environment `E_U`;
7. associate `E_U` and its nominal identities with the canonical unit identity.

The normative module semantics of the resolved project is its translation to an SML program skeleton
with hidden bindings:

```sml
structure Unit_lib = struct
  (* translation of SML-defined declarations plus explicit Workman extensions *)
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

This is a normative semantic translation, not a claim about standard SML file semantics. Path
resolution chooses the hidden units; after that implementation-specific step, ordinary SML structure
semantics determine their structure environments and identities. Non-SML declarations inside a unit
remain governed by their separately documented extension rules. The hidden `Unit_*` name is a
compiler artifact and must not depend on a basename or an import alias.

### Import forms

The semantic definitions are:

| Workman form             | Exact definition                                                                                 | Classification                  |
| ------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------- |
| `from p import * as M`   | put `structure M = Unit_p` in the local part that scopes over the remaining declarations         | SML-equivalent after resolution |
| `from p import *`        | put `open Unit_p` in the local part that scopes over the remaining declarations                  | SML-equivalent after resolution |
| `from p import {x}`      | project every applicable namespace component `x` from `Env(Unit_p)`, preserving semantic objects | definitional surface extension  |
| `from p import {x as y}` | perform the same projection and rename its environment keys to `y`, preserving identities        | definitional surface extension  |

Named projection/renaming is specified as an exact environment operation. It is not an unimplemented
fragment of signatures or a new kind of structure. A spelling may exist in both the value and type
environments, as with a datatype and constructor; projection preserves those separate namespaces,
identifier status, type schemes, type names, and nominal identities.

The bare-namespace-to-`carrier` rewrite is a Workman-specific syntactic extension on top of
namespace import and must remain explicitly marked as such. It does not add the namespace alias to
the value environment.

### Identity and generativity

The current graph caches each canonical path once. The normative identity rule should therefore be:

- one source-unit identity per canonical path in an entry snapshot;
- one elaboration and one set of generated nominal identities per source-unit identity;
- importing the same unit under two aliases refers to the same file structure and nominal types;
- two different source units produce distinct nominal declarations even when their text matches;
- aliases and named imports change local spelling, not target identity.

This is exactly the identity behavior of binding one hidden structure once and aliasing it. It is
not the behavior of re-evaluating `struct ... end` independently at every import occurrence. The
distinction matters for datatype identity, initialization effects, references, and rename.

Canonical-path identity is a useful initial rule, but the project model must later decide how
symlinks, case sensitivity, virtual documents, generated sources, and package identities affect
canonicalization.

## Exact equivalences, restrictions, extensions, and policy

| Concern                             | Revised SML                                    | Millet                                             | Current/proposed Workman                          |
| ----------------------------------- | ---------------------------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| Structure meaning                   | an environment stored in `StrEnv`              | follows the Definition                             | exported file environment                         |
| Physical file meaning               | implementation-defined inclusion input         | source declarations transforming an incoming basis | isolated source unit producing one file structure |
| Project graph                       | not specified                                  | external CM/MLB group graph                        | explicit import graph rooted at an entry          |
| Cross-file visibility               | implementation-defined                         | accumulated basis/group composition                | explicit import only                              |
| File creates namespace              | no general rule                                | no                                                 | yes, through Workman's implicit file packaging    |
| Nested structures                   | yes                                            | yes                                                | no                                                |
| Signatures/functors/sharing         | yes                                            | yes, subject to implementation completeness        | out of current language scope                     |
| Open collision behavior             | later environment wins                         | SML semantics                                      | will follow SML; current code rejects collisions  |
| Local declaration after open/import | later declaration can replace                  | SML semantics                                      | local declaration can shadow an import            |
| Selective renamed import            | no direct core form                            | group exports exist at a different layer           | explicit Workman convenience                      |
| Nominal identity                    | generated by datatype/module elaboration rules | Definition-aligned                                 | generated once per canonical source unit          |
| Cyclic file graph                   | not specified                                  | compilation-manager concern                        | rejected                                          |

## Decisions applied to module implementation

### Collision policy

Imports use the Definition's environment modification rather than a parallel collision system. A
later phrase wins within its affected namespace, including later named, namespace, and open imports.
The structure, type, and value environments remain distinct.

Reject duplicate local targets within one named-import clause and namespace only. That is a
well-formedness rule for a simultaneous clause; it does not prohibit sequential SML shadowing.

### Export restriction

An un-ascribed SML structure exposes its resulting environment. Workman's current
export-all-module-owned-declarations behavior matches that simple model. `private` is deferred. If
private declarations or explicit export lists later become meaningful, model them as an environment
restriction at the file-structure boundary. Do not invent a second type identity for the restricted
view.

### Entry and execution semantics

The static model must be paired with a dynamic rule:

- dependencies initialize once before their importer;
- repeated imports reuse the initialized unit;
- the entry unit determines the program's externally executed result;
- failure and side-effect behavior should be stated rather than inherited accidentally from the
  generated JavaScript.

This is language/compiler specification work. Tooling should later consume the resulting compiler
facts rather than define them.

## Guardrails against a parallel module system

1. Every accepted shared form must have the Revised Definition's semantics through an exact
   translation or environment operation.
2. Workman-specific syntax such as named environment projection and the bare-namespace-to-`carrier`
   rewrite must be named explicitly; current collision errors are bugs, not accepted deviations.
3. File paths, graph nodes, structure aliases, and semantic symbols must have separate identities.
4. Unsupported SML features stay omitted; do not replace them with similar but incompatible concepts
   merely because Workman implements a smaller language.
5. Filesystem policy is separated from the normative SML translation because the Definition
   deliberately leaves filesystem behavior open.
6. “Limited SML” means omitted syntax or stricter admissibility, never approximately reimplemented
   semantics.
7. Tests should compare the normative translation and identity rules, not only emitted JavaScript
   strings.

## Required semantic tests

Before relying on this model in the compiler or tooling, add or identify tests for:

- importing one canonical file under two namespace aliases preserves one nominal type identity;
- the same file reached through normalized relative spellings resolves to one `ModuleId`;
- two different files with identical datatype text remain nominally distinct;
- dependency initialization occurs once;
- imports take effect only after their declaration position;
- named import alias and target have distinct occurrence roles but one target identity;
- value/type/constructor namespaces survive namespace, open, and named imports;
- every collision and shadowing case follows the chosen policy;
- failed imports and cycles retain enough edge information for diagnostics and navigation;
- export restriction, if introduced, preserves identities of visible members.

## Resulting position

Workman should not copy Millet's file composition, because Workman's explicit isolated-file imports
are a deliberate language choice. It should copy Millet's architectural discipline: keep the
external compilation graph separate from the SML semantic environment model.

The concise specification is:

> A Workman source unit is elaborated once under its basis and explicit imports to produce an
> exported SML environment. The module graph decides which source units exist and their dependency
> order; import declarations alias, open, or project those environments without creating new type
> identities.

The resolved file graph is Workman implementation policy. Its semantic elaboration is SML plus
explicitly classified restrictions and extensions, not a parallel module system.
