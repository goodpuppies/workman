# Ptr arity collision in an authored unsafe JS signature returning Js.Value

Status: open; application workaround available (2026-10-31).

While adding a persistent DataView over signalfd memory, this authored import
caused compilation to fail with `Ptr expects 0 type arguments` at a separate
`pointer: Ptr<I32>` parameter in the same module:

```wm
from js.global("Deno.UnsafePointerView") import unsafe {
  getArrayBuffer: (Ptr<I32>, Number) -> Js.Value
};
```

Changing its low-level representation promise to a polymorphic primitive:

```wm
from js.global("Deno.UnsafePointerView") import unsafe {
  getArrayBuffer: (pointer, Number) -> buffer
};
```

allowed the example to compile. The WM wrapper retains its concrete Ptr<I32>
parameter and uses the returned buffer only to construct a DataView. Investigate
nominal/arity pollution during delayed JS import processing; this report does
not establish that all Ptr/Js.Value combinations fail. No compiler fix was
made for the benchmark experiment. See examples/server/challenge/utils/io.wm.
