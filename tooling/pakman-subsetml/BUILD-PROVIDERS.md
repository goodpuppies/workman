# Package build providers for small targets

Design direction agreed in the 2026-10-18 PS2 / vrmodem discussion. The APIs
below are proposed; the current implementation still has local `Build`
operations. This document does not claim binary-cache or remote-build support
is already implemented.

The original WM/JS pakman already supports downloaded binary payloads, locked
sources and a content-addressed local build cache. Those are useful existing
contracts to carry into this port. The new first-class work is explicit
platform compatibility and provider choice, particularly remote/cross builds;
it should also account for the original desktop implementation rather than
create an unrelated package system.

## The package remains on the device

`~/git/pak/paks/NAME/pak.wm` should remain the package definition on the
installation machine. It describes the requested version, pinned sources,
build recipe, compatible platform and installed payload. The device runs
pakman to select, acquire, install, list and remove that package, regardless
of where its executable was compiled.

Support three providers behind one package/install model:

1. A **local source build** runs on the device, as Kilo does today.
2. A **binary provider** obtains an existing payload for the exact recipe and
   platform, checks its digest, then uses the normal installation transaction.
3. A **remote source build** asks a configured builder for that same payload.
   The builder can cross-compile or compile natively on a compatible machine.

A remote builder that happens to use emulation is another implementation of
the third provider. It need not become a fourth package format.

## Platform identity must be explicit

Distinguish the platform **running the build tools** from the platform
**running the installed program**. Cross compilers themselves additionally
have a code-generation target. Do not overload the SML backend selector
(`mlworks`, `mlton`, eventually Moscow ML) with any of these roles.

The existing machines demonstrate why `uname -m` or a generic architecture
string cannot be the compatibility key:

| Installation platform | Properties needed in its profile |
| --- | --- |
| PS2 Linux | R5900-compatible instructions, little endian, MIPS o32, musl soft-float ABI, compatible kernel/runtime requirements |
| ShaderEmu Linux reached through vrmodem | RV32IMAF, little endian, `ilp32` calling convention, musl, static linkage for the current image |

The second profile is taken from ShaderEmu's
`linux/userland/toolchain.sh`; `vrmodem` supplies the network transport.
RV32IMAF does not imply the `ilp32f` calling convention. A generic `mipsel`
binary is similarly not established to be R5900-compatible.

Use named versioned platform profiles containing these properties and the
toolchain/runtime identity. Compatibility with another profile must be an
explicit rule, never a filename guess. The first implementation can require
exact profile matches. Supporting pakman execution on RV32 also needs its
own SubsetML/SML host adapter; no RV32 pakman deployment is claimed yet.

## Separate package intent from machine configuration

Recipes describe how to build; local configuration chooses a provider and
maps builder names to endpoints, commands and credentials. A package must
not hardcode Ellie's workstation address, SSH password or PS2 directory.
Package evaluation should receive an explicit request containing the
installation profile and build policy. It should not silently infer the
target from the machine evaluating `pak.wm`.

Suggested policies: `local`, `binary-only`, `remote:NAME`, and an explicitly
configured `prefer-binary` fallback order. A binary-only request must fail
when no matching artifact exists. Remote failure must not silently launch a
large native compiler on the tiny machine.

User decision: provider defaults are configurable **per installation target**,
with a command-line override for an individual operation. A profile may prefer
cached binaries, permit a named remote builder, or explicitly allow a native
fallback. The exact CLI spelling and configuration format remain to be implemented.

Keep **build tools** separate from **target libraries**. A code generator runs
on the builder; headers and libraries must match the installation profile.
This matters for MicroQuickJS's generators as well as ordinary cross builds.

The current SML target adapters launch/compile WM package programs. Package
build-provider adapters execute source builds or acquire payloads. These are
different interfaces even when both use SSH or compiler processes internally.

## One payload and ownership path

All providers return a payload plus a manifest. Local builds must use this
contract too, rather than creating a separate binary installation engine.
Validate the package/version, installation profile, recipe/input identity,
and payload digest before touching the installation root. Existing per-file
ownership, conflict detection and modified-file refusal still apply.

An artifact identity must include the recipe and patches, source digests,
installation profile, toolchain profile, dependency identities and relevant
build options. `NAME-VERSION-ARCH` is insufficient. An identity is a cache
lookup key, not a claim of reproducibility: record the actual output digest.
Store the provider and build provenance alongside ownership so a later
inspection explains where an installed binary came from.

Binary payload extraction must reject absolute/traversal paths, links and
special files before extraction. The existing `InstallTree` checks cannot
undo an unsafe archive extraction that already wrote outside the payload.
Digests must come from a trusted recipe/manifest or an authenticated builder;
a digest supplied beside an arbitrary download does not establish trust.

## Remote job boundary

Send a versioned job manifest with logical input/output paths, pinned source
locations/hashes, recipe inputs, build and installation profiles and requested
outputs. Do not send the local `/home/ellie/...` paths as remote command args.
The provider maps those logical paths into its own fresh workspace.

Return a job identifier, bounded diagnostics/status and a content-addressed
payload manifest. Allow reconnecting to an existing job; a dropped SSH session
should not force a second build. Transport can initially be a configured
SSH command adapter. A network service or automatic public upload is not
required, and no remote build credentials belong in a recipe.

vrmodem makes efficient transfer especially important: its documented uplink
is around 800 bytes/s. Let the builder download pinned upstream archives
directly, send only missing recipe/patch inputs, and download just the
resulting package to the device. Resume and digest verification should be
available without streaming the full compiler log over that link.

## Implementation sequence

1. Complete native Make/zlib packaging and keep those as local-build fixtures.
2. Add explicit installation profiles and provider selection to the request
   and plan protocols, with rejection tests for wrong profiles and policies.
3. Add a pinned binary-payload provider, initially from local/HTTP artifacts,
   using the same installation transaction. Prove it with one tiny program
   cross-built for PS2 and RV32; inspect ELF metadata and run it on each target
   when that target is available.
4. Add a configured remote job provider returning that same payload format.
   Test success, failed job, reconnect, missing outputs, wrong platform and
   digest mismatch. Do not require an always-online builder for cached payloads.
5. Connect target-library and build-tool dependencies to the same identities.
   General dependency resolution and signed APK import are separate work.

Changing from source to binary or remote delivery should then be a provider
choice, not a different package name or a shell workaround in every `pak.wm`.
