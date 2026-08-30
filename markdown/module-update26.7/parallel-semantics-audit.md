# Parallel-semantics audit

## Audit question

For every module rule, ask:

> Did Workman invent a parallel mechanism where the Revised Definition or a deliberately selected
> ESM rule already supplies the semantics?

Use this order of preference:

1. exact Revised SML semantics for environments, namespaces, identity, elaboration, and declaration
   evaluation;
2. an exact, explicitly selected ESM property for the file graph and module-instance protocol;
3. a restriction that rejects programs without changing the meaning of accepted SML forms;
4. a small definitional surface extension stated as an operation on SML semantic objects;
5. only then, a genuine Workman rule with its incompatibility named.

“The current compiler does it” and “this is simpler in JavaScript” are implementation evidence, not
semantic justifications.

## Pass one: audit of the plan

### Result

The overall split survives the audit:

```text
SML owns                         Workman file protocol selects from ESM
--------                         ---------------------------------------
Env/StrEnv/TyEnv/ValEnv          static resolved dependency graph
sequential elaboration           canonical module identity
shadowing and open               dependency-before-importer evaluation
nominal identity                 evaluate each ModuleId once
declaration evaluation order     remembered initialization failure
```

The audit found one plan rule that should be restated as exact SML, two extensions that need tighter
guardrails, and one area where the initial basis must not inherit current implementation tricks.

### A1. Non-re-exporting imports do not require a custom ownership calculus

Earlier drafts defined the public environment by “projecting module-owned declarations.” That gives
the right answer, but sounds like a second environment calculus.

Use ordinary SML `local` declarations as the normative explanation. For example, after resolving the
hidden file structures, this Workman sequence:

```wm
let before = 1;
from "./a.wm" import * as A;
let middle = A.value;
from "./b.wm" import *;
let after = use(middle);
```

has the following structural shape:

```sml
val before = 1
local
  structure A = Unit_a
in
  val middle = A.value
  local
    open Unit_b
  in
    val after = use middle
  end
end
```

The import environments are visible to the suffixes but are not included in the environment reported
by each `local` declaration. The ordinary SML sequential rule then combines `before`, `middle`, and
`after`. This gives declaration-ordered visibility, shadowing, and no automatic re-export without
inventing a new meaning for environment composition.

Namespace and open imports translate directly. Named projection/renaming remains a definitional
Workman extension, but its projected environment is introduced as the local part of the same
scaffolding.

**Plan action:** make this translation normative. “Module-owned” may remain useful provenance
metadata, but it must not define a second shadowing or environment-composition operation.

### A2. Named import is a real surface extension, not approximate SML or ESM

SML has separate structure, type, and value environments. ESM has one string export namespace.
Neither directly defines:

```wm
from "./lib.wm" import { Box as LocalBox };
```

when `Box` may name both a type component and a constructor/value component.

The accepted rule remains an explicit environment projection:

1. inspect every implemented namespace component of `Env(Unit_lib)` named `Box`;
2. preserve the original semantic objects and identifier status;
3. change only the local environment keys;
4. introduce the projected environment at the import declaration position.

This must not be lowered semantically to `val LocalBox = Unit_lib.Box`, because that fails to cover
the type namespace and can lose constructor status. It must not use ESM's one-namespace ambiguity
rules either.

**Plan action:** keep it classified as a definitional Workman extension and test it independently in
`StrEnv`, `TyEnv`, and `ValEnv`.

### A3. `carrier` must remain syntax, never a fabricated module value

The retained rule is:

```text
bare Module in expression position -> Module.carrier
```

Ordinary SML value lookup happens first. Only an otherwise-unbound value occurrence may use the
structure lookup fallback. This preserves the meaning of every expression already valid in the SML
fragment.

**Plan action:** prohibit implementations from inserting a value binding named `Module`, merging the
value and structure namespaces, or treating the backend namespace object as a language value.

### A4. The prelude is an initial SML basis, not a privileged import mode

The plan's `PreludeBasis` is sound, but the implementation currently realizes much of it through
special “standard library imports,” `basis`, `imported`, and `standardLibrary` flags.

Normatively, standard structures such as `List`, `Result`, and `Task` are entries in the initial
`StrEnv`, and core types and constructors are entries in the initial `TyEnv` and `ValEnv`. Ordinary
SML modification applies when source declarations or imports shadow them.

**Plan action:** compiler provenance may remember that a binding came from the standard library, but
that flag must not change collision, shadowing, qualification, or identity semantics.

The full initial-basis model, Standard ML Basis Library distinction, Millet comparison, and current
implementation audit are in [`sml-basis.md`](./sml-basis.md).

### A5. Selected ESM rules remain deliberately narrow

The following are adopted exactly enough to own their behavior:

- resolve a static request to canonical module identity;
- visit outgoing requests in source order;
- evaluate dependencies before the importer;
- evaluate one resolved module once;
- reuse completion or propagate remembered failure.

Cycles are rejected, so Workman does not claim ESM's strongly connected component or temporal
initialization semantics. Imports remain lexically declaration-ordered by SML rules even though all
graph edges are discovered before elaboration.

**Plan action:** do not use ESM lexical-binding collision rules across Workman declaration phrases,
do not expose ESM namespace objects, and do not inherit host package resolution accidentally.

### A6. Remaining Workman policy is genuinely outside SML

These rules cannot be obtained from the Revised Definition because it leaves physical files and
project loading to implementations:

- literal specifier resolution;
- opaque `ModuleId`;
- project roots and virtual sources;
- dependency-cycle diagnostics;
- executable/library/REPL entry selection;
- package and import-map policy.

They belong to the compilation-unit protocol. ESM is precedent for some choices, not a claim that
Workman modules are JavaScript modules.

## Pass two: audit of the current implementation

### Summary

The current compiler has several parallel mechanisms that must not be preserved during the module
update. Four were reproduced with focused probes during this audit:

1. importing one file as both `A` and `B` emits only the first runtime name and fails with
   `ReferenceError: B is not defined`;
2. importing only a type named `Option` deletes the existing `Some` constructor and then reports
   `unknown name Some`;
3. open-importing a module whose final environment shadows an earlier exported value emits duplicate
   JavaScript `const` declarations and fails with a syntax error;
4. named-importing two distinct `lib.wm` files emits two runtime modules named `lib` and fails with
   a duplicate JavaScript declaration.

These are consequences of the representation, not three unrelated emitter bugs.

### I1. Structures are flattened into dotted value and type keys

**Evidence:**

- [`src/infer.ts`](../../src/infer.ts) defines `StructureEnv` with values, types, and ADT metadata
  but no `StrEnv`;
- [`src/infer/imports.ts`](../../src/infer/imports.ts) inserts keys such as `Lib.value` and
  `Lib.Type`;
- [`src/core/from_surface.ts`](../../src/core/from_surface.ts) splits any dotted variable into
  record accesses.

This makes structure qualification, record projection, backend property access, and display spelling
share one string encoding.

**Required fix:** represent `Env = StrEnv × TyEnv × ValEnv` explicitly. Resolve qualification before
Core lowering. Core and later compiler facts must carry the resolved structure/member identities;
they must not rediscover semantics by splitting strings.

### I2. Structure aliases and values are treated as one conflicting namespace

**Evidence:**

- [`src/infer/decl.ts`](../../src/infer/decl.ts) rejects a local value whose spelling exists in
  `context.namespaces`;
- namespace import only rejects an existing value when the target has `carrier`, producing
  asymmetric behavior.

SML has separate `StrEnv` and `ValEnv`, so the same spelling may exist in both.

**Required fix:** remove cross-namespace collision checks. Resolve value occurrences through
`ValEnv`; use `StrEnv` for qualified structure lookup and only then apply the explicit `carrier`
fallback.

### I3. `carrier` is implemented as an imported value binding

**Evidence:**

- [`src/infer/imports.ts`](../../src/infer/imports.ts) inserts the target's `carrier` scheme under
  the namespace alias;
- [`src/binding_facts.ts`](../../src/binding_facts.ts) maps the alias to the exported carrier
  binding;
- lowering later repairs the spelling through `namespaceValues`.

This makes an implementation encoding define the namespace collision rule.

**Required fix:** keep the alias exclusively in `StrEnv`. Record a resolved
`NamespaceCarrierSelection` fact for the expression occurrence and lower that fact to a member
access.

### I4. Import collision checks replace SML environment modification

**Evidence:** [`src/infer/imports.ts`](../../src/infer/imports.ts) rejects existing non-basis values
and types for named, namespace, and open imports. Current tests enshrine those rejections.

**Required fix:** retain duplicate-local rejection inside one named-import clause, then use
right-biased SML composition across phrases and independently in each namespace. Convert existing
cross-phrase rejection tests into shadowing and binding-target tests.

### I5. Import analysis is sequential in inference but hoisted in binding facts

**Evidence:** [`src/binding_facts.ts`](../../src/binding_facts.ts) constructs `importedEnv(imports)`
before visiting any declaration, while `resolveDecl` ignores `ImportDecl`.

This is a second scoping implementation beside inference. It will assign wrong target IDs when
imports and shadowing are interspersed, even if inference accepts the program after collision fixes.

**Required fix:** process each resolved import edge at its actual declaration position in the same
semantic environment walk used by binding resolution. Prefer compiler-owned resolved binding facts
from elaboration over independently reconstructing scope.

### I6. Runtime import aliases are hoisted and keyed by source names

**Evidence:** [`src/core/emit_js.ts`](../../src/core/emit_js.ts) calls `emitImportAliases` before
emitting every declaration in the module body.

This disagrees with declaration-ordered imports and cannot represent repeated shadowing safely. It
also emits all historical `dynamicExports` for an open import, which creates duplicate JavaScript
declarations when the exporting module shadows a name.

**Required fix:** lower imports at their declaration positions or eliminate runtime alias
declarations by emitting resolved binding references directly. Runtime exports must be derived from
the final public `ValEnv`, not from an append-only list of historically exported declarations.

### I7. Backend module names depend on the first importer alias or basename

**Evidence:**

- [`src/module_graph.ts`](../../src/module_graph.ts) chooses `emitName` from the first namespace
  alias and otherwise from the filename stem;
- [`src/core/emit_js.ts`](../../src/core/emit_js.ts) emits exactly one object with that name;
- qualified Core expressions retain each local source alias.

This caused the confirmed `A`/`B` runtime failure. Distinct files with the same basename can also
compete for one JavaScript declaration name.

**Required fix:** allocate a unique backend name from compiler identity, independent of every local
alias and display path. Each structure alias resolves to the target `ModuleId`; lowering connects
the alias occurrence to the target backend object without spelling-based lookup.

### I8. Type shadowing deletes value constructors as a side effect

**Evidence:** [`src/infer/imports.ts`](../../src/infer/imports.ts) calls `removeBasisConstructors`
when an imported type shadows a basis type name.

SML environment components are independent. Shadowing `TyEnv["Option"]` does not delete
`ValEnv["Some"]` or `ValEnv["None"]`; they continue to denote constructors of the older nominal type
until separately shadowed.

**Required fix:** remove automatic constructor deletion. Let explicit constructor imports or later
value declarations replace the old value bindings through ordinary `ValEnv` modification.

### I9. Source specifiers and paths serve as semantic links

**Evidence:**

- graph nodes and identities are plain path strings;
- inference receives a map keyed by the original import specifier;
- nominal facts store `modulePath`;
- the LSP and emitter also consume these strings for identity or naming.

**Required fix:** introduce opaque `ModuleId` and a resolved import occurrence fact linking the AST
import directly to its target. Keep specifier, canonical local path, display path, and emit name as
separate fields.

### I10. The standard library uses privileged import behavior

**Evidence:** [`src/standard_library.ts`](../../src/standard_library.ts) injects namespace imports,
and imported schemes carry special `standardLibrary` and `basis` flags that affect import collision
handling.

**Required fix:** expose one explicit initial SML basis to elaboration. Preserve origin metadata for
diagnostics and tooling, but route shadowing and qualification through the same environment
operations as every other binding.

### I11. Cycle diagnostics do not yet retain the complete edge path

**Evidence:** [`src/module_graph.ts`](../../src/module_graph.ts) detects the closing edge with a
`visiting` set but reports only the involved child path.

**Required fix:** retain the DFS edge stack and report the ordered cycle of import occurrences. This
is Workman graph policy, not SML semantics.

### I12. Initialization behavior is mostly correct but only implicit

The graph loader produces dependency-first DFS postorder, and the emitter evaluates each non-entry
module through one async IIFE. A thrown dependency prevents later importer code, while already
performed effects remain.

**Required fix:** add semantic tests for source-ordered sibling effects, diamonds, repeated
specifiers resolving to one module, failure propagation, and entry `main` separation. Then represent
module initialization explicitly enough that another backend cannot silently choose different
semantics.

## Implementation guardrails

The module update must satisfy all of these:

- no semantic lookup parses a dotted string;
- no backend name is derived from a local structure alias;
- no compiler phase reconstructs import scope independently from elaboration;
- no import or basis provenance flag changes SML shadowing;
- no type-environment update silently deletes value-environment entries;
- no runtime namespace object is exposed as a Workman module value;
- no append-only declaration list substitutes for the final public environment;
- every deliberate deviation is labeled restriction, definitional extension, or Workman protocol.

## Priority

### Correctness foundation

1. explicit `StrEnv` and resolved import/member facts;
2. SML collision and shadowing behavior;
3. declaration-position binding resolution;
4. removal of carrier value injection and basis-constructor deletion.

### Lowering and runtime

5. identity-derived unique backend names;
6. binding-ID-based import lowering;
7. final-environment runtime exports;
8. initialization and failure tests.

### Protocol and tooling handoff

9. opaque `ModuleId` and resolved edge facts;
10. complete cycle paths;
11. explicit initial basis;
12. interface artifacts and later LSP consumption.
