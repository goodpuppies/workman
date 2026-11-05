# A re-exported namespace can't be reached through a namespace import

Status: open. Reproduced 2026-11-05 at `d4e418c` while checking atview's `docs/repl.md`.

## Reproduction

`repl-async.wm` in atview contains:

```wm
export from "./util/repl-text.wm" import * as Text;
```

Importing it with `import *` works, but importing it as a namespace doesn't:

```wm
from "./repl-async.wm" import *;
let t = Text;                       -- ok
```

```wm
from "./repl-async.wm" import * as Async;
let t = Async.Text;                 -- unknown name Async.Text
let u = Async.Text.render;          -- unknown name Async.Text.render
```

## Impact

The last example in atview's `docs/repl.md`, `:> Async.show(Async.Text)`, doesn't check.

## Expected

`Async.Text` resolves to the same value as `Text` does under `import *`. The commit that added `export from` (`4bae758`) describes namespace re-exports as giving real nested access.

## Not yet known

The cause hasn't been traced, and the failure hasn't been reduced to a minimal two-file case outside atview.
