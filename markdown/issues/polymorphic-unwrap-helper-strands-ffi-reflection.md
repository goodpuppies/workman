# Issue: A polymorphic unwrap helper strands FFI reflection and misreports the failure

Status: open

Discovered while writing a `writev(2)`-backed buffered stdout writer in Workman
(`examples/enterprise/writev.wm`).

## Summary

`docs/jsffi.md` suggests a small helper for scripts under "Common Patterns":

```workman
let try = (result) => {
  match(result) {
    Ok(value) => { value },
    Err(_) => { Panic("JS FFI call failed") },
  }
};
```

Passing an unresolved FFI value through it — it has type `Result<'a, 'b> -> 'a` — loses the
evidence FFI reflection needs. The compiler then reports the loss at an unrelated outer `match`:

```text
error: cannot match unresolved JS FFI result before FFI reflection resolves the member access:
?ffi#11: @ 23:8
```

with `23:8` pointing at a `match` on a `Deno.dlopen` result that is perfectly well-formed. The
`type-debug` output lists the real casualties separately:

```text
unresolved ffi values:
  20:13 "dlopen(\"libc.so.6\", JSON{ writev: ...": ?ffi#11:dlopen
  22:8  "try": ?ffi#11:dlopen
  25:12 "enc.encode(\"hello from workman writev\\n\")": ?ffi#13:encode
```

Two things are wrong: the helper strands reflection at all, and the diagnostic accuses the wrong
expression.

## Environment

Observed in the current wm-mini checkout on 2026-08-26 with:

```text
deno run -A src/main.ts run <file>
deno run -A src/main.ts err <file>
```

## Minimal reproduction

```workman
from js.global("Deno") import { dlopen: _deep_ };
from js.global import { TextEncoder };

let try = (result) => {
  match(result) {
    Ok(value) => { value },
    Err(_) => { Panic("JS FFI call failed") },
  }
};

let main = () => {
  match(dlopen("libc.so.6", JSON{
    write: JSON{ parameters: JSON["i32", "buffer", "usize"], result: "i32" }
  })) {
    Err(_) => { print("dlopen failed") },
    Ok(lib) => {
      let enc = TextEncoder.new() :> try;
      let bytes = enc.encode("hi") :> try;
      match(lib.symbols.write(1, Some(bytes), 2)) {
        Ok(_) => { print("ok") },
        Err(_) => { print("err") },
      }
    },
  }
};
```

## Control

The identical program with the `try` calls replaced by nested `match`es compiles and runs. So does
the same program with the encoder work removed entirely — matching directly on a `_deep_` `dlopen`
result is fine on its own. The helper is the trigger.

## Expected result

Either:

1. an FFI obligation survives instantiation through a polymorphic function, so the documented
   `try` helper works; or
2. it cannot, and the diagnostic says so at the call that lost it — naming `try` and the member
   access that is now unresolvable — rather than blaming an unrelated `match`.

Option 2 alone would be a large improvement even if option 1 is out of scope. As it stands, the
error points at correct code, and the documented helper is a trap.

## Documentation follow-up

If the helper cannot be made to work, `docs/jsffi.md` should stop suggesting it for values that
carry FFI obligations, and say what to use instead: the carrier idiom from `docs/carriers.md`, or a
monomorphic wrapper such as

```workman
let jsResult = (value) => { value :> Result.mapErr(JsError) };
```

which threads FFI values without stranding them — that is what
`examples/enterprise/writev.wm` uses throughout.

## Likely compiler boundaries

- `src/ffi/delayed/`: how a delayed FFI obligation is attached to a type variable and whether it
  survives generalization/instantiation of a user function.
- The `unresolved ffi values` reporting in the type-debug path, which already has the right
  information and better locations than the surfaced error.
- Whether the "cannot match unresolved JS FFI result" check can name the stranding site instead of
  the match it happens to reach first.

## Candidate regression tests

1. The reproduction above compiles, or fails with a diagnostic naming `try`.
2. `type-debug`'s `unresolved ffi values` locations and the surfaced error location agree.
3. A monomorphic wrapper (`jsResult`) keeps working.
4. Matching directly on a `_deep_` `dlopen` result keeps working.
5. A genuine unresolvable member still errors at the member access.

## Severity and impact

The wrong-location diagnostic is the expensive part: it sends you rewriting working control flow.
The helper it implicates is one the FFI documentation actively recommends.

## Non-goals

- Removing `Panic`-based unwrapping from the language or docs.
- Making every polymorphic function FFI-obligation-aware if a narrower fix exists.
