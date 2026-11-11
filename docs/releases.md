# Release preparation

One repository supplies the JSR source package, npm integrations, platform npm packages, standalone
executables, and VS Code extension. The source checkout stays private on npm; generated staging
manifests are public. Preparing artifacts does not publish them.

`deno.json` is the authoritative version. Synchronize source metadata before preparing a release:

```sh
deno task release:version 0.7.0
```

This updates `deno.json`, the source `package.json`, and the VS Code package and lockfile. Generated
platform manifests always take the version from `deno.json`; the main npm package depends on those
exact versions. The example's npm lockfile can be refreshed with
`npm --prefix examples/content-mapper install --ignore-scripts`.

## Local candidate

With Deno 2.9.8, Node 20+, npm, and tar available:

```sh
deno task release:stage                  # build and stage the host platform
npm run release:smoke                   # pack/install in a temporary project and test it
npm run release:pack                    # retain tarballs, downloads, and checksums
```

All generated output lives under gitignored `_scratch/release/`:

- `npm/workman/`: main `@goodpuppies/workman` package, JS adapters, declarations, and CLI launcher.
- `npm/workman-<platform>/`: one native executable, license, and platform manifest.
- `binaries/<platform>/`: compiled executable.
- `artifacts/`: npm `.tgz` packages, standalone `.tar.gz` downloads, SHA256SUMS, and release
  manifest.

Select platforms with `--target linux-x64,linux-arm64`, or build all six with `--all`.
`--out <directory>` changes the output directory. `--skip-build` restages existing binaries; rerun
smoke tests to catch stale binary versions. Do not mix artifacts from different source revisions.
The manifest records Deno's version, source revision, dirty state, target, and executable checksum.
Local candidates from a dirty tree are useful for testing; publish candidates should come from a
clean committed revision through CI.

Targets are Linux glibc, macOS, and Windows on x64/ARM64. Linux musl/Alpine is not supported by
these Deno compile targets. Other-platform binaries can be cross-compiled, but need native smoke
checks before being considered release-tested.

## Installed npm behavior

The main package declares platform packages as optional dependencies using OS/CPU/libc filters. It
has no postinstall downloader. Its Node launcher resolves the installed platform package, checks
that versions match, and starts the executable. `wm` is exposed through npm's bin mechanism; the
TypeScript content mapper uses the same launcher. Do not omit optional dependencies.

The installed Vite and Bun adapters resolve the same binary and invoke `compile-library-json`. They
do not refer to the source checkout or launch Deno. Their override option is `compilerPath`; the
source-checkout adapters retain `denoPath` for development.

The compiled executable supports checking, JS/library compilation, the content mapper, the WM LSP,
and other analysis commands. The packed-install smoke test checks a pure-WM module, positional JS
exports, framed mapper requests, and the installed Vite integration with external Deno absent from
PATH. It also copies the executable out of the package and tests that standalone download shape.
This is not a claim that every WM feature is Deno-independent: JS/TS reflection paths can still
invoke external Deno. Runtime commands (`run`, `watch`, `repl`, `pakman`, `problems`, `test`,
no-argument REPL, and executable generation) are deliberately rejected by this experimental
standalone entry. Use the source-based Deno/JSR installation for those until runtime dispatch is
updated.

## CI candidate artifacts

`.github/workflows/release-artifacts.yml` is manual (`workflow_dispatch`). It validates source code,
then builds and tests on six native runner configurations. The native jobs move checkout source and
library directories aside before testing the packed installation, so source-path dependencies cannot
pass unnoticed. Each target produces an Actions artifact containing the main npm tarball, its
platform tarball, a standalone archive, and checksum metadata. Nothing in this workflow publishes to
npm, JSR, or GitHub Releases.

The existing `publish.yml` still publishes JSR on matching version tags. Do not push a release tag
until the release and its source revision have been approved. Changes to CI are not run remotely
until committed/pushed and the workflow is invoked.

## First publication and account setup

Before publishing 0.7.0:

1. Run the candidate workflow and review all six native smoke checks and artifact manifests.
2. Confirm npm access to `@goodpuppies/workman` and its six platform package names.
3. Provide npm publishing authorization for the initial packages. Never put credentials in this
   repository or send them through chat. Configure npm trusted publishing for the eventual
   publishing workflow when the packages/settings support it.
4. Publish platform packages first, then the main package referencing them. Keep one exact version
   across registries and artifacts; registry publishing is not atomic.
5. Publish JSR and standalone release downloads from the same tested source revision.

Publishing, pushing tags, uploading release assets, and changing account settings remain explicit
release actions. The preparation scripts do none of them. A publishing workflow is intentionally not
enabled by this initial setup.

The first binaries are experimental and unsigned. macOS signing/notarization and Windows signing are
separate release improvements. The Deno runtime is embedded once per platform binary; the initial
Linux x64 executable is about 142 MB (roughly 45 MB compressed).
