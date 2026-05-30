import type { CoreDecl, CoreExpr, CoreMatchArm, CorePattern } from "./ast.ts";
import type { CoreDynamicExport, CoreModuleArtifact, CoreProgram } from "./artifact.ts";
import type { BindingId } from "./ids.ts";
import { basisCtorJsName, basisTypes } from "../basis.ts";
import type { JsImportSpec, TypeExpr } from "../ast.ts";

const reserved = new Set(["const", "let", "function", "return", "if", "else", "class", "void", "globalThis"]);

export function emitCoreProgram(program: CoreProgram): string {
  const entry = program.modules.get(program.entry)!;
  const main = mainRef(entry);
  return [
    '"use strict";',
    "const __wm_tuple_tag = Symbol('wm.tuple');",
    "const __wm_tuple = (...items) => Object.assign(items, { [__wm_tuple_tag]: true });",
    "const __wm_is_tuple = (value) => globalThis.Array.isArray(value) && value[__wm_tuple_tag] === true;",
    `const __wm_js_global = (path) => path.split(".").reduce((value, key) => value?.[key], globalThis);`,
    `const __wm_js_member = (path) => {
  const parts = path.split(".");
  const key = parts.pop();
  const owner = parts.length === 0 ? globalThis : __wm_js_global(parts.join("."));
  const value = owner?.[key];
  return typeof value === "function" ? value.bind(owner) : value;
};`,
    `const __wm_js_member_obj = (owner, key) => {
  const value = owner?.[key];
  return typeof value === "function" ? value.bind(owner) : value;
};`,
    `const __wm_js_receiver_member = (path) => (receiver, ...args) => {
  const owner = path.slice(0, -1).reduce((value, key) => value?.[key], receiver);
  const value = owner?.[path[path.length - 1]];
  return typeof value === "function" ? value.apply(owner, args) : value;
};`,
    `const __wm_js_call = (fn, arg) => __wm_is_tuple(arg) ? fn(...arg) : fn(arg);`,
    `const __wm_js_option_wrap = (value) => value == null ? __wm_basis_None : __wm_basis_Some(value);`,
    `const __wm_js_option_unwrap = (value) => value?.ctor === -1 ? undefined : value?.ctor === -2 ? value.args[0] : value;`,
    `const __wm_js_to_workman = (value, converter) => {
  if (converter === "option") return __wm_js_option_wrap(value);
  if (typeof converter === "object" && converter.kind === "fn") {
    return (...args) => __wm_js_to_workman(
      value(...args.map((arg, index) => __wm_js_to_js(arg, converter.params[index] ?? "id"))),
      converter.result,
    );
  }
  return value;
};`,
    `const __wm_js_to_js = (value, converter) => {
  if (converter === "option") return __wm_js_option_unwrap(value);
  if (typeof converter === "object" && converter.kind === "fn") {
    return (...args) => __wm_js_to_js(
      value(...args.map((arg, index) => __wm_js_to_workman(arg, converter.params[index] ?? "id"))),
      converter.result,
    );
  }
  return value;
};`,
    `const __wm_js_apply = (fn, arg, converters, resultConverter, fallible) => {
  const raw = converters.length === 0 ? [] : converters.length === 1 ? [arg] : (__wm_is_tuple(arg) ? Array.from(arg) : [arg]);
  const args = raw.map((value, index) => __wm_js_to_js(value, converters[index] ?? "id"));
  if (fallible) {
    try {
      return __wm_basis_Ok(__wm_js_to_workman(fn(...args), resultConverter));
    } catch (error) {
      return __wm_basis_Err(error);
    }
  }
  return __wm_js_to_workman(fn(...args), resultConverter);
};`,
    `const __wm_eq = (a, b) => {
  if (a === b) return true;
  if (globalThis.Array.isArray(a) || globalThis.Array.isArray(b)) {
    return globalThis.Array.isArray(a) && globalThis.Array.isArray(b) && a.length === b.length &&
      a.every((item, index) => __wm_eq(item, b[index]));
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if ("ctor" in a || "ctor" in b) {
    return a.ctor === b.ctor && __wm_eq(a.args, b.args);
  }
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((key, index) =>
    key === bk[index] && __wm_eq(a[key], b[key])
  );
};`,
    `const __wm_show = (value, seen = new WeakSet()) => {
  if (value === undefined) return "void";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "function") return "<function>";
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "<cycle>";
  seen.add(value);
  let shown;
  if (__wm_is_tuple(value)) {
    shown = "(" + value.map((item) => __wm_show(item, seen)).join(", ") + ")";
  } else if ("ctor" in value) {
    shown = value.args.length === 0
      ? value.name
      : value.name + "(" + value.args.map((item) => {
        if (__wm_is_tuple(item)) return item.map((part) => __wm_show(part, seen)).join(", ");
        return __wm_show(item, seen);
      }).join(", ") + ")";
  } else if (globalThis.Array.isArray(value)) {
    shown = "[" + value.map((item) => __wm_show(item, seen)).join(", ") + "]";
  } else {
    shown = "{ " + Object.keys(value).sort().map((key) => key + " = " + __wm_show(value[key], seen)).join(", ") + " }";
  }
  seen.delete(value);
  return shown;
};`,
    "const print = (value) => console.log(__wm_show(value));",
    "const __wm_fail = (name, message) => { const e = new Error(message); e.name = name; throw e; };",
    ...emitBasisConstructors(),
    "const __wm_op_add = ([a, b]) => a + b;",
    "const __wm_op_sub = (x) => __wm_is_tuple(x) ? x[0] - x[1] : -x;",
    "const __wm_op_mul = ([a, b]) => a * b;",
    "const __wm_op_div = ([a, b]) => a / b;",
    "const __wm_op_mod = ([a, b]) => a % b;",
    "const __wm_op_eq = ([a, b]) => __wm_eq(a, b);",
    "const __wm_op_ne = ([a, b]) => !__wm_eq(a, b);",
    "const __wm_op_lt = ([a, b]) => a < b;",
    "const __wm_op_lte = ([a, b]) => a <= b;",
    "const __wm_op_gt = ([a, b]) => a > b;",
    "const __wm_op_gte = ([a, b]) => a >= b;",
    "const __wm_op_and = ([a, b]) => a && b;",
    "const __wm_op_or = ([a, b]) => a || b;",
    "const __wm_op_not = (x) => !x;",
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
        `const ${
          id(decl.clause.alias)
        } = new Proxy({}, { get: (_target, key) => (__arg) => __wm_js_call(${
          jsMemberRef(target, "String(key)")
        }, __arg) });`,
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
    return memberRef;
  }
  return `(__arg) => __wm_js_apply(${memberRef}, __arg, ${
    JSON.stringify(jsParamConverters(spec.type))
  }, ${JSON.stringify(jsResultConverter(spec.type, !!spec.fallible))}, ${
    JSON.stringify(!!spec.fallible)
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
  const resultType = fallible ? resultOkType(type.result) : type.result;
  return resultType ? jsConverter(resultType) : "id";
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

function resultOkType(type: TypeExpr): TypeExpr | undefined {
  return type.kind === "TName" && type.name === "Result" && type.args.length === 2
    ? type.args[0]
    : undefined;
}

function emitBasisConstructors(): string[] {
  return basisTypes.flatMap((type) =>
    type.ctors.map((ctor) =>
      ctor.args.length
        ? `const ${basisCtorJsName(ctor.id)} = (__payload) => ({ ctor: ${
          JSON.stringify(ctor.id)
        }, name: ${JSON.stringify(ctor.name)}, args: [__payload] });`
        : `const ${basisCtorJsName(ctor.id)} = Object.freeze({ ctor: ${
          JSON.stringify(ctor.id)
        }, name: ${JSON.stringify(ctor.name)}, args: [] });`
    )
  );
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
        expr.fields.map((field) => `${id(field.name)}: ${emitExpr(field.value)}`).join(", ")
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
};

let jsImportTemp = 0;

function jsTargetRef(target: Extract<CoreDecl, { kind: "CoreJsImport" }>["target"]): JsTargetRef {
  if (target.kind === "JsGlobal") return { kind: "global", path: target.path };
  if (target.kind === "JsModule") {
    const name = `__wm_js_module_${jsImportTemp++}`;
    return {
      kind: "module",
      name,
      setup: `const ${name} = await import(${JSON.stringify(target.specifier)});`,
    };
  }
  if (target.kind === "JsReceiver") return { kind: "receiver", path: target.path };
  throw new Error("unsupported JS import target");
}

function jsMemberRef(target: JsTargetRef, member: string): string {
  if (target.kind === "global") {
    return `__wm_js_member(${JSON.stringify(target.path)} + "." + ${member})`;
  }
  if (target.kind === "module") return `__wm_js_member_obj(${target.name}, ${member})`;
  return `__wm_js_receiver_member(${JSON.stringify(target.path)})`;
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
