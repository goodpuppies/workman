import type { Expr } from "../ast.ts";
import { diagnosticError } from "../diagnostics.ts";
import { isGpuLambda } from "../directives.ts";
import { fn, prune, quoteType, tuple, type Ty, typeFromAst, type TypeVarScope } from "../types.ts";
import { inferExpr } from "./expr.ts";
import { deriveInferContext, type InferContext, type TypingDialect } from "./context.ts";
import { gpuTypingDialect } from "./gpu_dialect.ts";
import { inferParam } from "./expr_flow.ts";
import { patternBinders } from "./patterns.ts";
import { constrainAt } from "./provenance.ts";
import { callArg } from "./shared.ts";
import type { TypeFacts } from "./type_facts.ts";

export function inferLambdaTy(
  expr: Extract<Expr, { kind: "Lambda" }>,
  context: InferContext,
  paramHints?: Ty[],
): Ty {
  const { env, typeEnv, adts, types, facts, provenance } = context;
  const local = new Map(env);
  const annotationVars: TypeVarScope = new Map();
  const binders = new Set<string>();
  const annotations = expr.params.map((param) =>
    param.annotation ? typeFromAst(param.annotation, typeEnv, annotationVars) : undefined
  );
  const params = expr.params.map((p) => inferParam(p, local, typeEnv, adts, binders, facts));
  paramHints?.forEach((hint, index) => {
    if (index < params.length) {
      constrainAt(params[index], hint, expr.params[index], undefined, [], provenance, {
        message: "parameter hint",
        node: expr.params[index].node,
        span: expr.params[index].node?.span,
      }, {
        premise: {
          rule: "InferLambda.ParameterHint",
          role: "parameter matches contextual hint",
          subject: "lambda parameter",
          leftRole: "parameter",
          rightRole: "hint",
        },
      });
    }
  });
  const body = inferExpr(
    expr.body,
    deriveInferContext(context, {
      env: local,
      dialect: lambdaTypingDialect(expr, context.dialect),
    }),
  );
  const signatureParams = [...params];
  expr.params.forEach((param, index) => {
    const annotated = annotations[index];
    if (!annotated) return;
    const obligation = ffiReceiverObligationForParam(
      expr.body,
      patternBinders(param.pattern),
      facts,
    );
    if (obligation) {
      throw diagnosticError(
        new Error(
          `type annotation ${
            quoteType(annotated)
          } cannot resolve unresolved JS FFI ${obligation.kind} ${obligation.path}; annotations are checked after inference and are not JS receiver evidence`,
        ),
        param.node,
      );
    }
    constrainAt(
      params[index],
      annotated,
      param,
      () => `type mismatch ${quoteType(annotated)}, got ${quoteType(params[index])}`,
      [],
      provenance,
      {
        message: "parameter annotation",
        node: param.node,
        span: param.node?.span,
      },
      {
        premise: {
          rule: "InferAnnotation.ParameterMatchesAnnotation",
          role: "parameter matches annotation",
          subject: "parameter annotation",
          leftRole: "parameter",
          rightRole: "annotation",
        },
      },
    );
    signatureParams[index] = annotated;
  });
  const replacements = new Map<number, Ty>();
  params.forEach((param, index) => {
    collectParamReplacements(param, signatureParams[index], replacements);
  });
  const t = fn(
    [callArg(signatureParams)],
    replaceParamOccurrences(body, replacements),
  );
  types.set(expr, t);
  return t;
}

export function lambdaTypingDialect(
  lambda: Extract<Expr, { kind: "Lambda" }>,
  parent: TypingDialect,
): TypingDialect {
  return isGpuLambda(lambda) ? gpuTypingDialect : parent;
}

function ffiReceiverObligationForParam(
  expr: Expr,
  names: string[],
  facts: TypeFacts,
): { kind: "property" | "method"; path: string } | undefined {
  if (names.length === 0) return undefined;
  const bound = new Set(names);
  let found: { kind: "property" | "method"; path: string } | undefined;
  const visit = (node: Expr, shadowed = new Set<string>()) => {
    if (found) return;
    if (
      (node.kind === "FfiGet" || node.kind === "FfiCall") &&
      node.receiver.kind === "Var" &&
      bound.has(node.receiver.name) &&
      !shadowed.has(node.receiver.name) &&
      facts.expressions.get(node)?.subject === "ffi-obligation"
    ) {
      found = {
        kind: node.kind === "FfiGet" ? "property" : "method",
        path: node.path.join("."),
      };
      return;
    }
    switch (node.kind) {
      case "Tuple":
      case "JsonArray":
        node.items.forEach((item) => visit(item, shadowed));
        return;
      case "Record":
      case "JsonObject":
        node.fields.forEach((field) => visit(field.value, shadowed));
        return;
      case "FfiGet":
        visit(node.receiver, shadowed);
        return;
      case "FfiCall":
        visit(node.receiver, shadowed);
        node.args.forEach((arg) => visit(arg, shadowed));
        return;
      case "FfiBindingCall":
        node.args.forEach((arg) => visit(arg, shadowed));
        return;
      case "Lambda": {
        const next = new Set(shadowed);
        node.params.flatMap((param) => patternBinders(param.pattern)).forEach((name) =>
          next.add(name)
        );
        visit(node.body, next);
        return;
      }
      case "Call":
        if (
          "receiver" in node &&
          "path" in node &&
          Array.isArray(node.path)
        ) {
          const receiver = node.receiver as Partial<Extract<Expr, { kind: "Var" }>>;
          if (
            receiver.kind === "Var" &&
            typeof receiver.name === "string" &&
            bound.has(receiver.name) &&
            !shadowed.has(receiver.name)
          ) {
            found = {
              kind: "method",
              path: node.path.join("."),
            };
            return;
          }
        }
        visit(node.callee, shadowed);
        node.args.forEach((arg) => visit(arg, shadowed));
        return;
      case "If":
        visit(node.cond, shadowed);
        visit(node.thenExpr, shadowed);
        visit(node.elseExpr, shadowed);
        return;
      case "Match":
        visit(node.value, shadowed);
        node.arms.forEach((arm) => visit(arm.body, shadowed));
        return;
      case "Panic":
        visit(node.message, shadowed);
        return;
      case "Block":
        node.items.forEach((item) => {
          if (
            item.kind !== "ImportDecl" && item.kind !== "JsImportDecl" &&
            item.kind !== "ForeignTypeDecl" && item.kind !== "RecordDecl" &&
            item.kind !== "TypeDecl" && item.kind !== "LetDecl"
          ) {
            visit(item, shadowed);
          }
        });
        visit(node.result, shadowed);
        return;
      case "Binary":
        visit(node.left, shadowed);
        visit(node.right, shadowed);
        return;
      case "Unary":
        visit(node.value, shadowed);
        return;
      case "Pipe":
        visit(node.left, shadowed);
        visit(node.right, shadowed);
        return;
      case "Int":
      case "Float":
      case "String":
      case "Bool":
      case "Void":
      case "Var":
        return;
    }
  };
  visit(expr);
  return found;
}

function collectParamReplacements(source: Ty, replacement: Ty, out: Map<number, Ty>) {
  const resolved = prune(source);
  if (resolved.tag === "var") {
    out.set(resolved.id, replacement);
    return;
  }
  const target = prune(replacement);
  if (
    resolved.tag === "tuple" && target.tag === "tuple" &&
    resolved.items.length === target.items.length
  ) {
    resolved.items.forEach((item, index) =>
      collectParamReplacements(item, target.items[index], out)
    );
  }
}

function replaceParamOccurrences(type: Ty, replacements: Map<number, Ty>): Ty {
  const resolved = prune(type);
  if (resolved.tag === "var") return replacements.get(resolved.id) ?? resolved;
  if (resolved.tag === "fn") {
    return fn(
      resolved.params.map((param) => replaceParamOccurrences(param, replacements)),
      replaceParamOccurrences(resolved.result, replacements),
    );
  }
  if (resolved.tag === "tuple") {
    return tuple(resolved.items.map((item) => replaceParamOccurrences(item, replacements)));
  }
  if (resolved.tag === "struct") {
    return {
      ...resolved,
      fields: resolved.fields.map((field) => ({
        ...field,
        type: replaceParamOccurrences(field.type, replacements),
      })),
    };
  }
  if (resolved.tag === "named") {
    return {
      ...resolved,
      args: resolved.args.map((arg) => replaceParamOccurrences(arg, replacements)),
    };
  }
  return resolved;
}
