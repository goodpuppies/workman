# Native WM output still uses bootstrap pervasives

Status: fixed 2026-11-17. Found 2026-11-16 while checking frontend-v3's native projector.

`scripts/check_frontend_v3_projector_native.py` builds and executes the native parser/View
fixtures with MLton and compares the results against WM. This checks behavior with the native
SML Basis environment; it does not establish the restricted library profile.

Running `subsetml check-portable` on the generated fixture entry fails in `reader.sml` with
`unbound identifier not`. The reader's WM `!` is emitted as SML's bootstrap `not`. Further
generated code, including the fixture's `print`, may need similar treatment before the entire
translated graph can pass the restricted profile. Do not add these convenience bindings to
the portable initial environment to hide missing lowerings.

## Resolution

The reader no longer emits SML Basis Library names. `!` is `SubsetBool.not`; `%` is
`SubsetInt32.rem` or `SubsetReal64.rem` by operand type; real `==`/`!=` are `SubsetReal64.equal`;
template text uses `SubsetInt32.toString`, `SubsetReal64.toString` and `SubsetString.fromChar`; and
`print(a, b)` is `SubsetIo.printLine` of a display the translator writes from the arguments' types,
matching Workman's output. The modules are imported automatically when their forms occur. Real
remainder and text are host primitives (`SubsetRealHost`, with SML and Workman adapters); real
equality is portable. Int64, the word types and Real32 remain MLton-only. SubsetML's
`tests/portable-output.sh` checks `check-portable` and compares MLton output with Workman's.
