import type { CoreDecl, CoreExpr, CoreMatchArm, CorePattern } from "./ast.ts";
import type { TypeExpr } from "../ast.ts";
import { parseLongId } from "../ast.ts";
import type { CoreDynamicExport, CoreModuleArtifact, CoreProgram } from "./artifact.ts";
import type { BindingId, StructureId } from "./ids.ts";
import { basisCtorJsName } from "../basis.ts";
import {
  basisIntrinsicDescriptor,
  basisIntrinsicDescriptorBySemanticId,
  basisOperatorDescriptor,
  basisUnaryOperatorDescriptor,
} from "../basis_manifest.ts";
import type { CompilerSemanticId } from "../compiler_semantics.ts";
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
  directFns = collectProgramDirectFns(program);
  const target = options.target ?? "executable";
  const standardIds = new Set(program.standardNamespaces?.map((item) => item.id) ?? []);
  const body = [
    ...emitShaderArtifactTable(program),
    ...emitModuleRuntime(),
    ...program.order.map((moduleId) =>
      emitModuleDefinition(program.modules.get(moduleId)!, program, target)
    ),
    ...program.order
      .filter((moduleId) => moduleId !== program.entry && standardIds.has(moduleId))
      .map((moduleId) => emitModuleRequest(program.modules.get(moduleId)!)),
    ...emitStandardNamespaces(program),
    emitModuleRequest(entry),
    target === "library"
      ? emitLibraryExports(entry)
      : target === "repl"
      ? ""
      : emitMainInvocation(entry),
  ];
  return target === "repl"
    ? [...emitRuntimePrelude(), "try {", ...body, emitReplRuntimeCatch()].join("\n")
    : target === "executable"
    ? [...emitRuntimePrelude(), "try {", ...body, emitExecutableRuntimeCatch()].join("\n")
    : [...emitRuntimePrelude(), ...body].join("\n");
}

function emitModuleRuntime(): string[] {
  return [
    "const __wm_module_instances = new globalThis.Map();",
    "const __wm_define_module = (key, dependencies, initialize, publish) => {",
    '  if (__wm_module_instances.has(key)) throw new globalThis.Error("duplicate Workman module instance");',
    "  __wm_module_instances.set(key, {",
    '    state: "uninitialized", dependencies, initialize, publish, value: undefined, error: undefined',
    "  });",
    "};",
    "const __wm_request_module = async (key) => {",
    "  const instance = __wm_module_instances.get(key);",
    '  if (!instance) throw new globalThis.Error("unknown Workman module instance");',
    '  if (instance.state === "completed") return instance.value;',
    '  if (instance.state === "failed") throw instance.error;',
    '  if (instance.state === "initializing") {',
    '    throw new globalThis.Error("cyclic Workman module initialization");',
    "  }",
    '  instance.state = "initializing";',
    "  try {",
    "    for (const dependency of instance.dependencies) {",
    "      await __wm_request_module(dependency);",
    "    }",
    "    const value = await instance.initialize();",
    "    instance.value = value;",
    "    instance.publish(value);",
    '    instance.state = "completed";',
    "    return value;",
    "  } catch (error) {",
    "    instance.error = error;",
    '    instance.state = "failed";',
    "    throw error;",
    "  }",
    "};",
  ];
}

function emitStandardNamespaces(program: CoreProgram): string[] {
  return (program.standardNamespaces ?? []).map((namespace) => {
    if (!namespace.basisName) {
      return `const ${id(namespace.publicName)} = ${id(namespace.emitName)};`;
    }
    const field = (owner: string, name: string) =>
      `${JSON.stringify(name)}: ${id(owner)}[${JSON.stringify(name)}]`;
    const fields = [
      ...namespace.basisMembers.map((name) => field(namespace.basisName!, name)),
      ...namespace.sourceMembers.map((name) => field(namespace.emitName, name)),
    ];
    return `const ${id(namespace.publicName)} = { ${fields.join(", ")} };`;
  });
}

function emitShaderArtifactTable(program: CoreProgram): string[] {
  const entries = [...program.shaderArtifacts].map(([artifactId, artifact]) => {
    const descriptor = {
      wgsl: artifact.wgsl,
      vertexEntry: artifact.vertexEntry,
      fragmentEntry: artifact.fragmentEntry,
      uniformLayout: artifact.uniformLayout ?? null,
      resourceLayout: artifact.resourceLayout ?? null,
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
    "const __wm_gpu_uniform_bytes = (artifact) => artifact.uniformBytes ?? __wm_js_array_mark([]);",
    "const __wm_gpu_binding_count = (artifact) => (artifact.uniformLayout ? 1 : 0) + (artifact.resourceLayout?.bindings.length ?? 0);",
    `const __wm_gpu_texture_brand = Symbol("wm.gpu.texture2d");
const __wm_gpu_sampled_brand = Symbol("wm.gpu.sampled-texture2d");
const __wm_gpu_target_brand = Symbol("wm.gpu.render-target2d");
const __wm_gpu_sampler_brand = Symbol("wm.gpu.sampler");
const __wm_gpu_destroyed_textures = new WeakSet();
const __wm_gpu_result = (thunk) => {
  try { return __wm_basis_Ok(thunk()); }
  catch (error) { return __wm_basis_Err(__wm_js_error(error)); }
};
const __wm_gpu_require = (value, brand, label) => {
  if (!value || typeof value !== "object" || value[brand] !== true) {
    throw new Error("value is not a compiler-produced " + label);
  }
  return value;
};
const __wm_gpu_require_live_texture = (value) => {
  const texture = __wm_gpu_require(value, __wm_gpu_texture_brand, "Gpu.Texture2D");
  if (__wm_gpu_destroyed_textures.has(texture)) throw new Error("Gpu.Texture2D is destroyed");
  return texture;
};
const __wm_gpu_texture_2d = (args) => __wm_gpu_result(() => {
  const [device, width, height] = args;
  if (!device || typeof device.createTexture !== "function" || !device.queue) {
    throw new Error("Gpu.texture2D requires a GPUDevice-like value");
  }
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("Gpu.texture2D dimensions must be positive integers");
  }
  const usage = globalThis.GPUTextureUsage;
  if (!usage) throw new Error("Gpu.texture2D requires WebGPU texture usage constants");
  const raw = device.createTexture({
    size: { width, height, depthOrArrayLayers: 1 },
    dimension: "2d",
    format: "rgba16float",
    mipLevelCount: 1,
    sampleCount: 1,
    usage: usage.TEXTURE_BINDING | usage.RENDER_ATTACHMENT | usage.COPY_DST,
  });
  const texture = Object.freeze({
    [__wm_gpu_texture_brand]: true,
    device,
    raw,
    width,
    height,
    format: "rgba16float",
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({ colorAttachments: [{
    view: raw.createView(),
    loadOp: "clear",
    storeOp: "store",
    clearValue: { r: 0, g: 0, b: 0, a: 0 },
  }] });
  pass.end();
  device.queue.submit([encoder.finish()]);
  return texture;
});
const __wm_gpu_sampled_texture_2d = (value) => __wm_gpu_result(() => {
  const texture = __wm_gpu_require_live_texture(value);
  const view = texture.raw.createView({
    format: "rgba16float", dimension: "2d", aspect: "all",
    baseMipLevel: 0, mipLevelCount: 1,
    baseArrayLayer: 0, arrayLayerCount: 1,
  });
  return Object.freeze({
    [__wm_gpu_sampled_brand]: true,
    kind: "sampled-texture-2d",
    device: texture.device,
    texture,
    view,
  });
});
const __wm_gpu_render_target_2d = (value) => __wm_gpu_result(() => {
  const texture = __wm_gpu_require_live_texture(value);
  const view = texture.raw.createView({
    format: "rgba16float", dimension: "2d", aspect: "all",
    baseMipLevel: 0, mipLevelCount: 1,
    baseArrayLayer: 0, arrayLayerCount: 1,
  });
  return Object.freeze({
    [__wm_gpu_target_brand]: true,
    device: texture.device,
    texture,
    view,
  });
});
const __wm_gpu_sampler = (device, filter) => __wm_gpu_result(() => {
  if (!device || typeof device.createSampler !== "function") {
    throw new Error("Gpu sampler creation requires a GPUDevice-like value");
  }
  const raw = device.createSampler({
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    addressModeW: "clamp-to-edge",
    magFilter: filter,
    minFilter: filter,
    mipmapFilter: filter,
  });
  return Object.freeze({ [__wm_gpu_sampler_brand]: true, kind: "sampler", device, raw, filter });
});
const __wm_gpu_nearest_sampler = (device) => __wm_gpu_sampler(device, "nearest");
const __wm_gpu_linear_sampler = (device) => __wm_gpu_sampler(device, "linear");
const __wm_gpu_destroy_texture_2d = (value) => __wm_gpu_result(() => {
  const texture = __wm_gpu_require(value, __wm_gpu_texture_brand, "Gpu.Texture2D");
  if (!__wm_gpu_destroyed_textures.has(texture)) {
    texture.raw.destroy();
    __wm_gpu_destroyed_textures.add(texture);
  }
  return undefined;
});
const __wm_gpu_bound_resource = (field, value) => {
  const brand = field.kind === "sampled-texture-2d" ? __wm_gpu_sampled_brand : __wm_gpu_sampler_brand;
  const label = field.kind === "sampled-texture-2d" ? "Gpu.SampledTexture2D" : "Gpu.Sampler";
  const resource = __wm_gpu_require(value, brand, label);
  if (resource.kind !== field.kind) throw new Error("shader resource field " + field.name + " has the wrong kind");
  if (resource.texture && __wm_gpu_destroyed_textures.has(resource.texture)) {
    throw new Error("shader resource field " + field.name + " uses a destroyed texture");
  }
  return Object.freeze({ field, resource });
};
const __wm_gpu_bind_group_entries = (args) => __wm_gpu_result(() => {
  const [artifact, device, uniformOption] = args;
  __wm_gpu_artifact_identity(artifact);
  const uniformBuffer = __wm_js_option_unwrap(uniformOption);
  const entries = [];
  if (artifact.uniformLayout) {
    if (!uniformBuffer) throw new Error("shader requires a uniform buffer");
    entries.push({ binding: artifact.uniformLayout.binding, resource: { buffer: uniformBuffer } });
  } else if (uniformBuffer !== undefined) {
    throw new Error("shader without uniforms received a uniform buffer");
  }
  const expected = artifact.resourceLayout?.bindings ?? [];
  const bound = artifact.resourceBindings ?? [];
  if (expected.length !== bound.length) throw new Error("bound fragment has incomplete GPU resources");
  for (let index = 0; index < expected.length; index += 1) {
    const item = bound[index];
    if (item.field.binding !== expected[index].binding || item.resource.device !== device) {
      throw new Error("shader resource belongs to a different device or layout");
    }
    if (item.resource.texture && __wm_gpu_destroyed_textures.has(item.resource.texture)) {
      throw new Error("shader resource uses a destroyed texture");
    }
    entries.push({
      binding: item.field.binding,
      resource: item.field.kind === "sampler" ? item.resource.raw : item.resource.view,
    });
  }
  return entries;
});
const __wm_gpu_render_target_view = (value) => __wm_gpu_result(() => {
  const target = __wm_gpu_require(value, __wm_gpu_target_brand, "Gpu.RenderTarget2D");
  __wm_gpu_require_live_texture(target.texture);
  return target.view;
});
const __wm_gpu_validate_render_target = (args) => __wm_gpu_result(() => {
  const [artifact, value, device] = args;
  __wm_gpu_artifact_identity(artifact);
  const target = __wm_gpu_require(value, __wm_gpu_target_brand, "Gpu.RenderTarget2D");
  __wm_gpu_require_live_texture(target.texture);
  if (target.device !== device) throw new Error("render target belongs to a different device");
  for (const item of artifact.resourceBindings ?? []) {
    if (item.resource.texture === target.texture) {
      throw new Error("fragment cannot sample the texture used as its render target");
    }
  }
  return undefined;
});`,
    "const __wm_bind_shader_artifact = (artifact, environment) => {",
    "  const layout = artifact.uniformLayout;",
    "  const resourceLayout = artifact.resourceLayout;",
    '  if (!layout && !resourceLayout) throw new Error("static shader artifact cannot bind an environment");',
    '  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {',
    '    throw new Error("shader environment must be a nominal record value");',
    "  }",
    "  const buffer = layout ? new ArrayBuffer(layout.byteLength) : undefined;",
    "  const view = buffer ? new DataView(buffer) : undefined;",
    "  for (const field of layout?.fields ?? []) {",
    "    const value = environment[field.name];",
    '    const width = field.representation.includes("x") ? Number(field.representation.at(-1)) : 1;',
    "    const values = width === 1 ? [value] : value;",
    '    if (!Array.isArray(values) || values.length !== width || values.some((item) => typeof item !== "number")) {',
    '      throw new Error("shader environment field " + field.name + " does not match " + field.representation);',
    "    }",
    "    for (let lane = 0; lane < width; lane += 1) {",
    '      if (field.representation.startsWith("i32")) {',
    "        const laneValue = values[lane];",
    "        if (!Number.isInteger(laneValue) || laneValue < -2147483648 || laneValue > 2147483647) {",
    '          throw new Error("shader environment field " + field.name + " is outside signed i32 range");',
    "        }",
    "        view.setInt32(field.offset + lane * 4, laneValue, true);",
    "      } else {",
    "        view.setFloat32(field.offset + lane * 4, values[lane], true);",
    "      }",
    "    }",
    "  }",
    // Marked before freezing: a frozen array cannot take the Js.Array mark
    // afterwards, and an unmarked array reads as a tuple.
    "  const uniformBytes = buffer" +
    " ? Object.freeze(__wm_js_array_mark(Array.from(new Uint8Array(buffer))))" +
    " : undefined;",
    "  const resourceBindings = Object.freeze((resourceLayout?.bindings ?? []).map((field) =>",
    "    __wm_gpu_bound_resource(field, environment[field.name])",
    "  ));",
    "  const bound = Object.freeze({",
    "    ...artifact,",
    "    ...(uniformBytes ? { uniformBytes } : {}),",
    "    ...(resourceLayout ? { resourceBindings } : {}),",
    "  });",
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

function emitExecutableRuntimeCatch(): string {
  return `} catch (__wm_runtime_error) {
  if (!(__wm_runtime_error instanceof Error) || __wm_runtime_error.name !== "TypedHole") {
    throw __wm_runtime_error;
  }
  console.error(__wm_runtime_error.message);
  if (globalThis.Deno) Deno.exitCode = 1;
  else throw __wm_runtime_error;
}`;
}

function emitReplModuleBody(entry: CoreModuleArtifact, program: CoreProgram): string[] {
  const emittedAliases = new Set<string>();
  return entry.module.decls.flatMap((decl, declIndex) =>
    decl.kind === "CoreImport" ? emitImportAliases(decl, entry, program, emittedAliases) : [
      ...emitDecl(decl),
      ...emitReplPhraseResult(decl, declIndex, entry),
    ]
  );
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
  const functionDomain = (params: TypeExpr[]): string => {
    if (params.length === 0) return "Void";
    if (params.length > 1) return `(${params.map(showTypeExpr).join(", ")})`;
    const rendered = showTypeExpr(params[0]);
    return params[0].kind === "TFn" ? `(${rendered})` : rendered;
  };
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
      return `${functionDomain(type.params)} -> ${showTypeExpr(type.result)}`;
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
  returnValueTemp = 0;
  scalarTupleTemp = 0;
  resetJsImportEmitter();
}

function emitMainInvocation(entry: CoreModuleArtifact): string {
  const main = `${id(entry.emitName)}[${JSON.stringify("main")}]`;
  return `if (typeof ${main} === "function") await ${main}();`;
}

function emitLibraryExports(entry: CoreModuleArtifact): string {
  const publicExports = finalExports(entry.dynamicExports);
  if (publicExports.length === 0) return "export {};";
  const bindings = publicExports.map((item, index) =>
    `const __wm_library_export_${index} = ${id(entry.emitName)}[${JSON.stringify(item.name)}];`
  );
  const exports = publicExports.map((item, index) =>
    `  __wm_library_export_${index} as ${id(item.name)}`
  );
  return `${bindings.join("\n")}\nexport {\n${exports.join(",\n")}\n};`;
}

function finalExports(exports: CoreDynamicExport[]): CoreDynamicExport[] {
  const seen = new Set<string>();
  return [...exports].reverse().filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  }).reverse();
}

function emitModuleDefinition(
  artifact: CoreModuleArtifact,
  program: CoreProgram,
  target: CoreEmitTarget,
): string {
  const body = artifact === program.modules.get(program.entry) &&
      target === "repl"
    ? emitReplModuleBody(artifact, program).join("\n")
    : emitModuleBody(artifact, program).join("\n");
  const dependencies = artifact.imports.map((edge) =>
    JSON.stringify(program.modules.get(edge.target)!.emitName)
  );
  return `let ${id(artifact.emitName)};
__wm_define_module(
  ${JSON.stringify(artifact.emitName)},
  [${dependencies.join(", ")}],
  async () => {
${body}
return { ${
    finalExports(artifact.dynamicExports).flatMap((item) => {
      const entries = [`${JSON.stringify(item.name)}: ${emitExportRef(item)}`];
      const direct = ownedDirectFn(item, artifact.emitName);
      if (direct) {
        entries.push(`${JSON.stringify(item.name + direct.exportKey)}: ${direct.name}`);
      }
      return entries;
    })
      .join(", ")
  } };
  },
  (value) => { ${id(artifact.emitName)} = value; },
);`;
}

function emitModuleRequest(artifact: CoreModuleArtifact): string {
  return `await __wm_request_module(${JSON.stringify(artifact.emitName)});`;
}

function emitModuleBody(artifact: CoreModuleArtifact, program: CoreProgram): string[] {
  const emittedAliases = new Set<string>();
  return artifact.module.decls.flatMap((decl) =>
    decl.kind === "CoreImport"
      ? emitImportAliases(decl, artifact, program, emittedAliases)
      : emitDecl(decl)
  );
}

function emitImportAliases(
  decl: Extract<CoreDecl, { kind: "CoreImport" }>,
  artifact: CoreModuleArtifact,
  program: CoreProgram,
  emittedAliases: Set<string>,
): string[] {
  const aliases: string[] = [];
  const target = decl.target ??
    artifact.imports.find((edge) => edge.specifierNode === decl.node)?.target;
  if (!target) throw new Error(`unresolved Core import ${decl.path}`);
  const imported = program.modules.get(target)!;
  if (decl.clause.kind === "Namespace") {
    const alias = valueRefName(decl.clause.alias, decl.structureId);
    if (!emittedAliases.has(alias)) {
      emittedAliases.add(alias);
      aliases.push(`const ${alias} = ${id(imported.emitName)};`);
    }
    return aliases;
  }
  if (decl.clause.kind === "All") {
    for (const item of finalExports(imported.dynamicExports)) {
      emitImportedValueAlias(aliases, emittedAliases, imported, item, item.name);
    }
    return aliases;
  }
  for (const spec of decl.clause.specs) {
    const item = imported.dynamicExports.find((item) => item.name === spec.name);
    if (item) {
      emitImportedValueAlias(
        aliases,
        emittedAliases,
        imported,
        item,
        spec.alias ?? spec.name,
      );
    }
  }
  return aliases;
}

function emitImportedValueAlias(
  aliases: string[],
  emittedAliases: Set<string>,
  imported: CoreModuleArtifact,
  item: CoreDynamicExport,
  localName: string,
): void {
  const alias = dynamicExportLocalRef(item, localName);
  if (emittedAliases.has(alias)) return;
  emittedAliases.add(alias);
  aliases.push(
    `const ${alias} = ${id(imported.emitName)}[${JSON.stringify(item.name)}];`,
  );
  const direct = ownedDirectFn(item, imported.emitName);
  if (direct) {
    aliases.push(
      `const ${direct.name} = ${id(imported.emitName)}[${
        JSON.stringify(item.name + direct.exportKey)
      }];`,
    );
  }
}

/**
 * Arity raising.
 *
 * Workman is an SML: a function takes one tuple argument, so the tupled entry
 * point must stay for first-class and partial use. But a call to a statically
 * known function with a literal tuple of matching arity need not materialize
 * that tuple. Eligible functions get a second multi-parameter entry point, and
 * such call sites target it directly.
 *
 * This is collected across the whole program rather than per module. Binding
 * ids are program-global, and an imported value is aliased under the exporting
 * module's binding id, so a call site in any module resolves to the same entry.
 * That matters because the hot calls in the generated parser are cross-module.
 */
type DirectFn = { name: string; arity: number; owner: string; exportKey: string };

let directFns = new Map<BindingId | StructureId, DirectFn>();

function arityRaiseCandidate(
  binding: { pattern: CorePattern; value: CoreExpr },
  owner: string,
): { bindingId: BindingId; direct: DirectFn } | undefined {
  const pattern = binding.pattern;
  if (pattern.kind !== "CorePVar" || pattern.bindingId === undefined) return undefined;
  const value = binding.value;
  if (value.kind !== "CoreFn" || value.arms.length !== 1) return undefined;
  const arm = value.arms[0];
  if (arm.pattern.kind !== "CorePTuple") return undefined;
  const items = arm.pattern.items;
  if (items.length < 2) return undefined;
  // Only simple destructuring: anything else carries runtime checks the direct
  // entry point would have to reproduce.
  if (!items.every((item) => item.kind === "CorePVar" || item.kind === "CorePWildcard")) {
    return undefined;
  }
  const suffix = `__wm_d${items.length}`;
  return {
    bindingId: pattern.bindingId,
    direct: {
      name: `${bindingName(pattern.name, pattern.bindingId)}${suffix}`,
      arity: items.length,
      owner,
      exportKey: suffix,
    },
  };
}

function collectProgramDirectFns(program: CoreProgram): Map<BindingId | StructureId, DirectFn> {
  const found = new Map<BindingId | StructureId, DirectFn>();
  for (const moduleId of program.order) {
    const artifact = program.modules.get(moduleId)!;
    for (const decl of artifact.module.decls) {
      collectDirectFnsInDecl(decl, artifact.emitName, found);
    }
  }
  return found;
}

function collectDirectFnsInDecl(
  decl: CoreDecl,
  owner: string,
  found: Map<BindingId | StructureId, DirectFn>,
): void {
  if (decl.kind !== "CoreLet") return;
  for (const binding of decl.bindings) {
    const candidate = arityRaiseCandidate(binding, owner);
    if (candidate) found.set(candidate.bindingId, candidate.direct);
    collectDirectFnsInExpr(binding.value, owner, found);
  }
}

function collectDirectFnsInExpr(
  expr: CoreExpr,
  owner: string,
  found: Map<BindingId | StructureId, DirectFn>,
): void {
  if (expr.kind === "CoreFn") {
    for (const arm of expr.arms) collectDirectFnsInExpr(arm.body, owner, found);
  } else if (expr.kind === "CoreTuple") {
    for (const item of expr.items) collectDirectFnsInExpr(item, owner, found);
  } else if (expr.kind === "CoreRecord") {
    for (const field of expr.fields) collectDirectFnsInExpr(field.value, owner, found);
  } else if (expr.kind === "CoreRecordAccess") {
    collectDirectFnsInExpr(expr.record, owner, found);
  } else if (expr.kind === "CoreJsonObject") {
    for (const field of expr.fields) collectDirectFnsInExpr(field.value, owner, found);
  } else if (expr.kind === "CoreJsonArray") {
    for (const item of expr.items) collectDirectFnsInExpr(item, owner, found);
  } else if (expr.kind === "CoreApp") {
    collectDirectFnsInExpr(expr.callee, owner, found);
    collectDirectFnsInExpr(expr.arg, owner, found);
  } else if (expr.kind === "CoreIf") {
    collectDirectFnsInExpr(expr.cond, owner, found);
    collectDirectFnsInExpr(expr.thenExpr, owner, found);
    collectDirectFnsInExpr(expr.elseExpr, owner, found);
  } else if (expr.kind === "CoreMatch") {
    collectDirectFnsInExpr(expr.value, owner, found);
    for (const arm of expr.arms) collectDirectFnsInExpr(arm.body, owner, found);
  } else if (expr.kind === "CorePanic") {
    collectDirectFnsInExpr(expr.message, owner, found);
  } else if (expr.kind === "CoreBlock") {
    for (const item of expr.items) {
      if (isDecl(item)) collectDirectFnsInDecl(item, owner, found);
      else collectDirectFnsInExpr(item, owner, found);
    }
    collectDirectFnsInExpr(expr.result, owner, found);
  } else if (expr.kind === "CoreShaderRef" && expr.environment) {
    collectDirectFnsInExpr(expr.environment, owner, found);
  }
}

function emitArityRaisedBinding(
  binding: { pattern: Extract<CorePattern, { kind: "CorePVar" }>; value: CoreExpr },
  direct: DirectFn,
): string[] {
  const fn = binding.value as Extract<CoreExpr, { kind: "CoreFn" }>;
  const arm = fn.arms[0];
  const items = (arm.pattern as Extract<CorePattern, { kind: "CorePTuple" }>).items;
  const params = items.map((item, index) =>
    item.kind === "CorePVar" ? patternBindingName(item) : `__wm_unused_${index}`
  );
  const forwarded = params.map((_, index) => `__arg[${index}]`).join(", ");
  return [
    `const ${direct.name} = (${params.join(", ")}) => {\n${emitReturnExpr(arm.body)}\n};`,
    `const ${patternBindingName(binding.pattern)} = (__arg) => {\n` +
    `if (__wm_is_tuple(__arg) && __arg.length === ${direct.arity}) return ${direct.name}(${forwarded});\n` +
    `__wm_fail("Match", "pattern match failure in function");\n};`,
  ];
}

/** Direct entry point for an exported binding this module actually defines. */
function ownedDirectFn(item: CoreDynamicExport, owner: string): DirectFn | undefined {
  if (item.bindingId === undefined) return undefined;
  const direct = directFns.get(item.bindingId);
  return direct && direct.owner === owner ? direct : undefined;
}

function emitDecl(decl: CoreDecl): string[] {
  if (decl.kind === "CoreImport") return [];
  if (decl.kind === "CoreJsImport") return emitJsImportDecl(decl);
  if (decl.kind === "CoreRecord") {
    const argument = "__record_args";
    const fieldValue = (index: number) => {
      if (decl.fields.length === 1) return argument;
      return `${argument}[${index}]`;
    };
    const fields = decl.fields.map((field, index) => `${id(field.name)}: ${fieldValue(index)}`);
    return [
      `const ${valueRefName(decl.name, decl.constructorBindingId)} = (${argument}) => ({ ${
        fields.join(", ")
      } });`,
    ];
  }
  if (decl.kind === "CoreType") {
    if (decl.alias) return [];
    return decl.ctors.map((ctor) => {
      const ctorId = ctor.id ?? ctor.name;
      const name = ctorRefName(ctor.name, ctor.id);
      return ctor.payload
        ? `const ${name} = (__payload) => ({ ctor: ${JSON.stringify(ctorId)}, name: ${
          JSON.stringify(ctor.name)
        }, args: [__payload] });`
        : `const ${name} = Object.freeze({ ctor: ${JSON.stringify(ctorId)}, name: ${
          JSON.stringify(ctor.name)
        }, args: [] });`;
    });
  }
  if (decl.recursive) {
    return decl.bindings.flatMap((binding) => {
      if (binding.pattern.kind !== "CorePVar") {
        throw new Error("recursive bindings must bind one name");
      }
      const direct = binding.pattern.bindingId === undefined
        ? undefined
        : directFns.get(binding.pattern.bindingId);
      if (direct && binding.pattern.bindingId !== undefined) {
        return emitArityRaisedRecursiveBinding(
          { pattern: binding.pattern, value: binding.value, bindingId: binding.pattern.bindingId },
          direct,
        );
      }
      return [
        `let ${patternBindingName(binding.pattern)} = ${
          emitRecursiveBindingValue(binding.value, binding.pattern.bindingId)
        };`,
      ];
    });
  }
  return decl.bindings.flatMap((binding) => {
    if (binding.pattern.kind === "CorePVar") {
      const direct = binding.pattern.bindingId === undefined
        ? undefined
        : directFns.get(binding.pattern.bindingId);
      if (direct) {
        return emitArityRaisedBinding(
          { pattern: binding.pattern, value: binding.value },
          direct,
        );
      }
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
        return ctorRefName(expr.name, expr.ctorId);
      }
      return primitiveName(expr.name, expr.semanticId) ?? valueRefName(expr.name, expr.bindingId);
    }
    case "CoreTuple":
      return `[${expr.items.map(emitExpr).join(", ")}]`;
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
    case "CoreApp": {
      const primitive = emitPrimitiveOperatorApp(expr);
      if (primitive) return primitive;
      if (expr.callee.kind === "CoreVar" && expr.callee.bindingId !== undefined) {
        const direct = directFns.get(expr.callee.bindingId);
        if (direct && expr.arg.kind === "CoreTuple" && expr.arg.items.length === direct.arity) {
          return `${direct.name}(${expr.arg.items.map(emitExpr).join(", ")})`;
        }
      }
      const callee = emitExpr(expr.callee);
      return `${expr.callee.kind === "CoreFn" ? `(${callee})` : callee}(${emitExpr(expr.arg)})`;
    }
    case "CoreIf":
      return `(${emitExpr(expr.cond)} ? ${emitExpr(expr.thenExpr)} : ${emitExpr(expr.elseExpr)})`;
    case "CoreMatch":
      if (canScalarizeTupleMatch(expr)) {
        const values = scalarTupleValueNames(expr.value.items.length);
        return `((${values.join(", ")}) => {\n${
          emitScalarTupleArmBody(expr.arms, values, "non-exhaustive match", emitReturnExpr)
        }\n})(${expr.value.items.map(emitExpr).join(", ")})`;
      }
      return `((__v) => {\n${
        emitArmBody(expr.arms, "__v", "non-exhaustive match", literalTupleArity(expr.value))
      }\n})(${emitExpr(expr.value)})`;
    case "CorePanic":
      return expr.hole
        ? `__wm_fail("TypedHole", ${JSON.stringify(typedHoleRuntimeMessage(expr))})`
        : `__wm_fail("Panic", ${emitExpr(expr.message)})`;
    case "CoreBlock":
      return `(() => {\n${expr.items.map(emitBlockItem).join("\n")}\nreturn ${
        emitExpr(expr.result)
      };\n})()`;
  }
}

function typedHoleRuntimeMessage(expr: Extract<CoreExpr, { kind: "CorePanic" }>): string {
  const hole = expr.hole!;
  const line = expr.node?.span.line ?? 1;
  const col = expr.node?.span.col ?? 0;
  const gutter = `${line}| `;
  return `error[type.typed-hole ${hole.path}:${line}:${col}]: typed hole; expected type: ${hole.expectedType}\n` +
    `${gutter}${hole.lineText}\n${" ".repeat(gutter.length + col)}^`;
}

function emitPrimitiveOperatorApp(
  expr: Extract<CoreExpr, { kind: "CoreApp" }>,
): string | undefined {
  if (
    expr.callee.kind !== "CoreVar" || expr.arg.kind !== "CoreTuple" || expr.arg.items.length !== 2
  ) {
    return undefined;
  }
  const operator = basisOperatorDescriptor(expr.callee.name);
  if (!operator) return undefined;
  const [leftExpr, rightExpr] = expr.arg.items;
  const left = emitExpr(leftExpr);
  const right = emitExpr(rightExpr);
  switch (operator.spelling) {
    case "+":
    case "-":
    case "*":
    case "/":
    case "%":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return `(${left} ${operator.spelling} ${right})`;
    case "++":
      return `(${left} + ${right})`;
    case "==":
      return `__wm_eq(${left}, ${right})`;
    case "!=":
      return `!__wm_eq(${left}, ${right})`;
    // Workman operators are eager because applications evaluate their tuple
    // argument before the call. Keep that behavior for JavaScript's normally
    // short-circuiting operators while still avoiding tuple allocation.
    case "&&":
    case "||":
      if (!operator.directRuntimeName) {
        throw new Error(`basis operator ${operator.spelling} has no direct runtime name`);
      }
      return `${operator.directRuntimeName}(${left}, ${right})`;
  }
}

/**
 * Specialize a recursive binding. When the body tail-calls itself the loop runs
 * over the parameters directly, so a self tail call assigns them instead of
 * rebuilding the argument tuple on every iteration.
 */
function emitArityRaisedRecursiveBinding(
  binding: {
    pattern: Extract<CorePattern, { kind: "CorePVar" }>;
    value: CoreExpr;
    bindingId: BindingId;
  },
  direct: DirectFn,
): string[] {
  const fn = binding.value as Extract<CoreExpr, { kind: "CoreFn" }>;
  const arm = fn.arms[0];
  const items = (arm.pattern as Extract<CorePattern, { kind: "CorePTuple" }>).items;
  // The parameters are the bound names themselves, so no destructuring is
  // needed at the top of the specialized entry point.
  const params = items.map((item, index) =>
    item.kind === "CorePVar" ? patternBindingName(item) : `__wm_unused_${index}`
  );
  const body = hasDirectSelfTailCall(arm.body, binding.bindingId)
    ? (() => {
      const label = `__wm_tail_${tailLoopTemp++}`;
      return `${label}: while (true) {\n${
        emitTailExpr(arm.body, binding.bindingId, label, params)
      }\n}`;
    })()
    : emitReturnExpr(arm.body);
  const forwarded = params.map((_, index) => `__arg[${index}]`).join(", ");
  return [
    `const ${direct.name} = (${params.join(", ")}) => {\n${body}\n};`,
    `const ${patternBindingName(binding.pattern)} = (__arg) => {\n` +
    `if (__wm_is_tuple(__arg) && __arg.length === ${direct.arity}) return ${direct.name}(${forwarded});\n` +
    `__wm_fail("Match", "pattern match failure in function");\n};`,
  ];
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
  if (expr.kind === "CoreBlock") {
    return hasDirectSelfTailCall(expr.result, bindingId) ||
      !!finalDiscardedExpr(expr) &&
        hasDirectSelfTailCall(finalDiscardedExpr(expr)!, bindingId);
  }
  return false;
}

function emitTailExpr(
  expr: CoreExpr,
  bindingId: BindingId,
  label: string,
  tailParams?: readonly string[],
): string {
  if (
    expr.kind === "CoreApp" && expr.callee.kind === "CoreVar" &&
    expr.callee.bindingId === bindingId
  ) {
    if (tailParams) {
      const slot = tailValueTemp++;
      // Stage into temporaries so the assignments are simultaneous.
      if (expr.arg.kind === "CoreTuple" && expr.arg.items.length === tailParams.length) {
        const staged = expr.arg.items.map((item, index) =>
          `const __wm_tail_arg_${slot}_${index} = ${emitExpr(item)};`
        );
        const assigned = tailParams.map((param, index) =>
          `${param} = __wm_tail_arg_${slot}_${index};`
        );
        return `{\n${staged.join("\n")}\n${assigned.join("\n")}\ncontinue ${label};\n}`;
      }
      const source = `__wm_tail_arg_${slot}`;
      return `{\nconst ${source} = ${emitExpr(expr.arg)};\n${
        tailParams.map((param, index) => `${param} = ${source}[${index}];`).join("\n")
      }\ncontinue ${label};\n}`;
    }
    return `__arg = ${emitExpr(expr.arg)};\ncontinue ${label};`;
  }
  if (expr.kind === "CoreIf") {
    return `if (${emitExpr(expr.cond)}) {\n${
      emitTailExpr(expr.thenExpr, bindingId, label, tailParams)
    }\n} else {\n${emitTailExpr(expr.elseExpr, bindingId, label, tailParams)}\n}`;
  }
  if (expr.kind === "CoreMatch") {
    if (canScalarizeTupleMatch(expr)) {
      const values = scalarTupleValueNames(expr.value.items.length);
      const declarations = values.map((value, index) =>
        `const ${value} = ${emitExpr(expr.value.items[index])};`
      );
      return `{\n${declarations.join("\n")}\n${
        emitScalarTupleTailArmBody(
          expr.arms,
          values,
          "non-exhaustive match",
          bindingId,
          label,
          tailParams,
        )
      }\n}`;
    }
    const value = `__wm_tail_value_${tailValueTemp++}`;
    return `{\nconst ${value} = ${emitExpr(expr.value)};\n${
      emitTailArmBody(
        expr.arms,
        value,
        "non-exhaustive match",
        bindingId,
        label,
        tailParams,
        literalTupleArity(expr.value),
      )
    }\n}`;
  }
  if (expr.kind === "CoreBlock") {
    const discardedTail = finalDiscardedExpr(expr);
    if (discardedTail && hasDirectSelfTailCall(discardedTail, bindingId)) {
      return `{\n${expr.items.slice(0, -1).map(emitBlockItem).join("\n")}\n${
        emitTailExpr(discardedTail, bindingId, label, tailParams)
      }\n}`;
    }
    return `{\n${expr.items.map(emitBlockItem).join("\n")}\n${
      emitTailExpr(expr.result, bindingId, label, tailParams)
    }\n}`;
  }
  return `return ${emitExpr(expr)};`;
}

function finalDiscardedExpr(expr: Extract<CoreExpr, { kind: "CoreBlock" }>): CoreExpr | undefined {
  if (expr.result.kind !== "CoreVoid") return undefined;
  const last = expr.items.at(-1);
  return last && !isDecl(last) ? last : undefined;
}

function emitTailArmBody(
  arms: CoreMatchArm[],
  value: string,
  message: string,
  bindingId: BindingId,
  label: string,
  tailParams?: readonly string[],
  knownTupleArity?: number,
): string {
  const body = arms.map((arm) => {
    const checks = patternChecks(arm.pattern, value, knownTupleArity);
    const binds = emitPatternBind(arm.pattern, value);
    return `if (${checks.length ? checks.join(" && ") : "true"}) {\n${binds.join("\n")}\n${
      emitTailExpr(arm.body, bindingId, label, tailParams)
    }\n}`;
  });
  return `${body.join(" else ")}\n__wm_fail("Match", ${JSON.stringify(message)});`;
}

let tailLoopTemp = 0;
let tailValueTemp = 0;
let returnValueTemp = 0;
let scalarTupleTemp = 0;

function emitReturnExpr(expr: CoreExpr): string {
  if (expr.kind === "CoreBlock") {
    return `${expr.items.map(emitBlockItem).join("\n")}\n${emitReturnExpr(expr.result)}`;
  }
  if (expr.kind === "CoreIf") {
    return `if (${emitExpr(expr.cond)}) {\n${emitReturnExpr(expr.thenExpr)}\n} else {\n${
      emitReturnExpr(expr.elseExpr)
    }\n}`;
  }
  if (expr.kind === "CoreMatch") {
    if (canScalarizeTupleMatch(expr)) {
      const values = scalarTupleValueNames(expr.value.items.length);
      const declarations = values.map((value, index) =>
        `const ${value} = ${emitExpr(expr.value.items[index])};`
      );
      return `${declarations.join("\n")}\n${
        emitScalarTupleArmBody(expr.arms, values, "non-exhaustive match", emitReturnExpr)
      }`;
    }
    const value = `__wm_return_value_${returnValueTemp++}`;
    return `const ${value} = ${emitExpr(expr.value)};\n${
      emitReturnArmBody(expr.arms, value, "non-exhaustive match", literalTupleArity(expr.value))
    }`;
  }
  return `return ${emitExpr(expr)};`;
}

function emitReturnArmBody(
  arms: CoreMatchArm[],
  value: string,
  message: string,
  knownTupleArity?: number,
): string {
  const body = arms.map((arm) => {
    const checks = patternChecks(arm.pattern, value, knownTupleArity);
    const binds = emitPatternBind(arm.pattern, value);
    return `if (${checks.length ? checks.join(" && ") : "true"}) {\n${binds.join("\n")}\n${
      emitReturnExpr(arm.body)
    }\n}`;
  });
  return `${body.join(" else ")}\n__wm_fail("Match", ${JSON.stringify(message)});`;
}

function emitArmBody(
  arms: CoreMatchArm[],
  value: string,
  message: string,
  knownTupleArity?: number,
): string {
  const body = arms.map((arm) => {
    const checks = patternChecks(arm.pattern, value, knownTupleArity);
    const binds = emitPatternBind(arm.pattern, value);
    return `if (${checks.length ? checks.join(" && ") : "true"}) {\n${binds.join("\n")}\n${
      emitReturnExpr(arm.body)
    }\n}`;
  });
  return `${body.join(" else ")}\n__wm_fail("Match", ${JSON.stringify(message)});`;
}

function canScalarizeTupleMatch(
  expr: Extract<CoreExpr, { kind: "CoreMatch" }>,
): expr is Extract<CoreExpr, { kind: "CoreMatch" }> & {
  value: Extract<CoreExpr, { kind: "CoreTuple" }>;
} {
  if (expr.value.kind !== "CoreTuple") return false;
  const arity = expr.value.items.length;
  return expr.arms.every((arm) =>
    arm.pattern.kind === "CorePTuple" && arm.pattern.items.length === arity
  );
}

function scalarTupleValueNames(arity: number): string[] {
  const slot = scalarTupleTemp++;
  return Array.from({ length: arity }, (_, index) => `__wm_scalar_${slot}_${index}`);
}

function emitScalarTupleArmBody(
  arms: CoreMatchArm[],
  values: readonly string[],
  message: string,
  emitBody: (expr: CoreExpr) => string,
): string {
  const body = arms.map((arm) => {
    if (arm.pattern.kind !== "CorePTuple" || arm.pattern.items.length !== values.length) {
      throw new Error("scalar tuple match requires fixed-arity tuple patterns");
    }
    const checks = arm.pattern.items.flatMap((item, index) => patternChecks(item, values[index]));
    const binds = arm.pattern.items.flatMap((item, index) => emitPatternBind(item, values[index]));
    return `if (${checks.length ? checks.join(" && ") : "true"}) {\n${binds.join("\n")}\n${
      emitBody(arm.body)
    }\n}`;
  });
  return `${body.join(" else ")}\n__wm_fail("Match", ${JSON.stringify(message)});`;
}

function emitScalarTupleTailArmBody(
  arms: CoreMatchArm[],
  values: readonly string[],
  message: string,
  bindingId: BindingId,
  label: string,
  tailParams?: readonly string[],
): string {
  return emitScalarTupleArmBody(
    arms,
    values,
    message,
    (body) => emitTailExpr(body, bindingId, label, tailParams),
  );
}

function emitBlockItem(item: CoreDecl | CoreExpr): string {
  return isDecl(item) ? emitDecl(item).join("\n") : `${emitExpr(item)};`;
}

// A scrutinee written as a tuple literal has a shape the arms cannot fail on,
// which lets patternChecks drop the per-arm `__wm_is_tuple`/length guards.
function literalTupleArity(expr: CoreExpr): number | undefined {
  return expr.kind === "CoreTuple" ? expr.items.length : undefined;
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

function patternChecks(
  pattern: CorePattern,
  value: string,
  knownTupleArity?: number,
): string[] {
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
      return [`__wm_eq(${value}, ${pinnedPatternValueRef(pattern)})`];
    case "CorePTuple": {
      const items = pattern.items.flatMap((item, index) =>
        patternChecks(item, `${value}[${index}]`)
      );
      // When the scrutinee is a tuple literal of this arity the shape guards are
      // statically true, and every arm of the match would otherwise re-test them.
      if (knownTupleArity === pattern.items.length) return items;
      return [
        `__wm_is_tuple(${value})`,
        `${value}.length === ${pattern.items.length}`,
        ...items,
      ];
    }
    case "CorePRecord":
      return [
        `${value} !== null`,
        `typeof ${value} === "object"`,
        ...pattern.fields.flatMap((field) =>
          patternChecks(field.pattern, `${value}.${id(field.name)}`)
        ),
      ];
    case "CorePCtor": {
      const path = parseLongId(pattern.name);
      const ctorName = path.id;
      const ctorId = pattern.ctorId ?? ctorName;
      if (!pattern.payload) {
        // Qualified constructors are available through their namespace object,
        // not through the exporting module's local singleton binding. Core
        // patterns do not yet retain the resolved structure id needed to name
        // that alias, so use the stable constructor tag at this boundary.
        if (path.qualifiers.length > 0) {
          return [
            `${value}?.ctor === ${JSON.stringify(ctorId)}`,
            `${value}.args.length === 0`,
          ];
        }
        const ctor = pattern.ctorId === undefined
          ? id(ctorName)
          : basisCtorJsName(pattern.ctorId) ?? ctorRefName(ctorName, pattern.ctorId);
        return [`${value} === ${ctor}`];
      }
      return [
        `${value}?.ctor === ${JSON.stringify(ctorId)}`,
        `${value}.args.length === 1`,
        ...patternChecks(pattern.payload, `${value}.args[0]`),
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
  return dynamicExportLocalRef(item, item.name);
}

function dynamicExportLocalRef(item: CoreDynamicExport, localName: string): string {
  if (item.bindingId !== undefined) return bindingName(localName, item.bindingId);
  if (item.ctorId !== undefined) return ctorRefName(localName, item.ctorId);
  return id(localName);
}

function valueRefName(name: string, bindingId: BindingId | StructureId | undefined): string {
  return bindingId === undefined ? id(name) : bindingName(name, bindingId);
}

function pinnedPatternValueRef(pattern: Extract<CorePattern, { kind: "CorePPinned" }>): string {
  const path = parseLongId(pattern.name);
  if (path.qualifiers.length === 0) return valueRefName(path.id, pattern.bindingId);

  const [root, ...fields] = [...path.qualifiers, path.id];
  return fields.reduce(
    (value, field) => `${value}.${id(field)}`,
    valueRefName(root, pattern.rootBindingId ?? pattern.bindingId),
  );
}

function patternBindingName(pattern: Extract<CorePattern, { kind: "CorePVar" }>): string {
  return pattern.bindingId === undefined
    ? id(pattern.name)
    : bindingName(pattern.name, pattern.bindingId);
}

function bindingName(name: string, bindingId: BindingId | StructureId): string {
  return `${id(name)}_${bindingId}`;
}

function ctorRefName(name: string, ctorId: CoreDynamicExport["ctorId"]): string {
  return ctorId === undefined ? id(name) : `${id(name)}_ctor_${ctorId}`;
}

function primitiveName(name: string, semanticId?: CompilerSemanticId): string | undefined {
  const operator = basisOperatorDescriptor(name);
  if (operator) return operator.runtimeName;
  if (semanticId) return basisIntrinsicDescriptorBySemanticId(semanticId)?.runtimeName;
  const intrinsic = basisIntrinsicDescriptor(name);
  if (intrinsic?.runtimeName) return intrinsic.runtimeName;
  return basisUnaryOperatorDescriptor(name)?.runtimeName;
}
