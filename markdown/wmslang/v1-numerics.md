# wmslang deferred numeric representation solving

Status: deferred dual-representation design. The vertical slice in
[`v1-scope.md`](./v1-scope.md) maps every reachable Workman `Number` directly to shader `f32` and
does not implement representation variables, `i32`, conversions, defaulting, vector
classification, or numeric specialization. This document is a candidate subsequent numeric slice.

Terminology note: unqualified “v1” statements below describe the former expanded numeric contract.

## Literal rule

V1 uses spelling as concrete representation evidence:

- an `Int` AST node always seeds `i32`;
- a `Float` AST node always seeds `f32`;
- current Workman float syntax has a decimal point and does not support exponent-only spelling;
- current expression parsing represents `-1` and `-1.0` as unary negation applied to a positive
  `Int` or `Float`; the child literal supplies representation evidence and negation follows the
  operator table;
- an `i32` literal expression must fit the signed range: positive `Int` values stop at `2147483647`,
  with the one direct `-2147483648` unary-literal form admitted for the minimum value;
- integer patterns are parsed directly as signed `PInt` values and use the same signed range.

Context never silently changes literal representation. Therefore `1 + 1.0`, `sin(1)`, and `(1, 2.0)`
are representation errors. Authors write `1.0`, `sin(1.0)`, or an explicit conversion such as
`Gpu.f32(1)`.

This rule is intentionally stricter than common shader overload systems. It makes the required
mixed-literal diagnostic local and removes contextual literal promotion from v1.

## Representation variables

Every numeric occurrence in a reachable specialization has a representation variable whose state is
exactly one of:

```text
Unknown
I32(source evidence)
F32(source evidence)
Conflict(i32 evidence, f32 evidence)
```

This is not an ordered lattice: `F32` does not dominate `I32`. Combining equal evidence preserves
it; combining `Unknown` with concrete evidence adopts it; combining `I32` with `F32` records a
conflict with both provenance paths. No pass rewrites the conflict into `f32`.

Representation variables belong to normalized occurrences and specialization overlays, not to the
globally interned host `Number` shape. Unrelated bindings or roots cannot exchange evidence merely
because ordinary HM inference gave both the same type.

## Equality constraints and fixed evidence

The schema-v2 normalizer and Workman solver create representation equality only where source
semantics require one concrete representation:

- a binder, its initializer/result, and every resolved value occurrence within one specialization;
- all components and the result vector of a homogeneous numeric tuple of width two through four;
- compatible arithmetic operands/results and scalar-broadcast components according to
  [`v1-operations.md`](./v1-operations.md);
- numeric comparison operands, but not their `Bool` result;
- the selected result of a block and all result-producing `if` or exhaustive `match` branches;
- record/product fields and ADT payloads at their representation-specialized layout positions;
- caller arguments/results and fresh callee parameter/result variables for one specialized call.

Fixed evidence enters from:

| Source                          | Evidence                                        |
| ------------------------------- | ----------------------------------------------- |
| `Int` literal                   | `i32`                                           |
| `Float` literal                 | `f32`                                           |
| fragment coordinate             | `f32x2` components                              |
| `Gpu.color` arguments           | four `f32` components                           |
| uniform fields/read projections | declared `f32` components                       |
| visual intrinsics               | the exact `f32` rows in the operations contract |
| float division                  | `f32` operands/result                           |
| `Gpu.i32(value)` result         | `i32`, without equating operand representation  |
| `Gpu.f32(value)` result         | `f32`, without equating operand representation  |

Conversions accept only an already solved `i32` or `f32` operand. They create a typed `Convert` node
and a fresh fixed result; they never merge the input and output variables. Converting a value to its
existing representation remains an explicit identity node for provenance.

## Defaulting

After all reachable call and value-flow constraints reach a fixed point, every remaining `Unknown`
numeric variable defaults to `i32`. Defaulting happens once, after specialization constraints, and
is recorded as evidence so later passes never repeat it.

This default applies to genuinely unconstrained parameters or results, not literals: literals were
already concrete. A helper such as `let twice = (x) => { x + x };` may receive an `i32` or `f32`
specialization from its callers. If used as a GPU root with no ABI or call evidence, its numeric
variables default to `i32`; a real `Gpu.fragment` root receives the fixed coordinate/color evidence
instead.

There is no v1 `u32` representation. The generated vertex wrapper may use target `uint` for
`SV_VertexID`, but that compiler-owned ABI value never enters Workman numeric solving.

## Vector versus product classification

A Workman tuple expression or parameter shape becomes a shader vector exactly when it contains two,
three, or four direct numeric components and their representation variables solve to the same
concrete representation. The vector representation is then persistent typed IR evidence.

A width mismatch, nested tuple, mixed numeric representation, or non-numeric component is not
silently reshaped. In particular, a direct all-numeric tuple of width two through four is always a
vector candidate; mixed representations conflict instead of falling back to a product. Tuples with
genuinely different non-numeric/member types and nested tuples may become private product layouts
when every field is in the v1 value subset. Homogeneous numeric tuples of supported width have no
separate “force product” syntax in v1. Widths above four are private products, never vectors or
public ABI values.

## First-order specialization

Ordinary HM generalization remains unchanged. Shader specialization instantiates a fresh numeric
overlay for each reachable call shape:

1. register the source function and provisional specialization before descending, preserving direct
   recursion;
2. seed fresh parameter variables from the caller's concrete argument representations;
3. seed the fresh result from concrete use-site evidence when present;
4. solve the function body and recursively materialize resolved callees;
5. feed callee parameter/result facts back to the caller until stable;
6. reject any conflict, then default remaining unknowns;
7. key/deduplicate the specialization by source `BindingId` plus the complete concrete parameter,
   result, record, and ADT representation overlay.

The same literal evidence is cloned into every specialization. Thus `x + x` can specialize to both
representations, while `x + 0` is specifically an `i32` helper and conflicts in an `f32` call. Use
`x + 0.0` for an `f32` helper; v1 has no representation-polymorphic numeric literal.

Direct recursive calls reuse the active specialization when their complete signature agrees.
Different recursive signatures are rejected as unsupported recursive specialization rather than
creating an infinite family. Mutual recursion remains the separate v1 diagnostic defined by the
functional lowering contract.

The shared debug type table reports a concrete representation only when every specialization agrees.
If one helper has both `i32` and `f32` instances, its shared normalized `Number` row remains
`abstract`; each specialization and typed IR occurrence is still concrete.

## Deterministic solving and provenance

The implementation may use union-find or a deterministic work list, but observable behavior is
fixed:

- constraints and call edges are visited by stable source/expression/specialization ID;
- convergence is based on representation-state changes, not a hard iteration count;
- every equality edge retains its originating expression/span and semantic reason;
- conflict reporting chooses the earliest stable `i32` evidence and earliest stable `f32` evidence
  reachable in that equivalence class;
- generated names and snapshot order do not depend on map insertion order.

A conflict diagnostic is produced before typed functional IR is declared valid. The compiler does
not emit a `Convert` node unless the Workman source explicitly selected `Gpu.i32` or `Gpu.f32`.

## Diagnostics

| Code                                  | Primary span                                   | Meaning                                                         |
| ------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| `gpu.number.conflict`                 | operation/value-flow edge joining the evidence | one required representation class contains both `i32` and `f32` |
| `gpu.number.i32-range`                | integral literal                               | literal is outside signed 32-bit range                          |
| `gpu.number.recursive-specialization` | recursive call                                 | recursive call requires a different concrete overlay            |
| `gpu.vector.shape`                    | tuple or operation                             | value cannot satisfy one supported homogeneous vector shape     |

`gpu.number.conflict` notes both concrete evidence spans and the equality path relevant to the
primary operation. It suggests an explicit conversion only at a value boundary where the resulting
operator/intrinsic row would be legal. It never describes the error as overload ambiguity or a Slang
failure.

## Current H0 migration rule

Schema v1's bootstrap solver currently joins mixed evidence by letting `f32` win. That behavior was
useful for proving fixed-point propagation but is not v1 language semantics. The atomic schema-v2
transition must replace it with the four-state conflict merge above and update focused snapshots in
the same change. A compatibility adapter must not preserve the old merge.

## Focused proof fixtures

- `1 + 1.0` produces `gpu.number.conflict`; `Gpu.f32(1) + 1.0` succeeds.
- `x + x` gets separate `i32` and `f32` helper specializations from concrete callers.
- `x + 0` cannot instantiate as `f32`; `x + 0.0` cannot instantiate as `i32`.
- evidence in one GPU root cannot widen or conflict with an unrelated root.
- fragment coordinates, color construction, uniform reads, intrinsics, and float division seed `f32`
  without source-name recovery.
- an unconstrained numeric helper defaults to `i32` only after the call-graph fixed point.
- homogeneous numeric tuples become vectors at widths two, three, and four; mixed representations
  conflict and width five remains a private product.
- two valid specializations leave the shared type row abstract while every typed IR row is concrete.
- explicit conversion nodes survive both IR snapshots, including representation-preserving identity
  conversions.

GLML demonstrates why a separate shader representation solver and specialization overlay are useful,
but its integer-promotion pass is intentionally absent. Workman remains authoritative for HM shape
and binding identity; wmslang adds only this closed target representation layer.
