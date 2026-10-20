# pakman targeting SubsetML

This is the native port of [pakman](../pakman/README.md), written in WM and
translated by SubsetML. It uses no WM/JS compiler or JS runtime. The original
desktop implementation remains in `../pakman`; this directory is the active
SubsetML/PS2 implementation. The separate `~/git/pakman` checkout is archived.

The first milestone is a local package lifecycle:

1. Run an independently compiled `pak.wm` package program to request a plan.
2. Copy declared local source files into a fresh build directory.
3. Execute the package's build steps, checking their exit status.
4. Translate the sample `hello.wm` locally, compile it, and deliver its image.
5. Install the image and its launcher under an explicit isolated root.
6. Record file ownership and SHA-256 hashes; list and remove the package.

The desktop MLton lifecycle and refusal tests pass. The MLWorks path uses the
PS2's native SubsetML compiler image and native MLWorks compilation. Hardware
results and reproducible commands are recorded in [PS2.md](PS2.md).
The current `~/git` layout and installed upstream Kilo package are described
in [NATIVE-WORKSPACE.md](NATIVE-WORKSPACE.md).
Candidate native builds are assessed in [NATIVE-PACKAGES.md](NATIVE-PACKAGES.md).
The planned first-class binary and remote build providers, including PS2 and
vrmodem/ShaderEmu platform profiles, are described in
[BUILD-PROVIDERS.md](BUILD-PROVIDERS.md). Those providers are not implemented yet.

## Layout

```text
pakman.wm          CLI: install NAME VERSION, remove NAME, list
src/model.wm      native profile of Definition/Package/Source/InstallOp
src/package.wm    package-program entry point: describe | make VERSION REF
src/plan.wm       versioned escaped line protocol between package and manager
src/store.wm      local inputs, build orchestration and generated launchers
src/apply.wm      ownership records, install preflight and removal checks
src/io.wm         Result composition, path validation and filesystem workflow
src/host.wm       checked target-adapter declarations
native/host.sml   Unix adapter shared by MLton and MLWorks
paks/hello/       an actual WM package definition and WM application source
scripts/          target staging, compiler and runtime adapters
tests/            native lifecycle, refusal cases and host contract
```

The WM code uses synchronous `Result` operations in place of the original
manager's JS-backed `Task` operations. Package programs remain separate
executables; a package is not a text file interpreted as a plan by the manager.
The plan/ownership protocol is an explicit native profile, not the original
JSON protocol. Fields escape `%`, tab, LF and CR. Unknown operations and bad
escapes are rejected. This prototype does not yet consume unchanged desktop
`pak.wm` definitions.

`Build` arguments distinguish literal strings from input, work and output
paths. `wm-image` is resolved through the selected target build adapter.
`Install` copies a build output; `Launcher` writes the target's image launcher.
Package source and destination paths must be relative and cannot contain
empty, `.` or `..` components. The manager rejects symlinked path components,
pre-existing destinations, duplicate destinations and modified owned files.
Large images are copied in 64 KiB chunks rather than read into the WM heap.

## Desktop native test

Requires the sibling `~/git/SubsetML` checkout with `bin/subsetml`, plus MLton:

```sh
cd ~/git/wm-mini
python3 tooling/pakman-subsetml/tests/test_native.py
```

The test compiles the manager and package program, builds the actual sample
application, installs and executes it, checks its ownership hashes, lists it,
and removes it. It also tests failing child commands, argv quoting, separate
stdout/stderr, exit status 255, NUL rejection, signals, capture limits, path
traversal, symlink ancestors, unowned destinations, modified installed files,
and the cooperative root lock. Test files live in temporary directories.

Manual native staging:

```sh
python3 tooling/pakman-subsetml/scripts/stage.py /tmp/pakman-native
. /tmp/pakman-native/env.sh
/tmp/pakman-native/bin/pakman install hello 1.0 \
  --root /tmp/pakman-root --state /tmp/pakman-state
/tmp/pakman-root/bin/hello
/tmp/pakman-native/bin/pakman list --root /tmp/pakman-root
/tmp/pakman-native/bin/pakman remove hello --root /tmp/pakman-root
```

External recipes can live in the usual sibling catalog, `pak/paks/NAME/pak.wm`:

```sh
python3 tooling/pakman-subsetml/scripts/stage.py /tmp/pakman-ps2 \
  --target mlworks \
  --prefix /home/ellie/git/wm-mini/tooling/pakman-subsetml/.build/ps2 \
  --packages-prefix /home/ellie/git/pak/paks \
  --package kilo=/home/ellie/git/pak/paks/kilo/pak.wm
```

`--package` adds independent package programs alongside the hello fixture.
Their generated launchers can be placed in the external catalog; the MLWorks
launchers refer to the selected deployment rather than assuming the catalog
is inside it. Package data files are copied into the staged package directory.
The Kilo recipe uses existing build commands for pinned HTTPS downloads,
SHA-256 verification and native GCC compilation; no C build logic is added
to the manager.

The MLWorks project adapter captures its batch log and refuses application
image delivery on compiler diagnostics, even when the old batch driver exits
zero. Its dependency scanner cannot enumerate Basis structures imported by
precompiled `require_all`; only those specific known Basis hints are exempted.
Actual syntax/type errors remain fatal. Use a fresh target graph after changing
module exports: overlaying staged files over an old remote graph can retain
stale object/dependency files.

Staging replaces generated SML and cached project objects. Keep authored
changes in this source directory. A portable copy of the WM sources and their
checker dependencies is also staged under `sources/`.

`InstallTree(source, destination, mode)` installs a directory of regular files
from the build output. Expansion rejects symlinks and special files, checks
normalized paths, and rejects duplicate expanded destinations before installing.
Every file is hashed and recorded through the existing installation transaction;
removal checks all of them before deleting any. The selected mode applies to
all files in that tree, so executable helpers and data should use separate trees.
Empty directories are not installed or owned.

## Target boundary

The adapter catches full-SML exceptions and returns `SubsetResult`; authored
WM still has no exception handlers. File operations use the shared SubsetML
byte-I/O adapter. Process calls preserve arguments with POSIX shell quoting,
close stdin, capture stdout and stderr separately, and report normal nonzero
exit codes as data. Signals and host failures return `Err`. Captured output
is limited to 64 KiB per stream when read back; child output is temporarily
spooled to disk. This is not a limit on the child's output-file size or time.

The current Unix profile needs `/bin/sh`, `chmod`, `sha256sum`, and standard
shell `test`. Build adapters require the native SML toolchain. Commands inherit
the environment. MLWorks application delivery needs the runtime changes
described in [PS2.md](PS2.md), including its existing delivery hooks.

## Current limits

This is a trusted-local, single-user prototype. Package and build programs
are executable code and are **not sandboxed**. An isolated root and cooperative
lock protect normal manager operations; they do not defend against another
process racing path checks. Do not point it at `/` or an existing system prefix.

Versions are explicit labels supplied to `make`; upstream discovery, release
age policy, a manager-level verified download cache, archive extraction, dependency
resolution, updates, generations and rollback remain to be ported. Build
directories are uniquely allocated and retained after successful installation;
they are not yet immutable or content-addressed store entries. Reported build
or install failures normally remove their store entry. Set
`PAKMAN_KEEP_FAILED_BUILDS=1` while debugging to retain it and print its path;
the installation lock is still released. This does not resume builds automatically.

Install preflights destinations and stages files before committing renames.
It attempts to undo already placed files on a reported commit error. This
does not provide crash recovery, a durable transaction journal or a guarantee
that rollback succeeds after an I/O failure. Removal validates all owned files
before deleting any, but an interrupted removal is also not transactional.
Unexpected termination can leave a lock directory requiring inspection.
Directory ownership/pruning and mode-change detection are not implemented.
The first MLWorks `wm-image` build adapter accepts one self-contained WM module.
