# VS Code Extension Checklist

Goal: build a proper, finishable VS Code extension for wm-mini. This should be a real
language-client plus LSP-server integration for `.wm` files, not a separate checker tool wearing
editor clothes.

The scope is intentionally small: syntax highlighting, editor configuration, document sync,
module-aware diagnostics, and a narrow path to hover/types once the frontend has stable spans.
Workman and workmangr both show the larger possible shape; wm-mini should take only the pieces
needed for a basic but honest beta.

## Research Takeaways

- [x] Reuse the Workman extension shape: VS Code `package.json`, language contribution, TextMate
      grammar, `language-configuration.json`, `vscode-languageclient`, output channel, and restart
      command.
- [x] Reuse the Workman LSP server split in miniature: transport/server loop, request handlers,
      validation, document store, and diagnostic conversion.
- [x] Reuse the Workman/workmangr idea of open-document source overrides so diagnostics reflect
      unsaved editor buffers, not just files on disk.
- [x] Reuse workmangr's diagnostic fingerprint idea so unchanged diagnostics are not republished on
      every edit.
- [x] Avoid workmangr's advanced structural editor scope for now: custom inlay renderer, semantic
      index UI, worker processes, large caches, formatting, and deep symbol services.

## Frontend Prerequisites

- [x] Add source spans to the parser AST for declarations, expressions, patterns, type expressions,
      imports, and module references.
- [x] Preserve parser error offsets and convert them into LSP ranges.
- [x] Convert type inference failures into structured diagnostics with severity, message, optional
      code, and span.
- [x] Convert exhaustiveness and redundancy warnings into structured warning diagnostics with spans
      on the relevant `match` arm or `match` expression.
- [x] Expose a frontend API that accepts an entry file path plus source overrides and returns:
  - [x] Parsed module graph.
  - [x] Type result.
  - [x] Diagnostics for parse, module, type, and pattern coverage stages.
- [x] Keep CLI output as a consumer of the frontend API rather than making the LSP shell out to the
      CLI.
- [x] Reject import cycles through the same frontend path the CLI and LSP use.
- [x] Keep every source file under 500 lines; split folders by concern when needed, especially
      `lsp/`, `diagnostics/`, and future `infer/`.

## LSP Server

- [x] Add a small Deno TypeScript LSP server, likely under `lsp/server/` or `src/lsp/`.
- [x] Implement stdio JSON-RPC framing.
- [x] Support `initialize`, `initialized`, `shutdown`, and `exit`.
- [x] Advertise only the first beta capabilities:
  - [x] `textDocumentSync` with open/close and full-document changes.
  - [x] `textDocument/publishDiagnostics`.
  - [x] Optional `hoverProvider` only after stable expression/binding spans exist.
- [x] Maintain an in-memory document map keyed by URI.
- [x] Convert `file://` URIs to paths and paths back to URIs in one small tested module.
- [x] Resolve imports relative to the current module file and workspace root, using in-memory
      overrides for open `.wm` documents.
- [x] Debounce validation on edit.
- [x] Validate on `didOpen`, `didChange`, `didSave`, and relevant file create/delete/change
      notifications.
- [x] Revalidate open files affected by an imported file changing.
- [x] Publish empty diagnostics when a previously broken file becomes valid.
- [x] Fingerprint diagnostics per URI and skip unchanged publishes.
- [x] Log debug output to stderr only; never corrupt stdout LSP frames.

## VS Code Client

- [x] Add an extension package under `editors/vscode/`.
- [x] Contribute the `wm` language id for `.wm` files.
- [x] Add `language-configuration.json` for comments, brackets, auto-closing pairs, word pattern,
      and basic folding markers.
- [x] Add a small TextMate grammar for current wm-mini syntax:
  - [x] `let`, `rec`, `type`, `record`, `import`, `match`, `if`, `else`.
  - [x] Constructors and type names.
  - [x] Lowercase bindings and fields.
  - [x] Literals, strings, comments, arrows, and operators.
- [x] Start the Deno LSP server through `vscode-languageclient/node`.
- [x] Add a `wm-mini.restartLanguageServer` command.
- [x] Add settings for server trace/debug logging.
- [x] Prefer running the local Deno source during development.
- [x] Decide later whether packaged releases bundle compiled server binaries or require Deno.

## First Beta Feature Set

- [x] Syntax highlighting for supported wm-mini syntax.
- [x] Parse diagnostics with accurate ranges.
- [x] Module/import diagnostics with accurate ranges.
- [x] Type diagnostics with accurate ranges.
- [x] Exhaustiveness and redundancy warnings with accurate ranges.
- [x] Diagnostics work on unsaved files.
- [x] Diagnostics work across simple imports.
- [x] Diagnostics clear after edits fix the problem.
- [x] Server restart command works.
- [x] No formatting, completion, go-to-definition, rename, semantic tokens, or custom inlay UI in
      the first beta unless they fall out naturally from already-built frontend data.

## Hover Candidate

Hover is allowed in the first beta only if the span work makes it cheap and small.

- [x] Hover on a local value binding shows its inferred type.
- [x] Hover on a constructor shows its constructor type.
- [ ] Hover on a type constructor shows its declaration summary.
- [x] Hover failures return `null`, not a fake or stale type.
- [x] If hover makes the LSP noticeably larger, move it to the second milestone.

## Tests

- [x] Unit-test offset-to-line/column and line/column-to-offset conversion.
- [x] Unit-test URI/path conversion on macOS-style absolute paths and ordinary relative workspace
      imports.
- [x] Unit-test diagnostic range conversion.
- [x] Unit-test source overrides so an unsaved imported module affects the entry module diagnostics.
- [x] Unit-test type diagnostics with code and non-empty source span.
- [x] Add an LSP smoke test that sends `initialize`, `didOpen`, and waits for `publishDiagnostics`.
- [x] Add an LSP smoke test proving diagnostics are cleared after a valid `didChange`.
- [x] Add an LSP smoke test for imported file changes affecting an open dependent file.
- [x] Add LSP smoke tests for value hover, constructor hover, and hover misses.
- [x] Add VS Code extension compile checks with `npm run compile`.
- [x] Keep existing frontend tests as the source of truth for parser, module, inference, and
      coverage behavior.

## Done Definition

- [ ] Opening a `.wm` file in VS Code activates the extension.
- [ ] The LSP server starts without manual commands.
- [ ] Syntax highlighting and bracket/comment behavior are usable.
- [ ] Invalid syntax produces squiggles at the correct place.
- [ ] Type errors produce squiggles at the correct place.
- [ ] Missing or redundant match cases produce warnings, not hard failures.
- [ ] Imported modules participate in checking.
- [ ] Unsaved editor buffers participate in checking.
- [ ] Fixing a file clears stale diagnostics.
- [ ] The server can be restarted from the command palette.
- [ ] The implementation remains small enough to understand in one sitting.
- [ ] No source file exceeds 500 lines.

## Explicit Non-Goals For The First Beta

- [ ] No structural editor.
- [ ] No custom inlay renderer.
- [ ] No formatter.
- [ ] No package manager integration.
- [ ] No semantic token pipeline unless TextMate highlighting is clearly insufficient.
- [ ] No completion until the frontend has a small symbol query API.
- [ ] No go-to-definition until declarations and references have stable spans.
- [ ] No attempt to match the full Workman or workmangr LSP feature set.
