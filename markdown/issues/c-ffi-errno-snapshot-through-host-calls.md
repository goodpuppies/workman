# Reading errno through another host operation can lose the original error

Status: investigation with an existing-FFI mitigation, 2026-10-31.

A 220k-user ramp stopped with `accept4 failed: errno 2` between the client's
20- and 30-second reports. The supervisor stopped the cluster as intended.
There was no OOM; cgroup peak was about 577 MiB. No capacity result is claimed
for that run. Artifacts are `sweep-native220k-byte-length-five-minute-mixed-220000-0.log`
and `failure-native220k-byte-length-five-minute.json` under scratch.

ENOENT is unexpected for this TCP listener, but no kernel syscall trace was
captured, so the actual kernel return error and the origin of the observed 2
are not established. The failure was first seen after the byte-count change;
that association does not establish that Buffer.byteLength caused it.

The old path cached `__errno_location()` correctly per thread, but then used
`i32(Pointer.getI32(errnoPointer, 0))`. That allocates an argument tuple and
pointer view, then enters a Deno host operation before loading the value.
[Deno's getter](https://github.com/denoland/deno/blob/v2.9.8/ext/ffi/00_ffi.js)
delegates to a Rust op, whose [implementation](https://github.com/denoland/deno/blob/v2.9.8/ext/ffi/repr.rs)
checks permissions before the memory read. This is not an atomic capture of
the previous C call's errno. The general C rule is that intervening library
calls can alter errno, including successful ones; see [errno(3)](https://man7.org/linux/man-pages/man3/errno.3.html).

## Existing escape hatch

utils/common.wm now maps the four-byte thread-local slot to a DataView once, then
binds getInt32 with its offset/endianness arguments before processing requests.
An explicitly trusted unary function value exposes the bound getter as
`Void -> I32`. The error path now invokes that getter directly, without a new
argument array, pointer view, Number conversion or Deno host memory-read op.
Workers instantiate their own getter against their own TLS address.

The permanent FFI probe verifies 100,000 failing close(-1) calls with allocation
pressure before each failure, including a manual run with a 1 MiB V8 semispace.
It reads errno immediately after the syscall and checks EBADF. A separate raw
JS experiment ran three million empty nonblocking accept4 calls using new,
cached and DataView readers without reproducing a mismatch; that probe does
not prove the old path was reliable under the larger workload.

Long runs must validate the mitigation. This report does not claim that the
specific failure's root cause is proven, or that Deno's FFI return machinery
provides an atomic errno guarantee. If the problem recurs, capture the failing
syscall's kernel return alongside the application diagnostic before adding a
runtime feature. A native wrapper returning both result and errno would be a
stronger boundary, but no application C shim has been reintroduced.
