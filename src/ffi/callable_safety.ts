import type { TypeExpr } from "../ast.ts";
import type { JsTypeRef } from "./reflect/type_refs.ts";

/** Keep the producing boundary's wrapping policy in the callable's HM identity. */
export function inheritCallableSafety<T extends { type: TypeExpr; resultRef?: JsTypeRef }>(
  variant: T,
  fallible: boolean,
): T {
  if (fallible || !variant.resultRef) return variant;
  const renamed = new Map<string, string>();
  const collect = (ref: JsTypeRef): void => {
    if (
      ref.key.startsWith("callable:") && ref.callableFallible !== false &&
      ref.type?.kind === "TName"
    ) {
      renamed.set(ref.type.name, `${ref.type.name}_unsafe`);
    }
    ref.nestedTypeRefs?.forEach(collect);
  };
  collect(variant.resultRef);
  if (!renamed.size) return variant;
  const mapType = (type: TypeExpr): TypeExpr => {
    switch (type.kind) {
      case "TName":
        return { ...type, name: renamed.get(type.name) ?? type.name, args: type.args.map(mapType) };
      case "TTuple":
        return { ...type, items: type.items.map(mapType) };
      case "TFn":
        return { ...type, params: type.params.map(mapType), result: mapType(type.result) };
      default:
        return type;
    }
  };
  const mapRef = (ref: JsTypeRef): JsTypeRef => ({
    ...ref,
    ...(ref.key.startsWith("callable:") && ref.callableFallible !== false
      ? { key: `callable:unsafe:${ref.key.slice("callable:".length)}`, callableFallible: false }
      : {}),
    ...(ref.type ? { type: mapType(ref.type) } : {}),
    ...(ref.nestedTypeRefs ? { nestedTypeRefs: ref.nestedTypeRefs.map(mapRef) } : {}),
  });
  return {
    ...variant,
    type: variant.type.kind === "TFn"
      ? { ...variant.type, result: mapType(variant.type.result) }
      : mapType(variant.type),
    resultRef: mapRef(variant.resultRef),
  };
}
