# 0.5.0 release plan

Status: 2026-10-24. Steps 1 to 5 are done in the working trees (wm-mini and `~/git/pak`); the
release checklist is next. Nothing is tagged or published for 0.5.0.

0.5.0 collects the breaking changes since 0.4.3 (23 commits on `i32-integers`, which is ahead
of `main` with nothing behind) and makes `"pakman/"` the only way a package recipe reaches
pakman. The release routine itself is [RELEASE.md](RELEASE.md).

## Breaking changes since 0.4.3

- **Integers.** `I32` is a checked signed 32-bit integer type. SubsetML reads bare Workman
  integer literals as `int`, so translated code and frontend-v3 use `I32`.
- **Library layout.** The SubsetML Basis is the WM Basis, imported as `"basis/…"`; std modules
  are imported as `"std/…"`. std's Result, Option, List and ListPair are built on the Basis,
  with renames such as `Option.withDefault` → `getOr`.
- **WON.** WON is the Basis module `SubsetWon`. Text values are their UTF-8 bytes
  (`Text of char list`); `Won.textString` and `SubsetText` convert to and from host text.
- **pakman formats.** The package protocol is WON, protocol 11. The lock, generations, the
  applier's ownership record and plan file, and dependency graph snapshots are WON files. Store
  hashes cover WON text, so every store path changes and every package rebuilds. There is no
  migration code: existing JSON state must be converted by hand.
- **pakman finders.** `ReleaseOptions.ref` returns `Option<String>`; `None` drops the release.
- **pakman configuration.** WM user configuration and `pakman add-dir`.

Non-breaking but worth noting: self tail calls through known function wrappers, inferred
record types shown after record literals, and structural equality without recursion (long
lists no longer overflow the stack).

## `"pakman/"` without hacks

### Today

- `src/pakman_imports.ts` maps `"pakman/x.wm"` to the file `tooling/pakman/src/x.wm` beside the
  compiler source. `src/module_graph.ts` and pakman's fingerprinting in `tooling/pakman/src/host.ts`
  each call it, outside `libraryImport`, which handles `"std/"` and `"basis/"`.
- Any file in `tooling/pakman/src/` is importable, including manager internals such as
  `store.wm` and `io.wm`. There is no public recipe API.
- In `~/git/pak`, 17 recipes import pakman by relative path
  (`../../../wm-mini/tooling/pakman/src/model.wm`, `package.wm`, `finders.wm`, `io.wm`), which
  only works with `pak` checked out beside `wm-mini`. Only `deno` uses `"pakman/…"`.
- 8 recipes import pakman's `host.ts` directly with `js.module(...)`, mostly for `captures` and
  `capturesAll`; zig also uses `jsonKeys`, `jsonField` and `jsonTextOr`.
- 4 recipes, such as `emacs`, are written for `pakman-subsetml` and are out of scope here.

### Embedded library primitives

std's `js/` primitives are embedded in the compiler (`libraryJsSources`) and emitted as
`data:` module URLs. Checked on Deno 2.9.8:

| Embedded module | Result |
|---|---|
| TypeScript as `data:application/typescript` or `text/typescript` | works, including `node:` imports |
| TypeScript as `data:text/javascript` (what is emitted today) | syntax error on type annotations |
| Any module with a relative import | fails: relative URL with a cannot-be-a-base base |

So an embedded primitive may be TypeScript, but must be self-contained: only absolute imports
such as `node:`, `jsr:` or `https:`. pakman's `host.ts` cannot be embedded as is: it imports
compiler sources by relative path and holds the manager's store, build and extraction code.

### Steps

1. **Compiler: TypeScript library primitives (done).** `scripts/generate_assets.ts` also embeds
   `.ts` files from a library's `js/` directory, and `libraryModuleUrl` picks the `data:` media
   type from the extension. `tests/library_discovery_test.ts` loads a TypeScript and a JavaScript
   primitive through it.
2. **A `pakman/` library directory (done)**, embedded like `std/`, with:
   - the recipe API: `model.wm`, `package.wm`, `finders.wm`, and one module for the helpers
     recipes now take from `host.ts` and `io.wm` (`captures`, `capturesAll`, `jsonKeys`,
     `jsonField`, `jsonTextOr`, `series`, `describe`);
   - the protocol and shared modules they need: `plan.wm`, `refs.wm`, `won.wm` (without file
     I/O), `text.wm`, `fun.wm`;
   - a small self-contained `js/recipe.ts` host: argv, print, exit, `fetchText`, `headInfo`,
     `captures`, the JSON helpers, `compareText`, `parseIntOr`.

   `"pakman/"` resolves through `libraryImport`; `src/pakman_imports.ts` is removed. Only files
   in the library exist, so manager internals are unreachable.

   Library naming was fixed first (see below), so the files need no prefix: `"pakman/model.wm"`
   is `pakman/model.wm`. `repository.wm` joined the library too, since repository-native recipes
   use it.

   **Cold start.** Inferring the pakman modules with the rest of the library took `wm check` on a
   hello program from 2.28 s to 2.80 s. They are now analyzed on demand: `loadStandardModules(true)`
   analyzes `pakman/` against the already-loaded library's results (so `std/` keeps one analysis
   and one set of type identities), and only for graphs that reach a `pakman/` module
   (`reachesOnDemandLibrary`). Cold start is back to 2.27 s.

   **Primitives without reflection.** JS import reflection can't see embedded `wm-library:`
   TypeScript, and std uses only `unsafe` primitive imports, so `pakman/` does the same. A
   primitive that can fail takes `ok`/`err` callbacks and settles with the Result they build, so
   `pakman/io.wm` gives `Task<_, String>` without `Js.Error`. The FFI checker rejects a `Result`
   returned from a synchronous JS call, so `jsonField` is `jsonHasField` plus a field read.

   **Library naming fix (done).** A library module's namespace alias came from its file's base
   name and was treated as global for every library directory. That caused two bugs:
   - An import-only module took on the members of a built-in structure with the same name, in
     the type checker only: with a module `text.wm`, `Lib.of(7)` type-checked against WM's `Text`
     and then failed at runtime.
   - Two library modules with the same base name, such as an import-only `list.wm` beside
     `std/list.wm`, stopped every program from compiling.

   Following the Definition, only auto-opened `std/` modules are bound in the basis by name, and
   only they extend a built-in structure (as `structure List = struct open List ... end` would,
   by modification `E + E'`). An import-only module is exactly what its file declares and is
   bound by its importer, so its emitted binding comes from its path
   (`__wm_lib_subml_basis_subset_won`), and name uniqueness is checked only among `std/` modules.

3. **The manager (done)** (`tooling/pakman`) imports the shared modules as `"pakman/…"`. Its own
   `host.ts` keeps file I/O, the store, builds, extraction and recipe compilation. Recipe
   fingerprinting no longer walks `"pakman/"` imports; the compiler version covers them.
4. **Recipes (done, uncommitted in `~/git/pak`)** import only `"pakman/…"`. Their `js.module` imports of pakman's
   `host.ts` become calls to the public helpers. Each recipe's `versions` and `make` are checked
   against the current lock. All 18 type-check and list versions, with locked versions present;
   `make` was not run, since that downloads and rebuilds every package.
5. **Docs (done).** pakman's README and DESIGN.md describe the recipe API and `"pakman/"`;
   `docs/modules.md` lists the namespace beside `"std/"` and `"basis/"`.

## Release checklist

Following [RELEASE.md](RELEASE.md):

- [ ] Commit the `"pakman/"` work and the recipe migration.
- [ ] Bring `main` up to the release branch (currently a fast-forward to `i32-integers`).
- [ ] Set 0.5.0 in `deno.json`, `editors/vscode/package.json` and the VS Code lockfile.
- [ ] `deno task publish` (local generation and VSIX only).
- [ ] `deno task test`, plus `wm test` for pakman and testman.
- [ ] `deno publish --dry-run` against the release contents.
- [ ] Release notes from "Breaking changes since 0.4.3", including converting pakman state.
- [ ] Present the release commit and proposed tag; push and tag only after confirmation.

## Open items

- Recipe compile fingerprints currently include mtimes of the compiler's `src/` and `std/`;
  after step 3 the compiler version (or the embedded asset hash) could replace them.
- `wm pakman list` stops at the first recipe that fails to compile. With `pakman-subsetml`
  recipes in the same directory this breaks the listing; leave as is for now.
- Prebuilt `src/generated/tuiman.js` and `problems_tui.js` still carry the old recursive
  equality helper until regenerated, which `deno task publish` does.
