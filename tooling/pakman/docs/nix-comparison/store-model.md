# The store model

What Nix's store design buys, what pakman's FHS approach gives up, and what pakman should do
about each loss. Sources: Dolstra's thesis (`research/papers/dolstra-phd-thesis.pdf`, chapters 1–3)
and the Nix manual (`research/nix/doc/manual/source/store/`).

## What Nix set out to solve

Thesis §1.1 lists the deployment problems the store addresses. Each one, and where pakman stands:

| problem (thesis §1.1) | Nix | pakman today |
|---|---|---|
| uninstall must know what to remove, and must not remove what others use | GC over the reference graph | generations list every file; nothing tracks who uses a library |
| upgrades must not break other apps ("DLL hell") | each version at its own path | refuses to overwrite unowned files; one version per prefix |
| "to what component does this file belong?" | path tells you | generation manifest tells you |
| roll back a bad upgrade | switch the profile symlink | switch generation (diff-apply) |
| know what's installed and whether updates exist | external tooling | `versions` + policy, built in |
| complete deployment: no missing dependencies | hash scanning, closures | declared base requirements only |

## How Nix gets completeness: scanning for hashes

Nix builds each package into `/nix/store/<hash>-name`, and every reference a binary makes to
another package is that package's full store path (in RPATHs, shebangs, wrappers). After a build,
Nix scans the output for the hash part of every input path; each hit is a runtime dependency
(manual, `store/building.md`, "Calculate the references"). The thesis frames it as conservative
garbage collection (§3.4): treat any string that looks like a hash as a pointer.

That gives Nix the exact runtime dependency graph, closures for copying to other machines, and
safe garbage collection. It also explains most of the package overhead in
[packages.md](packages.md): `autoPatchelfHook`, `makeWrapper` and `buildFHSEnv` all exist to put
store paths into binaries that don't expect them, or to fake the FHS for code that can't be
patched. The thesis acknowledges the cost (§3.4: anything that hides hashes, such as compressed
files, "will break the detection").

## What pakman gives up

pakman installs at FHS paths and builds with `--prefix=/usr`, so binaries reference
`/usr/lib/libfoo.so.1`, not a store path. There is nothing to scan for, so:

1. **No automatic runtime dependency graph.** A pakman package that dynamically links a library
   another pakman package provides has no recorded edge to it today.
2. **One version per prefix.** Two packages can't install different `libfoo.so.1` into the same
   prefix.
3. **No closures.** Copying a package to another machine (the PS2 binary cache) can't compute what
   else must come along.
4. **Non-atomic switches.** Nix switches a profile by replacing one symlink. pakman links and
   unlinks files one at a time; an interrupted switch leaves a mix (already noted in DESIGN.md).

## What pakman should do about it

1. **Infer runtime dependencies from ELF, by soname.** pakman owns the build output, so after a
   build it can read each ELF's `DT_NEEDED` entries (e.g. `libgtk-3.so.0`) and resolve them:
   - provided by another pakman package in the same plan → a recorded dependency edge;
   - provided by the base (guest mode: a pacman-owned file) → a recorded base requirement, checked
     at install time, replacing hand-written `base = ["fuse2"]` where it's derivable;
   - provided by nobody → a build warning or error.

   This is how Debian's `dpkg-shlibdeps` and Arch's `namcap` work. It is weaker than hash scanning
   (it misses `dlopen` and non-ELF references, which stay declared by hand), but it needs no store
   paths in binaries. It also gives the guest-mode shadow check from DESIGN.md its data: a pakman
   package providing a soname the host already has is exactly the shadowing case.
2. **Garbage collection from generations.** The roots are every store entry named by any kept
   generation; everything else in the store and source cache can go. No reference scanning
   needed, because pakman's dependency edges are recorded in the store manifests (point 1).
3. **Closures from recorded edges.** With point 1, a closure is the transitive set of store
   entries over recorded edges, enough for a PS2 binary cache.
4. **Multiple versions only where it matters.** The private-prefix rule (`lib/<pkg>/` with
   `$ORIGIN` RPATH) already handles apps that need their own library version; that covers the
   cases people actually hit (bundled Electron/ROCm/Qt libraries) without a store-path model.
5. **Make switches crash-safe.** Write the target generation first as "pending", apply, then mark
   it current; on startup, if a pending generation exists, finish or revert it. On the PS2 in
   primary mode, where pakman owns `/usr`, a generation could instead be a complete tree switched
   with one rename, which is atomic like Nix's symlink.

## Verdict

Nix's store is a complete answer to every problem in thesis §1.1, at the price of compensating for
every binary that assumes the FHS. pakman keeps the FHS and recovers most of the same guarantees
from data it already has: generation manifests (ownership, rollback, GC roots) and ELF metadata
(runtime dependencies, closures, shadowing). What it permanently gives up is arbitrary
side-by-side versions in one prefix, and dependency detection for anything that isn't an ELF
`DT_NEEDED` entry.
