import type { CoreDecl, CoreExpr, CoreMatchArm, CorePattern } from "./ast.ts";
import type { TypeExpr } from "../ast.ts";
import type { CoreDynamicExport, CoreModuleArtifact, CoreProgram } from "./artifact.ts";
import type { BindingId } from "./ids.ts";
import { basisCtorJsName } from "../basis.ts";
import { emitRuntimePrelude } from "./emit_prelude.ts";
import { emitJsImportDecl, resetJsImportEmitter, setWorkerSpecifiers } from "./emit_js_import.ts";
import { emitJsIdentifier as id } from "./emit_name.ts";

export type CoreEmitTarget = "executable" | "library" | "repl";

export type CoreEmitOptions = {
  target?: CoreEmitTarget;
  workerSpecifiers?: Map<string, string>;
};

export function emitCoreProgram(program: CoreProgram, options: CoreEmitOptions = {}): string {
  resetEmitterState();
  setWorkerSpecifiers(options.workerSpecifiers);
  const entry = program.modules.get(program.entry)!;
  const target = options.target ?? "executable";
  const body = [
    ...emitShaderArtifactTable(program),
    ...program.order
      .filter((path) => path !== program.entry)
      .map((path) => emitNamespace(program.modules.get(path)!, program)),
    ...(target === "repl" ? emitReplModuleBody(entry, program) : emitModuleBody(entry, program)),
    target === "library"
      ? emitLibraryExports(entry)
      : target === "repl"
      ? ""
      : emitMainInvocation(entry),
  ];
  return target === "repl"
    ? [...emitRuntimePrelude(), "try {", ...body, emitReplRuntimeCatch()].join("\n")
    : [...emitRuntimePrelude(), ...body].join("\n");
}

function emitShaderArtifactTable(program: CoreProgram): string[] {
  if (program.shaderArtifacts.size === 0) return [];
  const entries = [...program.shaderArtifacts].map(([artifactId, artifact]) => {
    const descriptor = {
      wgsl: artifact.wgsl,
      vertexEntry: artifact.vertexEntry,
      fragmentEntry: artifact.fragmentEntry,
      uniformLayout: artifact.uniformLayout ?? null,
    };
    return `${JSON.stringify(artifactId)}: ${JSON.stringify(descriptor)}`;
  });
  return [
    "const __wm_deep_freeze_shader_artifact = (value) => {",
    '  if (value && typeof value === "object" && !Object.isFrozen(value)) {',
    "    for (const child of Object.values(value)) __wm_deep_freeze_shader_artifact(child);",
    "    Object.freeze(value);",
    "  }",
    "  return value;",
    "};",
    "const __wm_gpu_wgsl = (artifact) => artifact.wgsl;",
    "const __wm_gpu_vertex_entry_point = (artifact) => artifact.vertexEntry;",
    "const __wm_gpu_fragment_entry_point = (artifact) => artifact.fragmentEntry;",
    "const __wm_shader_artifact_identities = new WeakMap();",
    "const __wm_gpu_artifact_identity = (artifact) => {",
    "  const identity = __wm_shader_artifact_identities.get(artifact);",
    '  if (!identity) throw new Error("value is not a compiler-produced shader artifact");',
    "  return identity;",
    "};",
    "const __wm_gpu_uniform_binding = (artifact) => artifact.uniformLayout?.binding ?? -1;",
    "const __wm_gpu_uniform_byte_length = (artifact) => artifact.uniformLayout?.byteLength ?? 0;",
    "const __wm_gpu_uniform_bytes = (artifact) => artifact.uniformBytes ?? [];",
    "const __wm_bind_shader_artifact = (artifact, environment) => {",
    "  const layout = artifact.uniformLayout;",
    '  if (!layout) throw new Error("static shader artifact cannot bind an environment");',
    '  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {',
    '    throw new Error("shader environment must be a nominal record value");',
    "  }",
    "  const buffer = new ArrayBuffer(layout.byteLength);",
    "  const view = new DataView(buffer);",
    "  for (const field of layout.fields) {",
    "    const value = environment[field.name];",
    '    const width = field.representation === "f32" ? 1 : Number(field.representation.slice(4));',
    "    const values = width === 1 ? [value] : value;",
    '    if (!Array.isArray(values) || values.length !== width || values.some((item) => typeof item !== "number")) {',
    '      throw new Error("shader environment field " + field.name + " does not match " + field.representation);',
    "    }",
    "    for (let lane = 0; lane < width; lane += 1) {",
    "      view.setFloat32(field.offset + lane * 4, values[lane], true);",
    "    }",
    "  }",
    "  const uniformBytes = Object.freeze(Array.from(new Uint8Array(buffer)));",
    "  const bound = Object.freeze({ ...artifact, uniformBytes });",
    "  __wm_shader_artifact_identities.set(bound, __wm_gpu_artifact_identity(artifact));",
    "  return bound;",
    "};",
    `const __wm_shader_artifacts = __wm_deep_freeze_shader_artifact({ ${entries.join(", ")} });`,
    "for (const [identity, artifact] of Object.entries(__wm_shader_artifacts)) {",
    "  __wm_shader_artifact_identities.set(artifact, identity);",
    "}",
  ];
}

function emitReplRuntimeCatch(): string {
  return `} catch (__wm_repl_error) {
  const __wm_repl_error_name = __wm_repl_error instanceof Error ? __wm_repl_error.name : "Error";
  const __wm_repl_error_message = String(__wm_repl_error instanceof Error ? __wm_repl_error.message : __wm_repl_error)
    .replace(/\\s+/g, " ").slice(0, 300);
  console.error("runtime[" + __wm_repl_error_name + "]: " + __wm_repl_error_message);
  Deno.exitCode = 1;
}`;
}

function emitReplModuleBody(entry: CoreModuleArtifact, program: CoreProgram): string[] {
  return [
    ...emitImportAliases(entry, program),
    ...entry.module.decls.flatMap((decl, declIndex) => [
      ...emitDecl(decl),
      ...emitReplPhraseResult(decl, declIndex, entry),
    ]),
  ];
}

function emitReplPhraseResult(
  decl: CoreDecl,
  declIndex: number,
  entry: CoreModuleArtifact,
): string[] {
  if (decl.kind === "CoreType" && decl.exported) return [emitReplTypeDecl(decl)];
  if (decl.kind === "CoreRecord" && decl.exported) return [emitReplRecordDecl(decl)];
  if (decl.kind !== "CoreLet") return [];
  const phraseEnv = entry.analysis.steps.find((step) => step.declIndex === declIndex)?.env;
  return decl.bindings.flatMap((binding) =>
    replPatternBindings(binding.pattern).map((item) =>
      emitReplBinding(item, phraseEnv?.get(item.name)?.type ?? "?")
    )
  );
}

function emitReplBinding(item: CoreDynamicExport, type: string): string {
  return `console.log(${JSON.stringify(`${item.name} = `)} + __wm_repl_show(${
    emitExportRef(item)
  }) + ${JSON.stringify(` : ${type}`)});`;
}

function emitReplTypeDecl(decl: Extract<CoreDecl, { kind: "CoreType" }>): string {
  const params = decl.params.length ? `<${decl.params.join(", ")}>` : "";
  const body = decl.alias ? showTypeExpr(decl.alias) : decl.ctors.map((ctor) => {
    if (!ctor.payload) return ctor.name;
    const args = ctor.payload.kind === "TTuple" ? ctor.payload.items : [ctor.payload];
    return `${ctor.name}<${args.map(showTypeExpr).join(", ")}>`;
  }).join(" | ");
  return `console.log(${JSON.stringify(`type ${decl.name}${params} = ${body}`)});`;
}

function emitReplRecordDecl(decl: Extract<CoreDecl, { kind: "CoreRecord" }>): string {
  const params = decl.params.length ? `<${decl.params.join(", ")}>` : "";
  const fields = decl.fields.map((field) => `${field.name}: ${showTypeExpr(field.type)}`).join(
    ", ",
  );
  return `console.log(${JSON.stringify(`record ${decl.name}${params} = { ${fields} }`)});`;
}

function showTypeExpr(type: TypeExpr): string {
  switch (type.kind) {
    case "TName":
      return type.args.length
        ? `${type.name}<${type.args.map(showTypeExpr).join(", ")}>`
        : type.name;
    case "TVar":
      return type.name;
    case "TTuple":
      return `(${type.items.map(showTypeExpr).join(", ")})`;
    case "TFn":
      return `(${type.params.map(showTypeExpr).join(", ")}) => ${showTypeExpr(type.result)}`;
  }
}

function replPatternBindings(pattern: CorePattern): CoreDynamicExport[] {
  switch (pattern.kind) {
    case "CorePVar":
      return [{ name: pattern.name, bindingId: pattern.bindingId }];
    case "CorePTuple":
      return pattern.items.flatMap(replPatternBindings);
    case "CorePRecord":
      return pattern.fields.flatMap((field) => replPatternBindings(field.pattern));
    case "CorePCtor":
      return pattern.payload ? replPatternBindings(pattern.payload) : [];
    default:
      return [];
  }
}

function resetEmitterState(): void {
  bindingTemp = 0;
  tailLoopTemp = 0;
  tailValueTemp = 0;
  resetJsImportEmitter();
}

function emitMainInvocation(entry: CoreModuleArtifact): string {
  const main = mainRef(entry);
  return `if (typeof ${main} === "function") await ${main}();`;
}

function emitLibraryExports(entry: CoreModuleArtifact): string {
  const publicExports = finalExports(entry.dynamicExports);
  if (publicExports.length === 0) return "export {};";
  const exports = publicExports.map((item) => `  ${emitExportRef(item)} as ${id(item.name)}`);
  return `export {\n${exports.join(",\n")}\n};`;
}

function finalExports(exports: CoreDynamicExport[]): CoreDynamicExport[] {
  const seen = new Set<string>();
  return [...exports].reverse().filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  }).reverse();
}

function emitNamespace(artifact: CoreModuleArtifact, program: CoreProgram): string {
  const body = emitModuleBody(artifact, program).join("\n");
  return `const ${id(artifact.emitName)} = await (async () => {\n${body}\nreturn { ${
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
  if (decl.kind === "CoreJsImport") return emitJsImportDecl(decl);
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
      return `let ${patternBindingName(binding.pattern)} = ${
        emitRecursiveBindingValue(binding.value, binding.pattern.bindingId)
      };`;
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
    case "CoreShaderRef":
      return expr.environment
        ? `__wm_bind_shader_artifact(__wm_shader_artifacts[${JSON.stringify(expr.artifactId)}], ${
          emitExpr(expr.environment)
        })`
        : `__wm_shader_artifacts[${JSON.stringify(expr.artifactId)}]`;
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

function emitRecursiveBindingValue(expr: CoreExpr, bindingId: BindingId | undefined): string {
  if (
    expr.kind !== "CoreFn" || bindingId === undefined ||
    !expr.arms.some((arm) => hasDirectSelfTailCall(arm.body, bindingId))
  ) {
    return emitExpr(expr);
  }
  const label = `__wm_tail_${tailLoopTemp++}`;
  return `(__arg) => {\n${label}: while (true) {\n${
    emitTailArmBody(
      expr.arms,
      "__arg",
      "pattern match failure in function",
      bindingId,
      label,
    )
  }\n}\n}`;
}

function hasDirectSelfTailCall(expr: CoreExpr, bindingId: BindingId): boolean {
  if (
    expr.kind === "CoreApp" && expr.callee.kind === "CoreVar" &&
    expr.callee.bindingId === bindingId
  ) {
    return true;
  }
  if (expr.kind === "CoreIf") {
    return hasDirectSelfTailCall(expr.thenExpr, bindingId) ||
      hasDirectSelfTailCall(expr.elseExpr, bindingId);
  }
  if (expr.kind === "CoreMatch") {
    return expr.arms.some((arm) => hasDirectSelfTailCall(arm.body, bindingId));
  }
  if (expr.kind === "CoreBlock") return hasDirectSelfTailCall(expr.result, bindingId);
  return false;
}

function emitTailExpr(
  expr: CoreExpr,
  bindingId: BindingId,
  label: string,
): string {
  if (
    expr.kind === "CoreApp" && expr.callee.kind === "CoreVar" &&
    expr.callee.bindingId === bindingId
  ) {
    return `__arg = ${emitExpr(expr.arg)};\ncontinue ${label};`;
  }
  if (expr.kind === "CoreIf") {
    return `if (${emitExpr(expr.cond)}) {\n${
      emitTailExpr(expr.thenExpr, bindingId, label)
    }\n} else {\n${emitTailExpr(expr.elseExpr, bindingId, label)}\n}`;
  }
  if (expr.kind === "CoreMatch") {
    const value = `__wm_tail_value_${tailValueTemp++}`;
    return `{\nconst ${value} = ${emitExpr(expr.value)};\n${
      emitTailArmBody(expr.arms, value, "non-exhaustive match", bindingId, label)
    }\n}`;
  }
  if (expr.kind === "CoreBlock") {
    return `{\n${expr.items.map(emitBlockItem).join("\n")}\n${
      emitTailExpr(expr.result, bindingId, label)
    }\n}`;
  }
  return `return ${emitExpr(expr)};`;
}

function emitTailArmBody(
  arms: CoreMatchArm[],
  value: string,
  message: string,
  bindingId: BindingId,
  label: string,
): string {
  const body = arms.map((arm) => {
    const checks = patternChecks(arm.pattern, value);
    const binds = emitPatternBind(arm.pattern, value);
    return `if (${checks.length ? checks.join(" && ") : "true"}) {\n${binds.join("\n")}\n${
      emitTailExpr(arm.body, bindingId, label)
    }\n}`;
  });
  return `${body.join(" else ")}\n__wm_fail("Match", ${JSON.stringify(message)});`;
}

let tailLoopTemp = 0;
let tailValueTemp = 0;

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
    case "Gpu.wgsl":
      return "__wm_gpu_wgsl";
    case "Gpu.vertexEntryPoint":
      return "__wm_gpu_vertex_entry_point";
    case "Gpu.fragmentEntryPoint":
      return "__wm_gpu_fragment_entry_point";
    case "Gpu.artifactIdentity":
      return "__wm_gpu_artifact_identity";
    case "Gpu.uniformBinding":
      return "__wm_gpu_uniform_binding";
    case "Gpu.uniformByteLength":
      return "__wm_gpu_uniform_byte_length";
    case "Gpu.uniformBytes":
      return "__wm_gpu_uniform_bytes";
    default:
      return undefined;
  }
}
