# File-module semantics

This is the normative Workman file-module specification. The filename is historical: these rules
are accepted, not proposed. Each is settled by the decision register in
[`decisions.md`](./decisions.md); implementation evidence is tracked in
[`checklist.md`](./checklist.md).

## Terms

- **specifier:** the source string in an import declaration;
- **referrer:** the module containing that declaration;
- **ModuleId:** the canonical identity returned by resolving a specifier against a referrer;
- **source unit:** the parsed `.wm` source associated with a `ModuleId`;
- **internal environment:** every declaration visible while elaborating the source unit;
- **public environment:** the namespace-preserving restriction of the internal environment exported
  to importers;
- **module instance:** the one runtime initialization associated with a `ModuleId` in a program
  instance;
- **project head:** a root source unit containing `main`;
- **project:** one project head and every source unit reachable from it;
- **entry module:** the root selected for one compilation/output operation; for an executable
  project this is its project head.

`ModuleId` belongs to the compilation-unit protocol. It is not a source-level structure name or
ordinary Workman value.

## Resolution

For every Workman import:

```wm
from specifier import clause;
```

the resolver computes:

```text
resolve(referrer.ModuleId, specifier, projectConfig) -> ModuleId | resolution error
```

Resolution must be deterministic for one project configuration. Two successful resolutions yielding
the same `ModuleId` identify the same source unit, public environment, nominal declarations, and
module instance.

Local-file resolution requires explicit relative paths and `.wm` extensions. Package names, import
maps, URLs beyond `file:`, and generated sources require later decisions (`D25`).

`ModuleId` is opaque to compiler consumers. Initially, an ordinary local file is identified by its
canonical real path; a virtual source provider supplies a stable identity within the current project
snapshot. The original specifier, a user-facing display path, and any backend emit name are separate
facts. No cross-machine or persistent identity is promised.

## Graph

All Workman imports are literal, top-level declarations. The compiler discovers every edge before
elaborating or evaluating module bodies.

The reachable graph from a project head is acyclic. A cycle is a compile-time graph error with a
diagnostic path showing the participating import edges. A workspace may analyze several heads, and
their reachable graphs may overlap.

A dependency does not become another project because it contains a binding named `main`. `main` is
entry behavior only for the module selected as that project's head. The dependency becomes a
separate project only when independently selected as a head.

Dependencies are elaborated and initialized before their importers. Dependency requests are ordered
by first source occurrence. Evaluation uses a depth-first traversal in that order, making the order
of independent effectful dependencies deterministic.

## Declaration elaboration

A source unit begins with the selected Workman basis/prelude. It does not inherit declarations from
an unrelated preceding file.

The basis model distinguishes:

```text
PreludeBasis
ImportedBasis(M) = selected aliases to dependency-owned public declarations
Basis0(M) = PreludeBasis
Basis(i + 1) = extend Basis(i) with phrase i
FullBasis(M) = final sequential basis
```

For an import phrase, extension means projecting the selected dependency-owned semantic objects. For
a local declaration, extension means ordinary SML declaration elaboration. `ImportedBasis(M)` is an
aggregate description of selected imports, not the initial lexical environment.

Declarations elaborate sequentially using the Revised Definition's environment behavior for the SML
subset. Workman extensions contribute explicitly specified semantic objects to the same environment.

The compiler discovers every import edge in advance, but each import extends the working basis at
its declaration position. Imported names are not semantically hoisted:

```wm
let invalid = parse("x"); -- parse is not visible
from "./parser.wm" import { parse };
let valid = parse("x"); -- parse is visible
```

`ImportedBasis(M)` denotes the aggregate dependency-owned environment fragments selected by the
module; those fragments enter the sequential basis at their individual source positions rather than
as one preinstalled header environment.

## Public environment

The current source rule is:

```text
all module-owned top-level declarations are public
```

Local declarations inside expressions are never members of the file's public environment. Imported
and prelude declarations are not automatically re-exported:

```text
PublicEnv(M) =
  project module-owned top-level declarations from FullBasis(M)
```

“Project module-owned” is an implementation summary, not a new semantic environment operation. The
normative account uses nested SML `local` declarations. Each import environment is the local part,
and the declarations following it are the body. Consequently the import is visible to the remaining
source but absent from the environment returned by `local`. Ordinary sequential composition retains
the file's local declarations.

For example:

```text
decls-before;
import namespace A;
decls-after
```

has the environment shape:

```sml
decls-before
local
  structure A = Unit_target
in
  decls-after
end
```

Interspersed imports nest this shape. Open imports use `open Unit_target` in the local part. Named
imports use their explicitly defined projected environment in the local part.

The public environment preserves separate namespaces and semantic objects:

```text
PublicEnv = StrEnv x TyEnv x ValEnv
```

restricted to the components Workman implements. Constructor identifier status and nominal type
identity are part of the exported semantic object.

The semantic representation contains real structure-environment relationships, and qualified
names are the Definition's long identifiers (`D16`, `D33`). Flattened backend names such as
`Lib.value` are a lowering strategy only; they are not the environment model and are never
semantic keys.

`private` and public-environment restriction are deferred until they are needed. When introduced,
they must restrict this environment without creating fresh identities for retained declarations.
Automatic opaque abstraction is out of scope.

Imports are non-transitive. `A` importing `B`, where `B` imports `C`, does not place `C`'s
declarations in `A`'s scope or public environment.

## Import binding

### Namespace

```wm
from "./lib.wm" import * as Lib;
```

After resolution, bind `Lib` as a static structure alias for the target public environment.
Qualified lookup uses the ordinary SML environment namespace rules.

`Lib` is not an ordinary runtime value. The current bare-alias-to-`carrier` rule is an explicit
syntactic extension:

```text
Lib  in expression position  ==>  Lib.carrier
```

The extension does not inject `Lib` into the value environment. Ordinary value lookup wins; the
rewrite is attempted only when the bare name is not a value, resolves in the structure environment,
and that structure contains a value member named `carrier`.

### Open

```wm
from "./lib.wm" import *;
```

Extend the current environment with the target public environment as an SML `open`.

### Named

```wm
from "./lib.wm" import { Item, value as local };
```

For each requested source name:

1. look up every applicable implemented namespace component in the target public environment;
2. reject the import if no component exists;
3. project the semantic objects without re-elaboration or re-generalization;
4. rename only the local environment keys when an alias is present;
5. preserve identifier status, type schemes, type names, nominal identity, and origin;
6. compose the projected environment using ordinary SML environment modification.

The local import occurrence and spelling are distinct facts from the target declaration identity.

## Collisions and shadowing

The rule is the Revised Definition's sequential, right-biased environment modification:

- a declaration before an import is checked without that import in scope;
- a later import or local declaration replaces an earlier binding in the same namespace;
- a later open import wins for overlapping members, exactly like a later structure in SML `open`;
- value, type, and structure components with the same spelling do not collide;
- a namespace alias and a value may therefore share a spelling;
- constructors occupy the value namespace while datatype metadata also belongs to the type
  environment;
- a named-import clause may not bind the same local name twice in one namespace within that single
  clause.

The last item is a syntactic well-formedness rule for one simultaneous clause. It does not alter
cross-phrase SML shadowing. Imports may shadow basis bindings where the corresponding SML
environment extension could do so; any non-shadowable Workman built-ins must be documented as a
separate language restriction.

Shadowing a type-environment key does not delete same-related value constructors. For example,
replacing the visible type name `Option` leaves existing `Some` and `None` value bindings intact
unless the import or another declaration separately replaces them.

## Identity

Each nominal declaration receives identity once while elaborating its defining `ModuleId`.

- Multiple imports of one `ModuleId` share those identities.
- Renaming changes a local key, not identity.
- Open import changes visibility, not identity.
- Distinct `ModuleId`s produce distinct nominal declarations even for identical source text.
- Rebuilding a snapshot may allocate new implementation IDs, but semantic equality within the
  snapshot follows defining module and declaration identity.

Persistent/cross-build identity is a separate cache and artifact-format question.

## Evaluation

For one program instance:

1. visit each module's outgoing import edges in source order;
2. traverse dependencies depth-first, skipping any resolved `ModuleId` already visited;
3. initialize each reachable `ModuleId` at most once;
4. complete every dependency before its importer begins;
5. evaluate declarations within one module in source order under Workman's ordinary dynamic
   semantics;
6. if initialization fails, stop the module, remember the failure, and do not start its importers;
7. preserve effects completed before the failure rather than rolling them back;
8. initialize the entry module after all dependencies;
9. perform target-specific behavior such as invoking exported `main` only after successful entry
   initialization.

There is no partially initialized import state because cycles are rejected.

## Re-export

No dedicated re-export form is included initially.

An ordinary value alias creates a new declaration. It shares the referenced immutable value but not
the original declaration identity. A future re-export must be a direct public-environment projection
that states its behavior independently for values, types, constructors, and structures.

## Interface artifact

Every elaborated module exposes a compiler-owned summary containing:

- `ModuleId`;
- public value/type/structure environments;
- declaration origins and nominal identities;
- dependency `ModuleId`s;
- whether initialization has relevant dynamic effects;
- diagnostics and completeness;
- a snapshot-local interface generation suitable for conservative invalidation.

Persistent semantic fingerprints are deferred. When introduced, they must be based on semantic
public-interface content rather than rendered type strings, display/backend names, unstable
allocation IDs, or private implementation text.

## Non-goals

- full SML signatures, functors, sharing, or nested structures;
- ESM-compatible cyclic linking;
- dynamic import;
- top-level await;
- runtime module reflection;
- default exports;
- CommonJS compatibility;
- implicit type abstraction through `private`;
- package resolution before a project/package model exists.
