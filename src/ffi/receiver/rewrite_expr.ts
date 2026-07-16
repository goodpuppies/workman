import type { Expr } from "../../ast.ts";
import { hostFfiDescendsInto } from "../../region_traversal.ts";
import { jsRefCallMember, type JsTypeRef } from "../reflect/types.ts";
import {
  type ObjectAccess,
  objectReceiverCall,
  objectReceiverProperty,
  reflectedFunctionCallCandidate,
  reflectedReceiverCallCandidate,
  reflectedReceiverFunctionValue,
  reflectedReceiverProperty,
  rememberObjectParams,
  rememberUnannotatedParams,
} from "./receiver.ts";
import { rewriteBlock, rewriteMatchArms } from "./rewrite_blocks.ts";
import { rewriteDeclCalls } from "./rewrite_decl.ts";
import { type FfiBinding, type FfiVariant, refsForCallbackArg } from "../shared.ts";

let activeRecordFields = new Set<string>();

export function setActiveRecordFields(fields: Set<string>): Set<string> {
  const previous = activeRecordFields;
  activeRecordFields = fields;
  return previous;
}

// Set by the delayed FFI pass so reflected member rewrites can solve the FFI placeholder
// recorded for the original expression, the same way materialization does.
type FfiSolveHook = (original: Expr, internalName: string) => void;
let activeFfiSolve: FfiSolveHook | undefined;

export function setActiveFfiSolve(hook: FfiSolveHook | undefined): FfiSolveHook | undefined {
  const previous = activeFfiSolve;
  activeFfiSolve = hook;
  return previous;
}

function solveRewrittenFfi(original: Expr, callee: Expr) {
  if (callee.kind === "Var") activeFfiSolve?.(original, callee.name);
}

export function rewriteExprCalls(
  expr: Expr,
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  refs: Map<string, JsTypeRef>,
  objectAccess: Map<string, ObjectAccess>,
  importedTypeRefs: Map<string, JsTypeRef>,
): Expr {
  const rewrite = (child: Expr) =>
    rewriteExprCalls(child, bindings, selected, refs, objectAccess, importedTypeRefs);
  switch (expr.kind) {
    case "FfiGet": {
      if (expr.receiver.kind === "Var") {
        const reflected = reflectedReceiverProperty(
          `${expr.receiver.name}.${expr.path.join(".")}`,
          bindings,
          selected,
          refs,
        );
        if (reflected) {
          if (reflected.kind === "Call") solveRewrittenFfi(expr, reflected.callee);
          return reflected;
        }
        const objectProperty = objectReceiverProperty(
          `${expr.receiver.name}.${expr.path.join(".")}`,
          bindings,
          selected,
          objectAccess,
          activeRecordFields,
        );
        if (objectProperty) {
          return objectProperty.kind === "FfiGet"
            ? {
              ...objectProperty,
              receiver: expr.receiver,
              node: objectProperty.node ?? expr.node,
            }
            : { ...objectProperty, node: objectProperty.node ?? expr.node };
        }
      }
      return {
        ...expr,
        receiver: rewrite(expr.receiver),
      };
    }
    case "FfiCall": {
      if (expr.receiver.kind === "Var") {
        const reflected = reflectedReceiverCallCandidate(
          `${expr.receiver.name}.${expr.path.join(".")}`,
          expr.args,
          bindings,
          selected,
          refs,
          jsRefCallMember,
        );
        if (reflected) {
          solveRewrittenFfi(expr, reflected.callee);
          return {
            kind: "Call",
            callee: reflected.callee,
            args: rewriteArgsWithVariant(
              reflected.args,
              reflected.variant,
              bindings,
              selected,
              refs,
              objectAccess,
              importedTypeRefs,
            ),
            node: expr.node,
          };
        }
        const objectReceiver = isDottedRecordFieldReceiver(expr.receiver.name)
          ? undefined
          : objectReceiverCall(
            `${expr.receiver.name}.${expr.path.join(".")}`,
            expr.args,
            bindings,
            selected,
            objectAccess,
            jsRefCallMember,
          );
        if (objectReceiver) {
          if ("variant" in objectReceiver) {
            solveRewrittenFfi(expr, objectReceiver.callee);
            return {
              kind: "Call",
              callee: objectReceiver.callee,
              args: rewriteArgsWithVariant(
                objectReceiver.args,
                objectReceiver.variant,
                bindings,
                selected,
                refs,
                objectAccess,
                importedTypeRefs,
              ),
              node: expr.node,
            };
          }
          if (objectReceiver.kind !== "FfiCall") return objectReceiver;
          const sameReceiver = objectReceiver.receiver.kind === "Var" &&
            objectReceiver.receiver.name === expr.receiver.name;
          return {
            ...objectReceiver,
            receiver: sameReceiver ? expr.receiver : objectReceiver.receiver,
            node: objectReceiver.node ?? expr.node,
            args: objectReceiver.args.map((arg) => rewrite(arg)),
          };
        }
      }
      return {
        ...expr,
        receiver: rewrite(expr.receiver),
        args: expr.args.map((arg) => rewrite(arg)),
      };
    }
    case "Var": {
      const functionValue = reflectedReceiverFunctionValue(expr.name, bindings, selected, refs);
      const property = reflectedReceiverProperty(expr.name, bindings, selected, refs);
      return functionValue ?? property ??
        objectReceiverProperty(expr.name, bindings, selected, objectAccess, activeRecordFields) ??
        expr;
    }
    case "Call": {
      if (expr.callee.kind === "Var") {
        const reflectedFunction = reflectedFunctionCallCandidate(
          expr.callee.name,
          expr.args,
          bindings,
          selected,
          refs,
          objectAccess,
        );
        if (reflectedFunction) {
          return {
            ...expr,
            callee: reflectedFunction.callee,
            args: rewriteArgsWithVariant(
              reflectedFunction.args,
              reflectedFunction.variant,
              bindings,
              selected,
              refs,
              objectAccess,
              importedTypeRefs,
            ),
          };
        }
        const variants = bindings.get(expr.callee.name)?.variants ?? [];
        if (variants.length > 0) {
          return {
            kind: "FfiBindingCall",
            name: expr.callee.name,
            args: expr.args.map((arg) => rewrite(arg)),
            effect: commonBindingEffect(variants),
            node: expr.node,
          };
        }
        const receiver = reflectedReceiverCallCandidate(
          expr.callee.name,
          expr.args,
          bindings,
          selected,
          refs,
          jsRefCallMember,
        );
        if (receiver) {
          return {
            ...expr,
            callee: receiver.callee,
            args: rewriteArgsWithVariant(
              receiver.args,
              receiver.variant,
              bindings,
              selected,
              refs,
              objectAccess,
              importedTypeRefs,
            ),
          };
        }
        const objectReceiver = isDottedRecordFieldReceiver(expr.callee.name)
          ? undefined
          : objectReceiverCall(
            expr.callee.name,
            expr.args,
            bindings,
            selected,
            objectAccess,
            jsRefCallMember,
          );
        if (objectReceiver) {
          if ("variant" in objectReceiver) {
            return {
              ...expr,
              callee: objectReceiver.callee,
              args: rewriteArgsWithVariant(
                objectReceiver.args,
                objectReceiver.variant,
                bindings,
                selected,
                refs,
                objectAccess,
                importedTypeRefs,
              ),
            };
          }
          if (objectReceiver.kind === "FfiCall") {
            return {
              ...objectReceiver,
              node: objectReceiver.node ?? expr.node,
              args: objectReceiver.args.map((arg) => rewrite(arg)),
            };
          }
          return objectReceiver;
        }
        const unresolved = unresolvedDottedCall(expr);
        if (unresolved) return unresolved;
      }
      const args = expr.args.map((arg) => rewrite(arg));
      const callee = rewrite(expr.callee);
      return { ...expr, callee, args };
    }
    case "Tuple":
      return {
        ...expr,
        items: expr.items.map((item) => rewrite(item)),
      };
    case "Record":
      return {
        ...expr,
        fields: expr.fields.map((field) => ({
          ...field,
          value: rewrite(field.value),
        })),
      };
    case "JsonObject":
      return {
        ...expr,
        fields: expr.fields.map((field) => ({
          ...field,
          value: rewrite(field.value),
        })),
      };
    case "JsonArray":
      return {
        ...expr,
        items: expr.items.map((item) => rewrite(item)),
      };
    case "FfiBindingCall":
      return {
        ...expr,
        args: expr.args.map((arg) => rewrite(arg)),
      };
    case "Lambda": {
      if (!hostFfiDescendsInto(expr)) return expr;
      const localObjectAccess = new Map(objectAccess);
      rememberObjectParams(expr.params, localObjectAccess, importedTypeRefs);
      rememberUnannotatedParams(expr.params, localObjectAccess);
      return {
        ...expr,
        body: rewriteExprCalls(
          expr.body,
          bindings,
          selected,
          refs,
          localObjectAccess,
          importedTypeRefs,
        ),
      };
    }
    case "If":
      return {
        ...expr,
        cond: rewrite(expr.cond),
        thenExpr: rewrite(expr.thenExpr),
        elseExpr: rewrite(expr.elseExpr),
      };
    case "Match": {
      const value = rewrite(expr.value);
      return {
        ...expr,
        value,
        arms: rewriteMatchArms(
          { ...expr, value },
          bindings,
          selected,
          refs,
          objectAccess,
          importedTypeRefs,
          rewriteExprCalls,
        ),
      };
    }
    case "Panic":
      return {
        ...expr,
        message: rewrite(expr.message),
      };
    case "Block":
      return rewriteBlock(
        expr,
        bindings,
        selected,
        refs,
        objectAccess,
        importedTypeRefs,
        rewriteDeclCalls,
        rewriteExprCalls,
      );
    case "Binary":
      return {
        ...expr,
        left: rewrite(expr.left),
        right: rewrite(expr.right),
      };
    case "Unary":
      return {
        ...expr,
        value: rewrite(expr.value),
      };
    case "Pipe":
      return {
        ...expr,
        left: rewrite(expr.left),
        right: rewrite(expr.right),
      };
    default:
      return expr;
  }
}

function commonBindingEffect(variants: FfiVariant[]): "Result" | "Task" | undefined {
  const effects = new Set(variants.map((variant) => callEffect(variant.type)));
  return effects.size === 1 ? effects.values().next().value : undefined;
}

function callEffect(type: FfiVariant["type"]): "Result" | "Task" | undefined {
  const result = type.kind === "TFn" ? type.result : type;
  return result.kind === "TName" && (result.name === "Result" || result.name === "Task")
    ? result.name
    : undefined;
}

function isDottedRecordFieldReceiver(name: string): boolean {
  const parts = unresolvedDottedParts(name);
  return Boolean(parts && activeRecordFields.has(parts.path[0]));
}

function unresolvedDottedCall(expr: Extract<Expr, { kind: "Call" }>): Expr | undefined {
  if (expr.callee.kind !== "Var") return undefined;
  const parts = unresolvedDottedParts(expr.callee.name);
  if (!parts || activeRecordFields.has(parts.path[0])) return undefined;
  return {
    kind: "FfiCall",
    receiver: { kind: "Var", name: parts.base },
    path: parts.path,
    args: expr.args.map((arg) => arg),
    node: expr.node,
  };
}

function unresolvedDottedParts(name: string): { base: string; path: string[] } | undefined {
  const parts = name.split(".");
  if (parts.length < 2) return undefined;
  const base = parts[0];
  if (!/^[a-z_]/.test(base)) return undefined;
  return { base, path: parts.slice(1) };
}

function rewriteArgsWithVariant(
  args: Expr[],
  variant: FfiVariant,
  bindings: Map<string, FfiBinding>,
  selected: Set<string>,
  refs: Map<string, JsTypeRef>,
  objectAccess: Map<string, ObjectAccess>,
  importedTypeRefs: Map<string, JsTypeRef>,
): Expr[] {
  return args.map((arg, index) => {
    const visibleIndex = variant.receiverType ? index - 1 : index;
    const callbackRefs = visibleIndex >= 0
      ? variant.callbackParamRefs?.find((item) => item.argIndex === visibleIndex)
      : undefined;
    return rewriteExprCalls(
      arg,
      bindings,
      selected,
      refsForCallbackArg(refs, arg, callbackRefs?.params),
      objectAccess,
      importedTypeRefs,
    );
  });
}
