# WM uses the SubsetML Basis

**Status:** decided 2026-10-23. Supersedes [`basis-design.md`](./basis-design.md) and the plan in
[`basis-update/`](./basis-update/), except where noted below.

## Decision

Workman has no Basis of its own. Its library is the SubsetML Basis (`../SubsetML/docs/basis.md`):
the `Subset*` modules, written in SubsetML and translated to WM by SubsetML's translator.

- **Why:** WM will compile to SubsetML, so sharing one Basis is the simplest way to make WM programs
  portable. WM does not need to implement the SML Basis Library. SubsetML's Basis is already a
  custom library inspired by it, with `Result` for fallible operations, typed errors, data-first
  arguments and `I32` (SML `int`).
- **The language still follows the Definition.** WM stays close to
  `research/The-Definition-of-Standard-ML-Revised`. Only the *library* is custom: the Definition's
  Appendices C and D, the initial basis, are still the model for what the compiler owns.

## `Result`

WM's `Result` *is* SubsetML's `SubsetResult` datatype
(`datatype ('a, 'e) result = Ok of 'a | Err of 'e`), not a separate type that is mapped or
converted. WM code, FFI-wrapped results, WON and every other Basis module use one type with one
`Ok`/`Err`.

This replaces BD12, which kept `Result` in the compiler because FFI elaboration produces it. The
Definition's derived forms produce only `bool`, `list` and `unit`. The FFI is a host layer, so it
can refer to a library type by its declaration instead of the compiler owning that type.

## Superseded

- `basis-design.md`'s layers 1 and 2 (an SML-spec-faithful layer 1 with `int` as `Number`, and a
  shared `Basis.Error`): BD2, BD4, BD9, BD11, BD14, BD16 and E1–E6 of `basis-update/plan.md`.
- The hand-written `basis/*.wm` modules are to be replaced by Basis modules, or by primitives
  under them where the SubsetML Basis needs a host representation.
- `General.Order` is replaced by `SubsetOrder`'s `order`.

These still hold: library modules load through the ordinary module graph and are discovered
rather than listed (stages A and B); host helpers are explicit `js.host` imports (BD17); and
primitives are manually typed imports (BD7, BD8).

## The type manifest

`src/basis_manifest.ts` should shrink toward the Definition's initial basis. Its Appendix C
gives the initial static basis T0 = `bool`, `int`, `real`, `string`, `char`, `word`, `list`,
`ref`, `exn`, with `unit` as an abbreviation for `{}`.

| Manifest type | Definition | Direction |
|---|---|---|
| `Bool`, `I32` (int), `Number` (real), `String`, `Char`, `List`, `Void` (unit) | T0 | Keep |
| `ref`, `exn` | T0 | Omitted by design (no mutation, no exceptions) |
| `word` | T0 | Open: absent today; `Word32.Word` or a library type |
| `Option` | Not in T0 (SML Basis) | SubsetML uses SML's `option`, translated to `Option`; decide whether it stays compiler-owned |
| `Result` | Not in T0 | `SubsetResult` declaration (above) |
| `Task` | Not in T0 | WM library or host type; no SubsetML counterpart yet |
| `Word8`–`Word64`, `Word8Vector`, slices, `Float32`/`Float64`, `Vector` | Not in T0 | Host-represented primitive types, declared through manual `import type` (BD8, C1) rather than the manifest |
| `Js.*`, `Gpu.*` | Not in T0 | Host and target layers; already in separate manifests |

Values: `print` and `Text.of` are compiler-implemented. The `I32.*` operations should come from the
Basis's integer module over primitives once SubsetML renames `Int` to `I32` (see
[`i32-plan.md`](./i32-plan.md)).

## Open questions

- **Result's identity.** How the compiler and FFI refer to the `SubsetResult` declaration: by
  module path, or through a marker on the declaration. Either way that module must always be in the
  program, with `Ok`, `Err` and `Result` pervasive.
- **`std/` overlap.** `std/result.wm`, `list.wm` and `option.wm` overlap Basis modules
  (`mapErr`/`mapError`, `fn`/`via`, `withDefault`). Decide what becomes Basis source and what stays
  as WM-only code (carriers, `Task`, `Map`).
- **Namespaces.** Library namespaces come from file names, so `subset_list.wm` is `SubsetList`.
  Decide whether WM drops the prefix.
- **`I32` in WM APIs.** Basis lengths and indexes are `I32`, while existing WM code uses `Number`.
- **IO.** `SubsetIo` is synchronous; WM's current IO is `Task`-shaped.
- **Cold start.** Std is inferred on every process start; measure with the full Basis loaded.
