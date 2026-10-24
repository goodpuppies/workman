# 0.5.0 release plan

Status: planning, 2026-10-24. Nothing is committed, tagged or published for 0.5.0.

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

1. **Compiler: TypeScript library primitives.** `scripts/generate_assets.ts` also embeds `.ts`
   files from a library's `js/` directory, and `runtimeJsModuleSpecifier` picks the `data:` media
   type from the extension. Add a test that runs an embedded `.ts` primitive.
2. **A `pakman/` library directory**, embedded like `std/`, with:
   - the recipe API: `model.wm`, `package.wm`, `finders.wm`, and one module for the helpers
     recipes now take from `host.ts` and `io.wm` (`captures`, `capturesAll`, `jsonKeys`,
     `jsonField`, `jsonTextOr`, `series`, `describe`);
   - the protocol and shared modules they need: `plan.wm`, `refs.wm`, `won.wm` (without file
     I/O), `text.wm`, `fun.wm`;
   - a small self-contained `js/recipe.ts` host: argv, print, exit, `fetchText`, `headInfo`,
     `captures`, the JSON helpers, `compareText`, `parseIntOr`.

   `"pakman/"` resolves through `libraryImport`; `src/pakman_imports.ts` is removed. Only files
   in the library exist, so manager internals are unreachable.
3. **The manager** (`tooling/pakman`) imports the shared modules as `"pakman/…"`. Its own
   `host.ts` keeps file I/O, the store, builds, extraction and recipe compilation. Recipe
   fingerprinting no longer walks `"pakman/"` imports; the compiler version covers them.
4. **Recipes** in `~/git/pak` import only `"pakman/…"`. Their `js.module` imports of pakman's
   `host.ts` become calls to the public helpers. Each recipe's `versions` and `make` are checked
   against the current lock.
5. **Docs.** pakman's README and DESIGN.md describe the recipe API and `"pakman/"`;
   `docs/modules.md` lists the namespace beside `"std/"` and `"basis/"`.

## Release checklist

Following [RELEASE.md](RELEASE.md):

- [ ] Land the `"pakman/"` work and the recipe migration.
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
