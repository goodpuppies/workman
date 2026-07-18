import type { JsImportSpec, TypeExpr } from "../ast.ts";
import { runtimeJsModuleSpecifier } from "../js_module_specifier.ts";
import type { CoreDecl } from "./ast.ts";
import { emitJsIdentifier as id } from "./emit_name.ts";

type CoreJsImport = Extract<CoreDecl, { kind: "CoreJsImport" }>;

type JsTargetRef = { kind: "global"; path: string; setup?: string } | {
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
}

export function setWorkerSpecifiers(specifiers: Map<string, string> | undefined): void {
  workerSpecifiers = specifiers ?? new Map();
}

export function emitJsImportDecl(decl: CoreJsImport): string[] {
  const target = jsTargetRef(decl.target);
  const prefix: string[] = target.kind === "module" || target.kind === "moduleConstructor" ||
      target.kind === "worker"
    ? [target.setup]
    : [];
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
} | {
  kind: "tuple";
  items: JsConverter[];
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
