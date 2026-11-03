# Taint as a bit on the type

This replaces the symbolic summaries. No taint terms, summaries or formulas remain. `!` is a bit on
the type, and HM's own variables carry whatever is still unresolved. Nothing here is committed.

## Rules

- `unify(T, T!)` is `T!`. Concrete nodes are immutable, so `unify` returns the join and replaces what
  a bound variable or view holds. Bound variables can therefore be replaced again, only by a more
  tainted version of the same type.
- An outer `!` means producing the value crossed an effect. Only what ran before a value adds one; a
  value's own contents do not. `{ eff(); [1, eff()] }` is `List<Number!>!`, `{ [1, eff()] }` is
  `List<Number!>`, and this holds at call sites as well as in signatures.
- `if` and `match` count only their condition or scrutinee. Their results meet in one variable, as
  `if` is a derived form of `match`, so unification joins the branches.
- A `match` arm's bindings keep their own positions, so a generic `map` and the inlined `match` agree.
  `let` destructuring has no enclosing `match` and passes along a known `!`.
- A concrete function field marks the constructed value: `H(eff)` is `H!`. Generic fields record it in
  their type argument: `Some(eff)` is `Option<Void -> Number!>`.

## Representation (`src/taint.ts`)

A sequence reads its members when built. A known `!` or a clean result leaves no link. A member held
open by an HM variable leaves a link, stored as a flat list of those variables on a view, so nested
sequences never chain. Instantiation maps links like any variable and drops ones that resolved clean.

Variables and patterns add no links. Their binder already linked them, and a call covers its
arguments. A callback's concrete annotated result is an open position: a variable bound to the
concrete type. A parameter's function type is the only place a caller can later add `!`.

Binding compression stops at the last variable of a chain, so variables unified together share a
later replacement.

## Measurements

Median of three process medians, seven samples after three warm-ups, with process order reversed on
alternate rounds. Times in ms. "Closed skip" is the baseline plus the `ftvEnv` change below.

| Workload                     | Baseline | Closed skip | Symbolic |    Now | Now vs baseline |
| ---------------------------- | -------: | ----------: | -------: | ------ | --------------: |
| `scalar-250`                 |    17.29 |       11.59 |    24.69 |  13.36 |            -23% |
| `scalar-250-with-snapshots`  |    28.77 |       23.30 |    53.37 |  29.57 |             +3% |
| `scalar-250-check-source`    |   155.33 |      152.14 |   202.86 | 163.03 |             +5% |
| `polymorphic-250`            |    11.30 |       11.67 |    15.04 |  13.06 |            +16% |
| `higher-order-100`           |    17.21 |       15.36 |    27.61 |  18.28 |             +6% |
| `nested-data-150`            |    18.71 |       16.96 |    26.81 |  20.19 |             +8% |
| `latent-functions-150`       |    17.71 |       13.85 |    25.66 |  15.30 |            -14% |
| `stdlib-wave`                |   154.97 |      152.27 |   255.89 | 173.70 |            +12% |
| `stdlib-wave-with-snapshots` |   170.28 |      165.35 |   285.87 | 193.67 |            +14% |

"Now" includes the closed skip, which is not a taint change and would speed up the baseline as well.
Against the closed-skip column, the overhead is +14% on `stdlib-wave` and +15% on `scalar-250`.

`ftvEnv` re-walked every scheme in the environment at each `let`. A scheme with no free variables can
never gain one, so it is now skipped permanently.

## What moved the numbers

CPU profile self-times were misleading here: V8 inlining differed between builds, and unrelated
functions appeared to grow. Ablation, timing a copy with one piece disabled, was reliable. On
`stdlib-wave`, in the order applied:

| Change                                               | Effect                  |
| ---------------------------------------------------- | ----------------------- |
| Flat links instead of links through earlier views    | 1705 ms to about 236 ms |
| Open cells on callback results only, not all results | 236 ms to about 213 ms  |
| No links from patterns                               | 213 ms to about 199 ms  |
| Only preceding values add an outer `!`               | about 199 ms to 182 ms  |
| Taint fields present when a type is created          | about -11 ms            |
| Concrete types carry only `tainted`                  | about -7 ms             |

Reading absent properties at megamorphic sites was a real cost, which is why the fields are set on
creation. Removing closures and temporary arrays from `carries`, `open` and `taintExpression` made no
measurable difference. The same was true of the iterative `prune` and reordered `copyType` on the full
build, although those two functions were the measured cost when taint was inert.

The last ablation, before slimming the fields, measured 177 ms with everything on, 167 ms with all
taint operations off, and 154 ms for the closed-skip baseline. About half the remaining overhead is
therefore structural and not taint logic. `taintExpression` was about 7.5 ms and `joinTypeTaints`
about 2 ms. That breakdown predates the slimming and has not been re-measured.

## Verification

`deno task check` passes. The selected inference, compiler, FFI, diagnostics, module-interface,
semantic-facts and LSP suite passes all 260 tests. That includes new regressions for the outer and
inner distinction, concrete function joins, recursive callbacks and concrete function fields.

Expectations changed:

- The four FFI and type-debug expectations return to no inner `!` from extraction, for example
  `Result<Number, Js.Error>!`.
- The rebuilt-container test now asserts that the generic and inlined forms agree.
- The nested late-substitution test no longer expects an outer `!` from a tuple's own contents.
- Tests of mutable concrete nodes now use variables.

## Known limits

- `let` destructuring reads only an already-known `!`, so it can differ slightly between generic and
  inlined code. `{ let (a, b) = p; [a] }` can lose the inner `!` when generic. The outer `!` still
  holds at the call.
- Two bare concrete types with no variable holding them, with the `unify` result ignored, drop the
  join. No inference path found so far relies on this.
- Structural record rows do not rebuild on a join, only their held fields do.
- The target of near-zero overhead is not met: library inference is still +12%.

Run a timing worker with:

```sh
deno run -A scripts/profile_taint.ts --root=ROOT --samples=7 --warmup=3
```
