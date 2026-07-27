import { assertEquals } from "@std/assert";
import type { LongId } from "../src/ast.ts";
import { longIdSpelling } from "../src/ast.ts";
import { checkVirtual, compileVirtual } from "../src/compiler.ts";
import { parse } from "../src/parser.ts";

/**
 * Desired-semantics regressions for the module update.
 *
 * These tests are ignored until their implementation slice starts. They state the accepted
 * semantics rather than preserving today's failure messages. Enable them individually while
 * completing the checklist IDs named in each test.
 */

Deno.test({
  name: "[module update T101] two aliases of one ModuleId both lower to the same runtime module",
  fn: async () => {
    const virtualFs = new Map<string, string>([
      ["/test/lib.wm", "let value = 1;"],
      [
        "/test/main.wm",
        'from "./lib.wm" import * as A; ' +
        'from "./lib.wm" import * as B; ' +
        "let main = () => { print(A.value + B.value) };",
      ],
    ]);

    assertEquals(await runVirtual("/test/main.wm", virtualFs), ["2"]);
  },
});

Deno.test({
  name: "[module update T115] shadowing a type does not delete an existing constructor value",
  fn: async () => {
    const virtualFs = new Map<string, string>([
      ["/test/lib.wm", "type Option<T> = T;"],
      [
        "/test/main.wm",
        'from "./lib.wm" import { Option }; ' +
        "let imported: Option<Number> = 1; " +
        "let existing = Some(2);",
      ],
    ]);

    await checkVirtual("/test/main.wm", virtualFs);
  },
});

Deno.test({
  name: "[module update T114/R505] open import emits only the target final public binding",
  fn: async () => {
    const virtualFs = new Map<string, string>([
      ["/test/lib.wm", "let value = 1; let value = 2;"],
      [
        "/test/main.wm",
        'from "./lib.wm" import *; let main = () => { print(value) };',
      ],
    ]);

    assertEquals(await runVirtual("/test/main.wm", virtualFs), ["2"]);
  },
});

Deno.test({
  name: "[module update T103] distinct same-basename modules receive distinct backend names",
  fn: async () => {
    const virtualFs = new Map<string, string>([
      ["/test/a/lib.wm", "let value = 1;"],
      ["/test/b/lib.wm", "let value = 2;"],
      [
        "/test/main.wm",
        'from "./a/lib.wm" import { value as a }; ' +
        'from "./b/lib.wm" import { value as b }; ' +
        "let main = () => { print(a + b) };",
      ],
    ]);

    assertEquals(await runVirtual("/test/main.wm", virtualFs), ["3"]);
  },
});

Deno.test({
  name: "[module update T107/T120] value and structure bindings may share one spelling",
  fn: async () => {
    const virtualFs = new Map<string, string>([
      ["/test/lib.wm", "let value = 1; let carrier = 99;"],
      [
        "/test/main.wm",
        'from "./lib.wm" import * as lib; ' +
        "let lib = 2; " +
        "let main = () => { print(lib + lib.value) };",
      ],
    ]);

    assertEquals(await runVirtual("/test/main.wm", virtualFs), ["3"]);
  },
});

Deno.test({
  name: "[module update T112] a later import shadows an earlier import in the value namespace",
  fn: async () => {
    const virtualFs = new Map<string, string>([
      ["/test/a.wm", "let value = 1;"],
      ["/test/b.wm", "let value = 2;"],
      [
        "/test/main.wm",
        'from "./a.wm" import { value }; ' +
        'from "./b.wm" import { value }; ' +
        "let main = () => { print(value) };",
      ],
    ]);

    assertEquals(await runVirtual("/test/main.wm", virtualFs), ["2"]);
  },
});

Deno.test({
  name: "[module update T111/T112/R506/R507] declaration-ordered aliases preserve earlier closures",
  fn: async () => {
    const virtualFs = new Map<string, string>([
      ["/test/a.wm", "let value = 1;"],
      ["/test/b.wm", "let value = 2;"],
      [
        "/test/main.wm",
        'from "./a.wm" import * as Lib; ' +
        "let fromFirstStructure = () => { Lib.value }; " +
        'from "./a.wm" import { value }; ' +
        "let fromFirstValue = () => { value }; " +
        "let value = 10; " +
        "let fromLocal = () => { value }; " +
        'from "./b.wm" import * as Lib; ' +
        "let fromSecondStructure = () => { Lib.value }; " +
        'from "./b.wm" import { value }; ' +
        "let fromSecondValue = () => { value }; " +
        "let main = () => { " +
        "print(fromFirstStructure() + fromFirstValue() + fromLocal() + " +
        "fromSecondStructure() + fromSecondValue()) };",
      ],
    ]);

    assertEquals(await runVirtual("/test/main.wm", virtualFs), ["16"]);
  },
});

Deno.test({
  name: "[module update T109/T112/R501] imported constructor identities survive later shadowing",
  fn: async () => {
    const virtualFs = new Map<string, string>([
      ["/test/a.wm", "type A = | Box;"],
      ["/test/b.wm", "type B = | Box;"],
      [
        "/test/main.wm",
        'from "./a.wm" import { Box }; ' +
        "let first = Box; " +
        "let readFirst = (item) => { match(item) { Box => { 1 } } }; " +
        'from "./b.wm" import { Box }; ' +
        "let second = Box; " +
        "let readSecond = (item) => { match(item) { Box => { 2 } } }; " +
        "let main = () => { print(readFirst(first) + readSecond(second)) };",
      ],
    ]);

    assertEquals(await runVirtual("/test/main.wm", virtualFs), ["3"]);
  },
});

Deno.test({
  name:
    "[module update T120/R504] namespace carrier fallback lowers through its structure identity",
  fn: async () => {
    const virtualFs = new Map<string, string>([
      ["/test/lib.wm", "let carrier = 41;"],
      [
        "/test/main.wm",
        'from "./lib.wm" import * as Domain; ' +
        "let main = () => { print(Domain + 1) };",
      ],
    ]);

    assertEquals(await runVirtual("/test/main.wm", virtualFs), ["42"]);
  },
});

Deno.test({
  name: "[module update T113] later declarations shadow imports and basis components independently",
  fn: async () => {
    const virtualFs = new Map<string, string>([
      [
        "/test/lib.wm",
        "type Token = | Imported; record Thing = { imported: Number }; let value = 1;",
      ],
      [
        "/test/main.wm",
        'from "./lib.wm" import { Token, Imported, Thing, value }; ' +
        "let oldValue = value; " +
        "type Token = | Local; " +
        "let oldToken = Imported; " +
        "record Thing = { local: Number }; " +
        "let value = 2; " +
        "type Option<T> = T; " +
        "let option: Option<Number> = 6; " +
        "let stillSome = Some(5); " +
        "let print = 3; " +
        'from js.global("console") import unsafe { log: (Number) => Void } as console; ' +
        "let main = () => { " +
        "match((Local, Thing(4), stillSome)) { " +
        "(Local, .{ local }, Some(number)) => { " +
        "console.log(oldValue + value + print + local + number + option) " +
        "} } };",
      ],
    ]);

    assertEquals(await runVirtual("/test/main.wm", virtualFs), ["21"]);
  },
});

async function runVirtual(
  entry: string,
  virtualFs: Map<string, string>,
): Promise<string[]> {
  const javaScript = await compileVirtual(entry, virtualFs);
  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    const nonce = crypto.randomUUID();
    await import(`data:text/javascript;base64,${btoa(javaScript)}#${nonce}`);
  } finally {
    console.log = original;
  }
  return output;
}

/**
 * `M215`/`G7`: qualified source names are the Revised Definition's long identifiers
 * (Section 2.4, `LongX = StrId* x X`), not dotted strings that semantic code re-parses.
 *
 * Both frontends must produce the same structured object for the same source, and every
 * source-derived qualified node must carry it, so elaboration never has to recover the
 * structure from a rendered spelling.
 */
Deno.test("[module update M215] source-derived long identifiers carry structured paths", async () => {
  const source = 'from "./lib.wm" import * as Lib; ' +
    "type Wrapper = | Holder<Lib.Thing>; " +
    "let value = A.B.member; " +
    "let typed = (x: Lib.Thing) => { x }; " +
    "let matched = match(v) => { Lib.Some(x) => { x }, _ => { 0 } };";

  const module = await parse(source);
  const qualified = collectLongIdNodes(module);

  // Every qualified occurrence in the source is represented structurally.
  const bySpelling = new Map(qualified.map((node) => [node.name, node.path]));
  assertEquals(bySpelling.get("Lib.Thing"), { qualifiers: ["Lib"], id: "Thing" });
  assertEquals(bySpelling.get("A.B.member"), { qualifiers: ["A", "B"], id: "member" });
  assertEquals(bySpelling.get("Lib.Some"), { qualifiers: ["Lib"], id: "Some" });

  // No source-derived node relies on recovering its path from the spelling, and the
  // spelling remains an exact rendering of the structure for display and emit.
  for (const node of qualified) {
    assertEquals(typeof node.path, "object", `${node.name} lost its structured path`);
    assertEquals(longIdSpelling(node.path!), node.name);
  }
});

type LongIdNode = { name: string; path?: LongId };

/** Collect every node kind that can carry a long identifier, at any depth. */
function collectLongIdNodes(root: unknown): LongIdNode[] {
  const found: LongIdNode[] = [];
  const kinds = new Set(["Var", "PPinned", "PCtor", "TName"]);
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (typeof node.kind === "string" && kinds.has(node.kind) && typeof node.name === "string") {
      const path = node.path as LongId | undefined;
      if (path && path.qualifiers.length > 0) found.push({ name: node.name, path });
    }
    for (const key of Object.keys(node)) {
      if (key !== "node") visit(node[key]);
    }
  };
  visit(root);
  return found;
}
