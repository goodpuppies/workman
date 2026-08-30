# wmslang v1 scalar operations

Status: closed expression vocabulary for the vertical slice in [`v1-scope.md`](./v1-scope.md).
Expanded integer/vector rules are deferred.

## Types

The operation table uses only:

```text
F  shader f32 represented by Workman Number
B  Workman Bool
```

Every reachable Workman `Number` becomes `F` directly. Numeric literal spelling does not select a
second representation in v1.

## Operators

The compiler records a closed `GpuOperatorId` for supported Workman operator syntax. The IR never
dispatches on an arbitrary source string.

| Source               | Arguments | Result |
| -------------------- | --------- | ------ |
| unary `-`            | `F`       | `F`    |
| `+`, `-`, `*`, `/`   | `(F, F)`  | `F`    |
| `<`, `<=`, `>`, `>=` | `(F, F)`  | `B`    |
| `==`, `!=`           | `(F, F)`  | `B`    |
| `==`, `!=`           | `(B, B)`  | `B`    |
| unary `!`            | `B`       | `B`    |
| `&&`, `\|\|`         | `(B, B)`  | `B`    |

Workman evaluates binary operands left-to-right. In particular, `&&` and `||` must not gain target
short-circuit behavior if that would change evaluation of an accepted expression. Source `if` is the
explicit conditional evaluation form.

Tuple/vector arithmetic, scalar broadcast, structural equality, `%`, string concatenation, and
bitwise operations are unsupported.

## Validation

Validation maps semantic operator identity to exactly one row above, checks argument shape, and
emits a typed IR node. Slang overload resolution is not used to determine Workman source meaning.

Focused tests cover every accepted row, unsupported tuple/vector operands, `%`, structural equality,
and operator arity. Compiler-supplied math intrinsics plus the broader dual-representation/vector
proof matrix in [`v1-numerics.md`](./v1-numerics.md) are post-v1 work.
