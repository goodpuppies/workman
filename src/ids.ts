export type CompilerId<Tag extends string> = number & { readonly __compilerId: Tag };

export type BindingId = CompilerId<"binding">;
export type BasisValueId = string & { readonly __compilerId: "basisValue" };
export type ValueId = BindingId | BasisValueId;
export type StructureId = CompilerId<"structure">;
export type BasisStructureId = string & { readonly __compilerId: "basisStructure" };
export type StructureSemanticId = StructureId | BasisStructureId;
export type CtorId = CompilerId<"ctor">;
export type TypeNameId = CompilerId<"typeName">;
/** Snapshot-local identity of one elaborator-bound annotation/type-parameter variable. */
export type TypeVariableId = CompilerId<"typeVariable">;
export type RecordId = CompilerId<"record">;
export type FieldId = CompilerId<"field">;
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
  #nextStructure = 0;
  #nextCtor = 0;
  #nextTypeName = 0;
  #nextRecord = 0;
  #nextField = 0;
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

  structure(): StructureId {
    return this.#nextStructure++ as StructureId;
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

  field(): FieldId {
    return this.#nextField++ as FieldId;
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
