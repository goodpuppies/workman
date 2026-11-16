// Generated from shared Basis declarations by scripts/generate_assets.ts. Do not edit.
// deno-fmt-ignore-file
import type { BasisTypeDescriptor } from "../basis_descriptor.ts";
export const SOURCE_BASIS_DATATYPES: readonly BasisTypeDescriptor[] = [
  {
    "name": "Option",
    "typeNameId": -10,
    "arity": 1,
    "profiles": [
      "default"
    ],
    "equality": "structural",
    "argLabels": [
      "a"
    ],
    "constructors": [
      {
        "name": "None",
        "id": -1,
        "args": [],
        "runtimeName": "__wm_basis_None"
      },
      {
        "name": "Some",
        "id": -2,
        "args": [
          {
            "kind": "TName",
            "name": "a",
            "args": []
          }
        ],
        "runtimeName": "__wm_basis_Some"
      }
    ]
  },
  {
    "name": "Result",
    "typeNameId": -11,
    "arity": 2,
    "profiles": [
      "default"
    ],
    "equality": "structural",
    "argLabels": [
      "a",
      "e"
    ],
    "constructors": [
      {
        "name": "Ok",
        "id": -3,
        "args": [
          {
            "kind": "TName",
            "name": "a",
            "args": []
          }
        ],
        "runtimeName": "__wm_basis_Ok"
      },
      {
        "name": "Err",
        "id": -4,
        "args": [
          {
            "kind": "TName",
            "name": "e",
            "args": []
          }
        ],
        "runtimeName": "__wm_basis_Err"
      }
    ]
  }
];
