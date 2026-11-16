# Native WM output still uses bootstrap pervasives

Status: open, 2026-11-16. Found while checking frontend-v3's native projector.

`scripts/check_frontend_v3_projector_native.py` builds and executes the native parser/View
fixtures with MLton and compares the results against WM. This checks behavior with the native
SML Basis environment; it does not establish the restricted library profile.

Running `subsetml check-portable` on the generated fixture entry fails in `reader.sml` with
`unbound identifier not`. The reader's WM `!` is emitted as SML's bootstrap `not`. Further
generated code, including the fixture's `print`, may need similar treatment before the entire
translated graph can pass the restricted profile. Do not add these convenience bindings to
the portable initial environment to hide missing lowerings.
