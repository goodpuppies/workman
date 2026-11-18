# The REPL and watch mode

Run `wm` or `wm repl` for an interactive session. The prompt is a multi-line text box: move around it with
the arrow keys, Home/End, and Ctrl+Left/Right, and paste multi-line code freely. Failed inputs leave
the accepted bindings unchanged. Imports resolve from the directory you started `wm repl` in, so
`from "./lib.wm" import *;` imports `lib.wm` there.

Pass code as one quoted argument to evaluate it, print its results, and exit:

```sh
wm repl 'let answer = 40; answer + 2;'
```

Use `preload` to evaluate code before opening the interactive prompt. Imports and bindings remain
available in that session, and imports resolve from the working directory:

```sh
wm repl preload 'from "./repl.wm" import *;'
```

An argument ending in `.wm` retains file watch mode: `wm repl scratch.wm`. Both code forms also
accept `--v2`. One-shot code exits with a nonzero status if a phrase fails; preload reports failures
and continues to the prompt, retaining successful phrases.

A session starts with SML's usual top-level structures available without imports: `OS.Process`,
`OS.Path`, `Bool`, `Char`, `Int` and `StringCvt`, alongside `Io` for files and `Text` for Unicode
text, plus the preloaded `List`, `String`, `Option` and the rest. These are ordinary imports in the
session's module, so a later import of the same name shadows them.

Calling `quit()` ends the session, like Ctrl-D on an empty input. It is available only in `wm repl` sessions, never returns,
and can be called anywhere, as in `if (done) { quit() } else { 42 };`. Your own `let quit = ...`
replaces it.

## Keys

| Key                      | Action                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------- |
| Enter                    | Run the input if it ends with a top-level `;` and the cursor is on its last line; otherwise add a new line |
| Shift+Enter or Alt+Enter | Jump to the end, add the missing `;`, and press Enter                                   |
| Ctrl+Enter or Ctrl+J     | Always add a new line                                                                   |
| Up/Down                  | Move between lines; past the first or last line, recall earlier input                   |
| Ctrl-C                   | Discard the current input; exit if it is empty                                          |
| Ctrl-D                   | Exit if the input is empty                                                              |
| Ctrl-L                   | Clear the screen                                                                        |

Typing `(`, `[`, `{`, `"`, `'`, or a backtick also adds its closing character, and typing that
character steps over it. Backspace removes an empty pair, and Enter opens one onto its own lines. Nothing is
paired in front of a word, inside a string, or in a comment, and `'` after a name stays part of the
name, as in `x'`.

Shift+Enter needs a terminal with the kitty keyboard protocol, such as Ghostty, kitty, WezTerm, foot,
Alacritty, or iTerm2. Other terminals send it as a plain Enter, so use Alt+Enter there. While a
recalled input is unedited, Up/Down keep walking history; press any other movement key to edit it.

## Commands

Commands start with `:`, and any unambiguous prefix works, so `:t` is `:type`. A command that takes
an expression ends with `;` like any other input, since an expression can always continue on the next
line. Other commands run on Enter:

| Command               | Action                                                            |
| --------------------- | ----------------------------------------------------------------- |
| `:help [command]`     | List the commands and keys, or show the details of one command    |
| `:type <expression>;` | Show an expression's type without running it or changing bindings |

## Configuration

To change the prompt, add a `repl` section to `~/.config/workman/config.json`
(`$XDG_CONFIG_HOME/workman/config.json`; `%APPDATA%\workman\config.json` on Windows):

```json
{
  "repl": {
    "name": "wm",
    "prompt": "> ",
    "continuation": "| ",
    "highlight": true
  }
}
```

`prompt` starts a new input and defaults to `- `, and `continuation` starts its later lines and
defaults to `= `. `name` goes in front of `prompt` and is empty by default, so this example shows
`wm> `. The strings are used exactly as written, so include any space you want before your input;
`"prompt": ":_"` puts your text straight after it. The shorter prompt is padded on the left so lines
stay aligned.

`highlight` colors your input as you type, using your terminal's color theme. It is on by default;
set it to `false` to turn it off. `NO_COLOR` also turns it off. Piped input ignores all of these
settings.

## History

Interactive input history is shared across sessions and saved as `repl-history.json` in Workman's
state directory (`$XDG_STATE_HOME/workman`, defaulting to `~/.local/state/workman` on Unix;
`%LOCALAPPDATA%\workman` on Windows). It keeps the most recent 1,000 inputs, including failed
inputs. Delete that file to clear saved history. Piped input is not saved.

## Re-running a file on save

For a live top-level evaluation loop, use `wm repl <file.wm>`. The file is evaluated immediately and
again whenever it is saved; unlike `wm run`, it does not require a `main` function:

```workman
let answer = 1 + 1;
```

Running `wm repl answer.wm` displays `answer = 2 : Real64.Real`. A bare top-level expression is bound to
`it`, following the SML top-level convention.

To run a normal program on every save, use `wm watch <file.wm>`. Workman watches the complete
reachable module graph and refreshes that set after every change, so editing a direct or transitive
`.wm` dependency restarts the program too:

```sh
wm watch app.wm -- arg1 arg2
```

`wm run`, `wm watch` and `wm repl` write the compiled JavaScript to the OS temporary directory, never
beside your sources, and remove it when they finish, including after Ctrl-C. The program still runs
with the `deno.json` nearest to the source, so its import map and npm settings apply.
