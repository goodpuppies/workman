import { assertEquals } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";
import { loadFrontendV2, type SurfaceNode } from "../src/frontend_v2_loader.ts";

const frontendSource = new URL("../tooling/frontend-v2/frontend.wm", import.meta.url).pathname;
const frontend = await loadFrontendV2(await buildFrontend());

Deno.test("Surface AST distinguishes tuple application from currying", () => {
  const tupleCall = expressionNodes("let result = f(a, b);");
  const curriedCall = expressionNodes("let result = f(a)(b);");

  assertEquals(tupleCall[0].kind, "apply");
  assertEquals(children(tupleCall, tupleCall[0]), ["name", "tuple"]);
  assertEquals(tupleCall.find((node) => node.kind === "tuple")?.children.length, 2);

  assertEquals(curriedCall[0].kind, "apply");
  assertEquals(children(curriedCall, curriedCall[0]), ["apply", "paren"]);
  assertEquals(curriedCall.filter((node) => node.kind === "apply").length, 2);
  assertUniqueNodeIds(tupleCall);
  assertUniqueNodeIds(curriedCall);
});

Deno.test("Surface AST models a tuple-pattern lambda as one unary rule", () => {
  const nodes = expressionNodes("let printer = (value, label) => { print value };");
  const lambda = nodes[0];
  const pattern = byId(nodes, lambda.children[0]);
  const body = byId(nodes, lambda.children[1]);

  assertEquals(lambda.kind, "lambda");
  assertEquals(pattern.kind, "pattern.tuple");
  assertEquals(pattern.children.map((id) => byId(nodes, id).kind), [
    "pattern.name",
    "pattern.name",
  ]);
  assertEquals(lambda.pairId, pattern.pairId);
  assertEquals(body.kind, "block");
  assertEquals(body.pairId >= 0, true);
  assertUniqueNodeIds(nodes);
});

Deno.test("Surface AST represents currying as nested unary lambdas", () => {
  const nodes = expressionNodes("let curry = (x) => { (y) => { x } };");

  assertEquals(nodes.filter((node) => node.kind === "lambda").length, 2);
  assertEquals(nodes.filter((node) => node.kind === "block").length, 2);
  assertEquals(nodes.filter((node) => node.kind === "pattern.name").length, 2);
  assertUniqueNodeIds(nodes);
});

Deno.test("Surface AST owns a missing block mate and typed lambda pattern", () => {
  const source = "let main = (x: String) => {\n  Lib.printer x";
  const parsed = frontend.parseStructural(source);
  const item = parsed.items[0];
  const nodes = item.expressionNodes;
  const lambda = byId(nodes, item.expressionRootId);
  const typed = byId(nodes, lambda.children[0]);
  const type = byId(nodes, typed.children[1]);
  const block = byId(nodes, lambda.children[1]);
  const missingClose = parsed.marks.find((mark) =>
    mark.code === "parse.expression.missing-close-brace"
  );

  assertEquals(lambda.kind, "lambda");
  assertEquals(typed.kind, "pattern.typed");
  assertEquals(type.kind, "type.name");
  assertEquals(type.nameParts, ["String"]);
  assertEquals(block.kind, "block");
  assertEquals(missingClose?.pairId, block.pairId);
  assertEquals(
    parsed.artifacts.find((artifact) => artifact.recoveryId === missingClose?.id)?.pairId,
    block.pairId,
  );
  assertUniqueNodeIds(nodes);
});

function expressionNodes(source: string): SurfaceNode[] {
  const item = frontend.parseStructural(source).items[0];
  assertEquals(item.expressionRootId, item.expressionNodes[0].id);
  return item.expressionNodes;
}

function children(nodes: SurfaceNode[], node: SurfaceNode): string[] {
  return node.children.map((id) => byId(nodes, id).kind);
}

function byId(nodes: SurfaceNode[], id: number): SurfaceNode {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`missing Surface AST node ${id}`);
  return node;
}

function assertUniqueNodeIds(nodes: SurfaceNode[]): void {
  assertEquals(new Set(nodes.map((node) => node.id)).size, nodes.length);
}

async function buildFrontend(): Promise<URL> {
  const output = (await Deno.makeTempDir()) + "/frontend-v2.mjs";
  await Deno.writeTextFile(output, await compileLibraryFile(frontendSource));
  return new URL("file://" + output);
}
