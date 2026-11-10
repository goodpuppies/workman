import { taintExpression } from "./taint.ts";
import { holdResult } from "../types.ts";
import type { Expr } from "../ast.ts";
import { fieldAccessReceiverName, longIdSpelling, pathOf } from "../ast.ts";
import { sequenceType } from "../taint.ts";
import { diagnosticError } from "../diagnostic_model.ts";
import {
  BoolTy,
  CharTy,
  fresh,
  freshFfi,
  freshIntegerLiteral,
  freshNumeric,
  ftv,
  instantiate,
  knownTypeInfos,
  named,
  NumberTy,
  prune,
  StringTy,
  tuple,
  type Ty,
  type TypeEnv,
  typeInfoById,
  typeInfoByName,
  VoidTy,
} from "../types.ts";
import { assertJsonCompatible, jsonValueTy } from "./json.ts";
import type { InferContext } from "./context.ts";
import { lookupLongValue } from "./environment.ts";

import {
  constrainAt,
  rememberExpressionSource,
  rememberVariableSource,
  sourceForTypedExpr,
} from "./provenance.ts";
import { inferDottedVar, inferRecordExpr } from "./records.ts";
import { ffiGetResultTy, inferCall } from "./expr_call.ts";
import { contextualLambdaParams, inferLambdaTy } from "./expr_lambda.ts";
import {
  ffiCallbackParamHints,
  jsArrayFfiCallValue,
  jsArrayFfiGetValue,
  jsPrimitiveFfiCallValue,
  jsPrimitiveFfiGetValue,
  jsPromiseFfiCallValue,
} from "./expr_js_members.ts";
import { inferBinary, inferBlock, inferMatch, inferPipe } from "./expr_flow.ts";
import { type CarrierPeel, peelCarrier, rewrapCarrier } from "./carriers.ts";
import {
  originForScheme,
  recordConsumedFfiUse,
  recordExpectedExprType,
  recordExprFact,
  recordFfiFact,
  recordOperatorFact,
} from "./type_facts.ts";
import { gpuOperatorId } from "../gpu_operators.ts";
import { elaborateConstraint } from "./constraints.ts";
import { callInvocationPlan } from "../pipe_elaboration.ts";
import { inferDomainInvocation } from "./invocation.ts";

// Literals written directly under unary minus, so `-2147483648` is range-checked as one value.
const negatedLiterals = new WeakSet<Expr>();

export function inferExpr(expr: Expr, context: InferContext, expected?: Ty): Ty {
  try {
    return inferExprInner(expr, context, expected);
  } catch (error) {
    throw diagnosticError(error, expr.node);
  }
}

function inferExprInner(expr: Expr, context: InferContext, expected?: Ty): Ty {
  const { env, typeEnv, types, facts, warnings, diagnostics, provenance } = context;
  let t: Ty;
  switch (expr.kind) {
    // Integer literals carry candidate types until context or defaulting selects one.
    case "Int":
      t = freshIntegerLiteral(expr, negatedLiterals.has(expr));
      break;
    case "Float":
      t = NumberTy;
      break;
    case "Char":
      t = CharTy;
      break;
    case "String":
      t = StringTy;
      break;
    case "Bool":
      t = BoolTy;
      break;
    case "Void":
      t = VoidTy;
      break;
    case "Var": {
      const path = pathOf(expr);
      const qualifier = path.qualifiers[0];
      let scheme = qualifier && context.strEnv.has(qualifier)
        ? lookupLongValue(context.strEnv, path)
        : env.get(expr.name);
      let namespaceCarrier: string | undefined;
      if (!scheme && !qualifier) {
        const carrier = context.strEnv.get(expr.name)?.valEnv.get("carrier");
        if (carrier) {
          scheme = carrier;
          namespaceCarrier = `${expr.name}.carrier`;
        }
      }
      if (!scheme) {
        if (context.strEnv.has(expr.name)) {
          throw new Error(`unknown name ${expr.name}.carrier`);
        }
        // A qualified spelling that is not entirely a structure member may still be a
        // record projection through one: `resolveLongValue` reaches the deepest value
        // member and `inferDottedVar` projects the remaining fields, so the spelling
        // falls through rather than failing at the first non-member segment.
        t = context.dialect.inferUnboundVar?.(expr, context) ??
          context.dialect.inferProjection?.(expr, context) ??
          inferDottedVar(path, env, typeEnv, context.strEnv, {
            expression: expr,
            facts,
            warnings,
            diagnostics,
            provenance,
          });
        break;
      }
      t = instantiate(scheme);
      rememberVariableSource(expr, t, scheme, provenance);
      if (namespaceCarrier) facts.namespaceValues.set(expr, namespaceCarrier);
      recordExprFact(facts, expr, {
        subject: scheme.status === "constructor" ? "constructor" : "expr",
        instantiated: t,
        general: scheme,
        origin: originForScheme(expr.name, scheme),
      });
      break;
    }
    case "Tuple": {
      const items = expr.items.map((x) => inferExpr(x, context));
      t = context.dialect.inferTuple?.(expr, items, context) ?? tuple(items);
      break;
    }
    case "Record":
      t = inferRecordExpr(
        expr,
        typeEnv,
        function inferRecordValue(value, expected) {
          if (expected) recordExpectedExprType(facts, value, expected);
          if (expected && value.kind === "Record") {
            return inferRecordExpr(
              value,
              typeEnv,
              inferRecordValue,
              expected,
              warnings,
              diagnostics,
              facts,
              context.strEnv,
            );
          }
          return inferExpr(value, context);
        },
        undefined,
        warnings,
        diagnostics,
        facts,
        context.strEnv,
      );
      break;
    case "JsonObject":
      for (const field of expr.fields) {
        const valueType = inferExpr(field.value, context);
        assertJsonCompatible(valueType, typeEnv, field.value);
      }
      t = jsonValueTy(typeEnv);
      break;
    case "JsonArray":
      for (const item of expr.items) {
        const itemType = inferExpr(item, context);
        assertJsonCompatible(itemType, typeEnv, item);
      }
      t = jsonValueTy(typeEnv);
      break;
    case "FfiGet": {
      const receiver = inferExpr(expr.receiver, context);
      const projection = inferRecordMember(expr, receiver, context);
      if (projection) {
        t = projection;
        break;
      }
      const value = jsArrayFfiGetValue(typeEnv, receiver, expr.path) ??
        jsPrimitiveFfiGetValue(receiver, expr.path);
      t = value
        ? ffiGetResultTy(typeEnv, value)
        : freshFfi("get", receiver, expr.path, [], expr.node);
      if (value) {
        recordExprFact(facts, expr, {
          subject: "synthetic",
          instantiated: t,
          origin: { source: "synthetic" },
        });
      } else if (t.tag === "ffi") {
        recordExprFact(facts, expr, {
          subject: "ffi-obligation",
          instantiated: t,
          origin: { source: "synthetic" },
        });
        recordFfiFact(facts, {
          id: t.id,
          kind: t.kind,
          path: t.path,
          receiver: t.receiver,
          args: t.args,
          expr,
          placeholder: t,
          status: "unresolved",
          instantiated: t,
          origin: { source: "synthetic" },
        });
      }
      break;
    }
    case "FfiCall": {
      const receiver = inferExpr(expr.receiver, context);
      const projection = inferRecordMember(expr, receiver, context);
      if (projection) {
        t = projection;
        break;
      }
      const args: Ty[] = new Array(expr.args.length);
      for (const [index, arg] of expr.args.entries()) {
        if (arg.kind === "Lambda") continue;
        args[index] = inferExpr(arg, context);
      }
      for (const [index, arg] of expr.args.entries()) {
        if (arg.kind !== "Lambda") continue;
        const hints = ffiCallbackParamHints(typeEnv, receiver, expr.path, index, args);
        args[index] = inferLambdaTy(
          arg,
          context,
          hints,
        );
      }
      const value = jsArrayFfiCallValue(typeEnv, receiver, expr.path, args) ??
        jsPromiseFfiCallValue(typeEnv, receiver, expr.path, args) ??
        jsPrimitiveFfiCallValue(receiver, expr.path, args);
      t = value
        ? ffiGetResultTy(typeEnv, value)
        : freshFfi("call", receiver, expr.path, args, expr.node);
      if (value) {
        recordExprFact(facts, expr, {
          subject: "synthetic",
          instantiated: t,
          origin: { source: "synthetic" },
        });
      } else if (t.tag === "ffi") {
        recordExprFact(facts, expr, {
          subject: "ffi-obligation",
          instantiated: t,
          origin: { source: "synthetic" },
        });
        recordFfiFact(facts, {
          id: t.id,
          kind: t.kind,
          path: t.path,
          receiver: t.receiver,
          args: t.args,
          expr,
          placeholder: t,
          status: "unresolved",
          instantiated: t,
          origin: { source: "synthetic" },
        });
      }
      break;
    }
    case "FfiBindingCall": {
      const args: Ty[] = new Array(expr.args.length);
      for (const [index, arg] of expr.args.entries()) {
        if (arg.kind === "Lambda") continue;
        args[index] = inferExpr(arg, context);
      }
      for (const [index, arg] of expr.args.entries()) {
        if (arg.kind !== "Lambda") continue;
        args[index] = inferLambdaTy(
          arg,
          context,
        );
      }
      const placeholder = freshFfi("call", undefined, [], args, expr.node, expr.name);
      t = ffiBindingCallType(typeEnv, placeholder, expr.effect);
      if (placeholder.tag === "ffi") {
        recordExprFact(facts, expr, {
          subject: "ffi-obligation",
          instantiated: t,
          origin: { source: "synthetic" },
        });
        recordFfiFact(facts, {
          id: placeholder.id,
          kind: placeholder.kind,
          path: placeholder.path,
          receiver: placeholder.receiver,
          args: placeholder.args,
          binding: placeholder.binding,
          expr,
          placeholder,
          status: "unresolved",
          instantiated: t,
          origin: { source: "synthetic" },
        });
      }
      break;
    }
    case "Lambda":
      t = inferLambdaTy(
        expr,
        context,
        contextualLambdaParams(expr, expected, context),
      );
      break;
    case "Call":
      t = inferDomainInvocation(callInvocationPlan(expr), context) ?? inferCall(expr, context);
      break;
    case "If":
      recordExpectedExprType(facts, expr.cond, BoolTy);
      constrainAt(
        inferExpr(expr.cond, context),
        BoolTy,
        expr.cond,
        undefined,
        [],
        provenance,
        {
          message: "if condition",
          node: expr.cond.node,
          span: expr.cond.node?.span,
        },
        {
          premise: {
            rule: "InferIf.ConditionBool",
            role: "if condition is Bool",
            subject: "if condition",
            leftRole: "condition",
            rightRole: "Bool",
          },
        },
      );
      t = inferExpr(expr.thenExpr, context);
      const thenSource = sourceForTypedExpr(
        expr.thenExpr,
        t,
        provenance,
        "then branch result",
      );
      recordExpectedExprType(facts, expr.elseExpr, t);
      const elseType = inferExpr(expr.elseExpr, context);
      const elseSource = sourceForTypedExpr(
        expr.elseExpr,
        elseType,
        provenance,
        "else branch result",
      );
      recordExpectedExprType(facts, expr.thenExpr, elseType);
      // `if` is a derived form of `match`: both branches meet in one result variable.
      t = holdResult(t);
      constrainAt(
        t,
        elseType,
        expr.elseExpr,
        undefined,
        [],
        provenance,
        {
          message: "if branch result",
          node: expr.elseExpr.node,
          span: expr.elseExpr.node?.span,
        },
        {
          premise: {
            code: "type.if-branch-results-disagree",
            rule: "InferIf.BranchesSameType",
            role: "if branches have the same type",
            subject: "if expression",
            leftRole: "then branch",
            rightRole: "else branch",
          },
          sources: { left: thenSource, right: elseSource },
          primarySource: "right",
        },
      );
      break;
    case "Match":
      t = inferMatch(
        expr,
        context,
      );
      break;
    case "Panic": {
      if (expr.recoveryHole) {
        facts.recoveryHoles.push({
          ...expr.recoveryHole,
          expression: expr,
          expected: facts.expectedExpressions.get(expr) ?? fresh(),
        });
      }
      recordExpectedExprType(facts, expr.message, StringTy);
      const panicMessage = inferExpr(expr.message, context);
      constrainAt(
        StringTy,
        panicMessage,
        expr.message,
        undefined,
        [],
        provenance,
        {
          message: "panic message",
          node: expr.message.node,
          span: expr.message.node?.span,
          primary: true,
        },
        {
          premise: {
            rule: "InferPanic.MessageString",
            role: "panic message is String",
            subject: "panic message",
            leftRole: "required type",
            rightRole: "message",
          },
          sources: {
            right: sourceForTypedExpr(expr.message, panicMessage, provenance, "panic message"),
          },
        },
      );
      t = fresh();
      break;
    }
    case "Block":
      t = inferBlock(
        expr,
        context,
      );
      break;
    case "Ascribed": {
      const annotation = elaborateConstraint(expr.annotation, context, expr.node);
      recordExpectedExprType(facts, expr.value, annotation);
      const inferRecordValue = (value: Expr, expected?: Ty): Ty => {
        if (expected) recordExpectedExprType(facts, value, expected);
        if (expected && value.kind === "Record") {
          return inferRecordExpr(
            value,
            typeEnv,
            inferRecordValue,
            expected,
            warnings,
            diagnostics,
            facts,
            context.strEnv,
          );
        }
        return inferExpr(value, context, expected);
      };
      t = expr.value.kind === "Record"
        ? inferRecordExpr(
          expr.value,
          typeEnv,
          inferRecordValue,
          annotation,
          warnings,
          diagnostics,
          facts,
          context.strEnv,
        )
        : inferExpr(expr.value, context, annotation);
      constrainAt(t, annotation, expr, undefined, [], provenance, {
        message: "expression type constraint",
        node: expr.node,
        span: expr.node?.span,
      }, {
        premise: {
          rule: "InferConstraint.Expression",
          role: "expression matches written type constraint",
          subject: "expression type constraint",
          leftRole: "expression",
          rightRole: "written type",
        },
      });
      break;
    }
    case "Binary":
      t = inferBinary(
        expr,
        context,
      );
      break;
    case "Unary":
      if (expr.op === "-") {
        // The parser reads `(-2147483648: I32)` as a minus around the ascribed literal.
        const operand = expr.value.kind === "Ascribed" ? expr.value.value : expr.value;
        if (operand.kind === "Int") negatedLiterals.add(operand);
        const numeric = operand.kind === "Int"
          ? freshIntegerLiteral(operand, true)
          : freshNumeric();
        recordExpectedExprType(facts, expr.value, numeric);
        let value: Ty;
        try {
          value = inferExpr(expr.value, context);
        } finally {
          if (operand.kind === "Int") negatedLiterals.delete(operand);
        }
        const carrier = resultParts(value, typeEnv);
        recordConsumedFfiUse(facts, value, {
          kind: "operator",
          message:
            "cannot use unresolved JS FFI result as an operator operand before FFI reflection resolves the member access",
        });
        constrainAt(
          numeric,
          carrier?.payload ?? value,
          expr.value,
          undefined,
          [],
          provenance,
          {
            message: "unary - operand",
            node: expr.value.node,
            span: expr.value.node?.span,
            primary: true,
          },
          {
            premise: {
              rule: "InferUnary.NumericOperand",
              role: "unary - operand has a supported numeric type",
              subject: "unary - operand",
              leftRole: "required type",
              rightRole: "operand",
            },
            sources: {
              right: sourceForTypedExpr(
                expr.value,
                carrier?.payload ?? value,
                provenance,
                "unary - operand",
              ),
            },
          },
        );
        t = carrier ? rewrapCarrier(carrier, numeric) : numeric;
      } else {
        recordExpectedExprType(facts, expr.value, BoolTy);
        const value = inferExpr(expr.value, context);
        const carrier = resultParts(value, typeEnv);
        recordConsumedFfiUse(facts, value, {
          kind: "operator",
          message:
            "cannot use unresolved JS FFI result as an operator operand before FFI reflection resolves the member access",
        });
        constrainAt(
          BoolTy,
          carrier?.payload ?? value,
          expr.value,
          undefined,
          [],
          provenance,
          {
            message: "unary ! operand",
            node: expr.value.node,
            span: expr.value.node?.span,
            primary: true,
          },
          {
            premise: {
              rule: "InferUnary.BooleanOperand",
              role: "unary ! operand is Bool",
              subject: "unary ! operand",
              leftRole: "required type",
              rightRole: "operand",
            },
            sources: {
              right: sourceForTypedExpr(
                expr.value,
                carrier?.payload ?? value,
                provenance,
                "unary ! operand",
              ),
            },
          },
        );
        t = carrier ? rewrapCarrier(carrier, BoolTy) : BoolTy;
      }
      break;
    case "Pipe":
      t = inferPipe(
        expr,
        context,
      );
      break;
  }
  if (expr.kind === "Unary" || expr.kind === "Binary") {
    const operatorId = gpuOperatorId(expr);
    if (operatorId) recordOperatorFact(facts, expr, operatorId);
  }
  t = taintExpression(expr, t, context);
  types.set(expr, t);
  rememberExpressionSource(expr, t, provenance);
  return t;
}

function ffiBindingCallType(
  typeEnv: TypeEnv,
  value: Ty,
  effect: "Result" | "Task" | undefined,
): Ty {
  if (!effect) return value;
  const carrier = typeInfoByName(typeEnv, effect);
  const jsError = typeInfoByName(typeEnv, "Js.Error");
  if (!carrier || !jsError) throw new Error("unknown FFI effect basis type");
  return named(carrier, [value, named(jsError)]);
}

function resultParts(type: Ty, typeEnv: TypeEnv): CarrierPeel | undefined {
  return peelCarrier(type, typeEnv);
}

// Pipe members share record projection semantics with `value.field`. Select this before
// creating an FFI obligation, so pure fields and field constraints stay ordinary WM types.
let nextRecordMember = 0;
function inferRecordMember(
  expr: Extract<Expr, { kind: "FfiGet" | "FfiCall" }>,
  receiver: Ty,
  context: InferContext,
): Ty | undefined {
  const target = prune(receiver);
  const record = target.tag === "named"
    ? typeInfoById(context.typeEnv, target.id) ?? target.definition ?? target
    : undefined;
  if (target.tag === "named" && (target.foreign || record?.foreign)) return undefined;
  if (
    target.tag !== "struct" && !record?.recordFields &&
    !(target.tag === "var" &&
      knownTypeInfos(context.typeEnv).some((info) =>
        !info.foreign && info.recordFields?.some((field) => field.name === expr.path[0])
      ))
  ) return undefined;

  // A pending foreign result can be constrained to Result<receiver, error> by
  // an unwrap helper. Let reflection determine that receiver before choosing a
  // nominal field solely because its label happens to be declared elsewhere.
  if (target.tag === "var") {
    for (const fact of context.facts.ffi.values()) {
      if (fact.status !== "unresolved") continue;
      if (fact.placeholder?.constraints?.some((type) => ftv(type).has(target.id))) {
        return undefined;
      }
    }
  }

  // Bind the already inferred receiver monomorphically. Its evaluation remains in the
  // emitted block, once and before any call arguments, without inferring it twice.
  const name = `${fieldAccessReceiverName(expr.node?.id ?? nextRecordMember++)}_pipe`;
  const env = new Map(context.env);
  env.set(name, { vars: [], type: receiver });
  const path = { qualifiers: [name, ...expr.path.slice(0, -1)], id: expr.path.at(-1)! };
  const field: Expr = { kind: "Var", name: longIdSpelling(path), path, node: expr.node };
  const result: Expr = expr.kind === "FfiCall"
    ? { kind: "Call", callee: field, args: expr.args, node: expr.node }
    : field;
  const type = sequenceType([receiver], inferExpr(result, { ...context, env }));
  const block: Expr = {
    kind: "Block",
    items: [{
      kind: "LetDecl",
      exported: true,
      recursive: false,
      bindings: [{ pattern: { kind: "PVar", name }, value: expr.receiver }],
    }],
    result,
    node: expr.node,
  };
  for (const key of Object.keys(expr)) Reflect.deleteProperty(expr, key);
  Object.assign(expr, block);
  return type;
}
