# Experimental TypeScript content mapper

The repository includes a local content mapper for TypeScript **7.1.0-beta**. It lets a TypeScript
project import `.wm` modules with types inferred by Workman, without generating intermediate files
on disk.

The first implementation supports `Number`, `Bool`, `String`, `Void`, tuples, structural records,
functions, currying, and unconstrained polymorphic functions. Types come from wm's semantic
analysis; TypeScript does not infer them from a translated function body. wm syntax and type errors
are reported through the mapper, retaining independently valid declarations. Hover, signature help,
and emitted declarations preserve exported names and available source parameter names, including
tuple parameters and curried stages. Primed names use readable, collision-free TS spellings where a
local TS identifier is required.

## Try the example

From the repository root, with Deno and Node/npm available:

```sh
npm --prefix examples/content-mapper install --ignore-scripts
npm --prefix examples/content-mapper run check
```

The example pins the experimental compiler independently of wm's existing TypeScript 6 reflection
dependency. Its Workman dependency links to the repository root. The main `@goodpuppies/workman`
package launches Deno against this checkout; it is private while packaging is experimental.

[`consumer.ts`](../examples/content-mapper/consumer.ts) imports
[`math.wm`](../examples/content-mapper/math.wm). Remove an `@ts-expect-error` comment to see a
TypeScript error. Go to definition on a call to `double` should reach its wm declaration when using
a content-mapper-enabled TypeScript 7 language server. The native language server also observes
edits to open wm buffers. Automatic activation and registration through the wm VS Code extension are
not implemented yet; the existing wm language server continues to serve wm files.

### Live wm edits in Fresh

Fresh routes buffer changes by language: its wm server receives `.wm` edits, while its TS server
receives `.ts` edits. Configuring the native TS server alone does not share open wm buffers with it.
The optional `editors/fresh-typescript-sync` plugin and `src/content_mapper/typescript_lsp.ts`
adapter connect those update streams without replacing wm's language server.

Install the plugin from this checkout:

```sh
mkdir -p ~/.config/fresh/plugins/packages/workman-typescript-sync
cp editors/fresh-typescript-sync/package.json editors/fresh-typescript-sync/sync.ts \
  ~/.config/fresh/plugins/packages/workman-typescript-sync/
```

Configure Fresh's TypeScript LSP entry along these lines, using absolute paths for your checkout and
installed TypeScript 7.1 compiler:

```json
{
  "lsp": {
    "typescript": {
      "name": "workman-typescript",
      "command": "deno",
      "args": [
        "run",
        "-A",
        "--config",
        "/path/to/wm-mini/deno.json",
        "/path/to/wm-mini/src/content_mapper/typescript_lsp.ts",
        "--tsc",
        "/path/to/typescript/node_modules/.bin/tsc"
      ],
      "enabled": true,
      "auto_start": true,
      "root_markers": [
        "tsconfig.json",
        "jsconfig.json",
        "package.json",
        ".git"
      ],
      "initialization_options": { "runExternalCode": true }
    }
  },
  "plugins": { "workman-typescript-sync": { "enabled": true } }
}
```

The same entry can be used for `javascript`. Keep the existing wm LSP entry. Restart Fresh once
after installation. The plugin samples open wm buffers every 250 ms, including unsaved changes, and
compares their contents before sending a snapshot to the relevant TS/JS session. It does not depend
on edit hooks firing during restore, reload, save, or undo. Unchanged text does not trigger another
transform. Closing a buffer removes its overlay so TypeScript uses disk content again. The plugin
sends snapshots to the running TS/JS servers for open consumer buffers; those entries must launch
the adapter above. It deliberately does not use Fresh's plugin configuration snapshot to select a
server, because that snapshot can disagree with the live LSP manager in terminal mode. The adapter's
acknowledgement verifies delivery. Successful updates log `Workman TypeScript sync
acknowledged`;
failed requests are reported in Fresh's plugin log and retried.

The adapter exposes a single push diagnostic model to Fresh: it removes native pull-diagnostic
registration from its client-facing capabilities, pulls reports internally for open TS/JS consumers,
and publishes the actual results. Fresh stores pull and push diagnostics separately; advertising
both would leave old pull errors visible after the push report clears. Initial reports are fetched
on opening a consumer, and subsequent TS/JS or wm changes refresh them. Empty reports clear errors.
Reports from an older source revision or a closed consumer are discarded, and repeated changes
coalesce while a report is pending. Native diagnostic-refresh requests are handled inside the
adapter. Other TypeScript language-service capabilities remain available.

The adapter also shares the complete wm buffer snapshot with mapper processes through a private
session file. After a change, it invalidates mapped transforms through TypeScript's dynamic mapper
configuration. This refreshes inferred exports of dependent WM modules even when their own source
has not changed. The snapshot is replaced atomically, scoped to the TS session, and removed on
normal shutdown. Closing a wm buffer removes it from the shared analysis as well.

Native TS document notifications suffice for single-file modules. Unsaved cross-file analysis
requires this adapter's shared snapshots; other editor integrations need an equivalent bridge.

TypeScript requires `--runExternalCode` for CLI use. Editor clients must enable external mapper
execution through their TypeScript integration; the tested LSP initialization option is
`initializationOptions: { runExternalCode: true }`.

## WM modules

Imports, named aliases, `export from`, wildcard re-exports, and exported namespaces use Workman's
existing module graph and public environments. Plain imports remain private; sequential shadowing is
retained. Exported namespaces appear as nested readonly objects with their inferred members.
Function aliases preserve source parameter names through resolved WM binding identities.

Run the separate module example with:

```sh
npm --prefix examples/content-mapper run check:modules
```

For saved-file watching, configure the WM modules imported by TS as mapper entry points:

```json
{
  "package": "@goodpuppies/workman",
  "extensions": [".wm"],
  "options": { "entryPoints": ["src/public.wm"] }
}
```

Paths are relative to `tsconfig.json`. Workman's resolver discovers the transitive dependencies,
including files outside the TS project directory. Their contents form a configuration fingerprint;
when a watched file changes, TS reopens the mapper project and invalidates dependent projections.
List WM entry modules here because inferred projections need not contain TS imports of every WM
dependency. Without entry points, one-shot CLI checking works and Fresh's shared buffer snapshots
refresh unsaved dependencies, but closed dependency changes are not registered for watching. Changes
conservatively invalidate all projections in the mapper project; narrower invalidation and automatic
entry-point discovery remain future work. Creating a previously unresolved import may require
reopening/restarting the TS project to register its path.

The projection currently materializes inferred re-export signatures. Navigation through a re-export
to its original declaration is not implemented; it never maps dependency offsets into the importing
WM file. A value and structure sharing the same exported name produce an explicit unsupported
projection diagnostic, since TS has a single exported value namespace.

## Calling convention

The projection describes the current JavaScript library ABI. For this wm function:

```ts
let sum = (left: Number, right: Number) => left + right;
```

The TypeScript call is `sum(left, right)`. Library emission and the mapper share the same
argument-shape rule: the outer parameter tuple becomes positional JS arguments. Tuple components and
return values keep their tuple representation. For example, a WM function taking
`((Number, Number), Number)` is called as `fn([first, second], extra)`, and a tuple result remains
an array. Curried stages stay separate: `curried(first)(second)`.

This convention applies recursively to callbacks, function factories, and exported namespaces. A
callback typed `(Number, Number) -> Number` is a JS `(left, right) => number` callback. A generic
callback `T -> U` still receives one value; if `T` is a tuple, that value is an array. JS function
`.length` does not decide the convention.

Plain tuple-function exports use the emitted positional implementation directly. The emitter adapts
function-valued arguments and results when their representation changes, caches function adapters,
and recognizes round trips across separately compiled WM libraries. Container contents are converted
afresh so mutable JS inputs do not retain stale values. WM's internal generic entry continues to
accept one argument; eligible higher-order calls use its positional fast entry without allocating an
argument tuple.

This changes the public JS ABI of `compile-library` and
`compileLibraryFile`/`compileLibraryVirtual`. Rebuild generated libraries and update TS/JS callers
from `sum([left, right])` to `sum(left, right)`. The compiler API accepts `{ libraryAbi: "tuple" }`
for fixed legacy bootstrap transports; mapper declarations always describe the default positional
ABI.

## Current limits

- Nominal types, ADTs (including `Option`, `Result`, and `List`), exported type declarations,
  foreign types, and constrained polymorphism produce explicit unsupported projection errors. The
  mapper omits the affected exports rather than giving them `any`.
- Source mappings cover exported declarations. Internal wm expressions and references continue to
  use wm's language server. TS-generated rename, formatting, and code-action edits into wm are
  disabled. The effect-taint `!` metadata is not represented in TypeScript.
- This is a tooling projection, not executable output. TypeScript does not emit JavaScript for
  content-mapped files. Running the TS consumer still requires a separate build/loader integration
  for `.wm`. See [Vite and Bun integration](bundlers.md) for direct imports in those environments.
- TypeScript can emit declaration files, such as `math.d.wm.ts`, with `--declaration`; these
  describe the projection's supported exports. Declaration maps are not provided.

## Tests

Normal regression tests use wm's existing compiler dependency:

```sh
deno test --allow-read --allow-write --allow-run --allow-env --allow-sys=homedir tests/content_mapper_test.ts
```

Native TypeScript 7 integration tests are opt-in and skip when `WM_CONTENT_MAPPER_TSC` is unset:

```sh
WM_CONTENT_MAPPER_TSC="$PWD/examples/content-mapper/node_modules/.bin/tsc" \
  deno test --allow-read --allow-write --allow-run --allow-env --allow-sys=homedir \
  tests/content_mapper_typescript7_test.ts
```

These check CLI import resolution, positive and negative type checks, wm diagnostics, declaration
emission, navigation to wm source, and propagation of repeated unsaved wm changes to a TS consumer,
both directly and through the Fresh adapter. Multi-file tests cover transitive inference, re-export
aliases, namespace access, buffer closing, and saved-file invalidation.
`tests/content_mapper_sync_test.ts` additionally checks buffer lifecycle, deduplication, URI
encoding, and resampling when edit hooks are absent.

To test the actual Fresh plugin runtime and hover delivery, set `WM_CONTENT_MAPPER_FRESH` as well:

```sh
WM_CONTENT_MAPPER_FRESH="$(command -v fresh)" \
WM_CONTENT_MAPPER_TSC="$PWD/examples/content-mapper/node_modules/.bin/tsc" \
  deno test --allow-read --allow-write --allow-run --allow-env --allow-sys=homedir \
  tests/content_mapper_fresh_test.ts
```

This starts separate Fresh instances with temporary settings and scratch files, edits their wm
buffer repeatedly through a three-module dependency chain, and checks function hover, the inferred
TS consumer binding, and Fresh's displayed diagnostics through the real editor plugin API. It begins
with an existing error, checks that it is not duplicated, and requires errors to clear and reappear
without reopening or editing the TS consumer. It covers the web backend and, on Linux with `script`
installed, terminal/server mode with a private PTY, wm LSP enabled, and autosave enabled. It
requires local IPC socket access; it does not attach to the user's running editor.

## Source updates and editor integration

TypeScript owns source invalidation. The mapper receives current source text through `transform`; it
has no callback for pushing a source-file refresh into TypeScript. Normal document changes must
reach the TypeScript session through the editor's LSP integration. For cross-file WM inference, our
dynamic configuration also depends on shared buffer snapshots and entry-point dependency contents.
`openProject` returns their fingerprint and watch paths so TypeScript can invalidate cached
projections when those additional inputs change.

VS Code's native TypeScript integration provides `registerContentMappers` for registering foreign
extensions such as `.wm`. The Workman VS Code extension does not register this yet. Fresh's adapter
is an editor-specific way to share wm buffers with its separate TypeScript process.

There is also a reported
[TypeScript 7.1 beta disk-change diagnostic refresh bug](https://github.com/microsoft/TypeScript/issues/64943)
affecting mapped extensions, including in VS Code. That report concerns diagnostic refreshes; it
should not be used to explain stale hover without checking document synchronization first.

Protocol reference:
[TypeScript content mappers](https://github.com/microsoft/typescript-go/pull/4712).
