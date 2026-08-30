# Closest SML relatives

## Short answer

No single SML file system is the direct ancestor of the proposed Workman design.

The closest semantic description is:

```text
SML sequential basis elaboration inside each file
+ an explicit acyclic dependency graph between files
+ per-file inferred public environments
+ selective, source-local import edges
```

The first part comes from SML. The graph and compilation-unit protocol occupy space the Revised
Definition deliberately leaves to implementations.

## There are three SML comparisons

Saying “SML files are sequential” conflates several different systems.

### Definition and interactive inclusion

The Revised Definition treats a program as top-level declarations and permits implementations to
offer file-inclusion directives. It leaves the effect of inclusion on the basis to the
implementation.

An SML/NJ-style interactive `use` commonly behaves like entering the file's declarations into the
current top level. This produces the simple mental model:

```text
Basis0
  + declarations from a.sml
= Basis1
  + declarations from b.sml
= Basis2
```

Dependencies and visibility are implicit in the selected order.

### ML Basis and Millet

MLB makes basis composition explicit in a separate description language. Source and basis
declarations are processed under an incoming basis and contribute to the basis available to later
items. Millet implements this as sequential basis accumulation, with dependency ordering for CM
source sets.

This is more structured than repeated `use`, but source files still do not automatically become
isolated per-file namespaces.

### SML/NJ CM

CM is already graph-native. Library members need not be listed in dependency order; CM computes the
dependency graph. It rejects cyclic source dependencies and executes a reachable compilation unit at
most once during one traversal.

CM therefore shares several properties that may otherwise sound uniquely ESM-derived.

Its graph is built differently:

- libraries and groups live in separate description files;
- dependencies among source files are inferred from top-level module definitions and uses;
- managed source files are restricted to top-level structures, signatures, functors, and functor
  signatures;
- top-level `open` is forbidden for dependency-analysis tractability;
- exports of library members are generally visible to the other source files in that library;
- the library description controls its exported top-level module symbols.

Official reference:

- [SML/NJ Compilation and Library Manager](https://www.smlnj.org/doc/CM/new.pdf)

This makes CM an important comparison, but not the proposed Workman protocol.

## The Workman shape

Workman places the dependency edge in the importing source:

```wm
from "./syntax.wm" import { Expr, Add };
```

The edge simultaneously records:

- the requesting source unit;
- the dependency specifier;
- the selected public declarations;
- local aliases.

After resolution:

```text
parser.wm --imports Expr, Add--> syntax.wm
```

The compiler does not infer the providing file from a free reference to a globally visible structure
name.

## A DAG of declaration sequences

The project-level model changes from one chosen global sequence:

```text
Prelude + a.sml + b.sml + c.sml
```

to:

```text
    main
   /    \
parser  printer
   \    /
   syntax
```

Each node still contains an ordinary sequential declaration elaboration:

```text
LocalBasis0
LocalBasis1 = LocalBasis0 + declaration1
LocalBasis2 = LocalBasis1 + declaration2
...
```

The topological schedule decides when a dependency's public environment is available. It does not
make declarations from every earlier scheduled file visible.

This is the critical scope rule:

```text
A imports B
B imports C

A does not see C unless A imports from C,
or B deliberately re-exports C in a future explicit form.
```

Compilation order is not lexical scope.

## What “extends a shared basis” should mean

There are three useful basis components.

### Prelude basis

The language/runtime basis selected for the source unit. This is genuinely shared:

```text
PreludeBasis
```

### Imported basis

A module-specific environment fragment constructed from explicit imports:

```text
ImportedBasis(M) =
  aliases to selected declarations from dependency public environments
```

These are references to dependency-owned semantic objects. They are not copied or regenerated.

### Local basis

The working basis used for ordinary sequential elaboration:

```text
Basis0(M) = PreludeBasis
Basis(i + 1) = extend Basis(i) with import or local declaration i
FullBasis(M) = final sequential basis
```

This is “the module system extends a shared basis” in the useful sense. It should **not** mean that
every module mutates one project-wide ambient basis and leaks its declarations to whichever file is
compiled later.

Under the preferred declaration-ordered rule, `ImportedBasis(M)` is introduced incrementally at
import positions. It remains useful as aggregate graph/interface metadata, but it is not installed
as one lexical environment before the file.

## Public environment

The public environment is not every name visible at the end of elaboration:

```text
PublicEnv(M) != FullBasis(M)
```

That formula would risk re-exporting the prelude and imported declarations.

The intended rule is:

```text
PublicEnv(M) =
  top-level declarations introduced by M
```

Imported declarations remain available for checking local declarations but do not become transitive
exports. `private` is deferred; a future visibility restriction must filter this environment without
regenerating identities. A future re-export form must opt into forwarding explicitly and preserve
origin identity.

## Files as stronger boundaries

The proposed Workman model makes several things automatic that SML typically expresses manually:

| Concern              | Common SML approach                                  | Proposed Workman approach                         |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Outer namespace      | explicit `structure X = struct ... end`              | canonical file supplies outer boundary            |
| Interface            | explicit signature/export list or ambient visibility | inferred from module-owned top-level declarations |
| Dependency edge      | order, MLB/CM description, or inferred module use    | import declaration in the client file             |
| Imported scope       | accumulated basis or library-wide visibility         | selected declarations only                        |
| Renaming             | structure/basis composition                          | local `as` alias                                  |
| Compilation identity | compiler/project unit                                | resolved `ModuleId`                               |
| Graph                | sequence, external MLB, or inferred CM graph         | explicit source-local DAG                         |
| Re-export            | signature/library composition                        | absent until explicitly designed                  |

Workman is simpler but less flexible:

- one file has one outer compilation-unit identity;
- files cannot silently contribute unrelated declarations to an ambient project scope;
- moving a declaration between files changes source import edges;
- full SML abstraction and module composition remain unavailable.

## What is actually borrowed from ESM

Graph scheduling, cycle rejection, and initialization-once are not uniquely ESM ideas; CM has close
analogues.

The more distinctly ESM-shaped choices are:

- dependency specifiers live in importing source;
- resolution turns specifiers into canonical module identities;
- imports select original exported bindings;
- scope is non-transitive;
- a file is the default compilation and interface boundary;
- optional future import maps can redirect stable specifiers.

Even here, Workman retains ML namespace and basis semantics rather than ESM's single export
namespace and runtime namespace objects.

## Closest concise description

Workman is closest to:

> An explicit, per-file compilation manager whose resolver builds an acyclic ESM-shaped graph, whose
> edges select SML environment components, and whose nodes elaborate ordinary SML declaration
> sequences.

The large difference from simple SML loading is indeed sequence versus graph. The large difference
from SML/NJ CM is explicit per-file imports and declaration-level boundaries rather than an inferred
graph of top-level language modules.
