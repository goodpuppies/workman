# wmslang deferred reachability and captures

Status: deferred expanded closure design. The vertical slice in
[`v1-scope.md`](./v1-scope.md) permits direct same-module helper calls and no captured values. Static
literal captures, imported helpers, per-artifact transitive closure, and explicit uniforms begin
after v1.

Terminology note: unqualified “v1” statements below belong to this deferred closure design, not the
current static vertical slice.

## Per-artifact closure

`Gpu.fragment(shade)` selects one resolved `@gpu` root. Shader analysis closes, for that artifact
only, over:

1. the root function;
2. direct calls to resolved first-order Workman helpers;
3. free value bindings used by every reachable function;
4. finite type/record/constructor declarations required by those functions;
5. zero or one explicit `Gpu.Uniform<T>` descriptor identity.

All identities come from shared semantic facts. Source spelling, imported aliases, module-open
order, and generated names cannot create or merge dependencies.

Each free value occurrence is classified into exactly one v1 category:

```text
StaticLiteral
UniformDescriptor
ReachableFunction
IllegalCapture
```

Constructors, record declarations, compiler operations, and visual intrinsics are semantic
declaration/operation facts rather than captured runtime values.

## Reachable first-order functions

A Workman function is reachable only when a call node's resolved callee `BindingId` selects it. V1
does not infer a call edge from a matching name or function type.

A reachable helper may be declared in the same or an imported Workman module and may itself call
other resolved helpers. It is accepted only when:

- every use is direct callee position;
- its parameters, result, locals, and transitive captures are in the v1 subset;
- each reachable numeric call shape has a finite concrete specialization;
- recursion satisfies the direct-self-tail rules;
- it contains no surviving host FFI, `Panic`, resource operation, or unsupported expression.

Storing a function in a tuple/record/ADT, returning it, selecting it with `if`/`match`, passing it
as an argument, or capturing a lambda value is `gpu.function.first-order`. Ordinary lexical
shadowing still applies because call targets are resolved before capability analysis.

Unreachable ordinary Workman functions are not diagnosed for shader capability and remain CPU-only.
One artifact's reachability does not make a helper globally GPU-only or leak its specialization into
an unrelated root, although equal concrete specializations may be deterministically deduplicated in
the final compilation unit.

## Static literal captures

V1 supports a deliberately closed static initializer grammar:

```text
StaticScalar = Bool | Int | Float | -Int | -Float
StaticVector = (StaticNumeric, StaticNumeric)
             | (StaticNumeric, StaticNumeric, StaticNumeric)
             | (StaticNumeric, StaticNumeric, StaticNumeric, StaticNumeric)
StaticValue  = StaticScalar | StaticVector | immutable alias of StaticValue
```

`StaticNumeric` is `Int`, `Float`, `-Int`, or `-Float`. Vector components must satisfy the strict
homogeneous representation rules in [`v1-numerics.md`](./v1-numerics.md). Alias traversal follows
resolved binding IDs, rejects cycles, and ends at one of the literal forms above.

The binding may be module-level or an enclosing immutable lexical `let`; because the initializer is
closed, its value cannot vary between runtime invocations. The compiler clones the literal tree into
each using specialization, preserving source spans and numeric spelling. It does not execute
Workman, JavaScript, arithmetic, or user functions to discover a value.

Arithmetic, comparisons, intrinsic calls, `if`, `match`, blocks with declarations, records, ADTs,
general tuples/products, and function calls are not static capture initializers in v1 even when a
human could evaluate them. Authors move such computation inside the GPU helper or capture its
literal inputs separately. This keeps “compile-time” from becoming an evaluator or optimization
promise.

Captured records and ADT values are likewise excluded. Records and finite ADTs remain fully usable
when constructed and consumed inside the reachable shader graph; only host-to-shader capture of an
already constructed value waits for a later serialization/specialization contract.

## Explicit uniform descriptor

A captured value is `UniformDescriptor` only when semantic provenance leads to an accepted
`Gpu.uniform` binding and its immutable aliases, as defined in [`v1-uniform.md`](./v1-uniform.md).
Merely having a scalar, vector, record, or even the same HM type does not create uniform evidence.

The reachable graph may use `Gpu.read` on that descriptor and may pass the resulting ordinary record
through first-order helpers. It may not pass the descriptor itself as general shader data, store it
in an ADT, compare it, or return it. Two different `UniformId` values in the per-artifact closure
fail the one-block rule.

## Illegal captures

All other free runtime values are illegal in visual v1, including:

- host function parameters and locally computed values, even when their HM type is `Number` or a
  numeric tuple;
- an ordinary host record that was also used to create a uniform descriptor;
- scalar/vector bindings with arithmetic or call initializers;
- strings, lists, arrays, tasks/results used as runtime carriers, JS values, and foreign objects;
- raw WebGPU resources and handles;
- function values outside direct resolved callee position;
- descriptors not produced by the compiler-known `Gpu.uniform` operation.

The compiler never reclassifies an illegal scalar/vector capture as a generated uniform. The
diagnostic points to the free occurrence, notes its defining binding, and suggests either moving a
closed computation into shader code or introducing the explicit nominal uniform record when the
value is truly dynamic.

## Deterministic closure algorithm

The implementation uses stable IDs and source order:

1. seed the work list with the selected root specialization;
2. visit each function body in expression-ID order, recording direct resolved call edges;
3. add free binding occurrences after excluding parameters and all lexical pattern binders;
4. recursively classify static aliases and reachable callees with separate cycle guards;
5. union transitive captures by semantic ID for this artifact;
6. sort functions, captures, and declaration dependencies by their stable IDs;
7. emit diagnostics for illegal categories before Slang generation.

Pattern binders from parameters, `let`, and match arms enter scope only where Workman's resolver
says they do. A textual name match cannot turn a local into a capture or hide an imported
dependency.

Reachability may remove unused functions and declarations because the target program must be closed;
it may not erase evaluation of a reachable expression item or use dead-code assumptions to legalize
an otherwise illegal capture.

## Diagnostics

| Code                       | Primary span                         | Meaning                                                                                  |
| -------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `gpu.capture.illegal`      | free value occurrence                | binding is neither a static literal, explicit uniform descriptor, nor reachable function |
| `gpu.capture.static-cycle` | alias closing the cycle              | static literal aliases are cyclic                                                        |
| `gpu.function.first-order` | non-callee function use              | function value escapes the v1 direct-call subset                                         |
| `gpu.function.capability`  | unsupported reachable expression     | helper is reachable but cannot execute in visual v1                                      |
| `gpu.uniform.multiple`     | occurrence introducing the second ID | artifact reaches two explicit uniform descriptors                                        |

Cross-module notes display the defining module and binding span. Diagnostics are per artifact: an
illegal use reachable from two roots produces one stable diagnostic per root unless the surrounding
compiler's standard diagnostic deduplication proves the complete primary/notes are identical.

## Current H0 migration rule

The schema-v1 prototype currently labels any reifiable non-constant scalar/vector capture as
`uniform`. That category proved capture closure but is not part of the static v1 slice. A later
capture/resource schema must:

- recognize `UniformDescriptor` only from compiler semantic provenance;
- reclassify ordinary dynamic scalar/vector captures as `IllegalCapture`;
- narrow static constants from general unary/binary trees to the literal grammar above;
- preserve the existing resolved-ID, lexical-local exclusion, and per-root transitive closure work.

No compatibility adapter should turn an old inferred `uniform` row into explicit resource evidence.

## Focused proof fixtures

- Same-named helpers in two modules resolve to the selected imported binding only.
- An unreachable host-FFI helper remains undiagnosed; calling it produces `gpu.function.capability`.
- A literal scalar/vector and a multi-hop immutable alias become `StaticLiteral` with original
  representation evidence.
- A closed arithmetic initializer is rejected as a capture but succeeds when the arithmetic moves
  inside the shader.
- A dynamic host `Number` and numeric tuple are not auto-packed.
- One descriptor captured through aliases deduplicates to one `UniformId`; a second descriptor
  fails.
- Parameters plus tuple, record, constructor, and match-arm binders are never reported as captures.
- A function used as data fails even if every possible call target would otherwise be GPU-capable.
- Two roots sharing one helper retain independent capture closures and numeric specialization
  evidence.

This boundary keeps the first visual release honest: Workman supplies immutable lexical structure,
the compiler closes a first-order shader program, and dynamic data crosses only through the one
explicit ABI the user can see.
