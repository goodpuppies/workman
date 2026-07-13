<img src="editors/vscode/workman.png" alt="Workman" width="200" align="left"/>

This is the repository for the **Workman** (.wm) programming language toolchain, it has the compiler and lsp/editor tooling.

Workman is a truly simple functional programming language for application, server-side and game programming with direct access to the JS/TS ecosystem trough the deno runtime(bring all your favourite libraries from npm).

So let's get right into the hello world! Here are the steps:

- install [Deno🦕](https://deno.com/)
- create a hello.wm
```ts
// as you can see workman syntax looks a lot like js
let main = () => {
  print("arf~")
};
```
- run the program `deno x -A jsr:@goodpuppies/workman run hello.wm`

## Install
To install the wm cli simply run
```
deno install -g -A --name wm jsr:@goodpuppies/workman
```

## Language Features

An SML based core with all the fp goodies:
- Hindley-Milner type inference, to lessen type annotation
- lambdas `() => {}` and explicit currying
- a pipe operator `:>`
- highly expressive pattern matching with `match ()`
- Immutable Records `{}` and Tuples `()`
- expressions oriented programming
- Result and Option to improve errors and nullability
- ADT's/Tagged Unions
- simple modules
----
Besides just fp Workman also has:
- TSC reflection based ffi so you can simply import typescript without shims or annotation in 80% of the cases
- a great lsp experience
- a wthought out typescript like syntax with very little invariance
- great errors with a lot of debug info

## Lsp/editor extension

is available for [vscode](https://marketplace.visualstudio.com/items?itemName=goodpuppies.workman)

## Documentation

* To get up to speed quickly, see [the syntax guide](https://github.com/goodpuppies/workman/blob/main/docs/wm-minisyntaxguide.md). It is short and the best way to learn the language
* see [the docs folder](https://github.com/goodpuppies/workman/tree/main/docs)
* and [examples](https://github.com/goodpuppies/workman/tree/main/examples)

## Development

For local development, the repository installer remains available:

```sh
deno task install
wm run examples/factorial.wm
```

The installer writes a small launcher into `~/.local/bin` on Unix-like systems, or `~/.deno/bin` on
Windows. On Unix it also adds the launcher directory to `PATH` for Bash, Zsh, and Fish. You can
override the launcher directory with `--bin-dir`:

```sh
deno task install --bin-dir /path/to/bin
```

Pass `--no-modify-path` if your shell environment manages `PATH` elsewhere. Open a new shell after
installation for the updated `PATH` to take effect.
