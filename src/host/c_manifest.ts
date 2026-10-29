import { type BasisTypeDescriptor, defaultOnly } from "../basis_descriptor.ts";

// Shared identities let pointers cross module boundaries without losing their pointee type.
export const C_HOST_TYPES: readonly BasisTypeDescriptor[] = Object.freeze([
  {
    name: "Ptr",
    typeNameId: -36,
    arity: 1,
    profiles: defaultOnly,
    equality: "never",
    hostOwned: true,
    argLabels: ["pointee"],
  },
  {
    name: "Opaque",
    typeNameId: -37,
    arity: 0,
    profiles: defaultOnly,
    equality: "never",
    hostOwned: true,
  },
  {
    name: "Int64.Int",
    typeNameId: -38,
    arity: 0,
    profiles: defaultOnly,
    equality: "always",
    hostOwned: true,
  },
  {
    name: "CStorage",
    typeNameId: -39,
    arity: 1,
    profiles: defaultOnly,
    equality: "never",
    hostOwned: true,
    argLabels: ["pointee"],
    recordFields: [
      {
        name: "pointer",
        type: {
          kind: "TName",
          name: "Ptr",
          args: [{ kind: "TName", name: "pointee", args: [] }],
        },
      },
      { name: "size", type: { kind: "TName", name: "Number", args: [] } },
    ],
  },
]);
