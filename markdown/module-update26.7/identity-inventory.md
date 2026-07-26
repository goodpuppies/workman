# Current module and semantic identity inventory

## Purpose

This is the Stage 0 inventory required by `S009`. It identifies every role currently carried by a
path, specifier, alias, emit name, or numeric nominal ID so the `ModuleId` migration can separate
them without losing consumers.

## Migration progress

`M201`–`M207` are complete. [`src/module_id.ts`](../../src/module_id.ts) defines the branded
compiler-owned identity. Graph entries, ordering, analysis/binding maps, nominal owners, Core
modules, standard-module membership, and edge targets now use it. Ordered edges retain the referrer,
original specifier, source node, and resolved target; cycle diagnostics use the resolver stack to
report the complete ordered cycle.

For the initial virtual-source provider, the normalized key selected from one `sourceOverrides` or
`virtualFs` snapshot is its stable identity backing. Loading the same snapshot repeatedly therefore
produces the same `ModuleId`; a future provider may supply a non-path opaque key without changing
consumers.

Compatibility `path` fields remain for display and I/O boundaries. Semantic maps no longer use those
fields as keys. The inventories below preserve the original audit and identify remaining
display/lowering consumers.

Backend namespace names are allocated uniquely from graph order (`__wm_module_N`) and no longer come
from a basename or the first importing alias. Each namespace import occurrence lowers its own local
alias to that one runtime module object.

## Current overloaded string roles

| Role                         | Current representation                          | Semantic status after migration                 |
| ---------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| import specifier             | `ImportDecl.path`, `ModuleImportEdge.specifier` | source occurrence text only                     |
| resolved filesystem identity | canonical real-path string                      | opaque `ModuleId` backing datum                 |
| virtual identity             | normalized virtual path string                  | provider-issued snapshot-stable `ModuleId`      |
| graph map key                | resolved path string                            | `ModuleId`                                      |
| graph ordering entry         | resolved path string                            | `ModuleId`                                      |
| display/diagnostic path      | same resolved path                              | separate display fact                           |
| inference import lookup      | original specifier string                       | resolved import occurrence linked to `ModuleId` |
| nominal declaration owner    | `modulePath: string`                            | defining `ModuleId`                             |
| recursion/source owner       | `path: string`                                  | `ModuleId` plus separate source location        |
| Core module map key          | path string                                     | `ModuleId`                                      |
| backend namespace name       | alias or basename-derived `emitName`            | separately allocated backend name               |
| local structure alias        | source identifier/dotted prefix                 | local `StrEnv` binding identity                 |
| qualified member target      | dotted string                                   | resolved structure/member semantic identities   |
| standard-module identity     | synthetic `std/*.wm` path string                | compiler-owned standard `ModuleId`              |
| LSP document key             | URI/path, sometimes graph path                  | document identity linked to compiler `ModuleId` |

## Producers

### Resolver and graph

[`src/module_graph.ts`](../../src/module_graph.ts) currently:

- canonicalizes ordinary entries/imports with `realPath`;
- normalizes virtual paths;
- uses path strings in `visiting`, `nodes`, `order`, and `names`;
- records an edge's source `specifier` and resolved `path`;
- selects `emitName` from the first namespace alias or filename stem.

Migration:

- the resolver alone constructs `ModuleId`;
- graph maps/order/visiting use `ModuleId`;
- the edge retains source spelling/location and resolved target separately;
- emit naming leaves graph resolution.

### Standard modules

[`src/standard_library.ts`](../../src/standard_library.ts) constructs a parallel graph with
synthetic paths, path-keyed inference results, and fixed emit names.

Migration: standard source units receive compiler-owned `ModuleId`s and use the same graph/interface
types as user modules while remaining inputs to basis construction.

## Semantic consumers

| Consumer                                   | Current use                                                             | Required target                                             |
| ------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| `src/staged_analysis.ts`                   | path-keyed inference passes and specifier-keyed import maps             | `ModuleId` maps plus resolved import facts                  |
| `src/infer.ts`                             | imports retrieved by source `decl.path`                                 | target interface attached to resolved occurrence            |
| `src/program_analysis.ts`                  | path-keyed aggregate results                                            | `ModuleId`                                                  |
| `src/binding_facts.ts`                     | graph-path maps; reconstructs all imported bindings before declarations | declaration-ordered resolved import facts                   |
| `src/nominal_facts.ts`                     | `modulePath` owns type/constructor/record identity                      | defining `ModuleId`                                         |
| `src/pattern_facts.ts`                     | graph-path traversal and nominal references                             | `ModuleId` plus semantic IDs                                |
| `src/recursion_facts.ts`                   | path identifies owning module/source                                    | `ModuleId` plus display/source fact                         |
| `src/core/artifact.ts`                     | path-keyed modules/results and `modulePath` constructors                | `ModuleId` maps and resolved semantic facts                 |
| `src/core/from_surface.ts`                 | dotted expression strings split into property accesses                  | resolved structure/member fact                              |
| `src/core/emit_js.ts`                      | edge paths and alias/basename `emitName` select runtime objects         | `ModuleId` lookup plus unique backend name                  |
| `src/compiler.ts`                          | path-keyed public APIs/artifacts                                        | keep path only at API/display boundary; internal `ModuleId` |
| `src/main.ts`, `src/run.ts`, `src/repl.ts` | paths select entries and diagnostics                                    | entry `ModuleId` plus display/output paths                  |
| `src/type_debug.ts`                        | path for source attribution                                             | display/source fact, not identity                           |
| `src/wmslang/normalize.ts`                 | path-keyed module selection/spans                                       | `ModuleId` selection plus source path                       |
| `src/wmslang/v2_normalize.ts`              | compares `modulePath` strings for nominal ownership                     | compare defining `ModuleId`                                 |
| `src/ffi/reflect/host.ts`                  | graph source/path lookup                                                | `ModuleId` plus source fact                                 |
| `src/lsp/document_symbols.ts`              | graph/document traversal                                                | compiler interface by `ModuleId`                            |
| `src/lsp/hover.ts`                         | result lookup by document path                                          | document-to-`ModuleId` link                                 |
| `src/lsp/symbols.ts`                       | module paths and emitter-like symbol relationships                      | compiler declaration/origin facts                           |
| `src/lsp/validation.ts`                    | graph diagnostics/source paths                                          | diagnostic source facts linked to `ModuleId`                |

## Numeric nominal identity tables

Current identity is also split across:

- fresh positive inference type IDs from `freshTypeInfo`;
- negative constructor IDs in [`src/basis.ts`](../../src/basis.ts);
- negative type-name IDs in [`src/compiler_semantics.ts`](../../src/compiler_semantics.ts);
- compiler-allocated binding, type, constructor, record, and recursion IDs in
  [`src/ids.ts`](../../src/ids.ts);
- stable string intrinsic IDs for GPU operations.

Migration rules:

1. one defining declaration/basis entry owns each semantic identity;
2. imports and aliases retain the owned identity;
3. implementation allocation IDs remain snapshot-local;
4. intrinsic tags select lowering but do not replace binding identity;
5. backend names and display strings never participate in equality.

## Migration sequence

1. Brand/wrap resolved identities as `ModuleId` without changing local resolution behavior.
2. Change graph and analysis maps to `ModuleId`.
3. attach resolved target facts to import occurrences;
4. change nominal owner fields from `modulePath` to `ModuleId`;
5. introduce `StrEnv` and resolved member facts;
6. allocate backend names from compiler module identity;
7. leave paths only in source, diagnostics, display, I/O, and compatibility API boundaries.

This sequence is reflected in `M201`–`M216`, `I401`–`I415`, and `R501`–`R506`.
