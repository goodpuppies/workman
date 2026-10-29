// Lower reflected C aggregate literals to typed, compiler-generated calls.
// Aro supplies every offset. Nested literals are written into one zero-filled
// allocation; no temporary allocations or C layout calculations are needed.
import type { Decl, Expr, Module, TypeExpr } from "../../ast.ts";
import { diagnosticError } from "../../diagnostic_model.ts";
import type { ExtractedStruct, ExtractedType, ExtractedTypeDesc } from "./extract.ts";
import { cTypeName, mapTypeDesc } from "./mapping.ts";

export type CInitializerWrite = {
  offset: number;
  codec?: string;
  copySize?: number;
};
export type CInitializerPlan = { size: number; writes: CInitializerWrite[] };
export type CInitializerTarget = {
  header: string;
  name: string;
  types: Map<string, ExtractedType>;
};
const plans = new Map<string, CInitializerPlan>();
export const cInitializerFor = (name: string) => plans.get(name);
export function resetCInitializers(): void {
  plans.clear();
}

export function lowerCInitializers(
  module: Module,
  importedTargets: Map<string, CInitializerTarget>,
  codecPrefix: string,
): Module {
  const imports: Decl[] = [];
  let targets = importedTargets;
  const fail = (expr: Expr, message: string): never => {
    throw diagnosticError(new Error(`C initializer: ${message}`), expr.node, "c-ffi.initializer");
  };
  const aggregate = (target: CInitializerTarget, name: string): ExtractedStruct | undefined => {
    const type = target.types.get(cTypeName(name));
    if (type?.kind === "alias" && type.target.kind === "named") {
      return aggregate(target, type.target.name ?? "");
    }
    return type?.kind === "struct" ? type : undefined;
  };
  const lowerLiteral = (
    expr: Extract<Expr, { kind: "Record" }>,
    target: CInitializerTarget,
    declName: string,
  ): Expr => {
    const root = aggregate(target, target.name);
    if (!root || root.opaque) {
      return fail(expr, `type '${declName}' has no concrete aggregate layout`);
    }
    const args: Expr[] = [];
    const params: TypeExpr[] = [];
    const writes: CInitializerWrite[] = [];
    const fill = (
      literal: Extract<Expr, { kind: "Record" }>,
      type: ExtractedStruct,
      base: number,
    ) => {
      if (literal.target) {
        const explicit = targets.get(literal.target.name);
        if (
          !explicit || explicit.header !== target.header ||
          aggregate(explicit, explicit.name) !== type
        ) {
          fail(literal, `expected '${type.name}', got '${literal.target.name}'`);
        }
      }
      if (type.isUnion && literal.fields.length !== 1) {
        fail(literal, `union '${type.name}' requires exactly one selected member`);
      }
      const seen = new Set<string>();
      for (const field of literal.fields) {
        if (field.kind !== "Field") {
          fail(literal, "spread is not supported in C aggregate literals");
        }
        if (field.kind !== "Field") continue;
        if (seen.has(field.name)) fail(field.value, `duplicate field '${field.name}'`);
        seen.add(field.name);
        const member = type.fields.find((member) => member.name === field.name);
        if (!member) fail(field.value, `unknown field '${field.name}' in '${type.name}'`);
        if (!member) continue;
        const offset = base + member.offset;
        const nested = member.type.kind === "named"
          ? aggregate(target, member.type.name ?? "")
          : undefined;
        if (nested && field.value.kind === "Record") {
          fill(field.value, nested, offset);
          continue;
        }
        let param: TypeExpr;
        let write: CInitializerWrite;
        if (nested) {
          const entry = [...targets].find(([, candidate]) =>
            candidate.header === target.header && aggregate(candidate, candidate.name) === nested
          );
          if (!entry) {
            fail(field.value, `import type '${nested.name}' to copy an existing aggregate`);
          }
          param = {
            kind: "TName",
            name: "CStorage",
            args: [{ kind: "TName", name: entry![0], args: [] }],
          };
          write = { offset, copySize: nested.size };
        } else {
          const codec = primitiveCodec(member.type);
          if (!codec) {
            fail(
              field.value,
              `initializing field '${field.name}' of kind '${member.type.kind}' is not supported yet`,
            );
          }
          param = mapTypeDesc(member.type, target.types, "field").type;
          write = { offset, codec };
        }
        args.push(walk(field.value));
        params.push(param);
        writes.push(write);
      }
    };
    // The top-level spelling may be a typedef rather than the record's tag.
    fill({ ...expr, target: undefined }, root, 0);
    const name = `__wm_c_initialize_${plans.size}`;
    plans.set(name, { size: root.size, writes });
    imports.push({
      kind: "JsImportDecl",
      target: { kind: "CLib", name: `${codecPrefix}${target.header}`, node: expr.node },
      clause: {
        kind: "Named",
        unsafe: true,
        node: expr.node,
        specs: [{
          name,
          type: {
            kind: "TFn",
            params,
            result: {
              kind: "TName",
              name: "CStorage",
              args: [{ kind: "TName", name: declName, args: [] }],
            },
          },
          node: expr.node,
        }],
      },
      node: expr.node,
    });
    return { kind: "Call", callee: { kind: "Var", name, node: expr.node }, args, node: expr.node };
  };
  const declaration = (decl: Decl): Decl =>
    decl.kind === "LetDecl"
      ? {
        ...decl,
        bindings: decl.bindings.map((binding) => ({ ...binding, value: walk(binding.value) })),
      }
      : decl;
  const walk = (expr: Expr): Expr => {
    switch (expr.kind) {
      case "Record": {
        const target = expr.target && targets.get(expr.target.name);
        if (target) return lowerLiteral(expr, target, expr.target!.name);
        return {
          ...expr,
          fields: expr.fields.map((field) => ({ ...field, value: walk(field.value) })),
        };
      }
      case "Tuple":
      case "JsonArray":
        return { ...expr, items: expr.items.map(walk) };
      case "JsonObject":
        return {
          ...expr,
          fields: expr.fields.map((field) => ({ ...field, value: walk(field.value) })),
        };
      case "FfiGet":
        return { ...expr, receiver: walk(expr.receiver) };
      case "FfiCall":
        return { ...expr, receiver: walk(expr.receiver), args: expr.args.map(walk) };
      case "FfiBindingCall":
        return { ...expr, args: expr.args.map(walk) };
      case "Call":
        return { ...expr, callee: walk(expr.callee), args: expr.args.map(walk) };
      case "Lambda":
        return { ...expr, body: walk(expr.body) };
      case "If":
        return {
          ...expr,
          cond: walk(expr.cond),
          thenExpr: walk(expr.thenExpr),
          elseExpr: walk(expr.elseExpr),
        };
      case "Match":
        return {
          ...expr,
          value: walk(expr.value),
          arms: expr.arms.map((arm) => ({ ...arm, body: walk(arm.body) })),
        };
      case "Block": {
        const outerTargets = targets;
        targets = new Map(targets);
        try {
          const items = expr.items.map((item) => {
            if (
              item.kind === "RecordDecl" || item.kind === "TypeDecl" ||
              item.kind === "ForeignTypeDecl"
            ) {
              targets.delete(item.name);
            }
            return item.kind.endsWith("Decl") ? declaration(item as Decl) : walk(item as Expr);
          });
          return { ...expr, items, result: walk(expr.result) };
        } finally {
          targets = outerTargets;
        }
      }
      case "Ascribed":
      case "Unary":
        return { ...expr, value: walk(expr.value) };
      case "Binary":
      case "Pipe":
        return { ...expr, left: walk(expr.left), right: walk(expr.right) };
      case "Panic":
        return { ...expr, message: walk(expr.message) };
      default:
        return expr;
    }
  };
  const decls = module.decls.map(declaration);
  const firstBinding = decls.findIndex((decl) => decl.kind === "LetDecl");
  const insertion = firstBinding < 0 ? decls.length : firstBinding;
  return {
    ...module,
    decls: [...decls.slice(0, insertion), ...imports, ...decls.slice(insertion)],
  };
}

function primitiveCodec(desc: ExtractedTypeDesc): string | undefined {
  if (desc.kind === "bool") return "bool";
  if (desc.kind === "float" && (desc.bits === 32 || desc.bits === 64)) return `f${desc.bits}`;
  if (desc.kind === "int" && [8, 16, 32, 64].includes(desc.bits ?? 32)) {
    return `${desc.signed ? "i" : "u"}${desc.bits ?? 32}`;
  }
  return undefined;
}
