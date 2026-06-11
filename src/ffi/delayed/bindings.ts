import type { Decl } from "../../ast.ts";
import { isForeignTypeDeclName } from "../imports.ts";
import type { JsTypeRef } from "../reflect/types.ts";

export function generatedImportInsertionIndex(decls: Decl[]): number {
  let lastTypeDecl = -1;
  for (let index = 0; index < decls.length; index++) {
    const kind = decls[index].kind;
    if (kind === "ForeignTypeDecl" || kind === "RecordDecl" || kind === "TypeDecl") {
      lastTypeDecl = index;
    }
  }
  if (lastTypeDecl !== -1) return lastTypeDecl + 1;
  const firstLet = decls.findIndex((decl) => decl.kind === "LetDecl");
  return firstLet === -1 ? decls.length : firstLet;
}

export function generatedForeignDeclsForRefs(
  decls: Decl[],
  foreignTypeRefs: Map<string, JsTypeRef>,
): Decl[] {
  const existing = existingForeignDeclKeys(decls);
  const localTypes = existingTypeNames(decls);
  const generated: Decl[] = [];
  for (const [name, ref] of foreignTypeRefs) {
    if (!isForeignTypeDeclName(name)) continue;
    if (localTypes.has(name)) continue;
    const key = `${name}:${ref.key}`;
    if (existing.has(key)) continue;
    existing.add(key);
    generated.push({
      kind: "ForeignTypeDecl",
      name,
      foreignKey: ref.key,
    });
  }
  return generated;
}

function existingForeignDeclKeys(decls: Decl[]): Set<string> {
  return new Set(
    decls
      .filter((decl) => decl.kind === "ForeignTypeDecl")
      .map((decl) => `${decl.name}:${decl.foreignKey ?? ""}`),
  );
}

function existingTypeNames(decls: Decl[]): Set<string> {
  const names = new Set<string>();
  for (const decl of decls) {
    if (
      decl.kind === "ForeignTypeDecl" || decl.kind === "RecordDecl" || decl.kind === "TypeDecl"
    ) {
      names.add(decl.name);
    }
  }
  return names;
}
