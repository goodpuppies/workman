# FFI gaps exposed by a direct WM Deno server

## Callback input erasure (fixed)

`Deno.serve(options, (request, _) => { Response.new(request.url :> Result.debug) })`
failed with `cannot resolve JS FFI property url for receiver type Js.Value`.
Discovery and callback refs retained Request correctly; syntheticCallbackTypeFromArg
remapped callback inputs in the outgoing-parameter position, which erases nominal
receivers. Mapping callback inputs as incoming values preserves Request without a
user annotation. Covered by ffi_callback_nominal_inputs_test.ts.

## Constructor argument unions (open)

`from js.global("Deno") import unsafe { readFileSync };`
`from js.global import unsafe { Response };`
`let main = () => { Response.new(readFileSync("dist/index.html")) };`

Response accepts Uint8Array, but the compiler freezes BodyInit to String in
type_mapping.ts. It reports a String/Uint8Array mismatch against the generated
__ffi_Response_new binding rather than the valid TS constructor alternatives.
`Response.new(None, JSON{ status: 204 })` similarly fails with String/Option<T>.
Constructor bindings lack the callRef machinery used for imported functions;
they need call-specific constructor reflection, not annotations or a JS shim.
Source repros are in reactinwm/probes/response-bodies.wm and response-null.wm.

## Options shapes erased before overload resolution (open)

The synthetic call for Deno.serve(JSON{hostname: ..., port: 5173}, handler) uses
any for the JSON options argument. TS then selects the UnixAddr overload even
though the supplied options describe TCP. Request remains the same nominal type
across these overloads, so the callback-input fix is independent. Preserve known
JSON/record argument shape when selecting overloads; do not annotate the result
to disguise the incorrect overload.

## Unsafe policy on nominal receivers (fixed)

Unsafe imported constructors/functions and their callback inputs now retain
their wrapping policy on each incoming nominal value. Receiver properties,
methods, extracted methods, chained objects, and Option/array/tuple/Task payloads
use that policy. Safe and unsafe values of the same TS type remain independent.
Ordinary annotations check nominal identity without selecting wrapping policy;
identity helpers carry hidden policy cells through existing HM substitution and
instantiation. A helper whose member adapter has already resolved with a fixed
policy rejects a conflicting receiver rather than silently changing its result.

This uses generated TypeExpr evidence and an internal HM policy cell, not a
global flag on a TS class name, new source syntax, annotation-based reflection,
or an extra inference loop. Dynamic Js.Value/Js.Object and native primitive
receiver operations keep their existing behavior. Complex returned callables
retain the separately implemented acquired-callable policy.

Regression coverage: tests/ffi_receiver_safety_test.ts. Module-defined callback
receiver refs also keep fully qualified TS sources instead of assuming every
class is global; missing property diagnostics no longer recover a static typo
as Js.Value.

The server body tests exposed a related promise representation bug: unsafe
Promise-returning calls were typed as Task but emitted raw Promise values.
Both safe and unsafe reflected promises now remain Task<T, Js.Error>, with
fulfillment and rejection converted to Ok and Err. Unsafe synchronous throws
before returning the promise still propagate. Generated reflection evidence marks
these promise conversions, leaving manually typed Task primitives alone because
they already return Promise<Result>. No raw Js.Promise vocabulary or explicit
Promise.resolve bridge is needed.

Removing the root.render Result.debug exposed a separate match snapshot bug:
deferred FFI argument/constraint graphs can be cyclic, while snapshotType only
memoized free variables. Snapshots now reserve each node before following its
edges. A cyclic-graph regression checks termination, sharing and isolation from
later mutable constraints; the React browser entry compiles without the unwrap.

## Diagnostic quality (open)

During the WM React test port, an unconstrained helper's .includes was inferred
as Js.Array<String> and failed against a String SSR result. The primary error
was only `type mismatch` with no source location; wm err showed the conflicting
types buried among unresolved obligations. Preserve the source and conflicting
types when a delayed-FFI constraint fails. The helper now explicitly states its
string input, which is genuine disambiguation of an otherwise generic .includes.
