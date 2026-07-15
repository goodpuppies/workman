import ts from "typescript";
import type { TypeExpr } from "../../ast.ts";
import { type JsCallArgHint } from "./type_refs.ts";
import { typeExprFromTsType } from "./type_mapping.ts";
import { typeOfSymbol } from "./host.ts";
import { tsTypeFromTypeExpr } from "./ts_type_expr.ts";
import { fn, name } from "../type_expr.ts";

export function functionTypeFromCall(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  signature: ts.Signature,
  args: JsCallArgHint[],
): TypeExpr | undefined {
  const signatureParams = signature.getParameters();
  const declaration = signature.getDeclaration();
  const params = call.arguments.map((arg, index) => {
    if (args[index]?.kind === "function") {
      return syntheticCallbackTypeFromArg(checker, arg, args[index]);
    }
    if (args[index]?.kind === "string") return name("String");
    if (args[index]?.kind === "number") return name("Number");
    if (args[index]?.kind === "ref") {
      return args[index].type ??
        typeExprFromTsType(checker, checker.getTypeAtLocation(arg), "param") ??
        name("Js.Value");
    }
    const lastParameterIndex = signatureParams.length - 1;
    const hasRestParameter = lastParameterIndex >= 0 &&
      !!declaration?.parameters[lastParameterIndex]?.dotDotDotToken;
    const signatureParamIndex = hasRestParameter && index > lastParameterIndex
      ? lastParameterIndex
      : index;
    const symbolType = signatureParams[signatureParamIndex]
      ? typeOfSymbol(checker, signatureParams[signatureParamIndex])
      : undefined;
    const reflectedParamType = symbolType
      ? suppliedParameterType(checker, symbolType, declaration, signatureParamIndex, index)
      : undefined;
    const mapped = reflectedParamType
      ? typeExprFromTsType(checker, reflectedParamType, "param") ?? name("Js.Value")
      : name("Js.Value");
    return stripSuppliedOptionalParam(mapped, declaration, index);
  });
  const result = typeExprFromTsType(checker, checker.getTypeAtLocation(call));
  if (!result) return undefined;
  return fn(params, result);
}

function suppliedParameterType(
  checker: ts.TypeChecker,
  type: ts.Type,
  declaration: ts.SignatureDeclaration | undefined,
  declarationIndex: number,
  argumentIndex: number,
): ts.Type {
  const parameter = declaration?.parameters[declarationIndex];
  if (!parameter?.dotDotDotToken) return type;
  const ref = type as ts.TypeReference;
  const target = ref.target as (ts.TupleType & ts.ObjectType) | undefined;
  if (target && target.objectFlags & ts.ObjectFlags.Tuple) {
    const elements = checker.getTypeArguments(ref);
    return elements[argumentIndex - declarationIndex] ?? type;
  }
  return checker.getIndexTypeOfType(type, ts.IndexKind.Number) ?? type;
}

function syntheticCallbackTypeFromArg(
  checker: ts.TypeChecker,
  arg: ts.Expression,
  hint: Extract<JsCallArgHint, { kind: "function" }>,
): TypeExpr {
  if (!ts.isArrowFunction(arg)) {
    return fn([name("Js.Value")], hint.resultType ?? name("Js.Value"));
  }
  return fn(
    arg.parameters.map((param, index) =>
      hint.paramTypes?.[index] ??
        typeExprFromTsType(checker, checker.getTypeAtLocation(param), "param") ??
        name("Js.Value")
    ),
    hint.resultType ??
      typeExprFromTsType(checker, checker.getTypeAtLocation(arg.body), "result") ??
      name("Js.Value"),
  );
}

function stripSuppliedOptionalParam(
  type: TypeExpr,
  declaration: ts.SignatureDeclaration | undefined,
  index: number,
): TypeExpr {
  const param = declaration?.parameters[index];
  const optional = !!param?.questionToken || !!param?.initializer;
  if (!optional || type.kind !== "TName" || type.name !== "Option" || type.args.length !== 1) {
    return type;
  }
  return type.args[0];
}

export function functionArgExpr(
  index: number,
  hint: Extract<JsCallArgHint, { kind: "function" }>,
): string {
  const params = Array.from(
    { length: hint.arity },
    (_, paramIndex) =>
      `__wm_cb_${index}_${paramIndex}${
        hint.paramTypes?.[paramIndex] ? `: ${tsTypeFromTypeExpr(hint.paramTypes[paramIndex])}` : ""
      }`,
  );
  return `(${params.join(", ")}) => __wm_cb_return_${index}`;
}
