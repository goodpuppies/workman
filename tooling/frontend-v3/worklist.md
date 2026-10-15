# Frontend v3 structural editor worklist

Status: reset decisions recorded, 2026-10-12. Cleanup and implementation below are
pending unless checked. Phase 0 cleanup, WM projection diff and the initial canonical
schema/projector/view and the first canonical parser slice are implemented. Broader
language coverage and consumer/semantic integration are next. These are
slice-level implementations, not complete WM syntax coverage or a production replacement.

## Authority and scope

Read this worklist and [structural-editor-plan.md](structural-editor-plan.md) before
changing v3 parser/editor code. The plan defines behavior; this worklist defines file
disposition and implementation order. Earlier parser proposals, current type-parser
behavior, and its tests are not competing requirements.

Priority update: frontend completion and WM execution come first. SubsetML/MLton remains
an intended target, checked at useful checkpoints. Record compatibility blockers and
continue independent editor work rather than making native parity a gate for every slice.

The user directed the lexer and SubsetML compatibility work. The parser implementation
was started agentically and is disposable. Do not preserve it because it already exists,
passes tests, or has native integration. Reset it before implementing the new model.

Keep the lexer, portable source/Basis work, native adapters, and lexer explorer baseline.
Do not revert shared grammar changes or language decisions as a side effect of this reset.
Do not edit research implementations or the sibling SubsetML project for cleanup.
No commits, external publication, or production frontend switch are included.

The intended pipeline is fixed:

```text
arbitrary original buffer
  -> canonical marked AST, including preserved opaque text and missing expression holes
  -> formatted/completed projection
  -> source/projection diff, including whitespace
  -> additive inlays over the unchanged original buffer
```

Inlays omit deletions/replacements; `wm fmt` can apply formatting removals/replacements.
Permitted expression holes execute as TODO panic for now. Compilation modes are:
dynamic permits authored and virtual holes; default development permits authored holes
but rejects virtual holes; production rejects all holes. Ordinary formatting must not
silently turn a virtual hole into an authored TODO.

## File disposition: decided

Paths in this table are relative to `tooling/frontend-v3/` unless prefixed with `/`.
The repository-root scripts are listed with their complete repository-relative paths.

| Existing file/area | Decision | Required action |
| --- | --- | --- |
| `src/parser/type.wm` | Delete | Do not extend or wrap the old recognizer. Reimplement parsing after the rendering harness and canonical schema. |
| `src/parser/state.wm` | Delete | Discard `Parsed/Rejected`, its type-specific expectations, closer-only recovery, and `consumedEnd` span policy. Reintroduce state helpers only under the new assembly contract. |
| `src/parser/cursor.wm` | Salvage and move | Move to `src/syntax/cursor.wm`, retaining only authored traversal, source lookup, exact word/kind tests, token index, and explicit EOF. It owns no marks, grammatical completion, or virtual tokens. |
| `src/parser/keyword.wm` | Salvage and move | Move to `src/syntax/keyword.wm`. Keep exact reserved-word lookup; update imports. Its keyword inventory is a language fact, not a recovery policy. |
| Old `src/parser/` directory | Remove | After the moves/deletions, leave no old parser entry or compatibility facade. Recreate this directory for the new implementation later. |
| `src/surface/ast.wm` | Old schema deleted; rebuilt | The current file is the new milestone-2 canonical slice. Preserve and extend it; do not delete it again under the original cleanup decision or restore old shapes through aliases. |
| `src/source/mark.wm` | Keep, then review | Preserve the lexer-used marking kernel. `Slot`/`Marked` are compatible building blocks. Add syntax requirements without changing established lexical mark semantics. |
| `adapters/portable/type_document.wm` | Delete | The codec is tied to the rejected type slice and explicitly cannot encode holes, marked phrases, or islands. Replace with a complete codec for the new exercised schema later. |
| `tools/native-type.wm` | Delete | Remove the old type-parser snapshot executable. A new structural document/preview driver will have a different contract. |
| `scripts/check_frontend_v3_types.ts` (repository root) | Delete | Preserve useful grammar examples as audit data; remove recognizer acceptance/rejection and old-schema snapshots as executable requirements. New checks validate the full editor path. |
| `scripts/build_frontend_v3_native.py` (repository root) | Refactor now | Remove old AST/parser probes, native-type copy/build, and `--type-driver`. Keep native lexer graph discovery, Basis generation, adapters, panic runtime, UTF input support, and output options. |
| `scripts/check_frontend_v3_native.ts` (repository root) | Refactor now | Remove unconditional compilation of old AST/type modules. Keep all lexer document/encoding/parity coverage. New editor parity gets a separate check. |
| `parser-design.md` | Delete | Its implementation sequence and recovery restrictions compete with the new contract. Migrate useful grammar facts before deletion; do not retain it as an active historical design file. |
| `pattern-design.md` | Refactor and rename | Move to `grammar-audit.md`; retain concrete spelling/context facts and previously recorded language decisions. Remove old type-slice status, closer-only recovery guidance, and dependence on the old AST constructors. |
| `README.md` | Refactor | Make the plan/worklist entry points. Remove old parser/type-driver instructions and outdated layout/status. Document the actual stage available after cleanup. |
| `native-portability.md` | Refactor | Keep portability constraints and compiler findings. Remove current-state claims requiring the deleted parser/AST and link to the reset worklist. |
| `subsetml-lowering-plan.md` | Refactor | Keep compiler/Basis agreements and compatibility findings. Remove old parser implementation/recovery roadmap; preserve only relevant compatibility lessons as clearly historical evidence. |
| `structural-editor-plan.md` | Keep and align | Remove suggestions to retain the old parser as a scoped helper/reference implementation; this worklist decides to delete it. |
| `src/lexer/`, `src/source/source.wm` | Keep | Preserve lexical behavior, lossless UTF-16 source handling, trivia, marks, and mates. |
| `lib/subsetml/`, `adapters/js/lexer.wm`, `adapters/portable/document.wm` | Keep | Preserve portable Basis and lexer transport/codec. No parser dependency belongs in this baseline. |
| `tools/lex.wm`, `tools/native-lex.wm`, `tools/reader_debug.wm` | Keep | Preserve lexer/debug consumers. Add editor tools independently. |
| `lexical-design.md`, examples, Basis sync tooling | Keep | Existing lexer decisions and compatibility work remain in force. |
| `explorer/`, `tests/frontend_v3_lexer_test.ts` (repository root) | Keep and extend later | Preserve working lexer inspection and regressions. New editor stages must consume actual v3 outputs, never a substitute parser. |
| `research/workmangr/`, Hazel paper, frontend v2 | Reference only | Read behavior and grammar evidence; do not port their recovery special cases as authority or modify them during cleanup. |

Do not store a second copy of the deleted parser under `legacy/`, `archive/`, scratch
sources, or another active import path. Carry forward facts and useful test inputs,
not an alternative executable architecture. Existing files remain temporarily only
until the cleanup tasks below are completed.

## 0. Reset the active baseline

- [x] Extract concrete type grammar examples from the old design/check script into
  `grammar-audit.md`: right-associated arrows, tuple domains, qualification/argument
  adjacency, grouping, nonempty argument lists, and trailing commas. Label these as
  current grammar facts to reconcile with canonical completion, not reasons to reject
  damaged editor input. Include pattern context distinctions, literal spelling, record
  openings, exact `Var` guards, and reserved `record` from the existing audit.
- [x] Move cursor/keyword lookup to `src/syntax/`, update their imports, and remove the
  old state, type parser, snapshot codec/driver, and root type-check script.
- [x] Delete the old surface AST after fact extraction. Retain phase-independent marking
  primitives. Do not expand a speculative full schema before the rendering milestone.
- [x] Remove parser/AST dependencies from native lexer build and parity tools in the
  same cleanup step. Keep native lexer validation executable throughout the reset.
- [x] Delete `parser-design.md`, finish the audit rename, and remove obsolete links,
  type-driver options, and parser roadmap claims from all v3 docs.
- [x] Make staging resilient to deleted source files: the native build currently copies
  with `dirs_exist_ok=True`. Recreate its owned staged source tree, or otherwise remove
  stale staged files, so a deleted parser cannot survive through a previous build.
- [x] Search active sources/docs/scripts for `src/parser/type.wm`, `type_document.wm`,
  `native-type`, `--type-driver`, `check_frontend_v3_types`, `parser-design.md`, and old
  `pattern-design.md` references. No active import, invocation, or conflicting guidance
  may remain. This worklist's deletion inventory can name those files.
- [x] Run lexer regressions and complete WM/native lexical parity. Add focused checks
  for moved cursor/keyword primitives as needed; do not recreate the rejected parser's
  state or API just to preserve its old tests.

## 1. Build the diff and inlay preview harness first

Implemented checkpoint: `src/editor/{diff,inlays,preview,hints}.wm`, the JS adapters,
CLI fixture tool and direct WM suites. Full diffs preserve both coordinate spaces;
the additive view ignores deletions, splits labels at projected lexeme/trivia boundaries,
retains whitespace and preserves shared-anchor order. Inline labels show line breaks
visibly without inventing source lines. The CLI accepts original/projected text or hints.

Standalone alignment uses bounded Myers search (default 256 edits); canonical projection
can supply validated correspondence spans to pin authored occurrences and bound each
gap separately. The canonical View now supplies mark/pair attribution. Native
runtime parity remains pending, but the diff/additive/preview closure translates and
MLton-typechecks. Checkpoints required portable count validation, numeric-list element
comparison, a Number constraint on `skip`, and avoiding SML's infix identifier `before`.
No SubsetML source or Basis expansion was needed.

At the diff milestone, WM coverage had 23 passing cases, including 1,600 tiny string pairs compared with
an independent edit-distance oracle. Prefer WM suites for new core behavior; TypeScript
tests cover transport/native boundaries. Testman's host runner stays outside the core.

- [x] Define original/projected coordinate spaces, full diff operations, and ordered
  additive inlays. Preserve exact UTF-16 text and optional mark/provenance references.
- [x] Audit Workmangr's token/gap diff, scan alignment, and CLI overlay. Port the useful
  behavior into v3 WM modules; keep host JSON and presentation in adapters/tools.
  Do not replace projection diff with a list of missing-token artifacts.
- [x] Handle missing spaces/indentation alongside syntax. Never strip whitespace-only
  additions from the core result. Preserve excess authored whitespace in additive view.
- [x] Define alignment for repeated tokens and opaque fragments. Keep full deletions/
  replacements inspectable even when the inlay view omits them. Avoid source loss and
  accidental association with a different construct.
- [ ] Preserve structural order for multiple insertions at one anchor. Model padding
  and whitespace explicitly; positions refer to original source, not an already edited
  preview. Preserve individual mark relationships even if presentation groups labels.
  Ordering/padding and mark/pair attribution through the canonical View are implemented.
- [x] Define CLI marked/plain output and structured inspection. Handle CRLF, lone CR,
  UTF-16 surrogate units, EOF, and inline display limitations for newline labels.
  Raw preview and inline-safe hint labels are deliberately separate output fields.
- [ ] Add fixtures for missing spaces, `?;`, `},`, paired braces, comments, indentation,
  excess whitespace, repeated punctuation, damaged fragments, and Unicode positions.
  Supplied projections/hints are explicitly renderer fixtures, not fake parser results.
- [ ] Validate WM results first; run native compatibility at useful checkpoints with a
  separate editor check and record blockers. Keep the native lexer entry independent.

## 2. Rebuild canonical marked structure and its projector

Implemented checkpoint: `src/surface/ast.wm`, `src/syntax/spelling.wm`,
`src/editor/project.wm`, `src/editor/view.wm`, and the complete current-schema codec
`adapters/portable/surface_document.wm`. Direct tree fixtures verify projection through
correspondence diff, additive preview and mark/pair attribution. The WM suite has 33
passing cases at that checkpoint. The first parser slice is now integrated below;
complete language coverage remains pending.

Native checkpoint: the projector/View closure hits a SubsetML generic inference error
at `expr` (Writer * 'a versus Writer * Expr); explicit recursive parameter annotations
did not resolve it. Record and defer this blocker while proceeding on WM. Do not revive
the removed schema or duplicate the projector for native compatibility.

- [x] Design the minimal whole-program schema for bindings, names/literals, holes,
  lambdas, application, and blocks. Missing lambda parameter delimiters and body braces
  belong to the same canonical node as authored ones; absence is not a separate form.
- [x] Distinguish authored expression `?` from a virtual missing expression explicitly.
  Missing punctuation and missing semantic content are different marks.
- [x] Make all required structural slots representable as authored or missing. Preserve
  genuinely optional language features separately; do not turn every `Option` into an
  omission or invent required structure for syntax the language defines as optional.
- [x] Define exact ownership of tokens, comments, whitespace, and opaque fragments
  throughout containers and EOF. Audit existing error-island/trivia mechanisms rather
  than claiming the old schema already covers arbitrary source positions.
- [x] Separate authored source extents, missing-slot anchors, affected spans, and
  projected extents. Do not reinstate `consumedEnd` as all four concepts.
- [x] Define delimiter relationships, syntax/lexical mark identity, and ordered source
  correspondence for projection. Keep lexical IDs stable within each parsed document;
  infer causal links only when established.
- [x] Implement canonical projection and pass explicit tree fixtures through the real
  diff/preview harness. Exact authored literal/opaque spelling must survive projection.
- [x] Add a complete codec for the exercised schema, including holes and damaged regions.
  Extend schema/projector/codec together as language coverage grows.

## 3. Reimplement parsing through the complete editor path

Implemented checkpoint: new `src/parser/state.wm` and `program.wm`, documented in
`src/parser/README.md`. This is canonical assembly, not the removed recognizer. It handles
plain bindings, simple names/literals/holes, groups/tuples, explicit/whitespace calls,
simple lambda parameters and blocks, with document-local identities and owned closers.
The actual pipeline is exposed by `scripts/frontend_v3_editor.ts` and the JS editor
adapter. It encodes the existing parsed document instead of parsing again for snapshots.

The WM suite has 47 passing cases. `tests/frontend_v3_parser_test.ts` independently
compares authored ownership and lexical marks against the lexer across damaged prefixes,
checks syntax references/identities and exact Keep operations. Canonical projections
reparse without new structural expectations in the exercised slice. Remaining operators,
rich patterns/types/declarations, templates and other forms remain explicit gaps.
Native work remains deferred behind the existing projector inference blocker.

- [x] Define the editor document result, including unassembled regions and diagnostics.
  Arbitrary source damage produces a usable document; internal failures stay explicit.
- [x] Recreate `src/parser/` with canonical assembly functions. Use the neutral cursor;
  virtual structure never consumes authored tokens. No strict-then-recovery mode.
- [x] Specify commitment and caller boundaries for the first productions before coding
  them. Missing structure follows established constructs; missing content creates holes.
  Preserve unclear fragments instead of ranking guessed completions.
- [x] Implement the first whole-program slice and run it through projection, full diff,
  and additive preview. Include incomplete earlier bindings followed by intact declarations.
- [ ] Add type/pattern and remaining WM forms using the retained grammar audit. Audit
  templates, member/pipe forms, records/spreads, declarations, imports and attributes.
  Never conceal an unimplemented accepted form as user damage.
- [x] Verify termination, authored ownership, pairing, hole origin, exact insertion
  positions/order, and materialized canonical structure for each exercised slice.
- [x] Inspect progress through the actual explorer/CLI output. Parsing tests alone are
  insufficient evidence of structural editor correctness.

## 4. Integrate consumers and compilation policy

- [ ] Share actual document/projection/diff results across CLI, explorer, and LSP.
- [ ] Carry hole origin into elaboration and apply the three compilation modes. Allowed
  virtual holes use the regular TODO panic; opaque damage is not implicitly executable.
- [ ] Define `wm fmt` layout edits and structural fix/TODO materialization policy over
  the same tree and projection. Check idempotence and deliberate hole-origin changes.
- [ ] Measure diff/projection behavior on editing buffers. Avoid unbounded quadratic
  token alignment on each edit; use source correspondence where available. Incremental
  identities and runtime-special virtual holes are later work, not prerequisites.

## Guardrails against drift

- Lexer/native compatibility success does not approve a parser architecture.
- Current grammar rejection tests do not define damaged-buffer behavior.
- An editor result is a marked structure with source preservation, not `Rejected`
  with the original source available somewhere outside it.
- Canonical formatting produces layout; diff makes that layout visible over source.
- No formatter, LSP, or preview layer independently guesses missing constructs.
- Inlay view is additive. Full formatting and explicit materialization are separate
  operations, with shared structural authority.
- Update completed checkboxes and actual status as work lands. Do not continue deleted
  designs because cleanup tasks remain unchecked.
