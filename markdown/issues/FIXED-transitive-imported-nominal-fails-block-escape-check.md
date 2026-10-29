# Issue: Transitive Imported Nominal Fails the Block Escape Check

Status: fixed on the current checkout; verified against atview 2026-10-28

## Atview verification (2026-10-28)

Rechecked the original `../atview/app/image-boundary-probe.wm` after removing its
unused `AppError` import: it passes. The actual `app/main.wm` also passes without
`AppError`, `RenderModel`, `RenderDependency`, and the unused namespace imports
previously retained for transitive nominal support. Main-app code generation,
including the image worker, succeeds.

Removed unused `AppError` imports from twelve atview files. Eleven pass checking;
`bench/image-bench.wm` has an independent `Carrier` literal missing `mapErr`, which
also fails with its original import restored through a source override. The
`AppError` import in `app/model.wm` remains necessary for explicit annotations.

The recheck below records the earlier reduced investigation. Its statement that
the external atview probe had not been rerun is superseded by this verification.

## Recheck (2026-10-28)

The reduced missing-type-import behavior no longer reproduces on the current
checkout. The original external atview probe below was not rerun, so its exact
Task/FFI path remains unverified; the `open` status above is historical rather
than evidence of a current failure.

Verified using `checkVirtual` with three modules:

```wm
// model.wm
record Inner = { quit: Bool };
record Outer = { controls: Inner };
let make = () => { Outer { controls = Inner { quit = false } } };

// api.wm
from "./model.wm" import { make };
let load = () => { make() };

// main.wm: both forms pass without importing Outer or Inner
from "./api.wm" import { load };
let run = () => { load() };
let read = () => { let item = load(); item.controls.quit };
```

A direct annotated projection importing only `Outer` also passes without importing
`Inner`. The existing `tests/module_test.ts` regression `transitive imports
preserve hidden nominal type-name support` passes as well.

The implementation now separates source-visible names from hidden nominal
metadata: `addImport` registers `knownTypeInfos` from the dependency environment,
environment composition carries that registry, and `inferBlock` uses
`knownTypeIds` for its outer scope. A type can therefore be known for checking
without being imported as a source-level name. Explicitly writing that type's
name in an annotation still requires it to be in scope.

Reproduction: gitignored `research/import-type-triage-2026-10-28.ts`.

Discovered while splitting the Workman AT Protocol client into application, protocol, and reusable
TUI modules.

## Summary

An imported function can expose a nominal type in its inferred signature without the consumer
importing that type by name. Using the function inside a block then fails with:

```text
local type escapes scope
```

The nominal is not block-local. It was declared by a dependency of the imported module.

This currently forces apparently unused imports into consumers. In atview, `AppError`,
`RenderModel`, `RenderDependency`, and the reactive/surface modules must remain imported by the
entrypoint solely because those types occur transitively in imported function results.

## Atview Reduction

```wm
-- data.wm
from "../proto/api.wm" import { FeedPost };
from "../proto/views.wm" import * as Views;
from "../tui/kitty.wm" import * as Kitty;

let loadImage = (post: FeedPost) => {
  match(post.image) {
    None => { Task.succeed(None) },
    Some(source) => {
      let typedSource: Views.PostImage = source;
      Kitty.load(typedSource)
        :> Task.map(Some)
        :> Task.recover((_) => { None })
    },
  }
};
```

`Kitty.load` has a result whose error is `Xrpc.AppError`. `data.wm` does not need to inspect or name
that error because `Task.recover` eliminates it, but the `Some` arm block fails its escape check.
Adding this otherwise-unused import makes the same program typecheck:

```wm
from "../proto/xrpc.wm" import { AppError };
```

The retained-render entrypoint has the same behavior for nominal types occurring in the memory
carried by an imported render function.

The checked probe is:

```text
testing-wm/atview/app/image-boundary-probe.wm
```

Remove its `AppError` import to reproduce the diagnostic.

## Likely Cause

`inferBlock` records every nominal ID present in the consumer's `typeEnv` before entering the block,
then `mentionsLocalType` treats any result nominal absent from that set as block-local.

That implication is too strong across module boundaries:

```text
not explicitly present in the consumer type environment
does not imply
declared inside this block
```

Imported schemes can legitimately mention nominal IDs from their own dependency graph even when
those declarations were not imported into the consumer namespace.

## Expected Behavior

Only types declared within the block should be forbidden from escaping it. Nominal identities
already present in imported value schemes should remain valid whether or not the consumer imports
their declarations by name.

Possible fixes include:

- track the nominal IDs introduced by declarations in this block and check specifically for those;
- include nominal IDs reachable from imported schemes in the block's allowed set; or
- register transitive nominal declarations when importing an exported scheme.

The first formulation most directly implements the rule being checked and avoids turning an
absence from a name environment into provenance evidence.

## Workaround

Explicitly import every transitive nominal that appears in the imported function's inferred type.
This is fragile because those types are implementation details and the compiler diagnostic does
not identify which import is missing.
