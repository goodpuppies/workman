import {
  type DeferFfiConstraint,
  eq,
  prune,
  solveConstraints,
  tuple,
  type Ty,
  type UnifyBind,
  VoidTy,
} from "../types.ts";

export function constrain(
  left: Ty,
  right: Ty,
  onBind?: UnifyBind,
  onDeferFfi?: DeferFfiConstraint,
) {
  const constraints = [eq(left, right)];
  solveConstraints(constraints, onBind, onDeferFfi);
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
