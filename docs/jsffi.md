# JavaScript FFI

wm-mini can call JavaScript and TypeScript-declared APIs directly from Workman. The goal is a small
FFI surface that feels close to JavaScript while keeping the Workman core ML-shaped.

This document describes the current user-facing FFI.

## Import Forms

Import from a JavaScript global object:

```wm
from js.global("Math") import { max, floor };
from js.global("Math") import * as Math;
```

Import from the root JS global object:

```wm
from js.global import { URL, Response };
```

Import from a JS module:

```wm
from js.module("node:crypto") import { createHash };
from js.module("node:fs") import { createReadStream };
```

Rename imports:

```wm
from js.global("Math") import { max as jsmax };
```

Import JS types only:

```wm
from js.global import type { Request, Response };
```

Type-only JS imports create nominal foreign Workman types. They are useful in trusted boundary
declarations and in ordinary HM signatures once program flow already establishes that foreign type:

```wm
from js.global import type { Request };
from js.module("./request_bridge.ts") import {
  methodOf: Request -> String,
};

let method = methodOf(Panic("request")) :> Result.debug;
```

Writing `req: Request` on an otherwise unresolved callback does not itself give the FFI resolver a
`Request` receiver. The annotation checks the inferred callback type; it does not create foreign
evidence.

## Safe Calls and `Result`

Reflected JS imports are safe by default. A safe JS call returns:

```txt
Result<T, Js.Error>
```

Example:

```wm
from js.global("Math") import { floor };

let rounded = floor(4.8);

let value = match(rounded) {
  Ok(n) => { n },
  Err(_) => { -1 },
};
```

This is intentionally explicit: JS can throw, so Workman does not pretend the call is pure or total.

`Js.Error` is a normal matchable Workman datatype with `Js.Error(message)` and `Js.Unknown`
constructors. See [JavaScript error handling](./js-errors.md) for normalization rules, synchronous
and Task examples, and preserving JS failures in application error types.

Promise-returning JavaScript APIs become `Task<_, Js.Error>`. See [Async and Task](./async.md) for
the current Task model, including parallel collection with `Task.collectList`.

Primitive operators can flow through safe JS `Result` values, and `Result|...|` can collect several
`Result` arguments for a multi-argument function created with `via`. See
[Carrier Coercion and Tuple Lifts](./carriers.md).

## Unsafe Imports

Use `unsafe` when you want direct JS behavior without `Result` wrapping:

```wm
from js.global("console") import unsafe * as console;

let main = () => {
  console.log("hello", 42)
};
```

Unsafe imports are useful for quick scripts and stress tests. They trade explicit error handling for
ergonomics.

Manual typed unsafe imports are also supported:

```wm
from js.global("console") import unsafe {
  log: (String, Number) -> Void
} as console;
```

## Type annotations do not direct FFI reflection

An ordinary Workman `: Type` annotation checks the type inferred by HM. It does not select a
TypeScript overload, attach foreign reflection information, refine `Js.Object`/`Js.Value`, or change
the result of a reflected call.

If FFI code only works after adding a receiver or result annotation, that normally indicates lost
reflection information or another compiler bug. The annotation must remain erasable.

`Json.assert` is different: it explicitly checks a genuinely dynamic value against an expected
Workman shape. An annotation may state that expected shape around the assertion, but annotations do
not become casts elsewhere.

A manually typed JS import is also different. It declares the trusted foreign boundary signature;
it is not an annotation on an inferred Workman value.

## Manual Types

When reflection cannot infer a useful type, write the JS type manually:

```wm
from js.global import {
  fetch: String -> Js.Promise<Js.Object>,
  encodeURIComponent: String -> String,
};
```

This is the escape hatch when the concrete TypeScript call remains ambiguous, its selected type
cannot be represented honestly in Workman, or the declaration is not visible to reflection.

Overloaded or generic by itself is not a reason for a manual signature. When the call arguments are
known, Workman asks TypeScript to select and instantiate the concrete call. For example, a reflected
`IterableIterator<Entry>` passed to `Array.from` should automatically produce
`Result<Js.Array<Entry>, Js.Error>`.

Manual types are trusted declarations about the JS shape. Safe manual imports still return
`Result<_, Js.Error>` or `Task<_, Js.Error>` at the Workman boundary. Add `unsafe` only when you
explicitly want a direct JS call.

`unsafe` changes error handling, not reflection precision. Do not add it to fix inference. During
exploration, keep the safe import and use `Result.debug` if aborting on failure is acceptable; later
replace that with a match or ordinary `Result`/`Task` handling.

## Shims Keep The Boundary Workman-Shaped

Reflection covers foreign APIs that map cleanly into Workman. When an API does not map cleanly, that
does not automatically mean Workman should gain the host language's corresponding feature. In
particular, a reflection failure is not by itself a reason to add foreign subtyping or reproduce a
library's complete object model.

Use a small TypeScript shim when the foreign interaction model is fundamentally incompatible with
Workman. The shim should translate that model into the values and operations the program needs, with
an interface that remains natural in functional Workman code. TypeScript checks the foreign side;
Workman checks the interface it receives.

This is an intentional part of the FFI design rather than a loss of type safety. Foreign values can
remain nominal and opaque while the operations crossing the boundary remain fully typed. Host-only
concepts stay in the shim instead of leaking into ordinary Workman programs or driving expansion of
the language.

`Js.Object` and `Js.Value` are reserved for genuinely dynamic declarations or an explicitly chosen
dynamic boundary. They are not fallback types for failed reflection. If TypeScript declares a static
shape which Workman cannot map, the FFI access remains unresolved and must be made explicit or
adapted with a shim. Replacing known structure with an opaque value would erase evidence that
Workman's type inference cannot recover; use an assertion to turn an intentionally dynamic value
back into a checked Workman shape.

When reflection fails, diagnostics distinguish a missing JavaScript member from an existing member
whose TypeScript signature Workman cannot represent. The latter diagnostic includes the reflected
signature where possible. A simple compatible TS signature that nevertheless fails to flow through
Workman is an implementation bug, not evidence that the API needs a shim or manual typing.

## Deno APIs

Deno globals live under `Deno`:

```wm
from js.global("Deno") import { readTextFile };

let main = () => {
  readTextFile("examples/data.txt")
    :> Task.map((text) => { print(text) })
    :> Task.recover((_) => { print("could not read file") })
};
```

For serving HTTP:

```wm
from js.global("Deno") import unsafe { serve };
from js.global import unsafe { Response };
from js.global import type { Request };

let handler = (req: Request, info: Js.Object) => {
  Response.new("hello", JSON{ status: 200 })
};

let main = () => {
  serve(handler)
};
```

Run programs with the permissions the underlying JS APIs need:

```sh
deno task wm run examples/server.wm
```

or directly:

```sh
deno run --allow-read --allow-write --allow-run --allow-env --allow-net src/main.ts run examples/server.wm
```

## Module Metadata

JavaScript's lexical `import.meta` object is available through `js.meta`:

```wm
from js.global import unsafe { URL };
from js.meta import { url, main, filename, dirname, resolve };

let assetPath = URL.new("./assets/data.txt", url) :> .pathname;
```

`url` is emitted as a direct access to the generated ES module's literal `import.meta.url`. It is
not rewritten to the original Workman source path. The built-in metadata members have these types:

```txt
url      : String
main     : Bool
filename : Option<String>
dirname  : Option<String>
resolve  : String -> String
```

Because these are lexical module values rather than calls across an arbitrary JavaScript boundary,
they are imported directly rather than wrapped in `Result`.

## Node APIs

Use `js.module(...)` for Node built-ins:

```wm
from js.module("node:crypto") import { createHash };

let main = () => {
  match(createHash("sha256")) {
    Ok(hash) => {
      print("created hash")
    },
    Err(_) => {
      print("could not create hash")
    },
  }
};
```

Node-style streams can use reflected receiver methods:

```wm
from js.module("node:fs") import { createReadStream };
from js.global("console") import * as console;

let stream = createReadStream("examples/data.txt");

let main = () => {
  match(stream) {
    Ok(s) => {
      s.on("data", (chunk) => {
        match(chunk.length) {
          Ok(n) => { console.log("bytes", n) },
          Err(_) => { console.error("missing length") },
        };
      });
    },
    Err(_) => {
      console.error("could not open stream")
    },
  }
};
```

## Local JavaScript Files

Local JS modules use the same `js.module(...)` form. Relative specifiers are resolved from the `.wm`
source file, and generated code imports them by absolute `file://` URL so `wm run` can execute from
its temporary output directory:

```wm
from js.module("./helpers.js") import { shout };

let main = () => {
  match(shout("hello")) {
    Ok(text) => { print(text) },
    Err(_) => { print("failed") },
  }
};
```

If reflection cannot discover the type, add a manual type:

```wm
from js.module("./helpers.js") import {
  shout: String -> String
};
```

For generated TypeScript modules with many exports, namespace imports expose reflected top-level
functions and nested object methods:

```wm
from js.module("./raylib_bindings.ts") import * as Raylib;
let _ = Raylib.loadRaylib("./raylib.dll");
let _ = Raylib.H.InitWindow(960, 540, "demo");
```

Default imports such as JavaScript's `import raylib from "./raylib_bindings.ts"` do not have a
dedicated Workman import form yet.

## JS Objects and Arrays

Use `JSON{}` for JS object literals:

```wm
let opts = JSON{
  method: "POST",
  headers: JSON{ "Content-Type": "application/json" },
  body: "hello"
};
```

Use `JSON[]` for JS array literals:

```wm
let args = JSON["-s", "https://example.com"];
```

These are the current practical way to pass plain JS object/array data into JS APIs. When a dynamic
boundary has been asserted to an expected shape, `Js.Array<T>` can carry element metadata for
JavaScript arrays while remaining an opaque JS value:

```wm
record Commit = { id: String, message: String };
record PushPayload = { commits: Js.Array<Commit> };

let payload: Result<PushPayload, Js.Error> = JSON.parse(bodyText)
  :> Result.andThen((raw) => { raw :> Json.assert });
```

Annotations on dynamic receiver results, such as a mapped `Js.Array<String>`, are intentionally not
casts. They currently require a real assertion or a more precise reflected receiver path.

Example:

```wm
from js.module("node:child_process") import { spawn };

let proc = spawn("curl", JSON["-s", "https://example.com"], JSON{
  stdio: JSON["ignore", "pipe", "inherit"],
  env: JSON{ "USER_AGENT": "Workman-FFI" },
});
```

## Nullish Values Become `Option`

Reflected JS APIs that can return `null` or `undefined` map to `Option<T>`.

Example:

```wm
from js.global("document") import { querySelector };

let found = querySelector("main");

let exists = match(found) {
  Ok(Some(_)) => { true },
  Ok(None) => { false },
  Err(_) => { false },
};
```

## Properties and Methods

Known JS objects support reflected property and method access:

```wm
from js.global import type { Request };

let read = (req: Request) => {
  let method = req.method;
  let signature = req.headers.get("x-hub-signature-256");
  (method, signature)
};
```

If the receiver is only known as `Js.Object`, property and method access uses dynamic JS lookup:

```wm
let readContent = (body: Js.Object) => {
  body.content
};
```

Dynamic lookup is fallible and returns `Result`.

## Callbacks

JS callbacks are written as ordinary Workman lambdas:

```wm
stream.on("data", (chunk) => {
  print(chunk)
});
```

When TypeScript gives callback parameter types, wm-mini uses those types for property and method
reflection inside the callback.

Workman functions are still unary in the ML sense. A callback that looks like multiple parameters is
a tuple-shaped Workman argument at the core boundary:

```wm
let hexByte = (byte: Number, index, array) => {
  byte :> .toString(16)
};
```

## Optional Arguments

Supplied optional JS parameters can usually be passed directly.

Example:

```wm
let fixed = value :> .toFixed(0);
```

If reflection exposes an optional value as `Option<T>` in a specific API, use `Some(value)` or
`None` for that API. Prefer the plain supplied form when it typechecks.

## Common Patterns

Panic on JS errors in a small script:

```wm
let try = (result) => {
  match(result) {
    Ok(value) => { value },
    Err(_) => { Panic("JS FFI call failed") },
  }
};
```

Use it sparingly:

```wm
let text = try(Deno.readTextFile("README.md"));
```

Read a JS property with a fallback:

```wm
let content = match(body.content) {
  Ok(value) => { value },
  Err(_) => { "" },
};
```

## Current Limitations

- Some root globals still need manual types.
- Some Promise-heavy APIs still need a more precise reflected/manual boundary or an explicit
  `Json.assert`; ordinary annotations are not a workaround.
- Optional arguments may still require `Some(value)` for APIs where reflection exposes an
  `Option<T>` parameter.
- `JSON{}` and `JSON[]` are currently the clearest way to pass object/array-shaped JS data.
- `Js.Array<T>` currently supports only a small reflected dynamic receiver surface, such as `.map`,
  `.filter`, `.reduce`, `.join`, `.includes`, `.at`, and `.length`.
- Workman records and tuples are not yet automatically adapted to JS object/tuple-like shapes.
- Unsafe imports do not make every derived receiver call unsafe.
- Dynamic JS property access is useful, but less precise than reflected foreign types.

The intended direction is that ordinary Workman code should stay ML-shaped, while the FFI boundary
does the JavaScript-specific adaptation.
