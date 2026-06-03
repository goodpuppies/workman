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

Type-only JS imports create foreign Workman types. They are useful when a callback or function
parameter is a browser, Deno, or Node object:

```wm
from js.global import type { Request };

let getMethod = (req: Request) => {
  req.method
};
```

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
  log: (String, Number) => Void
} as console;
```

## Manual Types

When reflection cannot infer a useful type, write the JS type manually:

```wm
from js.global import unsafe {
  fetch: (String, Js.Value) => Js.Object,
  setTimeout: ((Void) => Void, Number) => Js.Value,
};
```

This is the escape hatch for APIs where TypeScript reflection is currently too broad, too overloaded,
or not visible from the active runtime declarations.

Manual types are trusted declarations. Today they are direct JS calls rather than reflected safe
calls, so use them for APIs whose shape you are willing to assert yourself.

## Deno APIs

Deno globals live under `Deno`:

```wm
from js.global("Deno") import unsafe { readTextFileSync };

let main = () => {
  let text = readTextFileSync("examples/data.txt");
  print(text)
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

Local JS modules use the same `js.module(...)` form. The specifier is passed to the generated Deno
program, so it should be a module Deno can import:

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
  shout: (String) => String
};
```

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

These are the current practical way to pass plain JS object/array data into JS APIs.

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
  byte.toString(Some(16))
};
```

## Optional Arguments

Some reflected optional JS parameters currently appear as `Option<T>`.

Example:

```wm
let text = byte.toString(Some(16));
```

This is accurate but not always ergonomic. Future FFI elaboration should accept plain supplied
arguments for optional JS parameters in more cases.

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
- Promise-heavy code often needs `Js.Object` annotations.
- Optional arguments may require `Some(value)`.
- `JSON{}` and `JSON[]` are currently the clearest way to pass object/array-shaped JS data.
- Workman records and tuples are not yet automatically adapted to JS object/tuple-like shapes.
- Unsafe imports do not make every derived receiver call unsafe.
- Dynamic JS property access is useful, but less precise than reflected foreign types.

The intended direction is that ordinary Workman code should stay ML-shaped, while the FFI boundary
does the JavaScript-specific adaptation.
