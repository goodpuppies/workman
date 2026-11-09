# Compiler stack exhaustion while inferring a mutually recursive WON renderer

Status: open. Reproduced 2026-11-09 with the local Workman 0.6.3 checkout and Deno 2.9.8 on Windows. The checkout includes the in-progress generic-call and acquired-callable FFI changes; this has not been bisected against an earlier revision.

## Reproduction

From the Workman checkout, with the sibling reactinwm experiment available:

```powershell
deno run --config deno.json -A src/main.ts check ../reactinwm/probes/won-mutual-stack.wm
deno run --config deno.json -A src/main.ts type-debug ../reactinwm/probes/won-mutual-stack.wm
```

The source imports React 19.2.0 and uses the sibling project's import map with `@types/react` 19.2.5 for reflection. No program execution or browser is needed to trigger the issue. The complete reproducer is embedded below so the report does not depend solely on the sibling file.

## Actual result

`check` exits with status 1 and reports `Maximum call stack size exceeded`, blaming the `match(children)` expression inside `renderChildren` (line 98 in the captured source).

`type-debug` identifies the phase as **initial partial inference**. It also reports an unresolved `createElement` obligation in `textNode`, whose partial type is `('a, 'b) -> ?ffi:createElement`. The stack overflow appears while processing the mutually recursive `renderAt`/`renderChildren` group. Explicit parameter and result annotations on that group do not prevent it.

## Expected result

Either infer/check the program, or report a normal actionable type/FFI diagnostic. Exhausting the compiler's JavaScript call stack is not an acceptable diagnostic for a finite source program, regardless of whether every authored type is supported.

## Scope and controls

- The same WON renderer checks after replacing the mutually recursive child-list walk with a non-mutual indexing helper and `List.map`, leaving one recursive renderer. That is the current workaround in `../reactinwm/src/won-view.wm`.
- A much smaller mutual tree-renderer control (`../reactinwm/probes/mutual-tree-minimal.wm`) checks successfully. Therefore this is **not established as a general mutual-recursion bug**; interaction with this program's foreign calls, callback props, bindings, or partial type/taint graph needs investigation.
- WON parsing is never executed during this reproduction. The observed failure is in WM compiler inference, not a parser recursion limit reached while reading a large WON document.
- No compiler fix is included in this report. The precise recursive traversal/cycle responsible has not been isolated, and the host stack trace is hidden by the current diagnostic wrapper.

## Captured reproducer


```wm
from "basis/won.wm" import * as Won;
from "basis/won_value.wm" import * as W;
from "basis/text.wm" import * as Utf8;
from "basis/string.wm" import * as Bytes;
from js.module("npm:react@19.2.0") import unsafe { createElement };
from js.module("npm:react@19.2.0") import type { DOMElement };
from js.global import type { Element };

type View = DOMElement<Js.Value, Element>;

record Bindings = { text: String -> String, action: String -> Void };
record EventProps<child> = {
  key: String,
  className: String,
  children: Js.Array<child>,
  onClick: Js.Value -> Void,
};

-- WON accepts byte strings; WM literals are Unicode text. Convert explicitly.
let parse = (source) => {
  let wire = Utf8.toUtf8(source) :> Result.debug :> Bytes.toNative :> Result.debug;
  Won.decode(wire) :> Result.debug
};

let string = match {
  W.Text(bytes) => { Utf8.fromUtf8(bytes) :> Result.debug },
  _ => { Panic("WON view: expected text") },
};

let attribute = (attributes, name) => {
  List.find(attributes, (entry) => { let (key, _) = entry; key == name })
};

let className = (attributes) => {
  match(attribute(attributes, "className")) {
    Some(entry) => { let (_, value) = entry; string(value) },
    None => { "" },
  }
};

let click = (attributes) => {
  match(attribute(attributes, "onClick")) {
    Some(entry) => {
      let (_, value) = entry;
      match(value) {
        W.Tag("Action", [], body) => { Some(string(body)) },
        _ => { Panic("WON view: onClick must be Action(\"name\")") },
      }
    },
    None => { None },
  }
};

let validateAttributes = (attributes) => {
  List.map(attributes, (entry) => {
    let (key, _) = entry;
    if (key == "className" || key == "onClick") { void }
    else { Panic("WON view: unsupported property " ++ key) }
  });
  void
};

let textNode = (path, value) => {
  let tag = "span";
  createElement(tag, JSON{ key: path, children: value })
};

let rec renderAt = (bindings: Bindings, path: String, value: W.Value): View => {
  match(value) {
    W.Text(_) => { textNode(path, string(value)) },
    W.Tag("Bind", [], body) => { textNode(path, bindings.text(string(body))) },
    W.Tag(tag, attributes, body) => {
      validateAttributes(attributes);
      let children = match(body) {
        W.List(items) => { renderChildren(bindings, path, items, 0) },
        W.Null => { [] },
        _ => { [renderAt(bindings, path ++ ".0", body)] },
      };
      let classes = className(attributes);
      let nodes = Js.Array.fromList(children);
      match(click(attributes)) {
        Some(action) => {
          createElement(tag, .{
            key = path,
            className = classes,
            children = nodes,
            onClick = (_) => { bindings.action(action) },
          })
        },
        None => {
          createElement(tag, JSON{ key: path, className: classes, children: nodes })
        },
      }
    },
    _ => { Panic("WON view: expected an element tag, Bind, or text") },
  }
} and renderChildren = (bindings: Bindings, path: String, children: List<W.Value>, index: Number): List<View> => {
  match(children) {
    [] => { [] },
    [child, ..rest] => {
      [renderAt(bindings, path ++ "." ++ Text.of(index), child),
        ..renderChildren(bindings, path, rest, index + 1)]
    },
  }
};

```

