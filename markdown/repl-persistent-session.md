# A persistent REPL session

Status: done, 2026-11-06. Parse cache `10e0d2d`, persistent session `88f3417`, then analysis reuse
(step 6).

## Problem

The interactive REPL doesn't follow the Definition's model of a session (Section 8, "Programs"). For
each phrase it rewrites `session.wm` with every accepted phrase, compiles the whole session, runs the
result in a new `deno` process, and prints only the output past the previous end (`src/repl.ts`,
`runInteractiveRepl`).

So every earlier phrase is evaluated again on every new phrase. In atview that means each phrase
logs in to Bluesky again, refetches the pinned feeds and starts a worker per call. It also causes the
filed bugs `repl-task-output-prefix-truncation.md` and `repl-await-task-bindings.md`.

The Definition evaluates a phrase once, against the state the previous phrases left. A phrase that
raises leaves the basis unchanged, but its side effects stay, as they do in any SML system.

## Measurements

atview session importing `repl.wm`, offline fixture, per phrase:

| Stage | Before | After step 1 |
|---|---|---|
| load modules (parse) | 1.7 s | 0.04 s |
| analyze | 0.9 s | 0.9 s |
| emit | 0.1 s | 0.1 s |
| run in a new process, replaying every phrase | about 1 s | about 1 s |
| total per phrase | 3.8 s | 1.7 s |

After the persistent session (step 5), on the same fixture: compile about 1.3 s per phrase (analyze
1.15 s, of which module inference 0.9 s), and nothing replays. After analysis reuse (step 6): compile
about 0.4 s per phrase, with output byte-identical to an uncached compile.

## Plan

Keep one `deno` host process for the session. Each phrase becomes its own module and is imported into
the host once.

1. **Phrase modules.** Phrase `n` is the module `phrase_n.wm`. It starts with
   `export from "./phrase_{n-1}.wm" import *;` so it sees, and passes on, every earlier binding, then
   holds the phrase. This needs a local binding to shadow a re-exported one, as a later `val` shadows
   an earlier one in SML. Check that first.
2. **A shared module registry.** The emitted program keeps a per-bundle `__wm_module_instances` map
   and throws on a duplicate definition. For the REPL target, keep it on `globalThis` and skip a
   module that's already defined, so a phrase's bundle reuses the instances earlier phrases created.
   Earlier phrases and the libraries they loaded then run exactly once.
3. **Stable runtime identities.** Values cross bundles, so anything they carry must be the same in
   every compile:
   - Module keys are `__wm_module_${index}` by import-graph order (`src/module_graph.ts`), which can
     shift when a phrase imports something new. The REPL target should key modules by path.
   - `__wm_js_array_tag` and the GPU brands use `Symbol()`, so they differ per bundle. They should use
     `Symbol.for()`, as the vector tags already do.
   - Constructor IDs for user types: not checked yet. They must not depend on which phrase compiled
     them.
4. **The host.** A small JS program reads `{ path }` messages, `import()`s each phrase's bundle and
   reports completion and exit status. Output is streamed directly, so prefix slicing goes away.
   `quit` keeps its exit code.
5. **Failure.** A phrase that fails to compile changes nothing, as now. A phrase that raises keeps its
   effects, but later phrases import the previous successful phrase, so its bindings are dropped.
6. **Analysis reuse.** With phrases as modules, earlier phrases and their imports are unchanged
   between compiles, so a module-level analysis cache can also skip the 0.9 s analyze stage. Do this
   after the host works.

## As built

- Phrase modules exist only in memory, as `sourceOverrides` entries named `<repl-n>.wm` in the
  working directory, so a phrase's relative imports resolve from where `wm repl` started. `<repl-0>`
  holds the session header with every line re-exported. Phrase `n` is compiled to `n/` in a
  directory in the OS temporary directory, which also holds the host, and numbers are never reused.
- An import phrase `from "..." import ...` is written as `export from ...`, so later phrases see its
  names. `from js...` imports can't be re-exported, so an accepted one is repeated at the top of
  every later phrase module instead.
- Constructor IDs survive: a phrase that matches on a datatype an earlier phrase declared works.
- `:type` compiles `<repl-type>.wm`, which re-exports the latest accepted phrase and binds `it`, and
  analyzes it without running.
- If the host process dies with any code but `quit`'s, the REPL reports that the session's state
  was lost and starts a new host for the next phrase, which then runs its imported phrases once more.
- Analysis reuse follows MLWorks's project system (`../mlworks/src/main/_project.sml`), which keeps
  each loaded unit's static basis and reuses it while the unit and its dependencies are unchanged.
  `ModuleAnalysisCache` (`src/module_analysis_cache.ts`) keeps each module's elaborated AST and
  inference result under the content key the REPL emitter also uses (`src/module_content_key.ts`):
  path, source, and the keys of its imports. `analyzeModuleGraph` skips cached modules in every
  phase and stores new analyses only when the whole graph succeeds, so a phrase that fails to
  elaborate leaves the cache as it was. Program facts, Core and JavaScript are still built for the
  whole program each compile.
- Like MLWorks, and unlike SML/NJ's Compilation Manager, there is no cutoff: a changed module is
  analyzed again with everything that imports it, even if its interface didn't change.
- A module is analyzed once and then fixed. Delayed JS FFI types can be settled by an importer
  within one graph, so a module first analyzed in one graph keeps that settlement when a later
  graph imports it. That is how an accepted SML phrase behaves too.
- Known gap: imported schemes share their types with the cached result, as the standard library's
  already do. If a cached module ever exported a type that is not generalized, a later phrase that
  fails could still have unified it. No case of this has been seen.

## Open questions

- The remaining 0.4 s is mostly program facts, Core lowering and emit for the whole program. Caching
  those per module, or emitting only modules the host hasn't loaded, is the next step if needed.

- Watch mode (`wm repl file.wm`) re-runs a whole file on save, which is intentional there. It stays as
  it is.
- Workers: a phrase that starts a JS worker compiles the worker separately. Check that its module keys
  don't collide with the session's.
