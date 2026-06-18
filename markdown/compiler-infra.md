# Compiler Infrastructure Design

`wm-mini` is not a syntax-to-JavaScript transpiler. It is a small Standard ML implementation project
with a Workman surface syntax and a `wmsml` verification surface. JavaScript is one backend for the
supported dynamic semantics, not the semantic authority.

The compiler architecture should therefore follow the ML tradition:

```txt
workman / wmsml source
  -> surface AST
  -> elaborated Core ML
  -> runtime Core
  -> backend IR
  -> JavaScript
```

The important boundary is elaboration. After elaboration, later compiler stages should not care
whether the program came from Workman syntax or the `wmsml` subset.

## References

Primary semantic reference:

- `research/The-Definition-of-Standard-ML-Revised/statcor.tex`
- `research/The-Definition-of-Standard-ML-Revised/dyncor.tex`
- `research/The-Definition-of-Standard-ML-Revised/statmod.tex`
- `research/The-Definition-of-Standard-ML-Revised/dynmod.tex`
- `research/The-Definition-of-Standard-ML-Revised/prog.tex`

Architecture reference points:

- SML-style static and dynamic basis separation.
- ML-family compiler phase structure: parse, elaborate, match compile, lower, emit.
- MLton/SML-NJ/OCaml-style discipline at a high level, without copying their full complexity.

Non-authoritative references:

- ReScript, Fable, Melange, Elm, and similar ML-ish-to-JS systems can inform runtime representation
  choices, but not source semantics.

## Design Principles

- Compile elaborated Core, not source syntax.
- Keep Workman and `wmsml` separate only at the surface parser layer.
- Keep SML static and dynamic semantics separate even when the implementation runs both together.
- Prefer explicit semantic IDs over string identity.
- Make compiler facts useful to tooling: node IDs, source spans, inferred schemes, resolved
  references, and diagnostics should survive elaboration.
- Build a small interpreter for truth before treating generated JavaScript as correct.
- Avoid optimizer IR until the semantic pipeline is stable.

## Phase Model

### 1. Surface AST

The surface AST preserves syntax and source locations.

Responsibilities:

- represent Workman syntax directly
- represent `wmsml` syntax directly or lower it immediately into equivalent surface forms
- preserve source node IDs and spans
- preserve enough syntax for good diagnostics and LSP features

This layer may contain syntax-specific constructs such as Workman `match(value) { ... }`, Workman
type application `Type<T>`, or `wmsml` postfix type application.

It should not decide final semantic identity.

### 2. Elaboration

Elaboration is the semantic frontend. It consumes surface AST and produces elaborated Core plus
module/static facts.

Responsibilities:

- resolve value identifiers and long value identifiers
- resolve type constructors and long type constructors
- resolve constructor identifiers and distinguish them from value variables
- assign stable internal IDs to variables, constructors, type names, records, and modules
- elaborate datatype declarations into fresh nominal type names
- elaborate file imports as implicit SML-style structures
- infer and generalize type schemes
- instantiate schemes at use sites
- emit structured diagnostics and warnings
- record tooling facts by source node ID

Elaboration should model the SML static environment shape:

```txt
Env =
  structures: StrId -> Env
  types: TyCon -> TyStr
  values: VId -> Scheme * IdStatus
```

`IdStatus` matters. A value identifier occurrence can denote:

- ordinary value variable
- data constructor
- exception constructor, later if exceptions enter the subset

For Goal 2, exceptions remain out of scope, but the IR should not paint us into a corner.

### 3. Elaborated Core

Elaborated Core is the source-independent, typed ML subset.

It should still look like a functional source language:

- literals
- resolved variables
- lambdas
- application
- `let` and `let rec`
- tuples
- records
- datatype constructor introduction
- high-level `match`
- `if`
- blocks or sequential declarations, if that remains convenient

It should not contain:

- unresolved names
- source-specific import declarations
- syntax-only list literals
- syntax-only type aliases
- ambiguous constructor/value occurrences

Every variable reference should point at a binding ID. Every constructor use should point at a
constructor ID. Every nominal type should point at a type-name ID.

### 4. Core Interpreter

The interpreter is not a production runtime. It is the executable dynamic semantics oracle for the
supported subset.

Responsibilities:

- evaluate elaborated Core or runtime Core
- model closures as code plus environment
- model constructors using constructor IDs
- model tuples, records, strings, numbers, booleans, and `void`
- model `Bind` failure for refutable value bindings
- model `Match` failure for non-exhaustive function or match evaluation
- provide deterministic output capture for tests

The JS backend should be tested against the interpreter for representative programs.

### 5. Runtime Core

Runtime Core lowers high-level Core into a backend-friendly functional IR.

Responsibilities:

- compile pattern matching into explicit decision trees or ordered tests
- make pattern failure points explicit
- make module initialization order explicit
- make constructor payload layout explicit
- make tuple and record layout choices explicit
- alpha-rename or otherwise guarantee backend-safe local names

Runtime Core may still contain closures and function calls. It does not need to be an optimizer IR.

### 6. Backend IR

Backend IR is the last language-independent-ish representation before JavaScript emission.

Responsibilities:

- represent JavaScript-shaped control flow and expressions without depending on source syntax
- keep runtime helper calls explicit
- contain no typechecker decisions
- contain no unresolved names

This stage can initially be tiny. It exists to prevent the JS emitter from becoming the next
semantic frontend.

### 7. JavaScript Backend

The JavaScript backend implements the chosen runtime representation.

Responsibilities:

- emit ES modules or standalone JS bundles
- emit constructor functions and runtime metadata
- emit closures and calls
- emit match decision code
- emit module initialization in dependency order
- expose a small, explicit JS interop mechanism later

The JS backend must not:

- decide whether a name is a constructor or value
- infer arity or tuple shape from syntax
- compare constructors by display spelling
- implement Workman-specific parsing or elaboration choices

## Runtime Representation

The current smoke-test backend uses constructor names as tags. That is insufficient for a real
nominal implementation. Same-spelled constructors from different modules must remain distinct at
runtime.

A safer representation:

```ts
type WmCtorId = number;

type WmValue =
  | number
  | string
  | boolean
  | undefined
  | WmTuple
  | WmRecord
  | WmData
  | WmClosure;

type WmData = {
  ctor: WmCtorId;
  name: string;
  args: WmValue[];
};
```

`name` is for display and debugging. `ctor` is for equality, matching, and semantic identity.

Open design questions:

- Whether nullary constructors should be singleton frozen objects.
- Whether tuples should stay arrays or use tagged objects.
- Whether records should carry record type IDs at runtime.
- How much structural equality should exist before SML equality types are implemented.

## Static/Dynamic Basis

Following the SML Definition, wm-mini should keep static and dynamic concerns conceptually separate.

Static basis:

- type names and type functions
- value schemes
- identifier status
- structure environments
- module export environments

Dynamic basis:

- runtime values
- constructor functions/values
- module initialized values
- primitive operations

For batch file compilation, a failed elaboration aborts before evaluation or emission. For runtime
failure, the static facts may still have existed during compilation, but the program execution
raises `Bind`, `Match`, or a later runtime error.

## Pattern Matching

Initial implementation can use ordered pattern tests, matching SML's ordered rule behavior.

Later, add a match compiler:

- input: typed pattern matrix plus result expressions
- output: decision tree with explicit failure continuation
- diagnostics: exhaustiveness/redundancy should remain frontend facts, not backend guesses

The backend should consume a lowered match form:

```txt
match value with
  tests...
  failure Match
```

or a decision tree:

```txt
switchCtor value
  CtorId.Some -> ...
  CtorId.None -> ...
  default -> raise Match
```

## JS Interop Position

JavaScript interop should attach after elaboration, not at parse time.

All JS-specific reflection and overload-like behavior should live in a pre-HM FFI elaboration pass.
That pass is represented by `src/ffi_elab.ts`. Its job is to turn surface JS imports into a
restricted table of foreign alternatives and, eventually, rewrite resolved uses into ordinary typed
internal bindings before the main HM checker sees them. HM should not learn about JavaScript
optional parameters, varargs, or overload sets directly.

Current hygiene rule:

- `src/ffi/elab.ts` may use TypeScript reflection and resolve JS overload/rest/optional arities.
- `src/infer.ts` must not import JS reflection or choose overloads.
- `src/infer/js_imports.ts` accepts only already-typed JS import specs. Raw reflected namespace
  imports are rejected as unelaborated input.
- Reflected overload sets are not Workman values. A call can elaborate to one concrete internal
  foreign binding; a bare overloaded import remains unavailable unless a later annotation-selection
  rule is added.

The first version should prefer reflection-backed typed namespace imports over bindgen:

```txt
from js.global("Math") import { max as jsmax, floor };
from js.global("Math") import * as Math;
from js.module("node:crypto") import { createHash };
```

The important constraint is that interop imports elaborate into typed external bindings with
explicit dynamic implementations. Use sites should keep ordinary JS spelling, such as
`Math.floor(4.8)` or `console.log("answer", 42)`, rather than forcing renamed shims like
`consoleLog`.

Reflected JS calls are fallible by default. If reflection says a JS function returns `T`, the
Workman type is `Result<T, Js.Error>`; if reflection says it may return nullish, the Workman type is
`Result<Option<T>, Js.Error>`. This keeps JavaScript exceptions out of the ordinary SML value model:
foreign code may throw, so reflected foreign calls must be handled with `Ok`/`Err`.

Manual annotations are still the fallback when TypeScript reflection is unavailable, too broad, or
when overload selection needs help. Manual annotations currently mean "use this raw boundary":

```txt
from js.global("console") import { log: (String, Number) => Void } as console;
from js.global("Deno") import { readTextFileSync: (String) => String } as Deno;
```

Raw JavaScript object and array values must be marked explicitly with JSON literals:

```txt
spawn("curl", JSON["-s", url], JSON{
  stdio: JSON["ignore", "pipe", "inherit"],
  env: JSON{ "USER_AGENT": "Workman-FFI" },
})
```

`JSON{}` and `JSON[]` elaborate to `Js.Value`. Workman records remain nominal ML records, and
Workman list syntax remains the algebraic list model; neither silently turns into a JavaScript
object or array at an FFI boundary.

`JSON{}` and `JSON[]` are intentionally FFI-surface constructs, not an SML core feature. Their
typing rule is isolated in `src/infer/json.ts`: primitive ML values and existing `Js.Value`s may be
embedded, while ordinary ML records, lists, and ADTs are rejected unless an explicit conversion
exists later.

The initial basis includes `Option<T> = None | Some<T>` and `Result<T, E> = Ok<T> | Err<E>`. Program
declarations may shadow these initial-basis names, matching the normal ML expectation that the
initial environment is not a permanent reserved namespace. This gives TypeScript nullish reflection
a real ML target:

```txt
T | null | undefined  ->  Option<T>
null | undefined      ->  None
value                 ->  Some(value)
```

This mapping is part of FFI reflection and JS boundary codegen:

- reflected TS unions containing `null` or `undefined` elaborate to `Option<T>`
- optional TS parameters still elaborate as optional arities, not as `Option<T>` parameters
- JS return values typed as `Option<T>` are wrapped with `None`/`Some`
- Workman arguments typed as `Option<T>` are unwrapped before crossing into JS, with `None` becoming
  `undefined`
- reflected JS object returns elaborate to opaque `Js.Object`
- reflected member calls on known JS objects elaborate before HM as ordinary receiver-first
  functions, so `proc.stdout.on("data", f)` becomes a normal typed call with `proc` as the first
  argument

No JS interop design should require learning a fake replacement API for ordinary JS objects.

### Value Restriction Before Interop

JS interop introduces ordinary effectful functions into the dynamic basis. That makes SML's value
restriction relevant before we add the first useful external declaration.

The Definition's static semantics partitions expressions into non-expansive and expansive
expressions. A value declaration closes/generalizes the inferred type environment using that
classification: if the expression that produced a binder is non-expansive, free type variables may
be generalized; if it is expansive, they must remain monomorphic.

At the module boundary, wm-mini refuses unresolved free type variables left by expansive top-level
bindings. This follows the SML 97 allowance that implementations may reject such cases rather than
publish a basis containing free type variables. The check runs after whole-module inference so later
declarations can still constrain an expansive monotype before the module interface is exposed.

For wm-mini, the first conservative classification should be:

- Non-expansive:
  - literals
  - variables
  - constructor constants
  - function literals / `fn match`
  - tuples and records whose fields are non-expansive
  - constructor application where the constructor expression and payload are non-expansive
- Expansive:
  - ordinary function application
  - external JS application
  - conditionals and matches initially, unless we later prove a tighter SML-compatible rule
  - blocks containing declarations or effects

This is deliberately conservative. It may reject or monomorphize some programs that an optimized
implementation could accept, but it preserves the important invariant: a single effectful or
externally allocated runtime value must not be assigned multiple incompatible instantiations.

External namespace imports should elaborate like ordinary typed values in the static basis:

```txt
console.log : (String, Number) -> Result<Void, Js.Error>
Math.floor : Number -> Result<Number, Js.Error>
Deno.readTextFileSync : String -> Result<String, Js.Error>
```

At runtime, applying an external value is a dynamic-basis operation analogous to applying an SML
basic value. The normal SML value model remains intact: tuples, records, constructors, closures,
`Bind`, and `Match` do not become JavaScript concepts.

Initial representation rules should stay narrow:

- `Number`, `String`, `Bool`, and `Void` map directly to JS primitives.
- Functions cross the boundary only when explicitly typed.
- Opaque `Js.Value` and `Js.Object` types are not inspected by ordinary pattern matching or equality
  by default.
- Reflected throws are caught, normalized to the small `Js.Error` basis ADT, and returned as
  `Err(error)`. Reflected nullish returns are wrapped inside the success channel as `Ok(None)` or
  `Ok(Some(value))`.
- Any unsafe or untyped boundary must be syntactically explicit.

## Compiler Invariants

- The JS emitter never sees unresolved names.
- The JS emitter never decides identifier status.
- Constructors are matched by constructor ID, not spelling.
- Type names are nominal by internal ID, not spelling.
- Workman and equivalent `wmsml` programs elaborate to equivalent Core.
- Generated JS and the Core interpreter agree for the supported subset.
- Import/module order is explicit before emission.
- Pattern failure points are explicit before emission.
- Tooling facts are keyed by source node ID.
- Backend tests are semantic tests, not string-fragment tests, except for narrow smoke checks.

## Initial Vertical Slice

The smallest useful slice:

1. Define Core IDs and elaborated Core AST types.
2. Elaborate literals, variables, lambdas, calls, `let`, tuples, ADTs, constructors, and `match`.
3. Keep existing inference logic, but make it produce enough resolved facts to build Core.
4. Add a Core interpreter for that subset.
5. Move JS emission to consume Core instead of surface AST.
6. Add paired tests:
   - Workman vs `wmsml` elaboration equivalence.
   - Core interpreter result vs generated JS result.
   - Same-spelled constructors from different modules remain runtime-distinct.

Do not add optimizer passes in this slice.
