# React counter in WM

Run `wm run dev` from this directory (or a child directory), then open
http://127.0.0.1:5173. This builds the browser app and starts the server. Edits
to `src/`, `serve.wm`, HTML, the reload client, or Deno configuration rebuild
and restart it; the browser reloads when the new server is ready. Browser state
resets on each reload. Run `wm run test` for the renderer smoke test, or
`wm run test -- --filter "text binding"` to filter tests.

`pak.wm` declares the local commands. `wm run build` builds without starting the
server; `wm run serve` serves the existing build. The `dev` command wraps the
build-and-serve steps in `watch(paths, command)`. Build errors wait for your
next edit and retry. Restart `wm run dev` after changing `pak.wm`. Use the WM
compiler from this checkout and have Deno with `deno bundle` support on `PATH`.
The commands do not install tools.

Dependency versions and import aliases live in `deno.json`, with resolutions in
`deno.lock`. WM sources use the aliases (`react`, `react-dom/client`, and
`react-dom/server`) rather than repeating npm versions.

The browser app lives in `src/` (`main.wm`, `app.wm`, and `won-view.wm`). The
HTTP server is `serve.wm` at the example root, alongside `index.html` and the
test.

The component, hook, event callback, renderer, and HTTP server are WM. React
runs in the browser through reflected FFI; no authored JavaScript bridge is
needed for React. A small `reload.js` development client polls the server
revision to refresh the page after rebuilds. The server only serves the page and
bundle; counter state stays in the browser.

The small template uses native `WON[...]` syntax and is constructed at module
load. It needs no runtime string parsing. `Bind("count")`,
`Action("increment")`, and `Component("header")` are local renderer conventions
that dispatch through bindings to WM functions and registered components.
Functions and state remain in WM; the literal has no interpolation or
function-valued properties.

Register a component once, outside render functions:

```wm
let header = View.component () => {
  WON[header[a<href="/">("Home")]]
};

let bindings = View.bindings [View.namedComponent("header", header)];
let template = WON[main[Component("header")]];
```

`View.component` accepts a zero-argument function returning WON and renders it
using `View.emptyBindings`. For custom bindings, `View.componentWith` accepts a
zero-argument function returning `(bindings, template)`. Both bindings and
markup can capture state from hooks in that function:

```wm
let app = View.componentWith () => {
  let (count, setCount) = useState(0);
  let bindings = View.bindings [
    View.text("count", => Text.of(count)),
    View.action("increment", => { setCount((previous) => { previous + 1 }) })
  ];
  (bindings, WON[main[
    p[Bind("count")]
    button<onClick = Action("increment")>("Add one")
  ]])
};
```

Keep state-independent bindings at module scope. The example's `sharedBindings`
registers the header and counter once. The counter keeps text and action
bindings that capture its current state locally. The final `app` function
composes both components inside `main`.

The helper adapts React's props argument internally and calls your drawing
function during React rendering, so hooks remain valid. Both helpers take one
argument: `View.component(draw)` and `View.component draw` are equivalent. They
return registered React elements; mount an app with `root.render(app)`, without
calling `app()` or wrapping it in another component.

`View.render(bindings, template)` resolves the name and creates a keyed
occurrence of the registered component. React calls its WM function, so it can
use hooks independently. Registration stores a React element whose type is
reused across parent renders; registering inside rendering would create a new
type and reset that component's state. `View.bindings` supplies diagnostics for
unbound names. Text and action callbacks run only when looked up or triggered.
Names are independent across binding kinds; later entries override earlier
entries of the same kind and name. Combine binding entry lists with
`List.append` when needed. Component tags currently take only a name, with no
attributes or child payload beyond that name. A bare `header` remains an
ordinary HTML tag.

The renderer supports text, nested tags, className, href, and onClick. It
rejects other properties. A top-level WON list must contain one root element.
Keys come from positions and suit this fixed tree. The renderer decodes WON's
UTF-8 text bytes when passing text to React.
