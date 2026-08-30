import type { TypeExpr } from "../ast.ts";
import type { AstNode } from "../source.ts";
import { type Ty, typeFromAst } from "../types.ts";
import type { InferContext } from "./context.ts";
import type { TypeFacts } from "./type_facts.ts";
import {
  recordTypeExpressionFact,
  recordTypeReferenceFact,
  recordTypeVariableFact,
} from "./type_facts.ts";

/**
 * Elaborate one general expression/pattern constraint.
 *
 * A type-variable name introduced here is scoped to this constraint site. Existing
 * let-group and lambda-signature annotations deliberately keep their wider shared
 * scopes in their owning elaborators.
 */
export function elaborateConstraint(
  annotation: TypeExpr,
  context: Pick<InferContext, "typeEnv" | "strEnv"> & { facts?: TypeFacts },
  region?: AstNode,
): Ty {
  const { typeEnv, strEnv, facts } = context;
  return typeFromAst(annotation, typeEnv, new Map(), {
    strEnv,
    onResolveName: facts
      ? (expression, resolved, qualifier) =>
        recordTypeReferenceFact(facts, expression, resolved, qualifier)
      : undefined,
    onResolveType: facts
      ? (expression, type) => recordTypeExpressionFact(facts, expression, type)
      : undefined,
    onResolveVariable: facts
      ? (expression, type) => recordTypeVariableFact(facts, expression, type, region)
      : undefined,
  });
}
