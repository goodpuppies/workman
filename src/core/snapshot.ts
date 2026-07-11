import type { TypeExpr } from "../ast.ts";
import type { CoreDecl, CoreExpr, CoreModule, CorePattern } from "./ast.ts";

export function showCore(module: CoreModule): string {
  return module.decls.map(showDecl).join("\n");
}

function showDecl(decl: CoreDecl): string {
  switch (decl.kind) {
    case "CoreImport":
      return `import ${JSON.stringify(decl.path)}`;
    case "CoreJsImport":
      if (decl.target.kind === "JsGlobalRoot") {
        return "import js.global";
      }
      if (decl.target.kind === "JsGlobal") {
        return `import js.global(${JSON.stringify(decl.target.path)})`;
      }
      if (decl.target.kind === "JsModule") {
        return `import js.module(${JSON.stringify(decl.target.specifier)})`;
      }
      if (decl.target.kind === "JsWorker") {
        return `import js.worker(${JSON.stringify(decl.target.specifier)})`;
      }
      if (decl.target.kind === "JsConstructor") {
        return `import js.constructor(${JSON.stringify(decl.target.path)})`;
      }
      return `import js.receiver(${decl.target.path.join(".")})`;
    case "CoreLet": {
      const head = `let${decl.recursive ? " rec" : ""}`;
      return `${head} ${
        decl.bindings.map((binding) =>
          `${showPattern(binding.pattern)} = ${showExpr(binding.value)}`
        ).join(" and ")
      }`;
    }
    case "CoreType":
      return `type ${decl.name}${decl.params.length ? `<${decl.params.join(", ")}>` : ""} = ${
        decl.alias
          ? showType(decl.alias)
          : decl.ctors.map((ctor) =>
            ctor.payload ? `${showCtor(ctor)} ${showType(ctor.payload)}` : showCtor(ctor)
          ).join(" | ")
      }`;
    case "CoreRecord":
      return `record ${decl.name}`;
  }
}

function showCtor(ctor: { id?: number; name: string }): string {
  return ctor.id === undefined ? ctor.name : `${ctor.name}#${ctor.id}`;
}

function showType(type: TypeExpr): string {
  switch (type.kind) {
    case "TName":
      return type.args.length ? `${type.name}<${type.args.map(showType).join(", ")}>` : type.name;
    case "TVar":
      return type.name;
    case "TTuple":
      return `(${type.items.map(showType).join(", ")})`;
    case "TFn":
      return `(${type.params.map(showType).join(", ")}) => ${showType(type.result)}`;
  }
}

function showExpr(expr: CoreExpr): string {
  switch (expr.kind) {
    case "CoreInt":
    case "CoreFloat":
      return String(expr.value);
    case "CoreString":
      return JSON.stringify(expr.value);
    case "CoreBool":
      return String(expr.value);
    case "CoreVoid":
      return "void";
    case "CoreVar":
      return showCtorRef(expr.name, expr.ctorId);
    case "CoreTuple":
      return `(${expr.items.map(showExpr).join(", ")})`;
    case "CoreRecord":
      return `.{${
        expr.fields.map((field) =>
          field.kind === "CoreRecordSpread"
            ? `..${showExpr(field.value)}`
            : `${field.name} = ${showExpr(field.value)}`
        ).join(", ")
      }}`;
    case "CoreRecordAccess":
      return `${showExpr(expr.record)}.${expr.field}`;
    case "CoreJsonObject":
      return `JSON{${
        expr.fields.map((field) => `${JSON.stringify(field.key)}: ${showExpr(field.value)}`).join(
          ", ",
        )
      }}`;
    case "CoreJsonArray":
      return `JSON[${expr.items.map(showExpr).join(", ")}]`;
    case "CoreFn":
      return `fn { ${
        expr.arms.map((arm) => `${showPattern(arm.pattern)} => ${showExpr(arm.body)}`).join(" | ")
      } }`;
    case "CoreApp":
      return `app(${showExpr(expr.callee)}, ${showExpr(expr.arg)})`;
    case "CoreIf":
      return `if ${showExpr(expr.cond)} then ${showExpr(expr.thenExpr)} else ${
        showExpr(expr.elseExpr)
      }`;
    case "CoreMatch":
      return `match ${showExpr(expr.value)} { ${
        expr.arms.map((arm) => `${showPattern(arm.pattern)} => ${showExpr(arm.body)}`).join(" | ")
      } }`;
    case "CorePanic":
      return `Panic(${showExpr(expr.message)})`;
    case "CoreBlock":
      return `{ ${
        [
          ...expr.items.map((item) => isDecl(item) ? showDecl(item) : showExpr(item)),
          showExpr(expr.result),
        ]
          .join("; ")
      } }`;
  }
}

function showPattern(pattern: CorePattern): string {
  switch (pattern.kind) {
    case "CorePWildcard":
      return "_";
    case "CorePVar":
      return pattern.name;
    case "CorePInt":
      return String(pattern.value);
    case "CorePString":
      return JSON.stringify(pattern.value);
    case "CorePBool":
      return String(pattern.value);
    case "CorePVoid":
      return "void";
    case "CorePPinned":
      return `^${pattern.name}`;
    case "CorePTuple":
      return `(${pattern.items.map(showPattern).join(", ")})`;
    case "CorePRecord":
      return `.{${
        pattern.fields.map((field) => `${field.name} = ${showPattern(field.pattern)}`).join(", ")
      }}`;
    case "CorePCtor":
      return pattern.payload
        ? `${showCtorRef(pattern.name, pattern.ctorId)} ${showPattern(pattern.payload)}`
        : showCtorRef(pattern.name, pattern.ctorId);
  }
}

function showCtorRef(name: string, id: number | undefined): string {
  return id === undefined ? name : `${name}#${id}`;
}

function isDecl(value: CoreDecl | CoreExpr): value is CoreDecl {
  return value.kind === "CoreImport" || value.kind === "CoreLet" ||
    value.kind === "CoreJsImport" || value.kind === "CoreType" || value.kind === "CoreRecord";
}
