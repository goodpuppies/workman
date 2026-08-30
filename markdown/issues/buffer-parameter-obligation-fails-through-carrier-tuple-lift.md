# Issue: `buffer` FFI parameter rejects a typed array arriving through `Result|...|`

Status: open

Discovered while writing a `writev(2)`-backed buffered stdout writer in Workman
(`examples/enterprise/writev.wm`).

## Summary

A Deno FFI parameter declared `"buffer"` reflects as `Option<Js.ArrayLike>`, and the concrete
array-like type is meant to be chosen from the call argument during FFI materialization. That
selection does not happen when the argument reaches the call as a function parameter bound by a
carrier tuple lift (`Result|...|`). The obligation and the argument then collide:

```text
type error: use can't be both:
  - Js.ArrayLike
  - Uint8Array
```

The same call succeeds when the typed array flows down a single-value pipeline instead.

## Environment

Observed in the current wm-mini checkout on 2026-08-26 with:

```text
deno run -A src/main.ts run <file>
```

## Minimal reproduction

```workman
from js.global("Deno") import { dlopen: _deep_ };
from js.global import { TextEncoder };

let main = () => {
  let use = Monad.via Result (lib, bytes) => {
    lib.symbols.write(1, Some(bytes), 2)
  };
  let encoded = Monad.via Result (enc) => { enc.encode("hi") };

  match(use(Result|
    dlopen("libc.so.6", JSON{
      write: JSON{ parameters: JSON["i32", "buffer", "usize"], result: "i32" }
    }),
    TextEncoder.new() :> encoded
  |)) {
    Ok(_) => { print("ok") },
    Err(_) => { print("err") },
  }
};
```

## Observed result

```text
Error: TYPE CHECKER[type.call-argument-mismatch]
  9|   match(use(Result|
             ^^^^^^^^^^^ type error: use can't be both:
  - Js.ArrayLike
  - Uint8Array
```

The error is reported at the tuple lift, not at the `Some(bytes)` argument that actually carries the
obligation.

## Contrast: the same call resolves down a pipeline

`examples/enterprise/writev.wm` performs the equivalent call with the buffer as a `via` parameter
and it resolves:

```workman
let submit = viaJs (iov) => { lib.symbols.writev(fd, Some(iov), count) };

BigUint64Array.new(count * 2) :> jsResult
  :> describe
  :> submit
```

So a `via` parameter is not itself the problem. The difference is that here the value arrives
through a single-carrier pipeline whose head is the concrete `BigUint64Array.new(...)` call, while
in the reproduction it arrives as one component of a `Result|...|` tuple.

## Expected result

Both forms should resolve the array-like obligation to `Uint8Array`. `docs/carriers.md` presents
`Carrier|...|` as the idiomatic way to group several carrier-producing procedures, so FFI arguments
regularly arrive this way in code written to the documented style — the two forms should not differ
in what they can express.

If some staging genuinely cannot see through a tuple lift, the diagnostic must at least point at
the offending argument and say that the array-like obligation could not be resolved from it.

## Working workaround

Keep the buffer on a single-carrier pipeline whose head is the concrete typed-array expression, and
bring the other values in some other way (a closure over an already-unwrapped binding, or a
separate `via` stage).

## Likely compiler boundaries

- FFI materialization of buffer-source parameters: `bufferSourceParamExpr` in
  `src/ffi/reflect/type_mapping.ts` and whatever consumes its `Js.ArrayLike` obligation.
- `src/ffi/delayed/`: the ordering between tuple-lift elaboration and delayed FFI resolution.
- The lowering of `Carrier|...|` into `andThen`/`map`, and whether obligations survive it.

## Candidate regression tests

1. A `"buffer"` parameter receives a `Uint8Array` bound by a two-element `Result|...|`.
2. The same with three or more elements, and with the buffer in first, middle and last position.
3. The same through `Task|...|`.
4. A non-array-like argument in that position still errors, and the error names the argument.
5. The existing single-pipeline form keeps working.

## Severity and impact

Forces FFI-heavy code away from the documented carrier-grouping style precisely where it is most
useful — coordinating a library handle, a buffer and a length. The diagnostic pointing at the tuple
lift rather than the argument makes the cause hard to find.

## Non-goals

- Weakening the array-like obligation to `Js.Value`.
- Changing the semantics of `Carrier|...|`.
