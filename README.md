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
for fresher versions, you can add the argument
`--min-dep-age=0`

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
- a thought out typescript like syntax with very little invariance
- great errors with a lot of debug info

## Editors and tools

The [VS Code extension](https://marketplace.visualstudio.com/items?itemName=goodpuppies.workman)
gives you the language server; other editors can start it with `wm lsp`
(see [`editors`](https://github.com/goodpuppies/workman/blob/main/editors/README.md)). The `wm` command also has:

- `wm repl` and `wm watch` for interactive sessions and re-running on save ([REPL guide](https://github.com/goodpuppies/workman/blob/main/docs/repl.md))
- `wm compile hello.wm --executable -o hello` for standalone executables
- `wm test`, `wm problems` and `wm pakman` ([command-line tools](https://github.com/goodpuppies/workman/blob/main/docs/cli.md))
- `wm sml` to compile a program to Standard ML for MLton ([SML target](https://github.com/goodpuppies/workman/blob/main/docs/sml-target.md))

## Documentation

* Start with [the syntax guide](https://github.com/goodpuppies/workman/blob/main/docs/syntax-guide.md). It is short and the best way to learn the language.
* [JavaScript FFI](https://github.com/goodpuppies/workman/blob/main/docs/jsffi.md) and [C interoperability](https://github.com/goodpuppies/workman/blob/main/docs/cffi.md), with simple HTTP servers under `examples/server/`
* [Vite and Bun integration](https://github.com/goodpuppies/workman/blob/main/docs/bundlers.md) and the experimental [TypeScript content mapper](https://github.com/goodpuppies/workman/blob/main/docs/content-mapper.md)
* everything else is in [the docs folder](https://github.com/goodpuppies/workman/tree/main/docs), and there are [examples](https://github.com/goodpuppies/workman/tree/main/examples)

## Development

See [developing Workman](https://github.com/goodpuppies/workman/blob/main/docs/development.md) for building from source, the shared SubsetML Basis
and compiler modules written in Workman, and [release preparation](https://github.com/goodpuppies/workman/blob/main/docs/releases.md).
