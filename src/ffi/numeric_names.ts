import type { Decl, Module, TypeExpr } from "../ast.ts";

/**
 * The compiler-owned numeric types under their bare namespace names. In ordinary annotations a
 * bare `Real64` reaches `Real64.Real` through the namespace's `Self` type; FFI signatures are
 * checked by spelling before type lookup, so they are given the canonical spelling up front.
 */
const CANONICAL_NUMERIC_NAMES: ReadonlyMap<string, string> = new Map([
  ["Int32", "Int32.Int"],
  ["Int64", "Int64.Int"],
  ["Real32", "Real32.Real"],
  ["Real64", "Real64.Real"],
  ["Word8", "Word8.Word"],
  ["Word16", "Word16.Word"],
  ["Word32", "Word32.Word"],
  ["Word64", "Word64.Word"],
]);

/** The canonical type name a written numeric name means: `Real64` and `Real64.Real` alike. */
export function canonicalNumericTypeName(name: string): string {
  return CANONICAL_NUMERIC_NAMES.get(name) ?? name;
}

/** Spell bare numeric namespaces in JS and C import signatures as their canonical type names. */
export function canonicalizeFfiNumericNames(module: Module, localTypes: Set<string>): Module {
  let changed = false;
  const rewrite = (type: TypeExpr): TypeExpr => {
    switch (type.kind) {
      case "TName": {
        const canonical = type.args.length === 0 && !localTypes.has(type.name)
          ? CANONICAL_NUMERIC_NAMES.get(type.name)
          : undefined;
        if (canonical) {
          changed = true;
          return { ...type, name: canonical, path: undefined };
        }
        const args = type.args.map(rewrite);
        return args.every((arg, index) => arg === type.args[index]) ? type : { ...type, args };
      }
      case "TTuple": {
        const items = type.items.map(rewrite);
        return items.every((item, index) => item === type.items[index])
          ? type
          : { ...type, items };
      }
      case "TFn": {
        const params = type.params.map(rewrite);
        const result = rewrite(type.result);
        return result === type.result && params.every((param, index) => param === type.params[index])
          ? type
          : { ...type, params, result };
      }
      case "TVar":
        return type;
    }
  };
  const decls = module.decls.map((decl): Decl => {
    if (decl.kind !== "JsImportDecl" || decl.clause.kind !== "Named") return decl;
    const specs = decl.clause.specs.map((spec) => spec.type ? { ...spec, type: rewrite(spec.type) } : spec);
    return { ...decl, clause: { ...decl.clause, specs } };
  });
  return changed ? { ...module, decls } : module;
}
