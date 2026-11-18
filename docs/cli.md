# Command-line tools

Besides `wm run`, the `wm` command builds executables, runs tests, lists diagnostics and
manages packages. The interactive session and watch mode are described in
[the REPL guide](./repl.md).

## Standalone executables

Building an executable needs the Deno installation of wm
(`deno install -g -A --name wm jsr:@goodpuppies/workman`); the npm package cannot run Deno's
compile toolchain.

```sh
wm compile hello.wm --executable -o hello
./hello
```

WM emits JavaScript and generated workers, then invokes Deno's `compile`.
The executable includes those modules and its Deno runtime; it needs no WM
launcher. Deno may download its compilation runtime and imports during the
build. Like `wm run`, the resulting application runs with full Deno permissions.
`wm compile hello.wm out.js` still emits JavaScript.

## Editors and diagnostics

The language server runs over stdio with `wm lsp`. Editor-specific configuration lives under
[`editors`](../editors/README.md).

Use `wm problems entrypoint.wm` for a terminal diagnostics list in editors without a problems
panel. The viewer is written in Workman and gets its snapshot from an independent LSP process.
Press `e`, `w`, `i`, or `h` to toggle error, warning, information, or hint diagnostics; `a` restores
all severities. It watches the entrypoint directory recursively and refreshes when `.wm` files are
saved.

## Tests

`wm test` runs the tests in `*.test.wm` files, in the style of `deno test`. Its framework,
[`tooling/testman`](../tooling/testman/README.md), is a proposal and may be redesigned.

## Packages

`wm pakman` is a package manager written in Workman, where every package is a small program
that acts as the version manager for one piece of software. See
[`tooling/pakman`](../tooling/pakman/README.md).
