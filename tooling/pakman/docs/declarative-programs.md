# Programs with a declarative boundary

Design direction, 2026-10-20. This records principles for future APIs alongside
the existing package protocol. Capability names and build constructors below
are sketches unless explicitly identified as implemented below.

## Package authors compute plans; pakman realizes them

`pak.wm` is an ordinary WM program. Its package description should be
declarative. Programming and declarativity are compatible: functions, branches,
mapping, and module composition compute the description the manager consumes.

The distinction is at the boundary:

```text
version / upstream ref / options / target
                  ↓
             WM computation
                  ↓
       typed package or build description
                  ↓
       pakman validates and realizes it
```

React is a useful analogy: a component uses ordinary program logic to describe
the UI for its inputs, while the framework owns applying that description.
Likewise, a package program describes the requested result, while pakman owns
realization. This analogy does not prescribe UI-style state or reconciliation
as a package API.

A sketch might look like:

```wm
let make = (version, options, target) => {
  let source = Github.release("owner/project", version);
  let flags = flagsFor(target, options);
  let generated = Generate.headers(source, options);
  let binary = C.compile(.{
    source,
    headers = [generated.file],
    flags,
    libraries = [Zlib.package("~1.3.0")]
  });
  Package(.{ install = [Install(binary.file, "bin/project")] })
};
```

The syntax and constructors are illustrative. The principle is that these
helpers return values describing sources, artifacts, dependencies, and results.
Calling them does not fetch sources, launch a compiler, mutate a global build
graph, or install files.

The current `make(version, ref) -> Package` already returns data under a
no-permissions package process. `Install`, `Extract`, and `WriteText` are
description constructors: their action-like names do not mean the recipe is
performing those actions. An ordered list can itself be declarative data.

Release discovery has a separate effectful interface: `versions()` may ask
declared upstream hosts for candidates. The manager applies selection policy
and records the sources and versions. Future options and target parameters
should preserve the separation between discovery and describing realization.

## Dependencies come from consumed values

If compilation consumes a generated header, referencing that artifact should
establish the dependency. Authors should not also have to create graph nodes,
attach the generation step to the compilation step, and attach that step to an
installation step.

The same rule applies across package instances. A file reference to a selected
WM instance records the edge to that WM; the selected WM records its Deno edge.
The author should not separately maintain a scheduler's representation of those
relationships. Current `Instance` references already follow this principle for
package dependencies; future generated-artifact references should extend it to
build dependencies.

Where order is semantically necessary, it can be represented in the returned
description. The goal is to avoid redundant engine bookkeeping, not to pretend
every operation is independent. A command with declared arguments, inputs, and
outputs can also be data; declarativity does not require inventing a dedicated
constructor for every upstream build tool.

This makes the manager's job possible without reconstructing the recipe's
execution history. Structured descriptions give it information to validate,
hash, compare, cache, and schedule. Typed references expose closures and let it
identify the inputs consumed by a result. Remote realization or alternative
providers could build on that information later; they are not automatic
guarantees of merely returning a value.

## Lessons from Zig build and nob.h

[Zig's build system](https://ziglang.org/learn/build-system/) demonstrates the
value of using the project's programming language for build descriptions. Its
API also exposes building a graph through operations such as adding steps and
calling `dependOn`. The graph is realized later; constructing it is distinct
from immediately running a compiler.

For pakman, the design lesson is to keep routine package code focused on values
and their references. Explicit graph construction and mutation should not
become the main authoring model. A build is one useful result a pak program can
describe; the repository interface should also accommodate packaging, version
discovery, applications, and other capabilities without forcing them all into
the shape of build-engine steps.

[nob.h](https://github.com/tsoding/nob.h) supplies a header-only library for
writing build recipes in C, including command and filesystem helpers. Its
appeal here is the library approach: ordinary host-language code plus useful,
composable tools, with room for a program to do more than one narrowly defined
build task.

Pakman should have that library feel. Small constructors and transformations
should make common operations cheap to describe. A small pak can stay one file;
a sophisticated one can introduce modules and tests. Neither needs a special
configuration language or a mandatory framework lifecycle to gain abstractions.

The additional pakman requirement is the manager-facing declarative contract.
A helper for describing compilation should return a build value. A lower-level
process-execution helper directly performs an effect and belongs at a different,
explicit execution boundary. A convenient library must not erase that
distinction.

Nix's useful influence is the separation between evaluating descriptions and
realizing their results. The aim is to combine that separation with normal WM
library composition and a repository-native entrypoint. These are API-design
influences, not a claim that another language or tool can express only packages
or only builds.

## One entrypoint can expose several capabilities

Conceptually, a repository contains a pakman program. It need not choose a
permanent identity as only a package, only a builder, or only a flake-like
repository. The manager asks for supported interfaces:

| Capability | Possible description |
|---|---|
| Version provider | Available releases and how to provide a selection |
| Package | Sources, dependencies, installed artifacts, integration |
| Builder | Inputs, options, target, and produced artifacts |
| Application | An executable result and its runtime requirements |
| Development environment | Tools and environment configuration |
| System or image | A composed system, root filesystem, or firmware result |

Only the current package/version/build-callback protocol is implemented.
The rest of this table describes room for future interfaces, not a commitment
to implement all of them or to introduce a capability registry now.

A tiny project can implement one interface. A larger repository can compose
several. Adding an application or environment description should not require
adopting another manifest language, renaming `pak.wm`, or becoming a different
kind of repository. Ordinary WM module filenames remain the author's choice;
the principle concerns the public entrypoint and its contracts.

Capabilities still need typed, inspectable protocols. Supporting more kinds of
results does not mean sending arbitrary WM values to a manager that somehow
understands them, or granting arbitrary effects during evaluation. The manager
understands particular interfaces; programs implement the interfaces they need.

## Existing build callbacks are an explicit escape hatch

Today `Build(id, tools)` declares an opaque callback selected by ID.
`serveWithBuild` executes ordinary imperative WM Tasks inside the offline build
sandbox. The manager stages inputs, controls the environment, validates output,
and owns the store and generations.

That is a controlled execution boundary, but it does not expose the callback's
internal artifact graph. Sandboxing imperative code does not make its internal
operations declarative. The manager cannot infer every intermediate dependency
or independently cache every internal operation from the callback ID alone.

Keep this distinction visible as the build API develops. Higher-level helpers
should preferably return structured build descriptions. Existing callbacks can
remain a clearly identified escape hatch for operations not yet represented by
those descriptions; their orchestration should not become mandatory boilerplate
for ordinary packages. There is no callback migration in this design note.

## Compiled applications and backend policy

The implemented `BuildCommand` operation describes a selected program, its
arguments, a source archive and one output to install. It is language-neutral:
pakman has no built-in knowledge of WM or its compilation command. Atview's
recipe makes that choice explicit:

```wm
let wm = package("wm", "~0.4.2");
BuildCommand(.{
  program = file(wm, ".local/bin/wm"),
  arguments = ["compile", "app/main.wm", "--executable", "-o", "atview"],
  source = "atview.tar",
  strip = 1,
  output = "atview",
  dest = ".local/bin/atview",
  mode = Exec
})
```

The manager extracts the locked source, runs the program with exactly the given
arguments in that directory, and installs the declared relative output. The
arguments are passed directly, without implicit shell interpretation. The
program is a build-only dependency; its reference participates in resolution
and build identity but is omitted from the runtime closure. Executable and data
outputs use the same operation. WM receives no privileged package-manager API.

`wm compile ... --executable` is WM's own public CLI. It emits JavaScript and
worker artifacts, then uses its selected Deno's
[`deno compile`](https://docs.deno.com/runtime/reference/cli/compile/) to build
the executable. Generated workers are included in the executable. A future
library helper may construct this same generic value; it need not introduce a
language-specific operation in pakman.

Atview builds only `app/main.wm`. If an application wants argument-based
CLI/TUI dispatch, its author implements that in its own entrypoint. Neither
pakman nor WM interprets application arguments to choose another program.
Atview retains its working-directory `.env` convention; credentials never
become package inputs.

The WM recipe has only a shell launcher for its selected Deno, upstream
`src/cli.ts` and source `deno.json`. There is no package-owned TypeScript adapter
or compiler-tree copy. WM defaults to `nodeModulesDir = "none"`, declares its Node type dependency
explicitly and resolves declarations from Deno's package cache when local `node_modules` is
disabled. Reflection does not rewrite project configuration or run `deno install`.
`wm pakman` stores its generated launcher under the user's cache directory,
separated by compiler source location, rather than writing into installed source.

These fixes and executable support are included in the WM `0.4.2` Git tag.
Git tagging and JSR package publication are separate steps. Application
recipes require `~0.4.2` so selection cannot fall back to WM 0.4.1. The normal
release age policy still applies to private dependencies.
Compiling WM itself remains separate work: uses of `Deno.execPath()` as a Deno
CLI need attention before embedding the compiler in another executable.

**Offline builds are not a universal pakman requirement.** The existing
`Build` callback backend deliberately runs offline. That is a backend policy,
not a requirement that every package vendor all language dependencies or declare
every build-tool download as a separate pakman source.

The command build backend permits network access inside a filesystem sandbox.
The selected Deno may fetch its compilation runtime and application imports
using its normal mechanisms. An empty cache is supported; download failures
fail the build before activation. Pakman does not provision an offline Deno
runtime, promise byte-identical builds, or provide a first-class offline story.
A user or a future specialized backend can arrange offline inputs when needed.

Filesystem isolation, network policy, dependency version selection and
reproducibility are separate concerns. This Linux backend mounts the selected
tool runtime closure and host `/usr` read-only, hides the host home and clears the
environment. Build scratch is writable, networking is shared, and tool caches
under its scratch home are private to the build. The manager copies only the
declared regular output to the package output. Its cache identity covers the plan, source hashes,
selected tool tree, OS/architecture and backend implementation/Bubblewrap;
host library changes and mutable network dependencies are outside that cache
contract. No Arch package database is required for this command build backend.

## API review questions

When adding a package or build API, ask:

1. Does this helper compute a description, or start performing its effects?
2. Can a consumed value establish a dependency instead of a separate edge call?
3. Is the author describing a requirement or managing engine scheduling,
   cache state, temporary directories, or provider orchestration?
4. Can options and variants be ordinary function inputs instead of builder
   mutations?
5. Does this interface compose as a small WM library, and can its implementation
   grow into a tested codebase without changing the public model?
6. Could another capability reuse these values without pretending to be a
   compilation step?

When engine details can be inferred from the returned values, pakman should own
them. This is programmable configuration with a declarative boundary.
