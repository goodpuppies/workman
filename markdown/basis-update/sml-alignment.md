# Alignment with the Definition, the Basis spec, and existing implementations

Checked on 2026-09-28 against `research/The-Definition-of-Standard-ML-Revised/`,
`research/sml-basis-spec/Basis/`, and LunarML's basis at `~/git/LunarML/lib/lunarml/ml/basis/`.

## What the Definition specifies

The Definition says very little about how a library is implemented. It specifies three things.

**1. A minimal initial basis.** Appendices C and D define `B0`. Its structure, signature and functor
environments are empty. Its type environment has `bool`, `int`, `real`, `string`, `char`, `word`,
`list`, `ref`, `exn`. Its value environment has `=`, `:=`, `true`, `false`, `nil`, `::`, `ref`,
`Match`, `Bind`. The appendix states the intent directly: "we define a minimal initial basis for
execution. Richer bases may be provided by libraries." The introduction points to the separate
Basis Library document for that richer basis.

**2. Composition.** The static and dynamic bases are extended declaration by declaration with
ordinary environment modification. The introduction adds: "In an implementation, the basis need not
be so divided." The implementation only has to keep the two halves consistent. This is the model
`module-update26.7/sml-basis.md` already follows.

**3. One hook for libraries: overloading classes.** Appendix E (`overloading.tex`): "Libraries may
extend the set T0 of Appendix C with additional type names." The overloading classes (`Int`,
`Real`, `Word`, `String`, `Char`) are then sets of type names that libraries populate, with
defaults when context does not decide. This is the only place where the Definition expects a
library to feed information back into the language's static semantics.

There is no guidance on file layout, primitives, or how library code reaches the runtime. That is
left to implementations.

## What the Basis spec specifies

The Basis spec defines **interfaces and behavior, not implementation**. Each page gives a signature,
the structures that match it, and the semantics of each value. There are occasional
"Implementation note" paragraphs about edge cases, such as `Array.copy` with overlapping ranges.

It has three properties that matter for Workman.

**It is written in the module language Workman omits.** Structures are specified with opaque
ascription and type sharing, for example:

```sml
structure Word8Vector :> MONO_VECTOR where type elem = Word8.word
structure CharVector  :> MONO_VECTOR where type vector = String.string
                                     where type elem = char
```

Workman has no signatures, so it cannot state these relationships in the language. Consequences:

- **Conformance is checked outside the language**, by tests written from the spec pages rather than
  by the type checker matching a structure against a signature.
- **Type sharing becomes type aliases.** `Word8Vector.elem` is an alias of `Word8.word`, and
  `CharVector.vector` an alias of `String.string`, declared in the Workman modules.
- **Opaque ascription becomes a host-owned type.** `Word8Vector.vector` is abstract in the spec;
  in Workman it is a nominal type declared at the primitive boundary (BD8).
- **Signature reuse becomes repetition.** `MONO_VECTOR` is matched by `Word8Vector`, `CharVector`
  and several optional structures. Without signatures or functors, each Workman structure is
  written out, ideally as thin aliases over one shared polymorphic implementation.

**Exceptions are part of the interfaces.** Every raising function documents what it raises, which
is what makes BD4's mechanical `Result` signatures derivable.

**Compliance forbids extension.** "Extending these interfaces is not permitted", for both required
and optional components. This backs BD2: Workman additions go to layer 2, not into Basis
structures.

## How an existing implementation does it: LunarML

LunarML compiles SML to JavaScript and Lua and ships its own Basis. Its structure is close to this
plan:

- **The Basis is SML source.** `lib/lunarml/ml/basis/*.sml`, organized by an MLB file
  (`basis.mlb`) that exports the Basis signatures and structures.
- **Primitives are a small, named set.** Library code calls them as
  `_primCall "Word.+" (x, y)` or `_Prim.Vector.fromList`, implemented by the code generator and the
  runtime (`mlinit.js`, about 700 lines). Everything else, such as the bounds check that raises
  `Subscript` in `Vector.sub`, is ordinary SML on top of those primitives.
- **Per-target sources.** `js/`, `js-common/`, `js-cps/`, `lua/`, `nodejs/`, `webjs/`, selected by
  target through MLB files (`sources-js-$(TARGET_OS).mlb`). Portable files are shared.
- **Static facts are declared in source.** `_equality word = fn (x, y) => …` declares how a type
  admits equality, and `_overload "Word" [word] { + = Word.+, … }` adds a type to an overloading
  class, which is the Appendix E hook.

Millet, analyzed in `module-update26.7/sml-basis.md`, follows the same pattern for static
analysis: a minimal basis built in code, then the library elaborated from source.

## How the plan fits

The plan agrees with the Definition and both implementations on the main points:

| Point | Definition / spec | LunarML | This plan |
|---|---|---|---|
| Compiler-owned part is minimal | App. C/D | Primitives only | Layer 0 only (BD1, BD7) |
| Library is ordinary source | "provided by libraries" | `.sml` over `_primCall` | `.wm` over unsafe imports (BD7) |
| Library composes like user code | Environment modification | MLB | One module graph (stage B) |
| Target-specific parts are separate | — | Per-target directories | `basis/js/` primitives, `host/` layers |
| Interfaces follow the spec | Basis spec | Exports Basis signatures | Layer 1 follows the spec (BD2) |

## Gaps this check found

**1. Host-owned types need static facts, not just a name.** `BASIS_TYPES` records an equality
property for each type today. When `Word8Vector.vector` or `Word8.word` moves out of the compiler,
something still has to say whether and how it admits equality. LunarML declares this in source with
`_equality`. Workman keeps it in a compiler-owned table instead (BD8), which is simpler, and states
only arity in the manual type import.

**2. Overloading classes are not needed.** The Appendix E hook exists so libraries can add types
like `Word8` or `Int32` to overloading classes. Workman has a single `Number` and no numeric
overloading (`core-design.md`, Numbers), so it has no use for the hook, and exact numeric types use
named operations instead.

**3. A conformance checker would replace signature matching.** Since Workman cannot match a
structure against `MONO_VECTOR`, a test tool could compare each layer-1 module's exported
environment against the spec signature, with the `Result` rule applied. The signatures are
available as SML source in LunarML's basis and partly in `research/BasisLibrary/Code/`. This is
optional; tests written from the spec pages are the minimum.

**4. Test material exists.** `research/BasisLibrary/Code/` contains tests with expected output for
some structures (for example `2015/001` for `ListPair`), and LunarML has its own test suite. Both
are sources for layer-1 conformance tests.
