# Generated SubsetML Basis snapshot

The WM modules are generated from the sibling SubsetML repository's constrained SML source.
They are a self-contained snapshot, not a second implementation to maintain by hand.
The original SML sources are copied alongside them for checking and future native builds.
The original source comments retain their authorship/license notices; the applicable MLton
and MLWorks license texts are included here.

Refresh from the wm-mini repository root:

```sh
deno run -A scripts/sync_frontend_v3_basis.ts ../SubsetML
```

`manifest.json` records the selected modules, their SML source hashes and the emitted file
hashes. `subset_text_host.wm` is the existing JS host adapter; native build generation should
select `native/subset_text_host.sml` instead. The root-level `subset_text_host.sml` is
SubsetML's checker declaration, not an executable native adapter. No new primitive is required.
`basis.mlb` selects the native adapter and the Basis dependency order; verify it with
`mlton -stop tc tooling/frontend-v3/lib/subsetml/basis.mlb` from the repository root.

The snapshot also includes the existing numeric formatting and process/I/O modules for
portable document dumps and the native lexer driver. `subset_host.wm`/`.js` are the existing
JS filesystem/process adapters; `native/subset_host.sml` is the MLton implementation.
The root `subset_host.sml` remains the checker declaration.
