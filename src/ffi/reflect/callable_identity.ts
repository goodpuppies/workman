import ts from "typescript-api";

// Simple monomorphic function types already fit HM. Keep a foreign identity
// when a value needs TS to select/instantiate its signature at each call.
export function foreignCallableIdentity(checker: ts.TypeChecker, type: ts.Type) {
  const signatures = type.getCallSignatures();
  if (!signatures.length) return undefined;
  const requiresReflection = signatures.length > 1 ||
    signatures.some((signature) =>
      !!signature.typeParameters?.length || signature.getParameters().some((parameter) => {
        const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
        const parameterType = declaration
          ? checker.getTypeOfSymbolAtLocation(parameter, declaration)
          : undefined;
        return !!(parameter.flags & ts.SymbolFlags.Optional) || parameterType?.isUnion() ||
          !!(declaration && ts.isParameter(declaration) && declaration.dotDotDotToken);
      })
    );
  if (!requiresReflection) return undefined;
  const description = checker.typeToString(
    type,
    undefined,
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType,
  );
  let hash = 2166136261;
  for (const character of description) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return { name: `ForeignCallable_${(hash >>> 0).toString(36)}`, key: `callable:${description}` };
}
