# pakman design

pakman is a package manager whose packages are written in Workman (`wm`, see `../wm-mini`). It is
a complete package manager (resolution, a store, generations, rollback), not a layer of scripts over
pacman or apk.

More precisely, pakman is a **meta version manager**. Each package is a standalone wm program that
is the version manager for one piece of software: run it and it says what versions exist upstream
and exactly how to install any of them. pakman manages those programs, which all share one design.

## A meta version manager

`~/git/pak/paks/zig/pak.wm` is a zig version manager. It works without pakman:

```sh
wm run ~/git/pak/paks/zig/pak.wm -- versions      # every release and the current master, with checksums
wm run ~/git/pak/paks/zig/pak.wm -- make 0.14.1 "<tarball URL from versions>"
```

pakman adds what every version manager reimplements: policy (minimum age), a lock, a verified
download cache, a store, generations with rollback, a dependency graph, and a sandbox. So a pakman
package for zig replaces zvm in most cases:

| zvm | pakman |
|---|---|
| `zvm ls --all` | `pakman versions zig` |
| `zvm i 0.14.1` | `pakman install --pin zig@0.14.1` (explicitly pinned) |
| `zvm i master` | `pakman install zig@dev` (follows master on `update`) |
| `zvm use` | install into a root; switching is a generation, with rollback |
| several versions | one root per environment, e.g. `--root ~/.local/share/pakman/envs/zig-0.14` |
| `zvm vmu zig mach` | another package file (`zig-mach.wm`) |
| `zvm i --zls` | a `zls` package depending on `zig` (planned) |
| `zvm clean` | store garbage collection (planned) |

What makes this different from asdf or mise: their plugins are hooks into the manager (asdf) or
registry entries the manager interprets (mise); neither is a program you can ask "what's the latest
version?". A pakman package is, and it only describes: pakman performs every side effect, so any
client can run untrusted package code under the same sandbox. pakman is one client of the
protocol; a freshness dashboard, CI checks, or the future native PS2 client are others.

## Goals

1. **Less pain than Nix.** Software sees a conventional FHS install. No store paths baked into
   binaries, no wrappers, no patchelf, no nixGL.
2. **Replace the AUR and `../cachy-packages-main`** on the desktop.
3. **Automatic versions.** Upstream discovery is part of a package. Nobody hand-edits version
   numbers, and nothing rewrites package source to update.
4. **Replace the PS2 apk setup** (`../psx-pi-smbshare/research/{packages,tools/pkgbuild.sh}`).
   v1 cross-builds PS2 packages on the desktop. Later, pakman runs fully natively on the PS2
   (294 MHz, 32 MB): evaluate, resolve, build and install. Software from the PS2 era (compilers,
   emacs) builds fine on the console itself.
5. **Evaluate wm against Nix** on a real, hostile configuration problem. Findings go in
   `docs/wm-vs-nix.md` (language) and `docs/nix-comparison/` (packages, store model, ...).

## Constraints

- **Lightweight, embedded-grade by design.** v1 doesn't run on the PS2, but the design must not
  rule it out: no daemon, and nothing ever evaluates the whole package set; a command only runs the
  packages it needs.
- **v1 is wm on Deno and uses JS APIs freely.** All Deno access goes through `src/host.ts`. Once
  `../SubsetML` (wm → SML → MLton) is mature enough, pakman gets rewritten off the JS APIs to run
  natively on the PS2.
- **Part of wm:** pakman lives in wm-mini's `tooling/pakman` and runs as `wm pakman`, so it always
  compiles itself and its packages with the wm it ships with (`PAKMAN_WM` overrides for packages).
  Packages import pakman's library by relative path into the wm checkout, since wm imports are
  relative paths.
- **Scale:** real file lists are large (zig unpacks to ~20,000 files), and std's `List.map`,
  `filter`, `append` and `concat` recurse once per element outside tail position, which overflows
  the JavaScript stack. pakman uses loop-safe versions (`src/fun.wm`) for anything that can be big.
- **pakman packages applications and native libraries, never language libraries.** No
  `python-foo` or `rust-foo` packages. pakman never writes to `site-packages`, `~/.cargo` or
  `node_modules`, so the user's own `pip`/`uv`/`cargo`/`npm` are never affected. Apps with language
  dependencies vendor them into their own private prefix during a hash-pinned vendor step, using
  `uv`/`cargo`/`npm` as build tools.

## Binaries first, source when there's a reason

pakman is not trying to be Nix. Nix builds from source because its store paths must be baked into
binaries; pakman installs software where it expects to live, so upstream binaries work as shipped. A package
repackages upstream's binary when a usable one exists, and builds from source when there is a
reason: no upstream binary (the PS2 target), a patch to carry, or an architecture upstream doesn't
build for.

What that trades away is accepted knowingly: trust in upstream's build machine (mitigated by the
minimum-age policy and pinned hashes), no patching, and only the architectures upstream ships.

Comparisons with Nix measure outcomes for the same goal (lines to write, effort per update, how
current, install cost, what breaks), not whether pakman does things the Nix way.

## Software lives where it expects to

pakman installs software at the paths upstream lays it out for: AIMP in `/opt/aimp` with its
private libraries in `/usr/lib`, Gale's `.deb` payload under `/usr`, unedited. pakman adapts to the
software, never the other way round: no relocation into a prefix, no launchers or wrappers, no
rewritten desktop files, no patched binaries. (A first AIMP package that relocated into
`~/.local` needed a launcher setting `LD_LIBRARY_PATH` and three hand-copied desktop files; that is
the Nix approach coming back, and it was dropped.)

### Scopes: system and user

Each package declares its **scope**, which says where its paths are rooted and so whether
installing it needs root:

| scope | paths relative to | example | installing |
|---|---|---|---|
| `System` | `/` | `usr/bin/gale`, `opt/aimp/AIMP` | through `sudo`, for the copy into `/` only |
| `User` | the home directory | `.local/bin/zig`, `.local/share/applications/t3-code.desktop` | no root at all |

Software laid out for the system (Debian/Arch payloads, anything in `/opt` or `/usr`) is `System`.
Software that doesn't care where it lives, and per-user tools like toolchains (what zvm or nvm
install), is `User`. The root follows from the scope; `--user`/`--system` pick one for commands
that act on roots, and `--root DIR` overrides it (tests, building another system's root). A
dependency must be in the same scope (for now).

### Two modes: primary and guest

pakman is either the system's main package manager, or an extra one next to the host's (the role
the AUR plays today).

| | primary (PS2, future minimal systems) | guest (CachyOS desktop) |
|---|---|---|
| owns | all of `/` | the paths it installed, recorded in `/var/lib/pakman/owned.json` |
| base system | kernel + libc | the host distro |
| host package manager | none | pacman; pakman never runs it, reads its database to avoid its files |

**The base system is referred to by file.** A package that needs something from the host says so
with a `Base` reference to the file, e.g. `Base("/usr/lib/libwebkit2gtk-4.1.so.0")`, not with a host
package name. pakman checks the file exists before switching to a generation and reports anything
missing; it never installs host packages. This works on any host, pacman or not.

**Coexisting with pacman.** In guest mode both write under `/usr`. pakman refuses any path that
exists and isn't its own, and any path pacman's database lists, even if missing. In the other
direction, pacman refuses to install over files it doesn't own, so a later pacman package that
collides with a pakman one stops with a file conflict rather than overwriting it.

**Privileges.** Building, resolving and checking run as the user. Only the applier (below) writes
into `/`, and pakman runs it through `sudo` (or `PAKMAN_SUDO`: `doas`, `run0`, ...) only when it
can't write the root itself, the way paru builds unprivileged and then calls `sudo pacman`.

## Architecture

```
          pakman (manager, src/ + pakman.wm)                package programs (~/git/pak/paks/*/pak.wm)
 ┌─────────────────────────────────────────────┐   JSON   ┌────────────────────────────────┐
 │ resolve: age gate, pin hashes → pakman.lock │ ◀──────▶ │ describe   (no permissions)    │
 │ build:   fetch, verify, run steps → store   │          │ versions   (net: declared hosts)│
 │ install: check graph, link → generation     │          │ make <v>   (no permissions)    │
 └─────────────────────────────────────────────┘          └────────────────────────────────┘
```

pakman never imports package code. It compiles each package file into its own program and talks
to it over a small JSON protocol. Everything with side effects (downloads, hashing, the store,
generations) happens in pakman; packages only describe.

## Packages are programs

### Anatomy of a package

A package is `paks/<name>/pak.wm`: it defines a `Definition` and hands it to `serve`.

```wm
from "../../../wm-mini/tooling/pakman/src/model.wm" import *;
from "../../../wm-mini/tooling/pakman/src/package.wm" import { serve };

let definition: Definition = .{
  name = "t3-code",
  description = "...", homepage = "...", license = "MIT",
  target = Host,
  versions,                    -- Void -> Task<List<Candidate>, String>: upstream candidates, newest first
  hosts = ["api.github.com"],  -- the only hosts `versions` may contact
  policy = .{ ..defaultPolicy, channel = "nightly" },  -- default channel, minimum age, `accept` rule
  make                         -- (version, ref) -> Package: the plan for one version, pure
};

let main = () => { serve(definition) };
```

`versions` is a function, not a Task: wm Tasks start eagerly, and loading a package must never
touch the network. `make` returns a `Package` (see "Package model").

### Protocol

`serve` (`src/package.wm`) answers three commands, each printing one JSON document. Encoders and
decoders live together in `src/plan.wm` so the two sides can't drift; every document carries
`protocol` (currently 7) so a stale compiled package is detected.

| command | prints |
|---|---|
| `describe` | name, description, homepage, license, target, default `channel`, `minAgeDays`, `hosts` |
| `versions` | candidates: `version`, `published`, `channel`, and the `checksums` upstream publishes for that version's downloads; already filtered by the package's `accept` rule |
| `make <version> <ref>` | the plan: sources, install steps, requirements |

Text and references inside a plan travel as a flat list of uniform parts,
`{ kind: "lit" | "own" | "of" | "base", value, pkg }`, so one record shape checks them all.

A package can be run by hand for debugging: `wm run ~/git/pak/paks/t3-code/pak.wm -- make <version> ""`.

### Sandbox

Each command runs as its own `deno run --no-prompt` process with only the permissions it needs:

| command | Deno permissions |
|---|---|
| `describe` | none |
| `versions` | `--allow-net=<declared hosts>`, `--allow-env=GITHUB_TOKEN` |
| `make` | none |

So package code can't read or write the filesystem or reach undeclared hosts, and `make` is pure
because the runtime enforces it. This was tested with a hostile package: its request to an
undeclared host and its attempt to read `~/.ssh/known_hosts` during `make` were both denied. The
minimum-age gate is applied by pakman after `versions`, so a package can't skip it.

### Discovery and compilation

There is no package index. Packages live in a separate repo, `../pak` (pakman is to `pak` what Nix
is to nixpkgs): every `paks/<name>/pak.wm` is a package, and its folder can hold patches and other
files. `PAKMAN_PKGS` (colon-separated) overrides the directories; the first one wins on duplicate
names. pakman compiles each package on its own into `<state>/programs/<name>.js` and reuses it until
the package file or any file in pakman's `src/` is newer. A changed package recompiles alone (~1.6 s);
a cached command step costs ~25 ms.

Package files outside the checkout must import pakman's library by relative path, because wm has
no package resolution yet.

## Package model

The types in `src/model.wm`:

```wm
type Target = | Host | Ps2;
type Mode = | Exec | Data;

record Source = { file: String, url: String };   -- `file` is the name install steps use

type PathRef =
  | Own<String>          -- a file this package installs (relative to its scope root)
  | Of<String, String>   -- a file another pakman package installs: package, path
  | Base<String>;        -- an absolute path the base system must provide

type Text = | Lit<String> | Ref<PathRef> | Cat<List<Text>>;

-- archive: a source file, then members to open in turn (["gale.deb", "data.tar.gz"]);
-- members: paths to take from the innermost archive ([] = all); strip: leading components to drop
record Unpack = { archive: List<String>, members: List<String>, dest: String, strip: Number };

type InstallOp =
  | Install<String, String, Mode>   -- source file, destination, mode
  | Extract<Unpack>                 -- via bsdtar: any tar, .deb, .pkg.tar.zst, zip
  | ExtractPayload<List<String>, List<String>, String> -- archive chain, allowed members, destination
  | Symlink<PathRef, String>        -- target, link path
  | WriteText<String, Text, Mode>   -- destination, contents, mode
  | MakeDir<String>;

record Package = {
  version: String,
  sources: List<Source>,
  install: List<InstallOp>,
  requires: List<PathRef>           -- runtime needs not visible in installed text
};

record Checksum = { url: String, sha256: String };
record Candidate = { version: String, published: String, channel: String, checksums: List<Checksum>, ref: String };
record Policy = { channel: String, minAgeDays: Number, onlyLatest: Bool, accept: String -> Bool };
```

A candidate's `ref` carries whatever else `make` needs to find that version's downloads when the
version string doesn't say it: Envision's CI job id, Android's irregular archive names,
AppImageLauncher's `.deb` name. It is usually `""`. pakman stores it in the lock and passes it back to
`make`, so `make` stays a pure function of what the lock records.

Destinations are relative to the package's scope root (`/` or the home directory). Helpers:
`source`, `extract`, `extractMembers`, `lit`, `ref`, `cat`, `lines`, `desktopEntry`. Finders:
`githubReleases` (with per-asset digests as checksums), `gitlabTags`, `redirectTarget` (a stable link's final URL
and Last-Modified date), `fetchJson`.

Packages declare a `scope` (`System` or `User`) in their `Definition`; see "Software lives where it
expects to".

Planned extensions, added when a package needs them:
- build steps (configure/make, with a `run` escape hatch), for building from source and for the
  PS2 recipes
- build-time inputs (tools that run on the build machine vs libraries linked into the target)
- `checks` (e.g. `ldd` finds every library, `--version` succeeds), as cachy-packages' validators do
- options for variants (`make : Options -> Version -> Package`), the one thing Nix's `override`
  does clearly better (see `docs/nix-comparison/packages.md`)
- a vendor step for language dependencies, whose output is hashed into the lock

### Helpers compose at existing boundaries

Release fetching stays separate from pure candidate selection. Provider adapters
produce normalized `Release` metadata; `releaseCandidates` applies customizable
tag, acceptance, required-asset, channel, and ref rules. `stableReleases` supplies
common defaults and `matchText` handles common tag extraction. The GitHub adapter
adds actual schema/digest/draft behavior rather than wrapping a hostname argument.
Custom providers can use the same rule function without imitating GitHub JSON.

`ExtractPayload` is a provider-independent archive operation: select exactly one
allowed nested payload and unpack it. `debPayload` supplies the recognized Debian
payload filenames, removing package-level compression/version logic. Application
layout differences remain explicit package code. Protocol 7 encodes the operation;
its archive choices participate in the normal plan/store identity.

## References and the dependency graph

References are data. Every edge from a package to another package, or to the base system, is a
`PathRef` somewhere in its plan: a symlink target, a reference inside written text, or an entry in
`requires`. `src/refs.wm` finds them with ordinary functions over the plan:

- `dependencies(pkg)`: the other pakman packages it needs (`Of` names)
- `foreignFiles(pkg)`: the specific files it uses in them
- `baseFiles(pkg)`: host files it needs (`Base` paths)

This is the job Nix gives to string context (strings that silently remember the store paths
interpolated into them). wm doesn't need a language feature for it; see `docs/wm-vs-nix.md`.

Rendering to concrete paths happens in pakman at build time, after the edges are recorded:
- symlinks render **relative** (`.local/bin/zig` → `../lib/zig/zig`), so a tree also works inside
  another root (a test directory, a PS2 root filesystem being built on the PC);
- text renders **absolute** under the scope root (`/usr/...` for System, `/home/<user>/...` for
  User), whatever root the tree is installed into right now. For User packages the home directory
  is therefore a build input and part of the store hash.

Edges recorded this way only cover what package authors write down. Libraries an upstream binary
links come from its ELF `DT_NEEDED` entries; inferring those after the build is planned (see
`docs/nix-comparison/store-model.md`).

## Pipeline

```
package programs ──resolve──▶ pakman.lock
                   └─build───▶ store (<hash>-name-version trees + manifests)
                                 └─install──▶ root (/ or home), as a new generation
```

### Resolve

`pakman resolve [pkg[@selector]...] --root DIR` runs each package's `versions` and picks a
candidate by selector:

| selector | picks | on `update` |
|---|---|---|
| none, `@latest`, or `@default` | newest eligible candidate in the default channel (plain requests can retain a followed channel) | follows that channel |
| `@<channel>` (e.g. `zig@dev`) | newest age-eligible candidate in that channel | follows the channel |
| `@<version>` (e.g. `zig@0.14.1`) | exactly that version, or fails if too young | follows the default channel |
| `install --pin pkg@<selector>` | the selected version | stays on that version |

Selection and tracking are separate. The lock's `track` stores a followed channel,
`""` for the default, or an exact version only for a pin. Channel and exact version selections use the age gate unless an install has
`--force`. An exact version that is too young fails with a force hint. Old exact tracks remain pins during
update. Reinstalling without `--pin` releases a pin and resolves again; plain
names retain followed channels. `build` remains lock-driven.

If the pick differs from the locked version, pakman runs `make`, downloads every source into the
content-addressed source cache (`<state>/sources/<sha256>`), and checks each download against the
checksum upstream published for its URL, if any. A mismatch fails and the download is deleted. The
lock marks each source `verified` (matched an upstream checksum) or not (hash recorded on first
download). If upstream published checksums but none matches any source in the plan, resolve fails:
that almost always means `make` built the wrong URL.

Resolve is the only step that discovers new versions; builds read only the lock, so they are
reproducible until the next resolve.

### Build

`pakman build <pkg>` builds the locked version:

1. `make <locked version>` gives the plan; its sources must match the lock exactly (same files and
   URLs), otherwise the definition changed and pakman asks for a resolve.
2. The store hash is the sha256 of the build inputs: name, version, target, scope (and for User
   packages the home directory rendered text points into), requirements,
   source hashes and install steps. Not the machine that ran the build.
3. If `<store>/<hash>-<name>-<version>` exists, it is reused.
4. Otherwise every source is taken from the cache and re-hashed (a corrupted cache fails the build;
   a missing file is downloaded and verified), install steps run into a temporary directory,
   references are rendered, the tree is made read-only, and it is renamed into the store, so a store
   entry exists completely or not at all.
5. Beside it, `<entry>.json` records the files (with symlink targets) and the dependency edges:
   `depends`, `uses`, `base`.

### Install and generations

A root is an environment: it has its own generations and its own lock, so `zig@0.14.1` in one root
doesn't change the version in another. A generation is the set of store entries installed in one
root, plus every file they put there.
`install` collects the requested packages and, through `Of` references, everything they depend on
(transitively), builds them all, and switches to a new generation. `remove` and `update` also just
compute a new package set and switch.

Switching checks the new set before touching the disk. It first refuses, listing every problem,
when:
- a package needs another one that wouldn't be installed;
- a package uses a file the package it names doesn't install;
- a `Base` file is missing on the host (`PAKMAN_BASE=none` skips this).

Then it refuses when two packages ship the same path (reporting the first), or when files to be
created already exist and the current generation doesn't own them (reporting all of them), so
pacman's files, or anyone else's, are never overwritten.

Then it diffs the current and new file lists into a plan (files to add, paths to remove) and hands
it to the applier.

### The applier

`src/apply.wm` is the only code that changes files in a root. It runs in-process when the user can
write the root (User scope, test roots) and otherwise as its own program (`src/apply-main.wm`,
compiled to `<state>/programs/_apply.js`) under `sudo`. It trusts nothing in the plan about
ownership:

- It keeps its own record of what it installed, `<root>/var/lib/pakman/owned.json`, the way
  pacman keeps `<root>/var/lib/pacman`. For `/` that record is root-owned, so nothing running as
  the user can widen what it deletes. It only removes or replaces paths in that record.
- It refuses any path that exists and isn't in the record, and any path pacman's database inside
  the root lists. Every path must be relative, without `..`.
- It checks everything before changing anything, and grows the record before copying, so an
  interrupted apply never leaves files the record doesn't know about.
- Files are **copied**, not linked: installed files belong to whoever runs the applier (root for
  `/`), never to the user who built them, so a user-level process can't modify a system binary.
- Afterwards it runs triggers for caches the desktop reads, when files under their directory
  changed (`update-desktop-database`, `update-mime-database`, `gtk-update-icon-cache`, for both
  `usr/share` and `.local/share`), the job pacman does with hooks. When the root is `/`, it also
  does what systemd's pacman hooks do for `usr/lib/binfmt.d` (`systemd-binfmt`) and
  `usr/lib/udev/rules.d` (`udevadm control --reload`, `trigger -c change`, `settle`). Packages never
  ship install scripts.

The generation is recorded only after the applier succeeds. `rollback` re-applies the previous
generation the same way. Tested refusals: an unowned file in the way, a path a pacman database
claims, and a tampered generation asking to remove a file pakman never installed.

The cost of this design: one active version per package per root.

## Version policy

- **Channels:** every candidate is in a channel (zig: `stable`, `dev`; t3-code: `nightly`). A
  package's policy names its default channel; `pkg@<channel>` follows another one.
- **Minimum age:** default 3 days per package (`defaultPolicy`), matching the pacman/paru age gates
  in `~/docs/package-security.md`, so automatic "latest" doesn't bypass them. `PAKMAN_MIN_AGE_DAYS`
  overrides it for every package. Applied by pakman, never by the package, to all channel selections.
  Only command-local `install --force` bypasses it for a new selection.
  Updates retain already approved exact pins without reapplying the age gate.
- **Upstreams with only one build:** some upstreams (aimp.ru) only ever serve their newest build,
  so there is nothing older for the gate to fall back to. Such a package sets `onlyLatest` in its
  policy. A first install then takes the newest build, with a note that it is younger than the
  gate. After that, `update` keeps the installed version until a newer build passes the minimum
  age. The cached sources and the lock keep the held version buildable after upstream replaces it.
- **Accept rule:** a package's own filter, applied in the package before candidates are printed,
  for things like Bitwig's license ceiling (6.0.x only).
- **Pins:** `install --pin pkg@<version>` explicitly freezes a version.
  A version selector without `--pin` only chooses this install's version.
  `@latest` is an age-gated alias for `@default` and follows future releases.

`pakman versions <pkg>` shows every candidate with its channel and date, which one is locked, which
an automatic resolve would pick, which are too young, and which have no upstream checksum.
`pakman update --root DIR` resolves every installed package again along its track, builds, and
switches.

### One-install age override

`install --force` skips age filtering for requested packages only during that
command. It changes neither tracking nor configuration. Dependencies and all
verification/ownership checks retain their normal behavior. Other commands reject
the flag. Reinstalling or updating without force may downgrade a still-young
release to the newest eligible version, unless it was explicitly pinned.

## Machines and binary caches (planned)

Eventually every machine runs the full pipeline. A more powerful machine is only an accelerator:
it can cross-build and publish a **channel** (a resolved lock plus a map from store hash to archive
URL, served from the Pi, for example) that other machines use as a binary cache. Because the store
hash leaves out the building machine, a zsh cross-built on the PC and one built natively on the PS2
are interchangeable; `pakman verify <pkg>` would rebuild locally and compare. Closures for the
cache come from the recorded dependency edges.

This retires apk-tools, APKINDEX and the RSA signing pipeline on the PS2.

## State

| path | contents |
|---|---|
| `<state>/profiles/<root>/pakman.lock` | that root's resolved versions, tracks and source hashes (`PAKMAN_LOCK` overrides) |
| `<state>/profiles/<root>/<n>.json`, `current` | that root's generations |
| `<state>/sources/<sha256>` | downloaded sources, content-addressed |
| `<state>/store/<hash>-<name>-<version>/` | built trees, read-only |
| `<state>/store/<hash>-<name>-<version>.json` | that entry's files and dependency edges |
| `<state>/programs/<name>.js`, `_apply.js` | compiled package programs and the applier |
| `<root>/var/lib/pakman/owned.json` | the applier's record of every path it installed in that root |

`<state>` is `PAKMAN_STATE`, default `~/.local/state/pakman` (builds run as the user). Roots: `/` for
System packages, the home directory for User packages, or `--root DIR`.

## Code conventions

- **One host boundary.** `src/host.ts` is the only code that touches Deno; `src/io.wm` wraps it with
  readable `String` errors.
- **Carrier procedures.** Effectful code follows wm's documented style: named `Monad.via Task`
  transformations, one pipeline per procedure, values threaded as tuples.
- **`Task|a(), b()|` for effects in order.** Written inline it runs the steps one after another and
  states that they don't use each other's results; only steps that need an earlier result get a
  `via Task (x) => ...` stage. Steps are never bound to names first (Tasks start eagerly).
- **io functions stay plain**, not lifted with `via Task`: their arguments are pure, so lifting
  would only add `Task.succeed` wrapping.
- **Loop-safe lists.** Use `mapAll`, `filterAll`, `appendAll`, `concatAll` (`src/fun.wm`) instead of
  std's non-tail versions anywhere a list can hold a package's files; write recursions with
  accumulators. Package files with small lists can use std.

## Alternatives tried and rejected

- **A package index module.** First a hand-written `pkgs/index.wm`, then one generated by
  the old `bin/pakman` launcher. It worked, but every package compiled into pakman, so any package change
  recompiled everything, and package code ran with pakman's permissions.
- **Loading packages as separately compiled modules** (`wm compile-library` + `import()`). Values
  can't cross bundles: wm matches nullary constructors (`Nil`, `None`, `Host`) by identity against
  per-bundle singletons. JSON between processes avoids the problem and adds the sandbox.
- **Host requirements as pacman package names** (`pacman -T fuse2`). Replaced by `Base` file
  references: host-agnostic, and part of the same dependency graph.
- **One global lock.** Installing `zig@0.14.1` into a second root rewrote the version for every
  root. Locks are per root now.
- **Relocating software into a prefix** (`/usr/local`, `~/.local`) with launchers and rewritten
  desktop files. Replaced by installing where the software expects to live, with scopes deciding
  whether that needs root.
- **Hardlinking store files into the root.** A hardlink into `/usr` stays owned by the user who
  built it. The applier copies instead.
- **Emitting pacman or apk packages.** pakman would just be scripts over other package managers;
  it owns its store and generations instead.

## Status

**On the desktop:** `aimp`, `gale` and `wayvr` are installed in `/` by pakman, replacing their AUR
packages. `vesktop`, `xrizer`, `xr-hardware`, `android-build-tools`, `appimagelauncher` (System)
and `envision` (User) are ready to replace the rest of the AUR set. Still on pacman: `jack` and
`eigen3` (repo packages depend on them). Also `monado-git`, `libuvc`, `openhmd`, `libudev0-shim` and
`wivrn-server`/`wivrn-dashboard`: upstream publishes no Arch-compatible binaries, so they wait
for build steps.

**Working end to end** (`t3-code`, `zig`, `gale`, `aimp`, and the fixtures in `tests/pkgs/`): sandboxed package
programs; GitHub release and zig index finders; channels, selectors (`@version`, `@channel`,
`@default`) and tracks; the minimum-age policy; upstream checksum verification; per-root locks;
verified source cache; store builds with nested archive extraction and rendered references;
desktop/mime/icon cache triggers; dependency
closure on install; generation checks (dependencies, used files, base files, conflicts, ownership);
native layout with System and User scopes; the applier (owned-record, pacman database check,
copies, elevation only when needed); remove, update, rollback; side-by-side versions in separate
roots.

Not built yet:
- build steps, so nothing built from source yet
- the PS2 target: cross-builds, rootfs generations, channels
- ELF `DT_NEEDED` dependency inference and the guest-mode shadowing check
- garbage collection of the store and source cache (roots: every kept generation)
- crash safety mid-activation: record a pending generation before applying it
- `ld.so.conf.d` handling for packages that need it
- variants (options for `make`), `checks`, the vendor step, `pakman verify`, `pakman run pkg@version`
- zig: community mirrors and minisign signature checks; a `zls` package
- more packages: `bitwig-studio-bin` (HTML finder, version ceiling), `mquickjs` and `pfetch` (PS2),
  `python-vllm-rocm` (vendor step), `fresh-git` (composite git version), `llama.cpp-hip` (checks,
  systemd unit)

## First build API (2026-10-08)

The `Build(id, tools)` operation invokes an optional `serveWithBuild` callback.
It describes the manager/program boundary, not the package's internal build
phases. Packages orchestrate ordinary Workman functions and Tasks themselves;
`build.wm` supplies small optional conveniences. The manager stages locked
inputs, runs the callback offline in Bubblewrap, validates output, and keeps
store/generation ownership. Runtime references remain distinct from host tools.

Compilation now tracks the contents of imported Workman modules, including
helpers outside the package and pakman directories. JS FFI imports remain
external to the compiled bundle, so literal local imports are recursively
included in the build identity and sandbox. Compiler/standard-library source
mtimes invalidate compilation; a replacement `PAKMAN_WM` binary is hashed.

The initial environment is deliberately the read-only host `/usr`, fingerprinted
with pacman's installed database and declared executable bytes. It does not
promise hermetic tool closure or arbitrary-host portability. The README records
the precise boundary and the remaining dependency/cross-build work.
