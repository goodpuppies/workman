import type { ModuleInterface } from "../module_interface.ts";
import type { SemanticTypeId, SemanticTypeShape } from "../semantic_types.ts";

/** Shared presentation for immutable compiler semantic types. */
export function renderSemanticType(
  moduleInterface: ModuleInterface,
  id: SemanticTypeId,
  dropReceiver = false,
): string {
  const variables = new Map<number, string>();
  let nextVariable = 0;
  const render = (currentId: SemanticTypeId): string => {
    const type = moduleInterface.semanticTypes[currentId];
    if (!type) return `?type#${currentId}`;
    return renderSemanticShape(type.shape, render, (variable) => {
      const existing = variables.get(variable);
      if (existing) return existing;
      const name = `'${String.fromCharCode(97 + nextVariable++)}`;
      variables.set(variable, name);
      return name;
    });
  };
  const type = moduleInterface.semanticTypes[id];
  if (!type || !dropReceiver || type.shape.kind !== "function") return render(id);
  if (type.shape.params.length === 1) {
    const parameter = moduleInterface.semanticTypes[type.shape.params[0]]?.shape;
    if (parameter?.kind === "tuple") {
      const tuple = `(${parameter.items.slice(1).map(render).join(", ")})`;
      return `(${tuple}) => ${render(type.shape.result)}`;
    }
  }
  return `(${type.shape.params.slice(1).map(render).join(", ")}) => ${
    render(type.shape.result)
  }`;
}

function renderSemanticShape(
  shape: SemanticTypeShape,
  render: (id: SemanticTypeId) => string,
  variableName: (variable: number) => string,
): string {
  switch (shape.kind) {
    case "variable":
      return shape.name ?? variableName(shape.variable);
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
    case "named": {
      const name = shape.name.startsWith("__Deep_") ? "Js.Object" : shape.name;
      return shape.args.length === 0
        ? name
        : `${name}<${shape.args.map(render).join(", ")}>`;
    }
  }
}
