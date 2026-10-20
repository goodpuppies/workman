# wm vs Nix: findings log

What building pakman in Workman (wm-mini 0.4.0) shows, compared with Nix and with the previous
PKGBUILD + Deno setup in `../cachy-packages-main`. Newest entries at the bottom of each section.

## Package definitions

- **One typed file instead of two loosely coupled ones.** `pkgs/t3-code.wm` (80 lines) replaces
  `PKGBUILD` (46) + `package.ts` (57). The version finder and the build recipe now share the same
  helpers (`releaseVersion`, `appImage`), where before the tag-mangling logic existed once in bash
  (`${pkgver/.nightly./-nightly.}`) and once as a TS regex.
- **The finder/recipe split typechecks.** `versions : Void -> Task<List<Candidate>, String>` and
  `make : String -> Package` are checked against the `Definition` record. In cachy-packages the
  equivalent contract (`latestVersion` must return something `updatePkgbuild` can write into
  `pkgver`) was by convention.
- **Install steps are data.** `Install`, `Symlink`, `WriteText` and `desktopEntry` replace
  `install -Dm755`, `ln -sf` and a heredoc. They get hashed into the store key directly, with no
  shell to interpret. Nix equivalent: `installPhase` strings, which are opaque to the evaluator.
- **No version churn in files.** Resolution writes `pakman.lock`. Before, every update rewrote
  `pkgver`/`pkgrel`/`sha256sums` in the PKGBUILD. Nix's equivalent (`nix-update`, r-ryantm) also
  rewrites source.

## Dependency tracking without string context

Nix records dependencies by attaching hidden context to strings: interpolate a package into a
string and the string remembers it. That is a workaround for a language whose only rich value
flowing into a build is a string. In wm the same thing is ordinary data: install steps hold
`PathRef` values (`Own`, `Of`, `Base`) and text is a small ADT (`Lit`, `Ref`, `Cat`), so the
dependency graph is a fold over the plan (`src/refs.wm`, under 100 lines). No language feature was
needed. Compared with Nix it is also checkable before building: pakman refuses a plan that refers to
a file the other package doesn't install, and it doesn't depend on hashes surviving inside files
(thesis §3.4 notes compression breaks Nix's scan).

## Strictness vs laziness

- **Eager Tasks force thunks.** A wm `Task` starts when it is created, so `versions` has to be
  `() => Task` or importing a package file would hit the network. Nix gets this for free from
  laziness. Cost: one `()` per definition, and the typed field documents it.
- **The package set doesn't need laziness.** `pkgs/index.wm` imports every definition strictly,
  which is cheap because a definition is a record of functions; nothing is computed until a
  command calls `make` or `versions`. Nixpkgs needs laziness because its packages are values that
  are already built (and refer to each other through a fixpoint). Dependencies between pakman
  packages will be names the resolver looks up, so this should keep holding. Still untested:
  overrides.

## JS FFI friction

- **JSON output uses `JSON{}`/`JSON[]` literals.** A wm record holding wm Lists can't be passed to
  `JSON.stringify` directly, but building the JS value with `JSON{ ... }` plus
  `Js.Array.fromList(List.map(...))` for lists works, and the result is stringified as usual. Key
  order follows the literal, so output is deterministic enough to hash. Comparable to Nix's
  `builtins.toJSON`, with one explicit conversion step per list.
- **`Json.assert` can't be wrapped in a generic helper.** Its target shape is fixed at the call
  site: a shared `parseAs(path, text)` got pinned to the first record type it was used with. Each
  reader repeats the `Json.assert :> Result.mapErr(...)` line.
- **Value properties need manual types.** `Deno.args`/`Deno.env` were "unknown JS import" until
  typed by hand, and `RegExp.new(...)` didn't unify with `.match`. Following wm's own guidance,
  these went into a TS shim (`src/host.ts`) with Workman-shaped signatures. That worked well: the
  shim is the whole host boundary, which also scopes the later move off JS.
- **Positive:** `fetch` + `Json.assert` into nested records (`Js.Array<GithubRelease>` containing
  `Js.Array<GithubAsset>`) worked on the first try and gives typed GitHub API data with no
  schema-validation library.

## Language ergonomics hit

- **Record projection used to pick the wrong record** (fixed in wm-mini, uncommitted as of
  2026-10-06). Several pakman records share field names (`name`, `version`, `path`). wm already
  knew a value's type from inference or an annotation, but `x.version` still resolved against the
  first declared record with that field (`Candidate`) and then failed with a type error. pakman
  carried ~35 typed-`let` workarounds; with the fix they are all gone. What remains are
  annotations on parameters of standalone functions whose type nothing else determines
  (`report`, `requireBase`, `manifestJson`), which is ordinary.
  One case the fix doesn't cover yet: an annotation on a tuple parameter doesn't flow through
  destructuring. In `(owners, item: (String, FileEntry)) => { let (pkg, entry) = item; entry.path }`,
  `entry.path` still resolves as `StoreEntry`. pakman's `claim` now takes `entry: FileEntry` directly.
- **`<` only works on Numbers.** No string ordering in the basis, so the shim provides
  `compareText`. `Order`'s constructors (`Less`/`Equal`/`Greater`) aren't in scope either; std
  `Map` needs one, so `text.wm` builds it from `Map.numberCompare(compareRaw(a, b), 0)`.

## Code shape

- **Carrier procedures keep effectful code flat.** The first version of pakman nested
  `Task.andThen` four or five levels deep. Rewritten in wm's documented style (named
  `Monad.via Task` transformations, values threaded as tuples, `Task|a, b|` for independent work,
  one pipeline in result position), every procedure reads top to bottom. `pakman.wm`'s `install`
  is now `series(names, lookup(p)) :> buildAll :> withCurrent :> switchToNew :> Task.map(report)`.
  Nix has no equivalent problem because evaluation has no effects; the effectful parts live in
  builders (bash) and the CLI (C++).

- **`Task|a(), b(), c()|` written inline runs the steps in order.** It lowers to nested
  `Task.andThen`, so `b()` isn't evaluated until `a()` succeeds (confirmed in the compiled
  output), and the first failure stops the rest. pakman uses it for io chains whose inputs are
  pure: `Task|mkdirp(dir), writeText(file, text, 420)|`. It also tells the reader those steps
  don't use each other's results; only steps that need an earlier result get a
  `via Task (x) => ...` stage. The trap: binding a step to a name first (`let made = mkdirp(dir);`)
  starts it immediately, because Tasks are eager, so ordering only holds for inline expressions.
  Parallel work is `List.map(...) :> Task.collectList` instead.
- **io functions stay plain, not lifted with `via Task`.** Lifting pays off when arguments are
  already carrier values, as in the Raylib examples where every FFI call returns a `Result`. In
  pakman none of the 47 io call sites take the previous step's result as their argument; they take
  pure paths, which lifted versions would need wrapped in `Task.succeed`.

## Module system

- **Packages are separate programs, not modules.** Nix finds packages with `callPackage` and
  `pkgs/by-name/` sharding (`pkgs/top-level/by-name-overlay.nix`), loaded lazily into one
  evaluator. pakman runs each package as its own compiled wm program and exchanges JSON with it (see
  DESIGN.md, "Packages are programs"). Two earlier attempts led there:
  1. A generated index module compiling every package into pakman worked, but any package change
     recompiled everything.
  2. Loading each package with `wm compile-library` + `import()` failed (below).
- **Purity by sandbox instead of by language.** Nix evaluation is pure because the language has no
  IO (with escape hatches: `builtins.fetchurl`, import-from-derivation). wm has effects, so pakman
  gets purity from Deno's permissions: `make` runs with none. Tested with a hostile package: its
  finder's request to an undeclared host failed ("Requires net access to example.com:443") and its
  attempt to read `~/.ssh/known_hosts` during `make` was denied while the plan was still produced.
- **Separately compiled wm bundles can't exchange values.** Loading each package with
  `wm compile-library` + `import()` was tried first. It fails at runtime because nullary
  constructors (`Nil`, `None`, `Host`, `Exec`, ...) are frozen singletons per bundle and matching
  compares by identity (`value === Nil`), so an empty list built in one bundle doesn't match `[]` in
  another. Comparing nullary constructors by their `ctor` number would fix it. Until then, per-package
  compilation and plugin-style package repos are blocked.
- **Package files outside the checkout need relative imports to pakman's `src/model.wm`.** wm has no
  package resolution or import maps yet (deferred in `docs/modules.md`), and absolute paths don't
  resolve. Nix's equivalent is a function taking `{ lib, stdenv, ... }:` and is location-independent.

## Scale and robustness (found writing the zig package)

- **std's `List.map`, `filter`, `append` and `concat` overflow on big lists.** They recurse once per
  element outside tail position. zig unpacks to ~20,000 files and the first install died with
  `runtime.stack-overflow`. The diagnostic itself was excellent: it named the function, explained
  that work remains after the recursive call so it can't become a loop, and said to use an
  accumulator. pakman now uses `mapAll`/`filterAll`/`appendAll`/`concatAll` built on `foldLeft` and
  `revAppend`. Nix's `map`/`filter` are native builtins and don't have this problem; wm's std
  probably should switch to accumulator versions.
- **Dynamic JSON keys need a shim.** zig's index uses version numbers as object keys and names
  like `x86_64-linux`; a wm record can't describe either, and `Json.assert` has no "object with any
  keys" shape. pakman added `jsonKeys`/`jsonField`/`jsonTextOr` to `host.ts`. Nix handles this
  natively (`builtins.fromJSON`, `attrNames`, `"x86_64-linux"` as an attribute name). A point for
  Nix: dynamic data is its home turf.
- **Compiler stack overflow** ("Maximum call stack size exceeded" reported as a type error) in
  `pkgs/zig.wm` when a polymorphic wrapper over a manually typed FFI import
  (`let field = (value, key) => { jsonField(value, key) :> Result.mapErr(...) }`) was applied to
  its own results inside a function. Annotating the wrapper (`value: Js.Value, key: String`) made
  it go away. Couldn't reduce it to a small reproduction: the same shape in a small file
  typechecks.
- **JS member calls on unannotated values can pick the wrong receiver.** `version :> .includes("-dev.")`
  with `version` unannotated was resolved against `Js.Array<String>.includes`, then failed when
  `version` was used as a string. `(version: String)` fixed it.

## Performance

- `wm compile` takes ~2.6 s for pakman. `wm run` recompiles every time, so `wm pakman`
  compiles once into a user cache outside the installed compiler source and reuses it until a source file changes.
- Compiled, a command that doesn't hit the network (`list`, `generations`) takes ~25 ms. For
  scale, evaluating one package from nixpkgs takes seconds; not a fair comparison yet (one
  package vs ~100k), but the per-package evaluation design is meant to keep it this way.
