# Recovered Project Snapshots Drop Syntax-Known Modules After an Uncertified Import

Status: open

Discovered while editing `tooling/frontend-v3/lexer.wm` through the language server.

## Summary

The recovered module graph can successfully read and phrase-recover an imported Workman file, but
the partial semantic snapshot may omit that file entirely when its importer can no longer certify
the corresponding import declaration.

This is more severe than withholding uncertified exports. The language server loses the imported
file's project-owned interface, completion facts, diagnostics, and membership even though syntax
discovery and the recovered module graph both know that the file belongs to the project.

The observed file was not wholly unparseable. One malformed expression occurred inside the
top-level `let lex = ...` phrase. Phrase recovery retained the file and its earlier imports, but
removed the failed `lex` declaration. The entry module's named import of `lex` then failed semantic
certification, causing the dependency module itself to disappear from the project snapshot.

## Reproduction Shape

```wm
-- token.wm
type TokenKind = | First | Second;
```

```wm
-- lexer.wm
from "./token.wm" import * as Token;

let lex = () => {
  Token.
};
```

```wm
-- main.wm
from "./lexer.wm" import { lex };

let main = () => {
  lex()
};
```

The recovered raw `ModuleGraph` contains `main.wm`, `lexer.wm`, and `token.wm`. The recovered
`ProjectSnapshot` can contain `main.wm` and `token.wm` while omitting `lexer.wm`, the file directly
authored and edited by the user.

## Why It Happens

`buildPartialProjectSnapshot` calls `certifiedPrefixGraph`. That operation has two effects:

1. It truncates every module to its certified declaration prefix and removes import edges whose
   declarations are outside that prefix.
2. It computes reachability from the entry module using only those remaining certified import
   edges, then removes all nodes outside that closure.

When `lexer.wm` no longer exports a certified `lex`, inference of `main.wm` fails at its first named
import. Its certified declaration prefix therefore contains no import edge to `lexer.wm`.
Reachability pruning removes `lexer.wm` from the snapshot even though the syntax graph loaded it and
recovery produced useful local facts for it.

The current model conflates two different relationships:

- **project membership discovered from source syntax**, which should remain stable enough for
  editing, diagnostics, completion, and invalidation; and
- **certified semantic dependency edges**, which must not expose failed imports as usable bindings.

Removing an uncertified semantic edge is correct. Treating that removal as proof that the source
file is no longer part of the editing project is not.

## Expected Behavior

A recovered project snapshot should retain a tooling interface for every module loaded through the
syntax-known project graph, including modules behind an uncertified import.

That interface may correctly report partial completeness and expose only locally certified
declarations. The failed import must not become a usable semantic binding in its importer. However,
the imported file should continue to own:

- its source and syntax diagnostics;
- recovered local scopes and completion facts;
- its module identity and project membership;
- invalidation links back to syntax-known importers; and
- any independently certified declarations before or after recoverable failed phrases.

This likely requires representing syntax-known/project-membership edges separately from certified
semantic dependency edges instead of making one pruned `ModuleGraph` serve both purposes.

## Current Mitigations To Revisit

Two language-server mitigations were added in `src/project_context.ts`:

1. If reverse-import discovery selects a headed snapshot that does not contain the requested file,
   the registry gives that file a recovered detached context. This restores completion and other
   per-document semantic features.
2. Invalidation also consults reverse-import discovery, so editing a file omitted from the
   certified snapshot still invalidates affected headed snapshots. This prevents an old parse
   diagnostic from surviving after the source is fixed.

These mitigations are necessary while project snapshots drop syntax-known members, but they are not
the desired ownership model. Once recovered snapshots preserve project membership:

- the detached-context fallback for a syntax-known project member should become unnecessary and
  should be removed or narrowed to genuinely uncovered files;
- reverse-discovery invalidation may remain useful as a conservative guard, but should no longer be
  the only connection between an omitted dependency and its project head; and
- the status bar should no longer describe an imported project file as detached merely because an
  export or import is temporarily ill-typed.

Do not remove either mitigation before the replacement snapshot model has regression coverage for
completion, diagnostics, edits, and project status during parse and type errors.

## Candidate Fix Direction

Preserve both graphs in the tooling snapshot:

- a syntax-known membership graph based on successfully resolved source imports, including edges
  whose declarations or exports are not semantically certified; and
- a certified semantic graph used for environments, occurrences, public exports, code generation,
  and all operations that require sound bindings.

Module interfaces for syntax-known-only members can be built from their own recovered declaration
prefix and completion facts. Dependency/import occurrence fields must continue to distinguish
uncertified edges so consumers cannot accidentally treat membership as semantic availability.

An alternative representation is acceptable if it preserves the same separation. Simply keeping
every workspace file in every snapshot would recreate the detached-file pollution that project
selection was intended to eliminate.

## Candidate Regression Tests

1. A parse error inside an imported module's exported declaration does not remove that module's
   interface from the recovered headed snapshot.
2. A type error in an exported declaration has the same membership behavior.
3. Namespace completion for imports that precede the failed phrase continues to work in the
   imported file without selecting a detached context.
4. Fixing the parse error clears the old diagnostic and rebuilds the importing head.
5. Project status continues to identify the edited dependency as owned by the same `main` head.
6. The importer cannot use a declaration whose export/import has not been certified.
7. A source file with no syntax-known path from any project head remains detached.
8. A later import outside a failed declaration prefix does not become semantically usable merely
   because its target is retained as a syntax-known project member.

## Non-Goals

- Treating failed imports as valid bindings.
- Publishing uncertified exports to dependent modules.
- Keeping every indexed workspace file in every project snapshot.
- Reusing last-known-good semantic results in place of current recovered analysis.
- Weakening declaration-prefix certification for compilation or execution.
