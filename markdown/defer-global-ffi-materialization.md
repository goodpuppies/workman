# Plan: Defer Global / Namespace / Constructor FFI Materialization

## Motivation

FFI calls currently materialize (pick a variant + rewrite to a generated binding) in **two
different regimes**:

- **Receiver calls** (`obj.method(...)`) are *deferred*. At elaboration they stay `FfiCall`
  AST nodes; inference assigns them an `ffi` placeholder (`freshFfi`) and infers their
  arguments **independently** (args are never unified against parameter types). The delayed,
  post-HM pass (`materializeReceiverCall`) then selects the variant with real inferred argument
  types — `selectVariant(..., argTypes)` — and runs `resolveArrayLikeParams`.

- **Global values, namespace members (`subtle.importKey`), and constructors (`Uint8Array.new`)**
  materialize *early*, at elaboration (`receiver/rewrite_expr.ts`), via
  `selectVariant(variants, expr.args)` with **no argument types** — only syntactic
  `callArgHint` (literal / lambda / unknown). The callee is rewritten to the generated internal
  name immediately and a typed import is emitted so inference can type it.

Early materialization rests on a lazy assumption: "the target is statically known, so argument
types are not needed." That assumption is now wrong. Two concrete failures:

1. **Array-like obligations leak.** A reflected buffer-source parameter is `Js.ArrayLike` (see
   `js-arraylike-obligation`). For a global binding this `Js.ArrayLike` parameter is baked into
   the generated import and **eagerly unified** during the first inference pass, polluting
   shared helpers. Example (`examples/webhook.wm`): `subtle.sign("HMAC", key, encodeText(...))`
   forces `encodeText`'s result to `Js.ArrayLike`, which then clashes with the `Js.Value`
   parameter at the `subtle.importKey` call site. The delayed obligation resolution runs *after*
   this pollution, too late.

2. **Overload selection ignores argument types.** `importKey` reflects to three variants
   (`keyData: Js.Value` for the `JsonWebKey` overload, `keyData: Js.ArrayLike` for the
   `BufferSource` overloads). With only syntactic hints the score ties and the first
   (`Js.Value`) variant wins, so a `Uint8Array` argument only "works" via the unsafe broad
   `Js.Value` coercion instead of selecting the `BufferSource` overload.

Goal: make global / namespace / constructor calls **deferred like receiver calls**, so variant
selection and obligation resolution both happen in the delayed pass with real inferred argument
types. This removes the syntactic-hint code smell and fixes both failures.

## Design

Receiver deferral keys off a **value receiver whose type inference discovers**. Globals have no
value receiver — they are keyed by a **static binding surface name** (e.g. `subtle.importKey`,
`Uint8Array.new`). So we add a parallel deferred form keyed by name rather than reusing the
receiver path verbatim.

### New deferred node: `FfiBindingCall`

```ts
// ast.ts
| Located<{ kind: "FfiBindingCall"; name: string; args: Expr[] }>
```

- `name` is the binding surface name (the key into `FfiElaboration.bindings`).
- Replaces the eager `selectVariant` rewrite for global / namespace / constructor calls.

### Phase responsibilities

1. **Elaboration (`receiver/rewrite_expr.ts`).** Where the `Call(Var(name), args)` branch
   currently calls `selectVariant(variants, expr.args)` and rewrites to the internal name,
   instead emit `FfiBindingCall { name, args: rewrittenArgs }`. Argument rewriting (nested FFI
   calls, refs) still happens; only variant selection is postponed. Keep the existing
   overload-arity error path, but defer it too (the delayed pass raises it when no variant
   matches the inferred arity).

2. **Inference (`infer/expr.ts`).** Add an `FfiBindingCall` case mirroring `FfiCall`:
   - infer each argument independently (lambda args via `inferLambdaTy`, as `FfiCall` does);
   - assign the call a `freshFfi` placeholder so nothing is pinned. Extend the `ffi` `Ty`
     variant with an optional `binding?: string` (and allow an absent/synthetic `receiver`) so
     the delayed pass can recover the binding name. The placeholder flows through HM exactly
     like a receiver-call placeholder (escape-analysis, `recordConsumedFfiUse`, etc.).
   - Other inference touch points that switch on `FfiCall`/`FfiGet` (`expr_flow.ts:308`,
     `expr_lambda.ts`, `decl_helpers.ts`, `decl_binding.ts`, `provenance.ts`) must treat
     `FfiBindingCall` consistently — audit each.

3. **Delayed pass (`delayed/delayed_resolve.ts`).** Add an `FfiBindingCall` case:
   - compute `argTypes` from `inferredType(result, arg)`;
   - `selectVariant(binding.variants, args, argTypes)` — now type-driven, fixing overload
     selection (e.g. `importKey` picks the `BufferSource` variant for a `Uint8Array` arg);
   - `resolveArrayLikeParams(selected.type, argTypes)` to narrow any `Js.ArrayLike` obligation
     to the concrete argument type (reuse the existing helper, now exported);
   - register the specialized variant (`addVariants`), `solveReflectedFfiValue` to solve the
     `ffi` placeholder to the variant result, `selected.add(internalName)`, and rewrite to
     `Call(Var(internalName), resolvedArgs)`;
   - if no variant matches the inferred arity, raise the deferred overload error here.
   - Idempotency across the two delayed rounds: once rewritten to a concrete `Call`, the node is
     no longer an `FfiBindingCall`, so a second pass is a no-op (same pattern as
     `resolveDeepReflectedCall`).

4. **Codegen / final inference.** The delayed pass replaces every `FfiBindingCall` with a normal
   `Call` to a generated internal name, so codegen never sees the new node. Add a defensive
   diagnostic if an `FfiBindingCall` ever survives the delayed pass (analogous to the
   unresolved-`ffi` boundary check in `compiler.ts`).

### Callback / lambda arguments

Global members can take callback arguments (callback param refs). The eager path uses
`rewriteArgsWithVariant`; the deferred path must reproduce callback-ref rewriting after the
variant is known in the delayed pass (see `resolveDelayedCallArg` in `materialize.ts`). Verify
with an existing callback-bearing global (e.g. an array/global higher-order member) before
finishing.

## Risk / blast radius

- **Overload selection now uses inferred arg types for *all* deferred globals.** This is the
  intended improvement but can change which variant is chosen versus the old syntactic tie-break.
  Run the full suite; expect and review changes in `tests/compiler_js_*`.
- **Inference changes touch the hot `ffi` placeholder path.** Keep the `FfiBindingCall`
  placeholder semantics identical to `FfiCall` to avoid regressions in escape analysis and
  delayed-FFI diagnostics.
- **Performance:** negligible. Reflection is already cached (`memberCache`, `namespaceCache`);
  the added delayed work is `selectVariant` + `resolveArrayLikeParams` over cached TypeExprs.

## Phasing

1. Add `FfiBindingCall` node + inference placeholder + delayed materialization; route **only
   bindings whose variants carry a `Js.ArrayLike` obligation** through it first. Confirm SDL
   probe + webhook pass and the suite is green.
2. Once stable, widen routing to **all** global / namespace / constructor binding calls,
   removing the syntactic-hint `selectVariant` at elaboration entirely. Re-run the suite and
   reconcile any overload-selection diffs.

This keeps the first landing safe and isolates the broader behavior change to step 2.

## Validation

- `wm check` on the SDL probe (`probe.wm`) and `probe_crypto.wm` stay green.
- `examples/webhook.wm` type-checks (both `sign` and `importKey` select buffer-source variants;
  `encodeText : (TextEncoder, String) => Uint8Array` is no longer polluted).
- `deno test tests` returns to the pre-change baseline (only the previously-known, unrelated
  lsp/pipe message-wording failures).
- Spot-check generated JS for a deferred global call: identity arg pass-through, correct
  `fallible` handling, no leftover `Js.ArrayLike`.

## Out of scope

- The broad `Js.Value` / `Js.Object` arg coercion in `jsImportActualArg` (separately flagged as
  unsafe). Deferral reduces reliance on it for buffer params but does not remove it.
- `three/webgpu` module-member reflection (`scene.add`) — unrelated reflection gap.
