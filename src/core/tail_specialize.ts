import type { CoreBinding, CoreDecl, CoreExpr, CorePattern } from "./ast.ts";
import type { CoreModuleArtifact, CoreProgram } from "./artifact.ts";
import type { BindingId, StructureId } from "./ids.ts";

type Fn = Extract<CoreExpr, { kind: "CoreFn" }>;
type Known = { fn: Fn; owner: CoreModuleArtifact };
type Scope = ReadonlyMap<BindingId | StructureId, Known>;

/** Expose self tail calls through statically known procedure adapters. This is
 * deliberately bounded specialization, not an assumption that callbacks are
 * always tail calls: the adapter's actual body determines tail position. */
export function specializeTailCalls(program: CoreProgram): CoreProgram {
  const definitions = new Map<
    BindingId | StructureId,
    { value: CoreExpr; owner: CoreModuleArtifact }
  >();
  const exports = new Map<BindingId | StructureId, CoreExpr>();
  const constructors = new Map<number, CoreExpr>();
  const namespaces = new Map<
    CoreModuleArtifact,
    Map<string, { id: StructureId; value: CoreExpr }>
  >();
  const moduleBindings = new Map<CoreModuleArtifact, Set<BindingId | StructureId>>();
  let fresh = 0;
  const note = (pattern: CorePattern) => {
    for (const id of binders(pattern)) fresh = Math.max(fresh, id + 1);
  };
  const namespace = (owner: CoreModuleArtifact): CoreExpr => ({
    kind: "CoreVar",
    name: owner.emitName,
  });
  for (const owner of program.modules.values()) {
    const top = new Set<BindingId | StructureId>();
    moduleBindings.set(owner, top);
    const imports = new Map<string, { id: StructureId; value: CoreExpr }>();
    namespaces.set(owner, imports);
    for (const item of owner.dynamicExports) {
      const access: CoreExpr = {
        kind: "CoreRecordAccess",
        record: namespace(owner),
        field: item.name,
        memberBindingId: item.bindingId,
        ctorId: item.ctorId,
      };
      if (item.bindingId !== undefined) exports.set(item.bindingId, access);
      if (item.ctorId !== undefined) constructors.set(item.ctorId, access);
    }
    for (const decl of owner.module.decls) {
      if (decl.kind === "CoreLet") {
        for (const binding of decl.bindings) {
          note(binding.pattern);
          mapExpr(binding.value, (expr) => {
            if (expr.kind === "CoreFn" || expr.kind === "CoreMatch") {
              expr.arms.forEach((arm) => note(arm.pattern));
            }
            if (expr.kind === "CoreBlock") {
              for (const item of expr.items) {
                if (item.kind === "CoreLet") {
                  item.bindings.forEach((nested) => note(nested.pattern));
                }
              }
            }
            return expr;
          });
          binders(binding.pattern).forEach((id) => top.add(id));
          if (binding.pattern.kind === "CorePVar" && binding.pattern.bindingId !== undefined) {
            definitions.set(binding.pattern.bindingId, { value: binding.value, owner });
          }
        }
      } else if (decl.kind === "CoreImport" && decl.structureId !== undefined && decl.target) {
        if (decl.clause.kind === "Namespace") {
          imports.set(decl.clause.alias, {
            id: decl.structureId,
            value: namespace(program.modules.get(decl.target)!),
          });
        }
      } else if (decl.kind === "CoreJsImport") {
        decl.bindingIds?.forEach((id) => top.add(id));
        if (decl.structureId !== undefined) top.add(decl.structureId);
      } else if (decl.kind === "CoreRecord" && decl.constructorBindingId !== undefined) {
        top.add(decl.constructorBindingId);
      }
    }
  }

  const resolve = (
    expr: CoreExpr,
    scope: Scope,
    owner: CoreModuleArtifact,
    seen = new Set<number>(),
  ): Known | undefined => {
    if (expr.kind === "CoreFn") return { fn: expr, owner };
    const id = expr.kind === "CoreVar"
      ? expr.bindingId
      : expr.kind === "CoreRecordAccess"
      ? expr.memberBindingId
      : undefined;
    if (id === undefined || seen.has(id)) return undefined;
    const local = scope.get(id);
    if (local) return local;
    const definition = definitions.get(id);
    if (!definition) return undefined;
    const next = new Set(seen).add(id);
    return resolve(definition.value, scope, definition.owner, next);
  };

  // Cross-module expansion must retain the defining module's lexical references.
  // Private captures that cannot be named from the caller make expansion ineligible.
  const relocate = (known: Known, owner: CoreModuleArtifact): Fn | undefined => {
    if (known.owner === owner) return known.fn;
    let safe = true;
    const fn = mapExpr(known.fn, (expr) => {
      if (expr.kind === "CoreFn" || expr.kind === "CoreMatch") {
        if (expr.arms.some((arm) => hasPinnedPattern(arm.pattern))) safe = false;
      }
      if (expr.kind !== "CoreVar") return expr;
      const imported = namespaces.get(known.owner)!.get(expr.name);
      if (imported && imported.id === expr.bindingId) return imported.value;
      if (expr.bindingId !== undefined) {
        const access = exports.get(expr.bindingId);
        if (access) return access;
        if (moduleBindings.get(known.owner)!.has(expr.bindingId)) safe = false;
      }
      if (expr.ctorId !== undefined) {
        const access = constructors.get(expr.ctorId);
        if (access) return access;
      }
      return expr;
    }) as Fn;
    return safe ? fn : undefined;
  };

  const modules = new Map(program.modules);
  for (const [moduleId, owner] of program.modules) {
    // Only commit a specialization if it actually exposes a self tail call.
    const visitDecl = (decl: CoreDecl, inherited: Scope): CoreDecl => {
      if (decl.kind !== "CoreLet") return decl;
      return {
        ...decl,
        bindings: decl.bindings.map((binding) => {
          let value = visit(binding.value, inherited);
          if (
            decl.recursive && binding.pattern.kind === "CorePVar" &&
            binding.pattern.bindingId !== undefined && value.kind === "CoreFn"
          ) {
            const target = binding.pattern.bindingId;
            let budget = 128;
            let found = 0;
            const functionIds = new Map<Fn, number>();
            const functionId = (fn: Fn) => {
              if (!functionIds.has(fn)) functionIds.set(fn, functionIds.size);
              return functionIds.get(fn)!;
            };
            const tail = (expr: CoreExpr, scope: Scope, active: ReadonlySet<string>): CoreExpr => {
              if (expr.kind === "CoreApp") {
                if (expr.callee.kind === "CoreVar" && expr.callee.bindingId === target) {
                  found++;
                  return expr;
                }
                const known = resolve(expr.callee, scope, owner);
                if (!known || budget-- <= 0) return expr;
                const args = expr.arg.kind === "CoreTuple" ? expr.arg.items : [expr.arg];
                const callbacks = args.map((arg) => {
                  const callback = resolve(arg, scope, owner);
                  return callback ? functionId(callback.fn) : "?";
                });
                const key = `${functionId(known.fn)}:${callbacks.join(",")}`;
                if (active.has(key)) return expr;
                const fn = relocate(known, owner);
                if (!fn || fn.directives?.length) return expr;
                const expanding = new Set(active).add(key);
                const before = found;
                const expanded: CoreExpr = {
                  kind: "CoreMatch",
                  value: expr.arg,
                  node: expr.node,
                  arms: fn.arms.map((arm) => {
                    const next = new Map(scope);
                    learn(arm.pattern, expr.arg, next);
                    return { ...arm, body: tail(arm.body, next, expanding) };
                  }),
                };
                return found > before ? expanded : expr;
              }
              if (expr.kind === "CoreIf") {
                return {
                  ...expr,
                  thenExpr: tail(expr.thenExpr, scope, active),
                  elseExpr: tail(expr.elseExpr, scope, active),
                };
              }
              if (expr.kind === "CoreMatch") {
                return {
                  ...expr,
                  arms: expr.arms.map((arm) => ({ ...arm, body: tail(arm.body, scope, active) })),
                };
              }
              if (expr.kind !== "CoreBlock") return expr;
              const next = new Map(scope);
              const items: (CoreDecl | CoreExpr)[] = [];
              for (const item of expr.items) {
                if (item.kind === "CoreLet" && !item.recursive) {
                  const bindings: CoreBinding[] = [];
                  for (const binding of item.bindings) {
                    let value = binding.value;
                    // A factory whose body is just a lambda is effect-free. Capture its
                    // argument at the original binding site, exactly once, before using
                    // the returned closure's body at a tail call site.
                    if (value.kind === "CoreApp" && binding.pattern.kind === "CorePVar") {
                      const factory = resolve(value.callee, next, owner);
                      const fn = factory && relocate(factory, owner);
                      const arm = fn?.arms.length === 1 ? fn.arms[0] : undefined;
                      const body = arm && unwrap(arm.body);
                      if (
                        arm?.pattern.kind === "CorePVar" && arm.pattern.bindingId !== undefined &&
                        body?.kind === "CoreFn" && !fn?.directives?.length
                      ) {
                        const capture: Extract<CorePattern, { kind: "CorePVar" }> = {
                          kind: "CorePVar",
                          name: "__wm_capture",
                          bindingId: fresh++ as BindingId,
                        };
                        bindings.push({ pattern: capture, value: value.arg });
                        learn(capture, value.arg, next);
                        const ref: CoreExpr = {
                          kind: "CoreVar",
                          name: capture.name,
                          bindingId: capture.bindingId,
                        };
                        value = { ...value, arg: ref };
                        const parameterId = arm.pattern.bindingId;
                        const closure = mapExpr(
                          body,
                          (expr) =>
                            expr.kind === "CoreVar" && expr.bindingId === parameterId ? ref : expr,
                        ) as Fn;
                        if (binding.pattern.bindingId !== undefined) {
                          next.set(binding.pattern.bindingId, { fn: closure, owner });
                        }
                      }
                    }
                    learn(binding.pattern, value, next);
                    bindings.push({ ...binding, value });
                  }
                  items.push({ ...item, bindings });
                } else items.push(item);
              }
              const last = items.at(-1);
              if (expr.result.kind === "CoreVoid" && last && !isDecl(last)) {
                items[items.length - 1] = tail(last, next, active);
                return { ...expr, items };
              }
              return { ...expr, items, result: tail(expr.result, next, active) };
            };
            const learn = (
              pattern: CorePattern,
              value: CoreExpr,
              scope: Map<BindingId | StructureId, Known>,
            ) => {
              if (pattern.kind === "CorePVar" && pattern.bindingId !== undefined) {
                const known = resolve(value, scope, owner);
                if (known) {
                  scope.set(pattern.bindingId, known);
                }
              } else if (
                pattern.kind === "CorePTuple" && value.kind === "CoreTuple" &&
                pattern.items.length === value.items.length
              ) {
                pattern.items.forEach((part, index) => learn(part, value.items[index], scope));
              }
            };
            const arms = value.arms.map((arm) => ({
              ...arm,
              body: tail(arm.body, inherited, new Set()),
            }));
            if (found) value = { ...value, arms };
          }
          return { ...binding, value };
        }),
      };
    };
    const visit = (expr: CoreExpr, scope: Scope): CoreExpr => {
      if (expr.kind === "CoreBlock") {
        const next = new Map(scope);
        const items = expr.items.map((item) => {
          if (!isDecl(item)) return visit(item, next);
          const decl = visitDecl(item, next);
          if (decl.kind === "CoreLet" && !decl.recursive) {
            for (const binding of decl.bindings) {
              if (binding.pattern.kind !== "CorePVar" || binding.pattern.bindingId === undefined) {
                continue;
              }
              const known = resolve(binding.value, next, owner);
              if (known) next.set(binding.pattern.bindingId, known);
            }
          }
          return decl;
        });
        return { ...expr, items, result: visit(expr.result, next) };
      }
      return mapChildren(expr, (child) => visit(child, scope));
    };
    modules.set(moduleId, {
      ...owner,
      module: {
        ...owner.module,
        decls: owner.module.decls.map((decl) => visitDecl(decl, new Map())),
      },
    });
  }
  return { ...program, modules };
}

function unwrap(expr: CoreExpr): CoreExpr {
  return expr.kind === "CoreBlock" && expr.items.length === 0 ? unwrap(expr.result) : expr;
}

function binders(pattern: CorePattern): BindingId[] {
  if (pattern.kind === "CorePVar") {
    return pattern.bindingId === undefined ? [] : [pattern.bindingId];
  }
  if (pattern.kind === "CorePTuple") return pattern.items.flatMap(binders);
  if (pattern.kind === "CorePRecord") {
    return pattern.fields.flatMap((field) => binders(field.pattern));
  }
  if (pattern.kind === "CorePCtor" && pattern.payload) return binders(pattern.payload);
  return [];
}

function isDecl(expr: CoreDecl | CoreExpr): expr is CoreDecl {
  return ["CoreLet", "CoreImport", "CoreJsImport", "CoreType"].includes(expr.kind) ||
    expr.kind === "CoreRecord" && "exported" in expr;
}

function mapExpr(expr: CoreExpr, transform: (expr: CoreExpr) => CoreExpr): CoreExpr {
  return transform(mapChildren(expr, (child) => mapExpr(child, transform)));
}

function mapChildren(expr: CoreExpr, map: (expr: CoreExpr) => CoreExpr): CoreExpr {
  switch (expr.kind) {
    case "CoreFn":
      return { ...expr, arms: expr.arms.map((arm) => ({ ...arm, body: map(arm.body) })) };
    case "CoreApp":
      return { ...expr, callee: map(expr.callee), arg: map(expr.arg) };
    case "CoreIf":
      return {
        ...expr,
        cond: map(expr.cond),
        thenExpr: map(expr.thenExpr),
        elseExpr: map(expr.elseExpr),
      };
    case "CoreMatch":
      return {
        ...expr,
        value: map(expr.value),
        arms: expr.arms.map((arm) => ({ ...arm, body: map(arm.body) })),
      };
    case "CoreBlock":
      return {
        ...expr,
        items: expr.items.map((item) =>
          item.kind === "CoreLet"
            ? {
              ...item,
              bindings: item.bindings.map((binding) => ({ ...binding, value: map(binding.value) })),
            }
            : isDecl(item)
            ? item
            : map(item)
        ),
        result: map(expr.result),
      };
    case "CoreTuple":
      return { ...expr, items: expr.items.map(map) };
    case "CoreRecord":
      return {
        ...expr,
        fields: expr.fields.map((field) => ({ ...field, value: map(field.value) })),
      };
    case "CoreRecordAccess":
      return { ...expr, record: map(expr.record) };
    case "CoreJsonObject":
      return {
        ...expr,
        fields: expr.fields.map((field) => ({ ...field, value: map(field.value) })),
      };
    case "CoreJsonArray":
      return { ...expr, items: expr.items.map(map) };
    case "CorePanic":
      return { ...expr, message: map(expr.message) };
    case "CoreShaderRef":
      return expr.environment ? { ...expr, environment: map(expr.environment) } : expr;
    default:
      return expr;
  }
}

function hasPinnedPattern(pattern: CorePattern): boolean {
  if (pattern.kind === "CorePPinned") return true;
  if (pattern.kind === "CorePTuple") return pattern.items.some(hasPinnedPattern);
  if (pattern.kind === "CorePRecord") {
    return pattern.fields.some((field) => hasPinnedPattern(field.pattern));
  }
  return pattern.kind === "CorePCtor" && !!pattern.payload && hasPinnedPattern(pattern.payload);
}
