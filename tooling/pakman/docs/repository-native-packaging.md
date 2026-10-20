# Repository-native packaging

Architectural rationale, 2026-10-20. The first GitHub root-recipe installation
path is implemented; catalogs, hosting backends, and collection paths can expand
from that starting point. See
[repository packages and package-owned dependencies](repository-packages.md)
for the implementation status and the first atview → WM → Deno case.

## Distribution starts with the package repository

The intended command is small:

```sh
wm pakman install github.com/owner/project
```

The architectural consequence is substantial: a repository containing `pak.wm`
can be a distribution endpoint in its own right. Publishing a usable package
does not require getting an entry accepted into a central package collection.

This should be established early, while pakman's package identity, dependency
references, and contribution conventions are still taking shape. Adding remote
installation later could leave the implementation and community assuming that
a package fundamentally means an entry in one privileged collection. Starting
with repository-addressable packages gives upstream projects, third-party
maintainers, and personal forks the same basic interface from the outset.

**Centralization should be a service layer, not an architectural requirement.**

## Several ownership models, one interface

All of these should be ordinary ways to distribute a pak:

| Model | Where the package program lives |
|---|---|
| Upstream-maintained | The software repository's root `pak.wm` |
| Independent third-party pak | A separate repository with its own root `pak.wm` |
| Curated collection | A repository containing several recipe directories |
| Personal fork | A fork of the software or packaging repository |
| Local development | A local project or packaging checkout |

A large collection remains useful, but its size or official status should not
give its packages a different execution model. A single-package repository and
a recipe inside a collection implement the same package protocol. The syntax
for selecting recipe subdirectories and local checkouts still needs designing.

The existing `../pak` collection can continue to provide recipes. It should be
one source of packages, rather than the foundation every dependency must pass
through. Likewise, a single repository per pak is a natural option, not a
required layout.

## Identity first, short names second

Git repositories and their hosting services already provide distribution,
history, and a collaboration namespace. Pakman can address packages through
those existing locations without inventing a mandatory global package-name
ownership database or central package hosting service.

There are several related identities to keep distinct:

- A recipe's location: repository plus recipe path within that repository.
- A recipe snapshot: that location at a particular revision/content identity.
- A selected software release: the version and sources provided by the recipe.
- A realized instance: the relevant recipe, software, dependencies, target,
  and other inputs used to produce its files.

For example, two repositories may both describe a package named `wm`. Their
matching display names must not make them interchangeable. A catalog can give
one of them the short alias `wm`, but that alias is a lookup convenience.
Dependency records and cache identities must retain the actual provenance.

The same rule applies to dependency calls. Conceptually,
`Workman.package("~0.4.2")` should identify a particular package provider and
request one of its software versions. It must not quietly depend on a globally
unique `wm` entry in a universal registry. Repository-qualified references and
explicit catalog mappings are possible ways to supply that provider; the
concrete API remains open.

Repository addressing supplies provenance and a distribution mechanism. Trust,
review, age policy, source verification, and sandboxing remain separate pakman
concerns. A repository's name alone does not establish those properties.

## Third-party packaging is an ordinary software project

A third-party pak can have a repository of its own:

```text
foo-pak/
├── pak.wm
├── src/
├── tests/
├── patches/
└── README.md
```

When it breaks, the contribution path is familiar: inspect its source, open an
issue, propose a patch, or fork it. A fork should be directly installable by
changing the repository reference. Making a personal fix usable should not
require transferring ownership of a centrally registered package name.

Replacing the top-level recipe with a fork is also a straightforward form of
customization. Replacing a transitive dependency still needs explicit graph
wiring or an override interface; direct repository installation does not by
itself define that interface.

An independent recipe can later move upstream, or upstream can keep delegating
packaging to an independent project. Both continue to speak the same package
protocol. Moving between repositories changes provenance and references, which
must remain explicit, but does not require a different recipe format.

## Packaging code can grow without changing its interface

A simple package should remain one small `pak.wm`. A complex package should be
able to become a normal WM codebase:

```text
foo-pak/
├── pak.wm
├── src/
│   ├── versions.wm
│   ├── platforms.wm
│   ├── sources.wm
│   └── build.wm
├── tests/
└── patches/
```

Release feeds, artifact selection, compatibility rules, platform differences,
patch transforms, and validation can require substantial programming. WM
provides typed data, functions, modules, and tests for that work. The package
need not accumulate all of its behavior in one shell script or push release
discovery into a separate updater maintained alongside the recipe.

The manager-facing interface stays the same as the implementation grows:
describe the package, discover candidates, describe a selected installation,
and optionally perform a build callback within the manager's build boundary.
Tests, CI, contributor documentation, and release automation belong naturally
in the packaging repository. Being a program does not grant a recipe ambient
manager permissions; composition must preserve the protocol and sandbox model.

For fast-changing software, keeping `pak.wm` upstream also allows a single
commit to change source layout, build behavior, and the corresponding packaging
knowledge together. Installing that snapshot can then use its matching recipe.
A recipe may still provide other software releases, so pakman must continue to
distinguish recipe revision from selected software version.

## Catalogs provide services

Curated collections and indexes can supply valuable services:

- Search, aliases, and discoverability.
- Reviewed recipes and maintainer trust policies.
- Build results, target compatibility, and security information.
- Binary caches and tested package combinations.

Collections can specialize in desktop applications, PS2 Linux, embedded
targets, or a deliberately small reviewed set. An index can list upstream
recipes, third-party alternatives, and forks without owning their definitions.

These services may become socially important. The architecture should still
allow a user who knows a package's repository location to install it without
the index. Losing a directory service should not invalidate the package's
identity or require moving its recipe into another central database. Source
and cache availability remain necessary for actually obtaining its bytes.

## Scale the graph being used

Pakman's packages are separately compiled programs. Resolution should load the
requested package and its dependency graph, without constructing or evaluating
an ecosystem-wide package set. A large catalog or many independent repositories
should not make unrelated recipes part of every installation's evaluation.

Discovery and search may require their own indexes; fetching and realizing a
large dependency closure still has real costs. The intended scaling property
is that package evaluation follows the graph in use, rather than the total
number of packages someone has published.

## Consequences for implementation

Repository loading is an early architectural feature, not merely a convenient
command-line shorthand. Its implementation needs to preserve these properties:

1. A standalone repository can supply a root `pak.wm` without central catalog
   registration or a neighboring WM checkout.
2. Repository and recipe-path identity survive dependency resolution, caching,
   and recorded installation state; equal short names do not collide.
3. Local development, forks, upstream recipes, and collection recipes use the
   same package interface and sandbox rules.
4. Dependencies can identify their providers without a mandatory universal
   package namespace.
5. Imported package modules and support files are part of the recipe snapshot;
   packaging can grow beyond a single file.
6. Catalog lookup and global aliases remain separable from directly addressing
   a known recipe.

The initial implementation supports direct GitHub repository identities and
keeps short-name lookup through `PAKMAN_PKGS` for existing catalogs. Atview uses
the short WM/Deno providers in `../pak` for its first working graph. This does not
define a universal package namespace or settle the future alias/catalog API.
