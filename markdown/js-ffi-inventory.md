# WM JavaScript FFI usage inventory

Snapshot: 2026-10-30, WM revision `1d8f1d521d37`. This inventories current
usage to help choose portable library APIs and small host boundaries.

The largest concentrations are byte/vector and numeric primitives in std,
string/array and HTTP operations in examples, and JS array/list conversion plus
binary/terminal APIs in tooling. Explicit receiver access alone misses named
imports, constructors, JSON literals, and ordinary-looking dotted host members.

## Scope and counting

Run the inventory again with:

```sh
deno run -A scripts/inventory_js_ffi.ts > /tmp/wm-js-ffi-inventory.json
```

The [scanner](../scripts/inventory_js_ffi.ts) uses the production parser, counts
AST sites, skips comments/string contents, and deduplicates source locations
repeated in statement metadata. It reads Git-tracked `.wm` sources plus current
untracked examples. The JSON contains complete imports, imported member names,
receiver sites, dotted-reference candidates, locations, and ranked summaries.

- **340 files scanned; 338 parsed.** No type-checking or execution is required.
- **Sites** are source occurrences, not execution frequency or distinct runtime functions.
- Import counts are declarations; binding counts count named members across those declarations.
  Namespace imports do not enumerate every available member. Type-only imports are separate.
- Receiver calls/gets are raw `FfiCall`/`FfiGet` syntax, including `:> .member`.
  A multi-segment path such as `.headers.get(...)` counts as one authored access.
- Dotted references are classified using imported roots and known WM namespaces.
  This is syntax attribution; nested shadowing and receiver types are not resolved.
  Unresolved dotted names are retained separately, never added to the JS rankings.
- Generated shared Basis files and generated tooling remain visible in separate
  areas or in tooling totals. `subm/SubsetML`, ignored scratch/build trees, TS test
  strings and the internals of imported npm packages are outside the WM scan.
- The two tracked files under `markdown/` and `tests/` are parsed too, but omitted
  from the main area table below. Untracked root `scratch.wm` is excluded.

Working-tree-only examples: `examples/raylib2.wm` (parses; uses a C header), and
`examples/server/won.wm` (does not parse). C imports are excluded from JS import
counts; the raylib JS-wrapper examples remain included.

## Coverage by area

| Area | Parsed / files | Runtime JS imports | Type-only JS imports | Receiver calls | Receiver gets |
| --- | --- | --- | --- | --- | --- |
| std | 36/36 | 27 | 0 | 0 | 0 |
| examples | 74/76 | 77 | 8 | 118 | 17 |
| tooling | 186/186 | 58 | 3 | 91 | 13 |
| host/js | 4/4 | 4 | 0 | 0 | 0 |
| pakman | 10/10 | 4 | 0 | 5 | 0 |
| shared Basis (generated) | 26/26 | 6 | 0 | 0 | 1 |

Std has **27 runtime import declarations, all unsafe, across 25 of its 36 modules**,
with **200 named binding occurrences**. There are no direct receiver call/get
sites in std. Its other JS dependencies include built-in array bridges and a
WM import of a host adapter, described below.

Examples have runtime imports in 28 files and receiver syntax in 12 files.
Tooling has runtime imports in 32 files and receiver syntax in 25 files.

## Std: explicit imports

| Target | Declarations | Files | Named bindings | Example |
| --- | --- | --- | --- | --- |
| `std/js/byte_vector.js` | 13 | 13 | 73 | [std/byte.wm:1](../std/byte.wm#L1) |
| `std/js/word.js` | 4 | 4 | 56 | [std/word16.wm:1](../std/word16.wm#L1) |
| `Math` | 3 | 3 | 23 | [std/math.wm:3](../std/math.wm#L3) |
| `std/js/float.js` | 2 | 2 | 14 | [std/float32.wm:1](../std/float32.wm#L1) |
| `std/js/vector.js` | 2 | 2 | 17 | [std/vector.wm:3](../std/vector.wm#L3) |
| `Number` | 1 | 1 | 4 | [std/real.wm:10](../std/real.wm#L10) |
| `std/js/real.js` | 1 | 1 | 7 | [std/real.wm:16](../std/real.wm#L16) |
| `std/js/task.js` | 1 | 1 | 6 | [std/task.wm:2](../std/task.wm#L2) |

The 23 local-wrapper imports account for 173 binding occurrences; direct
`Math`/`Number` imports account for the other 4 declarations and 27 bindings.
These are implementation helper names, not 200 distinct JS runtime requirements.

Direct globals currently expose:

- `Math` in `math.wm`: `PI`, `E`, roots, powers/logarithms, trigonometric and
  hyperbolic functions. `number.wm` imports `floor`; `real.wm` imports `abs`,
  `floor`, `ceil`, `trunc`, and `pow`.
- `Number` in `real.wm`: `MAX_VALUE`, `MIN_VALUE`, `isFinite`, and `isNaN`.

Most-referenced imported std bindings (calls and first-class references):

| Name / access path | Sites | Files | Example |
| --- | --- | --- | --- |
| `std/js/vector.js.uncheckedSub` | 17 | 2 | [std/vector.wm:40](../std/vector.wm#L40) |
| `Number.isNaN` | 16 | 1 | [std/real.wm:51](../std/real.wm#L51) |
| `std/js/byte_vector.js.length` | 16 | 12 | [std/pack_real32_big.wm:15](../std/pack_real32_big.wm#L15) |
| `std/js/byte_vector.js.sliceLength` | 14 | 11 | [std/pack_real32_big.wm:23](../std/pack_real32_big.wm#L23) |
| `std/js/vector.js.length` | 13 | 2 | [std/vector.wm:36](../std/vector.wm#L36) |
| `std/js/vector.js.sliceBase` | 11 | 1 | [std/vector_slice.wm:20](../std/vector_slice.wm#L20) |
| `std/js/byte_vector.js.pack` | 10 | 10 | [std/pack_real32_big.wm:30](../std/pack_real32_big.wm#L30) |
| `std/js/byte_vector.js.packSubSlice` | 10 | 10 | [std/pack_real32_big.wm:24](../std/pack_real32_big.wm#L24) |

### What std's JS wrappers actually use

This table is a source review of `std/js/`, not another set of WM occurrence counts.
It identifies the host capabilities hidden behind the imported helper names.

| Wrapper | Existing host mechanisms | Role |
| --- | --- | --- |
| [byte_vector.js](../std/js/byte_vector.js) | `Uint8Array`, `DataView`, array iteration/copying, `Symbol.for`, `Object.freeze`, numeric bounds checks | Byte vectors/slices, endian word/float packing, byte/string conversion. |
| [word.js](../std/js/word.js) | JS integer/bitwise operators, `Math.imul`, flooring division, `BigInt` and `asIntN`/`asUintN`, safe-integer checks | Word8/16/32/64 representation and arithmetic. |
| [vector.js](../std/js/vector.js) | JS arrays, `Array.from`, indexing/copying, `Symbol.for`, `Object.freeze` | Immutable vector/slice representation and construction. |
| [float.js](../std/js/float.js) | `Math.fround` and numeric arithmetic | Float32 rounding and arithmetic; Float64 operations. |
| [real.js](../std/js/real.js) | `DataView`/`ArrayBuffer`, byte/64-bit bit access, `Number` classification, `Math` operations | Sign bits, signed zero/NaN, exponent decomposition, adjacent representable values and ties-to-even rounding. |
| [task.js](../std/js/task.js) | `Promise.resolve`, `.then`, `Promise.all`, `Promise.race`, promise construction | Async scheduling/sequencing. Result inspection remains WM code. |

The wrapper source mixes representation access with algorithms such as validation,
rounding and arithmetic. This inventory does not classify every helper as a
necessary primitive; that needs the same necessity/performance review as SubsetML.

## Examples: imports, construction and receivers

Most common import targets:

| Name / access path | Sites | Files | Example |
| --- | --- | --- | --- |
| `globalThis` | 23 | 18 | [examples/basicworker/main.wm:7](../examples/basicworker/main.wm#L7) |
| `Deno` | 11 | 10 | [examples/enterprise/hello.wm:3](../examples/enterprise/hello.wm#L3) |
| `raylib` | 6 | 6 | [examples/asteroids/main.wm:1](../examples/asteroids/main.wm#L1) |
| `Reflect` | 5 | 5 | [examples/basicworker/main.wm:8](../examples/basicworker/main.wm#L8) |
| `console` | 4 | 4 | [examples/fsstream.wm:2](../examples/fsstream.wm#L2) |
| `Math` | 3 | 3 | [examples/node-gotchi.wm:7](../examples/node-gotchi.wm#L7) |
| `Deno.UnsafePointer` | 2 | 2 | [examples/enterprise/writev.wm:37](../examples/enterprise/writev.wm#L37) |
| `GPUBufferUsage` | 2 | 2 | [examples/webgpu_compute.wm:27](../examples/webgpu_compute.wm#L27) |
| `JSON` | 2 | 2 | [examples/weather.wm:26](../examples/weather.wm#L26) |
| `./worker.wm` | 1 | 1 | [examples/basicworker/main.wm:6](../examples/basicworker/main.wm#L6) |

`globalThis` is the grouped spelling of `from js.global import { ... }`. Its
most commonly imported value is `Uint8Array` (7 declarations in 7 files); `fetch`,
`URL`, and `Number` each appear in 3 import declarations. Additional imports cover
`crypto.subtle`, worker artifacts, npm CLI packages, WebGPU, and local TS adapters.

Constructor-style dotted calls and named bindings also matter. Examples contain
8 `Uint8Array.new` references in 6 files, 4 `Response.new` in 2, and 3 each of
`TextEncoder.new` and `URL.new`. `fetch` has 4 expression references in 3 files.
These are imported-root references rather than `:> .member` sites.

Most common explicit receiver calls:

| Name / access path | Sites | Files | Example |
| --- | --- | --- | --- |
| `toString` | 10 | 4 | [examples/github_repos.wm:35](../examples/github_repos.wm#L35) |
| `at` | 6 | 3 | [examples/github_repos.wm:19](../examples/github_repos.wm#L19) |
| `join` | 6 | 3 | [examples/github_repos.wm:66](../examples/github_repos.wm#L66) |
| `getInt32` | 5 | 2 | [examples/enterprise/writev.wm:150](../examples/enterprise/writev.wm#L150) |
| `slice` | 4 | 2 | [examples/task_via.wm:23](../examples/task_via.wm#L23) |
| `destroy` | 3 | 1 | [examples/wmslang_window/src/webgpu_present.wm:456](../examples/wmslang_window/src/webgpu_present.wm#L456) |
| `filter` | 3 | 1 | [examples/weather.wm:225](../examples/weather.wm#L225) |
| `json` | 3 | 3 | [examples/github_repos.wm:41](../examples/github_repos.wm#L41) |
| `map` | 3 | 2 | [examples/github_repos.wm:73](../examples/github_repos.wm#L73) |
| `on` | 3 | 1 | [examples/fsstream.wm:9](../examples/fsstream.wm#L9) |
| `addEventListener` | 2 | 2 | [examples/basicworker/main.wm:12](../examples/basicworker/main.wm#L12) |
| `beginRenderPass` | 2 | 1 | [examples/wmslang_window/src/webgpu_present.wm:206](../examples/wmslang_window/src/webgpu_present.wm#L206) |

Most common receiver properties:

| Name / access path | Sites | Files | Example |
| --- | --- | --- | --- |
| `length` | 7 | 4 | [examples/enterprise/writev.wm:85](../examples/enterprise/writev.wm#L85) |
| `ok` | 2 | 2 | [examples/github_repos.wm:31](../examples/github_repos.wm#L31) |
| `queue` | 2 | 1 | [examples/wmslang_window/src/webgpu_present.wm:224](../examples/wmslang_window/src/webgpu_present.wm#L224) |
| `status` | 2 | 2 | [examples/github_repos.wm:34](../examples/github_repos.wm#L34) |
| `method` | 1 | 1 | [examples/webhook.wm:144](../examples/webhook.wm#L144) |
| `pathname` | 1 | 1 | [examples/webhook.wm:147](../examples/webhook.wm#L147) |
| `signal` | 1 | 1 | [examples/webhook.wm:191](../examples/webhook.wm#L191) |
| `url` | 1 | 1 | [examples/webhook.wm:145](../examples/webhook.wm#L145) |

The longer tail includes `encode`, `padStart`, `includes`, `subarray`,
`headers.get`, `text`, `sign`, `postMessage`, `terminate`, WebGPU device/queue/
command methods, and pointer-view reads. The same member name can belong to
several receiver types; for example `toString` is not classified solely as a
string method.

The raylib JS wrapper has a large named-namespace surface: `raylib.H.DrawText`
has 17 references in 6 files, `raylib.IsKeyDown` 15 in 3, and
`raylib.H.DrawCircle` 13 in 3. Those calls are JS-module integration, even though
the underlying service is native graphics. Direct `c.header(...)` examples are
kept out of the JS-import totals.

### Ordinary dotted host access

These manually checked examples show why receiver syntax is only part of the picture:

| Authored form | Host receiver / operation | Source |
| --- | --- | --- |
| `req.method`, `req.url` | Reflected `Request` properties | [ffi_reflection_tools.wm:30](../examples/ffi_reflection_tools.wm#L30) |
| `url.host`, `url.searchParams.get("q")` | URL properties and search parameters | [ffi_reflection_tools.wm:33](../examples/ffi_reflection_tools.wm#L33) |
| `req.headers.get("content-type")` | Headers lookup | [ffi_reflection_tools.wm:35](../examples/ffi_reflection_tools.wm#L35) |
| `date.toISOString()` | Date method following `Date.new()` | [server.wm:17](../examples/server.wm#L17) |

The scanner retains **1,311 unresolved dotted sites in examples**. This includes
many WM records and shader operations, so treating that number as JS FFI would
be misleading. The table above is a verified sample, not an exhaustive semantic
classification of that bucket.

## Tooling: binary data, strings and runtime services

Leading explicit import targets:

| Name / access path | Sites | Files | Example |
| --- | --- | --- | --- |
| `node:buffer` | 9 | 9 | [tooling/tuiman/array-probe.wm:1](../tooling/tuiman/array-probe.wm#L1) |
| `tooling/pakman/src/host.ts` | 8 | 6 | [tooling/pakman/src/install.wm:16](../tooling/pakman/src/install.wm#L16) |
| `Math` | 5 | 5 | [tooling/tuiman/geometry.wm:4](../tooling/tuiman/geometry.wm#L4) |
| `String` | 5 | 5 | [tooling/frontend-v3/tools/reader_debug.wm:4](../tooling/frontend-v3/tools/reader_debug.wm#L4) |
| `Deno` | 4 | 4 | [tooling/frontend-v3/tools/lex.wm:3](../tooling/frontend-v3/tools/lex.wm#L3) |
| `node:zlib` | 4 | 4 | [tooling/tuiman/buffer-api-probe.wm:2](../tooling/tuiman/buffer-api-probe.wm#L2) |
| `globalThis` | 3 | 3 | [tooling/tuiman/kitty.wm:9](../tooling/tuiman/kitty.wm#L9) |
| `jsr:@img/png@0.1.6` | 2 | 2 | [tooling/tuiman/jsr-png-probe.wm:1](../tooling/tuiman/jsr-png-probe.wm#L1) |
| `process` | 2 | 2 | [tooling/tuiman/runtime.wm:13](../tooling/tuiman/runtime.wm#L13) |

These include diagnostic probes and test support under tooling, not just shipped
application entry points. Buffer usage is especially concentrated in terminal/
PNG experiments and rendering helpers. Imported-binding references include
`Buffer.from` (14 in 9 files), `Buffer.alloc` (6 in 4), and
`String.fromCharCode` (7 in 5).

Leading receiver calls:

| Name / access path | Sites | Files | Example |
| --- | --- | --- | --- |
| `readUInt8` | 15 | 4 | [tooling/tuiman/copy-probe.wm:4](../tooling/tuiman/copy-probe.wm#L4) |
| `slice` | 14 | 7 | [tooling/frontend-v3/tools/lex.wm:14](../tooling/frontend-v3/tools/lex.wm#L14) |
| `readUInt32BE` | 10 | 4 | [tooling/tuiman/kitty.wm:264](../tooling/tuiman/kitty.wm#L264) |
| `setRawMode` | 5 | 2 | [tooling/tuiman/runtime.wm:54](../tooling/tuiman/runtime.wm#L54) |
| `copy` | 4 | 2 | [tooling/tuiman/array-probe.wm:13](../tooling/tuiman/array-probe.wm#L13) |
| `split` | 4 | 3 | [tooling/pakman/src/apply.wm:79](../tooling/pakman/src/apply.wm#L79) |
| `startsWith` | 4 | 3 | [tooling/pakman/src/apply.wm:81](../tooling/pakman/src/apply.wm#L81) |
| `toString` | 4 | 4 | [tooling/tuiman/array-probe.wm:19](../tooling/tuiman/array-probe.wm#L19) |
| `endsWith` | 3 | 1 | [tooling/tuiman/kitty.wm:215](../tooling/tuiman/kitty.wm#L215) |
| `once` | 3 | 2 | [tooling/tuiman/runtime.wm:74](../tooling/tuiman/runtime.wm#L74) |

Receiver properties are mostly `.length` (12 sites in 9 files), with one `.path`.
Other recurring families include `split`, `startsWith`/`endsWith`, `indexOf`,
`repeat`, terminal raw-mode/input events, Deno I/O/environment access, compression,
and PNG decoding.

## Implicit runtime bridges and object construction

Built-in array/list conversion does not require an explicit JS import:

| Area | Js.Array.toList references | Js.Array.fromList references |
| --- | --- | --- |
| std | 3 | 3 |
| examples | 2 | 4 |
| tooling | 192 | 108 |
| pakman | 11 | 1 |

Tooling's 300 conversion references are largely in Wmslang's compiler and IR
modules; [compiler.wm](../tooling/wmslang/compiler.wm#L88) alone has 73 combined
`Js.*` expression sites, all array bridges. These are a substantial representation
boundary even where the surrounding algorithms are source code.

Std's six array-bridge references occur in `std/result.wm` and `std/task.wm`.
`Js.Error` and `Js.Unknown` expression references elsewhere are error constructors,
not additional imported JS functions. Type annotations such as `Js.Array<T>`
are not included in the expression-reference counts.

The parser also finds **73 JS object literals and 26 JS array literals in examples**,
and **5 objects / 1 array in tooling** (`JsonObject`/`JsonArray`, such as `JSON{...}`).
These construct host data without an import and should be considered alongside
method calls when designing a portable data boundary.

WM imports of explicit host-adapter modules include:

- [examples/weather.wm:31](../examples/weather.wm#L31) → `host/js/dict.wm`.
- [std/result.wm:2](../std/result.wm#L2) → `host/js/debug.wm`.
- [tooling/frontend-v2/compiled_probe_runtime.wm:8](../tooling/frontend-v2/compiled_probe_runtime.wm#L8) → `host/js/table.wm`.
- [tooling/frontend-v2/generated/compiled_probe_dispatch.wm:23](../tooling/frontend-v2/generated/compiled_probe_dispatch.wm#L23) → `host/js/table.wm`.

For example, `std/result.wm`'s error-display path reaches the JS debug adapter
through a WM import even though that std module has no `from js...` declaration.
Static imports do not imply that every function in a module executes that host path.

## Shared Basis host adapters

Keep the generated Basis separate from std: its JS import declarations occur in
`subset_text_host.wm` and `subset_host.wm`. The text adapter uses character-code
access, string construction, a receiver `.length` access, well-formedness testing,
and URI-codec-based UTF-8 representation conversion. The host adapter delegates
filesystem/process operations to `js/subset_host.js`.

These are the already-audited SubsetML host boundaries. The UTF-8 text bridge is
JS-specific conversion and identity on SML hosts; its presence in this WM inventory
does not create a new native SubsetML codec requirement. See the
[runtime dependency audit](../subm/SubsetML/docs/runtime-dependencies.md).
`std/string.wm` delegates byte conversion to this Basis rather than accessing JS
string members directly.

## Useful groupings for follow-up

For concrete candidates scoped to pakman, frontend v3 and tuiman, see
[Tooling portability candidates](tooling-portability-candidates.md).

| Family | Common existing uses | Question for portability work |
| --- | --- | --- |
| Collections and strings | List/JS-array bridges, length, slice, split/join, search, formatting | Which operations can use source APIs, and which are host representation conversion? Specify byte/text units and count types explicitly. |
| Numeric and binary representation | Math/Number, words, float precision, byte vectors, DataView/Buffer reads | Separate source algorithms from bit/representation primitives; preserve numeric and error contracts. |
| External runtime services | Promise scheduling, HTTP/fetch, files/env/process, terminal streams, workers | Keep explicit host interfaces with source-level orchestration. |
| Third-party/device integration | raylib JS wrappers, WebGPU, native pointers, npm UI libraries | Treat as target-specific integrations; usage frequency alone does not make an operation a portable Basis requirement. |

## Parse exclusions

These files were scanned but excluded from all AST usage counts:

- [examples/exercises/tree.wm](../examples/exercises/tree.wm): `ParseError: Expected : while parsing LambdaReturnAnnotation.`
- [examples/server/won.wm](../examples/server/won.wm): `ParseError: Expected => while parsing Lambda.`

Re-running after either file becomes parseable can change the totals. This report
adds inventory tooling and documentation only; it does not migrate any FFI use.
