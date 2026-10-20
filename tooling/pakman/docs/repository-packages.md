# Repository packages and package-owned dependencies

Status: initial atview implementation, 2026-10-20. This records the intended
behavior and current implementation. `Workman.package`/`Deno.package` examples
below remain illustrative; the implemented request API is `package`/`file`.

Initial implementation: `package(name, selector)` and `file(request, path)` now
express private dependencies through normal plan references. Exact stable
versions and `~X.Y.Z` ranges resolve to a saved graph beside the existing profile
lock. Builds realize its private closure without upstream discovery; manifests
record the closure for activation and rollback. Existing shared-root packages
continue through their original path. Private dependencies currently require
User scope, the same target, and no shared-root `Of` references.

GitHub root recipes, immutable commit snapshots, `pakman/*.wm` API imports,
repository-qualified identities, and an explicit local working-tree mapping are
implemented. Recipe receipts beside the profile lock and program paths in graph
snapshots prevent refreshing one profile from changing another profile's build.
`../atview/pak.wm` and the WM/Deno recipes in `../pak/paks` provide the first
real application graph. The remote atview recipe still needs publishing before
it can be fetched from GitHub; local mappings support testing without publication.

Atview's recipe declares a generic `BuildCommand`: its private WM executable,
explicit `compile app/main.wm --executable -o atview` arguments, source archive,
output and installation path. Pakman knows how to realize a command build, but
has no special WM compilation operation. WM includes its emitted workers via
Deno compilation. The installed executable does not retain the WM/Deno build
closure. Atview's working-directory `.env` convention remains unchanged.

The [programming-model direction](declarative-programs.md) records the
declarative package/build boundary and backend policy. Command builds allow
Deno's normal runtime/import downloads inside filesystem isolation. The offline
callback sandbox is one backend's policy, not a universal requirement. Pakman
has no first-class offline provisioning requirement.

## Goal

The architectural motivation is documented in
[repository-native packaging](repository-native-packaging.md): repositories
are distribution endpoints, catalogs are optional services, and a pak can grow
into an independently maintained and tested codebase.

Make a project installable by placing a `pak.wm` at its repository root:

```sh
wm pakman install github.com/mommysgoodpuppy/atview
```

Pakman packages are already programs that act as version managers for one
piece of software. They discover releases and describe how to provide a
selected version. Extend that model with repository discovery and composition
of package instances, rather than introducing a separate flake format.

Atview is the first concrete case. Its dependency graph is:

```text
atview → wm → deno
```

Atview selects WM. WM selects Deno and owns the details of running Workman
programs on it. Atview does not declare Deno as a second direct dependency.

## Packages compose as version managers

Conceptually, atview's package calls the WM package with a version selector,
and the WM package calls the Deno package with its own selector:

```wm
-- In atview's package, illustrative only:
let wm = Workman.package("~0.4.1");

-- In that WM package, illustrative only:
let deno = Deno.package("~2.8.0");
```

These are example versions, not verified minimum requirements for atview.
The existing package `make(version, ref)` operation already describes how to
provide a selected release. Shared selection helpers can match the package's
discovered candidates against a requested range and apply pakman's age policy.
Atview should not know Deno's release URLs, archive layout, or invocation flags.

The author-facing operation should feel like calling a package program with
a version. Whether that is implemented through ordinary WM composition or a
manager-mediated reference remains open. In particular, composition must not
accidentally grant dependency recipes the manager's filesystem permissions.
The current separate-program JSON protocol and sandbox boundaries are useful
properties to preserve.

## Version contract

Pakman assumes semver compatibility works. A range deliberately permits newer
compatible releases. An author who needs an exact software version supplies
that exact version number.

The first implementation only needs exact versions and patch-compatible
`~X.Y.Z` ranges:

| Request | Meaning |
|---|---|
| `0.4.1` | Exactly 0.4.1 |
| `~0.4.1` | At least 0.4.1, below 0.5.0 |
| `~2.8.0` | At least 2.8.0, below 2.9.0 |

Use familiar npm/Deno semver semantics rather than inventing a different
meaning for the same symbols. Caret ranges, unions, wildcards, and arbitrary
comparators can wait. Prereleases should not match ordinary stable patch
ranges. Existing non-semver packages and channel selection remain supported
through their current interfaces; this does not require every package to use
semver.

Within a requested range, resolution selects the newest eligible release.
The normal age gate still applies. Exact selection does not bypass that gate.
An existing realization of the selected package can be reused from the cache.
The version exposed by a global command does not participate in this choice.

## Each package owns its dependency graph

Dependencies belong to their consumers. They are not implicitly satisfied by
whatever executable is on `PATH`, or by the version exposed in a user profile.

Suppose the user's default `deno` is 2.9, while atview's selected WM requests
`~2.8.0`. Pakman realizes a matching Deno 2.8 patch for that WM. Running atview
uses its WM, and that WM uses its Deno. The default `deno` remains 2.9. The same
principle applies when atview's WM differs from the globally exposed WM.

Ownership does not mean copying dependencies for every application. Identical
realized package instances can share one store entry. Different selected
versions, recipes, or other relevant inputs produce distinct instances.
There is no requirement to find one version satisfying every installed app.

This separates two operations:

- **Realize a dependency:** make a particular package instance available to
  its consumer, without exposing its commands globally.
- **Install into a profile:** expose the requested application's commands and
  integration files, while retaining its dependency closure.

Installing atview therefore exposes `atview`; it need not expose `wm` or
`deno`. Explicitly installing WM or Deno can expose those commands separately.
Removing a global command must not remove an instance still used by atview.
Rollback must retain the dependency instances referenced by older generations.

Using a global dependency can be an explicit override later. It should check
the requested version and make the departure from package-owned dependencies
visible. Its exact syntax and update behavior are outside the first slice.

## Running a Workman application

WM should provide a packaging interface for a Workman application: its source,
entrypoint, generated artifacts, and launch behavior. Atview requests this
interface from its selected WM instead of reproducing WM's runtime wiring.

The first design keeps `atview → wm → deno` as the dependency relationship.
WM compiles at package build time without forcing atview to declare Deno
directly. Compiler references are resolved and hashed as build inputs; they
are omitted from the installed executable's runtime closure.

Atview has two concrete packaging details to handle:

- `js.worker` produces worker artifacts that must accompany the entrypoint.
- PNG decoding imports `jsr:@img/png@0.1.6`; its transitive module bytes must
  be included by Deno compilation. Deno can fetch it during the network-enabled
  build; a warm personal cache and offline vendoring are not required.

The PNG library remains an application-private language dependency, consistent
with pakman's existing policy against packaging language libraries globally.
Atview also currently reads `.env` relative to the working directory. The
installed application's credential/configuration location needs a deliberate
decision; credentials must never become package sources or store contents.

## Repository discovery and recorded state

The remote install command locates the repository's root `pak.wm` and obtains
the source snapshot needed to evaluate and build it. Local repository support
would make development practical, but its command syntax remains open.

There are two distinct versions to record: the revision of a recipe, and the
software release that recipe selects. A Deno recipe revision can provide many
Deno releases. Pakman should retain the recipe revision/content identity,
selected release and upstream ref, source hashes, and selected dependency
instances in its internal state.

No checked-in project lockfile is required. A fresh resolution of the same
atview source may choose newer compatible patches. That is intentional under
the semver contract. Exact selectors fix software release choices; hashes and
recipe identities still matter for identifying and verifying the bytes used.
Existing generations keep their recorded selections; an update produces a new
selection and generation rather than silently changing an old one.

Repository/ref selection, how an embedded recipe discovers its own releases,
and how short dependency names locate recipes need concrete rules before
implementation. In particular, two repositories declaring the same package
name must not collide in program caches or dependency identity.

## Relationship to flakes

Flakes provide a standard repository entrypoint declaring source inputs and
outputs. Their lockfiles record exact input revisions. See the
[flake overview](https://nix.dev/concepts/flakes) and
[Nix reference manual](https://nix.dev/manual/nix/2.22/command-ref/new-cli/nix3-flake).

Pakman borrows the convenient repository entrypoint and remote install
experience. Its package interface already exists: a program discovers software
versions and describes how to provide one. A dependency request invokes that
version-manager capability with a selector. The project expresses compatibility
and pakman records the resulting installation internally.

Package-owned dependencies also adopt the useful Nix property that independent
consumers can retain different dependency instances while sharing identical
ones. This requires changing part of pakman's current installation model;
it does not imply adopting all of Nix's build or filesystem conventions.

## Changes to current pakman

Today `Of(name, path)` refers to a named package installed into the same root.
The dependency traversal and lock are keyed by package name. Plans are copied
from store trees to conventional installation paths, and build tools are
declared as absolute host executable paths.

The proposed model requires:

- References to selected package instances and their exported tools/files,
  rather than only names and shared-root paths.
- Graph-shaped resolution state capable of retaining multiple versions of
  the same package, with dependency identities included in store identity.
- Realizing dependencies without installing them into the user's profile.
- Mounting the selected tools and their required files into build sandboxes;
  mounting only a tool executable is insufficient for WM's source/resources.
- Launching through explicit dependency references rather than ambient `PATH`.
- Generation records that retain the complete runtime dependency closure.
- Repository-independent access to the pakman package API. Existing recipes
  import it using relative paths into a neighboring WM checkout, which will
  not work for arbitrary downloaded repositories.

For relocatable tools such as Deno and WM, private dependency locations are a
reasonable first target. Pakman's existing system packages expect conventional
FHS paths. How package-owned instances extend to non-relocatable software is
separate work; the first implementation should preserve those packages' current
behavior. This proposal explicitly revisits the existing design's blanket
rejection of private runtime locations and launchers for this application case.

There is also a bootstrap distinction: the running WM/pakman evaluates recipes;
the WM requested by atview is a dependency being provided. Requiring that target
WM to exist before its own recipe can be evaluated would introduce a cycle.

## First implementation slice

1. Add version-manager recipes at `../pak/paks/deno/pak.wm` and
   `../pak/paks/wm/pak.wm`; WM declares its Deno dependency.
2. Support exact and `~X.Y.Z` dependency requests, package instance identity,
   and dependency realization separate from profile exposure.
3. Provide WM's application packaging/launch interface and add atview's root
   `pak.wm`, declaring only WM as its direct package dependency.
4. Support loading the repository recipe through
   `wm pakman install github.com/mommysgoodpuppy/atview`.

Validate with a different WM/Deno already exposed globally: atview must use
its own selected graph, leave those global commands unchanged, share identical
dependency realizations, and retain its graph across rollback. Also verify that
an unsupported or age-ineligible request fails without activating a generation.

A general constraint solver, complete semver range grammar, global dependency
overrides, development shells, and private instances of arbitrary FHS software
are not prerequisites for this first case.
