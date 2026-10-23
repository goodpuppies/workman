# subml-basis

The SubsetML Basis as Workman library modules. Every `.wm` file here is generated from the
SubsetML sources by `deno run -A scripts/sync_subml_basis.ts ../SubsetML`, then embedded by
`deno task generate-assets`. Don't edit them by hand: change the `.sml` source in SubsetML and sync.
`manifest.json` records the SubsetML commit and source hashes.

Programs import these modules explicitly, without the `subset_` prefix:
`from "basis/won.wm" import * as Won;` loads `subset_won.wm`. They are never open implicitly;
`std/` builds the preloaded `Result`, `Option`, `List`, … on them.
`subset_text_host.wm` and `subset_host.wm` are SubsetML's hand-written WM adapters for the host
primitives, with `js/subset_host.js` as the latter's JS. They use `unsafe` imports with manual
types, so loading them needs no type reflection.

Workman's own library modules are in [`../std/`](../std/). See
[`../markdown/subsetml-basis.md`](../markdown/subsetml-basis.md) for the design.