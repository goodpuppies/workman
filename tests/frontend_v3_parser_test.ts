import { assert, assertEquals } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { loadEditor } from "../tooling/frontend-v3/adapters/js/editor.ts";
import { list } from "../tooling/frontend-v3/adapters/js/preview.ts";
import peggy from "peggy";

function variant(value: any): any {
  if (value === null || typeof value !== "object") return value;
  if (!value.name) throw new Error("Unexpected non-variant in lexical metadata");
  const args = value.args.length === 1 && Array.isArray(value.args[0]) ? value.args[0] : value.args;
  return [value.name, ...args.map(variant)];
}
const units = (text: string) => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
const position = (p: any) => [p.index, p.line, p.col];
const span = (s: any) => [position(s.startPos), position(s.endPos)];
const mark = (
  m: any,
) => [m.id.args[0], variant(m.problem), variant(m.recovery), m.anchor.args[0], [
  m.affectedSpan.start.args[0],
  m.affectedSpan.end.args[0],
], m.causedBy.name === "None" ? null : m.causedBy.args[0].args[0]];

Deno.test("v3 parser preserves lexical ownership, marks and termination on damaged prefixes", async () => {
  const inspect = await loadEditor();
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(
      path,
      await compileLibraryFile(
        new URL("../tooling/frontend-v3/adapters/js/lexer.wm", import.meta.url).pathname,
      ),
    );
    const { lex, sourceUnits } = await import(`file://${path}`);
    const token = (
      t: any,
    ) => [
      variant(t.kind),
      span(t.span),
      t.mateIdx.name === "NoMate" ? null : t.mateIdx.args[0],
      list<any>(t.marks).map(mark),
      list<any>(t.leadingTrivia).map((
        v,
      ) => [
        variant(v.kind),
        list<number>(sourceUnits(v.text)),
        span(v.span),
        list<any>(v.marks).map(mark),
      ]),
    ];
    const cases = new Set([
      "",
      " ",
      "/*",
      "\ud800\0",
      "([)]",
      "let x=1+2;",
      "let rec f=x;",
      "let f=(x:Int)=>x;",
      "let x=\nlet y=1",
      "let\nlet y=1",
      "f(g x)",
      "f(x,,y)", "let x=(f();x);", "let f=x=>x}", "f true",
    ]);
    for (
      const text of [
        "let id=x=>x;",
        "let f=()=>{let x=1;x};",
        "f((x=>x))",
        "let f=(x,y)=>{f(x,y)};",
        '/* hi */let x="a\\n"; // end\n',
        "let x=[1,2];\nlet y=3;",
        "let x=`a${f(x)}`;",
        "let x=a+b*c<=d&&e||f;", "let x=a*+b;", "let x=-f(a)+!!b;",
        "let x=1+x=>x;",
      ]
    ) {
      for (let i = 0; i <= text.length; i++) cases.add(text.slice(0, i));
    }
    for (const text of cases) {
      const view = inspect(text);
      const document = view.document as any[];
      const lexical = lex(text);
      const expected = list<any>(lexical.tokens).map(token);
      const owned: any[] = [];
      const references: number[] = [];
      const nodeIds: number[] = [];
      const delimiterIds: number[] = [];
      function walk(value: any) {
        if (!Array.isArray(value)) return;
        if (
          value.length === 5 && Array.isArray(value[1]) && value[1].length === 2 &&
          value[1].every((p: any) =>
            Array.isArray(p) && p.length === 3 && p.every((n: any) => typeof n === "number")
          )
        ) {
          owned.push(value);
          return;
        }
        if (
          value[0] === "MissingSlot" || value[0] === "VirtualHole" || value[0] === "DamagedFragment"
        ) references.push(value[1]);
        if (value[0] === "MissingPattern") references.push(value[2]);
        if (
          value.length === 2 && typeof value[0] === "number" && Array.isArray(value[1]) &&
          value[1].length === 2 && value[1].every((n: any) => typeof n === "number")
        ) nodeIds.push(value[0]);
        if (
          value.length === 4 && typeof value[0] === "number" &&
          ["MissingSlot", "AuthoredSlot"].includes(value[1]?.[0]) &&
          ["MissingSlot", "AuthoredSlot"].includes(value[3]?.[0])
        ) delimiterIds.push(value[0]);
        for (const item of value) walk(item);
      }
      walk(document[1]);
      owned.push(document[2]);
      owned.sort((a, b) => a[1][0][0] - b[1][0][0]);
      assertEquals(owned, expected, `authored ownership: ${JSON.stringify(text)}`);
      assertEquals(document[0], units(text));
      assertEquals(document[3], list<any>(lexical.marks).map(mark));
      const syntax = document[4] as any[];
      assertEquals(
        syntax.map((m) => m[0]),
        Array.from({ length: syntax.length }, (_, i) => document[3].length + i),
      );
      assertEquals(
        references.sort((a, b) => a - b),
        syntax.map((m) => m[0]),
        `mark references: ${JSON.stringify(text)}`,
      );
      assertEquals(new Set(nodeIds).size, nodeIds.length, `node identity: ${JSON.stringify(text)}`);
      assertEquals(
        new Set(delimiterIds).size,
        delimiterIds.length,
        `delimiter identity: ${JSON.stringify(text)}`,
      );
      for (const edit of view.edits) {
        if (edit.kind === "Keep") {
          assertEquals(
            text.slice(edit.originalStart, edit.originalEnd),
            view.projected.slice(edit.projectedStart, edit.projectedEnd),
          );
        }
      }
      assert(view.preview.length >= text.length);
    }
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("v3 operator structure matches the existing WM grammar", async () => {
  const inspect = await loadEditor();
  const grammar = peggy.generate(await Deno.readTextFile(new URL("../src/grammar.peggy", import.meta.url)),
    { allowedStartRules: ["Expr"] });
  function reference(value: any): any {
    switch (value.kind) {
      case "Var": return ["name", value.name];
      case "Unary": return ["prefix", value.op, reference(value.value)];
      case "Binary": return ["infix", reference(value.left), value.op, reference(value.right)];
      case "Call": return ["call", reference(value.callee), value.args.map(reference)];
      default: throw new Error(`Unexpected reference expression ${value.kind}`);
    }
  }
  function surface(value: any, source: string): any {
    const spelling = (token: any) => source.slice(token[1][0][0], token[1][1][0]);
    switch (value[0]) {
      case "NameExpr": return ["name", spelling(value[2])];
      case "PrefixExpr": return ["prefix", spelling(value[2]), surface(value[3], source)];
      case "InfixExpr": return ["infix", surface(value[2], source), spelling(value[3]), surface(value[4], source)];
      case "GroupExpr": return surface(value[2][2], source);
      case "CallExpr": {
        const items = value[3][2];
        const args = items[0] === "EmptyItems" ? [] : [items[1], ...items[2].map((entry: any) => entry[1])];
        return ["call", surface(value[2], source), args.map((arg: any) => surface(arg, source))];
      }
      default: throw new Error(`Unexpected surface expression ${value[0]}`);
    }
  }
  const operators = ["||", "&&", "==", "!=", "<", ">", "<=", ">=", "+", "-", "++", "*", "/", "%"];
  const cases = operators.flatMap((left) => operators.map((right) => `a ${left} b ${right} c`));
  cases.push("-a*b", "!a==b", "!!a||b", "f(a)+g(b)", "f a+b", "f g(a)", "(a+b)*c", "a-b-c");
  for (const expression of cases) {
    const source = `let x=${expression};`;
    const document = inspect(source).document as any[];
    assertEquals(document[1].length, 1);
    assertEquals(document[1][0][0], "BindingStatement");
    assertEquals(surface(document[1][0][1][4], source), reference(grammar.parse(expression)), expression);
  }
});
