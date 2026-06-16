import type { Expr } from "../ast.ts";
import {
  diagnosticError,
  type FrontendDiagnostic,
  warningDiagnostic,
} from "../diagnostics.ts";
import {
  BoolTy,
  type Env,
  fresh,
  freshFfi,
  instantiate,
  NumberTy,
  prune,
  StringTy,
  tuple,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
  VoidTy,
} from "../types.ts";
import { assertJsonCompatible, jsonValueTy } from "./json.ts";

import { type TypeProvenance } from "./provenance.ts";
import { inferDottedVar, inferRecordExpr } from "./records.ts";
import { constrain } from "./shared.ts";
import { ffiGetResultTy, inferCall } from "./expr_call.ts";
import { inferLambdaTy } from "./expr_lambda.ts";
import {
  ffiCallbackParamHints,
  jsArrayFfiCallValue,
  jsArrayFfiGetValue,
  jsPrimitiveFfiCallValue,
  jsPrimitiveFfiGetValue,
  jsPromiseFfiCallValue,
} from "./expr_js_members.ts";
import { inferBinary, inferBlock, inferMatch, inferParam, inferPipe } from "./expr_flow.ts";
import { originForScheme, recordExprFact, recordFfiFact, type TypeFacts } from "./type_facts.ts";

export function inferExpr(
  expr: Expr,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  facts: TypeFacts,
  warnings: string[] = [],
  diagnostics: FrontendDiagnostic[] = [],
  provenance: TypeProvenance = new Map(),
): Ty {
  try {
    return inferExprInner(
      expr,
      env,
      typeEnv,
      adts,
      types,
      facts,
      warnings,
      diagnostics,
      provenance,
    );
  } catch (error) {
    throw diagnosticError(error, expr.node);
  }
}

function inferExprInner(
  expr: Expr,
  env: Env,
  typeEnv: TypeEnv,
  adts: Map<number, TypeDeclInfo>,
  types: Map<Expr, Ty>,
  facts: TypeFacts,
  warnings: string[] = [],
  diagnostics: FrontendDiagnostic[] = [],
  provenance: TypeProvenance = new Map(),
): Ty {
  let t: Ty;
  switch (expr.kind) {
    case "Int":
    case "Float":
      t = NumberTy;
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
      const scheme = env.get(expr.name);
      if (!scheme) {
        t = inferDottedVar(expr.name, env, typeEnv);
        break;
      }
      t = instantiate(scheme);
      recordExprFact(facts, expr, {
        subject: scheme.status === "constructor" ? "constructor" : "expr",
        instantiated: t,
        general: scheme,
        origin: originForScheme(expr.name, scheme),
      });
      break;
    }
    case "Tuple":
      t = tuple(
        expr.items.map((x) =>
          inferExpr(x, env, typeEnv, adts, types, facts, warnings, diagnostics, provenance)
        ),
      );
      break;
    case "Record":
      t = inferRecordExpr(
        expr,
        typeEnv,
        (value) =>
          inferExpr(
            value,
            env,
            typeEnv,
            adts,
            types,
            facts,
            warnings,
            diagnostics,
            provenance,
          ),
      );
      break;
    case "JsonObject":
      for (const field of expr.fields) {
        const valueType = inferExpr(
          field.value,
          env,
          typeEnv,
          adts,
          types,
          facts,
          warnings,
          diagnostics,
          provenance,
        );
        assertJsonCompatible(valueType, typeEnv, field.value);
      }
      t = jsonValueTy(typeEnv);
      break;
    case "JsonArray":
      for (const item of expr.items) {
        const itemType = inferExpr(
          item,
          env,
          typeEnv,
          adts,
          types,
          facts,
          warnings,
          diagnostics,
          provenance,
        );
        assertJsonCompatible(itemType, typeEnv, item);
      }
      t = jsonValueTy(typeEnv);
      break;
    case "FfiGet": {
      const receiver = inferExpr(
        expr.receiver,
        env,
        typeEnv,
        adts,
        types,
        facts,
        warnings,
        diagnostics,
        provenance,
      );
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
      const receiver = inferExpr(
        expr.receiver,
        env,
        typeEnv,
        adts,
        types,
        facts,
        warnings,
        diagnostics,
        provenance,
      );
      const args: Ty[] = new Array(expr.args.length);
      for (const [index, arg] of expr.args.entries()) {
        if (arg.kind === "Lambda") continue;
        args[index] = inferExpr(
          arg,
          env,
          typeEnv,
          adts,
          types,
          facts,
          warnings,
          diagnostics,
          provenance,
        );
      }
      for (const [index, arg] of expr.args.entries()) {
        if (arg.kind !== "Lambda") continue;
        const hints = ffiCallbackParamHints(typeEnv, receiver, expr.path, index, args);
        args[index] = inferLambdaTy(
          arg,
          env,
          typeEnv,
          adts,
          types,
          facts,
          warnings,
          diagnostics,
          provenance,
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
    case "Lambda":
      t = inferLambdaTy(
        expr,
        env,
        typeEnv,
        adts,
        types,
        facts,
        warnings,
        diagnostics,
        provenance,
      );
      break;
    case "Call":
      t = inferCall(
        expr,
        env,
        typeEnv,
        adts,
        types,
        facts,
        warnings,
        diagnostics,
        provenance,
      );
      break;
    case "If":
      constrain(
        inferExpr(
          expr.cond,
          env,
          typeEnv,
          adts,
          types,
          facts,
          warnings,
          diagnostics,
          provenance,
        ),
        BoolTy,
      );
      t = inferExpr(
        expr.thenExpr,
        env,
        typeEnv,
        adts,
        types,
        facts,
        warnings,
        diagnostics,
        provenance,
      );
      constrain(
        t,
        inferExpr(
          expr.elseExpr,
          env,
          typeEnv,
          adts,
          types,
          facts,
          warnings,
          diagnostics,
          provenance,
        ),
      );
      break;
    case "Match":
      t = inferMatch(
        expr,
        env,
        typeEnv,
        adts,
        types,
        facts,
        warnings,
        diagnostics,
        provenance,
      );
      break;
    case "Panic":
      constrain(
        inferExpr(
          expr.message,
          env,
          typeEnv,
          adts,
          types,
          facts,
          warnings,
          diagnostics,
          provenance,
        ),
        StringTy,
      );
      t = fresh();
      break;
    case "Block":
      t = inferBlock(
        expr,
        env,
        typeEnv,
        adts,
        types,
        facts,
        warnings,
        diagnostics,
        provenance,
      );
      break;
    case "Binary":
      t = inferBinary(
        expr,
        env,
        typeEnv,
        adts,
        types,
        facts,
        warnings,
        diagnostics,
        provenance,
      );
      break;
    case "Unary":
      if (expr.op === "-") {
        constrain(
          inferExpr(
            expr.value,
            env,
            typeEnv,
            adts,
            types,
            facts,
            warnings,
            diagnostics,
            provenance,
          ),
          NumberTy,
        );
        t = NumberTy;
      } else {
        constrain(
          inferExpr(
            expr.value,
            env,
            typeEnv,
            adts,
            types,
            facts,
            warnings,
            diagnostics,
            provenance,
          ),
          BoolTy,
        );
        t = BoolTy;
      }
      break;
    case "Pipe":
      t = inferPipe(
        expr,
        env,
        typeEnv,
        adts,
        types,
        facts,
        warnings,
        diagnostics,
        provenance,
      );
      break;
  }
  types.set(expr, t);
  return t;
}
