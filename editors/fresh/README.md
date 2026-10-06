# Workman support for Fresh

This directory is a [Fresh](https://github.com/sinelaw/fresh) language pack. It provides
syntax highlighting for `.wm` files, two-space indentation, Workman comment settings, and Workman
LSP integration. Highlighting includes character literals, primed identifiers, nested block
comments, numeric exponents, Unicode escapes, and string gaps. LSP hover shows `unannotated:`
when removing a binding’s annotations infers a different type.

## Prerequisites

- Fresh 0.4.6 or newer
- `deno` available on `PATH`
- The `wm` command installed and available on `PATH`:

  ```sh
  deno install -g -A --name wm jsr:@goodpuppies/workman
  ```

C header reflection uses the native binaries bundled with the `wm` toolchain
on Linux, macOS and Windows for x64/ARM64. Fresh needs no separate Zig installation.
System C headers/SDKs are still needed; see the
[extractor docs](../../tooling/c-header-extractor/README.md) for beta limitations.

## Install and update from the repository

Use Fresh **0.5.2 or newer** for reliable in-editor updates of monorepo packages.
That release fixed updates for language packs installed from repository subpaths
and local directories; see the [Fresh release notes](https://github.com/sinelaw/fresh/releases/tag/v0.5.2).

1. Open the command palette with `Ctrl+P`, then type `>`.
2. Run `Package: Install from URL`.
3. Enter:

   ```text
   https://github.com/goodpuppies/workman#editors/fresh
   ```

4. Open a `.wm` file. Restart Fresh if it does not pick up the language pack.

To update later, run `Package: Update` and select `workman`, or use its Update
button in `Package: Packages`. `Package: Update All` also includes language packs.
Fresh remembers the complete repository URL, including `#editors/fresh`, and
re-fetches that directory. These updates follow the repository's default branch.

If the pack was originally installed from a local checkout, install once from
the repository URL above to switch its update source. Local-source updates copy
from the original local directory instead of fetching GitHub.

The language pack provides highlighting and editor settings; the `wm` compiler
and LSP are installed separately. Updating the pack does not upgrade `wm`. Update
the toolchain with:

```sh
deno install -g -A --force --name wm jsr:@goodpuppies/workman
```

## Install from this checkout

For development, use `Package: Install from URL` with the full path to this
directory, for example `/home/ellie/git/wm-mini/editors/fresh`. Reinstall from that
path or use `Package: Update` to copy subsequent local changes.

## Registry listing

Direct repository installation and updates work without a registry entry or a
separate plugin repository. To make Workman discoverable in Fresh's package
browser, add a `workman` entry to `languages.json` in the
[official registry](https://github.com/sinelaw/fresh-plugins-registry). The entry's
repository URL can use the same `#editors/fresh` subpath, as existing language
packs do. Its `latest_version` should track this pack's `package.json` version so
Fresh can show when a registry version is newer. See Fresh's
[language-pack publishing guide](https://getfresh.dev/docs/plugins/development/language-packs#publishing).

Fresh installs language packs under `~/.config/fresh/languages/packages/`.

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
- Run `fresh --cmd config paths` to display the active configuration and log paths.
- Inspect the Fresh LSP logs if highlighting works but language features do not.
