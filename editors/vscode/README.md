# Workman VS Code Extension

Small VS Code client for Workman. The Marketplace package includes one portable JavaScript language
server bundle that runs on VS Code's built-in Node runtime, so the same small VSIX supports Linux,
Windows, and macOS on every architecture supported by VS Code. When a Workman checkout is open, the
extension deliberately prefers its Deno source server so frontend and LSP changes are picked up by
running `Workman: Restart Language Server`.

The packaged server does not need Deno for ordinary Workman files. JavaScript/TypeScript FFI
reflection still uses the `deno` executable configured by `workman.denoPath` (default: `deno`).

Extension builds use the Go-native TypeScript 7 compiler. The bundled FFI reflector intentionally
uses the separately named TypeScript 6 compatibility API because TypeScript 7.0 has no programmatic
compiler API; migrate reflection when the new API arrives in TypeScript 7.1 rather than silently
falling back from `tsc` 7 during builds.

## Language features

- Module-aware diagnostics and inferred-type hover, including unsaved Workman files.
- Go to Definition/Ctrl+Click for local bindings, types, constructors, and named, wildcard, or
  namespace imports.
- Find All References across the active module graph and other open Workman documents.
- Document symbols for the Outline and Go to Symbol views.
- Automatic cleanup and dependent revalidation when `.wm` files are deleted, renamed, or moved.

The server is launched with `--allow-read --allow-env --allow-run`. Environment access is needed
because the language server uses TypeScript's compiler API for JS FFI type reflection. Run access is
needed when reflecting the Deno global namespace, which mounts `deno types` as the source of Deno's
own declarations.

## Development

```sh
npm install
npm run compile
```

Open this folder as a VS Code extension development host, or package it later as a VSIX. The
included `Run Workman Extension` launch config opens the repository root as the test workspace.

## Marketplace package

Create the universal VSIX from this directory:

```sh
npm run package
```

This bundles the extension client and language server with esbuild and writes
`dist/goodpuppies.workman-<version>.vsix`. The package contains no native runtime or platform-specific
binary; the current bundle is about 1.8 MiB including TypeScript's standard-library declarations
for FFI reflection. Upload that file through the
[Visual Studio Marketplace publisher portal](https://marketplace.visualstudio.com/manage/publishers/).

By default the extension looks for `src/lsp/server.ts` in the open workspace. If you install the
extension once and edit `.wm` files from another workspace, set:

```json
{
  "workman.serverPath": "/absolute/path/to/workman/src/lsp/server.ts"
}
```

Then updates to the Workman checkout usually only need `Workman: Restart Language Server`.

## Frontend v2 migration mode

The extension can launch the current TypeScript language server in the subset-limited frontend-v2
mode:

```json
{
  "workman.frontendMode": "v2"
}
```

Before using this mode, build the generated frontend artifact from the Workman checkout:

```sh
deno task frontend-v2:build
```

By default the server loads `tooling/frontend-v2/frontend-v2.generated.mjs` from the checkout that
contains `src/lsp/server.ts`. To point at another generated artifact, set:

```json
{
  "workman.frontendV2ModulePath": "/absolute/path/to/frontend-v2.generated.mjs"
}
```

This is a real semantic frontend mode, not a structural sidecar: frontend v2 is the parser feeding
module loading, typechecking diagnostics, and hover for the supported subset. The mode currently
supports the first migration slice only: named Workman imports, top-level non-grouped `let`
bindings, simple patterns, variables/literals/`void`, parenthesized single expressions, simple
calls, tuple expressions, open and namespace imports, qualified values such as `Lib.value`, and the
type annotations used by those fixtures. Simple lambdas, result-only blocks, and whitespace
application such as `print value` are also supported.

Frontend v2 also renders the structural document's virtual syntax as inlay hints. Missing or
implicit `_`, `?`, `()`, delimiters, commas, and semicolons remain separate ordered tokens, including
recovery-only structure. They describe the program currently interpreted by the editor; they are
not automatic source edits. Disable this projection independently with
`workman.structuralInlayHints.enabled` and restart the language server.

Unsupported syntax is expected while the migration slice is incomplete. In v2 mode unsupported
declarations or expressions should report frontend-v2 diagnostics instead of silently falling back to
Peggy/v1 typechecking. Full declaration, expression, pattern, type, and JavaScript-FFI AST coverage
is still intentionally incomplete while v2 remains an opt-in migration mode.
