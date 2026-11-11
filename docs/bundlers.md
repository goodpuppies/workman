# Vite and Bun integration

The experimental main `@goodpuppies/workman` package provides runtime compilation adapters in
addition to its TypeScript content mapper. Install/link Workman as a development dependency.

From a source checkout, Deno must be available on PATH during compilation; the adapters launch the
compiler using its own `deno.json`. `{ denoPath: "/absolute/path/to/deno" }` overrides that
executable. The [staged npm release](releases.md) instead resolves its installed platform binary and
accepts a `compilerPath` override. Pure-WM compilation through that binary does not need external
Deno.

## Vite

```ts
import { defineConfig } from "vite";
import { workman } from "@goodpuppies/workman/vite";

export default defineConfig({ plugins: [workman()] });
```

TS/JS files can import `.wm` files directly. The plugin compiles each imported WM entry as a JS
library using the positional JS ABI. It registers the compiler's transitive WM graph with Vite's
watcher. Changes invalidate the compiled entry in each Vite environment, so an SSR import observes
updated code without a process restart. Explicit `?raw` and `?url` imports are left to Vite.

The adapter is tested with Vite 8, including its environment-specific `hotUpdate` API. It returns no
source map yet. Type checking and editor support still come from the content mapper configured in
`tsconfig.json`; Vite's plugin supplies executable output.

For TanStack Start, import WM inside a `createServerFn().handler(...)` callback. TanStack removes
the handler body from the client build and creates the HTTP RPC bridge. The server imports the
compiled WM library. The integration itself is environment-neutral; the framework's server-only
boundary determines where WM runs.

`../ssrtan` demonstrates SSR loader data and a browser form calling a WM-backed server function. Its
browser tests exercise the actual HTTP RPC in development and with the production Bun server. The
production client assets are checked for WM runtime markers separately from the server bundle.

## Bun

For direct runtime imports, preload the plugin before loading the entry module:

```ts
// preload.ts
import { plugin } from "bun";
import { workman } from "@goodpuppies/workman/bun";
plugin(workman());
```

```sh
bun --preload ./preload.ts ./server.ts
```

For a Bun bundle:

```ts
import { workman } from "@goodpuppies/workman/bun";
await Bun.build({ entrypoints: ["./server.ts"], target: "bun", plugins: [workman()] });
```

The source-checkout adapter uses Deno to compile WM; the npm release adapter uses its platform
binary. Bun executes/bundles the generated JS. Generated pure-WM JS does not need the compiler at
runtime. Transitive dependency watching is implemented for Vite; Bun's standalone watch/hot reload
behavior is not guaranteed by this adapter yet.

## Current bounds

Each WM import compiles its complete WM module graph into one library entry. Importing multiple WM
roots can duplicate shared dependency code and state. A persistent compiler process, shared
cross-entry module instances, source maps, and broader foreign-module/asset integration remain
future work. These adapters are initially exercised with pure WM modules and their dependencies.

## Integration tests

```sh
WM_BUN="$(command -v bun)" \
WM_VITE_ENTRY="/absolute/path/to/vite/dist/node/index.js" \
  deno test --allow-read --allow-write --allow-run --allow-env --allow-sys=homedir \
  tests/bundler_integration_test.ts
```

The tests create temporary WM projects, exercise Bun runtime imports and bundles, and edit an
imported dependency under a temporary Vite SSR server. They skip when the tooling paths are unset.
