# pakman

A meta version manager, part of wm (`wm pakman`): every package is a small Workman program that is the
version manager for one piece of software (what versions exist upstream, how to install any of
them), and pakman manages those programs: policy, locks, a store, generations, rollback, a
dependency graph and a sandbox. See [DESIGN.md](DESIGN.md) for the design and
[docs/wm-vs-nix.md](docs/wm-vs-nix.md) for what building it in wm shows.

v1 runs on the desktop (wm compiled to JS, run with Deno).

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

`wm pakman` (`src/pakman.ts` in wm-mini) compiles `pakman.wm` into `.build/pakman.js` when one of
its sources changed, then runs it like `wm run`, with the permissions the wm launcher has. Package
programs are compiled by the same wm checkout and always run sandboxed, whatever pakman was granted.

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
| `PAKMAN_STATE` | `~/.local/state/pakman` | store, source cache, generations |
| `PAKMAN_LOCK` | `<state>/profiles/<root>/pakman.lock` | the lock file; each root has its own by default |
| `PAKMAN_PKGS` | `pak/paks` beside the wm checkout (`~/git/pak/paks`) | package directories, colon-separated; the first one wins on duplicate names |
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
  references and symlink paths (`refs.test.wm`), the JSON plan packages print (`plan.test.wm`), and
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
src/plan.wm      the JSON protocol between packages and pakman
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

The first backend requires Linux, Bubblewrap, and an Arch package database.
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
claim. Independent build-dependency graphs, explicit tool closures, and PS2
cross-build environments remain future API work.

Failed callbacks leave no activated generation; their work directory is
removed. Staged special files, setuid/setgid files and multiply linked regular
files are rejected. Generation installation and rollback use the existing
manager path.

Run the Workman suite with `wm test tests` and host-boundary tests with
`deno test -A tests/build-host.test.ts` from this directory.
