import type { CoreDecl, CoreExpr, CoreMatchArm, CorePattern } from "./ast.ts";
import type { CoreDynamicExport, CoreModuleArtifact, CoreProgram } from "./artifact.ts";
import type { BindingId } from "./ids.ts";
import { basisCtorJsName } from "../basis.ts";
import type { JsImportSpec, TypeExpr } from "../ast.ts";
import { runtimeJsModuleSpecifier } from "../js_module_specifier.ts";
import { emitRuntimePrelude } from "./emit_prelude.ts";

const reserved = new Set([
  "const",
  "let",
  "function",
  "return",
  "if",
  "else",
  "class",
  "void",
  "globalThis",
]);

export function emitCoreProgram(program: CoreProgram): string {
  const entry = program.modules.get(program.entry)!;
  const main = mainRef(entry);
  return [
    ...emitRuntimePrelude(),
    ...program.order
      .filter((path) => path !== program.entry)
      .map((path) => emitNamespace(program.modules.get(path)!, program)),
    ...emitModuleBody(entry, program),
    `if (typeof ${main} === "function") await ${main}();`,
  ].join("\n");
}

function emitNamespace(artifact: CoreModuleArtifact, program: CoreProgram): string {
  const body = emitModuleBody(artifact, program).join("\n");
  return `const ${id(artifact.emitName)} = (() => {\n${body}\nreturn { ${
    artifact.dynamicExports.map((item) => `${JSON.stringify(item.name)}: ${emitExportRef(item)}`)
      .join(", ")
  } };\n})();`;
}

function emitModuleBody(artifact: CoreModuleArtifact, program: CoreProgram): string[] {
  return [
    ...emitImportAliases(artifact, program),
    ...artifact.module.decls.flatMap((decl) => emitDecl(decl)),
  ];
}

function emitImportAliases(artifact: CoreModuleArtifact, program: CoreProgram): string[] {
  const aliases: string[] = [];
  for (const edge of artifact.imports) {
    const imported = program.modules.get(edge.path)!;
    if (edge.clause.kind === "All") {
      for (const item of imported.dynamicExports) {
        aliases.push(`const ${id(item.name)} = ${id(imported.emitName)}.${id(item.name)};`);
      }
      continue;
    }
    if (edge.clause.kind !== "Named") continue;
    for (const spec of edge.clause.specs) {
      if (imported.dynamicExports.some((item) => item.name === spec.name)) {
        aliases.push(
          `const ${id(spec.alias ?? spec.name)} = ${id(imported.emitName)}.${id(spec.name)};`,
        );
      }
    }
  }
  return aliases;
}

function emitDecl(decl: CoreDecl): string[] {
  if (decl.kind === "CoreImport" || decl.kind === "CoreRecord") return [];
  if (decl.kind === "CoreJsImport") {
    const target = jsTargetRef(decl.target);
    const prefix: string[] = target.kind === "module" ? [target.setup] : [];
    if (decl.clause.kind === "Namespace") {
      return [
        ...prefix,
        `const ${id(decl.clause.alias)} = ${jsNamespaceRef(target)};`,
      ];
    }
    const alias = decl.clause.alias;
    if (alias) {
      return [
        ...prefix,
        `const ${id(alias)} = { ${
          decl.clause.specs.map((spec) =>
            `${id(spec.alias ?? spec.name)}: ${
              jsImportWrapper(
                jsMemberRef(target, JSON.stringify(spec.name)),
                spec,
              )
            }`
          ).join(", ")
        } };`,
      ];
    }
    return [
      ...prefix,
      ...decl.clause.specs.map((spec) =>
        `const ${id(spec.alias ?? spec.name)} = ${
          jsImportWrapper(jsMemberRef(target, JSON.stringify(spec.name)), spec)
        };`
      ),
    ];
  }
  if (decl.kind === "CoreType") {
    if (decl.alias) return [];
    return decl.ctors.map((ctor) => {
      const ctorId = ctor.id ?? ctor.name;
      return ctor.payload
        ? `const ${id(ctor.name)} = (__payload) => ({ ctor: ${JSON.stringify(ctorId)}, name: ${
          JSON.stringify(ctor.name)
        }, args: [__payload] });`
        : `const ${id(ctor.name)} = Object.freeze({ ctor: ${JSON.stringify(ctorId)}, name: ${
          JSON.stringify(ctor.name)
        }, args: [] });`;
    });
  }
  if (decl.recursive) {
    return decl.bindings.map((binding) => {
      if (binding.pattern.kind !== "CorePVar") {
        throw new Error("recursive bindings must bind one name");
      }
      return `let ${patternBindingName(binding.pattern)} = ${emitExpr(binding.value)};`;
    });
  }
  return decl.bindings.flatMap((binding) => {
    if (binding.pattern.kind === "CorePVar") {
      return [`const ${patternBindingName(binding.pattern)} = ${emitExpr(binding.value)};`];
    }
    const tmp = `__wm_bind_${bindingTemp++}`;
    return [
      `const ${tmp} = ${emitExpr(binding.value)};`,
      ...emitPatternAssert(binding.pattern, tmp, "Bind", "pattern match failure in let binding"),
      ...emitPatternBind(binding.pattern, tmp),
    ];
  });
}

let bindingTemp = 0;

function jsImportWrapper(memberRef: string, spec: JsImportSpec): string {
  if (spec.type?.kind !== "TFn") {
    if (spec.fallible) {
      const mode = jsFallibleMode(spec.type);
      if (mode === "task") {
        return `__wm_js_task_from_thunk(() => ${memberRef}, ${
          JSON.stringify(jsValueConverter(spec.type))
        })`;
      }
      return `(() => { try { return __wm_basis_Ok(${memberRef}); } catch (error) { return __wm_basis_Err(__wm_js_error(error)); } })()`;
    }
    return memberRef;
  }
  return `(__arg) => __wm_js_apply(${memberRef}, __arg, ${
    JSON.stringify(jsParamConverters(spec.type))
  }, ${JSON.stringify(jsResultConverter(spec.type, !!spec.fallible))}, ${
    JSON.stringify(spec.fallible ? jsFallibleMode(spec.type) : false)
  })`;
}

type JsConverter = "id" | "option" | {
  kind: "fn";
  params: JsConverter[];
  result: JsConverter;
};

function jsParamConverters(type: TypeExpr | undefined): JsConverter[] {
  return type?.kind === "TFn" ? type.params.map(jsConverter) : [];
}

function jsResultConverter(type: TypeExpr | undefined, fallible: boolean): JsConverter {
  if (type?.kind !== "TFn") return "id";
  const resultType = fallible ? fallibleOkType(type.result) : type.result;
  return resultType ? jsConverter(resultType) : "id";
}

function jsValueConverter(type: TypeExpr | undefined): JsConverter {
  const valueType = type ? fallibleOkType(type) : undefined;
  return valueType ? jsConverter(valueType) : "id";
}

function jsConverter(type: TypeExpr): JsConverter {
  if (type.kind === "TName" && type.name === "Option") return "option";
  if (type.kind === "TFn") {
    return {
      kind: "fn",
      params: type.params.map(jsConverter),
      result: jsConverter(type.result),
    };
  }
  return "id";
}

function jsFallibleMode(type: TypeExpr | undefined): "result" | "task" {
  const resultType = type?.kind === "TFn" ? type.result : type;
  return resultType?.kind === "TName" && resultType.name === "Task" && resultType.args.length === 2
    ? "task"
    : "result";
}

function fallibleOkType(type: TypeExpr): TypeExpr | undefined {
  if (
    type.kind === "TName" &&
    (type.name === "Result" || type.name === "Task") &&
    type.args.length === 2
  ) {
    return type.args[0];
  }
  return undefined;
}

function emitExpr(expr: CoreExpr): string {
  switch (expr.kind) {
    case "CoreInt":
    case "CoreFloat":
      return String(expr.value);
    case "CoreString":
      return JSON.stringify(expr.value);
    case "CoreBool":
      return expr.value ? "true" : "false";
    case "CoreVoid":
      return "undefined";
    case "CoreVar": {
      if (expr.bindingId === undefined && expr.ctorId !== undefined) {
        const basisName = basisCtorJsName(expr.ctorId);
        if (basisName) return basisName;
      }
      return primitiveName(expr.name) ?? valueRefName(expr.name, expr.bindingId);
    }
    case "CoreTuple":
      return `__wm_tuple(${expr.items.map(emitExpr).join(", ")})`;
    case "CoreRecord":
      return `{ ${
        expr.fields.map((field) =>
          field.kind === "CoreRecordSpread"
            ? `...${emitExpr(field.value)}`
            : `${id(field.name)}: ${emitExpr(field.value)}`
        ).join(", ")
      } }`;
    case "CoreRecordAccess":
      return `${emitExpr(expr.record)}.${id(expr.field)}`;
    case "CoreJsonObject":
      return `{ ${
        expr.fields.map((field) => `${JSON.stringify(field.key)}: ${emitExpr(field.value)}`).join(
          ", ",
        )
      } }`;
    case "CoreJsonArray":
      return `[${expr.items.map(emitExpr).join(", ")}]`;
    case "CoreFn":
      return `(__arg) => {\n${
        emitArmBody(expr.arms, "__arg", "pattern match failure in function")
      }\n}`;
    case "CoreApp":
      return `${emitExpr(expr.callee)}(${emitExpr(expr.arg)})`;
    case "CoreIf":
      return `(${emitExpr(expr.cond)} ? ${emitExpr(expr.thenExpr)} : ${emitExpr(expr.elseExpr)})`;
    case "CoreMatch":
      return `((__v) => {\n${emitArmBody(expr.arms, "__v", "non-exhaustive match")}\n})(${
        emitExpr(expr.value)
      })`;
    case "CorePanic":
      return `__wm_fail("Panic", ${emitExpr(expr.message)})`;
    case "CoreBlock":
      return `(() => {\n${expr.items.map(emitBlockItem).join("\n")}\nreturn ${
        emitExpr(expr.result)
      };\n})()`;
  }
}

function emitArmBody(arms: CoreMatchArm[], value: string, message: string): string {
  const body = arms.map((arm) => {
    const checks = patternChecks(arm.pattern, value);
    const binds = emitPatternBind(arm.pattern, value);
    return `if (${checks.length ? checks.join(" && ") : "true"}) {\n${binds.join("\n")}\nreturn ${
      emitExpr(arm.body)
    };\n}`;
  });
  return `${body.join(" else ")}\n__wm_fail("Match", ${JSON.stringify(message)});`;
}

function emitBlockItem(item: CoreDecl | CoreExpr): string {
  return isDecl(item) ? emitDecl(item).join("\n") : `${emitExpr(item)};`;
}

function isDecl(value: CoreDecl | CoreExpr): value is CoreDecl {
  return value.kind === "CoreImport" || value.kind === "CoreLet" ||
    value.kind === "CoreJsImport" || value.kind === "CoreType" || value.kind === "CoreRecord";
}

type JsTargetRef = { kind: "global"; path: string; setup?: string } | {
  kind: "module";
  name: string;
  setup: string;
} | {
  kind: "receiver";
  path: string[];
} | {
  kind: "constructor";
  path: string;
};

let jsImportTemp = 0;

function jsTargetRef(target: Extract<CoreDecl, { kind: "CoreJsImport" }>["target"]): JsTargetRef {
  if (target.kind === "JsGlobalRoot") return { kind: "global", path: "" };
  if (target.kind === "JsGlobal") return { kind: "global", path: target.path };
  if (target.kind === "JsModule") {
    const name = `__wm_js_module_${jsImportTemp++}`;
    return {
      kind: "module",
      name,
      setup: `const ${name} = await import(${
        JSON.stringify(runtimeJsModuleSpecifier(target.specifier))
      });`,
    };
  }
  if (target.kind === "JsReceiver") return { kind: "receiver", path: target.path };
  if (target.kind === "JsConstructor") return { kind: "constructor", path: target.path };
  throw new Error("unsupported JS import target");
}

function jsMemberRef(target: JsTargetRef, member: string): string {
  if (target.kind === "global") {
    if (target.path.length === 0) return `__wm_js_member(${member})`;
    if (member === JSON.stringify(target.path)) {
      return `__wm_js_member(${JSON.stringify(target.path)})`;
    }
    return `__wm_js_member(${JSON.stringify(target.path)} + "." + ${member})`;
  }
  if (target.kind === "module") return `__wm_js_member_obj(${target.name}, ${member})`;
  if (target.kind === "constructor") return `__wm_js_construct(${JSON.stringify(target.path)})`;
  return `__wm_js_receiver_member(${JSON.stringify(target.path)})`;
}

function jsNamespaceRef(target: JsTargetRef): string {
  if (target.kind === "module") return target.name;
  if (target.kind === "global") {
    return target.path.length === 0
      ? "globalThis"
      : `__wm_js_global(${JSON.stringify(target.path)})`;
  }
  return "{}";
}

function emitPatternAssert(
  pattern: CorePattern,
  value: string,
  errorName: "Bind" | "Match",
  message: string,
): string[] {
  const checks = patternChecks(pattern, value);
  if (checks.length === 0) return [];
  return [
    `if (!(${checks.join(" && ")})) __wm_fail(${JSON.stringify(errorName)}, ${
      JSON.stringify(message)
    });`,
  ];
}

function patternChecks(pattern: CorePattern, value: string): string[] {
  switch (pattern.kind) {
    case "CorePWildcard":
    case "CorePVar":
      return [];
    case "CorePInt":
      return [`${value} === ${pattern.value}`];
    case "CorePString":
      return [`${value} === ${JSON.stringify(pattern.value)}`];
    case "CorePBool":
      return [`${value} === ${pattern.value ? "true" : "false"}`];
    case "CorePVoid":
      return [`${value} === undefined`];
    case "CorePPinned":
      return [`__wm_eq(${value}, ${valueRefName(pattern.name, pattern.bindingId)})`];
    case "CorePTuple":
      return [
        `__wm_is_tuple(${value})`,
        `${value}.length === ${pattern.items.length}`,
        ...pattern.items.flatMap((item, index) => patternChecks(item, `${value}[${index}]`)),
      ];
    case "CorePRecord":
      return [
        `${value} !== null`,
        `typeof ${value} === "object"`,
        ...pattern.fields.flatMap((field) =>
          patternChecks(field.pattern, `${value}.${id(field.name)}`)
        ),
      ];
    case "CorePCtor": {
      const ctorId = pattern.ctorId ?? pattern.name.split(".").at(-1)!;
      return [
        `${value}?.ctor === ${JSON.stringify(ctorId)}`,
        `${value}.args.length === ${pattern.payload ? 1 : 0}`,
        ...(pattern.payload ? patternChecks(pattern.payload, `${value}.args[0]`) : []),
      ];
    }
  }
}

function emitPatternBind(pattern: CorePattern, value: string): string[] {
  switch (pattern.kind) {
    case "CorePVar":
      return [`const ${patternBindingName(pattern)} = ${value};`];
    case "CorePTuple":
      return pattern.items.flatMap((item, index) => emitPatternBind(item, `${value}[${index}]`));
    case "CorePRecord":
      return pattern.fields.flatMap((field) =>
        emitPatternBind(field.pattern, `${value}.${id(field.name)}`)
      );
    case "CorePCtor":
      return pattern.payload ? emitPatternBind(pattern.payload, `${value}.args[0]`) : [];
    default:
      return [];
  }
}

function emitExportRef(item: CoreDynamicExport): string {
  return item.bindingId === undefined ? id(item.name) : bindingName(item.name, item.bindingId);
}

function mainRef(artifact: CoreModuleArtifact): string {
  for (const decl of artifact.module.decls) {
    if (decl.kind !== "CoreLet") continue;
    for (const binding of decl.bindings) {
      const found = findPatternBinding(binding.pattern, "main");
      if (found !== undefined) return bindingName("main", found);
    }
  }
  return "main";
}

function findPatternBinding(pattern: CorePattern, name: string): BindingId | undefined {
  switch (pattern.kind) {
    case "CorePVar":
      return pattern.name === name ? pattern.bindingId : undefined;
    case "CorePTuple":
      return firstDefined(pattern.items.map((item) => findPatternBinding(item, name)));
    case "CorePRecord":
      return firstDefined(pattern.fields.map((field) => findPatternBinding(field.pattern, name)));
    case "CorePCtor":
      return pattern.payload ? findPatternBinding(pattern.payload, name) : undefined;
    default:
      return undefined;
  }
}

function firstDefined<T>(items: (T | undefined)[]): T | undefined {
  return items.find((item): item is T => item !== undefined);
}

function valueRefName(name: string, bindingId: BindingId | undefined): string {
  return bindingId === undefined ? id(name) : bindingName(name, bindingId);
}

function patternBindingName(pattern: Extract<CorePattern, { kind: "CorePVar" }>): string {
  return pattern.bindingId === undefined
    ? id(pattern.name)
    : bindingName(pattern.name, pattern.bindingId);
}

function bindingName(name: string, bindingId: BindingId): string {
  return `${id(name)}_${bindingId}`;
}

function id(name: string): string {
  if (name.includes(".")) return name.split(".").map(id).join(".");
  return reserved.has(name) ? `_${name}` : name;
}

function primitiveName(name: string): string | undefined {
  switch (name) {
    case "++":
      return "__wm_op_concat";
    case "+":
      return "__wm_op_add";
    case "-":
      return "__wm_op_sub";
    case "*":
      return "__wm_op_mul";
    case "/":
      return "__wm_op_div";
    case "%":
      return "__wm_op_mod";
    case "==":
      return "__wm_op_eq";
    case "!=":
      return "__wm_op_ne";
    case "<":
      return "__wm_op_lt";
    case "<=":
      return "__wm_op_lte";
    case ">":
      return "__wm_op_gt";
    case ">=":
      return "__wm_op_gte";
    case "&&":
      return "__wm_op_and";
    case "||":
      return "__wm_op_or";
    case "!":
      return "__wm_op_not";
    default:
      return undefined;
  }
}
