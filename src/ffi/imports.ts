import type { Decl, JsImportSpec, JsTarget, TypeExpr } from "../ast.ts";
import { diagnosticError } from "../diagnostics.ts";
import {
  jsConstructMember,
  jsGlobalMember,
  jsGlobalMembers,
  jsGlobalMemberTypeRef,
  jsGlobalMemberValueRef,
  jsGlobalNamespaceRef,
  jsGlobalRootNamespaceRef,
  jsGlobalTypeRef,
  jsGlobalValueMember,
  jsGlobalValueRef,
  type JsMemberType,
  jsModuleMember,
  jsModuleMembers,
  jsModuleMemberValueRef,
  jsModuleNamespaceRef,
  jsModuleTypeRef,
  type JsTypeRef,
} from "./reflect/types.ts";
import { addVariants, type FfiBinding, memberVariants } from "./shared.ts";

export function collectFfiDecl(
  bindings: Map<string, FfiBinding>,
  importedRefs: Map<string, JsTypeRef>,
  importedTypeRefs: Map<string, JsTypeRef>,
  decl: Extract<Decl, { kind: "JsImportDecl" }>,
) {
  if (decl.typeOnly) {
    collectFfiTypeDecl(importedTypeRefs, decl);
    return;
  }
  if (decl.clause.kind === "Namespace") {
    const namespaceRef = jsTargetNamespaceRef(decl.target);
    if (namespaceRef) importedRefs.set(decl.clause.alias, namespaceRef);
    for (const member of jsTargetMembers(decl.target)) {
      addVariants(
        bindings,
        `${decl.clause.alias}.${member.name}`,
        member.name,
        decl.target,
        memberVariants(member),
        !decl.clause.unsafe,
        decl.node,
      );
    }
    return;
  }
  for (const spec of decl.clause.specs) {
    if (decl.target.kind === "JsGlobalRoot" && !spec.type) {
      const localName = spec.alias ?? spec.name;
      const surfaceName = decl.clause.alias ? `${decl.clause.alias}.${localName}` : localName;
      const ref = jsGlobalValueRef(spec.name);
      importedRefs.set(surfaceName, ref);
      const construct = jsConstructMember(ref);
      if (construct) {
        addVariants(
          bindings,
          `${surfaceName}.new`,
          "new",
          { kind: "JsConstructor", path: spec.name },
          specializeForeignResultVariants(memberVariants(construct), importedTypeRefs),
          !decl.clause.unsafe,
          spec.node,
        );
      }
      const callable = jsGlobalValueMember(spec.name);
      if (callable) {
        addVariants(
          bindings,
          surfaceName,
          spec.name,
          decl.target,
          memberVariants(callable),
          !decl.clause.unsafe,
          spec.node,
        );
      }
      continue;
    }
    const reflected = !spec.type;
    if (spec.type) rejectUnimportedManualForeignTypes(spec.type, importedTypeRefs, spec.node);
    const member = spec.type
      ? { name: spec.name, type: spec.type }
      : jsTargetMember(decl.target, spec.name);
    if (!member) continue;
    const localName = spec.alias ?? spec.name;
    const surfaceName = decl.clause.alias ? `${decl.clause.alias}.${localName}` : localName;
    if (reflected) {
      const ref = jsTargetMemberValueRef(decl.target, spec.name);
      if (ref) importedRefs.set(surfaceName, ref);
    }
    addVariants(
      bindings,
      surfaceName,
      spec.name,
      decl.target,
      memberVariants(member),
      !decl.clause.unsafe,
      spec.node,
    );
  }
}

function rejectUnimportedManualForeignTypes(
  type: TypeExpr,
  importedTypeRefs: Map<string, JsTypeRef>,
  node: JsImportSpec["node"],
) {
  const name = firstUnimportedManualForeignType(type, importedTypeRefs);
  if (!name) return;
  throw diagnosticError(
    new Error(`JS FFI import uses type ${name}; FFI signatures must be explicit`),
    node,
  );
}

function firstUnimportedManualForeignType(
  type: TypeExpr,
  importedTypeRefs: Map<string, JsTypeRef>,
): string | undefined {
  switch (type.kind) {
    case "TName":
      if (
        type.args.length === 0 &&
        isForeignTypeDeclName(type.name) &&
        !isManualFfiBuiltinType(type.name) &&
        !importedTypeRefs.has(type.name)
      ) {
        return type.name;
      }
      return firstUnimportedManualForeignTypeIn(type.args, importedTypeRefs);
    case "TTuple":
      return firstUnimportedManualForeignTypeIn(type.items, importedTypeRefs);
    case "TFn":
      return firstUnimportedManualForeignTypeIn([...type.params, type.result], importedTypeRefs);
    case "TVar":
      return type.name;
  }
}

function firstUnimportedManualForeignTypeIn(
  types: TypeExpr[],
  importedTypeRefs: Map<string, JsTypeRef>,
): string | undefined {
  for (const type of types) {
    const name = firstUnimportedManualForeignType(type, importedTypeRefs);
    if (name) return name;
  }
  return undefined;
}

function isManualFfiBuiltinType(name: string): boolean {
  return name === "Number" || name === "String" || name === "Bool" || name === "Void" ||
    name === "Js.Value" || name === "Js.Object" || name === "Js.Error" ||
    name === "Js.Promise" || name === "Js.Array" || name === "Option" || name === "Result";
}

function specializeForeignResultVariants(
  variants: ReturnType<typeof memberVariants>,
  importedTypeRefs: Map<string, JsTypeRef>,
): ReturnType<typeof memberVariants> {
  return variants.map((variant) => {
    const resultType = variant.resultRef && foreignTypeForRef(variant.resultRef, importedTypeRefs);
    return resultType ? { ...variant, type: replaceResultType(variant.type, resultType) } : variant;
  });
}

function foreignTypeForRef(
  ref: JsTypeRef,
  importedTypeRefs: Map<string, JsTypeRef>,
): TypeExpr | undefined {
  for (const [name, imported] of importedTypeRefs) {
    if (imported.key === ref.key) return { kind: "TName", name, args: [] };
  }
  return undefined;
}

function replaceResultType(type: TypeExpr, result: TypeExpr): TypeExpr {
  return type.kind === "TFn" ? { ...type, result } : result;
}

function collectFfiTypeDecl(
  importedTypeRefs: Map<string, JsTypeRef>,
  decl: Extract<Decl, { kind: "JsImportDecl" }>,
) {
  if (decl.clause.kind === "Namespace") {
    throw diagnosticError(new Error("JS type imports must name the imported types"), decl.node);
  }
  for (const spec of decl.clause.specs) {
    const localName = spec.alias ?? spec.name;
    const ref = jsTypeRefForTarget(decl.target, spec.name);
    if (ref) importedTypeRefs.set(localName, ref);
  }
}

function jsTypeRefForTarget(target: JsTarget, name: string): JsTypeRef | undefined {
  if (target.kind === "JsGlobalRoot") return jsGlobalTypeRef(name);
  if (target.kind === "JsGlobal") return jsGlobalMemberTypeRef(target.path, name);
  if (target.kind === "JsModule") return jsModuleTypeRef(target.specifier, name);
  return undefined;
}

export function generatedJsImports(
  decl: Extract<Decl, { kind: "JsImportDecl" }>,
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
): Decl[] {
  if (decl.clause.kind === "Namespace") {
    const specs = [...bindings.values()]
      .filter((binding) => binding.surfaceName.startsWith(`${decl.clause.alias}.`))
      .flatMap((binding) =>
        binding.variants
          .filter((variant) => selected.has(variant.internalName))
          .map((variant) => ({
            name: variant.memberName,
            alias: variant.internalName,
            type: variant.type,
            fallible: variant.fallible,
            node: variant.node,
          }))
      );
    if (specs.length === 0) return [decl];
    return [decl, {
      ...decl,
      clause: {
        kind: "Named",
        specs,
        node: decl.clause.node,
      },
    }];
  }
  const clauseNode = decl.clause.node;
  return decl.clause.specs.flatMap((spec) => {
    const localName = spec.alias ?? spec.name;
    const surfaceName = decl.clause.alias ? `${decl.clause.alias}.${localName}` : localName;
    const binding = bindings.get(surfaceName);
    if (decl.target.kind === "JsGlobalRoot" && !spec.type && !binding) return [];
    if (!binding) return [namedJsImportDecl(decl, [spec], clauseNode)];
    const variants = binding.variants;
    if (variants.length === 1 && !decl.clause.alias) {
      return [namedJsImportDecl(
        decl,
        [{ ...spec, type: variants[0].type, fallible: variants[0].fallible }],
        clauseNode,
      )];
    }
    const selectedVariants = variants.filter((variant) => selected.has(variant.internalName));
    if (selectedVariants.length === 0) return [];
    return [namedJsImportDecl(
      decl,
      selectedVariants.map((variant) => ({
        ...spec,
        name: variant.memberName,
        alias: variant.internalName,
        type: variant.type,
        fallible: variant.fallible,
      })),
      clauseNode,
    )];
  });
}

export function generatedTypeAliases(importedTypeRefs: Map<string, JsTypeRef>): Decl[] {
  return [...importedTypeRefs]
    .filter(([typeName]) => isForeignTypeDeclName(typeName))
    .map(([typeName, ref]) => ({
      kind: "ForeignTypeDecl" as const,
      name: typeName,
      foreignKey: ref.key,
    }));
}

export function isForeignTypeDeclName(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name);
}

function namedJsImportDecl(
  decl: Extract<Decl, { kind: "JsImportDecl" }>,
  specs: JsImportSpec[],
  node: Extract<Decl, { kind: "JsImportDecl" }>["clause"]["node"],
): Extract<Decl, { kind: "JsImportDecl" }> {
  return {
    ...decl,
    clause: { kind: "Named", specs, node },
  };
}

function jsTargetMembers(target: JsTarget) {
  if (target.kind === "JsGlobalRoot") return [];
  if (target.kind === "JsGlobal") return jsGlobalMembers(target.path);
  if (target.kind === "JsModule") return jsModuleMembers(target.specifier);
  return [];
}

function jsTargetMemberValueRef(target: JsTarget, name: string): JsTypeRef | undefined {
  if (target.kind === "JsGlobal") return jsGlobalMemberValueRef(target.path, name);
  if (target.kind === "JsModule") return jsModuleMemberValueRef(target.specifier, name);
  return undefined;
}

function jsTargetNamespaceRef(target: JsTarget): JsTypeRef | undefined {
  if (target.kind === "JsGlobalRoot") return jsGlobalRootNamespaceRef();
  if (target.kind === "JsGlobal") return jsGlobalNamespaceRef(target.path);
  if (target.kind === "JsModule") return jsModuleNamespaceRef(target.specifier);
  return undefined;
}

function jsTargetMember(target: JsTarget, name: string): JsMemberType | undefined {
  if (target.kind === "JsGlobalRoot") return undefined;
  if (target.kind === "JsGlobal") return jsGlobalMember(target.path, name);
  if (target.kind === "JsModule") return jsModuleMember(target.specifier, name);
  return undefined;
}
