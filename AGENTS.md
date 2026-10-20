# Project instructions

See `/home/ellie/docs` for extra machine-specific information.

Use `docs/` only for user-facing documentation, `markdown/` for plans and agent Markdown dumps, `markdown/issues/` for project-local issue management by agents, and the gitignored `research/` directory for relevant reference projects and files.

## Git management

- Inspect Git state before editing and preserve existing local changes and untracked files.
- Do not commit without asking. An explicit user instruction to commit a particular batch authorizes that batch.
- Keep commits focused, with descriptive messages explaining the change.
- Use descriptive branch names based on the work, not AI or model names.
- Commit as the configured Git identity. No `Co-authored-by` trailers or other co-author attribution.
- End every agent-made commit message with:

  ```
  Agent: <harness> <version>; model <exact model id>; thread <harness thread/session id>
  ```

  Use actual metadata; do not invent unavailable version, model, or session identifiers.

- Do not push, publish, tag releases, or create content on GitHub or other external sites without explicit user authorization. Discussing an issue (for example, “let’s make a GitHub issue”) is not authorization to immediately create it through the CLI.
