import type { ModuleInterface } from "../module_interface.ts";
import type { SemanticTypeId, SemanticTypeShape } from "../semantic_types.ts";

/** Shared presentation for immutable compiler semantic types. */
export function renderSemanticType(
  moduleInterface: ModuleInterface,
  id: SemanticTypeId,
  dropReceiver = false,
): string {
  return renderSemanticTypeWithLimits(moduleInterface, id, dropReceiver);
}

/** Concise structured rendering for inline labels; full rendering remains available for tooltips. */
export function renderSemanticTypeCompact(
  moduleInterface: ModuleInterface,
  id: SemanticTypeId,
): string {
  return renderSemanticTypeWithLimits(moduleInterface, id, false, {
    maxDepth: 4,
    maxItems: 4,
  });
}

function renderSemanticTypeWithLimits(
  moduleInterface: ModuleInterface,
  id: SemanticTypeId,
  dropReceiver: boolean,
  limits?: Readonly<{ maxDepth: number; maxItems: number }>,
): string {
  const variables = new Map<number, string>();
  let nextVariable = 0;
  const render = (currentId: SemanticTypeId, depth = 0): string => {
    const type = moduleInterface.semanticTypes[currentId];
    if (!type) return `?type#${currentId}`;
    if (
      limits && depth >= limits.maxDepth &&
      type.shape.kind !== "variable" &&
      type.shape.kind !== "ffi" &&
      type.shape.kind !== "primitive"
    ) return "…";
    return renderSemanticShape(
      type.shape,
      (child) => render(child, depth + 1),
      (child) => moduleInterface.semanticTypes[child]?.shape.kind === "function",
      (variable) => {
        const existing = variables.get(variable);
        if (existing) return existing;
        const name = `'${String.fromCharCode(97 + nextVariable++)}`;
        variables.set(variable, name);
        return name;
      },
      limits?.maxItems,
    );
  };
  const type = moduleInterface.semanticTypes[id];
  if (!type || !dropReceiver || type.shape.kind !== "function") return render(id);
  if (type.shape.params.length === 1) {
    const parameter = moduleInterface.semanticTypes[type.shape.params[0]]?.shape;
    if (parameter?.kind === "tuple") {
      const remaining = parameter.items.slice(1);
      const domain = remaining.length === 0
        ? "Void"
        : remaining.length === 1
        ? render(remaining[0])
        : `(${remaining.map((item) => render(item)).join(", ")})`;
      return `${domain} -> ${render(type.shape.result)}`;
    }
  }
  const remaining = type.shape.params.slice(1);
  const domain = remaining.length === 0
    ? "Void"
    : remaining.length === 1
    ? render(remaining[0])
    : `(${remaining.map((item) => render(item)).join(", ")})`;
  return `${domain} -> ${render(type.shape.result)}`;
}

function renderSemanticShape(
  shape: SemanticTypeShape,
  render: (id: SemanticTypeId) => string,
  isFunction: (id: SemanticTypeId) => boolean,
  variableName: (variable: number) => string,
  maxItems = Number.POSITIVE_INFINITY,
): string {
  const renderItems = (items: readonly SemanticTypeId[]): string[] => [
    ...items.slice(0, maxItems).map(render),
    ...(items.length > maxItems ? ["…"] : []),
  ];
  const functionDomain = (params: readonly SemanticTypeId[]): string => {
    const rendered = renderItems(params);
    if (params.length === 0) return "Void";
    if (params.length > 1) return `(${rendered.join(", ")})`;
    return isFunction(params[0]) ? `(${rendered[0]})` : rendered[0];
  };
  switch (shape.kind) {
    case "variable":
      return shape.name ?? variableName(shape.variable);
    case "ffi":
      return `?ffi#${shape.obligation}:${shape.binding ?? shape.path}`;
    case "primitive":
      return shape.name;
    case "function":
      return `${functionDomain(shape.params)} -> ${render(shape.result)}`;
    case "tuple":
      return `(${renderItems(shape.items).join(", ")})`;
    case "structural-record":
      return `{ ${
        [
          ...shape.fields.slice(0, maxItems).map((field) => `${field.name}: ${render(field.type)}`),
          ...(shape.fields.length > maxItems ? ["…"] : []),
        ].join(", ")
      } }`;
    case "named": {
      const name = shape.name.startsWith("__Deep_") ? "Js.Object" : shape.name;
      return shape.args.length === 0 ? name : `${name}<${renderItems(shape.args).join(", ")}>`;
    }
  }
}
