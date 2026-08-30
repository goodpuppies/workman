# Workman support for Helix

This directory contains a Helix language definition and Tree-sitter queries for Workman
highlighting, indentation, and text objects.

Install the Workman CLI before enabling language-server support:

```sh
deno install -g -A --name wm jsr:@goodpuppies/workman
```

## Install the grammar and queries

Helix reads user language configuration from `~/.config/helix/languages.toml` and user queries from
`~/.config/helix/runtime/queries/`.

If you do not already have a user `languages.toml`, copy this one:

```sh
mkdir -p ~/.config/helix
cp /home/ellie/git/wm-mini/editors/helix/languages.toml \
  ~/.config/helix/languages.toml
```

If that file already exists, merge the `[[language]]` and `[[grammar]]` blocks from
[`languages.toml`](./languages.toml) into it instead of overwriting it.

Install the queries:

```sh
mkdir -p ~/.config/helix/runtime/queries/workman
cp /home/ellie/git/wm-mini/editors/helix/queries/workman/*.scm \
  ~/.config/helix/runtime/queries/workman/
```

Then fetch and build the pinned Workman grammar:

```sh
hx --grammar fetch
hx --grammar build
```

Opening a `.wm` file should now select Workman and enable syntax highlighting, indentation, and
comment/string text objects.

## Language server

The supplied `languages.toml` already configures the language server as:

```toml
[language-server.workman-lsp]
command = "wm"
args = ["lsp"]
```

Restart Helix and inspect the resulting setup with:

```sh
hx --health workman
```

If syntax highlighting is unavailable, rebuild the grammar. If LSP features are unavailable, confirm
that `wm --version` works in the environment used to start Helix.
