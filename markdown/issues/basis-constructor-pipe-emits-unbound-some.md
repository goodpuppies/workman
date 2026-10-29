# Basis constructor used as a pipe stage emits an unbound name

Observed while simplifying the Windows C HTTP server example.

```wm
let wrap = value => value :> Some;
```

The emitted function calls `Some(value)` rather than `__wm_basis_Some(value)`.
Using it fails at runtime with `ReferenceError: Some is not defined`.

The example uses `Some(value)` explicitly as a workaround. The original string
helper was `str => str :> Pointer.fromString :> Some`; its working equivalent is
`str => Some(str :> Pointer.fromString)`.

Follow up in constructor resolution/emission for pipe stages, including other
Basis constructors. No compiler fix was made as part of the example edit.
