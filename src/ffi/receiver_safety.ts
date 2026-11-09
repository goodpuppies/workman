import type { TypeExpr } from "../ast.ts";
import type { JsCallbackParamRefs, JsTypeRef } from "./reflect/type_refs.ts";

// Policy belongs to each incoming value, never to a globally registered TS type.
export function inheritReceiverSafety<
  T extends {
    type: TypeExpr;
    resultRef?: JsTypeRef;
    callbackParamRefs?: JsCallbackParamRefs[];
  },
>(variant: T, fallible: boolean): T {
  if (!variant.resultRef && !variant.callbackParamRefs?.length) return variant;
  const incoming = (type: TypeExpr): TypeExpr => {
    if (type.kind === "TName") {
      const foreign = /^[A-Za-z_$][\w$]*$/.test(type.name) && !type.name.startsWith("Js.") &&
        !type.name.startsWith("ForeignCallable_") &&
        ![
          "String",
          "Number",
          "I32",
          "Bool",
          "Char",
          "Void",
          "Option",
          "Result",
          "Task",
          "List",
          "JsNever",
        ].includes(type.name);
      return {
        ...type,
        ...(foreign ? { ffiFallible: fallible } : {}),
        args: type.args.map(incoming),
      };
    }
    if (type.kind === "TTuple") return { ...type, items: type.items.map(incoming) };
    if (type.kind === "TFn") {
      return { ...type, params: type.params.map(incoming), result: incoming(type.result) };
    }
    return type;
  };
  const mapRef = (ref: JsTypeRef): JsTypeRef => ({
    ...ref,
    ...(ref.type ? { type: incoming(ref.type) } : {}),
    ...(ref.nestedTypeRefs ? { nestedTypeRefs: ref.nestedTypeRefs.map(mapRef) } : {}),
  });
  const callbacks = variant.callbackParamRefs?.map((callback) => ({
    ...callback,
    params: callback.params.map(mapRef),
  }));
  const type = variant.type.kind === "TFn"
    ? {
      ...variant.type,
      result: variant.resultRef ? incoming(variant.type.result) : variant.type.result,
      params: variant.type.params.map((param, index) => {
        const callback = callbacks?.find((item) => item.argIndex === index);
        return callback && param.kind === "TFn"
          ? { ...param, params: param.params.map(incoming) }
          : param;
      }),
    }
    : incoming(variant.type);
  return {
    ...variant,
    type,
    ...(variant.resultRef ? { resultRef: mapRef(variant.resultRef) } : {}),
    ...(callbacks ? { callbackParamRefs: callbacks } : {}),
  };
}

export function receiverCallFallible(ref: JsTypeRef): boolean {
  return ref.type?.kind === "TName" ? ref.type.ffiFallible ?? true : true;
}

/** An emitted member adapter has one concrete policy, even for an annotated input. */
export function receiverAdapterType(type: TypeExpr, ref: JsTypeRef): TypeExpr {
  return type.kind === "TName" && !["String", "Number", "Bool"].includes(type.name)
    ? { ...type, ffiFallible: receiverCallFallible(ref) }
    : type;
}
