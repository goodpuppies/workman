# Structural records, correct tuples, and native WON construction

Status: implementation plan, revised 2026-11-09. Not yet implemented.

## Priority and scope

First-class WON syntax in WM is already a useful deliverable. Function values in
WON can wait. The React experiment in `../reactinwm` demonstrates that keeping
functions in WM costs only small text/action dispatch functions. The minimal
in-repository example is `examples/fullstack/react/`; it uses the existing portable
parser until native syntax exists. Neither callback storage nor removing Action/Bind
is a prerequisite for useful WON support.

Separate two workstreams: native data construction and structural product cleanup.
They can share compiler machinery without making the complete tuple/runtime/FFI
migration a gate for the first native syntax milestone. Do not introduce a second
runtime evaluator or a React-specific compiler feature.

Related constraints: [core design](./core-design.md),
[core principles](./core-principles.md), [FFI principles](./ffi-principles.md), and
[WON design](../tooling/won/markdown/won-design.md).

## First milestone: native WON data syntax

Parse WON directly in WM source, with ordinary WM expression holes for supported
data values. Illustrative future syntax, not currently supported:

```wm
WON[
  main[
    p["Count: " ${count}]
    button<onClick = Action("increment")>("Add one")
  ]
]
```

The renderer can continue resolving Action names through an ordinary WM function.
No closure-valued property, unsafe callable extraction API, callback signature
witness, UI builder, or generic codec derivation is required for this milestone.
Bindings may likewise remain renderer conventions where convenient.

Specify the supported data-hole types and their conversion rules before coding.
Reject unsupported holes explicitly, including functions; never stringify arbitrary
WM values and reparse them. `${1 + true}` remains an ordinary WM type error.
Expressions evaluate once, left to right, in authored order with normal lexical
scope and source diagnostics. A direct effectful expression runs at construction.
Defer spreads and implicit flattening.

Settle the initial result type and representation as a small explicit contract.
Reusing the existing portable WON Value representation is a valid first step if
it delivers native syntax without forcing the larger structural refactor. In that
case, document its actual list semantics and conversion boundary. Do not claim
that its brackets already construct numbered structural records. If the shared
product representation is ready first, the dynamic outer Won type described below
is the destination. Keep any later migration explicit in APIs and tests.

Acceptance for this milestone:

- Literal tags, properties, nested contents, and supported expression holes compile
  directly from source, without runtime source parsing or a string evaluator.
- Scope, diagnostics, single evaluation, and evaluation order work inside holes.
- A non-UI consumer and the minimal React example consume the result. Existing
  Action/Bind dispatch is acceptable; callback values are not an acceptance gate.
- Portable decoding/encoding and existing pakman formats remain compatible.
- Formatter/LSP/parser generation and relevant compiler regressions pass.

## Structural product destination

Make tuples what they are in SML: structural records with numbered labels. Share
record machinery with native WON where practical, while keeping the syntax
milestone independently useful. Lists remain a separate Cons/Nil datatype.

```text
Label = Named(identifier) | Positional(positive integer)
RecordType = exact finite mapping Label -> WM type
(a, b, c) == structural record { 1 = a, 2 = b, 3 = c }
```

These declarations and record spelling are schematic. Complete record types unify
only with the same labels and compatible field types; source order does not affect
identity. Keep deferred projection requirements separate from complete shapes.
No width subtyping or row polymorphism is implied. Numeric and named labels must
not collide; sort numeric positions numerically and reject duplicate labels.

Tuple equivalence must hold in inference, patterns, equality, modules, and lowering,
not only emitted JS shape. Tuple printing applies to contiguous labels 1..n for
n >= 2. `(x)` remains grouping. Decide singleton, unit/empty record, and Void/foreign
undefined compatibility explicitly. Preserve existing nominal record identities;
do not resolve structural records opportunistically against matching declarations.

Functions still take one WM argument; multiple arguments form a numbered record.
Direct multiargument JS entries are an optimization over that semantics. Ordinary
typed record fields may contain functions independently of WON's initial data-only
scope. Function-containing products do not admit equality.

### Dynamic Won over shared products

The eventual native construction uses named properties, positional fields, and
nested structural storage internally, exposing one static `Won` type rather than
per-literal rows. Different shapes can inhabit `List<Won>` and cross modules.
The outer fixed sequence uses numbered fields, not Cons/Nil. Document this change
from portable Value explicitly if the syntax milestone initially uses Value.

Store tags in collision-free internal metadata with String values. Properties
named tag, children, or properties must not overwrite metadata. Tag names do not
create nominal types. Decide empty/atomic/record payload normalization explicitly.
Canonical layout must follow source-order evaluation, never reorder effects.

Dynamic Won does not prove a field's shape or signature. Choose explicit inspection
and access operations for supported data. Any typed extraction that trusts a caller
must be visibly unsafe; annotations and ordinary projections must not invent types.
Do not require a general unsafe function-field API for the first syntax milestone.

### Deferred: function values in WON

Later, expression holes may store ordinary WM closures with lexical captures.
Closure bodies do not run during construction. Shared record machinery should retain
the original function, not a callback variant or deferred source expression.

Before enabling this, specify the consumer's explicit unsafe typed extraction
boundary and test invocation across module/list/function boundaries. A false unsafe
signature is not promised static or runtime rejection. No reified field types or
runtime signature witnesses are required. React-specific prop checking stays out
of the compiler. Migrate Action/Bind only when useful, not as a design gate.

Closures are not portable WON data. Encoding needs explicit supported-content rules;
never silently print or drop functions. Conservatively exclude generic equality for
dynamic Won if it can contain functions. Checked data comparison can come later.

## Compiler audit and structural migration

Current tuples have separate inference and array layout; nominal records use object
layout, and existing structural inference merges required fields rather than exact
closed shapes. Reusing that unification unchanged would accept incompatible complete
field sets. Audit these paths together for the structural workstream:

| Area | Required work |
| --- | --- |
| Surface AST, grammar, parser, formatter, LSP | Shared labels, numeric fields, tuple sugar, authored spans, WON holes and scopes. |
| Types, records/pattern inference, snapshots | Closed shapes versus requirements; unit/generalization/cycles; preserve nominal identity. |
| Binding, closure, taint, semantic and module facts | Per-field effects and captures; stable structural identity across exports. |
| Core lowering and JS emission | Common construction, layout, equality, matching, printing, argument packing and direct/higher-order calls. |
| FFI reflection/delayed calls, C/GPU targets | Explicit host array/object conversions and legal target layouts; preserve receiver safety and Promise/Task behavior. |
| Bootstrap/frontend tooling | Regenerate from maintained sources, including snapshots; do not hand-edit generated files. |

Start with a canonical object layout and distinct encoded named/positional/metadata
keys. Array specialization can come later only if it preserves type identity,
equality, projection, and calls. Do not use Array.isArray to classify ordinary WM
tuple arguments. Foreign arrays, Js.Array, C memory layouts, and lists have explicit
boundary contracts.

Structural checkpoints:

1. Specify labels, exact/required shapes, source syntax, unit, nominal compatibility,
   and current call/FFI behavior with characterization tests.
2. Unify tuple inference, annotations, patterns, and function domains with numbered
   records, preserving nominal wrappers and projection requirements.
3. Unify core/runtime semantics and module snapshots; migrate calls and printing.
4. Repair foreign and target boundaries, including zero/one/many arguments,
   higher-order callbacks, optional/nullish fields, and safe/unsafe Task conversion.
5. Adopt the shared dynamic Won representation when ready, with explicit data access
   and documented differences from portable Value. Function values remain deferred.

Verify label-order independence, positions above 9, duplicate/missing fields,
unit/grouping/singletons, field-level error paths, nominal separation, list separation,
evaluation order, taint, and imported tuple identity. Run relevant inference, compiler,
module, LSP, runtime, FFI, Basis, bootstrap, target, and React example checks.

The immediate deliverable is useful native WON syntax. Shared structural products
remain the language destination; closure-bearing WON and its unsafe callable access
are later work, justified separately by actual consumer needs.
