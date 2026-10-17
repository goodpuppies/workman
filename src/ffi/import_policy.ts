import type { Decl, JsImportSpec, TypeExpr } from "../ast.ts";

/**
 * An authored `unsafe` import spec with a manual type, such as
 * `from js.module("./x.js") import unsafe { f: Number -> Number }`. Its type is the declaration and
 * its calls are direct, so it is an ordinary typed binding: no reflection, no overload selection, no
 * delayed resolution, and calls to it don't count as an FFI boundary for generalization.
 */
export function isDeclaredUnsafeImportSpec(
  decl: Extract<Decl, { kind: "JsImportDecl" }>,
  spec: JsImportSpec,
): boolean {
  // Aliased clauses (`import unsafe { log: … } as console`) are resolved by the FFI's qualified
  // member rewriting, so they keep the FFI path.
  return decl.clause.kind === "Named" && decl.clause.unsafe === true && !decl.clause.alias &&
    !decl.typeOnly &&
    spec.type !== undefined && !isDeepImportSpec(spec) && spec.sourceName === undefined &&
    !mentionsDynamicJsType(spec.type) &&
    (decl.target.kind === "JsModule" || decl.target.kind === "JsGlobal" ||
      decl.target.kind === "JsGlobalRoot");
}

/**
 * `Js.Value` and `Js.Object` in a signature need the FFI: their parameters are instantiated per
 * call site, and callbacks passed next to them are typed from the signature.
 */
function mentionsDynamicJsType(type: TypeExpr): boolean {
  switch (type.kind) {
    case "TName":
      return type.name === "Js.Value" || type.name === "Js.Object" ||
        type.args.some(mentionsDynamicJsType);
    case "TFn":
      return type.params.some(mentionsDynamicJsType) || mentionsDynamicJsType(type.result);
    case "TTuple":
      return type.items.some(mentionsDynamicJsType);
    case "TVar":
      return false;
  }
}

export function isDeepImportSpec(spec: JsImportSpec): boolean {
  return spec.type?.kind === "TVar" && spec.type.name === "_deep_";
}
