# Acquired JavaScript callables

Foreign functions returned by JavaScript APIs can require call-specific TypeScript checking, just like imported functions. Examples include overloaded functions, generic functions, and React setters whose argument accepts either a value or an updater.

```wm
from js.module("npm:react@19.2.0") import { useState };

let component = () => {
  let (count, setCount) = useState(0) :> Result.debug;
  let replace = () => { setCount(10) :> Result.debug };
  let increment = () => {
    setCount((previous) => { previous + 1 }) :> Result.debug
  };
  -- Build the element tree here, using replace and increment as callbacks.
  count
};
```

React must invoke the component in a valid hook context. This example illustrates typing; calling it outside React will produce React's invalid-hook-call error.

WM retains the setter as a foreign callable identity. At each invocation, TypeScript checks the concrete arguments against the original signature. The setter above accepts numeric replacement values and numeric updater functions; strings and updater functions returning strings are rejected. No TypeScript union type is added to WM.

Acquired complex callables inherit the safety policy of the call that produced them. Safe acquisition wraps later calls in `Result<T, Js.Error>` (or the reflected `Task` shape); unsafe acquisition returns raw values and lets exceptions propagate. Type reflection and argument checking remain enabled in both modes. The policy follows aliases, module exports, and further returned complex callables. Safe and unsafe acquisitions of the same API can coexist. Simple monomorphic function results retain their existing native-function mapping.

Foreign callable identities survive aliases, tuples, WM records, ordinary identity helpers, and WM module interfaces. Calls invoke the actual captured function value; the compiler's reflection source does not recreate the closure. Pipes such as `10 :> setCount` use the same checking.

TypeScript still owns overload selection and generic instantiation. An ordinary annotation checks the inferred result and does not select an overload. If the selected result itself has no WM representation, such as an untagged `number | string` union, the call is rejected.

This support covers factory returns and nested tuple/container results. It does not redesign foreign method extraction or arbitrary structural-object mapping. Passing an acquired foreign callable where a native WM function is required may need a native closure that invokes it at a concrete call site.
