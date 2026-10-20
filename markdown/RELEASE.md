# Release routine

Next release: `0.4.2`.

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
