# ESM research and the Workman file protocol

## ESM is two layers, not one rulebook

“ES modules” combines:

1. ECMAScript language semantics for module records, import/export entries, linking, binding
   resolution, and evaluation;
2. host semantics for resolving specifiers, fetching/loading source, caching module records, and
   choosing supported URL schemes or package behavior.

This is analogous to the SML distinction under discussion: the language defines semantic objects,
while implementations decide how physical sources enter a program.

Workman should select individual properties from both ESM layers and state them as Workman rules. It
should not promise general ESM compatibility.

## What ECMAScript specifies

ECMAScript parses static import declarations into module requests and import entries. During
environment initialization, a named import creates an import binding that points to a resolved
module and binding name. Linking and evaluation are separate operations.

This provides the useful identity model:

```text
local imported name
  -> resolved module record
  -> original exported binding
```

It is stronger than copying a value into a fresh unrelated declaration. For Workman, immutable
values mean the observable mutation aspect of ESM live bindings is unnecessary, but the
declaration-identity relationship remains valuable.

ECMAScript also deliberately supports cyclic module records. It links strongly connected components,
initializes environments before executing bodies, and tracks module evaluation states. Modern ESM
also includes asynchronous dependency state for top-level await.

Workman does not inherit this machinery: dependency cycles are a recorded compile-time error.
Supporting a cyclic file graph later would require a module-level recursive binding and
initialization design, not merely removing the current cycle error.

ECMAScript also supplies two useful precise rules:

- module requests are visited in their recorded source order during evaluation;
- evaluating a module is memoized, including failure: later evaluation requests reuse its promise or
  observe its stored error rather than running the body again.

With cycles banned, Workman can use the simple acyclic projection of those rules: depth-first source
request order, dependency before importer, initialize once, and remembered failure.

ESM's collision rule should not be copied wholesale. An ECMAScript module rejects duplicate lexical
declaration names and conflicting imported local bindings as early errors. That is appropriate for
JavaScript's lexical module scope, but it would discard SML's ordinary sequential shadowing. Workman
should use ESM only to reject duplicate local targets within one simultaneous named-import clause;
collisions across declaration phrases follow SML environment composition.

Primary reference:

- [ECMAScript 2025, Scripts and Modules](https://tc39.es/ecma262/2025/multipage/ecmascript-language-scripts-and-modules.html)

## What hosts specify

ECMAScript delegates loading to host hooks. Browsers, Node, and Deno make additional choices.

The HTML Standard maintains a module map keyed by URL and module type. Its purpose includes ensuring
that a module script is fetched, parsed, and evaluated once within the relevant document or worker.

Node resolves ESM to URLs and maintains a separate ESM cache. Its local resolver requires explicit
file extensions and does not perform directory-index searching. Query strings and fragments can
produce distinct cache identities even when the underlying path component is the same.

Deno also centers URL-shaped specifiers and supports import maps for remapping stable source
spellings to resolved dependencies. It distinguishes static imports from runtime `import()`.

Primary/official references:

- [HTML Standard module maps](https://html.spec.whatwg.org/multipage/webappapis.html#module-map)
- [Node.js ECMAScript modules](https://nodejs.org/api/esm.html)
- [Deno module documentation](https://docs.deno.com/runtime/fundamentals/modules/)

These hosts demonstrate useful patterns, but Workman must choose its own identity rules. For
example, blindly copying Node's query/fragment identity would be inappropriate unless Workman
assigns meaning to those URL components.

## Properties to adopt

### Static graph edges

Imports use literal specifiers in top-level declarations. The complete dependency graph can be
resolved before body elaboration or evaluation.

This does not require imported bindings to be hoisted throughout the file. Workman can retain SML
sequential visibility while discovering the graph statically.

### Resolved module identity

Every successful resolution returns a canonical `ModuleId`. All specifier spellings resolving to
that identity share:

- one parsed source unit per snapshot;
- one elaborated public environment;
- one set of nominal type identities;
- one runtime initialization;
- one dependency node.

A URL-shaped identity is attractive because it extends beyond local files, but the canonicalization
and package rules must be specified before committing to it.

### Direct binding identity

An imported name refers to the original exported declaration plus a local alias occurrence. It is
not re-declared, re-generalized, or assigned a fresh nominal identity.

Unlike JavaScript, Workman imports operate across ML namespaces. A single source spelling may select
both a type component and a value/constructor component. ESM's single string export namespace is
therefore not adopted.

### Link before evaluation

The compiler should conceptually separate:

1. resolve and load the graph;
2. collect or elaborate public interfaces;
3. validate imported bindings;
4. evaluate/initialize dependency bodies;
5. evaluate the importer.

The exact relationship between interface collection and Hindley–Milner inference needs design. With
an acyclic graph, dependencies can be fully elaborated before importers without ESM's preinitialized
cycle machinery.

### Initialize once

Each `ModuleId` initializes at most once in one program instance. Importing the same target through
multiple paths or aliases reuses it.

This must become a language/runtime rule, not merely a property of the current JavaScript emitter.

Dependency requests are evaluated depth-first in first-source-occurrence order. A failed dependency
prevents its importer from starting, and that failure is remembered for subsequent requests. Effects
completed before a failure remain observable; module evaluation is not transactional.

## Properties to omit initially

- cyclic dependency graphs;
- dynamic `import()`;
- top-level asynchronous module evaluation;
- default exports;
- mutable live-binding observability;
- runtime module namespace objects as ordinary Workman values;
- side-effect-only import syntax;
- star re-export and ambiguous indirect-export resolution;
- conditional package exports;
- automatic extension or directory-index search;
- query/fragment-distinguished local identities;
- CommonJS interoperability rules.

Omission means there is no implied compatibility obligation.

## Public interfaces: deliberately not ESM

ESM requires explicit exports. The current Workman rule exposes every module-owned top-level
declaration, following the environment of an un-ascribed SML structure more closely:

```text
InternalEnv(file) = all elaborated top-level declarations
PublicEnv(file) = module-owned top-level declarations
```

Explicit `private` is deferred until there is a concrete need for interface restriction.

This public environment is multi-namespace and inferred. It is closer to a principal ML interface
than an ESM export-name table.

Calling it a “principal interface” requires care: a real principal signature has formal SML module
theory implications. Initially the term should mean the compiler-derived public environment, unless
and until principality is proved and specified.

## Namespace objects

ESM namespace imports produce exotic runtime namespace objects. Workman should borrow the qualifier
syntax and resolved binding behavior, not those runtime reflection semantics.

```wm
from "./math.wm" import * as Math;
Math.add(1, 2)
```

`Math` should be a static structure alias. The backend may implement it with a JavaScript object,
but that representation is not a Workman value contract.

The existing rule that bare `Math` can denote `Math.carrier` remains a separate Workman syntactic
extension. It is not an ESM namespace-object behavior and does not turn `Math` into a value binding.

## Re-exports and forwarding

Do not add ESM re-export syntax until identity behavior is specified across every ML namespace.

```wm
from "./parser.wm" import { parse as parserParse };
let parse = parserParse;
```

This clearly creates a new value binding whose value is the imported function. It should not be
silently treated as declaration-identity-preserving re-export. Forwarding a datatype, type alias,
constructor status, or structure requires different semantic operations.

A future re-export form should directly project an existing public semantic object into the new
public environment and preserve its identity.

## Result

The useful ESM inheritance is small:

```text
static requests
+ resolved module identity
+ direct imported-binding identity
+ graph/link/evaluate separation
+ initialize once
```

Everything else remains SML semantics, an explicit Workman restriction, or an explicit Workman
extension.
