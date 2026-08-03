# Workman support for Fresh

This directory is a local [Fresh](https://github.com/sinelaw/fresh) language pack. It provides
syntax highlighting for `.wm` files, two-space indentation, Workman comment settings, and Workman
LSP integration.

## Prerequisites

- Fresh 0.4.6 or newer
- `deno` available on `PATH`
- The `wm` command installed and available on `PATH`:

  ```sh
  deno install -g -A --name wm jsr:@goodpuppies/workman
  ```

## Install from this checkout

1. Open Fresh.
2. Open the command palette with `Ctrl+P`, then type `>`.
3. Run `pkg: Install from URL`.
4. Enter this language-pack directory:

   ```text
   /home/ellie/git/wm-mini/editors/fresh
   ```

5. Restart Fresh, then open a `.wm` file.

After the parent repository changes are published, the pack can also be installed directly from the
Workman monorepo:

```text
https://github.com/goodpuppies/workman#editors/fresh
```

Fresh installs language packs under `~/.config/fresh/grammars/`.

## Configure the language server

[`package.json`](./package.json) starts the Workman language server with:

```sh
wm lsp
```

When Fresh opens the Workman workspace, choose **Trust folder & Allow Tooling** so it may launch the
language server. The pack enables structural inlay hints through the server's initialization
options.

## Troubleshooting

- Confirm the launcher is visible to Fresh with `wm --version`.
- Run `Show Warnings` from the command palette to find grammar-loading errors.
- Run `fresh --show-paths` to display the active configuration and log paths.
- Inspect the Fresh LSP logs if highlighting works but language features do not.
