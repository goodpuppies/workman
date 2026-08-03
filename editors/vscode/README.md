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

## Generated frontend

The language server always uses the generated frontend-v2 runtime included in the repository and
extension package. To reproduce it from the Workman sources:

```sh
deno task frontend-v2:build
```

By default the server loads `src/generated/frontend_v2_parser.js` from the checkout that contains
`src/lsp/server.ts`. To point at another generated artifact, set:

```json
{
  "workman.frontendV2ModulePath": "/absolute/path/to/frontend-v2.generated.mjs"
}
```

This is a real semantic frontend mode, not a structural sidecar: frontend v2 is the parser feeding
module loading, typechecking diagnostics, and hover. Generated Surface-to-compiler lowering matches
Peggy semantic fields and source spans across every valid `.wm` file under `std`, `examples`, and
`tooling`.

Frontend v2 renders committed missing `;`, `{`, and `}` marks as structural inlay hints. Other
malformed input receives the generated parser's farthest-failure diagnostic; the retired
transitional `_`/`?` hole projection is not part of this mode. Disable structural hints independently
with `workman.structuralInlayHints.enabled` and restart the language server.
