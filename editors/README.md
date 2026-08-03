# Workman editor support

- `tree-sitter-workman` is a submodule containing the shared Tree-sitter grammar.
- `zed-workman` is a submodule containing the Zed extension.
- `vscode` remains in this repository for now and can be migrated later.
- [`helix`](./helix/README.md) and [`fresh`](./fresh/README.md) are lightweight editor configuration
  folders and remain part of this repository. Their READMEs contain installation and language-server
  setup instructions.

Clone all published editor repositories with:

```sh
git submodule update --init --recursive
```

The Helix query files belong under `runtime/queries/workman` in a Helix runtime. Use
`helix/languages.toml` as a user or workspace language configuration, then run `hx --grammar fetch`
and `hx --grammar build`.

Fresh and Helix launch the shared language server through `wm lsp`.
