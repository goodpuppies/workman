import type { Expr } from "../ast.ts";
import type {
  GpuOperationObligation,
  GpuOperationRow,
  GpuOperationShape,
} from "../infer/type_facts.ts";
import { freshenTypeVars, NumberTy, prune, show, tuple, type Ty, unify } from "../types.ts";

export type GpuTemplateCall = {
  occurrence: Extract<Expr, { kind: "Call" }>;
  targetBindingId?: number;
  targetFunctionParam?: number;
  args: Ty[];
  result: Ty;
  staticFunctionArgs: (number | undefined)[];
};

export type GpuFunctionTemplate = {
  bindingId: number;
  name: string;
  params: Ty[];
  result: Ty;
  occurrenceTypes: ReadonlyMap<object, Ty>;
  equalities?: ReadonlyArray<readonly [Ty, Ty]>;
  operations: GpuOperationObligation[];
  calls: GpuTemplateCall[];
};

export type GpuSpecializedOperation = {
  occurrence: Expr;
  identity: string;
  row: GpuOperationRow;
};

export type GpuFunctionSpecialization = {
  id: number;
  seedKey: string;
  template: GpuFunctionTemplate;
  params: Ty[];
  result: Ty;
  occurrenceTypes: Map<object, Ty>;
  operations: GpuSpecializedOperation[];
  callTargets: Map<Expr, number>;
  staticFunctionParams: (number | undefined)[];
  state: "visiting" | "finalized";
};

export class GpuSpecializationError extends Error {
  constructor(
    readonly code:
      | "gpu.specialization.seed"
      | "gpu.operation.overload"
      | "gpu.operation.ambiguous"
      | "gpu.operation.unresolved"
      | "gpu.call.unresolved"
      | "gpu.higher-order.unsupported"
      | "gpu.type.unresolved",
    readonly occurrence: Expr | undefined,
    message: string,
  ) {
    super(message);
    this.name = "GpuSpecializationError";
  }
}

export function specializeGpuTemplates(input: {
  rootBindingId: number;
  rootArgs: Ty[];
  rootResult: Ty;
  templates: ReadonlyMap<number, GpuFunctionTemplate>;
  freshenCallSites?: boolean;
}): GpuFunctionSpecialization[] {
  const state = new SpecializationState(input.templates, input.freshenCallSites ?? false);
  const root = state.instantiate(input.rootBindingId, input.rootArgs, input.rootResult, [], [], "");
  return canonicalizeInstanceOrder(root, state.instances);
}

function canonicalizeInstanceOrder(
  root: GpuFunctionSpecialization,
  instances: GpuFunctionSpecialization[],
): GpuFunctionSpecialization[] {
  const ordered = [
    root,
    ...instances.filter((instance) => instance !== root).sort(compareSpecializations),
  ];
  const newIdByOldId = new Map(ordered.map((instance, id) => [instance.id, id]));
  for (const [id, instance] of ordered.entries()) {
    instance.id = id;
    for (const [occurrence, oldTarget] of instance.callTargets) {
      instance.callTargets.set(occurrence, newIdByOldId.get(oldTarget)!);
    }
  }
  return ordered;
}

function compareSpecializations(
  left: GpuFunctionSpecialization,
  right: GpuFunctionSpecialization,
): number {
  const bindingOrder = left.template.bindingId - right.template.bindingId;
  if (bindingOrder !== 0) return bindingOrder;
  const leftKey = left.params.map(typeOrderKey).join(",") +
    `|${left.staticFunctionParams.join(",")}`;
  const rightKey = right.params.map(typeOrderKey).join(",") +
    `|${right.staticFunctionParams.join(",")}`;
  return leftKey.localeCompare(rightKey);
}

function typeOrderKey(type: Ty): string {
  const target = prune(type);
  if (target.tag === "prim") return `0:${target.name}`;
  if (target.tag === "tuple") {
    return `1:${target.items.length}:${target.items.map(typeOrderKey).join(",")}`;
  }
  if (target.tag === "named") {
    return `2:${target.name}:${target.args.map(typeOrderKey).join(",")}`;
  }
  if (target.tag === "struct") return `3:${canonicalGpuType(target)}`;
  if (target.tag === "fn") return `4:${canonicalGpuType(target)}`;
  return `5:${canonicalGpuType(target)}`;
}

class SpecializationState {
  readonly instances: GpuFunctionSpecialization[] = [];
  readonly #bySeed = new Map<string, GpuFunctionSpecialization>();

  constructor(
    readonly templates: ReadonlyMap<number, GpuFunctionTemplate>,
    readonly freshenCallSites: boolean,
  ) {}

  instantiate(
    bindingId: number,
    requestedArgs: Ty[],
    requestedResult: Ty,
    stack: number[],
    requestedStaticFunctions: (number | undefined)[],
    callSiteKey: string,
  ): GpuFunctionSpecialization {
    const template = this.templates.get(bindingId);
    if (!template) {
      throw new GpuSpecializationError(
        "gpu.call.unresolved",
        undefined,
        `missing GPU helper template for binding ${bindingId}`,
      );
    }
    const dynamicFunctionIndex = requestedArgs.findIndex((type, index) =>
      prune(type).tag === "fn" && requestedStaticFunctions[index] === undefined
    );
    if (dynamicFunctionIndex >= 0) {
      throw new GpuSpecializationError(
        "gpu.higher-order.unsupported",
        undefined,
        `${template.name} receives a runtime function value at argument ${
          dynamicFunctionIndex + 1
        }; a statically known GPU-local helper is required`,
      );
    }
    const argKey = requestedArgs.map((type, index) => {
      const identity = requestedStaticFunctions[index];
      return identity === undefined ? canonicalGpuType(type) : `fn#${identity}`;
    }).join(",");
    if (
      requestedArgs.some((type, index) =>
        requestedStaticFunctions[index] === undefined && canonicalGpuType(type).includes("?")
      )
    ) {
      throw new GpuSpecializationError(
        "gpu.specialization.seed",
        undefined,
        `cannot specialize ${template.name} from unresolved arguments (${argKey})`,
      );
    }
    if (this.freshenCallSites && stack.includes(bindingId)) {
      const active = this.instances.findLast((instance) =>
        instance.template.bindingId === bindingId && instance.state === "visiting"
      );
      if (!active) {
        throw new GpuSpecializationError(
          "gpu.specialization.seed",
          undefined,
          `recursive specialization for ${template.name} has no active instance`,
        );
      }
      active.params.forEach((param, index) => unify(param, requestedArgs[index]));
      unify(active.result, requestedResult);
      return active;
    }
    const seedKey = `${bindingId}<${argKey}>${this.freshenCallSites ? `@${callSiteKey}` : ""}`;
    const existing = this.#bySeed.get(seedKey);
    if (existing) {
      unify(existing.result, requestedResult);
      return existing;
    }
    if (stack.includes(bindingId)) {
      throw new GpuSpecializationError(
        "gpu.specialization.seed",
        undefined,
        `polymorphic recursion is not supported for ${template.name}`,
      );
    }

    const freshen = new Map<number, Ty>();
    const clone = (type: Ty) => freshenTypeVars(type, new Map(), freshen);
    const params = template.params.map(clone);
    const result = clone(template.result);
    if (params.length !== requestedArgs.length) {
      throw new GpuSpecializationError(
        "gpu.specialization.seed",
        undefined,
        `${template.name} expected ${params.length} arguments, got ${requestedArgs.length}`,
      );
    }
    params.forEach((param, index) => unify(param, requestedArgs[index]));
    unify(result, requestedResult);

    const occurrenceTypes = new Map<object, Ty>();
    for (const [occurrence, type] of template.occurrenceTypes) {
      occurrenceTypes.set(occurrence, clone(type));
    }
    for (const [left, right] of template.equalities ?? []) unify(clone(left), clone(right));
    const operations = template.operations.map((operation) => ({
      source: operation,
      args: operation.args.map(clone),
      result: clone(operation.result),
      selected: undefined as GpuOperationRow | undefined,
    }));
    const calls = template.calls.map((call) => ({
      source: call,
      args: call.args.map(clone),
      result: clone(call.result),
      target: undefined as GpuFunctionSpecialization | undefined,
    }));
    const instance: GpuFunctionSpecialization = {
      id: this.instances.length,
      seedKey,
      template,
      params,
      result,
      occurrenceTypes,
      operations: [],
      callTargets: new Map(),
      staticFunctionParams: requestedArgs.map((_arg, index) => requestedStaticFunctions[index]),
      state: "visiting",
    };
    this.instances.push(instance);
    this.#bySeed.set(seedKey, instance);
    const specializationPath = [...stack, bindingId].map((id) =>
      this.templates.get(id)?.name ?? `binding#${id}`
    ).join(" -> ");

    let previous = "";
    for (;;) {
      for (const operation of operations) {
        if (operation.selected) continue;
        const determining = operation.source.determiningArgs.map((index) =>
          gpuShape(operation.args[index])
        );
        const unsupportedIndex = operation.source.determiningArgs.findIndex((argIndex, index) =>
          determining[index] === undefined && isConcreteGpuType(operation.args[argIndex])
        );
        if (unsupportedIndex >= 0) {
          throw new GpuSpecializationError(
            "gpu.operation.overload",
            operation.source.occurrence,
            `${operation.source.identity} has no shader row for ${
              canonicalGpuType(operation.args[operation.source.determiningArgs[unsupportedIndex]])
            }; specialization path: ${specializationPath}`,
          );
        }
        if (determining.some((shape) => shape === undefined)) continue;
        const rows = operation.source.rows.filter((row) =>
          operation.source.determiningArgs.every((argIndex, index) =>
            row.args[argIndex] === determining[index]
          )
        );
        if (rows.length === 0) {
          throw new GpuSpecializationError(
            "gpu.operation.overload",
            operation.source.occurrence,
            `${operation.source.identity} has no exact row for (${
              operation.args.map((arg) => gpuShape(arg) ?? show(arg)).join(", ")
            }); specialization path: ${specializationPath}`,
          );
        }
        const signatures = new Map(
          rows.map((row) => [`${row.args.join(",")}->${row.result}`, row]),
        );
        if (signatures.size !== 1) continue;
        const row = [...signatures.values()].sort((left, right) => left.id - right.id)[0];
        row.args.forEach((shape, index) => unify(operation.args[index], typeForShape(shape)));
        unify(operation.result, typeForShape(row.result));
        operation.selected = row;
      }

      for (const call of calls) {
        if (call.target) continue;
        const dynamicFunctionIndex = call.args.findIndex((arg, index) =>
          prune(arg).tag === "fn" && call.source.staticFunctionArgs[index] === undefined
        );
        if (dynamicFunctionIndex >= 0) {
          const targetName = call.source.targetBindingId === undefined
            ? "GPU helper"
            : this.templates.get(call.source.targetBindingId)?.name ?? "GPU helper";
          throw new GpuSpecializationError(
            "gpu.higher-order.unsupported",
            call.source.occurrence,
            `${targetName} receives a runtime function value at argument ${
              dynamicFunctionIndex + 1
            }; a statically known GPU-local helper is required`,
          );
        }
        if (
          call.args.some((arg, index) =>
            call.source.staticFunctionArgs[index] === undefined && !isConcreteGpuType(arg)
          )
        ) continue;
        const targetBindingId = call.source.targetBindingId ??
          (call.source.targetFunctionParam === undefined
            ? undefined
            : instance.staticFunctionParams[call.source.targetFunctionParam]);
        if (targetBindingId === undefined) {
          throw new GpuSpecializationError(
            "gpu.call.unresolved",
            call.source.occurrence,
            "higher-order GPU call has no static function identity",
          );
        }
        const target = this.instantiate(
          targetBindingId,
          call.args,
          call.result,
          [...stack, bindingId],
          call.source.staticFunctionArgs,
          `${instance.id}:${call.source.occurrence.node?.id ?? "call"}`,
        );
        call.target = target;
        instance.callTargets.set(call.source.occurrence, target.id);
      }

      const fingerprint = specializationFingerprint(
        params,
        result,
        occurrenceTypes,
        operations,
        calls,
      );
      if (fingerprint === previous) break;
      previous = fingerprint;
    }

    const unresolvedOperation = operations.find((operation) => !operation.selected);
    if (unresolvedOperation) {
      const determining = unresolvedOperation.source.determiningArgs.map((index) =>
        gpuShape(unresolvedOperation.args[index])
      );
      const concreteCandidates = determining.every((shape) => shape !== undefined)
        ? unresolvedOperation.source.rows.filter((row) =>
          unresolvedOperation.source.determiningArgs.every((argIndex, index) =>
            row.args[argIndex] === determining[index]
          )
        )
        : [];
      const signatures = new Set(
        concreteCandidates.map((row) => `${row.args.join(",")}->${row.result}`),
      );
      if (signatures.size > 1) {
        throw new GpuSpecializationError(
          "gpu.operation.ambiguous",
          unresolvedOperation.source.occurrence,
          `${unresolvedOperation.source.identity} has multiple exact rows for ${
            determining.join(", ")
          }: ${[...signatures].sort().join(" or ")}; specialization path: ${specializationPath}`,
        );
      }
      throw new GpuSpecializationError(
        "gpu.operation.unresolved",
        unresolvedOperation.source.occurrence,
        `${unresolvedOperation.source.identity} remains unresolved for ${template.name}<${argKey}>; specialization path: ${specializationPath}`,
      );
    }
    const unresolvedCall = calls.find((call) => !call.target);
    if (unresolvedCall) {
      throw new GpuSpecializationError(
        "gpu.call.unresolved",
        unresolvedCall.source.occurrence,
        `call remains unresolved in ${template.name}<${argKey}>; specialization path: ${specializationPath}`,
      );
    }
    if (prune(result).tag === "fn") {
      throw new GpuSpecializationError(
        "gpu.higher-order.unsupported",
        undefined,
        `${template.name}<${argKey}> returns a function value that cannot reach shader IR`,
      );
    }
    if (!isConcreteGpuType(result)) {
      throw new GpuSpecializationError(
        "gpu.type.unresolved",
        undefined,
        `${template.name}<${argKey}> has unresolved result ${show(result)}`,
      );
    }
    instance.operations = operations.map((operation) => ({
      occurrence: operation.source.occurrence,
      identity: operation.source.identity,
      row: operation.selected!,
    }));
    instance.state = "finalized";
    return instance;
  }
}

function specializationFingerprint(
  params: Ty[],
  result: Ty,
  occurrences: ReadonlyMap<object, Ty>,
  operations: { selected?: GpuOperationRow }[],
  calls: { target?: GpuFunctionSpecialization }[],
): string {
  return [
    params.map(canonicalGpuType).join(","),
    canonicalGpuType(result),
    [...occurrences.values()].map(canonicalGpuType).join(";"),
    operations.map((item) => item.selected?.id ?? "?").join(","),
    calls.map((item) => item.target?.id ?? "?").join(","),
  ].join("|");
}

export function canonicalGpuType(type: Ty): string {
  const target = prune(type);
  if (target.tag === "var") return `?${target.id}`;
  if (target.tag === "prim") return target.name;
  if (target.tag === "tuple") return `(${target.items.map(canonicalGpuType).join(",")})`;
  if (target.tag === "fn") {
    return `(${target.params.map(canonicalGpuType).join(",")})->${canonicalGpuType(target.result)}`;
  }
  if (target.tag === "named") {
    return `${target.name}<${target.args.map(canonicalGpuType).join(",")}>`;
  }
  if (target.tag === "struct") {
    return `{${
      target.fields.map((field) => `${field.name}:${canonicalGpuType(field.type)}`).join(",")
    }}`;
  }
  return "?ffi";
}

function isConcreteGpuType(type: Ty): boolean {
  return !canonicalGpuType(type).includes("?");
}

function gpuShape(type: Ty): GpuOperationShape | undefined {
  const target = prune(type);
  if (target.tag === "prim" && target.name === "Number") return "f32";
  if (
    target.tag === "tuple" && target.items.length >= 2 && target.items.length <= 4 &&
    target.items.every((item) => {
      const component = prune(item);
      return component.tag === "prim" && component.name === "Number";
    })
  ) {
    return `f32x${target.items.length}` as GpuOperationShape;
  }
  return undefined;
}

function typeForShape(shape: GpuOperationShape): Ty {
  if (shape === "f32") return NumberTy;
  return tuple(Array.from({ length: Number(shape.at(-1)) }, () => NumberTy));
}
