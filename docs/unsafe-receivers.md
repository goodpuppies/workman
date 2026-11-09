# Unsafe JavaScript receivers

An unsafe reflected import controls runtime error wrapping while keeping the
same TypeScript reflection and argument checking as a safe import.

Nominal objects returned by that boundary retain the policy for later property
reads and method calls:

```wm
from js.global import unsafe { URL };

let url = URL.new("https://example.test/page");
let path = url.pathname; -- String, with no Result wrapper
```

With a safe import, construction and subsequent member operations use their
normal Result/Task handling. A safe and unsafe instance of the same foreign type
can coexist without affecting each other.

Callback inputs from unsafe imported operations inherit the same policy. For
example, Deno.serve's inferred Request permits `request.url` directly. No Request
annotation or manual import signature is needed. Returned nested nominal values
also retain the policy through tuples, arrays, Option, Task, ordinary aliases,
records, and WM module exports.

An ordinary type annotation still checks the foreign type rather than choosing
a wrapping policy. Identity helpers can preserve either policy independently.
A helper whose member call has already resolved with one policy cannot also use
the other: WM rejects that conflict rather than silently switching between a raw
result and Result. Keep such member calls at the appropriate concrete boundary.

Unsafe getter and method exceptions propagate. Safe operations still normalize
them into errors. Reflected promises are an exception to the wrapping difference:
both safe and unsafe imports return `Task<T, Js.Error>`. Fulfillment becomes Ok
and rejection becomes Err; unsafe calls still propagate synchronous throws that
happen before the JavaScript operation returns its promise. This is a representation
conversion into WM's normal asynchronous model, so no Promise.resolve bridge is
needed. Manually declared Task primitives already return a promise of Result and
are not converted twice.
Dynamic Js.Value/Js.Object operations and native primitive receivers keep their
existing behavior; this change covers reflected nominal receivers. See also
[acquired callables](./acquired-callables.md) for returned foreign functions.
