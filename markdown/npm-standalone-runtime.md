# npm as the default path: a self-contained `wm` binary

Status: steps 1, 3 and 4 implemented 2026-11-18; step 2 deferred; steps 5 and 6 pending. Goal: `npx @goodpuppies/workman run app.wm` (and an npm-installed `wm`)
does everything the JSR/source install does, with no separate Deno installation.

## Where the npm build falls short today

The npm package ships `deno compile` binaries of `src/release_cli.ts`, which embed the full Deno
runtime. `release_cli.ts` rejects `run`, `watch`, `repl`, `pakman`, `problems`, `sml`, `test` and
`--executable` because they all spawn `Deno.execPath()` as a Deno CLI (`deno run -A out.js`), and
in a compiled binary `execPath()` is the wm binary itself:

| Spawn site | Purpose |
| --- | --- |
| `src/run.ts:58` | `wm run`: run the compiled entry |
| `src/repl.ts:86`, `:371` | REPL phrase evaluation, file-watch REPL |
| `src/project_commands.ts:120`, `:207` | `pak.wm` commands, `Wm` steps |
| `src/pakman.ts:68`, `:89` | pakman entry points |
| `src/problems.ts:171` | the problems viewer's LSP process |
| `src/sml_target.ts:111` | `wm sml` with the JavaScript SubsetML reader |
| `src/executable.ts:54` | `--executable` runs `deno compile` |

JS/TS reflection (`src/ffi/reflect/host.ts`) also calls an external `deno` (`WORKMAN_DENO_PATH` or
`deno` on `PATH`): `deno types` for the Deno declarations and `deno info` for module graphs of
`npm:`/`jsr:`/remote specifiers.

## What a compiled binary can run (measured with Deno 2.9.8)

A `deno compile -A` binary that does `await import(fileUrl)` on a path given at runtime:

| Imported module | Result |
| --- | --- |
| Local `.js` files written after compilation, with relative imports | works |
| `Deno.dlopen` / FFI | works (compile with the unstable flags) |
| ESM package by file path (`./node_modules/nanoid/index.js`) | works |
| CommonJS package via `createRequire(import.meta.url)("left-pad")` | works, with Node resolution |
| `npm:left-pad@1.3.0` | fails: "Could not find constraint" |
| bare `left-pad` with `node_modules` present | fails: "not a dependency" |
| `jsr:@std/assert@1` | fails: "Module not found" |
| CommonJS package imported by file path | fails: no CJS interop, no default export |
| bare import mapped by `deno.json` `imports` (to a file or to `npm:`) | fails: "not a dependency" |
| `package.json` `"imports"` (`#name`) into `node_modules` | fails: the spec forbids such targets |

The binary does not read the project's `deno.json` or `package.json` when it runs a program.

So the binary can be the runtime, provided wm itself resolves package imports.

## Plan

1. **Self-execution instead of `Deno.execPath()` as a CLI.** Add a hidden runner mode to the
   binary's entry: when started with a reserved environment variable naming a module, it imports
   that module (with `Deno.args` set to the program arguments) instead of running the CLI. Each
   spawn site above goes through one helper that builds either `deno run -A ... file.js` (source
   install, `execPath()` is Deno) or the self-exec form (compiled binary). The child-process
   structure of run/watch/repl/test stays as is, so isolation and Ctrl-C behavior don't change.
   Compile the binary with `--unstable-webgpu` (the only flag `runtime_flags.ts` adds per program).

2. **wm resolves package imports at compile time.** wm reads the project's `deno.json`
   `imports` and `package.json` `dependencies` and applies them itself, since the runtime will
   not. A bare specifier, directly or through a `deno.json` entry (including entries that point
   at `npm:name@range`), resolves with Node resolution against `node_modules` (package `exports`
   with conditions `deno`, `node`, `import`, `default`). wm emits a relative file URL for ESM
   packages and a `createRequire` load for CommonJS ones. A missing package is a compile error
   suggesting `npm install name`. Inline `npm:`/`jsr:` specifiers in `.wm` sources are no longer
   supported; JSR packages come through npm's mirror `@jsr/scope__name`. Remote `https:`
   imports are rejected. The source install uses the same resolution instead of passing
   `--config` to `deno run`, so a program resolves identically under both installs.
   Shipped `std`/`host`/tooling code uses no `npm:`/`jsr:` specifiers; 7 example files do and
   move to `deno.json`/`package.json` dependencies.

3. **Reflection through tsc only.** Take the Deno declarations from npm's `@types/deno` (2.7.0 on
   2026-11-18, behind the 2.9.8 runtime, so 2.8/2.9 APIs are missing until it catches up), and
   replace `deno info` with TypeScript's own module resolution
   over `node_modules`, using the same specifier mapping as step 2, so reflection and runtime
   agree on which file a specifier means.

4. **`--executable` is not supported by the npm build.** It needs Deno's own `compile`
   toolchain. The npm build reports that clearly; the JSR/source install keeps it.

5. **Docs and default path.** README install becomes `npm install -g @goodpuppies/workman` and
   hello world `npx @goodpuppies/workman run hello.wm`; JSR stays documented as an alternative.
   Remove the limitation note from the npm package README and `docs/releases.md`.
   `package.json`'s version (0.7.0) is behind `deno.json`; `release:version` fixes it.

6. **Tests.** Extend `scripts/release_smoke.mjs` so the packed install, with Deno absent from
   `PATH`, runs: `wm run` on a program importing an ESM and a CJS package from `node_modules`, a
   `jsr:` package via `@jsr/`, a C FFI call, `wm repl 'expr;'`, `wm test`, `wm sml` (JS reader),
   and reflection of an npm package's types.

## Decisions

- 2026-11-18: inline `npm:`/`jsr:` specifiers go; dependencies come from `deno.json`/`package.json`
  and `node_modules`, resolved by wm under both installs.
- 2026-11-18: the npm build does not support `--executable`.
- 2026-11-18: Deno declarations for reflection are generated by `deno types` into
  `src/generated/assets.ts`, not taken from `@types/deno`: that package was at 2.7.0 against the
  2.9.8 runtime and declared `UnsafeWindowSurface.getContext("webgpu")` as never null, and it omits
  the WebGPU and current ECMAScript libraries `deno types` references.
- 2026-11-18: the binary embeds `@types/node` (with `undici-types`) for `node:` reflection, found
  under `node_modules/.deno/@types+node@<version>/` because `deno compile` cannot include the
  `node_modules/@types/node` link.
- 2026-11-18: step 2 is deferred; it needs more design. Until then the npm build does not
  support package imports (bare, `npm:`, `jsr:`, remote), and the JSR/source install resolves
  them through Deno as before. Step 3 therefore only replaces `deno types`; `deno info` serves
  exactly the specifiers the npm build rejects.
