import type { Decl } from "../ast.ts";
import type { Env, TypeEnv } from "../types.ts";
import { generalize, typeFromAst } from "../types.ts";
import { rejectDuplicates } from "./decl_helpers.ts";

type JsImportDecl = Extract<Decl, { kind: "JsImportDecl" }>;

export function addJsImport(env: Env, typeEnv: TypeEnv, decl: JsImportDecl) {
  if (decl.clause.kind === "Namespace") {
    if (env.has(decl.clause.alias)) throw new Error(`duplicate value import ${decl.clause.alias}`);
    const type = typeFromAst({ kind: "TName", name: "Js.Object", args: [] }, typeEnv);
    env.set(decl.clause.alias, { ...generalize(env, type), status: "value" });
    return;
  }
  rejectDuplicates(decl.clause.specs.map((spec) => spec.alias ?? spec.name), "JS import");
  for (const spec of decl.clause.specs) {
    const name = spec.alias ?? spec.name;
    const local = decl.clause.alias ? `${decl.clause.alias}.${name}` : name;
    if (env.has(local)) throw new Error(`duplicate value import ${local}`);
    if (!spec.type) {
      throw new Error(`unknown JS import ${jsTargetLabel(decl.target)}.${spec.name}`);
    }
    const type = typeFromAst(spec.type, typeEnv, new Map(), { allowFreeVars: true });
    const scheme = { ...generalize(env, type), status: "value" as const, jsImport: true };
    env.set(local, scheme);
  }
}

function jsTargetLabel(target: JsImportDecl["target"]): string {
  if (target.kind === "JsGlobalRoot") return "globalThis";
  if (target.kind === "JsGlobal") return target.path;
  if (target.kind === "JsModule") return target.specifier;
  if (target.kind === "JsConstructor") return `new ${target.path}`;
  return `receiver.${target.path.join(".")}`;
}
