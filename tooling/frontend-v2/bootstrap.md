# Frontend v2 bootstrap and parser updates

Frontend v2 is the only Workman runtime frontend. Parser updates do **not** rebootstrap through a v1
Workman/Peggy parser: that executable parser was retired. Peggy remains build-time input for reading
`src/grammar.peggy` as a grammar AST, and separately generates the unrelated WMSML parser.

The tracked `src/generated/frontend_v2_parser.js` artifact is the stage-0 seed that compiles the
Workman sources in this directory into the next frontend artifact.

```text
tracked frontend-v2 artifact (stage 0)
    -> parses and compiles tooling/frontend-v2/compiler_frontend.wm
    -> next frontend-v2 artifact (stage 1)
    -> repeat until two consecutive outputs are byte-identical
```

## Normal parser update

Update the authoritative grammar and the self-hosted Surface implementation together:

- `src/grammar.peggy` owns recognition.
- `generator/surface_schema.ts` classifies rules and declares Surface constructors.
- `surface_builders_*.wm` construct the lossless Surface tree.
- `surface_renderer*.wm` owns canonical formatting.
- `src/frontend_v2_surface_semantic.ts` projects Surface nodes into compiler AST nodes.

Then regenerate and rebuild:

```sh
deno task frontend-v2:grammar-report
deno task frontend-v2:generate-recognizer
deno task frontend-v2:build
```

One build produces the next stage; it does not itself prove a fixed point. Run another build and
verify that it leaves the artifact byte-identical:

```sh
before=$(sha256sum src/generated/frontend_v2_parser.js | cut -d' ' -f1)
deno task frontend-v2:build
after=$(sha256sum src/generated/frontend_v2_parser.js | cut -d' ' -f1)
test "$before" = "$after"
```

Finish with focused parser tests, the repository type-check, and the full test suite:

```sh
deno test -A tests/frontend_v2_generated_recognizer_test.ts \
  tests/frontend_v2_grammar_ir_test.ts \
  tests/compiler_frontend_v2_test.ts
deno task check
deno task test
```

The semantic-golden tests scan `.wm` files under `std`, `examples`, and `tooling`. Untracked scratch
files in those directories need a reviewed golden entry or should live outside the scanned corpus.

## Avoiding a bootstrap break

The stage-0 artifact must be able to parse and semantically project the new self-hosted `.wm`
sources before it can produce stage 1. Grammar recognition and the Surface ABI can therefore be
newer than the parser that is currently doing the rebuild.

Prefer a compatibility-first, two-phase change when an update affects bootstrap-visible syntax or
constructor payloads:

1. Add recognition, new Surface constructors, builders, rendering, and a projection that accepts
   both the old and new payload shape. Do not use the new syntax in the frontend's own `.wm` sources
   yet.
2. Generate and build a good intermediate v2 artifact.
3. Adopt the new syntax or remove the temporary old-shape projection support.
4. Build again until two consecutive artifacts are byte-identical.

Adding a new Surface constructor is usually safer than changing the payload type of an existing
constructor. When an existing payload must change, keep the TypeScript projection tolerant of the
stage-0 representation during the transition.

## Recovering from a broken generated artifact

Symptoms include an import-time JavaScript syntax error, every compiler test failing immediately, or
`frontend-v2:build` failing before it can analyze `compiler_frontend.wm`.

First restore a known-good tracked v2 artifact. Save any generated artifact you need to inspect,
then restore only this reproducible output:

```sh
git restore --source=HEAD -- src/generated/frontend_v2_parser.js
```

Regenerate the recognizer, build once from that seed, and continue building to a fixed point:

```sh
deno task frontend-v2:generate-recognizer
deno task frontend-v2:build
deno task frontend-v2:build
```

If `HEAD` does not contain a compatible seed, take `src/generated/frontend_v2_parser.js` from the
most recent known-good commit or release. Do not use `src/generated/wmsml_parser.js`; it parses the
SML implementation language, not Workman source.

If the last known-good v2 artifact cannot parse the changed self-hosted sources, temporarily return
those sources to a syntax and Surface ABI understood by the seed, build the compatibility phase,
then reapply the second phase. There is no supported `frontend: "v1"` escape hatch.

Recreating v2 without any known-good v2 artifact would require resurrecting retired migration
tooling and is not a maintained bootstrap procedure. Keeping a valid generated artifact in version
control is therefore part of the frontend's source distribution, not disposable build output.
