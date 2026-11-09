# Native WON literals

Use `WON{...}` for a WON record and `WON[...]` for a WON list:

```wm
let settings = WON{ title = "Counter" step = 1 };
let template = WON[
  main[
    h1("Counter")
    p["Count: " Bind("count")]
    button<onClick = Action("increment")>("Add one")
  ]
];
```

These expressions have the existing `Value` type from `basis/won_value.wm`.
No import is needed to construct a literal. To inspect it, import the constructors:

```wm
from "basis/won_value.wm" import * as W;

let length = (value) => {
  match(value) {
    W.List(items) => { List.length(items) },
    _ => { 0 },
  }
};
```

The compiler parses and checks the literal, then emits ordinary value construction.
There is no runtime string parser. Invalid syntax and duplicate keys produce source
diagnostics. The formatter preserves the literal's contents, including its comments
and whitespace-sensitive tag attachments.

In the editor, hover the `WON` keyword or a bracket for container counts, a tag for
its properties and payload, or a property for its value kind and containing tag.
Scalar hovers show the authored value, UTF-8/blob byte counts, or exact number
spelling. These descriptions reflect WON data; tag names do not declare React prop
types or event signatures.

The contents follow [portable WON syntax](../tooling/won/markdown/won.md):

- Fields use `=`, and commas between entries are optional whitespace.
- Tag attributes and payloads must touch the tag: `Ready[1 2]` is one value;
  `Ready [1 2]` is a tag followed by a separate list.
- Numbers retain their spelling: `1`, `1.0`, and `1E+00` are distinct values.
- Text becomes UTF-8 byte lists. Blobs use lowercase hex, such as `x"00ff"`.
- Quoted keys are for names that cannot be bare identifiers. Keys must be unique.
- `//` and nested `/* ... */` comments are supported inside literals.

`Bind` and `Action` are ordinary WON tags. The React example gives them meaning by
dispatching to WM functions; the compiler gives them no special behavior.

Expression interpolation, spreading, and function-valued properties are not supported.
For composition, export literal values from modules and combine them with ordinary
WM functions and the `W.List`, `W.Record`, and `W.Tag` constructors. WON lists retain
portable WON semantics; they are not WM tuples or structural records.

See the runnable [React example](../examples/fullstack/react/README.md).
