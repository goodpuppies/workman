# Issue: A top-level `Monad.viaError` binding does not generalize

Status: open

Discovered while writing a `writev(2)`-backed buffered stdout writer in Workman
(`examples/enterprise/writev.wm`).

## Summary

Binding a partially applied carrier adapter at the top level:

```workman
let viaJs = Monad.viaError Result JsFail;
```

produces a monomorphic binding. The first use site fixes its type variables and every later use
with a different value type fails. Wrapping the same expression in a lambda restores
generalization:

```workman
let viaJs = (f) => { Monad.viaError Result JsFail f };
```

This is recognisable as the value restriction, but the failure mode is unusually opaque here
because the reported error is about FFI reflection rather than about generalization, and it names
neither of the two conflicting use sites.

## Environment

Observed in the current wm-mini checkout on 2026-08-26 with:

```text
deno run -A src/main.ts run <file>
deno run -A src/main.ts err <file>
```

## Minimal reproduction

```workman
from js.global import { TextEncoder };

type AppError = | JsFail<Js.Error>;

let viaJs = Monad.viaError Result JsFail;

let main = () => {
  let encode = viaJs (enc) => { enc.encode("hi") };
  let count = viaJs (bytes) => { bytes.length };

  match(TextEncoder.new() :> Result.mapErr(JsFail) :> encode :> count) {
    Ok(_) => { print("ok") },
    Err(_) => { print("err") },
  }
};
```

## Observed result

```text
Error: TYPE CHECKER[type.mismatch]
```

with, under `err`:

```text
error: unresolved JS FFI obligation in viaJs:
  (?ffi#70:... -> Result<Option<'a>, Js.Error>) -> Result<?ffi#70:..., IoError> -> Result<Option<'a>, IoError>;
  this JS member access must be resolved by FFI reflection before it can escape a top-level binding;
  5 more binding(s) also have unresolved JS FFI obligations
```

In the original writer this surfaced even further from the cause: as a pipe mismatch inside `print`
claiming a transformation expected `Option<T>` where a `Uint8Array` was supplied — `Option<T>`
having been fixed by an entirely different procedure (`drain`) several definitions earlier.

## Expected result

Either the binding generalizes, or the diagnostic explains that it did not:

```text
`viaJs` is not generalized because it is a partial application rather than a function value.
Its type was fixed to ... at <first use>, and <second use> requires ...
Write `let viaJs = (f) => { Monad.viaError Result JsFail f };` to generalize it.
```

The current message describes a symptom (an FFI obligation escaping a top-level binding) rather
than the cause (the binding is not a syntactic value, so it was never generalized).

## Working workaround

Eta-expand:

```workman
let viaJs = (f) => { Monad.viaError Result JsFail f };
```

`examples/asteroids/main.wm` already uses this shape:

```workman
let viaError = (inject) => { Monad.viaError Result inject };
```

## Documentation follow-up

`docs/carriers.md` introduces `Monad.viaError` with

```workman
let readBody = Monad.viaError Task JavaScriptFailure (response) => { ... };
```

which is fully applied and therefore fine, but nothing warns that hoisting the
`Monad.viaError Task JavaScriptFailure` prefix into its own binding — the obvious refactor once
three procedures repeat it — silently breaks. A one-line note next to the `viaError` section, and
the eta-expanded form as the recommended shape, would cover it.

## Likely compiler boundaries

- Generalization / value-restriction handling for `let` bindings whose right-hand side is a
  curried application.
- The `unresolved JS FFI obligation in <binding>` diagnostic: it detects the escape correctly but
  attributes it to reflection rather than to the missing generalization.

## Candidate regression tests

1. The reproduction compiles, or fails with a diagnostic naming the generalization problem and
   both conflicting use sites.
2. The eta-expanded form keeps working.
3. `let f = Monad.via Result;` used at two different value types behaves the same way as
   `viaError`.
4. An ordinary non-FFI partial application at two types reports a plain type error, not an FFI
   diagnostic.

## Severity and impact

The refactor that triggers it is one any user will reach for, and the resulting error can appear in
a procedure that has nothing to do with either use site. Cheap to work around once known,
expensive to diagnose the first time.

## Non-goals

- Adding relaxed value restriction or unsound generalization of effectful bindings.
