export type CompilerId<Tag extends string> = number & { readonly __compilerId: Tag };

export type BindingId = CompilerId<"binding">;
export type CtorId = CompilerId<"ctor">;
export type TypeNameId = CompilerId<"typeName">;
export type RecordId = CompilerId<"record">;
export type ModuleId = CompilerId<"module">;
export type PatternId = CompilerId<"pattern">;
export type ParamId = CompilerId<"param">;
export type MatchArmId = CompilerId<"matchArm">;
export type LetId = CompilerId<"let">;
export type RecursionGroupId = CompilerId<"recursionGroup">;
export type RecursiveReferenceId = CompilerId<"recursiveReference">;
export type GpuRootId = CompilerId<"gpuRoot">;
export type GpuSelectorId = CompilerId<"gpuSelector">;

export class CompilerIdAllocator {
  #nextBinding = 0;
  #nextCtor = 0;
  #nextTypeName = 0;
  #nextRecord = 0;
  #nextModule = 0;
  #nextPattern = 0;
  #nextParam = 0;
  #nextMatchArm = 0;
  #nextLet = 0;
  #nextRecursionGroup = 0;
  #nextRecursiveReference = 0;

  binding(): BindingId {
    return this.#nextBinding++ as BindingId;
  }

  ctor(): CtorId {
    return this.#nextCtor++ as CtorId;
  }

  typeName(): TypeNameId {
    return this.#nextTypeName++ as TypeNameId;
  }

  record(): RecordId {
    return this.#nextRecord++ as RecordId;
  }

  module(): ModuleId {
    return this.#nextModule++ as ModuleId;
  }

  pattern(): PatternId {
    return this.#nextPattern++ as PatternId;
  }

  param(): ParamId {
    return this.#nextParam++ as ParamId;
  }

  matchArm(): MatchArmId {
    return this.#nextMatchArm++ as MatchArmId;
  }

  let(): LetId {
    return this.#nextLet++ as LetId;
  }

  recursionGroup(): RecursionGroupId {
    return this.#nextRecursionGroup++ as RecursionGroupId;
  }

  recursiveReference(): RecursiveReferenceId {
    return this.#nextRecursiveReference++ as RecursiveReferenceId;
  }
}
