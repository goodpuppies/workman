# FIXED: Havok tuple return reflection through a foreign interface member

## Status

Fixed in `wm-mini`. The original report correctly identified a reflection failure, but the failure
was not loss of the returned interface or its declared members.

## Summary

`@babylonjs/havok` declares this member on `HavokPhysicsWithBindings`:

```ts
HP_World_Create(): [Result, HP_WorldId];
```

Workman found both the foreign interface and `HP_World_Create`, but mapped the fixed tuple return to
`Js.Object`. The following tuple destructuring constraint could not unify with that opaque recovery
type, so the call was eventually reported as an unresolved FFI obligation.

## Reproduction

TypeScript loader:

```ts
import HavokPhysics, { type HavokPhysicsWithBindings } from "@babylonjs/havok";

export const initHavok = (): Promise<HavokPhysicsWithBindings> => HavokPhysics();
```

Workman:

```wm
from js.module("./havok_loader.ts") import { initHavok };
from js.module("./havok_loader.ts") import type { HavokPhysicsWithBindings };

let createWorld = (havok: HavokPhysicsWithBindings) => {
  havok.HP_World_Create() :> Result.map((_status, world) => { world })
};

let main = () => {
  initHavok()
    :> Task.andThen((havok) => { createWorld(havok) :> Task.fromResult })
};
```

Before the fix, `wm type-debug` left `?ffi:HP_World_Create` unresolved.

## Root cause

General TypeScript result mapping did not recognize fixed tuples. Because tuples are object-like in
TypeScript, the mapper recovered the unsupported static result as `Js.Object`. This erased the
tuple positions before HM could use them.

The cleanup exposed two related requirements:

- named tuple aliases such as `HP_WorldId = [bigint]` must remain nominal and opaque rather than
  being expanded structurally;
- Havok's numeric `Result` enum needs an honest `Number` mapping rather than a `Js.Value` fallback.

The async return and the `EmscriptenModule` base interface were not responsible. A scalar-returning
member on the same `HavokPhysicsWithBindings` interface reflected correctly.

## Resolution

Fixed TypeScript tuples now map recursively to Workman tuples. Named tuple aliases retain their
nominal foreign identity, numeric enums map to `Number`, and unsupported static results remain
unresolved instead of being manufactured as `Js.Object` or `Js.Value`.

The reflected signature is now:

```txt
HP_World_Create : HavokPhysicsWithBindings -> Result<(Number, HP_WorldId), Js.Error>
```

The first element is `Number` because the TypeScript declaration defines `Result` as a numeric enum.
The direct example passes `wm check` and infers:

```txt
createWorld : HavokPhysicsWithBindings -> Result<HP_WorldId, Js.Error>
```

## Original control case

A typed top-level forwarding function returning `HP_WorldId` worked before the fix. It established
that the type import and foreign value survived the async boundary, but it avoided the unsupported
outer tuple and therefore did not prove that interface member dispatch itself was broken.

## Application follow-up

The runtime boundary now also converts reflected fixed-tuple arrays into tagged Workman tuples (and
tagged tuple parameters back into JavaScript arrays). `wmthree` retains a narrow typed adapter to
turn Havok status codes into fallible Workman calls and to give opaque C-like handles explicit
import signatures; it is no longer needed merely to make fixed-tuple returns destructurable.
