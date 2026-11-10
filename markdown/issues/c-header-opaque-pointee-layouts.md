# C header reflection traverses unsupported pointee layouts

Status: open. Reproduced on Linux with the 0.6.4 preparation checkout and Zig 0.16.0.

Importing `fflush` from `stdio.h` can fail with `BitFieldsNotSupported`: the extractor recursively
reflects `FILE` and implementation-private records reachable through pointer fields. These layouts
are unnecessary when the program only passes an opaque pointer (including `None`) to `fflush`.

The extractor deliberately rejects bitfield layouts, and its direct bitfield rejection regression
must remain intact. Supporting pointers to opaque records should be handled separately from exposing
their fields or passing those records by value. Explicit requests for unsupported layouts must
continue to fail rather than emit unsafe codecs.

The C wildcard precedence test now uses `stdlib.h`'s scalar `abs` function so it tests name
resolution without depending on a particular libc's internal stream layout. This change does not add
support for bitfields or fix opaque-pointee traversal.
