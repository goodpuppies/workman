import type { Expr, TypeExpr } from "../../ast.ts";
import type { InferResult } from "../../infer.ts";
import { hostFfiDescendsInto } from "../../region_traversal.ts";
import { prune, type Ty } from "../../types.ts";
import type { FfiElaboration } from "../shared.ts";
import { fn, memberVariants, name, nameArgs, tvar } from "../shared.ts";
import { option } from "../type_expr.ts";
import {
  type JsMemberType,
  jsPrimitiveValueRef,
  jsRefTypeExpr,
  type JsTypeRef,
} from "../reflect/types.ts";

export type ReceiverModel = {
  element: TypeExpr;
  type: TypeExpr;
};

export function isJsObjectTy(type: Ty): boolean {
  const target = prune(type);
  return target.tag === "named" && target.name === "Js.Object";
}

export function jsArrayReceiver(type: Ty | undefined): ReceiverModel | undefined {
  if (!type) return undefined;
  const target = prune(type);
  if (target.tag !== "named" || target.name !== "Js.Array" || target.args.length !== 1) {
    return undefined;
  }
  const element = tyToTypeExpr(target.args[0]);
  return { element, type: nameArgs("Js.Array", [element]) };
}

export function jsArrayMember(
  array: ReceiverModel,
  path: string[],
): JsMemberType | undefined {
  if (path.length !== 1) return undefined;
  const member = path[0];
  if (member === "length") return { name: member, type: name("Number") };
  if (member === "join") {
    return {
      name: member,
      type: fn([name("String")], name("String")),
      variants: [
        { type: fn([], name("String")) },
        { type: fn([name("String")], name("String")) },
      ],
    };
  }
  if (member === "at") {
    return {
      name: member,
      type: fn([name("Number")], option(array.element)),
    };
  }
  if (member === "map") {
    const mapped = tvar("mapped");
    return {
      name: member,
      type: fn(
        [fn([array.element, name("Number"), array.type], mapped)],
        nameArgs("Js.Array", [mapped]),
      ),
    };
  }
  return undefined;
}

export function jsPromiseReceiver(type: Ty | undefined): ReceiverModel | undefined {
  if (!type) return undefined;
  const target = prune(type);
  if (target.tag !== "named" || target.name !== "Js.Promise" || target.args.length !== 1) {
    return undefined;
  }
  const element = tyToTypeExpr(target.args[0]);
  return { element, type: nameArgs("Js.Promise", [element]) };
}

export function jsPromiseReceiverTypeExpr(
  type: TypeExpr | undefined,
): ReceiverModel | undefined {
  if (type?.kind !== "TName" || type.name !== "Js.Promise" || type.args.length !== 1) {
    return undefined;
  }
  return { element: type.args[0], type };
}

export function jsPromiseMember(
  promise: ReceiverModel,
  path: string[],
  callbackResultType?: Ty,
  callResultElement?: TypeExpr,
): JsMemberType | undefined {
  if (path.length !== 1) return undefined;
  const member = path[0];
  if (member === "then") {
    const mapped = tvar("mapped");
    const callback = callbackResultType
      ? promiseCallbackType(promise.element, callbackResultType)
      : undefined;
    if (callback) {
      return {
        name: member,
        type: fn(
          [callback.type],
          nameArgs("Js.Promise", [dynamicPromiseElement(callResultElement ?? callback.element)]),
        ),
      };
    }
    return {
      name: member,
      type: fn(
        [fn([promise.element], mapped)],
        nameArgs("Js.Promise", [
          dynamicPromiseElement(callResultElement ?? mapped),
        ]),
      ),
    };
  }
  if (member === "catch") {
    const handlerResult = callbackResultType ? tyToTypeExpr(callbackResultType) : undefined;
    const handled = handlerResult && !containsTypeVariable(handlerResult)
      ? handlerResult
      : promise.element;
    return {
      name: member,
      type: fn([fn([name("Js.Value")], handled)], promise.type),
    };
  }
  return undefined;
}

function containsTypeVariable(type: TypeExpr): boolean {
  switch (type.kind) {
    case "TVar":
      return true;
    case "TName":
      return type.args.some(containsTypeVariable);
    case "TTuple":
      return type.items.some(containsTypeVariable);
    case "TFn":
      return type.params.some(containsTypeVariable) || containsTypeVariable(type.result);
  }
}

function promiseCallbackType(
  element: TypeExpr,
  callbackResultType: Ty,
): { type: TypeExpr; element: TypeExpr } | undefined {
  const result = tyToTypeExpr(callbackResultType);
  return {
    type: fn([element], result),
    element: promiseElementTypeExpr(result) ?? result,
  };
}

export function promiseCallbackResultType(
  arg: Expr | undefined,
  result: InferResult,
): Ty | undefined {
  if (!arg) return undefined;
  if (arg.kind === "Lambda") {
    return hostFfiDescendsInto(arg) ? inferredType(result, arg.body) : undefined;
  }
  const type = inferredType(result, arg);
  const target = type ? prune(type) : undefined;
  return target?.tag === "fn" && target.params.length === 1 ? target.result : undefined;
}

export function inferredType(result: InferResult, expr: Expr): Ty | undefined {
  const direct = result.types.get(expr);
  if (direct) return direct;
  if (expr.kind === "Var") return result.env.get(expr.name)?.type;
  const id = expr.node?.id;
  if (id === undefined) return undefined;
  for (const [candidate, type] of result.types) {
    if (candidate.node?.id === id) return type;
  }
  return undefined;
}

export function withCallbackParamRefs(
  member: JsMemberType | undefined,
  refsFrom: JsMemberType | undefined,
): JsMemberType | undefined {
  if (!member || !refsFrom?.variants?.length) return member;
  return {
    ...member,
    variants: memberVariants(member).map((variant, index) => ({
      ...variant,
      callbackParamRefs: refsFrom.variants?.[index]?.callbackParamRefs ??
        refsFrom.variants?.[0]?.callbackParamRefs,
    })),
  };
}

export function ffiCallPromiseElement(type: Ty | undefined): TypeExpr | undefined {
  const target = type ? prune(type) : undefined;
  if (target?.tag !== "named" || target.name !== "Result" || target.args.length !== 2) {
    return undefined;
  }
  const value = prune(target.args[0]);
  return value.tag === "named" && value.name === "Js.Promise" && value.args.length === 1
    ? tyToTypeExpr(value.args[0])
    : undefined;
}

function promiseElementTypeExpr(type: TypeExpr): TypeExpr | undefined {
  return type.kind === "TName" && type.name === "Js.Promise" && type.args.length === 1
    ? type.args[0]
    : undefined;
}

function dynamicPromiseElement(type: TypeExpr): TypeExpr {
  return type.kind === "TVar" ? name("Js.Value") : type;
}

export function tyToTypeExpr(type: Ty): TypeExpr {
  const target = prune(type);
  switch (target.tag) {
    case "prim":
      return name(target.name);
    case "var":
      return tvar(target.name ?? `t${target.id}`);
    case "ffi":
      return name("Js.Value");
    case "struct":
      return name("Js.Value");
    case "named":
      return nameArgs(target.name, target.args.map(tyToTypeExpr));
    case "tuple":
      return { kind: "TTuple", items: target.items.map(tyToTypeExpr) };
    case "fn":
      return {
        kind: "TFn",
        params: target.params.map(tyToTypeExpr),
        result: tyToTypeExpr(target.result),
      };
  }
}

export function knownTyToTypeExpr(type: Ty): TypeExpr | undefined {
  const target = prune(type);
  switch (target.tag) {
    case "ffi":
    case "struct":
      return undefined;
    case "prim":
      return name(target.name);
    case "var":
      return tvar(target.name ?? `t${target.id}`);
    case "named": {
      const args = target.args.map(knownTyToTypeExpr);
      return args.every((arg): arg is TypeExpr => !!arg) ? nameArgs(target.name, args) : undefined;
    }
    case "tuple": {
      const items = target.items.map(knownTyToTypeExpr);
      return items.every((item): item is TypeExpr => !!item)
        ? { kind: "TTuple", items }
        : undefined;
    }
    case "fn": {
      const params = target.params.map(knownTyToTypeExpr);
      const result = knownTyToTypeExpr(target.result);
      return params.every((param): param is TypeExpr => !!param) && result
        ? { kind: "TFn", params, result }
        : undefined;
    }
  }
}

export function typeExprKey(type: TypeExpr): string {
  switch (type.kind) {
    case "TName":
      return type.args.length ? `${type.name}<${type.args.map(typeExprKey).join(",")}>` : type.name;
    case "TVar":
      return `'${type.name}`;
    case "TTuple":
      return `(${type.items.map(typeExprKey).join(",")})`;
    case "TFn":
      return `(${type.params.map(typeExprKey).join(",")})->${typeExprKey(type.result)}`;
  }
}

export function expressionRefForReceiver(
  original: Expr,
  resolved: Expr,
  ffi: FfiElaboration,
  valueRefs: Map<string, JsTypeRef>,
): JsTypeRef | undefined {
  if (original.kind === "Var") {
    const ref = valueRefs.get(original.name);
    if (ref) return ref;
  }
  if (resolved.kind === "Var") {
    const ref = valueRefs.get(resolved.name);
    if (ref) return ref;
  }
  return undefined;
}

export function receiverTypeForRef(ref: JsTypeRef): TypeExpr {
  const type = jsRefTypeExpr(ref);
  if (type?.kind === "TName" && type.name === "Js.Value" && type.args.length === 0) {
    return name("Js.Object");
  }
  return type ?? name("Js.Object");
}

export function foreignTypeRefLookup(
  localRefs: Map<string, JsTypeRef>,
  globalRefs: Map<string, JsTypeRef> | undefined,
): Map<string, JsTypeRef> {
  return new Map([
    ...[...localRefs].flatMap(([name, ref]) => [[name, ref], [ref.key, ref]] as const),
    ...(globalRefs ?? new Map()),
  ]);
}

export function foreignReceiver(
  type: Ty,
  foreignTypeRefs: Map<string, JsTypeRef>,
): { ref: JsTypeRef; type: TypeExpr } | undefined {
  const target = prune(type);
  if (
    target.tag === "prim" &&
    (target.name === "String" || target.name === "Number" || target.name === "Bool")
  ) {
    return {
      ref: jsPrimitiveValueRef(target.name),
      type: { kind: "TName", name: target.name, args: [] },
    };
  }
  if (target.tag !== "named" || !(target.foreign || foreignTypeRefs.has(target.name))) {
    return undefined;
  }
  const ref = (target.foreignKey ? foreignTypeRefs.get(target.foreignKey) : undefined) ??
    foreignTypeRefs.get(target.name);
  if (!ref) return undefined;
  return { ref, type: { kind: "TName", name: target.name, args: [] } };
}
