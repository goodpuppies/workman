import type { Binding, Decl, Expr, MatchArm, Module, Pattern } from "./ast.ts";

const reserved = new Set(["const", "let", "function", "return", "if", "else", "class", "void"]);

export function emitModule(module: Module): string {
  const chunks = [
    '"use strict";',
    "const print = console.log;",
    "const __wm_tuple = (...items) => items;",
    "const __wm_eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);",
    ...module.decls.flatMap((d) => emitDecl(d)),
    'if (typeof main === "function") await main();',
  ];
  return chunks.join("\n");
}

export function emitBundle(units: { name: string; module: Module }[], entry: Module): string {
  const chunks = [
    '"use strict";',
    "const print = console.log;",
    "const __wm_tuple = (...items) => items;",
    "const __wm_eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);",
    ...units.map((u) => emitNamespace(u.name, u.module)),
    ...entry.decls.flatMap((d) => emitDecl(d)),
    'if (typeof main === "function") await main();',
  ];
  return chunks.join("\n");
}

function emitDecl(decl: Decl): string[] {
  if (decl.kind === "ImportDecl") return [];
  if (decl.kind === "TypeDecl") {
    return decl.ctors.map((c) =>
      c.args.length === 0
        ? `const ${id(c.name)} = Object.freeze({ tag: ${JSON.stringify(c.name)}, args: [] });`
        : `const ${id(c.name)} = (${c.args.map((_, i) => `_${i}`).join(", ")}) => ({ tag: ${
          JSON.stringify(c.name)
        }, args: [${c.args.map((_, i) => `_${i}`).join(", ")}] });`
    );
  }
  if (decl.recursive) {
    return decl.bindings.map((b) => {
      if (b.pattern.kind !== "PVar") throw new Error("recursive bindings must bind one name");
      return `let ${id(b.pattern.name)} = ${emitExpr(b.value)};`;
    });
  }
  return decl.bindings.flatMap(emitBinding);
}

function emitNamespace(name: string, module: Module): string {
  const body = module.decls.flatMap((d) => emitDecl(d)).join("\n");
  return `const ${id(name)} = (() => {\n${body}\nreturn { ${
    exportNames(module).join(", ")
  } };\n})();`;
}

function exportNames(module: Module): string[] {
  return module.decls.flatMap((d) => {
    if (d.kind === "LetDecl") return d.bindings.flatMap((b) => patternBinders(b.pattern).map(id));
    if (d.kind === "TypeDecl") return d.ctors.map((c) => id(c.name));
    return [];
  });
}

function emitBinding(b: Binding): string[] {
  if (b.pattern.kind === "PVar") return [`const ${id(b.pattern.name)} = ${emitExpr(b.value)};`];
  const tmp = `__wm_bind_${bindingTemp++}`;
  return [`const ${tmp} = ${emitExpr(b.value)};`, ...emitPatternBind(b.pattern, tmp)];
}

let bindingTemp = 0;

function emitExpr(expr: Expr): string {
  switch (expr.kind) {
    case "Int":
    case "Float":
      return String(expr.value);
    case "String":
      return JSON.stringify(expr.value);
    case "Bool":
      return expr.value ? "true" : "false";
    case "Void":
      return "undefined";
    case "Var":
      return id(expr.name);
    case "Tuple":
      return `__wm_tuple(${expr.items.map(emitExpr).join(", ")})`;
    case "Lambda":
      return emitLambda(expr.params, expr.body);
    case "Call":
      return `${emitExpr(expr.callee)}(${expr.args.map(emitExpr).join(", ")})`;
    case "If":
      return `(${emitExpr(expr.cond)} ? ${emitExpr(expr.thenExpr)} : ${emitExpr(expr.elseExpr)})`;
    case "Match":
      return emitMatch(expr.value, expr.arms);
    case "Block":
      return `(() => {\n${expr.statements.map(emitStatement).join("\n")}\nreturn ${
        emitExpr(expr.result)
      };\n})()`;
    case "Binary":
      if (expr.op === "==") return `__wm_eq(${emitExpr(expr.left)}, ${emitExpr(expr.right)})`;
      if (expr.op === "!=") return `!__wm_eq(${emitExpr(expr.left)}, ${emitExpr(expr.right)})`;
      return `(${emitExpr(expr.left)} ${expr.op} ${emitExpr(expr.right)})`;
    case "Unary":
      return `(${expr.op}${emitExpr(expr.value)})`;
  }
}

function emitStatement(statement: Decl | Expr): string {
  return isDecl(statement) ? emitDecl(statement).join("\n") : `${emitExpr(statement)};`;
}

function isDecl(value: Decl | Expr): value is Decl {
  return value.kind === "ImportDecl" || value.kind === "LetDecl" || value.kind === "TypeDecl";
}

function emitLambda(params: Pattern[], body: Expr): string {
  const names = params.map((_, i) => `__p${i}`);
  const guards = params.flatMap((p, i) => emitPatternBind(p, names[i]));
  return `(${names.join(", ")}) => {\n${guards.join("\n")}\nreturn ${emitExpr(body)};\n}`;
}

function emitMatch(value: Expr, arms: MatchArm[]): string {
  const body = arms.map((arm) => {
    const checks = patternChecks(arm.pattern, "__v");
    const binds = emitPatternBind(arm.pattern, "__v");
    return `if (${checks.length ? checks.join(" && ") : "true"}) {\n${binds.join("\n")}\nreturn ${
      emitExpr(arm.body)
    };\n}`;
  });
  return `((__v) => {\n${body.join(" else ")}\nthrow new Error("non-exhaustive match");\n})(${
    emitExpr(value)
  })`;
}

function patternChecks(p: Pattern, value: string): string[] {
  switch (p.kind) {
    case "PWildcard":
    case "PVar":
      return [];
    case "PInt":
      return [`${value} === ${p.value}`];
    case "PString":
      return [`${value} === ${JSON.stringify(p.value)}`];
    case "PBool":
      return [`${value} === ${p.value ? "true" : "false"}`];
    case "PVoid":
      return [`${value} === undefined`];
    case "PPinned":
      return [`__wm_eq(${value}, ${id(p.name)})`];
    case "PTuple":
      return [
        `Array.isArray(${value})`,
        `${value}.length === ${p.items.length}`,
        ...p.items.flatMap((x, i) => patternChecks(x, `${value}[${i}]`)),
      ];
    case "PCtor":
      return [
        `${value}?.tag === ${JSON.stringify(tagName(p.name))}`,
        `${value}.args.length === ${p.args.length}`,
        ...p.args.flatMap((x, i) => patternChecks(x, `${value}.args[${i}]`)),
      ];
  }
}

function emitPatternBind(p: Pattern, value: string): string[] {
  switch (p.kind) {
    case "PVar":
      return [`const ${id(p.name)} = ${value};`];
    case "PTuple":
      return p.items.flatMap((x, i) => emitPatternBind(x, `${value}[${i}]`));
    case "PCtor":
      return p.args.flatMap((x, i) => emitPatternBind(x, `${value}.args[${i}]`));
    default:
      return [];
  }
}

function patternBinders(pattern: Pattern): string[] {
  switch (pattern.kind) {
    case "PVar":
      return [pattern.name];
    case "PTuple":
      return pattern.items.flatMap(patternBinders);
    case "PCtor":
      return pattern.args.flatMap(patternBinders);
    default:
      return [];
  }
}

function id(name: string): string {
  if (name.includes(".")) return name.split(".").map(id).join(".");
  return reserved.has(name) ? `_${name}` : name;
}

function tagName(name: string): string {
  return name.split(".").at(-1)!;
}
