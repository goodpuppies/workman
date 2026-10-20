# Native package candidates for the PS2

Assessment: 2026-10-18. This is a build-policy recommendation based on the
local recipes and current physical console, not a claim that every package
has passed a native build.

The existing distribution uses musl, BusyBox and APK packages. Its builder
(`psx-pi-smbshare/research/tools/pkgbuild.sh`) explicitly is not abuild or
APKBUILD-compatible. Recipes under `research/packages` currently cross-build
on the workstation; they cannot simply be executed unchanged on the PS2.
In particular they use workstation paths, cross compiler names and `nproc`.

## Candidate groups

| Packages | Recommended build location | Reason / evidence |
| --- | --- | --- |
| pfetch, ca-certificates | PS2 packaging | Shell script and data respectively; no C compilation. Pin/check inputs as usual. |
| hello, Kilo | PS2 | Small C programs; Kilo already built, installed and edited/saved a file natively through pakman. |
| GNU Make | PS2 next | Ordinary C and a relatively small build; a useful first configure/Make package. Native feasibility remains to be measured. |
| zlib, ncurses, Mbed TLS | PS2 candidates | Useful development libraries, generally split into multiple C units. Start with zlib, then ncurses; measure the largest units and native linking. zlib is an existing bootstrap dependency, not a standalone recipe in the current catalog. |
| Bash, zsh, curl, Dropbear, BusyBox, apk-tools | Possible native builds; retain cross-built base initially | More configuration, source files or dependency work. There is no demonstrated architectural requirement to cross-build them, but a successful build could still take hours. Use isolated prefixes rather than replacing the running base while experimenting. |
| MicroQuickJS | Conditional native experiment | The current engine source is about 572 kB in one C unit; small runtime memory does not establish low compiler memory. Native build also needs native standard-library/atom generators, with 32-bit output. |
| Git, Emacs | Cross by default; native as deliberate long builds | Large source sets and links. Emacs helpers and three core objects compiled before user-requested cancellation; full native install has not passed. |
| btop | Cross on the current system | Requires C++20; the installed GCC recipe enables C only. Even with a native C++ toolchain, template compilation needs a separate memory assessment. |
| GCC, gccrs / gccrs15, GDC, binutils, kernel | Cross for routine production | Compiler frontends, generated sources and large links are poor fits for 27 MiB with no swap. Several also require bootstrap compilers/tools absent on the target. This is a practical policy, not a proof that native bootstrapping is impossible with a different setup. |
| musl-dev | Package the matching toolchain sysroot | The recipe deliberately packages the exact libc headers, CRT and libraries used by the running system. Do not turn it into an independent libc rebuild just to make a native-build demonstration. |

## Suggested pakman progression

GNU Make first, then a development-library package such as zlib or ncurses.
This exercises real configure/build/install workflows and then dependency
development files without beginning with another large application. Preserve
the cross-built compiler, linker and system base as bootstrap inputs.

Use one build job, no LTO, explicit allocation limits and the available-memory
reserve monitor. Measure rather than infer limits from executable size. Both
the largest translation unit and the final link matter. `-O0` is useful for
initial feasibility but may produce a slower installed program than the
existing optimized cross build.

Native execution, native compilation and native package management are
independent: pakman can eventually manage a pinned cross-built artifact on
the console as well as compile source there. The prototype does not yet
provide a general signed-APK import/dependency-resolution implementation.

## Emacs cancellation

The full Emacs build was stopped at the user's request, with no installed
Emacs ownership record and no remaining compiler processes. The stale root
lock was removed. Work is retained at
`~/git/pak/.state/store/pakman-tmpnam_oPIGaf-0/work/emacs-20.7` on the PS2;
its build log is also saved in
`psx-pi-smbshare/research/probes/pakman-emacs/ps2-build-cancelled.log`.
Automatic build resumption is not implemented; a fresh install starts a new
store entry. See the Emacs recipe README before returning to that experiment.
