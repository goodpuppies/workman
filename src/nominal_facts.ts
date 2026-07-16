import type { CtorDecl, Decl, Expr, Module, Pattern, TypeExpr } from "./ast.ts";
import { basisCtorId } from "./basis.ts";
import { basisTypeNameId } from "./compiler_semantics.ts";
import type { InferResult } from "./infer.ts";
import type { CompilerIdAllocator, CtorId, RecordId, TypeNameId } from "./ids.ts";
import type { ModuleGraph } from "./module_graph.ts";
import type { TypeFact } from "./infer/type_facts.ts";

type TypeDeclaration = Extract<Decl, { kind: "TypeDecl" | "RecordDecl" }>;
type RecordDeclaration = Extract<Decl, { kind: "RecordDecl" }>;

export type NominalTypeFact = {
  id: TypeNameId;
  inferenceTypeId: number;
  name: string;
  modulePath: string;
  exported: boolean;
  kind: "alias" | "adt" | "record";
  declaration: TypeDeclaration;
};

export type NominalRecordFact = {
  id: RecordId;
  typeNameId: TypeNameId;
  inferenceTypeId: number;
  name: string;
  modulePath: string;
  exported: boolean;
  declaration: RecordDeclaration;
};

export type NominalConstructorFact = {
  id: CtorId;
  typeNameId: TypeNameId;
  inferenceTypeId: number;
  name: string;
  typeName: string;
  tag: number;
  modulePath: string;
  exported: boolean;
  declaration: CtorDecl;
  payload?: TypeExpr;
};

export type NominalFacts = {
  types: NominalTypeFact[];
  records: NominalRecordFact[];
  constructors: NominalConstructorFact[];
  typeDeclarations: ReadonlyMap<TypeDeclaration, TypeNameId>;
  recordDeclarations: ReadonlyMap<RecordDeclaration, RecordId>;
  constructorDeclarations: ReadonlyMap<CtorDecl, CtorId>;
  inferenceTypeIds: ReadonlyMap<number, TypeNameId>;
  recordTypeIds: ReadonlyMap<number, RecordId>;
  constructorReferences: ReadonlyMap<Expr | Pattern, CtorId>;
};

type ModuleInput = {
  path: string;
  module: Module;
  result: InferResult;
};

export function resolveProgramNominalFacts(
  graph: ModuleGraph,
  results: Map<string, InferResult>,
  ids: CompilerIdAllocator,
): NominalFacts {
  return resolveNominalFacts(
    graph.order.map((path) => ({
      path,
      module: graph.nodes.get(path)!.module,
      result: required(results, path),
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
  return resolveNominalFacts([{ path, module, result }], ids);
}

function resolveNominalFacts(inputs: ModuleInput[], ids: CompilerIdAllocator): NominalFacts {
  const types: NominalTypeFact[] = [];
  const records: NominalRecordFact[] = [];
  const constructors: NominalConstructorFact[] = [];
  const typeDeclarations = new Map<TypeDeclaration, TypeNameId>();
  const recordDeclarations = new Map<RecordDeclaration, RecordId>();
  const constructorDeclarations = new Map<CtorDecl, CtorId>();
  const inferenceTypeIds = new Map<number, TypeNameId>();
  const recordTypeIds = new Map<number, RecordId>();

  for (const input of inputs) {
    addBasisTypeIds(input.result, inferenceTypeIds);
    visitDeclarations(input.module, (declaration, topLevel) => {
      if (declaration.kind !== "TypeDecl" && declaration.kind !== "RecordDecl") return;
      const info = input.result.facts.typeDeclarations.get(declaration);
      if (!info) {
        throw new Error(`missing inference type declaration fact for ${declaration.name}`);
      }
      const typeNameId = ids.typeName();
      const exported = topLevel && declaration.exported;
      const typeFact: NominalTypeFact = {
        id: typeNameId,
        inferenceTypeId: info.id,
        name: declaration.name,
        modulePath: input.path,
        exported,
        kind: declaration.kind === "RecordDecl" ? "record" : declaration.alias ? "alias" : "adt",
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
          modulePath: input.path,
          exported,
          declaration,
        });
        recordDeclarations.set(declaration, recordId);
        recordTypeIds.set(info.id, recordId);
        return;
      }
      if (declaration.alias) return;
      declaration.ctors.forEach((constructor, tag) => {
        const constructorId = ids.ctor();
        constructors.push({
          id: constructorId,
          typeNameId,
          inferenceTypeId: info.id,
          name: constructor.name,
          typeName: declaration.name,
          tag,
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
    constructors,
    typeDeclarations,
    recordDeclarations,
    constructorDeclarations,
    inferenceTypeIds,
    recordTypeIds,
    constructorReferences,
  };
}

function addBasisTypeIds(result: InferResult, output: Map<number, TypeNameId>): void {
  for (const info of result.typeEnv.values()) {
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

function required<T>(map: Map<string, T>, path: string): T {
  const value = map.get(path);
  if (!value) throw new Error(`missing inference result for ${path}`);
  return value;
}
