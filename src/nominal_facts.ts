import type { CtorDecl, Decl, Expr, Module, Pattern, RecordFieldDecl, TypeExpr } from "./ast.ts";
import { basisCtorId } from "./basis.ts";
import { basisTypeNameId } from "./compiler_semantics.ts";
import type { InferResult } from "./infer.ts";
import type { CompilerIdAllocator, CtorId, FieldId, RecordId, TypeNameId } from "./ids.ts";
import type { ModuleGraph } from "./module_graph.ts";
import { type ModuleId, moduleId, type ModuleMap } from "./module_id.ts";
import type { TypeFact } from "./infer/type_facts.ts";
import { knownTypeInfos } from "./types.ts";

export type TypeDeclaration = Extract<
  Decl,
  { kind: "TypeDecl" | "RecordDecl" | "ForeignTypeDecl" }
>;
type RecordDeclaration = Extract<Decl, { kind: "RecordDecl" }>;

export type NominalTypeFact = {
  id: TypeNameId;
  inferenceTypeId: number;
  name: string;
  moduleId: ModuleId;
  modulePath: string;
  exported: boolean;
  kind: "alias" | "adt" | "record" | "foreign";
  declaration: TypeDeclaration;
};

export type NominalRecordFact = {
  id: RecordId;
  typeNameId: TypeNameId;
  inferenceTypeId: number;
  name: string;
  moduleId: ModuleId;
  modulePath: string;
  exported: boolean;
  declaration: RecordDeclaration;
};

export type NominalFieldFact = {
  id: FieldId;
  recordId: RecordId;
  typeNameId: TypeNameId;
  inferenceTypeId: number;
  name: string;
  declaredIndex: number;
  moduleId: ModuleId;
  modulePath: string;
  exported: boolean;
  declaration: RecordFieldDecl;
};

export type NominalConstructorFact = {
  id: CtorId;
  typeNameId: TypeNameId;
  inferenceTypeId: number;
  name: string;
  typeName: string;
  tag: number;
  moduleId: ModuleId;
  modulePath: string;
  exported: boolean;
  declaration: CtorDecl;
  payload?: TypeExpr;
};

export type NominalFacts = {
  types: NominalTypeFact[];
  records: NominalRecordFact[];
  fields: NominalFieldFact[];
  constructors: NominalConstructorFact[];
  typeDeclarations: ReadonlyMap<TypeDeclaration, TypeNameId>;
  recordDeclarations: ReadonlyMap<RecordDeclaration, RecordId>;
  fieldDeclarations: ReadonlyMap<RecordFieldDecl, FieldId>;
  constructorDeclarations: ReadonlyMap<CtorDecl, CtorId>;
  inferenceTypeIds: ReadonlyMap<number, TypeNameId>;
  recordTypeIds: ReadonlyMap<number, RecordId>;
  fieldIds: ReadonlyMap<number, ReadonlyMap<string, FieldId>>;
  constructorReferences: ReadonlyMap<Expr | Pattern, CtorId>;
};

type ModuleInput = {
  id: ModuleId;
  path: string;
  module: Module;
  result: InferResult;
};

export function resolveProgramNominalFacts(
  graph: ModuleGraph,
  results: ModuleMap<InferResult>,
  ids: CompilerIdAllocator,
): NominalFacts {
  return resolveNominalFacts(
    graph.order.map((id) => ({
      id,
      path: graph.nodes.get(id)!.path,
      module: graph.nodes.get(id)!.module,
      result: required(results, id),
    })),
    ids,
  );
}

export function resolveModuleNominalFacts(
  module: Module,
  result: InferResult,
  ids: CompilerIdAllocator,
  path = "<source>",
): NominalFacts {
  return resolveNominalFacts([{ id: moduleId(path), path, module, result }], ids);
}

function resolveNominalFacts(inputs: ModuleInput[], ids: CompilerIdAllocator): NominalFacts {
  const types: NominalTypeFact[] = [];
  const records: NominalRecordFact[] = [];
  const fields: NominalFieldFact[] = [];
  const constructors: NominalConstructorFact[] = [];
  const typeDeclarations = new Map<TypeDeclaration, TypeNameId>();
  const recordDeclarations = new Map<RecordDeclaration, RecordId>();
  const fieldDeclarations = new Map<RecordFieldDecl, FieldId>();
  const constructorDeclarations = new Map<CtorDecl, CtorId>();
  const inferenceTypeIds = new Map<number, TypeNameId>();
  const recordTypeIds = new Map<number, RecordId>();
  const fieldIds = new Map<number, ReadonlyMap<string, FieldId>>();

  for (const input of inputs) {
    addBasisTypeIds(input.result, inferenceTypeIds);
    visitDeclarations(input.module, (declaration, topLevel) => {
      if (
        declaration.kind !== "TypeDecl" && declaration.kind !== "RecordDecl" &&
        declaration.kind !== "ForeignTypeDecl"
      ) return;
      const info = input.result.facts.typeDeclarations.get(declaration);
      if (!info) {
        throw new Error(`missing inference type declaration fact for ${declaration.name}`);
      }
      const typeNameId = inferenceTypeIds.get(info.id) ?? ids.typeName();
      const exported = topLevel &&
        (declaration.kind === "ForeignTypeDecl" || declaration.exported);
      const typeFact: NominalTypeFact = {
        id: typeNameId,
        inferenceTypeId: info.id,
        name: declaration.name,
        moduleId: input.id,
        modulePath: input.path,
        exported,
        kind: declaration.kind === "RecordDecl"
          ? "record"
          : declaration.kind === "ForeignTypeDecl"
          ? "foreign"
          : declaration.alias
          ? "alias"
          : "adt",
        declaration,
      };
      types.push(typeFact);
      typeDeclarations.set(declaration, typeNameId);
      inferenceTypeIds.set(info.id, typeNameId);

      if (declaration.kind === "RecordDecl") {
        const recordId = ids.record();
        records.push({
          id: recordId,
          typeNameId,
          inferenceTypeId: info.id,
          name: declaration.name,
          moduleId: input.id,
          modulePath: input.path,
          exported,
          declaration,
        });
        recordDeclarations.set(declaration, recordId);
        recordTypeIds.set(info.id, recordId);
        const recordFieldIds = new Map<string, FieldId>();
        declaration.fields.forEach((field, declaredIndex) => {
          const fieldId = ids.field();
          fields.push({
            id: fieldId,
            recordId,
            typeNameId,
            inferenceTypeId: info.id,
            name: field.name,
            declaredIndex,
            moduleId: input.id,
            modulePath: input.path,
            exported,
            declaration: field,
          });
          fieldDeclarations.set(field, fieldId);
          recordFieldIds.set(field.name, fieldId);
        });
        fieldIds.set(info.id, recordFieldIds);
        return;
      }
      if (declaration.kind === "ForeignTypeDecl" || declaration.alias) return;
      declaration.ctors.forEach((constructor, tag) => {
        const constructorId = ids.ctor();
        constructors.push({
          id: constructorId,
          typeNameId,
          inferenceTypeId: info.id,
          name: constructor.name,
          typeName: declaration.name,
          tag,
          moduleId: input.id,
          modulePath: input.path,
          exported,
          declaration: constructor,
          payload: constructorPayload(constructor),
        });
        constructorDeclarations.set(constructor, constructorId);
      });
    });
  }

  const constructorReferences = new Map<Expr | Pattern, CtorId>();
  for (const input of inputs) {
    for (const [expression, fact] of input.result.facts.expressions) {
      const id = constructorReferenceId(fact, constructorDeclarations);
      if (fact.subject === "constructor" && id !== undefined) {
        constructorReferences.set(expression, id);
      }
    }
    for (const [pattern, fact] of input.result.facts.patterns) {
      const id = constructorReferenceId(fact, constructorDeclarations);
      if (fact.subject === "constructor" && id !== undefined) {
        constructorReferences.set(pattern, id);
      }
    }
  }

  return {
    types,
    records,
    fields,
    constructors,
    typeDeclarations,
    recordDeclarations,
    fieldDeclarations,
    constructorDeclarations,
    inferenceTypeIds,
    recordTypeIds,
    fieldIds,
    constructorReferences,
  };
}

function addBasisTypeIds(result: InferResult, output: Map<number, TypeNameId>): void {
  for (const info of knownTypeInfos(result.typeEnv)) {
    if (!info.basis) continue;
    const id = basisTypeNameId(info.name);
    if (id !== undefined) output.set(info.id, id);
  }
}

function constructorReferenceId(
  fact: TypeFact,
  declarations: Map<CtorDecl, CtorId>,
): CtorId | undefined {
  const declaration = fact.general?.constructorDecl;
  if (declaration) return declarations.get(declaration);
  if (!fact.general?.basis || !fact.origin?.name) return undefined;
  const id = basisCtorId(fact.origin.name);
  return id === undefined ? undefined : id as CtorId;
}

function constructorPayload(constructor: CtorDecl): TypeExpr | undefined {
  if (constructor.args.length === 0) return undefined;
  if (constructor.args.length === 1) return constructor.args[0];
  return { kind: "TTuple", items: constructor.args, node: constructor.node };
}

function visitDeclarations(
  module: Module,
  visit: (declaration: Decl, topLevel: boolean) => void,
): void {
  module.decls.forEach((declaration) => visitDeclaration(declaration, true, visit));
}

function visitDeclaration(
  declaration: Decl,
  topLevel: boolean,
  visit: (declaration: Decl, topLevel: boolean) => void,
): void {
  visit(declaration, topLevel);
  if (declaration.kind !== "LetDecl") return;
  declaration.bindings.forEach((binding) => visitExprDeclarations(binding.value, visit));
}

function visitExprDeclarations(
  expression: Expr,
  visit: (declaration: Decl, topLevel: boolean) => void,
): void {
  switch (expression.kind) {
    case "Tuple":
    case "JsonArray":
      expression.items.forEach((item) => visitExprDeclarations(item, visit));
      return;
    case "Record":
    case "JsonObject":
      expression.fields.forEach((field) => visitExprDeclarations(field.value, visit));
      return;
    case "FfiGet":
      visitExprDeclarations(expression.receiver, visit);
      return;
    case "FfiCall":
      visitExprDeclarations(expression.receiver, visit);
      expression.args.forEach((item) => visitExprDeclarations(item, visit));
      return;
    case "FfiBindingCall":
      expression.args.forEach((item) => visitExprDeclarations(item, visit));
      return;
    case "Lambda":
      visitExprDeclarations(expression.body, visit);
      return;
    case "Call":
      visitExprDeclarations(expression.callee, visit);
      expression.args.forEach((item) => visitExprDeclarations(item, visit));
      return;
    case "If":
      visitExprDeclarations(expression.cond, visit);
      visitExprDeclarations(expression.thenExpr, visit);
      visitExprDeclarations(expression.elseExpr, visit);
      return;
    case "Match":
      visitExprDeclarations(expression.value, visit);
      expression.arms.forEach((arm) => visitExprDeclarations(arm.body, visit));
      return;
    case "Panic":
      visitExprDeclarations(expression.message, visit);
      return;
    case "Block":
      expression.items.forEach((item) => {
        if (isDeclaration(item)) visitDeclaration(item, false, visit);
        else visitExprDeclarations(item, visit);
      });
      visitExprDeclarations(expression.result, visit);
      return;
    case "Binary":
    case "Pipe":
      visitExprDeclarations(expression.left, visit);
      visitExprDeclarations(expression.right, visit);
      return;
    case "Unary":
      visitExprDeclarations(expression.value, visit);
      return;
    default:
      return;
  }
}

function isDeclaration(value: Decl | Expr): value is Decl {
  return value.kind.endsWith("Decl");
}

function required<T>(map: ModuleMap<T>, id: ModuleId): T {
  const value = map.get(id);
  if (!value) throw new Error(`missing inference result for ${id}`);
  return value;
}
