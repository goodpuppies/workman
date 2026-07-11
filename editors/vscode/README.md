# Workman VS Code Extension

Small VS Code client for Workman. The Marketplace package includes a compiled language server for
Linux x64/ARM64, Windows x64, and macOS x64/ARM64, so it works without a local Workman checkout.
When a Workman checkout is open, the extension deliberately prefers its Deno source server so
frontend and LSP changes are picked up by running `Workman: Restart Language Server`.

The packaged server does not need Deno for ordinary Workman files. JavaScript/TypeScript FFI
reflection still uses the `deno` executable configured by `workman.denoPath` (default: `deno`).

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

This compiles one LSP binary for each supported desktop platform and writes
`dist/goodpuppies.workman-<version>.vsix`. Upload that file through the
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
calls, and the type annotations used by those fixtures.

Unsupported syntax is expected while the migration slice is incomplete. In v2 mode unsupported
declarations or expressions should report frontend-v2 diagnostics instead of silently falling back to
Peggy/v1 typechecking. Wildcard imports, namespace-qualified references such as `Lib.value`, tuple
expressions, and full AST coverage are intentionally outside the first editor gate unless a gate
fixture later proves one of them is necessary.
