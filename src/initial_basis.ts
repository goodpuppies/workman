import type { TypeDeclInfo } from "./types.ts";
import {
  baseAdts,
  baseEnv,
  baseTypeEnv,
  basisOperatorEnv,
  type BasisOptions,
  PERVASIVE_BINDINGS,
} from "./types_basis.ts";
import {
  basisStrEnv,
  bindType,
  bindValue,
  type StaticEnv,
  staticEnv,
} from "./infer/environment.ts";
import { cloneTypeEnv, type Env, registerTypeInfo, type TypeEnv } from "./types.ts";
import {
  BASIS_INTRINSICS,
  BASIS_OPERATORS,
  BASIS_TYPES,
  BASIS_VALUES,
  type BasisConstructorDescriptor,
  type BasisIntrinsicDescriptor,
  type BasisOperatorDescriptor,
  type BasisTypeDescriptor,
  type BasisValueDescriptor,
} from "./basis_manifest.ts";
import { basisValueId } from "./compiler_semantics.ts";

export type BasisProfileName = "kernel" | "default";

export type BasisProfile = Readonly<{
  name: BasisProfileName;
  includeAlgebraicBasis: boolean;
}>;

export const BASIS_PROFILES: Readonly<Record<BasisProfileName, BasisProfile>> = Object.freeze({
  kernel: Object.freeze({ name: "kernel", includeAlgebraicBasis: false }),
  default: Object.freeze({ name: "default", includeAlgebraicBasis: true }),
});

export type InitialBasisInstance = {
  environment: StaticEnv;
  adts: Map<number, TypeDeclInfo>;
  operators: Env;
};

declare const basisGenerationBrand: unique symbol;
export type BasisGeneration = object & {
  readonly [basisGenerationBrand]: true;
};

/**
 * Immutable compiler artifact. The captured definition is private; callers receive a fresh working
 * instance, so declaration elaboration cannot mutate another module's initial basis.
 */
export type InitialBasis = Readonly<{
  profile: BasisProfile;
  generation: BasisGeneration;
  pervasiveBindings: readonly import("./types_basis.ts").PervasiveBinding[];
  facts: BasisCompilerFacts;
  instantiate(): InitialBasisInstance;
}>;

export type BasisConstructorFact = Readonly<{
  typeName: string;
  name: string;
  id: number;
  status: "constructor";
  runtimeName: string;
}>;

export type BasisCompilerFacts = Readonly<{
  types: readonly BasisTypeDescriptor[];
  constructors: readonly BasisConstructorFact[];
  operators: readonly BasisOperatorDescriptor[];
  intrinsics: readonly BasisIntrinsicDescriptor[];
  values: readonly BasisValueDescriptor[];
  pervasiveBindings: readonly import("./types_basis.ts").PervasiveBinding[];
}>;

const initialBases = new Map<BasisProfileName, InitialBasis>();

export function initialBasis(profile: BasisProfile): InitialBasis {
  const cached = initialBases.get(profile.name);
  if (cached) return cached;

  const options: BasisOptions = {
    includeAlgebraicBasis: profile.includeAlgebraicBasis,
  };
  const definitionTypes = baseTypeEnv(options);
  const legacyValEnv = baseEnv(definitionTypes, options);
  const strEnv = basisStrEnv(definitionTypes, legacyValEnv);
  const definition = staticEnv(strEnv);
  for (const [name, info] of definitionTypes) {
    if (!name.includes(".")) bindType(definition, name, info);
    registerTypeInfo(definition.tyEnv, info);
  }
  for (const [name, scheme] of legacyValEnv) {
    if (!name.includes(".")) bindValue(definition, name, scheme);
  }
  installBasisValueIds(definition);
  const adts = baseAdts(definitionTypes);
  const operators = basisOperatorEnv();
  const pervasiveBindings = Object.freeze(
    PERVASIVE_BINDINGS.filter((binding) => binding.profiles.includes(profile.name)),
  );
  const types = Object.freeze(
    BASIS_TYPES.filter((descriptor) =>
      descriptor.profiles.some((candidate) => candidate === profile.name)
    ),
  );
  const constructors = Object.freeze(
    types.flatMap((descriptor) =>
      (descriptor.constructors ?? []).map((constructor: BasisConstructorDescriptor) =>
        Object.freeze({
          typeName: descriptor.name,
          name: constructor.name,
          id: constructor.id,
          status: "constructor" as const,
          runtimeName: constructor.runtimeName,
        })
      )
    ),
  );
  const facts: BasisCompilerFacts = Object.freeze({
    types,
    constructors,
    operators: BASIS_OPERATORS,
    intrinsics: BASIS_INTRINSICS,
    values: Object.freeze(
      BASIS_VALUES.filter((descriptor) =>
        descriptor.profiles.some((candidate) => candidate === profile.name)
      ),
    ),
    pervasiveBindings,
  });
  const artifact: InitialBasis = Object.freeze({
    profile,
    generation: Object.freeze(Object.create(null)) as BasisGeneration,
    pervasiveBindings,
    facts,
    instantiate: () => ({
      environment: cloneStaticEnv(definition),
      adts: new Map(adts),
      operators: new Map(operators),
    }),
  });
  initialBases.set(profile.name, artifact);
  return artifact;
}

function installBasisValueIds(environment: StaticEnv): void {
  const visible = new Set([
    ...BASIS_VALUES.map((descriptor) => descriptor.exportName),
    ...BASIS_INTRINSICS.map((descriptor) => descriptor.exportName),
  ]);
  const visit = (current: StaticEnv, prefix = "") => {
    for (const [name, scheme] of current.valEnv) {
      const qualified = prefix ? `${prefix}.${name}` : name;
      if (!visible.has(qualified)) continue;
      current.valEnv.set(name, { ...scheme, valueId: basisValueId(qualified) });
    }
    for (const [name, nested] of current.strEnv) {
      visit(nested, prefix ? `${prefix}.${name}` : name);
    }
  };
  visit(environment);
}

export function basisProfile(includePrelude: boolean): BasisProfile {
  return includePrelude ? BASIS_PROFILES.default : BASIS_PROFILES.kernel;
}

function cloneStaticEnv(environment: StaticEnv): StaticEnv {
  const strEnv = new Map(
    [...environment.strEnv].map(([name, nested]) => [name, cloneStaticEnv(nested)]),
  );
  const tyEnv: TypeEnv = cloneTypeEnv(environment.tyEnv);
  const valEnv: Env = new Map(environment.valEnv);
  return staticEnv(strEnv, tyEnv, valEnv);
}
