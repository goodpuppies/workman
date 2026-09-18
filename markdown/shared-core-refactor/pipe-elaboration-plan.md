# Pipe elaboration plan

Status: completed for the shader-authoring milestone.

Goal: define Workman pipe and currying semantics once, before backend lowering,
and make piped Slang builtins work without adding a WMSLang-specific rule.

## Approach

Treat a pipe as a compiler-owned hygienic syntax elaboration. Keep the authored
`Pipe` node for tooling and diagnostics, but derive one shared application plan
from it for inference and Core construction.

The plan must distinguish:

- applying a value to a stage, such as `value :> helper`;
- inserting a value into a tupled call, such as `value :> helper(extra)`;
- applying a value to a function produced through currying, such as
  `task :> via Task callback`.

## Work

- [x] Extract pipe/application-spine classification into one frontend module.
- [x] Make ordinary calls and elaborated pipes share the same invocation typing path.
- [x] Resolve GPU builtin overloads from invocation role rather than immediate AST shape.
- [x] Build Core applications from the shared pipe plan and remove `desugarPipe`.
- [x] Preserve pipe-specific source ranges, constraint labels, and evaluation order.
- [x] Cover direct, tuple-inserting, curried, anonymous-match, builtin, and failure cases.

## Boundary

This slice does not introduce user-defined macros or a general macro system. It
does not migrate unrelated Surface consumers. A materialized rewritten AST can
come later if other syntax elaborations need it; the initial artifact is a
small semantic expansion plan over the authored nodes.

## Done when

No inference or backend component independently inspects pipe syntax to decide
application or currying behavior, and `uv :> normalize` follows the same GPU
builtin overload path as `normalize(uv)`.
