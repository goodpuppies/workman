import type { TypeNameId } from "./ids.ts";
import type { NominalFacts } from "./nominal_facts.ts";
import { prune, type Ty } from "./types.ts";

export type SemanticTypeId = number & { readonly __semanticTypeId: true };

export type SemanticTypeShape =
  | Readonly<{ kind: "variable"; variable: number; name?: string }>
  | Readonly<{ kind: "ffi"; obligation: number; path: string; binding?: string }>
  | Readonly<{ kind: "primitive"; name: string }>
  | Readonly<{
    kind: "function";
    params: readonly SemanticTypeId[];
    result: SemanticTypeId;
  }>
  | Readonly<{ kind: "tuple"; items: readonly SemanticTypeId[] }>
  | Readonly<{
    kind: "structural-record";
    fields: readonly Readonly<{ name: string; type: SemanticTypeId }>[];
  }>
  | Readonly<{
    kind: "named";
    typeNameId?: TypeNameId;
    inferenceTypeId: number;
    name: string;
    args: readonly SemanticTypeId[];
    foreignKey?: string;
  }>;

export type SemanticType = Readonly<{
  id: SemanticTypeId;
  rendered: string;
  shape: SemanticTypeShape;
}>;

export type SemanticTypeArena = {
  snapshot(type: Ty): SemanticTypeId;
  finish(): readonly SemanticType[];
};

/** Freeze inference types into a protocol-neutral, module-interface-owned arena. */
export function createSemanticTypeArena(nominalFacts: NominalFacts): SemanticTypeArena {
  const types: SemanticType[] = [];
  const byType = new Map<Ty, SemanticTypeId>();
  const variables = new Map<number, number>();

  const snapshot = (input: Ty): SemanticTypeId => {
    const type = prune(input);
    const existing = byType.get(type);
    if (existing !== undefined) return existing;
    const id = types.length as SemanticTypeId;
    byType.set(type, id);
    // Reserve the slot before descending so a malformed cyclic inference graph cannot recurse
    // forever. Ordinary elaborated types are acyclic after pruning.
    types.push(undefined as unknown as SemanticType);
    const shape = snapshotShape(type, snapshot, nominalFacts, variables);
    const rendered = renderShape(shape, types);
    types[id] = Object.freeze({ id, rendered, shape });
    return id;
  };

  return {
    snapshot,
    finish: () => Object.freeze([...types]),
  };
}

function snapshotShape(
  type: Ty,
  snapshot: (type: Ty) => SemanticTypeId,
  nominalFacts: NominalFacts,
  variables: Map<number, number>,
): SemanticTypeShape {
  switch (type.tag) {
    case "var": {
      let variable = variables.get(type.id);
      if (variable === undefined) {
        variable = variables.size;
        variables.set(type.id, variable);
      }
      return Object.freeze({
        kind: "variable",
        variable,
        name: type.name,
      });
    }
    case "ffi":
      return Object.freeze({
        kind: "ffi",
        obligation: type.id,
        path: type.path.join("."),
        binding: type.binding,
      });
    case "prim":
      return Object.freeze({ kind: "primitive", name: type.name });
    case "fn":
      return Object.freeze({
        kind: "function",
        params: Object.freeze(type.params.map(snapshot)),
        result: snapshot(type.result),
      });
    case "tuple":
      return Object.freeze({
        kind: "tuple",
        items: Object.freeze(type.items.map(snapshot)),
      });
    case "struct":
      return Object.freeze({
        kind: "structural-record",
        fields: Object.freeze(
          type.fields.map((field) =>
            Object.freeze({ name: field.name, type: snapshot(field.type) })
          ),
        ),
      });
    case "named":
      return Object.freeze({
        kind: "named",
        typeNameId: nominalFacts.inferenceTypeIds.get(type.id),
        inferenceTypeId: type.id,
        name: type.name,
        args: Object.freeze(type.args.map(snapshot)),
        foreignKey: type.foreignKey,
      });
  }
}

function renderShape(shape: SemanticTypeShape, types: readonly SemanticType[]): string {
  const render = (id: SemanticTypeId) => types[id]?.rendered ?? `?type#${id}`;
  switch (shape.kind) {
    case "variable":
      return shape.name ?? `'${String.fromCharCode(97 + shape.variable)}`;
    case "ffi":
      return `?ffi#${shape.obligation}:${shape.binding ?? shape.path}`;
    case "primitive":
      return shape.name;
    case "function":
      return `(${shape.params.map(render).join(", ")}) => ${render(shape.result)}`;
    case "tuple":
      return `(${shape.items.map(render).join(", ")})`;
    case "structural-record":
      return `{ ${
        shape.fields.map((field) => `${field.name}: ${render(field.type)}`).join(", ")
      } }`;
    case "named":
      return shape.args.length === 0
        ? shape.name
        : `${shape.name}<${shape.args.map(render).join(", ")}>`;
  }
}
