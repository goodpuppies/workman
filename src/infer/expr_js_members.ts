import {
  BoolTy,
  fn,
  fresh,
  named,
  NumberTy,
  prune,
  StringTy,
  tuple,
  type Ty,
  type TypeEnv,
} from "../types.ts";
import { constrainAt } from "./provenance.ts";

export function ffiCallbackParamHints(
  typeEnv: TypeEnv,
  receiver: Ty,
  path: string[],
  argIndex: number,
  args: Ty[],
): Ty[] | undefined {
  if (path.length !== 1 || argIndex !== 0) return undefined;
  const member = path[0];
  const promiseElement = jsPromiseElement(typeEnv, receiver);
  if (promiseElement) {
    if (member === "then") return [promiseElement];
    if (member === "catch") return [jsValueTy(typeEnv)];
    return undefined;
  }
  if (member !== "map" && member !== "filter" && member !== "reduce") return undefined;
  const element = jsArrayElement(typeEnv, receiver) ??
    inferArrayElementFromMember(typeEnv, receiver, member);
  if (!element) return undefined;
  const arrayTy = jsArrayTy(typeEnv, element);
  if (member === "reduce") {
    const accumulator = args[1];
    if (!accumulator) return undefined;
    return [accumulator, element, NumberTy, arrayTy];
  }
  return [element, NumberTy, arrayTy];
}

function jsValueTy(typeEnv: TypeEnv): Ty {
  const info = typeEnv.get("Js.Value");
  if (!info) throw new Error("unknown type Js.Value");
  return named(info);
}

export function jsArrayFfiGetValue(typeEnv: TypeEnv, receiver: Ty, path: string[]): Ty | undefined {
  const array = jsArrayElement(typeEnv, receiver);
  if (!array || path.length !== 1) return undefined;
  if (path[0] === "length") return NumberTy;
  return undefined;
}

export function jsArrayFfiCallValue(
  typeEnv: TypeEnv,
  receiver: Ty,
  path: string[],
  args: Ty[],
): Ty | undefined {
  if (path.length !== 1) return undefined;
  const member = path[0];
  const element = jsArrayElement(typeEnv, receiver) ??
    inferArrayElementFromMember(typeEnv, receiver, member);
  if (!element) return undefined;
  if (member === "join") return StringTy;
  if (member === "at") {
    if (args.length !== 1) return undefined;
    constrainMember(args[0], NumberTy, "JsArray.at index", "argument matches array index type");
    return optionTy(typeEnv, element);
  }
  if (member === "includes") {
    if (args.length !== 1) return undefined;
    constrainMember(args[0], element, "JsArray.includes value", "argument matches array element");
    return BoolTy;
  }
  if (member === "filter") {
    if (args.length !== 1) return undefined;
    constrainMember(
      args[0],
      fn([tuple([element, NumberTy, jsArrayTy(typeEnv, element)])], BoolTy),
      "JsArray.filter callback",
      "callback matches filter signature",
    );
    return jsArrayTy(typeEnv, element);
  }
  if (member === "reduce") {
    if (args.length !== 2) return undefined;
    const accumulator = args[1];
    constrainMember(
      args[0],
      fn([tuple([accumulator, element, NumberTy, jsArrayTy(typeEnv, element)])], accumulator),
      "JsArray.reduce callback",
      "callback matches reduce signature",
    );
    return accumulator;
  }
  if (member !== "map" || args.length !== 1) return undefined;
  const mapped = fresh("mapped");
  constrainMember(
    args[0],
    fn([tuple([element, NumberTy, jsArrayTy(typeEnv, element)])], mapped),
    "JsArray.map callback",
    "callback matches map signature",
  );
  return jsArrayTy(typeEnv, mapped);
}

function inferArrayElementFromMember(
  typeEnv: TypeEnv,
  receiver: Ty,
  member: string,
): Ty | undefined {
  if (
    member !== "at" && member !== "join" && member !== "map" && member !== "reduce" &&
    member !== "filter" && member !== "includes"
  ) {
    return undefined;
  }
  const target = prune(receiver);
  if (target.tag !== "var") return undefined;
  const element = fresh("element");
  constrainMember(
    receiver,
    jsArrayTy(typeEnv, element),
    `JsArray.${member} receiver`,
    "receiver matches array member",
  );
  return element;
}

function jsArrayElement(typeEnv: TypeEnv, receiver: Ty): Ty | undefined {
  const target = prune(receiver);
  if (target.tag !== "named" || target.id !== typeEnv.get("Js.Array")?.id) return undefined;
  return target.args[0];
}

export function jsPrimitiveFfiGetValue(receiver: Ty, path: string[]): Ty | undefined {
  const target = prune(receiver);
  if (path.length !== 1 || target.tag !== "prim") return undefined;
  if (target.name === "String" && path[0] === "length") return NumberTy;
  return undefined;
}

export function jsPrimitiveFfiCallValue(receiver: Ty, path: string[], args: Ty[]): Ty | undefined {
  if (path.length !== 1) return undefined;
  const member = path[0];
  const target = prune(receiver);
  const primitive = target.tag === "prim"
    ? target.name
    : inferPrimitiveReceiverFromMember(receiver, member);
  if (!primitive) return undefined;
  if (primitive === "Number" && member === "toString") {
    if (args.length > 1) return undefined;
    if (args[0]) {
      constrainMember(args[0], NumberTy, "Number.toString radix", "argument matches numeric radix");
    }
    return StringTy;
  }
  if (primitive === "Number" && member === "toFixed") {
    if (args.length > 1) return undefined;
    if (args[0]) {
      constrainMember(
        args[0],
        NumberTy,
        "Number.toFixed digits",
        "argument matches numeric digits",
      );
    }
    return StringTy;
  }
  if (primitive === "String" && member === "slice") {
    if (args.length < 1 || args.length > 2) return undefined;
    constrainMember(args[0], NumberTy, "String.slice start", "argument matches numeric start");
    if (args[1]) {
      constrainMember(args[1], NumberTy, "String.slice end", "argument matches numeric end");
    }
    return StringTy;
  }
  if (primitive === "String" && (member === "padStart" || member === "padEnd")) {
    if (args.length !== 2) return undefined;
    constrainMember(
      args[0],
      NumberTy,
      `String.${member} length`,
      "argument matches numeric length",
    );
    constrainMember(args[1], StringTy, `String.${member} fill`, "argument matches string fill");
    return StringTy;
  }
  if (primitive === "String" && member === "repeat") {
    if (args.length !== 1) return undefined;
    constrainMember(args[0], NumberTy, "String.repeat count", "argument matches numeric count");
    return StringTy;
  }
  if (primitive === "String" && (member === "startsWith" || member === "endsWith")) {
    if (args.length !== 1) return undefined;
    constrainMember(args[0], StringTy, `String.${member} search`, "argument matches string search");
    return BoolTy;
  }
  if (primitive === "String" && member === "toLowerCase") {
    if (args.length !== 0) return undefined;
    return StringTy;
  }
  return undefined;
}

function inferPrimitiveReceiverFromMember(receiver: Ty, member: string): string | undefined {
  const target = prune(receiver);
  if (target.tag !== "var") return undefined;
  if (member === "toString" || member === "toFixed") {
    constrainMember(
      receiver,
      NumberTy,
      `Number.${member} receiver`,
      "receiver matches number member",
    );
    return "Number";
  }
  if (
    member === "slice" || member === "padStart" || member === "padEnd" || member === "repeat" ||
    member === "startsWith" || member === "endsWith" || member === "toLowerCase"
  ) {
    constrainMember(
      receiver,
      StringTy,
      `String.${member} receiver`,
      "receiver matches string member",
    );
    return "String";
  }
  return undefined;
}

function jsArrayTy(typeEnv: TypeEnv, element: Ty): Ty {
  const info = typeEnv.get("Js.Array");
  if (!info) throw new Error("unknown type Js.Array");
  return named(info, [element]);
}

function optionTy(typeEnv: TypeEnv, element: Ty): Ty {
  const info = typeEnv.get("Option");
  if (!info) throw new Error("unknown type Option");
  return named(info, [element]);
}

export function jsPromiseFfiCallValue(
  typeEnv: TypeEnv,
  receiver: Ty,
  path: string[],
  args: Ty[],
): Ty | undefined {
  const element = jsPromiseElement(typeEnv, receiver);
  if (!element || path.length !== 1 || args.length !== 1) return undefined;
  const member = path[0];
  if (member === "then") {
    const mapped = fresh("mapped");
    const expected = fn([element], mapped);
    constrainMember(
      jsPromiseCallbackActual(typeEnv, expected, args[0]),
      expected,
      "JsPromise.then callback",
      "callback matches promise continuation",
    );
    return jsPromiseTy(typeEnv, jsPromiseElement(typeEnv, mapped) ?? mapped);
  }
  if (member === "catch") {
    return jsPromiseTy(typeEnv, element);
  }
  return undefined;
}

function constrainMember(left: Ty, right: Ty, subject: string, role: string) {
  constrainAt(left, right, undefined, undefined, [], undefined, {
    message: subject,
  }, {
    premise: {
      rule: "InferJsMember.Constraint",
      role,
      subject,
      leftRole: "actual",
      rightRole: "expected",
    },
  });
}

function jsPromiseElement(typeEnv: TypeEnv, receiver: Ty): Ty | undefined {
  const target = prune(receiver);
  if (target.tag !== "named" || target.id !== typeEnv.get("Js.Promise")?.id) return undefined;
  return target.args[0];
}

function jsPromiseTy(typeEnv: TypeEnv, element: Ty): Ty {
  const info = typeEnv.get("Js.Promise");
  if (!info) throw new Error("unknown type Js.Promise");
  return named(info, [element]);
}

function jsPromiseCallbackActual(typeEnv: TypeEnv, expected: Ty, actual: Ty): Ty {
  const expectedFn = prune(expected);
  const actualFn = prune(actual);
  if (
    expectedFn.tag !== "fn" || actualFn.tag !== "fn" ||
    expectedFn.params.length !== 1 || actualFn.params.length !== 1
  ) {
    return actual;
  }
  if (
    !isJsObjectLikeTy(typeEnv, expectedFn.params[0]) || !isJsValueTy(typeEnv, actualFn.params[0])
  ) {
    return actual;
  }
  return fn([expectedFn.params[0]], actualFn.result);
}

function isJsValueTy(typeEnv: TypeEnv, type: Ty): boolean {
  const target = prune(type);
  return target.tag === "named" && target.id === typeEnv.get("Js.Value")?.id;
}

function isJsObjectLikeTy(typeEnv: TypeEnv, type: Ty): boolean {
  const target = prune(type);
  if (target.tag !== "named") return false;
  return target.id === typeEnv.get("Js.Object")?.id ||
    target.id === typeEnv.get("Js.Array")?.id ||
    target.id === typeEnv.get("Js.Promise")?.id ||
    Boolean(target.foreign || typeEnv.get(target.name)?.foreign);
}
