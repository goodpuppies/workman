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

The compiled executable embeds the Deno runtime and needs no Deno installation. Commands that run a
program (`run`, `watch`, `repl`, `test`, `pakman`, `problems`, `wm sml`'s JavaScript reader) restart
the executable as a script runner instead of invoking a Deno CLI (`src/child_runtime.ts`). JS/TS
reflection uses the Deno declarations generated into `src/generated/assets.ts` by `deno types` and the
`@types/node` declarations embedded in the executable, so build releases with the Deno version the
executable should embed and regenerate assets first.

Two features still need the Deno/JSR installation. Programs that import packages (bare, `npm:`,
`jsr:` or remote specifiers) are rejected with an explanation, because the executable's module
resolver only knows packages embedded at build time; see `markdown/npm-standalone-runtime.md`.
`--executable` needs Deno's own compile toolchain and is rejected as well.

The packed-install smoke test checks a pure-WM module, positional JS exports, framed mapper requests,
and the installed Vite integration with external Deno absent from PATH. It also copies the executable
out of the package and tests that standalone download shape.

## CI release workflow

`.github/workflows/release-artifacts.yml` validates source code, then builds and tests on six native
runner configurations. The native jobs move checkout source and library directories aside before
testing the packed installation, so source-path dependencies cannot pass unnoticed. Each target
produces an Actions artifact containing the main npm tarball, its platform tarball, a standalone
archive, and checksum metadata.

Pushing a version tag runs both release workflows. `publish.yml` publishes JSR, and
`release-artifacts.yml` publishes npm once all six native builds pass: `scripts/npm_publish.mjs`
checks that the tag matches the package version, verifies each tarball against its runner's
`SHA256SUMS`, and publishes the platform packages before the main package. Versions already on npm
are skipped, so rerunning failed jobs finishes a partial publish. A manual run builds and tests
only, unless its `publish` input is set.

npm publishing uses trusted publishing: npm accepts the workflow's GitHub OIDC token instead of a
stored token, so the repository has no npm secret and no one-time password is needed. Each of the
seven packages must list a trusted publisher on npmjs.com (package Settings, Trusted publisher,
GitHub Actions) with organization `goodpuppies`, repository `workman` and workflow filename
`release-artifacts.yml`. Releases published this way carry npm provenance.

Registry publishing is not atomic. Do not push a release tag until the release and its source
revision have been approved.

The first binaries are experimental and unsigned. macOS signing/notarization and Windows signing are
separate release improvements. The Deno runtime is embedded once per platform binary; the initial
Linux x64 executable is about 142 MB (roughly 45 MB compressed).
