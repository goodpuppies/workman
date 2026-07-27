# Module update checklist

## How to use this document

This is the canonical progress tracker for the module update. The research documents explain why;
this file records what remains.

Checkbox meanings:

- `[ ]` not started;
- `[x]` complete with the stated evidence.

For active or blocked work, retain an unchecked box and append **in progress** or **blocked: ...**.

An item is complete only when its code, focused tests, and relevant documentation agree. A passing
JavaScript snapshot alone is not sufficient evidence for a semantic item.

## Locked constraints

These are not implementation choices to reopen while working through the checklist:

- [x] **C001** Shared language forms use exact Revised SML semantics.
- [x] **C002** File resolution and initialization use the separately specified Workman protocol.
- [x] **C003** Imports remain declaration-ordered for lexical visibility.
- [x] **C004** The file graph is acyclic.
- [x] **C005** Files are public by default; `private` is deferred.
- [x] **C006** Imports do not automatically re-export their targets.
- [x] **C007** Structures, types, and values occupy separate semantic namespaces.
- [x] **C008** A file namespace is static and is not a first-class Workman value.
- [x] **C009** `Module` expression fallback means `Module.carrier`, after ordinary value lookup.
- [x] **C010** Later phrases use SML right-biased modification in each namespace.
- [x] **C011** A resolved local file has one opaque, resolver-owned `ModuleId`.
- [x] **C012** Dependencies initialize once, dependency-first, in source-edge DFS order.
- [x] **C013** Initial-basis semantics follow SML independently of Workman's library size.
- [x] **C014** Workman operators are fixed syntax, not user-rebindable `ValEnv` identifiers.
- [x] **C015** The first refactor preserves the current default source API unless correctness
      requires a change; it does not add a new stdlib API.
- [x] **C016** Compiled standard-library initialization is observationally effect-free.
- [x] **C017** Package resolution, persistent fingerprints, `private`, re-export, and cyclic modules
      are outside the first implementation.
- [x] **C018** The per-module, per-project-snapshot interface is the sole semantic API for all
      tooling.
- [x] **C019** Incomplete editor input uses compiler-produced facts from the current snapshot, with
      explicit structured completeness and no LSP-invented environment.
- [x] **C020** Workspace containment does not imply project membership.
- [x] **C021** One Workman project is one `main` head plus its complete reachable graph. Opening an
      existing member uses that project; only a file outside every active graph searches for its
      closest head.
- [x] **C022** Project membership is independent of document-open state; document context remains
      stable while its selected project still contains it.

Evidence: [`decisions.md`](./decisions.md) and [`proposed-semantics.md`](./proposed-semantics.md).

## Stage 0: Specification lock and inventories

Dependencies: locked constraints only.

- [x] **S001** Review `proposed-semantics.md` line by line and remove “proposed” wording from every
      accepted normative rule. The document now states it is the accepted normative specification
      (the filename is historical), and the four hedged rules — resolution path form, structural
      environment representation, and the interface artifact — are stated as implemented facts with
      decision citations. Deferred areas (packages, fingerprints) retain future wording because
      they are genuinely deferred, not proposed.
- [x] **S002** Build the SML conformance matrix described in
      [`sml-correctness-audit.md`](./sml-correctness-audit.md).
- [x] **S003** Record exact Definition rules/translations for sequential declarations, `local`,
      `open`, namespace separation, schemes, constructor status, and nominal identity.
- [x] **S004** Inventory every current initial type, constructor, value, operator, intrinsic,
      standard structure, and pervasive binding.
- [x] **S005** Classify each inventory entry as language kernel, host intrinsic, source-defined
      standard member, or explicit pervasive projection.
- [x] **S006** Record the exact compatibility interface for the `default` profile.
- [x] **S007** Record the exact interface for `@no-prelude`: mandatory language/host facts remain;
      optional source library structures and pervasive additions do not.
- [x] **S008** Give every initial binding one static owner and one dynamic owner.
- [x] **S009** Inventory every current semantic use of canonical path, source specifier, display
      path, module alias, basename, emit name, numeric type ID, and constructor ID.
- [x] **S010** Add a discrepancy log mapping every audit finding (`I1`–`I12`, `B1`–`B9`) to one or
      more checklist items.
- [x] **S011** Update `docs/smlparallels.md` terminology after the normative review. The Modules
      section now states the two-foundation split, the SML environment product, long-identifier
      lookup, right-biased modification, declaration-position imports, non-re-export via the
      `local` model, the protocol's ESM-derived properties, and the SML-model initial basis; the
      translation table no longer calls a file a "flat structure".

Gate:

- [x] **G0** No first-pass implementation behavior depends on an unanswered semantic question.
- [x] **G1** Every current basis entry and module identity string has a classified migration target.
- [x] **G2** Every shared semantic operation needed by an import has a Definition citation and test
      plan.

## Stage 1: Characterization and failing regressions

Dependencies: `G0`–`G2`.

### Identity and graph

- [x] **T101** Permanently test one canonical file imported through two namespace aliases.
- [x] **T102** Test normalized relative specifiers resolving to one module instance.
- [x] **T103** Test two distinct same-basename files.
- [x] **T104** Test two distinct files containing textually identical datatype declarations.
- [x] **T105** Test virtual-source identity stability within one project snapshot.
- [x] **T106** Test a cycle diagnostic containing the complete ordered import-edge path.

### Static environments

- [x] **T107** Test value and structure bindings sharing one spelling.
- [x] **T108** Test value and type bindings sharing one spelling.
- [x] **T109** Test namespace, open, and named imports preserving values, types, constructors,
      constructor status, records, and nominal identities.
- [x] **T110** Test imported polymorphic values at multiple independent types through every import
      form.
- [x] **T111** Test imports before, between, and after shadowing declarations.
- [x] **T112** Test later imports shadowing earlier locals and imports within each namespace.
- [x] **T113** Test later local declarations shadowing imports and initial-basis bindings.
- [x] **T114** Test a later open import winning for overlapping members.
- [x] **T115** Test that type shadowing does not delete a constructor value binding.
- [x] **T116** Test named projection/renaming independently in `StrEnv`, `TyEnv`, and `ValEnv`.
- [x] **T117** Test rejection of duplicate local targets within one simultaneous named-import
      clause.
- [x] **T118** Test that prelude and imported bindings are not automatically re-exported.
- [x] **T119** Test that imports are unavailable before their declaration position.
- [x] **T120** Test ordinary value lookup winning over namespace-to-`carrier` fallback.
- [x] **T121** Test missing `carrier` as an ordinary qualified-lookup error.

### Runtime

- [x] **T122** Test dependency initialization once through a diamond graph.
- [x] **T123** Test source-edge DFS order for independent effectful dependencies.
- [x] **T124** Test source declaration evaluation order with interspersed imports and shadowing.
- [x] **T125** Test dependency failure preventing importer initialization.
- [x] **T126** Test remembered dependency failure on repeated requests.
- [x] **T127** Test that effects completed before initialization failure are retained.
- [x] **T128** Test entry `main` invocation only after successful graph initialization.
- [x] **T129** Test namespace, open, and named imports at analysis, Core, and emitted-runtime
      layers.

### Initial basis

- [x] **T130** Snapshot the static interface of every selected basis profile.
- [x] **T131** Test every statically visible initial value has a runtime implementation.
- [x] **T132** Test primitive type arity, equality behavior, and nominal identity.
- [x] **T133** Test datatype constructor metadata and `ValEnv` status refer to the same constructor.
- [x] **T134** Test pervasive projections resolve to the same semantic targets as structure members.
- [x] **T135** Test fixed operator typing/evaluation without looking up a user `ValEnv` binding.
- [x] **T136** Test that ordinary initial values such as `print` can be shadowed.
- [x] **T137** Test that building the compiled standard library has no visible user effect.

Gate:

- [x] **G3** Every known reproduced failure has a focused regression that fails for the intended
      semantic reason.
- [x] **G4** Existing conforming behavior has characterization coverage before representation
      changes begin.
- [x] **G5** Tests distinguish analysis, Core lowering, and runtime behavior.

Known-failure evidence:
[`tests/module_update_regression_test.ts`](../../tests/module_update_regression_test.ts) contains
the desired-semantics regressions introduced by the audit. The six original regressions are now
enabled permanently and passing. Add further audit regressions here or in the closest focused suite
before implementing their corresponding slice.

The two `carrier` tests in [`tests/module_test.ts`](../../tests/module_test.ts) (`T120`) asserted
that emitted JavaScript literally contained `Lib.carrier`. `R502` gives backend aliases
compiler-owned identities, so the emitted spelling is `Lib_0.carrier` and both tests failed against
correct behavior. They now assert the semantic shape and the runtime result instead of an emit
spelling, which is what `G18` requires: a backend rename must not be observable as a source-level
fact. An emitted-name assertion is not valid evidence for a semantic item.

## Stage 2: Semantic foundations

Dependencies: `G3`–`G5`.

### Module identity

- [x] **M201** Introduce an opaque `ModuleId` type owned by the resolver.
- [x] **M202** Separate source specifier, resolved local identity, display path, and backend emit
      name in graph nodes and edges.
- [x] **M203** Make all graph, analysis, and interface maps key on `ModuleId`.
- [x] **M204** Preserve ordered edge records with referrer, specifier location, and target
      `ModuleId`.
- [x] **M205** Remove basename and first-importer alias from semantic or backend identity.
- [x] **M206** Define stable virtual-source identity for one project snapshot.
- [x] **M207** Emit complete cycle paths from ordered edge records.

### SML-shaped environments

- [x] **M208** Introduce explicit `Env = StrEnv × TyEnv × ValEnv`.
- [x] **M209** Represent `StrEnv` recursively as structure identifiers mapped to environments.
- [x] **M210** Give values, types, constructors, structures, and aliases compiler-owned semantic
      identities/origins.
- [x] **M211** Implement namespace-specific, right-biased environment modification once.
- [x] **M212** Implement environment opening using the same modification operation.
- [x] **M213** Implement namespace-preserving named projection and key-only renaming.
- [x] **M214** Preserve schemes, identifier status, nominal identity, and intrinsic metadata during
      projection.
- [x] **M215** Remove semantic dotted-name splitting and construction. The AST now
      carries the Definition's long identifier (Section 2.4, `LongX = StrId* x X`) as
      `LongId = { qualifiers, id }` on the four nodes that can be qualified: `Var`, `PPinned`, and
      `PCtor` (`longvid`) and `TName` (`longtycon`). The grammar builds it directly; `name` is
      retained only as the authored display/emit spelling. Semantic resolution consumes the
      structured path and no longer splits: `E(longvid)`/`E(longtycon)` (`resolveLongValue`,
      `resolveLongType`, `lookupLongEnvironment`, `insertQualified`), constructor and pinned pattern
      lookup, the record-projection fallback, unguarded-recursion detection, basis origin structure
      attribution, constructor exhaustiveness matching, and GPU receiver/swizzle resolution.
      `parseLongId` is the single sanctioned string-to-`LongId` construction point and is used only
      for compiler-owned table keys (basis manifest, standard-structure members), authored FFI
      spellings with no parsed node, and current-source text scanned near the cursor. Module
      interface occurrence assembly and the recovered signature-help callable now consume
      `pathOf`/`parseLongId` instead of ad-hoc splits, and the grammar's task tuple lift supplies
      structured paths for its generated `Task.map`/`Task.andThen` references. Remaining dotted
      splitting is confined to Core lowering and emit names (permitted by D16: `desugarDottedVar`
      runs after resolution with binding identities attached) and to JavaScript FFI host member
      paths, reflected foreign-type keys, and the wmslang GPU backend, which `D33` permanently
      excludes from long-identifier semantics. The `[module update M215]` regression proves every
      source-derived qualified node carries the structured path and that spellings render exactly
      from it. `path` remains optional on the node types, like `node?`: programmatic constructors
      in FFI lowering build compiler-internal names, and `pathOf` is the single accessor whose
      fallback runs through the sanctioned constructor. Enforcement is therefore by construction
      and regression, not by the type system.
- [x] **M216** Permit the same spelling in separate structure, type, and value components.

Gate:

- [x] **G6** Compiler consumers cannot inspect a `ModuleId` as a display or emit string.
- [x] **G7** Semantic qualification uses `StrEnv`; dotted strings exist only after resolution.
      Qualification has always walked `StrEnv`; the remaining gap was that its key was a re-parsed
      dotted string. Elaboration now consumes the parser-produced `LongId` throughout (see `M215`),
      so a dotted string is no longer a semantic key anywhere in the SML fragment. `D33` classifies
      the non-SML host paths (JS FFI members, reflected foreign-type keys, GPU backend) as
      permanently outside long-identifier semantics, which closes the scope question this gate was
      waiting on.
- [x] **G8** Environment composition has one SML-defined implementation used by basis, import, open,
      and local declaration paths.

## Stage 3: Initial basis correction

Dependencies: `G7`–`G8` and `S004`–`S008`.

- [x] **B301** Introduce immutable `InitialBasis` and `BasisProfile` compiler artifacts.
- [x] **B302** Consolidate primitive type identity, arity, equality, constructor, overload,
      operator, and intrinsic descriptions. `basis_manifest.ts` owns type identity, arity, equality,
      constructor identity and runtime names, the fixed binary and unary operator catalogs, host
      values, and GPU intrinsics. `basisCtorJsName` returns the manifest's declared `runtimeName`
      instead of recomputing the same `__wm_basis_*` formula, so a constructor's runtime name is one
      fact rather than two agreeing copies. `BASIS_UNARY_OPERATORS` describes `!`, replacing the
      hand-written `switch` in `emit_js` and the hand-written definition in the prelude; unary `-`
      deliberately has no entry because it shares the binary `-` descriptor, whose implementation
      distinguishes the tuple and scalar cases. Overload descriptions are the GPU builtin rows,
      which live in the generated, versioned wmslang builtin catalog consumed by both the GPU
      dialect and the interface artifact; per `D33` the GPU domain owns that single description
      rather than duplicating it into the kernel manifest.
- [x] **B303** Build corresponding static and dynamic kernel artifacts from the same description.
      Constructors already emitted from `BASIS_TYPES`; operator definitions were hand-written
      JavaScript whose names could drift from the manifest's `runtimeName`. The emitted prelude now
      derives each operator's runtime name from the binary and unary catalogs and supplies only the
      body, and a manifest entry with no implementation fails the build with an explicit message.
      Verified by renaming operators in the manifest: the emitted definition, Core lowering, and a
      running program all follow the rename, which previously would have produced a reference to an
      undefined runtime value. Host values, intrinsics with runtime names, and constructors are now
      also verified dynamically: a compiled library binds every fact's export name and the test
      asserts none evaluate to `undefined`, which catches a missing member of an existing namespace
      object that reference-only compilation would let through. A negative control (removing
      `textOf` from the emitted `Result`) fails the test naming exactly `Result.textOf`.
- [x] **B304** Move fixed operators out of the ordinary value environment into the kernel syntax
      catalog.
- [x] **B305** Keep ordinary pervasive values shadowable through normal `ValEnv` composition.
- [x] **B306** Install `List`, `Option`, `Result`, `Task`, `Js`, `Gpu`, and other qualified
      facilities through real structure environments according to the approved inventory.
- [x] **B307** Compile every source-expressible `std/*.wm` module through the ordinary front end.
- [x] **B308** Install compiled standard public environments without privileged import collision
      behavior.
- [x] **B309** Define pervasive bindings through an explicit projection table.
- [x] **B310** Preserve the current default source API or document each correctness-required
      compatibility change.
- [x] **B311** Make `@no-prelude` select its recorded minimal profile rather than scattered
      conditionals.
- [x] **B312** Remove `basis`, `imported`, and `standardLibrary` from collision semantics.
- [x] **B313** Remove basis-constructor deletion when a type key is shadowed.
- [x] **B314** Replace separate handwritten semantic-ID tables with derived or validated identities.
- [x] **B315** Give every `Result` and `Task` member one owner.
- [x] **B316** Replace semantic JavaScript object merging for standard structures.
- [x] **B317** Make standard-library build order deterministic and effect-free.
- [x] **B318** Expose basis membership, pervasive aliases, constructor status, and intrinsic tags as
      compiler facts.
- [x] **B319** Give ordinary initial-basis values, compiled-standard public values, and basis
      structures stable semantic identities. Pervasive projections retain their source target
      identity rather than receiving an alias-local identity.

Gate:

- [x] **G9** Static and dynamic profile snapshots correspond exactly. `T130` snapshots both profile
      interfaces; `T131` proves every statically visible initial value has an implementation fact
      and compiles; operator and constructor runtime names derive from one description with
      emitted-definition and no-stray-definition regressions plus a fail-loud guard for catalog
      entries without implementations; and the defined-runtime-value regression evaluates every
      basis fact, including dotted host members such as `Js.Array.toList` and `Result.textOf`,
      proving none are `undefined` at runtime.
- [x] **G10** Standard structures use the same lookup and shadowing rules as imported structures.
- [x] **G11** No provenance flag or backend object merge changes language binding semantics.
- [x] **G12** The default profile retains its approved compatibility interface.

## Stage 4: Declaration-ordered import elaboration

Dependencies: `G6`–`G12`.

- [x] **I401** Make graph discovery collect every edge without installing lexical bindings.
- [x] **I402** Elaborate each dependency public environment once per `ModuleId`.
- [x] **I403** Consume imports at their declaration positions in binding and inference facts.
- [x] **I404** Bind namespace imports as static `StrEnv` aliases only.
- [x] **I405** Implement open imports as SML environment opening.
- [x] **I406** Implement named imports as namespace-preserving environment projection.
- [x] **I407** Preserve target declaration identities through every import form.
- [x] **I408** Replace import collision rejection with sequential SML modification.
- [x] **I409** Retain only the simultaneous named-clause duplicate-target restriction.
- [x] **I410** Derive a module's inferred public environment using the normative nested-`local`
      model.
- [x] **I411** Keep imported and prelude bindings out of the public environment.
- [x] **I412** Remove the fabricated namespace value used for `carrier`.
- [x] **I413** Resolve bare namespace expression fallback only after ordinary value lookup.
- [x] **I414** Diagnose missing members through structural qualified lookup.
- [x] **I415** Ensure dependency compile order grants no ambient lexical visibility.

Gate:

- [x] **G13** Static import behavior passes `T107`–`T121` through one environment model.
- [x] **G14** Repeated/renamed imports share target semantic and nominal identities.
- [x] **G15** Public environments contain exactly module-introduced declarations.

## Stage 5: Lowering and runtime protocol

Dependencies: `G13`–`G15`.

- [x] **R501** Carry resolved module, structure, member, declaration, and intrinsic identities into
      Core.
- [x] **R502** Allocate collision-free backend module names independently of source aliases and
      basenames.
- [x] **R503** Lower qualified access from resolved structure/member facts.
- [x] **R504** Lower namespace-to-`carrier` fallback without creating a module runtime value.
- [x] **R505** Derive runtime exports from the final inferred public environment.
- [x] **R506** Derive runtime aliases from resolved import occurrences, not source-name history.
- [x] **R507** Preserve declaration-position binding semantics despite dependency-first module
      initialization.
- [x] **R508** Make module instance states explicit: uninitialized, initializing, completed, failed.
- [x] **R509** Initialize outgoing dependencies by source-edge DFS order.
- [x] **R510** Reuse a completed instance and remember a failed instance.
- [x] **R511** Reject cycles before entering the initializing state.
- [x] **R512** Preserve effects performed before failure and prevent importer start.
- [x] **R513** Align executable, library, test, and REPL graph initialization.
- [x] **R514** Keep entry `main` invocation outside module initialization.
- [x] **R515** Remove accidental dependence on JavaScript namespace-object semantics.

Gate:

- [x] **G16** All identity, ordering, failure, same-basename, and repeated-alias runtime regressions
      pass.
- [x] **G17** Analysis, Core, and runtime select the same target for every tested occurrence.
- [x] **G18** Backend renaming cannot alter source-level binding or module identity.

## Stage 6: Module interface artifact

Dependencies: `G13`–`G18`.

- [x] **A601** Define a compiler-owned module interface containing `ModuleId`, source range, public
      `Env`, declaration origins and visibility, nominal identities, dependency edges, diagnostics,
      and structured completeness. Source/identity queries resolve definitions through those
      compiler facts; the remaining feature breadth is tracked by `A608` and `G21`.
- [x] **A602** Include exact initial-basis profile identity and opaque generation in analysis
      inputs, inference results, every module interface, and the owning project snapshot. Interface
      assembly records the same `InitialBasis` artifact consumed by inference rather than inferring
      profile ownership afterward.
- [x] **A603** Expose resolved module paths, named import sources, explicit named aliases, and
      namespace aliases separately from their target declarations while retaining every projected
      namespace identity.
- [x] **A604** Expose module structure aliases and compiler-resolved qualifier occurrences for
      values, constructors, pinned patterns, and types. Qualified type uses retain the exact
      elaborated `StaticEnv`, so repeated aliases of one target keep distinct `StructureId`s without
      a syntax-derived resolver.
- [x] **A605** Expose dependency and reverse-dependency relationships.
- [x] **A606** Begin with conservative dependent invalidation and a snapshot-local interface
      generation.
- [x] **A607** Make the artifact per project snapshot and prevent path identity from merging
      interfaces produced in different project contexts.
- [x] **A608** Add per-module semantic occurrences, scopes, types, and
      bidirectional source mapping. Value, structure, type-declaration, and constructor occurrences
      now carry source spans and compiler identities. Type uses are reported by elaboration and
      translated to stable project type identities. Nominal record-field declarations, literals,
      patterns, and inference-resolved projections share stable field identities; structurally
      ambiguous projections select the first candidate identity and emit an annotation warning
      without collapsing the receiver's structural row. Labels with no nominal candidates remain
      structural and have no nominal target. Compiler-owned lexical scope snapshots now cover
      declaration-ordered top-level declarations, imports, blocks, lambdas, and match arms using the
      same `BindingId` and `StructureId` resolver as lowering. The semantic interface overlays those
      snapshots on the captured initial static environment, including stable basis/standard value,
      structure, constructor, and type identities. Local and imported types and constructors also
      retain their nominal identities and independent namespace shadowing at each checkpoint. JS
      imports now receive lowering-safe compiler binding identities plus an explicit compiler-owned
      relation from generated FFI aliases back to the authored import binding; source scopes and
      occurrences never expose compiler-only aliases. Reflected foreign types receive stable nominal
      identities, declaration spans, public origins, and scope entries. Compiler-owned type-variable
      regions now cover simultaneous declaration groups, lambda annotations, and explicit
      record/datatype parameters. They expose elaborator identities, lexical extents, reference
      spans, optional explicit binder spans, scope membership, and definition mapping; failed
      declarations contribute no regions to partial interfaces. Every elaborated expression,
      pattern, and authored type expression with a source node now appears in an immutable
      typed-node index. Offset queries prefer the smallest containing node, preserve generalized
      binder schemes versus instantiated uses, retain nominal identity through shadowing, and
      exclude failed phrases while including independently recovered later phrases. Named
      value/constructor import source and alias occurrences retain the target's generalized scheme
      while ordinary references retain their local instantiation. Typed nodes also retain authored
      source labels, optional generalized schemes, and compiler-owned presentation facts for
      generated FFI receivers. Compiler-owned top-level declaration facts provide declaration and
      selection spans plus datatype-constructor children for structural tooling. Occurrence
      completeness is now audited and derived rather than hardcoded: a permanent regression walks
      every authored named node (values, constructors, pinned patterns, type uses, and pattern
      binders at any nesting depth, across namespace/named/open imports, qualified projections,
      match arms, list patterns, and blocks) and proves each has a semantic occurrence inside its
      span; nodes fabricated by list desugaring are excluded because their spelling does not appear
      in the authored source. Strict complete elaboration therefore reports
      `occurrences: "complete"`, while recovered analyses remain `partial` because failed phrases
      contribute no occurrences. The audit also exposed and fixed a real inference gap: record
      projection through a qualified value member (`Lib.origin.x`) was rejected as unknown before
      `resolveLongValue`'s remaining-field contract could reach `inferDottedVar`; it now
      typechecks, lowers, and runs. Scope completeness is audited and derived the same way: a
      permanent regression proves every reference and qualifier occurrence is reproducible from the
      lexical scope at its own offset with the same compiler identity, across SML, cross-module,
      and FFI modules. Per `D33` an FFI receiver's authored name is satisfied by its
      foreign-type scope entry, and the audit found and fixed a real leak: receiver-model
      `__ffi_*` helper bindings carried no authored relation and appeared in source scopes;
      the scope overlay now excludes them, restoring the documented rule that compiler-only
      aliases never appear. Strict complete elaboration therefore reports both
      `occurrences: "complete"` and `scopes: "complete"`; recovered analyses remain partial.
      Ordinary basis and compiled-standard value references are included even
      though they have no project-local `BindingId`. Value, constructor, and nominal-field
      occurrences now reference immutable semantic type snapshots rather than mutable inference
      objects. Result carrier-lifting plans are source-mapped into the interface and reference the
      same immutable type arena for their error and payload-result types. GPU overload obligations,
      builtin/resource occurrences, selected fragment roots, and selector calls are likewise
      source-mapped and share that arena. Normalized inputs are recursively frozen on the
      root-owning interface, and an immutable project/generation-keyed compiler query exposes final
      specialized occurrence types, representation evidence, shader types, and builtin selections.
      GPU hover consumes only these interface-owned facts; applicable GPU completeness is complete
      and modules without GPU semantics report `not-applicable`. Current-source completion facts
      preserve name-only value, structure, type, and constructor scopes plus GPU regions before
      failed phrases are transactionally removed. Initial-basis target types and basis-structure
      members are immutable interface facts. The compiler's protocol-neutral completion query owns
      context selection, catalog merging, prefix filtering, lexical shadowing, namespace members,
      nominal record fields, recovery-only candidates, keywords, and ranking without assigning
      semantic identities to uncertified names. Final-graph FFI facts explicitly expose authored JS
      targets, modes, binding identities, fallibility, signature types, structure aliases, and
      reflected foreign-type identities while excluding generated aliases. FFI completeness
      distinguishes strict applicable, absent, and certified-partial analysis. Delayed reflected
      types use ordinary `StrEnv` qualification rather than flat dotted lookup.
- [x] **A609** Replace the completeness boolean/diagnostic heuristic with structured syntax, import,
      elaboration, occurrence, scope, FFI, and GPU completeness.
- [x] **A610** Expose the current conservative declaration-prefix interface produced by
      `inferModulePartial`. The inference result records the exact accepted declaration count,
      failure phase, and recovery boundary. A failed declaration is transactionally discarded by
      re-elaborating the accepted prefix from a clean initial environment, and partial project
      snapshots contain only imports/modules reachable through certified prefix declarations.
- [x] **A611** Extend compiler recovery to transactional top-level phrases: a failed phrase
      contributes no basis change and later recoverable phrases use the last committed basis. The
      compiler shares the REPL's delimiter-aware top-level phrase scanner, masks malformed phrases
      without changing source offsets, and re-elaborates the surviving declaration set from a fresh
      initial environment after each static failure. Independent later declarations and imports
      remain; declarations depending on a failed binder fail as their own phrases.
      Unresolvable/cyclic imports are removed with import-partial completeness rather than blocking
      the rest of the module. Recovery inside one malformed phrase remains frontend-v2 territory.
- [x] **A612** Define project snapshots keyed by one `main` head and configuration, overlapping
      reachable closures, and detached-document snapshots without treating every workspace file as a
      participant. Snapshots record headed/detached kind and frontend/surface configuration;
      active-context keys include configuration, and overlapping closures retain separate snapshot
      ownership.
- [x] **A613** Build a lightweight reverse-import discovery index used only when an open file is
      outside every active project graph; it finds one closest main-bearing head without
      typechecking or semantically enrolling every indexed file. Equal-distance candidates use
      canonical path order as the deterministic one-head tie break.
- [x] **A614** Ensure a dependency-local `main` remains ordinary unless that module is independently
      selected as another project head. Active reachable coverage is checked before reverse
      discovery.
- [x] **A615** Keep reverse head selection and forward reachable-graph expansion as separate one-way
      phases; forward expansion must never trigger another reverse head search. Both the compiler
      registry and LSP validation index implement this ordering.

Gate:

- [x] **G19** No compiler or tooling consumer must reconstruct module semantics from syntax, paths,
      dotted names, or emitted JavaScript. Semantic elaboration consumes structured long identifiers
      (`M215`/`G7`); every LSP feature routes through `ProjectSnapshot`/`ModuleInterface` queries
      with the handwritten resolver and hover fallback deleted (`L710`); `src/lsp/` contains no
      dotted-name splitting or path-derived identity (`L705`). Frontend-v2 remains a syntax
      frontend feeding ordinary elaboration, which the contract permits; it supplies no semantic
      facts of its own.
- [x] **G20** Conservative invalidation is correct before optimization with fingerprints.
- [x] **G21** The interface artifact contains every fact listed in the LSP handoff: `ModuleId`,
      public environments, declaration/alias/target identities, namespace membership, basis facts,
      dependency and reverse-dependency edges, interface generations, and graph/initialization
      diagnostics (`A601`–`A615`, all closed). Occurrence and scope coverage are audited by the
      `A608` regressions rather than asserted.
- [x] **G21a** The same path can participate in two project snapshots without interface, diagnostic,
      occurrence, or nominal-identity collision.
- [x] **G21b** Current malformed source exposes only compiler-certified partial facts; no consumer
      needs a fallback semantic environment. Transactional phrase recovery (`A610`/`A611`) feeds
      every LSP path; failed phrases contribute no bindings, occurrences, scope entries, or typed
      nodes; recovered analyses report partial completeness by derivation; and the former LSP
      fallback resolvers are deleted (`L710`). Recovery-only completion scopes carry names without
      invented identities.
- [x] **G21c** One or more heads may share source modules without merging their project-specific
      interfaces, and discovery-only files produce no project diagnostics.
- [x] **G21d** Opening a file already contained in an active project uses its existing module
      interface and performs no reverse-head search or membership mutation.
- [x] **G21e** Reaching library code while expanding one selected head cannot activate a second
      library test/example head.

Current Stage 6 evidence:

- [`tests/module_interface_test.ts`](../../tests/module_interface_test.ts) covers strict structured
  completeness despite warnings, one project owner across a graph, separate ownership for repeated
  analyses of the same paths, dependencies/reverse dependencies, conservative invalidation,
  source-to-occurrence lookup, identity-to-project-occurrences lookup, namespace qualifiers,
  elaborator-resolved type uses, and separate named-import source/alias occurrences that retain
  simultaneous type/constructor targets. Nominal record fields retain identity across declaration,
  construction, pattern, projection, and module boundaries. Ambiguous projections select the first
  candidate identity with a warning while retaining their structural receiver constraint; only
  projections with no nominal candidates lack a field identity. Scope queries cover sequential
  top-level and block declarations, lambda-local binders, initial-basis values/types/structures,
  simultaneous imported type/constructor identities, independent namespace shadowing, and exclusion
  of locals outside their lexical region. Type-variable tests cover shared declaration-group
  identity, separate later groups, lambda parameter/result regions, explicit record/datatype
  parameter binders, definition mapping, shadowing, and certified-prefix recovery. JS aliases retain
  authored identity through FFI lowering without merging runtime bindings, and reflected foreign
  types retain source declarations, nominal identity, public origin, and scope membership. Public
  declaration origins and project-level definition queries use compiler source mappings.
  Current-source tests cover certified-prefix interfaces, syntax phrase recovery, independent
  semantic continuation, dependent phrase removal, unresolved-import recovery, and dependencies
  introduced after a recovered phrase.
- Typed-node tests cover generalized binder schemes, nested expression types, compound annotation
  nodes, nominal identity across same-spelled type shadowing, certified-prefix exclusion, and
  independently recovered later phrases.
- Result carrier operations retain their compiler-selected wrapped/pure operand plan and immutable
  error/payload semantic types. An explicit two-head overlap regression proves separate interface,
  diagnostic, occurrence, scope, semantic-type, nominal-definition, and query ownership even when
  snapshot-local numeric compiler IDs repeat.
- GPU interface tests cover overload rows and determining arguments, immutable HM type references,
  builtin identity, fragment root/selector source mappings, recursively frozen normalized slices,
  immutable specialized query results tied to snapshot/generation identity, LSP consumption without
  `ProgramAnalysis` maps, and direct-compile consumption of the same selection facts.
- Definition and references now select compiler occurrences and aggregate matching identities only
  within one `ProjectSnapshot`; `src/lsp/symbols.ts` contains no syntax walk, scope builder, path
  identity, or open-graph merger. Namespace `StructureId` definitions follow their compiler import
  relation to the target module. Strict failures use transactionally recovered compiler interfaces,
  and failed phrases contribute no fallback definitions.
- Hover, successful validation, and document symbols now use the shared semantic-document adapter.
  Hover selects compiler typed nodes and occurrences, including generalized types, pipe
  specialization, generated-FFI presentation, and interface-owned GPU specialization. Validation
  publishes interface diagnostics. Document symbols map compiler top-level declaration facts. Strict
  failures use the recovered snapshot in all three paths, and failed phrases contribute no
  LSP-invented environment or declarations.
- GPU completion now uses compiler-owned current-source region and name-only scope facts. The LSP
  performs only source-position/prefix extraction and protocol conversion; builtin catalog selection
  and lexical shadowing are compiler queries. Recovery tests cover a failed outer phrase, an
  uncertified GPU phrase, local builtin shadowing, and a later visible catalog prefix without
  inventing semantic identities for either failed phrase.
- Ordinary completion now uses the same compiler query and current snapshot. Tests cover lexical
  values and shadowing, generalized/prelude type details, annotation type context, project and basis
  namespace members, nominal record fields, keywords, GPU catalog merging, failed semantic phrases,
  trailing malformed syntax, and standard `.` triggering. The LSP only maps neutral candidate kinds,
  ranks, and semantic type references to `CompletionItem`s using the hover type renderer.
- Named-import and module-path completion use compiler-owned detached discovery. Tests cover public
  value/type candidates with shared SML spellings, exclusion of already selected imports, semantic
  type details, and nearby disk/virtual file and directory paths. Inspecting an unfinished import
  does not enroll its target in the selected project graph.
- Expected-type completion ranking consumes inference-produced expression expectations frozen in the
  module semantic type arena. Compatible candidates sort first without removing unknown or
  incompatible names. Tests cover annotations, calls, operators, lambda returns, and match arms;
  compiler facts also cover nominal record fields, both conditional branches, unary operands, panic
  messages, recursive bindings, and piped-call arguments.
- Ordinary inferred-type inlays consume compiler-owned typed binder/parameter facts. Standard,
  range-aware LSP hints cover top-level/local bindings, useful inferred parameters, and destructured
  binders while omitting explicit annotations, unconstrained parameters, and obvious literals.
  Compact labels and full tooltips share the hover type renderer. Recovery exposes only certified
  hints, and initialization options configure type, parameter, and structural inlays independently.
- Parameter-name inlays use compiler-resolved callable `ValueId`s and authored lambda parameter
  names, including cross-module named-import calls. Nominal record constructors use authored field
  names. Same-named arguments are not repeated, and aliases without reliable authored callable
  metadata remain unhinted. Type, parameter, and structural hints have independent initialization
  options and environment fallbacks.
- Standard signature help consumes compiler-owned callable definitions and call-site facts rather
  than reconstructing application semantics in the LSP. Tests cover tuple-shaped arguments,
  multi-parameter and nested calls, named imports, curried parenthesized/whitespace stages, forward
  pipe, record field names, active-argument selection, and certified incomplete unqualified and
  qualified calls. Strings and comments do not create false argument separators, and unresolved
  incomplete callees return no signature.
- Full-document semantic tokens consume interface-owned token facts. Compiler target namespaces,
  semantic callable shapes, and lambda-parameter binding identities classify namespace, type,
  type-parameter, parameter, variable, property, constructor, and function tokens. Tests cover
  imported qualifiers/members, declarations/references, generic types, datatypes, nominal fields,
  functions, parameters, locals, standard relative encoding, and certified recovery. Exact-span
  multi-namespace facts remain distinct underneath a deterministic non-overlapping LSP presentation.
- The LSP `SemanticService` now consumes `ProjectContextRegistry` rather than analyzing each request
  as an unrelated entry. Validation, hover, completion, navigation, rename, symbols, inlays,
  signature help, and semantic tokens reuse the same immutable selected snapshot. Changed paths
  invalidate every containing closure; open-document head selection survives rebuilds; overlapping
  projects remain distinct; detached contexts are released on close. Strict compiler failures are
  retained beside recovered interfaces so diagnostics preserve the originating error while editor
  queries retain certified partial facts.
- Standard workspace symbols aggregate only active headed snapshots and currently open detached
  contexts. Module, top-level value/function/type/record/foreign-type, and constructor facts come
  from `ModuleInterface`; unrelated recursively indexed files remain absent. Shared declarations
  reached through overlapping heads are deduplicated by source location only in presentation.
- The portable protocol shell now advertises UTF-16, enforces initialize/shutdown state, returns
  standard parse/invalid/method/lifecycle errors, handles fragmented and batched frames, accepts
  `$/cancelRequest`, and rejects read results from an older workspace revision. Semantic operations
  are serialized so invalidation cannot race snapshot construction. `didClose` removes the source
  override and republishes the on-disk graph instead of blindly clearing diagnostics.
- Top-level scope lookup now returns the last certified module checkpoint when syntax recovery
  shortens the AST before the cursor. This makes the transactional partial basis available after a
  trailing malformed phrase without treating the malformed phrase as certified.
- The compiler now exposes a role-aware rename query over one complete `ProjectSnapshot`. Local
  named-import aliases rename only their alias occurrence and local uses; selecting an import source
  or declaration renames the shared target. The query refuses incomplete snapshots, targets without
  editable project declarations, and structurally ambiguous record projections. The LSP implements
  standard `prepareRename` and `WorkspaceEdit` conversion and preserves the source spelling's
  identifier/constructor lexical category.
- Compiler-owned type-definition queries walk immutable semantic type shapes to their nominal
  `TypeNameId`s and then use project definition mappings. Direct type occurrences, inferred values
  and constructors, imported types, composite types, and certified recovered phrases are covered;
  primitive-only types return no location. Compiler-owned document-highlight queries reuse the
  rename alias/target selection policy and classify declarations/import aliases as writes and uses
  as reads. Both are exposed as standard LSP requests.
- A projection source-mapping regression found during highlight work is fixed: in `value.x`, the
  receiver binding maps to `value` and the nominal field maps to `x`; namespace and authored FFI
  member references continue to map their target to the final qualified segment. Definition and
  highlights at an ambiguous projection therefore use the first compiler-selected field identity,
  not the receiver binding.
- FFI interface tests cover authored-versus-generated identity, target/mode/fallibility metadata,
  structure aliases, immutable signatures, reflected foreign keys, strict applicability, and
  certified-prefix exclusion. The delayed-reflection regression covers qualified `Js.Error`
  materialization through `StrEnv`.
- The focused interface, binding, nominal, characterization, runtime-module, record, project, type
  elaboration, and LSP scheduling run passes 113/113.
- [`tests/project_context_test.ts`](../../tests/project_context_test.ts) and
  [`tests/project_index_test.ts`](../../tests/project_index_test.ts) pass 6/6 and cover closest-head
  selection, configuration-separated contexts, detached documents, main-bearing dependencies,
  overlapping closures, document context stability, invalidation/release, one-way expansion, and
  exclusion of unrelated indexed files from validation. Two semantic-service tests cover retained
  snapshot selection, overlapping-project isolation, strict/recovered pairing, and reuse; two
  workspace-symbol tests cover active-only aggregation, shared-source deduplication, query
  filtering, and detached-context lifetime.
- The compiler-interface/LSP/project/binding/frontend-v2 compatibility run passes 188/188. The
  complete generated GPU builtin, hover, completion, diagnostic, and specialization run passes
  27/27. Repository-wide `deno task check` and `git diff --check` pass.
- The repository-wide run still exposes known baseline failures outside the module-interface slice
  (including an external network-content expectation). They remain visible baseline work rather than
  being folded into the interface change.

Remaining Stage 6 work is implementation work, not a language-design blocker:

1. improve expected-type recovery inside uncertified phrases where facts can be certified;
2. migrate the remaining semantic frontend-v2 consumers and structural inlays where applicable
   (deprioritized: the module update completes against the regular frontend first);
3. add the remaining general LSP features against compiler queries, closing `G19`, `G21`, and
   `G21b`.

Occurrence-local type coverage and the source mappings formerly listed here are closed by the
`A608` audits: every authored named node maps to an occurrence, every reference/qualifier
occurrence maps back through the scope at its offset to the same compiler identity, and both
completeness fields are derived from strict elaboration rather than hardcoded.

The workspace-symbol ordering dependency is now satisfied: semantic requests and validation share
the compiler `ProjectContextRegistry`, and workspace symbols aggregate its active headed snapshots
and open detached contexts without treating recursive discovery as project membership.

## Stage 7: Documentation and LSP handoff

Dependencies: `G19`–`G21`.

- [x] **L701** Update `docs/smlparallels.md` to the implemented module and basis semantics (see
      `S011`; the Modules section also now covers the initial-basis model and shadowing).
- [x] **L702** Convert the accepted normative plan into stable compiler-facing documentation.
      `docs/modules.md` summarizes ownership, environments and long identifiers, import forms,
      identity/graph/evaluation, the basis model, and the interface artifact, and links the
      normative specification and decision register as the authorities.
- [x] **L703** Record every intentional SML restriction and Workman extension discovered during the
      pass. `docs/modules.md` carries the register: restrictions (fixed operators, no module
      layer, no re-export, acyclic graph, no `local` phrase, simultaneous-clause duplicate rule)
      and extensions (file protocol, named imports, `carrier`, nominal records, pinned patterns,
      FFI, GPU, public-by-default).
- [x] **L704** Update the deferred LSP plan to consume `ModuleId`, public `Env`, target/alias
      identities, basis facts, and interface generations. The plan's symbol-identity section no
      longer sketches an LSP-owned path-keyed `ModuleId` (now explicitly forbidden there); it
      consumes the compiler's opaque `ModuleId`, occurrence/scope/typed-node identities, stable
      basis/standard identities, snapshot generations, and the implemented alias/rename relations.
- [x] **L705** Remove LSP assumptions based on paths, dotted names, or VS Code-specific behavior.
      `src/lsp/` contains no dotted-name splitting, no path-derived identity, and no VS Code
      references. The one remaining dot check (`hover.ts` classifying a typed-node label to choose
      a hover word) is presentation over a compiler-owned label, which the tooling contract
      explicitly leaves frontend-owned.
- [x] **L706** Rerun completion, navigation, references, rename, diagnostics, and invalidation
      baselines.
- [x] **L707** Build project/reference indexes only as aggregations of per-module interfaces.
- [x] **L708** Remove recursive workspace discovery as a definition of project checking,
      diagnostics, references, or rename scope.
- [ ] **L709** Route frontend-v2 semantic facts through the module interface while retaining its
      syntax/structural services. **Deprioritized by decision:** the module update completes
      against the regular frontend first; frontend-v2 today acts only as a syntax frontend feeding
      ordinary elaboration and supplies no semantic facts of its own, so this item does not block
      `G19`–`G23`.
- [x] **L710** Delete `src/lsp/symbols.ts` semantic resolution and `hover.ts` partial-inference
      fallback immediately after interface parity tests pass.

Gate:

- [x] **G22** The implemented behavior, normative documents, checklist, and tests agree. The
      normative specification is accepted wording (`S001`), `docs/smlparallels.md` and the new
      `docs/modules.md` state the implemented semantics (`S011`, `L701`–`L703`), and
      `current-state.md` no longer carries claims contradicted by verified behavior. `L709`
      (routing frontend-v2 semantic consumers) remains open and explicitly deprioritized; the
      documents record that status rather than contradicting it.
- [x] **G23** The LSP can use compiler-owned module facts without implementing a second module
      resolver or environment model. All features consume `ProjectSnapshot`/`ModuleInterface`
      queries through the shared semantic service; the former parallel resolver and fallback are
      deleted, and `src/lsp/` holds no environment model, name resolution, or path identity.

## Stage 8: LSP and editor adoption of the module system

Dependencies: `G22`–`G23`. This stage tracks the resumed LSP/editor work that consumes the new
module system, beginning with making its behavior observable in real usage. The general feature
plan lives in [`../lsp-update26.7/`](../lsp-update26.7/); items here are specifically the module
system's editor surface.

- [x] **E801** Expose a protocol-neutral project-status query derived entirely from compiler
      facts: the document's selected `ProjectSnapshot` kind (headed/detached), its head's display
      path, module count, and strict/recovered state, plus every active project head and whether
      each contains the document. Implemented as the `workman/projectStatus` request over
      `SemanticService`/`ProjectContextRegistry`; head paths are display facts taken from the
      head interface, never identities.
- [x] **E802** Surface the active project head in the editor. The VS Code extension shows a status
      bar item with the selected head's basename (or `detached`), a recovered-analysis marker, and
      a tooltip listing the full head path, module count, and other active projects. It refreshes
      on active-editor change and after each diagnostics publication, making `D31`/`D32` head
      selection and document-context stability directly observable while editing.
- [x] **E803** Cover the status surface with server-protocol regressions: an entry file reports
      itself as a headed project; opening a library file inside an already-active headed project
      reuses that context and reports the same head with `containsDocument`; a headless file
      reports a detached single-module context.
- [ ] **E804** Notify rather than poll: push a `workman/projectStatus` change notification when
      invalidation or head selection changes a document's owning project, instead of recomputing
      on every diagnostics publication.
- [ ] **E805** Extend the status surface to overlapping heads: when one shared path participates
      in several active snapshots, let the editor switch which project context the document uses
      and display the choice.
- [ ] **E806** Display the selected basis profile and frontend/surface configuration alongside the
      head, from the snapshot's recorded configuration facts.
- [ ] **E807** Audit the remaining LSP features against project-context boundaries in real
      multi-project workspaces (two heads sharing a library) using the status surface as ground
      truth, and record any discrepancies as focused regressions.

## Explicitly deferred work

These are tracked so they do not return as accidental first-pass requirements:

- [ ] **D801** Add `private` only with a concrete visibility use case.
- [ ] **D802** Design environment restriction and private nominal-type leakage rules.
- [ ] **D803** Design direct re-export/forwarding independently for every namespace.
- [ ] **D804** Design persistent/cross-build interface identities and cache serialization.
- [ ] **D805** Design package names, import maps, lockfiles, integrity, and vendoring.
- [ ] **D806** Consider URL modules beyond the existing local-file policy.
- [ ] **D807** Consider recursive/cyclic modules only with whole-component static and dynamic
      semantics.
- [ ] **D808** Consider signatures, functors, sharing, nested source structures, or first-class
      modules independently.
- [ ] **D809** Consider expanding the standard-library API after the semantic migration.

Deferred items do not block `G22` or `G23`.

## Audit coverage index

This is the discrepancy log required by `S010`.

| Finding                                          | Checklist coverage                           |
| ------------------------------------------------ | -------------------------------------------- |
| I1: dotted semantic structures                   | `M208`, `M209`, `M215`, `B306`, `R503`       |
| I2: structure/value namespace collision          | `T107`, `M216`, `I404`                       |
| I3: fabricated `carrier` value                   | `T120`, `T121`, `I412`–`I414`, `R504`        |
| I4: custom import collisions                     | `T111`–`T117`, `M211`–`M213`, `I408`, `I409` |
| I5: imports preinstalled in binding facts        | `T119`, `I401`, `I403`                       |
| I6: runtime aliases hoisted by source name       | `T124`, `R506`, `R507`                       |
| I7: alias/basename backend identity              | `T101`, `T103`, `M202`, `M205`, `R502`       |
| I8: type shadowing deletes constructors          | `T115`, `B313`                               |
| I9: paths/specifiers used as semantic links      | `S009`, `M201`–`M204`                        |
| I10: privileged standard-library import behavior | `B307`, `B308`, `B312`                       |
| I11: incomplete cycle paths                      | `T106`, `M204`, `M207`                       |
| I12: implicit initialization protocol            | `T122`–`T128`, `R508`–`R514`                 |
| B1: multiple basis sources of truth              | `S004`–`S008`, `B301`–`B303`, `B314`         |
| B2: standard structures flattened                | `M208`, `M209`, `B306`                       |
| B3: provenance changes bindings                  | `T113`, `B312`                               |
| B4: type/constructor deletion coupling           | `T115`, `B313`                               |
| B5: static/runtime prelude drift                 | `T130`–`T133`, `B301`–`B303`, `G9`           |
| B6: hybrid `Result`/`Task` merging               | `B315`, `B316`                               |
| B7: implicit prelude profiles                    | `S006`, `S007`, `B301`, `B311`               |
| B8: ambiguous operator status                    | `T135`, `B302`, `B304`                       |
| B9: scattered overload/equality facts            | `T132`, `B302`                               |

## Completion definition

The module update is complete when `G22` and `G23` are checked. At that point:

- the accepted Workman fragment uses SML environment and identity semantics;
- the file graph uses the specified acyclic ESM-derived protocol;
- the initial basis has coherent static and dynamic profiles;
- source, analysis, Core, runtime, and tooling agree on every module and binding identity;
- known current representation failures have permanent regressions;
- the LSP update can resume on compiler-owned facts.

**Status: `G22` and `G23` are checked; the module update is complete by this definition.** The
only open non-deferred item is `L709` (frontend-v2 semantic routing), explicitly deprioritized and
non-blocking. Deferred `D801`–`D809` remain future work by design.
