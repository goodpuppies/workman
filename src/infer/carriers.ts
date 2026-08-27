/**
 * Carrier registration and peeling for primitive operator lifting.
 *
 * `Ok(2) + 3` type-checks `+` against the payload and rewraps the answer in the
 * carrier. Nothing about that rule is specific to `Result`: it needs a type that
 * can hold a payload, a way to inject a pure operand, and a way to combine two
 * carriers. A module supplies those by exporting `carrier` alongside top-level
 * `succeed`, `map`, and `map2`, which registers the type `succeed` returns.
 *
 * `Result` keeps its own lowering path because the basis binds `Result` as a
 * value; a user carrier is reached through its declaring module instead.
 */
import type { InferResult } from "../infer.ts";
import {
  type CarrierInfo,
  instantiate,
  named,
  prune,
  type Ty,
  type TypeEnv,
  type TypeInfo,
  typeInfoById,
  typeInfoByName,
} from "../types.ts";

/** Members a carrier module must export for operator lifting to reach it. */
export const CARRIER_MEMBERS = ["succeed", "map", "map2"] as const;

/**
 * One carrier layer stripped off an operand.
 *
 * `payload` is what the operator is type-checked against; `rewrap` puts the
 * operator's answer back. A monomorphic carrier has no payload argument, so its
 * `rewrap` constrains the answer to the declared payload type instead.
 */
export type CarrierPeel = {
  info: TypeInfo;
  registration: CarrierInfo;
  /** Type arguments of the peeled occurrence; empty for a monomorphic carrier. */
  args: Ty[];
  payload: Ty;
};

/**
 * Register the exporting module's carrier type, if it declared one.
 *
 * Called once per module after inference, so a module's own declarations do not
 * yet see its carrier. That matches how a carrier module is written: it defines
 * the payload arithmetic by hand and hands the operators to its consumers.
 */
export function registerModuleCarrier(result: InferResult, modulePath: string): void {
  const exports = result.exportedStructure.valEnv;
  if (!exports.has("carrier")) return;
  if (!CARRIER_MEMBERS.every((member) => exports.has(member))) return;
  const succeed = exports.get("succeed");
  if (!succeed) return;
  const signature = prune(instantiate(succeed));
  if (signature.tag !== "fn" || signature.params.length !== 1) return;
  const carried = prune(signature.result);
  if (carried.tag !== "named") return;
  const info = typeInfoById(result.typeEnv, carried.id);
  // A basis carrier is reached as a bare value and registered directly, so a
  // module re-exporting its operations must not claim it.
  if (!info || info.basis || info.carrier) return;
  const payload = prune(signature.params[0]);
  const payloadIndex = carried.args.findIndex((arg) => prune(arg) === payload);
  info.carrier = payloadIndex >= 0
    ? { modulePath, payloadIndex }
    : { modulePath, payloadType: payload };
}

/**
 * Basis carriers, which hold their payload first and are reached as bare values
 * rather than through a declaring module.
 */
const BASIS_CARRIERS = ["Result", "Task"];

/**
 * The carrier registration for `info`, memoizing the basis ones.
 *
 * `Result` and `Task` are carriers without a `carrier` export because the basis
 * binds them directly; every other carrier registers through its module.
 */
function registrationOf(info: TypeInfo, typeEnv: TypeEnv): CarrierInfo | undefined {
  if (info.carrier) return info.carrier;
  const basis = BASIS_CARRIERS.some((name) => typeInfoByName(typeEnv, name)?.id === info.id);
  if (!basis) return undefined;
  info.carrier = { payloadIndex: 0 };
  return info.carrier;
}

/** The registered carrier of `type`'s head constructor, or undefined. */
export function carrierInfo(type: Ty | undefined, typeEnv: TypeEnv): TypeInfo | undefined {
  if (!type) return undefined;
  const resolved = prune(type);
  if (resolved.tag !== "named") return undefined;
  const info = typeInfoById(typeEnv, resolved.id);
  return info && registrationOf(info, typeEnv) ? info : undefined;
}

/** Strip one carrier layer off `type`, or undefined when it is not a carrier. */
export function peelCarrier(type: Ty, typeEnv: TypeEnv): CarrierPeel | undefined {
  const info = carrierInfo(type, typeEnv);
  if (!info) return undefined;
  const resolved = prune(type);
  if (resolved.tag !== "named") return undefined;
  const registration = registrationOf(info, typeEnv)!;
  if (registration.payloadIndex === undefined) {
    return { info, registration, args: [], payload: registration.payloadType! };
  }
  const payload = resolved.args[registration.payloadIndex];
  if (!payload) return undefined;
  return { info, registration, args: resolved.args, payload };
}

/** Rebuild a peeled carrier around the operator's answer. */
export function rewrapCarrier(peel: CarrierPeel, payload: Ty): Ty {
  if (peel.registration.payloadIndex === undefined) return named(peel.info, []);
  const args = [...peel.args];
  args[peel.registration.payloadIndex] = payload;
  return named(peel.info, args);
}

/** Type arguments a carrier threads unchanged, such as `Result`'s error type. */
export function carrierContext(peel: CarrierPeel): Ty[] {
  const { payloadIndex } = peel.registration;
  return peel.args.filter((_, index) => index !== payloadIndex);
}
