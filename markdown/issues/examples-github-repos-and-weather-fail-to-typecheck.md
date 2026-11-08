# The github_repos and weather examples no longer typecheck

Status: open. Found 2026-11-08 in the pre-0.6.1 example pass.

Both used to rely on safe JS imports with written types, which the compiler now rejects. After
moving those imports to `unsafe` or reflection, each stops at an FFI inference error:

- `examples/github_repos.wm:73`: `repos :> .map(...)`: "Js.Value is not a record type". `repos`
  comes from `Json.assert` on `response.json()`.
- `examples/weather.wm:214`: "cannot use unresolved JS FFI result as a String; unresolved JS FFI
  access is not a generic value", on `label`.

Neither could be compared against 0.6.0, where both already stopped at the imports. Decide for each
whether the example needs annotations or whether inference should accept it.
