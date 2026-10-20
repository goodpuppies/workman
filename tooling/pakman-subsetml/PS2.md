# Native PS2 workflow

The installation is staged under
`/home/ellie/testingstuff/pakman-subsetml` on the PS2. Generated SML is compiled
there using MLWorks; the manager and package program stay authored in WM.
The sample application is translated from WM by the PS2's SubsetML compiler
during `pakman install`, not precompiled on the workstation.

## Runtime requirements

Use the experimental `runtime/main` and `runtime/libmlw.so` in that directory.
The existing working MLWorks runtime and SubsetML compiler image remain intact.
In addition to `-gc-low-memory`, this runtime includes:

* Correct target errno-name generation: preprocess musl's `errno.h` to include
  definitions from `bits/errno.h`; unknown names return `NONE`.
* Normalize native `system`/`waitpid` results to the saved Basis's wait-status
  layout. Linux stores exit codes in bits 8..15; this Basis expects bits
  24..31. Nonzero exits must remain failures and preserve their full byte.
* On-demand binding of newly registered runtime functions when loading older
  development images whose saved environment predates them.
* The Unix runtime primitive `application image deliver`, of full-SML type
  `string * (unit -> unit) -> unit`. It uses the existing forked delivery path
  and writes a relocatable application image for an external runtime.
* `application image deliver and exit`, with the same full-SML argument type,
  surrenders the current build process and exits after saving. The PS2 adapters
  use this mode so delivery needs only one development heap in RAM. Failure
  exits nonzero. It does not resume the listener or perform the optional
  preparatory stack-crawling collection used before forked delivery.
* Explicit delivery compaction can merge generations up to the arena space's
  real capacity, rather than stopping at the low-memory soft generation target.
  The ordinary allocation/collection policy still uses its smaller targets.
* Full-collection traversal follows the replacement generation returned by
  `self_collect`, avoiding a read through a freed generation descriptor.

The staging/build adapters route image delivery through
`MLWorks.Deliver.with_delivery_hook` and `MLWorks.Deliver.deliver`, preserving
Basis stream cleanup and the original exit behavior. `Internal.save` remains
the resumable-session operation; it is not changed to application delivery.

The initial resumable images were about 8 MiB each, and the memory watchdog
stopped the first install while running two MLWorks processes. Forked delivery
also exceeded the original 4 MiB available-memory reserve. A diagnostic retry
with a smaller reserve lost PS2 network connectivity and required a power cycle;
there was no console trace to establish the cause. The adapters now avoid that
fork and use the original 4 MiB reserve again. With delivery
and compaction, emulator images are about 316 KiB for pakman and 238 KiB for
the package program. The empty delivered-application reproducer shrank from
about 5 MiB to 4 KiB. Runtime tests check errno metadata, old-image lookup of
the new primitive, parent survival, delivery error propagation, image size
and application restart (`mlworks/tools/scripts/test-application-image.py`).

## Stage on the workstation

```sh
cd /home/ellie/git/wm-mini
python3 tooling/pakman-subsetml/scripts/stage.py /tmp/pakman-subsetml-mlworks \
  --target mlworks --prefix /home/ellie/testingstuff/pakman-subsetml
```

Copy that staged directory to the PS2. Staging generates separate projects
for the manager and `paks/hello/pak.wm`; it does not cross-compile their objects.
When replacing an existing staging directory, remove its generated `objects`
and `DEPEND` directories before copying. A tar overlay does not delete stale
objects, and MLWorks can reuse them despite changed source files.
Generated object names are prefixed with `pkm_` to avoid collisions with the
MLWorks Basis. The build script keeps load-time object links in a separate
`run-objects` directory so they cannot hide changed sources from the builder.

## Build and run on the PS2

```sh
cd /home/ellie/testingstuff/pakman-subsetml
. ./env.sh
export PAKMAN_MLWORKS_RUNTIME=$PWD/runtime
MLWORKS_DATA_LIMIT_KB=16384 MLWORKS_RSS_LIMIT_KB=18432 \
  MLWORKS_TIMEOUT_SECONDS=180 sh scripts/deliver-compiler-mlworks.sh \
  /home/ellie/testingstuff/mlworks-low-memory/full-native/run-objects \
  "$PWD/subsetml.img"
MLWORKS_TIMEOUT_SECONDS=120 sh scripts/build-project-mlworks.sh generated/pakman
MLWORKS_TIMEOUT_SECONDS=120 sh scripts/build-project-mlworks.sh generated/hello
sh scripts/run-memory-limited.sh bin/pakman install hello 1.0 \
  --root "$PWD/test-root" --state "$PWD/test-state"
test-root/bin/hello
bin/pakman list --root "$PWD/test-root"
bin/pakman remove hello --root "$PWD/test-root"
```

`env.sh` selects the package directory, the `wm-image` build adapter and the
image runtime adapter. The MLWorks scripts default to the staged `runtime/`;
`PAKMAN_MLWORKS_RUNTIME` can select another runtime. `PAKMAN_SUBSETML` points
to the staged launcher for `subsetml.img`. The delivery step uses the already
native-built compiler objects; it does not rebuild them or replace the original
10,373,312-byte compiler image. The compact image is about 1.46 MB. Repeated
installs need this smaller image: a repeat with the older compiler crossed the
4 MiB reserve and the watchdog stopped pakman. `PAKMAN_COMPILER_IMAGE` can
select another compiler image. Build adapters use the existing
`/home/ellie/testingstuff/mlworks-r5900` Basis, batch image and TTY image.

The memory wrapper retains its data limit, sampled RSS watchdog, reserve and
timeout behavior. It measures the directly launched process, not a sum of its
descendants. The application path needs the compact images precisely because
pakman waits while a package/compiler child runs. Build logs are written to
the package's work directory rather than returned as an enormous capture.

## Hardware result, 2026-10-17

The complete lifecycle passed on the physical PS2, without swap:

* Native batch compilation rebuilt both WM-derived programs and delivered
  images of 329,088 bytes (pakman) and 245,656 bytes (package program).
* `install hello 1.0` ran the separate package program, translated `hello.wm`
  with the PS2's native-built SubsetML compiler, compiled its generated SML
  with MLWorks, and delivered a 10,632-byte application image in the final
  compact-compiler lifecycle.
* The installed launcher printed `hello from native pakman`. Listing reported
  `hello 1.0`; the ownership record contained both installed paths and hashes.
* A duplicate install was rejected. After changing the installed launcher,
  removal was rejected and both owned files plus their record remained.
  Restoring the launcher allowed execution and successful removal.
* All seven compiled host-adapter checks passed on hardware, including literal
  arguments, separate output streams, exit 255, NUL rejection, signal
  classification, capture limits and missing executables/paths. This listener
  harness used a 16 MiB data cap to load its full Basis and test module.
* A deliberately failing build reported `exited 7: deliberate-failure` and
  left no installed file, ownership record or root lock. This also exercised
  the scripts' default staged runtime without an environment override.
* The original defaults remained in use: 12,288 KiB data limit, 16,384 KiB
  sampled RSS limit and 4,096 KiB available-memory reserve. The lifecycle
  used a 180-second timeout. After removal, 20,652 KiB was available, with
  `SwapTotal: 0 kB`. This is an after-run measurement, not peak usage.

The final root is `proof-compact-root`; the first successful build evidence
remains in `proof-compact-state/store/pakman-tmpnam_gbfhlA-0`. Its sample image
SHA-256 is `1b0c3387e23500b78e8cad575a43194f62e0a762c44937f189faaca256bce2a3`.
The compact native compiler is 1,462,912 bytes with SHA-256
`109c1f373144d3476ee49fb04721a52f2f4d5b35b85c73c1436a83b0cc8e6b6f`.
Raw logs, artifact hashes, generated sample SML and the lifecycle script are
retained in the sibling repository at
`psx-pi-smbshare/research/probes/pakman-subsetml/`.

After the removal/failure checks, `hello` was reinstalled and run using the
default staged runtime and compiler adapters. It remains available on the PS2:

```sh
cd /home/ellie/testingstuff/pakman-subsetml
. ./env.sh
proof-compact-root/bin/hello
bin/pakman list --root "$PWD/proof-compact-root"
```

MLWorks emits missing-structure diagnostics during dependency analysis of
the ambient Basis, followed by successful actual compilation. The success
criteria here include fresh objects, new images and observed application
behavior; the listener's exit status alone is insufficient to detect SML
errors. Earlier stopped-install and failed forked-delivery attempts are not
counted as successful lifecycle tests.
