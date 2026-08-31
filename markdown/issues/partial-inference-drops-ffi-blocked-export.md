# Issue: Partial Inference Drops FFI-Blocked Export, Breaking Downstream Named Import

Status: open

Discovered while building searchman (a Workman CLI that imports an Exa API client module).

## Summary

When a dependency module has a top-level `let` binding whose type depends on an
unresolved JS FFI member during partial inference, the binding is dropped from
the partial-pass exports. If a downstream module tries to import that binding by
name during the same staged-analysis wave, the import fails with
`module.unknown-import` before the final (non-recover) inference pass can
resolve the FFI and restore the export.

## Reproduction

```wm
-- exa.wm
from js.global import { fetch };
from js.global("JSON") import {
  stringify: Js.Value -> String,
} as JSON;

record Source = {
  title: String,
  url: String,
};

let search = (query: String) => {
  let body = JSON.stringify(JSON{ query: query });
  fetch("https://example.com", JSON{ method: "POST", body: body })
    :> Task.mapErr(Js.Error)
};
```

```wm
-- main.wm
from "./exa.wm" import { search };

let main = () => {
  print("ok")
};
```

`wm check exa.wm` succeeds. `wm run main.wm` fails:

```text
error[module.unknown-import main.wm:1:25]: unknown import search
```

## Root Cause (surface level)

Staged analysis processes modules in dependency order. For modules using FFI,
the first pass uses `inferModulePartial` (recover = true). When `search`'s
`inferBinding` throws — because `JSON.stringify`'s return type is an unresolved
`?ffi` type that doesn't match the `Js.Value` expected by the `JSON{ body: ... }`
literal — the recover path returns a `partialPrefixResult` that excludes
`search` from exports.

The downstream module (`main.wm`) is then inferred in the same wave using the
partial result of `exa.wm`. The named import `search` fails because it isn't in
the partial exports. The error is thrown before the final `inferModule` pass
(recover = false, fully resolved FFI) can restore `search`.

## Expected Behavior

A binding that fails only due to unresolved FFI in a partial pass should not
permanently disappear from exports for downstream import resolution. The staged
analysis should either:

- defer import-resolution errors until after the final pass, or
- mark FFI-blocked declarations as pending rather than dropping them, so
  downstream imports can resolve against the final result.

## Workaround

Avoid routing an unresolved FFI return type through a `JSON{ ... }` literal
field that expects `Js.Value`. Pass the object literal directly instead of
stringifying first:

```wm
-- Instead of:
let body = JSON.stringify(JSON{ query: query }));
fetch(url, JSON{ method: "POST", body: body })

-- Use:
fetch(url, JSON{ method: "POST", body: JSON{ query: query } })
```

This keeps the `body` field as a `JSON{ ... }` literal (type `Js.Value`) rather
than an unresolved FFI return type, so the binding survives the partial pass.

## Suggested Regression

Compile and run the two-file reproduction above with `wm run main.wm`. The
import of `search` must succeed once FFI is fully resolved in the final pass.
