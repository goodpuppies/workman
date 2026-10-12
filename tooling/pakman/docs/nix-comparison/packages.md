# Packages side by side

The same software as packaged by nixpkgs, by `../cachy-packages-main` (PKGBUILD + Deno updater),
and by pakman. Measured on 2026-10-06 against the sparse nixpkgs checkout in `research/nixpkgs`.

The question is never "does pakman do it the Nix way" (see DESIGN.md, "Binaries first"). It is:
for the same goal, what does each approach cost to write, to keep current, and to install, and what
does it get you.

## Overview

| package | nixpkgs | cachy-packages | pakman | nixpkgs approach |
|---|---|---|---|---|
| t3code | 367 lines, 3 files | 103 (46 + 57) | 92 | builds from source (pnpm + Electron), wraps |
| bitwig-studio | 157 | 74 (24 + 50) | not yet | repackages the .deb, patches ELF, sandbox wrapper |
| vscode | 691 (shared with VSCodium) | 82 | not yet | repackages, patches ELF, optional FHS env |
| llama.cpp ROCm | 9 + 232 base | 141 | not yet | variant of the source build: `override { rocmSupport = true; }` |
| vLLM | 730 + 4 patches | 248 + lockfile | not yet | builds from source against nixpkgs' torch |

Line counts include each tool's update logic. nixpkgs has none inline for most packages (it's in
shared tooling, see below), which flatters it slightly.

## t3code

`research/nixpkgs/pkgs/by-name/t3/t3code/{package,unwrapped,resource-monitor}.nix`

- Builds from source: `fetchFromGitHub`, a fixed-output `fetchPnpmDeps` with its own hash, Electron
  44 from nixpkgs, `makeWrapper` for both the CLI and the desktop app.
- A separate `t3code` wrapper package puts agent CLIs (`codex`, `gh`, `git`) on `PATH` via
  `enableCodex ? true`-style flags: build-time variability exposed to users, which nixpkgs does
  well and pakman has no equivalent for.
- Store-model workarounds visible in the file: `dontPatchELF`, `noAuditTmpdir` (vendored
  foreign-platform binaries confuse patchelf), and on Darwin a `chmod` because "node-pty tries to
  chmod this helper at runtime, but the Nix store is immutable by then".
- Version 0.0.45 stable. Updates: `passthru.updateScript = nix-update-script { extraArgs =
  ["--use-github-releases"]; }`, run by a bot that opens a PR editing `version` and both hashes.

pakman (`pkgs/t3-code.wm`): repackages the nightly AppImage, 0.0.46 nightly, updates by `resolve`
with no source edit. Not equivalent: Nix's builds from audited source; pakman trusts upstream's
binary (mitigated by pinned hashes and the 3-day minimum age).

## bitwig-studio

`research/nixpkgs/pkgs/by-name/bi/bitwig-studio6/package.nix` vs
`../cachy-packages-main/packages/bitwig-studio-bin/PKGBUILD`

- The PKGBUILD's whole install step is `bsdtar -xf data.tar.zst -C "$pkgdir"`, plus 26 Arch
  dependency names.
- nixpkgs needs `autoPatchelfHook` (rewrite every ELF interpreter and RPATH to store paths),
  `wrapGAppsHook3` (GTK schemas and modules), deletion of the bundled `libxcb-imdkit` so the
  patched one is used, and a 20-line `bubblewrap` wrapper whose only purpose is to bind-mount a
  writable copy of `resources/VampTransforms` over the read-only store path.
- No version policy: nixpkgs tracks 6.1.3. The cachy package enforces the user's license ceiling
  (6.0.x) in its updater; a Nix user would pin with an overlay and lose automatic updates.

Every extra line in the Nix version exists because of the store model, not because Bitwig is hard
to install. pakman's FHS install would look like the PKGBUILD: extract, done.

## vscode

`research/nixpkgs/pkgs/applications/editors/vscode/generic.nix`

- `autoPatchelfHook` with `autoPatchelfIgnoreMissingDeps`, explicit `patchelf` calls, GApps
  wrapping, `sed` into the launcher script to set `VSCODE_PATH`.
- Ships an `fhs` variant built with `buildFHSEnv`, described as "should allow for easy usage of
  extensions without nix-specific modifications". Extensions download native binaries that assume
  an FHS system; nixpkgs' answer is to emulate one.
- Updater (`update-vscode.sh`): a `nix-shell` bash script that queries the GitHub API, then runs
  `update-source-version` and `nix-prefetch-url` per platform and edits the `.nix` file. The same
  pattern as cachy-packages' TS rewriting the PKGBUILD.

## llama.cpp (ROCm)

`research/nixpkgs/pkgs/by-name/ll/llama-cpp-rocm/package.nix` is 9 lines:
`(llama-cpp.override { rocmSupport = true; })`, plus a comment opting it out of automatic updates.

This is where Nix is clearly better. One source package with build flags yields CPU, CUDA, ROCm
and Vulkan variants, each a one-line override. cachy-packages repackages two separate upstream
binary tarballs (`llama.cpp-hip`, `llama.cpp-vulkan`) with duplicated 95-line updaters. pakman
currently has no notion of variants either; when it builds from source, a package taking options
(`make : Options -> Version -> Package`) would cover it.

## Automatic updates, as tooling

nixpkgs keeps versions in source and updates them from outside:

- `passthru.updateScript` (`research/nixpkgs/doc/stdenv/passthru.chapter.md`): "Nixpkgs tries to
  automatically update all packages that have an `passthru.updateScript` attribute."
- `nix-update` (`research/nix-update`) detects new versions for GitHub, PyPI, crates.io and so on,
  and rewrites `version` and hashes in the `.nix` file.
- To learn a hash it cannot compute directly (vendored Cargo, npm, pnpm dependencies), nix-update
  builds the package with `outputHash = ""`, lets the build fail, and regex-scrapes
  `got: sha256-…` from Nix's error output (`nix_update/dependency_hashes.py`,
  `extract_hash_from_nix_error`), then text-replaces it into the file.
- A bot (r-ryantm / nixpkgs-update, not in `research/`) runs this across the package set and
  opens PRs that humans review and merge, so a new upstream version reaches users only after a
  review and a channel update. (Not measured here.)

pakman makes "what is the newest acceptable version" part of the package (`versions` + policy)
and keeps the answer in `pakman.lock`, so nothing rewrites source and hashes are computed by
hashing, not by scraping a failed build. The vendor step pakman still needs (vLLM, fresh) will
have to produce its hash the same honest way: run the vendor step, hash its output, record it.

## Takeaways for pakman

1. The FHS decision pays off most on binary repackages (Bitwig, VSCode): the Nix overhead there is
   all store-model compensation.
2. Variants are Nix's real strength and worth copying when pakman builds from source: options as a
   parameter of `make`.
3. Policy (license ceilings, channels, minimum age) has no first-class home in nixpkgs; pakman's
   `Policy` covers what the cachy updaters did by hand.
4. Updating by rewriting source is universal in both Nix and the cachy setup. pakman's
   resolve-into-lock design is the one real departure, and it removes the fake-hash dance.
