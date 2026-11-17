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

The translator is SubsetML's own WM reader, packaged with `wm` as JavaScript. Its output is
portable SubsetML: it names only the SubsetML Basis, never the SML Basis Library directly, and
passes SubsetML's `check-portable`.

## What carries over

A translated program behaves as it does under `wm run`. In particular `print` takes any
number of arguments and shows them exactly as WM does: text and characters raw, `-3` (not
SML's `~3`), reals as JavaScript writes them (`0.30000000000000004`, `1e+21`), `void`,
tuples, lists, records with sorted labels, `Some`/`None` and `Ok`/`Err`. `!`, `%`, real
`==`, template strings, carriers (`Result|a, b|`, `via`), records and record updates,
datatypes and pattern matching translate directly.

## What does not, yet

The reader accepts a profile of WM. These are rejected with an error that names the place:

- JavaScript imports (`from js.module(...)`, `from js.global(...)`), and so `Task`, the JS
  FFI and the parts of the std library built on them. C FFI is likewise not translated.
- A function whose numeric type WM leaves generic, such as `(a, b) => { a + b }` used at
  both `Int32` and `Real64`: SML fixes one type per declaration. Annotate it.
- Names starting with `_`, which SML reserves.
- `print` of a value whose type is partly undecided (`[None]`), or of your own datatypes:
  annotate, or print text you build.
- A record receiver whose record type no annotation or declaration fixes.
- Some newer surface forms (for example point-free function sections).

Imports must be relative `.wm` paths or `basis/` modules. Use the `basis/` modules
(`basis/string.wm`, `basis/list.wm`, ...) for library functions; the std modules that wrap
JavaScript are not available natively.
