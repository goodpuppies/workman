import {
  type BasisTypeDescriptor,
  type BasisValueDescriptor,
  ctor,
  defaultOnly,
} from "../basis_descriptor.ts";

// The JavaScript host layer (layer 3, `markdown/basis-design.md`): the `Js.*` types and the
// compiler-implemented JS host values. Their identities are semantic ids shared with layer 0's
// numbering, so splitting them out of `basis_manifest.ts` changes no identity. They are the FFI
// vocabulary (BD17): default profile only, since the kernel profile has no JavaScript target.

export const JS_HOST_TYPES = Object.freeze(
  [
    { name: "Js.Value", typeNameId: -5, arity: 0, profiles: defaultOnly, equality: "never" },
    { name: "Js.Object", typeNameId: -6, arity: 0, profiles: defaultOnly, equality: "never" },
    {
      name: "Js.Array",
      typeNameId: -7,
      arity: 1,
      profiles: defaultOnly,
      equality: "never",
      argLabels: ["element"],
    },
    { name: "Js.ArrayLike", typeNameId: -8, arity: 0, profiles: defaultOnly, equality: "never" },
    {
      name: "Js.Dict",
      typeNameId: -9,
      arity: 1,
      profiles: defaultOnly,
      equality: "never",
      argLabels: ["value"],
    },
    {
      // Map-backed sibling of Js.Dict for large, hot, string-keyed caches.
      // Deliberately not JS-interop compatible: it never crosses the FFI
      // boundary, which is what frees it from Js.Dict's plain-object contract.
      name: "Js.Table",
      typeNameId: -22,
      arity: 1,
      profiles: defaultOnly,
      equality: "never",
      argLabels: ["value"],
    },
    {
      name: "Js.Error",
      typeNameId: -13,
      arity: 0,
      profiles: defaultOnly,
      equality: "structural",
      constructors: [
        ctor("Js.Error", -7, [{ kind: "TName", name: "String", args: [] }]),
        ctor("Js.Unknown", -8, []),
      ],
    },
  ] satisfies readonly BasisTypeDescriptor[],
);

/**
 * JS host values implemented by the compiler's runtime prelude: the FFI vocabulary (BD17). Host
 * helper modules (`Dict`, `Table`, `Bytes`, `Debug`) are library modules in `host/js/`.
 */
export const JS_HOST_VALUES: readonly BasisValueDescriptor[] = Object.freeze([
  { exportName: "Js.Array.toList", profiles: defaultOnly, runtimeName: "Js.Array.toList" },
  { exportName: "Js.Array.fromList", profiles: defaultOnly, runtimeName: "Js.Array.fromList" },
  { exportName: "Json.assert", profiles: defaultOnly, runtimeName: "Json.assert" },
]);
