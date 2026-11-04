# Library pervasives shadow GPU builtins in `@gpu` code

Status: open, found 2026-11-04. Failing since before `4e9b523`.

`src/library_pervasives.ts` installs unqualified library names, including `floor`, `ceil`, `round`,
`trunc` (`std/real.wm`) and `length` (`subml-basis/subset_list.wm`). Inside a `@gpu` lambda those
names should mean the Slang builtins, but they resolve to the library values first.

## Reproduction

```wm
let shade = (coord) => {
  @gpu;
  let floored = (x) => { floor(x) };
  (coord.x, coord.y, 0.0, 1.0)
};
```

`floored` should be `'a -> 'a`. It is `Number -> Result<Number!, Error>!`, which is `Real.floor`.

The other failures have the same shape:

- `Slang builtin smoothstep has no exact overload for (f32, f32, prim)`
- `Result is not a record type`
- `left: (Number, Number) ... right: Result<Number, Error>` in the jelly shader
- `type.call-argument-mismatch` where `gpu.builtin.overload` was expected

## Known-issue tests

12 tests are ignored, in `tests/wmslang_v3_builtin_test.ts`, `tests/wmslang_v4_specialize_test.ts`,
`tests/wmslang_window_example_test.ts` and `tests/wmslang_webgpu_render_test.ts`.

## Cause, verified

With `floor`, `ceil`, `round`, `trunc` and `length` removed from the pervasive table in a scratch copy
of `490cfe1`, all 51 tests in those four files pass. Removing them isn't the fix, since programs use
those pervasives.

## Likely fix

Inside `@gpu` regions, resolve a name to the GPU catalog before the library pervasives. A binding the
program declares itself should still win over both.
