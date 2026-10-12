# Issue: Equality Does Not Check the Arguments of Option, List and Result

Status: open

Discovered next to the imported-generic equality issue on 2026-10-07.

## Summary

`==` accepts `Option`, `List` and `Result` values whose element type does not admit equality. A
function inside an `Option` or a list compares without any error, although a function, a record
holding a function, or a tuple holding a function is correctly rejected on its own.

In Standard ML, `'a option`, `'a list` and the like admit equality only when their arguments do
(`statcor.tex`: a type `τ^(k) t` admits equality when `t` and all members of `τ^(k)` do). So
`SOME f = SOME f` for a function `f` is a type error in SML.

## Minimal reproduction

```workman
let main = () => {
  let f = (x) => { x + 1 };
  print(Some(f) == Some(f))
};
```

```text
wm check repro.wm
```

## Actual behavior

| expression | result |
|---|---|
| `f == f` | rejected: `type "Number -> Number" does not admit equality` |
| `(f, 1) == (f, 1)` | rejected |
| a record holding a function, compared directly | rejected |
| `Some(f) == Some(f)` | **accepted** |
| `[f] == [f]` | **accepted** |
| `Some(g) == Some(g)` where `g` is a record holding a function | **accepted** |

At runtime this compares the functions by identity, which is not structural equality.

## Expected behavior

`Some(f) == Some(f)` and `[f] == [f]` are rejected with the same diagnostic as `f == f`. `Option`,
`List` and `Result` admit equality exactly when their type arguments do.

## Suspected implementation boundary

`src/basis_manifest.ts` marks `Option`, `Result` and `List` as `equality: "structural"`
("datatypes whose constructors decide equality"). `requireEquality` in `src/infer/equality.ts`
handles basis `always`, `never` and `arguments` explicitly but not `structural`, so these fall
through to the datatype path. If that path finds the basis datatype without parameter ids, the
substitution from its parameter `T` to the actual argument is empty and the constructor argument
types are never checked against the real arguments.

## Focused regression coverage

- `Some(f) == Some(f)`, `[f] == [f]` and `Ok(f) == Ok(f)` are rejected.
- `Some(1) == Some(1)`, `[Red] == [Red]` and `Ok("a") == Err(1)` still check.
- Nested cases: `Some([f])` rejected, `Some([1])` accepted.
