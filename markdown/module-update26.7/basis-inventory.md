# Current basis inventory and migration classification

## Status and method

This is the checked Stage 0 inventory required by `S004`–`S008`. It records the source-visible
interface before the basis representation changes.

The lists were produced from:

- `baseTypeEnv()` and `baseEnv()` in [`src/types_basis.ts`](../../src/types_basis.ts);
- `basisTypes` in [`src/basis.ts`](../../src/basis.ts);
- `loadStandardModules()` in [`src/standard_library.ts`](../../src/standard_library.ts);
- the runtime definitions in [`src/core/emit_prelude.ts`](../../src/core/emit_prelude.ts);
- the source modules under [`std/`](../../std/).

This inventory is compatibility evidence, not approval of the current flat representation.

## Ownership categories

| Category                | Meaning                                                    | Migration owner                                             |
| ----------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| Language kernel         | Required to give accepted syntax static/dynamic meaning    | `InitialBasis.kernel`                                       |
| Host intrinsic          | Workman extension implemented by the compiler/runtime host | resolved structure/value binding with intrinsic metadata    |
| Source standard library | Expressible as ordinary Workman                            | elaborated `std/*.wm` public `Env` in `StrEnv`              |
| Pervasive binding       | Deliberately available without qualification               | explicit initial binding/projection with ordinary shadowing |
| Fixed syntax            | Parsed expression form, not an identifier                  | kernel operator catalog                                     |

## Current profiles

### Current `@no-prelude`

The implementation calls this `includeAlgebraicBasis: false`. It currently exposes:

Types:

```text
Number Bool String Void
Js.Value Js.Object Js.Array Js.ArrayLike Js.Dict
Gpu.Color Gpu.Fragment Gpu.Uniform
Gpu.Texture2D Gpu.SampledTexture2D Gpu.RenderTarget2D Gpu.Sampler
```

Expression operators:

```text
+  +  -  *  /  %
<  <=  >  >=  ==  !=
&&  ||
```

Ordinary value:

```text
print
```

The migration preserves this source-visible interface initially. D19 changes only the semantic
classification of operators: they become fixed kernel syntax rather than fake ordinary value
bindings.

### Current default

The default contains everything above, the algebraic/host entries below, and the seven compiled
standard structures listed later.

No new default names are added during the semantic migration. Any removal needed for correctness
must be recorded as an explicit compatibility change.

## Initial types

| Name                   | Arity | Current role               | Migration classification                                               |
| ---------------------- | ----: | -------------------------- | ---------------------------------------------------------------------- |
| `Number`               |     0 | primitive                  | language kernel                                                        |
| `Bool`                 |     0 | primitive/literal result   | language kernel                                                        |
| `String`               |     0 | primitive/literal result   | language kernel                                                        |
| `Void`                 |     0 | primitive/literal result   | language kernel                                                        |
| `Js.Value`             |     0 | opaque JS boundary         | host intrinsic type in `Js`                                            |
| `Js.Object`            |     0 | opaque JS object boundary  | host intrinsic type in `Js`                                            |
| `Js.Array`             |     1 | reflected JS array         | host intrinsic type in `Js`                                            |
| `Js.ArrayLike`         |     0 | FFI array-like obligation  | compiler-private/host type in `Js`                                     |
| `Js.Dict`              |     1 | reflected JS dictionary    | host intrinsic type in `Js`                                            |
| `Gpu.Color`            |     0 | GPU semantic type          | host intrinsic type in `Gpu`                                           |
| `Gpu.Fragment`         |     0 | GPU artifact type          | host intrinsic type in `Gpu`                                           |
| `Gpu.Uniform`          |     1 | GPU uniform type           | host intrinsic type in `Gpu`                                           |
| `Gpu.Texture2D`        |     0 | GPU resource               | host intrinsic type in `Gpu`                                           |
| `Gpu.SampledTexture2D` |     0 | GPU resource               | host intrinsic type in `Gpu`                                           |
| `Gpu.RenderTarget2D`   |     0 | GPU resource               | host intrinsic type in `Gpu`                                           |
| `Gpu.Sampler`          |     0 | GPU resource               | host intrinsic type in `Gpu`                                           |
| `Option`               |     1 | basis datatype             | default algebraic type                                                 |
| `Result`               |     2 | basis datatype             | default algebraic type                                                 |
| `List`                 |     1 | basis datatype/list syntax | default algebraic type; kernel dependency when list syntax is accepted |
| `Js.Error`             |     0 | JS-error datatype          | host/default type in `Js`                                              |
| `Task`                 |     2 | opaque async computation   | host/default type in `Task`                                            |

The `List` row records a migration constraint rather than changing `@no-prelude` today: a future
profile may not accept list syntax while withholding the type/constructor meaning that syntax
requires.

## Initial constructors and pervasive values

| Type          | Constructors             | Current spelling             | Migration classification                             |
| ------------- | ------------------------ | ---------------------------- | ---------------------------------------------------- |
| `Option<T>`   | `None`, `Some`           | unqualified                  | explicit default pervasive constructors              |
| `Result<T,E>` | `Ok`, `Err`              | unqualified                  | explicit default pervasive constructors              |
| `List<T>`     | `Nil`, `Cons`            | unqualified plus list syntax | explicit default pervasive constructors              |
| `Js.Error`    | `Js.Error`, `Js.Unknown` | dotted flat names            | members of `Js` plus approved compatibility spelling |

`print` is an ordinary pervasive host value in both current profiles. It remains shadowable.

Booleans and `void` are syntax nodes in the current AST, not `ValEnv` entries. Their types and
runtime meanings still belong to the kernel basis.

## Fixed operator catalog

| Operators                     | Static behavior                                                |
| ----------------------------- | -------------------------------------------------------------- |
| `+ - * / %`                   | `(Number, Number) -> Number`                                   |
| `++`                          | `(String, String) -> String`                                   |
| `< <= > >=`                   | `(Number, Number) -> Bool`                                     |
| `== !=`                       | `('a, 'a) -> Bool` subject to Workman's equality admissibility |
| `&&                           |                                                                |
| unary `-`, `!` where accepted | fixed expression semantics                                     |

Current static owner: `baseEnv()` plus expression-inference special cases.

Current dynamic owners: Core lowering/emission and GPU operator catalogs.

Migration owner: one kernel operator catalog consumed by parsing/inference facts, Core lowering,
runtime emission, and GPU specialization. These tokens do not enter `ValEnv`.

## Handwritten qualified host/default members

These are currently flat dotted `ValEnv` keys. They migrate to real structure members.

### `Result`

```text
Text.of
```

`Text.of` is a host primitive available in every basis profile.

### `Json`

```text
Json.assert
```

`Json.assert` is a host intrinsic member.

### `Task`

```text
Task.fromResult Task.succeed Task.fail Task.map Task.map2 Task.race
Task.andThen Task.mapErr Task.recover Task.orElse Task.all Task.collectList Task.traverse
```

The source module also defines `Task.fn`, `Task.fnError`, `Task.carrier`, `Task.collectList`, and
`Task.traverse`. `B315` must give overlapping members exactly one owner. Irreducible runtime
primitives remain host members; expressible combinators belong to `std/task.wm`.

### `Js.Array`

```text
Js.Array.toList Js.Array.fromList
```

These are host conversion members.

### Current `Dict` compatibility spelling

```text
Dict.empty Dict.get Dict.set
```

Their underlying type is currently `Js.Dict`. Migration must either install the compatibility `Dict`
structure or record a correctness-required API change; it must not silently rename the surface
during the structural refactor.

### `Gpu`

```text
Gpu.color Gpu.fragment Gpu.i32 Gpu.f32
Gpu.uniform Gpu.read Gpu.withValue
Gpu.wgsl Gpu.vertexEntryPoint Gpu.fragmentEntryPoint Gpu.artifactIdentity
Gpu.uniformBinding Gpu.uniformByteLength Gpu.uniformBytes
Gpu.texture2D Gpu.sampledTexture2D Gpu.renderTarget2D
Gpu.nearestSampler Gpu.linearSampler Gpu.destroyTexture2D
Gpu.bindGroupEntries Gpu.bindingCount Gpu.renderTargetView
Gpu.validateRenderTarget
```

All carry or require compiler intrinsic meaning. They become ordinary resolved members of the `Gpu`
structure whose intrinsic tags are inspected only after lookup.

## Compiled source standard structures

### `List` from `std/list.wm`

Values:

```text
map length append filter take drop at foldLeft foldRight reverse any all collectWith
```

Types: none.

### `Map` from `std/map.wm`

Values and constructors:

```text
Less Equal Greater MapEmpty MapNode MapValue
numberCompare height max node rotateLeft rotateRight balance
empty getTree get has setTree set singleton
removeSmallest removeTree remove update
foldTree fold toListTree toList debugHeight fromListItems fromList
```

Types:

```text
Ordering MapTree Map
```

### `Option` from `std/option.wm`

Values:

```text
map andThen withDefault map2 traverse collectList
```

Types: none.

### `Monad` from `std/monad.wm`

Values:

```text
Carrier lift viaError
```

Types:

```text
Carrier
```

The `Carrier` constructor/value and type components deliberately share one spelling.

### `Result` from `std/result.wm`

Values:

```text
succeed map andThen toBool fn mapErr fnError map2 carrier
withDefault map3 map4 traverse all collectList
```

Types: none.

### `Task` from `std/task.wm`

Values:

```text
fn fnError carrier collectList traverse
```

Types: none.

### `Traverse` from `std/traverse.wm`

Values:

```text
with
```

Types: none.

## Static/dynamic ownership before migration

| Facts                      | Current static owner                                  | Current dynamic owner                  | Required migration                                                            |
| -------------------------- | ----------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| primitive and host types   | `types_basis.ts`                                      | mostly erased/runtime host values      | one `InitialBasis` description with checked type metadata                     |
| algebraic declarations     | `basis.ts`, `types_basis.ts`, `compiler_semantics.ts` | `emit_prelude.ts`                      | one identity/status description                                               |
| fixed operators            | `types_basis.ts`, expression inference                | Core/JS/GPU lowering                   | one non-`ValEnv` operator catalog                                             |
| `print`                    | `types_basis.ts`                                      | `emit_prelude.ts`                      | corresponding ordinary initial value                                          |
| host structure members     | dotted `types_basis.ts` entries                       | `emit_prelude.ts` and special lowering | `StrEnv` members with intrinsic tags                                          |
| source standard structures | privileged `InitialImport`s                           | separately emitted standard graph      | ordinary elaboration into corresponding static/dynamic structure environments |
| `Result`/`Task` hybrids    | handwritten plus compiled entries                     | JavaScript object merge                | explicit member ownership and structure construction                          |

## Compatibility checks required

`T130`–`T137` turn this inventory into executable evidence. In particular:

- snapshot both current profile interfaces;
- compare every static value with a runtime implementation;
- verify constructor status and nominal identity;
- verify explicit pervasive alias identity;
- verify fixed operators without `ValEnv`;
- verify ordinary initial values remain shadowable;
- verify compiled standard-basis construction is effect-free.
