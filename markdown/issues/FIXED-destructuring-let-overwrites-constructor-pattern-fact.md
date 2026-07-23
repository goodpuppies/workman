# FIXED: Destructuring Let Overwrites Its Constructor Pattern Fact

Status: fixed

Discovered while replacing a long list pattern in `wmthree` with `List.at`.

## Summary

A destructuring `let` could type-check successfully and then fail during Core
analysis:

```workman
let [profileTask, settingsTask] = [
  fetchProfile(),
  fetchSettings(),
];
```

The runtime compiler reported:

```text
missing constructor ID for PCtor
```

List syntax lowers to `Cons` and `Nil` constructor patterns. Pattern inference
initially recorded those constructor facts correctly. Afterward,
`inferNonRecursiveLet` recorded each bound variable against the root binding
pattern. For a composite pattern, that overwrote the root `Cons` fact with the
fact for the final local variable.

This was easy to miss because HM inference had already completed successfully.
The missing constructor identity was only required later, when pattern facts
were resolved for Core lowering.

## Resolution

`inferNonRecursiveLet` now replaces the root pattern fact only for a simple
`PVar` binding. Composite tuple, record, and constructor patterns retain the
facts recorded recursively by `inferBindingPattern`.

A dedicated pattern-facts regression test checks that a destructuring list
`let` retains `Cons`, `Cons`, and `Nil` at its pattern roots. The existing
runtime tests for named list-pattern functions and fixed task composition also
exercise the failure path through Core lowering.
