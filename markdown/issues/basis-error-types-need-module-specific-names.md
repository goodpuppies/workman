# Give Basis error types module-specific names

Status: open. Requested 2026-11-18.

Basis modules currently export generic type names such as `List.Error`, `String.Error`,
and `Int64.Error`. Diagnostics often display the unqualified name `Error`, hiding which
operation's failure type is being threaded through a Result pipeline.

Rename these types in a future Basis API migration so the owner is visible even without
namespace qualification: for example, `List.ListError`, `String.StringError`, and
`Int64.Int64Error`. Apply the convention consistently across shared SubsetML modules and
WM extensions. Review operation-specific error types as part of the migration.

A motivating mismatch from Day 2 is:

```text
Result<List<Pair>, ParseError>
Result<List<Pair>, Error>
```

`List.tabulate` and `List.splitAt` introduce the second error type. A module-specific
name would make the mismatch readable as `ParseError` versus `ListError` without
requiring the reader to inspect library definitions.

Keep this separate from origin rendering: diagnostics should also point to the user call
that introduced the constraint, rather than only to the outer `via`/`mapWith` stage or a
generic carrier annotation.

Implementation should update authoritative SubsetML `.sml` declarations, regenerate WM
and packaged Basis artifacts, migrate annotations/imports, update the Basis naming
conventions and user docs, and verify SML/WM translation plus native adapters. Error
constructors and module-wrapper constructors need an explicit collision review (for
example, an error type named `StringError` can coexist with constructors of that spelling).
Do not change failure behavior or error payloads merely as part of the rename.

Acceptance: both qualified APIs and unqualified diagnostic type displays identify the owning
module, existing Result pipelines preserve typed failure behavior, and origin locations still
identify the operation that introduced the error type.
