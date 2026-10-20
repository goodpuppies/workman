# PS2 development workspace

The PS2 now uses the same project layout as the main machine:

```text
/home/ellie/git/wm-mini/tooling/pakman-subsetml/  manager/adapter source
/home/ellie/git/SubsetML/                       compiler source and native launcher
/home/ellie/git/pak/paks/kilo/pak.wm             upstream package recipe
```

wm-mini and SubsetML contain copies of the current Git metadata and working
files, including uncommitted changes. No commit was created. The existing
PS2 `git/mlworks` checkout has local changes and was left intact. The tested
runtime is bundled with the new deployment; its bootstrap notes identify the
main machine's runtime source and review patch.

## Use on the PS2

```sh
cd /home/ellie/git/pak
. ./env.sh
pakman list
kilo /path/to/file
```

Kilo is already installed. Its pinned package version is
`0.0.1-323d93b29bd8`. Ctrl-S saves, Ctrl-Q quits, and Ctrl-F searches.
To exercise removal and a fresh build:

```sh
pakman remove kilo
pakman install kilo 0.0.1-323d93b29bd8
```

The catalog wrapper `pak/bin/pakman` selects `pak/paks`, the `pak/.state`
build store and the isolated `pak/.local` installation prefix. Explicit
`--root` and `--state` flags override those defaults. The installed binary is
`pak/.local/bin/kilo`, with its BSD license in
`pak/.local/share/licenses/kilo/LICENSE`.

## Native artifacts and build boundary

The ignored manager deployment lives in
`wm-mini/tooling/pakman-subsetml/.build/ps2`. It contains the tested runtime,
compact compiler image, build adapters and generated package projects.
`SubsetML/bin/subsetml` launches its native image from
`SubsetML/build/mlworks-ps2`, rather than a workstation executable.

The manager and hello images reuse the preceding verified PS2 build. Kilo's
WM package program was newly compiled with MLWorks on the PS2. The native
SubsetML compiler also translated the external recipe and its dependencies;
all eight emitted SML modules matched desktop output byte-for-byte. MLWorks
project/header staging still uses the workstation Python stager; its CLI now
accepts external recipes and a separate catalog prefix (see `README.md`).

The existing coherent Basis, listener and batch compiler under
`/home/ellie/testingstuff/mlworks-r5900` remain bootstrap dependencies for
MLWorks compilation. The older testing deployment was retained separately.

## Kilo verification, 2026-10-17

The recipe fetched `kilo.c` and `LICENSE` from upstream commit
`323d93b29bd89a2cb446de90c4ed4fea1764176e`, checked both SHA-256 pins, invoked
the PS2's GCC with `-O0`, and installed a 32,208-byte executable and its license.
ELF inspection reports little-endian MIPS-III, o32, 5900, using the PS2's
soft-float musl loader. The installed executable SHA-256 is
`b28210f45812c2fbf35836623e4fa6686378672353ebc0a72a498f8b759c730f`.

The installed editor opened in a 24-by-80 SSH terminal. Typing text, saving
with Ctrl-S and quitting with Ctrl-Q succeeded; the resulting 41-byte file was
read back and checked exactly. The install used the existing 12 MiB data cap,
16 MiB sampled RSS cap and 4 MiB available-memory reserve, with a 180-second
timeout. After installation, 19,356 KiB was available and swap was zero;
this is not a peak-memory measurement.

A separate test catalog supplied an incorrect source hash to the same compiled
package program. Pakman rejected checksum verification with exit 1, installed
no file or ownership record, and released the test root's lock. The installed
editor and normal source pins were unaffected. An earlier connection timeout
was recorded separately and was not counted as a checksum-refusal result.

Logs, source/output hashes, ELF metadata and the saved editor fixture live in
`psx-pi-smbshare/research/probes/pakman-kilo` on the main machine. The recipe
and its source pins are in the main machine's `pak/paks/kilo` too.
