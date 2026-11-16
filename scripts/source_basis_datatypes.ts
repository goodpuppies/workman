import peggy from "peggy";
import type { Decl, TypeExpr } from "../src/ast.ts";
import { BASIS_LANG_ITEMS } from "../src/basis_lang_items.ts";
import type { BasisTypeDescriptor } from "../src/basis_descriptor.ts";
import { basisTypeDirectives } from "../src/module_directives.ts";

/** Parse source-owned lang items using the grammar, without bootstrapping the compiler. */
export function sourceBasisDatatypes(
  grammar: string,
  sources: Readonly<Record<string, string>>,
): BasisTypeDescriptor[] {
  const parser = peggy.generate(grammar);
  const strip = (type: TypeExpr): TypeExpr => {
    // Constructor parameters use the same descriptor representation as other Basis types.
    if (type.kind === "TVar") return { kind: "TName", name: type.name, args: [] };
    if (type.kind === "TName") {
      return {
        kind: "TName",
        name: type.name,
        ...(type.path ? { path: type.path } : {}),
        args: type.args.map(strip),
      };
    }
    if (type.kind === "TTuple") return { kind: "TTuple", items: type.items.map(strip) };
    return { kind: "TFn", params: type.params.map(strip), result: strip(type.result) };
  };
  return BASIS_LANG_ITEMS.map((item) => {
    const source = sources[item.source];
    if (!source || !basisTypeDirectives(source).includes(item.name)) {
      throw new Error(`missing @basis-type ${item.name} in ${item.source}`);
    }
    const parsed = parser.parse(source) as { decls: { first: Decl; rest: Decl[] }[] };
    const declarations = parsed.decls.flatMap((group) => [group.first, ...group.rest]);
    const candidates = declarations.filter((decl) =>
      decl.kind === "TypeDecl" && decl.name === item.name
    );
    const decl = candidates[0];
    if (
      candidates.length !== 1 || decl?.kind !== "TypeDecl" || decl.alias ||
      decl.params.length !== item.arity || decl.ctors.length === 0
    ) {
      throw new Error(`invalid source datatype ${item.name} in ${item.source}`);
    }
    if (item.firstConstructorId - decl.ctors.length + 1 < item.lastConstructorId) {
      throw new Error(`constructor identity allocation exhausted for ${item.name}`);
    }
    return {
      name: item.name,
      typeNameId: item.typeNameId,
      arity: item.arity,
      profiles: ["default"],
      equality: "structural",
      argLabels: decl.params,
      constructors: decl.ctors.map((ctor, index) => ({
        name: ctor.name,
        id: item.firstConstructorId - index,
        args: ctor.args.map(strip),
        runtimeName: `__wm_basis_${ctor.name.replaceAll(".", "_")}`,
      })),
    };
  });
}
