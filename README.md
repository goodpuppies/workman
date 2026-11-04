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

## Standalone executables

```sh
wm compile hello.wm --executable -o hello
./hello
```

WM emits JavaScript and generated workers, then invokes Deno's `compile`.
The executable includes those modules and its Deno runtime; it needs no WM
launcher. Deno may download its compilation runtime and imports during the
build. Like `wm run`, the resulting application runs with full Deno permissions.
`wm compile hello.wm out.js` still emits JavaScript.

## C interoperability

C header imports (`c.header`) use a bundled Aro extractor on Linux, macOS, and
Windows for x64 and ARM64; users do not need Zig. The compiler and LSP unpack the
matching binary with its resource headers and licenses on first use. System C
headers/SDKs are still required where included by your header. See
[C header reflection](markdown/c_ffi/reflection-extractor.md) for configuration
and the [extractor's beta limits](tooling/c-header-extractor/README.md).

JS members allow name-rooted dots (`response.ok`, `response.json()`). Members of
computed expressions use explicit pipes (`"hello" :> .length`, `makeResponse() :> .ok`).
Both use the same safe FFI inference; see [member access](markdown/js-member-access.md).

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

## Lsp/editor extension

is available for [vscode](https://marketplace.visualstudio.com/items?itemName=goodpuppies.workman)

Install the Workman CLI with Deno:

```sh
deno install -g -A --name wm jsr:@goodpuppies/workman
```

Editors can start the language server over stdio with `wm lsp`. Editor-specific
configuration lives under [`editors`](./editors/README.md).

Use `wm problems entrypoint.wm` for a terminal diagnostics list in editors without a problems
panel. The viewer is written in Workman and gets its snapshot from an independent LSP process.
Press `e`, `w`, `i`, or `h` to toggle error, warning, information, or hint diagnostics; `a` restores
all severities. It watches the entrypoint directory recursively and refreshes when `.wm` files are
saved.

`wm test` runs the tests in `*.test.wm` files, in the style of `deno test`. Its framework,
[`tooling/testman`](tooling/testman/README.md), is a proposal and may be redesigned.

`wm pakman` is a package manager written in Workman, where every package is a small program
that acts as the version manager for one piece of software. See
[`tooling/pakman`](tooling/pakman/README.md).

## Developing the shared Basis

The portable library comes from the pinned [SubsetML](subm/SubsetML) submodule.
To build its compiler and regenerate Workman's checked-in library snapshot, install
MLton and run from this repository root:

```sh
git submodule update --init subm/SubsetML
make -C subm/SubsetML
deno run -A scripts/sync_subml_basis.ts
```

Edit the owning SubsetML `.sml` sources rather than generated `subml-basis/*.wm`
files. Ordinary Workman use loads the checked-in snapshot and needs no SubsetML
build. See [library ownership and workflow](markdown/subsetml-basis.md).

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

Run `wm` or `wm repl` for an interactive session. The prompt is a multi-line text box: move around it with
the arrow keys, Home/End, and Ctrl+Left/Right, and paste multi-line code freely. Failed inputs leave
the accepted bindings unchanged.

| Key                      | Action                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------- |
| Enter                    | Run the input if it ends with a top-level `;` and the cursor is on its last line; otherwise add a new line |
| Shift+Enter or Alt+Enter | Jump to the end, add the missing `;`, and press Enter                                   |
| Ctrl+Enter or Ctrl+J     | Always add a new line                                                                   |
| Up/Down                  | Move between lines; past the first or last line, recall earlier input                   |
| Ctrl-C                   | Discard the current input; exit if it is empty                                          |
| Ctrl-D                   | Exit if the input is empty                                                              |
| Ctrl-L                   | Clear the screen                                                                        |

Typing `(`, `[`, `{`, `"`, or a backtick also adds its closing character, and typing that character
steps over it. Backspace removes an empty pair, and Enter opens one onto its own lines. Nothing is
paired in front of a word, inside a string, or in a comment, and `'` never pairs because it also
starts type variables like `'a`.

Calling `quit()` also ends the session. It is available only in `wm repl` sessions, never returns,
and can be called anywhere, as in `if (done) { quit() } else { 42 };`. Your own `let quit = ...`
replaces it.

Shift+Enter needs a terminal with the kitty keyboard protocol, such as Ghostty, kitty, WezTerm, foot,
Alacritty, or iTerm2. Other terminals send it as a plain Enter, so use Alt+Enter there. While a
recalled input is unedited, Up/Down keep walking history; press any other movement key to edit it.

Commands start with `:`, and any unambiguous prefix works, so `:t` is `:type`. A command that takes
an expression ends with `;` like any other input, since an expression can always continue on the next
line. Other commands run on Enter:

| Command               | Action                                                            |
| --------------------- | ----------------------------------------------------------------- |
| `:help [command]`     | List the commands and keys, or show the details of one command    |
| `:type <expression>;` | Show an expression's type without running it or changing bindings |

To change the prompt, add a `repl` section to `~/.config/workman/config.json`
(`$XDG_CONFIG_HOME/workman/config.json`; `%APPDATA%\workman\config.json` on Windows):

```json
{
  "repl": {
    "name": "wm",
    "prompt": "> ",
    "continuation": "| "
  }
}
```

`prompt` starts a new input and defaults to `- `, and `continuation` starts its later lines and
defaults to `= `. `name` goes in front of `prompt` and is empty by default, so this example shows
`wm> `. The strings are used exactly as written, so include any space you want before your input;
`"prompt": ":_"` puts your text straight after it. The shorter prompt is padded on the left so lines
stay aligned. Piped input always uses the defaults.

Interactive input history is shared across sessions and saved as `repl-history.json` in Workman's
state directory (`$XDG_STATE_HOME/workman`, defaulting to `~/.local/state/workman` on Unix;
`%LOCALAPPDATA%\workman` on Windows). It keeps the most recent 1,000 inputs, including failed
inputs. Delete that file to clear saved history. Piped input is not saved.

For a live top-level evaluation loop, use `wm repl <file.wm>`. The file is evaluated immediately and
again whenever it is saved; unlike `wm run`, it does not require a `main` function:

```workman
let answer = 1 + 1;
```

Running `wm repl answer.wm` displays `answer = 2 : Number`. A bare top-level expression is bound to
`it`, following the SML top-level convention.

To run a normal program on every save, use `wm watch <file.wm>`. Workman watches the complete
reachable module graph and refreshes that set after every change, so editing a direct or transitive
`.wm` dependency restarts the program too:

```sh
wm watch app.wm -- arg1 arg2
```

The installer writes a small launcher into `~/.local/bin` on Unix-like systems, or `~/.deno/bin` on
Windows. On Unix it also adds the launcher directory to `PATH` for Bash, Zsh, and Fish. You can
override the launcher directory with `--bin-dir`:

```sh
deno task install --bin-dir /path/to/bin
```

Pass `--no-modify-path` if your shell environment manages `PATH` elsewhere. Open a new shell after
installation for the updated `PATH` to take effect.

The source installer records the absolute path of the Deno executable that runs it, so its
launcher also works in shells where Deno is absent from `PATH`. Reinstall the launcher if
that executable moves. Launchers generated by `deno install -g` are managed by Deno and
may still require `deno` on `PATH`; use `deno task install --force` from a source checkout
to replace an existing `wm` launcher with the source installer's version.

C interop is documented in [docs/cffi.md](docs/cffi.md), including simple
Windows and Unix HTTP servers under `examples/server/`.
