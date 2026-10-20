# Release routine

1. Set the release version in both `deno.json` and `editors/vscode/package.json`.
2. Run `deno task publish`. Despite its name, this task only builds and generates
   artifacts; it does not publish remotely. Include the relevant generated changes
   in the release review.
3. Run `deno task test` and resolve failures before proceeding.
   TODO: make this task also run `wm test`.
4. Present the release changes, test results, release commit and proposed tag to
   the user. Commit only with authorization under `AGENTS.md`. After the user
   confirms, push the release commit, tag that exact pushed commit with the
   release version, and push the tag.

Do not push or create release tags during preparation without user confirmation.

To verify a version published on JSR, install it under `wmr` so the local `wm`
command stays independent:

Replace `<version>` with the release version.

```sh
deno install -A --min-dep-age=0 -g -f --name wmr jsr:@goodpuppies/workman@<version>
wmr version
```

Check the reported version: pushing a Git tag does not itself confirm that JSR
serves that release. This installation command does not publish a JSR package.

## Generated artifacts

`deno task publish` runs `deno task generate` before packaging the local VSIX.
Generation rebuilds the six native Aro extractor targets (using Zig 0.16.0),
the vendored byte codec, embedded assets, frontend recognizer and parser,
wmslang, tuiman, problems UI, and semantic snapshots. The parser must reach a
fixed point; fix generation errors rather than hand-editing its output.
CI also validates committed native artifacts with `deno task c-header:check`.

## Release staging

Stage and review the intended release changes and generated artifacts; leave
unrelated work and local scratch files outside the commit. Keep the VS Code
lockfile's package versions synchronized with its manifest. Inspect dependency
lockfile changes and include only those related to the release.

Run `deno publish --dry-run` against the release contents before pushing a tag.
It validates the actual JSR package without uploading it and catches packaging
problems such as paths that differ only in letter case.
