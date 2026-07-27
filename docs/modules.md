# Workman modules

This is the stable, compiler-facing summary of Workman's module system. The normative
specification is
[`../markdown/module-update26.7/proposed-semantics.md`](../markdown/module-update26.7/proposed-semantics.md)
(the filename is historical; its rules are accepted), with settled decisions recorded in
[`../markdown/module-update26.7/decisions.md`](../markdown/module-update26.7/decisions.md).

## Ownership

Every behavior has exactly one owner:

- **Revised Standard ML** owns declarations, environments, namespaces, inference, generalization,
  and nominal identity for the shared language fragment. Accepted shared forms follow the Revised
  Definition exactly; unsupported SML syntax is a restriction, not permission to redefine the rest.
- **The Workman compilation-unit protocol** owns specifier resolution, canonical module identity,
  graph construction, cycle policy, initialization order and multiplicity, and derivation of a
  file's public environment.
- **Explicit Workman extensions** own everything that cannot be defined by SML translation:
  nominal records, pinned patterns, the JavaScript FFI, GPU regions, and the bare-namespace
  `carrier` rewrite.

## Environments and qualified names

The static environment is the Definition's product:

```text
Env = StrEnv × TyEnv × ValEnv        StrEnv = StrId → Env
```

A qualified name is the Definition's long identifier `strid_1.….strid_n.x`. The compiler carries
it structurally (`qualifiers` × base identifier); the dotted spelling is display/emit rendering
only and is never a semantic key. Lookup is iterated `StrEnv` projection. JavaScript FFI member
paths, reflected foreign-type keys, and GPU backend paths are host paths, permanently outside
long-identifier semantics.

Sequential phrases compose environments with the Definition's right-biased modification: a later
import or local declaration shadows an earlier binding in the same namespace; equal spellings in
different namespaces (structure, type, value) do not collide. One shared modification operation
serves basis installation, all import forms, `open`, and ordinary declarations.

## Files and imports

A `.wm` file elaborates against the initial basis plus its explicit imports, in declaration
order; compilation order grants no ambient visibility. Its public environment contains exactly
its module-owned top-level declarations — imported and basis bindings are working scope only and
are never re-exported (normatively: each import is the local part of an SML `local … in … end`).

```wm
from "./lib.wm" import * as Lib;   -- static structure alias in StrEnv
from "./lib.wm" import { f as g }; -- namespace-preserving projection with key-only renaming
from "./lib.wm" import *;          -- SML open
```

Imports project the original semantic objects: schemes, constructor status, and nominal type
identities are preserved, never re-elaborated. A single named-import clause may not bind one
local name twice in the same namespace; this is a simultaneous-clause well-formedness rule, not a
cross-declaration collision policy. Bare `Lib` in expression position is a syntactic extension
meaning `Lib.carrier`, tried only after ordinary value lookup; it adds no value binding.

## Identity, graph, and evaluation

Resolution is deterministic: `resolve(referrer, specifier, config) → ModuleId`. The `ModuleId` is
opaque — no display, path, or emit-name representation — and every spelling resolving to one
identity shares one module instance, one public environment, and one set of nominal identities.
Distinct files with identical text have distinct nominal declarations.

The reachable graph from a project head is acyclic; a cycle is a compile-time error carrying the
complete ordered import-edge path. Evaluation initializes dependencies before their importer,
once per `ModuleId`, visiting outgoing edges depth-first in source order. A failed initialization
is remembered and rethrown; effects performed before the failure are retained, and importers
never start. Invoking an exported `main` is target-specific behavior after successful entry
initialization, not part of module initialization.

## Initial basis

The basis follows the SML model independently of library size: a kernel of
non-source-expressible facts, compiled standard structures installed as real structure
environments, and an explicit pervasive table whose unqualified bindings are projections of the
same semantic objects as their qualified members. Static and dynamic profiles are built from one
compiler-owned manifest; fixed operators are kernel syntax rather than `ValEnv` identifiers,
while ordinary initial values such as `print` shadow normally. `-- @no-prelude` selects the
recorded kernel profile. Standard-basis construction is deterministic and observationally
effect-free.

## Interface artifact

The per-module, per-project-snapshot `ModuleInterface` is the sole semantic API for tooling: it
carries the public environment, occurrences, scopes, typed nodes, semantic type snapshots,
dependency edges, FFI and GPU facts, and structured completeness. No tooling layer may implement
a fallback semantic environment; malformed current source exposes compiler-certified partial
facts instead.

## Intentional restrictions relative to SML

- fixed operator syntax; no symbolic value declarations, `op`, or user fixity;
- no signatures, ascription, functors, sharing, or nested/anonymous structures — a structure is a
  file;
- no re-export or forwarding syntax; aliasing a value is a new declaration;
- acyclic file graph; cross-file recursion is rejected rather than given ESM temporal semantics;
- no `local … in … end` phrase form (blocks provide local scope in expressions);
- the duplicate-target restriction inside one simultaneous named-import clause.

## Workman extensions beyond SML

- the file-module protocol itself (`ModuleId`, graph, initialization once, failure memory);
- named imports with renaming as a surface form (SML would spell this with structure bindings);
- the bare-namespace `carrier` expression rewrite;
- nominal records with stable field identities;
- pinned patterns;
- the JavaScript FFI and reflected foreign types;
- GPU regions and their catalog-owned overload discipline;
- public-by-default file declarations (`private` deferred).

## Deferred

Package resolution, import maps, URLs beyond local files, persistent cross-build identity,
`private`, re-export, and recursive modules are explicitly deferred and tracked in the decision
register.
