# React useState: concrete generic instantiation and returned setter unions

## Fixed: erased discovery signatures bypass concrete call reflection

`useState(0)` initially exposed `(Js.Value, Js.Value -> Void)` to HM. The declaration-level mapper erases TS `S`; the delayed specialization gate only recognized nominal generic constructors. Literal scalar arguments therefore did not trigger TS instantiation. A lazy initializer could also commit an `any` callback result before HM inferred the callback.

Keep a `genericCall` bit from the actual TypeScript signature through FFI variants. Use literal scalar evidence to instantiate generic calls before committing their discovery signature. Defer a generic callback call without return evidence to the existing post-HM pass. The delayed pass recognizes the same metadata. TS still selects/instantiates signatures; HM still owns WM flow. No additional inference loop, TS union model, annotation-directed specialization, or React-specific compiler rule is introduced.

Regression coverage uses a local generic tuple fixture, without React or network dependencies: safe and unsafe imports, numeric and string literals, computed HM scalar arguments, lazy initializers, and rejection of the wrong setter argument. Literal overload precision also improves `document.querySelector("main")` from `Option<Element>` to `Option<HTMLElement>`.

## Fixed: acquired callables retain their foreign signature

React declares its setter using a static union:

```ts
type SetStateAction<S> = S | ((previous: S) => S);
type Dispatch<A> = (value: A) => void;
```

The follow-up preserves complex returned functions as foreign callable types rather than erasing their parameters to `Js.Value`. The foreign identity carries a TS reflection source, not a reference to a particular runtime closure. Calls pass the actual acquired value into an empty-path receiver adapter and ask TS to check/instantiate that call. Number replacement and updater callbacks therefore produce separate concrete call adapters around the same captured setter.

Existing foreign-type machinery preserves identities through aliases, WM records, ordinary identity helpers and module interfaces. Existing HM FFI obligations defer calls of tuple slots while the producer is unresolved; no new fixed-point loop or expression-provenance registry is introduced. TS callback parameter evidence is applied before the final query. Native functions with simple monomorphic signatures retain their existing representation.

Acquired complex callable invocations inherit the producing call's safety policy. Safe producers retain `Result` (or the reflected `Task` shape); unsafe producers return raw values and propagate exceptions. Distinct foreign identities isolate both modes across aliases, module exports, and chained factories. Wrong arguments, callback returns, and arities are rejected by TS; static union results with no WM representation remain unsupported. This does not add TS unions/subtyping to HM or allow annotations to choose overloads. The existing parameter-union fallback remains elsewhere in the mapper; this change avoids it for acquired complex callable values.

Coverage includes tuple extraction, records, aliases, module interfaces, computed initial values, overloads, generic returned functions, optional/rest parameters, negative call cases, two distinct captured closures, and thrown-error normalization. A real React server-render probe (`reactinwm/probes/acquired-react.wm`) runs a bounded replacement followed by an updater and produces `<output>11</output>` without a shim or manual hook signature. Browser DOM interaction has not been verified.

Scope limits: callable acquisition is covered for direct factory returns and nested tuple/container results. This does not redesign method/property extraction, provide arbitrary structural-object mapping, or automatically instantiate an acquired foreign callable passed where a native WM function type is required; a native closure can invoke it at a concrete call site. Promise/Task-returned callable acquisition has not been specifically validated.
