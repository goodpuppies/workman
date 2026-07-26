# Issue: Named Import Collides with Generated Module Binding

Status: open

Discovered during the ownership-based atview module split.

## Summary

If a module exports a value with the same identifier as the module's generated JavaScript binding,
a named Workman import passes `wm check` but the emitted program fails to parse.

## Reproduction

```wm
-- render.wm
let render = (value) => { value };
```

```wm
-- main.wm
from "./render.wm" import { render };

let main = () => {
  print(render("ok"))
};
```

`wm check main.wm` succeeds. `wm run main.wm` emits the equivalent of:

```js
const render = render.render;
```

and Node rejects it:

```text
SyntaxError: Identifier 'render' has already been declared
```

The live atview failure was generated in `atview/app/main.mjs` after importing `render` from
`app/render.wm`.

## Expected Behavior

Generated module namespace bindings and source-level named imports must use distinct hygienic
identifiers. A valid checked Workman program should not fail JavaScript parsing because of an
emitter-created name collision.

## Workaround

Use an explicitly distinct namespace import:

```wm
from "./render.wm" import * as Render;

let main = () => {
  print(Render.render("ok"))
};
```

## Suggested Regression

Compile and execute the two-file reproduction above. The test must exercise emitted JavaScript;
typechecking alone does not observe the collision.
