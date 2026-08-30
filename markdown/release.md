# Release process

The loop for shipping a change in this repo. Five steps, in order.

## 1. Make your changes

Edit source under `src/`, `tooling/`, `std/`, etc. Nothing special here — just
keep generated artifacts out of the manual edit set (see step 3).

## 2. Run scoped tests, not the whole suite

The full `deno task test` run is slow. Run only the test files that cover what
you touched:

```
deno test --allow-read --allow-write --allow-run --allow-env \
  --allow-net=github.com,release-assets.githubusercontent.com \
  tests/lsp_hover_test.ts tests/compiler_test.ts
```

Pick the files by area — e.g. LSP work → `tests/lsp_*_test.ts`, compiler work →
`tests/compiler_*_test.ts`, frontend v2 work → `tests/frontend_v2_*` and
`tests/compiler_frontend_v2_test.ts`. A single test within a file can be
narrowed further with `--filter "name"`.

Type checking is cheap and worth doing too:

```
deno task check
```

Full-suite runs are for when the change is broad or something downstream looks
suspicious — not the default.

## 3. Regenerate artifacts

```
deno task generate
```

This runs, in order:

- `generate-assets`
- `frontend-v2:generate-recognizer`
- `frontend-v2:build`, repeated until the generated parser reaches a fixed point
  (up to 8 stages — it throws if it never converges)
- `wmslang:builtins`
- `problems:build`

It must finish with `generation complete`. If the frontend-v2 convergence loop
errors out, that's a real problem with the grammar change — fix it before going
further, don't hand-edit the generated output.

## 4. Bump the version

Edit `version` in `deno.json`. Patch bump for fixes, minor for new surface.
This is the version JSR publishes, so it has to move for every release.

## 5. Carve out a git stage ready for commit

Stage exactly what belongs in the release and leave the rest alone:

```
git status
git add <the files you changed> <the regenerated artifacts> deno.json
git diff --cached
```

Review the staged diff before committing. Things to watch for:

- **Unrelated in-flight work stays unstaged.** If you had other files dirty
  before you started — say `src/ffi/reflect/host.ts` from some parallel
  experiment — it is not part of this release. Leave it in the working tree.
- `deno.lock` churn that isn't related to your change — drop it unless you
  actually changed dependencies.
- Regenerated files with no meaningful delta — fine to include, but confirm
  they're the ones `deno task generate` produced and not stale.
- Anything under `profiles/`, scratch files, or local editor config — leave
  unstaged.

The stage is the release; the working tree can stay messy. `git stash -k` is
useful if you want to run the scoped tests against exactly what you staged.
Leave the stage ready for the commit — commit and push are separate, deliberate
steps.
