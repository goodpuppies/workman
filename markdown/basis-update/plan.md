# Plan

Stages are ordered by dependency. Stages A and B depend on no open design decision. Stage C's
open syntax question, type parameters on manual type imports, now only blocks D2. Stage E no longer
waits on any decision: the IO structures are deferred (BD10) and existing names are kept (BD9). The remaining open questions are listed in
[`../basis-design.md`](../basis-design.md#open-decisions).

Every stage keeps `deno task test` and the examples passing. A stage that changes source-visible
API migrates examples, docs and tests in the same change.

## Stage A: folders and discovery

Adding a `.wm` library module becomes adding a file.

- [x] **A1** Create `basis/` at the repository root (BD5). Leave `std/` where it is.
- [x] **A2** Change `scripts/generate_assets.ts` to walk `basis/` and `std/` and emit one map from
      library path to source (`librarySources`), instead of one named export per hard-coded file.
- [x] **A3** Replace the hard-coded `standardModules` list in `src/standard_library.ts` with
      discovery from that map (`discoverStandardModules`). Take the namespace alias from the
      snake_case file name (`libraryModuleAlias`, BD6).
- [x] **A4** Derive load order by topologically sorting library modules by their imports. Report a
      library import cycle, a missing library import, or two files defining the same namespace as
      an error that names the files.
- [x] **A5** No renames needed: aliases come from snake_case file names, so existing paths and
      path-based references (such as `src/lsp/unused_diagnostics.ts` looking up `std/result.wm`)
      stay valid.

**Gate:** adding a new file `std/example.wm` makes `Example.*` available to user code with no other
change than regenerating assets. `tests/library_discovery_test.ts` shows discovery, aliasing and
ordering for a new module, and the error cases.

## Stage B: one module graph

Library modules become ordinary modules in the program's module graph.

- [x] **B1** Characterize the current behavior first: regression tests for std datatype
      constructors in patterns and expressions (the `Binary.Bounds` reproduction), in
      `tests/library_discovery_test.ts`. Std values in closures and pipes and the runtime namespace
      objects are already covered by the existing suite.
- [x] **B2** Add library modules to the program's `ModuleGraph` as ordinary nodes
      (`withStandardLibrary`) for code generation: `analyzeCoreFile`, `coreVirtual` and the
      single-source `compile()` analyze program plus library in one pass. Library modules are
      placed after the program's modules, so program ids don't shift when the library changes.
      Emission doesn't depend on this order, because std modules are requested explicitly before
      the entry.
- [x] **B2b** The tooling analysis (`analyzeFile`, `analyzeRecoveredFile`) resolves its facts over
      the program plus the library modules (`ExtendGraph` in `program_analysis.ts`,
      `mergeLibraryGraph`), as compilation does, while the project snapshot, interfaces, `graph`
      and `results` still describe only the program's modules. This fixed a crash in the language
      service: any file matching a std constructor (`Binary.Bounds`) failed with "missing
      constructor ID for PCtor". Regression test in `tests/library_discovery_test.ts`.
- [x] **B3** Remove the separate standard core program in `src/compiler.ts` and
      `mergeStandardNominalFacts`, including its constructor-reference patching.
      `standardRuntimeGraph` remains as the provider of library graph nodes and of the namespace
      descriptions the emitter uses.
- [ ] **B4** Proposed to drop. A std value's identity (`standard-value:std/option.wm:map`) is an
      initial-environment identity, the same kind as `basis-value:print`. Program modules reach
      library namespaces through the initial basis, not through import edges, as SML's Basis
      structures are in the initial environment rather than imported. A `BindingId` would need
      the library namespaces to become implicit import edges of every program module. The string
      form is also stable across analyses, which the language service relies on
      (`tests/module_interface_test.ts`). The one path-keyed lookup, `Result.debug` in
      `src/lsp/unused_diagnostics.ts`, is stable because library paths are.
- [x] **B5** Close `issues/FIXED-std-namespace-adt-constructors-unusable.md`. The pattern case was fixed
      by B2. The expression case also needed an emitter fix: a qualified constructor with no local
      binding is emitted through its namespace export (`Binary.Bounds`), like a qualified value.
- [x] **B6** Measure cold start. `wm run` of a small program using `List.map`: about 590 ms both
      before stages A–B (HEAD `fb56ea6`) and after. No follow-up needed.

A core result's `graph` and `results` (`CoreFileResult`) describe the program's own modules
(`withoutStandardLibrary`). Library modules are in `core` and in the facts, not in the program
graph, so diagnostics such as `wm err` report only the program.

**Gate:** there is no std-specific branch in program assembly. Not yet met for emission: the emitter
still binds library namespaces (`standardNamespaces`), leaves out unused std modules, and merges
host members through `__wm_basis_<Alias>` objects. The host merge goes away in stage C; namespace
binding for modules in scope without an import stays.

## Stage C: primitives out of the compiler

A primitive becomes a `.wm` binding plus a real JavaScript file (BD7).

- [ ] **C1** Extend type-only imports with the manual form from BD8. Found during C3: the
      arity-0 manual form already works. `from js.module("./x.js") import type { Vec }` against a
      plain `.js` file elaborates to a nominal `ForeignTypeDecl` without reflection, and compiling
      it doesn't read the file. What remains is type parameters on `ForeignTypeDecl`
      (`import type { Task<A, E> }`), first needed by D2, so C1 moves next to D2.
      Layer-1 types don't use this mechanism yet. `Word8.Word`, `Word8Vector.Vector` and the other
      existing layer-1 types stay in the compiler's table (`BASIS_TYPES`), flagged `hostOwned` so
      they may cross a JS primitive boundary as they are. Their identity is shared with structures
      that are still TypeScript-defined until C4, and their equality and printing are in the
      compiler anyway (BD8).
- [x] **C2** Library JavaScript reaches runtime inlined. `scripts/generate_assets.ts` embeds
      `basis/js/*.js` and `std/js/*.js` as `libraryJsSources`. Discovery rewrites a library
      module's relative specifiers to `wm-library:basis/js/….js` and reports a missing file.
      Emission turns a `wm-library:` specifier into a `data:text/javascript,…` URL
      (`runtimeJsModuleSpecifier`), so nothing depends on the library being on disk. JS module
      imports are now deduplicated per module body, so each file is inlined once per module that
      uses it.
      Library modules are inferred through the program's staged pipeline (`analyzeModuleGraph`
      with `inferOptions: {}`), because unsafe imports need the FFI elaboration stages.
- [x] **C3** `Word8Vector` is the pilot: `basis/word8_vector.wm` over `basis/js/word8_vector.js`.
      `addWord8VectorValues`, its manifest runtime names and the prelude object are gone. The JS
      file works on plain JavaScript values (`Uint8Array`, JS arrays); `List` and `Option`
      conversions and the `get` bounds check are written in Workman over `Js.Array.fromList` and
      `Js.Array.toList`. The representation contract is the registered symbol
      `Symbol.for("wm.Word8Vector.data")`, which the prelude's equality and printing also use.
      Basis types were renamed to capitalized names at the same time (BD11). Tests in
      `tests/library_discovery_test.ts` check the single inlined copy and the direct calls.
      Cold start (B6 program): about 625 ms, up from about 590 ms. The cost is a second
      inference pass over the whole library, because fully typed `unsafe` imports still take the
      delayed FFI path:
      [`../issues/manual-unsafe-imports-take-the-delayed-ffi-path.md`](../issues/manual-unsafe-imports-take-the-delayed-ffi-path.md).
- [x] **C4** `Word8`–`Word64`, `Word8VectorSlice`, `PackWord*`, `PackReal*`, `Byte`, `Float32` and
      `Float64` are library modules in `basis/`, over three primitive files: `js/byte_vector.js`
      (everything that touches the vector and slice representation), `js/word.js` and
      `js/float.js`. Their schemes, manifest runtime names and prelude objects are gone. `std/binary.wm`
      imports the structures it uses. `Bytes` (file IO) stays in TypeScript: it is host IO, which
      stage F moves to `host/js/`.
      Library files are inlined once per program, as program-level `const __wm_library_js_N`
      declarations that module bodies import. They can't import each other, since a `data:`
      module has no base URL.
      Cold start (B6 program): about 730 ms, up from about 625 ms after C3. The library is now 28
      modules, and both of its per-process costs grow with it. Parsing is the larger one: the parser
      runs at about 0.3 MB/s, so the 15 KB of `basis/` costs about 150 ms. Inference costs about
      140 ms, twice what one pass would cost
      ([issue](../issues/manual-unsafe-imports-take-the-delayed-ffi-path.md)). Stage E adds more
      modules, so a prebuilt library artifact (`../cold-start-performance.md`) is now a
      prerequisite for E rather than an optimization.
- [x] **C5** No library structure has a TypeScript-defined value any more. `composeInitialStructure`
      stays, now only overlaying layer-0 material that is qualified by a library namespace:
      compiler-owned types (`Word8.Word`) and the pervasive constructors (`List.Cons`,
      `Option.Some`, `Result.Ok`). The `__wm_basis_<Alias>` runtime objects remain only for
      those constructors.
- [x] **C6** The manifest is split in three: layer 0 in `src/basis_manifest.ts`, the `Js.*` types and
      the compiler-implemented JS host values (`Js.Array`, `Json.assert`, `Dict`, `Table`, `Debug`,
      `Bytes`) in `src/host/js_manifest.ts`, and the `Gpu.*` types and intrinsics in
      `src/wmslang/target_manifest.ts`, with shared descriptor types in `src/basis_descriptor.ts`.
      Semantic ids are unchanged. `basis_manifest.ts` still assembles the three into
      `BASIS_TYPES`, `BASIS_VALUES` and `BASIS_INTRINSICS`, so consumers didn't change. Making the
      host layer an explicit import is stage F.

**Gate:** `src/types_basis.ts` and `src/core/emit_prelude.ts` contain only layer-0 material,
compiler-lowered intrinsics, and the equality and printing of host-owned types. Adding a layer-1
primitive touches only files under `basis/`. Adding a layer-1 type also adds a `BASIS_TYPES` entry
until C1's type parameters exist.

## Stage D: `Result` and `Task` in `.wm`

- [x] **D1** Dropped (BD12). `Result`'s type and constructors stay in layer 0: FFI elaboration
      produces `Result` values, as SML's derived forms produce `bool` and `list`, which is why the
      Definition puts those types in the initial basis. Its operations were already in
      `std/result.wm`.
- [x] **D2** `Task`'s twelve operations (`new`, `fromResult`, `succeed`, `fail`, `map`, `map2`, `race`,
      `andThen`, `mapErr`, `recover`, `orElse`, `all`) are defined in `std/task.wm` over six promise
      primitives in `std/js/task.js`. `addTaskValues`, their manifest entries and the prelude's
      `__wm_basis_Task` are gone. The `Task` type stays in layer 0 for the same reason as `Result`
      (BD12), so C1's type parameters are not needed here.
      The primitives are typed with free type variables (raw representation claims, as
      `docs/jsffi.md` describes for unsafe imports), and every binding over them states its real
      type with an annotation. Two traps found on the way, both documented in `task.js`: an
      export named `then` makes the module namespace a thenable, which `await import()` calls;
      and a JS array passed to a Workman callback arrives as a `Js.Array`, not a tuple, so `both`
      calls a curried callback.
      This needed a compiler change. A binding whose body calls any JS import was never
      generalized, which made polymorphic library code over primitives impossible and had
      silently made `Word8Vector.unfoldN` monomorphic in C3. An authored `unsafe` import with a
      manual type, no clause alias and no `Js.Value`/`Js.Object` in its type is now an ordinary
      typed binding (`isDeclaredUnsafeImportSpec`): no FFI binding, no delayed resolution, no
      boundary check on its arguments, and calls to it don't block generalization. Tests in
      `tests/library_discovery_test.ts`.
- [x] **D3** Decided against moving `Text.of` (BD13). It is the compiler's value printer, as `print`
      is, and stays compiler-owned. The Basis `Text` structure is not added.

**Gate:** no layer-2 name is defined in TypeScript, apart from `Text.of` (BD13).

## Stage E: build out layer 1

Existing Workman names are kept (BD9).

- [ ] **E1** Keep the existing names of already-migrated structures (BD9). Move extras that
      are neither Basis functions nor established Workman API into std.
- [x] **E2** `Option` and `List` gained their Basis functions in the existing `std/` modules (BD13);
      `ListPair`, `Vector` and `VectorSlice` are new modules in `basis/`, with the shared error type
      in `basis/basis.wm`. `Vector.Vector<T>` and `VectorSlice.Slice<T>` are new compiler-owned
      types; vectors admit equality when their elements do (a new `arguments` equality kind) and
      slices never do. Conformance tests from the spec pages are in
      `tests/basis_conformance_test.ts`. `General` is in `basis/general.wm` (`Order`, `o`, `before`,
      `ignore`), and `List`, `Vector` and `VectorSlice` have `collate`. `Map` now uses
      `General.Order` instead of its own `Ordering`, a breaking change for code matching on
      `Map.Less`. The byte structures were migrated to BD14 as well, a breaking change
      that removed `Word8Vector.get` and `Word8VectorSlice.get`.
- [x] **E3** Holds by construction: BD13 puts a structure's Basis and Workman functions in one
      module, and overlapping operations keep only the Workman name (BD9).
- [ ] **E4** Add text structures once `char` exists: `Char`, `String`, `Substring`, `StringCvt`.
- [x] **E5** `basis/math.wm` (all of `MATH`, as declared imports of the JS `Math` global, with no
      JS file), `basis/real.wm` and `std/number.wm` (`div`, `mod`, flooring, `Div` panics).
      `Real` covers the subset with no dependency on `char`: constants, `rem`, `abs`, `min`/`max`
      (NaN-ignoring as specified), `sign`, `signBit`, `sameSign`, `copySign`, `compare` (returns
      `Err(Basis.Unordered)` on NaN; `Unordered` joined `Basis.Error`), `unordered`, `isNan`,
      `isFinite`, `isNormal`, `toManExp`/`fromManExp`, `split`/`realMod` (records `Real.ManExp`
      and `Real.Split`, named because Workman records are nominal), `nextAfter`, `checkFloat`, the
      `real…` rounding functions (round half to even), and `floor`/`ceil`/`trunc`/`round`
      (`Err(Basis.Domain)` on NaN, `Overflow` panic on an infinity). Left out until `StringCvt` and
      `IEEEReal` exist: `fmt`, `toString`, `scan`, `fromString`, `toDecimal`, `fromDecimal`,
      `toInt`, `class`, `compareReal`. `fromInt` is left out because it would be the identity.
      `Word*.fromNumber`/`toNumber` keep their names (BD9); no `IntN` yet.
- [ ] **E6** Deferred (BD10): Basis IO structures are out of scope for this update.

**Gate:** every layer-1 structure listed as *Adopt* in `basis-design.md` exists with conformance
tests.

## Stage F: the JS host layer (BD17)

- [x] **F1** Keep the FFI vocabulary (`Js.*` types, `Js.Array.toList`/`fromList`, `Json.assert`)
      compiler-owned for the default profile, and take the `Js.*` types out of the kernel profile.
- [x] **F2** Add the `js.host("name")` import target to the grammar, both frontends and the
      module graph. It lowers to an ordinary import edge to `host/js/name.wm`.
- [x] **F3** Move `Dict`, `Table`, `Bytes` and `Debug` into import-only `host/js/` modules over
      `host/js/js/*.js`, remove their TypeScript types and prelude code, and migrate the users
      (frontend-v2's probe runtime and its dispatch generator, `std/result.wm`, tests).
- [x] **F4** Remove `Js.Array.toList`/`fromList` from `basis/` function bodies: build lists and
      arrays in Workman through each module's own primitives. Add a conformance test that `basis/`
      names `Js.*` only in primitive signatures.

Notes from doing it:

- `js.host` projects to an `ImportDecl` with a `js.host:` path (`src/host_modules.ts`). The module
  graph turns it into an edge to the library module without a node; analyses fall back to the
  loaded library results for such edges, and `mergeLibraryGraph` puts explicitly imported library
  modules first so whole-program passes see imports before importers. Source-string compilation
  accepts `js.host` imports too.
- Frontend-v2 was rebuilt in two fixed-point rounds: first to recognize `js.host`, then with the
  probe runtime and generated dispatch importing `Table`.
- Host primitives avoid callback parameters, which cost the parser about 40% when tried (see
  `../issues/manual-unsafe-imports-take-the-delayed-ffi-path.md`). Parse time is unchanged.
- The tracked tuiman and problems artifacts were not regenerated. They embed the old prelude and
  still work.

## Risks

- **Runtime resolution of library JavaScript (C2)** was the least-known part of the plan. It is
  resolved by inlining, piloted with `Word8Vector`. A target where `data:` imports are not allowed
  (a strict Content Security Policy in a browser) would need the files emitted next to the bundle
  instead.
- **Cold start (B6).** Library modules joining the ordinary graph shouldn't make startup slower
  than it is now, since the library is already inferred per process. Measure anyway.
- **Tooling assumptions.** Tooling that special-cases std identities or paths needs to follow each
  stage. Stage 6 of the module update made the per-module interface the tooling API, which should
  keep this contained.
- **wmslang** consumes the `kernel` profile and GPU intrinsics. C6 has to keep that working
  unchanged.
