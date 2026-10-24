# pakman

A meta version manager, part of wm (`wm pakman`): every package is a small Workman program that is the
version manager for one piece of software (what versions exist upstream, how to install any of
them), and pakman manages those programs: policy, locks, a store, generations, rollback, a
dependency graph and a sandbox. See [DESIGN.md](DESIGN.md) for the design and
[docs/wm-vs-nix.md](docs/wm-vs-nix.md) for what building it in wm shows.

v1 runs on the desktop (wm compiled to JS, run with Deno).

Implemented first case: [repository packages and package-owned dependencies](docs/repository-packages.md),
using atview → WM → Deno as the first case.
The [architectural rationale](docs/repository-native-packaging.md) explains why
repositories, forks, and independently maintained packaging projects are central
to the intended distribution model.
The [programming-model direction](docs/declarative-programs.md) describes normal WM
programs returning declarative plans, composable library helpers, and future capabilities.

## Package-owned dependencies (initial implementation)

Recipes can request private package instances using exact stable versions or
patch-compatible `~X.Y.Z` selectors:

```wm
let wm = package("wm", "~0.4.2");
-- In a plan, refer to its exported file:
file(wm, ".local/bin/wm")
```

`package` and `file` come from `src/model.wm`. Put these references in `requires`,
symlinks, or structured text just like `Own`/`Of`. Resolution selects the newest
matching age-eligible release, independently of globally exposed versions.
Private dependencies currently require `User` scope and the same target, and
cannot use shared-root `Of` dependencies. Existing `Of` behavior is unchanged.

`resolve`/`install` save the private graph beside the profile lock in
`pakman.lock.graphs/`; `build` consumes that snapshot without release discovery.
Private files stay in store instances, and only the requested package is exposed
in the profile. Transitive references contribute to store identity and manifests;
activation and rollback check their availability. Recipe changes require a new
resolve. Protocol 8 carries instance requests; old profile locks remain readable.

## Install from a GitHub repository

```sh
wm pakman install github.com/mommysgoodpuppy/atview
wm pakman install 'github.com/owner/project#branch-or-commit'
```

The repository must contain a root `pak.wm`. Pakman fetches an immutable GitHub
commit snapshot and compiles the recipe with the normal sandboxed protocol.
Repository-qualified identity is retained in locks and generations; its declared
short name is not a global identity. Only explicit resolve/install/update refresh
the repository. Builds use the recorded recipe and source snapshot, including
when another profile has since selected a newer snapshot.

Use `from "pakman/model.wm" import *;` and similar `pakman/*.wm` imports for
location-independent access to the package API. `pakman/repository.wm` supplies
`versions` and `source(name)` for a package providing its own repository snapshot,
and `resource(name, relativePath)` for files beside a recipe. `shellRef(path)`
embeds a path reference safely as one POSIX shell argument.

To test a new recipe before publishing it, explicitly map its repository address
to a local Git working tree:

```sh
PAKMAN_REPOSITORIES='{"github.com/mommysgoodpuppy/atview":"/home/ellie/git/atview"}' \
  wm pakman install github.com/mommysgoodpuppy/atview
```

The local snapshot includes tracked files and non-ignored untracked files,
excluding Git metadata and ignored files such as atview's `.env`. It currently
supports regular files only. The mapping is an explicit development override;
an unmapped GitHub address always uses GitHub. The new atview recipe must be
published there before the unmapped command can find it.

The atview recipe selects `wm ~0.4.2`; the WM recipe in `../pak/paks/wm` selects
`deno ~2.9.0`. Only `atview` is exposed in the profile. Its recipe explicitly
describes a generic command build:

```wm
BuildCommand(.{
  program = file(package("wm", "~0.4.2"), ".local/bin/wm"),
  arguments = ["compile", "app/main.wm", "--executable", "-o", "atview"],
  source = "atview.tar",
  strip = 1,
  output = "atview",
  dest = ".local/bin/atview",
  mode = Exec
})
```

Pakman extracts the source and runs the declared command in that directory.
There is no WM-specific build operation: the recipe selects WM and its CLI
arguments just as another package could select another builder. The one declared
output is installed; the program reference is a build dependency, not part of
the result's retained runtime closure. WM includes generated workers in the
executable. Configuration remains atview's `.env` in the working directory.
Application authors own any CLI/TUI dispatch.

WM also exposes this directly:

```sh
wm compile app/main.wm --executable -o atview
```

The command build backend permits Deno's normal runtime/import downloads in a
filesystem sandbox and works with an empty cache. Offline builds are optional
backend policy, not a universal package requirement. Pakman does not provision
an offline Deno environment or promise byte-identical builds. See the
[backend policy](docs/declarative-programs.md#compiled-applications-and-backend-policy).
The WM recipe invokes upstream `src/cli.ts` directly through its selected Deno;
there is no package-owned TypeScript adapter. Executable support and cache fixes
are included in the WM `0.4.2` Git tag; application recipes require at least
that patch. Git tags and JSR package publication are separate. The WM/Deno recipes currently target Linux,
with Deno binaries for x86_64 and aarch64.

On a fresh machine, register a package collection explicitly:

```sh
git clone https://github.com/mommysgoodpuppy/pak.git ~/pak
wm pakman add-dir ~/pak/paks
wm pakman install github.com/mommysgoodpuppy/atview
```

`add-dir` records the canonical directory in WM's user configuration at
`$XDG_CONFIG_HOME/workman/config.json` (default `~/.config/workman/config.json`):

```json
{ "pakman": { "directories": ["/absolute/path/to/pak/paks"] } }
```

Registered directories are searched in registration order, before the legacy
sibling `../pak/paks` fallback. Registering the same path again is harmless.
`PAKMAN_PKGS`, when set, overrides that search list for the process. Settings
are shared across profiles and independent of the current working directory.

WM uses `$XDG_CACHE_HOME/workman` for generated files and downloaded compiler
resources, and `$XDG_STATE_HOME/workman/pakman` for pakman stores/profiles.
Their defaults are `~/.cache/workman` and `~/.local/state/workman/pakman`.
`PAKMAN_STATE` remains an explicit override.

Registration solves recipe discovery; it does not change target support. The
current Deno binary recipe and Bubblewrap command-build backend target Linux;
registering a collection alone does not provide a Termux build backend.

The separate [SubsetML port](../pakman-subsetml/README.md) is authored in WM and
targets native MLWorks on PS2. Its initial package format and target adapters
are documented there.

## Use

```sh
wm pakman list                           # known packages and their locked versions
wm pakman versions zig                  # what upstream offers, by channel, and what pakman would pick
wm pakman resolve [pkg...]              # find upstream versions, pin them in the root's lock
wm pakman build t3-code                 # build the locked version into the store
wm pakman install gale aimp             # system packages: installed into / (sudo for the copy only)
wm pakman install zig                   # user packages: installed into your home, no root
wm pakman install zig@0.14.1 --root DIR # this version now; subsequent updates follow the default
wm pakman install --pin zig@0.14.1     # explicitly stay on this version
wm pakman install zig@dev               # follow a channel; `update` moves along it
wm pakman resolve zig@default           # back to the default channel, age-gated
wm pakman remove t3-code
wm pakman update                        # every root: resolve, build and reinstall what's installed
wm pakman generations
wm pakman rollback --user               # or --system, or --root DIR
```

Version selection, tracking, and age policy are separate:

| command | installs | future `update` |
|---|---|---|
| `install foo` | newest eligible release in the default or previously followed channel | follows that channel |
| `install foo@latest` / `foo@default` | newest eligible release in the default channel | follows the default channel |
| `install foo@stable` | newest eligible stable release | follows stable |
| `install foo@1.2.3` | exactly 1.2.3, or fails if too young | follows the default channel |
| `install --pin foo@1.2.3` | exactly 1.2.3, or fails if too young | stays on 1.2.3 |
| `install --force foo@latest` | newest release regardless of age | follows the default channel with the normal age gate |

Every install resolves requested packages again. Reinstalling without `--pin`
releases an existing pin; plain names retain a previously followed channel.
`--pin` can also freeze a version selected by a channel or `@latest`. It does
not bypass the age gate: young exact versions require `--force` too.
Existing exact tracks in old locks remain pinned during `update`/plain `resolve`
until an install or an explicit selector replaces them. No lock migration is needed.

`--force` skips age filtering for requested packages during this install only.
Dependencies retain their normal policy; checksums, host requirements, and
ownership checks still apply. Both `--force` and `--pin` are install-only flags.
An ordinary reinstall or update can downgrade a forced release while it is still
too young. Use `--pin` explicitly if that release must remain installed.
`build` consumes the existing lock without discovering new versions.

`wm pakman` (`src/pakman.ts` in wm-mini) compiles `pakman.wm` into a writable user cache when one of
its sources changed, then runs it like `wm run`, with the permissions the wm launcher has. Package
programs are compiled by the same wm checkout and always run sandboxed, whatever pakman was granted.
The launcher cache uses `$XDG_CACHE_HOME/workman` (or `~/.cache/workman`,
`$LOCALAPPDATA/workman` on Windows), separated by compiler source location.
Installed compiler sources need no writes.
When WM is loaded from JSR, pakman caches that exact published package under
`workman/packages`, verifying each resource against JSR's manifest before
starting its local compiler subprocess. It does not substitute a Git checkout.

Each package is its own wm program. pakman compiles it separately (cached until it or pakman's
`src/` changes) and runs it as a sandboxed Deno process for each step:

| step | what the package program does | Deno permissions |
|---|---|---|
| `describe` | prints name, description, minimum age, declared hosts | none |
| `versions` | asks upstream for candidate versions | network to its declared `hosts`, `GITHUB_TOKEN` |
| `make <version> <ref>` | prints the plan: sources, install steps, base requirements | none |

Everything else (policy, downloads, hashing, building, installing) happens in pakman. A package can
be run by hand for debugging: `wm run ~/git/pak/paks/zig/pak.wm -- make <version> "<ref from versions>"`.
For Zig, that ref is the exact tarball URL published by the upstream index.

Environment:

| variable | default | |
|---|---|---|
| `PAKMAN_STATE` | `~/.local/state/workman/pakman` | store, source cache, generations |
| `PAKMAN_LOCK` | `<state>/profiles/<root>/pakman.lock` | the lock file; each root has its own by default |
| `PAKMAN_PKGS` | registered directories, then `pak/paks` beside the wm checkout | override package directories, colon-separated; the first one wins on duplicate names |
| `PAKMAN_REPOSITORIES` | `{}` | JSON mapping GitHub repository addresses to local Git working trees for development |
| `PAKMAN_WM` | this wm checkout | the Workman compiler used for package programs |
| `PAKMAN_MIN_AGE_DAYS` | per package (3) | overrides every package's minimum release age |
| `PAKMAN_BASE` | `host` | `none` skips checking that `Base` files exist on the host |
| `PAKMAN_SUDO` | `sudo` | how the applier is elevated when pakman can't write the root (`doas`, `run0`, ...) |
| `GITHUB_TOKEN` | | raises the GitHub API rate limit for finders |

## Tests

```sh
wm test tests                # everything (~6 s once the test packages are compiled)
wm test tests/resolve.test.wm
wm test tests --filter refuses
```

The suite uses testman (`../testman`, a proposal for wm's testing framework). It has two layers:

- **Unit tests** of the logic: version choice (`resolve.test.wm`), the lock file (`lock.test.wm`),
  references and symlink paths (`refs.test.wm`), the WON plan packages print (`plan.test.wm`), and
  the applier with each of its refusals (`apply.test.wm`).
- **End-to-end tests** (`cli.test.wm`) that run `wm pakman` on the packages in `tests/pkgs` in
  throwaway roots: install with a dependency, remove, rollback, and refusing a broken reference, a
  missing host file, a bad checksum and a file pakman doesn't own. They need no network; compiled
  package programs are cached in `$TMPDIR/pakman-test-state`.

## Layout

```
pakman.wm        command line
~/git/pak/paks/   the packages (a separate repo): <name>/pak.wm each
src/packages.wm  finds, compiles and runs package programs (sandboxed)
src/package.wm   `serve`: the entry point package programs call
src/plan.wm      the WON protocol between packages and pakman
src/won.wm       WON helpers shared by the protocol and pakman's files
src/model.wm     Definition, Package, InstallOp, Policy
src/finders.wm   upstream version finders (GitHub releases, GitLab tags, redirects)
src/resolve.wm   picks a version by policy, pins source hashes
src/lock.wm      the lock: versions, tracks, source hashes
src/store.wm     builds into <state>/store/<hash>-<name>-<version>
src/install.wm   generations: checks a package set, plans the switch
src/apply.wm     the applier: the only code that writes into a root (owned-record, checks, copies)
src/io.wm        host operations with readable errors
src/fun.wm       small curried pipeline helpers (keepIf, foldSeries, unique, ignore)
src/refs.wm      the dependency graph: finds references in plans, renders them to paths
src/host.ts      the only code that touches Deno
```

## Writing a package

A package is `<name>/pak.wm` in a package directory (by default `~/git/pak/paks`, beside the wm checkout; the
folder can also hold patches and other files): a `definition` (a version finder, the hosts that finder may contact,
a policy, and `make`, which turns a version into sources and install steps) and the line
`let main = () => { serve(definition) };`. Paths are relative to the package's scope root (`/` or your home). See
`~/git/pak/paks/t3-code`, `zig`, `gale` (a `.deb`, nested extraction) and `aimp` (a version only
visible in a redirect).

A finder returns candidates newest first, each with a channel and the checksums upstream publishes
for its downloads (GitHub release digests, zig's index). pakman verifies downloads against them at
resolve time and marks each locked source as verified or not.

Files a package refers to are references, not strings: `Own("bin/foo")` for its own files,
`Of("other", "lib/x")` for another pakman package's, `Base("/usr/lib/libfuse.so.2")` for the host's.
They appear as symlink targets, inside written text (`cat([ref(Own("bin/foo")), lit(" %U")])`),
or in `requires`. pakman collects them from the plan to get the dependency graph: `install` pulls in
`Of` packages automatically, and a generation is refused if a referenced file doesn't exist, a
dependency would be removed, or a `Base` file is missing. `tests/pkgs/` has small examples
(`PAKMAN_PKGS=tests/pkgs`).

Each package declares a scope. `System` packages install where upstream lays them out (`/usr`,
`/opt`), unedited; pakman builds unprivileged and only the final copy into `/` runs through `sudo`
(`PAKMAN_SUDO` overrides). `User` packages install under your home directory (`~/.local/...`) with no
root. Next to pacman, pakman never touches a file it didn't install or one pacman's database lists.

## Composable package helpers

Provider adapters and candidate rules are separate. `githubReleases(repo)` handles
GitHub's API shape, draft filtering, and asset digests; it returns normalized
`Release` records. `releaseCandidates(options)(releases)` is a pure function over
those records, reusable with another provider's adapter or fixture data. No
combined GitHub wrapper is needed just to compose a fetch with `Task.map`.

```wm
let versions = () => {
  githubReleases(repo)
    :> Task.map(releaseCandidates .{
      ..stableReleases,
      versionOf = matchText "^gui-v(\\d+\\.\\d+\\.\\d+)$",
      assets = (version) => { [deb(version)] },
      ref = (release, _) => { release.tag }
    })
};
```

This follows Workman's [explicit currying/eta-reduction pattern](../../docs/advancedsyntax.md#the-triple-dry-out-pattern).
`releaseCandidates(options)` returns a pure list transformation. `Task.map` applies
it to the successful fetched result; the pipe supplies the Task as its first
argument. There is no forwarding `(releases) => ...` callback, single-use alias,
or need to group a generic carrier expression. Mapping remains explicit at the
asynchronous boundary. Use `Monad.via Task` for stages that return another Task,
as Envision does when looking up each pipeline's jobs. Keep fetch calls inside
`versions()` because Tasks are eager; configuring a selection function is pure.

`stableReleases` defaults to non-prerelease `vX.Y.Z` tags, channel `stable`, no
required assets, and an empty ref. Override `versionOf`, `accept`, `assets`,
`channel`, or `ref` individually. All named assets must be present. Release order,
publication date, and published asset checksums are preserved. Set asset rules
explicitly for binary packages. `matchText(pattern)(text)` returns the first
capture, the whole match for a pattern without captures, or `None`.

For example, T3 supplies its own tag parser, requires its AppImage, accepts
prereleases, and sets `nightly`. AppImageLauncher uses an asset predicate and
carries the irregular asset name as its ref. These are ordinary callbacks;
packages remain able to implement custom discovery directly.

`extractPayload(file, allowedMembers, dest)` returns an install operation that
opens exactly one named member and extracts the contained archive. Missing,
unsupported, duplicate, or multiple matching members fail. The underlying
`ExtractPayload(archiveChain, allowedMembers, dest)` also supports archive nesting.

`debPayload(file)` composes this operation with Debian's known `data.tar`, gzip,
xz, zstd, bzip2, and lzma payload names, installing at the system root. It only
extracts the payload; it does not execute Debian scripts. Packages still describe
necessary symlinks or other integration explicitly. This removes compression
and version guesses without guessing application layouts.

Protocol 7 adds the payload extraction operation. Old locks and store manifests
remain readable; package programs recompile through the existing cache mechanism.
Run extraction tests with `deno test -A tests/extract-host.test.ts`.

## Package-controlled builds

Packages may include `Build("callback-id", ["/usr/bin/cc", ...])` in their plan
and use `serveWithBuild(definition, build)` from `src/package.wm`. The callback
has type `BuildContext -> Task<Void, String>`. It receives the selected version
and upstream ref plus `/inputs` (locked source files, read-only), `/work`
(scratch), and `/out` (the root-relative installation tree). The package owns
its functions, branching, ordering, checks, and staging; there is no required
prepare/build/check lifecycle. Existing `Definition`, `Package`, and `serve`
constructors keep their signatures. Protocol 6 adds the build operation.

`src/build.wm` offers optional `input`, `scratch`, `run`, `stage`, and `patch`
helpers. Existing `io.wm` file and process functions also work in callbacks.
Declare absolute executable paths in `Build` so Deno can start those commands.
Children inherit the Bubblewrap filesystem and network boundary. Helpers do
not enforce a build-command language. See `tests/pkgs/hello-build/pak.wm` for
an ordinary Workman program that compiles C, checks it, and stages a binary.

Sources can use `file:///absolute/path` for local patches/scripts. Resolve
copies their bytes into the content-addressed cache and locks their hashes,
just like downloads. Editing a locked local source requires another resolve;
builds consume the cached snapshot. Resolve reevaluates sources even when the
upstream version stays the same: existing remote pins are retained, local files
are refreshed, new inputs are pinned, and removed inputs leave the lock. Input
names are single file names.

The `Build` callback backend requires Linux, Bubblewrap, and an Arch package database.
It denies network access, mounts `/usr` read-only, hides the host home, clears
the environment, and provides writable scratch/output/temp directories.
Deno restricts direct process launches to declared tools. Those tools' children
can use other tools inside `/usr`; the tool list is not a hermetic dependency
closure. Package code and literal local JS imports are mounted read-only.
Non-local or computed JS imports are not supported by this backend.

Build cache identity includes the plan, locked sources, version/ref, compiled
package code, its literal local JS imports, declared tool bytes, Deno and
Bubblewrap executables, host OS/architecture, and installed pacman database.
Changes made manually to undeclared files under `/usr` are outside the cache
contract. This is an offline host backend, not a portable reproducible build
claim. Its offline policy does not apply to all backends: command
builds use selected private tools and permit downloads. General artifact graphs
and PS2 cross-build environments remain future API work.

Failed callbacks leave no activated generation; their work directory is
removed. Staged special files, setuid/setgid files and multiply linked regular
files are rejected. Generation installation and rollback use the existing
manager path.

Run the Workman suite with `wm test tests` and host-boundary tests with
`deno test -A tests/build-host.test.ts` from this directory.
