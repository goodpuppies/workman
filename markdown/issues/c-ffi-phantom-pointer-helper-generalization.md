# C FFI helper with a phantom cast result does not generalize

Observed during the raw malloc/free server rewrite on 2026-10-29.

A helper that unwraps `Option<Ptr<Opaque>>`, casts the pointer to `Ptr<t>`, and
passes it to an action was inferred with an unquantified pointee variable:

```text
withMemory [] (Option<Ptr<Opaque>>, Ptr<'a> -> 'b) -> 'b
```

Calls with WSAData, sockaddr_in and scalar pointer actions then constrained the
same variable and failed with a sockaddr_in/Number mismatch. The exported
Pointer.cast helper itself has two quantified variables, as expected.

The current server keeps `withMemory` operating on the actual malloc return
type, `Ptr<Opaque>`, and performs an explicit cast inside each action. This also
makes the C void-pointer boundary visible in application code. No type-checker
change was made as part of the FFI rewrite. Investigate whether the lack of
generalization is intended by the foreign-boundary policy or a separate bug
before changing it.
