import type { Expr, Param } from "../ast.ts";
import { diagnosticError, type FrontendDiagnostic, warningDiagnostic } from "../diagnostics.ts";
import {
  type Env,
  fn,
  fresh,
  instantiate,
  named,
  prune,
  quoteType,
  type Scheme,
  tuple,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
} from "../types.ts";
import { isDecl } from "./ast_utils.ts";
import { inferDecl } from "./decl.ts";
import { assertEqualityType } from "./equality.ts";
import { checkExhaustive, mentionsLocalType } from "./exhaustiveness.ts";
import { warnRedundantMatchArms } from "./decl_helpers.ts";
import { inferPattern } from "./patterns.ts";
import {
  constrainAt,
  fnSource,
  sourceForExpr,
  sourceForTypedExpr,
  tupleSource,
  type TypeProvenance,
} from "./provenance.ts";
import { callArg } from "./shared.ts";
import { inferExpr } from "./expr.ts";
import { callArity } from "./expr_call.ts";
import { recordConsumedFfiUse, recordExprFact, type TypeFacts } from "./type_facts.ts";

export function inferMatch(
  expr: Extract<Expr, { kind: "Match" }>,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  facts: TypeFacts,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
  provenance: TypeProvenance,
): Ty {
  const valueType = inferExpr(
    expr.value,
    env,
    typeEnv,
    adts,
    types,
    facts,
    warnings,
    diagnostics,
    provenance,
  );
  recordConsumedFfiUse(facts, valueType, {
    kind: "match",
    message:
      "cannot match unresolved JS FFI result before FFI reflection resolves the member access",
  });
  const result = fresh();
  for (const arm of expr.arms) {
    const local = new Map(env);
    inferPattern(arm.pattern, valueType, local, typeEnv, adts, new Set(), facts);
    const armType = inferExpr(
      arm.body,
      local,
      typeEnv,
      adts,
      types,
      facts,
      warnings,
      diagnostics,
      provenance,
    );
    constrainAt(
      result,
      armType,
      arm.body,
      undefined,
      [],
      provenance,
      {
        message: "match arm result",
        node: arm.body.node,
        span: arm.body.node?.span,
      },
      {
        premise: {
          rule: "InferMatch.ArmsSameType",
          role: "match arm result agrees with previous arms",
          subject: "match arm result",
          leftRole: "match result",
          rightRole: "arm result",
        },
      },
    );
  }
  const armPatterns = expr.arms.map((arm) => arm.pattern);
  warnRedundantMatchArms(armPatterns, valueType, typeEnv, adts, warnings, diagnostics);
  const exhaustiveWarning = checkExhaustive(armPatterns, valueType, typeEnv, adts);
  if (exhaustiveWarning) {
    warnings.push(exhaustiveWarning);
    diagnostics.push(warningDiagnostic(exhaustiveWarning, expr.node, "pattern.non-exhaustive"));
  }
  return result;
}

export function inferBlock(
  expr: Extract<Expr, { kind: "Block" }>,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  facts: TypeFacts,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
  provenance: TypeProvenance,
): Ty {
  const local = new Map(env);
  const localTypes = new Map(typeEnv);
  const outerTypeIds = new Set([...typeEnv.values()].map((info) => info.id));
  expr.items.forEach((s) =>
    isDecl(s)
      ? inferDecl(
        s,
        local,
        new Map(),
        localTypes,
        new Map(),
        adts,
        types,
        facts,
        warnings,
        diagnostics,
        new Set([...localTypes.values()].map((info) => info.id)),
        provenance,
      )
      : inferExpr(
        s,
        local,
        localTypes,
        adts,
        types,
        facts,
        warnings,
        diagnostics,
        provenance,
      )
  );
  const result = inferExpr(
    expr.result,
    local,
    localTypes,
    adts,
    types,
    facts,
    warnings,
    diagnostics,
    provenance,
  );
  if (mentionsLocalType(result, outerTypeIds)) throw new Error("local type escapes scope");
  return result;
}

export function inferBinary(
  expr: Extract<Expr, { kind: "Binary" }>,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  facts: TypeFacts,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
  provenance: TypeProvenance,
): Ty {
  const result = fresh();
  const op: Scheme | undefined = env.get(expr.op);
  if (!op) throw new Error(`unknown operator ${expr.op}`);
  const left = inferExpr(
    expr.left,
    env,
    typeEnv,
    adts,
    types,
    facts,
    warnings,
    diagnostics,
    provenance,
  );
  const right = inferExpr(
    expr.right,
    env,
    typeEnv,
    adts,
    types,
    facts,
    warnings,
    diagnostics,
    provenance,
  );
  recordConsumedFfiUse(facts, left, {
    kind: "operator",
    message:
      "cannot use unresolved JS FFI result as an operator operand before FFI reflection resolves the member access",
  });
  recordConsumedFfiUse(facts, right, {
    kind: "operator",
    message:
      "cannot use unresolved JS FFI result as an operator operand before FFI reflection resolves the member access",
  });
  rejectEscapedUnresolvedFfi(expr.left, left, typeEnv);
  rejectEscapedUnresolvedFfi(expr.right, right, typeEnv);
  if (expr.op === "++") {
    rejectUnresolvedFfiResultOperand(expr.left, left, typeEnv);
    rejectUnresolvedFfiResultOperand(expr.right, right, typeEnv);
  }
  const operatorType = instantiate(op);
  const leftCarrier = resultParts(left, typeEnv);
  const rightCarrier = resultParts(right, typeEnv);
  const leftOperand = leftCarrier?.value ?? left;
  const rightOperand = rightCarrier?.value ?? right;
  const actual = fn([tuple([leftOperand, rightOperand])], result);
  constrainAt(
    operatorType,
    actual,
    expr,
    undefined,
    [],
    provenance,
    {
      message: `operator ${expr.op}: ${quoteType(operatorType)}`,
      node: expr.node,
      span: expr.node?.span,
      primary: true,
    },
    {
      premise: {
        rule: "InferBinary.OperatorOperands",
        role: "operator operands match operator type",
        subject: `operator ${expr.op}`,
        leftRole: "operator",
        rightRole: "operands",
      },
      sources: {
        left: { origin: { message: `operator ${expr.op}: ${quoteType(operatorType)}` } },
        right: fnSource(
          [
            tupleSource([
              sourceForTypedExpr(expr.left, left, provenance, "left operand"),
              sourceForTypedExpr(expr.right, right, provenance, "right operand"),
            ]),
          ],
          sourceForExpr(expr, "operator result"),
        ),
      },
      context: (path) => binaryContext(expr.op, path),
    },
  );
  if (expr.op === "==" || expr.op === "!=") assertEqualityType(leftOperand, typeEnv, adts);
  if (!leftCarrier && !rightCarrier) return result;
  if (leftCarrier && rightCarrier) {
    constrainAt(
      leftCarrier.error,
      rightCarrier.error,
      expr,
      undefined,
      [],
      provenance,
      {
        message: "Result operator error carrier",
        node: expr.node,
        span: expr.node?.span,
      },
      {
        premise: {
          rule: "InferBinary.ResultCarrierError",
          role: "Result operator operands use the same error type",
          subject: `operator ${expr.op}`,
          leftRole: "left error",
          rightRole: "right error",
        },
      },
    );
  }
  const carrier = leftCarrier ?? rightCarrier;
  const resultInfo = typeEnv.get("Result");
  if (!carrier || !resultInfo) return result;
  return named(resultInfo, [result, carrier.error]);
}

function binaryContext(
  operator: string,
  path: import("../type_diff.ts").DiffPath,
): string | undefined {
  const param = path[0];
  if (!param || param.kind !== "fn-param" || param.index !== 0) return `operator ${operator}`;
  const item = path[1];
  if (!item || item.kind !== "tuple-item") return `operator ${operator}`;
  return item.index === 0
    ? `operator ${operator} left operand`
    : `operator ${operator} right operand`;
}

function rejectEscapedUnresolvedFfi(expr: Expr, type: Ty, typeEnv: TypeEnv) {
  if (expr.kind !== "FfiGet" && expr.kind !== "FfiCall") return;
  if (!isResultType(type, typeEnv)) return;
  const kind = expr.kind === "FfiGet" ? "property" : "method";
  throw diagnosticError(
    new Error(
      `cannot infer JS FFI ${kind} ${
        expr.path.join(".")
      } for unconstrained receiver; unresolved JS FFI access is not a generic value`,
    ),
    expr.node,
  );
}

function rejectUnresolvedFfiResultOperand(expr: Expr, type: Ty, typeEnv: TypeEnv) {
  const value = resultValueType(type, typeEnv);
  if (!value || !containsTypeVar(value)) return;
  throw diagnosticError(
    new Error(
      "cannot use unresolved JS FFI result as a String; unresolved JS FFI access is not a generic value",
    ),
    expr.node,
  );
}

function isResultType(type: Ty, typeEnv: TypeEnv): boolean {
  return !!resultParts(type, typeEnv);
}

function resultValueType(type: Ty, typeEnv: TypeEnv): Ty | undefined {
  return resultParts(type, typeEnv)?.value;
}

function resultParts(type: Ty, typeEnv: TypeEnv): { value: Ty; error: Ty } | undefined {
  const resolved = prune(type);
  const result = typeEnv.get("Result");
  if (!result || resolved.tag !== "named" || resolved.id !== result.id) return undefined;
  return { value: resolved.args[0], error: resolved.args[1] };
}

function containsTypeVar(type: Ty): boolean {
  const resolved = prune(type);
  if (resolved.tag === "var") return true;
  if (resolved.tag === "fn") {
    return resolved.params.some(containsTypeVar) || containsTypeVar(resolved.result);
  }
  if (resolved.tag === "tuple") return resolved.items.some(containsTypeVar);
  if (resolved.tag === "named") return resolved.args.some(containsTypeVar);
  return false;
}

export function inferParam(
  param: Param,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  binders: Set<string>,
  facts: TypeFacts,
): Ty {
  const expected = fresh();
  return inferPattern(param.pattern, expected, env, typeEnv, adts, binders, facts);
}

export function inferPipe(
  expr: Extract<Expr, { kind: "Pipe" }>,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  facts: TypeFacts,
  warnings: string[],
  diagnostics: FrontendDiagnostic[],
  provenance: TypeProvenance,
): Ty {
  const leftType = inferExpr(
    expr.left,
    env,
    typeEnv,
    adts,
    types,
    facts,
    warnings,
    diagnostics,
    provenance,
  );
  recordConsumedFfiUse(facts, leftType, {
    kind: "pipe",
    message:
      "cannot pipe unresolved JS FFI result before FFI reflection resolves the member access",
  });
  const right = expr.right;

  if (right.kind === "Call") {
    const calleeType = inferExpr(
      right.callee,
      env,
      typeEnv,
      adts,
      types,
      facts,
      warnings,
      diagnostics,
      provenance,
    );
    const argTypes = right.args.map((a) =>
      inferExpr(a, env, typeEnv, adts, types, facts, warnings, diagnostics, provenance)
    );
    const allArgs = [leftType, ...argTypes];
    const argType = callArg(allArgs);
    const result = constrainPipe(
      expr,
      calleeType,
      argType,
      provenance,
      right.callee,
      [expr.left, ...right.args],
      [leftType, ...argTypes],
    );
    recordExprFact(facts, right.callee, {
      subject: "expr",
      instantiated: fn([argType], result),
    });
    return result;
  }

  const calleeType = inferExpr(
    right,
    env,
    typeEnv,
    adts,
    types,
    facts,
    warnings,
    diagnostics,
    provenance,
  );
  const result = constrainPipe(
    expr,
    calleeType,
    leftType,
    provenance,
    right,
    [expr.left],
    [leftType],
  );
  recordExprFact(facts, right, {
    subject: "expr",
    instantiated: fn([leftType], result),
  });
  return result;
}

function constrainPipe(
  expr: Extract<Expr, { kind: "Pipe" }>,
  calleeType: Ty,
  argType: Ty,
  provenance: TypeProvenance,
  callee: Expr,
  argExprs: Expr[],
  argTypes: Ty[],
): Ty {
  const result = fresh();
  const expected = fn([argType], result);
  constrainAt(
    calleeType,
    expected,
    expr,
    undefined,
    [],
    provenance,
    {
      message: callee.kind === "Var" ? `${callee.name} pipe` : "pipe",
      node: expr.node,
      span: expr.node?.span,
      primary: true,
      expectedCallTupleShape: callArity(argType),
      actualCallTupleShape: callArity(argType),
      callDepth: 0,
    },
    {
      premise: {
        rule: "InferPipe.StepInput",
        role: "pipe output matches next function input",
        subject: callee.kind === "Var" ? callee.name : "pipe",
        leftRole: "callee",
        rightRole: "pipe function",
      },
      sources: {
        left: sourceForExpr(callee, callee.kind === "Var" ? callee.name : "callee"),
        right: fnSource(
          [callArgSource(argExprs, argTypes, provenance)],
          sourceForExpr(expr, "pipe result"),
        ),
      },
      context: (path) => pipeContext(callee, path),
    },
  );
  return result;
}

function callArgSource(args: Expr[], types: Ty[], provenance: TypeProvenance) {
  if (args.length === 1) return sourceForTypedExpr(args[0], types[0], provenance, "piped value");
  return tupleSource(
    args.map((arg, index) =>
      sourceForTypedExpr(
        arg,
        types[index],
        provenance,
        index === 0 ? "piped value" : `argument ${index}`,
      )
    ),
  );
}

function pipeContext(callee: Expr, path: import("../type_diff.ts").DiffPath): string | undefined {
  const name = callee.kind === "Var" ? callee.name : "pipe";
  const param = path[0];
  if (!param || param.kind !== "fn-param" || param.index !== 0) return name;
  const tupleItem = path[1];
  const afterTuple = tupleItem?.kind === "tuple-item" ? path.slice(2) : path.slice(1);
  const source = tupleItem?.kind === "tuple-item" && tupleItem.index > 0
    ? `argument ${tupleItem.index}`
    : "piped value";
  if (afterTuple.some((segment) => segment.kind === "fn-result")) {
    return `${name} callback result`;
  }
  return `${name} ${source}`;
}
