# C FFI and host-helper audit against Zig 0.16.0

Date: 2026-10-31. This is a local source/translation audit, not a claim about every
Zig version. No further challenge performance tuning was done during this audit.

## Reference and probes

The installed Zig library is `/home/ellie/.zvm/0.16.0/lib/`.
`compiler/translate-c/main.zig` imports Aro directly. Relevant implementation:

- `compiler/translate-c/Translator.zig`: `transType`, pointer/function cases,
  `transFnType`, and record/union translation.
- `compiler/translate-c/helpers.zig`: tests for C-style casts, including negative
  integers converted to nullable function pointers.
- `compiler/translate-c/MacroTranslator.zig`: macro-expression translation.
- `std/c.zig`: platform-selected `_errno` accessor and libc declarations.

The input to `zig translate-c -lc` was:

```c
#define _GNU_SOURCE
#include <sqlite3.h>
#include <sys/socket.h>
#include <errno.h>
```

Reproduction inputs and generated output are in `_scratch/ffi-audit/`.
`zig build-obj -lc ... -fno-emit-bin` checked selected generated declarations.
These are compile-only ABI/type probes, not a runtime socket benchmark.

## SQLite function pointers and SQLITE_TRANSIENT

Zig preserves the destructor signature as
`?*const fn (?*anyopaque) callconv(.c) void`. `sqlite3_bind_text` uses that
nullable function-pointer parameter, rather than an opaque data pointer.

`SQLITE_TRANSIENT` is translated as a C-style helper cast of signed `-1` to
`sqlite3_destructor_type`. A compile-time probe confirmed the resulting pointer
bits are all ones. SQLite interprets the value as a sentinel, not a callback to call.

WM currently loses function types as `unknown` in extraction and rejects this
reflected parameter. The challenge initially used a small `wm_bind_text` adapter. The follow-up
below replaces it with existing unsafe imports, preserving explicit byte lengths
and embedded NUL text. Automatic reflection still needs typed C function pointers
and sentinel/cast support. Actually constructing WM-to-C callback trampolines is a separate feature,
with calling convention, ownership, lifetime, and error propagation requirements.
Do not silently turn an unknown function type into an ordinary data pointer.

## glibc transparent socket unions

Under `_GNU_SOURCE`, Zig translates `__SOCKADDR_ARG` to an `extern union` with
explicit pointer members. `accept4` retains that union as its parameter type.

An explicit `.{ .__sockaddr__ = null }` argument compiled. Passing plain `null`
did not: Zig requires the union value here too. This is not evidence for silently
coercing every transparent union to a pointer, nor for ignoring union ABI metadata.

WM's current extraction/signature path exposes an inaccessible anonymous union
for this case. The challenge initially used a small `wm_accept4` adapter while its
ordinary socket imports avoided `_GNU_SOURCE`; the follow-up below replaces the
adapter with an explicitly authored pointer signature. Follow-up work should preserve
attribute/type identity and validate the target ABI, including the distinction
between ordinary and transparent unions.

## errno: macro versus platform accessor

The translated macro was `pub const errno = __errno_location().*;`. Using that
constant failed with "comptime call of extern function" in this installed Zig.
The translation was not, by itself, a working runtime errno read.

Zig's standard library instead selects a platform accessor: `__errno_location`
on glibc Linux, other names on Android, Windows, Darwin and other targets.

The Linux-only challenge now follows that approach directly in WM:

```wm
from c.lib("c") import unsafe {
  __errno_location as errnoLocation: Void -> Option<Ptr<I32>>
};
```

This required a small fix: authored `Void -> T` C signatures now describe zero
native arguments, matching WM's unit domain and C's `f(void)`. A regression test
calls getpid and reads/writes the thread-local errno slot. No C errno shim remains.
The Aro extractor's exclusion of double-underscore names still prevents this
particular accessor from being imported through ordinary header reflection;
its ABI is explicitly authored here. Runtime macros and platform accessors
should not be presented as ordinary compile-time constants.

## Application JavaScript helpers

The earlier helper inventory overstated the need to leave WM:

- `text :> .trim` and `text :> .trim()` already worked, with normal Result handling.
- slice, indexOf, length, case conversion, replaceAll, repeat and endsWith work
  through ordinary receiver calls.
- JSON.stringify, Number.isSafeInteger and Number.isFinite can be imported.
- Number conversion is an explicitly declared callable JS import.
- RegExp construction/member calls express validation in WM.
- `basis/text.wm` supplies Unicode scalar counts.
- Base64 normalization, numeric validation and padding logic now live in WM.
- Missing table deletion was added to `host/js/table.wm`, backed by its ordinary
  Map primitive, and the challenge imports that module.

The only remaining application `host.js` function is a synchronous try/catch
boundary for arbitrary thrown host exceptions. Expected application errors should
continue to use WM Result values. The alternate Deno HTTP adapter and Python/Node
checks remain comparison/testing infrastructure, not required C server shims.

## Validation

- Both challenge transports: upstream 42/42 checks, fragmentation/pipelining,
  slow reader, embedded-NUL text and committed-row visibility after shutdown.
- Focused regressions: primitive receiver/import calls, table deletion, and
  nullary authored C signatures / direct errno access.
- Zig compile-only probes: typed SQLite destructor sentinel and explicit union
  argument accepted; plain-null union argument and runtime errno macro rejected.

## MLWorks and MLton comparison

Inspected sibling checkouts: MLWorks `dc780ba`, MLton `aa2fd1ad9`.
Neither reference checkout was edited. MLWorks findings are source-only;
the installed `/usr/bin/mlton` compiled and ran a separate local probe.

### MLton: explicit pointer signatures can avoid both adapters

`doc/guide/src/ForeignFunctionInterfaceTypes.adoc` documents scalar and
`MLton.Pointer.t` arguments. This basic FFI does not import C headers or offer
arbitrary by-value C aggregate arguments. `CallingFromSMLToCFunctionPointer.adoc`
documents `_import *`: an explicitly typed call through a function address.
This is distinct from creating an ML callback closure.

For SQLite, the destructor argument can be authored as `MLton.Pointer.t`.
The sentinel can be constructed as:

```sml
val transient = MLton.Pointer.sub (MLton.Pointer.null, 0w1)
```

`basis-library/mlton/pointer.sml` implements the offset conversion through the
target's `C_Ptrdiff`; the public pointer API does not require a `fromWord`
operation. This is raw address manipulation, not a callable destructor, and
relies on SQLite's sentinel convention and the target pointer representation.

`_scratch/ffi-audit/mlton-probe.sml` directly imports SQLite, binds a mutable
byte array with that sentinel, changes its first byte from A to B, and verifies
that SQLite's `unicode(?)` still returns 65. This checks the requested copy
semantics, rather than just successful pointer construction. No C adapter was
compiled for the probe.

The same probe explicitly declares `accept4` with pointer arguments, bypassing
the glibc header's transparent-union spelling. It compiles and runs, checking
that an invalid descriptor returns -1. This is a limited error-path call test,
not a socket acceptance/integration test or evidence for general union ABI
support. The signature is manually supplied; MLton did not discover or validate
the transparent-union attribute. Its own Basis implementation uses C wrappers:
`runtime/basis/Net/Socket/Socket.c`, `Socket_accept` and `Socket_bind`.

Reproduce from the WM repository root:

```sh
mlton -default-ann 'allowFFI true' -link-opt -lsqlite3 \
  -output _scratch/ffi-audit/mlton-probe _scratch/ffi-audit/mlton-probe.sml
_scratch/ffi-audit/mlton-probe
```

MLton also ships the higher-level MLNLFFI library. `lib/mlnlffi-lib/c.sig`
contains typed function pointers, struct/union object types, pointer casts and
`call`/`call'`. `doc/guide/src/MLNLFFIImplementation.adoc` explains its typed
function-pointer representation. Those APIs are not proof that its generator
accepts glibc transparent unions or SQLite's macro unchanged; that path was not
tested here.

### MLWorks: object support is broader than its generated call support

`src/foreign/c_object.sml` represents pointer, function, struct and union types;
its setters include `setPtrAddr` and `setUnion`. Addresses in this implementation
are explicitly 32-bit (`src/foreign/types.sml`). This is a historical ABI model,
not a portable pointer-width implementation to copy into WM.

`src/foreign/_stub_gen.sml:86` explicitly rejects pointers to functions:
`function pointers not yet supported`. Thus its stub generator does not
transparently solve SQLite's destructor parameter. A manually authored raw
address binding may sidestep that restriction, but no SQLite execution was
verified with MLWorks.

The older object-based caller, `src/foreign/__c_function.sml`, accepts ordinary
argument/result objects only when `sizeOf(ty) <= 4` (with special array/string
handling), packing arguments into fixed integer-size slots. The existence of
union objects therefore does not establish general native union calling
conventions or GNU transparent-union handling.

Its actual sockets implementation, `src/rts/src/sockets.c:904`, is a C adapter:
`ml_accept` calls `accept` using an explicit `struct sockaddr *`, then constructs
ML values and reports errors. This resembles our current adapter boundary.

### Implication for WM

MLton is a useful reference for an explicitly unsafe raw-pointer import path
and signature-typed indirect C calls. Keep that distinct from automatic C
header reflection, where function-pointer types, macro casts and the target
ABI still need to be preserved. MLWorks supplies useful foreign-object ideas,
but neither its generator restriction nor its 32-bit call machinery is a good
target for WM's new functionality. These findings do not remove either existing
challenge C adapter yet.

## Follow-up: existing WM escape hatches verified

Both initial challenge C adapters have now been removed using existing authored `c.lib`
signatures and an unsafe JS import of `Deno.UnsafePointer.create`. No new
compiler/host features were added for this follow-up. See
`markdown/issues/c-ffi-function-pointer-sentinels-and-transparent-unions.md`
for the remaining reflection work and reproducible runtime checks.
