# Numeric overloading with one literal spelling

Status: literal slice implemented 2026-10-30; operator slice remains next.

## User decision

Use `../mlworks` as the implementation reference and the local Revised Definition as
semantic background. WM uses ordinary numeric literals for all numeric types: `1`,
not a separate `0w1` word spelling. Decimal and existing hexadecimal integer forms
remain available; this does not require fractional literals to inhabit integer types.

Goal: remove constructor/conversion noise around literals and same-type arithmetic,
especially in C FFI programs, while preserving exact numeric types and their semantics.

This supersedes the `0w`/`0wx` question in
[low-level-numerics-bytes.md](low-level-numerics-bytes.md#slice-e-source-syntax-and-overloading).
The implemented [I32 plan](i32-plan.md) is the starting point, not a replacement design.
Older claims that WM has no numeric overloading in `core-design.md` and
`basis-update/sml-alignment.md` predate I32 and should not guide this work.

## Baseline before this work

- `src/types.ts`: `numeric?: true`, `freshNumeric`, numeric unification, exclusion
  from generalization, and `defaultNumericVars`. The admissible types are currently
  just `Number` and `I32`.
- `src/infer/expr.ts`: integer literals inside I32 range receive that constraint;
  other integer literals and all float literals become `Number`.
- `src/infer.ts`: calls `defaultNumericVars` after each module declaration.
- `src/types_basis.ts`: fixed operator signatures; `/` and `%` remain Number-only.
- `src/core/from_surface.ts` and `src/core/emit_prelude.ts`: checked I32 lowering.
- `std/word*.wm`: existing word arithmetic implementations to reuse.
- `std/int64.wm`: conversions currently exist; do not assume a complete signed
  64-bit arithmetic library already exists.
- `tests/i32_test.ts` and `tests/word_basis_test.ts`: compatibility coverage.

## Reference map

Local Definition: `research/The-Definition-of-Standard-ML-Revised/overloading.tex`.
Appendix E specifies overloaded constants and operators, defaults, resolution context,
and range validation after resolution. It explicitly leaves formal implementation
machinery outside the document. Its separate basic literal classes differ from WM's
single integer-literal class.

MLWorks paths below are relative to `../mlworks`:

| Path | What to examine |
| --- | --- |
| `src/typechecker/_datatypes.sml` | `META_OVERLOADED` carries the unresolved type, class, identifier and location; operator schemes distinguish unary, binary and predicate forms. |
| `src/typechecker/_unify.sml` | `do_overload` narrows compatible classes and rejects incompatible classes or concrete types. |
| `src/typechecker/_types.sml` | `resolve_overloading` resolves remaining classes to defaults, including compatibility-mode behavior. |
| `src/typechecker/_valenv.sml` | Initial operator classes and `resolve_overloads` over the declaration environment. |
| `src/typechecker/_mod_rules.sml` | Where declaration-level overload resolution is invoked. |
| `test_suite/static_core/overloaded*.sml` | Literal/operator interaction and historical defaulting modes; distinguish old-definition expectations from the revised behavior. |

Follow the separation between constrained inference, defaulting, and elaboration.
Do not copy MLWorks's separate integer/word literal classes or its historical modes.

## Proposed WM contract

1. An ordinary integer literal can inhabit `Number`, `I32`, `Word8.Word`,
   `Word16.Word`, `Word32.Word`, `Word64.Word`, or `Int64.Int` when context selects
   the type and its value fits. Initially cover the types that WM actually has;
   future numeric types require explicit catalog entries.
2. An unconstrained integer literal continues to default to `Number`.
   Fractional/exponent literals retain their current Number behavior in the first slice.
3. Each operator has a finite supported-type set. Unification intersects that set
   with literal/operand constraints. Both operands and an arithmetic result use
   the same selected type; comparisons return `Bool`.
4. Overloaded variables are resolved at the chosen declaration boundary and do
   not escape as ordinary universally quantified numeric polymorphism. Preserve
   current I32 defaulting initially; audit nested and recursive declarations
   before changing how much surrounding context is available.
5. A literal denotes an exact value before a target representation is chosen.
   Validate it against the selected type. Proposed initial policy: reject negative
   unsigned literals and out-of-range literals, rather than silently wrapping them.
   Modular word arithmetic and explicit wrapping conversions keep their own semantics.
6. Existing typed values do not change type implicitly. `Number` variables do not
   become words because they reach a C call. A literal can be selected as a word
   directly; conversion between two already concrete types is a separate operation.
7. TypeScript `number` continues to reflect as `Number`. Concrete C ABI types may
   select the corresponding literal type. Do not guess an integer width from a
   JavaScript API or treat overload resolution as foreign-type conversion.
8. No user-defined overload registration in the first implementation.

Target examples (illustrative, not working syntax tests yet):

```wm
let byte: Word8.Word = 255;
let mask: Word64.Word = 0xffffffffffffffff;
let nextByte = (value: Word8.Word) => { value + 1 };
// A reflected uint16_t parameter selects Word16.Word for 8080:
let networkPort = htons(8080);
// Reflected size_t parameters select the platform's exact unsigned type:
let memory = calloc(1, 1024);
```

`Pointer.byteLength(text)` currently returns `Number`, so passing that existing
value to a `size_t` parameter still needs conversion. Eliminating those conversions
requires an additional API/type decision; literal overloading alone cannot do it.

## Implementation progress

- Literal slice: finite candidate constraints, canonical nominal identity matching,
  exact token retention when Number would lose precision, range diagnostics, exact
  host emission and patterns, and inference-session isolation are implemented.
- The AST keeps its existing numeric value for compatibility and additionally
  retains the original token for unsafe integers. Core carries that token and
  the selected numeric type; bigint-backed literals are emitted without rounding.
- Literal, pattern, alias, module, defaulting, recovery and C ABI tests exercise
  the implementation. Server allocation/startup literals now use context directly;
  server port parameters use `Word16.Word`. Runtime length conversions remain.
- Operator expansion, first-class/carrier operator gaps and missing Int64
  arithmetic remain separate work. Ordinary infix operators retain Number/I32.
- User documentation: [docs/numbers.md](../docs/numbers.md).
- Validation found one unrelated existing failure in
  `tests/wmslang_v4_specialize_test.ts` ("catalog skeletons contribute only universal HM
  equalities"): `floor` resolves to a Number/Result function instead of a shader
  skeleton. The identical failure was reproduced from an untouched HEAD archive.

## Implementation slices and acceptance

### 1. Exact literal representation and constrained candidates

Preserve integer token text/exact magnitude through AST, patterns, Surface projection,
Core and emission. Today `Int.value`/`PInt.value` are JS numbers, and the parser
converts tokens with `Number`/`parseInt`; values beyond 2^53 can already be rounded.
Do not recover a 64-bit constant from that rounded number. Keep the current default
Number behavior separate from exact interpretation for selected integer/word types.

Replace the boolean numeric marker with explicit candidate constraints and source
obligations. Intersect constraints during unification, preserve them when copying
inference state, and retain literal locations for range diagnostics. Key nominal
candidates by canonical type identity, not merely a displayed type name.

Acceptance: direct literals work in the existing exact-type annotations and reflected
C parameters; 64-bit boundaries remain exact; ordinary unannotated programs retain
Number behavior; rejected literals identify the chosen type and its allowed range.

### 2. Operators over existing implementations

Define a compiler-owned operator/type catalog, with selected implementations and
defaults. Reuse qualified Word operations and checked I32 helpers. Add missing Int64
operations separately before enabling their overload rows. Do not emit JS `+` for
all representations or silently inherit JS's 32-bit bitwise behavior.

Cover direct syntax, first-class operators, patterns, and carrier-lifted operations;
the I32 plan already records gaps in the last two operator paths. Keep `/` and `%`
semantics unchanged until their type sets and meanings are explicitly decided.

Acceptance: word arithmetic preserves its modular width; I32 remains checked;
signed/unsigned comparisons and bigint-backed operations follow their selected
implementation; mixed concrete types fail consistently.

### 3. Defaulting, integration and example cleanup

Exercise local, top-level, recursive and imported bindings, declaration order,
FFI staging, and recovery after failed inference. Ensure unresolved obligations
cannot leak from one inference session into another. Test defaulted helper bindings
as well as context supplied within a declaration.

Simplify `examples/server/windows_simple.wm`, `unix_simple.wm`, and `windows.wm`
only where inference actually makes the conversion redundant. Preserve runtime
conversions for existing Number-valued lengths, ports, and offsets as needed.

Check: `deno task check`; scoped numeric, operator, carrier and C FFI tests; parser
regeneration/reproducibility and semantic goldens if literal representation changes;
live server tests on each available host.
