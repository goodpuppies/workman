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

Go to Definition (F12 in VS Code) follows reflected JavaScript imports to their
TypeScript declarations, including named and aliased imports from modules,
`js.global("Deno")`, and DOM globals. Deno's virtual declarations are saved on
demand under Workman's cache (`workman/typescript/deno-<content hash>.d.ts`) so
editors can open them as ordinary files. The text matches the Deno executable
used for reflection. Overloaded functions navigate to their declaration;
this does not require running the imported JavaScript.
