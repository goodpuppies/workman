import type { InvocationPlan } from "../pipe_elaboration.ts";
import type { Ty } from "../types.ts";
import type { InferContext } from "./context.ts";
import { inferGpuInvocation } from "./gpu_dialect.ts";

/** Resolve invocation forms whose callable set is supplied by the active language domain. */
export function inferDomainInvocation(
  invocation: InvocationPlan,
  context: InferContext,
): Ty | undefined {
  return context.dialect.domain === "gpu" ? inferGpuInvocation(invocation, context) : undefined;
}
