# Compiling WM to SML

`wm sml` translates a WM program and the modules it imports to Standard ML that
[MLton](http://mlton.org) builds into a native executable:

```sh
wm sml app.wm build/          # writes build/project.mlb and one .sml file per module
mlton -output app build/project.mlb
wm sml app.wm build/ --mlton  # the same, and builds build/app when mlton is on PATH
```

The output directory is self-contained: it holds the translated program, the parts of the
SubsetML Basis the program uses, and the host adapters that give printing, files and number
text their native implementation. It can be moved, checked in, or built on another machine.

The translator is SubsetML's own WM reader. Its output is portable SubsetML: it names only the
SubsetML Basis, never the SML Basis Library directly, and passes SubsetML's `check-portable`.
`wm` carries it both as JavaScript and as SML. With `mlton` on PATH, the first `wm sml` builds the
SML one into the Workman cache (`~/.cache/workman/subsetml/`), which takes about 15 seconds, and
later runs use that native build, which translates several times faster. Without MLton, or with
`WM_SML_TRANSLATOR=js`, the JavaScript translator runs. Both write the same files.

## What carries over

A translated program behaves as it does under `wm run`. `print` takes any number of
arguments and shows them exactly as WM does: text and characters raw, `-3` (not SML's `~3`),
reals as JavaScript writes them (`0.30000000000000004`, `1e+21`), `void`, tuples, lists,
records with sorted labels, `Some`/`None`, `Ok`/`Err`, and your own datatypes (`Link(End)`,
`Box(1, 2)`). Template strings and `Text.of` show values the same way. `!`, `%`, real `==`,
carriers (`Result|a, b|`, `via`), records and record updates, `_name` bindings, lambdas in
every form (`a => b => a + b`, `=> :> f`), pipelines, datatypes and pattern matching translate
directly. Numeric defaults agree: an operator nothing decides is `Int32` (`Real64` for `/`) in
WM as in SML.

## What does not, yet

The translator accepts a profile of WM. These are rejected with an error that names the place:

- JavaScript imports (`from js.module(...)`, `from js.global(...)`), and so `Task`, the JS
  FFI and the parts of the std library built on them. C FFI is likewise not translated.
- The std modules (`Traverse`, `Map`, ...): import the `basis/` modules instead
  (`basis/string.wm`, `basis/list.wm`, ...).
- Showing a value through a generic function's own type variable, as in
  `(x) => { print(x) }`: SML has no generic display. Annotate the parameter.
- A field selection whose receiver several declared record types could be, with nothing else
  deciding it: annotate the receiver.

Imports must be relative `.wm` paths or `basis/` modules.
