import { type Checker, SymbolFlags, type Type, TypeFormatFlags } from "tsrs/sync";
import { isParameterDeclaration } from "tsrs/ast/is";
import { resolveSymbolDeclaration, typeOfSymbol } from "./host.ts";

// Simple monomorphic function types already fit HM. Keep a foreign identity
// when a value needs TS to select/instantiate its signature at each call.
export function foreignCallableIdentity(checker: Checker, type: Type) {
  const signatures = type.getCallSignatures();
  if (!signatures.length) return undefined;
  const requiresReflection = signatures.length > 1 ||
    signatures.some((signature) =>
      !!signature.typeParameters?.length || signature.getParameters().some((parameter) => {
        const parameterType = typeOfSymbol(checker, parameter);
        if (parameter.flags & SymbolFlags.Optional || parameterType?.isUnionType()) return true;
        const declaration = resolveSymbolDeclaration(parameter);
        return !!(declaration && isParameterDeclaration(declaration) && declaration.dotDotDotToken);
      })
    );
  if (!requiresReflection) return undefined;
  const description = checker.typeToString(
    type,
    undefined,
    TypeFormatFlags.NoTruncation | TypeFormatFlags.UseFullyQualifiedType,
  );
  let hash = 2166136261;
  for (const character of description) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return { name: `ForeignCallable_${(hash >>> 0).toString(36)}`, key: `callable:${description}` };
}
