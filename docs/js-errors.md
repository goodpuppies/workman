# JavaScript error handling

Safe JavaScript FFI failures use the ordinary Workman datatype `Js.Error`. It is
not an opaque foreign object: Workman code can pattern-match it directly.

```wm
let jsErrorMessage = match(error: Js.Error) => {
  Js.Error(message) => { message },
  Js.Unknown => { "unknown JavaScript error" }
};
```

`Js.Error` is part of the normal basis alongside `Option`, `Result`, and `List`:

```text
type Js.Error =
  | Js.Error<String>
  | Js.Unknown;
```

The type and its message-carrying constructor have the same qualified spelling.
Use `Js.Error` in type positions and `Js.Error(message)` in patterns/expressions.

## Where `Js.Error` appears

Safe synchronous FFI calls return:

```text
Result<Value, Js.Error>
```

Safe promise-returning FFI calls return:

```text
Task<Value, Js.Error>
```

This applies to reflected imports, manually typed safe imports, receiver
properties/methods, and constructors. A manual safe signature names the JavaScript
value before wrapping:

```wm
from js.global("JSON") import {
  parse: (String) => Js.Object,
} as JSON;

let parsed = JSON.parse("{}");
-- parsed: Result<Js.Object, Js.Error>
```

If a manually supplied signature already returns `Result<_, _>` or `Task<_, _>`,
the FFI does not add a second wrapper.

Promise-returning calls normalize both cases:

- the JavaScript function throws before returning its promise;
- the returned promise rejects later.

Both become an `Err(Js.Error)` inside the Workman `Task`.

## Normalization behavior

When a safe JS boundary catches a thrown or rejected value, it converts it as
follows:

| JavaScript failure value | Workman value |
| --- | --- |
| native `Error` or subclass | `Js.Error(error.message)` |
| thrown string | `Js.Error(string)` |
| object with a readable `message` property | `Js.Error(String(value.message))` |
| `null`, `undefined`, number, symbol, or object without `message` | `Js.Unknown` |
| reading/converting `message` itself throws | `Js.Unknown` |

Examples:

```text
throw new TypeError("bad input")  -> Js.Error("bad input")
throw "bad input"                -> Js.Error("bad input")
throw { message: "bad input" }   -> Js.Error("bad input")
throw null                       -> Js.Unknown
```

The current representation intentionally retains only the message string. It does
not preserve the original JS object, error name/class, stack, `cause`, `code`, or
other custom fields. Use `Js.Unknown` when JavaScript did not provide a safely
readable message.

## Match synchronous errors directly

```wm
from js.global("JSON") import {
  parse: (String) => Js.Object,
} as JSON;

let parseConfig = (text) => {
  match(JSON.parse(text)) {
    Ok(value) => {
      Ok(value)
    },
    Err(Js.Error(message)) => {
      print("invalid JSON: " ++ message);
      Err(Js.Error(message))
    },
    Err(Js.Unknown) => {
      print("invalid JSON: unknown JavaScript error");
      Err(Js.Unknown)
    }
  }
};
```

Literal patterns also work because this is an ordinary datatype:

```wm
match(result) {
  Err(Js.Error("permission denied")) => { handlePermissionError() },
  Err(Js.Error(message)) => { handleOtherError(message) },
  Err(Js.Unknown) => { handleUnknownError() },
  Ok(value) => { useValue(value) }
}
```

Match both constructors. `Js.Unknown` is not exceptional control flow; it is a
normal alternative in the error type.

## Inspect Task errors with `Task.mapErr`

```wm
from js.global("Deno") import { readTextFile };

let readConfig = (path) => {
  readTextFile(path)
    :> Task.mapErr((error) => {
      let message = match(error) {
        Js.Error(text) => { text },
        Js.Unknown => { "unknown JavaScript error" }
      };
      print("could not read " ++ path ++ ": " ++ message);
      error
    })
};
```

The callback returns the original error, so logging does not discard it. Use
`Task.recover` only when the procedure can genuinely replace failure with a success
value:

```wm
readTextFile(path)
  :> Task.recover((error) => {
    print("using empty config after: " ++ jsErrorMessage(error));
    "{}"
  })
```

The FFI guarantee covers throws and rejections from the safe JavaScript operation.
Do not use `Panic` inside Task callbacks as an error mechanism; a Workman invariant
failure is not application-level `Js.Error` handling.

## Preserve context with an application error type

Matching exposes the JS message, but many procedures should retain which operation
failed. Map `Js.Error` into an application ADT rather than replacing it with a vague
string or `_`.

```wm
from js.global("Deno") import { readTextFile };
from js.global("JSON") import {
  parse: (String) => Js.Object,
} as JSON;

type AppError =
  | FileReadFailed<String, Js.Error>
  | JsonParseFailed<Js.Error>;

let readConfig = (path) => {
  readTextFile(path)
    :> Task.mapErr((error) => {
      FileReadFailed(path, error)
    })
};

let parseConfig = (text) => {
  JSON.parse(text)
    :> Result.mapErr(JsonParseFailed)
};

let describeError = match(error) => {
  FileReadFailed(path, jsError) => {
    "could not read " ++ path ++ ": " ++ jsErrorMessage(jsError)
  },
  JsonParseFailed(jsError) => {
    "invalid JSON: " ++ jsErrorMessage(jsError)
  }
};
```

This is the pattern used by the Raylib examples:

```wm
type AppError =
  | RaylibError<Js.Error>
  | RenderError<Js.Error>;

let initialized = Result|
  Raylib.loadRaylib(path),
  Raylib.H.InitWindow(960, 540, title)
| :> Result.mapErr(RaylibError);
```

The wrapper constructor adds operation/domain context while preserving the
matchable `Js.Error` as evidence.

## Use `Js.Error` with carrier-oriented procedures

The normal Workman structure remains:

1. receive or create a `Result<_, Js.Error>`/`Task<_, Js.Error>` head value;
2. lift procedure transformations into the shared carrier;
3. keep a carrier pipeline in result position;
4. group procedures with `Result|...|` or `Task|...|`;
5. match a `Result` at a synchronous control-flow boundary, or inspect a Task error
   through `Task.mapErr`/`Task.recover`.

```wm
let load = (path) => {
  let decode = lift Task (text) => {
    JSON.parse(text)
      :> Task.fromResult
  };

  readTextFile(path)
    :> decode
};

Task|load("a.json"), load("b.json")|
  :> Task.map((a, b) => {
    useConfigs(a, b)
  })
  :> Task.mapErr((error) => {
    match(error) {
      Js.Error(message) => { print("load failed: " ++ message) },
      Js.Unknown => { print("load failed for an unknown JS reason") }
    };
    error
  })
```

See [Carrier-oriented procedure design](./carriers.md) for lifting and carrier
grouping, and [Async and Task](./async.md) for Task evaluation details.

## Choosing an error policy

At each boundary, choose deliberately:

- **Propagate unchanged:** return the `Result`/`Task` without touching its error.
- **Inspect while preserving:** use `mapErr`, perform the observation, then return
  the same `Js.Error`.
- **Add domain context:** map into an application error constructor carrying the
  original `Js.Error`.
- **Handle at a boundary:** match `Js.Error(message)` and `Js.Unknown` where actual
  control flow depends on the failure.
- **Recover:** use a real fallback value only when continuing is semantically valid.

Avoid `_` when the message would make the failure actionable. Avoid flattening
every error to a generic string near the FFI call; doing so loses the distinction
between a known JS message and `Js.Unknown`, and often loses operation context.

## `Js.Error` versus compiler diagnostics

`Js.Error` is a runtime application value. It represents failure reported by a
JavaScript operation executed by the program.

Compiler parse/type/module diagnostics are different: they are produced while
building the program and use wm-mini's auditable diagnostic model. Do not use
`Js.Error` for frontend recovery marks, type errors, or LSP diagnostics.

## Current limitations

- Only a message string is retained for recognized JavaScript errors.
- `Js.Unknown` has no payload.
- There is no typed access to stack, cause, name, or platform-specific error fields.
- Safe FFI normalization does not turn arbitrary Workman `Panic` usage into a
  recommended runtime error channel.
- `-- @no-prelude` omits `Js.Error` together with the other algebraic basis types.

These limitations should be handled explicitly in application error types and
messages rather than by assuming the original JavaScript object remains available.

## Implementation and test references

- `src/basis.ts` defines the `Js.Error` datatype and constructors.
- `src/core/emit_prelude.ts` implements throw/rejection normalization.
- `src/core/emit_js.ts` wraps safe synchronous and promise-returning calls.
- `tests/compiler_js_import_test.ts` verifies the matchable datatype and types.
- `tests/cli_js_test.ts` verifies thrown strings and unknown thrown values at
  runtime.
- `examples/portscan.wm` demonstrates matching and rendering `Js.Error` messages.
- `examples/raylib/main.wm` preserves JS errors inside application error variants.
