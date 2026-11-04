# C FFI reflection: function-pointer sentinels and transparent unions

Status: open; existing unsafe escape hatches verified 2026-10-31.

## Problem

The server challenge exposed two C header reflection gaps:

- SQLite's `sqlite3_bind_text` takes a destructor function pointer. Its
  `SQLITE_TRANSIENT` macro is a cast of -1 to that type, requesting a copy;
  it is not an executable callback.
- glibc's GNU `accept4` declaration uses a transparent union for the socket
  address. The current reflection path cannot express this parameter usefully.

These are gaps in automatic imports, not evidence that WM needs new escape
hatches. A reflected `c.header` annotation intentionally cannot change the
reflected ABI. An authored `c.lib` signature can supply the ABI explicitly.

## Verified existing workaround

`examples/server/challenge/app/database.wm` imports `sqlite3_bind_text` through
`c.lib("sqlite3")` with a raw pointer destructor parameter. An unsafe JS import
of `Deno.UnsafePointer.create` constructs address `18446744073709551615` from
an exact Word64 literal. `Ptr<I32>` is only the declared carrier type here; it
is never dereferenced or called. This constant is specific to this Linux
x86-64 experiment and must not be presented as portable pointer-width handling.

`main.wm` imports `accept4` through `c.lib("c")` with explicitly declared nullable
pointer parameters and passes `None` for the unused address outputs. This relies
on the target pointer ABI; it does not establish support for arbitrary unions.

No compiler or host API additions were required. The former `native.c` and
`native.h` adapters were removed, and the build no longer invokes a C compiler.

## Reproduction and evidence

Run `python3 examples/server/challenge/tests/check.py` on the configured Linux x86-64
host with Deno, SQLite and OpenSSL installed and the sibling challenge checkout
available. The runner uses fresh database copies and starts both transports.

- `ffi_check.wm` constructs the sentinel through the JS FFI and round-trips its
  exact address with `Deno.UnsafePointer.value`.
- It binds a native buffer containing A, changes it to B, frees it, then steps
  SQLite and checks that the copied character is still A (65).
- Both the epoll and Deno HTTP transports passed all 42 upstream checks.
- Additional checks cover fragmentation, pipelining, slow readers, embedded-NUL
  text and committed-row visibility after shutdown. The epoll checks exercise
  successful direct `accept4` calls, not merely its invalid-descriptor path.

## Future reflection work

Preserve typed C function pointers and cast macro constants such as
`SQLITE_TRANSIENT`; keep sentinel construction distinct from callback creation
and indirect calls. Preserve transparent-union metadata and validate ABI lowering
for the target rather than treating every union as a pointer. Keep authored
unsafe imports available as the existing fallback. This issue does not request
new raw-pointer APIs or broaden reflected annotation overrides.

See `markdown/c-ffi-zig-audit.md` for Zig, MLWorks and MLton source comparisons.
