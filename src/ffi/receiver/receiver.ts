import type { Decl, Expr, Param, TypeExpr } from "../../ast.ts";
import {
  type JsCallArgHint,
  type JsMemberType,
  jsPrimitiveValueRef,
  jsRefCall,
  jsRefMember,
  jsRefTypeExpr,
  type JsTypeRef,
} from "../reflect/types.ts";
import {
  addVariants,
  callArgHint,
  callHintKey,
  dynamicReceiverArgType,
  type FfiBinding,
  type FfiVariant,
  fn,
  memberVariants,
  name as typeName,
  paramBinder,
  selectVariant,
} from "../shared.ts";

export type ObjectAccess =
  | { kind: "ref"; ref: JsTypeRef; receiverType?: TypeExpr }
  | { kind: "dynamic" }
  | { kind: "unresolved" };

export type ReflectedReceiverCall = {
  callee: Expr;
  args: Expr[];
  variant: FfiVariant;
};

export function reflectedReceiverCallCandidate(
  name: string,
  args: Expr[],
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  refs: Map<string, JsTypeRef>,
  jsRefCallMember: (
    ref: JsTypeRef,
    path: string[],
    args: JsCallArgHint[],
  ) => JsMemberType | undefined,
  receiverType?: TypeExpr,
): ReflectedReceiverCall | undefined {
  const parts = name.split(".");
  if (parts.length < 2) return undefined;
  const baseName = parts[0];
  const ref = refs.get(baseName);
  if (!ref) return undefined;
  if (isJsPromiseRef(ref)) return undefined;
  const path = parts.slice(1);
  const callMember = jsRefCallMember(ref, path, args.map(callArgHint));
  const member = callMember ?? jsRefMember(ref, path);
  if (!member) return undefined;
  const suffix = callMember ? `(${callHintKey(args)})` : "";
  const surfaceName = `__receiver.${ref.key}.${path.join(".")}${suffix}`;
  const reflectedReceiverType = receiverType ?? knownReceiverType(jsRefTypeExpr(ref)) ??
    typeName("Js.Object");
  addVariants(
    bindings,
    surfaceName,
    path.at(-1)!,
    { kind: "JsReceiver", path },
    memberVariants(member).map((variant) => ({
      type: variant.type,
      receiverType: reflectedReceiverType,
      resultRef: variant.resultRef,
      callbackParamRefs: variant.callbackParamRefs,
    })),
    true,
    undefined,
  );
  const receiver = { kind: "Var" as const, name: baseName };
  const variant = selectVariant(bindings.get(surfaceName)?.variants ?? [], args);
  if (!variant) return undefined;
  selected.add(variant.internalName);
  return {
    callee: { kind: "Var", name: variant.internalName },
    args: [receiver, ...args],
    variant,
  };
}

export function reflectedReceiverProperty(
  name: string,
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  refs: Map<string, JsTypeRef>,
  receiverType?: TypeExpr,
): Expr | undefined {
  const parts = name.split(".");
  if (parts.length < 2) return undefined;
  const baseName = parts[0];
  const ref = refs.get(baseName);
  if (!ref) return undefined;
  if (isJsPromiseRef(ref)) return undefined;
  const path = parts.slice(1);
  const member = jsRefMember(ref, path);
  if (!member) return undefined;
  const surfaceName = `__receiver.${ref.key}.${path.join(".")}`;
  const reflectedReceiverType = receiverType ?? knownReceiverType(jsRefTypeExpr(ref)) ??
    typeName("Js.Object");
  addVariants(
    bindings,
    surfaceName,
    path.at(-1)!,
    { kind: "JsReceiver", path },
    memberVariants(member).map((variant) => ({
      type: variant.type,
      receiverType: reflectedReceiverType,
      resultRef: variant.resultRef,
      callbackParamRefs: variant.callbackParamRefs,
    })),
    true,
    undefined,
  );
  const variant = selectVariant(bindings.get(surfaceName)?.variants ?? [], []);
  if (!variant) return undefined;
  selected.add(variant.internalName);
  return {
    kind: "Call",
    callee: { kind: "Var", name: variant.internalName },
    args: [{ kind: "Var", name: baseName }],
  };
}

export function reflectedReceiverFunctionValue(
  name: string,
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  refs: Map<string, JsTypeRef>,
  receiverType?: TypeExpr,
): Expr | undefined {
  const parts = name.split(".");
  if (parts.length < 2) return undefined;
  const baseName = parts[0];
  const ref = refs.get(baseName);
  if (!ref) return undefined;
  if (isJsPromiseRef(ref)) return undefined;
  const path = parts.slice(1);
  const member = jsRefMember(ref, path);
  if (!member) return undefined;
  const variants = memberVariants(member);
  if (variants.length !== 1 || variants[0].type.kind !== "TFn") return undefined;
  const params = variants[0].type.params.map((_, index) => `__wm_js_arg_${index}`);
  const surfaceName = `__receiver.${ref.key}.${path.join(".")}`;
  const reflectedReceiverType = receiverType ?? knownReceiverType(jsRefTypeExpr(ref)) ??
    typeName("Js.Object");
  addVariants(
    bindings,
    surfaceName,
    path.at(-1)!,
    { kind: "JsReceiver", path },
    [{
      type: variants[0].type,
      receiverType: reflectedReceiverType,
      resultRef: variants[0].resultRef,
      callbackParamRefs: variants[0].callbackParamRefs,
    }],
    true,
    undefined,
  );
  const variant = selectVariant(
    bindings.get(surfaceName)?.variants ?? [],
    params.map((param) => ({ kind: "Var" as const, name: param })),
  );
  if (!variant) return undefined;
  selected.add(variant.internalName);
  return {
    kind: "Lambda",
    params: params.map((param) => ({
      pattern: { kind: "PVar", name: param },
    })),
    body: {
      kind: "Call",
      callee: { kind: "Var", name: variant.internalName },
      args: [
        { kind: "Var", name: baseName },
        ...params.map((param) => ({ kind: "Var" as const, name: param })),
      ],
    },
  };
}

export function objectReceiverProperty(
  exprName: string,
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  objectAccess: Map<string, ObjectAccess>,
  recordFields: Set<string> = new Set(),
): Expr | undefined {
  const parts = exprName.split(".");
  if (parts.length < 2) return undefined;
  const baseName = parts[0];
  const access = objectAccess.get(baseName);
  if (!access) return undefined;
  const path = parts.slice(1);
  if (access.kind === "ref") {
    return reflectedReceiverProperty(
      exprName,
      bindings,
      selected,
      new Map([[baseName, access.ref]]),
      access.receiverType,
    );
  }
  if (access.kind === "unresolved") {
    if (recordFields.has(path[0])) return undefined;
    return {
      kind: "FfiGet",
      receiver: { kind: "Var", name: baseName },
      path,
    };
  }
  const surfaceName = `__dynamic.${path.join(".")}`;
  addVariants(
    bindings,
    surfaceName,
    path.at(-1)!,
    { kind: "JsReceiver", path },
    [{ type: typeName("Js.Value"), receiverType: typeName("Js.Object") }],
    true,
    undefined,
  );
  const variant = selectVariant(bindings.get(surfaceName)?.variants ?? [], []);
  if (!variant) return undefined;
  selected.add(variant.internalName);
  return {
    kind: "Call",
    callee: { kind: "Var", name: variant.internalName },
    args: [{ kind: "Var", name: baseName }],
  };
}

export function objectReceiverCall(
  exprName: string,
  args: Expr[],
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  objectAccess: Map<string, ObjectAccess>,
  jsRefCallMember: (
    ref: JsTypeRef,
    path: string[],
    args: JsCallArgHint[],
  ) => JsMemberType | undefined,
): Expr | ReflectedReceiverCall | undefined {
  const parts = exprName.split(".");
  if (parts.length < 2) return undefined;
  const baseName = parts[0];
  const access = objectAccess.get(baseName);
  if (access?.kind === "ref") {
    const reflected = reflectedReceiverCallCandidate(
      exprName,
      args,
      bindings,
      selected,
      new Map([[baseName, access.ref]]),
      jsRefCallMember,
      access.receiverType,
    );
    if (reflected) return reflected;
    if (isJsPromiseRef(access.ref)) {
      return {
        kind: "FfiCall",
        receiver: { kind: "Var", name: baseName },
        path: parts.slice(1),
        args,
      };
    }
    return undefined;
  }
  if (access?.kind === "dynamic") {
    const path = parts.slice(1);
    return {
      kind: "FfiCall",
      receiver: { kind: "Var", name: baseName },
      path,
      args,
    };
  }
  if (access?.kind !== "unresolved") return undefined;
  return {
    kind: "FfiCall",
    receiver: { kind: "Var", name: baseName },
    path: parts.slice(1),
    args,
  };
}

export function reflectedFunctionCallCandidate(
  name: string,
  args: Expr[],
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  refs: Map<string, JsTypeRef>,
  objectAccess: Map<string, ObjectAccess>,
): ReflectedReceiverCall | undefined {
  const ref = refs.get(name);
  if (!ref) return undefined;
  const hints = args.map((arg) => callArgHintWithRefs(arg, refs, objectAccess));
  if (!hints.some((hint) => hint.kind === "ref" || hint.kind === "function")) return undefined;
  const member = jsRefCall(ref, hints);
  if (!member) return undefined;
  const original = bindings.get(name)?.variants[0];
  const surfaceName = `__call.${ref.key}(${callHintKey(args)})`;
  addVariants(
    bindings,
    surfaceName,
    original?.memberName ?? "call",
    original?.target ?? { kind: "JsReceiver", path: [] },
    memberVariants(member),
    original?.fallible ?? true,
    undefined,
  );
  const variant = selectVariant(bindings.get(surfaceName)?.variants ?? [], args);
  if (!variant) return undefined;
  selected.add(variant.internalName);
  return {
    callee: { kind: "Var", name: variant.internalName },
    args,
    variant,
  };
}

export function callArgHintWithRefs(
  arg: Expr,
  refs: Map<string, JsTypeRef>,
  objectAccess: Map<string, ObjectAccess>,
): JsCallArgHint {
  if (arg.kind === "Var") {
    const direct = refs.get(arg.name);
    if (direct) return { kind: "ref", ref: direct, type: jsRefTypeExpr(direct) };
    const access = objectAccess.get(arg.name);
    if (access?.kind === "ref") {
      return { kind: "ref", ref: access.ref, type: access.receiverType };
    }
  }
  return callArgHint(arg);
}

export function rememberObjectParams(
  params: Param[],
  objectAccess: Map<string, ObjectAccess>,
  importedTypeRefs: Map<string, JsTypeRef>,
) {
  for (const param of params) {
    const binder = paramBinder(param);
    if (!binder) continue;
    const access = objectAccessForType(param.annotation, importedTypeRefs);
    if (access) objectAccess.set(binder, access);
  }
}

export function rememberUnannotatedParams(
  params: Param[],
  objectAccess: Map<string, ObjectAccess>,
) {
  for (const param of params) {
    if (param.annotation) continue;
    const binder = paramBinder(param);
    if (binder && !objectAccess.has(binder)) objectAccess.set(binder, { kind: "unresolved" });
  }
}

function objectAccessForType(
  type: TypeExpr | undefined,
  importedTypeRefs: Map<string, JsTypeRef>,
): ObjectAccess | undefined {
  if (isJsObjectType(type)) return { kind: "dynamic" };
  if (type?.kind !== "TName" || type.args.length !== 0) return undefined;
  if (type.name === "String" || type.name === "Number" || type.name === "Bool") {
    return { kind: "ref", ref: jsPrimitiveValueRef(type.name), receiverType: type };
  }
  const ref = importedTypeRefs.get(type.name);
  return ref ? { kind: "ref", ref, receiverType: type } : undefined;
}

function isJsObjectType(type: TypeExpr | undefined): boolean {
  return type?.kind === "TName" && type.name === "Js.Object" && type.args.length === 0;
}

function knownReceiverType(type: TypeExpr | undefined): TypeExpr | undefined {
  if (
    type?.kind === "TName" && type.args.length === 0 &&
    (type.name === "String" || type.name === "Number" || type.name === "Bool")
  ) {
    return type;
  }
  if (
    type?.kind === "TName" &&
    (type.name === "Js.Array" || type.name === "Js.Promise")
  ) {
    return type;
  }
  return undefined;
}

function isJsPromiseRef(ref: JsTypeRef): boolean {
  const type = jsRefTypeExpr(ref);
  return type?.kind === "TName" && type.name === "Js.Promise" ||
    /\bPromise(?:Like)?\b/.test(ref.expr);
}

export function rememberLetObjectAccess(
  decl: Decl,
  bindings: Map<string, FfiBinding>,
  objectAccess: Map<string, ObjectAccess>,
  importedTypeRefs: Map<string, JsTypeRef>,
) {
  if (decl.kind !== "LetDecl") return;
  for (const binding of decl.bindings) {
    if (binding.pattern.kind !== "PVar") continue;
    const access = objectAccessForType(binding.annotation, importedTypeRefs) ??
      objectAccessForExpr(binding.value, bindings, importedTypeRefs);
    if (access) objectAccess.set(binding.pattern.name, access);
  }
}

function objectAccessForExpr(
  expr: Expr,
  bindings: Map<string, FfiBinding>,
  importedTypeRefs: Map<string, JsTypeRef>,
): ObjectAccess | undefined {
  if (expr.kind !== "Call" || expr.callee.kind !== "Var") return undefined;
  const calleeName = expr.callee.name;
  const variant = [...bindings.values()]
    .flatMap((binding) => binding.variants)
    .find((item) => item.internalName === calleeName);
  const result = variant ? callResultType(variant.type) : undefined;
  return objectAccessForType(unwrapResult(result), importedTypeRefs);
}

function callResultType(type: TypeExpr): TypeExpr | undefined {
  return type.kind === "TFn" ? type.result : type;
}

function unwrapResult(type: TypeExpr | undefined): TypeExpr | undefined {
  if (
    type?.kind === "TName" &&
    (type.name === "Result" || type.name === "Task") &&
    type.args.length === 2
  ) {
    return type.args[0];
  }
  return type;
}
