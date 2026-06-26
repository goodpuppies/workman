import { prune, type Ty } from "../types.ts";

export function showHoverType(type: Ty): string {
  const names = new Map<number, string>();
  let n = 0;
  const nameOf = (id: number) =>
    names.get(id) ?? (names.set(id, `'${String.fromCharCode(97 + n++)}`), names.get(id)!);
  const go = (target: Ty): string => {
    const resolved = prune(target);
    switch (resolved.tag) {
      case "var":
        return resolved.name ?? nameOf(resolved.id);
      case "ffi":
        return `?ffi#${resolved.id}:${resolved.binding ?? resolved.path.join(".")}`;
      case "prim":
        return resolved.name;
      case "tuple":
        return `(${resolved.items.map(go).join(", ")})`;
      case "fn":
        return `(${resolved.params.map(go).join(", ")}) => ${go(resolved.result)}`;
      case "struct":
        return `{ ${
          resolved.fields.map((field) => `${field.name}: ${go(field.type)}`).join(", ")
        } }`;
      case "named": {
        const name = isGeneratedDeepRecordName(resolved.name) ? "Js.Object" : resolved.name;
        return resolved.args.length ? `${name}<${resolved.args.map(go).join(", ")}>` : name;
      }
    }
  };
  return go(type);
}

export function withoutReceiverParam(type: Ty): Ty {
  const target = prune(type);
  if (target.tag !== "fn") return type;
  if (target.params.length === 1) {
    const param = prune(target.params[0]);
    if (param.tag === "tuple") {
      return { ...target, params: [{ ...param, items: param.items.slice(1) }] };
    }
  }
  return { ...target, params: target.params.slice(1) };
}

function isGeneratedDeepRecordName(name: string): boolean {
  return name.startsWith("__Deep_");
}
