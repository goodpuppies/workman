import type { Decl } from "../ast.ts";
import type { Env, TypeEnv } from "../types.ts";
import { generalize, typeFromAst } from "../types.ts";
import { rejectDuplicates } from "./decl_helpers.ts";
import { bindStructure, bindValue, staticEnv, type StrEnv } from "./environment.ts";
import { recordTypeExpressionFact, recordTypeReferenceFact, type TypeFacts } from "./type_facts.ts";

type JsImportDecl = Extract<Decl, { kind: "JsImportDecl" }>;

export function addJsImport(
  env: Env,
  typeEnv: TypeEnv,
  strEnv: StrEnv,
  decl: JsImportDecl,
  facts: TypeFacts,
) {
  if (decl.clause.kind === "Namespace") {
    if (env.has(decl.clause.alias)) throw new Error(`duplicate value import ${decl.clause.alias}`);
    const type = typeFromAst(
      { kind: "TName", name: "Js.Object", args: [] },
      typeEnv,
      new Map(),
      { strEnv },
    );
    const scheme = { ...generalize(env, type), status: "value" as const, jsImport: true };
    bindValue(
      staticEnv(strEnv, typeEnv, env),
      decl.clause.alias,
      scheme,
    );
    facts.jsImportSchemes.set(decl, scheme);
    return;
  }
  rejectDuplicates(decl.clause.specs.map((spec) => spec.alias ?? spec.name), "JS import");
  const targetEnv = decl.clause.alias ? staticEnv() : staticEnv(strEnv, typeEnv, env);
  for (const spec of decl.clause.specs) {
    const name = spec.alias ?? spec.name;
    if (targetEnv.valEnv.has(name)) throw new Error(`duplicate value import ${name}`);
    if (!spec.type) {
      throw new Error(`unknown JS import ${jsTargetLabel(decl.target)}.${spec.name}`);
    }
    const type = typeFromAst(spec.type, typeEnv, new Map(), {
      allowFreeVars: true,
      strEnv,
      onResolveName: (expression, resolved, qualifier) =>
        recordTypeReferenceFact(facts, expression, resolved, qualifier),
      onResolveType: (expression, type) => recordTypeExpressionFact(facts, expression, type),
    });
    const scheme = { ...generalize(env, type), status: "value" as const, jsImport: true };
    bindValue(targetEnv, name, scheme);
    facts.jsImportSchemes.set(spec, scheme);
  }
  if (decl.clause.alias) {
    bindStructure(staticEnv(strEnv, typeEnv, env), decl.clause.alias, targetEnv);
  }
}

function jsTargetLabel(target: JsImportDecl["target"]): string {
  if (target.kind === "JsGlobalRoot") return "globalThis";
  if (target.kind === "JsGlobal") return target.path;
  if (target.kind === "JsMeta") return "import.meta";
  if (target.kind === "JsModule") return target.specifier;
  if (target.kind === "JsWorker") return `worker ${target.specifier}`;
  if (target.kind === "JsConstructor") return `new ${target.path}`;
  return `receiver.${target.path.join(".")}`;
}
