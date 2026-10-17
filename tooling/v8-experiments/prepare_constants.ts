// Scratch-only model of hoisting immutable PEG literal/class lists per rule module.
import ts from "typescript-api";
import { resolve } from "node:path";
const destination = resolve(Deno.args[0]);
if (!destination.startsWith(await Deno.realPath("_scratch") + "/")) throw new Error("scratch only");
const text = await Deno.readTextFile(Deno.args[1] ?? "src/generated/frontend_v2_parser.js");
const source = ts.createSourceFile(
  "parser.js",
  text,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const edits: { start: number; end: number; text: string }[] = [];
let count = 0;
let sites = 0;
function scalar(n: ts.Expression): boolean {
  return ts.isNumericLiteral(n) ||
    (ts.isPrefixUnaryExpression(n) && ts.isNumericLiteral(n.operand));
}
function part(n: ts.Expression): boolean {
  if (scalar(n)) return true;
  return ts.isCallExpression(n) && ts.isIdentifier(n.expression) &&
    /^(SingleCode|CodeRange)_ctor_\d+$/.test(n.expression.text) && n.arguments.length === 1 &&
    (scalar(n.arguments[0]) ||
      ts.isArrayLiteralExpression(n.arguments[0]) &&
        n.arguments[0].elements.every((e) => ts.isExpression(e) && scalar(e)));
}
function list(n: ts.Expression): boolean {
  if (ts.isIdentifier(n) && n.text === "__wm_basis_Nil") return true;
  if (
    !ts.isCallExpression(n) || !ts.isIdentifier(n.expression) ||
    n.expression.text !== "__wm_basis_Cons" || n.arguments.length !== 1
  ) return false;
  const pair = n.arguments[0];
  return ts.isArrayLiteralExpression(pair) && pair.elements.length === 2 &&
    ts.isExpression(pair.elements[0]) && ts.isExpression(pair.elements[1]) &&
    part(pair.elements[0]) && list(pair.elements[1]);
}
function modules(node: ts.Node): void {
  if (
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
    node.expression.text === "__wm_define_module"
  ) {
    const fn = node.arguments[2];
    if (!fn || !ts.isArrowFunction(fn) || !ts.isBlock(fn.body)) return;
    const body = fn.body;
    if (!body.statements.some((s) => /^const rule_/.test(s.getText(source)))) return;
    const constants = new Map<string, string>();
    function visit(n: ts.Node): void {
      if (ts.isCallExpression(n) && list(n)) {
        sites++;
        const expr = n.getText(source);
        let name = constants.get(expr);
        if (!name) {
          name = `__v8_constant_${count++}`;
          constants.set(expr, name);
        }
        edits.push({ start: n.getStart(source), end: n.end, text: name });
        return;
      }
      ts.forEachChild(n, visit);
    }
    ts.forEachChild(body, visit);
    const returned = body.statements.at(-1)!;
    if (!ts.isReturnStatement(returned)) throw new Error("unexpected module shape");
    edits.push({
      start: returned.getStart(source),
      end: returned.getStart(source),
      text: [...constants].map(([expr, name]) => `const ${name} = ${expr};`).join("\n") + "\n",
    });
    return;
  }
  ts.forEachChild(node, modules);
}
modules(source);
let result = text;
for (const e of edits.sort((a, b) => b.start - a.start)) {
  result = result.slice(0, e.start) + e.text + result.slice(e.end);
}
await Deno.writeTextFile(destination, result);
console.log(`hoisted ${count} constant lists at ${sites} sites`);
