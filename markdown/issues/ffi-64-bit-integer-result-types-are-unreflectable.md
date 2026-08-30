# Issue: Deno FFI symbols returning 64-bit integers cannot be reflected

Status: open

Discovered while writing a `writev(2)`-backed buffered stdout writer in Workman
(`examples/enterprise/writev.wm`).

## Summary

A `Deno.dlopen` symbol declared with a 64-bit integer **result** type (`isize`, `usize`, `i64`,
`u64`) cannot have its `symbols.<name>` member resolved. Deno types those results as
`number | bigint`, and FFI reflection has no mapping for the TypeScript `bigint` primitive, so the
union collapses to "unmapped" and the member access is rejected.

The same widths work fine in **parameter** position. Only the return breaks.

The practical consequence is that no libc function returning `ssize_t`, `size_t`, `off_t` or any
other 64-bit integer — `read`, `write`, `writev`, `readv`, `lseek`, `sendfile`, `mmap` — can be
declared with its correct ABI result type today.

## Environment

Observed in the current wm-mini checkout on 2026-08-26 with:

```text
deno run -A src/main.ts run <file>
```

## Minimal reproduction

```workman
from js.global("Deno") import { dlopen: _deep_ };

let libc = dlopen("libc.so.6", JSON{
  write: JSON{ parameters: JSON["i32", "buffer", "usize"], result: "isize" }
});

let main = () => {
  let use = Monad.via Result (lib) => { lib.symbols.write(1, None, 0) };
  match(libc :> use) {
    Ok(_) => { print("ok") },
    Err(_) => { print("err") },
  }
};
```

## Observed result

```text
cannot resolve JS FFI method symbols.write for receiver type
__Deep_global_Deno_dlopen_value_deep__libc_so_6_____write______parameters______i32____buffer____usize___as_const____result____isize___as_const___as_const___Result
```

Changing only `result: "isize"` to `result: "i32"` makes the same program compile and run. Changing
it to `result: "u64"` reproduces the failure. Note that the `usize` **parameter** in the same
declaration is accepted in every variant, so the defect is specific to the result position.

## Expected result

`symbols.write` resolves, with a result type that can represent the full 64-bit range.

There is a design decision embedded here: Workman's `Number` is a JS double and cannot represent
every `i64`. Reasonable options, in rough order of preference:

1. map TS `bigint` to a distinct opaque Workman type (say `Js.BigInt`) with explicit conversions to
   `Number`/`String`, and collapse a `number | bigint` result to it;
2. map it to `Js.Value`, which is honest but gives the caller nothing to work with;
3. map it to `Number`, which is ergonomic and silently lossy above 2^53 — probably the wrong trade
   for an FFI boundary.

Whatever is chosen, the diagnostic should say *why* the member is unresolvable rather than printing
the mangled deep-reflection type name.

## Working workaround

Declare the result as `"pointer"` and decode the sign by hand. `Deno.PointerValue` reflects to
`Option<Js.Object>`, so the full 64 bits survive with no truncation:

```workman
let signedResult = Monad.via Result (returned) => {
  match(returned) {
    None => { Ok(0) },
    Some(pointer) => {
      let raw = numberOf(Ptr.value(pointer));
      if (raw >= twoPow63) { Err(Errno(twoPow64 - raw)) } else { Ok(raw) }
    },
  }
};
```

This is what `examples/enterprise/writev.wm` currently does. Declaring `result: "i32"` instead
"works" but truncates the ABI return to its low 32 bits and should not be recommended.

## Likely compiler boundaries

- `src/ffi/reflect/type_mapping.ts`: `typeExprFromTsType` handles `number`, `string`, `boolean`
  and enums, but has no `ts.TypeFlags.BigInt` / `BigIntLiteral` case.
- The union branch in the same function: `mapped.some((item) => !item)` returns `undefined` for
  `number | bigint`, which is what strands the member.
- `src/ffi/shared.ts` already names `BigInt64Array` / `BigUint64Array` in its typed-array list, so
  the bigint-adjacent surface is partially present.

## Candidate regression tests

1. A `dlopen` symbol with `result: "isize"` resolves and its return can be converted to `Number`.
2. Same for `usize`, `i64`, `u64`.
3. A 64-bit integer in parameter position keeps working.
4. A returned value above 2^53 does not silently lose precision (or is documented as doing so).
5. A negative `isize` return is distinguishable from a large positive one.

## Severity and impact

Blocks correct declaration of most syscall-shaped libc functions. The pointer-shaped workaround is
sound but obscure, and a newcomer is far more likely to reach for `i32` and quietly truncate.

## Non-goals

- Adding arbitrary-precision integer arithmetic to Workman.
- Changing `Number` to anything other than a JS double.
