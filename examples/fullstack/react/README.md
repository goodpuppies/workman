# React counter in WM

From this directory, run `deno task build`, then `deno task serve`, and open
http://127.0.0.1:5173. Run `deno task test` for the renderer smoke test.
Requires Deno with `deno bundle` support. Rebuild and restart after edits.

The browser app lives in `src/` (`main.wm`, `app.wm`, and `won-view.wm`).
The HTTP server is `serve.wm` at the example root, alongside `index.html` and the test.

The component, hook, event callback, renderer, and HTTP server are WM. React runs
in the browser through reflected FFI; no authored JavaScript bridge is needed.
The server only serves the page and bundle; counter state stays in the browser.

The small template uses native `WON[...]` syntax and is constructed at module load.
It needs no runtime string parsing. `Bind("count")` and `Action("increment")`
are local renderer conventions that dispatch to WM functions. Their cost is two
short matches in `src/app.wm`. Functions and state remain in WM; the literal has
no interpolation or function-valued properties.

The renderer supports text, nested tags, className, and onClick. It rejects other
properties. A top-level WON list must contain one root element. Keys come from
positions and suit this fixed tree. The renderer decodes WON's UTF-8 text bytes
when passing text to React.
