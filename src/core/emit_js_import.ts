import type { JsImportSpec, TypeExpr } from "../ast.ts";
import { cExtractionFor, CODEC_LIB_PREFIX } from "../ffi/c/prepare.ts";
import { type CCodecDescriptor, validateCodecDescriptor } from "../ffi/c/byte_type.ts";
import type { ExtractedStruct, ExtractedTypeDesc } from "../ffi/c/extract.ts";
import { runtimeJsModuleSpecifier } from "../js_module_specifier.ts";
import type { CoreDecl } from "./ast.ts";
import { emitJsIdentifier as id } from "./emit_name.ts";

type CoreJsImport = Extract<CoreDecl, { kind: "CoreJsImport" }>;

type JsTargetRef = { kind: "global"; path: string; setup?: string } | {
  kind: "meta";
} | {
  kind: "module";
  name: string;
  setup: string;
} | {
  kind: "worker";
  name: string;
  setup: string;
} | {
  kind: "moduleConstructor";
  moduleName: string;
  memberName: string;
  setup: string;
} | {
  kind: "receiver";
  path: string[];
} | {
  kind: "constructor";
  path: string;
};

let jsImportTemp = 0;
let workerSpecifiers = new Map<string, string>();

export function resetJsImportEmitter(): void {
  jsImportTemp = 0;
  namespaceRecordCtors = new Map();
  cNamespaceMemberUsage = new Map();
}

export function setWorkerSpecifiers(specifiers: Map<string, string> | undefined): void {
  workerSpecifiers = specifiers ?? new Map();
}

/**
 * Qualified record constructors per namespace alias (`Raylib` →
 * `Vector2`), populated by the JS emitter before module emission; the
 * namespace runtime object exposes them as members.
 */
let namespaceRecordCtors = new Map<string, { member: string; ref: string }[]>();

/**
 * Statically referenced members for C namespace imports, keyed by structure id.
 * `null` means the namespace value escapes and therefore every member is needed.
 */
let cNamespaceMemberUsage = new Map<number, ReadonlySet<string> | null>();

export function setNamespaceRecordCtors(
  ctors: Map<string, { member: string; ref: string }[]>,
): void {
  namespaceRecordCtors = ctors;
}

export function setCNamespaceMemberUsage(
  usage: Map<number, ReadonlySet<string> | null>,
): void {
  cNamespaceMemberUsage = usage;
}

export function emitJsImportDecl(decl: CoreJsImport): string[] {
  if (decl.target.kind === "CHeader" || decl.target.kind === "CLib") {
    return emitCImportDecl(decl);
  }
  const target = jsTargetRef(decl.target);
  const prefix: string[] = target.kind === "module" || target.kind === "moduleConstructor" ||
      target.kind === "worker"
    ? [target.setup]
    : [];
  if (decl.clause.kind === "Namespace") {
    return [
      ...prefix,
      `const ${
        boundName(
          decl.clause.alias,
          decl.bindingIds?.[0],
        )
      } = ${jsNamespaceRef(target)};`,
    ];
  }
  const alias = decl.clause.alias;
  if (alias) {
    return [
      ...prefix,
      `const ${boundName(alias, decl.structureId)} = { ${
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
    ...decl.clause.specs.map((spec, index) =>
      `const ${boundName(spec.alias ?? spec.name, decl.bindingIds?.[index])} = ${
        jsImportWrapper(jsMemberRef(target, JSON.stringify(spec.name)), spec)
      };`
    ),
  ];
}

function boundName(name: string, bindingId: number | undefined): string {
  const emitted = id(name);
  return bindingId === undefined ? emitted : `${emitted}_${bindingId}`;
}

// ---------------------------------------------------------------------------
// C FFI emission: Deno.dlopen-backed imports.
//
// Each C target emits one dlopen registration plus per-symbol wrapper consts.
// Reflected (c.header) imports take their ABI descriptors from the extraction
// registry; manual (c.lib) imports derive descriptors from the authored
// signature (Number defaults to i32 — reflected imports carry exact widths).

function emitCImportDecl(decl: CoreJsImport): string[] {
  const target = decl.target;
  if (target.kind === "CLib") return emitCLibImportDecl(decl, target.name);
  if (target.kind === "CHeader") return emitCHeaderImportDecl(decl, target.header, target.lib);
  throw new Error("unsupported C import target");
}

function emitCHeaderImportDecl(
  decl: CoreJsImport,
  header: string,
  lib: string | undefined,
): string[] {
  const registry = cExtractionFor(header);
  if (!registry) {
    throw new Error(`missing C extraction registry entry for header ${header}`);
  }
  return emitCImportSpecs(decl, lib ?? "c", registry);
}

function emitCLibImportDecl(decl: CoreJsImport, libName: string): string[] {
  if (libName.startsWith(CODEC_LIB_PREFIX)) {
    return emitCCodecImportDecl(decl, libName.slice(CODEC_LIB_PREFIX.length));
  }
  return emitCImportSpecs(decl, libName, undefined);
}

// ---------------------------------------------------------------------------
// Generated codec imports: byte_type-composed codecs, no handwritten marshaling.
// See markdown/c_ffi/struct-codecs.md. The extractor's field offsets are the
// authority; byte_type's own layout math is validated against them (compile
// time) and mismatches fail the build.

const BYTE_TYPE_URL = "file:///home/ellie/git/byte_type_C/mod.ts";

function emitCCodecImportDecl(decl: CoreJsImport, header: string): string[] {
  const registry = cExtractionFor(header);
  if (!registry || decl.clause.kind !== "Named") {
    throw new Error(`missing C extraction for codec header ${header}`);
  }
  const emitted: string[] = [];
  for (const spec of decl.clause.specs) {
    const binding = boundName(spec.alias ?? spec.name, decl.bindingIds?.[0]);
    emitted.push(...emitCodecBinding(spec.name, binding, registry));
  }
  return emitted;
}

function emitCodecBinding(
  name: string,
  binding: string,
  registry: NonNullable<ReturnType<typeof cExtractionFor>>,
): string[] {
  const constructor = /^new([A-Z].*)$/.exec(name);
  if (constructor) {
    const struct = requireStruct(registry, constructor[1]);
    return [
      ...codecSetupLines(registry, struct),
      `const ${binding} = (...__wm_c_args) => __wm_c_struct_new(${
        JSON.stringify(struct.name)
      }, __wm_c_args);`,
    ];
  }
  const getter = /^get([A-Z].*)_([A-Za-z0-9_]+)$/.exec(name);
  if (getter) {
    const struct = requireStruct(registry, getter[1]);
    const field = struct.fields.find((entry) => entry.name === getter[2]);
    if (!field) throw new Error(`no field ${getter[2]} on C struct ${struct.name}`);
    return [
      ...codecSetupLines(registry, struct),
      `const ${binding} = (pointer) => __wm_c_struct_get(${JSON.stringify(struct.name)}, pointer, ${
        JSON.stringify(getter[2])
      });`,
    ];
  }
  throw new Error(`unknown generated C codec binding '${name}'`);
}

function requireStruct(
  registry: NonNullable<ReturnType<typeof cExtractionFor>>,
  name: string,
): ExtractedStruct {
  const declared = registry.types.get(name);
  if (!declared || declared.kind !== "struct") {
    throw new Error(`C type '${name}' is not an extracted struct`);
  }
  return declared;
}

const codecSetupsEmitted = new Map<string, string[]>();

function codecSetupLines(
  registry: NonNullable<ReturnType<typeof cExtractionFor>>,
  struct: ExtractedStruct,
): string[] {
  const cacheKey = `${registry.header}:${struct.name}`;
  const cached = codecSetupsEmitted.get(cacheKey);
  if (cached) return cached;
  validateCodecDescriptor(codecDescriptor(struct));
  const lines = [
    `await __wm_c_setup_codec(${JSON.stringify(codecDescriptor(struct))});`,
  ];
  codecSetupsEmitted.set(cacheKey, lines);
  return lines;
}

function codecDescriptor(struct: ExtractedStruct): CCodecDescriptor {
  return {
    name: struct.name,
    size: struct.size,
    align: struct.align,
    fields: struct.fields.map((field) => ({
      name: field.name,
      offset: field.offset,
      codec: byteTypeName(field.type),
    })),
  };
}

function byteTypeName(desc: ExtractedTypeDesc): string {
  switch (desc.kind) {
    case "bool":
      return "bool";
    case "int": {
      const width = desc.bits ?? 32;
      const sized = width <= 8 ? 8 : width <= 16 ? 16 : width <= 32 ? 32 : 64;
      return `${desc.signed ? "i" : "u"}${sized}`;
    }
    case "float":
      return desc.bits === 32 ? "f32" : "f64";
    case "named":
      return "struct";
    default:
      throw new Error(`unrepresentable struct field type: ${desc.kind}`);
  }
}

// Compile-time validation gate: byte_type's own field-offset math must agree
// with the extractor (the C-layout authority) or the build fails. Implemented
// in ../ffi/c/byte_type.ts (static import of the byte_type dependency).

function emitCImportSpecs(
  decl: CoreJsImport,
  libName: string,
  registry: ReturnType<typeof cExtractionFor>,
): string[] {
  if (decl.clause.kind !== "Named") {
    if (decl.clause.kind === "Namespace" && registry) {
      return emitCNamespaceImport(
        decl as CoreJsImport & { clause: { kind: "Namespace"; alias: string } },
        libName,
        registry,
      );
    }
    throw new Error("C imports do not support namespace clauses");
  }
  const libVar = `__wm_c_lib_${libName.replace(/[^A-Za-z0-9_]/g, "_")}_${jsImportTemp++}`;
  const symbols: string[] = [];
  const wrappers: string[] = [];
  const byValueStructs = new Map<string, ExtractedStruct>();
  decl.clause.specs.forEach((spec, index) => {
    const symbol = spec.name;
    const signature = registry
      ? cSignatureFromExtraction(symbol, registry)
      : cSignatureFromAuthoredType(spec.type);
    const binding = boundName(spec.alias ?? spec.name, decl.bindingIds?.[index]);
    if (signature.constant) {
      if (signature.constant.kind === "scalar") {
        wrappers.push(`const ${binding} = ${JSON.stringify(signature.constant.value)};`);
        return;
      }
      if (!registry) {
        throw new Error("C struct constants require an extraction registry");
      }
      const constant = signature.constant;
      const struct = requireStruct(registry, constant.descriptor.name);
      // Flat numeric structs are Workman records: the constant is the plain
      // field object, no codec or pointer materialization needed.
      wrappers.push(
        `const ${binding} = { ${
          struct.fields.map((field) =>
            `${id(field.name)}: ${
              JSON.stringify((constant.fields as Record<string, unknown>)[field.name])
            }`
          ).join(", ")
        } };`,
      );
      return;
    }
    for (const converter of signature.converters) {
      if (registry && typeof converter !== "string" && converter.kind === "struct-by-value") {
        byValueStructs.set(converter.name, requireStruct(registry, converter.name));
      }
    }
    if (
      registry && typeof signature.resultConverter !== "string" &&
      signature.resultConverter.kind === "struct-read"
    ) {
      byValueStructs.set(
        signature.resultConverter.name,
        requireStruct(registry, signature.resultConverter.name),
      );
    }
    symbols.push(
      `${JSON.stringify(symbol)}: { parameters: ${JSON.stringify(signature.parameters)}, result: ${
        JSON.stringify(signature.result)
      } }`,
    );
    wrappers.push(
      `const ${binding} = (...__wm_c_args) => __wm_c_call(${libVar}.symbols[${
        JSON.stringify(symbol)
      }], __wm_c_args, ${JSON.stringify(signature.converters)}, ${
        JSON.stringify(signature.resultConverter)
      });`,
    );
  });
  if (wrappers.length === 0 || symbols.length === 0) return wrappers;
  const libPath = cLibraryPath(libName);
  const setupLines = registry
    ? [...byValueStructs.values()].flatMap((struct) => codecSetupLines(registry, struct))
    : [];
  return [
    ...setupLines,
    `const ${libVar} = Deno.dlopen(${JSON.stringify(libPath)}, { ${symbols.join(", ")} });`,
    ...wrappers,
  ];
}

// Namespace C imports (`import unsafe * as Raylib`): one dlopen registration
// covering every exported fn, then a single object whose members are the
// wrappers and record constants. Members were typed by the preparation pass.
function emitCNamespaceImport(
  decl: CoreJsImport & { clause: { kind: "Namespace"; alias: string } },
  libName: string,
  registry: NonNullable<ReturnType<typeof cExtractionFor>>,
): string[] {
  const libVar = `__wm_c_lib_${libName.replace(/[^A-Za-z0-9_]/g, "_")}_${jsImportTemp++}`;
  const symbols: string[] = [];
  const members: string[] = [];
  const byValueStructs = new Map<string, ExtractedStruct>();
  const usedMembers = decl.structureId === undefined
    ? undefined
    : cNamespaceMemberUsage.get(decl.structureId);
  const specs = usedMembers instanceof Set
    ? (decl.clause.specs ?? []).filter((spec) => usedMembers.has(spec.name))
    : decl.clause.specs ?? [];
  for (const spec of specs) {
    const signature = cSignatureFromExtraction(spec.name, registry);
    if (signature.constant) {
      const constant = signature.constant;
      if (constant.kind === "scalar") {
        members.push(`${id(spec.name)}: ${JSON.stringify(constant.value)}`);
        continue;
      }
      const struct = requireStruct(registry, constant.descriptor.name);
      members.push(
        `${id(spec.name)}: { ${
          struct.fields.map((field) =>
            `${id(field.name)}: ${
              JSON.stringify((constant.fields as Record<string, unknown>)[field.name])
            }`
          ).join(", ")
        } }`,
      );
      continue;
    }
    for (const converter of signature.converters) {
      if (typeof converter !== "string" && converter.kind === "struct-by-value") {
        byValueStructs.set(converter.name, requireStruct(registry, converter.name));
      }
    }
    if (
      typeof signature.resultConverter !== "string" &&
      signature.resultConverter.kind === "struct-read"
    ) {
      byValueStructs.set(
        signature.resultConverter.name,
        requireStruct(registry, signature.resultConverter.name),
      );
    }
    symbols.push(
      `${JSON.stringify(spec.name)}: { parameters: ${
        JSON.stringify(signature.parameters)
      }, result: ${JSON.stringify(signature.result)} }`,
    );
    members.push(
      `${id(spec.name)}: (...__wm_c_args) => __wm_c_call(${libVar}.symbols[${
        JSON.stringify(spec.name)
      }], __wm_c_args, ${JSON.stringify(signature.converters)}, ${
        JSON.stringify(signature.resultConverter)
      })`,
    );
  }
  const libPath = cLibraryPath(libName);
  const setupLines = [...byValueStructs.values()].flatMap((struct) =>
    codecSetupLines(registry, struct)
  );
  const dlopenLines = symbols.length === 0
    ? []
    : [`const ${libVar} = Deno.dlopen(${JSON.stringify(libPath)}, { ${symbols.join(", ")} });`];
  for (const { member, ref } of namespaceRecordCtors.get(decl.clause.alias) ?? []) {
    if (usedMembers instanceof Set && !usedMembers.has(member)) continue;
    members.push(`${id(member)}: ${ref}`);
  }
  return [
    ...setupLines,
    ...dlopenLines,
    `const ${boundName(decl.clause.alias, decl.structureId)} = { ${members.join(", ")} };`,
  ];
}

type CSignature = {
  parameters: CDenoType[];
  result: CDenoType;
  /** Per-argument conversion applied by __wm_c_call before the raw call. */
  converters: CArgConverter[];
  /** Post-call conversion of the raw result into a Workman value. */
  resultConverter: CResultConverter;
  /** Present for imported C constants: emitted as plain values, not calls. */
  constant?: CConstant;
};

type CConstant =
  | { kind: "scalar"; value: unknown }
  | { kind: "struct"; descriptor: CCodecDescriptor; fields: unknown };

type CDenoType = string | { struct: string[] };
type CArgConverter =
  | "id"
  | "string-to-cstr"
  | "option-unwrap"
  | "number-to-bigint"
  | "option-string-to-cstr"
  | { kind: "struct-by-value"; name: string };
type CResultConverter =
  | "id"
  | "cstr-to-string"
  | "option-wrap"
  | { kind: "struct-read"; name: string };

function cSignatureForSpec(
  spec: JsImportSpec,
  registry: ReturnType<typeof cExtractionFor>,
  target: CoreJsImport["target"],
): CSignature {
  if (registry && target.kind === "CHeader") {
    return cSignatureFromExtraction(spec.name, registry);
  }
  return cSignatureFromAuthoredType(spec.type);
}

function cSignatureFromExtraction(
  symbol: string,
  registry: NonNullable<ReturnType<typeof cExtractionFor>>,
): CSignature {
  const fn = registry.result.fns.find((entry) => entry.name === symbol);
  if (fn) {
    const parameters = fn.params.map((param) => cDenoTypeFromDesc(param, registry));
    const converters = fn.params.map((param) => cConverterFromDesc(param, registry));
    const returnType = fn.return;
    if (returnType && returnType.kind === "named") {
      const structName = cTypeName(returnType.name ?? "");
      const declared = registry.types.get(structName);
      if (declared?.kind === "struct") {
        if (!isFlatNumericCStruct(declared)) {
          throw new Error(
            `C function '${symbol}': by-value struct return '${structName}' has non-numeric fields (unrepresentable in v1)`,
          );
        }
        return {
          parameters,
          converters,
          result: { struct: declared.fields.map((field) => byteTypeName(field.type)) },
          resultConverter: { kind: "struct-read", name: structName },
        };
      }
      if (declared?.kind === "enum") {
        return {
          parameters,
          converters,
          result: byteTypeName(declared.backing),
          resultConverter: "id",
        };
      }
      if (declared?.kind === "alias") {
        throw new Error(
          `C function '${symbol}': by-value alias return '${structName}' unsupported in v1`,
        );
      }
    }
    const result = returnType ? cDenoTypeFromDesc(returnType, registry) : "void";
    const resultConverter = returnType && returnType.kind === "pointer" &&
        returnType.child?.kind === "int" && returnType.child.bits === 8
      ? "cstr-to-string"
      : result === "pointer"
      ? "option-wrap"
      : "id";
    return { parameters, result, converters, resultConverter };
  }
  const value = registry.result.values.find((entry) => entry.name === symbol);
  if (value) {
    if (value.type.kind === "named") {
      const structName = cTypeName(value.type.name ?? "");
      const struct = requireStruct(registry, structName);
      if (!isFlatNumericCStruct(struct)) {
        throw new Error(
          `C constant '${symbol}': non-numeric struct '${structName}' is unrepresentable in v1`,
        );
      }
      return {
        parameters: [],
        result: "pointer",
        converters: [],
        resultConverter: "id",
        constant: {
          kind: "struct",
          descriptor: codecDescriptor(struct),
          fields: value.value,
        },
      };
    }
    return {
      parameters: [],
      result: "f64",
      converters: [],
      resultConverter: "id",
      constant: { kind: "scalar", value: value.value },
    };
  }
  throw new Error(
    `C symbol '${symbol}' has no extracted signature for header '${registry.header}'`,
  );
}

function isFlatNumericCStruct(struct: ExtractedStruct): boolean {
  return struct.fields.length > 0 &&
    struct.fields.every((field) => isNumericDesc(field.type));
}

function isNumericDesc(desc: ExtractedTypeDesc): boolean {
  return desc.kind === "int" || desc.kind === "float" || desc.kind === "bool";
}

function cTypeName(name: string): string {
  return name.replace(/^cimport\.(struct_|union_|enum_)/, "").replace(/^cimport\./, "");
}

function cDenoTypeFromDesc(
  desc: ExtractedTypeDesc,
  registry: NonNullable<ReturnType<typeof cExtractionFor>>,
): CDenoType {
  switch (desc.kind) {
    case "bool":
      return "bool";
    case "void":
      return "void";
    case "int":
      return cIntType(desc.bits ?? 32, !!desc.signed);
    case "float":
      return desc.bits === 32 ? "f32" : "f64";
    case "pointer":
      return "pointer";
    case "optional":
      return "pointer";
    case "named": {
      const name = cTypeName(desc.name ?? "");
      const declared = registry.types.get(name);
      if (declared?.kind === "struct") {
        if (!isFlatNumericCStruct(declared)) {
          throw new Error(
            `C by-value struct '${name}' has non-numeric fields (unrepresentable in v1)`,
          );
        }
        return { struct: declared.fields.map((field) => byteTypeName(field.type)) };
      }
      if (declared?.kind === "enum") return byteTypeName(declared.backing);
      if (declared?.kind === "alias" && declared.target) {
        return cDenoTypeFromDesc(declared.target, registry);
      }
      throw new Error(`C type '${name}' has no by-value ABI descriptor`);
    }
    default:
      throw new Error(`unrepresentable C ABI type: ${desc.kind}`);
  }
}

function cConverterFromDesc(
  desc: ExtractedTypeDesc,
  registry: NonNullable<ReturnType<typeof cExtractionFor>>,
): CArgConverter {
  if (desc.kind === "pointer" && desc.child?.kind === "int" && desc.child.bits === 8) {
    return "string-to-cstr";
  }
  if (desc.kind === "int" && (desc.bits ?? 0) >= 64) return "number-to-bigint";
  if (desc.kind === "pointer" || desc.kind === "optional") return "option-unwrap";
  if (desc.kind === "named") {
    const name = cTypeName(desc.name ?? "");
    const declared = registry.types.get(name);
    if (declared?.kind === "struct" && isFlatNumericCStruct(declared)) {
      return { kind: "struct-by-value", name };
    }
    if (declared?.kind === "alias" && declared.target) {
      return cConverterFromDesc(declared.target, registry);
    }
  }
  return "id";
}

function cIntType(bits: number, signed: boolean): CDenoType {
  const width = bits <= 8 ? 8 : bits <= 16 ? 16 : bits <= 32 ? 32 : 64;
  return `${signed ? "i" : "u"}${width}`;
}

function cSignatureFromAuthoredType(type: TypeExpr | undefined): CSignature {
  if (type?.kind !== "TFn") {
    throw new Error("c.lib imports require a manual signature: name: (params) -> result");
  }
  const parameters: CDenoType[] = [];
  const converters: CArgConverter[] = [];
  for (const param of type.params) {
    const mapped = cDenoTypeFromAuthored(param);
    parameters.push(mapped.denoType);
    converters.push(mapped.converter);
  }
  return {
    parameters,
    result: type.result.kind === "TName" && type.result.name === "Void"
      ? "void"
      : cDenoTypeFromAuthored(type.result).denoType,
    converters,
    resultConverter: type.result.kind === "TName" && type.result.name === "String"
      ? "cstr-to-string"
      : type.result.kind === "TName" && type.result.name === "Option"
      ? "option-wrap"
      : "id",
  };
}

function cDenoTypeFromAuthored(
  type: TypeExpr,
): { denoType: CDenoType; converter: CArgConverter } {
  if (type.kind !== "TName") {
    throw new Error(`unrepresentable c.lib parameter type: ${type.kind}`);
  }
  if (type.name === "Ptr") return { denoType: "pointer", converter: "id" };
  if (type.name === "Option") {
    const inner = type.args[0];
    const mapped = inner ? cDenoTypeFromAuthored(inner) : undefined;
    return {
      denoType: "pointer",
      converter: mapped?.converter === "string-to-cstr" ? "option-string-to-cstr" : "option-unwrap",
    };
  }
  if (type.name === "Number") return { denoType: "i32", converter: "id" };
  if (type.name === "Bool") return { denoType: "bool", converter: "id" };
  if (type.name === "String") return { denoType: "pointer", converter: "string-to-cstr" };
  throw new Error(
    `c.lib parameter type '${type.name}' is not representable in v1 (use Ptr<T>, Option<Ptr<T>>, Number, Bool, String, Void)`,
  );
}

function cLibraryPath(libName: string): string {
  if (libName === "c" || libName === "libc") return "libc.so.6";
  if (libName.includes("/")) return libName;
  // Derived file names already carry their platform suffix.
  if (/\.(so|dylib|dll)$/.test(libName)) return libName;
  return `lib${libName}.so`;
}

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
    const converter = jsValueConverter(spec.type);
    return converter === "id"
      ? memberRef
      : `__wm_js_to_workman(${memberRef}, ${JSON.stringify(converter)})`;
  }
  const params = jsParamConverters(spec.type);
  const result = jsResultConverter(spec.type, !!spec.fallible);
  if (!spec.fallible && params.every((converter) => converter === "id") && result === "id") {
    const direct = `__wm_js_direct_${jsImportTemp++}`;
    const call = params.length === 0
      ? `${direct}()`
      : params.length === 1
      ? `${direct}(__arg)`
      : `${direct}(...__arg)`;
    return `(() => { const ${direct} = ${memberRef}; return (__arg) => ${call}; })()`;
  }
  return `(__arg) => __wm_js_apply(${memberRef}, __arg, ${JSON.stringify(params)}, ${
    JSON.stringify(result)
  }, ${JSON.stringify(spec.fallible ? jsFallibleMode(spec.type) : false)})`;
}

type JsConverter = "id" | "option" | {
  kind: "fn";
  params: JsConverter[];
  result: JsConverter;
} | {
  kind: "tuple";
  items: JsConverter[];
} | {
  kind: "array";
  item: JsConverter;
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
  if (type.kind === "TName" && type.name === "Js.Array" && type.args.length === 1) {
    const item = jsConverter(type.args[0]);
    return item === "id" ? "id" : { kind: "array", item };
  }
  if (type.kind === "TTuple") {
    return { kind: "tuple", items: type.items.map(jsConverter) };
  }
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

function jsTargetRef(target: CoreJsImport["target"]): JsTargetRef {
  if (target.kind === "JsGlobalRoot") return { kind: "global", path: "" };
  if (target.kind === "JsGlobal") return { kind: "global", path: target.path };
  if (target.kind === "JsMeta") return { kind: "meta" };
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
  if (target.kind === "JsWorker") {
    const name = `__wm_js_worker_${jsImportTemp++}`;
    const specifier = workerSpecifiers.get(target.specifier) ?? fallbackWorkerSpecifier(
      target.specifier,
    );
    return {
      kind: "worker",
      name,
      setup: `const ${name} = Object.freeze({ url: new URL(${
        JSON.stringify(specifier)
      }, import.meta.url).href, specifier: ${JSON.stringify(specifier)} });`,
    };
  }
  if (target.kind === "JsReceiver") return { kind: "receiver", path: target.path };
  if (target.kind === "JsConstructor") {
    const moduleCtor = parseModuleConstructorPath(target.path);
    if (moduleCtor) {
      const name = `__wm_js_module_${jsImportTemp++}`;
      return {
        kind: "moduleConstructor",
        moduleName: name,
        memberName: moduleCtor.memberName,
        setup: `const ${name} = await import(${
          JSON.stringify(runtimeJsModuleSpecifier(moduleCtor.specifier))
        });`,
      };
    }
    return { kind: "constructor", path: target.path };
  }
  throw new Error("unsupported JS import target");
}

function jsMemberRef(target: JsTargetRef, member: string): string {
  if (target.kind === "meta") return `import.meta[${member}]`;
  if (target.kind === "global") {
    if (target.path.length === 0) return `__wm_js_member(${member})`;
    if (member === JSON.stringify(target.path)) {
      return `__wm_js_member(${JSON.stringify(target.path)})`;
    }
    return `__wm_js_member(${JSON.stringify(target.path)} + "." + ${member})`;
  }
  if (target.kind === "module") return `__wm_js_member_obj(${target.name}, ${member})`;
  if (target.kind === "worker") return `__wm_js_member_obj(${target.name}, ${member})`;
  if (target.kind === "moduleConstructor") {
    return `(...__wm_ctor_args) => new (${target.moduleName}[${
      JSON.stringify(target.memberName)
    }])(...__wm_ctor_args)`;
  }
  if (target.kind === "constructor") return `__wm_js_construct(${JSON.stringify(target.path)})`;
  return `__wm_js_receiver_member(${JSON.stringify(target.path)})`;
}

function jsNamespaceRef(target: JsTargetRef): string {
  if (target.kind === "meta") return "import.meta";
  if (target.kind === "module") return target.name;
  if (target.kind === "worker") return target.name;
  if (target.kind === "global") {
    return target.path.length === 0
      ? "globalThis"
      : `__wm_js_global(${JSON.stringify(target.path)})`;
  }
  return "{}";
}

function fallbackWorkerSpecifier(specifier: string): string {
  return specifier.replace(/\.wm$/i, ".mjs");
}

function parseModuleConstructorPath(
  path: string,
): { specifier: string; memberName: string } | undefined {
  if (!path.startsWith("module:")) return undefined;
  const rest = path.slice("module:".length);
  const colon = rest.indexOf(":");
  if (colon < 0) return undefined;
  try {
    return {
      specifier: JSON.parse(rest.slice(0, colon)),
      memberName: JSON.parse(rest.slice(colon + 1)),
    };
  } catch (_error) {
    return undefined;
  }
}
