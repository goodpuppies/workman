# React counter in WM

From this directory, run `deno task build`, then `deno task serve`, and open
http://127.0.0.1:5173. Run `deno task test` for the renderer smoke test.
Requires Deno with `deno bundle` support. Rebuild and restart after edits.

The component, hook, event callback, renderer, and HTTP server are WM. React runs
in the browser through reflected FFI; no authored JavaScript bridge is needed.
The server only serves the page and bundle; counter state stays in the browser.

The small WON template is parsed once. `Bind("count")` and `Action("increment")`
are local renderer conventions that dispatch to WM functions. Their cost is two
short matches in app.wm. Native WON syntax would remove the string-parsing boundary;
function values inside WON are not needed for this example. Native syntax is still
planned, so this runnable example uses the existing portable WON parser.

The renderer supports text, nested tags, className, and onClick. It rejects other
properties. Keys come from positions and suit this fixed tree. The explicit UTF-8
conversion is required by the portable WON API.
