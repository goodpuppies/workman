import type { Expr } from "../ast.ts";
import type { FrontendDiagnostic } from "../diagnostics.ts";
import type { Env, Ty, TypeDeclInfo, TypeEnv } from "../types.ts";
import type { TypeProvenance } from "./provenance.ts";
import type { TypeFacts } from "./type_facts.ts";

export type TypingDialect = {
  domain: "host" | "gpu";
  inferProjection?(
    expr: Extract<Expr, { kind: "Var" }>,
    context: InferContext,
  ): Ty | undefined;
  inferBinary?(
    expr: Extract<Expr, { kind: "Binary" }>,
    left: Ty,
    right: Ty,
    context: InferContext,
  ): Ty | undefined;
};

export const hostTypingDialect: TypingDialect = { domain: "host" };

export type InferContext = {
  env: Env;
  typeEnv: TypeEnv;
  adts: Map<number, TypeDeclInfo>;
  types: Map<Expr, Ty>;
  facts: TypeFacts;
  warnings: string[];
  diagnostics: FrontendDiagnostic[];
  provenance: TypeProvenance;
  dialect: TypingDialect;
};

export function deriveInferContext(
  context: InferContext,
  changes: Partial<Pick<InferContext, "env" | "typeEnv" | "dialect">>,
): InferContext {
  return { ...context, ...changes };
}
