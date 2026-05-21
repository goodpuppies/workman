import { eq, prune, solveConstraints, tuple, type Ty, VoidTy } from "../types.ts";

export function constrain(left: Ty, right: Ty) {
  const constraints = [eq(left, right)];
  solveConstraints(constraints);
}

export function callArg(items: Ty[]): Ty {
  if (items.length === 0) return VoidTy;
  if (items.length === 1) return items[0];
  return tuple(items);
}

export function expandCallArg(arg: Ty): Ty[] {
  const resolved = prune(arg);
  if (resolved.tag === "prim" && resolved.name === "Void") return [];
  if (resolved.tag === "tuple") return resolved.items;
  return [resolved];
}
