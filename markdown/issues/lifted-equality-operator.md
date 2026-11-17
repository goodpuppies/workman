# A separate operator for lifted equality

Status: open, low priority. Recorded 2026-11-17.

## Background

Primitive carrier coercion lifts operators over a carrier: `Ok(2) + 3` is `Ok(5)`. Until
2026-11-17 this included `==` and `!=`, so `Ok(1) == Ok(1)` was `Ok(true)` and `Ok(2) == 2`
was `Ok(true)`.

Lifting is meant for operations SML would reject, as an alternative to custom infixes. Comparing
two carriers already has a meaning in SML, plain structural equality, and SubsetML translates
SML `=` to WM `==`, so lifted equality silently changed the meaning of translated code. Since
then `==` and `!=` are never lifted (`inferBinary` in `src/infer/expr_flow.ts`, and the Binary
lowering in `src/core/from_surface.ts`): `Ok(1) == Ok(1)` is `true` and `Ok(2) == 2` is a type
error. See `docs/carriers.md`, primitive carrier coercion.

## Proposal

If the lifted comparison turns out to be wanted, give it its own operator, such as `===` and
`!==`, so `Ok(x) === 2` is `Result<Bool, E>`. It is far less useful than lifted arithmetic: a
comparison is usually a condition, and a condition needs a `Bool`, not a carrier. Until there is
a use case, `Result.map(x, (v) => { v == 2 })` says the same thing.
