import type { InferResult } from "../infer.ts";
import type { ModuleGraph, ModuleImportEdge } from "../module_graph.ts";
import type { Module, TypeExpr } from "../ast.ts";
import type { ImportClause } from "../ast.ts";
import { basisCtorId } from "../basis.ts";
import type { CoreDecl, CoreExpr, CoreModule, CorePattern } from "./ast.ts";
import { coreFromSurface } from "./from_surface.ts";
import { type BindingId, CoreIdAllocator, type CtorId } from "./ids.ts";

export type CoreConstructorInfo = {
  id: CtorId;
  name: string;
  typeName: string;
  typeId: number;
  modulePath: string;
  exported: boolean;
  payload?: TypeExpr;
};

export type CoreDynamicExport = {
  name: string;
  bindingId?: BindingId;
};

export type CoreModuleArtifact = {
  path: string;
  source: string;
  emitName: string;
  imports: ModuleImportEdge[];
  module: CoreModule;
  analysis: InferResult;
  constructors: CoreConstructorInfo[];
  dynamicExports: CoreDynamicExport[];
};

export type CoreProgram = {
  entry: string;
  order: string[];
  modules: Map<string, CoreModuleArtifact>;
  constructors: CoreConstructorInfo[];
};

export function coreProgramFromAnalysis(
  graph: ModuleGraph,
  results: Map<string, InferResult>,
): CoreProgram {
  const ids = new CoreIdAllocator();
  const modules = new Map<string, CoreModuleArtifact>();
  const constructors: CoreConstructorInfo[] = [];
  for (const path of graph.order) {
    const node = graph.nodes.get(path)!;
    const analysis = results.get(path);
    if (!analysis) throw new Error(`missing analysis result for ${path}`);
    const module = coreFromSurface(node.module);
    const moduleConstructors = attachConstructorIds(module, analysis, path, ids);
    constructors.push(...moduleConstructors);
    modules.set(path, {
      path,
      source: node.source,
      emitName: node.emitName,
      imports: node.imports,
      module,
      analysis,
      constructors: moduleConstructors,
      dynamicExports: [],
    });
  }
  for (const path of graph.order) {
    const artifact = modules.get(path)!;
    resolveConstructorRefs(artifact.module, visibleConstructors(artifact, modules));
    resolveValueRefs(artifact.module, ids);
    artifact.dynamicExports = dynamicExports(artifact.module);
  }
  return { entry: graph.entry, order: graph.order, modules, constructors };
}

export function coreProgramFromModule(
  surfaceModule: Module,
  analysis: InferResult,
  source = "<source>",
): CoreProgram {
  const ids = new CoreIdAllocator();
  const module = coreFromSurface(surfaceModule);
  const constructors = attachConstructorIds(module, analysis, source, ids);
  resolveConstructorRefs(
    module,
    new Map([
      ...basisConstructors(),
      ...constructors.map((ctor) =>
        [
          ctor.name,
          ctor.id,
        ] as const
      ),
    ]),
  );
  resolveValueRefs(module, ids);
  return {
    entry: source,
    order: [source],
    modules: new Map([
      [source, {
        path: source,
        source,
        emitName: "Main",
        imports: [],
        module,
        analysis,
        constructors,
        dynamicExports: dynamicExports(module),
      }],
    ]),
    constructors,
  };
}

export function dynamicExports(module: CoreModule): CoreDynamicExport[] {
  const exports: CoreDynamicExport[] = [];
  for (const decl of module.decls) {
    if (decl.kind === "CoreLet" && decl.exported) {
      exports.push(...decl.bindings.flatMap((binding) => patternBinders(binding.pattern)));
    }
    if (decl.kind === "CoreType" && decl.exported && !decl.alias) {
      exports.push(...decl.ctors.map((ctor) => ({ name: ctor.name })));
    }
  }
  return exports;
}

function patternBinders(pattern: CorePattern): CoreDynamicExport[] {
  switch (pattern.kind) {
    case "CorePVar":
      return [{ name: pattern.name, bindingId: pattern.bindingId }];
    case "CorePTuple":
      return pattern.items.flatMap(patternBinders);
    case "CorePRecord":
      return pattern.fields.flatMap((field) => patternBinders(field.pattern));
    case "CorePCtor":
      return pattern.payload ? patternBinders(pattern.payload) : [];
    default:
      return [];
  }
}

type ValueEnv = Map<string, BindingId>;

function resolveValueRefs(module: CoreModule, ids: CoreIdAllocator) {
  let env: ValueEnv = new Map();
  for (const decl of module.decls) env = resolveDeclValues(decl, env, ids);
}

function resolveDeclValues(decl: CoreDecl, env: ValueEnv, ids: CoreIdAllocator): ValueEnv {
  if (decl.kind !== "CoreLet") return env;
  if (decl.recursive) {
    const recEnv = new Map(env);
    for (const binding of decl.bindings) {
      for (const [name, id] of assignPatternBinders(binding.pattern, ids)) recEnv.set(name, id);
    }
    for (const binding of decl.bindings) resolveExprValues(binding.value, recEnv, ids);
    return recEnv;
  }
  for (const binding of decl.bindings) {
    resolvePatternRefs(binding.pattern, env, ids);
    resolveExprValues(binding.value, env, ids);
  }
  const next = new Map(env);
  for (const binding of decl.bindings) {
    for (const [name, id] of assignPatternBinders(binding.pattern, ids)) next.set(name, id);
  }
  return next;
}

function resolveExprValues(expr: CoreExpr, env: ValueEnv, ids: CoreIdAllocator) {
  switch (expr.kind) {
    case "CoreVar":
      expr.bindingId = env.get(expr.name);
      return;
    case "CoreTuple":
      expr.items.forEach((item) => resolveExprValues(item, env, ids));
      return;
    case "CoreRecord":
      expr.fields.forEach((field) => resolveExprValues(field.value, env, ids));
      return;
    case "CoreRecordAccess":
      resolveExprValues(expr.record, env, ids);
      return;
    case "CoreJsonObject":
      expr.fields.forEach((field) => resolveExprValues(field.value, env, ids));
      return;
    case "CoreJsonArray":
      expr.items.forEach((item) => resolveExprValues(item, env, ids));
      return;
    case "CoreFn":
      expr.arms.forEach((arm) => {
        resolvePatternRefs(arm.pattern, env, ids);
        const armEnv = new Map(env);
        for (const [name, id] of assignPatternBinders(arm.pattern, ids)) armEnv.set(name, id);
        resolveExprValues(arm.body, armEnv, ids);
      });
      return;
    case "CoreApp":
      resolveExprValues(expr.callee, env, ids);
      resolveExprValues(expr.arg, env, ids);
      return;
    case "CoreIf":
      resolveExprValues(expr.cond, env, ids);
      resolveExprValues(expr.thenExpr, env, ids);
      resolveExprValues(expr.elseExpr, env, ids);
      return;
    case "CoreMatch":
      resolveExprValues(expr.value, env, ids);
      expr.arms.forEach((arm) => {
        resolvePatternRefs(arm.pattern, env, ids);
        const armEnv = new Map(env);
        for (const [name, id] of assignPatternBinders(arm.pattern, ids)) armEnv.set(name, id);
        resolveExprValues(arm.body, armEnv, ids);
      });
      return;
    case "CorePanic":
      resolveExprValues(expr.message, env, ids);
      return;
    case "CoreBlock": {
      let blockEnv = new Map(env);
      for (const item of expr.items) {
        if (isDecl(item)) blockEnv = resolveDeclValues(item, blockEnv, ids);
        else resolveExprValues(item, blockEnv, ids);
      }
      resolveExprValues(expr.result, blockEnv, ids);
      return;
    }
    default:
      return;
  }
}

function resolvePatternRefs(pattern: CorePattern, env: ValueEnv, ids: CoreIdAllocator) {
  switch (pattern.kind) {
    case "CorePPinned":
      pattern.bindingId = env.get(pattern.name);
      return;
    case "CorePTuple":
      pattern.items.forEach((item) => resolvePatternRefs(item, env, ids));
      return;
    case "CorePRecord":
      pattern.fields.forEach((field) => resolvePatternRefs(field.pattern, env, ids));
      return;
    case "CorePCtor":
      if (pattern.payload) resolvePatternRefs(pattern.payload, env, ids);
      return;
    default:
      return;
  }
}

function assignPatternBinders(pattern: CorePattern, ids: CoreIdAllocator): [string, BindingId][] {
  switch (pattern.kind) {
    case "CorePVar":
      pattern.bindingId ??= ids.binding();
      return [[pattern.name, pattern.bindingId]];
    case "CorePTuple":
      return pattern.items.flatMap((item) => assignPatternBinders(item, ids));
    case "CorePRecord":
      return pattern.fields.flatMap((field) => assignPatternBinders(field.pattern, ids));
    case "CorePCtor":
      return pattern.payload ? assignPatternBinders(pattern.payload, ids) : [];
    default:
      return [];
  }
}

function isDecl(value: CoreDecl | CoreExpr): value is CoreDecl {
  return value.kind === "CoreImport" || value.kind === "CoreLet" ||
    value.kind === "CoreJsImport" || value.kind === "CoreType" || value.kind === "CoreRecord";
}

function attachConstructorIds(
  module: CoreModule,
  analysis: InferResult,
  modulePath: string,
  ids: CoreIdAllocator,
): CoreConstructorInfo[] {
  const constructors: CoreConstructorInfo[] = [];
  for (const decl of module.decls) {
    if (decl.kind !== "CoreType" || decl.alias) continue;
    const typeInfo = analysis.typeEnv.get(decl.name);
    if (!typeInfo) continue;
    for (const ctor of decl.ctors) {
      const info: CoreConstructorInfo = {
        id: ids.ctor(),
        name: ctor.name,
        typeName: decl.name,
        typeId: typeInfo.id,
        modulePath,
        exported: decl.exported,
        payload: ctor.payload,
      };
      ctor.id = info.id;
      constructors.push(info);
    }
  }
  return constructors;
}

function visibleConstructors(
  artifact: CoreModuleArtifact,
  modules: Map<string, CoreModuleArtifact>,
): Map<string, CtorId> {
  const env = new Map<string, CtorId>(basisConstructors());
  for (const edge of artifact.imports) {
    const imported = modules.get(edge.path);
    if (!imported) continue;
    addImportedConstructors(env, edge.clause, imported);
  }
  for (const ctor of artifact.constructors) env.set(ctor.name, ctor.id);
  return env;
}

function basisConstructors(): [string, CtorId][] {
  return ["None", "Some", "Ok", "Err", "Nil", "Cons"].flatMap((name) => {
    const id = basisCtorId(name);
    return id === undefined ? [] : [[name, id as CtorId]];
  });
}

function addImportedConstructors(
  env: Map<string, CtorId>,
  clause: ImportClause,
  imported: CoreModuleArtifact,
) {
  if (clause.kind === "Namespace") {
    for (const ctor of imported.constructors.filter((item) => item.exported)) {
      env.set(`${clause.alias}.${ctor.name}`, ctor.id);
    }
    return;
  }
  if (clause.kind === "All") {
    for (const ctor of imported.constructors.filter((item) => item.exported)) {
      env.set(ctor.name, ctor.id);
    }
    return;
  }
  for (const spec of clause.specs) {
    const ctor = imported.constructors.find((item) => item.exported && item.name === spec.name);
    if (ctor) env.set(spec.alias ?? spec.name, ctor.id);
  }
}

function resolveConstructorRefs(module: CoreModule, env: Map<string, CtorId>) {
  for (const decl of module.decls) {
    if (decl.kind === "CoreLet") {
      for (const binding of decl.bindings) {
        resolvePatternConstructors(binding.pattern, env);
        resolveExprConstructors(binding.value, env);
      }
    }
  }
}

function resolveExprConstructors(expr: CoreExpr, env: Map<string, CtorId>) {
  switch (expr.kind) {
    case "CoreVar":
      expr.ctorId = env.get(expr.name);
      return;
    case "CoreTuple":
      expr.items.forEach((item) => resolveExprConstructors(item, env));
      return;
    case "CoreRecord":
      expr.fields.forEach((field) => resolveExprConstructors(field.value, env));
      return;
    case "CoreJsonObject":
      expr.fields.forEach((field) => resolveExprConstructors(field.value, env));
      return;
    case "CoreJsonArray":
      expr.items.forEach((item) => resolveExprConstructors(item, env));
      return;
    case "CoreFn":
      expr.arms.forEach((arm) => {
        resolvePatternConstructors(arm.pattern, env);
        resolveExprConstructors(arm.body, env);
      });
      return;
    case "CoreApp":
      resolveExprConstructors(expr.callee, env);
      resolveExprConstructors(expr.arg, env);
      return;
    case "CoreIf":
      resolveExprConstructors(expr.cond, env);
      resolveExprConstructors(expr.thenExpr, env);
      resolveExprConstructors(expr.elseExpr, env);
      return;
    case "CoreMatch":
      resolveExprConstructors(expr.value, env);
      expr.arms.forEach((arm) => {
        resolvePatternConstructors(arm.pattern, env);
        resolveExprConstructors(arm.body, env);
      });
      return;
    case "CorePanic":
      resolveExprConstructors(expr.message, env);
      return;
    case "CoreBlock":
      expr.items.forEach((item) => {
        if (item.kind === "CoreLet") {
          item.bindings.forEach((binding) => {
            resolvePatternConstructors(binding.pattern, env);
            resolveExprConstructors(binding.value, env);
          });
        } else if (
          item.kind !== "CoreImport" && item.kind !== "CoreJsImport" &&
          item.kind !== "CoreType" && item.kind !== "CoreRecord"
        ) {
          resolveExprConstructors(item, env);
        }
      });
      resolveExprConstructors(expr.result, env);
      return;
    default:
      return;
  }
}

function resolvePatternConstructors(pattern: CorePattern, env: Map<string, CtorId>) {
  switch (pattern.kind) {
    case "CorePCtor":
      pattern.ctorId = env.get(pattern.name);
      if (pattern.payload) resolvePatternConstructors(pattern.payload, env);
      return;
    case "CorePTuple":
      pattern.items.forEach((item) => resolvePatternConstructors(item, env));
      return;
    case "CorePRecord":
      pattern.fields.forEach((field) => resolvePatternConstructors(field.pattern, env));
      return;
    default:
      return;
  }
}
